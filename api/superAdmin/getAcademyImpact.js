// super_admin 전용 — 학원 삭제 시 영향 범위 카운트.
// 데이터 변경 없이 read-only.
// POST body: { idToken, academyId }

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

// academyId 필드를 가진 컬렉션 목록 (Phase 4-3 격리 대상)
const ACADEMY_COLLECTIONS = [
  'notices', 'scores', 'payments', 'hwFiles', 'groups',
  'genTests', 'genQuestionSets', 'genBooks', 'genChapters', 'genPages',
  'pushNotifications', 'userNotifications', 'genCleanupPresets',
];

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });
  try {
    ensureApp();
    const auth = getAuth();
    const db = getFirestore();
    const { idToken, academyId } = req.body || {};
    if (!idToken) return res.status(401).json({ success: false, error: '토큰 필요' });
    if (!academyId) return res.status(400).json({ success: false, error: 'academyId 필요' });

    let caller;
    try { caller = await auth.verifyIdToken(idToken); }
    catch (e) { return res.status(401).json({ success: false, error: '유효하지 않은 토큰' }); }
    if (caller.role !== 'super_admin') return res.status(403).json({ success: false, error: 'super_admin 만 가능' });

    // 학원 존재 확인
    const acadSnap = await db.doc('academies/' + academyId).get();
    if (!acadSnap.exists) return res.status(404).json({ success: false, error: '학원 없음' });

    const counts = {};

    // users (admin / student 분리)
    const usersSnap = await db.collection('users').where('academyId', '==', academyId).get();
    let adminCnt = 0, studentCnt = 0;
    usersSnap.forEach(d => {
      const r = d.data().role;
      if (r === 'admin' || r === 'academy_admin') adminCnt++;
      else if (r === 'student') studentCnt++;
    });
    counts.users = { admin: adminCnt, student: studentCnt, total: usersSnap.size };

    // 13개 컬렉션 카운트
    for (const col of ACADEMY_COLLECTIONS) {
      try {
        const agg = await db.collection(col).where('academyId', '==', academyId).count().get();
        counts[col] = agg.data().count;
      } catch (e) { counts[col] = -1; }  // 인덱스 없거나 에러
    }

    // apiUsage — academyId_{date} 패턴이라 별도 처리
    try {
      const usageSnap = await db.collection('apiUsage').where('academyId', '==', academyId).count().get();
      counts.apiUsage = usageSnap.data().count;
    } catch (e) { counts.apiUsage = -1; }

    return res.status(200).json({ success: true, academyId, academyName: acadSnap.data().name, counts });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
};
