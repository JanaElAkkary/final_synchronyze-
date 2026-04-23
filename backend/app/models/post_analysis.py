from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    JSON,
    Index,
    func,
)
from sqlalchemy.orm import relationship

from backend.app.database import Base


class PostAnalysis(Base):
    __tablename__ = "post_analysis"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id"), nullable=False, index=True)
    model_version = Column(String, nullable=False, index=True)
    clean_text = Column(Text, nullable=False)
    predicted_label = Column(String, nullable=False, index=True)
    confidence = Column(Float, nullable=False)
    topic_vector = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        UniqueConstraint("post_id", "model_version", name="uq_post_analysis_post_model"),
        Index(
            "ix_post_analysis_post_id_created_at", "post_id", "created_at"
        ),
    )

    post = relationship("Post", back_populates="analysis")

