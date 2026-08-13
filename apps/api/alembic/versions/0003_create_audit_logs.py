"""create audit_logs table

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("app.users.id"), nullable=True),
        sa.Column("user_email", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("ip_address", sa.Text(), nullable=True),
        sa.Column("details", postgresql.JSONB(), nullable=True),
        schema="app",
    )
    op.create_index("ix_audit_logs_occurred_at", "audit_logs", ["occurred_at"], schema="app")
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"], schema="app")


def downgrade() -> None:
    op.drop_index("ix_audit_logs_action", table_name="audit_logs", schema="app")
    op.drop_index("ix_audit_logs_occurred_at", table_name="audit_logs", schema="app")
    op.drop_table("audit_logs", schema="app")
