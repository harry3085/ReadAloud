// super_admin 전용 — 5개 action 통합 단일 함수 (Vercel Hobby 12개 한도 우회).
// POST body: { idToken, action, ...payload }
//   action: 'updateAcademy' | 'updateAcademyAdmin' | 'getAcademyImpact' | 'deleteAcademy' | 'reconcileStorage'

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

function ensureApp() {
  if (getApps().length) return getApps()[0];
  let pk = process.env.FIREBASE_PRIVATE_KEY || '';
  pk = pk.replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: pk,
    }),
  });
}

const ACADEMY_COLLECTIONS = [
  'notices', 'scores', 'payments', 'hwFiles', 'groups',
  'genTests', 'genQuestionSets', 'genBooks', 'genChapters', 'genPages',
  'pushNotifications', 'userNotifications', 'genCleanupPresets', 'apiUsage',
];

const UPDATE_ACADEMY_ALLOWED = new Set([
  'name', 'planId', 'studentLimit', 'billingStatus',
  'grandfatheredPrice', 'customLimits',
  // SuperAdmin Phase A (T1) 신규
  'planExpiresAt', 'acquisitionChannel', 'internalMemo', 'featureFlags', 'contactLog',
]);

async function _verifySuperAdmin(auth, idToken) {
  if (!idToken) return { error: '토큰 필요', status: 401 };
  let caller;
  try { caller = await auth.verifyIdToken(idToken); }
  catch (e) { return { error: '유효하지 않은 토큰', status: 401 }; }
  if (caller.role !== 'super_admin') return { error: 'super_admin 만 가능', status: 403 };
  return { caller };
}

// ── action: updateAcademy ─────────────────────────────
async function _updateAcademy(db, body) {
  const { academyId, fields } = body;
  if (!academyId) return { status: 400, body: { success: false, error: 'academyId 필요' } };
  if (!fields || typeof fields !== 'object') return { status: 400, body: { success: false, error: 'fields 객체 필요' } };
  if (fields.planId) {
    const ps = await db.doc('plans/' + fields.planId).get();
    if (!ps.exists) return { status: 400, body: { success: false, error: '존재하지 않는 plan: ' + fields.planId } };
  }
  const update = {};
  for (const k of Object.keys(fields)) {
    if (!UPDATE_ACADEMY_ALLOWED.has(k)) continue;
    let v = fields[k];
    if (k === 'studentLimit') v = parseInt(v) || 30;
    if (k === 'grandfatheredPrice') {
      // 객체 형태로만 허용 — { enabled, monthlyPrice, yearlyPrice, grantedAt, note }
      if (v && typeof v === 'object') {
        const monthly = Number(v.monthlyPrice) > 0 ? Number(v.monthlyPrice) : 0;
        const yearly  = Number(v.yearlyPrice)  > 0 ? Number(v.yearlyPrice)  : 0;
        const enabled = !!v.enabled && (monthly > 0 || yearly > 0);
        v = {
          enabled,
          monthlyPrice: monthly,
          yearlyPrice: yearly,
          grantedAt: enabled ? FieldValue.serverTimestamp() : null,
          note: typeof v.note === 'string' ? v.note : '',
        };
      } else {
        v = { enabled: false, monthlyPrice: 0, yearlyPrice: 0, grantedAt: null, note: '' };
      }
    }
    if (k === 'customLimits' && v && typeof v === 'object') {
      // 숫자만 받고 0/빈값은 필드 제거 (plan 기본 사용)
      const cl = {};
      for (const ck of ['aiQuotaPerMonth', 'recordingPerMonth']) {
        const cv = parseInt(v[ck]);
        if (!isNaN(cv) && cv > 0) cl[ck] = cv;
      }
      v = Object.keys(cl).length > 0 ? cl : null;  // null 이면 override 해제
    }
    if (k === 'featureFlags' && v && typeof v === 'object') {
      // boolean 만 허용
      const ff = {};
      for (const fk of Object.keys(v)) ff[fk] = !!v[fk];
      v = ff;
    }
    if (k === 'contactLog') {
      if (!Array.isArray(v)) continue;
      // 항목의 at(ISO 문자열) → Date 로 정규화
      v = v.map(entry => {
        const e = entry && typeof entry === 'object' ? { ...entry } : {};
        if (typeof e.at === 'string') {
          const d = new Date(e.at);
          if (!isNaN(d.getTime())) e.at = d;
        }
        // type 화이트리스트
        if (!['call', 'email', 'kakao', 'meeting'].includes(e.type)) e.type = 'call';
        e.summary = String(e.summary || '');
        e.nextAction = String(e.nextAction || '');
        return e;
      });
    }
    if (k === 'planExpiresAt') {
      if (v === null || v === '') {
        v = null;
      } else if (typeof v === 'string') {
        const d = new Date(v);
        v = isNaN(d.getTime()) ? null : d;
      }
    }
    if ((k === 'acquisitionChannel' || k === 'internalMemo') && typeof v !== 'string') {
      v = String(v || '');
    }
    update[k] = v;
  }
  if (Object.keys(update).length === 0) return { status: 400, body: { success: false, error: '변경할 필드 없음' } };
  update.updatedAt = FieldValue.serverTimestamp();
  await db.doc('academies/' + academyId).update(update);
  return { status: 200, body: { success: true, updated: Object.keys(update) } };
}

