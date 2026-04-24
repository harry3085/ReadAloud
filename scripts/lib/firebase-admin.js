// Firebase Admin SDK 공용 초기화 모듈 (로컬 스크립트용)
//
// 자격 증명 탐색 순서:
//   1) 환경변수 (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)
//      - api/*.js 와 동일한 방식. .env.local 에 추가해서 쓸 수 있음.
//   2) scripts/.firebase-admin-key.json (Firebase Console 에서 내려받은 서비스 계정 JSON)
//   3) 둘 다 없으면 친절한 에러 메시지 출력 후 종료
//
// 최초 설정은 scripts/README.md 참고.

const fs = require('fs');
const path = require('path');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

// .env.local 자동 로드 (scripts/ 기준 한 단계 위)
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
} catch (_) {
  // dotenv 미설치 시 조용히 무시 — 환경변수를 이미 셸에 export 했을 수도 있음
}

const KEY_FILE = path.resolve(__dirname, '../.firebase-admin-key.json');

function resolveCredential() {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    return {
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      _source: 'env',
    };
  }

  if (fs.existsSync(KEY_FILE)) {
    const raw = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    return {
      projectId: raw.project_id,
      clientEmail: raw.client_email,
      privateKey: raw.private_key,
      _source: `file (${path.relative(process.cwd(), KEY_FILE)})`,
    };
  }

  console.error('\n[firebase-admin] 자격 증명을 찾지 못했습니다.\n');
  console.error('다음 중 하나를 설정하세요:');
  console.error('  A) .env.local 에 FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY 추가');
  console.error(`  B) ${KEY_FILE} 에 서비스 계정 JSON 저장`);
  console.error('\n자세한 절차는 scripts/README.md 참고.\n');
  process.exit(1);
}

let _cachedApp = null;

function getAdmin() {
  if (_cachedApp) return _cachedApp;

  if (getApps().length > 0) {
    _cachedApp = getApps()[0];
    return _cachedApp;
  }

  const cred = resolveCredential();
  _cachedApp = initializeApp({
    credential: cert({
      projectId: cred.projectId,
      clientEmail: cred.clientEmail,
      privateKey: cred.privateKey,
    }),
  });

  console.log(`[firebase-admin] initialized (project=${cred.projectId}, source=${cred._source})`);
  return _cachedApp;
}

function getDb() {
  getAdmin();
  return getFirestore();
}

function getAuthAdmin() {
  getAdmin();
  return getAuth();
}

module.exports = { getAdmin, getDb, getAuthAdmin };
