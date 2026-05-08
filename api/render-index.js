// SSR — 학생앱 / 진입 시 학원명 박힌 HTML 응답
//
// 동작:
//   GET / → vercel.json rewrites 가 /api/render-index 로 라우팅
//   ?academy=xxx 또는 cookie 또는 default 로 학원 ID 결정
//   Firestore academies/{id}.name fetch
//   public/_app.html 읽어 <title> / apple-mobile-web-app-title /
//   application-name 메타를 학원명으로 치환 후 응답
//
// iOS Safari [홈화면 추가] 다이얼로그가 페이지 첫 HTML 응답 시점의 정적
// title/메타를 캡처하므로, SSR 시점부터 학원명이 박혀있어야 학원명 자동 노출.

const fs = require('fs');
const path = require('path');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function _normalizePrivateKey(raw) {
  if (!raw) return '';
  let k = String(raw).trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  k = k.replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
  return k;
}

function _ensureAdminApp() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: _normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    }),
  });
}

// HTML escape (XSS 방지)
function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 정적 HTML template 캐시 (cold start 후엔 재사용)
let _templateCache = null;
function _loadTemplate() {
  if (_templateCache) return _templateCache;
  // public/_app.html — Vercel 배포 시 함수와 함께 패키징
  const p = path.join(process.cwd(), 'public', '_app.html');
  _templateCache = fs.readFileSync(p, 'utf-8');
  return _templateCache;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    // 1) 학원 ID 결정 — URL ?academy= > 쿠키 > default
    let academyId = '';
    try {
      const url = new URL(req.url, 'http://localhost');
      academyId = url.searchParams.get('academy') || '';
    } catch (_) {}
    if (!academyId) {
      const m = (req.headers.cookie || '').match(/academyId=([^;]+)/);
      if (m) {
        try { academyId = decodeURIComponent(m[1]); } catch (_) {}
      }
    }
    if (!academyId) academyId = 'default';

    // 2) 학원명 fetch
    let academyName = 'LexiAI';
    try {
      _ensureAdminApp();
      const db = getFirestore();
      const snap = await db.doc('academies/' + academyId).get();
      if (snap.exists) {
        const a = snap.data();
        if (a && a.name) academyName = a.name;
      }
    } catch (e) {
      // Firestore 실패 시 LexiAI default
    }

    // 3) HTML template 읽어 치환
    let html;
    try {
      html = _loadTemplate();
    } catch (e) {
      // template 읽기 실패 시 명확한 fallback (페이지 못 여는 사고 방지)
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(500).send(`<!DOCTYPE html><html><body>Template load error: ${e.message}</body></html>`);
      return;
    }

    const safeName = _esc(academyName);

    // <title> 교체
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${safeName}</title>`);

    // apple-mobile-web-app-title (name 속성 앞 / content 속성 앞 둘 다 처리)
    html = html.replace(
      /(<meta\s[^>]*name=["']apple-mobile-web-app-title["'][^>]*content=["'])[^"']*(["'])/i,
      `$1${safeName}$2`
    );
    html = html.replace(
      /(<meta\s[^>]*content=["'])[^"']*(["'][^>]*name=["']apple-mobile-web-app-title["'])/i,
      `$1${safeName}$2`
    );

    // application-name
    html = html.replace(
      /(<meta\s[^>]*name=["']application-name["'][^>]*content=["'])[^"']*(["'])/i,
      `$1${safeName}$2`
    );
    html = html.replace(
      /(<meta\s[^>]*content=["'])[^"']*(["'][^>]*name=["']application-name["'])/i,
      `$1${safeName}$2`
    );

    // manifest link href — ?academy={id} 박힘 (iOS 가 manifest.name 우선 사용 → 학원명 응답 보장)
    const manifestUrl = `/api/manifest?academy=${encodeURIComponent(academyId)}`;
    html = html.replace(
      /(<link\s[^>]*rel=["']manifest["'][^>]*href=["'])[^"']*(["'])/i,
      `$1${manifestUrl}$2`
    );
    html = html.replace(
      /(<link\s[^>]*href=["'])[^"']*(["'][^>]*rel=["']manifest["'])/i,
      `$1${manifestUrl}$2`
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // CDN 학원별 캐시 — Vercel Edge 가 academy 별로 cache key 분리
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    res.setHeader('Vary', 'Cookie');
    // X-Ssr-Academy 헤더 제거 — HTTP 헤더는 ASCII 만 허용 (한글 학원명 throw)
    res.status(200).send(html);
  } catch (e) {
    console.error('[render-index]', e);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(`<!DOCTYPE html><html><body>SSR error: ${_esc(e.message)}</body></html>`);
  }
};
