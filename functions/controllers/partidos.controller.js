const { db, admin } = require('../config/firebase');
const messaging = admin.messaging();
const { PITCHES, getPitchById } = require('../data/pitches');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sendError = (res, error, fallbackMessage) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ mensaje: error.message });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ mensaje: fallbackMessage, error: error.message });
};

const resolveDisplayName = (userData, fallback = 'Capitan') =>
  userData?.nombre || userData?.displayName || userData?.email || fallback;

const requiredPlayersByModality = {
  'Futbol 5': 5,
  'Futbol 7': 0,
};

const PER_PLAYER_COST = 5500;

const sanitizeLocation = (incoming) => {
  if (!incoming) return null;
  const id = typeof incoming.id === 'string' ? incoming.id.trim() : '';
  if (!id) {
    return null;
  }
  const pitch = getPitchById(id);
  if (!pitch) {
    return null;
  }
  return {
    id: pitch.id,
    name: pitch.name,
    price: pitch.price,
    currency: pitch.currency,
  };
};

const ensureTeamHasRequiredPlayers = (teamData, modality, contextMessage) => {
  const required = requiredPlayersByModality[modality] || null;
  if (
    required &&
    (!Array.isArray(teamData.members) || teamData.members.length < required)
  ) {
    throw new HttpError(
      400,
      `${contextMessage}. Se requieren al menos ${required} jugadores registrados para ${modality}.`
    );
  }
};

const fetchUserTokens = async (uid) => {
  if (!uid) return [];
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return [];
  const tokens = snap.data()?.pushTokens;
  return Array.isArray(tokens) ? tokens.filter(Boolean) : [];
};

const sendPushToUser = async (uid, payload) => {
  try {
    const tokens = await fetchUserTokens(uid);
    if (!tokens.length) return;
    await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: payload.title || 'Mi Potrero',
        body: payload.body || '',
      },
      data: payload.data || {},
    });
  } catch (error) {
    console.warn('No se pudo enviar push:', error.message);
  }
};

