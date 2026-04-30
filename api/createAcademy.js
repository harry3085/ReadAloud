// Vercel Serverless Function — 신규 학원 생성 (super_admin 전용)
//
// 호출자: super_admin Custom Claims 가진 사용자만
// 동작: academies 문서 + 학원장 Auth 계정 + users 문서 원자적 생성
//
// 요청 body:
//   {
//     idToken: string,             // super_admin 의 ID 토큰
//     name: string,                // 학원명 (예: 'ABC공부방')
//     subdomain: string,           // 학원코드 (예: 'abc') — academies/{subdomain} 으로 사용
//     adminEmail: string,          // 학원장 이메일
//     adminPassword: string,       // 학원장 임시 비밀번호 (8자 이상)
//     planId?: string,             // 'lite' | 'standard' | 'pro' (기본: 'lite')
//     studentLimit?: number,       // 30 / 60 / 100 (기본: 30)
//     grandfatheredPrice?: {       // 얼리어답터 가격 보장 (선택)
//       enabled?, monthlyPrice?, yearlyPrice?, note?
//     }
//     acquisitionChannel?: string, // 가입 경로 (선택)
//     internalMemo?: string,       // 운영자 메모 (선택)
//   }
//
// 응답:
//   { success: true, academyId, adminUid, adminEmail }
//   { success: false, error, code? }

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function normalizePrivateKey(raw) {
  if (!raw) return '';
  let k = String(raw).trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  return k.replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
}

