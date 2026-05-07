// PWA manifest 동적 생성 — academy query parameter 로 학원별 로고·테마컬러 반영
//
// GET /api/manifest?academy=raloud2
//   → { name, short_name, theme_color, icons: [...] } (학원 브랜딩 반영)
// GET /api/manifest
//   → LexiAI 기본값
//
// Free 플랜 학원은 LexiAI 기본 (브랜딩 무시) — 의도된 정책
// 캐시: 5분 (학원장이 로고 변경 후 빠르게 반영)

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { BRANDING_PRESETS, DEFAULT_PRESET_ID } = require('./_lib/branding-presets-cjs');

function normalizePrivateKey(raw) {
  if (!raw) return '';
  let k = String(raw).trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  k = k.replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
  return k;
}

function initAdmin() {
  if (getApps().length > 0) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase Admin 환경변수 누락');
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

const DEFAULT_NAME = 'LexiAI';
const DEFAULT_SHORT = 'LexiAI';
const DEFAULT_PRESET = BRANDING_PRESETS[DEFAULT_PRESET_ID];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const academyId = String(req.query.academy || '').trim();

    let name = DEFAULT_NAME;
    let shortName = DEFAULT_SHORT;
    let preset = DEFAULT_PRESET;
    let logo192 = '/icons/icon-192.png';
    let logo512 = '/icons/icon-512.png';

    // LexiAI 기본 (super_admin 갱신값) 1회 fetch — 모든 학원의 fallback
    let lexi = {};
    try {
      initAdmin();
      const lexiDoc = await getFirestore().doc('appConfig/branding').get();
      if (lexiDoc.exists) lexi = lexiDoc.data();
    } catch (_) {}

    // LexiAI 기본 적용 (학원 미지정·Free·Lite+ 미설정 fallback)
    if (lexi.defaultPresetId && BRANDING_PRESETS[lexi.defaultPresetId]) preset = BRANDING_PRESETS[lexi.defaultPresetId];
    if (lexi.defaultLogo192Url) logo192 = lexi.defaultLogo192Url;
    if (lexi.defaultLogo512Url) logo512 = lexi.defaultLogo512Url;
    if (lexi.defaultAppName) {
      name = lexi.defaultAppName;
      shortName = name.length > 12 ? name.slice(0, 12) : name;
    }

    if (academyId) {
      try {
        const acadDoc = await getFirestore().doc('academies/' + academyId).get();
        if (acadDoc.exists) {
          const a = acadDoc.data();
          const planId = a.planId || 'free';
          const branding = a.branding || {};

          name = a.name || name;
          shortName = name.length > 12 ? name.slice(0, 12) : name;

          // Lite+ 만 학원 자체 brand 우선. Free 는 LexiAI 기본 (위에서 이미 설정됨).
          if (planId !== 'free') {
            const pid = branding.presetId;
            if (pid && BRANDING_PRESETS[pid]) preset = BRANDING_PRESETS[pid];
            if (branding.logo192Url) logo192 = branding.logo192Url;
            if (branding.logo512Url) logo512 = branding.logo512Url;
          }
        }
      } catch (e) {
        console.warn('[manifest] academy lookup failed:', e.message);
      }
    }

    const manifest = {
      name,
      short_name: shortName,
      description: `${name} 학습 앱`,
      start_url: academyId ? `/?academy=${encodeURIComponent(academyId)}` : '/',
      display: 'standalone',
      background_color: preset.primaryBg,
      theme_color: preset.primary,
      orientation: 'portrait',
      icons: [
        { src: logo192, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: logo512, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    };

    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json(manifest);
  } catch (e) {
    console.error('[manifest]', e);
    res.status(500).json({ error: e.message });
  }
};
