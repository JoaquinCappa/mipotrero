import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  RecaptchaVerifier,
  linkWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import {
  getMessaging,
  getToken,
  onMessage
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app-check.js";

const SECTION_SUFFIX = "-section";

let app = null;
let auth = null;
let db = null;
let appCheckInstance = null;

let currentUserId = null;
let currentUserEmail = null;
let currentUserName = null;
let currentUserPhone = null;
let currentUserAge = null;
let hasLoadedInitialData = false;
let phoneRecaptchaVerifier = null;
let phoneConfirmationResult = null;
let pendingPhoneNumber = "";
let userTeamsCache = [];
let userTeamsPromise = null;
let messaging = null;
let messagingToken = null;
let firebaseConfig = null;
let messagingSwRegistration = null;

let unsubscribeAvailableMatches = null;
let unsubscribeUserMatches = null;
let unsubscribeInvitations = null;
let unsubscribeJoinRequests = null;
let unsubscribeIndividualRequests = null;
let unsubscribeAdminMatches = null;
const teamDetailsCache = new Map();
const realtimeUnsubs = new Set();
const pendingMatchDeletions = new Set();
const dom = {};
const PRIVACY_CONSENT_KEY = "mp_privacy_consent_v1";
const NOTIFICATION_PREF_KEY = "mp_notifications_pref_v1";
let pitchOptions = [];
let pitchOptionsPromise = null;
let closeMobileMenu = null;
let storage = null;
let currentUserPhotoUrl = null;
let defaultProfilePhotoSrc = "";
let isAdminUser = false;
const ADMIN_AUTO_PHONE = "+549999999999";
const ADMIN_AUTO_AGE = 30;
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_TEAM_COLOR = "#1b4a35";
const normalizeEmail = (value) => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
};

const canonicalizeEmail = (value) => {
  const normalized = normalizeEmail(value);
  if (!normalized || !normalized.includes("@")) return normalized;
  const [local, domain] = normalized.split("@");
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const withoutPlus = local.split("+")[0];
    const noDots = withoutPlus.replace(/\./g, "");
    return `${noDots}@gmail.com`;
  }
  return normalized;
};

const ADMIN_EMAILS = (() => {
  const base = ["mipotrerooficial@gmail.com"];
  const source = Array.isArray(window.__admin_emails) ? window.__admin_emails : [];
  const merged = [...base, ...source];
  const seen = new Set();
  return merged
    .map((value) => (typeof value === "string" ? canonicalizeEmail(value) : ""))
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
})();

const normalizeOrigin = (value) => {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
};

const customFunctionsDomain = normalizeOrigin(window.__functions_domain);
const explicitApiBase = normalizeOrigin(window.__api_base);
const API_BASE_URL =
  explicitApiBase || (customFunctionsDomain ? `${customFunctionsDomain}/api/v1` : "/api/v1");

const composeApiUrl = (path = "") => {
  if (!path) return API_BASE_URL;
  return path.startsWith("/") ? `${API_BASE_URL}${path}` : `${API_BASE_URL}/${path}`;
};

const byId = (id) => (typeof id === "string" ? document.getElementById(id) : null);

const toggleHidden = (element, hide) => {
  if (!element) return;
  element.classList.toggle("hidden", Boolean(hide));
};

const isAllowedAdminEmail = (email) => ADMIN_EMAILS.includes(canonicalizeEmail(email));

const deriveAdminDefaults = (email) => {
  const local = normalizeEmail(email).split("@")[0] || "admin";
  const name = local ? `${local}` : "Administrador";
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    phone: ADMIN_AUTO_PHONE,
    age: ADMIN_AUTO_AGE
  };
};

const updateAdminUiState = () => {
  if (dom.adminPanel) {
    toggleHidden(dom.adminPanel, !isAdminUser);
  }
  if (dom.adminMatches && !isAdminUser) {
    dom.adminMatches.innerHTML =
      '<p class="info-message">Accedé con el correo autorizado para ver los partidos organizados.</p>';
  }
};

const applyAdminModeUi = () => {
  if (isAdminUser) {
    setPhoneGateState(true);
    if (dom.phoneBlocker) toggleHidden(dom.phoneBlocker, true);
    if (dom.crearPartidoForm) dom.crearPartidoForm.classList.add("admin-disabled");
    if (dom.btnCrear) dom.btnCrear.disabled = true;
    if (dom.createTeamForm) {
      dom.createTeamForm.classList.add("admin-disabled");
      dom.createTeamForm.querySelectorAll("button, input, textarea, select").forEach((el) => {
        el.disabled = true;
      });
    }
    if (dom.joinRequestsList) toggleHidden(dom.joinRequestsList.closest(".notifications-column") || dom.joinRequestsList, false);
    if (dom.individualRequestsList) toggleHidden(dom.individualRequestsList.closest(".notifications-column") || dom.individualRequestsList, false);
    if (dom.invitationsList) toggleHidden(dom.invitationsList.closest(".notifications-column") || dom.invitationsList, false);
    if (dom.teamsDirectory) toggleHidden(dom.teamsDirectory, false);
    enforceAdminPhoneBypass();
  } else {
    if (dom.btnCrear) dom.btnCrear.disabled = false;
    if (dom.crearPartidoForm) dom.crearPartidoForm.classList.remove("admin-disabled");
    if (dom.createTeamForm) {
      dom.createTeamForm.classList.remove("admin-disabled");
      dom.createTeamForm.querySelectorAll("button, input, textarea, select").forEach((el) => {
        el.disabled = false;
      });
    }
    if (dom.joinRequestsList) toggleHidden(dom.joinRequestsList.closest(".notifications-column") || dom.joinRequestsList, false);
    if (dom.individualRequestsList) toggleHidden(dom.individualRequestsList.closest(".notifications-column") || dom.individualRequestsList, false);
    if (dom.invitationsList) toggleHidden(dom.invitationsList.closest(".notifications-column") || dom.invitationsList, false);
    if (dom.teamsDirectory) toggleHidden(dom.teamsDirectory, false);
  }
};

const setAdminFromUser = async (userOrEmail) => {
  const candidates = [];
  if (typeof userOrEmail === "string") {
    candidates.push(userOrEmail);
  } else if (userOrEmail && typeof userOrEmail === "object") {
    if (userOrEmail.email) candidates.push(userOrEmail.email);
    if (Array.isArray(userOrEmail.providerData)) {
      userOrEmail.providerData.forEach((provider) => {
        if (provider?.email) candidates.push(provider.email);
      });
    }
  }
  const canonicalCandidates = candidates.map((value) => canonicalizeEmail(value)).filter(Boolean);
  let allowed = canonicalCandidates.some((email) => isAllowedAdminEmail(email));
  if (!allowed && userOrEmail?.getIdTokenResult) {
    try {
      const token = await userOrEmail.getIdTokenResult();
      const claims = token?.claims || {};
      if (claims.admin || claims.isAdmin) allowed = true;
    } catch (error) {
      console.warn("No se pudieron leer claims de admin:", error);
    }
  }
  isAdminUser = allowed;
  updateAdminUiState();
  applyAdminModeUi();
  return isAdminUser;
};

const setAdminFromEmail = (email) => setAdminFromUser(email);

const showGlobalMessage = (text, type = "info") => {
  const el = byId("global-mensaje");
  if (!el) {
    console[type === "error" ? "error" : "log"](text);
    return;
  }
  el.textContent = text;
  el.className = "mensaje";
  el.classList.add(`mensaje-${type}`);
  el.classList.remove("hidden");
  clearTimeout(showGlobalMessage.timer);
  showGlobalMessage.timer = setTimeout(() => el.classList.add("hidden"), 5000);
};

const formatTeamColor = (value, fallback = DEFAULT_TEAM_COLOR) => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return /^#([0-9a-f]{6})$/i.test(normalized) ? normalized : fallback;
};

const initialsFromName = (value) => {
  if (typeof value !== "string") return "MP";
  const letters = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase());
  return letters.length ? letters.join("") : "MP";
};

const buildTeamShieldPlaceholder = (name, color) => {
  const initials = initialsFromName(name);
  const background = formatTeamColor(color);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="36" fill="${background}"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="Poppins, sans-serif" font-size="48" fill="#ffffff">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const sanitizeFileName = (name = "") => {
  if (!name) return `archivo-${Date.now()}`;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
};

const validateImageFile = (file) => {
  if (!file) return "Selecciona una imagen para continuar.";
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return "La imagen debe pesar menos de 2 MB.";
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return "Usa una imagen JPG, PNG o WEBP.";
  }
  return null;
};

const uploadImageFile = async (file, destinationPath) => {
  if (!storage) {
    throw new Error("El almacenamiento no está inicializado.");
  }
  const fileRef = storageRef(storage, destinationPath);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return getDownloadURL(fileRef);
};

const updateProfilePhotoPreview = (url) => {
  if (!dom.profilePhotoPreview) return;
  const source = typeof url === "string" && url.trim() ? url : defaultProfilePhotoSrc;
  if (source) {
    dom.profilePhotoPreview.src = source;
    dom.profilePhotoPreview.alt =
      currentUserName && currentUserName !== "-"
        ? `Foto de ${currentUserName}`
        : "Foto de jugador";
  }
};

const getTeamShieldUrl = (team) => {
  if (!team) return buildTeamShieldPlaceholder("Equipo", DEFAULT_TEAM_COLOR);
  if (typeof team.shieldUrl === "string" && team.shieldUrl.trim()) {
    return team.shieldUrl;
  }
  return buildTeamShieldPlaceholder(team.name || "Equipo", team.jerseyColor || DEFAULT_TEAM_COLOR);
};

const normalizePhoneInput = (value = "") => {
  if (typeof value !== "string") return "";
  let phone = value.trim();
  if (!phone) return "";
  const startsWithPlus = phone.startsWith("+");
  phone = phone.replace(/[^\d+]/g, "");
  if (!phone) return "";
  if (startsWithPlus) {
    const normalized = `+${phone.slice(1).replace(/\D/g, "")}`;
    return normalized.length >= 10 ? normalized : "";
  }
  let digits = phone.replace(/\D/g, "");
  digits = digits.replace(/^0+/, "");
  if (!digits) return "";
  if (digits.startsWith("549")) return `+${digits}`;
  if (digits.startsWith("54")) return `+549${digits.slice(2)}`;
  return `+549${digits}`;
};

const normalizeAnyPhone = (value) => {
  if (typeof value === "number") value = String(value);
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return normalizePhoneInput(trimmed) || trimmed;
};

const isMatchExpired = (match) => {
  const status = buildMatchStatus(match);
  return status.hasValidDate && status.date.getTime() < Date.now();
};

const doesTeamIncludeUser = (team) => {
  if (!team || !currentUserId) return false;
  const sources = [
    team.members,
    team.memberIds,
    team.membersIds,
    team.memberIDs,
    team.players,
    team.roster
  ];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      if (typeof item === "string" && item === currentUserId) return true;
      if (item && typeof item === "object") {
        const id = item.uid || item.userId || item.id;
        if (id === currentUserId) return true;
      }
    }
  }
  if (team.ownerId && team.ownerId === currentUserId) return true;
  return false;
};

const scheduleDeleteMatch = async (matchId) => {
  // Borrado deshabilitado en cliente para evitar errores de permisos.
  return;
};

const extractPhoneFromRecord = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return normalizeAnyPhone(value);
  if (typeof value !== "object") return "";
  const candidates = [
    value.phoneNumber,
    value.phone,
    value.telefono,
    value.captainPhone,
    value.captainPhoneNumber,
    value.captain?.phone,
    value.captain?.phoneNumber,
    value.contactPhone,
    value.contact?.phone,
    value.contact?.phoneNumber
  ];
  const found = candidates.map((item) => normalizeAnyPhone(item)).find(Boolean);
  return found || "";
};

const getTeamId = (team) => {
  if (!team || typeof team !== "object") return null;
  return team.id || team.teamId || null;
};

const formatPhoneLink = (phone) => {
  const normalized = normalizeAnyPhone(phone);
  return normalized ? `<a href="tel:${normalized}">${normalized}</a>` : "Sin telefono";
};

const extractPlayersFromTeam = (team, details = {}) => {
  if (!team || typeof team !== "object") return [];
  const sources = [
    team.players,
    team.members,
    team.roster,
    team.playerList,
    team.playerIds,
    team.memberIds,
    team.membersIds,
    team.memberIDs,
    team.playersList
  ];
  for (const source of sources) {
    if (Array.isArray(source) && source.length) {
      return source.map((p) => {
        if (typeof p === "string") return { id: null, name: p, phone: "" };
        if (!p || typeof p !== "object") return { id: null, name: "Jugador", phone: "" };
        return {
          id: p.uid || p.userId || p.id || null,
          name: p.name || p.displayName || p.fullName || p.alias || (p.id ? `Jugador ${p.id}` : "Jugador"),
          phone: extractPhoneFromRecord(p)
        };
      });
    }
  }
  const memberNames = Array.isArray(team.memberNames?.length ? team.memberNames : details.memberNames)
    ? team.memberNames || details.memberNames
    : [];
  const memberPhones = Array.isArray(team.memberPhones?.length ? team.memberPhones : details.memberPhones)
    ? team.memberPhones || details.memberPhones
    : [];
  if (memberNames.length) {
    return memberNames.map((name, idx) => ({
      id: null,
      name: typeof name === "string" ? name : "Jugador",
      phone: normalizeAnyPhone(memberPhones[idx])
    }));
  }
  return [];
};

