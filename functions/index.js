/**
 * LÓGICA DE SERVIDOR - FIREBASE CLOUD FUNCTIONS (Node.js)
 * * Este archivo contiene todas las operaciones sensibles que antes estaban en app.js
 * y ahora se ejecutan de manera segura en el backend.
 * * Se asume que este archivo se desplegará en Firebase Functions.
 */
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

// Inicialización de la app de Admin. Las funciones tienen acceso a las credenciales.
admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'us-central1' });

/**
 * Endpoint 1: Crear un nuevo equipo y asignárselo al usuario actual.
 * @param {string} teamName - Nombre del equipo.
 */
exports.createTeam = onCall(async (request) => {
    // 1. Verificar autenticación. CRÍTICO para cualquier función.
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Se requiere autenticación para esta operación.');
    }

    const { teamName } = request.data || {};
    if (!teamName || teamName.trim() === "") {
        throw new HttpsError('invalid-argument', 'El nombre del equipo no puede estar vacío.');
    }

    // Usar una transacción para asegurar que la creación del equipo y la actualización del usuario sean atómicas.
    try {
        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc.exists) {
            throw new HttpsError('not-found', 'Perfil de usuario no encontrado.');
        }
        const currentUserName = userDoc.data().nombre;

        const teamRef = db.collection("teams").doc(); // Generar ID de equipo

        await db.runTransaction(async (transaction) => {
            
            // 1. Crear el documento del equipo
            transaction.set(teamRef, {
                name: teamName.trim(),
                ownerId: uid,
                members: [uid],
                memberNames: [currentUserName],
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // 2. Actualizar el perfil del usuario para incluir el nuevo equipo
            transaction.update(db.collection("users").doc(uid), {
                teams: admin.firestore.FieldValue.arrayUnion(teamRef.id)
            });
        });

        return { teamId: teamRef.id, message: `Equipo "${teamName}" creado exitosamente.` };

    } catch (error) {
        console.error("Error al crear equipo:", error);
        throw new HttpsError('internal', 'Error interno al crear el equipo.', error.message);
    }
});

const app = require('./server');
exports.api = onRequest(app);

/**
 * Endpoint 2: Enviar una invitación a un jugador por email.
 * @param {string} teamId - ID del equipo que invita.
 * @param {string} teamName - Nombre del equipo.
 * @param {string} playerEmail - Email del jugador invitado.
 */
exports.invitePlayer = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Se requiere autenticación.');
    }

    const { teamId, teamName, playerEmail } = request.data || {};
    if (!teamId || !playerEmail) {
        throw new HttpsError('invalid-argument', 'Faltan datos de la invitación.');
    }

    // 1. Buscar el UID del jugador invitado
    const q = db.collection("users").where("email", "==", playerEmail.trim());
    const snapshot = await q.get();

    if (snapshot.empty) {
        throw new HttpsError('not-found', `No se encontró un usuario registrado con el email: ${playerEmail}`);
    }

    const invitedUserDoc = snapshot.docs[0];
    const invitedUserId = invitedUserDoc.id;
    const invitedUserName = invitedUserDoc.data().nombre;
    // Obtener nombre del invitador para mostrar en el frontend
    const inviterDoc = await db.collection("users").doc(uid).get();
    const inviterName = inviterDoc.exists ? inviterDoc.data().nombre : 'Capitán';
    
    // 2. Verificar permisos (que el invitador sea dueño o miembro del equipo, aunque solo verificamos dueño para simplificar)
    const teamDoc = await db.collection("teams").doc(teamId).get();
    if (!teamDoc.exists || teamDoc.data().ownerId !== uid) {
         throw new HttpsError('permission-denied', 'Solo el dueño puede invitar a este equipo.');
    }

    // 3. Verificar si ya es miembro
    if (teamDoc.data().members.includes(invitedUserId)) {
         throw new HttpsError('failed-precondition', `${invitedUserName} ya es miembro de ${teamName}.`);
    }

    // 4. Crear la invitación
    try {
        const inviteId = `${teamId}_${invitedUserId}`;
        await db.collection("invitations").doc(inviteId).set({
            teamId: teamId,
            teamName: teamName,
            toUserId: invitedUserId,
            fromUserId: uid,
            invitedEmail: playerEmail.trim(),
            inviterName: inviterName,
            type: 'team',
            status: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { message: `Invitación a ${invitedUserName} enviada exitosamente.` };
    } catch (error) {
        console.error("Error al enviar invitación:", error);
        throw new HttpsError('internal', 'Error interno al enviar la invitación.', error.message);
    }
});


/**
 * Endpoint 3: Crear un nuevo partido.
 * @param {string} teamId - ID del equipo creador.
 * @param {string} dateTime - Fecha y hora del partido (ISO string).
 * @param {string} tipoFutbol - Tipo de fútbol (Futbol 5, Futbol 7).
 */
exports.createMatch = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Se requiere autenticación.');
    }

    const { teamId, dateTime, tipoFutbol: tipoFutbolRaw, modality } = request.data || {};
    const tipoFutbol = tipoFutbolRaw || modality; // aceptar ambos nombres
    if (!teamId || !dateTime || !tipoFutbol) {
        throw new HttpsError('invalid-argument', 'Faltan datos requeridos para el partido.');
    }

    const teamDoc = await db.collection("teams").doc(teamId).get();
    if (!teamDoc.exists || !teamDoc.data().members.includes(uid)) {
        throw new HttpsError('permission-denied', 'Debes ser miembro de este equipo para crear el partido.');
    }

    const teamData = teamDoc.data();
    const userDoc = await db.collection("users").doc(uid).get();
    const currentUserName = userDoc.exists ? userDoc.data().nombre : 'Capitán';

    try {
        await db.collection("matches").add({
            dateTime: dateTime,
            modality: tipoFutbol,
            location: "Ubicación por confirmar",
            status: 'open',
            teamA: {
                id: teamId,
                name: teamData.name,
                captainId: teamData.ownerId,
                captainName: currentUserName
            },
            teamB: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { message: `Partido de ${tipoFutbol} creado exitosamente.` };
    } catch (error) {
        console.error("Error al crear partido:", error);
        throw new HttpsError('internal', 'Error interno al crear el partido.', error.message);
    }
});

