const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const ownerMiddleware = require('../middlewares/owner.middleware');

const {
  adminPlatformFeesController,
  getSwapSettingsController,
  previewSwapFeeController,
} = require('../controllers/swap.controller');

const {
  walletReadLimiter,
} = require('../middlewares/rateLimiter.middleware');

const router = express.Router();

router.get('/settings', walletReadLimiter, getSwapSettingsController);
router.post('/quote-preview', authMiddleware, walletReadLimiter, previewSwapFeeController);
router.get('/admin/platform-fees', ownerMiddleware, walletReadLimiter, adminPlatformFeesController);

module.exports = router;
