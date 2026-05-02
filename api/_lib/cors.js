// 공통 CORS 헬퍼.
//
// 환경변수 ALLOWED_ORIGINS 미설정 시 → 와일드카드 (현 동작 유지, 안전)
// 설정 시 → 화이트리스트 도메인만 통과 (예: "https://raloud.vercel.app,https://kunsori.com")
//
// 사용:
//   const { setCors } = require('./_lib/cors');
//   setCors(req, res, { methods: 'POST, OPTIONS' });

function setCors(req, res, opts = {}) {
  const methods = opts.methods || 'POST, OPTIONS';
  const headers = opts.headers || 'Content-Type';

  const env = (process.env.ALLOWED_ORIGINS || '').trim();
  const allowed = env.split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers?.origin || '';

  if (allowed.length === 0 || allowed.includes('*')) {
    // env 미설정 → 와일드카드 (이전 동작 유지)
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    // origin 비어있거나 (서버 간 호출) 매칭 안 되면 origin 미설정 — 브라우저가 차단
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);
}

module.exports = { setCors };
