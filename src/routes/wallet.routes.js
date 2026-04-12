const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');

const {
  getBalanceController,
  refreshWalletBalancesController,
  createWalletsController,
  sendController,
  getTransactionsController,
} = require('../controllers/wallet.controller');

const {
  sendLimiter,
  walletReadLimiter,
} = require('../middlewares/rateLimiter.middleware');

const {
  validateSendRequest,
} = require('../middlewares/validate.middleware');

const {
  idempotencyMiddleware,
} = require('../middlewares/idempotency.middleware');

const router = express.Router();

router.get('/wallets', authMiddleware, walletReadLimiter, getBalanceController);
router.get(
  '/wallets/refresh',
  authMiddleware,
  walletReadLimiter,
  refreshWalletBalancesController
);

router.post('/wallets/create', authMiddleware, walletReadLimiter, createWalletsController);

router.post(
  '/send',
  authMiddleware,
  sendLimiter,
  idempotencyMiddleware,
  validateSendRequest,
  sendController
);

router.get('/transactions', authMiddleware, walletReadLimiter, getTransactionsController);

module.exports = router;