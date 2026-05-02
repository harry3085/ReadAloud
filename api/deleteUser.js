// Vercel Serverless Function - 학생 완전 삭제 (Auth + users + usernameLookup)
// 인증: idToken 검증 + 호출자 admin 권한 + 대상 == 같은 학원 (super_admin 예외)
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { setCors } = require('./_lib/cors');

const DEFAULT_ACADEMY_ID = 'default';

function normalizePrivateKey(raw) {
  if (!raw) return '';
  let k = String(raw).trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  k = k.replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
  return k;
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

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    initAdmin();
    const { uid, idToken } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'uid가 필요합니다.' });
    if (!idToken) return res.status(401).json({ error: '인증 토큰이 필요합니다.' });

    const auth = getAuth();
    const db = getFirestore();

    // 1) 호출자 토큰 검증
    let caller;
    try { caller = await auth.verifyIdToken(idToken); }
    catch (e) { return res.status(401).json({ error: '유효하지 않은 토큰', code: e.code }); }

    // 2) 호출자 권한 확인 — Custom Claims 우선, users.role 폴백
    const claimsRole = caller.role;
    let isAdminUser = (claimsRole === 'academy_admin' || claimsRole === 'super_admin');
    let callerAcademyId = caller.academyId || null;
    let callerDoc = null;
    if (!isAdminUser || !callerAcademyId) {
      try {
        const cs = await db.doc('users/' + caller.uid).get();
        callerDoc = cs.exists ? cs.data() : null;
        if (callerDoc?.role === 'admin') isAdminUser = true;
        if (!callerAcademyId) callerAcademyId = callerDoc?.academyId || null;
      } catch (_) {}
    }
    if (!isAdminUser) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });

    // 3) 대상 학생 doc 조회 + academyId 격리 검증 (super_admin 예외)
    let targetData = null;
    try {
      const ts = await db.doc('users/' + uid).get();
      if (ts.exists) targetData = ts.data();
    } catch (_) {}
    const isSuperAdmin = (claimsRole === 'super_admin');
    if (!isSuperAdmin && targetData?.academyId && targetData.academyId !== callerAcademyId) {
      return res.status(403).json({ error: '다른 학원의 사용자는 삭제할 수 없습니다.' });
    }

    // 4) 자기 자신 삭제 차단 (실수 방지)
    if (uid === caller.uid) {
      return res.status(400).json({ error: '본인 계정은 이 API 로 삭제할 수 없습니다.' });
    }

    // 삭제 전 username 수집 (lookup 동반 삭제용)
    // 출처: (1) users 문서 (2) Auth email (3) usernameLookup 역조회
    let usernameLower = null;

    // (1) users/{uid} 에서 확인
    try {
      const userSnap = await db.doc('users/' + uid).get();
      if (userSnap.exists) {
        const un = userSnap.data().username;
        if (un) usernameLower = String(un).toLowerCase();
      }
    } catch (_) {}

    // (2) Auth email 에서 추출 (username@kunsori.app 패턴)
    if (!usernameLower) {
      try {
        const authUser = await auth.getUser(uid);
        if (authUser.email && authUser.email.endsWith('@kunsori.app')) {
          usernameLower = authUser.email.replace(/@kunsori\.app$/i, '').toLowerCase();
        }
      } catch (_) {}
    }

    // (3) usernameLookup 역조회 (uid 로 where)
    if (!usernameLower) {
      try {
        const qs = await db.collection('usernameLookup').where('uid', '==', uid).limit(1).get();
        if (!qs.empty) {
          usernameLower = qs.docs[0].data().usernameLower || qs.docs[0].id;
        }
      } catch (_) {}
    }

    // 1. Firebase Auth 삭제 (없어도 OK)
    let authDeleted = false;
    try {
      await auth.deleteUser(uid);
      authDeleted = true;
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }

    // 2. Firestore users 삭제
    await db.collection('users').doc(uid).delete();

    // 3. usernameLookup 동반 삭제 (username 있을 때만)
    let lookupDeleted = false;
    if (usernameLower) {
      try {
        await db.doc(`usernameLookup/${usernameLower}`).delete();
        lookupDeleted = true;
      } catch (_) {}
    }

    // 4. activeStudentsCount -1 (대상이 active student 였을 때만)
    if (targetData?.role === 'student' && targetData?.status === 'active' && targetData?.academyId) {
      try {
        await db.doc('academies/' + targetData.academyId).update({
          'usage.activeStudentsCount': FieldValue.increment(-1),
        });
      } catch (e) { console.warn('[deleteUser] activeStudentsCount 감소 실패:', e.message); }
    }

    return res.status(200).json({
      success: true,
      message: authDeleted ? '계정이 삭제됐어요.' : 'Firestore 만 삭제됐어요 (Auth 없음).',
      lookupDeleted,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, code: err.code });
  }
};
