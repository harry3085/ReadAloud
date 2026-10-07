// "단어장 (Snapshot)" 프롬프트 v2 — 본문 유형(A 단어장 / B 일반 문장)에 따라 규칙 분기.
// v1(patch-snapshot-prompt.js)의 '전부 포함' 규칙이 일반 문장 페이지에 부적합해 교체.
// 대상: appConfig/cleanupPresets + academies/{id}.customCleanupPresets 의 같은 이름 프리셋.
// 사용: node scripts/admin/patch-snapshot-prompt-v2.js          # DRY-RUN (백업만)
//       node scripts/admin/patch-snapshot-prompt-v2.js --apply  # 적용
const fs = require('fs');
const path = require('path');
const { getDb } = require('../lib/firebase-admin');

const NAME = '단어장 (Snapshot)';
const norm = s => String(s || '').replace(/\s/g, '').toLowerCase();
const V1_MARK = '【원문 충실 규칙';
const V2_MARK = '【본문 유형 판단';

const TYPE_BLOCK = `
【본문 유형 판단 - 먼저 수행】
본문을 보고 아래 두 유형 중 하나로 판단한 뒤, 해당 유형의 규칙만 적용하세요.

[유형 A: 단어장 페이지] "영단어 + 한글 뜻" 쌍이 목록·표 형태로 인쇄되어 있음
  - 인쇄된 항목을 하나도 빠뜨리지 말고 전부 출력 (임의 선별·생략 금지), 원문 순서 유지
  - 원문에 없는 영단어는 절대 새로 만들지 말 것 (유의어·동의어·원형·관련 단어로 바꾸거나 추가 금지)
    예: 원문이 "selection – 전시품" 이면 그대로 selection / 전시품. exhibit 를 만들어내지 말 것
  - 영단어 철자와 한글 뜻은 원문 그대로. 한 항목의 뜻을 다른 영단어 줄로 옮기거나 쪼개지 말 것
    예: "attend to – ~를 응대하다, 돌보다" 는 한 줄. "take care of – 돌보다" 를 따로 만들지 말 것
  - 한 항목의 뜻이 여러 줄에 걸쳐 있으면 합쳐서 한 줄에
  - 손글씨·필기 메모·여백 낙서·동그라미 친 번호·체크박스는 단어가 아니므로 무시 (인쇄된 글자만 사용)
  - 같은 영단어가 두 번 나오면 한 번만 출력
  - 괄호는 짝을 맞춰 원문 그대로 유지 (예: "(사람, 몸 등이) 마른, 가는")

[유형 B: 일반 문장·지문 페이지] 문단·문장으로 이루어진 본문
  - 학습 가치가 있는 주요 단어·숙어만 선정 (관사·대명사·be동사 등 기초 단어는 제외)
  - 영단어는 반드시 본문에 나온 단어·표현 그대로 (본문에 없는 단어 생성 금지)
  - 한글 뜻은 본문 문맥에 맞는 뜻 1~2개
  - 같은 단어는 한 번만, 본문 등장 순서대로
  - 손글씨·필기 메모는 무시

출력 전 점검: 출력한 영단어가 모두 본문에 있는가 / (유형 A) 원문 항목 수와 같은가
`;

function patch(prompt) {
  if (prompt.includes(V2_MARK)) return prompt;
  let p = prompt;
  // v1 블록 제거 ('\n【원문 충실 규칙' ~ '\n규칙:' 직전)
  const s = p.indexOf('\n' + V1_MARK);
  if (s >= 0) {
    const e = p.indexOf('\n규칙:', s);
    if (e > s) p = p.slice(0, s) + p.slice(e);
  }
  // 규칙 2 교체 (v1 문구 / 원문 '주요단어로 선정' 모두 대응)
  p = p
    .replace(/2\.\s*원문에 있는 모든 단어를 빠짐없이 포함[^\n]*/, '2. 위 [본문 유형 판단]의 유형별 규칙에 따라 단어 선정')
    .replace(/2\.\s*주요단어로 선정/, '2. 위 [본문 유형 판단]의 유형별 규칙에 따라 단어 선정')
    .replace(/\(추측,신규생성 금지\)/, '(추측 금지)')
    .replace('이 본문은 영어 단어장입니다.', '이 본문은 영어 단어장 또는 영어 지문입니다.');
  const i = p.indexOf('\n규칙:');
  p = i >= 0 ? p.slice(0, i) + '\n' + TYPE_BLOCK + p.slice(i) : p + '\n' + TYPE_BLOCK;
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

  const bakPath = path.join(__dirname, 'snapshot-prompt-backup-v2-' + Date.now() + '.json');
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
    } else if (j.label === 'global') {
      console.log('----- 미리보기 -----\n' + np + '\n--------------------');
    }
  }
  console.log(apply ? '완료' : '(DRY-RUN)');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
