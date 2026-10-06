const fs = require('fs');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');

async function main() {
  const rules = fs.readFileSync('./storage.rules', 'utf8');

  const testEnv = await initializeTestEnvironment({
    projectId: 'mi-potrero-82',
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules,
    },
  });

  try {
    const alice = testEnv.authenticatedContext('alice');
    const bob = testEnv.authenticatedContext('bob');

    const aliceStorage = alice.storage();
    const bobStorage = bob.storage();

    // Imagen válida: el usuario puede escribir en su propia carpeta.
    const validImage = new Uint8Array([137, 80, 78, 71]);

    await assertSucceeds(
      aliceStorage
        .ref('users/alice/profilePhotos/profile.png')
        .put(validImage, { contentType: 'image/png' })
    );

    // Usuario NO puede escribir en la carpeta de otro usuario.
    await assertFails(
      aliceStorage
        .ref('users/bob/profilePhotos/profile.png')
        .put(validImage, { contentType: 'image/png' })
    );

    // Lo mismo para escudos de equipos.
    await assertSucceeds(
      aliceStorage
        .ref('teams/alice/teamShields/shield.png')
        .put(validImage, { contentType: 'image/png' })
    );

    await assertFails(
      bobStorage
        .ref('teams/alice/teamShields/shield.png')
        .put(validImage, { contentType: 'image/png' })
    );

    // Un archivo que no sea imagen debe ser rechazado.
    await assertFails(
      aliceStorage
        .ref('users/alice/profilePhotos/file.txt')
        .put(new Uint8Array([1, 2, 3]), { contentType: 'text/plain' })
    );

    // Archivo mayor a 5 MB debe ser rechazado.
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);

    await assertFails(
      aliceStorage
        .ref('users/alice/profilePhotos/large.png')
        .put(oversized, { contentType: 'image/png' })
    );

    console.log('? Storage Rules: todas las pruebas pasaron.');
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((error) => {
  console.error('? Storage Rules: prueba fallida');
  console.error(error);
  process.exit(1);
});
