"""update_analyst_users_username

Revision ID: 8c6e1f2a3d10
Revises: 7b9c2d8a1e6f
Create Date: 2026-03-22 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "8c6e1f2a3d10"
down_revision = "7b9c2d8a1e6f"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("analyst_users") as batch_op:
        batch_op.add_column(sa.Column("username", sa.String(), nullable=True))
        batch_op.create_index(batch_op.f("ix_analyst_users_username"), ["username"], unique=False)

    op.execute("UPDATE analyst_users SET username = email WHERE username IS NULL")

    with op.batch_alter_table("analyst_users") as batch_op:
        batch_op.alter_column("username", existing_type=sa.String(), nullable=False)
        batch_op.create_unique_constraint("uq_analyst_users_username", ["username"])
        batch_op.drop_constraint("uq_analyst_users_email", type_="unique")
        batch_op.drop_index(batch_op.f("ix_analyst_users_email"))
        batch_op.drop_column("email")


def downgrade():
    with op.batch_alter_table("analyst_users") as batch_op:
        batch_op.add_column(sa.Column("email", sa.String(), nullable=True))
        batch_op.create_index(batch_op.f("ix_analyst_users_email"), ["email"], unique=False)

    op.execute("UPDATE analyst_users SET email = username WHERE email IS NULL")

    with op.batch_alter_table("analyst_users") as batch_op:
        batch_op.alter_column("email", existing_type=sa.String(), nullable=False)
        batch_op.create_unique_constraint("uq_analyst_users_email", ["email"])
        batch_op.drop_constraint("uq_analyst_users_username", type_="unique")
        batch_op.drop_index(batch_op.f("ix_analyst_users_username"))
        batch_op.drop_column("username")
