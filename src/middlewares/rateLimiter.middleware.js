const rateLimit = require('express-rate-limit');

const walletReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
});

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many send attempts. Please wait a minute and try again.',
  },
});

module.exports = {
  walletReadLimiter,
  sendLimiter,
};