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

  // ─── 디자인 기준: 아이콘 + 공용 UI 조각 (스타일은 ss.css 의 .ss-* 클래스) ───
  // 이모지 대신 stroke SVG (Lucide 풍, viewBox 24, stroke-width 2, currentColor)
  const _SS_ICONS = {
    'camera': '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    'image': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-up': '<path d="m18 15-6-6-6 6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'minus': '<path d="M5 12h14"/>',
    'more': '<circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/><circle cx="5" cy="12" r="1.2"/>',
    'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'check': '<path d="M20 6 9 17l-5-5"/>',
    'refresh': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    'share': '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>',
    'pen': '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    'maximize': '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    'monitor': '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    'file-check': '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/>',
    'list': '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
    'trash': '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
    'alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  };
  function iconSvg(name, cls) {
    return `<svg class="ss-ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${_SS_ICONS[name] || ''}</svg>`;
  }
  // 점수 색: 80점 이상 초록, 60~79 노랑, 60 미만 빨강
  function _uiScoreTone(pct) { return pct >= 80 ? 'ok' : pct >= 60 ? 'warn' : 'bad'; }
  // 버튼. kind: 'primary' | 'danger' | '' · size: 'lg' | 'sm' · data: { key: value } → data-key (사용자 문자열은 여기에 넣고 esc 처리됨)
  function uiBtn(o) {
    const cls = ['ss-btn', o.kind ? 'ss-btn--' + o.kind : '', o.size ? 'ss-btn--' + o.size : '', o.block ? 'ss-btn--block' : ''].filter(Boolean).join(' ');
    const data = Object.keys(o.data || {}).map(k => ` data-${k}="${esc(o.data[k])}"`).join('');
    return `<button class="${cls}"${o.id ? ` id="${o.id}"` : ''}${o.onclick ? ` onclick="${o.onclick}"` : ''}${o.disabled ? ' disabled' : ''}${data}>${o.icon ? iconSvg(o.icon, 'ss-ic--sm') : ''}${o.label ? `<span>${esc(o.label)}</span>` : ''}</button>`;
  }
  function uiIconBtn(icon, label, o) {
    o = o || {};
    const data = Object.keys(o.data || {}).map(k => ` data-${k}="${esc(o.data[k])}"`).join('');
    return `<button class="ss-iconbtn${o.box ? ' ss-iconbtn--box' : ''}" aria-label="${esc(label)}"${o.id ? ` id="${o.id}"` : ''}${o.onclick ? ` onclick="${o.onclick}"` : ''}${o.disabled ? ' disabled' : ''}${data}>${iconSvg(icon)}</button>`;
  }
  function uiChip(text, tone) { return `<span class="ss-chip${tone ? ' ss-chip--' + tone : ''}">${esc(text)}</span>`; }
  // 탭. items: [{ id, label, tone?: 'bad'|'warn'|'ok', on? }]  → 클릭은 호출한 쪽이 .ss-tab[data-tab] 로 처리
  function uiTabs(items) {
    return `<div class="ss-tabs">${items.map(t => `<button class="ss-tab${t.on ? ' ss-tab--on' : ''}"${t.tone ? ` data-tone="${t.tone}"` : ''} data-tab="${esc(t.id)}">${esc(t.label)}</button>`).join('')}</div>`;
  }
  // 하단 고정 액션바. 주 동작 1개(+보조 1~2개) — 인자는 uiBtn 으로 만든 html
  function uiActionBar(primaryHtml, secondaryHtml) { return `<div class="ss-actionbar">${secondaryHtml || ''}${primaryHtml || ''}</div>`; }
  // 단계 막대. step: 1(정답지) 2(답안지) 3(결과)
  function uiSteps(step) {
    return `<div class="ss-steps">${['정답지', '답안지', '결과'].map((l, i) => `<div class="ss-steps__item${i + 1 === step ? ' ss-steps__item--on' : i + 1 < step ? ' ss-steps__item--done' : ''}">${i + 1} ${l}</div>`).join('')}</div>`;
  }
  // 화면 상단 흰 헤더. o: { title, sub, back: 'onclick 문자열', right: html }
  function uiHeader(o) {
    return `<header class="ss-header">${o.back ? uiIconBtn('chevron-left', '뒤로', { onclick: o.back }) : ''}<div class="ss-header__title">${esc(o.title)}${o.sub ? `<div class="ss-header__sub">${esc(o.sub)}</div>` : ''}</div>${o.right || ''}</header>`;
  }
  window._ssUi = { iconSvg, uiBtn, uiIconBtn, uiChip, uiTabs, uiActionBar, uiSteps, uiHeader, scoreTone: _uiScoreTone };

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

  // ───────────────────────────────────────────────────────────────────────────
  // 2단계 · 폰 흐름 화면 (docs/scoresnap-ss-redesign.md 3장)
  //   홈(채점 기록) → 정답지 촬영 → 정답지 검토 → 답안지 추가+진행 → 결과 목록 → 학생 상세 → 마킹 사진 보기
  // 채점은 학원 PC(worker)가 서버 대기열에서 한 장씩 처리한다. 화면은 서버 학생 기록을 실시간으로 보여줄 뿐이라
  // 화면을 닫아도 채점은 계속된다.
  // ───────────────────────────────────────────────────────────────────────────

  Object.assign(_SS_ICONS, {
    'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'eye': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    'edit': '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    'undo': '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  });

  const _body = () => document.getElementById('ssBody');
  const _store = () => window._ssStore;

  // ─── 작은 도구들 ───
  const _fmtAgo = (ms) => {
    if (!ms) return '';
    const m = Math.max(1, Math.round((Date.now() - ms) / 60000));
    if (m < 60) return `${m}분 전`;
    if (m < 1440) return `${Math.round(m / 60)}시간 전`;
    return `${Math.round(m / 1440)}일 전`;
  };
  const _pctOf = (r) => (r && r.totalQuestions > 0) ? Math.round((r.correctCount / r.totalQuestions) * 100) : 0;
  const _isUncertain = (r) => !!(r && !r.checked && (r.uncertainQuestions || []).length);   // 확인 완료한 학생은 제외
  const _hasMark = (s) => !!(s && (s.markPath || s._markCache));
  const _noName = (r) => !String((r && r.studentName) || '').trim();
  const _needsCheck = (s) => !!(s && s.status === 'done' && s.result && (_isUncertain(s.result) || _noName(s.result)));
  const _tone = (pct) => 'ss-tone-' + _uiScoreTone(pct);

  // 화면 토스트 (오버레이 위에서 보이도록 z-index 높게)
  let _ssToastEl = null, _ssToastTimer = 0;
  function _ssToast(msg) {
    if (!_ssToastEl) {
      _ssToastEl = document.createElement('div');
      _ssToastEl.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);max-width:88vw;background:rgba(48,49,52,0.96);color:#fff;padding:12px 18px;border-radius:12px;font-size:14px;z-index:100003;box-shadow:0 4px 16px rgba(0,0,0,0.3);text-align:center;pointer-events:none;';
      document.body.appendChild(_ssToastEl);
    }
    _ssToastEl.textContent = String(msg || '').replace(/[\p{Extended_Pictographic}️]/gu, '').trim();
    _ssToastEl.style.display = 'block';
    clearTimeout(_ssToastTimer);
    _ssToastTimer = setTimeout(() => { if (_ssToastEl) _ssToastEl.style.display = 'none'; }, 3500);
  }

  // PC 채점 프로그램 상태 칩 — 6단계(heartbeat)에서 window._ssWorker 를 채운다. 없으면 표시하지 않음
  function _pcChipHtml() {
    const w = window._ssWorker;
    if (!w) return '';
    return `<span class="ss-status" style="color:${w.online ? 'var(--ok)' : 'var(--sub)'}"><i class="ss-dot${w.online ? ' ss-dot--ok' : ''}"></i>PC ${w.online ? '켜짐' : '꺼짐'}</span>`;
  }
  function _pcCardHtml() {
    const w = window._ssWorker;
    if (!w) return '';
    return `<div class="ss-pccard"><i class="ss-dot${w.online ? ' ss-dot--ok' : ''}"></i><div class="ss-grow"><b>PC 채점 프로그램 ${w.online ? '켜짐' : '꺼져 있어요'}</b><small>${w.online ? esc((w.name || 'PC') + ' · ' + (w.ago || '방금') + ' 확인 · ' + (w.queued ? `대기 ${w.queued}건` : '대기 작업 없음')) : '학원 PC에서 start.bat 을 실행해 주세요'}</small></div>${iconSvg('monitor')}</div>`;
  }
  window._ssSetWorkerStatus = function (st) {
    window._ssWorker = st;
    document.querySelectorAll('[data-ss-pcchip]').forEach(n => { n.innerHTML = _pcChipHtml(); });
    const c = document.getElementById('ssPcCard'); if (c) c.innerHTML = _pcCardHtml();
  };

  // 스크롤 위치를 지키며 다시 그리기
  function _keepScroll(fn) {
    const el = document.getElementById('ssScroll');
    const top = el ? el.scrollTop : 0;
    fn();
    const el2 = document.getElementById('ssScroll');
    if (el2 && top) el2.scrollTop = top;
  }

  // 메뉴(⋯): 폰은 아래에서 올라오는 시트, PC 는 누른 버튼 옆에 뜨는 작은 메뉴
  let _ssLastBtn = null;
  document.addEventListener('click', (e) => { _ssLastBtn = e.target.closest('button') || null; }, true);
  function _ssSheet(items, title) {
    const sc = document.createElement('div');
    const pcMenu = window.innerWidth >= 1024 && _ssLastBtn && document.body.contains(_ssLastBtn);
    sc.className = 'ss-scrim' + (pcMenu ? ' ss-scrim--pc' : '');
    sc.setAttribute('data-ss-sub', '1');
    sc.innerHTML = `<div class="ss-sheet${pcMenu ? ' ss-sheet--pop' : ''}">${title ? `<div class="ss-sheet__title">${esc(title)}</div>` : ''}${items.map((it, i) =>
      `<button class="ss-sheet__item${it.danger ? ' ss-sheet__item--danger' : ''}" data-i="${i}">${it.icon ? iconSvg(it.icon) : ''}<span>${esc(it.label)}</span></button>`).join('')}</div>`;
    sc._ssCancel = () => sc.remove();
    sc.onclick = (e) => {
      if (e.target === sc) return _ssSubRemove(sc);
      const b = e.target.closest('[data-i]'); if (!b) return;
      _ssSubRemove(sc);
      const fn = items[+b.dataset.i].fn;
      setTimeout(fn, 160);                       // 뒤로가기 기록 정리가 끝난 뒤 실행 (기록이 꼬이지 않게)
    };
    document.body.appendChild(sc);
    if (pcMenu) {
      const r = _ssLastBtn.getBoundingClientRect(), box = sc.firstElementChild, w = 270;
      box.style.width = w + 'px';
      const h = box.offsetHeight;
      box.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
      box.style.top = (r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    }
    _ssPushSub(sc);
  }

  function _pickFiles(opt, cb) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    if (opt.multiple) inp.multiple = true;
    if (opt.capture) inp.setAttribute('capture', 'environment');
    document.body.appendChild(inp);
    inp.onchange = () => { const fs = [...inp.files]; inp.remove(); if (fs.length) cb(fs); };
    inp.click();
    setTimeout(() => { try { inp.remove(); } catch (_) {} }, 180000);
  }

  // ─── 진입·바깥틀 ───
  // PC 채점 프로그램 상태 — worker 가 30초마다 갱신, 2분 넘게 없으면 꺼짐으로 본다
  let _workerRows = [], _workerTimer = 0, _workerUnsub = null;
  function _computeWorker() {
    const now = Date.now();
    const rows = _workerRows.map(w => ({ w, ms: w.lastSeen && w.lastSeen.toMillis ? w.lastSeen.toMillis() : now })).sort((a, b) => b.ms - a.ms);
    const best = rows[0];
    if (!best) return window._ssSetWorkerStatus({ online: false, name: '', ago: '', queued: 0, none: true });
    const online = now - best.ms < 120000;
    const sec = Math.round((now - best.ms) / 1000);
    window._ssSetWorkerStatus({ online, name: best.w.workerName || 'PC', ago: sec < 60 ? '방금' : `${Math.round(sec / 60)}분 전`, queued: best.w.queued || 0, busy: !!best.w.busy });
    if (_state.phase === 'student-capture') _keepScroll(_renderStudentCapture);
  }
  function _startWorkerWatch() {
    if (_workerUnsub || !_store() || !_store().watchWorkers) return;
    _workerUnsub = _store().watchWorkers((rows) => { _workerRows = rows; _computeWorker(); });
    _workerTimer = setInterval(_computeWorker, 20000);
  }
  function _stopWorkerWatch() { if (_workerUnsub) { try { _workerUnsub(); } catch (_) {} _workerUnsub = null; } clearInterval(_workerTimer); window._ssWorker = null; }

  // 기록 바로 열기 (/ss/?sid=xxx — QR)
  window._ssOpenBySid = function (sid) { return _ssOpenServerSession(sid, {}); };

  window.openScoreSnap = async function () {
    _startWorkerWatch();
    _state = { phase: 'init', answerKey: null, students: [], layoutHint: 'numbered', precision: false, batchIds: new Set() };
    _renderOverlay();
    await _renderHome();
  };

  function _renderOverlay() {
    if (document.getElementById('scoreSnapOverlay')) return;
    const ov = document.createElement('div');
    ov.id = 'scoreSnapOverlay';
    ov.className = 'ss-overlay';
    ov.innerHTML = `<header class="ss-pc__top ss-pc__top--g" id="ssTop"><b>ScoreSnap</b><span>${esc(window.MY_ACADEMY_NAME || '')}</span><span class="ss-grow"></span><span data-ss-pcchip>${_pcChipHtml()}</span><button class="ss-helpbtn" onclick="window._ssOpenHelp()">질문 · 도움말</button><button class="ss-btn ss-btn--sm" id="ssPcLogout">로그아웃</button></header>` +
      '<div id="ssBody" class="ss-body"></div><button class="ss-fab" id="ssFab" aria-label="질문" onclick="window._ssOpenHelp()">' + iconSvg('alert') + '<span>질문</span></button>';
    document.body.appendChild(ov);
    document.getElementById('ssPcLogout').onclick = () => window.dispatchEvent(new Event('ss-logout'));
    _ssPush();
  }

  function closeScoreSnap() {
    _stopWatch();
    _stopWorkerWatch();
    _ssPopAll();
    _releaseCamera();
    document.querySelectorAll('[data-ss-sub]').forEach(n => n.remove());
    document.getElementById('scoreSnapOverlay')?.remove();
    _state = {};
  }
  window.closeScoreSnap = closeScoreSnap;

  // ─── 폰 하단 [뒤로가기] = 앱 종료가 아니라 ScoreSnap 안에서 한 단계 앞으로 ───
  // 화면이 한 단계 깊어질 때마다(클릭 안에서) history 를 한 칸 쌓고, 뒤로가기는 한 칸씩 되돌린다.
  // (뒤로가기 처리 중 다시 쌓으면 브라우저가 '사용자 동작 없이 쌓은 기록'으로 보고 건너뛰어 앱이 종료됨)
  let _ssDepth = 0, _ssIgnorePop = 0;
  function _ssPush() {
    if (!document.getElementById('scoreSnapOverlay')) return;
    try { history.pushState({ ss: _ssDepth + 1 }, ''); _ssDepth++; } catch (_) {}
  }
  function _ssPopAll() {
    if (_ssDepth <= 0) return;
    const n = _ssDepth; _ssDepth = 0; _ssIgnorePop++;
    try { history.go(-n); } catch (_) { _ssIgnorePop--; }
  }
  // 보조 창(사진 보기·마킹 사진·메뉴): 열 때 한 칸, 화면 안 버튼으로 닫을 때는 그 칸을 조용히 반납
  function _ssPushSub(ov) { const before = _ssDepth; _ssPush(); ov._ssPushed = _ssDepth > before; }
  function _ssSubRemove(ov) {
    ov.remove();
    if (ov._ssPushed) { ov._ssPushed = false; _ssDepth = Math.max(0, _ssDepth - 1); _ssIgnorePop++; try { history.back(); } catch (_) { _ssIgnorePop--; } }
  }
  // 화면 안 [‹] 버튼 — 폰 뒤로가기와 같은 길로
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
      case 'student-detail': _renderResultGrid(); break;
      case 'result-grid': _renderHome(); break;
      case 'student-capture':
        if ((_state.students || []).some(x => x.status === 'done')) _renderResultGrid(); else _renderHome();
        break;
      case 'pc': _ssPush(); break;
      case 'answerKey-ocr': _ssPush(); break;                              // 읽는 중에는 그대로 (취소 링크 사용)
      case 'answerKey-review': if (_state._editKey) { _cancelKeyEdit(); break; } _renderAnswerKeyCapture(); break;
      case 'answerKey-capture':
        if (_ssCancelReKey()) break;
        _renderHome(); break;
      default: closeScoreSnap();
    }
  }
  window.addEventListener('popstate', (ev) => {
    if (_ssIgnorePop > 0) { _ssIgnorePop--; ev._ssHandled = true; return; }
    if (!document.getElementById('scoreSnapOverlay')) return;
    ev._ssHandled = true;
    _ssDepth = Math.max(0, _ssDepth - 1);
    if (_ssDepth === 0) { closeScoreSnap(); return; }     // 첫 칸까지 소진 → ScoreSnap 종료
    _ssGoBack();
  });

  // ─── 서버 학생 기록 실시간 연동 ───
  function _stopWatch() {
    if (_state && _state._unwatch) { try { _state._unwatch(); } catch (_) {} _state._unwatch = null; }
  }
  function _startWatch(sid) {
    _stopWatch();
    const st = _store();
    if (!st || !st.watchStudents) return;
    _state._unwatch = st.watchStudents(sid, (list) => { if (_state.sid === sid) _mergeStudents(list); },
      (e) => console.warn('[scoresnap] 실시간 연결 실패:', e && e.message));
  }
  function _fromServer(x, old) {
    old = old || {};
    return {
      ...old,
      docId: x.docId, idx: x.idx, imagePath: x.imagePath || old.imagePath || '',
      status: x.status || (x.result ? 'done' : 'queued'),
      result: old._dirty ? old.result : (x.result || null),
      error: x.error || '', gradeMs: x.gradeMs || 0,
      markPath: x.markPath || '', markKey: x.markKey || '', markMissing: x.markMissing || 0,
      kakaoSentAt: x.kakaoSentAt ? (old.kakaoSentAt && !x.kakaoSentAt.toMillis ? old.kakaoSentAt : (x.kakaoSentAt.toMillis ? x.kakaoSentAt.toMillis() : Date.now())) : 0,
    };
  }
  function _mergeStudents(list) {
    const prev = new Map((_state.students || []).map(s => [s.docId, s]));
    const out = list.map(sv => _fromServer(sv, prev.get(sv.docId)));
    prev.forEach(o => { if ((o.status === 'uploading' || o._uploadFail) && !list.some(s => s.docId === o.docId)) out.push(o); });
    _state.students = out.sort((a, b) => (a.idx || 0) - (b.idx || 0));
    _onStudentsChanged();
  }
  function _onStudentsChanged() {
    if (_state.phase === 'student-capture') _keepScroll(_renderStudentCapture);
    else if (_state.phase === 'result-grid') _keepScroll(_renderResultGrid);
    else if (_state.phase === 'pc') { _pcRenderStudents(); const cur = _state.students && _state.students[_state.detailIdx]; if (!cur || cur.status !== 'done') _pcRenderDetail(); }
  }

  // 정답지 확정 직후 세션이 아직 만들어지는 중이면 기다린다
  async function _ensureSession() {
    if (_state.sid) return _state.sid;
    if (_state._sidPromise) { try { await _state._sidPromise; } catch (_) {} }
    return _state.sid || null;
  }

  // ─── 3-1. 홈 (채점 기록) ───
  async function _renderHome() {
    _stopWatch();
    _state.phase = 'home'; _state.sid = null; _state.students = []; _state.answerKey = null;
    const body = _body(); if (!body) return;
    if (_isPc()) { _state.detailIdx = -1; _renderPc(); _pcLoadSessions(true); return; }
    body.innerHTML = `
      <div class="ss-brandwrap"><div class="ss-col">
        <div class="ss-brandwrap__row">
          <div class="ss-grow"><div class="ss-brandbar__title">ScoreSnap</div><div class="ss-brandbar__sub">${esc(window.MY_ACADEMY_NAME || '')}${window.MY_ACADEMY_NAME ? ' · ' : ''}학원장</div></div>
          ${uiIconBtn('more', '메뉴', { id: 'ssHomeMore' }).replace('class="ss-iconbtn', 'class="ss-iconbtn ss-iconbtn--onbrand')}
        </div>
        <div id="ssPcCard">${_pcCardHtml()}</div>
      </div></div>
      <div class="ss-scroll" id="ssScroll"><div class="ss-col ss-pad">
        <button class="ss-bigcard" id="ssNewBtn"><span class="ss-bigcard__ic">${iconSvg('plus')}</span><span class="ss-grow"><b class="ss-title">새 시험 채점하기</b><span class="ss-sub" style="display:block;">정답지 1장 → 학생 답안지 여러 장</span></span>${iconSvg('chevron-right')}</button>
        <div class="ss-sec"><b>최근 채점 기록</b><span class="ss-sub">폰·PC 공유 · 5일 보관</span></div>
        <div class="ss-list" id="ssHomeList"><div class="ss-center" style="padding:28px;"><div class="ss-spinner"></div></div></div>
      </div></div>`;
    document.getElementById('ssNewBtn').onclick = () => window._ssNewExam();
    document.getElementById('ssHomeMore').onclick = () => _ssSheet([{ label: '로그아웃', icon: 'log-out', fn: () => window.dispatchEvent(new Event('ss-logout')) }]);
    let sessions = [];
    try { sessions = await _store().listSessions(); } catch (e) { console.warn('[scoresnap] 기록 목록 실패:', e && e.message); }
    if (_state.phase !== 'home') return;
    const list = document.getElementById('ssHomeList'); if (!list) return;
    if (!sessions.length) {
      list.innerHTML = '<div class="ss-center" style="padding:36px 20px;"><div class="ss-sub">아직 채점 기록이 없어요.<br>[새 시험 채점하기]로 시작해 보세요.</div></div>';
      return;
    }
    list.innerHTML = sessions.map(x => {
      const n = x.studentCount || 0;
      const badges = [];
      if (x.needCheck > 0) badges.push(uiChip(`확인 ${x.needCheck}`, 'warn'));
      if (n === 0 && x.questionCount) badges.push(uiChip('답안지 대기', 'brand'));
      if (x.createdAtMs && Date.now() - x.createdAtMs > 4 * 24 * 3600 * 1000) badges.push(uiChip('내일 삭제'));
      const sub = [_fmtAgo(x.createdAtMs), x.questionCount ? `${x.questionCount}문항` : '', n ? `${n}명 채점` : '', (n && typeof x.avgScore === 'number') ? `평균 ${x.avgScore}점` : ''].filter(Boolean).join(' · ');
      return `<button class="ss-row ss-row--tap" data-sid="${esc(x.id)}" data-ms="${esc(x.createdAtMs || 0)}"><span class="ss-grow"><b class="ss-title" style="display:block;word-break:break-word;">${esc(x.testName || '시험')}</b><span class="ss-sub">${esc(sub)}</span></span>${badges.join('')}${iconSvg('chevron-right')}</button>`;
    }).join('');
    list.onclick = (e) => {
      const b = e.target.closest('[data-sid]'); if (!b) return;
      _ssOpenServerSession(b.dataset.sid, { createdAtMs: +b.dataset.ms || 0 });
    };
  }

  window._ssNewExam = function () {
    _stopWatch();
    _state = { phase: 'init', answerKey: null, students: [], layoutHint: 'numbered', precision: false, batchIds: new Set() };
    _ssPush();
    _renderAnswerKeyCapture();
  };

  async function _ssOpenServerSession(sid, meta) {
    try {
      const data = await _store().loadSession(sid);
      _state = {
        phase: 'init', sid, precision: data.precision === true, answerKey: data.answerKey, keyImagePath: data.keyImagePath || '',
        createdAtMs: (meta && meta.createdAtMs) || 0, layoutHint: 'numbered', batchIds: new Set(),
        students: data.students.map(x => _fromServer(x)),
      };
      _startWatch(sid);
      _ssPush();
      if (_isPc() && _state.students.length) _renderPc();
      else if (!_state.students.length) _renderStudentCapture(); else _renderResultGrid();
    } catch (e) {
      _ssToast('채점 기록을 열 수 없어요: ' + (e && e.message));
    }
  }

  // ─── 3-2. 정답지 촬영 ───
  window._ssSetLayoutHint = function (v) { _state.layoutHint = v; _renderAnswerKeyCapture(); };

  function _renderAnswerKeyCapture() {
    _state.phase = 'answerKey-capture';
    const body = _body(); if (!body) return;
    const hint = _state.layoutHint || 'numbered';
    const re = !!_state._reKey;
    body.innerHTML = `
      ${uiHeader({ title: re ? '정답지 다시 올리기' : '새 시험 채점', back: 'window._ssUiBack()', right: `<span data-ss-pcchip>${_pcChipHtml()}</span>` })}
      ${uiSteps(1)}
      <div class="ss-scroll" id="ssScroll"><div class="ss-col ss-pad" style="display:flex;flex-direction:column;min-height:100%;">
        <div class="ss-sec" style="margin-top:6px;"><b>시험지 형태</b></div>
        <div class="ss-choices">
          <button class="ss-choice${hint === 'numbered' ? ' ss-choice--on' : ''}" onclick="window._ssSetLayoutHint('numbered')"><b>번호형</b><span>번호 한 줄에 문제 하나<br>단어|뜻 목록 포함</span></button>
          <button class="ss-choice${hint === 'table' ? ' ss-choice--on' : ''}" onclick="window._ssSetLayoutHint('table')"><b>표 형식</b><span>한 줄에 칸 여러 개<br>불규칙동사표 등</span></button>
        </div>
        <div><button class="ss-link${hint === 'auto' ? ' ss-link--on' : ''}" onclick="window._ssSetLayoutHint('auto')">${hint === 'auto' ? '지금은 AI가 자동으로 판단해요' : '잘 모르겠으면 AI가 자동으로 판단'}</button></div>
        <div class="ss-dashed ss-dashed--grow" id="ssAkDrop">
          <div class="ss-dashed__ic">${iconSvg('file-check')}</div>
          <h3>정답이 적힌 시험지 1장</h3>
          <p>시험지 출력 때 [답지 보기]를 켜고 인쇄한 것이 가장 정확해요.<br>그림자 없이 종이 전체가 나오게 찍어 주세요.</p>
          <span class="ss-kbd">PC: 프리뷰 [화면 복사] 후 여기서 Ctrl+V</span>
        </div>
      </div></div>
      ${uiActionBar(uiBtn({ kind: 'primary', size: 'lg', icon: 'camera', label: '정답지 촬영', id: 'ssAkCam' }), uiBtn({ size: 'lg', icon: 'image', label: '앨범', id: 'ssAkGal' }))}`;
    document.getElementById('ssAkCam').onclick = () => _pickFiles({ capture: true }, (fs) => _handleAnswerKeyFile(fs[0]));
    document.getElementById('ssAkGal').onclick = () => _pickFiles({}, (fs) => _handleAnswerKeyFile(fs[0]));
    _wireDrop(document.getElementById('ssAkDrop'), (fs) => _handleAnswerKeyFile(fs[0]));
  }

  function _wireDrop(el, cb) {
    if (!el) return;
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); el.classList.remove('over');
      const fs = [...(e.dataTransfer.files || [])].filter(f => /^image\//.test(f.type));
      if (fs.length) cb(fs);
    });
  }

  // Ctrl+V 붙여넣기 — 정답지 화면은 정답지로, 답안지 화면은 학생 답안지로
  document.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const files = [];
    for (const it of items) { if (it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) files.push(f); } }
    if (!files.length) return;
    if (_state.phase === 'answerKey-capture') { e.preventDefault(); _handleAnswerKeyFile(files[0]); }
    else if (_state.phase === 'student-capture') { e.preventDefault(); _handleStudentFiles(files); }
  });

  async function _handleAnswerKeyFile(file) {
    if (!file) return;
    _renderBusy('사진을 정리하는 중…', 1);
    try {
      const precision = _state.precision === true;
      const processed = await window._ssProcessImage(file, { precision });
      _state.answerKeyImage = processed;
      _renderAnswerKeyOcr(processed, precision);
    } catch (e) {
      _ssToast('사진을 처리하지 못했어요: ' + (e && e.message));
      _renderAnswerKeyCapture();
    }
  }

  function _renderBusy(msg, step) {
    const body = _body(); if (!body) return;
    body.innerHTML = `${uiHeader({ title: '새 시험 채점' })}${uiSteps(step || 1)}<div class="ss-center"><div class="ss-spinner"></div><div class="ss-title">${esc(msg)}</div></div>`;
  }

  // 정답지 읽기 — 학원 PC 의 Claude 가 처리(보통 30초~1분)
  async function _renderAnswerKeyOcr(processed, precision) {
    _state.phase = 'answerKey-ocr';
    const tok = _state._ocrTok = (_state._ocrTok || 0) + 1;
    const body = _body(); if (!body) return;
    body.innerHTML = `
      ${uiHeader({ title: '정답지 읽는 중', right: `<span data-ss-pcchip>${_pcChipHtml()}</span>` })}
      ${uiSteps(1)}
      <div class="ss-center"><div class="ss-spinner"></div>
        <div class="ss-title">학원 PC가 정답지를 읽고 있어요</div>
        <div class="ss-sub">보통 30초~1분 · 문제와 정답을 자동으로 읽어요${precision ? '<br>정밀 모드로 읽는 중이라 조금 더 걸려요' : ''}</div>
        <button class="ss-link" onclick="window._ssAkCancelOcr()">취소하고 다시 찍기</button>
      </div>`;
    try {
      const idToken = await window._ssGetIdToken();
      const r = await fetch('/api/scoresnap-grade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, mode: 'answerKey', imageBase64: processed.base64, imageMimeType: processed.mimeType, precision, layoutHint: _state.layoutHint || 'numbered' }),
      });
      const data = await r.json().catch(() => ({}));
      if (tok !== _state._ocrTok) return;                     // 취소됨
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      _state.answerKey = data;
      _state.akTab = (data.questions || []).some(_akNeedsCheck) ? 'check' : 'all';
      _renderAnswerKeyReview();
    } catch (e) {
      if (tok !== _state._ocrTok) return;
      const b = _body(); if (!b) return;
      b.innerHTML = `${uiHeader({ title: '정답지 읽기 실패', back: 'window._ssUiBack()' })}${uiSteps(1)}
        <div class="ss-center"><div class="ss-title tone-bad ss-tone-bad">정답지를 읽지 못했어요</div><div class="ss-sub">${esc(e.message)}</div>
        ${uiBtn({ kind: 'primary', size: 'lg', label: '다시 촬영', onclick: 'window._ssAkRestart()' })}</div>`;
    }
  }
  window._ssAkCancelOcr = function () { _state._ocrTok = (_state._ocrTok || 0) + 1; _renderAnswerKeyCapture(); };

  // ─── 3-3. 정답지 검토 ───
  const _akNeedsCheck = (q) => (q.confidence || 0) < 0.8 || !String(q.answer || '').trim();

  function _akRowHtml(q, i) {
    const need = _akNeedsCheck(q);
    const badge = !String(q.answer || '').trim() ? uiChip('정답 없음', 'warn') : (q.confidence || 0) < 0.8 ? uiChip('흐림', 'warn') : '';
    const choices = (q.type === 'mcq' && Array.isArray(q.choices) && q.choices.length)
      ? `<div class="ss-sub" style="padding:6px 0 0 42px;">${q.choices.map((c, j) => `${['①', '②', '③', '④', '⑤'][j] || j + 1} ${esc(c)}`).join(' &nbsp; ')}</div>` : '';
    return `<div class="ss-akrow${need ? ' ss-akrow--warn' : ''}" id="ssAkRow${i}" data-i="${i}">
      <div class="ss-akrow__top"><span class="no">${esc(q.no)}</span><span class="stem">${esc(q.stem) || '(문제 없음)'}</span><span id="ssAkBadge${i}">${badge}</span></div>${choices}
      <div class="ss-akrow__ans"><label>정답</label><input class="ss-input" type="text" value="${esc(q.answer || '')}" onchange="window._ssAkEditAnswer(${i}, this.value)"></div></div>`;
  }

  function _renderAnswerKeyReview() {
    _state.phase = 'answerKey-review';
    const body = _body(); if (!body) return;
    const k = _state.answerKey || {};
    const qs = k.questions || [];
    const nCheck = qs.filter(_akNeedsCheck).length;
    const tab = _state.akTab === 'check' && nCheck ? 'check' : 'all';
    const rows = qs.map((q, i) => ({ q, i })).filter(o => tab === 'all' || _akNeedsCheck(o.q));
    const kind = k.layout === 'table' ? '표 형식' : '번호형';
    const thumbStyle = _state.answerKeyImage && _state.answerKeyImage.dataUrl ? ` style="background-image:url('${_state.answerKeyImage.dataUrl}')"` : '';
    const re = !!_state._reKey;
    const pc = _isPc();
    const imgSrc = _state.answerKeyImage && _state.answerKeyImage.dataUrl;
    const hdr = uiHeader({ title: _state._editKey ? '정답지 확인·수정' : '정답지 검토', back: 'window._ssUiBack()', right: uiIconBtn('more', '메뉴', { id: 'ssAkMore' }) });
    const scrollHtml = `<div class="ss-scroll" id="ssScroll"><div class="ss-col ss-pad">
        <div class="ss-row" style="border-radius:var(--radius);border:1px solid var(--border);margin-bottom:12px;align-items:center;">
          ${pc ? '' : `<button class="ss-thumbbtn" id="ssAkThumb"${thumbStyle} aria-label="정답지 사진 보기">${thumbStyle ? '' : iconSvg('image')}</button>`}
          <div class="ss-grow"><div class="ss-sub">시험 이름</div>
            <input class="ss-input ss-input--line" id="ssAkTitle" type="text" value="${esc(k.testName || '')}" placeholder="시험 이름을 입력하세요" style="font-size:19px;">
            <div class="ss-sub" style="margin-top:4px;">${esc(kind)} · ${qs.length}문항 인식${_state.precision === true ? ' · 정밀' : ''}${k.layout === 'table' ? ` · ${esc(k.givenColumn || '')} 보고 ${esc((k.answerColumns || []).join('·'))} 쓰기` : ''}</div></div>
        </div>
        <div class="ss-row" style="padding:0;border:0;gap:8px;background:none;margin-bottom:6px;">
          <button class="ss-pill${tab === 'all' ? ' ss-pill--on' : ''}" data-tab="all">전체 ${qs.length}</button>
          ${nCheck ? `<button class="ss-pill${tab === 'check' ? ' ss-pill--on' : ''}" data-tab="check" style="${tab === 'check' ? '' : 'color:var(--warn);border-color:var(--warn-bd);background:var(--warn-bg);'}" id="ssAkCheckPill">확인 필요 ${nCheck}</button>` : ''}
        </div>
        ${tab === 'check' ? '<div class="ss-hint" style="padding-top:0;">AI가 흐리게 읽은 문항이에요. 정답칸을 눌러 바로 고칠 수 있어요.</div>' : `<div class="ss-hint" style="padding-top:0;">정답만 직접 고칠 수 있어요.${pc ? ' <span class="ss-kbd">Tab</span> 으로 다음 칸으로 이동해요.' : ''}</div>`}
        <div class="ss-list" id="ssAkList" style="margin-top:10px;">${rows.map(o => _akRowHtml(o.q, o.i)).join('') || '<div class="ss-center" style="padding:30px;"><div class="ss-sub">문항이 인식되지 않았어요. 다시 촬영해 주세요.</div></div>'}</div>
        ${tab === 'check' ? `<div style="text-align:center;padding:14px;"><button class="ss-link ss-link--on" id="ssAkAll">전체 ${qs.length}문항 보기</button></div>` : ''}
      </div></div>`;
    const barHtml = uiActionBar(`<div style="flex:1;"><button class="ss-btn ss-btn--primary ss-btn--lg ss-btn--block" id="ssAkOk"${qs.length ? '' : ' disabled'}><span>${_state._editKey ? '정답 수정 저장 · 점수 다시 계산' : re ? '정답지 확정하고 다시 채점' : '정답지 확정하고 답안지 찍기'}</span>${iconSvg('chevron-right', 'ss-ic--sm')}</button><div class="ss-sub" style="text-align:center;margin-top:8px;">확정하면 다른 기기에서도 이 정답지로 이어서 채점할 수 있어요</div></div>`);
    if (!pc) {
      body.innerHTML = `${hdr}${uiSteps(1)}${scrollHtml}${barHtml}`;
    } else {
      const zoom = _state.pcZoom || 100;
      body.innerHTML = `<div class="ss-pc__two ss-akpc2" id="ssPcGrid">
        <div class="ss-akpc2__main">${hdr}${uiSteps(1)}${scrollHtml}${barHtml}</div>
        <div class="ss-pc__photo"><i class="ss-pc__rs ss-pc__rs--in" id="ssPcRs3" title="끌어서 너비 조절 (더블클릭 = 기본값)"></i>
          <div class="ss-pc__bar" style="border-bottom:1px solid var(--border);"><b style="font-size:15px;">정답지 사진</b><span class="ss-grow"></span>
            ${uiIconBtn('minus', '축소', { box: true, onclick: 'window._pcZoom(-25)' })}<span class="ss-sub" id="ssPcZoomLbl" style="min-width:44px;text-align:center;font-weight:700;">${zoom}%</span>${uiIconBtn('plus', '확대', { box: true, onclick: 'window._pcZoom(25)' })}
            ${uiBtn({ size: 'sm', label: '맞춤', onclick: 'window._pcZoom(0)' })}${uiIconBtn('maximize', '전체 화면', { box: true, onclick: 'window._ssViewKeyImage()' })}</div>
          <div class="ss-pc__photobox" id="ssPcPhotoBox">${imgSrc ? `<img id="ssPcImg" alt="정답지 사진" style="width:${zoom}%" src="${imgSrc}">` : '<div class="ss-center"><div class="ss-sub">정답지 사진이 없어요</div></div>'}</div>
        </div></div>`;
      _pcColsApply(); _pcWireResize(document.getElementById('ssPcRs3'), 'pcp');
      const im = document.getElementById('ssPcImg'); if (im) im.onclick = () => window._ssViewKeyImage();
    }
    document.getElementById('ssAkOk').onclick = () => window._ssAkConfirm();
    const thumb = document.getElementById('ssAkThumb'); if (thumb) thumb.onclick = () => window._ssViewKeyImage();
    document.getElementById('ssAkTitle').oninput = (e) => { _state.answerKey.testName = e.target.value; };
    body.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { _state.akTab = b.dataset.tab; _renderAnswerKeyReview(); }; });
    const all = document.getElementById('ssAkAll'); if (all) all.onclick = () => { _state.akTab = 'all'; _renderAnswerKeyReview(); };
    document.getElementById('ssAkMore').onclick = () => _state._editKey ? _ssSheet([{ label: '정답지 사진 보기', icon: 'image', fn: () => window._ssViewKeyImage() }]) : _ssSheet([
      { label: '정답지 사진 보기', icon: 'image', fn: () => window._ssViewKeyImage() },
      { label: '다시 촬영', icon: 'camera', fn: () => window._ssAkRestart() },
      ...(_state.precision === true ? [] : [{ label: '정밀하게 다시 읽기', icon: 'refresh', fn: () => window._ssAkPrecisionRetry() }]),
    ]);
  }

  // 정답 수정 — 그 행만 갱신 (전체 다시 그리지 않아 스크롤 유지)
  window._ssAkEditAnswer = function (idx, val) {
    const q = _state.answerKey && _state.answerKey.questions && _state.answerKey.questions[idx];
    if (!q) return;
    q.answer = String(val || '').trim();
    if (q.type === 'mcq' && Array.isArray(q.choices)) { const m = q.choices.findIndex(c => c === q.answer); if (m >= 0) q.answerIdx = m; }
    q.confidence = 1.0;
    const b = document.getElementById('ssAkBadge' + idx); if (b) b.innerHTML = q.answer ? '' : uiChip('정답 없음', 'warn');
    const row = document.getElementById('ssAkRow' + idx); if (row && q.answer) row.classList.remove('ss-akrow--warn');
    const n = (_state.answerKey.questions || []).filter(_akNeedsCheck).length;
    const pill = document.getElementById('ssAkCheckPill'); if (pill) pill.textContent = `확인 필요 ${n}`;
  };

  function _ssDropEmptySession() {
    const sid = _state.sid;
    if (sid && _store() && !(_state.students || []).some(x => x.status === 'done')) {
      _store().deleteSession(sid).catch(() => {});
      _state.sid = null; _state._sidPromise = null;
    }
  }
  window._ssAkRestart = function () {
    if (!_state._reKey) _ssDropEmptySession();
    _state.answerKey = null; _state.answerKeyImage = null; _state.precision = false;
    _renderAnswerKeyCapture();
  };
  window._ssAkPrecisionRetry = function () {
    if (!_state._reKey) _ssDropEmptySession();
    _state.answerKey = null; _state.answerKeyImage = null; _state.precision = true;
    _renderAnswerKeyCapture();
  };

  // 정답지만 다시 올리기 (학생 사진은 그대로, 새 정답지로 전원 다시 채점)
  window._ssReplaceAnswerKey = async function () {
    const n = (_state.students || []).filter(x => x.imagePath).length;
    const ok = typeof window.showConfirm === 'function'
      ? await window.showConfirm('정답지 다시 올리기', !n ? '정답지를 새로 찍어 이 기록의 정답지를 교체해요.' : `정답지를 새로 찍고, 이 기록의 학생 ${n}명을 새 정답지로 다시 채점해요.\n(이름 수정은 유지, ✓/✗ 직접 수정은 초기화돼요)`) : true;
    if (!ok) return;
    _state._reKey = true;
    _state._prevKey = _state.answerKey; _state._prevPrecision = _state.precision;
    _state.answerKey = null; _state.answerKeyImage = null;
    _ssPush();
    _renderAnswerKeyCapture();
  };
  function _ssCancelReKey() {
    if (!_state._reKey) return false;
    _state._reKey = false;
    if (_state._prevKey) _state.answerKey = _state._prevKey;
    if (_state._prevPrecision != null) _state.precision = _state._prevPrecision;
    _state._prevKey = null;
    _renderResultGrid();
    return true;
  }

  // ─── 정답지 확인·수정 (채점 후에도 정답을 고치고 학생 점수를 다시 계산) ───
  window._ssEditKey = async function () {
    if (!_state.sid || !_state.answerKey) return;
    _state._editKey = true;
    _state._keyBefore = JSON.parse(JSON.stringify(_state.answerKey));
    _state.answerKeyImage = null;
    if (_state.keyImagePath) { try { _state.answerKeyImage = { dataUrl: await _store().getImageUrl(_state.keyImagePath) }; } catch (_) {} }
    _state.akTab = 'all';
    _ssPush();
    _renderAnswerKeyReview();
  };
  function _cancelKeyEdit() {
    if (_state._keyBefore) _state.answerKey = _state._keyBefore;
    _state._editKey = false; _state._keyBefore = null; _state.answerKeyImage = null;
    _renderResultGrid();
  }
  // 글자·띄어쓰기·부호 무시, 쉼표/슬래시/세미콜론으로 나뉜 복수 정답 중 하나면 일치
  function _ansMatch(stu, cor) {
    const n = (t) => String(t || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[\s.,;:!?'"~\-·]/g, '');
    const a = n(stu); if (!a) return false;
    return String(cor || '').split(/[,/;]/).some(alt => { const b = n(alt); return b && b === a; });
  }
  async function _applyKeyEdit() {
    const k = _state.answerKey, before = _state._keyBefore, sid = _state.sid, st = _store();
    const changed = new Set();
    (k.questions || []).forEach(q => { const o = (before.questions || []).find(x => x.no === q.no); if (o && String(o.answer || '').trim() !== String(q.answer || '').trim()) changed.add(q.no); });
    _renderBusy('정답을 저장하고 점수를 다시 계산하는 중…', 1);
    try { await st.updateKey(sid, k, _state.precision === true, null); }
    catch (e) { _ssToast('정답 저장 실패: ' + (e && e.message)); _renderAnswerKeyReview(); return; }
    const newAns = new Map((k.questions || []).map(q => [q.no, q.answer]));
    let nStu = 0, nFlag = 0;
    for (const x of (_state.students || [])) {
      if (x.status !== 'done' || !x.result) continue;
      const r = x.result; let touched = false;
      (r.answers || []).forEach(a => {
        const kn = a.keyNo != null ? a.keyNo : a.no;
        if (!changed.has(kn)) return;
        a.correctAnswer = newAns.get(kn) || a.correctAnswer;
        const ok = _ansMatch(a.studentAnswer, a.correctAnswer);
        a.isCorrect = ok; a._aiIsCorrect = ok; a._adminOverride = false; touched = true;
        if (!ok && String(a.studentAnswer || '').trim()) {          // 뜻이 같은 다른 표현일 수 있어 사람이 확인하도록 표시
          r.uncertainQuestions = Array.from(new Set([...(r.uncertainQuestions || []), a.no])); r.checked = false; nFlag++;
        } else if (ok) { r.uncertainQuestions = (r.uncertainQuestions || []).filter(n => n !== a.no); }
      });
      if (!touched) continue;
      _recalc(r); x._markCache = null; x.markPath = ''; x.markKey = ''; nStu++;
      try { await st.updateStudentResult(sid, x.docId, r); } catch (e) { console.warn('[scoresnap] 학생 갱신 실패:', e && e.message); }
    }
    try {
      const done = (_state.students || []).filter(s => s.status === 'done' && s.result);
      await st.patchSession(sid, { studentCount: done.length, avgScore: done.length ? Math.round(done.reduce((a, s) => a + _pctOf(s.result), 0) / done.length) : 0, needCheck: done.filter(_needsCheck).length });
    } catch (_) {}
    _state._editKey = false; _state._keyBefore = null; _state.answerKeyImage = null;
    _renderResultGrid();
    _ssToast(changed.size ? `정답 ${changed.size}개를 고쳤어요 · 학생 ${nStu}명 점수를 다시 계산${nFlag ? ` (뜻이 다른 답 ${nFlag}건은 '애매'로 표시 — 확인하세요)` : ''}` : '변경된 정답이 없어요');
  }

  window._ssAkConfirm = async function () {
    const k = _state.answerKey;
    if (!k || !(k.questions || []).length) return;
    const st = _store();
    if (_state._editKey) { await _applyKeyEdit(); return; }
    if (_state._reKey) {
      _state._reKey = false; _state._prevKey = null;
      const sid = _state.sid;
      try { await st.updateKey(sid, k, _state.precision === true, _state.answerKeyImage); } catch (e) { _ssToast('정답지 저장 실패: ' + (e && e.message)); return; }
      _state.batchIds = new Set();
      const targets = (_state.students || []).filter(x => x.imagePath);
      targets.forEach(x => { x.status = 'queued'; x.error = ''; x._markCache = null; x.markPath = ''; x.markKey = ''; _state.batchIds.add(x.docId); });
      _ssPush();
      _renderStudentCapture();
      for (const x of targets) {
        try { await st.requeueStudent(sid, x.docId, x.imagePath, k, (x.result && x.result.studentName) || ''); }
        catch (e) { x.status = 'error'; x.error = '다시 채점 요청 실패: ' + (e && e.message); _onStudentsChanged(); }
      }
      return;
    }
    // 새 시험 — 정답지를 서버에 바로 저장해 두면 다른 기기에서도 이어서 채점할 수 있다
    _renderBusy('정답지를 저장하는 중…', 1);
    try {
      _state.sid = await st.createSession(k, _state.precision === true, _state.answerKeyImage);
    } catch (e) {
      _ssToast('정답지를 저장하지 못했어요: ' + (e && e.message));
      _renderAnswerKeyReview();
      return;
    }
    _state.students = []; _state.batchIds = new Set();
    _startWatch(_state.sid);
    _ssPush();
    _renderStudentCapture();
  };

  // ─── 3-4. 답안지 추가 + 채점 진행 ───
  function _batchList() {
    const ids = _state.batchIds || new Set();
    return (_state.students || []).filter(s => ids.has(s.docId) || s.status !== 'done');
  }
  function _avgGradeMs() {
    const xs = (_state.students || []).filter(s => s.status === 'done' && s.gradeMs > 0).slice(-8).map(s => s.gradeMs);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  }

  function _cellHtml(s, n, queuePos) {
    const r = s.result;
    let info = '';
    if (s.status === 'done') {
      const pct = _pctOf(r);
      info = `<b>${_noName(r) ? '<span class="ss-tone-warn">이름 확인 필요</span>' : esc(r.studentName)}</b><span class="${_tone(pct)}" style="font-weight:800;">${r.correctCount}/${r.totalQuestions}</span>`;
    } else if (s.status === 'grading') info = '<b class="ss-tone-brand">채점 중…</b><span class="ss-sub">PC에서 처리</span>';
    else if (s.status === 'uploading') info = '<b class="ss-tone-brand">올리는 중…</b><span class="ss-sub">잠시만요</span>';
    else if (s.status === 'error') info = `<b class="ss-tone-bad">실패</b><span class="ss-sub">눌러서 다시 시도</span>`;
    else info = `<b>대기</b><span class="ss-sub">${queuePos}번째 차례</span>`;
    const removable = s.status === 'queued' || s.status === 'uploading' || s.status === 'error';
    const act = s.status === 'error' ? ` data-retry="${esc(s.docId)}"` : '';
    return `<div class="ss-cell"${act} data-cell="${esc(s.docId)}"><div class="ss-cell__img" data-thumb="${esc(s.docId)}"${s.image && s.image.dataUrl ? ` style="background-image:url('${s.image.dataUrl}')"` : ''}><span class="ss-cell__no">${n}</span>${removable ? `<button class="ss-cell__x" data-rm="${esc(s.docId)}" aria-label="삭제">${iconSvg('x')}</button>` : ''}</div><div class="ss-cell__info">${info}</div></div>`;
  }

  function _renderStudentCapture() {
    _state.phase = 'student-capture';
    const body = _body(); if (!body) return;
    const k = _state.answerKey || {};
    const list = _batchList();
    const total = list.length;
    const doneN = list.filter(s => s.status === 'done').length;
    const busy = list.some(s => s.status === 'queued' || s.status === 'grading' || s.status === 'uploading');
    const waiting = list.filter(s => s.status === 'queued' || s.status === 'grading').length;
    const avg = _avgGradeMs();
    const remain = avg ? Math.max(1, Math.round(waiting * avg / 60000)) : 0;
    let qpos = 0;
    const cells = list.map((s, i) => _cellHtml(s, i + 1, s.status === 'queued' ? ++qpos : 0)).join('');
    const allDone = total > 0 && !busy;
    const resultCount = (_state.students || []).filter(s => s.status === 'done').length;
    const w = window._ssWorker;
    const offWarn = (busy && w && !w.online) ? `<div class="ss-banner" style="background:var(--warn-bg);color:var(--warn);margin-bottom:12px;"><span>PC 채점 프로그램이 꺼져 있어요. 학원 PC에서 start.bat 을 실행하면 채점이 시작돼요.</span></div>` : '';
    const progress = total ? `
      ${offWarn}<div class="ss-card ss-progress"><div class="ss-progress__head"><b>${total}장 중 ${doneN}장 채점 완료</b><span class="ss-sub">${busy ? (remain ? `약 ${remain}분 남음` : '시간 계산 중') : '모두 끝났어요'}</span></div>
        <div class="ss-bar"><i style="width:${total ? Math.round(doneN / total * 100) : 0}%"></i></div>
        <div class="ss-sub" style="margin-top:10px;">학원 PC가 한 장씩 차례로 채점해요. 화면을 닫아도 계속되고, 끝나면 결과 목록에 들어가요.</div></div>
      <div class="ss-sec" style="margin-top:20px;"><b>추가한 답안지</b><span class="ss-sub">이름은 답안지에서 자동 인식</span></div>
      <div class="ss-grid3" id="ssGrid">${cells}</div>` : `
      <div class="ss-dashed ss-dashed--grow" id="ssStDrop">
        <div class="ss-dashed__ic">${iconSvg('camera')}</div>
        <h3>학생 답안지를 찍어 주세요</h3>
        <p>여러 장을 한 번에 골라도 돼요.<br>이름은 답안지의 손글씨에서 자동으로 읽어요.</p>
        <span class="ss-kbd">PC: 파일을 끌어다 놓거나 Ctrl+V</span>
        ${_isPc() ? `<button class="ss-btn" onclick="window._ssShowQr()">${iconSvg('image', 'ss-ic--sm')}<span>폰으로 이어서 찍기 (QR)</span></button>` : ''}
      </div>`;
    const sec = uiBtn({ size: 'lg', icon: 'image', label: allDone ? '' : '앨범에서 여러 장', id: 'ssStGal' });
    const cam = uiBtn({ kind: 'primary', size: 'lg', icon: 'camera', label: total ? '한 장 더 찍기' : '답안지 촬영', id: 'ssStCam' });
    const bar = allDone
      ? uiActionBar(uiBtn({ kind: 'primary', size: 'lg', label: `결과 보기 (${resultCount}명)`, id: 'ssStResult' }), uiBtn({ size: 'lg', icon: 'camera', label: '', id: 'ssStCam2' }) + sec)
      : uiActionBar(cam, sec);
    body.innerHTML = `
      ${uiHeader({ title: '답안지 채점', sub: `${k.testName || '시험'} · ${(k.questions || []).length}문항`, back: 'window._ssUiBack()', right: `<span data-ss-pcchip>${_pcChipHtml()}</span>${uiIconBtn('more', '메뉴', { id: 'ssStMore' })}` })}
      ${uiSteps(total && allDone ? 3 : 2)}
      <div class="ss-scroll" id="ssScroll"><div class="ss-col ss-pad" style="display:flex;flex-direction:column;min-height:100%;">${progress}</div></div>
      ${bar}`;
    document.getElementById('ssStMore').onclick = () => _ssSheet([
      { label: '폰으로 열기 (QR)', icon: 'camera', fn: () => window._ssShowQr() },
      { label: '정답지 확인·수정', icon: 'edit', fn: () => window._ssEditKey() },
      { label: '정답 목록 보기', icon: 'list', fn: () => window._ssViewKeyList() },
      { label: '정답지 사진 보기', icon: 'image', fn: () => window._ssViewKeyImage() },
      { label: '정답지 다시 올리기', icon: 'refresh', fn: () => window._ssReplaceAnswerKey() },
      { label: '이 기록 삭제', icon: 'trash', danger: true, fn: () => window._ssDeleteCurrentSession() },
    ]);
    const gal = document.getElementById('ssStGal'); if (gal) gal.onclick = () => _pickFiles({ multiple: true }, _handleStudentFiles);
    const c1 = document.getElementById('ssStCam'); if (c1) c1.onclick = () => _pickFiles({ capture: true }, _handleStudentFiles);
    const c2 = document.getElementById('ssStCam2'); if (c2) c2.onclick = () => _pickFiles({ capture: true }, _handleStudentFiles);
    const rs = document.getElementById('ssStResult'); if (rs) rs.onclick = () => { _state.batchIds = new Set(); _ssPush(); _renderResultGrid(); };
    _wireDrop(document.getElementById('ssStDrop') || document.getElementById('ssScroll'), _handleStudentFiles);
    const grid = document.getElementById('ssGrid');
    if (grid) {
      grid.onclick = (e) => {
        const rm = e.target.closest('[data-rm]');
        if (rm) { e.stopPropagation(); return window._ssStRemove(rm.dataset.rm); }
        const rt = e.target.closest('[data-retry]');
        if (rt) return window._ssRetryStudent(rt.dataset.retry);
        const cell = e.target.closest('[data-cell]');
        if (cell) { const s = _state.students.find(x => x.docId === cell.dataset.cell); if (s && s.status === 'done') { _state.batchIds = new Set(); _ssPush(); window._ssOpenStudentDetail(_state.students.indexOf(s)); } }
      };
      _fillThumbs(grid);
    }
  }

  // 서버에만 있는 사진의 썸네일을 채운다 (이미 받은 것은 캐시)
  const _thumbCache = {};
  function _fillThumbs(root) {
    root.querySelectorAll('[data-thumb]').forEach(el => {
      const s = (_state.students || []).find(x => x.docId === el.dataset.thumb);
      if (!s || (s.image && s.image.dataUrl) || !s.imagePath) return;
      const paint = (u) => { if (u) el.style.backgroundImage = `url('${u}')`; };
      if (_thumbCache[s.imagePath]) return paint(_thumbCache[s.imagePath]);
      _store().getImageUrl(s.imagePath).then(u => { _thumbCache[s.imagePath] = u; paint(u); }).catch(() => {});
    });
  }

  async function _handleStudentFiles(files) {
    if (!files || !files.length) return;
    const sid = await _ensureSession();
    if (!sid) { _ssToast('기록이 아직 만들어지지 않았어요. 잠시 후 다시 시도해 주세요'); return; }
    const st = _store();
    for (const file of files) {
      let processed;
      try { processed = await window._ssProcessImage(file, { precision: _state.precision === true }); }
      catch (e) { _ssToast('사진을 읽지 못했어요'); continue; }
      const docId = st.newStudentId(sid);
      const idx = (_state.students || []).reduce((m, s) => Math.max(m, s.idx || 0), 0) + 1;
      const entry = { docId, idx, status: 'uploading', image: processed, result: null, error: '' };
      _state.students.push(entry); (_state.batchIds = _state.batchIds || new Set()).add(docId);
      if (_state.phase !== 'student-capture') _renderStudentCapture(); else _onStudentsChanged();
      try {
        const r = await st.queueStudent(sid, { docId, idx, image: processed, answerKey: _state.answerKey });
        entry.imagePath = r.imagePath; if (entry.status === 'uploading') entry.status = 'queued';
      } catch (e) {
        entry.status = 'error'; entry._uploadFail = true; entry.error = '올리지 못했어요: ' + (e && e.message);
      }
      _onStudentsChanged();
    }
  }

  window._ssStRemove = async function (docId) {
    const s = (_state.students || []).find(x => x.docId === docId); if (!s) return;
    _state.students = _state.students.filter(x => x.docId !== docId);
    if (_state.batchIds) _state.batchIds.delete(docId);
    _onStudentsChanged();
    if (_state.sid && !s._uploadFail) { try { await _store().deleteStudent(_state.sid, docId, s.imagePath, s.markPath); } catch (_) {} }
  };

  // 실패한 사진 다시 채점
  window._ssRetryStudent = async function (docId) {
    const s = (_state.students || []).find(x => x.docId === docId); if (!s || !_state.sid) return;
    s.status = 'queued'; s.error = ''; _onStudentsChanged();
    try {
      if (s._uploadFail && s.image) {
        s._uploadFail = false;
        const r = await _store().queueStudent(_state.sid, { docId, idx: s.idx, image: s.image, answerKey: _state.answerKey });
        s.imagePath = r.imagePath;
      } else {
        await _store().requeueStudent(_state.sid, docId, s.imagePath, _state.answerKey, (s.result && s.result.studentName) || '');
      }
    } catch (e) { s.status = 'error'; s.error = '다시 시도하지 못했어요: ' + (e && e.message); _onStudentsChanged(); }
  };

  // ─── 3-5. 결과 목록 ───
  window._ssSetSort = function (v) { _state.sort = v; if (_state.phase === 'pc') _pcRenderStudents(); else _keepScroll(_renderResultGrid); };
  window._ssToggleOnlyCheck = function () { _state.onlyCheck = !_state.onlyCheck; if (_state.phase === 'pc') _pcRenderStudents(); else _keepScroll(_renderResultGrid); };

  function _renderResultGrid() {
    if (_isPc()) return _renderPc();
    _state.phase = 'result-grid';
    const body = _body(); if (!body) return;
    const all = _state.students || [];
    const done = all.filter(s => s.status === 'done' && s.result);
    const avg = done.length ? Math.round(done.reduce((a, s) => a + _pctOf(s.result), 0) / done.length) : 0;
    const nCheck = done.filter(_needsCheck).length;
    const sort = _state.sort || 'order';
    let rows = all.map((s, i) => ({ s, i }));
    if (_state.onlyCheck) rows = rows.filter(o => _needsCheck(o.s));
    if (sort === 'low') rows.sort((a, b) => (a.s.status === 'done' ? _pctOf(a.s.result) : 999) - (b.s.status === 'done' ? _pctOf(b.s.result) : 999));
    else if (sort === 'name') rows.sort((a, b) => String((a.s.result && a.s.result.studentName) || '힣').localeCompare(String((b.s.result && b.s.result.studentName) || '힣'), 'ko'));
    const title = _testNameOf(null);
    const sub = [`${(_state.answerKey && _state.answerKey.questions || []).length}문항`, _fmtAgo(_state.createdAtMs), '서버 저장됨'].filter(Boolean).join(' · ');
    const rowHtml = rows.map(({ s, i }, n) => {
      const r = s.result;
      if (s.status === 'error') return `<button class="ss-row ss-row--tap" data-retry="${esc(s.docId)}" style="background:var(--bad-bg);"><span class="ss-rank">${n + 1}</span><span class="ss-grow"><b class="ss-title ss-tone-bad">채점 실패</b><span class="ss-sub" style="display:block;">눌러서 다시 채점</span></span></button>`;
      if (s.status !== 'done') return `<div class="ss-row"><span class="ss-rank">${n + 1}</span><span class="ss-grow"><b class="ss-title" style="color:var(--sub);">${s.status === 'grading' ? '채점 중…' : '채점 대기'}</b></span>${uiChip(s.status === 'grading' ? 'PC에서 처리' : '대기')}</div>`;
      const pct = _pctOf(r);
      const badges = [_isUncertain(r) ? uiChip(`확인 ${(r.uncertainQuestions || []).length}문항`, 'warn') : '', _noName(r) ? uiChip('이름 미인식', 'warn') : '', s.kakaoSentAt ? uiChip('보냄', 'ok') : ''].join('');
      return `<button class="ss-row ss-row--tap" data-open="${i}"><span class="ss-rank">${n + 1}</span><span class="ss-grow"><b class="ss-title" style="display:block;${_noName(r) ? 'color:var(--sub);font-weight:600;' : ''}">${_noName(r) ? '이름을 입력해 주세요' : esc(r.studentName)}${_hasMark(s) ? ' ' + `<span class="ss-mk" title="마킹 사진 있음" aria-label="마킹 사진 있음">${iconSvg('check')}</span>` : ''}</b><span>${badges}</span></span><span class="ss-pts"><b class="${_tone(pct)}">${pct}점</b><small>${r.correctCount}/${r.totalQuestions}</small></span></button>`;
    }).join('');
    body.innerHTML = `
      ${uiHeader({ title, sub, back: 'window._ssUiBack()', right: uiIconBtn('refresh', '새로고침', { onclick: 'window._ssRefreshFromServer()' }) + uiIconBtn('more', '메뉴', { id: 'ssRsMore' }) })}
      <div class="ss-scroll" id="ssScroll"><div class="ss-col ss-pad">
        <div class="ss-stats">
          <div class="ss-stat"><small>평균</small><b>${avg}<span style="font-size:15px;">점</span></b></div>
          <div class="ss-stat"><small>채점</small><b>${done.length}<span style="font-size:15px;">명</span></b></div>
          <button class="ss-stat ss-stat--warn" style="text-align:left;border:1px solid var(--warn-bd);${_state.onlyCheck ? 'outline:2px solid var(--warn);' : (nCheck ? '' : 'background:#f1f3f4;border-color:transparent;color:var(--sub);')}" onclick="window._ssToggleOnlyCheck()"><small>확인 필요</small><b>${nCheck}<span style="font-size:15px;">명</span></b></button>
        </div>
        <div class="ss-row" style="padding:14px 0 10px;border:0;background:none;gap:8px;">
          ${[['order', '찍은 순서'], ['low', '점수 낮은 순'], ['name', '이름순']].map(([v, l]) => `<button class="ss-pill${sort === v ? ' ss-pill--on' : ''}" onclick="window._ssSetSort('${v}')">${l}</button>`).join('')}
        </div>
        <div class="ss-list" id="ssRsList">${rowHtml || '<div class="ss-center" style="padding:30px;"><div class="ss-sub">표시할 학생이 없어요.</div></div>'}</div>
        <div id="ssSyncNote" class="ss-hint"></div>
      </div></div>
      ${uiActionBar(uiBtn({ kind: 'primary', size: 'lg', icon: 'plus', label: '답안지 더 추가', id: 'ssRsAdd' }))}`;
    document.getElementById('ssRsAdd').onclick = () => window._ssBackToStudentCapture();
    document.getElementById('ssRsMore').onclick = () => _ssSheet([
      { label: '폰으로 열기 (QR)', icon: 'camera', fn: () => window._ssShowQr() },
      { label: '카톡 연속 전송', icon: 'share', fn: () => window._ssOpenKakao() },
      { label: '정답지 확인·수정', icon: 'edit', fn: () => window._ssEditKey() },
      { label: '정답 목록 보기', icon: 'list', fn: () => window._ssViewKeyList() },
      { label: '정답지 사진 보기', icon: 'image', fn: () => window._ssViewKeyImage() },
      { label: '정답지 다시 올리기', icon: 'refresh', fn: () => window._ssReplaceAnswerKey() },
      { label: '이 기록 삭제', icon: 'trash', danger: true, fn: () => window._ssDeleteCurrentSession() },
    ]);
    const list = document.getElementById('ssRsList');
    list.onclick = (e) => {
      const rt = e.target.closest('[data-retry]'); if (rt) return window._ssRetryStudent(rt.dataset.retry);
      const o = e.target.closest('[data-open]'); if (o) { _ssPush(); window._ssOpenStudentDetail(+o.dataset.open); }
    };
  }

  window._ssBackToStudentCapture = function () {
    _state.batchIds = new Set();
    _ssPush();
    _renderStudentCapture();
  };

  function _testNameOf(r) {
    const own = String((r && r.testName) || '').trim();
    if (own) return own;
    const k = String((_state.answerKey && _state.answerKey.testName) || '').trim();
    if (k) return k;
    const other = (_state.students || []).map(x => String((x.result && x.result.testName) || '').trim()).find(Boolean);
    return other || '시험';
  }

  window._ssRefreshFromServer = async function () {
    if (!_state.sid) return;
    try {
      const data = await _store().loadSession(_state.sid);
      _state.answerKey = data.answerKey; _state.keyImagePath = data.keyImagePath || '';
      _mergeStudents(data.students);
      _ssToast('새로고침했어요');
    } catch (e) { _ssToast('새로고침 실패: ' + (e && e.message)); }
  };

  window._ssDeleteCurrentSession = async function () {
    if (!_state.sid) return;
    const ok = typeof window.showConfirm === 'function'
      ? await window.showConfirm('채점 기록 삭제', '이 채점 기록과 답안지 사진을 삭제할까요?\n(폰·PC 모두에서 사라져요)') : true;
    if (!ok) return;
    try {
      await _store().deleteSession(_state.sid);
      _ssToast('삭제했어요');
      _stopWatch();
      _pcSess = null;
      _renderHome();
    } catch (e) { _ssToast('삭제 실패: ' + (e && e.message)); }
  };

  // ─── 서버 저장 (✓/✗·이름 수정) ───
  let _flushTimer = 0;
  function _markDirty(idx) {
    const x = _state.students && _state.students[idx];
    if (x) x._dirty = true;
    clearTimeout(_flushTimer);
    _flushTimer = setTimeout(_flushDirty, 1000);
  }
  async function _flushDirty() {
    const st = _state; if (!st.sid || !_store()) return;
    for (const x of (st.students || [])) {
      if (x._dirty && x.docId && x.result) {
        x._dirty = false;
        try { await _store().updateStudentResult(st.sid, x.docId, x.result); } catch (e) { x._dirty = true; console.warn('[scoresnap] 저장 실패:', e && e.message); }
      }
    }
    try {
      const done = (st.students || []).filter(s => s.status === 'done' && s.result);
      await _store().patchSession(st.sid, {
        studentCount: done.length,
        avgScore: done.length ? Math.round(done.reduce((a, s) => a + _pctOf(s.result), 0) / done.length) : 0,
        needCheck: done.filter(_needsCheck).length,
      });
    } catch (_) {}
  }

  // ─── 3-6. 학생 상세 ───
  window._ssSetDetailTab = function (t) { _state.detailTab = t; _keepScroll(() => _renderDetailBody(_state.detailIdx)); };

  window._ssOpenStudentDetail = function (idx) {
    const s = _state.students && _state.students[idx];
    if (!s || s.status !== 'done' || !s.result) return;
    _state.detailIdx = idx;
    const wrong = (s.result.answers || []).filter(a => !a.isCorrect).length;
    _state.detailTab = wrong ? 'wrong' : ((s.result.uncertainQuestions || []).length ? 'check' : 'right');
    if (_isPc()) { _renderPc(); return; }
    _state.phase = 'student-detail';
    _renderDetail(idx);
  };

  function _detailNeighbors(idx) {
    const ok = (_state.students || []).map((s, i) => ({ s, i })).filter(o => o.s.status === 'done' && o.s.result).map(o => o.i);
    const p = ok.indexOf(idx);
    return { prev: p > 0 ? ok[p - 1] : -1, next: p >= 0 && p < ok.length - 1 ? ok[p + 1] : -1, pos: p + 1, total: ok.length };
  }

  function _renderDetail(idx) {
    const body = _body(); if (!body) return;
    const s = _state.students[idx]; if (!s) return;
    const nb = _detailNeighbors(idx);
    body.innerHTML = `
      <header class="ss-header">${uiIconBtn('chevron-left', '결과 목록', { onclick: 'window._ssUiBack()' })}<div class="ss-header__title">결과 목록</div>
        ${uiIconBtn('chevron-left', '이전 학생', { box: true, disabled: nb.prev < 0, onclick: `window._ssDetailGo(${nb.prev})` })}<span class="ss-sub" style="min-width:56px;text-align:center;font-weight:700;">${nb.pos} / ${nb.total}</span>${uiIconBtn('chevron-right', '다음 학생', { box: true, disabled: nb.next < 0, onclick: `window._ssDetailGo(${nb.next})` })}</header>
      <div class="ss-scroll" id="ssScroll"><div class="ss-col" id="ssDetailRoot"></div></div>
      ${uiActionBar(uiBtn({ kind: 'primary', size: 'lg', icon: 'pen', label: '채점 표시 사진', onclick: `window._ssOpenMarked(${idx})` }),
        uiBtn({ size: 'lg', icon: 'copy', label: '카톡 복사', onclick: `window._ssCopyMarked(${idx})` }) + uiIconBtn('more', '더보기', { box: true, id: 'ssDtMore' }))}`;
    document.getElementById('ssDtMore').onclick = () => _ssSheet([
      { label: '성적표 PNG 저장', icon: 'download', fn: () => window._ssDownloadStudentPng(idx) },
      ...((s.imagePath || (s.image && s.image.dataUrl)) ? [{ label: '원본 사진 보기', icon: 'image', fn: () => window._ssViewStudentImage(idx) }] : []),
    ]);
    _renderDetailBody(idx);
  }
  window._ssDetailGo = function (i) { if (i >= 0) { _state.detailIdx = i; const s = _state.students[i]; const w = (s.result.answers || []).filter(a => !a.isCorrect).length; _state.detailTab = w ? 'wrong' : 'right'; if (_isPc()) _renderPc(); else _renderDetail(i); } };

  // ─── 시험 형식 판별: basic(단어→뜻) / ee(영영) / table(표) ───
  function _ssDetectViewMode(key) {
    key = key || {};
    if (key.layout === 'table') return 'table';
    const qs = key.questions || [];
    const isEnWord = t => /^[A-Za-z][A-Za-z' .\-]*$/.test(String(t || '').trim());
    const enAnswers = qs.filter(q => isEnWord(q.answer)).length;
    const longEnStems = qs.filter(q => /[A-Za-z]/.test(q.stem) && String(q.stem).trim().split(/\s+/).length >= 5).length;
    if (qs.length && enAnswers / qs.length >= 0.7 && longEnStems / qs.length >= 0.6) return 'ee';
    return 'basic';
  }
  function _viewMode(r) {
    const pref = _state.viewPref || 'auto';
    if (pref !== 'auto') return pref;
    const k = _state.answerKey || {};
    return _ssDetectViewMode(k.layout ? k : { layout: r && r.layout, questions: k.questions });
  }
  // 애매한 문항 확인 끝 — 저장하면 '확인 필요' 숫자에서 빠진다
  window._ssSetChecked = function (idx, v) {
    const s = _state.students && _state.students[idx]; if (!s || !s.result) return;
    s.result.checked = !!v;
    _markDirty(idx); clearTimeout(_flushTimer); _flushDirty();
    _keepScroll(() => _renderDetailBody(idx));
    if (_state.phase === 'pc') _pcRenderStudents();
    _ssToast(v ? '확인 완료로 저장했어요' : '확인 완료를 취소했어요');
  };
  window._ssSetViewPref = function (v) { _state.viewPref = v; _keepScroll(() => _renderDetailBody(_state.detailIdx)); };

  // 학생 답과 정답을 글자 단위로 비교(LCS) — 다른 글자만 표시
  function _diffHtml(stu, cor) {
    const a = String(stu || ''), b = String(cor || '').toLowerCase();
    if (!a.trim()) return '<span class="ss-tone-warn" style="color:var(--sub)">(빈칸)</span>';
    const al = a.toLowerCase(), n = al.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = al[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0, out = '', bad = '';
    const flush = () => { if (bad) { out += `<mark>${esc(bad)}</mark>`; bad = ''; } };
    while (i < n) {
      if (j < m && al[i] === b[j]) { flush(); out += esc(a[i]); i++; j++; }
      else if (j < m && dp[i][j + 1] > dp[i + 1][j]) j++;
      else { bad += a[i]; i++; }
    }
    flush();
    return out;
  }
  function _editDist(x, y) {
    x = String(x || '').toLowerCase(); y = String(y || '').toLowerCase();
    const d = Array.from({ length: x.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= y.length; j++) d[0][j] = j;
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    return d[x.length][y.length];
  }

  function _eeRowHtml(a, idx) {
    const unc = new Set(_state.students[idx].result.uncertainQuestions || []);
    const stu = String(a.studentAnswer || '').trim(), cor = String(a.correctAnswer || '').trim();
    let badge = '';
    if (!a.isCorrect && stu && cor) {
      if (cor.length >= 4 && _editDist(stu, cor) <= 2) badge = uiChip('철자 비슷', 'warn');
      else if (stu.length >= 5 && cor.length >= 5 && stu.slice(0, 5).toLowerCase() === cor.slice(0, 5).toLowerCase()) badge = uiChip('품사 다름', 'warn');
    }
    return `<div class="ss-ee"><span class="ss-ans__no">${esc(a.no)}</span><div class="ss-ans__main">
      <div class="ss-ee__word">${esc(cor || '?')}${unc.has(a.no) ? ' ' + uiChip('애매', 'warn') : ''}${a._adminOverride ? ' ' + uiChip('수정', 'brand') : ''}</div>
      <div class="ss-ee__stu">${a.isCorrect ? esc(stu) : _diffHtml(stu, cor)} ${badge}</div>
      <div class="ss-ee__def">${esc(a.stem || '')}</div></div>
      <button class="ss-toggle${a.isCorrect ? ' ss-toggle--ok' : ''}" aria-label="${a.isCorrect ? '정답' : '오답'} — 눌러서 바꾸기" onclick="window._ssToggleAnswer(${idx}, ${a.no})">${iconSvg(a.isCorrect ? 'check' : 'x')}</button></div>`;
  }

  // 표 형식: 주어진 단어(given)별 카드, 칸(answerColumns)별 토글
  function _tableCards(ans, idx, tab) {
    const r = _state.students[idx].result;
    const unc = new Set(r.uncertainQuestions || []);
    const groups = [];
    const byKey = new Map();
    ans.forEach(a => {
      let given = a.given, col = a.col;
      if (!given) { const m = String(a.stem || '').match(/^(.*)\s\[(.+)\]$/); if (m) { given = m[1]; col = col || m[2]; } }
      const k = given || ('#' + a.no);
      if (!byKey.has(k)) { const g = { given: given || a.stem || '', cells: [] }; byKey.set(k, g); groups.push(g); }
      byKey.get(k).cells.push({ a, col: col || '' });
    });
    const shown = groups.filter(g => tab === 'right' || g.cells.some(c => !c.a.isCorrect || unc.has(c.a.no)));
    const html = shown.map(g => `<div class="ss-tcard"><div class="ss-tcard__given">${esc(g.given)}</div><div class="ss-tcells">${g.cells.map(({ a, col }) => {
      const u = unc.has(a.no);
      const cls = !a.isCorrect ? ' ss-tcell--bad' : u ? ' ss-tcell--warn' : '';
      const note = !a.isCorrect ? `정답 ${esc(a.correctAnswer || '?')}` : u ? '확인 필요' : '맞음';
      const stu = String(a.studentAnswer || '').trim();
      return `<button class="ss-tcell${cls}" onclick="window._ssToggleAnswer(${idx}, ${a.no})" aria-label="눌러서 정답/오답 바꾸기"><small>${esc(col)}</small><b>${stu ? esc(stu) : '(빈칸)'}</b><i>${note}${a._adminOverride ? ' · 수정' : ''}</i></button>`;
    }).join('')}</div></div>`).join('');
    return { html, lines: shown.length, total: groups.length, badLines: groups.filter(g => g.cells.some(c => !c.a.isCorrect || unc.has(c.a.no))).length };
  }

  function _detailRowHtml(a, idx) {
    const unc = new Set((_state.students[idx].result.uncertainQuestions) || []);
    const blank = !String(a.studentAnswer || '').trim();
    const stuTxt = blank ? '(빈칸)' : esc(a.studentAnswer);
    return `<div class="ss-ans"><span class="ss-ans__no">${esc(a.no)}</span><div class="ss-ans__main"><div class="ss-ans__stem">${esc(a.stem || '')}${unc.has(a.no) ? ' ' + uiChip('애매', 'warn') : ''}${a._adminOverride ? ' ' + uiChip('수정', 'brand') : ''}</div>
      <div class="ss-ans__line">${a.isCorrect ? `<span>${stuTxt}</span>` : `<span class="ss-strike">${stuTxt}</span> `}<span class="ss-correct">${a.isCorrect ? '' : '정답 '}${a.isCorrect ? '' : esc(a.correctAnswer || '?')}</span></div></div>
      <button class="ss-toggle${a.isCorrect ? ' ss-toggle--ok' : ''}" aria-label="${a.isCorrect ? '정답' : '오답'} — 눌러서 바꾸기" onclick="window._ssToggleAnswer(${idx}, ${a.no})">${iconSvg(a.isCorrect ? 'check' : 'x')}</button></div>`;
  }

  function _renderDetailBody(idx) {
    const root = document.getElementById('ssDetailRoot'); if (!root) return;
    const s = _state.students[idx]; const r = s.result;
    const ans = r.answers || [];
    const unc = new Set(r.uncertainQuestions || []);
    const wrong = ans.filter(a => !a.isCorrect), check = ans.filter(a => unc.has(a.no)), right = ans.filter(a => a.isCorrect && !unc.has(a.no));
    const mode = _viewMode(r);
    const tab = _state.detailTab || 'wrong';
    const shown = tab === 'wrong' ? wrong : tab === 'check' ? check : right;
    const rowFn = mode === 'ee' ? _eeRowHtml : _detailRowHtml;
    const tbl = mode === 'table' ? _tableCards(ans, idx, tab === 'right' ? 'right' : 'wrong') : null;
    const pct = _pctOf(r);
    const nOverride = ans.filter(a => a._adminOverride).length;
    const keepName = document.getElementById('ssDetailNameIn');
    root.innerHTML = `
      <div class="ss-pad" style="background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:flex-end;gap:16px;">
        <div class="ss-grow"><div class="ss-sub">학생 이름</div><input class="ss-input ss-input--line" id="ssDetailNameIn" type="text" value="${esc(r.studentName || '')}" placeholder="이름 입력" style="font-size:24px;" oninput="window._ssEditStudentName(${idx}, this.value)"></div>
        <div class="ss-pts"><b class="${_tone(pct)}" style="font-size:40px;">${pct}<span style="font-size:20px;">점</span></b><small>${r.correctCount} / ${r.totalQuestions} 맞음</small></div>
      </div>
      <div class="ss-pad" style="padding-bottom:6px;">
        ${mode === 'table' ? `<div class="ss-tabs">
          <button class="ss-tab${tab !== 'right' ? ' ss-tab--on' : ''}" data-tone="bad" onclick="window._ssSetDetailTab('wrong')">틀림·확인 줄 ${tbl.badLines}</button>
          <button class="ss-tab${tab === 'right' ? ' ss-tab--on' : ''}" onclick="window._ssSetDetailTab('right')">전체 ${tbl.total}줄</button></div>` : `<div class="ss-tabs">
          <button class="ss-tab${tab === 'wrong' ? ' ss-tab--on' : ''}" data-tone="bad" onclick="window._ssSetDetailTab('wrong')">틀림 ${wrong.length}</button>
          ${check.length ? `<button class="ss-tab${tab === 'check' ? ' ss-tab--on' : ''}" data-tone="warn" onclick="window._ssSetDetailTab('check')">애매 ${check.length}</button>` : ''}
          <button class="ss-tab${tab === 'right' ? ' ss-tab--on' : ''}" data-tone="ok" onclick="window._ssSetDetailTab('right')">맞음 ${right.length}</button>
        </div>`}
        <div class="ss-vmode"><span>보기 방식</span><select onchange="window._ssSetViewPref(this.value)">${[['auto', '자동'], ['basic', '기본'], ['ee', '영영'], ['table', '표']].map(([v, l]) => `<option value="${v}"${(_state.viewPref || 'auto') === v ? ' selected' : ''}>${l}${v === 'auto' ? ' (' + ({ basic: '기본', ee: '영영', table: '표' }[mode]) + ')' : ''}</option>`).join('')}</select></div>
        ${unc.size ? (r.checked
          ? `<div class="ss-banner" style="margin-top:10px;background:var(--ok-bg);color:var(--ok);"><span>애매한 문항 ${unc.size}개 확인 완료</span><button class="ss-btn ss-btn--sm" onclick="window._ssSetChecked(${idx}, false)">${iconSvg('undo', 'ss-ic--sm')}<span>취소</span></button></div>`
          : `<div class="ss-banner" style="margin-top:10px;background:var(--warn-bg);color:var(--warn);"><span>애매한 문항 ${unc.size}개 — 사진과 비교해 확인하세요</span><button class="ss-btn ss-btn--sm ss-btn--primary" onclick="window._ssSetChecked(${idx}, true)">${iconSvg('check', 'ss-ic--sm')}<span>확인 완료 저장</span></button></div>`) : ''}
        ${nOverride ? `<div class="ss-banner" style="margin-top:10px;"><span>직접 수정 ${nOverride}개</span><button class="ss-btn ss-btn--sm" onclick="window._ssResetOverrides(${idx})">${iconSvg('undo', 'ss-ic--sm')}<span>AI 채점으로 되돌리기</span></button></div>` : ''}
        ${tab === 'wrong' && wrong.length ? '<div class="ss-hint">채점이 틀렸으면 오른쪽 표시를 눌러 바꿔 주세요.</div>' : ''}
      </div>
      <div class="ss-pad" style="padding-top:6px;"><div class="ss-list">${(mode === 'table' ? tbl.html : shown.map(a => rowFn(a, idx)).join('')) || '<div class="ss-center" style="padding:30px;"><div class="ss-sub">해당하는 문항이 없어요.</div></div>'}</div></div>`;
    if (keepName && document.activeElement === keepName) { const n2 = document.getElementById('ssDetailNameIn'); n2.focus(); n2.setSelectionRange(n2.value.length, n2.value.length); }
  }

  function _recalc(r) {
    r.correctCount = (r.answers || []).filter(x => x.isCorrect).length;
    r.scorePercent = r.totalQuestions > 0 ? Math.round((r.correctCount / r.totalQuestions) * 100) : 0;
    r.wrongNumbers = (r.answers || []).filter(x => !x.isCorrect).map(x => x.no);
  }
  window._ssToggleAnswer = function (idx, no) {
    const s = _state.students && _state.students[idx]; if (!s || !s.result) return;
    const a = (s.result.answers || []).find(x => x.no === no); if (!a) return;
    a.isCorrect = !a.isCorrect;
    a._adminOverride = typeof a._aiIsCorrect === 'boolean' ? (a.isCorrect !== a._aiIsCorrect) : true;
    s._markCache = null;
    _recalc(s.result); _markDirty(idx);
    _keepScroll(() => _renderDetailBody(idx));
    _pcAfterEdit(true);
  };
  window._ssResetOverrides = function (idx) {
    const s = _state.students && _state.students[idx]; if (!s || !s.result) return;
    (s.result.answers || []).forEach(a => { if (a._adminOverride && typeof a._aiIsCorrect === 'boolean') { a.isCorrect = a._aiIsCorrect; a._adminOverride = false; } });
    s._markCache = null;
    _recalc(s.result); _markDirty(idx);
    _keepScroll(() => _renderDetailBody(idx));
    _pcAfterEdit(true);
  };
  window._ssEditStudentName = function (idx, val) {
    const s = _state.students && _state.students[idx]; if (!s || !s.result) return;
    s.result.studentName = String(val || '').trim();
    _markDirty(idx);
    _pcAfterEdit(false);
  };

  // 성적표 PNG — 화면 밖에 카드를 그려 캡처 (화면 표시와는 별개)
  async function _ssCardCanvas(idx) {
    const s = _state.students && _state.students[idx];
    if (!s || !s.result) throw new Error('캡처할 학생이 없어요');
    await _ensureHtml2Canvas();
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:680px;';
    holder.innerHTML = `<div style="background:#fff;color:#222;padding:24px 28px;font-family:'Noto Sans KR','Malgun Gothic',sans-serif;">${_buildStudentDetailHtml(s, idx)}</div>`;
    document.body.appendChild(holder);
    try { return await window.html2canvas(holder.firstElementChild, { backgroundColor: '#ffffff', scale: 2, logging: false, useCORS: true }); }
    finally { holder.remove(); }
  }
  window._ssDownloadStudentPng = async function (idx) {
    const s = _state.students && _state.students[idx]; if (!s || !s.result) return;
    try {
      _ssToast('성적표를 만드는 중...');
      const canvas = await _ssCardCanvas(idx);
      canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const safe = v => String(v).replace(/[\\/:*?"<>|]/g, '_');
        const a = document.createElement('a'); a.href = url; a.download = `${safe(s.result.studentName || 'student_' + (idx + 1))}_${safe(_testNameOf(s.result))}_성적표.png`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    } catch (e) { _ssToast('성적표를 만들지 못했어요: ' + (e && e.message)); }
  };

  // 카톡 복사 = 채점 표시 사진(틀린 번호 V + 점수)을 클립보드로
  window._ssCopyMarked = async function (idx) {
    if (!navigator.clipboard || typeof window.ClipboardItem !== 'function') { _ssToast('이 기기는 이미지 복사를 지원하지 않아요 — [채점 표시 사진]에서 공유·저장을 사용하세요'); return; }
    const blobP = (async () => { const out = await _ssGetMarked(idx); return await new Promise(r => out.canvas.toBlob(r, 'image/png')); })();
    try { _ssToast('채점 표시 사진 준비 중...'); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]); _ssToast('복사했어요 — 카카오톡 대화창에서 붙여넣으세요'); }
    catch (e) { _ssToast('복사에 실패했어요: ' + (e && e.message)); }
  };

  // ─── 마킹 사진 만들기 (캐시 → 서버 저장본 → 새로 만들기). 옛 코드의 로직 그대로 ───
  async function _ssGetMarked(idx) {
    const x = _state.students && _state.students[idx];
    if (!x || !x.result) throw new Error('학생 결과가 없어요');
    const key = (x.result.answers || []).filter(a => !a.isCorrect).map(a => a.no).join(',') + '|' + x.result.correctCount + '/' + x.result.totalQuestions + '|v2';   // v2: 번호 위치 계산 개선 — 이전에 저장된 마킹 사진은 재생성
    if (x._markCache && x._markCache.key === key) return { canvas: x._markCache.canvas, missing: x._markCache.missing, x };
    let out;
    if (x.markPath && x.markKey === key && _store()) {
      try {
        const blob = await (await fetch(await _store().getImageUrl(x.markPath), { cache: 'reload' })).blob();
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
      if (_store() && _state.sid && x.docId) {
        const sid = _state.sid, cv = out.canvas, miss = out.missing;
        cv.toBlob(b => {
          if (!b) return;
          _store().saveMark(sid, x.docId, b, key, miss).then(path => { x.markPath = path; x.markKey = key; x.markMissing = miss; })
            .catch(e => console.warn('[scoresnap] 마킹 사진 서버 저장 실패:', e && e.message));
        }, 'image/jpeg', 0.92);
      }
    }
    x._markCache = { key, canvas: out.canvas, missing: out.missing };
    if (_state.phase === 'pc') _pcRenderStudents();
    return { canvas: out.canvas, missing: out.missing, x };
  }

  // 번호(또는 표 칸)의 사진 속 위치(0~1 비율) — 틀린 번호 칩을 누르면 그곳으로 확대 이동
  function _ssMarkTarget(x, no) {
    const p = x.result && x.result.markPos; if (!p) return null;
    if (p.nums && p.nums[no]) { const b = p.nums[no]; return { nx: b.x1, ny: (b.y1 + b.y2) / 2 }; }
    if (p.cells && p.cells[no]) return { nx: p.cells[no].x, ny: p.cells[no].y };
    return null;
  }

  // ─── 3-7. 마킹 사진 보기 (어두운 전체 화면, 확대·이동) ───
  window._ssOpenMarked = async function (idx, startMode) {
    const vw = { idx, mode: startMode || 'mark', scale: 1, fit: 1, tx: 0, ty: 0, iw: 0, ih: 0, token: 0 };
    const ov = document.createElement('div');
    ov.className = 'ss-vw'; ov.setAttribute('data-ss-sub', '1');
    ov.innerHTML = `
      <div class="ss-vw__head">${uiIconBtn('x', '닫기', { id: 'vwX' })}<div class="t"><b id="vwTitle"></b><small id="vwSub"></small></div>
        <div class="ss-tabs"><button class="ss-tab ss-tab--on" data-m="mark">표시</button><button class="ss-tab" data-m="orig">원본</button></div></div>
      <div class="ss-vw__main"><div class="ss-vw__stage" id="vwStage"><img id="vwImg" alt="" draggable="false"><div class="ss-vw__tip" id="vwTip">두 손가락으로 확대 · 두 번 탭하면 맞춤</div></div><aside class="ss-vw__side" id="vwSide"></aside></div>
      <div class="ss-vw__chips" id="vwChips"></div>
      <div class="ss-vw__bar">${uiBtn({ icon: 'chevron-left', id: 'vwPrev' })}${uiBtn({ kind: 'primary', size: 'lg', icon: 'share', label: '카톡으로 공유', id: 'vwShare' })}${uiBtn({ icon: 'download', id: 'vwSave' })}${uiBtn({ icon: 'chevron-right', id: 'vwNext' })}</div>`;
    ov._ssCancel = () => { document.removeEventListener('keydown', onKey); ov.remove(); };
    const close = () => { document.removeEventListener('keydown', onKey); _ssSubRemove(ov); };
    document.body.appendChild(ov);
    _ssPushSub(ov);
    const $v = (id) => ov.querySelector('#' + id);
    const stage = $v('vwStage'), img = $v('vwImg');
    setTimeout(() => { const t = $v('vwTip'); if (t) t.style.display = 'none'; }, 3500);

    const apply = () => { img.style.transform = `translate(${vw.tx}px, ${vw.ty}px) scale(${vw.scale})`; };
    const fitView = () => {
      const r = stage.getBoundingClientRect();
      vw.fit = Math.min(r.width / vw.iw, r.height / vw.ih) || 1;
      vw.scale = vw.fit; vw.tx = (r.width - vw.iw * vw.scale) / 2; vw.ty = (r.height - vw.ih * vw.scale) / 2; apply();
    };
    const zoomAt = (cx, cy, ns) => {
      ns = Math.min(vw.fit * 8, Math.max(vw.fit * 0.8, ns));
      vw.tx = cx - (cx - vw.tx) * (ns / vw.scale); vw.ty = cy - (cy - vw.ty) * (ns / vw.scale); vw.scale = ns; apply();
    };
    const focusOn = (nx, ny) => {
      const r = stage.getBoundingClientRect(); const ns = vw.fit * 2.6;
      vw.scale = ns; vw.tx = r.width / 2 - nx * vw.iw * ns; vw.ty = r.height / 2 - ny * vw.ih * ns; apply();
    };

    async function show(i, mode) {
      const my = ++vw.token;
      vw.idx = i; vw.mode = mode;
      const x = _state.students[i]; const r = x.result;
      const pct = _pctOf(r);
      $v('vwTitle').textContent = `${(r.studentName || '').trim() || '이름 없음'} · ${pct}점`;
      const wrongNos = (r.answers || []).filter(a => !a.isCorrect).map(a => a.no);
      $v('vwSub').textContent = `${r.correctCount}/${r.totalQuestions} · 틀린 문항 ${wrongNos.length}개`;
      ov.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('ss-tab--on', b.dataset.m === mode));
      const nb = _detailNeighbors(i);
      $v('vwPrev').disabled = nb.prev < 0; $v('vwNext').disabled = nb.next < 0;
      $v('vwSide').innerHTML = `<div class="ss-vw__sidehead">틀린 문항 ${wrongNos.length}개</div>` + ((r.answers || []).filter(a => !a.isCorrect).map(a => `<button class="ss-vw__wr" data-n="${a.no}"><b>${a.no}</b><span><span class="q">${esc(a.stem || '')}</span><br><span class="st">${esc(String(a.studentAnswer || '').trim() || '(빈칸)')}</span> → <span class="ok">${esc(a.correctAnswer || '?')}</span></span></button>`).join('') || '<div class="ss-sub" style="padding:14px;color:#c4c7c5;">틀린 문항이 없어요</div>');
      $v('vwChips').innerHTML = wrongNos.length ? `<span>틀린 번호</span>${wrongNos.map(n => `<button class="ss-vw__chip" data-n="${n}">${n}</button>`).join('')}` : '<span>틀린 문항이 없어요</span>';
      let url = '';
      try {
        if (mode === 'mark') {
          _ssToast(x.markPath ? '저장된 마킹 사진 불러오는 중...' : '마킹 사진 만드는 중... (처음 한 번만, 학원 PC가 처리해요)');
          const out = await _ssGetMarked(i);
          if (my !== vw.token) return;
          vw.blob = await new Promise(res => out.canvas.toBlob(res, 'image/png'));
          url = out.canvas.toDataURL('image/png');
          if (out.missing) _ssToast(`번호 위치를 못 찾은 문항 ${out.missing}개는 V가 빠졌어요`);
        } else {
          const im = await _ssLoadImageEl(x);
          if (my !== vw.token) return;
          url = im.src; vw.blob = null;
        }
      } catch (e) { _ssToast('사진을 만들 수 없어요: ' + (e && e.message)); return; }
      img.onload = () => { vw.iw = img.naturalWidth; vw.ih = img.naturalHeight; fitView(); };
      img.src = url;
      // 틀린 번호 칩

    }

    $v('vwX').onclick = close;
    ov.querySelectorAll('[data-m]').forEach(b => { b.onclick = () => show(vw.idx, b.dataset.m); });
    $v('vwChips').onclick = $v('vwSide').onclick = (e) => {
      const c = e.target.closest('[data-n]'); if (!c) return;
      const t = _ssMarkTarget(_state.students[vw.idx], +c.dataset.n);
      if (t) focusOn(t.nx, t.ny); else _ssToast('이 문항의 위치를 알 수 없어요');
    };
    $v('vwPrev').onclick = () => { const n = _detailNeighbors(vw.idx).prev; if (n >= 0) show(n, vw.mode); };
    $v('vwNext').onclick = () => { const n = _detailNeighbors(vw.idx).next; if (n >= 0) show(n, vw.mode); };
    const fname = () => { const r = _state.students[vw.idx].result; const safe = v => String(v).replace(/[\\/:*?"<>|]/g, '_'); return `${safe(r.studentName || '학생' + (vw.idx + 1))}_${safe(_testNameOf(r))}_채점.png`; };
    $v('vwSave').onclick = () => {
      if (!vw.blob) return _ssToast('저장은 [표시] 사진에서 할 수 있어요');
      const u = URL.createObjectURL(vw.blob); const a = document.createElement('a'); a.href = u; a.download = fname();
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000);
    };
    $v('vwShare').onclick = async () => {
      if (!vw.blob) return _ssToast('공유는 [표시] 사진에서 할 수 있어요');
      const file = new File([vw.blob], fname(), { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: fname() }); } catch (e) { /* 취소 */ }
      } else if (navigator.clipboard && typeof window.ClipboardItem === 'function') {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': vw.blob })]); _ssToast('복사했어요 — 카카오톡에서 붙여넣으세요'); } catch (e) { $v('vwSave').click(); }
      } else $v('vwSave').click();
    };
    // 두 손가락 확대·이동, 두 번 탭 = 맞춤/확대, 마우스 휠 확대
    const pts = new Map(); let pinch = null, pan = null, lastTap = 0;
    const rect = () => stage.getBoundingClientRect();
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: vw.scale, tx: vw.tx, ty: vw.ty, mx: (a.x + b.x) / 2 - rect().left, my: (a.y + b.y) / 2 - rect().top }; pan = null; }
      else { pan = { x: e.clientX - vw.tx, y: e.clientY - vw.ty }; const now = Date.now(); if (now - lastTap < 320) { const r = rect(); if (vw.scale > vw.fit * 1.2) fitView(); else zoomAt(e.clientX - r.left, e.clientY - r.top, vw.fit * 2.6); } lastTap = now; }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const ns = Math.min(vw.fit * 8, Math.max(vw.fit * 0.8, pinch.s * d / pinch.d));
        vw.tx = pinch.mx - (pinch.mx - pinch.tx) * (ns / pinch.s); vw.ty = pinch.my - (pinch.my - pinch.ty) * (ns / pinch.s); vw.scale = ns; apply();
      } else if (pan && pts.size === 1) { vw.tx = e.clientX - pan.x; vw.ty = e.clientY - pan.y; apply(); }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 1) { const p = [...pts.values()][0]; pan = { x: p.x - vw.tx, y: p.y - vw.ty }; } else if (!pts.size) pan = null; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); const r = rect(); zoomAt(e.clientX - r.left, e.clientY - r.top, vw.scale * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') $v('vwPrev').click();
      else if (e.key === 'ArrowRight') $v('vwNext').click();
    }
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => { if (vw.iw) fitView(); });
    await show(idx, startMode || 'mark');
  };
  // ───────────────────────────────────────────────────────────────────────────
  // 4단계 · PC 레이아웃 (폭 1024px 이상): 기록 | 학생 목록 | 학생 상세(사진 + 문항표) 3칸
  // 새 시험·정답지·답안지 추가 화면은 폰 화면을 가운데 정렬해 그대로 쓴다.
  // ───────────────────────────────────────────────────────────────────────────
  const _isPc = () => window.innerWidth >= 1024;
  let _pcSess = null;                      // 기록 목록 캐시 (화면을 오가도 유지)

  async function _pcLoadSessions(force) {
    if (_pcSess && !force) return;
    try { _pcSess = await _store().listSessions(); } catch (e) { console.warn('[scoresnap] 기록 목록 실패:', e && e.message); _pcSess = _pcSess || []; }
    if (_state.phase === 'pc') _pcRenderSessions();
  }

  // ─── 열 너비 조절 (경계를 끌면 변경, 더블클릭 = 기본값) — 이 브라우저에 저장 ───
  const _PC_COLS = { pc1: [260, 180, 420], pc2: [320, 240, 560], pcp: [0, 280, 1400] };   // [기본, 최소, 최대]  pcp(사진 폭) 기본 0 = 비율
  function _pcColsLoad() { try { return JSON.parse(localStorage.getItem('ssPcCols') || '{}') || {}; } catch (_) { return {}; } }
  function _pcColsApply() {
    const g = document.getElementById('ssPcGrid'); if (!g) return;
    const v = _pcColsLoad();
    g.style.setProperty('--pc1', (v.pc1 || _PC_COLS.pc1[0]) + 'px');
    g.style.setProperty('--pc2', (v.pc2 || _PC_COLS.pc2[0]) + 'px');
    g.style.setProperty('--pcp', v.pcp ? v.pcp + 'px' : '0.9fr');
  }
  function _pcWireResize(handle, key) {
    if (!handle) return;
    handle.ondblclick = () => { const v = _pcColsLoad(); delete v[key]; try { localStorage.setItem('ssPcCols', JSON.stringify(v)); } catch (_) {} _pcColsApply(); };
    handle.onpointerdown = (e) => {
      e.preventDefault(); handle.setPointerCapture(e.pointerId);
      const g = document.getElementById('ssPcGrid');
      const cur = key === 'pcp' ? (document.querySelector('.ss-pc__photo') || {}).offsetWidth : parseFloat(getComputedStyle(g).getPropertyValue('--' + key));
      const x0 = e.clientX, [, mn, mx0] = _PC_COLS[key];
      const mx = key === 'pcp' ? Math.min(mx0, ((document.querySelector('.ss-pc__two') || {}).offsetWidth || 1000) - 240) : mx0;
      handle.classList.add('on');
      const move = (ev) => {
        const w = Math.round(Math.min(mx, Math.max(mn, cur + (key === 'pcp' ? -1 : 1) * (ev.clientX - x0))));
        g.style.setProperty('--' + key, w + 'px');
      };
      const up = () => {
        handle.releasePointerCapture(e.pointerId); handle.classList.remove('on');
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
        const w = parseFloat(g.style.getPropertyValue('--' + key));
        const v = _pcColsLoad(); v[key] = w; try { localStorage.setItem('ssPcCols', JSON.stringify(v)); } catch (_) {}
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    };
  }

  function _renderPc() {
    _state.phase = 'pc';
    const body = _body(); if (!body) return;
    if (!document.getElementById('ssPcSess')) {
      body.innerHTML = `
        <div class="ss-pc__grid" id="ssPcGrid"><aside class="ss-pc__c1" id="ssPcSess"></aside><section class="ss-pc__c2" id="ssPcStu"></section><section class="ss-pc__c3" id="ssPcDet"></section><i class="ss-pc__rs" id="ssPcRs1" title="끌어서 너비 조절 (더블클릭 = 기본값)"></i><i class="ss-pc__rs" id="ssPcRs2" title="끌어서 너비 조절 (더블클릭 = 기본값)"></i></div>`;
      _pcColsApply(); _pcWireResize(document.getElementById('ssPcRs1'), 'pc1'); _pcWireResize(document.getElementById('ssPcRs2'), 'pc2');
    }
    _pcRenderSessions(); _pcRenderStudents(); _pcRenderDetail();
    _pcLoadSessions(!_pcSess);
  }

  function _pcRenderSessions() {
    const el = document.getElementById('ssPcSess'); if (!el) return;
    const rows = (_pcSess || []).map(x => {
      const n = x.studentCount || 0;
      const sub = [_fmtAgo(x.createdAtMs), x.questionCount ? `${x.questionCount}문항` : '', n ? `${n}명` : '', (n && typeof x.avgScore === 'number') ? `평균 ${x.avgScore}` : ''].filter(Boolean).join(' · ');
      return `<button class="ss-row ss-row--tap${x.id === _state.sid ? ' ss-row--on' : ''}" data-sid="${esc(x.id)}" data-ms="${esc(x.createdAtMs || 0)}"><span class="ss-grow"><b class="ss-title" style="display:block;word-break:break-word;">${esc(x.testName || '시험')}</b><span class="ss-sub">${esc(sub)}</span></span>${x.needCheck > 0 ? uiChip(`확인 ${x.needCheck}`, 'warn') : ''}<span class="ss-del" role="button" tabindex="0" data-del="${esc(x.id)}" title="이 기록 삭제" aria-label="이 기록 삭제">${iconSvg('trash')}</span></button>`;
    }).join('');
    el.innerHTML = `<div class="ss-pc__h">${uiBtn({ kind: 'primary', block: true, icon: 'plus', label: '새 시험 채점', id: 'ssPcNew' })}</div>
      <div class="ss-pc__scroll" id="ssPcSessScroll">${_pcSess ? (rows || '<div class="ss-center"><div class="ss-sub">채점 기록이 없어요</div></div>') : '<div class="ss-center"><div class="ss-spinner"></div></div>'}</div>`;
    document.getElementById('ssPcNew').onclick = () => window._ssNewExam();
    const sc = document.getElementById('ssPcSessScroll');
    sc.onclick = (e) => { const d = e.target.closest('[data-del]'); if (d) { e.stopPropagation(); return window._pcDeleteSession(d.dataset.del); } const b = e.target.closest('[data-sid]'); if (b && b.dataset.sid !== _state.sid) _ssOpenServerSession(b.dataset.sid, { createdAtMs: +b.dataset.ms || 0 }); };
  }

  // 왼쪽 목록에서 기록 삭제 — 지금 열려 있는 기록이면 화면도 비운다
  window._pcDeleteSession = async function (sid) {
    const row = (_pcSess || []).find(x => x.id === sid);
    const ok = typeof window.showConfirm === 'function'
      ? await window.showConfirm('채점 기록 삭제', `"${(row && row.testName) || '시험'}" 기록과 답안지 사진을 삭제할까요?
(폰·PC 모두에서 사라져요)`) : true;
    if (!ok) return;
    try {
      await _store().deleteSession(sid);
      _pcSess = (_pcSess || []).filter(x => x.id !== sid);
      if (_state.sid === sid) { _stopWatch(); _state.sid = null; _state.students = []; _state.answerKey = null; _state.detailIdx = -1; _pcRenderStudents(); _pcRenderDetail(); }
      _pcRenderSessions();
      _ssToast('삭제했어요');
    } catch (e) { _ssToast('삭제 실패: ' + (e && e.message)); }
  };

  function _pcRenderStudents() {
    const el = document.getElementById('ssPcStu'); if (!el) return;
    if (!_state.sid) { el.innerHTML = '<div class="ss-center"><div class="ss-sub">왼쪽에서 채점 기록을 고르거나<br>[새 시험 채점]으로 시작하세요.</div></div>'; return; }
    const prevTop = (document.getElementById('ssPcStuScroll') || {}).scrollTop || 0;
    const all = _state.students || [];
    const done = all.filter(s => s.status === 'done' && s.result);
    const avg = done.length ? Math.round(done.reduce((a, s) => a + _pctOf(s.result), 0) / done.length) : 0;
    const nCheck = done.filter(_needsCheck).length;
    const sort = _state.sort || 'order';
    let rows = all.map((s, i) => ({ s, i }));
    if (_state.onlyCheck) rows = rows.filter(o => _needsCheck(o.s));
    if (sort === 'low') rows.sort((a, b) => (a.s.status === 'done' ? _pctOf(a.s.result) : 999) - (b.s.status === 'done' ? _pctOf(b.s.result) : 999));
    else if (sort === 'name') rows.sort((a, b) => String((a.s.result && a.s.result.studentName) || '힣').localeCompare(String((b.s.result && b.s.result.studentName) || '힣'), 'ko'));
    const rowHtml = rows.map(({ s, i }, n) => {
      const r = s.result, on = i === _state.detailIdx ? ' ss-row--on' : '';
      if (s.status === 'error') return `<button class="ss-row ss-row--tap" data-retry="${esc(s.docId)}" style="background:var(--bad-bg);"><span class="ss-rank">${n + 1}</span><span class="ss-grow"><b class="ss-title ss-tone-bad">채점 실패</b><span class="ss-sub" style="display:block;">눌러서 다시 채점</span></span></button>`;
      if (s.status !== 'done') return `<div class="ss-row"><span class="ss-rank">${n + 1}</span><span class="ss-grow"><b class="ss-title" style="color:var(--sub);">${s.status === 'grading' ? '채점 중…' : '채점 대기'}</b></span></div>`;
      const pct = _pctOf(r);
      return `<button class="ss-row ss-row--tap${on}" data-open="${i}"><span class="ss-rank">${n + 1}</span><span class="ss-grow"><b class="ss-title" style="${_noName(r) ? 'color:var(--sub);font-weight:600;' : ''}">${_noName(r) ? '이름 입력 필요' : esc(r.studentName)}</b> ${_hasMark(s) ? `<span class="ss-mk" title="마킹 사진 있음" aria-label="마킹 사진 있음">${iconSvg('check')}</span>` : ''}${_isUncertain(r) ? uiChip('확인', 'warn') : ''}${s.kakaoSentAt ? uiChip('보냄', 'ok') : ''}</span><span class="ss-pts"><b class="${_tone(pct)}">${pct}점</b><small>${r.correctCount}/${r.totalQuestions}</small></span></button>`;
    }).join('');
    el.innerHTML = `
      <div class="ss-pc__h"><div class="ss-stats">
        <div class="ss-stat"><small>평균</small><b>${avg}<span style="font-size:14px;">점</span></b></div>
        <div class="ss-stat"><small>채점</small><b>${done.length}<span style="font-size:14px;">명</span></b></div>
        <button class="ss-stat ss-stat--warn" style="text-align:left;border:1px solid var(--warn-bd);${_state.onlyCheck ? 'outline:2px solid var(--warn);' : ''}" onclick="window._ssToggleOnlyCheck()"><small>확인</small><b>${nCheck}<span style="font-size:14px;">명</span></b></button></div>
        <div style="display:flex;gap:6px;margin-top:8px;align-items:center;">${[['order', '순서'], ['low', '낮은 점수'], ['name', '이름']].map(([v, l]) => `<button class="ss-pill${sort === v ? ' ss-pill--on' : ''}" onclick="window._ssSetSort('${v}')">${l}</button>`).join('')}<span class="ss-grow"></span>${uiIconBtn('refresh', '새로고침', { onclick: 'window._ssRefreshFromServer()' })}${uiIconBtn('more', '메뉴', { id: 'ssPcMore' })}</div></div>
      <div class="ss-pc__scroll" id="ssPcStuScroll"><div class="ss-list" style="border-radius:0;border-left:0;border-right:0;">${rowHtml || '<div class="ss-center" style="padding:30px;"><div class="ss-sub">표시할 학생이 없어요.</div></div>'}</div></div>
      <div class="ss-pc__h" style="border-top:1px solid var(--border);display:grid;gap:8px;">${uiBtn({ kind: 'primary', block: true, icon: 'share', label: `카톡 연속 전송 (${done.length}명)`, onclick: 'window._ssOpenKakao()', disabled: !done.length })}${uiBtn({ block: true, icon: 'plus', label: '답안지 더 추가', id: 'ssPcAdd' })}</div>`;
    const sc = document.getElementById('ssPcStuScroll'); if (sc) { sc.scrollTop = prevTop; }
    document.getElementById('ssPcAdd').onclick = () => window._ssBackToStudentCapture();
    document.getElementById('ssPcMore').onclick = () => _ssSheet([
      { label: '폰으로 열기 (QR)', icon: 'camera', fn: () => window._ssShowQr() },
      { label: '정답지 확인·수정', icon: 'edit', fn: () => window._ssEditKey() },
      { label: '정답 목록 보기', icon: 'list', fn: () => window._ssViewKeyList() },
      { label: '정답지 사진 보기', icon: 'image', fn: () => window._ssViewKeyImage() },
      { label: '정답지 다시 올리기', icon: 'refresh', fn: () => window._ssReplaceAnswerKey() },
      { label: '이 기록 삭제', icon: 'trash', danger: true, fn: () => window._ssDeleteCurrentSession() },
    ]);
    sc.onclick = (e) => {
      const rt = e.target.closest('[data-retry]'); if (rt) return window._ssRetryStudent(rt.dataset.retry);
      const o = e.target.closest('[data-open]'); if (o) window._ssOpenStudentDetail(+o.dataset.open);
    };
  }

  function _pcRenderDetail() {
    const el = document.getElementById('ssPcDet'); if (!el) return;
    if (!_state.sid) { el.innerHTML = ''; return; }
    let idx = _state.detailIdx;
    const ok = (i) => { const s = _state.students && _state.students[i]; return s && s.status === 'done' && s.result; };
    if (!ok(idx)) {
      idx = (_state.students || []).findIndex((s) => s.status === 'done' && s.result);
      if (idx < 0) { el.innerHTML = '<div class="ss-center"><div class="ss-sub">채점이 끝난 학생이 아직 없어요.</div></div>'; return; }
      _state.detailIdx = idx;
      const w = (_state.students[idx].result.answers || []).filter(a => !a.isCorrect).length;
      _state.detailTab = w ? 'wrong' : 'right';
    }
    const s = _state.students[idx], nb = _detailNeighbors(idx);
    const mode = _state.pcPhotoMode || 'orig', zoom = _state.pcZoom || 100;
    el.innerHTML = `
      <div class="ss-pc__bar">
        ${uiIconBtn('chevron-up', '이전 학생 (↑)', { box: true, disabled: nb.prev < 0, onclick: `window._ssDetailGo(${nb.prev})` })}
        ${uiIconBtn('chevron-down', '다음 학생 (↓)', { box: true, disabled: nb.next < 0, onclick: `window._ssDetailGo(${nb.next})` })}
        <span class="ss-sub" style="font-weight:700;">${nb.pos} / ${nb.total}</span><span class="ss-grow"></span>
        ${uiBtn({ icon: 'download', label: '성적표 저장', onclick: `window._ssDownloadStudentPng(${idx})` })}
        ${uiBtn({ kind: 'primary', icon: 'copy', label: '카톡용 복사 (Ctrl+C)', onclick: `window._ssCopyMarked(${idx})` })}
      </div>
      <div class="ss-pc__two">
        <div class="ss-pc__rows"><div class="ss-scroll" id="ssScroll"><div id="ssDetailRoot"></div></div></div>
        <div class="ss-pc__photo"><i class="ss-pc__rs ss-pc__rs--in" id="ssPcRs3" title="끌어서 너비 조절 (더블클릭 = 기본값)"></i>
          <div class="ss-pc__bar" style="border-bottom:1px solid var(--border);">
            <div class="ss-tabs"><button class="ss-tab${mode === 'mark' ? ' ss-tab--on' : ''}" onclick="window._pcSetPhotoMode('mark')">채점 표시</button><button class="ss-tab${mode === 'orig' ? ' ss-tab--on' : ''}" onclick="window._pcSetPhotoMode('orig')">원본</button></div>
            <span class="ss-grow"></span>
            ${uiIconBtn('minus', '축소', { box: true, onclick: 'window._pcZoom(-25)' })}<span class="ss-sub" id="ssPcZoomLbl" style="min-width:44px;text-align:center;font-weight:700;">${zoom}%</span>${uiIconBtn('plus', '확대', { box: true, onclick: 'window._pcZoom(25)' })}
            ${uiBtn({ size: 'sm', label: '맞춤', onclick: 'window._pcZoom(0)' })}${uiIconBtn('maximize', '전체 화면', { box: true, onclick: `window._ssOpenMarked(${idx}, _state.pcPhotoMode || 'orig')` })}
          </div>
          <div class="ss-pc__photobox" id="ssPcPhotoBox"></div>
          <div class="ss-chat" id="ssChat"></div>
        </div>
      </div>`;
    _renderDetailBody(idx);
    _pcWireResize(document.getElementById('ssPcRs3'), 'pcp');
    _pcPhoto();
    _pcRenderChat();
  }

  // ─── 일반 질문 도우미 (모든 화면, 오른쪽 위 [질문] 버튼) — 정답지 인식·앱 사용·채점 규칙 + 개발자에게 전달 ───
  let _gchat = [];
  function _genCtx() {
    const k = _state.answerKey || {};
    const qs = (k.questions || []).slice(0, 40).map(q => ({ no: q.no, stem: String(q.stem || '').slice(0, 60), answer: String(q.answer || '').slice(0, 60), confidence: q.confidence }));
    const done = (_state.students || []).filter(x => x.status === 'done').length;
    return {
      화면: _state.phase, 폭: window.innerWidth >= 1024 ? 'PC' : '폰', 시험이름: k.testName || '', 형태선택: _state.layoutHint || '',
      정답지형태: k.layout || '', 정답지문항수: (k.questions || []).length, 정답지문항: qs, 열: k.layout === 'table' ? { 기준: k.givenColumn, 답: k.answerColumns } : undefined,
      정밀모드: _state.precision === true, 학생수: (_state.students || []).length, 채점완료: done,
      PC채점프로그램: window._ssWorker ? (window._ssWorker.online ? '켜짐' : '꺼짐') : '알 수 없음',
    };
  }
  window._ssOpenHelp = function () {
    if (document.getElementById('ssHelp')) return;
    const dr = document.createElement('div');
    dr.className = 'ss-drawer'; dr.id = 'ssHelp'; dr.setAttribute('data-ss-sub', '1');
    dr._ssCancel = () => dr.remove();
    document.body.appendChild(dr);
    _ssPushSub(dr);
    _helpRender();
  };
  function _helpRender() {
    const dr = document.getElementById('ssHelp'); if (!dr) return;
    const body = _gchat.map(m => m.role === 'user'
      ? `<div class="ss-chat__m ss-chat__m--me">${esc(m.text)}</div>`
      : `<div class="ss-chat__m">${m.pending ? '<span class="ss-spinner ss-spinner--sm"></span> 확인하는 중…' : esc(m.text).replace(/\n/g, '<br>')}</div>`).join('');
    const hints = ['정답지 문항이 제대로 안 읽혀요. 어떻게 하면 좋아요?', '번호형과 표 형식은 뭐가 달라요?', '애매 표시는 어떤 기준이에요?'];
    dr.innerHTML = `<div class="ss-drawer__head"><b>질문 · 도움말</b>${uiIconBtn('x', '닫기', { onclick: 'window._ssCloseHelp()' })}</div>
      <div class="ss-sub" style="padding:0 14px 6px;">학원 PC의 Claude가 지금 화면 상태를 보고 답해요. 앱 자체의 문제나 요청은 [개발자에게 전달]로 남겨 주세요.</div>
      <div class="ss-chat__list" id="ssHelpList" style="flex:1;padding:6px 14px;">${body || `<div class="ss-chat__hints">${hints.map(h => `<button class="ss-pill" data-hint="${esc(h)}">${esc(h)}</button>`).join('')}</div>`}</div>
      <form class="ss-chat__form" id="ssHelpForm"><input class="ss-input" id="ssHelpIn" type="text" placeholder="질문을 입력하세요" autocomplete="off"><button class="ss-btn ss-btn--primary" type="submit">보내기</button></form>
      <div style="padding:0 14px 12px;display:flex;gap:8px;">${uiBtn({ size: 'sm', icon: 'share', label: '개발자에게 전달', onclick: 'window._ssSendFeedback()' })}${_gchat.length ? uiBtn({ size: 'sm', label: '대화 지우기', onclick: 'window._ssClearHelp()' }) : ''}</div>`;
    const lst = document.getElementById('ssHelpList'); lst.scrollTop = lst.scrollHeight;
    document.getElementById('ssHelpForm').onsubmit = (e) => { e.preventDefault(); const i = document.getElementById('ssHelpIn'); const t = i.value.trim(); if (t) { i.value = ''; window._ssHelpSend(t); } };
    dr.querySelectorAll('[data-hint]').forEach(b => { b.onclick = () => window._ssHelpSend(b.dataset.hint); });
  }
  window._ssCloseHelp = function () { const dr = document.getElementById('ssHelp'); if (dr) _ssSubRemove(dr); };
  window._ssClearHelp = function () { _gchat = []; _helpRender(); };
  window._ssHelpSend = async function (text) {
    if (_gchat.some(m => m.pending)) { _ssToast('이전 답변을 기다리는 중이에요'); return; }
    const history = _gchat.map(m => ({ role: m.role, text: m.text }));
    _gchat.push({ role: 'user', text }); const ai = { role: 'ai', text: '', pending: true }; _gchat.push(ai); _helpRender();
    let temp = '';
    try {
      // 사진이 필요한 상황(정답지 검토 등)이면 그 사진을 같이 보낸다
      let imagePath = '';
      if (_state.phase === 'answerKey-review' && _state.answerKeyImage) imagePath = temp = await _store().uploadTemp(_state.answerKeyImage);
      else if (_state.keyImagePath) imagePath = _state.keyImagePath;
      const out = await _store().ask(imagePath, { mode: 'general', question: text, history, context: _genCtx() });
      ai.text = out.answer || '(답변이 비어 있어요)';
    } catch (e) { ai.text = '답변을 받지 못했어요: ' + (e && e.message); }
    ai.pending = false;
    if (temp) _store().deleteTemp(temp);
    _helpRender();
  };
  window._ssSendFeedback = async function () {
    if (!_gchat.length) { _ssToast('남길 대화가 없어요. 먼저 질문이나 요청 내용을 적어 주세요'); return; }
    try {
      await _store().saveFeedback({ context: _genCtx(), sid: _state.sid || '', messages: _gchat.filter(m => !m.pending).map(m => ({ role: m.role, text: m.text })) });
      _ssToast('개발자에게 전달했어요');
    } catch (e) { _ssToast('전달하지 못했어요: ' + (e && e.message)); }
  };

  // ─── 채점 질문 채팅 (PC 사진 아래) — 학원 PC 의 Claude 가 답안지 사진을 다시 보고 답한다 ───
  const _CHAT_HINTS = ['틀린 문항이 맞는지 다시 봐줘', '애매한 문항이 왜 애매해?', '이름이 맞게 읽혔어?'];
  function _chatList(x) { if (!_state.chat) _state.chat = {}; return (_state.chat[x.docId] = _state.chat[x.docId] || []); }
  function _pcRenderChat() {
    const el = document.getElementById('ssChat'); if (!el) return;
    const x = _state.students && _state.students[_state.detailIdx]; if (!x || !x.result) { el.innerHTML = ''; return; }
    const msgs = _chatList(x), idx = _state.detailIdx;
    const body = msgs.map((m, i) => m.role === 'user'
      ? `<div class="ss-chat__m ss-chat__m--me">${esc(m.text)}</div>`
      : `<div class="ss-chat__m">${m.pending ? '<span class="ss-spinner ss-spinner--sm"></span> 사진을 다시 보는 중…' : esc(m.text).replace(/\n/g, '<br>')}${(m.corrections || []).map((c, k) => {
          const a = (x.result.answers || []).find(q => q.no === c.no);
          const done = a && a.isCorrect === c.isCorrect;
          return `<div class="ss-chat__fix"><span>${c.no}번 → <b>${c.isCorrect ? '정답' : '오답'}</b>${c.reason ? ' · ' + esc(c.reason) : ''}</span>${done ? uiChip('적용됨', 'ok') : `<button class="ss-btn ss-btn--sm ss-btn--primary" onclick="window._chatApply(${idx}, ${c.no}, ${c.isCorrect})">수정 적용</button>`}</div>`;
        }).join('')}</div>`).join('');
    el.innerHTML = `<div class="ss-chat__head"><b>채점 질문</b><span class="ss-sub">학원 PC의 Claude가 이 학생 사진을 다시 보고 답해요</span></div>
      <div class="ss-chat__list" id="ssChatList">${body || `<div class="ss-sub" style="padding:6px 2px;">예) “5번이 왜 오답이야?” — 사진과 채점 결과를 보고 설명하고, 잘못됐으면 정정을 제안해요.</div><div class="ss-chat__hints">${_CHAT_HINTS.map(h => `<button class="ss-pill" data-hint="${esc(h)}">${esc(h)}</button>`).join('')}</div>`}</div>
      <form class="ss-chat__form" id="ssChatForm"><input class="ss-input" id="ssChatIn" type="text" placeholder="질문을 입력하세요" autocomplete="off"><button class="ss-btn ss-btn--primary" type="submit">보내기</button></form>`;
    const lst = document.getElementById('ssChatList'); lst.scrollTop = lst.scrollHeight;
    document.getElementById('ssChatForm').onsubmit = (e) => { e.preventDefault(); const inp = document.getElementById('ssChatIn'); const t = inp.value.trim(); if (t) { inp.value = ''; window._chatSend(t); } };
    el.querySelectorAll('[data-hint]').forEach(b => { b.onclick = () => window._chatSend(b.dataset.hint); });
  }
  window._chatSend = async function (text) {
    const idx = _state.detailIdx, x = _state.students && _state.students[idx];
    if (!x || !x.result) return;
    if (!x.imagePath) { _ssToast('이 학생은 저장된 사진이 없어서 질문할 수 없어요'); return; }
    const msgs = _chatList(x);
    if (msgs.some(m => m.pending)) { _ssToast('이전 답변을 기다리는 중이에요'); return; }
    const history = msgs.filter(m => !m.pending).map(m => ({ role: m.role, text: m.text }));
    msgs.push({ role: 'user', text });
    const ai = { role: 'ai', text: '', pending: true }; msgs.push(ai);
    _pcRenderChat();
    let temp = '';
    try {
      const r = x.result;
      // 지금 사진 영역에서 채점 표시 사진을 보고 있으면 그 사진(V·점수가 그려진 것)을, 아니면 원본을 AI 에게 보낸다
      let imgPath = x.imagePath, imageKind = 'original';
      if (_state.pcShowDoc === x.docId && _state.pcPhotoMode === 'mark' && x._markCache && x._markCache.canvas) {
        const cv = x._markCache.canvas, sc = Math.min(1, 1536 / Math.max(cv.width, cv.height));
        const o = document.createElement('canvas'); o.width = Math.round(cv.width * sc); o.height = Math.round(cv.height * sc);
        o.getContext('2d').drawImage(cv, 0, 0, o.width, o.height);
        imgPath = temp = await _store().uploadTemp({ base64: o.toDataURL('image/jpeg', 0.85).split(',')[1], mimeType: 'image/jpeg' });
        imageKind = 'marked';
      }
      const out = await _store().ask(imgPath, {
        question: text, history, imageKind,
        context: { testName: _testNameOf(r), studentName: r.studentName || '', correct: r.correctCount, total: r.totalQuestions,
          answers: (r.answers || []).map(a => ({ no: a.no, stem: a.stem, studentAnswer: a.studentAnswer, correctAnswer: a.correctAnswer, isCorrect: a.isCorrect, confidence: a.confidence })) },
      });
      ai.pending = false; ai.text = out.answer || '(답변이 비어 있어요)'; ai.corrections = out.corrections || [];
    } catch (e) { ai.pending = false; ai.text = '답변을 받지 못했어요: ' + (e && e.message); }
    if (temp) _store().deleteTemp(temp);
    if (_state.students && _state.students[_state.detailIdx] === x) _pcRenderChat();
  };
  // 정정 제안 적용 = 해당 문항의 정답/오답 표시를 바꿈 (직접 수정과 동일하게 저장·마킹 갱신)
  window._chatApply = function (idx, no, isCorrect) {
    const s = _state.students && _state.students[idx]; if (!s || !s.result) return;
    const a = (s.result.answers || []).find(q => q.no === no);
    if (a && a.isCorrect !== isCorrect) window._ssToggleAnswer(idx, no);
    _pcRenderChat();
  };

  async function _pcPhoto() {
    const idx = _state.detailIdx, box = document.getElementById('ssPcPhotoBox');
    const x = _state.students && _state.students[idx];
    if (!box || !x || !x.result) return;
    const tok = _state._pcTok = (_state._pcTok || 0) + 1;
    const mode = _state.pcPhotoMode || 'orig';
    // 사진은 [사진 보기]를 눌렀을 때만 불러온다 (학생을 넘겨 볼 때마다 다운로드하지 않게)
    if (_state.pcShowDoc !== x.docId) {
      box.innerHTML = `<div class="ss-center"><div class="ss-sub" style="color:#e8eaed;">사진은 필요할 때만 불러와요.</div>${uiBtn({ kind: 'primary', icon: 'image', label: '사진 보기', onclick: 'window._pcShowPhoto()' })}</div>`;
      return;
    }
    // 채점 표시 사진은 필요할 때만: 위치(markPos)가 이미 있거나 저장본이 있으면 바로 보여주고, 없으면 [만들기] 버튼 (PC 채점 프로그램이 위치를 찾아야 해서 시간이 걸림)
    if (mode === 'mark') {
      const p = x.result.markPos;
      const cheap = (x._markCache) || (x.markPath && x.markKey) || (p && ((p.nums && p.v === 2) || p.cells));
      if (!cheap && _state._pcForce !== x.docId) {
        box.innerHTML = `<div class="ss-center"><div class="ss-sub">채점 표시 사진은 아직 만들지 않았어요.<br>처음 한 번은 학원 PC가 번호 위치를 찾느라 20초 정도 걸려요.</div>${uiBtn({ kind: 'primary', icon: 'pen', label: '채점 표시 사진 만들기', onclick: 'window._pcMakeMark()' })}</div>`;
        return;
      }
    }
    box.innerHTML = `<div class="ss-center"><div class="ss-spinner"></div><div class="ss-sub">${mode === 'mark' ? '채점 표시 사진을 준비하는 중… (처음 한 번은 학원 PC가 위치를 찾느라 20초 정도 걸려요)' : '사진을 불러오는 중…'}</div></div>`;
    try {
      let url;
      if (mode === 'mark') { const out = await _ssGetMarked(idx); url = out.canvas.toDataURL('image/jpeg', 0.9); }
      else url = (await _ssLoadImageEl(x)).src;
      if (tok !== _state._pcTok) return;
      box.innerHTML = `<img id="ssPcImg" alt="" style="width:${_state.pcZoom || 100}%" src="${url}">`;
      document.getElementById('ssPcImg').onclick = () => window._ssOpenMarked(idx, mode);
    } catch (e) {
      if (tok !== _state._pcTok) return;
      box.innerHTML = `<div class="ss-center"><div class="ss-sub">${esc(e && e.message || '사진을 만들지 못했어요')}</div>${uiBtn({ label: '다시 시도', onclick: 'window._pcRetryPhoto()' })}</div>`;
    }
  }
  window._pcRetryPhoto = function () { _pcPhoto(); };
  window._pcShowPhoto = function () { const x = _state.students[_state.detailIdx]; if (x) { _state.pcShowDoc = x.docId; _state.pcPhotoMode = _hasMark(x) ? 'mark' : 'orig'; _pcRenderDetail(); } };   // 마킹 사진이 있으면 그것부터, 없으면 원본
  window._pcMakeMark = function () { const x = _state.students[_state.detailIdx]; if (x) { _state._pcForce = x.docId; _pcPhoto(); } };
  window._pcSetPhotoMode = function (m) { _state.pcPhotoMode = m; const x = _state.students[_state.detailIdx]; if (x) _state.pcShowDoc = x.docId; _pcRenderDetail(); };
  window._pcZoom = function (d) {
    _state.pcZoom = d === 0 ? 100 : Math.min(400, Math.max(50, (_state.pcZoom || 100) + d));
    const img = document.getElementById('ssPcImg'); if (img) img.style.width = _state.pcZoom + '%';
    const l = document.getElementById('ssPcZoomLbl'); if (l) l.textContent = _state.pcZoom + '%';
  };
  // ✓/✗·이름 수정 후: 학생 목록 점수 + 사진을 다시 반영
  let _pcEditTimer = 0;
  function _pcAfterEdit(photo) {
    if (_state.phase !== 'pc') return;
    _pcRenderStudents();
    if (photo) { clearTimeout(_pcEditTimer); _pcEditTimer = setTimeout(_pcPhoto, 350); }
  }

  // 키보드: ↑↓ 학생 이동, Ctrl+C 카톡용 복사
  document.addEventListener('keydown', (e) => {
    if (_state.phase !== 'pc' || document.querySelector('[data-ss-sub]')) return;
    const t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    if (typing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const nb = _detailNeighbors(_state.detailIdx);
      const to = e.key === 'ArrowDown' ? nb.next : nb.prev;
      if (to >= 0) { e.preventDefault(); window._ssDetailGo(to); }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      const sel = window.getSelection && String(window.getSelection());
      if (sel) return;                       // 글자를 선택해 둔 상태의 복사는 그대로
      e.preventDefault(); window._ssCopyMarked(_state.detailIdx);
    }
  });
  // 창 크기가 1024px 경계를 넘으면 레이아웃 전환
  let _lastPc = _isPc();
  window.addEventListener('resize', () => {
    const now = _isPc(); if (now === _lastPc) return; _lastPc = now;
    if (!document.getElementById('scoreSnapOverlay')) return;
    if (['home', 'result-grid', 'student-detail', 'pc'].includes(_state.phase)) {
      if (_state.sid) { if (now) _renderPc(); else _renderResultGrid(); } else _renderHome();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5단계 · 카톡 연속 전송 — 학생마다 이미지를 클립보드에 복사 → 카톡 대화방에 붙여넣기 → [보냄 · 다음 학생]
  // 클립보드 쓰기는 사용자 동작 안에서만 되므로, 버튼 핸들러에서 이미지 Promise 를 바로 넘긴다.
  // ───────────────────────────────────────────────────────────────────────────
  const _KK_DEFAULT = '[{학원}] {이름} {시험} {맞은수}/{문항수} ({점수}점).';
  function _kkTpl() { try { return localStorage.getItem('ssKakaoTpl') || _KK_DEFAULT; } catch (_) { return _KK_DEFAULT; } }
  function _kkMsg(i) {
    const r = _state.students[i].result;
    return _kkTpl().replace(/\{학원\}/g, window.MY_ACADEMY_NAME || '').replace(/\{이름\}/g, r.studentName || '').replace(/\{시험\}/g, _testNameOf(r))
      .replace(/\{맞은수\}/g, r.correctCount).replace(/\{문항수\}/g, r.totalQuestions).replace(/\{점수\}/g, _pctOf(r));
  }
  function _kkBlob(i) {
    const kk = _state.kk;
    const key = kk.kind + ':' + i + ':' + (_state.students[i].result.correctCount);
    if (kk.cache[key]) return kk.cache[key];
    const p = (async () => {
      const canvas = kk.kind === 'mark' ? (await _ssGetMarked(i)).canvas : await _ssCardCanvas(i);
      const b = await new Promise(r => canvas.toBlob(r, 'image/png'));
      if (!b) throw new Error('이미지 생성 실패');
      return b;
    })();
    p.catch(() => { delete kk.cache[key]; });
    kk.cache[key] = p;
    return p;
  }
  function _kkCopy(i) {
    if (!navigator.clipboard || typeof window.ClipboardItem !== 'function') { _ssToast('이 브라우저는 이미지 복사를 지원하지 않아요'); return Promise.resolve(false); }
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': _kkBlob(i) })]).then(() => true).catch(e => { _ssToast('복사하지 못했어요: ' + (e && e.message)); return false; });
  }
  const _kkList = () => (_state.students || []).map((s, i) => ({ s, i })).filter(o => o.s.status === 'done' && o.s.result);

  window._ssOpenKakao = function () {
    const list = _kkList();
    if (!list.length) { _ssToast('채점이 끝난 학생이 없어요'); return; }
    const first = list.find(o => !o.s.kakaoSentAt) || list[0];
    _state.kk = { kind: 'mark', cur: first.i, skip: new Set(), cache: {}, copied: -1 };
    const ov = document.createElement('div');
    ov.className = 'ss-kk'; ov.id = 'ssKk'; ov.setAttribute('data-ss-sub', '1');
    ov._ssCancel = () => { document.removeEventListener('keydown', onKey); ov.remove(); _state.kk = null; if (_state.phase === 'pc') _pcRenderStudents(); };
    document.body.appendChild(ov);
    _ssPushSub(ov);
    const close = () => { document.removeEventListener('keydown', onKey); _state.kk = null; _ssSubRemove(ov); if (_state.phase === 'pc') _pcRenderStudents(); };
    ov._close = close;
    function onKey(e) {
      if (!_state.kk) return;
      if (e.key === 'Escape') { close(); return; }
      const t = e.target;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); window._kkNext(true); }
    }
    document.addEventListener('keydown', onKey);
    _kkRender();
    _kkCopy(first.i).then(ok => { if (ok && _state.kk) { _state.kk.copied = first.i; _kkRenderRight(); } });   // 열기 버튼 클릭 직후라 사용자 동작 인정
  };

  function _kkStatus(o) {
    const kk = _state.kk;
    if (o.s.kakaoSentAt) return ['보냄', 'ok'];
    if (kk.skip.has(o.i)) return ['건너뜀', ''];
    if (o.i === kk.cur) return ['지금', 'brand'];
    return ['대기', ''];
  }

  function _kkRender() {
    const ov = document.getElementById('ssKk'); const kk = _state.kk; if (!ov || !kk) return;
    const list = _kkList();
    const sent = list.filter(o => o.s.kakaoSentAt).length;
    ov.innerHTML = `
      <header class="ss-kk__head">${uiIconBtn('chevron-left', '결과로', { onclick: 'document.getElementById(\'ssKk\')._close()' })}
        <div class="ss-grow"><b style="font-size:18px;">카톡 연속 전송</b><div class="ss-sub">${list.length}명 중 <b id="kkSent">${sent}</b>명 보냄</div></div>
        <div class="ss-bar" style="width:160px;"><i id="kkBar" style="width:${list.length ? Math.round(sent / list.length * 100) : 0}%"></i></div>
        <div class="ss-tabs" style="margin-left:12px;"><button class="ss-tab${kk.kind === 'mark' ? ' ss-tab--on' : ''}" onclick="window._kkKind('mark')">채점 표시 사진</button><button class="ss-tab${kk.kind === 'card' ? ' ss-tab--on' : ''}" onclick="window._kkKind('card')">성적표</button></div></header>
      <div class="ss-kk__grid">
        <aside class="ss-kk__list" id="kkList"></aside>
        <section class="ss-kk__mid" id="kkMid"></section>
        <section class="ss-kk__right" id="kkRight"></section></div>`;
    _kkRenderList(); _kkRenderMid(); _kkRenderRight();
  }
  function _kkRenderList() {
    const el = document.getElementById('kkList'); const kk = _state.kk; if (!el || !kk) return;
    el.innerHTML = _kkList().map(o => {
      const [t, tone] = _kkStatus(o); const r = o.s.result;
      return `<div class="ss-row${o.i === kk.cur ? ' ss-row--on' : ''}" data-i="${o.i}"><input type="checkbox" class="kk-chk" data-i="${o.i}" ${kk.skip.has(o.i) ? '' : 'checked'} ${o.s.kakaoSentAt ? 'disabled' : ''} style="width:20px;height:20px;accent-color:var(--brand);">
        <span class="ss-grow kk-pick" data-i="${o.i}" style="cursor:pointer;"><b class="ss-title" style="display:block;">${_noName(r) ? '이름 없음' : esc(r.studentName)}</b><span class="ss-sub">${_pctOf(r)}점</span></span>${uiChip(t, tone)}${o.s.kakaoSentAt ? `<button class="ss-link kk-undo" data-i="${o.i}">취소</button>` : ''}</div>`;
    }).join('');
    el.onclick = (e) => {
      const u = e.target.closest('.kk-undo'); if (u) { return window._kkUnsend(+u.dataset.i); }
      const c = e.target.closest('.kk-chk');
      if (c) { const i = +c.dataset.i; if (c.checked) kk_skip().delete(i); else kk_skip().add(i); _kkRenderList(); return; }
      const p = e.target.closest('.kk-pick'); if (p) { window._kkSelect(+p.dataset.i); }
    };
  }
  const kk_skip = () => _state.kk.skip;
  function _kkRenderMid() {
    const el = document.getElementById('kkMid'); const kk = _state.kk; if (!el || !kk) return;
    const s = _state.students[kk.cur]; if (!s) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="ss-sub" style="margin-bottom:8px;"><b style="color:var(--text);font-size:17px;">${esc((s.result.studentName || '').trim() || '이름 없음')}</b> · ${_pctOf(s.result)}점 · ${s.result.correctCount}/${s.result.totalQuestions}</div>
      <div class="ss-kk__img" id="kkImg"><div class="ss-center"><div class="ss-spinner"></div></div></div>`;
    const cur = kk.cur;
    _kkBlob(cur).then(b => { if (!_state.kk || _state.kk.cur !== cur) return; const box = document.getElementById('kkImg'); if (box) box.innerHTML = `<img alt="" src="${URL.createObjectURL(b)}">`; })
      .catch(e => { const box = document.getElementById('kkImg'); if (box && _state.kk && _state.kk.cur === cur) box.innerHTML = `<div class="ss-center"><div class="ss-sub">${esc(e.message || '이미지를 만들지 못했어요')}</div></div>`; });
  }
  function _kkRenderRight() {
    const el = document.getElementById('kkRight'); const kk = _state.kk; if (!el || !kk) return;
    const copied = kk.copied === kk.cur;
    const keepMsg = document.getElementById('kkMsgTpl');
    el.innerHTML = `
      <div class="ss-kk__step"><b>1</b><div>${copied ? '<span class="ss-tone-ok">이미지가 클립보드에 복사됐어요</span>' : '이미지를 복사해 주세요'}<div class="ss-sub">${copied ? '' : `<button class="ss-btn ss-btn--sm" onclick="window._kkCopyNow()">${iconSvg('copy', 'ss-ic--sm')}<span>이미지 복사</span></button>`}</div></div></div>
      <div class="ss-kk__step"><b>2</b><div>PC 카톡에서 그 학부모 대화방을 열고 <span class="ss-kbd">Ctrl+V</span></div></div>
      <div class="ss-kk__step"><b>3</b><div>보낸 뒤 <b>[보냄 · 다음 학생]</b> 을 누르세요 <span class="ss-kbd">Space</span></div></div>
      <div class="ss-sec" style="margin:14px 0 6px;"><b style="font-size:15px;">함께 보낼 메시지</b></div>
      <textarea class="ss-input" id="kkMsgTpl" rows="4" style="height:auto;padding:10px;line-height:1.5;" oninput="window._kkTplChange(this.value)">${esc(_kkTpl())}</textarea>
      <div class="ss-hint">{학원} {이름} {시험} {맞은수} {문항수} {점수} 를 쓸 수 있어요</div>
      <div class="ss-kk__preview" id="kkPreview">${esc(_kkMsg(kk.cur))}</div>
      ${uiBtn({ block: true, icon: 'copy', label: '메시지 복사', onclick: 'window._kkCopyMsg()' })}
      <div class="ss-kk__btns">${uiBtn({ size: 'lg', label: '건너뛰기', onclick: 'window._kkNext(false)' })}${uiBtn({ kind: 'primary', size: 'lg', label: '보냄 · 다음 학생', onclick: 'window._kkNext(true)' })}</div>`;
    if (keepMsg && document.activeElement === keepMsg) { /* 입력 중에는 다시 그리지 않음 */ }
  }
  window._kkTplChange = function (v) {
    try { localStorage.setItem('ssKakaoTpl', v || _KK_DEFAULT); } catch (_) {}
    const p = document.getElementById('kkPreview'); if (p && _state.kk) p.textContent = _kkMsg(_state.kk.cur);
  };
  window._kkCopyMsg = function () {
    const t = _kkMsg(_state.kk.cur);
    (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => _ssToast('메시지를 복사했어요'), () => _ssToast('복사하지 못했어요'));
  };
  window._kkCopyNow = function () { const i = _state.kk.cur; _kkCopy(i).then(ok => { if (ok && _state.kk) { _state.kk.copied = i; _kkRenderRight(); } }); };
  window._kkKind = function (k) { if (!_state.kk) return; _state.kk.kind = k; _state.kk.copied = -1; _kkRender(); _kkCopy(_state.kk.cur).then(ok => { if (ok && _state.kk) { _state.kk.copied = _state.kk.cur; _kkRenderRight(); } }); };
  window._kkSelect = function (i) { const kk = _state.kk; kk.cur = i; kk.copied = -1; _kkRenderList(); _kkRenderMid(); _kkRenderRight(); };
  window._kkUnsend = async function (i) {
    const s = _state.students[i]; if (!s) return;
    s.kakaoSentAt = 0;
    try { await _store().markSent(_state.sid, s.docId, false); } catch (_) {}
    _kkRender();
  };
  // 보냄 처리(또는 건너뛰기) 후 다음 학생으로 — 같은 클릭 안에서 다음 학생 이미지를 클립보드에 복사
  window._kkNext = function (sent) {
    const kk = _state.kk; if (!kk) return;
    const s = _state.students[kk.cur];
    if (sent && s && !s.kakaoSentAt) {
      s.kakaoSentAt = Date.now();
      _store().markSent(_state.sid, s.docId, true).catch(e => console.warn('[scoresnap] 보냄 표시 저장 실패:', e && e.message));
    }
    if (!sent) kk.skip.add(kk.cur);
    const list = _kkList();
    const pos = list.findIndex(o => o.i === kk.cur);
    const order = list.slice(pos + 1).concat(list.slice(0, pos + 1));
    const nxt = order.find(o => !o.s.kakaoSentAt && !kk.skip.has(o.i));
    if (!nxt) { _kkRender(); _ssToast('모두 처리했어요'); return; }
    kk.cur = nxt.i; kk.copied = -1;
    _kkRender();
    _kkCopy(nxt.i).then(ok => { if (ok && _state.kk && _state.kk.cur === nxt.i) { _state.kk.copied = nxt.i; _kkRenderRight(); } });
  };

  // ─── QR: 폰으로 이 기록을 바로 열기 ───
  let _qrLoading = null;
  function _loadQr() {
    if (typeof window.qrcode === 'function') return Promise.resolve();
    if (_qrLoading) return _qrLoading;
    _qrLoading = new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
      sc.onload = res; sc.onerror = () => { _qrLoading = null; rej(new Error('QR 라이브러리를 불러오지 못했어요')); };
      document.head.appendChild(sc);
    });
    return _qrLoading;
  }
  window._ssShowQr = async function () {
    if (!_state.sid) { _ssToast('먼저 정답지를 확정해 주세요'); return; }
    const url = `${location.origin}/ss/?sid=${encodeURIComponent(_state.sid)}`;
    let svg = '';
    try { await _loadQr(); const q = window.qrcode(0, 'M'); q.addData(url); q.make(); svg = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
    catch (e) { _ssToast(e.message); return; }
    const sc = document.createElement('div');
    sc.className = 'ss-scrim'; sc.setAttribute('data-ss-sub', '1');
    sc.style.alignItems = 'center';
    sc.innerHTML = `<div class="ss-card" style="padding:22px;max-width:360px;width:90%;text-align:center;background:#fff;">
      <b style="font-size:18px;">폰으로 이어서 찍기</b>
      <div class="ss-sub" style="margin:6px 0 14px;">폰 카메라로 QR을 찍으면 이 기록의 답안지 추가 화면이 바로 열려요.<br>(폰에서 이미 로그인되어 있어야 해요)</div>
      <div id="ssQrBox" style="width:240px;height:240px;margin:0 auto;">${svg}</div>
      <div class="ss-sub" style="margin-top:12px;word-break:break-all;font-size:12px;">${esc(url)}</div>
      <div style="margin-top:14px;">${uiBtn({ block: true, label: '닫기', id: 'ssQrClose' })}</div></div>`;
    sc._ssCancel = () => sc.remove();
    sc.onclick = (e) => { if (e.target === sc || e.target.closest('#ssQrClose')) _ssSubRemove(sc); };
    document.body.appendChild(sc);
    _ssPushSub(sc);
  };

  // 옛 이름 호환 (정답 목록·사진 보기 등에서 사용)
  window._ssShowMarkedPhoto = window._ssOpenMarked;


  // ─── 사진 보기 창 (정답지·학생 원본 공용): 확대/축소/맞춤, 끌어서 이동, 휠·핀치 확대, Esc 닫기 ───
  async function _ssOpenImageViewer(o) {
    const vw = { scale: 1, fit: 1, tx: 0, ty: 0, iw: 0, ih: 0 };
    const ov = document.createElement('div');
    ov.className = 'ss-vw'; ov.setAttribute('data-ss-sub', '1');
    ov.innerHTML = `
      <div class="ss-vw__head">${uiIconBtn('x', '닫기', { id: 'ivX' })}<div class="t"><b>${esc(o.title)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</div></div>
      <div class="ss-vw__main"><div class="ss-vw__stage" id="ivStage"><img id="ivImg" alt="" draggable="false"></div></div>
      <div class="ss-vw__bar" style="justify-content:center;">${uiBtn({ icon: 'minus', id: 'ivMinus' })}<span id="ivLbl" style="min-width:64px;text-align:center;align-self:center;font-weight:700;">100%</span>${uiBtn({ icon: 'plus', id: 'ivPlus' })}${uiBtn({ label: '맞춤', id: 'ivFit' })}</div>`;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { document.removeEventListener('keydown', onKey); _ssSubRemove(ov); };
    ov._ssCancel = () => { document.removeEventListener('keydown', onKey); ov.remove(); };
    document.body.appendChild(ov);
    _ssPushSub(ov);
    document.addEventListener('keydown', onKey);
    const $v = (id) => ov.querySelector('#' + id), stage = $v('ivStage'), img = $v('ivImg');
    const apply = () => { img.style.transform = `translate(${vw.tx}px, ${vw.ty}px) scale(${vw.scale})`; $v('ivLbl').textContent = Math.round(vw.scale / vw.fit * 100) + '%'; };
    const fitView = () => { const r = stage.getBoundingClientRect(); vw.fit = Math.min(r.width / vw.iw, r.height / vw.ih) || 1; vw.scale = vw.fit; vw.tx = (r.width - vw.iw * vw.scale) / 2; vw.ty = (r.height - vw.ih * vw.scale) / 2; apply(); };
    const zoomAt = (cx, cy, ns) => { ns = Math.min(vw.fit * 8, Math.max(vw.fit * 0.5, ns)); vw.tx = cx - (cx - vw.tx) * (ns / vw.scale); vw.ty = cy - (cy - vw.ty) * (ns / vw.scale); vw.scale = ns; apply(); };
    const rect = () => stage.getBoundingClientRect();
    const zoomBy = (f) => { const r = rect(); zoomAt(r.width / 2, r.height / 2, vw.scale * f); };
    img.onload = () => { vw.iw = img.naturalWidth; vw.ih = img.naturalHeight; fitView(); };
    img.src = o.url;
    $v('ivX').onclick = close;
    $v('ivPlus').onclick = () => zoomBy(1.25); $v('ivMinus').onclick = () => zoomBy(0.8); $v('ivFit').onclick = fitView;
    const pts = new Map(); let pinch = null, pan = null, lastTap = 0;
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: vw.scale, tx: vw.tx, ty: vw.ty, mx: (a.x + b.x) / 2 - rect().left, my: (a.y + b.y) / 2 - rect().top }; pan = null; }
      else { pan = { x: e.clientX - vw.tx, y: e.clientY - vw.ty }; const now = Date.now(); if (now - lastTap < 320) { const r = rect(); if (vw.scale > vw.fit * 1.2) fitView(); else zoomAt(e.clientX - r.left, e.clientY - r.top, vw.fit * 2.5); } lastTap = now; }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const ns = Math.min(vw.fit * 8, Math.max(vw.fit * 0.5, pinch.s * d / pinch.d)); vw.tx = pinch.mx - (pinch.mx - pinch.tx) * (ns / pinch.s); vw.ty = pinch.my - (pinch.my - pinch.ty) * (ns / pinch.s); vw.scale = ns; apply(); }
      else if (pan && pts.size === 1) { vw.tx = e.clientX - pan.x; vw.ty = e.clientY - pan.y; apply(); }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 1) { const p = [...pts.values()][0]; pan = { x: p.x - vw.tx, y: p.y - vw.ty }; } else if (!pts.size) pan = null; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); const r = rect(); zoomAt(e.clientX - r.left, e.clientY - r.top, vw.scale * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    window.addEventListener('resize', () => { if (vw.iw && document.body.contains(ov)) fitView(); });
  }

  // 정답지 사진 보기 — 방금 올린 건 메모리, 서버에서 연 기록은 저장된 사진
  window._ssViewKeyImage = async function () {
    let url = _state.answerKeyImage?.dataUrl || '';
    if (!url && _state.keyImagePath) {
      try { url = await window._ssStore.getImageUrl(_state.keyImagePath); }
      catch (e) { _ssToast('정답지 사진을 불러올 수 없어요 (보관 기간이 지났을 수 있어요)'); return; }
    }
    if (!url) { _ssToast('저장된 정답지 사진이 없어요 (이전에 만든 기록은 사진이 저장되지 않았어요)'); return; }
    _ssOpenImageViewer({ url, title: '정답지 사진', sub: (_state.answerKey && _state.answerKey.testName) || '' });
  };

  window._ssViewStudentImage = async function (idx) {
    const x = _state.students?.[idx];
    if (!x) return;
    let url = x.image?.dataUrl || '';
    if (!url && x.imagePath) {
      try { url = await window._ssStore.getImageUrl(x.imagePath); }
      catch (e) { _ssToast('사진을 불러올 수 없어요 (보관 기간이 지났을 수 있어요)'); return; }
    }
    if (!url) { _ssToast('저장된 사진이 없어요'); return; }
    const r = x.result || {};
    _ssOpenImageViewer({ url, title: `${(r.studentName || '').trim() || '학생'} · 원본 사진`, sub: _testNameOf(r) });
  };

  // 정답 목록 보기 (읽기 전용) — 인식된 문제·정답을 확인, 검색 가능
  window._ssViewKeyList = function () {
    const k = _state.answerKey || {};
    const qs = k.questions || [];
    if (!qs.length) { _ssToast('정답 목록이 없어요'); return; }
    const sc = document.createElement('div');
    sc.className = 'ss-scrim ss-scrim--modal'; sc.setAttribute('data-ss-sub', '1');
    const rowsHtml = (list) => list.map(q => `<div class="ss-kl__row"><span class="no">${esc(String(q.no))}</span><span class="stem">${esc(q.stem) || '<i>(문제 없음)</i>'}${q.type === 'mcq' && Array.isArray(q.choices) && q.choices.length ? `<small>${q.choices.map((c, j) => `${['①', '②', '③', '④', '⑤'][j] || j + 1} ${esc(c)}`).join(' &nbsp; ')}</small>` : ''}</span><span class="ans">${esc(q.answer || '')}</span></div>`).join('') || '<div class="ss-center" style="padding:30px;"><div class="ss-sub">검색 결과가 없어요</div></div>';
    sc.innerHTML = `<div class="ss-modal">
      <div class="ss-modal__head"><div class="ss-grow"><b>정답 목록</b><div class="ss-sub">${esc(k.testName || '시험')} · ${qs.length}문항 · 읽기 전용</div></div>${uiIconBtn('x', '닫기', { id: 'klX' })}</div>
      <div style="padding:0 16px 8px;"><input class="ss-input" id="klSearch" type="text" placeholder="문제·정답 검색" autocomplete="off"></div>
      <div class="ss-kl__head"><span class="no">번호</span><span class="stem">문제</span><span class="ans">정답</span></div>
      <div class="ss-modal__body" id="klBody">${rowsHtml(qs)}</div></div>`;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { document.removeEventListener('keydown', onKey); _ssSubRemove(sc); };
    sc._ssCancel = () => { document.removeEventListener('keydown', onKey); sc.remove(); };
    sc.onclick = (e) => { if (e.target === sc || e.target.closest('#klX')) close(); };
    document.body.appendChild(sc);
    _ssPushSub(sc);
    document.addEventListener('keydown', onKey);
    const inp = sc.querySelector('#klSearch');
    inp.oninput = () => { const t = inp.value.trim().toLowerCase(); sc.querySelector('#klBody').innerHTML = rowsHtml(t ? qs.filter(q => (String(q.stem || '') + ' ' + String(q.answer || '')).toLowerCase().includes(t)) : qs); };
  };


  // ─── 마킹 사진: 학생 답안지 사진 위에 틀린 문항 V + 점수칸 점수 ───
  // 번호·점수칸 위치는 Vision OCR(학생당 1회, 결과에 markPos 로 저장). 이후 ✓/✗ 수정은 OCR 없이 즉시 반영.
  async function _ssLoadImageEl(x) {
    if (x._imgEl) return x._imgEl;
    let url = x.image?.dataUrl || '';
    if (!url) {
      if (!x.imagePath) throw new Error('저장된 사진이 없어요');
      const remote = await window._ssStore.getImageUrl(x.imagePath);
      const blob = await (await fetch(remote, { cache: 'reload' })).blob();   // 이전에 <img> 로 캐시된(CORS 헤더 없는) 응답 재사용 방지     // 버킷 CORS 허용 필요 (raloud.vercel.app)
      url = URL.createObjectURL(blob);
    }
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('사진을 읽을 수 없어요')); img.src = url; });
    x._imgEl = img;
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
      body: JSON.stringify({
        idToken, imageBase64: base64, mimeType: 'image/jpeg', wordBoxes: true, allWords: true,
        tableMeta: {   // 전용앱: PC 의 Claude 가 찾을 글자 (열 이름 + 줄마다 인쇄된 기준 단어)
          columns: [x.result.givenColumn].concat(x.result.answerColumns || []).filter(Boolean),
          givenColumn: x.result.givenColumn || '',
          givens: Array.from(new Set((x.result.answers || []).map(a => a.given).filter(Boolean))),
        },
      }),
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
    _markDirty(_state.students.indexOf(x));
    return x.result.markPos;
  }

  async function _ssEnsureMarkPos(x, img) {
    if (x.result.layout === 'table') return _ssEnsureMarkPosTable(x, img);
    if (x.result.markPos && x.result.markPos.nums && x.result.markPos.v === 2) return x.result.markPos;   // v2: 머리글(출제일 등)의 숫자 제외
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const base64 = c.toDataURL('image/jpeg', 0.85).split(',')[1];
    const idToken = await window._ssGetIdToken();
    const r = await fetch('/api/ocr', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, imageBase64: base64, mimeType: 'image/jpeg', wordBoxes: true, expectCount: x.result.totalQuestions || 0 }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.words) throw new Error(j.error || '번호 위치를 읽지 못했어요');
    const total = x.result.totalQuestions || 0;
    const nums = {};
    // 본문 시작 높이: 왼쪽 가장자리의 '번호.' 중 가장 위 — 머리글의 출제일(2026. 10. 23.) 같은 숫자를 문항 번호로 오인하지 않도록
    const leftNums = j.words.filter(w => /^\d{1,3}\.$/.test(w.t) && w.x1 < 0.15 && w.y1 > 0.08);
    const bodyTop = leftNums.length ? Math.min(...leftNums.map(w => w.y1)) - 0.02 : 0.15;
    for (let n = 1; n <= total; n++) {
      let c1 = j.words.filter(w => w.t === n + '.' && w.y1 >= bodyTop);
      if (!c1.length) c1 = j.words.filter(w => w.t === String(n) && w.y1 > Math.max(0.15, bodyTop));
      if (c1.length) { const w = c1.sort((a, b) => a.x1 - b.x1)[0]; nums[n] = { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }; }
    }
    const lab = j.words.filter(w => /^점수:?$/.test(w.t) && w.y1 < 0.25).sort((a, b) => b.x1 - a.x1)[0];
    x.result.markPos = { v: 2, nums, label: lab ? { x1: lab.x1, y1: lab.y1, x2: lab.x2, y2: lab.y2 } : null };
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


  function _fmtDate(d) {
    if (!d) return '';
    const m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // 성적표 PNG 용 카드 (흰 배경, 이모지 없음)
  function _buildStudentDetailHtml(s, idx) {
    const r = s.result || {};
    const ans = r.answers || [];
    const unc = new Set(r.uncertainQuestions || []);
    const pct = _pctOf(r);
    const row = (a) => `<div style="display:grid;grid-template-columns:34px 1fr 40px;gap:8px;padding:8px 6px;border-bottom:1px solid #eee;font-size:13px;align-items:start;">
      <span style="color:#5f6368;font-weight:700;">${esc(a.no)}</span>
      <div style="min-width:0;word-break:break-word;"><b style="color:#202124;">${esc(a.stem || '')}</b><div style="color:#3c4043;">${esc(a.studentAnswer || '(빈칸)')}${a.isCorrect ? '' : ` <span style="color:#2e7d32;">→ ${esc(a.correctAnswer || '?')}</span>`}</div></div>
      <b style="color:${a.isCorrect ? '#2e7d32' : '#c62828'};text-align:right;">${a.isCorrect ? 'O' : 'X'}</b></div>`;
    const wrong = ans.filter(a => !a.isCorrect);
    const rest = ans.filter(a => a.isCorrect);
    return `<div style="border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:12px;">
      <div style="font-size:12px;color:#5f6368;">${esc(window.MY_ACADEMY_NAME || '')}</div>
      <div style="font-size:19px;font-weight:800;color:#202124;margin-top:2px;">${esc(_testNameOf(r))}</div>
      <div style="font-size:12px;color:#5f6368;margin-top:4px;">총 ${r.totalQuestions || 0}문항 · 채점일 ${esc(_fmtDate(new Date()))}</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:10px;"><b style="font-size:22px;">${esc(r.studentName || '')}</b><b style="font-size:30px;color:${pct >= 80 ? '#2e7d32' : pct >= 60 ? '#e65100' : '#c62828'};">${pct}점 <span style="font-size:14px;color:#5f6368;">(${r.correctCount}/${r.totalQuestions})</span></b></div></div>
      ${wrong.length ? `<div style="font-weight:800;color:#c62828;padding:6px;background:#fdecea;">틀린 문항 ${wrong.length}개</div>${wrong.map(row).join('')}` : '<div style="font-weight:800;color:#2e7d32;padding:6px;">만점입니다</div>'}
      ${rest.length ? `<div style="font-weight:800;color:#2e7d32;padding:6px;background:#e8f5e9;margin-top:8px;">맞은 문항 ${rest.length}개</div>${rest.map(row).join('')}` : ''}`;
  }


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

