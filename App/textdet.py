import base64
import json
import os
import re
import time
import unicodedata
from pathlib import Path

import cv2
import numpy as np
import pytesseract
from openai import OpenAI

PREPARED_MAX_LONG_EDGE = 1450
PREPARED_JPEG_QUALITY = 74
OCR_TARGET_WIDTH = 1500
OCR_TIMEOUT_SECONDS = 4
OCR_ORIENTATION_TIMEOUT_SECONDS = 1.5
AI_SLICE_TARGET_WIDTH = 1200
AI_MAX_SLICE_HEIGHT = 780
AI_MAX_SLICES = 4
AI_SLICE_OVERLAP = 0.14

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


AI_PROMPT = """
Tu esi Lietuvos parduotuvių kvitų analizės AI.

GRIEŽTAI:
- Grąžink tik JSON.
- Nerašyk jokio papildomo teksto.
- Nenaudok ```json blokų.

UŽDUOTIS:
- Ištrauk tik prekių sąrašą ir galutines prekių kainas.
- Prekės kaina paprastai yra dešinėje tos pačios eilutės pusėje.
- Ignoruok PVM eilutes, depozitą, barkodą, reklamas, kasos duomenis ir mokėjimo kortelės tekstą.
- PET, skardinė, depozitas, depozitinė tara nėra prekės maisto analizei.
- Jei kvite yra prekės nuolaida, pvz. "Ačiū nuolaida prekei:Gazuotas gėrimas COCA-COLA -1,26", įrašyk visą prekės pavadinimą į discounts.name ir sumą į discounts.amount.
- Jei kvite yra "Nuolaida", "Suteiktos naudos", "Maxima pinigai", "Ačiū kortelė" ar panaši bendra nuolaida be prekės pavadinimo, įrašyk ją į discounts kaip neigiamą sumą.
- Jei matai "Kvito suma", "Mokėtina suma" arba galutinę mokėtiną sumą, įrašyk ją į receipt_total.

LABAI SVARBU:
- Jeigu eilutėje yra "0.85 x 2", nenaudok vieneto kainos 0.85. Naudok tik galutinę eilutės kainą iš kvito, pvz. 1.70.
- Niekada pats nedaugink vieneto kainų.
- Nepainiok kiekio, kilogramų, PVM procento, kortelės numerių ar čekių numerių su kaina.
- Jeigu prekės kaina jau yra po nuolaidos, final_price turi būti kaina po nuolaidos.
- Prekių suma kartu su discounts turi būti logiškai artima receipt_total, jeigu receipt_total matomas.

FORMATAS:
{
  "items": [
    {
      "name": "...",
      "final_price": 0.00
    }
  ],
  "discounts": [
    {
      "name": "...",
      "amount": -0.00
    }
  ],
  "receipt_total": 0.00
}
"""

AI_PROMPT += """

EXTRA PRICE RULES:
- If a line contains "4.99 x 1.084 kg", 4.99 is a unit/kg price, not the final product price. Use the right-side final line price, for example 5.41.
- Never copy the same price into multiple different products unless the receipt clearly shows that same price on each product line.
- If a product price is unclear, skip that item instead of guessing a price.
"""

AI_PROMPT = """Read a Lithuanian grocery receipt image. Return ONLY valid JSON, no markdown.
Schema: {"items":[{"name":"...","final_price":0.00}],"discounts":[{"name":"...","amount":-0.00}],"deposits":[{"name":"...","amount":0.00}],"receipt_total":0.00}
Rules:
- items = bought product lines only, with the final right-side line price.
- Read every product row between the cashier/receipt number area and the discount/tax/total section.
- Do not return only the total. If product rows are visible, extract them.
- discounts = negative discount lines, including product discounts like "Aciu nuolaida prekei:..." and generic discounts like "ACIU nuolaidos", "Suteiktos naudos", "Pritaikytos nuolaidos".
- deposits = positive PET, skardine, depozitas, depozitine tara, or deposit/imoka lines. Use the final right-side deposit sum, e.g. 0.10 or 0.40.
- receipt_total = "Kvito suma" or "Moketina suma" final total.
- Ignore PVM/tax tables, barcodes, cashier/store/card text, but keep deposit lines in deposits.
- If the receipt image is sideways or upside down, read it after mentally rotating it to normal receipt orientation.
- Do not use unit/kg/quantity prices as final_price. Example: "4.99 x 1.084 kg" is unit price; use the right-side final line price.
- Never calculate or guess prices. If the final product price is unclear, skip the item.
- You may receive the full receipt followed by enlarged vertical slices from top to bottom.
- Use the enlarged slices to read small product rows. Use the full receipt only for context.
- Merge overlap between slices; never duplicate a product, discount, or deposit line.
- Prioritize your visual reading of the product rows over noisy OCR-like text artifacts.
- Keep Lithuanian product names as written. Convert comma decimals to dot numbers.
"""


