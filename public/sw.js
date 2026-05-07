// 큰소리 영어 Service Worker — 앱 쉘 캐시 + 일반 fetch 만
// FCM 백그라운드 알림은 firebase-messaging-sw.js (Firebase 자동 등록 SW) 가 전담.

const CACHE_NAME = 'kunsori-v320';
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512_.png',
];

// 설치: 앱 쉘 캐시
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// 활성화: 구버전 캐시 삭제 후 모든 클라이언트에 리로드 요청
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))
  );
});

// 요청 처리
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;

  // Firebase / API / Storage(로고) 요청은 항상 네트워크 (로고는 학원장 변경 즉시 반영 필요)
  if (url.includes('firestore') || url.includes('firebase') || url.includes('/api/') || url.includes('storage.googleapis.com')) return;

  // 앱 쉘(HTML, CSS, JS, 아이콘): 네트워크 우선, 실패 시 캐시 (배포 즉시 반영)
  const isAppShell = APP_SHELL.some(path => url.endsWith(path) || url === self.location.origin + path);
  if (isAppShell) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 그 외: 네트워크 우선, 실패 시 캐시
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
