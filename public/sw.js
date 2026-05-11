// 큰소리 영어 Service Worker — 앱 쉘 캐시 + HTML 학원명 주입
// FCM 백그라운드 알림은 firebase-messaging-sw.js (Firebase 자동 등록 SW) 가 전담.
//
// HTML 학원명 주입 (T1):
//   navigation 요청 (HTML) 가로채서 <title> / apple-mobile-web-app-title /
//   application-name 메타를 학원명으로 교체. iOS Safari [홈화면 추가] 시
//   학원명 자동 노출 보장 (페이지 첫 응답 시점부터 학원명 박힘).

const CACHE_NAME = 'kunsori-v428';
const ACADEMY_META_CACHE = 'academy-meta-v1';   // 학원명 캐시 전용 (활성화 시 보존)
const APP_SHELL = [
  // / 와 /index.html 은 SSR (api/render-index) 응답이라 캐시 X
  '/style.css',
  '/js/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512_.png',
];
// manifest.json / api/manifest 는 캐시 X (학원별 동적 응답)

// ── 학원명 인메모리 캐시 ───────────────────────────────
// 앱 → SW postMessage 로 채워짐 + manifest API fallback
const _academyNames = {};

// 설치: 앱 쉘 캐시
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// 활성화: 구버전 캐시 삭제 (academy-meta-v1 은 보존) + 모든 클라이언트에 리로드 요청
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== ACADEMY_META_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))
  );
});