def _rotate_image(img, degrees):
    if degrees == 90:
        return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    if degrees == -90:
        return cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    if degrees == 180:
        return cv2.rotate(img, cv2.ROTATE_180)
    return img


def _receipt_candidate_score(crop, source_width, source_height, x, y, w, h, area):
    crop_height, crop_width = crop.shape[:2]
    if crop_width <= 0 or crop_height <= 0:
        return -1

    crop_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
    aspect = crop_height / max(crop_width, 1)
    white_ratio = float(np.mean(crop_gray > 150))
    text_edges = cv2.Canny(crop_gray, 60, 150)
    text_density = float(np.mean(text_edges > 0))
    center_distance = abs((x + w / 2) - source_width / 2) / max(source_width / 2, 1)
    area_ratio = area / max(source_width * source_height, 1)
    fill_ratio = area / max(w * h, 1)

    if aspect < 1.0:
        aspect_weight = 0.55
    else:
        aspect_weight = 1.0 + min(aspect, 5.0) / 5.0

    return (
        area_ratio
        * 10000
        * (1 - min(center_distance, 0.85) * 0.55)
        * max(fill_ratio, 0.25)
        * aspect_weight
        * (0.65 + white_ratio)
        * (0.85 + min(text_density * 10, 0.85))
    )


def _contour_to_crop(image, contour):
    area = cv2.contourArea(contour)
    height, width = image.shape[:2]
    if area < width * height * 0.06:
        return None

    x, y, w, h = cv2.boundingRect(contour)
    if w < width * 0.18 or h < height * 0.28:
        return None

    if h < w * 0.95:
        return None

    # Keep rows intact. Perspective warp can distort narrow receipt text when the
    # detected contour comes from shadows, logos, or partial paper edges.
    margin_x = max(int(w * 0.08), 24)
    margin_y = max(int(h * 0.035), 24)
    x1 = max(x - margin_x, 0)
    y1 = max(y - margin_y, 0)
    x2 = min(x + w + margin_x, width)
    y2 = min(y + h + margin_y, height)
    crop = image[y1:y2, x1:x2]

    score = _receipt_candidate_score(crop, width, height, x, y, w, h, area)
    return crop, score


def _detect_receipt_crop(img):
    height, width = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    edge_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edges = cv2.Canny(gray, 45, 145)
    edges = cv2.dilate(edges, edge_kernel, iterations=2)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, edge_kernel, iterations=2)

    _, threshold = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    paper_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (19, 19))
    threshold = cv2.morphologyEx(threshold, cv2.MORPH_CLOSE, paper_kernel, iterations=2)

    candidates = []
    for mask in (edges, threshold):
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            candidate = _contour_to_crop(img, contour)
            if candidate is not None:
                candidates.append(candidate)

    if candidates:
        cropped, score = max(candidates, key=lambda item: item[1])
    else:
        cropped = img
        score = 0

    if cropped.shape[1] > cropped.shape[0]:
        cropped = cv2.rotate(cropped, cv2.ROTATE_90_CLOCKWISE)

    return cropped, score


