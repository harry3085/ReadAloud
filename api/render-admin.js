// SSR — 학원장 앱 /admin/ 진입 시 학원명 박힌 HTML 응답
//
// render-index.js 와 동일 패턴. 차이점:
//   - template: public/admin/_app.html
//   - title / 메타 suffix: ' 관리자'
//   - manifest URL: /api/manifest?academy={id}&admin=1
//
// 학원장 [📱 바로가기] PWA 추가 시 '큰소리 영어 관리자' 자동 노출.

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

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let _templateCache = null;
function _loadTemplate() {
  if (_templateCache) return _templateCache;
  const p = path.join(process.cwd(), 'public', 'admin', '_app.html');
  _templateCache = fs.readFileSync(p, 'utf-8');
  return _templateCache;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    // 학원 ID 결정 — URL ?academy= > 쿠키 > default
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

    // 학원명 fetch
    let academyName = 'LexiAI';
    try {
      _ensureAdminApp();
      const db = getFirestore();
      const snap = await db.doc('academies/' + academyId).get();
      if (snap.exists) {
        const a = snap.data();
        if (a && a.name) academyName = a.name;
      }
    } catch (_) {}

    let html;
    try {
      html = _loadTemplate();
    } catch (e) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(500).send(`<!DOCTYPE html><html><body>Template load error: ${e.message}</body></html>`);
      return;
    }

    const safeName = _esc(academyName);
    const adminTitle = `${safeName} 관리자`;

    // <title> 교체
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${adminTitle}</title>`);

    // apple-mobile-web-app-title
    html = html.replace(
      /(<meta\s[^>]*name=["']apple-mobile-web-app-title["'][^>]*content=["'])[^"']*(["'])/i,
      `$1${adminTitle}$2`
    );
    html = html.replace(
      /(<meta\s[^>]*content=["'])[^"']*(["'][^>]*name=["']apple-mobile-web-app-title["'])/i,
      `$1${adminTitle}$2`
    );

    // application-name
    html = html.replace(
      /(<meta\s[^>]*name=["']application-name["'][^>]*content=["'])[^"']*(["'])/i,
      `$1${adminTitle}$2`
    );
    html = html.replace(
      /(<meta\s[^>]*content=["'])[^"']*(["'][^>]*name=["']application-name["'])/i,
      `$1${adminTitle}$2`
    );

    // manifest link href — 학원별 + admin=1 (학생 PWA 와 별개 ID)
    const manifestUrl = `/api/manifest?academy=${encodeURIComponent(academyId)}&admin=1`;
    html = html.replace(
      /(<link\s[^>]*rel=["']manifest["'][^>]*href=["'])[^"']*(["'])/i,
      `$1${manifestUrl}$2`
    );
    html = html.replace(
      /(<link\s[^>]*href=["'])[^"']*(["'][^>]*rel=["']manifest["'])/i,
      `$1${manifestUrl}$2`
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    res.setHeader('Vary', 'Cookie');
    res.status(200).send(html);
  } catch (e) {
    console.error('[render-admin]', e);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(`<!DOCTYPE html><html><body>SSR error: ${_esc(e.message)}</body></html>`);
  }
};
