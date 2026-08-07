"""add is_admin and allowed_ip to users

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-07
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema="app",
    )
    op.add_column(
        "users",
        sa.Column("allowed_ip", sa.Text(), nullable=True),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column("users", "allowed_ip", schema="app")
    op.drop_column("users", "is_admin", schema="app")
