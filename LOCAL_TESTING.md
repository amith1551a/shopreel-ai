# Local Testing & Validation Checklist

## Prerequisites

Before running tests, ensure:

```bash
# Install Python dependencies
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Install Node dependencies
npm install

# Create .env.local (for local testing only)
cat > .env.local << 'EOF'
HF_CREDENTIALS=test-key-id:test-key-secret
HF_MONTHLY_BUDGET_CENTS=2000
HF_DAILY_BUDGET_CENTS=60
HF_JOB_BUDGET_CENTS=25
HF_CONCURRENT_PAID_JOBS=1
EOF
```

---

## Unit Tests (Mock API)

Run these tests **without** real Higgsfield credentials:

```bash
# Run all Higgsfield tests
python -m pytest test_higgsfield.py -v

# Run specific test class
python -m pytest test_higgsfield.py::TestBudgetGuard -v

# Run with coverage
python -m pytest test_higgsfield.py --cov=. --cov-report=html
```

### Expected Test Results

**TestHiggsFieldProvider** (5 tests):
- ✅ `test_calculate_cost_wan`: Wan model at $0.05/s
- ✅ `test_calculate_cost_kling`: Kling model at $0.10/s
- ✅ `test_duration_limits`: Enforce 5-60s range per model
- ✅ `test_unknown_model`: Reject invalid models
- ✅ `test_verify_pricing_documented`: Only documented models allowed

**TestBudgetGuard** (9 tests):
- ✅ `test_reserve_budget_success`: Reserve within limits
- ✅ `test_reserve_budget_daily_limit`: Reject over daily limit
- ✅ `test_reserve_budget_monthly_limit`: Reject over monthly limit
- ✅ `test_concurrent_job_limit`: Enforce one paid job per user
- ✅ `test_duplicate_job_blocked`: Prevent duplicate submissions
- ✅ `test_charge_job`: Settle job (pending → charged)
- ✅ `test_timezone_reset`: America/Chicago daily reset
- ✅ `test_budget_status_warnings`: Warn at 80%, block at 100%

**TestScriptParser** (6 tests):
- ✅ `test_extract_scenes_from_brief`: Parse structured brief
- ✅ `test_extract_scenes_numbered_format`: Parse Scene N format
- ✅ `test_compress_script`: Remove redundant phrases
- ✅ `test_validate_script`: Validate input
- ✅ `test_storyboard_editor`: Edit scenes in-browser
- ✅ `test_storyboard_serialization`: Serialize to JSON

**TestAPISecurityAndLimits** (3 tests):
- ✅ `test_credentials_never_in_frontend`: Documentation test
- ✅ `test_cost_preview_no_side_effects`: Preview is read-only
- ✅ `test_job_id_validation`: Strict job_id pattern

**Total: 23 tests**

---

## Build & Lint

```bash
# TypeScript type check
npm run typecheck

# Lint (ESLint)
npm run lint

# Build production bundle
npm run build
```

Expected output:
```
✓ dist/index.html
✓ dist/index.js (gzipped)
✓ dist/index.css (gzipped)
✓ No TypeScript errors
✓ No ESLint violations
```

---

## Local Server & Manual Testing

### Terminal 1: Start Node.js Server

```bash
npm run start
```

Expected output:
```
ShopReel AI with Higgsfield Integration
Server listening on http://localhost:5050
Database: data/studio.sqlite3
Budget guard: data/higgsfield.sqlite3
```

### Terminal 2: Test Endpoints

#### 1. Parse Script (No Cost)

```bash
curl -X POST http://localhost:5050/api/higgsfield/parse-script \
  -H "Content-Type: application/json" \
  -d '{
    "script": "Hook: Tired outfit?\nProduct: Check this tee!\nValue: Anime artwork\nCTA: Shop now"
  }' | jq .
```

Expected response:
```json
{
  "storyboard": {
    "scenes": [
      {
        "id": "scene-0",
        "name": "HOOK",
        "start_s": 0,
        "end_s": 3,
        "prompt": "Tired outfit?",
        "duration_s": 3
      },
      // ... more scenes
    ]
  },
  "original_script": "...",
  "compressed": "..."
}
```

#### 2. Preview Cost (No Commitment)

```bash
curl -X POST http://localhost:5050/api/higgsfield/preview-cost \
  -H "Content-Type: application/json" \
  -d '{
    "model": "wan/3.0/reference-to-video",
    "duration_seconds": 10,
    "user_id": "test-user"
  }' | jq .
```

Expected response (first call):
```json
{
  "model": "wan/3.0/reference-to-video",
  "duration_seconds": 10,
  "estimated_cost_usd": 0.50,
  "estimated_cost_cents": 50,
  "budget": {
    "today_used_cents": 0,
    "today_pending_cents": 0,
    "today_available_cents": 6000,
    "today_percent": 0,
    "month_used_cents": 0,
    "month_available_cents": 200000,
    "month_percent": 0,
    "can_proceed": true
  }
}
```

