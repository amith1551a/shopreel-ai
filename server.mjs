/**
 * ShopReel AI - Production Server Entry Point
 * 
 * Hostinger Deployment Configuration:
 * - Framework: Vite + Node.js HTTP server
 * - Node.js: 22.x (requires 22.13+)
 * - Branch: main
 * - Build: npm run build
 * - Start: node server.mjs
 * - Output: dist/
 * 
 * This server:
 * 1. Provides Express-based REST API (Phase 1+)
 * 2. Serves Vite-built SPA (dist/)
 * 3. Handles media file serving (/media/*)
 * 4. Includes security headers and error handling
 * 
 * Local Development: npm start (uses backend/index.mjs with --watch)
 * Hostinger Production: node server.mjs (this file)
 */

import 'dotenv/config.js';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import fs from 'node:fs';

import { apiConfigRoute } from './backend/routes/config.mjs';
import { getVideosRoute, getMediaRoute } from './backend/routes/videos.mjs';
import { errorHandler } from './backend/middleware/errors.mjs';
import { localLibrary, securityHeaders } from './backend/lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = __dirname;

const app = express();
const PORT = process.env.PORT || 5050;
const NODE_ENV = process.env.NODE_ENV || 'production';
const production = NODE_ENV === 'production';

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Body parsing
app.use(express.json({ limit: '80mb' }));
app.use(express.urlencoded({ limit: '80mb', extended: true }));

// Security headers
app.use((req, res, next) => {
  const headers = securityHeaders(production);
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  next();
});

// ============================================================================
// STATIC FILES
// ============================================================================

// Serve production build (dist/)
const distPath = resolve(ROOT, 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath, {
    maxAge: production ? '1d' : '0',
    etag: false,
  }));
}

// Serve media files (videos, images, etc.)
const outputPath = resolve(ROOT, 'outputs');
if (existsSync(outputPath)) {
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
  res.json({ 
    status: 'ok', 
    env: NODE_ENV, 
    version: '2.0.0-phase1',
    backend: 'Express',
    deployment: production ? 'Hostinger' : 'Local',
  });
});

// Configuration endpoint (imported from backend/routes/config.mjs)
app.get('/api/config', apiConfigRoute);

// Video listing (imported from backend/routes/videos.mjs)
app.get('/api/videos', getVideosRoute);

// Media file serving with range request support (imported from backend/routes/videos.mjs)
app.get('/media/:videoId/:filename', getMediaRoute);

// ============================================================================
// SPA FALLBACK ROUTE
// ============================================================================

// All non-API routes serve index.html (SPA routing)
app.get('*', (req, res) => {
  const indexPath = resolve(ROOT, 'dist', 'index.html');
  
  if (!existsSync(indexPath)) {
    return res.status(400).json({
      error: 'Production build not found',
      instructions: 'Run: npm run build',
    });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(indexPath);
});

// ============================================================================
// ERROR HANDLER
// ============================================================================

app.use(errorHandler);

// ============================================================================
// SERVER STARTUP - Always listens when module loads
// ============================================================================

const server = app.listen(PORT, production ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║ ShopReel AI - Production Server                    ║
╚════════════════════════════════════════════════════╝

✓ Server running
  URL: ${production ? 'https://your-domain.com' : 'http://localhost:' + PORT}
  Environment: ${NODE_ENV}
  Port: ${PORT}
  Binding: ${production ? '0.0.0.0 (public)' : '127.0.0.1 (local)'}

API Routes Ready:
  ✅ GET /api/health              → Health check
  ✅ GET /api/config              → App configuration
  ✅ GET /api/videos              → Video listing (Phase 1)
  ✅ GET /media/:id/:file         → File serving with ranges
  ✅ GET / + routes               → SPA (dist/index.html)

Build Info:
  SPA directory: ${distPath}
  Media directory: ${outputPath}
  Build timestamp: ${new Date().toISOString()}
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
