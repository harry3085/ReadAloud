// "단어장 (Snapshot)" 프롬프트 v5 — 품사 표기(동·형·명 등) 제거 규칙 추가. (v4 적용 후 실행)
// 대상: appConfig/cleanupPresets + academies/{id}.customCleanupPresets 의 같은 이름 프리셋.
// 사용: node scripts/admin/patch-snapshot-prompt-v5.js          # DRY-RUN (백업만)
//       node scripts/admin/patch-snapshot-prompt-v5.js --apply  # 적용
const fs = require('fs');
const path = require('path');
const { getDb } = require('../lib/firebase-admin');

const NAME = '단어장 (Snapshot)';
const norm = s => String(s).replace(/\s/g, '').toLowerCase();
const V5_MARK = '9. 품사 표기';

const RULE9 = `9. 품사 표기 제거: 뜻 앞뒤에 붙은 품사 표시는 출력하지 말 것. 출력은 오직 "영단어[Tab]한글 뜻" 뿐
   - 한글 약식: 동, 형, 명, 부, 전, 접, 대, 감 (예: "동 끌어당기다" → "끌어당기다")
   - 괄호·점 표기: (동), [명], (v.), n., adj., adv., prep., conj., pron., 자동, 타동
   - OCR 이 깨뜨린 품사 글자(뜻과 무관한 한 글자 기호)도 품사 자리에 있으면 제거
   - 한 단어에 품사가 여러 개(예: "동 올리다 명 게시물")면 품사만 지우고 뜻은 쉼표로 이어 한 줄에: "올리다, 게시물"
   - 뜻 안에 들어 있는 일반 한글 단어(예: "형제", "동물")는 품사가 아니므로 그대로 둠`;

function patch(prompt) {
  if (prompt.includes(V5_MARK)) return prompt;
  const anchor = '(발음기호를 뜻으로 쓰지 말 것)';
  const i = prompt.indexOf(anchor);
  if (i < 0) throw new Error('v4 규칙 8 앵커 없음 — v4 먼저 적용 필요');
  const end = i + anchor.length;
  return prompt.slice(0, end) + '\n' + RULE9 + prompt.slice(end);
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

  const bakPath = path.join(__dirname, 'snapshot-prompt-backup-v5-' + Date.now() + '.json');
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
