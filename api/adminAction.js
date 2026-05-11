// 학원장 전용 — action dispatcher (Vercel 함수 수 우회용 통합 함수)
// POST body: { idToken, action, ...payload }
//   action: 'reEvaluateRecording' — 학원장이 학생 녹음을 AI 재평가
//
// 신규 action 추가 시 _verifyAdmin 권한 검증 후 분기에 등록.

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

async function _verifyAdmin(auth, idToken) {
  if (!idToken) return { error: '토큰 필요', status: 401 };
  let caller;
  try { caller = await auth.verifyIdToken(idToken); }
  catch (e) { return { error: '유효하지 않은 토큰', status: 401 }; }
  if (caller.role !== 'admin' && caller.role !== 'super_admin') {
    return { error: 'admin 만 가능', status: 403 };
  }
  if (caller.role === 'admin' && !caller.academyId) {
    return { error: 'academyId 없음', status: 403 };
  }
  return { caller };
}

function _ymdKST(d = new Date()) {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// ── action: reEvaluateRecording ──────────────────────────
// 학원장이 학생의 마지막 녹음을 AI 재평가 (eval 에러·미통과 케이스 구제)
// 1) genTests/{testId} fetch + 학원 격리 검증
// 2) userCompleted/{uid}.recordings 마지막 audioUrl 추출
// 3) /api/check-recording self-call (학원 녹음 한도 차감)
// 4) 결과로 userCompleted 갱신 (통과/미통과 분기 + 옛 에러 마커 cleanup)
// 5) scores 컬렉션 add (성적 리포트 반영)
async function _reEvaluateRecording(db, body, idToken, caller) {
  const { testId, uid } = body;
  if (!testId || !uid) {
    return { status: 400, body: { success: false, error: 'testId, uid 필요' } };
  }

  // 시험 정보 + 학원 격리 검증
  const tSnap = await db.doc(`genTests/${testId}`).get();
  if (!tSnap.exists) return { status: 404, body: { success: false, error: '시험 없음' } };
  const t = tSnap.data();
  if (caller.role !== 'super_admin' && t.academyId !== caller.academyId) {
    return { status: 403, body: { success: false, error: '다른 학원 시험' } };
  }

  // 학생 응시 정보
  const ucRef = db.doc(`genTests/${testId}/userCompleted/${uid}`);
  const ucSnap = await ucRef.get();
  if (!ucSnap.exists) return { status: 404, body: { success: false, error: '응시 기록 없음' } };
  const c = ucSnap.data();
  const recs = Array.isArray(c.recordings) ? c.recordings : [];
  if (!recs.length) {
    return { status: 400, body: { success: false, error: 'audio 없음 — Storage 에서 찾아야 함' } };
  }
  const last = recs[recs.length - 1];
  if (!last.audioUrl) {
    return { status: 400, body: { success: false, error: '마지막 회차 audioUrl 없음' } };
  }

  // 질문 정보
  const q = (Array.isArray(t.questions) && t.questions[0]) || {};
  const fullText = q.fullText || '';
  if (!fullText) return { status: 400, body: { success: false, error: 'fullText 없음' } };
  const passScore = t.passScore || q.accuracyThreshold || 80;
  const evalSec = (typeof q.evaluationSeconds === 'number') ? q.evaluationSeconds : 0;

  // check-recording self-call (caller 학원 한도 차감)
  // VERCEL_URL: 배포된 deployment 의 도메인 (개발 환경에선 비어있을 수 있음)
  const host = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : (process.env.SELF_HOST || 'https://raloud.vercel.app');
  let data;
  try {
    const cr = await fetch(`${host}/api/check-recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        originalText: fullText,
        audioUrl: last.audioUrl,
        mimeType: last.mimeType || 'audio/webm',
        evaluationSeconds: evalSec,
      }),
    });
    data = await cr.json();
    if (!cr.ok || !data.success) {
      return {
        status: cr.status || 502,
        body: { success: false, error: '평가 실패: ' + (data?.error || cr.status) },
      };
    }
  } catch (e) {
    return { status: 502, body: { success: false, error: 'check-recording 호출 실패: ' + (e.message || 'unknown') } };
  }

  // 결과 정리
  const score = Math.max(0, Math.min(100, parseInt(data.score) || 0));
  const missedWords = Array.isArray(data.missedWords) ? data.missedWords : [];
  const note = String(data.note || '');
  const feedback = data.feedback || { missedWords: [], weakPronunciation: [], tips: [] };
  const passed = score >= passScore;
  const today = _ymdKST();

  // 마지막 회차에 평가 결과 박음
  const newRecs = recs.slice();
  newRecs[newRecs.length - 1] = {
    ...last,
    score, missedWords, note, feedback,
  };

  // userCompleted 업데이트 (통과/미통과 분기 + 옛 에러 마커 cleanup)
  if (passed) {
    await ucRef.set({
      uid, userName: c.userName || '',
      score, passed: true, passScore, date: today,
      recordings: newRecs,
      completedAt: FieldValue.serverTimestamp(),
      latestFailedScore: null,
      latestFailedAt: null,
      latestErrorStage: null,
      latestErrorMessage: null,
      latestAttemptAt: null,
      reEvaluatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } else {
    await ucRef.set({
      uid, userName: c.userName || '',
      passScore,
      latestFailedScore: score,
      latestFailedAt: FieldValue.serverTimestamp(),
      recordings: newRecs,
      latestErrorStage: null,
      latestErrorMessage: null,
      latestAttemptAt: null,
      reEvaluatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // scores 컬렉션 add (성적 리포트 반영용)
  await db.collection('scores').add({
    uid,
    userName: c.userName || '',
    testId,
    testName: t.name || '',
    score, passed, passScore,
    mode: 'recording',
    date: today,
    academyId: t.academyId,
    createdAt: FieldValue.serverTimestamp(),
    reEvaluated: true,
    recordings: newRecs,
  });

  return {
    status: 200,
    body: { success: true, score, passed, missedWords, note, feedback },
  };
}

// ── 진입점 ────────────────────────────────────────────
module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });
  try {
    ensureApp();
    const auth = getAuth();
    const db = getFirestore();
    const body = req.body || {};
    const { idToken, action } = body;

    const v = await _verifyAdmin(auth, idToken);
    if (v.error) return res.status(v.status).json({ success: false, error: v.error });

    let result;
    if (action === 'reEvaluateRecording') {
      result = await _reEvaluateRecording(db, body, idToken, v.caller);
    } else {
      return res.status(400).json({ success: false, error: 'action 미지원: ' + action });
    }

    return res.status(result.status).json(result.body);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, code: e.code });
  }
};
