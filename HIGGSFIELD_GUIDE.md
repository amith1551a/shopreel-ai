# Higgsfield AI Integration Guide

## Overview

ShopReel AI now integrates **Higgsfield AI** for professional video generation using Reference-to-Video (Wan 3.0) and Text-to-Video (Kling 3.0) models.

**Key Features:**
- ✅ **Budget Guard**: Atomic $20/month, $0.60/day, $0.25/job limits
- ✅ **Zero Auto-Retry**: Blocks automatic paid retries to prevent runaway costs
- ✅ **Concurrent Job Limit**: One paid job per user
- ✅ **Security**: Server-side credentials, rate limiting, price validation
- ✅ **Free Editing**: Browser-based storyboard editor, no API costs
- ✅ **Progress Tracking**: Real-time job status polling
- ✅ **Duplicate Detection**: Prevents duplicate submissions

---

## Local Development Setup

### 1. Install Dependencies

```bash
# Python dependencies
python -m pip install -r requirements.txt

# Node dependencies
npm install
```

### 2. Configure Environment

Create `.env.local` in project root:

```bash
# Higgsfield API (server-side only, never expose to frontend)
HF_CREDENTIALS=your-key-id:your-key-secret

# Budget limits (in cents, America/Chicago timezone)
HF_MONTHLY_BUDGET_CENTS=2000      # $20/month
HF_DAILY_BUDGET_CENTS=60          # $0.60/day
HF_JOB_BUDGET_CENTS=25            # $0.25/job
HF_CONCURRENT_PAID_JOBS=1         # One at a time
```

**Note:** `.env.local` is in `.gitignore` and never committed.

### 3. Run Locally

```bash
# Terminal 1: Start Node.js server
npm run start

# Terminal 2: Start Python Flask backend (optional, for testing legacy routes)
python app.py

# Open browser
open http://localhost:5050
```

### 4. Test Higgsfield Endpoints

```bash
# Parse a brief (no cost)
curl -X POST http://localhost:5050/api/higgsfield/parse-script \
  -H "Content-Type: application/json" \
  -d '{"script": "Hook: Sample\nProduct: Tee\nValue: Cool\nCTA: Buy"}'

# Preview cost (no cost, no side effects)
curl -X POST http://localhost:5050/api/higgsfield/preview-cost \
  -H "Content-Type: application/json" \
  -d '{"model": "wan/3.0/reference-to-video", "duration_seconds": 10, "user_id": "test-user"}'

# Check budget
curl "http://localhost:5050/api/higgsfield/budget?user_id=test-user"
```

---

## Workflow: Upload → Script → Storyboard → Approve → Generate

### Step 1: Upload Product Image
- User uploads product image from browser
- Image stored locally in `outputs/{project_id}/front.png`
- No API call yet

### Step 2: Enter Full Script
- User enters complete product brief with structure:
  ```
  Hook: Tired outfit?
  Product: Check this tee!
  Value: Anime artwork that stands out
  CTA: Shop now - link in bio
  ```
- **No cost**. Local parsing only.

### Step 3: Parse & Edit Storyboard
- User clicks "Parse & Edit Storyboard"
- Browser sends to `/api/higgsfield/parse-script`
- Server extracts timed scenes (0-3s hook, 3-7s product, 7-11s value, 11-15s CTA)
- User can edit each scene prompt in-browser
- **No cost, no side effects**

### Step 4: Choose Model & Duration
- Wan 3.0: $0.05/second (Reference-to-Video, preferred)
- Kling 3.0: $0.10/second (Text-to-Video, optional)
- Duration: 5-60 seconds

### Step 5: Preview Cost & Budget
- Click "Preview Cost & Budget"
- Server calculates: `cost_usd = price_per_second * duration`
- Returns budget status (daily/monthly used, available, % bars)
- **No cost, no budget reserved**
- Warnings at 80% usage; blocks at 100%

### Step 6: User Approves
- User reviews cost and clicks "Approve & Generate"
- Server atomically:
  1. Checks daily limit, monthly limit, concurrent job limit
  2. Detects duplicates (idempotent via job_id)
  3. Reserves budget in SQLite (pending state)
  4. Submits to Higgsfield API
  5. Stores job in local DB
- If limits exceeded, returns 402 with budget status

### Step 7: Generation
- Higgsfield processes video
- User can poll `/api/higgsfield/job/{job_id}/status` repeatedly
- No additional cost for polling
- When complete: video URL returned

### Step 8: Results & Download
- Display video in browser
- User can download MP4
- Budget settled (pending → charged)

---

## API Reference

### POST `/api/higgsfield/parse-script`
Parse full product brief into editable storyboard.

**Request:**
```json
{
  "script": "Full product brief text..."
}
```

