function validateSendRequest(req, res, next) {
  const { asset, network, toAddress, amount, note } = req.body;

  const cleanNetwork = String(network || '').trim().toUpperCase();
  const cleanAsset = String(asset || '').trim().toUpperCase();
  const cleanAddress = String(toAddress || '').trim();
  const cleanNote = String(note || '').trim();

  if (!cleanNetwork) {
    return res.status(400).json({
      success: false,
      message: 'Network is required',
    });
  }

  if (!['TRC20', 'ERC20', 'BTC'].includes(cleanNetwork)) {
    return res.status(400).json({
      success: false,
      message: 'Unsupported network',
    });
  }

  if (cleanNetwork === 'BTC') {
    if (cleanAsset && cleanAsset !== 'BTC') {
      return res.status(400).json({
        success: false,
        message: 'BTC network only supports BTC asset',
      });
    }
  } else {
    if (cleanAsset && cleanAsset !== 'USDT') {
      return res.status(400).json({
        success: false,
        message: 'Only USDT is supported for ERC20 and TRC20',
      });
    }
  }

  if (!cleanAddress || cleanAddress.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'Valid destination address is required',
    });
  }

  if (amount === undefined || amount === null || amount === '') {
    return res.status(400).json({
      success: false,
      message: 'Amount is required',
    });
  }

  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Amount must be a valid number greater than zero',
    });
  }

  req.body.network = cleanNetwork;
  req.body.asset = cleanNetwork === 'BTC' ? 'BTC' : (cleanAsset || 'USDT');
  req.body.toAddress = cleanAddress;
  req.body.amount = numericAmount;
  req.body.note = cleanNote.slice(0, 250);

  next();
}

module.exports = {
  validateSendRequest,
};