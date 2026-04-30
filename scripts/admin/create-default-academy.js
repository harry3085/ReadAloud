// academies/default 문서를 upsert 합니다.
// 기존 프로덕션 사용자를 모두 이 "default" 학원에 귀속시키는 것이 마이그레이션 전략.
//
// 사용:
//   node scripts/admin/create-default-academy.js            # DRY-RUN
//   node scripts/admin/create-default-academy.js --apply    # 실제 쓰기
//
// 안전성:
//   - merge:true 사용. 이미 존재하는 필드는 보존 (usage 카운터 등).
//   - 재실행 안전.

const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const DEFAULT_ACADEMY_ID = 'default';

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== create-default-academy ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const ref = db.collection('academies').doc(DEFAULT_ACADEMY_ID);
  const snap = await ref.get();
  const exists = snap.exists;

  const basePayload = {
    id: DEFAULT_ACADEMY_ID,
    name: '큰소리 영어',          // 필요 시 나중에 바꿀 수 있음
    subdomain: 'default',         // 학원코드 로그인용
    planId: 'pro',                // 기존 사용자는 모든 기능 유지
    billingStatus: 'active',
    studentLimit: 100,
    grandfatheredPrice: { enabled: false, monthlyPrice: 0, yearlyPrice: 0, grantedAt: null, note: '' },
    settings: {
      recordingIntegrity: {
        minVoiceActivity: 0.4,
        minDurationSec: 60,
        maxDurationSec: 600,
      },
    },
    updatedAt: FieldValue.serverTimestamp(),
  };

  const createOnlyPayload = {
    ...basePayload,
    subscribedAt: FieldValue.serverTimestamp(),
    planExpiresAt: null,          // default 학원은 운영팀 소유라 만료 없음
    usage: {
      activeStudentsCount: 0,     // 마이그레이션 스크립트에서 실제 카운트로 채움
      aiCallsThisMonth: 0,
      recordingCallsThisMonth: 0,
      lastResetAt: new Date().toISOString().slice(0, 7),
    },
    // SuperAdmin Phase A (T1) 신규 필드
    acquisitionChannel: '',
    internalMemo: '',
    featureFlags: { aiGrowthReport: false, recordingAiFeedback: false },
    contactLog: [],
    lastAdminLoginAt: null,
    createdAt: FieldValue.serverTimestamp(),
  };

  const payload = exists ? basePayload : createOnlyPayload;

  console.log(`• academies/${DEFAULT_ACADEMY_ID} — ${exists ? 'UPDATE (보존 필드 유지)' : 'CREATE'}`);
  console.log(`    planId: ${payload.planId}`);
  console.log(`    studentLimit: ${payload.studentLimit}`);
  console.log(`    billingStatus: ${payload.billingStatus}`);

  if (apply) {
    await ref.set(payload, { merge: true });
    console.log('\n✅ 완료\n');
  } else {
    console.log('\n(DRY-RUN) 실제 쓰려면 --apply 플래그를 추가하세요.\n');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('\n[error]', err);
  process.exit(1);
});
