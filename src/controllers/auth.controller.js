const jwt = require('jsonwebtoken');
const {
  createWallet,
  loginWithPhraseAndPin,
} = require('../services/auth.service');

async function createWalletController(req, res) {
  try {
    const { phrase, pin } = req.body || {};

    console.log('CREATE WALLET REQUEST RECEIVED');
    console.log('BODY:', {
      phrase: phrase ? '[provided]' : '[missing]',
      pin: pin ? '[provided]' : '[missing]',
    });

    if (!phrase || !phrase.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Recovery phrase is required',
      });
    }

    const result = await createWallet(phrase.trim(), pin?.trim() || null);

    const token = jwt.sign(
      { userId: result.userId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success: true,
      message: 'Wallet created successfully',
      token,
      data: result,
    });
  } catch (error) {
    console.error('CREATE WALLET ERROR:', error);
    console.error('CREATE WALLET ERROR MESSAGE:', error?.message);
    console.error('CREATE WALLET ERROR STACK:', error?.stack);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
}

async function loginController(req, res) {
  try {
    const { phrase, pin } = req.body || {};

    console.log('LOGIN REQUEST RECEIVED');
    console.log('BODY:', {
      phrase: phrase ? '[provided]' : '[missing]',
      pin: pin ? '[provided]' : '[missing]',
    });

    if (!phrase || !phrase.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Recovery phrase is required',
      });
    }

    const result = await loginWithPhraseAndPin(
      phrase.trim(),
      pin?.trim() || null
    );

    const token = jwt.sign(
      { userId: result.userId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      data: result,
    });
  } catch (error) {
    console.error('LOGIN ERROR:', error);
    console.error('LOGIN ERROR MESSAGE:', error?.message);
    console.error('LOGIN ERROR STACK:', error?.stack);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
}

module.exports = {
  createWalletController,
  loginController,
};