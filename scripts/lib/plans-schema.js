// 플랜 정의 단일 소스 (plans/{free|lite|standard|pro})
//
// 정책 (2026-05-01 갱신 — T1 한도 재설계):
//   - 모든 플랜이 모든 기능 사용 가능 (맛보기). 차별은 월 한도(byTier)로만.
//   - 학생 수 구간(30/60/100명)에 따라 한도 차등화 — plan.byTier[tier] 구조
//   - Free 는 tier10 단일 (체험용)
//   - 5분류 한도: ocrPerMonth / cleanupPerMonth / generatorPerMonth / recordingPerMonth / growthReportPerMonth
//   - 수정 시 create-plans.js 재실행 (merge:true, idempotent)
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

// 학생 시험 티어 — 맛보기/핵심 구분 (T6 이후 UI 활용)
const STUDENT_TEST_TIERS = {
  free:     { core: [],                                                       preview: ['vocab','fillBlank','unscramble','mcq','subjective'] },
  lite:     { core: ['vocab','fillBlank'],                                    preview: ['unscramble','mcq','subjective'] },
  standard: { core: ['vocab','fillBlank','unscramble','mcq'],                 preview: ['subjective'] },
  pro:      { core: ['vocab','fillBlank','unscramble','mcq','subjective'],    preview: [] },
};

const FREE = {
  id: 'free',
  name: 'free',
  displayName: 'Free',
  order: 0,

  price: { tier10: 0 },  // Free 는 학생 10명 단일 구간

  adminFeatures: ADMIN_FEATURES_ALL,
  studentFeatures: STUDENT_FEATURES_ALL,
  studentTestTiers: STUDENT_TEST_TIERS.free,

  byTier: {
    "10": {
      maxStudents: 10,
      ocrPerMonth: 30,
      cleanupPerMonth: 60,
      generatorPerMonth: 50,
      recordingPerMonth: 60,
      growthReportPerMonth: 10,
      storageGB: 1,
    },
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
  studentTestTiers: STUDENT_TEST_TIERS.lite,

  byTier: {
    "30": {
      maxStudents: 30,
      ocrPerMonth: 150,
      cleanupPerMonth: 300,
      generatorPerMonth: 100,
      recordingPerMonth: 100,
      growthReportPerMonth: 10,
      storageGB: 5,
    },
    "60": {
      maxStudents: 60,
      ocrPerMonth: 200,
      cleanupPerMonth: 400,
      generatorPerMonth: 130,
      recordingPerMonth: 100,
      growthReportPerMonth: 10,
      storageGB: 10,
    },
    "100": {
      maxStudents: 100,
      ocrPerMonth: 250,
      cleanupPerMonth: 500,
      generatorPerMonth: 180,
      recordingPerMonth: 100,
      growthReportPerMonth: 10,
      storageGB: 20,
    },
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
  studentTestTiers: STUDENT_TEST_TIERS.standard,

  byTier: {
    "30": {
      maxStudents: 30,
      ocrPerMonth: 200,
      cleanupPerMonth: 400,
      generatorPerMonth: 150,
      recordingPerMonth: 400,
      growthReportPerMonth: 10,
      storageGB: 20,
    },
    "60": {
      maxStudents: 60,
      ocrPerMonth: 280,
      cleanupPerMonth: 560,
      generatorPerMonth: 200,
      recordingPerMonth: 600,
      growthReportPerMonth: 10,
      storageGB: 40,
    },
    "100": {
      maxStudents: 100,
      ocrPerMonth: 350,
      cleanupPerMonth: 700,
      generatorPerMonth: 250,
      recordingPerMonth: 800,
      growthReportPerMonth: 10,
      storageGB: 60,
    },
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
  studentTestTiers: STUDENT_TEST_TIERS.pro,

  byTier: {
    "30": {
      maxStudents: 30,
      ocrPerMonth: 300,
      cleanupPerMonth: 600,
      generatorPerMonth: 250,
      recordingPerMonth: 1500,
      growthReportPerMonth: 90,
      storageGB: 50,
    },
    "60": {
      maxStudents: 60,
      ocrPerMonth: 400,
      cleanupPerMonth: 800,
      generatorPerMonth: 350,
      recordingPerMonth: 3000,
      growthReportPerMonth: 180,
      storageGB: 100,
    },
    "100": {
      maxStudents: 100,
      ocrPerMonth: 500,
      cleanupPerMonth: 1000,
      generatorPerMonth: 500,
      recordingPerMonth: 5000,
      growthReportPerMonth: 300,
      storageGB: 200,
    },
  },
};

const ALL_PLANS = [FREE, LITE, STANDARD, PRO];

module.exports = { FREE, LITE, STANDARD, PRO, ALL_PLANS, STUDENT_TEST_TIERS };
