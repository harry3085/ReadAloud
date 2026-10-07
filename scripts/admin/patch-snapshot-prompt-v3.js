// "단어장 (Snapshot)" 프롬프트 v3 — 유형 판단을 '항목 모양' 기준으로 정교화
// (번호/기호가 붙은 짧은 단어-뜻 목록 = A, 번호가 있어도 완성 문장이면 = B) + 번호 없는 영단어(손글씨) 제외.
// 대상: appConfig/cleanupPresets + academies/{id}.customCleanupPresets 의 같은 이름 프리셋.
// 사용: node scripts/admin/patch-snapshot-prompt-v3.js          # DRY-RUN (백업만)
//       node scripts/admin/patch-snapshot-prompt-v3.js --apply  # 적용
const fs = require('fs');
const path = require('path');
const { getDb } = require('../lib/firebase-admin');

const NAME = '단어장 (Snapshot)';
const norm = s => String(s || '').replace(/\s/g, '').toLowerCase();
const V2_MARK = '【본문 유형 판단';
const V3_MARK = '(번호·기호 규칙)';

const TYPE_BLOCK = `【본문 유형 판단 - 먼저 수행】
본문을 보고 아래 두 유형 중 하나로 판단한 뒤, 해당 유형의 규칙만 적용하세요.
판단 기준은 번호 유무가 아니라 "항목의 모양"입니다.

[유형 A: 단어장 페이지] 짧은 영단어·숙어(보통 1~4단어)와 한글 뜻이 짝지어진 목록·표 형태
  - 인쇄된 항목을 하나도 빠뜨리지 말고 전부 출력 (임의 선별·생략 금지), 원문 순서 유지
  - 원문에 없는 영단어는 절대 새로 만들지 말 것 (유의어·동의어·원형·관련 단어로 바꾸거나 추가 금지)
    예: 원문이 "selection – 전시품" 이면 그대로 selection / 전시품. exhibit 를 만들어내지 말 것
  - 짝이 되는 영단어를 찾을 수 없는 한글 뜻은 버릴 것 (영단어를 지어내서 붙이지 말 것)
  - 영단어 철자와 한글 뜻은 원문 그대로. 한 항목의 뜻을 다른 영단어 줄로 옮기거나 쪼개지 말 것
    예: "attend to – ~를 응대하다, 돌보다" 는 한 줄. "take care of – 돌보다" 를 따로 만들지 말 것
  - 한 항목의 뜻이 여러 줄에 걸쳐 있거나 괄호 부분(예: "(흥미로운 것을)")이 따로 떨어져 있으면 합쳐서 한 줄에
  - 괄호는 짝을 맞춰 원문 그대로 유지 (예: "(사람, 몸 등이) 마른, 가는")
  - 같은 영단어가 두 번 나오면 한 번만 출력
  - (번호·기호 규칙) 영단어 앞에 "□ 12", "12.", "①", "•" 같은 번호·체크박스·기호가 일관되게 붙어 있는 목록이면,
    그 번호·기호가 붙은 영단어만 단어로 인정할 것. 번호·기호가 없는 영단어(손글씨·필기·낙서·잘못 읽힌 글자)는 제외
    최종 항목 수는 보이는 최대 번호와 같아야 함 (빠진 번호가 있으면 다시 찾아서 포함)
  - 번호·기호가 없는 단어장(영단어-뜻만 나열)이면 위 (번호·기호 규칙)은 적용하지 않음
  - 손글씨·필기 메모·여백 낙서·동그라미 친 번호·체크박스는 단어가 아니므로 무시 (인쇄된 글자만 사용)

[유형 B: 일반 문장·지문 페이지] 문단·문장으로 이루어진 본문
  - 번호가 붙어 있어도 항목이 완성된 문장이면(예: "1. He goes to school every day.") 유형 B
  - 학습 가치가 있는 주요 단어·숙어만 선정 (관사·대명사·be동사 등 기초 단어는 제외)
  - 영단어는 반드시 본문에 나온 단어·표현 그대로 (본문에 없는 단어 생성 금지)
  - 한글 뜻은 본문 문맥에 맞는 뜻 1~2개
  - 같은 단어는 한 번만, 본문 등장 순서대로
  - 손글씨·필기 메모는 무시

출력 전 점검: 출력한 영단어가 모두 본문에 있는가 / (유형 A) 번호 목록이면 최대 번호와 항목 수가 같은가
`;

function patch(prompt) {
  if (prompt.includes(V3_MARK)) return prompt;
  const s = prompt.indexOf(V2_MARK);
  if (s < 0) throw new Error('v2 블록 없음 — v2 먼저 적용 필요');
  const e = prompt.indexOf('\n규칙:', s);
  if (e < 0) throw new Error('규칙: 앵커 없음');
  return prompt.slice(0, s) + TYPE_BLOCK + prompt.slice(e);
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

  const bakPath = path.join(__dirname, 'snapshot-prompt-backup-v3-' + Date.now() + '.json');
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
