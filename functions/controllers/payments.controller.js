const Stripe = require('stripe');
const { db } = require('../config/firebase');
const { getPitchById, DEFAULT_PITCH_CURRENCY } = require('../data/pitches');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const stripeSecret =
  process.env.STRIPE_SECRET_KEY ||
  process.env.STRIPE_SECRET ||
  '';

let stripe = null;
if (stripeSecret) {
  stripe = new Stripe(stripeSecret);
} else {
  console.warn(
    'Stripe secret key not configured. Set functions config "stripe.secret" or STRIPE_SECRET_KEY env var.'
  );
}

const normalizeOrigin = (value) => {
  if (!value || typeof value !== 'string') return '';
  return value.trim().replace(/\/+$/, '').toLowerCase();
};

const defaultReturnOrigins = [
  'https://mi-potrero-82.web.app',
  'https://mi-potrero-82.firebaseapp.com',
  'http://localhost:5000',
  'http://localhost:5173',
];

const buildReturnOriginSet = () => {
  const fromConfig =
    process.env.SECURITY_ALLOWED_ORIGINS ||
    process.env.ALLOWED_RETURN_ORIGINS ||
    process.env.ALLOWED_ORIGINS ||
    '';

  const allowed = new Set(defaultReturnOrigins.map(normalizeOrigin));
  fromConfig
    .split(',')
    .map((item) => normalizeOrigin(item))
    .filter(Boolean)
    .forEach((item) => allowed.add(item));

  return allowed;
};

const allowedReturnOrigins = buildReturnOriginSet();

const ensureStripe = () => {
  if (!stripe) {
    throw new HttpError(
      500,
      'Procesador de pagos no configurado. Contacta al administrador.'
    );
  }
  return stripe;
};

const assertAllowedReturnUrl = (input, kind) => {
  if (!input || typeof input !== 'string') {
    throw new HttpError(400, `Falta ${kind}Url.`);
  }

  let url;
  try {
    url = new URL(input);
  } catch (_) {
    throw new HttpError(400, `URL de ${kind} invalida.`);
  }

  const origin = normalizeOrigin(`${url.protocol}//${url.host}`);
  const isLocalhost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1';

  if (!allowedReturnOrigins.has(origin)) {
    throw new HttpError(400, `URL de ${kind} no autorizada.`);
  }

  if (!isLocalhost && url.protocol !== 'https:') {
    throw new HttpError(400, `URL de ${kind} debe usar HTTPS.`);
  }

  return url;
};

const buildSuccessUrl = (baseUrl) => {
  const url = assertAllowedReturnUrl(baseUrl, 'success');
  url.searchParams.set('checkoutSessionId', '{CHECKOUT_SESSION_ID}');
  url.searchParams.set('checkoutStatus', 'success');
  return url.toString();
};

const buildCancelUrl = (baseUrl) => {
  const url = assertAllowedReturnUrl(baseUrl, 'cancel');
  url.searchParams.delete('checkoutSessionId');
  url.searchParams.set('checkoutStatus', 'cancelled');
  return url.toString();
};

const DEFAULT_CURRENCY = DEFAULT_PITCH_CURRENCY;
const ALLOWED_CURRENCIES = new Set([DEFAULT_CURRENCY]);

const requiredPlayersByModality = {
  'Futbol 5': 5,
  'Futbol 7': 7,
};

const sanitizeDescription = (locationName) => {
  if (typeof locationName === 'string' && locationName.trim()) {
    return `Reserva de cancha - ${locationName.trim().slice(0, 60)}`;
  }
  return 'Pago Mi Potrero';
};

