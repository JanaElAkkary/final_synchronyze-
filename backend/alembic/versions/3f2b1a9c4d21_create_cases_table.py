"""create_cases_table

Revision ID: 3f2b1a9c4d21
Revises: 8c6e1f2a3d10
Create Date: 2026-04-02 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "3f2b1a9c4d21"
down_revision = "8c6e1f2a3d10"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "cases",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), server_default="open", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["actor_id"], ["accounts.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["analyst_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_cases_actor_id"), "cases", ["actor_id"], unique=False)
    op.create_index(op.f("ix_cases_created_at"), "cases", ["created_at"], unique=False)
    op.create_index(op.f("ix_cases_id"), "cases", ["id"], unique=False)
    op.create_index(op.f("ix_cases_owner_id"), "cases", ["owner_id"], unique=False)
    op.create_index(op.f("ix_cases_status"), "cases", ["status"], unique=False)
    op.create_index("ix_cases_owner_created_at", "cases", ["owner_id", "created_at"], unique=False)


def downgrade():
    op.drop_index("ix_cases_owner_created_at", table_name="cases")
    op.drop_index(op.f("ix_cases_status"), table_name="cases")
    op.drop_index(op.f("ix_cases_owner_id"), table_name="cases")
    op.drop_index(op.f("ix_cases_id"), table_name="cases")
    op.drop_index(op.f("ix_cases_created_at"), table_name="cases")
    op.drop_index(op.f("ix_cases_actor_id"), table_name="cases")
    op.drop_table("cases")
