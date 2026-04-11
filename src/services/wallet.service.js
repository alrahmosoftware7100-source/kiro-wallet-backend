const crypto = require('crypto');
const fetch = require('node-fetch');
const pool = require('../config/db');
const { ethers } = require('ethers');
const { TronWeb } = require('tronweb');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
const { ECPairFactory } = require('ecpair');

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

const BTC_NETWORK = bitcoin.networks.bitcoin;

const WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY;
const ETH_RPC_URL = process.env.ETH_RPC_URL;
const TRON_FULL_HOST = process.env.TRON_FULL_HOST || 'https://api.trongrid.io';
const BTC_ESPLORA_BASE_URL =
  process.env.BTC_ESPLORA_BASE_URL || 'https://blockstream.info/api';

const ETH_USDT_CONTRACT =
  process.env.ETH_USDT_CONTRACT ||
  '0xdAC17F958D2ee523a2206206994597C13D831ec7';

const TRON_USDT_CONTRACT =
  process.env.TRON_USDT_CONTRACT ||
  'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

if (!WALLET_ENCRYPTION_KEY || WALLET_ENCRYPTION_KEY.length !== 64) {
  throw new Error(
    'WALLET_ENCRYPTION_KEY is required and must be a 64-char hex string (32 bytes)'
  );
}

if (!ETH_RPC_URL) {
  throw new Error('ETH_RPC_URL is required in .env');
}

const ethProvider = new ethers.JsonRpcProvider(ETH_RPC_URL);

const tronWeb = new TronWeb({
  fullHost: TRON_FULL_HOST,
});

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 value) returns (bool)',
];