const parseJoinMatchCheckout = async ({ payload, userId }) => {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError(400, 'Datos del pago incompletos.');
  }

  const matchId = String(payload.matchId || '').trim();
  const teamId = String(payload.teamId || '').trim();

  if (!matchId || !teamId) {
    throw new HttpError(400, 'Faltan identificadores de partido o equipo.');
  }

  const [matchDoc, teamDoc] = await Promise.all([
    db.collection('matches').doc(matchId).get(),
    db.collection('teams').doc(teamId).get(),
  ]);

  if (!matchDoc.exists) {
    throw new HttpError(404, 'Partido no encontrado.');
  }
  if (!teamDoc.exists) {
    throw new HttpError(404, 'Equipo no encontrado.');
  }

  const matchData = matchDoc.data();
  const teamData = teamDoc.data();

  if (!Array.isArray(teamData.members) || !teamData.members.includes(userId)) {
    throw new HttpError(
      403,
      'Debes ser miembro del equipo para iniciar este pago.'
    );
  }

  if (matchData.teamA?.id === teamId) {
    throw new HttpError(
      400,
      'No puedes pagar para unirte con el mismo equipo del partido.'
    );
  }

  if (matchData.teamB) {
    throw new HttpError(409, 'El partido ya tiene equipo B.');
  }

  const location = matchData.location || {};
  const price = Number(location.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new HttpError(
      400,
      'El partido seleccionado no requiere pago o tiene un precio invalido.'
    );
  }

  const currency = String(location.currency || 'ARS').toUpperCase();
  if (!ALLOWED_CURRENCIES.has(currency)) {
    throw new HttpError(
      400,
      `Moneda ${currency} no soportada para pagos.`
    );
  }

  const amountInCents = Math.round(price * 100);
  const description = sanitizeDescription(location.name);

  return {
    action: 'join_match',
    amountInCents,
    currency,
    description,
    metadata: {
      matchId,
      teamId,
    },
  };
};

const parseCreateMatchCheckout = async ({ payload, userId }) => {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError(400, 'Datos del pago incompletos.');
  }

  const teamId = String(payload.teamId || '').trim();
  const dateTime = String(payload.dateTime || payload.datetime || '').trim();
  const modality = String(payload.tipoFutbol || payload.modality || '').trim();
  const locationId = String(payload.location?.id || '').trim();

  if (!teamId || !dateTime || !modality) {
    throw new HttpError(400, 'Datos del partido incompletos.');
  }

  const teamDoc = await db.collection('teams').doc(teamId).get();

  if (!teamDoc.exists) {
    throw new HttpError(404, 'Equipo no encontrado.');
  }

  const teamData = teamDoc.data();
  if (!Array.isArray(teamData.members) || !teamData.members.includes(userId)) {
    throw new HttpError(
      403,
      'Debes ser miembro del equipo para pagar la reserva.'
    );
  }

  const required = requiredPlayersByModality[modality] || null;
  if (
    required &&
    (!Array.isArray(teamData.members) ||
      teamData.members.length < Number(required))
  ) {
    throw new HttpError(
      400,
      `El equipo no cumple con la cantidad minima de jugadores para ${modality}.`
    );
  }

  const pitch = locationId ? getPitchById(locationId) : null;

  if (modality === 'Futbol 7' && !pitch) {
    throw new HttpError(
      400,
      'Debes seleccionar una cancha valida para Futbol 7.'
    );
  }

  if (!pitch) {
    throw new HttpError(
      400,
      'La cancha seleccionada no es valida para generar el pago.'
    );
  }

  const amount = Number(pitch.price);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'El valor de la cancha es invalido.');
  }

  const currency = String(pitch.currency || DEFAULT_CURRENCY).toUpperCase();
  if (!ALLOWED_CURRENCIES.has(currency)) {
    throw new HttpError(
      400,
      `Moneda ${currency} no soportada para pagos.`
    );
  }

  const amountInCents = Math.round(amount * 100);
  const description = sanitizeDescription(pitch.name);

  return {
    action: 'create_match',
    amountInCents,
    currency,
    description,
    metadata: {
      teamId,
      dateTime,
      tipoFutbol: modality,
      locationId: pitch.id,
      locationName: pitch.name,
      locationPrice: String(pitch.price),
      locationCurrency: currency,
    },
  };
};

