// ScoreSnap — 종이 시험지 OCR 채점 (No-Storage MVP, 2026-05-11)
// featureFlags.scoreSnap=true 학원에서만 활성화.
// T1: 인쇄 템플릿 QR 코드 생성 헬퍼
// T2: featureFlag + 헤더 더블클릭 진입점
// T3: 풀스크린 오버레이 + QR 카메라 인식 + 수동 선택 폴백
// T4~T6: 촬영·채점·결과·PNG (추후 채움)

(function () {
  'use strict';

  // 모듈 state
  let _state = {};
  let _stream = null;
  let _scanRaf = 0;
  let _jsQrLoading = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ─── T1. QR 코드 생성 (qrcode-generator) ───
  window._ssQrCache = window._ssQrCache || {};
  let _ssQrLibLoading = null;

  function _ssEnsureQrLib() {
    if (typeof window.qrcode === 'function') return Promise.resolve();
    if (_ssQrLibLoading) return _ssQrLibLoading;
    _ssQrLibLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { _ssQrLibLoading = null; reject(new Error('QR 라이브러리 로드 실패')); };
      document.head.appendChild(s);
    });
    return _ssQrLibLoading;
  }

  window._ssGenerateQR = async function (testId) {
    if (!testId) return '';
    const key = String(testId);
    if (window._ssQrCache[key]) return window._ssQrCache[key];
    await _ssEnsureQrLib();
    const qr = window.qrcode(0, 'M');
    qr.addData(key);
    qr.make();
    const dataUrl = qr.createDataURL(4, 0);
    window._ssQrCache[key] = dataUrl;
    return dataUrl;
  };

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

  // ─── T3. 풀스크린 오버레이 + 워크플로우 진입 ───
  window.openScoreSnap = async function () {
    const ok = (typeof window.showConfirm === 'function')
      ? await window.showConfirm('ScoreSnap', '시험지 채점을 시작할까요?')
      : true;
    if (!ok) return;
    _state = { phase: 'identify', testId: null, testTitle: '', questions: [], studentCount: 0 };
    _renderOverlay();
    _renderIdentifyScreen();
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
  }

  function closeScoreSnap() {
    _releaseCamera();
    document.getElementById('scoreSnapOverlay')?.remove();
    _state = {};
  }
  window.closeScoreSnap = closeScoreSnap;

  // ── 시험 식별 화면 (카메라 + 수동 선택 버튼) ──
  async function _renderIdentifyScreen() {
    _state.phase = 'identify';
    _setHeader('📷 ScoreSnap · 시험 식별');
    const body = document.getElementById('ssBody');
    if (!body) return;
    body.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;gap:14px;">
        <div style="width:100%;max-width:480px;position:relative;">
          <video id="ssCamPreview" playsinline autoplay muted
            style="width:100%;background:#000;border-radius:8px;aspect-ratio:4/3;object-fit:cover;display:block;"></video>
          <div style="position:absolute;inset:0;border:2px dashed rgba(255,255,255,0.35);border-radius:8px;pointer-events:none;"></div>
        </div>
        <div id="ssCamStatus" style="font-size:13px;color:#bbb;text-align:center;min-height:38px;line-height:1.5;">
          📷 시험지 좌상단 QR 을 화면 안에 비춰주세요
        </div>
        <button id="ssManualBtn" onclick="window._ssShowManual()"
          style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:10px 24px;border-radius:8px;font-size:14px;cursor:pointer;">
          📋 시험 수동 선택
        </button>
      </div>
    `;
    try {
      await _startCameraScan();
    } catch (e) {
      const status = document.getElementById('ssCamStatus');
      if (status) status.innerHTML = `<span style="color:#ff8a80;">⚠ 카메라 접근 실패 — ${esc(e.message)}</span><br><span style="color:#999;font-size:11px;">아래 [수동 선택] 으로 진행하세요</span>`;
    }
  }

  function _setHeader(text) {
    const el = document.getElementById('ssHeaderTitle');
    if (el) el.textContent = text;
  }

  // ── jsQR 동적 로드 (CDN 폴백) ──
  function _ensureJsQR() {
    if (typeof window.jsQR === 'function') return Promise.resolve();
    if (_jsQrLoading) return _jsQrLoading;
    const cdns = [
      'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
      'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js',
    ];
    _jsQrLoading = (async () => {
      for (const url of cdns) {
        try {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('script error'));
            document.head.appendChild(s);
          });
          if (typeof window.jsQR === 'function') return;
        } catch (_) { /* 다음 CDN 시도 */ }
      }
      _jsQrLoading = null;
      throw new Error('모든 CDN 실패');
    })();
    return _jsQrLoading;
  }

  // ── 카메라 시작 + QR 스캔 루프 ──
  async function _startCameraScan() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('이 브라우저는 카메라 미지원');
    }
    const status = document.getElementById('ssCamStatus');
    const setStatus = (html) => { if (status) status.innerHTML = html; };
    setStatus(`<span style="color:#bbb;">📚 jsQR 라이브러리 로드 중…</span>`);
    try {
      await _ensureJsQR();
    } catch (e) {
      setStatus(`<span style="color:#ff8a80;">⚠ jsQR 로드 실패 — ${esc(e.message)}</span><br><span style="color:#999;font-size:11px;">[수동 선택] 으로 진행하세요</span>`);
      throw e;
    }

    setStatus(`<span style="color:#bbb;">📷 카메라 시작 중…</span>`);
    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    const video = document.getElementById('ssCamPreview');
    if (!video) { _releaseCamera(); return; }
    video.srcObject = _stream;
    try { await video.play(); } catch (_) {}

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let lastDetected = '';
    let lastDetectedAt = 0;
    let frameCount = 0;
    let lastStatusAt = 0;

    const tick = () => {
      if (!_stream) return;
      if (!video.videoWidth || video.videoWidth === 0) {
        // 영상 첫 프레임 대기
        const now = Date.now();
        if (now - lastStatusAt > 1500) {
          lastStatusAt = now;
          setStatus(`<span style="color:#bbb;">⏳ 영상 대기 중… ${frameCount} 프레임</span>`);
        }
        _scanRaf = requestAnimationFrame(tick);
        return;
      }
      frameCount++;
      // 다운샘플 — 1280px (작은 QR 도 인식)
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // attemptBoth — 인쇄 QR / 반전 QR 양쪽 시도 (인식률 ↑)
      const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      const now = Date.now();
      // 상태 갱신 (500ms 마다, 너무 자주 X)
      if (now - lastStatusAt > 500) {
        lastStatusAt = now;
        setStatus(`<span style="color:#bbb;">📷 스캔 중… ${video.videoWidth}×${video.videoHeight} · ${frameCount}f · ${canvas.width}×${canvas.height}</span><br><span style="color:#999;font-size:11px;">QR 을 화면 중앙에 가까이</span>`);
      }
      if (code && code.data) {
        if (code.data !== lastDetected || now - lastDetectedAt > 1000) {
          lastDetected = code.data;
          lastDetectedAt = now;
          _onQrDetected(code.data);
          return;
        }
      }
      _scanRaf = requestAnimationFrame(tick);
    };
    _scanRaf = requestAnimationFrame(tick);
  }

  function _releaseCamera() {
    if (_scanRaf) cancelAnimationFrame(_scanRaf);
    _scanRaf = 0;
    if (_stream) {
      _stream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
      _stream = null;
    }
    const video = document.getElementById('ssCamPreview');
    if (video) { try { video.srcObject = null; } catch (_) {} }
  }

  // ── QR 인식 콜백 ──
  async function _onQrDetected(testId) {
    _releaseCamera();
    const status = document.getElementById('ssCamStatus');
    if (status) status.innerHTML = `<span style="color:#80ff95;">✓ QR 인식: ${esc(testId)}</span><br><span style="color:#999;font-size:11px;">시험 정보 로딩 중…</span>`;
    try {
      const data = await window._ssLoadTest(testId);
      _state.testId = data.testId;
      _state.testTitle = data.title;
      _state.questions = data.questions;
      _state.studentCount = 0;
      _renderCaptureScreen();
    } catch (e) {
      if (status) status.innerHTML = `<span style="color:#ff8a80;">⚠ ${esc(e.message)}</span><br><span style="color:#999;font-size:11px;">3 초 후 재시도…</span>`;
      setTimeout(() => _renderIdentifyScreen(), 3000);
    }
  }

  // ── 수동 선택 화면 ──
  window._ssShowManual = async function () {
    _releaseCamera();
    _state.phase = 'manual';
    _setHeader('📷 ScoreSnap · 시험 수동 선택');
    const body = document.getElementById('ssBody');
    if (!body) return;
    body.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:13px;color:#bbb;">최근 30일 시험 목록</span>
        <button onclick="window._ssBackToCamera()" style="background:transparent;color:#bbb;border:1px solid #444;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;">← 카메라로</button>
      </div>
      <div id="ssManualList" style="flex:1;overflow:auto;padding:10px;">
        <div style="color:#bbb;text-align:center;padding:40px;">불러오는 중…</div>
      </div>
    `;
    try {
      const tests = await window._ssLoadRecentTests(30);
      _renderManualList(tests);
    } catch (e) {
      document.getElementById('ssManualList').innerHTML =
        `<div style="color:#ff8a80;text-align:center;padding:40px;">시험 목록 로드 실패: ${esc(e.message)}</div>`;
    }
  };

  function _renderManualList(tests) {
    const list = document.getElementById('ssManualList');
    if (!list) return;
    if (!tests.length) {
      list.innerHTML = `<div style="color:#bbb;text-align:center;padding:40px;">최근 30일 안에 출제된 시험이 없어요</div>`;
      return;
    }
    const fmt = t => {
      const ms = t.createdAt?.toMillis?.() || 0;
      if (!ms) return '';
      const d = new Date(ms);
      return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };
    list.innerHTML = tests.map(t => `
      <div onclick="window._ssPickManual('${esc(t.id)}')"
        style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:14px 16px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;"
        onmouseover="this.style.borderColor='#666'" onmouseout="this.style.borderColor='#333'">
        <div style="min-width:0;flex:1;">
          <div style="font-size:14px;font-weight:600;color:#fff;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.title || t.name || '시험')}</div>
          <div style="font-size:11px;color:#888;">${esc(t.testMode || t.mode || '')} · ${fmt(t)} · ${Array.isArray(t.questions) ? t.questions.length : 0}문항</div>
        </div>
        <div style="color:#666;font-size:18px;">›</div>
      </div>
    `).join('');
  }

  window._ssPickManual = async function (testId) {
    try {
      const data = await window._ssLoadTest(testId);
      _state.testId = data.testId;
      _state.testTitle = data.title;
      _state.questions = data.questions;
      _state.studentCount = 0;
      _renderCaptureScreen();
    } catch (e) {
      if (typeof window.showAlert === 'function') window.showAlert('로드 실패', e.message);
    }
  };

  window._ssBackToCamera = function () {
    _renderIdentifyScreen();
  };

  // ── T4. 촬영 화면 (시험지·갤러리 입력 → 클라 리사이즈 → 미리보기) ──
  function _renderCaptureScreen() {
    _state.phase = 'capture';
    _setHeader(`📷 ScoreSnap · ${_state.testTitle}`);
    const body = document.getElementById('ssBody');
    if (!body) return;
    body.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
        <div style="min-width:0;flex:1;">
          <div style="font-size:14px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(_state.testTitle)}</div>
          <div style="font-size:11px;color:#888;margin-top:2px;">총 ${_state.questions.length}문항 · 학생 ${_state.studentCount + 1}번째</div>
        </div>
        <button onclick="window.closeScoreSnap()" style="background:transparent;color:#bbb;border:1px solid #444;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;flex-shrink:0;">채점 종료</button>
      </div>
      <div id="ssCaptureBody" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:40px 30px;gap:18px;overflow-y:auto;min-height:0;">
        <div style="font-size:14px;color:#bbb;text-align:center;line-height:1.5;">
          학생 답안지를 카메라로 찍거나<br>갤러리에서 선택하세요
        </div>
        <input id="ssCameraInput" type="file" accept="image/*" capture="environment" style="display:none;">
        <input id="ssGalleryInput" type="file" accept="image/*" style="display:none;">
        <button id="ssCamBtn"
          style="background:var(--c-brand,#E8714A);color:#fff;border:none;padding:18px 40px;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.3);">
          📷 사진 촬영
        </button>
        <button id="ssGalBtn"
          style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #444;padding:10px 24px;border-radius:8px;font-size:13px;cursor:pointer;">
          🖼 갤러리에서 선택
        </button>
      </div>
    `;
    const camIn = document.getElementById('ssCameraInput');
    const galIn = document.getElementById('ssGalleryInput');
    document.getElementById('ssCamBtn').onclick = () => camIn.click();
    document.getElementById('ssGalBtn').onclick = () => galIn.click();
    camIn.onchange = (e) => _handleCapturedFile(e.target.files?.[0]);
    galIn.onchange = (e) => _handleCapturedFile(e.target.files?.[0]);
  }

  async function _handleCapturedFile(file) {
    if (!file) return;
    const body = document.getElementById('ssCaptureBody');
    if (body) body.innerHTML = `<div style="color:#bbb;text-align:center;font-size:14px;">⏳ 이미지 처리 중…</div>`;
    try {
      const processed = await _processImage(file);
      _state.captured = processed;
      _renderPreviewScreen(processed.dataUrl, processed.sizeKB);
    } catch (e) {
      if (body) body.innerHTML = `
        <div style="color:#ff8a80;text-align:center;font-size:14px;line-height:1.5;">
          이미지 처리 실패<br><span style="color:#999;font-size:12px;">${esc(e.message)}</span>
        </div>
        <button onclick="window._ssReshoot()" style="margin-top:14px;background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:10px 24px;border-radius:8px;font-size:13px;cursor:pointer;">다시 시도</button>
      `;
    }
  }

  // 클라 리사이즈 — max 1536px + JPEG q=0.85 → Vercel 4.5MB 한도 안전
  async function _processImage(file) {
    if (!/^image\//.test(file.type) && file.type !== '') {
      throw new Error('이미지 파일만 가능해요');
    }
    const imgUrl = URL.createObjectURL(file);
    let img;
    try {
      img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('이미지 로드 실패 (지원하지 않는 형식일 수 있어요)'));
        i.src = imgUrl;
      });
    } finally {
      // load 후엔 src 만 있으면 되니 URL 해제 미리 안 함 (Safari 종종 race)
    }
    const maxSide = 1536;
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
      dataUrl,
      base64,
      mimeType: 'image/jpeg',
      sizeKB: Math.round(blob.size / 1024),
      width: canvas.width,
      height: canvas.height,
    };
  }

  function _renderPreviewScreen(dataUrl, sizeKB) {
    _state.phase = 'preview';
    const body = document.getElementById('ssCaptureBody');
    if (!body) return;
    body.innerHTML = `
      <div style="width:100%;max-width:520px;display:flex;flex-direction:column;gap:14px;">
        <img src="${dataUrl}" alt="답안지 미리보기" style="width:100%;border-radius:8px;background:#000;max-height:70vh;object-fit:contain;">
        <div style="font-size:11px;color:#888;text-align:center;">처리된 이미지 · ${sizeKB} KB</div>
        <div style="display:flex;gap:10px;">
          <button onclick="window._ssReshoot()"
            style="flex:1;background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:13px;border-radius:8px;font-size:14px;cursor:pointer;">
            🔄 재촬영
          </button>
          <button onclick="window._ssStartGrading()"
            style="flex:2;background:var(--c-brand,#E8714A);color:#fff;border:none;padding:13px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">
            ✓ 채점 진행
          </button>
        </div>
      </div>
    `;
  }

  window._ssReshoot = function () {
    _state.captured = null;
    _renderCaptureScreen();
  };

  // ── T5. 채점 API 호출 → 결과 화면 ──
  window._ssStartGrading = async function () {
    if (!_state.captured) {
      if (typeof window.showAlert === 'function') window.showAlert('오류', '먼저 답안지를 촬영해주세요');
      return;
    }
    _renderGradingProgress();
    try {
      const idToken = await window._ssGetIdToken();
      const c = _state.captured;
      const res = await fetch('/api/scoresnap-grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          testId: _state.testId,
          studentImageBase64: c.base64,
          studentImageMimeType: c.mimeType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      _state.result = data;
      _state.studentName = '';
      _state.gradedAt = new Date();
      _renderResultScreen();
    } catch (e) {
      _renderGradingError(e.message);
    }
  };

  function _renderGradingProgress() {
    _state.phase = 'grading';
    const body = document.getElementById('ssCaptureBody');
    if (!body) return;
    body.innerHTML = `
      <div style="text-align:center;padding:40px;display:flex;flex-direction:column;align-items:center;gap:18px;">
        <div style="width:48px;height:48px;border:4px solid #333;border-top-color:var(--c-brand,#E8714A);border-radius:50%;animation:ssSpin 1s linear infinite;"></div>
        <div style="font-size:15px;color:#fff;font-weight:600;">AI 채점 중…</div>
        <div style="font-size:12px;color:#888;line-height:1.5;">학생 답안지를 분석하고 있어요<br>보통 3~6 초</div>
      </div>
      <style>@keyframes ssSpin { to { transform: rotate(360deg); } }</style>
    `;
  }

  function _renderGradingError(msg) {
    const body = document.getElementById('ssCaptureBody');
    if (!body) return;
    body.innerHTML = `
      <div style="text-align:center;padding:30px;display:flex;flex-direction:column;align-items:center;gap:14px;max-width:420px;">
        <div style="font-size:48px;">⚠</div>
        <div style="font-size:15px;color:#ff8a80;font-weight:600;">채점 실패</div>
        <div style="font-size:13px;color:#bbb;line-height:1.6;">${esc(msg)}</div>
        <button onclick="window._ssReshoot()" style="margin-top:14px;background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:10px 24px;border-radius:8px;font-size:13px;cursor:pointer;">다시 시도</button>
      </div>
    `;
  }

  // ── 결과 화면 ──
  function _renderResultScreen() {
    _state.phase = 'result';
    _setHeader(`📊 ScoreSnap · ${_state.testTitle}`);
    const body = document.getElementById('ssBody');
    if (!body) return;
    body.innerHTML = `
      <div id="ssResultRoot" style="flex:1;overflow-y:auto;background:#0a0a0a;">
        <div id="ssResultCard" style="background:#fff;color:#222;max-width:680px;margin:18px auto;padding:24px 28px;border-radius:10px;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;">
          ${_buildResultCardHtml()}
        </div>
        <div style="max-width:680px;margin:0 auto 24px;padding:14px 18px;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;">
          <button onclick="window._ssDownloadPng()" style="background:var(--c-brand,#E8714A);color:#fff;border:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">📥 PNG 다운로드</button>
          <button onclick="window._ssNextStudent()" style="background:rgba(255,255,255,0.08);color:#fff;border:1px solid #555;padding:12px 22px;border-radius:8px;font-size:14px;cursor:pointer;">➡ 다음 학생</button>
          <button onclick="window.closeScoreSnap()" style="background:transparent;color:#bbb;border:1px solid #444;padding:12px 22px;border-radius:8px;font-size:14px;cursor:pointer;">종료</button>
        </div>
      </div>
    `;
  }

  function _buildResultCardHtml() {
    const r = _state.result || {};
    const ans = r.answers || [];
    const total = r.totalQuestions || ans.length;
    const correct = r.correctCount || ans.filter(a => a.isCorrect).length;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    const wrongNos = ans.filter(a => !a.isCorrect).map(a => a.no);
    const uncertain = new Set(r.uncertainQuestions || []);
    const dateStr = _fmtDate(_state.gradedAt);

    // 의심 카드 (confidence 낮음) — 학원장 검토
    const reviewCards = ans
      .filter(a => uncertain.has(a.no))
      .map(a => `
        <div style="border:1px solid #ffc107;background:#fff8e1;border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:12px;">
          <div style="font-weight:700;color:#e65100;margin-bottom:4px;">Q${a.no} · ${a.isCorrect ? '✓' : '✗'} · confidence ${Math.round((a.confidence||0)*100)}%</div>
          <div style="color:#555;line-height:1.6;">
            학생답: <b>${esc(a.studentAnswer || '(빈칸)')}</b> &nbsp;→&nbsp;
            정답: <b>${esc(a.correctAnswer || '?')}</b>
          </div>
          <div style="margin-top:6px;display:flex;gap:6px;">
            ${a.isCorrect
              ? `<button onclick="window._ssToggleAnswer(${a.no}, false)" style="font-size:11px;padding:4px 10px;border:1px solid #c62828;background:#fff;color:#c62828;border-radius:4px;cursor:pointer;">✗ 오답으로 수정</button>`
              : `<button onclick="window._ssToggleAnswer(${a.no}, true)" style="font-size:11px;padding:4px 10px;border:1px solid #2e7d32;background:#fff;color:#2e7d32;border-radius:4px;cursor:pointer;">✓ 정답으로 수정</button>`
            }
          </div>
        </div>
      `).join('');

    // 전체 문항 — 한 줄 요약
    const allRows = ans.map(a => `
      <div style="display:flex;gap:10px;padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;align-items:center;">
        <span style="width:30px;color:#888;font-weight:700;">Q${a.no}</span>
        <span style="width:24px;color:${a.isCorrect ? '#2e7d32' : '#c62828'};font-weight:700;">${a.isCorrect ? '✓' : '✗'}</span>
        <span style="flex:1;min-width:0;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.studentAnswer || '(빈칸)')}</span>
        <span style="color:#888;font-size:11px;">→ ${esc(a.correctAnswer || '?')}</span>
      </div>
    `).join('');

    return `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px;border-bottom:2px solid #333;padding-bottom:10px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:11px;color:#888;">${esc(window.MY_ACADEMY_NAME || '')}</div>
          <div style="font-size:17px;font-weight:800;color:#111;margin-top:2px;">${esc(_state.testTitle)}</div>
          <div style="font-size:11px;color:#555;margin-top:4px;">총 ${total}문항 · 채점일 ${esc(dateStr)}</div>
        </div>
        <div style="text-align:right;font-size:12px;line-height:1.8;border:1px solid #999;padding:8px 14px;border-radius:6px;background:#fff;min-width:200px;">
          <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;">
            <span>학생:</span>
            <input id="ssStudentNameIn" type="text" value="${esc(_state.studentName || '')}"
              placeholder="이름 입력"
              oninput="window._ssState && (window._ssState.studentName = this.value)"
              style="width:130px;padding:4px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px;font-family:inherit;">
          </div>
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

      ${reviewCards ? `
        <div style="margin-bottom:18px;">
          <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:8px;">⚠ 검토 필요 (AI 가 자신 없음)</div>
          ${reviewCards}
        </div>
      ` : ''}

      <details style="margin-bottom:6px;">
        <summary style="font-size:13px;font-weight:700;color:#333;cursor:pointer;padding:6px 0;">📋 전체 문항 보기 (${total}개)</summary>
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

  // ── 학원장 정답 토글 ──
  window._ssToggleAnswer = function (no, makeCorrect) {
    const r = _state.result;
    if (!r || !Array.isArray(r.answers)) return;
    const a = r.answers.find(x => x.no === no);
    if (!a) return;
    a.isCorrect = makeCorrect === true;
    a._adminOverride = true;  // PNG 표시용 마커
    // 재계산
    r.correctCount = r.answers.filter(x => x.isCorrect).length;
    r.scorePercent = r.totalQuestions > 0 ? Math.round((r.correctCount / r.totalQuestions) * 100) : 0;
    r.wrongNumbers = r.answers.filter(x => !x.isCorrect).map(x => x.no);
    // 입력한 이름 보존
    const nameIn = document.getElementById('ssStudentNameIn');
    if (nameIn) _state.studentName = nameIn.value || '';
    // 결과 카드만 다시 그림
    const card = document.getElementById('ssResultCard');
    if (card) card.innerHTML = _buildResultCardHtml();
  };

  // window._ssState 노출 — 이름 input oninput 에서 사용
  Object.defineProperty(window, '_ssState', {
    get: () => _state,
  });

  // ── 다음 학생 ──
  window._ssNextStudent = function () {
    _state.studentCount = (_state.studentCount || 0) + 1;
    _state.captured = null;
    _state.result = null;
    _state.studentName = '';
    _state.gradedAt = null;
    _renderCaptureScreen();
  };

  // ── PNG 다운로드 (html2canvas 동적 로드) ──
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

  window._ssDownloadPng = async function () {
    const card = document.getElementById('ssResultCard');
    if (!card) return;
    // 이름 input 의 현재 값 보존 + value 속성 박아 캡처에 반영
    const nameIn = document.getElementById('ssStudentNameIn');
    if (nameIn) {
      _state.studentName = nameIn.value || '';
      nameIn.setAttribute('value', nameIn.value || '');
    }
    try {
      await _ensureHtml2Canvas();
    } catch (e) {
      if (typeof window.showAlert === 'function') window.showAlert('PNG 라이브러리 로드 실패', e.message);
      return;
    }
    try {
      const canvas = await window.html2canvas(card, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true,
      });
      canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const name = (_state.studentName || 'student').replace(/[\\/:*?"<>|]/g, '_');
        const date = _fmtDate(_state.gradedAt || new Date()).replace(/[: ]/g, '_');
        const title = (_state.testTitle || 'test').replace(/[\\/:*?"<>|]/g, '_');
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
})();
