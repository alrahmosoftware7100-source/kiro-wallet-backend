const axios = require('axios');
const WebSocket = require('ws');

const COINGECKO_BASE_URL =
  process.env.COINGECKO_BASE_URL || 'https://api.coingecko.com/api/v3';

const BINANCE_MINI_TICKER_STREAM =
  process.env.BINANCE_MINI_TICKER_STREAM ||
  'wss://data-stream.binance.vision/ws/!miniTicker@arr';

const MAX_COINS = Number(process.env.MARKET_MAX_COINS || 100);
const CACHE_DURATION_MS = Number(process.env.MARKET_CACHE_DURATION_MS || 60000);
const STREAM_BROADCAST_MS = Number(process.env.MARKET_STREAM_INTERVAL_MS || 1000);
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 30000;

let marketCache = [];
let lastFetchAt = 0;
let liveSocket = null;
let liveStarted = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let broadcastTimer = null;
let metadataRefreshTimer = null;

const subscribers = new Set();

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapCoin(coin) {
  const symbol = (coin.symbol ?? '').toUpperCase();

  return {
    id: coin.id ?? '',
    name: coin.name ?? '',
    symbol,
    pair: `${symbol}/USDT`,
    binanceSymbol: `${symbol}USDT`,
    image: coin.image ?? '',
    price: toNumber(coin.current_price),
    currentPrice: toNumber(coin.current_price),
    priceChange24h: toNumber(coin.price_change_percentage_24h),
    priceChangePercentage24h: toNumber(coin.price_change_percentage_24h),
    marketCap: toNumber(coin.market_cap),
    volume24h: toNumber(coin.total_volume),
    quoteAsset: 'USDT',
    priceSource: 'coingecko',
    updatedAt: new Date().toISOString(),
  };
}

function publicCoin(coin) {
  return {
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
  };
}

function getMarketSnapshot() {
  return marketCache.map(publicCoin);
}

function broadcastMarketUpdate() {
  if (subscribers.size === 0 || marketCache.length === 0) {
    return;
  }

  const payload = JSON.stringify({
    success: true,
    live: true,
    count: marketCache.length,
    updatedAt: new Date().toISOString(),
    data: getMarketSnapshot(),
  });

  for (const send of subscribers) {
    send(payload);
  }
}

