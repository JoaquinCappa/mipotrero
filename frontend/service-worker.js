const CACHE_VERSION = "2025-11-26-06";
const CACHE_NAME = `mi-potrero-static-${CACHE_VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/app-icon-16.png",
  "./icons/app-icon-32.png",
  "./icons/app-icon-180.png",
  "./icons/app-icon-192.png",
  "./icons/app-icon-512.png",
  "./icons/pwa-icon.svg"
];

const FIREBASE_MESSAGING_SCRIPTS = [
  "https://www.gstatic.com/firebasejs/11.6.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging-compat.js"
];
let messagingReady = false;

const initFirebaseMessaging = (config) => {
  if (messagingReady || !config) return;
  try {
    importScripts(...FIREBASE_MESSAGING_SCRIPTS);
    if (!self.firebase?.apps?.length) {
      self.firebase.initializeApp(config);
    }
    const messaging = self.firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const title = payload.notification?.title || "Mi Potrero";
      const options = {
        body: payload.notification?.body,
        icon: "/icons/app-icon-192.png",
        data: payload.data || {}
      };
      self.registration.showNotification(title, options);
    });
    messagingReady = true;
  } catch (error) {
    console.warn("No se pudo inicializar Firebase Messaging en SW principal:", error);
  }
};

if (self.__firebase_config) {
  initFirebaseMessaging(self.__firebase_config);
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "FIREBASE_CONFIG") {
    self.__firebase_config = event.data.payload;
    messagingReady = false;
    initFirebaseMessaging(self.__firebase_config);
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((oldKey) => caches.delete(oldKey))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const networkFirst =
    request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/style.css");

  if (networkFirst) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
    )
  );
});
