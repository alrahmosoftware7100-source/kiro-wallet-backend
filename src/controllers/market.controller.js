const axios = require('axios');

const COINGECKO_BASE_URL =
  process.env.COINGECKO_BASE_URL || 'https://api.coingecko.com/api/v3';

let coinsCache = {
  data: null,
  expiresAt: 0,
};

function mapCoin(coin) {
  return {
    id: coin.id,
    symbol: coin.symbol,
    name: coin.name,
    image: coin.image,
    currentPrice: coin.current_price ?? 0,
    marketCap: coin.market_cap ?? 0,
    marketCapRank: coin.market_cap_rank ?? 0,
    totalVolume: coin.total_volume ?? 0,
    high24h: coin.high_24h ?? 0,
    low24h: coin.low_24h ?? 0,
    priceChange24h: coin.price_change_24h ?? 0,
    priceChangePercentage24h: coin.price_change_percentage_24h ?? 0,
    circulatingSupply: coin.circulating_supply ?? 0,
    totalSupply: coin.total_supply ?? 0,
    maxSupply: coin.max_supply ?? 0,
    lastUpdated: coin.last_updated,
  };
}

async function fetchTopCoins() {
  const headers = {
    accept: 'application/json',
  };

  if (process.env.COINGECKO_API_KEY) {
    headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
  }

  const response = await axios.get(`${COINGECKO_BASE_URL}/coins/markets`, {
    headers,
    timeout: 20000,
    params: {
      vs_currency: 'usd',
      order: 'market_cap_desc',
      per_page: 200,
      page: 1,
      sparkline: false,
      price_change_percentage: '24h',
    },
  });

  if (!Array.isArray(response.data)) {
    throw new Error('Invalid coins response format');
  }

  return response.data.map(mapCoin);
}

async function getCoins(req, res) {
  try {
    const now = Date.now();

    if (coinsCache.data && now < coinsCache.expiresAt) {
      return res.status(200).json({
        success: true,
        cached: true,
        count: coinsCache.data.length,
        data: coinsCache.data,
      });
    }

    const coins = await fetchTopCoins();

    coinsCache = {
      data: coins,
      expiresAt: now + 60 * 1000,
    };

    return res.status(200).json({
      success: true,
      cached: false,
      count: coins.length,
      data: coins,
    });
  } catch (error) {
    console.error('getCoins error:', error.response?.data || error.message);

    if (coinsCache.data) {
      return res.status(200).json({
        success: true,
        cached: true,
        stale: true,
        count: coinsCache.data.length,
        data: coinsCache.data,
        warning: 'Showing cached market data because live fetch failed.',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch market coins',
      error: error.response?.data || error.message,
    });
  }
}

module.exports = {
  getCoins,
};