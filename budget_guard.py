"""Budget guard: Atomic budget tracking with daily/monthly caps and pending cost reservations.

All budgets in cents (USD). America/Chicago timezone for calendar resets.
Zero automatic retries for failed paid jobs.
Concurrent limit: 1 paid job per account.
"""
import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path
from threading import Lock
from typing import Optional, Tuple
import pytz


class BudgetGuardError(RuntimeError):
    pass


class BudgetGuard:
    """Atomic budget tracking with persistent ledger."""
    
    TIMEZONE = pytz.timezone("America/Chicago")
    
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.lock = Lock()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()
    
    def _get_conn(self):
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn
    
    def _init_schema(self):
        """Create schema for budget tracking."""
        with closing(self._get_conn()) as conn:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS budget_ledger (
                id INTEGER PRIMARY KEY,
                created_at TEXT NOT NULL,
                job_id TEXT NOT NULL UNIQUE,
                user_id TEXT NOT NULL,
                model TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                reserved_cents INTEGER NOT NULL,
                actual_cents INTEGER,
                error TEXT,
                paid_at TEXT
            );
            
            CREATE TABLE IF NOT EXISTS budget_daily_summary (
                date TEXT NOT NULL UNIQUE PRIMARY KEY,
                user_id TEXT NOT NULL,
                used_cents INTEGER DEFAULT 0,
                pending_cents INTEGER DEFAULT 0
            );
            
            CREATE TABLE IF NOT EXISTS budget_monthly_summary (
                month TEXT NOT NULL UNIQUE PRIMARY KEY,
                user_id TEXT NOT NULL,
                used_cents INTEGER DEFAULT 0,
                pending_cents INTEGER DEFAULT 0
            );
            
            CREATE INDEX IF NOT EXISTS idx_job_id ON budget_ledger(job_id);
            CREATE INDEX IF NOT EXISTS idx_user_date ON budget_ledger(user_id, created_at);
            """)
            conn.commit()
    
    def _get_today(self) -> str:
        """Get today's date in America/Chicago, ISO format."""
        now = datetime.now(self.TIMEZONE)
        return now.date().isoformat()
    
    def _get_this_month(self) -> str:
        """Get current month in YYYY-MM format."""
        now = datetime.now(self.TIMEZONE)
        return now.strftime("%Y-%m")
    
    def reserve_budget(
        self,
        user_id: str,
        job_id: str,
        model: str,
        estimated_cents: int,
        daily_limit_cents: int,
        monthly_limit_cents: int,
    ) -> Tuple[bool, Optional[str]]:
        """Atomically reserve budget for a job.
        
        Returns:
            (success, error_message)
        """
        with self.lock:
            try:
                with closing(self._get_conn()) as conn:
                    # Check daily limit
                    today = self._get_today()
                    daily = conn.execute(
                        "SELECT used_cents, pending_cents FROM budget_daily_summary WHERE date=? AND user_id=?",
                        (today, user_id),
                    ).fetchone()
                    daily_used = (daily["used_cents"] or 0) + (daily["pending_cents"] or 0) if daily else 0
                    
                    if daily_used + estimated_cents > daily_limit_cents:
                        remaining = max(0, daily_limit_cents - daily_used)
                        return False, f"Daily limit reached. ${remaining / 100:.2f} available."
                    
                    # Check monthly limit
                    month = self._get_this_month()
                    monthly = conn.execute(
                        "SELECT used_cents, pending_cents FROM budget_monthly_summary WHERE month=? AND user_id=?",
                        (month, user_id),
                    ).fetchone()
                    monthly_used = (monthly["used_cents"] or 0) + (monthly["pending_cents"] or 0) if monthly else 0
                    
                    if monthly_used + estimated_cents > monthly_limit_cents:
                        remaining = max(0, monthly_limit_cents - monthly_used)
                        return False, f"Monthly limit reached. ${remaining / 100:.2f} available."
                    
                    # Check concurrent paid jobs
                    concurrent = conn.execute(
                        "SELECT COUNT(*) as cnt FROM budget_ledger WHERE user_id=? AND status='pending'",
                        (user_id,),
                    ).fetchone()
                    
                    if concurrent and concurrent["cnt"] >= 1:
                        return False, "One paid job already in progress. Wait for completion."
                    
                    # Check for duplicates
                    existing = conn.execute(
                        "SELECT id FROM budget_ledger WHERE job_id=?",
                        (job_id,),
                    ).fetchone()
                    
                    if existing:
                        return False, f"Job {job_id} already reserved."
                    
                    # Insert ledger entry
                    conn.execute(
                        """INSERT INTO budget_ledger 
                        (created_at, job_id, user_id, model, status, reserved_cents)
                        VALUES (?, ?, ?, ?, ?, ?)""",
                        (
                            datetime.now(timezone.utc).isoformat(),
                            job_id,
                            user_id,
                            model,
                            "pending",
                            estimated_cents,
                        ),
                    )
                    
                    # Update daily summary
                    if daily:
                        conn.execute(
                            "UPDATE budget_daily_summary SET pending_cents = pending_cents + ? WHERE date=?",
                            (estimated_cents, today),
                        )
                    else:
                        conn.execute(
                            "INSERT INTO budget_daily_summary (date, user_id, pending_cents) VALUES (?, ?, ?)",
                            (today, user_id, estimated_cents),
                        )
                    
                    # Update monthly summary
                    if monthly:
                        conn.execute(
                            "UPDATE budget_monthly_summary SET pending_cents = pending_cents + ? WHERE month=?",
                            (estimated_cents, month),
                        )
                    else:
                        conn.execute(
                            "INSERT INTO budget_monthly_summary (month, user_id, pending_cents) VALUES (?, ?, ?)",
                            (month, user_id, estimated_cents),
                        )
                    
                    conn.commit()
                    return True, None
            except Exception as e:
                return False, f"Budget reservation failed: {e}"
    
    def charge_job(self, job_id: str, actual_cents: int, error: Optional[str] = None) -> bool:
        """Settle a job: move from pending to used/failed.
        
        Returns:
            True if successfully charged
        """
        with self.lock:
            try:
                with closing(self._get_conn()) as conn:
                    entry = conn.execute(
                        "SELECT user_id, reserved_cents FROM budget_ledger WHERE job_id=?",
                        (job_id,),
                    ).fetchone()
                    
                    if not entry:
                        return False
                    
                    user_id = entry["user_id"]
                    reserved = entry["reserved_cents"]
                    today = self._get_today()
                    month = self._get_this_month()
                    
                    # Update ledger
                    status = "failed" if error else "charged"
                    conn.execute(
                        """UPDATE budget_ledger 
                        SET status=?, actual_cents=?, error=?, paid_at=?
                        WHERE job_id=?""",
                        (
                            status,
                            actual_cents,
                            error,
                            datetime.now(timezone.utc).isoformat(),
                            job_id,
                        ),
                    )
                    
                    # Adjust daily/monthly: move from pending to used, adjust for overages
                    delta = actual_cents - reserved
                    
                    conn.execute(
                        """UPDATE budget_daily_summary 
                        SET pending_cents = MAX(0, pending_cents - ?),
                            used_cents = used_cents + ?
                        WHERE date=? AND user_id=?""",
                        (reserved, actual_cents, today, user_id),
                    )
                    
                    conn.execute(
                        """UPDATE budget_monthly_summary 
                        SET pending_cents = MAX(0, pending_cents - ?),
                            used_cents = used_cents + ?
                        WHERE month=? AND user_id=?""",
                        (reserved, actual_cents, month, user_id),
                    )
                    
                    conn.commit()
                    return True
            except Exception:
                return False
    
    def get_budget_status(self, user_id: str, daily_limit_cents: int, monthly_limit_cents: int) -> dict:
        """Get current budget usage for user.
        
        Returns:
            {today_used_cents, today_available_cents, today_pending_cents,
             month_used_cents, month_available_cents, month_pending_cents,
             next_daily_reset_at, warn_daily, warn_monthly}
        """
        with self.lock:
            with closing(self._get_conn()) as conn:
                today = self._get_today()
                month = self._get_this_month()
                
                daily_row = conn.execute(
                    "SELECT used_cents, pending_cents FROM budget_daily_summary WHERE date=? AND user_id=?",
                    (today, user_id),
                ).fetchone()
                
                monthly_row = conn.execute(
                    "SELECT used_cents, pending_cents FROM budget_monthly_summary WHERE month=? AND user_id=?",
                    (month, user_id),
                ).fetchone()
                
                today_used = (daily_row["used_cents"] or 0) if daily_row else 0
                today_pending = (daily_row["pending_cents"] or 0) if daily_row else 0
                today_total = today_used + today_pending
                
                month_used = (monthly_row["used_cents"] or 0) if monthly_row else 0
                month_pending = (monthly_row["pending_cents"] or 0) if monthly_row else 0
                month_total = month_used + month_pending
                
                # Next reset: tomorrow at midnight Chicago time
                now = datetime.now(self.TIMEZONE)
                next_reset = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                
                return {
                    "today_used_cents": today_used,
                    "today_available_cents": max(0, daily_limit_cents - today_total),
                    "today_pending_cents": today_pending,
                    "today_total_cents": today_total,
                    "today_limit_cents": daily_limit_cents,
                    "today_percent": int(100 * today_total / daily_limit_cents) if daily_limit_cents > 0 else 0,
                    
                    "month_used_cents": month_used,
                    "month_available_cents": max(0, monthly_limit_cents - month_total),
                    "month_pending_cents": month_pending,
                    "month_total_cents": month_total,
                    "month_limit_cents": monthly_limit_cents,
                    "month_percent": int(100 * month_total / monthly_limit_cents) if monthly_limit_cents > 0 else 0,
                    
                    "next_daily_reset_at": next_reset.isoformat(),
                    "warn_daily": today_total >= int(0.8 * daily_limit_cents),
                    "warn_monthly": month_total >= int(0.8 * monthly_limit_cents),
                    "blocked_daily": today_total >= daily_limit_cents,
                    "blocked_monthly": month_total >= monthly_limit_cents,
                }
    
    def get_job_ledger(self, user_id: str, limit: int = 50) -> list:
        """Get recent jobs for user."""
        with self.lock:
            with closing(self._get_conn()) as conn:
                rows = conn.execute(
                    """SELECT id, job_id, model, reserved_cents, actual_cents, status, error, created_at, paid_at
                    FROM budget_ledger WHERE user_id=?
                    ORDER BY created_at DESC LIMIT ?""",
                    (user_id, limit),
                ).fetchall()
                
                return [dict(row) for row in rows]
