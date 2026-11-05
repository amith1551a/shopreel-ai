# 🎯 Higgsfield Integration - Quick Reference Card

Print this or bookmark for quick lookup during testing.

---

## 📂 File Locations

```
ShopReel AI/
├── status/next actions → STATUS_AND_NEXT_ACTIONS.md
├── quick testing (35 min) → QUICK_START.md
├── API reference → HIGGSFIELD_GUIDE.md
├── testing guide → LOCAL_TESTING.md
├── overview → INTEGRATION_SUMMARY.md
│
├── Backend:
│   ├── higgsfield_provider.py (SDK wrapper)
│   ├── budget_guard.py (Budget tracking)
│   ├── script_parser.py (Script parsing)
│   ├── higgsfield_routes.py (API endpoints)
│   └── generation.py (Modified: add schema)
│
├── Frontend:
│   ├── src/higgsfield.ts (Client library)
│   └── src/HiggsFieldWorkflow.tsx (UI component)
│
└── Testing:
    └── test_higgsfield.py (23 unit tests)
```

---

## ⚡ Quick Commands

### Install & Verify
```bash
# Install Python dependencies
pip install -r requirements.txt

# Install Node dependencies
npm install

# Check Python imports
python -c "import higgsfield_provider, budget_guard, script_parser; print('✓ OK')"
```

### Create .env.local
**Windows PowerShell:**
```powershell
@"
HF_CREDENTIALS=test-key-id:test-key-secret
HF_MONTHLY_BUDGET_CENTS=2000
HF_DAILY_BUDGET_CENTS=60
HF_JOB_BUDGET_CENTS=25
HF_CONCURRENT_PAID_JOBS=1
"@ | Out-File -Encoding UTF8 .env.local
```

**Mac/Linux:**
```bash
cat > .env.local << 'EOF'
HF_CREDENTIALS=test-key-id:test-key-secret
HF_MONTHLY_BUDGET_CENTS=2000
HF_DAILY_BUDGET_CENTS=60
HF_JOB_BUDGET_CENTS=25
HF_CONCURRENT_PAID_JOBS=1
EOF
```

### Run Tests
```bash
# All tests (expect 23 PASSED)
python -m pytest test_higgsfield.py -v

# Specific test
python -m pytest test_higgsfield.py::TestBudgetGuard -v

# With output
python -m pytest test_higgsfield.py -vv -s
```

### Build & Check
```bash
# Type check
npm run typecheck

# Lint
npm run lint

# Build
npm run build
```

### Start Server
```bash
npm run start
# Expected: listening on http://localhost:5050
```

### Test Endpoints (Terminal 2)
```bash
# Check budget
curl "http://localhost:5050/api/higgsfield/budget?user_id=test"

# Parse script
curl -X POST http://localhost:5050/api/higgsfield/parse-script \
  -H "Content-Type: application/json" \
  -d "{\"script\": \"Hook: Hi\nProduct: Product\nValue: Value\nCTA: Buy\"}"

# Preview cost
curl -X POST http://localhost:5050/api/higgsfield/preview-cost \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"wan/3.0/reference-to-video\", \"duration_seconds\": 10, \"user_id\": \"test\"}"
```

---

## 📊 Budget Limits (USD)

| Limit | Amount | Resets |
|-------|--------|--------|
| Daily | $0.60 (6000¢) | Midnight Chicago time |
| Monthly | $20.00 (200000¢) | 1st of month |
| Per-Job | $0.25 (2500¢) | N/A |
| Concurrent Paid | 1 job | Per user |

**Warning:** 80% of limit  
**Blocking:** 100% of limit (paid generation blocked; free editing OK)

---

## 🔒 API Endpoints (5 total)

### Free (No Cost, No Side Effects)

```bash
# 1. Parse script into storyboard
POST /api/higgsfield/parse-script
{script: string}
→ {storyboard, compressed, original_script}

# 2. Preview cost (no reserve)
POST /api/higgsfield/preview-cost
{model: string, duration_seconds: number, user_id: string}
→ {estimated_cost_usd, budget_status, can_proceed}

# 3. Check budget status
GET /api/higgsfield/budget?user_id=...
→ {today{}, month{}, next_daily_reset_at, warn}

# 4. Poll job status
GET /api/higgsfield/job/{job_id}/status?user_id=...
→ {status, progress, video_url, error, costs}
```

### Paid (Atomically Reserves Budget)

```bash
# 5. Submit generation job
POST /api/higgsfield/submit-job
{job_id, user_id, model, script, duration_seconds, image_project_id?}
→ {job_id, status, estimated_cost_usd, budget_status}
Error 402: {error, budget_status} if over budget
```

---

## ✅ Test Checklist (35 min)

