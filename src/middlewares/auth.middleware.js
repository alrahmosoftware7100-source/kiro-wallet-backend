const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'JWT configuration error',
      });
    }

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token is required',
      });
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization format',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload',
      });
    }

    req.user = {
      userId: decoded.userId,
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Authentication failed',
    });
  }
}

module.exports = authMiddleware;