// ── action: updateAcademyAdmin ────────────────────────
async function _updateAcademyAdmin(auth, db, body) {
  const { uid, fields } = body;
  if (!uid) return { status: 400, body: { success: false, error: 'uid 필요' } };
  const f = fields || {};
  const newName = f.name && String(f.name).trim();
  const newEmail = f.email && String(f.email).trim().toLowerCase();
  const newUsername = f.username && String(f.username).trim().toLowerCase();
  const newPassword = f.password && String(f.password);

  const userSnap = await db.doc('users/' + uid).get();
  if (!userSnap.exists) return { status: 404, body: { success: false, error: '대상 사용자 없음' } };
  const oldUser = userSnap.data();

  if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return { status: 400, body: { success: false, error: '유효하지 않은 이메일' } };
  if (newUsername && !/^[a-z0-9_]+$/.test(newUsername)) return { status: 400, body: { success: false, error: 'username 은 영소문자/숫자/_ 만' } };
  if (newPassword && newPassword.length < 6) return { status: 400, body: { success: false, error: '비밀번호 6자 이상' } };

  if (newUsername && newUsername !== (oldUser.username || '').toLowerCase()) {
    const dup = await db.doc('usernameLookup/' + newUsername).get();
    if (dup.exists) return { status: 409, body: { success: false, error: '이미 사용 중인 username' } };
  }
  if (newEmail && newEmail !== (oldUser.email || '').toLowerCase()) {
    try {
      const existing = await auth.getUserByEmail(newEmail);
      if (existing && existing.uid !== uid) return { status: 409, body: { success: false, error: '이미 가입된 이메일' } };
    } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  }

  const authUpdate = {};
  if (newName) authUpdate.displayName = newName;
  if (newEmail) authUpdate.email = newEmail;
  if (newPassword) authUpdate.password = newPassword;
  if (Object.keys(authUpdate).length > 0) await auth.updateUser(uid, authUpdate);

  const userUpdate = { updatedAt: FieldValue.serverTimestamp() };
  if (newName) userUpdate.name = newName;
  if (newEmail) userUpdate.email = newEmail;
  if (newUsername) userUpdate.username = newUsername;

  const oldUsernameLower = (oldUser.username || '').toLowerCase();
  const usernameChanged = newUsername && newUsername !== oldUsernameLower;

  const batch = db.batch();
  batch.update(db.doc('users/' + uid), userUpdate);
  if (usernameChanged) {
    batch.set(db.doc('usernameLookup/' + newUsername), {
      academyId: oldUser.academyId || null,
      usernameLower: newUsername,
      uid,
      email: newEmail || oldUser.email,
      role: oldUser.role === 'admin' ? 'academy_admin' : (oldUser.role || 'student'),
      createdAt: FieldValue.serverTimestamp(),
    });
    if (oldUsernameLower) batch.delete(db.doc('usernameLookup/' + oldUsernameLower));
  } else if (newEmail) {
    if (oldUsernameLower) batch.update(db.doc('usernameLookup/' + oldUsernameLower), { email: newEmail });
  }
  await batch.commit();

  return { status: 200, body: {
    success: true,
    updated: { name: !!newName, email: !!newEmail, username: !!newUsername, password: !!newPassword },
  } };
}

