const { admin, auth, db } = require('../config/firebase');
const { COLLECTIONS, setDocument, getDocument, findDocuments } = require('../services/firestore.service');

const normalizePhoneInput = (value = '') => {
  if (typeof value !== 'string') return '';
  let phone = value.trim();
  if (!phone) return '';

  // Remove spaces, hyphens and parentheses but keep leading +
  const startsWithPlus = phone.startsWith('+');
  phone = phone.replace(/[^\d+]/g, '');

  if (!phone) return '';

  if (startsWithPlus) {
    const normalized = `+${phone.slice(1).replace(/\D/g, '')}`;
    return normalized.length >= 10 ? normalized : '';
  }

  let digits = phone.replace(/\D/g, '');
  if (!digits) return '';

  digits = digits.replace(/^0+/, '');

  if (digits.startsWith('549')) {
    return `+${digits}`;
  }

  if (digits.startsWith('54')) {
    return `+549${digits.slice(2)}`;
  }

  return `+549${digits}`;
};

const normalizeAge = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.floor(num);
  if (rounded < 10 || rounded > 90) return null;
  return rounded;
};

const hasPhoneConflict = async (normalizedPhone, excludeUid = null) => {
  if (!normalizedPhone) return false;

  const usersCollection = db.collection(COLLECTIONS.USERS);
  const legacyCollection = db.collection(COLLECTIONS.USUARIOS);

  const [verifiedSnap, pendingSnap, legacySnap] = await Promise.all([
    usersCollection.where('phoneNumber', '==', normalizedPhone).limit(5).get(),
    usersCollection.where('pendingPhoneNumber', '==', normalizedPhone).limit(5).get(),
    legacyCollection.where('phoneNumber', '==', normalizedPhone).limit(5).get(),
  ]);

  const conflicts = [verifiedSnap, pendingSnap, legacySnap].some((snapshot) =>
    snapshot.docs.some((doc) => (excludeUid ? doc.id !== excludeUid : true))
  );

  return conflicts;
};

const syncUserPhoneData = async (uid, data) => {
  await Promise.all([
    setDocument(COLLECTIONS.USUARIOS, uid, data),
    db.collection(COLLECTIONS.USERS).doc(uid).set(data, { merge: true }),
  ]);
};

/**
 * Registers a user in Firebase Auth and stores their profile in Firestore.
 */
const registerUser = async (req, res) => {
  const {
    email,
    password,
    nombre,
    esCapitan = false,
    phoneNumber: rawPhoneNumber,
    edad: rawEdad,
  } = req.body || {};

  if (!email || !password || !nombre) {
    return res
      .status(400)
      .json({ mensaje: 'Faltan datos requeridos (email, password, nombre).' });
  }

  const edad = normalizeAge(rawEdad ?? req.body?.age);
  if (edad === null) {
    return res
      .status(400)
      .json({ mensaje: 'Ingresa una edad valida.' });
  }

  const normalizedPhone = normalizePhoneInput(rawPhoneNumber || '');
  if (!normalizedPhone) {
    return res.status(400).json({ mensaje: 'Numero de telefono invalido.' });
  }

  try {
    const normalizedNombre = nombre.trim();
    const nombreLower = normalizedNombre.toLowerCase();

    const [nameLowerDup, nameExactDup, phoneInUse] = await Promise.all([
      findDocuments(COLLECTIONS.USUARIOS, [['nombreLower', '==', nombreLower]]),
      findDocuments(COLLECTIONS.USUARIOS, [['nombre', '==', normalizedNombre]]),
      hasPhoneConflict(normalizedPhone),
    ]);

    if ((nameLowerDup || []).length > 0 || (nameExactDup || []).length > 0) {
      return res
        .status(409)
        .json({ mensaje: 'El nombre de usuario ya esta en uso. Elige otro.' });
    }

    if (phoneInUse) {
      return res
        .status(409)
        .json({ mensaje: 'Ese numero de telefono ya esta asociado a otra cuenta.' });
    }

    const userRecord = await auth.createUser({
      email,
      password,
      displayName: nombre,
    });

    const uid = userRecord.uid;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    const profileData = {
      email,
      nombre: normalizedNombre,
      nombreLower,
      esCapitan,
      nombreOriginal: nombre,
      phoneVerified: false,
      phoneNumber: null,
      pendingPhoneNumber: normalizedPhone,
      edad,
      age: edad,
      teams: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    if (esCapitan) {
      profileData.equipoCapitaneadoId = null;
    }

    await Promise.all([
      setDocument(COLLECTIONS.USUARIOS, uid, profileData),
      db.collection(COLLECTIONS.USERS).doc(uid).set(profileData, { merge: true }),
    ]);

    return res.status(201).json({
      uid,
      email,
      nombre,
      esCapitan,
      edad,
      mensaje: 'Usuario registrado exitosamente. Ahora inicie sesion.',
    });
  } catch (error) {
    console.error('Error en el registro:', error.message);
    if (error?.code === 'auth/email-already-exists') {
      return res
        .status(409)
        .json({ mensaje: 'Ya existe una cuenta registrada con ese correo electronico.' });
    }
    return res.status(500).json({
      mensaje: 'Error al registrar el usuario.',
      error: error.message,
    });
  }
};

/**
 * Returns the profile for the authenticated user.
 */
const getProfile = async (req, res) => {
  const { uid } = req.user;

  try {
    const userProfile = await getDocument(COLLECTIONS.USUARIOS, uid);

    if (!userProfile) {
      return res.status(404).json({ mensaje: 'Perfil de usuario no encontrado.' });
    }

    delete userProfile.nombreOriginal;

    return res.status(200).json(userProfile);
  } catch (error) {
    console.error('Error al obtener el perfil:', error.message);
    return res.status(500).json({ mensaje: 'Error al obtener el perfil.', error: error.message });
  }
};

/**
 * Creates a secure Firebase session cookie (__session) from an ID token.
 */
const sessionLogin = async (req, res) => {
  const { idToken, expiresInDays = 5 } = req.body || {};
  if (!idToken) {
    return res.status(400).json({ mensaje: 'Falta idToken.' });
  }

  try {
    const expiresIn = Math.min(Math.max(1, Number(expiresInDays)), 14) * 24 * 60 * 60 * 1000;
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });

    res.cookie('__session', sessionCookie, {
      maxAge: expiresIn,
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });

    return res.status(200).json({ mensaje: 'Sesion creada.' });
  } catch (error) {
    console.error('Error en sessionLogin:', error.message);
    return res.status(401).json({ mensaje: 'No se pudo crear la sesion.', error: error.message });
  }
};