/**
 * Endpoint 4: Unirse a un partido disponible.
 * @param {string} matchId - ID del partido al que unirse.
 */
exports.joinMatch = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Se requiere autenticación.');
    }

    const { matchId, teamIdentifier, teamId } = request.data || {};
    const joinTeamId = teamIdentifier || teamId; // permitir ambos
    if (!matchId || !joinTeamId) {
        throw new HttpsError('invalid-argument', 'Faltan datos: matchId y teamId.');
    }

    try {
        const userDoc = await db.collection("users").doc(uid).get();
        const currentUserName = userDoc.exists ? userDoc.data().nombre : 'Capitán';

        const matchRef = db.collection("matches").doc(matchId);
        const teamRef = db.collection("teams").doc(joinTeamId);

        await db.runTransaction(async (transaction) => {
            const [matchDoc, teamDoc] = await Promise.all([
                transaction.get(matchRef),
                transaction.get(teamRef)
            ]);

            if (!matchDoc.exists || matchDoc.data().status !== 'open') {
                throw new HttpsError('failed-precondition', "El partido ya no está disponible.");
            }

            if (!teamDoc.exists) {
                throw new HttpsError('not-found', 'Equipo no encontrado.');
            }

            const matchData = matchDoc.data();
            const teamData = teamDoc.data();

            // Validaciones de business
            if (matchData.teamB) {
                throw new HttpsError('already-exists', 'El partido ya tiene equipo B.');
            }
            if (matchData.teamA && matchData.teamA.id === teamRef.id) {
                throw new HttpsError('failed-precondition', 'No puedes unirte con el mismo equipo.');
            }
            if (!teamData.members.includes(uid)) {
                throw new HttpsError('permission-denied', 'Debes ser miembro del equipo para unirte.');
            }

            const teamB = {
                id: teamRef.id,
                name: teamData.name,
                captainId: teamData.ownerId,
                captainName: currentUserName
            };

            transaction.update(matchRef, { teamB });
        });

        return { message: "¡Te has unido al partido exitosamente!" };
    } catch (error) {
        console.error("Error al unirse al partido:", error);
        // Si el error es de tipo HttpsError, se propaga directamente al cliente.
        if (error.code) {
            throw error;
        }
        throw new HttpsError('internal', 'Error interno al unirte al partido.', error.message);
    }
});

/**
 * Endpoint 5: Aceptar o rechazar una invitación a un equipo.
 * @param {string} inviteId - ID de la invitación.
 * @param {string} teamId - ID del equipo.
 * @param {boolean} accept - True para aceptar, False para rechazar.
 */
exports.respondToInvitation = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Se requiere autenticación.');
    }

    const data = request.data || {};
    const { inviteId } = data;
    const accept = typeof data.accept === 'boolean' ? data.accept : (data.response === 'accepted');
    if (!inviteId || typeof accept !== 'boolean') {
        throw new HttpsError('invalid-argument', 'Faltan datos de la invitación.');
    }

    const inviteRef = db.collection("invitations").doc(inviteId);
    const userRef = db.collection("users").doc(uid);

    try {
        await db.runTransaction(async (transaction) => {
            const inviteDoc = await transaction.get(inviteRef);

            if (!inviteDoc.exists || inviteDoc.data().toUserId !== uid || inviteDoc.data().status !== 'pending') {
                throw new HttpsError('not-found', "Invitación inválida o ya procesada.");
            }
            
            const teamId = inviteDoc.data().teamId;
            const teamRef = db.collection("teams").doc(teamId);
            const teamDoc = await transaction.get(teamRef);
            if (!teamDoc.exists) {
                throw new HttpsError('not-found', 'Equipo no encontrado para la invitación.');
            }
            const userDoc = await transaction.get(userRef);
            const currentUserName = userDoc.data()?.nombre || 'Jugador';

            if (accept) {
                // 1. Añadir el usuario al equipo
                transaction.update(teamRef, {
                    members: admin.firestore.FieldValue.arrayUnion(uid),
                    memberNames: admin.firestore.FieldValue.arrayUnion(currentUserName)
                });
                // 2. Añadir el equipo al perfil del usuario
                transaction.update(userRef, {
                    teams: admin.firestore.FieldValue.arrayUnion(teamId)
                });
                // 3. Actualizar el estado de la invitación
                transaction.update(inviteRef, { status: 'accepted' });
            } else {
                // 1. Actualizar el estado de la invitación a 'rejected'
                transaction.update(inviteRef, { status: 'rejected' });
            }
        });

        const statusMessage = accept ? "¡Invitación aceptada! Ya eres miembro del equipo." : "Invitación rechazada.";
        return { message: statusMessage };

    } catch (error) {
        console.error("Error en respondToInvitation:", error);
        // Propaga el error si ya es HttpsError
        if (error.code) {
            throw error;
        }
        throw new HttpsError('internal', 'Error interno al procesar la invitación.', error.message);
    }
});

