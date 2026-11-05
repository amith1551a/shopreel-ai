#!/usr/bin/env python
"""
Quick validation of Higgsfield integration components.
Tests core functionality without requiring external SDK or API keys.
Mock-based - no actual API calls.
"""
import sys
import json
from pathlib import Path
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))

def test_budget_guard():
    """Validate BudgetGuard module exists and has correct structure."""
    print("Testing budget_guard module...")
    try:
        from budget_guard import BudgetGuard, BudgetGuardError
        
        # Verify class exists and has required methods
        required_methods = ['reserve_budget', 'charge_job', 'get_budget_status']
        for method in required_methods:
            if not hasattr(BudgetGuard, method):
                print(f"  [FAIL] Missing method: {method}")
                return False
        
        print("  [PASS] BudgetGuard structure valid")
        return True
    except ImportError as e:
        print(f"  [FAIL] Import failed: {e}")
        return False

def test_script_parser():
    """Validate ScriptParser module exists and has correct structure."""
    print("Testing script_parser module...")
    try:
        from script_parser import ScriptParser, StoryboardEditor
        
        # Verify class exists and has required methods
        required_methods = ['extract_scenes_from_brief', 'compress_script', 'validate_script']
        for method in required_methods:
            if not hasattr(ScriptParser, method):
                print(f"  [FAIL] Missing method: {method}")
                return False
        
        print("  [PASS] ScriptParser structure valid")
        return True
    except ImportError as e:
        print(f"  [FAIL] Import failed: {e}")
        return False

def test_higgsfield_provider():
    """Validate HiggsFieldProvider module exists and has correct structure."""
    print("Testing higgsfield_provider module...")
    try:
        from higgsfield_provider import HiggsFieldProvider, PRICING
        from decimal import Decimal
        
        # Verify pricing configuration exists
        if 'wan/3.0/reference-to-video' not in PRICING:
            print("  [FAIL] Missing Wan 3.0 pricing")
            return False
        
        if 'kling/3.0/text-to-video' not in PRICING:
            print("  [FAIL] Missing Kling 3.0 pricing")
            return False
        
        wan_config = PRICING['wan/3.0/reference-to-video']
        if wan_config.get('per_second') != Decimal('0.05'):
            print(f"  [FAIL] Wan 3.0 pricing incorrect: {wan_config}")
            return False
        
        kling_config = PRICING['kling/3.0/text-to-video']
        if kling_config.get('per_second') != Decimal('0.10'):
            print(f"  [FAIL] Kling 3.0 pricing incorrect: {kling_config}")
            return False
        
        print("  [PASS] HiggsFieldProvider structure and pricing valid")
        return True
    except ImportError as e:
        print(f"  [FAIL] Import failed: {e}")
        return False
    except Exception as e:
        print(f"  [FAIL] Validation failed: {e}")
        return False

def test_higgsfield_routes():
    """Validate HiggsFieldIntegration module exists and has correct structure."""
    print("Testing higgsfield_routes module...")
    try:
        from higgsfield_routes import HiggsFieldIntegration
        
        # Verify class exists
        if not hasattr(HiggsFieldIntegration, '__init__'):
            print("  [FAIL] Missing __init__ method")
            return False
        
        print("  [PASS] HiggsFieldIntegration structure valid")
        return True
    except ImportError as e:
        print(f"  [FAIL] Import failed: {e}")
        return False

def test_cost_calculations():
    """Test cost calculation logic."""
    print("Testing cost calculations...")
    try:
        from higgsfield_provider import HiggsFieldProvider
        from decimal import Decimal
        
        provider = HiggsFieldProvider()
        
        # Test Wan 3.0 pricing: 10 seconds @ $0.05/s = $0.50 USD
        cost_usd_wan = provider.calculate_cost('wan/3.0/reference-to-video', 10)
        expected_wan = Decimal("0.50")
        if cost_usd_wan != expected_wan:
            print(f"  [FAIL] Wan 3.0 cost calculation wrong: expected {expected_wan} USD, got {cost_usd_wan}")
            return False
        
        # Test Kling 3.0 pricing: 10 seconds @ $0.10/s = $1.00 USD
        cost_usd_kling = provider.calculate_cost('kling/3.0/text-to-video', 10)
        expected_kling = Decimal("1.00")
        if cost_usd_kling != expected_kling:
            print(f"  [FAIL] Kling 3.0 cost calculation wrong: expected {expected_kling} USD, got {cost_usd_kling}")
            return False
        
        print("  [PASS] Cost calculations valid")
        return True
    except Exception as e:
        print(f"  [FAIL] Cost calculation test failed: {e}")
        return False

