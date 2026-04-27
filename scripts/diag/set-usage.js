// 학원 사용량 카운터 강제 설정 — 쿼터 검증용
//
// 사용:
//   node scripts/diag/set-usage.js --academy raloud2 --field aiCallsThisMonth --value 1999
//   node scripts/diag/set-usage.js --academy raloud2 --field aiCallsThisMonth --value 0     # 복원
//
// 필드:
//   aiCallsThisMonth          — generate-quiz / cleanup-ocr / ocr 카운터
//   recordingCallsThisMonth   — check-recording 카운터
//   activeStudentsCount       — 학생 수 (자동 카운트되지만 강제 set 가능)

const { getDb } = require('../lib/firebase-admin');

function getArg(name) {
  const args = process.argv.slice(2);
  const eqIdx = args.findIndex(a => a.startsWith('--' + name + '='));
  if (eqIdx >= 0) return args[eqIdx].split('=').slice(1).join('=');
  const flagIdx = args.indexOf('--' + name);
  if (flagIdx >= 0) return args[flagIdx + 1];
  return null;
}

async function main() {
  const academy = getArg('academy');
  const field = getArg('field');
  const value = parseInt(getArg('value'));

  if (!academy || !field || isNaN(value)) {
    console.error('필수: --academy <id> --field <name> --value <number>');
    process.exit(1);
  }

  const db = getDb();
  const ref = db.doc('academies/' + academy);
  const snap = await ref.get();
  if (!snap.exists) { console.error('학원 없음: ' + academy); process.exit(1); }

  const before = snap.data().usage?.[field] ?? 0;
  await ref.update({ [`usage.${field}`]: value });
  const after = (await ref.get()).data().usage?.[field];

  console.log(`\n학원 ${academy} · usage.${field}`);
  console.log(`  변경 전: ${before}`);
  console.log(`  변경 후: ${after}\n`);
  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
