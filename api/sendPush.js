// Vercel Serverless Function - 푸시 알림 발송
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
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
    const auth = getAuth();
    const db = getFirestore();
    const messaging = getMessaging();

    const { title, body, target, idToken } = req.body;
    if (!title || !body || !target) {
      return res.status(400).json({ error: '제목, 내용, 대상은 필수입니다.' });
    }
    if (!idToken) return res.status(401).json({ error: '인증 토큰 필요' });

    // 호출자 검증 + academyId 추출
    let caller;
    try { caller = await auth.verifyIdToken(idToken); }
    catch (e) { return res.status(401).json({ error: '유효하지 않은 토큰', code: e.code }); }

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
    if (!isAdmin) return res.status(403).json({ error: '관리자 권한 필요' });
    if (!callerAcademyId) callerAcademyId = 'default';

    // 대상 학생 목록 수집 (자기 학원 학생만)
    let users = []; // [{uid, fcmToken}]

    if (target === 'all') {
      const snap = await db.collection('users')
        .where('academyId', '==', callerAcademyId)
        .where('role', '==', 'student')
        .get();
      snap.forEach(doc => users.push({ uid: doc.id, fcmToken: doc.data().fcmToken }));
    } else if (target.startsWith('uid:')) {
      const uid = target.replace('uid:', '');
      const snap = await db.collection('users').doc(uid).get();
      if (snap.exists) {
        const d = snap.data();
        // super_admin 이 아니면 자기 학원 학생만 발송 가능
        if (caller.role === 'super_admin' || d.academyId === callerAcademyId) {
          users.push({ uid: snap.id, fcmToken: d?.fcmToken });
        }
      }
    } else {
      const snap = await db.collection('users')
        .where('academyId', '==', callerAcademyId)
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

    // pushNotifications 이력 저장
    const pushRef = db.collection('pushNotifications').doc();
    await pushRef.set({
      title, body, target,
      sent: true,
      date: new Date().toISOString().slice(0,10),
      createdAt: FieldValue.serverTimestamp(),
      academyId: callerAcademyId,
    });
    const pushId = pushRef.id;

    // 각 학생에게 userNotifications 도큐먼트 저장 (팝업 확인용)
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    users.forEach(u => {
      const ref = db.collection('userNotifications').doc();
      batch.set(ref, {
        uid: u.uid,
        title,
        body,
        pushId,   // 알림 이력과 연결
        read: false,
        createdAt: now,
        academyId: callerAcademyId,
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
