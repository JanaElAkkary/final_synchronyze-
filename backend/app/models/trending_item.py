from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    JSON,
    Index,
    Date,
    func,
)
from sqlalchemy.orm import relationship

from backend.app.database import Base


class TrendingItem(Base):
    __tablename__ = "trending_items"

    id = Column(Integer, primary_key=True, index=True)
    platform = Column(String, nullable=False, index=True)  # e.g. "twitter"
    category = Column(String, nullable=False, index=True)  # "trending" or "news"
    snapshot_date = Column(Date, nullable=False, index=True)
    rank = Column(Integer, nullable=False, index=True)
    label = Column(String, nullable=False, index=True)
    normalized_label = Column(String, nullable=False, index=True)
    item_type = Column(String, nullable=True, index=True)  # "hashtag", "topic", "news", etc.
    captured_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    source_url = Column(Text, nullable=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True, index=True)
    raw_payload = Column(JSON, nullable=True)

    __table_args__ = (
        Index(
            "ix_trending_items_platform_category_date",
            "platform",
            "category",
            "snapshot_date",
        ),
        Index(
            "ix_trending_items_platform_category_date_label",
            "platform",
            "category",
            "snapshot_date",
            "normalized_label",
        ),
        Index(
            "uq_trending_items_rank",
            "platform",
            "category",
            "snapshot_date",
            "rank",
            unique=True,
        ),
    )

    task = relationship("Task")
