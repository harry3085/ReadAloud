// scores 컬렉션의 옛 단어시험 mode 값을 표준 'vocab' 로 통일.
// 대상: mode in ('mixed', 'meaning', 'spelling')
// 이유: 학생앱 옛 버전이 단어시험 form 을 mode 필드에 직접 저장 →
//   _TYPE_LABEL_MAP 에 매칭 안 돼서 학원장 화면 유형 배지가 '-' 로 표시.
//
// 사용:
//   node scripts/migrate/unify-vocab-mode.js          # DRY-RUN
//   node scripts/migrate/unify-vocab-mode.js --apply  # 적용

const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const LEGACY_MODES = new Set(['mixed', 'meaning', 'spelling']);

(async () => {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== scores.mode 옛 단어시험 키 → 'vocab' 통일 ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('scores').get();
  console.log(`scores 총 ${snap.size}건`);

  const targets = [];        // [{id, oldMode, academyId, testName, date}]
  const dist = {};

  snap.forEach(d => {
    const data = d.data();
    const m = data.mode;
    if (!LEGACY_MODES.has(m)) return;
    targets.push({
      id: d.id,
      oldMode: m,
      academyId: data.academyId,
      testName: data.testName,
      date: data.date,
    });
    dist[m] = (dist[m] || 0) + 1;
  });

  console.log(`\n변경 대상: ${targets.length}건`);
  if (targets.length === 0) {
    console.log('(없음 — 이미 통일됨)\n');
    process.exit(0);
  }

  console.log('\n  값별 분포:');
  Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`    ${k.padEnd(12)} ${String(v).padStart(4)} 건  → 'vocab'`);
  });

  console.log('\n  샘플 (최대 5개):');
  targets.slice(0, 5).forEach(t => {
    console.log(`    ${t.id.slice(0, 24).padEnd(26)} ${t.oldMode.padEnd(10)} ${t.academyId || '-'}  ${t.date || '-'}  ${(t.testName || '-').slice(0, 40)}`);
  });

  if (!apply) {
    console.log('\n(DRY-RUN — --apply 로 실제 적용)\n');
    process.exit(0);
  }

  // 500건 단위 batch
  let done = 0;
  for (let i = 0; i < targets.length; i += 500) {
    const chunk = targets.slice(i, i + 500);
    const batch = db.batch();
    chunk.forEach(t => batch.update(db.doc(`scores/${t.id}`), {
      mode: 'vocab',
      _modeOldValue: t.oldMode,                 // 백업 필드 (이력)
      _modeMigratedAt: FieldValue.serverTimestamp(),
    }));
    await batch.commit();
    done += chunk.length;
    console.log(`  ✓ ${done}/${targets.length}`);
  }

  console.log(`\n✅ ${done}건 mode → 'vocab' 통일 완료. _modeOldValue 백업 필드 첨부됨.\n`);
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