function initAdmin() {
  if (getApps().length > 0) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(`Vercel env vars missing — PROJECT_ID=${!!projectId}, CLIENT_EMAIL=${!!clientEmail}, PRIVATE_KEY=${!!privateKey}.`);
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

function bad(res, status, error, extra = {}) {
  return res.status(status).json({ success: false, error, ...extra });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return bad(res, 405, 'Method not allowed');

  try {
    initAdmin();
    const auth = getAuth();
    const db = getFirestore();

    const body = req.body || {};
    const idToken = String(body.idToken || '').trim();
    const name = String(body.name || '').trim();
    const subdomain = String(body.subdomain || '').trim().toLowerCase();
    const adminEmail = String(body.adminEmail || '').trim().toLowerCase();
    const adminPassword = String(body.adminPassword || '');
    const planId = String(body.planId || 'lite');
    const studentLimit = parseInt(body.studentLimit) || 30;
    const acquisitionChannel = String(body.acquisitionChannel || '');
    const internalMemo = String(body.internalMemo || '');

    // grandfatheredPrice — 객체로 받음. 누락 시 비활성 기본값.
    const gpInput = body.grandfatheredPrice;
    const monthlyPrice = gpInput && Number(gpInput.monthlyPrice) > 0 ? Number(gpInput.monthlyPrice) : 0;
    const yearlyPrice  = gpInput && Number(gpInput.yearlyPrice)  > 0 ? Number(gpInput.yearlyPrice)  : 0;
    const gpNote       = gpInput && typeof gpInput.note === 'string' ? gpInput.note : '';
    const grandfatheredPrice = (monthlyPrice > 0 || yearlyPrice > 0)
      ? { enabled: true, monthlyPrice, yearlyPrice, grantedAt: FieldValue.serverTimestamp(), note: gpNote }
      : { enabled: false, monthlyPrice: 0, yearlyPrice: 0, grantedAt: null, note: '' };

    // 1. super_admin 인증 검증
    if (!idToken) return bad(res, 401, '인증 토큰이 필요합니다.');
    let caller;
    try {
      caller = await auth.verifyIdToken(idToken);
    } catch (e) {
      return bad(res, 401, '유효하지 않은 토큰입니다.', { code: e.code });
    }
    if (caller.role !== 'super_admin') {
      return bad(res, 403, 'super_admin 권한이 필요합니다.');
    }

    // 2. 입력 검증
    if (!name) return bad(res, 400, '학원명(name)이 필요합니다.');
    if (!subdomain || !/^[a-z0-9_-]+$/.test(subdomain)) {
      return bad(res, 400, 'subdomain 은 영소문자/숫자/하이픈/언더스코어만 가능합니다.');
    }
    if (subdomain === 'default') return bad(res, 400, "'default' 는 예약된 학원 ID 입니다.");
    if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      return bad(res, 400, '유효한 학원장 이메일이 필요합니다.');
    }
    if (!adminPassword || adminPassword.length < 8) {
      return bad(res, 400, '학원장 임시 비밀번호는 8자 이상이어야 합니다.');
    }
    if (!['free', 'lite', 'standard', 'pro'].includes(planId)) {
      return bad(res, 400, "planId 는 'free' | 'lite' | 'standard' | 'pro' 중 하나여야 합니다.");
    }

    // 3. 중복 체크
    const academyRef = db.doc(`academies/${subdomain}`);
    if ((await academyRef.get()).exists) {
      return bad(res, 409, `이미 존재하는 학원 ID(subdomain): ${subdomain}`);
    }
    const planRef = db.doc(`plans/${planId}`);
    if (!(await planRef.get()).exists) {
      return bad(res, 400, `존재하지 않는 plan: ${planId}`);
    }
    // 학원장 이메일 Auth 중복
    try {
      const existing = await auth.getUserByEmail(adminEmail);
      if (existing) return bad(res, 409, `Firebase Auth 에 이미 가입된 이메일: ${adminEmail}`);
    } catch (e) {
      if (e.code !== 'auth/user-not-found') return bad(res, 500, e.message, { code: e.code });
    }

    // 4. 학원장 Auth 계정 생성
    const userRecord = await auth.createUser({
      email: adminEmail,
      password: adminPassword,
      displayName: `${name} 학원장`,
    });
    const adminUid = userRecord.uid;

    // 5. Custom Claims 주입
    try {
      await auth.setCustomUserClaims(adminUid, { academyId: subdomain, role: 'academy_admin' });
    } catch (e) {
      console.warn('[createAcademy] setCustomUserClaims 실패:', e.message);
    }

    // 6. Firestore 쓰기 (academies + users + usernameLookup batch)
    // 학원장 username = subdomain 그대로 (접미사 없음, 2026-04-27 정책)
    const adminUsername = subdomain.toLowerCase();
    try {
      const batch = db.batch();
      batch.set(academyRef, {
        id: subdomain,
        name,
        subdomain,
        planId,
        billingStatus: 'active',
        studentLimit,
        grandfatheredPrice,
        subscribedAt: FieldValue.serverTimestamp(),
        planExpiresAt: null,
        settings: {
          recordingIntegrity: { minVoiceActivity: 0.4, minDurationSec: 60, maxDurationSec: 600 },
        },
        usage: {
          activeStudentsCount: 0,
          aiCallsThisMonth: 0,
          recordingCallsThisMonth: 0,
          lastResetAt: new Date(Date.now() + 9*3600*1000).toISOString().slice(0, 7),
        },
        // SuperAdmin Phase A (T1) 신규 필드
        acquisitionChannel,
        internalMemo,
        featureFlags: { aiGrowthReport: false, recordingAiFeedback: false },
        contactLog: [],
        lastAdminLoginAt: null,
        createdBy: caller.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.set(db.doc(`users/${adminUid}`), {
        academyId: subdomain,
        role: 'admin',  // 기존 클라이언트 호환 (admin 검사용)
        username: adminUsername,
        name: `${name} 학원장`,
        email: adminEmail,
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
      });
      batch.set(db.doc(`usernameLookup/${adminUsername}`), {
        academyId: subdomain,
        usernameLower: adminUsername,
        uid: adminUid,
        email: adminEmail,
        role: 'academy_admin',
        createdAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
    } catch (e) {
      // Firestore 실패 — Auth 롤백
      try { await auth.deleteUser(adminUid); } catch (_) {}
      return bad(res, 500, 'Firestore 쓰기 실패. Auth 계정 롤백됨.', { detail: e.message, code: e.code });
    }

    return res.status(200).json({
      success: true,
      academyId: subdomain,
      adminUid,
      adminUsername,
      adminEmail,
      planId,
    });
  } catch (err) {
    console.error('[createAcademy] unexpected:', err);
    return res.status(500).json({ success: false, error: err.message, code: err.code });
  }
};
