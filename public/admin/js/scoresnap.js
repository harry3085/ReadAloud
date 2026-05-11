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

  // ── jsQR 동적 로드 ──
  function _ensureJsQR() {
    if (typeof window.jsQR === 'function') return Promise.resolve();
    if (_jsQrLoading) return _jsQrLoading;
    _jsQrLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { _jsQrLoading = null; reject(new Error('jsQR 로드 실패')); };
      document.head.appendChild(s);
    });
    return _jsQrLoading;
  }

  // ── 카메라 시작 + QR 스캔 루프 ──
  async function _startCameraScan() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('이 브라우저는 카메라 미지원');
    }
    await _ensureJsQR();
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
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

    const tick = () => {
      if (!_stream) return;
      if (!video.videoWidth || video.videoWidth === 0) {
        _scanRaf = requestAnimationFrame(tick);
        return;
      }
      // 다운샘플 — 너무 큰 frame 은 처리 비용 큼
      const maxSide = 640;
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      const now = Date.now();
      if (code && code.data) {
        // 같은 코드 1초 내 재인식 무시
        if (code.data !== lastDetected || now - lastDetectedAt > 1000) {
          lastDetected = code.data;
          lastDetectedAt = now;
          _onQrDetected(code.data);
          return;  // 스캔 중단 (다음 화면으로)
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

  // T5 채점 API 호출 자리표시자 — 현재는 검증용 메시지만
  window._ssStartGrading = function () {
    if (!_state.captured) {
      if (typeof window.showAlert === 'function') window.showAlert('오류', '먼저 답안지를 촬영해주세요');
      return;
    }
    const c = _state.captured;
    if (typeof window.showAlert === 'function') {
      window.showAlert(
        '채점 단계 (T5 작업 대기)',
        `학생 ${_state.studentCount + 1}번째 답안지 처리 완료\n` +
        `· 시험: ${_state.testTitle}\n` +
        `· 이미지: ${c.width}×${c.height} · ${c.sizeKB} KB\n` +
        `· base64 길이: ${c.base64.length} chars\n\n` +
        `T5 에서 Gemini Vision 채점 API 호출.`
      );
    }
  };
})();
