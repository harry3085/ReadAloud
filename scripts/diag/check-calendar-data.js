// 달력 통합용 데이터 분포 진단
// - users.birth (생일) 채워진 비율
// - users.tuitionPlan.dueDay 분포
// - billings.dueDate 이번 달 분포
// - genTests.date 이번 달 분포
// 사용: node scripts/diag/check-calendar-data.js

const { getDb } = require('../lib/firebase-admin');

function ymdKST(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return k.toISOString().slice(0, 10);
}

(async () => {
  const db = getDb();
  const today = ymdKST();
  const [y, m] = today.split('-').map(Number);
  const monthStart = `${y}-${String(m).padStart(2,'0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

  console.log(`\n=== 달력 통합용 데이터 진단 (${today} 기준, 이번 달 ${monthStart} ~ ${monthEnd}) ===\n`);

  // 1) users.birth 분포
  const stuSnap = await db.collection('users').where('role','==','student').get();
  const byAcad = {};
  stuSnap.forEach(d => {
    const u = d.data();
    const a = u.academyId || 'no-academy';
    byAcad[a] = byAcad[a] || { total:0, status:{}, birthFilled:0, birthValid:0, tuitionActive:0, dueDayDist:{} };
    const s = byAcad[a];
    s.total++;
    s.status[u.status||'?'] = (s.status[u.status||'?']||0) + 1;
    if (u.birth && String(u.birth).trim()) {
      s.birthFilled++;
      if (/^\d{4}-\d{2}-\d{2}$/.test(u.birth)) s.birthValid++;
    }
    if (u.tuitionPlan?.active) s.tuitionActive++;
    const dd = u.tuitionPlan?.dueDay;
    if (dd !== undefined && dd !== null) {
      const k = (dd === -1) ? '말일' : (dd === 0) ? '학원기본' : String(dd);
      s.dueDayDist[k] = (s.dueDayDist[k]||0) + 1;
    }
  });

  console.log('## users (학생) 학원별\n');
  Object.entries(byAcad).forEach(([a, s]) => {
    const pct = s.total ? Math.round(s.birthFilled / s.total * 100) : 0;
    const validPct = s.birthFilled ? Math.round(s.birthValid / s.birthFilled * 100) : 0;
    console.log(`  [${a}] 총 ${s.total}명, status: ${JSON.stringify(s.status)}`);
    console.log(`      birth 채워짐: ${s.birthFilled}/${s.total} (${pct}%), 유효 yyyy-mm-dd: ${s.birthValid} (${validPct}% of filled)`);
    console.log(`      tuitionPlan.active: ${s.tuitionActive}명, dueDay 분포: ${JSON.stringify(s.dueDayDist)}`);
  });

  // 2) billings 이번 달
  const billStart = new Date(y, m-1, 1);
  const billEnd = new Date(y, m, 1);
  const billSnap = await db.collection('billings')
    .where('dueDate','>=', billStart)
    .where('dueDate','<', billEnd).get();
  const billByAcad = {};
  let unpaid = 0, paid = 0;
  billSnap.forEach(d => {
    const b = d.data();
    const a = b.academyId || 'no-academy';
    billByAcad[a] = (billByAcad[a]||0) + 1;
    if (b.status === 'paid') paid++; else unpaid++;
  });
  console.log(`\n## billings 이번 달 dueDate (${monthStart} ~ ${monthEnd}): ${billSnap.size}건`);
  console.log(`   학원별:`, billByAcad);
  console.log(`   상태: paid ${paid}, 미납 ${unpaid}`);

  // 3) genTests 이번 달 (date 는 yyyy-mm-dd 문자열)
  const tSnap = await db.collection('genTests')
    .where('date','>=', monthStart)
    .where('date','<=', monthEnd).get();
  const tByAcad = {};
  const tByDate = {};
  tSnap.forEach(d => {
    const t = d.data();
    const a = t.academyId || 'no-academy';
    tByAcad[a] = (tByAcad[a]||0) + 1;
    tByDate[t.date] = (tByDate[t.date]||0) + 1;
  });
  console.log(`\n## genTests 이번 달 date: ${tSnap.size}건`);
  console.log(`   학원별:`, tByAcad);
  console.log(`   날짜별 분포 (상위 10):`);
  Object.entries(tByDate).sort().slice(0,10).forEach(([d,n]) => console.log(`     ${d}: ${n}건`));

  // 4) 샘플 doc 한 건씩
  console.log(`\n## 샘플 doc`);
  const stuSample = stuSnap.docs.find(d => d.data().birth);
  if (stuSample) {
    const u = stuSample.data();
    console.log(`   user(birth有): name=${u.name}, birth=${u.birth}, tuitionPlan=`, JSON.stringify(u.tuitionPlan||{}));
  } else {
    console.log(`   user(birth有): 없음`);
  }
  if (billSnap.size) {
    const b = billSnap.docs[0].data();
    console.log(`   billing: status=${b.status}, dueDate=${b.dueDate?.toDate?.().toISOString().slice(0,10)}, total=${b.totalAmount}, items=${b.items?.length||0}`);
  }
  if (tSnap.size) {
    const t = tSnap.docs[0].data();
    console.log(`   genTest: title=${t.title||t.testName}, date=${t.date}, mode/testMode=${t.mode||t.testMode}`);
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
