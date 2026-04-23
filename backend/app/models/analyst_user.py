from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint, func

from backend.app.database import Base


class AnalystUser(Base):
    __tablename__ = "analyst_users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    username = Column(String, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, server_default="analyst", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (UniqueConstraint("username", name="uq_analyst_users_username"),)
