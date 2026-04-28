// 플랜 정의 단일 소스 (plans/{free|lite|standard|pro})
//
// 정책 (2026-04-28 갱신):
//   - 모든 플랜이 모든 기능 사용 가능 (맛보기). 차별은 월 한도(limits)로만.
//   - Free 플랜 신규 추가 — 무료 사용자/체험용
//   - 수정 시 create-plans.js 재실행 필요
//   - grandfathered 가격 보장 고객은 academies/{id}.grandfatheredPrice 사용

// 모든 플랜 공통 — 모든 기능 ON (맛보기 정책)
const ADMIN_FEATURES_ALL = {
  aiOcr: true,
  aiGenerator: true,
  vocabGenerator: true,
  fillBlankGenerator: true,
  mcqGenerator: true,
  unscrambleGenerator: true,
  subjectiveGenerator: true,
  aiGrowthReport: true,
};

const STUDENT_FEATURES_ALL = {
  recordingSubmit: true,
  recordingAiFeedback: true,
  aiGrowthReport: true,
};

const FREE = {
  id: 'free',
  name: 'free',
  displayName: 'Free',
  order: 0,

  price: {
    tier30: 0,
    tier60: 0,
    tier100: 0,
  },

  adminFeatures: ADMIN_FEATURES_ALL,
  studentFeatures: STUDENT_FEATURES_ALL,

  limits: {
    maxStudents: [5],            // 무료는 5명까지
    aiQuotaPerMonth: 20,         // 맛보기 — 월 20회
    perTypeQuota: {
      recording: { check: 30, feedback: 5 },
    },
    storageGB: 1,
  },
};

const LITE = {
  id: 'lite',
  name: 'lite',
  displayName: 'Lite',
  order: 1,

  price: {
    tier30: 30000,
    tier60: 45000,
    tier100: 60000,
  },

  adminFeatures: ADMIN_FEATURES_ALL,
  studentFeatures: STUDENT_FEATURES_ALL,

  limits: {
    maxStudents: [30, 60, 100],
    aiQuotaPerMonth: 200,
    perTypeQuota: {
      recording: { check: 50, feedback: 10 },
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

  adminFeatures: ADMIN_FEATURES_ALL,
  studentFeatures: STUDENT_FEATURES_ALL,

  limits: {
    maxStudents: [30, 60, 100],
    aiQuotaPerMonth: 800,
    perTypeQuota: {
      recording: { check: 1800, feedback: 100 },
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
  },

  adminFeatures: ADMIN_FEATURES_ALL,
  studentFeatures: STUDENT_FEATURES_ALL,

  limits: {
    maxStudents: [30, 60, 100],
    aiQuotaPerMonth: 2000,
    perTypeQuota: {
      recording: { check: 5500, feedback: 500 },
    },
    storageGB: 100,
  },
};

const ALL_PLANS = [FREE, LITE, STANDARD, PRO];

module.exports = { FREE, LITE, STANDARD, PRO, ALL_PLANS };
