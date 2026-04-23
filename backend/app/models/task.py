from sqlalchemy import Column, DateTime, Integer, String, JSON, func
from backend.app.database import Base

class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(String, nullable=False)
    target = Column(String, nullable=False)
    platform = Column(String, nullable=False, index=True)
    status = Column(String, default="pending", nullable=False, index=True)
    created_by = Column(String, nullable=True)
    
    # Store dynamic result data like metrics or error messages
    result_summary = Column(JSON, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
