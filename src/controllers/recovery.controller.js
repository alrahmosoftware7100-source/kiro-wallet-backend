const {
  getRecoveryAddresses,
  upsertRecoveryAddress,
  deleteRecoveryAddress,
  findRecoveryAddressesByAddress,
} = require('../services/recovery.service');

async function getRecoveryAddressesController(req, res) {
  try {
    const addresses = await getRecoveryAddresses(req.user.userId);

    return res.status(200).json({
      success: true,
      message: 'Recovery addresses fetched successfully',
      data: addresses,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch recovery addresses',
    });
  }
}

async function saveRecoveryAddressController(req, res) {
  try {
    const address = await upsertRecoveryAddress({
      userId: req.user.userId,
      network: req.body?.network,
      address: req.body?.address,
      label: req.body?.label,
    });

    return res.status(200).json({
      success: true,
      message: 'Recovery address saved successfully',
      data: address,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to save recovery address',
    });
  }
}

async function deleteRecoveryAddressController(req, res) {
  try {
    const address = await deleteRecoveryAddress(
      req.user.userId,
      req.params.network
    );

    return res.status(200).json({
      success: true,
      message: address
        ? 'Recovery address removed successfully'
        : 'Recovery address was already empty',
      data: address,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to remove recovery address',
    });
  }
}

async function adminSearchRecoveryAddressController(req, res) {
  try {
    const matches = await findRecoveryAddressesByAddress({
      address: req.query?.address,
      network: req.query?.network,
    });

    return res.status(200).json({
      success: true,
      message: 'Recovery address search completed',
      data: matches,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to search recovery address',
    });
  }
}

module.exports = {
  getRecoveryAddressesController,
  saveRecoveryAddressController,
  deleteRecoveryAddressController,
  adminSearchRecoveryAddressController,
};
