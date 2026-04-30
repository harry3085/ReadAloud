// academies 컬렉션에 SuperAdmin Phase A (T1) 신규 필드를 추가하는 마이그레이션.
//
// ⚠️ 실행 전 Firebase Console → Firestore → Export 로 백업 권장.
//
// 사용:
//   node scripts/migrate/extend-academies-schema.js           # DRY-RUN
//   node scripts/migrate/extend-academies-schema.js --apply   # 실제 쓰기
//
// 설계 원칙:
//   1. 기본값 DRY-RUN.
//   2. 멱등성 — 이미 있는 필드는 건드리지 않음. 재실행 안전.
//   3. grandfatheredPrice 가 number 인 기존 문서는 객체로 변환.
//      ({enabled:true, monthlyPrice:<원값>, yearlyPrice:0, grantedAt:null, note:''})
//      null/undefined 면 빈 객체로 초기화.
//   4. 기존 필드(name, planId, billingStatus, studentLimit, settings, usage 등)는 절대 변경하지 않음.

const { getDb } = require('../lib/firebase-admin');

const NEW_FIELDS_DEFAULTS = {
  planExpiresAt: null,
  acquisitionChannel: '',
  internalMemo: '',
  featureFlags: {
    aiGrowthReport: false,
    recordingAiFeedback: false,
  },
  contactLog: [],
  lastAdminLoginAt: null,
};

const EMPTY_GRANDFATHERED = {
  enabled: false,
  monthlyPrice: 0,
  yearlyPrice: 0,
  grantedAt: null,
  note: '',
};

function buildGrandfatheredPatch(existing) {
  // null / undefined → 빈 객체로 초기화
  if (existing === null || existing === undefined) {
    return EMPTY_GRANDFATHERED;
  }
  // number → 객체화 (monthlyPrice 로 보존, enabled:true)
  if (typeof existing === 'number') {
    return {
      enabled: true,
      monthlyPrice: existing,
      yearlyPrice: 0,
      grantedAt: null,
      note: 'migrated from number form',
    };
  }
  // 이미 객체 — 누락된 키만 채움
  if (typeof existing === 'object') {
    const patch = { ...existing };
    let changed = false;
    for (const k of Object.keys(EMPTY_GRANDFATHERED)) {
      if (!(k in patch)) {
        patch[k] = EMPTY_GRANDFATHERED[k];
        changed = true;
      }
    }
    return changed ? patch : null; // null = 변경 없음
  }
  // 그 외 (문자열 등) — 안전하게 빈 객체로 리셋하지 않고 건드리지 않음
  return null;
}

function buildPatch(data) {
  const patch = {};
  for (const [k, v] of Object.entries(NEW_FIELDS_DEFAULTS)) {
    if (!(k in data)) patch[k] = v;
  }
  const gp = buildGrandfatheredPatch(data.grandfatheredPrice);
  if (gp !== null) patch.grandfatheredPrice = gp;
  return patch;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== extend-academies-schema ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('academies').get();
  let toUpdate = 0;
  let alreadyOk = 0;
  const updates = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const patch = buildPatch(data);
    if (Object.keys(patch).length === 0) {
      alreadyOk++;
      console.log(`• ${doc.id.padEnd(16)}  alreadyOk`);
      continue;
    }
    toUpdate++;
    const keys = Object.keys(patch).join(', ');
    console.log(`• ${doc.id.padEnd(16)}  add: ${keys}`);
    updates.push({ ref: doc.ref, patch });
  }

  if (apply && toUpdate > 0) {
    let batch = db.batch();
    let n = 0;
    for (const { ref, patch } of updates) {
      batch.set(ref, patch, { merge: true });
      n++;
      if (n >= 450) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) await batch.commit();
  }

  console.log(`\n─── 요약 ───`);
  console.log(`전체:        ${snap.size}`);
  console.log(`업데이트:    ${toUpdate}`);
  console.log(`이미 처리됨: ${alreadyOk}`);

  if (!apply) {
    console.log(`\n(DRY-RUN) 실제로 쓰려면 --apply 추가.`);
    console.log(`           Firestore Export 백업 권장.\n`);
  } else {
    console.log(`\n✅ 마이그레이션 완료.\n`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('\n[error]', err);
  process.exit(1);
});
