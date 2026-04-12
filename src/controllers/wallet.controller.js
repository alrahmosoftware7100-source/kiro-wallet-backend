const {
  ensureUserWallets,
  getStoredWallets,
  sendAmount,
  getTransactions,
  syncWalletBalances,
} = require('../services/wallet.service');

async function getBalanceController(req, res) {
  try {
    const userId = req.user.userId;

    await ensureUserWallets(userId);
    const wallets = await getStoredWallets(userId);

    return res.status(200).json({
      success: true,
      message: 'Wallets fetched successfully',
      data: wallets,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch wallets',
    });
  }
}

async function refreshWalletBalancesController(req, res) {
  try {
    const userId = req.user.userId;

    const wallets = await syncWalletBalances(userId);

    return res.status(200).json({
      success: true,
      message: 'Wallet balances refreshed successfully',
      data: wallets,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to refresh wallet balances',
    });
  }
}

async function createWalletsController(req, res) {
  try {
    const userId = req.user.userId;

    const wallets = await ensureUserWallets(userId);

    return res.status(200).json({
      success: true,
      message: 'Wallets are ready',
      data: wallets,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create wallets',
    });
  }
}

async function sendController(req, res) {
  try {
    const userId = req.user.userId;
    const idempotencyKey = req.headers['idempotency-key'];

    const {
      asset,
      amount,
      toAddress,
      note = '',
      network,
    } = req.body;

    const result = await sendAmount({
      userId,
      asset,
      amount,
      toAddress,
      note,
      network,
      idempotencyKey,
    });

    return res.status(200).json({
      success: true,
      message: 'Transfer created successfully',
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to send amount',
    });
  }
}

async function getTransactionsController(req, res) {
  try {
    const userId = req.user.userId;

    const transactions = await getTransactions(userId);

    return res.status(200).json({
      success: true,
      message: 'Transactions fetched successfully',
      data: transactions,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch transactions',
    });
  }
}

module.exports = {
  getBalanceController,
  refreshWalletBalancesController,
  createWalletsController,
  sendController,
  getTransactionsController,
};