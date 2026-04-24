// 모든 기존 Firestore 문서에 academyId='default' 필드를 추가하는 마이그레이션 스크립트.
//
// ⚠️ 실행 전 반드시 Firebase Console → Firestore → Export 로 전체 백업을 받으세요.
//
// 사용:
//   node scripts/migrate/add-academy-id.js                    # DRY-RUN (컬렉션별 대상 건수 리포트)
//   node scripts/migrate/add-academy-id.js --apply            # 실제 쓰기 (모든 컬렉션)
//   node scripts/migrate/add-academy-id.js --apply --only=users,scores   # 특정 컬렉션만
//
// 설계 원칙:
//   1. 기본값은 DRY-RUN — 실수로 실행해도 데이터 변경 없음.
//   2. 이미 academyId 필드가 있는 문서는 건드리지 않음 (재실행 안전).
//   3. 서브컬렉션(tests/{id}/userCompleted, genTests/{id}/userCompleted) 별도 처리.
//   4. Firestore 배치는 최대 500건 → 자동 분할.
//   5. 각 컬렉션별 결과를 명확히 리포트.

const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const DEFAULT_ACADEMY_ID = 'default';
const BATCH_LIMIT = 450;  // 500 한도 안전 마진

// 최상위 컬렉션 (모두 academyId 추가 대상)
const TOP_LEVEL_COLLECTIONS = [
  'users',
  'groups',
  'units',
  'tests',
  'scores',
  'notices',
  'hwFiles',
  'userNotifications',
  'fcmTokens',
  'payments',
  'savedPushList',
  'books',
  'folders',
  'pushNotifications',
  'genBooks',
  'genChapters',
  'genPages',
  'genQuestionSets',
  'genCleanupPresets',
  'genTests',
];

// 서브컬렉션 패턴 — 부모 컬렉션을 먼저 훑은 후 진입
const SUBCOLLECTIONS = [
  { parent: 'tests', sub: 'userCompleted' },
  { parent: 'genTests', sub: 'userCompleted' },
  { parent: 'books', sub: 'units' },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.trim()) : null;
  return { apply, only };
}

async function migrateCollection(db, colPath, apply) {
  const snap = await db.collection(colPath).get();
  let toUpdate = 0;
  let alreadyHasField = 0;
  let batch = db.batch();
  let inBatch = 0;

  for (const doc of snap.docs) {
    if (doc.data().academyId) {
      alreadyHasField++;
      continue;
    }
    toUpdate++;
    if (apply) {
      batch.update(doc.ref, {
        academyId: DEFAULT_ACADEMY_ID,
        _migratedAt: FieldValue.serverTimestamp(),
      });
      inBatch++;
      if (inBatch >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
  }

  if (apply && inBatch > 0) {
    await batch.commit();
  }

  return { total: snap.size, toUpdate, alreadyHasField };
}

async function migrateSubcollection(db, parent, sub, apply) {
  const parentSnap = await db.collection(parent).get();
  let total = 0;
  let toUpdate = 0;
  let alreadyHasField = 0;
  let batch = db.batch();
  let inBatch = 0;

  for (const parentDoc of parentSnap.docs) {
    const subSnap = await parentDoc.ref.collection(sub).get();
    total += subSnap.size;
    for (const doc of subSnap.docs) {
      if (doc.data().academyId) {
        alreadyHasField++;
        continue;
      }
      toUpdate++;
      if (apply) {
        batch.update(doc.ref, {
          academyId: DEFAULT_ACADEMY_ID,
          _migratedAt: FieldValue.serverTimestamp(),
        });
        inBatch++;
        if (inBatch >= BATCH_LIMIT) {
          await batch.commit();
          batch = db.batch();
          inBatch = 0;
        }
      }
    }
  }

  if (apply && inBatch > 0) {
    await batch.commit();
  }

  return { total, toUpdate, alreadyHasField };
}

function shouldProcess(name, only) {
  if (!only) return true;
  return only.includes(name);
}

async function main() {
  const { apply, only } = parseArgs();
  const db = getDb();

  console.log(`\n=== add-academy-id ${apply ? '(APPLY)' : '(DRY-RUN)'} ===`);
  if (only) console.log(`    filter: only=${only.join(',')}`);
  console.log(`    target academyId: "${DEFAULT_ACADEMY_ID}"\n`);

  const results = [];

  for (const col of TOP_LEVEL_COLLECTIONS) {
    if (!shouldProcess(col, only)) continue;
    process.stdout.write(`• ${col.padEnd(20)} `);
    try {
      const r = await migrateCollection(db, col, apply);
      console.log(`total=${r.total}  toUpdate=${r.toUpdate}  alreadyOk=${r.alreadyHasField}`);
      results.push({ path: col, ...r });
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      results.push({ path: col, error: e.message });
    }
  }

  console.log();
  for (const { parent, sub } of SUBCOLLECTIONS) {
    const label = `${parent}/*/${sub}`;
    if (!shouldProcess(label, only) && !shouldProcess(parent, only)) continue;
    process.stdout.write(`• ${label.padEnd(30)} `);
    try {
      const r = await migrateSubcollection(db, parent, sub, apply);
      console.log(`total=${r.total}  toUpdate=${r.toUpdate}  alreadyOk=${r.alreadyHasField}`);
      results.push({ path: label, ...r });
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      results.push({ path: label, error: e.message });
    }
  }

  const totalToUpdate = results.reduce((s, r) => s + (r.toUpdate || 0), 0);
  const totalAlreadyOk = results.reduce((s, r) => s + (r.alreadyHasField || 0), 0);

  console.log(`\n─── 요약 ───`);
  console.log(`업데이트 대상: ${totalToUpdate} 건`);
  console.log(`이미 처리됨: ${totalAlreadyOk} 건`);

  if (!apply) {
    console.log(`\n(DRY-RUN) 실제로 쓰려면 --apply 를 추가하세요.`);
    console.log(`          Firestore Export 백업을 먼저 받았는지 확인하세요.\n`);
  } else {
    console.log(`\n✅ 마이그레이션 완료.\n`);
    console.log(`다음 단계: activeStudentsCount 재계산 스크립트 실행 예정.\n`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('\n[error]', err);
  process.exit(1);
});
