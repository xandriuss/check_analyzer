import base64
import json
import os
import re
import time
import unicodedata
from pathlib import Path

import cv2
import pytesseract
from openai import OpenAI

PREPARED_MAX_LONG_EDGE = 1600
PREPARED_JPEG_QUALITY = 76
OCR_TARGET_WIDTH = 1500
OCR_TIMEOUT_SECONDS = 8

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
- discounts = negative discount lines, including product discounts like "Aciu nuolaida prekei:..." and generic discounts like "ACIU nuolaidos", "Suteiktos naudos", "Pritaikytos nuolaidos".
- deposits = positive PET, skardine, depozitas, depozitine tara, or deposit/imoka lines. Use the final right-side deposit sum, e.g. 0.10 or 0.40.
- receipt_total = "Kvito suma" or "Moketina suma" final total.
- Ignore PVM/tax tables, barcodes, cashier/store/card text, but keep deposit lines in deposits.
- Do not use unit/kg/quantity prices as final_price. Example: "4.99 x 1.084 kg" is unit price; use the right-side final line price.
- Never calculate or guess prices. If the final product price is unclear, skip the item.
- Keep Lithuanian product names as written. Convert comma decimals to dot numbers.
"""


def prepare_receipt_image(image_path):
    if not os.path.exists(image_path):
        print("Image not found:", image_path)
        return image_path

    source_path = Path(image_path)
    prepared_path = source_path.with_name(f"{source_path.stem}_scan.jpg")
    if prepared_path.exists() and prepared_path.stat().st_mtime >= source_path.stat().st_mtime:
        return str(prepared_path)

    img = cv2.imread(image_path)
    if img is None:
        return image_path

    height, width = img.shape[:2]
    if width > height:
        img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        height, width = img.shape[:2]

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    _, threshold = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (17, 17))
    threshold = cv2.morphologyEx(threshold, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(threshold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < width * height * 0.08:
            continue

        x, y, w, h = cv2.boundingRect(contour)
        if h <= w:
            continue

        candidates.append((area, x, y, w, h))

    if candidates:
        image_center_x = width / 2

        def candidate_score(item):
            area, x, _, w, h = item
            candidate_center_x = x + w / 2
            center_distance = abs(candidate_center_x - image_center_x) / image_center_x
            aspect_bonus = min(h / max(w, 1), 4)
            return area * (1 - min(center_distance, 0.9)) * aspect_bonus

        _, x, y, w, h = max(candidates, key=candidate_score)
        margin_x = int(w * 0.04)
        margin_y = int(h * 0.025)
        x1 = max(x - margin_x, 0)
        y1 = max(y - margin_y, 0)
        x2 = min(x + w + margin_x, width)
        y2 = min(y + h + margin_y, height)
        cropped = img[y1:y2, x1:x2]
    else:
        crop_width = int(width * 0.72)
        x1 = max((width - crop_width) // 2, 0)
        cropped = img[:, x1 : x1 + crop_width]

    if cropped.shape[1] > cropped.shape[0]:
        cropped = cv2.rotate(cropped, cv2.ROTATE_90_CLOCKWISE)

    long_edge = max(cropped.shape[:2])
    scale = min(1.0, PREPARED_MAX_LONG_EDGE / max(long_edge, 1))
    if abs(scale - 1.0) > 0.03:
        cropped = cv2.resize(cropped, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    cropped_gray = cv2.cvtColor(cropped, cv2.COLOR_BGR2GRAY)
    cropped_gray = cv2.bilateralFilter(cropped_gray, 7, 45, 45)
    enhanced = cv2.adaptiveThreshold(
        cropped_gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        9,
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


def ai_parse_receipt(image_path):
    if not os.path.exists(image_path):
        print("Image not found:", image_path)
        return _empty_result()

    start = time.perf_counter()
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), timeout=45.0)
    scan_path = prepare_receipt_image(image_path)

    with open(scan_path, "rb") as f:
        img_base64 = base64.b64encode(f.read()).decode()

    response = client.responses.create(
        model="gpt-4.1-mini",
        max_output_tokens=1800,
        input=[
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": AI_PROMPT},
                    {
                        "type": "input_image",
                        "image_url": f"data:image/jpeg;base64,{img_base64}",
                    },
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
    _, otsu = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    adaptive = cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        9,
    )
    return [
        ("sharpened", sharpened),
        ("otsu", otsu),
        ("adaptive", adaptive),
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
        "--oem 3 --psm 4 -c preserve_interword_spaces=1",
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
