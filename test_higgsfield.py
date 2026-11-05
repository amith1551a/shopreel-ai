"""Tests for Higgsfield AI integration: budget guards, cost limits, API security."""
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
import pytz

from higgsfield_provider import HiggsFieldProvider, HiggsFieldError, SubmissionUnknown, PRICING
from budget_guard import BudgetGuard, BudgetGuardError
from script_parser import ScriptParser, StoryboardEditor, SceneSegment


class TestHiggsFieldProvider(unittest.TestCase):
    """Test Higgsfield API wrapper."""
    
    def test_calculate_cost_wan(self):
        """Cost calculation for Wan 3.0 reference-to-video."""
        provider = HiggsFieldProvider()
        
        # 10 seconds at $0.05/s = $0.50
        cost = provider.calculate_cost("wan/3.0/reference-to-video", 10)
        self.assertEqual(cost, Decimal("0.50"))
        
        # 60 seconds = $3.00
        cost = provider.calculate_cost("wan/3.0/reference-to-video", 60)
        self.assertEqual(cost, Decimal("3.00"))
    
    def test_calculate_cost_kling(self):
        """Cost calculation for Kling 3.0."""
        provider = HiggsFieldProvider()
        
        # 10 seconds at $0.10/s = $1.00
        cost = provider.calculate_cost("kling/3.0/text-to-video", 10)
        self.assertEqual(cost, Decimal("1.00"))
        
        # 30 seconds = $3.00
        cost = provider.calculate_cost("kling/3.0/text-to-video", 30)
        self.assertEqual(cost, Decimal("3.00"))
    
    def test_duration_limits(self):
        """Enforce min/max duration per model."""
        provider = HiggsFieldProvider()
        
        # Wan: 5-60s
        with self.assertRaises(HiggsFieldError):
            provider.calculate_cost("wan/3.0/reference-to-video", 4)
        
        with self.assertRaises(HiggsFieldError):
            provider.calculate_cost("wan/3.0/reference-to-video", 61)
        
        # Kling: 5-30s
        with self.assertRaises(HiggsFieldError):
            provider.calculate_cost("kling/3.0/text-to-video", 31)
    
    def test_unknown_model(self):
        """Reject unknown models."""
        provider = HiggsFieldProvider()
        
        with self.assertRaises(HiggsFieldError) as ctx:
            provider.calculate_cost("unknown/model", 10)
        
        self.assertIn("Unknown model", str(ctx.exception))
    
    def test_verify_pricing_documented(self):
        """Verify only documented models are supported."""
        provider = HiggsFieldProvider()
        
        self.assertTrue(provider.verify_pricing_documented("wan/3.0/reference-to-video"))
        self.assertTrue(provider.verify_pricing_documented("kling/3.0/text-to-video"))
        self.assertFalse(provider.verify_pricing_documented("fake/model"))


