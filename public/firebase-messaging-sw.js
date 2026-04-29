// FCM 전용 서비스워커 (firebase-messaging-sw.js)
// 이 파일명은 Firebase FCM 이 자동으로 찾는 고정 이름이에요.
//
// onBackgroundMessage 핸들러는 의도적으로 등록하지 않음 — Firebase SDK 가
// webpush.notification payload 로부터 자동으로 OS 알림을 1회만 표시.
// 수동 showNotification() 호출하면 자동표시와 합쳐져 2번 뜨는 버그 발생.
//
// notificationclick 만 핸들링 (알림 클릭 → 앱 열기/포커스).

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAb5d8w9mI5_hpcoBFcWnG5tE1TF_8guw8",
  authDomain: "readaloud-51113.firebaseapp.com",
  projectId: "readaloud-51113",
  storageBucket: "readaloud-51113.firebasestorage.app",
  messagingSenderId: "944153888350",
  appId: "1:944153888350:web:47091c0771d20be8ea56cf",
});

// firebase.messaging() 호출만으로 SDK 가 push 이벤트를 가로채서 자동 표시 등록.
// onBackgroundMessage 핸들러는 등록하지 않음 (자동 표시와 중복되어 알림 2번 뜸).
firebase.messaging();

// 알림 클릭 → 앱 열기 / 포커스
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});
