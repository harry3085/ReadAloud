// apiUsage 의 flat byEndpoint.X 필드를 nested byEndpoint: {X: ...} 로 변환.
//
// 이전 버그: setDoc({...,'byEndpoint.X':increment(1)},{merge:true}) 가 nested 가 아닌
//          flat 키로 저장됨. 위젯이 nested 만 읽어 count 0 으로 표시.
//
// 사용:
//   node scripts/migrate/fix-api-usage-nested.js          # DRY-RUN
//   node scripts/migrate/fix-api-usage-nested.js --apply  # 실제 변환

const { getDb } = require('../lib/firebase-admin');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== fix-api-usage-nested ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('apiUsage').get();
  const fixes = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const flatKeys = Object.keys(data).filter(k => k.startsWith('byEndpoint.'));
    if (flatKeys.length === 0) continue;
    const nested = data.byEndpoint || {};
    for (const fk of flatKeys) {
      const ep = fk.replace('byEndpoint.', '');
      nested[ep] = (nested[ep] || 0) + (data[fk] || 0);
    }
    fixes.push({ id: docSnap.id, flatKeys, nested });
  }

  console.log(`총 문서: ${snap.size}`);
  console.log(`수정 필요: ${fixes.length}\n`);

  for (const f of fixes.slice(0, 10)) {
    console.log(`  ${f.id}  flat=[${f.flatKeys.join(',')}]  →  byEndpoint=${JSON.stringify(f.nested)}`);
  }

  if (fixes.length === 0) { console.log('✅ 변환 불필요.\n'); process.exit(0); }
  if (!apply) { console.log(`\n(DRY-RUN) 실제 변환은 --apply 추가.\n`); process.exit(0); }

  // 문서 전체 set (merge 없이) — flat 키 제거 + nested 로 교체
  let done = 0;
  for (const f of fixes) {
    const ref = db.collection('apiUsage').doc(f.id);
    const snap = await ref.get();
    const data = snap.data() || {};
    // flat 키 제외하고 깨끗한 사본 만든 뒤 nested 추가
    const clean = {};
    for (const k of Object.keys(data)) {
      if (!k.startsWith('byEndpoint.') && k !== 'byEndpoint') clean[k] = data[k];
    }
    clean.byEndpoint = f.nested;
    await ref.set(clean);  // merge 없음 → 문서 전체 교체
    done++;
  }

  console.log(`\n✅ 완료: ${done}/${fixes.length} 건 변환됨\n`);
  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
