# Quick Start: Higgsfield Integration on Your Machine

## 🎯 What You'll Do

In **30 minutes**, you'll:
1. Install dependencies
2. Run unit tests (23 tests)
3. Start local server
4. Manually test endpoints with curl
5. Verify UI integration (if implemented)
6. Decide: deploy to Hostinger or request changes

---

## ⚙️ Step 1: Install Dependencies (5 min)

```bash
cd "C:\Users\amith\OneDrive\Amithafterdec2021and25\Amith\1.All_resumes\1D.Github\0.All_AI\ShopReel AI"

# Activate Python virtual environment (if not active)
python -m venv venv
# On Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Install Node dependencies
npm install
```

**Verify:**
```bash
python -c "import higgsfield_provider, budget_guard, script_parser; print('✓ Python imports OK')"
npm list | grep "installed"
```

---

## ⚙️ Step 2: Create `.env.local` (2 min)

```bash
# Create in project root (Windows PowerShell)
@"
HF_CREDENTIALS=test-key-id:test-key-secret
HF_MONTHLY_BUDGET_CENTS=2000
HF_DAILY_BUDGET_CENTS=60
HF_JOB_BUDGET_CENTS=25
HF_CONCURRENT_PAID_JOBS=1
"@ | Out-File -Encoding UTF8 .env.local
```

**On Mac/Linux:**
```bash
cat > .env.local << 'EOF'
HF_CREDENTIALS=test-key-id:test-key-secret
HF_MONTHLY_BUDGET_CENTS=2000
HF_DAILY_BUDGET_CENTS=60
HF_JOB_BUDGET_CENTS=25
HF_CONCURRENT_PAID_JOBS=1
EOF
```

---

## 🧪 Step 3: Run Unit Tests (5 min)

```bash
# Run all tests
python -m pytest test_higgsfield.py -v

# Expected output:
# test_calculate_cost_wan PASSED
# test_calculate_cost_kling PASSED
# ... [23 tests total]
# ======================== 23 passed in 0.45s ========================
```

**All 23 should PASS. If any fail:**
```bash
# Run with more detail
python -m pytest test_higgsfield.py -vv -s

# Run specific test
python -m pytest test_higgsfield.py::TestBudgetGuard::test_reserve_budget_success -vv
```

---

## 🏗️ Step 4: Build & Lint (5 min)

```bash
# Type check
npm run typecheck

# Lint
npm run lint

# Build
npm run build
```

**Expected:** No errors, no warnings.

---

## 🚀 Step 5: Start Local Server (3 min)

**Terminal 1:**
```bash
npm run start
```

**Expected output:**
```
ShopReel AI with Higgsfield Integration
Server listening on http://localhost:5050
Database: data/studio.sqlite3
Budget guard: data/higgsfield.sqlite3
```

---

## 🧪 Step 6: Test Endpoints with Curl (5 min)

**Terminal 2:**

### 6A. Parse Script
```bash
curl -X POST http://localhost:5050/api/higgsfield/parse-script ^
  -H "Content-Type: application/json" ^
  -d "{\"script\": \"Hook: Tired outfit?\nProduct: Check this tee!\nValue: Anime artwork\nCTA: Shop now\"}" | more
```

**Look for:** `storyboard` with 4 scenes (HOOK, PRODUCT, VALUE, CTA)

### 6B. Check Budget
```bash
curl "http://localhost:5050/api/higgsfield/budget?user_id=test-user" | more
```

**Look for:** `today_available_cents: 6000`, `month_available_cents: 200000`, `warn: false`

### 6C. Preview Cost
```bash
curl -X POST http://localhost:5050/api/higgsfield/preview-cost ^
  -H "Content-Type: application/json" ^
  -d "{\"model\": \"wan/3.0/reference-to-video\", \"duration_seconds\": 10, \"user_id\": \"test-user\"}" | more
```

**Look for:** `estimated_cost_usd: 0.5`, `can_proceed: true`

---

## ✅ Step 7: Verification Checklist

- ✅ All 23 unit tests pass
- ✅ TypeScript compiles without errors
- ✅ ESLint has no violations
- ✅ Build succeeds (dist/ directory created)
- ✅ Server starts without errors
- ✅ `/api/higgsfield/parse-script` returns storyboard
- ✅ `/api/higgsfield/budget` shows correct limits
- ✅ `/api/higgsfield/preview-cost` calculates $0.50 for 10s at $0.05/s

**If all pass:** ✨ **Ready for Hostinger deployment!**

---

## 🔍 Troubleshooting

### "ModuleNotFoundError: No module named 'higgsfield_provider'"
```bash
# Make sure you're in the project root
cd "path\to\ShopReel AI"
# Reinstall dependencies
pip install -r requirements.txt
```

### "TypeError: higgsfield_client is None"
This is **expected**. The mock tests work around this.
Real Higgsfield SDK will be installed only when needed.

### "Port 5050 already in use"
```bash
# Kill process on port 5050 (Windows PowerShell)
Get-Process | Where-Object {$_.Port -eq 5050} | Stop-Process -Force

# On Mac/Linux:
lsof -ti:5050 | xargs kill -9
```