const computeTeamSize = (team, details = {}, fallback = 0) => {
  if (!team) return 0;
  const numbers = [
    team.playersCount,
    team.memberCount,
    team.count,
    team.size,
    team.totalPlayers
  ].filter((n) => Number.isFinite(n) && n >= 0);
  const arrays = [
    team.players,
    team.members,
    team.roster,
    team.playerList,
    team.memberIds,
    team.membersIds,
    team.memberIDs,
    team.playerIds,
    team.playersList
  ].filter((arr) => Array.isArray(arr));
  const detailArrays = [details.memberNames, details.members].filter((arr) => Array.isArray(arr));
  const arrayLengths = [...arrays, ...detailArrays].map((arr) => arr.length);
  const maxArray = arrayLengths.length ? Math.max(...arrayLengths) : 0;
  const maxNumber = numbers.length ? Math.max(...numbers) : 0;
  const maxValue = Math.max(maxArray, maxNumber);
  if (maxValue > 0) return maxValue;
  return fallback;
};

const PLAYERS_REQUIRED_BY_MODALITY = {
  "Futbol 5": 10,
  "Futbol 6": 12,
  "Futbol 7": 14,
  "Futbol 8": 16,
  "Futbol 9": 18,
  "Futbol 10": 20,
  "Futbol 11": 22
};

const getRequiredPlayers = (match) => {
  const modalityRaw = match?.modality || match?.tipoFutbol;
  const modality = typeof modalityRaw === "string" ? modalityRaw.trim() : "";
  const required = PLAYERS_REQUIRED_BY_MODALITY[modality];
  if (Number.isFinite(required) && required > 0) return required;
  return 14;
};

const getDefaultTeamSize = () => 0;

const countConfirmedPlayers = (match) => {
  const fallback = getDefaultTeamSize(match);
  const teamAId = getTeamId(match?.teamA);
  const teamBId = getTeamId(match?.teamB);
  const teamADetails = teamAId && teamDetailsCache.has(teamAId) ? teamDetailsCache.get(teamAId) : {};
  const teamBDetails = teamBId && teamDetailsCache.has(teamBId) ? teamDetailsCache.get(teamBId) : {};
  const teamAPlayers = match?.teamA ? computeTeamSize(match.teamA, teamADetails, fallback) : 0;
  const teamBPlayers = match?.teamB ? computeTeamSize(match.teamB, teamBDetails, fallback) : 0;
  const individuals = Array.isArray(match?.individualPlayers) ? match.individualPlayers.length : 0;
  return teamAPlayers + teamBPlayers + individuals;
};
const buildMatchStatus = (match) => {
  const date = match?.dateTime ? new Date(match.dateTime) : null;
  const hasValidDate = date instanceof Date && !Number.isNaN(date?.getTime());
  const hoursToMatch = hasValidDate ? (date.getTime() - Date.now()) / 36e5 : null;
  const requiredPlayers = getRequiredPlayers(match);
  const inferredPlayers = countConfirmedPlayers(match);
  const confirmedPlayers = Math.max(
    inferredPlayers,
    Number(match?.confirmedPlayers) || 0,
    Number(match?.playerCount) || 0
  );
  const missing = Math.max(requiredPlayers - confirmedPlayers, 0);
  const needsAutoCancel =
    hoursToMatch !== null &&
    hoursToMatch <= 12 &&
    hoursToMatch >= 0 &&
    confirmedPlayers < requiredPlayers;
  const isFull = confirmedPlayers >= requiredPlayers;
  return {
    date,
    hasValidDate,
    hoursToMatch,
    confirmedPlayers,
    missing,
    needsAutoCancel,
    isFull,
    requiredPlayers
  };
};

const normalizeAgeValue = (value) => {
  const ageNumber = Number(value);
  if (!Number.isFinite(ageNumber)) return null;
  const rounded = Math.floor(ageNumber);
  if (rounded < 10 || rounded > 90) return null;
  return rounded;
};

const logoutServerSession = async () => {
  try {
    await fetch(composeApiUrl("/auth/sessionLogout"), { method: "POST", credentials: "include" });
  } catch (error) {
    console.warn("No se pudo limpiar la sesion del servidor:", error);
  }
};

const syncServerSession = async () => {
  if (!auth?.currentUser) return;
  try {
    const idToken = await auth.currentUser.getIdToken(true);
    await fetch(composeApiUrl("/auth/sessionLogin"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ idToken })
    });
  } catch (error) {
    console.warn("No se pudo sincronizar la sesion:", error);
  }
};

const callApiWithRetry = async (path, options = {}, attempt = 1) => {
  const {
    method = "GET",
    body,
    headers = {},
    authRequired = true,
    signal
  } = options;

  const requestHeaders = {
    "Content-Type": "application/json",
    ...headers
  };

  if (authRequired) {
    if (!auth?.currentUser) throw new Error("Debes iniciar sesion.");
    requestHeaders.Authorization = `Bearer ${await auth.currentUser.getIdToken(attempt > 1)}`;
  }

  const response = await fetch(composeApiUrl(path), {
    method,
    headers: requestHeaders,
    credentials: "include",
    signal,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (response.status === 401 && authRequired && attempt < 2) {
    await auth.currentUser?.getIdToken(true);
    return callApiWithRetry(path, options, attempt + 1);
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    const error = new Error(payload?.mensaje || payload?.message || `Error HTTP ${response.status}`);
    error.status = response.status;
    error.data = payload;
    throw error;
  }

  return payload;
};

const initFirebase = () => {
  if (app) return;
  const rawConfig = typeof window.__firebase_config !== "undefined" ? window.__firebase_config : null;
  if (!rawConfig) throw new Error("No se encontro la configuracion de Firebase.");
  firebaseConfig = typeof rawConfig === "string" ? JSON.parse(rawConfig) : rawConfig;
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  try {
    const vapidKey =
      typeof window.__fcm_vapid_key === "string" && window.__fcm_vapid_key.trim()
        ? window.__fcm_vapid_key.trim()
        : null;
    if (vapidKey && typeof Notification !== "undefined") {
      messaging = getMessaging(app);
      messaging.vapidKey = vapidKey;
    }
  } catch (error) {
    console.warn("No se pudo inicializar messaging:", error);
  }

  const siteKey = typeof window.__app_check_site_key === "string" ? window.__app_check_site_key.trim() : "";
  if (siteKey) {
    try {
      appCheckInstance = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true
      });
    } catch (error) {
      console.warn("App Check no pudo inicializarse:", error);
    }
  }
};

const cacheDom = () => {
  dom.body = document.body;
  dom.layout = document.querySelector(".layout");
  dom.authContainer = byId("auth-container");
  dom.contentContainer = byId("content-container");
  dom.registerForm = byId("register-form");
  dom.loginForm = byId("login-form");
  dom.registerName = byId("reg-nombre");
  dom.registerEmail = byId("reg-email");
  dom.registerPhone = byId("reg-phone");
  dom.registerAge = byId("reg-edad");
  dom.registerPassword = byId("reg-password");
  dom.registerAdminFlag = byId("reg-admin-flag");
  dom.loginEmail = byId("login-email");
  dom.loginPassword = byId("login-password");
  dom.showLoginLink = byId("show-login");
  dom.showRegisterLink = byId("show-register");
  dom.googleButton = byId("google-signin");
  dom.logoutButton = byId("btn-logout");
  dom.sections = Array.from(document.querySelectorAll("section[id$='-section']"));
  dom.navLinks = Array.from(document.querySelectorAll("a.nav-link"));
  dom.sidebar = byId("sidebar");
  dom.mobileMenuToggle = byId("mobile-menu-toggle");
  dom.mobileMenuClose = byId("mobile-menu-close");
  dom.mobileSidebarBackdrop = byId("mobile-sidebar-backdrop");
  dom.pitchWrapper = byId("lugar-partido-wrapper");
  dom.pitchSelect = byId("lugar-partido");
  dom.pitchDetail = byId("lugar-partido-detalle");
  dom.availableMatches = byId("lista-partidos");
  dom.userMatches = byId("mis-partidos");
  dom.invitationsList = byId("invitaciones-list");
  dom.notificationCount = byId("notification-count");
  dom.userTeamsList = byId("user-teams-list");
  dom.teamsDirectory = byId("teams-directory");
  dom.joinRequestsList = byId("join-requests-list");
  dom.individualRequestsList = byId("individual-requests-list");
  dom.individualRequestsInline = byId("individual-requests-inline");
  dom.notificationPermissionLabel = byId("notification-permission-label");
  dom.enableNotificationsButton = byId("btn-enable-notifications");
  dom.profilePhoneActions = document.querySelector(".profile-phone-actions");
  dom.createTeamForm = byId("create-team-form");
  dom.createTeamName = byId("create-team-name");
  dom.createTeamDescription = byId("create-team-description");
  dom.createTeamColorName = byId("create-team-color-name");
  dom.createTeamColor = byId("create-team-color");
  dom.createTeamColorPreview = byId("create-team-color-preview");
  dom.createTeamShield = byId("create-team-shield");
  dom.createTeamFeedback = byId("create-team-feedback");
  dom.crearPartidoForm = byId("crear-partido-form");
  dom.crearTeamSelect = byId("crearPartidoConEquipo");
  dom.crearFecha = byId("fecha");
  dom.crearTipo = byId("tipoFutbol");
  dom.btnCrear = byId("btnCrear");
  dom.profileName = byId("user-name-display");
  dom.profileAgeDisplay = byId("user-age-display");
  dom.profileEmail = byId("user-email-display");
  dom.profileId = byId("user-id-display");
  dom.profilePhone = byId("user-phone-display");
  dom.profilePositionDisplay = byId("profile-position-display");
  dom.profileDescriptionDisplay = byId("profile-description-display");
  dom.profilePhotoInput = byId("profile-photo-input");
  dom.profilePhotoPreview = byId("profile-photo-preview");
  if (!defaultProfilePhotoSrc && dom.profilePhotoPreview) {
    defaultProfilePhotoSrc = dom.profilePhotoPreview.getAttribute("src") || "";
  }
  dom.profileForm = byId("profile-extra-form");
  dom.profileAge = byId("profile-age");
  dom.profilePosition = byId("profile-position");
  dom.profileDescription = byId("profile-description");
  dom.profileFeedback = byId("profile-form-feedback");
  dom.phoneBlocker = byId("phone-verification-blocker");
  dom.phoneBlockerOpen = byId("phone-blocker-open");
  dom.phoneModal = byId("phone-verification-modal");
  dom.phoneModalOpen = byId("open-phone-modal");
  dom.phoneModalNumber = byId("phone-modal-number");
  dom.phoneModalSend = byId("phone-modal-send");
  dom.phoneModalCodeSection = byId("phone-modal-code-section");
  dom.phoneModalCode = byId("phone-modal-code");
  dom.phoneModalConfirm = byId("phone-modal-confirm");
  dom.phoneModalCancel = byId("phone-modal-cancel");
  dom.phoneModalMessage = byId("phone-modal-message");
  dom.recaptchaContainer = byId("recaptcha-container");
  dom.privacyBanner = byId("privacy-banner");
  dom.acceptPrivacy = byId("btn-accept-privacy");
  dom.rejectPrivacy = byId("btn-reject-privacy");
  dom.adminPanel = byId("admin-panel");
  dom.adminMatches = byId("admin-matches");
  updateAdminUiState();
};

const describeAuthError = (error) => {
  const code = (error?.code || "").toLowerCase();
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Email o contraseña incorrectos.";
  }
  if (code === "auth/too-many-requests") {
    return "Demasiados intentos fallidos. Espera unos minutos o restablece tu contraseña.";
  }
  if (code === "auth/network-request-failed") {
    return "No se pudo conectar. Revisa tu conexión e intenta nuevamente.";
  }
  if (code === "auth/user-disabled") {
    return "Tu cuenta está deshabilitada. Contacta al administrador.";
  }
  if (code === "auth/invalid-email") {
    return "Ingresa un email válido.";
  }
  return `No se pudo iniciar sesión (${code || "error"}).`;
};
const toggleAppView = (isLoggedIn) => {
  toggleHidden(dom.authContainer, isLoggedIn);
  toggleHidden(dom.contentContainer, !isLoggedIn);
  dom.logoutButton?.classList.toggle("hidden", !isLoggedIn);
};

const updateProfileCard = (profile = {}) => {
  if (dom.profileName) dom.profileName.textContent = profile.nombre || currentUserName || "-";
  const ageValue = normalizeAgeValue(profile.edad ?? profile.age ?? currentUserAge);
  if (typeof ageValue === "number") {
    currentUserAge = ageValue;
  }
  if (dom.profileAgeDisplay) {
    if (typeof ageValue === "number") {
      dom.profileAgeDisplay.textContent = `${ageValue} a\u00f1os`;
      dom.profileAgeDisplay.classList.remove("hidden");
    } else {
      dom.profileAgeDisplay.classList.add("hidden");
    }
  }
  if (dom.profileEmail) dom.profileEmail.textContent = currentUserEmail || "-";
  if (dom.profileId) dom.profileId.textContent = currentUserId || "-";
  if (dom.profilePositionDisplay)
    dom.profilePositionDisplay.textContent = profile.posicion || "Sin definir";
  if (dom.profileDescriptionDisplay)
    dom.profileDescriptionDisplay.textContent =
      profile.descripcion || "Completa tu perfil para que otros sepan como jugas.";
  if (profile.photoUrl || currentUserPhotoUrl) {
    updateProfilePhotoPreview(profile.photoUrl || currentUserPhotoUrl);
  } else {
    updateProfilePhotoPreview(null);
  }
};