const createMatch = async (req, res) => {
  const uid = req.user.uid;
  const teamId = String(req.body?.teamId || '').trim();
  const dateTime = String(req.body?.dateTime || '').trim();
  const modality = req.body?.tipoFutbol || req.body?.modality;
  const rawLocation = req.body?.location;

  if (!teamId || !dateTime || !modality) {
    return res
      .status(400)
      .json({ mensaje: 'teamId, dateTime y tipoFutbol son requeridos.' });
  }

  try {
    const teamRef = db.collection('teams').doc(teamId);
    const [teamDoc, userDoc] = await Promise.all([
      teamRef.get(),
      db.collection('users').doc(uid).get(),
    ]);

    if (!teamDoc.exists) {
      throw new HttpError(404, 'Equipo no encontrado.');
    }

    const teamData = teamDoc.data();
    if (!Array.isArray(teamData.members) || !teamData.members.includes(uid)) {
      throw new HttpError(
        403,
        'Debes ser miembro del equipo para crear el partido.'
      );
    }

    ensureTeamHasRequiredPlayers(
      teamData,
      modality,
      'El equipo no cumple con la cantidad minima'
    );

    const location = sanitizeLocation(rawLocation);
    if (modality === 'Futbol 7' && !location) {
      throw new HttpError(
        400,
        'Debes seleccionar una cancha valida para Futbol 7.'
      );
    }

    const creatorName = resolveDisplayName(userDoc.data(), 'Capitan');

    await db.collection('matches').add({
      dateTime,
      modality,
      location: location || null,
      status: 'open',
      perPlayerCost: PER_PLAYER_COST,
      individualPlayers: [],
      teamA: {
        id: teamId,
        name: teamData.name,
        captainId: teamData.ownerId,
        captainName: creatorName,
      },
      teamB: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res
      .status(201)
      .json({ mensaje: `Partido de ${modality} creado exitosamente.` });
  } catch (error) {
    return sendError(res, error, 'Error al crear el partido.');
  }
};

const getMatches = async (_req, res) => {
  try {
    const snapshot = await db
      .collection('matches')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const matches = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json(matches);
  } catch (error) {
    return sendError(res, error, 'Error al obtener partidos.');
  }
};

const joinMatch = async (req, res) => {
  const uid = req.user.uid;
  const matchId = String(req.body?.matchId || '').trim();
  const teamId = String(req.body?.teamId || req.body?.teamIdentifier || '').trim();

  if (!matchId || !teamId) {
    return res
      .status(400)
      .json({ mensaje: 'matchId y teamId son requeridos.' });
  }

  const matchRef = db.collection('matches').doc(matchId);
  const teamRef = db.collection('teams').doc(teamId);
  const userRef = db.collection('users').doc(uid);

  try {
    await db.runTransaction(async (transaction) => {
      const [matchDoc, teamDoc, userDoc] = await Promise.all([
        transaction.get(matchRef),
        transaction.get(teamRef),
        transaction.get(userRef),
      ]);

      if (!matchDoc.exists) {
        throw new HttpError(404, 'Partido no encontrado.');
      }

      if (!teamDoc.exists) {
        throw new HttpError(404, 'Equipo no encontrado.');
      }

      const matchData = matchDoc.data();
      const teamData = teamDoc.data();

      if (matchData.status !== 'open') {
        throw new HttpError(400, 'El partido ya no esta disponible.');
      }

      if (matchData.teamB) {
        throw new HttpError(409, 'El partido ya tiene un equipo B.');
      }

      if (matchData.teamA?.id === teamId) {
        throw new HttpError(400, 'No puedes unirte con el mismo equipo.');
      }

      if (!Array.isArray(teamData.members) || !teamData.members.includes(uid)) {
        throw new HttpError(
          403,
          'Debes ser miembro del equipo para unirte.'
        );
      }

      ensureTeamHasRequiredPlayers(
        teamData,
        matchData.modality,
        'El equipo no cumple con la cantidad minima'
      );

      const userData = userDoc.exists ? userDoc.data() : {};

      transaction.update(matchRef, {
        teamB: {
          id: teamId,
          name: teamData.name,
          captainId: teamData.ownerId,
          captainName: resolveDisplayName(userData, 'Jugador'),
        },
        status: 'open',
      });
    });

    return res
      .status(200)
      .json({ mensaje: 'Te has unido al partido exitosamente.' });
  } catch (error) {
    return sendError(res, error, 'Error al unirte al partido.');
  }
};

const requestIndividualJoin = async (req, res) => {
  const uid = req.user.uid;
  const matchId = String(req.body?.matchId || '').trim();
  const note =
    typeof req.body?.mensaje === 'string'
      ? req.body.mensaje.trim()
      : typeof req.body?.nota === 'string'
      ? req.body.nota.trim()
      : '';
  const ageRaw = req.body?.edad ?? req.body?.age;

  if (!matchId) {
    return res.status(400).json({ mensaje: 'matchId es requerido.' });
  }

  try {
    const matchRef = db.collection('matches').doc(matchId);
    const [matchDoc, userDoc] = await Promise.all([
      matchRef.get(),
      db.collection('users').doc(uid).get(),
    ]);

    if (!matchDoc.exists) {
      throw new HttpError(404, 'Partido no encontrado.');
    }

    const matchData = matchDoc.data();
    if (matchData.status !== 'open') {
      throw new HttpError(400, 'El partido ya no esta disponible.');
    }

    if (matchData.teamA?.captainId === uid) {
      throw new HttpError(
        400,
        'No puedes solicitar como jugador individual a tu propio partido.'
      );
    }

    if (!userDoc.exists) {
      throw new HttpError(404, 'Perfil de usuario no encontrado.');
    }
    const userData = userDoc.data();
    const requesterAge =
      typeof userData?.edad === 'number'
        ? userData.edad
        : typeof userData?.age === 'number'
        ? userData.age
        : typeof ageRaw === 'number'
        ? ageRaw
        : null;

    const existingRequestSnap = await db
      .collection('individualRequests')
      .where('matchId', '==', matchId)
      .where('requesterId', '==', uid)
      .limit(1)
      .get();

    if (!existingRequestSnap.empty) {
      const currentStatus = existingRequestSnap.docs[0].data()?.status || 'pending';
      if (currentStatus === 'pending' || currentStatus === 'accepted') {
        throw new HttpError(
          400,
          'Ya enviaste una solicitud para este partido. Espera la respuesta del capitan.'
        );
      }
    }

    const requesterName = resolveDisplayName(userData, 'Jugador');
    const requestPayload = {
      matchId,
      requesterId: uid,
      requesterName,
      requesterAge,
      status: 'pending',
      message: note,
      modality: matchData.modality,
      perPlayerCost: PER_PLAYER_COST,
      matchDateTime: matchData.dateTime || null,
      locationName: matchData.location?.name || null,
      teamAName: matchData.teamA?.name || null,
      captainId: matchData.teamA?.captainId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('individualRequests').add(requestPayload);

    if (matchData.teamA?.captainId) {
      await sendPushToUser(matchData.teamA.captainId, {
        title: 'Nuevo pedido para tu partido',
        body: `${requesterName} quiere sumarse a ${matchData.teamA?.name || 'tu equipo'}`,
        data: { type: 'individualRequest', matchId },
      });
    }

    return res
      .status(201)
      .json({ mensaje: 'Solicitud enviada al capitan. Recibiras una respuesta pronto.' });
  } catch (error) {
    return sendError(
      res,
      error,
      'No se pudo registrar tu solicitud individual.'
    );
  }
};

const respondIndividualJoin = async (req, res) => {
  const uid = req.user.uid;
  const requestId = String(req.body?.requestId || '').trim();
  const actionRaw = req.body?.action || req.body?.accion || '';
  const action = typeof actionRaw === 'string' ? actionRaw.trim().toLowerCase() : '';

  if (!requestId || !['accepted', 'rejected'].includes(action)) {
    return res
      .status(400)
      .json({ mensaje: 'requestId y action (accepted|rejected) son requeridos.' });
  }

  const requestRef = db.collection('individualRequests').doc(requestId);
  const matchRefPromise = requestRef.get().then((docSnap) => {
    if (!docSnap.exists) {
      throw new HttpError(404, 'Solicitud no encontrada.');
    }
    const requestData = docSnap.data();
    if (requestData.captainId !== uid) {
      throw new HttpError(403, 'No tienes permiso para responder esta solicitud.');
    }
    if (requestData.status !== 'pending') {
      throw new HttpError(400, 'La solicitud ya fue procesada.');
    }
    return requestData;
  });

  try {
    const requestData = await matchRefPromise;
    const matchRef = db.collection('matches').doc(requestData.matchId);

    await db.runTransaction(async (transaction) => {
      const reqDoc = await transaction.get(requestRef);
      if (!reqDoc.exists) {
        throw new HttpError(404, 'Solicitud no encontrada.');
      }
      if (reqDoc.data().status !== 'pending') {
        throw new HttpError(400, 'La solicitud ya fue procesada.');
      }

      const updates = {
        status: action,
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: uid,
      };
      transaction.update(requestRef, updates);

      if (action === 'accepted') {
        const matchDoc = await transaction.get(matchRef);
        if (!matchDoc.exists) {
          throw new HttpError(404, 'Partido no encontrado.');
        }
        const playerRecord = {
          userId: requestData.requesterId,
          name: requestData.requesterName,
          age: typeof requestData.requesterAge === 'number' ? requestData.requesterAge : null,
          joinedAt: admin.firestore.Timestamp.now(),
        };
        transaction.update(matchRef, {
          individualPlayers: admin.firestore.FieldValue.arrayUnion(playerRecord),
        });
      }
    });

    if (requestData.requesterId) {
      await sendPushToUser(requestData.requesterId, {
        title: action === 'accepted' ? 'Fuiste aceptado en el partido' : 'Tu solicitud fue rechazada',
        body: requestData.teamAName ? `Partido de ${requestData.teamAName}` : 'Revisa tus solicitudes',
        data: { type: 'individualRequestResponse', matchId: requestData.matchId || '' },
      });
    }
    return res.status(200).json({
      mensaje:
        action === 'accepted'
          ? 'Jugador aceptado correctamente.'
          : 'Solicitud rechazada.',
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'No se pudo procesar la respuesta a la solicitud.'
    );
  }
};

const listIndividualRequests = async (req, res) => {
  const uid = req.user.uid;
  const matchIdsRaw = typeof req.query?.matchIds === 'string' ? req.query.matchIds : '';
  const requestedMatchIds = matchIdsRaw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  try {
    const snapshot = await db
      .collection('individualRequests')
      .where('captainId', '==', uid)
      .where('status', '==', 'pending')
      .get();

    const requests = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((request) =>
        requestedMatchIds.length ? requestedMatchIds.includes(request.matchId) : true
      );

    return res.status(200).json(requests);
  } catch (error) {
    return sendError(
      res,
      error,
      'No se pudieron obtener las solicitudes individuales pendientes.'
    );
  }
};

const listPitchOptions = (_req, res) => {
  return res.status(200).json({ pitches: PITCHES });
};

module.exports = {
  createMatch,
  getMatches,
  joinMatch,
  requestIndividualJoin,
  respondIndividualJoin,
  listIndividualRequests,
  listPitchOptions,
};
