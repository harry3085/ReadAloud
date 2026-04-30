// academies.usage 카운터 백필.
// 기존 학생들 / 이번 달 apiUsage 를 합산해서 academies.usage 에 set.
//
// 사용:
//   node scripts/migrate/backfill-academy-usage.js          # DRY-RUN
//   node scripts/migrate/backfill-academy-usage.js --apply  # 실제 백필
//
// 동작:
//   각 academy 에 대해:
//   - activeStudentsCount = users where(academyId, role=student, status=active).size
//   - aiCallsThisMonth    = sum(apiUsage[{academyId}_{이번달일}].byEndpoint.{ocr|cleanup-ocr|generate-quiz})
//   - recordingCallsThisMonth = sum(... .byEndpoint.check-recording)
//   - lastResetAt = 이번 달 (YYYY-MM)

const { getDb } = require('../lib/firebase-admin');

// KST(UTC+9) 기준 — apiUsage doc ID 와 동일
function ymNow() { return new Date(Date.now() + 9*3600*1000).toISOString().slice(0, 7); }
function isoDay(d) { return new Date(d.getTime() + 9*3600*1000).toISOString().slice(0, 10); }

async function _sumApiUsageThisMonth(db, academyId) {
  const ym = ymNow();
  const todayKST = new Date(Date.now() + 9*3600*1000);
  const lastDay = todayKST.getUTCDate(); // KST 일자 (ms+9h 후 UTC 일자가 곧 KST 일자)
  // 이번 달 1일부터 오늘까지 매일 doc 시도
  let ai = 0, rec = 0;
  for (let d = 1; d <= lastDay; d++) {
    const day = `${ym}-${String(d).padStart(2, '0')}`;
    const snap = await db.doc(`apiUsage/${academyId}_${day}`).get();
    if (!snap.exists) continue;
    const data = snap.data();
    const bE = data.byEndpoint || {};
    const cnt = (k) => (bE[k] || 0) + (data['byEndpoint.' + k] || 0);
    ai += cnt('ocr') + cnt('cleanup-ocr') + cnt('generate-quiz');
    rec += cnt('check-recording');
  }
  return { ai, rec };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== backfill-academy-usage ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const acadSnap = await db.collection('academies').get();
  const ym = ymNow();
  const rows = [];

  for (const adoc of acadSnap.docs) {
    const academyId = adoc.id;
    // 활성 학생 수
    const studentSnap = await db.collection('users')
      .where('academyId', '==', academyId)
      .where('role', '==', 'student')
      .where('status', '==', 'active')
      .get();
    const studentCount = studentSnap.size;
    // AI / recording 합산
    const { ai, rec } = await _sumApiUsageThisMonth(db, academyId);
    rows.push({ academyId, studentCount, ai, rec });
    console.log(`  ${academyId.padEnd(15)} 학생=${String(studentCount).padStart(3)} AI=${String(ai).padStart(4)} 녹음=${String(rec).padStart(4)}`);
  }

  if (!apply) { console.log(`\n(DRY-RUN) 실제 백필은 --apply 추가.\n`); process.exit(0); }

  console.log(`\n백필 중...`);
  for (const r of rows) {
    await db.doc('academies/' + r.academyId).update({
      'usage.activeStudentsCount': r.studentCount,
      'usage.aiCallsThisMonth': r.ai,
      'usage.recordingCallsThisMonth': r.rec,
      'usage.lastResetAt': ym,
    });
  }
  console.log(`\n✅ 완료: ${rows.length} 학원 백필됨\n`);
  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
