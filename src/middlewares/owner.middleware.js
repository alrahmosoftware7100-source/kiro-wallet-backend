const crypto = require('crypto');

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function ownerMiddleware(req, res, next) {
  const configuredKey = process.env.OWNER_ADMIN_KEY;

  if (!configuredKey) {
    return res.status(503).json({
      success: false,
      message: 'Owner admin key is not configured',
    });
  }

  const providedKey = req.headers['x-owner-key'];

  if (!providedKey || !safeCompare(providedKey, configuredKey)) {
    return res.status(403).json({
      success: false,
      message: 'Owner access required',
    });
  }

  next();
}

module.exports = ownerMiddleware;
