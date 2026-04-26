// usernameLookup/{academyId}_{usernameLower} 컬렉션을 기존 users 에서 시드합니다.
//
// 목적:
//   학생 로그인 시 users 전체에 `allow read: if true` 를 허용하지 않도록
//   username → (uid, email) 매핑용 별도 컬렉션 구성.
//
// 사용:
//   node scripts/migrate/create-username-lookup.js          # DRY-RUN
//   node scripts/migrate/create-username-lookup.js --apply  # 실제 쓰기
//
// 스키마:
//   /usernameLookup/{academyId}_{usernameLower}
//     academyId: string
//     usernameLower: string
//     uid: string
//     email: string
//     role: 'academy_admin' | 'student'
//     createdAt: serverTimestamp
//
// 중복 처리:
//   같은 academyId_usernameLower 키가 여러 users 문서에서 발생할 때:
//     - status === 'active' 인 사용자 우선
//     - 둘 다 active/inactive 면 createdAt 최근 우선
//   선택되지 않은 쪽은 SKIP + 리포트 (유령 문서 가능성 높음)
//
// 안전성:
//   - 기존 usernameLookup 문서가 이미 있으면 UPDATE 하지 않고 SKIP (운영 중 수정 방지)
//   - users.role 없는 사용자 / username 없는 사용자 SKIP
//   - 재실행 안전 (idempotent)

const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const DEFAULT_ACADEMY_ID = 'default';

function normalizeRole(role) {
  if (role === 'admin') return 'academy_admin';
  if (role === 'student') return 'student';
  return null;
}

function getCreatedAtMillis(data) {
  const t = data.createdAt;
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (t._seconds !== undefined) return t._seconds * 1000;
  return 0;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== create-username-lookup ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('users').get();
  const stats = {
    total: snap.size,
    candidates: 0,
    skippedNoUsername: 0,
    skippedNoRole: 0,
    skippedNoEmail: 0,
    willWrite: 0,
    alreadyExists: 0,
    droppedDuplicate: 0,
  };

  // 1단계: users 에서 candidate 수집
  const byKey = new Map(); // key → [{ uid, data, priority }]
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.username) { stats.skippedNoUsername++; continue; }
    const role = normalizeRole(data.role);
    if (!role) { stats.skippedNoRole++; continue; }
    if (!data.email) { stats.skippedNoEmail++; continue; }

    stats.candidates++;
    const usernameLower = data.username.toLowerCase();
    const key = usernameLower; // 글로벌 유니크
    const priority = (data.status === 'active' ? 1_000_000_000_000 : 0) + getCreatedAtMillis(data);

    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ uid: doc.id, data, role, usernameLower, priority });
  }

  // 2단계: 중복 키 처리 → priority 가장 높은 것 선택
  const toSeed = [];
  const duplicates = [];
  for (const [key, list] of byKey.entries()) {
    if (list.length === 1) {
      toSeed.push({ key, ...list[0] });
      continue;
    }
    list.sort((a, b) => b.priority - a.priority);
    const winner = list[0];
    toSeed.push({ key, ...winner });
    const losers = list.slice(1);
    stats.droppedDuplicate += losers.length;
    duplicates.push({ key, winner, losers });
  }

  // 3단계: 기존 lookup 존재 여부 확인 + 실제 쓰기 대상 확정
  const toActuallyWrite = [];
  for (const entry of toSeed) {
    const ref = db.collection('usernameLookup').doc(entry.key);
    const existing = await ref.get();
    if (existing.exists) {
      stats.alreadyExists++;
    } else {
      stats.willWrite++;
      toActuallyWrite.push(entry);
    }
  }

  // 리포트
  console.log(`users 총: ${stats.total}`);
  console.log(`candidate: ${stats.candidates}`);
  console.log(`  SKIP (username 없음): ${stats.skippedNoUsername}`);
  console.log(`  SKIP (role 없음): ${stats.skippedNoRole}`);
  console.log(`  SKIP (email 없음): ${stats.skippedNoEmail}`);
  console.log(`  중복 제거(active/최신 우선): ${stats.droppedDuplicate}`);
  console.log(`이미 존재: ${stats.alreadyExists}`);
  console.log(`새로 쓸 대상: ${stats.willWrite}`);

  if (duplicates.length > 0) {
    console.log(`\n⚠️ 중복 해소 내역:`);
    for (const dup of duplicates) {
      console.log(`  key=${dup.key}`);
      console.log(`    ✓ 선택: uid=${dup.winner.uid.slice(0, 8)}… name=${dup.winner.data.name} status=${dup.winner.data.status || '(없음)'}`);
      for (const l of dup.losers) {
        console.log(`    ✗ 제외: uid=${l.uid.slice(0, 8)}… name=${l.data.name} status=${l.data.status || '(없음)'}`);
      }
    }
  }

  if (toActuallyWrite.length > 0) {
    console.log(`\n샘플 (처음 3개):`);
    for (const e of toActuallyWrite.slice(0, 3)) {
      console.log(`  ${e.key.padEnd(28)} uid=${e.uid.slice(0, 8)}… email=${e.data.email} role=${e.role}`);
    }
  }

  if (!apply) {
    console.log(`\n(DRY-RUN) 실제로 쓰려면 --apply 를 추가하세요.\n`);
    process.exit(0);
  }

  // 실제 쓰기
  console.log(`\n쓰는 중...`);
  let batch = db.batch();
  let inBatch = 0;
  let done = 0;

  for (const e of toActuallyWrite) {
    const ref = db.collection('usernameLookup').doc(e.key);
    batch.set(ref, {
      academyId: e.data.academyId || DEFAULT_ACADEMY_ID,
      usernameLower: e.usernameLower,
      uid: e.uid,
      email: e.data.email,
      role: e.role,
      createdAt: FieldValue.serverTimestamp(),
    });
    inBatch++;
    if (inBatch >= 450) {
      await batch.commit();
      done += inBatch;
      process.stdout.write(`  ${done}/${toActuallyWrite.length}\r`);
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) {
    await batch.commit();
    done += inBatch;
  }

  console.log(`\n\n✅ 완료: ${done}/${toActuallyWrite.length} 건 생성됨\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[error]', err);
  process.exit(1);
});