def _crop_is_safe(crop, original):
    crop_height, crop_width = crop.shape[:2]
    original_height, original_width = original.shape[:2]
    if crop_width <= 0 or crop_height <= 0:
        return False

    crop_area = crop_width * crop_height
    original_area = max(original_width * original_height, 1)
    crop_area_ratio = crop_area / original_area
    aspect = crop_height / max(crop_width, 1)

    if crop_area_ratio < 0.08:
        return False

    if aspect < 0.95 and crop_area_ratio < 0.72:
        return False

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
    white_ratio = float(np.mean(gray > 145))
    edge_density = float(np.mean(cv2.Canny(gray, 60, 150) > 0))

    if white_ratio < 0.12:
        return False

    if edge_density < 0.006:
        return False

    return True


def _auto_crop_receipt(img):
    best_crop = None
    best_score = -1

    for degrees in (0, 90, -90, 180):
        rotated = _rotate_image(img, degrees)
        crop, score = _detect_receipt_crop(rotated)
        if score > best_score:
            best_crop = crop
            best_score = score

    print(f"Auto receipt crop score={best_score:.1f}")
    if best_crop is None:
        return img

    if best_score <= 0 or not _crop_is_safe(best_crop, img):
        print("Auto receipt crop rejected: weak or unsafe crop")
        return img

    return best_crop


def _orientation_score(text):
    normalized = _normalize_text(text)
    price_count = len(re.findall(r"-?\d+[,.]\d{2}", text or ""))
    keyword_score = 0
    for word in [
        "maxima",
        "kvito suma",
        "moketina suma",
        "pvm",
        "kasinink",
        "nuolaid",
        "depozit",
        "aciu",
        "eur",
    ]:
        if word in normalized:
            keyword_score += 12
    return keyword_score + min(price_count, 30) * 3


def _resize_for_orientation(gray):
    height, width = gray.shape[:2]
    long_edge = max(height, width)
    if long_edge <= 850:
        return gray
    scale = 850 / long_edge
    return cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)


def _orient_receipt_upright(img):
    if img is None or img.size == 0:
        return img

    best_img = img
    best_score = -1

    for degrees in (0, 180):
        rotated = _rotate_image(img, degrees)
        gray = cv2.cvtColor(rotated, cv2.COLOR_BGR2GRAY)
        gray = _resize_for_orientation(gray)
        try:
            text = pytesseract.image_to_string(
                gray,
                lang="lit+eng",
                config="--oem 3 --psm 6",
                timeout=OCR_ORIENTATION_TIMEOUT_SECONDS,
            )
        except (RuntimeError, pytesseract.TesseractNotFoundError, pytesseract.TesseractError):
            return img

        score = _orientation_score(text)
        if score > best_score:
            best_score = score
            best_img = rotated

    print(f"Receipt orientation score={best_score:.1f}")
    return best_img


