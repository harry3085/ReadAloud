// 학원의 실효 한도 계산 — plan.byTier[tier] + academy.customLimits 병합.
// api/_lib/quota-helper.js 의 미러 (로컬 스크립트용).
// 두 파일은 항상 동기 유지 — 한 쪽 수정 시 다른 쪽도 함께 갱신.
//
// 우선순위: customLimits > byTier[학생 구간] > byTier['30'] (Free 는 ['10']) > Infinity
//
// 사용:
//   const { getEffectiveLimits } = require('../lib/quota-helper');
//   const limits = getEffectiveLimits(planDoc, academyDoc);
//   if (currentCount >= limits.ocrPerMonth) { /* 차단 */ }

function getEffectiveLimits(plan, academy) {
  const tier = String(academy.studentLimit || 30);
  const byTier = (plan && plan.byTier) || {};
  // Free 는 byTier['10'] 단일, 나머지는 30/60/100 — 못 찾으면 첫 키 폴백
  const planLimits = byTier[tier] || byTier['30'] || byTier[Object.keys(byTier)[0]] || {};
  const customLimits = (academy && academy.customLimits) || {};

  return {
    ocrPerMonth:          customLimits.ocrPerMonth          ?? planLimits.ocrPerMonth          ?? Infinity,
    cleanupPerMonth:      customLimits.cleanupPerMonth      ?? planLimits.cleanupPerMonth      ?? Infinity,
    generatorPerMonth:    customLimits.generatorPerMonth    ?? planLimits.generatorPerMonth    ?? Infinity,
    recordingPerMonth:    customLimits.recordingPerMonth    ?? planLimits.recordingPerMonth    ?? Infinity,
    growthReportPerMonth: customLimits.growthReportPerMonth ?? planLimits.growthReportPerMonth ?? Infinity,
    storageGB:            customLimits.storageGB            ?? planLimits.storageGB            ?? Infinity,
    maxStudents:          customLimits.maxStudents          ?? planLimits.maxStudents          ?? 0,
  };
}

module.exports = { getEffectiveLimits };
