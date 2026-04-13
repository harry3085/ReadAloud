// Vercel Serverless Function - Firebase Auth 계정 삭제
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

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
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: 'uid가 필요합니다.' });

    const auth = getAuth();
    const db = getFirestore();

    // Firebase Auth 삭제
    await auth.deleteUser(uid);

    // Firestore users 삭제
    await db.collection('users').doc(uid).delete();

    return res.status(200).json({ success: true, message: '계정이 삭제됐어요.' });
  } catch (err) {
    // Auth에 없는 계정이면 Firestore만 삭제
    if (err.code === 'auth/user-not-found') {
      try {
        const db = getFirestore();
        await db.collection('users').doc(req.body.uid).delete();
        return res.status(200).json({ success: true, message: 'Firestore 계정만 삭제됐어요.' });
      } catch(e2) {
        return res.status(500).json({ error: e2.message });
      }
    }
    return res.status(500).json({ error: err.message });
  }
};