#### 3. Check Budget

```bash
curl "http://localhost:5050/api/higgsfield/budget?user_id=test-user" | jq .
```

Expected response:
```json
{
  "user_id": "test-user",
  "today": {
    "used_cents": 0,
    "pending_cents": 0,
    "available_cents": 6000,
    "limit_cents": 6000,
    "percent": 0,
    "blocked": false
  },
  "month": {
    "used_cents": 0,
    "pending_cents": 0,
    "available_cents": 200000,
    "limit_cents": 200000,
    "percent": 0,
    "blocked": false
  },
  "next_daily_reset_at": "2026-11-06T06:00:00-06:00",
  "warn": false
}
```

#### 4. Submit Job (Requires Mock Provider)

Without real Higgsfield credentials, this will fail. To test with mocking:

```bash
# Create a test with mock
python3 << 'EOF'
from unittest.mock import patch, MagicMock
from higgsfield_provider import HiggsFieldProvider

# Mock the client
with patch('higgsfield_provider.higgsfield_client') as mock_client:
    mock_client.submit.return_value = {"id": "test-job-123", "status": "queued"}
    
    provider = HiggsFieldProvider()
    provider.client = mock_client
    provider.credentials = "test-key:test-secret"
    
    from pathlib import Path
    
    # Create a dummy image
    test_image = Path("test_image.png")
    test_image.write_bytes(b"PNG_DATA")
    
    result = provider.submit_reference_to_video(
        image_path=test_image,
        script="Test script",
        duration_seconds=10
    )
    
    print(f"✓ Mock submission succeeded: {result}")
    test_image.unlink()
EOF
```

#### 5. Check Job Status (Polling)

After submitting a job:

```bash
curl "http://localhost:5050/api/higgsfield/job/job-123/status?user_id=test-user" | jq .
```

Expected response:
```json
{
  "job_id": "job-123",
  "status": "queued",
  "progress": 0,
  "video_url": null,
  "error": null,
  "estimated_cost_usd": 0.50,
  "actual_cost_usd": null,
  "created_at": "2026-11-05T17:08:49Z",
  "updated_at": "2026-11-05T17:08:49Z"
}
```

---

## Browser Testing

### Open http://localhost:5050

1. **Verify Page Loads**
   - ✅ Home page displays
   - ✅ "Create a video" tab visible
   - ✅ No console errors

2. **Verify Existing Features (Backward Compatibility)**
   - ✅ Photo upload works
   - ✅ Video prompt input works
   - ✅ Settings form accepts input
   - ✅ Free local rendering still available

3. **Test Free Features (No Cost)**
   - ✅ Parse script endpoint works
   - ✅ Cost preview calculates correctly
   - ✅ Budget display updates
   - ✅ Storyboard editor opens (if integrated into UI)

---

## Security Validation

### 1. No Exposed Credentials

```bash
# Search for secrets in source code
grep -r "HF_CREDENTIALS" src/
grep -r "replace_with" src/
grep -r "your-key" src/

# Should return: NOTHING (no hardcoded secrets in frontend code)
```

Expected: Empty output (no matches)

### 2. No API Calls Without Approval

Verify that:
- ✅ `/api/higgsfield/parse-script` has no side effects (read-only)
- ✅ `/api/higgsfield/preview-cost` does NOT reserve budget
- ✅ Only `/api/higgsfield/submit-job` atomically reserves

```bash
# Check database before/after preview
sqlite3 data/higgsfield.sqlite3 "SELECT COUNT(*) FROM budget_ledger;" # Should be 0
curl -X POST http://localhost:5050/api/higgsfield/preview-cost ...
sqlite3 data/higgsfield.sqlite3 "SELECT COUNT(*) FROM budget_ledger;" # Should still be 0
```

### 3. Rate Limiting (Optional, if implemented)

```bash
# Send 100 requests rapidly
for i in {1..100}; do
  curl -X POST http://localhost:5050/api/higgsfield/preview-cost -H "Content-Type: application/json" -d '{}' &
done
wait

# Should see 429 (Too Many Requests) errors after threshold
```

### 4. Price Validation Server-Side

```bash
# Attempt to submit with invalid price
curl -X POST http://localhost:5050/api/higgsfield/submit-job \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-job",
    "user_id": "attacker",
    "model": "invalid-model",
    "script": "...",
    "duration_seconds": 10000
  }'

# Should return 400 (Bad Request), not process
```

Expected: `{"error": "Unknown model: invalid-model"}`

---

## Database Integrity

### Check Schema

```bash
sqlite3 data/higgsfield.sqlite3 ".schema"
```

