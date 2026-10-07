// "단어장 (Snapshot)" 프롬프트 보완 — 원문에 없는 단어 생성·임의 선별·손글씨 혼입·뜻 분리 방지.
// 대상: appConfig/cleanupPresets(글로벌) + academies/{id}.customCleanupPresets(학원 커스텀) 의 같은 이름 프리셋.
// 사용: node scripts/admin/patch-snapshot-prompt.js          # DRY-RUN (백업 파일만 작성)
//       node scripts/admin/patch-snapshot-prompt.js --apply  # 실제 적용
const fs = require('fs');
const path = require('path');
const { getDb } = require('../lib/firebase-admin');

const NAME = '단어장 (Snapshot)';
const norm = s => String(s || '').replace(/\s/g, '').toLowerCase();

const NEW_RULES_MARK = '【원문 충실 규칙';
const ADD_BLOCK = `
【원문 충실 규칙 - 최우선】
- 원문(인쇄된 단어-뜻 목록)에 있는 항목만 출력. 원문에 없는 영단어는 절대 새로 만들지 말 것
  (유의어·동의어·원형·관련 단어로 바꾸거나 추가 금지. 예: 원문이 "selection – 전시품" 이면 그대로 selection / 전시품. exhibit 를 만들어내지 말 것)
- 영단어 철자와 한글 뜻은 원문 그대로. 한 항목의 뜻을 다른 영단어 줄로 옮기거나 쪼개지 말 것
  (예: "attend to – ~를 응대하다, 돌보다" 는 한 줄. "take care of – 돌보다" 를 따로 만들지 말 것)
- 원문 항목은 하나도 빠뜨리지 말 것. 임의로 일부만 고르지 말 것. 원문 순서 유지
- 손글씨·필기 메모·여백 낙서·동그라미 친 번호·체크박스는 단어가 아니므로 무시 (인쇄된 글자만 사용)
- 같은 영단어가 두 번 나오면 한 번만 출력
- 괄호는 짝을 맞춰 원문 그대로 유지 (예: "(사람, 몸 등이) 마른, 가는", "(시간을) 보내다, 쓰다")
- 한 항목의 뜻이 여러 줄에 걸쳐 있으면 합쳐서 한 줄에 (예: "더 이상 못 참다, 지긋지긋하다")
- 출력 전에 점검: 출력한 영단어가 모두 원문에 있는가 / 원문 항목 수와 같은가
`;

function patch(prompt) {
  if (prompt.includes(NEW_RULES_MARK)) return prompt;
  let p = prompt
    .replace(/2\.\s*주요단어로 선정/, '2. 원문에 있는 모든 단어를 빠짐없이 포함 (임의 선별·생략 금지)')
    .replace(/\(추측,신규생성 금지\)/, '(추측 금지)');
  const i = p.indexOf('\n규칙:');
  p = i >= 0 ? p.slice(0, i) + '\n' + ADD_BLOCK + p.slice(i) : p + '\n' + ADD_BLOCK;
  return p;
}

(async () => {
  const apply = process.argv.includes('--apply');
  const db = getDb();
  const bak = {};
  const jobs = [];

  const g = await db.doc('appConfig/cleanupPresets').get();
  const gp = (g.data() || {}).presets || [];
  bak.global = gp;
  jobs.push({ label: 'global', ref: db.doc('appConfig/cleanupPresets'), field: 'presets', list: gp });

  const acs = await db.collection('academies').get();
  for (const a of acs.docs) {
    const c = a.data().customCleanupPresets;
    if (!Array.isArray(c)) continue;
    bak['academy:' + a.id] = c;
    jobs.push({ label: 'academy:' + a.id, ref: a.ref, field: 'customCleanupPresets', list: c });
  }

  const bakPath = path.join(__dirname, 'snapshot-prompt-backup-' + Date.now() + '.json');
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
