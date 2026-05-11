// Phase D: 녹음 파일 60일 자동 삭제 GCS Lifecycle Rule 설정
//
// recordings/genTests/* 경로의 60일 이상 객체 자동 삭제
// 학원 무관 일괄 적용 (정책 통일)
//
// 사용:
//   node scripts/admin/set-recording-lifecycle.js          (DRY-RUN — 현재 rule 확인 + 적용 후 결과 미리보기)
//   node scripts/admin/set-recording-lifecycle.js --apply  (실제 적용)

const { getStorage } = require('firebase-admin/storage');
require('../lib/firebase-admin').getDb();  // admin app 초기화

const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET || 'readaloud-51113.firebasestorage.app';

// 새 Lifecycle Rule — recordings/genTests/* 60일 자동 삭제
const NEW_RULE = {
  action: { type: 'Delete' },
  condition: {
    age: 60,
    matchesPrefix: ['recordings/genTests/'],
  },
};

(async () => {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.split('='); return [k.replace(/^--/, ''), v ?? true];
  }));
  const apply = !!args.apply;

  const storage = getStorage();
  const bucket = storage.bucket(BUCKET_NAME);

  console.log(`\n=== GCS Lifecycle Rule 설정 (${BUCKET_NAME}) ${apply ? '[APPLY]' : '[DRY-RUN]'} ===\n`);

  // 현재 lifecycle 확인
  const [meta] = await bucket.getMetadata();
  const currentLifecycle = meta.lifecycle || { rule: [] };
  const currentRules = currentLifecycle.rule || [];

  console.log(`현재 lifecycle 규칙: ${currentRules.length}개`);
  currentRules.forEach((r, i) => {
    console.log(`  [${i+1}] action=${JSON.stringify(r.action)} condition=${JSON.stringify(r.condition)}`);
  });

  // 이미 같은 prefix 의 rule 이 있는지 검사 (중복 회피)
  const hasRecordingsRule = currentRules.some(r =>
    r.action?.type === 'Delete' &&
    r.condition?.matchesPrefix?.some(p => p === 'recordings/genTests/' || p === 'recordings/genTests')
  );

  console.log(`\n신규 규칙 (계획):`);
  console.log(`  action=${JSON.stringify(NEW_RULE.action)} condition=${JSON.stringify(NEW_RULE.condition)}`);

  if (hasRecordingsRule) {
    console.log(`\n⚠ 이미 recordings/genTests/ 규칙이 있습니다.`);
    if (!apply) {
      console.log(`  --apply 시 기존 규칙 + 신규 규칙 모두 유지 (중복). 먼저 정리하거나 force 옵션 필요.`);
    }
  }

  if (!apply) {
    console.log(`\n(DRY-RUN — 실제 적용하려면 --apply 추가)`);
    process.exit(0);
  }

  // 신규 규칙 추가 (기존 규칙 유지, 중복 회피)
  const newRules = hasRecordingsRule
    ? currentRules  // 이미 있으면 그대로 (사용자가 명시 force 시에만 교체)
    : [...currentRules, NEW_RULE];

  if (hasRecordingsRule) {
    console.log(`\n기존 규칙 유지 — 변경 사항 없음.`);
    process.exit(0);
  }

  await bucket.setMetadata({ lifecycle: { rule: newRules } });
  console.log(`\n✓ Lifecycle 규칙 적용 완료`);
  console.log(`  recordings/genTests/* 의 60일 이상 객체는 GCS 가 매일 자동 삭제합니다.`);
  console.log(`  실제 삭제 시점은 객체 생성일 기준 60일 후 첫 lifecycle 실행 (보통 24시간 내).`);

  // 적용 후 확인
  const [meta2] = await bucket.getMetadata();
  console.log(`\n확인 — 최종 규칙 ${(meta2.lifecycle?.rule || []).length}개:`);
  (meta2.lifecycle?.rule || []).forEach((r, i) => {
    console.log(`  [${i+1}] action=${JSON.stringify(r.action)} condition=${JSON.stringify(r.condition)}`);
  });

  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
