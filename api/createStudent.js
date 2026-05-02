// Vercel Serverless Function — 학생 계정 생성 (Auth + Firestore + usernameLookup 트랜잭션적 처리)
//
// 클라이언트 이중 쓰기(Auth create → Firestore setDoc)는 실패 시 orphan 을 만들기 쉬워,
// 서버에서 Admin SDK 로 원자적으로 처리. 실패 시 이미 생성된 Auth 도 롤백.
//
// 요청 body:
//   {
//     idToken: string,              // 관리자 ID 토큰 (Authorization 헤더 대신 body 에서 받음)
//     username: string,
//     password: string,
//     name: string,
//     group?: string,
//     birth?, school?, grade?, phone?, parentName?, parentPhone?  (모두 옵션)
//   }
//
// 응답:
//   성공: { success: true, uid, email }
//   실패: { success: false, error, code? }

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const DEFAULT_ACADEMY_ID = 'default';
const EMAIL_DOMAIN = '@kunsori.app';

function normalizePrivateKey(raw) {
  if (!raw) return '';
  let k = String(raw);
  // 앞뒤 공백 제거
  k = k.trim();
  // 전체를 감싸는 따옴표 제거 (Vercel 붙여넣기 실수 방지)
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  // CRLF → LF
  k = k.replace(/\r\n/g, '\n');
  // 리터럴 \n 을 실제 개행으로 변환 (단일행 저장된 경우)
  k = k.replace(/\\n/g, '\n');
  return k;
}

