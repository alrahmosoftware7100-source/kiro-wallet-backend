const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../config/db');
const {
  ensureUserWallets,
  getUserWallets,
} = require('./wallet.service');

function normalizePhrase(phrase) {
  return String(phrase).trim().toLowerCase().replace(/\s+/g, ' ');
}

function hashPhrase(phrase) {
  return crypto
    .createHash('sha256')
    .update(normalizePhrase(phrase))
    .digest('hex');
}

async function createWallet(phrase, pin) {
  if (!phrase || String(phrase).trim() === '') {
    throw new Error('Recovery phrase is required');
  }

  const normalizedPhrase = normalizePhrase(phrase);
  const hasPin = pin !== undefined && pin !== null && String(pin).trim() !== '';

  if (hasPin && String(pin).trim().length < 4) {
    throw new Error('PIN must be at least 4 digits');
  }

  const phraseHash = hashPhrase(normalizedPhrase);
  const pinHash = hasPin ? await bcrypt.hash(String(pin).trim(), 10) : null;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingUserResult = await client.query(
      `SELECT id
       FROM public.users
       WHERE phrase_hash = $1
       LIMIT 1`,
      [phraseHash]
    );

    if (existingUserResult.rows.length > 0) {
      throw new Error('Wallet already exists for these recovery words');
    }

    const userResult = await client.query(
      `INSERT INTO public.users (phrase_hash, pin_hash, status)
       VALUES ($1, $2, 'active')
       RETURNING id, created_at`,
      [phraseHash, pinHash]
    );

    const user = userResult.rows[0];

    await client.query('COMMIT');

    await ensureUserWallets(user.id);
    const wallets = await getUserWallets(user.id);

    return {
      userId: user.id,
      recoveryPhrase: normalizedPhrase,
      createdAt: user.created_at,
      wallets,
      hasPin,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loginWithPhraseAndPin(phrase, pin) {
  if (!phrase || String(phrase).trim() === '') {
    throw new Error('Recovery phrase is required');
  }

  const normalizedPhrase = normalizePhrase(phrase);
  const phraseHash = hashPhrase(normalizedPhrase);

  const userResult = await pool.query(
    `SELECT id, pin_hash, status
     FROM public.users
     WHERE phrase_hash = $1
     LIMIT 1`,
    [phraseHash]
  );

  const user = userResult.rows[0];

  if (!user) {
    throw new Error('Wallet not found');
  }

  if (user.status !== 'active') {
    throw new Error('Account is not active');
  }

  if (user.pin_hash) {
    if (pin === undefined || pin === null || String(pin).trim() === '') {
      throw new Error('PIN is required for this account');
    }

    const pinMatch = await bcrypt.compare(String(pin).trim(), user.pin_hash);

    if (!pinMatch) {
      throw new Error('Invalid PIN');
    }
  }

  await ensureUserWallets(user.id);
  const wallets = await getUserWallets(user.id);

  return {
    userId: user.id,
    wallets,
    hasPin: !!user.pin_hash,
  };
}

module.exports = {
  createWallet,
  loginWithPhraseAndPin,
};