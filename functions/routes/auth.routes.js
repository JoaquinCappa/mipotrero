const express = require('express');
const {
  registerUser,
  getProfile,
  sessionLogin,
  sessionLogout,
  linkPhoneNumber,
  validateProfileFields,
  checkPhoneAvailabilityPublic,
  startPhoneVerification,
  savePushToken,
} = require('../controllers/auth.controller');
const checkAuth = require('../middleware/auth.middleware');
const router = express.Router();

router.post('/register', registerUser);
router.post('/sessionLogin', sessionLogin);
router.post('/sessionLogout', sessionLogout);
router.post('/phone', checkAuth, linkPhoneNumber);
router.post('/phone/pending', checkAuth, startPhoneVerification);
router.post('/phone/check', checkPhoneAvailabilityPublic);
router.post('/profile/validate', checkAuth, validateProfileFields);
router.post('/push-token', checkAuth, savePushToken);
// No necesitamos una ruta de login aquí, ya que el frontend usa el Client SDK 
// y el token se genera automáticamente, pero incluimos una ruta de perfil protegida.
router.get('/profile', checkAuth, getProfile);

module.exports = router;
