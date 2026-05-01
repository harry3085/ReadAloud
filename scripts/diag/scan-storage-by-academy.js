// 진단: Firebase Storage 학원별 점유량 측정.
//
// 경로 구조:
//   - hwFiles/{ts}_{filename}                              → Firestore hwFiles 컬렉션 academyId 매핑
//   - recordings/genTests/{testId}/{uid}/...               → genTests/{testId}.academyId 매핑
//   - 그 외 → unknown
//
// 사용:
//   node scripts/diag/scan-storage-by-academy.js          # 출력만 (read-only)
//   node scripts/diag/scan-storage-by-academy.js --apply  # academies/{id}.usage.storageBytes 갱신 (수동 reconcile)
//
// 출력:
//   - 학원별 파일 수 / 합계 size / 카테고리별 (hwFiles / recordings) 분리
//   - 미매핑 (unknown) 파일도 별도 합산
//   - --apply 시 학원 doc 의 usage.storageBytes 와 storageReconciledAt 갱신

const { getDb, getAdmin } = require('../lib/firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const { FieldValue } = require('firebase-admin/firestore');

const BUCKET = 'readaloud-51113.firebasestorage.app';

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(3)} GB`;
}

(async () => {
  const apply = process.argv.includes('--apply');
  getAdmin();
  const db = getDb();
  const bucket = getStorage().bucket(BUCKET);

  console.log(`\n=== Firebase Storage 학원별 점유량 ${apply ? '(APPLY — Firestore 갱신)' : '(read-only)'} ===\n`);
  console.log(`bucket: ${BUCKET}`);
  console.log('스캔 중... (큰 버킷은 1~2분 소요)\n');

  // 1. genTests 모두 메모리 캐시 (testId → academyId)
  const genTestsSnap = await db.collection('genTests').get();
  const testToAcademy = {};
  genTestsSnap.docs.forEach(d => {
    const data = d.data();
    if (data.academyId) testToAcademy[d.id] = data.academyId;
  });
  console.log(`genTests ${genTestsSnap.size}건 캐시 완료`);

  // 2. hwFiles 모두 메모리 캐시 (storagePath → academyId)
  const hwFilesSnap = await db.collection('hwFiles').get();
  const hwPathToAcademy = {};
  hwFilesSnap.docs.forEach(d => {
    const data = d.data();
    if (data.storagePath && data.academyId) hwPathToAcademy[data.storagePath] = data.academyId;
  });
  console.log(`hwFiles ${hwFilesSnap.size}건 캐시 완료\n`);

  // 3. Storage 전체 스캔
  const stats = {};   // academyId → { hwFiles: { count, bytes }, recordings: { count, bytes }, total: { count, bytes } }
  const unknown = { count: 0, bytes: 0, samples: [] };
  let totalCount = 0;
  let totalBytes = 0;

  const ensure = (aid) => {
    if (!stats[aid]) stats[aid] = {
      hwFiles: { count: 0, bytes: 0 },
      recordings: { count: 0, bytes: 0 },
      total: { count: 0, bytes: 0 },
    };
    return stats[aid];
  };

  let pageToken = null;
  do {
    const [files, , metadata] = await bucket.getFiles({
      maxResults: 1000,
      pageToken,
    });
    for (const f of files) {
      const size = parseInt(f.metadata.size || 0, 10);
      totalCount++;
      totalBytes += size;
      const name = f.name;

      let academyId = null;
      let category = null;

      if (name.startsWith('hwFiles/')) {
        category = 'hwFiles';
        academyId = hwPathToAcademy[name] || null;
      } else if (name.startsWith('recordings/genTests/')) {
        category = 'recordings';
        // recordings/genTests/{testId}/{uid}/...
        const parts = name.split('/');
        const testId = parts[2];
        academyId = testToAcademy[testId] || null;
      }

      if (academyId) {
        const s = ensure(academyId);
        s[category].count++;
        s[category].bytes += size;
        s.total.count++;
        s.total.bytes += size;
      } else {
        unknown.count++;
        unknown.bytes += size;
        if (unknown.samples.length < 5) unknown.samples.push(name);
      }
    }
    pageToken = metadata?.pageToken || null;
    if (totalCount % 5000 === 0 && totalCount > 0) console.log(`  ...스캔 ${totalCount}개`);
  } while (pageToken);

  console.log(`\n전체 파일 ${totalCount.toLocaleString()}개 / ${fmtBytes(totalBytes)}\n`);

  // 4. 학원 정보 + 한도 매핑
  const acadSnap = await db.collection('academies').get();
  const planSnap = await db.collection('plans').get();
  const plans = {};
  planSnap.docs.forEach(d => plans[d.id] = d.data());

  const acads = {};
  acadSnap.docs.forEach(d => {
    const data = d.data();
    const plan = plans[data.planId] || {};
    const tier = String(data.studentLimit || 30);
    const byTier = plan.byTier || {};
    const tl = byTier[tier] || byTier['30'] || byTier[Object.keys(byTier)[0]] || {};
    const cl = data.customLimits || {};
    acads[d.id] = {
      name: data.name || d.id,
      planId: data.planId,
      storageLimitGB: cl.storageGB ?? tl.storageGB ?? null,
    };
  });

  // 5. 학원별 출력 (점유량 큰 순)
  const sorted = Object.entries(stats).sort((a, b) => b[1].total.bytes - a[1].total.bytes);

  console.log('=== 학원별 점유량 ===\n');
  console.log(' '.repeat(20) + '   파일수    합계         hwFiles                recordings              한도(GB)    %');
  console.log('-'.repeat(120));
  for (const [aid, s] of sorted) {
    const info = acads[aid] || { name: aid, planId: '?', storageLimitGB: null };
    const lim = info.storageLimitGB;
    const usedGB = s.total.bytes / 1024 / 1024 / 1024;
    const pct = lim ? ((usedGB / lim) * 100).toFixed(1) + '%' : '-';
    const limStr = lim ? `${lim} GB` : '-';
    console.log(
      `  ${(info.name + ' (' + info.planId + ')').padEnd(28)} ` +
      `${String(s.total.count).padStart(5)}   ${fmtBytes(s.total.bytes).padStart(10)}    ` +
      `[hw  ${String(s.hwFiles.count).padStart(4)} / ${fmtBytes(s.hwFiles.bytes).padStart(9)}]   ` +
      `[rec ${String(s.recordings.count).padStart(4)} / ${fmtBytes(s.recordings.bytes).padStart(9)}]   ` +
      `${limStr.padStart(8)}   ${pct.padStart(6)}`
    );
  }

  // 학원 매핑 안 된 파일들
  if (unknown.count > 0) {
    console.log(`\n⚠ 매핑되지 않은 파일: ${unknown.count}개 / ${fmtBytes(unknown.bytes)}`);
    unknown.samples.forEach(n => console.log(`    - ${n}`));
    if (unknown.count > 5) console.log(`    ... 외 ${unknown.count - 5}개`);
  }

  // 학원 doc 은 있는데 Storage 사용 0 인 학원
  const usedAcademies = new Set(Object.keys(stats));
  const idle = Object.keys(acads).filter(aid => !usedAcademies.has(aid));
  if (idle.length > 0) {
    console.log(`\nStorage 사용 없는 학원: ${idle.length}곳`);
    idle.forEach(aid => console.log(`    - ${acads[aid].name} (${aid})`));
  }

  // Firestore 반영 (--apply)
  if (apply) {
    console.log('\n=== Firestore 갱신 ===');
    const updates = [];
    // 사용 있는 학원
    for (const [aid, s] of Object.entries(stats)) {
      updates.push({ aid, bytes: s.total.bytes });
    }
    // 사용 없는 학원도 0 으로 명시 (필드 누락 방지)
    for (const aid of idle) {
      updates.push({ aid, bytes: 0 });
    }
    for (const u of updates) {
      try {
        await db.doc(`academies/${u.aid}`).update({
          'usage.storageBytes': u.bytes,
          'usage.storageReconciledAt': FieldValue.serverTimestamp(),
        });
        console.log(`  ✓ ${u.aid}: storageBytes = ${u.bytes.toLocaleString()} (${fmtBytes(u.bytes)})`);
      } catch (e) {
        console.log(`  ✗ ${u.aid}: ${e.message}`);
      }
    }
    console.log(`\n✅ ${updates.length}개 학원 갱신 완료`);
  } else {
    console.log('\n(read-only — --apply 로 academies.usage.storageBytes 갱신)');
  }

  console.log('');
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