const createCheckoutSession = async (req, res) => {
  try {
    const stripeClient = ensureStripe();
    const uid = req.user?.uid;
    const email = req.user?.email;
    if (!uid) {
      throw new HttpError(401, 'No autorizado.');
    }

    const { action, payload, successUrl, cancelUrl } = req.body || {};

    let checkoutData;
    if (action === 'join_match') {
      checkoutData = await parseJoinMatchCheckout({ payload, userId: uid });
    } else if (action === 'create_match') {
      checkoutData = await parseCreateMatchCheckout({ payload, userId: uid });
    } else {
      throw new HttpError(400, 'Accion de pago no soportada.');
    }

    const session = await stripeClient.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: email || undefined,
      metadata: {
        userId: uid,
        action: checkoutData.action,
        ...checkoutData.metadata,
      },
      line_items: [
        {
          price_data: {
            currency: checkoutData.currency.toLowerCase(),
            product_data: { name: checkoutData.description },
            unit_amount: checkoutData.amountInCents,
          },
          quantity: 1,
        },
      ],
      success_url: buildSuccessUrl(successUrl),
      cancel_url: buildCancelUrl(cancelUrl),
    });

    return res.status(200).json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error('Error al crear checkout session:', error);
    if (error instanceof HttpError) {
      return res.status(error.status).json({ mensaje: error.message });
    }
    return res
      .status(500)
      .json({ mensaje: 'No se pudo iniciar el pago.', error: error.message });
  }
};

const getCheckoutSession = async (req, res) => {
  try {
    const stripeClient = ensureStripe();
    const uid = req.user?.uid;
    if (!uid) {
      throw new HttpError(401, 'No autorizado.');
    }

    const sessionId = String(req.query?.sessionId || '').trim();
    if (!sessionId) {
      throw new HttpError(400, 'Falta sessionId.');
    }

    const session = await stripeClient.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent'],
    });

    if (session.metadata?.userId !== uid) {
      throw new HttpError(403, 'No puedes acceder a esta sesion de pago.');
    }

    const action = session.metadata?.action || null;
    let payload = {};
    if (action === 'join_match') {
      const matchId = session.metadata?.matchId || '';
      const teamId = session.metadata?.teamId || '';
      if (!matchId || !teamId) {
        throw new HttpError(400, 'Sesion de pago incompleta.');
      }
      payload = { matchId, teamId };
    } else if (action === 'create_match') {
      const teamId = session.metadata?.teamId || '';
      const dateTime = session.metadata?.dateTime || '';
      const tipoFutbol =
        session.metadata?.tipoFutbol || session.metadata?.modality || '';

      if (!teamId || !dateTime || !tipoFutbol) {
        throw new HttpError(400, 'Sesion de pago incompleta.');
      }

      let location = null;
      const locationId = session.metadata?.locationId || '';
      if (locationId) {
        const rawPrice = Number(session.metadata?.locationPrice);
        if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
          throw new HttpError(400, 'Sesion de pago invalida.');
        }
        const currency = String(
          session.metadata?.locationCurrency || DEFAULT_CURRENCY
        ).toUpperCase();
        if (!ALLOWED_CURRENCIES.has(currency)) {
          throw new HttpError(400, 'Sesion de pago invalida.');
        }
        location = {
          id: locationId,
          name: session.metadata?.locationName || '',
          price: rawPrice,
          currency,
        };
      }

      if (tipoFutbol === 'Futbol 7' && !location) {
        throw new HttpError(400, 'Sesion de pago incompleta.');
      }

      payload = { teamId, dateTime, tipoFutbol };
      if (location) {
        payload.location = location;
      }
    }

    return res.status(200).json({
      status: session.payment_status,
      amount: session.amount_total
        ? session.amount_total / 100
        : session.amount_subtotal / 100,
      currency: session.currency,
      metadata: {
        action,
        payload,
      },
    });
  } catch (error) {
    console.error('Error al recuperar checkout session:', error);
    if (error instanceof HttpError) {
      return res.status(error.status).json({ mensaje: error.message });
    }
    return res
      .status(500)
      .json({ mensaje: 'No se pudo consultar el pago.', error: error.message });
  }
};

module.exports = {
  createCheckoutSession,
  getCheckoutSession,
};