function encryptText(plainText) {
  const iv = crypto.randomBytes(12);
  const key = Buffer.from(WALLET_ENCRYPTION_KEY, 'hex');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(String(plainText), 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    cipherText: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

function decryptText(cipherText, iv, authTag) {
  const key = Buffer.from(WALLET_ENCRYPTION_KEY, 'hex');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'hex')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

function generateEthereumWallet() {
  const wallet = ethers.Wallet.createRandom();

  return {
    asset: 'USDT',
    network: 'ERC20',
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}

async function generateTronWallet() {
  const account = await tronWeb.createAccount();

  return {
    asset: 'USDT',
    network: 'TRC20',
    address: account.address.base58,
    privateKey: account.privateKey,
  };
}

function generateBitcoinWallet() {
  const keyPair = ECPair.makeRandom({ network: BTC_NETWORK });

  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: BTC_NETWORK,
  });

  if (!address) {
    throw new Error('Failed to generate BTC address');
  }

  return {
    asset: 'BTC',
    network: 'BTC',
    address,
    privateKey: keyPair.toWIF(),
  };
}

async function insertWallet(client, userId, walletData) {
  const encrypted = encryptText(walletData.privateKey);

  const result = await client.query(
    `INSERT INTO public.wallets
      (user_id, asset, network, address, balance, private_key_encrypted, private_key_iv, private_key_tag)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, user_id, asset, network, address, balance`,
    [
      userId,
      walletData.asset,
      walletData.network,
      walletData.address,
      0,
      encrypted.cipherText,
      encrypted.iv,
      encrypted.authTag,
    ]
  );

  return result.rows[0];
}

async function ensureUserWallets(userId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingResult = await client.query(
      `SELECT id, asset, network, address, balance
       FROM public.wallets
       WHERE user_id = $1
       ORDER BY id ASC`,
      [userId]
    );

    const existing = existingResult.rows;
    const existingNetworks = new Set(existing.map((row) => row.network));
    const createdWallets = [];

    if (!existingNetworks.has('ERC20')) {
      const ethWallet = generateEthereumWallet();
      const inserted = await insertWallet(client, userId, ethWallet);
      createdWallets.push(inserted);
    }

    if (!existingNetworks.has('TRC20')) {
      const tronWallet = await generateTronWallet();
      const inserted = await insertWallet(client, userId, tronWallet);
      createdWallets.push(inserted);
    }

    if (!existingNetworks.has('BTC')) {
      const btcWallet = generateBitcoinWallet();
      const inserted = await insertWallet(client, userId, btcWallet);
      createdWallets.push(inserted);
    }

    await client.query('COMMIT');

    return [...existing, ...createdWallets].sort((a, b) => a.id - b.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parsePositiveAmount(amount) {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Amount must be greater than 0');
  }
  return parsed;
}

function toTrc20BaseUnits(amount) {
  return Math.round(amount * 1_000_000);
}

function toErc20BaseUnits(amount, decimals = 6) {
  return ethers.parseUnits(String(amount), decimals);
}

function toBtcSatoshis(amount) {
  const parsed = parsePositiveAmount(amount);
  return Math.round(parsed * 100000000);
}

function fromBtcSatoshis(sats) {
  return safeNumber(sats / 100000000, 0);
}

async function getErc20UsdtBalance(address) {
  try {
    const contract = new ethers.Contract(
      ETH_USDT_CONTRACT,
      ERC20_ABI,
      ethProvider
    );

    const rawBalance = await contract.balanceOf(address);

    let decimals = 6;
    try {
      const d = await contract.decimals();
      decimals = Number(d);
    } catch (_) {}

    const formatted = ethers.formatUnits(rawBalance, decimals);
    return safeNumber(formatted, 0);
  } catch (error) {
    console.error('ERC20 balance fetch failed:', error.message);
    return 0;
  }
}

async function getTrc20UsdtBalance(address) {
  try {
    const contract = await tronWeb.contract().at(TRON_USDT_CONTRACT);
    const rawBalance = await contract.balanceOf(address).call();

    const normalized = tronWeb.toBigNumber(rawBalance).toString(10);
    return safeNumber(Number(normalized) / 1e6, 0);
  } catch (error) {
    console.error('TRC20 balance fetch failed:', error.message);
    return 0;
  }
}

async function getBtcBalance(address) {
  try {
    const response = await fetch(`${BTC_ESPLORA_BASE_URL}/address/${address}`);

    if (!response.ok) {
      throw new Error(`BTC API HTTP ${response.status}`);
    }

    const data = await response.json();

    const chainFunded = safeNumber(data?.chain_stats?.funded_txo_sum, 0);
    const chainSpent = safeNumber(data?.chain_stats?.spent_txo_sum, 0);
    const mempoolFunded = safeNumber(data?.mempool_stats?.funded_txo_sum, 0);
    const mempoolSpent = safeNumber(data?.mempool_stats?.spent_txo_sum, 0);

    const satoshis = chainFunded - chainSpent + mempoolFunded - mempoolSpent;

    return safeNumber(satoshis / 100000000, 0);
  } catch (error) {
    console.error('BTC balance fetch failed:', error.message);
    return 0;
  }
}

async function getLiveBalanceForWallet(wallet) {
  if (wallet.network === 'ERC20') {
    return getErc20UsdtBalance(wallet.address);
  }

  if (wallet.network === 'TRC20') {
    return getTrc20UsdtBalance(wallet.address);
  }

  if (wallet.network === 'BTC') {
    return getBtcBalance(wallet.address);
  }

  return safeNumber(wallet.balance, 0);
}

async function syncWalletBalances(userId) {
  await ensureUserWallets(userId);

  const result = await pool.query(
    `SELECT id, user_id, asset, network, address, balance
     FROM public.wallets
     WHERE user_id = $1
     ORDER BY id ASC`,
    [userId]
  );

  const wallets = result.rows;

  const syncedWallets = await Promise.all(
    wallets.map(async (wallet) => {
      const liveBalance = await getLiveBalanceForWallet(wallet);

      await pool.query(
        `UPDATE public.wallets
         SET balance = $1
         WHERE id = $2`,
        [liveBalance, wallet.id]
      );

      return {
        ...wallet,
        balance: liveBalance,
      };
    })
  );

  return syncedWallets;
}

async function getUserWallets(userId) {
  return syncWalletBalances(userId);
}

async function getWalletBalance(userId) {
  return syncWalletBalances(userId);
}

async function getStoredWallets(userId) {
  const result = await pool.query(
    `SELECT id, user_id, asset, network, address, balance
     FROM public.wallets
     WHERE user_id = $1
     ORDER BY id ASC`,
    [userId]
  );

  return result.rows;
}

async function getWalletWithSecret(userId, network) {
  const result = await pool.query(
    `SELECT id, user_id, asset, network, address, balance,
            private_key_encrypted, private_key_iv, private_key_tag
     FROM public.wallets
     WHERE user_id = $1 AND network = $2
     LIMIT 1`,
    [userId, network]
  );

  return result.rows[0] || null;
}

async function createTransactionRecord({
  userId,
  type,
  amount,
  status,
  note,
}) {
  await pool.query(
    `INSERT INTO public.transactions (user_id, type, amount, status, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, type, amount, status, note]
  );
}

async function sendUSDT_TRC20(userId, toAddress, amount, note = '') {
  if (!toAddress || !String(toAddress).trim()) {
    throw new Error('Destination address is required');
  }

  const cleanToAddress = String(toAddress).trim();

  if (!tronWeb.isAddress(cleanToAddress)) {
    throw new Error('Invalid TRC20 address');
  }

  const sendValue = parsePositiveAmount(amount);

  await ensureUserWallets(userId);
  await syncWalletBalances(userId);

  const wallet = await getWalletWithSecret(userId, 'TRC20');

  if (!wallet) {
    throw new Error('TRC20 wallet not found');
  }

  const currentBalance = safeNumber(wallet.balance, 0);

  if (currentBalance < sendValue) {
    throw new Error('Insufficient USDT balance');
  }

  const privateKey = decryptText(
    wallet.private_key_encrypted,
    wallet.private_key_iv,
    wallet.private_key_tag
  );

  const tronWebWithKey = new TronWeb({
    fullHost: TRON_FULL_HOST,
    privateKey,
  });

  const contract = await tronWebWithKey.contract().at(TRON_USDT_CONTRACT);
  const amountInBaseUnits = toTrc20BaseUnits(sendValue);

  let txHash = '';

  try {
    txHash = await contract.transfer(cleanToAddress, amountInBaseUnits).send({
      feeLimit: 100000000,
    });
  } catch (error) {
    throw new Error(
      error?.message ||
        'TRC20 transfer failed. Make sure the wallet has enough TRX for fees.'
    );
  }

  const refreshedWallets = await syncWalletBalances(userId);
  const refreshedTrc20Wallet = refreshedWallets.find(
    (item) => item.network === 'TRC20'
  );

  await createTransactionRecord({
    userId,
    type: 'send',
    amount: sendValue,
    status: 'completed',
    note: `${note || 'TRC20 transfer'} -> ${cleanToAddress} [TRC20] tx:${txHash}`,
  });

  return {
    balance: refreshedTrc20Wallet?.balance ?? 0,
    sentAmount: sendValue,
    network: 'TRC20',
    toAddress: cleanToAddress,
    txHash,
  };
}

async function sendUSDT_ERC20(userId, toAddress, amount, note = '') {
  if (!toAddress || !String(toAddress).trim()) {
    throw new Error('Destination address is required');
  }

  const cleanToAddress = String(toAddress).trim();

  if (!ethers.isAddress(cleanToAddress)) {
    throw new Error('Invalid ERC20 address');
  }

  const sendValue = parsePositiveAmount(amount);

  await ensureUserWallets(userId);
  await syncWalletBalances(userId);

  const walletRow = await getWalletWithSecret(userId, 'ERC20');

  if (!walletRow) {
    throw new Error('ERC20 wallet not found');
  }

  const currentBalance = safeNumber(walletRow.balance, 0);

  if (currentBalance < sendValue) {
    throw new Error('Insufficient USDT balance');
  }

  const privateKey = decryptText(
    walletRow.private_key_encrypted,
    walletRow.private_key_iv,
    walletRow.private_key_tag
  );

  const signer = new ethers.Wallet(privateKey, ethProvider);

  const nativeBalance = await ethProvider.getBalance(walletRow.address);
  if (nativeBalance <= 0n) {
    throw new Error('Not enough ETH for gas fees');
  }

  const contract = new ethers.Contract(ETH_USDT_CONTRACT, ERC20_ABI, signer);

  let decimals = 6;
  try {
    decimals = Number(await contract.decimals());
  } catch (_) {}

  const amountInBaseUnits = toErc20BaseUnits(sendValue, decimals);

  let tx;
  try {
    tx = await contract.transfer(cleanToAddress, amountInBaseUnits);
  } catch (error) {
    throw new Error(error?.reason || error?.message || 'ERC20 transfer failed');
  }

  const receipt = await tx.wait();

  const refreshedWallets = await syncWalletBalances(userId);
  const refreshedErc20Wallet = refreshedWallets.find(
    (item) => item.network === 'ERC20'
  );

  await createTransactionRecord({
    userId,
    type: 'send',
    amount: sendValue,
    status: receipt?.status === 1 ? 'completed' : 'failed',
    note: `${note || 'ERC20 transfer'} -> ${cleanToAddress} [ERC20] tx:${tx.hash}`,
  });

  return {
    balance: refreshedErc20Wallet?.balance ?? 0,
    sentAmount: sendValue,
    network: 'ERC20',
    toAddress: cleanToAddress,
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber || null,
    status: receipt?.status === 1 ? 'completed' : 'failed',
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} - ${text || 'Request failed'}`);
  }

  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} - ${text || 'Request failed'}`);
  }

  return response.text();
}

async function getBtcUtxos(address) {
  return fetchJson(`${BTC_ESPLORA_BASE_URL}/address/${address}/utxo`);
}

async function getBtcRecommendedFeeRate() {
  try {
    const feeMap = await fetchJson(`${BTC_ESPLORA_BASE_URL}/fee-estimates`);
    const fastest = safeNumber(feeMap?.['1'], 0);
    const halfHour = safeNumber(feeMap?.['3'], 0);
    const hour = safeNumber(feeMap?.['6'], 0);

    return Math.max(Math.ceil(fastest || halfHour || hour || 5), 2);
  } catch (error) {
    console.error('BTC fee estimate failed:', error.message);
    return 5;
  }
}

function estimateP2WpkhTxSize(inputCount, outputCount) {
  return inputCount * 68 + outputCount * 31 + 10;
}

function selectBtcUtxos(utxos, targetAmountSats, feeRate) {
  const sorted = [...utxos].sort((a, b) => b.value - a.value);

  let selected = [];
  let total = 0;

  for (const utxo of sorted) {
    selected.push(utxo);
    total += safeNumber(utxo.value, 0);

    const estimatedFee = Math.ceil(
      estimateP2WpkhTxSize(selected.length, 2) * feeRate
    );

    if (total >= targetAmountSats + estimatedFee) {
      return {
        selected,
        total,
        fee: estimatedFee,
      };
    }
  }

  throw new Error('Insufficient BTC balance for amount + network fee');
}

async function broadcastBtcTransaction(rawHex) {
  return fetchText(`${BTC_ESPLORA_BASE_URL}/tx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
    },
    body: rawHex,
  });
}