/**
 * Clears the Firebase session cookie.
 */
const sessionLogout = async (req, res) => {
  try {
    res.clearCookie('__session', { path: '/', sameSite: 'none', secure: true });
    return res.status(200).json({ mensaje: 'Sesion cerrada.' });
  } catch (error) {
    return res.status(500).json({ mensaje: 'Error al cerrar sesion.', error: error.message });
  }
};

/**
 * Vincula un numero de telefono verificado al perfil del usuario.
 * Enforce uniqueness across usuarios collection.
 */
const linkPhoneNumber = async (req, res) => {
  const { uid } = req.user || {};
  const rawPhone = req.body?.phoneNumber;
  const normalizedPhone = normalizePhoneInput(rawPhone);

  if (!uid) {
    return res.status(401).json({ mensaje: 'No autorizado.' });
  }
  if (!normalizedPhone) {
    return res.status(400).json({ mensaje: 'Numero de telefono invalido.' });
  }

  try {
    const authUser = await auth.getUser(uid);
    const verifiedAuthPhone = normalizePhoneInput(authUser.phoneNumber || '');
    if (!verifiedAuthPhone || verifiedAuthPhone !== normalizedPhone) {
      return res.status(400).json({
        mensaje: 'El telefono indicado no esta verificado en Firebase Auth para esta cuenta.',
      });
    }

    const conflict = await hasPhoneConflict(normalizedPhone, uid);
    if (conflict) {
      return res.status(409).json({ mensaje: 'El numero de telefono ya esta vinculado a otra cuenta.' });
    }

    await syncUserPhoneData(uid, {
      phoneNumber: normalizedPhone,
      phoneVerified: true,
      pendingPhoneNumber: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ mensaje: 'Telefono actualizado.' });
  } catch (error) {
    console.error('Error al vincular telefono:', error);
    return res.status(500).json({ mensaje: 'No se pudo actualizar el telefono.', error: error.message });
  }
};

