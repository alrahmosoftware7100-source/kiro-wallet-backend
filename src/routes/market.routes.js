const express = require('express');
const router = express.Router();
const marketController = require('../controllers/market.controller');

router.get('/coins', marketController.getCoins);

module.exports = router;