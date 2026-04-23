"""add analytics performance indexes

Revision ID: e64f95b72f50
Revises: 3f2b1a9c4d21
Create Date: 2026-04-18 11:21:45.223097

"""

from alembic import op
import sqlalchemy as sa



# revision identifiers, used by Alembic.
revision = 'e64f95b72f50'
down_revision = '3f2b1a9c4d21'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Composite index for last_seen optimization (account_id + COALESCE columns)
    # Note: Using captured_at and created_at individually in a covering index for MAX
    op.create_index(
        "ix_posts_perf_aggregation",
        "posts",
        ["account_id", "captured_at", "created_at"],
        unique=False,
    )

    # 2. Composite index for analyzed_count optimization (model_version + post_id)
    op.create_index(
        "ix_post_analysis_perf_model_post",
        "post_analysis",
        ["model_version", "post_id"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_post_analysis_perf_model_post", table_name="post_analysis")
    op.drop_index("ix_posts_perf_aggregation", table_name="posts")