const startPhoneVerification = async (req, res) => {
  const { uid } = req.user || {};
  const rawPhone = req.body?.phoneNumber;
  const normalizedPhone = normalizePhoneInput(rawPhone);

  if (!uid) {
    return res.status(401).json({ mensaje: 'No autorizado.' });
  }
  if (!normalizedPhone) {
    return res.status(400).json({ mensaje: 'Numero de telefono invalido.' });
  }

  try {
    const conflict = await hasPhoneConflict(normalizedPhone, uid);
    if (conflict) {
      return res.status(409).json({
        mensaje: 'Ese numero ya esta asociado a otra cuenta.',
      });
    }

    await syncUserPhoneData(uid, {
      pendingPhoneNumber: normalizedPhone,
      phoneVerified: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ mensaje: 'Telefono pendiente actualizado.' });
  } catch (error) {
    console.error('Error al preparar verificacion de telefono:', error);
    return res.status(500).json({
      mensaje: 'No se pudo preparar la verificacion del telefono.',
      error: error.message,
    });
  }
};

const checkPhoneAvailabilityPublic = async (req, res) => {
  const rawPhone = req.body?.phoneNumber;
  const excludeUid = typeof req.body?.excludeUid === 'string' ? req.body.excludeUid.trim() : null;
  const normalizedPhone = normalizePhoneInput(rawPhone);

  if (!normalizedPhone) {
    return res.status(400).json({ mensaje: 'Numero de telefono invalido.' });
  }

  try {
    const conflict = await hasPhoneConflict(normalizedPhone, excludeUid);
    if (conflict) {
      return res.status(409).json({
        disponible: false,
        available: false,
        mensaje: 'Ese numero ya esta asociado a otra cuenta.',
      });
    }

    return res.status(200).json({ disponible: true, available: true });
  } catch (error) {
    console.error('Error al verificar disponibilidad de telefono:', error);
    return res.status(500).json({
      mensaje: 'No se pudo validar el numero de telefono.',
      error: error.message,
    });
  }
};

const validateProfileFields = async (req, res) => {
  const currentUid = req.user?.uid;
  if (!currentUid) {
    return res.status(401).json({ mensaje: 'No autorizado.' });
  }

  const sanitize = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim();
  };

  const nombre = sanitize(req.body?.nombre || '');
  const phoneNumber = normalizePhoneInput(req.body?.phoneNumber || '');
  const email = sanitize(req.body?.email || '');
  const nombreLower = nombre ? nombre.toLowerCase() : '';

  if (!nombre && !phoneNumber && !email) {
    return res.status(400).json({ mensaje: 'No se recibieron datos para validar.' });
  }

  const usersCollection = db.collection('users');

  const checkUnique = async (field, value, message) => {
    if (!value) return null;
    const snapshot = await usersCollection.where(field, '==', value).limit(1).get();
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      if (doc.id !== currentUid) {
        const error = new Error(message);
        error.status = 409;
        error.field = field;
        throw error;
      }
    }
    return null;
  };

  try {
    const validations = [];
    if (nombreLower) validations.push(checkUnique('nombreLower', nombreLower, 'Ese nombre ya esta en uso.'));
    if (nombre) validations.push(checkUnique('nombre', nombre, 'Ese nombre ya esta en uso.'));
    if (phoneNumber) validations.push(checkUnique('phoneNumber', phoneNumber, 'Ese numero de telefono ya esta verificado por otro jugador.'));
    if (email) validations.push(checkUnique('email', email, 'Ya existe un perfil con ese correo electronico.'));

    if (!validations.length) {
      return res.status(400).json({ mensaje: 'No se recibieron datos para validar.' });
    }

    await Promise.all(validations);
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (error.status === 409) {
      return res.status(409).json({ mensaje: error.message, campo: error.field });
    }
    console.error('Error al validar perfil:', error);
    return res.status(500).json({ mensaje: 'No se pudo validar el perfil.', error: error.message });
  }
};

const savePushToken = async (req, res) => {
  const uid = req.user?.uid;
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!uid) return res.status(401).json({ mensaje: 'No autorizado.' });
  if (!token) return res.status(400).json({ mensaje: 'Token de notificacion invalido.' });
  try {
    await Promise.all([
      db.collection(COLLECTIONS.USERS).doc(uid).set({
        pushTokens: admin.firestore.FieldValue.arrayUnion(token),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }),
      setDocument(COLLECTIONS.USUARIOS, uid, {
        pushTokens: admin.firestore.FieldValue.arrayUnion(token),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }),
    ]);
    return res.status(200).json({ mensaje: 'Token registrado.' });
  } catch (error) {
    console.error('No se pudo guardar el token push:', error);
    return res.status(500).json({ mensaje: 'No se pudo guardar el token.', error: error.message });
  }
};

module.exports = {
  registerUser,
  getProfile,
  sessionLogin,
  sessionLogout,
  linkPhoneNumber,
  validateProfileFields,
  checkPhoneAvailabilityPublic,
  startPhoneVerification,
  savePushToken,
};
