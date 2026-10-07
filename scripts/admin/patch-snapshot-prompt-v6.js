// "단어장 (Snapshot)" 프롬프트 v6 — v4 의 "뜻 칸을 비워 둠" 이 영단어 반복 출력(acronym\tacronym)으로 오해된 문제 수정.
// 한글 뜻이 없는 단어는 뜻 칸을 완전히 비우고, 뜻 칸에는 한글만 쓰도록 명시. (v4·v5 적용 후 실행)
// 사용: node scripts/admin/patch-snapshot-prompt-v6.js          # DRY-RUN (백업만)
//       node scripts/admin/patch-snapshot-prompt-v6.js --apply  # 적용
const fs = require('fs');
const path = require('path');
const { getDb } = require('../lib/firebase-admin');

const NAME = '단어장 (Snapshot)';
const norm = s => String(s).replace(/\s/g, '').toLowerCase();
const V6_MARK = '(뜻 칸 규칙)';

const OLD_LINE = '   발음기호만 있고 한글 뜻이 없는 단어는 뜻 칸을 비워 둠 (발음기호를 뜻으로 쓰지 말 것)';
const NEW_LINE = `   (뜻 칸 규칙) 뜻 칸에는 한글 뜻만 쓸 것. 원문에서 한글 뜻을 찾을 수 없는 단어는
   "영단어[Tab]" 처럼 Tab 뒤를 완전히 비워 둘 것.
   - 영단어를 뜻 칸에 다시 쓰지 말 것 (잘못된 예: "blame[Tab]blame")
   - 발음기호·숫자·알파벳·기호(~, (), 77, H 등)를 뜻으로 쓰지 말 것
   - 뜻을 추측해서 새로 만들지 말 것 (원문에 없는 한글 뜻 생성 금지)
   올바른 예: "acronym[Tab]" (뜻 없음) / "attract[Tab]끌어당기다, 매력이 있다" (뜻 있음)`;

function patch(prompt) {
  if (prompt.includes(V6_MARK)) return prompt;
  if (!prompt.includes(OLD_LINE)) throw new Error('v4 규칙 8 마지막 줄 앵커 없음');
  return prompt.replace(OLD_LINE, NEW_LINE);
}

(async () => {
  const apply = process.argv.includes('--apply');
  const db = getDb();
  const bak = {};
  const jobs = [];

  const g = await db.doc('appConfig/cleanupPresets').get();
  const gp = (g.data() || {}).presets || [];
  bak.global = JSON.parse(JSON.stringify(gp));
  jobs.push({ label: 'global', ref: db.doc('appConfig/cleanupPresets'), field: 'presets', list: gp });

  const acs = await db.collection('academies').get();
  for (const a of acs.docs) {
    const c = a.data().customCleanupPresets;
    if (!Array.isArray(c)) continue;
    bak['academy:' + a.id] = JSON.parse(JSON.stringify(c));
    jobs.push({ label: 'academy:' + a.id, ref: a.ref, field: 'customCleanupPresets', list: c });
  }

  const bakPath = path.join(__dirname, 'snapshot-prompt-backup-v6-' + Date.now() + '.json');
  fs.writeFileSync(bakPath, JSON.stringify(bak, null, 2));
  console.log('백업:', bakPath);

  for (const j of jobs) {
    const t = j.list.find(p => norm(p.name) === norm(NAME));
    if (!t) { console.log(`- ${j.label}: Snapshot 없음 (스킵)`); continue; }
    const np = patch(t.prompt || '');
    if (np === t.prompt) { console.log(`- ${j.label}: 이미 적용됨`); continue; }
    console.log(`- ${j.label}: ${t.prompt.length}자 → ${np.length}자`);
    if (apply) {
      t.prompt = np;
      await j.ref.update({ [j.field]: j.list });
      console.log('   ✓ 적용');
    }
  }
  console.log(apply ? '완료' : '(DRY-RUN)');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
