// Book.name 과 genChapters.bookName / genPages.bookName 불일치 백필.
// 원인: genDoEditBook 이 메모리 캐시 기반 동기였어 lazy 미로드 chapter/page 누락.
// 코드 수정 2026-05-30 (Firestore 직접 쿼리) 이전에 발생한 불일치만 정리.
//
// DRY-RUN 기본. 적용은 `node scripts/migrate/backfill-book-name-sync.js --apply`

const { getDb } = require('../lib/firebase-admin');

const APPLY = process.argv.includes('--apply');

(async () => {
  const db = getDb();
  const booksSnap = await db.collection('genBooks').get();
  console.log(`\n[mode=${APPLY ? 'APPLY' : 'DRY-RUN'}] genBooks 전체 ${booksSnap.size}건 스캔\n`);

  const bookById = {};
  booksSnap.forEach(d => { bookById[d.id] = { name: d.data().name, academyId: d.data().academyId }; });

  // chapter 스캔
  const chSnap = await db.collection('genChapters').get();
  let chMismatch = 0, chOrphan = 0;
  const chFixes = [];
  chSnap.forEach(d => {
    const c = d.data();
    if (!c.bookId) return; // 미지정 chapter — 동기 대상 아님
    const real = bookById[c.bookId];
    if (!real) {
      chOrphan++;
      return; // orphan — 별도 처리
    }
    if (real.name !== c.bookName) {
      chMismatch++;
      chFixes.push({ ref: d.ref, id: d.id, name: c.name, oldBookName: c.bookName, newBookName: real.name, academyId: c.academyId });
    }
  });

  // page 스캔
  const pgSnap = await db.collection('genPages').get();
  let pgMismatch = 0, pgOrphan = 0;
  const pgFixes = [];
  pgSnap.forEach(d => {
    const p = d.data();
    if (!p.bookId) return;
    const real = bookById[p.bookId];
    if (!real) {
      pgOrphan++;
      return;
    }
    if (real.name !== p.bookName) {
      pgMismatch++;
      pgFixes.push({ ref: d.ref, id: d.id, title: p.title, oldBookName: p.bookName, newBookName: real.name, academyId: p.academyId });
    }
  });

  console.log(`Chapter: 전체 ${chSnap.size} · 불일치 ${chMismatch} · orphan(bookId 가리키는 Book 없음) ${chOrphan}`);
  console.log(`Page:    전체 ${pgSnap.size} · 불일치 ${pgMismatch} · orphan ${pgOrphan}\n`);

  if (chFixes.length) {
    console.log(`=== Chapter 불일치 상세 ===`);
    chFixes.forEach(f => {
      console.log(`  [aca=${f.academyId}] ${f.id} "${f.name}" :: "${f.oldBookName}" → "${f.newBookName}"`);
    });
  }
  if (pgFixes.length) {
    console.log(`\n=== Page 불일치 상세 (최대 30건 표시) ===`);
    pgFixes.slice(0, 30).forEach(f => {
      console.log(`  [aca=${f.academyId}] ${f.id} "${f.title}" :: "${f.oldBookName}" → "${f.newBookName}"`);
    });
    if (pgFixes.length > 30) console.log(`  ... ${pgFixes.length - 30}건 더`);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] 적용하려면 --apply 추가`);
    process.exit(0);
  }

  if (!chFixes.length && !pgFixes.length) {
    console.log(`\n불일치 없음 — 변경 없이 종료`);
    process.exit(0);
  }

  console.log(`\n[APPLY] 업데이트 시작...`);
  let updated = 0;
  // batched
  const all = [...chFixes.map(f => ({ ref: f.ref, name: f.newBookName })), ...pgFixes.map(f => ({ ref: f.ref, name: f.newBookName }))];
  for (let i = 0; i < all.length; i += 450) {
    const batch = db.batch();
    all.slice(i, i + 450).forEach(it => batch.update(it.ref, { bookName: it.name }));
    await batch.commit();
    updated += Math.min(450, all.length - i);
  }
  console.log(`✓ ${updated}건 update 완료`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
