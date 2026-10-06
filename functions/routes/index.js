const express = require('express');
const authRoutes = require('./auth.routes');
const equipoRoutes = require('./equipos.routes');
const partidoRoutes = require('./partidos.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/equipos', equipoRoutes);
router.use('/partidos', partidoRoutes);

module.exports = router;