const updatePhoneDisplay = () => {
  if (!dom.profilePhone) return;
  const unlocked = Boolean(currentUserPhone) || isAdminUser;
  const phoneLabel = currentUserPhone || (isAdminUser ? ADMIN_AUTO_PHONE : "");
  dom.profilePhone.textContent = phoneLabel || "Sin registrar";
  dom.profilePhone.dataset.status = unlocked ? "verified" : "missing";
  if (dom.phoneModalOpen) {
    dom.phoneModalOpen.classList.toggle("hidden", unlocked);
    dom.phoneModalOpen.disabled = unlocked;
  }
  if (dom.profilePhoneActions) {
    toggleHidden(dom.profilePhoneActions, !dom.profilePhoneActions || unlocked);
  }
  setPhoneGateState(unlocked);
};

const enforceAdminPhoneBypass = () => {
  if (!isAdminUser) return;
  if (dom.phoneBlocker) {
    dom.phoneBlocker.classList.add("hidden");
    dom.phoneBlocker.setAttribute("aria-hidden", "true");
    dom.phoneBlocker.style.pointerEvents = "none";
  }
  if (dom.phoneBlockerOpen) {
    dom.phoneBlockerOpen.disabled = true;
  }
  if (dom.phoneModalOpen) {
    dom.phoneModalOpen.classList.add("hidden");
    dom.phoneModalOpen.disabled = true;
  }
};

const requireVerifiedPhone = (message = "Verifica tu telefono para continuar.") => {
  if (isAdminUser) return true;
  if (currentUserPhone) return true;
  showGlobalMessage(message, "info");
  openPhoneModal();
  return false;
};

const setPhoneGateState = (unlocked) => {
  dom.phoneBlocker?.classList.toggle("hidden", Boolean(unlocked));
};

const cleanupRealtime = () => {
  realtimeUnsubs.forEach((unsub) => {
    try {
      unsub();
    } catch {}
  });
  realtimeUnsubs.clear();
  unsubscribeAvailableMatches = null;
  unsubscribeUserMatches = null;
  unsubscribeInvitations = null;
  unsubscribeJoinRequests = null;
  unsubscribeIndividualRequests = null;
  unsubscribeAdminMatches = null;
};

const ensureUserTeams = async (force = false) => {
  if (!auth?.currentUser || !db) return [];
  if (force) {
    userTeamsCache = [];
    userTeamsPromise = null;
  }
  if (userTeamsCache.length && !force) return userTeamsCache;
  if (!userTeamsPromise) {
    userTeamsPromise = (async () => {
      const userDoc = await getDoc(doc(db, "users", currentUserId));
      const teamIds = userDoc.exists() ? userDoc.data()?.teams || [] : [];
      if (!teamIds.length) {
        userTeamsCache = [];
        return userTeamsCache;
      }
      const snapshots = await Promise.all(teamIds.map((id) => getDoc(doc(db, "teams", id))));
      userTeamsCache = snapshots
        .filter((snap) => snap.exists())
        .map((snap) => ({ id: snap.id, ...snap.data() }));
      return userTeamsCache;
    })()
      .catch((error) => {
        console.error("No se pudieron cargar los equipos:", error);
        userTeamsCache = [];
        return [];
      })
      .finally(() => {
        userTeamsPromise = null;
      });
  }
  return userTeamsPromise;
};

const loadTeamsForCreation = async (force = false) => {
  const select = dom.crearTeamSelect;
  if (!select || !currentUserId) return;
  select.innerHTML = '<option value="">Selecciona tu equipo</option>';
  const teams = await ensureUserTeams(force);
  if (!teams.length) {
    select.innerHTML = '<option value="" disabled>Debes crear un equipo primero</option>';
    return;
  }
  teams.forEach((team) => {
    const option = document.createElement("option");
    option.value = team.id;
    option.textContent = `${team.name} (${team.memberNames?.length || 0} miembros)`;
    select.appendChild(option);
  });
};

const parsePitchOptionsPayload = (payload) => {
  const rawList = Array.isArray(payload?.pitches) ? payload.pitches : Array.isArray(payload) ? payload : [];
  return rawList
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const price = Number(item.price);
      const currency =
        typeof item.currency === "string" && item.currency.trim()
          ? item.currency.trim().toUpperCase()
          : "ARS";
      if (!id || !name || !Number.isFinite(price) || price <= 0) return null;
      return { id, name, price, currency };
    })
    .filter(Boolean);
};

const ensurePitchOptionsLoaded = async (force = false) => {
  if (force) {
    pitchOptions = [];
    pitchOptionsPromise = null;
  }
  if (pitchOptions.length) return pitchOptions;
  if (!pitchOptionsPromise) {
    pitchOptionsPromise = (async () => {
      const response = await callApiWithRetry("/partidos/pitches", {
        method: "GET",
        authRequired: false
      });
      const parsed = parsePitchOptionsPayload(response);
      pitchOptions = parsed;
      return pitchOptions;
    })()
      .catch((error) => {
        pitchOptions = [];
        throw error;
      })
      .finally(() => {
        pitchOptionsPromise = null;
      });
  }
  return pitchOptionsPromise;
};

const getPitchOptionById = (pitchId) => {
  if (!pitchId) return null;
  return pitchOptions.find((item) => item.id === pitchId) || null;
};

const ensurePitchOptionsRendered = () => {
  if (!dom.pitchSelect) return;
  if (pitchOptions.length) {
    dom.pitchSelect.disabled = false;
    renderPitchOptions();
    updatePitchDetail();
    return;
  }
  dom.pitchSelect.disabled = true;
  dom.pitchSelect.innerHTML = '<option value="">Cargando canchas...</option>';
  ensurePitchOptionsLoaded()
    .then(() => {
      if (!dom.pitchSelect) return;
      dom.pitchSelect.disabled = false;
      renderPitchOptions();
      updatePitchDetail();
    })
    .catch((error) => {
      console.error("No se pudieron cargar las canchas:", error);
      if (dom.pitchSelect) {
        dom.pitchSelect.innerHTML = '<option value="">No pudimos cargar las canchas</option>';
        dom.pitchSelect.disabled = true;
      }
    });
};

const prefetchPitchOptions = () => {
  ensurePitchOptionsLoaded().catch((error) => {
    console.warn("No pudimos precargar las canchas:", error);
  });
};

const renderPitchOptions = () => {
  if (!dom.pitchSelect) return;
  const selected = dom.pitchSelect.value;
  dom.pitchSelect.innerHTML = '<option value="">Elige una cancha disponible</option>';
  if (!pitchOptions.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No hay canchas disponibles";
    emptyOption.disabled = true;
    dom.pitchSelect.appendChild(emptyOption);
    dom.pitchSelect.value = "";
    return;
  }
  pitchOptions.forEach((pitch) => {
    const option = document.createElement("option");
    option.value = pitch.id;
    const formattedPrice = pitch.price?.toLocaleString
      ? pitch.price.toLocaleString("es-AR")
      : String(pitch.price);
    option.textContent = `${pitch.name} - $${formattedPrice}`;
    dom.pitchSelect.appendChild(option);
  });
  if (selected) {
    dom.pitchSelect.value = selected;
    if (dom.pitchSelect.value !== selected) {
      dom.pitchSelect.value = "";
    }
  }
};

const updatePitchDetail = () => {
  if (!dom.pitchDetail) return;
  const pitchId = dom.pitchSelect?.value;
  if (!pitchId) {
    dom.pitchDetail.textContent = "";
    dom.pitchDetail.classList.add("hidden");
    return;
  }
  const data = getPitchOptionById(pitchId);
  if (!data) {
    dom.pitchDetail.textContent = "";
    dom.pitchDetail.classList.add("hidden");
    return;
  }
  const formatter = typeof Intl !== "undefined" ? new Intl.NumberFormat("es-AR", { style: "currency", currency: data.currency || "ARS" }) : null;
  const priceText = formatter ? formatter.format(data.price) : `$${data.price}`;
  dom.pitchDetail.textContent = `Costo estimado: ${priceText}`;
  dom.pitchDetail.classList.remove("hidden");
};

const syncPitchSection = () => {
  const tipoFutbol = dom.crearTipo?.value || "";
  const requiresPitch = tipoFutbol === "Futbol 7";
  toggleHidden(dom.pitchWrapper, !requiresPitch);
  if (!requiresPitch) {
    if (dom.pitchSelect) {
      dom.pitchSelect.value = "";
      dom.pitchSelect.disabled = false;
    }
    if (dom.pitchDetail) {
      dom.pitchDetail.textContent = "";
      dom.pitchDetail.classList.add("hidden");
    }
    return;
  }
  ensurePitchOptionsRendered();
};

const handleCreateMatch = async () => {
  if (isAdminUser) {
    showGlobalMessage("Modo administrador de solo lectura. No puedes crear partidos.", "info");
    return;
  }
  if (!auth?.currentUser || !currentUserId) {
    showGlobalMessage("Debes iniciar sesion para crear un partido.", "info");
    return;
  }
  const teamId = dom.crearTeamSelect?.value;
  const dateTime = dom.crearFecha?.value;
  const tipoFutbol = dom.crearTipo?.value;
  const matchDate = dateTime ? new Date(dateTime) : null;
  if (!matchDate || Number.isNaN(matchDate.getTime())) {
    showGlobalMessage("Elegí una fecha y hora válidas.", "info");
    return;
  }
  const hoursUntilMatch = (matchDate.getTime() - Date.now()) / 36e5;
  if (hoursUntilMatch < 24) {
    showGlobalMessage("Organiza el partido con al menos 24 horas de anticipacion.", "info");
    return;
  }
  let location = null;
  if (tipoFutbol === "Futbol 7") {
    const pitchId = dom.pitchSelect?.value;
    if (!pitchId) {
      showGlobalMessage("Selecciona la cancha para tu partido de Futbol 7.", "info");
      return;
    }
    let pitch = null;
    try {
      await ensurePitchOptionsLoaded();
      pitch = getPitchOptionById(pitchId);
    } catch (error) {
      console.error("No se pudieron cargar las canchas validadas:", error);
      showGlobalMessage("No pudimos validar las canchas disponibles. Intenta nuevamente.", "error");
      return;
    }
    if (!pitch) {
      showGlobalMessage("La cancha seleccionada no es valida.", "info");
      return;
    }
    location = { id: pitch.id, name: pitch.name, price: pitch.price, currency: pitch.currency || "ARS" };
  }
  if (!teamId || !dateTime || !tipoFutbol) {
    showGlobalMessage("Completa todos los campos del partido.", "info");
    return;
  }
  try {
    const body = { teamId, dateTime, tipoFutbol };
    if (location) body.location = location;
    const result = await callApiWithRetry("/partidos", {
      method: "POST",
      body
    });
    showGlobalMessage(result?.mensaje || "Partido creado.", "exito");
    dom.crearPartidoForm?.reset();
    navigateTo("partidos-section");
  } catch (error) {
    console.error("Error al crear partido:", error);
    const msg = error?.data?.mensaje || error.message;
    showGlobalMessage(`Error al crear partido: ${msg}`, "error");
  }
};

const handleJoinMatch = async (matchId, teamId) => {
  if (isAdminUser) {
    showGlobalMessage("Modo administrador: no puedes unirte a partidos.", "info");
    return;
  }
  if (!requireVerifiedPhone("Verifica tu telefono para unirte a un partido.")) return;
  const existing = await getMatchById(matchId);
  if (existing && isUserAlreadyInMatch(existing)) {
    showGlobalMessage("Ya formas parte de este partido. No puedes unirte nuevamente.", "info");
    return;
  }
  if (!teamId) {
    showGlobalMessage("Selecciona un equipo para unirte.", "info");
    return;
  }
  try {
    const result = await callApiWithRetry("/partidos/join", {
      method: "POST",
      body: { matchId, teamId }
    });
    showGlobalMessage(result?.mensaje || "Te uniste al partido.", "exito");
    navigateTo("partidos-section");
  } catch (error) {
    console.error("Error al unirse al partido:", error);
    const msg = error?.data?.mensaje || error.message;
    showGlobalMessage(`Error al unirse: ${msg}`, "error");
  }
};

const handleIndividualJoinRequest = async (matchId, note) => {
  if (isAdminUser) {
    showGlobalMessage("Modo administrador: no puedes pedir lugar.", "info");
    return;
  }
  if (!requireVerifiedPhone("Verifica tu telefono para pedir lugar.")) return;
  if (!matchId) return;
  const existing = await getMatchById(matchId);
  if (existing && isUserAlreadyInMatch(existing)) {
    showGlobalMessage("Ya formas parte de este partido. No puedes pedir lugar nuevamente.", "info");
    return;
  }
  if (!auth?.currentUser || !currentUserId) {
    showGlobalMessage("Inicia sesion para pedir lugar en un partido.", "info");
    return;
  }
  try {
    const result = await callApiWithRetry("/partidos/individual/request", {
      method: "POST",
      body: {
        matchId,
        mensaje: typeof note === "string" ? note.trim() : "",
        edad: currentUserAge
      }
    });
    showGlobalMessage(result?.mensaje || "Solicitud enviada al capitan.", "exito");
  } catch (error) {
    console.error("Error al solicitar unirte como jugador libre:", error);
    const msg = error?.data?.mensaje || error.message;
    showGlobalMessage(`No se pudo enviar tu solicitud: ${msg}`, "error");
  }
};

