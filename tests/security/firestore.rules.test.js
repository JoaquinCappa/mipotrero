const fs = require('fs');
const assert = require('assert');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');

async function main() {
  const rules = fs.readFileSync('./firestore.rules', 'utf8');

  const testEnv = await initializeTestEnvironment({
    projectId: 'mi-potrero-82',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules,
    },
  });

  try {
    const alice = testEnv.authenticatedContext('alice');
    const bob = testEnv.authenticatedContext('bob');

    const aliceDb = alice.firestore();
    const bobDb = bob.firestore();

    // Usuario puede crear su propio perfil.
    await assertSucceeds(
      aliceDb.collection('users').doc('alice').set({
        nombre: 'Alice',
        email: 'alice@test.com',
      })
    );

    // Usuario NO puede crear el perfil de otro UID.
    await assertFails(
      aliceDb.collection('users').doc('bob').set({
        nombre: 'Bob',
        email: 'bob@test.com',
      })
    );

    // Sembrar un perfil para probar actualizaciones.
    await testEnv
      .withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('users').doc('alice').set({
          nombre: 'Alice',
          posicion: 'Delantero',
          descripcion: 'Jugador',
          edad: 18,
          photoUrl: '',
        });
      });

    // Puede modificar únicamente campos permitidos.
    await assertSucceeds(
      aliceDb.collection('users').doc('alice').update({
        posicion: 'Arquero',
        descripcion: 'Nuevo perfil',
        edad: 19,
        photoUrl: 'https://example.com/a.jpg',
      })
    );

    // No puede modificar un campo protegido como nombre.
    await assertFails(
      aliceDb.collection('users').doc('alice').update({
        nombre: 'Nombre cambiado',
      })
    );

    // No puede modificar el perfil de otro usuario.
    await assertFails(
      bobDb.collection('users').doc('alice').update({
        posicion: 'Defensor',
      })
    );

    // Los clientes NO pueden crear equipos directamente.
    await assertFails(
      aliceDb.collection('teams').doc('team1').set({
        name: 'Equipo de prueba',
        ownerId: 'alice',
      })
    );

    // Los clientes NO pueden escribir partidos directamente.
    await assertFails(
      aliceDb.collection('matches').doc('match1').set({
        modality: 'Fútbol 5',
      })
    );

    console.log('? Firestore Rules: todas las pruebas pasaron.');
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((error) => {
  console.error('? Firestore Rules: prueba fallida');
  console.error(error);
  process.exit(1);
});
