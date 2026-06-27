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
  // 시스템 표준 Custom Claims = 'academy_admin' (createAcademy.js 등 다른 API 와 일관)
  // 'admin' 도 폴백 허용 (만일 다른 학원장이 다른 값으로 박혀있어도 통과)
  const r = caller.role;
  const isAdmin = (r === 'academy_admin' || r === 'admin');
  if (!isAdmin && r !== 'super_admin') {
    return { error: '학원장 권한 필요', status: 403 };
  }
  if (isAdmin && !caller.academyId) {
    return { error: 'academyId 없음 (재로그인 필요)', status: 403 };
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
  const isSuper = caller.role === 'super_admin';
  if (!isSuper && t.academyId !== caller.academyId) {
    return { status: 403, body: { success: false, error: '다른 학원 시험' } };
  }

  // 학생 응시 정보
  const ucRef = db.doc(`genTests/${testId}/userCompleted/${uid}`);
  const ucSnap = await ucRef.get();
  if (!ucSnap.exists) return { status: 404, body: { success: false, error: '응시 기록 없음' } };
  const c = ucSnap.data();
  const recs = Array.isArray(c.recordings) ? c.recordings : [];

  // 학생 프로필 (group / name 등) — scores 누락 방지
  let studentProfile = {};
  try {
    const uSnap = await db.doc(`users/${uid}`).get();
    if (uSnap.exists) studentProfile = uSnap.data();
  } catch (_) {}
  if (!recs.length) {
    return { status: 400, body: { success: false, error: 'audio 없음 — Storage 에서 찾아야 함' } };
  }
  const last = recs[recs.length - 1];
  if (!last.audioUrl) {
    return { status: 400, body: { success: false, error: '마지막 회차 audioUrl 없음' } };
  }

  // 질문 정보 (Phase B: passScore 폐기)
  const q = (Array.isArray(t.questions) && t.questions[0]) || {};
  const fullText = q.fullText || '';
  if (!fullText) return { status: 400, body: { success: false, error: 'fullText 없음' } };
  const evalSec = (typeof q.evaluationSeconds === 'number') ? q.evaluationSeconds : 0;

  // check-recording self-call (caller 학원 한도 차감)
  // public alias (raloud.vercel.app) 사용 — VERCEL_URL (deployment-specific) 는
  // Vercel Authentication 보호로 HTML 응답 받을 수 있어 회피
  const host = process.env.SELF_HOST || 'https://raloud.vercel.app';
  // 진단 로그 — 학생별 재평가 비교 (Vercel 로그에서 확인)
  console.log(`[reEval][${uid.slice(0,8)}] start: testId=${testId.slice(0,8)} audioUrl=${last.audioUrl.slice(0, 80)}... mime=${last.mimeType || 'audio/webm'} evalSec=${evalSec} fullTextLen=${fullText.length}`);

  // 본문 단어수 + 예상/실제 길이 — 완독률 계산용 (2026-06-27 옵션 B)
  const _ftWords = String(fullText || '').trim().split(/\s+/).filter(Boolean).length;
  const _expectedDur = _ftWords >= 30 ? Math.round((_ftWords / 150) * 60) : null;
  const _actualDur = parseInt(last.duration) || 0;

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
        wordCount: _ftWords,
        expectedDuration: _expectedDur,
        actualDuration: _actualDur,
      }),
    });
    // HTML 응답 방어 (Vercel Auth 보호 등) — JSON 파싱 전 Content-Type 검사
    const ct = cr.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await cr.text().catch(() => '');
      console.error('[adminAction] non-JSON response from check-recording:', cr.status, text.slice(0, 200));
      return {
        status: 502,
        body: { success: false, error: `평가 서버 응답 이상 (${cr.status}). 잠시 후 다시 시도해주세요.` },
      };
    }
    data = await cr.json();
    if (!cr.ok || !data.success) {
      console.error(`[reEval][${uid.slice(0,8)}] check-recording 실패: ${cr.status} ${data?.error || ''}`);
      return {
        status: cr.status || 502,
        body: { success: false, error: '평가 실패: ' + (data?.error || cr.status) },
      };
    }
    // 진단 로그 — 학생별 응답 비교 (audio 영향 받았나)
    const csLog = data.categoryScores || {};
    console.log(`[reEval][${uid.slice(0,8)}] response: score=${data.score} cs=${csLog.pronunciation}/${csLog.intonation}/${csLog.pace}/${csLog.accuracy} note="${(data.note||'').slice(0,40)}..."`);
  } catch (e) {
    return { status: 502, body: { success: false, error: 'check-recording 호출 실패: ' + (e.message || 'unknown') } };
  }

  // 결과 정리 — Phase C 신규 필드 (positives/intonation/stress) + categoryScores/Comments
  const score = Math.max(0, Math.min(100, parseInt(data.score) || 0));
  const missedWords = Array.isArray(data.missedWords) ? data.missedWords : [];
  const note = String(data.note || '');
  const feedback = data.feedback || { missedWords: [], weakPronunciation: [], tips: [], positives: [], intonation: '', stress: '' };
  const categoryScores = data.categoryScores || null;
  const categoryComments = data.categoryComments || null;
  const today = _ymdKST();

  // 마지막 회차에 평가 결과 박음 (Phase C 카테고리 정보 포함)
  const newRecs = recs.slice();
  const newLast = { ...last, score, missedWords, note, feedback };
  if (categoryScores) newLast.categoryScores = categoryScores;
  if (categoryComments) newLast.categoryComments = categoryComments;
  // 완독률 — AI 의 transcribedWords 매칭 결과 (2026-06-27 옵션 B 재평가 보완)
  if (typeof data.completionRate === 'number') newLast.completionRate = data.completionRate;
  if (typeof data.bookWordCount === 'number') newLast.bookWordCount = data.bookWordCount;
  if (typeof data.heardWordCount === 'number') newLast.heardWordCount = data.heardWordCount;
  newRecs[newRecs.length - 1] = newLast;

  // userCompleted 업데이트 — Phase B: 통과/불통 폐기, completedAt 단일 흐름
  await ucRef.set({
    uid, userName: c.userName || '',
    score,
    passed: true,
    date: today,
    recordings: newRecs,
    completedAt: FieldValue.serverTimestamp(),
    // cleanup 옛 미통과/에러 마커
    latestFailedScore: FieldValue.delete(),
    latestFailedAt: FieldValue.delete(),
    latestErrorStage: null,
    latestErrorMessage: null,
    latestAttemptAt: null,
    reEvaluatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // scores 컬렉션 add (성적 리포트 반영용) — Phase B: passed=true 일관
  // 학생앱 _rv2Submit 의 scoresPayload 와 동일 필드 (성적 리포트 누락 방지)
  const studentName = c.userName || studentProfile.name || '';
  const studentGroup = studentProfile.group || '';
  await db.collection('scores').add({
    academyId: t.academyId,
    uid,
    userId: uid,
    userName: studentName,
    name: studentName,
    group: studentGroup,
    testId,
    testName: t.name || '',
    unitId: testId,
    unitName: t.name || '',
    bookName: t.bookName || '',
    mode: 'recording',
    score,
    correct: 1,
    wrong: 0,
    total: 1,
    passed: true,
    recordings: newRecs,
    date: today,
    createdAt: FieldValue.serverTimestamp(),
    reEvaluated: true,
  });

  return {
    status: 200,
    body: { success: true, score, missedWords, note, feedback, categoryScores, categoryComments },
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
