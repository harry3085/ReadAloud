// FCM 토큰 소유권 claim — 이 토큰 가진 다른 user 들에서 제거하고 호출자에게만 부여.
//
// 멀티 디바이스 (옵션 A) + claim 패턴 조합:
//   - users.fcmTokens (array) 는 그 user 가 소유한 모든 디바이스 토큰
//   - 같은 디바이스에 다른 user 가 로그인하면 그 디바이스 토큰을 새 user 로 이전 (이전 user 의 array 에선 제거)
//   - 이 API 가 그 이전 작업 담당 (Firestore Rules 상 다른 user doc 수정 불가하므로 admin SDK 필요)
//
// 호출 시점: 학생앱 doRegisterToken 직후 (로그인마다)
//
// 요청 body:
//   { idToken: string, fcmToken: string }
//
// 응답:
//   { success: true, claimed: number }   // 다른 user 에서 제거된 횟수

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
    throw new Error('Vercel env vars missing');
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
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

    const { idToken, fcmToken } = req.body || {};
    if (!idToken || !fcmToken) {
      return res.status(400).json({ error: 'idToken and fcmToken required' });
    }

    let caller;
    try { caller = await auth.verifyIdToken(idToken); }
    catch (e) { return res.status(401).json({ error: '유효하지 않은 토큰', code: e.code }); }

    const myUid = caller.uid;

    // 이 토큰 가진 다른 user 들 검색 (array 와 legacy 둘 다)
    const arrSnap = await db.collection('users')
      .where('fcmTokens', 'array-contains', fcmToken).get();
    const legacySnap = await db.collection('users')
      .where('fcmToken', '==', fcmToken).get();

    const otherUids = new Set();
    arrSnap.docs.forEach(d => { if (d.id !== myUid) otherUids.add(d.id); });
    legacySnap.docs.forEach(d => { if (d.id !== myUid) otherUids.add(d.id); });

    if (otherUids.size === 0) {
      return res.status(200).json({ success: true, claimed: 0 });
    }

    // 다른 user 들에서 토큰 제거 (array 에선 arrayRemove, legacy 매칭 시에만 fcmToken 비움)
    const batch = db.batch();
    const otherDocsMap = new Map();
    [...arrSnap.docs, ...legacySnap.docs].forEach(d => otherDocsMap.set(d.id, d));

    for (const uid of otherUids) {
      const d = otherDocsMap.get(uid);
      if (!d) continue;
      const data = d.data();
      const update = { fcmTokens: FieldValue.arrayRemove(fcmToken) };
      // 레거시 fcmToken 도 같은 값이면 비움
      if (data.fcmToken === fcmToken) update.fcmToken = null;
      batch.update(d.ref, update);
    }
    await batch.commit();

    return res.status(200).json({ success: true, claimed: otherUids.size });
  } catch (err) {
    console.error('claimFcmToken error:', err);
    return res.status(500).json({ error: err.message });
  }
};
