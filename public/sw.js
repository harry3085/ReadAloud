// 큰소리 영어 Service Worker + FCM 백그라운드 알림
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const CACHE_NAME = 'kunsori-v2';
const STATIC = ['/', '/index.html', '/manifest.json'];

firebase.initializeApp({
  apiKey: "AIzaSyAb5d8w9mI5_hpcoBFcWnG5tE1TF_8guw8",
  authDomain: "readaloud-51113.firebaseapp.com",
  projectId: "readaloud-51113",
  storageBucket: "readaloud-51113.firebasestorage.app",
  messagingSenderId: "944153888350",
  appId: "1:944153888350:web:47091c0771d20be8ea56cf",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || '큰소리 영어', {
    body: body || '',
    icon: icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    data: payload.data || {},
  });
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('firestore') || e.request.url.includes('firebase')) return;
  if (e.request.url.includes('/api/')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
