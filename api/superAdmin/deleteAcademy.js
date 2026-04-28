// super_admin 전용 — 학원 영구 삭제.
// 매우 위험. 모든 데이터 + Auth 계정 삭제. 복구는 별도 백업 JSON 으로 (npm run restore-academy)
//
// POST body: { idToken, academyId, confirmSubdomain }
//   confirmSubdomain 이 academies/{id}.subdomain 과 일치해야 진행 (이중 안전장치)

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

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

const ACADEMY_COLLECTIONS = [
  'notices', 'scores', 'payments', 'hwFiles', 'groups',
  'genTests', 'genQuestionSets', 'genBooks', 'genChapters', 'genPages',
  'pushNotifications', 'userNotifications', 'genCleanupPresets', 'apiUsage',
];

async function _deleteAllByAcademy(db, col, academyId) {
  let total = 0;
  while (true) {
    const snap = await db.collection(col).where('academyId', '==', academyId).limit(450).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    if (snap.size < 450) break;
  }
  return total;
}

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });
  try {
    ensureApp();
    const auth = getAuth();
    const db = getFirestore();
    const { idToken, academyId, confirmSubdomain } = req.body || {};
    if (!idToken) return res.status(401).json({ success: false, error: '토큰 필요' });
    if (!academyId) return res.status(400).json({ success: false, error: 'academyId 필요' });
    if (!confirmSubdomain) return res.status(400).json({ success: false, error: 'confirmSubdomain 필요' });

    let caller;
    try { caller = await auth.verifyIdToken(idToken); }
    catch (e) { return res.status(401).json({ success: false, error: '유효하지 않은 토큰' }); }
    if (caller.role !== 'super_admin') return res.status(403).json({ success: false, error: 'super_admin 만 가능' });

    const acadRef = db.doc('academies/' + academyId);
    const acadSnap = await acadRef.get();
    if (!acadSnap.exists) return res.status(404).json({ success: false, error: '학원 없음' });
    const academy = acadSnap.data();
    const expectedSubdomain = academy.subdomain || academyId;
    if (String(confirmSubdomain).trim() !== expectedSubdomain) {
      return res.status(400).json({ success: false, error: 'subdomain 불일치 — 정확히 입력하세요' });
    }

    const deleted = {};

    // 1. genTests/{id}/userCompleted 서브컬렉션 (먼저)
    const genTestsSnap = await db.collection('genTests').where('academyId', '==', academyId).get();
    let ucCount = 0;
    for (const t of genTestsSnap.docs) {
      const ucSnap = await t.ref.collection('userCompleted').get();
      if (!ucSnap.empty) {
        let batch = db.batch();
        let n = 0;
        for (const u of ucSnap.docs) {
          batch.delete(u.ref);
          n++;
          if (n >= 450) { await batch.commit(); batch = db.batch(); n = 0; }
        }
        if (n > 0) await batch.commit();
        ucCount += ucSnap.size;
      }
    }
    deleted['genTests_userCompleted'] = ucCount;

    // 2. users — Auth + Firestore + usernameLookup
    const usersSnap = await db.collection('users').where('academyId', '==', academyId).get();
    let authDeleted = 0, authErrors = 0, lookupDeleted = 0;
    for (const u of usersSnap.docs) {
      const uid = u.id;
      const data = u.data();
      // Auth 삭제 (없으면 silent)
      try {
        await auth.deleteUser(uid);
        authDeleted++;
      } catch (e) {
        if (e.code !== 'auth/user-not-found') authErrors++;
      }
      // usernameLookup
      if (data.username) {
        try {
          const lookupRef = db.doc('usernameLookup/' + data.username.toLowerCase());
          const ls = await lookupRef.get();
          if (ls.exists && ls.data().uid === uid) {
            await lookupRef.delete();
            lookupDeleted++;
          }
        } catch (_) {}
      }
      // users 문서
      await u.ref.delete();
    }
    deleted.users = usersSnap.size;
    deleted.authDeleted = authDeleted;
    deleted.authErrors = authErrors;
    deleted.usernameLookup = lookupDeleted;

    // 3. 13 컬렉션 batch delete
    for (const col of ACADEMY_COLLECTIONS) {
      try {
        deleted[col] = await _deleteAllByAcademy(db, col, academyId);
      } catch (e) { deleted[col + '_error'] = e.message; }
    }

    // 4. academies 문서 마지막
    await acadRef.delete();
    deleted.academy = 1;

    return res.status(200).json({
      success: true,
      academyId,
      academyName: academy.name,
      deleted,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};