- [ ] Install dependencies (5 min)
- [ ] Create .env.local (2 min)
- [ ] Run tests: `pytest test_higgsfield.py -v` (5 min)
  - Expected: ✅ 23 PASSED
- [ ] Build: `npm run typecheck && npm run lint && npm run build` (5 min)
- [ ] Start: `npm run start` (3 min)
- [ ] Test endpoints with curl (5 min)
  - 4 free endpoints respond
  - Budget shows correct limits
- [ ] Review code (no secrets) (5 min)

**Total:** ~35 minutes

---

## 🚨 Common Issues & Fixes

| Issue | Solution |
|-------|----------|
| "ModuleNotFoundError: higgsfield_provider" | Run: `pip install -r requirements.txt` |
| "Port 5050 already in use" | Kill old process or use different port |
| "TypeError: higgsfield_client is None" | This is OK—mock tests work around it |
| "Database locked" | Delete: `rm -f data/generation-worker.lock` |
| Tests fail | Run: `pytest test_higgsfield.py -vv -s` for details |
| ESLint errors | Run: `npm run lint -- --fix` |

---

## 🎯 Decision Points

### After Tests Pass ✅

**Option 1: Deploy to Hostinger**
- Confirm: "All tests pass, deploy"
- I'll provide Hostinger steps

**Option 2: Request Changes**
- "Add feature X" or "Fix Y"
- I'll implement & re-test

**Option 3: Review Code First**
- "Show me security analysis"
- I'll explain & you review

---

## 🔑 Model Pricing

| Model | Cost | Duration |
|-------|------|----------|
| Wan 3.0 (ref-to-video) | $0.05/sec | 5-60 sec |
| Kling 3.0 (text-to-video) | $0.10/sec | 5-60 sec |

Example: 10 sec Wan 3.0 = $0.50  
Example: 10 sec Kling 3.0 = $1.00 (would exceed $0.25/job limit)

---

## 🗺️ Document Navigation

```
Quick Start? → QUICK_START.md
Want overview? → INTEGRATION_SUMMARY.md
Full API docs? → HIGGSFIELD_GUIDE.md
Testing help? → LOCAL_TESTING.md
Current status? → STATUS_AND_NEXT_ACTIONS.md
Deployment? → HIGGSFIELD_GUIDE.md (Deployment section)
Security? → HIGGSFIELD_GUIDE.md (Security Checklist section)
Troubleshooting? → HIGGSFIELD_GUIDE.md (Troubleshooting section)
```

---

## 🔐 Security Checklist

- ✅ Credentials in .env only (never committed)
- ✅ Budget validation server-side
- ✅ No secrets in source code
- ✅ Atomic transactions (no double-charge)
- ✅ One concurrent paid job per user
- ✅ Duplicate detection (idempotent)
- ⚠️ No rate limiting yet (TODO)

---

## 📞 If Stuck

**During local testing:**
1. Check QUICK_START.md (has troubleshooting)
2. Run: `pytest test_higgsfield.py -vv -s`
3. Check error message carefully
4. Share error + command with me

**During deployment:**
1. Check HIGGSFIELD_GUIDE.md (has troubleshooting)
2. Check server logs: `tail -100 output.log`
3. Verify .env variables set: `echo $HF_CREDENTIALS`
4. Share error + environment details with me

---

## ⏰ Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Local testing | 35 min | Ready for you |
| Bug fixes (if any) | 0-30 min | Depends on issues |
| Hostinger deployment | 30 min | After approval |
| Production verification | 10 min | Final check |
| **Total to live** | **~2 hours** | Flexible |

---

## 🎓 Three-Step Mental Model

```
1️⃣ USER SUBMITS JOB
   ↓
2️⃣ BACKEND RESERVES BUDGET (atomic)
   ↓
3️⃣ JOB SUBMITTED TO HIGGSFIELD
   ↓
4️⃣ USER POLLS STATUS (free)
   ↓
5️⃣ VIDEO READY
   ↓
6️⃣ ACTUAL COST CHARGED (pending → charged)

Budget is RESERVED before Higgsfield API call.
If Higgsfield fails, budget stays reserved (manual reconciliation).
No double-charge. No automatic retry.
```

---

## 🚀 Go Live Checklist

```
Before Hostinger:
  ☐ All 23 tests pass
  ☐ npm run build succeeds
  ☐ No secrets in git
  ☐ .env.local in .gitignore

On Hostinger:
  ☐ .env file created
  ☐ Environment variables set
  ☐ Python dependencies installed
  ☐ PM2 service running
  ☐ HTTPS enabled
  ☐ Test: curl https://yourdomain.com/api/higgsfield/budget?user_id=test

Production:
  ☐ Real Higgsfield API key active
  ☐ Monitoring logs
  ☐ Budget tracking working
  ☐ Video generation successful
```

---

**Print this card and keep it nearby during testing!** 📋

Last Updated: 2024
