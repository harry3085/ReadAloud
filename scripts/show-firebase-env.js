// Vercel 대시보드에 붙여넣을 Firebase Admin env var 값들을 로컬 JSON 에서 추출해 출력.
//
// 사용:
//   node scripts/show-firebase-env.js
//
// 출력된 3개 값을 Vercel Dashboard → Settings → Environment Variables 에
// 각각 Add New 로 추가 (Production/Preview/Development 모두 체크).

const fs = require('fs');
const path = require('path');

const KEY_FILE = path.resolve(__dirname, '.firebase-admin-key.json');
if (!fs.existsSync(KEY_FILE)) {
  console.error(`\n❌ ${KEY_FILE} 파일이 없습니다.\n`);
  process.exit(1);
}

const key = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));

console.log('\n' + '='.repeat(70));
console.log('  Vercel 대시보드에 붙여넣을 값 (3개)');
console.log('  Settings → Environment Variables → Add New');
console.log('  ⚠️ Production, Preview, Development 모두 체크');
console.log('='.repeat(70));

console.log('\n[1] Key: FIREBASE_PROJECT_ID');
console.log('    Value: ' + key.project_id);

console.log('\n[2] Key: FIREBASE_CLIENT_EMAIL');
console.log('    Value: ' + key.client_email);

console.log('\n[3] Key: FIREBASE_PRIVATE_KEY');
console.log('    Value: (아래 줄 전체를 통째로 복사. -----BEGIN 부터 -----\\n 까지)\n');
console.log(key.private_key);

console.log('\n' + '='.repeat(70));
console.log('  저장 후 Deployments → 최근 배포 ⋯ → Redeploy');
console.log('='.repeat(70) + '\n');
