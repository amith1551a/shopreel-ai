/**
 * Authentication middleware for Express
 * Replaces Flask's local_guard
 */

import crypto from 'node:crypto';

const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function localGuard(req, res, next) {
  // Bind loopback and reject DNS-rebinding hostnames
  const host = req.hostname;
  
  if (!loopback.has(host)) {
    return res.status(403).json({ error: 'Use localhost:5050 to open this local studio.' });
  }
  
  // CSRF protection for mutations (POST, PUT, PATCH, DELETE)
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const supplied = req.headers['x-studio-token'] || '';
    const expected = req.app.locals.csrfToken || '';
    
    // Use constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return res.status(403).json({ error: 'Refresh the studio before making changes.' });
    }
  }
  
  next();
}

export function generateCSRFToken() {
  return crypto.randomBytes(16).toString('hex');
}
