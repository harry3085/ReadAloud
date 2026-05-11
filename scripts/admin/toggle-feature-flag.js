// 학원의 featureFlag 토글 (super_admin 작업)
//
// 사용:
//   node scripts/admin/toggle-feature-flag.js --academy=default --flag=scoreSnap --enable
//   node scripts/admin/toggle-feature-flag.js --academy=default --flag=scoreSnap --disable
//   node scripts/admin/toggle-feature-flag.js --list                                  # 6학원 현황
//
// 옵션:
//   --academy=<id>     필수 (단건 토글 시). academies/{id} doc ID
//   --flag=<name>      필수 (단건 토글 시). 'scoreSnap' / 'aiGrowthReport' / 'recordingAiFeedback' 등
//   --enable/--disable 토글 방향
//   --list             현황만 출력 후 종료
//
// 안전:
//   featureFlags 외 다른 필드는 절대 안 건드림. updateDoc 의 path 키만 사용.

const { getDb } = require('../lib/firebase-admin');
const admin = require('firebase-admin');

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args[k] = v === undefined ? true : v;
    }
  }
  return args;
}

async function listAll(db) {
  const snap = await db.collection('academies').get();
  console.log('\n학원별 featureFlags 현황:\n');
  snap.docs.forEach(d => {
    const ff = d.data().featureFlags || {};
    console.log(`  ${d.id.padEnd(12)} | scoreSnap=${ff.scoreSnap === true} | aiGrowthReport=${ff.aiGrowthReport === true} | recordingAiFeedback=${ff.recordingAiFeedback === true}`);
  });
  console.log('');
}

async function toggle(db, academyId, flag, value) {
  const ref = db.doc('academies/' + academyId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('학원 doc 없음: ' + academyId);
  const prev = (snap.data().featureFlags || {})[flag];
  const path = 'featureFlags.' + flag;
  await ref.update({ [path]: value, _featureFlagUpdatedAt: admin.firestore.FieldValue.serverTimestamp() });
  console.log(`✓ ${academyId}.featureFlags.${flag}: ${prev === true} → ${value}`);
}

async function main() {
  const args = parseArgs();
  const db = getDb();
  if (args.list) {
    await listAll(db);
    return;
  }
  if (!args.academy) throw new Error('--academy=<id> 필요');
  if (!args.flag) throw new Error('--flag=<name> 필요');
  const enable = args.enable === true;
  const disable = args.disable === true;
  if (enable === disable) throw new Error('--enable 또는 --disable 둘 중 하나 필요');
  await toggle(db, args.academy, args.flag, enable);
  console.log('\n변경 후 현황:');
  await listAll(db);
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
