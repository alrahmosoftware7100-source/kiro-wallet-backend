const express = require('express');
const {
  createWalletController,
  loginController,
} = require('../controllers/auth.controller');

const router = express.Router();

router.post('/create-wallet', createWalletController);
router.post('/login', loginController);

module.exports = router;