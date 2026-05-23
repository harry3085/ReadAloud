// 클린업 프리셋 모델 변경 (2026-05-24):
//   기존: 학원별 본인 컬렉션(genCleanupPresets) 이 진실 출처. super 글로벌은 시드만.
//   신규: super 글로벌(appConfig/cleanupPresets) 이 진실 출처. 학원이 추가/수정한 것만
//         academies/{id}.customCleanupPresets 에 학원 커스텀으로 보존.
//
// 마이그레이션:
//   각 학원의 genCleanupPresets 중 글로벌과 다른(수정 또는 신규) 것만 추출 →
//   academies/{id}.customCleanupPresets 배열로 박음. 글로벌과 동일한 것은 무시(자동 적용).
//
// 사용:
//   node scripts/migrate/cleanup-presets-to-academy-custom.js              # DRY-RUN
//   node scripts/migrate/cleanup-presets-to-academy-custom.js --apply
//   node scripts/migrate/cleanup-presets-to-academy-custom.js --academyId=default --apply
//
// 옛 genCleanupPresets 컬렉션은 이 스크립트가 안 건드림 — 운용 안정 확인 후 별도 삭제.

const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

(async () => {
  const apply = process.argv.includes('--apply');
  const academyArg = process.argv.find(a => a.startsWith('--academyId='))?.split('=')[1] || '';
  const db = getDb();

  // 1. 글로벌 default 읽기
  const gSnap = await db.doc('appConfig/cleanupPresets').get();
  const globalArr = gSnap.exists ? (gSnap.data()?.presets || []) : [];
  const globalByName = {};
  globalArr.forEach(p => { if (p?.name) globalByName[p.name] = p; });

  console.log(`\n=== 클린업 프리셋 → academies/{id}.customCleanupPresets ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);
  console.log(`글로벌 default: ${globalArr.length}개 (${Object.keys(globalByName).join(', ')})\n`);

  // 2. 학원별 genCleanupPresets 스캔 + 그룹
  let q = db.collection('genCleanupPresets');
  if (academyArg) q = q.where('academyId', '==', academyArg);
  const allSnap = await q.get();
  const byAcademy = {};
  allSnap.forEach(d => {
    const data = d.data();
    const aid = data.academyId;
    if (!aid) return;
    if (!byAcademy[aid]) byAcademy[aid] = [];
    byAcademy[aid].push({
      id: d.id,
      name: data.name || '',
      prompt: data.prompt || '',
      description: data.description || '',
      order: data.order || 0,
      isDefault: !!data.isDefault,
    });
  });

  let totalCustom = 0;
  const updates = [];  // { academyId, customArr }

  for (const [aid, presets] of Object.entries(byAcademy)) {
    const customPresets = [];
    for (const p of presets) {
      const gp = globalByName[p.name];
      if (gp === undefined) {
        // 글로벌에 없음 → 학원 자체 신규 (보존)
        customPresets.push({ name: p.name, prompt: p.prompt, description: p.description, order: p.order, isDefault: p.isDefault, _origin: 'academy-new' });
      } else if (gp.prompt !== p.prompt) {
        // 글로벌과 다름 → 학원 수정 (보존)
        customPresets.push({ name: p.name, prompt: p.prompt, description: p.description, order: p.order, isDefault: p.isDefault, _origin: 'academy-modified' });
      }
      // 글로벌과 동일 → 무시 (자동 적용)
    }
    if (customPresets.length === 0) {
      console.log(`[학원 ${aid}] ${presets.length}건 모두 글로벌과 동일 — 커스텀 저장 skip`);
      continue;
    }
    console.log(`[학원 ${aid}] ${customPresets.length}건 학원 커스텀:`);
    customPresets.forEach(c => console.log(`  - ${c.name} (${c.prompt.length}자) — ${c._origin}`));
    totalCustom += customPresets.length;
    updates.push({ aid, customPresets });
  }

  if (totalCustom === 0) {
    console.log(`\n전체 학원이 글로벌과 동일 — 마이그레이션 불필요\n`);
    process.exit(0);
  }

  console.log(`\n총 ${totalCustom}건 학원 커스텀 (${updates.length}개 학원)\n`);

  if (!apply) {
    console.log('DRY-RUN — --apply 로 실제 적용\n');
    process.exit(0);
  }

  // 적용 — academies/{id}.customCleanupPresets 에 배열로 박음
  for (const u of updates) {
    // _origin 메타는 보존 (어디서 왔는지 추적용)
    const cleanArr = u.customPresets.map(p => ({
      name: p.name,
      prompt: p.prompt,
      description: p.description || '',
      order: p.order || 0,
      isDefault: !!p.isDefault,
    }));
    await db.doc(`academies/${u.aid}`).set({
      customCleanupPresets: cleanArr,
      customCleanupPresetsUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`✓ [학원 ${u.aid}] customCleanupPresets ${cleanArr.length}건 저장`);
  }

  console.log(`\n완료 — ${updates.length}개 학원 마이그레이션\n`);
  console.log('주의: 옛 genCleanupPresets 컬렉션은 이 스크립트가 안 건드림.');
  console.log('운용 안정 확인 후 별도 삭제 스크립트로 정리.\n');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
