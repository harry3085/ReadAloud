// plans/{lite|standard|pro} 문서를 upsert 합니다.
//
// 사용:
//   node scripts/admin/create-plans.js          # DRY-RUN (어떤 쓰기가 일어날지 출력만)
//   node scripts/admin/create-plans.js --apply  # 실제 쓰기
//
// 안전성:
//   - 기존 데이터 읽지 않고 덮어쓰지도 않음. 문서가 있으면 그대로 두고 merge:true 로 필드만 갱신.
//   - 언제든 재실행 가능 (idempotent).

const { getDb } = require('../lib/firebase-admin');
const { ALL_PLANS } = require('../lib/plans-schema');
const { FieldValue } = require('firebase-admin/firestore');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== create-plans ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  for (const plan of ALL_PLANS) {
    const ref = db.collection('plans').doc(plan.id);
    const snap = await ref.get();
    const exists = snap.exists;

    const payload = {
      ...plan,
      updatedAt: FieldValue.serverTimestamp(),
      ...(exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    };

    console.log(`• plans/${plan.id} (${plan.displayName}) — ${exists ? 'UPDATE' : 'CREATE'}`);
    const priceStr = Object.entries(plan.price).map(([k, v]) => `${k}=${v}`).join(' / ');
    console.log(`    price: ${priceStr} 원`);
    const tiers = Object.keys(plan.byTier || {});
    console.log(`    tiers: ${tiers.join('/')}명`);
    tiers.forEach(t => {
      const x = plan.byTier[t];
      console.log(`      [${t.padStart(3)}] OCR=${x.ocrPerMonth} Cleanup=${x.cleanupPerMonth} Gen=${x.generatorPerMonth} Rec=${x.recordingPerMonth} Growth=${x.growthReportPerMonth} ${x.storageGB}GB`);
    });

    if (apply) {
      await ref.set(payload, { merge: true });
    }
  }

  if (!apply) {
    console.log('\n(DRY-RUN) 실제 쓰려면 --apply 플래그를 추가하세요.\n');
  } else {
    console.log('\n✅ 완료\n');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[error]', err);
  process.exit(1);
});