const subscribeAvailableMatches = () => {
  const list = dom.availableMatches;
  if (!list || !db || !currentUserId) return;
  list.innerHTML = "<p>Buscando partidos disponibles...</p>";
  if (unsubscribeAvailableMatches) {
    try {
      unsubscribeAvailableMatches();
    } catch {}
    realtimeUnsubs.delete(unsubscribeAvailableMatches);
    unsubscribeAvailableMatches = null;
  }
  unsubscribeAvailableMatches = onSnapshot(
    collection(db, "matches"),
    async (snapshot) => {
      const matches = [];
      snapshot.forEach((docSnap) => {
        const match = { id: docSnap.id, ...docSnap.data() };
        if (isMatchExpired(match)) return;
        const status = buildMatchStatus(match);
        if (isUserAlreadyInMatch(match)) return;
        matches.push(match);
      });
      matches.sort((a, b) => {
        const da = a.dateTime ? new Date(a.dateTime).getTime() : Number.MAX_SAFE_INTEGER;
        const dbv = b.dateTime ? new Date(b.dateTime).getTime() : Number.MAX_SAFE_INTEGER;
        return da - dbv;
      });
      const teamIds = [];
      matches.forEach((match) => {
        const idA = getTeamId(match.teamA);
        const idB = getTeamId(match.teamB);
        if (idA) teamIds.push(idA);
        if (idB) teamIds.push(idB);
      });
      await ensureTeamDetails(teamIds);
      if (isAdminUser) {
        list.innerHTML = '<p class="info-message">Modo admin: vista de union deshabilitada (solo lectura).</p>';
        return;
      }
      await ensureUserTeams();
      let eligible = userTeamsCache.filter((team) => doesTeamIncludeUser(team));
      if (!eligible.length) {
        eligible = userTeamsCache;
      }
      const hasTeams = eligible.length > 0;
      const options = eligible.map((team) => `<option value="${team.id}">${team.name}</option>`).join("");
      if (!matches.length) {
        list.innerHTML = '<p class="info-message">No hay partidos disponibles.</p>';
        return;
      }
      list.innerHTML = matches
        .map((match) => {
          const status = buildMatchStatus(match);
          const missingText = status.missing > 0 ? `(faltan ${status.missing})` : "(completo)";
          const date = match.dateTime ? new Date(match.dateTime).toLocaleString() : "Fecha a confirmar";
          const location = match.location?.name ? `<p>Cancha: ${match.location.name}</p>` : "";
          const canJoinAsTeam = !match.teamB && !status.isFull;
          const teamControls = hasTeams && canJoinAsTeam
            ? `
                <div class="join-controls">
                  <label>Unirse con equipo</label>
                  <select class="join-team-select">
                    <option value="">Elige un equipo</option>
                    ${options}
                  </select>
                  <button type="button" class="btn-unirse">Unirme</button>
                </div>`
            : canJoinAsTeam
              ? '<p class="info-message">Crea o únete a un equipo para sumarte.</p>'
              : "";
          const ageHint =
            typeof currentUserAge === "number"
              ? `<small class="form-hint">Tu edad: ${currentUserAge} años</small>`
              : "";
          const individualControls = status.isFull
            ? '<p class="info-message">Partido completo.</p>'
            : `
            <div class="individual-join">
              <div class="individual-join-row">
                <input type="text" class="individual-note" maxlength="140" placeholder="Mensaje (opcional)" />
                <button type="button" class="btn-individual">Unirme solo</button>
              </div>
              ${ageHint}
            </div>`;
          return `
            <div class="match-card" data-match-id="${match.id}">
              <h4>Partido de ${match.modality || "Sin modalidad"}</h4>
              <p>Fecha: <strong>${date}</strong></p>
              <p>Equipo A: ${match.teamA?.name || "-"} (Capitan: ${match.teamA?.captainName || "-"})</p>
              ${match.teamB ? `<p>Equipo B: ${match.teamB.name || "Equipo B"} (Capitan: ${match.teamB.captainName || "-"})</p>` : "<p>Equipo B: buscando...</p>"}
              <p class="form-hint">Cupos confirmados: ${status.confirmedPlayers}/${status.requiredPlayers} ${missingText}</p>
              ${location}
              <div class="match-join-grid">
                ${teamControls}
                ${individualControls}
              </div>
            </div>`;
        })
        .join("");
      list.querySelectorAll(".match-card").forEach((card) => {
        const button = card.querySelector(".btn-unirse");
        const matchId = card.getAttribute("data-match-id");
        if (button) {
          button.addEventListener("click", async () => {
            const select = card.querySelector(".join-team-select");
            const teamId = select?.value;
            button.disabled = true;
            try {
              await handleJoinMatch(matchId, teamId);
            } finally {
              button.disabled = false;
            }
          });
        }
        const individualButton = card.querySelector(".btn-individual");
        if (individualButton) {
          individualButton.addEventListener("click", async () => {
            const noteInput = card.querySelector(".individual-note");
            const note = noteInput?.value || "";
            individualButton.disabled = true;
            try {
              await handleIndividualJoinRequest(matchId, note);
              if (noteInput) noteInput.value = "";
            } finally {
              individualButton.disabled = false;
            }
          });
        }
      });
    },
    (error) => {
      console.error("Error al obtener partidos disponibles:", error);
      list.innerHTML = '<p class="error-message">No se pudieron cargar los partidos.</p>';
    }
  );
  realtimeUnsubs.add(unsubscribeAvailableMatches);
};
const subscribeUserMatches = () => {
  const list = dom.userMatches;
  const adminContainer = dom.adminMatches;
  if (!list || !db || !currentUserId) return;
  list.innerHTML = "<p>Cargando tus partidos...</p>";
  if (adminContainer) {
    adminContainer.innerHTML = "<p>Cargando tus partidos organizados...</p>";
  }
  if (unsubscribeUserMatches) {
    try {
      unsubscribeUserMatches();
    } catch {}
    realtimeUnsubs.delete(unsubscribeUserMatches);
    unsubscribeUserMatches = null;
  }
  unsubscribeUserMatches = onSnapshot(
    collection(db, "matches"),
    async (snapshot) => {
      const mine = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (isMatchExpired(data)) return;
        if (
          (data.teamA && data.teamA.captainId === currentUserId) ||
          (data.teamB && data.teamB.captainId === currentUserId)
        ) {
          mine.push({ id: docSnap.id, ...data });
        }
      });
      if (!mine.length) {
        list.innerHTML = '<p class="info-message">No estas participando en ningun partido.</p>';
        if (adminContainer) {
          adminContainer.innerHTML = isAdminUser
            ? '<p class="info-message">No tienes partidos organizados.</p>'
            : '<p class="info-message">Accede con el correo autorizado para ver el panel de administrador.</p>';
        }
        return;
      }
      const teamIds = [];
      mine.forEach((match) => {
        const idA = getTeamId(match.teamA);
        const idB = getTeamId(match.teamB);
        if (idA) teamIds.push(idA);
        if (idB) teamIds.push(idB);
      });
      await ensureTeamDetails(teamIds);
      const renderStatusBlock = (status) => {
        if (!status) return "";
        const parts = [];
        if (typeof status.confirmedPlayers === "number") {
          const missingText = status.missing > 0 ? ` (faltan ${status.missing})` : "";
          parts.push(
            `<p class="form-hint">Cupos confirmados: ${status.confirmedPlayers}/${status.requiredPlayers}${missingText}</p>`
          );
        }
        if (status.needsAutoCancel) {
          parts.push(
            `<p class="status-pending">A 12h del partido y sin ${status.requiredPlayers} jugadores: se cancela y se notifica a todos.</p>`
          );
        } else if (status.isFull) {
          parts.push(
            `<p class="status-confirmed">${status.requiredPlayers} jugadores listos. Avisaremos por WhatsApp para coordinar el pago.</p>`
          );
        }
        return parts.join("");
      };

      const renderIndividuals = (match, includePhones = false) => {
        const players = Array.isArray(match.individualPlayers) ? match.individualPlayers : [];
        if (!players.length) return "";
        const items = players
          .map((p) => {
            const ageLabel = typeof p.age === "number" ? ` (${p.age} a\u00f1os)` : "";
            const phone = includePhones ? extractPhoneFromRecord(p) : "";
            const phoneLabel = includePhones ? ` - ${phone ? formatPhoneLink(phone) : "Sin tel\u00e9fono"}` : "";
            return `${p.name || "Jugador"}${ageLabel}${phoneLabel}`;
          })
          .join(", ");
        return `<p>Individuales: ${items}</p>`;
      };

      const renderUserCard = (match) => {
        const status = buildMatchStatus(match);
        const dateLabel = status.hasValidDate ? status.date.toLocaleString() : "Fecha a confirmar";
        const teamB = match.teamB
          ? `<span class="status-confirmed">${match.teamB.name} (Capitan: ${match.teamB.captainName || "-"})</span>`
          : '<span class="status-pending">Buscando Equipo B...</span>';
        return `
          <div class="match-card user-match">
            <h4>Partido: ${match.modality || "Sin modalidad"}</h4>
            <p>Fecha: <strong>${dateLabel}</strong></p>
            <p>Equipo A: ${match.teamA?.name || "Equipo A"}</p>
            <p>Equipo B: ${teamB}</p>
            ${renderIndividuals(match)}
            ${renderStatusBlock(status)}
          </div>`;
      };

      const renderAdminCard = (match) => {
        const status = buildMatchStatus(match);
        const dateLabel = status.hasValidDate ? status.date.toLocaleString() : "Fecha a confirmar";
        const teamAPhone = extractPhoneFromRecord(match.teamA);
        const teamBPhone = extractPhoneFromRecord(match.teamB);
        const teamBLabel = match.teamB
          ? `${match.teamB.name} (Capitan: ${match.teamB.captainName || "-"})`
          : "Buscando Equipo B...";
        const teamBPhoneText = match.teamB ? ` | Tel: ${formatPhoneLink(teamBPhone)}` : "";
        return `
          <div class="match-card user-match">
            <h4>Organizas: ${match.teamA?.name || "Tu partido"}</h4>
            <p>Fecha: <strong>${dateLabel}</strong></p>
            <p>Equipo A: ${match.teamA?.name || "Equipo A"} (Capitan: ${match.teamA?.captainName || "-"}) | Tel: ${formatPhoneLink(teamAPhone)}</p>
            <p>Equipo B: ${match.teamB ? `<span class="status-confirmed">${teamBLabel}</span>` : '<span class="status-pending">Buscando Equipo B...</span>'}${teamBPhoneText}</p>
            ${renderIndividuals(match, true)}
            ${renderStatusBlock(status)}
          </div>`;
      };

      list.innerHTML = mine.map((match) => renderUserCard(match)).join("");
      if (adminContainer) {
        if (!isAdminUser) {
          adminContainer.innerHTML =
            '<p class="info-message">Accede con el correo autorizado para ver el panel de administrador.</p>';
        } else {
          adminContainer.innerHTML = mine.map((match) => renderAdminCard(match)).join("");
        }
      }
    },
    (error) => {
      console.error("Error al cargar mis partidos:", error);
      list.innerHTML = '<p class="error-message">No se pudieron cargar tus partidos.</p>';
      if (adminContainer) {
        adminContainer.innerHTML =
          '<p class="error-message">No se pudieron cargar tus partidos organizados.</p>';
      }
    }
  );
  realtimeUnsubs.add(unsubscribeUserMatches);
};

