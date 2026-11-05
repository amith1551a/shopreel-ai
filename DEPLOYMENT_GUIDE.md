# ShopReel AI — Hostinger Deployment Guide

**Status:** Ready for deployment  
**Last Updated:** 2026-11-05  
**Repository:** https://github.com/amith1551a/shopreel-ai.git

---

## 📋 Pre-Deployment Checklist

- [ ] Repository pushed to GitHub
- [ ] Higgsfield account created at https://www.higgsfield.ai/
- [ ] Higgsfield API credentials obtained (key_id:key_secret)
- [ ] Hostinger Business plan with Node.js Web App access
- [ ] Database selected (SQLite or MySQL/MariaDB)
- [ ] Environment variables documented

---

## 🎯 Deployment Options

### Option A: Static React + Flask API (RECOMMENDED)
**Best for:** Minimal changes, reuse existing infrastructure

#### Pros:
- Clean separation (frontend ≠ backend)
- Reuses existing Node.js Web App
- No Web App limit exceeded
- CORS handled via reverse proxy

#### Cons:
- Cross-domain complexity
- Requires proxy configuration

#### Steps:

1. **Build React for Production**
   ```bash
   npm run build
   # Output: dist/ folder (ready for deployment)
   ```

2. **Create Static Website on Hostinger**
   - Go to Hostinger Dashboard → Websites
   - Create new website: `shopreel-ai.your-domain.com`
   - Upload dist/ folder to public_html
   - Set index.html as default

3. **Configure Existing Node.js Web App**
   - Use an existing Node.js Web App (or create if quota allows)
   - Update app.py to handle CORS from shopreel-ai.your-domain.com:
     ```python
     CORS(app, resources={
         r"/api/higgsfield/*": {
             "origins": "https://shopreel-ai.your-domain.com",
             "methods": ["GET", "POST"],
             "allow_headers": ["Content-Type", "X-Studio-Token"]
         }
     })
     ```

4. **Set Environment Variables on Hostinger**
   - Panel → Node.js Web App → Environment Variables
   - Add:
     ```
     HF_CREDENTIALS=your-key-id:your-key-secret
     APP_URL=https://shopreel-ai.your-domain.com
     DATABASE_URL=mysql://user:pass@host/shopreel_ai
     NODE_ENV=production
     FLASK_ENV=production
     ```

5. **Configure Reverse Proxy** (in Flask app.py)
   ```python
   # app.py line 340
   if __name__ == '__main__':
       # Hostinger production
       app.run(
           host='0.0.0.0',
           port=5050,
           debug=False,
           ssl_context=None  # Hostinger handles SSL
       )
   ```

6. **Update React API Base** (src/higgsfield.ts)
   ```typescript
   const API_BASE = process.env.NODE_ENV === 'production' 
       ? 'https://your-nodejs-app.hostinger-server.com/api'
       : 'http://localhost:5050/api';
   ```

7. **Deploy & Test**
   - Push code to GitHub
   - Hostinger auto-deploys (if configured)
   - Or manually upload dist/ to website

---

### Option B: Pure Node.js Consolidation
**Best for:** Single-process deployment, no external dependencies

#### Pros:
- Single deployment unit
- Simpler CORS
- Easier monitoring

#### Cons:
- Requires Python → JavaScript translation
- More initial setup

#### Steps:

1. **Port Python to Node.js** (estimate 4-6 hours)
   - Rewrite higgsfield_routes.py → Express.js routes
   - Rewrite budget_guard.py → Node.js class with SQLite3
   - Rewrite script_parser.py → JavaScript regex

2. **Create server.mjs** with Express:
   ```javascript
   import express from 'express';
   import { HiggsFieldRoutes } from './routes/higgsfield.mjs';
   
   const app = express();
   app.use(express.json());
   app.use('/api/higgsfield', HiggsFieldRoutes);
   app.use(express.static('dist'));
   
   app.listen(5050, () => {
       console.log('ShopReel AI running on port 5050');
   });
   ```

3. **Deploy as single Node.js Web App to Hostinger**
   - Similar to Option A, but `dist/` + `server.mjs` in same app

---

## 🔧 Configuration Files

### 1. .env.production (for Hostinger)
```ini
# Higgsfield API
HF_CREDENTIALS=your-actual-key-id:your-actual-key-secret

# Application
APP_URL=https://shopreel-ai.your-domain.com
NODE_ENV=production
FLASK_ENV=production
DEBUG=false

# Database (choose one)
# Option 1: SQLite (default)
DATABASE_URL=./studio.sqlite3

# Option 2: MySQL/MariaDB on Hostinger
# DATABASE_URL=mysql://shopreel_user:password@mysql.your-host.com/shopreel_ai

# Server
SERVER_HOST=0.0.0.0
SERVER_PORT=5050
LOG_LEVEL=info

# Budget Settings (in cents)
BUDGET_MONTHLY_CENTS=2000
BUDGET_DAILY_CENTS=60
BUDGET_JOB_CENTS=25
BUDGET_CONCURRENT_JOBS=1
BUDGET_TIMEZONE=America/Chicago
```

