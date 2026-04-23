from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Index, func
from sqlalchemy.orm import relationship

from backend.app.database import Base


class Case(Base):
    __tablename__ = "cases"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    actor_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("analyst_users.id"), nullable=False, index=True)
    status = Column(String, nullable=False, index=True, server_default="open")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_cases_owner_created_at", "owner_id", "created_at"),
    )

    actor = relationship("Account")
    owner = relationship("AnalystUser")
