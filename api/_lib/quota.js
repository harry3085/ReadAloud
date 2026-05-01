// 호출자 인증 + 학원 쿼터 검증 공통 헬퍼.
//
// 사용:
//   const { verifyAndCheckQuota } = require('./_lib/quota');
//   const r = await verifyAndCheckQuota({ idToken, quotaKind: 'generator' });
//   if (r.error) return res.status(r.status).json({ error: r.error, ...r });
//   // r.academyId / r.callerUid / r.planId 사용
//
// quotaKind (T1 plans byTier 차등화 + T2 5분류 분리):
//   'ocr'          — api/ocr.js              (ocrCallsThisMonth       vs byTier[tier].ocrPerMonth)
//   'cleanup'      — api/cleanup-ocr.js      (cleanupCallsThisMonth   vs byTier[tier].cleanupPerMonth)
//   'generator'    — api/generate-quiz.js    (generatorCallsThisMonth vs byTier[tier].generatorPerMonth)
//   'recording'    — api/check-recording.js  (recordingCallsThisMonth vs byTier[tier].recordingPerMonth)
//   'growthReport' — api/growth-report.js    (growthReportThisMonth   vs byTier[tier].growthReportPerMonth)
//   'student'      — api/createStudent.js    (activeStudentsCount     vs studentLimit / customLimits.maxStudents)
//   'ai' (deprecated) — generator 로 자동 매핑 + 콘솔 경고

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
  // KST(UTC+9) 기준 YYYY-MM — apiUsage doc ID 와 동일 기준
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

// 5분류 한도 매핑 — counterField (academies.usage), limitField (plan.byTier[tier])
const QUOTA_CONFIG = {
  ocr:          { counterField: 'ocrCallsThisMonth',       limitField: 'ocrPerMonth',          label: 'OCR' },
  cleanup:      { counterField: 'cleanupCallsThisMonth',   limitField: 'cleanupPerMonth',      label: 'Cleanup' },
  generator:    { counterField: 'generatorCallsThisMonth', limitField: 'generatorPerMonth',    label: 'Generator' },
  recording:    { counterField: 'recordingCallsThisMonth', limitField: 'recordingPerMonth',    label: '녹음 평가' },
  growthReport: { counterField: 'growthReportThisMonth',   limitField: 'growthReportPerMonth', label: '성장 리포트' },
};

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
  const overrides = academy.customLimits || {};  // 학원별 override (있으면 byTier 무시)

  // 4) 월 자동 리셋 (lastResetAt 이 이번 달과 다르면 카운터 0)
  const ym = _currentYearMonth();
  const usage = academy.usage || {};
  const needsReset = (usage.lastResetAt !== ym);

  // 4.5) 'ai' 는 deprecated — generator 로 매핑 (T3 호환성)
  if (quotaKind === 'ai') {
    console.warn('[quota] quotaKind=ai is deprecated, use "generator" instead');
    quotaKind = 'generator';
  }

  // 5) 한도 체크 (customLimits 우선, 없으면 plan.byTier[tier])
  let counterField = null;  // usage 의 어느 필드를 increment 할지
  let currentCount = 0;
  let limit = Infinity;
  let kindLabel = '';

  if (quotaKind === 'student') {
    counterField = null; // 별도 처리 — increment 가 아닌 추가 시점
    currentCount = usage.activeStudentsCount || 0;
    limit = overrides.maxStudents ?? academy.studentLimit ?? Infinity;
    kindLabel = '학생 수';
  } else if (QUOTA_CONFIG[quotaKind]) {
    const cfg = QUOTA_CONFIG[quotaKind];
    counterField = cfg.counterField;
    currentCount = needsReset ? 0 : (usage[cfg.counterField] || 0);

    // plan.byTier[tier] 우선, 없으면 ['30'], 그것도 없으면 첫 키, 최종 Infinity
    const tier = String(academy.studentLimit || 30);
    const byTier = plan.byTier || {};
    const tierLimits = byTier[tier] || byTier['30'] || byTier[Object.keys(byTier)[0]] || {};
    limit = overrides[cfg.limitField] ?? tierLimits[cfg.limitField] ?? Infinity;

    kindLabel = cfg.label;
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
    kindLabel,
    needsReset,
    db, // 호출 측이 increment 할 때 재사용
    acadRef,
  };
}

// 월별 자동 리셋 대상 카운터 — 새 달 첫 호출 시 모두 0 으로 리셋
const ALL_MONTHLY_COUNTERS = [
  'ocrCallsThisMonth',
  'cleanupCallsThisMonth',
  'generatorCallsThisMonth',
  'recordingCallsThisMonth',
  'growthReportThisMonth',
];

// 호출 성공 후 카운터 증가 (호출자가 응답 직전에 호출)
// res 를 같이 넘기면 X-Quota-* 응답 헤더 자동 set (T8 — 학원장 앱 토스트용)
async function incrementUsage({ acadRef, counterField, needsReset, res, currentCount, limit, kindLabel }) {
  if (!counterField) return;
  const update = { [`usage.${counterField}`]: FieldValue.increment(1) };
  if (needsReset) {
    update[`usage.lastResetAt`] = _currentYearMonth();
    // 모든 월별 카운터 0 으로 리셋, 자기 자신만 1 로 시작
    // (이전 버전은 자기 카운터만 1 로 리셋해서 다른 분류는 4월 값이 잔존하던 버그)
    for (const c of ALL_MONTHLY_COUNTERS) {
      update[`usage.${c}`] = (c === counterField) ? 1 : 0;
    }
  }
  try { await acadRef.update(update); } catch (e) { /* silent */ }

  // 응답 헤더로 사용량 통보 (한도 무한 또는 res 미지정 시 skip)
  if (res && typeof res.setHeader === 'function' && typeof limit === 'number' && isFinite(limit) && limit > 0) {
    const after = (typeof currentCount === 'number' ? currentCount : 0) + 1;
    const pct = Math.round((after / limit) * 100);
    try {
      res.setHeader('X-Quota-Used', String(after));
      res.setHeader('X-Quota-Limit', String(limit));
      res.setHeader('X-Quota-Percent', String(pct));
      if (kindLabel) res.setHeader('X-Quota-Kind', encodeURIComponent(kindLabel));
    } catch (_) {}
  }
}

module.exports = { verifyAndCheckQuota, incrementUsage };
