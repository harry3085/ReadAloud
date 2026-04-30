// 글로벌 appConfig (AI 프롬프트 + 클린업 프리셋) 초기 시드.
// 코드의 SYSTEM_PROMPTS / _CLEANUP_DEFAULT_PRESETS 를 Firestore appConfig/* 에 박음.
//
// 이후 super_admin 앱 UI 에서 편집하면 Firestore 갱신 → 모든 학원에 즉시 반영.
// 코드 상수는 fallback 으로 유지 (Firestore 비어있을 때 안전망).
//
// 사용:
//   node scripts/admin/seed-app-config.js          # DRY-RUN
//   node scripts/admin/seed-app-config.js --apply  # 적용
//   node scripts/admin/seed-app-config.js --apply --force  # 이미 있어도 덮어쓰기

const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

// 코드의 SYSTEM_PROMPTS — api/generate-quiz.js 에서 동적 추출 (중복 회피)
// 정규식으로 const SYSTEM_PROMPTS = {...} 정의 부분만 잘라 Function 으로 평가
const fs = require('fs');
const path = require('path');
function loadSystemPrompts() {
  const src = fs.readFileSync(path.join(__dirname, '../../api/generate-quiz.js'), 'utf8');
  const m = src.match(/const SYSTEM_PROMPTS\s*=\s*(\{[\s\S]*?\n\});/);
  if (!m) throw new Error('SYSTEM_PROMPTS not found in api/generate-quiz.js');
  // template literal (backtick) 포함하므로 JSON.parse 안 되고 Function 평가 필요
  return (new Function('return ' + m[1]))();
}
const SYSTEM_PROMPTS = loadSystemPrompts();

// 코드의 _CLEANUP_DEFAULT_PRESETS — public/admin/js/app.js 와 동일
const CLEANUP_DEFAULT_PRESETS = [
  {
    name: "단어장 (Snapshot)",
    description: "영단어[Tab]한글해석 형식으로 정리",
    prompt: `이 본문은 영어 단어장입니다.
각 항목을 "영단어[Tab]한글해석" 형식의 한 줄로 정리하세요.

규칙:
1. 각 줄: 영단어 → Tab 문자(\\t) → 한글 해석 → 줄바꿈
2. 주요단어로 선정
3. 번호, 불릿, 점선, 장식 기호 모두 제거 (예: "1.", "①", "•", "...", ">")
4. 한 영단어에 여러 뜻이 있으면 쉼표(, )로 구분해 같은 줄에 유지
6. 예문·설명 문장은 제거하고 단어-뜻 쌍만 남김
7. OCR 오인식 의심되는 경우에도 원문 단어를 그대로 유지 (추측 금지)

출력은 정리된 단어 목록만. 마크다운·서문·번호 매기기 금지.`,
    order: 1, isDefault: true,
  },
  {
    name: "기본 정리",
    description: "페이지번호/하이픈/줄바꿈 정리",
    prompt: `다음 영어 본문을 정리하세요. 의미는 절대 변경하지 말고 형식만 다듬으세요.
1. 페이지 번호, 머리말/꼬리말, 저작권 표기 제거
2. 줄끝 하이픈(-)으로 분리된 단어는 병합 (예: "exam-\\nple" → "example")
3. 단락 내부의 강제 줄바꿈은 공백으로 통합 (문단 경계에서만 줄바꿈)
4. 연속된 빈 줄은 1줄로 축소
5. OCR 오인식으로 보이는 명백한 오타만 수정 (의심되면 그대로 둠)

정리된 본문만 출력. 설명·서문·마크다운 금지.`,
    order: 2, isDefault: true,
  },
  {
    name: "교재 문제지",
    description: "문제 번호/선택지/Answer Key 정리",
    prompt: `이 본문은 영어 교재의 문제 섹션입니다. 다음 규칙으로 정리하세요.
1. 문제 번호(1. 2. 3. 또는 ① ② ③) 유지, 번호 앞뒤 공백 정규화
2. 선택지(A/B/C/D 또는 ① ② ③ ④)는 각각 새 줄로
3. 지문(Passage)과 문제를 빈 줄로 구분
4. Answer Key 섹션은 별도 블록으로 분리
5. 페이지 번호·머리말 제거

정리된 본문만 출력. 마크다운·서문 금지.`,
    order: 3, isDefault: true,
  },
  {
    name: "문장 전체 번역",
    description: "page전체 문장을 해석하여 아래 추가함",
    prompt: `다음 영어 본문을 정리 후 번역을 추가하세요. 의미는 절대 변경하지 말고 형식만 다듬으세요.
1. 페이지 번호, 머리말/꼬리말, 저작권 표기 제거
2. 줄끝 하이픈(-)으로 분리된 단어는 병합 (예: "exam-\\nple" → "example")
3. 단락 내부의 강제 줄바꿈은 공백으로 통합 (문단 경계에서만 줄바꿈)
4. 연속된 빈 줄은 1줄로 축소
5. OCR 오인식으로 보이는 명백한 오타만 수정 (의심되면 그대로 둠)

정리된 영문본문전체와 한글해석을 그아래 추가하여 출력. 설명·서문·마크다운 금지.
`,
    order: 4, isDefault: false,
  },
];

