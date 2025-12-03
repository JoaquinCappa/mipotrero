const { admin } = require('../config/firebase');

const checkAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res
      .status(401)
      .json({ mensaje: 'Acceso denegado. Se requiere token de autorizacion.' });
  }

  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    return res
      .status(401)
      .json({ mensaje: 'Acceso denegado. Token vacio o invalido.' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken, true);
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      emailVerified: Boolean(decoded.email_verified),
      phoneNumber: decoded.phone_number || null,
      token: decoded,
    };
    return next();
  } catch (error) {
    console.error('Error al verificar credencial:', error.message);
    return res
      .status(401)
      .json({ mensaje: 'Credencial invalida o expirada.', error: error.message });
  }
};

module.exports = checkAuth;