Expected tables:
- ✅ `budget_ledger` (jobs and costs)
- ✅ `budget_daily_summary` (daily tracking)
- ✅ `budget_monthly_summary` (monthly tracking)

```bash
sqlite3 data/studio.sqlite3 ".schema higgsfield_jobs"
```

Expected table:
- ✅ `higgsfield_jobs` (job tracking for UI)

### Check Budget Calculations

```bash
# Simulate a job reservation and charging
python3 << 'EOF'
from budget_guard import BudgetGuard
from pathlib import Path
import tempfile

with tempfile.TemporaryDirectory() as tmpdir:
    guard = BudgetGuard(Path(tmpdir) / "test.db")
    
    # Reserve
    success, err = guard.reserve_budget(
        user_id="test", job_id="job-1", model="wan", 
        estimated_cents=100, daily_limit_cents=6000, monthly_limit_cents=200000
    )
    print(f"✓ Reserve: {success}")
    
    # Check status (pending)
    status = guard.get_budget_status("test", 6000, 200000)
    print(f"✓ Pending: {status['today_pending_cents']} cents")
    
    # Charge
    guard.charge_job("job-1", actual_cents=120)
    
    # Check status (settled)
    status = guard.get_budget_status("test", 6000, 200000)
    print(f"✓ Charged: {status['today_used_cents']} cents")
EOF
```

Expected output:
```
✓ Reserve: True
✓ Pending: 100 cents
✓ Charged: 120 cents
```

---

## Edge Cases

### Test Daily Reset

```bash
# Check reset time (should be Chicago midnight)
python3 << 'EOF'
from budget_guard import BudgetGuard
from pathlib import Path
import tempfile
from datetime import datetime
import pytz

with tempfile.TemporaryDirectory() as tmpdir:
    guard = BudgetGuard(Path(tmpdir) / "test.db")
    status = guard.get_budget_status("test", 6000, 200000)
    
    next_reset = datetime.fromisoformat(status["next_daily_reset_at"])
    chicago = pytz.timezone("America/Chicago")
    
    # Should be tomorrow at 00:00 Chicago time
    print(f"Next reset: {next_reset}")
    print(f"Timezone: {next_reset.tzinfo}")
    print(f"✓ Is Chicago timezone: {str(next_reset.tzinfo) == 'America/Chicago' or next_reset.tzname() in ('CST', 'CDT')}")
EOF
```

### Test Over-Budget Blocking

```bash
# Try to spend more than available
python3 << 'EOF'
from budget_guard import BudgetGuard
from pathlib import Path
import tempfile

with tempfile.TemporaryDirectory() as tmpdir:
    guard = BudgetGuard(Path(tmpdir) / "test.db")
    
    # Use 90% of daily budget
    success, _ = guard.reserve_budget("user", "job-1", "model", 5400, 6000, 200000)
    print(f"✓ First job (90%): {success}")
    
    # Try to use 20% more (would exceed)
    success, err = guard.reserve_budget("user", "job-2", "model", 1200, 6000, 200000)
    print(f"✓ Second job blocked: {not success}")
    print(f"✓ Error message: {err}")
EOF
```

Expected output:
```
✓ First job (90%): True
✓ Second job blocked: True
✓ Error message: Daily limit reached. $0.60 available.
```

---

## Performance Checks

### Parse Speed

```bash
time curl -X POST http://localhost:5050/api/higgsfield/parse-script \
  -H "Content-Type: application/json" \
  -d '{
    "script": "Very long script with 50 sentences..."
  }' > /dev/null
```

Expected: < 100ms

### Cost Preview Speed

```bash
time curl -X POST http://localhost:5050/api/higgsfield/preview-cost \
  -H "Content-Type: application/json" \
  -d '{"model": "wan/3.0/reference-to-video", "duration_seconds": 10}' > /dev/null
```

Expected: < 50ms

### Budget Status Speed

```bash
time curl http://localhost:5050/api/higgsfield/budget?user_id=test-user > /dev/null
```

Expected: < 50ms

---

## Final Checklist Before Hostinger Deployment

- ✅ All unit tests pass (`pytest test_higgsfield.py -v`)
- ✅ TypeScript compiles without errors (`npm run typecheck`)
- ✅ No ESLint violations (`npm run lint`)
- ✅ Production bundle builds (`npm run build`)
- ✅ All API endpoints respond correctly
- ✅ No hardcoded credentials in source code
- ✅ Budget calculations are accurate
- ✅ Database schema is correct
- ✅ Security headers are set (CSP, X-Frame-Options, etc.)
- ✅ `.env` and `.env.local` are in `.gitignore`
- ✅ Credentials can be read from environment variables
- ✅ Existing ShopReel features still work
- ✅ Free features have no API cost
- ✅ Paid features are clearly labeled with cost preview
- ✅ Documentation is complete and accurate

---

**When all checks pass:** Ready for Hostinger deployment!
