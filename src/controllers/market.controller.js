const marketService = require('../services/market.service');

async function getCoins(req, res) {
  try {
    const coins = await marketService.getCoins();

    return res.status(200).json({
      success: true,
      data: coins,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch market data',
    });
  }
}

module.exports = {
  getCoins,
};