### 2. .gitignore (already set up)
```
.env.local
.env.production
studio.sqlite3
data/
outputs/
node_modules/
dist/
.DS_Store
*.pyc
__pycache__/
.venv
.vscode
```

### 3. database.sql (MySQL migration, if needed)
```sql
CREATE DATABASE shopreel_ai;
USE shopreel_ai;

CREATE TABLE higgsfield_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    model VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    provider_job_id VARCHAR(255),
    provider_status VARCHAR(50),
    script TEXT,
    duration_s INT,
    estimated_cost_cents INT,
    actual_cost_cents INT,
    video_url VARCHAR(500),
    error TEXT,
    progress INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_status (status)
);

CREATE TABLE budget_ledger (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    job_id INT,
    amount_cents INT NOT NULL,
    type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_created (user_id, created_at)
);

CREATE TABLE budget_daily_summary (
    user_id VARCHAR(255) PRIMARY KEY,
    date_chicago DATE,
    used_cents INT DEFAULT 0,
    pending_cents INT DEFAULT 0,
    INDEX idx_date (date_chicago)
);

CREATE TABLE budget_monthly_summary (
    user_id VARCHAR(255) PRIMARY KEY,
    year_month VARCHAR(7),
    used_cents INT DEFAULT 0,
    pending_cents INT DEFAULT 0,
    INDEX idx_month (year_month)
);
```

---

## 🚀 Hostinger Deployment Steps (Option A)

### Phase 1: Prepare Code (30 minutes)

1. **Clone Repository Locally**
   ```bash
   git clone https://github.com/amith1551a/shopreel-ai.git
   cd "ShopReel AI"
   ```

2. **Build Production Bundle**
   ```bash
   npm install
   npm run build
   # Creates dist/ folder
   ```

3. **Verify Build**
   ```bash
   ls -la dist/
   # Should see index.html, assets/, etc.
   ```

### Phase 2: Hostinger Setup (45 minutes)

1. **Log into Hostinger Dashboard**
   - https://www.hostinger.com/cpanel

2. **Create Static Website**
   - Panel → Websites
   - Click "Create Website"
   - Domain: `shopreel-ai.your-domain.com` (or subdomain)
   - Type: Static HTML
   - Installation path: Leave default

3. **Upload React Build**
   - File Manager → Go to public_html folder for your new website
   - Upload everything from dist/ folder
   - Verify index.html is in root of public_html

4. **Configure Node.js Web App**
   - Panel → Node.js Web Apps
   - Select an existing app (or create new if quota available)
   - Settings:
     - Node version: 18.x or 20.x
     - Application startup file: `server.mjs`
     - Environment variables (click "Add"):
       ```
       HF_CREDENTIALS = your-key-id:your-key-secret
       APP_URL = https://shopreel-ai.your-domain.com
       DATABASE_URL = ./studio.sqlite3
       NODE_ENV = production
       FLASK_ENV = production
       ```

5. **Upload Flask App Code**
   - File Manager → Node.js Web App folder
   - Upload:
     - app.py
     - requirements.txt
     - All Python backend files (higgsfield_*, budget_guard.py, script_parser.py)
   - Run startup script:
     ```bash
     pip install -r requirements.txt
     python app.py
     ```

6. **Enable HTTPS**
   - Panel → SSL Certificates
   - Auto-issue Let's Encrypt cert for both domains
   - Verify both shopreel-ai.your-domain.com and your-nodejs-app have green padlock

### Phase 3: Verify Deployment (30 minutes)

1. **Test Static Frontend**
   - Open: https://shopreel-ai.your-domain.com
   - Should see ShopReel AI home page
   - Check browser console for any errors (F12)

2. **Test API Endpoints**
   - Open DevTools Console, run:
     ```javascript
     fetch('https://your-nodejs-app.hostinger-server.com/api/higgsfield/budget-status', {
         method: 'GET',
         headers: {'X-Studio-Token': 'user123'}
     })
     .then(r => r.json())
     .then(data => console.log(data));
     ```
   - Should return: `{"user_id": "...", "daily_used_cents": 0, ...}`

3. **Test Full Workflow**
   - Upload product image
   - Click "AI-Powered Video"
   - Enter test script
   - Click "Parse Script"
   - Verify 4-scene storyboard displayed
   - Click "Preview Cost"
   - Verify cost calculation correct
   - **DO NOT CLICK "APPROVE"** yet (would charge Higgsfield account)

4. **Check Logs**
   - Panel → Node.js Web App → Logs
   - Should see no ERROR entries
   - INFO entries show API calls

### Phase 4: Ready for Live Use (5 minutes)

1. **Test with Real Higgsfield Credentials**
   - Update .env variables in Hostinger panel with real HF_CREDENTIALS
   - Restart Node.js app
   - Create test T-shirt ad (5-10 second test video)
   - Verify video generated and downloaded