function initAdmin() {
  if (getApps().length > 0) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      `Vercel env vars missing — PROJECT_ID=${!!projectId}, CLIENT_EMAIL=${!!clientEmail}, PRIVATE_KEY=${!!privateKey}.`
    );
  }
  // PEM 형식 최소 검증
  if (!privateKey.startsWith('-----BEGIN') || !privateKey.includes('-----END')) {
    throw new Error(
      `FIREBASE_PRIVATE_KEY 형식 오류 — BEGIN/END 블록이 누락되거나 깨졌습니다. ` +
      `길이=${privateKey.length}, 첫20자='${privateKey.slice(0, 20)}'. ` +
      `Vercel 대시보드에서 -----BEGIN PRIVATE KEY----- 부터 -----END PRIVATE KEY----- 까지 전체를 그대로 붙여넣고 Redeploy 하세요.`
    );
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    initAdmin();
    const auth = getAuth();
    const db = getFirestore();

    const body = req.body || {};
    const idToken = String(body.idToken || '').trim();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();
    const group = String(body.group || '').trim();

    // 1. 관리자 ID 토큰 검증
    if (!idToken) return res.status(401).json({ success: false, error: '인증 토큰이 필요합니다.' });
    let caller;
    try {
      caller = await auth.verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ success: false, error: '유효하지 않은 인증 토큰입니다.', code: e.code });
    }

    // 관리자 권한 확인 (Custom Claims 또는 Firestore users.role=='admin' 폴백)
    const claimsRole = caller.role;
    let isAdminUser = (claimsRole === 'academy_admin' || claimsRole === 'super_admin');
    let callerAcademyId = caller.academyId || null;
    let callerDocCache = null;
    if (!isAdminUser) {
      try {
        const cs = await db.doc('users/' + caller.uid).get();
        callerDocCache = cs.exists ? cs.data() : null;
        if (callerDocCache && callerDocCache.role === 'admin') isAdminUser = true;
      } catch (_) {}
    }
    if (!isAdminUser) {
      return res.status(403).json({ success: false, error: '관리자 권한이 필요합니다.' });
    }
    // 호출자 academyId 결정 — Custom Claims 우선, users 문서 폴백, 'default' 최종
    if (!callerAcademyId) {
      try {
        if (!callerDocCache) {
          const cs = await db.doc('users/' + caller.uid).get();
          callerDocCache = cs.exists ? cs.data() : null;
        }
        callerAcademyId = (callerDocCache && callerDocCache.academyId) || null;
      } catch (_) {}
    }
    if (!callerAcademyId) callerAcademyId = DEFAULT_ACADEMY_ID;

    // 학생 한도 체크 — customLimits.maxStudents > plan.byTier[tier].maxStudents > academy.studentLimit > Infinity
    // race 방지: Firestore 트랜잭션으로 read + 예약 increment 묶음.
    // Auth 생성 후 실패 시 별도 -1 롤백.
    let _studentCounterReserved = false;
    const _acadRef = db.doc('academies/' + callerAcademyId);
    try {
      await db.runTransaction(async (tx) => {
        const acadSnap = await tx.get(_acadRef);
        if (!acadSnap.exists) return;
        const ad = acadSnap.data();
        const cur = (ad.usage && ad.usage.activeStudentsCount) || 0;
        // 효과적 한도 계산
        const cl = ad.customLimits || {};
        const planId = ad.planId;
        let planTierMax = null;
        if (planId) {
          const planSnap = await tx.get(db.doc('plans/' + planId));
          if (planSnap.exists) {
            const plan = planSnap.data();
            const tier = String(ad.studentLimit || 30);
            const byTier = plan.byTier || {};
            const tierLimits = byTier[tier] || byTier['30'] || byTier[Object.keys(byTier)[0]] || {};
            planTierMax = tierLimits.maxStudents ?? null;
          }
        }
        const effectiveLimit = cl.maxStudents ?? planTierMax ?? ad.studentLimit ?? Infinity;
        if (cur >= effectiveLimit) {
          const err = new Error(`학생 수 한도 초과 (${cur}/${effectiveLimit}).`);
          err.statusCode = 429;
          err.limit = effectiveLimit;
          err.currentCount = cur;
          throw err;
        }
        // 한도 통과 — 예약 increment (race 방지)
        tx.update(_acadRef, { 'usage.activeStudentsCount': FieldValue.increment(1) });
        _studentCounterReserved = true;
      });
    } catch (e) {
      if (e.statusCode === 429) {
        return res.status(429).json({
          success: false,
          error: e.message + ' 플랜 업그레이드 또는 학생 한도 증설 필요.',
          limit: e.limit, currentCount: e.currentCount,
        });
      }
      console.warn('[createStudent] 한도 체크 트랜잭션 실패:', e.message);
      // 트랜잭션 자체 실패 — 보수적으로 진행 (예약 안 됐으면 후단에서 +1 처리)
    }

    // 2. 입력 검증
    if (!username || !name || !password) {
      return res.status(400).json({ success: false, error: '아이디, 이름, 비밀번호는 필수입니다.' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ success: false, error: '아이디는 영문/숫자/언더스코어만 가능합니다.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: '비밀번호는 6자 이상이어야 합니다.' });
    }

    const usernameLower = username.toLowerCase();
    const email = username + EMAIL_DOMAIN;
    const lookupKey = usernameLower; // 글로벌 유니크 (학원 prefix 없음)

    // 3. username 중복 체크 (usernameLookup 기반)
    const lookupSnap = await db.doc('usernameLookup/' + lookupKey).get();
    if (lookupSnap.exists) {
      // 예약 카운터 롤백
      if (_studentCounterReserved) {
        try { await _acadRef.update({ 'usage.activeStudentsCount': FieldValue.increment(-1) }); } catch (_) {}
      }
      return res.status(409).json({ success: false, error: '이미 사용 중인 아이디입니다.' });
    }

    // 4. Auth 계정 생성
    let userRecord;
    try {
      userRecord = await auth.createUser({ email, password, displayName: name });
    } catch (e) {
      // 예약 카운터 롤백
      if (_studentCounterReserved) {
        try { await _acadRef.update({ 'usage.activeStudentsCount': FieldValue.increment(-1) }); } catch (_) {}
      }
      if (e.code === 'auth/email-already-exists' || e.code === 'auth/email-already-in-use') {
        return res.status(409).json({
          success: false,
          error: '이 아이디로 이미 가입된 Auth 계정이 남아있습니다. 관리자에게 cleanup 요청하세요.',
          code: e.code,
        });
      }
      return res.status(500).json({ success: false, error: e.message, code: e.code });
    }

    const uid = userRecord.uid;

    // 5. Custom Claims 주입
    try {
      await auth.setCustomUserClaims(uid, {
        academyId: callerAcademyId,
        role: 'student',
      });
    } catch (e) {
      // Claims 실패는 치명적 아님. 로그만.
      console.warn('[createStudent] setCustomUserClaims 실패:', e.message);
    }

    // 6. Firestore 쓰기 (users + usernameLookup 를 batch 로 묶음)
    try {
      const batch = db.batch();
      batch.set(db.doc('users/' + uid), {
        academyId: callerAcademyId,
        username,
        name,
        email,
        group,
        role: 'student',
        status: 'active',
        birth: String(body.birth || ''),
        school: String(body.school || ''),
        grade: String(body.grade || ''),
        phone: String(body.phone || ''),
        parentName: String(body.parentName || ''),
        parentPhone: String(body.parentPhone || ''),
        createdAt: FieldValue.serverTimestamp(),
      });
      batch.set(db.doc('usernameLookup/' + lookupKey), {
        academyId: callerAcademyId,
        usernameLower,
        uid,
        email,
        role: 'student',
        createdAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();

      // 학생 카운터 +1 (트랜잭션에서 이미 예약됐으면 skip)
      if (!_studentCounterReserved) {
        try {
          await _acadRef.update({
            'usage.activeStudentsCount': FieldValue.increment(1),
          });
        } catch (e) { console.warn('[createStudent] activeStudentsCount 증가 실패:', e.message); }
      }
    } catch (e) {
      // Firestore 실패 — Auth 롤백 + 예약 카운터 롤백
      try { await auth.deleteUser(uid); } catch (_) {}
      if (_studentCounterReserved) {
        try { await _acadRef.update({ 'usage.activeStudentsCount': FieldValue.increment(-1) }); } catch (_) {}
      }
      return res.status(500).json({
        success: false,
        error: 'Firestore 쓰기 실패. Auth 계정은 롤백됐습니다.',
        detail: e.message,
        code: e.code,
      });
    }

    return res.status(200).json({ success: true, uid, email });
  } catch (err) {
    console.error('[createStudent] unexpected:', err);
    return res.status(500).json({ success: false, error: err.message, code: err.code });
  }
};