def test_database_schema():
    """Verify database schema includes higgsfield_jobs table."""
    print("Testing database schema...")
    try:
        from generation import Studio
        from pathlib import Path
        import sqlite3
        import tempfile
        
        # Create a temporary studio
        with tempfile.TemporaryDirectory() as tmpdir:
            studio = Studio(tmpdir, None, None)
            
            # Check if higgsfield_jobs table exists
            with studio.db() as conn:
                cursor = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='higgsfield_jobs'"
                )
                if not cursor.fetchone():
                    print("  [FAIL] higgsfield_jobs table not found in schema")
                    return False
                
                # Verify required columns
                cursor = conn.execute("PRAGMA table_info(higgsfield_jobs)")
                columns = {row[1] for row in cursor.fetchall()}
                required = {'id', 'user_id', 'model', 'status', 'provider_job_id', 'script', 
                           'duration_s', 'estimated_cost_cents', 'actual_cost_cents', 'video_url', 'error', 'created_at', 'updated_at'}
                missing = required - columns
                if missing:
                    print(f"  [FAIL] Missing columns: {missing}")
                    return False
        
        print("  [PASS] Database schema valid")
        return True
    except Exception as e:
        print(f"  [FAIL] Database schema test failed: {e}")
        return False

def test_app_integration():
    """Verify app.py includes Higgsfield integration code."""
    print("Testing app.py Flask integration...")
    try:
        with open('app.py', 'r') as f:
            content = f.read()
        
        if 'HiggsFieldIntegration' not in content:
            print("  [FAIL] HiggsFieldIntegration not imported in app.py")
            return False
        
        if 'budget = BudgetGuard' not in content:
            print("  [FAIL] BudgetGuard not initialized in app.py")
            return False
        
        if 'provider = HiggsFieldProvider' not in content:
            print("  [FAIL] HiggsFieldProvider not initialized in app.py")
            return False
        
        print("  [PASS] app.py Flask integration valid")
        return True
    except Exception as e:
        print(f"  [FAIL] app.py integration test failed: {e}")
        return False

def test_react_integration():
    """Verify App.tsx includes HiggsField workflow."""
    print("Testing App.tsx React integration...")
    try:
        with open('src/App.tsx', 'r') as f:
            content = f.read()
        
        if "import { HiggsFieldWorkflow }" not in content:
            print("  [FAIL] HiggsFieldWorkflow not imported in App.tsx")
            return False
        
        if "'higgsfield'" not in content or "tab === 'higgsfield'" not in content:
            print("  [FAIL] higgsfield tab not added to App.tsx")
            return False
        
        print("  [PASS] App.tsx React integration valid")
        return True
    except Exception as e:
        print(f"  [FAIL] App.tsx integration test failed: {e}")
        return False

def main():
    """Run all validation tests."""
    print("\n" + "=" * 60)
    print("ShopReel AI - Higgsfield Integration Validation")
    print("=" * 60 + "\n")
    
    tests = [
        test_budget_guard,
        test_script_parser,
        test_higgsfield_provider,
        test_higgsfield_routes,
        test_cost_calculations,
        test_database_schema,
        test_app_integration,
        test_react_integration,
    ]
    
    results = []
    for test in tests:
        try:
            result = test()
            results.append(result)
        except Exception as e:
            print(f"  [FAIL] Unexpected error: {e}")
            results.append(False)
        print()
    
    # Summary
    passed = sum(results)
    total = len(results)
    print("=" * 60)
    print(f"Results: {passed}/{total} tests passed")
    print("=" * 60 + "\n")
    
    if all(results):
        print("[SUCCESS] All integration validations passed!")
        print("\nNext steps:")
        print("  1. Run: npm run dev")
        print("  2. Open: http://localhost:5050")
        print("  3. Click: 'AI-Powered Video' tab")
        print("  4. Test: Upload image -> Parse script -> Preview cost")
        return 0
    else:
        print("[FAILURE] Some validations failed. Please fix the issues above.")
        return 1

if __name__ == '__main__':
    sys.exit(main())