const subscribeAdminMatches = () => {
  const container = dom.adminMatches;
  if (!container || !db || !isAdminUser) return;
  container.innerHTML = "<p>Cargando partidos (vista admin)...</p>";
  if (unsubscribeAdminMatches) {
    try {
      unsubscribeAdminMatches();
    } catch {}
    realtimeUnsubs.delete(unsubscribeAdminMatches);
    unsubscribeAdminMatches = null;
  }
  unsubscribeAdminMatches = onSnapshot(
    collection(db, "matches"),
    async (snapshot) => {
      const matches = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (!isMatchExpired(data)) matches.push({ id: docSnap.id, ...data });
      });
      if (!matches.length) {
        container.innerHTML = '<p class="info-message">No hay partidos creados.</p>';
        return;
      }
      const teamIds = [];
      matches.forEach((match) => {
        const idA = getTeamId(match.teamA);
        const idB = getTeamId(match.teamB);
        if (idA) teamIds.push(idA);
        if (idB) teamIds.push(idB);
      });
      await ensureTeamDetails(teamIds);
      const buildPlayersList = (label, players) => {
        if (!Array.isArray(players) || !players.length) return "";
        const items = players
          .map((p) => {
            const phone = extractPhoneFromRecord(p);
            const age = typeof p.age === "number" ? ` (${p.age} a\u00f1os)` : "";
            const name = p.name || (p.id ? `Jugador ${p.id}` : "Jugador");
            return `<li>${name}${age} - ${phone ? formatPhoneLink(phone) : "Sin tel"}</li>`;
          })
          .join("");
        return `<p>${label} (${players.length}):</p><ul class="jugadores-list">${items}</ul>`;
      };
      container.innerHTML = matches
        .map((match) => {
          const status = buildMatchStatus(match);
          const dateLabel = status.hasValidDate ? status.date.toLocaleString() : "Fecha a confirmar";
          const teamAId = getTeamId(match.teamA);
          const teamBId = getTeamId(match.teamB);
          const teamADetails = teamAId ? teamDetailsCache.get(teamAId) || {} : {};
          const teamBDetails = teamBId ? teamDetailsCache.get(teamBId) || {} : {};
          const teamAPlayers = extractPlayersFromTeam(match.teamA, teamADetails);
          const teamBPlayers = extractPlayersFromTeam(match.teamB, teamBDetails);
          const teamACount = computeTeamSize(
            match.teamA,
            teamADetails,
            teamAPlayers.length || (teamADetails.memberNames?.length || 0)
          );
          const teamBCount = computeTeamSize(
            match.teamB,
            teamBDetails,
            teamBPlayers.length || (teamBDetails.memberNames?.length || 0)
          );
          const teamAPhoneRaw =
            extractPhoneFromRecord(match.teamA) ||
            teamADetails.captainPhone ||
            (teamADetails.memberPhones?.[0] || "");
          const teamBPhoneRaw =
            (match.teamB && extractPhoneFromRecord(match.teamB)) ||
            teamBDetails.captainPhone ||
            (teamBDetails.memberPhones?.[0] || "");
          const teamAPhone = formatPhoneLink(teamAPhoneRaw);
          const teamBPhone = teamBPhoneRaw ? formatPhoneLink(teamBPhoneRaw) : "";
          const teamBLabel = match.teamB
            ? `${match.teamB.name} (Capitan: ${match.teamB.captainName || "-"})`
            : "Buscando Equipo B...";
          const individuals = buildPlayersList("Individuales", match.individualPlayers);
          const teamAList = buildPlayersList("Equipo A", teamAPlayers.length ? teamAPlayers : (teamADetails.memberNames || []).map((name, idx) => ({ name, phone: (teamADetails.memberPhones || [])[idx] || "" })));
          const teamBList = buildPlayersList("Equipo B", teamBPlayers.length ? teamBPlayers : (teamBDetails.memberNames || []).map((name, idx) => ({ name, phone: (teamBDetails.memberPhones || [])[idx] || "" })));
          const statusBlock = `
            <p class="form-hint">Cupos confirmados: ${status.confirmedPlayers}/${status.requiredPlayers} ${status.missing > 0 ? `(faltan ${status.missing})` : "(completo)"}</p>
            ${
              status.needsAutoCancel
                ? `<p class="status-pending">A 12h del partido y sin ${status.requiredPlayers} jugadores: se cancela y se notifica a todos.</p>`
                : ""
            }
            ${
              status.isFull
                ? `<p class="status-confirmed">${status.requiredPlayers} jugadores listos. Avisar por WhatsApp para coordinar pago.</p>`
                : ""
            }
          `;
          return `
            <div class="match-card user-match admin-view">
              <h4>Partido: ${match.modality || "Sin modalidad"}</h4>
              <p>Fecha: <strong>${dateLabel}</strong></p>
              <p>Equipo A: ${match.teamA?.name || teamADetails.name || "Equipo A"} (Capitan: ${match.teamA?.captainName || "-"}) | Tel: ${teamAPhone}</p>
              <p>Equipo B: ${match.teamB ? `<span class="status-confirmed">${teamBLabel}</span>` : '<span class="status-pending">Buscando Equipo B...</span>'} ${teamBPhone ? `| Tel: ${teamBPhone}` : ""}</p>
              <p class="form-hint">Equipo A: ${teamACount} jugadores | Equipo B: ${teamBCount} jugadores</p>
              ${teamAList || `<p class="form-hint">Equipo A sin lista de jugadores (detectados ${teamACount}).</p>`}
              ${teamBList || `<p class="form-hint">Equipo B sin lista de jugadores (detectados ${teamBCount}).</p>`}
              ${individuals}
              ${statusBlock}
            </div>`;
        })
        .join("");
    },
    (error) => {
      console.error("Error en vista admin de partidos:", error);
      container.innerHTML = '<p class="error-message">No se pudieron cargar los partidos.</p>';
    }
  );
  realtimeUnsubs.add(unsubscribeAdminMatches);
};
const subscribeInvitations = () => {
  const list = dom.invitationsList;
  const badge = dom.notificationCount;
  if (!list || !badge || !currentUserEmail || !db) return;
  list.innerHTML = "<p>Cargando invitaciones...</p>";
  if (unsubscribeInvitations) {
    try {
      unsubscribeInvitations();
    } catch {}
    realtimeUnsubs.delete(unsubscribeInvitations);
    unsubscribeInvitations = null;
  }
  const invitesQuery = query(
    collection(db, "invitations"),
    where("invitedEmail", "==", currentUserEmail),
    where("status", "==", "pending")
  );
  unsubscribeInvitations = onSnapshot(
    invitesQuery,
    (snapshot) => {
      const invites = [];
      snapshot.forEach((docSnap) => invites.push({ id: docSnap.id, ...docSnap.data() }));
      badge.textContent = invites.length;
      badge.classList.toggle("hidden", invites.length === 0);
      if (!invites.length) {
        list.innerHTML = '<p class="info-message">No tienes invitaciones pendientes.</p>';
        return;
      }
      list.innerHTML = invites
        .map(
          (invite) => `
            <div class="invite-card">
              <h4>Invitacion al equipo: ${invite.teamName}</h4>
              <p>Invitado por: ${invite.inviterName || "Capitan"}</p>
              <div class="invite-actions">
                <button class="btn-primary" data-invite="${invite.id}" data-response="accepted">Aceptar</button>
                <button class="btn-secundario" data-invite="${invite.id}" data-response="rejected">Rechazar</button>
              </div>
            </div>`
        )
        .join("");
      list.querySelectorAll(".invite-actions button").forEach((button) => {
        button.addEventListener("click", async (event) => {
          const { invite, response } = event.currentTarget.dataset;
          await respondInvitation(invite, response);
        });
      });
    },
    (error) => {
      console.error("Error al obtener invitaciones:", error);
      list.innerHTML = '<p class="error-message">No se pudieron cargar las invitaciones.</p>';
    }
  );
  realtimeUnsubs.add(unsubscribeInvitations);
};

const respondInvitation = async (inviteId, response) => {
  try {
    if (isAdminUser) {
      showGlobalMessage("Modo administrador: no puedes gestionar invitaciones como jugador.", "info");
      return;
    }
    if (response === "accepted" && !requireVerifiedPhone("Verifica tu telefono para aceptar la invitacion.")) {
      return;
    }
    const result = await callApiWithRetry("/equipos/invite/respond", {
      method: "POST",
      body: { inviteId, response }
    });
    showGlobalMessage(result?.mensaje || "Invitacion actualizada.", "exito");
    if (!isAdminUser) {
      await ensureUserTeams(true);
      await Promise.all([
        loadTeamsForCreation(true),
        loadUserTeamsForProfile(true)
      ]);
      subscribeAvailableMatches();
    }
  } catch (error) {
    console.error("Error al responder invitacion:", error);
    const msg = error?.data?.mensaje || error.message;
    showGlobalMessage(`Error al responder: ${msg}`, "error");
  }
};

const loadUserTeamsForProfile = async (force = false) => {
  const list = dom.userTeamsList;
  if (!list || !currentUserId) return;
  list.innerHTML = "<p>Cargando tus equipos...</p>";
  const teams = await ensureUserTeams(force);
  if (!teams.length) {
    list.innerHTML = '<p>No eres miembro de ningun equipo.</p>';
    return;
  }
  list.innerHTML = teams
    .map((team) => {
      const members = (team.memberNames || []).map((name) => `<li>${name}</li>`).join("");
      const shieldUrl = getTeamShieldUrl(team);
      const colorLabel =
        typeof team.jerseyColorText === "string" && team.jerseyColorText.trim()
          ? `<span class="team-chip">${team.jerseyColorText}</span>`
          : "";
      return `
        <div class="equipo-card">
          <div class="equipo-card-head">
            <div class="team-avatar" style="border-color: ${formatTeamColor(team.jerseyColor)}33;">
              <img src="${shieldUrl}" alt="Escudo de ${team.name}" loading="lazy" />
            </div>
            <div>
              <h4>${team.name}</h4>
              ${colorLabel}
            </div>
          </div>
          <p class="team-members">Miembros (${team.memberNames?.length || 0}):</p>
          <ul class="jugadores-list">${members}</ul>
          <button class="btn-invitar" data-team-id="${team.id}" data-team-name="${team.name}">Invitar jugador</button>
        </div>`;
    })
    .join("");
  list.querySelectorAll(".btn-invitar").forEach((button) => {
    button.addEventListener("click", () => {
      handleInvitePlayer(button.dataset.teamId, button.dataset.teamName);
    });
  });
};

const renderTeamDirectoryCard = (team, options = {}) => {
  const accent = formatTeamColor(team?.jerseyColor);
  const accentSoft = `${accent}33`;
  const accentMuted = `${accent}18`;
  const shieldUrl = getTeamShieldUrl(team);
  const membersCount = team?.membersCount ?? (Array.isArray(team?.members) ? team.members.length : 0);
  const description = team?.description || "Sin descripcion disponible.";
  const colorLabel = team?.jerseyColorText || "Color no indicado";
  const owner = team?.ownerName ? `Capitan: ${team.ownerName}` : "";
  const name = team?.name || "Equipo";
  const memberNames =
    Array.isArray(team?.memberNames) && team.memberNames.length
      ? `<p class="team-member-names">Jugadores: ${team.memberNames.join(", ")}</p>`
      : "";
  const { canRequestJoin = false, isOwner = false, isMember = false } = options;
  let actionBlock = "";
  if (isOwner) {
    actionBlock = '<p class="team-card-note">Sos el capit\u00e1n de este equipo.</p>';
  } else if (isMember) {
    actionBlock = '<p class="team-card-note">Ya formas parte de este equipo.</p>';
  } else if (canRequestJoin) {
    actionBlock = `
        <div class="team-card-actions">
          <button class="btn-primary btn-join-team" data-team-id="${team.id}" data-team-name="${name}">Pedir unirme</button>
          <p class="team-card-note">El capit\u00e1n deber\u00e1 aceptarte.</p>
        </div>`;
  }
  return `
    <article class="team-card" style="--team-accent:${accent}; --team-accent-soft:${accentSoft}; --team-accent-muted:${accentMuted};">
      <div class="team-card-media">
        <img src="${shieldUrl}" alt="Escudo de ${name}" loading="lazy" />
      </div>
      <div class="team-card-body">
        <h4>${name}</h4>
        <p>${description}</p>
        <div class="team-card-meta">
          <span>${membersCount} jugadores</span>
          <span>${colorLabel}</span>
        </div>
        ${owner ? `<p class="team-owner">${owner}</p>` : ""}
        ${memberNames}
        ${actionBlock}
      </div>
    </article>`;
};

const loadTeamsDirectory = async (force = false) => {
  const container = dom.teamsDirectory;
  if (!container) return;
  if (!auth?.currentUser) {
    container.innerHTML = '<p>Inicia sesion para ver los equipos.</p>';
    return;
  }
  container.innerHTML = "<p>Cargando equipos...</p>";
  try {
    await ensureUserTeams(force);
    const myTeamIds = new Set(userTeamsCache.map((team) => team.id));
    const response = await callApiWithRetry("/equipos?limit=60");
    const equipos = Array.isArray(response?.equipos) ? response.equipos : [];
    if (!equipos.length) {
      container.innerHTML = '<p class="info-message">Todavia no hay equipos publicados.</p>';
      return;
    }
    container.innerHTML = equipos
      .map((team) =>
        renderTeamDirectoryCard(team, {
          isOwner: team.ownerId === currentUserId,
          isMember: myTeamIds.has(team.id),
          canRequestJoin: !myTeamIds.has(team.id) && team.ownerId !== currentUserId
        })
      )
      .join("");
    container.querySelectorAll(".btn-join-team").forEach((button) => {
      button.addEventListener("click", async () => {
        const { teamId, teamName } = button.dataset;
        button.disabled = true;
        try {
          await handleTeamJoinRequest(teamId, teamName, button);
        } finally {
          if (!button.classList.contains("sent-request")) {
            button.disabled = false;
          }
        }
      });
    });
  } catch (error) {
    console.error("Error al listar equipos:", error);
    container.innerHTML = '<p class="error-message">No se pudieron cargar los equipos.</p>';
  }
};

const handleInvitePlayer = async (teamId, teamName) => {
  const email = prompt(`Ingresa el email del jugador para invitar a ${teamName}:`);
  if (!email || !email.trim()) return;
  try {
    const result = await callApiWithRetry("/equipos/invite", {
      method: "POST",
      body: { teamId, playerEmail: email.trim(), teamName }
    });
    showGlobalMessage(result?.mensaje || "Invitacion enviada.", "exito");
  } catch (error) {
    console.error("Error al enviar invitacion:", error);
    const msg = error?.data?.mensaje || error.message;
    showGlobalMessage(`Error al invitar: ${msg}`, "error");
  }
};

const handleTeamJoinRequest = async (teamId, teamName, button) => {
  if (isAdminUser) {
    showGlobalMessage("Modo administrador: no puedes unirte a equipos.", "info");
    return;
  }
  if (!auth?.currentUser) {
    showGlobalMessage("Inicia sesion para unirte a un equipo.", "info");
    return;
  }
  if (!requireVerifiedPhone("Verifica tu telefono para unirte a un equipo.")) return;
  if (!teamId) return;
  const note =
    prompt(`Contale al capitan por que queres unirte a ${teamName || "el equipo"} (opcional):`) ||
    "";
  try {
    const result = await callApiWithRetry("/equipos/join-request", {
      method: "POST",
      body: { teamId, message: note.trim() }
    });
    showGlobalMessage(result?.mensaje || "Solicitud enviada al capitan.", "exito");
    if (button) {
      button.textContent = "Solicitud enviada";
      button.classList.add("sent-request");
    }
  } catch (error) {
    console.error("Error al solicitar ingreso al equipo:", error);
    const msg = error?.data?.mensaje || error.message;
    showGlobalMessage(`No se pudo enviar la solicitud: ${msg}`, "error");
  }
};

