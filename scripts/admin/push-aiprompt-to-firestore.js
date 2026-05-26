// 코드 default(api/generate-quiz.js SYSTEM_PROMPTS) → Firestore(appConfig/aiPrompts) 박기.
// 학원장이 출제 시 보는 프롬프트는 Firestore 값이므로, 코드 변경 후 이 스크립트로
// Firestore 도 갱신해야 학원장에 반영됨.
//
// 학원장 본인 커스텀(academies/{id}.customPrompts)은 별도 — 영향 없음.
//
// 사용:
//   node scripts/admin/push-aiprompt-to-firestore.js --type=mcq            # DRY-RUN
//   node scripts/admin/push-aiprompt-to-firestore.js --type=mcq --apply
//   node scripts/admin/push-aiprompt-to-firestore.js --type=all --apply    # 갈라진 항목 전부
//   node scripts/admin/push-aiprompt-to-firestore.js --type=mcq,unscramble --apply

const fs = require('fs');
const path = require('path');
const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

function loadCodeDefaults() {
  const src = fs.readFileSync(path.resolve(__dirname, '../../api/generate-quiz.js'), 'utf8');
  const m = src.match(/const SYSTEM_PROMPTS = \{([\s\S]*?)\n\};/);
  if (!m) throw new Error('SYSTEM_PROMPTS 추출 실패 — api/generate-quiz.js 구조 변경?');
  const body = m[1];
  const out = {};
  const re = /^\s*(\w+):\s*`([\s\S]*?)`,?\s*$/gm;
  let mm;
  while ((mm = re.exec(body)) !== null) out[mm[1]] = mm[2];
  return out;
}

const ALL_TYPES = ['mcq', 'mcq_grammar', 'vocab', 'subjective', 'subjective_verbatim', 'fill_blank', 'unscramble', 'recording'];

(async () => {
  const apply = process.argv.includes('--apply');
  const typeArg = process.argv.find(a => a.startsWith('--type='))?.split('=')[1] || '';
  let targets;
  if (!typeArg || typeArg === 'all') {
    // all = 갈라진 항목 전부 자동 감지
    targets = ALL_TYPES;
  } else {
    targets = typeArg.split(',').map(s => s.trim()).filter(Boolean);
    const invalid = targets.filter(t => !ALL_TYPES.includes(t));
    if (invalid.length) {
      console.error(`잘못된 type: ${invalid.join(', ')}`);
      console.error(`허용: ${ALL_TYPES.join(', ')}`);
      process.exit(1);
    }
  }

  const code = loadCodeDefaults();
  const db = getDb();
  const ref = db.doc('appConfig/aiPrompts');
  const snap = await ref.get();
  const fsData = snap.exists ? snap.data() : {};

  console.log(`\n=== 코드 default → Firestore 박기 ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  // 갈라진 항목만 추출
  const diffs = [];
  for (const t of targets) {
    const c = code[t] || '';
    const f = fsData[t] || '';
    if (c === f) {
      console.log(`  [${t}] 이미 동일 (${c.length}자) — skip`);
      continue;
    }
    diffs.push({ type: t, codeLen: c.length, fsLen: typeof f === 'string' ? f.length : 0 });
    console.log(`  [${t}] 코드 ${c.length}자 → Firestore ${typeof f === 'string' ? f.length : 0}자 (덮기 예정)`);
  }

  if (diffs.length === 0) {
    console.log('\n갈라진 항목 없음.\n');
    process.exit(0);
  }

  if (!apply) {
    console.log(`\n총 ${diffs.length}건 박기 예정 — --apply 로 실제 적용\n`);
    process.exit(0);
  }

  // 적용
  const updates = {
    _updatedAt: FieldValue.serverTimestamp(),
    _updatedBy: 'admin script (push-aiprompt-to-firestore)',
  };
  for (const d of diffs) updates[d.type] = code[d.type];

  await ref.set(updates, { merge: true });
  console.log(`\n✓ 완료 — ${diffs.length}건 박음:`);
  for (const d of diffs) console.log(`  ${d.type}: ${d.fsLen}자 → ${d.codeLen}자`);
  console.log('');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
