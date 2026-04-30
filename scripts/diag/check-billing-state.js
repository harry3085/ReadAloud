// 결제·만료 상태 진단 스크립트
//
// 사용:
//   node scripts/diag/check-billing-state.js
//
// 출력:
//   1) academies 학원별 만료일 / D-day / billingStatus
//   2) subscriptions 전체 상태별 카운트 + 이번 달 approved 합계

const { getDb } = require('../lib/firebase-admin');

function fmtDate(t) {
  if (!t) return '-';
  if (typeof t.toDate === 'function') return t.toDate().toISOString().slice(0, 10);
  if (t._seconds !== undefined) return new Date(t._seconds * 1000).toISOString().slice(0, 10);
  if (typeof t === 'string') return t.slice(0, 10);
  return String(t);
}

function dDay(t) {
  let d;
  if (!t) return null;
  if (typeof t.toDate === 'function') d = t.toDate();
  else if (t._seconds !== undefined) d = new Date(t._seconds * 1000);
  else if (typeof t === 'string') d = new Date(t);
  else return null;
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (24 * 3600 * 1000));
}

async function main() {
  const db = getDb();
  console.log('\n=== 결제·만료 상태 진단 ===\n');

  // 1) academies
  const acadSnap = await db.collection('academies').get();
  console.log(`[academies] 총 ${acadSnap.size}개\n`);
  console.log('학원ID            billing      만료일       D-day   분류');
  console.log('-'.repeat(72));
  let expiringSoon = 0;
  let overdue = 0;
  let expired = 0;
  for (const doc of acadSnap.docs) {
    const a = doc.data();
    const exp = fmtDate(a.planExpiresAt);
    const dd = dDay(a.planExpiresAt);
    let bucket = '-';
    if (a.billingStatus === 'grace' || a.billingStatus === 'suspended') {
      bucket = '💸 미납';
      overdue++;
    } else if (dd !== null) {
      if (dd < 0) { bucket = '❌ 만료됨(미반영)'; expired++; }
      else if (dd <= 10) { bucket = '⏳ 만료임박'; expiringSoon++; }
      else { bucket = '✅ 정상'; }
    } else {
      bucket = '∞ 만료없음';
    }
    console.log(
      `${doc.id.padEnd(16)}  ${(a.billingStatus || '-').padEnd(11)}  ${exp.padEnd(11)}  ${(dd === null ? '-' : 'D-' + dd).padEnd(7)} ${bucket}`,
    );
  }
  console.log();
  console.log(`⏳ 만료 임박 (앞으로 10일 이내): ${expiringSoon}`);
  console.log(`❌ 이미 만료됐는데 billingStatus 미반영: ${expired}`);
  console.log(`💸 미납 (grace + suspended):     ${overdue}`);
  console.log();

  // 2) subscriptions
  const subSnap = await db.collection('subscriptions').get();
  const counts = { pending: 0, approved: 0, rejected: 0, refunded: 0 };
  let monthlyRevenue = 0;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  for (const d of subSnap.docs) {
    const s = d.data();
    counts[s.status] = (counts[s.status] || 0) + 1;
    if (s.status === 'approved') {
      const ap = s.approvedAt;
      let apDate = null;
      if (ap && typeof ap.toDate === 'function') apDate = ap.toDate();
      else if (ap && ap._seconds !== undefined) apDate = new Date(ap._seconds * 1000);
      if (apDate && apDate >= monthStart) {
        monthlyRevenue += (s.amount || 0);
      }
    }
  }
  console.log(`[subscriptions] 총 ${subSnap.size}개`);
  console.log(`  status=pending:  ${counts.pending}`);
  console.log(`  status=approved: ${counts.approved}`);
  console.log(`  status=rejected: ${counts.rejected}`);
  console.log(`  status=refunded: ${counts.refunded}`);
  console.log(`  💰 이번 달(${monthStart.toISOString().slice(0,7)}) approved 매출 합계: ${monthlyRevenue.toLocaleString('ko-KR')}원`);
  console.log();

  // 3) approved 항목 시간순 확인 (매출 카드 갱신 패턴 디버그용)
  if (counts.approved > 0) {
    console.log('[approved 항목 상세 — 이번 달 매출 카드 디버그용]');
    console.log('승인일                   학원ID            금액       periodStart  periodEnd');
    console.log('-'.repeat(82));
    const approvedDocs = subSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(s => s.status === 'approved')
      .sort((a, b) => {
        const ta = a.approvedAt && (a.approvedAt._seconds || 0);
        const tb = b.approvedAt && (b.approvedAt._seconds || 0);
        return tb - ta;
      });
    for (const s of approvedDocs) {
      const ap = s.approvedAt && new Date((s.approvedAt._seconds || 0) * 1000);
      const inMonth = ap && ap >= monthStart;
      console.log(
        `${(ap ? ap.toISOString().slice(0,16) : '-').padEnd(22)}  ${(s.academyId || '-').padEnd(16)}  ${String(s.amount || 0).padStart(7)}원  ${fmtDate(s.periodStart).padEnd(11)}  ${fmtDate(s.periodEnd).padEnd(11)}  ${inMonth ? '← 이번달 합계' : ''}`,
      );
    }
  }

  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
