import base64
import json
import os
import re
from pathlib import Path

import cv2
import pytesseract
from openai import OpenAI

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


def prepare_receipt_image(image_path):
    if not os.path.exists(image_path):
        print("Image not found:", image_path)
        return image_path

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

    cropped = cv2.resize(cropped, None, fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)
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

    prepared_path = Path(image_path).with_name(f"{Path(image_path).stem}_scan.jpg")
    cv2.imwrite(str(prepared_path), enhanced)
    return str(prepared_path)


def _empty_result(scan_path=None):
    return {"items": [], "discounts": [], "receipt_total": None, "scan_path": scan_path}


def _to_float(value):
    if value is None:
        return None

    if isinstance(value, (int, float)):
        return float(value)

    match = re.search(r"-?\d+[.,]\d{2}", str(value))
    if not match:
        return None

    return float(match.group(0).replace(",", "."))


def _parse_ai_json(result, scan_path):
    result = re.sub(r"```json", "", result)
    result = re.sub(r"```", "", result).strip()

    object_match = re.search(r"\{[\s\S]*\}", result)
    list_match = re.search(r"\[[\s\S]*\]", result)

    try:
        if object_match:
            parsed = json.loads(object_match.group(0))
            parsed["scan_path"] = scan_path
            parsed.setdefault("items", [])
            parsed.setdefault("discounts", [])
            parsed.setdefault("receipt_total", None)
            return parsed

        if list_match:
            return {
                "items": json.loads(list_match.group(0)),
                "discounts": [],
                "receipt_total": None,
                "scan_path": scan_path,
            }
    except json.JSONDecodeError:
        pass

    return _empty_result(scan_path)


def ai_parse_receipt(image_path):
    if not os.path.exists(image_path):
        print("Image not found:", image_path)
        return _empty_result()

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    scan_path = prepare_receipt_image(image_path)

    with open(scan_path, "rb") as f:
        img_base64 = base64.b64encode(f.read()).decode()

    response = client.responses.create(
        model="gpt-4.1-mini",
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
    print("\n=== AI RAW ===")
    print(result)

    return _parse_ai_json(result, scan_path)


def ocr_parse_receipt(image_path):
    scan_path = prepare_receipt_image(image_path)
    img = cv2.imread(scan_path)

    if img is None:
        return _empty_result(scan_path)

    try:
        text = pytesseract.image_to_string(
            img,
            lang="lit",
            config="--oem 3 --psm 6",
        )
    except pytesseract.TesseractNotFoundError:
        print("OCR skipped: tesseract is not installed or not in PATH.")
        return _empty_result(scan_path)
    except pytesseract.TesseractError as exc:
        print("OCR skipped:", exc)
        return _empty_result(scan_path)

    print("\n=== OCR RAW ===")
    print(text)

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    items = []
    discounts = []
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
        "depozit",
        "taros",
        "barkod",
        "sutaup",
        "maximos pinig",
    ]
    total_words = ["kvito suma", "mokėtina suma", "moketina suma", "iš viso", "is viso"]
    discount_words = ["nuolaid", "suteiktos naudos", "ačiū", "aciu"]

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
        "receipt_total": receipt_total,
        "scan_path": scan_path,
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
