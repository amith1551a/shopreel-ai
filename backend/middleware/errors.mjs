/**
 * Express error handler middleware
 * Replaces Flask's error responses with consistent JSON format
 */

export function errorHandler(err, req, res, next) {
  // Default to 500 Internal Server Error
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let code = err.code || 'INTERNAL_ERROR';

  // Handle specific error types
  if (err.code === 'ENOENT') {
    status = 404;
    code = 'NOT_FOUND';
    message = 'File or resource not found';
  } else if (err.code === 'EACCES') {
    status = 403;
    code = 'FORBIDDEN';
    message = 'Access denied';
  } else if (err.code === 'EINVAL') {
    status = 400;
    code = 'INVALID_INPUT';
    message = 'Invalid input';
  } else if (err.name === 'SyntaxError' && 'body' in err) {
    // JSON parsing errors
    status = 400;
    code = 'INVALID_JSON';
    message = 'Invalid JSON in request body';
  }

  // Log error in development
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[${new Date().toISOString()}] ${status} ${code}:`, {
      message,
      method: req.method,
      path: req.path,
      stack: err.stack,
    });
  }

  // Send response
  res.status(status).json({
    error: message,
    code,
    ...(process.env.NODE_ENV !== 'production' && { details: err.message }),
  });
}
