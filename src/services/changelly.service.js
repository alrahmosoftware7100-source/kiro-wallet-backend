const crypto = require('crypto');

const CHANGELLY_API_URL =
  process.env.CHANGELLY_API_URL || 'https://api.changelly.com/v2';

function createHttpError(message, statusCode = 400, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function getPrivateKeyValue() {
  return String(
    process.env.CHANGELLY_PRIVATE_KEY ||
      process.env.CHANGELLY_API_SECRET ||
      ''
  ).trim();
}

function isChangellyConfigured() {
  return Boolean(process.env.CHANGELLY_API_KEY && getPrivateKeyValue());
}

function normalizePrivateKey(rawKey) {
  const key = String(rawKey || '').replace(/\\n/g, '\n').trim();

  if (!key) {
    throw createHttpError('Changelly private key is not configured', 503);
  }

  if (key.includes('BEGIN')) {
    return crypto.createPrivateKey(key);
  }

  const encodings = ['hex', 'base64'];
  for (const encoding of encodings) {
    try {
      return crypto.createPrivateKey({
        key: Buffer.from(key, encoding),
        format: 'der',
        type: 'pkcs8',
      });
    } catch (_) {}
  }

  throw createHttpError('Invalid Changelly private key format', 503);
}

function signBody(body) {
  const privateKey = normalizePrivateKey(getPrivateKeyValue());
  return crypto.sign('sha256', Buffer.from(body), privateKey).toString('base64');
}

async function changellyRequest(method, params = {}) {
  if (!isChangellyConfigured()) {
    throw createHttpError('Changelly API keys are not configured', 503);
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    method,
    params,
  });

  const response = await fetch(CHANGELLY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.CHANGELLY_API_KEY,
      'X-Api-Signature': signBody(body),
    },
    body,
  });

  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    throw createHttpError(
      `Changelly HTTP ${response.status}`,
      502,
      payload || text
    );
  }

  if (!payload) {
    throw createHttpError('Invalid Changelly response', 502, text);
  }

  if (payload.error) {
    throw createHttpError(
      payload.error.message || 'Changelly API error',
      502,
      payload.error
    );
  }

  return payload.result;
}

async function getChangellyCurrencies() {
  return changellyRequest('getCurrenciesFull', {});
}

async function getChangellyExchangeAmount({ from, to, amountFrom }) {
  return changellyRequest('getExchangeAmount', [
    {
      from,
      to,
      amountFrom: String(amountFrom),
    },
  ]);
}

async function createChangellyTransaction({
  from,
  to,
  amountFrom,
  payoutAddress,
  refundAddress,
  payoutExtraId = '',
}) {
  const params = {
    from,
    to,
    amountFrom: String(amountFrom),
    address: payoutAddress,
    refundAddress,
  };

  if (payoutExtraId) {
    params.extraId = payoutExtraId;
  }

  return changellyRequest('createTransaction', params);
}

async function getChangellyStatus(providerTransactionId) {
  return changellyRequest('getStatus', {
    id: providerTransactionId,
  });
}

module.exports = {
  createChangellyTransaction,
  getChangellyCurrencies,
  getChangellyExchangeAmount,
  getChangellyStatus,
  isChangellyConfigured,
};
