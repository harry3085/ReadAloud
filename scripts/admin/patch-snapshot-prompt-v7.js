// "단어장 (Snapshot)" 프롬프트 v7 — 규칙 3 의 모순 해소: "~(틸드)는 생략하지 말 것" 과 예시(~ 를 지우는 예)가 충돌해
// AI 가 예시를 따라 take ~ away → take away 로 ~ 를 지우던 문제. 예시를 '~ 유지' 로 교체. (v1~v6 적용 후 실행)
// 사용: node scripts/admin/patch-snapshot-prompt-v7.js          # DRY-RUN (백업만)
//       node scripts/admin/patch-snapshot-prompt-v7.js --apply  # 적용
const fs = require('fs');
const path = require('path');
const { getDb } = require('../lib/firebase-admin');

const NAME = '단어장 (Snapshot)';
const norm = s => String(s).replace(/\s/g, '').toLowerCase();
const V7_MARK = '(~ 유지 예시)';

const OLD_EXAMPLES = `   예시:
     영단어 "name ~ after ..." → "name after"
     영단어 "look ~ up" → "look up"
     한글 "~와 공유하다" → "공유하다"
     한글 "~에 신청하다, 등록하다" → "신청하다, 등록하다"
     한글 "…의 이름을 따서 ~의 이름을 짓다" → "이름을 따서 짓다"`;

const NEW_EXAMPLES = `   (~ 유지 예시) "~"(틸드)는 영단어 칸·한글 뜻 칸 어디서든 원문 그대로 반드시 남길 것. "..."·"…" 만 지움
     영단어 "name ~ after ..." → "name ~ after"
     영단어 "take ~ away" → "take ~ away"
     영단어 "think ~ over" → "think ~ over"
     한글 "~와 공유하다" → "~와 공유하다"
     한글 "~을 빼앗다" → "~을 빼앗다"
     한글 "~에 신청하다, 등록하다" → "~에 신청하다, 등록하다"`;

function patch(prompt) {
  if (prompt.includes(V7_MARK)) return prompt;
  if (!prompt.includes(OLD_EXAMPLES)) throw new Error('예시 블록 앵커 없음');
  return prompt.replace(OLD_EXAMPLES, NEW_EXAMPLES);
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

  const bakPath = path.join(__dirname, 'snapshot-prompt-backup-v7-' + Date.now() + '.json');
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
