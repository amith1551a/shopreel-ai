"""Credit system migration: Scale all credits by 1,000.

Purpose: Convert user-facing credit display from cents-like units to large,
comma-formatted credit amounts while maintaining exact cost tracking.

Migration approach:
1. Add migration flag to database to track per-user migration
2. One-time multiplication of all existing credits by 1,000
3. All new costs calculated using new credit-to-dollar conversion
4. Prevents multiple migrations of same user's credits
"""
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


class CreditMigration:
    """One-time credit system migration manager."""
    
    CREDIT_SCALE_FACTOR = 1000  # Multiply all previous credits by this
    
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._init_migration_schema()
    
    def _get_conn(self):
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn
    
    def _init_migration_schema(self):
        """Create schema for tracking migrations."""
        with closing(self._get_conn()) as conn:
            conn.execute("""
            CREATE TABLE IF NOT EXISTS credit_migration_status (
                id INTEGER PRIMARY KEY,
                user_id TEXT NOT NULL UNIQUE,
                migrated_to_new_credits BOOLEAN DEFAULT 0,
                migrated_at TEXT,
                old_total_cents INTEGER,
                new_total_credits INTEGER
            )
            """)
            conn.commit()
    
    def needs_migration(self, user_id: str) -> bool:
        """Check if user needs credit migration.
        
        Returns:
            True if user hasn't been migrated yet, False if already migrated
        """
        with closing(self._get_conn()) as conn:
            row = conn.execute(
                "SELECT migrated_to_new_credits FROM credit_migration_status WHERE user_id=?",
                (user_id,)
            ).fetchone()
            
            if row is None:
                return True  # No record = needs migration
            
            return not row["migrated_to_new_credits"]
    
    def mark_migrated(self, user_id: str, old_total_cents: int) -> bool:
        """Mark user as having completed credit migration.
        
        Stores both old and new values for audit trail.
        Returns:
            True if successfully marked, False if already migrated
        """
        with closing(self._get_conn()) as conn:
            # Check if already migrated
            existing = conn.execute(
                "SELECT migrated_to_new_credits FROM credit_migration_status WHERE user_id=?",
                (user_id,)
            ).fetchone()
            
            if existing and existing["migrated_to_new_credits"]:
                return False  # Already migrated
            
            new_total_credits = old_total_cents * self.CREDIT_SCALE_FACTOR
            now = datetime.now(timezone.utc).isoformat()
            
            if existing:
                # Update existing record
                conn.execute(
                    """UPDATE credit_migration_status 
                    SET migrated_to_new_credits=1, migrated_at=?, old_total_cents=?, new_total_credits=?
                    WHERE user_id=?""",
                    (now, old_total_cents, new_total_credits, user_id)
                )
            else:
                # Insert new record
                conn.execute(
                    """INSERT INTO credit_migration_status 
                    (user_id, migrated_to_new_credits, migrated_at, old_total_cents, new_total_credits)
                    VALUES (?, 1, ?, ?, ?)""",
                    (user_id, now, old_total_cents, new_total_credits)
                )
            
            conn.commit()
            return True
    
    def get_migration_status(self, user_id: str) -> Optional[dict]:
        """Get migration status for a user."""
        with closing(self._get_conn()) as conn:
            row = conn.execute(
                """SELECT user_id, migrated_to_new_credits, migrated_at, old_total_cents, new_total_credits
                FROM credit_migration_status WHERE user_id=?""",
                (user_id,)
            ).fetchone()
            
            if row is None:
                return None
            
            return dict(row)
