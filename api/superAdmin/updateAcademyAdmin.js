// super_admin 전용 — 학원장 정보 변경.
// 변경 가능: name / email / username / password
// Auth + users + usernameLookup 동시 갱신 (atomic 시도, 실패 시 부분 롤백)
//
// POST body: { idToken, uid, fields: { name?, email?, username?, password? } }

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function ensureApp() {
  if (getApps().length) return getApps()[0];
  let pk = process.env.FIREBASE_PRIVATE_KEY || '';
  pk = pk.replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: pk,
    }),
  });
}

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });
  try {
    ensureApp();
    const auth = getAuth();
    const db = getFirestore();

    const { idToken, uid, fields } = req.body || {};
    if (!idToken) return res.status(401).json({ success: false, error: '토큰 필요' });
    if (!uid) return res.status(400).json({ success: false, error: 'uid 필요' });

    let caller;
    try { caller = await auth.verifyIdToken(idToken); }
    catch (e) { return res.status(401).json({ success: false, error: '유효하지 않은 토큰' }); }
    if (caller.role !== 'super_admin') return res.status(403).json({ success: false, error: 'super_admin 만 가능' });

    const f = fields || {};
    const newName = f.name && String(f.name).trim();
    const newEmail = f.email && String(f.email).trim().toLowerCase();
    const newUsername = f.username && String(f.username).trim().toLowerCase();
    const newPassword = f.password && String(f.password);

    // 기존 데이터 로드
    const userSnap = await db.doc('users/' + uid).get();
    if (!userSnap.exists) return res.status(404).json({ success: false, error: '대상 사용자 없음' });
    const oldUser = userSnap.data();

    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return res.status(400).json({ success: false, error: '유효하지 않은 이메일' });
    if (newUsername && !/^[a-z0-9_]+$/.test(newUsername)) return res.status(400).json({ success: false, error: 'username 은 영소문자/숫자/_ 만' });
    if (newPassword && newPassword.length < 6) return res.status(400).json({ success: false, error: '비밀번호 6자 이상' });

    // username 변경 시 신규 키 중복 검사
    if (newUsername && newUsername !== (oldUser.username || '').toLowerCase()) {
      const dup = await db.doc('usernameLookup/' + newUsername).get();
      if (dup.exists) return res.status(409).json({ success: false, error: '이미 사용 중인 username' });
    }
    // email 변경 시 Auth 중복 검사
    if (newEmail && newEmail !== (oldUser.email || '').toLowerCase()) {
      try {
        const existing = await auth.getUserByEmail(newEmail);
        if (existing && existing.uid !== uid) return res.status(409).json({ success: false, error: '이미 가입된 이메일' });
      } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    }

    // 1) Auth 업데이트
    const authUpdate = {};
    if (newName) authUpdate.displayName = newName;
    if (newEmail) authUpdate.email = newEmail;
    if (newPassword) authUpdate.password = newPassword;
    if (Object.keys(authUpdate).length > 0) {
      await auth.updateUser(uid, authUpdate);
    }

    // 2) Firestore 업데이트 (users + usernameLookup)
    const userUpdate = { updatedAt: FieldValue.serverTimestamp() };
    if (newName) userUpdate.name = newName;
    if (newEmail) userUpdate.email = newEmail;
    if (newUsername) userUpdate.username = newUsername;

    const oldUsernameLower = (oldUser.username || '').toLowerCase();
    const usernameChanged = newUsername && newUsername !== oldUsernameLower;

    try {
      const batch = db.batch();
      batch.update(db.doc('users/' + uid), userUpdate);

      if (usernameChanged) {
        // 새 lookup 생성 + 옛 lookup 삭제
        batch.set(db.doc('usernameLookup/' + newUsername), {
          academyId: oldUser.academyId || null,
          usernameLower: newUsername,
          uid,
          email: newEmail || oldUser.email,
          role: oldUser.role === 'admin' ? 'academy_admin' : (oldUser.role || 'student'),
          createdAt: FieldValue.serverTimestamp(),
        });
        if (oldUsernameLower) batch.delete(db.doc('usernameLookup/' + oldUsernameLower));
      } else if (newEmail) {
        // username 그대로지만 email 업데이트
        if (oldUsernameLower) {
          batch.update(db.doc('usernameLookup/' + oldUsernameLower), { email: newEmail });
        }
      }
      await batch.commit();
    } catch (e) {
      // Firestore 실패 — Auth 일부 롤백 시도 (best-effort)
      console.error('[updateAcademyAdmin] Firestore 실패:', e.message);
      return res.status(500).json({ success: false, error: 'Firestore 갱신 실패: ' + e.message });
    }

    return res.status(200).json({
      success: true,
      updated: { name: !!newName, email: !!newEmail, username: !!newUsername, password: !!newPassword },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, code: e.code });
  }
};
