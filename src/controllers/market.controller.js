const { getCoins } = require('../services/market.service');

async function getCoinsController(req, res) {
  try {
    const coins = await getCoins();

    return res.status(200).json({
      success: true,
      live: true,
      count: coins.length,
      data: coins.map((coin) => ({
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        image: coin.image || '',
        currentPrice: coin.price,
        marketCap: coin.marketCap || 0,
        priceChange24h: coin.priceChange24h,
        volume24h: coin.volume24h,
        pair: coin.pair,
      })),
    });
  } catch (error) {
    console.error('getCoinsController error:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch live market data',
      error: error.message,
    });
  }
}

module.exports = {
  getCoins: getCoinsController,
};