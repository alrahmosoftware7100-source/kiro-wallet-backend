const axios = require('axios');
const WebSocket = require('ws');

const KRAKEN_REST = 'https://api.kraken.com/0/public';
const KRAKEN_WS = 'wss://ws.kraken.com/v2';

const MAX_COINS = 200;
const RECONNECT_DELAY = 5000;

let marketMap = new Map();
let selectedSymbols = [];
let restPairNames = [];
let isInitialized = false;
let isInitializing = false;
let ws = null;
let reconnectTimer = null;

function normalizeBaseAsset(base) {
  const map = {
    XBT: 'BTC',
    XDG: 'DOGE',
  };

  return map[base] || base;
}

function parseWsPair(wsname) {
  const parts = wsname.split('/');
  if (parts.length !== 2) return null;

  const base = normalizeBaseAsset(parts[0]);
  const quote = parts[1];

  return {
    wsname,
    baseAsset: base,
    quoteAsset: quote,
  };
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function fetchTradableUsdtPairs() {
  const response = await axios.get(`${KRAKEN_REST}/AssetPairs`, {
    timeout: 20000,
  });

  const result = response.data?.result || {};
  const pairs = [];

  for (const [restName, item] of Object.entries(result)) {
    const wsname = item.wsname;

    if (!wsname || typeof wsname !== 'string') continue;
    if (!wsname.endsWith('/USDT')) continue;

    const parsed = parseWsPair(wsname);
    if (!parsed) continue;

    pairs.push({
      restName,
      wsname: parsed.wsname,
      baseAsset: parsed.baseAsset,
      quoteAsset: parsed.quoteAsset,
    });
  }

  return pairs;
}

async function fetchTickerSnapshot(pairNames) {
  if (!pairNames.length) return {};

  const response = await axios.get(`${KRAKEN_REST}/Ticker`, {
    timeout: 20000,
    params: {
      pair: pairNames.join(','),
    },
  });

  return response.data?.result || {};
}

function buildCoinFromSnapshot(meta, ticker) {
  const lastPrice = toNumber(ticker?.c?.[0]);
  const priceChangePercent = 0; // Kraken REST ticker ما يعطي 24h % مباشرة بنفس الشكل
  const quoteVolume = toNumber(ticker?.v?.[1]);

  return {
    id: meta.baseAsset.toLowerCase(),
    name: meta.baseAsset,
    symbol: meta.baseAsset,
    pair: meta.wsname,
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
    const tradablePairs = await fetchTradableUsdtPairs();
    const snapshot = await fetchTickerSnapshot(
      tradablePairs.map((p) => p.restName)
    );

    const merged = tradablePairs
      .map((pair) => {
        const ticker = snapshot[pair.restName];
        if (!ticker) return null;
        return buildCoinFromSnapshot(pair, ticker);
      })
      .filter(Boolean)
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
      .slice(0, MAX_COINS);

    marketMap = new Map(merged.map((coin) => [coin.pair, coin]));
    selectedSymbols = merged.map((coin) => coin.pair);
    restPairNames = tradablePairs
      .filter((p) => selectedSymbols.includes(p.wsname))
      .map((p) => p.restName);

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

  ws = new WebSocket(KRAKEN_WS);

  ws.on('open', () => {
    console.log('✅ Kraken live market feed connected');

    ws.send(
      JSON.stringify({
        method: 'subscribe',
        params: {
          channel: 'ticker',
          symbol: selectedSymbols,
        },
      })
    );
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.channel !== 'ticker') return;
      if (!Array.isArray(msg.data)) return;

      for (const item of msg.data) {
        const pair = item.symbol;
        if (!pair || !marketMap.has(pair)) continue;

        const existing = marketMap.get(pair);

        const lastPrice = toNumber(
          item.last ?? item.last_price ?? existing.price,
          existing.price
        );

        const bid = toNumber(item.bid, 0);
        const ask = toNumber(item.ask, 0);
        const mid =
            bid > 0 && ask > 0 ? (bid + ask) / 2 : existing.price;

        const ref = mid > 0 ? mid : existing.price || 1;
        const derivedChangePercent =
          ((lastPrice - ref) / ref) * 100;

        marketMap.set(pair, {
          ...existing,
          price: lastPrice,
          priceChange24h: Number.isFinite(derivedChangePercent)
              ? derivedChangePercent
              : existing.priceChange24h,
          volume24h: toNumber(item.volume ?? existing.volume24h, existing.volume24h),
        });
      }
    } catch (error) {
      console.error('Kraken WebSocket parse error:', error.message);
    }
  });

  ws.on('close', () => {
    console.warn('⚠️ Kraken live market feed disconnected');
    scheduleReconnect();
  });

  ws.on('error', (error) => {
    console.error('Kraken WebSocket error:', error.message);
    try {
      ws.close();
    } catch (_) {}
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    console.log('🔄 Reconnecting Kraken live market feed...');
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