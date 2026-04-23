from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Boolean,
    JSON,
    Index,
    func,
)
from sqlalchemy.orm import relationship

from backend.app.database import Base


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    alert_type = Column(String, nullable=False, index=True)
    severity = Column(String, nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True, index=True)
    coordinated_group_id = Column(
        Integer, ForeignKey("coordinated_groups.id"), nullable=True, index=True
    )
    message = Column(Text, nullable=False)
    payload = Column(JSON, nullable=True)
    is_read = Column(Boolean, nullable=False, server_default="false", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_alerts_account_created_at", "account_id", "created_at"),
    )

    account = relationship("Account", back_populates="alerts")
    coordinated_group = relationship("CoordinatedGroup", back_populates="alerts")

