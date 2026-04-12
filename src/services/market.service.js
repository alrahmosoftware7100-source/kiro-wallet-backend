const axios = require('axios');

const COINGECKO_BASE_URL =
  process.env.COINGECKO_BASE_URL || 'https://api.coingecko.com/api/v3';

const MAX_COINS = 200;
const CACHE_DURATION_MS = 8000;

let marketCache = [];
let lastFetchAt = 0;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapCoin(coin) {
  return {
    id: coin.id ?? '',
    name: coin.name ?? '',
    symbol: (coin.symbol ?? '').toUpperCase(),
    pair: `${(coin.symbol ?? '').toUpperCase()}/USDT`,
    image: coin.image ?? '',
    price: toNumber(coin.current_price),
    currentPrice: toNumber(coin.current_price),
    priceChange24h: toNumber(coin.price_change_percentage_24h),
    priceChangePercentage24h: toNumber(coin.price_change_percentage_24h),
    marketCap: toNumber(coin.market_cap),
    volume24h: toNumber(coin.total_volume),
    quoteAsset: 'USDT',
  };
}

async function fetchCoinsFromCoinGecko() {
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
      per_page: MAX_COINS,
      page: 1,
      sparkline: false,
      price_change_percentage: '24h',
    },
  });

  if (!Array.isArray(response.data)) {
    throw new Error('Invalid CoinGecko response format');
  }

  return response.data.map(mapCoin);
}

async function initializeMarketData() {
  try {
    const coins = await fetchCoinsFromCoinGecko();
    marketCache = coins;
    lastFetchAt = Date.now();
    console.log(`✅ Market data initialized: ${coins.length} coins loaded`);
  } catch (error) {
    console.error(
      'Market initialization error:',
      error.response?.data || error.message
    );
  }
}

async function getCoins() {
  const now = Date.now();

  if (marketCache.length > 0 && now - lastFetchAt < CACHE_DURATION_MS) {
    return marketCache;
  }

  try {
    const coins = await fetchCoinsFromCoinGecko();
    marketCache = coins;
    lastFetchAt = now;
    return marketCache;
  } catch (error) {
    console.error('CoinGecko fetch error:', error.response?.data || error.message);

    if (marketCache.length > 0) {
      return marketCache;
    }

    throw error;
  }
}

module.exports = {
  getCoins,
  initializeMarketData,
};