const subscribeJoinRequests = () => {
  const list = dom.joinRequestsList;
  if (!list || !db || !currentUserId) return;
  list.innerHTML = "<p>Cargando solicitudes...</p>";
  if (unsubscribeJoinRequests) {
    try {
      unsubscribeJoinRequests();
    } catch {}
    realtimeUnsubs.delete(unsubscribeJoinRequests);
    unsubscribeJoinRequests = null;
  }
  const requestsQuery = query(
    collection(db, "teamJoinRequests"),
    where("teamOwnerId", "==", currentUserId),
    where("status", "==", "pending")
  );
  unsubscribeJoinRequests = onSnapshot(
    requestsQuery,
    (snapshot) => {
      const requests = [];
      snapshot.forEach((docSnap) => requests.push({ id: docSnap.id, ...docSnap.data() }));
      if (!requests.length) {
        list.innerHTML = '<p>No tienes solicitudes pendientes.</p>';
        return;
      }
      list.innerHTML = requests
        .map(
          (request) => `
            <div class="join-request-card">
              <h4>${request.userName || "Jugador"} quiere unirse a ${request.teamName}</h4>
              <p>Mensaje: ${request.message || "Sin mensaje"}</p>
              <div class="join-request-actions">
                <button class="btn-primary" data-request="${request.id}" data-action="accepted">Aceptar</button>
                <button class="btn-secundario" data-request="${request.id}" data-action="rejected">Rechazar</button>
              </div>
            </div>`
        )
        .join("");
      list.querySelectorAll(".join-request-actions button").forEach((button) => {
        button.addEventListener("click", async (event) => {
          const { request, action } = event.currentTarget.dataset;
          try {
            const result = await callApiWithRetry("/equipos/join-request/respond", {
              method: "POST",
              body: { requestId: request, action }
            });
            showGlobalMessage(result?.mensaje || "Solicitud actualizada.", "exito");
            await ensureUserTeams(true);
            await Promise.all([
              loadTeamsForCreation(true),
              loadUserTeamsForProfile(true)
            ]);
          } catch (error) {
            console.error("Error al responder solicitud:", error);
            const msg = error?.data?.mensaje || error.message;
            showGlobalMessage(`Error al responder: ${msg}`, "error");
          }
        });
      });
    },
    (error) => {
      console.error("Error al obtener solicitudes:", error);
      list.innerHTML = '<p class="error-message">No se pudieron cargar las solicitudes.</p>';
    }
  );
  realtimeUnsubs.add(unsubscribeJoinRequests);
};

const subscribeIndividualRequests = () => {
  const lists = [dom.individualRequestsList, dom.individualRequestsInline].filter(Boolean);
  if (!lists.length || !db || !currentUserId) return;
  lists.forEach((container) => {
    container.innerHTML = "<p>Cargando solicitudes...</p>";
  });
  if (unsubscribeIndividualRequests) {
    try {
      unsubscribeIndividualRequests();
    } catch {}
    realtimeUnsubs.delete(unsubscribeIndividualRequests);
    unsubscribeIndividualRequests = null;
  }
  const requestsQuery = query(
    collection(db, "individualRequests"),
    where("captainId", "==", currentUserId),
    where("status", "==", "pending")
  );
  unsubscribeIndividualRequests = onSnapshot(
    requestsQuery,
    (snapshot) => {
      const requests = [];
      snapshot.forEach((docSnap) => requests.push({ id: docSnap.id, ...docSnap.data() }));
      if (!requests.length) {
        lists.forEach((container) => {
          container.innerHTML = '<p>No tienes solicitudes individuales pendientes.</p>';
        });
        return;
      }
      const html = requests
        .map((request) => {
          const dateLabel = request.matchDateTime
            ? new Date(request.matchDateTime).toLocaleString()
            : "";
          const location = request.locationName ? ` | ${request.locationName}` : "";
          const ageLabel =
            typeof request.requesterAge === "number" ? `<p class="form-hint">Edad: ${request.requesterAge} a\u00f1os</p>` : "";
          const message = request.message
            ? `<p class="form-hint">Mensaje: ${request.message}</p>`
            : "";
          return `
            <div class="join-request-card">
              <h4>${request.requesterName || "Jugador"} quiere sumarse a tu partido</h4>
              <p>${request.teamAName || "Tu partido"}${dateLabel ? ` - ${dateLabel}` : ""}${location}</p>
              ${ageLabel}
              ${message}
              <div class="join-request-actions">
                <button class="btn-primary" data-request="${request.id}" data-match="${request.matchId || ""}" data-action="accepted">Aceptar</button>
                <button class="btn-secundario" data-request="${request.id}" data-match="${request.matchId || ""}" data-action="rejected">Rechazar</button>
              </div>
            </div>`;
        })
        .join("");
      lists.forEach((container) => {
        container.innerHTML = html;
        container.querySelectorAll(".join-request-actions button").forEach((button) => {
          button.addEventListener("click", async (event) => {
            const { request, action, match } = event.currentTarget.dataset;
            if (!request || !action) {
              showGlobalMessage("Solicitud inválida. Refresca la página.", "info");
              return;
            }
            if (!match) {
              showGlobalMessage("Esta solicitud no tiene partido asociado. No se puede responder.", "info");
              return;
            }
            try {
              const result = await callApiWithRetry("/partidos/individual/respond", {
                method: "POST",
                body: { requestId: request, action, matchId: match || undefined }
              });
              showGlobalMessage(result?.mensaje || "Solicitud actualizada.", "exito");
            } catch (error) {
              console.error("Error al responder solicitud individual:", error);
              const msg = error?.data?.mensaje || error.message;
              showGlobalMessage(`Error al responder: ${msg}`, "error");
            }
          });
        });
      });
    },
    (error) => {
      console.error("Error al obtener solicitudes individuales:", error);
      lists.forEach((container) => {
        container.innerHTML = '<p class="error-message">No se pudieron cargar las solicitudes.</p>';
      });
    }
  );
  realtimeUnsubs.add(unsubscribeIndividualRequests);
};

const loadAllData = async (force = false) => {
  if (!auth?.currentUser || !db) return;
  if (!force && hasLoadedInitialData) return;
  await ensureUserTeams(force);
  await Promise.all([
    loadTeamsForCreation(force),
    loadUserTeamsForProfile(force),
    loadTeamsDirectory(force)
  ]);
  subscribeAvailableMatches();
  subscribeUserMatches();
  subscribeInvitations();
  subscribeJoinRequests();
  subscribeIndividualRequests();
  if (isAdminUser) {
    subscribeAdminMatches();
  }
  hasLoadedInitialData = true;
};

const refreshProfile = async () => {
  if (!auth?.currentUser) return;
  try {
    const profile = await callApiWithRetry("/auth/profile");
    currentUserName = profile?.nombre || currentUserName;
    const isAdmin = isAdminUser;
    currentUserPhone = isAdmin
      ? ADMIN_AUTO_PHONE
      : profile?.phoneNumber || auth.currentUser.phoneNumber || null;
    currentUserAge = isAdmin
      ? ADMIN_AUTO_AGE
      : normalizeAgeValue(profile?.edad ?? profile?.age ?? currentUserAge);
    const updatedPhoto =
      profile?.photoUrl || auth.currentUser?.photoURL || currentUserPhotoUrl || null;
    currentUserPhotoUrl = updatedPhoto;
    updateProfileCard({
      nombre: profile?.nombre,
      edad: currentUserAge,
      posicion: profile?.posicion,
      descripcion: profile?.descripcion,
      photoUrl: currentUserPhotoUrl
    });
    updatePhoneDisplay();
    setPhoneGateState(Boolean(currentUserPhone) || isAdmin);
    if (!isAdmin) {
      if (dom.profileAge) dom.profileAge.value = currentUserAge ?? "";
      if (dom.profilePosition) dom.profilePosition.value = profile?.posicion || "";
      if (dom.profileDescription) dom.profileDescription.value = profile?.descripcion || "";
    }
  } catch (error) {
    console.warn("No se pudo cargar el perfil:", error);
  }
};

const saveProfileExtras = async (event) => {
  event.preventDefault();
  if (isAdminUser) {
    showGlobalMessage("Modo administrador de solo lectura. Perfil bloqueado.", "info");
    return;
  }
  if (!auth?.currentUser || !db) {
    showGlobalMessage("Debes iniciar sesion para actualizar tu perfil.", "info");
    return;
  }
  const position = dom.profilePosition?.value || "";
  const description = dom.profileDescription?.value?.trim() || "";
  const ageInput = dom.profileAge?.value;
  const age =
    ageInput === undefined || ageInput === null || ageInput === ""
      ? null
      : normalizeAgeValue(ageInput);
  if (ageInput && age === null) {
    showGlobalMessage("Ingresa una edad valida (10 a 90).", "info");
    return;
  }
  try {
    const updates = {
      posicion: position || null,
      descripcion: description || null,
      edad: age,
      age,
      updatedAt: Date.now()
    };
    await Promise.all([
      setDoc(doc(db, "usuarios", currentUserId), updates, { merge: true }),
      setDoc(doc(db, "users", currentUserId), updates, { merge: true })
    ]);
    currentUserAge = age;
    updateProfileCard({
      posicion: position,
      descripcion: description,
      nombre: currentUserName,
      edad: age
    });
    if (dom.profileFeedback) {
      dom.profileFeedback.textContent = "Perfil actualizado.";
      dom.profileFeedback.className = "mensaje mensaje-exito";
      dom.profileFeedback.classList.remove("hidden");
    }
  } catch (error) {
    console.error("Error al guardar perfil:", error);
    if (dom.profileFeedback) {
      dom.profileFeedback.textContent = error?.message || "No se pudo guardar el perfil.";
      dom.profileFeedback.className = "mensaje mensaje-error";
      dom.profileFeedback.classList.remove("hidden");
    }
  }
};

const handleProfilePhotoSelected = async () => {
  if (!auth?.currentUser || !currentUserId || !db) {
    showGlobalMessage("Debes iniciar sesion para actualizar tu foto.", "info");
    if (dom.profilePhotoInput) dom.profilePhotoInput.value = "";
    return;
  }
  const file = dom.profilePhotoInput?.files?.[0];
  if (!file) return;
  const validationError = validateImageFile(file);
  if (validationError) {
    showGlobalMessage(validationError, "info");
    dom.profilePhotoInput.value = "";
    return;
  }
  const safeName = sanitizeFileName(file.name);
  const storagePath = `users/${currentUserId}/profilePhotos/${Date.now()}-${safeName}`;
  try {
    dom.profilePhotoInput.disabled = true;
    showGlobalMessage("Subiendo foto...", "info");
    const downloadUrl = await uploadImageFile(file, storagePath);
    currentUserPhotoUrl = downloadUrl;
    updateProfilePhotoPreview(downloadUrl);
    const updates = {
      photoUrl: downloadUrl,
      updatedAt: Date.now()
    };
    await Promise.all([
      setDoc(doc(db, "usuarios", currentUserId), updates, { merge: true }),
      setDoc(doc(db, "users", currentUserId), updates, { merge: true })
    ]);
    showGlobalMessage("Foto de perfil actualizada.", "exito");
  } catch (error) {
    console.error("Error al actualizar la foto de perfil:", error);
    showGlobalMessage("No se pudo actualizar la foto.", "error");
  } finally {
    if (dom.profilePhotoInput) {
      dom.profilePhotoInput.disabled = false;
      dom.profilePhotoInput.value = "";
    }
  }
};

