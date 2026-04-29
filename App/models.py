from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship
from database import Base
import datetime


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True)
    password = Column(String)
    mode = Column(String, default="person")
    display_name = Column(String, nullable=True)
    role = Column(String, default="user")
    is_subscriber = Column(Integer, default=0)
    dark_mode = Column(Integer, default=0)
    junk_exclusions = Column(Text, default="[]")
    bonus_scan_credits = Column(Integer, default=0)
    rewarded_ads_used = Column(Integer, default=0)
    rewarded_ads_reset_at = Column(DateTime, nullable=True)

    receipts = relationship("Receipt", back_populates="user")
    bug_reports = relationship("BugReport", back_populates="user")


class Receipt(Base):
    __tablename__ = "receipts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))

    total = Column(Float)
    junk_total = Column(Float)
    photo_path = Column(String, nullable=True)
    scan_path = Column(String, nullable=True)
    ai_output = Column(Text, nullable=True)
    ocr_output = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="receipts")
    items = relationship("Item", back_populates="receipt")


class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True)
    receipt_id = Column(Integer, ForeignKey("receipts.id"))

    name = Column(String)
    price = Column(Float)
    is_junk = Column(Integer)

    receipt = relationship("Receipt", back_populates="items")


class BugReport(Base):
    __tablename__ = "bug_reports"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    title = Column(String)
    description = Column(Text)
    status = Column(String, default="open")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="bug_reports")
