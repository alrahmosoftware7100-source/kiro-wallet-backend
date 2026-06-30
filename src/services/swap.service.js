const pool = require('../config/db');
const {
  createChangellyTransaction,
  getChangellyCurrencies,
  getChangellyExchangeAmount,
  getChangellyStatus,
} = require('./changelly.service');
const {
  calculateSwapFeePreview,
  recordPlatformFee,
} = require('./platformFee.service');
const {
  ensureUserWallets,
  syncWalletBalances,
} = require('./wallet.service');

const SOURCE_TICKER_BY_NETWORK = {
  TRC20: process.env.CHANGELLY_USDT_TRC20_TICKER || 'usdtrx',
  ERC20: process.env.CHANGELLY_USDT_ERC20_TICKER || 'usdt20',
};

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeNetwork(network) {
  return String(network || 'TRC20').trim().toUpperCase();
}

function normalizeAsset(asset) {
  return String(asset || '').trim().toUpperCase();
}

function normalizeTicker(ticker) {
  return String(ticker || '').trim().toLowerCase();
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw createHttpError('Amount must be greater than 0', 400);
  }
  return Number(amount.toFixed(12));
}

function normalizeProviderAmount(rawQuote) {
  const quote = Array.isArray(rawQuote) ? rawQuote[0] : rawQuote;

  if (quote === null || quote === undefined) {
    return null;
  }

  if (typeof quote === 'number' || typeof quote === 'string') {
    const parsed = Number(quote);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const amount =
    quote.amountTo ??
    quote.amount ??
    quote.result ??
    quote.toAmount ??
    quote.estimatedAmount;

  const parsed = Number(amount);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProviderTransaction(rawTransaction) {
  const tx = rawTransaction || {};

  return {
    providerTransactionId:
      tx.id || tx.trackId || tx.transactionId || tx.providerTransactionId || '',
    payinAddress: tx.payinAddress || tx.payin || tx.addressFrom || '',
    payinExtraId: tx.payinExtraId || tx.extraIdFrom || '',
    payoutAddress: tx.payoutAddress || tx.address || tx.addressTo || '',
    payoutExtraId: tx.payoutExtraId || tx.extraId || tx.extraIdTo || '',
    amountExpectedFrom: tx.amountExpectedFrom || tx.amountFrom || '',
    amountExpectedTo: tx.amountExpectedTo || tx.amountTo || '',
    status: tx.status || 'created',
    trackUrl: tx.trackUrl || '',
    raw: tx,
  };
}

function mapProviderStatus(providerStatus) {
  const status = String(providerStatus || '').trim().toLowerCase();

  if (['finished', 'complete', 'completed'].includes(status)) {
    return 'finished';
  }

  if (['failed', 'refunded', 'expired'].includes(status)) {
    return status;
  }

  if (status) {
    return status;
  }

  return 'created';
}

function getSourceTicker(sourceNetwork) {
  const network = normalizeNetwork(sourceNetwork);
  const ticker = SOURCE_TICKER_BY_NETWORK[network];

  if (!ticker) {
    throw createHttpError('Only TRC20 and ERC20 USDT swaps are enabled', 400);
  }

  return ticker;
}

function getTargetTicker({ targetTicker, targetAsset }) {
  const providedTicker = normalizeTicker(targetTicker);
  if (providedTicker) return providedTicker;

  const asset = normalizeAsset(targetAsset);
  if (!asset) {
    throw createHttpError('Target asset is required', 400);
  }

  return asset.toLowerCase();
}

async function getWalletsForUser(userId) {
  await ensureUserWallets(userId);
  return syncWalletBalances(userId);
}

function findWallet(wallets, network) {
  const cleanNetwork = normalizeNetwork(network);
  return wallets.find((wallet) => wallet.network === cleanNetwork) || null;
}

function resolvePayoutAddress({
  wallets,
  targetAddress,
  targetAsset,
  targetNetwork,
  targetTicker,
}) {
  const cleanTargetAddress = String(targetAddress || '').trim();

  if (cleanTargetAddress) {
    return cleanTargetAddress;
  }

  const cleanTicker = normalizeTicker(targetTicker);
  const cleanAsset = normalizeAsset(targetAsset);
  const cleanTargetNetwork = normalizeNetwork(targetNetwork);

  if (cleanTicker === 'btc' || cleanAsset === 'BTC' || cleanTargetNetwork === 'BTC') {
    const btcWallet = findWallet(wallets, 'BTC');
    if (btcWallet?.address) {
      return btcWallet.address;
    }
  }

  if (cleanAsset === 'USDT' && ['TRC20', 'ERC20'].includes(cleanTargetNetwork)) {
    const usdtWallet = findWallet(wallets, cleanTargetNetwork);
    if (usdtWallet?.address) {
      return usdtWallet.address;
    }
  }

  throw createHttpError(
    'Target address is required for assets that do not have an in-app wallet yet',
    400
  );
}

async function getProviderCurrencies({ limit = 300 } = {}) {
  const result = await getChangellyCurrencies();
  const currencies = Array.isArray(result) ? result : Object.values(result || {});
  const max = Math.min(Math.max(Number(limit) || 300, 1), 500);

  return currencies.slice(0, max).map((currency) => ({
    ticker: currency.ticker || currency.name || '',
    name: currency.fullName || currency.name || currency.ticker || '',
    enabled: currency.enabled !== false,
    blockchain: currency.blockchain || currency.network || '',
    protocol: currency.protocol || '',
    image: currency.image || '',
    raw: currency,
  }));
}

async function quoteSwap(userId, {
  grossAmount,
  sourceNetwork = 'TRC20',
  targetAsset,
  targetNetwork = '',
  targetTicker,
}) {
  const cleanSourceNetwork = normalizeNetwork(sourceNetwork);
  const cleanTargetAsset = normalizeAsset(targetAsset || targetTicker);
  const sourceTicker = getSourceTicker(cleanSourceNetwork);
  const cleanTargetTicker = getTargetTicker({ targetTicker, targetAsset });

  const feePreview = calculateSwapFeePreview({
    grossAmount,
    sourceAsset: 'USDT',
    sourceNetwork: cleanSourceNetwork,
    targetAsset: cleanTargetAsset,
    targetNetwork,
  });

  const providerQuote = await getChangellyExchangeAmount({
    from: sourceTicker,
    to: cleanTargetTicker,
    amountFrom: feePreview.netAmount,
  });

  return {
    ...feePreview,
    sourceTicker,
    targetTicker: cleanTargetTicker,
    providerQuote,
    estimatedTargetAmount: normalizeProviderAmount(providerQuote),
    userId,
  };
}

async function findExistingOrder(userId, idempotencyKey) {
  if (!idempotencyKey) return null;

  const result = await pool.query(
    `SELECT *
     FROM public.swap_orders
     WHERE user_id = $1 AND idempotency_key = $2
     LIMIT 1`,
    [userId, idempotencyKey]
  );

  return result.rows[0] || null;
}

async function createSwapOrder(userId, {
  grossAmount,
  sourceNetwork = 'TRC20',
  targetAsset,
  targetNetwork = '',
  targetTicker,
  targetAddress,
  payoutExtraId = '',
}, idempotencyKey = '') {
  const cleanIdempotencyKey = String(idempotencyKey || '').trim();
  const existing = await findExistingOrder(userId, cleanIdempotencyKey);

  if (existing) {
    return {
      order: existing,
      duplicate: true,
    };
  }

  const wallets = await getWalletsForUser(userId);
  const cleanSourceNetwork = normalizeNetwork(sourceNetwork);
  const sourceWallet = findWallet(wallets, cleanSourceNetwork);

  if (!sourceWallet) {
    throw createHttpError(`${cleanSourceNetwork} wallet not found`, 404);
  }

  const amount = normalizeAmount(grossAmount);
  const currentBalance = Number(sourceWallet.balance || 0);

  if (currentBalance < amount) {
    throw createHttpError('Insufficient USDT balance for amount and service fee', 400);
  }

  const quote = await quoteSwap(userId, {
    grossAmount: amount,
    sourceNetwork: cleanSourceNetwork,
    targetAsset,
    targetNetwork,
    targetTicker,
  });

  const payoutAddress = resolvePayoutAddress({
    wallets,
    targetAddress,
    targetAsset,
    targetNetwork,
    targetTicker: quote.targetTicker,
  });

  const providerTransaction = normalizeProviderTransaction(
    await createChangellyTransaction({
      from: quote.sourceTicker,
      to: quote.targetTicker,
      amountFrom: quote.netAmount,
      payoutAddress,
      refundAddress: sourceWallet.address,
      payoutExtraId,
    })
  );

  if (!providerTransaction.providerTransactionId) {
    throw createHttpError('Changelly did not return a transaction id', 502);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const feeRecord = await recordPlatformFee({
      userId,
      provider: 'changelly',
      providerTransactionId: providerTransaction.providerTransactionId,
      sourceAsset: 'USDT',
      sourceNetwork: cleanSourceNetwork,
      targetAsset: quote.targetAsset,
      targetNetwork: quote.targetNetwork,
      grossAmount: quote.grossAmount,
      feeAsset: quote.feeAsset,
      feeAmount: quote.feeAmount,
      netAmount: quote.netAmount,
      status: 'pending_collection',
      metadata: {
        sourceTicker: quote.sourceTicker,
        targetTicker: quote.targetTicker,
        payinAddress: providerTransaction.payinAddress,
        payoutAddress,
      },
    }, client);

    const orderResult = await client.query(
      `INSERT INTO public.swap_orders
        (user_id, platform_fee_id, idempotency_key, provider,
         provider_transaction_id, source_asset, source_network, source_ticker,
         target_asset, target_network, target_ticker, gross_amount, fee_asset,
         fee_amount, net_amount, estimated_target_amount, payout_address,
         payout_extra_id, refund_address, payin_address, payin_extra_id,
         status, provider_status, provider_payload)
       VALUES
        ($1, $2, $3, 'changelly',
         $4, 'USDT', $5, $6,
         $7, $8, $9, $10, $11,
         $12, $13, $14, $15,
         $16, $17, $18, $19,
         $20, $21, $22)
       RETURNING *`,
      [
        userId,
        feeRecord.id,
        cleanIdempotencyKey || null,
        providerTransaction.providerTransactionId,
        cleanSourceNetwork,
        quote.sourceTicker,
        quote.targetAsset,
        quote.targetNetwork,
        quote.targetTicker,
        quote.grossAmount,
        quote.feeAsset,
        quote.feeAmount,
        quote.netAmount,
        quote.estimatedTargetAmount,
        payoutAddress,
        payoutExtraId || null,
        sourceWallet.address,
        providerTransaction.payinAddress,
        providerTransaction.payinExtraId || null,
        mapProviderStatus(providerTransaction.status),
        providerTransaction.status,
        providerTransaction.raw,
      ]
    );

    await client.query('COMMIT');

    return {
      order: orderResult.rows[0],
      duplicate: false,
      providerTransaction,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listSwapOrders(userId, { limit = 30 } = {}) {
  const max = Math.min(Math.max(Number(limit) || 30, 1), 100);

  const result = await pool.query(
    `SELECT *
     FROM public.swap_orders
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, max]
  );

  return result.rows;
}

async function getSwapOrder(userId, orderId) {
  const result = await pool.query(
    `SELECT *
     FROM public.swap_orders
     WHERE user_id = $1 AND id = $2
     LIMIT 1`,
    [userId, orderId]
  );

  const order = result.rows[0];
  if (!order) {
    throw createHttpError('Swap order not found', 404);
  }

  return order;
}

async function syncSwapOrderStatus(userId, orderId) {
  const order = await getSwapOrder(userId, orderId);
  const providerStatus = await getChangellyStatus(order.provider_transaction_id);
  const status = mapProviderStatus(providerStatus);

  const result = await pool.query(
    `UPDATE public.swap_orders
     SET status = $1,
         provider_status = $2,
         updated_at = NOW()
     WHERE id = $3 AND user_id = $4
     RETURNING *`,
    [status, String(providerStatus || ''), orderId, userId]
  );

  return result.rows[0];
}

module.exports = {
  createSwapOrder,
  getProviderCurrencies,
  getSwapOrder,
  listSwapOrders,
  quoteSwap,
  syncSwapOrderStatus,
};
