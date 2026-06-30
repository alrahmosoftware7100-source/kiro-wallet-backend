const {
  calculateSwapFeePreview,
  getPlatformFeeSummary,
  getSwapFeeSettings,
} = require('../services/platformFee.service');
const {
  createSwapOrder,
  getProviderCurrencies,
  getSwapOrder,
  listSwapOrders,
  quoteSwap,
  syncSwapOrderStatus,
} = require('../services/swap.service');

async function getSwapSettingsController(req, res) {
  try {
    return res.status(200).json({
      success: true,
      data: getSwapFeeSettings(),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to get swap settings',
    });
  }
}

async function previewSwapFeeController(req, res) {
  try {
    const preview = calculateSwapFeePreview({
      grossAmount: req.body?.grossAmount,
      sourceAsset: req.body?.sourceAsset,
      sourceNetwork: req.body?.sourceNetwork,
      targetAsset: req.body?.targetAsset,
      targetNetwork: req.body?.targetNetwork,
    });

    return res.status(200).json({
      success: true,
      message: 'Swap fee preview created successfully',
      data: preview,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to preview swap fee',
    });
  }
}

async function getSwapCurrenciesController(req, res) {
  try {
    const currencies = await getProviderCurrencies({
      limit: req.query?.limit,
    });

    return res.status(200).json({
      success: true,
      count: currencies.length,
      data: currencies,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch swap currencies',
      details: error.details,
    });
  }
}

async function quoteSwapController(req, res) {
  try {
    const quote = await quoteSwap(req.user.userId, {
      grossAmount: req.body?.grossAmount,
      sourceNetwork: req.body?.sourceNetwork,
      targetAsset: req.body?.targetAsset,
      targetNetwork: req.body?.targetNetwork,
      targetTicker: req.body?.targetTicker,
    });

    return res.status(200).json({
      success: true,
      message: 'Swap quote created successfully',
      data: quote,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to create swap quote',
      details: error.details,
    });
  }
}

async function createSwapOrderController(req, res) {
  try {
    const result = await createSwapOrder(
      req.user.userId,
      {
        grossAmount: req.body?.grossAmount,
        sourceNetwork: req.body?.sourceNetwork,
        targetAsset: req.body?.targetAsset,
        targetNetwork: req.body?.targetNetwork,
        targetTicker: req.body?.targetTicker,
        targetAddress: req.body?.targetAddress,
        payoutExtraId: req.body?.payoutExtraId,
      },
      req.headers['idempotency-key']
    );

    return res.status(result.duplicate ? 200 : 201).json({
      success: true,
      message: result.duplicate
        ? 'Swap order already exists'
        : 'Swap order created successfully',
      data: result,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to create swap order',
      details: error.details,
    });
  }
}

async function listSwapOrdersController(req, res) {
  try {
    const orders = await listSwapOrders(req.user.userId, {
      limit: req.query?.limit,
    });

    return res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch swap orders',
    });
  }
}

async function getSwapOrderController(req, res) {
  try {
    const order = await getSwapOrder(req.user.userId, req.params.id);

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch swap order',
    });
  }
}

async function syncSwapOrderStatusController(req, res) {
  try {
    const order = await syncSwapOrderStatus(req.user.userId, req.params.id);

    return res.status(200).json({
      success: true,
      message: 'Swap order status synced successfully',
      data: order,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to sync swap order status',
      details: error.details,
    });
  }
}

async function adminPlatformFeesController(req, res) {
  try {
    const summary = await getPlatformFeeSummary({
      limit: req.query?.limit,
      status: req.query?.status,
    });

    return res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch platform fees',
    });
  }
}

module.exports = {
  adminPlatformFeesController,
  createSwapOrderController,
  getSwapCurrenciesController,
  getSwapOrderController,
  getSwapSettingsController,
  listSwapOrdersController,
  previewSwapFeeController,
  quoteSwapController,
  syncSwapOrderStatusController,
};