// ── action: getAcademyImpact ──────────────────────────
async function _getAcademyImpact(db, body) {
  const { academyId } = body;
  if (!academyId) return { status: 400, body: { success: false, error: 'academyId 필요' } };
  const acadSnap = await db.doc('academies/' + academyId).get();
  if (!acadSnap.exists) return { status: 404, body: { success: false, error: '학원 없음' } };

  const counts = {};
  const usersSnap = await db.collection('users').where('academyId', '==', academyId).get();
  let adminCnt = 0, studentCnt = 0;
  usersSnap.forEach(d => {
    const r = d.data().role;
    if (r === 'admin' || r === 'academy_admin') adminCnt++;
    else if (r === 'student') studentCnt++;
  });
  counts.users = { admin: adminCnt, student: studentCnt, total: usersSnap.size };

  for (const col of ACADEMY_COLLECTIONS) {
    if (col === 'apiUsage') continue;  // 따로 처리
    try {
      const agg = await db.collection(col).where('academyId', '==', academyId).count().get();
      counts[col] = agg.data().count;
    } catch (e) { counts[col] = -1; }
  }
  try {
    const agg = await db.collection('apiUsage').where('academyId', '==', academyId).count().get();
    counts.apiUsage = agg.data().count;
  } catch (e) { counts.apiUsage = -1; }

  return { status: 200, body: { success: true, academyId, academyName: acadSnap.data().name, counts } };
}

// ── action: deleteAcademy ─────────────────────────────
async function _deleteAllByAcademy(db, col, academyId) {
  let total = 0;
  while (true) {
    const snap = await db.collection(col).where('academyId', '==', academyId).limit(450).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    if (snap.size < 450) break;
  }
  return total;
}

async function _deleteAcademy(auth, db, body) {
  const { academyId, confirmSubdomain } = body;
  if (!academyId) return { status: 400, body: { success: false, error: 'academyId 필요' } };
  if (!confirmSubdomain) return { status: 400, body: { success: false, error: 'confirmSubdomain 필요' } };

  const acadRef = db.doc('academies/' + academyId);
  const acadSnap = await acadRef.get();
  if (!acadSnap.exists) return { status: 404, body: { success: false, error: '학원 없음' } };
  const academy = acadSnap.data();
  const expectedSubdomain = academy.subdomain || academyId;
  if (String(confirmSubdomain).trim() !== expectedSubdomain) {
    return { status: 400, body: { success: false, error: 'subdomain 불일치 — 정확히 입력하세요' } };
  }

  const deleted = {};

  // genTests/userCompleted
  const genTestsSnap = await db.collection('genTests').where('academyId', '==', academyId).get();
  let ucCount = 0;
  for (const t of genTestsSnap.docs) {
    const ucSnap = await t.ref.collection('userCompleted').get();
    if (!ucSnap.empty) {
      let batch = db.batch();
      let n = 0;
      for (const u of ucSnap.docs) {
        batch.delete(u.ref);
        n++;
        if (n >= 450) { await batch.commit(); batch = db.batch(); n = 0; }
      }
      if (n > 0) await batch.commit();
      ucCount += ucSnap.size;
    }
  }
  deleted['genTests_userCompleted'] = ucCount;

  // users — Auth + Firestore + usernameLookup
  const usersSnap = await db.collection('users').where('academyId', '==', academyId).get();
  let authDeleted = 0, authErrors = 0, lookupDeleted = 0;
  for (const u of usersSnap.docs) {
    const uid = u.id;
    const data = u.data();
    try {
      await auth.deleteUser(uid);
      authDeleted++;
    } catch (e) {
      if (e.code !== 'auth/user-not-found') authErrors++;
    }
    if (data.username) {
      try {
        const lookupRef = db.doc('usernameLookup/' + data.username.toLowerCase());
        const ls = await lookupRef.get();
        if (ls.exists && ls.data().uid === uid) {
          await lookupRef.delete();
          lookupDeleted++;
        }
      } catch (_) {}
    }
    await u.ref.delete();
  }
  deleted.users = usersSnap.size;
  deleted.authDeleted = authDeleted;
  deleted.authErrors = authErrors;
  deleted.usernameLookup = lookupDeleted;

  for (const col of ACADEMY_COLLECTIONS) {
    try { deleted[col] = await _deleteAllByAcademy(db, col, academyId); }
    catch (e) { deleted[col + '_error'] = e.message; }
  }

  await acadRef.delete();
  deleted.academy = 1;

  return { status: 200, body: { success: true, academyId, academyName: academy.name, deleted } };
}