// ── 학원명 조회 (3단계 우선순위) ─────────────────────
async function _getAcademyName(academyId) {
  if (!academyId || academyId === 'undefined' || academyId === 'null') return null;

  // 1순위: 인메모리 캐시 (가장 빠름)
  if (_academyNames[academyId]) return _academyNames[academyId];

  // 2순위: Cache Storage (SW 재시작 후에도 유지)
  try {
    const cache = await caches.open(ACADEMY_META_CACHE);
    const cached = await cache.match(`/_academy-name-cache/${academyId}`);
    if (cached) {
      const data = await cached.json();
      // 5분 이내 캐시만 유효 (학원장이 학원명 변경 시 빠른 반영)
      if (Date.now() - (data.cachedAt || 0) < 5 * 60 * 1000) {
        _academyNames[academyId] = data.name;
        return data.name;
      }
    }
  } catch (_) {}

  // 3순위: manifest API fetch (이미 학원별 동적 응답 확인됨)
  try {
    const res = await fetch(`/api/manifest?academy=${encodeURIComponent(academyId)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const name = data.name || data.short_name || null;
    if (name) {
      _academyNames[academyId] = name;
      try {
        const cache = await caches.open(ACADEMY_META_CACHE);
        await cache.put(
          `/_academy-name-cache/${academyId}`,
          new Response(JSON.stringify({ name, cachedAt: Date.now() }), {
            headers: { 'Content-Type': 'application/json' },
          })
        );
      } catch (_) {}
    }
    return name;
  } catch (_) {
    return null;
  }
}

// ── 쿠키에서 academyId 추출 (현재 미사용 — URL param 우선) ──
function _getAcademyIdFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/academyId=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ── URL 에서 academyId 추출 ──────────────────────────
function _getAcademyIdFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.searchParams.get('academy') || null;
  } catch (_) {
    return null;
  }
}

// ── HTML 에 학원명 주입 ──────────────────────────────
// 어떤 에러든 원본 응답 통과 (페이지 안 열리는 사고 방지)
async function _injectAcademyName(request) {
  try {
    // 학원 ID 결정: URL > 쿠키 > default
    const academyId =
      _getAcademyIdFromUrl(request.url) ||
      _getAcademyIdFromCookie(request.headers.get('cookie')) ||
      'default';

    // 네트워크에서 원본 HTML fetch
    const originalResponse = await fetch(request);

    // HTML 이 아니면 통과 (Content-Type 검사)
    const ct = originalResponse.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return originalResponse;

    // 학원명 조회
    const academyName = await _getAcademyName(academyId);
    if (!academyName) return originalResponse;

    // HTML 텍스트 변환 (response 복제 — 실패 시 원본 그대로 반환 가능하게)
    const cloned = originalResponse.clone();
    let html;
    try {
      html = await cloned.text();
    } catch (_) {
      return originalResponse;
    }

    // XSS 방지 escape
    const safeName = academyName
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // 학원장 페이지면 ' 관리자' suffix
    const isAdmin = (new URL(request.url).pathname).startsWith('/admin');
    const finalName = isAdmin ? `${safeName} 관리자` : safeName;

    // <title> 교체
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${finalName}</title>`);

    // apple-mobile-web-app-title 메타 (name·content 순서 둘 다 처리)
    html = html.replace(
      /(<meta\s[^>]*name=["']apple-mobile-web-app-title["'][^>]*content=["'])[^"']*(["'])/i,
      `$1${finalName}$2`
    );
    html = html.replace(
      /(<meta\s[^>]*content=["'])[^"']*(["'][^>]*name=["']apple-mobile-web-app-title["'])/i,
      `$1${finalName}$2`
    );

    // application-name 메타
    html = html.replace(
      /(<meta\s[^>]*name=["']application-name["'][^>]*content=["'])[^"']*(["'])/i,
      `$1${finalName}$2`
    );
    html = html.replace(
      /(<meta\s[^>]*content=["'])[^"']*(["'][^>]*name=["']application-name["'])/i,
      `$1${finalName}$2`
    );

    // 응답 헤더 — 원본 헤더 복사 + content-encoding/length 제거 (우리가 압축 풀고 길이 바뀜)
    const newHeaders = new Headers(originalResponse.headers);
    newHeaders.delete('content-encoding');
    newHeaders.delete('content-length');
    newHeaders.set('content-type', 'text/html; charset=utf-8');
    newHeaders.set('x-sw-academy', finalName);
    newHeaders.set('x-sw-version', 'v359');

    return new Response(html, {
      status: originalResponse.status,
      statusText: originalResponse.statusText,
      headers: newHeaders,
    });
  } catch (e) {
    // 어떤 에러든 fail-safe — 원본 fetch 그대로 (페이지 못 여는 사고 방지)
    try { return await fetch(request); } catch (_) { throw e; }
  }
}

// ── 앱 → SW 학원명 전달 ──────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACADEMY_NAME_UPDATE') {
    const { academyId, name } = event.data;
    if (academyId && name) {
      _academyNames[academyId] = name;
      // Cache Storage 영구 저장
      caches.open(ACADEMY_META_CACHE).then(cache => {
        cache.put(
          `/_academy-name-cache/${academyId}`,
          new Response(JSON.stringify({ name, cachedAt: Date.now() }), {
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }).catch(() => {});
    }
  }
});

// 요청 처리
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const req = e.request;
  const url = new URL(req.url);

  // ── HTML navigation 요청 → 학원명 주입 ──────────────
  // navigate 모드 또는 accept: text/html. 같은 origin. API/SW/정적 자원 제외.
  const accept = req.headers.get('accept') || '';
  const isNavigation =
    (req.mode === 'navigate' || accept.includes('text/html')) &&
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/icons/') &&
    !url.pathname.endsWith('.js') &&
    !url.pathname.endsWith('.css') &&
    !url.pathname.endsWith('.png') &&
    !url.pathname.endsWith('.jpg') &&
    !url.pathname.endsWith('.json') &&
    !url.pathname.endsWith('sw.js') &&
    !url.pathname.endsWith('firebase-messaging-sw.js');

  if (isNavigation) {
    // SW 학원명 주입 일시 비활성화 — TypeError 로 페이지 못 여는 사고 방지.
    // 기본 fetch 통과로 페이지 정상 노출 보장. 학원명 주입은 별도 방식 검토.
    // _injectAcademyName 함수는 그대로 두되 호출 안 함 (캐시 로직 message handler 에서 사용).
    return;
  }

  const urlStr = req.url;

  // Firebase / API / Storage(로고) / manifest 요청은 항상 네트워크
  if (urlStr.includes('firestore') || urlStr.includes('firebase') || urlStr.includes('/api/') || urlStr.includes('storage.googleapis.com') || urlStr.endsWith('/manifest.json')) return;

  // 앱 쉘(HTML, CSS, JS, 아이콘): 네트워크 우선, 실패 시 캐시 (배포 즉시 반영)
  const isAppShell = APP_SHELL.some(path => urlStr.endsWith(path) || urlStr === self.location.origin + path);
  if (isAppShell) {
    e.respondWith(
      fetch(req).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, clone));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 그 외: 네트워크 우선, 실패 시 캐시
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
