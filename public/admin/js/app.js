import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc, query, where, orderBy, serverTimestamp, limit, startAfter, documentId, getCountFromServer, increment, arrayUnion, deleteField, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage, ref, deleteObject, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';


// ── 유틸 ─────────────────────────────────────────────────
function esc(str){return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
let _toastTimer=null;
function showToast(msg){
  const t=document.getElementById('toast');
  if(!t)return;
  t.textContent=msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>t.classList.remove('show'),2500);
}
window.showToast=showToast;

// 비번 보기/숨기기 토글 — 학생 추가·수정 모달의 비밀번호 input 에서 사용 (2026-06-02)
const _SVG_EYE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const _SVG_EYE_OFF = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;
window.togglePwVis = (id, btnEl) => {
  const inp = document.getElementById(id);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  if (btnEl) btnEl.innerHTML = inp.type === 'password' ? _SVG_EYE : _SVG_EYE_OFF;
};

// 이모지 → SVG 아이콘 헬퍼 (2026-06-03 Phase 1+2 재시도 — Lucide 풍 stroke-only)
// 사용: ${iconSvg('edit')} ${iconSvg('trash', 18)}
// 이름은 iconSvg — 학원장 app.js 안 지역 변수 'icon' (6곳) 과 충돌 회피.
const ICONS = {
  edit:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
  pen:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>`,
  search:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  save:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
  settings:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/></svg>`,
  mic:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  clipboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`,
  x:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  chart:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>`,
  bot:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>`,
  lightbulb: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>`,
};
function iconSvg(name, size=16) {
  const svg = ICONS[name] || '';
  return `<span style="display:inline-flex;width:${size}px;height:${size}px;color:currentColor;vertical-align:-3px;">${svg}</span>`;
}
window.iconSvg = iconSvg;

function showConfirm(title,sub=''){
  return new Promise(resolve=>{
    document.getElementById('confirmTitle').textContent=title;
    document.getElementById('confirmSub').textContent=sub;
    const modal=document.getElementById('confirmModal');
    modal.style.display='flex';
    const ok=document.getElementById('confirmOk');
    const cancel=document.getElementById('confirmCancel');
    cancel.style.display='';  // (showAlert 가 숨겼을 수 있으므로 복원)
    const done=(val)=>{modal.style.display='none';ok.onclick=null;cancel.onclick=null;resolve(val);};
    ok.onclick=()=>done(true);
    cancel.onclick=()=>done(false);
  });
}

// 입력 검증 실패·중요 경고용 — confirmModal 재사용, Cancel 버튼은 숨김
function showAlert(title, sub=''){
  return new Promise(resolve=>{
    document.getElementById('confirmTitle').textContent=title;
    document.getElementById('confirmSub').textContent=sub;
    const modal=document.getElementById('confirmModal');
    modal.style.display='flex';
    const ok=document.getElementById('confirmOk');
    const cancel=document.getElementById('confirmCancel');
    cancel.style.display='none';
    const done=()=>{
      modal.style.display='none';
      cancel.style.display='';
      ok.onclick=null;
      resolve();
    };
    ok.onclick=done;
  });
}
window.showAlert=showAlert;

const firebaseConfig = {
  apiKey: "AIzaSyAb5d8w9mI5_hpcoBFcWnG5tE1TF_8guw8",
  authDomain: "readaloud-51113.firebaseapp.com",
  projectId: "readaloud-51113",
  storageBucket: "readaloud-51113.firebasestorage.app",
  messagingSenderId: "944153888350",
  appId: "1:944153888350:web:47091c0771d20be8ea56cf",
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

let currentUser = null, adminProfile = null;
let allGroups = [], allStudents = [], allBooks = [], allFolders = [];
let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();
let currentPage = 'dashboard';
let studentCurrentPage = 1;
const PAGE_SIZE = 10;

// KST(UTC+9) 기준 YYYY-MM-DD — apiUsage doc ID 통일
function _ymdKST(d){ return new Date((d ? d.getTime() : Date.now()) + 9*3600*1000).toISOString().slice(0,10); }

// 비용 최적화 — 기간 헬퍼 (Firestore read 절감, 2026-05-13)
function _ymdMonthStartKST(){ return _ymdKST().slice(0,7) + '-01'; }
function _ymdDaysAgoKST(n){ return _ymdKST(new Date(Date.now() - n*864e5)); }

// 콘텐츠 한도 — 학원당 공지/초안/발송이력/자료실 doc 수 (2026-05-14)
// 3단 fallback: customLimits.X (학원 override) > plan.byTier[구간].X > 코드 default
const CONTENT_LIMITS_DEFAULTS = {
  noticesPerAcademy: 20,
  draftsPerAcademy: 50,
  sentMessagesPerAcademy: 50,
  hwFilesPerAcademy: 30,
};
let _contentLimitsCache = null;
async function _loadContentLimits() {
  if (_contentLimitsCache) return _contentLimitsCache;
  try {
    const aSnap = await getDoc(doc(db, 'academies', window.MY_ACADEMY_ID));
    const academy = aSnap.exists() ? aSnap.data() : {};
    const cl = academy.customLimits || {};
    const planId = academy.planId || 'free';
    const tier = String(academy.studentLimit || 10);
    // plan byTier[구간] fetch (학원당 1회)
    const pSnap = await getDoc(doc(db, 'plans', planId));
    const plan = pSnap.exists() ? pSnap.data() : {};
    const tierLimits = (plan.byTier || {})[tier] || (plan.byTier || {})[Object.keys(plan.byTier||{})[0]] || {};
    _contentLimitsCache = {
      noticesPerAcademy:      cl.noticesPerAcademy      ?? tierLimits.noticesPerAcademy      ?? CONTENT_LIMITS_DEFAULTS.noticesPerAcademy,
      draftsPerAcademy:       cl.draftsPerAcademy       ?? tierLimits.draftsPerAcademy       ?? CONTENT_LIMITS_DEFAULTS.draftsPerAcademy,
      sentMessagesPerAcademy: cl.sentMessagesPerAcademy ?? tierLimits.sentMessagesPerAcademy ?? CONTENT_LIMITS_DEFAULTS.sentMessagesPerAcademy,
      hwFilesPerAcademy:      cl.hwFilesPerAcademy      ?? tierLimits.hwFilesPerAcademy      ?? CONTENT_LIMITS_DEFAULTS.hwFilesPerAcademy,
    };
  } catch(e) {
    console.warn('[limits] load fail:', e.message);
    _contentLimitsCache = { ...CONTENT_LIMITS_DEFAULTS };
  }
  return _contentLimitsCache;
}
// 한도 검사 — kind: 'notices' | 'drafts' | 'sentMessages' | 'hwFiles'
async function _checkContentLimit(kind) {
  const limits = await _loadContentLimits();
  const cfg = {
    notices:      { col: 'notices',           extra: [], limitKey: 'noticesPerAcademy',      label: '공지' },
    drafts:       { col: 'pushNotifications', extra: [where('sent','==',false)], limitKey: 'draftsPerAcademy',       label: '초안' },
    sentMessages: { col: 'pushNotifications', extra: [where('sent','==',true)],  limitKey: 'sentMessagesPerAcademy', label: '발송이력' },
    hwFiles:      { col: 'hwFiles',           extra: [], limitKey: 'hwFilesPerAcademy',      label: '자료실' },
  }[kind];
  if (!cfg) return { ok: true };
  const maxCount = limits[cfg.limitKey];
  try {
    const snap = await getCountFromServer(query(
      collection(db, cfg.col),
      where('academyId','==', window.MY_ACADEMY_ID),
      ...cfg.extra,
    ));
    const cur = snap.data().count;
    if (cur >= maxCount) return { ok: false, cur, max: maxCount, label: cfg.label };
    return { ok: true, cur, max: maxCount };
  } catch(e) {
    console.warn('[limits] count fail:', e.message);
    return { ok: true };
  }
}

// fetch + idToken 자동주입 wrapper.
// 일별/월별 사용량 카운트는 서버 quota.js incrementUsage 가 단일 writer 로 통합 처리
// (이전 클라 _logApiCall 은 daily/monthly 드리프트 원인이라 폐기됨, 2026-05-02).
async function _geminiFetch(url, init){
  // body 에 idToken 자동 주입 (Phase 3 — 서버 인증)
  let finalInit = init;
  try {
    if (init?.body && currentUser) {
      const idToken = await currentUser.getIdToken();
      const bodyObj = JSON.parse(init.body);
      if (!bodyObj.idToken) bodyObj.idToken = idToken;
      finalInit = { ...init, body: JSON.stringify(bodyObj) };
    }
  } catch(_) {}
  const res = await fetch(url, finalInit);
  // 대시보드 위젯 자동 갱신 (1.5초 후 — 서버 incrementUsage 반영 대기)
  if (currentPage === 'dashboard' && typeof loadApiUsage === 'function') {
    setTimeout(() => loadApiUsage(), 1500);
  }
  // T8 — 한도 사용 % 검사 → 80%/95% 임계 토스트 (한 페이지 세션 내 중복 회피)
  _checkQuotaWarning(res);
  return res;
}

// T8 — 응답 헤더의 X-Quota-* 검사 후 80%/95% 임계 토스트
const _quotaWarned = {};  // { [kindLabel]: { warned80: bool, warned95: bool } }
function _checkQuotaWarning(res){
  try {
    const pct = parseInt(res.headers.get('X-Quota-Percent'), 10);
    if (!isFinite(pct)) return;
    const kindRaw = res.headers.get('X-Quota-Kind') || '';
    const kind = kindRaw ? decodeURIComponent(kindRaw) : '한도';
    const used = res.headers.get('X-Quota-Used');
    const limit = res.headers.get('X-Quota-Limit');
    const state = _quotaWarned[kind] || { warned80: false, warned95: false };
    if (pct >= 95 && !state.warned95) {
      state.warned95 = true;
      showToast(`⚠️ ${kind} 한도 ${pct}% 도달 (${used}/${limit}) — 곧 차단됩니다`);
    } else if (pct >= 80 && !state.warned80) {
      state.warned80 = true;
      showToast(`${kind} 한도 ${pct}% 도달 (${used}/${limit})`);
    }
    _quotaWarned[kind] = state;
  } catch(_) {}
}

// ── 인증 체크 ──────────────────────────────────────────
// 학원 컨텍스트 로드 — Custom Claims 우선, users 문서 폴백, 'default' 최종 폴백
// 헤더 Version 표시 — SW 에 실제 캐시명 질의 (kunsori-v546 → "Version 5.4.6")
// 학원장이 캐시 갱신 여부 자가진단 (강력 새로고침 후 숫자 바뀌면 갱신됨)
async function _showAppVersion() {
  try {
    if (!navigator.serviceWorker) return;
    const reg = await navigator.serviceWorker.ready;
    const sw = reg.active || navigator.serviceWorker.controller;
    if (!sw) return;
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      const m = String(e.data || '').match(/\d+/);
      if (!m) return;
      const d = m[0];                                  // 예: '546'
      const patch = d.slice(-1);
      const minor = d.slice(-2, -1) || '0';
      const major = d.slice(0, -2) || '0';
      const el = document.getElementById('appVer');
      if (el) el.textContent = `Version ${major}.${minor}.${patch}`;
    };
    sw.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  } catch (_) {}
}

async function _loadMyAcademyContext(user, userDocData) {
  let academyId = null, role = null;
  try {
    const tk = await user.getIdTokenResult();
    academyId = tk.claims.academyId || null;
    role = tk.claims.role || null;
  } catch(_) {}
  if (!academyId && userDocData) academyId = userDocData.academyId || null;
  if (!academyId) academyId = 'default';
  window.MY_ACADEMY_ID = academyId;
  window.MY_ROLE = role || (userDocData && userDocData.role) || null;
  // 학원명 + 화이트라벨 브랜딩 + LexiAI 기본 — 한 번에 fetch
  try {
    const [acSnap, lexiSnap] = await Promise.all([
      getDoc(doc(db, 'academies', academyId)),
      getDoc(doc(db, 'appConfig', 'branding')).catch(() => null),
    ]);
    const acData = acSnap.exists() ? acSnap.data() : null;
    window.MY_ACADEMY_NAME = (acData && acData.name) || '';
    window.LEXIAI_BRANDING = (lexiSnap && lexiSnap.exists?.()) ? lexiSnap.data() : null;
    // 학원장 커스텀 AI 프롬프트 — Firestore 동기화 (다른 PC 에서도 적용)
    window.MY_CUSTOM_PROMPTS = (acData && acData.customPrompts) || {};
    // featureFlags — scoreSnap 등 학원별 기능 토글 (super_admin 이 부여)
    window.MY_FEATURE_FLAGS = (acData && acData.featureFlags) || {};
    _applyAdminBranding(acData);
    // PWA manifest 학원별 갱신 (바로가기 추가 시 학원 로고로 등록)
    if (typeof window.updateAdminManifest === 'function') window.updateAdminManifest(academyId);
    // localStorage 잔여 → Firestore 1회 마이그레이션 (background)
    _migrateLocalStoragePromptsToFirestore(academyId).catch(e => console.warn('[customPrompts] migration:', e.message));
    // ScoreSnap 진입점 — featureFlags.scoreSnap=true 면 헤더 로고 더블클릭 활성화
    if (typeof window._ssBindEntrypoint === 'function') window._ssBindEntrypoint();
  } catch(_) { window.MY_ACADEMY_NAME = ''; window.MY_CUSTOM_PROMPTS = {}; window.MY_FEATURE_FLAGS = {}; }
  console.log('[academy] uid=' + user.uid.slice(0,8) + '… academyId=' + academyId + ' role=' + window.MY_ROLE + ' name=' + window.MY_ACADEMY_NAME);
}

// 학원장 앱 — 자기 학원 색·로고 적용. Free 는 LexiAI 기본, Lite+ 는 학원 자체 후 LexiAI fallback
function _applyAdminBranding(acData) {
  if (!acData) return;
  const planId = acData.planId || 'free';
  const branding = acData.branding || {};
  const lexi = window.LEXIAI_BRANDING || {};
  const presets = window.BRANDING_PRESETS || {};
  const isFree = (planId === 'free');
  const presetId = isFree
    ? (lexi.defaultPresetId || 'coral')
    : (branding.presetId || lexi.defaultPresetId || 'coral');
  const preset = presets[presetId] || presets.coral;
  if (preset && typeof window.applyPresetToCss === 'function') window.applyPresetToCss(preset);
  // 로고 — Free 는 학원 자체 무시, LexiAI 기본 사용
  const logoUrl = isFree
    ? (lexi.defaultLogo192Url || '')
    : (branding.logo192Url || lexi.defaultLogo192Url || '');
  window.MY_ACADEMY_LOGO = logoUrl;  // 시험지 인쇄·기타 위치에서 참조
  if (logoUrl) {
    document.querySelectorAll('.header-logo img, .sidebar-logo').forEach(img => {
      if (img.tagName === 'IMG') {
        img.src = logoUrl;
        img.onerror = () => { img.src = '/icons/icon-192.png'; img.onerror = null; };
      }
    });
  }
  // 헤더 학원명 — academy.name 우선. 비어있으면 LexiAI defaultAppName 폴백
  const acadName = acData.name || lexi.defaultAppName || 'LexiAI';
  const headerLogo = document.querySelector('.header-logo');
  if (headerLogo) {
    const textNode = Array.from(headerLogo.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (textNode) textNode.textContent = ' ' + acadName;
  }
  const adminTitle = acadName + ' 관리자';
  document.title = adminTitle;
  // iOS 홈화면 추가 시 표시되는 이름 (apple-mobile-web-app-title 우선)
  const _at = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (_at) _at.setAttribute('content', adminTitle);
  const _an = document.querySelector('meta[name="application-name"]');
  if (_an) _an.setAttribute('content', adminTitle);
  // 다음 진입 시 FOUC 방지용 캐시 (학생 앱과 동일 키)
  try {
    if (logoUrl) localStorage.setItem('lexiLogo192', logoUrl);
    if (acadName) localStorage.setItem('lexiAppName', acadName);
    if (presetId) localStorage.setItem('lexiBrandPreset', presetId);
    // PWA manifest 학원별 적용 — 다음 진입부터 학원 manifest 즉시 전환 (iOS PWA 이름 보장)
    if (window.MY_ACADEMY_ID) localStorage.setItem('lexiAcademyId', window.MY_ACADEMY_ID);
  } catch (_) {}

  // SW 에 학원명 전달 — iOS [홈화면 추가] 시 SW 가 HTML 가로채서 학원명 박은 응답
  // (학원장 페이지는 SW 가 ' 관리자' suffix 자동 추가)
  if (navigator.serviceWorker?.controller && acadName && window.MY_ACADEMY_ID) {
    try {
      navigator.serviceWorker.controller.postMessage({
        type: 'ACADEMY_NAME_UPDATE',
        academyId: String(window.MY_ACADEMY_ID),
        name: String(acadName),
      });
    } catch (_) {}
  }

  // [PWA 학원명 적용 reload] 제거 — 로그인 navigation 도중 trigger 되어 무한 로딩 유발.
}

onAuthStateChanged(auth, async user => {
  if(!user){ window.location.href='/'; return; }
  // super_admin Custom Claims 가진 사용자는 학원장 앱 진입 차단 → /super/ 로 추방.
  // 정상 super_admin 보호 + 옛 admin 계정에 잘못 박힌 super_admin claims 방어.
  try {
    const tk = await user.getIdTokenResult();
    if (tk.claims?.role === 'super_admin') {
      window.location.href = '/super/';
      return;
    }
  } catch(_) {}
  const snap = await getDoc(doc(db,'users',user.uid));
  if(!snap.exists() || snap.data().role !== 'admin'){
    window.location.href='/'; return;
  }
  currentUser = user;
  adminProfile = {uid: user.uid, ...snap.data()};
  await _loadMyAcademyContext(user, snap.data());
  _showAppVersion();  // 헤더 Version 표시 (SW 캐시 질의, fire-and-forget)
  // T1: 학원장 마지막 로그인 시각 기록 (super_admin 제외, 권한 부족 시 silent)
  if (window.MY_ROLE !== 'super_admin' && window.MY_ACADEMY_ID) {
    try {
      await updateDoc(doc(db, 'academies', window.MY_ACADEMY_ID), { lastAdminLoginAt: serverTimestamp() });
    } catch(_) { /* rules 미배포 등 무시 */ }
  }
  document.getElementById('adminName').textContent = adminProfile.name || '관리자';
  await initDashboard();
});

// ── 로그아웃 ──────────────────────────────────────────
window.doLogout = async() => {
  if(!await showConfirm('로그아웃 하시겠어요?')) return;
  await signOut(auth);
  localStorage.removeItem('lastLoginAt');
  window.location.href = '/';
};

// ── 페이지 전환 ─────────────────────────────────────
const pageLabels = {
  dashboard:'초기화면', class:'클래스 관리',
  'student-active':'재원생 관리', 'student-pause':'휴원생 관리',
  'student-out':'퇴원생 관리', 'student-excel':'엑셀 등록',
  'test-list':'진도체크',
  'score-report':'성적 리포트', 'score-personal':'성장 리포트',
  message:'메시지 관리', notice:'공지 관리', hwfile:'자료실', payment:'결제 관리',
  quotaUsage:'AI 사용량',
  branding:'학원 브랜딩',
  generator:'AI OCR',
  'quiz-generate':'AI Generator', 'quiz-sets':'문제 세트 목록',
  'test-word':'단어시험',
  'test-unscramble':'언스크램블',
  'test-blank':'빈칸채우기',
  'test-mcq':'본문이해·문법_객관식',
  'test-subj':'해석하기_주관식',
  'test-rec-ai':'녹음숙제',
};
window.goPage = async(id) => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-'+id)?.classList.add('active');
  document.getElementById('nav-'+id)?.classList.add('active');
  document.getElementById('pageLabel').textContent = pageLabels[id] || id;
  currentPage = id;
  // 페이지별 데이터 로드
  if(id==='dashboard') await initDashboard();
  else if(id==='class') await loadClasses();
  else if(id==='student-active') await loadStudents('active');
  else if(id==='student-pause') await loadStudents('pause');
  else if(id==='student-out') await loadStudents('out');
  else if(id==='notice') await loadNotices();
  else if(id==='hwfile') await loadHwFileAdmin();
  else if(id==='payment') await loadPayments();
  else if(id==='quotaUsage') await loadQuotaUsage();
  else if(id==='branding') await loadBranding();
  else if(id==='message') await loadMessages();
  else if(id==='test-list') await loadProgressCheck();
  else if(id==='score-report') initScoreReport();
  else if(id==='score-personal') await loadPersonalStudentList();
  else if(id==='generator') await loadGenerator({});
  else if(id==='quiz-generate') await loadQuizGenerate();
  else if(id==='quiz-sets')     await loadQuestionSets();
  // Phase 1 플레이스홀더 — 별도 데이터 로드 없음
  else if(id==='test-word')       await _renderTestAssignDetail('word');
  else if(id==='test-unscramble') await _renderTestAssignDetail('unscramble');
  else if(id==='test-blank')      await _renderTestAssignDetail('blank');
  else if(id==='test-mcq')        await _renderTestAssignDetail('mcq');
  else if(id==='test-subj')       await _renderTestAssignDetail('subj');
  else if(id==='test-rec-ai')     await _renderTestAssignDetail('rec-ai');
};

window.toggleNav = (group) => {
  const el = document.getElementById('navgroup-'+group);
  el?.classList.toggle('open');
};

// ── 달력 ──────────────────────────────────────────────
window.changeMonth = (d) => {
  calMonth += d;
  if(calMonth > 11){ calMonth=0; calYear++; }
  if(calMonth < 0){ calMonth=11; calYear--; }
  renderCalendar();
};
function renderCalendar(){
  const months=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  document.getElementById('calTitle').textContent = calYear+'년 '+months[calMonth];
  const grid = document.getElementById('calGrid');
  const days = ['일','월','화','수','목','금','토'];
  const today = new Date();
  const first = new Date(calYear, calMonth, 1);
  const last = new Date(calYear, calMonth+1, 0);
  let html = days.map(d=>`<div class="cal-day-label">${d}</div>`).join('');
  for(let i=0; i<first.getDay(); i++) html+=`<div class="cal-cell other-month"></div>`;
  for(let d=1; d<=last.getDate(); d++){
    const isToday = d===today.getDate()&&calMonth===today.getMonth()&&calYear===today.getFullYear();
    const dow = new Date(calYear,calMonth,d).getDay();
    const cls = [isToday?'today':'', dow===0?'sun':dow===6?'sat':''].filter(Boolean).join(' ');
    html += `<div class="cal-cell ${cls}">${d}</div>`;
  }
  grid.innerHTML = html;
}

// ── 큰 달력 (대시보드 통합 일정) ─────────────────────
// 결제(billings) + 시험(genTests) 월별 통합 뷰. 학원별 academyId 필터.
// 2026-05-14: 월별 캐시 (이미 받은 달 재방문 시 fetch X) + billings lazy (민감정보 토글 ON 시만 fetch)
const _bigcalState = {
  cur: { year: new Date().getFullYear(), month: new Date().getMonth() },  // 0-indexed month
  events: {},        // 현재 표시 중인 events ({'YYYY-MM-DD': { billings:[...], tests:[...] }})
  selected: null,    // 'YYYY-MM-DD'
  loading: false,
  cache: {},         // ym → { events, billingsLoaded, testsLoaded }
};

function _bigcalYM(y, m){ return `${y}-${String(m+1).padStart(2,'0')}`; }
function _bigcalDateKey(y, m, d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

function _bigcalInitEvents(year, month) {
  const lastDay = new Date(year, month+1, 0).getDate();
  const events = {};
  for (let d=1; d<=lastDay; d++) events[_bigcalDateKey(year, month, d)] = { billings:[], tests:[] };
  return events;
}

async function _bigcalFetchTests(year, month, entry) {
  const academyId = window.MY_ACADEMY_ID;
  if (!academyId) return;
  const ym = _bigcalYM(year, month);
  const lastDay = new Date(year, month+1, 0).getDate();
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(lastDay).padStart(2,'0')}`;
  try {
    const tSnap = await getDocs(query(
      collection(db, 'genTests'),
      where('academyId','==', academyId),
      where('date','>=', monthStart),
      where('date','<=', monthEnd),
      limit(500)
    ));
    tSnap.forEach(docSnap => {
      const t = docSnap.data();
      const date = t.date;
      if (!date || !entry.events[date]) return;
      entry.events[date].tests.push({
        id: docSnap.id,
        name: t.name || '-',
        mode: t.mode || t.testMode || 'vocab',
        speaking: !!(t.vocabOptions?.format === 'speaking'),
      });
    });
    entry.testsLoaded = true;
  } catch(e) { console.warn('[bigcal] tests:', e); }
}

async function _bigcalFetchBillings(year, month, entry) {
  const academyId = window.MY_ACADEMY_ID;
  if (!academyId) return;
  const ym = _bigcalYM(year, month);
  try {
    const bSnap = await getDocs(query(
      collection(db, 'billings'),
      where('academyId','==', academyId),
      where('yearMonth','==', ym)
    ));
    bSnap.forEach(docSnap => {
      const b = docSnap.data();
      const due = b.dueDate?.toDate?.();
      if (!due) return;
      const key = _bigcalDateKey(due.getFullYear(), due.getMonth(), due.getDate());
      if (!entry.events[key]) return;
      entry.events[key].billings.push({
        billingId: docSnap.id,
        userId: b.studentUid || '',
        userName: b.studentName || '-',
        groupName: b.groupName || '',
        amount: b.totalAmount || 0,
        paidAmount: b.paidAmount || 0,
        status: b.status || 'unpaid',
      });
    });
    entry.billingsLoaded = true;
  } catch(e) { console.warn('[bigcal] billings:', e); }
}

async function _bigcalLoadEvents(year, month){
  const academyId = window.MY_ACADEMY_ID;
  if (!academyId) return {};
  const ym = _bigcalYM(year, month);
  let entry = _bigcalState.cache[ym];
  if (!entry) {
    entry = { events: _bigcalInitEvents(year, month), billingsLoaded: false, testsLoaded: false };
    _bigcalState.cache[ym] = entry;
  }
  // tests — 항상 fetch (미로드 시)
  if (!entry.testsLoaded) await _bigcalFetchTests(year, month, entry);
  // billings — 민감정보 토글 ON 시만 fetch
  if (_dashSensitiveVisible && !entry.billingsLoaded) await _bigcalFetchBillings(year, month, entry);
  return entry.events;
}

// 그리드 + 사이드 패널 렌더
function _bigcalRender(){
  const { year, month } = _bigcalState.cur;
  const titleEl = document.getElementById('bigcalTitle');
  if (titleEl) titleEl.textContent = `${year}년 ${month+1}월`;
  const grid = document.getElementById('bigcalGrid');
  if (!grid) return;

  const days = ['일','월','화','수','목','금','토'];
  const today = new Date();
  const todayKey = _bigcalDateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month+1, 0).getDate();
  const startDow = first.getDay();
  // 앞 여백 = 이전 달 말일들
  const prevLastDay = new Date(year, month, 0).getDate();
  const prevMonth = month === 0 ? 11 : month-1;
  const prevYear = month === 0 ? year-1 : year;
  // 뒤 여백 = 다음 달 1일들 (총 6주 = 42칸 채우기)
  const totalCells = Math.ceil((startDow + lastDay) / 7) * 7;
  const tailCount = totalCells - startDow - lastDay;
  const nextMonth = month === 11 ? 0 : month+1;
  const nextYear = month === 11 ? year+1 : year;

  let html = days.map((d,i) => `<div class="bigcal-day-label ${i===0?'sun':i===6?'sat':''}">${d}</div>`).join('');

  // 이전 달
  for (let i=startDow-1; i>=0; i--){
    const d = prevLastDay - i;
    html += `<div class="bigcal-cell other-month"><div class="bigcal-num">${d}</div></div>`;
  }
  // 이번 달
  for (let d=1; d<=lastDay; d++){
    const key = _bigcalDateKey(year, month, d);
    const dow = new Date(year, month, d).getDay();
    const isToday = key === todayKey;
    const isSelected = key === _bigcalState.selected;
    const ev = _bigcalState.events[key] || { billings:[], tests:[] };
    const cls = ['bigcal-cell',
      isToday ? 'today' : '',
      isSelected ? 'selected' : '',
      dow===0 ? 'sun' : dow===6 ? 'sat' : ''
    ].filter(Boolean).join(' ');

    // 결제 셀 — 민감정보 토글 OFF 면 빈 배열 (외부 노출 차단)
    const billItems = _dashSensitiveVisible ? ev.billings.map(b => {
      const cls = b.status === 'paid' ? 'evt-billing-paid'
              : b.status === 'partial' ? 'evt-billing-partial'
              : 'evt-billing-unpaid';
      const icon = b.status === 'paid' ? '✅' : b.status === 'partial' ? '⏳' : '💳';
      const statusLabel = b.status === 'paid' ? '납부' : b.status === 'partial' ? '일부' : '미납';
      return `<div class="bigcal-event ${cls}" title="${esc(b.userName)} ${b.amount.toLocaleString()}원 (${statusLabel})">${icon} ${esc(b.userName)}</div>`;
    }) : [];
    const testItems = ev.tests.map(t => {
      const icon = t.speaking ? '🎤' : '📝';
      return `<div class="bigcal-event evt-test" title="${esc(t.name)}">${icon} ${esc(t.name)}</div>`;
    });
    const all = [...billItems, ...testItems];
    const MAX_SHOW = 5;
    const shown = all.slice(0, MAX_SHOW).join('');
    const moreCount = all.length - MAX_SHOW;
    const more = moreCount > 0 ? `<div class="bigcal-event-more">+${moreCount}건</div>` : '';
    html += `<div class="${cls}" data-date="${key}" onclick="_bigcalSelectDate('${key}')">
      <div class="bigcal-num">${d}</div>
      <div class="bigcal-events">${shown}${more}</div>
    </div>`;
  }
  // 다음 달
  for (let d=1; d<=tailCount; d++){
    html += `<div class="bigcal-cell other-month"><div class="bigcal-num">${d}</div></div>`;
  }
  grid.innerHTML = html;

  _bigcalRenderSide();
}

// 사이드 패널 렌더
function _bigcalRenderSide(){
  const side = document.getElementById('bigcalSide');
  if (!side) return;
  const sel = _bigcalState.selected;
  if (!sel){
    side.innerHTML = '<div class="bigcal-side-empty">날짜를 선택하세요</div>';
    return;
  }
  const ev = _bigcalState.events[sel] || { billings:[], tests:[] };
  const [y,m,d] = sel.split('-').map(Number);
  const dow = ['일','월','화','수','목','금','토'][new Date(y, m-1, d).getDay()];
  const dateLabel = `${m}월 ${d}일 (${dow})`;

  const totalUnpaid = ev.billings.filter(b => b.status !== 'paid').reduce((s,b) => s+((b.amount||0)-(b.paidAmount||0)), 0);
  const totalPaid = ev.billings.reduce((s,b) => s+(b.paidAmount||0), 0);
  const billHeader = ev.billings.length
    ? `💳 결제 ${ev.billings.length}건 ${totalUnpaid > 0 ? `<span style="color:#dc2626;">미납 ${totalUnpaid.toLocaleString()}원</span>` : ''}${totalPaid > 0 ? ` <span style="color:#059669;">납부 ${totalPaid.toLocaleString()}원</span>` : ''}`
    : '';

  let html = `<div class="bigcal-side-date">${dateLabel}</div>`;

  // 결제 섹션 — 민감정보 토글 OFF 면 표시 X
  if (_dashSensitiveVisible && ev.billings.length){
    const rows = ev.billings.map(b => {
      const statusBadge = b.status === 'paid'
        ? '<span class="badge badge-green">납부</span>'
        : b.status === 'partial'
        ? '<span class="badge badge-amber">일부</span>'
        : '<span class="badge badge-red">미납</span>';
      const amountStr = b.status === 'partial' && b.paidAmount
        ? `${b.paidAmount.toLocaleString()}/${b.amount.toLocaleString()}원`
        : `${b.amount.toLocaleString()}원`;
      return `<div class="bigcal-side-row" onclick="_bigcalShowBillingDetail('${b.billingId}')">
        <div>
          <div class="bigcal-side-name">${esc(b.userName)}</div>
          <div class="bigcal-side-meta">${amountStr}${b.groupName ? ' · '+esc(b.groupName) : ''}</div>
        </div>
        ${statusBadge}
      </div>`;
    }).join('');
    html += `<div>
      <div class="bigcal-side-section-title">${billHeader}</div>
      <div class="bigcal-side-list">${rows}</div>
    </div>`;
  }

  if (ev.tests.length){
    const rows = ev.tests.map(t => {
      const badge = _unifiedTypeBadge(t.mode);
      const speak = t.speaking ? ` <span class="badge" style="background:#fef3c7;color:#78350f;font-size:9px;padding:1px 5px;border-radius:8px;font-weight:700;">${iconSvg('mic')}</span>` : '';
      return `<div class="bigcal-side-row" onclick="goPage('test-list')">
        <div>
          <div class="bigcal-side-name">${esc(t.name)}${speak}</div>
          <div class="bigcal-side-meta">${badge}</div>
        </div>
      </div>`;
    }).join('');
    html += `<div>
      <div class="bigcal-side-section-title">${iconSvg('pen')} 시험 ${ev.tests.length}건</div>
      <div class="bigcal-side-list">${rows}</div>
    </div>`;
  }

  if (!ev.billings.length && !ev.tests.length){
    html += '<div class="bigcal-side-empty">이 날 일정이 없습니다</div>';
  }

  side.innerHTML = html;
}

// 결제 상세 인라인 모달 (보기 전용 — 편집은 결제관리 페이지에서)
const _BIGCAL_TYPE_LABELS = { tuition:'수강료', book:'교재비', test:'시험비', uniform:'교복·체육복', extra:'기타' };
window._bigcalShowBillingDetail = async (billingId) => {
  // 민감정보 토글 가드 — OFF 면 모달 안 열림
  if (!_dashSensitiveVisible) { showToast('상단 [민감정보 보기] 를 먼저 누르세요'); return; }
  try {
    const snap = await getDoc(doc(db, 'billings', billingId));
    if (!snap.exists()){ showToast('청구서를 찾을 수 없습니다'); return; }
    const b = snap.data();
    const due = b.dueDate?.toDate?.();
    const dueStr = due ? `${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,'0')}-${String(due.getDate()).padStart(2,'0')}` : '-';
    const status = b.status || 'unpaid';
    const statusBadge = status === 'paid'
      ? '<span class="badge badge-green">납부 완료</span>'
      : status === 'partial'
      ? '<span class="badge badge-amber">일부 납부</span>'
      : '<span class="badge badge-red">미납</span>';
    const total = b.totalAmount || 0;
    const paid = b.paidAmount || 0;
    const remain = Math.max(0, total - paid);
    const items = b.items || [];

    const itemsHtml = items.length === 0
      ? '<div style="text-align:center;color:var(--gray);padding:20px;font-size:12px;">항목이 없습니다.</div>'
      : items.map(it => {
          const typeLabel = _BIGCAL_TYPE_LABELS[it.type] || it.type || '-';
          const itemToggle = `<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;font-weight:700;color:${it.paid?'#059669':'#dc2626'};user-select:none;">
            <input type="checkbox" ${it.paid?'checked':''} onchange="_bigcalToggleItemPaid('${billingId}','${it.itemId}',this.checked)" style="width:14px;height:14px;cursor:pointer;accent-color:#059669;">
            ${it.paid?'납부':'미납'}
          </label>`;
          const ch = it.channel === 'tuition' ? '학원비' : it.channel === 'materials' ? '교재비' : esc(it.channel||'-');
          return `<div style="padding:10px 12px;background:${it.paid?'#f0fdf4':'#fafafa'};border:1px solid ${it.paid?'#bbf7d0':'var(--border)'};border-radius:8px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
            <div style="min-width:0;">
              <div style="font-size:13px;font-weight:600;color:var(--text);">${esc(it.label || typeLabel)}</div>
              <div style="font-size:11px;color:var(--gray);margin-top:2px;">${typeLabel} · ${ch}${it.memo ? ' · '+esc(it.memo) : ''}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:13px;font-weight:700;color:var(--text);">${(it.amount||0).toLocaleString()}원</div>
              <div style="margin-top:4px;">${itemToggle}</div>
            </div>
          </div>`;
        }).join('');

    // 일괄 처리 버튼 (모든 항목 토글)
    const allPaid = items.length > 0 && items.every(it => it.paid);
    const bulkBtn = items.length === 0 ? '' : (allPaid
      ? `<button class="btn btn-secondary" style="font-size:12px;padding:5px 10px;" onclick="_bigcalToggleAllPaid('${billingId}',false)">↺ 전체 미납 되돌리기</button>`
      : `<button class="btn btn-primary" style="font-size:12px;padding:5px 10px;" onclick="_bigcalToggleAllPaid('${billingId}',true)">✓ 전체 납부 처리</button>`);

    const summaryHtml = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;">
      <div style="background:#f8f9fa;border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:11px;color:var(--gray);">청구</div>
        <div style="font-size:15px;font-weight:700;color:var(--text);margin-top:2px;">${total.toLocaleString()}원</div>
      </div>
      <div style="background:#d1fae5;border:1px solid #a7f3d0;border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:11px;color:#059669;">납부</div>
        <div style="font-size:15px;font-weight:700;color:#059669;margin-top:2px;">${paid.toLocaleString()}원</div>
      </div>
      <div style="background:${remain>0?'#fee2e2':'#f8f9fa'};border:1px solid ${remain>0?'#fecaca':'var(--border)'};border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:11px;color:${remain>0?'#dc2626':'var(--gray)'};">미납</div>
        <div style="font-size:15px;font-weight:700;color:${remain>0?'#dc2626':'var(--text)'};margin-top:2px;">${remain.toLocaleString()}원</div>
      </div>
    </div>`;

    const html = `<div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="font-size:18px;font-weight:700;color:var(--text);">💳 ${esc(b.studentName||'-')}${b.groupName ? `<span style="font-size:13px;color:var(--gray);font-weight:500;margin-left:8px;">${esc(b.groupName)}</span>` : ''}</div>
          ${statusBadge}
        </div>
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">${esc(b.yearMonth||'-')} 청구 · 납부일 ${dueStr}</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        ${summaryHtml}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;">
          <div style="font-size:13px;font-weight:700;color:var(--text);">${iconSvg('clipboard')} 항목 (${items.length})</div>
          ${bulkBtn}
        </div>
        ${itemsHtml}
        ${b.memo ? `<div style="margin-top:12px;padding:10px;background:#fef9c3;border-radius:6px;font-size:12px;color:var(--text);"><strong>메모:</strong> ${esc(b.memo)}</div>` : ''}
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">닫기</button>
        <button class="btn btn-primary" onclick="closeModal();goPage('payment')">결제관리에서 열기 →</button>
      </div>
    </div>`;
    showModal(html);
  } catch (e) {
    console.warn('[bigcal] billing detail 실패:', e);
    showToast('결제 상세 불러오기 실패');
  }
};

// 결제 항목 paid 토글 — billings doc 1건 갱신 + 모달·캘린더·결제관리 캐시 동기화
async function _bigcalApplyItemUpdate(billingId, mutator){
  const ref = doc(db, 'billings', billingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) { showToast('청구서를 찾을 수 없습니다'); return null; }
  const b = snap.data();
  const items = (b.items || []).map(mutator);
  const totalAmount = items.reduce((s, i) => s + (i.amount || 0), 0);
  const paidAmount = items.filter(i => i.paid).reduce((s, i) => s + (i.amount || 0), 0);
  const status = totalAmount === 0 ? 'paid' : (paidAmount >= totalAmount ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid'));
  await updateDoc(ref, { items, totalAmount, paidAmount, status, updatedAt: serverTimestamp() });
  // 결제관리 캐시 동기화 (있으면)
  if (typeof _billings !== 'undefined' && Array.isArray(_billings)) {
    const cached = _billings.find(x => x.id === billingId);
    if (cached) { cached.items = items; cached.totalAmount = totalAmount; cached.paidAmount = paidAmount; cached.status = status; }
  }
  // 캘린더 사이드 패널 데이터 동기화
  Object.values(_bigcalState.events).forEach(ev => {
    ev.billings.forEach(bb => {
      if (bb.billingId === billingId) {
        bb.amount = totalAmount;
        bb.paidAmount = paidAmount;
        bb.status = status;
      }
    });
  });
  _bigcalRender();
  return { items, totalAmount, paidAmount, status };
}

window._bigcalToggleItemPaid = async (billingId, itemId, paid) => {
  try {
    await _bigcalApplyItemUpdate(billingId, i => {
      if (i.itemId !== itemId) return i;
      return { ...i, paid: !!paid, paidAt: paid ? Date.now() : null };
    });
    closeModal();
    _bigcalShowBillingDetail(billingId);
    showToast(paid ? '납부 처리됨' : '미납 처리됨');
  } catch (e) {
    console.warn('[bigcal] toggle item paid 실패:', e);
    showToast('저장 실패: ' + (e.message||''));
  }
};

window._bigcalToggleAllPaid = async (billingId, paid) => {
  const label = paid ? '전체 납부 처리' : '전체 미납 되돌리기';
  if (!await showConfirm(label, '이 청구서의 모든 항목을 ' + (paid?'납부':'미납') + ' 처리할까요?')) return;
  try {
    await _bigcalApplyItemUpdate(billingId, i => ({ ...i, paid: !!paid, paidAt: paid ? Date.now() : null }));
    closeModal();
    _bigcalShowBillingDetail(billingId);
    showToast(paid ? '전체 납부 처리 완료' : '전체 미납 되돌림');
  } catch (e) {
    console.warn('[bigcal] toggle all 실패:', e);
    showToast('저장 실패: ' + (e.message||''));
  }
};

// 일자 선택
window._bigcalSelectDate = (key) => {
  _bigcalState.selected = (_bigcalState.selected === key) ? null : key;
  _bigcalRender();
};

// 월 이동
window.bigcalChangeMonth = async (delta) => {
  const { year, month } = _bigcalState.cur;
  let newY = year, newM = month + delta;
  if (newM > 11){ newM = 0; newY++; }
  if (newM < 0){ newM = 11; newY--; }
  _bigcalState.cur = { year: newY, month: newM };
  _bigcalState.selected = null;
  _bigcalState.events = {};
  _bigcalRender();
  _bigcalState.events = await _bigcalLoadEvents(newY, newM);
  _bigcalRender();
};

// 오늘 버튼
window.bigcalGoToday = async () => {
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();
  const todayKey = _bigcalDateKey(y, m, today.getDate());
  const sameMonth = (_bigcalState.cur.year === y && _bigcalState.cur.month === m);
  _bigcalState.cur = { year: y, month: m };
  _bigcalState.selected = todayKey;
  if (!sameMonth){
    _bigcalState.events = {};
    _bigcalRender();
    _bigcalState.events = await _bigcalLoadEvents(y, m);
  }
  _bigcalRender();
};

// 진입
async function bigcalInit(){
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();
  _bigcalState.cur = { year: y, month: m };
  _bigcalState.selected = _bigcalDateKey(y, m, today.getDate());
  _bigcalRender();  // 빈 상태로 그리드 먼저
  _bigcalState.events = await _bigcalLoadEvents(y, m);
  _bigcalRender();  // 이벤트 채워서 재렌더
}

// ── 대시보드 ──────────────────────────────────────────
// 민감 정보 (통계 카드 + 달력 결제) — default 숨김. 토글 시만 표시.
let _dashStatsLoaded = false;
let _dashSensitiveVisible = false;
async function initDashboard(){
  const now = new Date();
  document.getElementById('dashDate').textContent = now.toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'});
  // 통계 보이는 상태면 갱신, 숨김 상태면 skip
  const grid = document.getElementById('dashStatsGrid');
  const statsVisible = grid && grid.style.display !== 'none';
  const tasks = [loadDashNotices(), loadDashHwFiles(), loadApiUsage(), bigcalInit()];
  if (statsVisible) tasks.unshift(loadDashStats());
  await Promise.all(tasks);
}
window.refreshDashboard = initDashboard;

window.toggleDashStats = async () => {
  const grid = document.getElementById('dashStatsGrid');
  const btn = document.getElementById('dashStatsToggleBtn');
  if (!grid) return;
  _dashSensitiveVisible = !_dashSensitiveVisible;
  if (_dashSensitiveVisible) {
    // 표시 — 통계 lazy fetch
    if (!_dashStatsLoaded) {
      try { await loadDashStats(); _dashStatsLoaded = true; } catch(e) { console.error(e); }
    }
    // 현재 달 billings lazy fetch (cache 에 미로드면)
    const cur = _bigcalState.cur;
    const ym = _bigcalYM(cur.year, cur.month);
    const entry = _bigcalState.cache[ym];
    if (entry && !entry.billingsLoaded) {
      try { await _bigcalFetchBillings(cur.year, cur.month, entry); _bigcalState.events = entry.events; } catch(e) {}
    }
    grid.style.display = '';
    if (btn) btn.textContent = '🙈 민감정보 숨기기';
  } else {
    grid.style.display = 'none';
    if (btn) btn.textContent = '📊 민감정보 보기';
  }
  // 달력 + 사이드패널 재렌더
  if (typeof _bigcalRender === 'function') _bigcalRender();
};

async function loadApiUsage(){
  const body = document.getElementById('apiUsageBody');
  if (!body) return;
  try {
    const today = _ymdKST();
    const yesterday = _ymdKST(new Date(Date.now() - 864e5));
    const academyId = window.MY_ACADEMY_ID || 'default';

    // apiUsage(일별) + academies(월별 누적+한도) + plans(한도 정의) 동시 조회
    const [todaySnap, yestSnap, acadSnap] = await Promise.all([
      getDoc(doc(db, 'apiUsage', `${academyId}_${today}`)),
      getDoc(doc(db, 'apiUsage', `${academyId}_${yesterday}`)),
      getDoc(doc(db, 'academies', academyId)),
    ]);
    const acad = acadSnap.exists() ? acadSnap.data() : {};
    const planId = acad.planId || 'lite';
    const planSnap = await getDoc(doc(db, 'plans', planId));
    const plan = planSnap.exists() ? planSnap.data() : {};
    const limits = plan.limits || {};  // 안전망 — T1 전 학원 폴백
    const usage = acad.usage || {};

    const t = todaySnap.exists() ? todaySnap.data() : { total: 0, byEndpoint: {} };
    const y = yestSnap.exists() ? yestSnap.data() : { total: 0 };
    const bE = t.byEndpoint || {};
    const cnt = (k) => (bE[k] || 0) + (t['byEndpoint.' + k] || 0);

    // 월별 한도 분수 — T1 byTier[tier] + customLimits 우선, 옛 plan.limits 안전망 폴백
    const cl = acad.customLimits || {};
    const tier = String(acad.studentLimit || 30);
    const byTier = plan.byTier || {};
    const tierLimits = byTier[tier] || byTier['30'] || byTier[Object.keys(byTier)[0]] || {};

    const studentCur = usage.activeStudentsCount || 0;
    const studentLim = cl.maxStudents ?? acad.studentLimit ?? 30;

    // 5분류 (라벨 통일: OCR · Cleanup · Generator · 녹음숙제 · 성장리포트)
    // 2026-05-23 단어시험 말하기 응시 시점 AI 호출 0 전환 후 — 단어시험 카테고리 UI 제거
    const items = [
      { label: 'OCR',         dailyKeys: ['ocr'],             monthCounter: 'ocrCallsThisMonth',           limitField: 'ocrPerMonth' },
      { label: 'Cleanup',     dailyKeys: ['cleanup-ocr'],     monthCounter: 'cleanupCallsThisMonth',       limitField: 'cleanupPerMonth' },
      { label: 'Generator',   dailyKeys: ['generate-quiz'],   monthCounter: 'generatorCallsThisMonth',     limitField: 'generatorPerMonth' },
      { label: '녹음숙제',     dailyKeys: ['check-recording'], monthCounter: 'recordingCallsThisMonth',     limitField: 'recordingPerMonth' },
      { label: '성장리포트',   dailyKeys: ['growth-report'],   monthCounter: 'growthReportCallsThisMonth',  limitField: 'growthReportPerMonth' },
    ];

    const fracBar = (cur, lim) => {
      if (typeof lim !== 'number' || lim <= 0) return '';
      const p = Math.min(100, Math.round((cur / lim) * 100));
      const c = p >= 90 ? '#dc2626' : (p >= 70 ? '#f59e0b' : '#059669');
      return `<div style="height:3px;background:#eee;border-radius:2px;overflow:hidden;margin-top:2px;"><div style="height:100%;width:${p}%;background:${c};"></div></div>`;
    };

    // 한 줄에 [라벨 / 일사용량 / 월사용량/한도 + 진도바] — 6분류 통일 형식
    const renderRow = (it) => {
      const day = it.dailyKeys.reduce((s,k) => s + cnt(k), 0);
      // monthCounter 없는 항목 (단어시험 = recording 한도 공유) → 일별만 표시
      if (!it.monthCounter) {
        return `
          <div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
              <span>${it.label}</span>
              <span style="color:var(--gray);font-size:10px;">오늘 <b style="color:var(--text);">${day}</b> <span style="color:#94a3b8;">${it.shareNote || ''}</span></span>
            </div>
          </div>`;
      }
      const month = usage[it.monthCounter] || 0;
      const lim = cl[it.limitField] ?? tierLimits[it.limitField];
      const limStr = (typeof lim === 'number' && isFinite(lim)) ? lim : '∞';
      return `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
            <span>${it.label}</span>
            <span style="color:var(--gray);font-size:10px;">오늘 <b style="color:var(--text);">${day}</b> · 이번 달 <b style="color:var(--text);">${month}</b>/${limStr}</span>
          </div>
          ${fracBar(month, lim)}
        </div>`;
    };

    // Storage 행 — bytes/GB 단위 + 마지막 점검 시각.
    // 수동 reconcile (scripts/diag/scan-storage-by-academy.js --apply) 로 갱신.
    const _fmtBytes = (n) => {
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
      return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
    };
    const renderStorageRow = () => {
      const bytes = usage.storageBytes || 0;
      const gb = bytes / 1024 / 1024 / 1024;
      const limGB = cl.storageGB ?? tierLimits.storageGB ?? null;
      const reconciledAt = usage.storageReconciledAt?.toDate?.();
      const reconciledStr = reconciledAt
        ? reconciledAt.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) + ' ' +
          reconciledAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
        : '미측정';
      return `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
            <span>${iconSvg('save')} Storage <span style="color:#bbb;font-size:9px;">(${reconciledStr})</span></span>
            <span style="color:var(--gray);font-size:10px;">사용 <b style="color:var(--text);">${_fmtBytes(bytes)}</b>/${limGB ? `${limGB} GB` : '∞'}</span>
          </div>
          ${limGB ? fracBar(gb, limGB) : ''}
        </div>`;
    };

    body.innerHTML = `
      <!-- 플랜 + 학원명 + 상세 링크 -->
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <span class="badge badge-teal" style="font-size:11px;">${esc((plan.displayName || planId).toUpperCase())}</span>
        <span style="font-size:11px;color:var(--gray);">${esc(acad.name || '')}</span>
        <span style="margin-left:auto;font-size:11px;"><a onclick="goPage('quotaUsage')" style="color:var(--teal);cursor:pointer;text-decoration:none;">${iconSvg('chart')} 상세 →</a></span>
      </div>

      <!-- 6줄: 5분류 AI + Storage (학생 수는 AI 사용량 X + 민감정보이라 제거, 2026-05-14) -->
      <div style="display:flex;flex-direction:column;gap:6px;font-size:11px;">
        ${items.map(renderRow).join('')}
        ${renderStorageRow()}
      </div>

      <div style="margin-top:8px;font-size:10px;color:#bbb;">총 오늘: ${t.total || 0}회 · 어제: ${y.total || 0}회</div>`;
  } catch(e) {
    body.innerHTML = '<div style="color:#bbb;font-size:11px;">집계 로드 실패</div>';
  }
}

// AI 사용량 페이지 (T5) — 5분류 한도 진행 바
async function loadQuotaUsage(){
  const grid = document.getElementById('quotaUsageGrid');
  const header = document.getElementById('quotaUsageHeader');
  if (!grid) return;
  grid.innerHTML = '<div style="color:#bbb;padding:20px;text-align:center;">로딩 중...</div>';
  try {
    const academyId = window.MY_ACADEMY_ID || 'default';
    const acadSnap = await getDoc(doc(db, 'academies', academyId));
    if (!acadSnap.exists()) { grid.innerHTML = '<div style="color:#dc2626;">학원 정보 없음</div>'; return; }
    const acad = acadSnap.data();
    const planId = acad.planId || 'lite';
    const planSnap = await getDoc(doc(db, 'plans', planId));
    if (!planSnap.exists()) { grid.innerHTML = '<div style="color:#dc2626;">플랜 정보 없음</div>'; return; }
    const plan = planSnap.data();

    const tier = String(acad.studentLimit || 30);
    const byTier = plan.byTier || {};
    const tierLimits = byTier[tier] || byTier['30'] || byTier[Object.keys(byTier)[0]] || {};
    const customLimits = acad.customLimits || {};
    const usage = acad.usage || {};

    // 5분류 (라벨 통일) — darkColor: 누적선용 진한 톤
    // 2026-05-23 단어시험 말하기 응시 시점 AI 호출 0 전환 후 — 단어시험 카테고리 UI 제거
    const items = [
      { label: 'OCR',         counter: 'ocrCallsThisMonth',          limitField: 'ocrPerMonth',           color: '#0ea5e9', darkColor: '#0369a1', dailyKey: 'ocr' },
      { label: 'Cleanup',     counter: 'cleanupCallsThisMonth',      limitField: 'cleanupPerMonth',       color: '#06b6d4', darkColor: '#0e7490', dailyKey: 'cleanup-ocr' },
      { label: 'Generator',   counter: 'generatorCallsThisMonth',    limitField: 'generatorPerMonth',     color: '#f59e0b', darkColor: '#b45309', dailyKey: 'generate-quiz' },
      { label: '녹음숙제',     counter: 'recordingCallsThisMonth',    limitField: 'recordingPerMonth',     color: '#8b5cf6', darkColor: '#6d28d9', dailyKey: 'check-recording' },
      { label: '성장리포트',   counter: 'growthReportCallsThisMonth', limitField: 'growthReportPerMonth',  color: '#10b981', darkColor: '#047857', dailyKey: 'growth-report' },
    ];

    const planName = (plan.displayName || planId).toUpperCase();
    header.innerHTML = `<span class="badge badge-teal" style="font-size:11px;">${esc(planName)}</span>
      <span style="margin-left:8px;">${esc(acad.name || '')} · 학생 한도 ${esc(tier)}명</span>`;

    // 당월 + 전월 apiUsage doc fetch — 일별 + 누적 + 한도 + 전월 종착값 차트용 (KST 기준)
    const KST = 9 * 60 * 60 * 1000;
    const todayKst = new Date(Date.now() + KST);
    const curY = todayKst.getUTCFullYear();
    const curM = todayKst.getUTCMonth();
    const today = todayKst.getUTCDate();
    const daysInMonth = new Date(Date.UTC(curY, curM + 1, 0)).getUTCDate();
    const daysInPrevMonth = new Date(Date.UTC(curY, curM, 0)).getUTCDate();
    const prevDate = new Date(Date.UTC(curY, curM - 1, 1));
    const prevY = prevDate.getUTCFullYear();
    const prevM = prevDate.getUTCMonth();
    const _ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const curMonthYmds = [];
    for (let d = 1; d <= daysInMonth; d++) curMonthYmds.push(_ymd(curY, curM, d));
    const prevMonthYmds = [];
    for (let d = 1; d <= daysInPrevMonth; d++) prevMonthYmds.push(_ymd(prevY, prevM, d));
    const [curSnaps, prevSnaps] = await Promise.all([
      Promise.all(curMonthYmds.map(ymd => getDoc(doc(db, 'apiUsage', `${academyId}_${ymd}`)).catch(() => null))),
      Promise.all(prevMonthYmds.map(ymd => getDoc(doc(db, 'apiUsage', `${academyId}_${ymd}`)).catch(() => null))),
    ]);
    const _cntFromSnap = (snap, key) => {
      if (!snap || !snap.exists()) return 0;
      const d = snap.data();
      const bE = d.byEndpoint || {};
      return (bE[key] || 0) + (d['byEndpoint.' + key] || 0);
    };
    const chartData = {};
    items.forEach(it => {
      const dayCounts = curSnaps.map(snap => _cntFromSnap(snap, it.dailyKey));
      let acc = 0;
      const cumulative = dayCounts.slice(0, today).map(v => { acc += v; return acc; });
      const prevMonthTotal = prevSnaps.reduce((s, snap) => s + _cntFromSnap(snap, it.dailyKey), 0);
      chartData[it.dailyKey] = { dayCounts, cumulative, prevMonthTotal };
    });

    // SVG 차트 — 당월 일별 막대 (우측 Y) + 누적 직선 (좌측 Y) + 한도 점선 + 전월 종착선
    // viewBox 600×60, 좌측 Y = 누적/한도/전월, 우측 Y = 일별 막대
    const _renderUsageSvgChart = ({ dayCounts, cumulative, limit, prevMonthTotal }, color, darkColor) => {
      const W = 600, H = 60, PAD_L = 32, PAD_R = 32, PAD_T = 6, PAD_B = 12;
      const cw = W - PAD_L - PAD_R;
      const ch = H - PAD_T - PAD_B;
      const maxLeft = Math.max(limit || 0, prevMonthTotal || 0, ...(cumulative.length ? cumulative : [0]), 1);
      const maxRight = Math.max(...(dayCounts.length ? dayCounts : [0]), 1);
      const xCenter = (day) => PAD_L + cw * (day - 0.5) / daysInMonth;
      const xLeft = (day) => PAD_L + cw * (day - 1) / daysInMonth;
      const barW = Math.max(2, cw / daysInMonth - 2);
      const yL = (v) => PAD_T + ch * (1 - v / maxLeft);
      const yR = (v) => PAD_T + ch * (1 - v / maxRight);

      // 막대 (일별 — 우측 Y) — 일별 슬롯폭의 2/3 + opacity 연함 + 막대 위 수치
      const slotW = cw / daysInMonth;
      const narrowBarW = Math.max(1.5, slotW * 0.67);  // 일별 슬롯폭의 2/3
      const inset = (slotW - narrowBarW) / 2;
      const bars = dayCounts.map((v, i) => {
        const day = i + 1;
        if (day > today || v <= 0) return '';
        const h = ch * (v / maxRight);
        const y = PAD_T + ch - h;
        const isToday = day === today;
        const rect = `<rect x="${xLeft(day) + inset}" y="${y}" width="${narrowBarW}" height="${h}" fill="${color}" opacity="${isToday ? 0.7 : 0.4}"/>`;
        // 막대 위 일별 수치 (PAD_T 위로 안 잘리게 가드)
        const lblY = Math.max(PAD_T + 2, y - 1);
        const lbl = `<text x="${xCenter(day)}" y="${lblY}" font-size="4" fill="${darkColor || color}" text-anchor="middle" font-weight="600">${v}</text>`;
        return rect + lbl;
      }).join('');

      // 누적 직선 (좌측 Y) — 진한 톤·두께 1
      const cumPts = cumulative.map((v, i) => `${xCenter(i + 1)},${yL(v)}`).join(' ');
      const cumStroke = darkColor || color;
      const cumLine = cumPts ? `<polyline points="${cumPts}" fill="none" stroke="${cumStroke}" stroke-width="1"/>` : '';

      // 한도선 (붉은 점선 + 숫자 라벨)
      let limitLine = '';
      if (limit > 0 && limit <= maxLeft) {
        const y = yL(limit);
        limitLine = `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#dc2626" stroke-width="0.5" stroke-dasharray="3 2"/>
          <text x="${W - PAD_R - 1}" y="${y - 1}" font-size="4" fill="#dc2626" text-anchor="end" font-weight="600">한도 ${limit}</text>`;
      }
      // 전월 종착선 (회색 직선 + 숫자 라벨)
      let prevLine = '';
      if (prevMonthTotal > 0 && prevMonthTotal <= maxLeft) {
        const y = yL(prevMonthTotal);
        prevLine = `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#94a3b8" stroke-width="0.5"/>
          <text x="${PAD_L + 1}" y="${y - 1}" font-size="4" fill="#64748b" text-anchor="start" font-weight="600">전월 ${prevMonthTotal}</text>`;
      }

      // X축 라벨 (매일 1~말일 표시)
      const xAxisLbl = Array.from({ length: daysInMonth }, (_, i) => i + 1)
        .map(d => `<text x="${xCenter(d)}" y="${H - PAD_B + 6}" font-size="4" fill="#94a3b8" text-anchor="middle">${d}</text>`).join('');

      // Y축 라벨 (좌·우 2단계: 0/max)
      const yLeftLbl = [0, 1].map(p => {
        const v = Math.round(maxLeft * p);
        return `<text x="${PAD_L - 2}" y="${yL(v) + (p === 0 ? -1 : 3)}" font-size="4" fill="#94a3b8" text-anchor="end">${v}</text>`;
      }).join('');
      const yRightLbl = [0, 1].map(p => {
        const v = Math.round(maxRight * p);
        return `<text x="${W - PAD_R + 2}" y="${yR(v) + (p === 0 ? -1 : 3)}" font-size="4" fill="#94a3b8" text-anchor="start">${v}</text>`;
      }).join('');

      // 축선 (가늘게)
      const axis = `<line x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_R}" y2="${H - PAD_B}" stroke="#cbd5e1" stroke-width="0.3"/>`;

      return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;margin-top:6px;" preserveAspectRatio="none">${axis}${yLeftLbl}${yRightLbl}${xAxisLbl}${prevLine}${limitLine}${bars}${cumLine}</svg>`;
    };

    const _fmtBytes = (n) => {
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
      return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
    };

    grid.innerHTML = items.map(item => {
      const cd = chartData[item.dailyKey] || { dayCounts: [], cumulative: [], prevMonthTotal: 0 };
      const todayCnt = cd.dayCounts[today - 1] || 0;

      // 단어시험 — counter 없음 (recording 한도 공유). 한도선 X, 전월선은 표시.
      if (!item.counter) {
        return `
          <div style="margin-bottom:24px;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin-bottom:4px;">
              <span style="font-weight:600;">${item.label} <span style="color:var(--gray);font-size:11px;font-weight:400;">${item.shareNote || ''}</span></span>
              <span style="color:var(--text);">오늘 <b>${todayCnt.toLocaleString()}</b> · 누적 <b>${(cd.cumulative[cd.cumulative.length - 1] || 0).toLocaleString()}</b> · 전월 <b>${cd.prevMonthTotal.toLocaleString()}</b></span>
            </div>
            ${_renderUsageSvgChart({ dayCounts: cd.dayCounts, cumulative: cd.cumulative, limit: 0, prevMonthTotal: cd.prevMonthTotal }, item.color, item.darkColor)}
          </div>
        `;
      }

      const current = usage[item.counter] || 0;
      const limitRaw = customLimits[item.limitField] ?? tierLimits[item.limitField];
      const isUnlimited = limitRaw === null || limitRaw === undefined;
      const limit = isUnlimited ? 0 : (typeof limitRaw === 'number' ? limitRaw : 0);
      const isOverride = customLimits[item.limitField] !== undefined;
      const percent = (!isUnlimited && limit > 0) ? Math.min(100, (current / limit) * 100) : 0;
      const barColor = isUnlimited ? '#cbd5e1' : (percent >= 95 ? '#dc2626' : percent >= 80 ? '#f59e0b' : item.color);
      const labelColor = isUnlimited ? 'var(--text)' : (percent >= 95 ? '#dc2626' : percent >= 80 ? '#f59e0b' : 'var(--text)');
      const limDisplay = isUnlimited ? '∞ 무제한' : `${limit.toLocaleString()} (${percent.toFixed(1)}%)`;

      return `
        <div style="margin-bottom:24px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin-bottom:4px;">
            <span style="font-weight:600;">${item.label}${isOverride ? ' <span style="color:#0ea5e9;font-size:11px;">(override)</span>' : ''}</span>
            <span style="color:${labelColor};"><b>${current.toLocaleString()}</b> / <span style="color:var(--gray);font-size:11px;">${limDisplay}</span> · 전월 <b style="color:var(--text);">${cd.prevMonthTotal.toLocaleString()}</b></span>
          </div>
          <div style="background:#eee;height:14px;border-radius:7px;overflow:hidden;">
            <div style="background:${barColor};height:100%;width:${isUnlimited ? 100 : percent}%;transition:width 0.3s;opacity:${isUnlimited ? 0.3 : 1};"></div>
          </div>
          ${!isUnlimited && percent >= 95 ? `<div style="font-size:11px;color:#dc2626;margin-top:3px;">⚠ 한도 ${Math.round(percent)}% 도달 — 곧 차단됩니다</div>`
            : !isUnlimited && percent >= 80 ? `<div style="font-size:11px;color:#f59e0b;margin-top:3px;">한도 ${Math.round(percent)}% 도달</div>`
            : ''}
          ${_renderUsageSvgChart({ dayCounts: cd.dayCounts, cumulative: cd.cumulative, limit, prevMonthTotal: cd.prevMonthTotal }, item.color, item.darkColor)}
        </div>
      `;
    }).join('') + (() => {
      // Storage 추가 (수동 점검 결과 기반 — super 앱 [🔄 Storage 점검] 버튼으로 갱신)
      const bytes = usage.storageBytes || 0;
      const gb = bytes / 1024 / 1024 / 1024;
      const limGB = customLimits.storageGB ?? tierLimits.storageGB ?? 0;
      const isOverride = customLimits.storageGB !== undefined;
      const percent = limGB > 0 ? Math.min(100, (gb / limGB) * 100) : 0;
      const barColor = percent >= 95 ? '#dc2626' : percent >= 80 ? '#f59e0b' : '#64748b';
      const labelColor = percent >= 95 ? '#dc2626' : percent >= 80 ? '#f59e0b' : 'var(--text)';
      const reconciledAt = usage.storageReconciledAt?.toDate?.();
      const reconciledStr = reconciledAt
        ? reconciledAt.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '미측정';
      return `
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin-bottom:4px;">
            <span style="font-weight:600;">${iconSvg('save')} Storage (파일 저장)${isOverride ? ' <span style="color:#0ea5e9;font-size:11px;">(override)</span>' : ''}</span>
            <span style="color:${labelColor};"><b>${_fmtBytes(bytes)}</b> / ${limGB} GB <span style="color:var(--gray);font-size:11px;">(${percent.toFixed(1)}%)</span></span>
          </div>
          <div style="background:#eee;height:14px;border-radius:7px;overflow:hidden;">
            <div style="background:${barColor};height:100%;width:${percent}%;transition:width 0.3s;"></div>
          </div>
          <div style="font-size:11px;color:#bbb;margin-top:3px;">마지막 점검: ${reconciledStr} <span style="color:var(--gray);">— super 관리자 앱에서 수동 갱신</span></div>
        </div>
      `;
    })();
  } catch (e) {
    grid.innerHTML = `<div style="color:#dc2626;padding:20px;">로드 실패: ${esc(e.message)}</div>`;
  }
}

async function loadDashStats(){
  try {
    const aid = window.MY_ACADEMY_ID;
    const usersRef = collection(db,'users');
    // 학생 카운트 — getCountFromServer 3 쿼리 병렬 (학원 전체 fetch 폐기, 2026-05-14)
    const [activeAgg, pauseAgg, outAgg] = await Promise.all([
      getCountFromServer(query(usersRef, where('academyId','==', aid), where('role','==','student'), where('status','==','active'))),
      getCountFromServer(query(usersRef, where('academyId','==', aid), where('role','==','student'), where('status','==','pause'))),
      getCountFromServer(query(usersRef, where('academyId','==', aid), where('role','==','student'), where('status','==','out'))),
    ]);
    const active = activeAgg.data().count;
    const pause = pauseAgg.data().count;
    const out = outAgg.data().count;
    document.getElementById('statTotal').textContent = active+pause+out;
    document.getElementById('statActive').textContent = active;
    document.getElementById('statPause').textContent = pause;

    // 미납 = 이번 달 billings 중 status !== 'paid'
    const ym = _ymdKST().slice(0,7);
    let unpaidCnt = 0;
    const cached = (typeof _billingsByMonth === 'object' && _billingsByMonth) ? _billingsByMonth[ym] : null;
    if (Array.isArray(cached)) {
      // 결제 페이지 캐시 hit — 0 reads
      unpaidCnt = cached.filter(b => (b.status || 'unpaid') !== 'paid').length;
    } else {
      // 캐시 miss — 일반 fetch + 캐시 저장 (다음 진입 0 reads)
      const billSnap = await getDocs(query(
        collection(db,'billings'),
        where('academyId','==', aid),
        where('yearMonth','==', ym),
      ));
      const arr = billSnap.docs.map(d=>({id:d.id,...d.data()}));
      if (typeof _billingsByMonth === 'object' && _billingsByMonth) _billingsByMonth[ym] = arr;
      unpaidCnt = arr.filter(b => (b.status || 'unpaid') !== 'paid').length;
    }
    document.getElementById('statUnpaid').textContent = unpaidCnt;

    // 오늘 출제된 시험 = genTests where date == today (getCountFromServer 1 read)
    const today = _ymdKST();
    const testAgg = await getCountFromServer(query(
      collection(db,'genTests'),
      where('academyId','==', aid),
      where('date','==', today),
    ));
    document.getElementById('statTests').textContent = testAgg.data().count;
  } catch(e){ console.log(e); }
}

async function loadDashNotices(){
  const el=document.getElementById('dashNotices');
  try{
    const snap=await getDocs(query(collection(db,'notices'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','desc'),limit(5)));
    if(snap.empty){el.innerHTML='<div style="color:#bbb;font-size:13px;text-align:center;padding:12px;">공지사항이 없습니다</div>';return;}
    el.innerHTML=snap.docs.map(d=>{
      const n=d.data();
      return `<div class="notice-item">
        <span class="notice-new">NEW</span>
        <span class="notice-title">${esc(n.title)||''}</span>
        <span class="notice-date">${esc(n.date)||''}</span>
      </div>`;
    }).join('');
  }catch(e){el.innerHTML='<div style="color:#bbb;font-size:13px;">불러오기 실패</div>';}
}

// 자료실 미리보기 (학생앱에서만 보이는 데이터 — 학원장 인지용, 2026-05-14)
async function loadDashHwFiles(){
  const el=document.getElementById('dashHwFiles');
  if(!el) return;
  try{
    const snap=await getDocs(query(collection(db,'hwFiles'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','desc'),limit(5)));
    if(snap.empty){el.innerHTML='<div style="color:#bbb;font-size:13px;text-align:center;padding:12px;">등록된 자료가 없습니다</div>';return;}
    el.innerHTML=snap.docs.map(d=>{
      const f=d.data();
      const targetLabel = f.targetSummary || (f.group === '전체' ? '전체' : (f.group || '-'));
      return `<div class="notice-item">
        <span class="notice-title">${esc(f.name)||'-'}</span>
        <span class="notice-tag${f.group==='전체'?' all':''}" style="font-size:11px;">${esc(targetLabel)}</span>
        <span class="notice-date">${esc(f.date)||''}</span>
      </div>`;
    }).join('');
  }catch(e){el.innerHTML='<div style="color:#bbb;font-size:13px;">불러오기 실패</div>';}
}

async function loadDashScores(){
  const el=document.getElementById('dashScores');
  try{
    const snap=await getDocs(query(collection(db,'scores'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','desc'),limit(20)));
    if(snap.empty){el.innerHTML='<tr><td colspan="7" style="text-align:center;color:#bbb;padding:20px;">시험 결과가 없습니다</td></tr>';return;}

    el.innerHTML=snap.docs.map((d,i)=>{
      const s=d.data();
      const t={};  // 레거시 tests fallback 제거 (Phase 6F)
      const modeHtml = _unifiedTypeBadge(s.mode || 'vocab');
      const pct=s.score||0;
      const badge=pct>=80?'badge-green':pct>=60?'badge-amber':'badge-red';
      // 교재명: bookName 우선, 없으면 unitName
      const bookName = s.bookName || t.bookName || s.unitName || '-';
      return `<tr>
        <td>${i+1}</td>
        <td>${esc(s.group)||'-'}</td>
        <td style="font-weight:600;">${esc(s.userName)||'-'}</td>
        <td>${modeHtml}</td>
        <td style="font-size:12px;max-width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${esc(bookName)}</td>
        <td><span class="badge ${badge}">${pct}점</span></td>
        <td class="td-sub">${s.createdAt?.toDate?s.createdAt.toDate().toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):''}</td>
      </tr>`;
    }).join('');
  }catch(e){el.innerHTML='<tr><td colspan="7" style="text-align:center;color:#bbb;padding:12px;">불러오기 실패</td></tr>';}
}

async function loadDashStudents(){
  const el=document.getElementById('dashStudents');
  try{
    const snap=await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID),where('role','==','student'),where('status','==','active'),limit(8)));
    if(snap.empty){el.innerHTML='<div style="color:#bbb;font-size:13px;text-align:center;padding:12px;">학생이 없습니다</div>';return;}
    el.innerHTML=snap.docs.map(d=>{
      const u=d.data();
      const init=(u.name||'?').charAt(0);
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f5f5f5;font-size:13px;">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--teal);color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${esc(init)}</div>
        <div style="flex:1;">
          <div style="font-weight:600;">${esc(u.name)||'-'}</div>
          <div style="font-size:11px;color:var(--gray);">${esc(u.group)||'-'}</div>
        </div>
      </div>`;
    }).join('');
  }catch(e){el.innerHTML='<div style="color:#bbb;font-size:13px;">불러오기 실패</div>';}
}


// ── 페이지네이션 엔진 ─────────────────────────────────────
const PAGE_SIZE_DEFAULT = 10;
const _pageState = {}; // { [tableId]: { data, page, pageSize, renderFn } }

function initPagination(tableId, data, renderRowFn, paginationElId, colCount, options={}){
  const pageSize = options.pageSize || PAGE_SIZE_DEFAULT;
  _pageState[tableId] = { data, page:1, pageSize, renderRowFn, paginationElId, colCount };
  renderPage(tableId);
}

function renderPage(tableId){
  const s = _pageState[tableId]; if(!s) return;
  const { data, page, pageSize, renderRowFn, paginationElId, colCount } = s;
  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total/pageSize));
  const currentPage = Math.min(page, totalPages);
  s.page = currentPage;
  const start = (currentPage-1)*pageSize;
  const pageData = data.slice(start, start+pageSize);

  // 테이블 바디 렌더
  const el = document.getElementById(tableId);
  if(el){
    el.innerHTML = pageData.length
      ? pageData.map((item,i) => renderRowFn(item, start+i)).join('')
      : `<tr><td colspan="${colCount}" style="text-align:center;color:#bbb;padding:24px;">데이터가 없습니다</td></tr>`;
  }

  // 페이지네이션 UI
  const pgEl = document.getElementById(paginationElId);
  if(!pgEl) return;
  const from = total ? start+1 : 0;
  const to = Math.min(start+pageSize, total);

  pgEl.innerHTML = `
    <span class="tbl-page-info">총 ${total}개</span>
    <button class="tbl-page-btn" onclick="gotoPage('${tableId}',1)" ${currentPage<=1?'disabled':''}>«</button>
    <button class="tbl-page-btn" onclick="gotoPage('${tableId}',${currentPage-1})" ${currentPage<=1?'disabled':''}>‹</button>
    <span class="tbl-page-info">${currentPage} / ${totalPages}</span>
    <button class="tbl-page-btn" onclick="gotoPage('${tableId}',${currentPage+1})" ${currentPage>=totalPages?'disabled':''}>›</button>
    <button class="tbl-page-btn" onclick="gotoPage('${tableId}',${totalPages})" ${currentPage>=totalPages?'disabled':''}>»</button>
    <select class="tbl-size" onchange="changePageSize('${tableId}',parseInt(this.value))">
      ${[10,20,50].map(n=>`<option value="${n}" ${pageSize===n?'selected':''}>${n}개</option>`).join('')}
    </select>
  `;
}

window.gotoPage = (tableId, page) => {
  if(!_pageState[tableId]) return;
  _pageState[tableId].page = page;
  renderPage(tableId);
};
window.changePageSize = (tableId, size) => {
  if(!_pageState[tableId]) return;
  _pageState[tableId].pageSize = size;
  _pageState[tableId].page = 1;
  renderPage(tableId);
};
// 외부에서 데이터 업데이트 시 호출
function refreshPagination(tableId, newData){
  if(!_pageState[tableId]) return;
  _pageState[tableId].data = newData;
  _pageState[tableId].page = 1;
  renderPage(tableId);
}

// 페이지네이션 data 배열을 surgical mutate — 현재 page·pageSize·sort 유지하며 즉시 재렌더.
// CRUD 후 전체 reload 대신 사용 (선택 Book·정렬·페이지·검색 등 학원장 화면 상태 유지).
// fn(data) 가 새 배열 반환하면 교체, undefined 면 in-place mutation 가정.
function _pageMutate(tableId, fn) {
  const s = _pageState[tableId];
  if (!s) return false;
  const next = fn(s.data);
  if (Array.isArray(next)) s.data = next;
  renderPage(tableId);
  return true;
}

// ── 테이블 컬럼 정렬 ───────────────────────────────────────
window.sortTable = (tableId, colIdx) => {
  const s = _pageState[tableId];
  if (!s) return;

  // onclick 속성으로 클릭된 th를 찾아 실제 cellIndex(=td 위치)를 획득
  const tbody = document.getElementById(tableId);
  if (!tbody) return;
  const thead = tbody.closest('table')?.tHead;
  if (!thead) return;
  const ths = thead.querySelectorAll('th');
  let clickedTh = null;
  for (const th of ths) {
    if ((th.getAttribute('onclick') || '').includes(`sortTable('${tableId}',${colIdx})`)) {
      clickedTh = th; break;
    }
  }
  if (!clickedTh) return;
  const tdIdx = clickedTh.cellIndex; // th 위치 = td 위치

  // 정렬 방향 토글
  const sameCol = s.sortCol === colIdx;
  s.sortDir = (sameCol && s.sortDir === 'asc') ? 'desc' : 'asc';
  s.sortCol = colIdx;

  // 모든 행을 가상으로 렌더링해 해당 셀의 텍스트를 정렬 키로 추출
  const temp = document.createElement('tbody');
  const keys = s.data.map((item, i) => {
    temp.innerHTML = s.renderRowFn(item, i);
    return (temp.querySelector('tr')?.cells[tdIdx]?.textContent || '').trim();
  });

  // 숫자/문자 자동 감지 정렬
  const indexed = s.data.map((item, i) => ({ item, key: keys[i] }));
  indexed.sort((a, b) => {
    const av = a.key, bv = b.key;
    const an = parseFloat(av.replace(/[^\d.-]/g, ''));
    const bn = parseFloat(bv.replace(/[^\d.-]/g, ''));
    const bothNum = !isNaN(an) && !isNaN(bn) && av !== '' && bv !== '';
    if (bothNum) return s.sortDir === 'asc' ? an - bn : bn - an;
    return s.sortDir === 'asc'
      ? av.localeCompare(bv, 'ko')
      : bv.localeCompare(av, 'ko');
  });
  s.data = indexed.map(x => x.item);
  s.page = 1;
  renderPage(tableId);

  // 정렬 표시 업데이트 (▲/▼)
  ths.forEach(th => {
    if (!th.dataset.origText) th.dataset.origText = th.textContent.trim();
    th.textContent = th.dataset.origText;
  });
  if (!clickedTh.dataset.origText) clickedTh.dataset.origText = clickedTh.textContent.replace(/[▲▼]/g,'').trim();
  clickedTh.textContent = clickedTh.dataset.origText + (s.sortDir === 'asc' ? ' ▲' : ' ▼');
};

// ── 클래스 관리 ──────────────────────────────────────
async function loadClasses(){
  try{
    const snap=await getDocs(query(collection(db,'groups'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','asc')));
    const data=snap.docs.map(d=>({id:d.id,...d.data()}));
    initPagination('classTableBody', data, (g,i)=>`<tr>
      <td><input type="checkbox" value="${g.id}"></td>
      <td>${i+1}</td>
      <td class="td-link" onclick="editClass('${g.id}')">${esc(g.name)||'-'}</td>
      <td>${esc(g.teacher)||'-'}</td>
      <td class="td-sub">${g.createdAt?.toDate?g.createdAt.toDate().toLocaleDateString('ko-KR'):'-'}</td>
      <td class="td-sm" style="white-space:pre-wrap;word-break:break-word;color:var(--text);min-width:280px;">${esc(g.memo)||'<span style="color:#bbb;">-</span>'}</td>
    </tr>`, 'classPagination', 6);
  }catch(e){document.getElementById('classTableBody').innerHTML='<tr><td colspan="6" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';}
}

window.openClassModal = () => {
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">반 생성</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="display:flex;flex-direction:column;gap:14px;font-size:13px;">
          <div><div style="color:var(--gray);margin-bottom:6px;">반 이름 *</div>
            <input id="className" type="text" placeholder="예: 1반, 초급반" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:6px;">담당 선생님</div>
            <input id="classTeacher" type="text" placeholder="선택사항" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:6px;">메모</div>
            <textarea id="classMemo" rows="4" placeholder="반 운영 메모 (선택사항)" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:13px;outline:none;resize:vertical;font-family:inherit;"></textarea></div>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="saveClass()">저장</button>
      </div>
    </div>
  `);
};
window.saveClass = async() => {
  const name=document.getElementById('className').value.trim();
  const teacher=document.getElementById('classTeacher').value.trim();
  const memo=(document.getElementById('classMemo')?.value || '').trim();
  if (!name) { showAlert('입력 확인', '반 이름을 입력하세요.'); return; }
  const ref = await addDoc(collection(db,'groups'),{name,teacher,memo,createdAt:serverTimestamp(),academyId:window.MY_ACADEMY_ID||'default'});
  closeModal(); showToast('반이 생성됐어요!');
  const added = _pageMutate('classTableBody', data => {
    data.push({ id: ref.id, name, teacher, memo });  // loadClasses 정렬: createdAt asc → 끝에 추가
  });
  if (!added) await loadClasses();
};
window.deleteClass = async(id,name) => {
  if(!await showConfirm(`"${name}" 반을 삭제할까요?`))return;
  await deleteDoc(doc(db,'groups',id));
  showToast('삭제됐어요.');
  if (!_pageMutate('classTableBody', data => data.filter(g => g.id !== id))) await loadClasses();
};

// ── 학생 관리 ──────────────────────────────────────
// 학생관리 페이지네이션 (2026-05-14 server-side 반 필터 + 더보기, status 별 분리)
const STU_PAGE_SIZE = 20;
const _stuStates = {
  active: { lastDoc: null, exhausted: false, group: null },
  pause:  { lastDoc: null, exhausted: false, group: null },
  out:    { lastDoc: null, exhausted: false, group: null },
};
const STU_TBODY  = { active:'studentTableBody',  pause:'pauseTableBody',  out:'outTableBody' };
const STU_WRAP   = { active:'studentLoadMoreWrap', pause:'pauseLoadMoreWrap', out:'outLoadMoreWrap' };
const STU_FILTER = { active:'studentClassFilter', pause:'pauseClassFilter', out:'outClassFilter' };
const STU_SEARCH = { active:'studentSearch',     pause:'pauseSearch',     out:'outSearch' };
const STU_COLSPAN= { active: 12, pause: 11, out: 11 };

async function loadStudents(status='active'){
  const el = document.getElementById(STU_TBODY[status]);
  if (!el) return;
  // 진입 시 표 비움 + groups fetch (반 select 채움). 학생 fetch 는 반 선택 시.
  _stuStates[status] = { lastDoc: null, exhausted: false, group: null };
  allStudents = [];
  // 학생 추가/수정/휴원/퇴원 후 진입 시 검색 캐시 무효화 (재로딩 안전)
  if (typeof _stuInvalidateSearchCache === 'function') _stuInvalidateSearchCache();
  // 검색 입력란 비움 (다른 탭 진입 시 검색어 잔존 방지)
  const searchInput = document.getElementById(STU_SEARCH[status]);
  if (searchInput) searchInput.value = '';
  el.innerHTML = `<tr><td colspan="${STU_COLSPAN[status]}" style="text-align:center;color:#bbb;padding:20px;">반을 선택하세요</td></tr>`;
  const wrap = document.getElementById(STU_WRAP[status]); if (wrap) wrap.innerHTML = '';
  try {
    const classSnap = await getDocs(query(collection(db,'groups'),where('academyId','==',window.MY_ACADEMY_ID)));
    const sel = document.getElementById(STU_FILTER[status]);
    if (sel) sel.innerHTML = '<option value="">반을 선택하세요</option>'
      + classSnap.docs.map(d=>`<option value="${esc(d.data().name)}">${esc(d.data().name)}</option>`).join('')
      + '<option value="__all__">전체 반</option>';
    _syncTuitionToggleBtnLabel();
  } catch(e) { el.innerHTML = `<tr><td colspan="${STU_COLSPAN[status]}" style="text-align:center;color:#e05050;">반 목록 로드 실패</td></tr>`; }
}

async function _stuFetchPage(status, useCursor) {
  const state = _stuStates[status];
  const constraints = [
    where('academyId','==', window.MY_ACADEMY_ID),
    where('role','==','student'),
    where('status','==', status),
  ];
  if (state.group && state.group !== '__all__') constraints.push(where('group','==', state.group));
  if (useCursor && state.lastDoc) constraints.push(startAfter(state.lastDoc));
  constraints.push(limit(STU_PAGE_SIZE));
  const snap = await getDocs(query(collection(db,'users'), ...constraints));
  const docs = snap.docs.map(d => ({id:d.id, ...d.data()}));
  state.lastDoc = snap.docs[snap.docs.length-1] || state.lastDoc;
  state.exhausted = snap.size < STU_PAGE_SIZE;
  if (!useCursor) allStudents = docs;
  else allStudents = (allStudents || []).concat(docs);
  renderStudentTable(status, allStudents);
  _stuRenderLoadMore(status);
}

function _stuRenderLoadMore(status) {
  const wrap = document.getElementById(STU_WRAP[status]);
  if (!wrap) return;
  const state = _stuStates[status];
  if (state.exhausted) {
    wrap.innerHTML = (allStudents?.length > 0)
      ? '<div style="text-align:center;color:#888;padding:10px;font-size:11px;">모두 표시됨</div>'
      : '';
  } else {
    wrap.innerHTML = `<button class="btn btn-secondary" style="display:block;margin:10px auto;font-size:12px;padding:6px 16px;" onclick="loadMoreStudents('${status}')">+ 더 보기</button>`;
  }
}

window.loadMoreStudents = async (status='active') => {
  try { await _stuFetchPage(status, true); } catch(e) { console.error('loadMoreStudents:', e); }
};

async function _stuFilterChange(status) {
  const val = document.getElementById(STU_FILTER[status])?.value || '';
  _stuStates[status] = { lastDoc: null, exhausted: false, group: val || null };
  allStudents = [];
  if (!val) {
    document.getElementById(STU_TBODY[status]).innerHTML = `<tr><td colspan="${STU_COLSPAN[status]}" style="text-align:center;color:#bbb;padding:20px;">반을 선택하세요</td></tr>`;
    const wrap = document.getElementById(STU_WRAP[status]); if (wrap) wrap.innerHTML = '';
    return;
  }
  try { await _stuFetchPage(status, false); } catch(e) { console.error(e); }
}

// 학원 전체 학생 캐시 (검색 모드용 — status 별 분리)
const _stuSearchCache = { active: null, pause: null, out: null };
// debounce 타이머
const _stuSearchTimers = { active: null, pause: null, out: null };

// 학원 전체 학생 1회 fetch (검색 모드 진입 시) — 반·페이지네이션 무시.
// academyId + role + status 만 필터. 1000명 한도 (학원당 사실상 충분).
async function _stuLoadAllForSearch(status) {
  if (_stuSearchCache[status]) return _stuSearchCache[status];
  const snap = await getDocs(query(
    collection(db,'users'),
    where('academyId','==', window.MY_ACADEMY_ID),
    where('role','==','student'),
    where('status','==', status),
    limit(1000),
  ));
  const all = snap.docs.map(d => ({id:d.id, ...d.data()}));
  _stuSearchCache[status] = all;
  return all;
}

function _stuSearchInPage(status) {
  const q = (document.getElementById(STU_SEARCH[status])?.value || '').toLowerCase().trim();

  // 검색어 비움 → 페이지네이션 모드 복귀
  if (!q) {
    if (_stuStates[status].group) {
      // 반 선택 상태였으면 그 반 학생 표시 (allStudents 그대로)
      renderStudentTable(status, allStudents);
    } else {
      // 반 미선택 → "반을 선택하세요" 표시
      const el = document.getElementById(STU_TBODY[status]);
      if (el) el.innerHTML = `<tr><td colspan="${STU_COLSPAN[status]}" style="text-align:center;color:#bbb;padding:20px;">반을 선택하세요</td></tr>`;
    }
    _stuRenderLoadMore(status);
    return;
  }

  // debounce 300ms — 빠른 타이핑 시 매번 fetch 방지
  if (_stuSearchTimers[status]) clearTimeout(_stuSearchTimers[status]);
  _stuSearchTimers[status] = setTimeout(async () => {
    // 1자 검색은 결과 너무 많음 — 캐시된 게 있으면 그 안에서, 없으면 안내
    const el = document.getElementById(STU_TBODY[status]);
    if (q.length < 2 && !_stuSearchCache[status]) {
      if (el) el.innerHTML = `<tr><td colspan="${STU_COLSPAN[status]}" style="text-align:center;color:#bbb;padding:20px;">2글자 이상 입력하세요</td></tr>`;
      const wrap = document.getElementById(STU_WRAP[status]); if (wrap) wrap.innerHTML = '';
      return;
    }
    try {
      // 학원 전체 학생 fetch (한 번만, 이후 캐시) — 반·페이지네이션 무시
      if (el && !_stuSearchCache[status]) {
        el.innerHTML = `<tr><td colspan="${STU_COLSPAN[status]}" style="text-align:center;color:#888;padding:20px;">${iconSvg('search')} 검색 중...</td></tr>`;
      }
      const all = await _stuLoadAllForSearch(status);
      const filtered = all.filter(u =>
        (u.name||'').toLowerCase().includes(q) ||
        (u.username||'').toLowerCase().includes(q)
      );
      renderStudentTable(status, filtered);
      const wrap = document.getElementById(STU_WRAP[status]);
      if (wrap) wrap.innerHTML = `<div style="text-align:center;color:#888;padding:10px;font-size:11px;">${iconSvg('search')} 학원 전체 검색 · ${filtered.length}명 (반 필터 무시)</div>`;
    } catch (e) {
      console.error('[student search]', e);
      if (el) el.innerHTML = `<tr><td colspan="${STU_COLSPAN[status]}" style="text-align:center;color:#e05050;">검색 실패: ${esc(e.message)}</td></tr>`;
    }
  }, 300);
}

// 학생 추가/수정/삭제 후 검색 캐시 무효화 — 신규/변경 학생이 검색에 즉시 반영되게
function _stuInvalidateSearchCache() {
  _stuSearchCache.active = null;
  _stuSearchCache.pause = null;
  _stuSearchCache.out = null;
}

// 학생 캐시 surgical 갱신 — allStudents + _stuSearchCache 동기 + 현재 화면만 재렌더.
// 전체 loadStudents 재호출(반 선택·검색·페이지 리셋) 대신 사용.
// opts.remove=true → ids 의 학생 제거 (status 변경·삭제 케이스).
// opts.patch=(s)=>... → ids 의 학생 inline 필드 변경 (반배정 등).
function _stuSurgical(status, ids, opts={}) {
  if (!Array.isArray(ids) || !ids.length) return;
  const set = new Set(ids);
  const apply = (arr) => {
    if (!Array.isArray(arr)) return arr;
    if (opts.remove) return arr.filter(s => !set.has(s.id));
    if (typeof opts.patch === 'function') {
      arr.forEach(s => { if (set.has(s.id)) opts.patch(s); });
    }
    return arr;
  };
  allStudents = apply(allStudents);
  ['active','pause','out'].forEach(k => { _stuSearchCache[k] = apply(_stuSearchCache[k]); });
  // 현재 화면 재렌더 — 검색 모드면 검색 재실행(이미 갱신된 캐시), 아니면 반·페이지 모드
  const q = (document.getElementById(STU_SEARCH[status])?.value || '').trim();
  if (q) {
    _stuSearchInPage(status);
  } else if (_stuStates[status]?.group) {
    renderStudentTable(status, allStudents);
    _stuRenderLoadMore(status);
  }
}

// 수강정보 가림/노출 토글 (재원생·휴원생·퇴원생 표 공통)
let _tuitionVisible = false;
function _syncTuitionToggleBtnLabel() {
  document.querySelectorAll('#tuitionToggleBtn').forEach(btn => {
    btn.textContent = _tuitionVisible ? '🙈 수강정보 가리기' : '💰 수강정보 보기';
  });
}
window.toggleTuitionVisible = () => {
  _tuitionVisible = !_tuitionVisible;
  // 현재 활성 페이지 재렌더 (status 별로 allStudents 가 마지막 호출분으로 채워져 있음)
  if (currentPage === 'student-active') renderStudentTable('active', allStudents);
  else if (currentPage === 'student-pause') renderStudentTable('pause', allStudents);
  else if (currentPage === 'student-out') renderStudentTable('out', allStudents);
  _syncTuitionToggleBtnLabel();
};

// 수강료 / 납부일 셀 표시 헬퍼 — 가림 토글 반영. 학생 수정 모달 select 라벨과 동일 형식.
function _tuitionCells(u) {
  const tp = u.tuitionPlan || {};
  const amt = parseInt(tp.amount) || 0;
  const dueDay = parseInt(tp.dueDay);
  const amtCell = !amt ? '-' : (_tuitionVisible ? amt.toLocaleString() : '***');
  let dueCell = '-';
  if (amt) {
    if (dueDay === -1) dueCell = _tuitionVisible ? '말일' : '***';
    else if (!isFinite(dueDay) || dueDay === 0) dueCell = _tuitionVisible ? '학원기본' : '***';
    else if (dueDay >= 1 && dueDay <= 31) dueCell = _tuitionVisible ? `${dueDay}일` : '***';
  }
  return { amtCell, dueCell };
}

function renderStudentTable(status, students){
  const tbodyMap={'active':'studentTableBody','pause':'pauseTableBody','out':'outTableBody'};
  const pgMap={'active':'studentPagination','pause':'pausePagination','out':'outPagination'};
  const tbodyId=tbodyMap[status], pgId=pgMap[status];
  if(status==='active'){
    // 페이지네이션 제거 (2026-05-14) — 직접 tbody.innerHTML 렌더
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!students.length) {
      tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;color:#bbb;padding:20px;">반을 선택하세요</td></tr>';
      return;
    }
    tbody.innerHTML = students.map((u,i) => {
      const { amtCell, dueCell } = _tuitionCells(u);
      const billOn = u.tuitionPlan?.active === true;
      const billCell = billOn
        ? '<span title="자동 청구 ON" style="color:#16a34a;font-weight:700;font-size:15px;">✓</span>'
        : '<span title="자동 청구 OFF — 학생 수정에서 [매월 자동 청구서 생성] 체크" style="color:#dc2626;font-weight:700;font-size:15px;">✗</span>';
      return `<tr>
      <td><input type="checkbox" value="${u.id}"></td>
      <td>${i+1}</td>
      <td><span class="badge badge-teal">${esc(u.group)||'-'}</span></td>
      <td class="td-mono">${esc(u.username)||'-'}</td>
      <td class="td-link" onclick="editStudent('${u.id}')">${esc(u.name)||'-'}</td>
      <td class="td-sm">${esc(u.birth)||'-'}</td>
      <td class="td-sm">${esc(u.school)||'-'}</td>
      <td class="td-sm">${esc(u.grade)||'-'}</td>
      <td><span class="badge ${u.fcmToken?'badge-green':'badge-gray'}">${u.fcmToken?'수신':'미설정'}</span></td>
      <td class="td-sub">${u.createdAt?.toDate?u.createdAt.toDate().toLocaleDateString('ko-KR'):'-'}</td>
      <td class="td-center">${billCell}</td>
      <td class="td-sm" style="text-align:right;font-variant-numeric:tabular-nums;">${amtCell}</td>
      <td class="td-sm" style="text-align:center;">${dueCell}</td>
    </tr>`;
    }).join('');
  } else {
    // 휴원/퇴원 — 페이지네이션 제거 (2026-05-14) 직접 innerHTML
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!students.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#bbb;padding:20px;">반을 선택하세요</td></tr>';
      return;
    }
    tbody.innerHTML = students.map((u,i) => {
      const { amtCell, dueCell } = _tuitionCells(u);
      return `<tr>
      <td><input type="checkbox" value="${u.id}"></td>
      <td>${i+1}</td>
      <td class="td-mono">${esc(u.username)||'-'}</td>
      <td style="font-weight:600;">${esc(u.name)||'-'}</td>
      <td class="td-sm">${esc(u.birth)||'-'}</td>
      <td class="td-sm">${esc(u.school)||'-'}</td>
      <td class="td-sm">${esc(u.grade)||'-'}</td>
      <td class="td-sub">${u.createdAt?.toDate?u.createdAt.toDate().toLocaleDateString('ko-KR'):'-'}</td>
      <td class="td-sub">${u.statusDate||'-'}</td>
      <td class="td-sm" style="text-align:right;font-variant-numeric:tabular-nums;">${amtCell}</td>
      <td class="td-sm" style="text-align:center;">${dueCell}</td>
    </tr>`;
    }).join('');
  }
}

window.filterStudents      = () => _stuFilterChange('active');
window.filterStudentsPause = () => _stuFilterChange('pause');
window.filterStudentsOut   = () => _stuFilterChange('out');
window.searchStudents      = () => _stuSearchInPage('active');
window.searchStudentsPause = () => _stuSearchInPage('pause');
window.searchStudentsOut   = () => _stuSearchInPage('out');
window.toggleCheckAll = (cb) => {
  document.querySelectorAll('#studentTableBody input[type=checkbox]').forEach(c=>c.checked=cb.checked);
};
// 학원 활성 학생 카운터 조정 헬퍼 (status active 토글 시)
async function _adjustActiveStudentCount(delta) {
  if (!delta) return;
  try {
    await updateDoc(doc(db, 'academies', window.MY_ACADEMY_ID || 'default'), {
      'usage.activeStudentsCount': increment(delta),
    });
  } catch (e) { console.warn('[activeStudentsCount adjust]', e.message); }
}

window.bulkAction = async(action) => {
  const checked=[...document.querySelectorAll('#studentTableBody input[type=checkbox]:checked')].map(c=>c.value);
  if (!checked.length) { showAlert('입력 확인', '학생을 선택하세요.'); return; }
  if(action==='pause'){
    if(!await showConfirm(`선택한 ${checked.length}명을 휴원처리 할까요?`))return;
    // 휴원/퇴원 시 tuitionPlan.active 도 false 로 → 자동 청구서 생성 skip
    for(const id of checked) await updateDoc(doc(db,'users',id),{status:'pause',statusDate:_ymdKST(),'tuitionPlan.active':false});
    await _adjustActiveStudentCount(-checked.length);  // active → pause: -N
    showToast('휴원처리 완료!');
    _stuSurgical('active', checked, {remove:true});  // 화면 상태 유지 (반·검색·페이지)
  } else if(action==='out'){
    if(!await showConfirm(`선택한 ${checked.length}명을 퇴원처리 할까요?`))return;
    for(const id of checked) await updateDoc(doc(db,'users',id),{status:'out',statusDate:_ymdKST(),'tuitionPlan.active':false});
    await _adjustActiveStudentCount(-checked.length);  // active → out: -N
    showToast('퇴원처리 완료!');
    _stuSurgical('active', checked, {remove:true});
  } else if(action==='assign'){
    const classSnap=await getDocs(query(collection(db,'groups'),where('academyId','==',window.MY_ACADEMY_ID)));
    const opts=classSnap.docs.map(d=>`<option value="${esc(d.data().name)}">${esc(d.data().name)}</option>`).join('');
    showModal(`
      <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
        <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
          <div style="font-size:17px;font-weight:700;line-height:1.3;">반 배정</div>
          <div style="font-size:12px;color:var(--gray);margin-top:5px;">${checked.length}명 학생</div>
        </div>
        <div style="padding:16px 22px;overflow-y:auto;flex:1;">
          <select id="assignClass" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;">${opts}</select>
        </div>
        <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-secondary" onclick="closeModal()">취소</button>
          <button class="btn btn-primary" onclick="doAssignClass([${checked.map(id=>`'${id}'`).join(',')}])">배정</button>
        </div>
      </div>
    `);
  }
};
window.doAssignClass = async(ids) => {
  const cls=document.getElementById('assignClass').value;
  for(const id of ids) await updateDoc(doc(db,'users',id),{group:cls});
  closeModal(); showToast('반 배정 완료!');
  // 현재 active 탭 필터가 새 반(cls)·전체(__all__) 면 inline 패치(반만 갱신), 아니면 시야에서 제거
  const filter = _stuStates['active']?.group;
  if (filter && filter !== '__all__' && filter !== cls) {
    _stuSurgical('active', ids, {remove:true});
  } else {
    _stuSurgical('active', ids, {patch: (s) => { s.group = cls; }});
  }
};
window.restoreStudent = async(id) => {
  if(!await showConfirm('재원처리 할까요?'))return;
  // 재원 시 기존 tuitionPlan.amount > 0 면 active 자동 복원
  const snap = await getDoc(doc(db,'users',id));
  const hasAmt = (snap.data()?.tuitionPlan?.amount || 0) > 0;
  const update = { status:'active', statusDate:_ymdKST() };
  if (hasAmt) update['tuitionPlan.active'] = true;
  await updateDoc(doc(db,'users',id), update);
  await _adjustActiveStudentCount(+1);  // pause/out → active: +1
  showToast('재원처리 완료!');
  const fromStatus = currentPage==='student-pause' ? 'pause' : 'out';
  _stuSurgical(fromStatus, [id], {remove:true});
};
// (구버전 window.deleteStudent 제거 — 아래 Auth+Firestore 통합 삭제 사용)
window.openStudentModal = async() => {
  const classSnap=await getDocs(query(collection(db,'groups'),where('academyId','==',window.MY_ACADEMY_ID)));
  const opts=classSnap.docs.map(d=>`<option value="${esc(d.data().name)}">${esc(d.data().name)}</option>`).join('');
  showModal(`
    <div style="width:min(640px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">재원생 추가</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
          <div><div style="color:var(--gray);margin-bottom:5px;">아이디 *</div><input id="sId" type="text" placeholder="영문/숫자" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">이름 *</div><input id="sName" type="text" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">비밀번호 *</div><div style="position:relative;"><input id="sPw" type="password" autocomplete="new-password" placeholder="6자 이상" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 38px 8px 10px;font-size:13px;outline:none;"><button type="button" onclick="togglePwVis('sPw', this)" aria-label="비밀번호 보기" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:6px;line-height:0;color:#999;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></div></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">반</div><select id="sGroup" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${opts}</select></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">생일</div><input id="sBirth" type="date" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">학교</div><input id="sSchool" type="text" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">학년</div><input id="sGrade" type="text" placeholder="예: 5학년" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">연락처</div><input id="sPhone" type="tel" placeholder="010-0000-0000" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">부모님 성함</div><input id="sParentName" type="text" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">부모님 연락처</div><input id="sParentPhone" type="tel" placeholder="010-0000-0000" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--border);">
          <div style="font-size:12px;color:var(--gray);font-weight:600;margin-bottom:8px;">💰 수강료 (월별 자동 청구)</div>
          <div style="display:grid;grid-template-columns:1fr 140px;gap:12px;font-size:13px;">
            <div><div style="color:var(--gray);margin-bottom:5px;">월 수강료</div><input id="sTuitionAmount" type="number" placeholder="200000" min="0" step="10000" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
            <div><div style="color:var(--gray);margin-bottom:5px;">납부일</div><select id="sDueDay" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;"><option value="0">학원 기본값</option>${Array.from({length:31},(_,i)=>i+1).map(n=>`<option value="${n}">${n}일</option>`).join('')}<option value="-1">말일</option></select></div>
          </div>
          <div style="font-size:11px;color:#bbb;margin-top:5px;">미입력 시 자동 청구서 생성 안 됨. 학생 정보 수정에서 추후 입력 가능.</div>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="saveStudent()">저장</button>
      </div>
    </div>
  `);
};
window.saveStudent = async() => {
  const username=document.getElementById('sId').value.trim();
  const name=document.getElementById('sName').value.trim();
  const pw=document.getElementById('sPw').value;
  const group=document.getElementById('sGroup').value;
  if(!username||!name||!pw){await showAlert('입력 확인','아이디, 이름, 비밀번호는 필수입니다.');return;}
  if(pw.length<6){await showAlert('비밀번호 확인','비밀번호는 6자 이상이어야 합니다.');return;}
  try{
    // 서버 API 로 일원화 — Auth+Firestore+usernameLookup 트랜잭션적 처리 (orphan 방지)
    const idToken = await currentUser.getIdToken();
    const tuitionAmount = parseInt(document.getElementById('sTuitionAmount')?.value) || 0;
    const dueDayRaw = parseInt(document.getElementById('sDueDay')?.value);  // 0=학원 기본값, -1=말일, 1~31
    const payload = {
      idToken, username, password: pw, name, group, method: 'single',
      birth: document.getElementById('sBirth').value,
      school: document.getElementById('sSchool').value.trim(),
      grade: document.getElementById('sGrade').value.trim(),
      phone: document.getElementById('sPhone').value.trim(),
      parentName: document.getElementById('sParentName').value.trim(),
      parentPhone: document.getElementById('sParentPhone').value.trim(),
      tuitionPlan: {
        amount: tuitionAmount,
        dueDay: isFinite(dueDayRaw) ? dueDayRaw : 0,  // 0 이면 학원 default 사용
        startMonth: new Date(Date.now() + 9*3600*1000).toISOString().slice(0, 7),  // KST YYYY-MM
        active: tuitionAmount > 0,
      },
    };
    const res = await fetch('/api/createStudent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      console.error('[saveStudent] server error:', data);
      await showAlert('추가 실패', data.error || '알 수 없는 오류');
      return;
    }
    closeModal(); showToast('✅ 학생이 추가됐어요!');
    // surgical 추가 — allStudents + 검색 캐시에 즉시 반영 (현재 반·검색·페이지 유지)
    const newStu = {
      id: data.uid,
      username, name, group, role: 'student', status: 'active',
      academyId: window.MY_ACADEMY_ID || 'default',
      birth: payload.birth || '',
      school: payload.school || '',
      grade: payload.grade || '',
      phone: payload.phone || '',
      parentName: payload.parentName || '',
      parentPhone: payload.parentPhone || '',
      tuitionPlan: payload.tuitionPlan,
      statusDate: _ymdKST(),
    };
    // active 검색 캐시 즉시 반영 (없으면 다음 검색에서 fresh)
    if (Array.isArray(_stuSearchCache.active)) _stuSearchCache.active.unshift(newStu);
    // 현재 active 탭 필터가 신규 학생 반·전체와 일치 시 화면에도 추가
    const filter = _stuStates['active']?.group;
    if (currentPage === 'student-active' && filter && (filter === '__all__' || filter === group)) {
      allStudents = [newStu, ...(allStudents||[])];
      renderStudentTable('active', allStudents);
      _stuRenderLoadMore('active');
    }
  }catch(e){
    console.error('[saveStudent] network error:', e);
    await showAlert('추가 실패', `[${e.code || 'network'}] ${e.message || String(e)}`);
  }
};


// ── 공지 관리 ────────────────────────────────────────
async function loadNotices(){
  const el=document.getElementById('noticeTableBody');
  try{
    const snap=await getDocs(query(collection(db,'notices'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','desc')));
    // 한도 표시 (2026-05-14)
    try {
      const limits = await _loadContentLimits();
      const info = document.getElementById('noticeLimitInfo');
      if (info) info.textContent = `${snap.size}/${limits.noticesPerAcademy} 저장됨 · 초과 시 기존 삭제 후 추가`;
    } catch(_) {}
    if(snap.empty){el.innerHTML='<tr><td colspan="5" style="text-align:center;color:#bbb;padding:20px;">공지가 없습니다</td></tr>';return;}
    const notices=snap.docs.map(d=>({id:d.id,...d.data()}));
    const labelOf = (n) => {
      if (n.targetSummary) return n.targetSummary;
      if (Array.isArray(n.targets) && n.targets.length) return pickerSummarize(n.targets);
      if (n.target === 'all') return '전체';
      return n.target || '-';
    };
    initPagination('noticeTableBody', notices, (n,i)=>`<tr>
        <td><input type="checkbox" value="${n.id}"></td>
        <td>${i+1}</td>
        <td style="font-weight:600;cursor:pointer;color:var(--teal);" onclick="editNotice('${n.id}','${(n.title||'').replace(/'/g,"\\'")}')">${esc(n.title)||'-'}</td>
        <td><span class="badge badge-teal">${esc(labelOf(n))}</span></td>
        <td class="td-sub">${esc(n.date)||''}</td>
      </tr>`, 'noticePagination', 10);
  }catch(e){el.innerHTML='<tr><td colspan="5" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';}
}
window.openNoticeModal = async() => {
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">공지 작성</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <div style="font-size:13px;color:var(--gray);margin-bottom:6px;">📤 대상 <span style="font-size:11px;">(반·학생 다중 선택 또는 전체)</span></div>
            <div id="noticePickerSummary" style="padding:6px 10px;background:#f8f9fa;border-radius:6px;font-size:12px;margin-bottom:6px;min-height:30px;display:flex;align-items:center;flex-wrap:wrap;gap:4px;"></div>
            <div id="noticePickerBox"></div>
          </div>
          <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">제목 *</div>
            <input id="noticeTitle" type="text" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">내용 *</div>
            <textarea id="noticeContent" rows="5" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;resize:vertical;outline:none;"></textarea></div>
          ${_noticeAttachBoxHtml(null, [])}
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="saveNotice()">등록</button>
      </div>
    </div>
  `);
  _noticeClearAttaches();
  _noticeRenderAttaches();
  await pickerInit({
    boxEl: 'noticePickerBox',
    summaryEl: 'noticePickerSummary',
    initialTargets: [],
    allowAll: true,
    emptyText: '반/학생을 선택하거나 전체를 체크하세요',
    height: 220,
  });
};
window.saveNotice = async() => {
  const title=document.getElementById('noticeTitle').value.trim();
  const content=document.getElementById('noticeContent').value.trim();
  const expYmd = document.getElementById('noticeExpiresAt')?.value;
  const targets = pickerGetTargets();
  if (!title||!content) { showAlert('입력 확인', '제목과 내용을 입력하세요.'); return; }
  if (!targets.length) { showAlert('입력 확인', '대상을 선택하세요.'); return; }
  if (!expYmd) { showAlert('입력 확인', '만료일을 선택하세요.'); return; }
  // 학원당 공지 한도 검사 (2026-05-14)
  const chk = await _checkContentLimit('notices');
  if (!chk.ok) { showAlert(`${chk.label} 한도 초과 (${chk.cur}/${chk.max})`, `기존 ${chk.label} 1개 이상 삭제 후 추가해주세요.`); return; }
  // 첨부 일괄 업로드
  let attachments = [];
  try { attachments = await _noticeUploadAll(); }
  catch (e) { showAlert('첨부 업로드 실패', e.message); return; }
  const expiresAt = new Date(expYmd + 'T23:59:59+09:00');  // KST 그날 끝까지 유효
  const docRef = await addDoc(collection(db,'notices'),{
    title, content,
    targets,
    targetSummary: pickerSummarize(targets),
    date:_ymdKST(),
    createdAt:serverTimestamp(),
    academyId:window.MY_ACADEMY_ID||'default',
    expiresAt,
    attachments,
  });
  closeModal(); _noticeClearAttaches();
  showToast('공지가 등록됐어요!');
  // 페이지네이션 캐시에 즉시 삽입 (정렬 createdAt desc → 최상단). 페이지 1 위치로 이동
  const added = _pageMutate('noticeTableBody', data => {
    data.unshift({ id: docRef.id, title, content, targets,
      targetSummary: pickerSummarize(targets), date: _ymdKST(), expiresAt, attachments });
    _pageState['noticeTableBody'].page = 1;
  });
  if (!added) await loadNotices();  // 처음 진입 직후 등 캐시 미초기화 안전망
};
window.deleteNotice = async(id) => {
  if(!await showConfirm('공지를 삭제할까요?'))return;
  await deleteDoc(doc(db,'notices',id));
  showToast('삭제됐어요.');
  if (!_pageMutate('noticeTableBody', data => data.filter(n => n.id !== id))) await loadNotices();
};

// ── 자료실 (구 숙제파일) ─────────────────────────────────
async function loadHwFileAdmin(){
  const el = document.getElementById('hwfileTableBody'); if(!el) return;
  try{
    const snap = await getDocs(query(collection(db,'hwFiles'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('createdAt','desc')));
    // 한도 표시 (2026-05-14)
    try {
      const limits = await _loadContentLimits();
      const info = document.getElementById('hwfileLimitInfo');
      if (info) info.textContent = `${snap.size}/${limits.hwFilesPerAcademy} 저장됨 · 초과 시 기존 삭제 후 등록`;
    } catch(_) {}
    const files = snap.docs.map(d=>({id:d.id,...d.data()}));
    const icons={pdf:'📄',docx:'📝',doc:'📝',jpg:'🖼',jpeg:'🖼',png:'🖼',hwp:'📋'};
    const labelOf = (f) => {
      if (f.targetSummary) return f.targetSummary;
      if (Array.isArray(f.targets) && f.targets.length) return pickerSummarize(f.targets);
      if (f.group === '전체') return '전체';
      return f.group || '-';
    };
    initPagination('hwfileTableBody', files, (f,i)=>`<tr>
      <td><input type="checkbox" value="${f.id}"></td>
      <td>${i+1}</td>
      <td style="font-weight:600;">${esc(f.name)||'-'}</td>
      <td><span class="badge badge-teal">${esc(labelOf(f))}</span></td>
      <td>${icons[f.type]||'📄'} ${(f.type||'').toUpperCase()}</td>
      <td class="td-sub">${f.date||''}</td>
      <td><a href="${f.url||'#'}" target="_blank" class="btn btn-secondary btn-sm">다운로드</a></td>
      <td><button class="btn btn-secondary btn-sm" onclick="editHwFile('${f.id}')">${iconSvg('edit')} 수정</button></td>
    </tr>`, 'hwfilePagination', 7);
  }catch(e){ el.innerHTML='<tr><td colspan="8" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>'; }
}

window.editSelectedHwFile = () => {
  const ids = getCheckedIds('hwfileTableBody');
  if (ids.length !== 1) { showAlert('입력 확인', '수정할 파일을 하나만 선택하세요.'); return; }
  editHwFile(ids[0]);
};

window.editHwFile = async(id) => {
  const snap = await getDoc(doc(db,'hwFiles',id));
  if (!snap.exists()) { showAlert('입력 확인', '파일 정보를 찾을 수 없습니다.'); return; }
  const f = snap.data();

  // 옛 schema 도 신 schema 로 변환해서 picker 초기값으로
  let initialTargets = Array.isArray(f.targets) ? f.targets : [];
  if (!initialTargets.length) {
    if (f.targetUid) initialTargets = [{ type:'student', id:f.targetUid, name:'(학생)', groupName:'' }];
    else if (f.group && f.group !== '전체') initialTargets = [{ type:'class', id:f.group, name:f.group+' 전체', groupName:f.group }];
    else initialTargets = [{ type:'all', id:'__all__', name:'전체 학원생' }];
  }

  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">${iconSvg('edit')} 자료 수정</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="display:flex;flex-direction:column;gap:14px;font-size:13px;">
          <div>
            <div style="color:var(--gray);margin-bottom:6px;">파일명</div>
            <input id="hwfEditName" type="text" value="${(f.name||'').replace(/"/g,'&quot;')}"
              style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;outline:none;">
          </div>
          <div>
            <div style="color:var(--gray);margin-bottom:6px;">📤 대상 <span style="font-size:11px;">(반·학생 다중 선택 또는 전체)</span></div>
            <div id="hwfPickerSummary" style="padding:6px 10px;background:#f8f9fa;border-radius:6px;font-size:12px;margin-bottom:6px;min-height:30px;display:flex;align-items:center;flex-wrap:wrap;gap:4px;"></div>
            <div id="hwfPickerBox"></div>
          </div>
          <div style="padding:10px 12px;background:#f8f9fa;border-radius:8px;font-size:12px;color:var(--gray);">
            📎 현재 파일: <b style="color:var(--text);">${esc(f.name)||'-'}.${f.type||''}</b>
            <br><span style="font-size:11px;">파일 자체를 교체하려면 삭제 후 새로 등록하세요.</span>
          </div>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="saveHwFileEdit('${id}')">${iconSvg('save')} 저장</button>
      </div>
    </div>`);
  await pickerInit({
    boxEl: 'hwfPickerBox',
    summaryEl: 'hwfPickerSummary',
    initialTargets,
    allowAll: true,
    emptyText: '반/학생을 선택하거나 전체를 체크하세요',
    height: 220,
  });
  setTimeout(()=>document.getElementById('hwfEditName')?.focus(),100);
};

window.saveHwFileEdit = async(id) => {
  const name = document.getElementById('hwfEditName')?.value.trim();
  const targets = pickerGetTargets();
  if (!name) { showAlert('입력 확인', '파일명을 입력하세요.'); return; }
  if (!targets.length) { showAlert('입력 확인', '대상을 선택하세요.'); return; }

  // 학생앱 옛 필터 호환을 위해 group/targetUid 도 함께 갱신 (단일 대상 케이스만 — 다중이면 신 schema 만 사용)
  let group = '전체', targetUid = null;
  if (targets.length === 1) {
    const t = targets[0];
    if (t.type === 'class') group = t.id;
    else if (t.type === 'student') { targetUid = t.id; group = t.id; }
  }

  const patch = {
    name,
    targets,
    targetSummary: pickerSummarize(targets),
    group, targetUid: targetUid||null,   // 옛 호환 (학생앱 폴백)
  };
  await updateDoc(doc(db,'hwFiles',id), { ...patch, updatedAt: serverTimestamp() });
  closeModal();
  showToast('✅ 수정됐어요!');
  const ok = _pageMutate('hwfileTableBody', data => {
    const i = data.findIndex(f => f.id === id);
    if (i >= 0) Object.assign(data[i], patch);
  });
  if (!ok) await loadHwFileAdmin();
};

window.openHwFileModal = async() => {
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">📁 자료 등록</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="display:flex;flex-direction:column;gap:14px;font-size:13px;">
          <div>
            <div style="color:var(--gray);margin-bottom:6px;">파일명 (표시 이름)</div>
            <input id="hwfName" type="text" placeholder="예: 1단원 받아쓰기" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;outline:none;">
          </div>
          <div>
            <div style="color:var(--gray);margin-bottom:6px;">📤 대상 <span style="font-size:11px;">(반·학생 다중 선택 또는 전체)</span></div>
            <div id="hwfPickerSummary" style="padding:6px 10px;background:#f8f9fa;border-radius:6px;font-size:12px;margin-bottom:6px;min-height:30px;display:flex;align-items:center;flex-wrap:wrap;gap:4px;"></div>
            <div id="hwfPickerBox"></div>
          </div>
          <div>
            <div style="color:var(--gray);margin-bottom:6px;">파일 선택</div>
            <input type="file" id="hwfFile" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx,.jpg,.jpeg,.png,.gif,.bmp,.webp,.heic,.heif,.txt,.csv"
              style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">
            <div style="margin-top:6px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;color:#475569;line-height:1.6;">
              <div style="font-weight:600;color:#0f172a;margin-bottom:2px;">${iconSvg('clipboard')} 허용 형식 (단일 파일 최대 20 MB)</div>
              ✅ PDF · Word · Excel · PowerPoint · 한글(hwp) · 이미지 · 텍스트<br>
              ❌ 영상 · 압축파일(zip) · 실행파일 · 음성 등 (학원 Storage 악용 방지)
            </div>
          </div>
          <div id="hwfProgress" style="display:none;height:6px;background:#eee;border-radius:10px;overflow:hidden;">
            <div id="hwfProgressBar" style="height:100%;background:var(--teal);width:0%;transition:width .3s;"></div>
          </div>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" id="hwfUploadBtn" onclick="uploadHwFileAdmin()">📤 업로드</button>
      </div>
    </div>`);
  await pickerInit({
    boxEl: 'hwfPickerBox',
    summaryEl: 'hwfPickerSummary',
    initialTargets: [],
    allowAll: true,
    emptyText: '반/학생을 선택하거나 전체를 체크하세요',
    height: 220,
  });
  setTimeout(()=>document.getElementById('hwfName')?.focus(),100);
};

// hwFiles 허용 파일 타입 (storage.rules 와 동기화 필수)
const _HW_ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.hancom.hwp',
];
const _HW_ALLOWED_MIME_PREFIX = [
  'application/vnd.openxmlformats-officedocument.',  // docx/xlsx/pptx
  'application/x-hwp',                                 // 한글 (변형)
  'application/hwp',
  'image/',
  'text/',
];
function _isAllowedHwFile(file) {
  const t = (file?.type || '').toLowerCase();
  if (_HW_ALLOWED_MIME.includes(t)) return true;
  if (_HW_ALLOWED_MIME_PREFIX.some(p => t.startsWith(p))) return true;
  // contentType 비어있는 경우 확장자로 fallback (브라우저가 못 잡은 케이스)
  const ext = (file?.name || '').split('.').pop()?.toLowerCase() || '';
  const allowedExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'hwp', 'hwpx',
                       'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'heic', 'heif',
                       'txt', 'csv'];
  return allowedExts.includes(ext);
}

window.uploadHwFileAdmin = async() => {
  const name = document.getElementById('hwfName')?.value.trim();
  const targets = pickerGetTargets();
  const fileEl = document.getElementById('hwfFile');
  const file = fileEl?.files[0];
  if (!name) { showAlert('입력 확인', '파일명을 입력하세요.'); return; }
  if (!targets.length) { showAlert('입력 확인', '대상을 선택하세요.'); return; }
  if (!file) { showAlert('입력 확인', '파일을 선택하세요.'); return; }

  // 학원당 자료실 한도 검사 (2026-05-14)
  const chk = await _checkContentLimit('hwFiles');
  if (!chk.ok) { showAlert(`${chk.label} 한도 초과 (${chk.cur}/${chk.max})`, `기존 ${chk.label} 1개 이상 삭제 후 등록해주세요.`); return; }

  // 사이즈 사전 체크 (storage.rules: 20 MB)
  const MAX_BYTES = 20 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    showAlert('파일이 너무 큼', `학원장 파일은 단일 20 MB 이하만 가능합니다.\n현재 파일: ${mb} MB`);
    return;
  }
  // 타입 사전 체크 (storage.rules 의 화이트리스트와 동기화)
  if (!_isAllowedHwFile(file)) {
    showAlert('지원하지 않는 파일',
      '허용 형식: PDF / Word / Excel / PowerPoint / 한글(hwp) / 이미지 / 텍스트\n\n' +
      '영상·압축파일·실행파일 등은 업로드할 수 없습니다.\n' +
      '(교육 자료 외 용도로 학원 Storage 사용 금지)');
    return;
  }

  // 학생앱 옛 필터 호환 — targets 가 단일 대상이면 group/targetUid 도 채움
  let group = '전체', targetUid = null;
  if (targets.length === 1) {
    const t = targets[0];
    if (t.type === 'class') group = t.id;
    else if (t.type === 'student') { targetUid = t.id; group = t.id; }
  }

  const btn = document.getElementById('hwfUploadBtn');
  const prog = document.getElementById('hwfProgress');
  const bar  = document.getElementById('hwfProgressBar');
  if(btn){ btn.disabled=true; btn.textContent='업로드 중...'; }
  if(prog) prog.style.display='block';

  try{
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `hwFiles/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, path);

    // 업로드 진행률 표시
    const task = uploadBytesResumable(storageRef, file);
    await new Promise((res,rej)=>{
      task.on('state_changed',
        snap=>{ const pct=Math.round(snap.bytesTransferred/snap.totalBytes*100); if(bar) bar.style.width=pct+'%'; },
        rej, res
      );
    });
    const url = await getDownloadURL(storageRef);
    const today = _ymdKST();

    const data = {
      name, url,
      targets,
      targetSummary: pickerSummarize(targets),
      group, targetUid: targetUid||null,   // 옛 호환 (학생앱 폴백)
      type: ext,
      date: today,
      storagePath: path,
      academyId: window.MY_ACADEMY_ID || 'default',
    };
    const docRef = await addDoc(collection(db,'hwFiles'), { ...data, createdAt: serverTimestamp() });

    closeModal();
    showToast('✅ 파일이 등록됐어요!');
    const added = _pageMutate('hwfileTableBody', d => {
      d.unshift({ id: docRef.id, ...data });
      _pageState['hwfileTableBody'].page = 1;
    });
    if (!added) await loadHwFileAdmin();
  }catch(e){
    showToast('업로드 실패: '+e.message);
    if(btn){ btn.disabled=false; btn.textContent='📤 업로드'; }
  }
};

window.deleteSelectedHwFile = async() => {
  const ids = getCheckedIds('hwfileTableBody');
  if (!ids.length) { showAlert('입력 확인', '삭제할 파일을 선택하세요.'); return; }
  if(!await showConfirm(`선택한 파일 ${ids.length}개를 삭제할까요?`)) return;
  const okIds = [];
  for(const id of ids){
    try{
      const d = await getDoc(doc(db,'hwFiles',id));
      if(d.exists() && d.data().storagePath){
        try{ await deleteObject(ref(storage, d.data().storagePath)); }catch(e){console.warn(e);}
      }
      await deleteDoc(doc(db,'hwFiles',id));
      okIds.push(id);
    }catch(e){console.warn(e);}
  }
  showToast('삭제됐어요.');
  const set = new Set(okIds);
  if (!_pageMutate('hwfileTableBody', data => data.filter(f => !set.has(f.id)))) await loadHwFileAdmin();
};

// ── 결제 관리 v2 (2026-05-02) — billings 컬렉션 기반 ───────
// P1-1: 데이터 모델 + Rules + 인덱스 (배포 완료)
// P1-2: 결제 설정 마법사 — 첫 진입 시 자동 노출
// P1-3+: 학생 tuitionPlan + 자동 청구서 + 그리드 UI (다음 작업)

// 한국 시중 은행 목록 (마법사 select 용)
const _BILLING_BANKS = [
  '농협', '국민', '신한', '우리', '하나', '기업', '카카오뱅크', '토스뱅크',
  '새마을금고', '우체국', 'SC제일', '씨티', '대구', '부산', '경남', '광주',
  '전북', '제주', '수협', 'KDB산업', '케이뱅크',
];

let _billingSettings = null;  // academies/{id}.paymentSettings 캐시
let _billingWizardStep = 1;
let _billingWizardData = {};  // 마법사 진행 중 임시 데이터

// 결제 페이지 진입점
async function loadPayments(){
  const main = document.getElementById('billingMain');
  if (!main) return;
  try {
    const acadSnap = await getDoc(doc(db, 'academies', window.MY_ACADEMY_ID || 'default'));
    _billingSettings = acadSnap.exists() ? (acadSnap.data().paymentSettings || null) : null;

    if (!_billingSettings || !_billingSettings.tuitionChannel?.bankAccount) {
      // 미설정 — 결제 설정 마법사 자동 노출
      main.innerHTML = `
        <div class="card" style="padding:48px 24px;text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">💳</div>
          <div style="font-size:18px;font-weight:700;margin-bottom:8px;">결제 관리를 시작해 보세요</div>
          <div style="color:var(--gray);font-size:13px;line-height:1.6;margin-bottom:24px;">
            매월 학생별 청구서를 자동 생성하고 학원장 안내 메시지를 만듭니다.<br>
            먼저 수강료를 받을 계좌 정보를 등록해주세요.
          </div>
          <button class="btn btn-primary" onclick="openPaymentSettingsWizard()">⚙️ 결제 설정 시작</button>
        </div>`;
      // 첫 진입 자동 마법사 (사용자 친화)
      setTimeout(() => openPaymentSettingsWizard(), 100);
      return;
    }

    // 설정 완료 — 이번 달 청구서 자동 생성 (lazy) + 탭 디스패치
    if (!_billingMonth) _billingMonth = _ymdKST().slice(0, 7);  // 기본: 이번 달
    const generated = (_billingMonth === _ymdKST().slice(0, 7) && _billingTab === 'grid') ? await _ensureCurrentMonthBillings() : 0;
    if (_billingTab === 'summary') await _renderBillingSummary();
    else if (_billingTab === 'timeline') await _renderBillingTimeline();
    else await _renderBillingGrid(generated);
  } catch(e) {
    main.innerHTML = `<div style="padding:24px;color:#e05050;">로드 실패: ${esc(e.message)}</div>`;
  }
}

// ── 그리드 UI (P1-5) ────────────────────────────────────
let _billingTab = 'grid';       // 'grid' | 'summary' | 'timeline'
let _billingMonth = null;       // 'YYYY-MM' 현재 보고있는 월
let _billings = [];             // 현재 월 청구서 (캐시 reference)
let _billingsByMonth = {};      // 월별 캐시 — { 'YYYY-MM': [...billings] } (2026-05-14)
let _billingFilterGroup = '';   // 반 필터
let _billingFilterStatus = '';  // 상태 필터

// 결제 캐시 무효화 (학생 추가·삭제·결제 등 학원 단위 데이터 변경 후)
function _billingInvalidateCache(ym) {
  if (ym) delete _billingsByMonth[ym];
  else _billingsByMonth = {};
}

// 탭 네비게이션 (P3) — 모든 결제 페이지 뷰 상단에 공통 표시
function _billingTabsHtml() {
  const tab = (key, icon, label) => {
    const active = _billingTab === key;
    return `<button onclick="_billingChangeTab('${key}')" style="padding:8px 16px;border:none;background:${active?'white':'transparent'};color:${active?'var(--teal)':'var(--gray)'};font-size:13px;font-weight:${active?'700':'500'};border-bottom:2px solid ${active?'var(--teal)':'transparent'};cursor:pointer;">${icon} ${label}</button>`;
  };
  return `<div style="display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:12px;background:#f8f9fa;border-radius:8px 8px 0 0;padding:0 8px;">
    ${tab('grid', '📋', '청구 그리드')}
    ${tab('summary', '📊', '월간 결산')}
    ${tab('timeline', '📅', '타임라인 (3개월)')}
  </div>`;
}

window._billingChangeTab = async (t) => {
  _billingTab = t;
  await loadPayments();
};

// 월 셀렉트 옵션 (이번 달 KST 기준 -6 ~ 0). 문자열 산술로 타임존 안전.
function _billingMonthOptions(selected) {
  const curYm = _ymdKST().slice(0, 7);  // 'YYYY-MM' KST
  let [y, m] = curYm.split('-').map(Number);
  const opts = [];
  for (let off = 0; off >= -6; off--) {
    let mm = m + off;
    let yy = y;
    while (mm <= 0) { mm += 12; yy--; }
    while (mm > 12) { mm -= 12; yy++; }
    const ym = `${yy}-${String(mm).padStart(2, '0')}`;
    const label = `${mm}월 (${ym})${off === 0 ? ' · 이번 달' : ''}`;
    opts.push(`<option value="${ym}"${selected === ym ? ' selected' : ''}>${label}</option>`);
  }
  return opts.join('');
}

async function _renderBillingGrid(generated = 0, { refetch = true } = {}) {
  const main = document.getElementById('billingMain');
  if (!main) return;
  const academyId = window.MY_ACADEMY_ID || 'default';

  // 청구서 로드 — refetch=false 일 땐 in-memory _billings 사용 (eventual consistency 회피)
  // refetch=true 라도 월별 캐시 hit 면 fetch skip (2026-05-14)
  if (refetch) {
    const cached = _billingsByMonth[_billingMonth];
    if (Array.isArray(cached)) {
      _billings = cached;
    } else {
      const billingSnap = await getDocs(query(
        collection(db, 'billings'),
        where('academyId', '==', academyId),
        where('yearMonth', '==', _billingMonth),
      ));
      _billings = billingSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      _billingsByMonth[_billingMonth] = _billings;  // reference 저장 — in-place mutation 자동 반영
    }
  }
  _billings.sort((a, b) => (a.studentName || '').localeCompare(b.studentName || '', 'ko'));

  // 반 목록 (필터용)
  const groupsSet = new Set(_billings.map(b => b.groupName).filter(Boolean));
  const groupOpts = ['<option value="">전체 반</option>',
    ...Array.from(groupsSet).sort().map(g => `<option value="${esc(g)}"${_billingFilterGroup === g ? ' selected' : ''}>${esc(g)}</option>`)
  ].join('');

  // 필터 적용
  let filtered = _billings;
  if (_billingFilterGroup) filtered = filtered.filter(b => b.groupName === _billingFilterGroup);
  if (_billingFilterStatus) filtered = filtered.filter(b => _billingComputeStatus(b) === _billingFilterStatus);

  // 통계
  const total = filtered.reduce((s, b) => s + (b.totalAmount || 0), 0);
  const paid = filtered.reduce((s, b) => s + (b.paidAmount || 0), 0);
  const unpaid = total - paid;
  const paidPct = total > 0 ? Math.round((paid / total) * 100) : 0;
  const overdueCount = filtered.filter(b => _billingComputeStatus(b) === 'overdue').length;
  const overdueAmt = filtered.filter(b => _billingComputeStatus(b) === 'overdue')
    .reduce((s, b) => s + ((b.totalAmount || 0) - (b.paidAmount || 0)), 0);

  // materials 채널 사용 여부
  const matEnabled = !!_billingSettings?.materialsChannel?.enabled;

  main.innerHTML = `
    ${_billingTabsHtml()}
    <!-- 컨트롤 바 -->
    <div class="card" style="padding:14px 18px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <select onchange="_billingChangeMonth(this.value)" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-weight:600;">
        ${_billingMonthOptions(_billingMonth)}
      </select>
      <select onchange="_billingChangeFilterGroup(this.value)" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
        ${groupOpts}
      </select>
      <select onchange="_billingChangeFilterStatus(this.value)" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
        <option value="">전체 상태</option>
        <option value="unpaid"${_billingFilterStatus === 'unpaid' ? ' selected' : ''}>미입금</option>
        <option value="partial"${_billingFilterStatus === 'partial' ? ' selected' : ''}>부분 입금</option>
        <option value="overdue"${_billingFilterStatus === 'overdue' ? ' selected' : ''}>연체</option>
        <option value="paid"${_billingFilterStatus === 'paid' ? ' selected' : ''}>입금 완료</option>
      </select>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
        ${generated > 0 ? `<span style="padding:6px 12px;background:#dbeafe;border-radius:6px;font-size:12px;color:#1e40af;">✓ ${generated}건 새로 생성</span>` : ''}
        <button class="btn btn-secondary" onclick="_billingOpenTemplateEditor()" style="font-size:12px;padding:7px 12px;" title="모든 학생에 적용되는 메시지 템플릿 편집">⚙️ 메시지 템플릿</button>
        <button class="btn btn-primary" onclick="_billingOpenBulkMessage()" style="font-size:12px;padding:7px 12px;">📨 미납자 일괄 메시지</button>
      </div>
    </div>

    <!-- 통계 카드 4개 -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px;">
      <div class="card" style="padding:14px;text-align:center;">
        <div style="font-size:11px;color:var(--gray);">이번 달 청구</div>
        <div style="font-size:20px;font-weight:800;margin-top:3px;">${total.toLocaleString()}원</div>
      </div>
      <div class="card" style="padding:14px;text-align:center;background:#f0fdf4;border:1px solid #bbf7d0;">
        <div style="font-size:11px;color:#15803d;">입금 완료</div>
        <div style="font-size:20px;font-weight:800;margin-top:3px;color:#15803d;">${paid.toLocaleString()}원</div>
        <div style="font-size:10px;color:#15803d;margin-top:2px;">${paidPct}%</div>
      </div>
      <div class="card" style="padding:14px;text-align:center;background:#fff7ed;border:1px solid #fed7aa;">
        <div style="font-size:11px;color:#c2410c;">미입금</div>
        <div style="font-size:20px;font-weight:800;margin-top:3px;color:#c2410c;">${unpaid.toLocaleString()}원</div>
      </div>
      <div class="card" style="padding:14px;text-align:center;background:${overdueCount>0?'#fef2f2':'white'};border:1px solid ${overdueCount>0?'#fecaca':'var(--border)'};">
        <div style="font-size:11px;color:#b91c1c;">연체</div>
        <div style="font-size:20px;font-weight:800;margin-top:3px;color:#b91c1c;">${overdueAmt.toLocaleString()}원</div>
        <div style="font-size:10px;color:#b91c1c;margin-top:2px;">${overdueCount}명</div>
      </div>
    </div>

    <!-- 그리드 -->
    <div class="card" style="padding:0;overflow:auto;">
      <table class="billing-grid" style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead style="position:sticky;top:0;background:#f8f9fa;z-index:5;">
          <tr style="border-bottom:2px solid var(--border);">
            <th rowspan="2" style="padding:10px 12px;text-align:left;border-right:1px solid #e9ecef;">학생</th>
            <th rowspan="2" style="padding:10px 12px;text-align:left;border-right:1px solid #e9ecef;">반</th>
            <th colspan="2" style="padding:8px 12px;text-align:center;background:rgba(13,148,136,0.08);border-right:1px solid #e9ecef;border-bottom:1px solid #e9ecef;">💳 학원 결제</th>
            ${matEnabled ? '<th colspan="2" style="padding:8px 12px;text-align:center;background:rgba(255,165,100,0.08);border-right:1px solid #e9ecef;border-bottom:1px solid #e9ecef;">📚 교재/시험비</th>' : ''}
            <th rowspan="2" style="padding:10px 12px;text-align:right;border-right:1px solid #e9ecef;">합계</th>
            <th rowspan="2" style="padding:10px 12px;text-align:center;border-right:1px solid #e9ecef;">납부기한</th>
            <th rowspan="2" style="padding:10px 12px;text-align:center;border-right:1px solid #e9ecef;">상태</th>
            <th rowspan="2" style="padding:10px 12px;text-align:center;border-right:1px solid #e9ecef;">메시지</th>
            <th rowspan="2" style="padding:10px 12px;text-align:center;width:90px;">작업</th>
          </tr>
          <tr style="border-bottom:1px solid var(--border);background:#f8f9fa;">
            <th style="padding:6px 12px;text-align:right;font-size:11px;color:var(--gray);background:rgba(13,148,136,0.04);">금액</th>
            <th style="padding:6px 12px;text-align:center;font-size:11px;color:var(--gray);background:rgba(13,148,136,0.04);border-right:1px solid #e9ecef;width:80px;">입금</th>
            ${matEnabled ? '<th style="padding:6px 12px;text-align:right;font-size:11px;color:var(--gray);background:rgba(255,165,100,0.04);">금액</th><th style="padding:6px 12px;text-align:center;font-size:11px;color:var(--gray);background:rgba(255,165,100,0.04);border-right:1px solid #e9ecef;width:80px;">입금</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0
            ? `<tr><td colspan="${matEnabled ? 11 : 9}" style="padding:40px;text-align:center;color:#bbb;font-size:13px;">청구서가 없습니다. 학생 정보에서 [💰 월 수강료] 를 등록하세요.</td></tr>`
            : filtered.map(b => _billingRenderRow(b, matEnabled)).join('')
          }
        </tbody>
        ${filtered.length > 0 ? `
        <tfoot>
          <tr style="background:#f8f9fa;border-top:2px solid var(--border);font-weight:700;">
            <td colspan="2" style="padding:10px 12px;border-right:1px solid #e9ecef;">합계 (${filtered.length}건)</td>
            <td style="padding:10px 12px;text-align:right;background:rgba(13,148,136,0.04);">${_billingChannelTotal(filtered, 'tuition').toLocaleString()}</td>
            <td style="padding:10px 12px;text-align:center;background:rgba(13,148,136,0.04);border-right:1px solid #e9ecef;font-size:11px;color:var(--gray);">-</td>
            ${matEnabled ? `
              <td style="padding:10px 12px;text-align:right;background:rgba(255,165,100,0.04);">${_billingChannelTotal(filtered, 'materials').toLocaleString()}</td>
              <td style="padding:10px 12px;text-align:center;background:rgba(255,165,100,0.04);border-right:1px solid #e9ecef;font-size:11px;color:var(--gray);">-</td>
            ` : ''}
            <td style="padding:10px 12px;text-align:right;border-right:1px solid #e9ecef;">${total.toLocaleString()}원</td>
            <td colspan="4" style="padding:10px 12px;"></td>
          </tr>
        </tfoot>` : ''}
      </table>
    </div>

    `;
}

function _billingRenderRow(b, matEnabled) {
  const tuitionItems = (b.items || []).filter(i => i.channel === 'tuition');
  const matItems = (b.items || []).filter(i => i.channel === 'materials');
  const status = _billingComputeStatus(b);

  const cellChannel = (items, channelKey, color) => {
    const total = items.reduce((s, i) => s + (i.amount || 0), 0);
    const allPaid = items.length > 0 && items.every(i => i.paid);
    const partialPaid = items.some(i => i.paid) && !allPaid;
    const cb = items.length === 0 ? '-' : `
      <input type="checkbox" ${allPaid ? 'checked' : ''} ${partialPaid ? 'class="partial-paid"' : ''}
        onclick="event.stopPropagation();_billingToggleChannel('${b.id}','${channelKey}',this.checked)"
        style="width:18px;height:18px;cursor:pointer;${partialPaid ? 'accent-color:#f59e0b;' : ''}">`;
    return `
      <td onclick="_billingOpenItemPanel('${b.id}','${channelKey}')" style="padding:8px 12px;text-align:right;cursor:cell;background:${color};font-variant-numeric:tabular-nums;" title="클릭하여 항목 편집">
        ${items.length === 0 ? '<span style="color:#bbb;font-size:18px;">+</span>' : `${total.toLocaleString()}${items.length > 1 ? `<small style="color:#999;font-size:10px;"> (${items.length})</small>` : ''}`}
      </td>
      <td style="padding:8px 12px;text-align:center;background:${color};border-right:1px solid #e9ecef;">${cb}</td>`;
  };

  const dueStr = b.dueDate?.toDate ? `${b.dueDate.toDate().getMonth() + 1}/${b.dueDate.toDate().getDate()}` : '-';
  const statusInfo = {
    paid: { label: '✅ 완료', color: '#15803d', bg: '#f0fdf4' },
    partial: { label: '◐ 부분', color: '#ca8a04', bg: '#fffbeb' },
    overdue: { label: '⚠️ 연체', color: '#b91c1c', bg: '#fef2f2' },
    unpaid: { label: '○ 미납', color: '#475569', bg: '#f8fafc' },
  }[status];

  return `
    <tr style="border-bottom:1px solid #f1f5f9;${status === 'overdue' ? 'background:rgba(220,38,38,0.04);' : ''}">
      <td style="padding:8px 12px;font-weight:600;border-right:1px solid #e9ecef;">${esc(b.studentName || '-')}</td>
      <td style="padding:8px 12px;color:var(--gray);font-size:12px;border-right:1px solid #e9ecef;">${esc(b.groupName || '-')}</td>
      ${cellChannel(tuitionItems, 'tuition', 'rgba(13,148,136,0.02)')}
      ${matEnabled ? cellChannel(matItems, 'materials', 'rgba(255,165,100,0.02)') : ''}
      <td style="padding:8px 12px;text-align:right;font-weight:700;border-right:1px solid #e9ecef;font-variant-numeric:tabular-nums;">${(b.totalAmount || 0).toLocaleString()}</td>
      <td style="padding:8px 12px;text-align:center;font-size:12px;color:var(--gray);border-right:1px solid #e9ecef;">${dueStr}</td>
      <td style="padding:8px 12px;text-align:center;border-right:1px solid #e9ecef;">
        <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;background:${statusInfo.bg};color:${statusInfo.color};">${statusInfo.label}</span>
      </td>
      <td style="padding:8px 12px;text-align:center;border-right:1px solid #e9ecef;">
        <button class="action-btn" onclick="event.stopPropagation();_billingOpenMessage('${b.id}')" title="학원장 안내 메시지" style="padding:4px 8px;font-size:11px;">📨</button>
      </td>
      <td style="padding:8px 12px;text-align:center;">
        <button onclick="event.stopPropagation();_billingDeleteRow('${b.id}','${esc(b.studentName||'').replace(/'/g,"&#39;")}','${esc(b.studentUid||'')}')" title="이 청구서 삭제 + 자동 청구 영구 OFF" style="padding:5px 10px;font-size:12px;background:white;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;font-weight:600;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;"><span style="font-size:16px;line-height:1;">${iconSvg('trash')}</span>삭제</button>
      </td>
    </tr>`;
}

function _billingChannelTotal(billings, channel) {
  return billings.reduce((s, b) => s + (b.items || [])
    .filter(i => i.channel === channel)
    .reduce((s2, i) => s2 + (i.amount || 0), 0), 0);
}

function _billingComputeStatus(b) {
  const total = b.totalAmount || 0;
  const paid = b.paidAmount || 0;
  if (total === 0) return 'paid';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  // 미입금 — 납부기한 지났으면 overdue
  const due = b.dueDate?.toDate?.();
  if (due && due < new Date()) return 'overdue';
  return 'unpaid';
}

window._billingChangeMonth = async (ym) => {
  _billingMonth = ym;
  await loadPayments();
};

// ES module let 변수에 inline onchange 로 직접 할당 안 되어 (글로벌 스코프) 필터 무동작이던 버그 수정
window._billingChangeFilterGroup = async (val) => {
  _billingFilterGroup = val || '';
  await _renderBillingGrid();
};
window._billingChangeFilterStatus = async (val) => {
  _billingFilterStatus = val || '';
  await _renderBillingGrid();
};

// 청구서 행 삭제 + 자동 청구 영구 OFF (A1 정책)
// 다음 진입 시 _ensureCurrentMonthBillings 가 재생성하지 않도록 tuitionPlan.active=false
window._billingDeleteRow = async (billingId, studentName, studentUid) => {
  if (!billingId) return;
  if (!(await showConfirm(
    `"${studentName || '학생'}" 청구서 삭제`,
    `이번 달 청구서를 삭제하고 자동 청구를 영구 OFF 합니다.\n\n다시 청구하려면 학생관리 → 학생 수정 → [매월 자동 청구서 생성] 체크.\n\n되돌릴 수 없습니다.`
  ))) return;
  try {
    // 1. 학생 자동 청구 OFF (재생성 차단)
    if (studentUid) {
      try {
        await updateDoc(doc(db, 'users', studentUid), {
          'tuitionPlan.active': false,
        });
      } catch (e) { console.warn('[billingDeleteRow] tuitionPlan.active OFF 실패:', e.message); }
    }
    // 2. 청구서 삭제
    await deleteDoc(doc(db, 'billings', billingId));
    showToast('✓ 청구서 삭제 + 자동 청구 OFF');
    _billingInvalidateCache(_billingMonth);
    await _renderBillingGrid();
  } catch (e) {
    showAlert('삭제 실패', e.message);
  }
};

// ── P3-1: 월간 결산 — 채널별 청구·수금·미수 + CSV ─────────────
async function _renderBillingSummary() {
  const main = document.getElementById('billingMain');
  if (!main) return;
  const academyId = window.MY_ACADEMY_ID || 'default';
  const matEnabled = !!_billingSettings?.materialsChannel?.enabled;

  // 청구 그리드와 동일한 쿼리 — 월별 캐시 hit 면 fetch skip (2026-05-14)
  let billings = _billingsByMonth[_billingMonth];
  if (!Array.isArray(billings)) {
    const billingSnap = await getDocs(query(
      collection(db, 'billings'),
      where('academyId', '==', academyId),
      where('yearMonth', '==', _billingMonth),
    ));
    billings = billingSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    _billingsByMonth[_billingMonth] = billings;
  }

  // 채널별 합산
  const sumChannel = (key) => {
    let charged = 0, paid = 0;
    for (const b of billings) {
      for (const i of (b.items || [])) {
        if (i.channel !== key) continue;
        charged += (i.amount || 0);
        if (i.paid) paid += (i.amount || 0);
      }
    }
    return { charged, paid, unpaid: charged - paid, count: billings.filter(b => (b.items||[]).some(i => i.channel===key)).length };
  };
  const sTuition = sumChannel('tuition');
  const sMat = sumChannel('materials');
  const total = { charged: sTuition.charged + sMat.charged, paid: sTuition.paid + sMat.paid };
  total.unpaid = total.charged - total.paid;
  total.pct = total.charged > 0 ? Math.round((total.paid / total.charged) * 100) : 0;

  // 학생 수 / 상태 분포
  const stCount = { paid: 0, partial: 0, unpaid: 0, overdue: 0 };
  for (const b of billings) stCount[_billingComputeStatus(b)]++;

  const channelCard = (label, emoji, s, color) => `
    <div class="card" style="padding:18px;border-left:4px solid ${color};">
      <div style="font-size:13px;font-weight:700;margin-bottom:12px;">${emoji} ${label}</div>
      <div style="display:flex;flex-direction:column;gap:8px;font-variant-numeric:tabular-nums;">
        <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--gray);">청구</span><strong>${s.charged.toLocaleString()}원</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#15803d;">입금</span><strong style="color:#15803d;">${s.paid.toLocaleString()}원</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;border-top:1px solid var(--border);padding-top:6px;"><span style="color:#c2410c;">미수금</span><strong style="color:#c2410c;">${s.unpaid.toLocaleString()}원</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--gray);"><span>수금률</span><span>${s.charged>0 ? Math.round(s.paid/s.charged*100) : 0}%</span></div>
      </div>
    </div>`;

  main.innerHTML = `
    ${_billingTabsHtml()}
    <div class="card" style="padding:14px 18px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <select onchange="_billingChangeMonth(this.value)" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-weight:600;">
        ${_billingMonthOptions(_billingMonth)}
      </select>
      <span style="margin-left:auto;font-size:12px;color:var(--gray);">${billings.length}건 청구서</span>
      <button class="btn btn-primary" onclick="_billingExportSummaryCSV()" style="font-size:12px;padding:7px 12px;">📥 CSV 다운로드</button>
    </div>

    <!-- 합계 요약 -->
    <div class="card" style="padding:20px;margin-bottom:12px;background:linear-gradient(135deg,#fefefe 0%,#f0fdf4 100%);border:1px solid #bbf7d0;">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center;">
        <div>
          <div style="font-size:11px;color:var(--gray);">총 청구</div>
          <div style="font-size:22px;font-weight:800;margin-top:3px;">${total.charged.toLocaleString()}원</div>
          <div style="font-size:11px;color:var(--gray);margin-top:2px;">${billings.length}건</div>
        </div>
        <div>
          <div style="font-size:11px;color:#15803d;">총 입금</div>
          <div style="font-size:22px;font-weight:800;margin-top:3px;color:#15803d;">${total.paid.toLocaleString()}원</div>
          <div style="font-size:11px;color:#15803d;margin-top:2px;">${total.pct}%</div>
        </div>
        <div>
          <div style="font-size:11px;color:#c2410c;">총 미수금</div>
          <div style="font-size:22px;font-weight:800;margin-top:3px;color:#c2410c;">${total.unpaid.toLocaleString()}원</div>
          <div style="font-size:11px;color:#c2410c;margin-top:2px;">${stCount.unpaid + stCount.partial + stCount.overdue}건</div>
        </div>
        <div>
          <div style="font-size:11px;color:#b91c1c;">연체</div>
          <div style="font-size:22px;font-weight:800;margin-top:3px;color:#b91c1c;">${stCount.overdue}건</div>
          <div style="font-size:11px;color:#b91c1c;margin-top:2px;">즉시 안내 필요</div>
        </div>
      </div>
    </div>

    <!-- 채널별 결산 (세무 분리용) -->
    <div style="display:grid;grid-template-columns:${matEnabled?'repeat(2,1fr)':'1fr'};gap:12px;margin-bottom:12px;">
      ${channelCard('학원 결제 (수강료)', '💳', sTuition, '#0d9488')}
      ${matEnabled ? channelCard('교재/시험비 (별도 채널)', '📚', sMat, '#f59e0b') : ''}
    </div>

    <div class="card" style="padding:14px 18px;font-size:11px;color:var(--gray);line-height:1.6;">
      💡 <b>세무 처리</b>: 학원 매출(수강료)과 개인 매출(교재/시험비)이 채널로 분리됩니다. CSV 다운로드 시 채널별 컬럼이 분리되어 사업자 신고와 개인 신고에 활용 가능합니다.
    </div>`;
}

window._billingExportSummaryCSV = async () => {
  const academyId = window.MY_ACADEMY_ID || 'default';
  const matEnabled = !!_billingSettings?.materialsChannel?.enabled;
  const snap = await getDocs(query(
    collection(db, 'billings'),
    where('academyId', '==', academyId),
    where('yearMonth', '==', _billingMonth),
  ));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => (a.studentName || '').localeCompare(b.studentName || '', 'ko'));

  const ch = (b, key) => {
    const items = (b.items || []).filter(i => i.channel === key);
    const charged = items.reduce((s, i) => s + (i.amount || 0), 0);
    const paid = items.filter(i => i.paid).reduce((s, i) => s + (i.amount || 0), 0);
    return { charged, paid, unpaid: charged - paid };
  };
  const dueStr = (b) => {
    const d = b.dueDate?.toDate?.();
    return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '';
  };
  const statusLabel = (s) => ({ paid: '완료', partial: '부분', overdue: '연체', unpaid: '미납' }[s] || s);

  const headers = ['학생', '반', '납부기한', '학원 결제 청구', '학원 결제 입금', '학원 결제 미수'];
  if (matEnabled) headers.push('교재시험비 청구', '교재시험비 입금', '교재시험비 미수');
  headers.push('총 청구', '총 입금', '총 미수', '상태');

  const lines = [headers.join(',')];
  for (const b of rows) {
    const t = ch(b, 'tuition');
    const m = ch(b, 'materials');
    const totalCharged = (b.totalAmount || 0);
    const totalPaid = (b.paidAmount || 0);
    const csvCell = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cells = [b.studentName || '', b.groupName || '', dueStr(b), t.charged, t.paid, t.unpaid];
    if (matEnabled) cells.push(m.charged, m.paid, m.unpaid);
    cells.push(totalCharged, totalPaid, totalCharged - totalPaid, statusLabel(_billingComputeStatus(b)));
    lines.push(cells.map(csvCell).join(','));
  }

  // BOM + UTF-8 (Excel 한글 호환)
  const csv = '﻿' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `결산_${_billingMonth}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`✅ ${_billingMonth} 결산 CSV 다운로드`);
};

// ── P3-2: 타임라인 뷰 — 학생 × 최근 3개월 ────────────────────
async function _renderBillingTimeline() {
  const main = document.getElementById('billingMain');
  if (!main) return;
  const academyId = window.MY_ACADEMY_ID || 'default';
  const matEnabled = !!_billingSettings?.materialsChannel?.enabled;

  // 최근 3개월 (현재 _billingMonth 기준 -2 ~ 0)
  const months = [];
  let [y, m] = _billingMonth.split('-').map(Number);
  for (let off = 2; off >= 0; off--) {
    let mm = m - off, yy = y;
    while (mm <= 0) { mm += 12; yy--; }
    months.push(`${yy}-${String(mm).padStart(2,'0')}`);
  }

  // 3개월 캐시 모두 hit 면 fetch skip — 아니면 한꺼번에 in 쿼리 + 각 월 캐시 저장 (2026-05-14)
  let billings;
  const allCached = months.every(ym => Array.isArray(_billingsByMonth[ym]));
  if (allCached) {
    billings = months.flatMap(ym => _billingsByMonth[ym]);
  } else {
    const billingSnap = await getDocs(query(
      collection(db, 'billings'),
      where('academyId', '==', academyId),
      where('yearMonth', 'in', months),
    ));
    billings = billingSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    // 월별 분리해서 캐시에 저장
    const byMonth = {};
    months.forEach(ym => byMonth[ym] = []);
    billings.forEach(b => { if (byMonth[b.yearMonth]) byMonth[b.yearMonth].push(b); });
    Object.entries(byMonth).forEach(([ym, arr]) => { _billingsByMonth[ym] = arr; });
  }

  // 학생별 그룹화: { studentUid: { studentName, groupName, byMonth: { ym: billing } } }
  const byStudent = {};
  for (const b of billings) {
    const uid = b.studentUid;
    if (!byStudent[uid]) byStudent[uid] = { studentName: b.studentName, groupName: b.groupName, byMonth: {}, totalUnpaid: 0 };
    byStudent[uid].byMonth[b.yearMonth] = b;
    byStudent[uid].totalUnpaid += ((b.totalAmount || 0) - (b.paidAmount || 0));
  }

  // 정렬: 미수금 많은 순 → 이름순
  const studentRows = Object.entries(byStudent).map(([uid, s]) => ({ uid, ...s }));
  studentRows.sort((a, b) => (b.totalUnpaid - a.totalUnpaid) || (a.studentName || '').localeCompare(b.studentName || '', 'ko'));

  const monthShort = ym => parseInt(ym.split('-')[1]) + '월';

  // 채널 상태 아이콘: 항목 없으면 '-', 모두 paid '✅', 일부 paid '◐', 미납 '○'
  const channelIcon = (b, key) => {
    const items = (b?.items || []).filter(i => i.channel === key);
    if (items.length === 0) return '<span style="color:#ddd;">-</span>';
    const allPaid = items.every(i => i.paid);
    const somePaid = items.some(i => i.paid);
    if (allPaid) return '<span style="color:#15803d;font-weight:700;" title="입금 완료">✅</span>';
    if (somePaid) return '<span style="color:#ca8a04;font-weight:700;" title="부분 입금">◐</span>';
    return '<span style="color:#b91c1c;font-weight:700;" title="미납">○</span>';
  };

  const cellMonth = (b) => {
    if (!b) return `<td style="padding:8px;text-align:center;color:#ddd;font-size:12px;">-</td>`;
    const status = _billingComputeStatus(b);
    const bg = status === 'paid' ? 'rgba(34,197,94,0.05)' : status === 'overdue' ? 'rgba(220,38,38,0.06)' : status === 'partial' ? 'rgba(234,179,8,0.05)' : 'transparent';
    const remain = (b.totalAmount || 0) - (b.paidAmount || 0);
    return `<td style="padding:6px 8px;text-align:center;background:${bg};border-right:1px solid #f1f5f9;cursor:pointer;" onclick="_billingTimelineJump('${b.yearMonth}')" title="${b.yearMonth} 그리드로 이동">
      <div style="font-size:14px;line-height:1.2;">${channelIcon(b, 'tuition')}${matEnabled ? ' ' + channelIcon(b, 'materials') : ''}</div>
      <div style="font-size:10px;color:${remain>0?'#c2410c':'#15803d'};margin-top:2px;font-variant-numeric:tabular-nums;">${remain > 0 ? remain.toLocaleString() : '✓'}</div>
    </td>`;
  };

  main.innerHTML = `
    ${_billingTabsHtml()}
    <div class="card" style="padding:14px 18px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <select onchange="_billingChangeMonth(this.value)" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-weight:600;">
        ${_billingMonthOptions(_billingMonth)}
      </select>
      <span style="font-size:12px;color:var(--gray);">기준 월의 직전 3개월 표시 · 미수금 많은 순 정렬</span>
      <span style="margin-left:auto;font-size:11px;color:var(--gray);">
        ✅ 완료 ◐ 부분 ○ 미납 ${matEnabled ? '· 학원비 / 교재비 순' : ''}
      </span>
    </div>

    <div class="card" style="padding:0;overflow:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead style="position:sticky;top:0;background:#f8f9fa;z-index:5;">
          <tr style="border-bottom:2px solid var(--border);">
            <th style="padding:10px 12px;text-align:left;border-right:1px solid #e9ecef;min-width:100px;">학생</th>
            <th style="padding:10px 12px;text-align:left;border-right:1px solid #e9ecef;min-width:80px;">반</th>
            ${months.map(ym => `<th style="padding:10px 8px;text-align:center;border-right:1px solid #e9ecef;min-width:90px;${ym === _billingMonth?'background:rgba(13,148,136,0.06);':''}">${monthShort(ym)}${ym === _billingMonth?' <small style="font-weight:400;color:var(--gray);">(기준)</small>':''}</th>`).join('')}
            <th style="padding:10px 12px;text-align:right;min-width:100px;">3개월 미수</th>
          </tr>
        </thead>
        <tbody>
          ${studentRows.length === 0
            ? `<tr><td colspan="${3 + months.length}" style="padding:40px;text-align:center;color:#bbb;">최근 3개월 청구서가 없습니다.</td></tr>`
            : studentRows.map(s => `
              <tr style="border-bottom:1px solid #f1f5f9;${s.totalUnpaid > 0 ? 'background:rgba(255,165,100,0.03);' : ''}">
                <td style="padding:8px 12px;font-weight:600;border-right:1px solid #e9ecef;">${esc(s.studentName || '-')}</td>
                <td style="padding:8px 12px;color:var(--gray);font-size:12px;border-right:1px solid #e9ecef;">${esc(s.groupName || '-')}</td>
                ${months.map(ym => cellMonth(s.byMonth[ym])).join('')}
                <td style="padding:8px 12px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:${s.totalUnpaid>0?'#c2410c':'#15803d'};">${s.totalUnpaid > 0 ? s.totalUnpaid.toLocaleString() + '원' : '✓ 정상'}</td>
              </tr>`).join('')
          }
        </tbody>
      </table>
    </div>

    <div class="card" style="padding:12px 16px;margin-top:12px;font-size:11px;color:var(--gray);line-height:1.6;">
      💡 <b>학생별 미납 패턴</b> 한눈에 파악 — 매월 반복 미납인지, 일시적인지 판단 가능. 셀 클릭 시 해당 월 그리드로 이동.
    </div>`;
}

window._billingTimelineJump = async (ym) => {
  _billingMonth = ym;
  _billingTab = 'grid';
  await loadPayments();
};

// 채널 입금 일괄 토글 — 해당 채널 모든 항목 paid 변경
window._billingToggleChannel = async (billingId, channel, paid) => {
  try {
    const b = _billings.find(x => x.id === billingId);
    if (!b) return;
    const items = (b.items || []).map(i => {
      if (i.channel !== channel) return i;
      return { ...i, paid, paidAt: paid ? Date.now() : null };
    });
    const totalAmount = items.reduce((s, i) => s + (i.amount || 0), 0);
    const paidAmount = items.filter(i => i.paid).reduce((s, i) => s + (i.amount || 0), 0);
    const status = totalAmount === 0 ? 'paid' : (paidAmount >= totalAmount ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid'));
    // 메모리 캐시 즉시 반영 (b 는 _billingsByMonth reference) — Firestore eventual
    // consistency 회피: refetch=false 로 캐시만 렌더 (즉시 refetch 시 stale 로 체크 풀림)
    b.items = items; b.totalAmount = totalAmount; b.paidAmount = paidAmount; b.status = status;
    await updateDoc(doc(db, 'billings', billingId), { items, totalAmount, paidAmount, status, updatedAt: serverTimestamp() });
    await _renderBillingGrid(0, { refetch: false });
  } catch (e) { showAlert('저장 실패', e.message); }
};

// ── 항목 사이드 패널 (P1-6) ────────────────────────────
let _billingPanelId = null;
let _billingPanelChannel = null;
// 진행 중인 항목 update Promise 집합 — [✓ 완료] 클릭 시 끝까지 대기 후 그리드 새로고침
const _billingPending = new Set();
function _billingTrack(promise) {
  _billingPending.add(promise);
  promise.finally(() => _billingPending.delete(promise));
  return promise;
}

window._billingOpenItemPanel = async (billingId, channel) => {
  _billingPanelId = billingId;
  _billingPanelChannel = channel;
  _billingRenderItemPanel();
};

function _billingRenderItemPanel() {
  const b = _billings.find(x => x.id === _billingPanelId);
  if (!b) return;
  const items = (b.items || []).filter(i => i.channel === _billingPanelChannel);
  const channelLabel = _billingPanelChannel === 'tuition' ? '💳 학원 결제 (수강료 등)' : '📚 교재/시험비';
  const channelTotal = items.reduce((s, i) => s + (i.amount || 0), 0);

  const TYPE_OPTS = [
    ['tuition', '수강료'], ['book', '교재비'], ['test', '시험비'],
    ['uniform', '교복·체육복'], ['extra', '기타'],
  ];

  const itemHtml = items.length === 0
    ? `<div style="padding:40px;text-align:center;color:#bbb;font-size:13px;">항목이 없습니다.<br><span style="font-size:11px;">아래 [+ 항목 추가] 클릭</span></div>`
    : items.map((it, idx) => `
      <div style="padding:12px;background:#fafafa;border:1px solid var(--border);border-radius:8px;margin-bottom:10px;">
        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <select onchange="_billingUpdateItem('${it.itemId}','type',this.value)" style="padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px;width:90px;">
            ${TYPE_OPTS.map(([v, l]) => `<option value="${v}"${it.type === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
          <input type="text" value="${esc(it.label || '')}" placeholder="항목명"
            onblur="_billingUpdateItem('${it.itemId}','label',this.value)"
            style="flex:1;padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px;">
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="number" value="${it.amount || 0}" min="0" step="1000"
            onblur="_billingUpdateItem('${it.itemId}','amount',parseInt(this.value)||0)"
            style="flex:1;padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px;text-align:right;">
          <span style="font-size:11px;color:var(--gray);">원</span>
          <label style="display:flex;align-items:center;gap:3px;font-size:11px;cursor:pointer;">
            <input type="checkbox" ${it.paid ? 'checked' : ''}
              onchange="_billingUpdateItem('${it.itemId}','paid',this.checked)" style="width:14px;height:14px;">
            입금
          </label>
          <button class="action-btn danger" onclick="_billingDeleteItem('${it.itemId}')" style="padding:3px 7px;font-size:16px;line-height:1;">${iconSvg('trash')}</button>
        </div>
        <input type="text" value="${esc(it.memo || '')}" placeholder="메모 (선택)"
          onblur="_billingUpdateItem('${it.itemId}','memo',this.value)"
          style="width:100%;margin-top:6px;padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:11px;color:var(--gray);">
        ${it.paid && it.paidAt ? `<div style="font-size:10px;color:#15803d;margin-top:4px;">✓ ${new Date(it.paidAt).toLocaleDateString('ko-KR')} 입금</div>` : ''}
        ${it.addedBy === 'system' ? `<div style="font-size:10px;color:#bbb;margin-top:4px;">자동 생성 항목</div>` : ''}
      </div>`).join('');

  showModal(`
    <div style="width:min(440px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);">
        <div style="font-size:15px;font-weight:700;line-height:1.3;">${channelLabel}</div>
        <div style="font-size:11px;color:var(--gray);margin-top:2px;">${esc(b.studentName)} · ${b.yearMonth}</div>
      </div>
      <div style="padding:14px 20px;overflow-y:auto;flex:1;">
        ${itemHtml}
        <button class="btn btn-secondary" onclick="_billingAddItem()" style="width:100%;font-size:12px;padding:8px;">+ 항목 추가</button>
        <div style="margin-top:10px;padding:8px 12px;background:#f0fdfa;border-radius:6px;font-size:11px;color:#0d9488;line-height:1.5;">
          💡 <b>입력 후 다른 곳 클릭</b>하면 자동으로 저장됩니다. 항목 추가/금액/입금 체크는 모두 즉시 반영되어요.
        </div>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px;background:#f8fafc;">
        <div style="display:flex;flex-direction:column;">
          <span style="font-size:11px;color:var(--gray);">합계</span>
          <strong style="font-size:15px;">${channelTotal.toLocaleString()}원</strong>
        </div>
        <button class="btn btn-primary" onclick="_billingPanelDone()" style="font-size:13px;padding:8px 18px;">✓ 완료</button>
      </div>
    </div>
  `);
}

window._billingAddItem = async () => {
  const b = _billings.find(x => x.id === _billingPanelId);
  if (!b) return;
  return _billingTrack((async () => {
    try {
      const ch = _billingPanelChannel;
      const monthNum = parseInt((b.yearMonth || '').split('-')[1]);
      const newItem = {
        itemId: crypto.randomUUID ? crypto.randomUUID() : 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
        type: ch === 'tuition' ? 'tuition' : 'book',
        label: ch === 'tuition' ? `${monthNum}월 수강료` : '교재비',
        amount: 0,
        channel: ch,
        paid: false,
        paidAt: null,
        paidVia: '',
        memo: '',
        addedAt: Date.now(),
        addedBy: currentUser?.uid || 'manual',
      };
      const items = [...(b.items || []), newItem];
      const totalAmount = items.reduce((s, i) => s + (i.amount || 0), 0);
      const paidAmount = items.filter(i => i.paid).reduce((s, i) => s + (i.amount || 0), 0);
      const status = totalAmount === 0 ? 'paid' : (paidAmount >= totalAmount ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid'));
      await updateDoc(doc(db, 'billings', b.id), { items, totalAmount, paidAmount, status, updatedAt: serverTimestamp() });
      b.items = items; b.totalAmount = totalAmount; b.paidAmount = paidAmount; b.status = status;
      _billingRenderItemPanel();
    } catch (e) { showAlert('추가 실패', e.message); }
  })());
};

window._billingUpdateItem = async (itemId, field, value) => {
  const b = _billings.find(x => x.id === _billingPanelId);
  if (!b) return;
  return _billingTrack((async () => {
    try {
      const items = (b.items || []).map(i => {
        if (i.itemId !== itemId) return i;
        const updated = { ...i, [field]: value };
        if (field === 'paid') updated.paidAt = value ? Date.now() : null;
        return updated;
      });
      const totalAmount = items.reduce((s, i) => s + (i.amount || 0), 0);
      const paidAmount = items.filter(i => i.paid).reduce((s, i) => s + (i.amount || 0), 0);
      const status = totalAmount === 0 ? 'paid' : (paidAmount >= totalAmount ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid'));
      await updateDoc(doc(db, 'billings', b.id), { items, totalAmount, paidAmount, status, updatedAt: serverTimestamp() });
      b.items = items; b.totalAmount = totalAmount; b.paidAmount = paidAmount; b.status = status;
      _billingRenderItemPanel();
    } catch (e) { showAlert('저장 실패', e.message); }
  })());
};

// 완료 버튼 — 활성 input blur 강제 → 진행 중 저장 모두 끝까지 대기 → 그리드 직접 갱신 → 모달 닫기
//
// 주의: closeModal 이 라인 4960 에서 단순 정의로 다시 덮어씌워져 3134 의 wrapper hook
// (closeModal 후 _renderBillingGrid 호출) 이 작동 안 함. 그래서 여기서 직접 렌더.
window._billingPanelDone = async () => {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')) {
    active.blur();  // 펜딩 onblur 핸들러 발화 → _billingUpdateItem 호출 시작
  }
  // 다음 tick — blur 이벤트 핸들러가 _billingUpdateItem 을 호출해 _billingPending 에 담기게 함
  await new Promise(r => setTimeout(r, 0));
  // 진행 중인 모든 update/add/delete 완료 대기 (Firestore 응답 + in-memory 동기화 끝까지)
  while (_billingPending.size > 0) {
    await Promise.allSettled([..._billingPending]);
  }
  // 그리드 직접 갱신 (in-memory _billings 사용 — 방금 갱신됨)
  _billingPanelId = null;
  _billingPanelChannel = null;
  if (currentPage === 'payment') {
    await _renderBillingGrid(0, { refetch: false });
  }
  closeModal();
};

window._billingDeleteItem = async (itemId) => {
  if (!await showConfirm('항목 삭제', '이 항목을 삭제할까요?')) return;
  const b = _billings.find(x => x.id === _billingPanelId);
  if (!b) return;
  return _billingTrack((async () => {
    try {
      const items = (b.items || []).filter(i => i.itemId !== itemId);
      const totalAmount = items.reduce((s, i) => s + (i.amount || 0), 0);
      const paidAmount = items.filter(i => i.paid).reduce((s, i) => s + (i.amount || 0), 0);
      const status = totalAmount === 0 ? 'paid' : (paidAmount >= totalAmount ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid'));
      await updateDoc(doc(db, 'billings', b.id), { items, totalAmount, paidAmount, status, updatedAt: serverTimestamp() });
      b.items = items; b.totalAmount = totalAmount; b.paidAmount = paidAmount; b.status = status;
      _billingRenderItemPanel();
    } catch (e) { showAlert('삭제 실패', e.message); }
  })());
};

// 모달 닫힐 때 그리드 갱신 — closeModal 직접 hook 못 하므로, 사이드 패널 hide 시에 처리
// 임시: showModal/closeModal 패턴 그대로 사용. 항목 변경하면 _billings 캐시 업데이트되어 다음 그리드 렌더 때 반영.
// 명시적으로 갱신하려면 closeModal 후 _renderBillingGrid 호출 필요 — wrapper 추가.
// ── Phase 2: 학원장 안내 메시지 ──────────────────────────
// 학원 단위 템플릿 + placeholder 치환 — 한 번 편집하면 모든 학생에 적용.
// 학생별 데이터 ({학생명}/{월}/{청구내역}/{계좌정보}/{마감일}/{미납액}) 자동 치환.

// 기본 템플릿 — 인사말·서명은 일반 텍스트(자유 편집), 학생/금액/학원명만 chip
// 옛 customTemplates 의 {인사}/{서명} placeholder 도 호환 — vars 에서 빈 문자열로 무력화 X, 학원명만 inline
const _BILLING_DEFAULT_TEMPLATES = {
  polite: `안녕하세요, {학원명}입니다 :)
{학생명} 학생의 {월}월 결제 안내드립니다.

{청구내역}

납부일: {마감일}까지

감사합니다.`,
  brief: `[{학원명}]
{학생명} {월}월 청구

{청구내역}

{마감일}까지`,
  reminder: `안녕하세요, {학원명}입니다.
{학생명} 학생 {월}월 결제가 아직 확인되지 않아 다시 안내드립니다.

{청구내역}

이미 입금 완료하셨다면 확인 부탁드립니다.
입금 시점 알려주시면 감사하겠습니다.

감사합니다.`,
};

// 청구서 + settings + 채널 → placeholder 별 dynamic 데이터 반환
// {청구내역} 은 채널별 [구분선 + 라벨 + items + 계좌] 인라인 묶음 (학원비/교재비 시각 분리)
function _billingComputeVars(billing, settings, channels, academyName, template) {
  const fmt = n => (n || 0).toLocaleString();
  const monthNum = parseInt((billing.yearMonth || '').split('-')[1]);
  const studentName = billing.studentName || '학생';

  // 채널별 항목 그룹화 (reminder 시 paid 제외)
  const groups = {};
  for (const item of (billing.items || [])) {
    if (!channels.includes(item.channel)) continue;
    if (template === 'reminder' && item.paid) continue;
    (groups[item.channel] ??= []).push(item);
  }
  const channelCount = Object.keys(groups).length;

  // 청구내역 블록 — 채널별로 [라벨 / 항목 / 소계 / 계좌] 묶음
  const sections = [];
  for (const [chKey, items] of Object.entries(groups)) {
    const ch = chKey === 'tuition' ? settings?.tuitionChannel : settings?.materialsChannel;
    const emoji = chKey === 'tuition' ? '💳' : '📚';
    const label = ch?.label || (chKey === 'tuition' ? '학원 결제' : '교재/시험비');
    const lines = [];

    if (channelCount > 1) {
      if (template === 'brief') {
        lines.push(`[${label}]`);
      } else {
        lines.push('━━━━━━━━━━━━━━━━━━');
        lines.push(`${emoji} ${label}`);
        lines.push('━━━━━━━━━━━━━━━━━━');
      }
    }
    for (const item of items) {
      lines.push(`• ${item.label}  ${fmt(item.amount)}원`);
    }
    if (channelCount > 1 && template !== 'brief') {
      const subtotal = items.reduce((s, i) => s + (i.amount || 0), 0);
      lines.push(`   소계: ${fmt(subtotal)}원`);
    }
    // 채널 계좌 — 항목 바로 아래에 (학원비·교재비 각자 자기 계좌)
    if (ch) {
      if (ch.cardLink) lines.push(`💳 ${ch.cardLink}`);
      lines.push(`🏦 ${ch.bankName || ''} ${ch.bankAccount || ''} ${ch.accountHolder || ''}`.trim());
      if (ch.note && template !== 'brief') lines.push(`   ※ ${ch.note}`);
    }
    sections.push(lines.join('\n'));
  }

  // 다채널 합계 (brief 제외)
  let itemsBlock = sections.join('\n\n');
  if (channelCount > 1 && template !== 'brief') {
    const total = Object.values(groups).flat().reduce((s, i) => s + (i.amount || 0), 0);
    itemsBlock += '\n\n━━━━━━━━━━━━━━━━━━\n';
    itemsBlock += `합계: ${fmt(total)}원`;
  }

  // 마감일
  const dueDate = billing.dueDate?.toDate?.();
  const dueStr = dueDate ? `${dueDate.getMonth() + 1}월 ${dueDate.getDate()}일` : '';

  // 미납액
  const remain = (billing.totalAmount || 0) - (billing.paidAmount || 0);

  return {
    '{인사}': settings?.messageSettings?.greeting || `안녕하세요, ${academyName}입니다.`,
    '{서명}': settings?.messageSettings?.signature || '감사합니다.',
    '{학원명}': academyName,
    '{학생명}': studentName,
    '{월}': String(monthNum),
    '{청구내역}': itemsBlock,
    '{계좌정보}': '',  // deprecated — {청구내역} 안에 인라인됨. 옛 템플릿 호환용 빈 문자열
    '{마감일}': dueStr,
    '{미납액}': fmt(remain) + '원',
    '_hasItems': Object.keys(groups).length > 0,
  };
}

function _billingApplyTemplate(tpl, vars) {
  let result = tpl;
  for (const [key, val] of Object.entries(vars)) {
    if (key.startsWith('_')) continue;  // 내부 메타 제외
    result = result.split(key).join(val);  // global replace
  }
  return result;
}

// 메시지 빌더 — 학원 customTemplates 우선, 없으면 default
function _billingBuildMessage(billing, settings, template, channels, academyName) {
  const customTpl = settings?.messageSettings?.customTemplates?.[template];
  const tpl = customTpl || _BILLING_DEFAULT_TEMPLATES[template] || _BILLING_DEFAULT_TEMPLATES.polite;
  const vars = _billingComputeVars(billing, settings, channels, academyName, template);
  if (!vars._hasItems) return '_(선택된 항목이 없습니다)_';
  return _billingApplyTemplate(tpl, vars);
}

// 개별 메시지 모달
let _billingMsgState = null;  // { billingId, template, channels, customMessage }

window._billingOpenMessage = (billingId, defaultTemplate = 'polite') => {
  const b = _billings.find(x => x.id === billingId);
  if (!b) { showAlert('입력 확인', '청구서를 찾을 수 없습니다.'); return; }
  if (!_billingSettings) { showAlert('입력 확인', '결제 설정이 필요합니다.'); return; }
  const availChannels = [...new Set((b.items || []).map(i => i.channel))];
  if (availChannels.length === 0) { showAlert('입력 확인', '청구 항목이 없습니다.'); return; }
  _billingMsgState = {
    billingId,
    template: defaultTemplate,
    channels: availChannels.slice(),
    availChannels,
  };
  _billingRenderMessageModal();
};

function _billingRenderMessageModal() {
  const s = _billingMsgState;
  if (!s) return;
  const b = _billings.find(x => x.id === s.billingId);
  if (!b) return;
  const academy = window.MY_ACADEMY_NAME || window.adminProfile?.academyName || '학원';
  const msg = _billingBuildMessage(b, _billingSettings, s.template, s.channels, academy);
  const hasCustom = !!_billingSettings?.messageSettings?.customTemplates?.[s.template];

  // 일괄 모드
  const isBulk = !!_billingBulkQueue;
  const bulkProgress = isBulk
    ? `<div style="display:inline-block;padding:3px 10px;background:var(--teal-light);color:var(--teal-dark);border-radius:12px;font-size:11px;font-weight:700;margin-bottom:6px;">${_billingBulkCurrentIdx} / ${_billingBulkTotal}</div>`
    : '';

  // 템플릿 탭 — 학원 커스텀 적용된 탭에 ✏️ 배지
  const tabBtn = (key, icon, label) => {
    const isActive = s.template === key;
    const tplHasCustom = !!_billingSettings?.messageSettings?.customTemplates?.[key];
    return `
      <button onclick="_billingMsgChangeTpl('${key}')" style="padding:6px 12px;border:1px solid var(--border);background:${isActive ? 'var(--teal)' : 'white'};color:${isActive ? 'white' : 'var(--text)'};border-radius:6px;font-size:12px;font-weight:${isActive ? '700' : '500'};cursor:pointer;">
        ${icon} ${label}${tplHasCustom ? ` <span style="font-size:9px;opacity:0.85;">${iconSvg('edit')}</span>` : ''}
      </button>`;
  };

  const chCheck = (key, icon, label) => {
    const avail = s.availChannels.includes(key);
    const checked = s.channels.includes(key);
    return `
      <label style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:#f8fafc;border-radius:6px;cursor:${avail ? 'pointer' : 'not-allowed'};opacity:${avail ? 1 : 0.4};font-size:12px;">
        <input type="checkbox" ${checked ? 'checked' : ''} ${avail ? '' : 'disabled'}
          onchange="_billingMsgToggleCh('${key}',this.checked)" style="width:14px;height:14px;">
        ${icon} ${label}
      </label>`;
  };

  const customNotice = hasCustom
    ? `<div style="padding:6px 10px;background:#ecfeff;border-radius:5px;font-size:11px;color:#0e7490;margin-bottom:8px;">${iconSvg('edit')} 학원에서 편집한 템플릿이 적용됨 — 모든 학생에 동일.</div>`
    : '';

  const footerHtml = isBulk
    ? `<button class="btn btn-secondary" onclick="_billingBulkSkip()" style="font-size:12px;">⏭ 건너뛰기</button>
       <button class="btn btn-primary" onclick="_billingCopyMessage()" style="font-size:13px;font-weight:700;">${iconSvg('clipboard')} 복사 후 다음 →</button>`
    : `<button class="btn btn-secondary" onclick="_billingOpenTemplateEditor('${s.template}')" style="font-size:12px;" title="모든 학생에게 적용되는 템플릿 편집">⚙️ 템플릿 편집</button>
       <button class="btn btn-secondary" onclick="closeModal()" style="font-size:12px;">닫기</button>
       <button class="btn btn-primary" onclick="_billingCopyMessage()" style="font-size:13px;font-weight:700;">${iconSvg('clipboard')} 복사하기</button>`;

  showModal(`
    <div style="width:min(560px,92vw);max-height:90vh;display:flex;flex-direction:column;">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);">
        ${bulkProgress}
        <div style="font-size:15px;font-weight:700;line-height:1.3;">📨 학원장 안내 메시지</div>
        <div style="font-size:11px;color:var(--gray);margin-top:2px;">${esc(b.studentName)} · ${b.yearMonth}</div>
      </div>
      <div style="padding:14px 20px;overflow-y:auto;flex:1;">
        <div style="display:flex;gap:6px;margin-bottom:10px;">
          ${tabBtn('polite', '🙏', '정중')}
          ${tabBtn('brief', '📋', '간결')}
          ${tabBtn('reminder', '⚠️', '미납 안내')}
        </div>
        <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
          ${chCheck('tuition', '💳', '학원 결제')}
          ${_billingSettings?.materialsChannel?.enabled ? chCheck('materials', '📚', '교재/시험비') : ''}
          <span style="font-size:10px;color:#bbb;align-self:center;">체크 해제 시 해당 채널 제외</span>
        </div>
        ${customNotice}
        <textarea id="billingMsgPreview" rows="14" readonly
          style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;line-height:1.6;font-family:'Noto Sans KR','Pretendard',sans-serif;resize:vertical;box-sizing:border-box;background:#fafafa;">${esc(msg)}</textarea>
        <div style="margin-top:6px;font-size:11px;color:var(--gray);">
          <span>${msg.length}</span>자 ·
          <span style="color:#bbb;">학생 데이터 자동 적용 · 인사말·문구 변경은 [⚙️ 템플릿 편집] 으로 학원 전체 통일.</span>
        </div>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        ${footerHtml}
      </div>
    </div>
  `);
}

window._billingMsgChangeTpl = (tpl) => {
  if (!_billingMsgState) return;
  _billingMsgState.template = tpl;
  _billingRenderMessageModal();
};

window._billingMsgToggleCh = (ch, on) => {
  if (!_billingMsgState) return;
  if (on && !_billingMsgState.channels.includes(ch)) _billingMsgState.channels.push(ch);
  if (!on) _billingMsgState.channels = _billingMsgState.channels.filter(c => c !== ch);
  _billingRenderMessageModal();
};

window._billingCopyMessage = async () => {
  const ta = document.getElementById('billingMsgPreview');
  if (!ta) return;
  try {
    await navigator.clipboard.writeText(ta.value);
    showToast('✅ 복사됐어요! 카톡에 붙여넣으세요.');
    // 발송 이력만 기록 (학생별 편집본 저장은 폐기 — 학원 templateEditor 로 일원화)
    if (_billingMsgState?.billingId) {
      try {
        await updateDoc(doc(db, 'billings', _billingMsgState.billingId), {
          lastMessageSentAt: serverTimestamp(),
          messagesSentCount: increment(1),
        });
      } catch (_) {}
    }
    if (_billingBulkQueue) {
      setTimeout(() => _billingBulkNext(), 400);
    }
  } catch (e) {
    showAlert('복사 실패', '브라우저 권한 또는 https 환경 확인 — 직접 드래그해서 복사하세요.');
  }
};

// ── 학원 단위 템플릿 편집기 (모든 학생에 적용) ──────────
// UX: 양쪽 다 sample 학생으로 렌더한 형태 표시 (placeholder 안 보임)
//   좌: 편집 가능한 현재 템플릿 (학원 커스텀이 있으면 그것, 없으면 기본값)
//   우: 기본값 read-only (참고용 비교)
//   저장 시 좌측 텍스트의 sample 값을 placeholder 로 reverse-mapping → 템플릿 저장
let _billingTplEditState = null;

window._billingOpenTemplateEditor = (initialTpl = 'polite') => {
  if (!_billingSettings) { showAlert('입력 확인', '결제 설정이 필요합니다.'); return; }
  _billingTplEditState = {
    template: initialTpl,
    // 편집 중인 텍스트 (rendered form). 탭 전환 시 보존.
    drafts: { polite: null, brief: null, reminder: null },
  };
  _billingRenderTemplateEditor();
};

// sample billing — 첫 청구서가 있으면 사용, 없으면 가짜 데이터
function _billingSampleData() {
  const matEnabled = !!_billingSettings?.materialsChannel?.enabled;
  const today = new Date();
  const dueDate = new Date(today.getFullYear(), today.getMonth(), 15);
  const items = [{ itemId: 's1', label: `${today.getMonth()+1}월 수강료`, amount: 200000, channel: 'tuition', paid: false, addedBy: 'system' }];
  if (matEnabled) items.push({ itemId: 's2', label: '교재', amount: 30000, channel: 'materials', paid: false, addedBy: 'system' });
  const total = items.reduce((s,i)=>s+i.amount, 0);
  return {
    studentName: '홍길동',
    yearMonth: _ymdKST().slice(0,7),
    items,
    totalAmount: total,
    paidAmount: 0,
    dueDate: { toDate: () => dueDate },
  };
}

// drafts[k] 는 템플릿(placeholder 그대로). 렌더 시점에 chip HTML 로 변환.
function _billingTplCurrentTemplate(tplKey) {
  if (_billingTplEditState?.drafts[tplKey] != null) return _billingTplEditState.drafts[tplKey];
  const stored = _billingSettings?.messageSettings?.customTemplates?.[tplKey];
  return stored || _BILLING_DEFAULT_TEMPLATES[tplKey];
}

function _billingTplSampleVars(tplKey) {
  const sample = _billingSampleData();
  const academy = window.MY_ACADEMY_NAME || window.adminProfile?.academyName || '○○ 영어학원';
  const channels = sample.items.map(i => i.channel).filter((v,i,a) => a.indexOf(v) === i);
  return _billingComputeVars(sample, _billingSettings, channels, academy, tplKey);
}

// template + sampleVars → chip 이 박힌 HTML
const _BILLING_BLOCK_PLACEHOLDERS = ['{청구내역}', '{계좌정보}'];
function _billingTplApplyAsChips(template, vars) {
  const re = /\{[^}]+\}/g;
  let out = '';
  let lastIdx = 0;
  let m;
  const baseStyle = 'background:#fef3c7;color:#92400e;border:1px dashed #f59e0b;border-radius:3px;padding:1px 5px;font-weight:500;cursor:not-allowed;user-select:none;';
  while ((m = re.exec(template)) !== null) {
    const ph = m[0];
    if (m.index > lastIdx) {
      out += esc(template.slice(lastIdx, m.index)).replace(/\n/g, '<br>');
    }
    if (Object.prototype.hasOwnProperty.call(vars, ph) && vars[ph] != null) {
      const value = String(vars[ph]);
      const isBlock = _BILLING_BLOCK_PLACEHOLDERS.includes(ph);
      const safeValue = esc(value).replace(/\n/g, '<br>');
      const style = isBlock
        ? baseStyle + 'display:block;margin:4px 0;padding:6px 8px;white-space:pre-wrap;'
        : baseStyle + 'display:inline-block;';
      out += `<span class="data-chip" contenteditable="false" data-ph="${esc(ph)}" style="${style}">${safeValue}</span>`;
    } else {
      out += esc(ph);
    }
    lastIdx = m.index + ph.length;
  }
  if (lastIdx < template.length) {
    out += esc(template.slice(lastIdx)).replace(/\n/g, '<br>');
  }
  return out;
}

// contenteditable DOM → 템플릿 (chip 은 data-ph 로 환원)
function _billingTplExtractTemplate(rootEl) {
  let out = '';
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === 'BR') { out += '\n'; return; }
    if (node.classList && node.classList.contains('data-chip')) {
      out += node.getAttribute('data-ph') || '';
      return;
    }
    const isBlock = (tag === 'DIV' || tag === 'P');
    if (isBlock && out.length > 0 && !out.endsWith('\n')) out += '\n';
    for (const child of node.childNodes) walk(child);
  };
  for (const child of rootEl.childNodes) walk(child);
  return out;
}

function _billingRenderTemplateEditor() {
  const s = _billingTplEditState;
  if (!s) return;
  const currentTpl = _billingTplCurrentTemplate(s.template);
  const defaultTpl = _BILLING_DEFAULT_TEMPLATES[s.template];
  const vars = _billingTplSampleVars(s.template);
  const currentHtml = _billingTplApplyAsChips(currentTpl, vars);
  const defaultHtml = _billingTplApplyAsChips(defaultTpl, vars);
  const stored = _billingSettings?.messageSettings?.customTemplates?.[s.template];
  const isCust = !!stored || (s.drafts[s.template] != null && s.drafts[s.template] !== defaultTpl);

  const tabBtn = (key, icon, label) => {
    const isActive = s.template === key;
    const tplCust = !!_billingSettings?.messageSettings?.customTemplates?.[key];
    const draftDirty = s.drafts[key] != null && s.drafts[key] !== _BILLING_DEFAULT_TEMPLATES[key];
    return `<button onclick="_billingTplChangeTab('${key}')" style="padding:6px 12px;border:1px solid var(--border);background:${isActive ? 'var(--teal)' : 'white'};color:${isActive ? 'white' : 'var(--text)'};border-radius:6px;font-size:12px;font-weight:${isActive ? '700' : '500'};cursor:pointer;">${icon} ${label}${(tplCust || draftDirty) ? ` <span style="font-size:9px;opacity:0.85;">${iconSvg('edit')}</span>` : ''}</button>`;
  };

  showModal(`
    <div style="width:min(880px,96vw);max-height:92vh;display:flex;flex-direction:column;">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);">
        <div style="font-size:15px;font-weight:700;line-height:1.3;">⚙️ 메시지 템플릿 편집 — 학원 전체 적용</div>
        <div style="font-size:11px;color:var(--gray);margin-top:2px;">노란색 영역(데이터)은 학생별로 자동 교체됩니다. 그 외 인사말·문구만 자유롭게 수정하세요.</div>
      </div>
      <div style="padding:14px 20px;overflow-y:auto;flex:1;">
        <div style="display:flex;gap:6px;margin-bottom:14px;">
          ${tabBtn('polite', '🙏', '정중')}
          ${tabBtn('brief', '📋', '간결')}
          ${tabBtn('reminder', '⚠️', '미납 안내')}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
              <span style="font-size:12px;font-weight:600;">${iconSvg('edit')} 내가 쓸 메시지 ${isCust ? '<span style="color:#0d9488;font-weight:400;">(편집됨)</span>' : '<span style="color:#bbb;font-weight:400;">(기본값)</span>'}</span>
              ${isCust ? `<button onclick="_billingTplResetCurrent()" style="padding:3px 8px;background:white;color:#dc2626;border:1px solid var(--border);border-radius:4px;font-size:10px;cursor:pointer;">↺ 기본값으로</button>` : ''}
            </div>
            <div id="billingTplDraft" contenteditable="true"
              oninput="_billingTplOnEditorInput()"
              onpaste="_billingTplOnPaste(event)"
              style="width:100%;min-height:430px;max-height:60vh;padding:10px 12px;border:2px solid var(--teal);border-radius:6px;font-size:12px;line-height:1.7;font-family:'Noto Sans KR','Pretendard',sans-serif;box-sizing:border-box;background:#fefefe;overflow-y:auto;outline:none;">${currentHtml}</div>
            <div style="font-size:11px;color:var(--gray);margin-top:5px;line-height:1.5;">
              💡 <span style="background:#fef3c7;color:#92400e;border:1px dashed #f59e0b;border-radius:3px;padding:0 4px;">노란색 데이터</span> 영역은 클릭/수정 불가 — 학생별 정보가 자동 들어갑니다.
            </div>
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;margin-bottom:5px;color:var(--gray);">📄 기본값 (참고)</div>
            <div style="padding:10px 12px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;line-height:1.7;background:#f8fafc;min-height:430px;max-height:60vh;overflow-y:auto;font-family:'Noto Sans KR','Pretendard',sans-serif;">${defaultHtml}</div>
            <div style="font-size:11px;color:#bbb;margin-top:5px;">↻ 기본값을 그대로 쓰고 싶으면 왼쪽도 동일하게.</div>
          </div>
        </div>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()" style="font-size:12px;">취소</button>
        <button class="btn btn-primary" onclick="_billingTplSaveAll()" style="font-size:13px;font-weight:700;">${iconSvg('save')} 모든 학생에 적용</button>
      </div>
    </div>
  `);
}

window._billingTplOnEditorInput = () => {
  if (!_billingTplEditState) return;
  const editor = document.getElementById('billingTplDraft');
  if (!editor) return;
  _billingTplEditState.drafts[_billingTplEditState.template] = _billingTplExtractTemplate(editor);
};

window._billingTplOnPaste = (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  if (text) document.execCommand('insertText', false, text);
};

window._billingTplChangeTab = (tpl) => {
  if (!_billingTplEditState) return;
  // 현재 에디터 상태 한 번 더 sync
  const editor = document.getElementById('billingTplDraft');
  if (editor) _billingTplEditState.drafts[_billingTplEditState.template] = _billingTplExtractTemplate(editor);
  _billingTplEditState.template = tpl;
  _billingRenderTemplateEditor();
};

window._billingTplResetCurrent = async () => {
  if (!_billingTplEditState) return;
  if (!await showConfirm('기본값 복원', `'${_billingTplEditState.template}' 템플릿을 기본값으로 되돌릴까요?\n저장 시 학원 커스텀이 삭제됩니다.`)) return;
  _billingTplEditState.drafts[_billingTplEditState.template] = _BILLING_DEFAULT_TEMPLATES[_billingTplEditState.template];
  _billingRenderTemplateEditor();
};

window._billingTplSaveAll = async () => {
  if (!_billingTplEditState) return;
  const editor = document.getElementById('billingTplDraft');
  if (editor) _billingTplEditState.drafts[_billingTplEditState.template] = _billingTplExtractTemplate(editor);

  const custom = {};
  for (const k of ['polite', 'brief', 'reminder']) {
    const draft = _billingTplEditState.drafts[k];
    if (draft == null) continue;
    if (draft === _BILLING_DEFAULT_TEMPLATES[k]) continue; // 기본값과 동일 → 커스텀 X
    custom[k] = draft;
  }

  try {
    await updateDoc(doc(db, 'academies', window.MY_ACADEMY_ID || 'default'), {
      'paymentSettings.messageSettings.customTemplates': custom,
    });
    if (_billingSettings) {
      _billingSettings.messageSettings = _billingSettings.messageSettings || {};
      _billingSettings.messageSettings.customTemplates = custom;
    }
    closeModal();
    showToast('✅ 모든 학생에 적용됐어요!');
  } catch (e) {
    showAlert('저장 실패', e.message);
  }
};

// 미납자 일괄 메시지 — 카드 슬라이드 흐름
let _billingBulkQueue = null;       // [billingId, ...]
let _billingBulkTotal = 0;
let _billingBulkCurrentIdx = 0;     // 현재 진행 인덱스 (1부터)

window._billingOpenBulkMessage = () => {
  // 미납·부분·연체 학생 추출
  const targets = _billings.filter(b => {
    const st = _billingComputeStatus(b);
    return st === 'unpaid' || st === 'partial' || st === 'overdue';
  });
  if (targets.length === 0) {
    showAlert('입력 확인', '미납·연체 청구서가 없습니다.');
    return;
  }

  const list = targets.map(b => {
    const st = _billingComputeStatus(b);
    const remain = (b.totalAmount || 0) - (b.paidAmount || 0);
    const stLabel = st === 'overdue' ? '⚠️ 연체' : st === 'partial' ? '◐ 부분' : '○ 미납';
    const stColor = st === 'overdue' ? '#b91c1c' : st === 'partial' ? '#ca8a04' : '#475569';
    const lastSent = b.lastMessageSentAt?.toDate?.();
    const lastStr = lastSent ? `최근 발송 ${Math.round((Date.now() - lastSent.getTime()) / 86400000)}일 전` : '미발송';
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;cursor:pointer;background:white;margin-bottom:6px;">
        <input type="checkbox" data-id="${b.id}" checked style="width:16px;height:16px;">
        <div style="flex:1;">
          <div style="font-weight:600;font-size:13px;">${esc(b.studentName)} <span style="color:var(--gray);font-size:11px;font-weight:400;">${esc(b.groupName || '')}</span></div>
          <div style="font-size:11px;color:var(--gray);margin-top:2px;">${remain.toLocaleString()}원 미입금 · ${lastStr}</div>
        </div>
        <span style="font-size:11px;font-weight:600;color:${stColor};">${stLabel}</span>
      </label>`;
  }).join('');

  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);">
        <div style="font-size:15px;font-weight:700;">📨 미납자 일괄 메시지</div>
        <div style="font-size:11px;color:var(--gray);margin-top:2px;">대상 ${targets.length}명 — 체크 해제로 제외</div>
      </div>
      <div style="padding:14px 20px;overflow-y:auto;flex:1;background:#f8fafc;">
        <div style="margin-bottom:8px;display:flex;gap:6px;">
          <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="document.querySelectorAll('#bulkList input[type=checkbox]').forEach(c=>c.checked=true)">전체 선택</button>
          <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="document.querySelectorAll('#bulkList input[type=checkbox]').forEach(c=>c.checked=false)">전체 해제</button>
        </div>
        <div id="bulkList">${list}</div>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()" style="font-size:12px;">취소</button>
        <button class="btn btn-primary" onclick="_billingBulkStart()" style="font-size:13px;font-weight:700;">📨 선택한 학생 메시지 만들기 →</button>
      </div>
    </div>
  `);
};

window._billingBulkStart = () => {
  const ids = Array.from(document.querySelectorAll('#bulkList input[type=checkbox]:checked'))
    .map(cb => cb.getAttribute('data-id'));
  if (ids.length === 0) { showAlert('입력 확인', '학생을 선택하세요.'); return; }
  _billingBulkQueue = ids.slice();
  _billingBulkTotal = ids.length;
  _billingBulkCurrentIdx = 0;
  closeModal();
  setTimeout(() => _billingBulkNext(), 200);
};

window._billingBulkNext = () => {
  if (!_billingBulkQueue) return;
  if (_billingBulkQueue.length === 0) {
    _billingBulkQueue = null;
    _billingBulkTotal = 0;
    _billingBulkCurrentIdx = 0;
    showAlert('완료', `메시지 복사를 마쳤어요.`);
    if (currentPage === 'payment') _renderBillingGrid();
    return;
  }
  const id = _billingBulkQueue.shift();
  _billingBulkCurrentIdx = _billingBulkTotal - _billingBulkQueue.length;
  // 미납 안내 템플릿 자동 적용. _billingRenderMessageModal 가 _billingBulkQueue 감지해서 진행 배지·푸터 자동 처리
  _billingOpenMessage(id, 'reminder');
};

window._billingBulkSkip = () => {
  // 현재 모달 안 닫고 바로 다음 학생으로 (showModal 이 내용 교체)
  setTimeout(() => _billingBulkNext(), 100);
};

const _origCloseModal = window.closeModal;
window.closeModal = function() {
  const wasBillingPanel = _billingPanelId !== null;
  const wasBillingMsg = _billingMsgState !== null;
  if (typeof _origCloseModal === 'function') _origCloseModal();
  if (wasBillingPanel) {
    _billingPanelId = null;
    _billingPanelChannel = null;
    // refetch:false — 패널에서 in-memory _billings 이미 갱신됨. Firestore 재fetch 시
    // eventual consistency 로 stale 데이터가 올 수 있어 캐시 그대로 사용.
    if (currentPage === 'payment') _renderBillingGrid(0, { refetch: false });
  }
  if (wasBillingMsg) {
    _billingMsgState = null;
    // 모달 닫음 = bulk 도 중단
    if (_billingBulkQueue) {
      _billingBulkQueue = null;
      _billingBulkTotal = 0;
      _billingBulkCurrentIdx = 0;
      if (currentPage === 'payment') _renderBillingGrid();
    }
  }
  // 템플릿 편집기 state 클리어
  if (_billingTplEditState) _billingTplEditState = null;
};

// 이번 달 청구서 자동 생성 (lazy) — active + tuitionPlan.amount > 0 학생 대상
// 이미 생성된 학생은 skip (idempotent)
// 반환: 새로 생성된 건수
async function _ensureCurrentMonthBillings() {
  try {
    const academyId = window.MY_ACADEMY_ID || 'default';
    const ym = _ymdKST().slice(0, 7);  // KST YYYY-MM

    // 1) active 학생 조회
    const studentsSnap = await getDocs(query(
      collection(db, 'users'),
      where('academyId', '==', academyId),
      where('role', '==', 'student'),
      where('status', '==', 'active'),
    ));

    // 2) 이번 달 이미 생성된 청구서 조회
    const existingSnap = await getDocs(query(
      collection(db, 'billings'),
      where('academyId', '==', academyId),
      where('yearMonth', '==', ym),
    ));
    const existingUids = new Set(existingSnap.docs.map(d => d.data().studentUid));

    // 3) 누락된 학생만 생성
    let created = 0;
    // 0 || 15 함정 회피 — -1 (말일) 도 정상값. isFinite + 범위 체크.
    const rawDD = _billingSettings?.defaultDueDay;
    const defaultDueDay = (isFinite(rawDD) && (rawDD === -1 || (rawDD >= 1 && rawDD <= 31))) ? rawDD : 15;
    const monthNum = parseInt(ym.split('-')[1]);

    for (const sDoc of studentsSnap.docs) {
      const s = sDoc.data();
      const uid = sDoc.id;
      if (existingUids.has(uid)) continue;
      if (!s.tuitionPlan?.active) continue;
      const amount = parseInt(s.tuitionPlan.amount) || 0;
      if (amount <= 0) continue;

      // 납부일 결정 — 학생 dueDay > 학원 default. -1 = 말일
      let dueDay = parseInt(s.tuitionPlan.dueDay);
      if (!isFinite(dueDay) || dueDay === 0) dueDay = defaultDueDay;
      const [y, mm] = ym.split('-').map(Number);
      const lastDay = new Date(y, mm, 0).getDate();
      const actualDay = (dueDay === -1) ? lastDay : Math.min(Math.max(1, dueDay), lastDay);
      const dueDate = new Date(y, mm - 1, actualDay);

      await addDoc(collection(db, 'billings'), {
        academyId,
        studentUid: uid,
        studentName: s.name || '',
        groupId: '',
        groupName: s.group || '',
        yearMonth: ym,
        dueDate,
        items: [{
          itemId: crypto.randomUUID ? crypto.randomUUID() : 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
          type: 'tuition',
          label: `${monthNum}월 수강료`,
          amount,
          channel: 'tuition',
          paid: false,
          paidAt: null,
          paidVia: '',
          memo: '',
          addedAt: Date.now(),  // serverTimestamp 는 array 안에서 작동 X
          addedBy: 'system',
        }],
        totalAmount: amount,
        paidAmount: 0,
        status: 'unpaid',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        generatedBy: 'auto',
        lastMessageSentAt: null,
        messagesSentCount: 0,
        memo: '',
      });
      created++;
    }
    // 새 billing 생성 시 그 월 캐시 무효화 (다음 _renderBillingGrid 가 fresh fetch)
    if (created > 0 && typeof _billingInvalidateCache === 'function') _billingInvalidateCache(ym);
    return created;
  } catch (e) {
    console.warn('[ensureCurrentMonthBillings]', e.message);
    return 0;
  }
}

// ── 결제 설정 마법사 (2 step) ──────────────────────────
window.openPaymentSettingsWizard = () => {
  _billingWizardStep = 1;
  _billingWizardData = {};
  // 기존 설정 prefill
  const existing = _billingSettings || {};
  // -1 (말일) 도 정상값. || 함정 회피 — isFinite + 범위 검증
  const eDD = existing.defaultDueDay;
  _billingWizardData = {
    defaultDueDay: (isFinite(eDD) && (eDD === -1 || (eDD >= 1 && eDD <= 31))) ? eDD : 15,
    tuition: { ...(existing.tuitionChannel || {}) },
    materialsEnabled: existing.materialsChannel?.enabled || false,
    materials: { ...(existing.materialsChannel || {}) },
  };
  _renderBillingWizard();
};

function _renderBillingWizard() {
  if (_billingWizardStep === 1) {
    _renderWizardStep1();
  } else {
    _renderWizardStep2();
  }
}

function _renderWizardStep1() {
  const d = _billingWizardData;
  const t = d.tuition || {};
  const bankOpts = ['<option value="">선택</option>',
    ..._BILLING_BANKS.map(b => `<option value="${b}"${t.bankName === b ? ' selected' : ''}>${b}</option>`)
  ].join('');
  const dueDayOpts = [
    `<option value="-1"${d.defaultDueDay === -1 ? ' selected' : ''}>말일</option>`,
    ...Array.from({length: 31}, (_, i) => i + 1).map(n =>
      `<option value="${n}"${d.defaultDueDay === n ? ' selected' : ''}>${n}일</option>`
    )
  ].join('');

  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">결제 설정 (1/2)</div>
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">💳 수강료를 받을 계좌를 알려주세요</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="display:flex;flex-direction:column;gap:14px;font-size:13px;">
          <div>
            <label style="color:var(--gray);font-size:12px;display:block;margin-bottom:5px;">카드 결제 링크 <span style="color:#bbb;font-weight:400;">(선택)</span></label>
            <input id="wizCardLink" type="text" value="${esc(t.cardLink || '')}" placeholder="https://gyul.com/p/..." style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box;">
            <div style="font-size:10px;color:#bbb;margin-top:3px;">결제선생, 토스 결제링크 등 사용 중이면 입력</div>
          </div>
          <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;">
            <div>
              <label style="color:var(--gray);font-size:12px;display:block;margin-bottom:5px;">은행 *</label>
              <select id="wizBankName" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${bankOpts}</select>
            </div>
            <div>
              <label style="color:var(--gray);font-size:12px;display:block;margin-bottom:5px;">계좌번호 *</label>
              <input id="wizBankAccount" type="text" value="${esc(t.bankAccount || '')}" placeholder="123-4567-8901" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box;">
            </div>
          </div>
          <div>
            <label style="color:var(--gray);font-size:12px;display:block;margin-bottom:5px;">예금주 *</label>
            <input id="wizAccountHolder" type="text" value="${esc(t.accountHolder || '')}" placeholder="○○영어학원" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box;">
          </div>
          <div>
            <label style="color:var(--gray);font-size:12px;display:block;margin-bottom:5px;">매월 기본 납부일 *</label>
            <select id="wizDueDay" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${dueDayOpts}</select>
            <div style="font-size:10px;color:#bbb;margin-top:3px;">학생별 다른 날짜로 변경 가능 (다음 단계에서 학생 등록 시)</div>
          </div>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">나중에</button>
        <button class="btn btn-primary" onclick="_billingWizardNext()">다음 →</button>
      </div>
    </div>
  `);
}

window._billingWizardNext = () => {
  // Step 1 검증 + 임시 저장
  const bankName = document.getElementById('wizBankName').value;
  const bankAccount = document.getElementById('wizBankAccount').value.trim();
  const accountHolder = document.getElementById('wizAccountHolder').value.trim();
  const dueDay = parseInt(document.getElementById('wizDueDay').value);
  const cardLink = document.getElementById('wizCardLink').value.trim();

  if (!bankName || !bankAccount || !accountHolder) {
    showAlert('입력 확인', '은행·계좌번호·예금주를 모두 입력하세요.');
    return;
  }
  _billingWizardData.tuition = { cardLink, bankName, bankAccount, accountHolder };
  _billingWizardData.defaultDueDay = isFinite(dueDay) ? dueDay : 15;
  _billingWizardStep = 2;
  _renderWizardStep2();
};

window._billingWizardBack = () => {
  _billingWizardStep = 1;
  _renderWizardStep1();
};

function _renderWizardStep2() {
  const d = _billingWizardData;
  const m = d.materials || {};
  const enabled = !!d.materialsEnabled;
  const bankOpts = ['<option value="">선택</option>',
    ..._BILLING_BANKS.map(b => `<option value="${b}"${m.bankName === b ? ' selected' : ''}>${b}</option>`)
  ].join('');

  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">결제 설정 (2/2)</div>
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">📚 교재비·시험비는 별도 계좌로 받으시나요?</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="padding:12px 14px;background:#fff8e1;border-radius:8px;border:1px solid #ffe082;font-size:12px;color:#7a5a00;line-height:1.6;margin-bottom:18px;">
          💡 한국 학원에서는 교재 판매가 제한되어 원장 개인 계좌로 별도 받는 경우가 많습니다.
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;">
          <label style="display:flex;gap:10px;padding:14px;border:2px solid ${!enabled ? 'var(--teal)' : 'var(--border)'};border-radius:10px;cursor:pointer;background:${!enabled ? 'var(--teal-light)' : 'white'};">
            <input type="radio" name="wizUseMat" value="no" ${!enabled ? 'checked' : ''} onchange="_billingWizardToggleMat(false)" style="margin-top:2px;">
            <div>
              <div style="font-weight:700;">같은 계좌로 받음</div>
              <div style="font-size:11px;color:var(--gray);margin-top:2px;">모든 비용을 학원 계좌 하나로</div>
            </div>
          </label>
          <label style="display:flex;gap:10px;padding:14px;border:2px solid ${enabled ? 'var(--teal)' : 'var(--border)'};border-radius:10px;cursor:pointer;background:${enabled ? 'var(--teal-light)' : 'white'};">
            <input type="radio" name="wizUseMat" value="yes" ${enabled ? 'checked' : ''} onchange="_billingWizardToggleMat(true)" style="margin-top:2px;">
            <div>
              <div style="font-weight:700;">별도 계좌로 받음</div>
              <div style="font-size:11px;color:var(--gray);margin-top:2px;">원장 개인 계좌 등으로 분리</div>
            </div>
          </label>
        </div>
        <div id="wizMatFields" style="display:${enabled ? 'flex' : 'none'};flex-direction:column;gap:14px;margin-top:18px;padding-top:18px;border-top:1px solid var(--border);font-size:13px;">
          <div>
            <label style="color:var(--gray);font-size:12px;display:block;margin-bottom:5px;">카드 결제 링크 <span style="color:#bbb;font-weight:400;">(선택)</span></label>
            <input id="wizMatCardLink" type="text" value="${esc(m.cardLink || '')}" placeholder="https://..." style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box;">
          </div>
          <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;">
            <div>
              <label style="color:var(--gray);font-size:12px;display:block;margin-bottom:5px;">은행 *</label>
              <select id="wizMatBankName" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${bankOpts}</select>
            </div>
            <div>
              <label style="color:var(--gray);font-size:12px;display:block;margin-bottom:5px;">계좌번호 *</label>
              <input id="wizMatBankAccount" type="text" value="${esc(m.bankAccount || '')}" placeholder="123-456-789012" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box;">
            </div>
          </div>
          <div>
            <label style="color:var(--gray);font-size:12px;display:block;margin-bottom:5px;">예금주 *</label>
            <input id="wizMatAccountHolder" type="text" value="${esc(m.accountHolder || '')}" placeholder="홍길동 (원장 개인)" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box;">
          </div>
          <div>
            <label style="color:var(--gray);font-size:12px;display:block;margin-bottom:5px;">안내 문구 <span style="color:#bbb;font-weight:400;">(선택)</span></label>
            <input id="wizMatNote" type="text" value="${esc(m.note || '입금자명에 학생 이름 기재 부탁드립니다')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box;">
          </div>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="_billingWizardBack()">← 이전</button>
        <button class="btn btn-primary" onclick="_billingWizardComplete()">완료</button>
      </div>
    </div>
  `);
}

window._billingWizardToggleMat = (enabled) => {
  _billingWizardData.materialsEnabled = enabled;
  document.getElementById('wizMatFields').style.display = enabled ? 'flex' : 'none';
  // 라디오 카드 시각 갱신을 위해 다시 렌더 (선택 상태 유지)
  _renderWizardStep2();
};

window._billingWizardComplete = async () => {
  const d = _billingWizardData;
  const enabled = !!d.materialsEnabled;
  let materialsChannel = { enabled: false };

  if (enabled) {
    const bankName = document.getElementById('wizMatBankName').value;
    const bankAccount = document.getElementById('wizMatBankAccount').value.trim();
    const accountHolder = document.getElementById('wizMatAccountHolder').value.trim();
    const cardLink = document.getElementById('wizMatCardLink').value.trim();
    const note = document.getElementById('wizMatNote').value.trim();
    if (!bankName || !bankAccount || !accountHolder) {
      showAlert('입력 확인', '별도 계좌의 은행·계좌번호·예금주를 모두 입력하세요.');
      return;
    }
    materialsChannel = {
      enabled: true,
      label: '교재/시험비',
      cardLink, bankName, bankAccount, accountHolder, note,
    };
  }

  // academies/{id}.paymentSettings 저장
  const academyName = (await getDoc(doc(db, 'academies', window.MY_ACADEMY_ID))).data()?.name || '';
  const settings = {
    // -1 (말일) 도 유효 — || 함정 회피
    defaultDueDay: (isFinite(d.defaultDueDay) && (d.defaultDueDay === -1 || (d.defaultDueDay >= 1 && d.defaultDueDay <= 31))) ? d.defaultDueDay : 15,
    tuitionChannel: {
      label: '학원 결제',
      cardLink: d.tuition.cardLink || '',
      bankName: d.tuition.bankName,
      bankAccount: d.tuition.bankAccount,
      accountHolder: d.tuition.accountHolder,
      note: '',
    },
    materialsChannel,
    messageSettings: {
      greeting: `안녕하세요, ${academyName}입니다 :)`,
      signature: '감사합니다.',
      customTemplates: {},
    },
  };

  try {
    await updateDoc(doc(db, 'academies', window.MY_ACADEMY_ID), { paymentSettings: settings });
    closeModal();
    showToast('✅ 결제 설정이 완료됐어요!');
    _billingSettings = settings;
    await loadPayments();  // 메인 화면 갱신
  } catch (e) {
    showAlert('저장 실패', e.message);
  }
};

// ══════════════════════════════════════════════════════════════════════════
// 공통 대상 셀렉터 — 시험출제 / 메시지 / 공지 등에서 재사용
// targets[] = [{type:'all'|'class'|'student', id, name, groupName?}]
// 한 번에 한 picker 만 활성 (단일 글로벌 state)
// ══════════════════════════════════════════════════════════════════════════
const _picker = {
  targets: [],
  cfg: null,                 // { boxEl, summaryEl, allowAll, emptyText, onChange }
  students: [],
  groupMap: {},
  sortedGroups: [],
  fetchedAt: 0,
};

// 학생 목록 fetch (1분 캐시, 같은 페이지 재사용)
async function _pickerFetchStudents() {
  const now = Date.now();
  if (_picker.students.length && (now - _picker.fetchedAt) < 60000) return;
  const snap = await getDocs(query(
    collection(db,'users'),
    where('academyId','==',window.MY_ACADEMY_ID),
    where('role','==','student'),
    where('status','==','active'),
  ));
  _picker.students = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  _picker.groupMap = {};
  _picker.students.forEach(u => {
    const g = u.group || '(미지정)';
    (_picker.groupMap[g] = _picker.groupMap[g] || []).push(u);
  });
  Object.keys(_picker.groupMap).forEach(g =>
    _picker.groupMap[g].sort((a,b) => (a.name||'').localeCompare(b.name||'', 'ko'))
  );
  _picker.sortedGroups = Object.keys(_picker.groupMap).sort((a,b) => a.localeCompare(b, 'ko'));
  _picker.fetchedAt = now;
}

// 공통 셀렉터 초기화 — 페이지/모달이 진입 시 호출
async function pickerInit({ boxEl, summaryEl, initialTargets = [], allowAll = false, emptyText = '반/학생을 선택하세요', onChange = null, height = 220 } = {}) {
  await _pickerFetchStudents();
  _picker.targets = Array.isArray(initialTargets) ? [...initialTargets] : [];
  _picker.cfg = { boxEl, summaryEl, allowAll, emptyText, onChange, height };
  _pickerRenderBox();
  _pickerRenderSummary();
}

// 현재 선택된 targets 반환
function pickerGetTargets() {
  return [..._picker.targets];
}

// 모든 선택 대상 해제 + 화면 갱신 (메시지 작성 카드의 [↻ 리셋] 버튼)
window.msgResetTargets = () => {
  _picker.targets = [];
  _pickerRenderBox();
  _pickerRenderSummary();
  if (_picker.cfg?.onChange) try { _picker.cfg.onChange(); } catch(_) {}
};

function _pickerRenderBox() {
  const c = _picker.cfg; if (!c) return;
  const box = document.getElementById(c.boxEl); if (!box) return;
  const isAll = _picker.targets.some(t => t.type === 'all');
  const selClassIds = new Set(_picker.targets.filter(t=>t.type==='class').map(t=>t.id));
  const selStudentIds = new Set(_picker.targets.filter(t=>t.type==='student').map(t=>t.id));
  const dim = isAll ? 'opacity:.4;pointer-events:none;' : '';
  box.innerHTML = `
    ${c.allowAll ? `
      <div style="padding:8px 12px;background:${isAll?'#e0f2fe':'#f8f9fa'};border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="pickerToggleAll()">
        <input type="checkbox" ${isAll?'checked':''} onclick="event.stopPropagation();pickerToggleAll()">
        <span style="font-weight:700;font-size:13px;color:${isAll?'#075985':'var(--text)'};">📢 전체 학원생</span>
        <span style="font-size:11px;color:var(--gray);margin-left:auto;">${_picker.students.length}명</span>
      </div>
    ` : ''}
    <div style="${dim}">
      ${_picker.sortedGroups.map(g => `
        <div style="border-bottom:1px solid #f0f0f0;">
          <div style="padding:7px 12px;background:#f8f9fa;display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="pickerToggleClass('${esc(g)}')">
            <input type="checkbox" id="pck-g-${esc(g)}" ${selClassIds.has(g)?'checked':''} onclick="event.stopPropagation();pickerToggleClass('${esc(g)}')">
            <span style="font-weight:600;font-size:13px;">👥 ${esc(g)}</span>
            <span style="font-size:11px;color:var(--gray);margin-left:auto;">${_picker.groupMap[g].length}명</span>
          </div>
          <div style="padding:4px 12px 6px;display:flex;flex-wrap:wrap;gap:3px;">
            ${_picker.groupMap[g].map(u => `
              <label style="display:inline-flex;align-items:center;gap:3px;padding:3px 7px;border:1px solid var(--border);border-radius:11px;cursor:pointer;font-size:11px;background:white;">
                <input type="checkbox" id="pck-s-${esc(u.id)}" ${selStudentIds.has(u.id)?'checked':''}
                  onchange="pickerToggleStudent('${esc(u.id)}','${esc(u.name||'').replace(/'/g,"\\'")}','${esc(g).replace(/'/g,"\\'")}')">
                👤 ${esc(u.name||'')}
              </label>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
  box.style.cssText = `max-height:${c.height}px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;`;
}

function _pickerRenderSummary() {
  const c = _picker.cfg; if (!c) return;
  const el = document.getElementById(c.summaryEl); if (!el) return;
  const ts = _picker.targets;
  if (ts.length === 0) {
    el.innerHTML = `<span style="color:var(--gray);font-size:12px;">${esc(c.emptyText)}</span>`;
  } else if (ts.some(t => t.type === 'all')) {
    el.innerHTML = `<span style="background:#e0f2fe;border:1px solid #7dd3fc;border-radius:14px;padding:3px 10px;font-size:11px;color:#075985;font-weight:600;">📢 전체 학원생</span>`;
  } else {
    const sorted = [...ts].sort((a,b) => (a.name||'').localeCompare(b.name||'', 'ko'));
    el.innerHTML = sorted.map(t =>
      `<span style="background:#f0fafa;border:1px solid var(--teal-light);border-radius:14px;padding:3px 10px;font-size:11px;display:inline-flex;align-items:center;gap:4px;">
        ${t.type==='class'?'👥':'👤'} ${esc(t.name)}
      </span>`
    ).join('');
  }
}

window.pickerToggleAll = () => {
  const c = _picker.cfg; if (!c || !c.allowAll) return;
  const isAll = _picker.targets.some(t => t.type === 'all');
  _picker.targets = isAll ? [] : [{ type:'all', id:'__all__', name:'전체 학원생' }];
  _pickerRenderBox();
  _pickerRenderSummary();
  c.onChange?.(_picker.targets);
};

window.pickerToggleClass = (g) => {
  // 전체 모드면 해제 후 진행
  _picker.targets = _picker.targets.filter(t => t.type !== 'all');
  const exists = _picker.targets.find(t => t.type==='class' && t.id===g);
  if (exists) {
    _picker.targets = _picker.targets.filter(t => !(t.type==='class' && t.id===g));
  } else {
    _picker.targets.push({ type:'class', id:g, name:g+' 전체', groupName:g });
  }
  _pickerRenderBox();
  _pickerRenderSummary();
  _picker.cfg?.onChange?.(_picker.targets);
};

window.pickerToggleStudent = (uid, name, group) => {
  _picker.targets = _picker.targets.filter(t => t.type !== 'all');
  const exists = _picker.targets.find(t => t.type==='student' && t.id===uid);
  if (exists) {
    _picker.targets = _picker.targets.filter(t => !(t.type==='student' && t.id===uid));
  } else {
    _picker.targets.push({ type:'student', id:uid, name, groupName:group });
  }
  _pickerRenderBox();
  _pickerRenderSummary();
  _picker.cfg?.onChange?.(_picker.targets);
};

// targets[] 를 학생 UID 배열로 해석 (서버 발송 / 클라 표시 양쪽에서 재사용)
function pickerResolveUids(targets) {
  if (!Array.isArray(targets) || !targets.length) return [];
  if (targets.some(t => t.type === 'all')) {
    return _picker.students.map(u => u.id);
  }
  const uids = new Set();
  targets.forEach(t => {
    if (t.type === 'student') uids.add(t.id);
    else if (t.type === 'class') {
      (_picker.groupMap[t.id] || []).forEach(u => uids.add(u.id));
    }
  });
  return [...uids];
}

// 서버 페이로드용 요약 라벨 — pushNotifications/notices 의 targetSummary 캐시
function pickerSummarize(targets) {
  if (!Array.isArray(targets) || !targets.length) return '';
  if (targets.some(t => t.type === 'all')) return '전체';
  const cs = targets.filter(t => t.type==='class');
  const ss = targets.filter(t => t.type==='student');
  const parts = [];
  if (cs.length) parts.push(cs.map(t => t.groupName||t.id).join('·'));
  if (ss.length) parts.push(`${ss.length}명`);
  return parts.join(' + ');
}

// ── 메시지 관리 ──────────────────────────────────────

// 메시지 페이지 진입 시 picker 초기화
async function _msgInitPicker(initialTargets = []) {
  await pickerInit({
    boxEl: 'msgPickerBox',
    summaryEl: 'msgPickerSummary',
    initialTargets,
    allowAll: true,
    emptyText: '반/학생을 선택하거나 전체를 체크하세요',
    height: 220,
  });
}

// ── 메시지 첨부 파일 (다중) — 학원장 메시지 작성 시 선택 ──
// 자료실/공지와 동일 정책: 20MB/파일 + 화이트리스트. 다중 첨부 (2026-06-13 단일→다중)
let _msgPendingAttaches = [];  // [{ file:File, name, sizeKB, status:'pending'|'uploading'|'done', url? }]

const _MSG_ATTACH_ALLOWED_MIME = new Set([
  'application/pdf', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.hancom.hwp',
]);
const _MSG_ATTACH_ALLOWED_PREFIX = ['application/vnd.openxmlformats-officedocument.', 'application/hwp', 'application/x-hwp', 'image/', 'text/'];

function _msgAttachAllowed(type) {
  const t = String(type || '');
  if (_MSG_ATTACH_ALLOWED_MIME.has(t)) return true;
  return _MSG_ATTACH_ALLOWED_PREFIX.some(p => t.startsWith(p));
}

function _msgRenderAttaches() {
  const el = document.getElementById('msgAttachList');
  if (!el) return;
  if (_msgPendingAttaches.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = _msgPendingAttaches.map((a, i) => {
    const dot = a.status === 'done' ? '#16a34a' : (a.status === 'uploading' ? '#f59e0b' : '#94a3b8');
    const label = a.status === 'done' ? '업로드됨' : (a.status === 'uploading' ? '업로드 중…' : '발송 시 업로드');
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#f8f9fa;border:1px solid var(--border);border-radius:6px;font-size:12px;">
      <span style="width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0;"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.name)} <span style="color:var(--gray);">(${a.sizeKB} KB) · ${label}</span></span>
      <button type="button" onclick="msgRemoveAttach(${i})" title="제외" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:0;width:20px;height:20px;line-height:1;">${iconSvg('x')}</button>
    </div>`;
  }).join('');
}

function _msgAcceptFile(f) {
  if (!f) return false;
  if (f.size > 20 * 1024 * 1024) { showAlert('파일 크기 초과', `"${f.name}" — 20MB 이하만 첨부 가능.`); return false; }
  if (!_msgAttachAllowed(f.type || '')) { showAlert('허용되지 않는 형식', `"${f.name}" — PDF·Office·한글·이미지·텍스트만 허용. 영상·압축·실행파일은 불가.`); return false; }
  _msgPendingAttaches.push({ file: f, name: f.name, sizeKB: Math.round(f.size / 1024), status: 'pending' });
  _msgRenderAttaches();
  return true;
}

window.msgPickAttach = (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  for (const f of files) _msgAcceptFile(f);
  if (e.target) e.target.value = '';
};

window.msgRemoveAttach = (idx) => {
  if (idx < 0 || idx >= _msgPendingAttaches.length) return;
  _msgPendingAttaches.splice(idx, 1);
  _msgRenderAttaches();
};

window.msgDragOver = (e) => {
  e.preventDefault(); e.stopPropagation();
  const el = document.getElementById('msgAttachDrop');
  if (el) { el.style.borderColor = 'var(--teal, #E8714A)'; el.style.background = '#fff7f4'; }
};

window.msgDragLeave = (e) => {
  e.preventDefault(); e.stopPropagation();
  const el = document.getElementById('msgAttachDrop');
  if (el) { el.style.borderColor = 'var(--border)'; el.style.background = '#fafafa'; }
};

window.msgDrop = (e) => {
  e.preventDefault(); e.stopPropagation();
  const el = document.getElementById('msgAttachDrop');
  if (el) { el.style.borderColor = 'var(--border)'; el.style.background = '#fafafa'; }
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  for (const f of files) _msgAcceptFile(f);
};

async function _msgUploadAll() {
  const out = [];
  for (const a of _msgPendingAttaches) {
    if (a.status === 'done' && a.url) { out.push({ url: a.url, name: a.name, sizeKB: a.sizeKB }); continue; }
    if (!a.file) continue;
    a.status = 'uploading'; _msgRenderAttaches();
    try {
      const safeName = a.file.name.replace(/[^\w가-힣ㄱ-ㅎㅏ-ㅣ.\-]+/g, '_');
      const rand = Math.random().toString(36).slice(2, 8);
      const path = `messageAttachments/${window.MY_ACADEMY_ID || 'default'}/${Date.now()}_${rand}_${safeName}`;
      const r = ref(storage, path);
      await uploadBytesResumable(r, a.file, { contentType: a.file.type || 'application/octet-stream' });
      const url = await getDownloadURL(r);
      a.status = 'done'; a.url = url;
      _msgRenderAttaches();
      out.push({ url, name: a.name, sizeKB: a.sizeKB });
    } catch (e) {
      a.status = 'pending'; _msgRenderAttaches();
      throw new Error(`"${a.name}" 업로드 실패: ${e.message}`);
    }
  }
  return out;
}

function _msgClearAttaches() {
  _msgPendingAttaches = [];
  const input = document.getElementById('msgAttachInput');
  if (input) input.value = '';
  _msgRenderAttaches();
}
window.msgClearAttaches = _msgClearAttaches;

// ── 공지 첨부 파일 (다중) — 학원장 공지 작성·수정 시 ──
// 자료실/메시지와 동일 정책 (20MB/파일 + 화이트리스트 _msgAttachAllowed 재사용). 다중 첨부 지원
let _noticePendingAttaches = [];  // [{ file:File|null, name, sizeKB, status:'pending'|'uploading'|'done', url? }]

function _ymdAddDays(days) {
  const t = Date.now() + days * 86400000 + 9 * 3600000;  // KST 기준 YMD
  return new Date(t).toISOString().slice(0, 10);
}

function _noticeAttachBoxHtml(expiresAtYmd, existingAttaches) {
  const def = expiresAtYmd || _ymdAddDays(30);
  return `
    <div>
      <div style="font-size:13px;color:var(--gray);margin-bottom:6px;">📅 만료일 <span style="font-size:11px;">(이날까지 학생 다운로드 가능, 이후 만료 표시)</span></div>
      <input id="noticeExpiresAt" type="date" value="${esc(def)}" min="${esc(_ymdAddDays(0))}" style="border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px;">
    </div>
    <div>
      <div style="font-size:13px;color:var(--gray);margin-bottom:6px;">📎 첨부 파일 <span style="font-size:11px;">(여러 파일 가능 · 파일당 최대 20MB)</span></div>
      <div id="noticeAttachDrop"
        ondragover="noticeDragOver(event)" ondragleave="noticeDragLeave(event)" ondrop="noticeDrop(event)"
        onclick="document.getElementById('noticeAttachInput').click()"
        style="border:2px dashed var(--border);border-radius:8px;padding:14px;text-align:center;cursor:pointer;background:#fafafa;font-size:12px;color:var(--gray);">
        파일을 끌어다 놓거나 클릭하여 선택 (여러 개 가능)
        <input id="noticeAttachInput" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx,image/*,text/*,.csv,.heic,.heif" onchange="noticePickAttach(event)" style="display:none;">
      </div>
      <div id="noticeAttachList" style="display:flex;flex-direction:column;gap:4px;margin-top:6px;"></div>
      <div style="font-size:11px;color:var(--gray);margin-top:6px;line-height:1.5;background:#f8f9fa;padding:8px 10px;border-radius:6px;">
        ✅ PDF · Word · Excel · PowerPoint · 한글(hwp) · 이미지 · 텍스트<br>
        ❌ 영상 · 압축파일 · 실행파일 · 음성 (Storage 악용 방지)<br>
        💾 Storage 파일은 최대 1년 후 자동 삭제 (학생 표시는 만료일 기준)
      </div>
    </div>
  `;
}

function _noticeRenderAttaches() {
  const el = document.getElementById('noticeAttachList');
  if (!el) return;
  if (_noticePendingAttaches.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = _noticePendingAttaches.map((a, i) => {
    const dot = a.status === 'done' ? '#16a34a' : (a.status === 'uploading' ? '#f59e0b' : '#94a3b8');
    const label = a.status === 'done' ? '업로드됨' : (a.status === 'uploading' ? '업로드 중…' : '저장 시 업로드');
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#f8f9fa;border:1px solid var(--border);border-radius:6px;font-size:12px;">
      <span style="width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0;"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.name)} <span style="color:var(--gray);">(${a.sizeKB} KB) · ${label}</span></span>
      <button type="button" onclick="noticeRemoveAttach(${i})" title="제외" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:0;width:20px;height:20px;line-height:1;">${iconSvg('x')}</button>
    </div>`;
  }).join('');
}

function _noticeAcceptFile(f) {
  if (!f) return false;
  if (f.size > 20 * 1024 * 1024) { showAlert('파일 크기 초과', `"${f.name}" — 20MB 이하만 첨부 가능.`); return false; }
  if (!_msgAttachAllowed(f.type || '')) { showAlert('허용되지 않는 형식', `"${f.name}" — PDF·Office·한글·이미지·텍스트만 허용. 영상·압축·실행파일은 불가.`); return false; }
  _noticePendingAttaches.push({ file: f, name: f.name, sizeKB: Math.round(f.size / 1024), status: 'pending' });
  _noticeRenderAttaches();
  return true;
}

window.noticePickAttach = (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  for (const f of files) _noticeAcceptFile(f);
  if (e.target) e.target.value = '';
};
window.noticeRemoveAttach = (idx) => {
  if (idx < 0 || idx >= _noticePendingAttaches.length) return;
  _noticePendingAttaches.splice(idx, 1);
  _noticeRenderAttaches();
};
window.noticeDragOver = (e) => {
  e.preventDefault(); e.stopPropagation();
  const el = document.getElementById('noticeAttachDrop');
  if (el) { el.style.borderColor = 'var(--teal, #E8714A)'; el.style.background = '#fff7f4'; }
};
window.noticeDragLeave = (e) => {
  e.preventDefault(); e.stopPropagation();
  const el = document.getElementById('noticeAttachDrop');
  if (el) { el.style.borderColor = 'var(--border)'; el.style.background = '#fafafa'; }
};
window.noticeDrop = (e) => {
  e.preventDefault(); e.stopPropagation();
  const el = document.getElementById('noticeAttachDrop');
  if (el) { el.style.borderColor = 'var(--border)'; el.style.background = '#fafafa'; }
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  for (const f of files) _noticeAcceptFile(f);
};

async function _noticeUploadAll() {
  const out = [];
  for (const a of _noticePendingAttaches) {
    if (a.status === 'done' && a.url) { out.push({ url: a.url, name: a.name, sizeKB: a.sizeKB }); continue; }
    if (!a.file) continue;
    a.status = 'uploading'; _noticeRenderAttaches();
    try {
      const safeName = a.file.name.replace(/[^\w가-힣ㄱ-ㅎㅏ-ㅣ.\-]+/g, '_');
      const rand = Math.random().toString(36).slice(2, 8);
      const path = `notices/${window.MY_ACADEMY_ID || 'default'}/${Date.now()}_${rand}_${safeName}`;
      const r = ref(storage, path);
      await uploadBytesResumable(r, a.file, { contentType: a.file.type || 'application/octet-stream' });
      const url = await getDownloadURL(r);
      a.status = 'done'; a.url = url;
      _noticeRenderAttaches();
      out.push({ url, name: a.name, sizeKB: a.sizeKB });
    } catch (e) {
      a.status = 'pending'; _noticeRenderAttaches();
      throw new Error(`"${a.name}" 업로드 실패: ${e.message}`);
    }
  }
  return out;
}

function _noticeClearAttaches() { _noticePendingAttaches = []; }

window.sendMessage = async() => {
  const targets = pickerGetTargets();
  const title = document.getElementById('msgTitle').value.trim();
  const body  = document.getElementById('msgBody').value.trim();
  if (!title||!body) { showAlert('입력 확인', '제목과 내용을 입력하세요.'); return; }
  if (!targets.length) { showAlert('입력 확인', '대상을 선택하세요.'); return; }
  // 학원당 발송이력 한도 검사 (2026-05-14)
  const chk = await _checkContentLimit('sentMessages');
  if (!chk.ok) { showAlert(`${chk.label} 한도 초과 (${chk.cur}/${chk.max})`, `기존 ${chk.label} 1개 이상 삭제 후 발송해주세요.`); return; }
  try{
    let attachments = [];
    if (_msgPendingAttaches.length > 0) {
      try { attachments = await _msgUploadAll(); }
      catch (e) { showAlert('첨부 업로드 실패', e.message); return; }
    }
    const idToken = await currentUser.getIdToken();
    const urgent = !!document.getElementById('msgUrgent')?.checked;
    const res = await fetch('/api/sendPush',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ title, body, targets, idToken, attachments, urgent }),
    });
    const result=await res.json();
    showToast(result.success ? result.message : (result.message||result.error||'발송 실패'));
    if (result.success) {
      // 입력·첨부 초기화 — 검색·날짜 필터 유지
      document.getElementById('msgTitle').value = '';
      document.getElementById('msgBody').value = '';
      const urgentEl = document.getElementById('msgUrgent');
      if (urgentEl) urgentEl.checked = false;
      _msgClearAttaches();
      // 발송 이력 즉시 갱신 — server 가 sent doc 생성하므로 surgical insert 대신 재fetch (현 필터 유지)
      _msgSentCache = null;
      _msgSentState = { lastDoc: null, exhausted: false, docs: [] };
      try {
        _msgSentState.docs = await _msgFetchSent(false);
        _msgRenderSentSection();
      } catch (e) { console.warn('[sendMessage] sent refresh:', e); }
      // 발송 이력 한도 +1 (한도 라벨 즉시 반영)
      const sl = document.getElementById('msgSentLimit');
      if (sl) sl.textContent = sl.textContent.replace(/\d+/, m => parseInt(m) + 1);
      // 초안 캐시 무효 — reuseMsg 로 끌어온 초안이 발송 후에도 남는지는 server 정책, 안전망
      _msgDraftCache = null;
    }
  }catch(e){showToast('발송 실패: '+e.message);}
};

window.saveMessage = async() => {
  const targets = pickerGetTargets();
  const title = document.getElementById('msgTitle').value.trim();
  const body  = document.getElementById('msgBody').value.trim();
  if (!title||!body) { showAlert('입력 확인', '제목과 내용을 입력하세요.'); return; }
  if (!targets.length) { showAlert('입력 확인', '대상을 선택하세요.'); return; }
  // 학원당 초안 한도 검사 (2026-05-14)
  const chk = await _checkContentLimit('drafts');
  if (!chk.ok) { showAlert(`${chk.label} 한도 초과 (${chk.cur}/${chk.max})`, `기존 ${chk.label} 1개 이상 삭제 후 저장해주세요.`); return; }
  const todayYmd = _ymdKST();
  const payload = {
    targets,
    targetSummary: pickerSummarize(targets),
    title, body,
    sent:false, date: todayYmd,
    academyId:window.MY_ACADEMY_ID||'default',
  };
  const ref = await addDoc(collection(db,'pushNotifications'), { ...payload, createdAt:serverTimestamp() });
  showToast('💾 저장됐어요!');
  // 검색·날짜 필터 유지 — 전체 loadMessages (어제 reset) 대신 surgical 삽입
  _msgDraftCache = null;  // 다음 페이지·검색 시 fresh fetch
  // 현재 날짜 필터가 오늘이면 즉시 상단에 추가 (사용자가 새 초안 바로 봄)
  if (_msgDraftDate === todayYmd) {
    const fauxSnap = { id: ref.id, data: () => payload };
    _msgDraftState.docs.unshift(fauxSnap);
    const dl = document.getElementById('msgDraftLimit');
    if (dl) dl.textContent = dl.textContent.replace(/\d+/, m => parseInt(m) + 1);
    _msgRenderDraftSection();
  }
};
// 발송 이력 행 인라인 펼침 상태 (현재 펼쳐진 pushId 1개만 유지)
let _msgExpandedSentId = null;
// 메시지 페이지네이션 (2026-05-14, 초안/발송 각 10개씩 + 더보기)
const MSG_PAGE_SIZE = 10;
let _msgDraftState = { lastDoc: null, exhausted: false, docs: [] };
let _msgSentState  = { lastDoc: null, exhausted: false, docs: [] };

// 옛/신 schema 모두에서 대상 라벨 뽑기 (module scope, loadMessages + loadMore* 공용)
function _msgLabelOf(n) {
  if (n.targetSummary) return n.targetSummary;
  if (Array.isArray(n.targets) && n.targets.length) return pickerSummarize(n.targets);
  if (n.target === 'all') return '전체';
  if (n.target?.startsWith?.('uid:')) return '개별학생';
  return n.target || '-';
}
// 본문 미리보기 한 줄 + 말줄임
function _msgBodyPreview(txt) {
  const s = esc((txt || '').replace(/\s+/g, ' '));
  return `<div style="font-size:12px;color:var(--gray);margin-top:2px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s}</div>`;
}
const _MSG_ONE_LINE = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
// 날짜 필터 (기본 어제) — 메시지 관리(초안)·발송 이력 각각
let _msgDraftDate = '', _msgSentDate = '';
// 검색 — 검색어 있으면 날짜 무시, 최근 100개 캐시에서 클라 필터
let _msgDraftSearch = '', _msgSentSearch = '';
let _msgDraftCache = null, _msgSentCache = null, _msgLimits = null;
let _msgDraftSearchT = null, _msgSentSearchT = null;
function _msgDayRange(ymd){
  const start = new Date(ymd + 'T00:00:00+09:00');
  return { start, end: new Date(start.getTime() + 86400000) };
}
// 검색용 — 학원 메시지 저장 한도(플랜·학생수 기준)만큼 fetch (날짜 무관).
// 한도 = 저장 가능 최대치라 그 범위가 검색 대상 전부 → 누락 0. 캐시해서 재요청 X
async function _msgFetchAll(sent){
  const max = (_msgLimits && (sent ? _msgLimits.sentMessagesPerAcademy : _msgLimits.draftsPerAcademy)) || 100;
  const snap = await getDocs(query(collection(db,'pushNotifications'),
    where('academyId','==', window.MY_ACADEMY_ID),
    where('sent','==', sent),
    orderBy('createdAt','desc'),
    limit(max)));
  return snap.docs;
}
// 제목·내용·받는사람(반·학생 이름) 부분 일치
function _msgMatch(d, q){
  const n = d.data();
  const parts = [n.title||'', n.body||'', n.targetSummary||''];
  if (Array.isArray(n.targets)) for (const t of n.targets) parts.push(t.name||'', t.groupName||'');
  return parts.join(' ').toLowerCase().includes(q);
}
// 한도 표시 span 의 첫 숫자(저장 개수) -1 — 삭제 후 즉시 반영
function _msgDecLimit(spanId){
  const el = document.getElementById(spanId);
  if (el) el.textContent = el.textContent.replace(/\d+/, m => Math.max(0, parseInt(m) - 1));
}

function _msgRenderDraft(d) {
  const n = d.data();
  const targetLabel = _msgLabelOf(n);
  return `<div style="width:100%;max-width:100%;box-sizing:border-box;border:1px dashed var(--border);background:#fffbf3;border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:.15s;overflow:hidden;"
    onclick="reuseMsg('${d.id}')" title="클릭하면 입력창에 채워집니다"
    onmouseover="this.style.background='#fef6e7'" onmouseout="this.style.background='#fffbf3'">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;width:100%;">
      <div style="flex:1 1 0;min-width:0;overflow:hidden;">
        <div style="display:flex;align-items:baseline;gap:8px;">
          <div style="font-size:13px;font-weight:600;flex:1 1 0;min-width:0;${_MSG_ONE_LINE}">${esc(n.title)||''}</div>
          <div style="font-size:11px;color:#bbb;flex-shrink:0;${_MSG_ONE_LINE}">${esc(targetLabel)} · ${esc(n.date)||''}</div>
        </div>
        ${_msgBodyPreview(n.body)}
      </div>
      <button onclick="event.stopPropagation();delDraftMsg('${d.id}')" title="초안 삭제" style="background:none;border:none;color:#e05050;cursor:pointer;font-size:15px;padding:0 4px;flex-shrink:0;">${iconSvg('x')}</button>
    </div>
  </div>`;
}

function _msgRenderSent(d) {
  const n = d.data();
  const targetLabel = _msgLabelOf(n);
  const isOpen = _msgExpandedSentId === d.id;
  return `<div id="msgSentWrap-${d.id}" style="width:100%;max-width:100%;overflow:hidden;">
    <div id="msgSentRow-${d.id}" style="width:100%;box-sizing:border-box;border:1px solid ${isOpen?'var(--teal)':'var(--border)'};border-radius:8px;padding:10px 12px;margin-bottom:6px;cursor:pointer;transition:.15s;background:${isOpen?'#f0fafa':''};overflow:hidden;"
      onclick="toggleSentDetail('${d.id}','${(n.title||'').replace(/'/g,"\\'")}')"
      onmouseover="if(_msgExpandedSentId!=='${d.id}')this.style.background='#f0fafa'" onmouseout="if(_msgExpandedSentId!=='${d.id}')this.style.background=''">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;width:100%;">
        <div style="flex:1 1 0;min-width:0;overflow:hidden;">
          <div style="display:flex;align-items:baseline;gap:8px;">
            <div style="font-size:13px;font-weight:600;flex:1 1 0;min-width:0;${_MSG_ONE_LINE}">${esc(n.title)||''}${(() => {
              const cnt = (Array.isArray(n.attachments) ? n.attachments.length : 0) || (n.attachment?.url ? 1 : 0);
              return cnt > 0 ? ` <span style="font-size:10px;color:var(--teal);font-weight:500;background:#fff7f4;padding:1px 6px;border-radius:4px;">첨부${cnt > 1 ? ' ' + cnt : ''}</span>` : '';
            })()}</div>
            <div style="font-size:11px;color:#bbb;flex-shrink:0;${_MSG_ONE_LINE}">${esc(targetLabel)} · ${esc(n.date)||''} ${isOpen?'<span style="color:var(--teal);">▼</span>':'<span style="color:#ccc;">▶</span>'}</div>
          </div>
          ${_msgBodyPreview(n.body)}
        </div>
        <div style="display:flex;gap:2px;flex-shrink:0;">
          <button onclick="event.stopPropagation();reuseMsg('${d.id}')" title="재활용 — 제목·내용을 입력창에 채움" style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:14px;padding:2px 6px;">♻</button>
          <button onclick="event.stopPropagation();delMsg('${d.id}')" title="삭제 (학생 알림함도 함께 사라짐)" style="background:none;border:none;color:#e05050;cursor:pointer;font-size:15px;padding:0 4px;">${iconSvg('x')}</button>
        </div>
      </div>
    </div>
    <div id="msgSentInline-${d.id}" style="width:100%;max-width:100%;overflow:hidden;"></div>
  </div>`;
}

function _msgRenderDraftSection() {
  const el = document.getElementById('savedMsgDrafts');
  if (!el) return;
  const docs = _msgDraftState.docs;
  const cards = docs.length
    ? docs.map(_msgRenderDraft).join('')
    : `<div style="color:#bbb;font-size:13px;text-align:center;padding:20px;">${_msgDraftSearch?'검색 결과가 없습니다':'저장된 초안이 없습니다'}</div>`;
  const more = _msgDraftState.exhausted
    ? (docs.length > 0 ? '<div style="text-align:center;color:#888;padding:8px;font-size:11px;">모두 표시됨</div>' : '')
    : '<button class="btn btn-secondary" style="display:block;margin:8px auto;font-size:12px;padding:5px 14px;" onclick="loadMoreMsgDrafts()">+ 더 보기</button>';
  el.innerHTML = cards + more;
}

function _msgRenderSentSection() {
  const el = document.getElementById('savedMsgSent');
  if (!el) return;
  const docs = _msgSentState.docs;
  const cards = docs.length
    ? docs.map(_msgRenderSent).join('')
    : `<div style="color:#bbb;font-size:13px;text-align:center;padding:20px;">${_msgSentSearch?'검색 결과가 없습니다':'발송 이력이 없습니다'}</div>`;
  const more = _msgSentState.exhausted
    ? (docs.length > 0 ? '<div style="text-align:center;color:#888;padding:8px;font-size:11px;">모두 표시됨</div>' : '')
    : '<button class="btn btn-secondary" style="display:block;margin:8px auto;font-size:12px;padding:5px 14px;" onclick="loadMoreMsgSent()">+ 더 보기</button>';
  el.innerHTML = cards + more;
  // 펼친 항목 인라인 다시 채움
  if (_msgExpandedSentId) {
    const stillThere = docs.find(d => d.id === _msgExpandedSentId);
    if (stillThere && document.getElementById('msgSentInline-' + _msgExpandedSentId)) {
      _msgRenderSentDetail(_msgExpandedSentId, stillThere.data().title || '');
    } else {
      _msgExpandedSentId = null;
    }
  }
}

async function _msgFetchDrafts(useCursor) {
  const constraints = [
    where('academyId','==', window.MY_ACADEMY_ID),
    where('sent','==', false),
  ];
  if (_msgDraftDate) {
    const r = _msgDayRange(_msgDraftDate);
    constraints.push(where('createdAt','>=', r.start), where('createdAt','<', r.end));
  }
  constraints.push(orderBy('createdAt','desc'));
  if (useCursor && _msgDraftState.lastDoc) constraints.push(startAfter(_msgDraftState.lastDoc));
  constraints.push(limit(MSG_PAGE_SIZE));
  const snap = await getDocs(query(collection(db, 'pushNotifications'), ...constraints));
  _msgDraftState.lastDoc = snap.docs[snap.docs.length - 1] || _msgDraftState.lastDoc;
  _msgDraftState.exhausted = snap.size < MSG_PAGE_SIZE;
  return snap.docs;
}
async function _msgFetchSent(useCursor) {
  const constraints = [
    where('academyId','==', window.MY_ACADEMY_ID),
    where('sent','==', true),
  ];
  if (_msgSentDate) {
    const r = _msgDayRange(_msgSentDate);
    constraints.push(where('createdAt','>=', r.start), where('createdAt','<', r.end));
  }
  constraints.push(orderBy('createdAt','desc'));
  if (useCursor && _msgSentState.lastDoc) constraints.push(startAfter(_msgSentState.lastDoc));
  constraints.push(limit(MSG_PAGE_SIZE));
  const snap = await getDocs(query(collection(db, 'pushNotifications'), ...constraints));
  _msgSentState.lastDoc = snap.docs[snap.docs.length - 1] || _msgSentState.lastDoc;
  _msgSentState.exhausted = snap.size < MSG_PAGE_SIZE;
  return snap.docs;
}

window.loadMoreMsgDrafts = async() => {
  const docs = await _msgFetchDrafts(true);
  _msgDraftState.docs = _msgDraftState.docs.concat(docs);
  _msgRenderDraftSection();
};
window.loadMoreMsgSent = async() => {
  const docs = await _msgFetchSent(true);
  _msgSentState.docs = _msgSentState.docs.concat(docs);
  _msgRenderSentSection();
};

window.msgChangeDraftDate = async () => {
  _msgDraftDate = (document.getElementById('msgDraftDate')||{}).value || '';
  _msgDraftSearch = '';
  { const s = document.getElementById('msgDraftSearch'); if (s) s.value = ''; }
  _msgDraftState = { lastDoc: null, exhausted: false, docs: [] };
  const el = document.getElementById('savedMsgDrafts');
  if (el) el.innerHTML = '<div class="loading"><div class="spinner"></div>로딩 중</div>';
  try { _msgDraftState.docs = await _msgFetchDrafts(false); }
  catch (e) { console.error(e); }
  _msgRenderDraftSection();
};
window.msgChangeSentDate = async () => {
  _msgSentDate = (document.getElementById('msgSentDate')||{}).value || '';
  _msgSentSearch = '';
  { const s = document.getElementById('msgSentSearch'); if (s) s.value = ''; }
  _msgSentState = { lastDoc: null, exhausted: false, docs: [] };
  _msgExpandedSentId = null;
  const el = document.getElementById('savedMsgSent');
  if (el) el.innerHTML = '<div class="loading"><div class="spinner"></div>로딩 중</div>';
  try { _msgSentState.docs = await _msgFetchSent(false); }
  catch (e) { console.error(e); }
  _msgRenderSentSection();
};

// 검색 (debounce 300ms) — 검색어 있으면 캐시 100개에서 필터, 비우면 날짜 모드 복귀
window.msgChangeDraftSearch = () => {
  clearTimeout(_msgDraftSearchT);
  _msgDraftSearchT = setTimeout(_msgRunDraftSearch, 300);
};
async function _msgRunDraftSearch(){
  _msgDraftSearch = ((document.getElementById('msgDraftSearch')||{}).value || '').trim();
  if (!_msgDraftSearch) { window.msgChangeDraftDate(); return; }
  const el = document.getElementById('savedMsgDrafts');
  if (!_msgDraftCache) {
    if (el) el.innerHTML = '<div class="loading"><div class="spinner"></div>로딩 중</div>';
    try { _msgDraftCache = await _msgFetchAll(false); }
    catch (e) { console.error(e); _msgDraftCache = []; }
  }
  const q = _msgDraftSearch.toLowerCase();
  _msgDraftState = { lastDoc: null, exhausted: true, docs: _msgDraftCache.filter(d => _msgMatch(d, q)) };
  _msgRenderDraftSection();
}
window.msgChangeSentSearch = () => {
  clearTimeout(_msgSentSearchT);
  _msgSentSearchT = setTimeout(_msgRunSentSearch, 300);
};
async function _msgRunSentSearch(){
  _msgSentSearch = ((document.getElementById('msgSentSearch')||{}).value || '').trim();
  if (!_msgSentSearch) { window.msgChangeSentDate(); return; }
  _msgExpandedSentId = null;
  const el = document.getElementById('savedMsgSent');
  if (!_msgSentCache) {
    if (el) el.innerHTML = '<div class="loading"><div class="spinner"></div>로딩 중</div>';
    try { _msgSentCache = await _msgFetchAll(true); }
    catch (e) { console.error(e); _msgSentCache = []; }
  }
  const q = _msgSentSearch.toLowerCase();
  _msgSentState = { lastDoc: null, exhausted: true, docs: _msgSentCache.filter(d => _msgMatch(d, q)) };
  _msgRenderSentSection();
}

// 메시지 자동 정리 정책 (2026-05-30):
//  - 발송 메시지(pushNotifications.sent=true) 60일 후 자동 삭제
//  - 학생 알림함(userNotifications) 30일 후 자동 삭제 — 학원장이 학원 전체 처리 (Rules: admin only delete)
//  - 메시지 관리(초안 pushNotifications.sent=false) 자동 삭제 없음
// 학원장이 메시지 페이지 열 때 fire-and-forget 으로 정리. 인덱스: (academyId, sent, createdAt ASC), (academyId, createdAt ASC).
async function _msgCleanupOldData() {
  if (!window.MY_ACADEMY_ID) return;
  try {
    // 1) 60일 초과 발송 메시지 삭제 (한 번에 최대 50건)
    const cutoff60 = new Date(Date.now() - 60 * 86400 * 1000);
    const sentSnap = await getDocs(query(
      collection(db, 'pushNotifications'),
      where('academyId', '==', window.MY_ACADEMY_ID),
      where('sent', '==', true),
      where('createdAt', '<', cutoff60),
      limit(50)
    ));
    if (!sentSnap.empty) {
      const b = writeBatch(db);
      sentSnap.docs.forEach(d => b.delete(d.ref));
      await b.commit();
      console.log(`[_msgCleanupOldData] 발송 메시지 ${sentSnap.size}건 자동 삭제 (60일 초과)`);
    }
    // 2) 30일 초과 학생 알림 삭제 (학원 전체, 한 번에 최대 100건)
    const cutoff30 = new Date(Date.now() - 30 * 86400 * 1000);
    const notifSnap = await getDocs(query(
      collection(db, 'userNotifications'),
      where('academyId', '==', window.MY_ACADEMY_ID),
      where('createdAt', '<', cutoff30),
      limit(100)
    ));
    if (!notifSnap.empty) {
      const b = writeBatch(db);
      notifSnap.docs.forEach(d => b.delete(d.ref));
      await b.commit();
      console.log(`[_msgCleanupOldData] 학생 알림 ${notifSnap.size}건 자동 삭제 (30일 초과)`);
    }
  } catch (e) {
    console.warn('[_msgCleanupOldData] 정리 실패:', e.message);
  }
}

async function loadMessages(){
  const draftEl = document.getElementById('savedMsgDrafts');
  const sentEl  = document.getElementById('savedMsgSent');
  if (!draftEl || !sentEl) return;
  // 만료 데이터 자동 정리 — fire-and-forget (UI 로딩 차단 X)
  _msgCleanupOldData();
  _msgInitResizer();
  try { await _msgInitPicker([]); } catch (e) { console.warn('[picker init]', e); }
  // 날짜 필터 기본값 = 빈 (전체) — 최근 10개 + cursor 더보기 (2026-06-01)
  // 옛 default '어제' 폐기 (학원장이 어제 작성·발송 없으면 빈 목록 → 혼선)
  _msgDraftDate = ''; _msgSentDate = '';
  const _dd = document.getElementById('msgDraftDate'); if (_dd) _dd.value = '';
  const _sd = document.getElementById('msgSentDate'); if (_sd) _sd.value = '';
  // 검색 캐시·입력 리셋 (loadMessages 는 발송·삭제 후에도 호출 → 캐시 자동 무효화)
  _msgDraftSearch = ''; _msgSentSearch = '';
  _msgDraftCache = null; _msgSentCache = null;
  const _dsr = document.getElementById('msgDraftSearch'); if (_dsr) _dsr.value = '';
  const _ssr = document.getElementById('msgSentSearch'); if (_ssr) _ssr.value = '';
  // state 리셋
  _msgDraftState = { lastDoc: null, exhausted: false, docs: [] };
  _msgSentState  = { lastDoc: null, exhausted: false, docs: [] };
  try {
    const [draftDocs, sentDocs] = await Promise.all([_msgFetchDrafts(false), _msgFetchSent(false)]);
    _msgDraftState.docs = draftDocs;
    _msgSentState.docs  = sentDocs;

    // 한도 표시 — 전체 count 별도 fetch (getCountFromServer)
    try {
      const [limits, dCount, sCount] = await Promise.all([
        _loadContentLimits(),
        getCountFromServer(query(collection(db,'pushNotifications'),where('academyId','==',window.MY_ACADEMY_ID),where('sent','==',false))),
        getCountFromServer(query(collection(db,'pushNotifications'),where('academyId','==',window.MY_ACADEMY_ID),where('sent','==',true))),
      ]);
      _msgLimits = limits;  // 검색 fetch 범위 기준
      const dl = document.getElementById('msgDraftLimit');
      if (dl) dl.textContent = `(${dCount.data().count}/${limits.draftsPerAcademy} 저장됨)`;
      const sl = document.getElementById('msgSentLimit');
      if (sl) sl.textContent = `(${sCount.data().count}/${limits.sentMessagesPerAcademy} 저장됨)`;
    } catch(_) {}

    _msgRenderDraftSection();
    _msgRenderSentSection();
    return;
  } catch (e) {
    console.error(e);
    draftEl.innerHTML = '<div class="empty-msg" style="padding:20px;color:#e05050;">불러오기 실패: ' + e.message + '</div>';
    return;
  }
}

// ── 발송 이력 인라인 펼침 토글 ────────────────────────
window.toggleSentDetail = (pushId, title) => {
  if (_msgExpandedSentId === pushId) {
    // 닫기
    _msgExpandedSentId = null;
    const inline = document.getElementById('msgSentInline-'+pushId);
    if (inline) inline.innerHTML = '';
    const row = document.getElementById('msgSentRow-'+pushId);
    if (row) { row.style.borderColor = 'var(--border)'; row.style.background = ''; }
    const arrow = row?.querySelector('span[style*="--teal"], span[style*="ccc"]');
    return;
  }
  // 다른 행 닫기
  if (_msgExpandedSentId) {
    const prevInline = document.getElementById('msgSentInline-'+_msgExpandedSentId);
    if (prevInline) prevInline.innerHTML = '';
    const prevRow = document.getElementById('msgSentRow-'+_msgExpandedSentId);
    if (prevRow) { prevRow.style.borderColor = 'var(--border)'; prevRow.style.background = ''; }
  }
  _msgExpandedSentId = pushId;
  const row = document.getElementById('msgSentRow-'+pushId);
  if (row) { row.style.borderColor = 'var(--teal)'; row.style.background = '#f0fafa'; }
  _msgRenderSentDetail(pushId, title);
};

// 인라인 펼침 영역에 읽음 현황 렌더 (showMsgReadStatus 본체 이식)
async function _msgRenderSentDetail(pushId, title) {
  const wrap = document.getElementById('msgSentInline-'+pushId);
  if (!wrap) return;
  wrap.innerHTML = `<div style="margin:0 0 8px;border:1px solid var(--teal-light);border-radius:8px;background:#fafefe;overflow:hidden;">
    <div style="padding:14px;text-align:center;color:#bbb;font-size:13px;">로딩 중...</div>
  </div>`;
  try {
    const [notifSnap, userSnap] = await Promise.all([
      getDocs(query(collection(db,'userNotifications'), where('academyId','==',window.MY_ACADEMY_ID), where('pushId','==',pushId))),
      getDocs(query(collection(db,'users'), where('academyId','==',window.MY_ACADEMY_ID), where('role','==','student'))),
    ]);
    let notifs = notifSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    if (!notifs.length) {
      const fbSnap = await getDocs(query(collection(db,'userNotifications'), where('academyId','==',window.MY_ACADEMY_ID), where('title','==',title)));
      notifs = fbSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    }
    if (!notifs.length) {
      wrap.innerHTML = `<div style="margin:0 0 8px;padding:14px;border:1px solid var(--border);border-radius:8px;background:#f8f9fa;text-align:center;color:#bbb;font-size:13px;">
        확인 데이터가 없습니다 <span style="font-size:11px;">(이전 방식으로 발송된 알림)</span>
      </div>`;
      return;
    }
    const userMap = {};
    userSnap.docs.forEach(d => { userMap[d.id] = { name:d.data().name||'-', group:d.data().group||'' }; });

    // 정렬: 미읽음 먼저, 같은 상태 안에서는 이름순
    notifs.sort((a,b) => {
      const ar = !!a.read, br = !!b.read;
      if (ar !== br) return ar ? 1 : -1;
      return (userMap[a.uid]?.name||'').localeCompare(userMap[b.uid]?.name||'', 'ko');
    });

    const read = notifs.filter(n => n.read === true);
    const unread = notifs.filter(n => !n.read);
    const readPct = notifs.length ? Math.round(read.length/notifs.length*100) : 0;

    wrap.innerHTML = `
      <div style="margin:0 0 8px;border:1px solid var(--teal-light);border-radius:8px;background:#fafefe;overflow:hidden;">
        <div style="display:flex;gap:12px;padding:10px 14px;background:#f0fafa;border-bottom:1px solid var(--teal-light);font-size:12px;flex-wrap:wrap;align-items:center;">
          <span>총 <b>${notifs.length}</b>명</span>
          <span style="color:#059669;">✅ 읽음 <b>${read.length}</b>명</span>
          <span style="color:#e05050;">🔴 미읽음 <b>${unread.length}</b>명</span>
          <span style="margin-left:auto;font-weight:700;color:var(--teal);">${readPct}%</span>
        </div>
        <div style="padding:6px 10px;display:grid;grid-template-columns:repeat(auto-fill, minmax(98px,1fr));gap:4px;">
          ${notifs.map(n => {
            const u = userMap[n.uid] || { name: (n.uid||'').slice(0,8), group:'' };
            const isRead = n.read === true;
            const bg     = isRead ? '#d1fae5' : '#fee2e2';
            const fg     = isRead ? '#065f46' : '#b91c1c';
            const border = isRead ? '#a7f3d0' : '#fca5a5';
            const dot    = isRead ? '✓' : '!';
            return `
              <div id="msgRecip-${n.id}" style="background:${bg};border:1px solid ${border};border-radius:6px;padding:5px 20px 5px 7px;font-size:11px;position:relative;color:${fg};line-height:1.3;">
                <button onclick="msgExcludeRecipient('${n.id}','${esc(u.name).replace(/'/g,"\\'")}')" title="이 학생 알림함에서 회수"
                  style="position:absolute;top:2px;right:2px;width:16px;height:16px;background:rgba(255,255,255,0.7);border:1px solid rgba(0,0,0,.1);border-radius:50%;cursor:pointer;font-size:10px;line-height:1;display:flex;align-items:center;justify-content:center;color:#666;padding:0;">${iconSvg('x')}</button>
                <div style="font-weight:700;font-size:11px;">
                  <span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${border};color:white;font-size:8px;line-height:11px;text-align:center;font-weight:700;margin-right:3px;vertical-align:1px;">${dot}</span>${esc(u.name)}
                </div>
                <div style="font-size:9px;opacity:.7;margin-top:1px;">${esc(u.group)||'-'}</div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  } catch(e){
    console.error('[msgRenderSentDetail]', e);
    wrap.innerHTML = `<div style="margin:0 0 8px;padding:14px;border:1px solid #fee;background:#fff5f5;border-radius:8px;color:#e05050;font-size:13px;">불러오기 실패: ${esc(e.message||'')}</div>`;
  }
}

// 발송된 알림에서 특정 학생 1명 회수 — userNotifications doc 1개 삭제 → 학생 알림함에서 사라짐
window.msgExcludeRecipient = async (notifId, name) => {
  if (!(await showConfirm(`${name} 학생 알림 회수`, '이 학생의 알림함에서 알림이 사라집니다. 진행할까요?'))) return;
  try {
    await deleteDoc(doc(db,'userNotifications', notifId));
    document.getElementById('msgRecip-'+notifId)?.remove();
    showToast(`✓ ${esc(name)} 학생 알림 회수 완료`);
  } catch(e) {
    console.error('[msgExcludeRecipient]', e);
    showAlert('회수 실패', e.message || e.code || '');
  }
};

// ── 리사이저 (저장 초안 / 발송 이력 비율 조정 + localStorage) ────────
let _msgResizerInited = false;
function _msgInitResizer() {
  if (_msgResizerInited) return;
  const card    = document.getElementById('msgListCard');
  const top     = document.getElementById('msgDraftSection');
  const bottom  = document.getElementById('msgSentSection');
  const resizer = document.getElementById('msgResizer');
  if (!card || !top || !bottom || !resizer) return;
  _msgResizerInited = true;

  // 저장된 비율 복원
  const saved = parseFloat(localStorage.getItem('msg_split_ratio'));
  if (isFinite(saved) && saved >= 0.1 && saved <= 0.9) {
    top.style.flex = `0 0 ${(saved * 100).toFixed(2)}%`;
  }

  let dragging = false, startY = 0, startTopH = 0, cardH = 0;
  resizer.addEventListener('pointerdown', e => {
    dragging = true;
    startY = e.clientY;
    startTopH = top.getBoundingClientRect().height;
    cardH = card.getBoundingClientRect().height;
    try { resizer.setPointerCapture(e.pointerId); } catch(_){}
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });
  resizer.addEventListener('pointermove', e => {
    if (!dragging) return;
    const minH = 80, resizerH = 6;
    const newTopH = Math.max(minH, Math.min(cardH - minH - resizerH, startTopH + (e.clientY - startY)));
    top.style.flex = `0 0 ${newTopH}px`;
  });
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const ratio = top.getBoundingClientRect().height / card.getBoundingClientRect().height;
    if (isFinite(ratio) && ratio > 0.05 && ratio < 0.95) {
      localStorage.setItem('msg_split_ratio', String(ratio));
    }
  };
  resizer.addEventListener('pointerup', finish);
  resizer.addEventListener('pointercancel', finish);
}

// 초안 삭제 — userNotifications cascade 불필요 (안 보냈으니 자녀 doc 없음)
window.delDraftMsg = async(id) => {
  if(!(await showConfirm('초안 삭제할까요?'))) return;
  try{
    await deleteDoc(doc(db,'pushNotifications',id));
    showToast('삭제됐어요.');
    // 현재 날짜·검색 상태 유지하며 그 카드만 제거 (연이어 삭제 가능)
    _msgDraftState.docs = _msgDraftState.docs.filter(d => d.id !== id);
    if (_msgDraftCache) _msgDraftCache = _msgDraftCache.filter(d => d.id !== id);
    _msgDecLimit('msgDraftLimit');
    _msgRenderDraftSection();
  }catch(e){ showToast('삭제 실패: '+e.message); }
};

window.reuseMsg = async(id) => {
  const snap=await getDoc(doc(db,'pushNotifications',id));
  const n=snap.data();if(!n)return;
  document.getElementById('msgTitle').value=n.title||'';
  document.getElementById('msgBody').value=n.body||'';
  // 대상도 함께 복원 (신 schema 만)
  if (Array.isArray(n.targets) && n.targets.length) {
    await _msgInitPicker(n.targets);
  }
  showToast('내용을 불러왔어요. 수정 후 발송하세요!');
};
window.delMsg = async(id) => {
  // 발송 이력 삭제 + 학생 측 userNotifications 도 cascade 삭제 (학생 앱에서 사라짐)
  if(!(await showConfirm('삭제할까요?', '학생 알림함에서도 함께 사라집니다.'))) return;
  try {
    // pushId + academyId 매칭 (academyId 필터 없으면 Rules 거부)
    const userNotifSnap = await getDocs(query(
      collection(db,'userNotifications'),
      where('academyId','==',window.MY_ACADEMY_ID),
      where('pushId','==',id),
    ));
    await Promise.all(userNotifSnap.docs.map(d => deleteDoc(d.ref)));
    // 발송 이력 본체 삭제
    await deleteDoc(doc(db,'pushNotifications',id));
    showToast(`삭제 완료 (학생 알림 ${userNotifSnap.size}건 포함)`);
    // 현재 날짜·검색 상태 유지하며 그 카드만 제거 (연이어 삭제 가능)
    if (_msgExpandedSentId === id) _msgExpandedSentId = null;
    _msgSentState.docs = _msgSentState.docs.filter(d => d.id !== id);
    if (_msgSentCache) _msgSentCache = _msgSentCache.filter(d => d.id !== id);
    _msgDecLimit('msgSentLimit');
    _msgRenderSentSection();
  } catch(e) {
    console.error('[delMsg]', e);
    showToast('삭제 실패: ' + (e.message || e.code));
  }
};

// ── 성적 관리 ────────────────────────────────────────
async function initScoreReport(){
  const todayStr = _ymdKST();
  const from = _ymdDaysAgoKST(1);  // 어제 default (2026-05-14 — 비용 최적화)
  document.getElementById('scoreFrom').value = from;
  document.getElementById('scoreTo').value = todayStr;

  // 반 목록 채우기 (users에서 실제 그룹값 추출)
  const sel = document.getElementById('scoreClassFilter');
  if(sel && sel.options.length <= 1){
    try{
      const snap = await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID),where('role','==','student')));
      const groups = [...new Set(snap.docs.map(d=>d.data().group).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
      groups.forEach(g=>{
        const opt = document.createElement('option');
        opt.value = g; opt.textContent = g;
        sel.appendChild(opt);
      });
    }catch(e){console.warn(e);}
  }
}
let _srData = [];      // 성적리포트 데이터 캐시
let _srSort = {col:'date', dir:'desc'};  // 기본 최신순
// 페이지네이션 상태 — 월초~당일 + 20개 + 더보기 (2026-05-13, 비용 최적화)
// group/mode 도 server-side where 필터 (composite index 활용) — 정확 매칭
let _srState = { lastDoc: null, exhausted: false, params: null };
const SR_PAGE_SIZE = 20;

function renderScoreReportRows(){
  const el = document.getElementById('scoreReportBody');
  if(!el) return;

  // 이름 검색만 client filter (group/mode/date 는 server-side 처리됨)
  const q = (document.getElementById('scoreSearch')?.value || '').trim().toLowerCase();
  const base = q ? _srData.filter(s => (s.userName||'').toLowerCase().includes(q)) : _srData;

  const {col, dir} = _srSort;
  const sorted = [...base].sort((a,b)=>{
    let av = a[col]??'', bv = b[col]??'';
    // 숫자형 컬럼
    if(col==='score'||col==='correct'){
      av = Number(av)||0; bv = Number(bv)||0;
      return dir==='asc' ? av-bv : bv-av;
    }
    // mode 정렬: unscramble vs word
    av = av.toString().toLowerCase();
    bv = bv.toString().toLowerCase();
    const cmp = av.localeCompare(bv,'ko');
    return dir==='asc' ? cmp : -cmp;
  });

  // 헤더 화살표 업데이트
  ['group','userName','mode','bookName','correct','score','date'].forEach(k=>{
    const el2 = document.getElementById('srSort-'+k);
    if(!el2) return;
    el2.textContent = k===col ? (dir==='asc'?'▲':'▼') : '';
  });

  const sbadge=v=>v>=80?'badge-green':v>=60?'badge-amber':'badge-red';
  el.innerHTML = sorted.map((s,i)=>{
    return `<tr style="cursor:pointer;" onclick="showScoreDetail('${s.id}','${s.testId||''}')">
      <td>${i+1}</td>
      <td>${esc(s.group)||'-'}</td>
      <td style="font-weight:600;">${esc(s.userName)||'-'}</td>
      <td>${_unifiedTypeBadge(s.mode)}</td>
      <td style="font-size:12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${s.bookName||''}">${esc(s.bookName)||'-'}</td>
      <td style="font-size:12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${s.testName||''}">${s.testName||'-'}${s._isSpeaking ? ` <span class="badge" style="background:#fef3c7;color:#78350f;font-size:9px;padding:1px 5px;border-radius:8px;font-weight:700;">${iconSvg('mic')}</span>` : ''}${s._isGrammar ? ' <span class="badge" style="background:#ede9fe;color:#5b21b6;font-size:9px;padding:1px 5px;border-radius:8px;font-weight:700;">📐</span>' : ''}</td>
      <td class="td-center">${s.correct||0}/${s.total||0}</td>
      <td><span class="badge ${sbadge(s.score||0)}">${s.score||0}점</span></td>
      <td class="td-sub">${s._dateTime||s.date||''}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();showScoreDetail('${s.id}','${s.testId||''}')">상세</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="10" style="text-align:center;color:#bbb;padding:20px;">결과가 없습니다</td></tr>';
}

// 이름 검색 — 빈 입력은 즉시 client filter (이전 fetch 결과), 입력 있으면 0.5초 debounce 후 server fetch (limit 1000)
let _srSearchDebounce = null;
window.searchScoreReport = () => {
  clearTimeout(_srSearchDebounce);
  const q = (document.getElementById('scoreSearch')?.value || '').trim();
  if (!q) {
    // 입력 지움 — 빠른 client 재렌더 (1000 받은 상태면 그대로, 20 받은 상태면 그대로)
    // 직전 검색 후 입력 지운 경우 작은 limit 결과로 복귀하려면 loadScoreReport() 호출
    loadScoreReport();
    return;
  }
  _srSearchDebounce = setTimeout(() => loadScoreReport(), 500);
};

window.sortScoreReport = (col) => {
  if(_srSort.col===col){
    _srSort.dir = _srSort.dir==='asc' ? 'desc' : 'asc';
  } else {
    _srSort = {col, dir:'asc'};
  }
  renderScoreReportRows();
};

// 페이지네이션 헬퍼 — scores doc 정규화 (loadScoreReport / loadMoreScoreReport 공용)
function _srNormalize(docs, speakingMap, grammarMap) {
  return docs.map(doc => {
    const s = { id: doc.id, ...doc.data() };
    const m = s.mode || 'vocab';
    return {
      ...s,
      bookName: s.bookName || s.unitName || '-',
      testName: s.testName || '-',
      mode: m,
      score: s.score || 0,
      correct: s.correct || 0,
      // scores 자체 메타 우선 (시험 삭제돼도 판정 — 2026-05-16) → 없으면 genTests fetch 폴백
      _isSpeaking: s.vocabFormat === 'speaking' || (!s.vocabFormat && !!speakingMap[s.testId]),
      _isGrammar: s.subType === 'grammar' || (!s.subType && !!grammarMap[s.testId]),
      _dateTime: s.createdAt?.toDate
        ? s.createdAt.toDate().toLocaleString('ko-KR', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
        : s.date || '',
    };
  });
}

// testId 들의 speaking/grammar 메타만 fetch — 학원 전체 X
// genTests Rules(academyId 검증) 는 documentId() in 쿼리에 academyId 정적
// 제약이 없으면 permission-denied 로 거부 → 옛 in 쿼리는 항상 실패해 배지 전멸.
// 개별 getDoc 은 단일 doc read 라 match /genTests/{testId} 가 각 doc 의
// academyId == myAcademyId 를 평가 → 같은 학원이면 통과. reads 동일(N개).
async function _srLoadTestMeta(testIds) {
  const speakingMap = {}, grammarMap = {};
  if (!testIds.length) return { speakingMap, grammarMap };
  const snaps = await Promise.all(testIds.map(id =>
    getDoc(doc(db, 'genTests', id)).catch(() => null)
  ));
  snaps.forEach(d => {
    if (!d || !d.exists?.()) return;
    const t = d.data();
    if ((t.testMode || 'vocab') === 'vocab' && t.vocabOptions?.format === 'speaking') speakingMap[d.id] = true;
    if ((t.testMode || '').toLowerCase() === 'mcq' && Array.isArray(t.questions) && t.questions[0]?.subType === 'grammar') grammarMap[d.id] = true;
  });
  return { speakingMap, grammarMap };
}

function _srRenderLoadMore() {
  const wrap = document.getElementById('srLoadMoreWrap');
  if (!wrap) return;
  const searchQ = (document.getElementById('scoreSearch')?.value || '').trim();
  if (searchQ) {
    wrap.innerHTML = '<div style="text-align:center;color:#888;padding:10px;font-size:11px;">이름 검색 모드 — 기간 내 모든 응시에서 검색</div>';
    return;
  }
  if (_srState.exhausted) {
    wrap.innerHTML = '<div style="text-align:center;color:#888;padding:10px;font-size:12px;">기간 내 모두 표시됨 · 더 보려면 시작일을 앞당겨 [조회]</div>';
  } else {
    wrap.innerHTML = '<button id="srLoadMoreBtn" class="btn btn-secondary" style="margin:10px auto;display:block;" onclick="loadMoreScoreReport()">+ 더 보기</button>';
  }
}

// scores 쿼리 빌더 — date/group/mode 조건부 추가 (composite index 활용)
// 이름 검색 모드면 limit 1000 (기간 내 전체에서 client filter)
function _srBuildConstraints(params, useCursor) {
  const searchQ = (document.getElementById('scoreSearch')?.value || '').trim();
  // 이름 검색 시 최근 30일로 강제 override (학원장 안내문 명시)
  const fromForSearch = searchQ ? _ymdDaysAgoKST(30) : params.from;
  const constraints = [
    where('academyId', '==', window.MY_ACADEMY_ID),
    where('date', '>=', fromForSearch),
  ];
  if (!searchQ && params.to) constraints.push(where('date', '<=', params.to));
  if (params.group) constraints.push(where('group', '==', params.group));
  if (params.mode) constraints.push(where('mode', '==', params.mode));
  constraints.push(orderBy('date', 'desc'));
  constraints.push(orderBy('createdAt', 'desc'));
  if (useCursor && _srState.lastDoc) constraints.push(startAfter(_srState.lastDoc));
  constraints.push(limit(searchQ ? 300 : SR_PAGE_SIZE));
  return constraints;
}

window.loadScoreReport = async() => {
  const el = document.getElementById('scoreReportBody');
  el.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#bbb;padding:20px;">로딩 중...</td></tr>';
  try {
    // 페이지네이션 상태 리셋
    _srState.lastDoc = null;
    _srState.exhausted = false;
    _srData = [];

    // 조회 조건 — from 비어있으면 월초 자동, group/mode 도 server-side 필터
    const fromInput = document.getElementById('scoreFrom').value;
    const from = fromInput || _ymdDaysAgoKST(1);
    const to = document.getElementById('scoreTo').value;
    const group = document.getElementById('scoreClassFilter')?.value || '';
    const mode = document.getElementById('scoreModeFilter')?.value || '';
    _srState.params = { from, to, group, mode };

    const snap = await getDocs(query(collection(db, 'scores'), ..._srBuildConstraints(_srState.params, false)));

    _srState.lastDoc = snap.docs[snap.docs.length - 1] || null;
    _srState.exhausted = snap.size < SR_PAGE_SIZE;

    // testId 들의 speaking/grammar 메타만 — 학원 전체 genTests fetch X
    const testIds = [...new Set(snap.docs.map(d => d.data().testId).filter(Boolean))];
    const { speakingMap, grammarMap } = await _srLoadTestMeta(testIds);

    _srData = _srNormalize(snap.docs, speakingMap, grammarMap);
    _srSort = { col: 'date', dir: 'desc' };
    renderScoreReportRows();
    _srRenderLoadMore();
  } catch(e) {
    console.error('loadScoreReport:', e);
    el.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';
  }
};

window.loadMoreScoreReport = async() => {
  if (_srState.exhausted || !_srState.lastDoc) return;
  const btn = document.getElementById('srLoadMoreBtn');
  if (btn) { btn.disabled = true; btn.textContent = '로딩 중...'; }
  try {
    const params = _srState.params || { from: _ymdDaysAgoKST(1) };
    const snap = await getDocs(query(collection(db, 'scores'), ..._srBuildConstraints(params, true)));

    _srState.lastDoc = snap.docs[snap.docs.length - 1] || _srState.lastDoc;
    _srState.exhausted = snap.size < SR_PAGE_SIZE;

    const testIds = [...new Set(snap.docs.map(d => d.data().testId).filter(Boolean))];
    const { speakingMap, grammarMap } = await _srLoadTestMeta(testIds);

    _srData = _srData.concat(_srNormalize(snap.docs, speakingMap, grammarMap));
    renderScoreReportRows();
    _srRenderLoadMore();
  } catch(e) {
    console.error('loadMoreScoreReport:', e);
    if (btn) { btn.disabled = false; btn.textContent = '+ 더 보기'; }
  }
};

// ─── 유형별 상세 빌더 (학생앱과 동일) ────────────────────────────────
function _adminVqBuildDetail(questions, answers){
  if(!questions||!answers) return '';
  return (questions||[]).map((q,i)=>{
    const a=answers[i]||{};
    const dir=a.direction||'en2ko';
    const prompt=dir==='en2ko'?(q.word||''):(q.meaning||'');
    const target=dir==='en2ko'?(q.meaning||''):(q.word||'');
    const user=(a.input||'').trim();
    // 말하기 모드는 spkCorrect 우선 (input 은 정답 시 q.word, 오답 시 빈 문자열이라 신뢰 X)
    const isSpeaking = a.format === 'speaking';
    const isCorrect = isSpeaking
      ? a.spkCorrect === true
      : (user && user.toLowerCase() === target.trim().toLowerCase());
    const bg=isCorrect?'#F0FDF4':'#FEF2F2';
    const border=isCorrect?'#BBF7D0':'#FECACA';
    const formatLabel = a.format==='mcq' ? '객관식' : (isSpeaking ? '🎤 말하기' : '단답');
    // 동음이의어 매칭으로 통과한 경우 표시 (q.homophones 에 들린 단어가 있는지)
    // AI 거친 경우 spkHeard 는 정답(q.word) 이라 무의미 → spkAiHeard(실제 발음) 우선
    const _heardRaw = a.spkAiHeard || a.spkHeard;
    const heardLower = String(_heardRaw||'').toLowerCase().trim();
    const matchedHomophone = isSpeaking && isCorrect && heardLower && heardLower !== String(q.word||'').toLowerCase().trim()
      ? heardLower : null;
    return `
      <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:10px 12px;margin-bottom:8px;text-align:left;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:11px;color:var(--gray);font-weight:700;">Q${i+1}</span>
          <span style="font-size:12px;color:${isCorrect?'#059669':'#dc2626'};font-weight:700;">${isCorrect?'✓ 정답':'✗ 오답'}</span>
          <span style="font-size:10px;color:var(--gray);">${dir==='en2ko'?'영→한':'한→영'} · ${formatLabel}</span>
        </div>
        <div style="font-size:13px;color:var(--text);margin-bottom:3px;font-weight:600;">${esc(prompt)}</div>
        <div style="font-size:11px;color:var(--gray);">
          ${isSpeaking
            ? (() => {
                // 차수별 통과 라벨 (2026-05-23 신 흐름)
                // webspeech-1/2/3 = 어느 차수에서 통과/실패 / 옛 데이터: 'webspeech'(1차) / 'ai'(AI 통과) / 'ai-error'(AI 오류)
                const src = String(a.spkSource || '').toLowerCase();
                let _stageHtml = '';
                if (isCorrect) {
                  if (src === 'webspeech-1' || src === 'webspeech') _stageHtml = ' · <span style="color:#059669;font-weight:600;">1차 통과</span>';
                  else if (src === 'webspeech-2') _stageHtml = ' · <span style="color:#CA8A04;font-weight:600;">2차 통과 (한국어)</span>';
                  else if (src === 'webspeech-3') _stageHtml = ' · <span style="color:#CA8A04;font-weight:600;">3차 통과 (문장)</span>';
                  else if (src === 'ai') _stageHtml = ' · <span style="color:#7C3AED;font-weight:600;">AI 통과 (옛)</span>';
                }
                // AI 정확도 (옛 데이터만 — 새 흐름엔 없음)
                const _c = a.spkAiConfidence;
                const _accHtml = (typeof _c === 'number')
                  ? ` · <span style="color:${_c>=90?'#059669':_c>=70?'#CA8A04':'#dc2626'};">정확도 ${_c}%</span>`
                  : '';
                const _att = a.spkAttempts;
                const _attHtml = (typeof _att === 'number' && _att > 0) ? ` · ${_att}회` : '';
                // 힌트 사용 (신 흐름 — 점수 영향 없음, 학원장 참고용)
                const _hint = a.spkHintUsed;
                const _hintHtml = (typeof _hint === 'number' && _hint > 0) ? ` · <span style="color:#7C3AED;">힌트 ${_hint}자</span>` : '';
                // 오답 케이스 구분 — spkSource 있으면 시도함, _heardRaw 있으면 들린 단어 / 없으면 음성 미감지
                //                    spkSource 없으면 SKIP 버튼 누름 (vqSkip → _vqSpkFinalize 미호출)
                let _heardLabel;
                if (_heardRaw) {
                  _heardLabel = `들린 단어: "${esc(_heardRaw)}"`;
                } else if (a.spkSource) {
                  _heardLabel = '<span title="3회 시도했으나 음성이 인식되지 않음 (조용함·소음 등)">(음성 미감지)</span>';
                } else {
                  _heardLabel = '<span title="학생이 SKIP 버튼을 눌러 시도 안 함">(건너뜀)</span>';
                }
                return `<span style="color:${isCorrect?'#059669':'#dc2626'};">${_heardLabel}</span>${matchedHomophone ? ` <span style="color:#7C3AED;font-weight:600;">🔊 동음이의어 매칭</span>` : ''} · <span style="color:#059669;">정답: ${esc(target)}</span>${_stageHtml}${_accHtml}${_attHtml}${_hintHtml}`;
              })()
            : `<span style="color:${isCorrect?'#059669':'#dc2626'};">내답: ${esc(user||'(미입력)')}</span>${!isCorrect?` · <span style="color:#059669;">정답: ${esc(target)}</span>`:''}`}
        </div>
      </div>`;
  }).join('');
}
function _adminMcqBuildDetail(questions, answers){
  if(!questions||!answers) return '';
  const markers=['①','②','③','④','⑤'];
  return (questions||[]).map((q,i)=>{
    const userIdx=answers[i];
    const correctIdx=(q.choices||[]).findIndex(c=>c.isAnswer===true);
    const isCorrect=userIdx===correctIdx;
    const userChoice=(q.choices||[])[userIdx];
    const correctChoice=(q.choices||[])[correctIdx];
    const bg=isCorrect?'#F0FDF4':'#FEF2F2';
    const border=isCorrect?'#BBF7D0':'#FECACA';
    return `
      <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:10px 12px;margin-bottom:8px;text-align:left;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:11px;color:var(--gray);font-weight:700;">Q${i+1}</span>
          <span style="font-size:12px;color:${isCorrect?'#059669':'#dc2626'};font-weight:700;">${isCorrect?'✓ 정답':'✗ 오답'}</span>
        </div>
        <div style="font-size:12px;color:var(--text);line-height:1.4;margin-bottom:4px;font-weight:600;">${esc(q.question||'')}</div>
        ${q.questionKo?`<div style="font-size:11px;color:var(--gray);margin-bottom:5px;">${esc(q.questionKo)}</div>`:''}
        <div style="font-size:11px;color:var(--gray);">
          <span style="color:${isCorrect?'#059669':'#dc2626'};">내답: ${userIdx!=null?`${markers[userIdx]||''} ${esc(userChoice?.text||'')}`:'(미선택)'}</span>
          ${!isCorrect&&correctChoice?`<br><span style="color:#059669;">정답: ${markers[correctIdx]||''} ${esc(correctChoice.text||'')}</span>`:''}
        </div>
      </div>`;
  }).join('');
}
function _adminFbBuildDetail(questions, answers, detail){
  if(!questions) return '';
  return (questions||[]).map((q,i)=>{
    const d=detail?.[i]||{correct:0,total:0,stage:0};
    const allCorrect=d.correct===d.total && d.total>0;
    const stageIcon=d.stage===2?'💡💡':d.stage===1?'💡':'';
    const stageLabel=d.stage===2?'해석+첫글자':d.stage===1?'해석':'';
    const userAns=(answers?.[i]||[]).join(', ')||'(미입력)';
    const correctAns=(q.blanks||[]).join(', ');
    const bg=allCorrect?'#F0FDF4':(d.correct>0?'#FFFBEB':'#FEF2F2');
    const border=allCorrect?'#BBF7D0':(d.correct>0?'#FEF3C7':'#FECACA');
    return `
      <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:10px 12px;margin-bottom:8px;text-align:left;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:11px;color:var(--gray);font-weight:700;">Q${i+1}</span>
          <span style="font-size:12px;color:${allCorrect?'#059669':'#dc2626'};font-weight:700;">${allCorrect?'✓':(d.correct>0?'△':'✗')} ${d.correct}/${d.total}</span>
          ${stageIcon?`<span style="font-size:10px;background:#FED7AA;color:#9A3412;padding:2px 6px;border-radius:10px;font-weight:600;">${stageIcon} ${stageLabel}</span>`:''}
        </div>
        <div style="font-size:12px;color:var(--text);line-height:1.4;margin-bottom:3px;">${esc(q.sentence||'')}</div>
        <div style="font-size:11px;color:var(--gray);">
          <span style="color:${allCorrect?'#059669':'#dc2626'};">내답: ${esc(userAns)}</span>
          ${!allCorrect?` · <span style="color:#059669;">정답: ${esc(correctAns)}</span>`:''}
        </div>
      </div>`;
  }).join('');
}
function _adminUqBuildDetail(questions, answers){
  if(!questions||!answers) return '';
  return (questions||[]).map((q,i)=>{
    const ans=answers[i]||{placed:[],chunks:[]};
    const userChunks=(ans.placed||[]).map(idx=>(ans.chunks||[])[idx]?.text||'').filter(Boolean);
    const targetChunks=(q.chunkedSentence||'').split('/').map(c=>c.trim()).filter(Boolean);
    const isCorrect=userChunks.length===targetChunks.length && userChunks.every((c,j)=>c===targetChunks[j]);
    const bg=isCorrect?'#F0FDF4':'#FEF2F2';
    const border=isCorrect?'#BBF7D0':'#FECACA';
    return `
      <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:10px 12px;margin-bottom:8px;text-align:left;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:11px;color:var(--gray);font-weight:700;">Q${i+1}</span>
          <span style="font-size:12px;color:${isCorrect?'#059669':'#dc2626'};font-weight:700;">${isCorrect?'✓ 정답':'✗ 오답'}</span>
        </div>
        ${q.meaningKo?`<div style="font-size:12px;color:var(--gray);margin-bottom:4px;">${esc(q.meaningKo)}</div>`:''}
        <div style="font-size:11px;color:var(--gray);line-height:1.6;">
          <span style="color:${isCorrect?'#059669':'#dc2626'};">내답: ${esc(userChunks.join(' / ')||'(미제출)')}</span>
          ${!isCorrect?`<br><span style="color:#059669;">정답: ${esc(targetChunks.join(' / '))}</span>`:''}
        </div>
      </div>`;
  }).join('');
}
// 녹음숙제 회차별 상세 — 학원장 공유 빌더. #1 시험관리/시험목록/진도체크 학생별
// 풀카드 와 #3 성적 상세 모달 이 동일 내용을 쓰도록 단일화. (시간·말소리%·속도WPM·
// 점수·note·AI 피드백 모두 포함). clickSafe: 부모가 클릭 가능한 카드(#1)면
// audio·details 클릭이 모달 열기와 충돌 안 하게 stopPropagation.
function _adminRecBuildDetail(recordings, fullText, opts){
  if(!Array.isArray(recordings)||!recordings.length) return '';
  const stop = (opts && opts.clickSafe) ? ' onclick="event.stopPropagation()"' : '';
  const ftWords = String(fullText||'').trim().split(/\s+/).filter(Boolean).length;
  // Phase B: 통과/불통 폐기 — 모든 회차 동일 배경. Phase C: 카테고리 점수+코멘트 표시
  return recordings.map((r,i)=>{
    const score = (typeof r.score === 'number') ? r.score : null;
    const isLast = i === recordings.length - 1;
    const audio = r.audioUrl || r.url || '';
    const fb = r.feedback;  // 마지막 회차에만 있음
    const cs = r.categoryScores;
    const cc = r.categoryComments;
    const hasCat = cs && (typeof cs.pronunciation === 'number' || typeof cs.intonation === 'number' || typeof cs.pace === 'number' || typeof cs.accuracy === 'number');
    const positives = fb?.positives || [];
    const va = (typeof r.voiceActivity === 'number') ? Math.round(r.voiceActivity * 100) + '%' : '-';
    // 표준 시간 (150 WPM 기준) — 본문 단어수로부터 계산. 학생 시간 / 표준 시간 비율 표시
    const expectedSec = (ftWords >= 30) ? Math.round((ftWords / 150) * 60) : null;
    let dur;
    if (r.duration) {
      if (expectedSec) {
        const ratio = Math.round((r.duration / expectedSec) * 100);
        const ratioColor = ratio >= 70 ? '#16a34a' : (ratio >= 30 ? '#f59e0b' : '#dc2626');
        dur = `${r.duration}초/${expectedSec}초 <b title="학생 녹음 시간 / 본문 표준 시간 (150 WPM 기준). 30% 미만 = 부분 읽기 의심" style="color:${ratioColor};">(${ratio}%)</b>`;
      } else {
        dur = r.duration + '초';
      }
    } else {
      dur = '-';
    }
    const wpm = (r.duration > 0 && ftWords > 0) ? Math.round((ftWords / r.duration) * 60) : 0;
    const wpmTxt = wpm > 0 ? ` · 속도 ${wpm} WPM` : '';
    // 학원장 참고용 음향 지표 (학생 비공개). 거부 아닌 안내로 전환됨 — 낮은 명료도/높은 단조는 색으로 표시.
    const vbrPct = (typeof r.voiceBandRatio === 'number') ? Math.round(r.voiceBandRatio * 100) : null;
    const monoPct = (typeof r.monotony === 'number') ? Math.round(r.monotony * 100) : null;
    const vbrColor = vbrPct == null ? '' : (vbrPct >= 40 ? '#16a34a' : '#dc2626');
    const monoColor = monoPct == null ? '' : (monoPct <= 55 ? '#16a34a' : '#dc2626');
    // 학원장 참고 음향 지표 — 말소리·속도 옆 같은 줄에 이어 붙임 (학생 비공개)
    const acousticInline =
      (vbrPct != null ? ` · <span title="실제 사람 음성 대역(300~3400Hz) 에너지 비율 — 낮으면 웅얼거림·잡음·비음성 의심">명료도 <b style="color:${vbrColor};">${vbrPct}%</b></span>` : '') +
      (monoPct != null ? ` · <span title="피치 변화가 적을수록 높음(100%=완전 단조) — 무성의·기계적 읽기 의심">단조로움 <b style="color:${monoColor};">${monoPct}%</b></span>` : '');
    // 완독률 — AI 의 transcribedWords 와 본문 단어 매칭 비율 (학생 비공개, 학원장 참고)
    const compRate = (typeof r.completionRate === 'number') ? r.completionRate : null;
    const compColor = compRate == null ? '' : (compRate >= 70 ? '#16a34a' : (compRate >= 40 ? '#f59e0b' : '#dc2626'));
    const compInfo = (typeof r.heardWordCount === 'number' && typeof r.bookWordCount === 'number')
      ? ` (${r.heardWordCount}/${r.bookWordCount} 단어)` : '';
    const completionInline = (compRate != null)
      ? ` · <span title="AI 가 audio 에서 들었다고 보고한 영단어와 본문 단어 매칭 비율 — 본문 전체를 다 읽었는지 판단${compInfo}">완독률 <b style="color:${compColor};">${compRate}%</b></span>`
      : '';
    const catBadge = (label, color, scoreVal, comment) => {
      if (typeof scoreVal !== 'number' && !comment) return '';
      return `<div style="margin-top:3px;font-size:11px;line-height:1.5;"><span style="background:${color};color:white;padding:1px 7px;border-radius:3px;font-weight:700;margin-right:5px;">${label}${typeof scoreVal === 'number' ? ' ' + scoreVal : ''}</span>${comment ? esc(comment) : ''}</div>`;
    };
    return `
      <div style="background:#f8f9fa;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin-bottom:8px;text-align:left;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
          <span style="font-size:11px;color:var(--gray);font-weight:700;">${isLast?'최종':(i+1)+'회차'}</span>
          ${score!=null?`<span style="font-size:12px;color:#0369a1;font-weight:700;">${score}점</span>`:''}
          <span style="font-size:10px;color:var(--gray);">${dur} · 말소리 ${va}${wpmTxt}${acousticInline}${completionInline}</span>
          ${isLast ? '<span style="font-size:10px;color:#7C3AED;font-weight:700;">← AI 평가</span>' : ''}
        </div>
        ${r.sentence?`<div style="font-size:12px;color:var(--text);line-height:1.4;margin-bottom:6px;">${esc(r.sentence)}</div>`:''}
        ${audio?`<audio src="${esc(audio)}" controls preload="none"${stop} style="width:100%;height:30px;"></audio>`:''}
        ${r.note?`<div style="font-size:11px;color:var(--gray);margin-top:6px;">${esc(r.note)}</div>`:''}
        ${(hasCat || positives.length || (Array.isArray(fb?.missedWords) && fb.missedWords.length) || (Array.isArray(fb?.weakPronunciation) && fb.weakPronunciation.length) || (Array.isArray(fb?.tips) && fb.tips.length)) ? `
          <details open${stop} style="margin-top:8px;">
            <summary style="font-size:11px;color:#7C3AED;cursor:pointer;font-weight:700;">${iconSvg('bot')} AI 피드백 (마지막 회차)</summary>
            <div style="margin-top:6px;padding:8px 10px;background:#faf5ff;border-radius:6px;font-size:11px;line-height:1.6;">
              ${hasCat ? `<div style="margin-bottom:6px;"><strong>${iconSvg('chart')} 항목별 점수·코멘트</strong>
                ${catBadge('🔊 발음', '#3b82f6', cs?.pronunciation, cc?.pronunciation)}
                ${catBadge('🎵 억양', '#22c55e', cs?.intonation, cc?.intonation)}
                ${catBadge('🏃 속도', '#eab308', cs?.pace, cc?.pace)}
                ${catBadge('🎯 정확도', '#a855f7', cs?.accuracy, cc?.accuracy)}
              </div>` : ''}
              ${positives.length ? `<div style="margin-top:4px;"><strong>👍 잘한 점:</strong> ${positives.map(esc).join(' · ')}</div>` : ''}
              ${Array.isArray(fb?.missedWords) && fb.missedWords.length ? `<div style="margin-top:4px;"><strong>${iconSvg('pen')} 생략:</strong> ${fb.missedWords.map(esc).join(', ')}</div>` : ''}
              ${Array.isArray(fb?.weakPronunciation) && fb.weakPronunciation.length ? `<div style="margin-top:4px;"><strong>🔊 발음 개선:</strong> ${fb.weakPronunciation.map(p=>`<div style="margin-top:2px;">• <strong>${esc(p.word||'')}</strong> — ${esc(p.issue||'')}</div>`).join('')}</div>` : ''}
              ${Array.isArray(fb?.tips) && fb.tips.length ? `<div style="margin-top:4px;"><strong>${iconSvg('lightbulb')} 팁:</strong> ${fb.tips.map(esc).join(' · ')}</div>` : ''}
            </div>
          </details>` : ''}
      </div>`;
  }).join('');
}
function _adminBuildDetail(mode, comp){
  const m=String(mode||'').toLowerCase();
  if(m==='vocab')       return _adminVqBuildDetail(comp.questions, comp.answers);
  if(m==='mcq')         return _adminMcqBuildDetail(comp.questions, comp.answers);
  if(m==='fill_blank')  return _adminFbBuildDetail(comp.questions, comp.answers, comp.detail);
  if(m==='unscramble')  return _adminUqBuildDetail(comp.questions, comp.answers);
  if(m==='recording')   return _adminRecBuildDetail(comp.recordings, comp._recFullText || '');
  return '';
}

window.showScoreDetail = async(scoreId, testId) => {
  try{
    const scoreDoc = await getDoc(doc(db,'scores',scoreId));
    if (!scoreDoc.exists()) { showAlert('입력 확인', '데이터 없음'); return; }
    const s = scoreDoc.data();
    const mode = s.mode || '';

    // genTests 기반 상세 시도
    let genTest=null, comp=null;
    if(testId){
      try{
        const [tSnap, cSnap] = await Promise.all([
          getDoc(doc(db,'genTests',testId)),
          s.uid ? getDoc(doc(db,'genTests',testId,'userCompleted',s.uid)) : Promise.resolve(null),
        ]);
        if(tSnap.exists()) genTest = tSnap.data();
        if(cSnap && cSnap.exists?.()) comp = cSnap.data();
      }catch(e){ console.warn('genTest 조회 실패', e); }
    }

    // 응시 순번 — 이 학생·이 시험 전체 scores 중 현재 기록이 몇 번째 (createdAt 오름차순)
    let attemptLabel = '';
    if(testId && s.uid){
      try{
        // scores Rules(academyId==myAcademyId) 통과 위해 academyId 정적 제약 필수
        // (없으면 permission-denied → catch → 라벨 안 뜸)
        const aSnap = await getDocs(query(
          collection(db,'scores'),
          where('academyId','==', s.academyId || window.MY_ACADEMY_ID),
          where('testId','==',testId),
          where('uid','==',s.uid),
          orderBy('createdAt','asc')
        ));
        const ids = aSnap.docs.map(d=>d.id);
        const idx = ids.indexOf(scoreId);
        if(ids.length>1 && idx>=0) attemptLabel = `${ids.length}회 응시 중 ${idx+1}번째`;
        else if(ids.length===1) attemptLabel = `1회 응시`;
      }catch(e){ console.warn('응시 순번 조회 실패(인덱스 빌드중?)', e); }
    }

    const bookName = s.bookName || genTest?.bookName || s.unitName || '-';
    const testName = s.testName || genTest?.name || '-';
    const isRecording = mode === 'recording';
    const passScore = s.passScore || genTest?.passScore || 80;
    // Phase B: 녹음숙제는 통과/불통 폐기 — 무조건 passed 로 간주 (상세 차단 X)
    const passed = isRecording ? true : (s.passed || (s.score>=passScore));
    const pct = s.score || 0;
    const badge = pct>=80?'badge-green':pct>=60?'badge-amber':'badge-red';

    // 상세 본문 결정
    // _writeUserCompleted는 최고점 통과 시에만 questions/answers를 저장함
    //   - 미통과(passed=false) → 스냅샷 없음 → '미통과' 안내
    //   - 통과했지만 기존 최고점 이하인 재응시 → 스냅샷 있으나 이번 score와 불일치 → '재응시' 안내
    //   - genTests 자체가 없는 진짜 레거시 → '레거시' 안내
    const hasDetail = comp && (
      (comp.questions && comp.answers) ||
      (isRecording && Array.isArray(comp.recordings) && comp.recordings.length)
    );
    const isThisAttemptBest = hasDetail && comp.score === s.score && (comp.date||'') === (s.date||'');

    // 녹음숙제 WPM 계산용 본문 — genTest 첫 문제 fullText (공유 빌더 _adminRecBuildDetail 인자)
    if (comp && isRecording) comp._recFullText = genTest?.questions?.[0]?.fullText || '';

    let detailHtml;
    if(isThisAttemptBest){
      detailHtml = _adminBuildDetail(mode, comp);
    } else if(isRecording && hasDetail) {
      // Phase B: 녹음숙제는 통과/불통 분기 폐기 — recordings 있으면 무조건 상세 표시
      detailHtml = _adminBuildDetail(mode, comp);
    } else if(!genTest){
      // testId 있는데 genTests 없음 = 학원장이 시험 삭제 (scores 는 이력 보존, 상세는 cascade 제거)
      // testId 빈값 = 진짜 옛 레거시 데이터
      const _deleted = !!(s.testId && String(s.testId).trim());
      detailHtml = _deleted
        ? `<div style="text-align:center;padding:24px 12px;color:var(--gray);font-size:12px;line-height:1.6;">
            <div style="font-size:24px;margin-bottom:6px;">${iconSvg('trash')}</div>
            <div style="font-weight:600;color:#888;">삭제된 시험 - 상세 답안을 볼 수 없습니다</div>
            <div style="font-size:11px;color:#bbb;margin-top:4px;">점수는 보존되나, 상세 답안은 시험 삭제 시 함께 제거됩니다</div>
          </div>`
        : `<div style="text-align:center;padding:24px 12px;color:var(--gray);font-size:12px;line-height:1.6;">
            <div style="font-size:24px;margin-bottom:6px;">📄</div>
            <div style="font-weight:600;color:#888;">레거시 시험 - 상세 답안 정보가 없습니다</div>
            <div style="font-size:11px;color:#bbb;margin-top:4px;">점수 요약만 제공됩니다</div>
          </div>`;
    } else if(isRecording) {
      // 녹음숙제인데 recordings 없음 = 옛 미통과 데이터 (recordings 미저장)
      detailHtml = `<div style="text-align:center;padding:24px 12px;color:var(--gray);font-size:12px;line-height:1.6;">
        <div style="font-size:24px;margin-bottom:6px;">📄</div>
        <div style="font-weight:600;color:#888;">옛 응시 기록 - 녹음·피드백 데이터가 저장되지 않은 시험</div>
        <div style="font-size:11px;color:#bbb;margin-top:4px;">점수 요약만 제공됩니다</div>
      </div>`;
    } else if(!passed){
      detailHtml = `<div style="text-align:center;padding:24px 12px;color:var(--gray);font-size:12px;line-height:1.6;">
        <div style="font-size:24px;margin-bottom:6px;">⚠️</div>
        <div style="font-weight:600;color:#b45309;">미통과 기록 - 상세 답안이 저장되지 않습니다</div>
        <div style="font-size:11px;color:#bbb;margin-top:4px;">상세는 통과한 최고점 기록에만 저장됩니다</div>
      </div>`;
    } else {
      detailHtml = `<div style="text-align:center;padding:24px 12px;color:var(--gray);font-size:12px;line-height:1.6;">
        <div style="font-size:24px;margin-bottom:6px;">🔁</div>
        <div style="font-weight:600;color:#888;">재응시 기록 - 기존 최고점보다 낮아 상세가 저장되지 않았습니다</div>
        <div style="font-size:11px;color:#bbb;margin-top:4px;">${comp?.score!=null?`최고점 ${comp.score}점 기록의 상세만 확인 가능합니다`:''}</div>
      </div>`;
    }

    const dateStr = `${s.date||''} ${s.createdAt?.toDate?s.createdAt.toDate().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):''}`.trim();
    // 녹음숙제 + recordings 있을 때만 [🔁 재평가] (한 줄 카드 최소화로 카드의 재평가 버튼이 모달로 이동)
    const reEvalBtn = (isRecording && Array.isArray(comp?.recordings) && comp.recordings.length)
      ? `<button class="btn btn-secondary" onclick="tpReEvaluateRecording('${esc(s.testId||'')}','${esc(s.uid||'')}','${esc(s.userName||'').replace(/'/g,"&#39;")}')" style="color:#7C3AED;border-color:#ddd6fe;" title="마지막 녹음을 AI 로 다시 평가 (학원 녹음 한도 +1)">🔁 재평가</button>`
      : '';
    showModal(`
      <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
        <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;">
            <div style="min-width:0;flex:1;">
              <div style="font-size:17px;font-weight:700;line-height:1.3;word-break:break-word;">
                📊 ${esc(s.userName)||'-'}
                <span style="font-size:12px;color:var(--gray);font-weight:400;">${esc(s.group)||''}</span>
              </div>
              <div style="font-size:11px;color:var(--gray);margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                ${_unifiedTypeBadge(mode)}
                <span style="word-break:break-word;">${esc(bookName)} · ${esc(testName)}</span>
                ${attemptLabel ? `<span style="color:#7c3aed;font-weight:600;">· ${esc(attemptLabel)}</span>` : ''}
              </div>
            </div>
            <span class="badge ${badge}" style="font-size:18px;padding:6px 14px;flex-shrink:0;">${pct}점</span>
          </div>
        </div>

        <div style="padding:16px 22px;overflow-y:auto;flex:1;">
          <div style="margin-bottom:16px;">
            <div style="font-weight:700;font-size:13px;margin-bottom:8px;">${iconSvg('clipboard')} 시험 결과</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
              <div style="background:#f0fafa;border-radius:8px;padding:12px 6px;text-align:center;">
                <div style="font-size:20px;font-weight:800;color:var(--teal);">${s.correct||0}</div>
                <div style="font-size:11px;color:var(--gray);margin-top:2px;">정답</div>
              </div>
              <div style="background:#fee2e2;border-radius:8px;padding:12px 6px;text-align:center;">
                <div style="font-size:20px;font-weight:800;color:#e05050;">${s.wrong||0}</div>
                <div style="font-size:11px;color:var(--gray);margin-top:2px;">오답</div>
              </div>
              <div style="background:#f8f9fa;border-radius:8px;padding:12px 6px;text-align:center;">
                <div style="font-size:20px;font-weight:800;color:#555;">${s.total||0}</div>
                <div style="font-size:11px;color:var(--gray);margin-top:2px;">전체</div>
              </div>
              ${isRecording
                ? `<div style="background:#dbeafe;border-radius:8px;padding:12px 6px;text-align:center;">
                    <div style="font-size:14px;font-weight:800;color:#1d4ed8;line-height:1.4;">📤<br>제출됨</div>
                    <div style="font-size:11px;color:var(--gray);margin-top:2px;">통과/불통 X</div>
                  </div>`
                : `<div style="background:${passed?'#d1fae5':'#fef9c3'};border-radius:8px;padding:12px 6px;text-align:center;">
                    <div style="font-size:14px;font-weight:800;color:${passed?'#059669':'#b45309'};line-height:1.4;">${passed?'✅':'⚠️'}<br>${passed?'통과':'미통과'}</div>
                    <div style="font-size:11px;color:var(--gray);margin-top:2px;">기준 ${passScore}점</div>
                  </div>`
              }
            </div>
          </div>

          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <div style="font-weight:700;font-size:13px;">${iconSvg('pen')} 문제별 상세</div>
              ${dateStr?`<div style="font-size:11px;color:#bbb;">${esc(dateStr)}</div>`:''}
            </div>
            <div style="word-break:break-word;">
              ${detailHtml}
            </div>
          </div>
        </div>

        <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div>${reEvalBtn}</div>
          <button class="btn btn-secondary" onclick="closeModal()">닫기</button>
        </div>
      </div>
    `);
  }catch(e){ showToast('상세 불러오기 실패: '+e.message); }
};

// 학생별 카드 클릭 → testId+uid 로 가장 최신 scores doc 찾아 showScoreDetail 호출.
// 시험 목록 / 시험관리 양쪽 학생 카드에서 사용.
window.tpOpenStudentScoreDetail = async (testId, uid) => {
  if (!testId || !uid) return;
  try {
    // academyId 필터 필수 — Rules 가 같은 학원만 허용 (없으면 권한 거부)
    const snap = await getDocs(query(
      collection(db, 'scores'),
      where('academyId', '==', window.MY_ACADEMY_ID),
      where('testId', '==', testId),
      where('uid', '==', uid)
    ));
    if (snap.empty) { showToast('점수 기록 없음'); return; }
    // client-side 정렬 (composite index 불필요)
    const docs = snap.docs.sort((a, b) => {
      const ta = a.data().createdAt?.toMillis?.() || 0;
      const tb = b.data().createdAt?.toMillis?.() || 0;
      return tb - ta;
    });
    window.showScoreDetail(docs[0].id, testId);
  } catch (e) {
    console.warn('[tpOpenStudentScoreDetail]', e);
    showToast('상세 불러오기 실패: ' + e.message);
  }
};

// 학생 목록 캐시 (검색·트리 재렌더 시 재사용)
let _personalStudents = [];
const _personalGroupOpen = new Set();   // 펼쳐진 반 이름들
let _personalSelectedUid = null;
let _personalScoreVisible = 20;   // 응시내역 표시 개수 (학생 클릭 시 reset, 더보기 시 +20)
let _personalScoreData = [];      // 학생 30일치 scores (응시내역 렌더용)

async function loadPersonalStudentList(){
  try{
    const snap=await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID),where('role','==','student'),where('status','==','active')));
    _personalStudents = snap.docs.map(d=>({id:d.id,...d.data()}));
    // 기본: 모든 반 닫힘 (검색 시에만 자동 펼침)
    _personalGroupOpen.clear();
    renderPersonalStudentTree();
  }catch(e){console.warn(e);}
}

window.renderPersonalStudentTree = () => {
  const el = document.getElementById('personalStudentList');
  if (!el) return;
  const kw = (document.getElementById('personalStudentSearch')?.value || '').trim().toLowerCase();

  // 매칭 학생 필터
  const matched = !kw ? _personalStudents : _personalStudents.filter(u => {
    return (u.name||'').toLowerCase().includes(kw)
        || (u.group||'').toLowerCase().includes(kw)
        || (u.grade||'').toLowerCase().includes(kw)
        || (u.username||'').toLowerCase().includes(kw);
  });

  // 반별 그룹화
  const byGroup = {};
  for (const u of matched) {
    const g = u.group || '(반 미지정)';
    (byGroup[g] = byGroup[g] || []).push(u);
  }
  const groups = Object.keys(byGroup).sort((a,b) => a.localeCompare(b, 'ko'));
  // 검색 중이면 매칭된 반은 자동 펼침
  if (kw) groups.forEach(g => _personalGroupOpen.add(g));

  if (groups.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:12px;">검색 결과 없음</div>';
    return;
  }

  el.innerHTML = groups.map(g => {
    const students = byGroup[g].sort((a,b) => (a.name||'').localeCompare(b.name||'', 'ko'));
    const isOpen = _personalGroupOpen.has(g);
    const arrow = isOpen ? '▾' : '▸';
    const studentRows = isOpen ? students.map(u => {
      const selected = _personalSelectedUid === u.id;
      return `
      <div onclick="loadPersonalScore('${esc(u.id)}')"
           style="padding:8px 12px 8px 28px;border-bottom:1px solid #f5f5f5;cursor:pointer;display:flex;align-items:center;gap:8px;${selected ? 'background:var(--teal-light);' : ''}"
           onmouseover="this.style.background='${selected ? 'var(--teal-light)' : '#f8f9fa'}'"
           onmouseout="this.style.background='${selected ? 'var(--teal-light)' : ''}'">
        <div style="width:24px;height:24px;border-radius:50%;background:${selected ? 'var(--teal-dark)' : 'var(--teal)'};color:white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${esc((u.name||'?').charAt(0))}</div>
        <div style="min-width:0;flex:1;">
          <div style="font-weight:${selected ? '700' : '600'};color:${selected ? 'var(--teal)' : 'var(--text)'};font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(u.name||'')}</div>
          ${u.grade ? `<div style="font-size:10px;color:var(--gray);">${esc(u.grade)}</div>` : ''}
        </div>
      </div>`;
    }).join('') : '';

    return `
      <div>
        <div onclick="togglePersonalGroup('${esc(g)}')"
             style="padding:9px 12px;background:#f8f9fa;border-bottom:1px solid #eee;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#475569;user-select:none;">
          <span style="font-size:10px;width:10px;display:inline-block;">${arrow}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(g)}</span>
          <span style="font-size:10px;color:var(--gray);font-weight:400;">${students.length}</span>
        </div>
        ${studentRows}
      </div>`;
  }).join('');
};

window.togglePersonalGroup = (groupName) => {
  if (_personalGroupOpen.has(groupName)) _personalGroupOpen.delete(groupName);
  else _personalGroupOpen.add(groupName);
  renderPersonalStudentTree();
};
window.loadPersonalScore = async(uid) => {
  if(!uid)return;
  const detail=document.getElementById('personalDetail');
  detail.innerHTML='<div class="loading"><div class="spinner"></div>로딩 중</div>';
  try{
    const userSnap=await getDoc(doc(db,'users',uid));
    const u=userSnap.data();
    // 최근 30일치만 fetch (server-side filter — 통계 + 응시내역 같은 데이터 소스, 2026-05-14)
    const _from30d = _ymdKST(new Date(Date.now() - 30*24*3600*1000));
    const scoresSnap=await getDocs(query(
      collection(db,'scores'),
      where('uid','==',uid),
      where('academyId','==',window.MY_ACADEMY_ID),
      where('date','>=', _from30d),
    ));
    const scores=scoresSnap.docs.map(d=>d.data())
      .sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
    // 통계 카드 (30일치 = 전체 데이터)
    const scores30d = scores;
    const avg30d = scores30d.length ? Math.round(scores30d.reduce((s,r)=>s+(r.score||0),0)/scores30d.length) : 0;
    const passed30d = scores30d.filter(s => (s.score||0) >= 80).length;
    // 응시내역 더보기 상태 (학생 새로 클릭 시 20 으로 reset)
    _personalScoreVisible = 20;
    _personalScoreData = scores;

    // 트리에서 활성 학생 마킹 + history 사전 로드
    _personalSelectedUid = uid;
    renderPersonalStudentTree();
    let history = [];
    try {
      const histSnap = await getDocs(query(
        collection(db, 'growthReports'),
        where('academyId', '==', window.MY_ACADEMY_ID),
        where('studentUid', '==', uid),
        orderBy('generatedAt', 'desc'),
        limit(10),
      ));
      history = histSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) { console.warn('[history fetch]', e.message); }
    _grHistoryCache = history;
    _grStudentUid = uid;

    // 이력 표 (또는 안내문) — 5건씩 페이지네이션
    const historyHtml = history.length === 0
      ? `<div style="padding:14px 16px;text-align:center;color:var(--gray);font-size:12px;background:#f8fafc;border-radius:8px;">이전 성장 리포트가 없습니다. [📈 새 리포트 생성] 클릭 시 첫 리포트를 만들어요.</div>`
      : `<table style="width:100%;font-size:12px;border-collapse:collapse;table-layout:fixed;">
          <colgroup>
            <col style="width:90px;">
            <col style="width:54px;">
            <col style="width:54px;">
            <col>
            <col style="width:32px;">
            <col style="width:38px;">
          </colgroup>
          <thead style="background:#f8fafc;">
            <tr>
              <th style="text-align:left;padding:8px 10px;font-weight:600;">생성일</th>
              <th style="text-align:right;padding:8px 10px;font-weight:600;">평균</th>
              <th style="text-align:right;padding:8px 10px;font-weight:600;">응시</th>
              <th style="text-align:left;padding:8px 10px;font-weight:600;">요약</th>
              <th style="text-align:center;padding:8px 6px;font-weight:600;"></th>
              <th style="text-align:center;padding:8px 6px;font-weight:600;"></th>
            </tr>
          </thead>
          <tbody id="grHistoryBody"></tbody>
        </table>
        <div id="grHistoryPag" class="tbl-pagination"></div>`;

    detail.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
        <div class="card-title" style="margin:0;">${esc(u.name)} · ${esc(u.group)||'-'}</div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:11px;color:var(--gray);background:#f0fafa;border:1px solid var(--teal-light);border-radius:14px;padding:3px 10px;">📅 AI 리포트 작성 기준: 최근 30일</span>
          <button class="btn btn-primary" style="font-size:12px;padding:6px 12px;" onclick="openGrowthReport('${esc(uid)}')">📈 새 리포트 생성</button>
        </div>
      </div>

      <div style="margin-bottom:18px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:8px;">📚 이전 성장 리포트${history.length ? ` (${history.length}건)` : ''}</div>
        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;">${historyHtml}</div>
      </div>
      <div style="font-weight:700;font-size:13px;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
        📊 최근 30일 통계
        <span style="font-size:11px;color:var(--gray);font-weight:400;">${esc(_from30d)} ~ ${esc(_ymdKST())}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
        <div style="background:#f8f9fa;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:24px;font-weight:800;color:var(--teal);">${scores30d.length}</div>
          <div style="font-size:12px;color:var(--gray);margin-top:2px;">응시 횟수</div>
        </div>
        <div style="background:#f8f9fa;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:24px;font-weight:800;color:var(--teal);">${avg30d}점</div>
          <div style="font-size:12px;color:var(--gray);margin-top:2px;">평균 점수</div>
        </div>
        <div style="background:#f8f9fa;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:24px;font-weight:800;color:var(--teal);">${passed30d}</div>
          <div style="font-size:12px;color:var(--gray);margin-top:2px;">80점 이상</div>
        </div>
      </div>
      <div style="font-weight:700;font-size:13px;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
        📊 응시 내역
        <span style="font-size:11px;color:var(--gray);font-weight:400;">(최근 30일 · 20건 단위 더보기)</span>
      </div>
      <div class="table-wrap">
        <table style="table-layout:fixed;width:100%;">
          <colgroup>
            <col style="width:40px;">
            <col style="width:100px;">
            <col>
            <col>
            <col style="width:70px;">
            <col style="width:70px;">
            <col style="width:90px;">
          </colgroup>
          <thead><tr><th>No</th><th>유형</th><th>교재명</th><th>시험명</th><th>점수</th><th>정답/전체</th><th>날짜</th></tr></thead>
          <tbody id="personalScoreBody"></tbody>
        </table>
        <div id="personalScoreLoadMore" style="padding:12px;text-align:center;"></div>
      </div>
    `;

    // 이전 성장 리포트 표 — 5건씩 페이지네이션 (history 가 비어있지 않을 때만)
    if (history.length > 0) {
      initPagination('grHistoryBody', history, (h, i) => {
        const at = h.generatedAt?.toDate?.() ? h.generatedAt.toDate() : new Date();
        const dateStr = at.toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
        const avgScore = h.report?.avgScore ?? '-';
        const totalAtt = h.report?.totalAttempts ?? '-';
        const summary = (h.report?.summary || '').replace(/\s+/g,' ');
        const ellipsis = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        return `<tr style="cursor:pointer;border-bottom:1px solid #f0f0f0;"
                   onclick="grShowFromList('${esc(h.id)}')"
                   onmouseover="this.style.background='#fef2ec'" onmouseout="this.style.background=''">
          <td class="td-sub" style="padding:8px 10px;${ellipsis}" title="${esc(dateStr)}">${esc(dateStr)}</td>
          <td style="padding:8px 10px;text-align:right;font-weight:600;">${avgScore}점</td>
          <td style="padding:8px 10px;text-align:right;color:var(--gray);">${totalAtt}회</td>
          <td style="padding:8px 10px;font-size:12px;color:#475569;${ellipsis}" title="${esc(summary)}">${esc(summary)}</td>
          <td style="padding:8px 6px;text-align:center;font-size:16px;line-height:1;">👁</td>
          <td style="padding:8px 6px;text-align:center;font-size:16px;line-height:1;" onclick="event.stopPropagation();grDeleteReport('${esc(h.id)}','${esc(uid)}')" title="삭제"
              onmouseover="this.style.color='#dc2626'" onmouseout="this.style.color=''">${iconSvg('trash')}</td>
        </tr>`;
      }, 'grHistoryPag', 6, { pageSize: 5 });
    }

    // 응시내역 렌더 (20개 기본 + 더보기, 30일 데이터 안에서)
    _renderPersonalScores();
  }catch(e){
    console.error('[loadPersonalScore]', e);
    detail.innerHTML=`<div style="color:#e05050;padding:20px;">불러오기 실패: ${esc(e.message||e.code||'')}</div>`;
  }
};

// 응시내역 렌더 — _personalScoreData (30일치) 중 _personalScoreVisible 건만 표시
function _renderPersonalScores() {
  const tbody = document.getElementById('personalScoreBody');
  const wrap = document.getElementById('personalScoreLoadMore');
  if (!tbody) return;
  const data = _personalScoreData || [];
  const total = data.length;
  const visible = Math.min(_personalScoreVisible, total);
  const slice = data.slice(0, visible);
  if (slice.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#bbb;">최근 30일 응시 내역이 없습니다</td></tr>`;
  } else {
    tbody.innerHTML = slice.map((s, i) => {
      const modeHtml = _unifiedTypeBadge(s.mode || 'vocab');
      const bookName = s.bookName || s.unitName || '-';
      const testName = s.testName || '-';
      const ellipsis = 'overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
      return `<tr>
        <td>${i+1}</td>
        <td>${modeHtml}</td>
        <td class="td-sm" style="${ellipsis}" title="${esc(bookName)}">${esc(bookName)}</td>
        <td style="font-size:12px;${ellipsis}" title="${esc(testName)}">${esc(testName)}</td>
        <td style="white-space:nowrap;"><span class="badge ${s.score>=80?'badge-green':s.score>=60?'badge-amber':'badge-red'}">${s.score}점</span></td>
        <td>${s.correct||0}/${s.total||0}</td>
        <td class="td-sub">${s.date||''}</td>
      </tr>`;
    }).join('');
  }
  if (wrap) {
    if (visible >= total) {
      wrap.innerHTML = total > 20
        ? `<div style="color:#bbb;font-size:11px;">최근 30일 ${total}건 모두 표시</div>`
        : '';
    } else {
      wrap.innerHTML = `<button class="btn btn-secondary" style="font-size:12px;padding:6px 14px;" onclick="loadMorePersonalScores()">+ 20건 더 보기 (${visible} / ${total})</button>`;
    }
  }
}

window.loadMorePersonalScores = () => {
  _personalScoreVisible += 20;
  _renderPersonalScores();
};

// ── AI 성장 리포트 (api/growth-report 호출 + 모달 + PDF) ─────────────────
const _GR_MODE_LABELS = {
  vocab:'📝 단어시험', mcq:'📖 객관식', fill_blank:'✏️ 빈칸채우기',
  unscramble:'🔀 언스크램블', recording:'🎤 녹음숙제',
};

// 모달 세션 동안 활성 학생의 history 캐시 (이력 클릭 시 재호출 회피)
let _grHistoryCache = [];   // [{id, generatedAt, report, ...}]
let _grStudentUid = null;

window.openGrowthReport = async (uid) => {
  if (!uid) return;
  showToast('🤖 AI 성장 리포트 생성 중... (10~20초)');
  try {
    // 1) 신규 리포트 생성
    const res = await _geminiFetch('/api/growth-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentUid: uid, period: 'last30d' }),
    });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      showToast(`서버 응답 오류 (${res.status})`);
      return;
    }
    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast('리포트 생성 실패: ' + (data.error || res.status));
      return;
    }

    // 2) 같은 학생의 과거 history 10건 조회 (방금 생성한 거 포함)
    let history = [];
    try {
      const snap = await getDocs(query(
        collection(db, 'growthReports'),
        where('academyId', '==', window.MY_ACADEMY_ID),
        where('studentUid', '==', uid),
        orderBy('generatedAt', 'desc'),
        limit(10),
      ));
      history = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
      console.warn('[growth-report history]', e.message);
    }

    _grHistoryCache = history;
    _grStudentUid = uid;
    _grRenderModal(data.report, data.reportId, uid, history, data.reportId);

    // 학생 detail 의 이력 표도 갱신 (모달 닫고 봤을 때 최신 반영)
    if (typeof loadPersonalScore === 'function' && _personalSelectedUid === uid) {
      // 백그라운드 갱신 — 모달은 그대로 유지
      setTimeout(() => loadPersonalScore(uid), 100);
    }
  } catch(e) {
    showToast('네트워크 에러: ' + e.message);
  }
};

// 이력 항목 클릭 — 캐시에서 찾아서 본문만 교체 (재호출 X)
window.grSelectHistory = (reportId) => {
  const item = _grHistoryCache.find(h => h.id === reportId);
  if (!item) { showToast('이력 데이터 없음'); return; }
  _grRenderModal(item.report, item.id, _grStudentUid, _grHistoryCache, item.id);
};

// 학생 detail 의 이력 표 행 클릭 — 모달로 해당 리포트 표시 (생성 X)
window.grShowFromList = (reportId) => {
  const item = _grHistoryCache.find(h => h.id === reportId);
  if (!item) { showToast('이력 데이터 없음'); return; }
  _grRenderModal(item.report, item.id, _grStudentUid, _grHistoryCache, item.id);
};

// 성장 리포트 삭제 — fromModal=true 면 삭제 후 모달 닫음
window.grDeleteReport = async (reportId, uid, fromModal = false) => {
  if (!reportId) return;
  const ok = await showConfirm('성장 리포트 삭제', '이 리포트를 삭제할까요? 복구할 수 없습니다.');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'growthReports', reportId));
    showToast('🗑 리포트 삭제됨');
    if (fromModal) closeModal();
    if (uid && _personalSelectedUid === uid) {
      // detail 영역 재로드 (이력 표 갱신)
      loadPersonalScore(uid);
    }
  } catch (e) {
    showToast('삭제 실패: ' + (e.message || e.code));
  }
};

function _grRenderModal(r, reportId, uid, history, currentId) {
  history = history || _grHistoryCache || [];
  currentId = currentId || reportId;
  const isLatest = history.length > 0 && history[0].id === currentId;
  const isHistorical = !isLatest && currentId !== reportId;

  // 이력 드롭다운 항목들
  const historyItems = history.map((h, idx) => {
    const at = h.generatedAt?.toDate?.() ? h.generatedAt.toDate() : new Date();
    const dateStr = at.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const summary = (h.report?.summary || '').slice(0, 40);
    const isCurrent = h.id === currentId;
    const tag = idx === 0 ? '<span style="background:#10b981;color:white;font-size:9px;padding:1px 5px;border-radius:3px;margin-right:4px;">최신</span>' : '';
    return `
      <div onclick="grSelectHistory('${esc(h.id)}')"
           style="padding:8px 12px;border-bottom:1px solid #f0f0f0;cursor:pointer;${isCurrent ? 'background:#fef2ec;' : ''}"
           onmouseover="this.style.background='${isCurrent ? '#fef2ec' : '#f8f9fa'}'"
           onmouseout="this.style.background='${isCurrent ? '#fef2ec' : 'white'}'">
        <div style="font-size:11px;font-weight:600;color:#475569;">${tag}${esc(dateStr)}${isCurrent ? ' <span style="color:var(--teal);">●현재</span>' : ''}</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${esc(summary)}${summary.length >= 40 ? '…' : ''}</div>
      </div>`;
  }).join('');

  const historyDropdown = history.length > 0 ? `
    <div style="position:relative;" id="grHistoryWrap">
      <button class="btn btn-secondary" style="font-size:12px;padding:6px 10px;" onclick="grToggleHistory()">📚 이력 (${history.length}) ▾</button>
      <div id="grHistoryPanel" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;width:300px;max-height:400px;overflow-y:auto;background:white;border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);z-index:10;">
        ${historyItems}
      </div>
    </div>` : '';

  const modeBars = Object.entries(_GR_MODE_LABELS).map(([k, lbl]) => {
    const m = r.modeBreakdown?.[k] || { avg:0, count:0, lastScore:null };
    // 녹음숙제는 점수 비공개 (학생 보호 정책) — 출제/제출 카운트만 표시
    if (k === 'recording') {
      const rq = r.recordingQuality || {};
      const assigned = rq.assigned || 0;
      const submitted = rq.submitted || m.count || 0;
      const ratio = assigned > 0 ? Math.round((submitted / assigned) * 100) : (submitted > 0 ? 100 : 0);
      const color = ratio >= 80 ? '#10b981' : ratio >= 50 ? '#f59e0b' : (submitted > 0 ? '#dc2626' : '#cbd5e1');
      const txt = assigned > 0
        ? `${assigned}회 출제 중 ${submitted}회 제출 (${ratio}%)`
        : (submitted > 0 ? `${submitted}회 제출` : '응시 없음');
      return `
        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
            <span>${lbl} <span style="font-size:10px;color:var(--gray);">(정성 평가)</span></span>
            <span style="color:var(--gray);">${txt}</span>
          </div>
          <div style="height:8px;background:#eee;border-radius:4px;overflow:hidden;">
            <div style="width:${ratio}%;height:100%;background:${color};transition:width 0.3s;"></div>
          </div>
        </div>`;
    }
    const pct = Math.min(100, m.avg);
    const color = m.avg >= 80 ? '#10b981' : m.avg >= 60 ? '#f59e0b' : (m.count > 0 ? '#dc2626' : '#cbd5e1');
    const lastTxt = m.count > 0 ? `최근 ${m.lastScore}점` : '응시 없음';
    return `
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span>${lbl}</span>
          <span style="color:var(--gray);">${m.count}회 · 평균 <b style="color:var(--text);">${m.avg}점</b> · ${lastTxt}</span>
        </div>
        <div style="height:8px;background:#eee;border-radius:4px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${color};transition:width 0.3s;"></div>
        </div>
      </div>`;
  }).join('');

  const list = (arr, color) => (arr || []).map(s => `
    <div style="font-size:13px;line-height:1.5;padding:6px 10px;background:${color};border-radius:6px;margin-bottom:6px;">• ${esc(s)}</div>
  `).join('') || '<div style="color:var(--gray);font-size:12px;">없음</div>';

  const historicalBadge = isHistorical
    ? `<span style="background:#fbbf24;color:white;font-size:10px;padding:2px 6px;border-radius:3px;margin-left:6px;">과거 리포트</span>`
    : '';

  const html = `
    <div id="grReportRoot" style="width:min(720px,94vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:17px;font-weight:700;line-height:1.3;">📈 AI 성장 리포트${historicalBadge}</div>
          <div style="margin-top:4px;font-size:12px;color:var(--gray);">기간: ${esc(r.periodFrom||'')} ~ ${esc(r.periodTo||'')} (최근 30일)</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
          ${historyDropdown}
          <button class="btn btn-secondary" style="font-size:12px;padding:6px 10px;" onclick="printGrowthReport()">📄 인쇄/PDF</button>
        </div>
      </div>
      <div id="grReportBody" style="padding:18px 22px;overflow-y:auto;flex:1;">
        <!-- 통계 카드 (녹음숙제는 정성 평가로 별도 분리, 점수 카드는 그 외 모드만 집계) -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
          <div style="padding:12px;background:#f8f9fa;border-radius:8px;text-align:center;">
            <div style="font-size:22px;font-weight:800;color:var(--teal);">${r.totalAttempts}</div>
            <div style="font-size:11px;color:var(--gray);">총 응시</div>
          </div>
          <div style="padding:12px;background:#f8f9fa;border-radius:8px;text-align:center;">
            <div style="font-size:22px;font-weight:800;color:var(--teal);">${r.avgScore}점</div>
            <div style="font-size:11px;color:var(--gray);">평균</div>
          </div>
          <div style="padding:12px;background:#f8f9fa;border-radius:8px;text-align:center;">
            <div style="font-size:22px;font-weight:800;color:#10b981;">${r.passedCount}</div>
            <div style="font-size:11px;color:var(--gray);">80점 이상</div>
          </div>
        </div>

        <!-- 총평 -->
        <div style="margin-bottom:18px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:6px;">${iconSvg('pen')} 총평</div>
          <div style="font-size:13px;line-height:1.7;color:#333;background:#fefce8;border-left:3px solid #eab308;padding:10px 14px;border-radius:4px;">${esc(r.summary||'')}</div>
        </div>

        <!-- 모드별 점수 -->
        <div style="margin-bottom:18px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:8px;">${iconSvg('chart')} 모드별 점수</div>
          ${modeBars}
        </div>

        <!-- 강점/약점/추천 3 칼럼 -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;">
          <div>
            <div style="font-weight:700;font-size:13px;margin-bottom:6px;color:#10b981;">💪 강점</div>
            ${list(r.strengths, '#ecfdf5')}
          </div>
          <div>
            <div style="font-weight:700;font-size:13px;margin-bottom:6px;color:#f59e0b;">📍 성장 여지</div>
            ${list(r.weaknesses, '#fffbeb')}
          </div>
          <div>
            <div style="font-weight:700;font-size:13px;margin-bottom:6px;color:#0ea5e9;">${iconSvg('lightbulb')} 추천</div>
            ${list(r.recommendations, '#eff6ff')}
          </div>
        </div>

        <!-- 추세 -->
        <div style="padding:10px 14px;background:#f8fafc;border-radius:6px;font-size:12px;color:#475569;line-height:1.6;margin-bottom:14px;">
          <b>추세:</b> ${esc(r.improvementNote||'')}
        </div>

        <!-- 🎤 녹음숙제 정성 평가 (점수 비공개 — 학생 보호 정책상 정성 코멘트만) -->
        <div style="padding:12px 14px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:6px;font-size:13px;line-height:1.7;color:#78350f;">
          <div style="font-weight:700;margin-bottom:6px;font-size:13px;">${iconSvg('mic')} 녹음숙제 정성 평가 <span style="font-size:10px;color:#92400e;font-weight:400;">(발음·읽기 상태)</span></div>
          ${esc(r.recordingComment || '녹음숙제 응시 데이터가 없습니다.')}
        </div>

        <div style="font-size:10px;color:#bbb;margin-top:12px;text-align:right;">${reportId ? 'reportId: ' + esc(reportId) : ''}</div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <button class="btn btn-secondary" style="background:#fef2f2;color:#dc2626;border-color:#fecaca;" onclick="grDeleteReport('${esc(currentId||'')}','${esc(uid||'')}',true)">${iconSvg('trash')} 이 리포트 삭제</button>
        <button class="btn btn-secondary" onclick="closeModal()">닫기</button>
      </div>
    </div>`;
  showModal(html);
}

window.grToggleHistory = () => {
  const panel = document.getElementById('grHistoryPanel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // 외부 클릭 시 닫기
    setTimeout(() => {
      const handler = (e) => {
        const wrap = document.getElementById('grHistoryWrap');
        if (wrap && !wrap.contains(e.target)) {
          panel.style.display = 'none';
          document.removeEventListener('click', handler);
        }
      };
      document.addEventListener('click', handler);
    }, 0);
  }
};

window.printGrowthReport = () => {
  const body = document.getElementById('grReportBody');
  if (!body) return;
  // 학생 정보 — _grHistoryCache 의 첫 항목(=최신) 또는 현재 표시 중인 항목에서 가져옴
  const latest = (_grHistoryCache && _grHistoryCache[0]) || null;
  const studentName = latest?.studentName || '학생';
  const studentGroup = latest?.studentGroup || '';
  const dateStr = _ymdKST();  // KST YYYY-MM-DD
  const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }).replace(':', '');
  // PDF 저장 시 파일명 default = title (브라우저 동작)
  const pdfTitle = `성장리포트_${studentName}_${dateStr}_${timeStr}`;

  // 인쇄 시 background 색이 빠지지 않도록 print-color-adjust: exact 강제.
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(pdfTitle)}</title>
    <style>
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
      html, body { margin: 0; padding: 0; }
      body { font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; padding: 14mm; color: #222; line-height: 1.5; }
      @page { size: A4; margin: 0; }
      h1 { font-size: 18px; margin: 0 0 6px; padding-bottom: 8px; border-bottom: 2px solid #E8714A; color: #E8714A; }
      .student { font-size: 14px; font-weight: 700; color: #222; margin: 8px 0 4px; }
      .meta { font-size: 11px; color: #666; margin-bottom: 14px; }
      .badge { display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px; }
    </style></head><body>
      <h1>📈 AI 성장 리포트</h1>
      <div class="student">${esc(studentName)}${studentGroup ? ` <span style="font-weight:400;color:#666;font-size:12px;">· ${esc(studentGroup)}</span>` : ''}</div>
      <div class="meta">저장 일자: ${esc(dateStr)} ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</div>
      ${body.innerHTML}
    </body></html>`;
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) { showToast('팝업 차단 — 허용 후 다시 시도하세요'); return; }
  win.document.write(html);
  win.document.close();
  // 렌더링 후 인쇄 (이미지·폰트 로드 대기)
  win.addEventListener('load', () => setTimeout(() => win.print(), 200));
  setTimeout(() => { try { win.print(); } catch(_){} }, 800);
};

// ── 공통 유틸 ─────────────────────────────────────────
window.showModal = (html, opts = {}) => {
  const mc = document.getElementById('modalContent');
  mc.innerHTML = html;
  const box = document.getElementById('modalBox');
  if (opts.fullFlex) {
    // 푸터를 하단 고정 + 내부 영역만 스크롤 + resize 추적 전용 모드
    box.style.padding = '0';
    box.style.overflow = 'hidden';
    box.style.width = opts.width || 'min(860px, 94vw)';   // 시작 폭 (사용자 resize 가능)
    box.style.maxWidth = '96vw';
    box.style.height = opts.height || '80vh';             // 시작 높이 (사용자 resize 가능)
    box.style.maxHeight = '96vh';
    box.style.minWidth = '360px';
    box.style.minHeight = '360px';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    // #modalContent 도 flex item + column 으로 → 자식 div height:100% 동작
    mc.style.flex = '1';
    mc.style.minHeight = '0';
    mc.style.display = 'flex';
    mc.style.flexDirection = 'column';
    mc.style.height = '';
    mc.style.overflow = 'hidden';
  } else {
    // 기본 스타일 원복
    box.style.padding = '';
    box.style.overflow = '';
    box.style.width = '';
    box.style.maxWidth = '';
    box.style.height = '';
    box.style.maxHeight = '';
    box.style.minWidth = '';
    box.style.minHeight = '';
    box.style.display = '';
    box.style.flexDirection = '';
    mc.style.flex = '';
    mc.style.minHeight = '';
    mc.style.display = '';
    mc.style.flexDirection = '';
    mc.style.height = '';
    mc.style.overflow = '';
  }
  document.getElementById('modalOverlay').style.display = 'flex';
  if (opts.draggable) {
    // 헤더 element 찾기 — data-drag-handle 속성 우선, 없으면 첫 자식 div
    requestAnimationFrame(() => {
      const headerEl = mc.querySelector('[data-drag-handle]')
        || mc.firstElementChild?.firstElementChild;
      if (headerEl) _enableModalDrag(headerEl);
    });
  }
};
window.closeModal = () => {
  document.getElementById('modalOverlay').style.display='none';
  const box = document.getElementById('modalBox');
  box.style.width='';
  box.style.transform='';                  // 드래그 위치 리셋 (다음 모달은 중앙)
  // 결제 항목 패널 정리 — 닫는 경로 (✓ 완료 / ✕ 취소 / 바깥 클릭) 무관 그리드 갱신.
  // 라인 3134 wrapper 가 이 정의로 덮어씌워지는 상황 우회 (인라인 hook).
  if (_billingPanelId !== null) {
    _billingPanelId = null;
    _billingPanelChannel = null;
    if (currentPage === 'payment') _renderBillingGrid(0, { refetch: false });
  }
};

// 모달 드래그 이동 헬퍼 (2026-06-18) — AI 정리 모달 등 일부 모달용
// 헤더 element 에 mousedown 박고 mousemove 따라 modalBox transform 적용
// 사용 조건: showModal(html, {draggable: true}) + 헤더 div 에 data-drag-handle 속성
function _enableModalDrag(headerEl) {
  const box = document.getElementById('modalBox');
  if (!box || !headerEl) return;
  headerEl.style.cursor = 'move';
  headerEl.style.userSelect = 'none';

  headerEl.addEventListener('mousedown', (e) => {
    // 헤더 안 button·input·a 클릭은 드래그 X (텍스트 선택 가능하게)
    if (e.target.closest('button, input, textarea, select, a')) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const m = (box.style.transform || '').match(/translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/);
    const baseTX = m ? parseFloat(m[1]) : 0;
    const baseTY = m ? parseFloat(m[2]) : 0;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      // 화면 한계 — modal 일부(헤더 ~50px) 는 항상 보이게
      const rect = box.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      // 현재 viewport 안 모달 좌상단 위치 = rect.left, rect.top (이미 transform 반영됨)
      // 이동량 dx, dy 적용 후 위치
      const futureLeft = rect.left + (dx - (baseTX === 0 ? 0 : 0));
      // 단순 한계 — 좌/우/상/하 50px 는 화면 안에 남기
      let nextTX = baseTX + dx;
      let nextTY = baseTY + dy;
      // rect.left 가 이미 (transform 적용 후) 박스 실제 위치. 다음 위치 추정:
      const nextLeft = rect.left - baseTX + nextTX;
      const nextTop = rect.top - baseTY + nextTY;
      if (nextLeft < -rect.width + 50) nextTX = baseTX + dx - (nextLeft - (-rect.width + 50));
      if (nextLeft > vw - 50) nextTX = baseTX + dx - (nextLeft - (vw - 50));
      if (nextTop < 0) nextTY = baseTY + dy - nextTop;
      if (nextTop > vh - 50) nextTY = baseTY + dy - (nextTop - (vh - 50));
      box.style.transform = `translate(${nextTX}px, ${nextTY}px)`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
// 리사이즈 드래그 후 오버레이에서 mouseup 시 닫히는 문제 방지
// mousedown 시작이 오버레이일 때만 닫힘
let _modalMouseDownOnOverlay = false;
document.getElementById('modalOverlay').addEventListener('mousedown', e => {
  _modalMouseDownOnOverlay = e.target === document.getElementById('modalOverlay');
});
document.getElementById('modalOverlay').addEventListener('click', e => {
  if(_modalMouseDownOnOverlay && e.target === document.getElementById('modalOverlay')) closeModal();
});

// (중복 showToast 제거 — 상단 유틸 섹션의 showToast 사용)

// ── Auth + Firestore 동시 삭제 ────────────────────────────
async function deleteUserFull(uid, name){
  if(!(await showConfirm(`"${name}" 학생을 완전 삭제할까요?\nFirebase 계정과 모든 데이터가 삭제됩니다.`))) return false;
  try{
    const idToken = await currentUser.getIdToken();
    const res = await fetch('/api/deleteUser',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ uid, idToken })
    });
    const result = await res.json();
    if(result.success){ showToast('✅ 계정이 완전 삭제됐어요!'); return true; }
    else { await showAlert('삭제 실패', result.error); return false; }
  } catch(e){ await showAlert('삭제 실패', e.message); return false; }
}

// ── 삭제 함수 오버라이드 (Auth 포함 삭제) ────────────────
window.deleteSelectedStudent = async() => {
  const ids = getCheckedIds('studentTableBody');
  if (!ids.length) { showAlert('입력 확인', '삭제할 학생을 선택하세요.'); return; }
  if(!(await showConfirm(`선택한 ${ids.length}명을 완전 삭제할까요?\nFirebase 계정과 모든 데이터가 삭제됩니다.`)))return;
  const okIds = [];
  const idToken = await currentUser.getIdToken();
  for(const id of ids){
    try{
      await fetch('/api/deleteUser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:id, idToken})});
      okIds.push(id);
    }catch(e){console.log('삭제실패:',e);}
  }
  showToast(`✅ ${okIds.length}명 삭제 완료!`);
  _stuSurgical('active', okIds, {remove:true});
};
window.deleteSelectedOutStudent = async() => {
  const ids = getCheckedIds('outTableBody');
  if (!ids.length) { showAlert('입력 확인', '삭제할 학생을 선택하세요.'); return; }
  if(!await showConfirm(`선택한 ${ids.length}명을 완전 삭제할까요?`))return;
  const okIds = [];
  const idToken = await currentUser.getIdToken();
  for(const id of ids){
    try{
      await fetch('/api/deleteUser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:id, idToken})});
      okIds.push(id);
    }catch(e){console.log('삭제실패:',e);}
  }
  showToast(`✅ ${okIds.length}명 삭제 완료!`);
  _stuSurgical('out', okIds, {remove:true});
};
window.deleteStudent = async(id, name) => {
  const ok = await deleteUserFull(id, name);
  if (!ok) return;
  const fromStatus = currentPage==='student-out'?'out':currentPage==='student-pause'?'pause':'active';
  _stuSurgical(fromStatus, [id], {remove:true});
};
window.toggleCheck = (tbodyId, masterCb) => {
  document.querySelectorAll(`#${tbodyId} input[type=checkbox]`).forEach(cb => cb.checked = masterCb.checked);
};
function getCheckedIds(tbodyId){
  return [...document.querySelectorAll(`#${tbodyId} input[type=checkbox]:checked`)].map(cb=>cb.value).filter(v=>v&&v!=='on');
}

// ── 클래스 선택 액션 ────────────────────────────────
window.editSelectedClass = () => {
  const ids = getCheckedIds('classTableBody');
  if (ids.length !== 1) { showAlert('입력 확인', '수정할 반을 하나만 선택하세요.'); return; }
  editClass(ids[0]);
};
window.deleteSelectedClass = async() => {
  const ids = getCheckedIds('classTableBody');
  if (!ids.length) { showAlert('입력 확인', '삭제할 반을 선택하세요.'); return; }
  if(!await showConfirm(`선택한 ${ids.length}개 반을 삭제할까요?`))return;
  const okIds = [];
  for(const id of ids){
    try { await deleteDoc(doc(db,'groups',id)); okIds.push(id); }
    catch(e){ console.warn(e); }
  }
  showToast('삭제됐어요.');
  const set = new Set(okIds);
  if (!_pageMutate('classTableBody', data => data.filter(g => !set.has(g.id)))) await loadClasses();
};

// ── 학생 선택 액션 ──────────────────────────────────
window.editSelectedStudent = () => {
  const ids = getCheckedIds('studentTableBody');
  if (ids.length !== 1) { showAlert('입력 확인', '수정할 학생을 하나만 선택하세요.'); return; }
  editStudent(ids[0]);
};
// (구버전 deleteSelectedStudent 제거 — 위쪽 line 1689 의 Auth+Firestore+lookup 통합 삭제 사용)
window.restoreSelectedStudent = async(status) => {
  const tbodyId = status==='pause'?'pauseTableBody':'outTableBody';
  const ids = getCheckedIds(tbodyId);
  if (!ids.length) { showAlert('입력 확인', '학생을 선택하세요.'); return; }
  if(!await showConfirm(`선택한 ${ids.length}명을 재원처리 할까요?`))return;
  for(const id of ids) {
    const snap = await getDoc(doc(db,'users',id));
    const hasAmt = (snap.data()?.tuitionPlan?.amount || 0) > 0;
    const update = { status:'active', statusDate:_ymdKST() };
    if (hasAmt) update['tuitionPlan.active'] = true;
    await updateDoc(doc(db,'users',id), update);
  }
  await _adjustActiveStudentCount(+ids.length);  // pause/out → active: +N
  showToast('재원처리 완료!');
  _stuSurgical(status, ids, {remove:true});
};
window.outSelectedStudent = async() => {
  const ids = getCheckedIds('pauseTableBody');
  if (!ids.length) { showAlert('입력 확인', '학생을 선택하세요.'); return; }
  if(!await showConfirm(`선택한 ${ids.length}명을 퇴원처리 할까요?`))return;
  for(const id of ids) await updateDoc(doc(db,'users',id),{status:'out',statusDate:_ymdKST(),'tuitionPlan.active':false});
  // pause → out: active 카운터 변동 없음 (둘 다 비활성). tuitionPlan.active 는 false 유지
  showToast('퇴원처리 완료!');
  _stuSurgical('pause', ids, {remove:true});
};
// (구버전 deleteSelectedOutStudent 제거 — 위쪽 line 1702 의 Auth+Firestore+lookup 통합 삭제 사용)

// ── 공지 선택 액션 ──────────────────────────────────
window.editSelectedNotice = () => {
  const ids = getCheckedIds('noticeTableBody');
  if (ids.length !== 1) { showAlert('입력 확인', '수정할 공지를 하나만 선택하세요.'); return; }
  editNotice(ids[0]);
};
window.deleteSelectedNotice = async() => {
  const ids = getCheckedIds('noticeTableBody');
  if (!ids.length) { showAlert('입력 확인', '삭제할 공지를 선택하세요.'); return; }
  if(!(await showConfirm(`선택한 ${ids.length}개 공지를 삭제할까요?`)))return;
  for(const id of ids) await deleteDoc(doc(db,'notices',id));
  showToast('삭제됐어요.');
  const set = new Set(ids);
  if (!_pageMutate('noticeTableBody', data => data.filter(n => !set.has(n.id)))) await loadNotices();
};

// ── 결제 선택 액션 ──────────────────────────────────
window.markSelectedPaid = async() => {
  const ids = getCheckedIds('paymentTableBody');
  if (!ids.length) { showAlert('입력 확인', '항목을 선택하세요.'); return; }
  for(const id of ids) await updateDoc(doc(db,'payments',id),{status:'paid'});
  showToast('납부완료 처리됐어요.'); await loadPayments();
};
window.deleteSelectedPayment = async() => {
  const ids = getCheckedIds('paymentTableBody');
  if (!ids.length) { showAlert('입력 확인', '삭제할 항목을 선택하세요.'); return; }
  if(!(await showConfirm(`선택한 ${ids.length}개를 삭제할까요?`)))return;
  for(const id of ids) await deleteDoc(doc(db,'payments',id));
  showToast('삭제됐어요.'); await loadPayments();
};


// ── 시험 선택 액션 ──────────────────────────────────
window.deleteSelectedTest = async() => {
  const ids = [...document.querySelectorAll('#testListBody input[type=checkbox]:checked')]
    .map(cb => cb.value)
    .filter(id => id && id !== 'on');
  if (!ids.length) { showAlert('입력 확인', '삭제할 시험을 선택하세요.'); return; }
  if(!(await showConfirm(`선택한 ${ids.length}개 시험을 삭제할까요?`)))return;
  const okIds = [];
  for(const id of ids) {
    try { await deleteDoc(doc(db, 'genTests', id)); okIds.push(id); }
    catch(e) { console.warn('[deleteSelectedTest]', e); }
  }
  showToast('삭제됐어요.');
  // 통합 시험목록 화면 상태(정렬·페이지·필터) 유지 — _pageState/_tlState 양쪽 동기
  const set = new Set(okIds);
  const ok = _pageMutate('testListBody', data => {
    const next = data.filter(t => !set.has(t.id));
    _tlState.data = next;  // 더보기·재바인딩 대비 _tlState 동기
    return next;
  });
  if (!ok) await loadTestList();
};

// ── 엑셀 등록 (재원생 일괄 등록) ────────────────────
window.downloadSampleExcel = () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['아이디','이름','반','생일','학교','학년','연락처','부모님성함','부모님연락처','수강료','납부일'],
    ['student01','홍길동','1반','2015-03-15','영남초등학교','5','010-1234-5678','홍아버지','010-9876-5432',200000,'5일'],
    ['student02','김철수','2반','2014-07-22','강남초등학교','6','010-2345-6789','','',180000,'말일'],
    ['student03','이영희','1반','2015-09-01','영남초등학교','5','','','','',200000,'학원기본'],
    ['student04','박민준','2반','2014-11-10','강남초등학교','6','','','','',''],
  ]);
  ws['!cols'] = [12,8,6,14,16,6,14,10,14,10,8].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws, '재원생등록');
  XLSX.writeFile(wb, '큰소리영어_학생등록_샘플.xlsx');
  showToast('샘플 파일을 다운로드했어요!');
};

window.handleExcelDrop = (e) => {
  const file = e.dataTransfer.files[0];
  if(!file) return;
  processExcelFile(file);
};

window.previewExcel = (e) => {
  const file = e.target.files[0];
  if(!file) return;
  processExcelFile(file);
};

function processExcelFile(file){
  const reader = new FileReader();
  reader.onload = (ev) => {
    try{
      const wb = XLSX.read(ev.target.result, {type:'binary'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
      if (!rows || rows.length < 2) { showAlert('입력 확인', '데이터가 없습니다.'); return; }
      const dataRows = rows.slice(1).filter(r=>(r[0]||'').toString().trim()||(r[1]||'').toString().trim());
      window._excelRows = rows;
      const headers = rows[0];
      const validCount = dataRows.filter(r=>(r[0]||'').toString().trim()).length;
      const invalidCount = dataRows.length - validCount;
      const preview = document.getElementById('excelPreview');
      preview.innerHTML = `
        <div style="display:flex;gap:10px;margin-bottom:10px;font-size:13px;">
          <span style="background:#d1fae5;color:#059669;padding:4px 10px;border-radius:6px;font-weight:600;">✅ 등록 가능: ${validCount}명</span>
          ${invalidCount>0?`<span style="background:#fee2e2;color:#dc2626;padding:4px 10px;border-radius:6px;font-weight:600;">❌ 아이디 없음: ${invalidCount}행</span>`:''}
        </div>
        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:300px;overflow-y:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr style="background:#f8f9fa;position:sticky;top:0;">
              ${headers.map(h=>`<th style="padding:7px 10px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap;font-weight:600;">${h}</th>`).join('')}
              <th style="padding:7px 10px;border-bottom:1px solid var(--border);">상태</th>
            </tr></thead>
            <tbody>${dataRows.map(r=>{
              const ok=(r[0]||'').toString().trim()&&(r[1]||'').toString().trim();
              return `<tr style="${ok?'':'background:#fff5f5'}">
                ${headers.map((_,ci)=>`<td style="padding:6px 10px;border-bottom:1px solid #f5f5f5;">${r[ci]||''}</td>`).join('')}
                <td style="padding:6px 10px;border-bottom:1px solid #f5f5f5;">${ok?'<span style="color:#059669">✅</span>':'<span style="color:#dc2626">❌ 필수값 없음</span>'}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
        <div style="margin-top:6px;font-size:12px;color:var(--gray);">* 비밀번호는 <b>123456</b>으로 일괄 설정됩니다</div>`;
      document.getElementById('excelImportBtnWrap').style.display = validCount>0?'':'none';
    }catch(e){ showToast('파일 읽기 실패: '+e.message); }
  };
  reader.readAsBinaryString(file);
}

window.importStudentExcel = async() => {
  const rows = window._excelRows;
  if (!rows||rows.length<2) { showAlert('입력 확인', '먼저 엑셀 파일을 업로드하세요.'); return; }
  const dataRows = rows.slice(1).filter(r=>(r[0]||'').toString().trim());
  if (!dataRows.length) { showAlert('입력 확인', '등록할 학생이 없습니다.'); return; }
  if(!(await showConfirm(`${dataRows.length}명을 재원생으로 등록할까요?\n기본 비밀번호: 123456`))) return;

  if (!currentUser) { showAlert('인증 확인', '로그인 상태가 아닙니다. 다시 로그인하세요.'); return; }
  let idToken;
  try { idToken = await currentUser.getIdToken(); }
  catch(e) { showAlert('인증 실패', '인증 토큰을 받지 못했습니다: ' + e.message); return; }

  const btn = document.getElementById('excelImportBtn');
  btn.textContent='등록 중... 0/'+dataRows.length; btn.disabled=true;
  let success=0, fail=0, failList=[];
  for(let i=0;i<dataRows.length;i++){
    const row=dataRows[i];
    const username=(row[0]||'').toString().trim();
    const name=(row[1]||'').toString().trim();
    if(!username||!name){failList.push((username||'?')+': 아이디/이름 누락');fail++;continue;}
    try{
      // 수강료·납부일 파싱 (J/K 열, 빈값 OK — 자동 청구 미생성)
      const tuitionRaw = (row[9]||'').toString().replace(/[^\d]/g,'').trim();
      const tuitionAmount = parseInt(tuitionRaw) || 0;
      const dueDayStr = (row[10]||'').toString().trim();
      // 받아들이는 형식: 숫자(5), '5일', '말일', '학원기본'/'학원 기본값', 빈값
      let dueDay = 0;  // 0 = 학원 기본값
      if (dueDayStr === '말일' || dueDayStr === '-1') dueDay = -1;
      else if (dueDayStr === '학원기본' || dueDayStr === '학원 기본값') dueDay = 0;
      else {
        // '5일' 처럼 한글 단위 붙은 경우도 허용 — 숫자만 추출
        const numStr = dueDayStr.replace(/[^\d]/g, '');
        if (/^\d+$/.test(numStr)) {
          const n = parseInt(numStr);
          if (n >= 1 && n <= 31) dueDay = n;
        }
      }
      const payload = {
        idToken, username, password:'123456', name, method: 'excel',
        group:(row[2]||'').toString().trim(),
        birth:(row[3]||'').toString().trim(),
        school:(row[4]||'').toString().trim(),
        grade:(row[5]||'').toString().trim(),
        phone:(row[6]||'').toString().trim(),
        parentName:(row[7]||'').toString().trim(),
        parentPhone:(row[8]||'').toString().trim(),
      };
      if (tuitionAmount > 0) {
        payload.tuitionPlan = {
          amount: tuitionAmount,
          dueDay,
          startMonth: new Date(Date.now() + 9*3600*1000).toISOString().slice(0, 7),
          active: true,
        };
      }
      const res = await fetch('/api/createStudent', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok || !data.success) {
        const msg = data.error || `HTTP ${res.status}`;
        console.log(username,'실패:',msg);
        failList.push(`${username}: ${msg}`);
        fail++;
      } else {
        success++;
      }
    }catch(e){
      console.log(username,'실패:',e.message);
      failList.push(`${username}: ${e.message}`);
      fail++;
    }
    btn.textContent=`등록 중... ${success+fail}/${dataRows.length}`;
  }
  btn.textContent='✅ 일괄 등록하기'; btn.disabled=false;
  const resultColor = fail===0?'#d1fae5':'#fef3c7';
  document.getElementById('excelPreview').innerHTML += `
    <div style="margin-top:12px;padding:14px;border-radius:8px;background:${resultColor};font-size:13px;">
      <div style="font-weight:600;margin-bottom:6px;">${iconSvg('chart')} 등록 결과</div>
      <div>✅ 성공: <b>${success}명</b></div>
      ${fail>0?`<div style="margin-top:6px;">❌ 실패: <b>${fail}명</b></div>
        <div style="margin-top:6px;max-height:140px;overflow:auto;font-size:12px;color:#555;background:white;padding:8px;border-radius:4px;border:1px solid #e5e5e5;">
          ${failList.map(s=>`<div>• ${esc(s)}</div>`).join('')}
        </div>`:''}
    </div>`;
  window._excelRows=null;
  document.getElementById('excelUpload').value='';
  document.getElementById('excelImportBtnWrap').style.display='none';
  if(success>0) { showToast(`✅ ${success}명 등록 완료!`); await loadStudents('active'); }
};
// 출제 일시 포맷터 (createdAt Timestamp 우선, 없으면 t.date 폴백)
// YY-MM-DD HH:mm 형식 — lexicographic 정렬과 시간순 정렬 일치
function _fmtTestDateTime(t){
  const dt = t.createdAt?.toDate?.();
  if (dt) {
    const p = n => String(n).padStart(2,'0');
    const yy = p(dt.getFullYear() % 100);
    return `${yy}-${p(dt.getMonth()+1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
  }
  return esc(t.date || '');
}

function _testModeLabel(t){
  // 레거시 tests (testMode 없음)은 단어시험 = vocab 으로 간주
  return _unifiedTypeBadge(t.testMode || 'vocab');
}

// 단어시험 중 vocabOptions.format='speaking' 이면 시험명 옆에 붙일 작은 배지
function _testNameSpeakingBadge(t) {
  if ((t.testMode || 'vocab') === 'vocab' && t.vocabOptions?.format === 'speaking') {
    return ` <span class="badge" style="background:#fef3c7;color:#78350f;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:700;vertical-align:middle;">${iconSvg('mic')} 말하기</span>`;
  }
  return '';
}

// mcq 시험 중 첫 question.subType='grammar' 면 시험명 옆에 붙일 작은 배지
// (genTests 의 questions 배열에 박힌 subType 으로 판정)
function _testNameGrammarBadge(t) {
  if ((t.testMode || '').toLowerCase() === 'mcq' && Array.isArray(t.questions) && t.questions[0]?.subType === 'grammar') {
    return ` <span class="badge" style="background:#ede9fe;color:#5b21b6;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:700;vertical-align:middle;">📐 문법</span>`;
  }
  return '';
}

// 시험명 옆 모든 배지를 한 번에 (말하기 + 문법 등 미래 확장)
function _testNameBadges(t) {
  return _testNameSpeakingBadge(t) + _testNameGrammarBadge(t);
}

// ─── 시험 통계 공용 계산 (시험 목록 + 시험 유형별 최근 시험 공유) ───
// 대상 표기 — "1반 전체 / 2반 3명 / 미배정 1명" 식 반별 구분
// targets: [{type:'class'|'student', id, name, groupName}]
function _buildTargetName(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return '';
  // 단일 — 기존 동작 유지 ('1반 전체' 또는 '홍길동')
  if (targets.length === 1) return targets[0].name || '';

  // 다중 — 반별 분류
  const classGroups = new Set(
    targets.filter(t => t.type === 'class').map(t => t.groupName || (t.name||'').replace(/\s*전체\s*$/, '').trim())
  );
  const studentByGroup = {};
  targets.filter(t => t.type === 'student').forEach(s => {
    const g = s.groupName || '미배정';
    studentByGroup[g] = (studentByGroup[g] || 0) + 1;
  });

  const parts = [];
  [...classGroups].forEach(g => parts.push(`${g} 전체`));
  Object.entries(studentByGroup)
    .filter(([g]) => !classGroups.has(g))
    .forEach(([g, n]) => parts.push(`${g} ${n}명`));
  return parts.join(' / ') || '-';
}

function _resolveTestTargetUids(targets, students) {
  const set = new Set();
  (targets || []).forEach(tg => {
    if (!tg) return;
    if (tg.type === 'student' && tg.id) {
      set.add(tg.id);
    } else if (tg.type === 'class') {
      const gName = tg.groupName || (tg.name||'').replace(/\s*전체\s*$/,'').trim() || tg.id;
      (students || []).forEach(s => { if (s.group === gName) set.add(s.id); });
    }
  });
  return set;
}

function _computeTestStats(t, scoresArr, students) {
  const avg = scoresArr.length ? Math.round(scoresArr.reduce((sum,s)=>sum+(s.score||0),0)/scoresArr.length) : null;
  const attemptedSet = new Set(scoresArr.map(s => s.uid).filter(Boolean));
  const targetSet = _resolveTestTargetUids(t.targets, students);
  // 응시자는 무조건 대상에 포함 — 반별 타겟의 경우 응시 후 다른 반으로 이동·삭제된 학생이
  // 현재 _resolveTestTargetUids 에서 빠져 "대상 < 응시" 가 되던 버그 차단 (응시 ≤ 대상 보장)
  attemptedSet.forEach(uid => targetSet.add(uid));
  const tMode = (t.testMode || t.mode || '').toLowerCase();
  // Phase B: 녹음숙제는 통과/불통 폐기 → 모든 응시 = 제출 (통과 카운트 = 응시 카운트)
  if (tMode === 'recording') {
    return {
      avg,
      attemptedCount: attemptedSet.size,
      passedCount: attemptedSet.size,
      targetCount: targetSet.size,
    };
  }
  const passScore = t.passScore || 80;
  const maxByUid = new Map();
  scoresArr.forEach(s => {
    if (!s.uid) return;
    const prev = maxByUid.get(s.uid);
    const cur = s.score || 0;
    if (prev === undefined || cur > prev) maxByUid.set(s.uid, cur);
  });
  let passedCount = 0;
  maxByUid.forEach(v => { if (v >= passScore) passedCount++; });
  return {
    avg,
    attemptedCount: attemptedSet.size,
    passedCount,
    targetCount: targetSet.size,
  };
}

// 페이지네이션 상태 — 시험 목록 (2026-05-13)
let _tlState = { lastDoc: null, exhausted: false, data: [] };
const TL_PAGE_SIZE = 20;

// testId 들의 scores 만 in 쿼리 fetch (학원 전체 X)
async function _tlLoadScoresForTests(testIds) {
  if (!testIds.length) return [];
  const all = [];
  for (let i = 0; i < testIds.length; i += 30) {
    const chunk = testIds.slice(i, i + 30);
    try {
      const sSnap = await getDocs(query(
        collection(db, 'scores'),
        where('academyId', '==', window.MY_ACADEMY_ID),
        where('testId', 'in', chunk)
      ));
      sSnap.docs.forEach(d => all.push(d.data()));
    } catch(e) { console.warn('scores in chunk:', e.message); }
  }
  return all;
}

function _tlRenderRow(t, i) {
  const isGen = t._src === 'genTests';
  const count = isGen ? (t.questionCount||t.questions?.length||0) : (t.count||0);
  const bookName = t.bookName || (isGen ? (t.sourceSetNames?.join(', ')||'-') : '-');
  return `
      <tr style="cursor:pointer;" onclick="tpToggleTestProgress('${t.id}','tl')" id="tl-row-${t.id}">
        <td onclick="event.stopPropagation()"><input type="checkbox" value="${t.id}" data-src="${t._src}"></td>
        <td>${i+1}</td>
        <td class="td-main">${esc(t.name)||'-'}${_testNameBadges(t)}
          ${_tpEditNameBtnHtml(t)}
        </td>
        <td>${_testModeLabel(t)}</td>
        <td><span class="badge badge-teal">${esc(_buildTargetName(t.targets) || t.targetName) || '-'}</span></td>
        <td class="td-sm">${esc(bookName)}</td>
        <td class="td-center">${count}문제</td>
        <td class="td-sub" style="white-space:nowrap;">${_fmtTestDateTime(t)}</td>
        <td style="text-align:center;font-size:11px;white-space:nowrap;">
          <span style="color:#2e7d32;font-weight:700;" title="통과자">${t._passedCount||0}</span>
          <span style="color:var(--gray);">/</span>
          <span style="color:#1565c0;font-weight:600;" title="응시자(고유)">${t._attemptedCount||0}</span>
          <span style="color:var(--gray);">/</span>
          <span style="color:var(--text);" title="대상자">${t._targetCount||'-'}</span>
        </td>
        <td class="td-center">
          ${t.avgScore!==null?`<span class="badge ${t.avgScore>=80?'badge-green':t.avgScore>=60?'badge-amber':'badge-red'}">${t.avgScore}점</span>`:'-'}
        </td>
      </tr>
      <tr id="tl-progress-${t.id}" style="display:none;background:#f0faff;">
        <td colspan="10" style="padding:0;border-top:none;">
          <div id="tl-progress-content-${t.id}" style="padding:14px 16px 14px 48px;font-size:12px;color:#bbb;">로딩 중...</div>
        </td>
      </tr>`;
}

function _tlRenderLoadMore() {
  const wrap = document.getElementById('tlLoadMoreWrap');
  if (!wrap) return;
  if (_tlState.exhausted) {
    wrap.innerHTML = '<div style="text-align:center;color:#888;padding:10px;font-size:12px;">모두 표시됨</div>';
  } else {
    wrap.innerHTML = '<button id="tlLoadMoreBtn" class="btn btn-secondary" style="margin:10px auto;display:block;" onclick="loadMoreTestList()">+ 더 보기</button>';
  }
}

window.loadTestList = async() => {
  const el = document.getElementById('testListBody');
  try{
    // 페이지네이션 리셋
    _tlState.lastDoc = null;
    _tlState.exhausted = false;
    _tlState.data = [];

    // 최근 N개 단순 — testMode/날짜 무관, createdAt desc + limit (2026-06-01).
    // 옛 '월초~당일' 컷오프 폐기 (월초마다 빈 목록 → 학원장 혼선).
    const gSnap = await getDocs(query(
      collection(db,'genTests'),
      where('academyId','==', window.MY_ACADEMY_ID),
      orderBy('createdAt','desc'),
      limit(TL_PAGE_SIZE)
    )).catch(e => { console.warn('genTests page 1:', e.message); return {docs:[], size:0}; });

    _tlState.lastDoc = gSnap.docs[gSnap.docs.length - 1] || null;
    _tlState.exhausted = gSnap.size < TL_PAGE_SIZE;
    const genTests = gSnap.docs.map(d=>({id:d.id,_src:'genTests',...d.data()}));

    if(genTests.length===0){
      el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#bbb;padding:20px;">출제된 시험이 없습니다</td></tr>';
      _tlRenderLoadMore();
      return;
    }

    // 받은 시험들의 testId 만 scores in 쿼리 (학원 전체 fetch X)
    const allScores = await _tlLoadScoresForTests(genTests.map(t => t.id));

    // 학생 캐시 (대상자 계산용)
    if (!Array.isArray(allStudents) || allStudents.length === 0) {
      try {
        const sSnap = await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID), where('role','==','student')));
        allStudents = sSnap.docs.map(d => ({ id:d.id, ...d.data() }));
      } catch(e) { console.warn('학생 로드 실패:', e); }
    }

    const attachStats = (t) => {
      const scoresArr = allScores.filter(s => s.testId === t.id);
      const stats = _computeTestStats(t, scoresArr, allStudents);
      return { ...t,
        attemptCount: scoresArr.length,
        avgScore: stats.avg,
        _passedCount: stats.passedCount,
        _attemptedCount: stats.attemptedCount,
        _targetCount: stats.targetCount,
      };
    };

    _tlState.data = genTests.map(attachStats);

    initPagination('testListBody', _tlState.data, _tlRenderRow, 'testPagination', 10, { pageSize: 99999 });
    _tlRenderLoadMore();
  }catch(e){
    console.error(e);
    el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';
  }
};

window.loadMoreTestList = async() => {
  if (_tlState.exhausted || !_tlState.lastDoc) return;
  const btn = document.getElementById('tlLoadMoreBtn');
  if (btn) { btn.disabled = true; btn.textContent = '로딩 중...'; }
  try {
    const gSnap = await getDocs(query(
      collection(db,'genTests'),
      where('academyId','==', window.MY_ACADEMY_ID),
      orderBy('createdAt','desc'),
      startAfter(_tlState.lastDoc),
      limit(TL_PAGE_SIZE)
    ));
    _tlState.lastDoc = gSnap.docs[gSnap.docs.length - 1] || _tlState.lastDoc;
    _tlState.exhausted = gSnap.size < TL_PAGE_SIZE;
    const newTests = gSnap.docs.map(d => ({id:d.id,_src:'genTests',...d.data()}));

    if (newTests.length) {
      const newScores = await _tlLoadScoresForTests(newTests.map(t => t.id));
      const attached = newTests.map(t => {
        const scoresArr = newScores.filter(s => s.testId === t.id);
        const stats = _computeTestStats(t, scoresArr, allStudents);
        return { ...t,
          attemptCount: scoresArr.length,
          avgScore: stats.avg,
          _passedCount: stats.passedCount,
          _attemptedCount: stats.attemptedCount,
          _targetCount: stats.targetCount,
        };
      });
      _tlState.data = _tlState.data.concat(attached);
      initPagination('testListBody', _tlState.data, _tlRenderRow, 'testPagination', 10, { pageSize: 99999 });
    }
    _tlRenderLoadMore();
  } catch(e) {
    console.error('loadMoreTestList:', e);
    if (btn) { btn.disabled = false; btn.textContent = '+ 더 보기'; }
  }
};

window.toggleTestProgress = async(testId, source='genTests') => {
  const progressRow = document.getElementById('progress-'+testId);
  if(!progressRow){ console.warn('progress row not found:', testId); return; }

  const isOpen = progressRow.getAttribute('data-open') === '1';

  // 다른 열린 행 모두 닫기
  document.querySelectorAll('[id^="progress-"][data-open="1"]').forEach(r=>{
    r.style.display='none';
    r.setAttribute('data-open','0');
  });

  if(isOpen) return; // 이미 열려 있었으면 닫고 끝

  // 열기
  progressRow.style.display = 'table-row';
  progressRow.setAttribute('data-open','1');

  const contentEl = document.getElementById('progress-content-'+testId);
  if(!contentEl) return;
  contentEl.innerHTML = '<span style="color:#bbb;">로딩 중...</span>';

  try{
    const testDoc = await getDoc(doc(db, 'genTests', testId));
    if(!testDoc.exists()){ contentEl.textContent='시험 데이터 없음'; return; }
    const t = testDoc.data();
    const targets = t.targets||[];

    // 대상 학생 목록
    let students = [];
    for(const tg of targets){
      if(tg.type==='student') {
        students.push({uid:tg.id, name:tg.name, group:tg.groupName||''});
      } else if(tg.type==='class') {
        const gName = tg.groupName || (tg.name||'').replace(/\s*전체\s*$/,'').trim() || tg.id;
        const gs = await getDocs(query(collection(db,'users'),
          where('academyId','==',window.MY_ACADEMY_ID),
          where('role','==','student'),
          where('group','==',gName)
        ));
        gs.docs.forEach(d=>
          students.push({uid:d.id, name:d.data().name, group:d.data().group||''})
        );
      }
    }
    const seen=new Set(); students=students.filter(s=>{if(seen.has(s.uid))return false;seen.add(s.uid);return true;});
    students.sort((a,b)=>(a.group+a.name).localeCompare(b.group+b.name,'ko'));

    // 완료 목록
    const compSnap = await getDocs(collection(db, 'genTests', testId, 'userCompleted'));
    const compMap = {}; // uid → {score}
    compSnap.docs.forEach(d=>{ compMap[d.id]=d.data(); });

    // 점수 목록 (응시 여부 확인용)
    const scoreSnap = await getDocs(query(collection(db,'scores'),
      where('academyId','==',window.MY_ACADEMY_ID),
      where('testId','==',testId)
    ));
    const scoreMap = {}; // uid → 최고점수
    scoreSnap.docs.forEach(d=>{
      const s=d.data();
      if(!scoreMap[s.uid]||s.score>scoreMap[s.uid]) scoreMap[s.uid]=s.score;
    });

    const done    = students.filter(s=> compMap[s.uid]);                           // 완료
    const tried   = students.filter(s=>!compMap[s.uid] && scoreMap[s.uid]!==undefined); // 응시했지만 미통과
    const notYet  = students.filter(s=>!compMap[s.uid] && scoreMap[s.uid]===undefined);  // 시작 안 함

    // 반별 그룹화
    const groupMap = {};
    students.forEach(s=>{
      const g=s.group||'미배정';
      if(!groupMap[g]) groupMap[g]=[];
      groupMap[g].push(s);
    });

    // Phase B: 녹음숙제는 통과/불통 폐기 → "통과점수" 표시 안 함
    const tIsRec = (t.testMode || t.mode || '').toLowerCase() === 'recording';
    let html = `<div style="display:flex;gap:16px;margin-bottom:10px;font-size:12px;flex-wrap:wrap;">
      <span>총 <b>${students.length}</b>명</span>
      <span style="color:#059669;">✅ 완료 <b>${done.length}</b>명</span>
      <span style="color:#b45309;">🔄 응시중 <b>${tried.length}</b>명</span>
      <span style="color:#aaa;">⬜ 미시작 <b>${notYet.length}</b>명</span>
      ${tIsRec ? '<span style="color:var(--blue);">📤 제출 완료 방식 (통과/불통 X)</span>' : `<span style="color:var(--blue);">통과점수 <b>${t.passScore||80}점</b></span>`}
    </div>`;

    Object.keys(groupMap).sort((a,b)=>a.localeCompare(b,'ko')).forEach(g=>{
      const gs = groupMap[g];
      const gDone  = gs.filter(s=>compMap[s.uid]).length;
      const gTried = gs.filter(s=>!compMap[s.uid]&&scoreMap[s.uid]!==undefined).length;
      html += `<div style="margin-bottom:8px;">
        <div style="font-weight:700;font-size:12px;color:var(--gray);padding:4px 0;border-bottom:1px solid #eee;margin-bottom:5px;">
          👥 ${g} &nbsp;
          <span style="font-weight:400;">
            ✅${gDone} 🔄${gTried} ⬜${gs.length-gDone-gTried}
          </span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">
          ${gs.map(s=>{
            const c=compMap[s.uid];
            const sc=scoreMap[s.uid];
            const started = sc!==undefined;
            // 색상: 완료=초록, 응시중=주황, 미시작=회색
            const bg  = c ? '#d1fae5' : started ? '#fff3cd' : '#f3f4f6';
            const col = c ? '#059669' : started ? '#b45309' : '#9ca3af';
            const icon= c ? '✅' : started ? '🔄' : '⬜';
            return `<span style="display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;background:${bg};color:${col};">
              ${icon} ${esc(s.name)}${sc!==undefined?` <span style="font-size:10px;opacity:.8;">${sc}점</span>`:''}
            </span>`;
          }).join('')}
        </div>
      </div>`;
    });

    contentEl.innerHTML = html;
  }catch(e){ contentEl.textContent='불러오기 실패: '+e.message; }
};

// ── 엑셀 내보내기 ────────────────────────────────────────
window.exportStudentExcel = async(status='active') => {
  try{
    const snap = await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID),where('role','==','student'),where('status','==',status)));
    const students = snap.docs.map(d=>({id:d.id,...d.data()}));
    if (!students.length) { showAlert('입력 확인', '내보낼 학생이 없습니다.'); return; }

    const statusLabel = {active:'재원생',pause:'휴원생',out:'퇴원생'};
    // 수강료·납부일 셀 헬퍼 — export 시엔 항상 노출 (학원장 본인이 다운로드하는 파일)
    // 학생 수정 모달 select 의 옵션 라벨과 동일 형식: '5일' / '말일' / '학원기본'
    const _amt = (u) => parseInt(u.tuitionPlan?.amount) || 0;
    const _due = (u) => {
      const d = parseInt(u.tuitionPlan?.dueDay);
      if (!_amt(u)) return '';
      if (d === -1) return '말일';
      if (!isFinite(d) || d === 0) return '학원기본';
      return `${d}일`;
    };
    let headers, rows;
    // 양식 통일 (import / 샘플 과 동일 11 컬럼) + 참고용 컬럼은 끝에
    if(status==='active'){
      headers = ['아이디','이름','반','생일','학교','학년','연락처','부모님성함','부모님연락처','수강료','납부일','등록일'];
      rows = students.map(u=>[
        u.username||'', u.name||'', u.group||'', u.birth||'',
        u.school||'', u.grade||'', u.phone||'',
        u.parentName||'', u.parentPhone||'',
        _amt(u) || '', _due(u),
        u.createdAt?.toDate?u.createdAt.toDate().toLocaleDateString('ko-KR'):'',
      ]);
    } else {
      const dateCol = status==='pause'?'휴원일':'퇴원일';
      headers = ['아이디','이름','반','생일','학교','학년','연락처','부모님성함','부모님연락처','수강료','납부일','등록일',dateCol];
      rows = students.map(u=>[
        u.username||'', u.name||'', u.group||'', u.birth||'',
        u.school||'', u.grade||'', u.phone||'',
        u.parentName||'', u.parentPhone||'',
        _amt(u) || '', _due(u),
        u.createdAt?.toDate?u.createdAt.toDate().toLocaleDateString('ko-KR'):'',
        u.statusDate||'',
      ]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers,...rows]);
    // 컬럼 너비 설정
    ws['!cols'] = headers.map(()=>({wch:14}));
    XLSX.utils.book_append_sheet(wb, ws, statusLabel[status]);
    const today = _ymdKST();
    XLSX.writeFile(wb, `큰소리영어_${statusLabel[status]}_${today}.xlsx`);
    showToast(`✅ ${statusLabel[status]} ${students.length}명 엑셀 다운로드 완료!`);
  }catch(e){ showToast('내보내기 실패: '+e.message); }
};

// ── 클래스 수정 ──────────────────────────────────────────
window.editClass = async(id) => {
  const snap = await getDoc(doc(db,'groups',id));
  const g = snap.data(); if(!g) return;
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">반 수정</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="display:flex;flex-direction:column;gap:14px;font-size:13px;">
          <div><div style="color:var(--gray);margin-bottom:6px;">반 이름 *</div>
            <input id="editClassName" type="text" value="${esc(g.name||'')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:6px;">담당 선생님</div>
            <input id="editClassTeacher" type="text" value="${esc(g.teacher||'')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:6px;">메모</div>
            <textarea id="editClassMemo" rows="4" placeholder="반 운영 메모 (선택사항)" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:13px;outline:none;resize:vertical;font-family:inherit;">${esc(g.memo||'')}</textarea></div>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="updateClass('${id}')">저장</button>
      </div>
    </div>
  `);
};
window.updateClass = async(id) => {
  const name = document.getElementById('editClassName').value.trim();
  const teacher = document.getElementById('editClassTeacher').value.trim();
  const memo = (document.getElementById('editClassMemo')?.value || '').trim();
  if (!name) { showAlert('입력 확인', '반 이름을 입력하세요.'); return; }
  await updateDoc(doc(db,'groups',id),{name,teacher,memo});
  closeModal(); showToast('✅ 반 정보가 수정됐어요!');
  const ok = _pageMutate('classTableBody', data => {
    const i = data.findIndex(g => g.id === id);
    if (i >= 0) Object.assign(data[i], { name, teacher, memo });
  });
  if (!ok) await loadClasses();
};

// 비밀번호 변경 이력 렌더 헬퍼 (학생 정보 수정 모달용 — 2026-06-03)
const _PW_ACTOR_LABELS = {
  admin_excel:  { label: '엑셀 일괄 등록', color: '#0891b2' },
  admin_single: { label: '학원장 등록',    color: '#0891b2' },
  admin_reset:  { label: '학원장 재설정',  color: '#d97706' },
  student_self: { label: '학생 본인 변경', color: '#7c3aed' },
  super_reset:  { label: 'super 재설정',   color: '#dc2626' },
};
function _pwHistoryHtml(history) {
  if (!Array.isArray(history) || !history.length) {
    return `<div style="font-size:12px;color:var(--gray);padding:6px 0;">변경 이력 없음 (옛 학생은 2026-06-03 이전 등록분이라 데이터 없음)</div>`;
  }
  const items = history.slice(-10).reverse();  // 최근 10건, 최신 우선
  return `<div style="font-size:12px;display:flex;flex-direction:column;gap:6px;">${items.map(h => {
    const ts = h.ts?.toDate ? h.ts.toDate() : (h.ts ? new Date(h.ts.seconds ? h.ts.seconds*1000 : h.ts) : null);
    const tsStr = ts ? new Date(ts.getTime() + 9*3600*1000).toISOString().replace('T',' ').slice(0,16) : '-';
    const meta = _PW_ACTOR_LABELS[h.actor] || { label: h.actor || '?', color: '#666' };
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fafafa;border-radius:6px;">
      <span style="font-family:monospace;color:#666;">${tsStr}</span>
      <span style="background:${meta.color};color:white;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${esc(meta.label)}</span>
      ${h.actorName ? `<span style="color:#999;">${esc(h.actorName)}</span>` : ''}
    </div>`;
  }).join('')}</div>`;
}

// ── 학생 수정 ────────────────────────────────────────────
window.editStudent = async(id) => {
  const snap = await getDoc(doc(db,'users',id));
  const u = snap.data(); if(!u) return;
  const classSnap = await getDocs(query(collection(db,'groups'),where('academyId','==',window.MY_ACADEMY_ID)));
  const opts = classSnap.docs.map(d=>`<option value="${esc(d.data().name)}" ${u.group===d.data().name?'selected':''}>${esc(d.data().name)}</option>`).join('');
  showModal(`
    <div style="width:min(640px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">학생 정보 수정</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
          <div><div style="color:var(--gray);margin-bottom:5px;">아이디</div>
            <input type="text" value="${u.username||''}" disabled style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:#f5f5f5;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">이름 *</div>
            <input id="euName" type="text" value="${u.name||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">반</div>
            <select id="euGroup" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${opts}</select></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">생일</div>
            <input id="euBirth" type="date" value="${u.birth||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">학교</div>
            <input id="euSchool" type="text" value="${u.school||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">학년</div>
            <input id="euGrade" type="text" value="${u.grade||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">연락처</div>
            <input id="euPhone" type="tel" value="${u.phone||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">새 비밀번호</div>
            <div style="position:relative;"><input id="euPw" type="password" autocomplete="new-password" placeholder="변경 시만 입력" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 38px 8px 10px;font-size:13px;outline:none;"><button type="button" onclick="togglePwVis('euPw', this)" aria-label="비밀번호 보기" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:6px;line-height:0;color:#999;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></div></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">부모님 성함</div>
            <input id="euParentName" type="text" value="${u.parentName||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="color:var(--gray);margin-bottom:5px;">부모님 연락처</div>
            <input id="euParentPhone" type="tel" value="${u.parentPhone||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--border);">
          <div style="font-size:12px;color:var(--gray);font-weight:600;margin-bottom:8px;">💰 수강료 (월별 자동 청구)</div>
          <div style="display:grid;grid-template-columns:1fr 140px;gap:12px;font-size:13px;">
            <div><div style="color:var(--gray);margin-bottom:5px;">월 수강료</div>
              <input id="euTuitionAmount" type="number" value="${u.tuitionPlan?.amount || 0}" min="0" step="10000" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
            <div><div style="color:var(--gray);margin-bottom:5px;">납부일</div>
              <select id="euDueDay" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">
                <option value="0"${(u.tuitionPlan?.dueDay ?? 0) === 0 ? ' selected' : ''}>학원 기본값</option>
                ${Array.from({length:31},(_,i)=>i+1).map(n=>`<option value="${n}"${u.tuitionPlan?.dueDay === n ? ' selected' : ''}>${n}일</option>`).join('')}
                <option value="-1"${u.tuitionPlan?.dueDay === -1 ? ' selected' : ''}>말일</option>
              </select></div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--gray);margin-top:8px;">
            <input id="euTuitionActive" type="checkbox" ${(u.tuitionPlan?.active ?? true) ? 'checked' : ''}>
            매월 자동 청구서 생성 (해지 시 체크 해제 — 휴원/퇴원 처리 시 자동으로 해제됨)
          </label>
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--border);">
          <div style="font-size:12px;color:var(--gray);font-weight:600;margin-bottom:8px;">🔑 비밀번호 변경 이력 (최근 10건)</div>
          ${_pwHistoryHtml(u.passwordHistory)}
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--border);">
          <button class="btn btn-secondary" onclick="_billingOpenStuHistory('${id}','${esc(u.name||'').replace(/'/g,"\\'")}')" style="width:100%;font-size:13px;">💳 최근 12개월 결제 이력 보기</button>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="updateStudent('${id}')">저장</button>
      </div>
    </div>
  `);
};

// ── P3-3: 학생별 12개월 결제 이력 ─────────────────────────
window._billingOpenStuHistory = async (studentUid, studentName) => {
  const academyId = window.MY_ACADEMY_ID || 'default';
  // 최근 12개월 (KST 기준)
  let [y, m] = _ymdKST().slice(0, 7).split('-').map(Number);
  const months = [];
  for (let off = 0; off < 12; off++) {
    let mm = m - off, yy = y;
    while (mm <= 0) { mm += 12; yy--; }
    months.push(`${yy}-${String(mm).padStart(2,'0')}`);
  }

  // Firestore 'in' 은 최대 30개 — 12개월은 안전
  const snap = await getDocs(query(
    collection(db, 'billings'),
    where('academyId', '==', academyId),
    where('studentUid', '==', studentUid),
    where('yearMonth', 'in', months),
  ));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => (b.yearMonth || '').localeCompare(a.yearMonth || ''));  // 최신순

  // 통계
  const totalCharged = rows.reduce((s, b) => s + (b.totalAmount || 0), 0);
  const totalPaid = rows.reduce((s, b) => s + (b.paidAmount || 0), 0);
  const totalUnpaid = totalCharged - totalPaid;
  const paidPct = totalCharged > 0 ? Math.round((totalPaid / totalCharged) * 100) : 0;

  // 평균 납부 지연 일수 — paid 항목의 paidAt - dueDate 평균 (millis)
  let delaySum = 0, delayCount = 0;
  for (const b of rows) {
    const due = b.dueDate?.toDate?.();
    if (!due) continue;
    for (const item of (b.items || [])) {
      if (!item.paid) continue;
      const paidAt = item.paidAt?.toDate?.() || (typeof item.paidAt === 'number' ? new Date(item.paidAt) : null);
      if (!paidAt) continue;
      const days = Math.round((paidAt.getTime() - due.getTime()) / 86400000);
      delaySum += days;
      delayCount++;
    }
  }
  const avgDelay = delayCount > 0 ? Math.round(delaySum / delayCount) : null;

  const monthRow = (b) => {
    const status = _billingComputeStatus(b);
    const remain = (b.totalAmount || 0) - (b.paidAmount || 0);
    const stColor = { paid:'#15803d', partial:'#ca8a04', overdue:'#b91c1c', unpaid:'#475569' }[status];
    const stLabel = { paid:'완료', partial:'부분', overdue:'연체', unpaid:'미납' }[status];
    const due = b.dueDate?.toDate?.();
    const dueStr = due ? `${due.getMonth()+1}/${due.getDate()}` : '-';
    // 가장 마지막 paid 항목의 paidAt 으로 납부일 표시
    let lastPaidStr = '-';
    let delayStr = '';
    if (status === 'paid' || status === 'partial') {
      const paidItems = (b.items || []).filter(i => i.paid && i.paidAt);
      if (paidItems.length > 0) {
        const dates = paidItems.map(i => i.paidAt?.toDate?.() || (typeof i.paidAt === 'number' ? new Date(i.paidAt) : null)).filter(Boolean);
        if (dates.length > 0) {
          const last = new Date(Math.max(...dates.map(d => d.getTime())));
          lastPaidStr = `${last.getMonth()+1}/${last.getDate()}`;
          if (due) {
            const days = Math.round((last.getTime() - due.getTime()) / 86400000);
            delayStr = days > 0 ? `<span style="color:#c2410c;font-size:11px;">+${days}일</span>` : days < 0 ? `<span style="color:#15803d;font-size:11px;">${days}일</span>` : '<span style="color:#15803d;font-size:11px;">정시</span>';
          }
        }
      }
    }
    return `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:8px 12px;font-weight:600;">${b.yearMonth}</td>
        <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;">${(b.totalAmount||0).toLocaleString()}</td>
        <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;color:#15803d;">${(b.paidAmount||0).toLocaleString()}</td>
        <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;color:${remain>0?'#c2410c':'#15803d'};">${remain.toLocaleString()}</td>
        <td style="padding:8px 12px;text-align:center;font-size:12px;color:var(--gray);">${dueStr}</td>
        <td style="padding:8px 12px;text-align:center;font-size:12px;">${lastPaidStr} ${delayStr}</td>
        <td style="padding:8px 12px;text-align:center;"><span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${stColor}20;color:${stColor};">${stLabel}</span></td>
      </tr>`;
  };

  showModal(`
    <div style="width:min(820px,94vw);max-height:90vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">💳 ${esc(studentName)} 결제 이력</div>
        <div style="font-size:12px;color:var(--gray);margin-top:3px;">최근 12개월 — ${rows.length}건 청구서</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <!-- 누적 통계 -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;">
          <div style="padding:12px;background:#f8fafc;border-radius:8px;text-align:center;">
            <div style="font-size:10px;color:var(--gray);">누적 청구</div>
            <div style="font-size:16px;font-weight:800;margin-top:3px;">${totalCharged.toLocaleString()}원</div>
          </div>
          <div style="padding:12px;background:#f0fdf4;border-radius:8px;text-align:center;">
            <div style="font-size:10px;color:#15803d;">누적 입금</div>
            <div style="font-size:16px;font-weight:800;margin-top:3px;color:#15803d;">${totalPaid.toLocaleString()}원</div>
            <div style="font-size:10px;color:#15803d;margin-top:1px;">${paidPct}%</div>
          </div>
          <div style="padding:12px;background:#fff7ed;border-radius:8px;text-align:center;">
            <div style="font-size:10px;color:#c2410c;">미수금</div>
            <div style="font-size:16px;font-weight:800;margin-top:3px;color:#c2410c;">${totalUnpaid.toLocaleString()}원</div>
          </div>
          <div style="padding:12px;background:${avgDelay !== null && avgDelay > 7 ? '#fef2f2' : '#f8fafc'};border-radius:8px;text-align:center;">
            <div style="font-size:10px;color:var(--gray);">평균 납부 지연</div>
            <div style="font-size:16px;font-weight:800;margin-top:3px;color:${avgDelay !== null && avgDelay > 7 ? '#b91c1c' : avgDelay !== null && avgDelay <= 0 ? '#15803d' : 'var(--text)'};">${avgDelay === null ? '-' : (avgDelay > 0 ? `+${avgDelay}일` : `${avgDelay}일`)}</div>
            <div style="font-size:10px;color:var(--gray);margin-top:1px;">${delayCount}회 입금 기준</div>
          </div>
        </div>

        ${rows.length === 0 ? `
          <div style="padding:40px;text-align:center;color:#bbb;font-size:13px;">결제 이력이 없습니다.</div>
        ` : `
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f8f9fa;border-bottom:2px solid var(--border);">
              <th style="padding:8px 12px;text-align:left;">월</th>
              <th style="padding:8px 12px;text-align:right;">청구</th>
              <th style="padding:8px 12px;text-align:right;">입금</th>
              <th style="padding:8px 12px;text-align:right;">미수</th>
              <th style="padding:8px 12px;text-align:center;">납부기한</th>
              <th style="padding:8px 12px;text-align:center;">납부일</th>
              <th style="padding:8px 12px;text-align:center;">상태</th>
            </tr>
          </thead>
          <tbody>${rows.map(monthRow).join('')}</tbody>
        </table>
        `}
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">닫기</button>
      </div>
    </div>
  `);
};
window.updateStudent = async(id) => {
  const name = document.getElementById('euName').value.trim();
  if (!name) { showAlert('입력 확인', '이름을 입력하세요.'); return; }
  const newPw = (document.getElementById('euPw')?.value || '').trim();
  if (newPw && newPw.length < 6) { showAlert('비밀번호 확인', '비밀번호는 6자 이상이어야 합니다.'); return; }
  const tuitionAmount = parseInt(document.getElementById('euTuitionAmount')?.value) || 0;
  const dueDayRaw = parseInt(document.getElementById('euDueDay')?.value);
  const tuitionActive = !!document.getElementById('euTuitionActive')?.checked;
  // 기존 tuitionPlan.startMonth 보존 (없으면 이번 달)
  const existSnap = await getDoc(doc(db,'users',id));
  const existPlan = existSnap.data()?.tuitionPlan || {};
  const data = {
    name, group:document.getElementById('euGroup').value,
    birth:document.getElementById('euBirth').value,
    school:document.getElementById('euSchool').value.trim(),
    grade:document.getElementById('euGrade').value.trim(),
    phone:document.getElementById('euPhone').value.trim(),
    parentName:document.getElementById('euParentName').value.trim(),
    parentPhone:document.getElementById('euParentPhone').value.trim(),
    tuitionPlan: {
      amount: tuitionAmount,
      dueDay: isFinite(dueDayRaw) ? dueDayRaw : 0,
      startMonth: existPlan.startMonth || new Date(Date.now() + 9*3600*1000).toISOString().slice(0, 7),
      active: tuitionActive && tuitionAmount > 0,
    },
  };
  try {
    await updateDoc(doc(db,'users',id), data);
    if (newPw) {
      const idToken = await currentUser.getIdToken();
      const r = await fetch('/api/updateStudentPassword', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ idToken, uid: id, password: newPw }),
      });
      const j = await r.json();
      if (!j.success) { showAlert('비밀번호 변경 실패', j.error || '서버 오류'); return; }
    }
    // 학생 수강료/납부일 변경 시 이번 달 미입금 청구서 동기화 (자동 생성된 수강료 항목만)
    await _syncCurrentMonthBilling(id, data.tuitionPlan, data.name);
    closeModal();
    showToast(newPw ? '✅ 학생 정보 + 비밀번호 변경 완료' : '✅ 학생 정보가 수정됐어요!');
    // surgical 갱신 — 현재 화면(반·검색·페이지) 유지. 반 변경 시 옛 반 필터면 제거.
    const fromStatus = currentPage==='student-pause'?'pause':currentPage==='student-out'?'out':'active';
    const filter = _stuStates[fromStatus]?.group;
    // 반 변경 + 현재 필터가 특정 반 + 새 반과 불일치 → 제거. 그 외 → 필드 inline patch.
    if (filter && filter !== '__all__' && filter !== data.group) {
      _stuSurgical(fromStatus, [id], {remove: true});
    } else {
      _stuSurgical(fromStatus, [id], {patch: (s) => Object.assign(s, data)});
    }
  } catch(e) {
    showAlert('저장 실패', e.message);
  }
};

// 학생 수강료/납부일 변경 시 이번 달 청구서 자동 동기화.
// 안전 조건: paid=false 인 system 자동 생성 수강료 항목만 갱신. 사용자 추가 항목 보존.
async function _syncCurrentMonthBilling(studentUid, newPlan, newName) {
  if (!newPlan) return;
  try {
    const academyId = window.MY_ACADEMY_ID || 'default';
    const ym = _ymdKST().slice(0, 7);
    const snap = await getDocs(query(
      collection(db, 'billings'),
      where('academyId', '==', academyId),
      where('yearMonth', '==', ym),
      where('studentUid', '==', studentUid),
    ));
    if (snap.empty) return;  // 청구서 없음 — 다음 달 새로 생성될 때 새 plan 적용

    // 학원 default + 학생 dueDay 로 새 dueDate 계산
    if (!_billingSettings) {
      const acad = await getDoc(doc(db, 'academies', academyId));
      _billingSettings = acad.exists() ? (acad.data().paymentSettings || {}) : {};
    }
    const rawDD = _billingSettings?.defaultDueDay;
    const defaultDueDay = (isFinite(rawDD) && (rawDD === -1 || (rawDD >= 1 && rawDD <= 31))) ? rawDD : 15;
    let dueDay = parseInt(newPlan.dueDay);
    if (!isFinite(dueDay) || dueDay === 0) dueDay = defaultDueDay;
    const [y, mm] = ym.split('-').map(Number);
    const lastDay = new Date(y, mm, 0).getDate();
    const actualDay = (dueDay === -1) ? lastDay : Math.min(Math.max(1, dueDay), lastDay);
    const newDueDate = new Date(y, mm - 1, actualDay);

    const newAmount = parseInt(newPlan.amount) || 0;

    for (const billingDoc of snap.docs) {
      const b = billingDoc.data();
      const items = (b.items || []).slice();
      let changed = false;

      // system 자동 생성 + 미입금 + tuition 항목만 동기화
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.type !== 'tuition' || it.addedBy !== 'system' || it.paid) continue;
        if (it.amount !== newAmount) {
          items[i] = { ...it, amount: newAmount };
          changed = true;
        }
      }

      // 비활성/금액 0 → 자동 항목 제거 (다른 항목 있으면 그것만 남김)
      if (!newPlan.active || newAmount <= 0) {
        const before = items.length;
        const filtered = items.filter(it => !(it.type === 'tuition' && it.addedBy === 'system' && !it.paid));
        if (filtered.length !== before) {
          items.splice(0, items.length, ...filtered);
          changed = true;
        }
      }

      // 합계 재계산
      const totalAmount = items.reduce((s, it) => s + (it.amount || 0), 0);
      const paidAmount = items.filter(it => it.paid).reduce((s, it) => s + (it.amount || 0), 0);
      const status = totalAmount === 0 ? 'paid'
        : paidAmount >= totalAmount ? 'paid'
        : paidAmount > 0 ? 'partial'
        : (b.dueDate?.toDate && b.dueDate.toDate() < new Date()) ? 'overdue' : 'unpaid';

      const update = { items, totalAmount, paidAmount, status, updatedAt: serverTimestamp() };
      // dueDate 도 변경됐으면 갱신 (기존과 다를 때만)
      const oldDueDate = b.dueDate?.toDate?.()?.getTime() || 0;
      if (Math.abs(oldDueDate - newDueDate.getTime()) > 1000) {
        update.dueDate = newDueDate;
        changed = true;
      }
      if (newName && b.studentName !== newName) {
        update.studentName = newName;
        changed = true;
      }

      if (changed) await updateDoc(billingDoc.ref, update);
    }
  } catch (e) { console.warn('[syncCurrentMonthBilling]', e.message); }
}

// ── 공지 수정 ────────────────────────────────────────────
window.editNotice = async(id) => {
  const snap = await getDoc(doc(db,'notices',id));
  const n = snap.data(); if(!n) return;
  // 옛 단일 target 도 신 schema 로 변환해서 picker 초기값으로
  let initialTargets = Array.isArray(n.targets) ? n.targets : [];
  if (!initialTargets.length && n.target) {
    if (n.target === 'all') initialTargets = [{ type:'all', id:'__all__', name:'전체 학원생' }];
    else initialTargets = [{ type:'class', id:n.target, name:n.target+' 전체', groupName:n.target }];
  }
  // 기존 만료일·첨부 prefill
  const expYmd = n.expiresAt?.toDate?.()
    ? new Date(n.expiresAt.toDate().getTime() + 9 * 3600000).toISOString().slice(0, 10)
    : null;
  _noticePendingAttaches = (Array.isArray(n.attachments) ? n.attachments : []).map(a => ({
    file: null, name: a.name || '파일', sizeKB: a.sizeKB || 0, status: 'done', url: a.url,
  }));
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">공지 수정</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <div style="font-size:13px;color:var(--gray);margin-bottom:6px;">📤 대상</div>
            <div id="noticePickerSummary" style="padding:6px 10px;background:#f8f9fa;border-radius:6px;font-size:12px;margin-bottom:6px;min-height:30px;display:flex;align-items:center;flex-wrap:wrap;gap:4px;"></div>
            <div id="noticePickerBox"></div>
          </div>
          <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">제목 *</div>
            <input id="enTitle" type="text" value="${(n.title||'').replace(/"/g,'&quot;')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">내용 *</div>
            <textarea id="enContent" rows="5" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;resize:vertical;outline:none;">${esc(n.content)||''}</textarea></div>
          ${_noticeAttachBoxHtml(expYmd, _noticePendingAttaches)}
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="updateNotice('${id}')">저장</button>
      </div>
    </div>
  `);
  _noticeRenderAttaches();
  await pickerInit({
    boxEl: 'noticePickerBox',
    summaryEl: 'noticePickerSummary',
    initialTargets,
    allowAll: true,
    emptyText: '반/학생을 선택하거나 전체를 체크하세요',
    height: 220,
  });
};
window.updateNotice = async(id) => {
  const title = document.getElementById('enTitle').value.trim();
  const content = document.getElementById('enContent').value.trim();
  const expYmd = document.getElementById('noticeExpiresAt')?.value;
  const targets = pickerGetTargets();
  if (!title||!content) { showAlert('입력 확인', '제목과 내용을 입력하세요.'); return; }
  if (!targets.length) { showAlert('입력 확인', '대상을 선택하세요.'); return; }
  if (!expYmd) { showAlert('입력 확인', '만료일을 선택하세요.'); return; }
  // 첨부 일괄 업로드 (기존 done 은 그대로, 신규 pending 만 업로드)
  let attachments = [];
  try { attachments = await _noticeUploadAll(); }
  catch (e) { showAlert('첨부 업로드 실패', e.message); return; }
  const expiresAt = new Date(expYmd + 'T23:59:59+09:00');
  const patch = {
    title, content,
    targets,
    targetSummary: pickerSummarize(targets),
    expiresAt,
    attachments,
    // 옛 단일 target 필드는 그대로 둠 (학생앱 폴백 표시용 — 데이터 삭제 시 자연 사라짐)
  };
  await updateDoc(doc(db,'notices',id), patch);
  closeModal(); _noticeClearAttaches();
  showToast('✅ 공지가 수정됐어요!');
  const ok = _pageMutate('noticeTableBody', data => {
    const i = data.findIndex(n => n.id === id);
    if (i >= 0) Object.assign(data[i], patch);
  });
  if (!ok) await loadNotices();
};

function printExamPDF(words, examName, academy, date, ptype, qType){
  qType = qType || 'both';

  const questions = words.map((w, idx)=>{
    let isEn2Ko;
    if(w.testType === 'spelling') isEn2Ko = false;
    else if(qType==='en2ko') isEn2Ko = true;
    else if(qType==='ko2en') isEn2Ko = false;
    else isEn2Ko = idx < Math.ceil(words.length/2);
    return { num:idx+1, question:isEn2Ko?w.en:w.ko, answer:isEn2Ko?w.ko:w.en, isEn2Ko };
  });

  const half = Math.ceil(questions.length/2);
  const leftQs = questions.slice(0, half);
  const rightQs = questions.slice(half);

  // 이미지 양식: 번호. 단어(굵게) → 아래 빈 줄
  const makeQHTML = (q) => `
    <div style="margin-bottom:22px;break-inside:avoid;">
      <div style="font-size:11pt;font-weight:700;margin-bottom:7px;">${q.num}. ${q.question}</div>
      <div style="border-bottom:1.5px solid #333;width:85%;">&nbsp;</div>
    </div>`;

  const makeAnswerQHTML = (q) => `
    <div style="margin-bottom:22px;break-inside:avoid;">
      <div style="font-size:11pt;font-weight:700;margin-bottom:4px;">
        ${q.num}. ${q.question}
        <span style="font-weight:400;color:#1a6b1a;font-size:10pt;margin-left:8px;">${q.answer}</span>
      </div>
      <div style="border-bottom:1px solid #ccc;width:85%;">&nbsp;</div>
    </div>`;

  const makeSection = (qs, isAnswerPage) => {
    if(qType !== 'both') return qs.map(q=>isAnswerPage?makeAnswerQHTML(q):makeQHTML(q)).join('');
    const en2ko = qs.filter(q=>q.isEn2Ko);
    const ko2en = qs.filter(q=>!q.isEn2Ko);
    let html = '';
    if(en2ko.length) html += `
      <div style="font-size:9pt;font-weight:600;margin-bottom:10px;padding:3px 8px;background:#f5f5f5;border-radius:3px;">▸ 영어 → 한글</div>
      ${en2ko.map(q=>isAnswerPage?makeAnswerQHTML(q):makeQHTML(q)).join('')}`;
    if(ko2en.length) html += `
      <div style="font-size:9pt;font-weight:600;margin:6px 0 10px;padding:3px 8px;background:#f5f5f5;border-radius:3px;">▸ 한글 → 영어</div>
      ${ko2en.map(q=>isAnswerPage?makeAnswerQHTML(q):makeQHTML(q)).join('')}`;
    return html;
  };

  const makeExamPage = (isAnswer) => `
    <div style="page-break-after:always;padding:20px 24px 16px;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;background:white;">
      <div style="font-size:15pt;font-weight:900;margin-bottom:14px;">${examName}${isAnswer?' (답안지)':''}</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:18px;border-bottom:1px solid #000;padding-bottom:8px;">
        <div style="font-size:10.5pt;font-weight:700;">학원명 : <span style="font-weight:400;">${academy}</span></div>
        <div style="font-size:10pt;">
          학교 : <span style="display:inline-block;width:80px;border-bottom:1px solid #000;">&nbsp;</span>
          &nbsp;학년 : <span style="display:inline-block;width:36px;border-bottom:1px solid #000;">&nbsp;</span>
          &nbsp;반 : <span style="display:inline-block;width:36px;border-bottom:1px solid #000;">&nbsp;</span>
          &nbsp;이름 : <span style="display:inline-block;width:80px;border-bottom:1px solid #000;">&nbsp;</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1px 1fr;gap:0 20px;">
        <div>${makeSection(leftQs, isAnswer)}</div>
        <div style="background:#ccc;"></div>
        <div style="padding-left:20px;">${makeSection(rightQs, isAnswer)}</div>
      </div>
    </div>`;

  let pageHTML = '';
  if(ptype==='both'||ptype==='exam')   pageHTML += makeExamPage(false);
  if(ptype==='both'||ptype==='answer') pageHTML += makeExamPage(true);

  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${examName}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;background:white;}
      @media print{@page{margin:10mm;size:A4;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
    </style>
    </head><body>${pageHTML}
    <script>window.onload=()=>{window.print();}<\/script></body></html>`);
  win.document.close();
}

// ══════════════════════════════════════════════════════════
// GENERATOR
// ══════════════════════════════════════════════════════════
let _genPages = [], _genChapters = [], _genBooks = [];
let _genImages = [];
let _genCheckedPages = new Set(), _genCheckedChapters = new Set(), _genCheckedBooks = new Set();
let _genActiveBook = null, _genActiveChapter = null, _genActivePage = null;
// Book 클릭 lazy fetch race 가드 — 늦게 온 옛 응답 무시 (AI OCR genClickBook + AI Generator qgSelectBook 공용)
let _genBookFetchToken = 0;
// Chapter 이동 모달 — 선택된 Book ({id,name}|null). 모달 내 Book→Chapter 2단 흐름 상태
let _genMoveBook = null;
let _genMoveBookToken = 0;  // 모달 내 Book별 chapter lazy fetch race 가드
let _genPageCur = 1;
const _genPageSize = 20;

let _genResizing = false, _genResizerInited = false;
function _genInitResizer() {
  if (_genResizerInited) return;
  _genResizerInited = true;
  const panel = document.getElementById('genEditorPanel');
  const resizer = document.getElementById('genResizer');
  const grid = document.getElementById('genGrid');
  if (!panel || !resizer || !grid) return;
  // 저장된 폭 복원
  const saved = localStorage.getItem('generator_editor_width');
  if (saved) panel.style.width = saved + 'px';
  resizer.addEventListener('mousedown', () => {
    _genResizing = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    resizer.style.background = 'var(--teal)';
  });
  document.addEventListener('mousemove', e => {
    if (!_genResizing) return;
    const containerLeft = grid.getBoundingClientRect().left;
    let w = e.clientX - containerLeft - 15;
    w = Math.max(250, Math.min(w, grid.clientWidth * 0.6));
    panel.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!_genResizing) return;
    _genResizing = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    resizer.style.background = '';
    const w = parseInt(panel.style.width);
    if (w) localStorage.setItem('generator_editor_width', w);
  });
}

// AI OCR — Lazy load (2026-05-14): 진입 시 Books + 미배정 Chapters/Pages, Book 클릭 시 그 Book 의 Chapters+Pages
// opts.keepActive=true: CRUD 후 호출 — _genActiveBook/Chapter 보존 + 선택된 Book 의 Chapter/Page 도 re-fetch
window.loadGenerator = async (opts = {}) => {
  _genInitResizer();
  const keepActive = !!opts.keepActive;
  const savedBook = keepActive ? _genActiveBook : null;
  const savedChapter = keepActive ? _genActiveChapter : null;
  try {
    const bookFetch = getDocs(query(
      collection(db,'genBooks'),
      where('academyId','==',window.MY_ACADEMY_ID),
      orderBy('createdAt','asc')
    ));
    // 미배정 Page (bookId=null) — OCR 막 찍은 거 / 수동 생성 / Book 에서 제외된 것
    const unassignedPageFetch = getDocs(query(
      collection(db,'genPages'),
      where('academyId','==',window.MY_ACADEMY_ID),
      where('bookId','==', null),
      orderBy('serialNumber','asc')
    ));
    // 미배정 Chapter (bookId=null) — 신규 Chapter / Book 에서 제외된 것
    const unassignedChapterFetch = getDocs(query(
      collection(db,'genChapters'),
      where('academyId','==',window.MY_ACADEMY_ID),
      where('bookId','==', null),
      orderBy('order','asc')
    ));
    // 활성 Book 이 있으면 그 Book 의 Chapter/Page 도 re-fetch (keepActive 시)
    const activeChapterFetch = savedBook ? getDocs(query(
      collection(db,'genChapters'),
      where('academyId','==',window.MY_ACADEMY_ID),
      where('bookId','==', savedBook),
      orderBy('order','asc')
    )) : Promise.resolve({docs:[]});
    const activePageFetch = savedBook ? getDocs(query(
      collection(db,'genPages'),
      where('academyId','==',window.MY_ACADEMY_ID),
      where('bookId','==', savedBook),
      orderBy('serialNumber','asc')
    )) : Promise.resolve({docs:[]});
    const [bSnap, upSnap, ucSnap, acSnap, apSnap] = await Promise.all([
      bookFetch, unassignedPageFetch, unassignedChapterFetch, activeChapterFetch, activePageFetch
    ]);
    _genBooks = bSnap.docs.map(d=>({id:d.id,...d.data()}));
    _genPages = upSnap.docs.map(d=>({id:d.id,...d.data()}));
    _genChapters = ucSnap.docs.map(d=>({id:d.id,...d.data()}));
    if (savedBook) {
      _genChapters = _genChapters.concat(acSnap.docs.map(d=>({id:d.id,...d.data()})));
      _genPages = _genPages.concat(apSnap.docs.map(d=>({id:d.id,...d.data()})));
    }
    _genCheckedPages.clear(); _genCheckedChapters.clear(); _genCheckedBooks.clear();
    if (keepActive) {
      // active state 유지 — 단, Book/Chapter 가 삭제됐을 수 있으니 존재 확인
      _genActiveBook = _genBooks.some(b => b.id === savedBook) ? savedBook : null;
      _genActiveChapter = _genChapters.some(c => c.id === savedChapter) ? savedChapter : null;
    } else {
      _genActiveBook = null; _genActiveChapter = null;
    }
    _genActivePage = null;
    _genPageCur = 1;
    _genRenderAll();
    _cleanupLoadPresets();
  } catch(e) { showToast('AI OCR 로드 실패: '+e.message); }
};

function _genRenderAll() {
  _genRenderBooks();
  _genRenderChapters();
  _genRenderPages();
  _genUpdateEditor();
}

function _genFilteredChapters() {
  if (!_genActiveBook) return _genChapters;
  return _genChapters.filter(c => c.bookId === _genActiveBook);
}

function _genFilteredPages() {
  if (_genActiveChapter) return _genPages.filter(p => p.chapterId === _genActiveChapter);
  if (_genActiveBook) return _genPages.filter(p => p.bookId === _genActiveBook);
  return _genPages.filter(p => !p.chapterId);
}

function _genRecentSort(arr) {
  // Firestore Timestamp (toMillis) + 클라 측 Date/number 모두 처리
  // (신규 push 직후 클라 캐시엔 Date — Firestore 의 serverTimestamp 가 안 들어감)
  const t = x => {
    const v = x?.updatedAt || x?.createdAt;
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    return 0;
  };
  return [...arr].sort((a,b) => t(b) - t(a));
}

// ── 정렬 + 검색 (Book/Chapter/Page 공통) ───────────────
// kind: 'books' | 'chapters' | 'pages'
// 기본 'recent' (최근순). 같은 헤더 클릭 시 'name' 토글, 다시 클릭 시 'recent' 로
const _genSort = { books: 'recent', chapters: 'recent', pages: 'recent' };
const _genSearch = { books: '', chapters: '', pages: '' };

window.genToggleSort = (kind) => {
  _genSort[kind] = _genSort[kind] === 'recent' ? 'name' : 'recent';
  if (kind === 'books') _genRenderBooks();
  else if (kind === 'chapters') _genRenderChapters();
  else if (kind === 'pages') _genRenderPages();
};

window.genUpdateSearch = (kind, value) => {
  _genSearch[kind] = String(value || '').trim().toLowerCase();
  if (kind === 'books') _genRenderBooks();
  else if (kind === 'chapters') _genRenderChapters();
  else if (kind === 'pages') _genRenderPages();
};

function _genApplySortSearch(kind, arr, nameKey = 'name') {
  let result = arr;
  // 검색
  const term = _genSearch[kind];
  if (term) {
    result = result.filter(x => String(x[nameKey] || x.title || '').toLowerCase().includes(term));
  }
  // 정렬
  if (_genSort[kind] === 'name') {
    // numeric:true → "Page 2" < "Page 10" 자연 정렬
    result = [...result].sort((a,b) =>
      String(a[nameKey] || a.title || '').localeCompare(String(b[nameKey] || b.title || ''), 'ko', { numeric: true }));
  } else {
    result = _genRecentSort(result);
  }
  return result;
}

function _genUpdateSortMark(kind) {
  const id = kind === 'books' ? 'genBookSortMark' : kind === 'chapters' ? 'genChapterSortMark' : 'genPageSortMark';
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = _genSort[kind] === 'name' ? '· 이름순▼' : '· 최근순▼';
}

function _genRenderBooks() {
  const el = document.getElementById('genBookList');
  const cnt = document.getElementById('genBookCount');
  const clearBtn = document.getElementById('genBookClearBtn');
  if (clearBtn) clearBtn.style.display = (_genActiveBook || _genCheckedBooks.size > 0) ? '' : 'none';
  _genUpdateSortMark('books');
  if (!el) return;
  if (!_genBooks.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:12px;">Book이 없습니다</div>';
    if (cnt) cnt.textContent = '';
    _genToolbar('book'); return;
  }
  const sorted = _genApplySortSearch('books', _genBooks, 'name');
  if (cnt) cnt.textContent = (_genSearch.books ? `${sorted.length}/${_genBooks.length}` : `${_genBooks.length}`) + '개';
  if (!sorted.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:12px;">검색 결과 없음</div>';
    _genToolbar('book'); return;
  }
  el.innerHTML = sorted.map(b => {
    const chCnt = _genChapters.filter(c=>c.bookId===b.id).length;
    const pgCnt = _genPages.filter(p=>p.bookId===b.id).length;
    const active = _genActiveBook === b.id;
    return `
    <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid #f0f0f0;background:${active?'var(--teal-light)':''};cursor:pointer;transition:background .1s;" onclick="genClickBook('${b.id}')">
      <input type="checkbox" data-id="${b.id}" ${_genCheckedBooks.has(b.id)?'checked':''} onchange="genOnBookCheck(this)" onclick="event.stopPropagation()">
      <div style="flex:1;min-width:0;pointer-events:none;">
        <div style="font-weight:600;color:${active?'var(--teal)':'var(--text)'};font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(b.name)}</div>
        <div style="font-size:11px;color:var(--gray);">Ch ${chCnt} · Pg ${pgCnt}</div>
      </div>
    </div>`;
  }).join('');
  _genToolbar('book');
}

function _genRenderChapters() {
  const el = document.getElementById('genChapterList');
  const cnt = document.getElementById('genChapterCount');
  const clearBtn = document.getElementById('genChapterClearBtn');
  if (clearBtn) clearBtn.style.display = (_genActiveChapter || _genCheckedChapters.size > 0) ? '' : 'none';
  _genUpdateSortMark('chapters');
  if (!el) return;
  const filtered = _genFilteredChapters();
  if (!filtered.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:12px;">Chapter가 없습니다</div>';
    if (cnt) cnt.textContent = '';
    _genToolbar('chapter'); return;
  }
  const sorted = _genApplySortSearch('chapters', filtered, 'name');
  if (cnt) cnt.textContent = (_genSearch.chapters ? `${sorted.length}/${filtered.length}` : `${filtered.length}`) + '개';
  if (!sorted.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:12px;">검색 결과 없음</div>';
    _genToolbar('chapter'); return;
  }
  el.innerHTML = sorted.map(c => {
    const pgCnt = _genPages.filter(p=>p.chapterId===c.id).length;
    const active = _genActiveChapter === c.id;
    return `
    <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid #f0f0f0;background:${active?'var(--teal-light)':''};cursor:pointer;transition:background .1s;" onclick="genClickChapter('${c.id}')">
      <input type="checkbox" data-id="${c.id}" ${_genCheckedChapters.has(c.id)?'checked':''} onchange="genOnChapterCheck(this)" onclick="event.stopPropagation()">
      <div style="flex:1;min-width:0;pointer-events:none;">
        <div style="font-weight:600;color:${active?'var(--teal)':'var(--text)'};font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.name)}</div>
        <div style="font-size:11px;color:${c.bookId?'var(--gray)':'#bbb'};font-style:${c.bookId?'normal':'italic'};">${c.bookId?esc(c.bookName||''):'미지정'} · Pg ${pgCnt}</div>
      </div>
    </div>`;
  }).join('');
  _genToolbar('chapter');
}

function _genRenderPages() {
  const el = document.getElementById('genPageList');
  const cnt = document.getElementById('genPageCount');
  const clearBtn = document.getElementById('genPageClearBtn');
  if (clearBtn) clearBtn.style.display = (_genActivePage || _genCheckedPages.size > 0) ? '' : 'none';
  _genUpdateSortMark('pages');
  if (!el) return;
  const filtered = _genFilteredPages();
  const sorted = _genApplySortSearch('pages', filtered, 'title');
  const total = sorted.length;
  const totalPgs = Math.ceil(total / _genPageSize) || 1;
  if (_genPageCur > totalPgs) _genPageCur = 1;
  const start = (_genPageCur-1)*_genPageSize;
  const slice = sorted.slice(start, start+_genPageSize);
  if (cnt) cnt.textContent = (filtered.length === total ? total : `${total}/${filtered.length}`) + '개';
  if (!total) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:12px;">' + (filtered.length ? '검색 결과 없음' : 'Page가 없습니다') + '</div>';
    _genRenderPagePaging(0,0); _genToolbar('page'); return;
  }
  el.innerHTML = slice.map(p => {
    const active = _genActivePage === p.id;
    const book = (_genBooks||[]).find(b => b.id === p.bookId);
    const chap = (_genChapters||[]).find(c => c.id === p.chapterId);
    const subpath = [book?.name, chap?.name].filter(Boolean).join(' › ') || '미지정';
    const preview = (p.text||'').slice(0, 80);
    return `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-bottom:1px solid #f0f0f0;background:${active?'var(--teal-light)':''};cursor:pointer;transition:background .1s;" onclick="genClickPage('${p.id}')">
      <input type="checkbox" data-id="${p.id}" ${_genCheckedPages.has(p.id)?'checked':''} onchange="genOnPageCheck(this)" onclick="event.stopPropagation()" style="margin-top:3px;flex-shrink:0;">
      <div style="flex:1;min-width:0;pointer-events:none;">
        <div style="font-weight:600;color:${active?'var(--teal)':'var(--text)'};font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.title||'Page '+p.serialNumber)}</div>
        <div style="font-size:11px;color:${p.chapterId?'var(--gray)':'#bbb'};font-style:${p.chapterId?'normal':'italic'};margin-top:1px;">#${p.serialNumber} · ${esc(subpath)}</div>
        ${preview ? `<div style="font-size:10px;color:#aaa;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(preview)}${(p.text||'').length>80?'…':''}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  _genRenderPagePaging(totalPgs, _genPageCur);
  _genToolbar('page');
  _genUpdateEditor();
}

function _genRenderPagePaging(total, cur) {
  const el = document.getElementById('genPagePagination');
  if (!el) return;
  if (total <= 1) { el.innerHTML=''; return; }
  const s = 'border:1px solid var(--border);border-radius:4px;padding:2px 7px;cursor:pointer;font-size:11px;';
  let h = '';
  if (cur>1) h += `<button onclick="genPageGo(${cur-1})" style="${s}background:white;">&#8249;</button>`;
  for (let i=Math.max(1,cur-2); i<=Math.min(total,cur+2); i++) {
    const active = i===cur;
    h += `<button onclick="genPageGo(${i})" style="${s}background:${active?'var(--teal)':'white'};color:${active?'white':'inherit'};border-color:${active?'var(--teal)':'var(--border)'};">${i}</button>`;
  }
  if (cur<total) h += `<button onclick="genPageGo(${cur+1})" style="${s}background:white;">&#8250;</button>`;
  el.innerHTML = h;
}

window.genPageGo = (n) => { _genPageCur=n; _genRenderPages(); };

// 헤더 해제 버튼 — active 해제 + 체크박스 모두 해제
window.genClearBook = () => {
  _genActiveBook = null;
  _genCheckedBooks.clear();
  // active Book 의존성 (Chapter/Page 필터) 도 갱신
  _genRenderAll();
};
window.genClearChapter = () => {
  _genActiveChapter = null;
  _genCheckedChapters.clear();
  _genRenderChapters(); _genRenderPages();
};
window.genClearPage = () => {
  _genActivePage = null;
  _genCheckedPages.clear();
  _genRenderPages();
  _genUpdateEditor();
};

function _genToolbar(type) {
  const cnt = type==='page'?_genCheckedPages.size:type==='chapter'?_genCheckedChapters.size:_genCheckedBooks.size;
  if (type==='page') {
    // Page [수정] 은 1개=단일 수정 / 2개+=병합 모달 → 1개 이상이면 활성
    ['genPageEditBtn','genPageMoveBtn','genPageExcludeBtn','genPageDeleteBtn'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.disabled = cnt===0;
    });
    // Cleanup 버튼: 1개 이상 체크 시 활성화
    const cleanupBtn=document.getElementById('genPageCleanupBtn');
    if (cleanupBtn) cleanupBtn.disabled = cnt===0;
  } else if (type==='chapter') {
    ['genChapterEditBtn','genChapterMoveBtn','genChapterExcludeBtn','genChapterDeleteBtn'].forEach((id,i)=>{
      const el=document.getElementById(id); if(el) el.disabled = i===0?cnt!==1:cnt===0;
    });
  } else {
    ['genBookEditBtn','genBookDeleteBtn'].forEach((id,i)=>{
      const el=document.getElementById(id); if(el) el.disabled = i===0?cnt!==1:cnt===0;
    });
  }
}

function _genUpdateEditor() {
  const titleEl = document.getElementById('genEditTitle');
  const textEl = document.getElementById('genEditText');
  const pidEl = document.getElementById('genEditPageId');
  const saveBtn = document.getElementById('genSaveBtn');
  if (!titleEl) return;
  if (!_genActivePage) {
    titleEl.value=''; titleEl.disabled=true; titleEl.placeholder='Page를 클릭하면 편집할 수 있습니다';
    textEl.value=''; textEl.disabled=true;
    pidEl.value='';
    if(saveBtn) saveBtn.disabled=true;
    // Cleanup 컨트롤 비활성화
    const ps=document.getElementById('genPresetSelect'); if(ps) ps.disabled=true;
    const cb=document.getElementById('genCleanupBtn'); if(cb) cb.disabled=true;
    return;
  }
  const pid = _genActivePage;
  const page = _genPages.find(p=>p.id===pid);
  if (!page) {
    titleEl.disabled=true; textEl.disabled=true; if(saveBtn) saveBtn.disabled=true; return;
  }
  titleEl.value = page.title||''; titleEl.disabled=false; titleEl.placeholder='';
  textEl.value = page.text||''; textEl.disabled=false;
  pidEl.value = pid;
  if(saveBtn) saveBtn.disabled=false;
  // Cleanup 컨트롤 상태 갱신 (프리셋 로드됐고 page 선택된 상태)
  const ps=document.getElementById('genPresetSelect');
  if(ps) ps.disabled = _cleanupPresets.length === 0;
  _cleanupUpdateEditorCleanupBtn();
}

window.genOnBookCheck = (cb) => {
  cb.checked ? _genCheckedBooks.add(cb.dataset.id) : _genCheckedBooks.delete(cb.dataset.id);
  _genToolbar('book'); _genRenderBooks();
};
window.genOnChapterCheck = (cb) => {
  cb.checked ? _genCheckedChapters.add(cb.dataset.id) : _genCheckedChapters.delete(cb.dataset.id);
  _genToolbar('chapter'); _genRenderChapters();
};
window.genOnPageCheck = (cb) => {
  cb.checked ? _genCheckedPages.add(cb.dataset.id) : _genCheckedPages.delete(cb.dataset.id);
  _genToolbar('page'); _genRenderPages();
};
window.genClickBook = async (id) => {
  _genActiveBook = _genActiveBook === id ? null : id;
  _genActiveChapter = null;
  _genPageCur = 1;
  // Book 활성화 시 그 Book 의 Chapters + Pages lazy fetch (cache — 한 번만)
  if (_genActiveBook) {
    const bookId = _genActiveBook;
    const hasCh = _genChapters.some(c => c.bookId === bookId);
    const hasPg = _genPages.some(p => p.bookId === bookId);
    if (!hasCh || !hasPg) {
      const tk = ++_genBookFetchToken;  // race 가드 — 늦게 온 옛 응답 무시
      try {
        const [cSnap, pSnap] = await Promise.all([
          hasCh ? Promise.resolve({docs:[]}) : getDocs(query(
            collection(db,'genChapters'),
            where('academyId','==', window.MY_ACADEMY_ID),
            where('bookId','==', bookId),
            orderBy('order','asc')
          )),
          hasPg ? Promise.resolve({docs:[]}) : getDocs(query(
            collection(db,'genPages'),
            where('academyId','==', window.MY_ACADEMY_ID),
            where('bookId','==', bookId),
            orderBy('serialNumber','asc')
          )),
        ]);
        if (tk !== _genBookFetchToken) return;  // 그 사이 다른 Book 클릭됨 → 최신 클릭이 render 담당
        if (!hasCh) _genChapters = _genChapters.concat(cSnap.docs.map(d=>({id:d.id,...d.data()})));
        if (!hasPg) _genPages = _genPages.concat(pSnap.docs.map(d=>({id:d.id,...d.data()})));
      } catch(e) {
        if (tk !== _genBookFetchToken) return;  // 옛 응답 에러는 무시
        console.error('[genClickBook] lazy fetch 실패', e);
        showToast('Chapter/Page 목록을 불러오지 못했어요 — Book 을 다시 클릭해주세요');
      }
    }
  }
  _genRenderBooks(); _genRenderChapters(); _genRenderPages();
};
window.genClickChapter = (id) => {
  _genActiveChapter = _genActiveChapter === id ? null : id;
  _genPageCur = 1;
  _genRenderChapters(); _genRenderPages();
};
window.genClickPage = (id) => {
  _genActivePage = _genActivePage === id ? null : id;
  _genRenderPages();
};
window.genToggleCheckAll = (type, cb) => {
  if (type==='book') {
    _genBooks.forEach(b => cb.checked ? _genCheckedBooks.add(b.id) : _genCheckedBooks.delete(b.id));
    _genToolbar('book'); _genRenderBooks();
  } else if (type==='chapter') {
    _genFilteredChapters().forEach(c => cb.checked ? _genCheckedChapters.add(c.id) : _genCheckedChapters.delete(c.id));
    _genToolbar('chapter'); _genRenderChapters();
  } else {
    _genFilteredPages().forEach(p => cb.checked ? _genCheckedPages.add(p.id) : _genCheckedPages.delete(p.id));
    _genToolbar('page'); _genRenderPages();
  }
};

// ── 이미지 업로드 ──
// Vercel functions 한도 4.5MB — base64 인코딩(×1.33) + JSON 오버헤드 고려해서
// 원본 3MB 초과 또는 image/heic 같은 특이 포맷이면 자동 압축.
const _GEN_COMPRESS_THRESHOLD = 3 * 1024 * 1024;  // 3MB
const _GEN_MAX_DIM = 1800;                         // 최대 변
const _GEN_JPEG_QUALITY = 0.85;

async function _genCompressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const ratio = Math.min(1, _GEN_MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', _GEN_JPEG_QUALITY));
    if (!blob) throw new Error('canvas.toBlob 실패');
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = ev => res(ev.target.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
    return { base64, mimeType: 'image/jpeg', size: blob.size };
  } finally {
    URL.revokeObjectURL(url);
  }
}

window.genHandleDrop = (e) => {
  e.preventDefault();
  document.getElementById('genDropZone').style.borderColor='var(--border)';
  genHandleFiles(e.dataTransfer.files);
};

window.genHandleFiles = async (files) => {
  // 파일명 자연 정렬 (page1, page2, ..., page10 순) — 드롭 순서가 OS 별로 달라 page 넘버링 일관성 위해
  const list = [...files]
    .filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (!list.length) return;

  let compressedCount = 0;
  let totalBefore = 0, totalAfter = 0;
  const errors = [];

  for (const file of list) {
    const origSize = file.size;
    totalBefore += origSize;
    const needCompress = origSize > _GEN_COMPRESS_THRESHOLD || /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    try {
      if (needCompress) {
        const r = await _genCompressImage(file);
        _genImages.push({ base64: r.base64, name: file.name, mimeType: r.mimeType, size: r.size, origSize, compressed: true });
        compressedCount++;
        totalAfter += r.size;
      } else {
        // 작은 파일은 원본 그대로 (불필요한 재인코딩 회피)
        const base64 = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = ev => res(ev.target.result.split(',')[1]);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        _genImages.push({ base64, name: file.name, mimeType: file.type, size: origSize, origSize, compressed: false });
        totalAfter += origSize;
      }
    } catch (e) {
      errors.push(`${file.name}: ${e.message}`);
    }
  }

  _genRenderThumbnails();

  // 일괄 안내 토스트
  if (compressedCount > 0) {
    const before = (totalBefore / 1024 / 1024).toFixed(1);
    const after = (totalAfter / 1024 / 1024).toFixed(1);
    showToast(`📦 ${compressedCount}장 자동 압축됨 (${before}MB → ${after}MB)`);
  }
  if (errors.length) {
    showToast(`⚠️ ${errors.length}장 처리 실패: ${errors[0]}`);
  }
};

function _genRenderThumbnails() {
  const el = document.getElementById('genThumbnails');
  if (!el) return;
  el.innerHTML = _genImages.map((img,i) => {
    const sizeKB = Math.round((img.size || 0) / 1024);
    const tip = img.compressed
      ? `압축됨: ${((img.origSize||0)/1024/1024).toFixed(1)}MB → ${(sizeKB/1024).toFixed(1)}MB`
      : `${sizeKB}KB`;
    const badge = img.compressed
      ? `<span title="${esc(tip)}" style="position:absolute;bottom:18px;right:2px;background:rgba(14,165,233,0.95);color:white;font-size:9px;padding:1px 4px;border-radius:3px;line-height:1.2;">📦</span>`
      : '';
    return `
    <div style="position:relative;width:72px;flex-shrink:0;" title="${esc(tip)}">
      <img src="data:${img.mimeType};base64,${img.base64}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border);">
      <button onclick="genRemoveImage(${i})" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:none;background:#e05050;color:white;cursor:pointer;font-size:10px;padding:0;line-height:1;">x</button>
      ${badge}
      <div style="font-size:9px;color:var(--gray);text-align:center;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(img.name)}</div>
    </div>`;
  }).join('');
}
window.genRemoveImage = (i) => { _genImages.splice(i,1); _genRenderThumbnails(); };

// 학원 전체 page 중 max serialNumber 조회 (2026-06-03 B안 — chapter 내 중복 방지)
// 한 batch 안에서는 호출처가 ++ 로 처리. 학원 전체 page 156개 정도라 부담 0.
// 향후 1000+ 누적 시 인덱스 추가 (academyId + serialNumber DESC) 검토.
async function _genFetchMaxSerialNumber() {
  try {
    const snap = await getDocs(query(
      collection(db, 'genPages'),
      where('academyId', '==', window.MY_ACADEMY_ID)
    ));
    let max = 0;
    snap.forEach(d => { const sn = d.data().serialNumber || 0; if (sn > max) max = sn; });
    return max;
  } catch (e) {
    console.warn('[_genFetchMaxSerialNumber] 실패, _genPages 로 fallback:', e.message);
    return _genPages.reduce((m, p) => Math.max(m, p.serialNumber || 0), 0);
  }
}

// ── OCR 실행 ──
window.runGenOcr = async () => {
  if (!_genImages.length) { showAlert('입력 확인', '이미지를 먼저 업로드하세요.'); return; }
  const btn = document.getElementById('genOcrBtn');
  const status = document.getElementById('genOcrStatus');
  btn.disabled = true;
  // 학원 전체 max serialNumber 부터 +1 (batch 안에서 ++ 누적)
  let nextSerial = await _genFetchMaxSerialNumber();
  let saved = 0;
  for (let i=0; i<_genImages.length; i++) {
    if (status) status.textContent = `처리 중... (${i+1}/${_genImages.length})`;
    try {
      const res = await _geminiFetch('/api/ocr',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({imageBase64:_genImages[i].base64,mimeType:_genImages[i].mimeType}),
      });
      // 응답이 JSON 아닐 가능성 — 413 (Request Entity Too Large) 등은 plain text 반환
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const text = (await res.text()).slice(0, 80);
        if (res.status === 413) {
          showToast(`[${i+1}] 이미지 너무 큼 (4.5MB 한도). 다른 사진 써보세요`);
        } else {
          showToast(`[${i+1}] 서버 응답 오류 (${res.status}): ${text}`);
        }
        continue;
      }
      const data = await res.json();
      if (!res.ok||data.error){ showToast(`[${i+1}] OCR 실패: ${data.error||res.status}`); continue; }
      nextSerial++;
      // 현재 active chapter/book 에 자동 배정 (학원장이 보고 있는 영역에 즉시 표시)
      const activeCh = _genActiveChapter ? (_genChapters||[]).find(c => c.id === _genActiveChapter) : null;
      const cId = _genActiveChapter || null;
      const cName = activeCh?.name || '';
      const bId = _genActiveBook || activeCh?.bookId || null;
      const bName = bId ? ((_genBooks||[]).find(b => b.id === bId)?.name || '') : '';
      const pgData = {
        title:`Page ${nextSerial}`, serialNumber:nextSerial,
        chapterId:cId, chapterName:cName, bookId:bId, bookName:bName,
        text:data.text||'', ocrConfidence:(data.confidence||0)/100,
        ocrProvider:data.provider||'google-vision', imageUrl:'', edited:false,
        createdBy:auth.currentUser?.uid||'',
        academyId: window.MY_ACADEMY_ID || 'default',
      };
      const ref = await addDoc(collection(db,'genPages'), { ...pgData, createdAt:serverTimestamp() });
      // 클라 캐시엔 Date 박음 (Firestore 의 serverTimestamp 가 클라 객체에 안 들어가므로
      // 최근순 정렬에서 가장 뒤로 밀려 신규 page 화면 안 보임 → 새 Date() placeholder)
      _genPages.push({ id: ref.id, ...pgData, createdAt: new Date() });
      saved++;
    } catch(e){ showToast(`[${i+1}] 오류: ${e.message}`); }
  }
  if (status) { status.textContent=`완료! ${saved}개 Page 저장됨`; setTimeout(()=>{ status.textContent=''; },3000); }
  btn.disabled=false;
  _genImages=[]; _genRenderThumbnails();
  _genRenderAll();
};

// ── Page CRUD ──
window.genCreatePage = () => {
  showModal(`
    <div style="width:min(640px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">📄 Page 생성</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="margin-bottom:14px;">
          <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">제목</div>
          <input id="gnPT" type="text" placeholder="비우면 자동 지정" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;">
        </div>
        <div>
          <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">본문</div>
          <textarea id="gnPX" rows="6" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;resize:vertical;font-family:inherit;"></textarea>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="genDoCreatePage()">저장</button>
      </div>
    </div>`);
  setTimeout(()=>document.getElementById('gnPT')?.focus(),80);
};
window.genDoCreatePage = async () => {
  const title=document.getElementById('gnPT')?.value.trim();
  const text=document.getElementById('gnPX')?.value.trim();
  const maxSerial=(await _genFetchMaxSerialNumber())+1;
  // 현재 active chapter/book 에 자동 배정 (학원장이 보고 있는 영역에 즉시 표시)
  const activeCh = _genActiveChapter ? (_genChapters||[]).find(c => c.id === _genActiveChapter) : null;
  const cId = _genActiveChapter || null;
  const cName = activeCh?.name || '';
  const bId = _genActiveBook || activeCh?.bookId || null;
  const bName = bId ? ((_genBooks||[]).find(b => b.id === bId)?.name || '') : '';
  try {
    const data = {
      title:title||`Page ${maxSerial}`, serialNumber:maxSerial,
      chapterId:cId, chapterName:cName, bookId:bId, bookName:bName,
      text:text||'', ocrConfidence:0, ocrProvider:'', imageUrl:'', edited:true,
      createdBy:auth.currentUser?.uid||'',
      academyId: window.MY_ACADEMY_ID || 'default',
    };
    const ref = await addDoc(collection(db,'genPages'), { ...data, createdAt:serverTimestamp() });
    _genPages.push({ id: ref.id, ...data, createdAt: new Date() });
    closeModal(); _genRenderAll();
  } catch(e){ showToast('저장 실패: '+e.message); }
};

window.genEditPage = () => {
  if (_genCheckedPages.size === 0) return;
  if (_genCheckedPages.size >= 2) { _genOpenMergePagesModal(); return; }
  const pid=[..._genCheckedPages][0];
  const page=_genPages.find(p=>p.id===pid);
  if (!page) return;
  showModal(`
    <div style="width:min(720px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">&#9999;&#65039; Page 수정</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="margin-bottom:14px;">
          <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">제목</div>
          <input id="gnET" type="text" value="${esc(page.title||'')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;">
        </div>
        <div>
          <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">본문</div>
          <textarea id="gnEX" rows="10" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;resize:vertical;font-family:inherit;">${esc(page.text||'')}</textarea>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="genDoEditPage('${pid}')">저장</button>
      </div>
    </div>`);
};
window.genDoEditPage = async (pid) => {
  const title=document.getElementById('gnET')?.value.trim();
  const text=document.getElementById('gnEX')?.value.trim();
  if (!title) { showAlert('입력 확인', '제목을 입력하세요.'); return; }
  try {
    await updateDoc(doc(db,'genPages',pid),{title,text:text||'',edited:true});
    const p = _genPages.find(x => x.id === pid);
    if (p) { p.title = title; p.text = text||''; p.edited = true; }
    closeModal(); _genRenderAll();
  } catch(e){ showToast('저장 실패: '+e.message); }
};

// 여러 Page 선택 + [수정] → 병합 모달
// 정렬: 이름순 자연 정렬 (Page 리스트 '이름순▼' 과 동일 — localeCompare 'ko' numeric:true)
// 학원장이 ▲▼ 또는 드래그로 미세 조정 가능 (_genMergePages 상태 직접 변형)
let _genMergePages = [];
let _genMergeDragId = '';

function _genOpenMergePagesModal() {
  const ids = [..._genCheckedPages];
  const pages = ids.map(id => _genPages.find(p => p.id === id)).filter(Boolean);
  // 이름순 자연 정렬 (Page 리스트와 동일)
  pages.sort((a, b) =>
    String(a.title || '').localeCompare(String(b.title || ''), 'ko', { numeric: true }));
  if (pages.length < 2) return;

  _genMergePages = pages;

  // 챕터 일치 검사
  const chapterIds = [...new Set(pages.map(p => p.chapterId || ''))];
  const sameChapter = chapterIds.length === 1 && chapterIds[0];
  const targetChapter = sameChapter ? pages[0] : null;
  const chapterInfo = sameChapter
    ? `같은 챕터 <b>'${esc(targetChapter.chapterName || '-')}'</b> 로 배정`
    : '챕터 다름 (또는 미배정 섞임) → <b>미배정</b> 으로 저장';

  const defaultTitle = (pages[0].title || 'Page') + ' (병합)';

  showModal(`
    <div style="width:min(640px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">✂ Page 병합</div>
        <div style="margin-top:6px;font-size:13px;color:var(--gray);">선택된 ${pages.length}개 페이지의 본문을 순서대로 합쳐 1개로 만듭니다.</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">병합될 페이지 — 이름순 자동 정렬 (드래그 또는 ▲▼ 로 순서 조정 가능)</div>
        <ol id="gnMList" style="font-size:13px;line-height:1.6;padding:0;margin:0 0 14px 0;list-style:none;">${_genMergeBuildListItems()}</ol>
        <div style="font-size:12px;color:var(--text);margin-bottom:14px;background:#fafafa;border:1px solid var(--border);border-radius:6px;padding:8px 10px;">→ ${chapterInfo}</div>

        <div style="margin-bottom:14px;">
          <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">새 Page 제목 <span style="color:#dc2626;">*</span></div>
          <input id="gnMT" type="text" value="${esc(defaultTitle)}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;">
        </div>

        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;user-select:none;">
          <input id="gnMDel" type="checkbox" style="width:16px;height:16px;cursor:pointer;">
          <span>병합 후 원본 ${pages.length}개 삭제 <span style="color:var(--gray);font-size:11px;">(기본 보존 — 체크 시 삭제)</span></span>
        </label>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="genDoMergePages()">✂ 병합 실행</button>
      </div>
    </div>`);
}

function _genMergeBuildListItems() {
  const n = _genMergePages.length;
  return _genMergePages.map((p, i) => {
    const isFirst = i === 0;
    const isLast = i === n - 1;
    const upStyle = isFirst ? 'opacity:0.3;cursor:not-allowed;' : 'cursor:pointer;';
    const downStyle = isLast ? 'opacity:0.3;cursor:not-allowed;' : 'cursor:pointer;';
    const preview = (p.text || '').slice(0, 40);
    const more = (p.text || '').length > 40 ? '…' : '';
    return `
    <li draggable="true" data-id="${p.id}"
        ondragstart="genMergeDragStart(event,'${p.id}')"
        ondragover="genMergeDragOver(event)"
        ondrop="genMergeDrop(event,'${p.id}')"
        ondragend="genMergeDragEnd(event)"
        style="display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;background:#fff;cursor:move;">
      <span style="color:var(--gray);font-size:11px;font-weight:700;min-width:18px;text-align:right;">${i + 1}.</span>
      <span style="color:#bbb;font-size:14px;line-height:1;" title="드래그해서 순서 이동">⋮⋮</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.title || '-')}</div>
        <div style="color:var(--gray);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(preview)}${more}</div>
      </div>
      <button onclick="genMergeMoveUp('${p.id}')" ${isFirst ? 'disabled' : ''}
        style="padding:2px 8px;border:1px solid var(--border);background:#fff;border-radius:4px;font-size:13px;${upStyle}">▲</button>
      <button onclick="genMergeMoveDown('${p.id}')" ${isLast ? 'disabled' : ''}
        style="padding:2px 8px;border:1px solid var(--border);background:#fff;border-radius:4px;font-size:13px;${downStyle}">▼</button>
    </li>`;
  }).join('');
}

function _genMergeRefreshList() {
  const el = document.getElementById('gnMList');
  if (el) el.innerHTML = _genMergeBuildListItems();
}

window.genMergeMoveUp = (id) => {
  const i = _genMergePages.findIndex(p => p.id === id);
  if (i <= 0) return;
  [_genMergePages[i - 1], _genMergePages[i]] = [_genMergePages[i], _genMergePages[i - 1]];
  _genMergeRefreshList();
};
window.genMergeMoveDown = (id) => {
  const i = _genMergePages.findIndex(p => p.id === id);
  if (i < 0 || i >= _genMergePages.length - 1) return;
  [_genMergePages[i], _genMergePages[i + 1]] = [_genMergePages[i + 1], _genMergePages[i]];
  _genMergeRefreshList();
};
window.genMergeDragStart = (e, id) => {
  _genMergeDragId = id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch (_) {}
  }
  if (e.currentTarget) e.currentTarget.style.opacity = '0.4';
};
window.genMergeDragOver = (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
};
window.genMergeDrop = (e, targetId) => {
  e.preventDefault();
  const fromId = _genMergeDragId;
  _genMergeDragId = '';
  if (!fromId || fromId === targetId) { _genMergeRefreshList(); return; }
  const fromIdx = _genMergePages.findIndex(p => p.id === fromId);
  const toIdx = _genMergePages.findIndex(p => p.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = _genMergePages.splice(fromIdx, 1);
  _genMergePages.splice(toIdx, 0, moved);
  _genMergeRefreshList();
};
window.genMergeDragEnd = (e) => {
  _genMergeDragId = '';
  if (e.currentTarget && e.currentTarget.style) e.currentTarget.style.opacity = '';
};

window.genDoMergePages = async () => {
  const newTitle = (document.getElementById('gnMT')?.value || '').trim();
  const deleteOriginals = !!document.getElementById('gnMDel')?.checked;

  if (!newTitle) { showAlert('입력 확인', '새 Page 제목을 입력하세요.'); return; }

  // 현재 _genMergePages 순서 그대로 사용 (학원장이 ▲▼/드래그로 조정한 결과)
  const pages = _genMergePages.slice();
  if (pages.length < 2) { showToast('병합할 페이지가 부족합니다'); return; }
  const ids = pages.map(p => p.id);

  // 본문 합치기 — 사이에 빈 줄
  const mergedText = pages.map(p => (p.text || '').trim()).filter(Boolean).join('\n\n');

  // 챕터 일치 → 그 챕터 사용, 아니면 미배정
  const chapterIds = [...new Set(pages.map(p => p.chapterId || ''))];
  const sameChapter = chapterIds.length === 1 && chapterIds[0];
  const ch = sameChapter ? pages[0] : null;

  // serialNumber: 학원 전체 max + 1 (2026-06-03 B안 — chapter 내 중복 방지)
  const nextSerial = (await _genFetchMaxSerialNumber()) + 1;

  try {
    const data = {
      title: newTitle,
      text: mergedText,
      serialNumber: ch ? (pages[0].serialNumber || nextSerial) : nextSerial,
      chapterId: ch ? ch.chapterId : null,
      chapterName: ch ? (ch.chapterName || '') : '',
      bookId: ch ? (ch.bookId || null) : null,
      bookName: ch ? (ch.bookName || '') : '',
      ocrConfidence: 0,
      ocrProvider: 'merged',
      imageUrl: '',
      edited: true,
      createdBy: auth.currentUser?.uid || '',
      academyId: window.MY_ACADEMY_ID || 'default',
    };
    const ref = await addDoc(collection(db, 'genPages'), { ...data, createdAt: serverTimestamp() });
    _genPages.push({ id: ref.id, ...data, createdAt: new Date() });

    if (deleteOriginals) {
      await Promise.all(ids.map(id => deleteDoc(doc(db, 'genPages', id))));
      const set = new Set(ids);
      _genPages = _genPages.filter(p => !set.has(p.id));
    }

    _genCheckedPages.clear();
    _genMergePages = [];
    closeModal();
    _genRenderAll();
    showToast(deleteOriginals
      ? `✂ ${pages.length}개 페이지 병합 완료 — 원본 삭제됨`
      : `✂ ${pages.length}개 페이지 병합 완료 — 원본 보존`);
  } catch (e) {
    showToast('병합 실패: ' + e.message);
  }
};

window.genSavePage = async () => {
  const pid=document.getElementById('genEditPageId')?.value;
  const title=document.getElementById('genEditTitle')?.value.trim();
  const text=document.getElementById('genEditText')?.value;
  if (!pid||!title) { showAlert('입력 확인', '제목을 입력하세요.'); return; }
  try {
    await updateDoc(doc(db,'genPages',pid),{title,text:text||'',edited:true,updatedAt:serverTimestamp()});
    const page = _genPages.find(p=>p.id===pid);
    if (page) { page.title = title; page.text = text||''; page.edited = true; page.updatedAt = new Date(); }
    showToast('저장 완료');
    _genRenderPages();
  } catch(e){ showToast('저장 실패: '+e.message); }
};

window.genDeletePages = async () => {
  if (!_genCheckedPages.size) return;
  const ok=await showConfirm(`Page ${_genCheckedPages.size}개를 삭제하시겠습니까?`,'삭제된 데이터는 복구할 수 없습니다.');
  if (!ok) return;
  try {
    const ids = [..._genCheckedPages];
    await Promise.all(ids.map(id=>deleteDoc(doc(db,'genPages',id))));
    const set = new Set(ids);
    _genPages = _genPages.filter(p => !set.has(p.id));
    if (set.has(_genActivePage)) _genActivePage = null;
    _genCheckedPages.clear(); _genRenderAll();
  } catch(e){ showToast('삭제 실패: '+e.message); }
};

window.genExcludePages = async () => {
  if (!_genCheckedPages.size) return;
  try {
    const ids = [..._genCheckedPages];
    await Promise.all(ids.map(id=>updateDoc(doc(db,'genPages',id),{chapterId:null,chapterName:'',bookId:null,bookName:''})));
    const set = new Set(ids);
    _genPages.forEach(p => { if (set.has(p.id)) { p.chapterId = null; p.chapterName = ''; p.bookId = null; p.bookName = ''; } });
    _genCheckedPages.clear();
    showToast('미지정 상태로 변경됨'); _genRenderAll();
  } catch(e){ showToast('실패: '+e.message); }
};

// Chapter 이동 — Book 선택 → 그 Book chapter 동적(lazy) + inline 새 Chapter 생성·즉시이동 (2026-05-18)
// Book 안 고른 채 막혀 중복 Chapter 생성하던 문제 해결. lazy 유지 → 학원 커져도 목록·reads 일정
window.genMovePages = () => {
  if (!_genCheckedPages.size) return;
  if (!_genBooks.length) { showAlert('입력 확인', 'Book이 없습니다. 먼저 Book을 생성하세요.'); return; }
  _genMoveBook = null;
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">&#8594; Chapter 이동</div>
        <div style="font-size:12px;color:var(--gray);margin-top:5px;">${_genCheckedPages.size}개 Page · Book 선택 후 Chapter 지정</div>
      </div>
      <div id="genMoveBody" style="padding:16px 22px;overflow-y:auto;flex:1;">${_genMoveBodyHtml()}</div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      </div>
    </div>`);
};

function _genMoveBodyHtml() {
  if (!_genMoveBook) {
    const books = _genRecentSort(_genBooks);  // 최근순 기본
    return `
      <div style="font-size:12px;color:var(--gray);margin-bottom:8px;">① Book 선택</div>
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:12px;">
        ${books.length ? books.map(b=>`
          <div data-bid="${esc(b.id)}" onclick="genMoveSelectBook(this.dataset.bid)" style="padding:11px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-weight:600;font-size:13px;" onmouseover="this.style.background='var(--teal-light)'" onmouseout="this.style.background=''">${esc(b.name||'(이름 없음)')}</div>
        `).join('') : `<div style="padding:14px;text-align:center;color:#bbb;font-size:12px;font-style:italic;">Book 이 없습니다. 아래에서 새로 만드세요.</div>`}
      </div>
      <button class="btn btn-secondary" style="width:100%;padding:9px;font-size:12px;" onclick="genMoveShowNewBook()">&#43; 새 Book 만들기</button>
      <div id="genMoveNewBookWrap" style="display:none;margin-top:10px;padding:12px;border:1px dashed var(--teal);border-radius:8px;background:var(--teal-light);">
        <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">새 Book 이름 *</div>
        <input id="genMoveNewBookName" type="text" placeholder="예: Bricks Reading 1" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box;" onkeydown="if(event.key==='Enter')genMoveCreateBook()">
        <button class="btn btn-primary" style="width:100%;padding:9px;font-size:12px;font-weight:700;margin-top:8px;" onclick="genMoveCreateBook()">Book 생성 후 계속</button>
      </div>`;
  }
  const chs = _genRecentSort(_genChapters.filter(c => c.bookId === _genMoveBook.id));  // 최근순 기본
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;" onclick="genMoveBackToBooks()">&#8592; Book 다시</button>
      <span style="font-size:13px;font-weight:700;">${esc(_genMoveBook.name)}</span>
    </div>
    <div style="font-size:12px;color:var(--gray);margin-bottom:8px;">② Chapter 선택 (Page 이동)</div>
    <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:12px;">
      ${chs.length ? chs.map(c=>`
        <div data-cid="${esc(c.id)}" data-cname="${esc(c.name)}" onclick="genMovePick(this.dataset.cid,this.dataset.cname)" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-weight:600;font-size:13px;" onmouseover="this.style.background='var(--teal-light)'" onmouseout="this.style.background=''">${esc(c.name)}</div>
      `).join('') : `<div style="padding:14px;text-align:center;color:#bbb;font-size:12px;font-style:italic;">이 Book 엔 Chapter 가 없습니다.<br>아래에서 새로 만들어 바로 연결하세요.</div>`}
    </div>
    <button class="btn btn-secondary" style="width:100%;padding:9px;font-size:12px;" onclick="genMoveShowNew()">&#43; 이 Book 에 새 Chapter 만들기</button>
    <div id="genMoveNewWrap" style="display:none;margin-top:10px;padding:12px;border:1px dashed var(--teal);border-radius:8px;background:var(--teal-light);">
      <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">새 Chapter 이름 *</div>
      <input id="genMoveNewName" type="text" placeholder="예: Chapter 1" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box;" onkeydown="if(event.key==='Enter')genMoveCreateAndMove()">
      <button class="btn btn-primary" style="width:100%;padding:9px;font-size:12px;font-weight:700;margin-top:8px;" onclick="genMoveCreateAndMove()">생성 + ${_genCheckedPages.size}개 Page 이동</button>
    </div>`;
}
function _genMoveRefresh(){ const el=document.getElementById('genMoveBody'); if(el) el.innerHTML=_genMoveBodyHtml(); }

window.genMoveSelectBook = async (bookId) => {
  const b = _genBooks.find(x => x.id === bookId);
  if (!b) return;
  _genMoveBook = { id: b.id, name: b.name };
  const hasCh = _genChapters.some(c => c.bookId === bookId);
  if (!hasCh) {
    const tk = ++_genMoveBookToken;
    try {
      const cs = await getDocs(query(
        collection(db,'genChapters'),
        where('academyId','==', window.MY_ACADEMY_ID),
        where('bookId','==', bookId),
        orderBy('order','asc')
      ));
      if (tk !== _genMoveBookToken) return;  // 그 사이 다른 Book 선택 → 무시
      _genChapters = _genChapters.concat(cs.docs.map(d=>({id:d.id,...d.data()})));
    } catch(e) {
      if (tk !== _genMoveBookToken) return;
      console.error('[genMove] chapter fetch 실패', e);
      showToast('Chapter 목록을 불러오지 못했어요 — Book 을 다시 선택해주세요');
    }
  }
  _genMoveRefresh();
};
window.genMoveBackToBooks = () => { _genMoveBook = null; _genMoveRefresh(); };
window.genMoveShowNewBook = () => {
  const w = document.getElementById('genMoveNewBookWrap');
  if (w) { w.style.display = 'block'; setTimeout(()=>document.getElementById('genMoveNewBookName')?.focus(),50); }
};
window.genMoveCreateBook = async () => {
  const name = document.getElementById('genMoveNewBookName')?.value.trim();
  if (!name) { showAlert('입력 확인', 'Book 이름을 입력하세요.'); return; }
  try {
    const ref = await addDoc(collection(db,'genBooks'), {
      name, chapterCount: 0, pageCount: 0,
      createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || '',
      academyId: window.MY_ACADEMY_ID || 'default',
    });
    _genBooks.push({ id: ref.id, name, chapterCount: 0, pageCount: 0 });
    _genMoveBook = { id: ref.id, name };  // 생성한 Book 선택 상태로 → ② Chapter 단계
    _genMoveRefresh();
  } catch(e){ showToast('Book 생성 실패: '+e.message); }
};
window.genMoveShowNew = () => {
  const w = document.getElementById('genMoveNewWrap');
  if (w) { w.style.display = 'block'; setTimeout(()=>document.getElementById('genMoveNewName')?.focus(),50); }
};
window.genMovePick = (chapterId, chapterName) => {
  if (!_genMoveBook) return;
  _genDoMove(chapterId, _genMoveBook.id, _genMoveBook.name, chapterName);
};
window.genMoveCreateAndMove = async () => {
  if (!_genMoveBook) return;
  const name = document.getElementById('genMoveNewName')?.value.trim();
  if (!name) { showAlert('입력 확인', 'Chapter 이름을 입력하세요.'); return; }
  try {
    const order = _genChapters.filter(c=>c.bookId===_genMoveBook.id).length + 1;
    const ref = await addDoc(collection(db,'genChapters'), {
      name, bookId: _genMoveBook.id, bookName: _genMoveBook.name,
      order, pageCount: 0,
      createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || '',
      academyId: window.MY_ACADEMY_ID || 'default',
    });
    _genChapters.push({ id: ref.id, name, bookId: _genMoveBook.id, bookName: _genMoveBook.name, order, pageCount: 0 });
    await _genDoMove(ref.id, _genMoveBook.id, _genMoveBook.name, name);
  } catch(e){ showToast('Chapter 생성 실패: '+e.message); }
};
async function _genDoMove(chapterId, bookId, bookName, chapterName) {
  try {
    const ids=[..._genCheckedPages];
    await Promise.all(ids.map(id=>updateDoc(doc(db,'genPages',id),{chapterId,chapterName,bookId:bookId||null,bookName:bookName||''})));
    const set = new Set(ids);
    _genPages.forEach(p => { if (set.has(p.id)) { p.chapterId = chapterId; p.chapterName = chapterName; p.bookId = bookId||null; p.bookName = bookName||''; } });
    closeModal(); _genCheckedPages.clear(); _genMoveBook = null;
    showToast(`"${chapterName}"으로 ${ids.length}개 Page 이동 완료`);
    _genRenderAll();
  } catch(e){ showToast('이동 실패: '+e.message); }
}

// ── Chapter CRUD ──
window.genCreateChapter = () => {
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">&#128218; Chapter 생성</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div>
          <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">Chapter 이름 *</div>
          <input id="gnCN" type="text" placeholder="예: Chapter 1" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;">
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="genDoCreateChapter()">저장</button>
      </div>
    </div>`);
  setTimeout(()=>document.getElementById('gnCN')?.focus(),80);
};
window.genDoCreateChapter = async () => {
  const name=document.getElementById('gnCN')?.value.trim();
  if (!name) { showAlert('입력 확인', '이름을 입력하세요.'); return; }
  try {
    const order = _genChapters.length+1;
    const ref = await addDoc(collection(db,'genChapters'),{
      name, bookId:null, bookName:'', order, pageCount:0,
      createdAt:serverTimestamp(), createdBy:auth.currentUser?.uid||'',
      academyId: window.MY_ACADEMY_ID || 'default',
    });
    _genChapters.push({ id: ref.id, name, bookId:null, bookName:'', order, pageCount:0 });
    closeModal(); _genRenderAll();
  } catch(e){ showToast('저장 실패: '+e.message); }
};

window.genEditChapter = () => {
  if (_genCheckedChapters.size!==1) return;
  const cid=[..._genCheckedChapters][0];
  const ch=_genChapters.find(c=>c.id===cid);
  if (!ch) return;
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">&#9999;&#65039; Chapter 수정</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div>
          <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">Chapter 이름 *</div>
          <input id="gnCE" type="text" value="${esc(ch.name)}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;">
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="genDoEditChapter('${cid}')">저장</button>
      </div>
    </div>`);
  setTimeout(()=>document.getElementById('gnCE')?.focus(),80);
};
window.genDoEditChapter = async (cid) => {
  const name=document.getElementById('gnCE')?.value.trim();
  if (!name) { showAlert('입력 확인', '이름을 입력하세요.'); return; }
  try {
    await updateDoc(doc(db,'genChapters',cid),{name, updatedAt:serverTimestamp()});
    // Page chapterName 동기 — 메모리 캐시 대신 Firestore 직접 쿼리 (lazy 미로드 page 누락 방지)
    const aca = window.MY_ACADEMY_ID || 'default';
    const pgSnap = await getDocs(query(collection(db,'genPages'), where('academyId','==',aca), where('chapterId','==',cid)));
    await Promise.all(pgSnap.docs.map(d=>updateDoc(d.ref,{chapterName:name})));
    // 메모리 캐시 surgical
    const ch = _genChapters.find(c => c.id === cid); if (ch) ch.name = name;
    _genPages.forEach(p => { if (p.chapterId === cid) p.chapterName = name; });
    closeModal(); _genRenderAll();
  } catch(e){ showToast('저장 실패: '+e.message); }
};

window.genDeleteChapters = async () => {
  if (!_genCheckedChapters.size) return;
  const ok=await showConfirm(`Chapter ${_genCheckedChapters.size}개를 삭제하시겠습니까?`,'삭제 시 소속 Page는 미지정 상태로 돌아갑니다.');
  if (!ok) return;
  try {
    const ids=[..._genCheckedChapters];
    await Promise.all(_genPages.filter(p=>ids.includes(p.chapterId)).map(p=>updateDoc(doc(db,'genPages',p.id),{chapterId:null,chapterName:'',bookId:null,bookName:''})));
    await Promise.all(ids.map(id=>deleteDoc(doc(db,'genChapters',id))));
    const set = new Set(ids);
    _genChapters = _genChapters.filter(c => !set.has(c.id));
    _genPages.forEach(p => { if (set.has(p.chapterId)) { p.chapterId = null; p.chapterName = ''; p.bookId = null; p.bookName = ''; } });
    if (set.has(_genActiveChapter)) { _genActiveChapter = null; _genActivePage = null; }
    _genCheckedChapters.clear(); _genRenderAll();
  } catch(e){ showToast('삭제 실패: '+e.message); }
};

window.genExcludeChapters = async () => {
  if (!_genCheckedChapters.size) return;
  const ids=[..._genCheckedChapters];
  try {
    await Promise.all(ids.map(id=>updateDoc(doc(db,'genChapters',id),{bookId:null,bookName:'',updatedAt:serverTimestamp()})));
    await Promise.all(_genPages.filter(p=>ids.includes(p.chapterId)).map(p=>updateDoc(doc(db,'genPages',p.id),{bookId:null,bookName:''})));
    const set = new Set(ids);
    _genChapters.forEach(c => { if (set.has(c.id)) { c.bookId = null; c.bookName = ''; } });
    _genPages.forEach(p => { if (set.has(p.chapterId)) { p.bookId = null; p.bookName = ''; } });
    _genCheckedChapters.clear();
    showToast('Book에서 제외됨'); _genRenderAll();
  } catch(e){ showToast('실패: '+e.message); }
};

window.genMoveChapters = async () => {
  if (!_genCheckedChapters.size) return;
  const books = _genRecentSort(_genBooks);
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">&#8594; Book 이동</div>
        <div style="font-size:12px;color:var(--gray);margin-top:5px;">${_genCheckedChapters.size}개 Chapter 이동 · Book 선택 또는 새로 생성</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:12px;">
          ${books.length ? books.map(b=>`
            <div data-bid="${esc(b.id)}" data-bname="${esc(b.name)}" onclick="genDoMoveChapters(this.dataset.bid,this.dataset.bname)" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;transition:.15s;" onmouseover="this.style.background='var(--teal-light)'" onmouseout="this.style.background=''">
              <div style="font-weight:600;font-size:13px;pointer-events:none;">${esc(b.name)}</div>
              <div style="font-size:11px;color:var(--gray);pointer-events:none;">Chapter ${b.chapterCount||0}개</div>
            </div>`).join('') : `<div style="padding:14px;text-align:center;color:#bbb;font-size:12px;font-style:italic;">Book 이 없습니다. 아래에서 새로 만드세요.</div>`}
        </div>
        <button class="btn btn-secondary" style="width:100%;padding:9px;font-size:12px;" onclick="genMoveChShowNewBook()">&#43; 새 Book 만들기</button>
        <div id="genMoveChNewBookWrap" style="display:none;margin-top:10px;padding:12px;border:1px dashed var(--teal);border-radius:8px;background:var(--teal-light);">
          <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">새 Book 이름 *</div>
          <input id="genMoveChNewBookName" type="text" placeholder="예: Bricks Reading 1" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box;" onkeydown="if(event.key==='Enter')genMoveChCreateBook()">
          <button class="btn btn-primary" style="width:100%;padding:9px;font-size:12px;font-weight:700;margin-top:8px;" onclick="genMoveChCreateBook()">Book 생성 + ${_genCheckedChapters.size}개 Chapter 이동</button>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      </div>
    </div>`);
};
window.genMoveChShowNewBook = () => {
  const w = document.getElementById('genMoveChNewBookWrap');
  if (w) { w.style.display = 'block'; setTimeout(()=>document.getElementById('genMoveChNewBookName')?.focus(),50); }
};
window.genMoveChCreateBook = async () => {
  const name = document.getElementById('genMoveChNewBookName')?.value.trim();
  if (!name) { showAlert('입력 확인', 'Book 이름을 입력하세요.'); return; }
  try {
    const ref = await addDoc(collection(db,'genBooks'), {
      name, chapterCount: 0, pageCount: 0,
      createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || '',
      academyId: window.MY_ACADEMY_ID || 'default',
    });
    _genBooks.push({ id: ref.id, name, chapterCount: 0, pageCount: 0 });  // 메모리 반영
    await genDoMoveChapters(ref.id, name);  // 생성한 Book 으로 즉시 Chapter 이동
  } catch(e){ showToast('Book 생성 실패: '+e.message); }
};
window.genDoMoveChapters = async (bookId,bookName) => {
  const ids=[..._genCheckedChapters];
  try {
    await Promise.all(ids.map(id=>updateDoc(doc(db,'genChapters',id),{bookId,bookName,updatedAt:serverTimestamp()})));
    await Promise.all(_genPages.filter(p=>ids.includes(p.chapterId)).map(p=>updateDoc(doc(db,'genPages',p.id),{bookId,bookName})));
    const set = new Set(ids);
    _genChapters.forEach(c => { if (set.has(c.id)) { c.bookId = bookId; c.bookName = bookName; } });
    _genPages.forEach(p => { if (set.has(p.chapterId)) { p.bookId = bookId; p.bookName = bookName; } });
    closeModal(); _genCheckedChapters.clear();
    showToast(`"${bookName}"으로 이동 완료`);
    _genRenderAll();
  } catch(e){ showToast('실패: '+e.message); }
};

// ── Book CRUD ──
window.genCreateBook = () => {
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">&#128218; Book 생성</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div>
          <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">Book 이름 *</div>
          <input id="gnBN" type="text" placeholder="예: 중등 영어 교과서 1-1" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;">
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="genDoCreateBook()">저장</button>
      </div>
    </div>`);
  setTimeout(()=>document.getElementById('gnBN')?.focus(),80);
};
window.genDoCreateBook = async () => {
  const name=document.getElementById('gnBN')?.value.trim();
  if (!name) { showAlert('입력 확인', '이름을 입력하세요.'); return; }
  try {
    const ref = await addDoc(collection(db,'genBooks'),{
      name, chapterCount:0, pageCount:0,
      createdAt:serverTimestamp(), createdBy:auth.currentUser?.uid||'',
      academyId: window.MY_ACADEMY_ID || 'default',
    });
    _genBooks.push({ id: ref.id, name, chapterCount:0, pageCount:0 });
    closeModal(); _genRenderAll();
  } catch(e){ showToast('저장 실패: '+e.message); }
};

window.genEditBook = () => {
  if (_genCheckedBooks.size!==1) return;
  const bid=[..._genCheckedBooks][0];
  const book=_genBooks.find(b=>b.id===bid);
  if (!book) return;
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">&#9999;&#65039; Book 수정</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div>
          <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">Book 이름 *</div>
          <input id="gnBE" type="text" value="${esc(book.name)}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;">
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="genDoEditBook('${bid}')">저장</button>
      </div>
    </div>`);
  setTimeout(()=>document.getElementById('gnBE')?.focus(),80);
};
window.genDoEditBook = async (bid) => {
  const name=document.getElementById('gnBE')?.value.trim();
  if (!name) { showAlert('입력 확인', '이름을 입력하세요.'); return; }
  try {
    await updateDoc(doc(db,'genBooks',bid),{name, updatedAt:serverTimestamp()});
    // chapter/page 동기 — 메모리 캐시(_genChapters/_genPages) 대신 Firestore 직접 쿼리.
    // AI OCR 은 lazy fetch 라 Book 안 펼친 상태면 그 Book 의 chapter/page 가 캐시에 없어
    // 동기에서 누락됐던 버그(2026-05-30 송미정 ch1 케이스).
    const aca = window.MY_ACADEMY_ID || 'default';
    const [chSnap, pgSnap] = await Promise.all([
      getDocs(query(collection(db,'genChapters'), where('academyId','==',aca), where('bookId','==',bid))),
      getDocs(query(collection(db,'genPages'),    where('academyId','==',aca), where('bookId','==',bid))),
    ]);
    await Promise.all([
      ...chSnap.docs.map(d=>updateDoc(d.ref,{bookName:name})),
      ...pgSnap.docs.map(d=>updateDoc(d.ref,{bookName:name})),
    ]);
    // 메모리 캐시 surgical 갱신 (Book + 그 Book 의 chapter/page bookName)
    const bk = _genBooks.find(b => b.id === bid); if (bk) bk.name = name;
    _genChapters.forEach(c => { if (c.bookId === bid) c.bookName = name; });
    _genPages.forEach(p => { if (p.bookId === bid) p.bookName = name; });
    closeModal(); _genRenderAll();
  } catch(e){ showToast('저장 실패: '+e.message); }
};

window.genDeleteBooks = async () => {
  if (!_genCheckedBooks.size) return;
  const ok=await showConfirm(`Book ${_genCheckedBooks.size}개를 삭제하시겠습니까?`,'삭제 시 소속 Chapter/Page는 미지정 상태로 돌아갑니다.');
  if (!ok) return;
  try {
    const ids=[..._genCheckedBooks];
    // chapter/page bookId 해제는 메모리 캐시(_genChapters/_genPages) 기반으로 Firestore update.
    // Book 안 펼친 상태면 캐시 미로드 chapter/page 는 여기서 빠지지만, Book doc 삭제 후엔
    // _activeBook=null 로 리셋되어 그 자식들도 화면에서 사라짐 (다음 펼침 시 fresh fetch).
    await Promise.all([
      ..._genChapters.filter(c=>ids.includes(c.bookId)).map(c=>updateDoc(doc(db,'genChapters',c.id),{bookId:null,bookName:''})),
      ..._genPages.filter(p=>ids.includes(p.bookId)).map(p=>updateDoc(doc(db,'genPages',p.id),{bookId:null,bookName:''})),
      ...ids.map(id=>deleteDoc(doc(db,'genBooks',id))),
    ]);
    // 메모리 캐시 surgical 갱신
    const set = new Set(ids);
    _genBooks = _genBooks.filter(b => !set.has(b.id));
    _genChapters.forEach(c => { if (set.has(c.bookId)) { c.bookId = null; c.bookName = ''; } });
    _genPages.forEach(p => { if (set.has(p.bookId)) { p.bookId = null; p.bookName = ''; } });
    if (set.has(_genActiveBook)) { _genActiveBook = null; _genActiveChapter = null; _genActivePage = null; }
    _genCheckedBooks.clear(); _genRenderAll();
  } catch(e){ showToast('삭제 실패: '+e.message); }
};

// ═══════════════════════════════════════════════════════════════════════════
// AI OCR 정리 (Cleanup) — Generator Page 본문을 프리셋 프롬프트로 Gemini 가공
// ═══════════════════════════════════════════════════════════════════════════

// ─── 기본 프리셋 3개 (최초 방문 시 Firestore 에 자동 시드) ───
const _CLEANUP_DEFAULT_PRESETS = [
  {
    name: "단어장 (Snapshot)",
    description: "영단어[Tab]한글해석 형식으로 정리",
    prompt: `이 본문은 영어 단어장입니다.
각 항목을 "영단어[Tab]한글해석" 형식의 한 줄로 정리하세요.

규칙:
1. 각 줄: 영단어 → Tab 문자(\\t) → 한글 해석 → 줄바꿈
2. 주요단어로 선정
3. 번호·불릿·점선·장식 기호·자리표시 기호 모두 제거:
   - 장식 기호: "1.", "①", "•", ">", 점선
   - 자리표시·생략 기호: "~"(틸드), "…", "..."(말줄임표), "A/B", "sth", "sb"
   - 영단어 칸과 한글 해석 칸 양쪽 모두에서 반드시 제거
   - 자리표시 기호 자리는 자연스럽게 다듬어 실제 단어/뜻만 남김
   예시:
     영단어 "name ~ after ..." → "name after"
     영단어 "look ~ up" → "look up"
     한글 "~와 공유하다" → "공유하다"
     한글 "~에 신청하다, 등록하다" → "신청하다, 등록하다"
     한글 "…의 이름을 따서 ~의 이름을 짓다" → "이름을 따서 짓다"
4. 한 영단어에 여러 뜻이 있으면 쉼표(, )로 구분해 같은 줄에 유지
6. 예문·설명 문장은 제거하고 단어-뜻 쌍만 남김
7. OCR 오인식 의심되는 경우에도 원문 단어를 그대로 유지 (추측 금지)

출력은 정리된 단어 목록만. 마크다운·서문·번호 매기기 금지.`,
    order: 1, isDefault: true,
  },
  {
    name: "기본 정리",
    description: "페이지번호/하이픈/줄바꿈 정리",
    prompt: `다음 영어 본문을 정리하세요. 의미는 절대 변경하지 말고 형식만 다듬으세요.
1. 페이지 번호, 머리말/꼬리말, 저작권 표기 제거
2. 줄끝 하이픈(-)으로 분리된 단어는 병합 (예: "exam-\\nple" → "example")
3. 단락 내부의 강제 줄바꿈은 공백으로 통합 (문단 경계에서만 줄바꿈)
4. 연속된 빈 줄은 1줄로 축소
5. OCR 오인식으로 보이는 명백한 오타만 수정 (의심되면 그대로 둠)
6. 출력은 반드시 영어 원문 그대로 유지하세요. 한국어 번역 절대 금지.

정리된 본문만 출력. 설명·서문·마크다운 금지.`,
    order: 2, isDefault: true,
  },
  {
    name: "교재 문제지",
    description: "문제 번호/선택지/Answer Key 정리",
    prompt: `이 본문은 영어 교재의 문제 섹션입니다. 다음 규칙으로 정리하세요.
1. 문제 번호(1. 2. 3. 또는 ① ② ③) 유지, 번호 앞뒤 공백 정규화
2. 선택지(A/B/C/D 또는 ① ② ③ ④)는 각각 새 줄로
3. 지문(Passage)과 문제를 빈 줄로 구분
4. Answer Key 섹션은 별도 블록으로 분리
5. 페이지 번호·머리말 제거

정리된 본문만 출력. 마크다운·서문 금지.`,
    order: 3, isDefault: true,
  },
  {
    name: "문장 전체 번역",
    description: "page전체 문장을 해석하여 아래 추가함",
    prompt: `다음 영어 본문을 정리 후 번역을 추가하세요. 의미는 절대 변경하지 말고 형식만 다듬으세요.
1. 페이지 번호, 머리말/꼬리말, 저작권 표기 제거
2. 줄끝 하이픈(-)으로 분리된 단어는 병합 (예: "exam-\\nple" → "example")
3. 단락 내부의 강제 줄바꿈은 공백으로 통합 (문단 경계에서만 줄바꿈)
4. 연속된 빈 줄은 1줄로 축소
5. OCR 오인식으로 보이는 명백한 오타만 수정 (의심되면 그대로 둠)

정리된 영문본문전체와 한글해석을 그아래 추가하여 출력. 설명·서문·마크다운 금지.
`,
    order: 4, isDefault: false,
  },
];

// ─── 상태 ───
let _cleanupPresets = [];           // Firestore 에서 로드한 프리셋 배열
let _cleanupActivePresetId = '';    // 에디터 드롭다운에서 선택된 프리셋 ID
let _cleanupBatchResults = [];      // 일괄 처리 결과 (비교·적용용)
let _cleanupBatchTabIdx = 0;        // 일괄 결과 모달에서 보고 있는 탭 인덱스
let _cleanupBatchPresetName = '';   // 현재 일괄 처리 중인 프리셋 이름

// ─── 프리셋 로드 (2026-05-24 모델 변경) ───
// 모델: super 글로벌(appConfig/cleanupPresets) + 학원 커스텀(academies/{id}.customCleanupPresets)
// 병합 규칙: 같은 이름은 학원 커스텀 우선 (= AI 프롬프트 customSystemPrompt 와 동일 모델)
// id 형식: 'global:이름' 또는 'custom:이름' (Firestore doc id 가 아닌 이름 기반 합성 id)
async function _cleanupLoadPresets() {
  try {
    // 1. 글로벌 default 로드
    const globalArr = await _getEffectiveCleanupDefaults();

    // 2. 학원 커스텀 로드 (academies/{id}.customCleanupPresets)
    let customArr = [];
    try {
      const acSnap = await getDoc(doc(db, 'academies', window.MY_ACADEMY_ID || 'default'));
      if (acSnap.exists()) {
        const v = acSnap.data().customCleanupPresets;
        if (Array.isArray(v)) customArr = v;
      }
    } catch (e) {
      console.warn('[cleanup] academy customCleanupPresets read failed:', e.message);
    }

    // 3. 병합 — 같은 이름은 학원 커스텀 우선. 학원 신규 프리셋은 끝에 추가.
    const customByName = new Map();
    customArr.forEach(p => { if (p?.name) customByName.set(p.name, p); });

    const merged = [];
    globalArr.forEach(g => {
      if (!g?.name) return;
      const c = customByName.get(g.name);
      if (c) {
        merged.push({ ...c, _source: 'academy-custom', id: 'custom:' + g.name });
        customByName.delete(g.name);  // 사용 표시
      } else {
        merged.push({ ...g, _source: 'global', id: 'global:' + g.name });
      }
    });
    // 학원이 추가한 새 프리셋 (글로벌에 없는 이름) — 나머지
    for (const c of customByName.values()) {
      merged.push({ ...c, _source: 'academy-custom', id: 'custom:' + c.name });
    }
    // order 로 안정 정렬 (학원 신규는 끝)
    merged.sort((a, b) => (a.order || 0) - (b.order || 0));

    _cleanupPresets = merged;
    _cleanupRenderEditorSelect();
  } catch (e) {
    console.error('cleanup presets load error:', e);
    showToast('프리셋 로드 실패: ' + e.message);
  }
}

// 글로벌 default 우선 (appConfig/cleanupPresets) — 코드 상수는 fallback
async function _getEffectiveCleanupDefaults() {
  try {
    const snap = await getDoc(doc(db, 'appConfig', 'cleanupPresets'));
    if (snap.exists()) {
      const arr = snap.data()?.presets;
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch (e) { console.warn('[cleanup] appConfig/cleanupPresets read failed:', e.message); }
  return _CLEANUP_DEFAULT_PRESETS;
}

// 글로벌 default 를 이름으로 검색할 수 있는 Map 형태로 캐시.
// 매니저 모달 열 때 강제 새로고침해서 super_admin 갱신을 즉시 반영.
let _cleanupGlobalDefaultsByName = null;
async function _cleanupGetGlobalDefaultsByName(forceRefresh = false) {
  if (forceRefresh || !_cleanupGlobalDefaultsByName) {
    const arr = await _getEffectiveCleanupDefaults();
    _cleanupGlobalDefaultsByName = {};
    arr.forEach(p => { if (p?.name) _cleanupGlobalDefaultsByName[p.name] = p; });
  }
  return _cleanupGlobalDefaultsByName;
}

// 2026-05-24 신 모델 도입으로 폐기됨 — 자동 시드 불필요 (글로벌 default 가 항상 보장).
// _cleanupLoadPresets 가 글로벌 + 학원 customCleanupPresets 병합하므로 첫 로드부터 프리셋 표시.

// ─── 에디터 드롭다운 렌더 ───
function _cleanupRenderEditorSelect() {
  const sel = document.getElementById('genPresetSelect');
  if (!sel) return;
  const opts = ['<option value="">프리셋 선택...</option>']
    .concat(_cleanupPresets.map(p =>
      `<option value="${esc(p.id)}" ${p.id===_cleanupActivePresetId?'selected':''}>${esc(p.name)}</option>`));
  sel.innerHTML = opts.join('');
  sel.disabled = _cleanupPresets.length === 0 || !_genActivePage;
  _cleanupUpdateEditorCleanupBtn();
}

function _cleanupUpdateEditorCleanupBtn() {
  const btn = document.getElementById('genCleanupBtn');
  if (!btn) return;
  btn.disabled = !_genActivePage || !_cleanupActivePresetId;
}

window.cleanupOnPresetChange = () => {
  const sel = document.getElementById('genPresetSelect');
  _cleanupActivePresetId = sel?.value || '';
  _cleanupUpdateEditorCleanupBtn();
};

// ─── 단일 페이지 AI 정리 (에디터 버튼) ───
window.genCleanupActivePage = async () => {
  if (!_genActivePage) { showAlert('입력 확인', 'Page 를 먼저 선택하세요'); return; }
  if (!_cleanupActivePresetId) { showAlert('입력 확인', '프리셋을 먼저 선택하세요'); return; }

  const page = _genPages.find(p => p.id === _genActivePage);
  if (!page) return;
  const preset = _cleanupPresets.find(p => p.id === _cleanupActivePresetId);
  if (!preset) { showAlert('입력 확인', '프리셋을 찾을 수 없습니다'); return; }

  const currentText = document.getElementById('genEditText')?.value || page.text || '';
  if (currentText.trim().length < 5) { showAlert('입력 확인', '정리할 본문이 너무 짧습니다'); return; }

  const btn = document.getElementById('genCleanupBtn');
  if (btn) { btn.disabled = true; btn.textContent = '🤖 AI 호출 중...'; }

  try {
    const res = await _geminiFetch('/api/cleanup-ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: currentText, systemPrompt: preset.prompt }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast('정리 실패: ' + (data.error || 'unknown'));
      return;
    }
    _cleanupShowCompareModal(currentText, data.cleaned, page.id, page.title||'', preset.name, data.model);
  } catch (e) {
    showToast('네트워크 에러: ' + e.message);
  } finally {
    if (btn) { btn.textContent = '✨ AI 정리'; _cleanupUpdateEditorCleanupBtn(); }
  }
};

// ─── 비교 모달 (좌 원본 / 우 AI 결과 → 적용/취소) ───
function _cleanupShowCompareModal(original, cleaned, pageId, pageTitle, presetName, model) {
  const html = `
  <div style="width:min(1100px,95vw);max-height:88vh;display:flex;flex-direction:column;">
    <div data-drag-handle style="padding:18px 22px;border-bottom:1px solid var(--border);" title="헤더를 마우스로 드래그하여 이동">
      <div style="font-size:17px;font-weight:700;line-height:1.3;">✨ AI 정리 결과 비교 <span style="font-size:10px;color:var(--gray);font-weight:400;">⋮⋮ 드래그 가능</span></div>
      <div style="font-size:12px;color:var(--gray);margin-top:5px;">
        ${esc(pageTitle)} · 프리셋: ${esc(presetName)} · 모델: <code>${esc(model||'')}</code>
      </div>
    </div>
    <div style="flex:1;display:flex;gap:10px;padding:16px 22px;overflow:hidden;">
      <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
        <div style="font-size:12px;font-weight:600;color:var(--gray);margin-bottom:6px;">원본</div>
        <textarea readonly style="flex:1;min-height:45vh;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:monospace;background:#fafafa;resize:none;">${esc(original)}</textarea>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
        <div style="font-size:12px;font-weight:600;color:var(--teal);margin-bottom:6px;">AI 결과 <span style="font-weight:400;color:var(--gray);font-size:11px;">(편집 가능)</span></div>
        <textarea id="cleanupCompareEdit" style="flex:1;min-height:45vh;padding:10px;border:1px solid var(--teal);border-radius:6px;font-size:12px;font-family:monospace;resize:none;">${esc(cleaned)}</textarea>
      </div>
    </div>
    <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn btn-secondary" onclick="cleanupSaveAsNew('${esc(pageId)}')">+ 새 페이지로 저장</button>
      <button class="btn btn-primary" onclick="cleanupApplySingle('${esc(pageId)}')">적용 (덮어쓰기)</button>
    </div>
  </div>`;
  showModal(html, { draggable: true });
}

window.cleanupApplySingle = async (pageId) => {
  const newText = document.getElementById('cleanupCompareEdit')?.value ?? '';
  try {
    await updateDoc(doc(db, 'genPages', pageId), { text: newText, edited: true });
    const page = _genPages.find(p => p.id === pageId);
    if (page) page.text = newText;
    // 에디터에 반영
    if (_genActivePage === pageId) {
      const textEl = document.getElementById('genEditText');
      if (textEl) textEl.value = newText;
    }
    closeModal();
    showToast('적용 완료');
  } catch (e) {
    showToast('저장 실패: ' + e.message);
  }
};

// 새 Page 로 저장 (원본 유지) — 같은 Book/Chapter 안에 추가
window.cleanupSaveAsNew = async (pageId) => {
  const newText = document.getElementById('cleanupCompareEdit')?.value ?? '';
  const orig = _genPages.find(p => p.id === pageId);
  if (!orig) { showToast('원본 page 정보 없음'); return; }
  try {
    const maxSerial = _genPages.reduce((m,p) => Math.max(m, p.serialNumber||0), 0);
    const docData = {
      title: (orig.title || ('Page ' + orig.serialNumber)) + ' (정리)',
      serialNumber: maxSerial + 1,
      bookId: orig.bookId || null,
      bookName: orig.bookName || '',
      chapterId: orig.chapterId || null,
      chapterName: orig.chapterName || '',
      text: newText,
      ocrConfidence: 0,
      ocrProvider: 'cleanup',
      imageUrl: '',
      edited: true,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || '',
      academyId: window.MY_ACADEMY_ID || 'default',
    };
    const ref = await addDoc(collection(db, 'genPages'), docData);
    _genPages.push({ id: ref.id, ...docData, createdAt: { toMillis: () => Date.now() } });
    closeModal();
    showToast('✓ 새 페이지로 저장됨');
    _genRenderPages();
  } catch (e) {
    showToast('저장 실패: ' + e.message);
  }
};

// ─── 일괄 AI 정리 (Page 툴바 버튼) ───
window.genCleanupBatch = async () => {
  if (_genCheckedPages.size === 0) { showAlert('입력 확인', 'Page 를 1개 이상 체크하세요'); return; }
  if (_cleanupPresets.length === 0) { showAlert('입력 확인', '프리셋이 없습니다'); return; }

  // 프리셋 선택 모달 먼저
  const presetId = await _cleanupPickPresetModal();
  if (!presetId) return;
  const preset = _cleanupPresets.find(p => p.id === presetId);
  if (!preset) return;

  const targets = _genPages.filter(p => _genCheckedPages.has(p.id) && (p.text||'').trim().length >= 5);
  if (targets.length === 0) { showAlert('입력 확인', '본문이 충분한 페이지가 없습니다'); return; }

  _cleanupBatchResults = [];
  _cleanupBatchTabIdx = 0;

  // 진행률 모달
  _cleanupShowBatchProgress(targets.length, 0);

  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    _cleanupShowBatchProgress(targets.length, i);
    try {
      const res = await _geminiFetch('/api/cleanup-ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: p.text, systemPrompt: preset.prompt }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        _cleanupBatchResults.push({
          pageId: p.id, title: p.title||('Page '+p.serialNumber),
          original: p.text, cleaned: data.cleaned,
          applied: false, skipped: false, error: null,
        });
      } else {
        _cleanupBatchResults.push({
          pageId: p.id, title: p.title||('Page '+p.serialNumber),
          original: p.text, cleaned: '',
          applied: false, skipped: false, error: data.error || 'unknown',
        });
      }
    } catch (e) {
      _cleanupBatchResults.push({
        pageId: p.id, title: p.title||('Page '+p.serialNumber),
        original: p.text, cleaned: '',
        applied: false, skipped: false, error: e.message,
      });
    }
  }

  _cleanupBatchPresetName = preset.name;
  _cleanupShowBatchResult(preset.name);
};

function _cleanupSaveCurrentTabEdit() {
  const cur = _cleanupBatchResults[_cleanupBatchTabIdx];
  if (!cur || cur.applied || cur.skipped || cur.error) return;
  const ta = document.getElementById('cleanupBatchEdit');
  if (ta && typeof ta.value === 'string') cur.cleaned = ta.value;
}

function _cleanupShowBatchProgress(total, done) {
  const html = `
  <div style="width:min(420px,90vw);padding:30px 20px;text-align:center;">
    <div style="font-size:32px;margin-bottom:10px;">${iconSvg('bot')}</div>
    <div style="font-size:15px;font-weight:700;margin-bottom:8px;">AI 정리 진행 중...</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:15px;">${done} / ${total} 완료</div>
    <div style="height:8px;background:#eee;border-radius:4px;overflow:hidden;">
      <div style="height:100%;background:var(--teal);width:${Math.round(done/total*100)}%;transition:width .2s;"></div>
    </div>
  </div>`;
  showModal(html);
}

// ─── 일괄 결과 모달 (페이지별 탭 → 개별 적용/건너뜀) ───
function _cleanupShowBatchResult(presetName) {
  if (_cleanupBatchResults.length === 0) { closeModal(); return; }
  _cleanupRenderBatchResult(presetName);
}

function _cleanupRenderBatchResult(presetName) {
  const results = _cleanupBatchResults;
  const idx = Math.min(_cleanupBatchTabIdx, results.length - 1);
  const cur = results[idx];

  const tabs = results.map((r, i) => {
    const active = i === idx;
    const statusIcon = r.applied ? '✓' : r.skipped ? '—' : r.error ? '⚠' : '•';
    const statusColor = r.applied ? '#0a7a3a' : r.error ? '#c33' : r.skipped ? 'var(--gray)' : 'var(--text)';
    return `<button onclick="cleanupBatchGoto(${i})" style="padding:6px 10px;border:1px solid ${active?'var(--teal)':'var(--border)'};background:${active?'var(--teal-light)':'white'};border-radius:6px 6px 0 0;border-bottom:${active?'1px solid var(--teal-light)':'1px solid var(--border)'};margin-right:-1px;font-size:11px;cursor:pointer;color:${statusColor};white-space:nowrap;">
      <span style="margin-right:4px;">${statusIcon}</span>${esc(r.title)}
    </button>`;
  }).join('');

  const body = cur.error
    ? `<div style="flex:1;display:flex;align-items:center;justify-content:center;padding:30px;text-align:center;color:#c33;font-size:13px;">
         <div>
           <div style="font-size:24px;margin-bottom:8px;">⚠</div>
           <div>AI 정리 실패</div>
           <div style="color:var(--gray);margin-top:8px;font-size:12px;">${esc(cur.error)}</div>
         </div>
       </div>`
    : `<div style="flex:1;display:flex;gap:10px;padding:16px 22px;overflow:hidden;">
         <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
           <div style="font-size:12px;font-weight:600;color:var(--gray);margin-bottom:6px;">원본</div>
           <textarea readonly style="flex:1;min-height:40vh;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:monospace;background:#fafafa;resize:none;">${esc(cur.original)}</textarea>
         </div>
         <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
           <div style="font-size:12px;font-weight:600;color:var(--teal);margin-bottom:6px;">AI 결과</div>
           <textarea id="cleanupBatchEdit" style="flex:1;min-height:40vh;padding:10px;border:1px solid var(--teal);border-radius:6px;font-size:12px;font-family:monospace;resize:none;" ${cur.applied||cur.skipped?'readonly':''}>${esc(cur.cleaned)}</textarea>
         </div>
       </div>`;

  const footerLeft = `<div style="font-size:12px;color:var(--gray);">
    ${idx + 1} / ${results.length} · 적용 ${results.filter(r=>r.applied).length} · 건너뜀 ${results.filter(r=>r.skipped).length} · 실패 ${results.filter(r=>r.error).length}
  </div>`;

  const footerRight = cur.error
    ? `<button class="btn btn-secondary" onclick="cleanupBatchNext()">다음 →</button>
       <button class="btn btn-secondary" onclick="cleanupBatchFinish()">닫기</button>`
    : (cur.applied || cur.skipped)
      ? `<span style="font-size:12px;color:${cur.applied?'#0a7a3a':'var(--gray)'};margin-right:8px;">${cur.applied?'✓ 적용됨':'— 건너뜀'}</span>
         <button class="btn btn-secondary" onclick="cleanupBatchNext()">다음 →</button>
         <button class="btn btn-secondary" onclick="cleanupBatchFinish()">닫기</button>`
      : `<button class="btn btn-secondary" onclick="cleanupBatchSkip()">건너뜀</button>
         <button class="btn btn-secondary" onclick="cleanupBatchSaveAsNew()">+ 새 페이지로 저장</button>
         <button class="btn btn-primary" onclick="cleanupBatchApply()">적용 (덮어쓰기)</button>
         <button class="btn btn-secondary" onclick="cleanupBatchNext()">다음 →</button>`;

  const html = `
  <div style="width:min(1100px,95vw);height:min(85vh,750px);display:flex;flex-direction:column;">
    <div data-drag-handle style="padding:18px 22px;border-bottom:1px solid var(--border);" title="헤더를 마우스로 드래그하여 이동">
      <div style="font-size:17px;font-weight:700;line-height:1.3;">✨ 일괄 AI 정리 결과 <span style="font-size:10px;color:var(--gray);font-weight:400;">⋮⋮ 드래그 가능</span></div>
      <div style="font-size:12px;color:var(--gray);margin-top:5px;">프리셋: ${esc(presetName)} · 각 페이지별로 적용/건너뜀 선택</div>
    </div>
    <div style="padding:10px 22px 0;overflow-x:auto;white-space:nowrap;border-bottom:1px solid var(--teal-light);">${tabs}</div>
    ${body}
    <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center;justify-content:space-between;">
      ${footerLeft}
      <div style="display:flex;gap:8px;align-items:center;">${footerRight}</div>
    </div>
  </div>`;
  showModal(html, { draggable: true });
}

window.cleanupBatchGoto = (i) => {
  _cleanupSaveCurrentTabEdit();
  _cleanupBatchTabIdx = i;
  _cleanupRenderBatchResult(_cleanupBatchPresetName);
};

window.cleanupBatchApply = async () => {
  const idx = _cleanupBatchTabIdx;
  const cur = _cleanupBatchResults[idx];
  if (!cur || cur.error) return;
  const edited = document.getElementById('cleanupBatchEdit')?.value ?? cur.cleaned;
  try {
    await updateDoc(doc(db, 'genPages', cur.pageId), { text: edited, edited: true });
    const page = _genPages.find(p => p.id === cur.pageId);
    if (page) page.text = edited;
    cur.applied = true;
    cur.cleaned = edited;
    if (_genActivePage === cur.pageId) {
      const textEl = document.getElementById('genEditText');
      if (textEl) textEl.value = edited;
    }
    // 다음 탭으로 자동 이동
    if (idx < _cleanupBatchResults.length - 1) _cleanupBatchTabIdx = idx + 1;
    _cleanupRenderBatchResult(_cleanupBatchPresetName);
  } catch (e) {
    showToast('저장 실패: ' + e.message);
  }
};

window.cleanupBatchSaveAsNew = async () => {
  const idx = _cleanupBatchTabIdx;
  const cur = _cleanupBatchResults[idx];
  if (!cur || cur.error) return;
  const edited = document.getElementById('cleanupBatchEdit')?.value ?? cur.cleaned;
  const orig = _genPages.find(p => p.id === cur.pageId);
  if (!orig) { showToast('원본 page 정보 없음'); return; }
  try {
    const maxSerial = _genPages.reduce((m,p) => Math.max(m, p.serialNumber||0), 0);
    const docData = {
      title: (orig.title || ('Page ' + orig.serialNumber)) + ' (정리)',
      serialNumber: maxSerial + 1,
      bookId: orig.bookId || null,
      bookName: orig.bookName || '',
      chapterId: orig.chapterId || null,
      chapterName: orig.chapterName || '',
      text: edited,
      ocrConfidence: 0,
      ocrProvider: 'cleanup',
      imageUrl: '',
      edited: true,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || '',
      academyId: window.MY_ACADEMY_ID || 'default',
    };
    const ref = await addDoc(collection(db, 'genPages'), docData);
    _genPages.push({ id: ref.id, ...docData, createdAt: { toMillis: () => Date.now() } });
    cur.applied = true;  // 처리 완료 표시
    cur.cleaned = edited;
    showToast('✓ 새 페이지로 저장됨');
    if (idx < _cleanupBatchResults.length - 1) _cleanupBatchTabIdx = idx + 1;
    _cleanupRenderBatchResult(_cleanupBatchPresetName);
  } catch (e) {
    showToast('저장 실패: ' + e.message);
  }
};

window.cleanupBatchSkip = () => {
  _cleanupSaveCurrentTabEdit();
  const idx = _cleanupBatchTabIdx;
  const cur = _cleanupBatchResults[idx];
  if (!cur) return;
  cur.skipped = true;
  if (idx < _cleanupBatchResults.length - 1) _cleanupBatchTabIdx = idx + 1;
  _cleanupRenderBatchResult(_cleanupBatchPresetName);
};

window.cleanupBatchNext = () => {
  _cleanupSaveCurrentTabEdit();
  if (_cleanupBatchTabIdx < _cleanupBatchResults.length - 1) {
    _cleanupBatchTabIdx++;
    _cleanupRenderBatchResult(_cleanupBatchPresetName);
  } else {
    window.cleanupBatchFinish();
  }
};

window.cleanupBatchFinish = () => {
  const applied = _cleanupBatchResults.filter(r => r.applied).length;
  closeModal();
  showToast(`일괄 처리 종료 — ${applied}개 적용됨`);
  _cleanupBatchResults = [];
  _cleanupBatchTabIdx = 0;
  // Page 목록 새로고침
  _genRenderPages();
};

// ─── 프리셋 선택 모달 (일괄 처리 시작 전) ───
function _cleanupPickPresetModal() {
  return new Promise(resolve => {
    if (_cleanupPresets.length === 0) { resolve(null); return; }
    const opts = _cleanupPresets.map(p =>
      `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    const html = `
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">✨ 일괄 AI 정리</div>
        <div style="font-size:12px;color:var(--gray);margin-top:5px;">
          체크된 Page ${_genCheckedPages.size}개에 적용할 프리셋을 선택하세요.
        </div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <label style="font-size:12px;color:var(--gray);display:block;margin-bottom:6px;">프리셋</label>
        <select id="cleanupPickSelect" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:white;">${opts}</select>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" id="cleanupPickCancel">취소</button>
        <button class="btn btn-primary" id="cleanupPickOk">시작</button>
      </div>
    </div>`;
    showModal(html);
    setTimeout(() => {
      const ok = document.getElementById('cleanupPickOk');
      const cancel = document.getElementById('cleanupPickCancel');
      const sel = document.getElementById('cleanupPickSelect');
      if (ok) ok.onclick = () => { const v = sel?.value || ''; closeModal(); resolve(v); };
      if (cancel) cancel.onclick = () => { closeModal(); resolve(null); };
    }, 50);
  });
}

// ─── 프리셋 관리 모달 (CRUD) ───
window.cleanupOpenPresetManager = async () => {
  await _cleanupRenderPresetManager();
};

async function _cleanupRenderPresetManager() {
  // super_admin 갱신을 즉시 반영하기 위해 매니저 열 때마다 글로벌 default fresh fetch
  const globals = await _cleanupGetGlobalDefaultsByName(true);

  const rows = _cleanupPresets.length === 0
    ? '<tr><td colspan="4" style="padding:30px;text-align:center;color:#bbb;font-size:12px;">프리셋이 없습니다. 아래 "+ 새 프리셋" 또는 "+ 누락된 기본값 추가"를 사용하세요.</td></tr>'
    : _cleanupPresets.map(p => {
        const g = globals[p.name];
        const isDefaultNamed = !!g;
        const isDirty = isDefaultNamed && (
          (g.prompt || '') !== (p.prompt || '') ||
          (g.description || '') !== (p.description || '')
        );
        const nameSuffix = isDefaultNamed
          ? ` <span style="font-size:10px;color:var(--gray);">(기본)</span>${isDirty?' <span style="color:#c47;font-weight:700;" title="기본값과 다름">●</span>':''}`
          : '';
        const actions = [
          `<button class="action-btn" onclick="cleanupEditPreset('${esc(p.id)}')">${iconSvg('edit')} 편집</button>`,
          isDefaultNamed
            ? `<button class="action-btn" onclick="cleanupResetPreset('${esc(p.id)}')" ${isDirty?'':'disabled style="opacity:.4;"'}>↺ 기본값</button>`
            : '',
          `<button class="action-btn" onclick="cleanupDuplicatePreset('${esc(p.id)}')">⎘ 복제</button>`,
          isDefaultNamed
            ? '' // 기본 프리셋은 삭제 불가 (이름 매칭 기준)
            : `<button class="action-btn danger" onclick="cleanupDeletePreset('${esc(p.id)}')">${iconSvg('trash')} 삭제</button>`,
        ].filter(Boolean).join(' ');
        return `
          <tr style="border-bottom:1px solid var(--border);">
            <td class="td-main" style="padding:8px 10px;">${esc(p.name)}${nameSuffix}</td>
            <td class="td-sub" style="padding:8px 10px;">${esc(p.description||'')}</td>
            <td class="td-center" style="padding:8px 10px;">${p.order||0}</td>
            <td style="padding:6px 10px;white-space:nowrap;">${actions}</td>
          </tr>`;
      }).join('');

  // 누락된 기본값 개수 — 상단 버튼 활성/비활성 표시
  const existingNames = new Set(_cleanupPresets.map(p => p.name));
  const missingCount = Object.keys(globals).filter(n => !existingNames.has(n)).length;

  const html = `
  <div style="width:min(860px,95vw);max-height:88vh;display:flex;flex-direction:column;">
    <div style="padding:18px 22px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <div style="min-width:0;flex:1;">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">${iconSvg('settings')} AI 정리 프리셋 관리</div>
        <div style="font-size:12px;color:var(--gray);margin-top:5px;">${_cleanupPresets.length}개 프리셋 · 기본 ${Object.keys(globals).length}종</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-secondary" onclick="cleanupRestoreDefaults()" ${missingCount===0?'disabled style="opacity:.5;"':''}>+ 누락된 기본값 추가${missingCount>0?` (${missingCount})`:''}</button>
        <button class="btn btn-primary" onclick="cleanupEditPreset('')">+ 새 프리셋</button>
      </div>
    </div>
    <div style="flex:1;overflow:auto;padding:16px 22px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);background:#fafafa;">
            <th style="text-align:left;padding:10px;">이름</th>
            <th style="text-align:left;padding:10px;">설명</th>
            <th style="text-align:center;padding:10px;width:60px;">순서</th>
            <th style="text-align:left;padding:10px;width:230px;">동작</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="closeModal()">닫기</button>
    </div>
  </div>`;
  showModal(html);
}

// ─── 프리셋 편집 모달 (create/edit 공용) ───
window.cleanupEditPreset = (id) => {
  const existing = id ? _cleanupPresets.find(p => p.id === id) : null;
  const p = existing || { name:'', description:'', prompt:'', order:(_cleanupPresets.length+1), isDefault:false };
  const isNew = !existing;

  const html = `
  <div style="width:min(760px,95vw);max-height:88vh;display:flex;flex-direction:column;">
    <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
      <div style="font-size:17px;font-weight:700;line-height:1.3;">${isNew?'+ 새 프리셋':'✏️ 프리셋 편집'}</div>
    </div>
    <div style="flex:1;overflow:auto;padding:16px 22px;display:flex;flex-direction:column;gap:14px;">
      <div>
        <label style="font-size:12px;color:var(--gray);display:block;margin-bottom:6px;">이름 *</label>
        <input id="cleanupEditName" type="text" value="${esc(p.name)}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
      </div>
      <div>
        <label style="font-size:12px;color:var(--gray);display:block;margin-bottom:6px;">설명 (선택)</label>
        <input id="cleanupEditDesc" type="text" value="${esc(p.description||'')}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
      </div>
      <div>
        <label style="font-size:12px;color:var(--gray);display:block;margin-bottom:6px;">정렬 순서</label>
        <input id="cleanupEditOrder" type="number" value="${p.order||0}" style="width:120px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
      </div>
      <div style="flex:1;display:flex;flex-direction:column;min-height:250px;">
        <label style="font-size:12px;color:var(--gray);display:block;margin-bottom:6px;">프롬프트 *</label>
        <textarea id="cleanupEditPrompt" style="flex:1;min-height:250px;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:monospace;resize:vertical;box-sizing:border-box;">${esc(p.prompt||'')}</textarea>
      </div>
    </div>
    <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="cleanupOpenPresetManager()">취소</button>
      <button class="btn btn-primary" onclick="cleanupSavePreset('${esc(id||'')}')">저장</button>
    </div>
  </div>`;
  showModal(html);
};

// 2026-05-24 신 모델: 학원 customCleanupPresets 배열 조작.
// id 형식: 'global:이름' / 'custom:이름' / 빈값(신규)
// 글로벌 항목 편집·삭제 시도 → 학원 커스텀으로 오버라이드 또는 복원 흐름.
window.cleanupSavePreset = async (id) => {
  const name = document.getElementById('cleanupEditName')?.value.trim() || '';
  const description = document.getElementById('cleanupEditDesc')?.value.trim() || '';
  const order = parseInt(document.getElementById('cleanupEditOrder')?.value || '0') || 0;
  const prompt = document.getElementById('cleanupEditPrompt')?.value || '';

  if (name.length < 1) { showAlert('입력 확인', '이름을 입력하세요'); return; }
  if (prompt.trim().length < 10) { showAlert('입력 확인', '프롬프트는 최소 10자 이상이어야 합니다'); return; }

  const idParts = id ? id.split(':') : [];
  const oldName = idParts[1] || '';

  try {
    const acRef = doc(db, 'academies', window.MY_ACADEMY_ID || 'default');
    const acSnap = await getDoc(acRef);
    const currentCustom = Array.isArray(acSnap.data()?.customCleanupPresets) ? acSnap.data().customCleanupPresets : [];

    // 옛 이름 + 새 이름 둘 다 학원 커스텀에서 제거 (이름 변경 시 옛 항목도 정리)
    const nextCustom = currentCustom.filter(p => p.name !== oldName && p.name !== name);
    nextCustom.push({ name, description, prompt, order, isDefault: false });

    await updateDoc(acRef, {
      customCleanupPresets: nextCustom,
      customCleanupPresetsUpdatedAt: serverTimestamp(),
    });
    showToast(oldName && oldName === name ? '수정 완료' : '추가 완료');
    await _cleanupLoadPresets();
    await _cleanupRenderPresetManager();
  } catch (e) {
    showToast('저장 실패: ' + e.message);
  }
};

window.cleanupDuplicatePreset = async (id) => {
  const p = _cleanupPresets.find(x => x.id === id);
  if (!p) return;
  try {
    const acRef = doc(db, 'academies', window.MY_ACADEMY_ID || 'default');
    const acSnap = await getDoc(acRef);
    const currentCustom = Array.isArray(acSnap.data()?.customCleanupPresets) ? acSnap.data().customCleanupPresets : [];

    // 중복 이름 회피
    const allNames = new Set([..._cleanupPresets.map(x => x.name), ...currentCustom.map(x => x.name)]);
    let dupName = p.name + ' (복제)';
    let n = 2;
    while (allNames.has(dupName)) dupName = `${p.name} (복제${n++})`;

    const next = [...currentCustom, {
      name: dupName,
      description: p.description || '',
      prompt: p.prompt || '',
      order: (p.order || 0) + 1,
      isDefault: false,
    }];
    await updateDoc(acRef, {
      customCleanupPresets: next,
      customCleanupPresetsUpdatedAt: serverTimestamp(),
    });
    showToast('복제 완료');
    await _cleanupLoadPresets();
    await _cleanupRenderPresetManager();
  } catch (e) {
    showToast('복제 실패: ' + e.message);
  }
};

window.cleanupDeletePreset = async (id) => {
  const p = _cleanupPresets.find(x => x.id === id);
  if (!p) return;

  if (p._source === 'global') {
    showAlert('삭제 불가', '글로벌 기본 프리셋은 삭제할 수 없습니다.\n사용을 원치 않으면 그냥 사용하지 않으시거나, 편집해서 학원 커스텀으로 만드세요.');
    return;
  }

  // 학원 커스텀 — 글로벌에 같은 이름 있으면 "오버라이드" → 글로벌 복원
  // 없으면 학원 자체 신규 → 완전 삭제 (복구 불가)
  const globals = await _cleanupGetGlobalDefaultsByName();
  const isOverride = !!globals[p.name];
  const title = isOverride
    ? `"${p.name}" 학원 커스텀을 제거할까요?`
    : `"${p.name}" 프리셋을 삭제할까요?`;
  const sub = isOverride
    ? '글로벌 기본 프리셋으로 돌아갑니다.'
    : '학원 자체 신규 프리셋이라 복구할 수 없습니다.';
  const ok = await showConfirm(title, sub);
  if (!ok) return;

  try {
    const acRef = doc(db, 'academies', window.MY_ACADEMY_ID || 'default');
    const acSnap = await getDoc(acRef);
    const currentCustom = Array.isArray(acSnap.data()?.customCleanupPresets) ? acSnap.data().customCleanupPresets : [];
    const next = currentCustom.filter(x => x.name !== p.name);

    await updateDoc(acRef, {
      customCleanupPresets: next,
      customCleanupPresetsUpdatedAt: serverTimestamp(),
    });
    showToast(isOverride ? '글로벌로 복원됨' : '삭제됨');
    if (_cleanupActivePresetId === id) _cleanupActivePresetId = '';
    await _cleanupLoadPresets();
    await _cleanupRenderPresetManager();
  } catch (e) {
    showToast('삭제 실패: ' + e.message);
  }
};

// 단일 프리셋을 글로벌 default 와 동기화 — prompt/description 만 덮어씀
// (order/isDefault 등 메타는 유지)
window.cleanupResetPreset = async (id) => {
  const p = _cleanupPresets.find(x => x.id === id);
  if (!p) return;
  const globals = await _cleanupGetGlobalDefaultsByName(true);
  const def = globals[p.name];
  if (!def) {
    showAlert('입력 확인', '글로벌 default 에 같은 이름의 기본 프리셋이 없습니다.');
    return;
  }
  const samePrompt = (def.prompt || '') === (p.prompt || '');
  const sameDesc = (def.description || '') === (p.description || '');
  if (samePrompt && sameDesc) {
    showAlert('입력 확인', '이미 기본값과 동일합니다.');
    return;
  }
  const ok = await showConfirm('기본값으로 복원?', `"${p.name}" 의 prompt 와 설명이 글로벌 default 로 덮어써집니다.\n학원 커스텀이 사라집니다.`);
  if (!ok) return;
  try {
    await updateDoc(doc(db, 'genCleanupPresets', id), {
      prompt: def.prompt || '',
      description: def.description || '',
      updatedAt: serverTimestamp(),
    });
    showToast(`✓ ${p.name} 기본값 복원됨`);
    await _cleanupLoadPresets();
    await _cleanupRenderPresetManager();
  } catch (e) {
    showToast('복원 실패: ' + e.message);
  }
};

// ─── 기본값 복원 (누락된 기본 프리셋만 재추가) ───
// 우선순위: appConfig/cleanupPresets (super_admin 글로벌) → 코드 상수 fallback
window.cleanupRestoreDefaults = async () => {
  const existingNames = new Set(_cleanupPresets.map(p => p.name));
  const defaults = await _getEffectiveCleanupDefaults();
  const missing = defaults.filter(p => !existingNames.has(p.name));
  if (missing.length === 0) { showAlert('입력 확인', '모든 기본 프리셋이 이미 존재합니다'); return; }
  const ok = await showConfirm(`${missing.length}개의 기본 프리셋을 복원하시겠습니까?`, missing.map(p => '• ' + p.name).join('\n'));
  if (!ok) return;
  try {
    const uid = auth.currentUser?.uid || '';
    await Promise.all(missing.map(p =>
      addDoc(collection(db, 'genCleanupPresets'), {
        ...p,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: uid,
        academyId: window.MY_ACADEMY_ID || 'default',
      })
    ));
    showToast(`${missing.length}개 복원됨`);
    await _cleanupLoadPresets();
    await _cleanupRenderPresetManager();
  } catch (e) {
    showToast('복원 실패: ' + e.message);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// AI 문제 생성 & 문제 세트 관리 (2026-04 추가)
// ═══════════════════════════════════════════════════════════════════════════
// 이 코드는 public/admin/js/app.js 파일 맨 끝에 추가하세요.
// 기존 코드는 절대 수정하지 않습니다. 완전히 독립된 영역.
//
// 의존성 (app.js 상단에 이미 import됨):
//   - collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc
//   - query, where, orderBy, serverTimestamp
//   - db, auth (Firebase 인스턴스)
//   - esc, showToast, showConfirm, showModal, closeModal (유틸)
//   - _genPages, _genChapters, _genBooks (Generator 전역 상태 — 읽기만)
// ═══════════════════════════════════════════════════════════════════════════

// ─── 전역 상태 ───
let _qgSelectedPageIds = new Set();    // AI 생성 화면에서 선택된 Page IDs
let _qgGenerated = [];                  // AI 생성 결과 (미리보기용)
let _qgModel = '';                      // 마지막 생성에 실제 사용된 모델 (폴백 후 실제 값)
let _qgExcluded = new Set();            // 미리보기에서 제외된 문제 인덱스
let _qsList = [];                       // 문제 세트 목록 (모든 fetch 합집합 누적 캐시)
let _qsBooks = [];                      // Book 목록 (폴더 이름 표시용, genBooks 에서 로드)
let _qsEditState = null;                // 수정 중인 세트 (Phase: 세트 내용 편집)
let _qsSetsByBook = {};                 // lazy 캐시 — { bookId: [...] }. '__all_recent__' = 최근 20개
let _qsLoadingBook = null;              // 중복 클릭 방지

// ─── 문제 세트 목록 화면 상태 (Phase 7) ───
const _QS_RECENT_LIMIT = 20;
let _qsSplitV = 40;                     // 상단 pane 높이 %
let _qsSplitH = 30;                     // 하단 좌측 pane 폭 %
let _qsFavSets = new Set();             // 즐겨찾기된 세트 ID
let _qsFavBooks = new Set();            // 즐겨찾기된 Book ID (+ '__unassigned__')
let _qsActiveBookId = null;             // 하단 좌측에서 선택된 Book ID
let _qsSortTop = { col: 'date', dir: 'desc' };
let _qsSortBottom = { col: 'date', dir: 'desc' };
let _qsColWidths = { top: {}, bottom: {} };   // 테이블별 컬럼 폭 (px)
const _QS_UNASSIGNED = '__unassigned__';
const _QS_COL_DEFAULTS = {
  top:    { fav:32, name:200, type:90, count:70, book:220, date:130, act:280 },
  bottom: { fav:32, name:280, type:90, count:70,          date:130, act:280 },
};

// Phase 2.5: Book/Chapter 드릴다운 필터 + 유형 선택
let _qgActiveBook = null;     // {id, name} | null
let _qgActiveChapter = null;  // {id, name, bookId} | null
let _qgCurrentType = 'mcq';   // 현재 선택된 문제 유형
let _qgWordsnapDraft = '';        // Book 클릭 등으로 _qgRender 시 textarea 보존 (2026-05-23)
let _qgUnscrambleSnapDraft = '';  // 동일

// ─── 유형별 옵션 스키마 (Phase 2.5) ───
// enabled:false 인 유형은 UI에는 보이되 [생성] 클릭 시 "Phase X 이후 구현 예정" 토스트
const QG_TYPE_OPTIONS = {
  'word': {
    label: '단어시험',
    icon: '📝',
    enabled: true,
    phaseLabel: null,
    noteHint: '본문에서 중요 단어를 AI 가 선별해 단어 시험을 만듭니다.',
    options: [
      { key:'count',      label:'문제수',   type:'number', default:20, min:5, max:100 },
      { key:'difficulty', label:'난이도',   type:'select', choices:['하','중','상'], default:'중' },
    ],
  },
  'fill_blank': {
    label: '빈칸채우기',
    icon: '✏️',
    enabled: true,
    phaseLabel: null,
    noteHint: '본문 문장에서 AI 가 핵심 단어를 가리고 빈칸을 채우는 문제를 만듭니다.',
    options: [
      { key:'count',             label:'문제수',             type:'number', default:5, min:1, max:50 },
      { key:'difficulty',        label:'난이도',             type:'select', choices:['하','중','상'], default:'중' },
      { key:'blanksPerSentence', label:'문장별 빈칸 개수',   type:'number', default:1, min:1, max:5 },
    ],
  },
  'unscramble': {
    label: '언스크램블',
    icon: '🔀',
    enabled: true,
    phaseLabel: null,
    noteHint: '본문 문장을 AI 가 청크 갯수에 맞게 나눠 언스크램블 문제를 만듭니다.',
    options: [
      { key:'count',       label:'문제수',     type:'number', default:10, min:3, max:50 },
      { key:'difficulty',  label:'난이도',     type:'select', choices:['하','중','상'], default:'중' },
      { key:'chunkCount',  label:'청크 갯수',  type:'number', default:4, min:2, max:8 },
    ],
  },
  'mcq': {
    label: '본문이해·문법_객관식',
    icon: '📖',
    enabled: true,
    phaseLabel: null,
    noteHint: '본문을 읽고 4지선다로 내용을 확인하거나 본문에 나오는 문법 패턴을 점검합니다.',
    options: [
      { key:'count',      label:'문제수',  type:'number', default:5, min:1, max:50 },
      { key:'difficulty', label:'난이도',  type:'select', choices:['하','중','상'], default:'중' },
      { key:'subType',    label:'문제 종류', type:'select', choices:['본문이해','문법'], default:'본문이해' },
    ],
  },
  'subjective': {
    label: '해석하기_주관식',
    icon: '✍️',
    enabled: true,
    phaseLabel: null,
    noteHint: '원문 문장을 제시하고 학생이 손으로 한글 해석을 쓰는 시험지를 생성합니다. (학생앱 배정 없음)',
    options: [
      { key:'count',        label:'문제수',     type:'number', default:5, min:1, max:50 },
      { key:'difficulty',   label:'난이도',     type:'select', choices:['하','중','상'], default:'중' },
      { key:'sentenceMode', label:'문장 처리',  type:'select', choices:['문장 변형','문장 유지'], default:'문장 변형' },
    ],
  },
  'recording': {
    label: '녹음숙제',
    icon: '🎤',
    enabled: true,
    phaseLabel: null,
    noAi: true,  // AI 호출 없이 로컬 생성 (페이지 본문이 그대로 fullText)
    noteHint: '선택한 Page 의 전체 문장을 학생이 N회 반복 녹음합니다. 무결성 통과 후 마지막 녹음을 AI 가 평가·피드백해요. (녹음 횟수·임계값은 시험 배정 시 / 무결성 기준은 학원 설정에서 조정)',
    options: [],  // 옵션 없음 — 학원 설정 (학원 단위) + 시험 배정 시 (시험별) 두 단계에서 결정
  },
};

// ─── 라우팅 연결 ───
// goPage 함수에 이미 generator 케이스가 있으니, 새 메뉴 2개 추가 필요
// 기존 goPage 함수 내 'else if(id==='generator')' 다음 줄에 아래 2줄 추가:
//   else if(id==='quiz-generate') await loadQuizGenerate();
//   else if(id==='quiz-sets')     await loadQuestionSets();

// ═══════════════════════════════════════════════════════════════════════════
// [Page 1] AI 문제 생성 (genPages에서 Page 선택 → AI 호출 → 저장)
// ═══════════════════════════════════════════════════════════════════════════

// AI Generator — Lazy load (2026-05-14, AI OCR 과 동일 패턴):
// 진입 시 Books 만 (없으면 fetch). Chapters/Pages 는 Book 클릭 시 lazy.
// _genBooks/_genChapters/_genPages 는 AI OCR 과 공유 — 이미 받은 데이터 있으면 재사용.
window.loadQuizGenerate = async () => {
  try {
    if (!_genBooks.length) {
      const bSnap = await getDocs(query(
        collection(db,'genBooks'),
        where('academyId','==',window.MY_ACADEMY_ID),
        orderBy('createdAt','asc')
      ));
      _genBooks = bSnap.docs.map(d=>({id:d.id,...d.data()}));
    }
  } catch(e) {
    showToast('AI Generator 데이터 로드 실패: '+e.message);
    return;
  }

  _qgSelectedPageIds.clear();
  _qgGenerated = [];
  _qgExcluded.clear();
  _qgActiveBook = null;
  _qgActiveChapter = null;
  _qgRender();
};

// ── 새로고침 버튼 전용 wrapper — 캐시 무효화 + 재fetch + 완료 토스트 ──
// 진입(메뉴 클릭)은 기존 함수 직접(캐시 활용). 새로고침만 강제 갱신 + 피드백.
window.genRefresh = async () => {
  showToast('AI OCR 새로고침 중...');
  await loadGenerator();  // 항상 books/미배정 재fetch
  showToast('✅ AI OCR 목록 새로고침 완료');
};
window.qgRefresh = async () => {
  showToast('AI Generator 새로고침 중...');
  _genBooks = []; _genChapters = []; _genPages = [];  // 캐시 비움 → 재fetch 강제
  await loadQuizGenerate();
  showToast('✅ AI Generator 새로고침 완료');
};
window.qsRefresh = async () => {
  showToast('문제 세트 목록 새로고침 중...');
  _qsInvalidateCache();  // 세트 캐시 무효 (Books·세트 모두 재fetch)
  await loadQuestionSets();
  showToast('✅ 문제 세트 목록 새로고침 완료');
};
// 진도체크 일자별 — 그 날짜 캐시(_prog.testsByDate[date]) 무효 후 재fetch
window.progRefresh = async () => {
  const date = (document.getElementById('progDateInput')?.value || '').trim();
  if (date && _prog?.testsByDate) delete _prog.testsByDate[date];
  showToast('진도체크 새로고침 중...');
  await progRenderByDate();
  showToast('✅ 진도체크 새로고침 완료');
};
// 대시보드 — initDashboard 가 거의 모든 위젯 매번 fresh (미납만 결제캐시·자동무효) → 토스트만
window.dashRefresh = async () => {
  showToast('대시보드 새로고침 중...');
  await initDashboard();
  showToast('✅ 대시보드 새로고침 완료');
};
// AI 사용량 — loadQuotaUsage 매번 getDoc fresh (캐시 없음) → 토스트만
window.quotaRefresh = async () => {
  showToast('AI 사용량 새로고침 중...');
  await loadQuotaUsage();
  showToast('✅ AI 사용량 새로고침 완료');
};
// 시험배정 상세 — _renderTestAssignDetail 매번 books/chapters 재fetch → 토스트만
window.tpAssignRefresh = async () => {
  showToast('새로고침 중...');
  await _renderTestAssignDetail(_activeTestType);
  showToast('✅ 새로고침 완료');
};

// 난이도 표기 정규화 — 한글 '하/중/상' (현행) / 영어 'easy/medium/hard' / 옛 학년('중1' 등) 모두 영어로 매핑.
// API 프롬프트에는 항상 'easy'/'medium'/'hard' 영어로 전달.
function _qgMapDifficulty(d) {
  if (d === '하') return 'easy';
  if (d === '중') return 'medium';
  if (d === '상') return 'hard';
  if (d === 'easy' || d === 'medium' || d === 'hard') return d;
  return 'medium';  // 옛 학년 값('중1','초3' 등) 폴백
}

// ──────────────────────────────────────────────────────────────────────────
// Phase 2.5: 4컬럼 레이아웃 (Book | Chapter | Page | 설정)
// ──────────────────────────────────────────────────────────────────────────
function _qgRender() {
  const root = document.getElementById('quizGenRoot');
  if (!root) return;

  const allBooks = _genBooks || [];
  const allChapters = _qgFilteredChapters();
  const allPages = _qgFilteredPages();
  const books = _qgApplySortSearch('books', allBooks, 'name');
  const chapters = _qgApplySortSearch('chapters', allChapters, 'name');
  const pages = _qgApplySortSearch('pages', allPages, 'title');

  root.innerHTML = `
    <div id="qgTopRow" style="display:flex;gap:0;height:calc(100vh - 210px);min-height:520px;">

      <!-- 1. Book 컬럼 -->
      <div id="qgBookPane" class="qg-pane" style="flex:25 1 0;min-width:150px;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:10px 14px;background:#f8f9fa;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:6px;">
          <span style="cursor:pointer;user-select:none;" onclick="qgToggleSort('books')">📚 Book <span id="qgBookHeaderCount" style="font-size:11px;color:var(--gray);font-weight:400;">${books.length === allBooks.length ? books.length : `${books.length}/${allBooks.length}`}개</span> <span id="qgBookSortMark" style="font-size:10px;color:var(--gray);font-weight:400;">${_qgSortLabel('books')}</span></span>
          ${_qgActiveBook ? `<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;" onclick="qgClearBook()">해제</button>` : ''}
        </div>
        <div style="padding:5px 8px;border-bottom:1px solid var(--border);flex-shrink:0;">
          <input type="search" id="qgBookSearch" placeholder="🔍 검색" oninput="qgUpdateSearch('books',this.value)" value="${esc(_qgSearch.books)}" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:3px 7px;font-size:11px;outline:none;">
        </div>
        <div id="qgBookList" style="flex:1;overflow-y:auto;">
          ${_qgBookItemsHtml(books)}
        </div>
      </div>

      <div class="qg-resizer" data-idx="0" title="드래그하여 폭 조정" style="width:8px;cursor:col-resize;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:transparent;">
        <div style="width:2px;height:40px;background:var(--border);border-radius:1px;"></div>
      </div>

      <!-- 2. Chapter 컬럼 -->
      <div id="qgChapterPane" class="qg-pane" style="flex:25 1 0;min-width:150px;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:10px 14px;background:#f8f9fa;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:6px;">
          <span style="cursor:pointer;user-select:none;" onclick="qgToggleSort('chapters')">📖 Chapter <span id="qgChapterHeaderCount" style="font-size:11px;color:var(--gray);font-weight:400;">${chapters.length === allChapters.length ? chapters.length : `${chapters.length}/${allChapters.length}`}개</span> <span id="qgChapterSortMark" style="font-size:10px;color:var(--gray);font-weight:400;">${_qgSortLabel('chapters')}</span></span>
          ${_qgActiveChapter ? `<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;" onclick="qgClearChapter()">해제</button>` : ''}
        </div>
        <div style="padding:5px 8px;border-bottom:1px solid var(--border);flex-shrink:0;">
          <input type="search" id="qgChapterSearch" placeholder="🔍 검색" oninput="qgUpdateSearch('chapters',this.value)" value="${esc(_qgSearch.chapters)}" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:3px 7px;font-size:11px;outline:none;">
        </div>
        <div id="qgChapterList" style="flex:1;overflow-y:auto;">
          ${_qgChapterItemsHtml(chapters)}
        </div>
      </div>

      <div class="qg-resizer" data-idx="1" title="드래그하여 폭 조정" style="width:8px;cursor:col-resize;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:transparent;">
        <div style="width:2px;height:40px;background:var(--border);border-radius:1px;"></div>
      </div>

      <!-- 3. Page 컬럼 (체크박스 다중 선택) -->
      <div id="qgPagePane" class="qg-pane" style="flex:25 1 0;min-width:150px;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:10px 14px;background:#f8f9fa;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:6px;">
          <span style="cursor:pointer;user-select:none;" onclick="qgToggleSort('pages')">📄 Page <span id="qgPageHeaderCount" style="font-size:11px;color:var(--gray);font-weight:400;">${pages.length === allPages.length ? pages.length : `${pages.length}/${allPages.length}`}개</span> <span style="font-size:11px;color:var(--gray);font-weight:400;">· 선택 <span id="qgSelCount" style="${_qgSelCountStyle(_qgSelectedPageIds.size)}">${_qgSelectedPageIds.size}</span>개 · <span id="qgTokenEst"></span></span> <span id="qgPageSortMark" style="font-size:10px;color:var(--gray);font-weight:400;">${_qgSortLabel('pages')}</span></span>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;" onclick="qgSelectAll()">전체</button>
            <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;" onclick="qgSelectNone()">해제</button>
          </div>
        </div>
        <div style="padding:5px 8px;border-bottom:1px solid var(--border);flex-shrink:0;">
          <input type="search" id="qgPageSearch" placeholder="🔍 검색" oninput="qgUpdateSearch('pages',this.value)" value="${esc(_qgSearch.pages)}" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:3px 7px;font-size:11px;outline:none;">
        </div>
        <div id="qgPageList" style="flex:1;overflow-y:auto;">
          ${_qgPageItemsHtml(pages)}
        </div>
      </div>

      <div class="qg-resizer" data-idx="2" title="드래그하여 폭 조정" style="width:8px;cursor:col-resize;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:transparent;">
        <div style="width:2px;height:40px;background:var(--border);border-radius:1px;"></div>
      </div>

      <!-- 4. 설정 컬럼 -->
      <div id="qgSettingsPane" class="qg-pane" style="flex:25 1 0;min-width:150px;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:10px 12px;background:#f8f9fa;border-bottom:1px solid var(--border);">
          <div style="font-weight:700;font-size:13px;">⚙️ 설정</div>
          <div style="font-size:10px;color:var(--gray);">문제 유형 선택 후 생성</div>
        </div>
        <div style="flex:1;overflow-y:auto;padding:14px;">

          <label style="font-size:11px;font-weight:700;color:var(--gray);">문제 유형</label>
          <select id="qgType" onchange="qgChangeType(this.value)"
            style="width:100%;padding:8px 10px;margin:4px 0 14px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
            ${Object.entries(QG_TYPE_OPTIONS).map(([k,cfg])=>
              `<option value="${k}" ${k===_qgCurrentType?'selected':''}>${cfg.icon} ${esc(cfg.label)}${cfg.enabled?'':' 🔒'}</option>`
            ).join('')}
          </select>

          <div id="qgTypeNote" style="font-size:11px;color:var(--gray);background:#f8f9fa;border-radius:6px;padding:8px 10px;margin-bottom:14px;line-height:1.5;"></div>

          <div id="qgOptionsPanel" style="margin-bottom:14px;"></div>

          <button class="btn btn-primary" id="qgGenBtn" onclick="qgGenerate()"
            style="width:100%;padding:11px;font-size:13px;font-weight:700;">
            ✨ AI 로 문제 생성
          </button>
          <div style="margin-top:6px;font-size:10px;color:var(--gray);line-height:1.5;text-align:center;">
            Page 는 최대 30개 동시 작업 가능합니다.
          </div>
          <div id="qgStatus" style="margin-top:8px;font-size:11px;color:var(--gray);text-align:center;min-height:16px;"></div>

          <button class="btn btn-secondary" onclick="qgOpenPromptModal()"
            style="width:100%;padding:7px;font-size:11px;margin-top:10px;" id="qgPromptBtn">
            📋 AI 프롬프트 보기 / 수정
          </button>
        </div>
      </div>

    </div>
  `;

  _qgRenderOptions(_qgCurrentType);
  _qgAttachResizers();
  _qgUpdateTokenEstimate();
}

// ─── 컬럼 리사이저 (4개 pane = 3개 리사이저) ───
function _qgAttachResizers() {
  const row = document.getElementById('qgTopRow');
  if (!row) return;
  const paneIds = ['qgBookPane','qgChapterPane','qgPagePane','qgSettingsPane'];
  const panes = paneIds.map(id => document.getElementById(id));
  if (panes.some(p => !p)) return;

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem('quizgen_col_ratios') || 'null'); } catch { return null; }
  })();
  const ratios = (saved && saved.length === 4 && saved.every(n => typeof n === 'number' && n > 0))
    ? saved.slice() : [25, 25, 25, 25];
  panes.forEach((p, i) => { p.style.flex = `${ratios[i]} 1 0`; });

  row.querySelectorAll('.qg-resizer').forEach(r => {
    const i = parseInt(r.getAttribute('data-idx'), 10);
    r.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const rowWidth = row.getBoundingClientRect().width;
      const totalGrow = ratios.reduce((a,b)=>a+b, 0);
      const startA = ratios[i];
      const startB = ratios[i+1];
      const sumAB = startA + startB;
      const MIN = 6;
      const onMove = (ev) => {
        const deltaPx = ev.clientX - startX;
        const deltaGrow = (deltaPx / rowWidth) * totalGrow;
        let newA = startA + deltaGrow;
        let newB = startB - deltaGrow;
        if (newA < MIN) { newA = MIN; newB = sumAB - MIN; }
        if (newB < MIN) { newB = MIN; newA = sumAB - MIN; }
        ratios[i] = newA;
        ratios[i+1] = newB;
        panes[i].style.flex = `${newA} 1 0`;
        panes[i+1].style.flex = `${newB} 1 0`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        try { localStorage.setItem('quizgen_col_ratios', JSON.stringify(ratios)); } catch {}
      };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    r.addEventListener('mouseenter', () => { r.style.background = 'var(--teal-light)'; });
    r.addEventListener('mouseleave', () => { r.style.background = 'transparent'; });
  });
}

// ─── 필터 ───
function _qgFilteredChapters() {
  const all = _genChapters || [];
  if (!_qgActiveBook) return all;
  return all.filter(c => c.bookId === _qgActiveBook.id);
}

function _qgFilteredPages() {
  let all = (_genPages || []).filter(p => (p.text||'').trim().length > 0);
  if (_qgActiveChapter) {
    all = all.filter(p => p.chapterId === _qgActiveChapter.id);
  } else if (_qgActiveBook) {
    all = all.filter(p => p.bookId === _qgActiveBook.id);
  }
  return all;
}

// 정렬 + 검색 (Book/Chapter/Page 공통)
const _qgSort = { books: 'recent', chapters: 'recent', pages: 'recent' };
const _qgSearch = { books: '', chapters: '', pages: '' };

window.qgToggleSort = (kind) => {
  _qgSort[kind] = _qgSort[kind] === 'recent' ? 'name' : 'recent';
  _qgRender();
};
window.qgUpdateSearch = (kind, value /*, isComposing — 부분 갱신이라 더 이상 필요 없음 */) => {
  _qgSearch[kind] = String(value || '').trim().toLowerCase();
  // list 부분만 갱신 — input 유지 (한글 IME 끊김 방지)
  _qgRenderListsOnly();
};

function _qgApplySortSearch(kind, arr, nameKey = 'name') {
  let result = arr;
  const term = _qgSearch[kind];
  if (term) {
    result = result.filter(x => String(x[nameKey] || x.title || '').toLowerCase().includes(term));
  }
  if (_qgSort[kind] === 'name') {
    // numeric:true → "Page 2" < "Page 10" 자연 정렬
    result = [...result].sort((a,b) =>
      String(a[nameKey] || a.title || '').localeCompare(String(b[nameKey] || b.title || ''), 'ko', { numeric: true }));
  } else {
    result = _genRecentSort(result);
  }
  return result;
}
function _qgSortLabel(kind) { return _qgSort[kind] === 'name' ? '· 이름순▼' : '· 최근순▼'; }

// list items html 헬퍼 (전체 render 와 부분 갱신에서 공통 사용)
function _qgBookItemsHtml(books) {
  if (!books.length) return '<div style="padding:16px;text-align:center;color:#bbb;font-size:12px;">' + (_qgSearch.books ? '검색 결과 없음' : 'Book 이 없습니다') + '</div>';
  return books.map(b => {
    const isActive = _qgActiveBook?.id === b.id;
    const chCnt = (_genChapters||[]).filter(c=>c.bookId===b.id).length;
    const pgCnt = (_genPages||[]).filter(p=>p.bookId===b.id).length;
    return `<div onclick="qgSelectBook('${esc(b.id)}')"
      style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid #f0f0f0;cursor:pointer;background:${isActive?'var(--teal-light)':''};">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;color:${isActive?'var(--teal)':'var(--text)'};font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(b.name||'(이름 없음)')}</div>
        <div style="font-size:11px;color:var(--gray);">Ch ${chCnt} · Pg ${pgCnt}</div>
      </div>
    </div>`;
  }).join('');
}
function _qgChapterItemsHtml(chapters) {
  if (!chapters.length) {
    if (_qgSearch.chapters) return '<div style="padding:16px;text-align:center;color:#bbb;font-size:12px;">검색 결과 없음</div>';
    return `<div style="padding:16px;text-align:center;color:#bbb;font-size:12px;">${_qgActiveBook ? '이 Book 엔 Chapter 가 없습니다.<br>(Page 컬럼에 Book 의 전체 Page 가 표시됩니다)' : 'Book 을 먼저 선택하세요'}</div>`;
  }
  return chapters.map(c => {
    const isActive = _qgActiveChapter?.id === c.id;
    const pgCnt = (_genPages||[]).filter(p => p.chapterId === c.id).length;
    return `<div onclick="qgSelectChapter('${esc(c.id)}')"
      style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid #f0f0f0;cursor:pointer;background:${isActive?'var(--teal-light)':''};">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;color:${isActive?'var(--teal)':'var(--text)'};font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.name||'(이름 없음)')}</div>
        <div style="font-size:11px;color:${c.bookId?'var(--gray)':'#bbb'};font-style:${c.bookId?'normal':'italic'};">${c.bookId?esc(c.bookName||''):'미지정'} · Pg ${pgCnt}</div>
      </div>
    </div>`;
  }).join('');
}
function _qgPageItemsHtml(pages) {
  if (!pages.length) return '<div style="padding:20px;text-align:center;color:#bbb;font-size:12px;">' + (_qgSearch.pages ? '검색 결과 없음' : '표시할 Page 가 없습니다') + '</div>';
  const books = _genBooks || [];
  return pages.map(p => {
    const checked = _qgSelectedPageIds.has(p.id);
    const book = books.find(b => b.id === p.bookId);
    const chap = (_genChapters||[]).find(c => c.id === p.chapterId);
    const subpath = [book?.name, chap?.name].filter(Boolean).join(' › ');
    const preview = (p.text||'').slice(0, 80);
    return `<div onclick="qgTogglePage('${esc(p.id)}')"
      style="padding:8px 12px;border-bottom:1px solid #f5f5f5;display:flex;gap:10px;align-items:start;cursor:pointer;${checked?'background:#fff8e6;':''}">
      <input type="checkbox" ${checked?'checked':''} onclick="event.stopPropagation();qgTogglePage('${esc(p.id)}')" style="margin-top:3px;flex-shrink:0;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:600;color:var(--text);">${esc(p.title||'Untitled')}</div>
        ${subpath ? `<div style="font-size:10px;color:var(--gray);margin-top:1px;">${esc(subpath)}</div>` : ''}
        <div style="font-size:10px;color:#aaa;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(preview)}${(p.text||'').length>80?'…':''}</div>
      </div>
    </div>`;
  }).join('');
}

// list 영역만 부분 갱신 — 검색/정렬 시 input 유지 (한글 IME 끊김 방지)
function _qgRenderListsOnly() {
  const allBooks = _genBooks || [];
  const allChapters = _qgFilteredChapters();
  const allPages = _qgFilteredPages();
  const books = _qgApplySortSearch('books', allBooks, 'name');
  const chapters = _qgApplySortSearch('chapters', allChapters, 'name');
  const pages = _qgApplySortSearch('pages', allPages, 'title');

  const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const cntFmt = (filtered, all) => filtered === all ? `${filtered}` : `${filtered}/${all}`;

  setHtml('qgBookList', _qgBookItemsHtml(books));
  setText('qgBookHeaderCount', cntFmt(books.length, allBooks.length) + '개');
  setText('qgBookSortMark', _qgSortLabel('books'));

  setHtml('qgChapterList', _qgChapterItemsHtml(chapters));
  setText('qgChapterHeaderCount', cntFmt(chapters.length, allChapters.length) + '개');
  setText('qgChapterSortMark', _qgSortLabel('chapters'));

  setHtml('qgPageList', _qgPageItemsHtml(pages));
  setText('qgPageHeaderCount', cntFmt(pages.length, allPages.length) + '개');
  setText('qgPageSortMark', _qgSortLabel('pages'));
  _qgUpdateTokenEstimate();
}

// ─── Book / Chapter 선택 핸들러 ───
window.qgSelectBook = async (bookId) => {
  const b = (_genBooks||[]).find(x => x.id === bookId);
  if (!b) return;
  if (_qgActiveBook?.id === bookId) {
    _qgActiveBook = null;
    _qgActiveChapter = null;
  } else {
    _qgActiveBook = { id: b.id, name: b.name };
    _qgActiveChapter = null;
    // Book 의 Chapters + Pages lazy fetch (cache — 한 번만)
    const hasCh = _genChapters.some(c => c.bookId === bookId);
    const hasPg = _genPages.some(p => p.bookId === bookId);
    if (!hasCh || !hasPg) {
      const tk = ++_genBookFetchToken;  // race 가드 — 늦게 온 옛 응답 무시
      try {
        const [cSnap, pSnap] = await Promise.all([
          hasCh ? Promise.resolve({docs:[]}) : getDocs(query(
            collection(db,'genChapters'),
            where('academyId','==', window.MY_ACADEMY_ID),
            where('bookId','==', bookId),
            orderBy('order','asc')
          )),
          hasPg ? Promise.resolve({docs:[]}) : getDocs(query(
            collection(db,'genPages'),
            where('academyId','==', window.MY_ACADEMY_ID),
            where('bookId','==', bookId),
            orderBy('serialNumber','asc')
          )),
        ]);
        if (tk !== _genBookFetchToken) return;  // 그 사이 다른 Book 클릭됨 → 최신 클릭이 render 담당
        if (!hasCh) _genChapters = _genChapters.concat(cSnap.docs.map(d=>({id:d.id,...d.data()})));
        if (!hasPg) _genPages = _genPages.concat(pSnap.docs.map(d=>({id:d.id,...d.data()})));
      } catch(e) {
        if (tk !== _genBookFetchToken) return;  // 옛 응답 에러는 무시
        console.error('[qgSelectBook] lazy fetch 실패', e);
        showToast('Chapter/Page 목록을 불러오지 못했어요 — Book 을 다시 클릭해주세요');
      }
    }
  }
  _qgRender();
};

window.qgSelectChapter = (chapterId) => {
  const c = (_genChapters||[]).find(x => x.id === chapterId);
  if (!c) return;
  if (_qgActiveChapter?.id === chapterId) {
    _qgActiveChapter = null;
  } else {
    _qgActiveChapter = { id: c.id, name: c.name, bookId: c.bookId };
    if (!_qgActiveBook || _qgActiveBook.id !== c.bookId) {
      const b = (_genBooks||[]).find(x => x.id === c.bookId);
      if (b) _qgActiveBook = { id: b.id, name: b.name };
    }
  }
  _qgRender();
};

window.qgClearBook = () => {
  _qgActiveBook = null;
  _qgActiveChapter = null;
  _qgRender();
};

window.qgClearChapter = () => {
  _qgActiveChapter = null;
  _qgRender();
};

window.qgTogglePage = (pid) => {
  if (_qgSelectedPageIds.has(pid)) _qgSelectedPageIds.delete(pid);
  else _qgSelectedPageIds.add(pid);
  _qgUpdateSelCount();
  // 체크박스 시각 갱신
  _qgRender();
};

window.qgSelectAll = () => {
  _qgFilteredPages().forEach(p => _qgSelectedPageIds.add(p.id));
  _qgRender();
};

window.qgSelectNone = () => {
  _qgSelectedPageIds.clear();
  _qgRender();
};

// 선택 카운트 강조 스타일 — 0개면 평범, 1개+ 일 때 teal 배지 (chapter 누적 인지)
function _qgSelCountStyle(n) {
  if (n > 0) {
    return 'display:inline-block;min-width:22px;padding:2px 9px;background:var(--teal);color:white;font-size:14px;font-weight:800;border-radius:11px;text-align:center;';
  }
  return 'color:var(--teal);font-size:12px;font-weight:700;';
}
function _qgUpdateSelCount() {
  const el = document.getElementById('qgSelCount');
  if (el) {
    const n = _qgSelectedPageIds.size;
    el.textContent = n;
    el.setAttribute('style', _qgSelCountStyle(n));
  }
  _qgUpdateTokenEstimate();
  // 선택 수가 상한 이하로 내려가면 이전 경고 문구 제거
  if (_qgSelectedPageIds.size <= 20) {
    const status = document.getElementById('qgStatus');
    if (status && status.textContent?.includes('20이하')) status.innerHTML = '';
  }
}

// Gemini 입력 토큰 추정 (±10% 오차, 실제 API 호출 없이 문자수 기반)
// - 한글: ~2 chars/token
// - 영문/기타: ~4 chars/token
// - 시스템 프롬프트 + 유저 지시문 오버헤드: ~1200 tokens 고정
// - 페이지당 랩핑 오버헤드: ~30 tokens
// - 서버의 MAX_CHARS_PER_PAGE(3000) 잘라내기 반영
function _qgEstimateInputTokens(pageIds) {
  const MAX = 3000;
  let total = 1200; // 시스템 + 유저 지시문 오버헤드
  (_genPages||[]).forEach(p => {
    if (!pageIds.has(p.id)) return;
    const text = String(p.text||'').slice(0, MAX);
    const hangul = (text.match(/[ㄱ-ㆎ가-힣]/g)||[]).length;
    const rest = text.length - hangul;
    total += Math.ceil(hangul / 2) + Math.ceil(rest / 4) + 30;
  });
  return total;
}

function _qgUpdateTokenEstimate() {
  const el = document.getElementById('qgTokenEst');
  if (!el) return;
  if (_qgSelectedPageIds.size === 0) { el.innerHTML = ''; return; }
  const n = _qgEstimateInputTokens(_qgSelectedPageIds);
  // 임계치: <5k 안전 / 5k~15k 주의 / 15k+ 경고 (입력 1M 컨텍스트 기준 여유는 많지만, 응답 품질과 파싱 안정성 영향)
  const color = n < 5000 ? '#0a7a3a' : n < 15000 ? '#b45309' : '#c33';
  const hint = n < 5000 ? '안전' : n < 15000 ? '적정' : '큼';
  el.innerHTML = `<span style="color:${color};" title="선택된 Page 본문 + 프롬프트의 예상 입력 토큰">≈${n.toLocaleString()} tokens · ${hint}</span>`;
}

// ─── 유형 전환 ───
window.qgChangeType = (type) => {
  if (!QG_TYPE_OPTIONS[type]) return;
  _qgCurrentType = type;
  _qgRenderOptions(type);
};

// ─── 옵션 패널 렌더 (localStorage 값 복원) ───
function _qgRenderOptions(type) {
  const cfg = QG_TYPE_OPTIONS[type];
  const panel = document.getElementById('qgOptionsPanel');
  const noteEl = document.getElementById('qgTypeNote');
  const btn = document.getElementById('qgGenBtn');
  if (!panel || !cfg) return;

  if (noteEl) {
    noteEl.innerHTML = `${cfg.enabled ? '✓' : '🔒'} ${esc(cfg.noteHint)}`;
    noteEl.style.color = cfg.enabled ? 'var(--gray)' : '#856404';
    noteEl.style.background = cfg.enabled ? '#f8f9fa' : '#fff8e1';
  }

  const saved = _qgLoadOpts(type);

  const optionsHtml = cfg.options.map(opt => {
    const val = saved[opt.key] !== undefined ? saved[opt.key] : opt.default;
    const id = 'qgOpt_' + opt.key;
    const labelRow = `<div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:4px;">${esc(opt.label)}</div>`;

    if (opt.type === 'number') {
      const hint = (opt.min!==undefined && opt.max!==undefined)
        ? `<div style="font-size:10px;color:var(--gray);margin-top:3px;">입력 범위: ${opt.min} ~ ${opt.max}</div>`
        : '';
      return `<div style="margin-bottom:10px;">
        ${labelRow}
        <input type="number" id="${id}" value="${val}"
          ${opt.min!==undefined?`min="${opt.min}"`:''} ${opt.max!==undefined?`max="${opt.max}"`:''}
          onchange="qgPersistOpts()"
          style="width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:6px;font-size:12px;">
        ${hint}
      </div>`;
    }
    if (opt.type === 'select') {
      return `<div style="margin-bottom:10px;">
        ${labelRow}
        <select id="${id}" onchange="qgPersistOpts()"
          style="width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:white;">
          ${(opt.choices||[]).map(c => `<option value="${esc(c)}" ${c===val?'selected':''}>${esc(c)}</option>`).join('')}
        </select>
      </div>`;
    }
    if (opt.type === 'checkbox') {
      return `<div style="margin-bottom:10px;">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;color:var(--text);">
          <input type="checkbox" id="${id}" ${val?'checked':''} onchange="qgPersistOpts()">
          ${esc(opt.label)}
        </label>
      </div>`;
    }
    return '';
  }).join('');

  // 'word' (단어시험) Wordsnap / 'unscramble' 직접 입력 섹션 — AI 생성 버튼 위
  const snapHtml = (type === 'word') ? _qgBuildWordsnapSection()
                 : (type === 'unscramble') ? _qgBuildUnscrambleSnapSection()
                 : '';
  panel.innerHTML = optionsHtml + snapHtml;
  if (type === 'word') setTimeout(() => window._qgWordsnapUpdateStatus?.(), 0);
  if (type === 'unscramble') setTimeout(() => window._qgUnscrambleSnapUpdateStatus?.(), 0);

  if (btn) {
    if (!cfg.enabled) {
      btn.textContent = `🔒 ${cfg.phaseLabel} 에서 활성화`;
      btn.style.background = '#ccc';
      btn.style.color = '#666';
    } else if (cfg.noAi) {
      btn.textContent = '📝 문제 세트 만들기';
      btn.style.background = '';
      btn.style.color = '';
    } else {
      btn.textContent = '✨ AI 로 문제 생성';
      btn.style.background = '';
      btn.style.color = '';
    }
  }
}

// ─── localStorage 유틸 ───
function _qgLoadOpts(type) {
  try {
    const raw = localStorage.getItem('quizgen_opts_' + type);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

window.qgPersistOpts = () => {
  const cfg = QG_TYPE_OPTIONS[_qgCurrentType];
  if (!cfg) return;
  const vals = {};
  cfg.options.forEach(opt => {
    const el = document.getElementById('qgOpt_' + opt.key);
    if (!el) return;
    if (opt.type === 'checkbox') vals[opt.key] = el.checked;
    else if (opt.type === 'number') {
      const n = parseFloat(el.value);
      vals[opt.key] = isNaN(n) ? opt.default : n;
    } else vals[opt.key] = el.value;
  });
  try {
    localStorage.setItem('quizgen_opts_' + _qgCurrentType, JSON.stringify(vals));
  } catch(e) {
    console.warn('qgPersistOpts:', e);
  }
};

function _qgCollectOpts(type) {
  const cfg = QG_TYPE_OPTIONS[type];
  if (!cfg) return {};
  const vals = {};
  cfg.options.forEach(opt => {
    const el = document.getElementById('qgOpt_' + opt.key);
    if (!el) { vals[opt.key] = opt.default; return; }
    if (opt.type === 'checkbox') vals[opt.key] = el.checked;
    else if (opt.type === 'number') {
      const n = parseFloat(el.value);
      vals[opt.key] = isNaN(n) ? opt.default : n;
    } else vals[opt.key] = el.value;
  });
  return vals;
}

// ─── 생성 버튼 (유형별 분기) ───
window.qgGenerate = async () => {
  const type = _qgCurrentType;
  const cfg = QG_TYPE_OPTIONS[type];
  if (!cfg) return;

  if (!cfg.enabled) { showAlert('입력 확인', '${cfg.label}은(는) ${cfg.phaseLabel} 이후 구현 예정입니다'); return; }

  if (_qgSelectedPageIds.size === 0) {
    showAlert('입력 확인', 'Page 를 먼저 선택하세요');
    const status0 = document.getElementById('qgStatus');
    if (status0) status0.innerHTML = `<span style="color:#c33;">Page 를 먼저 선택하세요</span>`;
    return;
  }
  if (_qgSelectedPageIds.size > 30) {
    const status0 = document.getElementById('qgStatus');
    if (status0) status0.innerHTML = `<span style="color:#c33;">⚠️ Page 수를 30이하로 줄이세요 (현재 ${_qgSelectedPageIds.size}개)</span>`;
    showToast('Page 수를 30이하로 줄이세요');
    return;
  }

  qgPersistOpts();
  const opts = _qgCollectOpts(type);

  // Phase 5.5: noAi 플래그 — API 호출 없이 로컬 생성
  if (cfg.noAi) {
    if (type === 'recording') {
      _qgBuildRecordingSet(opts);
    } else {
      showToast('지원되지 않는 로컬 생성 유형입니다');
    }
    return;
  }

  if (type === 'mcq') {
    await _qgCallMcq(opts);
  } else if (type === 'fill_blank') {
    await _qgCallFillBlank(opts);
  } else if (type === 'subjective') {
    await _qgCallSubjective(opts);
  } else if (type === 'recording') {
    // Phase 5 구 버전 (schemaV 없음) — noAi 플래그가 꺼진 경우에만 도달 (실제 사용 안 함)
    await _qgCallRecording(opts);
  } else if (type === 'word' || type === 'vocab') {
    await _qgCallVocab(opts);
  } else if (type === 'unscramble') {
    await _qgCallUnscramble(opts);
  } else {
    showToast('지원되지 않는 유형입니다');
  }
};

// ─── MCQ API 호출 ───
async function _qgCallMcq(opts) {
  const btn = document.getElementById('qgGenBtn');
  const status = document.getElementById('qgStatus');
  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '🤖 AI 호출 중...<br><span style="font-size:10px;">5~15초 소요</span>';

  const selectedPages = (_genPages||[])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .map(p => ({ id: p.id, title: p.title||'', text: p.text||'' }));

  try {
    const t0 = Date.now();
    // mcq subType 매핑: '문법' → 'grammar', 그 외 'content'.
    // super_admin 편집 프롬프트는 subType 별로 별도 키 사용
    const subType = (opts.subType === '문법' || opts.subType === 'grammar') ? 'grammar' : 'content';
    const promptKey = subType === 'grammar' ? 'mcq_grammar' : 'mcq';
    const res = await _geminiFetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pages: selectedPages,
        count: opts.count,
        type: 'mcq',
        subType,
        difficulty: _qgMapDifficulty(opts.difficulty),
        customSystemPrompt: _qgGetCustomPrompt(promptKey) || undefined,
      }),
    });
    const data = await res.json();
    const sec = ((Date.now()-t0)/1000).toFixed(1);

    if (!res.ok || !data.success) {
      if (data.rawSnippet) console.warn('[generate-quiz raw]', data.rawSnippet);
      if (status) status.innerHTML = `<span style="color:#c33;">❌ 실패 (${sec}s) — ${esc(data.error||'unknown')}</span>`;
      showToast('생성 실패: ' + (data.error||'unknown'));
      return;
    }

    _qgGenerated = data.questions || [];
    _qgExcluded.clear();
    const fixNote = data.autoFixedCount > 0 ? ` · 🔧 ${data.autoFixedCount}건 자동 보정 (a/an)` : '';
    if (status) status.innerHTML = `<span style="color:#0a7a3a;">✓ ${sec}s · ${_qgGenerated.length}/${data.requestedCount}문제${fixNote}</span>`;

    // 세트명 default 에 '문법' suffix 추가
    if (subType === 'grammar') {
      // 본문이해 모드와 동일 base 이름 + ' · 문법' suffix 만 (유형 컬럼에 객관식 표시되니 이름 중복 X)
      data.defaultName = (data.defaultName || _qgBuildDefaultName()) + ' · 문법';
    }
    _qgShowResultModal(data);
  } catch(e) {
    if (status) status.innerHTML = `<span style="color:#c33;">❌ 네트워크 에러</span>`;
    showToast('네트워크 에러: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Fill-blank API 호출 ───
async function _qgCallFillBlank(opts) {
  const btn = document.getElementById('qgGenBtn');
  const status = document.getElementById('qgStatus');
  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '🤖 AI 호출 중...<br><span style="font-size:10px;">5~15초 소요</span>';

  const selectedPages = (_genPages||[])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .map(p => ({ id: p.id, title: p.title||'', text: p.text||'' }));

  try {
    const t0 = Date.now();
    const res = await _geminiFetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pages: selectedPages,
        count: opts.count,
        type: 'fill_blank',
        difficulty: _qgMapDifficulty(opts.difficulty),
        blanksPerSentence: opts.blanksPerSentence,
        customSystemPrompt: _qgGetCustomPrompt('fill_blank') || undefined,
      }),
    });
    const data = await res.json();
    const sec = ((Date.now()-t0)/1000).toFixed(1);

    if (!res.ok || !data.success) {
      if (data.rawSnippet) console.warn('[generate-quiz raw]', data.rawSnippet);
      if (status) status.innerHTML = `<span style="color:#c33;">❌ 실패 (${sec}s) — ${esc(data.error||'unknown')}</span>`;
      showToast('생성 실패: ' + (data.error||'unknown'));
      return;
    }

    _qgGenerated = data.questions || [];
    _qgExcluded.clear();
    if (status) status.innerHTML = `<span style="color:#0a7a3a;">✓ ${sec}s · ${_qgGenerated.length}/${data.requestedCount}문제</span>`;

    _qgShowResultModal(data);
  } catch(e) {
    if (status) status.innerHTML = `<span style="color:#c33;">❌ 네트워크 에러</span>`;
    showToast('네트워크 에러: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Subjective API 호출 (Phase 4) ───
async function _qgCallSubjective(opts) {
  const btn = document.getElementById('qgGenBtn');
  const status = document.getElementById('qgStatus');
  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '🤖 AI 호출 중...<br><span style="font-size:10px;">5~15초 소요</span>';

  const selectedPages = (_genPages||[])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .map(p => ({ id: p.id, title: p.title||'', text: p.text||'' }));

  try {
    const t0 = Date.now();
    const res = await _geminiFetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pages: selectedPages,
        count: opts.count,
        type: 'subjective',
        difficulty: _qgMapDifficulty(opts.difficulty),
        // 한글 옵션 → 영어 모드 매핑 ('문장 유지' → verbatim / default 'paraphrase')
        sentenceMode: opts.sentenceMode === '문장 유지' ? 'verbatim' : 'paraphrase',
        // verbatim 모드는 별도 customPrompt key 사용
        customSystemPrompt: _qgGetCustomPrompt(opts.sentenceMode === '문장 유지' ? 'subjective_verbatim' : 'subjective') || undefined,
      }),
    });
    const data = await res.json();
    const sec = ((Date.now()-t0)/1000).toFixed(1);

    if (!res.ok || !data.success) {
      if (data.rawSnippet) console.warn('[generate-quiz raw]', data.rawSnippet);
      if (status) status.innerHTML = `<span style="color:#c33;">❌ 실패 (${sec}s) — ${esc(data.error||'unknown')}</span>`;
      showToast('생성 실패: ' + (data.error||'unknown'));
      return;
    }

    _qgGenerated = data.questions || [];
    _qgExcluded.clear();
    if (status) status.innerHTML = `<span style="color:#0a7a3a;">✓ ${sec}s · ${_qgGenerated.length}/${data.requestedCount}문제</span>`;

    _qgShowResultModal(data);
  } catch(e) {
    if (status) status.innerHTML = `<span style="color:#c33;">❌ 네트워크 에러</span>`;
    showToast('네트워크 에러: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Recording API 호출 (Phase 5) ───
async function _qgCallRecording(opts) {
  const btn = document.getElementById('qgGenBtn');
  const status = document.getElementById('qgStatus');
  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '🤖 AI 호출 중...<br><span style="font-size:10px;">5~15초 소요</span>';

  const selectedPages = (_genPages||[])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .map(p => ({ id: p.id, title: p.title||'', text: p.text||'' }));

  try {
    const t0 = Date.now();
    const res = await _geminiFetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pages: selectedPages,
        count: opts.count,
        type: 'recording',
        customSystemPrompt: _qgGetCustomPrompt('recording') || undefined,
      }),
    });
    const data = await res.json();
    const sec = ((Date.now()-t0)/1000).toFixed(1);

    if (!res.ok || !data.success) {
      if (data.rawSnippet) console.warn('[generate-quiz raw]', data.rawSnippet);
      if (status) status.innerHTML = `<span style="color:#c33;">❌ 실패 (${sec}s) — ${esc(data.error||'unknown')}</span>`;
      showToast('생성 실패: ' + (data.error||'unknown'));
      return;
    }

    _qgGenerated = data.questions || [];
    _qgExcluded.clear();
    if (status) status.innerHTML = `<span style="color:#0a7a3a;">✓ ${sec}s · ${_qgGenerated.length}/${data.requestedCount}문제</span>`;

    _qgShowResultModal(data);
  } catch(e) {
    if (status) status.innerHTML = `<span style="color:#c33;">❌ 네트워크 에러</span>`;
    showToast('네트워크 에러: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Wordsnap: 클립보드 '영단어[Tab]해석' 직접 입력 (AI 호출 없이 즉시 세트 생성) ───
function _qgBuildWordsnapSection() {
  const bookNote = _qgActiveBook
    ? `<span style="color:#0a7a3a;font-weight:700;">✓ 저장 위치: ${esc(_qgActiveBook.name)}${_qgActiveChapter ? ' · ' + esc(_qgActiveChapter.name) : ''}</span>`
    : `<span style="color:#c33;">⚠ 좌측에서 Book 폴더를 먼저 선택하세요 (저장 위치 필수)</span>`;
  return `
    <div style="margin-top:14px;padding:12px;border:2px dashed var(--teal);border-radius:8px;background:var(--teal-light);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:6px;">
        <div style="font-size:11px;font-weight:700;color:var(--teal);">${iconSvg('clipboard')} Wordsnap · 클립보드 입력</div>
        <button class="btn btn-secondary" onclick="qgWordsnapPaste()"
          style="font-size:10px;padding:2px 8px;flex-shrink:0;">📥 붙여넣기</button>
      </div>
      <div style="font-size:10px;margin-bottom:6px;line-height:1.5;">${bookNote}</div>
      <div style="font-size:10px;color:var(--gray);margin-bottom:6px;line-height:1.5;">
        각 줄: <code style="background:white;padding:1px 5px;border-radius:3px;font-size:10px;">영단어/숙어<span style="color:#c33;font-weight:700;">[Tab]</span>해석</code>
      </div>
      <textarea id="qgWordsnapInput" rows="5" spellcheck="false"
        oninput="_qgWordsnapUpdateStatus()"
        placeholder="apple&#9;사과&#10;banana&#9;바나나&#10;give up&#9;포기하다"
        style="width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:4px;font-family:'Consolas','Malgun Gothic',monospace;font-size:11px;line-height:1.6;resize:vertical;box-sizing:border-box;">${esc(_qgWordsnapDraft)}</textarea>
      <div id="qgWordsnapStatus" style="font-size:10px;color:var(--gray);margin:6px 0 8px;min-height:14px;">입력 대기 중</div>
      <button class="btn btn-primary" onclick="qgRunWordsnap()" id="qgWordsnapBtn"
        style="width:100%;padding:9px;font-size:12px;font-weight:700;background:var(--teal);">
        📋 Wordsnap 실행
      </button>
    </div>
  `;
}

// 각 줄을 '영단어[Tab]해석' 으로 파싱. 반환: { questions, errors }
function _qgParseWordsnap(text) {
  const lines = (text || '').split(/\r?\n/);
  const questions = [];
  const errors = [];
  const seenWords = new Set();

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return; // 빈 줄 스킵

    const tabIdx = trimmed.indexOf('\t');
    if (tabIdx < 0) {
      errors.push({ line: i + 1, msg: 'Tab 구분자 없음' });
      return;
    }
    const word = trimmed.slice(0, tabIdx).trim();
    const meaning = trimmed.slice(tabIdx + 1).trim();

    if (!word || !meaning) { errors.push({ line: i + 1, msg: '영단어 또는 해석 누락' }); return; }
    if (word.length > 60)   { errors.push({ line: i + 1, msg: `영단어 너무 김 (${word.length}자)` }); return; }
    if (meaning.length > 200) { errors.push({ line: i + 1, msg: `해석 너무 김 (${meaning.length}자)` }); return; }

    const key = word.toLowerCase();
    if (seenWords.has(key)) { errors.push({ line: i + 1, msg: `중복: ${word}` }); return; }
    seenWords.add(key);

    questions.push({
      type: 'vocab',
      word, meaning,
      example: '', exampleKo: '',
      sourcePageId: '', sourcePageTitle: '',
      difficulty: 'medium',
    });
  });

  return { questions, errors };
}

window._qgWordsnapUpdateStatus = () => {
  const ta = document.getElementById('qgWordsnapInput');
  const status = document.getElementById('qgWordsnapStatus');
  if (!ta || !status) return;
  _qgWordsnapDraft = ta.value;  // re-render 시 보존 (Book 클릭 등)
  if (!ta.value.trim()) { status.innerHTML = '입력 대기 중'; status.style.color = 'var(--gray)'; return; }
  const { questions, errors } = _qgParseWordsnap(ta.value);
  const parts = [];
  if (questions.length) parts.push(`<span style="color:#0a7a3a;font-weight:700;">✓ ${questions.length}개 단어</span>`);
  if (errors.length)   parts.push(`<span style="color:#c33;">⚠ ${errors.length}줄 오류</span>`);
  status.innerHTML = parts.join(' · ') || '<span style="color:#c33;">파싱 결과 없음</span>';
};

window.qgWordsnapPaste = async () => {
  const ta = document.getElementById('qgWordsnapInput');
  if (!ta) return;
  try {
    const text = await navigator.clipboard.readText();
    ta.value = text || '';
    window._qgWordsnapUpdateStatus();
    ta.focus();
  } catch(e) {
    showToast('클립보드 읽기 실패 — textarea 에 직접 Ctrl+V 로 붙여넣으세요');
    ta.focus();
  }
};

window.qgRunWordsnap = async () => {
  const ta = document.getElementById('qgWordsnapInput');
  if (!ta) return;

  // Book 필수 — 미지정 세트 발생 차단 (2026-05-14)
  if (!_qgActiveBook) {
    showAlert('Book 선택 필요', '좌측에서 Book 폴더를 먼저 선택해야 저장됩니다. (저장 위치 지정 필수)');
    return;
  }

  const { questions, errors } = _qgParseWordsnap(ta.value);

  if (questions.length === 0) { showAlert('입력 확인', '저장할 단어가 없습니다 — 형식: 영단어[Tab]해석'); return; }

  const parts = [_qgActiveBook?.name, _qgActiveChapter?.name, 'Wordsnap'].filter(Boolean);
  const setName = parts.join(' · ') || `Wordsnap · ${new Date().toLocaleDateString('ko-KR')}`;

  const errorNote = errors.length ? `\n(오류 ${errors.length}줄은 제외됩니다)` : '';
  const ok = await showConfirm(
    `"${setName}" 세트 저장?`,
    `${questions.length}개 단어를 문제 세트로 저장합니다.${errorNote}`
  );
  if (!ok) return;

  // 한글·특수문자 포함 단어 검증 게이트 (학생 답안 입력 호환성)
  const gateResult = await _qsCharsGate(questions);
  if (!gateResult.proceed) return;
  if (questions.length === 0) {
    showAlert('저장 불가', '모든 단어를 삭제해 저장할 문제가 없습니다');
    return;
  }

  // 활성 Book/Chapter 있으면 sourcePages 로 기록 → 문제세트 목록의 폴더에 표시됨
  const sourcePages = (_qgActiveBook || _qgActiveChapter) ? [{
    pageId: '',
    pageTitle: 'Wordsnap 수동 입력',
    bookId: _qgActiveBook?.id || '',
    chapterId: _qgActiveChapter?.id || '',
  }] : [];

  const btn = document.getElementById('qgWordsnapBtn');
  if (btn) btn.disabled = true;
  const status = document.getElementById('qgWordsnapStatus');

  // ─── 동음이의어 자동 채움 (말하기 시험 채점 보조) ───
  // 실패해도 저장은 진행 — 동음이의어 빈 배열로 fallback. 사용자 흐름 안 끊음.
  let homophonesFilled = 0;
  try {
    if (status) status.innerHTML = `<span style="color:var(--gray);">${iconSvg('bot')} 동음이의어 분석 중...</span>`;
    const resp = await _geminiFetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'homophones-only', words: questions.map(q => q.word) }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.success && Array.isArray(data.results)) {
        const map = new Map(data.results.map(r => [String(r.word || '').toLowerCase(), r.homophones || []]));
        questions.forEach(q => {
          q.homophones = map.get(q.word.toLowerCase()) || [];
          if (q.homophones.length) homophonesFilled++;
        });
      }
    } else {
      // AI 실패 — 빈 배열로 채워 채점 코드 정합성 유지
      questions.forEach(q => { q.homophones = []; });
    }
  } catch (e) {
    console.warn('[Wordsnap] homophones AI failed:', e.message);
    questions.forEach(q => { q.homophones = []; });
  }

  try {
    await addDoc(collection(db, 'genQuestionSets'), {
      name: setName,
      academyId: window.MY_ACADEMY_ID || 'default',
      sourceType: 'vocab',
      sourcePages,
      bookId: _qsPrimaryBookId({ sourcePages }) === _QS_UNASSIGNED ? '' : _qsPrimaryBookId({ sourcePages }),
      questions,
      questionCount: questions.length,
      aiModel: 'Wordsnap 수동 입력',
      aiGeneratedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || '',
      updatedAt: serverTimestamp(),
    });
    const homoNote = homophonesFilled > 0 ? ` · 동음이의어 ${homophonesFilled}건` : '';
    showToast(`✓ "${setName}" 저장됨 (${questions.length}단어${homoNote})`);
    ta.value = '';
    _qgWordsnapDraft = '';
    window._qgWordsnapUpdateStatus();
    _qsInvalidateCache();
    setTimeout(() => goPage('quiz-sets'), 400);
  } catch(e) {
    showToast('저장 실패: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
};

// ═══ 언스크램블 직접 입력 (한 줄 1 영문장 → AI 청크 분할 + 한글뜻) 2026-05-15 ═══
function _qgBuildUnscrambleSnapSection() {
  const bookNote = _qgActiveBook
    ? `<span style="color:#0a7a3a;font-weight:700;">✓ 저장 위치: ${esc(_qgActiveBook.name)}${_qgActiveChapter ? ' · ' + esc(_qgActiveChapter.name) : ''}</span>`
    : `<span style="color:#c33;">⚠ 좌측에서 Book 폴더를 먼저 선택하세요 (저장 위치 필수)</span>`;
  return `
    <div style="margin-top:14px;padding:12px;border:2px dashed var(--teal);border-radius:8px;background:var(--teal-light);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:6px;">
        <div style="font-size:11px;font-weight:700;color:var(--teal);">${iconSvg('clipboard')} 문장 직접 입력 · 언스크램블</div>
        <button class="btn btn-secondary" onclick="qgUnscrambleSnapPaste()"
          style="font-size:10px;padding:2px 8px;flex-shrink:0;">📥 붙여넣기</button>
      </div>
      <div style="font-size:10px;margin-bottom:6px;line-height:1.5;">${bookNote}</div>
      <div style="font-size:10px;color:var(--gray);margin-bottom:6px;line-height:1.5;">
        <b>한 줄에 영어 문장 하나</b>씩 입력. 입력 문장은 <b>변경 없이 그대로</b> 청크 분할 + 한글뜻 자동 생성됩니다.
      </div>
      <textarea id="qgUnscrambleSnapInput" rows="5" spellcheck="false"
        oninput="_qgUnscrambleSnapUpdateStatus()"
        placeholder="The boy picked up the ball.&#10;She has been studying English for three years.&#10;I would like to make a reservation."
        style="width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:4px;font-family:'Consolas','Malgun Gothic',monospace;font-size:11px;line-height:1.6;resize:vertical;box-sizing:border-box;">${esc(_qgUnscrambleSnapDraft)}</textarea>
      <div id="qgUnscrambleSnapStatus" style="font-size:10px;color:var(--gray);margin:6px 0 8px;min-height:14px;">입력 대기 중</div>
      <button class="btn btn-primary" onclick="qgRunUnscrambleSnap()" id="qgUnscrambleSnapBtn"
        style="width:100%;padding:9px;font-size:12px;font-weight:700;background:var(--teal);">
        📋 문장으로 언스크램블 생성
      </button>
    </div>
  `;
}

// 줄당 1 영문장 파싱 (빈 줄 스킵, 중복 제거). 반환: { sentences, errors }
function _qgParseSentences(text) {
  const lines = (text || '').split(/\r?\n/);
  const sentences = [];
  const errors = [];
  const seen = new Set();
  lines.forEach((line, i) => {
    const s = line.trim();
    if (!s) return;
    if (s.length < 3)   { errors.push({ line: i + 1, msg: '문장이 너무 짧음' }); return; }
    if (s.length > 400) { errors.push({ line: i + 1, msg: `문장 너무 김 (${s.length}자)` }); return; }
    const key = s.toLowerCase();
    if (seen.has(key)) { errors.push({ line: i + 1, msg: '중복 문장' }); return; }
    seen.add(key);
    sentences.push(s);
  });
  return { sentences, errors };
}

window._qgUnscrambleSnapUpdateStatus = () => {
  const ta = document.getElementById('qgUnscrambleSnapInput');
  const status = document.getElementById('qgUnscrambleSnapStatus');
  if (!ta || !status) return;
  _qgUnscrambleSnapDraft = ta.value;  // re-render 시 보존 (Book 클릭 등)
  if (!ta.value.trim()) { status.innerHTML = '입력 대기 중'; status.style.color = 'var(--gray)'; return; }
  const { sentences, errors } = _qgParseSentences(ta.value);
  const parts = [];
  if (sentences.length) parts.push(`<span style="color:#0a7a3a;font-weight:700;">✓ ${sentences.length}개 문장</span>`);
  if (errors.length)    parts.push(`<span style="color:#c33;">⚠ ${errors.length}줄 오류</span>`);
  status.innerHTML = parts.join(' · ') || '<span style="color:#c33;">파싱 결과 없음</span>';
};

window.qgUnscrambleSnapPaste = async () => {
  const ta = document.getElementById('qgUnscrambleSnapInput');
  if (!ta) return;
  try {
    const text = await navigator.clipboard.readText();
    ta.value = text || '';
    window._qgUnscrambleSnapUpdateStatus();
    ta.focus();
  } catch(e) {
    showToast('클립보드 읽기 실패 — textarea 에 직접 Ctrl+V 로 붙여넣으세요');
    ta.focus();
  }
};

window.qgRunUnscrambleSnap = async () => {
  const ta = document.getElementById('qgUnscrambleSnapInput');
  if (!ta) return;
  if (!_qgActiveBook) {
    showAlert('Book 선택 필요', '좌측에서 Book 폴더를 먼저 선택해야 저장됩니다. (저장 위치 지정 필수)');
    return;
  }
  const { sentences, errors } = _qgParseSentences(ta.value);
  if (sentences.length === 0) { showAlert('입력 확인', '입력된 문장이 없습니다 — 한 줄에 영어 문장 하나'); return; }

  const chunkCount = parseInt(_qgCollectOpts('unscramble').chunkCount) || 4;
  const errNote = errors.length ? `\n(오류 ${errors.length}줄 제외)` : '';
  const ok = await showConfirm(
    `${sentences.length}개 문장 → 언스크램블 생성?`,
    `입력 문장 원문 그대로 청크 ${chunkCount}개 분할 + 한글뜻 자동 생성합니다.${errNote}`
  );
  if (!ok) return;

  const btn = document.getElementById('qgUnscrambleSnapBtn');
  if (btn) btn.disabled = true;
  const status = document.getElementById('qgUnscrambleSnapStatus');
  if (status) status.innerHTML = `<span style="color:var(--gray);">${iconSvg('bot')} AI 청크 분할 + 한글뜻 생성 중... (5~15초)</span>`;

  try {
    const t0 = Date.now();
    const res = await _geminiFetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'unscramble-from-text', sentences, chunkCount }),
    });
    const data = await res.json();
    const sec = ((Date.now() - t0) / 1000).toFixed(1);

    if (!res.ok || !data.success) {
      if (data.rawSnippet) console.warn('[unscramble-from-text raw]', data.rawSnippet);
      if (status) status.innerHTML = `<span style="color:#c33;">❌ 실패 (${sec}s) — ${esc(data.error || 'unknown')}</span>`;
      showToast('생성 실패: ' + (data.error || 'unknown'));
      return;
    }

    _qgGenerated = data.questions || [];
    _qgExcluded.clear();
    if (status) status.innerHTML = `<span style="color:#0a7a3a;">✓ ${sec}s · ${_qgGenerated.length}/${sentences.length}문장</span>`;

    // 기존 언스크램블과 동일한 결과 미리보기 모달 (옵션 B)
    _qgShowResultModal({
      ...data,
      questions: _qgGenerated,
      defaultName: _qgBuildDefaultName(),
      _qgOpts: { type: 'unscramble', chunkCount },
    });
    ta.value = '';
    _qgUnscrambleSnapDraft = '';
    window._qgUnscrambleSnapUpdateStatus();
  } catch(e) {
    if (status) status.innerHTML = `<span style="color:#c33;">❌ 네트워크 에러</span>`;
    showToast('네트워크 에러: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
};

// ─── Vocab API 호출 (Phase 6) ───
async function _qgCallVocab(opts) {
  const btn = document.getElementById('qgGenBtn');
  const status = document.getElementById('qgStatus');
  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '🤖 AI 호출 중...<br><span style="font-size:10px;">5~15초 소요</span>';

  const selectedPages = (_genPages||[])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .map(p => ({ id: p.id, title: p.title||'', text: p.text||'' }));

  try {
    const t0 = Date.now();
    const res = await _geminiFetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pages: selectedPages,
        count: opts.count,
        type: 'vocab',
        difficulty: _qgMapDifficulty(opts.difficulty),
        customSystemPrompt: _qgGetCustomPrompt('vocab') || undefined,
      }),
    });
    const data = await res.json();
    const sec = ((Date.now()-t0)/1000).toFixed(1);

    if (!res.ok || !data.success) {
      if (data.rawSnippet) console.warn('[generate-quiz raw]', data.rawSnippet);
      if (status) status.innerHTML = `<span style="color:#c33;">❌ 실패 (${sec}s) — ${esc(data.error||'unknown')}</span>`;
      showToast('생성 실패: ' + (data.error||'unknown'));
      return;
    }

    _qgGenerated = data.questions || [];
    _qgExcluded.clear();
    // 문제 순서 섞기 — 인쇄/시험 출제 단계에서 처리 (생성 단계 X)

    if (status) status.innerHTML = `<span style="color:#0a7a3a;">✓ ${sec}s · ${_qgGenerated.length}/${data.requestedCount}문제</span>`;

    _qgShowResultModal({ ...data, questions: _qgGenerated, defaultName: _qgBuildDefaultName(), _qgOpts: opts });
  } catch(e) {
    if (status) status.innerHTML = `<span style="color:#c33;">❌ 네트워크 에러</span>`;
    showToast('네트워크 에러: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Unscramble API 호출 (Phase 6) ───
async function _qgCallUnscramble(opts) {
  const btn = document.getElementById('qgGenBtn');
  const status = document.getElementById('qgStatus');
  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '🤖 AI 호출 중...<br><span style="font-size:10px;">5~15초 소요</span>';

  const selectedPages = (_genPages||[])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .map(p => ({ id: p.id, title: p.title||'', text: p.text||'' }));

  try {
    const t0 = Date.now();
    const res = await _geminiFetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pages: selectedPages,
        count: opts.count,
        type: 'unscramble',
        difficulty: _qgMapDifficulty(opts.difficulty),
        chunkCount: parseInt(opts.chunkCount) || 4,
        customSystemPrompt: _qgGetCustomPrompt('unscramble') || undefined,
      }),
    });
    const data = await res.json();
    const sec = ((Date.now()-t0)/1000).toFixed(1);

    if (!res.ok || !data.success) {
      if (data.rawSnippet) console.warn('[generate-quiz raw]', data.rawSnippet);
      if (status) status.innerHTML = `<span style="color:#c33;">❌ 실패 (${sec}s) — ${esc(data.error||'unknown')}</span>`;
      showToast('생성 실패: ' + (data.error||'unknown'));
      return;
    }

    _qgGenerated = data.questions || [];
    _qgExcluded.clear();
    // 문제 순서 섞기 — 인쇄/시험 출제 단계에서 처리 (생성 단계 X)

    if (status) status.innerHTML = `<span style="color:#0a7a3a;">✓ ${sec}s · ${_qgGenerated.length}/${data.requestedCount}문제</span>`;

    _qgShowResultModal({ ...data, questions: _qgGenerated, defaultName: _qgBuildDefaultName(), _qgOpts: opts });
  } catch(e) {
    if (status) status.innerHTML = `<span style="color:#c33;">❌ 네트워크 에러</span>`;
    showToast('네트워크 에러: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// 세트 기본명: Book · Chapter · 유형 (Phase 6 공용)
function _qgBuildSetDefaultName(suffix) {
  const pageIds = [...new Set(_qgGenerated.map(q => q.sourcePageId).filter(Boolean))];
  const firstPage = pageIds.length ? (_genPages||[]).find(p => p.id === pageIds[0]) : null;
  if (!firstPage) return suffix || 'AI 문제 세트';
  const book = (_genBooks||[]).find(b => b.id === firstPage.bookId);
  const chapter = (_genChapters||[]).find(c => c.id === firstPage.chapterId);
  const parts = [book?.name, chapter?.name].filter(Boolean);
  return parts.join(' · ') + (suffix ? ' · ' + suffix : '');
}

// ─── 녹음숙제 로컬 생성기 (Phase 5.5) ───
// API 호출 없이 선택한 Page 의 전체 본문을 1문제로 구성. 3회 반복 녹음 전제.
function _qgBuildRecordingSet(opts) {
  if (_qgSelectedPageIds.size === 0) { showAlert('입력 확인', 'Page 를 선택하세요'); return; }

  const status = document.getElementById('qgStatus');
  if (status) status.innerHTML = '📝 문제 세트 구성 중...';

  // 정렬: page title 안 마지막 숫자 추출 (학원장이 직접 보는 라벨 기반).
  // 옛 코드는 chapterOrder/order(미박힘) → v635 serialNumber → 둘 다 부적합.
  // serialNumber 는 nextSerial 계산 결함으로 chapter 내 중복(1,2,1,2) 발생 →
  // 정렬 안정성 0. title 추출은 학원장 의도와 가장 일치 ("Page 1" → 1,
  // "CH1 본문 2" → 2, "예봉 중 3 본문 CH1" → 1).
  const _titleNum = (p) => {
    const m = String(p.title || '').match(/\d+/g);
    return m ? parseInt(m[m.length - 1]) : 0;
  };
  const pages = (_genPages || [])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .sort((a, b) => _titleNum(a) - _titleNum(b));

  if (pages.length === 0) {
    if (status) status.innerHTML = '<span style="color:#c33;">❌ Page 로드 실패</span>';
    return;
  }

  const firstPage = pages[0];
  const lastPage = pages[pages.length - 1];
  const book = (_genBooks||[]).find(b => b.id === firstPage.bookId);
  const chapter = (_genChapters||[]).find(c => c.id === firstPage.chapterId);
  const bookName = book?.name || '';
  const chapterName = chapter?.name || '';

  const fullText = pages
    .map(p => (p.text || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');

  if (fullText.length < 20) {
    showToast('선택한 Page 의 본문이 너무 짧습니다');
    if (status) status.innerHTML = '<span style="color:#c33;">❌ 본문 부족</span>';
    return;
  }

  const startSentence = _qgExtractFirstSentence((firstPage.text || '').trim());
  const endSentence = _qgExtractLastSentence((lastPage.text || '').trim());

  const instructionKo =
    `${firstPage.title || '첫 페이지'}「${startSentence}」부터 ` +
    `${lastPage.title || '마지막 페이지'}「${endSentence}」까지 ` +
    `실제 책을 보며 또렷하게 녹음하세요.`;

  const question = {
    type: 'recording',
    schemaV: 2,
    // roundsRequired 폐기 (2026-06-08) — 학생앱이 안 봄. recordingCount 만 사용
    // recordingCount 는 시험 배정 시 학원장 모달에서 박힘 (line 14983)
    pageCount: pages.length,
    startPageTitle: firstPage.title || '',
    startSentence,
    endPageTitle: lastPage.title || '',
    endSentence,
    fullText,
    instructionKo,
    questionKo: instructionKo,
    // accuracyThreshold·evaluationSeconds 는 더이상 문제 자체에 박지 않음.
    // 학원 default (academies.settings.recordingIntegrity) + 시험 배정 시 override 로 결정.
    // recordingCount 도 시험 배정 시 결정 (default 3).
    sourcePageId: firstPage.id,
    sourcePageTitle: firstPage.title || '',
    difficulty: 'medium',
  };

  const defaultSetName = [bookName, chapterName].filter(Boolean).join(' · ') || '녹음숙제';

  _qgGenerated = [question];
  _qgExcluded.clear();

  if (status) status.innerHTML = `<span style="color:#0a7a3a;">✓ 즉시 생성 · 1문제 · ${fullText.length}자</span>`;

  _qgShowResultModal({
    questions: _qgGenerated,
    model: '로컬 생성 (Page 기반)',
    requestedCount: 1,
    defaultName: defaultSetName,
  });
}

function _qgExtractFirstSentence(text) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  const match = clean.match(/^[^.!?]{5,200}[.!?]/);
  if (match) return match[0].trim().slice(0, 120);
  return clean.slice(0, 80);
}

function _qgExtractLastSentence(text) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length >= 5);
  if (sentences.length === 0) return clean.slice(-80);
  return sentences[sentences.length - 1].slice(0, 120);
}

// ─── 기본 세트 이름: Chapter · PageTitle 조합 ───
function _qgBuildDefaultName() {
  const pageIds = [...new Set(_qgGenerated.map(q => q.sourcePageId).filter(Boolean))];
  if (pageIds.length === 0) return 'AI 문제 세트';

  const pages = pageIds.map(pid => (_genPages||[]).find(p => p.id === pid)).filter(Boolean);
  if (pages.length === 0) return 'AI 문제 세트';

  if (pages.length === 1) {
    const p = pages[0];
    const chap = (_genChapters||[]).find(c => c.id === p.chapterId);
    const parts = [chap?.name, p.title].filter(Boolean);
    return parts.join(' · ') || 'AI 문제 세트';
  }

  const chapterIds = [...new Set(pages.map(p => p.chapterId).filter(Boolean))];
  if (chapterIds.length === 1) {
    const chap = (_genChapters||[]).find(c => c.id === chapterIds[0]);
    const firstTitle = pages[0]?.title || '';
    if (chap) return `${chap.name}${firstTitle ? ' · ' + firstTitle : ''} 외 ${pages.length - 1}`;
  }
  return `${pages[0].title || 'AI 문제 세트'} 외 ${pages.length - 1}`;
}

// ─── 결과 모달 (Phase 2.5) ───
function _qgShowResultModal(data) {
  if (!_qgGenerated.length) { showAlert('입력 확인', 'AI가 문제를 생성하지 못했습니다. 본문이 너무 짧거나 부적절할 수 있습니다.'); return; }
  _qgModel = data.model || '';

  const defaultName = data.defaultName || _qgBuildDefaultName();

  const html = `
    <div style="width:min(820px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div style="min-width:0;flex:1;">
            <div style="font-size:17px;font-weight:700;line-height:1.3;">🎯 AI 생성 결과 미리보기</div>
            <div style="font-size:11px;color:var(--gray);margin-top:5px;">
              제외할 문제는 체크박스 해제 · 모델: <code>${esc(data.model||'')}</code> · 선택 <span id="qgIncludeCount">${_qgGenerated.length}</span> / ${_qgGenerated.length}
            </div>
          </div>
          <button onclick="qgDiscardModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--gray);flex-shrink:0;">${iconSvg('x')}</button>
        </div>
      </div>

      <div style="padding:14px 22px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <label style="font-size:12px;color:var(--gray);display:block;margin-bottom:6px;font-weight:600;">세트 이름</label>
        <input type="text" id="qgSetName" value="${esc(defaultName)}" placeholder="예: Lesson 3 - 객관식 5문제"
          style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;">
      </div>

      <div style="padding:16px 22px;flex:1;overflow-y:auto;">
        <div id="qgResultList">
          ${_qgGenerated.map((q,i) => _qgRenderQuestion(q,i)).join('')}
        </div>
      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="qgDiscardModal()">버리기</button>
        <button class="btn btn-primary" onclick="qgSaveSet()">${iconSvg('save')} 문제 세트로 저장</button>
      </div>
    </div>
  `;
  showModal(html);
}

function _qgRenderQuestion(q, idx) {
  const excluded = _qgExcluded.has(idx);
  const diffLabel = {easy:'쉬움',medium:'보통',hard:'어려움'}[q.difficulty] || q.difficulty;
  const diffColor = {easy:'#2e7d32',medium:'#e65100',hard:'#c62828'}[q.difficulty] || '#888';
  const diffBg = {easy:'#e8f5e9',medium:'#fff3e0',hard:'#ffebee'}[q.difficulty] || '#f5f5f5';

  let body = '';
  if (q.type === 'fill_blank') {
    const parts = (q.sentence||'').split('___');
    let sentHtml = '';
    for (let i = 0; i < parts.length; i++) {
      sentHtml += esc(parts[i]);
      if (i < parts.length - 1) {
        const ans = q.blanks?.[i] || '';
        sentHtml += `<span style="display:inline-block;min-width:50px;padding:1px 8px;margin:0 2px;border-bottom:2px solid #4caf50;background:#e8f5e9;color:#2e7d32;font-weight:700;font-size:12px;">${esc(ans)}</span>`;
      }
    }
    body = `
      <div style="font-size:14px;line-height:1.8;margin-bottom:6px;">${sentHtml}</div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:8px;">${esc(q.questionKo||'')}</div>
      <div style="font-size:11px;color:#666;background:#f5f5f5;padding:5px 10px;border-radius:4px;">정답 ${(q.blanks||[]).length}개: ${(q.blanks||[]).map(b => `<code style="background:#fff;padding:1px 6px;border-radius:3px;color:#2e7d32;font-weight:700;">${esc(b)}</code>`).join(' · ')}</div>
    `;
  } else if (q.type === 'subjective') {
    body = `
      <div style="font-size:14px;line-height:1.6;margin-bottom:8px;padding:10px 14px;background:#f8f9fa;border-left:3px solid var(--teal);">${esc(q.sentence)}</div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">${esc(q.questionKo||'')}</div>
      <div style="font-size:12px;color:#2e7d32;background:#e8f5e9;padding:8px 12px;border-radius:6px;">
        <div style="font-size:10px;font-weight:700;color:#2e7d32;margin-bottom:3px;">모범 답안 (교사용)</div>
        ${q.sampleAnswerKo ? esc(q.sampleAnswerKo) : '<span style="color:#999;font-style:italic;">(답안 없음 — 시험지에 빈 답란만 표시)</span>'}
      </div>
    `;
  } else if (q.type === 'recording' && q.schemaV === 2) {
    const preview = (q.fullText || '').slice(0, 240) + ((q.fullText||'').length > 240 ? '…' : '');
    body = `
      <div style="font-size:11px;color:#CA8A04;font-weight:700;margin-bottom:5px;">${iconSvg('mic')} Page 단위 녹음숙제</div>
      <div style="font-size:12px;color:var(--text);padding:8px 12px;background:#fefce8;border-left:3px solid #CA8A04;margin-bottom:8px;">${esc(q.instructionKo || '')}</div>
      <div style="font-size:13px;line-height:1.6;padding:10px 14px;background:#f5f5f5;border-radius:6px;color:#444;margin-bottom:6px;">${esc(preview)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:11px;">
        <span style="background:#e0f2fe;padding:3px 10px;border-radius:10px;color:#0369a1;font-weight:600;">📄 ${q.pageCount||1} Page</span>
        <span style="font-size:10px;color:var(--gray);">⚙️ 통과점수·평가시간·녹음횟수는 시험 배정 시 설정</span>
      </div>
    `;
  } else if (q.type === 'recording') {
    body = `
      <div style="font-size:11px;color:#7C3AED;font-weight:700;margin-bottom:5px;">${iconSvg('mic')} 녹음 대상 문장</div>
      <div style="font-size:14px;line-height:1.7;padding:10px 14px;background:#F5F3FF;border-left:3px solid #8B5CF6;margin-bottom:6px;">${esc(q.sentence)}</div>
      <div style="font-size:12px;color:var(--gray);">${esc(q.questionKo||'')}</div>
    `;
  } else if (q.type === 'vocab') {
    body = `
      <div style="font-size:11px;color:#0ea5e9;font-weight:700;margin-bottom:5px;">${iconSvg('pen')} 단어</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px;">
        <div style="padding:8px 12px;background:#f0f9ff;border-radius:6px;">
          <div style="font-size:10px;color:#64748b;margin-bottom:2px;">영단어</div>
          <div style="font-size:15px;font-weight:700;color:#0c4a6e;">${esc(q.word)}</div>
        </div>
        <div style="padding:8px 12px;background:#fef3c7;border-radius:6px;">
          <div style="font-size:10px;color:#92400e;margin-bottom:2px;">뜻</div>
          <div style="font-size:14px;font-weight:600;color:#78350f;">${esc(q.meaning)}</div>
        </div>
      </div>
      ${q.example ? `
        <div style="font-size:11px;color:#64748b;padding:6px 10px;background:#f9fafb;border-left:2px solid #d1d5db;margin-top:4px;">
          <em>${esc(q.example)}</em>
          ${q.exampleKo ? `<div style="color:#6b7280;margin-top:3px;">↳ ${esc(q.exampleKo)}</div>` : ''}
        </div>` : ''}
    `;
  } else if (q.type === 'unscramble') {
    const chunks = (q.chunkedSentence || '').split('/').map(s => s.trim()).filter(Boolean);
    body = `
      <div style="font-size:11px;color:#7c3aed;font-weight:700;margin-bottom:5px;">🔀 언스크램블 (${chunks.length}청크)</div>
      <div style="margin-bottom:6px;">
        <div style="font-size:10px;color:var(--gray);margin-bottom:3px;">한글 뜻</div>
        <input type="text" value="${esc(q.meaningKo)}"
          onchange="_qgEditUnscrambleMeaning(${idx}, this.value)"
          style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;">
      </div>
      <div style="margin-bottom:6px;">
        <div style="font-size:10px;color:var(--gray);margin-bottom:3px;">영문 ('/' 로 청크 구분)</div>
        <input type="text" value="${esc(q.chunkedSentence)}"
          onchange="_qgEditUnscrambleChunks(${idx}, this.value)"
          oninput="_qgPreviewUnscrambleChunks(${idx}, this.value)"
          style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:monospace;">
      </div>
      <div id="qgUnscPreview_${idx}" style="padding:8px 10px;background:#faf5ff;border-radius:4px;">
        <div style="font-size:10px;color:var(--gray);margin-bottom:4px;">청크 미리보기 (${chunks.length}개)</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${chunks.map(c => `<span style="padding:3px 8px;background:white;border:1px solid #e9d5ff;border-radius:4px;font-size:12px;color:#6b21a8;">${esc(c)}</span>`).join('')}
        </div>
        <div style="font-size:10px;color:var(--gray);margin-top:4px;">${iconSvg('pen')} 완성: ${esc(chunks.join(' '))}</div>
      </div>
    `;
  } else {
    body = `
      <div style="font-size:14px;font-weight:600;margin-bottom:4px;">${esc(q.question)}</div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:8px;">${esc(q.questionKo)}</div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        ${(q.choices||[]).map((c,j) => `
          <div style="padding:6px 10px;border-radius:4px;font-size:12px;${c.isAnswer?'background:#e8f5e9;border:1px solid #4caf50;font-weight:600;':'background:#f5f5f5;'}">
            ${['①','②','③','④'][j]} ${esc(c.text)}${c.isAnswer?' ✓':''}
          </div>
        `).join('')}
      </div>
    `;
  }

  const typeIcon = q.type==='fill_blank' ? '✏️' : q.type==='subjective' ? '✍️' : q.type==='recording' ? '🎤' : q.type==='vocab' ? '📝' : q.type==='unscramble' ? '🔀' : '📖';
  return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;${excluded?'opacity:0.35;background:#fafafa;':''}">
    <div style="display:flex;gap:10px;align-items:start;">
      <input type="checkbox" ${excluded?'':'checked'} onchange="qgToggleExclude(${idx})" style="margin-top:3px;">
      <div style="flex:1;">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:4px;">
          <div style="font-size:12px;font-weight:700;color:var(--gray);">${idx+1}. ${typeIcon}</div>
          <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${diffBg};color:${diffColor};font-weight:600;margin-left:8px;flex-shrink:0;">${esc(diffLabel)}</span>
        </div>
        ${body}
        ${q.explanation?`<div style="font-size:11px;color:#666;margin-top:6px;background:#fff8e1;padding:6px 8px;border-left:2px solid #ffc107;">${iconSvg('lightbulb')} ${esc(q.explanation)}</div>`:''}
        <div style="font-size:10px;color:#aaa;margin-top:6px;font-family:monospace;">출처: ${esc(q.sourcePageTitle||q.sourcePageId)}</div>
      </div>
    </div>
  </div>`;
}

window.qgToggleExclude = (idx) => {
  if (_qgExcluded.has(idx)) _qgExcluded.delete(idx);
  else _qgExcluded.add(idx);
  const el = document.getElementById('qgIncludeCount');
  if (el) el.textContent = _qgGenerated.length - _qgExcluded.size;
  const listEl = document.getElementById('qgResultList');
  if (listEl) {
    listEl.innerHTML = _qgGenerated.map((q,i) => _qgRenderQuestion(q,i)).join('');
  }
};

window.qgDiscardModal = async () => {
  if (_qgGenerated.length > 0 && _qgExcluded.size < _qgGenerated.length) {
    if (!(await showConfirm('생성 결과를 버리시겠어요?', '저장되지 않은 문제가 모두 사라집니다.'))) return;
  }
  _qgGenerated = [];
  _qgExcluded.clear();
  closeModal();
};

window.qgSaveSet = async () => {
  const nameInput = document.getElementById('qgSetName');
  const name = (nameInput?.value || '').trim();
  if (!name) {
    showAlert('입력 확인', '세트 이름을 입력하세요');
    nameInput?.focus();
    return;
  }

  // 제외된 문제 필터링
  const finalQuestions = _qgGenerated.filter((_, i) => !_qgExcluded.has(i));
  if (finalQuestions.length === 0) { showAlert('입력 확인', '저장할 문제가 하나도 없습니다'); return; }

  if (!(await showConfirm(`"${name}" 세트 저장`, `${finalQuestions.length}개 문제를 저장합니다.`))) return;

  // 출처 페이지 메타데이터 (세트에서 참조)
  let sourcePages = [...new Set(finalQuestions.map(q => q.sourcePageId))]
    .map(pid => {
      const p = _genPages.find(pp => pp.id === pid);
      if (!p) return { pageId: pid, pageTitle: '', bookId: '', chapterId: '' };
      return {
        pageId: p.id,
        pageTitle: p.title || '',
        bookId: p.bookId || '',
        chapterId: p.chapterId || '',
      };
    });
  // 직접 입력 (sourcePageId 전부 빈값 — 언스크램블 문장 직접 입력 등) → 활성 Book fallback
  const allEmpty = sourcePages.every(sp => !sp.bookId && !sp.pageId);
  if (allEmpty && (_qgActiveBook || _qgActiveChapter)) {
    sourcePages = [{
      pageId: '',
      pageTitle: '직접 입력',
      bookId: _qgActiveBook?.id || '',
      chapterId: _qgActiveChapter?.id || '',
    }];
  }

  // 단어시험 / Wordsnap — 한글·특수문자 포함 단어 검증 게이트
  // (학생 답안 입력 단계의 한글 입력 제한·특수문자 처리 문제 회피)
  if (finalQuestions[0]?.type === 'vocab' || finalQuestions[0]?.type === 'word') {
    const gateResult = await _qsCharsGate(finalQuestions);
    if (!gateResult.proceed) return;  // 사용자 취소
    if (finalQuestions.length === 0) {
      showAlert('저장 불가', '모든 단어를 삭제해 저장할 문제가 없습니다');
      return;
    }
  }

  // subjective 모드 메타 — validateSubjective 가 각 q.subjectiveMode 박음 (paraphrase/verbatim)
  // 세트 단위 메타로도 박음 (목록 표시·필터링용)
  const subjectiveMode = finalQuestions[0]?.type === 'subjective'
    ? (finalQuestions[0]?.subjectiveMode || 'paraphrase')
    : null;

  try {
    await addDoc(collection(db,'genQuestionSets'), {
      name,
      academyId: window.MY_ACADEMY_ID || 'default',
      sourceType: finalQuestions[0]?.type || 'mcq',
      sourcePages,
      bookId: _qsPrimaryBookId({ sourcePages }) === _QS_UNASSIGNED ? '' : _qsPrimaryBookId({ sourcePages }),
      questions: finalQuestions,
      questionCount: finalQuestions.length,
      aiModel: _qgModel || 'unknown',
      aiGeneratedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || '',
      updatedAt: serverTimestamp(),
      ...(subjectiveMode ? { subjectiveMode } : {}),
    });
    showToast(`✓ "${name}" 저장됨 (${finalQuestions.length}문제)`);
    _qgGenerated = [];
    _qgExcluded.clear();
    closeModal();
    _qsInvalidateCache();
    setTimeout(() => goPage('quiz-sets'), 300);
  } catch(e) {
    showToast('저장 실패: '+e.message);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// [Page 2] 문제 세트 목록 (genQuestionSets CRUD)
// ═══════════════════════════════════════════════════════════════════════════

window.loadQuestionSets = async () => {
  try {
    _qsLoadPrefs();
    // 진입 시 Books 만 fetch (폴더 목록만 표시) — 세트는 Book 클릭 시 lazy
    const bookSnap = await getDocs(query(
      collection(db,'genBooks'),
      where('academyId','==',window.MY_ACADEMY_ID),
      orderBy('createdAt','asc')
    ));
    _qsBooks = bookSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    // 첫 진입 시 캐시 초기화 (재진입은 캐시 유지)
    if (!_qsSetsByBook.__initialized) {
      _qsList = [];
      _qsSetsByBook = { __initialized: true };
    }
    // 진입 시 활성 Book 복원 폐기 — 항상 미선택 상태로 시작
    // (set pane 은 'Book 폴더를 클릭하세요' placeholder)
    _qsActiveBookId = null;
    _qsRenderList();
    // 상단 pane 용 '최근 20' 만 fetch — Book 폴더 세트는 사용자가 클릭해야 fetch
    await _qsLazyFetch(null);
    _qsRenderList();
  } catch(e) {
    showToast('세트 목록 로드 실패: '+e.message);
  }
};

// ─── Book 별 lazy fetch + 캐시 ───
// bid=null → "전체 최근 20" / bid===_QS_UNASSIGNED → 미지정 / 그 외 → 특정 Book
async function _qsLazyFetch(bid) {
  const cacheKey = bid == null ? '__all_recent__' : bid;
  if (_qsSetsByBook[cacheKey]) return; // 캐시 hit
  if (_qsLoadingBook === cacheKey) return; // 중복 클릭
  _qsLoadingBook = cacheKey;
  try {
    let q;
    if (bid == null) {
      // 전체 최근 20개
      q = query(
        collection(db,'genQuestionSets'),
        where('academyId','==',window.MY_ACADEMY_ID),
        orderBy('createdAt','desc'),
        limit(_QS_RECENT_LIMIT)
      );
    } else if (bid === _QS_UNASSIGNED) {
      q = query(
        collection(db,'genQuestionSets'),
        where('academyId','==',window.MY_ACADEMY_ID),
        where('bookId','==',''),
        orderBy('createdAt','desc')
      );
    } else {
      q = query(
        collection(db,'genQuestionSets'),
        where('academyId','==',window.MY_ACADEMY_ID),
        where('bookId','==',bid),
        orderBy('createdAt','desc')
      );
    }
    const snap = await getDocs(q);
    const sets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _qsSetsByBook[cacheKey] = sets;
    // _qsList 에 dedup merge — 최근 생성·기타 뷰 통합 데이터
    const seen = new Set(_qsList.map(s => s.id));
    sets.forEach(s => { if (!seen.has(s.id)) _qsList.push(s); });
  } catch(e) {
    showToast('세트 조회 실패: ' + e.message);
  } finally {
    _qsLoadingBook = null;
  }
}

// 캐시 무효화 (저장·삭제·이름변경 후 호출) — quiz-sets 페이지 + 시험관리 페이지 둘 다 무효화
function _qsInvalidateCache() {
  _qsList = [];
  _qsSetsByBook = {};
  if (typeof _tpInvalidateSetsCache === 'function') _tpInvalidateSetsCache();
}

// ─── prefs 로드/저장 ───
function _qsLoadPrefs() {
  const v = parseFloat(localStorage.getItem('qs_layout_v'));
  if (!isNaN(v) && v >= 15 && v <= 85) _qsSplitV = v;
  const h = parseFloat(localStorage.getItem('qs_layout_h'));
  if (!isNaN(h) && h >= 15 && h <= 70) _qsSplitH = h;
  try { _qsFavSets = new Set(JSON.parse(localStorage.getItem('qs_fav_sets')||'[]')); } catch { _qsFavSets = new Set(); }
  try { _qsFavBooks = new Set(JSON.parse(localStorage.getItem('qs_fav_books')||'[]')); } catch { _qsFavBooks = new Set(); }
  _qsActiveBookId = localStorage.getItem('qs_active_book') || null;
  try { const t = JSON.parse(localStorage.getItem('qs_sort_top')||'null'); if (t?.col) _qsSortTop = t; } catch {}
  try { const b = JSON.parse(localStorage.getItem('qs_sort_bottom')||'null'); if (b?.col) _qsSortBottom = b; } catch {}
  try {
    const w = JSON.parse(localStorage.getItem('qs_col_widths')||'null');
    if (w && typeof w === 'object') _qsColWidths = Object.assign({ top:{}, bottom:{} }, w);
  } catch {}
}

function _qsColW(tableKey, col) {
  return (_qsColWidths[tableKey]?.[col]) || _QS_COL_DEFAULTS[tableKey][col] || 80;
}
function _qsSavePrefs() {
  localStorage.setItem('qs_layout_v', String(_qsSplitV));
  localStorage.setItem('qs_layout_h', String(_qsSplitH));
  localStorage.setItem('qs_fav_sets', JSON.stringify([..._qsFavSets]));
  localStorage.setItem('qs_fav_books', JSON.stringify([..._qsFavBooks]));
  if (_qsActiveBookId) localStorage.setItem('qs_active_book', _qsActiveBookId);
  else localStorage.removeItem('qs_active_book');
  localStorage.setItem('qs_sort_top', JSON.stringify(_qsSortTop));
  localStorage.setItem('qs_sort_bottom', JSON.stringify(_qsSortBottom));
}

// ─── 데이터 헬퍼 ───
function _qsPrimaryBookId(s) {
  // top-level bookId 우선 (마이그레이션 + 신규 addDoc 모두 stamp)
  if (typeof s.bookId === 'string') return s.bookId || _QS_UNASSIGNED;
  // sourcePages 최빈값 폴백 (옛 데이터·미마이그레이션 안전망)
  const ids = (s.sourcePages||[]).map(p => p.bookId).filter(Boolean);
  if (!ids.length) return _QS_UNASSIGNED;
  const counts = {};
  ids.forEach(id => counts[id] = (counts[id]||0) + 1);
  return Object.entries(counts).sort((a,b) => b[1]-a[1])[0][0];
}
function _qsBookName(bookId) {
  if (bookId === _QS_UNASSIGNED) return '미지정';
  const b = _qsBooks.find(x => x.id === bookId);
  return b?.name || '(알 수 없는 Book)';
}
// 통합 유형 라벨 맵 (표준 snake_case 키 + UI 별칭 일부)
const _TYPE_LABEL_MAP = {
  vocab:'단어',
  fill_blank:'빈칸',
  unscramble:'언스크램블',
  mcq:'객관식',
  subjective:'주관식',
  recording:'녹음',
  // _TEST_TYPE_CONFIG UI 키 별칭 (관리자앱 내부 접근 시 필요)
  blank:'빈칸', subj:'주관식', 'rec-ai':'녹음',
};
function _qsTypeLabel(t) {
  if (!t) return '-';
  return _TYPE_LABEL_MAP[t] || _TYPE_LABEL_MAP[String(t).toLowerCase()] || '-';
}
function _unifiedTypeBadge(t) {
  return `<span class="badge" style="background:#e3f2fd;color:#1565c0;font-size:11px;padding:2px 7px;border-radius:10px;">${_qsTypeLabel(t)}</span>`;
}
function _qsModelShort(m) {
  return (m||'').replace('gemini-','').replace('-preview','');
}
function _qsDateMs(s) {
  const d = s.createdAt?.toDate?.(); return d ? d.getTime() : 0;
}
function _qsDateStr(s) {
  const d = s.createdAt?.toDate?.();
  return d ? d.toLocaleString('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-';
}
function _qsSortSets(list, sort) {
  const arr = [...list];
  const { col, dir } = sort;
  const mul = dir === 'asc' ? 1 : -1;
  arr.sort((a,b) => {
    // 즐겨찾기 먼저
    const fa = _qsFavSets.has(a.id) ? 0 : 1;
    const fb = _qsFavSets.has(b.id) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    let av, bv;
    if (col === 'name') { av = (a.name||'').toLowerCase(); bv = (b.name||'').toLowerCase(); return av.localeCompare(bv, 'ko') * mul; }
    if (col === 'type') { av = _qsTypeLabel(a.sourceType); bv = _qsTypeLabel(b.sourceType); return av.localeCompare(bv, 'ko') * mul; }
    // createdAt
    av = _qsDateMs(a); bv = _qsDateMs(b);
    return (av - bv) * mul;
  });
  return arr;
}

// ─── 메인 렌더 (상/하 + 좌/우) ───
function _qsRenderList() {
  const root = document.getElementById('quizSetsRoot');
  if (!root) return;

  // 책도 세트도 없는 학원 → 폐기 안내 (lazy fetch 끝난 후 판정)
  const recentCache = _qsSetsByBook['__all_recent__'];
  const isReallyEmpty = _qsBooks.length === 0 && Array.isArray(recentCache) && recentCache.length === 0;
  if (isReallyEmpty) {
    root.innerHTML = `
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:40px;text-align:center;color:var(--gray);">
        <div style="font-size:32px;margin-bottom:10px;">📭</div>
        <div style="font-size:14px;margin-bottom:6px;">저장된 문제 세트가 없습니다</div>
        <div style="font-size:12px;">'AI Generator' 메뉴에서 새 세트를 만들어보세요</div>
        <button class="btn btn-primary" style="margin-top:16px;" onclick="goPage('quiz-generate')">✨ AI Generator 바로가기</button>
      </div>`;
    return;
  }

  root.innerHTML = `
    <div id="qsContainer" style="display:flex;flex-direction:column;height:calc(100vh - 180px);min-height:500px;gap:0;">
      <div id="qsTopPane" style="flex:0 0 ${_qsSplitV}%;min-height:150px;overflow:hidden;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;">
        ${_qsRenderTopPane()}
      </div>
      <div id="qsResizerV" style="height:6px;flex-shrink:0;cursor:row-resize;background:var(--border);margin:4px 0;border-radius:3px;transition:background .15s;" title="상하 크기 조절"></div>
      <div id="qsBottomPane" style="flex:1;min-height:200px;display:flex;gap:0;overflow:hidden;">
        <div id="qsBookPane" style="flex:0 0 ${_qsSplitH}%;min-width:160px;overflow:hidden;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;">
          ${_qsRenderBookPane()}
        </div>
        <div id="qsResizerH" style="width:6px;flex-shrink:0;cursor:col-resize;background:var(--border);margin:0 4px;border-radius:3px;transition:background .15s;" title="좌우 크기 조절"></div>
        <div id="qsSetPane" style="flex:1;min-width:200px;overflow:hidden;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;">
          ${_qsRenderSetPane()}
        </div>
      </div>
    </div>
  `;
  _qsAttachResizers();
}

// ─── <th> 렌더 헬퍼 (폭 + 리사이즈 핸들 + 선택적 정렬) ───
function _qsTh(tableKey, col, label, opts = {}) {
  const w = _qsColW(tableKey, col);
  const sortable = opts.sortable;
  const sortState = tableKey === 'top' ? _qsSortTop : _qsSortBottom;
  const sortFn = tableKey === 'top' ? 'qsSortTop' : 'qsSortBottom';
  const arrow = sortable ? _qsSortArrow(col, sortState) + ' ' : '';
  const align = opts.center ? 'text-align:center;' : '';
  const cursor = sortable ? 'cursor:pointer;' : '';
  const click = sortable ? `onclick="${sortFn}('${col}')"` : '';
  return `<th data-table="${tableKey}" data-col="${col}" style="width:${w}px;position:relative;${align}${cursor}user-select:none;border-right:1px solid var(--border);" ${click}>${arrow}${esc(label)}<span class="qs-col-resize" style="position:absolute;right:-4px;top:0;width:9px;height:100%;cursor:col-resize;user-select:none;z-index:2;"></span></th>`;
}

// ─── 상단: 최근 20개 테이블 ───
function _qsRenderTopPane() {
  const recentCache = _qsSetsByBook['__all_recent__'];
  const loaded = Array.isArray(recentCache);
  const recent = loaded ? _qsSortSets(recentCache.slice(0, _QS_RECENT_LIMIT), _qsSortTop) : [];
  const totalLabel = loaded ? `${_qsList.length}개+` : '...';
  const body = loaded
    ? `<table class="data-table" style="width:max-content;table-layout:fixed;font-size:12px;">
        <thead style="position:sticky;top:0;background:#fafafa;z-index:1;">
          <tr>
            ${_qsTh('top','fav','',{center:true})}
            ${_qsTh('top','name','세트 이름',{sortable:true})}
            ${_qsTh('top','type','유형',{sortable:true,center:true})}
            ${_qsTh('top','count','문제수',{center:true})}
            ${_qsTh('top','book','Book')}
            ${_qsTh('top','date','생성일',{sortable:true})}
            ${_qsTh('top','act','작업',{center:true})}
          </tr>
        </thead>
        <tbody>${recent.map(s => _qsRenderRow(s, 'top')).join('')}</tbody>
      </table>`
    : `<div style="padding:24px;text-align:center;color:#bbb;font-size:12px;">불러오는 중...</div>`;
  return `
    <div style="padding:10px 14px;border-bottom:1px solid var(--border);background:#f8f9fa;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <span>🕘 최근 생성 <span style="font-weight:400;color:var(--gray);font-size:11px;">(최근 ${_QS_RECENT_LIMIT}개)</span></span>
      <span style="font-size:11px;color:var(--gray);font-weight:400;">로드 ${totalLabel}</span>
    </div>
    <div style="flex:1;overflow:auto;">${body}</div>
  `;
}

// ─── 하단 왼쪽: Book 폴더 리스트 ───
function _qsRenderBookPane() {
  // _qsBooks 기반 폴더 항목 구성 (lazy — 폴더는 항상 표시, count 만 캐시 hit 시 채움)
  const items = _qsBooks.map(b => ({
    id: b.id,
    name: b.name || '(이름 없음)',
    count: Array.isArray(_qsSetsByBook[b.id]) ? _qsSetsByBook[b.id].length : null,
    fav: _qsFavBooks.has(b.id),
    isUnassigned: false,
  }));
  // 미지정 폴더 — 항상 표시 (캐시 hit 시 count 채움, 미스면 ? · 클릭 시 lazy fetch)
  const unassignedCache = _qsSetsByBook[_QS_UNASSIGNED];
  items.push({
    id: _QS_UNASSIGNED, name: '미지정',
    count: Array.isArray(unassignedCache) ? unassignedCache.length : null,
    fav: _qsFavBooks.has(_QS_UNASSIGNED),
    isUnassigned: true,
  });
  // 정렬: 즐겨찾기 먼저 → 이름 순 → 미지정은 맨 마지막
  items.sort((a,b) => {
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
    if (a.fav !== b.fav) return a.fav ? -1 : 1;
    return a.name.localeCompare(b.name, 'ko');
  });

  // ("전체" 가상 폴더는 폐기 — 최근 20개는 상단 pane 이 표시)
  const rows = items.map(it => {
    const active = _qsActiveBookId === it.id;
    const loading = _qsLoadingBook === it.id;
    const cntLabel = loading ? '…' : (it.count == null ? '?' : it.count);
    return `
    <div onclick="qsSelectBook('${esc(it.id)}')" style="padding:8px 12px;border-bottom:1px solid #f0f0f0;cursor:pointer;background:${active?'var(--teal-light)':''};display:flex;align-items:center;gap:8px;">
      <span onclick="event.stopPropagation();qsToggleFavBook('${esc(it.id)}')" style="cursor:pointer;font-size:14px;color:${it.fav?'#f0b000':'#ccc'};" title="즐겨찾기">${it.fav?'★':'☆'}</span>
      <span style="font-size:14px;">📁</span>
      <div style="flex:1;font-weight:${it.fav?700:600};font-size:13px;color:${active?'var(--teal)':'var(--text)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(it.name)}">${esc(it.name)}</div>
      <span style="font-size:11px;color:var(--gray);">${cntLabel}</span>
    </div>`;
  }).join('');

  return `
    <div style="padding:10px 14px;border-bottom:1px solid var(--border);background:#f8f9fa;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <span>📁 Book 폴더</span>
      <span style="font-size:11px;color:var(--gray);font-weight:400;">${items.length}개</span>
    </div>
    <div style="flex:1;overflow:auto;">
      ${rows || '<div style="padding:20px;text-align:center;color:#bbb;font-size:12px;">폴더가 없습니다</div>'}
    </div>
  `;
}

// ─── 하단 오른쪽: 선택된 Book 의 세트 리스트 ───
function _qsRenderSetPane() {
  // active 가 null 이면 미선택 placeholder (상단 pane 이 '최근 20' 역할)
  if (_qsActiveBookId == null) {
    return `
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);background:#f8f9fa;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <span>${iconSvg('clipboard')} Book 폴더 선택</span>
      </div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:13px;">
        ← 좌측에서 Book 폴더를 클릭하세요
      </div>
    `;
  }
  const cacheKey = _qsActiveBookId;
  const cache = _qsSetsByBook[cacheKey];
  const loaded = Array.isArray(cache);
  const loading = _qsLoadingBook === cacheKey;
  const bookLabel = _qsBookName(_qsActiveBookId);

  let body;
  if (loading && !loaded) {
    body = `<div style="padding:24px;text-align:center;color:#bbb;font-size:12px;">불러오는 중...</div>`;
  } else if (!loaded) {
    body = `<div style="padding:24px;text-align:center;color:#bbb;font-size:12px;">Book 폴더를 선택하세요</div>`;
  } else {
    const sorted = _qsSortSets(cache, _qsSortBottom);
    if (sorted.length === 0) {
      body = `<div style="padding:24px;text-align:center;color:#bbb;font-size:12px;">이 폴더에 세트가 없습니다</div>`;
    } else {
      body = `<table class="data-table" style="width:max-content;table-layout:fixed;font-size:12px;">
        <thead style="position:sticky;top:0;background:#fafafa;z-index:1;">
          <tr>
            ${_qsTh('bottom','fav','',{center:true})}
            ${_qsTh('bottom','name','세트 이름',{sortable:true})}
            ${_qsTh('bottom','type','유형',{sortable:true,center:true})}
            ${_qsTh('bottom','count','문제수',{center:true})}
            ${_qsTh('bottom','date','생성일',{sortable:true})}
            ${_qsTh('bottom','act','작업',{center:true})}
          </tr>
        </thead>
        <tbody>${sorted.map(s => _qsRenderRow(s, 'bottom')).join('')}</tbody>
      </table>`;
    }
  }
  const cntLabel = loaded ? `세트 ${cache.length}개` : (loading ? '로딩...' : '미로드');

  return `
    <div style="padding:10px 14px;border-bottom:1px solid var(--border);background:#f8f9fa;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <span>${iconSvg('clipboard')} ${esc(bookLabel)} · <span style="font-weight:400;color:var(--gray);font-size:11px;">${cntLabel}</span></span>
    </div>
    <div style="flex:1;overflow:auto;">${body}</div>
  `;
}

function _qsRenderRow(s, where) {
  const fav = _qsFavSets.has(s.id);
  const bookId = _qsPrimaryBookId(s);
  const bookCell = where === 'top'
    ? `<td class="td-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(_qsBookName(bookId))}</td>`
    : '';
  return `<tr>
    <td style="text-align:center;">
      <span onclick="qsToggleFavSet('${esc(s.id)}')" style="cursor:pointer;font-size:14px;color:${fav?'#f0b000':'#ccc'};" title="즐겨찾기">${fav?'★':'☆'}</span>
    </td>
    <td class="td-link" onclick="qsViewDetail('${esc(s.id)}')" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:${fav?700:600};" title="${esc(s.name||'')}">${esc(s.name||'(이름 없음)')}</td>
    <td class="td-center"><span class="badge" style="background:#e3f2fd;color:#1565c0;font-size:11px;padding:2px 7px;border-radius:10px;">${esc(_qsTypeLabel(s.sourceType))}</span></td>
    <td class="td-center td-main">${s.questionCount||s.questions?.length||0}</td>
    ${bookCell}
    <td class="td-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(_qsDateStr(s))}</td>
    <td class="td-center">
      <button class="action-btn" onclick="qsAssignSet('${esc(s.id)}')" style="font-size:11px;padding:3px 8px;background:#e8f5e9;color:#2e7d32;border-color:#c8e6c9;">시험출제</button>
      <button class="action-btn danger" onclick="qsDeleteSet('${esc(s.id)}')" style="font-size:11px;padding:3px 8px;">${iconSvg('trash')} 삭제</button>
    </td>
  </tr>`;
}

function _qsSortArrow(col, sort) {
  if (sort.col !== col) return '<span style="color:#ccc;">↕</span>';
  return sort.dir === 'asc' ? '▲' : '▼';
}

// ─── 핸들러 ───
window.qsSortTop = (col) => {
  if (_qsSortTop.col === col) _qsSortTop.dir = _qsSortTop.dir === 'asc' ? 'desc' : 'asc';
  else _qsSortTop = { col, dir: col === 'date' ? 'desc' : 'asc' };
  _qsSavePrefs();
  _qsRenderList();
};
window.qsSortBottom = (col) => {
  if (_qsSortBottom.col === col) _qsSortBottom.dir = _qsSortBottom.dir === 'asc' ? 'desc' : 'asc';
  else _qsSortBottom = { col, dir: col === 'date' ? 'desc' : 'asc' };
  _qsSavePrefs();
  _qsRenderList();
};
window.qsSelectBook = async (bid) => {
  _qsActiveBookId = bid;
  _qsSavePrefs();
  _qsRenderList(); // 즉시 활성 표시 (캐시 없으면 로딩 안내)
  await _qsLazyFetch(bid);
  _qsRenderList();
};
window.qsToggleFavBook = (bid) => {
  if (_qsFavBooks.has(bid)) _qsFavBooks.delete(bid); else _qsFavBooks.add(bid);
  _qsSavePrefs();
  _qsRenderList();
};
window.qsToggleFavSet = (sid) => {
  if (_qsFavSets.has(sid)) _qsFavSets.delete(sid); else _qsFavSets.add(sid);
  _qsSavePrefs();
  _qsRenderList();
};

// ─── 리사이저 (상/하, 좌/우, 컬럼) ───
function _qsAttachResizers() {
  _qsAttachColumnResizers();
  const container = document.getElementById('qsContainer');
  const top = document.getElementById('qsTopPane');
  const bookPane = document.getElementById('qsBookPane');
  const rv = document.getElementById('qsResizerV');
  const rh = document.getElementById('qsResizerH');
  if (!container || !top || !rv || !rh || !bookPane) return;

  // 상하
  rv.addEventListener('mousedown', e => {
    e.preventDefault();
    const startY = e.clientY;
    const rect = container.getBoundingClientRect();
    const startPct = _qsSplitV;
    const onMove = (ev) => {
      const deltaPct = ((ev.clientY - startY) / rect.height) * 100;
      let next = startPct + deltaPct;
      if (next < 15) next = 15;
      if (next > 85) next = 85;
      _qsSplitV = next;
      top.style.flex = `0 0 ${next}%`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      _qsSavePrefs();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // 좌우 (하단 내부)
  rh.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX;
    const bottom = document.getElementById('qsBottomPane');
    const rect = bottom.getBoundingClientRect();
    const startPct = _qsSplitH;
    const onMove = (ev) => {
      const deltaPct = ((ev.clientX - startX) / rect.width) * 100;
      let next = startPct + deltaPct;
      if (next < 15) next = 15;
      if (next > 70) next = 70;
      _qsSplitH = next;
      bookPane.style.flex = `0 0 ${next}%`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      _qsSavePrefs();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ─── 배정: 기존 tp* 인프라 재활용 ───
// ─── 컬럼 리사이즈: <th> 내부 핸들 드래그로 폭 조정 ───
function _qsAttachColumnResizers() {
  document.querySelectorAll('#qsContainer th[data-col] .qs-col-resize').forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const th = handle.parentElement;
      const tableKey = th.dataset.table;
      const col = th.dataset.col;
      const startX = e.clientX;
      const startW = th.offsetWidth;
      const onMove = (ev) => {
        let next = startW + (ev.clientX - startX);
        if (next < 40) next = 40;
        th.style.width = next + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const final = th.offsetWidth;
        if (!_qsColWidths[tableKey]) _qsColWidths[tableKey] = {};
        _qsColWidths[tableKey][col] = final;
        localStorage.setItem('qs_col_widths', JSON.stringify(_qsColWidths));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    // 핸들 위에서 클릭 시 정렬 트리거 방지 (stopPropagation 보강)
    handle.addEventListener('click', (e) => e.stopPropagation());
  });
}

// sourceType(저장 필드) → _TEST_TYPE_CONFIG 키 매핑
const _QS_SOURCE_TO_UI_TYPE = {
  vocab: 'word',
  unscramble: 'unscramble',
  fill_blank: 'blank',
  mcq: 'mcq',
  subjective: 'subj',
  recording: 'rec-ai',
};

window.qsAssignSet = async (setId) => {
  const s = _qsList.find(x => x.id === setId);
  if (!s) { showAlert('입력 확인', '세트를 찾을 수 없음'); return; }
  if (!s.sourceType) { showAlert('입력 확인', '세트 유형이 없어 배정할 수 없습니다'); return; }

  const type = _QS_SOURCE_TO_UI_TYPE[s.sourceType] || s.sourceType;
  const cfg = _TEST_TYPE_CONFIG?.[type];
  if (!cfg) { showToast('지원하지 않는 유형: ' + s.sourceType); return; }
  if (!cfg.actions?.includes('assign')) { showAlert('입력 확인', '${cfg.kindLabel||type}은(는) 학생앱 배정이 지원되지 않습니다 (인쇄만 가능)'); return; }

  // 배정 인프라가 기대하는 전역 상태 세팅
  _activeTestType = type;
  _tpSets = [s];
  _tpSelectedSets = new Set([s.id]);

  try {
    await tpOpenPublishModal();
  } catch (e) {
    showToast('배정 모달 열기 실패: ' + (e?.message || e));
  }
};

// 세트의 mcq subType 결정 — 첫 question 의 subType 기준 (세트 안 한 종류만 정책)
function _qsMcqSubType(s) {
  const qs = s.questions || [];
  if (!qs.length || (s.sourceType !== 'mcq' && qs[0]?.type !== 'mcq')) return null;
  return qs[0]?.subType === 'grammar' ? 'grammar' : 'content';
}

// 문제 세트의 생성 시 옵션 요약 (난이도·청크수·빈칸수·mcq subType). 보기 모달 헤더에 표시.
function _qsBuildOptionsSummary(s) {
  const qs = s.questions || [];
  if (!qs.length) return '';
  const sourceType = s.sourceType || qs[0]?.type || '';
  const parts = [];

  // mcq subType (본문이해/문법) — 가장 우선 표시
  if (sourceType === 'mcq') {
    const sub = _qsMcqSubType(s);
    parts.push(sub === 'grammar' ? '📐 문법' : '📖 본문이해');
  }

  // subjective sentenceMode (문장 변형/유지) — 세트 doc 의 subjectiveMode 또는 첫 q.subjectiveMode 폴백
  if (sourceType === 'subjective') {
    const mode = s.subjectiveMode || qs[0]?.subjectiveMode || 'paraphrase';
    parts.push(mode === 'verbatim' ? '📄 문장 유지' : '✍️ 문장 변형');
  }

  // 난이도 — recording 제외 (학년/난이도 의미 없음)
  if (sourceType !== 'recording') {
    const counts = { easy: 0, medium: 0, hard: 0 };
    qs.forEach(q => {
      const d = q.difficulty || 'medium';
      if (counts[d] !== undefined) counts[d]++;
    });
    const labels = { easy: '쉬움', medium: '보통', hard: '어려움' };
    const present = Object.entries(counts).filter(([_, c]) => c > 0);
    if (present.length === 1) {
      parts.push(`난이도: ${labels[present[0][0]]}`);
    } else if (present.length > 1) {
      parts.push(`난이도: ${present.map(([d, c]) => `${labels[d]} ${c}`).join(' · ')}`);
    }
  }

  // 청크 수 (unscramble)
  if (sourceType === 'unscramble') {
    const chunks = qs
      .map(q => q.chunkCount || (q.chunkedSentence || '').split('/').filter(Boolean).length)
      .filter(n => n > 0);
    if (chunks.length) {
      const min = Math.min(...chunks);
      const max = Math.max(...chunks);
      parts.push(min === max ? `${min}청크` : `${min}~${max}청크`);
    }
  }

  // 빈칸 수 (fill_blank)
  if (sourceType === 'fill_blank') {
    const blanks = qs.map(q => (q.blanks || []).length).filter(n => n > 0);
    if (blanks.length) {
      const min = Math.min(...blanks);
      const max = Math.max(...blanks);
      parts.push(min === max ? `${min} 빈칸` : `${min}~${max} 빈칸`);
    }
  }

  return parts.join(' · ');
}

window.qsViewDetail = async (setId) => {
  let s = _qsList.find(x => x.id === setId)
       || (typeof _tpSets !== 'undefined' && _tpSets.find(x => x.id === setId));
  if (!s) {
    try {
      const snap = await getDoc(doc(db,'genQuestionSets',setId));
      if (snap.exists()) s = { id: snap.id, ...snap.data() };
    } catch(e) {}
  }
  if (!s) { showAlert('입력 확인', '세트를 찾을 수 없음'); return; }

  const html = `
    <div style="width:100%;flex:1;display:flex;flex-direction:column;min-height:0;">
      <div style="padding:20px 24px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div style="font-size:18px;font-weight:700;margin-bottom:6px;">${esc(s.name)}</div>
        <div style="font-size:12px;color:var(--gray);">
          ${s.questions?.length||0}문제${s.sourcePages?.length ? ' · 출처 '+s.sourcePages.length+'개 Page' : ''}
        </div>
        ${(() => {
          const opts = _qsBuildOptionsSummary(s);
          return opts ? `<div style="font-size:11px;color:var(--gray);margin-top:4px;">⚙️ ${opts}</div>` : '';
        })()}
      </div>
      <div style="padding:16px 24px;flex:1;overflow-y:auto;min-height:0;">
        ${(s.questions||[]).map((q, i) => _qsRenderViewCard(q, i)).join('')}
      </div>
      <div style="padding:16px 24px;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:8px;background:white;flex-shrink:0;">
        <button class="btn btn-secondary" onclick="closeModal();qsEditSet('${esc(s.id)}')">${iconSvg('edit')} 수정하기</button>
        <button class="btn btn-primary" onclick="closeModal()">닫기</button>
      </div>
    </div>
  `;
  showModal(html, { fullFlex: true });
};

// 모든 유형을 대응하는 읽기전용 상세 카드 렌더 (Phase 6)
function _qsRenderViewCard(q, i) {
  const diff = {easy:'쉬움',medium:'보통',hard:'어려움'}[q.difficulty] || q.difficulty || '-';
  const icon = q.type==='fill_blank'?'✏️' : q.type==='subjective'?'✍️' : q.type==='recording'?'🎤' : q.type==='vocab'?'📝' : q.type==='unscramble'?'🔀' : '📖';
  // 녹음숙제는 difficulty 의미 없음 (본문 발화 평가). 배지 숨김.
  const diffBadge = q.type === 'recording' ? '' : ` · [${esc(diff)}]`;
  // mcq subType 라벨 (문법인 경우만 표시 — 본문이해는 default 라 생략)
  const subTypeBadge = (q.type === 'mcq' && q.subType === 'grammar')
    ? ` · <span style="color:#7c3aed;">📐 문법</span>` : '';
  const header = `<div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:6px;">${icon} ${i+1}번${diffBadge}${subTypeBadge}${q.sourcePageTitle?` · 출처: ${esc(q.sourcePageTitle)}`:''}</div>`;
  const explanation = q.explanation ? `<div style="font-size:11px;color:#666;margin-top:6px;background:#fff8e1;padding:6px 8px;border-left:2px solid #ffc107;">${iconSvg('lightbulb')} ${esc(q.explanation)}</div>` : '';

  if (q.type === 'fill_blank') {
    const parts = (q.sentence||'').split('___');
    let sentHtml = '';
    for (let k = 0; k < parts.length; k++) {
      sentHtml += esc(parts[k]);
      if (k < parts.length - 1) {
        const ans = q.blanks?.[k] || '';
        sentHtml += `<span style="display:inline-block;min-width:40px;padding:1px 6px;margin:0 2px;border-bottom:2px solid #4caf50;background:#e8f5e9;color:#2e7d32;font-weight:700;">${esc(ans)}</span>`;
      }
    }
    return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;">
      ${header}
      <div style="font-size:14px;line-height:1.8;margin-bottom:6px;">${sentHtml}</div>
      <div style="font-size:12px;color:var(--gray);">${esc(q.questionKo||'')}</div>
      ${explanation}
    </div>`;
  }

  if (q.type === 'subjective') {
    return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;">
      ${header}
      <div style="font-size:14px;line-height:1.6;margin-bottom:8px;padding:10px 14px;background:#f8f9fa;border-left:3px solid var(--teal);">${esc(q.sentence||'')}</div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">${esc(q.questionKo||'')}</div>
      <div style="font-size:12px;color:#2e7d32;background:#e8f5e9;padding:8px 12px;border-radius:6px;">
        <div style="font-size:10px;font-weight:700;margin-bottom:3px;">모범 답안 (교사용)</div>
        ${q.sampleAnswerKo ? esc(q.sampleAnswerKo) : '<span style="color:#999;font-style:italic;">(답안 없음)</span>'}
      </div>
      ${explanation}
    </div>`;
  }

  if (q.type === 'recording') {
    if (q.schemaV === 2) {
      const preview = (q.fullText || '').slice(0, 240) + ((q.fullText||'').length > 240 ? '…' : '');
      return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;">
        ${header}
        <div style="font-size:12px;color:var(--text);padding:8px 12px;background:#fefce8;border-left:3px solid #CA8A04;margin-bottom:8px;">${esc(q.instructionKo||'')}</div>
        <div style="font-size:13px;line-height:1.6;padding:10px 14px;background:#f5f5f5;border-radius:6px;color:#444;margin-bottom:6px;">${esc(preview)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:11px;">
          <span style="background:#e0f2fe;padding:3px 10px;border-radius:10px;color:#0369a1;font-weight:600;">📄 ${q.pageCount||1} Page</span>
          <span style="font-size:10px;color:var(--gray);">⚙️ 통과점수·평가시간·녹음횟수는 시험 배정 시 설정</span>
        </div>
      </div>`;
    }
    return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;">
      ${header}
      <div style="font-size:14px;line-height:1.7;padding:10px 14px;background:#F5F3FF;border-left:3px solid #8B5CF6;margin-bottom:6px;">${esc(q.sentence||'')}</div>
      <div style="font-size:12px;color:var(--gray);">${esc(q.questionKo||'')}</div>
    </div>`;
  }

  if (q.type === 'vocab') {
    return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;">
      ${header}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px;">
        <div style="padding:8px 12px;background:#f0f9ff;border-radius:6px;">
          <div style="font-size:10px;color:#64748b;margin-bottom:2px;">영단어</div>
          <div style="font-size:15px;font-weight:700;color:#0c4a6e;">${esc(q.word||'')}</div>
        </div>
        <div style="padding:8px 12px;background:#fef3c7;border-radius:6px;">
          <div style="font-size:10px;color:#92400e;margin-bottom:2px;">뜻</div>
          <div style="font-size:14px;font-weight:600;color:#78350f;">${esc(q.meaning||'')}</div>
        </div>
      </div>
      ${q.example ? `
        <div style="font-size:11px;color:#64748b;padding:6px 10px;background:#f9fafb;border-left:2px solid #d1d5db;">
          <em>${esc(q.example)}</em>
          ${q.exampleKo ? `<div style="color:#6b7280;margin-top:3px;">↳ ${esc(q.exampleKo)}</div>` : ''}
        </div>` : ''}
    </div>`;
  }

  if (q.type === 'unscramble') {
    const chunks = (q.chunkedSentence||'').split('/').map(s=>s.trim()).filter(Boolean);
    return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;">
      ${header}
      <div style="font-size:13px;color:var(--text);margin-bottom:6px;">${esc(q.meaningKo||'')}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;">
        ${chunks.map(c => `<span style="padding:4px 10px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:4px;font-size:12px;color:#6b21a8;font-weight:600;">${esc(c)}</span>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--gray);padding:4px 8px;background:#f9fafb;border-radius:4px;font-family:monospace;">${esc(chunks.join(' '))}</div>
    </div>`;
  }

  // 기본(MCQ)
  return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;">
    ${header}
    <div style="font-size:14px;font-weight:600;margin-bottom:4px;">${esc(q.question||'')}</div>
    <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">${esc(q.questionKo||'')}</div>
    ${(q.choices||[]).map((c,j) => `<div style="padding:4px 10px;margin-bottom:2px;font-size:12px;${c.isAnswer?'background:#e8f5e9;color:#2e7d32;font-weight:600;':''}">${['①','②','③','④'][j]} ${esc(c.text||'')}${c.isAnswer?' ✓':''}</div>`).join('')}
    ${explanation}
  </div>`;
}

window.qsRenameSet = async (setId) => {
  const s = _qsList.find(x => x.id === setId);
  if (!s) return;
  const newName = prompt('새 이름:', s.name||'');
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) { showAlert('입력 확인', '빈 이름 불가'); return; }
  try {
    await updateDoc(doc(db,'genQuestionSets',setId), {
      name: trimmed,
      updatedAt: serverTimestamp(),
    });
    showToast('✓ 이름 변경됨');
    // 캐시 surgical 갱신 — 현재 화면 상태(선택 Book·정렬·스크롤) 유지 (qsDeleteSet 패턴)
    const patch = (arr) => arr.forEach(x => { if (x.id === setId) x.name = trimmed; });
    patch(_qsList);
    Object.keys(_qsSetsByBook).forEach(k => {
      if (Array.isArray(_qsSetsByBook[k])) patch(_qsSetsByBook[k]);
    });
    _qsRenderList();
  } catch(e) {
    showToast('변경 실패: '+e.message);
  }
};

window.qsDeleteSet = async (setId) => {
  const s = _qsList.find(x => x.id === setId);
  if (!s) return;
  if (!(await showConfirm(`"${s.name}" 삭제`, '되돌릴 수 없습니다. 이 세트로 만든 시험(genTests)이 있다면 그대로 유지됩니다.'))) return;
  try {
    await deleteDoc(doc(db,'genQuestionSets',setId));
    showToast('✓ 삭제됨');
    // 캐시 surgical 삭제 — 현재 화면 상태(선택 Book·정렬·스크롤) 유지 (재fetch 없이)
    _qsList = _qsList.filter(x => x.id !== setId);
    Object.keys(_qsSetsByBook).forEach(k => {
      if (Array.isArray(_qsSetsByBook[k])) {
        _qsSetsByBook[k] = _qsSetsByBook[k].filter(x => x.id !== setId);
      }
    });
    _qsRenderList();
  } catch(e) {
    showToast('삭제 실패: '+e.message);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 문제 세트 내용 수정
// ═══════════════════════════════════════════════════════════════════════════

window.qsEditSet = async (setId) => {
  // qsViewDetail 과 동일 폴백 체인: _qsList → _tpSets → Firestore
  let s = _qsList.find(x => x.id === setId)
       || (typeof _tpSets !== 'undefined' && _tpSets.find(x => x.id === setId));
  if (!s) {
    try {
      const snap = await getDoc(doc(db,'genQuestionSets',setId));
      if (snap.exists()) s = { id: snap.id, ...snap.data() };
    } catch(e) {}
  }
  if (!s) { showAlert('입력 확인', '세트를 찾을 수 없음'); return; }

  _qsEditState = {
    setId: s.id,
    name: s.name || '',
    sourceType: s.sourceType || 'mcq',
    questions: JSON.parse(JSON.stringify(s.questions || [])),
    sourcePages: JSON.parse(JSON.stringify(s.sourcePages || [])),
  };
  _qsRenderEditModal();
};

// 수정 중인 세트의 현재 주 Book ID (sourcePages 에서 최빈값, 없으면 '')
function _qsEditCurrentBookId() {
  const sp = _qsEditState?.sourcePages || [];
  const ids = sp.map(p => p.bookId).filter(Boolean);
  if (!ids.length) return '';
  const counts = {};
  ids.forEach(id => counts[id] = (counts[id]||0) + 1);
  return Object.entries(counts).sort((a,b) => b[1]-a[1])[0][0];
}

function _qsRenderEditModal() {
  const st = _qsEditState;
  if (!st) return;
  const typeLabel = _qsTypeLabel(st.sourceType);
  const html = `
    <div style="width:100%;flex:1;display:flex;flex-direction:column;min-height:0;">
      <div style="padding:16px 22px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div style="font-size:17px;font-weight:700;">${iconSvg('edit')} 문제 세트 수정</div>
        <div style="font-size:11px;color:var(--gray);margin-top:4px;">총 ${st.questions.length}문제 · 유형: ${esc(typeLabel)}</div>
      </div>

      <div style="padding:14px 22px;border-bottom:1px solid var(--border);background:#fafafa;flex-shrink:0;display:grid;grid-template-columns:1fr 280px;gap:12px;align-items:end;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--gray);">세트 이름</label>
          <input type="text" id="qsEditName" value="${esc(st.name)}"
            style="width:100%;padding:9px 12px;margin-top:5px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--gray);">📁 Book 폴더</label>
          <select id="qsEditBook"
            style="width:100%;padding:9px 12px;margin-top:5px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:white;">
            <option value="" ${!_qsEditCurrentBookId()?'selected':''}>(미지정)</option>
            ${(_qsBooks||[]).map(b => `<option value="${esc(b.id)}" ${b.id===_qsEditCurrentBookId()?'selected':''}>${esc(b.name||'(이름 없음)')}</option>`).join('')}
          </select>
        </div>
      </div>

      <div id="qsEditQuestions" style="padding:14px 22px;flex:1;overflow-y:auto;min-height:0;">
        ${st.questions.map((q,i) => _qsRenderEditQuestion(q,i)).join('')}
      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;align-items:center;background:white;flex-shrink:0;">
        <div style="flex:1;font-size:11px;color:var(--gray);">
          ${st.sourceType==='fill_blank' ? '※ 문장 내 ___ 개수 = 정답 개수여야 저장됩니다' : (st.sourceType==='mcq' ? '※ 각 문제에 정답(라디오)이 정확히 1개여야 합니다' : '※ 필수 항목을 모두 입력하세요')}
        </div>
        <button class="btn btn-secondary" onclick="qsCloseEdit()">취소</button>
        <button class="btn btn-primary" onclick="qsSaveEdits()" style="font-weight:700;">${iconSvg('save')} 저장하기</button>
      </div>
    </div>
  `;
  showModal(html, { fullFlex: true });
}

function _qsRenderEditQuestion(q, idx) {
  const diffLabel = {easy:'쉬움',medium:'보통',hard:'어려움'}[q.difficulty] || q.difficulty || '-';
  const srcLabel = q.sourcePageTitle ? ` · 출처: ${q.sourcePageTitle}` : '';
  const icon = q.type==='fill_blank'?'✏️' : q.type==='subjective'?'✍️' : q.type==='recording'?'🎤' : q.type==='vocab'?'📝' : q.type==='unscramble'?'🔀' : '📖';
  const header = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <div style="font-size:11px;font-weight:700;color:var(--gray);">${icon} ${idx+1}번 · 난이도 ${esc(diffLabel)}${esc(srcLabel)}</div>
  </div>`;

  if (q.type === 'fill_blank') {
    return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:10px;background:#fafafa;">
      ${header}
      <label style="font-size:11px;color:var(--gray);">문장 <span style="color:#CA8A04;">(___는 빈칸 마커)</span></label>
      <textarea oninput="qsEditUpdate(${idx},'sentence',this.value)" rows="2"
        style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit;">${esc(q.sentence||'')}</textarea>
      <label style="font-size:11px;color:var(--gray);">빈칸 정답 (쉼표로 구분, 문장 내 ___ 순서대로)</label>
      <input type="text" value="${esc((q.blanks||[]).join(', '))}"
        oninput="qsEditUpdate(${idx},'blanks',this.value)"
        style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;">
      <label style="font-size:11px;color:var(--gray);">한글 지시</label>
      <input type="text" value="${esc(q.questionKo||'')}"
        oninput="qsEditUpdate(${idx},'questionKo',this.value)"
        style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;">
      <label style="font-size:11px;color:var(--gray);">해설 (선택)</label>
      <textarea oninput="qsEditUpdate(${idx},'explanation',this.value)" rows="2"
        style="width:100%;padding:7px 9px;margin:4px 0 0;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit;">${esc(q.explanation||'')}</textarea>
    </div>`;
  }

  if (q.type === 'subjective') {
    return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:10px;background:#fafafa;">
      ${header}
      <label style="font-size:11px;color:var(--gray);">원문 (영어)</label>
      <textarea oninput="qsEditUpdate(${idx},'sentence',this.value)" rows="2"
        style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit;">${esc(q.sentence||'')}</textarea>
      <label style="font-size:11px;color:var(--gray);">한글 지시문</label>
      <input type="text" value="${esc(q.questionKo||'')}"
        oninput="qsEditUpdate(${idx},'questionKo',this.value)"
        style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;">
      <label style="font-size:11px;color:var(--gray);">모범 답안 (교사용 · 한글 해석)</label>
      <textarea oninput="qsEditUpdate(${idx},'sampleAnswerKo',this.value)" rows="2"
        style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit;background:#f0fdf4;">${esc(q.sampleAnswerKo||'')}</textarea>
      <label style="font-size:11px;color:var(--gray);">해설 (선택)</label>
      <textarea oninput="qsEditUpdate(${idx},'explanation',this.value)" rows="2"
        style="width:100%;padding:7px 9px;margin:4px 0 0;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit;">${esc(q.explanation||'')}</textarea>
    </div>`;
  }

  if (q.type === 'vocab') {
    return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:10px;background:#fafafa;">
      ${header}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label style="font-size:11px;color:var(--gray);">영단어</label>
          <input type="text" value="${esc(q.word||'')}"
            oninput="qsEditUpdate(${idx},'word',this.value)"
            style="width:100%;padding:7px 9px;margin-top:3px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-weight:700;">
        </div>
        <div>
          <label style="font-size:11px;color:var(--gray);">뜻</label>
          <input type="text" value="${esc(q.meaning||'')}"
            oninput="qsEditUpdate(${idx},'meaning',this.value)"
            style="width:100%;padding:7px 9px;margin-top:3px;border:1px solid var(--border);border-radius:4px;font-size:13px;">
        </div>
      </div>
      <label style="font-size:11px;color:var(--gray);display:block;margin-top:10px;">예문 (영어, 선택)</label>
      <input type="text" value="${esc(q.example||'')}"
        oninput="qsEditUpdate(${idx},'example',this.value)"
        style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-style:italic;">
      <label style="font-size:11px;color:var(--gray);">예문 한글 번역 (선택)</label>
      <input type="text" value="${esc(q.exampleKo||'')}"
        oninput="qsEditUpdate(${idx},'exampleKo',this.value)"
        style="width:100%;padding:7px 9px;margin:4px 0 0;border:1px solid var(--border);border-radius:4px;font-size:13px;">
    </div>`;
  }

  if (q.type === 'unscramble') {
    const chunks = (q.chunkedSentence||'').split('/').map(s=>s.trim()).filter(Boolean);
    return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:10px;background:#fafafa;">
      ${header}
      <label style="font-size:11px;color:var(--gray);">한글 뜻</label>
      <input type="text" value="${esc(q.meaningKo||'')}"
        oninput="qsEditUpdate(${idx},'meaningKo',this.value)"
        style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;">
      <label style="font-size:11px;color:var(--gray);">영문 <span style="color:#7c3aed;">('/' 로 청크 구분)</span></label>
      <input type="text" value="${esc(q.chunkedSentence||'')}"
        oninput="qsEditUnscrambleEdit(${idx}, this.value)"
        style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:monospace;">
      <div id="qsEditUnscPreview_${idx}" style="padding:8px 10px;background:#faf5ff;border-radius:4px;">
        <div style="font-size:10px;color:var(--gray);margin-bottom:4px;">청크 미리보기 (${chunks.length}개)</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${chunks.map(c => `<span style="padding:3px 8px;background:white;border:1px solid #e9d5ff;border-radius:4px;font-size:12px;color:#6b21a8;">${esc(c)}</span>`).join('')}
        </div>
      </div>
    </div>`;
  }

  if (q.type === 'recording') {
    if (q.schemaV === 2) {
      // 녹음숙제 카드 — 본문 textarea 가 모달 남는 공간 다 사용 (1 question only).
      return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:10px;background:#fafafa;display:flex;flex-direction:column;height:100%;min-height:500px;">
        ${header}
        <label style="font-size:11px;color:var(--gray);">지시문 (학생에게 표시)</label>
        <textarea oninput="qsEditUpdate(${idx},'instructionKo',this.value)" rows="2"
          style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit;flex-shrink:0;">${esc(q.instructionKo||'')}</textarea>
        <div style="font-size:10px;color:var(--gray);background:#fef9c3;border-left:3px solid #ca8a04;padding:6px 10px;margin-bottom:10px;flex-shrink:0;">⚙️ 통과점수·평가시간·녹음횟수는 시험 배정 시 학원장이 설정합니다 (세트 단계 옵션 X).</div>
        <label style="font-size:11px;color:var(--gray);flex-shrink:0;">전체 본문 (AI 평가 대상, 수정 신중)</label>
        <textarea oninput="qsEditUpdate(${idx},'fullText',this.value)"
          style="width:100%;padding:7px 9px;margin:4px 0 0;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit;flex:1;min-height:200px;resize:vertical;">${esc(q.fullText||'')}</textarea>
      </div>`;
    }
    return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:10px;background:#fafafa;">
      ${header}
      <label style="font-size:11px;color:var(--gray);">녹음 대상 문장</label>
      <textarea oninput="qsEditUpdate(${idx},'sentence',this.value)" rows="2"
        style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit;">${esc(q.sentence||'')}</textarea>
      <label style="font-size:11px;color:var(--gray);">한글 지시문</label>
      <input type="text" value="${esc(q.questionKo||'')}"
        oninput="qsEditUpdate(${idx},'questionKo',this.value)"
        style="width:100%;padding:7px 9px;margin:4px 0 0;border:1px solid var(--border);border-radius:4px;font-size:13px;">
    </div>`;
  }

  // MCQ
  return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:10px;background:#fafafa;">
    ${header}
    <label style="font-size:11px;color:var(--gray);">영어 질문</label>
    <textarea oninput="qsEditUpdate(${idx},'question',this.value)" rows="2"
      style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit;">${esc(q.question||'')}</textarea>
    <label style="font-size:11px;color:var(--gray);">한글 번역</label>
    <input type="text" value="${esc(q.questionKo||'')}"
      oninput="qsEditUpdate(${idx},'questionKo',this.value)"
      style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;">
    <label style="font-size:11px;color:var(--gray);">선택지 <span style="color:#2e7d32;">(라디오 선택 = 정답)</span></label>
    <div style="margin:4px 0 10px;display:flex;flex-direction:column;gap:5px;">
      ${(q.choices||[]).map((c,j) => `
        <div style="display:flex;gap:6px;align-items:center;">
          <span style="font-size:13px;color:var(--gray);width:18px;flex-shrink:0;">${['①','②','③','④'][j]||(j+1)}</span>
          <input type="radio" name="qs-ans-${idx}" ${c.isAnswer?'checked':''} onchange="qsEditSetAnswer(${idx},${j})" style="flex-shrink:0;">
          <input type="text" value="${esc(c.text||'')}"
            oninput="qsEditUpdateChoice(${idx},${j},this.value)"
            style="flex:1;padding:6px 9px;border:1px solid var(--border);border-radius:4px;font-size:12px;${c.isAnswer?'background:#e8f5e9;':''}">
        </div>
      `).join('')}
    </div>
    <label style="font-size:11px;color:var(--gray);">해설 (선택)</label>
    <textarea oninput="qsEditUpdate(${idx},'explanation',this.value)" rows="2"
      style="width:100%;padding:7px 9px;margin:4px 0 0;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit;">${esc(q.explanation||'')}</textarea>
  </div>`;
}

// 수정 모달 전용 언스크램블 편집 (chunked + sentence + chunkCount 동시 갱신 + 프리뷰)
window.qsEditUnscrambleEdit = (idx, value) => {
  if (!_qsEditState || !_qsEditState.questions[idx]) return;
  const chunked = String(value || '').trim();
  const chunks = chunked.split('/').map(s => s.trim()).filter(Boolean);
  _qsEditState.questions[idx].chunkedSentence = chunked;
  _qsEditState.questions[idx].sentence = chunks.join(' ').replace(/\s+/g, ' ').trim();
  _qsEditState.questions[idx].chunkCount = chunks.length;
  const el = document.getElementById(`qsEditUnscPreview_${idx}`);
  if (el) {
    el.innerHTML = `
      <div style="font-size:10px;color:var(--gray);margin-bottom:4px;">청크 미리보기 (${chunks.length}개)</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        ${chunks.map(c => `<span style="padding:3px 8px;background:white;border:1px solid #e9d5ff;border-radius:4px;font-size:12px;color:#6b21a8;">${esc(c)}</span>`).join('')}
      </div>
    `;
  }
};

window.qsEditUpdate = (idx, field, value) => {
  if (!_qsEditState || !_qsEditState.questions[idx]) return;
  if (field === 'blanks') {
    _qsEditState.questions[idx].blanks = value.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    _qsEditState.questions[idx][field] = value;
  }
};

window.qsEditUpdateChoice = (qIdx, cIdx, value) => {
  if (!_qsEditState || !_qsEditState.questions[qIdx]) return;
  const q = _qsEditState.questions[qIdx];
  if (!q.choices || !q.choices[cIdx]) return;
  q.choices[cIdx].text = value;
};

window.qsEditSetAnswer = (qIdx, cIdx) => {
  if (!_qsEditState || !_qsEditState.questions[qIdx]) return;
  const q = _qsEditState.questions[qIdx];
  if (!q.choices) return;
  q.choices.forEach((c, j) => { c.isAnswer = (j === cIdx); });
  // 라디오 시각 갱신은 브라우저가 처리, 배경색만 다시 칠하기 위해 해당 문제만 재렌더
  const container = document.getElementById('qsEditQuestions');
  if (container) {
    const allDivs = container.children;
    if (allDivs[qIdx]) {
      const tmp = document.createElement('div');
      tmp.innerHTML = _qsRenderEditQuestion(q, qIdx);
      allDivs[qIdx].replaceWith(tmp.firstElementChild);
    }
  }
};

window.qsCloseEdit = async () => {
  if (!_qsEditState) { closeModal(); return; }
  if (!(await showConfirm('수정을 취소할까요?','지금까지 변경한 내용이 저장되지 않습니다.'))) return;
  _qsEditState = null;
  closeModal();
};

// ─── 단어 말하기 출제 데이터 AI 채움 헬퍼 (vocab questions 만 대상) ─────
// 4필드 동시 생성: homophones / speakingKoPron / speakingSent / speakingSentKo (AI 호출 1회)
// 호출자: qsSaveEdits (세트 수정 저장 시) / tpPublish (출제 안전망, vocab+speaking 만)
// 누락 조건: 4필드 중 하나라도 빠진 단어 → AI 호출 대상.
// 실패 시 누락 필드는 빈값/빈배열로 (tpPublish 게이트가 차단). 다음 호출에 재시도 안 함 — 무한 루프 방지.
// 반환: { filled: N, total: M } — N=4필드 모두 받은 단어 수, M=호출 대상 단어 수
async function _fillMissingHomophones(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return { filled: 0, total: 0 };
  const missing = questions.filter(q =>
    q && q.word && (q.type === 'vocab' || !q.type) &&
    (!Array.isArray(q.homophones) || !q.speakingKoPron || !q.speakingSent || !q.speakingSentKo)
  );
  if (missing.length === 0) return { filled: 0, total: 0 };
  try {
    const resp = await _geminiFetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'homophones-only', words: missing.map(q => q.word) }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.success && Array.isArray(data.results)) {
        const map = new Map(data.results.map(r => [
          String(r.word || '').toLowerCase(),
          {
            homophones: Array.isArray(r.homophones) ? r.homophones : [],
            koPron: String(r.koPron || ''),
            sentence: String(r.sentence || ''),
            sentenceKo: String(r.sentenceKo || ''),
            speakingTip: String(r.speakingTip || ''),
          }
        ]));
        let filled = 0;
        missing.forEach(q => {
          const m = map.get(q.word.toLowerCase()) || {};
          if (!Array.isArray(q.homophones)) q.homophones = m.homophones || [];
          if (!q.speakingKoPron) q.speakingKoPron = m.koPron || '';
          if (!q.speakingSent) q.speakingSent = m.sentence || '';
          if (!q.speakingSentKo) q.speakingSentKo = m.sentenceKo || '';
          // speakingTip 은 optional — AI 가 빈문자열 줄 수도 있음 (단순한 단어). 누락이 정상 케이스라 검증 안 함
          if (!q.speakingTip && m.speakingTip) q.speakingTip = m.speakingTip;
          if (q.speakingKoPron && q.speakingSent && q.speakingSentKo) filled++;
        });
        return { filled, total: missing.length };
      }
    }
    missing.forEach(q => {
      if (!Array.isArray(q.homophones)) q.homophones = [];
    });
  } catch (e) {
    console.warn('[homophones] AI failed:', e.message);
    missing.forEach(q => {
      if (!Array.isArray(q.homophones)) q.homophones = [];
    });
  }
  return { filled: 0, total: missing.length };
}

// 말하기 부적합 휴리스틱 — 3글자 이하 + 자리표시/변화형 구분자/특수문자/비정상 형식 (객관적 극단). 클라 즉시 판정.
// '1음절' 은 wild·soft·feel 같은 정상 단어를 과다 표시해 제거 — ASR 위험은 AI 가 판단.
// 2026-06-01: '~'·'...'·'…' 자리표시 + '/'·'>'·',' 변화형 구분자(저장 허용·말하기 불가)
// + 기타 특수문자(괄호·통화기호 등 옛 데이터) + 비정상 띄어쓰기 검출. AI 호출 전 차단.
function _tpSpeakingUnfitReasons(word) {
  const raw = String(word || '');
  const r = [];
  // 자리표시 기호 — 학생이 발음 불가 + AI 예문 생성 실패 원인 ('rice ~ up', 'look ...')
  if (/[~…]|\.{2,}/.test(raw)) r.push('자리표시 기호 포함');
  // 변화형 구분자(/ , >) + 기타 특수문자 — 단일 단어 발음 불가 ('rice/fall', 'abandon, leave', 'name > called')
  if (/[\/>,\[\]\(\)\{\}\|\*\$\€\&\@\#\%\^\+\=\<\;]/.test(raw)) r.push('특수문자/구분자 포함');
  // 비정상 띄어쓰기 — apostrophe 양옆 공백 ("there 's") / 연속 공백
  if (/\s'|'\s|\s{2,}/.test(raw)) r.push('비정상 띄어쓰기');
  // 3글자 이하 영문 — up·be·go 등 객관적 극단
  const clean = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (clean && clean.length <= 3) r.push('3글자 이하');
  return r;
}

// 배정 전 게이트: 휴리스틱(3글자 이하) + AI(의성어·사전없음·ASR위험) 로 부적합 단어 산출 →
// 모달로 단어·사유·삭제버튼 표시. 학원장이 삭제하면 questions 에서 제거(in-place).
// 반환: true=배정 계속 / false=취소. (vocab+speaking 출제에서만 호출)
function _tpSpeakingUnfitGate(questions) {
  return new Promise(async (resolve) => {
    const vqs = questions.filter(q => q && q.word && (q.type === 'vocab' || !q.type));
    const words = [...new Set(vqs.map(q => String(q.word).trim()).filter(Boolean))];
    if (!words.length) return resolve(true);

    const reasonMap = new Map();  // lower → Set(사유)
    words.forEach(w => {
      const rs = _tpSpeakingUnfitReasons(w);
      if (rs.length) reasonMap.set(w.toLowerCase(), new Set(rs));
    });

    // AI: 의성어 / 사전에 없는 단어 / ASR 오인식 위험 (generator 쿼터 — 서버에서 카운트)
    try {
      const resp = await _geminiFetch('/api/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'speaking-unfit-check', words }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.success && Array.isArray(data.results)) {
          data.results.forEach(rr => {
            const lw = String(rr.word || '').toLowerCase();
            if (rr.onomatopoeia || rr.notRealWord || rr.hardForASR) {
              if (!reasonMap.has(lw)) reasonMap.set(lw, new Set());
              if (rr.onomatopoeia) reasonMap.get(lw).add('의성어');
              if (rr.notRealWord) reasonMap.get(lw).add('사전에 없는 단어');
              if (rr.hardForASR) reasonMap.get(lw).add('ASR 인식 어려움');
            }
          });
        }
      } else {
        showToast('AI 부적합 검사 실패 — 글자/음절 기준만 표시');
      }
    } catch (e) {
      showToast('AI 부적합 검사 실패 — 글자/음절 기준만 표시');
    }

    if (reasonMap.size === 0) return resolve(true);  // 부적합 없음 → 그대로 진행

    const dispOf = (lw) => (vqs.find(q => String(q.word).toLowerCase() === lw)?.word) || lw;
    const rowsHtml = () => {
      if (reasonMap.size === 0) return '<div style="color:var(--gray);font-size:13px;padding:14px;text-align:center;">부적합 단어 없음 — 그대로 배정 가능</div>';
      return [...reasonMap.entries()].map(([lw, set]) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;">
          <div style="min-width:0;"><span style="font-weight:700;">${esc(dispOf(lw))}</span>
            <span style="font-size:11px;color:var(--gray);"> · ${[...set].map(esc).join(' · ')}</span></div>
          <button class="btn btn-secondary" style="font-size:12px;padding:4px 10px;color:#dc2626;border-color:#fecaca;flex-shrink:0;" onclick="_tpUnfitDel('${esc(lw)}')">${iconSvg('trash')} 삭제</button>
        </div>`).join('');
    };
    window._tpUnfitDel = (lw) => {
      for (let i = questions.length - 1; i >= 0; i--) {
        if (questions[i] && String(questions[i].word || '').toLowerCase() === lw) questions.splice(i, 1);
      }
      reasonMap.delete(lw);
      const el = document.getElementById('_tpUnfitList');
      if (el) el.innerHTML = rowsHtml();
      const cnt = document.getElementById('_tpUnfitCnt');
      if (cnt) cnt.textContent = `남은 문제 ${questions.length}개`;
      showToast('삭제됨');
    };
    window._tpUnfitClose = (proceed) => {
      window._tpUnfitDel = null; window._tpUnfitClose = null;
      closeModal();
      resolve(!!proceed);
    };
    showModal(`
      <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
        <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
          <div style="font-size:17px;font-weight:700;">${iconSvg('mic')} 말하기 부적합 단어 검토</div>
          <div style="font-size:11px;color:var(--gray);margin-top:4px;line-height:1.5;">
            음성 인식이 잘 안 되는 단어입니다 (짧음·1음절·의성어·사전에 없는 단어).<br>
            🗑 삭제하면 <b>이 말하기 시험에서만</b> 빠집니다 (객관식·스펠링 형식엔 영향 없음).
            <span id="_tpUnfitCnt" style="color:var(--text);font-weight:600;">남은 문제 ${questions.length}개</span>
          </div>
        </div>
        <div style="padding:16px 22px;overflow-y:auto;flex:1;" id="_tpUnfitList">${rowsHtml()}</div>
        <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-secondary" onclick="_tpUnfitClose(false)">취소</button>
          <button class="btn btn-primary" onclick="_tpUnfitClose(true)" style="font-weight:700;">이대로 배정하기 ▶</button>
        </div>
      </div>`);
  });
}

// 2026-05-24 — 단어시험 세트 문자 검증 게이트
// 학생 답안 입력 단계에서 한글 입력 제한·특수문자 처리 문제 야기하는 단어 검출.
// 호출자: qgSaveSet (AI Generator·Wordsnap 세트 저장) / qsSaveEdits (세트 수정 저장)
// vocab 타입 questions 만 대상. 학원장이 inline 수정 또는 삭제 후 진행.

// 영어 단어/숙어 표준 문자: a-zA-Z 공백 ' - . (apostrophe, hyphen, period)
// 한글/한자/일본어/그 외 특수문자(괄호·따옴표·물음표·콜론 등)는 부적합.
// 회색: / > ~ 등 변화형 표기 — 학원장이 사용 중인 데이터 보호 위해 일단 허용.
function _qsValidateWordChars(questions) {
  const out = [];
  (questions || []).forEach((q, idx) => {
    if (!q?.word) return;
    const w = String(q.word).trim();
    if (!w) return;
    const reasons = [];
    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(w)) reasons.push('한글 포함');
    if (/[一-龯]/.test(w)) reasons.push('한자 포함');
    if (/[ぁ-んァ-ヶ]/.test(w)) reasons.push('일본어 포함');
    // 영문·공백·기본 구두점·변화형 표기(/>~) 외 특수문자
    // 허용: a-zA-Z 공백 ' - . / > ~ , 숫자
    const nonStandard = w.replace(/[a-zA-Z0-9\s'.\-/>~,]/g, '')
                          .replace(/[가-힣ㄱ-ㅎㅏ-ㅣ一-龯ぁ-んァ-ヶ]/g, '');
    if (nonStandard.length > 0) {
      const samples = [...new Set(nonStandard.split(''))].slice(0, 5).join(' ');
      reasons.push(`특수문자 (${samples})`);
    }
    if (reasons.length) out.push({ idx, word: w, reasons });
  });
  return out;
}

// 부적합 단어 게이트 모달 — 학원장이 수정 또는 삭제 후 진행/취소
// 반환: { proceed: true | false } — true 면 호출자가 그대로 진행
function _qsCharsGate(questions) {
  return new Promise(resolve => {
    const unfit = _qsValidateWordChars(questions);
    if (unfit.length === 0) return resolve({ proceed: true });

    // questions 가 vocab 한 종류라 가정. 각 항목 idx 로 직접 update
    const rowHtml = (item) => `
      <div data-row="${item.idx}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:#fff;">
        <div style="flex:1;min-width:0;">
          <input type="text" value="${esc(item.word)}" oninput="_qsCharsEdit(${item.idx}, this.value)"
            style="width:100%;padding:6px 9px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:ui-monospace,Consolas,monospace;">
          <div style="font-size:11px;color:#dc2626;margin-top:3px;">${esc(item.reasons.join(' · '))}</div>
        </div>
        <button class="btn btn-secondary" style="font-size:12px;padding:4px 10px;color:#dc2626;border-color:#fecaca;flex-shrink:0;" onclick="_qsCharsDel(${item.idx})">${iconSvg('trash')} 삭제</button>
      </div>`;
    const renderList = () => {
      const u = _qsValidateWordChars(questions);
      const el = document.getElementById('_qsCharsList');
      if (!el) return;
      if (u.length === 0) {
        el.innerHTML = '<div style="color:#059669;font-size:13px;padding:14px;text-align:center;font-weight:600;">✓ 모두 정상 — [계속 진행] 버튼을 눌러주세요</div>';
      } else {
        el.innerHTML = u.map(rowHtml).join('');
      }
      const cnt = document.getElementById('_qsCharsCnt');
      if (cnt) cnt.textContent = `남은 문제 ${questions.length}개 · 부적합 ${u.length}개`;
    };

    window._qsCharsEdit = (idx, val) => {
      if (!questions[idx]) return;
      questions[idx].word = String(val || '').trim();
      // 수정 즉시 재검증은 안 함 (학원장 타이핑 중 깜빡임 방지) — 별도 [재검증] 버튼 또는 [계속 진행] 시 다시 검사
    };
    window._qsCharsDel = (idx) => {
      // splice 시 인덱스 어긋남 방지 — sentinel 로 표시 후 마지막에 일괄 제거
      if (questions[idx]) questions[idx]._toDelete = true;
      // 즉시 진짜 제거 (UI 단순화). 이후 idx 어긋남은 _toDelete 표시로 안전.
      // 하지만 splice 시 다음 항목 idx 가 줄어 _qsValidateWordChars 가 다시 idx 매핑 → 안전.
      questions.splice(idx, 1);
      renderList();
      showToast('삭제됨');
    };
    window._qsCharsRecheck = () => renderList();
    window._qsCharsClose = (proceed) => {
      window._qsCharsEdit = null;
      window._qsCharsDel = null;
      window._qsCharsRecheck = null;
      window._qsCharsClose = null;
      closeModal();
      resolve({ proceed: !!proceed });
    };

    showModal(`
      <div style="width:min(620px,92vw);max-height:88vh;display:flex;flex-direction:column;">
        <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
          <div style="font-size:17px;font-weight:700;">⚠️ 단어 검증 — 한글·특수문자 포함</div>
          <div style="font-size:11px;color:var(--gray);margin-top:4px;line-height:1.5;">
            학생 답안 입력에 문제가 되는 단어입니다 (한글/한자/특수문자 등).<br>
            영문으로 <b>수정</b>하거나 🗑 <b>삭제</b> 후 [재검증] → [계속 진행] 하세요.
            <span id="_qsCharsCnt" style="color:var(--text);font-weight:600;display:block;margin-top:3px;">남은 문제 ${questions.length}개 · 부적합 ${unfit.length}개</span>
          </div>
        </div>
        <div style="padding:16px 22px;overflow-y:auto;flex:1;" id="_qsCharsList">${unfit.map(rowHtml).join('')}</div>
        <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:space-between;align-items:center;">
          <button class="btn btn-secondary" onclick="_qsCharsRecheck()" style="font-size:12px;">↻ 재검증</button>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary" onclick="_qsCharsClose(false)">취소</button>
            <button class="btn btn-primary" onclick="_qsCharsClose(true)" style="font-weight:700;">계속 진행 ▶</button>
          </div>
        </div>
      </div>`);
  });
}

window.qsSaveEdits = async () => {
  const st = _qsEditState;
  if (!st) return;
  const newName = document.getElementById('qsEditName')?.value.trim();
  if (!newName) { showAlert('입력 확인', '세트 이름을 입력하세요'); return; }

  // 검증 — 유형별
  for (let i = 0; i < st.questions.length; i++) {
    const q = st.questions[i];
    if (q.type === 'fill_blank') {
      const sentence = (q.sentence||'').trim();
      if (!sentence) { showAlert('입력 확인', '${i+1}번: 문장이 비어있음'); return; }
      const markerCount = (sentence.match(/___/g) || []).length;
      if (markerCount === 0) { showAlert('입력 확인', '${i+1}번: 문장에 ___ 마커가 없습니다'); return; }
      const blanks = (q.blanks || []).filter(b => b && b.trim());
      if (blanks.length !== markerCount) { showAlert('입력 확인', '${i+1}번: ___ ${markerCount}개 vs 정답 ${blanks.length}개 불일치'); return; }
    } else if (q.type === 'subjective') {
      if (!(q.sentence||'').trim()) { showAlert('입력 확인', '${i+1}번: 원문이 비어있음'); return; }
      // sampleAnswerKo 는 선택 항목
    } else if (q.type === 'vocab') {
      if (!(q.word||'').trim()) { showAlert('입력 확인', '${i+1}번: 영단어가 비어있음'); return; }
      if (!(q.meaning||'').trim()) { showAlert('입력 확인', '${i+1}번: 뜻이 비어있음'); return; }
    } else if (q.type === 'unscramble') {
      const chunked = (q.chunkedSentence||'').trim();
      if (!chunked) { showAlert('입력 확인', '${i+1}번: 영문이 비어있음'); return; }
      const chunks = chunked.split('/').map(s=>s.trim()).filter(Boolean);
      if (chunks.length < 2) { showAlert('입력 확인', '${i+1}번: 청크가 최소 2개 필요합니다'); return; }
      if (!(q.meaningKo||'').trim()) { showAlert('입력 확인', '${i+1}번: 한글 뜻이 비어있음'); return; }
    } else if (q.type === 'recording') {
      if (q.schemaV === 2) {
        if (!(q.fullText||'').trim()) { showAlert('입력 확인', '${i+1}번: 본문이 비어있음'); return; }
        if (!(q.instructionKo||'').trim()) { showAlert('입력 확인', '${i+1}번: 지시문이 비어있음'); return; }
      } else {
        if (!(q.sentence||'').trim()) { showAlert('입력 확인', '${i+1}번: 녹음 문장이 비어있음'); return; }
      }
    } else {
      // MCQ (기본)
      if (!(q.question||'').trim()) { showAlert('입력 확인', '${i+1}번: 질문이 비어있음'); return; }
      const choices = q.choices || [];
      if (choices.length !== 4) { showAlert('입력 확인', '${i+1}번: 선택지는 4개여야 합니다'); return; }
      const answerCount = choices.filter(c => c.isAnswer).length;
      if (answerCount !== 1) { showAlert('입력 확인', '${i+1}번: 정답이 정확히 1개여야 합니다'); return; }
      if (choices.some(c => !(c.text||'').trim())) { showToast(`${i+1}번: 빈 선택지가 있습니다`); return; }
    }
  }

  // Book 폴더 변경 반영: 모든 sourcePages 엔트리의 bookId 를 선택값으로 덮어쓰기
  // - Book 이 바뀌면 chapterId 는 구 Book 소속이라 폴더 일관성을 위해 비움
  // - Book 이 같으면 chapterId 유지
  // - sourcePages 가 비어있고 Book 을 선택했으면 단일 엔트리 생성 (Wordsnap 류 수동 세트)
  const chosenBookId = document.getElementById('qsEditBook')?.value || '';
  const originalBookId = _qsEditCurrentBookId();
  let sourcePages = st.sourcePages || [];
  if (sourcePages.length === 0) {
    if (chosenBookId) {
      sourcePages = [{ pageId: '', pageTitle: '', bookId: chosenBookId, chapterId: '' }];
    }
  } else if (chosenBookId !== originalBookId) {
    sourcePages = sourcePages.map(p => ({ ...p, bookId: chosenBookId, chapterId: '' }));
  }

  // vocab 세트 — 한글·특수문자 포함 단어 검증 게이트 (학원장이 단어 수정 시 검증)
  if (st.sourceType === 'vocab' || st.questions.some(q => q.type === 'vocab')) {
    const gateResult = await _qsCharsGate(st.questions);
    if (!gateResult.proceed) return;
    if (st.questions.length === 0) {
      showAlert('저장 불가', '모든 단어를 삭제해 저장할 문제가 없습니다');
      return;
    }
  }

  if (!(await showConfirm('수정사항을 저장할까요?', `${st.questions.length}문제 업데이트`))) return;

  // vocab 세트면 누락 단어 동음이의어 자동 채움 (학원장이 단어 추가/수정한 케이스 대응, 2026-05-15)
  if (st.sourceType === 'vocab' || st.questions.some(q => q.type === 'vocab')) {
    const filled = await _fillMissingHomophones(st.questions);
    if (filled.total > 0) {
      console.log(`[qsSaveEdits] 동음이의어 채움: ${filled.filled}/${filled.total}`);
    }
  }

  try {
    const newBookId = _qsPrimaryBookId({ sourcePages }) === _QS_UNASSIGNED ? '' : _qsPrimaryBookId({ sourcePages });
    const patch = {
      name: newName,
      questions: st.questions,
      questionCount: st.questions.length,
      sourcePages,
      bookId: newBookId,
    };
    await updateDoc(doc(db,'genQuestionSets',st.setId), { ...patch, updatedAt: serverTimestamp() });
    showToast(`✓ "${newName}" 저장됨`);
    _qsEditState = null;
    closeModal();
    // 캐시 surgical 갱신 — 현재 화면 상태(선택 Book·정렬·스크롤) 유지 (qsDeleteSet 패턴)
    // Book 폴더가 바뀐 경우 _qsSetsByBook 의 옛/새 폴더 양쪽 동기화
    const setId = st.setId;
    const apply = (arr) => arr.forEach(x => { if (x.id === setId) Object.assign(x, patch); });
    apply(_qsList);
    Object.keys(_qsSetsByBook).forEach(k => {
      if (Array.isArray(_qsSetsByBook[k])) apply(_qsSetsByBook[k]);
    });
    // Book 폴더 변경 시 양쪽 캐시 정합 — 옛 폴더에서 제거, 새 폴더로 이동 (originalBookId: 함수 상단 13180에서 계산)
    if (originalBookId !== newBookId) {
      const moved = _qsList.find(x => x.id === setId);
      const oldKey = originalBookId || _QS_UNASSIGNED;
      const newKey = newBookId || _QS_UNASSIGNED;
      if (Array.isArray(_qsSetsByBook[oldKey])) {
        _qsSetsByBook[oldKey] = _qsSetsByBook[oldKey].filter(x => x.id !== setId);
      }
      if (moved && Array.isArray(_qsSetsByBook[newKey]) && !_qsSetsByBook[newKey].some(x => x.id === setId)) {
        _qsSetsByBook[newKey].unshift(moved);
      }
    }
    _qsRenderList();
  } catch(e) {
    showToast('저장 실패: ' + e.message);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 본문이해·문법_객관식 시험 배정 (Phase 2)
// ═══════════════════════════════════════════════════════════════════════════
// genQuestionSets (sourceType='mcq') → 선택 → 대상 지정 → genTests 문서생성
// ═══════════════════════════════════════════════════════════════════════════

let _mcqSets = [];
let _mcqSelectedSets = new Set();
let _mcqTargets = [];

window.loadMcqAssign = async () => {
  try {
    // where('sourceType',…) + orderBy(createdAt) 복합 쿼리는 과거 저장 데이터의
    // sourceType 필드 편차(미입력/대소문자/다른 표기) 및 복합 인덱스 부재에 취약.
    // 전체 로드 후 클라이언트에서 MCQ 계열만 필터한다.
    const snap = await getDocs(query(
      collection(db,'genQuestionSets'),
      where('academyId','==',window.MY_ACADEMY_ID),
      orderBy('createdAt','desc')
    ));
    _mcqSets = snap.docs
      .map(d => ({ id:d.id, ...d.data() }))
      .filter(s => {
        const t = String(s.sourceType || '').toLowerCase();
        // sourceType 이 없으면 MCQ 로 간주(현재 AI 문제 생성은 MCQ 단일 유형)
        if (!t) return true;
        return t === 'mcq' || t.includes('multiple') || t.includes('choice') || t === '객관식';
      });
  } catch(e) {
    console.error(e);
    showToast('문제 세트 로드 실패: '+e.message);
    _mcqSets = [];
  }
  _mcqSelectedSets.clear();
  _mcqTargets = [];
  _mcqRender();
};

function _mcqRender() {
  const root = document.getElementById('mcqAssignRoot');
  if (!root) return;

  if (_mcqSets.length === 0) {
    root.innerHTML = `
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:48px;text-align:center;color:var(--gray);">
        <div style="font-size:32px;margin-bottom:10px;">📭</div>
        <div style="font-size:14px;margin-bottom:6px;">배정 가능한 객관식 문제 세트가 없습니다</div>
        <div style="font-size:12px;">먼저 'AI Generator' 메뉴에서 객관식 세트를 만들어주세요</div>
        <button class="btn btn-primary" style="margin-top:16px;" onclick="goPage('quiz-generate')">✨ AI Generator 바로가기</button>
      </div>`;
    return;
  }

  const selectedCount = _mcqSelectedSets.size;
  const totalQuestions = _mcqSets
    .filter(s => _mcqSelectedSets.has(s.id))
    .reduce((sum, s) => sum + (s.questionCount || s.questions?.length || 0), 0);

  root.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 360px;gap:16px;">

      <!-- 좌측: 문제 세트 리스트 -->
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden;">
        <div style="padding:12px 16px;background:#f8f9fa;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;font-size:14px;">${iconSvg('clipboard')} 문제 세트 선택</div>
            <div style="font-size:11px;color:var(--gray);">체크한 세트들의 문제가 하나의 시험으로 합쳐집니다 · ${_mcqSets.length}개 세트</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-secondary" style="font-size:12px;padding:4px 10px;" onclick="mcqSelectAll()">전체</button>
            <button class="btn btn-secondary" style="font-size:12px;padding:4px 10px;" onclick="mcqClearSel()">해제</button>
          </div>
        </div>
        <div style="max-height:calc(100vh - 340px);overflow-y:auto;">
          ${_mcqSets.map(s => {
            const checked = _mcqSelectedSets.has(s.id) ? 'checked' : '';
            const date = s.createdAt?.toDate ? s.createdAt.toDate() : null;
            const dateStr = date ? date.toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-';
            const qCount = s.questionCount || s.questions?.length || 0;
            return `
              <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:center;cursor:pointer;" onclick="mcqToggleSet('${esc(s.id)}')">
                <input type="checkbox" ${checked} onclick="event.stopPropagation();mcqToggleSet('${esc(s.id)}')">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;color:var(--text);">${esc(s.name||'(이름 없음)')}</div>
                  <div style="font-size:11px;color:var(--gray);margin-top:2px;">
                    ${qCount}문제 · ${esc(dateStr)}
                    ${s.sourcePages?.length ? ' · 출처 '+s.sourcePages.length+'개 Page' : ''}
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>

      <!-- 우측: 시험 정보 + 대상 -->
      <div style="display:flex;flex-direction:column;gap:12px;">

        <div style="background:#f0fafa;border:1px solid var(--teal-light);border-radius:8px;padding:12px 16px;">
          <div style="font-size:12px;color:var(--gray);margin-bottom:4px;">선택된 세트</div>
          <div style="font-size:20px;font-weight:700;color:var(--teal);">${selectedCount}개 · ${totalQuestions}문제</div>
        </div>

        <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:10px;">${iconSvg('pen')} 시험 정보</div>

          <label style="font-size:12px;font-weight:600;color:var(--text);">시험명 *</label>
          <input type="text" id="mcqName" placeholder="예: Lesson 3 독해"
            value="독해 시험 ${new Date().toLocaleDateString('ko-KR',{month:'2-digit',day:'2-digit'}).replace(/\./g,'').trim().replace(' ','-')}"
            style="width:100%;padding:8px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;">

          <label style="font-size:12px;font-weight:600;color:var(--text);">통과점수</label>
          <input type="number" id="mcqPassScore" value="80" min="0" max="100"
            style="width:100%;padding:8px 10px;margin:4px 0 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;">

          <label style="font-size:12px;font-weight:600;color:var(--text);">출제일</label>
          <input type="date" id="mcqDate" value="${_ymdKST()}"
            style="width:100%;padding:8px 10px;margin:4px 0 0;border:1px solid var(--border);border-radius:6px;font-size:13px;">
        </div>

        <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="font-weight:700;font-size:13px;">👥 배정 대상</div>
            <button class="btn btn-secondary" style="font-size:11px;padding:3px 10px;" onclick="mcqOpenTargetPicker()">+ 반/학생 선택</button>
          </div>
          <div id="mcqTargetDisplay" style="min-height:40px;font-size:12px;color:var(--gray);display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
            ${_mcqTargets.length ? _mcqTargets.map(t=>`
              <span style="background:#f0fafa;border:1px solid var(--teal-light);border-radius:14px;padding:3px 10px;font-size:11px;display:inline-flex;align-items:center;gap:4px;">
                ${t.type==='class'?'👥':'👤'} ${esc(t.name)}
                <span style="cursor:pointer;color:var(--gray);" onclick="mcqRemoveTarget('${esc(t.id)}')">×</span>
              </span>`).join('') : '<span>대상을 선택하세요</span>'}
          </div>
        </div>

        <button class="btn btn-primary" style="padding:12px;font-size:14px;font-weight:700;" onclick="mcqPublish()">
          🚀 시험 배정하기
        </button>
      </div>
    </div>
  `;
}

window.mcqToggleSet = (setId) => {
  if (_mcqSelectedSets.has(setId)) _mcqSelectedSets.delete(setId);
  else _mcqSelectedSets.add(setId);
  _mcqRender();
};

window.mcqSelectAll = () => {
  _mcqSets.forEach(s => _mcqSelectedSets.add(s.id));
  _mcqRender();
};

window.mcqClearSel = () => {
  _mcqSelectedSets.clear();
  _mcqRender();
};

window.mcqOpenTargetPicker = async () => {
  const html = `
    <div style="width:min(640px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">👥 배정 대상 선택</div>
        <div style="font-size:11px;color:var(--gray);margin-top:5px;">반 체크 = 반 전체 · 학생 체크 = 개별 지정</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div id="mcqPickerSummary" style="padding:6px 10px;background:#f8f9fa;border-radius:6px;font-size:12px;margin-bottom:10px;min-height:30px;display:flex;align-items:center;flex-wrap:wrap;gap:4px;"></div>
        <div id="mcqPickerBox"></div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">닫기</button>
      </div>
    </div>
  `;
  showModal(html);
  await pickerInit({
    boxEl: 'mcqPickerBox',
    summaryEl: 'mcqPickerSummary',
    initialTargets: _mcqTargets,
    allowAll: false,
    emptyText: '반/학생을 선택하세요',
    height: 280,
    onChange: (t) => { _mcqTargets = t; _mcqRender(); },
  });
};

// 옛 mcqTpToggleGroup/Student 는 picker 헬퍼로 흡수 — 외부 호출처 없으면 제거
window._unused_mcqTpToggleGroup_legacy = (g) => {
  const exists = _mcqTargets.find(t => t.type==='class' && t.id===g);
  if (exists) {
    _mcqTargets = _mcqTargets.filter(t => !(t.type==='class' && t.id===g));
  } else {
    _mcqTargets.push({ type:'class', id:g, name:g+' 전체', groupName:g });
  }
};

window.mcqRemoveTarget = (id) => {
  _mcqTargets = _mcqTargets.filter(t => t.id !== id);
  _mcqRender();
};

window.mcqPublish = async () => {
  console.log('[mcqPublish] 호출됨', {
    selectedSetIds: [..._mcqSelectedSets],
    targets: _mcqTargets,
  });

  try {
    const name = document.getElementById('mcqName')?.value.trim();
    const passScore = parseInt(document.getElementById('mcqPassScore')?.value) || 80;
    const date = document.getElementById('mcqDate')?.value || _ymdKST();

    if (_mcqSelectedSets.size === 0) {
      console.warn('[mcqPublish] 중단: 선택된 세트 없음');
      showAlert('입력 확인', '문제 세트를 1개 이상 선택하세요');
      return;
    }
    if (!name) {
      console.warn('[mcqPublish] 중단: 시험명 없음');
      showAlert('입력 확인', '시험명을 입력하세요');
      document.getElementById('mcqName')?.focus();
      return;
    }
    if (_mcqTargets.length === 0) {
      console.warn('[mcqPublish] 중단: 배정 대상 없음');
      showAlert('입력 확인', '배정 대상을 선택하세요');
      return;
    }

    const selectedSets = _mcqSets.filter(s => _mcqSelectedSets.has(s.id));
    const questions = selectedSets.flatMap(s => s.questions || []);
    console.log('[mcqPublish] 합쳐진 문제 수:', questions.length);
    if (questions.length === 0) { showAlert('입력 확인', '선택된 세트에 문제가 없습니다'); return; }

    const summary = `${selectedSets.length}개 세트 · ${questions.length}문제\n대상 ${_mcqTargets.length}명/반\n통과점수 ${passScore}점`;
    const confirmed = await showConfirm(`"${name}" 시험을 배정할까요?`, summary);
    console.log('[mcqPublish] showConfirm 결과:', confirmed);
    if (!confirmed) return;

    const targetType = (_mcqTargets.length===1 && _mcqTargets[0].type==='class') ? 'class' : 'mixed';
    const targetId = _mcqTargets.map(t => t.id).join(',');
    const targetName = _buildTargetName(_mcqTargets);

    const bookName = selectedSets[0]?.sourcePages?.[0]?.pageTitle || '';

    const tIndex = _buildTargetIndex(_mcqTargets);
    const docRef = await addDoc(collection(db,'genTests'), {
      name,
      academy: '큰소리영어',
      academyId: window.MY_ACADEMY_ID || 'default',
      date,
      testMode: 'mcq',
      targetType, targetId, targetName,
      targets: [..._mcqTargets],
      targetUids: tIndex.targetUids,
      targetGroups: tIndex.targetGroups,
      targetAll: tIndex.targetAll,
      active: true,
      questions,
      questionCount: questions.length,
      sourceSetIds: selectedSets.map(s => s.id),
      sourceSetNames: selectedSets.map(s => s.name || ''),
      passScore,
      bookName,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || '',
    });
    console.log('[mcqPublish] genTests 저장 완료 id=', docRef.id);

    showToast(`✓ "${name}" 배정 완료 (${questions.length}문제)`);

    _mcqSelectedSets.clear();
    _mcqTargets = [];

    setTimeout(() => goPage('test-list'), 600);
  } catch(e) {
    console.error('[mcqPublish] 실패', e);
    showToast('배정 실패: '+(e?.message || e));
  }
};

// ──────────────────────────────────────────────
// Phase 2.2 — Disabled 시험 유형 껍데기 렌더러
// ──────────────────────────────────────────────
const _TEST_TYPE_CONFIG = {
  'word': {
    rootId: 'wordAssignRoot',
    kindLabel: '단어',
    sourceType: 'vocab',
    testMode: 'vocab',
    enabled: true,
    phaseLabel: null,
    actions: ['assign', 'print'],
    gradingMode: 'auto',
    hint: '단어시험을 학생앱에 배정하거나 종이 시험지로 출력할 수 있습니다.',
  },
  'unscramble': {
    rootId: 'unscrambleAssignRoot',
    kindLabel: '언스크램블',
    sourceType: 'unscramble',
    testMode: 'unscramble',
    enabled: true,
    phaseLabel: null,
    actions: ['assign', 'print'],
    gradingMode: 'auto',
    hint: '문장 청크 재배열 문제를 학생앱에 배정하거나 종이 시험지로 출력합니다.',
  },
  'blank': {
    rootId: 'blankAssignRoot',
    kindLabel: '빈칸',
    sourceType: 'fill_blank',
    testMode: 'fill_blank',
    enabled: true,
    phaseLabel: null,
    actions: ['assign', 'print'],
    gradingMode: 'auto',
    hint: '빈칸채우기를 학생앱에 배정하거나 시험지로 출력합니다.',
  },
  'mcq': {
    rootId: 'mcqAssignRoot',
    kindLabel: '객관식',
    sourceType: 'mcq',
    testMode: 'mcq',
    enabled: true,
    phaseLabel: null,
    actions: ['assign', 'print'],
    gradingMode: 'auto',
    hint: '본문이해·문법(객관식)을 학생앱에 배정하거나 시험지로 출력합니다.',
  },
  'subj': {
    rootId: 'subjAssignRoot',
    kindLabel: '주관식',
    sourceType: 'subjective',
    testMode: 'subjective',
    enabled: true,
    phaseLabel: null,
    actions: ['print'],
    gradingMode: 'manual',
    hint: '원문 문장 해석 시험지를 프린트합니다. 학생앱 배정은 없습니다.',
  },
  'rec-ai': {
    rootId: 'recAiAssignRoot',
    kindLabel: '녹음',
    sourceType: 'recording',
    testMode: 'recording',
    enabled: true,
    phaseLabel: null,
    actions: ['assign'],
    gradingMode: 'ai',
    hint: 'Page 단위 녹음숙제를 학생앱에 배정합니다. 회차·통과점수·시간은 배정 시 설정. AI 가 정확도를 평가합니다.',
  },
};

function _renderTestAssignShell(type) {
  const cfg = _TEST_TYPE_CONFIG[type];
  if (!cfg) return;
  const root = document.getElementById(cfg.rootId);
  if (!root) return;
  root.innerHTML = `
    <div style="display:flex;gap:16px;align-items:flex-start;">
      <!-- 왼쪽: 문제 세트 선택 (disabled) -->
      <div class="card" style="flex:1;min-width:0;opacity:.45;pointer-events:none;">
        <div style="font-weight:700;font-size:15px;margin-bottom:12px;">① 문제 세트 선택</div>
        <div style="border:1px solid var(--border);border-radius:8px;height:320px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--gray);">
          <div style="font-size:28px;">🔒</div>
          <div style="font-size:13px;font-weight:600;">${esc(cfg.phaseLabel)} 구현 예정</div>
          <div style="font-size:12px;text-align:center;max-width:220px;">${esc(cfg.hint)}</div>
        </div>
      </div>
      <!-- 오른쪽: 배정 대상 + 옵션 (disabled) -->
      <div style="width:320px;flex-shrink:0;display:flex;flex-direction:column;gap:12px;opacity:.45;pointer-events:none;">
        <div class="card">
          <div style="font-weight:700;font-size:15px;margin-bottom:12px;">② 배정 대상</div>
          <div style="border:1px dashed var(--border);border-radius:8px;height:120px;display:flex;align-items:center;justify-content:center;color:var(--gray);font-size:12px;">반 또는 학생을 선택하세요</div>
        </div>
        <div class="card">
          <div style="font-weight:700;font-size:15px;margin-bottom:12px;">③ 시험 옵션</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <label style="font-size:13px;color:var(--gray);">시험 이름<input class="form-input" style="margin-top:4px;" placeholder="자동 생성" disabled></label>
            <label style="font-size:13px;color:var(--gray);">합격 점수<input class="form-input" style="margin-top:4px;" placeholder="70" disabled></label>
          </div>
        </div>
        <button class="btn btn-primary" style="width:100%;" disabled>시험 배정하기</button>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════
// Phase 2.8 — 시험관리 배정 화면 범용 템플릿
// ══════════════════════════════════════════════════════════════════════════
// 5개 서브메뉴(MCQ + 플레이스홀더 4종)가 이 함수 하나로 렌더됨.
// 유형별 _TEST_TYPE_CONFIG[type].enabled 로 실제 쿼리/배정 가능 여부 판별.
// Phase 2 loadMcqAssign / Phase 2.2 _renderTestAssignShell 은 호출 지점만 끊기고
// 함수 자체는 유지 (Phase 6 에서 일괄 정리 예정).
// ══════════════════════════════════════════════════════════════════════════

let _tpSets = [];                   // 현재 활성 폴더의 sets (lazy — 캐시에서 복사)
let _tpGenTests = [];               // 현재 유형의 genTests
let _tpSelectedSets = new Set();    // 체크된 세트 ID
let _activeTestType = null;         // 현재 활성 서브메뉴 type
let _activeTestFolderKey = null;    // null = 미선택 (Book 클릭해야 sets 보임)
let _tpSetsByFolder = {};           // lazy 캐시 — { 'sourceType::bookId': [...sets] }
let _tpLoadingFolder = null;        // 중복 클릭 방지
// 페이지네이션 — 시험관리 최근시험 표 (월초~당일 + 20 + 더보기, 2026-05-13)
let _tpTestsState = { lastDoc: null, exhausted: false };
const TP_PAGE_SIZE = 20;

async function _renderTestAssignDetail(type) {
  const cfg = _TEST_TYPE_CONFIG[type];
  if (!cfg) { console.warn('_renderTestAssignDetail: unknown type', type); return; }

  _activeTestType = type;
  _activeTestFolderKey = null;
  _tpSelectedSets.clear();

  if (!_genBooks.length || !_genChapters.length) {
    try {
      const [bSnap, cSnap] = await Promise.all([
        getDocs(query(collection(db,'genBooks'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('createdAt','asc'))),
        getDocs(query(collection(db,'genChapters'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('order','asc'))),
      ]);
      _genBooks = bSnap.docs.map(d => ({id:d.id, ...d.data()}));
      _genChapters = cSnap.docs.map(d => ({id:d.id, ...d.data()}));
    } catch(e) { console.warn('gen data load:', e); }
  }

  // sets 자체는 Book 폴더 클릭 시 lazy fetch (2026-05-14) — 진입 시 _tpSets 비움
  _tpSets = [];
  if (cfg.enabled && cfg.sourceType) {
    try {
      // actions에 'assign' 이 없으면 genTests 조회 생략 (배정 안 하므로)
      if (!cfg.actions?.includes('assign')) {
        _tpGenTests = [];
      } else {
        // 최근 N개 단순 — testMode server-side + orderBy desc + limit(20) + cursor 더보기.
        // 2026-06-01 옛 '월초~당일' 컷오프 폐기 (월초마다 빈 목록 → 학원장 혼선).
        _tpTestsState.lastDoc = null;
        _tpTestsState.exhausted = false;
        const testSnap = await getDocs(query(
          collection(db,'genTests'),
          where('academyId','==', window.MY_ACADEMY_ID),
          where('testMode','==', cfg.testMode),
          orderBy('createdAt','desc'),
          limit(TP_PAGE_SIZE)
        ));
        _tpGenTests = testSnap.docs.map(d => ({id:d.id, ...d.data()}));
        _tpTestsState.lastDoc = testSnap.docs[testSnap.docs.length - 1] || null;
        _tpTestsState.exhausted = testSnap.size < TP_PAGE_SIZE;
      }
    } catch(e) {
      console.error(e);
      _tpGenTests = [];
      showToast('데이터 로드 실패: '+e.message);
    }
  } else {
    _tpGenTests = [];
  }

  _tpRender();

  if (cfg.enabled && _tpGenTests.length > 0) _tpLoadTestStats();
}

// Book 폴더 클릭 시 lazy fetch — 해당 (sourceType, bookId) sets 조회 + 캐시
async function _tpLazyFetchFolder(bookId) {
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  if (!cfg?.sourceType) return;
  const sourceType = cfg.sourceType;
  const cacheKey = _tpFolderCacheKey(sourceType, bookId);
  if (_tpSetsByFolder[cacheKey]) return;
  if (_tpLoadingFolder === cacheKey) return;
  _tpLoadingFolder = cacheKey;
  try {
    let q;
    if (bookId === '__unassigned__') {
      q = query(
        collection(db,'genQuestionSets'),
        where('academyId','==',window.MY_ACADEMY_ID),
        where('bookId','==',''),
        where('sourceType','==', sourceType),
        orderBy('createdAt','desc')
      );
    } else {
      q = query(
        collection(db,'genQuestionSets'),
        where('academyId','==',window.MY_ACADEMY_ID),
        where('bookId','==', bookId),
        where('sourceType','==', sourceType),
        orderBy('createdAt','desc')
      );
    }
    const snap = await getDocs(q);
    const sets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _tpSetsByFolder[cacheKey] = sets;
  } catch(e) {
    showToast('폴더 조회 실패: ' + e.message);
  } finally {
    _tpLoadingFolder = null;
  }
}

// 시험관리 sets 캐시 무효화 (sets 삭제 후 등)
function _tpInvalidateSetsCache() {
  _tpSetsByFolder = {};
  _tpSets = [];
}

function _tpRender() {
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  const root = document.getElementById(cfg.rootId);
  if (!root) return;

  // 재렌더 시 스크롤 위치 보존 — sets pane(체크박스 토글) + tests pane(더 보기 후 위치 유지)
  const prevScroll = document.getElementById('tpSetsScroll')?.scrollTop || 0;
  const prevTestsScroll = document.getElementById('tpTestsScroll')?.scrollTop || 0;

  const folders = _tpBuildFolders();
  // 활성 폴더 캐시에서 _tpSets 채우기 (lazy — 폴더 클릭 시 fetch)
  if (_activeTestFolderKey != null && cfg.sourceType) {
    const cacheKey = _tpFolderCacheKey(cfg.sourceType, _activeTestFolderKey);
    const cached = _tpSetsByFolder[cacheKey];
    _tpSets = Array.isArray(cached) ? cached : [];
  } else {
    _tpSets = [];
  }
  const filteredSets = _tpSets;
  const folderLoading = _activeTestFolderKey != null && _tpLoadingFolder === _tpFolderCacheKey(cfg.sourceType, _activeTestFolderKey);
  const folderUnselected = _activeTestFolderKey == null;

  root.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;height:calc(100vh - 180px);min-height:560px;">

      <div id="tpTopRow" style="display:flex;gap:0;flex:1;min-height:0;">

        <div id="tpSetsPane" style="flex:1 1 50%;min-width:200px;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden;">
          <div style="padding:12px 16px;background:#f8f9fa;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:14px;">📚 문제 세트 ${_activeTestFolderKey?'<span style="color:var(--teal);font-size:11px;font-weight:500;">(Book 폴더)</span>':''}</div>
              <div style="font-size:11px;color:var(--gray);">
                선택 <span style="color:var(--teal);font-weight:700;">${_tpSelectedSets.size}</span>개${filteredSets.length>0 ? ' · '+filteredSets.length+'개 표시' : ''}
              </div>
            </div>
            <div style="display:flex;gap:5px;flex-shrink:0;">
              <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="tpSelectAll()" ${!cfg.enabled||filteredSets.length===0?'disabled':''}>전체</button>
              <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="tpClearSel()" ${_tpSelectedSets.size===0?'disabled':''}>해제</button>
              ${cfg.actions?.includes('assign') ? `
                <button class="btn btn-primary" style="font-size:12px;padding:5px 14px;font-weight:700;" onclick="tpOpenPublishModal()" ${!cfg.enabled||_tpSelectedSets.size===0?'disabled':''}>
                  📝 시험 출제
                </button>` : ''}
              ${cfg.actions?.includes('print') ? `
                <button class="btn ${cfg.actions.includes('assign')?'btn-secondary':'btn-primary'}" style="font-size:12px;padding:5px 14px;font-weight:700;" onclick="tpOpenPrintModal()" ${!cfg.enabled||_tpSelectedSets.size===0?'disabled':''}>
                  🖨 시험지 출력
                </button>` : ''}
              <button class="btn" style="font-size:12px;padding:5px 14px;font-weight:700;background:#dc2626;color:white;border:none;${!cfg.enabled||_tpSelectedSets.size===0?'opacity:0.4;cursor:not-allowed;':''}"
                onclick="tpDeleteSelectedSets()" ${!cfg.enabled||_tpSelectedSets.size===0?'disabled':''}>
                🗑 삭제
              </button>
            </div>
          </div>
          <div id="tpSetsScroll" style="flex:1;overflow-y:auto;">
            ${!cfg.enabled
              ? _tpRenderDisabledState(cfg)
              : (folderUnselected
                  ? `<div style="padding:30px;text-align:center;color:#bbb;font-size:12px;">→ 우측에서 Book 폴더를 선택하세요</div>`
                  : (folderLoading
                      ? `<div style="padding:30px;text-align:center;color:#bbb;font-size:12px;">불러오는 중...</div>`
                      : (filteredSets.length === 0
                          ? _tpRenderNoSets(cfg)
                          : filteredSets.map(s => _tpRenderSetRow(s)).join('')
                        )
                    )
                )
            }
          </div>
        </div>

        <div id="tpResizer" title="드래그하여 폭 조정" style="width:8px;cursor:col-resize;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:transparent;">
          <div style="width:2px;height:40px;background:var(--border);border-radius:1px;"></div>
        </div>

        <div id="tpFoldersPane" style="flex:1 1 50%;min-width:200px;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden;">
          <div style="padding:12px 16px;background:#f8f9fa;border-bottom:1px solid var(--border);">
            <div style="font-weight:700;font-size:14px;">📁 Book 폴더</div>
            <div style="font-size:11px;color:var(--gray);">클릭하면 그 폴더의 문제세트가 좌측에 표시됩니다</div>
          </div>
          <div style="flex:1;overflow-y:auto;">
            ${folders.length === 0
              ? '<div style="padding:16px;text-align:center;color:#bbb;font-size:11px;">Book 폴더가 없습니다</div>'
              : folders.map(f => _tpRenderFolderItem(f, f.key === _activeTestFolderKey)).join('')
            }
          </div>
        </div>

      </div>

      <!-- 상·하 수직 리사이저 -->
      <div id="tpVResizer" title="드래그하여 상·하 비율 조정" style="height:8px;cursor:row-resize;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:transparent;">
        <div style="width:40px;height:2px;background:var(--border);border-radius:1px;"></div>
      </div>

      <div id="tpBottomSection" style="background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden;height:280px;flex-shrink:0;min-height:120px;">
        <div style="padding:12px 16px;background:#f8f9fa;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;font-size:14px;">${cfg.actions?.includes('assign') ? '📊 최근 시험' : '🖨 시험지 출력 전용'} <span style="color:var(--gray);font-weight:400;font-size:12px;">· ${esc(cfg.kindLabel)} 유형</span></div>
            <div style="font-size:11px;color:var(--gray);">${cfg.actions?.includes('assign') ? _tpGenTests.length + '개 · 최근순 · 행 클릭 시 응시 현황' : '인쇄 전용 — 출제 이력 저장 없음'}</div>
          </div>
          ${cfg.actions?.includes('assign') ? `<button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="tpAssignRefresh()">↻ 새로고침</button>` : ''}
        </div>
        <div id="tpTestsScroll" style="flex:1;overflow-y:auto;">
          ${!cfg.enabled
            ? `<div style="padding:30px;text-align:center;color:var(--gray);font-size:12px;">${esc(cfg.phaseLabel)} 에서 활성화되면 이곳에 출제된 시험이 표시됩니다</div>`
            : (!cfg.actions?.includes('assign')
                ? '<div style="padding:30px;text-align:center;color:var(--gray);font-size:12px;">🖨 시험지 전용 유형이라 출제 이력을 저장하지 않습니다. 위에서 세트를 선택하고 [🖨 시험지 출력] 을 누르세요.</div>'
                : (_tpGenTests.length === 0
                    ? '<div style="padding:30px;text-align:center;color:var(--gray);font-size:12px;">아직 출제된 시험이 없습니다. 위에서 문제 세트를 선택하고 [📝 시험 출제] 를 눌러 배정하세요.</div>'
                    : _tpRenderTestsTable()
                  )
              )
          }
        </div>
      </div>

    </div>
  `;

  _tpAttachResizer(root);
  _tpAttachVResizer(root);

  // 스크롤 위치 복원 — sets pane(체크박스 토글) + tests pane(더 보기 후 위치)
  if (prevScroll > 0) {
    const newEl = document.getElementById('tpSetsScroll');
    if (newEl) newEl.scrollTop = prevScroll;
  }
  if (prevTestsScroll > 0) {
    const newEl = document.getElementById('tpTestsScroll');
    if (newEl) newEl.scrollTop = prevTestsScroll;
  }
}

function _tpAttachResizer(scope) {
  const root = scope || document;
  const row = root.querySelector('#tpTopRow');
  const setsPane = root.querySelector('#tpSetsPane');
  const resizer = root.querySelector('#tpResizer');
  if (!row || !setsPane || !resizer) return;

  const storageKey = 'test_assign_sets_ratio_' + (_activeTestType || 'default');
  const saved = parseFloat(localStorage.getItem(storageKey));
  if (saved && saved > 0.15 && saved < 0.85) {
    setsPane.style.flex = `0 0 calc(${saved*100}% - 4px)`;
  }

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const onMove = (ev) => {
      let ratio = (ev.clientX - rect.left) / rect.width;
      ratio = Math.max(0.2, Math.min(0.85, ratio));
      setsPane.style.flex = `0 0 calc(${ratio*100}% - 4px)`;
      try { localStorage.setItem(storageKey, String(ratio)); } catch {}
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  resizer.addEventListener('mouseenter', () => { resizer.style.background = 'var(--teal-light)'; });
  resizer.addEventListener('mouseleave', () => { resizer.style.background = 'transparent'; });
}

// 상·하 비율 리사이저 (시험관리 유형별 독립 저장)
function _tpAttachVResizer(scope) {
  const root = scope || document;
  const bottom = root.querySelector('#tpBottomSection');
  const resizer = root.querySelector('#tpVResizer');
  if (!bottom || !resizer) return;

  const storageKey = 'test_assign_bottom_height_px_' + (_activeTestType || 'default');
  const saved = parseInt(localStorage.getItem(storageKey), 10);
  if (saved && saved >= 120 && saved <= 2000) {
    bottom.style.height = saved + 'px';
  }

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const container = bottom.parentElement;
    const rect = container.getBoundingClientRect();
    const onMove = (ev) => {
      // 마우스 Y 기준 하단 높이 = 컨테이너 하단 - 마우스 Y - 리사이저 높이/2
      let newH = rect.bottom - ev.clientY;
      newH = Math.max(120, Math.min(rect.height - 180, newH));  // 상단 최소 180px 보장
      bottom.style.height = newH + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      try { localStorage.setItem(storageKey, String(parseInt(bottom.style.height))); } catch {}
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  resizer.addEventListener('mouseenter', () => { resizer.style.background = 'var(--teal-light)'; });
  resizer.addEventListener('mouseleave', () => { resizer.style.background = 'transparent'; });
}

// 폴더 키 — sets 의 top-level bookId 우선, 폴백 sourcePages[0].bookId (Book 단위만 — 2026-05-14)
function _tpFolderKeyOf(set) {
  if (typeof set.bookId === 'string' && set.bookId) return set.bookId;
  const sp = (set.sourcePages && set.sourcePages[0]) || {};
  return sp.bookId || '__unassigned__';
}

// 폴더 리스트 = _genBooks 직접 빌드 (sets 무관, lazy 적용). 카운트는 캐시 hit 시만 정확.
// _activeTestType 의 sourceType 에 매칭되는 캐시만 카운트.
function _tpBuildFolders() {
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  const sourceType = cfg?.sourceType || '';
  const folders = _genBooks.map(b => {
    const cacheKey = _tpFolderCacheKey(sourceType, b.id);
    const cache = _tpSetsByFolder[cacheKey];
    const count = Array.isArray(cache) ? cache.length : null;
    return {
      key: b.id,
      name: b.name || '(이름 없음)',
      bookId: b.id,
      count,
      isUnassigned: false,
    };
  });
  // 미지정 폴더 — 항상 표시 (캐시 hit 시 count 채움, 미스면 ? · 클릭 시 lazy fetch)
  const unCacheKey = _tpFolderCacheKey(sourceType, '__unassigned__');
  const unCache = _tpSetsByFolder[unCacheKey];
  folders.push({
    key: '__unassigned__',
    name: '(책 없음)',
    bookId: '',
    count: Array.isArray(unCache) ? unCache.length : null,
    isUnassigned: true,
  });
  // 이름순 고정 (클릭해도 위치 변동 X), 미지정 폴더는 맨 마지막
  return folders.sort((a, b) => {
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
    return a.name.localeCompare(b.name, 'ko');
  });
}

function _tpFolderCacheKey(sourceType, bookId) {
  return `${sourceType}::${bookId}`;
}

function _tpRenderFolderItem(f, isActive) {
  const bg = isActive ? 'background:var(--teal-light);color:var(--teal);' : '';
  const fontW = isActive ? 'font-weight:700;' : 'font-weight:500;';
  const onclick = `tpSelectFolder('${esc(f.key)}')`;
  const cntLabel = (f.count == null) ? '?' : (f.count + '개');
  return `
    <div onclick="${onclick}"
      style="padding:10px 14px;border-bottom:1px solid #f5f5f5;cursor:pointer;font-size:12px;${bg}${fontW}display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📁 ${esc(f.name)}</span>
      <span style="font-size:10px;color:${isActive?'var(--teal)':'var(--gray)'};flex-shrink:0;">${cntLabel}</span>
    </div>`;
}

function _tpRenderSetRow(s) {
  const checked = _tpSelectedSets.has(s.id) ? 'checked' : '';
  const date = s.createdAt?.toDate ? s.createdAt.toDate() : null;
  const dateStr = date ? date.toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-';
  const qCount = s.questionCount || s.questions?.length || 0;
  const sp = (s.sourcePages && s.sourcePages[0]) || {};
  const book = _genBooks.find(b => b.id === sp.bookId);
  const chap = _genChapters.find(c => c.id === sp.chapterId);
  const folderName = [book?.name, chap?.name].filter(Boolean).join(' · ');

  return `
    <div onclick="qsViewDetail('${esc(s.id)}')"
      style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:center;cursor:pointer;${_tpSelectedSets.has(s.id)?'background:#fff8e6;':''}">
      <input type="checkbox" ${checked} onclick="event.stopPropagation();tpToggleSet('${esc(s.id)}')" style="flex-shrink:0;" title="시험 배정 선택">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name||'(이름 없음)')}</div>
        <div style="font-size:11px;color:var(--gray);margin-top:2px;">
          ${qCount}문제 · ${esc(dateStr)}${!_activeTestFolderKey && folderName ? ' · 📁 '+esc(folderName) : ''}
        </div>
      </div>
    </div>`;
}

function _tpRenderDisabledState(cfg) {
  return `
    <div style="padding:60px 40px;text-align:center;color:var(--gray);display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;">
      <div style="font-size:40px;margin-bottom:12px;">🚧</div>
      <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px;">아직 ${esc(cfg.kindLabel)} 문제 세트가 없습니다</div>
      <div style="font-size:12px;line-height:1.6;max-width:380px;">${esc(cfg.hint)}</div>
    </div>`;
}

function _tpRenderNoSets(cfg) {
  if (_activeTestFolderKey) {
    return `
      <div style="padding:40px;text-align:center;color:var(--gray);">
        <div style="font-size:32px;margin-bottom:10px;">📭</div>
        <div style="font-size:13px;margin-bottom:10px;">이 Book 폴더에 ${esc(cfg.kindLabel)} 세트가 없습니다</div>
        <div style="font-size:11px;color:#bbb;">다른 Book 폴더를 선택하거나 AI Generator 에서 새로 만드세요</div>
      </div>`;
  }
  return `
    <div style="padding:40px;text-align:center;color:var(--gray);">
      <div style="font-size:32px;margin-bottom:10px;">📭</div>
      <div style="font-size:13px;margin-bottom:10px;">배정 가능한 ${esc(cfg.kindLabel)} 문제 세트가 없습니다</div>
      <button class="btn btn-primary" onclick="goPage('quiz-generate')">✨ AI Generator 바로가기</button>
    </div>`;
}

function _tpRenderTestsTable() {
  // 시험 목록 페이지(testListBody)와 컬럼 통일 — 유형·체크박스만 제외, 작업(행별 🗑 삭제) 추가
  const loadMoreHtml = _tpTestsState.exhausted
    ? '<div style="text-align:center;color:#888;padding:10px;font-size:12px;">모두 표시됨</div>'
    : '<button class="btn btn-secondary" style="margin:10px auto;display:block;" onclick="loadMoreTpTests()">+ 더 보기</button>';
  return `
    <table style="width:100%;border-collapse:collapse;">
      <thead style="background:#f8f9fa;position:sticky;top:0;z-index:1;">
        <tr>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);width:50px;">No</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);">시험명</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);width:160px;">대상</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);">교재</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);width:80px;">문항수</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);width:130px;">출제일</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);width:110px;" title="통과자 / 응시자 / 대상자 (고유 학생 수)">통과/응시/대상</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);width:80px;">평균</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);width:90px;">작업</th>
        </tr>
      </thead>
      <tbody>
        ${_tpGenTests.map((t, i) => _tpRenderTestRow(t, i)).join('')}
      </tbody>
    </table>
    ${loadMoreHtml}`;
}

window.loadMoreTpTests = async() => {
  if (_tpTestsState.exhausted || !_tpTestsState.lastDoc) return;
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  if (!cfg) return;
  try {
    const snap = await getDocs(query(
      collection(db,'genTests'),
      where('academyId','==', window.MY_ACADEMY_ID),
      where('testMode','==', cfg.testMode),
      orderBy('createdAt','desc'),
      startAfter(_tpTestsState.lastDoc),
      limit(TP_PAGE_SIZE)
    ));
    const newTests = snap.docs.map(d => ({id:d.id, ...d.data()}));
    _tpTestsState.lastDoc = snap.docs[snap.docs.length - 1] || _tpTestsState.lastDoc;
    _tpTestsState.exhausted = snap.size < TP_PAGE_SIZE;
    _tpGenTests = _tpGenTests.concat(newTests);
    _tpRender();
    if (newTests.length) _tpLoadTestStats();  // 새 시험들의 통계 부착
  } catch(e) { console.error('loadMoreTpTests:', e); }
};

function _tpRenderTestRow(t, i) {
  const qCount = t.questionCount || t.questions?.length || 0;
  const bookName = t.bookName || t.sourceSetNames?.join(', ') || '-';
  const cellBase = 'padding:10px 12px;border-bottom:1px solid #f5f5f5;';
  return `
    <tr style="cursor:pointer;" onclick="tpToggleTestProgress('${esc(t.id)}','tp')" id="tp-row-${t.id}">
      <td style="${cellBase}font-size:12px;color:var(--gray);">${(i||0)+1}</td>
      <td style="${cellBase}font-size:13px;font-weight:600;color:var(--text);">${esc(t.name||'-')}${_testNameBadges(t)}
        ${_tpEditNameBtnHtml(t)}
      </td>
      <td style="${cellBase}font-size:12px;"><span class="badge badge-teal">${esc(_buildTargetName(t.targets) || t.targetName || '-')}</span></td>
      <td style="${cellBase}font-size:12px;color:var(--text);max-width:180px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${esc(bookName)}">${esc(bookName)}</td>
      <td style="${cellBase}text-align:center;font-size:12px;color:var(--text);">${qCount}문제</td>
      <td style="${cellBase}font-size:11px;color:var(--gray);white-space:nowrap;">${_fmtTestDateTime(t)}</td>
      <td style="${cellBase}text-align:center;font-size:11px;white-space:nowrap;" id="tp-attempt-${t.id}"><span style="color:#ccc;">…</span></td>
      <td style="${cellBase}text-align:center;" id="tp-avg-${t.id}"><span style="color:#ccc;">…</span></td>
      <td style="${cellBase}text-align:center;">
        <button onclick="event.stopPropagation();tpDeleteGenTest('${esc(t.id)}')" style="padding:6px 12px;font-size:12px;background:white;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;font-weight:600;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;" title="시험 삭제"><span style="font-size:16px;line-height:1;">${iconSvg('trash')}</span>삭제</button>
      </td>
    </tr>
    <tr id="tp-progress-${t.id}" style="display:none;background:#f0faff;">
      <td colspan="9" style="padding:0;">
        <div id="tp-progress-content-${t.id}" style="padding:10px 16px;font-size:12px;color:var(--gray);">로딩 중...</div>
      </td>
    </tr>`;
}

async function _tpLoadTestStats() {
  try {
    // 시험관리 표에 나온 시험 ID 만 scores in 쿼리 (학원 전체 X, 2026-05-13)
    const testIds = (_tpGenTests || []).map(t => t.id);
    const allScores = await _tlLoadScoresForTests(testIds);

    // 학생 전체 로드 (대상자 계산용)
    if (!Array.isArray(allStudents) || allStudents.length === 0) {
      try {
        const sSnap = await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID), where('role','==','student')));
        allStudents = sSnap.docs.map(d => ({ id:d.id, ...d.data() }));
      } catch(e) { console.warn('학생 로드 실패:', e); }
    }

    _tpGenTests.forEach(t => {
      const scoresArr = allScores.filter(s => s.testId === t.id);
      const stats = _computeTestStats(t, scoresArr, allStudents);
      const elA = document.getElementById('tp-attempt-' + t.id);
      const elB = document.getElementById('tp-avg-' + t.id);
      if (elA) {
        elA.innerHTML = `
          <span style="color:#2e7d32;font-weight:700;" title="통과자">${stats.passedCount}</span>
          <span style="color:var(--gray);">/</span>
          <span style="color:#1565c0;font-weight:600;" title="응시자(고유)">${stats.attemptedCount}</span>
          <span style="color:var(--gray);">/</span>
          <span style="color:var(--text);" title="대상자">${stats.targetCount||'-'}</span>`;
      }
      if (elB) {
        if (stats.avg !== null) {
          const cls = stats.avg>=80 ? 'badge-green' : (stats.avg>=60 ? 'badge-amber' : 'badge-red');
          elB.innerHTML = `<span class="badge ${cls}">${stats.avg}점</span>`;
        } else {
          elB.textContent = '-';
        }
      }
    });
  } catch(e) { console.warn('_tpLoadTestStats', e); }
}

window.tpSelectFolder = async (key) => {
  _activeTestFolderKey = key;
  _tpSelectedSets.clear(); // 폴더 바꿀 때 선택 초기화 (다른 폴더 sets 와 섞이지 않게)
  _tpRender(); // 즉시 로딩 표시
  if (key != null) await _tpLazyFetchFolder(key);
  _tpRender();
};

window.tpToggleSet = (setId) => {
  if (_tpSelectedSets.has(setId)) _tpSelectedSets.delete(setId);
  else _tpSelectedSets.add(setId);
  _tpRender();
};

window.tpSelectAll = () => {
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  if (!cfg?.enabled) return;
  const filtered = _activeTestFolderKey
    ? _tpSets.filter(s => _tpFolderKeyOf(s) === _activeTestFolderKey)
    : _tpSets;
  filtered.forEach(s => _tpSelectedSets.add(s.id));
  _tpRender();
};

window.tpClearSel = () => {
  _tpSelectedSets.clear();
  _tpRender();
};

// 시험에서 특정 학생 제외 — excludedUids 추가 + userCompleted 삭제 + scores 매칭 삭제
// 잘못 배정된 학생의 응시 기록이 성장 리포트에 영향 주지 않도록 완전 제거
// 복구 UI 없음 — 다시 보게 하려면 시험 새로 배정
window.tpExcludeStudent = async (testId, uid, studentName, btnEl) => {
  if (!testId || !uid) return;
  if (!(await showConfirm(
    `"${studentName || '학생'}" 시험 제외`,
    `이 학생을 시험에서 제외하고 응시 기록(점수·완료 스냅샷)도 모두 삭제합니다.\n학생 앱 시험 목록에서 사라지며, 성장 리포트에서도 제외됩니다.\n\n되돌릴 수 없습니다. 다시 보게 하려면 시험을 새로 배정해야 합니다.`
  ))) return;
  try {
    // 1. excludedUids 에 추가 (학생 앱 시험 목록 차단)
    await updateDoc(doc(db, 'genTests', testId), {
      excludedUids: arrayUnion(uid),
    });
    // 2. userCompleted 스냅샷 삭제 (있으면)
    try { await deleteDoc(doc(db, 'genTests', testId, 'userCompleted', uid)); } catch(_) {}
    // 3. scores 에서 testId+uid 매칭 일괄 삭제
    try {
      const sSnap = await getDocs(query(
        collection(db, 'scores'),
        where('academyId', '==', window.MY_ACADEMY_ID),
        where('testId', '==', testId),
        where('uid', '==', uid),
      ));
      for (const sd of sSnap.docs) {
        try { await deleteDoc(sd.ref); } catch(_) {}
      }
    } catch(e) { console.warn('[tpExcludeStudent] scores cleanup:', e.message); }
    showToast('✓ 학생 제외 완료');
    // 재조회 없이 그 카드만 희미하게(취소선) 처리 — 여러 명 지워도 fetch 0회.
    // 통계·목록은 그 시험을 다시 펼칠 때 갱신됨.
    const card = btnEl && btnEl.parentElement;
    if (card) {
      card.style.opacity = '0.4';
      card.style.textDecoration = 'line-through';
      card.style.pointerEvents = 'none';
      card.style.filter = 'grayscale(1)';
      card.title = '제외됨 (다시 펼치면 사라짐)';
      if (btnEl) btnEl.remove();
    } else {
      // btnEl 없을 때만 폴백 — 펼침 닫고 다시 (재조회)
      await tpToggleTestProgress(testId);
      await tpToggleTestProgress(testId);
    }
  } catch(e) {
    showAlert('제외 실패', e.message);
  }
};

// 녹음숙제 AI 재평가 — eval 에러 / 미통과 케이스 구제
// userCompleted.recordings 마지막 audioUrl 로 /api/adminAction (reEvaluateRecording) 호출
// 서버가 check-recording 재호출 + userCompleted 갱신 + scores doc 추가 (admin SDK)
// 학원 녹음 월 한도 +1 차감
window.tpReEvaluateRecording = async (testId, uid, studentName) => {
  if (!testId || !uid) return;
  if (!(await showConfirm(
    `"${studentName || '학생'}" AI 재평가`,
    `Storage 에 저장된 마지막 녹음을 AI 가 다시 평가합니다.\n학원 녹음 월 한도가 +1 차감됩니다.\n\n결과는 통과/미통과 모두 학원장·학생 화면에 반영됩니다.`
  ))) return;
  try {
    showToast('🤖 AI 재평가 중... (10~20초)');
    const idToken = await currentUser.getIdToken();
    if (!idToken) { showAlert('재평가 실패', '로그인 토큰 없음'); return; }
    const r = await fetch('/api/adminAction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        action: 'reEvaluateRecording',
        testId, uid,
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.success) {
      showAlert('재평가 실패', data.error || `HTTP ${r.status}`);
      return;
    }
    const msg = data.passed
      ? `✓ 재평가 완료 — ${data.score}점 (통과)`
      : `⚠ 재평가 완료 — ${data.score}점 (미통과)`;
    showToast(msg);
    // 펼침 화면 다시 그리기 — 같은 행 다시 클릭하면 갱신된 상태 표시
    await tpToggleTestProgress(testId);
    await tpToggleTestProgress(testId);
  } catch(e) {
    showAlert('재평가 실패', e.message);
  }
};

// 시험(genTests) 단건 삭제 — 하위 userCompleted 도 cascade 삭제. scores 는 보존(이력 가치).
// 2026-05-24 — 시험 제목 편집 (genTests.name + scores.testName + userCompleted.testName 일괄 update)
// 학원장 오타 fix 등에 사용. 점수·정답·통과여부 등은 보존하고 testName 만 덮어씀.
// 시험명 편집 ✏️ 버튼 HTML (3경로 공용). 인라인 onclick 인자 대신 data-* 속성 —
// 시험명에 따옴표(' ")가 있어도 onclick JS 문자열·속성이 안 깨짐 (HTML 엔티티 디코딩 함정 회피).
function _tpEditNameBtnHtml(t){
  return `<button data-eid="${esc(t.id)}" data-ename="${esc(t.name||'')}" onclick="event.stopPropagation();tpEditTestName(this)" title="시험명 편집" style="margin-left:6px;background:none;border:none;cursor:pointer;color:var(--gray);font-size:12px;opacity:0.4;padding:2px 4px;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.4'">${iconSvg('edit')}</button>`;
}

// 호출: tpEditTestName(buttonEl) — data-eid/data-ename 에서 읽음 (구 시그니처 testId,name 도 폴백).
window.tpEditTestName = async (elOrId, maybeName) => {
  let testId, currentName;
  if (elOrId && typeof elOrId === 'object' && elOrId.dataset) {
    testId = elOrId.dataset.eid;
    currentName = elOrId.dataset.ename || '';
  } else {
    testId = elOrId;
    currentName = maybeName || '';
  }
  const cur = String(currentName || '').trim();
  const newName = await _showInputModal('시험 제목 편집', '새 시험 제목을 입력하세요', cur);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) { showAlert('입력 확인', '시험 제목은 비울 수 없습니다'); return; }
  if (trimmed === cur) return;
  if (!(await showConfirm(
    `시험 제목을 변경할까요?`,
    `"${cur}" → "${trimmed}"\n\n학생 응시 기록의 시험명도 함께 변경됩니다.\n점수·정답·통과 여부 등은 그대로 보존.`
  ))) return;

  try {
    // 1) genTests 본체
    await updateDoc(doc(db, 'genTests', testId), { name: trimmed });

    // 2) scores 일괄 update (그 시험에 응시한 모든 학생·재응시) — writeBatch 500건/회
    const sSnap = await getDocs(query(
      collection(db, 'scores'),
      where('academyId', '==', window.MY_ACADEMY_ID),
      where('testId', '==', testId),
    ));
    let scoreUpdated = 0;
    const docs = sSnap.docs;
    for (let i = 0; i < docs.length; i += 450) {
      const batch = writeBatch(db);
      docs.slice(i, i + 450).forEach(d => batch.update(d.ref, { testName: trimmed }));
      await batch.commit();
      scoreUpdated += Math.min(450, docs.length - i);
    }

    // 3) userCompleted 일괄 update (통과 학생 스냅샷)
    const ucSnap = await getDocs(collection(db, 'genTests', testId, 'userCompleted'));
    let ucUpdated = 0;
    const ucDocs = ucSnap.docs.filter(d => d.data().testName !== undefined);
    for (let i = 0; i < ucDocs.length; i += 450) {
      const batch = writeBatch(db);
      ucDocs.slice(i, i + 450).forEach(d => batch.update(d.ref, { testName: trimmed }));
      await batch.commit();
      ucUpdated += Math.min(450, ucDocs.length - i);
    }

    showToast(`✓ 시험명 변경 — scores ${scoreUpdated}건 · userCompleted ${ucUpdated}건 동기`);

    // 현재 화면 갱신 (어디서 호출돼도 안전 — 활성 화면만 영향)
    if (typeof _renderTestAssignDetail === 'function' && _activeTestType) {
      await _renderTestAssignDetail(_activeTestType);
    }
    if (typeof loadTestList === 'function' && document.getElementById('testListBody')) {
      // 통합 시험목록 화면에 있다면 다시 로드
      const visible = document.getElementById('progPanelTest')?.style.display !== 'none';
      if (visible) loadTestList();
    }
  } catch (e) {
    console.error('[tpEditTestName]', e);
    showAlert('시험명 변경 실패', e.message);
  }
};

// 입력 모달 (prompt 대안 — showModal 기반)
function _showInputModal(title, sub, defaultVal) {
  return new Promise(resolve => {
    const id = 'inp-' + Math.random().toString(36).slice(2);
    const html = `
      <div style="width:min(480px,92vw);">
        <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
          <div style="font-size:16px;font-weight:700;">${esc(title)}</div>
          ${sub ? `<div style="font-size:12px;color:var(--gray);margin-top:4px;">${esc(sub)}</div>` : ''}
        </div>
        <div style="padding:18px 22px;">
          <input type="text" id="${id}" value="${esc(defaultVal || '')}"
            style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;outline:none;"
            onkeydown="if(event.key==='Enter'){document.getElementById('${id}-ok').click();}else if(event.key==='Escape'){document.getElementById('${id}-cancel').click();}">
        </div>
        <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
          <button id="${id}-cancel" class="btn btn-secondary">취소</button>
          <button id="${id}-ok" class="btn btn-primary">확인</button>
        </div>
      </div>`;
    showModal(html);
    setTimeout(() => {
      const input = document.getElementById(id);
      if (input) { input.focus(); input.select(); }
      document.getElementById(id + '-ok').onclick = () => {
        const v = document.getElementById(id)?.value || '';
        closeModal();
        resolve(v);
      };
      document.getElementById(id + '-cancel').onclick = () => {
        closeModal();
        resolve(null);
      };
    }, 50);
  });
}

window.tpDeleteGenTest = async (testId) => {
  const t = _tpGenTests.find(x => x.id === testId);
  if (!t) return;
  if (!(await showConfirm(
    `"${t.name || '시험'}" 삭제`,
    `시험과 응시 기록(userCompleted)을 모두 삭제합니다.\n학생 성적(scores)은 보존됩니다.\n되돌릴 수 없습니다.`
  ))) return;
  try {
    // 하위 userCompleted 먼저 삭제 (소량이라 순차)
    const ucSnap = await getDocs(collection(db, 'genTests', testId, 'userCompleted'));
    for (const ud of ucSnap.docs) {
      try { await deleteDoc(ud.ref); } catch(_) {}
    }
    await deleteDoc(doc(db, 'genTests', testId));
    showToast('✓ 시험 삭제됨');
    await _renderTestAssignDetail(_activeTestType);
  } catch(e) {
    showAlert('삭제 실패', e.message);
  }
};

window.tpDeleteSelectedSets = async () => {
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  if (!cfg?.enabled) return;
  if (_tpSelectedSets.size === 0) { showAlert('입력 확인', '삭제할 문제 세트를 선택하세요'); return; }

  const ids = Array.from(_tpSelectedSets);
  const names = _tpSets.filter(s => ids.includes(s.id)).map(s => s.name).filter(Boolean);
  const preview = names.slice(0, 5).map(n => `• ${n}`).join('\n') + (names.length > 5 ? `\n... 외 ${names.length - 5}개` : '');

  if (!(await showConfirm(
    `${ids.length}개 문제 세트 삭제`,
    `다음 세트를 삭제합니다:\n\n${preview}\n\n되돌릴 수 없습니다. 이 세트로 만든 시험(genTests)이 있다면 그대로 유지됩니다.`
  ))) return;

  let success = 0, fail = 0;
  for (const id of ids) {
    try {
      await deleteDoc(doc(db, 'genQuestionSets', id));
      success++;
    } catch (e) {
      console.warn('[tpDeleteSelectedSets]', id, e.message);
      fail++;
    }
  }
  _tpSelectedSets.clear();
  _tpInvalidateSetsCache();
  if (typeof _qsList !== 'undefined') { _qsList = []; _qsSetsByBook = {}; } // quiz-sets 캐시도 무효화
  showToast(fail === 0 ? `✓ ${success}개 세트 삭제됨` : `${success}개 삭제 / ${fail}개 실패`);
  _activeTestFolderKey = null; // 폴더 미선택 상태로
  await _renderTestAssignDetail(_activeTestType);
};

window.tpOpenPublishModal = async () => {
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  if (!cfg?.enabled) return;
  if (_tpSelectedSets.size === 0) { showAlert('입력 확인', '문제 세트를 선택하세요'); return; }

  const selectedSets = _tpSets.filter(s => _tpSelectedSets.has(s.id));
  const questions = selectedSets.flatMap(s => s.questions || []);
  if (questions.length === 0) { showAlert('입력 확인', '선택된 세트에 문제가 없습니다'); return; }

  // 시험명 기본값: 선택된 세트 이름 (1개면 그대로, 여러 개면 "첫이름 외 N")
  const defaultName = selectedSets.length === 1
    ? (selectedSets[0].name || `${cfg.kindLabel} 시험`)
    : `${selectedSets[0]?.name || cfg.kindLabel} 외 ${selectedSets.length - 1}`;

  const html = `
    <div style="width:min(720px,94vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;">${iconSvg('pen')} 시험출제</div>
        <div style="font-size:11px;color:var(--gray);margin-top:4px;">
          ${esc(cfg.kindLabel)} · ${selectedSets.length}개 세트 · 총 ${questions.length}문제
        </div>
      </div>

      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="margin-bottom:16px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:8px;">${iconSvg('clipboard')} 시험 정보</div>
          <div style="display:grid;grid-template-columns:1fr ${['vocab','fill_blank','unscramble'].includes(cfg.testMode) ? '90px ' : ''}85px 95px 140px;gap:8px;">
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--gray);">시험명 *</label>
              <input type="text" id="tpName" value="${esc(defaultName)}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:3px;">
            </div>
            ${['vocab','fill_blank','unscramble'].includes(cfg.testMode) ? `
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--gray);">제한시간(초)</label>
              <input type="number" id="tpTimeLimit" value="30" min="5" max="120" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:3px;" title="문제당 풀이 시간 (5~120초)">
              <div style="font-size:10px;color:var(--gray);margin-top:2px;">문제당</div>
            </div>` : ''}
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--gray);">통과점수</label>
              ${cfg.testMode === 'recording'
                ? `<div style="padding:8px 10px;font-size:11px;color:var(--gray);margin-top:3px;background:#f9fafb;border-radius:6px;border:1px solid var(--border);line-height:1.3;">제출 완료<br><span style="font-size:9px;">(통과/불통 X)</span></div>`
                : `<input type="number" id="tpPassScore" value="80" min="0" max="100" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:3px;">`
              }
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--gray);">출제 문제수</label>
              <input type="number" id="tpQuestionCount" value="${questions.length}" min="1" max="${questions.length}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:3px;">
              <div style="font-size:10px;color:var(--gray);margin-top:2px;">전체 ${questions.length}문제 중 랜덤</div>
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--gray);">출제일</label>
              <input type="date" id="tpDate" value="${_ymdKST()}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:3px;">
            </div>
          </div>
        </div>

        ${cfg.testMode === 'recording' && selectedSets.some(s => s.questions?.[0]?.schemaV === 2)
          ? (() => {
              const q0 = selectedSets[0]?.questions?.[0] || {};
              return `<div style="margin-bottom:14px;padding:10px 12px;background:#fff8e1;border-radius:6px;border:1px solid #ffc107;">
              <div style="font-size:11px;font-weight:700;color:#8a6d1c;margin-bottom:8px;">${iconSvg('mic')} 녹음숙제 옵션 (시험별 조정)</div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
                <div>
                  <label style="font-size:11px;font-weight:600;color:var(--gray);">녹음 횟수</label>
                  <select id="tpRecCount" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;background:white;">
                    ${[1,2,3,4].map(n => `<option value="${n}"${n === (q0.recordingCount || 3) ? ' selected' : ''}>${n}회</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label style="font-size:11px;font-weight:600;color:var(--gray);">최소 시간(초)</label>
                  <input type="number" id="tpRecMinDur" min="10" max="300" step="10"
                    value="${q0.minDurationSec ?? 20}"
                    style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;">
                </div>
                <div>
                  <label style="font-size:11px;font-weight:600;color:var(--gray);">최대 시간(초)</label>
                  <input type="number" id="tpRecMaxDur" min="60" max="600" step="60"
                    value="${Math.min(q0.maxDurationSec ?? 600, 600)}"
                    style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;">
                  <div style="font-size:9px;color:var(--gray);margin-top:2px;">최대 600초 (10분)</div>
                </div>
              </div>
              <div>
                <label style="font-size:11px;font-weight:600;color:var(--gray);">평가구간</label>
                <select id="tpRecEvalSec" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;background:white;">
                  ${[0,60,90,120,180].map(n => `<option value="${n}"${n === (q0.evaluationSeconds ?? 0) ? ' selected' : ''}>${n === 0 ? '전체 녹음' : '앞 ' + n + '초'}</option>`).join('')}
                </select>
              </div>
              <div style="font-size:10px;color:#8a6d1c;margin-top:8px;line-height:1.5;">
                ※ 평가구간 "전체" 가 가장 정확하지만 토큰 비용 높음 (5분 녹음 vs 60초)<br>
                ※ 말소리 비율 차단 정책 폐기 — 모든 녹음은 제출 가능, 학원장이 카드에서 회차별 수치 확인
              </div>
            </div>`;
            })()
          : ''}

        ${cfg.testMode === 'vocab'
          ? `<div style="margin-bottom:14px;padding:10px 12px;background:#eff6ff;border-radius:6px;border:1px solid #bfdbfe;">
              <div style="font-size:11px;font-weight:700;color:#1e40af;margin-bottom:8px;">${iconSvg('pen')} 단어시험 풀이 옵션 (학생앱 적용)</div>
              <div style="display:flex;gap:14px;flex-wrap:nowrap;align-items:center;">
                <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--gray);white-space:nowrap;">
                  형식:
                  <select id="tpVocabFormat" onchange="_tpVocabFormatChanged()" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:11px;background:white;">
                    <option value="mixed" selected>혼합 (랜덤)</option>
                    <option value="mixed_mcq_first">혼합 (객→주)</option>
                    <option value="mixed_short_first">혼합 (주→객)</option>
                    <option value="speaking">말하기 (음성 인식)</option>
                  </select>
                </label>
                <span id="tpVocabRatioRow" style="display:flex;gap:14px;flex-wrap:nowrap;align-items:center;">
                <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--gray);white-space:nowrap;" title="객관식 비율 (0% = 전체 주관식, 100% = 전체 객관식)">
                  객관식비율:
                  <input type="range" id="tpVocabMcqRatio" min="0" max="100" step="10" value="50"
                    oninput="document.getElementById('tpVocabMcqRatioVal').textContent=this.value+'%';"
                    style="width:100px;">
                  <span id="tpVocabMcqRatioVal" style="font-size:11px;font-weight:700;min-width:34px;color:var(--text);">50%</span>
                </label>
                <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--gray);white-space:nowrap;" title="영→한 비율 (0% = 전체 한→영, 100% = 전체 영→한)">
                  영→한비율:
                  <input type="range" id="tpVocabEn2koRatio" min="0" max="100" step="10" value="50"
                    oninput="document.getElementById('tpVocabEn2koRatioVal').textContent=this.value+'%';"
                    style="width:100px;">
                  <span id="tpVocabEn2koRatioVal" style="font-size:11px;font-weight:700;min-width:34px;color:var(--text);">50%</span>
                </label>
                </span>
              </div>
              <div style="display:flex;gap:16px;margin-top:8px;padding-top:8px;border-top:1px dashed #bfdbfe;">
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);cursor:pointer;">
                  <input type="checkbox" id="tpVocabShuffleQ" checked> 문제 순서 섞기
                </label>
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);cursor:pointer;">
                  <input type="checkbox" id="tpVocabShuffleChoices" checked> 보기(4지문) 섞기
                </label>
              </div>
              <div style="font-size:10px;color:var(--gray);margin-top:6px;">※ 학생이 풀 때마다 매번 새로 섞이며, 재시험 시에도 다시 섞입니다</div>

              <!-- 🎤 말하기 모드 전용 옵션 -->
              <div id="tpSpeakingOpts" style="display:none;margin-top:10px;padding:8px 10px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;">
                <div style="font-size:11px;font-weight:700;color:#78350f;margin-bottom:6px;">${iconSvg('mic')} 말하기 채점 옵션</div>
                <div style="display:grid;grid-template-columns:1fr;gap:6px;">
                  <div>
                    <label style="font-size:11px;font-weight:600;color:#78350f;">엄격도</label>
                    <select id="tpSpeakingStrictness" style="width:100%;padding:7px 10px;border:1px solid #fcd34d;border-radius:6px;font-size:12px;margin-top:3px;background:white;">
                      <option value="lenient" selected>🟢 너그러움 (오타·비슷한 발음 허용)</option>
                      <option value="normal">🟡 보통 (일반 학습용)</option>
                      <option value="strict">🔴 엄격 (정확한 발음만 인정)</option>
                    </select>
                  </div>
                </div>
                <div style="font-size:10px;color:#78350f;margin-top:6px;line-height:1.5;">
                  ※ 학생은 한글 뜻을 보고 영어로 발음 (방향·객관식비율 옵션 자동 무시)<br>
                  ※ 마이크 권한 필요 — Chrome 권장. 30초 안에 2회까지 시도 가능.
                </div>
              </div>
            </div>`
          : ''}

        <div style="margin-bottom:12px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:8px;">👥 배정 대상</div>
          <div id="tpTargetSummary" style="padding:8px 12px;background:#f8f9fa;border-radius:6px;font-size:12px;color:var(--gray);margin-bottom:10px;min-height:32px;display:flex;align-items:center;flex-wrap:wrap;gap:4px;"></div>
          <div id="tpPickerBox"></div>
        </div>
      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="tpPublish()" style="font-weight:700;">📤 배정하기</button>
      </div>
    </div>
  `;
  showModal(html);
  await pickerInit({
    boxEl: 'tpPickerBox',
    summaryEl: 'tpTargetSummary',
    initialTargets: [],
    allowAll: false,
    emptyText: '반/학생을 선택하세요',
    height: 280,
  });
};

// 단어시험 형식 변경 시 — 말하기 모드 옵션 토글 + 방향·비율 옵션 무력화
window._tpVocabFormatChanged = () => {
  const fmt = document.getElementById('tpVocabFormat')?.value;
  const isSpeaking = fmt === 'speaking';
  const speakOpts = document.getElementById('tpSpeakingOpts');
  const ratioRow = document.getElementById('tpVocabRatioRow');
  if (speakOpts) speakOpts.style.display = isSpeaking ? 'block' : 'none';
  // 말하기 → 객관식비율·영→한비율 슬라이더 비활성화 (한글→영어 발음 고정)
  if (ratioRow) {
    ratioRow.style.opacity = isSpeaking ? '0.4' : '1';
    ratioRow.style.pointerEvents = isSpeaking ? 'none' : 'auto';
    ratioRow.querySelectorAll('input').forEach(el => { el.disabled = isSpeaking; });
  }
};

// Fisher-Yates 셔플 (편향 없음). `sort(() => Math.random() - 0.5)` 는 V8 안정정렬과
// 충돌해 첫 위치 ~30% 편중 등 비균등 분포 발생 → 객관식 정답 한쪽 치우침 문제 fix.
function _tpFisherYates(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return arr;
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// targets[] → server-side filter 가능한 평면 필드 추출 (2026-05-14)
function _buildTargetIndex(targets) {
  const out = { targetUids: [], targetGroups: [], targetAll: false };
  for (const t of (targets || [])) {
    if (!t || typeof t !== 'object') continue;
    if (t.type === 'all') out.targetAll = true;
    else if (t.type === 'class') {
      const g = t.groupName || t.name;
      if (g && !out.targetGroups.includes(g)) out.targetGroups.push(g);
    } else if (t.type === 'student') {
      if (t.id && !out.targetUids.includes(t.id)) out.targetUids.push(t.id);
    }
  }
  return out;
}

window.tpPublish = async () => {
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  if (!cfg?.enabled) return;

  const name = document.getElementById('tpName')?.value.trim();
  const passScore = parseInt(document.getElementById('tpPassScore')?.value) || 80;
  const date = document.getElementById('tpDate')?.value || _ymdKST();
  const targets = pickerGetTargets();

  if (!name) { showAlert('입력 확인', '시험명을 입력하세요'); document.getElementById('tpName')?.focus(); return; }
  if (targets.length === 0) { showAlert('입력 확인', '배정 대상을 선택하세요'); return; }
  if (_tpSelectedSets.size === 0) { showAlert('입력 확인', '문제 세트가 비어있습니다'); return; }

  const selectedSets = _tpSets.filter(s => _tpSelectedSets.has(s.id));
  let questions = selectedSets.flatMap(s => s.questions || []);
  if (questions.length === 0) { showAlert('입력 확인', '선택된 세트에 문제가 없습니다'); return; }

  // 출제 문제수 — 입력값이 전체보다 작으면 Fisher-Yates 셔플 후 N개만 픽
  const poolTotal = questions.length;
  const qcRaw = parseInt(document.getElementById('tpQuestionCount')?.value);
  const desiredCount = isFinite(qcRaw) ? Math.max(1, Math.min(poolTotal, qcRaw)) : poolTotal;
  if (desiredCount < poolTotal) {
    questions = _tpFisherYates(questions.slice()).slice(0, desiredCount);
  }

  // 녹음숙제: 시험 배정 모달에서 5개 옵션 override (시험별·학년별 조정)
  if (cfg.testMode === 'recording' && questions.some(q => q.schemaV === 2)) {
    const recCount = parseInt(document.getElementById('tpRecCount')?.value);
    const minDur = parseInt(document.getElementById('tpRecMinDur')?.value);
    const maxDur = parseInt(document.getElementById('tpRecMaxDur')?.value);
    const evalSec = parseInt(document.getElementById('tpRecEvalSec')?.value);

    if (!isNaN(recCount) && recCount >= 1 && recCount <= 4) {
      questions.forEach(q => { if (q.schemaV === 2) q.recordingCount = recCount; });
    }
    if (isFinite(minDur) && minDur >= 10 && minDur <= 300) {
      questions.forEach(q => { if (q.schemaV === 2) q.minDurationSec = minDur; });
    }
    if (isFinite(maxDur) && maxDur >= 60 && maxDur <= 600) {
      questions.forEach(q => { if (q.schemaV === 2) q.maxDurationSec = maxDur; });
    }
    if (isFinite(evalSec) && [0, 60, 90, 120, 180].includes(evalSec)) {
      questions.forEach(q => { if (q.schemaV === 2) q.evaluationSeconds = evalSec; });
    }
    // 말소리 비율 임계값 (accuracyThreshold) 옵션 폐기 — 차단 정책 제거
  }

  // Phase 6B: vocab 풀이 옵션 (학생앱에서 매번 적용)
  let vocabOptions = null;
  if (cfg.testMode === 'vocab') {
    const fmt = document.getElementById('tpVocabFormat')?.value || 'mixed';
    const _mcqR = parseInt(document.getElementById('tpVocabMcqRatio')?.value);
    const _e2kR = parseInt(document.getElementById('tpVocabEn2koRatio')?.value);
    vocabOptions = {
      format: fmt,                                                       // mixed | mixed_mcq_first | mixed_short_first | speaking
      mcqRatio: isFinite(_mcqR) ? Math.max(0, Math.min(100, _mcqR)) : 50,
      en2koRatio: isFinite(_e2kR) ? Math.max(0, Math.min(100, _e2kR)) : 50,
      shuffleQ: document.getElementById('tpVocabShuffleQ')?.checked !== false,
      shuffleChoices: document.getElementById('tpVocabShuffleChoices')?.checked !== false,
    };
    // 🎤 말하기 모드일 때만 엄격도 저장
    if (fmt === 'speaking') {
      vocabOptions.speakingStrictness = document.getElementById('tpSpeakingStrictness')?.value || 'lenient';
    }
  }

  // 안전망: vocab+speaking 일 때 말하기 출제 데이터(homophones/koPron/sent/sentKo) 자동 채움
  // 정상 시나리오 (Wordsnap·AI Generator·세트 수정 저장) 면 이미 채워져 있어 0 호출 — skip
  if (cfg.testMode === 'vocab' && vocabOptions?.format === 'speaking') {
    const filled = await _fillMissingHomophones(questions);
    if (filled.total > 0) {
      console.log(`[tpPublish 안전망] 말하기 데이터 채움: ${filled.filled}/${filled.total}`);
    }
    // 🎤 말하기 부적합 단어 검토 (배정 전, 학원장이 삭제 가능)
    const proceed = await _tpSpeakingUnfitGate(questions);
    if (!proceed) return;
    if (questions.length === 0) { showAlert('배정 불가', '모든 단어를 삭제해 출제할 문제가 없습니다.'); return; }

    // 말하기 출제 데이터 누락 검증 — AI 실패 / 검증 거부된 단어가 남아있으면 배정 차단
    // (학생앱 1·2·3차 흐름이 koPron/sent/sentKo 에 의존하므로 누락 시 응시 불가)
    const incomplete = questions.filter(q =>
      q && q.word && (q.type === 'vocab' || !q.type) &&
      (!q.speakingKoPron || !q.speakingSent || !q.speakingSentKo)
    );
    if (incomplete.length > 0) {
      const sample = incomplete.slice(0, 5).map(q => q.word).join(', ');
      const more = incomplete.length > 5 ? ` 외 ${incomplete.length - 5}개` : '';
      showAlert(
        '배정 불가 — 말하기 데이터 누락',
        `말하기 출제 데이터(한글 발음표기·예문)가 비어있는 단어가 ${incomplete.length}개 있습니다:\n${sample}${more}\n\nAI 일시 오류 가능성 — 잠시 후 다시 시도하거나, 해당 단어를 세트에서 제외하세요.`
      );
      return;
    }
  }

  const qcLine = questions.length < poolTotal
    ? `${selectedSets.length}개 세트 · ${questions.length}문제 (전체 ${poolTotal} 중 랜덤)`
    : `${selectedSets.length}개 세트 · ${questions.length}문제`;
  // Phase B: 녹음숙제는 통과/불통 폐기 → "제출 완료" 표시
  const scoreLine = cfg.testMode === 'recording' ? '평가 방식: 제출 완료' : `통과점수 ${passScore}점`;
  const summary = `${qcLine}\n대상 ${targets.length}명/반\n${scoreLine}`;
  if (!(await showConfirm(`"${name}" 시험을 배정할까요?`, summary))) return;

  const targetType = (targets.length===1 && targets[0].type==='class') ? 'class' : 'mixed';
  const targetId = targets.map(t => t.id).join(',');
  const targetName = _buildTargetName(targets);
  // 교재: 첫 세트의 sourcePages[0] 에서 Book · Chapter 이름 조회
  const sp = selectedSets[0]?.sourcePages?.[0];
  const book = sp ? (_genBooks||[]).find(b => b.id === sp.bookId) : null;
  const chap = sp ? (_genChapters||[]).find(c => c.id === sp.chapterId) : null;
  const bookName = [book?.name, chap?.name].filter(Boolean).join(' · ') || '';

  try {
    const tIndex = _buildTargetIndex(targets);
    const _timeLimitSec = ['vocab','fill_blank','unscramble'].includes(cfg.testMode)
      ? (() => {
          const _tl = parseInt(document.getElementById('tpTimeLimit')?.value);
          return isFinite(_tl) ? Math.max(5, Math.min(120, _tl)) : 30;
        })()
      : null;
    const docPayload = {
      name, academy:'큰소리영어',
      academyId: window.MY_ACADEMY_ID || 'default',
      date,
      testMode: cfg.testMode,
      targetType, targetId, targetName, targets: [...targets],
      targetUids: tIndex.targetUids,
      targetGroups: tIndex.targetGroups,
      targetAll: tIndex.targetAll,
      active: true,
      questions,
      questionCount: questions.length,
      sourceSetIds: selectedSets.map(s => s.id),
      sourceSetNames: selectedSets.map(s => s.name || ''),
      // Phase B: 녹음숙제는 통과/불통 폐기 — passScore 안 박음
      ...(cfg.testMode === 'recording' ? {} : { passScore }),
      bookName,
      ...(vocabOptions ? { vocabOptions } : {}),
      ...(_timeLimitSec != null ? { timeLimitSec: _timeLimitSec } : {}),
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || '',
    };
    const docRef = await addDoc(collection(db,'genTests'), docPayload);

    // 학생앱 헤드체크용 — 시험 출제 시점 박기 (학생앱 시험 목록 캐시 무효 트리거)
    // 학생앱은 academies/{id}.lastTestUpdate 만 1 read 해서 캐시 valid 여부 판단
    try {
      await updateDoc(doc(db, 'academies', window.MY_ACADEMY_ID || 'default'),
        { lastTestUpdate: serverTimestamp() });
    } catch (e) { console.warn('[tpPublish] lastTestUpdate 업데이트 실패 — 학생앱 캐시 무효 안 될 수 있음:', e); }

    showToast(`✓ "${name}" 배정 완료 (${questions.length}문제)`);
    closeModal();

    // ── 진도체크 캐시 surgical insert (2026-06-13) ──
    // 진도체크 일자별·시험별 진도체크 캐시는 SPA 세션 유지 동안 영구 유지라
    // 학원장이 화면 ↻ 누르기 전엔 새 시험이 안 보임. 출제 직후 직접 끼워넣어 즉시 반영.
    try {
      const newTest = {
        id: docRef.id,
        _src: 'genTests',
        ...docPayload,
        createdAt: new Date(),  // serverTimestamp sentinel 대신 클라 시각 (정렬용, 다음 fetch 시 Firestore Timestamp 로 교체)
      };
      // 1) 시험별 진도체크 (_tlState + testListBody pageState) — attachStats 호환 0값
      if (Array.isArray(_tlState?.data)) {
        const withStats = {
          ...newTest,
          attemptCount: 0, avgScore: null,
          _passedCount: 0, _attemptedCount: 0,
          _targetCount: (typeof _computeTestStats === 'function'
            ? _computeTestStats(newTest, [], allStudents || []).targetCount
            : 0),
        };
        _tlState.data.unshift(withStats);
        // testListBody 가 initPagination 으로 등록돼있으면 페이지·정렬 유지하며 재렌더
        _pageMutate('testListBody', d => {
          if (d !== _tlState.data && d[0]?.id !== withStats.id) d.unshift(withStats);
          return undefined;
        });
      }
      // 2) 일자별 — 출제일(date) 캐시에 push (그 날짜를 본 적 있을 때만)
      if (_prog?.testsByDate && Array.isArray(_prog.testsByDate[date])) {
        _prog.testsByDate[date].push(newTest);
        // 현재 일자별 화면이 그 날짜를 보고 있으면 재렌더 (반 선택돼있으면 그 그룹만 표시됨)
        const curDate = document.getElementById('progDateInput')?.value;
        if (curDate === date && typeof progRenderByDate === 'function') {
          progRenderByDate().catch(_=>{});
        }
      }
    } catch (e) {
      console.warn('[tpPublish] surgical insert 실패 (캐시 동기 — 화면 영향 없음):', e);
    }

    await _renderTestAssignDetail(_activeTestType);
  } catch(e) {
    console.error(e);
    showToast('배정 실패: '+e.message);
  }
};

// ══════════════════════════════════════════════════════════════════════════
// 시험지 인쇄 (Phase 4 — printOnly 유형 전용)
// ══════════════════════════════════════════════════════════════════════════

// 시험지 출력 기본 스타일 값 (툴바 input 초기값 + fallback)
const _TP_PRINT_DEFAULTS = { fontSize: 13, lineHeight: 1.7, qGap: 18 };

window.tpOpenPrintModal = () => {
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  if (!cfg?.enabled || !cfg.actions?.includes('print')) return;
  if (_tpSelectedSets.size === 0) { showAlert('입력 확인', '문제 세트를 선택하세요'); return; }

  const selectedSets = _tpSets.filter(s => _tpSelectedSets.has(s.id));
  const rawQuestions = selectedSets.flatMap(s => s.questions || []);
  if (rawQuestions.length === 0) { showAlert('입력 확인', '선택된 세트에 문제가 없습니다'); return; }

  // 원본 보호: 클론 후 섞기 / _printSlots 부착에 사용
  const questions = rawQuestions.map(q => ({ ...q, choices: Array.isArray(q.choices) ? q.choices.slice() : q.choices }));

  const sp = selectedSets[0]?.sourcePages?.[0] || {};
  const book = (_genBooks||[]).find(b => b.id === sp.bookId);
  const chap = (_genChapters||[]).find(c => c.id === sp.chapterId);
  const bookName = book?.name || '';
  const chapName = chap?.name || '';
  const sourceType = cfg.sourceType;

  const defaultTitle = selectedSets.length === 1
    ? (selectedSets[0].name || `${cfg.kindLabel} 시험`)
    : `${selectedSets[0]?.name || cfg.kindLabel} 외 ${selectedSets.length - 1}`;
  const todayStr = new Date().toLocaleDateString('ko-KR');

  // 유형별 추가 옵션 UI
  const typeOptionsHtml = _tpBuildTypeOptionsUI(sourceType);

  const html = `
    <div style="width:100%;flex:1;display:flex;flex-direction:column;min-height:0;">

      <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-shrink:0;">
        <div>
          <div style="font-size:16px;font-weight:700;">🖨 시험지 프리뷰 · ${esc(cfg.kindLabel)}</div>
          <div style="font-size:11px;color:var(--gray);">${selectedSets.length}개 세트 · 총 ${questions.length}문항 · A4 인쇄 최적화</div>
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);cursor:pointer;">
            <input type="checkbox" id="tpPrintShowAnswers" onchange="tpPrintRefreshPreview()"> 답지 보기
          </label>
          <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="tpPrintShuffleQuestions()" title="문제 순서를 무작위로 섞기 (다시 누르면 새 순서)">🔀 문제 섞기</button>
          <button class="btn btn-secondary" id="tpBtnShuffleC" style="font-size:11px;padding:4px 10px;display:none;" onclick="tpPrintShuffleChoices()" title="선지(①②③④) 순서 섞기">🔀 선지 섞기</button>
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);cursor:pointer;" title="한 페이지를 좌우 2단으로 분할">
            <input type="checkbox" id="tpPrint2PerSheet" onchange="tpPrintRefreshPreview()"> 2단 레이아웃
          </label>
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);cursor:pointer;" title="내용이 A4 1장을 초과하면 자동으로 축소해 한 페이지에 맞춤">
            <input type="checkbox" id="tpPrintFitToPage" onchange="tpPrintRefreshPreview()"> 페이지 맞춤
          </label>
          <select id="tpPrintOrientation" onchange="tpPrintRefreshPreview()" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:5px;">
            <option value="portrait">A4 세로</option>
            <option value="landscape">A4 가로</option>
          </select>
          <button class="btn btn-secondary" onclick="closeModal()" style="font-size:12px;">취소</button>
          <button class="btn btn-primary" onclick="tpPrintNow()" style="font-size:12px;font-weight:700;">🖨 인쇄</button>
        </div>
      </div>

      <div style="padding:12px 20px;border-bottom:1px solid var(--border);background:#f8f9fa;flex-shrink:0;">
        <div style="display:grid;grid-template-columns:1fr 120px 130px 110px;gap:10px;margin-bottom:${typeOptionsHtml?'10px':'0'};">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--gray);">시험명</label>
            <input type="text" id="tpPrintTitle" value="${esc(defaultTitle)}"
              oninput="tpPrintRefreshPreview()"
              style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--gray);">학원명</label>
            <input type="text" id="tpPrintAcademy" value="큰소리영어"
              oninput="tpPrintRefreshPreview()"
              style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--gray);">출제일</label>
            <input type="date" id="tpPrintDate" value="${_ymdKST()}"
              onchange="tpPrintRefreshPreview()"
              style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--gray);">출제 문제수</label>
            <input type="number" id="tpPrintQuestionCount" value="${questions.length}" min="1" max="${questions.length}"
              oninput="tpPrintRefreshPreview()"
              style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;">
            <div style="font-size:9px;color:var(--gray);margin-top:1px;">전체 ${questions.length}문제 중 랜덤</div>
          </div>
        </div>
        ${typeOptionsHtml}
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);">
          <span style="font-size:11px;font-weight:600;color:var(--gray);">📐 스타일 조정</span>
          <label style="font-size:11px;color:var(--gray);display:flex;align-items:center;gap:5px;">
            글자크기:
            <input type="number" id="tpOptFontSize" value="${_TP_PRINT_DEFAULTS.fontSize}" min="9" max="20" step="1"
              oninput="tpPrintRefreshPreview()"
              style="width:56px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;">
            <span style="color:#bbb;font-size:10px;">px (기본 ${_TP_PRINT_DEFAULTS.fontSize})</span>
          </label>
          <label style="font-size:11px;color:var(--gray);display:flex;align-items:center;gap:5px;">
            줄간격:
            <input type="number" id="tpOptLineHeight" value="${_TP_PRINT_DEFAULTS.lineHeight}" min="1.0" max="2.5" step="0.1"
              oninput="tpPrintRefreshPreview()"
              style="width:56px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;">
            <span style="color:#bbb;font-size:10px;">배 (기본 ${_TP_PRINT_DEFAULTS.lineHeight})</span>
          </label>
          <label style="font-size:11px;color:var(--gray);display:flex;align-items:center;gap:5px;">
            문제간격:
            <input type="number" id="tpOptQGap" value="${_TP_PRINT_DEFAULTS.qGap}" min="0" max="60" step="2"
              oninput="tpPrintRefreshPreview()"
              style="width:56px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;">
            <span style="color:#bbb;font-size:10px;">px (기본 ${_TP_PRINT_DEFAULTS.qGap})</span>
          </label>
          <button onclick="tpPrintResetStyle()" title="기본값으로 되돌리기"
            style="font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:white;cursor:pointer;color:var(--gray);">
            ↺ 리셋
          </button>
        </div>
      </div>

      <div style="flex:1;overflow-y:auto;padding:20px;background:#e0e0e0;min-height:0;">
        <div id="tpPrintArea"></div>
      </div>

    </div>
  `;
  showModal(html, { fullFlex: true, width: 'min(1240px, 96vw)' });

  // 인쇄 상태 초기화 — 클론된 questions
  //   vocab      : 4지문 (_printSlots) 사전 결정
  //   unscramble : 청크 순서 (_printChunks) 사전 결정
  if (sourceType === 'vocab') {
    const canMcq = questions.length >= 4;
    questions.forEach((q, i) => {
      if (canMcq) {
        const others = questions.filter((_, j) => j !== i);
        const wrongs = _tpFisherYates(others).slice(0, 3);
        q._printSlots = [q, ...wrongs];  // 0=정답, 1~3=오답 (초기 순서)
      }
      // 혼합(랜덤) 용 사전 결정 rank (0~1) — 옵션 변경 시에도 유지
      // 렌더 시: rank < mcqRatio/100 이면 mcq, 아니면 short
      // MCQ 불가(canMcq=false) 면 rank=1.0 → 어떤 비율에서도 항상 short
      q._printFmtRank = canMcq ? Math.random() : 1.0;
      // 방향(혼합) 용 rank — rank < en2KoRatio/100 이면 en2ko, 아니면 ko2en
      q._printDirRank = Math.random();
    });
  } else if (sourceType === 'unscramble') {
    questions.forEach(q => {
      const chunks = (q.chunkedSentence || '').split('/').map(s => s.trim()).filter(Boolean);
      q._printChunks = _tpFisherYates(chunks);
    });
  }
  // localStorage 키 — 같은 세트 조합이면 동일 키 (정렬해서 순서 무관)
  const setIdsKey = Array.from(_tpSelectedSets).sort().join(',');
  const perKey = `tpPrintOpts:${setIdsKey}`;
  window._tpPrintState = { questions, sourceType, perKey };
  window._tpPrintContext = { questions, bookName, chapName, sourceType };

  // 섞기 버튼 노출 — vocab/mcq = 선지, unscramble = 청크
  setTimeout(() => {
    const btn = document.getElementById('tpBtnShuffleC');
    if (!btn) return;
    if (sourceType === 'mcq' || sourceType === 'vocab') {
      btn.style.display = '';
      btn.textContent = '🔀 선지 섞기';
      btn.title = '선지(①②③④) 순서 섞기';
    } else if (sourceType === 'unscramble') {
      btn.style.display = '';
      btn.textContent = '🔀 청크 섞기';
      btn.title = '단어/구 청크 순서 섞기';
    }
  }, 0);

  // 옵션 복원 (하이브리드: 세트별 → 마지막 사용 폴백)
  _tpRestorePrintOpts(perKey);

  tpPrintRefreshPreview();
};

// 인쇄 옵션 저장 키 (시험명·출제일은 매번 새로 시작)
const _TP_OPT_INPUTS = {
  // id : { type: 'check'|'value', key: 저장 키명 }
  tpPrintShowAnswers:    { type: 'check', key: 'showAnswers' },
  tpPrint2PerSheet:      { type: 'check', key: 'twoPerSheet' },
  tpPrintFitToPage:      { type: 'check', key: 'fitToPage' },
  tpPrintOrientation:    { type: 'value', key: 'orientation' },
  tpPrintAcademy:        { type: 'value', key: 'academy' },
  tpPrintQuestionCount:  { type: 'value', key: 'questionCount' },
  tpOptFontSize:         { type: 'value', key: 'fontSize' },
  tpOptLineHeight:       { type: 'value', key: 'lineHeight' },
  tpOptQGap:             { type: 'value', key: 'qGap' },
  tpOptVocabFormat:      { type: 'value', key: 'vocabFormat' },
  tpOptVocabColumns:     { type: 'value', key: 'vocabColumns' },
  tpOptVocabMcqRatio:    { type: 'value', key: 'vocabMcqRatio' },
  tpOptVocabEn2KoRatio:  { type: 'value', key: 'vocabEn2KoRatio' },
};

function _tpRestorePrintOpts(perKey) {
  let opts = null;
  try {
    const raw = localStorage.getItem(perKey) || localStorage.getItem('tpPrintOpts:last');
    if (raw) opts = JSON.parse(raw);
  } catch (_) {}
  if (!opts) return;
  Object.entries(_TP_OPT_INPUTS).forEach(([id, cfg]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const v = opts[cfg.key];
    if (v == null) return;
    if (cfg.type === 'check') el.checked = !!v;
    else el.value = v;
  });
  // 슬라이더 값 표시 sync
  const syncRange = (rangeId, valId) => {
    const r = document.getElementById(rangeId);
    const rv = document.getElementById(valId);
    if (r && rv) rv.textContent = r.value + '%';
  };
  syncRange('tpOptVocabMcqRatio', 'tpOptVocabMcqRatioVal');
  syncRange('tpOptVocabEn2KoRatio', 'tpOptVocabEn2KoRatioVal');
}

function _tpSavePrintOpts() {
  const s = window._tpPrintState;
  if (!s?.perKey) return;
  const opts = {};
  Object.entries(_TP_OPT_INPUTS).forEach(([id, cfg]) => {
    const el = document.getElementById(id);
    if (!el) return;
    opts[cfg.key] = cfg.type === 'check' ? el.checked : el.value;
  });
  try {
    const json = JSON.stringify(opts);
    localStorage.setItem(s.perKey, json);
    localStorage.setItem('tpPrintOpts:last', json);
  } catch (_) {}
}

// 🔀 문제 섞기 — questions 배열 순서만 바꿈 (각 문제의 _printSlots/choices 는 유지)
window.tpPrintShuffleQuestions = () => {
  const s = window._tpPrintState;
  if (!s) return;
  s.questions = _tpFisherYates(s.questions);
  if (window._tpPrintContext) window._tpPrintContext.questions = s.questions;
  tpPrintRefreshPreview();
};

// 🔀 선지/청크 섞기 — 각 문제의 보기 위치만 바꿈
//   vocab      : q._printSlots (정답+오답3) 순서 셔플
//   mcq        : q.choices 순서 셔플 (isAnswer 마커는 객체에 붙어 있어 자동 추적)
//   unscramble : q._printChunks 순서 셔플
window.tpPrintShuffleChoices = () => {
  const s = window._tpPrintState;
  if (!s) return;
  if (s.sourceType === 'vocab') {
    s.questions.forEach(q => {
      if (Array.isArray(q._printSlots) && q._printSlots.length >= 2) {
        q._printSlots = _tpFisherYates(q._printSlots);
      }
    });
  } else if (s.sourceType === 'mcq') {
    s.questions.forEach(q => {
      if (Array.isArray(q.choices) && q.choices.length >= 2) {
        q.choices = _tpFisherYates(q.choices);
      }
    });
  } else if (s.sourceType === 'unscramble') {
    s.questions.forEach(q => {
      if (Array.isArray(q._printChunks) && q._printChunks.length >= 2) {
        q._printChunks = _tpFisherYates(q._printChunks);
      }
    });
  }
  tpPrintRefreshPreview();
};

// 유형별 추가 옵션 UI (단어시험에 format/direction/columns 등)
function _tpBuildTypeOptionsUI(sourceType) {
  if (sourceType === 'vocab') {
    return `
      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);" title="객관식·주관식 배치 방식 (비율은 슬라이더로)">
          형식:
          <select id="tpOptVocabFormat" onchange="tpPrintRefreshPreview()"
            style="padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;">
            <option value="mixed">혼합(랜덤)</option>
            <option value="mixed_mcq_first">혼합(객→주)</option>
            <option value="mixed_short_first">혼합(주→객)</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);" title="객관식 비율 (0% = 전체 주관식, 100% = 전체 객관식)">
          객관식비율:
          <input type="range" id="tpOptVocabMcqRatio" min="0" max="100" step="10" value="50"
            oninput="document.getElementById('tpOptVocabMcqRatioVal').textContent=this.value+'%';tpPrintRefreshPreview()"
            style="width:100px;">
          <span id="tpOptVocabMcqRatioVal" style="font-size:11px;font-weight:700;min-width:34px;color:var(--text);">50%</span>
        </label>
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);" title="영→한 비율 (0% = 전체 한→영, 100% = 전체 영→한)">
          영→한비율:
          <input type="range" id="tpOptVocabEn2KoRatio" min="0" max="100" step="10" value="50"
            oninput="document.getElementById('tpOptVocabEn2KoRatioVal').textContent=this.value+'%';tpPrintRefreshPreview()"
            style="width:100px;">
          <span id="tpOptVocabEn2KoRatioVal" style="font-size:11px;font-weight:700;min-width:34px;color:var(--text);">50%</span>
        </label>
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);">
          단수:
          <select id="tpOptVocabColumns" onchange="tpPrintRefreshPreview()"
            style="padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;">
            <option value="1">1단</option>
            <option value="2">2단 (좌우 분할)</option>
          </select>
        </label>
      </div>`;
  }
  return '';
}

function _tpBuildPrintHtml(questions, meta) {
  const { title, academy, date, bookName, chapName, showAnswers, twoPerSheet, orientation, sourceType, typeOpts } = meta;
  const fontSize = meta.fontSize ?? _TP_PRINT_DEFAULTS.fontSize;
  const lineHeight = meta.lineHeight ?? _TP_PRINT_DEFAULTS.lineHeight;
  const qGap = meta.qGap ?? _TP_PRINT_DEFAULTS.qGap;
  const isLandscape = orientation === 'landscape';
  // 실물 A4: 세로 210×297mm, 가로 297×210mm. 여백 8mm 10mm 를 padding 으로 포함.
  const pageW = isLandscape ? '297mm' : '210mm';
  const pageMinH = isLandscape ? '210mm' : '297mm';

  // 문제 순서 / 선지 순서는 _tpPrintState 에서 이미 결정됨 (섞기 버튼으로 갱신).
  const qs = questions;

  // 유형별 렌더러 라우팅
  const renderers = {
    subjective: _printRenderSubj,
    vocab: _printRenderVocab,
    unscramble: _printRenderUnscramble,
    fill_blank: _printRenderBlank,
    mcq: _printRenderMcq,
  };
  const renderer = renderers[sourceType] || _printRenderSubj;
  const body = renderer(qs, { showAnswers, typeOpts: typeOpts || {} });

  // 절대 경로로 로고 — 학원 업로드 로고 우선, 없으면 LexiAI 기본
  // 학원 로고는 storage.googleapis.com (절대 URL) — 그대로 사용
  // 기본 아이콘은 location.origin 붙여 팝업(about:blank) 에서도 로드
  const _origin = (typeof window !== 'undefined' ? window.location.origin : '');
  const logoUrl = (typeof window !== 'undefined' && window.MY_ACADEMY_LOGO)
    ? window.MY_ACADEMY_LOGO
    : (_origin + '/icons/icon-192.png');
  const headerHtml = `
    <div style="border-bottom:2px solid #333;padding-bottom:6px;margin-bottom:10px;position:relative;z-index:1;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
          <img src="${logoUrl}" alt="" style="width:42px;height:42px;object-fit:contain;flex-shrink:0;" onerror="this.style.display='none'">
          <div style="min-width:0;flex:1;">
            <div style="font-size:10px;color:#888;">${esc(academy||'')}</div>
            <div style="font-size:18px;font-weight:800;color:#111;margin-top:2px;">${esc(title||'시험')}</div>
            <div style="font-size:10px;color:#555;margin-top:3px;">
              ${bookName?`Book: <strong>${esc(bookName)}</strong>`:''}
              ${chapName?` · Chapter: <strong>${esc(chapName)}</strong>`:''}
              · 총 ${questions.length}문항 · 출제일: ${esc(date||'')}
            </div>
          </div>
        </div>
        <div style="font-size:16px;text-align:right;line-height:1.8;flex-shrink:0;border:1px solid #999;padding:8px 14px;border-radius:6px;background:white;">
          이름: <span style="display:inline-block;width:160px;border-bottom:1px solid #333;">&nbsp;</span><br>
          반: <span style="display:inline-block;width:100px;border-bottom:1px solid #333;">&nbsp;</span> 점수: <span style="display:inline-block;width:90px;border-bottom:1px solid #333;">&nbsp;</span>
        </div>
      </div>
    </div>`;

  // 대표 로고 워터마크 — 용지 중앙에 크게, 옅게 (내용 위가 아니라 뒤에 배치)
  // portrait: 297mm 의 절반 = 148.5mm, landscape: 210mm 의 절반 = 105mm
  const watermarkTop = isLandscape ? '105mm' : '148.5mm';
  const watermarkHtml = `<img src="${logoUrl}" alt="" aria-hidden="true"
    style="position:absolute;top:${watermarkTop};left:50%;transform:translate(-50%,-50%);
           width:32%;max-width:75mm;height:auto;opacity:0.07;pointer-events:none;z-index:0;
           user-select:none;"
    onerror="this.style.display='none'">`;

  const endHtml = `<div style="text-align:center;margin-top:18px;padding-top:6px;border-top:1px dashed #ccc;font-size:10px;color:#aaa;">— 끝 —</div>`;

  // 두 모드:
  // - 기본: 헤더 1번 + 단일 컬럼 (문제가 길면 자연스럽게 페이지 넘어감, 헤더는 1페이지에만)
  // - 2단 레이아웃: 헤더 1번 + 본문을 좌우 2단 CSS columns 로 분할 (구버전 printMixedExamPDF 방식)
  //   브라우저 인쇄 설정(시트당 2페이지) 필요 없음 — HTML 자체가 2단
  // A4 경계선 배경 그라데이션: 297mm(또는 210mm) 마다 옅은 빨간 선으로 페이지 경계 표시
  // 외곽(용지+경계선) 과 내부(내용) 를 분리: 페이지 맞춤 시 내부만 zoom → 빨간 선은 원래 위치 유지
  const pageBreakBg = `repeating-linear-gradient(to bottom,transparent 0,transparent calc(${pageMinH} - 2px),rgba(255,80,80,0.45) calc(${pageMinH} - 2px),rgba(255,80,80,0.45) ${pageMinH})`;
  const outerStyle = `background:white;background-image:${pageBreakBg};width:${pageW};min-height:${pageMinH};margin:0 auto;box-shadow:0 2px 8px rgba(0,0,0,0.15);font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;box-sizing:border-box;position:relative;overflow:hidden;`;
  const innerStyle = `padding:8mm 10mm;box-sizing:border-box;position:relative;z-index:1;--p-font:${fontSize}px;--p-line:${lineHeight};--q-gap:${qGap}px;`;

  const innerContent = twoPerSheet
    ? `${headerHtml}<div style="column-count:2;column-gap:20px;column-rule:1px solid #ccc;">${body}</div>${endHtml}`
    : `${headerHtml}${body}${endHtml}`;

  return `
    <div style="${outerStyle}">
      ${watermarkHtml}
      <div class="a4-content" style="${innerStyle}">${innerContent}</div>
    </div>
  `;
}

// ─── 유형별 프린트 렌더러 (Phase 6B) ───

function _printRenderSubj(questions, { showAnswers }) {
  // 상단에 공통 지시문 한 번만, 각 문항은 번호 + 영어 문장 (번호를 영문 앞으로)
  const items = questions.map((q, i) => `
    <div style="margin-bottom:var(--q-gap);page-break-inside:avoid;">
      <div style="display:flex;gap:8px;align-items:baseline;margin-bottom:8px;">
        <div style="font-size:var(--p-font);font-weight:700;min-width:22px;">${i+1}.</div>
        <div data-fb-sent="${i}" style="flex:1;font-size:var(--p-font);line-height:var(--p-line);padding:9px 12px;background:#f5f5f5;border-left:3px solid #333;">${esc(q.sentence || '')}</div>
      </div>
      ${showAnswers && q.sampleAnswerKo
        ? `<div style="font-size:11px;line-height:1.5;padding:8px 12px;background:#e8f5e9;border-left:3px solid #2e7d32;color:#1b5e20;margin-left:30px;"><strong>모범답안:</strong> ${esc(q.sampleAnswerKo)}</div>`
        : `<div data-fb-ans="${i}" style="margin-left:30px;"><div style="border-bottom:1px solid #aaa;height:28px;"></div></div>`
      }
    </div>
  `).join('');
  return `
    <div style="font-size:12px;color:#555;margin-bottom:10px;">※ 위 문장을 우리말로 해석하시오.</div>
    ${items}
  `;
}

function _printRenderVocab(questions, { showAnswers, typeOpts }) {
  const fmt = typeOpts?.format || 'mixed';
  // mixed = 혼합(랜덤), mixed_mcq_first = 혼합(객→주), mixed_short_first = 혼합(주→객), short, mcq
  const dir = typeOpts?.direction || 'mixed';      // mixed | en2ko | ko2en
  const cols = parseInt(typeOpts?.columns) === 2 ? 2 : 1;
  // 0% 도 유효 — || 폴백 쓰면 0 이 falsy 라 50 으로 둔갑
  const rawRatio = parseInt(typeOpts?.mcqRatio);
  const mcqRatio = Math.max(0, Math.min(100, isFinite(rawRatio) ? rawRatio : 50));
  const rawDirRatio = parseInt(typeOpts?.en2KoRatio);
  const en2KoRatio = Math.max(0, Math.min(100, isFinite(rawDirRatio) ? rawDirRatio : 50));

  // 2단일 때 MCQ 선지 그리드는 세로 1열 (좁은 너비에서 2x2 불가), 1단은 2x2
  const choiceGridStyle = cols === 2
    ? 'display:flex;flex-direction:column;gap:2px;'
    : 'display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;';

  // 혼합(객→주)·혼합(주→객) 의 MCQ 개수
  const mcqCount = Math.round(questions.length * mcqRatio / 100);

  const items = questions.map((q, i) => {
    let thisDir = dir;
    if (dir === 'mixed') {
      // 사전 결정된 _printDirRank 와 슬라이더 값 비교 (옵션 바꿔도 rank 유지)
      const dRank = (typeof q._printDirRank === 'number') ? q._printDirRank : 0.5;
      thisDir = dRank < en2KoRatio / 100 ? 'en2ko' : 'ko2en';
    }
    let thisFmt = fmt;
    const canMcq = Array.isArray(q._printSlots) && q._printSlots.length >= 4;
    if (fmt === 'mixed') {
      // 혼합(랜덤) — 사전 결정된 rank 와 슬라이더 값 비교 (옵션 바꿔도 rank 는 유지)
      const rank = (typeof q._printFmtRank === 'number') ? q._printFmtRank : 0.5;
      thisFmt = rank < mcqRatio / 100 ? 'mcq' : 'short';
    } else if (fmt === 'mixed_mcq_first') {
      thisFmt = i < mcqCount ? 'mcq' : 'short';
    } else if (fmt === 'mixed_short_first') {
      thisFmt = i >= (questions.length - mcqCount) ? 'mcq' : 'short';
    }
    // MCQ 불가 (4지문 못 만든 경우) → 무조건 short 폴백
    if (thisFmt === 'mcq' && !canMcq) thisFmt = 'short';

    const question = thisDir === 'en2ko' ? q.word : q.meaning;
    const answer = thisDir === 'en2ko' ? q.meaning : q.word;

    const wrap = `margin-bottom:var(--q-gap);break-inside:avoid;page-break-inside:avoid;`;

    if (thisFmt === 'short') {
      return `
        <div style="${wrap}display:flex;align-items:baseline;gap:8px;line-height:var(--p-line);">
          <div style="font-size:var(--p-font);font-weight:700;min-width:22px;">${i+1}.</div>
          <div style="font-size:var(--p-font);font-weight:600;min-width:140px;">${esc(question)}</div>
          <div style="flex:1;border-bottom:1px solid #aaa;padding-bottom:2px;font-size:calc(var(--p-font) - 1px);color:#2e7d32;font-weight:700;">
            ${showAnswers ? esc(answer) : '&nbsp;'}
          </div>
        </div>`;
    }
    // MCQ: _printSlots (모달 진입 시 사전 결정된 정답+오답3) 의 현재 순서 그대로 사용
    // 섞기 버튼 안 눌렀으면 [정답,오답,오답,오답], 누르면 자리만 바뀜
    const slots = Array.isArray(q._printSlots) && q._printSlots.length >= 4
      ? q._printSlots
      : [q]; // 4개 미만(문제 수<4)일 때 폴백
    const opts = slots.map(s => thisDir === 'en2ko' ? s.meaning : s.word);
    const correctIdx = slots.indexOf(q);
    return `
      <div style="${wrap}">
        <div style="font-size:var(--p-font);font-weight:700;margin-bottom:3px;">${i+1}. ${esc(question)}</div>
        <div style="${choiceGridStyle}margin-left:18px;">
          ${opts.map((opt, j) => `
            <div style="font-size:calc(var(--p-font) - 1px);${showAnswers && j === correctIdx ? 'color:#2e7d32;font-weight:700;' : ''}">
              ${['①','②','③','④'][j]} ${esc(opt)}${showAnswers && j === correctIdx ? ' ✓' : ''}
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');

  if (cols === 2) {
    return `<div style="column-count:2;column-gap:24px;column-fill:auto;">${items}</div>`;
  }
  return items;
}

function _printRenderUnscramble(questions, { showAnswers }) {
  return questions.map((q, i) => {
    const chunks = (q.chunkedSentence || '').split('/').map(s => s.trim()).filter(Boolean);
    // 모달 진입 시 사전 결정된 _printChunks 사용 (섞기 버튼 누를 때만 갱신)
    const shuffled = Array.isArray(q._printChunks) && q._printChunks.length === chunks.length
      ? q._printChunks
      : chunks;
    return `
      <div style="margin-bottom:var(--q-gap);page-break-inside:avoid;">
        <div style="font-size:var(--p-font);font-weight:700;margin-bottom:6px;line-height:var(--p-line);">${i+1}. ${esc(q.meaningKo || '')}</div>
        <div style="margin-left:20px;border-bottom:1px solid #888;min-height:26px;padding:4px;${showAnswers ? 'background:#f0fdf4;' : ''}">
          ${showAnswers ? `<span style="font-size:var(--p-font);color:#2e7d32;font-weight:700;">${esc(chunks.join(' '))}</span>` : ''}
        </div>
        <div style="margin-left:20px;margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
          ${shuffled.map(c => `<span style="padding:4px 10px;background:white;border:1px solid #bbb;border-radius:4px;font-size:calc(var(--p-font) - 1px);font-family:'Times New Roman',serif;">${esc(c)}</span>`).join('')}
        </div>
      </div>`;
  }).join('');
}

function _printRenderBlank(questions, { showAnswers }) {
  // 상단에 공통 지시문 한 번만, 각 문항은 번호 + 영어 문장 (번호를 영문 앞으로)
  const items = questions.map((q, i) => {
    const parts = (q.sentence || '').split('___');
    let html = '';
    for (let j = 0; j < parts.length; j++) {
      html += esc(parts[j]);
      if (j < parts.length - 1) {
        const ans = q.blanks?.[j] || '';
        if (showAnswers) {
          html += `<span style="display:inline-block;padding:1px 10px;border-bottom:2px solid #2e7d32;color:#2e7d32;font-weight:700;">${esc(ans)}</span>`;
        } else {
          const w = Math.max(ans.length * 10, 60);
          html += `<span style="display:inline-block;border-bottom:1px solid #333;min-width:${w}px;">&nbsp;</span>`;
        }
      }
    }
    return `
      <div style="margin-bottom:var(--q-gap);page-break-inside:avoid;display:flex;gap:8px;align-items:baseline;">
        <div style="font-size:var(--p-font);font-weight:700;min-width:22px;">${i+1}.</div>
        <div style="flex:1;font-size:var(--p-font);line-height:var(--p-line);padding:6px 12px;background:#f9fafb;border-left:3px solid #333;">${html}</div>
      </div>`;
  }).join('');
  return `
    <div style="font-size:12px;color:#555;margin-bottom:10px;">※ 문장의 빈칸에 알맞은 단어를 쓰세요.</div>
    ${items}
  `;
}

function _printRenderMcq(questions, { showAnswers }) {
  // 순차 번호 1, 2, 3 ... (이전엔 Page별 그룹화로 1-1, 1-2 였음)
  // 출처 페이지 표시는 답지 보기일 때만
  return questions.map((q, i) => {
    const correctIdx = (q.choices || []).findIndex(c => c.isAnswer);
    return `
      <div style="margin-bottom:var(--q-gap);page-break-inside:avoid;">
        <div style="font-size:var(--p-font);font-weight:700;margin-bottom:4px;line-height:var(--p-line);">${i+1}. ${esc(q.question || '')}</div>
        ${showAnswers && (q.sourcePageTitle || q.questionKo) ? `<div style="margin-left:16px;margin-bottom:4px;">
          ${q.sourcePageTitle ? `<span style="font-size:10px;color:#888;">출처: ${esc(q.sourcePageTitle)}</span>` : ''}
          ${q.sourcePageTitle && q.questionKo ? `<span style="font-size:10px;color:#ccc;margin:0 6px;">·</span>` : ''}
          ${q.questionKo ? `<span style="font-size:11px;color:#2e7d32;">(${esc(q.questionKo)})</span>` : ''}
        </div>` : ''}
        <div style="display:grid;grid-template-columns:1fr;gap:4px;margin-left:16px;">
          ${(q.choices || []).map((c, j) => `
            <div style="font-size:calc(var(--p-font) - 1px);line-height:var(--p-line);${showAnswers && j === correctIdx ? 'color:#2e7d32;font-weight:700;' : ''}">
              ${['①','②','③','④'][j]} ${esc(c.text || '')}${showAnswers && j === correctIdx ? ' ✓' : ''}
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');
}

// 원문 줄 수만큼 답란(28px 선) 채우기 — innerHTML 설정 후 호출
function _tpAdjustAnswerLines() {
  const area = document.getElementById('tpPrintArea');
  if (!area) return;
  area.querySelectorAll('[data-fb-sent]').forEach(sDiv => {
    const qIdx = sDiv.getAttribute('data-fb-sent');
    const ansDiv = area.querySelector(`[data-fb-ans="${qIdx}"]`);
    if (!ansDiv) return;  // 모범답안 표시 중이면 없음
    const cs = getComputedStyle(sDiv);
    const fontPx = parseFloat(cs.fontSize) || 13;
    let lineHeight = parseFloat(cs.lineHeight);
    // unitless(배수) 면 fontSize 곱해 px 로, 유효하지 않으면 fallback
    if (!isFinite(lineHeight) || lineHeight <= 0) lineHeight = fontPx * 1.7;
    else if (lineHeight < 6) lineHeight = lineHeight * fontPx;
    const inner = sDiv.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const lines = Math.max(1, Math.round(inner / lineHeight));
    ansDiv.innerHTML = Array.from({length: lines}, () =>
      '<div style="border-bottom:1px solid #aaa;height:28px;"></div>'
    ).join('');
  });
}

window.tpPrintRefreshPreview = () => {
  const ctx = window._tpPrintContext;
  if (!ctx) return;
  const titleEl = document.getElementById('tpPrintTitle');
  const academyEl = document.getElementById('tpPrintAcademy');
  const dateEl = document.getElementById('tpPrintDate');
  const showAnsEl = document.getElementById('tpPrintShowAnswers');
  const area = document.getElementById('tpPrintArea');
  if (!area) return;

  const dateStr = dateEl?.value
    ? new Date(dateEl.value).toLocaleDateString('ko-KR')
    : '';

  // 유형별 옵션 수집
  const typeOpts = {};
  if (ctx.sourceType === 'vocab') {
    let fmt = document.getElementById('tpOptVocabFormat')?.value || 'mixed';
    // 레거시 localStorage 호환: 옛 옵션 'short'/'mcq' 가 복원되면 'mixed' 로 폴백
    if (fmt !== 'mixed' && fmt !== 'mixed_mcq_first' && fmt !== 'mixed_short_first') fmt = 'mixed';
    typeOpts.format = fmt;
    typeOpts.direction = 'mixed';  // 항상 혼합 — 비율은 en2KoRatio 슬라이더가 결정
    typeOpts.columns = parseInt(document.getElementById('tpOptVocabColumns')?.value) || 1;
    typeOpts.mcqRatio = parseInt(document.getElementById('tpOptVocabMcqRatio')?.value);
    if (!isFinite(typeOpts.mcqRatio)) typeOpts.mcqRatio = 50;
    typeOpts.en2KoRatio = parseInt(document.getElementById('tpOptVocabEn2KoRatio')?.value);
    if (!isFinite(typeOpts.en2KoRatio)) typeOpts.en2KoRatio = 50;
  }

  const twoPerSheetEl = document.getElementById('tpPrint2PerSheet');
  const orientationEl = document.getElementById('tpPrintOrientation');
  const fitToPageEl = document.getElementById('tpPrintFitToPage');
  const orientation = orientationEl?.value || 'portrait';

  // 스타일 조정 input → 유효값 클램프 (빈값/NaN/범위 밖은 기본값)
  const clamp = (v, lo, hi, def) => {
    const n = parseFloat(v);
    if (!isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, n));
  };
  const fontSize = clamp(document.getElementById('tpOptFontSize')?.value, 9, 20, _TP_PRINT_DEFAULTS.fontSize);
  const lineHeight = clamp(document.getElementById('tpOptLineHeight')?.value, 1.0, 2.5, _TP_PRINT_DEFAULTS.lineHeight);
  const qGap = clamp(document.getElementById('tpOptQGap')?.value, 0, 60, _TP_PRINT_DEFAULTS.qGap);

  // 출제 문제수 — 입력값이 전체보다 작으면 앞 N개만 픽 (questions 는 이미 랜덤 셔플 가능 상태)
  const totalQ = ctx.questions.length;
  let pickCount = parseInt(document.getElementById('tpPrintQuestionCount')?.value);
  if (!isFinite(pickCount) || pickCount < 1) pickCount = totalQ;
  if (pickCount > totalQ) pickCount = totalQ;
  const pickedQuestions = pickCount < totalQ ? ctx.questions.slice(0, pickCount) : ctx.questions;

  area.innerHTML = _tpBuildPrintHtml(pickedQuestions, {
    title: titleEl?.value || '시험',
    academy: academyEl?.value || '',
    date: dateStr,
    bookName: ctx.bookName,
    chapName: ctx.chapName,
    showAnswers: !!showAnsEl?.checked,
    twoPerSheet: !!twoPerSheetEl?.checked,
    orientation,
    sourceType: ctx.sourceType,
    typeOpts,
    fontSize,
    lineHeight,
    qGap,
  });
  // 주관식 답란 줄 수 맞추기 (subj 전용)
  if (ctx.sourceType === 'subjective') {
    setTimeout(() => _tpAdjustAnswerLines(), 0);
  }
  // 페이지 맞춤: 내용 높이가 A4 1장을 넘으면 자동 축소
  setTimeout(() => _tpApplyFitToPage(!!fitToPageEl?.checked, orientation), 0);

  // 옵션 자동 저장 (세트별 + 마지막 사용)
  _tpSavePrintOpts();
};

// zoom 비율 계산 후 적용 (내용 높이가 A4 1장보다 크면 축소)
// 외곽(빨간 경계선) 은 그대로 두고 내부 .a4-content 에만 zoom 적용
function _tpApplyFitToPage(enabled, orientation) {
  const inner = document.querySelector('#tpPrintArea .a4-content');
  if (!inner) return;
  inner.style.zoom = '';
  if (!enabled) return;
  // 측정: zoom 없는 상태에서의 자연 높이
  const contentH = inner.scrollHeight;
  const targetMm = orientation === 'landscape' ? 210 : 297;
  const targetPx = targetMm * 96 / 25.4; // 96 DPI 기준
  if (contentH > targetPx + 5) {
    const ratio = targetPx / contentH;
    inner.style.zoom = ratio.toFixed(3);
  }
}

window.tpPrintTogglePreview = () => tpPrintRefreshPreview();

window.tpPrintResetStyle = () => {
  const f = document.getElementById('tpOptFontSize');
  const l = document.getElementById('tpOptLineHeight');
  const g = document.getElementById('tpOptQGap');
  if (f) f.value = _TP_PRINT_DEFAULTS.fontSize;
  if (l) l.value = _TP_PRINT_DEFAULTS.lineHeight;
  if (g) g.value = _TP_PRINT_DEFAULTS.qGap;
  tpPrintRefreshPreview();
};

window.tpPrintNow = () => {
  const area = document.getElementById('tpPrintArea');
  if (!area) { showAlert('입력 확인', '프리뷰 영역을 찾을 수 없습니다'); return; }

  const orientation = document.getElementById('tpPrintOrientation')?.value === 'landscape' ? 'landscape' : 'portrait';
  const fitToPage = !!document.getElementById('tpPrintFitToPage')?.checked;

  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) { showAlert('입력 확인', '팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요'); return; }

  win.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>시험지 출력</title>
  <style>
    body { font-family: 'Malgun Gothic','Apple SD Gothic Neo',sans-serif; margin:0; padding:20px; background:#eee; }
    @media print {
      body { background:white; padding:0; }
      @page { margin: 0; size: A4 ${orientation}; }
      /* 프린트 시 외곽 래퍼의 섀도·여백·페이지경계선 배경 제거 */
      div[style*='box-shadow'] {
        box-shadow:none !important;
        margin:0 !important;
        background-image:none !important;
      }
      /* 문제 단위로는 컬럼/페이지 중간에 잘리지 않도록 */
      [style*='margin-bottom'] { break-inside: avoid; page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  ${area.innerHTML}
  <script>
    window.__FIT = ${fitToPage};
    window.__ORIENT = ${JSON.stringify(orientation)};
    window.onload = function(){
      // 로고 이미지가 로드된 뒤 인쇄 (안 깨져서 나오도록)
      const imgs = Array.from(document.images || []);
      const pending = imgs.filter(img => !img.complete);
      const fit = function(){
        if (!window.__FIT) return;
        const inner = document.querySelector('.a4-content');
        if (!inner) return;
        const h = inner.scrollHeight;
        const targetMm = window.__ORIENT === 'landscape' ? 210 : 297;
        const targetPx = targetMm * 96 / 25.4;
        if (h > targetPx + 5) inner.style.zoom = (targetPx / h).toFixed(3);
      };
      const done = function(){ fit(); setTimeout(function(){ window.print(); }, 200); };
      if (pending.length === 0) { done(); return; }
      let left = pending.length;
      const check = function(){ if (--left <= 0) done(); };
      pending.forEach(function(img){
        img.addEventListener('load', check);
        img.addEventListener('error', check);
      });
      // 안전장치: 2초 넘으면 그냥 인쇄
      setTimeout(done, 2000);
    };
  <\/script>
</body>
</html>`);
  win.document.close();
};

// 학생별 응시 카드 펼침 — 시험관리 + 시험 목록 공통 사용
// prefix: 'tp' (시험관리 6개 페이지) | 'tl' (시험 목록 페이지)
// 다른 행 ID 가 같은 페이지에 동시에 존재하지 않도록 분리
let _tpLastPrefix = 'tp';
window.tpToggleTestProgress = async (testId, prefix, opts) => {
  if (prefix) _tpLastPrefix = prefix;
  const p = _tpLastPrefix;
  const prog = document.getElementById(p + '-progress-' + testId);
  if (!prog) return;
  const isOpen = prog.getAttribute('data-open') === '1';

  // 진도체크 일자별 패널 등 "모두 펼침" 모드 — 다른 행 닫지 않음, 무조건 펼침
  if (!opts?.keepOpen) {
    document.querySelectorAll(`[id^="${p}-progress-"][data-open="1"]`).forEach(r => {
      r.style.display = 'none';
      r.setAttribute('data-open', '0');
    });
    if (isOpen) return;
  } else if (isOpen) {
    // 이미 펼쳐져 있고 keepOpen 모드면 다시 빌드 안 함
    return;
  }

  prog.style.display = prog.tagName === 'TR' ? 'table-row' : 'block';
  prog.setAttribute('data-open', '1');

  const content = document.getElementById(p + '-progress-content-' + testId);
  if (!content) return;
  content.innerHTML = '<span style="color:var(--gray);">로딩 중...</span>';

  try {
    const testDoc = await getDoc(doc(db,'genTests',testId));
    if (!testDoc.exists()) { content.textContent = '시험 데이터 없음'; return; }
    const t = testDoc.data();
    const targets = t.targets || [];

    let studentList = [];
    for (const tg of targets) {
      if (tg.type === 'student') {
        studentList.push({uid:tg.id, name:tg.name, group:''});
      } else {
        try {
          // academyId 필터 필수 — 같은 그룹 이름이 다른 학원에 있어도 자기 학원만
          const gs = await getDocs(query(
            collection(db,'users'),
            where('academyId','==',window.MY_ACADEMY_ID),
            where('group','==',tg.id),
            where('role','==','student')
          ));
          gs.docs.forEach(d =>
            studentList.push({uid:d.id, name:d.data().name, group:d.data().group||''})
          );
        } catch(e) {}
      }
    }

    const seen = new Set();
    studentList = studentList.filter(s => {
      if (seen.has(s.uid)) return false;
      seen.add(s.uid);
      return true;
    });

    // 제외된 학생은 화면에서 숨김 (복구 UI 없음 — 시험 새 배정만)
    const excluded = new Set(t.excludedUids || []);
    studentList = studentList.filter(s => !excluded.has(s.uid));

    const completed = new Map();
    await Promise.all(studentList.map(async s => {
      try {
        const d = await getDoc(doc(db,'genTests',testId,'userCompleted',s.uid));
        if (d.exists()) completed.set(s.uid, d.data());
      } catch(e) {}
    }));

    if (studentList.length === 0) {
      content.innerHTML = '<div style="padding:8px;color:var(--gray);font-size:12px;">대상 학생 없음</div>';
      return;
    }

    const doneCount = completed.size;
    // 펼친 카드 상단 메타 라인 폐기 — 시험명·✏️·응시통계 모두 행에 이미 있어 중복.
    // 학생 카드 색상으로 응시/미응시 한눈에 구분됨 (2026-05-24 학원장 요청).
    content.innerHTML = `
      <div style="padding:8px 4px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(150px,1fr));gap:5px;padding:0 4px;">
          ${studentList.map(s => {
            const c = completed.get(s.uid);
            if (c) {
              // 시험관리 페이지면 _activeTestType, 시험 목록이면 시험 doc 자체의 testMode/mode
              const tMode = (t.testMode || t.mode || '').toLowerCase();
              const recs = c.recordings || [];
              const xBtnRec = `<button onclick="event.stopPropagation();tpExcludeStudent('${esc(testId)}','${esc(s.uid)}','${esc(s.name||'').replace(/'/g,"&#39;")}', this)" title="이 학생을 시험에서 제외 (응시 기록 삭제)" style="position:absolute;top:3px;right:4px;width:18px;height:18px;background:rgba(0,0,0,0.05);color:#999;border:none;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;">${iconSvg('x')}</button>`;
              // ── 녹음숙제 분기 — 회차별 audio + 마지막 AI 피드백 ──
              // Phase B: 통과/불통 폐기. 응시 흔적 있으면 모두 "📤 제출됨" 단일 카드
              // (옛 데이터 호환: completedAt 또는 latestFailedAt 있으면 응시)
              if (tMode === 'recording') {
                const isSubmittedWithRecs = (!!c.completedAt || !!c.latestFailedAt) && recs.length > 0;
                if (isSubmittedWithRecs) {
                  const last = recs[recs.length - 1];
                  const fb = last?.feedback;
                  const submittedAt = c.completedAt?.toDate?.()
                    ? _ymdKST(c.completedAt.toDate())
                    : (c.latestFailedAt?.toDate?.() ? _ymdKST(c.latestFailedAt.toDate()) : '');
                  const dateStr = c.date || submittedAt || '';
                  const lastScore = (typeof last?.score === 'number') ? last.score : (c.score ?? c.latestFailedScore);
                  // 50점 이하 제출분 — 학원장 확인 강조 (대기·에러보다 진한 빨강)
                  const isLowScore = (typeof lastScore === 'number') && lastScore <= 50;
                  // 측정값 비정상 — 회차 중 하나라도 abnormal 이면 학원장 확인 (2026-06-27 학원장 요청)
                  // 임계는 클라 sanity check 와 동일 (학생 제출 전 안내 + 학원장 우선 확인)
                  const minDur = t.questions?.[0]?.minDurationSec || 0;
                  const abnormalReasons = [];
                  recs.forEach(r => {
                    if (r.voiceActivity != null && r.voiceActivity < 0.10) abnormalReasons.push('음성<10%');
                    if (r.voiceBandRatio != null && r.voiceBandRatio < 0.30) abnormalReasons.push('명료도<30%');
                    if (r.monotony != null && r.monotony > 0.70) abnormalReasons.push('단조>70%');
                    if (minDur > 0 && r.duration != null && r.duration < minDur * 0.5) abnormalReasons.push(`짧음(${r.duration}s/${minDur}s)`);
                  });
                  const isAbnormal = abnormalReasons.length > 0;
                  const isWarning = isLowScore || isAbnormal;
                  const cardBg = isWarning ? '#fca5a5' : '#f0f9ff';
                  const cardBorder = isWarning ? '#dc2626' : '#bae6fd';
                  const headColor = isWarning ? '#7f1d1d' : '#0369a1';
                  const headLabel = (typeof lastScore === 'number') ? `📤 제출됨 · ${lastScore}점` : '📤 제출됨';
                  const warnSuffix = isAbnormal ? ` ⚠ ${[...new Set(abnormalReasons)].join(', ')}` : '';
                  const cardTitle = isAbnormal
                    ? `클릭 — 상세 보기\n⚠ 측정값 이상: ${[...new Set(abnormalReasons)].join(', ')}`
                    : '클릭 — 상세 보기';
                  // 진도체크·최근시험 모두 최소화 — 한 줄 카드. 클릭 시 상세 모달(#3)
                  return `<div onclick="tpOpenStudentScoreDetail('${esc(testId)}','${esc(s.uid)}')" title="${esc(cardTitle)}" style="background:${cardBg};border:1px solid ${cardBorder};border-radius:6px;padding:5px 22px 5px 9px;font-size:11px;position:relative;cursor:pointer;">
                      ${xBtnRec}
                      <div style="font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name||'?')}</div>
                      <div style="color:${headColor};">${headLabel}${dateStr ? ' · ' + esc(dateStr) : ''}${warnSuffix}</div>
                    </div>`;
                }
                // 옛 데이터 (recordings 없이 latestFailedScore 또는 score 만)
                // Phase B: 통과/불통 폐기 — "제출됨" 으로 통일
                const oldScore = c.score ?? c.latestFailedScore;
                if (typeof oldScore === 'number') {
                  const submittedAt = c.completedAt?.toDate?.()
                    ? _ymdKST(c.completedAt.toDate())
                    : (c.latestFailedAt?.toDate?.() ? _ymdKST(c.latestFailedAt.toDate()) : '');
                  // 50점 이하 — 학원장 확인 강조 (대기·에러보다 진한 빨강)
                  const isLowOld = oldScore <= 50;
                  const cardBgO = isLowOld ? '#fca5a5' : '#f0f9ff';
                  const cardBorderO = isLowOld ? '#dc2626' : '#bae6fd';
                  const headColorO = isLowOld ? '#7f1d1d' : '#0369a1';
                  return `<div style="background:${cardBgO};border:1px solid ${cardBorderO};border-radius:6px;padding:5px 22px 5px 9px;font-size:11px;position:relative;">
                    ${xBtnRec}
                    <div style="font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name||'?')}</div>
                    <div style="color:${headColorO};">📤 제출됨 · ${oldScore}점${submittedAt ? ' · ' + esc(submittedAt) : ''}</div>
                  </div>`;
                }
                // AI/네트워크 에러 (catch 진입) — 빨간 ⚠️ 카드
                if (c.latestErrorStage) {
                  const stageLabel = { upload:'업로드', eval:'AI 평가', firestore:'저장' }[c.latestErrorStage] || c.latestErrorStage;
                  const errAt = c.latestAttemptAt?.toDate?.() ? _ymdKST(c.latestAttemptAt.toDate()) : '';
                  const errMsg = c.latestErrorMessage || '';
                  // recordings 있는 에러 (catch 블록 보강 후 발생) — [🔁 재평가] 노출
                  const reBtnErr = recs.length > 0
                    ? `<button onclick="event.stopPropagation();tpReEvaluateRecording('${esc(testId)}','${esc(s.uid)}','${esc(s.name||'').replace(/'/g,"&#39;")}')" title="AI 재평가 — 마지막 녹음을 다시 평가 (학원 녹음 한도 +1)" style="position:absolute;top:3px;right:26px;width:18px;height:18px;background:rgba(124,58,237,0.12);color:#7C3AED;border:none;border-radius:50%;cursor:pointer;font-size:10px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;">🔁</button>`
                    : '';
                  const rightPad = recs.length > 0 ? '44px' : '22px';
                  return `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;padding:5px ${rightPad} 5px 9px;font-size:11px;position:relative;" title="${esc(errMsg)}">
                    ${reBtnErr}
                    ${xBtnRec}
                    <div style="font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name||'?')}</div>
                    <div style="color:#b91c1c;">⚠️ ${esc(stageLabel)} 실패${errAt ? ' · ' + esc(errAt) : ''}</div>
                  </div>`;
                }
                // 그 외 — fall-through (대기)
              }
              // 일반 시험 (vocab/mcq/fill_blank/unscramble/subjective)
              // _writeUserCompleted 정책: c.score/passed/date 는 최고점 통과 시에만 저장
              // 미통과면 latestScore/latestPassed/latestAt 폴백 사용
              const score = c.score ?? c.latestScore ?? 0;
              const passed = c.passed ?? c.latestPassed ?? false;
              const dateStr = c.date
                || (c.latestAt?.toDate?.() ? _ymdKST(c.latestAt.toDate()) : '');
              const passScore = c.passScore || t.passScore || 80;
              const xBtn = `<button onclick="event.stopPropagation();tpExcludeStudent('${esc(testId)}','${esc(s.uid)}','${esc(s.name||'').replace(/'/g,"&#39;")}', this)" title="이 학생을 시험에서 제외 (응시 기록 삭제)" style="position:absolute;top:3px;right:4px;width:18px;height:18px;background:rgba(0,0,0,0.05);color:#999;border:none;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;">${iconSvg('x')}</button>`;
              if (passed) {
                return `<div onclick="tpOpenStudentScoreDetail('${esc(testId)}','${esc(s.uid)}')" title="클릭 — 상세 보기" style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:6px;padding:5px 22px 5px 9px;font-size:11px;position:relative;cursor:pointer;">
                  ${xBtn}
                  <div style="font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name||'?')}</div>
                  <div style="color:#2e7d32;">✓ ${score}점 · ${esc(dateStr)}</div>
                </div>`;
              }
              return `<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:5px 22px 5px 9px;font-size:11px;position:relative;">
                ${xBtn}
                <div style="font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name||'?')}</div>
                <div style="color:#92400e;">⚠ ${score}점 (통과 ${passScore})</div>
              </div>`;
            }
            const xBtn = `<button onclick="event.stopPropagation();tpExcludeStudent('${esc(testId)}','${esc(s.uid)}','${esc(s.name||'').replace(/'/g,"&#39;")}', this)" title="이 학생을 시험에서 제외" style="position:absolute;top:3px;right:4px;width:18px;height:18px;background:rgba(0,0,0,0.05);color:#999;border:none;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;">${iconSvg('x')}</button>`;
            return `<div style="background:#fff3e0;border:1px solid #ffcc80;border-radius:6px;padding:5px 22px 5px 9px;font-size:11px;position:relative;">
              ${xBtn}
              <div style="font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name||'?')}</div>
              <div style="color:#e65100;">⏳ 대기</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  } catch(e) {
    content.textContent = '로드 실패: ' + e.message;
  }
};

function _tpAvgScore(recordings) {
  if (!recordings?.length) return 0;
  const sum = recordings.reduce((s, r) => s + (r.score || 0), 0);
  return Math.round(sum / recordings.length);
}

// _renderTestAssignDetail 을 window 에 노출 (onclick="_renderTestAssignDetail(...)" 지원)
window._renderTestAssignDetail = _renderTestAssignDetail;

// ══════════════════════════════════════════════════════════════════════════
// AI 프롬프트 보기 / 수정 (유형별 시스템 프롬프트 커스터마이징)
// ══════════════════════════════════════════════════════════════════════════
// 사용자 정의 프롬프트는 localStorage('ai_prompt_custom_<type>') 에 저장되어
// 관리자 디바이스별로 독립 관리. 저장된 경우 생성 API 호출 시 동반 전송.

// UI 에서 쓰는 타입명. 'word'(단어시험) 는 API 호출 시 'vocab' 으로 변환 필요.
// mcq_grammar 은 mcq 의 subType='grammar' 와 연결 (별도 프롬프트 키).
// subjective_verbatim 은 subjective 의 sentenceMode='verbatim' 과 연결 (별도 프롬프트 키).
// 순서 (학원장 편집 모달 탭): 단어 → 빈칸 → 언스크램블 → 객관식 본문이해 → 객관식 문법 →
//   해석 변형 → 해석 유지 → 녹음숙제 (2026-05-24 학원장 요청)
const _qgAiPromptTypes = ['word', 'fill_blank', 'unscramble', 'mcq', 'mcq_grammar', 'subjective', 'subjective_verbatim', 'recording'];
// UI 타입 → API 타입 변환 (/api/generate-quiz GET/POST 에 전달)
const _qgUiToApiType = { word: 'vocab' };
function _qgApiTypeOf(uiType) { return _qgUiToApiType[uiType] || uiType; }

// ─── 언스크램블 편집 핸들러 (Phase 6) ───
window._qgEditUnscrambleMeaning = (idx, value) => {
  if (_qgGenerated[idx]) _qgGenerated[idx].meaningKo = String(value || '').trim();
};
window._qgEditUnscrambleChunks = (idx, value) => {
  if (!_qgGenerated[idx]) return;
  const chunked = String(value || '').trim();
  const chunks = chunked.split('/').map(s => s.trim()).filter(Boolean);
  _qgGenerated[idx].chunkedSentence = chunked;
  _qgGenerated[idx].sentence = chunks.join(' ').replace(/\s+/g, ' ').trim();
  _qgGenerated[idx].chunkCount = chunks.length;
};
window._qgPreviewUnscrambleChunks = (idx, value) => {
  const chunks = String(value || '').split('/').map(s => s.trim()).filter(Boolean);
  const el = document.getElementById(`qgUnscPreview_${idx}`);
  if (!el) return;
  el.innerHTML = `
    <div style="font-size:10px;color:var(--gray);margin-bottom:4px;">청크 미리보기 (${chunks.length}개)</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;">
      ${chunks.map(c => `<span style="padding:3px 8px;background:white;border:1px solid #e9d5ff;border-radius:4px;font-size:12px;color:#6b21a8;">${esc(c)}</span>`).join('')}
    </div>
    <div style="font-size:10px;color:var(--gray);margin-top:4px;">${iconSvg('pen')} 완성: ${esc(chunks.join(' '))}</div>
  `;
};
const _qgAiPromptDefaults = {};  // API GET 으로 로드 후 캐시
let _qgPromptEditingType = 'mcq';

// 학원장 커스텀 AI 프롬프트 — Firestore academies/{id}.customPrompts 저장 (다른 PC 동기화).
// 메모리 cache: window.MY_CUSTOM_PROMPTS (loadMyAcademyContext 진입 시 채움)
function _qgGetCustomPrompt(type) {
  const map = window.MY_CUSTOM_PROMPTS || {};
  return map[type] || '';
}

function _qgSetCustomPrompt(type, value) {
  const v = (value && value.trim()) ? value.trim() : '';
  if (!window.MY_CUSTOM_PROMPTS) window.MY_CUSTOM_PROMPTS = {};
  // 메모리 cache 즉시 갱신 (UI 반영 빠름)
  if (v) window.MY_CUSTOM_PROMPTS[type] = v;
  else delete window.MY_CUSTOM_PROMPTS[type];
  // Firestore 비동기 저장 (실패해도 cache 는 유지 — 다음 PC 에선 반영 X 가능)
  if (window.MY_ACADEMY_ID) {
    const acRef = doc(db, 'academies', window.MY_ACADEMY_ID);
    const update = v
      ? { ['customPrompts.' + type]: v }
      : { ['customPrompts.' + type]: deleteField() };
    updateDoc(acRef, update).catch(e => console.warn('[customPrompts] save failed:', e.message));
  }
  // 옛 localStorage 잔여 정리
  try { localStorage.removeItem('ai_prompt_custom_' + type); } catch {}
}

// 1회성 마이그레이션 — localStorage 'ai_prompt_custom_*' → Firestore academies/{id}.customPrompts
async function _migrateLocalStoragePromptsToFirestore(academyId) {
  if (!academyId) return;
  let keys = [];
  try { keys = Object.keys(localStorage).filter(k => k.startsWith('ai_prompt_custom_')); } catch { return; }
  if (!keys.length) return;
  const updates = {};
  for (const k of keys) {
    const type = k.replace(/^ai_prompt_custom_/, '');
    const value = localStorage.getItem(k);
    if (value && value.trim()) {
      updates['customPrompts.' + type] = value;
      // 메모리 cache 도 즉시 (Firestore 미반영 케이스 안전망)
      if (!window.MY_CUSTOM_PROMPTS) window.MY_CUSTOM_PROMPTS = {};
      window.MY_CUSTOM_PROMPTS[type] = value;
    }
  }
  if (Object.keys(updates).length === 0) return;
  const acRef = doc(db, 'academies', academyId);
  await updateDoc(acRef, updates);
  // 성공 시 localStorage 정리
  keys.forEach(k => { try { localStorage.removeItem(k); } catch {} });
  console.log('[customPrompts] migrated', Object.keys(updates).length, 'prompts to Firestore');
}

async function _qgFetchDefaultPrompt(type, { forceRefresh = false } = {}) {
  if (!forceRefresh && _qgAiPromptDefaults[type]) return _qgAiPromptDefaults[type];
  try {
    const res = await fetch('/api/generate-quiz?type=' + encodeURIComponent(type));
    const data = await res.json();
    if (data.success && data.prompt) {
      _qgAiPromptDefaults[type] = data.prompt;
      return data.prompt;
    }
  } catch(e) { console.warn('prompt fetch:', e); }
  return '';
}

window.qgOpenPromptModal = async () => {
  _qgPromptEditingType = _qgAiPromptTypes.includes(_qgCurrentType) ? _qgCurrentType : 'mcq';
  Object.keys(_qgAiPromptDefaults).forEach(k => delete _qgAiPromptDefaults[k]);

  const html = `
    <div style="width:min(820px,94vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">${iconSvg('clipboard')} AI 프롬프트 편집</div>
        <div style="font-size:11px;color:var(--gray);margin-top:5px;">
          유형별 시스템 프롬프트를 확인·수정합니다. 저장 시 이 브라우저에만 적용 (localStorage).
        </div>
      </div>

      <div id="qgPromptTabs" style="padding:12px 22px;border-bottom:1px solid var(--border);display:flex;gap:6px;flex-wrap:wrap;"></div>

      <div style="padding:16px 22px;flex:1;overflow-y:auto;display:flex;flex-direction:column;min-height:0;">
        <div id="qgPromptStatus" style="font-size:11px;color:var(--gray);margin-bottom:8px;">로딩 중...</div>
        <textarea id="qgPromptText" rows="20"
          style="width:100%;flex:1;min-height:320px;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:ui-monospace,Consolas,monospace;line-height:1.5;resize:vertical;"></textarea>
        <div style="font-size:10px;color:var(--gray);margin-top:6px;">
          💡 팁: 규칙·출력 JSON 형식을 바꾸면 파싱 실패로 이어질 수 있습니다. 수정 후 "AI Generator" 로 실제 테스트하세요.
        </div>
      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:space-between;align-items:center;">
        <button class="btn btn-secondary" onclick="qgResetPrompt()">↺ 기본값으로 복원</button>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="closeModal()">닫기</button>
          <button class="btn btn-primary" onclick="qgSavePrompt()">${iconSvg('save')} 저장</button>
        </div>
      </div>
    </div>
  `;
  showModal(html);
  _qgRenderPromptTabs();
  await _qgLoadPromptIntoTextarea(_qgPromptEditingType);
};

// QG_TYPE_OPTIONS 에 없는 별칭 키들 (mcq_grammar / subjective_verbatim 같은 subType 별 프롬프트)
// 동일 키가 QG_TYPE_OPTIONS 에 있어도 alias 가 우선 (해석하기 변형/유지 구분 필요)
const _QG_PROMPT_ALIAS_LABELS = {
  mcq:                 { icon: '📖', label: '객관식 (본문이해)' },
  mcq_grammar:         { icon: '📐', label: '객관식 (문법)' },
  subjective:          { icon: '✍️', label: '해석하기 (문장변형)' },
  subjective_verbatim: { icon: '📄', label: '해석하기 (문장유지)' },
};

function _qgRenderPromptTabs() {
  const tabs = document.getElementById('qgPromptTabs');
  if (!tabs) return;
  tabs.innerHTML = _qgAiPromptTypes.map(t => {
    const alias = _QG_PROMPT_ALIAS_LABELS[t];
    const cfg = QG_TYPE_OPTIONS[t] || {};
    const active = t === _qgPromptEditingType;
    const hasCustom = !!_qgGetCustomPrompt(_qgApiTypeOf(t));
    const icon = alias?.icon || cfg.icon || '•';
    const label = alias?.label || cfg.label || t;
    return `<button onclick="qgSwitchPromptTab('${t}')" class="btn ${active?'btn-primary':'btn-secondary'}" style="font-size:12px;padding:5px 12px;">
      ${icon} ${esc(label)}${hasCustom?' <span style="color:#c47;">●</span>':''}
    </button>`;
  }).join('');
}

async function _qgLoadPromptIntoTextarea(type) {
  const textarea = document.getElementById('qgPromptText');
  const status = document.getElementById('qgPromptStatus');
  if (!textarea || !status) return;

  const apiType = _qgApiTypeOf(type);
  const custom = _qgGetCustomPrompt(apiType);
  if (custom) {
    textarea.value = custom;
    status.innerHTML = '<span style="color:#c47;font-weight:700;">● 사용자 정의 프롬프트 활성 (저장됨)</span>';
    return;
  }
  status.innerHTML = '기본값 로딩 중...';
  textarea.value = '';
  const def = await _qgFetchDefaultPrompt(apiType);
  textarea.value = def || '';
  if (def) {
    status.innerHTML = '<span style="color:var(--gray);">기본 프롬프트 — 수정 후 [저장] 하면 이 유형에만 적용됩니다</span>';
  } else {
    status.innerHTML = '<span style="color:#c33;">기본 프롬프트 로드 실패</span>';
  }
}

window.qgSwitchPromptTab = async (type) => {
  if (!_qgAiPromptTypes.includes(type)) return;
  _qgPromptEditingType = type;
  _qgRenderPromptTabs();
  await _qgLoadPromptIntoTextarea(type);
};

window.qgSavePrompt = () => {
  const textarea = document.getElementById('qgPromptText');
  if (!textarea) return;
  const val = (textarea.value || '').trim();
  if (val.length < 20) { showAlert('입력 확인', '프롬프트가 너무 짧습니다 (최소 20자)'); return; }
  const apiType = _qgApiTypeOf(_qgPromptEditingType);
  const def = (_qgAiPromptDefaults[apiType] || '').trim();
  const label = QG_TYPE_OPTIONS[_qgPromptEditingType]?.label || _qgPromptEditingType;
  if (def && val === def) {
    _qgSetCustomPrompt(apiType, '');
    showToast(`${label}: 기본값과 동일 → 사용자 정의 해제`);
  } else {
    _qgSetCustomPrompt(apiType, val);
    showToast(`✓ ${label} 프롬프트 저장됨`);
  }
  _qgRenderPromptTabs();
  _qgLoadPromptIntoTextarea(_qgPromptEditingType);
};

window.qgResetPrompt = async () => {
  const apiType = _qgApiTypeOf(_qgPromptEditingType);
  const label = QG_TYPE_OPTIONS[_qgPromptEditingType]?.label || _qgPromptEditingType;
  if (!_qgGetCustomPrompt(apiType)) { showAlert('입력 확인', '이미 기본값 사용 중'); return; }
  if (!(await showConfirm('기본값으로 복원?', `${label}의 사용자 정의가 삭제됩니다.`))) return;
  _qgSetCustomPrompt(apiType, '');
  delete _qgAiPromptDefaults[apiType];
  showToast('기본값으로 복원됨');
  _qgRenderPromptTabs();
  await _qgLoadPromptIntoTextarea(_qgPromptEditingType);
};

// ── 학원 브랜딩 (화이트라벨) ────────────────────────────────
let _brandingState = null;  // { presetId, catchphrase, logoUrl, logo192Url, logo512Url, planId, academyName }

async function loadBranding() {
  const main = document.getElementById('brandingMain');
  if (!main) return;
  try {
    const acadSnap = await getDoc(doc(db, 'academies', window.MY_ACADEMY_ID || 'default'));
    if (!acadSnap.exists()) {
      main.innerHTML = '<div style="padding:24px;color:#e05050;">학원 정보 로드 실패</div>';
      return;
    }
    const a = acadSnap.data();
    const planId = a.planId || 'free';
    const branding = a.branding || {};
    _brandingState = {
      presetId: branding.presetId || 'coral',
      catchphrase: branding.catchphrase || '',
      logoUrl: branding.logoUrl || '',
      logo192Url: branding.logo192Url || '',
      logo512Url: branding.logo512Url || '',
      planId,
      academyName: a.name || '',
    };
    _renderBrandingPage();
  } catch (e) {
    main.innerHTML = `<div style="padding:24px;color:#e05050;">로드 실패: ${esc(e.message)}</div>`;
  }
}

function _isBrandingLocked() {
  return _brandingState && _brandingState.planId === 'free';
}

function _renderBrandingPage() {
  const s = _brandingState;
  if (!s) return;
  const main = document.getElementById('brandingMain');
  const presets = window.BRANDING_PRESETS || {};
  const locked = _isBrandingLocked();

  // 플랜 정보 갱신
  const planInfo = document.getElementById('brandingPlanInfo');
  if (planInfo) {
    const planLabel = (s.planId || 'free').toUpperCase();
    planInfo.textContent = `현재 플랜: ${planLabel}${locked ? ' — 브랜딩 변경은 Lite 이상 플랜에서 가능' : ' — 변경 즉시 학생 앱에 반영'}`;
  }

  const presetCards = Object.values(presets).map(p => `
    <div onclick="${locked ? '_brandingShowLockMsg()' : `_brandingSelectPreset('${p.id}')`}"
         style="border:2px solid ${s.presetId === p.id ? p.primary : 'var(--border)'};border-radius:10px;padding:12px;cursor:${locked ? 'not-allowed' : 'pointer'};text-align:center;background:white;${locked ? 'opacity:0.5;' : ''}transition:.15s;position:relative;">
      <div style="height:60px;border-radius:8px;background:${p.loginGradient};display:flex;align-items:center;justify-content:center;margin-bottom:8px;">
        <span style="font-size:28px;">${p.emoji}</span>
      </div>
      <div style="font-size:13px;font-weight:${s.presetId === p.id ? 700 : 500};color:var(--text);">${p.name}</div>
      ${p.isDefault ? '<div style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.6);color:white;font-size:9px;padding:2px 6px;border-radius:8px;">기본</div>' : ''}
      ${s.presetId === p.id ? `<div style="position:absolute;top:6px;left:6px;background:${p.primary};color:white;font-size:10px;padding:2px 6px;border-radius:8px;">✓ 선택</div>` : ''}
    </div>
  `).join('');

  const currentPreset = presets[s.presetId] || presets.coral;
  const previewLogo = s.logo192Url || '/icons/icon-192.png';
  const previewSub = s.catchphrase || '큰소리로 말하는 영어 학습';

  main.innerHTML = `
    ${locked ? `
      <div class="card" style="padding:14px 18px;margin-bottom:14px;background:#fff7ed;border:1px solid #fed7aa;display:flex;align-items:center;gap:12px;">
        <div style="font-size:28px;">🔒</div>
        <div style="flex:1;">
          <div style="font-weight:700;color:#9a3412;">Free 플랜에서는 LexiAI 기본 디자인이 적용됩니다.</div>
          <div style="font-size:12px;color:#9a3412;margin-top:3px;">학원 로고·색상·캐치프레이즈 변경은 Lite 이상 플랜에서 가능합니다.</div>
        </div>
      </div>
    ` : ''}

    <!-- 미리보기 + 색상 + 로고 + 캐치프레이즈 그리드 레이아웃 -->
    <div style="display:grid;grid-template-columns:340px 1fr;gap:14px;">
      <!-- 좌측: 학생 앱 로그인 화면 미리보기 -->
      <div class="card" style="padding:0;overflow:hidden;position:sticky;top:12px;align-self:start;">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;">📱 학생 앱 미리보기</div>
        <div id="brandingPreview" style="background:${currentPreset.loginGradient};color:white;padding:36px 20px;text-align:center;">
          <img id="brandingPreviewLogo" src="${previewLogo}" alt="" style="width:80px;height:80px;border-radius:18px;background:rgba(255,255,255,0.2);padding:6px;object-fit:contain;margin-bottom:10px;">
          <div id="brandingPreviewTitle" style="font-size:24px;font-weight:800;margin-bottom:4px;">${esc(s.academyName || '학원명')}</div>
          <div id="brandingPreviewSub" style="font-size:13px;opacity:0.92;">${esc(previewSub)}</div>
        </div>
        <div style="padding:18px;background:white;">
          <div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12px;color:#999;margin-bottom:8px;">아이디</div>
          <div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12px;color:#999;margin-bottom:10px;">비밀번호</div>
          <div id="brandingPreviewBtn" style="background:${currentPreset.loginGradient};color:white;text-align:center;padding:12px;border-radius:12px;font-weight:700;font-size:14px;">로그인</div>
          <div style="text-align:center;font-size:10px;color:#999;margin-top:10px;letter-spacing:0.3px;">
            Powered by <strong style="color:#666;">LexiAI</strong>
          </div>
        </div>
      </div>

      <!-- 우측: 설정 입력 -->
      <div style="display:flex;flex-direction:column;gap:14px;">
        <!-- 색상 팔레트 -->
        <div class="card" style="padding:14px 18px;">
          <div style="font-weight:700;margin-bottom:10px;">🎨 색상 팔레트 ${locked ? '<span style="font-weight:400;color:#999;font-size:12px;">(잠김)</span>' : ''}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;">
            ${presetCards}
          </div>
        </div>

        <!-- 로고 -->
        <div class="card" style="padding:14px 18px;">
          <div style="font-weight:700;margin-bottom:10px;">🖼️ 학원 로고</div>
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="width:80px;height:80px;border:1px solid var(--border);border-radius:10px;background:#f8f9fa;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
              <img id="brandingCurrentLogo" src="${s.logo192Url || '/icons/icon-192.png'}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;">
            </div>
            <div style="flex:1;">
              <input type="file" id="brandingLogoInput" accept="image/png" style="display:none;" onchange="_brandingOnLogoFile(event)">
              <div style="display:flex;gap:8px;margin-bottom:6px;">
                <button class="btn btn-primary" ${locked ? 'disabled' : ''} onclick="document.getElementById('brandingLogoInput').click()" style="font-size:12px;padding:7px 12px;">📤 PNG 업로드</button>
                ${s.logo192Url ? `<button class="btn btn-secondary" ${locked ? 'disabled' : ''} onclick="_brandingRemoveLogo()" style="font-size:12px;padding:7px 12px;">🗑️ 로고 제거</button>` : ''}
              </div>
              <div style="font-size:11px;color:var(--gray);line-height:1.5;">
                • PNG 만 (최대 5MB) · 정사각형 권장<br>
                • 192/512 자동 생성 → 학생 앱 + PWA 아이콘 반영
              </div>
            </div>
          </div>
        </div>

        <!-- 캐치프레이즈 -->
        <div class="card" style="padding:14px 18px;">
          <div style="font-weight:700;margin-bottom:6px;">✨ 캐치프레이즈 <span style="font-weight:400;color:#999;font-size:12px;">(학생 로그인 화면 부제, 최대 40자)</span></div>
          <input type="text" id="brandingCatchphrase" maxlength="40" value="${esc(s.catchphrase || '')}"
            ${locked ? 'disabled' : ''}
            placeholder="예: 소리내어 읽으면 영어가 들립니다"
            oninput="_brandingOnCatchphraseInput(this.value)"
            style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px;outline:none;">
          <div style="font-size:11px;color:#999;text-align:right;margin-top:4px;"><span id="brandingCpCount">${(s.catchphrase || '').length}</span> / 40</div>
        </div>

        <!-- 저장 -->
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-secondary" ${locked ? 'disabled' : ''} onclick="_brandingResetDefaults()" style="font-size:13px;">↺ 기본값 복원</button>
          <button class="btn btn-primary" ${locked ? 'disabled' : ''} onclick="_brandingSave()" style="font-size:13px;font-weight:700;">${iconSvg('save')} 색상·문구 저장</button>
        </div>
        <div style="font-size:11px;color:#999;text-align:right;">로고 업로드는 즉시 저장됩니다. 색상·문구는 [💾 저장] 클릭 후 반영.</div>
      </div>
    </div>`;
}

window._brandingShowLockMsg = () => {
  showAlert('Free 플랜', '색상 변경은 Lite 이상 플랜에서 가능합니다.');
};

window._brandingSelectPreset = (id) => {
  if (_isBrandingLocked()) return;
  if (!_brandingState) return;
  _brandingState.presetId = id;
  _renderBrandingPage();
};

window._brandingOnCatchphraseInput = (val) => {
  if (_isBrandingLocked()) return;
  if (!_brandingState) return;
  _brandingState.catchphrase = val;
  const cnt = document.getElementById('brandingCpCount');
  if (cnt) cnt.textContent = val.length;
  const sub = document.getElementById('brandingPreviewSub');
  if (sub) sub.textContent = val || '큰소리로 말하는 영어 학습';
};

window._brandingOnLogoFile = async (event) => {
  if (_isBrandingLocked()) return;
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.type !== 'image/png') { showAlert('파일 형식', 'PNG 파일만 업로드 가능합니다.'); event.target.value = ''; return; }
  if (file.size > 5 * 1024 * 1024) { showAlert('파일 크기', '5MB 이하 PNG 만 업로드 가능합니다.'); event.target.value = ''; return; }

  showToast('🚀 업로드 중...');
  try {
    const reader = new FileReader();
    const base64 = await new Promise((resolve, reject) => {
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const idToken = await currentUser.getIdToken();
    const r = await fetch('/api/uploadLogo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, imageBase64: base64 }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || '업로드 실패');
    _brandingState.logoUrl = j.urls.original;
    _brandingState.logo192Url = j.urls['192'];
    _brandingState.logo512Url = j.urls['512'];
    _renderBrandingPage();
    showToast('✅ 로고 업로드 완료 — 학생 앱 새로고침 시 반영');
  } catch (e) {
    showAlert('업로드 실패', e.message);
  }
  event.target.value = '';
};

window._brandingRemoveLogo = async () => {
  if (_isBrandingLocked()) return;
  if (!await showConfirm('로고 제거', '학원 로고를 제거하면 LexiAI 기본 아이콘이 표시됩니다.')) return;
  try {
    await updateDoc(doc(db, 'academies', window.MY_ACADEMY_ID), {
      'branding.logoUrl': '',
      'branding.logo192Url': '',
      'branding.logo512Url': '',
      'branding.updatedAt': serverTimestamp(),
      'branding.updatedBy': currentUser.uid,
    });
    _brandingState.logoUrl = '';
    _brandingState.logo192Url = '';
    _brandingState.logo512Url = '';
    _renderBrandingPage();
    showToast('🗑️ 로고가 제거됐어요');
  } catch (e) { showAlert('저장 실패', e.message); }
};

window._brandingResetDefaults = async () => {
  if (_isBrandingLocked()) return;
  if (!await showConfirm('기본값 복원', '색상은 코랄 핑크(LexiAI 기본), 캐치프레이즈는 빈 값으로 되돌립니다. (로고는 별도 [로고 제거])')) return;
  _brandingState.presetId = 'coral';
  _brandingState.catchphrase = '';
  _renderBrandingPage();
};

window._brandingSave = async () => {
  if (_isBrandingLocked()) return;
  if (!_brandingState) return;
  try {
    await updateDoc(doc(db, 'academies', window.MY_ACADEMY_ID), {
      'branding.presetId': _brandingState.presetId,
      'branding.catchphrase': _brandingState.catchphrase,
      'branding.updatedAt': serverTimestamp(),
      'branding.updatedBy': currentUser.uid,
    });
    showToast('✅ 브랜딩 저장 — 학생 앱 새로고침 시 반영');
    // 학원장 앱에도 즉시 반영
    if (typeof window.applyPresetToCss === 'function' && window.BRANDING_PRESETS) {
      window.applyPresetToCss(window.BRANDING_PRESETS[_brandingState.presetId]);
    }
  } catch (e) { showAlert('저장 실패', e.message); }
};

// ─── ScoreSnap — Firestore·인증 헬퍼 ────────────────────────────
// scoresnap.js 는 일반 script (module 아님) 이라 module 안 currentUser·SDK 를
// 직접 못 씀. 채점 API 호출용 idToken 만 window 노출.
window._ssGetIdToken = async function () {
  if (!currentUser) throw new Error('로그인 정보 없음');
  return await currentUser.getIdToken();
};

// ═══════════════════════════════════════════════════════════════
// 진도체크 — 학생별 / 시험별 탭. 학생별이 기본.
// ═══════════════════════════════════════════════════════════════

// 진도체크 모듈 state
let _prog = {
  tab: 'date',          // 'date' | 'student' | 'test'
  groups: [],           // 반 목록
  students: [],         // 재원 학생 [{ uid, name, group, ... }]
  testsByDate: {},      // 일자별 탭용 — { 'YYYY-MM-DD': [...tests] }
  studentCache: {},     // 학생별 탭용 — { uid: { tests: [], days: 0 } } (server-side filter, 2026-05-14)
  selectedUid: null,    // 선택된 학생 uid
  userCompCache: {},    // { uid: { testId: comp } } — 학생별 userCompleted 캐시
  loaded: false,        // users + groups 로드 여부
  studentLoading: false,// 학생 시험 fetch 중 (중복 호출 방지)
  dateInited: false,    // 일자 input 초기 set (어제) 여부
  dateLoading: null,    // 현재 fetch 중인 일자 (중복 호출 방지)
};

const _PROG_TYPES = [
  { mode: 'vocab',       label: '단어시험'     },
  { mode: 'fill_blank',  label: '빈칸채우기'   },
  { mode: 'unscramble',  label: '언스크램블'   },
  { mode: 'mcq',         label: '본문이해·문법' },
  { mode: 'recording',   label: '녹음숙제'     },
];
const _PROG_DAYS = 30;            // (deprecated — _PROG_STUDENT_DAYS_CAP 로 대체. 안전 폴백)
const _PROG_STUDENT_DAYS_STEP = 10; // 학생별 탭 — 1차 + 더보기 1회당 일수
const _PROG_STUDENT_DAYS_CAP = 30;  // 학생별 탭 — 최대 일수 (학생앱 패턴과 동일)

async function loadProgressCheck() {
  if (_prog.loaded) {
    // 이미 로드됐으면 현재 탭만 렌더 (재진입)
    _progApplyTab();
    return;
  }
  // 진입 시 students + groups 만 (시험은 일자별 탭이 일자 조건으로 lazy fetch — 2026-05-14)
  try {
    const [usersSnap, groupsSnap] = await Promise.all([
      getDocs(query(collection(db, 'users'),
        where('academyId', '==', window.MY_ACADEMY_ID),
        where('role', '==', 'student'),
        where('status', '==', 'active'))),
      getDocs(query(collection(db, 'groups'),
        where('academyId', '==', window.MY_ACADEMY_ID))),
    ]);
    _prog.students = usersSnap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => (a.group || '').localeCompare(b.group || '') || (a.name || '').localeCompare(b.name || ''));
    _prog.groups = groupsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    _prog.loaded = true;
    _progFillGroupFilter();
    _progInitDateInput();
    _progApplyTab();
    progRenderStudentList();
    // 기본 탭이 일자별이라 진입 시 한 번 렌더 (일자 default = 어제 → fetch + 캐시)
    if (_prog.tab === 'date') progRenderByDate();
  } catch (e) {
    console.warn('[progress] load failed:', e);
    const list = document.getElementById('progStudentList');
    if (list) list.innerHTML = `<div style="padding:20px;text-align:center;color:#e05050;font-size:13px;">불러오기 실패: ${esc(e.message)}</div>`;
  }
  // 기존 시험별 진도체크 (테이블) 도 백그라운드 로드 (별도 lazy)
  loadTestList().catch(e => console.warn('[testList]', e));
}

// 일자별 시험 lazy fetch + 캐시 (academyId + date == ymd)
async function _progFetchTestsByDate(ymd) {
  if (_prog.testsByDate[ymd]) return _prog.testsByDate[ymd];
  if (_prog.dateLoading === ymd) {
    // 같은 일자 동시 fetch 방지 — 0.5초 폴링
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 50));
      if (_prog.testsByDate[ymd]) return _prog.testsByDate[ymd];
    }
  }
  _prog.dateLoading = ymd;
  try {
    const snap = await getDocs(query(
      collection(db, 'genTests'),
      where('academyId', '==', window.MY_ACADEMY_ID),
      where('date', '==', ymd)
    ));
    const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _prog.testsByDate[ymd] = arr;
    return arr;
  } finally {
    _prog.dateLoading = null;
  }
}

// 학생별 시험 점진 fetch — 그 학생 대상만 server-side filter (2026-05-14)
// 3 쿼리 병렬 (targetAll / targetUids / targetGroups) + dedup. daysTarget: 10/20/30
async function _progLoadStudentTestsForUid(uid, group, daysTarget) {
  if (!uid) return [];
  const cache = _prog.studentCache[uid] || { tests: [], days: 0 };
  if (cache.days >= daysTarget) return cache.tests;
  if (_prog.studentLoading) return cache.tests;
  _prog.studentLoading = true;
  try {
    const sinceMs = Date.now() - daysTarget * 24 * 3600 * 1000;
    const baseConstraints = [
      where('academyId', '==', window.MY_ACADEMY_ID),
      where('createdAt', '>=', new Date(sinceMs)),
    ];
    if (cache.days > 0) {
      const untilMs = Date.now() - cache.days * 24 * 3600 * 1000;
      baseConstraints.push(where('createdAt', '<', new Date(untilMs)));
    }
    baseConstraints.push(orderBy('createdAt', 'desc'));
    // 3 분리 쿼리 병렬 (targetAll==true / targetUids contains uid / targetGroups contains group)
    const queries = [
      query(collection(db, 'genTests'), ...baseConstraints, where('targetAll', '==', true)),
      query(collection(db, 'genTests'), ...baseConstraints, where('targetUids', 'array-contains', uid)),
    ];
    if (group) {
      queries.push(query(collection(db, 'genTests'), ...baseConstraints, where('targetGroups', 'array-contains', group)));
    }
    const snaps = await Promise.all(queries.map(q => getDocs(q)));
    // dedup merge into cache — 학원장이 [✕ 제외] 한 학생은 제외 (학생앱·시험별 진도체크와 동일 정책)
    const seen = new Set(cache.tests.map(t => t.id));
    snaps.forEach(snap => {
      snap.docs.forEach(d => {
        if (seen.has(d.id)) return;
        const td = d.data();
        if (Array.isArray(td.excludedUids) && td.excludedUids.includes(uid)) return;
        cache.tests.push({ id: d.id, ...td });
        seen.add(d.id);
      });
    });
    cache.days = daysTarget;
    _prog.studentCache[uid] = cache;
    return cache.tests;
  } finally {
    _prog.studentLoading = false;
  }
}

// 한 학생의 userCompleted batch fetch — 그 학생 캐시 시험 기준
async function _progLoadUserCompleted(uid) {
  if (!uid) return {};
  const tests = _prog.studentCache[uid]?.tests || [];
  const fetches = tests.map(t =>
    getDoc(doc(db, 'genTests', t.id, 'userCompleted', uid))
      .then(snap => ({ testId: t.id, data: snap.exists() ? snap.data() : null }))
      .catch(() => ({ testId: t.id, data: null }))
  );
  const results = await Promise.all(fetches);
  const map = {};
  results.forEach(r => { if (r.data) map[r.testId] = r.data; });
  _prog.userCompCache[uid] = map;
  return map;
}

function _progFillGroupFilter() {
  const set = new Set();
  _prog.students.forEach(s => { if (s.group) set.add(s.group); });
  _prog.groups.forEach(g => { if (g.name) set.add(g.name); });
  const groups = [...set].sort((a, b) => a.localeCompare(b));
  const optionsOnly = groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
  // 학생별 패널 — 전체 반 default 유지 (학생 목록 필터)
  const sel = document.getElementById('progGroupFilter');
  if (sel) sel.innerHTML = `<option value="">전체 반</option>` + optionsOnly;
  // 일자별 패널 — placeholder 만 (전체 반 옵션 X). 명시 선택해야 결과 표시
  const dateSel = document.getElementById('progDateGroup');
  if (dateSel) dateSel.innerHTML = `<option value="">반을 선택하세요</option>` + optionsOnly;
}

function _progApplyTab() {
  const t = _prog.tab;
  document.getElementById('progPanelDate').style.display    = (t === 'date')    ? 'block' : 'none';
  document.getElementById('progPanelStudent').style.display = (t === 'student') ? 'block' : 'none';
  document.getElementById('progPanelTest').style.display    = (t === 'test')    ? 'block' : 'none';
  const btnMap = {
    date:    document.getElementById('progTabDate'),
    student: document.getElementById('progTabStudent'),
    test:    document.getElementById('progTabTest'),
  };
  Object.entries(btnMap).forEach(([key, btn]) => {
    if (!btn) return;
    const active = (key === t);
    btn.style.color = active ? 'var(--teal,#E8714A)' : 'var(--gray)';
    btn.style.fontWeight = active ? '700' : '500';
    btn.style.borderBottomColor = active ? 'var(--teal,#E8714A)' : 'transparent';
  });
}

window.progSwitchTab = function (tab) {
  _prog.tab = (['date', 'student', 'test'].includes(tab)) ? tab : 'date';
  _progApplyTab();
  if (_prog.tab === 'date') progRenderByDate();
};

window.progRenderStudentList = function () {
  const list = document.getElementById('progStudentList');
  if (!list) return;
  const group = (document.getElementById('progGroupFilter')?.value || '').trim();
  const q = (document.getElementById('progStudentSearch')?.value || '').trim().toLowerCase();
  const filtered = _prog.students.filter(s => {
    if (group && (s.group || '') !== group) return false;
    if (q && !((s.name || '').toLowerCase().includes(q))) return false;
    return true;
  });
  if (filtered.length === 0) {
    list.innerHTML = `<span style="color:var(--gray);font-size:13px;padding:0 8px;">검색 결과 없음</span>`;
    return;
  }
  // 가로 한 줄 칩 — 단일 선택. 반은 활성 학생에서만 작게 노출
  list.innerHTML = filtered.map(s => {
    const active = (s.uid === _prog.selectedUid);
    return `<button onclick="progSelectStudent('${esc(s.uid)}')"
      style="flex:0 0 auto;padding:5px 12px;border:1px solid ${active ? 'var(--teal,#E8714A)' : 'var(--border)'};background:${active ? 'var(--teal,#E8714A)' : 'white'};color:${active ? 'white' : 'var(--text)'};border-radius:14px;cursor:pointer;font-size:12px;font-weight:${active ? '700' : '500'};white-space:nowrap;transition:.12s;line-height:1.4;">${esc(s.name || '이름 없음')}${active && s.group ? ` <span style="opacity:.85;font-weight:500;">(${esc(s.group)})</span>` : ''}</button>`;
  }).join('');
};

window.progSelectStudent = async function (uid) {
  _prog.selectedUid = uid;
  const s = _prog.students.find(x => x.uid === uid);
  const label = document.getElementById('progSelectedLabel');
  if (label) {
    label.textContent = s ? `${s.name || '?'} (${s.group || '반 없음'})` : '학생 선택 안 됨';
    label.style.color = 'var(--text)';
  }
  progRenderStudentList();  // 선택 강조 갱신
  const detail = document.getElementById('progStudentDetail');
  const myGroup = s?.group || '';
  // 그 학생 대상 시험 lazy fetch — 10일치 (학생앱 패턴, 학생별 캐시)
  const cache = _prog.studentCache[uid];
  if (!cache || cache.days === 0) {
    if (detail) detail.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--gray);font-size:14px;">시험 목록 불러오는 중...</div>`;
    try { await _progLoadStudentTestsForUid(uid, myGroup, _PROG_STUDENT_DAYS_STEP); }
    catch (e) { console.warn('[progress] tests:', e); }
  }
  // 학생 userCompleted 캐시 (miss 시만)
  if (!_prog.userCompCache[uid]) {
    if (detail) detail.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--gray);font-size:14px;">진도 불러오는 중...</div>`;
    try { await _progLoadUserCompleted(uid); }
    catch (e) { console.warn('[progress] userCompleted:', e); _prog.userCompCache[uid] = {}; }
  }
  _progRenderStudentDetail();
};

function _progRenderStudentDetail() {
  const detail = document.getElementById('progStudentDetail');
  if (!detail) return;
  if (!_prog.selectedUid) {
    detail.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--gray);font-size:14px;">학생을 선택하면 5개 시험 유형별 진도가 표시됩니다</div>`;
    return;
  }
  const uid = _prog.selectedUid;
  const userComps = _prog.userCompCache[uid] || {};

  // 학생별 server-side filter 결과 (그 학생 대상 시험만 fetch 됨 — 2026-05-14)
  const cache = _prog.studentCache[uid];
  const myTests = cache?.tests || [];

  // 유형별 그룹화 + 진행상태 분류
  const cols = _PROG_TYPES.map(type => {
    const list = myTests.filter(t => (t.testMode || t.mode || '').toLowerCase() === type.mode);
    // 본문이해·문법 (mcq) 은 subType 무관, 한 컬럼에 다 표시 (배지로 구분)
    const inProgress = [], completed = [];
    list.forEach(t => {
      const comp = userComps[t.id];
      const passed = comp?.passed === true || comp?.latestPassed === true;
      if (passed) completed.push({ t, comp });
      else inProgress.push({ t, comp });
    });
    return { type, inProgress, completed };
  });

  // 더보기 버튼 — 그 학생 캐시의 days 기준 (학생별 lazy)
  const days = cache?.days || 0;
  const atCap = days >= _PROG_STUDENT_DAYS_CAP;
  const loadMoreHtml = atCap
    ? `<div style="text-align:center;padding:12px;color:#bbb;font-size:11px;">최근 ${days}일 시험 전체 표시 (cap)</div>`
    : `<div style="text-align:center;padding:12px;">
        <button class="btn btn-secondary" style="font-size:12px;padding:6px 14px;" onclick="progLoadMoreStudentTests()">
          +${_PROG_STUDENT_DAYS_STEP}일 더보기 (현재 ${days}일)
        </button>
      </div>`;

  detail.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(5,minmax(200px,1fr));gap:12px;">
      ${cols.map(c => _progBuildColumnHtml(c)).join('')}
    </div>
    ${loadMoreHtml}
  `;
}

// 학생별 탭 — +10일 더보기 (그 학생의 캐시만 확장, 30일 cap)
window.progLoadMoreStudentTests = async function () {
  const uid = _prog.selectedUid;
  if (!uid) return;
  const s = _prog.students.find(x => x.uid === uid);
  const myGroup = s?.group || '';
  const cache = _prog.studentCache[uid] || { tests: [], days: 0 };
  const next = Math.min(cache.days + _PROG_STUDENT_DAYS_STEP, _PROG_STUDENT_DAYS_CAP);
  if (next <= cache.days) return;
  const detail = document.getElementById('progStudentDetail');
  if (detail) {
    const btn = detail.querySelector('button[onclick*="progLoadMoreStudentTests"]');
    if (btn) { btn.textContent = '불러오는 중...'; btn.disabled = true; }
  }
  try {
    await _progLoadStudentTestsForUid(uid, myGroup, next);
    // 새 일수 구간 시험에 대해 그 학생 userCompleted 도 batch (현재 선택 학생만)
    delete _prog.userCompCache[uid];
    await _progLoadUserCompleted(uid);
  } catch (e) {
    console.warn('[progress] load more:', e);
    showToast('더보기 실패: ' + e.message);
  }
  _progRenderStudentDetail();
};

// 시험이 이 학생에게 배정됐는지
function _progTestAssignedTo(test, uid, group) {
  const ts = Array.isArray(test.targets) ? test.targets : [];
  if (!ts.length) {
    // 옛 데이터 — target 또는 targetUid 폴백
    if (test.target === 'all') return true;
    if (typeof test.target === 'string' && test.target.startsWith('uid:')) return test.target.slice(4) === uid;
    if (test.targetUid === uid) return true;
    return false;
  }
  // 제외 학생 체크
  if (Array.isArray(test.excludedUids) && test.excludedUids.includes(uid)) return false;
  return ts.some(t => {
    if (t.type === 'all') return true;
    if (t.type === 'student' && t.id === uid) return true;
    if (t.type === 'class' && (t.groupName === group || t.name === group)) return true;
    return false;
  });
}

function _progBuildColumnHtml(col) {
  const { type, inProgress, completed } = col;
  const total = inProgress.length + completed.length;
  return `
    <div style="background:white;border:1px solid var(--border);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px;min-height:200px;">
      <div style="border-bottom:1px solid var(--border);padding-bottom:8px;">
        <div style="font-size:13px;font-weight:700;color:var(--text);">${esc(type.label)}</div>
        <div style="font-size:10px;color:var(--gray);margin-top:2px;">총 ${total}건 · 완료 ${completed.length} / 진행 ${inProgress.length}</div>
      </div>
      ${total === 0 ? `
        <div style="font-size:11px;color:var(--gray);text-align:center;padding:20px 0;">배정된 시험 없음</div>
      ` : `
        ${inProgress.length > 0 ? `
          <div>
            <div style="font-size:11px;font-weight:700;color:#bf360c;margin-bottom:6px;">진행 · 신규</div>
            ${inProgress.map(({t, comp}) => _progBuildTestCardHtml(t, comp, false)).join('')}
          </div>
        ` : ''}
        ${completed.length > 0 ? `
          <div>
            <div style="font-size:11px;font-weight:700;color:#2e7d32;margin-bottom:6px;">완료</div>
            ${completed.map(({t, comp}) => _progBuildTestCardHtml(t, comp, true)).join('')}
          </div>
        ` : ''}
      `}
    </div>
  `;
}

// 일자 input 초기화 — 기본 어제 (KST)
function _progInitDateInput() {
  if (_prog.dateInited) return;
  const el = document.getElementById('progDateInput');
  if (!el) return;
  const d = new Date(Date.now() - 24 * 3600 * 1000 + 9 * 3600 * 1000);  // 어제 KST
  el.value = d.toISOString().slice(0, 10);
  _prog.dateInited = true;
}

// 일자별 반별 진도체크 렌더 — 조건 일치 시험 N개 자동 펼침
window.progRenderByDate = async function () {
  if (!_prog.loaded) return;
  const dateEl = document.getElementById('progDateInput');
  const groupEl = document.getElementById('progDateGroup');
  const results = document.getElementById('progDateResults');
  const summary = document.getElementById('progDateSummary');
  if (!dateEl || !results) return;
  const date = (dateEl.value || '').trim();
  const group = (groupEl?.value || '').trim();
  if (!date) {
    results.innerHTML = `<div style="text-align:center;padding:30px 20px;color:var(--gray);font-size:13px;">일자를 선택해 주세요</div>`;
    if (summary) summary.textContent = '';
    return;
  }
  if (!group) {
    results.innerHTML = `<div style="text-align:center;padding:30px 20px;color:var(--gray);font-size:13px;">반을 선택하세요</div>`;
    if (summary) summary.textContent = '';
    return;
  }

  // 그 날 시험 lazy fetch + 캐시 (academyId + date == ymd)
  const cacheHit = !!_prog.testsByDate[date];
  if (!cacheHit) {
    results.innerHTML = `<div style="text-align:center;padding:30px 20px;color:#bbb;font-size:13px;">불러오는 중...</div>`;
    if (summary) summary.textContent = `${date} · ${group}`;
  }
  let dayTests;
  try {
    dayTests = await _progFetchTestsByDate(date);
  } catch (e) {
    results.innerHTML = `<div style="text-align:center;padding:30px 20px;color:#e05050;font-size:13px;">불러오기 실패: ${esc(e.message)}</div>`;
    return;
  }

  // 시험 필터 — 전체 대상 / 해당 반 대상 / 해당 반 학생 개별 출제 (3 케이스 모두 포함)
  // 평면 필드 (targetAll/targetGroups/targetUids) 우선, 옛 데이터는 targets[] 폴백
  const groupStudentUids = new Set(
    (_prog.students || []).filter(s => s.group === group).map(s => s.uid)
  );
  const matched = dayTests.filter(t => {
    // 새 평면 필드 (2026-05-14 마이그레이션 후 모든 시험 보유)
    if (t.targetAll === true) return true;
    if (Array.isArray(t.targetGroups) && t.targetGroups.includes(group)) return true;
    if (Array.isArray(t.targetUids) && t.targetUids.some(uid => groupStudentUids.has(uid))) return true;
    // 옛 targets[] 폴백 (안전망)
    const ts = Array.isArray(t.targets) ? t.targets : [];
    if (ts.length === 0) return false;
    if (ts.some(x => x.type === 'all')) return true;
    if (ts.some(x => x.type === 'class' && (x.groupName === group || x.name === group))) return true;
    if (ts.some(x => x.type === 'student' && groupStudentUids.has(x.id))) return true;
    return false;
  });

  if (summary) {
    summary.textContent = `${date} · ${group} · ${matched.length}건 출제`;
  }

  if (matched.length === 0) {
    results.innerHTML = `<div style="text-align:center;padding:30px 20px;color:var(--gray);font-size:13px;">해당 일자·반에 출제된 시험이 없습니다</div>`;
    return;
  }

  // 시험 카드 N개 — 각 카드 안에 즉시 펼친 학생 카드 그리드 (pd prefix + keepOpen)
  results.innerHTML = matched.map(t => {
    const badges = (typeof _testNameBadges === 'function') ? _testNameBadges(t) : '';
    const dateStr = _fmtTestDateTime ? _fmtTestDateTime(t) : '';
    const qCount = t.questionCount || (Array.isArray(t.questions) ? t.questions.length : 0);
    const targetLabel = _buildTargetName ? _buildTargetName(t.targets) : (t.targetName || '');
    const type = (t.testMode || t.mode || '').toLowerCase();
    const typeLabel = ({ vocab:'단어시험', fill_blank:'빈칸채우기', unscramble:'언스크램블', mcq:'본문이해·문법', recording:'녹음숙제' })[type] || type;
    return `
      <div class="card" style="padding:14px 16px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
          <div style="min-width:0;flex:1;">
            <div style="font-size:14px;font-weight:700;color:var(--text);line-height:1.4;">${esc(t.name || '시험')}${badges}${_tpEditNameBtnHtml(t)}</div>
            <div style="font-size:11px;color:var(--gray);margin-top:3px;">${esc(typeLabel)} · ${esc(targetLabel)} · ${qCount}문항 · ${esc(dateStr)}</div>
          </div>
        </div>
        <!-- 학생 카드 그리드 자동 펼침 (table 외 div) -->
        <div id="pd-progress-${t.id}" data-open="0" style="display:none;background:#f0faff;border-radius:6px;">
          <div id="pd-progress-content-${t.id}" style="padding:10px 12px;font-size:12px;color:var(--gray);">로딩 중...</div>
        </div>
      </div>
    `;
  }).join('');

  // 모두 펼침 — keepOpen 으로 close-others 회피.
  // simpleRec: 녹음숙제 카드를 다른 유형과 동일한 단순 한 줄 카드로 (회차 audio·AI 피드백 X)
  for (const t of matched) {
    try {
      await window.tpToggleTestProgress(t.id, 'pd', { keepOpen: true, simpleRec: true });
    } catch (_) {}
  }
};

function _progBuildTestCardHtml(t, comp, isDone) {
  const name = t.name || '시험';
  const badges = (typeof _testNameBadges === 'function') ? _testNameBadges(t) : '';
  const dateStr = _fmtTestDateTime ? _fmtTestDateTime(t) : '';
  const qCount = t.questionCount || (Array.isArray(t.questions) ? t.questions.length : 0);
  if (isDone) {
    const score = comp?.score ?? comp?.latestScore ?? '-';
    const correct = comp?.correct ?? '';
    const total = qCount;
    const completedAt = comp?.date || comp?.latestAt || '';
    return `
      <div style="background:#e8f5e9;border-left:3px solid #2e7d32;border-radius:4px;padding:8px 10px;margin-bottom:6px;">
        <div style="font-size:12px;font-weight:600;color:#1b5e20;line-height:1.4;">${esc(name)}${badges}</div>
        <div style="font-size:10px;color:#555;margin-top:3px;">${score}점 ${correct ? `(${correct}/${total})` : ''} · ${esc(completedAt)}</div>
      </div>
    `;
  }
  // 진행/신규
  const tried = comp?.latestScore !== undefined && comp?.latestScore !== null;
  if (tried) {
    return `
      <div style="background:#fff3e0;border-left:3px solid #e65100;border-radius:4px;padding:8px 10px;margin-bottom:6px;">
        <div style="font-size:12px;font-weight:600;color:#bf360c;line-height:1.4;">${esc(name)}${badges}</div>
        <div style="font-size:10px;color:#555;margin-top:3px;">미통과 · 최고 ${comp.latestScore}점 · ${esc(dateStr)}</div>
      </div>
    `;
  }
  return `
    <div style="background:#fafafa;border-left:3px solid #999;border-radius:4px;padding:8px 10px;margin-bottom:6px;">
      <div style="font-size:12px;font-weight:600;color:var(--text);line-height:1.4;">${esc(name)}${badges}</div>
      <div style="font-size:10px;color:var(--gray);margin-top:3px;">신규 · ${qCount}문항 · ${esc(dateStr)}</div>
    </div>
  `;
}