function subscribeMarketUpdates(send) {
  subscribers.add(send);

  if (marketCache.length > 0) {
    send(
      JSON.stringify({
        success: true,
        live: true,
        count: marketCache.length,
        updatedAt: new Date().toISOString(),
        data: getMarketSnapshot(),
      })
    );
  }

  return () => {
    subscribers.delete(send);
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

async function initializeMarketData({ force = false } = {}) {
  const now = Date.now();

  if (!force && marketCache.length > 0 && now - lastFetchAt < CACHE_DURATION_MS) {
    return marketCache;
  }

  try {
    const coins = await fetchCoinsFromCoinGecko();
    const liveBySymbol = new Map(
      marketCache.map((coin) => [coin.binanceSymbol, coin])
    );

    marketCache = coins.map((coin) => {
      const liveCoin = liveBySymbol.get(coin.binanceSymbol);

      if (!liveCoin || liveCoin.priceSource !== 'binance') {
        return coin;
      }

      return {
        ...coin,
        price: liveCoin.price,
        currentPrice: liveCoin.currentPrice,
        priceChange24h: liveCoin.priceChange24h,
        priceChangePercentage24h: liveCoin.priceChangePercentage24h,
        volume24h: liveCoin.volume24h,
        priceSource: liveCoin.priceSource,
        updatedAt: liveCoin.updatedAt,
      };
    });

    lastFetchAt = now;
    console.log(`Market data initialized: ${coins.length} coins loaded`);
    broadcastMarketUpdate();
    return marketCache;
  } catch (error) {
    console.error(
      'Market initialization error:',
      error.response?.data || error.message
    );

    if (marketCache.length > 0) {
      return marketCache;
    }

    throw error;
  }
}

function applyBinanceTickers(tickers) {
  if (!Array.isArray(tickers) || marketCache.length === 0) {
    return;
  }

  const tickerBySymbol = new Map();
  for (const ticker of tickers) {
    if (ticker?.s && String(ticker.s).endsWith('USDT')) {
      tickerBySymbol.set(ticker.s, ticker);
    }
  }

  let changed = false;
  const updatedAt = new Date().toISOString();

  marketCache = marketCache.map((coin) => {
    const ticker = tickerBySymbol.get(coin.binanceSymbol);
    if (!ticker) return coin;

    const closePrice = toNumber(ticker.c, coin.currentPrice);
    const openPrice = toNumber(ticker.o, 0);
    const volume24h = toNumber(ticker.q || ticker.v, coin.volume24h);
    const priceChange24h =
      openPrice > 0 ? ((closePrice - openPrice) / openPrice) * 100 : coin.priceChange24h;

    if (closePrice === coin.currentPrice && volume24h === coin.volume24h) {
      return coin;
    }

    changed = true;

    return {
      ...coin,
      price: closePrice,
      currentPrice: closePrice,
      priceChange24h,
      priceChangePercentage24h: priceChange24h,
      volume24h,
      priceSource: 'binance',
      updatedAt,
    };
  });

  if (changed) {
    broadcastMarketUpdate();
  }
}

function scheduleReconnect() {
  if (!liveStarted || reconnectTimer) return;

  const delay = Math.min(
    RECONNECT_BASE_MS * 2 ** reconnectAttempts,
    RECONNECT_MAX_MS
  );

  reconnectAttempts += 1;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBinanceStream();
  }, delay);
}

function connectBinanceStream() {
  if (!liveStarted) return;

  if (
    liveSocket &&
    (liveSocket.readyState === WebSocket.OPEN ||
      liveSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  liveSocket = new WebSocket(BINANCE_MINI_TICKER_STREAM);

  liveSocket.on('open', () => {
    reconnectAttempts = 0;
    console.log('Binance live market stream connected');
  });

  liveSocket.on('message', (message) => {
    try {
      const payload = JSON.parse(message.toString());
      applyBinanceTickers(payload);
    } catch (error) {
      console.error('Binance market message parse error:', error.message);
    }
  });

  liveSocket.on('error', (error) => {
    console.error('Binance live market stream error:', error.message);
  });

  liveSocket.on('close', () => {
    liveSocket = null;
    console.log('Binance live market stream closed');
    scheduleReconnect();
  });
}

function startLiveMarketUpdates() {
  if (liveStarted) return;

  liveStarted = true;

  initializeMarketData().catch(() => {});
  connectBinanceStream();

  broadcastTimer = setInterval(() => {
    broadcastMarketUpdate();
  }, STREAM_BROADCAST_MS);

  metadataRefreshTimer = setInterval(() => {
    initializeMarketData({ force: true }).catch(() => {});
  }, CACHE_DURATION_MS);
}

function stopLiveMarketUpdates() {
  liveStarted = false;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (broadcastTimer) {
    clearInterval(broadcastTimer);
    broadcastTimer = null;
  }

  if (metadataRefreshTimer) {
    clearInterval(metadataRefreshTimer);
    metadataRefreshTimer = null;
  }

  if (liveSocket) {
    liveSocket.close();
    liveSocket = null;
  }
}

async function getCoins() {
  if (marketCache.length === 0 || Date.now() - lastFetchAt > CACHE_DURATION_MS) {
    await initializeMarketData();
  }

  return marketCache;
}

module.exports = {
  getCoins,
  getMarketSnapshot,
  initializeMarketData,
  startLiveMarketUpdates,
  stopLiveMarketUpdates,
  subscribeMarketUpdates,
};
