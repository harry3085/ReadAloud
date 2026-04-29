// pushNotifications + userNotifications 의 academyId 누락 doc 백필.
//
// 동작:
//   1. userNotifications: doc 의 uid 로 users/{uid}.academyId 조회 → 백필
//      (학생이 삭제되어 user doc 없으면: --delete-orphans 면 삭제, 아니면 skip)
//   2. pushNotifications: 추정 어려우면 skip (수동 처리 권장)
//      target='uid:X' 면 그 학생의 academyId 로 추정 가능
//      target='all' 또는 그룹은 추정 불가 — 사용자가 --map 'docId=academyId' 인자로 지정
//
// 사용:
//   node scripts/migrate/backfill-notif-academy.js                            # DRY-RUN
//   node scripts/migrate/backfill-notif-academy.js --apply                    # 적용
//   node scripts/migrate/backfill-notif-academy.js --apply --delete-orphans   # 학생 없는 알림은 삭제
//   node scripts/migrate/backfill-notif-academy.js --apply --map 'CJi9...=raloud2,V8oj...=raloud2'

const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

function parseArgs() {
  const out = { apply: false, deleteOrphans: false, map: {} };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') out.apply = true;
    else if (args[i] === '--delete-orphans') out.deleteOrphans = true;
    else if (args[i] === '--map' && args[i+1]) {
      args[i+1].split(',').forEach(pair => {
        const [k, v] = pair.split('=').map(s => s.trim());
        if (k && v) out.map[k] = v;
      });
      i++;
    }
  }
  return out;
}

(async () => {
  const opts = parseArgs();
  const db = getDb();

  console.log(`\n=== backfill-notif-academy ${opts.apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  // users/{uid} → academyId 캐시
  const usersSnap = await db.collection('users').get();
  const userAcademy = new Map();
  usersSnap.docs.forEach(d => {
    const data = d.data();
    if (data.academyId) userAcademy.set(d.id, data.academyId);
  });
  console.log(`users 로드: ${userAcademy.size}명\n`);

  // 1. userNotifications 백필
  const unSnap = await db.collection('userNotifications').get();
  let unBackfilled = 0, unOrphans = 0, unDeleted = 0, unSkipped = 0, unAlready = 0;
  const orphanList = [];

  for (const d of unSnap.docs) {
    const data = d.data();
    if (data.academyId) { unAlready++; continue; }
    const uid = data.uid;
    if (!uid) { unSkipped++; console.log(`  ⚠ ${d.id}: uid 필드 없음 — skip`); continue; }
    const academyId = userAcademy.get(uid);
    if (academyId) {
      if (opts.apply) {
        await d.ref.update({ academyId, _backfilled: FieldValue.serverTimestamp() });
      }
      unBackfilled++;
    } else {
      unOrphans++;
      orphanList.push(d.id);
      if (opts.deleteOrphans && opts.apply) {
        await d.ref.delete();
        unDeleted++;
      }
    }
  }

  console.log(`userNotifications: 총 ${unSnap.size}`);
  console.log(`  ✓ 이미 academyId 있음: ${unAlready}`);
  console.log(`  → 백필 (uid 매칭): ${unBackfilled}`);
  console.log(`  ⚠ 학생 없음 (orphan): ${unOrphans}${opts.deleteOrphans ? ` → 삭제 ${unDeleted}` : ' (--delete-orphans 로 정리)'}`);
  console.log(`  · skip (uid 없음): ${unSkipped}\n`);

  if (orphanList.length && orphanList.length <= 20) {
    console.log('  orphan 문서 IDs:');
    orphanList.slice(0, 20).forEach(id => console.log('    -', id));
    console.log();
  }

  // 2. pushNotifications 백필 (target='uid:X' 만 자동, 나머지는 --map)
  const pnSnap = await db.collection('pushNotifications').get();
  let pnBackfilled = 0, pnSkipped = 0, pnAlready = 0;
  const pnSkipList = [];

  for (const d of pnSnap.docs) {
    const data = d.data();
    if (data.academyId) { pnAlready++; continue; }
    let academyId = null;

    // 우선순위 1: --map 인자
    if (opts.map[d.id]) academyId = opts.map[d.id];
    // 우선순위 2: target='uid:X' 면 그 학생의 academyId
    else if (typeof data.target === 'string' && data.target.startsWith('uid:')) {
      const studentUid = data.target.replace('uid:', '');
      academyId = userAcademy.get(studentUid) || null;
    }

    if (academyId) {
      if (opts.apply) {
        await d.ref.update({ academyId, _backfilled: FieldValue.serverTimestamp() });
      }
      pnBackfilled++;
      console.log(`  → ${d.id} | "${data.title || ''}" | ${data.target} → ${academyId}`);
    } else {
      pnSkipped++;
      pnSkipList.push({ id: d.id, title: data.title || '', target: data.target, date: data.date });
    }
  }

  console.log(`\npushNotifications: 총 ${pnSnap.size}`);
  console.log(`  ✓ 이미 academyId 있음: ${pnAlready}`);
  console.log(`  → 백필: ${pnBackfilled}`);
  console.log(`  ⚠ 추정 불가 (수동 매핑 필요): ${pnSkipped}\n`);

  if (pnSkipList.length) {
    console.log('  추정 불가 문서들 (--map 인자로 지정):');
    pnSkipList.forEach(p => console.log(`    --map '${p.id}=<academyId>'  (target=${p.target}, "${p.title}", ${p.date})`));
    console.log();
  }

  console.log(`${opts.apply ? '✅ 적용 완료' : '(DRY-RUN — --apply 추가 시 실제 적용)'}\n`);
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
