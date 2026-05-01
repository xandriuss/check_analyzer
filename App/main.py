import os
import re
import shutil
import json
import unicodedata
from difflib import SequenceMatcher
from uuid import uuid4
from pathlib import Path
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from passlib.hash import bcrypt
from pydantic import BaseModel
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"

if load_dotenv:
    load_dotenv(BASE_DIR / ".env")

from auth import create_token, get_current_user_id
from database import Base, SessionLocal, engine
from junkanalyzer import analyze_junk, is_junk
from models import BugReport, Item, Receipt, User
from textdet import ai_parse_receipt, fix_quantity_errors, ocr_parse_receipt


class RegisterRequest(BaseModel):
    email: str
    password: str
    mode: str = "person"
    display_name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class SettingsRequest(BaseModel):
    dark_mode: bool | None = None
    junk_exclusions: list[str] | None = None


class BugReportRequest(BaseModel):
    title: str
    description: str


class ResetDataRequest(BaseModel):
    confirmation: str


class RevenueCatRefreshRequest(BaseModel):
    app_user_id: str


FREE_WEEKLY_LIMIT = 3
DAILY_REWARDED_AD_LIMIT = 3
BCRYPT_MAX_BYTES = 72
SUBSCRIPTION_PROVIDER = os.getenv("SUBSCRIPTION_PROVIDER", "demo")
REVENUECAT_SECRET_KEY = os.getenv("REVENUECAT_SECRET_KEY", "")
REVENUECAT_ENTITLEMENT_ID = os.getenv("REVENUECAT_ENTITLEMENT_ID", "pro")
REVENUECAT_APP_USER_ID_PREFIX = os.getenv("REVENUECAT_APP_USER_ID_PREFIX", "receipt_lens_user_")
SUBSCRIPTION_MONTHLY_PRODUCT_ID = os.getenv(
    "SUBSCRIPTION_MONTHLY_PRODUCT_ID",
    "receipt_lens_pro_monthly",
)
SUBSCRIPTION_ANNUAL_PRODUCT_ID = os.getenv(
    "SUBSCRIPTION_ANNUAL_PRODUCT_ID",
    "receipt_lens_pro_annual",
)
SUBSCRIPTION_MONTHLY_PRICE_LABEL = os.getenv(
    "SUBSCRIPTION_MONTHLY_PRICE_LABEL",
    "Monthly price placeholder",
)
SUBSCRIPTION_ANNUAL_PRICE_LABEL = os.getenv(
    "SUBSCRIPTION_ANNUAL_PRICE_LABEL",
    "Annual price placeholder",
)


app = FastAPI(title="Receipt Junk Analyzer")
allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

Base.metadata.create_all(bind=engine)


def migrate_sqlite():
    if not engine.url.drivername.startswith("sqlite"):
        return

    with engine.begin() as connection:
        user_columns = [row[1] for row in connection.exec_driver_sql("PRAGMA table_info(users)")]
        receipt_columns = [row[1] for row in connection.exec_driver_sql("PRAGMA table_info(receipts)")]

        if "mode" not in user_columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN mode VARCHAR DEFAULT 'person'")
        if "display_name" not in user_columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN display_name VARCHAR")
        if "role" not in user_columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN role VARCHAR DEFAULT 'user'")
        if "is_subscriber" not in user_columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN is_subscriber INTEGER DEFAULT 0")
        if "dark_mode" not in user_columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN dark_mode INTEGER DEFAULT 0")
        if "junk_exclusions" not in user_columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN junk_exclusions TEXT DEFAULT '[]'")
        if "bonus_scan_credits" not in user_columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN bonus_scan_credits INTEGER DEFAULT 0")
        if "rewarded_ads_used" not in user_columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN rewarded_ads_used INTEGER DEFAULT 0")
        if "rewarded_ads_reset_at" not in user_columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN rewarded_ads_reset_at DATETIME")
        if "photo_path" not in receipt_columns:
            connection.exec_driver_sql("ALTER TABLE receipts ADD COLUMN photo_path VARCHAR")
        if "scan_path" not in receipt_columns:
            connection.exec_driver_sql("ALTER TABLE receipts ADD COLUMN scan_path VARCHAR")
        if "created_at" not in receipt_columns:
            connection.exec_driver_sql("ALTER TABLE receipts ADD COLUMN created_at DATETIME")
            connection.exec_driver_sql("UPDATE receipts SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL")


def migrate_receipt_debug_columns():
    columns = [column["name"] for column in inspect(engine).get_columns("receipts")]

    with engine.begin() as connection:
        if "ai_output" not in columns:
            connection.exec_driver_sql("ALTER TABLE receipts ADD COLUMN ai_output TEXT")
        if "ocr_output" not in columns:
            connection.exec_driver_sql("ALTER TABLE receipts ADD COLUMN ocr_output TEXT")


