// ScoreSnap 전용앱에서 [개발자에게 전달]로 남긴 의견 목록 — 읽기 전용
// 사용: node scripts/diag/list-scoresnap-feedback.js [개수=20]
const { getDb } = require('../lib/firebase-admin');
const N = parseInt(process.argv[2] || '20', 10);
const kst = (ts) => { try { const d = ts && ts.toDate ? ts.toDate() : new Date(ts); return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16); } catch (_) { return '(시간 없음)'; } };
(async () => {
  const db = getDb();
  const snap = await db.collection('scoresnapSessions').where('kind', '==', 'feedback').get();
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.savedAt?.toMillis?.() || 0) - (a.savedAt?.toMillis?.() || 0)).slice(0, N);
  if (!rows.length) { console.log('전달된 의견이 없어요.'); return; }
  for (const r of rows) {
    console.log('='.repeat(70));
    console.log(`[${kst(r.savedAt)}] ${r.id} | 화면: ${r.context?.화면 || ''} | ${r.context?.폭 || ''} | 시험: ${r.context?.시험이름 || ''} | 문항 ${r.context?.정답지문항수 || 0} | 학생 ${r.context?.학생수 || 0}`);
    for (const m of r.messages || []) console.log((m.role === 'user' ? '  학원장: ' : '  답변:   ') + String(m.text).replace(/\n/g, ' '));
  }
})().catch(e => { console.error(e.message); process.exit(1); });
