// super_admin 전용 — 학원 정보 변경 (name/planId/studentLimit/billingStatus/grandfatheredPrice)
// POST body: { idToken, academyId, fields: {...} }

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

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

const ALLOWED = new Set(['name', 'planId', 'studentLimit', 'billingStatus', 'grandfatheredPrice']);

module.exports = async function (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });
  try {
    ensureApp();
    const auth = getAuth();
    const db = getFirestore();

    const { idToken, academyId, fields } = req.body || {};
    if (!idToken) return res.status(401).json({ success: false, error: '토큰 필요' });
    if (!academyId) return res.status(400).json({ success: false, error: 'academyId 필요' });
    if (!fields || typeof fields !== 'object') return res.status(400).json({ success: false, error: 'fields 객체 필요' });

    let caller;
    try { caller = await auth.verifyIdToken(idToken); }
    catch (e) { return res.status(401).json({ success: false, error: '유효하지 않은 토큰' }); }
    if (caller.role !== 'super_admin') return res.status(403).json({ success: false, error: 'super_admin 만 가능' });

    // plan 변경 시 plans/{id} 존재 확인
    if (fields.planId) {
      const ps = await db.doc('plans/' + fields.planId).get();
      if (!ps.exists) return res.status(400).json({ success: false, error: '존재하지 않는 plan: ' + fields.planId });
    }

    const update = {};
    for (const k of Object.keys(fields)) {
      if (!ALLOWED.has(k)) continue;
      let v = fields[k];
      if (k === 'studentLimit') v = parseInt(v) || 30;
      if (k === 'grandfatheredPrice') v = (v === null || v === '') ? null : Number(v);
      update[k] = v;
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ success: false, error: '변경할 필드 없음' });

    update.updatedAt = FieldValue.serverTimestamp();
    await db.doc('academies/' + academyId).update(update);

    return res.status(200).json({ success: true, updated: Object.keys(update) });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, code: e.code });
  }
};
