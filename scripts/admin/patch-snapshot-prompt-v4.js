// "단어장 (Snapshot)" 프롬프트 v4 — 발음기호([ækrənim] 등) 제거 규칙 추가.
// 대상: appConfig/cleanupPresets + academies/{id}.customCleanupPresets 의 같은 이름 프리셋.
// 사용: node scripts/admin/patch-snapshot-prompt-v4.js          # DRY-RUN (백업만)
//       node scripts/admin/patch-snapshot-prompt-v4.js --apply  # 적용
const fs = require('fs');
const path = require('path');
const { getDb } = require('../lib/firebase-admin');

const NAME = '단어장 (Snapshot)';
const norm = s => String(s).replace(/\s/g, '').toLowerCase();
const V4_MARK = '8. 발음기호';

const RULE8 = `8. 발음기호 제거: 영단어 뒤에 인쇄된 발음기호(대괄호 [ ] 안의 IPA 표기, 예: [ækrənim], [klous], [képtən])와
   그 괄호 자체는 절대 출력하지 말 것. 영단어와 한글 뜻만 남김
   예시:
     원문 "acronym [ækrənim]" → 영단어 "acronym"
     원문 "attract [atrekt] 동 끌어당기다, 매력이 있다" → "attract[Tab]끌어당기다, 매력이 있다"
     원문 "everyday [évridèi] 형 매일의" → "everyday[Tab]매일의"
   발음기호만 있고 한글 뜻이 없는 단어는 뜻 칸을 비워 둠 (발음기호를 뜻으로 쓰지 말 것)`;

function patch(prompt) {
  if (prompt.includes(V4_MARK)) return prompt;
  let p = prompt.replace(
    '6. 예문·설명 문장은 제거하고 단어-뜻 쌍만 남김',
    '6. 예문·설명 문장·발음기호([ ... ])는 제거하고 단어-뜻 쌍만 남김'
  );
  const anchor = /(7\.\s*OCR 오인식[^\n]*)/;
  if (!anchor.test(p)) throw new Error('규칙 7 앵커 없음');
  p = p.replace(anchor, '$1\n' + RULE8);
  return p;
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

  const bakPath = path.join(__dirname, 'snapshot-prompt-backup-v4-' + Date.now() + '.json');
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
