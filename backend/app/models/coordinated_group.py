from sqlalchemy import (
    Column,
    Date,
    DateTime,
    Float,
    Integer,
    String,
    JSON,
    Index,
    func,
)
from sqlalchemy.orm import relationship

from backend.app.database import Base


class CoordinatedGroup(Base):
    __tablename__ = "coordinated_groups"

    id = Column(Integer, primary_key=True, index=True)
    week_start = Column(Date, nullable=False, index=True)
    from_label = Column(String, nullable=False)
    to_label = Column(String, nullable=False)
    similarity = Column(Float, nullable=False)
    member_account_ids = Column(JSON, nullable=False)
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_coordinated_groups_week_start", "week_start"),
        Index("ix_coordinated_groups_created_at", "created_at"),
    )

    alerts = relationship("Alert", back_populates="coordinated_group")

