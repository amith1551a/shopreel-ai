#!/usr/bin/env python3
"""Initialize the Flask app to trigger BudgetGuard schema creation."""

import sys
from pathlib import Path

# Add current dir to path
sys.path.insert(0, str(Path(__file__).parent))

# Set Flask app mode
import os
os.environ['FLASK_ENV'] = 'development'

# Import and create the Flask app
from app import create_app

print("Initializing Flask app...")
try:
    app = create_app(start_worker=False)  # Don't start the worker, just init schema
    print("[OK] Flask app initialized successfully")
    print("[OK] BudgetGuard and database schemas should now be created")
except Exception as e:
    print(f"[ERROR] Failed to initialize app: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\nChecking if budget tables were created...")

import sqlite3

db_path = Path("data/studio.sqlite3")
conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = [row[0] for row in cursor.fetchall()]

budget_tables = ['budget_ledger', 'budget_daily_summary', 'budget_monthly_summary']

print(f"\nAll tables: {tables}")
print("\nBudget tables check:")

for table in budget_tables:
    if table in tables:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        print(f"  [OK] {table} EXISTS ({count} rows)")
    else:
        print(f"  [MISSING] {table} NOT FOUND")

conn.close()

print("\n[OK] Database initialization check complete")