def prepare_receipt_image(image_path, auto_crop=True, use_orientation_ocr=True):
    if not os.path.exists(image_path):
        print("Image not found:", image_path)
        return image_path

    source_path = Path(image_path)
    suffix = "_scan" if auto_crop else "_fullscan"
    prepared_path = source_path.with_name(f"{source_path.stem}{suffix}.jpg")
    if prepared_path.exists() and prepared_path.stat().st_mtime >= source_path.stat().st_mtime:
        return str(prepared_path)

    img = cv2.imread(image_path)
    if img is None:
        return image_path

    cropped = _auto_crop_receipt(img) if auto_crop else img
    if use_orientation_ocr:
        cropped = _orient_receipt_upright(cropped)

    long_edge = max(cropped.shape[:2])
    scale = min(1.0, PREPARED_MAX_LONG_EDGE / max(long_edge, 1))
    if abs(scale - 1.0) > 0.03:
        cropped = cv2.resize(cropped, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    cropped_gray = cv2.cvtColor(cropped, cv2.COLOR_BGR2GRAY)
    cropped_gray = cv2.bilateralFilter(cropped_gray, 5, 35, 35)
    enhanced = cv2.addWeighted(
        cropped_gray,
        1.45,
        cv2.GaussianBlur(cropped_gray, (0, 0), 1.1),
        -0.45,
        0,
    )

    cv2.imwrite(str(prepared_path), enhanced, [int(cv2.IMWRITE_JPEG_QUALITY), PREPARED_JPEG_QUALITY])
    return str(prepared_path)


def _empty_result(scan_path=None, raw_ai_output=None, raw_ocr_output=None):
    return {
        "items": [],
        "discounts": [],
        "deposits": [],
        "receipt_total": None,
        "scan_path": scan_path,
        "raw_ai_output": raw_ai_output,
        "raw_ocr_output": raw_ocr_output,
    }


def _to_float(value):
    if value is None:
        return None

    if isinstance(value, (int, float)):
        return float(value)

    match = re.search(r"-?\d+[.,]\d{2}", str(value))
    if not match:
        return None

    return float(match.group(0).replace(",", "."))


def _to_last_float(value):
    matches = re.findall(r"-?\d+[.,]\d{2}", str(value or ""))
    if not matches:
        return None

    return float(matches[-1].replace(",", "."))


def _parse_ai_json(result, scan_path):
    raw_result = result
    result = re.sub(r"```json", "", result)
    result = re.sub(r"```", "", result).strip()

    object_match = re.search(r"\{[\s\S]*\}", result)
    list_match = re.search(r"\[[\s\S]*\]", result)

    try:
        if object_match:
            parsed = json.loads(object_match.group(0))
            parsed["scan_path"] = scan_path
            parsed["raw_ai_output"] = raw_result
            parsed.setdefault("items", [])
            parsed.setdefault("discounts", [])
            parsed.setdefault("deposits", [])
            parsed.setdefault("receipt_total", None)
            return parsed

        if list_match:
            return {
                "items": json.loads(list_match.group(0)),
                "discounts": [],
                "deposits": [],
                "receipt_total": None,
                "scan_path": scan_path,
                "raw_ai_output": raw_result,
            }
    except json.JSONDecodeError:
        pass

    return _empty_result(scan_path, raw_ai_output=raw_result)


def _encode_image_as_data_url(img):
    ok, encoded = cv2.imencode(
        ".jpg",
        img,
        [int(cv2.IMWRITE_JPEG_QUALITY), PREPARED_JPEG_QUALITY],
    )
    if not ok:
        return None

    img_base64 = base64.b64encode(encoded.tobytes()).decode()
    return f"data:image/jpeg;base64,{img_base64}"


def _resize_slice_for_ai(img):
    height, width = img.shape[:2]
    if width >= AI_SLICE_TARGET_WIDTH:
        return img

    scale = AI_SLICE_TARGET_WIDTH / max(width, 1)
    return cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)


def _ai_image_inputs(scan_path):
    img = cv2.imread(scan_path)
    if img is None:
        with open(scan_path, "rb") as f:
            img_base64 = base64.b64encode(f.read()).decode()
        return [
            {
                "type": "input_image",
                "image_url": f"data:image/jpeg;base64,{img_base64}",
                "detail": "high",
            }
        ]

    inputs = []
    full_url = _encode_image_as_data_url(img)
    if full_url:
        inputs.append({"type": "input_image", "image_url": full_url, "detail": "auto"})

    height, width = img.shape[:2]
    if height <= AI_MAX_SLICE_HEIGHT and width >= AI_SLICE_TARGET_WIDTH * 0.8:
        return inputs

    slice_count = min(AI_MAX_SLICES, max(1, int(np.ceil(height / AI_MAX_SLICE_HEIGHT))))
    slice_height = min(height, max(AI_MAX_SLICE_HEIGHT, int(np.ceil((height / slice_count) * (1 + AI_SLICE_OVERLAP)))))
    max_start = max(height - slice_height, 0)
    if slice_count == 1:
        starts = [0]
    else:
        starts = [int(round(value)) for value in np.linspace(0, max_start, slice_count)]

    for y1 in starts:
        y2 = min(y1 + slice_height, height)
        crop = _resize_slice_for_ai(img[y1:y2, :])
        crop_url = _encode_image_as_data_url(crop)
        if crop_url:
            inputs.append({"type": "input_image", "image_url": crop_url, "detail": "high"})

    print(f"AI image inputs: full + {max(len(inputs) - 1, 0)} enlarged slices")
    return inputs