migrate_sqlite()
migrate_receipt_debug_columns()


def trim_bcrypt_password(password):
    encoded = password.encode("utf-8")
    if len(encoded) <= BCRYPT_MAX_BYTES:
        return password

    return encoded[:BCRYPT_MAX_BYTES].decode("utf-8", errors="ignore")


def seed_admin_user():
    admin_email = os.getenv("ADMIN_EMAIL")
    admin_password = os.getenv("ADMIN_PASSWORD")
    if not admin_email or not admin_password:
        return
    admin_password = trim_bcrypt_password(admin_password)

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == admin_email).first()
        if user:
            user.role = "admin"
            db.commit()
            return

        db.add(
            User(
                email=admin_email,
                password=bcrypt.hash(admin_password),
                role="admin",
                mode="person",
                display_name="Developer",
                is_subscriber=1,
            )
        )
        db.commit()
    finally:
        db.close()

seed_admin_user()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/subscription-config")
def subscription_config():
    return {
        "provider": SUBSCRIPTION_PROVIDER,
        "mode": "demo" if SUBSCRIPTION_PROVIDER == "demo" else "store",
        "revenuecat": {
            "entitlement_id": REVENUECAT_ENTITLEMENT_ID,
            "app_user_id_prefix": REVENUECAT_APP_USER_ID_PREFIX,
        },
        "plans": [
            {
                "period": "monthly",
                "product_id": SUBSCRIPTION_MONTHLY_PRODUCT_ID,
                "price_label": SUBSCRIPTION_MONTHLY_PRICE_LABEL,
            },
            {
                "period": "annual",
                "product_id": SUBSCRIPTION_ANNUAL_PRODUCT_ID,
                "price_label": SUBSCRIPTION_ANNUAL_PRICE_LABEL,
            },
        ],
    }


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def serialize_user(user: User):
    return {
        "id": user.id,
        "email": user.email,
        "mode": user.mode or "person",
        "display_name": user.display_name,
        "role": user.role or "user",
        "is_subscriber": bool(user.is_subscriber),
        "dark_mode": bool(user.dark_mode),
        "junk_exclusions": parse_user_exclusions(user),
        "bonus_scan_credits": user.bonus_scan_credits or 0,
    }


def revenuecat_app_user_id(user: User):
    return f"{REVENUECAT_APP_USER_ID_PREFIX}{user.id}"


def fetch_revenuecat_subscriber(app_user_id: str):
    if not REVENUECAT_SECRET_KEY:
        raise HTTPException(status_code=503, detail="RevenueCat server key is not configured.")

    request = Request(
        f"https://api.revenuecat.com/v1/subscribers/{quote(app_user_id, safe='')}",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {REVENUECAT_SECRET_KEY}",
        },
    )

    try:
        with urlopen(request, timeout=12) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"RevenueCat verification failed with status {exc.code}.",
        )
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail=f"RevenueCat verification failed: {exc}")


def parse_revenuecat_date(value):
    if not value:
        return None

    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def revenuecat_entitlement_is_active(subscriber_payload):
    subscriber = subscriber_payload.get("subscriber", {}) if isinstance(subscriber_payload, dict) else {}
    entitlements = subscriber.get("entitlements", {}) if isinstance(subscriber, dict) else {}
    entitlement = entitlements.get(REVENUECAT_ENTITLEMENT_ID) if isinstance(entitlements, dict) else None
    if not entitlement:
        return False

    expires_at = parse_revenuecat_date(entitlement.get("expires_date"))
    if expires_at is None:
        return True

    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    return expires_at > now


def parse_user_exclusions(user: User):
    try:
        value = json.loads(user.junk_exclusions or "[]")
    except json.JSONDecodeError:
        return []

    if not isinstance(value, list):
        return []

    return [str(item).strip() for item in value if str(item).strip()]


def is_excluded_junk(product_name, exclusions):
    product = product_name.lower()
    return any(term.lower() in product for term in exclusions)


