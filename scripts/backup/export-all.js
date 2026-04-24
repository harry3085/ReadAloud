// Firestore 전체 로컬 백업 스크립트.
//
// 읽기만 하며 아무것도 쓰지 않습니다. 안전.
// Blaze 요금제 없이도 동작 (Admin SDK 가 모든 문서를 읽어 JSON 파일로 저장).
//
// 사용:
//   node scripts/backup/export-all.js
//
// 출력:
//   backups/firestore-YYYYMMDD-HHmm.json
//
// 복구:
//   Firebase Console 에서 수동으로 되돌리거나, 별도 복구 스크립트 작성.
//   (소규모 학원 데이터는 보통 수동 복구로 충분)

const fs = require('fs');
const path = require('path');
const { getDb } = require('../lib/firebase-admin');

// migrate 스크립트와 동일 목록 유지
const TOP_LEVEL_COLLECTIONS = [
  'users', 'groups', 'units', 'tests', 'scores', 'notices',
  'hwFiles', 'userNotifications', 'fcmTokens', 'payments',
  'savedPushList', 'books', 'folders', 'pushNotifications',
  'genBooks', 'genChapters', 'genPages', 'genQuestionSets',
  'genCleanupPresets', 'genTests', 'apiUsage',
  // 이번 작업에서 새로 만든 컬렉션도 백업 대상
  'plans', 'academies',
];

const SUBCOLLECTIONS = [
  { parent: 'tests', sub: 'userCompleted' },
  { parent: 'genTests', sub: 'userCompleted' },
  { parent: 'books', sub: 'units' },
];

// Firestore Timestamp / DocumentReference 등을 JSON 으로 변환
function serializeValue(v) {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'object') return v;
  if (v._seconds !== undefined && v._nanoseconds !== undefined) {
    return { __type: 'timestamp', seconds: v._seconds, nanoseconds: v._nanoseconds };
  }
  if (typeof v.toDate === 'function') {
    return { __type: 'timestamp', iso: v.toDate().toISOString() };
  }
  if (Array.isArray(v)) return v.map(serializeValue);
  if (v.constructor === Object) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = serializeValue(val);
    return out;
  }
  return v;
}

function serializeDoc(doc) {
  const data = doc.data();
  const out = { _id: doc.id };
  for (const [k, v] of Object.entries(data)) {
    out[k] = serializeValue(v);
  }
  return out;
}

async function main() {
  const db = getDb();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16).replace('T', '-');
  const outDir = path.resolve(__dirname, '../../backups');
  const outFile = path.join(outDir, `firestore-${stamp}.json`);

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n=== Firestore 백업 시작 ===\n`);
  console.log(`출력: ${path.relative(process.cwd(), outFile)}\n`);

  const result = {
    exportedAt: new Date().toISOString(),
    projectId: process.env.FIREBASE_PROJECT_ID || 'readaloud-51113',
    collections: {},
    subcollections: {},
  };

  let totalDocs = 0;

  for (const col of TOP_LEVEL_COLLECTIONS) {
    try {
      const snap = await db.collection(col).get();
      result.collections[col] = snap.docs.map(serializeDoc);
      totalDocs += snap.size;
      console.log(`• ${col.padEnd(22)} ${snap.size} docs`);
    } catch (e) {
      console.log(`• ${col.padEnd(22)} ERROR: ${e.message}`);
      result.collections[col] = { __error: e.message };
    }
  }

  console.log();
  for (const { parent, sub } of SUBCOLLECTIONS) {
    const label = `${parent}/*/${sub}`;
    try {
      const parentSnap = await db.collection(parent).get();
      const bucket = {};
      let subTotal = 0;
      for (const pDoc of parentSnap.docs) {
        const subSnap = await pDoc.ref.collection(sub).get();
        if (subSnap.size > 0) {
          bucket[pDoc.id] = subSnap.docs.map(serializeDoc);
          subTotal += subSnap.size;
        }
      }
      result.subcollections[label] = bucket;
      totalDocs += subTotal;
      console.log(`• ${label.padEnd(28)} ${subTotal} docs`);
    } catch (e) {
      console.log(`• ${label.padEnd(28)} ERROR: ${e.message}`);
      result.subcollections[label] = { __error: e.message };
    }
  }

  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
  const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);

  console.log(`\n─── 요약 ───`);
  console.log(`총 문서: ${totalDocs} 건`);
  console.log(`파일 크기: ${sizeMB} MB`);
  console.log(`저장 위치: ${outFile}\n`);
  console.log(`✅ 백업 완료\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('\n[error]', err);
  process.exit(1);
});
