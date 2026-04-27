// Vercel Serverless Function — 학생 비밀번호 변경.
// 관리자(academy_admin/super_admin) 가 자기 학원 학생 비번 변경 가능.

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

function getApp() {
  if (getApps().length) return getApps()[0];
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
  // PEM normalization
  privateKey = privateKey.replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Vercel env vars missing — PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY');
  }
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });

  try {
    const app = getApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    const { idToken, uid: targetUid, password } = req.body || {};

    if (!idToken) return res.status(401).json({ success: false, error: '인증 토큰 필요' });
    if (!targetUid) return res.status(400).json({ success: false, error: '대상 uid 필요' });
    if (!password || String(password).length < 6) {
      return res.status(400).json({ success: false, error: '비밀번호는 6자 이상' });
    }

    // 1. 호출자 검증 (관리자 + academyId)
    let caller;
    try { caller = await auth.verifyIdToken(idToken); }
    catch (e) { return res.status(401).json({ success: false, error: '유효하지 않은 토큰', code: e.code }); }

    let isAdmin = (caller.role === 'academy_admin' || caller.role === 'super_admin');
    let callerAcademyId = caller.academyId || null;
    if (!isAdmin || !callerAcademyId) {
      try {
        const cs = await db.doc('users/' + caller.uid).get();
        if (cs.exists) {
          const cd = cs.data();
          if (cd.role === 'admin') isAdmin = true;
          if (!callerAcademyId) callerAcademyId = cd.academyId || null;
        }
      } catch (_) {}
    }
    if (!isAdmin) return res.status(403).json({ success: false, error: '관리자 권한 필요' });

    // 2. 대상 학생 검증 — 같은 학원이어야 함 (super_admin 은 무관)
    if (caller.role !== 'super_admin') {
      const targetSnap = await db.doc('users/' + targetUid).get();
      if (!targetSnap.exists) return res.status(404).json({ success: false, error: '대상 학생 없음' });
      const targetData = targetSnap.data();
      if (targetData.academyId !== callerAcademyId) {
        return res.status(403).json({ success: false, error: '다른 학원 학생은 변경 불가' });
      }
    }

    // 3. Auth 비번 변경
    await auth.updateUser(targetUid, { password: String(password) });

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, code: e.code });
  }
};