def get_current_user(
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def require_admin(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def normalize_scan_data(data):
    if isinstance(data, list):
        return {
            "items": data,
            "discounts": [],
            "deposits": [],
            "receipt_total": None,
            "scan_path": None,
            "raw_ai_output": None,
            "raw_ocr_output": None,
        }

    if not isinstance(data, dict):
        return {
            "items": [],
            "discounts": [],
            "deposits": [],
            "receipt_total": None,
            "scan_path": None,
            "raw_ai_output": None,
            "raw_ocr_output": None,
        }

    data.setdefault("items", [])
    data.setdefault("discounts", [])
    data.setdefault("deposits", [])
    data.setdefault("receipt_total", None)
    data.setdefault("scan_path", None)
    data.setdefault("raw_ai_output", None)
    data.setdefault("raw_ocr_output", None)
    return data


def parse_pairs(items):
    pairs = []

    for item in items:
        try:
            name = str(item.get("name", "")).strip()
            price = float(item.get("final_price", 0))
        except (TypeError, ValueError):
            continue

        if name and price > 0:
            pairs.append((name, f"{price:.2f}"))

    return fix_quantity_errors(pairs)


def parse_deposits(deposit_items):
    deposits = []

    for item in deposit_items:
        try:
            name = str(item.get("name", "Depozitas")).strip() or "Depozitas"
            amount = float(item.get("amount", item.get("final_price", 0)))
        except (TypeError, ValueError):
            continue

        if name and amount > 0:
            deposits.append((name, f"{amount:.2f}"))

    return deposits


def parse_discounts(discount_items):
    discounts = []

    for discount in discount_items:
        try:
            name = str(discount.get("name", "Nuolaida")).strip() or "Nuolaida"
            amount = float(discount.get("amount", 0))
        except (TypeError, ValueError):
            continue

        if amount > 0:
            amount = -amount
        if amount:
            discounts.append((name, f"{amount:.2f}"))

    return discounts


def normalize_match_text(value):
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(char for char in normalized if not unicodedata.combining(char)).lower()


def is_deposit_item(name):
    low = normalize_match_text(name)
    return (
        "depozit" in low
        or "depozitas/imoka" in low
        or "depozitas imoka" in low
        or "skardin" in low
        or bool(re.search(r"\bpet\b", low))
    )


def is_deposit_summary_item(name):
    low = normalize_match_text(name)
    return (
        "depozitas/imoka" in low
        or "depozitas imoka" in low
        or (low.strip().startswith("depozit") and "pet" not in low and "skardin" not in low)
    )


def collapse_deposit_pairs(pairs):
    deposit_indexes = [index for index, (name, _) in enumerate(pairs) if is_deposit_item(name)]
    summary_indexes = [index for index in deposit_indexes if is_deposit_summary_item(pairs[index][0])]
    if not summary_indexes:
        return pairs

    summary_index = max(summary_indexes, key=lambda index: float(pairs[index][1]))
    summary_value = round(float(pairs[summary_index][1]), 2)
    item_deposit_total = round(
        sum(float(pairs[index][1]) for index in deposit_indexes if index != summary_index),
        2,
    )

    if item_deposit_total > 0 and abs(item_deposit_total - summary_value) <= 0.05:
        return [pair for index, pair in enumerate(pairs) if index != summary_index]

    return [
        pair
        for index, pair in enumerate(pairs)
        if index == summary_index or not is_deposit_item(pair[0])
    ]


def merge_deposit_pairs(pairs, deposit_pairs):
    merged = []
    seen = set()

    for name, price in [*pairs, *deposit_pairs]:
        key = (normalize_match_text(name), round(float(price), 2))
        if key in seen:
            continue
        seen.add(key)
        merged.append((name, price))

    return collapse_deposit_pairs(fix_quantity_errors(merged))


def extract_deposit_pairs(pairs):
    return [(name, price) for name, price in pairs if is_deposit_item(name)]


def deposit_total_from_pairs(pairs):
    return round(
        sum(float(price) for name, price in collapse_deposit_pairs(pairs) if is_deposit_item(name)),
        2,
    )


def is_generic_discount_name(name):
    low = normalize_match_text(name)
    generic_words = [
        "nuolaidos",
        "suteiktos naudos",
        "sutaup",
        "ačiū nuolaidos",
        "aciu nuolaidos",
    ]
    product_hint_words = ["prekei", "prekė", "preke", ":", "cola", "alus", "gumin", "trašku"]
    return any(word in low for word in generic_words) and not any(word in low for word in product_hint_words)


def discount_product_text(name):
    text = normalize_match_text(name)
    for value in ["aciu", "nuolaida", "nuolaidos", "prekei", "preke"]:
        text = text.replace(value, " ")
    return " ".join(part for part in text.split() if not any(char.isdigit() for char in part))


def is_same_discount_product(left_name, right_name):
    left = discount_product_text(left_name)
    right = discount_product_text(right_name)
    if not left or not right:
        return False

    left_tokens = {token for token in left.split() if len(token) >= 4}
    right_tokens = {token for token in right.split() if len(token) >= 4}
    shared_tokens = left_tokens & right_tokens
    brand_overlap = any(token in shared_tokens for token in {"cola", "coca", "alus", "guminukai", "taffel"})
    similarity = SequenceMatcher(None, left, right).ratio()
    return brand_overlap or similarity >= 0.58


def discount_targets_junk_item(discount_name, junk_items):
    if is_junk(discount_name):
        return True
    return any(is_same_discount_product(discount_name, item_name) for item_name, _ in junk_items)


def remove_duplicate_discounts(discounts):
    unique = []
    seen = set()

    for name, amount in discounts:
        rounded_amount = round(float(amount), 2)
        key = (normalize_match_text(name), rounded_amount)
        if key in seen:
            continue
        if any(
            round(float(existing_amount), 2) == rounded_amount
            and not is_generic_discount_name(existing_name)
            and not is_generic_discount_name(name)
            and is_same_discount_product(existing_name, name)
            for existing_name, existing_amount in unique
        ):
            continue
        seen.add(key)
        unique.append((name, f"{rounded_amount:.2f}"))

    specific_amounts = {
        round(float(amount), 2)
        for name, amount in unique
        if not is_generic_discount_name(name)
    }
    specific_total = round(
        sum(float(amount) for name, amount in unique if not is_generic_discount_name(name)),
        2,
    )

    cleaned = []
    for name, amount in unique:
        rounded_amount = round(float(amount), 2)
        if is_generic_discount_name(name) and (
            rounded_amount in specific_amounts or rounded_amount == specific_total
        ):
            continue
        cleaned.append((name, f"{rounded_amount:.2f}"))

    return cleaned


def merge_specific_ocr_discounts(discounts, ocr_discounts):
    if not discounts or not ocr_discounts:
        return remove_duplicate_discounts(discounts)

    merged = []
    used_ocr_indexes = set()

    for name, amount in discounts:
        replacement = None
        current_amount = round(float(amount), 2)

        if is_generic_discount_name(name):
            for index, (ocr_name, ocr_amount) in enumerate(ocr_discounts):
                if index in used_ocr_indexes:
                    continue

                if round(float(ocr_amount), 2) != current_amount:
                    continue

                if not is_generic_discount_name(ocr_name):
                    replacement = (ocr_name, ocr_amount)
                    used_ocr_indexes.add(index)
                    break

        merged.append(replacement or (name, amount))

    return remove_duplicate_discounts(merged)


def parse_receipt_total(value):
    try:
        total = round(float(value), 2)
    except (TypeError, ValueError):
        return None

    return total if total > 0 else None


def calculated_scan_total(pairs, discounts):
    return round(
        sum(float(price) for _, price in pairs) + sum(float(amount) for _, amount in discounts),
        2,
    )


def scan_total_delta(pairs, discounts, receipt_total):
    if receipt_total is None:
        return None
    return round(calculated_scan_total(pairs, discounts) - receipt_total, 2)


def is_likely_missing_deposit_delta(delta):
    if delta is None or delta >= 0:
        return False

    absolute_delta = abs(delta)
    if absolute_delta < 0.08 or absolute_delta > 1.2:
        return False

    nearest_tenth = round(absolute_delta * 10) / 10
    return abs(absolute_delta - nearest_tenth) <= 0.025


def scan_total_matches_receipt(pairs, discounts, receipt_total):
    delta = scan_total_delta(pairs, discounts, receipt_total)
    if delta is None:
        return False

    tolerance = max(0.12, receipt_total * 0.002)
    return abs(delta) <= tolerance or is_likely_missing_deposit_delta(delta)


def scan_needs_ocr_support(pairs, discounts, receipt_total):
    if receipt_total is None:
        return False

    delta = scan_total_delta(pairs, discounts, receipt_total)
    if not scan_total_matches_receipt(pairs, discounts, receipt_total):
        return True

    return bool(is_likely_missing_deposit_delta(delta) and not extract_deposit_pairs(pairs))


def add_inferred_deposit_pair(pairs, discounts, receipt_total):
    delta = scan_total_delta(pairs, discounts, receipt_total)
    if not is_likely_missing_deposit_delta(delta) or extract_deposit_pairs(pairs):
        return pairs

    deposit_value = abs(delta)
    return merge_deposit_pairs(pairs, [("Depozitas", f"{deposit_value:.2f}")])


def item_price_is_reasonable(ai_price, ocr_price):
    if ocr_price <= 0:
        return False

    max_delta = max(1.0, abs(ai_price) * 0.35)
    return abs(ai_price - ocr_price) <= max_delta


def choose_corrected_item_name(ai_name, ocr_name):
    if not ocr_name or len(ocr_name) > max(len(ai_name) * 1.5, 48):
        return ai_name

    similarity = SequenceMatcher(None, normalize_match_text(ai_name), normalize_match_text(ocr_name)).ratio()
    return ocr_name if similarity >= 0.58 else ai_name


def merge_ocr_item_prices(pairs, discounts, receipt_total, ocr_pairs):
    if receipt_total is None or not pairs or not ocr_pairs:
        return pairs

    merged = [(name, price) for name, price in pairs]
    unused_ocr_indexes = set(range(len(ocr_pairs)))
    current_delta = abs(scan_total_delta(merged, discounts, receipt_total) or 0)

    while current_delta > 0.08:
        best = None

        for item_index, (ai_name, ai_price_text) in enumerate(merged):
            ai_price = float(ai_price_text)

            for ocr_index in unused_ocr_indexes:
                ocr_name, ocr_price_text = ocr_pairs[ocr_index]
                ocr_price = float(ocr_price_text)

                if not item_price_is_reasonable(ai_price, ocr_price):
                    continue
                if not is_same_discount_product(ai_name, ocr_name):
                    continue

                trial = list(merged)
                trial[item_index] = (
                    choose_corrected_item_name(ai_name, ocr_name),
                    f"{ocr_price:.2f}",
                )
                trial_delta = abs(scan_total_delta(trial, discounts, receipt_total) or 0)

                if trial_delta + 0.025 < current_delta and (best is None or trial_delta < best["delta"]):
                    best = {
                        "item_index": item_index,
                        "ocr_index": ocr_index,
                        "name": trial[item_index][0],
                        "price": trial[item_index][1],
                        "delta": trial_delta,
                    }

        if not best:
            break

        merged[best["item_index"]] = (best["name"], best["price"])
        unused_ocr_indexes.remove(best["ocr_index"])
        current_delta = best["delta"]

    return fix_quantity_errors(merged)


def merge_missing_deposit_pairs(pairs, ocr_pairs):
    return merge_deposit_pairs(pairs, extract_deposit_pairs(ocr_pairs))


def has_repeated_price_hallucination(pairs):
    if len(pairs) < 5:
        return False

    prices = [round(float(price), 2) for _, price in pairs]
    most_common_count = max(prices.count(price) for price in set(prices))
    return most_common_count >= 4 and most_common_count / len(prices) >= 0.6


def scan_result_is_plausible(pairs, discounts, receipt_total):
    if not pairs:
        return False

    if has_repeated_price_hallucination(pairs):
        return False

    calculated = calculated_scan_total(pairs, discounts)
    if calculated <= 0:
        return False

    if receipt_total and receipt_total > 0:
        if calculated > receipt_total * 2.2 and calculated - receipt_total > 12:
            return False
        if calculated < receipt_total * 0.25 and receipt_total - calculated > 12:
            return False

    return True


def waste_percent(total, junk_total, neutral_total=0):
    spending_total = max(float(total or 0) - float(neutral_total or 0), 0)
    if not spending_total:
        return 0
    return round((junk_total / spending_total) * 100, 1)


def receipt_junk_total_from_items(receipt: Receipt):
    if not receipt.items:
        return round(max(float(receipt.junk_total or 0), 0), 2)

    junk_total = round(
        sum(float(item.price or 0) for item in receipt.items if item.is_junk),
        2,
    )
    junk_total = max(junk_total, 0)
    if receipt.total and receipt.total > 0:
        junk_total = min(junk_total, float(receipt.total))
    return round(junk_total, 2)


def receipt_deposit_total_from_items(receipt: Receipt):
    if not receipt.items:
        return 0

    deposit_pairs = [
        (item.name, f"{float(item.price or 0):.2f}")
        for item in receipt.items
        if item.price and item.price > 0 and is_deposit_item(item.name)
    ]
    return deposit_total_from_pairs(deposit_pairs)


def useful_total(total, junk_total, deposit_total):
    return round(max(float(total or 0) - float(junk_total or 0) - float(deposit_total or 0), 0), 2)


def weekly_scan_count(user: User, db: Session):
    since = datetime.utcnow() - timedelta(days=7)
    return (
        db.query(Receipt)
        .filter(Receipt.user_id == user.id)
        .filter(Receipt.created_at >= since)
        .count()
    )


def refresh_reward_window(user: User, db: Session):
    now = datetime.utcnow()
    if not user.rewarded_ads_reset_at or user.rewarded_ads_reset_at <= now:
        user.rewarded_ads_used = 0
        user.rewarded_ads_reset_at = None
        db.commit()
        db.refresh(user)


def usage_payload(user: User, db: Session):
    refresh_reward_window(user, db)
    used = weekly_scan_count(user, db)
    remaining_base = max(FREE_WEEKLY_LIMIT - used, 0)

    return {
        "is_subscriber": bool(user.is_subscriber),
        "weekly_limit": None if user.is_subscriber else FREE_WEEKLY_LIMIT,
        "weekly_used": used,
        "weekly_remaining": None if user.is_subscriber else remaining_base,
        "bonus_scan_credits": 999999 if user.is_subscriber else (user.bonus_scan_credits or 0),
        "rewarded_ads_remaining": 0 if user.is_subscriber else max(DAILY_REWARDED_AD_LIMIT - (user.rewarded_ads_used or 0), 0),
        "rewarded_ads_limit": 0 if user.is_subscriber else DAILY_REWARDED_AD_LIMIT,
        "rewarded_ads_reset_at": user.rewarded_ads_reset_at,
    }


@app.post("/register")
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    mode = payload.mode if payload.mode in {"person", "family"} else "person"
    user = User(
        email=payload.email,
        password=bcrypt.hash(trim_bcrypt_password(payload.password)),
        mode=mode,
        display_name=payload.display_name,
    )
    db.add(user)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email is already registered")

    db.refresh(user)
    return {"token": create_token(user.id), "user": serialize_user(user)}


@app.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()

    if not user or not bcrypt.verify(trim_bcrypt_password(payload.password), user.password):
        raise HTTPException(status_code=401, detail="Bad login")

    return {"token": create_token(user.id), "user": serialize_user(user)}


@app.get("/me")
def me(
    user: User = Depends(get_current_user),
):
    return serialize_user(user)


@app.get("/settings")
def get_settings(user: User = Depends(get_current_user)):
    return {
        "dark_mode": bool(user.dark_mode),
        "junk_exclusions": parse_user_exclusions(user),
        "warning": "Removing junk-food terms can make the app less useful for saving money.",
    }


@app.put("/settings")
def update_settings(payload: SettingsRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.dark_mode is not None:
        user.dark_mode = 1 if payload.dark_mode else 0

    if payload.junk_exclusions is not None:
        cleaned = sorted({item.strip() for item in payload.junk_exclusions if item.strip()})
        user.junk_exclusions = json.dumps(cleaned, ensure_ascii=False)

    db.commit()
    db.refresh(user)
    return serialize_user(user)


@app.post("/subscribe-demo")
def subscribe_demo(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if SUBSCRIPTION_PROVIDER != "demo":
        raise HTTPException(status_code=403, detail="Demo subscription unlock is disabled in store billing mode.")

    user.is_subscriber = 1
    db.commit()
    db.refresh(user)
    return serialize_user(user)


@app.post("/subscription/revenuecat/refresh")
def refresh_revenuecat_subscription(
    payload: RevenueCatRefreshRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if SUBSCRIPTION_PROVIDER != "revenuecat":
        raise HTTPException(status_code=400, detail="RevenueCat billing is not enabled.")

    expected_app_user_id = revenuecat_app_user_id(user)
    if payload.app_user_id != expected_app_user_id:
        raise HTTPException(status_code=403, detail="Subscription user id does not match this account.")

    subscriber_payload = fetch_revenuecat_subscriber(payload.app_user_id)
    is_active = revenuecat_entitlement_is_active(subscriber_payload)

    if user.role == "admin":
        user.is_subscriber = 1
    else:
        user.is_subscriber = 1 if is_active else 0

    db.commit()
    db.refresh(user)
    return serialize_user(user)


@app.get("/usage")
def get_usage(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return usage_payload(user, db)


@app.post("/rewarded-ad/complete")
def complete_rewarded_ad(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.is_subscriber:
        return usage_payload(user, db)

    refresh_reward_window(user, db)
    if (user.rewarded_ads_used or 0) >= DAILY_REWARDED_AD_LIMIT:
        raise HTTPException(status_code=429, detail="Daily rewarded scan limit reached.")

    user.rewarded_ads_used = (user.rewarded_ads_used or 0) + 1
    user.bonus_scan_credits = (user.bonus_scan_credits or 0) + 1
    if not user.rewarded_ads_reset_at:
        user.rewarded_ads_reset_at = datetime.utcnow() + timedelta(hours=24)

    db.commit()
    db.refresh(user)
    return usage_payload(user, db)


@app.post("/upload")
async def upload(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        using_bonus_credit = False
        if not user.is_subscriber and weekly_scan_count(user, db) >= FREE_WEEKLY_LIMIT:
            if (user.bonus_scan_credits or 0) <= 0:
                raise HTTPException(
                    status_code=429,
                    detail="Free weekly scan limit reached. Watch a rewarded ad or subscribe for more weekly operations.",
                )
            using_bonus_credit = True

        extension = os.path.splitext(file.filename or "receipt.jpg")[1] or ".jpg"
        filename = f"{uuid4().hex}{extension}"
        path = UPLOAD_DIR / filename

        with open(path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        data = normalize_scan_data(ai_parse_receipt(str(path)))
        ocr_data = None
        ai_output = data.get("raw_ai_output")
        ocr_output = "OCR skipped: AI result was reliable enough."

        def get_ocr_data():
            nonlocal ocr_data, ocr_output
            if ocr_data is None:
                ocr_data = normalize_scan_data(ocr_parse_receipt(str(path)))
                ocr_output = ocr_data.get("raw_ocr_output")
            return ocr_data

        pairs = merge_deposit_pairs(
            parse_pairs(data.get("items", [])),
            parse_deposits(data.get("deposits", [])),
        )
        discounts = remove_duplicate_discounts(parse_discounts(data.get("discounts", [])))
        receipt_total = parse_receipt_total(data.get("receipt_total"))
        pairs = add_inferred_deposit_pair(pairs, discounts, receipt_total)

        if not scan_result_is_plausible(pairs, discounts, receipt_total):
            fallback_data = get_ocr_data()
            ocr_pairs = merge_deposit_pairs(
                parse_pairs(fallback_data.get("items", [])),
                parse_deposits(fallback_data.get("deposits", [])),
            )
            ocr_discounts = remove_duplicate_discounts(parse_discounts(fallback_data.get("discounts", [])))
            ocr_receipt_total = parse_receipt_total(fallback_data.get("receipt_total"))
            ocr_pairs = add_inferred_deposit_pair(ocr_pairs, ocr_discounts, ocr_receipt_total)

            if scan_result_is_plausible(ocr_pairs, ocr_discounts, ocr_receipt_total):
                data = fallback_data
                pairs = ocr_pairs
                discounts = ocr_discounts
                receipt_total = ocr_receipt_total
            else:
                raise HTTPException(
                    status_code=422,
                    detail="Receipt totals did not look reliable. Try a clearer photo inside the guide.",
                )
        elif scan_needs_ocr_support(pairs, discounts, receipt_total):
            fallback_data = get_ocr_data()
            ocr_pairs = merge_deposit_pairs(
                parse_pairs(fallback_data.get("items", [])),
                parse_deposits(fallback_data.get("deposits", [])),
            )
            ocr_discounts = remove_duplicate_discounts(parse_discounts(fallback_data.get("discounts", [])))
            ocr_receipt_total = parse_receipt_total(fallback_data.get("receipt_total"))
            ocr_pairs = add_inferred_deposit_pair(ocr_pairs, ocr_discounts, ocr_receipt_total)

            if not discounts:
                discounts = ocr_discounts
            if receipt_total is None:
                receipt_total = ocr_receipt_total

            pairs = merge_missing_deposit_pairs(pairs, ocr_pairs)
            pairs = merge_ocr_item_prices(pairs, discounts, receipt_total, ocr_pairs)

        discounts = remove_duplicate_discounts(discounts)

        exclusions = parse_user_exclusions(user)
        filtered_pairs_for_junk = [
            (name, price)
            for name, price in pairs
            if not is_deposit_item(name) and not is_excluded_junk(name, exclusions)
        ]
        junk_items, junk_total = analyze_junk(filtered_pairs_for_junk)
        junk_lookup = set(junk_items)
        junk_discount_items = []
        junk_discount_total = 0.0

        for name, amount in discounts:
            if is_excluded_junk(name, exclusions):
                continue

            discount_value = float(amount)
            if discount_value >= 0:
                continue

            if discount_targets_junk_item(name, junk_items):
                junk_discount_total += discount_value
                junk_discount_items.append((name, f"{discount_value:.2f}"))

        junk_total = round(max(junk_total + junk_discount_total, 0), 2)
        calculated_total = calculated_scan_total(pairs, discounts)
        total = receipt_total if receipt_total and receipt_total > 0 else calculated_total
        junk_total = min(junk_total, total)
        deposit_total = deposit_total_from_pairs(pairs)
        useful_spending_total = useful_total(total, junk_total, deposit_total)
        scan_path = data.get("scan_path")
        if not scan_path and ocr_data:
            scan_path = ocr_data.get("scan_path")
        scan_relative_path = None
        if scan_path:
            scan_relative_path = f"uploads/{Path(scan_path).name}"

        receipt = Receipt(
            user_id=user.id,
            total=total,
            junk_total=junk_total,
            photo_path=f"uploads/{filename}",
            scan_path=scan_relative_path,
            ai_output=ai_output,
            ocr_output=ocr_output,
        )
        db.add(receipt)
        db.flush()

        if using_bonus_credit:
            user.bonus_scan_credits = max((user.bonus_scan_credits or 0) - 1, 0)
            db.add(user)

        for name, price in pairs:
            db.add(
                Item(
                    receipt_id=receipt.id,
                    name=name,
                    price=float(price),
                    is_junk=1 if (name, price) in junk_lookup else 0,
                )
            )

        for name, amount in discounts:
            discount_is_junk = discount_targets_junk_item(name, junk_items)
            db.add(
                Item(
                    receipt_id=receipt.id,
                    name=name,
                    price=float(amount),
                    is_junk=1 if discount_is_junk else 0,
                )
            )

        db.commit()
        db.refresh(receipt)

        return {
            "id": receipt.id,
            "total": total,
            "junk_total": junk_total,
            "deposit_total": deposit_total,
            "useful_total": useful_spending_total,
            "waste_percent": waste_percent(total, junk_total, deposit_total),
            "photo_url": f"/uploads/{filename}",
            "scan_url": f"/{scan_relative_path}" if scan_relative_path else None,
            "ai_output": ai_output,
            "ocr_output": ocr_output,
            "discounts": [
                {
                    "name": name,
                    "amount": float(amount),
                    "is_junk": discount_targets_junk_item(name, junk_items),
                }
                for name, amount in discounts
            ],
            "items": [
                {
                    "name": name,
                    "price": float(price),
                    "is_junk": (name, price) in junk_lookup,
                }
                for name, price in pairs
            ],
        }

    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        return JSONResponse({"error": str(exc)}, status_code=500)


def serialize_receipt(receipt: Receipt):
    computed_junk_total = receipt_junk_total_from_items(receipt)
    computed_deposit_total = receipt_deposit_total_from_items(receipt)
    computed_useful_total = useful_total(receipt.total, computed_junk_total, computed_deposit_total)
    return {
        "id": receipt.id,
        "date": receipt.created_at,
        "total": receipt.total,
        "junk_total": computed_junk_total,
        "deposit_total": computed_deposit_total,
        "useful_total": computed_useful_total,
        "waste_percent": waste_percent(receipt.total, computed_junk_total, computed_deposit_total),
        "photo_url": f"/{receipt.photo_path}" if receipt.photo_path else None,
        "scan_url": f"/{receipt.scan_path}" if receipt.scan_path else None,
        "ai_output": receipt.ai_output,
        "ocr_output": receipt.ocr_output,
        "items": [
            {
                "name": item.name,
                "price": item.price,
                "is_junk": bool(item.is_junk),
            }
            for item in receipt.items
        ],
    }


@app.get("/receipts")
def get_receipts(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    receipts = (
        db.query(Receipt)
        .filter(Receipt.user_id == user.id)
        .order_by(Receipt.created_at.desc())
        .all()
    )

    return [serialize_receipt(receipt) for receipt in receipts]


@app.get("/subscription-summary")
def subscription_summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    receipts = db.query(Receipt).filter(Receipt.user_id == user.id).all()
    total = round(sum(receipt.total or 0 for receipt in receipts), 2)
    junk_total = round(sum(receipt_junk_total_from_items(receipt) for receipt in receipts), 2)
    deposit_total = round(sum(receipt_deposit_total_from_items(receipt) for receipt in receipts), 2)
    useful_spending_total = useful_total(total, junk_total, deposit_total)
    total_waste_percent = waste_percent(total, junk_total, deposit_total)

    if not user.is_subscriber:
        return {
            "locked": True,
            "total": total,
            "junk_total": junk_total,
            "deposit_total": deposit_total,
            "useful_total": useful_spending_total,
            "waste_percent": total_waste_percent,
        }

    since = datetime.utcnow() - timedelta(days=30)
    monthly_receipts = [receipt for receipt in receipts if receipt.created_at and receipt.created_at >= since]
    monthly_total = round(sum(receipt.total or 0 for receipt in monthly_receipts), 2)
    monthly_junk = round(sum(receipt_junk_total_from_items(receipt) for receipt in monthly_receipts), 2)
    monthly_deposit = round(sum(receipt_deposit_total_from_items(receipt) for receipt in monthly_receipts), 2)
    monthly_useful = useful_total(monthly_total, monthly_junk, monthly_deposit)

    return {
        "locked": False,
        "total": total,
        "junk_total": junk_total,
        "deposit_total": deposit_total,
        "useful_total": useful_spending_total,
        "waste_percent": total_waste_percent,
        "monthly_total": monthly_total,
        "monthly_junk_total": monthly_junk,
        "monthly_deposit_total": monthly_deposit,
        "monthly_useful_total": monthly_useful,
        "monthly_waste_percent": waste_percent(monthly_total, monthly_junk, monthly_deposit),
    }


@app.post("/bug-reports")
def create_bug_report(
    payload: BugReportRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    report = BugReport(
        user_id=user.id,
        title=payload.title.strip(),
        description=payload.description.strip(),
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return {"id": report.id, "status": report.status}


@app.get("/bug-reports")
def list_bug_reports(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return [
        {
            "id": report.id,
            "user_id": report.user_id,
            "user_email": report.user.email if report.user else None,
            "user_name": report.user.display_name if report.user else None,
            "title": report.title,
            "description": report.description,
            "status": report.status,
            "created_at": report.created_at,
        }
        for report in db.query(BugReport).order_by(BugReport.created_at.desc()).all()
    ]


@app.post("/admin/reset-data")
def reset_data(
    payload: ResetDataRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if payload.confirmation != "RESET":
        raise HTTPException(status_code=400, detail="Type RESET to confirm data deletion.")

    db.query(Item).delete()
    db.query(Receipt).delete()
    db.query(BugReport).delete()
    db.query(User).filter(User.id != admin.id).delete()
    admin.is_subscriber = 1
    admin.role = "admin"
    admin.bonus_scan_credits = 0
    admin.rewarded_ads_used = 0
    admin.rewarded_ads_reset_at = None
    db.commit()
    return {"status": "reset", "admin_user_id": admin.id}
