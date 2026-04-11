const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');

const {
  getBalanceController,
  createWalletsController,
  sendController,
  getTransactionsController,
} = require('../controllers/wallet.controller');

const router = express.Router();

// 🔹 جلب المحافظ (وبيولدهم تلقائي إذا ما موجودين)
router.get('/wallets', authMiddleware, getBalanceController);

// 🔹 إنشاء المحافظ يدوي (اختياري)
router.post('/wallets/create', authMiddleware, createWalletsController);

// 🔹 إرسال رصيد (حاليًا داخلي فقط)
router.post('/send', authMiddleware, sendController);

// 🔹 سجل العمليات
router.get('/transactions', authMiddleware, getTransactionsController);

module.exports = router;