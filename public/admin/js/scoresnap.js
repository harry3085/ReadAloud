// ScoreSnap — 종이 시험지 OCR 채점 (No-Storage MVP, 2026-05-11)
// featureFlags.scoreSnap=true 학원에서만 활성화.
//
// 워크플로우 (재설계 — 정답지 먼저, 학생 답안지 일괄):
//   1) 정답지 1장 촬영 → AI OCR → 검토 (T7-B 작업 대기)
//   2) 학생 답안지 여러 장 (반복 추가 또는 갤러리 다중 선택) (T7-C)
//   3) 일괄 채점 + 이름란 OCR → 학생별 결과 목록 (T7-D)
//   4) 학생 카드 클릭 → 상세 + PNG 다운로드 (T5 결과 카드 재사용)
//
// 현재 상태 (T7-A 완료):
//   - 헤더 더블클릭 진입점 + featureFlag (T2)
//   - 풀스크린 오버레이 + 닫기 + 카메라 자원 해제 (T3 인프라)
//   - 카메라 + 이미지 처리 + 미리보기 (T4)
//   - 결과 카드 골격 + 학원장 수정 + PNG (T5)
//   - 진입점은 임시 자리표시자 — T7-B 정답지 촬영 작업 대기

(function () {
  'use strict';

  // 모듈 state
  let _state = {};
  let _stream = null;
  let _scanRaf = 0;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ─── T2. 헤더 진입점 ───
  let _ssEntrypointBound = false;
  window._ssBindEntrypoint = function () {
    if (_ssEntrypointBound) return;
    const flags = window.MY_FEATURE_FLAGS || {};
    if (flags.scoreSnap !== true) return;
    const headerLogo = document.querySelector('.header-logo');
    if (!headerLogo) return;
    headerLogo.style.cursor = 'pointer';
    headerLogo.title = 'ScoreSnap (더블클릭)';
    headerLogo.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (typeof window.openScoreSnap === 'function') window.openScoreSnap();
    });
    _ssEntrypointBound = true;
    console.log('[scoresnap] 진입점 활성화 (헤더 로고 더블클릭)');
  };

  // ─── 풀스크린 오버레이 + 진입 ───
  window.openScoreSnap = async function () {
    // 서버에 저장된 채점 기록(5일 보관, 폰·PC 공유)이 있으면 선택 창
    if (window._ssStore) {
      let sessions = [];
      try { sessions = await window._ssStore.listSessions(); } catch (e) { console.warn('[scoresnap] 기록 목록 실패:', e && e.message); }
      if (sessions.length) {
        const pick = await _ssShowSessionPicker(sessions);
        if (pick.action === 'cancel') return;
        if (pick.action === 'open') {
          _renderOverlay();
          await _ssOpenServerSession(pick.sid);
          return;
        }
        _clearSession();
        _state = { phase: 'init', answerKey: null, students: [] };
        _renderOverlay();
        _renderAnswerKeyCapture();
        return;
      }
    }
    // 직전 세션 (localStorage) 있으면 이어서 보기 분기
    const prev = _loadSession();
    if (prev) {
      const minutesAgo = Math.max(1, Math.round((Date.now() - prev.savedAt) / 60000));
      const cont = (typeof window.showConfirm === 'function')
        ? await window.showConfirm(
            'ScoreSnap — 이전 채점 결과',
            `${minutesAgo}분 전 채점한 "${(prev.students || []).map(x => x.result?.testName).find(Boolean) || prev.answerKey?.testName || '시험'}" (${prev.students?.length || 0}명) 이어서 보시겠어요?\n\n[확인] 이어서 / [취소] 새로 시작 (이전 결과 삭제)`
          )
        : true;
      if (cont) {
        _state = {
          phase: 'init',
          answerKey: prev.answerKey,
          students: prev.students.map(s => ({ ...s, image: null })),  // image 는 없음 (재채점 불가)
          precision: false,
        };
        _renderOverlay();
        _renderResultGrid();
        return;
      } else {
        _clearSession();
      }
    }
    const ok = (typeof window.showConfirm === 'function')
      ? await window.showConfirm('ScoreSnap', '시험지 채점을 시작할까요?')
      : true;
    if (!ok) return;
    _state = { phase: 'init', answerKey: null, students: [] };
    _renderOverlay();
    _renderAnswerKeyCapture();
  };

  function _renderOverlay() {
    if (document.getElementById('scoreSnapOverlay')) return;
    const ov = document.createElement('div');
    ov.id = 'scoreSnapOverlay';
    ov.style.cssText = [
      'position:fixed', 'inset:0',
      'background:#111', 'color:#fff',
      'z-index:99999',
      'display:flex', 'flex-direction:column',
      'font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif',
    ].join(';');
    ov.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
        <span id="ssHeaderTitle" style="font-size:16px;font-weight:700;">📷 ScoreSnap</span>
        <button id="ssClose" aria-label="닫기" style="background:transparent;border:none;color:#fff;font-size:28px;cursor:pointer;line-height:1;padding:0 6px;">×</button>
      </div>
      <div id="ssBody" style="flex:1;overflow:auto;display:flex;flex-direction:column;"></div>
    `;
    document.body.appendChild(ov);
    document.getElementById('ssClose').onclick = closeScoreSnap;
    _ssPush();
  }

  // ─── 폰 하단 [뒤로가기] = 앱 종료가 아니라 ScoreSnap 안에서 한 단계 앞으로 ───
  // 화면이 한 단계 깊어질 때마다(클릭 안에서) history 를 한 칸 쌓고, 뒤로가기는 한 칸씩 되돌린다.
  // (뒤로가기 처리 중 다시 쌓으면 브라우저가 '사용자 동작 없이 쌓은 기록'으로 보고 건너뛰어 앱이 종료됨)
  let _ssDepth = 0, _ssIgnorePop = 0;
  function _ssPush() {
    if (!document.getElementById('scoreSnapOverlay')) return;
    try { history.pushState({ ss: _ssDepth + 1 }, ''); _ssDepth++; } catch (_) {}
  }
  // ScoreSnap 을 닫을 때 쌓아 둔 기록을 한 번에 정리 (popstate 한 번 발생 → 무시)
  function _ssPopAll() {
    if (_ssDepth <= 0) return;
    const n = _ssDepth; _ssDepth = 0; _ssIgnorePop++;
    try { history.go(-n); } catch (_) { _ssIgnorePop--; }
  }
  // 보조 창(사진 보기·마킹 사진·채점 기록): 열 때 한 칸, 화면 안 버튼으로 닫을 때는 그 칸을 조용히 반납
  function _ssPushSub(ov) { const before = _ssDepth; _ssPush(); ov._ssPushed = _ssDepth > before; }   // 오버레이가 없으면(처음 진입 목록) 쌓지 않음 → 닫을 때 history.back() 도 안 함
  function _ssSubRemove(ov) {
    ov.remove();
    if (ov._ssPushed) { ov._ssPushed = false; _ssDepth = Math.max(0, _ssDepth - 1); _ssIgnorePop++; try { history.back(); } catch (_) { _ssIgnorePop--; } }
  }
  // 화면 안 [← 목록]·[← 정답지 검토로] 버튼 — 폰 뒤로가기와 같은 길로 (기록 칸 수가 어긋나지 않도록)
  window._ssUiBack = function () {
    if (_ssDepth > 1) history.back(); else _ssGoBack();
  };
  // 한 단계 뒤로 (이미 history 가 한 칸 줄어든 상태에서 호출됨)
  function _ssGoBack() {
    const subs = document.querySelectorAll('[data-ss-sub]');
    if (subs.length) {
      const top = subs[subs.length - 1];
      top._ssPushed = false;
      if (typeof top._ssCancel === 'function') top._ssCancel(); else top.remove();
      return;
    }
    switch (_state.phase) {
      case 'student-detail': window._ssCloseStudentDetail(); break;
      case 'student-capture':
        if ((_state.students || []).some(x => x.status === 'done')) _renderResultGrid();
        else if (_state.answerKey?.questions?.length) _renderAnswerKeyReview();
        else _renderAnswerKeyCapture();
        break;
      case 'answerKey-ocr': case 'batch-grading': _ssPush(); break;      // 처리 중에는 그대로
      default: closeScoreSnap();
    }
  }
  window.addEventListener('popstate', (ev) => {
    if (_ssIgnorePop > 0) { _ssIgnorePop--; ev._ssHandled = true; return; }
    if (!document.getElementById('scoreSnapOverlay')) return;
    ev._ssHandled = true;
    _ssDepth = Math.max(0, _ssDepth - 1);
    if (_ssDepth === 0) { closeScoreSnap(); return; }     // 첫 칸까지 소진 → ScoreSnap 종료 (학원장앱으로)
    _ssGoBack();
  });

  // 시험명 — 학생 답안지 헤더 기준. 그 학생에서 못 읽었으면 정답지 → 다른 학생 순으로 폴백
  function _testNameOf(r) {
    const own = String((r && r.testName) || '').trim();
    if (own) return own;
    const k = String((_state.answerKey && _state.answerKey.testName) || '').trim();
    if (k) return k;
    const other = (_state.students || []).map(x => String((x.result && x.result.testName) || '').trim()).find(Boolean);
    return other || '시험';
  }

  // ScoreSnap 전체화면(z-index 99999) 위에서 보이는 토스트 — 앱 기본 토스트는 오버레이 뒤에 가려진다
  let _ssToastEl = null, _ssToastTimer = 0;
  function _ssToast(msg) {
    if (!_ssToastEl) {
      _ssToastEl = document.createElement('div');
      _ssToastEl.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);max-width:88vw;background:rgba(40,40,40,0.96);color:#fff;border:1px solid #666;padding:10px 16px;border-radius:10px;font-size:13px;z-index:100003;box-shadow:0 4px 16px rgba(0,0,0,0.5);text-align:center;pointer-events:none;';
      document.body.appendChild(_ssToastEl);
    }
    _ssToastEl.textContent = msg;
    _ssToastEl.style.display = 'block';
    clearTimeout(_ssToastTimer);
    _ssToastTimer = setTimeout(() => { if (_ssToastEl) _ssToastEl.style.display = 'none'; }, 3500);
  }

  // ─── 서버 저장(폰·PC 동기화, 5일 보관) ───
  const _fmtAgo = (ms) => {
    const m = Math.max(1, Math.round((Date.now() - ms) / 60000));
    if (m < 60) return `${m}분 전`;
    if (m < 1440) return `${Math.round(m / 60)}시간 전`;
    return `${Math.round(m / 1440)}일 전`;
  };

  // 채점 기록 선택 창 → { action:'open', sid } | { action:'new' } | { action:'cancel' }
  function _ssShowSessionPicker(sessions) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.setAttribute('data-ss-sub', '1');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;';
      const done = (r) => { _ssSubRemove(ov); resolve(r); };
      ov._ssCancel = () => { ov.remove(); resolve({ action: 'cancel' }); };
      const draw = () => {
        ov.innerHTML = `
          <div style="background:#1a1a1a;color:#fff;border:1px solid #444;border-radius:12px;width:min(760px,100%);max-height:86vh;display:flex;flex-direction:column;">
            <div style="padding:16px 18px;border-bottom:1px solid #333;">
              <div style="font-size:15px;font-weight:700;">ScoreSnap — 채점 기록</div>
              <div style="font-size:11px;color:#888;margin-top:3px;">폰·PC 어디서든 열 수 있어요 · 5일 뒤 자동 삭제</div>
            </div>
            <div style="padding:10px 14px;overflow-y:auto;flex:1;">
              ${sessions.length ? sessions.map(x => `
                <div style="display:flex;align-items:center;gap:8px;padding:10px 6px;border-bottom:1px solid #2a2a2a;">
                  <div data-open="${esc(x.id)}" style="flex:1;min-width:0;cursor:pointer;">
                    <div style="font-size:13px;font-weight:600;line-height:1.4;word-break:break-word;">${esc(x.testName || '시험')}</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;">${esc(_fmtAgo(x.createdAtMs))} · ${x.studentCount ? x.studentCount + '명 채점' : '<span style="color:#ffc107;">정답지만 저장 · 채점 대기</span>'} · ${x.questionCount || 0}문항</div>
                  </div>
                  <button data-open="${esc(x.id)}" style="background:var(--c-brand,#E8714A);color:#fff;border:none;padding:7px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">열기</button>
                  <button data-del="${esc(x.id)}" title="삭제" style="background:transparent;color:#ff8a80;border:1px solid #553;padding:7px 10px;border-radius:6px;font-size:12px;cursor:pointer;">🗑</button>
                </div>`).join('') : '<div style="color:#888;text-align:center;padding:24px;">기록 없음</div>'}
            </div>
            <div style="padding:12px 14px;border-top:1px solid #333;display:flex;gap:8px;justify-content:flex-end;">
              <button data-cancel="1" style="background:transparent;color:#bbb;border:1px solid #444;padding:9px 16px;border-radius:8px;font-size:13px;cursor:pointer;">닫기</button>
              <button data-new="1" style="background:rgba(255,255,255,0.1);color:#fff;border:1px solid #666;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">+ 새로 채점</button>
            </div>
          </div>`;
      };
      ov.onclick = async (e) => {
        const t = e.target.closest('[data-open],[data-del],[data-new],[data-cancel]');
        if (!t) return;
        if (t.dataset.open) return done({ action: 'open', sid: t.dataset.open });
        if (t.dataset.new) return done({ action: 'new' });
        if (t.dataset.cancel) return done({ action: 'cancel' });
        if (t.dataset.del) {
          const ok = typeof window.showConfirm === 'function'
            ? await window.showConfirm('채점 기록 삭제', '이 채점 기록과 답안지 사진을 삭제할까요?\n(폰·PC 모두에서 사라져요)') : true;
          if (!ok) return;
          try {
            await window._ssStore.deleteSession(t.dataset.del);
            sessions = sessions.filter(x => x.id !== t.dataset.del);
            draw();
          } catch (err) { _ssToast('삭제 실패: ' + (err && err.message)); }
        }
      };
      draw();
      document.body.appendChild(ov);
      _ssPushSub(ov);
    });
  }

  async function _ssOpenServerSession(sid) {
    const toast = (m) => _ssToast(m);
    try {
      const data = await window._ssStore.loadSession(sid);
      _state = {
        phase: 'init', sid, precision: data.precision === true, answerKey: data.answerKey,
        students: data.students.map(x => ({
          status: 'done', result: x.result, image: null, error: null,
          docId: x.docId, imagePath: x.imagePath || '', _idx: x.idx,
          markPath: x.markPath || '', markKey: x.markKey || '', markMissing: x.markMissing || 0,
        })),
      };
      _renderOverlay();
      if (!_state.students.length) _renderStudentCapture();   // 정답지만 저장된 세션 → 학생지 촬영부터
      else _renderResultGrid();
    } catch (e) {
      toast('채점 기록을 열 수 없어요: ' + (e && e.message));
      closeScoreSnap();
    }
  }

  // 새로고침 — 폰에서 방금 채점한 결과를 PC 에서 다시 불러오기
  window._ssRefreshFromServer = async function () {
    if (!_state.sid) return;
    const sid = _state.sid;
    const pending = (_state.students || []).filter(x => x.status !== 'done');   // 아직 채점 안 된(추가 중) 학생은 유지
    try {
      const data = await window._ssStore.loadSession(sid);
      _state.answerKey = data.answerKey;
      _state.students = data.students.map(x => ({
        status: 'done', result: x.result, image: null, error: null, docId: x.docId, imagePath: x.imagePath || '',
        markPath: x.markPath || '', markKey: x.markKey || '', markMissing: x.markMissing || 0,
      })).concat(pending);
      _ssToast('✅ 새로고침 완료');
      _renderResultGrid();
    } catch (e) {
      _ssToast('새로고침 실패: ' + (e && e.message));
    }
  };

  window._ssOpenSessionList = async function () {
    let sessions = [];
    try { sessions = await window._ssStore.listSessions(); } catch (e) { /* 아래에서 빈 목록 처리 */ }
    const pick = await _ssShowSessionPicker(sessions);
    if (pick.action === 'open') {
      _releaseCamera();
      await _ssOpenServerSession(pick.sid);
    } else if (pick.action === 'new') {
      _releaseCamera();
      _clearSession();
      _state = { phase: 'init', answerKey: null, students: [] };
      _renderAnswerKeyCapture();
    }
  };

  window._ssDeleteCurrentSession = async function () {
    if (!_state.sid) return;
    const ok = typeof window.showConfirm === 'function'
      ? await window.showConfirm('채점 기록 삭제', '이 채점 기록과 답안지 사진을 삭제할까요?\n(폰·PC 모두에서 사라져요)') : true;
    if (!ok) return;
    try {
      await window._ssStore.deleteSession(_state.sid);
      _clearSession();
      _ssToast('삭제했어요');
      closeScoreSnap();
    } catch (e) {
      _ssToast('삭제 실패: ' + (e && e.message));
    }
  };

  // 서버로 올리기 — 순차 실행(중복 저장 방지). 새 학생은 사진과 함께, 수정된 학생은 결과만
  let _syncChain = Promise.resolve();
  let _syncTimer = 0;
  function _syncToServer() {
    if (!window._ssStore) return;
    const st = _state;
    _syncChain = _syncChain.then(async () => {
      try {
        if (st._sidPromise) await st._sidPromise;
        if (!st.answerKey?.questions?.length) return;
        const list = st.students || [];
        if (!list.some(x => x.status === 'done' && x.result)) return;
        if (!st.sid) st.sid = await window._ssStore.createSession(st.answerKey, st.precision === true);
        for (let i = 0; i < list.length; i++) {
          const x = list[i];
          if (x.status !== 'done' || !x.result) continue;
          if (!x.docId) {
            const r = await window._ssStore.saveStudent(st.sid, { idx: i, result: x.result, image: x.image });
            x.docId = r.docId; x.imagePath = r.imagePath; x._dirty = false;
          } else if (x._dirty) {
            x._dirty = false;
            await window._ssStore.updateStudentResult(st.sid, x.docId, x.result);
          }
        }
        const el = document.getElementById('ssSyncNote');
        if (el && _state === st) el.textContent = '☁ 서버 저장됨 · 5일 보관 (폰·PC 공유)';
      } catch (e) {
        console.warn('[scoresnap] 서버 저장 실패:', e && e.message);
        const el = document.getElementById('ssSyncNote');
        if (el && _state === st) el.textContent = '⚠ 서버 저장 실패 — 이 기기에만 보관돼요';
      }
    });
  }
  function _markDirty(idx) {
    const x = _state.students?.[idx];
    if (x) x._dirty = true;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(_syncToServer, 1200);
  }

  // 답안지 사진 보기 (로컬 사진이 있으면 그것, 없으면 서버에서)
  window._ssViewStudentImage = async function (idx) {
    const x = _state.students?.[idx];
    if (!x) return;
    let url = x.image?.dataUrl || '';
    if (!url && x.imagePath) {
      try { url = await window._ssStore.getImageUrl(x.imagePath); }
      catch (e) { _ssToast('사진을 불러올 수 없어요 (보관 기간이 지났을 수 있어요)'); return; }
    }
    if (!url) { _ssToast('저장된 사진이 없어요'); return; }
    const ov = document.createElement('div');
    ov.setAttribute('data-ss-sub', '1');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:100001;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:16px;cursor:zoom-out;';
    ov.innerHTML = `<img src="${esc(url)}" alt="" style="max-width:100%;height:auto;display:block;margin:auto;"><button style="position:fixed;top:12px;right:16px;background:transparent;border:none;color:#fff;font-size:32px;cursor:pointer;">×</button>`;
    ov.onclick = () => _ssSubRemove(ov);
    document.body.appendChild(ov);
    _ssPushSub(ov);
  };

  // ─── 마킹 사진: 학생 답안지 사진 위에 틀린 문항 V + 점수칸 점수 ───
  // 번호·점수칸 위치는 Vision OCR(학생당 1회, 결과에 markPos 로 저장). 이후 ✓/✗ 수정은 OCR 없이 즉시 반영.
  async function _ssLoadImageEl(x) {
    let url = x.image?.dataUrl || '';
    if (!url) {
      if (!x.imagePath) throw new Error('저장된 사진이 없어요');
      const remote = await window._ssStore.getImageUrl(x.imagePath);
      const blob = await (await fetch(remote, { cache: 'reload' })).blob();   // 이전에 <img> 로 캐시된(CORS 헤더 없는) 응답 재사용 방지     // 버킷 CORS 허용 필요 (raloud.vercel.app)
      url = URL.createObjectURL(blob);
    }
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('사진을 읽을 수 없어요')); img.src = url; });
    return img;
  }

  async function _ssEnsureMarkPosTable(x, img) {
    if (x.result.markPos && x.result.markPos.cells) return x.result.markPos;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const base64 = c.toDataURL('image/jpeg', 0.85).split(',')[1];
    const idToken = await window._ssGetIdToken();
    const r = await fetch('/api/ocr', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, imageBase64: base64, mimeType: 'image/jpeg', wordBoxes: true, allWords: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.words) throw new Error(j.error || '칸 위치를 읽지 못했어요');
    const W = j.words, cx = w => (w.x1 + w.x2) / 2, cy = w => (w.y1 + w.y2) / 2;
    const givenCol = x.result.givenColumn || '';
    const cols = [givenCol].concat(x.result.answerColumns || []).filter(Boolean);
    // 열 머리글: 긴 이름부터 찾는다 — OCR 이 '과거분사' 를 '과거'+'분사' 두 단어로 쪼개 읽는 경우가 있어
    // 연속한 두 단어를 이어 붙인 것도 인정하고, 그렇게 쓰인 단어는 짧은 이름('과거')이 다시 쓰지 못하게 한다.
    const head = {}, usedIdx = new Set();
    cols.slice().sort((a, b) => b.length - a.length).forEach(name => {
      let best = null;
      W.forEach((w, i) => {
        if (usedIdx.has(i)) return;
        if (w.t === name) { if (!best || w.y1 < best.box.y1) best = { box: w, idx: [i] }; return; }
        const nx = W[i + 1];
        if (nx && !usedIdx.has(i + 1) && w.t + nx.t === name && Math.abs(cy(w) - cy(nx)) < 0.012 && nx.x1 - w.x2 < 0.05) {
          const box = { x1: Math.min(w.x1, nx.x1), x2: Math.max(w.x2, nx.x2), y1: Math.min(w.y1, nx.y1), y2: Math.max(w.y2, nx.y2) };
          if (!best || box.y1 < best.box.y1) best = { box, idx: [i, i + 1] };
        }
      });
      if (best) { head[name] = best.box; best.idx.forEach(i => usedIdx.add(i)); }
    });
    // OCR 이 머리글 글자를 다르게 읽은 경우(예: 한 글자 '뜻' 을 다른 글자로) — 머리글 줄에 남은 단어로 한 칸 보충
    let missingHead = cols.filter(n => !head[n]);
    const foundCols = cols.filter(n => head[n]);
    const bandWords = [];
    if (foundCols.length) {
      const ys = foundCols.map(n => cy(head[n])).sort((a, b) => a - b);
      const hy = ys[Math.floor(ys.length / 2)];
      const usedX = foundCols.map(n => cx(head[n]));
      W.forEach((w, i) => { if (Math.abs(cy(w) - hy) < 0.02) bandWords.push({ w, i }); });
      if (missingHead.length === 1) {
        const cand = bandWords.filter(o => !usedIdx.has(o.i) && usedX.every(x => Math.abs(cx(o.w) - x) > 0.06));
        if (cand.length) {
          const pick = cand.sort((a, b) => (b.w.x2 - b.w.x1) - (a.w.x2 - a.w.x1))[0];
          head[missingHead[0]] = pick.w; usedIdx.add(pick.i);
          missingHead = [];
        }
      }
    }
    if (missingHead.length) {
      console.warn('[scoresnap] 표 머리글 못 찾음:', missingHead, '| 머리글 줄에서 읽힌 글자:', bandWords.map(o => o.w.t).join(' '));
      throw new Error('표의 열 머리글을 못 찾았어요: ' + missingHead.join(', ') + (bandWords.length ? ` (읽힌 글자: ${bandWords.map(o => o.w.t).join(' ')})` : ''));
    }
    const hxs = cols.map(n => cx(head[n])).sort((a, b) => a - b);
    const halfOf = (name) => {
      const i = hxs.indexOf(cx(head[name]));
      const d = [hxs[i - 1] != null ? cx(head[name]) - hxs[i - 1] : Infinity, hxs[i + 1] != null ? hxs[i + 1] - cx(head[name]) : Infinity];
      const m = Math.min(d[0], d[1]);
      return (isFinite(m) ? m : 0.2) / 2;
    };
    const headBottom = Math.max(...cols.map(n => head[n].y2));
    const givenX = cx(head[givenCol]);
    const cells = {};
    (x.result.answers || []).forEach(a => {
      if (!a.col || !a.given) return;
      // 기준 칸 단어: 줄 안에서 기준 열 머리글 x 에 가장 가까운 같은 글자(대소문자 무시)
      const g = String(a.given).toLowerCase();
      const cand = W.filter(w => String(w.t).toLowerCase() === g && w.y1 > headBottom)
        .sort((p1, p2) => Math.abs(cx(p1) - givenX) - Math.abs(cx(p2) - givenX))[0];
      if (!cand || !head[a.col]) return;
      cells[a.no] = { x: cx(head[a.col]) - halfOf(a.col) * 0.9,   // 칸 왼쪽 가장자리 (글씨를 가리지 않게)
           y: cy(cand), h: cand.y2 - cand.y1 };
    });
    const lab = W.filter(w => /^점수:?$/.test(w.t) && w.y1 < 0.25).sort((a, b) => b.x1 - a.x1)[0];
    x.result.markPos = { cells, label: lab ? { x1: lab.x1, y1: lab.y1, x2: lab.x2, y2: lab.y2 } : null };
    _saveSession();
    _markDirty(_state.students.indexOf(x));
    return x.result.markPos;
  }

  async function _ssEnsureMarkPos(x, img) {
    if (x.result.layout === 'table') return _ssEnsureMarkPosTable(x, img);
    if (x.result.markPos && x.result.markPos.nums) return x.result.markPos;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const base64 = c.toDataURL('image/jpeg', 0.85).split(',')[1];
    const idToken = await window._ssGetIdToken();
    const r = await fetch('/api/ocr', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, imageBase64: base64, mimeType: 'image/jpeg', wordBoxes: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.words) throw new Error(j.error || '번호 위치를 읽지 못했어요');
    const total = x.result.totalQuestions || 0;
    const nums = {};
    for (let n = 1; n <= total; n++) {
      let c1 = j.words.filter(w => w.t === n + '.');
      if (!c1.length) c1 = j.words.filter(w => w.t === String(n) && w.y1 > 0.15);
      if (c1.length) { const w = c1.sort((a, b) => a.x1 - b.x1)[0]; nums[n] = { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }; }
    }
    const lab = j.words.filter(w => /^점수:?$/.test(w.t) && w.y1 < 0.25).sort((a, b) => b.x1 - a.x1)[0];
    x.result.markPos = { nums, label: lab ? { x1: lab.x1, y1: lab.y1, x2: lab.x2, y2: lab.y2 } : null };
    _saveSession();
    _markDirty(_state.students.indexOf(x));
    return x.result.markPos;
  }

  function _ssDrawMarks(img, x, pos) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.fillStyle = 'rgba(225,20,20,0.92)';
    g.textBaseline = 'alphabetic';
    const wrong = (x.result.answers || []).filter(a => !a.isCorrect).map(a => a.no);
    if (pos.cells) {
      // 표 형식 — 틀린 칸마다 V (칸 왼쪽). 크기는 모두 같게(줄 높이 중앙값 기준)
      const hs2 = Object.values(pos.cells).map(c => c.h * H).sort((a, b) => a - b);
      const med2 = hs2.length ? hs2[Math.floor(hs2.length / 2)] : 0;
      const size2 = Math.max(36, med2 * 3.2);
      g.font = `900 ${size2}px Arial, sans-serif`;
      g.textAlign = 'center';
      let miss2 = 0;
      for (const a of (x.result.answers || []).filter(a => !a.isCorrect)) {
        const c = pos.cells[a.no];
        if (!c) { miss2++; continue; }
        g.fillText('V', c.x * W, c.y * H + size2 * 0.36);
      }
      const r2 = x.result;
      let sx2, sy2, sf2;
      if (pos.label) {
        sf2 = Math.max(30, (pos.label.y2 - pos.label.y1) * H * 2.2); sx2 = pos.label.x2 * W + 14; sy2 = pos.label.y2 * H + 2;
      } else { sf2 = H * 0.035; sx2 = W * 0.78; sy2 = H * 0.04; }
      g.font = `900 ${sf2}px Arial, sans-serif`;
      g.textAlign = 'left';
      g.fillText(`${r2.correctCount}/${r2.totalQuestions}`, sx2, sy2);
      return { canvas: c, missing: miss2 };
    }
    let missing = 0;
    const hs = Object.values(pos.nums).map(p => (p.y2 - p.y1) * H).sort((a, b) => a - b);
    const medH = hs.length ? hs[Math.floor(hs.length / 2)] : 0;
    const size = Math.max(42, medH * 4.2);        // 모든 V 를 같은 크기로
    for (const n of wrong) {
      const p = pos.nums[n];
      if (!p) { missing++; continue; }
      g.font = `900 ${size}px Arial, sans-serif`;
      g.textAlign = 'center';
      g.fillText('V', p.x1 * W - size * 0.05, ((p.y1 + p.y2) / 2) * H + size * 0.36);
    }
    const r = x.result;
    const txt = `${r.correctCount}/${r.totalQuestions}`;
    let sx, sy, sf;
    if (pos.label) {
      const lh = (pos.label.y2 - pos.label.y1) * H;
      sf = Math.max(30, lh * 2.2); sx = pos.label.x2 * W + 14; sy = pos.label.y2 * H + 2;
    } else { sf = H * 0.04; sx = W * 0.8; sy = H * 0.12; }
    g.font = `900 ${sf}px Arial, sans-serif`;
    g.textAlign = 'left';
    g.fillText(txt, sx, sy);
    return { canvas: c, missing };
  }

  window._ssShowMarkedPhoto = async function (idx) {
    const toast = (m) => _ssToast(m);
    const x = _state.students?.[idx];
    if (!x?.result) return;
    let out;
    try {
      const nameIn = document.getElementById('ssDetailNameIn');
      if (nameIn) x.result.studentName = nameIn.value || '';
      // 틀린 문항·점수가 그대로면 이전에 만든 마킹 사진을 재사용 (사진 다시 받기·OCR·그리기 생략)
      const key = (x.result.answers || []).filter(a => !a.isCorrect).map(a => a.no).join(',') + '|' + x.result.correctCount + '/' + x.result.totalQuestions;
      if (x._markCache && x._markCache.key === key) {
        out = { canvas: x._markCache.canvas, missing: x._markCache.missing };
      } else {
        toast(x.markPath && x.markKey === key ? '저장된 마킹 사진 불러오는 중...' : '마킹 사진 만드는 중... (처음 한 번만)');
        // 서버에 저장된 마킹 사진이 있고 틀린 문항·점수가 같으면 그것을 사용
        if (x.markPath && x.markKey === key && window._ssStore) {
          try {
            const blob = await (await fetch(await window._ssStore.getImageUrl(x.markPath), { cache: 'reload' })).blob();
            const bu = URL.createObjectURL(blob);
            const mi = new Image();
            await new Promise((res, rej) => { mi.onload = res; mi.onerror = rej; mi.src = bu; });
            const mc = document.createElement('canvas'); mc.width = mi.naturalWidth; mc.height = mi.naturalHeight;
            mc.getContext('2d').drawImage(mi, 0, 0);
            out = { canvas: mc, missing: x.markMissing || 0 };
          } catch (e) { console.warn('[scoresnap] 저장된 마킹 사진 불러오기 실패 → 새로 만듦:', e && e.message); }
        }
        if (!out) {
          const img = await _ssLoadImageEl(x);
          const pos = await _ssEnsureMarkPos(x, img);
          out = _ssDrawMarks(img, x, pos);
          // 서버에 저장 (사진이 이미 올라가 있는 학생만, 실패해도 무시)
          if (window._ssStore && _state.sid && x.docId) {
            const sid = _state.sid, cv = out.canvas, miss = out.missing;
            cv.toBlob(b => {
              if (!b) return;
              window._ssStore.saveMark(sid, x.docId, b, key, miss)
                .then(path => { x.markPath = path; x.markKey = key; x.markMissing = miss; })
                .catch(e => console.warn('[scoresnap] 마킹 사진 서버 저장 실패:', e && e.message));
            }, 'image/jpeg', 0.92);
          }
        }
        x._markCache = { key, canvas: out.canvas, missing: out.missing };
      }
    } catch (e) {
      console.warn('[scoresnap] 마킹 사진 실패:', e && e.message);
      toast('마킹 사진을 만들 수 없어요: ' + (e && e.message));
      return;
    }
    const url = out.canvas.toDataURL('image/png');
    const blobP = new Promise(r => out.canvas.toBlob(r, 'image/png'));
    const safe = v => String(v).replace(/[\\/:*?"<>|]/g, '_');
    const fname = `${safe(x.result.studentName || '학생' + (idx + 1))}_${safe(_testNameOf(x.result))}_채점.png`;
    const ov = document.createElement('div');
    ov.setAttribute('data-ss-sub', '1');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.94);z-index:100001;display:flex;flex-direction:column;';
    ov.innerHTML = `
      <div style="flex:1;overflow:auto;padding:12px;display:flex;"><img src="${url}" alt="" style="max-width:100%;height:auto;margin:auto;display:block;"></div>
      ${out.missing ? `<div style="padding:6px 12px;font-size:11px;color:#ffcc80;text-align:center;">⚠ 번호 위치를 못 찾은 문항 ${out.missing}개는 V가 빠졌어요</div>` : ''}
      <div style="padding:10px 12px;border-top:1px solid #333;display:flex;gap:6px;">
        <button data-act="dl" style="flex:1;background:var(--c-brand,#E8714A);color:#fff;border:none;padding:11px 6px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">📥 PNG 저장</button>
        <button data-act="cp" style="flex:1.3;background:#fee500;color:#191919;border:none;padding:11px 6px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">📋 복사 (카톡)</button>
        <button data-act="x" style="flex:0.7;background:rgba(255,255,255,0.1);color:#fff;border:1px solid #555;padding:11px 6px;border-radius:8px;font-size:13px;cursor:pointer;white-space:nowrap;">닫기</button>
      </div>`;
    ov.onclick = async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      if (b.dataset.act === 'x') return _ssSubRemove(ov);
      if (b.dataset.act === 'dl') {
        const blob = await blobP;
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = u; a.download = fname;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 1000);
      } else if (b.dataset.act === 'cp') {
        if (!navigator.clipboard || typeof window.ClipboardItem !== 'function') return toast('이 브라우저는 이미지 복사를 지원하지 않아요 — PNG 저장을 사용하세요');
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]); toast('✅ 복사됨 — 카카오톡에서 붙여넣으세요'); }
        catch (err) { toast('복사에 실패했어요 — PNG 저장을 사용하세요'); }
      }
    };
    document.body.appendChild(ov);
    _ssPushSub(ov);
  };

  function closeScoreSnap() {
    _ssPopAll();
    _releaseCamera();
    document.getElementById('scoreSnapOverlay')?.remove();
    _state = {};
  }
  window.closeScoreSnap = closeScoreSnap;

  function _setHeader(text) {
    const el = document.getElementById('ssHeaderTitle');
    if (el) el.textContent = text;
  }

  // ─── T7-B. 정답지 촬영 화면 ───
  function _renderAnswerKeyCapture() {
    _state.phase = 'answerKey-capture';
    _setHeader('📋 ScoreSnap · 1단계: 정답지 촬영');
    const body = document.getElementById('ssBody');
    if (!body) return;
    const precision = _state.precision === true;
    const precisionBadge = precision
      ? '<span style="display:inline-block;background:#5a3a1a;color:#ffc107;border:1px solid #ffc107;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;margin-left:6px;">🎯 정밀 모드</span>'
      : '';
    body.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid #333;flex-shrink:0;">
        <div style="font-size:13px;color:#bbb;line-height:1.6;">
          정답이 표시된 시험지 1장을 먼저 촬영해 주세요. AI 가 문제·정답을 자동으로 인식합니다.
          (시험지 출력 시 <b style="color:#fff;">[답지 보기]</b> 옵션 켜고 인쇄한 것 권장)
          ${precisionBadge}
        </div>
      </div>
      <div id="ssAkBody" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:40px 30px;gap:18px;overflow-y:auto;min-height:0;">
        <div style="font-size:48px;">📋</div>
        <div style="font-size:14px;color:#bbb;text-align:center;line-height:1.5;">
          정답이 포함된 시험지 1장 촬영
          ${precision ? '<br><span style="font-size:11px;color:#ffc107;">정밀 모드 — 해상도·정확도 ↑, 응답 +3~5초</span>' : ''}
        </div>
        <input id="ssAkCamIn" type="file" accept="image/*" capture="environment" style="display:none;">
        <input id="ssAkGalIn" type="file" accept="image/*" style="display:none;">
        <button id="ssAkCamBtn"
          style="background:var(--c-brand,#E8714A);color:#fff;border:none;padding:18px 40px;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.3);">
          📷 정답지 촬영
        </button>
        <button id="ssAkGalBtn"
          style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #444;padding:10px 24px;border-radius:8px;font-size:13px;cursor:pointer;">
          🖼 갤러리에서 선택
        </button>
      </div>
    `;
    const camIn = document.getElementById('ssAkCamIn');
    const galIn = document.getElementById('ssAkGalIn');
    document.getElementById('ssAkCamBtn').onclick = () => camIn.click();
    document.getElementById('ssAkGalBtn').onclick = () => galIn.click();
    camIn.onchange  = (e) => _handleAnswerKeyFile(e.target.files?.[0]);
    galIn.onchange  = (e) => _handleAnswerKeyFile(e.target.files?.[0]);
  }

  async function _handleAnswerKeyFile(file) {
    if (!file) return;
    const body = document.getElementById('ssAkBody');
    if (body) body.innerHTML = `<div style="color:#bbb;text-align:center;font-size:14px;padding:40px;">⏳ 이미지 처리 중…</div>`;
    try {
      const precision = _state.precision === true;
      const processed = await window._ssProcessImage(file, { precision });
      _state.answerKeyImage = processed;
      _renderAnswerKeyOcr(processed, precision);
    } catch (e) {
      if (body) body.innerHTML = `
        <div style="color:#ff8a80;text-align:center;font-size:14px;line-height:1.5;padding:30px;">
          이미지 처리 실패<br><span style="color:#999;font-size:12px;">${esc(e.message)}</span>
        </div>
        <button onclick="window._ssAkRestart()" style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:10px 24px;border-radius:8px;font-size:13px;cursor:pointer;">다시 시도</button>
      `;
    }
  }

  // 정답지 OCR 호출 + 진행 표시
  async function _renderAnswerKeyOcr(processed, precision = false) {
    _state.phase = 'answerKey-ocr';
    const body = document.getElementById('ssBody');
    if (!body) return;
    body.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;gap:18px;">
        <div style="width:48px;height:48px;border:4px solid #333;border-top-color:var(--c-brand,#E8714A);border-radius:50%;animation:ssSpin 1s linear infinite;"></div>
        <div style="font-size:15px;color:#fff;font-weight:600;">AI 가 정답지 분석 중…${precision ? ' (정밀 모드)' : ''}</div>
        <div style="font-size:12px;color:#888;line-height:1.5;text-align:center;">${precision ? '보통 8~13초' : '보통 5~10초'}<br>문제·정답 자동 추출</div>
      </div>
      <style>@keyframes ssSpin { to { transform: rotate(360deg); } }</style>
    `;
    try {
      const idToken = await window._ssGetIdToken();
      const r = await fetch('/api/scoresnap-grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          mode: 'answerKey',
          imageBase64: processed.base64,
          imageMimeType: processed.mimeType,
          precision,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      _state.answerKey = data;
      _renderAnswerKeyReview();
    } catch (e) {
      body.innerHTML = `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;gap:14px;text-align:center;max-width:420px;margin:0 auto;">
          <div style="font-size:48px;">⚠</div>
          <div style="font-size:15px;color:#ff8a80;font-weight:600;">정답지 분석 실패</div>
          <div style="font-size:13px;color:#bbb;line-height:1.6;">${esc(e.message)}</div>
          <button onclick="window._ssAkRestart()" style="margin-top:14px;background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:10px 24px;border-radius:8px;font-size:13px;cursor:pointer;">다시 촬영</button>
        </div>
      `;
    }
  }

  // 추출된 정답지 검토 — 학원장이 오류 직접 수정
  function _renderAnswerKeyReview() {
    _state.phase = 'answerKey-review';
    _setHeader('📋 ScoreSnap · 정답지 검토');
    const body = document.getElementById('ssBody');
    if (!body) return;
    const k = _state.answerKey || {};
    const qs = k.questions || [];
    body.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:12px;flex-wrap:wrap;">
        <div style="min-width:0;flex:1;">
          <div style="font-size:14px;font-weight:600;color:#fff;">${esc(k.testName || '시험')} · ${qs.length}문항 인식됨${k.layout === 'table' ? ` <span style="font-size:11px;color:#6a9;font-weight:400;">(표 형식 · ${k.givenColumn} 보고 ${(k.answerColumns || []).join('·')} 쓰기, 칸마다 1문항)</span>` : ''} ${_state.precision === true ? '<span style="font-size:10px;color:#ffc107;font-weight:400;">🎯 정밀</span>' : ''}</div>
          <div style="font-size:11px;color:#888;margin-top:2px;">정답만 직접 수정 가능. 보기·문제 텍스트 인식 부족하면 [🎯 정밀 모드] 재촬영</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button onclick="window._ssAkRestart()" style="background:transparent;color:#bbb;border:1px solid #444;padding:6px 12px;border-radius:6px;font-size:11px;cursor:pointer;">🔄 다시 촬영</button>
          ${_state.precision === true
            ? ''
            : '<button onclick="window._ssAkPrecisionRetry()" style="background:#5a3a1a;color:#ffc107;border:1px solid #ffc107;padding:6px 12px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;" title="해상도 ↑ + AI 보수 모드. 응답 +3~5초">🎯 정밀 모드 재촬영</button>'}
        </div>
      </div>
      <div id="ssAkReviewList" style="flex:1;overflow-y:auto;padding:14px;background:#0a0a0a;">
        ${qs.map((q, i) => _buildAnswerKeyRow(q, i)).join('') || '<div style="color:#888;text-align:center;padding:40px;">문항이 인식되지 않았어요. 다시 촬영해 주세요.</div>'}
      </div>
      <div style="padding:14px 18px;border-top:1px solid #333;display:flex;justify-content:center;gap:10px;flex-shrink:0;">
        <button onclick="window.closeScoreSnap()" style="background:transparent;color:#bbb;border:1px solid #444;padding:11px 22px;border-radius:8px;font-size:13px;cursor:pointer;">취소</button>
        <button onclick="window._ssAkConfirm()" style="background:var(--c-brand,#E8714A);color:#fff;border:none;padding:11px 30px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;${qs.length === 0 ? 'opacity:0.5;pointer-events:none;' : ''}">
          ✓ 정답지 확정 → 학생 답안 채점
        </button>
      </div>
    `;
  }

  function _buildAnswerKeyRow(q, idx) {
    const isMcq = q.type === 'mcq';
    const lowConf = q.confidence < 0.8;
    const choicesHtml = isMcq && Array.isArray(q.choices) && q.choices.length
      ? `<div style="font-size:11px;color:#bbb;margin-top:4px;">${q.choices.map((c, j) => `${['①','②','③','④','⑤'][j] || j+1} ${esc(c)}`).join(' &nbsp; ')}</div>`
      : '';
    return `
      <div style="background:${lowConf ? '#3a2a1a' : '#1a1a1a'};border:1px solid ${lowConf ? '#ffc107' : '#333'};border-radius:6px;padding:10px 14px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="font-size:13px;font-weight:700;color:#fff;">Q${q.no} <span style="font-size:10px;color:#888;font-weight:400;">[${isMcq ? '객관식' : '단답'}]</span> ${lowConf ? '<span style="font-size:10px;color:#ffc107;">⚠ 검토</span>' : ''}</div>
          <div style="font-size:10px;color:#666;">conf ${Math.round((q.confidence || 0) * 100)}%</div>
        </div>
        <div style="font-size:12px;color:#ddd;margin-top:4px;line-height:1.5;">${esc(q.stem) || '<span style="color:#666;">(문제 없음)</span>'}</div>
        ${choicesHtml}
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
          <span style="font-size:11px;color:#888;flex-shrink:0;">정답:</span>
          <input type="text" value="${esc(q.answer || '')}"
            onchange="window._ssAkEditAnswer(${idx}, this.value)"
            style="flex:1;padding:5px 8px;background:#0a0a0a;border:1px solid #555;border-radius:4px;color:#fff;font-size:12px;font-family:inherit;">
        </div>
      </div>
    `;
  }

  // 학원장 정답 직접 수정
  window._ssAkEditAnswer = function (idx, val) {
    if (!_state.answerKey?.questions?.[idx]) return;
    const q = _state.answerKey.questions[idx];
    q.answer = String(val || '').trim();
    // MCQ 면 choices 에서 매칭되는 인덱스 찾아 answerIdx 갱신
    if (q.type === 'mcq' && Array.isArray(q.choices)) {
      const matchIdx = q.choices.findIndex(c => c === q.answer);
      if (matchIdx >= 0) q.answerIdx = matchIdx;
    }
    // confidence 높여서 회색으로 (수동 수정한 거니까)
    q.confidence = 1.0;
    // 해당 카드만 갱신은 어려우니 전체 다시 그림
    _renderAnswerKeyReview();
  };

  function _ssDropEmptySession() {
    const sid = _state.sid;
    if (sid && window._ssStore && !(_state.students || []).some(x => x.status === 'done')) {
      window._ssStore.deleteSession(sid).catch(() => {});
      _state.sid = null; _state._sidPromise = null;
    }
  }

  window._ssAkRestart = function () {
    _ssDropEmptySession();
    _state.answerKey = null;
    _state.answerKeyImage = null;
    _state.precision = false;  // 다시 촬영은 기본 모드로
    _renderAnswerKeyCapture();
  };

  // 정밀 모드로 재촬영 — 해상도 + maxTokens + temperature 조정
  window._ssAkPrecisionRetry = function () {
    _ssDropEmptySession();
    _state.answerKey = null;
    _state.answerKeyImage = null;
    _state.precision = true;
    _renderAnswerKeyCapture();
  };

  // 정답지 확정 → 학생 답안 단계
  window._ssAkConfirm = function () {
    if (!_state.answerKey?.questions?.length) return;
    _state.students = [];
    // 정답지를 서버에 바로 저장 — PC 에서 정답지를 올리고 폰에서 [채점 기록]을 열어 학생지 촬영
    if (window._ssStore && !_state.sid) {
      const st = _state;
      st._sidPromise = window._ssStore.createSession(st.answerKey, st.precision === true)
        .then(id => { st.sid = id; _ssToast('☁ 정답지 저장됨 — 폰에서 [채점 기록]을 열어 이어서 채점할 수 있어요'); })
        .catch(e => { console.warn('[scoresnap] 정답지 서버 저장 실패:', e && e.message); });
    }
    _renderStudentCapture();
    _ssPush();
  };

  // ─── T7-C. 학생 답안지 일괄 촬영 화면 ───
  function _renderStudentCapture() {
    _state.phase = 'student-capture';
    _setHeader('🎓 ScoreSnap · 2단계: 학생 답안지');
    const body = document.getElementById('ssBody');
    if (!body) return;
    const k = _state.answerKey;
    const precision = _state.precision === true;
    const pendN = (_state.students || []).filter(x => x.status !== 'done').length;
    const doneN = (_state.students || []).length - pendN;
    const precisionBadge = precision
      ? '<span style="display:inline-block;background:#5a3a1a;color:#ffc107;border:1px solid #ffc107;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;margin-left:6px;">🎯 정밀</span>'
      : '';

    body.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid #333;flex-shrink:0;">
        <div style="font-size:14px;font-weight:600;color:#fff;">${esc(k.testName || '시험')} · ${k.questions.length}문항 ${precisionBadge}</div>
        <div style="font-size:11px;color:#888;margin-top:3px;">학생 답안지 여러 장 추가 후 [🚀 일괄 채점] 누르세요. 이름란의 손글씨로 학생 자동 구분.${doneN ? ` <span style="color:#6a9;">· 이미 채점된 ${doneN}명은 그대로 유지돼요 (채점 후 결과 목록에 함께 표시)</span>` : ''}</div>
      </div>
      <div style="padding:14px 18px;border-bottom:1px solid #333;display:flex;flex-wrap:wrap;gap:10px;align-items:center;flex-shrink:0;">
        <input id="ssStCamIn" type="file" accept="image/*" capture="environment" style="display:none;">
        <input id="ssStGalIn" type="file" accept="image/*" multiple style="display:none;">
        <button id="ssStCamBtn"
          style="background:var(--c-brand,#E8714A);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">
          📷 사진 추가 촬영
        </button>
        <button id="ssStGalBtn"
          style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #444;padding:10px 20px;border-radius:8px;font-size:13px;cursor:pointer;">
          🖼 갤러리 다중 선택
        </button>
        <div style="flex:1;"></div>
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:${precision ? '#ffc107' : '#888'};cursor:pointer;">
          <input type="checkbox" id="ssStPrecision" ${precision ? 'checked' : ''} onchange="window._ssStTogglePrecision(this.checked)" style="cursor:pointer;">
          🎯 정밀 모드
        </label>
      </div>
      <div id="ssStThumbs" style="flex:1;overflow-y:auto;padding:14px;background:#0a0a0a;min-height:0;">
        ${_buildStudentThumbsHtml()}
      </div>
      <div style="padding:14px 18px;border-top:1px solid #333;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:10px;flex-wrap:wrap;">
        <button onclick="window._ssUiBack()" style="background:transparent;color:#bbb;border:1px solid #444;padding:10px 16px;border-radius:6px;font-size:12px;cursor:pointer;">← 정답지 검토로</button>
        <div style="flex:1;text-align:center;font-size:12px;color:#888;" id="ssStCount">${pendN}장 추가됨</div>
        <button id="ssStGradeBtn" onclick="window._ssStartBatchGrade()"
          ${pendN === 0 ? 'disabled' : ''}
          style="background:${pendN === 0 ? '#444' : 'var(--c-brand,#E8714A)'};color:#fff;border:none;padding:11px 24px;border-radius:8px;font-size:14px;font-weight:700;cursor:${pendN === 0 ? 'not-allowed' : 'pointer'};${pendN === 0 ? 'opacity:0.5;' : ''}">
          🚀 일괄 채점 (${pendN}명)
        </button>
      </div>
    `;
    const camIn = document.getElementById('ssStCamIn');
    const galIn = document.getElementById('ssStGalIn');
    document.getElementById('ssStCamBtn').onclick = () => camIn.click();
    document.getElementById('ssStGalBtn').onclick = () => galIn.click();
    camIn.onchange = (e) => _handleStudentFiles(e.target.files);
    galIn.onchange = (e) => _handleStudentFiles(e.target.files);
  }

  function _buildStudentThumbsHtml() {
    const list = (_state.students || []).map((x, i) => ({ x, i })).filter(o => o.x.status !== 'done' && o.x.image);
    if (list.length === 0) {
      return `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#666;text-align:center;gap:14px;padding:40px;">
          <div style="font-size:48px;">🎓</div>
          <div style="font-size:14px;">학생 답안지를 추가해 주세요</div>
          <div style="font-size:11px;color:#555;line-height:1.6;">
            한 장씩 촬영하거나, 갤러리에서 여러 장 한 번에 선택 가능.<br>
            이름란 손글씨로 학생 자동 구분됩니다.
          </div>
        </div>
      `;
    }
    const rows = list.map((o, n) => { const s = o.x, i = o.i; return `
      <div style="position:relative;background:#1a1a1a;border:1px solid #333;border-radius:6px;overflow:hidden;">
        <img src="${s.image.dataUrl}" alt="" style="width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:#000;">
        <div style="position:absolute;top:4px;left:6px;background:rgba(0,0,0,0.7);color:#fff;font-size:11px;padding:2px 6px;border-radius:3px;">${n + 1}</div>
        <button onclick="window._ssStRemove(${i})" title="삭제"
          style="position:absolute;top:4px;right:4px;background:rgba(220,38,38,0.85);color:#fff;border:none;width:24px;height:24px;border-radius:50%;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">✕</button>
        <div style="font-size:10px;color:#888;padding:4px 6px;text-align:center;">${s.image.sizeKB} KB</div>
      </div>
    `; }).join('');
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;">
        ${rows}
      </div>
    `;
  }

  async function _handleStudentFiles(files) {
    if (!files || files.length === 0) return;
    const precision = _state.precision === true;
    const thumbs = document.getElementById('ssStThumbs');
    const before = _state.students.length;
    // 다중 파일 처리 — 순차 (대량일 때 메모리 안전)
    for (const file of files) {
      try {
        const processed = await window._ssProcessImage(file, { precision });
        _state.students.push({ image: processed, status: 'pending', result: null, error: null });
      } catch (e) {
        console.warn('[scoresnap] image process 실패:', e.message);
      }
    }
    if (_state.students.length > before) {
      // 썸네일·카운트·버튼 갱신 (전체 다시 그림)
      _renderStudentCapture();
    }
    // input value 비움 (같은 파일 재선택 가능)
    const camIn = document.getElementById('ssStCamIn');
    const galIn = document.getElementById('ssStGalIn');
    if (camIn) camIn.value = '';
    if (galIn) galIn.value = '';
  }

  window._ssStRemove = function (idx) {
    if (!_state.students || idx < 0 || idx >= _state.students.length) return;
    _state.students.splice(idx, 1);
    _renderStudentCapture();
  };

  window._ssStTogglePrecision = function (checked) {
    _state.precision = checked === true;
  };

  window._ssBackToAnswerKey = function () {
    // 정답지 검토 화면으로 (재촬영 X — 그대로 유지)
    if (!_state.answerKey?.questions?.length) {
      _renderAnswerKeyCapture();
      return;
    }
    _renderAnswerKeyReview();
  };

  // ─── 일괄 채점 — 동시 호출 5개 throttle ───
  const BATCH_CONCURRENCY = 5;

  window._ssStartBatchGrade = async function () {
    const list = _state.students || [];
    if (!list.some(x => x.status !== 'done')) return;
    _state.phase = 'batch-grading';
    _setHeader(`🚀 ScoreSnap · 일괄 채점 (${list.filter(x => x.status !== 'done').length}명)`);
    _renderBatchProgress();

    let done = 0;
    const update = () => {
      const el = document.getElementById('ssBatchProgress');
      if (el) {
        const success = list.filter(s => s.status === 'done').length;
        const failed = list.filter(s => s.status === 'error').length;
        el.innerHTML = `채점 중 ${done}/${list.length}<br><span style="font-size:11px;color:#888;">✓ ${success}명 · ${failed > 0 ? `<span style="color:#ff8a80;">✗ ${failed}명</span>` : '실패 없음'}</span>`;
      }
    };
    update();

    // worker pool
    let cursor = 0;
    async function worker() {
      while (cursor < list.length) {
        const myIdx = cursor++;
        const s = list[myIdx];
        if (s.status === 'done') { done++; update(); continue; }
        s.status = 'grading';
        try {
          s.result = await _gradeOneStudent(s.image);
          s.status = 'done';
        } catch (e) {
          s.error = e.message || '채점 실패';
          s.status = 'error';
        }
        done++;
        update();
      }
    }
    await Promise.all(Array(Math.min(BATCH_CONCURRENCY, list.length)).fill(0).map(() => worker()));

    // 전부 끝나면 결과 목록 (T7-D 자리표시자 — 현재는 간이 표시)
    _renderBatchResults();
  };

  async function _gradeOneStudent(image) {
    const idToken = await window._ssGetIdToken();
    const r = await fetch('/api/scoresnap-grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        mode: 'student',
        imageBase64: image.base64,
        imageMimeType: image.mimeType,
        answerKeyQuestions: _state.answerKey.questions,
        answerKeyMeta: _state.answerKey.layout === 'table'
          ? { layout: 'table', givenColumn: _state.answerKey.givenColumn, answerColumns: _state.answerKey.answerColumns }
          : null,
        precision: _state.precision === true,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    // 학원장 토글 후 "원상태 복귀" 감지용 — AI 원본 isCorrect 보존
    if (Array.isArray(data.answers)) {
      data.answers.forEach(a => { a._aiIsCorrect = a.isCorrect === true; });
    }
    return data;
  }

  function _renderBatchProgress() {
    const body = document.getElementById('ssBody');
    if (!body) return;
    body.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;gap:18px;">
        <div style="width:48px;height:48px;border:4px solid #333;border-top-color:var(--c-brand,#E8714A);border-radius:50%;animation:ssSpin 1s linear infinite;"></div>
        <div style="font-size:15px;color:#fff;font-weight:600;">학생 답안 채점 중…</div>
        <div id="ssBatchProgress" style="font-size:13px;color:#bbb;line-height:1.6;text-align:center;"></div>
        <div style="font-size:11px;color:#666;text-align:center;line-height:1.6;max-width:320px;">
          동시 ${BATCH_CONCURRENCY}명 병렬 처리. 학생당 보통 5~10초.
        </div>
      </div>
      <style>@keyframes ssSpin { to { transform: rotate(360deg); } }</style>
    `;
  }

  // ─── T7-D. 학생별 결과 카드 그리드 ───
  function _renderBatchResults() {
    _renderResultGrid();
  }

  function _renderResultGrid() {
    _state.phase = 'result-grid';
    _saveSession();  // 진입 시점에 항상 최신 결과 localStorage 백업
    _syncToServer(); // 서버(폰·PC 공유, 5일 보관)에도 저장
    _setHeader(`📊 ScoreSnap · 결과 (${_testNameOf(null)})`);
    const body = document.getElementById('ssBody');
    if (!body) return;
    const list = _state.students || [];
    const done = list.filter(s => s.status === 'done').length;
    const failed = list.filter(s => s.status === 'error').length;

    body.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-shrink:0;flex-wrap:wrap;">
        <div style="min-width:0;flex:1;">
          <div style="font-size:14px;font-weight:600;color:#fff;">채점 완료 · ${esc(_testNameOf(null))}</div>
          <div style="font-size:11px;color:#888;margin-top:2px;">총 ${list.length}명 · ✓ ${done}명 성공${failed > 0 ? ` · <span style="color:#ff8a80;">✗ ${failed}명 실패</span>` : ''} · 카드 클릭 → 상세</div>
          <div id="ssSyncNote" style="font-size:10px;color:#6a9;margin-top:2px;">${window._ssStore ? '☁ 서버에 저장 중…' : ''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${window._ssStore ? `
          <button onclick="window._ssRefreshFromServer()" title="폰에서 채점한 결과를 다시 불러오기" style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:7px 12px;border-radius:6px;font-size:12px;cursor:pointer;">↻ 새로고침</button>
          <button onclick="window._ssOpenSessionList()" style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:7px 12px;border-radius:6px;font-size:12px;cursor:pointer;">📂 채점 기록</button>
          <button onclick="window._ssDeleteCurrentSession()" title="이 채점 기록 삭제" style="background:transparent;color:#ff8a80;border:1px solid #553;padding:7px 10px;border-radius:6px;font-size:12px;cursor:pointer;">🗑</button>` : ''}
          <button onclick="window._ssBackToStudentCapture()" style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:7px 14px;border-radius:6px;font-size:12px;cursor:pointer;">+ 답안지 추가</button>
          <button onclick="window.closeScoreSnap()" style="background:transparent;color:#bbb;border:1px solid #444;padding:7px 14px;border-radius:6px;font-size:12px;cursor:pointer;">종료</button>
        </div>
      </div>
      <div id="ssResultGrid" style="flex:1;overflow-y:auto;padding:16px;background:#0a0a0a;">
        ${_buildResultGridHtml()}
      </div>
    `;
  }

  function _buildResultGridHtml() {
    const list = _state.students || [];
    if (list.length === 0) return '<div style="color:#888;text-align:center;padding:40px;">결과 없음</div>';
    const cards = list.map((s, i) => _buildStudentCardHtml(s, i)).join('');
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;">${cards}</div>`;
  }

  function _buildStudentCardHtml(s, idx) {
    if (s.status === 'error') {
      return `
        <div onclick="window._ssRetryOne(${idx})" style="background:#2a1a1a;border:1px solid #5a3030;border-radius:8px;padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:8px;">
          <div style="font-size:11px;color:#999;">#${idx + 1}</div>
          <div style="font-size:24px;text-align:center;">⚠</div>
          <div style="font-size:12px;color:#ff8a80;text-align:center;font-weight:600;">채점 실패</div>
          <div style="font-size:10px;color:#888;text-align:center;line-height:1.4;max-height:32px;overflow:hidden;">${esc(s.error || '오류')}</div>
          <div style="font-size:10px;color:#888;text-align:center;margin-top:4px;">↻ 클릭 재시도</div>
        </div>
      `;
    }
    const r = s.result || {};
    const pct = r.scorePercent || 0;
    const color = pct >= 80 ? '#22c55e' : pct >= 60 ? '#eab308' : '#ef4444';
    const name = (r.studentName || '').trim() || `(이름 미인식 #${idx + 1})`;
    return `
      <div onclick="window._ssOpenStudentDetail(${idx})" style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:8px;transition:border-color 0.15s;"
        onmouseover="this.style.borderColor='#666'" onmouseout="this.style.borderColor='#333'">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:11px;color:#888;">#${idx + 1}</div>
          <div style="font-size:10px;color:${color};font-weight:700;">${pct}점</div>
        </div>
        <div style="font-size:14px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(name)}</div>
        <div style="display:flex;align-items:baseline;gap:6px;">
          <span style="font-size:24px;font-weight:800;color:${color};line-height:1;">${r.correctCount || 0}</span>
          <span style="font-size:13px;color:#888;">/ ${r.totalQuestions || 0}</span>
        </div>
        ${(r.uncertainQuestions || []).length > 0 ? `<div style="font-size:10px;color:#ffc107;">⚠ ${r.uncertainQuestions.length} 검토</div>` : ''}
        <div style="font-size:10px;color:#666;text-align:center;margin-top:auto;">상세 보기 →</div>
      </div>
    `;
  }

  // 실패 카드 재시도
  window._ssRetryOne = async function (idx) {
    const s = _state.students?.[idx];
    if (!s || s.status === 'grading') return;
    s.status = 'grading';
    s.error = null;
    // 그리드 카드만 갱신 어려우니 전체 재렌더
    _renderResultGrid();
    try {
      s.result = await _gradeOneStudent(s.image);
      s.status = 'done';
    } catch (e) {
      s.error = e.message;
      s.status = 'error';
    }
    _renderResultGrid();
  };

  // ─── 학생 상세 화면 ───
  window._ssOpenStudentDetail = function (idx) {
    const s = _state.students?.[idx];
    if (!s || s.status !== 'done') return;
    if (_state.phase !== 'student-detail') _ssPush();    // 상세 → 이전/다음 이동은 같은 칸
    _state.detailIdx = idx;
    _state.phase = 'student-detail';
    _setHeader(`📊 ScoreSnap · ${esc(s.result.studentName || `학생 #${idx + 1}`)}`);
    const body = document.getElementById('ssBody');
    if (!body) return;
    body.innerHTML = `
      <div style="padding:12px 18px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-shrink:0;">
        <button onclick="window._ssUiBack()" style="background:transparent;color:#bbb;border:1px solid #444;padding:7px 14px;border-radius:6px;font-size:12px;cursor:pointer;">← 목록</button>
        <div style="font-size:11px;color:#888;">#${idx + 1} / ${_state.students.length}</div>
      </div>
      <div id="ssDetailRoot" style="flex:1;overflow-y:auto;background:#0a0a0a;padding:16px;">
        <div id="ssDetailCard" style="background:#fff;color:#222;max-width:680px;margin:0 auto;padding:24px 28px;border-radius:10px;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;">
          ${_buildStudentDetailHtml(s, idx)}
        </div>
      </div>
      <div style="padding:10px 12px;border-top:1px solid #333;display:flex;flex-direction:column;gap:8px;flex-shrink:0;">
        <div style="display:flex;gap:6px;">
          <button onclick="window._ssDownloadStudentPng(${idx})" style="flex:1;background:var(--c-brand,#E8714A);color:#fff;border:none;padding:10px 6px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">📥 PNG</button>
          ${(s.image?.dataUrl || s.imagePath) ? `<button onclick="window._ssViewStudentImage(${idx})" style="flex:1;background:rgba(255,255,255,0.12);color:#fff;border:1px solid #666;padding:10px 6px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">📷 사진</button>
          <button onclick="window._ssShowMarkedPhoto(${idx})" title="틀린 문항에 V 표시 + 점수를 넣은 답안지 사진" style="flex:1;background:#c62828;color:#fff;border:none;padding:10px 6px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">✔ 마킹</button>` : ''}
          <button onclick="window._ssCopyStudentImage(${idx})" title="이미지를 복사해서 카카오톡 대화창에 Ctrl+V 로 붙여넣기" style="flex:1.4;background:#fee500;color:#191919;border:none;padding:10px 6px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">📋 복사 (카톡)</button>
        </div>
        <div style="display:flex;gap:6px;">
          ${idx > 0 ? `<button onclick="window._ssOpenStudentDetail(${idx - 1})" style="flex:1;background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:10px 6px;border-radius:8px;font-size:13px;cursor:pointer;white-space:nowrap;">← 이전</button>` : ''}
          ${idx < _state.students.length - 1 ? `<button onclick="window._ssOpenStudentDetail(${idx + 1})" style="flex:1;background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:10px 6px;border-radius:8px;font-size:13px;cursor:pointer;white-space:nowrap;">다음 →</button>` : ''}
        </div>
      </div>
    `;
  };

  function _buildStudentDetailHtml(s, idx) {
    const r = s.result || {};
    const total = r.totalQuestions || 0;
    const correct = r.correctCount || 0;
    const pct = r.scorePercent || 0;
    const wrongNos = r.wrongNumbers || [];
    const uncertain = new Set(r.uncertainQuestions || []);
    const dateStr = _fmtDate(new Date());

    // 전체 문항 — ✓/✗ 자체가 토글 버튼 (학원장 직접 수정)
    const _rowHtml = (a, showConf) => `
      <div style="display:grid;grid-template-columns:34px 30px 1fr;gap:8px;padding:8px;border-bottom:1px solid #eee;font-size:12px;align-items:start;">
        <span style="color:#888;font-weight:700;line-height:24px;">Q${a.no}</span>
        <button onclick="window._ssToggleAnswer(${idx}, ${a.no}, ${!a.isCorrect})"
          title="클릭 → ${a.isCorrect ? '오답' : '정답'}으로 변경"
          style="width:30px;height:24px;border:1px solid ${a.isCorrect ? '#2e7d32' : '#c62828'};background:${a.isCorrect ? '#e8f5e9' : '#ffebee'};color:${a.isCorrect ? '#2e7d32' : '#c62828'};border-radius:4px;cursor:pointer;font-weight:700;font-size:13px;padding:0;line-height:1;">${a.isCorrect ? '✓' : '✗'}</button>
        <div style="min-width:0;line-height:1.5;">
          <div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;">
            <span style="color:#111;font-weight:700;font-size:13px;word-break:break-word;">${esc(a.stem || '')}</span>
            ${showConf ? `<span title="AI 판정 확신도" style="color:#e65100;font-size:10px;">확신 ${Math.round((a.confidence || 0) * 100)}%</span>` : ''}
            ${a._adminOverride ? '<span style="color:#1976d2;font-size:10px;">수정</span>' : ''}
          </div>
          <div style="color:#333;word-break:break-word;">${esc(a.studentAnswer || '(빈칸)')} <span style="color:#888;font-size:11px;">→ ${esc(a.correctAnswer || '?')}</span></div>
        </div>
      </div>
    `;
    // 틀린 문항 → 검토(맞게 채점됐지만 애매) → 맞은 문항 순으로 모아 빨리 검토할 수 있게. 각 그룹 안은 번호순
    const _all = r.answers || [];
    const _wrongAns = _all.filter(a => !a.isCorrect);
    const _reviewAns = _all.filter(a => a.isCorrect && uncertain.has(a.no));
    const _rightAns = _all.filter(a => a.isCorrect && !uncertain.has(a.no));
    const _wrongUncertain = _wrongAns.filter(a => uncertain.has(a.no)).length;   // 틀렸지만 AI 확신이 낮은 문항
    const _grpHead = (label, color, bg) =>
      `<div style="padding:6px 8px;font-size:12px;font-weight:700;color:${color};background:${bg};border-bottom:1px solid #eee;">${label}</div>`;
    const allRows =
      (_wrongAns.length ? _grpHead(`✗ 틀린 문항 ${_wrongAns.length}개` + (_wrongUncertain ? ` · 그중 판정이 애매한 ${_wrongUncertain}개는 확신도 표시` : ''), '#c62828', '#ffebee') + _wrongAns.map(a => _rowHtml(a, uncertain.has(a.no))).join('') : '') +
      (_reviewAns.length ? _grpHead(`⚠ 검토 필요 ${_reviewAns.length}개 — 맞게 채점했지만 애매해요`, '#e65100', '#fff8e1') + _reviewAns.map(a => _rowHtml(a, true)).join('') : '') +
      (_rightAns.length ? `<details ${_state.rightOpen ? 'open' : ''} ontoggle="window._ssRightOpen(this.open)"><summary style="padding:8px;font-size:12px;font-weight:700;color:#2e7d32;background:#e8f5e9;border-bottom:1px solid #eee;cursor:pointer;">✓ 맞은 문항 ${_rightAns.length}개 <span style="font-weight:400;color:#689f38;">— 눌러서 펼치기</span></summary>` + _rightAns.map(a => _rowHtml(a, false)).join('') + '</details>' : '');
    const _nOverride = _all.filter(a => a._adminOverride).length;

    return `
      <div style="margin-bottom:14px;border-bottom:2px solid #333;padding-bottom:12px;">
        <div style="font-size:11px;color:#888;">${esc(window.MY_ACADEMY_NAME || '')}</div>
        <div style="font-size:17px;font-weight:800;color:#111;margin-top:2px;line-height:1.4;word-break:keep-all;">${esc(_testNameOf(r))}</div>
        <div style="font-size:11px;color:#555;margin-top:4px;">총 ${total}문항 · 채점일 ${esc(dateStr)}</div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:10px;padding:8px 12px;border:1px solid #999;border-radius:6px;background:#fff;">
          <span style="font-size:13px;color:#555;font-weight:600;flex-shrink:0;">학생:</span>
          <input id="ssDetailNameIn" type="text" value="${esc(r.studentName || '')}"
            placeholder="이름 직접 입력"
            oninput="window._ssEditStudentName(${idx}, this.value)"
            style="flex:1;min-width:0;padding:4px 8px;border:1px solid #ccc;border-radius:4px;font-size:14px;font-family:inherit;font-weight:600;">
        </div>
      </div>

      <div style="display:flex;gap:14px;margin-bottom:18px;flex-wrap:wrap;">
        <div style="flex:1;min-width:140px;background:#e8f5e9;border-left:4px solid #2e7d32;padding:12px 16px;border-radius:6px;">
          <div style="font-size:11px;color:#666;">점수</div>
          <div style="font-size:26px;font-weight:800;color:#2e7d32;line-height:1.1;margin-top:4px;">${correct} / ${total} <span style="font-size:14px;color:#777;">(${pct}점)</span></div>
        </div>
        <div style="flex:2;min-width:200px;background:#fff3e0;border-left:4px solid #e65100;padding:12px 16px;border-radius:6px;">
          <div style="font-size:11px;color:#666;">틀린 문항</div>
          <div style="font-size:15px;font-weight:700;color:#bf360c;line-height:1.4;margin-top:4px;">${wrongNos.length ? wrongNos.join(', ') : '없음 (만점!)'}</div>
        </div>
      </div>

      <details style="margin-bottom:6px;" open>
        <summary style="font-size:13px;font-weight:700;color:#333;cursor:pointer;padding:6px 0;">📋 전체 문항 (${total}개) <span style="font-weight:400;color:#888;font-size:11px;">— ✓/✗ 클릭하여 직접 수정 가능</span></summary>
        ${_nOverride ? `<div style="margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#e3f2fd;border-radius:6px;font-size:12px;color:#1565c0;"><span>직접 수정한 문항 ${_nOverride}개</span><button onclick="window._ssResetOverrides(${idx})" style="background:#1976d2;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">↩ AI 채점으로 되돌리기</button></div>` : ''}
        <div style="margin-top:8px;border:1px solid #eee;border-radius:6px;overflow:hidden;">
          ${allRows}
        </div>
      </details>
    `;
  }

  function _fmtDate(d) {
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }

  window._ssCloseStudentDetail = function () {
    _state.detailIdx = null;
    _renderResultGrid();
  };

  window._ssRightOpen = function (open) { _state.rightOpen = !!open; };

  // 직접 수정한 ✓/✗ 를 전부 AI 채점 결과로 되돌림
  window._ssResetOverrides = function (idx) {
    const s = _state.students?.[idx];
    if (!s?.result || !Array.isArray(s.result.answers)) return;
    s.result.answers.forEach(a => {
      if (a._adminOverride && typeof a._aiIsCorrect === 'boolean') {
        a.isCorrect = a._aiIsCorrect;
        a._adminOverride = false;
      }
    });
    s.result.correctCount = s.result.answers.filter(x => x.isCorrect).length;
    s.result.scorePercent = s.result.totalQuestions > 0
      ? Math.round((s.result.correctCount / s.result.totalQuestions) * 100) : 0;
    s.result.wrongNumbers = s.result.answers.filter(x => !x.isCorrect).map(x => x.no);
    const nameIn = document.getElementById('ssDetailNameIn');
    if (nameIn) s.result.studentName = nameIn.value || '';
    _saveSession();
    _markDirty(idx);
    const card = document.getElementById('ssDetailCard');
    if (card) card.innerHTML = _buildStudentDetailHtml(s, idx);
  };

  window._ssBackToStudentCapture = function () {
    _renderStudentCapture();
    _ssPush();
  };

  // 학생 이름 직접 수정 — 자동 localStorage 저장
  window._ssEditStudentName = function (idx, val) {
    const s = _state.students?.[idx];
    if (!s?.result) return;
    s.result.studentName = String(val || '').trim();
    _saveSession();
    _markDirty(idx);
  };

  // 학원장 정답 토글 — 자동 localStorage 저장
  window._ssToggleAnswer = function (idx, no, makeCorrect) {
    const s = _state.students?.[idx];
    if (!s?.result || !Array.isArray(s.result.answers)) return;
    const a = s.result.answers.find(x => x.no === no);
    if (!a) return;
    a.isCorrect = makeCorrect === true;
    // AI 원본과 같으면 수정 마커 제거 (원상태 복귀)
    if (typeof a._aiIsCorrect === 'boolean') {
      a._adminOverride = (a.isCorrect !== a._aiIsCorrect);
    } else {
      // 옛 데이터 (복원 등) — _aiIsCorrect 없으면 무조건 수정으로 처리
      a._adminOverride = true;
    }
    s.result.correctCount = s.result.answers.filter(x => x.isCorrect).length;
    s.result.scorePercent = s.result.totalQuestions > 0
      ? Math.round((s.result.correctCount / s.result.totalQuestions) * 100) : 0;
    s.result.wrongNumbers = s.result.answers.filter(x => !x.isCorrect).map(x => x.no);
    // 이름 input 보존
    const nameIn = document.getElementById('ssDetailNameIn');
    if (nameIn) s.result.studentName = nameIn.value || '';
    _saveSession();
    _markDirty(idx);
    // 카드만 재렌더
    const card = document.getElementById('ssDetailCard');
    if (card) card.innerHTML = _buildStudentDetailHtml(s, idx);
  };

  // ─── localStorage 임시 보관 (새로고침까지 유지) ───
  // image 는 너무 커서 제외 — result 메타만 저장. 복원 시 PNG 다운로드·정답 수정은 가능, 재채점은 불가.
  const SS_LS_KEY = 'scoresnap_session_v1';
  const SS_LS_MAX_AGE = 24 * 60 * 60 * 1000;  // 24 시간

  function _saveSession() {
    try {
      if (!_state.answerKey?.questions?.length) {
        localStorage.removeItem(SS_LS_KEY);
        return;
      }
      const list = (_state.students || []).filter(s => s.status === 'done');
      if (list.length === 0) {
        // 학생 결과 없으면 저장 의미 없음 (정답지만 있는 상태)
        localStorage.removeItem(SS_LS_KEY);
        return;
      }
      const data = {
        savedAt: Date.now(),
        academyName: window.MY_ACADEMY_NAME || '',
        answerKey: _state.answerKey,
        students: list.map(s => ({ status: 'done', result: s.result })),
      };
      localStorage.setItem(SS_LS_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[scoresnap] localStorage 저장 실패:', e.message);
    }
  }

  function _loadSession() {
    try {
      const raw = localStorage.getItem(SS_LS_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data?.answerKey?.questions?.length || !data?.students?.length) return null;
      if (Date.now() - (data.savedAt || 0) > SS_LS_MAX_AGE) {
        localStorage.removeItem(SS_LS_KEY);
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  function _clearSession() {
    try { localStorage.removeItem(SS_LS_KEY); } catch (_) {}
  }

  // _renderResultGrid 진입 시 자동 저장 (학원장 수정·이름 수정도 같은 함수 호출)

  // ─── PNG 다운로드 (html2canvas 동적 로드) ───
  let _html2canvasLoading = null;
  function _ensureHtml2Canvas() {
    if (typeof window.html2canvas === 'function') return Promise.resolve();
    if (_html2canvasLoading) return _html2canvasLoading;
    _html2canvasLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { _html2canvasLoading = null; reject(new Error('html2canvas 로드 실패')); };
      document.head.appendChild(s);
    });
    return _html2canvasLoading;
  }

  // 상세 카드 → canvas (다운로드·복사 공용). 이름 input 현재값을 캡처에 반영
  async function _ssCaptureStudentCanvas(idx) {
    const card = document.getElementById('ssDetailCard');
    const s = _state.students?.[idx];
    if (!card || !s?.result) throw new Error('캡처할 화면이 없어요');
    const nameIn = document.getElementById('ssDetailNameIn');
    if (nameIn) {
      s.result.studentName = nameIn.value || '';
      nameIn.setAttribute('value', nameIn.value || '');
    }
    await _ensureHtml2Canvas();
    return window.html2canvas(card, { backgroundColor: '#ffffff', scale: 2, logging: false, useCORS: true });
  }

  window._ssDownloadStudentPng = async function (idx) {
    const s = _state.students?.[idx];
    if (!s?.result) return;
    try {
      const canvas = await _ssCaptureStudentCanvas(idx);
      canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const safe = v => String(v).replace(/[\\/:*?"<>|]/g, '_');
        const name = safe(s.result.studentName || `student_${idx + 1}`);
        const title = safe(_testNameOf(s.result) || 'test');
        const date = _fmtDate(new Date()).replace(/[: ]/g, '_');
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}_${title}_${date}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    } catch (e) {
      if (typeof window.showAlert === 'function') window.showAlert('PNG 생성 실패', e.message);
    }
  };

  // 이미지를 클립보드에 복사 → 카톡 PC 대화창에서 Ctrl+V. 클릭(사용자 동작) 안에서 write 를 바로 호출하고
  // 이미지 생성은 Promise 로 넘긴다(생성이 오래 걸려도 사용자 동작 인정 유지).
  window._ssCopyStudentImage = async function (idx) {
    const toast = (m) => _ssToast(m);
    if (!navigator.clipboard || typeof window.ClipboardItem !== 'function') {
      toast('이 브라우저는 이미지 복사를 지원하지 않아요 — PNG 다운로드를 사용하세요');
      return;
    }
    const blobPromise = (async () => {
      const canvas = await _ssCaptureStudentCanvas(idx);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('이미지 생성 실패');
      return blob;
    })();
    try {
      toast('이미지 복사 중...');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
      toast('✅ 복사됨 — 카카오톡 대화창에서 Ctrl+V 로 붙여넣으세요');
    } catch (e) {
      console.warn('[scoresnap] 이미지 복사 실패:', e && e.message);
      toast('복사에 실패했어요 — PNG 다운로드를 사용하세요');
    }
  };

  // ─── 카메라 자원 해제 (T7-B/C 에서 재사용) ───
  function _releaseCamera() {
    if (_scanRaf) cancelAnimationFrame(_scanRaf);
    _scanRaf = 0;
    if (_stream) {
      _stream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
      _stream = null;
    }
  }

  // ─── 이미지 처리 헬퍼 (T4 — T7-B/C 에서 재사용) ───
  // file → max-size JPEG 0.85 → { dataUrl, base64, mimeType, sizeKB, width, height }
  // opts.precision=true → 2048px (정밀 모드, OCR 인식률 ↑), 기본 1536px
  window._ssProcessImage = async function (file, opts = {}) {
    if (!/^image\//.test(file.type) && file.type !== '') {
      throw new Error('이미지 파일만 가능해요');
    }
    const imgUrl = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('이미지 로드 실패 (지원하지 않는 형식일 수 있어요)'));
      i.src = imgUrl;
    });
    const maxSide = opts.precision ? 2048 : 1536;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(imgUrl);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('JPEG 변환 실패');

    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('FileReader 실패'));
      r.readAsDataURL(blob);
    });
    const base64 = String(dataUrl).split(',')[1] || '';
    return {
      dataUrl, base64,
      mimeType: 'image/jpeg',
      sizeKB: Math.round(blob.size / 1024),
      width: canvas.width,
      height: canvas.height,
    };
  };

  // 모듈 state 외부 접근 (T7-D 결과 화면에서 student name 등 set 용)
  Object.defineProperty(window, '_ssState', { get: () => _state });

  // _renderResultScreen / PNG 다운로드 / 학원장 토글 — T7-D 에서 다시 정의
})();