### "Database locked"
```bash
# Delete temporary lock files
rm -f data/generation-worker.lock
# Restart server
npm run start
```

---

## 📚 Key Documentation

| File | Purpose | Read When |
|------|---------|-----------|
| **INTEGRATION_SUMMARY.md** | Overview of all changes | Now |
| **HIGGSFIELD_GUIDE.md** | Complete setup & API docs | Before Hostinger |
| **LOCAL_TESTING.md** | Detailed testing procedures | For detailed testing |
| **.env.example** | Environment template | Deploying to Hostinger |
| **HIGGSFIELD_GUIDE.md → Deployment** | Hostinger deployment steps | Ready to go live |

---

## 🎓 Understanding the Integration

### Three Tiers of Usage

**1. FREE (Browser CPU, $0 cost)**
- Photo upload & editing
- Browser-based rendering (existing)
- Storyboard editor
- Music selection
- All local, no API calls

**2. FREE (API Calls, $0 cost)**
- Parse script → storyboard
- Preview cost (no reservation)
- Check budget
- Poll job status

**3. PAID (Higgsfield Generation, $0.05-$0.10/sec)**
- Submit generation job (atomically reserves budget)
- Real-time progress tracking
- Download MP4 video

### Budget Flow

```
User clicks "Generate"
    ↓
Preview cost calculated
    ↓
User approves
    ↓
Budget atomically reserved (if under limits)
    ↓
Job submitted to Higgsfield
    ↓
User polls status repeatedly (free)
    ↓
Video ready → Download
    ↓
Budget settled (pending → charged)
```

### Security

```
Frontend (Browser)         Backend (Server)
─────────────────         ────────────────

Parse script   ──────────→  Script parser
Cost preview   ──────────→  Price calc (validated)
Submit job     ──────────→  Budget check (atomic)
               ──────────→  Higgsfield API
Poll status    ──────────→  Query local DB

[Never exposes credentials or prices]
[All costs validated server-side]
[Budget changes atomic (SQLite)]
```

---

## 🎯 Next Decision Points

### After Verification ✓

**Option A: Deploy to Hostinger**
```bash
1. Read: HIGGSFIELD_GUIDE.md → "Deployment to Hostinger"
2. Export environment variables
3. Upload to Hostinger
4. Test: https://yourdomain.com/api/higgsfield/budget?user_id=test
5. Request: Real Higgsfield API key from Higgsfield team
```

**Option B: Request Changes**
```bash
If you see issues:
1. Document the problem
2. Provide steps to reproduce
3. I'll fix and re-test locally
4. We'll retry verification
```

**Option C: Additional Features**
```bash
Before deployment, you might want:
- User authentication
- Custom scene timing
- Advanced analytics
- Different budget limits

Tell me and I'll implement.
```

---

## 💻 File Structure (Quick Reference)

```
ShopReel AI/
├── requirements.txt              ← Add: higgsfield-client, pytz
├── .env.local                   ← Create: HF_CREDENTIALS (local only)
├── .env.example                 ← Updated: Higgsfield configs
│
├── src/
│   ├── App.tsx                  ← (Existing, no changes needed yet)
│   ├── higgsfield.ts            ← NEW: Client library & types
│   └── HiggsFieldWorkflow.tsx    ← NEW: Full UI workflow
│
├── higgsfield_provider.py        ← NEW: Higgsfield SDK wrapper
├── budget_guard.py               ← NEW: Budget tracking (atomic)
├── script_parser.py              ← NEW: Script parsing & compression
├── higgsfield_routes.py          ← NEW: Flask API endpoints
├── generation.py                 ← MODIFIED: Add higgsfield_jobs table
│
├── test_higgsfield.py            ← NEW: 23 unit tests
│
├── INTEGRATION_SUMMARY.md        ← NEW: Overview (read this first)
├── HIGGSFIELD_GUIDE.md           ← NEW: Complete guide
└── LOCAL_TESTING.md              ← NEW: Testing procedures
```

---

## ⏱️ Estimated Time Breakdown

| Step | Time | Status |
|------|------|--------|
| Install deps | 5 min | ✓ Quick |
| Create .env | 2 min | ✓ Quick |
| Run tests | 5 min | ✓ Quick (23 tests) |
| Build & lint | 5 min | ✓ Quick |
| Start server | 3 min | ✓ Quick |
| Test endpoints | 5 min | ✓ Quick (5 curl requests) |
| Review docs | 10 min | ℹ️ Skim for now |
| **Total** | **~35 min** | ✓ Doable! |

---

## 🚀 TL;DR (Copy-Paste Commands)

```bash
# Install & test
pip install -r requirements.txt
npm install
python -m pytest test_higgsfield.py -v

# Build & verify
npm run typecheck
npm run lint
npm run build

# Start & test
npm run start  # Terminal 1

# In Terminal 2, run:
curl "http://localhost:5050/api/higgsfield/budget?user_id=test" | more

# Expected: success ✓
```

---

**Ready? Let's go!** 🎉

Run the commands above and share the test output with me. If all 23 tests pass, we're ready to deploy to Hostinger.
