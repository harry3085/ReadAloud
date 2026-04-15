// Vercel Serverless Function - 푸시 알림 발송
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

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
    const db = getFirestore();
    const messaging = getMessaging();

    const { title, body, target } = req.body;
    if (!title || !body || !target) {
      return res.status(400).json({ error: '제목, 내용, 대상은 필수입니다.' });
    }

    // 대상 학생 목록 수집
    let users = []; // [{uid, fcmToken}]

    if (target === 'all') {
      const snap = await db.collection('users').where('role', '==', 'student').get();
      snap.forEach(doc => users.push({ uid: doc.id, fcmToken: doc.data().fcmToken }));
    } else if (target.startsWith('uid:')) {
      const uid = target.replace('uid:', '');
      const snap = await db.collection('users').doc(uid).get();
      if (snap.exists) users.push({ uid: snap.id, fcmToken: snap.data()?.fcmToken });
    } else {
      const snap = await db.collection('users')
        .where('role', '==', 'student')
        .where('group', '==', target)
        .get();
      snap.forEach(doc => users.push({ uid: doc.id, fcmToken: doc.data().fcmToken }));
    }

    if (users.length === 0) {
      return res.status(200).json({
        success: false,
        message: '알림을 받을 수 있는 학생이 없어요.',
      });
    }

    // 각 학생에게 userNotifications 도큐먼트 저장 (팝업 확인용)
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    users.forEach(u => {
      const ref = db.collection('userNotifications').doc();
      batch.set(ref, {
        uid: u.uid,
        title,
        body,
        read: false,
        createdAt: now,
      });
    });
    await batch.commit();

    // FCM 발송 (토큰 있는 학생만)
    const tokens = users.map(u => u.fcmToken).filter(Boolean);
    let sent = 0, failed = 0;

    if (tokens.length > 0) {
      const message = {
        notification: { title, body },
        webpush: {
          notification: {
            title, body,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            vibrate: [200, 100, 200],
            requireInteraction: true, // 확인 전까지 알림 유지
          },
          fcmOptions: { link: '/' },
        },
        tokens,
      };

      const result = await messaging.sendEachForMulticast(message);
      sent = result.successCount;
      failed = result.failureCount;

      // 실패 토큰 정리
      const failedTokens = [];
      result.responses.forEach((resp, i) => { if (!resp.success) failedTokens.push(tokens[i]); });
      if (failedTokens.length > 0) {
        const usersSnap = await db.collection('users')
          .where('fcmToken', 'in', failedTokens.slice(0, 10)).get();
        const cleanBatch = db.batch();
        usersSnap.forEach(doc => cleanBatch.update(doc.ref, { fcmToken: null }));
        await cleanBatch.commit();
      }
    }

    return res.status(200).json({
      success: true,
      sent,
      failed,
      total: users.length,
      message: `${users.length}명에게 알림을 보냈어요!`,
    });

  } catch (err) {
    console.error('sendPush error:', err);
    return res.status(500).json({ error: err.message });
  }
};
