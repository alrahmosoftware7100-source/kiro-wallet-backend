const {
  getCoins,
  subscribeMarketUpdates,
} = require('../services/market.service');

function mapPublicCoins(coins) {
  return coins.map((coin) => ({
    id: coin.id,
    symbol: coin.symbol,
    name: coin.name,
    image: coin.image || '',
    currentPrice: coin.currentPrice ?? coin.price,
    price: coin.price ?? coin.currentPrice,
    marketCap: coin.marketCap || 0,
    priceChange24h: coin.priceChange24h,
    priceChangePercentage24h: coin.priceChangePercentage24h,
    volume24h: coin.volume24h,
    pair: coin.pair,
    quoteAsset: coin.quoteAsset || 'USDT',
    priceSource: coin.priceSource || 'coingecko',
    updatedAt: coin.updatedAt,
  }));
}

async function getCoinsController(req, res) {
  try {
    const coins = await getCoins();

    return res.status(200).json({
      success: true,
      live: true,
      count: coins.length,
      data: mapPublicCoins(coins),
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

async function streamCoinsController(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (payload) => {
    res.write(`event: prices\n`);
    res.write(`data: ${payload}\n\n`);
  };

  const unsubscribe = subscribeMarketUpdates(send);
  const heartbeat = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: ${Date.now()}\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}

module.exports = {
  getCoins: getCoinsController,
  streamCoins: streamCoinsController,
};
