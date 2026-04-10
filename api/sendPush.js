// Vercel Serverless Function - 푸시 알림 발송
// Firebase Admin SDK 사용 (서버에서만 실행)

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const { getFirestore } = require('firebase-admin/firestore');

// Firebase Admin 초기화 (환경변수에서 서비스 계정 키 읽기)
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
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    initAdmin();
    const db = getFirestore();
    const messaging = getMessaging();

    const { title, body, target } = req.body;
    if (!title || !body || !target) {
      return res.status(400).json({ error: '제목, 내용, 대상은 필수입니다.' });
    }

    // 대상 학생들의 FCM 토큰 수집
    let tokens = [];

    if (target === 'all') {
      // 전체 학생
      const snap = await db.collection('users')
        .where('role', '==', 'student')
        .get();
      snap.forEach(doc => {
        const t = doc.data().fcmToken;
        if (t) tokens.push(t);
      });

    } else if (target.startsWith('uid:')) {
      // 개별 학생
      const uid = target.replace('uid:', '');
      const snap = await db.collection('users').doc(uid).get();
      const t = snap.data()?.fcmToken;
      if (t) tokens.push(t);

    } else {
      // 특정 그룹
      const snap = await db.collection('users')
        .where('role', '==', 'student')
        .where('group', '==', target)
        .get();
      snap.forEach(doc => {
        const t = doc.data().fcmToken;
        if (t) tokens.push(t);
      });
    }

    if (tokens.length === 0) {
      return res.status(200).json({ 
        success: false, 
        message: '알림을 받을 수 있는 학생이 없어요. (앱을 열어서 알림을 허용해야 해요)' 
      });
    }

    // FCM 멀티캐스트 발송
    const message = {
      notification: { title, body },
      webpush: {
        notification: {
          title,
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          vibrate: [200, 100, 200],
        },
        fcmOptions: { link: '/' },
      },
      tokens,
    };

    const result = await messaging.sendEachForMulticast(message);
    
    // 실패한 토큰 정리
    const failedTokens = [];
    result.responses.forEach((resp, i) => {
      if (!resp.success) failedTokens.push(tokens[i]);
    });

    // 유효하지 않은 토큰 Firestore에서 제거
    if (failedTokens.length > 0) {
      const usersSnap = await db.collection('users')
        .where('fcmToken', 'in', failedTokens.slice(0, 10))
        .get();
      const batch = db.batch();
      usersSnap.forEach(doc => batch.update(doc.ref, { fcmToken: null }));
      await batch.commit();
    }

    return res.status(200).json({
      success: true,
      sent: result.successCount,
      failed: result.failureCount,
      total: tokens.length,
      message: `${result.successCount}명에게 알림을 보냈어요!`,
    });

  } catch (err) {
    console.error('sendPush error:', err);
    return res.status(500).json({ error: err.message });
  }
};
