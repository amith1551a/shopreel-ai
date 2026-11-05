/**
 * Security middleware for Express
 * Mirrors Flask's security headers and CSP policies
 */

export function securityHeaders(production = true, encoderWorker = false) {
  return (req, res, next) => {
    const headers = {
      'Content-Security-Policy': `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${encoderWorker ? " 'unsafe-eval'" : ''}${production ? '' : " 'nonce-shopreel-local-dev'"}; worker-src 'self' blob:; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'${production ? '' : " 'nonce-shopreel-local-dev'"}; connect-src 'self'${production ? '' : ' ws://127.0.0.1:5050 ws://localhost:5050'}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    };
    
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    next();
  };
}
