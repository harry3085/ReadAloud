// ScoreSnap 서버 저장소 — 전용앱(/ss/) 전용 — 학원앱과 코드는 분리돼 있고 같은 서버 데이터(scoresnapSessions)만 쓴다.
// 사용: window._ssStore = createScoreSnapStore({ db, storage, getUid: () => uid, getAid: () => academyId });
import { collection, doc, getDoc, getDocs, updateDoc, deleteDoc, setDoc, query, where, orderBy, serverTimestamp, limit, increment, onSnapshot, deleteField } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, deleteObject, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

export function createScoreSnapStore({ db, storage, getUid, getAid }) {
  // ─── ScoreSnap 서버 저장 — 폰·PC 동기화, 5일 보관 ─────────────────
  // scoresnapSessions/{sid}            세션 메타 (academyId·createdAt·testName·studentCount …) — 목록용으로 가볍게
  // scoresnapSessions/{sid}/key/answerKey   정답지 (academyId + answerKey)
  // scoresnapSessions/{sid}/students/{id}   학생 결과 (academyId·idx·result·imagePath)
  // Storage scoresnap/{academyId}/{sid}/{id}.jpg  답안지 사진 (GCS lifecycle 5일 자동 삭제)
  // 하위 컬렉션 조회는 where('academyId','==',내학원) 정적 제약 필수 (Rules 통과 조건).
  // 5일 지난 세션은 목록을 열 때 정리(최대 5건씩). 이미지는 lifecycle 이 따로 지운다.
  const _SS_KEEP_MS = 5 * 24 * 3600 * 1000;
  const _ssAid = () => getAid();
  const _ssClean = (o) => JSON.parse(JSON.stringify(o ?? null));      // undefined 제거 (Firestore setDoc 거부 방지)
  function _ssB64ToBlob(b64, mime) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime || 'image/jpeg' });
  }

  async function _ssDeleteSessionImpl(sid) {
    const aid = _ssAid();
    const stSnap = await getDocs(query(collection(db, 'scoresnapSessions', sid, 'students'), where('academyId', '==', aid)));
    for (const d of stSnap.docs) {
      const path = d.data().imagePath, mpath = d.data().markPath;
      if (path) { try { await deleteObject(ref(storage, path)); } catch (_) { /* 이미 만료 삭제 */ } }
      if (mpath) { try { await deleteObject(ref(storage, mpath)); } catch (_) {} }
      await deleteDoc(d.ref);
    }
    try { await deleteDoc(doc(db, 'scoresnapSessions', sid, 'key', 'answerKey')); } catch (_) {}
    await deleteDoc(doc(db, 'scoresnapSessions', sid));
  }

  const store = {
    // ─── 채점 대기열 (PC 채점 프로그램이 처리) ───────────────────────
    // 학생 사진을 올리면 곧바로 서버에 '채점 대기' 학생 기록으로 저장하고 작업(job)을 만든다.
    // PC 가 결과를 그 학생 기록에 직접 써 넣으므로 화면을 닫아도 채점은 계속된다.
    // 학생 기록 status: 'queued'(대기) → 'grading'(채점 중) → 'done' | 'error'
    newStudentId(sid) { return doc(collection(db, 'scoresnapSessions', sid, 'students')).id; },
    async queueStudent(sid, { docId, idx, image, answerKey }) {
      const aid = _ssAid();
      const col = collection(db, 'scoresnapSessions', sid, 'students');
      const dref = docId ? doc(col, docId) : doc(col);
      const path = `scoresnap/${aid}/${sid}/${dref.id}.jpg`;
      const task = uploadBytesResumable(ref(storage, path), _ssB64ToBlob(image.base64, image.mimeType),
        { contentType: 'image/jpeg', cacheControl: 'private, max-age=86400' });
      await new Promise((res, rej) => task.on('state_changed', null, rej, res));
      await setDoc(dref, { academyId: aid, idx, imagePath: path, status: 'queued', error: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      await store._createGradeJob(sid, dref.id, path, answerKey, '');
      return { docId: dref.id, imagePath: path };
    },
    // 다시 채점(실패 재시도·정답지 교체): 기존 학생 기록을 대기로 되돌리고 작업을 새로 만든다. keepName: 학원장이 고친 이름 유지
    async requeueStudent(sid, docId, imagePath, answerKey, keepName) {
      await updateDoc(doc(db, 'scoresnapSessions', sid, 'students', docId), { status: 'queued', error: '', markPath: '', markKey: '', updatedAt: serverTimestamp() });
      await store._createGradeJob(sid, docId, imagePath, answerKey, keepName || '');
    },
    async _createGradeJob(sid, docId, imagePath, answerKey, keepName) {
      const aid = _ssAid();
      const jref = doc(collection(db, 'scoresnapSessions'));
      const meta = answerKey || {};
      await setDoc(jref, {
        academyId: aid, kind: 'job', keyStatus: 'job', needsWork: true, status: 'queued',
        createdBy: getUid(), createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + _SS_KEEP_MS),
        jobType: 'student', imagePath,
        payload: _ssClean({
          answerKey: { questions: meta.questions, layout: meta.layout, givenColumn: meta.givenColumn, answerColumns: meta.answerColumns },
          target: { sid, docId, keepName },
        }),
      });
    },
    // 학생 기록 실시간 구독 (사진이 올라오고 채점이 끝나는 대로 화면이 갱신됨). 해제 함수를 돌려준다
    watchStudents(sid, cb, onErr) {
      return onSnapshot(query(collection(db, 'scoresnapSessions', sid, 'students'), where('academyId', '==', _ssAid())),
        (snap) => cb(snap.docs.map(d => ({ docId: d.id, ...d.data() })).sort((a, b) => (a.idx || 0) - (b.idx || 0))),
        (e) => { if (onErr) onErr(e); });
    },
    // PC 채점 프로그램 상태 구독 (worker.js 가 30초마다 기록). 해제 함수를 돌려준다
    watchWorkers(cb) {
      return onSnapshot(query(collection(db, 'scoresnapSessions'), where('academyId', '==', _ssAid()), where('kind', '==', 'worker')),
        (snap) => cb(snap.docs.map(d => d.data())), () => cb([]));
    },
    // 채점 질문: 학원 PC 의 Claude 가 답안지 사진을 다시 보고 답한다 (최대 5분 대기)
    async ask(imagePath, payload) {
      const aid = _ssAid();
      const jref = doc(collection(db, 'scoresnapSessions'));
      await setDoc(jref, {
        academyId: aid, kind: 'job', keyStatus: 'job', needsWork: true, status: 'queued',
        createdBy: getUid(), createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 3600 * 1000),
        jobType: 'ask', imagePath, payload: _ssClean(payload),
      });
      return await new Promise((resolve, reject) => {
        let unsub = null;
        const timer = setTimeout(() => { unsub && unsub(); deleteDoc(jref).catch(() => {}); reject(new Error('PC 채점 프로그램 응답이 없어요 (5분)')); }, 5 * 60 * 1000);
        unsub = onSnapshot(jref, (d) => {
          const j = d.data(); if (!j) return;
          if (j.status === 'done' || j.status === 'error') {
            clearTimeout(timer); unsub();
            deleteDoc(jref).catch(() => {});
            if (j.status === 'error') reject(new Error(j.error || '답변을 만들지 못했어요')); else resolve(j.result || {});
          }
        }, (e) => { clearTimeout(timer); reject(e); });
      });
    },
    // 카톡 보냄 표시 (sent=false 면 해제)
    async markSent(sid, docId, sent) {
      await updateDoc(doc(db, 'scoresnapSessions', sid, 'students', docId), { kakaoSentAt: sent ? serverTimestamp() : deleteField() });
    },
    async patchSession(sid, fields) { await updateDoc(doc(db, 'scoresnapSessions', sid), _ssClean(fields)); },
    async deleteStudent(sid, docId, imagePath, markPath) {
      for (const p of [imagePath, markPath]) { if (p) { try { await deleteObject(ref(storage, p)); } catch (_) {} } }
      await deleteDoc(doc(db, 'scoresnapSessions', sid, 'students', docId));
    },

    // 정답지 사진 보관 (정답지 보기용, 실패해도 채점에는 영향 없음)
    async _uploadKeyImage(sid, image) {
      if (!image || !image.base64) return '';
      try {
        const path = `scoresnap/${_ssAid()}/${sid}/key.jpg`;
        const task = uploadBytesResumable(ref(storage, path), _ssB64ToBlob(image.base64, image.mimeType),
          { contentType: 'image/jpeg', cacheControl: 'private, max-age=86400' });
        await new Promise((res, rej) => task.on('state_changed', null, rej, res));
        return path;
      } catch (e) { console.warn('[scoresnap] 정답지 사진 업로드 실패:', e && e.message); return ''; }
    },

    async createSession(answerKey, precision, keyImage) {
      if (!getUid()) throw new Error('로그인 정보 없음');
      const aid = _ssAid();
      const sref = doc(collection(db, 'scoresnapSessions'));
      await setDoc(sref, {
        academyId: aid, createdBy: getUid(), createdAt: serverTimestamp(),
        expiresAt: new Date(Date.now() + _SS_KEEP_MS),
        testName: String((answerKey && answerKey.testName) || ''),
        questionCount: ((answerKey && answerKey.questions) || []).length,
        studentCount: 0, precision: !!precision,
      });
      const keyImagePath = await store._uploadKeyImage(sref.id, keyImage);
      await setDoc(doc(db, 'scoresnapSessions', sref.id, 'key', 'answerKey'), {
        academyId: aid, answerKey: _ssClean(answerKey), precision: !!precision, keyImagePath,
      });
      return sref.id;
    },

    // st: { docId?, idx, result, image?, imagePath? } → { docId, imagePath }
    async saveStudent(sid, st) {
      const aid = _ssAid();
      const col = collection(db, 'scoresnapSessions', sid, 'students');
      const dref = st.docId ? doc(col, st.docId) : doc(col);
      let imagePath = st.imagePath || '';
      if (!imagePath && st.image && st.image.base64) {
        try {
          const path = `scoresnap/${aid}/${sid}/${dref.id}.jpg`;
          const task = uploadBytesResumable(ref(storage, path), _ssB64ToBlob(st.image.base64, st.image.mimeType),
            { contentType: 'image/jpeg', cacheControl: 'private, max-age=86400' });
          await new Promise((res, rej) => task.on('state_changed', null, rej, res));
          imagePath = path;
        } catch (e) { console.warn('[scoresnap] 이미지 업로드 실패:', e && e.message); }
      }
      await setDoc(dref, {
        academyId: aid, idx: st.idx, result: _ssClean(st.result), imagePath, updatedAt: serverTimestamp(),
      }, { merge: true });
      if (!st.docId) updateDoc(doc(db, 'scoresnapSessions', sid), { studentCount: increment(1) }).catch(() => {});
      return { docId: dref.id, imagePath };
    },

    async updateStudentResult(sid, docId, result) {
      await updateDoc(doc(db, 'scoresnapSessions', sid, 'students', docId), {
        result: _ssClean(result), updatedAt: serverTimestamp(),
      });
    },

    async listSessions() {
      const aid = _ssAid();
      const cutoff = new Date(Date.now() - _SS_KEEP_MS);
      const snap = await getDocs(query(collection(db, 'scoresnapSessions'),
        where('academyId', '==', aid), where('createdAt', '>=', cutoff), orderBy('createdAt', 'desc'), limit(30)));
      // 만료분 정리 — 목록과 무관하게 백그라운드 (실패 무시)
      getDocs(query(collection(db, 'scoresnapSessions'),
        where('academyId', '==', aid), where('createdAt', '<', cutoff), orderBy('createdAt', 'desc'), limit(5)))
        .then(old => Promise.all(old.docs.map(d => _ssDeleteSessionImpl(d.id).catch(() => {}))))
        .catch(() => {});
      return snap.docs.map(d => {
        const v = d.data();
        return { id: d.id, ...v, createdAtMs: (v.createdAt && v.createdAt.toMillis) ? v.createdAt.toMillis() : 0 };
      }).filter(s => !s.keyStatus || s.keyStatus === 'ready');   // 전용앱(/ss/)에서 정답지를 아직 읽는 중인 기록은 숨김
    },

    async loadSession(sid) {
      const aid = _ssAid();
      const [keySnap, stSnap] = await Promise.all([
        getDoc(doc(db, 'scoresnapSessions', sid, 'key', 'answerKey')),
        getDocs(query(collection(db, 'scoresnapSessions', sid, 'students'), where('academyId', '==', aid))),
      ]);
      if (!keySnap.exists()) throw new Error('채점 기록을 찾을 수 없어요 (보관 기간이 지났을 수 있어요)');
      const students = stSnap.docs.map(d => ({ docId: d.id, ...d.data() })).sort((a, b) => (a.idx || 0) - (b.idx || 0));   // 채점 전(대기·오류) 학생은 전용앱에서만
      return { answerKey: keySnap.data().answerKey, precision: !!keySnap.data().precision, keyImagePath: keySnap.data().keyImagePath || '', students };
    },

    async getImageUrl(path) { return await getDownloadURL(ref(storage, path)); },

    // 정답지만 다시 올린 경우 — 세션의 정답지를 교체 (학생 사진·기록은 그대로)
    async updateKey(sid, answerKey, precision, keyImage) {
      const aid = _ssAid();
      const keyImagePath = await store._uploadKeyImage(sid, keyImage);
      await setDoc(doc(db, 'scoresnapSessions', sid, 'key', 'answerKey'), {
        academyId: aid, answerKey: _ssClean(answerKey), precision: !!precision, keyImagePath,
      });
      await updateDoc(doc(db, 'scoresnapSessions', sid), {
        testName: String((answerKey && answerKey.testName) || ''),
        questionCount: ((answerKey && answerKey.questions) || []).length,
      });
    },

    // 마킹 사진(틀린 문항 V + 점수) 저장 — 같은 틀린 문항·점수(markKey)면 다시 만들지 않고 이것을 사용
    async saveMark(sid, docId, blob, markKey, missing) {
      const aid = _ssAid();
      const path = `scoresnap/${aid}/${sid}/${docId}_mark.jpg`;
      const task = uploadBytesResumable(ref(storage, path), blob, { contentType: 'image/jpeg', cacheControl: 'private, max-age=86400' });
      await new Promise((res, rej) => task.on('state_changed', null, rej, res));
      await updateDoc(doc(db, 'scoresnapSessions', sid, 'students', docId), { markPath: path, markKey, markMissing: missing || 0 });
      return path;
    },

    async deleteSession(sid) { await _ssDeleteSessionImpl(sid); },
  };

  return store;
}
