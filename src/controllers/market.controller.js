const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args))

const COINGECKO_BASE_URL =
  process.env.COINGECKO_BASE_URL || 'https://api.coingecko.com/api/v3';

const COINS_MARKETS_URL = `${COINGECKO_BASE_URL}/coins/markets`;

// Cache بسيط لتخفيف الضغط على API
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
    ath: coin.ath ?? 0,
    athChangePercentage: coin.ath_change_percentage ?? 0,
    athDate: coin.ath_date,
    atl: coin.atl ?? 0,
    atlChangePercentage: coin.atl_change_percentage ?? 0,
    atlDate: coin.atl_date,
    lastUpdated: coin.last_updated,
  };
}

async function fetchTopCoins() {
  const url = new URL(COINS_MARKETS_URL);

  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('order', 'market_cap_desc');
  url.searchParams.set('per_page', '200');
  url.searchParams.set('page', '1');
  url.searchParams.set('sparkline', 'false');
  url.searchParams.set('price_change_percentage', '24h');

  const headers = {
    accept: 'application/json',
  };

  // إذا عندك API key لاحقًا
  if (process.env.COINGECKO_API_KEY) {
    headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
    timeout: 20000,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`CoinGecko HTTP ${response.status}: ${text || 'Request failed'}`);
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error('Invalid coins response format');
  }

  return data.map(mapCoin);
}

async function getCoins(req, res) {
  try {
    const now = Date.now();

    // cache لمدة 60 ثانية
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
    console.error('getCoins error:', error.message);

    // fallback: إذا في cache قديم رجّعه بدل 500
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
      error: error.message,
    });
  }
}

module.exports = {
  getCoins,
};