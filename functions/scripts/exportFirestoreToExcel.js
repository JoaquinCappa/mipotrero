const { admin } = require('../config/firebase');
const ExcelJS = require('exceljs');
const path = require('path');

const db = admin.firestore();
console.log('🔥 SCRIPT NUEVO CARGADO 🔥');


function styleHeader(row) {
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E7F4F' }, // verde Mi Potrero
    };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
}

async function exportar() {
  console.log('⏳ Exportando Firestore a Excel...');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mi Potrero';
  workbook.created = new Date();

  /* =====================
     🧍 USUARIOS
  ====================== */
  const usersSheet = workbook.addWorksheet('Usuarios');
  usersSheet.columns = [
    { header: 'Nombre', key: 'nombre', width: 25 },
    { header: 'Email', key: 'email', width: 35 },
    { header: 'Fecha de registro', key: 'createdAt', width: 22 },
  ];

  const usersSnap = await db.collection('users').get();
  usersSnap.forEach(doc => {
    const d = doc.data();
    usersSheet.addRow({
      nombre: d.nombre || '',
      email: d.email || '',
      createdAt: d.createdAt?.toDate?.().toLocaleDateString() || '',
    });
  });

  styleHeader(usersSheet.getRow(1));

  /* =====================
     👕 EQUIPOS
  ====================== */
  const teamsSheet = workbook.addWorksheet('Equipos');
teamsSheet.columns = [
  { header: 'Equipo', key: 'name', width: 30 },
  { header: 'Jugadores', key: 'players', width: 18 },
  { header: 'Color camiseta', key: 'color', width: 22 },
  { header: 'Descripción', key: 'description', width: 40 },
  { header: 'Creado', key: 'createdAt', width: 22 },
];

const teamsSnap = await db.collection('teams').get();
console.log('📦 Equipos encontrados:', teamsSnap.size);

teamsSnap.forEach(doc => {
  const d = doc.data();
  teamsSheet.addRow({
    name: d.name || '',
    players: Array.isArray(d.memberNames) ? d.memberNames.length : 0,
    color: d.jerseyColorText || '',
    description: d.description || '',
    createdAt: d.createdAt?.toDate?.().toLocaleDateString() || '',
  });
});

styleHeader(teamsSheet.getRow(1));

  /* =====================
     ⚽ PARTIDOS
  ====================== */
  const matchesSheet = workbook.addWorksheet('Partidos');
  matchesSheet.columns = [
  { header: 'Fecha', key: 'fecha', width: 20 },
  { header: 'Cancha', key: 'cancha', width: 30 },
  { header: 'Modalidad', key: 'modality', width: 15 },
  { header: 'Equipo A', key: 'teamA', width: 25 },
  { header: 'Capitán A', key: 'captainA', width: 25 },
  { header: 'Equipo B', key: 'teamB', width: 25 },
  { header: 'Estado', key: 'status', width: 15 },
  { header: 'Precio total', key: 'price', width: 18 },
  { header: 'Precio por jugador', key: 'perPlayer', width: 22 },
  { header: 'Moneda', key: 'currency', width: 10 },
  ];

const matchesSnap = await db.collection('matches').get();
console.log('📦 Partidos encontrados:', matchesSnap.size);

matchesSnap.forEach(doc => {
  const d = doc.data();

  matchesSheet.addRow({
    fecha: d.dateTime
      ? new Date(d.dateTime).toLocaleString()
      : '',
    cancha: d.location?.name || '',
    modality: d.modality || '',
    teamA: d.teamA?.name || '',
    captainA: d.teamA?.captainName || '',
    teamB: d.teamB?.name || '—',
    status: d.status || '',
    price: d.price ?? '',
    perPlayer: d.perPlayerCost ?? '',
    currency: d.location?.currency || '',
  });
});

styleHeader(matchesSheet.getRow(1));


  /* =====================
     💾 GUARDAR ARCHIVO
  ====================== */
  const filePath = path.join(__dirname, 'MiPotrero_Export.xlsx');
  await workbook.xlsx.writeFile(filePath);

  console.log('✅ Excel generado:', filePath);
}

exportar().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
