const express = require('express');
const checkAuth = require('../middleware/auth.middleware');
const {
  createCheckoutSession,
  getCheckoutSession,
} = require('../controllers/payments.controller');

const router = express.Router();

router.post('/checkout', checkAuth, createCheckoutSession);
router.get('/checkout/session', checkAuth, getCheckoutSession);

module.exports = router;