const setupCreateTeamForm = () => {
  if (!dom.createTeamForm) return;
  dom.createTeamColor?.addEventListener("input", () => {
    if (dom.createTeamColorPreview) dom.createTeamColorPreview.textContent = dom.createTeamColor.value;
  });
  dom.createTeamForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isAdminUser) {
      showGlobalMessage("Modo administrador de solo lectura. No puedes crear equipos.", "info");
      return;
    }
    if (!auth?.currentUser) {
      showGlobalMessage("Debes iniciar sesion para crear un equipo.", "info");
      return;
    }
    const teamName = dom.createTeamName?.value?.trim();
    const description = dom.createTeamDescription?.value?.trim();
    const colorName = dom.createTeamColorName?.value?.trim();
    const jerseyColor = dom.createTeamColor?.value?.trim();
    if (!teamName || !description || !colorName || !jerseyColor) {
      showGlobalMessage("Completa todos los campos del equipo.", "info");
      return;
    }
    try {
      let shieldUrl = null;
      const shieldFile = dom.createTeamShield?.files?.[0];
      if (shieldFile) {
        const validationError = validateImageFile(shieldFile);
        if (validationError) {
          showGlobalMessage(validationError, "info");
          if (dom.createTeamShield) dom.createTeamShield.value = "";
          return;
        }
        const safeName = sanitizeFileName(shieldFile.name);
        const storagePath = `teams/${currentUserId}/teamShields/${Date.now()}-${safeName}`;
        showGlobalMessage("Subiendo escudo del equipo...", "info");
        shieldUrl = await uploadImageFile(shieldFile, storagePath);
      }
      const body = {
        teamName,
        description,
        jerseyColorText: colorName,
        jerseyColor
      };
      if (shieldUrl) {
        body.shieldUrl = shieldUrl;
      }
      const result = await callApiWithRetry("/equipos", {
        method: "POST",
        body
      });
      showGlobalMessage(result?.mensaje || "Equipo creado.", "exito");
      dom.createTeamForm.reset();
      if (dom.createTeamColorPreview) dom.createTeamColorPreview.textContent = "#000000";
      if (dom.createTeamShield) dom.createTeamShield.value = "";
      await ensureUserTeams(true);
      await Promise.all([
        loadTeamsForCreation(true),
        loadUserTeamsForProfile(true),
        loadTeamsDirectory(true)
      ]);
    } catch (error) {
      console.error("Error al crear equipo:", error);
      const msg = error?.data?.mensaje || error.message;
      showGlobalMessage(`Error al crear equipo: ${msg}`, "error");
    }
  });
};
const setupAuthForms = () => {
  const refreshAdminRegisterState = () => {
    const wantsAdmin = Boolean(dom.registerAdminFlag?.checked);
    const emailValue = normalizeEmail(dom.registerEmail?.value || "");
    const allowed = wantsAdmin && isAllowedAdminEmail(emailValue);
    const toggleField = (field, hide, required) => {
      if (!field) return;
      field.classList.toggle("hidden", hide);
      if (hide) {
        field.removeAttribute("required");
      } else if (required) {
        field.setAttribute("required", "required");
      }
    };
    const defaults = allowed ? deriveAdminDefaults(emailValue) : null;
    toggleField(dom.registerName, allowed, true);
    toggleField(dom.registerPhone, allowed, true);
    toggleField(dom.registerAge, allowed, true);
    if (allowed && defaults) {
      if (dom.registerName) dom.registerName.value = defaults.name;
      if (dom.registerPhone) dom.registerPhone.value = defaults.phone;
      if (dom.registerAge) dom.registerAge.value = defaults.age;
    }
  };

  dom.registerAdminFlag?.addEventListener("change", refreshAdminRegisterState);
  dom.registerEmail?.addEventListener("input", refreshAdminRegisterState);
  refreshAdminRegisterState();

  dom.registerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nombre = dom.registerName?.value?.trim();
    const email = dom.registerEmail?.value?.trim();
    const password = dom.registerPassword?.value || "";
    const phoneRaw = dom.registerPhone?.value || "";
    const wantsAdmin = Boolean(dom.registerAdminFlag?.checked);
    const normalizedEmail = normalizeEmail(email);
    const isAdminAllowed = wantsAdmin && isAllowedAdminEmail(normalizedEmail);
    const adminDefaults = isAdminAllowed ? deriveAdminDefaults(normalizedEmail) : null;
    const phoneNumber = adminDefaults?.phone || normalizePhoneInput(phoneRaw);
    const age = adminDefaults?.age ?? normalizeAgeValue(dom.registerAge?.value);
    const finalName = adminDefaults?.name || nombre;
    if (!email || !password) {
      showGlobalMessage("Ingresa email y contrasena.", "info");
      return;
    }
    if (!isAdminAllowed && (!finalName || !phoneNumber || age === null)) {
      showGlobalMessage("Completa todos los campos del registro.", "info");
      return;
    }
    if (wantsAdmin && !isAdminAllowed) {
      showGlobalMessage("Ese correo no está habilitado para administradores.", "info");
      return;
    }
    try {
      if (wantsAdmin && isAllowedAdminEmail(normalizedEmail)) {
        showGlobalMessage("Registro de administrador: usaremos este correo autorizado.", "info");
      }
      await callApiWithRetry("/auth/register", {
        method: "POST",
        body: { nombre: finalName || "Administrador", email, password, phoneNumber, edad: age },
        authRequired: false
      });
      await signInWithEmailAndPassword(auth, email, password);
      showGlobalMessage("Registro completo.", "exito");
    } catch (error) {
      console.error("Error al registrar:", error);
      const msg = error?.data?.mensaje || error.message;
      showGlobalMessage(`No se pudo registrar: ${msg}`, "error");
    }
  });

  dom.loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = dom.loginForm?.querySelector("button[type='submit']");
    const email = canonicalizeEmail(dom.loginEmail?.value);
    const password = dom.loginPassword?.value || "";
    if (!email || !password) {
      showGlobalMessage("Ingresa tu email y contrasena.", "info");
      return;
    }
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.setAttribute("aria-busy", "true");
      }
      await signInWithEmailAndPassword(auth, email, password);
      showGlobalMessage("Sesion iniciada.", "exito");
    } catch (error) {
      console.error("Error al iniciar sesion:", error);
      showGlobalMessage(describeAuthError(error), "error");
    }
    finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute("aria-busy");
      }
    }
  });

  dom.showLoginLink?.addEventListener("click", (event) => {
    event.preventDefault();
    toggleHidden(dom.registerForm, true);
    toggleHidden(dom.loginForm, false);
  });

  dom.showRegisterLink?.addEventListener("click", (event) => {
    event.preventDefault();
    toggleHidden(dom.registerForm, false);
    toggleHidden(dom.loginForm, true);
  });

  dom.googleButton?.addEventListener("click", async () => {
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(auth, provider);
      showGlobalMessage("Sesion iniciada con Google.", "exito");
    } catch (error) {
      console.error("Error en Google Sign-In:", error);
      showGlobalMessage("No se pudo iniciar con Google.", "error");
    }
  });

  dom.logoutButton?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      await logoutServerSession();
    } catch (error) {
      console.error("Error al cerrar sesion:", error);
    }
  });
};

