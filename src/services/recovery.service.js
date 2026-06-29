const pool = require('../config/db');
const { ethers } = require('ethers');
const { TronWeb } = require('tronweb');
const bitcoin = require('bitcoinjs-lib');

const tronWeb = new TronWeb({
  fullHost: process.env.TRON_FULL_HOST || 'https://api.trongrid.io',
});

const SUPPORTED_NETWORKS = ['TRC20', 'ERC20', 'BTC'];

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeNetwork(network) {
  const cleanNetwork = String(network || '').trim().toUpperCase();

  if (!SUPPORTED_NETWORKS.includes(cleanNetwork)) {
    throw createHttpError('Unsupported recovery address network', 400);
  }

  return cleanNetwork;
}

function normalizeAddress(network, address) {
  const cleanAddress = String(address || '').trim();

  if (!cleanAddress) {
    throw createHttpError('Recovery address is required', 400);
  }

  if (network === 'ERC20') {
    return cleanAddress.toLowerCase();
  }

  return cleanAddress;
}

function validateRecoveryAddress(network, address) {
  if (network === 'ERC20' && !ethers.isAddress(address)) {
    throw createHttpError('Invalid ERC20 address', 400);
  }

  if (network === 'TRC20' && !tronWeb.isAddress(address)) {
    throw createHttpError('Invalid TRC20 address', 400);
  }

  if (network === 'BTC') {
    try {
      bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin);
    } catch (_) {
      throw createHttpError('Invalid BTC address', 400);
    }
  }
}

function mapRecoveryAddress(row) {
  return {
    id: row.id,
    userId: row.user_id,
    network: row.network,
    address: row.address,
    label: row.label,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getRecoveryAddresses(userId) {
  const result = await pool.query(
    `SELECT id, user_id, network, address, label, is_active, created_at, updated_at
     FROM public.trusted_recovery_addresses
     WHERE user_id = $1
       AND is_active = TRUE
     ORDER BY
       CASE network
         WHEN 'TRC20' THEN 1
         WHEN 'ERC20' THEN 2
         WHEN 'BTC' THEN 3
         ELSE 4
       END`,
    [userId]
  );

  return result.rows.map(mapRecoveryAddress);
}

async function upsertRecoveryAddress({ userId, network, address, label }) {
  const cleanNetwork = normalizeNetwork(network);
  const cleanAddress = String(address || '').trim();
  const cleanLabel = String(label || '').trim().slice(0, 80) || null;

  validateRecoveryAddress(cleanNetwork, cleanAddress);

  const normalizedAddress = normalizeAddress(cleanNetwork, cleanAddress);

  const result = await pool.query(
    `INSERT INTO public.trusted_recovery_addresses
       (user_id, network, address, address_normalized, label, is_active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     ON CONFLICT (user_id, network)
     DO UPDATE SET
       address = EXCLUDED.address,
       address_normalized = EXCLUDED.address_normalized,
       label = EXCLUDED.label,
       is_active = TRUE,
       updated_at = NOW()
     RETURNING id, user_id, network, address, label, is_active, created_at, updated_at`,
    [userId, cleanNetwork, cleanAddress, normalizedAddress, cleanLabel]
  );

  return mapRecoveryAddress(result.rows[0]);
}

async function deleteRecoveryAddress(userId, network) {
  const cleanNetwork = normalizeNetwork(network);

  const result = await pool.query(
    `UPDATE public.trusted_recovery_addresses
     SET is_active = FALSE,
         updated_at = NOW()
     WHERE user_id = $1
       AND network = $2
     RETURNING id, user_id, network, address, label, is_active, created_at, updated_at`,
    [userId, cleanNetwork]
  );

  return result.rows[0] ? mapRecoveryAddress(result.rows[0]) : null;
}

async function findRecoveryAddressesByAddress({ address, network }) {
  const rawAddress = String(address || '').trim();

  if (!rawAddress) {
    throw createHttpError('Search address is required', 400);
  }

  const values = [];
  const where = ['tra.is_active = TRUE'];

  if (network) {
    const cleanNetwork = normalizeNetwork(network);
    values.push(cleanNetwork);
    where.push(`tra.network = $${values.length}`);
    values.push(normalizeAddress(cleanNetwork, rawAddress));
    where.push(`tra.address_normalized = $${values.length}`);
  } else {
    const candidates = Array.from(
      new Set([rawAddress, rawAddress.toLowerCase()])
    );
    values.push(candidates);
    where.push(`tra.address_normalized = ANY($${values.length})`);
  }

  const result = await pool.query(
    `SELECT
       tra.id,
       tra.user_id,
       tra.network,
       tra.address,
       tra.label,
       tra.is_active,
       tra.created_at,
       tra.updated_at,
       u.status AS user_status,
       u.created_at AS user_created_at,
       COALESCE(
         json_agg(
           json_build_object(
             'id', w.id,
             'asset', w.asset,
             'network', w.network,
             'address', w.address,
             'balance', w.balance
           )
           ORDER BY w.id ASC
         ) FILTER (WHERE w.id IS NOT NULL),
         '[]'
       ) AS wallets
     FROM public.trusted_recovery_addresses tra
     JOIN public.users u ON u.id = tra.user_id
     LEFT JOIN public.wallets w ON w.user_id = tra.user_id
     WHERE ${where.join(' AND ')}
     GROUP BY
       tra.id,
       tra.user_id,
       tra.network,
       tra.address,
       tra.label,
       tra.is_active,
       tra.created_at,
       tra.updated_at,
       u.status,
       u.created_at
     ORDER BY tra.updated_at DESC
     LIMIT 25`,
    values
  );

  return result.rows.map((row) => ({
    recoveryAddress: mapRecoveryAddress(row),
    user: {
      id: row.user_id,
      status: row.user_status,
      createdAt: row.user_created_at,
    },
    wallets: row.wallets || [],
  }));
}

module.exports = {
  getRecoveryAddresses,
  upsertRecoveryAddress,
  deleteRecoveryAddress,
  findRecoveryAddressesByAddress,
};
