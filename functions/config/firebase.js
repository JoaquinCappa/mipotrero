const admin = require('firebase-admin');

// Inicialización de Firebase Admin
// Cuando se ejecuta en Firebase Cloud Functions, la variable de entorno
// FIREBASE_CONFIG está disponible y se utiliza automáticamente.
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };