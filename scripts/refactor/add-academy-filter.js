// Firestore 읽기 쿼리에 academyId 필터를 일괄 추가.
//
// 변환 패턴:
//   query(collection(db,'X'), ...)        → query(collection(db,'X'),where('academyId','==',window.MY_ACADEMY_ID), ...)
//   getDocs(collection(db,'X'))           → getDocs(query(collection(db,'X'),where('academyId','==',window.MY_ACADEMY_ID)))
//   onSnapshot(collection(db,'X'), ...)   → onSnapshot(query(collection(db,'X'),where('academyId','==',window.MY_ACADEMY_ID)), ...)
//
// 이미 academyId 필터가 있으면 SKIP.
//
// 대상 컬렉션: academyId 필드 있는 것만. plans/academies/usernameLookup/apiUsage 제외.
//
// 사용:
//   node scripts/refactor/add-academy-filter.js                   # DRY-RUN
//   node scripts/refactor/add-academy-filter.js --apply           # 실제 적용
//   node scripts/refactor/add-academy-filter.js --file=admin --apply

const fs = require('fs');
const path = require('path');

const TARGETED = [
  'users','groups','units','tests','scores','notices','hwFiles',
  'userNotifications','fcmTokens','payments','savedPushList',
  'books','folders','pushNotifications',
  'genBooks','genChapters','genPages','genQuestionSets','genCleanupPresets','genTests'
];

const FILES = {
  admin: path.resolve(__dirname, '../../public/admin/js/app.js'),
  student: path.resolve(__dirname, '../../public/js/app.js'),
};

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const fileArg = args.find(a => a.startsWith('--file='));
const onlyFile = fileArg ? fileArg.split('=')[1] : null;

const ACADEMY_FILTER = "where('academyId','==',window.MY_ACADEMY_ID)";

function processFile(label, filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  let content = original;
  let totalAdded = 0;
  const perCol = {};

  for (const col of TARGETED) {
    let added = 0;

    // Pattern A: query(collection(db,'X'), <NOT academyId>) → 첫 where 자리에 academyId 삽입
    // 정규식: query(collection(db,'X')) , (다음 글자가 where('academyId 가 아닌 경우)
    const reA = new RegExp(
      `query\\(\\s*collection\\(\\s*db\\s*,\\s*'${col}'\\s*\\)\\s*,\\s*(?!where\\(\\s*'academyId)`,
      'g'
    );
    content = content.replace(reA, () => { added++; return `query(collection(db,'${col}'),${ACADEMY_FILTER},`; });

    // Pattern B: getDocs(collection(db,'X')) — query 없는 단순
    const reB = new RegExp(
      `getDocs\\(\\s*collection\\(\\s*db\\s*,\\s*'${col}'\\s*\\)\\s*\\)`,
      'g'
    );
    content = content.replace(reB, () => { added++; return `getDocs(query(collection(db,'${col}'),${ACADEMY_FILTER}))`; });

    // Pattern C: onSnapshot(collection(db,'X'), → onSnapshot(query(collection(db,'X'),academyId),
    const reC = new RegExp(
      `onSnapshot\\(\\s*collection\\(\\s*db\\s*,\\s*'${col}'\\s*\\)\\s*,`,
      'g'
    );
    content = content.replace(reC, () => { added++; return `onSnapshot(query(collection(db,'${col}'),${ACADEMY_FILTER}),`; });

    if (added > 0) {
      perCol[col] = added;
      totalAdded += added;
    }
  }

  console.log(`\n[${label}] ${path.relative(process.cwd(), filePath)}`);
  console.log(`  변환: ${totalAdded}`);
  if (totalAdded > 0) {
    Object.entries(perCol).forEach(([col, n]) => console.log(`    ${col.padEnd(20)} ${n}`));
  }

  if (apply && totalAdded > 0) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✅ 적용됨`);
  }
  return totalAdded;
}

console.log(`\n=== Firestore 쿼리 academyId 필터 일괄 추가 (${apply ? 'APPLY' : 'DRY-RUN'}) ===`);
console.log(`대상 컬렉션: ${TARGETED.length}개`);

let grand = 0;
for (const [label, filePath] of Object.entries(FILES)) {
  if (onlyFile && onlyFile !== label) continue;
  grand += processFile(label, filePath);
}

console.log(`\n총 변환: ${grand} 건`);
if (!apply) console.log('\n(DRY-RUN) 실제 적용은 --apply 추가.\n');
else console.log('\n✅ 완료\n');