**Response:**
```json
{
  "storyboard": {
    "scenes": [
      {
        "id": "scene-0",
        "start_s": 0,
        "end_s": 3,
        "name": "HOOK",
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

**Costs:** None. No budget reserved.

---

### POST `/api/higgsfield/preview-cost`
Preview cost without commitment.

**Request:**
```json
{
  "model": "wan/3.0/reference-to-video",
  "duration_seconds": 10,
  "user_id": "user123"
}
```

**Response:**
```json
{
  "model": "wan/3.0/reference-to-video",
  "duration_seconds": 10,
  "estimated_cost_usd": 0.50,
  "estimated_cost_cents": 50,
  "budget": {
    "today_used_cents": 100,
    "today_pending_cents": 0,
    "today_available_cents": 5900,
    "today_limit_cents": 6000,
    "today_percent": 2,
    "month_used_cents": 500,
    "month_pending_cents": 0,
    "month_available_cents": 199500,
    "month_limit_cents": 200000,
    "month_percent": 0,
    "next_daily_reset_at": "2026-11-06T06:00:00-06:00",
    "warn_daily": false,
    "warn_monthly": false,
    "blocked_daily": false,
    "blocked_monthly": false
  },
  "can_proceed": true
}
```

**Costs:** None. No budget reserved.

---

### POST `/api/higgsfield/submit-job`
Submit generation job after user approval. Atomically reserves budget.

**Request:**
```json
{
  "job_id": "job-1730795329000-abc123def",
  "user_id": "user123",
  "model": "wan/3.0/reference-to-video",
  "script": "HOOK: ...\nPRODUCT: ...",
  "duration_seconds": 10,
  "image_project_id": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
}
```

**Response (Success, 201):**
```json
{
  "job_id": "job-1730795329000-abc123def",
  "status": "submitted",
  "provider_job_id": "higgsfield-abc123",
  "estimated_cost_usd": 0.50,
  "budget": { ... }
}
```

**Response (Budget Exceeded, 402):**
```json
{
  "error": "Daily limit reached. $5.40 available.",
  "budget": { ... }
}
```

**Costs:** $0.05-$0.10 per second (reserved atomically).

---

### GET `/api/higgsfield/job/{job_id}/status`
Poll job status and retrieve results.

**Query Params:**
- `user_id`: Required

**Response:**
```json
{
  "job_id": "job-1730795329000-abc123def",
  "status": "processing",
  "progress": 45.5,
  "video_url": null,
  "error": null,
  "estimated_cost_usd": 0.50,
  "actual_cost_usd": null,
  "created_at": "2026-11-05T17:08:49Z",
  "updated_at": "2026-11-05T17:09:15Z"
}
```

**Status Values:**
- `queued`: Waiting in Higgsfield queue
- `processing`: Actively generating
- `completed`: Done, video_url set
- `failed`: Error in error field
- `uncertain`: Submission response lost; reconcile in dashboard

**Costs:** None. Safe to poll repeatedly.

---

### GET `/api/higgsfield/budget`
Get current budget status for user.

**Query Params:**
- `user_id`: Required

**Response:**
```json
{
  "user_id": "user123",
  "today": {
    "used_cents": 100,
    "pending_cents": 50,
    "available_cents": 5850,
    "limit_cents": 6000,
    "percent": 2,
    "blocked": false
  },
  "month": {
    "used_cents": 500,
    "pending_cents": 50,
    "available_cents": 199450,
    "limit_cents": 200000,
    "percent": 0,
    "blocked": false
  },
  "next_daily_reset_at": "2026-11-06T06:00:00-06:00",
  "warn": false
}
```

**Costs:** None. Safe to call repeatedly.

---

## Testing

Run the test suite:

```bash
# Unit tests (mock API, no credentials needed)
python -m pytest test_higgsfield.py -v

# E2E tests (requires real Higgsfield credentials)
npm run test:e2e
```

**Key Tests:**
- ✅ Cost calculation per model and duration
- ✅ Daily/monthly budget enforcement
- ✅ Concurrent job limit (1 per user)
- ✅ Duplicate job detection (idempotent)
- ✅ Timezone-aware daily reset (America/Chicago)
- ✅ Budget warnings at 80%, blocking at 100%
- ✅ Script parsing and compression
- ✅ Storyboard editing and validation
- ✅ API security (no exposed secrets, rate limits)

---

## Deployment to Hostinger

### Prerequisites
- Hostinger shared hosting or VPS with Python 3.10+
- SSH access
- Node.js 22+ installed

### Step 1: Prepare Environment

```bash
# 1. Export environment from local .env.local
# (DO NOT commit; will be set server-side)

# 2. Build production bundle
npm run build