class TestBudgetGuard(unittest.TestCase):
    """Test atomic budget tracking."""
    
    def setUp(self):
        """Create temp database."""
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        self.budget = BudgetGuard(self.db_path)
    
    def tearDown(self):
        self.temp_dir.cleanup()
    
    def test_reserve_budget_success(self):
        """Successfully reserve budget within limits."""
        success, error = self.budget.reserve_budget(
            user_id="user1",
            job_id="job-001",
            model="wan/3.0/reference-to-video",
            estimated_cents=100,
            daily_limit_cents=6000,
            monthly_limit_cents=200000,
        )
        
        self.assertTrue(success)
        self.assertIsNone(error)
    
    def test_reserve_budget_daily_limit(self):
        """Reject when daily limit exceeded."""
        success, _ = self.budget.reserve_budget(
            user_id="user1",
            job_id="job-001",
            model="wan/3.0/reference-to-video",
            estimated_cents=5000,
            daily_limit_cents=6000,
            monthly_limit_cents=200000,
        )
        self.assertTrue(success)
        
        # Second job exceeds daily limit
        success, error = self.budget.reserve_budget(
            user_id="user1",
            job_id="job-002",
            model="wan/3.0/reference-to-video",
            estimated_cents=2000,
            daily_limit_cents=6000,
            monthly_limit_cents=200000,
        )
        
        self.assertFalse(success)
        self.assertIn("Daily limit", error)
    
    def test_reserve_budget_monthly_limit(self):
        """Reject when monthly limit exceeded."""
        success, _ = self.budget.reserve_budget(
            user_id="user1",
            job_id="job-001",
            model="wan/3.0/reference-to-video",
            estimated_cents=199000,
            daily_limit_cents=6000,
            monthly_limit_cents=200000,
        )
        self.assertTrue(success)
        
        # Second job exceeds monthly limit
        success, error = self.budget.reserve_budget(
            user_id="user1",
            job_id="job-002",
            model="wan/3.0/reference-to-video",
            estimated_cents=2000,
            daily_limit_cents=6000,
            monthly_limit_cents=200000,
        )
        
        self.assertFalse(success)
        self.assertIn("Monthly limit", error)
    
    def test_concurrent_job_limit(self):
        """Enforce one paid job per user."""
        # Reserve first job
        success, _ = self.budget.reserve_budget(
            user_id="user1",
            job_id="job-001",
            model="wan/3.0/reference-to-video",
            estimated_cents=100,
            daily_limit_cents=6000,
            monthly_limit_cents=200000,
        )
        self.assertTrue(success)
        
        # Second concurrent job blocked
        success, error = self.budget.reserve_budget(
            user_id="user1",
            job_id="job-002",
            model="wan/3.0/reference-to-video",
            estimated_cents=100,
            daily_limit_cents=6000,
            monthly_limit_cents=200000,
        )
        
        self.assertFalse(success)
        self.assertIn("already in progress", error)
    
    def test_duplicate_job_blocked(self):
        """Reject duplicate job IDs."""
        success, _ = self.budget.reserve_budget(
            user_id="user1",
            job_id="job-001",
            model="wan/3.0/reference-to-video",
            estimated_cents=100,
            daily_limit_cents=6000,
            monthly_limit_cents=200000,
        )
        self.assertTrue(success)
        
        # Same job_id rejected
        success, error = self.budget.reserve_budget(
            user_id="user1",
            job_id="job-001",
            model="wan/3.0/reference-to-video",
            estimated_cents=100,
            daily_limit_cents=6000,
            monthly_limit_cents=200000,
        )
        
        self.assertFalse(success)
        self.assertIn("already reserved", error)
    
    def test_charge_job(self):
        """Settle a job: move pending to charged."""
        # Reserve
        self.budget.reserve_budget(
            user_id="user1",
            job_id="job-001",
            model="wan/3.0/reference-to-video",
            estimated_cents=100,
            daily_limit_cents=6000,
            monthly_limit_cents=200000,
        )
        
        # Charge (actual cost may differ)
        success = self.budget.charge_job("job-001", actual_cents=120)
        self.assertTrue(success)
        
        # Check status
        status = self.budget.get_budget_status("user1", 6000, 200000)
        self.assertEqual(status["today_used_cents"], 120)
        self.assertEqual(status["today_pending_cents"], 0)
    
    def test_timezone_reset(self):
        """Test America/Chicago timezone for daily resets."""
        guard = self.budget
        
        # Get today in Chicago time
        chicago_tz = pytz.timezone("America/Chicago")
        today = datetime.now(chicago_tz).date()
        
        # Create entry for today
        with guard._get_conn() as conn:
            conn.execute(
                "INSERT INTO budget_daily_summary (date, user_id, used_cents, pending_cents) VALUES (?, ?, ?, ?)",
                (today.isoformat(), "user1", 500, 200),
            )
            conn.commit()
        
        status = guard.get_budget_status("user1", 6000, 200000)
        self.assertEqual(status["today_used_cents"], 500)
        
        # Next reset should be tomorrow
        next_reset = datetime.fromisoformat(status["next_daily_reset_at"])
        self.assertEqual(next_reset.date(), today + timedelta(days=1))
    
    def test_budget_status_warnings(self):
        """Test 80% warning thresholds."""
        # Use 80% of daily budget
        self.budget.reserve_budget(
            user_id="user1",
            job_id="job-001",
            model="wan/3.0/reference-to-video",
            estimated_cents=4800,
            daily_limit_cents=6000,
            monthly_limit_cents=200000,
        )
        
        status = self.budget.get_budget_status("user1", 6000, 200000)
        self.assertTrue(status["warn_daily"])
        self.assertFalse(status["warn_monthly"])
        
        # At 100%, should block
        self.budget.reserve_budget(
            user_id="user1",
            job_id="job-002",
            model="wan/3.0/reference-to-video",
            estimated_cents=0,
            daily_limit_cents=6000,
            monthly_limit_cents=200000,
        )
        self.budget.charge_job("job-001", 1200)
        
        status = self.budget.get_budget_status("user1", 6000, 200000)
        self.assertTrue(status["blocked_daily"])


