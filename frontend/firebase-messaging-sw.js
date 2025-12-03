/* global importScripts, firebase */
importScripts("https://www.gstatic.com/firebasejs/11.6.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging-compat.js");

// Config will be injected by hosting; fallback to self.__firebase_config if present
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "FIREBASE_CONFIG") {
    const config = event.data.payload;
    if (config && !firebase.apps.length) {
      firebase.initializeApp(config);
      firebase.messaging();
    }
  }
});

try {
  if (!firebase.apps.length && self.__firebase_config) {
    firebase.initializeApp(self.__firebase_config);
  }
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || "Mi Potrero";
    const options = {
      body: payload.notification?.body,
      icon: "/icons/app-icon-192.png",
      data: payload.data || {}
    };
    self.registration.showNotification(title, options);
  });
} catch (error) {
  console.warn("No se pudo inicializar Firebase Messaging en SW:", error);
}
