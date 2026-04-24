// Vercel Serverless Function — 학생 계정 생성 (Auth + Firestore + usernameLookup 트랜잭션적 처리)
//
// 클라이언트 이중 쓰기(Auth create → Firestore setDoc)는 실패 시 orphan 을 만들기 쉬워,
// 서버에서 Admin SDK 로 원자적으로 처리. 실패 시 이미 생성된 Auth 도 롤백.
//
// 요청 body:
//   {
//     idToken: string,              // 관리자 ID 토큰 (Authorization 헤더 대신 body 에서 받음)
//     username: string,
//     password: string,
//     name: string,
//     group?: string,
//     birth?, school?, grade?, phone?, parentName?, parentPhone?  (모두 옵션)
//   }
//
// 응답:
//   성공: { success: true, uid, email }
//   실패: { success: false, error, code? }

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const DEFAULT_ACADEMY_ID = 'default';
const EMAIL_DOMAIN = '@kunsori.app';

function initAdmin() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    initAdmin();
    const auth = getAuth();
    const db = getFirestore();

    const body = req.body || {};
    const idToken = String(body.idToken || '').trim();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();
    const group = String(body.group || '').trim();

    // 1. 관리자 ID 토큰 검증
    if (!idToken) return res.status(401).json({ success: false, error: '인증 토큰이 필요합니다.' });
    let caller;
    try {
      caller = await auth.verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ success: false, error: '유효하지 않은 인증 토큰입니다.', code: e.code });
    }

    // 관리자 권한 확인 (Custom Claims 또는 Firestore users.role=='admin' 폴백)
    const claimsRole = caller.role;
    let isAdminUser = (claimsRole === 'academy_admin' || claimsRole === 'super_admin');
    if (!isAdminUser) {
      try {
        const cs = await db.doc('users/' + caller.uid).get();
        if (cs.exists && cs.data().role === 'admin') isAdminUser = true;
      } catch (_) {}
    }
    if (!isAdminUser) {
      return res.status(403).json({ success: false, error: '관리자 권한이 필요합니다.' });
    }

    // 2. 입력 검증
    if (!username || !name || !password) {
      return res.status(400).json({ success: false, error: '아이디, 이름, 비밀번호는 필수입니다.' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ success: false, error: '아이디는 영문/숫자/언더스코어만 가능합니다.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: '비밀번호는 6자 이상이어야 합니다.' });
    }

    const usernameLower = username.toLowerCase();
    const email = username + EMAIL_DOMAIN;
    const lookupKey = `${DEFAULT_ACADEMY_ID}_${usernameLower}`;

    // 3. username 중복 체크 (usernameLookup 기반)
    const lookupSnap = await db.doc('usernameLookup/' + lookupKey).get();
    if (lookupSnap.exists) {
      return res.status(409).json({ success: false, error: '이미 사용 중인 아이디입니다.' });
    }

    // 4. Auth 계정 생성
    let userRecord;
    try {
      userRecord = await auth.createUser({ email, password, displayName: name });
    } catch (e) {
      if (e.code === 'auth/email-already-exists' || e.code === 'auth/email-already-in-use') {
        return res.status(409).json({
          success: false,
          error: '이 아이디로 이미 가입된 Auth 계정이 남아있습니다. 관리자에게 cleanup 요청하세요.',
          code: e.code,
        });
      }
      return res.status(500).json({ success: false, error: e.message, code: e.code });
    }

    const uid = userRecord.uid;

    // 5. Custom Claims 주입
    try {
      await auth.setCustomUserClaims(uid, {
        academyId: DEFAULT_ACADEMY_ID,
        role: 'student',
      });
    } catch (e) {
      // Claims 실패는 치명적 아님. 로그만.
      console.warn('[createStudent] setCustomUserClaims 실패:', e.message);
    }

    // 6. Firestore 쓰기 (users + usernameLookup 를 batch 로 묶음)
    try {
      const batch = db.batch();
      batch.set(db.doc('users/' + uid), {
        academyId: DEFAULT_ACADEMY_ID,
        username,
        name,
        email,
        group,
        role: 'student',
        status: 'active',
        birth: String(body.birth || ''),
        school: String(body.school || ''),
        grade: String(body.grade || ''),
        phone: String(body.phone || ''),
        parentName: String(body.parentName || ''),
        parentPhone: String(body.parentPhone || ''),
        createdAt: FieldValue.serverTimestamp(),
      });
      batch.set(db.doc('usernameLookup/' + lookupKey), {
        academyId: DEFAULT_ACADEMY_ID,
        usernameLower,
        uid,
        email,
        role: 'student',
        createdAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
    } catch (e) {
      // Firestore 실패 — Auth 롤백
      try { await auth.deleteUser(uid); } catch (_) {}
      return res.status(500).json({
        success: false,
        error: 'Firestore 쓰기 실패. Auth 계정은 롤백됐습니다.',
        detail: e.message,
        code: e.code,
      });
    }

    return res.status(200).json({ success: true, uid, email });
  } catch (err) {
    console.error('[createStudent] unexpected:', err);
    return res.status(500).json({ success: false, error: err.message, code: err.code });
  }
};
