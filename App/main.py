import os
import shutil
import json
import unicodedata
from difflib import SequenceMatcher
from uuid import uuid4
from pathlib import Path
from datetime import datetime, timedelta

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


FREE_WEEKLY_LIMIT = 3
DAILY_REWARDED_AD_LIMIT = 3
BCRYPT_MAX_BYTES = 72
SUBSCRIPTION_PROVIDER = os.getenv("SUBSCRIPTION_PROVIDER", "demo")
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


migrate_sqlite()


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
        return {"items": data, "discounts": [], "receipt_total": None, "scan_path": None}

    if not isinstance(data, dict):
        return {"items": [], "discounts": [], "receipt_total": None, "scan_path": None}

    data.setdefault("items", [])
    data.setdefault("discounts", [])
    data.setdefault("receipt_total", None)
    data.setdefault("scan_path", None)
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
    if receipt_total and receipt_total > 0:
        tolerance = max(1.0, receipt_total * 0.08)
        if abs(calculated - receipt_total) > tolerance:
            return False

    return True


def waste_percent(total, junk_total):
    if not total:
        return 0
    return round((junk_total / total) * 100, 1)


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
    user.is_subscriber = 1
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

        pairs = parse_pairs(data.get("items", []))
        discounts = remove_duplicate_discounts(parse_discounts(data.get("discounts", [])))
        receipt_total = parse_receipt_total(data.get("receipt_total"))

        if not scan_result_is_plausible(pairs, discounts, receipt_total):
            ocr_data = normalize_scan_data(ocr_parse_receipt(str(path)))
            ocr_pairs = parse_pairs(ocr_data.get("items", []))
            ocr_discounts = remove_duplicate_discounts(parse_discounts(ocr_data.get("discounts", [])))
            ocr_receipt_total = parse_receipt_total(ocr_data.get("receipt_total"))

            if scan_result_is_plausible(ocr_pairs, ocr_discounts, ocr_receipt_total):
                data = ocr_data
                pairs = ocr_pairs
                discounts = ocr_discounts
                receipt_total = ocr_receipt_total
            else:
                raise HTTPException(
                    status_code=422,
                    detail="Receipt totals did not look reliable. Try a clearer photo inside the guide.",
                )
        elif not discounts or receipt_total is None:
            ocr_data = ocr_data or normalize_scan_data(ocr_parse_receipt(str(path)))
            if not discounts:
                discounts = remove_duplicate_discounts(parse_discounts(ocr_data.get("discounts", [])))
            if receipt_total is None:
                receipt_total = parse_receipt_total(ocr_data.get("receipt_total"))
        elif any(is_generic_discount_name(name) for name, _ in discounts):
            ocr_data = ocr_data or normalize_scan_data(ocr_parse_receipt(str(path)))
            discounts = merge_specific_ocr_discounts(discounts, parse_discounts(ocr_data.get("discounts", [])))

        discounts = remove_duplicate_discounts(discounts)

        exclusions = parse_user_exclusions(user)
        filtered_pairs_for_junk = [
            (name, price)
            for name, price in pairs
            if not is_excluded_junk(name, exclusions)
        ]
        junk_items, junk_total = analyze_junk(filtered_pairs_for_junk)
        junk_lookup = set(junk_items)
        junk_discount_items = []
        junk_discount_total = 0.0

        for name, amount in discounts:
            if is_excluded_junk(name, exclusions) or not is_junk(name):
                continue

            discount_value = float(amount)
            junk_discount_total += discount_value
            junk_discount_items.append((name, f"{discount_value:.2f}"))

        junk_total = round(max(junk_total + junk_discount_total, 0), 2)
        calculated_total = calculated_scan_total(pairs, discounts)
        total = receipt_total if receipt_total and receipt_total > 0 else calculated_total
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
            db.add(
                Item(
                    receipt_id=receipt.id,
                    name=name,
                    price=float(amount),
                    is_junk=0,
                )
            )

        db.commit()
        db.refresh(receipt)

        return {
            "id": receipt.id,
            "total": total,
            "junk_total": junk_total,
            "waste_percent": waste_percent(total, junk_total),
            "photo_url": f"/uploads/{filename}",
            "scan_url": f"/{scan_relative_path}" if scan_relative_path else None,
            "discounts": [
                {
                    "name": name,
                    "amount": float(amount),
                    "is_junk": False,
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

    return [
        {
            "id": receipt.id,
            "date": receipt.created_at,
            "total": receipt.total,
            "junk_total": receipt.junk_total,
            "waste_percent": waste_percent(receipt.total, receipt.junk_total),
            "photo_url": f"/{receipt.photo_path}" if receipt.photo_path else None,
            "scan_url": f"/{receipt.scan_path}" if receipt.scan_path else None,
            "items": [
                {
                    "name": item.name,
                    "price": item.price,
                    "is_junk": bool(item.is_junk),
                }
                for item in receipt.items
            ],
        }
        for receipt in receipts
    ]


@app.get("/subscription-summary")
def subscription_summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    receipts = db.query(Receipt).filter(Receipt.user_id == user.id).all()
    total = round(sum(receipt.total or 0 for receipt in receipts), 2)
    junk_total = round(sum(receipt.junk_total or 0 for receipt in receipts), 2)
    total_waste_percent = waste_percent(total, junk_total)

    if not user.is_subscriber:
        return {
            "locked": True,
            "total": total,
            "junk_total": junk_total,
            "waste_percent": total_waste_percent,
        }

    since = datetime.utcnow() - timedelta(days=30)
    monthly_receipts = [receipt for receipt in receipts if receipt.created_at and receipt.created_at >= since]
    monthly_total = round(sum(receipt.total or 0 for receipt in monthly_receipts), 2)
    monthly_junk = round(sum(receipt.junk_total or 0 for receipt in monthly_receipts), 2)

    return {
        "locked": False,
        "total": total,
        "junk_total": junk_total,
        "waste_percent": total_waste_percent,
        "monthly_total": monthly_total,
        "monthly_junk_total": monthly_junk,
        "monthly_waste_percent": waste_percent(monthly_total, monthly_junk),
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
