// 진단: academies.usage.activeStudentsCount 와 실제 active 학생 수 비교.
// 카운터 drift 검출.

const { getDb } = require('../lib/firebase-admin');

(async () => {
  const db = getDb();
  console.log('\n=== academies.usage.activeStudentsCount vs 실제 active 학생 수 ===\n');

  const acadSnap = await db.collection('academies').get();

  for (const acad of acadSnap.docs) {
    const data = acad.data();
    const counterSaid = data.usage?.activeStudentsCount ?? 0;

    // 실제 active student 수 카운트
    const studentSnap = await db.collection('users')
      .where('academyId', '==', acad.id)
      .where('role', '==', 'student')
      .where('status', '==', 'active')
      .get();
    const realActive = studentSnap.size;

    // 다른 status 도 같이 표시
    const allStudents = await db.collection('users')
      .where('academyId', '==', acad.id)
      .where('role', '==', 'student')
      .get();
    let active=0, pause=0, out=0, other=0;
    allStudents.forEach(d => {
      const s = d.data().status || 'active';
      if (s==='active') active++;
      else if (s==='pause') pause++;
      else if (s==='out') out++;
      else other++;
    });

    const drift = counterSaid - realActive;
    const tag = drift === 0 ? '✓' : (drift > 0 ? `⚠ +${drift} 부풀림` : `⚠ ${drift} 누락`);

    console.log(`▶ ${acad.id} (${data.name || ''}):`);
    console.log(`  카운터: ${counterSaid}  /  실제 active: ${realActive}  ${tag}`);
    console.log(`  실제 분포 — active=${active} / pause=${pause} / out=${out}${other ? ` / other=${other}` : ''}`);
    console.log();
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