def ai_parse_receipt(image_path, auto_crop=True):
    if not os.path.exists(image_path):
        print("Image not found:", image_path)
        return _empty_result()

    start = time.perf_counter()
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), timeout=45.0)
    scan_path = prepare_receipt_image(image_path, auto_crop=auto_crop)

    image_inputs = _ai_image_inputs(scan_path)

    response = client.responses.create(
        model="gpt-4.1-mini",
        max_output_tokens=1800,
        input=[
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": AI_PROMPT},
                    *image_inputs,
                ],
            }
        ],
    )

    result = response.output_text
    print(f"AI receipt parse took {time.perf_counter() - start:.2f}s")
    print("\n=== AI RAW ===")
    print(result)

    return _parse_ai_json(result, scan_path)


def _ocr_text_score(text):
    price_count = len(re.findall(r"-?\d+[,.]\d{2}", text or ""))
    receipt_total_bonus = 8 if re.search(r"kvito\s+suma|mok[eė]tina\s+suma", text or "", re.I) else 0
    discount_bonus = 3 if re.search(r"nuolaid|suteiktos\s+naudos|a[cč]i[uū]", text or "", re.I) else 0
    return price_count + receipt_total_bonus + discount_bonus


def _read_ocr_text(img):
    configs = [
        "--oem 3 --psm 6 -c preserve_interword_spaces=1",
        "--oem 3 --psm 4 -c preserve_interword_spaces=1",
    ]
    best_text = ""

    for config in configs:
        text = pytesseract.image_to_string(img, lang="lit+eng", config=config)
        if _ocr_text_score(text) > _ocr_text_score(best_text):
            best_text = text

    return best_text


def _normalize_text(value):
    normalized = unicodedata.normalize("NFKD", value or "")
    return "".join(char for char in normalized if not unicodedata.combining(char)).lower()


def _ocr_score(text, confidence=0):
    normalized = _normalize_text(text)
    price_count = len(re.findall(r"-?\d+[,.]\d{2}", text or ""))
    line_count = len([line for line in (text or "").splitlines() if line.strip()])
    receipt_total_bonus = 20 if re.search(r"kvito\s+suma|moketina\s+suma", normalized) else 0
    discount_bonus = 8 if re.search(r"nuolaid|suteiktos\s+naudos|aciu", normalized) else 0
    product_bonus = sum(
        2
        for word in ["coca", "alus", "bandel", "trask", "suris", "kump", "sokolad"]
        if word in normalized
    )
    return price_count * 4 + min(line_count, 45) + receipt_total_bonus + discount_bonus + product_bonus + confidence / 4


def _resize_for_ocr(gray):
    _, width = gray.shape[:2]
    if width >= OCR_TARGET_WIDTH:
        return gray
    scale = OCR_TARGET_WIDTH / max(width, 1)
    return cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)


