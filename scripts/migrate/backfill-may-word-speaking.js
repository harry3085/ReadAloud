// 5월 academies.usage.wordSpeakingCallsThisMonth 백필 + recordingCallsThisMonth 차감 (2026-05-15)
// 단어시험이 5월부터 별도 카운터로 분리됐지만 이전 호출은 recording 에 합산됨.
// apiUsage 일별 doc 의 byEndpoint['check-word'] 가 endpoint 별 분리 카운트 → 5월 합산 = 단어시험 사용량.
// recording 에서 차감해서 분리.
//
// 사용:
//   node scripts/migrate/backfill-may-word-speaking.js          # DRY-RUN
//   node scripts/migrate/backfill-may-word-speaking.js --apply

const { getDb } = require('../lib/firebase-admin');

(async () => {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  // 5월 KST 기준 1일~말일
  const KST = 9 * 60 * 60 * 1000;
  const now = new Date(Date.now() + KST);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();  // 0-indexed
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const yyyymm = `${year}-${String(month + 1).padStart(2, '0')}`;
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(`${yyyymm}-${String(d).padStart(2, '0')}`);
  }

  console.log(`\n=== ${yyyymm} wordSpeaking 백필 ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const acadSnap = await db.collection('academies').get();
  console.log(`학원 ${acadSnap.size}곳\n`);

  for (const acadDoc of acadSnap.docs) {
    const academyId = acadDoc.id;
    const data = acadDoc.data();
    const usage = data.usage || {};
    const curRecording = usage.recordingCallsThisMonth || 0;
    const curWordSpeaking = usage.wordSpeakingCallsThisMonth || 0;

    // 학원의 5월 apiUsage doc 합산
    let sumCheckWord = 0;
    for (const ymd of days) {
      const usageDoc = await db.doc(`apiUsage/${academyId}_${ymd}`).get();
      if (!usageDoc.exists) continue;
      const u = usageDoc.data();
      const bE = u.byEndpoint || {};
      // nested + flat 둘 다 합산 (이전 형식 호환)
      const v = (bE['check-word'] || 0) + (u['byEndpoint.check-word'] || 0);
      sumCheckWord += v;
    }

    if (sumCheckWord === 0) {
      console.log(`  ${academyId} (${data.name || ''}): check-word 5월 0건 — skip`);
      continue;
    }

    const newRecording = Math.max(0, curRecording - sumCheckWord);
    const newWordSpeaking = curWordSpeaking + sumCheckWord;

    console.log(`  ${academyId} (${data.name || ''}):`);
    console.log(`    check-word 5월 합산: ${sumCheckWord}건`);
    console.log(`    recording: ${curRecording} → ${newRecording}`);
    console.log(`    wordSpeaking: ${curWordSpeaking} → ${newWordSpeaking}`);

    if (apply) {
      await db.doc(`academies/${academyId}`).update({
        'usage.recordingCallsThisMonth': newRecording,
        'usage.wordSpeakingCallsThisMonth': newWordSpeaking,
      });
      console.log(`    ✓ 적용됨`);
    }
  }

  if (!apply) {
    console.log('\n(DRY-RUN — --apply 로 실제 적용)\n');
  } else {
    console.log('\n✓ 완료\n');
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
