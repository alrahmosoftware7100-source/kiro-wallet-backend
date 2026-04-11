const {
  ensureUserWallets,
  getUserWallets,
  sendAmount,
  getTransactions,
} = require('../services/wallet.service');

async function getBalanceController(req, res) {
  try {
    const userId = req.user.userId;

    await ensureUserWallets(userId);
    const wallets = await getUserWallets(userId);

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
    const { amount, toAddress, note, network } = req.body;

    if (amount === undefined || amount === null) {
      return res.status(400).json({
        success: false,
        message: 'Amount is required',
      });
    }

    if (!toAddress || !String(toAddress).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Destination address is required',
      });
    }

    const result = await sendAmount(
      userId,
      amount,
      String(toAddress).trim(),
      note || '',
      network || 'TRC20'
    );

    return res.status(200).json({
      success: true,
      message: 'Amount sent successfully',
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
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
  createWalletsController,
  sendController,
  getTransactionsController,
};