async function sendBTC(userId, toAddress, amount, note = '') {
  if (!toAddress || !String(toAddress).trim()) {
    throw new Error('Destination address is required');
  }

  const cleanToAddress = String(toAddress).trim();

  try {
    bitcoin.address.toOutputScript(cleanToAddress, BTC_NETWORK);
  } catch (_) {
    throw new Error('Invalid BTC address');
  }

  const sendValue = parsePositiveAmount(amount);
  const amountSats = toBtcSatoshis(sendValue);

  await ensureUserWallets(userId);
  await syncWalletBalances(userId);

  const walletRow = await getWalletWithSecret(userId, 'BTC');

  if (!walletRow) {
    throw new Error('BTC wallet not found');
  }

  const currentBalance = safeNumber(walletRow.balance, 0);
  if (currentBalance < sendValue) {
    throw new Error('Insufficient BTC balance');
  }

  const privateKey = decryptText(
    walletRow.private_key_encrypted,
    walletRow.private_key_iv,
    walletRow.private_key_tag
  );

  const keyPair = ECPair.fromWIF(privateKey, BTC_NETWORK);

  const senderPayment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: BTC_NETWORK,
  });

  if (!senderPayment.address || senderPayment.address !== walletRow.address) {
    throw new Error('BTC wallet key mismatch');
  }

  const utxos = await getBtcUtxos(walletRow.address);

  if (!Array.isArray(utxos) || utxos.length === 0) {
    throw new Error('No spendable BTC UTXOs found');
  }

  const feeRate = await getBtcRecommendedFeeRate();
  const { selected, total, fee } = selectBtcUtxos(utxos, amountSats, feeRate);

  const change = total - amountSats - fee;

  if (change < 0) {
    throw new Error('Insufficient BTC balance after fee calculation');
  }

  const psbt = new bitcoin.Psbt({ network: BTC_NETWORK });

  for (const utxo of selected) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: senderPayment.output,
        value: safeNumber(utxo.value, 0),
      },
    });
  }

  psbt.addOutput({
    address: cleanToAddress,
    value: amountSats,
  });

  const dustLimit = 546;

  if (change >= dustLimit) {
    psbt.addOutput({
      address: walletRow.address,
      value: change,
    });
  }

  for (let i = 0; i < selected.length; i += 1) {
    psbt.signInput(i, keyPair);
  }

  psbt.finalizeAllInputs();

  const rawTx = psbt.extractTransaction().toHex();
  const txHash = await broadcastBtcTransaction(rawTx);

  const refreshedWallets = await syncWalletBalances(userId);
  const refreshedBtcWallet = refreshedWallets.find(
    (item) => item.network === 'BTC'
  );

  await createTransactionRecord({
    userId,
    type: 'send',
    amount: sendValue,
    status: 'pending',
    note: `${note || 'BTC transfer'} -> ${cleanToAddress} [BTC] tx:${txHash} fee:${fromBtcSatoshis(fee)} BTC`,
  });

  return {
    balance: refreshedBtcWallet?.balance ?? 0,
    sentAmount: sendValue,
    network: 'BTC',
    toAddress: cleanToAddress,
    txHash,
    feeBtc: fromBtcSatoshis(fee),
    status: 'pending',
  };
}

