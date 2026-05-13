// userCompleted 서브컬렉션 doc 의 필드 구조 진단
// - doc ID 가 uid 인지 (collectionGroup + documentId() == myUid 가능 여부)
// - 필드에 uid / academyId 박혀있는지 (where 절 가능 여부)
// - 학원별 doc 수 카운트
// 사용: node scripts/diag/check-user-completed-fields.js

const { getDb } = require('../lib/firebase-admin');

(async () => {
  const db = getDb();
  console.log('\n=== userCompleted 서브컬렉션 진단 ===\n');

  // collectionGroup 으로 전체 userCompleted 샘플 fetch
  const snap = await db.collectionGroup('userCompleted').limit(50).get();
  console.log(`샘플 ${snap.size}건 검사\n`);

  if (snap.empty) {
    console.log('userCompleted doc 없음 — 진단 불가');
    process.exit(0);
  }

  // 1. 필드 존재율 검사
  const fieldCount = { uid: 0, academyId: 0, score: 0, latestScore: 0, latestAt: 0, completedAt: 0 };
  const docIdIsUid = []; // doc.id 가 uid 와 같은지

  for (const doc of snap.docs) {
    const data = doc.data();
    for (const f of Object.keys(fieldCount)) {
      if (data[f] !== undefined && data[f] !== null) fieldCount[f]++;
    }
    // doc.id 가 uid 와 일치하는지 (uid 필드 있는 경우)
    if (data.uid && doc.id === data.uid) docIdIsUid.push(true);
    else if (data.uid && doc.id !== data.uid) docIdIsUid.push(false);
  }

  console.log('────── 1) 필드 존재율 ──────');
  for (const f of Object.keys(fieldCount)) {
    const pct = ((fieldCount[f] / snap.size) * 100).toFixed(0);
    console.log(`  ${f}: ${fieldCount[f]}/${snap.size} (${pct}%)`);
  }

  // 2. doc ID == uid 검증
  console.log('\n────── 2) doc.id == uid 일치 여부 ──────');
  const matchCount = docIdIsUid.filter(v => v === true).length;
  const mismatchCount = docIdIsUid.filter(v => v === false).length;
  console.log(`  일치: ${matchCount} / 불일치: ${mismatchCount} (uid 필드 있는 doc 중)`);

  // 3. 학원별 분포
  console.log('\n────── 3) 학원별 doc 수 (샘플 기준) ──────');
  const byAcademy = {};
  for (const doc of snap.docs) {
    const a = doc.data().academyId || '(none)';
    byAcademy[a] = (byAcademy[a] || 0) + 1;
  }
  for (const a of Object.keys(byAcademy)) {
    console.log(`  ${a}: ${byAcademy[a]}건`);
  }

  // 4. 샘플 1건 dump (구조 시각화)
  console.log('\n────── 4) 샘플 doc 1건 (전체 필드) ──────');
  const sample = snap.docs[0];
  console.log(`  path: ${sample.ref.path}`);
  console.log(`  doc.id: ${sample.id}`);
  console.log(`  data:`, JSON.stringify(sample.data(), null, 2));

  // 5. batch query 가능 방식 추천
  console.log('\n────── 5) batch query 가능 방식 ──────');
  if (fieldCount.uid === snap.size) {
    console.log('  ✓ where("uid","==", myUid) collectionGroup query 가능 (모든 doc 에 uid 필드 있음)');
  } else if (matchCount === docIdIsUid.length && docIdIsUid.length > 0) {
    console.log('  ✓ where(documentId(),"==", myUid) collectionGroup query 가능 (doc.id == uid)');
  } else {
    console.log('  ⚠ 필드 박힘 불일치 — 마이그레이션 또는 다른 방식 필요');
  }
  if (fieldCount.academyId < snap.size) {
    console.log(`  ⚠ academyId 필드 부족 (${fieldCount.academyId}/${snap.size}) — Rules 검증 통과 어려울 수 있음`);
  }

  process.exit(0);
})();
