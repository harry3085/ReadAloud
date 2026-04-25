// 검증 실패 토스트 → showAlert 모달 일괄 변환.
//
// 변환 대상: `if(...){showToast('XX');return;}` 패턴 (검증 실패 후 즉시 return)
// 비대상: 성공 메시지 (`showToast('✅ ...');`) — if 블록에 들어있지 않음
//
// await 없이 호출 — sync 함수에서도 안전, 모달은 동기적으로 표시됨
//
// 사용:
//   node scripts/refactor/toast-to-alert.js          # DRY-RUN (변환 후보 목록)
//   node scripts/refactor/toast-to-alert.js --apply  # 실제 파일 수정

const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '../../public/admin/js/app.js');
const apply = process.argv.includes('--apply');

const original = fs.readFileSync(FILE, 'utf8');

// if(cond){showToast('msg');return;}  /  if (cond) { showToast('msg'); return; }
// cond 안에 ()가 있는 경우도 1단계 깊이까지 허용 (예: !snap.exists())
// 한 줄 패턴 (멀티라인 if 블록은 제외 — 보수적)
const RE = /if\s*\(((?:[^()]|\([^)]*\))+?)\)\s*\{\s*showToast\(\s*(['"`])([^'"`\n]+?)\2\s*\)\s*;\s*return\s*;?\s*\}/g;

let count = 0;
const previews = [];

const updated = original.replace(RE, (match, cond, _q, msg) => {
  count++;
  if (previews.length < 10) {
    previews.push({ cond: cond.slice(0, 40), msg });
  }
  return `if (${cond.trim()}) { showAlert('입력 확인', '${msg.replace(/'/g, "\\'")}'); return; }`;
});

console.log(`\n=== showToast 검증 → showAlert 변환 (${apply ? 'APPLY' : 'DRY-RUN'}) ===\n`);
console.log(`매칭된 패턴: ${count} 건\n`);

if (previews.length > 0) {
  console.log(`샘플 (처음 ${previews.length}개):`);
  previews.forEach((p, i) => console.log(`  ${i + 1}. if(${p.cond}…) → "${p.msg}"`));
  console.log();
}

if (!apply) {
  console.log('(DRY-RUN) 실제 적용은 --apply 추가.\n');
  process.exit(0);
}

fs.writeFileSync(FILE, updated, 'utf8');
console.log(`✅ ${FILE} 에 적용 완료.\n`);
