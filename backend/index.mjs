/**
 * ShopReel AI - Express Backend Entry Point (Phase 1)
 * Replaces Flask app.py with Node.js/Express
 * 
 * Routes in Phase 1:
 * - GET / → HTML template
 * - GET /api/config → Configuration
 * - GET /api/videos → List videos
 * - GET /media/* → Serve files
 */

import 'dotenv/config.js';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'node:fs';

import { apiConfigRoute } from './routes/config.mjs';
import { getVideosRoute, getMediaRoute } from './routes/videos.mjs';
import { errorHandler } from './middleware/errors.mjs';
import { securityHeaders } from './middleware/security.mjs';
import { localGuard } from './middleware/auth.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 5050;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Body parsing
app.use(express.json({ limit: '80mb' }));
app.use(express.urlencoded({ limit: '80mb', extended: true }));

// Security headers
app.use(securityHeaders(NODE_ENV === 'production'));

// Local development guard (loopback only)
app.use(localGuard);

// ============================================================================
// STATIC FILES
// ============================================================================

// Serve production build (dist/)
const distPath = resolve(ROOT, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, {
    maxAge: NODE_ENV === 'production' ? '1d' : '0',
  }));
}

// Serve media files (videos, images, etc.)
const outputPath = resolve(ROOT, 'outputs');
if (fs.existsSync(outputPath)) {
  app.use('/media', express.static(outputPath, {
    maxAge: '1h',
    etag: false,
  }));
}

// ============================================================================
// API ROUTES - PHASE 1
// ============================================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', env: NODE_ENV, version: '2.0.0-phase1' });
});

// Configuration endpoint
app.get('/api/config', apiConfigRoute);

// Video listing and media serving
app.get('/api/videos', getVideosRoute);
app.get('/media/:videoId/:filename', getMediaRoute);

// ============================================================================
// INDEX ROUTE
// ============================================================================

app.get('/', (req, res) => {
  const indexPath = resolve(ROOT, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    // Production build
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(indexPath);
  } else {
    // Development mode - return a message
    res.json({
      error: 'Production build not found',
      instructions: 'Run: npm run build',
      dev: 'For development, run: npm run dev',
    });
  }
});

// ============================================================================
// 404 HANDLER
// ============================================================================

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ============================================================================
// ERROR HANDLER
// ============================================================================

app.use(errorHandler);

// ============================================================================
// SERVER STARTUP
// ============================================================================

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║ ShopReel AI - Node.js Backend (Phase 1)            ║
╚════════════════════════════════════════════════════╝

✓ Express server running
  URL: http://localhost:${PORT}
  Environment: ${NODE_ENV}
  
Implemented Routes:
  GET  /api/health              → Health check
  GET  /api/config              → App configuration
  GET  /api/videos              → List all videos
  GET  /media/:id/:file         → Serve video/image files
  GET  /                        → Render app

Upcoming Phases:
  Phase 2: Budget Guard + Database
  Phase 3: Higgsfield Integration
  Phase 4: Uploads & File Handling
  Phase 5: Full Feature Parity Testing

Tests:
  npm run test:parity           → Compare Flask vs Node.js outputs
`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
