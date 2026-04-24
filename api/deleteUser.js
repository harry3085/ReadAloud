// Vercel Serverless Function - 학생 완전 삭제 (Auth + users + usernameLookup)
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    initAdmin();
    const { uid } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'uid가 필요합니다.' });

    const auth = getAuth();
    const db = getFirestore();

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
          usernameLower = qs.docs[0].data().usernameLower || qs.docs[0].id.replace(`${DEFAULT_ACADEMY_ID}_`, '');
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
        await db.doc(`usernameLookup/${DEFAULT_ACADEMY_ID}_${usernameLower}`).delete();
        lookupDeleted = true;
      } catch (_) {}
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
