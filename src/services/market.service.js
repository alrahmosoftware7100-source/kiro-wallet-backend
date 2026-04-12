const axios = require('axios');
const WebSocket = require('ws');

const BINANCE_REST = 'https://api.binance.com';
const BINANCE_WS = 'wss://stream.binance.com:9443/ws/!ticker@arr';

const MAX_COINS = 200;
const RECONNECT_DELAY = 5000;

let marketMap = new Map();
let selectedSymbols = new Set();
let isInitialized = false;
let isInitializing = false;
let ws = null;
let reconnectTimer = null;

function isValidSpotUsdtSymbol(symbolInfo) {
  if (!symbolInfo) return false;

  const symbol = symbolInfo.symbol || '';

  if (symbolInfo.status !== 'TRADING') return false;
  if (symbolInfo.quoteAsset !== 'USDT') return false;
  if (!symbolInfo.isSpotTradingAllowed) return false;

  // استبعاد أزواج الرافعة/التوكنات الخاصة التي غالبًا تشوّه القائمة
  const blockedSuffixes = ['UP', 'DOWN', 'BULL', 'BEAR'];
  if (blockedSuffixes.some((suffix) => symbol.endsWith(suffix + 'USDT'))) {
    return false;
  }

  return true;
}

async function fetchTradableUsdtSymbols() {
  const response = await axios.get(`${BINANCE_REST}/api/v3/exchangeInfo`, {
    timeout: 15000,
  });

  const symbols = response.data.symbols || [];

  return symbols
    .filter(isValidSpotUsdtSymbol)
    .map((item) => ({
      symbol: item.symbol,
      baseAsset: item.baseAsset,
      quoteAsset: item.quoteAsset,
    }));
}

async function fetch24hTickers() {
  const response = await axios.get(`${BINANCE_REST}/api/v3/ticker/24hr`, {
    timeout: 20000,
  });

  return Array.isArray(response.data) ? response.data : [];
}

function buildCoinFromTicker(meta, ticker) {
  const lastPrice = Number(ticker.lastPrice || 0);
  const priceChangePercent = Number(ticker.priceChangePercent || 0);
  const quoteVolume = Number(ticker.quoteVolume || 0);

  return {
    id: meta.baseAsset.toLowerCase(),
    name: meta.baseAsset,
    symbol: meta.baseAsset,
    pair: meta.symbol,
    image: '',
    price: lastPrice,
    priceChange24h: priceChangePercent,
    marketCap: null,
    volume24h: quoteVolume,
    quoteAsset: meta.quoteAsset,
  };
}

async function initializeMarketData() {
  if (isInitialized || isInitializing) return;

  isInitializing = true;

  try {
    const tradableSymbols = await fetchTradableUsdtSymbols();
    const tickerList = await fetch24hTickers();

    const tradableMap = new Map(
      tradableSymbols.map((item) => [item.symbol, item])
    );

    const merged = tickerList
      .filter((ticker) => tradableMap.has(ticker.symbol))
      .map((ticker) => {
        const meta = tradableMap.get(ticker.symbol);
        return buildCoinFromTicker(meta, ticker);
      })
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
      .slice(0, MAX_COINS);

    marketMap = new Map(merged.map((coin) => [coin.pair, coin]));
    selectedSymbols = new Set(merged.map((coin) => coin.pair));

    startWebSocket();
    isInitialized = true;
  } finally {
    isInitializing = false;
  }
}

function startWebSocket() {
  if (ws) {
    try {
      ws.terminate();
    } catch (_) {}
    ws = null;
  }

  ws = new WebSocket(BINANCE_WS);

  ws.on('open', () => {
    console.log('✅ Binance live market feed connected');
  });

  ws.on('message', (raw) => {
    try {
      const updates = JSON.parse(raw.toString());

      if (!Array.isArray(updates)) return;

      for (const item of updates) {
        const pair = item.s;

        if (!selectedSymbols.has(pair)) continue;

        const existing = marketMap.get(pair);
        if (!existing) continue;

        marketMap.set(pair, {
          ...existing,
          price: Number(item.c || existing.price || 0), // last price
          priceChange24h: Number(
            item.P ?? existing.priceChange24h ?? 0
          ), // 24h %
          volume24h: Number(item.q ?? existing.volume24h ?? 0), // quote volume
        });
      }
    } catch (error) {
      console.error('WebSocket parse error:', error.message);
    }
  });

  ws.on('ping', (data) => {
    try {
      ws.pong(data);
    } catch (_) {}
  });

  ws.on('close', () => {
    console.warn('⚠️ Binance live market feed disconnected');
    scheduleReconnect();
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
    try {
      ws.close();
    } catch (_) {}
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    console.log('🔄 Reconnecting Binance live market feed...');
    startWebSocket();
  }, RECONNECT_DELAY);
}

async function getCoins() {
  if (!isInitialized) {
    await initializeMarketData();
  }

  return Array.from(marketMap.values()).sort(
    (a, b) => (b.volume24h || 0) - (a.volume24h || 0)
  );
}

module.exports = {
  getCoins,
  initializeMarketData,
};