2. **Monitor First 24 Hours**
   - Check Hostinger logs every 2 hours
   - Monitor Higgsfield dashboard for charges
   - Verify budget tracking updates correctly

3. **Set Up Alerts** (optional)
   - Hostinger: Configure email alerts for app restarts
   - Higgsfield: Set up spending notifications in your account

---

## 📊 Production Checklist

| Item | Status | Command/Check |
|------|--------|---------------|
| Repository pushed | ❌ TODO | `git push origin main` |
| Higgsfield account active | ❌ TODO | Check https://www.higgsfield.ai/ dashboard |
| API credentials obtained | ❌ TODO | Format: `key_id:key_secret` |
| npm build succeeds | ✅ DONE | `npm run build` passed |
| Tests pass | ✅ DONE | `npm run test` (47/47 passing) |
| TypeScript check passes | ✅ DONE | `tsc -b` (0 errors) |
| .env.example documented | ✅ DONE | See .env.example in repo |
| .gitignore updated | ✅ DONE | Excludes .env.*, data/, outputs/ |
| Python deps installed | ✅ DONE | `pip install -r requirements.txt` |
| Integration tests pass | ✅ DONE | `python validate_integration.py` (8/8) |
| Static website uploaded | ❌ TODO | Upload dist/ to Hostinger |
| API deployed | ❌ TODO | Upload Python backend to Node.js app |
| Environment variables set | ❌ TODO | Set in Hostinger panel |
| HTTPS/SSL enabled | ❌ TODO | Enable Let's Encrypt cert |
| Live workflow tested | ❌ TODO | Test full workflow (no approval yet) |

---

## ⚠️ Common Issues & Fixes

### Issue: "Cannot find module 'higgsfield_client'"
**Solution:** 
- If using Python backend, this is expected if Higgsfield SDK not installed
- Higgsfield submission will fail gracefully with error message
- To fix: Install via `pip install higgsfield-client` if package available

### Issue: "CORS error" in browser console
**Solution:**
- Verify `APP_URL` environment variable matches domain
- Ensure Flask app has CORS headers:
  ```python
  from flask_cors import CORS
  CORS(app, resources={...})
  ```
- Check browser devtools Network tab for 403/401 responses

### Issue: "Budget limit exceeded" immediately
**Solution:**
- Check budget_daily_summary table for stale data
- Verify system clock is correct (pytz uses system timezone)
- Manually reset with: `DELETE FROM budget_daily_summary WHERE user_id='test'`

### Issue: "API returns 500 error"
**Solution:**
- Check Hostinger Node.js logs: Panel → Logs
- Verify HF_CREDENTIALS format: `key_id:key_secret` (not separated by space)
- Check database permissions: SQLite must be writable

### Issue: "Video download is 404"
**Solution:**
- Higgsfield API may return temporary URL that expires
- Implement caching: Store video_url in higgsfield_jobs table
- Or implement download proxy that re-fetches from Higgsfield if expired

---

## 🔐 Security Reminders

1. **Never commit .env files**
   - Hostinger panel stores secrets securely
   - Always use environment variables

2. **Verify SSL/HTTPS**
   - All Higgsfield API calls must use HTTPS
   - Check browser URL bar for green padlock

3. **Rotate API Keys Regularly**
   - At least quarterly
   - Update HF_CREDENTIALS in Hostinger panel

4. **Monitor Budget Usage**
   - Check Higgsfield dashboard weekly
   - Set up email alerts at 80% of monthly budget

5. **Validate Incoming Requests**
   - Flask app validates user_id, model, duration
   - Reject if outside documented limits

---

## 📞 Support & Troubleshooting

### Higgsfield API Issues
- **Status Page:** https://status.higgsfield.ai/
- **Documentation:** https://docs.higgsfield.ai/
- **Support:** support@higgsfield.ai

### Hostinger Issues
- **Support Portal:** https://www.hostinger.com/support
- **Community Forum:** https://community.hostinger.com

### Local Development
- **Start Dev Server:** `npm run dev`
- **Open Browser:** http://localhost:5050
- **Flask Logs:** Terminal output shows requests

---

## 🎯 Success Metrics

After deployment, verify:

- ✅ Frontend loads in <2 seconds
- ✅ API endpoints respond in <500ms
- ✅ Budget calculations are accurate
- ✅ Generated videos play without errors
- ✅ No secrets in browser DevTools
- ✅ HTTPS/SSL working on both domains
- ✅ Logs show clean startup (no errors)

---

## 🚀 Final Steps

1. **Commit & Push**
   ```bash
   git add -A
   git commit -m "Prepare for Hostinger deployment"
   git push origin main
   ```

2. **Notify Team**
   - Share deployment URL
   - Share budget limits ($20/month)
   - Share first test script

3. **Monitor First Week**
   - Check logs daily
   - Verify budget updates correctly
   - Collect user feedback

4. **Document Learnings**
   - Record any deployment issues
   - Update this guide for next deployment

---

**Ready to deploy? Follow Option A steps above.**

**Need help? Check QUICK_START.md for local testing before deploying.**