(async () => {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  const db = getDb();

  console.log(`\n=== seed-app-config ${apply ? '(APPLY)' : '(DRY-RUN)'}${force ? ' [FORCE]' : ''} ===\n`);

  // 1. AI 프롬프트
  const aiRef = db.doc('appConfig/aiPrompts');
  const aiSnap = await aiRef.get();
  const aiTypes = ['mcq', 'fill_blank', 'unscramble', 'subjective', 'recording', 'vocab'];

  if (aiSnap.exists && !force) {
    console.log('appConfig/aiPrompts: 이미 존재 (--force 로 덮어쓰기)');
    const data = aiSnap.data();
    aiTypes.forEach(t => console.log(`  ${t}: ${data[t] ? data[t].length + '자' : '(없음)'}`));
  } else {
    const payload = {};
    aiTypes.forEach(t => {
      if (SYSTEM_PROMPTS[t]) payload[t] = SYSTEM_PROMPTS[t];
    });
    payload._updatedAt = FieldValue.serverTimestamp();
    payload._updatedBy = 'seed-script';
    if (apply) {
      await aiRef.set(payload, { merge: false });
      console.log('appConfig/aiPrompts: 시드 완료');
      aiTypes.forEach(t => console.log(`  ${t}: ${payload[t] ? payload[t].length + '자' : '(없음)'}`));
    } else {
      console.log('appConfig/aiPrompts: 시드 대상');
      aiTypes.forEach(t => console.log(`  ${t}: ${payload[t] ? payload[t].length + '자' : '(없음)'}`));
    }
  }

  console.log();

  // 2. 클린업 프리셋
  const clRef = db.doc('appConfig/cleanupPresets');
  const clSnap = await clRef.get();

  if (clSnap.exists && !force) {
    console.log('appConfig/cleanupPresets: 이미 존재 (--force 로 덮어쓰기)');
    const data = clSnap.data();
    const presets = data.presets || [];
    console.log(`  presets: ${presets.length}개`);
    presets.forEach(p => console.log(`    - ${p.name}`));
  } else {
    const payload = {
      presets: CLEANUP_DEFAULT_PRESETS,
      _updatedAt: FieldValue.serverTimestamp(),
      _updatedBy: 'seed-script',
    };
    if (apply) {
      await clRef.set(payload, { merge: false });
      console.log('appConfig/cleanupPresets: 시드 완료');
      console.log(`  presets: ${CLEANUP_DEFAULT_PRESETS.length}개`);
      CLEANUP_DEFAULT_PRESETS.forEach(p => console.log(`    - ${p.name}`));
    } else {
      console.log('appConfig/cleanupPresets: 시드 대상');
      console.log(`  presets: ${CLEANUP_DEFAULT_PRESETS.length}개`);
      CLEANUP_DEFAULT_PRESETS.forEach(p => console.log(`    - ${p.name}`));
    }
  }

  console.log(`\n${apply ? '✅ 적용 완료' : '(DRY-RUN — --apply 로 적용)'}\n`);
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
