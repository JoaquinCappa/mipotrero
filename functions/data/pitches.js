const DEFAULT_PITCH_CURRENCY = 'ARS';

const PITCHES = [
  { id: 'la-cantera', name: 'La Cantera', price: 5500, currency: DEFAULT_PITCH_CURRENCY },
  { id: 'el-cubo', name: 'El Cubo', price: 6500, currency: DEFAULT_PITCH_CURRENCY },
  { id: 'marista-camp', name: 'Marista Camp', price: 5500, currency: DEFAULT_PITCH_CURRENCY },
  { id: 'mendoza-futbol', name: 'Mendoza Futbol', price: 5500, currency: DEFAULT_PITCH_CURRENCY },
];

const pitchMap = new Map(PITCHES.map((pitch) => [pitch.id, pitch]));

const getPitchById = (id) => {
  if (!id) return null;
  return pitchMap.get(id) || null;
};

module.exports = {
  PITCHES,
  getPitchById,
  DEFAULT_PITCH_CURRENCY,
};
