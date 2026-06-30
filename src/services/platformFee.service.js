const pool = require('../config/db');
const { isChangellyConfigured } = require('./changelly.service');

const DEFAULT_SWAP_PROVIDER = 'changelly';
const DEFAULT_SWAP_FEE_USDT = 0.25;
const DEFAULT_MIN_SWAP_AMOUNT_USDT = 1;

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toPositiveNumber(value, fieldName) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw createHttpError(`${fieldName} must be greater than 0`, 400);
  }

  return amount;
}

function roundAmount(value, decimals = 12) {
  return Number(value.toFixed(decimals));
}

function getSwapFeeSettings() {
  const feeAmount = toPositiveNumber(
    process.env.PLATFORM_SWAP_FEE_USDT || DEFAULT_SWAP_FEE_USDT,
    'PLATFORM_SWAP_FEE_USDT'
  );

  const minGrossAmount = toPositiveNumber(
    process.env.MIN_SWAP_AMOUNT_USDT || DEFAULT_MIN_SWAP_AMOUNT_USDT,
    'MIN_SWAP_AMOUNT_USDT'
  );

  const provider = process.env.SWAP_PROVIDER || DEFAULT_SWAP_PROVIDER;
  const providerConfigured = isChangellyConfigured();
  const autoPaymentEnabled = process.env.ENABLE_SWAP_AUTO_PAYMENT === 'true';
  const feeCollectionConfigured = Boolean(
    process.env.PLATFORM_FEE_TRC20_ADDRESS ||
      process.env.PLATFORM_FEE_ERC20_ADDRESS
  );

  return {
    provider,
    providerConfigured,
    autoPaymentEnabled,
    feeCollectionConfigured,
    noLeverage: true,
    supportedSourceNetworks: ['TRC20', 'ERC20'],
    serviceFee: {
      type: 'fixed',
      asset: 'USDT',
      amount: feeAmount,
    },
    minGrossAmount,
  };
}

function calculateSwapFeePreview({
  grossAmount,
  sourceAsset = 'USDT',
  sourceNetwork = '',
  targetAsset,
  targetNetwork = '',
}) {
  const settings = getSwapFeeSettings();
  const cleanSourceAsset = String(sourceAsset || 'USDT').trim().toUpperCase();
  const cleanTargetAsset = String(targetAsset || '').trim().toUpperCase();
  const amount = toPositiveNumber(grossAmount, 'grossAmount');

  if (cleanSourceAsset !== 'USDT') {
    throw createHttpError('Only USDT source swaps are enabled right now', 400);
  }

  if (!cleanTargetAsset) {
    throw createHttpError('targetAsset is required', 400);
  }

  if (amount < settings.minGrossAmount) {
    throw createHttpError(
      `Minimum swap amount is ${settings.minGrossAmount} USDT`,
      400
    );
  }

  if (amount <= settings.serviceFee.amount) {
    throw createHttpError(
      `Amount must be greater than the ${settings.serviceFee.amount} USDT service fee`,
      400
    );
  }

  const feeAmount = roundAmount(settings.serviceFee.amount);
  const netAmount = roundAmount(amount - feeAmount);

  return {
    provider: settings.provider,
    providerConfigured: settings.providerConfigured,
    noLeverage: true,
    sourceAsset: cleanSourceAsset,
    sourceNetwork: String(sourceNetwork || '').trim().toUpperCase(),
    targetAsset: cleanTargetAsset,
    targetNetwork: String(targetNetwork || '').trim().toUpperCase(),
    grossAmount: roundAmount(amount),
    feeAsset: settings.serviceFee.asset,
    feeAmount,
    netAmount,
    feeType: settings.serviceFee.type,
    status: settings.providerConfigured ? 'ready' : 'provider_not_configured',
  };
}

async function recordPlatformFee({
  userId,
  provider = DEFAULT_SWAP_PROVIDER,
  providerTransactionId = null,
  sourceAsset,
  sourceNetwork = '',
  targetAsset,
  targetNetwork = '',
  grossAmount,
  feeAsset = 'USDT',
  feeAmount,
  netAmount,
  status = 'quoted',
  metadata = {},
}, db = pool) {
  const result = await db.query(
    `INSERT INTO public.platform_fees
       (user_id, provider, provider_transaction_id, source_asset, source_network,
        target_asset, target_network, gross_amount, fee_asset, fee_amount,
        net_amount, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, user_id, operation_type, provider, provider_transaction_id,
       source_asset, source_network, target_asset, target_network, gross_amount,
       fee_asset, fee_amount, net_amount, status, metadata, created_at, updated_at`,
    [
      userId,
      provider,
      providerTransactionId,
      sourceAsset,
      sourceNetwork,
      targetAsset,
      targetNetwork,
      grossAmount,
      feeAsset,
      feeAmount,
      netAmount,
      status,
      metadata,
    ]
  );

  return result.rows[0];
}

async function getPlatformFeeSummary({ limit = 50, status }) {
  const values = [];
  const where = [];

  if (status) {
    values.push(String(status).trim().toLowerCase());
    where.push(`status = $${values.length}`);
  }

  values.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  const limitParam = `$${values.length}`;

  const recordsResult = await pool.query(
    `SELECT id, user_id, operation_type, provider, provider_transaction_id,
       source_asset, source_network, target_asset, target_network, gross_amount,
       fee_asset, fee_amount, net_amount, status, metadata, created_at, updated_at
     FROM public.platform_fees
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC
     LIMIT ${limitParam}`,
    values
  );

  const totalsResult = await pool.query(
    `SELECT
       fee_asset,
       status,
       COUNT(*)::INTEGER AS count,
       COALESCE(SUM(fee_amount), 0) AS total_fee_amount
     FROM public.platform_fees
     GROUP BY fee_asset, status
     ORDER BY fee_asset, status`
  );

  return {
    records: recordsResult.rows,
    totals: totalsResult.rows,
  };
}

module.exports = {
  calculateSwapFeePreview,
  getPlatformFeeSummary,
  getSwapFeeSettings,
  recordPlatformFee,
};
