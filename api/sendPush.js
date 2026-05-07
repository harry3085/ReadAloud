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
  require('./_lib/cors').setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    initAdmin();
    const auth = getAuth();
    const db = getFirestore();
    const messaging = getMessaging();

    // 신 schema: targets[] = [{type:'all'|'class'|'student', id, name, groupName?}]
    // 옛 schema: target 단일 ('all' | groupName | 'uid:UID') — 안전망 유지
    const { title, body, target, targets, idToken } = req.body;
    const hasTargets = Array.isArray(targets) && targets.length > 0;
    if (!title || !body || (!target && !hasTargets)) {
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
    // 멀티 디바이스 지원 — fcmTokens 배열 + fcmToken 레거시 둘 다 수집
    // 다중 대상 (targets[]) 도 자기 학원 안에서 dedupe (uid 기준)
    const usersByUid = new Map(); // uid → {uid, fcmToken, fcmTokens}

    const _addUserDoc = (id, d) => {
      if (usersByUid.has(id)) return;
      usersByUid.set(id, {
        uid: id,
        fcmToken: d?.fcmToken,
        fcmTokens: Array.isArray(d?.fcmTokens) ? d.fcmTokens : [],
      });
    };

    const _addAll = async () => {
      const snap = await db.collection('users')
        .where('academyId', '==', callerAcademyId)
        .where('role', '==', 'student')
        .get();
      snap.forEach(doc => _addUserDoc(doc.id, doc.data()));
    };

    const _addClass = async (groupName) => {
      const snap = await db.collection('users')
        .where('academyId', '==', callerAcademyId)
        .where('role', '==', 'student')
        .where('group', '==', groupName)
        .get();
      snap.forEach(doc => _addUserDoc(doc.id, doc.data()));
    };

    const _addStudent = async (uid) => {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) return;
      const d = snap.data();
      // super_admin 이 아니면 자기 학원 학생만
      if (caller.role === 'super_admin' || d.academyId === callerAcademyId) {
        _addUserDoc(snap.id, d);
      }
    };

    if (hasTargets) {
      // 신 schema: targets[]
      if (targets.some(t => t?.type === 'all')) {
        await _addAll();
      } else {
        for (const t of targets) {
          if (!t || !t.type || !t.id) continue;
          if (t.type === 'class') await _addClass(t.id);
          else if (t.type === 'student') await _addStudent(t.id);
        }
      }
    } else if (target === 'all') {
      await _addAll();
    } else if (typeof target === 'string' && target.startsWith('uid:')) {
      await _addStudent(target.replace('uid:', ''));
    } else if (typeof target === 'string' && target) {
      await _addClass(target);
    }

    const users = [...usersByUid.values()];

    if (users.length === 0) {
      return res.status(200).json({
        success: false,
        message: '알림을 받을 수 있는 학생이 없어요.',
      });
    }

    // pushNotifications 이력 저장 (신 schema: targets[] + targetSummary)
    const _summarize = (ts) => {
      if (!Array.isArray(ts) || !ts.length) return '';
      if (ts.some(t => t.type === 'all')) return '전체';
      const cs = ts.filter(t => t.type === 'class');
      const ss = ts.filter(t => t.type === 'student');
      const parts = [];
      if (cs.length) parts.push(cs.map(t => t.groupName || t.id).join('·'));
      if (ss.length) parts.push(`${ss.length}명`);
      return parts.join(' + ');
    };

    const pushRef = db.collection('pushNotifications').doc();
    const pushDoc = {
      title, body,
      sent: true,
      date: new Date(Date.now() + 9*3600*1000).toISOString().slice(0,10),
      createdAt: FieldValue.serverTimestamp(),
      academyId: callerAcademyId,
    };
    if (hasTargets) {
      pushDoc.targets = targets;
      pushDoc.targetSummary = _summarize(targets);
    } else if (target) {
      // 옛 호출자 호환 (targetSummary 만 채워서 admin 표시 일관)
      pushDoc.target = target;
      pushDoc.targetSummary = target === 'all' ? '전체'
        : (typeof target === 'string' && target.startsWith('uid:')) ? '개별학생'
        : String(target);
    }
    await pushRef.set(pushDoc);
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
    //   - users.fcmTokens (array) 우선 — 멀티 디바이스 (학생+학부모 같은 ID 다른 폰)
    //   - users.fcmToken (string) — 레거시 fallback (마이그레이션 후엔 실효 X)
    //   - Set 으로 dedup — 같은 폰을 여러 user 가 사용한 경우 중복 발송 방지
    const tokens = [...new Set(
      users.flatMap(u => {
        const arr = Array.isArray(u.fcmTokens) ? u.fcmTokens : [];
        const legacy = u.fcmToken ? [u.fcmToken] : [];
        return [...arr, ...legacy];
      }).filter(Boolean)
    )];
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

      // 실패 토큰 정리 — fcmTokens 배열에서 arrayRemove + 레거시 fcmToken 도 null
      const failedTokens = [];
      result.responses.forEach((resp, i) => {
        if (!resp.success) {
          const code = resp.error?.code || '';
          // 영구 실패만 정리 (네트워크 일시 오류 제외)
          if (code === 'messaging/registration-token-not-registered'
              || code === 'messaging/invalid-registration-token') {
            failedTokens.push(tokens[i]);
          }
        }
      });
      if (failedTokens.length > 0) {
        const cleanBatch = db.batch();
        // 각 실패 토큰별로 array-contains 쿼리 후 arrayRemove (10건씩 chunk)
        for (const ft of failedTokens.slice(0, 50)) {
          const sn1 = await db.collection('users').where('fcmTokens', 'array-contains', ft).get();
          sn1.forEach(d => cleanBatch.update(d.ref, { fcmTokens: FieldValue.arrayRemove(ft) }));
          const sn2 = await db.collection('users').where('fcmToken', '==', ft).get();
          sn2.forEach(d => cleanBatch.update(d.ref, { fcmToken: null }));
        }
        try { await cleanBatch.commit(); } catch (e) { console.warn('failed token cleanup:', e.message); }
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