const formatSectionId = (value) => {
  if (!value) return null;
  let sectionId = value.replace(/^#/, "");
  if (!sectionId.endsWith(SECTION_SUFFIX)) sectionId = `${sectionId}${SECTION_SUFFIX}`;
  return sectionId;
};

const navigateTo = (target, options = {}) => {
  const sectionId = formatSectionId(target);
  if (!sectionId) return;
  const section = byId(sectionId);
  if (!section) {
    console.warn("Seccion no encontrada:", sectionId);
    return;
  }
  dom.sections.forEach((el) => {
    const isActive = el.id === sectionId;
    el.classList.toggle("hidden", !isActive);
    el.classList.toggle("active-section", isActive);
  });
  const normalized = sectionId.replace(SECTION_SUFFIX, "");
  dom.navLinks.forEach((link) => {
    const href = (link.getAttribute("href") || "").replace(/^#/, "");
    const isActive = href === normalized;
    link.classList.toggle("active", isActive);
    link.setAttribute("aria-current", isActive ? "page" : "false");
  });
  if (!options.skipHashUpdate) {
    const nextHash = `#${normalized}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }
  if (!options.keepMenuOpen && typeof closeMobileMenu === "function") {
    closeMobileMenu();
  }
};

window.navigateTo = navigateTo;

const setupNavigation = () => {
  const desktopQuery = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 769px)") : null;
  const isDesktopViewport = () => {
    if (desktopQuery) return desktopQuery.matches;
    return window.innerWidth >= 769;
  };
  const hideCreationForAdmin = () => {};
  const setMenuState = (open) => {
    const isDesktop = isDesktopViewport();
    if (!isDesktop && open) {
      const targetTop = Math.max((dom.layout?.offsetTop ?? 0) - 24, 0);
      if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
        try {
          window.scrollTo({ top: targetTop, behavior: "smooth" });
        } catch (error) {
          window.scrollTo(0, targetTop);
        }
      }
    }
    dom.body?.classList.toggle("mobile-menu-open", open);
    dom.sidebar?.classList.toggle("is-open", open);
    dom.mobileMenuToggle?.setAttribute("aria-expanded", open ? "true" : "false");
    hideCreationForAdmin(open);
    if (dom.mobileSidebarBackdrop) {
      dom.mobileSidebarBackdrop.classList.toggle("hidden", !open);
      dom.mobileSidebarBackdrop.setAttribute("aria-hidden", open ? "false" : "true");
    }
    if (dom.sidebar) {
      if (!isDesktop) {
        if (open) {
          dom.sidebar.removeAttribute("inert");
        } else {
          dom.sidebar.setAttribute("inert", "true");
          // Mover el foco al botón de menú para evitar focos dentro de elementos ocultos
          if (dom.mobileMenuToggle && typeof dom.mobileMenuToggle.focus === "function") {
            dom.mobileMenuToggle.focus();
          }
        }
      } else {
        dom.sidebar.removeAttribute("inert");
      }
      dom.sidebar.setAttribute("aria-hidden", "false");
    }
    if (!isDesktop && open) {
      if (dom.sidebar) dom.sidebar.scrollTop = 0;
      if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
        const target = Math.max((window.scrollY || window.pageYOffset || 0) - 120, 0);
        try {
          window.scrollTo({ top: target, behavior: "smooth" });
        } catch (error) {
          window.scrollTo(0, target);
        }
      }
    }
  };
  closeMobileMenu = () => setMenuState(false);
  const bindToggle = (element, handler) => {
    if (!element || typeof handler !== "function") return;
    let pointerHandled = false;
    element.addEventListener(
      "pointerup",
      (event) => {
        if (event.pointerType === "touch" || event.pointerType === "pen") {
          pointerHandled = true;
          event.preventDefault();
          handler(event);
        }
      },
      { passive: false }
    );
    element.addEventListener("click", (event) => {
      if (pointerHandled) {
        pointerHandled = false;
        return;
      }
      event.preventDefault();
      handler(event);
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handler(event);
      }
    });
  };
  bindToggle(dom.mobileMenuToggle, () => {
    const open = !dom.body?.classList.contains("mobile-menu-open");
    setMenuState(open);
  });
  bindToggle(dom.mobileMenuClose, () => setMenuState(false));
  bindToggle(dom.mobileSidebarBackdrop, () => setMenuState(false));
  const isOutsideSidebar = (target) => {
    if (!target || !dom.sidebar) return false;
    if (dom.sidebar.contains(target)) return false;
    if (dom.mobileMenuToggle?.contains(target)) return false;
    if (dom.mobileMenuClose?.contains(target)) return false;
    return true;
  };
  const bindOutsideClose = (eventName) => {
    document.addEventListener(eventName, (event) => {
      if (!dom.body?.classList.contains("mobile-menu-open")) return;
      if (!isDesktopViewport()) return;
      const target = event.target;
      if (isOutsideSidebar(target)) {
        setMenuState(false);
      }
    });
  };
  bindOutsideClose("click");
  bindOutsideClose("touchstart");
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMenuState(false);
      closePhoneModal();
    }
  });
  if (desktopQuery?.addEventListener) {
    desktopQuery.addEventListener("change", (event) => {
      if (event.matches) setMenuState(false);
    });
  } else if (desktopQuery?.addListener) {
    desktopQuery.addListener((event) => {
      if (event.matches) setMenuState(false);
    });
  }
  dom.navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href") || "";
      if (!href.startsWith("#")) return;
      event.preventDefault();
      navigateTo(href.slice(1));
      setMenuState(false);
    });
  });
  setMenuState(false);
  window.addEventListener("hashchange", () => {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash) navigateTo(hash, { skipHashUpdate: true });
  });
};

const showPhoneModalMessage = (text, type = "info") => {
  if (!dom.phoneModalMessage) return;
  dom.phoneModalMessage.textContent = text;
  dom.phoneModalMessage.className = "mensaje";
  dom.phoneModalMessage.classList.add(`mensaje-${type}`);
  dom.phoneModalMessage.classList.remove("hidden");
};

const openPhoneModal = () => {
  dom.phoneModal?.classList.remove("hidden");
  dom.phoneModalMessage?.classList.add("hidden");
};

const closePhoneModal = () => {
  dom.phoneModal?.classList.add("hidden");
  dom.phoneModalMessage?.classList.add("hidden");
  dom.phoneModalCodeSection?.classList.add("hidden");
  if (dom.phoneModalCode) dom.phoneModalCode.value = "";
};

const checkPhoneAvailability = async (phoneNumber, excludeUid) => {
  const response = await callApiWithRetry("/auth/phone/check", {
    method: "POST",
    body: { phoneNumber, excludeUid },
    authRequired: false
  });
  return response?.available !== false && response?.disponible !== false;
};

const ensurePhoneRecaptcha = () => {
  if (phoneRecaptchaVerifier) return phoneRecaptchaVerifier;
  if (!auth) throw new Error("Auth no inicializado.");
  phoneRecaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
  return phoneRecaptchaVerifier;
};

const getMatchById = async (matchId) => {
  if (!matchId || !db) return null;
  const snap = await getDoc(doc(db, "matches", matchId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
};

const ensureTeamDetails = async (teamIds = []) => {
  const missingIds = teamIds.filter((id) => id && !teamDetailsCache.has(id));
  if (!missingIds.length || !db) return;
  const snapshots = await Promise.all(missingIds.map((id) => getDoc(doc(db, "teams", id))));
  snapshots.forEach((snap) => {
    if (snap.exists()) {
      const data = snap.data();
      const memberPhones = Array.isArray(data.memberPhones) ? data.memberPhones.map((phone) => normalizeAnyPhone(phone)) : [];
      const memberNames = Array.isArray(data.memberNames) ? data.memberNames.filter(Boolean) : [];
      const members = Array.isArray(data.members) ? data.members.filter(Boolean) : [];
      teamDetailsCache.set(snap.id, {
        memberNames: memberNames.length ? memberNames : members,
        members,
        memberPhones,
        captainPhone: normalizeAnyPhone(
          data.captainPhone ||
            data.captainPhoneNumber ||
            data.contactPhone ||
            (data.captain && (data.captain.phone || data.captain.phoneNumber))
        ),
        jerseyColor: data.jerseyColor,
        name: data.name
      });
    }
  });
};

const isUserAlreadyInMatch = (match) => {
  if (!match || !currentUserId) return false;
  const matchTeams = [match.teamA, match.teamB];
  const checkTeam = (team) => {
    if (!team) return false;
    const members = [
      team.memberIds,
      team.members,
      team.players?.map((p) => p?.uid || p?.userId || p?.id),
      team.roster?.map((p) => p?.uid || p?.userId || p?.id)
    ]
      .filter(Boolean)
      .flat();
    return members.some((id) => id === currentUserId);
  };
  if (matchTeams.some(checkTeam)) return true;
  if (Array.isArray(match.individualPlayers)) {
    return match.individualPlayers.some(
      (p) =>
        p?.uid === currentUserId ||
        p?.userId === currentUserId ||
        p?.id === currentUserId ||
        (p?.email && p.email === currentUserEmail)
    );
  }
  return false;
};

const setupPhoneVerification = () => {
  const bindOpen = (button) => button?.addEventListener("click", () => openPhoneModal());
  bindOpen(dom.phoneModalOpen);
  bindOpen(dom.phoneBlockerOpen);
  dom.phoneModalCancel?.addEventListener("click", () => closePhoneModal());

  dom.phoneModalSend?.addEventListener("click", async () => {
    if (!auth?.currentUser) {
      showPhoneModalMessage("Inicia sesion para continuar.", "error");
      return;
    }
    const normalizedPhone = normalizePhoneInput(dom.phoneModalNumber?.value || "");
    if (!normalizedPhone) {
      showPhoneModalMessage("Ingresa un numero valido.", "error");
      return;
    }
    const activeUid = currentUserId || auth.currentUser.uid;
    let available = false;
    try {
      available = await checkPhoneAvailability(normalizedPhone, activeUid);
    } catch (error) {
      console.error("No se pudo validar el telefono:", error);
      showPhoneModalMessage(error?.message || "No se pudo validar el telefono.", "error");
      return;
    }
    if (!available) {
      showPhoneModalMessage("Ese numero ya esta asociado a otra cuenta.", "error");
      return;
    }
    try {
      dom.phoneModalSend.disabled = true;
      showPhoneModalMessage("Preparando verificacion...", "info");
      await callApiWithRetry("/auth/phone/pending", {
        method: "POST",
        body: { phoneNumber: normalizedPhone }
      });
      currentUserPhone = normalizedPhone;
      updatePhoneDisplay();
      dom.phoneModalCodeSection?.classList.add("hidden");
      if (dom.phoneModalCode) dom.phoneModalCode.value = "";
      pendingPhoneNumber = normalizedPhone;
      showPhoneModalMessage("Enviando SMS de verificacion...", "info");
      const verifier = ensurePhoneRecaptcha();
      phoneConfirmationResult = await linkWithPhoneNumber(auth.currentUser, normalizedPhone, verifier);
      dom.phoneModalCodeSection?.classList.remove("hidden");
      showPhoneModalMessage("Codigo enviado. Revisa tus mensajes.", "info");
    } catch (error) {
      console.error("Error al enviar SMS:", error);
      pendingPhoneNumber = "";
      phoneConfirmationResult = null;
      let message = error?.message || "No pudimos enviar el codigo.";
      if (error?.code === "auth/credential-already-in-use") {
        message = "Ese numero ya esta verificado por otra cuenta.";
      } else if (error?.code === "auth/provider-already-linked") {
        message = "Tu cuenta ya tiene un numero verificado.";
      }
      showPhoneModalMessage(message, "error");
    } finally {
      dom.phoneModalSend.disabled = false;
    }
  });

  dom.phoneModalConfirm?.addEventListener("click", async () => {
    if (!auth?.currentUser) {
      showPhoneModalMessage("Inicia sesion para continuar.", "error");
      return;
    }
    if (!phoneConfirmationResult || !pendingPhoneNumber) {
      showPhoneModalMessage("Primero solicita un codigo.", "error");
      return;
    }
    const code = dom.phoneModalCode?.value?.trim() || "";
    if (code.length < 6) {
      showPhoneModalMessage("Ingresa el codigo completo.", "error");
      return;
    }
    dom.phoneModalConfirm.disabled = true;
    try {
      await phoneConfirmationResult.confirm(code);
      try {
        await callApiWithRetry("/auth/phone", {
          method: "POST",
          body: { phoneNumber: pendingPhoneNumber }
        });
      } catch (apiError) {
        console.error("Error al sincronizar telefono:", apiError);
      }
      await auth.currentUser.reload().catch(() => {});
      currentUserPhone = auth.currentUser.phoneNumber || pendingPhoneNumber;
      pendingPhoneNumber = "";
      phoneConfirmationResult = null;
      updatePhoneDisplay();
      setPhoneGateState(true);
      hasLoadedInitialData = false;
      loadAllData(true).catch((err) => console.error("Error al recargar datos tras verificar telefono:", err));
      showPhoneModalMessage("Telefono verificado.", "exito");
      setTimeout(() => closePhoneModal(), 800);
      showGlobalMessage("Telefono verificado correctamente.", "exito");
    } catch (error) {
      console.error("Error al confirmar SMS:", error);
      let message = error?.message || "El codigo no es valido.";
      if (error?.code === "auth/invalid-verification-code") {
        message = "El codigo ingresado no es correcto.";
      }
      showPhoneModalMessage(message, "error");
    } finally {
      dom.phoneModalConfirm.disabled = false;
    }
  });
};
const handleCreateButtonState = () => {
  const btn = dom.btnCrear;
  if (!btn) return;
  const teamId = dom.crearTeamSelect?.value;
  const dateTime = dom.crearFecha?.value;
  const tipoFutbol = dom.crearTipo?.value;
  const requiresPitch = tipoFutbol === "Futbol 7";
  const hasPitch = !requiresPitch || Boolean(dom.pitchSelect?.value);
  let leadTimeOk = true;
  if (dateTime) {
    const parsed = new Date(dateTime);
    leadTimeOk = !Number.isNaN(parsed.getTime()) && parsed.getTime() - Date.now() >= 24 * 60 * 60 * 1000;
  }
  btn.disabled = !(teamId && dateTime && tipoFutbol && hasPitch && leadTimeOk);
  if (!leadTimeOk) {
    btn.title = "Debes crear el partido con 24 horas de anticipacion";
  } else {
    btn.removeAttribute("title");
  }
};

const setupCreateMatchForm = () => {
  if (dom.crearFecha) {
    const enforceMinDate = () => {
      const minDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const pad = (num) => String(num).padStart(2, "0");
      const formatted = `${minDate.getFullYear()}-${pad(minDate.getMonth() + 1)}-${pad(minDate.getDate())}T${pad(minDate.getHours())}:${pad(minDate.getMinutes())}`;
      dom.crearFecha.min = formatted;
    };
    enforceMinDate();
    dom.crearFecha.addEventListener("focus", enforceMinDate);
  }
  if (dom.crearPartidoForm) {
    dom.crearPartidoForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleCreateMatch();
    });
  } else {
    dom.btnCrear?.addEventListener("click", handleCreateMatch);
  }
  ["crearPartidoConEquipo", "fecha", "tipoFutbol"].forEach((id) => {
    const el = byId(id);
    el?.addEventListener("change", handleCreateButtonState);
    el?.addEventListener("input", handleCreateButtonState);
  });
  dom.crearTipo?.addEventListener("change", () => {
    syncPitchSection();
    handleCreateButtonState();
  });
  dom.pitchSelect?.addEventListener("change", () => {
    updatePitchDetail();
    handleCreateButtonState();
  });
  syncPitchSection();
  handleCreateButtonState();
  prefetchPitchOptions();
};

const setupProfileForm = () => {
  dom.profileForm?.addEventListener("submit", saveProfileExtras);
  dom.profilePhotoInput?.addEventListener("change", handleProfilePhotoSelected);
};

const postFirebaseConfigToServiceWorker = async (registration) => {
  if (!registration || !firebaseConfig) return null;
  const target = registration.active || registration.waiting || registration.installing;
  if (!target) return null;
  try {
    target.postMessage({ type: "FIREBASE_CONFIG", payload: firebaseConfig });
  } catch (error) {
    console.warn("No se pudo enviar la config de Firebase al service worker:", error);
  }
  return registration;
};

const registerMessagingServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
    await postFirebaseConfigToServiceWorker(registration);
    return registration;
  } catch (error) {
    console.warn('No se pudo registrar el SW de messaging:', error);
    return null;
  }
};

const resolveMessagingRegistration = async () => {
  if (!('serviceWorker' in navigator)) return null;
  if (messagingSwRegistration) {
    await postFirebaseConfigToServiceWorker(messagingSwRegistration);
    return messagingSwRegistration;
  }
  let registration = await navigator.serviceWorker.getRegistration();
  if (!registration && navigator.serviceWorker?.ready) {
    try {
      registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(() => resolve(null), 3000))
      ]);
    } catch {
      registration = null;
    }
  }
  if (!registration) {
    registration = await registerMessagingServiceWorker();
  }
  if (registration) {
    messagingSwRegistration = registration;
    await postFirebaseConfigToServiceWorker(registration);
  }
  return messagingSwRegistration;
};

const getNotificationPermission = () => {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission || "default";
};

const updateNotificationPermissionLabel = () => {
  if (!dom.notificationPermissionLabel) return;
  const status = getNotificationPermission();
  let text = "Sin activar";
  if (status === "granted") text = "Activadas";
  else if (status === "denied") text = "Bloqueadas";
  else if (status === "unsupported") text = "No soportadas";
  dom.notificationPermissionLabel.textContent = text;
};

const requestNotificationPermission = async () => {
  if (typeof Notification === "undefined") {
    showGlobalMessage("Tu navegador no soporta notificaciones push.", "info");
    return null;
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    showGlobalMessage("Activa notificaciones solo desde HTTPS o la PWA instalada.", "info");
    return null;
  }
  if (!messaging || !messaging.vapidKey) {
    showGlobalMessage("Configura la clave VAPID para habilitar notificaciones.", "info");
    return null;
  }
  try {
    const result = await Notification.requestPermission();
    if (result !== "granted") {
      updateNotificationPermissionLabel();
      showGlobalMessage("No se activaron las notificaciones.", "info");
      return null;
    }
    const registration = await resolveMessagingRegistration();
    if (!registration) {
      showGlobalMessage("No se pudo preparar el service worker de notificaciones.", "info");
      return null;
    }
    const token = await getToken(messaging, {
      vapidKey: messaging.vapidKey,
      serviceWorkerRegistration: registration || undefined
    });
    if (token) {
      messagingToken = token;
      localStorage.setItem(NOTIFICATION_PREF_KEY, "granted");
      await callApiWithRetry("/auth/push-token", {
        method: "POST",
        body: { token }
      });
      showGlobalMessage("Notificaciones activadas. Recibirás avisos en tu dispositivo.", "exito");
    }
    return token;
  } catch (error) {
    console.error("No se pudo solicitar permiso de notificaciones:", error);
    showGlobalMessage("No se pudo activar notificaciones.", "error");
    return null;
  } finally {
    updateNotificationPermissionLabel();
  }
};


const setupNotificationPreference = () => {
  updateNotificationPermissionLabel();
  const canUse =
    typeof Notification !== "undefined" &&
    (typeof window === "undefined" || window.isSecureContext) &&
    messaging &&
    messaging.vapidKey;
  if (dom.enableNotificationsButton) {
    dom.enableNotificationsButton.disabled = !canUse;
    dom.enableNotificationsButton.addEventListener("click", () => {
      requestNotificationPermission();
    });
  }
  if (getNotificationPermission() === "granted" && !messagingToken) {
    requestNotificationPermission().catch((error) =>
      console.warn("No se pudo reactivar token de notificaciones:", error)
    );
  }
  if (messaging) {
    onMessage(messaging, (payload) => {
      if (payload?.notification?.title) {
        showGlobalMessage(payload.notification.title, "info");
      }
    });
  }
};

const setupPrivacyBanner = () => {
  const hasConsent = localStorage.getItem(PRIVACY_CONSENT_KEY) === "accepted";
  if (!hasConsent) {
    dom.privacyBanner?.classList.remove("hidden");
  }
  dom.acceptPrivacy?.addEventListener("click", () => {
    localStorage.setItem(PRIVACY_CONSENT_KEY, "accepted");
    dom.privacyBanner?.classList.add("hidden");
    showGlobalMessage("Preferencias de privacidad guardadas.", "info");
  });
  dom.rejectPrivacy?.addEventListener("click", () => {
    localStorage.setItem(PRIVACY_CONSENT_KEY, "later");
    dom.privacyBanner?.classList.add("hidden");
  });
};

const setupAuthObserver = () => {
  onAuthStateChanged(auth, async (user) => {
    cleanupRealtime();
    if (user) {
      currentUserId = user.uid;
      currentUserEmail = user.email || null;
      currentUserName = user.displayName || user.email || "Jugador";
      currentUserPhone = user.phoneNumber || null;
      currentUserPhotoUrl = user.photoURL || null;
      await setAdminFromUser(user);
      updateProfileCard({ nombre: currentUserName, photoUrl: currentUserPhotoUrl });
      updatePhoneDisplay();
      toggleAppView(true);
      await syncServerSession();
      await refreshProfile();
      hasLoadedInitialData = false;
      await loadAllData(true);
    } else {
      currentUserId = null;
      currentUserEmail = null;
      currentUserName = null;
      currentUserPhone = null;
      currentUserAge = null;
      currentUserPhotoUrl = null;
      userTeamsCache = [];
      hasLoadedInitialData = false;
      await setAdminFromUser(null);
      await logoutServerSession();
      toggleAppView(false);
      navigateTo("explorar-section", { skipHashUpdate: true });
      if (dom.teamsDirectory) {
        dom.teamsDirectory.innerHTML = '<p>Inicia sesion para ver los equipos.</p>';
      }
      updateProfilePhotoPreview(null);
      if (dom.profileAge) dom.profileAge.value = "";
    }
  });
};

const initApp = () => {
  initFirebase();
  cacheDom();
  setupNavigation();
  setupAuthForms();
  setupCreateTeamForm();
  setupProfileForm();
  setupPhoneVerification();
  setupCreateMatchForm();
  setupNotificationPreference();
  setupPrivacyBanner();
  setupAuthObserver();
  const initialRoute = window.location.hash ? window.location.hash.slice(1) : "explorar";
  navigateTo(initialRoute, { skipHashUpdate: true });
};

document.addEventListener("DOMContentLoaded", () => {
  try {
    initApp();
  } catch (error) {
    console.error("No se pudo inicializar la app:", error);
    showGlobalMessage(error.message || "No se pudo inicializar la aplicacion.", "error");
  }
});





