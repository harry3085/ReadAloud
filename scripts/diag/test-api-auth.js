// API 인증 차단 검증 — idToken 없이 호출 시 401 응답 확인
//
// 사용:
//   node scripts/diag/test-api-auth.js [base_url]
//   기본: https://raloud.vercel.app

const BASE = process.argv[2] || 'https://raloud.vercel.app';

const targets = [
  { path: '/api/generate-quiz',         body: { pages: [{id:'x', text:'sample text more than 20 chars'}], type: 'mcq', count: 1 } },
  { path: '/api/cleanup-ocr',           body: { text: 'hello world', systemPrompt: 'translate to korean please' } },
  { path: '/api/ocr',                   body: { imageBase64: 'aGVsbG8=' } },
  { path: '/api/check-recording',       body: { mode: 'check', originalText: 'hello', audioBase64: 'aGVsbG8=' } },
  { path: '/api/sendPush',              body: { title: 't', body: 'b', target: 'all' } },
  { path: '/api/createStudent',         body: { username: 'x', password: 'xxxxxx', name: 'x' } },
  { path: '/api/updateStudentPassword', body: { uid: 'x', password: 'xxxxxx' } },
];

async function test() {
  console.log(`\n=== API 인증 차단 검증 (${BASE}) ===\n`);
  console.log(`기대: idToken 없이 호출 → 401/403 응답\n`);
  let passed = 0, failed = 0;

  for (const t of targets) {
    try {
      const r = await fetch(BASE + t.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t.body),
      });
      const j = await r.json().catch(() => ({}));
      const ok = r.status === 401 || r.status === 403;
      const symbol = ok ? '✅' : '❌';
      console.log(`  ${symbol} ${t.path.padEnd(35)} → ${r.status}  ${j.error || ''}`);
      if (ok) passed++; else failed++;
    } catch (e) {
      console.log(`  ⚠️  ${t.path.padEnd(35)} → 네트워크 에러: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n결과: ${passed}/${targets.length} 통과 (${failed} 실패)\n`);
  process.exit(failed > 0 ? 1 : 0);
}

test();