// ── action: reconcileStorage ──────────────────────────
// Firebase Storage 전체 스캔 → 학원별 점유량 합산 → academies.usage.storageBytes 갱신.
// scripts/diag/scan-storage-by-academy.js --apply 와 동일 로직 (서버 버전).
// hook 미구현 단계의 수동 reconcile 도구.
async function _reconcileStorage(db, body) {
  const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'readaloud-51113.firebasestorage.app';
  const bucket = getStorage().bucket(STORAGE_BUCKET);

  // 1) 매핑 캐시
  const genTestsSnap = await db.collection('genTests').get();
  const testToAcademy = {};
  genTestsSnap.docs.forEach(d => {
    const data = d.data();
    if (data.academyId) testToAcademy[d.id] = data.academyId;
  });
  const hwFilesSnap = await db.collection('hwFiles').get();
  const hwPathToAcademy = {};
  hwFilesSnap.docs.forEach(d => {
    const data = d.data();
    if (data.storagePath && data.academyId) hwPathToAcademy[data.storagePath] = data.academyId;
  });

  // 2) Storage 스캔 + 학원별 합산
  const stats = {};   // academyId → bytes
  let totalCount = 0, totalBytes = 0, unknownCount = 0, unknownBytes = 0;

  let pageToken = null;
  do {
    const [files, , metadata] = await bucket.getFiles({ maxResults: 1000, pageToken });
    for (const f of files) {
      const size = parseInt(f.metadata.size || 0, 10);
      totalCount++;
      totalBytes += size;
      const name = f.name;
      let academyId = null;
      if (name.startsWith('hwFiles/')) {
        academyId = hwPathToAcademy[name] || null;
      } else if (name.startsWith('recordings/genTests/')) {
        const testId = name.split('/')[2];
        academyId = testToAcademy[testId] || null;
      }
      if (academyId) {
        stats[academyId] = (stats[academyId] || 0) + size;
      } else {
        unknownCount++;
        unknownBytes += size;
      }
    }
    pageToken = metadata?.pageToken || null;
  } while (pageToken);

  // 3) Firestore 갱신 — 사용 있는 학원 + 사용 없는 학원도 0 으로 명시
  const acadSnap = await db.collection('academies').get();
  const allAcademies = acadSnap.docs.map(d => d.id);
  const updates = [];
  for (const aid of allAcademies) {
    const bytes = stats[aid] || 0;
    updates.push({ aid, bytes });
  }
  for (const u of updates) {
    try {
      await db.doc(`academies/${u.aid}`).update({
        'usage.storageBytes': u.bytes,
        'usage.storageReconciledAt': FieldValue.serverTimestamp(),
      });
    } catch (e) { /* silent */ }
  }

  return {
    status: 200,
    body: {
      success: true,
      totalFiles: totalCount,
      totalBytes,
      academiesUpdated: updates.length,
      perAcademy: stats,
      unknownCount,
      unknownBytes,
    },
  };
}

// ── 진입점 ────────────────────────────────────────────
module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });
  try {
    ensureApp();
    const auth = getAuth();
    const db = getFirestore();
    const body = req.body || {};
    const { idToken, action } = body;

    const v = await _verifySuperAdmin(auth, idToken);
    if (v.error) return res.status(v.status).json({ success: false, error: v.error });

    let result;
    if (action === 'updateAcademy') result = await _updateAcademy(db, body);
    else if (action === 'updateAcademyAdmin') result = await _updateAcademyAdmin(auth, db, body);
    else if (action === 'getAcademyImpact') result = await _getAcademyImpact(db, body);
    else if (action === 'deleteAcademy') result = await _deleteAcademy(auth, db, body);
    else if (action === 'reconcileStorage') result = await _reconcileStorage(db, body);
    else return res.status(400).json({ success: false, error: 'action 미지원: ' + action });

    return res.status(result.status).json(result.body);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, code: e.code });
  }
};
