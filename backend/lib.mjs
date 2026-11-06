/**
 * ShopReel AI - Shared Library Functions
 * 
 * Side-effect-free module for utility functions used by both:
 * - vite.config.ts (dev middleware during build)
 * - server.mjs (production server)
 * 
 * By keeping these in a separate module, we avoid importing the Express
 * server startup code when building the SPA.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

/**
 * localLibrary - Serves local library files during development
 * 
 * Usage in vite.config.ts:
 *   middlewares.use((req, res, next) => {
 *     if (localLibrary(req, res)) return;
 *     next();
 *   });
 * 
 * Returns true if request was handled, false otherwise
 */
export function localLibrary(req, res) {
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const production = NODE_ENV === 'production';

  // Only serve library files in development
  if (production) return false;

  // Check for library file requests (e.g., /library/player.mjs)
  if (!req.url.startsWith('/library/')) return false;

  // Prevent directory traversal
  if (req.url.includes('..')) {
    res.status(400).json({ error: 'Invalid path' });
    return true;
  }

  try {
    // Construct safe path to library file
    const libraryPath = resolve(ROOT, 'src', req.url.replace(/^\/library\//, ''));
    
    // Verify path is within src directory
    const srcPath = resolve(ROOT, 'src');
    if (!libraryPath.startsWith(srcPath)) {
      res.status(403).json({ error: 'Forbidden' });
      return true;
    }

    if (!existsSync(libraryPath)) {
      res.status(404).json({ error: 'Library file not found' });
      return true;
    }

    // Set content type based on file extension
    const ext = libraryPath.split('.').pop()?.toLowerCase();
    const mimeTypes = {
      mjs: 'application/javascript',
      js: 'application/javascript',
      ts: 'text/typescript',
      json: 'application/json',
      css: 'text/css',
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(libraryPath);
    return true;
  } catch (err) {
    console.error('Error serving library file:', err);
    res.status(500).json({ error: 'Internal Server Error' });
    return true;
  }
}

export { securityHeaders } from './middleware/security.mjs';
