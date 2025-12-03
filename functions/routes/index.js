const express = require('express');
const authRoutes = require('./auth.routes');
const equipoRoutes = require('./equipos.routes');
const partidoRoutes = require('./partidos.routes');
const router = express.Router();
const paymentsRoutes = require('./payments.routes');

router.use('/auth', authRoutes);
router.use('/equipos', equipoRoutes);
router.use('/partidos', partidoRoutes);
router.use('/payments', paymentsRoutes);

module.exports = router;
