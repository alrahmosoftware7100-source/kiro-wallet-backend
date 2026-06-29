const {
  calculateSwapFeePreview,
  getPlatformFeeSummary,
  getSwapFeeSettings,
} = require('../services/platformFee.service');

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
  getSwapSettingsController,
  previewSwapFeeController,
};
