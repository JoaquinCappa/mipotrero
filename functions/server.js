const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes/index');

const normalizeOrigin = (value) => {
  if (!value || typeof value !== 'string') return '';
  return value.trim().replace(/\/+$/, '').toLowerCase();
};

const buildAllowedOrigins = () => {
  const fromEnv =
    process.env.SECURITY_ALLOWED_ORIGINS ||
    process.env.ALLOWED_RETURN_ORIGINS ||
    process.env.ALLOWED_ORIGINS ||
    '';

  const defaults = [
    'https://mi-potrero-82.web.app',
    'https://mi-potrero-82.firebaseapp.com',
    'http://localhost:5000',
    'http://localhost:5173',
    'https://mipotrero.com.ar',
    'https://www.mipotrero.com.ar',
  ];

  const entries = fromEnv
    .split(',')
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);

  const allowed = new Set(defaults.map(normalizeOrigin));
  entries.forEach((item) => allowed.add(item));

  return allowed;
};

const allowedOrigins = buildAllowedOrigins();

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    const normalized = normalizeOrigin(origin);
    if (allowedOrigins.has(normalized)) {
      return callback(null, true);
    }
    console.warn(`CORS bloqueado para origen no permitido: ${origin}`);
    return callback(new Error('Origen no permitido por CORS'));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
  maxAge: 3600,
};

const app = express();

app.use(cors(corsOptions));
app.use(express.json());

app.use('/api/v1', apiRoutes);

app.get('/', (_req, res) => {
  res.status(200).send('Bienvenido a la API de Mi Potrero (v1)');
});

module.exports = app;