async function sendAmount(
  userId,
  amount,
  toAddress,
  note = '',
  network = 'TRC20'
) {
  if (network === 'TRC20') {
    return sendUSDT_TRC20(userId, toAddress, amount, note);
  }

  if (network === 'ERC20') {
    return sendUSDT_ERC20(userId, toAddress, amount, note);
  }

  if (network === 'BTC') {
    return sendBTC(userId, toAddress, amount, note);
  }

  throw new Error('Unsupported network');
}

async function getBtcTransactions(address) {
  try {
    const response = await fetch(
      `${BTC_ESPLORA_BASE_URL}/address/${address}/txs`
    );

    if (!response.ok) {
      throw new Error(`BTC tx API HTTP ${response.status}`);
    }

    const txs = await response.json();

    return txs.slice(0, 20).map((tx) => {
      const received = (tx.vout || [])
        .filter((vout) => vout?.scriptpubkey_address === address)
        .reduce((sum, vout) => sum + safeNumber(vout.value, 0), 0);

      const sent = (tx.vin || [])
        .filter((vin) => vin?.prevout?.scriptpubkey_address === address)
        .reduce((sum, vin) => sum + safeNumber(vin?.prevout?.value, 0), 0);

      const net = received - sent;

      return {
        txHash: tx.txid,
        type: net >= 0 ? 'receive' : 'send',
        amount: Math.abs(net) / 100000000,
        status: tx.status?.confirmed ? 'confirmed' : 'pending',
        note: 'BTC on-chain',
        created_at: tx.status?.block_time
          ? new Date(tx.status.block_time * 1000).toISOString()
          : new Date().toISOString(),
        network: 'BTC',
      };
    });
  } catch (error) {
    console.error('BTC tx fetch failed:', error.message);
    return [];
  }
}

