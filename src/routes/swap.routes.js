const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const ownerMiddleware = require('../middlewares/owner.middleware');

const {
  adminPlatformFeesController,
  createSwapOrderController,
  getSwapCurrenciesController,
  getSwapOrderController,
  getSwapSettingsController,
  listSwapOrdersController,
  previewSwapFeeController,
  quoteSwapController,
  syncSwapOrderStatusController,
} = require('../controllers/swap.controller');

const {
  sendLimiter,
  walletReadLimiter,
} = require('../middlewares/rateLimiter.middleware');
const {
  idempotencyMiddleware,
} = require('../middlewares/idempotency.middleware');

const router = express.Router();

router.get('/settings', walletReadLimiter, getSwapSettingsController);
router.get('/currencies', walletReadLimiter, getSwapCurrenciesController);
router.post('/quote-preview', authMiddleware, walletReadLimiter, previewSwapFeeController);
router.post('/quote', authMiddleware, walletReadLimiter, quoteSwapController);
router.get('/orders', authMiddleware, walletReadLimiter, listSwapOrdersController);
router.get('/orders/:id', authMiddleware, walletReadLimiter, getSwapOrderController);
router.post(
  '/orders',
  authMiddleware,
  sendLimiter,
  idempotencyMiddleware,
  createSwapOrderController
);
router.post(
  '/orders/:id/sync',
  authMiddleware,
  walletReadLimiter,
  syncSwapOrderStatusController
);
router.get('/admin/platform-fees', ownerMiddleware, walletReadLimiter, adminPlatformFeesController);

module.exports = router;