# 3. Verify build succeeded
ls -la dist/
```

### Step 2: Upload to Hostinger

```bash
# Via SCP or Hostinger file manager
scp -r dist/* user@hostinger.com:/home/user/public_html/

# Python files
scp *.py user@hostinger.com:/home/user/app/
scp requirements.txt user@hostinger.com:/home/user/app/
```

### Step 3: Install Dependencies on Server

```bash
# SSH into Hostinger
ssh user@hostinger.com

# Navigate to app directory
cd ~/app

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt
```

### Step 4: Set Environment Variables

**Via Hostinger Control Panel:**
1. Go to "Environment Variables"
2. Add:
   ```
   HF_CREDENTIALS=your-key-id:your-key-secret
   HF_MONTHLY_BUDGET_CENTS=2000
   HF_DAILY_BUDGET_CENTS=60
   HF_JOB_BUDGET_CENTS=25
   HF_CONCURRENT_PAID_JOBS=1
   ```

**Or via .env file:**
```bash
# Create .env (NOT .env.local) on server
cat > ~/app/.env << 'EOF'
HF_CREDENTIALS=your-key-id:your-key-secret
HF_MONTHLY_BUDGET_CENTS=2000
HF_DAILY_BUDGET_CENTS=60
HF_JOB_BUDGET_CENTS=25
HF_CONCURRENT_PAID_JOBS=1
NODE_ENV=production
EOF

chmod 600 ~/app/.env
```

### Step 5: Start Node.js Server

**Option A: Using PM2 (Recommended)**
```bash
npm install -g pm2

# Start server with PM2
pm2 start server.mjs --name "shopreel-higgsfield"

# Enable auto-restart on reboot
pm2 startup
pm2 save
```

**Option B: Using Systemd Service**
```bash
sudo cat > /etc/systemd/system/shopreel.service << 'EOF'
[Unit]
Description=ShopReel AI with Higgsfield
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/home/user/app
Environment="PATH=/home/user/app/venv/bin"
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node server.mjs
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable shopreel
sudo systemctl start shopreel
```

### Step 6: Configure Web Server

**Nginx (Reverse Proxy):**
```nginx
upstream shopreel {
    server localhost:5050;
}

server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://shopreel;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Apache (Reverse Proxy):**
```apache
ProxyPreserveHost On
ProxyPass / http://localhost:5050/
ProxyPassReverse / http://localhost:5050/
```

### Step 7: Enable HTTPS

```bash
# Via Hostinger's Let's Encrypt or Certbot
certbot certonly --webroot -w /home/user/public_html -d yourdomain.com

# Renew automatically
certbot renew --quiet
```

### Step 8: Verify Deployment

```bash
# Check server is running
curl https://yourdomain.com/api/higgsfield/budget?user_id=test

# Monitor logs
pm2 logs shopreel-higgsfield
# or
journalctl -u shopreel -f
```

---

## Security Checklist

- ✅ `HF_CREDENTIALS` stored server-side only (never in HTML, JS, or frontend code)
- ✅ All price validation happens server-side
- ✅ Budget reservations are atomic (SQLite transactions)
- ✅ No API call without explicit user approval
- ✅ Rate limiting on POST endpoints (429 on abuse)
- ✅ Job ledger persisted for reconciliation
- ✅ Safe temporary media URLs (signed, short-lived)
- ✅ `.env` and `.env.local` in `.gitignore`
- ✅ CORS restricted to same-origin in production
- ✅ CSP headers block inline scripts

---

## Cost Tracking & Reconciliation

### Pending Costs
During job submission, estimated cost is marked `pending` in DB. If the API request succeeds but response is lost (network issue), the job is marked `uncertain` and budget remains reserved.

### Settlement
When job completes or fails, actual cost is recorded:
```sql
SELECT * FROM budget_ledger WHERE user_id='user123' ORDER BY created_at DESC;
```

### Chargebacks
Higgsfield bills your account directly. ShopReel tracks in local DB for UI display.

**Reconcile quarterly:**
```bash
# Export Higgsfield billing report
# Compare against: SELECT SUM(actual_cost_cents) FROM budget_ledger WHERE paid_at >= ?
```

---

## Troubleshooting

### "Higgsfield could not be reached"
- Verify `HF_CREDENTIALS` is set and valid
- Check network connectivity from server
- Confirm Higgsfield API endpoint is reachable

### "Job submission uncertain"
- Budget is reserved but job status is unknown
- Check Higgsfield dashboard for job status
- If job exists and completed, manually update DB:
  ```sql
  UPDATE budget_ledger SET status='charged', actual_cost_cents=50 WHERE job_id='...';
  ```

### "Daily limit reached but counter resets at wrong time"
- Timezone is hardcoded to America/Chicago (UTC-6 or UTC-5 DST)
- To change: edit `BudgetGuard.TIMEZONE` in `budget_guard.py`

### Budget not updating after job completion
- Polling timeout is 5 minutes
- Check browser console for errors
- Verify job status manually: `GET /api/higgsfield/job/{job_id}/status`

---

## Support & Documentation

- **Higgsfield SDK**: https://github.com/higgsfield-ai/client
- **Reference-to-Video (Wan 3.0)**: https://docs.higgsfield.ai/models/wan-reference-to-video
- **Text-to-Video (Kling 3.0)**: https://docs.higgsfield.ai/models/kling-text-to-video
- **ShopReel AI GitHub**: https://github.com/your-repo

---

**Last Updated:** November 5, 2026  
**Version:** 1.0.0
