// 학생 status 필드 누락 보정 + academies.usage.activeStudentsCount drift 보정.
//
// 1) status 필드 누락된 학생 학생 → status='active' 명시
// 2) academies.usage.activeStudentsCount = 실제 active 학생 수 (재계산)
//
// 사용:
//   node scripts/migrate/fix-student-counts.js          # DRY-RUN
//   node scripts/migrate/fix-student-counts.js --apply  # 적용

const { getDb } = require('../lib/firebase-admin');

(async () => {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== 학생 status + academies 카운터 보정 ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  // 1) status 필드 누락 학생 검출
  const allStudents = await db.collection('users').where('role', '==', 'student').get();
  const missingStatus = [];
  allStudents.forEach(d => {
    const data = d.data();
    if (!('status' in data) || data.status === undefined || data.status === null || data.status === '') {
      missingStatus.push({ id: d.id, name: data.name, academyId: data.academyId, username: data.username });
    }
  });

  console.log(`전체 학생 ${allStudents.size}명, status 필드 누락 ${missingStatus.length}명`);
  if (missingStatus.length > 0) {
    console.log('\nstatus 누락 학생:');
    missingStatus.forEach(s => console.log(`  ${s.id}: ${s.name} (${s.academyId} / ${s.username})`));

    if (apply) {
      const batch = db.batch();
      missingStatus.forEach(s => batch.update(db.doc(`users/${s.id}`), { status: 'active' }));
      await batch.commit();
      console.log(`✓ ${missingStatus.length}건 status='active' 채움`);
    }
  }

  // 2) 학원별 activeStudentsCount 재계산
  console.log('\n=== 카운터 보정 ===');
  const acadSnap = await db.collection('academies').get();

  for (const acad of acadSnap.docs) {
    const data = acad.data();
    const counterSaid = data.usage?.activeStudentsCount ?? 0;

    // 보정 후 (status='active' 채워진 후) active 수 카운트
    let realActive = 0;
    allStudents.forEach(d => {
      const u = d.data();
      if (u.academyId !== acad.id) return;
      const status = (u.status === undefined || u.status === null || u.status === '') ? 'active' : u.status;
      if (status === 'active') realActive++;
    });

    const drift = counterSaid - realActive;
    console.log(`▶ ${acad.id}: 카운터 ${counterSaid} → 실제 ${realActive}  ${drift === 0 ? '✓ 정합' : `(diff ${drift})`}`);

    if (apply && drift !== 0) {
      await db.doc(`academies/${acad.id}`).update({ 'usage.activeStudentsCount': realActive });
      console.log(`  ✓ 보정`);
    }
  }

  if (!apply) console.log('\n(DRY-RUN — --apply 로 실제 적용)\n');
  else console.log('\n✅ 완료\n');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