async function getTransactions(userId) {
  await ensureUserWallets(userId);

  const walletsResult = await pool.query(
    `SELECT id, asset, network, address
     FROM public.wallets
     WHERE user_id = $1
     ORDER BY id ASC`,
    [userId]
  );

  const wallets = walletsResult.rows;

  const dbTransactionsResult = await pool.query(
    `SELECT id, type, amount, status, note, created_at
     FROM public.transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [userId]
  );

  const dbTransactions = dbTransactionsResult.rows.map((tx) => ({
    ...tx,
    network: 'internal',
  }));

  const btcWallet = wallets.find((w) => w.network === 'BTC');
  const btcTransactions = btcWallet
    ? await getBtcTransactions(btcWallet.address)
    : [];

  const allTransactions = [...btcTransactions, ...dbTransactions];

  allTransactions.sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    return bTime - aTime;
  });

  return allTransactions.slice(0, 30);
}

async function getUserDecryptedWalletSecrets(userId) {
  const result = await pool.query(
    `SELECT id, asset, network, address, private_key_encrypted, private_key_iv, private_key_tag
     FROM public.wallets
     WHERE user_id = $1
     ORDER BY id ASC`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    asset: row.asset,
    network: row.network,
    address: row.address,
    privateKey: decryptText(
      row.private_key_encrypted,
      row.private_key_iv,
      row.private_key_tag
    ),
  }));
}

module.exports = {
  ensureUserWallets,
  getUserWallets,
  getWalletBalance,
  getStoredWallets,
  sendAmount,
  sendUSDT_TRC20,
  sendUSDT_ERC20,
  sendBTC,
  getTransactions,
  getUserDecryptedWalletSecrets,
  syncWalletBalances,
};