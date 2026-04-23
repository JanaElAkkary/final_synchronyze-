from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint, Enum, func
from sqlalchemy.orm import relationship

from backend.app.database import Base
from backend.app.models.enums import PlatformEnum


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    platform = Column(
        Enum(PlatformEnum, name="platform_enum"), nullable=False, index=True
    )
    handle = Column(String, nullable=False, index=True)
    display_name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        UniqueConstraint("platform", "handle", name="uq_accounts_platform_handle"),
    )

    posts = relationship("Post", back_populates="account")
    drift_scores = relationship("DriftScore", back_populates="account")
    alerts = relationship("Alert", back_populates="account")
