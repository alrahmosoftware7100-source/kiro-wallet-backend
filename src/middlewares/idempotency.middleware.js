const recentRequests = new Map();

function idempotencyMiddleware(req, res, next) {
  const userId = req.user?.userId;
  const rawKey = req.headers['idempotency-key'];

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized request',
    });
  }

  if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Idempotency-Key header is required',
    });
  }

  const idempotencyKey = rawKey.trim();

  if (idempotencyKey.length < 8 || idempotencyKey.length > 120) {
    return res.status(400).json({
      success: false,
      message: 'Invalid Idempotency-Key',
    });
  }

  const requestKey = `${userId}:${idempotencyKey}`;
  const now = Date.now();
  const ttlMs = 10 * 60 * 1000;

  const existingTimestamp = recentRequests.get(requestKey);

  if (existingTimestamp && now - existingTimestamp < ttlMs) {
    return res.status(409).json({
      success: false,
      message: 'Duplicate request detected. Please do not retry the same transfer.',
    });
  }

  recentRequests.set(requestKey, now);

  for (const [key, timestamp] of recentRequests.entries()) {
    if (now - timestamp > ttlMs) {
      recentRequests.delete(key);
    }
  }

  next();
}

module.exports = {
  idempotencyMiddleware,
};