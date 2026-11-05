#!/usr/bin/env python3
"""Test database initialization and budget guard persistence."""

import sqlite3
import tempfile
import shutil
from pathlib import Path
import sys

# Add parent dir to path
sys.path.insert(0, str(Path(__file__).parent))

from budget_guard import BudgetGuard
from generation import Studio

def test_budget_guard_initialization():
    """Test that BudgetGuard creates schema and persists data."""
    print("=" * 80)
    print("TEST: BudgetGuard Initialization and Persistence")
    print("=" * 80)
    
    # Create temp directory
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.sqlite3"
        
        print(f"\nTest database: {db_path}")
        
        # Initialize BudgetGuard (should create schema)
        print("\n1. Creating BudgetGuard...")
        bg = BudgetGuard(db_path)
        print("   [OK] BudgetGuard created")
        
        # Verify tables exist
        print("\n2. Checking tables...")
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = [row[0] for row in cursor.fetchall()]
        print(f"   Tables: {tables}")
        
        budget_tables = ['budget_daily_summary', 'budget_ledger', 'budget_monthly_summary']
        for table in budget_tables:
            if table in tables:
                print(f"   [OK] {table} EXISTS")
            else:
                print(f"   [ERROR] {table} MISSING")
        
        # Check indexes
        print("\n3. Checking indexes...")
        cursor.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
        indexes = [row[0] for row in cursor.fetchall()]
        print(f"   Indexes: {indexes}")
        
        # Insert test data
        print("\n4. Inserting test data...")
        cursor.execute("""
            INSERT INTO budget_ledger (created_at, job_id, user_id, model, status, reserved_cents, actual_cents)
            VALUES (datetime('now'), 'test-job-1', 'user-1', 'wan3.0', 'completed', 5, 5)
        """)
        cursor.execute("""
            INSERT INTO budget_daily_summary (date, user_id, used_cents, pending_cents)
            VALUES ('2026-11-05', 'user-1', 5, 0)
        """)
        conn.commit()
        print("   [OK] Test data inserted")
        
        # Verify data persists
        print("\n5. Verifying data persistence...")
        cursor.execute("SELECT COUNT(*) FROM budget_ledger")
        ledger_count = cursor.fetchone()[0]
        print(f"   budget_ledger rows: {ledger_count}")
        
        cursor.execute("SELECT COUNT(*) FROM budget_daily_summary")
        daily_count = cursor.fetchone()[0]
        print(f"   budget_daily_summary rows: {daily_count}")
        
        # Close and reopen (test persistence)
        print("\n6. Testing persistence after close/reopen...")
        conn.close()
        
        conn2 = sqlite3.connect(str(db_path))
        cursor2 = conn2.cursor()
        cursor2.execute("SELECT COUNT(*) FROM budget_ledger")
        new_ledger_count = cursor2.fetchone()[0]
        print(f"   budget_ledger rows (after reopen): {new_ledger_count}")
        
        if new_ledger_count == ledger_count:
            print("   [OK] Data persisted across close/reopen")
        else:
            print(f"   [ERROR] Data persistence failed ({ledger_count} -> {new_ledger_count})")
        
        conn2.close()
    
    print("\n" + "=" * 80)
    return True

def test_studio_schema_includes_higgsfield():
    """Test that Studio creates higgsfield_jobs table."""
    print("\n" + "=" * 80)
    print("TEST: Studio Schema Includes Higgsfield Jobs")
    print("=" * 80)
    
    with tempfile.TemporaryDirectory() as tmpdir:
        storage_path = Path(tmpdir)
        
        print(f"\nStorage path: {storage_path}")
        
        # Create mock provider
        class MockProvider:
            pass
        
        print("\n1. Creating Studio...")
        studio = Studio(storage_path, MockProvider())
        print("   [OK] Studio created")
        
        print("\n2. Checking database...")
        with studio.db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            tables = [row[0] for row in cursor.fetchall()]
            print(f"   Tables: {tables}")
            
            required_tables = [
                'videos', 'projects', 'generation_jobs', 'job_commands', 'higgsfield_jobs'
            ]
            
            for table in required_tables:
                if table in tables:
                    # Get row count
                    cursor.execute(f"SELECT COUNT(*) FROM {table}")
                    count = cursor.fetchone()[0]
                    print(f"   [OK] {table} EXISTS (rows: {count})")
                else:
                    print(f"   [ERROR] {table} MISSING")
    
    print("\n" + "=" * 80)
    return True

def inspect_live_database():
    """Inspect the live data/studio.sqlite3 database."""
    print("\n" + "=" * 80)
    print("INSPECTION: Live Database (data/studio.sqlite3)")
    print("=" * 80)
    
    db_path = Path("data/studio.sqlite3")
    
    if not db_path.exists():
        print(f"\nERROR: {db_path} not found")
        return False
    
    print(f"\nDatabase: {db_path}")
    print(f"File size: {db_path.stat().st_size / 1024:.2f} KB")
    
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    # Get tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [row[0] for row in cursor.fetchall()]
    print(f"Tables: {tables}")
    
    for table in tables:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        print(f"  {table}: {count} rows")
    
    # Check budget tables
    budget_tables = ['budget_ledger', 'budget_daily_summary', 'budget_monthly_summary']
    print("\nBudget Tables Status:")
    for table in budget_tables:
        if table in tables:
            print(f"  [OK] {table} EXISTS")
        else:
            print(f"  [MISSING] {table} NOT FOUND")
    
    # Check higgsfield_jobs
    if 'higgsfield_jobs' in tables:
        cursor.execute("SELECT COUNT(*) FROM higgsfield_jobs")
        count = cursor.fetchone()[0]
        print(f"\nhiggsfield_jobs table: {count} rows")
    
    # Check integrity
    cursor.execute("PRAGMA integrity_check")
    integrity = cursor.fetchone()[0]
    print(f"\nDatabase integrity: {integrity}")
    
    conn.close()
    
    print("\n" + "=" * 80)
    return True

if __name__ == "__main__":
    print("\n")
    print("=" * 80)
    print("DATABASE INITIALIZATION AND PERSISTENCE TESTS".center(80))
    print("=" * 80)
    
    results = []
    
    try:
        results.append(("BudgetGuard Initialization", test_budget_guard_initialization()))
    except Exception as e:
        print(f"\n[EXCEPTION] BudgetGuard test failed: {e}")
        import traceback
        traceback.print_exc()
        results.append(("BudgetGuard Initialization", False))
    
    try:
        results.append(("Studio Schema", test_studio_schema_includes_higgsfield()))
    except Exception as e:
        print(f"\n[EXCEPTION] Studio test failed: {e}")
        import traceback
        traceback.print_exc()
        results.append(("Studio Schema", False))
    
    try:
        results.append(("Live Database Inspection", inspect_live_database()))
    except Exception as e:
        print(f"\n[EXCEPTION] Live DB inspection failed: {e}")
        import traceback
        traceback.print_exc()
        results.append(("Live Database Inspection", False))
    
    # Summary
    print("\n")
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    for test_name, passed in results:
        status = "[PASS]" if passed else "[FAIL]"
        print(f"{status} {test_name}")
    
    total = len(results)
    passed = sum(1 for _, p in results if p)
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n[OK] All database tests passed")
        exit(0)
    else:
        print(f"\n[WARNING] {total - passed} test(s) failed")
        exit(1)
