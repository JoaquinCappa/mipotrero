const { db, admin } = require('../config/firebase');
const messaging = admin.messaging();

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

const resolveDisplayName = (userData, fallback = 'Jugador') =>
  userData?.nombre || userData?.displayName || userData?.email || fallback;

const sanitizeHexColor = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const shortMatch = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (shortMatch) {
    const [, digits] = shortMatch;
    return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`.toLowerCase();
  }
  return /^#([0-9a-f]{6})$/i.test(trimmed) ? trimmed : null;
};

const sanitizeUrl = (value) => {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    return ['https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
};

const trimAndLimit = (value, maxLength = 500) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
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

const createTeam = async (req, res) => {
  const uid = req.user.uid;
  const rawName = req.body?.teamName ?? req.body?.nombre ?? '';
  const teamName = String(rawName || '').trim();
  const description = trimAndLimit(
    req.body?.description ?? req.body?.descripcion ?? '',
    400
  );
  const jerseyColor = sanitizeHexColor(
    req.body?.jerseyColor ?? req.body?.colorHex ?? ''
  );
  const jerseyColorText = trimAndLimit(
    req.body?.jerseyColorText ?? req.body?.colorDescripcion ?? '',
    80
  );
  const shieldCandidate =
    req.body?.shieldUrl ?? req.body?.escudoUrl ?? req.body?.logoUrl ?? '';
  const shieldUrl = sanitizeUrl(shieldCandidate);

  if (!teamName) {
    return res.status(400).json({ mensaje: 'El nombre del equipo es obligatorio.' });
  }
  if (!description) {
    return res
      .status(400)
      .json({ mensaje: 'Debes ingresar una descripcion breve del equipo.' });
  }
  if (!jerseyColor || !jerseyColorText) {
    return res
      .status(400)
      .json({ mensaje: 'Indica el color de remera que usa tu equipo.' });
  }

  const teamRef = db.collection('teams').doc();
  const userRef = db.collection('users').doc(uid);
  const nameLower = teamName.toLowerCase();

  try {
    const existingByName = await db
      .collection('teams')
      .where('nameLower', '==', nameLower)
      .limit(1)
      .get();

    if (!existingByName.empty) {
      throw new HttpError(409, 'El nombre del equipo ya estÃƒÂ¡ en uso.');
    }

    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new HttpError(404, 'Perfil de usuario no encontrado.');
      }

      const userData = userDoc.data();
      const currentUserName = resolveDisplayName(userData, 'CapitÃƒÂ¡n');

      transaction.set(teamRef, {
        name: teamName,
        nameLower,
        ownerId: uid,
        members: [uid],
        memberNames: [currentUserName],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        description,
        jerseyColor,
        jerseyColorText,
        shieldUrl: shieldUrl || null,
      });

      transaction.update(userRef, {
        teams: admin.firestore.FieldValue.arrayUnion(teamRef.id)
      });
    });

    return res.status(201).json({
      teamId: teamRef.id,
      mensaje: `Equipo "${teamName}" creado exitosamente.`
    });
  } catch (error) {
    return sendError(res, error, 'Error al crear el equipo.');
  }
};

const listTeams = async (req, res) => {
  const rawLimit = Number(req.query?.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.max(rawLimit, 1), 100)
      : 50;

  try {
    const snapshot = await db
      .collection('teams')
      .orderBy('nameLower')
      .limit(limit)
      .get();

    const equipos = snapshot.docs.map((doc) => {
      const data = doc.data() || {};
      const memberNames = Array.isArray(data.memberNames)
        ? data.memberNames.filter(Boolean)
        : [];
      return {
        id: doc.id,
        name: data.name,
        description: data.description || '',
        jerseyColor: data.jerseyColor || null,
        jerseyColorText: data.jerseyColorText || '',
        shieldUrl: data.shieldUrl || null,
        membersCount: Array.isArray(data.members) ? data.members.length : 0,
        memberNames,
        ownerId: data.ownerId || null,
        ownerName: memberNames.length ? memberNames[0] : null,
        createdAt: data.createdAt || null,
      };
    });

    return res.status(200).json({ equipos });
  } catch (error) {
    console.error('Error al listar equipos:', error);
    return res
      .status(500)
      .json({ mensaje: 'Error al obtener los equipos.', error: error.message });
  }
};

const searchPlayers = async (req, res) => {
  const queryText = String(req.query?.query || '').trim();

  if (queryText.length < 2) {
    return res.status(400).json({ mensaje: 'La bÃƒÂºsqueda debe tener al menos 2 caracteres.' });
  }

  try {
    const snapshot = await db
      .collection('users')
      .orderBy('nombre')
      .startAt(queryText)
      .endAt(`${queryText}\uf8ff`)
      .limit(20)
      .get();

    const players = snapshot.docs
      .filter((doc) => doc.id !== req.user.uid)
      .map((doc) => {
        const data = doc.data();
        return {
          uid: doc.id,
          nombre: resolveDisplayName(data, 'Usuario'),
          email: data.email,
        };
      });

    return res.status(200).json(players);
  } catch (error) {
    return sendError(res, error, 'Error al buscar jugadores.');
  }
};

const invitePlayer = async (req, res) => {
  const uid = req.user.uid;
  const teamId = String(req.body?.teamId || '').trim();
  const invitadoUid = String(req.body?.invitadoUid || '').trim();
  const playerEmail = String(req.body?.playerEmail || '').trim();

  if (!teamId || (!invitadoUid && !playerEmail)) {
    return res.status(400).json({
      mensaje: 'teamId y el UID o email del jugador son requeridos.',
    });
  }

  if (invitadoUid === uid) {
    return res.status(400).json({ mensaje: 'No puedes invitarte a ti mismo.' });
  }

  try {
    const [teamDoc, inviterDoc] = await Promise.all([
      db.collection('teams').doc(teamId).get(),
      db.collection('users').doc(uid).get(),
    ]);

    if (!inviterDoc.exists) {
      throw new HttpError(404, 'Perfil del invitador no encontrado.');
    }

    if (!teamDoc.exists) {
      throw new HttpError(404, 'Equipo no encontrado.');
    }

    let invitedUserDoc;
    if (invitadoUid) {
      invitedUserDoc = await db.collection('users').doc(invitadoUid).get();
    } else {
      const invitedUsers = await db
        .collection('users')
        .where('email', '==', playerEmail)
        .limit(1)
        .get();
      invitedUserDoc = invitedUsers.empty ? null : invitedUsers.docs[0];
    }

    if (!invitedUserDoc || !invitedUserDoc.exists) {
      throw new HttpError(404, 'Jugador invitado no encontrado.');
    }

    const inviterData = inviterDoc.data();
    const teamData = teamDoc.data();
    const invitedUserId = invitedUserDoc.id;
    const invitedUserData = invitedUserDoc.data();

    if (teamData.ownerId !== uid) {
      throw new HttpError(403, 'Solo el dueÃƒÂ±o del equipo puede invitar.');
    }

    if (Array.isArray(teamData.members) && teamData.members.includes(invitedUserId)) {
      throw new HttpError(400, `${resolveDisplayName(invitedUserData)} ya es miembro del equipo.`);
    }

    const inviteId = `${teamId}_${invitedUserId}`;
    const inviteRef = db.collection('invitations').doc(inviteId);
    const existingInvite = await inviteRef.get();
    if (existingInvite.exists && existingInvite.data()?.status === 'pending') {
      throw new HttpError(409, 'Ya existe una invitaciÃƒÂ³n pendiente para este jugador.');
    }

    await inviteRef.set({
      teamId,
      teamName: teamData.name,
      toUserId: invitedUserId,
      fromUserId: uid,
      invitedEmail: invitedUserData.email,
      inviterName: resolveDisplayName(inviterData, 'CapitÃƒÂ¡n'),
      status: 'pending',
      type: 'team',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({
      mensaje: `InvitaciÃƒÂ³n enviada a ${resolveDisplayName(invitedUserData)}.`
    });
  } catch (error) {
    return sendError(res, error, 'Error al enviar la invitaciÃƒÂ³n.');
  }
};

const requestToJoinTeam = async (req, res) => {
  const uid = req.user.uid;
  const teamId = String(req.body?.teamId || '').trim();
  const message = trimAndLimit(req.body?.message ?? '', 300);

  if (!teamId) {
    return res
      .status(400)
      .json({ mensaje: 'El identificador del equipo es obligatorio.' });
  }

  const teamRef = db.collection('teams').doc(teamId);
  const userRef = db.collection('users').doc(uid);
  const requestRef = db.collection('teamJoinRequests').doc(`${teamId}_${uid}`);
  let notification = null;

  try {
    await db.runTransaction(async (transaction) => {
      const teamDoc = await transaction.get(teamRef);
      if (!teamDoc.exists) {
        throw new HttpError(404, 'Equipo no encontrado.');
      }

      const teamData = teamDoc.data();
      if (Array.isArray(teamData.members) && teamData.members.includes(uid)) {
        throw new HttpError(409, 'Ya formas parte de este equipo.');
      }

      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new HttpError(404, 'Perfil de usuario no encontrado.');
      }

      const userData = userDoc.data();
      const displayName = resolveDisplayName(userData);

      const existingSnap = await transaction.get(requestRef);
      if (existingSnap.exists && existingSnap.data()?.status === 'pending') {
        throw new HttpError(409, 'Ya tienes una solicitud pendiente.');
      }

      const existingData = existingSnap.exists ? existingSnap.data() : {};
      const createdAtValue =
        existingSnap.exists && existingData?.createdAt
          ? existingData.createdAt
          : admin.firestore.FieldValue.serverTimestamp();

      transaction.set(
        requestRef,
        {
          teamId,
          teamName: teamData.name,
          teamOwnerId: teamData.ownerId || null,
          userId: uid,
          userName: displayName,
          message,
          status: 'pending',
          jerseyColor: teamData.jerseyColor || null,
          createdAt: createdAtValue,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      notification = {
        ownerId: teamData.ownerId,
        teamName: teamData.name,
        displayName,
      };
    });

    try {
      await sendPushToUser(notification?.ownerId, {
        title: `Nueva solicitud para ${notification?.teamName || 'tu equipo'}`,
        body: `${notification?.displayName || 'Un jugador'} quiere unirse a tu equipo.`,
        data: { type: 'teamJoinRequest', teamId }
      });
    } catch (err) {
      console.warn('No se pudo notificar al capitán:', err?.message);
    }

    return res
      .status(200)
      .json({ mensaje: 'Solicitud enviada. El capitán recibirá tu pedido.' });
  } catch (error) {
    return sendError(res, error, 'No se pudo enviar la solicitud de uniÃƒÂ³n.');
  }
};

const respondJoinRequest = async (req, res) => {
  const uid = req.user.uid;
  const requestId = String(req.body?.requestId || '').trim();
  const actionRaw = req.body?.action || req.body?.accion || '';
  const action = typeof actionRaw === 'string' ? actionRaw.trim().toLowerCase() : '';

  if (!requestId || !['accepted', 'rejected'].includes(action)) {
    return res
      .status(400)
      .json({ mensaje: 'requestId y action (accepted|rejected) son requeridos.' });
  }

  const requestRef = db.collection('teamJoinRequests').doc(requestId);
  let resolvedRequest = null;

  try {
    await db.runTransaction(async (transaction) => {
      const requestDoc = await transaction.get(requestRef);
      if (!requestDoc.exists) {
        throw new HttpError(404, 'Solicitud no encontrada.');
      }

      const requestData = requestDoc.data();
      resolvedRequest = requestData;
      if (requestData.teamOwnerId !== uid) {
        throw new HttpError(403, 'No tienes permiso para responder esta solicitud.');
      }
      if (requestData.status !== 'pending') {
        throw new HttpError(400, 'La solicitud ya fue procesada.');
      }

      if (action === 'accepted') {
        const teamRef = db.collection('teams').doc(requestData.teamId);
        const teamDoc = await transaction.get(teamRef);
        if (!teamDoc.exists) {
          throw new HttpError(404, 'Equipo no encontrado.');
        }

        const teamData = teamDoc.data();
        const members = Array.isArray(teamData.members) ? teamData.members : [];
        if (!members.includes(requestData.userId)) {
          transaction.update(teamRef, {
            members: admin.firestore.FieldValue.arrayUnion(requestData.userId),
            memberNames: admin.firestore.FieldValue.arrayUnion(
              requestData.userName || 'Jugador'
            ),
          });
        }

        const userRef = db.collection('users').doc(requestData.userId);
        transaction.set(
          userRef,
          {
            teams: admin.firestore.FieldValue.arrayUnion(requestData.teamId),
          },
          { merge: true }
        );
      }

      transaction.update(requestRef, {
        status: action,
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: uid,
      });
    });

    const mensaje =
      action === 'accepted'
        ? 'Solicitud aceptada. El jugador ya forma parte del equipo.'
        : 'Solicitud rechazada.';
    try {
      await sendPushToUser(resolvedRequest?.userId, {
        title: `Tu solicitud a ${resolvedRequest?.teamName || 'un equipo'} fue ${action === 'accepted' ? 'aceptada' : 'rechazada'}` ,
        body: 'IngresÃƒÂ¡ a Mi Potrero para ver el estado.',
        data: { type: 'teamJoin', teamId: resolvedRequest?.teamId || '' },
      });
    } catch (err) {
      console.warn('No se pudo enviar push de solicitud de equipo:', err?.message);
    }
    return res.status(200).json({ mensaje });
  } catch (error) {
    return sendError(res, error, 'No se pudo procesar la solicitud de uniÃƒÂ³n.');
  }
};

const respondToInvitation = async (req, res) => {
  const uid = req.user.uid;
  const inviteId = String(req.body?.inviteId || '').trim();
  const response = req.body?.response;
  const accept = response === true || response === 'accepted' || response === 'accept';
  const reject = response === false || response === 'rejected' || response === 'reject';

  if (!inviteId || (!accept && !reject)) {
    return res.status(400).json({ mensaje: 'inviteId y respuesta vÃƒÂ¡lida son requeridos.' });
  }

  const inviteRef = db.collection('invitations').doc(inviteId);
  let resolvedInvite = null;

  try {
    await db.runTransaction(async (transaction) => {
      const inviteDoc = await transaction.get(inviteRef);
      if (!inviteDoc.exists) {
        throw new HttpError(404, 'InvitaciÃƒÂ³n no encontrada.');
      }

      const inviteData = inviteDoc.data();
      resolvedInvite = inviteData;
      if (inviteData.toUserId !== uid) {
        throw new HttpError(403, 'No tienes permiso para responder esta invitaciÃƒÂ³n.');
      }
      if (inviteData.status !== 'pending') {
        throw new HttpError(400, 'La invitaciÃƒÂ³n ya fue procesada.');
      }

      const teamRef = db.collection('teams').doc(inviteData.teamId);
      const teamDoc = await transaction.get(teamRef);
      if (!teamDoc.exists) {
        throw new HttpError(404, 'Equipo no encontrado.');
      }

      if (accept) {
        const userRef = db.collection('users').doc(uid);
        const userSnap = await transaction.get(userRef);
        const userData = userSnap.exists ? userSnap.data() : {};
        const displayName = resolveDisplayName(userData);

        transaction.update(teamRef, {
          members: admin.firestore.FieldValue.arrayUnion(uid),
          memberNames: admin.firestore.FieldValue.arrayUnion(displayName)
        });

        transaction.set(userRef, {
          teams: admin.firestore.FieldValue.arrayUnion(inviteData.teamId)
        }, { merge: true });

        transaction.update(inviteRef, {
          status: 'accepted',
          resolvedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        transaction.update(inviteRef, {
          status: 'rejected',
          resolvedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    });

    const mensaje = accept
      ? '?Invitaci?n aceptada! Ya eres miembro del equipo.'
      : 'Invitaci?n rechazada.';
    try {
      await sendPushToUser(resolvedInvite?.toUserId, {
        title: `Invitaci?n a ${resolvedInvite?.teamName || 'un equipo'} ${accept ? 'aceptada' : 'rechazada'}` ,
        body: accept ? 'Ya formas parte del equipo.' : 'La invitaci?n fue rechazada.',
        data: { type: 'teamInvite', teamId: resolvedInvite?.teamId || '' },
      });
    } catch (err) {
      console.warn('No se pudo enviar push de invitaci?n:', err?.message);
    }
    return res.status(200).json({ mensaje });
  } catch (error) {
    return sendError(res, error, 'Error al responder la invitaciÃƒÂ³n.');
  }
};

const getPendingInvites = async (req, res) => {
  const uid = req.user.uid;

  try {
    const snapshot = await db.collection('invitations')
      .where('toUserId', '==', uid)
      .where('status', '==', 'pending')
      .get();

    const invites = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json(invites);
  } catch (error) {
    return sendError(res, error, 'Error al obtener invitaciones pendientes.');
  }
};

module.exports = {
  listTeams,
  createTeam,
  searchPlayers,
  invitePlayer,
  respondToInvitation,
  getPendingInvites,
  requestToJoinTeam,
  respondJoinRequest,
};
