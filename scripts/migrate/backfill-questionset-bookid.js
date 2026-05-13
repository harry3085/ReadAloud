// genQuestionSets 각 doc 에 bookId top-level 필드 backfill.
// 기존엔 sourcePages[].bookId 안에만 있어 server-side filter 불가능.
// → bookId top-level + composite index (academyId+bookId+createdAt desc) 로 Book 별 lazy 쿼리 가능하게.
//
// 규칙:
//   - sourcePages[].bookId 의 최빈값 (가장 많이 등장한 bookId) 으로 결정
//   - 모두 비어있으면 bookId='' (미지정)
//   - 이미 top-level bookId 있는 doc 은 skip
//
// 사용:
//   node scripts/migrate/backfill-questionset-bookid.js          # DRY-RUN
//   node scripts/migrate/backfill-questionset-bookid.js --apply  # 적용

const { getDb } = require('../lib/firebase-admin');

function primaryBookId(sourcePages) {
  const ids = (sourcePages || []).map(p => p?.bookId).filter(Boolean);
  if (!ids.length) return '';
  const counts = {};
  ids.forEach(id => counts[id] = (counts[id] || 0) + 1);
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

(async () => {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== backfill genQuestionSets.bookId ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('genQuestionSets').get();
  console.log(`총 세트 ${snap.size}개 발견\n`);

  const byStatus = { alreadyHasField: 0, willSet: 0, willSetEmpty: 0 };
  const targets = [];

  snap.docs.forEach(d => {
    const data = d.data();
    const hasTop = 'bookId' in data;
    const bid = primaryBookId(data.sourcePages);
    if (hasTop) {
      byStatus.alreadyHasField++;
      return;
    }
    if (bid) byStatus.willSet++;
    else byStatus.willSetEmpty++;
    targets.push({
      id: d.id,
      name: data.name || '(이름 없음)',
      academyId: data.academyId || '',
      sourceType: data.sourceType || '',
      bid,
    });
  });

  console.log(`상태 분포:`);
  console.log(`  - 이미 top-level bookId 있음 (skip): ${byStatus.alreadyHasField}`);
  console.log(`  - 신규 backfill (bookId 결정됨): ${byStatus.willSet}`);
  console.log(`  - 신규 backfill (미지정 빈값): ${byStatus.willSetEmpty}`);
  console.log(`  - 총 backfill 대상: ${targets.length}\n`);

  // 학원별 분포
  const byAcademy = {};
  targets.forEach(t => {
    byAcademy[t.academyId] = (byAcademy[t.academyId] || 0) + 1;
  });
  console.log(`학원별 분포:`);
  Object.entries(byAcademy).forEach(([aid, cnt]) => {
    console.log(`  ${aid}: ${cnt}개`);
  });
  console.log('');

  // 샘플 10건 출력
  console.log(`샘플 (최대 10건):`);
  targets.slice(0, 10).forEach(t => {
    console.log(`  ${t.id} (${t.sourceType}) [${t.academyId}] "${t.name}" → bookId="${t.bid}"`);
  });
  console.log('');

  if (!apply) {
    console.log('(DRY-RUN — --apply 로 실제 적용)\n');
    process.exit(0);
  }

  // batch 500 commit (Firestore 제한)
  let batch = db.batch();
  let inBatch = 0;
  let total = 0;
  for (const t of targets) {
    batch.update(db.doc(`genQuestionSets/${t.id}`), { bookId: t.bid });
    inBatch++;
    total++;
    if (inBatch >= 400) {
      await batch.commit();
      console.log(`  ✓ batch commit (${total}/${targets.length})`);
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) {
    await batch.commit();
    console.log(`  ✓ final batch commit (${total}/${targets.length})`);
  }

  console.log(`\n✅ ${total}개 세트 bookId backfill 완료\n`);
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
