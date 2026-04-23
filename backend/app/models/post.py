from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Index,
    func,
    Enum,
    JSON,
)
from sqlalchemy.orm import relationship

from backend.app.database import Base
from backend.app.models.enums import PlatformEnum


class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    platform = Column(
        Enum(PlatformEnum, name="platform_enum"), nullable=False, index=True
    )
    platform_post_id = Column(String, nullable=False)
    url = Column(String, nullable=True)
    raw_text = Column(Text, nullable=True)
    raw_payload = Column(JSON, nullable=True)
    captured_at = Column(DateTime(timezone=True), nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        UniqueConstraint(
            "platform", "platform_post_id", name="uq_posts_platform_platform_post_id"
        ),
        Index("ix_posts_account_id_created_at", "account_id", "created_at"),
    )

    account = relationship("Account", back_populates="posts")
    analysis = relationship("PostAnalysis", back_populates="post")
