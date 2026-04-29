// users.fcmToken (string) → users.fcmTokens (array) 마이그레이션.
//
// 멀티 디바이스 지원 도입을 위해 단일 string 필드를 배열로 변환.
// 기존 fcmToken 필드는 그대로 유지 (transition 기간 호환). 안정 후 별도 정리 가능.
//
// 동작:
//   - fcmToken 이 string 이고 fcmTokens 가 없으면: fcmTokens = [fcmToken]
//   - 둘 다 있으면 fcmTokens 에 fcmToken 이 포함되어 있는지 확인하고 누락 시 추가
//   - 둘 다 없으면 skip
//
// 사용:
//   node scripts/migrate/fcm-tokens-to-array.js          # DRY-RUN
//   node scripts/migrate/fcm-tokens-to-array.js --apply  # 적용

const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

(async () => {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== fcm-tokens-to-array ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('users').get();
  let total = snap.size, withToken = 0, alreadyArray = 0, migrated = 0, augmented = 0, skipped = 0;

  for (const d of snap.docs) {
    const data = d.data();
    const t = data.fcmToken;
    const arr = data.fcmTokens;

    if (typeof t !== 'string' || !t) {
      if (Array.isArray(arr) && arr.length > 0) alreadyArray++;
      else skipped++;
      continue;
    }
    withToken++;

    if (Array.isArray(arr)) {
      if (arr.includes(t)) {
        alreadyArray++;
      } else {
        // string 이 array 에 누락된 경우 — 추가
        if (apply) {
          await d.ref.update({ fcmTokens: FieldValue.arrayUnion(t) });
        }
        augmented++;
        console.log(`  + augment: ${d.id.slice(0,8)}... (기존 array 에 fcmToken 추가)`);
      }
    } else {
      // 새로 array 생성
      if (apply) {
        await d.ref.update({ fcmTokens: [t] });
      }
      migrated++;
    }
  }

  console.log(`\nusers 총 ${total}`);
  console.log(`  ✓ 이미 array 보유: ${alreadyArray}`);
  console.log(`  → 신규 변환 (string → [string]): ${migrated}`);
  console.log(`  → 누락분 추가 (array 에 string 합침): ${augmented}`);
  console.log(`  · skip (토큰 없음): ${skipped}`);

  console.log(`\n${apply ? '✅ 적용 완료' : '(DRY-RUN — --apply 추가)'}\n`);
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
