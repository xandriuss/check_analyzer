import re
import unicodedata

from list import junk_brands, junk_words


OCR_REPLACEMENTS = {
    "0": "o",
    "1": "i",
    "|": "i",
    "€": "e",
}


def normalize(text):
    text = text.lower()

    for old, new in OCR_REPLACEMENTS.items():
        text = text.replace(old, new)

    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    return text


def is_junk(product_name):
    name = f" {normalize(product_name)} "

    for word in junk_words:
        normalized_word = normalize(word)
        if normalized_word and f" {normalized_word} " in name:
            return True

    for category in junk_brands.values():
        for brand in category:
            normalized_brand = normalize(brand)
            if normalized_brand and f" {normalized_brand} " in name:
                return True

    return False


def analyze_junk(pairs):
    junk_items = []
    total = 0.0

    for name, price in pairs:
        if not is_junk(name):
            continue

        try:
            val = float(price)
        except (TypeError, ValueError):
            continue

        if val < 0:
            continue

        total += val
        junk_items.append((name, f"{val:.2f}"))

    return junk_items, round(total, 2)
