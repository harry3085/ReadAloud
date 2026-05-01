// 학원의 실효 한도 계산 — plan.byTier[tier] + academy.customLimits 병합.
// scripts/lib/quota-helper.js 의 서버 사이드 미러 (Vercel API 함수에서 require 용).
//
// 우선순위: customLimits > byTier[학생 구간] > byTier['30'] (Free 는 ['10']) > Infinity
//
// 사용:
//   const { getEffectiveLimits } = require('./_lib/quota-helper');
//   const limits = getEffectiveLimits(planDoc, academyDoc);
//   if (currentCount >= limits.ocrPerMonth) { /* 차단 */ }

function getEffectiveLimits(plan, academy) {
  const tier = String(academy.studentLimit || 30);
  const byTier = (plan && plan.byTier) || {};
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
