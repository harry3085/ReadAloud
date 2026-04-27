// 호출자 인증 + 학원 쿼터 검증 공통 헬퍼.
//
// 사용:
//   const { verifyAndCheckQuota } = require('./_lib/quota');
//   const r = await verifyAndCheckQuota({ idToken, quotaKind: 'ai' });
//   if (r.error) return res.status(r.status).json({ error: r.error, ...r });
//   // r.academyId / r.callerUid / r.planId 사용
//
// quotaKind:
//   'ai'        — generate-quiz / cleanup-ocr / ocr  (aiCallsThisMonth vs limits.aiQuotaPerMonth)
//   'recording' — check-recording                    (recordingCallsThisMonth vs limits.perTypeQuota.recording.check)
//   'student'   — createStudent                      (activeStudentsCount vs studentLimit)

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function _ensureApp() {
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

function _currentYearMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

async function verifyAndCheckQuota({ idToken, quotaKind }) {
  if (!idToken) return { error: '인증 토큰이 필요합니다.', status: 401 };

  _ensureApp();
  const auth = getAuth();
  const db = getFirestore();

  // 1) 토큰 검증
  let caller;
  try { caller = await auth.verifyIdToken(idToken); }
  catch (e) { return { error: '유효하지 않은 토큰', status: 401, code: e.code }; }

  // 2) academyId 추출 (Custom Claims 우선, users 폴백)
  let academyId = caller.academyId || null;
  let role = caller.role || null;
  if (!academyId || !role) {
    try {
      const us = await db.doc('users/' + caller.uid).get();
      if (us.exists) {
        const ud = us.data();
        if (!academyId) academyId = ud.academyId || null;
        if (!role) role = ud.role || null;
      }
    } catch (_) {}
  }
  if (!academyId) return { error: '학원 정보 없음', status: 403 };

  // 3) academies + plan 조회
  const acadRef = db.doc('academies/' + academyId);
  const acadSnap = await acadRef.get();
  if (!acadSnap.exists) return { error: '학원 문서 없음', status: 404 };
  const academy = acadSnap.data();

  if (academy.billingStatus && academy.billingStatus !== 'active') {
    return { error: '학원이 비활성 상태입니다. 관리자에게 문의하세요.', status: 403 };
  }

  const planSnap = await db.doc('plans/' + (academy.planId || 'lite')).get();
  if (!planSnap.exists) return { error: '플랜 정보 없음', status: 500 };
  const plan = planSnap.data();
  const limits = plan.limits || {};

  // 4) 월 자동 리셋 (lastResetAt 이 이번 달과 다르면 카운터 0)
  const ym = _currentYearMonth();
  const usage = academy.usage || {};
  const needsReset = (usage.lastResetAt !== ym);

  // 5) 한도 체크
  let counterField = null;  // usage 의 어느 필드를 increment 할지
  let currentCount = 0;
  let limit = Infinity;
  let kindLabel = '';

  if (quotaKind === 'ai') {
    counterField = 'aiCallsThisMonth';
    currentCount = needsReset ? 0 : (usage.aiCallsThisMonth || 0);
    limit = limits.aiQuotaPerMonth || Infinity;
    kindLabel = 'AI 월 호출';
  } else if (quotaKind === 'recording') {
    counterField = 'recordingCallsThisMonth';
    currentCount = needsReset ? 0 : (usage.recordingCallsThisMonth || 0);
    limit = (limits.perTypeQuota && limits.perTypeQuota.recording && limits.perTypeQuota.recording.check) || Infinity;
    kindLabel = '녹음 평가 월';
  } else if (quotaKind === 'student') {
    counterField = null; // 별도 처리 — increment 가 아닌 추가 시점
    currentCount = usage.activeStudentsCount || 0;
    limit = academy.studentLimit || Infinity;
    kindLabel = '학생 수';
  } else {
    return { error: 'quotaKind 미지원: ' + quotaKind, status: 500 };
  }

  if (currentCount >= limit) {
    return {
      error: `${kindLabel} 한도 초과 (${currentCount}/${limit}). 플랜 업그레이드 또는 다음 달까지 대기.`,
      status: 429,
      limit, currentCount,
    };
  }

  return {
    callerUid: caller.uid,
    academyId,
    role,
    planId: academy.planId,
    limit,
    currentCount,
    counterField,
    needsReset,
    db, // 호출 측이 increment 할 때 재사용
    acadRef,
  };
}

// 호출 성공 후 카운터 증가 (호출자가 응답 직전에 호출)
async function incrementUsage({ acadRef, counterField, needsReset }) {
  if (!counterField) return;
  const update = { [`usage.${counterField}`]: FieldValue.increment(1) };
  if (needsReset) {
    update[`usage.lastResetAt`] = _currentYearMonth();
    // 다른 카운터들은 그대로 두고 (월별 리셋 대상만 분리하려면 별도 로직)
    update[`usage.${counterField}`] = 1; // 새 달이면 1로 시작
  }
  try { await acadRef.update(update); } catch (e) { /* silent */ }
}

module.exports = { verifyAndCheckQuota, incrementUsage };
