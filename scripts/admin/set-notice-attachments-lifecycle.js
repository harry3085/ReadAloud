// 공지 첨부 파일 1년 자동 삭제 GCS Lifecycle Rule 설정
//
// notices/* 경로의 365일 이상 객체 자동 삭제 (안전망)
// 학원장이 공지별 만료일 지정 — 학생앱은 만료일 기준 다운로드 차단/표시.
// Storage 파일 자체는 1년까지 잔존, 그 후 GCS 자동 정리.
// 학원 무관 일괄 적용 (정책 통일)
//
// 사용:
//   node scripts/admin/set-notice-attachments-lifecycle.js          (DRY-RUN)
//   node scripts/admin/set-notice-attachments-lifecycle.js --apply  (실제 적용)

const { getStorage } = require('firebase-admin/storage');
require('../lib/firebase-admin').getDb();

const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET || 'readaloud-51113.firebasestorage.app';

const NEW_RULE = {
  action: { type: 'Delete' },
  condition: {
    age: 365,
    matchesPrefix: ['notices/'],
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

  const [meta] = await bucket.getMetadata();
  const currentLifecycle = meta.lifecycle || { rule: [] };
  const currentRules = currentLifecycle.rule || [];

  console.log(`현재 lifecycle 규칙: ${currentRules.length}개`);
  currentRules.forEach((r, i) => {
    console.log(`  [${i+1}] action=${JSON.stringify(r.action)} condition=${JSON.stringify(r.condition)}`);
  });

  const hasRule = currentRules.some(r =>
    r.action?.type === 'Delete' &&
    r.condition?.matchesPrefix?.some(p => p === 'notices/' || p === 'notices')
  );

  console.log(`\n신규 규칙 (계획):`);
  console.log(`  action=${JSON.stringify(NEW_RULE.action)} condition=${JSON.stringify(NEW_RULE.condition)}`);

  if (hasRule) {
    console.log(`\n이미 notices/ 규칙이 있습니다 — 변경 없음.`);
    process.exit(0);
  }

  if (!apply) {
    console.log(`\n(DRY-RUN — 실제 적용하려면 --apply 추가)`);
    process.exit(0);
  }

  const newRules = [...currentRules, NEW_RULE];
  await bucket.setMetadata({ lifecycle: { rule: newRules } });
  console.log(`\nLifecycle 규칙 적용 완료`);
  console.log(`  notices/* 의 365일 이상 객체는 GCS 가 매일 자동 삭제합니다.`);

  const [meta2] = await bucket.getMetadata();
  console.log(`\n확인 — 최종 규칙 ${(meta2.lifecycle?.rule || []).length}개:`);
  (meta2.lifecycle?.rule || []).forEach((r, i) => {
    console.log(`  [${i+1}] action=${JSON.stringify(r.action)} condition=${JSON.stringify(r.condition)}`);
  });

  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
