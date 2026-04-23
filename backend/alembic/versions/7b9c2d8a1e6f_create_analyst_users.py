"""create_analyst_users

Revision ID: 7b9c2d8a1e6f
Revises: 1f34fe9f734d
Create Date: 2026-03-22 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "7b9c2d8a1e6f"
down_revision = "1f34fe9f734d"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "analyst_users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("full_name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("role", sa.String(), server_default="analyst", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_analyst_users_email"),
    )
    op.create_index(op.f("ix_analyst_users_created_at"), "analyst_users", ["created_at"], unique=False)
    op.create_index(op.f("ix_analyst_users_email"), "analyst_users", ["email"], unique=False)
    op.create_index(op.f("ix_analyst_users_id"), "analyst_users", ["id"], unique=False)
    op.create_index(op.f("ix_analyst_users_role"), "analyst_users", ["role"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_analyst_users_role"), table_name="analyst_users")
    op.drop_index(op.f("ix_analyst_users_id"), table_name="analyst_users")
    op.drop_index(op.f("ix_analyst_users_email"), table_name="analyst_users")
    op.drop_index(op.f("ix_analyst_users_created_at"), table_name="analyst_users")
    op.drop_table("analyst_users")
