// 모든 학원의 genCleanupPresets 를 소스의 _CLEANUP_DEFAULT_PRESETS 와 동기화.
//
// 동작:
//   - 학원별로 name 매칭 (대소문자/공백 무시)
//   - 매치되는 프리셋: prompt / description / order / isDefault 업데이트
//   - 매치 안 되는 default 프리셋: 새로 추가
//   - 사용자 자작 프리셋 (소스 default 에 없는 이름) 은 손대지 않음
//
// 사용:
//   node scripts/migrate/sync-cleanup-defaults.js          # DRY-RUN
//   node scripts/migrate/sync-cleanup-defaults.js --apply  # 실제 적용

const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

// ─── 소스의 default 정의 (admin/js/app.js _CLEANUP_DEFAULT_PRESETS 와 동일) ───
const DEFAULTS = [
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

const norm = s => String(s || '').trim().toLowerCase();

(async () => {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== sync-cleanup-defaults ${apply ? '(APPLY)' : '(DRY-RUN)'} ===`);
  console.log(`소스 default: ${DEFAULTS.length}개\n`);

  // 학원 목록
  const academiesSnap = await db.collection('academies').get();
  const academies = academiesSnap.docs.map(d => d.id);
  console.log(`학원: ${academies.length}개 (${academies.join(', ')})\n`);

  let totalUpdated = 0, totalAdded = 0, totalSkipped = 0;

  for (const academyId of academies) {
    console.log(`── ${academyId} ──`);
    const presetsSnap = await db.collection('genCleanupPresets')
      .where('academyId', '==', academyId)
      .get();
    const existing = presetsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const byName = new Map(existing.map(p => [norm(p.name), p]));

    let updated = 0, added = 0, skipped = 0;

    for (const def of DEFAULTS) {
      const match = byName.get(norm(def.name));
      if (match) {
        // 동일 내용이면 skip
        const same = match.prompt === def.prompt
          && match.description === def.description
          && match.order === def.order
          && match.isDefault === def.isDefault;
        if (same) { skipped++; continue; }
        if (apply) {
          await db.collection('genCleanupPresets').doc(match.id).update({
            prompt: def.prompt,
            description: def.description,
            order: def.order,
            isDefault: def.isDefault,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        updated++;
        console.log(`  ✓ 업데이트: ${def.name}`);
      } else {
        if (apply) {
          await db.collection('genCleanupPresets').add({
            ...def,
            academyId,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            createdBy: 'sync-cleanup-defaults',
          });
        }
        added++;
        console.log(`  + 신규: ${def.name}`);
      }
    }
    if (skipped) console.log(`  · 동일(스킵): ${skipped}개`);
    console.log(`  → 업데이트 ${updated} / 신규 ${added} / 스킵 ${skipped}\n`);
    totalUpdated += updated; totalAdded += added; totalSkipped += skipped;
  }

  console.log(`${'='.repeat(40)}`);
  console.log(`총: 업데이트 ${totalUpdated} / 신규 ${totalAdded} / 스킵 ${totalSkipped}`);
  console.log(`${apply ? '✅ 적용 완료' : '(DRY-RUN — 실제 적용은 --apply)'}\n`);
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