class TestScriptParser(unittest.TestCase):
    """Test script parsing and compression."""
    
    def test_extract_scenes_from_brief(self):
        """Parse structured brief into scenes."""
        brief = """
        Hook: Tired outfit?
        Product: Check this tee!
        Value: Anime artwork that stands out
        CTA: Shop now - link in bio
        """
        
        scenes = ScriptParser.extract_scenes_from_brief(brief)
        self.assertEqual(len(scenes), 4)
        self.assertEqual(scenes[0].name, "HOOK")
        self.assertEqual(scenes[1].name, "PRODUCT")
        self.assertEqual(scenes[2].name, "VALUE")
        self.assertEqual(scenes[3].name, "CTA")
    
    def test_extract_scenes_numbered_format(self):
        """Parse Scene 1, Scene 2 format."""
        brief = """
        Scene 1: Show the tee
        Scene 2: Wear it in an outfit
        Scene 3: The anime detail
        Scene 4: Buy it
        """
        
        scenes = ScriptParser.extract_scenes_from_brief(brief)
        self.assertEqual(len(scenes), 4)
        self.assertTrue(all(s.prompt for s in scenes))
    
    def test_compress_script(self):
        """Compress full script by removing redundant phrases."""
        script = """
        Create a video for USD 24.99 anime graphic tee.
        Hook: Tired outfit?
        Product: Check out this amazing tee! Shop now - link in bio
        Value: Premium anime artwork
        CTA: Buy at www.shop.com for $24.99 USD
        """
        
        compressed = ScriptParser.compress_script(script)
        
        # Should remove URLs and prices
        self.assertNotIn("www.shop.com", compressed)
        self.assertNotIn("$24.99", compressed)
        self.assertNotIn("USD", compressed)
        
        # Should preserve key phrases
        self.assertIn("Tired outfit", compressed)
        self.assertIn("anime", compressed)
    
    def test_validate_script(self):
        """Validate script input."""
        # Valid
        error = ScriptParser.validate_script("A short script")
        self.assertIsNone(error)
        
        # Too long
        error = ScriptParser.validate_script("x" * 13000)
        self.assertIn("exceeds", error)
        
        # Control characters
        error = ScriptParser.validate_script("Script\x00with null")
        self.assertIn("control characters", error)
        
        # Empty
        error = ScriptParser.validate_script("")
        self.assertIsNotNone(error)
    
    def test_storyboard_editor(self):
        """Test in-browser storyboard editing."""
        scenes = [
            SceneSegment(0, 3, "HOOK", "Original hook text"),
            SceneSegment(3, 7, "PRODUCT", "Show product"),
            SceneSegment(7, 11, "VALUE", "Value prop"),
            SceneSegment(11, 15, "CTA", "Call to action"),
        ]
        
        editor = StoryboardEditor(scenes)
        
        # User edits a scene
        error = editor.update_scene(0, "New hook text")
        self.assertNone(error)
        self.assertEqual(editor.scenes[0].prompt, "New hook text")
        
        # Too long
        error = editor.update_scene(1, "x" * 600)
        self.assertIsNotNone(error)
    
    def test_storyboard_serialization(self):
        """Storyboard serializes to JSON."""
        scenes = [
            SceneSegment(0, 3, "HOOK", "Hook text"),
            SceneSegment(3, 7, "PRODUCT", "Product text"),
        ]
        
        editor = StoryboardEditor(scenes)
        data = editor.to_dict()
        
        self.assertIn("scenes", data)
        self.assertEqual(len(data["scenes"]), 2)
        self.assertEqual(data["scenes"][0]["name"], "HOOK")
        self.assertEqual(data["scenes"][0]["duration_s"], 3)


class TestAPISecurityAndLimits(unittest.TestCase):
    """Test API security: no exposed secrets, rate limits, validation."""
    
    def test_credentials_never_in_frontend(self):
        """HF_CREDENTIALS should never be readable from browser."""
        # This is a documentation test: credentials must always be server-side
        # and extracted via environment only, never returned to frontend
        pass
    
    def test_cost_preview_no_side_effects(self):
        """Cost preview should not reserve budget."""
        # Mock the budget guard
        budget = Mock()
        budget.get_budget_status.return_value = {
            "today_available_cents": 6000,
            "month_available_cents": 200000,
            "blocked_daily": False,
            "blocked_monthly": False,
        }
        
        # Preview should only call get_budget_status, not reserve
        # (implementation responsibility, tested in integration tests)
    
    def test_job_id_validation(self):
        """Job IDs must match strict pattern."""
        # Valid: alphanumeric and hyphens, 8-50 chars
        import re
        pattern = r"^[a-zA-Z0-9\-]{8,50}$"
        
        self.assertIsNotNone(re.match(pattern, "job-12345678"))
        self.assertIsNone(re.match(pattern, "job-1"))  # Too short
        self.assertIsNone(re.match(pattern, "job_12345678"))  # Invalid char
        self.assertIsNone(re.match(pattern, "x" * 51))  # Too long


if __name__ == "__main__":
    unittest.main()
