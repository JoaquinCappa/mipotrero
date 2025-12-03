const { db } = require('../config/firebase');

const COLLECTIONS = {
    USUARIOS: 'usuarios',
    EQUIPOS: 'equipos',
    INVITACIONES: 'invitaciones',
    PARTIDOS: 'partidos',
    USERS: 'users',
};

/**
 * Obtiene un documento de una colección por su ID.
 */
const getDocument = async (collection, id) => {
    const docRef = db.collection(collection).doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
        return null;
    }
    return { id: doc.id, ...doc.data() };
};

/**
 * Crea o actualiza un documento.
 */
const setDocument = async (collection, id, data) => {
    await db.collection(collection).doc(id).set(data, { merge: true });
    return { id, ...data };
};

/**
 * Busca documentos en una colección.
 * @param {string} collection - Nombre de la colección.
 * @param {Array<Array<any>>} conditions - Arreglo de condiciones: [['campo', 'operador', 'valor']]
 * @returns {Array<object>} Lista de documentos.
 */
const findDocuments = async (collection, conditions = []) => {
    let query = db.collection(collection);

    conditions.forEach(([field, operator, value]) => {
        query = query.where(field, operator, value);
    });

    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

/**
 * Añade un nuevo documento a una colección.
 */
const addDocument = async (collection, data) => {
    const docRef = await db.collection(collection).add(data);
    return { id: docRef.id, ...data };
};

module.exports = { COLLECTIONS, getDocument, setDocument, findDocuments, addDocument };
