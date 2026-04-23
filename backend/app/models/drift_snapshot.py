from sqlalchemy import (
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    JSON,
    Index,
    func,
)
from sqlalchemy.orm import relationship

from backend.app.database import Base


class DriftScore(Base):
    __tablename__ = "drift_scores"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    week_start = Column(Date, nullable=False, index=True)
    drift_score = Column(Float, nullable=False)
    from_label = Column(String, nullable=True)
    to_label = Column(String, nullable=True)
    evidence = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_drift_scores_account_week", "account_id", "week_start"),
        Index("ix_drift_scores_account_created_at", "account_id", "created_at"),
    )

    account = relationship("Account", back_populates="drift_scores")

