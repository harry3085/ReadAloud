// 플랜 정의 단일 소스 (plans/{lite|standard|pro})
//
// 근거 문서: plan-pricing-final.md, ai-features-integrated.md
// 수정 시 주의:
//   - 기존 학원에 바로 반영되지 않음. create-plans.js 재실행 필요.
//   - grandfathered 가격 보장 고객은 plans 문서를 따르지 않고 academies/{id}.grandfatheredPrice 사용.
//   - AI 쿼터(aiQuotaPerMonth)는 "임시값" — 실사용 데이터 확보 후 조정 필요.

const LITE = {
  id: 'lite',
  name: 'lite',
  displayName: 'Lite',
  order: 1,

  // ── 가격 (원) ──────────────────────────────────
  // 학생 수 구간별 월 요금. 100명 초과는 별도 협의.
  price: {
    tier30: 30000,
    tier60: 45000,
    tier100: 60000,
  },

  // ── 관리자 기능 ────────────────────────────────
  adminFeatures: {
    aiOcr: true,
    aiGenerator: true,
    vocabGenerator: true,
    fillBlankGenerator: true,
    mcqGenerator: true,           // Lite 도 사용 가능하되 perTypeQuota 로 맛보기 40회
    unscrambleGenerator: true,
    subjectiveGenerator: true,
    aiGrowthReport: false,
  },

  // ── 학생 기능 ──────────────────────────────────
  studentFeatures: {
    recordingSubmit: false,       // 녹음 제출+성실도 검증 (맛보기)
    recordingAiFeedback: false,   // AI 피드백 (Pro 예정)
    aiGrowthReport: false,
  },

  // ── 한도 ────────────────────────────────────────
  limits: {
    maxStudents: [30, 60, 100],   // 구간
    aiQuotaPerMonth: 200,         // ⚠️ 임시값. 이용 데이터 보고 조정.
    perTypeQuota: {
      mcq: 40,                    // 객관식 월 40회 맛보기
      unscramble: 40,
      subjective: 40,
      recording: { check: 50, feedback: 0 },  // 녹음 맛보기
    },
    storageGB: 20,
  },
};

const STANDARD = {
  id: 'standard',
  name: 'standard',
  displayName: 'Standard',
  order: 2,

  price: {
    tier30: 60000,
    tier60: 80000,
    tier100: 100000,
  },

  adminFeatures: {
    aiOcr: true,
    aiGenerator: true,
    vocabGenerator: true,
    fillBlankGenerator: true,
    mcqGenerator: true,
    unscrambleGenerator: true,
    subjectiveGenerator: true,
    aiGrowthReport: false,        // Phase 3 에서 맛보기 추가 예정
  },

  studentFeatures: {
    recordingSubmit: true,        // ✅ Standard 핵심 가치
    recordingAiFeedback: false,   // 🔜 Coming Soon (추후 Pro 전용)
    aiGrowthReport: false,
  },

  limits: {
    maxStudents: [30, 60, 100],
    aiQuotaPerMonth: 800,         // ⚠️ 임시값
    perTypeQuota: {
      // Std 는 각 생성기 무제한 (aiQuotaPerMonth 안에서)
      recording: { check: 1800, feedback: 0 },
    },
    storageGB: 50,
  },
};

const PRO = {
  id: 'pro',
  name: 'pro',
  displayName: 'Pro',
  order: 3,

  price: {
    tier30: 100000,
    tier60: 150000,
    tier100: 200000,
    // 100명 초과: 별도 협의 (10명당 +1만 기본)
  },

  adminFeatures: {
    aiOcr: true,
    aiGenerator: true,
    vocabGenerator: true,
    fillBlankGenerator: true,
    mcqGenerator: true,
    unscrambleGenerator: true,
    subjectiveGenerator: true,
    aiGrowthReport: 'taste_10',   // 출시 시 맛보기 월 10건 — Phase 3 에서 무제한 자동 발간
  },

  studentFeatures: {
    recordingSubmit: true,
    recordingAiFeedback: false,   // 🔜 Coming Soon
    aiGrowthReport: 'taste_10',
  },

  limits: {
    maxStudents: [30, 60, 100],
    aiQuotaPerMonth: 2000,        // ⚠️ 임시값
    perTypeQuota: {
      growthReport: 10,           // Pro 맛보기 월 10건
      recording: { check: 5500, feedback: 0 },
    },
    storageGB: 100,
  },
};

const ALL_PLANS = [LITE, STANDARD, PRO];

module.exports = { LITE, STANDARD, PRO, ALL_PLANS };
