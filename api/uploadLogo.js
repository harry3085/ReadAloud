// 학원 로고 업로드 — PNG 받아 192/512 자동 리사이즈 후 Storage 저장
//
// 요청 body: { idToken: string, imageBase64: 'data:image/png;base64,...' }
// 응답:
//   성공: { ok: true, urls: { original, '192', '512' } }
//   실패: { error }
//
// 권한: academy_admin (자기 학원만) 또는 super_admin (모든 학원)
// Free 플랜 차단 (super_admin 제외)
// 입력: PNG 만, 최대 5MB

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const sharp = require('sharp');

const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'readaloud-51113.firebasestorage.app';
const MAX_BYTES = 5 * 1024 * 1024;  // 5MB

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

module.exports = async (req, res) => {
  require('./_lib/cors').setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    initAdmin();
    const auth = getAuth();
    const db = getFirestore();

    const body = req.body || {};
    const idToken = String(body.idToken || '').trim();
    const imageBase64 = String(body.imageBase64 || '');
    const target = String(body.target || '').trim();  // 'lexiai' | '' (학원 기본)

    if (!idToken) return res.status(401).json({ error: '인증 토큰 필요' });
    if (!imageBase64) return res.status(400).json({ error: '이미지 데이터 누락' });

    // 1. 토큰 검증
    let caller;
    try { caller = await auth.verifyIdToken(idToken); }
    catch (e) { return res.status(401).json({ error: '유효하지 않은 토큰', code: e.code }); }

    const role = caller.role;
    let academyId = caller.academyId;

    // 2. 권한 — academy_admin 또는 super_admin
    const isSuper = role === 'super_admin';
    const isAcademyAdmin = (role === 'academy_admin' || role === 'admin');

    // target='lexiai' — super_admin 전용. appConfig/branding 경로에 저장
    const isLexiAI = (target === 'lexiai');
    if (isLexiAI && !isSuper) return res.status(403).json({ error: 'LexiAI 기본 로고는 super_admin 만 갱신 가능' });

    if (!isLexiAI) {
      // 학원 admin 인데 academyId 가 토큰에 없으면 users 폴백
      if (!academyId && isAcademyAdmin) {
        try {
          const us = await db.doc('users/' + caller.uid).get();
          academyId = us.exists && us.data().academyId;
        } catch (_) {}
      }
      // super 가 다른 학원 작업하려면 body.academyId 명시 가능
      if (isSuper && body.academyId) academyId = String(body.academyId).trim();
      if (!academyId) return res.status(400).json({ error: 'academyId 결정 불가' });
      if (!isSuper && !isAcademyAdmin) return res.status(403).json({ error: '권한 부족' });
    }

    // 3. base64 → buffer
    const base64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > MAX_BYTES) return res.status(400).json({ error: '5MB 초과' });

    // 4. PNG 검증 (sharp metadata)
    let meta;
    try { meta = await sharp(buffer).metadata(); }
    catch (e) { return res.status(400).json({ error: '이미지 파싱 실패: ' + e.message }); }
    if (meta.format !== 'png') return res.status(400).json({ error: 'PNG 형식만 허용' });

    // 5. 플랜 체크 — Free 는 차단 (super / lexiai 모드는 우회)
    if (!isLexiAI) {
      const acadDoc = await db.doc('academies/' + academyId).get();
      if (!acadDoc.exists) return res.status(404).json({ error: '학원 없음: ' + academyId });
      const planId = acadDoc.data().planId || 'free';
      if (planId === 'free' && !isSuper) {
        return res.status(403).json({ error: 'Free 플랜은 로고 업로드 불가. Lite 이상 플랜으로 업그레이드 필요.' });
      }
    }

    // 6. 리사이즈 + 저장 (3개 사이즈, 정사각 contain + 투명 배경)
    const bucket = getStorage().bucket(STORAGE_BUCKET);
    const basePath = isLexiAI ? `appConfig/branding/logos` : `academies/${academyId}/logos`;
    const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

    const buf192 = await sharp(buffer)
      .resize(192, 192, { fit: 'contain', background: transparent })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const buf512 = await sharp(buffer)
      .resize(512, 512, { fit: 'contain', background: transparent })
      .png({ compressionLevel: 9 })
      .toBuffer();

    const sizes = [
      { name: 'original', buf: buffer },
      { name: '192', buf: buf192 },
      { name: '512', buf: buf512 },
    ];

    const urls = {};
    const ts = Date.now();  // cache-bust query
    for (const { name, buf } of sizes) {
      const file = bucket.file(`${basePath}/${name}.png`);
      await file.save(buf, {
        contentType: 'image/png',
        metadata: { cacheControl: 'public, max-age=86400' },
      });
      try { await file.makePublic(); } catch (_) {}
      urls[name] = `https://storage.googleapis.com/${bucket.name}/${basePath}/${name}.png?v=${ts}`;
    }

    // 7. Firestore 갱신
    if (isLexiAI) {
      await db.doc('appConfig/branding').set({
        defaultLogoUrl: urls.original,
        defaultLogo192Url: urls['192'],
        defaultLogo512Url: urls['512'],
        logoUploadedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
      }, { merge: true });
    } else {
      await db.doc('academies/' + academyId).update({
        'branding.logoUrl': urls.original,
        'branding.logo192Url': urls['192'],
        'branding.logo512Url': urls['512'],
        'branding.logoUploadedAt': FieldValue.serverTimestamp(),
        'branding.updatedAt': FieldValue.serverTimestamp(),
        'branding.updatedBy': caller.uid,
      });
    }

    // 8. adminLogs (best-effort)
    try {
      await db.collection('adminLogs').add({
        at: FieldValue.serverTimestamp(),
        actor: caller.uid,
        actorEmail: caller.email || null,
        action: isLexiAI ? 'upload_lexiai_logo' : 'upload_logo',
        targetType: isLexiAI ? 'appConfig' : 'academy',
        targetId: isLexiAI ? 'branding' : academyId,
        details: { sizes: ['original', '192', '512'], origBytes: buffer.length },
      });
    } catch (_) {}

    return res.status(200).json({ ok: true, urls });
  } catch (e) {
    console.error('[uploadLogo]', e);
    return res.status(500).json({ error: e.message || '서버 오류' });
  }
};