def _deskew(gray):
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    coords = cv2.findNonZero(255 - binary)
    if coords is None:
        return gray

    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = 90 + angle
    if abs(angle) < 0.25 or abs(angle) > 8:
        return gray

    height, width = gray.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    return cv2.warpAffine(gray, matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def _ocr_variants(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    gray = _deskew(_resize_for_ocr(gray))
    denoised = cv2.bilateralFilter(gray, 7, 35, 35)
    sharpened = cv2.addWeighted(denoised, 1.6, cv2.GaussianBlur(denoised, (0, 0), 1.2), -0.6, 0)
    return [
        ("sharpened", sharpened),
    ]


def _ocr_confidence(image, config):
    data = pytesseract.image_to_data(
        image,
        lang="lit+eng",
        config=config,
        output_type=pytesseract.Output.DICT,
    )
    confidences = []
    for value in data.get("conf", []):
        try:
            confidence = float(value)
        except (TypeError, ValueError):
            continue
        if confidence >= 0:
            confidences.append(confidence)
    if not confidences:
        return 0
    return sum(confidences) / len(confidences)


def _read_ocr_text(img):
    configs = [
        "--oem 3 --psm 6 -c preserve_interword_spaces=1",
    ]
    best = {"text": "", "score": -1, "variant": "", "confidence": 0}
    start = time.perf_counter()

    for variant_name, variant in _ocr_variants(img):
        for config in configs:
            try:
                text = pytesseract.image_to_string(
                    variant,
                    lang="lit+eng",
                    config=config,
                    timeout=OCR_TIMEOUT_SECONDS,
                )
            except RuntimeError as exc:
                print(f"OCR variant={variant_name} timed out: {exc}")
                continue

            score = _ocr_score(text)
            if score > best["score"]:
                best = {
                    "text": text,
                    "score": score,
                    "variant": variant_name,
                    "confidence": 0,
                }

    print(
        f"OCR selected variant={best.get('variant')} score={best.get('score', 0):.1f} took {time.perf_counter() - start:.2f}s"
    )
    return best["text"]


def ocr_parse_receipt(image_path):
    scan_path = prepare_receipt_image(image_path)
    img = cv2.imread(scan_path)

    if img is None:
        return _empty_result(scan_path)

    try:
        text = _read_ocr_text(img)
    except pytesseract.TesseractNotFoundError:
        message = "OCR skipped: tesseract is not installed or not in PATH."
        print(message)
        return _empty_result(scan_path, raw_ocr_output=message)
    except pytesseract.TesseractError as exc:
        print("OCR skipped:", exc)
        return _empty_result(scan_path, raw_ocr_output=str(exc))

    print("\n=== OCR RAW ===")
    print(text)

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    items = []
    discounts = []
    deposits = []
    receipt_total = None
    pending_discount_name = None

    skip_words = [
        "pvm",
        "kodas",
        "kasa",
        "kasinink",
        "kortel",
        "mokėta",
        "moketa",
        "taros",
        "barkod",
        "sutaup",
        "maximos pinig",
    ]
    total_words = ["kvito suma", "mokėtina suma", "moketina suma", "iš viso", "is viso"]
    discount_words = ["nuolaid", "suteiktos naudos", "ačiū", "aciu"]

    deposit_words = ["depozit", "pet", "skardin"]

    for line in lines:
        low = line.lower()
        value = _to_float(line)

        if value is None:
            if any(word in low for word in discount_words):
                pending_discount_name = line
            continue

        if any(word in low for word in total_words):
            receipt_total = abs(value)
            continue

        if any(word in low for word in deposit_words):
            deposit_value = _to_last_float(line)
            if deposit_value and deposit_value > 0:
                deposits.append({"name": line, "amount": deposit_value})
            continue

        if pending_discount_name and value < 0:
            discounts.append({"name": pending_discount_name, "amount": value})
            pending_discount_name = None
            continue

        if any(word in low for word in discount_words):
            discounts.append({"name": line, "amount": -abs(value)})
            pending_discount_name = None
            continue

        if value < 0:
            discounts.append({"name": line, "amount": value})
            pending_discount_name = None
            continue

        if any(word in low for word in skip_words):
            continue

        name = re.sub(r"-?\d+[.,]\d{2}.*$", "", line).strip(" -:;")
        if len(name) >= 3:
            items.append({"name": name, "final_price": value})

    return {
        "items": items,
        "discounts": discounts,
        "deposits": deposits,
        "receipt_total": receipt_total,
        "scan_path": scan_path,
        "raw_ocr_output": text,
    }


def fix_quantity_errors(pairs):
    fixed = []

    for name, price in pairs:
        match = re.search(r"(\d+[.,]\d+)\s*x\s*(\d+)", name)

        if match:
            unit = float(match.group(1).replace(",", "."))
            qty = int(match.group(2))
            expected = round(unit * qty, 2)
            real = float(price)

            if abs(real - expected * 2) < 0.05:
                price = f"{expected:.2f}"

        fixed.append((name, price))

    return fixed


def ocr_extract_pairs(image_path):
    data = ocr_parse_receipt(image_path)
    return [
        (item.get("name", ""), f"{float(item.get('final_price', 0)):.2f}")
        for item in data.get("items", [])
        if item.get("name")
    ]
