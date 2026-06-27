import { initializeApp, getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, updatePassword, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, collectionGroup, doc, getDoc, getDocs, getCountFromServer, setDoc, addDoc, deleteDoc, updateDoc, query, where, orderBy, limit, startAfter, serverTimestamp, increment, arrayUnion, arrayRemove, deleteField } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { getMessaging, getToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';

const firebaseConfig = {
  apiKey: "AIzaSyAb5d8w9mI5_hpcoBFcWnG5tE1TF_8guw8",
  authDomain: "readaloud-51113.firebaseapp.com",
  projectId: "readaloud-51113",
  storageBucket: "readaloud-51113.firebasestorage.app",
  messagingSenderId: "944153888350",
  appId: "1:944153888350:web:47091c0771d20be8ea56cf",
  measurementId: "G-4S23WNCJNJ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
let messaging = null;
try { messaging = getMessaging(app); } catch(e) { console.log('FCM 미지원 브라우저'); }

// ── 전역 상태 ──────────────────────────────────────────────
let currentUser = null, userProfile = null;
let currentUnitId = null, currentUnitWords = [], lastMode = 'meaning';
let currentQ = 0, questions = [], timerInterval = null, timeLeft = 10;
let spellQ = 0, spellQuestions = [], spellTimer = null, spellTimeLeft = 30;
let correct = 0, wrong = 0;
let allNotices = [];

// ── 배지 캐시 (1분 TTL) ────────────────────────────────────
const _badgeCache = { ts: 0 };
const BADGE_TTL = 60000;

// ── 유틸 ─────────────────────────────────────────────────
function shuffle(arr){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
window.show = id => {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  // 스펠링 화면 벗어날 때 keyboard offset 초기화
  if(id !== 'spelling'){
    const spelling = document.getElementById('spelling');
    if(spelling) spelling.style.bottom = '0';
  } else {
    // 스펠링 진입 시 즉시 조정
    adjustSpellingForKeyboard();
  }
};
window.closeModal = id => document.getElementById(id).classList.add('hidden');
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}

function showConfirm(title, sub=''){
  return new Promise(resolve=>{
    document.getElementById('genericConfirmTitle').textContent=title;
    document.getElementById('genericConfirmSub').textContent=sub;
    const modal=document.getElementById('genericConfirmModal');
    modal.classList.remove('hidden');
    const ok=document.getElementById('genericConfirmOk');
    const cancel=document.getElementById('genericConfirmCancel');
    const done=(val)=>{modal.classList.add('hidden');ok.onclick=null;cancel.onclick=null;resolve(val);};
    ok.onclick=()=>done(true);
    cancel.onclick=()=>done(false);
  });
}
function showAlert(msg){showToast(msg);}
function clearTimers(){if(timerInterval)clearInterval(timerInterval);if(spellTimer)clearInterval(spellTimer);if(_fbTimer)clearInterval(_fbTimer);if(typeof _vqTimer!=='undefined'&&_vqTimer)clearInterval(_vqTimer);if(typeof _uqTimer!=='undefined'&&_uqTimer)clearInterval(_uqTimer);}
function esc(str){return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

// ── 드롭다운 ──────────────────────────────────────────────
window.toggleDropdown = id => {
  ['dd1','dd2'].forEach(d=>{if(d!==id)document.getElementById(d)?.classList.remove('open');});
  document.getElementById(id).classList.toggle('open');
};
document.addEventListener('click', e=>{if(!e.target.closest('.home-header')){document.getElementById('dd1')?.classList.remove('open');document.getElementById('dd2')?.classList.remove('open');}});

// ── 로그인 ─────────────────────────────────────────────────
// 현재는 academyId='default' 고정 (멀티테넌시 전환 Phase 0).
// 추후: 서브도메인 또는 학원코드 입력으로 academyId 결정.
const _LOGIN_ACADEMY_ID = 'default';

// ── SW 에 학원명 전달 (iOS PWA 학원명 자동 노출) ──────────
// SW 가 HTML 응답을 가로채서 <title>/메타 학원명 주입 (sw.js _injectAcademyName)
function _notifySwAcademyName(academyId, name) {
  if (!name || !academyId) return;
  if (!navigator.serviceWorker?.controller) return;
  try {
    navigator.serviceWorker.controller.postMessage({
      type: 'ACADEMY_NAME_UPDATE',
      academyId: String(academyId),
      name: String(name),
    });
  } catch (_) {}
}

// ── iOS 검출 (iPad 데스크톱 모드 포함) ────────────────
function _isIos() {
  const ua = navigator.userAgent || '';
  return /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// ── iOS [홈화면 추가] 후 자동 reload 등록 ─────────────
// 사용자가 [공유 → 홈화면 추가] 누르고 공유 시트 닫힐 때 visibilitychange 발화
// → reload → SW 가 학원명 박힌 HTML 응답 → 다시 추가 시 학원명 노출
function _registerIosInstallReload() {
  if (!_isIos()) return;
  if (window._iosInstallReloadRegistered) return;
  window._iosInstallReloadRegistered = true;

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window._iosInstallReloadRegistered = false;
      setTimeout(() => window.location.reload(), 300);
    }
  };
  // 공유 시트 뜨는 타이밍에 맞춰 listener 등록
  setTimeout(() => {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }, 500);
}

// usernameLookup/{academyId}_{usernameLower} 로 email 조회.
// 누락 시 null 반환 → 호출자가 레거시 users 쿼리로 폴백.
// 학원 컨텍스트 로드 — Custom Claims 우선, users 문서 폴백, 'default' 최종 폴백
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
  console.log('[academy] uid=' + user.uid.slice(0,8) + '… academyId=' + academyId + ' role=' + window.MY_ROLE);

  // 녹음 무결성 폴백 + 학원/LexiAI 기본 브랜딩 동시 로드
  try {
    const [adoc, lexiDoc] = await Promise.all([
      getDoc(doc(db, 'academies', academyId)),
      getDoc(doc(db, 'appConfig', 'branding')).catch(() => null),
    ]);
    const adata = adoc.exists() ? adoc.data() : null;
    const integ = adata?.settings?.recordingIntegrity || {};
    window.MY_ACADEMY_RECORDING_CFG = {
      minVoiceActivity: typeof integ.minVoiceActivity === 'number' ? integ.minVoiceActivity : 0.4,
      minDurationSec:   typeof integ.minDurationSec   === 'number' ? integ.minDurationSec   : 60,
      maxDurationSec:   typeof integ.maxDurationSec   === 'number' ? integ.maxDurationSec   : 600,
    };
    window.MY_ACADEMY_NAME = (adata && adata.name) || '';
    window.LEXIAI_BRANDING = (lexiDoc && lexiDoc.exists?.()) ? lexiDoc.data() : null;
    // 화이트라벨 브랜딩 적용 — Free 플랜은 LexiAI 기본 적용
    _applyAcademyBranding(adata);
  } catch (_) {
    window.MY_ACADEMY_RECORDING_CFG = { minVoiceActivity: 0.4, minDurationSec: 60, maxDurationSec: 600 };
    window.MY_ACADEMY_NAME = '';
  }
}

// 화이트라벨 적용 — academy.planId 별 fallback 체인:
//   Free 학원 → super_admin LexiAI 기본 (appConfig/branding) 만 사용
//   Lite+ 학원 → 학원 자체 branding 우선, 비어있으면 LexiAI 기본
//   둘 다 없으면 코랄 + /icons/icon-192.png (코드 default)
function _applyAcademyBranding(academy) {
  if (!academy) return;
  const planId = academy.planId || 'free';
  const branding = academy.branding || {};
  const lexi = window.LEXIAI_BRANDING || {};
  const presets = window.BRANDING_PRESETS || {};

  // 색상 프리셋
  const isFree = (planId === 'free');
  const presetId = isFree
    ? (lexi.defaultPresetId || 'coral')
    : (branding.presetId || lexi.defaultPresetId || 'coral');
  const preset = presets[presetId] || presets.coral;
  if (!preset) return;
  if (typeof window.applyPresetToCss === 'function') window.applyPresetToCss(preset);

  // 로고 (Free 는 학원 자체 무시, LexiAI 기본 사용)
  const logoUrl = isFree
    ? (lexi.defaultLogo192Url || '')
    : (branding.logo192Url || lexi.defaultLogo192Url || '');
  if (logoUrl) {
    document.querySelectorAll('.app-icon, .loading-icon, .header-icon').forEach(img => {
      if (img.tagName === 'IMG') {
        img.src = logoUrl;
        img.onerror = () => { img.src = '/icons/icon-192.png'; img.onerror = null; };
      }
    });
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleIcon) appleIcon.href = logoUrl;
  }

  // 학원명 — academy.name 우선. 비어있으면 LexiAI defaultAppName 폴백 ('LexiAI' 최종)
  const acadName = academy.name || lexi.defaultAppName || 'LexiAI';
  document.querySelectorAll('.logo-title, .loading-title, .home-logo-text').forEach(el => { el.textContent = acadName; });
  document.title = acadName;
  // iOS '홈화면 추가' 시 기본 이름 (apple-mobile-web-app-title 메타가 우선)
  const _at = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (_at) _at.setAttribute('content', acadName);
  const _an = document.querySelector('meta[name="application-name"]');
  if (_an) _an.setAttribute('content', acadName);

  // 캐치프레이즈 (Free 는 LexiAI 기본 / Lite+ 는 학원 자체 우선 → LexiAI fallback)
  const cp = isFree
    ? (lexi.defaultCatchphrase || '')
    : (branding.catchphrase || lexi.defaultCatchphrase || '');
  const sub = document.querySelector('.logo-sub');
  if (sub && cp) sub.textContent = cp;

  // PWA manifest 갱신
  if (typeof window.updateManifest === 'function') window.updateManifest(window.MY_ACADEMY_ID);
  window.CURRENT_BRANDING = { academyName: acadName, preset, logoUrl, catchphrase: cp, planId };

  // SW 에 학원명 전달 — iOS [홈화면 추가] 시 SW 가 HTML 가로채서 학원명 박은 응답
  _notifySwAcademyName(window.MY_ACADEMY_ID, acadName);

  // FOUC 방지 캐시 — 학원 자체 브랜딩으로 LexiAI 기본 캐시 덮어쓰기
  // (학생앱·학원장앱 양쪽에서 다음 진입 시 자기 학원 로고/이름·색이 즉시 표시되도록)
  try {
    if (academy.name) {  // 로그인된 사용자가 학원 정보 받은 시점에만 set
      if (logoUrl) localStorage.setItem('lexiLogo192', logoUrl);
      if (acadName) localStorage.setItem('lexiAppName', acadName);
      if (presetId) localStorage.setItem('lexiBrandPreset', presetId);
      // 캐치프레이즈도 캐시 — 비로그인 학생앱 화면도 학원 컨텍스트 일관 표시
      if (cp) localStorage.setItem('lexiCatchphrase', cp);
      else localStorage.removeItem('lexiCatchphrase');
      // PWA manifest 학원별 적용 — head 인라인 script 가 다음 진입부터 학원 manifest 로 즉시 전환
      if (window.MY_ACADEMY_ID) localStorage.setItem('lexiAcademyId', window.MY_ACADEMY_ID);
    }
  } catch (_) {}

  // [PWA 학원명 적용 reload] 제거 — doLogin navigation 도중 trigger 되어 무한 로딩 유발.
  // PWA 이름 문제는 별도 방식으로 해결 (input 수정 안내 등). 자동 reload 안전 확보 우선.
}

async function _lookupUserByUsername(usernameRaw) {
  try {
    // usernameLookup 은 글로벌 유니크 (학원 prefix 없음).
    // academyId 는 Custom Claims / users 문서에서 별도 결정.
    const key = usernameRaw.toLowerCase();
    const snap = await getDoc(doc(db, 'usernameLookup', key));
    if (!snap.exists()) return null;
    const d = snap.data();
    if (!d || !d.uid || !d.email) return null;
    return { uid: d.uid, email: d.email, role: d.role };
  } catch (e) {
    console.warn('[usernameLookup] 조회 실패:', e.message);
    return null;
  }
}

window.doLogin = async () => {
  const uid = document.getElementById('usernameInput').value.trim();
  const pw  = document.getElementById('passwordInput').value.trim();
  const err = document.getElementById('loginError');
  err.textContent = '';
  if(!uid||!pw){err.textContent='아이디와 비밀번호를 입력하세요.';return;}
  // 아이디 저장
  if(document.getElementById('saveIdCheck').checked) localStorage.setItem('savedId',uid);
  else localStorage.removeItem('savedId');
  try {
    // 1단계: 입력값으로 email 결정
    //   - '@' 포함 → 이메일 직접 (학원장/멀티학원 로그인 경로)
    //   - 그 외 → usernameLookup/default_<username> 조회 (학생/default학원 경로)
    let profileUid = null;
    let profileEmail = null;
    if (uid.includes('@')) {
      profileEmail = uid.toLowerCase();
    } else {
      const lookup = await _lookupUserByUsername(uid);
      if (!lookup) { err.textContent = '존재하지 않는 아이디입니다.'; return; }
      profileUid = lookup.uid;
      profileEmail = lookup.email;
    }

    // 2단계: Firebase Auth 로그인
    await signInWithEmailAndPassword(auth, profileEmail, pw);
    if (!profileUid) profileUid = auth.currentUser.uid;

    // 3단계: users/{uid} 에서 프로필 전체 로드 (로그인 완료된 상태라 읽기 권한 OK)
    const profileSnap = await getDoc(doc(db, 'users', profileUid));
    if (!profileSnap.exists()) {
      err.textContent = '프로필을 찾을 수 없습니다. 관리자에게 문의하세요.';
      await signOut(auth);
      return;
    }
    const profile = profileSnap.data();

    userProfile = {...profile, uid: profileUid};
    currentUser = auth.currentUser;
    await _loadMyAcademyContext(auth.currentUser, profile);
    localStorage.setItem('lastLoginAt', Date.now().toString());
    if(profile.role==='super_admin'){
      // 슈퍼 관리자 전용 앱으로 직행
      window.location.href = '/super/';
    } else if(profile.role==='admin'){
      // PC 관리자 앱으로 이동
      localStorage.setItem('adminProfile', JSON.stringify({...profile, uid: profileUid}));
      window.location.href = '/admin/';
    } else {
      document.getElementById('greetName').textContent=profile.name+' 님';
      await loadHomeData();
      show('home');
      // 미확인 알림 팝업 + 뱃지 (약간 딜레이)
      setTimeout(async()=>{
        await updateNotifBadge();
        checkUnreadNotifs();
      }, 1500);
      // FCM 토큰 등록 (학생만)
      setTimeout(registerFCMToken, 2000);
      setupForegroundMessage();
    }
  } catch(e){
    console.error(e);
    err.textContent = _friendlyAuthError(e);
  }
};

// Firebase Auth 에러 → 사용자 친화 한국어 메시지
function _friendlyAuthError(e) {
  const code = e?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return '비밀번호가 틀렸습니다.';
    case 'auth/user-not-found':
      return '존재하지 않는 아이디입니다.';
    case 'auth/too-many-requests':
      return '비밀번호를 여러 번 잘못 입력해서 일시 차단됐어요. 30분 후 다시 시도하거나, Wi-Fi ↔ LTE 를 바꿔서 시도해보세요.';
    case 'auth/network-request-failed':
      return '네트워크 연결을 확인해주세요.';
    case 'auth/user-disabled':
      return '계정이 비활성화됐어요. 학원에 문의해주세요.';
    case 'auth/invalid-email':
      return '이메일 형식이 올바르지 않습니다.';
    case 'auth/internal-error':
      return '일시적인 오류예요. 잠시 후 다시 시도해주세요.';
    default:
      return '로그인 중 문제가 생겼어요. 잠시 후 다시 시도해주세요. (' + (code || e?.message || 'unknown') + ')';
  }
}

// ── 로그아웃 ──────────────────────────────────────────────
window.confirmLogout = ()=>{document.getElementById('dd1')?.classList.remove('open');document.getElementById('dd2')?.classList.remove('open');document.getElementById('logoutModal').classList.remove('hidden');};
window.doLogout = async()=>{
  closeModal('logoutModal');
  // FCM 토큰은 의도적으로 유지 — 로그아웃해도 학원 알림 (숙제 독촉·긴급 정보) 계속 수신.
  // 다른 user 가 같은 폰에 로그인하면 그 시점에 claim 으로 자동 이전됨.
  _myCurrentFcmToken = null;
  await signOut(auth);
  currentUser=null; userProfile=null; clearTimers();
  localStorage.removeItem('lastLoginAt');
  show('login');
};
window.goHome = ()=>{show('home');clearTimers();_releaseWakeLock();updateAllBadges();};

// ── 녹음 중 화면 꺼짐 방지 (Screen Wake Lock API) ────────
let _wakeLock = null;
let _wakeLockWanted = false;
async function _acquireWakeLock(){
  _wakeLockWanted = true;
  if(!('wakeLock' in navigator)) return;
  try{
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', ()=>{ _wakeLock = null; });
    console.log('[wakeLock] acquired');
  }catch(e){ console.warn('[wakeLock] failed', e.message); }
}
async function _releaseWakeLock(){
  _wakeLockWanted = false;
  if(!_wakeLock) return;
  try{ await _wakeLock.release(); _wakeLock = null; }catch(e){}
}
// 탭이 숨겨졌다 돌아오면 Wake Lock 이 자동 해제되므로 재획득
document.addEventListener('visibilitychange', async ()=>{
  if(_wakeLockWanted && document.visibilityState === 'visible' && !_wakeLock){
    try{
      _wakeLock = await navigator.wakeLock.request('screen');
      _wakeLock.addEventListener('release', ()=>{ _wakeLock = null; });
    }catch(e){}
  }
});

// ── 홈 데이터 ─────────────────────────────────────────────
async function loadHomeData(){
  await Promise.all([loadNoticePreview(), loadHwFiles()]);
  await updateAllBadges(true);
}


async function updateAllBadges(force=false){
  const now = Date.now();
  if(!force && now - _badgeCache.ts < BADGE_TTL) return;
  _badgeCache.ts = now;
  // window.updateTestBadge 는 후반부에서 updateVocabBadge 로 교체됨 → window 경유해서 최신 바인딩 호출
  // (로컬 updateTestBadge 는 레거시 tests 컬렉션 조회라서 genTests 기반 시험 미반영)
  await Promise.all([
    (window.updateTestBadge || updateTestBadge)(),
    (window.updateUnscBadge || updateUnscBadge)(),
    updateMcqBadge(),
    updateFbBadge(),
    updateRecBadge(),
  ]);
}
// 5종 통합 badge 업데이트 — 10일 + collectionGroup batch + Promise dedup (2026-05-13, 비용 최적화)
// 학원 전체 fetch 가 아닌 testMode in [...] + createdAt >= 10일 + limit
// userCompleted N+1 → collectionGroup query 1회
const _BADGE_MAP = {
  vocab: 'testBadge',
  unscramble: 'unscrambleBadge',
  mcq: 'mcqBadge',
  fill_blank: 'blankBadge',
  recording: 'recBadge',
};
let _badgeUpdateInflight = null;

async function _updateAllBadgesAtOnce() {
  if (_badgeUpdateInflight) return _badgeUpdateInflight;
  _badgeUpdateInflight = (async () => {
    if (!currentUser || !userProfile) return;
    try {
      const myGroup = userProfile.group || '';
      const myUid = currentUser.uid;
      const tenDaysAgo = new Date(Date.now() - 10*864e5);

      // server-side filter — 그 학생 대상만 (3 분리 쿼리 병렬, 2026-05-14)
      const tBase = [
        where('academyId', '==', window.MY_ACADEMY_ID),
        where('testMode', 'in', Object.keys(_BADGE_MAP)),
        where('createdAt', '>=', tenDaysAgo),
        orderBy('createdAt', 'desc'),
        limit(200),
      ];
      const tQueries = [
        query(collection(db,'genTests'), ...tBase, where('targetAll','==', true)),
        query(collection(db,'genTests'), ...tBase, where('targetUids','array-contains', myUid)),
      ];
      if (myGroup) {
        tQueries.push(query(collection(db,'genTests'), ...tBase, where('targetGroups','array-contains', myGroup)));
      }
      const tSnaps = await Promise.all(tQueries.map(q => getDocs(q)));
      const tSeen = new Set();
      const myTests = [];
      tSnaps.forEach(snap => {
        snap.docs.forEach(d => {
          if (!tSeen.has(d.id)) {
            tSeen.add(d.id);
            const data = d.data();
            if (data.active !== false && !(Array.isArray(data.excludedUids) && data.excludedUids.includes(myUid))) {
              myTests.push({id: d.id, ...data});
            }
          }
        });
      });

      // userCompleted batch — collectionGroup 1회 (N+1 → 1)
      const completedSet = new Set();
      try {
        const compSnap = await getDocs(query(
          collectionGroup(db, 'userCompleted'),
          where('uid', '==', myUid)
        ));
        compSnap.docs.forEach(d => {
          if (d.data().score !== undefined) {
            const testId = d.ref.parent.parent.id;
            completedSet.add(testId);
          }
        });
      } catch(e) { console.warn('[badge] userCompleted batch:', e.message); }

      // 5종 badge 분배
      Object.keys(_BADGE_MAP).forEach(mode => {
        const badge = document.getElementById(_BADGE_MAP[mode]);
        if (!badge) return;
        const tests = myTests.filter(t => t.testMode === mode);
        const unfinished = tests.filter(t => !completedSet.has(t.id)).length;
        if (unfinished > 0) {
          badge.textContent = unfinished > 99 ? '99+' : unfinished;
          badge.style.display = 'flex';
        } else {
          badge.style.display = 'none';
        }
      });
    } catch(e) {
      console.warn('[badge] _updateAllBadgesAtOnce:', e.message);
      // 실패 시 모든 badge 숨김 (잘못된 큰 수 표시 방지)
      Object.values(_BADGE_MAP).forEach(id => {
        const b = document.getElementById(id);
        if (b) b.style.display = 'none';
      });
    }
  })();
  try { await _badgeUpdateInflight; } finally { _badgeUpdateInflight = null; }
}

// 5개 단일 badge 함수 → 통합 호출로 redirect (어디서 호출하든 1회 통합 fetch)
const updateTestBadge   = () => _updateAllBadgesAtOnce();
const updateMcqBadge    = () => _updateAllBadgesAtOnce();
const updateFbBadge     = () => _updateAllBadgesAtOnce();

// 공지 1건이 이 학생에게 보이는지 — 신/구 schema 둘 다 처리
function _noticeMatchesMe(n, group, uid) {
  // 신 schema (targets[])
  if (Array.isArray(n.targets) && n.targets.length) {
    return n.targets.some(t =>
      t.type === 'all' ||
      (t.type === 'class' && t.id === group) ||
      (t.type === 'student' && t.id === uid)
    );
  }
  // 옛 schema (target 단일)
  return n.target === 'all' || n.target === group;
}

function _noticeLabel(n) {
  if (n.targetSummary) return n.targetSummary;
  if (Array.isArray(n.targets) && n.targets.length) {
    if (n.targets.some(t => t.type === 'all')) return '전체';
    const cs = n.targets.filter(t => t.type === 'class').map(t => t.groupName || t.id);
    const ss = n.targets.filter(t => t.type === 'student');
    const parts = [];
    if (cs.length) parts.push(cs.join('·'));
    if (ss.length) parts.push(`${ss.length}명`);
    return parts.join(' + ');
  }
  return n.target === 'all' ? '전체' : (n.target || '-');
}

function _noticeIsAll(n) {
  if (Array.isArray(n.targets) && n.targets.length) return n.targets.some(t => t.type === 'all');
  return n.target === 'all';
}

async function loadNoticePreview(){
  const group = userProfile?.group||'';
  const uid = currentUser?.uid||'';
  const snap = await getDocs(query(collection(db,'notices'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','desc')));
  allNotices = snap.docs.map(d=>({id:d.id,...d.data()})).filter(n => _noticeMatchesMe(n, group, uid));
  const el = document.getElementById('noticePreview');
  if(!allNotices.length){el.innerHTML='<div class="empty-msg">공지사항이 없습니다</div>';return;}
  el.innerHTML = allNotices.slice(0,3).map(n=>{
    const hasAtt = Array.isArray(n.attachments) && n.attachments.length > 0;
    const expired = _noticeAttExpired(n);
    const clipIcon = hasAtt ? (expired ? ' <span style="opacity:0.4;">🔒</span>' : ' <span title="첨부 파일">📎</span>') : '';
    return `
    <div class="notice-item" onclick="viewNotice('${n.id}')">
      <div class="notice-dot"></div>
      <div class="notice-item-text">
        <div class="notice-item-title">${esc(n.title)}${clipIcon}</div>
        <div class="notice-item-meta"><span class="notice-tag${_noticeIsAll(n)?' all':''}">${esc(_noticeLabel(n))}</span><span>${esc(n.date||'')}</span></div>
      </div>
    </div>`;
  }).join('');
}

// 자료실 파일이 이 학생에게 보이는지 — 신/구 schema 둘 다 처리
function _hwFileMatchesMe(f, group, uid) {
  if (Array.isArray(f.targets) && f.targets.length) {
    return f.targets.some(t =>
      t.type === 'all' ||
      (t.type === 'class' && t.id === group) ||
      (t.type === 'student' && t.id === uid)
    );
  }
  // 옛 schema
  if (f.group === '전체') return true;
  if (f.group === group) return true;
  if (f.targetUid && f.targetUid === uid) return true;
  return false;
}

function _hwFileLabel(f) {
  if (f.targetSummary) return f.targetSummary;
  if (Array.isArray(f.targets) && f.targets.length) {
    if (f.targets.some(t => t.type === 'all')) return '전체';
    const cs = f.targets.filter(t => t.type === 'class').map(t => t.groupName || t.id);
    const ss = f.targets.filter(t => t.type === 'student');
    const parts = [];
    if (cs.length) parts.push(cs.join('·'));
    if (ss.length) parts.push(`${ss.length}명`);
    return parts.join(' + ');
  }
  return f.group === '전체' ? '전체' : (f.group || '-');
}

function _hwFileIsAll(f) {
  if (Array.isArray(f.targets) && f.targets.length) return f.targets.some(t => t.type === 'all');
  return f.group === '전체';
}

async function loadHwFiles(){
  const group = userProfile?.group||'';
  const uid = currentUser?.uid||'';
  const snap = await getDocs(query(collection(db,'hwFiles'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','desc')));
  const files = snap.docs.map(d=>({id:d.id,...d.data()})).filter(f => _hwFileMatchesMe(f, group, uid));

  // 파일 카드 전체를 숨기거나 표시
  const card = document.getElementById('hwFileCard');
  const el   = document.getElementById('hwFileList');
  if(!files.length){
    if(card) card.style.display='none';
    return;
  }
  if(card) card.style.display='';

  const icons={pdf:'📄',docx:'📝',img:'🖼',doc:'📝',jpg:'🖼',jpeg:'🖼',png:'🖼',hwp:'📋'};
  const iconCls={pdf:'pdf',docx:'docx',doc:'docx',img:'img',jpg:'img',jpeg:'img',png:'img',hwp:'pdf'};
  if(!el) return;
  el.innerHTML = files.map(f=>`
    <div class="hw-file-item">
      <div class="file-icon ${iconCls[f.type]||'pdf'}">${icons[f.type]||'📄'}</div>
      <div class="file-info">
        <div class="file-name">${esc(f.name)}</div>
        <div class="file-meta"><span class="notice-tag${_hwFileIsAll(f)?' all':''}">${esc(_hwFileLabel(f))}</span><span>${esc(f.date||'')}</span></div>
      </div>
      <button class="download-btn" onclick="downloadHwFile('${esc(f.url||'')}','${esc(f.name||'')}',event)">다운로드</button>
    </div>`).join('');
}

window.downloadHwFile = (url,name,e)=>{
  e.stopPropagation();
  if(!url){showToast('파일 URL이 없습니다.');return;}
  const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.download=name||'download';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
};

// 공지 첨부 만료 판정·표시 헬퍼
function _noticeAttExpired(n) {
  if (!n?.expiresAt?.toDate) return false;
  return Date.now() > n.expiresAt.toDate().getTime();
}
function _noticeAttExpYmd(n) {
  if (!n?.expiresAt?.toDate) return '';
  return new Date(n.expiresAt.toDate().getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
function _noticeAttachmentsHtml(n) {
  const att = Array.isArray(n?.attachments) ? n.attachments : [];
  if (!att.length) return '';
  const expYmd = _noticeAttExpYmd(n);
  if (_noticeAttExpired(n)) {
    return `<div style="margin-top:14px;padding:10px 14px;background:#f8f9fa;border:1px solid var(--border);border-radius:8px;font-size:13px;color:var(--gray);">
      🔒 첨부 파일 보관 만료 (${esc(expYmd)} 까지였음 · ${att.length}개)
    </div>`;
  }
  return `<div style="margin-top:14px;padding:10px 14px;background:#fff7f4;border:1px solid #f3d9cc;border-radius:8px;">
    <div style="font-size:12px;color:var(--gray);margin-bottom:8px;">📎 첨부 파일 (${att.length}개) · <span style="color:#b45309;">${esc(expYmd)}</span> 까지 다운로드 가능</div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${att.map(a => `<button onclick="downloadHwFile('${esc(a.url||'')}','${esc((a.name||'파일')).replace(/'/g,'&#39;')}',event)" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:white;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:13px;text-align:left;">
        <span style="font-size:18px;">📄</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.name||'파일')}</span>
        <span style="color:var(--gray);font-size:11px;flex-shrink:0;">${a.sizeKB||0} KB</span>
        <span style="color:var(--c-brand,#E8714A);font-weight:600;font-size:12px;flex-shrink:0;">↓</span>
      </button>`).join('')}
    </div>
  </div>`;
}

// ── 공지 보기 ─────────────────────────────────────────────
window.viewNotice = noticeId => {
  const n = allNotices.find(n=>n.id===noticeId); if(!n) return;
  document.getElementById('noticeFullList').innerHTML=`
    <div class="notice-full-item">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span class="notice-tag${_noticeIsAll(n)?' all':''}">${esc(_noticeLabel(n))}</span>
        <span style="font-size:12px;color:var(--gray);">${n.date||''}</span>
      </div>
      <div class="notice-full-title" style="font-size:17px;margin-bottom:14px;">${esc(n.title)}</div>
      <div class="notice-content">${esc(n.content)}</div>
      ${_noticeAttachmentsHtml(n)}
    </div>`;
  document.getElementById('noticeScreenTitle').textContent='공지사항';
  document.getElementById('noticeBackBtn').onclick = ()=>show('home');
  show('noticeScreen');
};

window.goNoticeList = async()=>{
  const group=userProfile?.group||'';
  const uid = currentUser?.uid||'';
  const snap=await getDocs(query(collection(db,'notices'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','desc')));
  allNotices=snap.docs.map(d=>({id:d.id,...d.data()})).filter(n => _noticeMatchesMe(n, group, uid));
  document.getElementById('noticeFullList').innerHTML=allNotices.map(n=>{
    const hasAtt = Array.isArray(n.attachments) && n.attachments.length > 0;
    const expired = _noticeAttExpired(n);
    const clipIcon = hasAtt ? (expired ? ' <span style="opacity:0.4;">🔒</span>' : ' <span title="첨부 파일">📎</span>') : '';
    return `
    <div class="notice-full-item" onclick="viewNotice('${n.id}')" style="cursor:pointer;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <div class="notice-full-title" style="margin-bottom:0;">${esc(n.title)}${clipIcon}</div>
        <span style="color:var(--teal);font-size:18px;">›</span>
      </div>
      <div class="notice-full-meta"><span class="notice-tag${_noticeIsAll(n)?' all':''}">${esc(_noticeLabel(n))}</span><span>${esc(n.date||'')}</span></div>
    </div>`;
  }).join('')||'<div class="empty-msg">공지사항이 없습니다</div>';
  document.getElementById('noticeScreenTitle').textContent='공지사항';
  document.getElementById('noticeBackBtn').onclick=()=>show('home');
  show('noticeScreen');
};

// ── 단원/테스트 ───────────────────────────────────────────
let currentTestId = null, currentTestName = '';

// ── 내 시험 필터 공통 함수 ────────────────────────────────
// ─── 공용: 시험 완료 기록 쓰기 (모든 유형 공통) ───
// 항상 latestScore/latestPassed 갱신, 통과 + 최고점 초과 시에만 score/passed/상세 갱신
async function _writeUserCompleted(testId, { score, passed, passScore, correct, wrong, total, questions, answers, extra }) {
  const compRef = doc(db,'genTests', testId,'userCompleted', currentUser.uid);
  const existingDoc = await getDoc(compRef);
  const existing = existingDoc.exists() ? existingDoc.data() : null;
  const prevBest = existing?.score ?? 0;
  const today = _ymdKST();

  const data = {
    uid: currentUser.uid,
    userName: userProfile?.name || '',
    latestScore: score,
    latestPassed: passed,
    latestDate: today,
    latestAt: serverTimestamp(),
  };

  // Firestore 는 객체 어디든 undefined 가 있으면 setDoc 전체를 거부.
  // 말하기 시험 answers 의 spkAttempts 등이 특정 경로에서 undefined → JSON 왕복으로 깊은 곳까지 제거.
  // (questions/answers 는 genTests·학생입력 primitive 라 Timestamp/sentinel 없음 — JSON 왕복 안전)
  const _clean = o => JSON.parse(JSON.stringify(o ?? null));

  const isNewBest = passed && score > prevBest;
  if (isNewBest) {
    Object.assign(data, {
      score, passed: true, passScore,
      correct, wrong, total,
      questions: _clean(questions || []),
      answers: _clean(answers || []),
      date: today,
      completedAt: serverTimestamp(),
      ...(extra ? _clean(extra) : {}),
    });
  }

  // top-level undefined 방어 (serverTimestamp sentinel 은 undefined 아니라 보존됨)
  Object.keys(data).forEach(k => { if (data[k] === undefined) delete data[k]; });

  try {
    await setDoc(compRef, data, { merge: true });
  } catch (e) {
    console.error('[userCompleted] setDoc 실패 — 완료 기록 저장 안 됨', e);
    showToast('완료 기록 저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    throw e;  // 호출자 흐름 유지 (조용히 삼키지 않음)
  }

  if (isNewBest && existing?.score !== undefined) {
    showToast(`🎉 새 기록! ${existing.score}점 → ${score}점`);
  } else if (passed && existing?.score !== undefined && !isNewBest) {
    showToast(`기존 최고점 ${existing.score}점 유지`);
  }

  // 응시 후 캐시 동기 — 학생이 결과→시험목록 돌아갈 때 통과/미통과 즉시 반영 (2026-06-18)
  // myTests 캐시는 그대로 (시험 list 자체는 변동 없음), userCompMap 만 그 testId 갱신
  try {
    const newCompEntry = passed
      ? { score, latestScore: score, passed: true, latestPassed: true }
      : { latestScore: score, latestPassed: false };
    _testListState.forEach(state => {
      if (state.userCompMap) state.userCompMap.set(testId, { ...(state.userCompMap.get(testId) || {}), ...newCompEntry });
    });
  } catch (e) { console.warn('[userCompleted] 캐시 동기 실패 — 다음 진입 시 fresh fetch:', e); }

  return { isNewBest, prevBest };
}

// 공용 화면 템플릿 캐싱 (결과 화면이 innerHTML 덮어쓸 수 있는 퀴즈 화면용)
const _screenTemplates = {};

function _screenPrepare(screenId, probeSelector, onAfterRestore){
  const screen = document.getElementById(screenId);
  if (!screen) return;
  if (_screenTemplates[screenId] && !screen.querySelector(probeSelector)) {
    // 결과 화면이 덮어쓴 상태 → 원본 복원
    screen.innerHTML = _screenTemplates[screenId];
    if (typeof onAfterRestore === 'function') onAfterRestore();
  } else if (!_screenTemplates[screenId]) {
    _screenTemplates[screenId] = screen.innerHTML;
  }
}

function _screenSnapshotOnce(screenId){
  const screen = document.getElementById(screenId);
  if (screen && !_screenTemplates[screenId]) {
    _screenTemplates[screenId] = screen.innerHTML;
  }
}

// ─── 공용 시험 UI 설정 (4개 텍스트 유형: vocab / fill_blank / mcq / unscramble) ───
const TEST_TYPE_UI = {
  vocab: {
    defaultName:'단어 시험', subtitleEmoji:'📝', subtitleDefault:'단어 시험',
    pendingBg:'#e0f2fe', pendingColor:'#0369a1',
    completedArrow:'↻', showRetakeBadge:true,
    accent:'#0369a1', retakeBtnBg:'#0EA5E9',
    screenId:'vocabQuiz', listFn:'goVocab', retakeFn:'vqRetakeCurrent',
    pendingElId:'vqListPending', completedElId:'vqListCompleted',
    startFn:'startVocab', viewPrevFn:'vqViewPreviousResult',
  },
  fill_blank: {
    defaultName:'빈칸 시험', subtitleEmoji:'✏️', subtitleDefault:'빈칸 채우기',
    pendingBg:'#fefce8', pendingColor:'#CA8A04',
    completedArrow:'✓', showRetakeBadge:false,
    accent:'#CA8A04', retakeBtnBg:'#EAB308',
    screenId:'fillBlank', listFn:'goFillBlank', retakeFn:'fbRetakeCurrent',
    pendingElId:'fbListPending', completedElId:'fbListCompleted',
    startFn:'startFillBlank', viewPrevFn:'fbViewPreviousResult',
  },
  mcq: {
    defaultName:'독해 시험', subtitleEmoji:'📖', subtitleDefault:'본문 독해',
    pendingBg:'#fff4e6', pendingColor:'#F59E0B',
    completedArrow:'✓', showRetakeBadge:false,
    accent:'#F59E0B', retakeBtnBg:'#F59E0B',
    screenId:'readingMcq', listFn:'goReadingMcq', retakeFn:'mcqRetakeCurrent',
    pendingElId:'mcqListPending', completedElId:'mcqListCompleted',
    startFn:'startReadingMcq', viewPrevFn:'mcqViewPreviousResult',
  },
  unscramble: {
    defaultName:'언스크램블 시험', subtitleEmoji:'🔀', subtitleDefault:'언스크램블',
    pendingBg:'#f3e8ff', pendingColor:'#7c3aed',
    completedArrow:'↻', showRetakeBadge:true,
    accent:'#7c3aed', retakeBtnBg:'#A855F7',
    screenId:'unscrambleQuiz', listFn:'goUnscramble', retakeFn:'uqRetakeCurrent',
    pendingElId:'unscListPending', completedElId:'unscListCompleted',
    startFn:'startUnscramble2', viewPrevFn:'uqViewPreviousResult',
  },
};

// 공용 시험 목록 로더 (vocab / fill_blank / mcq / unscramble)
// 정책 (2026-05-13 비용 최적화):
//   - 10일 default, 더보기 +10일씩, 30일 상한
//   - 캐시 없음 (학원장 변경 즉시 반영, 학생앱 실시간성 우선)
//   - userCompleted N+1 → collectionGroup batch 1회 (진입당)
const _testListState = new Map();  // type → { daysLoaded, userCompMap, myTests?, fetchedAt?, cacheKey? }
// 학원 lastTestUpdate 헤드체크 캐시 — 같은 진입 흐름에서 여러 type 페이지 들어가도 1 read 만
let _lastUpdateCheck = { value: -1, ts: 0 };
const _LAST_UPDATE_TTL = 30000;  // 30초 동안 한 번만 fetch — 학생이 짧은 시간에 여러 페이지 이동 시 효율
async function _getAcademyLastTestUpdate() {
  const now = Date.now();
  if (_lastUpdateCheck.value >= 0 && (now - _lastUpdateCheck.ts) < _LAST_UPDATE_TTL) {
    return _lastUpdateCheck.value;
  }
  try {
    const snap = await getDoc(doc(db, 'academies', window.MY_ACADEMY_ID));
    const v = snap.data()?.lastTestUpdate?.toMillis?.() || 0;
    _lastUpdateCheck = { value: v, ts: now };
    return v;
  } catch (e) {
    console.warn('[testList] lastTestUpdate 조회 실패 — 캐시 무효화:', e);
    _lastUpdateCheck = { value: -1, ts: 0 };
    return Date.now();  // 안전: 조회 실패 시 캐시 무효
  }
}
// 응시 후 강제 헤드체크 (다음 진입 시 재fetch 유도)
function _invalidateTestListCache(type) {
  _lastUpdateCheck = { value: -1, ts: 0 };
  if (type && _testListState.has(type)) {
    const s = _testListState.get(type);
    s.myTests = null;
    s.fetchedAt = 0;
  }
}
window._invalidateTestListCache = _invalidateTestListCache;
window._invalidateTestListCache = () => { _testListState.clear(); };  // 호환 NOP

async function _loadTestListByType(type) {
  const ui = TEST_TYPE_UI[type];
  const elP = document.getElementById(ui.pendingElId);
  if (elP) elP.innerHTML = '<div class="empty-msg" style="padding:20px;">로딩 중...</div>';
  // 새 진입 — state 리셋 (userCompMap 도 새로 fetch)
  _testListState.set(type, { daysLoaded: 10, userCompMap: null });
  try {
    await _loadTestListPage(type);
  } catch(e) {
    console.error(e);
    if (elP) elP.innerHTML = '<div class="empty-msg" style="padding:20px;">불러오기 실패</div>';
  }
}

async function _loadTestListPage(type) {
  const ui = TEST_TYPE_UI[type];
  const elP = document.getElementById(ui.pendingElId);
  const elC = document.getElementById(ui.completedElId);
  const state = _testListState.get(type);
  if (!state) return;

  const myGroup = userProfile?.group || '';
  const myUid = currentUser?.uid || '';
  const sinceDate = new Date(Date.now() - state.daysLoaded * 864e5);

  // 헤드체크 — academies/{id}.lastTestUpdate 1 read 후 캐시 valid 여부 판단 (2026-06-18)
  // 캐시 hit: fetchedAt > lastUpdate + 같은 daysLoaded (학생이 [더 보기] 안 눌렀음)
  // 캐시 miss: lastUpdate 가 더 늦거나 daysLoaded 바뀌었거나 캐시 없음
  let myTests;
  const lastUpdate = await _getAcademyLastTestUpdate();
  const cacheValid = Array.isArray(state.myTests)
    && state.cacheKey === state.daysLoaded
    && state.fetchedAt > lastUpdate;
  if (cacheValid) {
    myTests = state.myTests;
  } else {
    // server-side filter — 그 학생 대상만 (3 분리 쿼리 병렬, 2026-05-14)
    const baseConstraints = [
      where('academyId','==', window.MY_ACADEMY_ID),
      where('testMode','==', type),
      where('createdAt', '>=', sinceDate),
      orderBy('createdAt','desc'),
      limit(200),
    ];
    const queries = [
      query(collection(db,'genTests'), ...baseConstraints, where('targetAll','==', true)),
      query(collection(db,'genTests'), ...baseConstraints, where('targetUids','array-contains', myUid)),
    ];
    if (myGroup) {
      queries.push(query(collection(db,'genTests'), ...baseConstraints, where('targetGroups','array-contains', myGroup)));
    }
    const snaps = await Promise.all(queries.map(q => getDocs(q)));
    // dedup + createdAt desc 정렬
    const seen = new Set();
    const allTests = [];
    snaps.forEach(snap => {
      snap.docs.forEach(d => {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          allTests.push({id: d.id, ...d.data()});
        }
      });
    });
    allTests.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    // active / excludedUids 클라 필터만 (대상 매칭은 server-side 완료)
    myTests = allTests.filter(t => {
      if (t.active === false) return false;
      if (Array.isArray(t.excludedUids) && t.excludedUids.includes(myUid)) return false;
      return true;
    });
    // 캐시 저장 — 다음 진입 시 헤드체크 valid 면 fetch 0
    state.myTests = myTests;
    state.fetchedAt = Date.now();
    state.cacheKey = state.daysLoaded;
  }

  // userCompleted batch — 한 진입당 1회 (collectionGroup, N+1 → 1)
  if (!state.userCompMap) {
    const map = new Map();
    try {
      const compSnap = await getDocs(query(
        collectionGroup(db, 'userCompleted'),
        where('uid', '==', myUid)
      ));
      compSnap.docs.forEach(d => {
        const testId = d.ref.parent.parent.id;
        map.set(testId, d.data());
      });
    } catch(e) { console.warn('[testList] userCompleted batch:', e.message); }
    state.userCompMap = map;
  }
  const userCompMap = state.userCompMap;

  const isCompleted = t => userCompMap.get(t.id)?.score !== undefined;
  const pending = myTests.filter(t => !isCompleted(t));
  const completed = myTests.filter(isCompleted);
  const quote = v => String(v||'').replace(/'/g,"\\'");
  const ocNew  = (id, name) => `${ui.startFn}('${id}','${quote(name)}')`;
  const ocDone = (id, name) => `${ui.viewPrevFn}('${id}','${quote(name)}')`;

  const loadMoreHtml = state.daysLoaded < 30
    ? `<div style="text-align:center;padding:14px;"><button class="btn btn-secondary" onclick="loadMoreTestList('${type}')" style="font-size:13px;">+ 10일 더 보기 (최근 ${state.daysLoaded}일)</button></div>`
    : `<div style="text-align:center;padding:14px;color:#888;font-size:12px;">최근 30일까지만 표시됩니다</div>`;

  if (elP) elP.innerHTML = (pending.length
    ? pending.map(t => _makeTypeCard(type, t, false, ocNew(t.id,t.name), null, userCompMap.get(t.id)?.latestScore)).join('')
    : '<div class="empty-msg" style="padding:20px;color:#bbb;">배정된 시험이 없습니다.</div>') + loadMoreHtml;
  if (elC) elC.innerHTML = completed.length
    ? completed.map(t => _makeTypeCard(type, t, true, ocDone(t.id,t.name), userCompMap.get(t.id)?.score ?? null, null)).join('')
    : '<div class="empty-msg" style="padding:20px;color:#bbb;">완료된 시험이 없습니다.</div>';
}

window.loadMoreTestList = async(type) => {
  const state = _testListState.get(type);
  if (!state || state.daysLoaded >= 30) return;
  state.daysLoaded = Math.min(30, state.daysLoaded + 10);
  try { await _loadTestListPage(type); } catch(e) { console.error('loadMoreTestList:', e); }
};

// 공용 결과 화면 shell (헤더 + 점수 카드 + 문제별 상세 + 버튼)
function _renderResultShell(type, {correct, wrong, total, score, passed, passScore, hintUsageCount, detailHtml}) {
  const ui = TEST_TYPE_UI[type] || TEST_TYPE_UI.vocab;
  return `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;padding:28px 20px;overflow-y:auto;">
      <div style="font-size:56px;margin-bottom:8px;">${passed ? '🎉' : '💪'}</div>
      <div style="font-size:20px;font-weight:800;color:var(--text);margin-bottom:4px;">${passed ? '통과!' : '아쉬워요'}</div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:20px;">통과 기준 ${passScore}점</div>
      <div style="background:white;border-radius:16px;padding:20px 28px;box-shadow:0 2px 8px rgba(0,0,0,0.08);margin-bottom:16px;min-width:260px;">
        <div style="font-size:44px;font-weight:800;color:${passed?'#059669':ui.accent};line-height:1;text-align:center;">${score}</div>
        <div style="font-size:11px;color:var(--gray);margin-top:2px;text-align:center;">점</div>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid #eee;display:flex;justify-content:space-around;font-size:13px;">
          <div style="text-align:center;"><div style="color:#059669;font-weight:700;font-size:17px;">${correct}</div><div style="color:var(--gray);font-size:11px;">정답</div></div>
          <div style="text-align:center;"><div style="color:#dc2626;font-weight:700;font-size:17px;">${wrong}</div><div style="color:var(--gray);font-size:11px;">오답</div></div>
          <div style="text-align:center;"><div style="color:var(--text);font-weight:700;font-size:17px;">${total}</div><div style="color:var(--gray);font-size:11px;">전체</div></div>
          ${hintUsageCount > 0 ? `<div style="text-align:center;"><div style="color:#F59E0B;font-weight:700;font-size:17px;">${hintUsageCount}</div><div style="color:var(--gray);font-size:11px;">힌트 사용</div></div>` : ''}
        </div>
      </div>
      ${detailHtml ? `
        <div style="width:100%;max-width:420px;margin-bottom:16px;">
          <div style="font-size:12px;color:var(--gray);font-weight:700;margin-bottom:8px;padding:0 4px;">문제별 결과</div>
          ${detailHtml}
        </div>` : ''}
      <div style="display:flex;gap:10px;width:100%;max-width:340px;padding-bottom:16px;">
        <button onclick="${ui.listFn}()" style="flex:1;padding:14px;background:white;border:1px solid var(--border);border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;color:var(--text);">시험 목록</button>
        <button onclick="${ui.retakeFn}()" style="flex:1;padding:14px;background:${ui.retakeBtnBg};border:none;border-radius:12px;font-size:14px;font-weight:700;color:white;cursor:pointer;">🔄 재응시</button>
      </div>
    </div>`;
}

function _makeTypeCard(type, t, isCompleted, onclick, completedScore, latestFailedScore) {
  const ui = TEST_TYPE_UI[type] || TEST_TYPE_UI.vocab;
  const qCount = t.questionCount || t.questions?.length || 0;
  const passScore = t.passScore ?? 80;
  const latestBadge = (!isCompleted && latestFailedScore != null)
    ? `<span style="font-size:11px;background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:20px;font-weight:700;">최근 ${latestFailedScore}점</span>`
    : '';
  const retakeBadge = (isCompleted && ui.showRetakeBadge)
    ? `<span style="font-size:11px;background:${ui.pendingBg};color:${ui.pendingColor};padding:2px 8px;border-radius:20px;">↻ 다시 풀기</span>`
    : '';
  // 단어시험 + vocabOptions.format='speaking' 이면 🎤 말하기 배지 표시
  const isSpeaking = type === 'vocab' && t.vocabOptions?.format === 'speaking';
  const speakingBadge = isSpeaking
    ? `<span style="font-size:11px;background:#fef3c7;color:#78350f;padding:2px 8px;border-radius:20px;font-weight:700;">${iconSvg('mic')} 말하기</span>`
    : '';
  // mcq + 첫 question.subType='grammar' 이면 📐 문법 배지 표시
  const isGrammar = type === 'mcq' && Array.isArray(t.questions) && t.questions[0]?.subType === 'grammar';
  const grammarBadge = isGrammar
    ? `<span style="font-size:11px;background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:20px;font-weight:700;">📐 문법</span>`
    : '';
  return `
    <div class="unit-card" onclick="${onclick}">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <div class="unit-name">${esc(t.name||ui.defaultName)}</div>
          ${speakingBadge}
          ${grammarBadge}
          ${isCompleted
            ? `<span style="font-size:11px;background:#d1fae5;color:#059669;padding:2px 8px;border-radius:20px;font-weight:700;">✓ 완료${completedScore!=null?' '+completedScore+'점':''}</span>${retakeBadge}`
            : `${latestBadge}<span style="font-size:11px;background:${ui.pendingBg};color:${ui.pendingColor};padding:2px 8px;border-radius:20px;">통과 ${passScore}점</span>`}
        </div>
        <div class="unit-count">${ui.subtitleEmoji} ${esc(t.bookName||ui.subtitleDefault)} · ${qCount}문제</div>
        <div style="font-size:11px;color:#bbb;margin-top:2px;">출제일: ${esc(t.date||'')}</div>
      </div>
      <span class="unit-arrow" style="color:${isCompleted?'#059669':''};">${isCompleted?ui.completedArrow:'›'}</span>
    </div>`;
}

// KST(UTC+9) 기준 YYYY-MM-DD — apiUsage doc ID 통일
function _ymdKST(d){ return new Date((d ? d.getTime() : Date.now()) + 9*3600*1000).toISOString().slice(0,10); }

// 비용 최적화 — 기간 헬퍼 (Firestore read 절감, 2026-05-13)
function _ymdDaysAgoKST(n){ return _ymdKST(new Date(Date.now() - n*864e5)); }

// Gemini API 호출 카운트는 서버 quota.js incrementUsage 가 단일 writer 로 처리.
// (이전 클라 _logApiCall 은 daily/monthly 드리프트 원인이라 폐기됨, 2026-05-02)

function filterMyTests(allTests, myGroup, myUid){
  return allTests.filter(t=>{
    if(!t.active && t.active !== undefined) return false;
    // 학원장이 이 시험에서 명시적으로 제외한 학생 — 시험 목록에서 숨김
    if (Array.isArray(t.excludedUids) && t.excludedUids.includes(myUid)) return false;
    const targets = t.targets||[];
    if(!targets.length){
      return (t.targetType==='class'&&t.targetId===myGroup)
        ||(t.targetType==='student'&&t.targetId===myUid)
        ||(t.targetId===myGroup);
    }
    return targets.some(tg=>(tg.type==='class'&&tg.id===myGroup)||(tg.type==='student'&&tg.id===myUid));
  });
}

function makeTestCard(t, isCompleted, onclick, completedScore){
  const wordCount = t.words?.length||t.count||0;
  const passScore = t.passScore??80;
  const modeIcon = t.testMode==='unscramble'?'🔀':'📝';
  return `
    <div class="unit-card" onclick="${onclick}">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <div class="unit-name">${t.name||'시험'}</div>
          ${isCompleted
            ? `<span style="font-size:11px;background:#d1fae5;color:#059669;padding:2px 8px;border-radius:20px;font-weight:700;">✅ 완료${completedScore!=null?' '+completedScore+'점':''}</span>`
            : `<span style="font-size:11px;background:#f0fafa;color:var(--teal);padding:2px 8px;border-radius:20px;">통과 ${passScore}점</span>`}
        </div>
        <div class="unit-count">${modeIcon} ${t.bookName||''} · ${wordCount}문제</div>
        <div style="font-size:11px;color:#bbb;margin-top:2px;">출제일: ${t.date||''}</div>
      </div>
      <span class="unit-arrow" style="color:${isCompleted?'#059669':''};">${isCompleted?'✓':'›'}</span>
    </div>`;
}

// ─── 본문이해·문법 (Reading MCQ) 카드 — Phase 2 구현 ───
window.goReadingMcq = async () => {
  show('readingMcqList');
  await loadReadingMcqList();
};

// ─── 빈칸채우기 카드 (Phase 3 활성화) ───
window.goFillBlank = async () => {
  show('fillBlankList');
  await loadFillBlankList();
};

// ═══════════════════════════════════════════════════════════════════════════
// 본문이해·문법 (Reading MCQ) - Phase 2
// ═══════════════════════════════════════════════════════════════════════════

let _mcqTakeState = {
  test: null,
  questions: [],
  currentIdx: 0,
  answers: [],
};
const loadReadingMcqList = () => _loadTestListByType('mcq');

const _mcqMakeCard = (t, isCompleted, onclick, completedScore, latestFailedScore) =>
  _makeTypeCard('mcq', t, isCompleted, onclick, completedScore, latestFailedScore);

window.startReadingMcq = async (testId, testName) => {
  try{
    const snap = await getDoc(doc(db,'genTests',testId));
    if(!snap.exists()){ showToast('시험 정보를 불러올 수 없어요.'); return; }
    const test = { id: testId, ...snap.data() };
    const rawQuestions = test.questions || [];
    if(rawQuestions.length === 0){ showToast('문제가 비어있습니다.'); return; }

    // 매 응시마다 선지(①②③④) 위치 셔플 — Fisher-Yates (편향 없음).
    // 객체에 isAnswer 마커가 있어 자동 추적.
    const _shuf = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const questions = rawQuestions.map(q => {
      if (!Array.isArray(q.choices) || q.choices.length < 2) return { ...q };
      return { ...q, choices: _shuf(q.choices) };
    });

    _mcqTakeState = {
      test,
      questions,
      currentIdx: 0,
      answers: new Array(questions.length).fill(null),
    };

    _screenPrepare('readingMcq', '#mcqProgressBar');
    show('readingMcq');
    _mcqRenderStep();
  }catch(e){
    console.error(e);
    showToast('시험 시작 실패: '+e.message);
  }
};

function _mcqRenderStep(){
  const s = _mcqTakeState;
  const q = s.questions[s.currentIdx];
  if(!q) return;

  const pct = Math.round(((s.currentIdx+1) / s.questions.length) * 100);
  const bar = document.getElementById('mcqProgressBar');
  const txt = document.getElementById('mcqProgressText');
  if(bar) bar.style.width = pct+'%';
  if(txt) txt.textContent = `${s.currentIdx+1} / ${s.questions.length}`;

  const passageBox = document.getElementById('mcqPassageBox');
  const passageEl = document.getElementById('mcqPassage');
  if(passageEl){
    if(q.passage){
      passageEl.textContent = q.passage;
      if(passageBox) passageBox.style.display = '';
    } else if(q.sourcePageTitle){
      passageEl.textContent = '(본문 출처: ' + q.sourcePageTitle + ')';
      if(passageBox) passageBox.style.display = '';
    } else {
      if(passageBox) passageBox.style.display = 'none';
    }
  }

  const qEl = document.getElementById('mcqQuestion');
  if(qEl) qEl.textContent = q.question || '';
  // 한글 해석은 문제 풀이 중 표시 안 함 (답을 암시할 수 있음). 결과 상세에서만 표시.

  const choicesEl = document.getElementById('mcqChoices');
  if(choicesEl){
    const selected = s.answers[s.currentIdx];
    const labels = ['①','②','③','④'];
    choicesEl.innerHTML = (q.choices||[]).map((c, i) => {
      const isSel = selected === i;
      return `
        <button onclick="mcqSelect(${i})"
          style="padding:14px 16px;background:${isSel?'var(--teal)':'white'};border:2px solid var(--teal);color:${isSel?'white':'var(--teal)'};border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 2px 4px rgba(232,113,74,0.15);text-align:left;display:flex;gap:10px;align-items:flex-start;">
          <span style="flex-shrink:0;">${labels[i]}</span>
          <span style="flex:1;line-height:1.4;font-weight:${isSel?700:600};">${esc(c.text||'')}</span>
        </button>`;
    }).join('');
  }

  const btn = document.getElementById('mcqNextBtn');
  if(btn){
    const isLast = s.currentIdx === s.questions.length - 1;
    const hasAnswer = s.answers[s.currentIdx] !== null;
    btn.textContent = isLast ? '제출하기 ▶' : '다음 ▶';
    btn.disabled = !hasAnswer;
    btn.style.background = hasAnswer ? (isLast ? '#059669' : 'var(--teal)') : '#ccc';
    btn.style.color = 'white';
    btn.style.cursor = hasAnswer ? 'pointer' : 'not-allowed';
    btn.style.boxShadow = hasAnswer ? '0 2px 8px rgba(232,113,74,.3)' : 'none';
  }
}

window.mcqSelect = async (choiceIdx) => {
  const s = _mcqTakeState;
  s._locked = s._locked || {};
  if (s._locked[s.currentIdx]) return;  // 이미 잠긴 문제 무시
  s._locked[s.currentIdx] = true;
  s.answers[s.currentIdx] = choiceIdx;
  // 정답 표시 — 정답 보기 초록·학생 오답 빨강
  _mcqRenderFeedback();
  // 1초 후 자동 다음 (객관식은 영문 보기 단독 발음 의미 적음 → TTS X)
  await new Promise(r => setTimeout(r, 1000));
  await window.mcqNext();
};

function _mcqRenderFeedback() {
  const s = _mcqTakeState;
  const q = s.questions[s.currentIdx];
  if (!q) return;
  const user = s.answers[s.currentIdx];
  const correctIdx = (q.choices||[]).findIndex(c => c.isAnswer === true);
  const choicesEl = document.getElementById('mcqChoices');
  if (!choicesEl) return;
  const labels = ['①','②','③','④'];
  choicesEl.innerHTML = (q.choices||[]).map((c, i) => {
    let bg = 'white', color = 'var(--teal)', border = 'var(--teal)';
    if (i === correctIdx) { bg = '#d1fae5'; color = '#047857'; border = '#10b981'; }
    else if (i === user) { bg = '#fee2e2'; color = '#b91c1c'; border = '#ef4444'; }
    return `<button disabled
      style="padding:14px 16px;background:${bg};border:2px solid ${border};color:${color};border-radius:14px;font-size:15px;font-weight:700;cursor:default;font-family:inherit;text-align:left;display:flex;gap:10px;align-items:flex-start;opacity:1;">
      <span style="flex-shrink:0;">${labels[i]}</span>
      <span style="flex:1;line-height:1.4;font-weight:700;">${esc(c.text||'')}</span>
    </button>`;
  }).join('');
  const btn = document.getElementById('mcqNextBtn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
}

window.mcqNext = async () => {
  const s = _mcqTakeState;
  if(s.answers[s.currentIdx] === null) return;

  if(s.currentIdx < s.questions.length - 1){
    s.currentIdx++;
    _mcqRenderStep();
  } else {
    await _mcqSubmit();
  }
};

async function _mcqSubmit(){
  const s = _mcqTakeState;
  const t = s.test;
  if(!t || !currentUser) return;
  if (s._submitted || s._submitting) return;
  s._submitting = true;

  let correct = 0;
  s.questions.forEach((q, i) => {
    const ansIdx = s.answers[i];
    const correctIdx = (q.choices || []).findIndex(c => c.isAnswer === true);
    if(ansIdx === correctIdx) correct++;
  });
  const total = s.questions.length;
  const wrong = total - correct;
  const score = total ? Math.round((correct / total) * 100) : 0;
  const passScore = t.passScore ?? 80;
  const passed = score >= passScore;
  const today = _ymdKST();

  try{
    await addDoc(collection(db,'scores'), {
      academyId: window.MY_ACADEMY_ID || 'default',
      uid: currentUser.uid,
      userId: currentUser.uid,
      userName: userProfile?.name || '',
      name: userProfile?.name || '',
      group: userProfile?.group || '',
      testId: t.id,
      testName: t.name || '',
      unitId: t.id,
      unitName: t.name || '',
      bookName: t.bookName || '',
      mode: 'mcq',
      // 시험 삭제돼도 성적리포트 문법 배지 판정 가능하도록 메타 보존 (2026-05-16)
      subType: s.questions?.[0]?.subType || '',
      score, correct, wrong, total,
      passed, passScore,
      date: today,
      createdAt: serverTimestamp(),
    });

    try{
      await _writeUserCompleted(t.id, {
        score, passed, passScore, correct, wrong, total,
        questions: s.questions, answers: s.answers,
      });
    }catch(e){ console.warn('genTest 완료 기록 실패', e); }
    s._submitted = true;
  }catch(e){
    console.error(e);
    showToast('점수 저장 실패: '+e.message);
  } finally {
    s._submitting = false;
  }

  _mcqRenderResult({ correct, wrong, total, score, passed, passScore,
    questions: s.questions, answers: s.answers });
}

function _mcqBuildDetail(questions, answers) {
  if (!questions || !answers) return '';
  const markers = ['①','②','③','④','⑤'];
  return (questions||[]).map((q, i) => {
    const userIdx = answers[i];
    const correctIdx = (q.choices || []).findIndex(c => c.isAnswer === true);
    const isCorrect = userIdx === correctIdx;
    const userChoice = (q.choices||[])[userIdx];
    const correctChoice = (q.choices||[])[correctIdx];
    const bg = isCorrect ? '#F0FDF4' : '#FEF2F2';
    const border = isCorrect ? '#BBF7D0' : '#FECACA';
    return `
      <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:10px 12px;margin-bottom:8px;text-align:left;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:11px;color:var(--gray);font-weight:700;">Q${i+1}</span>
          <span style="font-size:12px;color:${isCorrect?'#059669':'#dc2626'};font-weight:700;">${isCorrect?'✓ 정답':'✗ 오답'}</span>
        </div>
        <div style="font-size:12px;color:var(--text);line-height:1.4;margin-bottom:4px;font-weight:600;">${esc(q.question||'')}</div>
        ${q.questionKo ? `<div style="font-size:11px;color:var(--gray);margin-bottom:5px;">${esc(q.questionKo)}</div>` : ''}
        <div style="font-size:11px;color:var(--gray);">
          <span style="color:${isCorrect?'#059669':'#dc2626'};">내답: ${userIdx!=null ? `${markers[userIdx]||''} ${esc(userChoice?.text||'')}` : '(미선택)'}</span>
          ${!isCorrect && correctChoice ? `<br><span style="color:#059669;">정답: ${markers[correctIdx]||''} ${esc(correctChoice.text||'')}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

function _mcqRenderResult({correct, wrong, total, score, passed, passScore, questions, answers}){
  const screen = document.getElementById('readingMcq');
  if (!screen) return;
  _screenSnapshotOnce('readingMcq');
  screen.innerHTML = _renderResultShell('mcq', {
    correct, wrong, total, score, passed, passScore,
    detailHtml: _mcqBuildDetail(questions, answers),
  });
  updateMcqBadge();
}

// 결과 화면에서 현재 시험 재응시 (파라미터 없이 state 참조)
window.mcqRetakeCurrent = () => {
  const t = _mcqTakeState?.test;
  if (!t?.id) { showToast('시험 정보 없음'); return; }
  startReadingMcq(t.id, t.name || '');
};

// 완료된 객관식 이전 결과 보기
window.mcqViewPreviousResult = async (testId, testName) => {
  try {
    const [testSnap, compSnap] = await Promise.all([
      getDoc(doc(db,'genTests',testId)),
      getDoc(doc(db,'genTests',testId,'userCompleted',currentUser.uid)),
    ]);
    if (!testSnap.exists() || !compSnap.exists()) {
      showToast('이전 결과를 불러올 수 없습니다. 새로 시작합니다.');
      startReadingMcq(testId, testName);
      return;
    }
    const test = { id: testId, ...testSnap.data() };
    const comp = compSnap.data();
    // 응시 시 매번 q.choices 셔플됨 → comp.answers idx 와 매칭되는 셔플 순서는 comp.questions 에 박힘.
    // test.questions (원본) 사용 시 셔플 mismatch 로 정답이 오답으로 표시되는 버그 fix.
    const questions = (Array.isArray(comp.questions) && comp.questions.length)
      ? comp.questions
      : (test.questions || []);
    _mcqTakeState = { test, questions, currentIdx: 0, answers: comp.answers || [] };

    _screenSnapshotOnce('readingMcq');
    show('readingMcq');
    _mcqRenderResult({
      correct: comp.correct || 0,
      wrong: comp.wrong || 0,
      total: comp.total || questions.length,
      score: comp.score || 0,
      passed: comp.passed ?? ((comp.score||0) >= (comp.passScore||80)),
      passScore: comp.passScore || 80,
      questions,
      answers: comp.answers || [],
    });
  } catch (e) {
    console.error('객관식 이전 결과 로드 실패', e);
    showToast('로드 실패: ' + e.message);
    startReadingMcq(testId, testName);
  }
};

window.quitReadingMcq = async () => {
  if(!(await showConfirm('시험을 중단할까요?','지금까지의 답안은 저장되지 않습니다.'))) return;
  goHome();
};

// ═══════════════════════════════════════════════════════════════════════════
// 빈칸채우기 (Fill Blank) - Phase 3
// ═══════════════════════════════════════════════════════════════════════════

let _fbTimer = null;
let _fbTimeLeft = 30;
const FB_TIME_PER_Q = 30;
let _fbActiveBlank = 0;   // 현재 포커스 중인 빈칸 idx

let _fbState = {
  test: null,
  questions: [],
  playOrder: [],    // 출제 순서 (섞인 인덱스 배열), 예: [2,0,1]
  currentIdx: 0,    // playOrder 안의 위치 (0 = 첫 번째 출제)
  answers: [],      // 원본 questions 순서로 정렬 (answers[i] ↔ questions[i])
  hintStages: [],   // 원본 순서: 문제별 힌트 사용 단계 (0/1/2)
  hintCache: {},    // { [qIdx]: { ko: '번역' } }
};

function _fbCurQIdx(){
  const s = _fbState;
  return (s.playOrder && s.playOrder.length) ? s.playOrder[s.currentIdx] : s.currentIdx;
}
const loadFillBlankList = () => _loadTestListByType('fill_blank');

const _fbMakeCard = (t, isCompleted, onclick, completedScore, latestFailedScore) =>
  _makeTypeCard('fill_blank', t, isCompleted, onclick, completedScore, latestFailedScore);

window.startFillBlank = async (testId, testName) => {
  try{
    const snap = await getDoc(doc(db,'genTests',testId));
    if(!snap.exists()){ showToast('시험 정보를 불러올 수 없어요.'); return; }
    const test = { id: testId, ...snap.data() };
    const questions = (test.questions || []).filter(q => q.type === 'fill_blank' || q.blanks);
    if(questions.length === 0){ showToast('문제가 비어있습니다.'); return; }

    _screenPrepare('fillBlank', '#fbProgressBar');

    _fbState = {
      test,
      questions,
      playOrder: _rngShuffle([...Array(questions.length).keys()]),
      currentIdx: 0,
      answers: questions.map(q => new Array((q.blanks||[]).length).fill('')),
      hintStages: questions.map(() => 0),
      hintCache: {},
    };

    show('fillBlank');
    _fbRenderStep();
  }catch(e){
    console.error(e);
    showToast('시험 시작 실패: ' + e.message);
  }
};

function _fbRenderStep(){
  const s = _fbState;
  const qIdx = _fbCurQIdx();
  const q = s.questions[qIdx];
  if(!q) return;

  // 이전 문제의 피드백 배너 초기화 (정답/오답 메시지 제거)
  const hintBox = document.getElementById('fbHintBox');
  if (hintBox) {
    hintBox.innerHTML = '빈칸을 탭하면 입력됩니다';
    hintBox.style.color = 'var(--gray)';
  }

  const pct = Math.round(((s.currentIdx+1) / s.questions.length) * 100);
  const bar = document.getElementById('fbProgressBar');
  const txt = document.getElementById('fbProgressText');
  if(bar) bar.style.width = pct + '%';
  if(txt) txt.textContent = `${s.currentIdx+1} / ${s.questions.length}`;

  const qKoEl = document.getElementById('fbQuestionKo');
  if(qKoEl) qKoEl.textContent = q.questionKo || '문장의 빈칸에 알맞은 단어를 쓰세요.';

  const sentEl = document.getElementById('fbSentence');
  const holder = document.getElementById('fbInputsHolder');
  if(sentEl){
    const parts = (q.sentence||'').split('___');
    const curAnswers = s.answers[qIdx] || [];
    let html = '';
    let inputsHtml = '';
    const totalBlanks = parts.length - 1;
    for(let i = 0; i < parts.length; i++){
      html += esc(parts[i]);
      if(i < totalBlanks){
        const letterCount = (q.blanks?.[i] || '').length;
        const curVal = curAnswers[i] || '';
        // 인라인 박스 그룹 (탭하면 해당 빈칸 포커스)
        html += `<span onclick="fbFocusBlank(${i})" style="display:inline-flex;gap:3px;vertical-align:middle;margin:0 4px;cursor:text;">`;
        for(let k = 0; k < letterCount; k++){
          const ch = curVal[k] || '';
          html += `<span id="fb-box-${i}-${k}" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:28px;border:2px solid #ddd;background:white;color:var(--c-brand-dark);border-radius:5px;font-size:17px;font-weight:700;line-height:1;">${esc(ch)}</span>`;
        }
        html += `</span>`;
        // 숨은 input (단어시험 패턴)
        inputsHtml += `<input type="password" id="fb-input-${i}" value="${esc(curVal)}"
          oninput="fbUpdateAnswer(${i}, this.value)"
          onkeydown="fbInputKey(event, ${i})"
          autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false"
          inputmode="text" data-lpignore="true" data-form-type="other" data-1p-ignore="true"
          name="noop-fb-${i}" maxlength="${letterCount}">`;
      }
    }
    sentEl.innerHTML = html;
    if(holder) holder.innerHTML = inputsHtml;
  }

  _fbActiveBlank = 0;
  _fbRefreshBoxes();

  const btn = document.getElementById('fbNextBtn');
  if(btn){
    const isLast = s.currentIdx === s.questions.length - 1;
    btn.textContent = isLast ? '제출 ▶' : '다음 ▶';
    btn.style.background = isLast ? '#059669' : '#EAB308';
  }

  _fbStartTimer();
  _fbRefreshHintUI();

  setTimeout(() => {
    const first = document.getElementById('fb-input-0');
    if(first){
      try { first.focus({ preventScroll: true }); } catch(e) { first.focus(); }
      window.scrollTo(0, 0);
    }
  }, 50);
}

// ─── 힌트 ───
function _fbRefreshHintUI(){
  const s = _fbState;
  const qIdx = _fbCurQIdx();
  const stage = s.hintStages[qIdx] || 0;
  const btn = document.getElementById('fbHintBtn');
  const stageEl = document.getElementById('fbHintStage');
  const transBox = document.getElementById('fbTranslation');
  const transText = document.getElementById('fbTranslationText');

  if (btn && stageEl) {
    if (stage === 0) {
      btn.disabled = false;
      btn.style.background = '#3B82F6';
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      stageEl.textContent = '(1/2)';
    } else if (stage === 1) {
      btn.disabled = false;
      btn.style.background = '#F59E0B';
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      stageEl.textContent = '(2/2)';
    } else {
      btn.disabled = true;
      btn.style.background = '#9CA3AF';
      btn.style.opacity = '.7';
      btn.style.cursor = 'not-allowed';
      stageEl.textContent = '사용됨';
    }
  }

  if (transBox && transText) {
    if (stage >= 1) {
      const cached = s.hintCache[qIdx];
      transBox.style.display = 'block';
      transText.textContent = cached?.ko || '로딩 중...';
    } else {
      transBox.style.display = 'none';
    }
  }
}

window.fbUseHint = async () => {
  const s = _fbState;
  const qIdx = _fbCurQIdx();
  const q = s.questions[qIdx];
  if (!q) return;
  const cur = s.hintStages[qIdx] || 0;
  if (cur >= 2) return;

  // 현재 포커스된 입력 기억 (힌트 조작 후 복귀)
  const focusIdx = (_fbActiveBlank != null) ? _fbActiveBlank : 0;
  const refocus = () => {
    const inp = document.getElementById('fb-input-' + focusIdx);
    if (inp) {
      try { inp.focus({ preventScroll: true }); } catch(e) { inp.focus(); }
      try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch(e){}
    }
  };

  if (cur === 0) {
    // 1단계: 해석 표시 (sentenceKo 있으면 그대로, 없으면 Gemini 온디맨드 번역)
    s.hintStages[qIdx] = 1;
    _fbRefreshHintUI();

    if (!s.hintCache[qIdx]) {
      const ko = q.sentenceKo || (await _fbFetchTranslation(q.sentence || ''));
      s.hintCache[qIdx] = { ko: ko || '(번역 실패)' };
    }
    _fbRefreshHintUI();
    refocus();
  } else if (cur === 1) {
    // 2단계: 각 빈칸의 첫 글자 공개 (기존 입력값이 다르면 교체)
    s.hintStages[qIdx] = 2;
    const blanks = q.blanks || [];
    if (!s.answers[qIdx]) s.answers[qIdx] = [];
    blanks.forEach((correct, j) => {
      const first = String(correct || '').charAt(0).toLowerCase();
      const existing = s.answers[qIdx][j] || '';
      if (!existing || existing[0] !== first) {
        s.answers[qIdx][j] = first;
        const inp = document.getElementById('fb-input-' + j);
        if (inp) inp.value = first;
      }
    });
    _fbRefreshBoxes();
    _fbRefreshHintUI();
    refocus();
  }
};

async function _fbFetchTranslation(sentence) {
  if (!sentence || sentence.trim().length < 2) return '';
  try {
    const idToken = currentUser ? await currentUser.getIdToken() : '';
    const res = await fetch('/api/cleanup-ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        text: sentence,
        systemPrompt: '다음 영어 문장을 자연스러운 한국어로 번역하세요. 번역문만 한 줄로 출력하고, 인용부호·설명·부연 없이 깔끔하게. 직역이 아닌 의역을 선호하세요.',
      }),
    });
    const data = await res.json();
    return (data.success && data.cleaned) ? String(data.cleaned).trim() : '';
  } catch (e) {
    console.warn('translation fetch failed', e);
    return '';
  }
}

// 단일 빈칸 박스 시각 갱신
function _fbRefreshBoxesForBlank(blankIdx){
  const s = _fbState;
  const qIdx = _fbCurQIdx();
  const q = s.questions[qIdx];
  if(!q) return;
  const letterCount = (q.blanks?.[blankIdx] || '').length;
  const curVal = (s.answers[qIdx] || [])[blankIdx] || '';
  const isActiveBlank = (_fbActiveBlank === blankIdx);
  for(let k = 0; k < letterCount; k++){
    const box = document.getElementById(`fb-box-${blankIdx}-${k}`);
    if(!box) continue;
    const ch = curVal[k] || '';
    box.textContent = ch;
    if(ch){
      box.style.borderColor = 'var(--c-brand)';
      box.style.background = '#FFF4ED';
      box.style.color = 'var(--c-brand-dark)';
    } else if(isActiveBlank && k === curVal.length){
      box.style.borderColor = 'var(--c-brand)';
      box.style.background = 'white';
    } else {
      box.style.borderColor = '#ddd';
      box.style.background = 'white';
    }
  }
}

function _fbRefreshBoxes(){
  const q = _fbState.questions[_fbCurQIdx()];
  if(!q) return;
  const blankCount = (q.blanks || []).length;
  for(let i = 0; i < blankCount; i++) _fbRefreshBoxesForBlank(i);
}

window.fbFocusBlank = (blankIdx) => {
  _fbActiveBlank = blankIdx;
  const inp = document.getElementById('fb-input-' + blankIdx);
  if(inp){
    // preventScroll: iOS/크롬 자동 스크롤 방지
    try { inp.focus({ preventScroll: true }); } catch(e) { inp.focus(); }
    try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch(e){}
    // 안전장치: 포커스 직후 페이지 스크롤 위치 복원
    window.scrollTo(0, 0);
  }
  _fbRefreshBoxes();
};

// ─── 타이머 ───
// 학원장 설정 test.timeLimitSec 우선, 없으면 default FB_TIME_PER_Q(30)
function _fbStartTimer(){
  _fbStopTimer();
  const v = parseInt(_fbState?.test?.timeLimitSec);
  const total = (isFinite(v) && v >= 5 && v <= 120) ? v : FB_TIME_PER_Q;
  _fbTimeLeft = total;
  _fbUpdateTimerUI(total);
  _fbTimer = setInterval(() => {
    _fbTimeLeft--;
    _fbUpdateTimerUI(total);
    if(_fbTimeLeft <= 0){
      _fbStopTimer();
      // 시간 만료 → 현재 입력값 그대로 다음 문제로 (또는 제출)
      fbNext();
    }
  }, 1000);
}

function _fbStopTimer(){
  if(_fbTimer){ clearInterval(_fbTimer); _fbTimer = null; }
}

function _fbUpdateTimerUI(total){
  const txt = document.getElementById('fbTimerText');
  const arc = document.getElementById('fbTimerArc');
  if(txt) txt.textContent = _fbTimeLeft;
  if(arc && total) arc.style.strokeDashoffset = 113 * (1 - _fbTimeLeft / total);
}

window.fbSkip = async () => {
  // 현재 문제 답 비우고 다음으로
  const s = _fbState;
  const qIdx = _fbCurQIdx();
  if(s.answers[qIdx]) s.answers[qIdx] = s.answers[qIdx].map(() => '');
  _fbStopTimer();
  if(s.currentIdx < s.questions.length - 1){
    s.currentIdx++;
    _fbRenderStep();
  } else {
    await _fbSubmit();
  }
};

window.fbUpdateAnswer = (blankIdx, value) => {
  const s = _fbState;
  const qIdx = _fbCurQIdx();
  const q = s.questions[qIdx];
  if(!q) return;
  const targetBlank = q.blanks?.[blankIdx] || '';
  const letterCount = targetBlank.length;
  // 한글·한자·일본어 등 비-라틴 문자만 차단. 특수문자 모두 자유 (단어시험과 동일 정책)
  value = String(value||'').toLowerCase().replace(/[가-힯ㄱ-ㆎ぀-ゟ゠-ヿ一-鿿]/g, '');
  // 정답 공백 위치 자동 삽입 ('aJoke' + target 'a joke' → 'a joke')
  value = _vqAutoSpaces(value, targetBlank);
  value = value.slice(0, letterCount);
  if(!s.answers[qIdx]) s.answers[qIdx] = [];
  s.answers[qIdx][blankIdx] = value;
  const inp = document.getElementById('fb-input-' + blankIdx);
  if(inp && inp.value !== value) inp.value = value;
  _fbRefreshBoxesForBlank(blankIdx);

  // 빈칸이 꽉 차면 다음 빈칸으로 자동 이동, 마지막 빈칸이면 자동 다음 문제 (debounce 400)
  if(value.length === letterCount && letterCount > 0){
    const totalBlanks = (q.blanks||[]).length;
    if(blankIdx < totalBlanks - 1){
      setTimeout(() => fbFocusBlank(blankIdx + 1), 120);
      _fbCancelAutoSubmit();
    } else {
      // 마지막 빈칸 — 모든 빈칸 다 채워졌는지 확인 후 자동 fbNext
      const allFilled = (q.blanks||[]).every((t, i) => {
        const a = (s.answers[qIdx] || [])[i] || '';
        return a.length === (t||'').length && t.length > 0;
      });
      if (allFilled) _fbScheduleAutoSubmit();
    }
  } else {
    _fbCancelAutoSubmit();
  }
};

// 빈칸 자동 제출 debounce
let _fbAutoSubmitTimer = null;
function _fbScheduleAutoSubmit() {
  _fbCancelAutoSubmit();
  _fbAutoSubmitTimer = setTimeout(() => {
    _fbAutoSubmitTimer = null;
    if (typeof window.fbNext === 'function') window.fbNext();
  }, 400);
}
function _fbCancelAutoSubmit() {
  if (_fbAutoSubmitTimer) { clearTimeout(_fbAutoSubmitTimer); _fbAutoSubmitTimer = null; }
}

window.fbInputKey = (event, blankIdx) => {
  if(event.key === 'Enter' || event.key === 'Tab'){
    event.preventDefault();
    const q = _fbState.questions[_fbCurQIdx()];
    const total = (q.blanks||[]).length;
    if(blankIdx < total - 1){
      fbFocusBlank(blankIdx + 1);
    } else {
      fbNext();
    }
    return;
  }
  // Backspace 자동 띄어쓰기 처리 — 커서 직전 공백이면 공백 + 앞 글자 함께 삭제
  if (event.key === 'Backspace') {
    const t = event.target;
    if (!t || t.selectionStart !== t.selectionEnd) return;
    const pos = t.selectionStart;
    if (pos >= 2 && t.value[pos - 1] === ' ') {
      event.preventDefault();
      t.value = t.value.slice(0, pos - 2) + t.value.slice(pos);
      t.selectionStart = t.selectionEnd = pos - 2;
      t.dispatchEvent(new Event('input'));
    }
  }
};

window.fbNext = async () => {
  _fbStopTimer();
  _fbCancelAutoSubmit();
  // 현재 문제 즉시 피드백 (정답 시 TTS 끝까지, 그 외 1초)
  await _fbShowQuestionFeedback();
  const s = _fbState;
  if(s.currentIdx < s.questions.length - 1){
    s.currentIdx++;
    _fbRenderStep();
  } else {
    await _fbSubmit();
  }
};

function _fbShowQuestionFeedback(){
  return new Promise(resolve => {
    const s = _fbState;
    const qIdx = _fbCurQIdx();
    const q = s.questions[qIdx];
    if (!q) { resolve(); return; }
    const blanks = q.blanks || [];
    const ans = s.answers[qIdx] || [];
    let allCorrect = blanks.length > 0;

    blanks.forEach((correct, j) => {
      const user = (ans[j] || '').trim().toLowerCase();
      const target = String(correct || '').trim().toLowerCase();
      const isCorrect = user === target;
      if (!isCorrect) allCorrect = false;
      const letterCount = target.length;
      for (let k = 0; k < letterCount; k++) {
        const box = document.getElementById(`fb-box-${j}-${k}`);
        if (!box) continue;
        if (isCorrect) {
          box.style.borderColor = '#22C55E';
          box.style.background = '#DCFCE7';
          box.style.color = '#059669';
        } else {
          // 오답은 정답을 빨간 박스로 보여줌
          box.style.borderColor = '#EF4444';
          box.style.background = '#FEE2E2';
          box.style.color = '#DC2626';
          box.textContent = target[k] || '';
        }
      }
    });

    // 하단 피드백 배너
    const hintBox = document.getElementById('fbHintBox');
    if (hintBox) {
      hintBox.innerHTML = allCorrect
        ? '<span style="color:#059669;font-weight:800;font-size:14px;">✓ 정답! 🔊</span>'
        : `<span style="color:#DC2626;font-weight:800;font-size:14px;">✗ 오답 · 정답: ${esc(blanks.join(', '))}</span>`;
    }

    // 정답 시 영단어 TTS — 끝까지 대기 후 진행 (그 외엔 1초 대기)
    const isEnglish = blanks.some(b => /[a-zA-Z]/.test(String(b||'')));
    if (allCorrect && isEnglish && blanks.length) {
      _speakAndWait(blanks.join(' ')).then(resolve);
    } else {
      setTimeout(resolve, 1000);
    }
  });
}

function _fbSpeakWords(words){
  try {
    if (!('speechSynthesis' in window)) return;
    const text = (words || []).join(', ');
    if (!text) return;
    // 기존 음성 중단 (이전 문제 재생 남았을 수 있음)
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    u.pitch = 1;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  } catch(e) { console.warn('speech error', e); }
}

// TTS 끝까지 대기 — 자동 진행용 (onend / onerror / 3초 fallback)
function _speakAndWait(word) {
  return new Promise(resolve => {
    if (!word || !('speechSynthesis' in window)) { resolve(); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(word));
      u.lang = 'en-US';
      u.rate = 0.9;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      u.onend = finish;
      u.onerror = finish;
      // 안전 fallback — TTS 미동작/엔진 hang 시 3초 후 강제 진행
      setTimeout(finish, 3000);
      window.speechSynthesis.speak(u);
    } catch (e) { resolve(); }
  });
}

async function _fbSubmit(){
  _fbStopTimer();
  const s = _fbState;
  if (!s.test || !currentUser) return;
  if (s._submitted || s._submitting) return;
  s._submitting = true;
  const t = s.test;
  if(!t || !currentUser) return;

  let totalBlanks = 0;
  let correctBlanks = 0;       // 힌트 무시 정답 수 (rawScore 용)
  let weightedCorrect = 0;     // 힌트 감점 반영 가중치 합 (score 용)
  const detail = [];
  const hintDetails = [];

  // 힌트 배율: 0 → 1.0 (100%), 1 → 0.9 (-10%), 2 → 0.8 (-20%)
  const MULT = { 0: 1.0, 1: 0.9, 2: 0.8 };

  s.questions.forEach((q, i) => {
    const blanks = q.blanks || [];
    const ans = s.answers[i] || [];
    let qCorrect = 0;
    blanks.forEach((correct, j) => {
      totalBlanks++;
      const user = (ans[j] || '').trim().toLowerCase();
      const target = String(correct || '').trim().toLowerCase();
      if(user && user === target){
        correctBlanks++;
        qCorrect++;
      }
    });
    const stage = s.hintStages[i] || 0;
    weightedCorrect += qCorrect * (MULT[stage] || 1);
    detail.push({correct: qCorrect, total: blanks.length, stage});
    if (stage > 0) {
      hintDetails.push({
        qIdx: i,
        stage,
        allCorrect: qCorrect === blanks.length && blanks.length > 0,
      });
    }
  });

  const score = totalBlanks ? Math.round((weightedCorrect / totalBlanks) * 100) : 0;
  const rawScore = totalBlanks ? Math.round((correctBlanks / totalBlanks) * 100) : 0;
  const hintPenalty = Math.max(0, rawScore - score);
  const hintStage1Count = hintDetails.filter(h => h.stage === 1).length;
  const hintStage2Count = hintDetails.filter(h => h.stage === 2).length;
  const hintUsageCount = hintDetails.length;

  const passScore = t.passScore ?? 80;
  const passed = score >= passScore;
  const today = _ymdKST();

  try{
    await addDoc(collection(db,'scores'), {
      academyId: window.MY_ACADEMY_ID || 'default',
      uid: currentUser.uid,
      userId: currentUser.uid,
      userName: userProfile?.name || '',
      name: userProfile?.name || '',
      group: userProfile?.group || '',
      testId: t.id,
      testName: t.name || '',
      unitId: t.id,
      unitName: t.name || '',
      bookName: t.bookName || '',
      mode: 'fill_blank',
      score,
      rawScore,
      correct: correctBlanks,
      wrong: totalBlanks - correctBlanks,
      total: totalBlanks,
      passed, passScore,
      hintUsageCount,
      hintStage1Count,
      hintStage2Count,
      hintPenalty,
      hintDetails,
      date: today,
      createdAt: serverTimestamp(),
    });

    try{
      // Firestore 는 중첩 배열([[...],[...]]) 미지원 → 객체 배열로 감싸서 저장
      const answersPacked = (s.answers || []).map(a => ({ blanks: Array.isArray(a) ? a : [] }));
      await _writeUserCompleted(t.id, {
        score, passed, passScore,
        correct: correctBlanks,
        wrong: totalBlanks - correctBlanks,
        total: totalBlanks,
        answers: answersPacked,
        extra: {
          rawScore,
          hintUsageCount, hintStage1Count, hintStage2Count, hintPenalty,
          hintDetails,
        },
      });
    }catch(e){ console.warn('genTest 완료 기록 실패', e); }
    s._submitted = true;
  }catch(e){
    console.error(e);
    showToast('점수 저장 실패: ' + e.message);
  } finally {
    s._submitting = false;
  }

  _fbRenderResult({
    correct: correctBlanks,
    wrong: totalBlanks - correctBlanks,
    total: totalBlanks,
    score, passed, passScore,
    detail,
    hintUsageCount,
    questions: s.questions,
    answers: s.answers,
  });
}

function _fbBuildDetail(questions, answers, detail) {
  if (!questions) return '';
  return (questions||[]).map((q, i) => {
    const d = detail?.[i] || {correct:0, total:0, stage:0};
    const allCorrect = d.correct === d.total && d.total > 0;
    const stageIcon = d.stage === 2 ? '💡💡' : d.stage === 1 ? '💡' : '';
    const stageLabel = d.stage === 2 ? '해석+첫글자' : d.stage === 1 ? '해석' : '';
    const userAns = (answers?.[i]||[]).join(', ') || '(미입력)';
    const correctAns = (q.blanks||[]).join(', ');
    const bg = allCorrect ? '#F0FDF4' : (d.correct > 0 ? '#FFFBEB' : '#FEF2F2');
    const border = allCorrect ? '#BBF7D0' : (d.correct > 0 ? '#FEF3C7' : '#FECACA');
    return `
      <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:10px 12px;margin-bottom:8px;text-align:left;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:11px;color:var(--gray);font-weight:700;">Q${i+1}</span>
          <span style="font-size:12px;color:${allCorrect?'#059669':'#dc2626'};font-weight:700;">${allCorrect?'✓':(d.correct>0?'△':'✗')} ${d.correct}/${d.total}</span>
          ${stageIcon ? `<span style="font-size:10px;background:#FED7AA;color:#9A3412;padding:2px 6px;border-radius:10px;font-weight:600;">${stageIcon} ${stageLabel}</span>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text);line-height:1.4;margin-bottom:3px;">${esc(q.sentence||'')}</div>
        <div style="font-size:11px;color:var(--gray);">
          <span style="color:${allCorrect?'#059669':'#dc2626'};">내답: ${esc(userAns)}</span>
          ${!allCorrect ? ` · <span style="color:#059669;">정답: ${esc(correctAns)}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

function _fbRenderResult({correct, wrong, total, score, passed, passScore, detail, hintUsageCount, questions, answers}){
  const screen = document.getElementById('fillBlank');
  if (!screen) return;
  _screenSnapshotOnce('fillBlank');
  screen.innerHTML = _renderResultShell('fill_blank', {
    correct, wrong, total, score, passed, passScore, hintUsageCount,
    detailHtml: _fbBuildDetail(questions, answers, detail),
  });
  updateFbBadge();
}

// ─── 완료된 시험의 이전 결과 보기 + 재응시 선택 ───
window.fbRetakeCurrent = () => {
  const t = _fbState?.test;
  if (!t?.id) { showToast('시험 정보 없음'); return; }
  startFillBlank(t.id, t.name || '');
};

window.fbViewPreviousResult = async (testId, testName) => {
  try {
    const [testSnap, compSnap] = await Promise.all([
      getDoc(doc(db, 'genTests', testId)),
      getDoc(doc(db, 'genTests', testId, 'userCompleted', currentUser.uid)),
    ]);
    if (!testSnap.exists() || !compSnap.exists()) {
      showToast('이전 결과를 불러올 수 없습니다. 새로 시작합니다.');
      startFillBlank(testId, testName);
      return;
    }
    const test = { id: testId, ...testSnap.data() };
    const comp = compSnap.data();
    const questions = (test.questions || []).filter(q => q.type === 'fill_blank' || q.blanks);

    // answers: 저장 시 [{blanks:[...]}, ...] 로 packed 되어 있음 → 2D 배열로 복원
    const unpackedAnswers = Array.isArray(comp.answers)
      ? comp.answers.map(a => (a && Array.isArray(a.blanks)) ? a.blanks : (Array.isArray(a) ? a : []))
      : questions.map(q => new Array((q.blanks||[]).length).fill(''));

    _fbState = {
      test,
      questions,
      playOrder: [...Array(questions.length).keys()], // 리뷰는 원본 순서
      currentIdx: 0,
      answers: unpackedAnswers,
      hintStages: (comp.hintDetails || []).reduce((acc, h) => { acc[h.qIdx] = h.stage; return acc; }, questions.map(() => 0)),
      hintCache: {},
    };

    _screenSnapshotOnce('fillBlank');
    show('fillBlank');

    // detail 재구성
    const detail = questions.map((q, i) => {
      const ansArr = (_fbState.answers[i] || []);
      const blanks = q.blanks || [];
      let qc = 0;
      blanks.forEach((correct, j) => {
        const user = (ansArr[j] || '').trim().toLowerCase();
        const target = String(correct || '').trim().toLowerCase();
        if (user && user === target) qc++;
      });
      return { correct: qc, total: blanks.length, stage: _fbState.hintStages[i] || 0 };
    });

    _fbRenderResult({
      correct: comp.correct || 0,
      wrong: comp.wrong || 0,
      total: comp.total || 0,
      score: comp.score || 0,
      passed: comp.passed ?? ((comp.score||0) >= (comp.passScore||80)),
      passScore: comp.passScore || 80,
      detail,
      hintUsageCount: comp.hintUsageCount || 0,
      questions,
      answers: _fbState.answers,
    });
  } catch (e) {
    console.error('이전 결과 로드 실패', e);
    showToast('로드 실패: ' + e.message);
    startFillBlank(testId, testName);
  }
};

window.quitFillBlank = async () => {
  if(!(await showConfirm('시험을 중단할까요?','지금까지의 답안은 저장되지 않습니다.'))) return;
  _fbStopTimer();
  goHome();
};

// ═══════════════════════════════════════════════════════════════════════════
// AI 녹음숙제 (genTests.testMode='recording-ai') - Phase 5
// ═══════════════════════════════════════════════════════════════════════════

window.goRecAi = async () => {
  show('recAiList');
  await loadRecAiList();
};

async function loadRecAiList(){
  const elP = document.getElementById('raListPending');
  if(elP) elP.innerHTML = '<div class="empty-msg" style="padding:20px;">로딩 중...</div>';
  // state 리셋 — 10일 default, userCompMap 새로 fetch
  _testListState.set('recording', { daysLoaded: 10, userCompMap: null });
  try {
    await _loadRecAiListPage();
  } catch(e) {
    console.error(e);
    if(elP) elP.innerHTML = '<div class="empty-msg" style="padding:20px;">불러오기 실패</div>';
  }
}

async function _loadRecAiListPage(){
  const state = _testListState.get('recording');
  if (!state) return;
  const elP = document.getElementById('raListPending');
  const elC = document.getElementById('raListCompleted');
  const myGroup = userProfile?.group || '';
  const myUid = currentUser?.uid || '';
  const sinceDate = new Date(Date.now() - state.daysLoaded * 864e5);

  // server-side filter — 그 학생 대상만 (3 분리 쿼리 병렬, 2026-05-14)
  const baseConstraints = [
    where('academyId','==', window.MY_ACADEMY_ID),
    where('testMode','==', 'recording'),
    where('createdAt', '>=', sinceDate),
    orderBy('createdAt','desc'),
    limit(200),
  ];
  const queries = [
    query(collection(db,'genTests'), ...baseConstraints, where('targetAll','==', true)),
    query(collection(db,'genTests'), ...baseConstraints, where('targetUids','array-contains', myUid)),
  ];
  if (myGroup) {
    queries.push(query(collection(db,'genTests'), ...baseConstraints, where('targetGroups','array-contains', myGroup)));
  }
  const snaps = await Promise.all(queries.map(q => getDocs(q)));
  const seen = new Set();
  const allTests = [];
  snaps.forEach(snap => {
    snap.docs.forEach(d => {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        allTests.push({id: d.id, ...d.data()});
      }
    });
  });
  allTests.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  const myTests = allTests.filter(t => {
    if (t.active === false) return false;
    if (Array.isArray(t.excludedUids) && t.excludedUids.includes(myUid)) return false;
    return true;
  });

  // userCompleted batch — 진입당 1회 (N+1 → 1)
  if (!state.userCompMap) {
    const map = new Map();
    try {
      const compSnap = await getDocs(query(
        collectionGroup(db, 'userCompleted'),
        where('uid', '==', myUid)
      ));
      compSnap.docs.forEach(d => {
        const testId = d.ref.parent.parent.id;
        map.set(testId, d.data());
      });
    } catch(e) { console.warn('[recAi] userCompleted batch:', e.message); }
    state.userCompMap = map;
  }
  const userCompMap = state.userCompMap;

  const completedMap = new Map();
  const inProgressMap = new Map();
  myTests.forEach(t => {
    const cd = userCompMap.get(t.id);
    if (!cd) return;
    if (cd.completedAt || cd.latestFailedAt) {
      completedMap.set(t.id, cd.score ?? null);
    } else if (cd.inProgress?.rounds?.length) {
      inProgressMap.set(t.id, {
        done: cd.inProgress.rounds.length,
        total: cd.inProgress.totalRounds || 0,
      });
    }
  });

  const pending = myTests.filter(t => !completedMap.has(t.id));
  const completed = myTests.filter(t => completedMap.has(t.id));
  const mk = (t, done, score) => {
      const qCount = t.questionCount || t.questions?.length || 0;
      const name = (t.name||'AI 녹음 시험').replace(/'/g,"\\'");
      const onc = done ? `viewRecAiResult('${t.id}')` : `startRecAi('${t.id}','${name}')`;
      // 학생에겐 녹음숙제 점수 비공개 — '✓ 완료' 만 표시 (학원장 화면은 점수 보임)
      const ip = !done ? inProgressMap.get(t.id) : null;
      const badge = done
        ? `<span style="font-size:11px;background:#d1fae5;color:#059669;padding:2px 8px;border-radius:20px;font-weight:700;">✓ 완료</span>`
        : ip
          ? `<span style="font-size:11px;background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:20px;font-weight:700;">▶ 이어서 ${ip.done}/${ip.total}</span>`
          : `<span style="font-size:11px;background:#ede9fe;color:#7c3aed;padding:2px 8px;border-radius:20px;">AI · ${qCount}문장</span>`;
      return `<div class="unit-card" onclick="${onc}">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div class="unit-name">🎙 ${esc(t.name||'AI 녹음 시험')}</div>${badge}
          </div>
          <div class="unit-count">${esc(t.bookName||'')}${t.date?' · '+esc(t.date):''}</div>
        </div>
        <span class="unit-arrow" style="color:${done?'#059669':ip?'#1d4ed8':''};">${done?'📊':ip?'▶':'›'}</span>
      </div>`;
    };

  const loadMoreHtml = state.daysLoaded < 30
    ? `<div style="text-align:center;padding:14px;"><button class="btn btn-secondary" onclick="loadMoreRecAi()" style="font-size:13px;">+ 10일 더 보기 (최근 ${state.daysLoaded}일)</button></div>`
    : `<div style="text-align:center;padding:14px;color:#888;font-size:12px;">최근 30일까지만 표시됩니다</div>`;

  if(elP) elP.innerHTML = (pending.length
    ? pending.map(t => mk(t,false,null)).join('')
    : '<div class="empty-msg" style="padding:20px;color:#bbb;">배정된 숙제가 없습니다.</div>') + loadMoreHtml;
  if(elC) elC.innerHTML = completed.length
    ? completed.map(t => mk(t,true,completedMap.get(t.id))).join('')
    : '<div class="empty-msg" style="padding:20px;color:#bbb;">완료된 숙제가 없습니다.</div>';
}

window.loadMoreRecAi = async() => {
  const state = _testListState.get('recording');
  if (!state || state.daysLoaded >= 30) return;
  state.daysLoaded = Math.min(30, state.daysLoaded + 10);
  try { await _loadRecAiListPage(); } catch(e) { console.error('loadMoreRecAi:', e); }
};

const updateRecBadge = () => _updateAllBadgesAtOnce();

let _raState = {
  test: null,
  questions: [],
  currentIdx: 0,
  recordings: [],
  mediaRecorder: null,
  stream: null,
  chunks: [],
  isRecording: false,
  timerInterval: null,
  timerStart: 0,
};
window.startRecAi = async (testId, testName) => {
  try{
    const snap = await getDoc(doc(db,'genTests',testId));
    if(!snap.exists()){ showToast('시험 정보를 불러올 수 없어요.'); return; }
    const test = { id: testId, ...snap.data() };
    const questions = (test.questions || []).filter(q => q.type === 'recording' || q.sentence);
    if(questions.length === 0){ showToast('녹음할 문장이 없습니다.'); return; }

    // 마이크 권한 사전 체크 (차단 모달, 재시도 자동 진입)
    const micOk = await _checkMicSupport({ needSpeech: false });
    if (!micOk) return;

    // Phase 5.5: schemaV===2 감지 → v2 플로우로 분기
    const firstQ = questions[0];
    if(firstQ?.schemaV === 2){
      // 이미 완료된 경우 재시험 불가 → 결과 보기로 전환
      // 단 Phase A+ : inProgress 만 있는 경우(중간 저장) 는 이어서 진행해야 하므로 우회 안 함
      if(currentUser){
        try{
          const compSnap = await getDoc(doc(db,'genTests',testId,'userCompleted',currentUser.uid));
          if(compSnap.exists()){
            const cd = compSnap.data();
            const alreadySubmitted = !!cd.completedAt || !!cd.latestFailedAt;
            if (alreadySubmitted) {
              showToast('이미 제출한 시험이에요. 결과를 표시합니다.');
              return viewRecAiResult(testId);
            }
            // inProgress 만 — _raStartV2 로 진입 (안에서 자동 복원)
          }
        }catch(e){ console.warn('완료 확인 실패', e); }
      }
      return _raStartV2(test, firstQ);
    }

    _screenPrepare('recAiQuiz', '#raProgressBar');

    _raState = {
      test,
      questions,
      currentIdx: 0,
      recordings: questions.map(() => null),
      mediaRecorder: null,
      stream: null,
      chunks: [],
      isRecording: false,
      timerInterval: null,
      timerStart: 0,
    };

    show('recAiQuiz');
    _acquireWakeLock();
    _raRenderStep();
  }catch(e){
    console.error(e);
    showToast('시험 시작 실패: ' + e.message);
  }
};

function _raRenderStep(){
  const s = _raState;
  const q = s.questions[s.currentIdx];
  if(!q) return;

  const pct = Math.round(((s.currentIdx+1) / s.questions.length) * 100);
  const bar = document.getElementById('raProgressBar');
  const txt = document.getElementById('raProgressText');
  if(bar) bar.style.width = pct + '%';
  if(txt) txt.textContent = `${s.currentIdx+1} / ${s.questions.length}`;

  const qKoEl = document.getElementById('raQuestionKo');
  if(qKoEl) qKoEl.textContent = q.questionKo || '다음 문장을 큰 소리로 읽고 녹음하세요.';
  const sentEl = document.getElementById('raSentence');
  if(sentEl) sentEl.textContent = q.sentence || '';

  _raResetRecordingUI();

  const existing = s.recordings[s.currentIdx];
  if(existing?.url){
    const audio = document.getElementById('raAudio');
    if(audio) audio.src = existing.url;
    const playback = document.getElementById('raPlaybackArea');
    if(playback) playback.style.display = 'block';
    const next = document.getElementById('raNextBtn');
    if(next){
      next.disabled = false;
      next.style.background = s.currentIdx === s.questions.length-1 ? '#059669' : '#8B5CF6';
      next.style.color = 'white';
      next.style.cursor = 'pointer';
      next.textContent = s.currentIdx === s.questions.length-1 ? '제출하기' : '다음';
    }
  }
}

function _raResetRecordingUI(){
  const btn = document.getElementById('raRecBtn');
  if(btn){ btn.style.background = '#8B5CF6'; btn.textContent = '🎤'; }
  const status = document.getElementById('raRecStatus');
  if(status) status.textContent = '버튼을 눌러 녹음 시작';
  const timer = document.getElementById('raRecTimer');
  if(timer) timer.textContent = '00:00';
  const playback = document.getElementById('raPlaybackArea');
  if(playback) playback.style.display = 'none';
  const next = document.getElementById('raNextBtn');
  if(next){
    next.disabled = true;
    next.style.background = '#ddd';
    next.style.color = '#888';
    next.style.cursor = 'not-allowed';
    next.textContent = '녹음 후 다음';
  }
}

window.raToggleRecord = async () => {
  const s = _raState;
  if(s.isRecording) await _raStopRecording();
  else await _raStartRecording();
};

async function _raStartRecording(){
  const s = _raState;
  try{
    s.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm');
    s.mediaRecorder = new MediaRecorder(s.stream, { mimeType: mime });
    s.chunks = [];

    s.mediaRecorder.ondataavailable = (e) => {
      if(e.data.size > 0) s.chunks.push(e.data);
    };
    s.mediaRecorder.onstop = () => _raFinalizeRecording(mime);

    s.mediaRecorder.start();
    s.isRecording = true;
    s.timerStart = Date.now();

    const btn = document.getElementById('raRecBtn');
    if(btn){ btn.style.background = '#dc2626'; btn.textContent = '⏹'; }
    const status = document.getElementById('raRecStatus');
    if(status) status.textContent = '녹음 중... 버튼 눌러 종료';

    s.timerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - s.timerStart) / 1000);
      const mm = String(Math.floor(sec/60)).padStart(2,'0');
      const ss = String(sec%60).padStart(2,'0');
      const t = document.getElementById('raRecTimer');
      if(t) t.textContent = `${mm}:${ss}`;
      if(sec >= 120){ _raStopRecording(); }
    }, 200);
  }catch(e){
    console.error(e);
    showToast('마이크 접근 실패: ' + (e.message || '권한을 허용해주세요'));
  }
}

async function _raStopRecording(){
  const s = _raState;
  if(!s.mediaRecorder || !s.isRecording) return;
  s.mediaRecorder.stop();
  s.stream?.getTracks()?.forEach(t => t.stop());
  s.isRecording = false;
  if(s.timerInterval){ clearInterval(s.timerInterval); s.timerInterval = null; }
}

function _raFinalizeRecording(mime){
  const s = _raState;
  const blob = new Blob(s.chunks, { type: mime });
  const url = URL.createObjectURL(blob);
  const duration = Math.floor((Date.now() - s.timerStart) / 1000);

  s.recordings[s.currentIdx] = { audioBlob: blob, duration, url, mime };

  const btn = document.getElementById('raRecBtn');
  if(btn){ btn.style.background = '#8B5CF6'; btn.textContent = '🎤'; }
  const status = document.getElementById('raRecStatus');
  if(status) status.textContent = '✓ 녹음 완료 · 아래 재생해보세요';
  const audio = document.getElementById('raAudio');
  if(audio) audio.src = url;
  const playback = document.getElementById('raPlaybackArea');
  if(playback) playback.style.display = 'block';
  const next = document.getElementById('raNextBtn');
  if(next){
    next.disabled = false;
    next.style.background = s.currentIdx === s.questions.length-1 ? '#059669' : '#8B5CF6';
    next.style.color = 'white';
    next.style.cursor = 'pointer';
    next.textContent = s.currentIdx === s.questions.length-1 ? '제출하기' : '다음';
  }
}

window.raRestart = () => {
  const s = _raState;
  const existing = s.recordings[s.currentIdx];
  if(existing?.url) URL.revokeObjectURL(existing.url);
  s.recordings[s.currentIdx] = null;
  _raResetRecordingUI();
};

window.raNext = async () => {
  const s = _raState;
  if(s.currentIdx < s.questions.length - 1){
    s.currentIdx++;
    _raRenderStep();
  } else {
    await _raSubmit();
  }
};

async function _raSubmit(){
  const s = _raState;
  const t = s.test;
  if(!t || !currentUser) return;
  if (s._submitted || s._submitting) return;
  s._submitting = true;

  const missing = s.recordings.findIndex(r => !r);
  if(missing !== -1){
    s._submitting = false;  // 가드 해제 — 사용자가 다시 시도
    const ok = await showConfirm(`${missing+1}번 문제가 녹음되지 않았어요`, '되돌아가서 녹음하시겠어요?');
    if(ok){
      s.currentIdx = missing;
      _raRenderStep();
    }
    return;
  }

  const screen = document.getElementById('recAiQuiz');
  const sc = screen?.querySelector('.scroll-content');
  if(sc){
    sc.innerHTML = `
      <div style="padding:60px 20px;text-align:center;">
        <div style="font-size:48px;margin-bottom:12px;">⬆️</div>
        <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">업로드 중...</div>
        <div id="raUploadProgress" style="font-size:12px;color:var(--gray);">0 / ${s.questions.length}</div>
      </div>`;
  }

  try{
    const storage = getStorage();
    const uploadedUrls = [];
    for(let i = 0; i < s.recordings.length; i++){
      const rec = s.recordings[i];
      const ext = rec.mime.includes('mp4') ? 'm4a' : 'webm';
      const path = `recordings/genTests/${t.id}/${currentUser.uid}/q${i+1}_${Date.now()}.${ext}`;
      const r = ref(storage, path);
      await uploadBytes(r, rec.audioBlob);
      const url = await getDownloadURL(r);
      uploadedUrls.push({ questionIdx: i, sentence: s.questions[i].sentence, url, duration: rec.duration });
      const prog = document.getElementById('raUploadProgress');
      if(prog) prog.textContent = `${i+1} / ${s.questions.length}`;
    }

    const today = _ymdKST();

    await addDoc(collection(db,'scores'), {
      academyId: window.MY_ACADEMY_ID || 'default',
      uid: currentUser.uid,
      userId: currentUser.uid,
      userName: userProfile?.name || '',
      name: userProfile?.name || '',
      group: userProfile?.group || '',
      testId: t.id,
      testName: t.name || '',
      unitId: t.id,
      unitName: t.name || '',
      bookName: t.bookName || '',
      mode: 'recording',
      score: 100,
      correct: s.questions.length,
      wrong: 0,
      total: s.questions.length,
      passed: true,
      passScore: t.passScore ?? 80,
      recordings: uploadedUrls,
      date: today,
      createdAt: serverTimestamp(),
    });

    try{
      await setDoc(
        doc(db,'genTests',t.id,'userCompleted',currentUser.uid),
        {
          uid: currentUser.uid,
          userName: userProfile?.name || '',
          score: 100,
          date: today,
          recordings: uploadedUrls,
          completedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }catch(e){ console.warn('genTest 완료 기록 실패', e); }
    s._submitted = true;
    _raRenderResult(uploadedUrls.length);
  }catch(e){
    console.error(e);
    showToast('업로드 실패: ' + e.message);
    _raRenderStep();
  } finally {
    s._submitting = false;
  }
}

function _raRenderResult(count){
  _releaseWakeLock();
  const screen = document.getElementById('recAiQuiz');
  if(!screen) return;
  _screenSnapshotOnce('recAiQuiz');
  screen.innerHTML = `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;text-align:center;">
      <div style="font-size:72px;margin-bottom:12px;">🎉</div>
      <div style="font-size:22px;font-weight:800;color:var(--text);margin-bottom:4px;">녹음 제출 완료!</div>
      <div style="font-size:13px;color:var(--gray);margin-bottom:24px;">${count}개 문장 녹음이 저장되었어요</div>
      <div style="background:white;border-radius:16px;padding:20px 28px;box-shadow:0 2px 8px rgba(0,0,0,0.08);margin-bottom:20px;">
        <div style="font-size:12px;color:var(--gray);">선생님이 확인 후 피드백을 주실 거예요</div>
      </div>
      <div style="display:flex;gap:10px;width:100%;max-width:320px;">
        <button onclick="goHome()" style="flex:1;padding:14px;background:#8B5CF6;border:none;border-radius:12px;font-size:14px;font-weight:700;color:white;cursor:pointer;">홈으로</button>
      </div>
    </div>
  `;
}

window.quitRecAi = async () => {
  const s = _raState;
  if(s.isRecording) await _raStopRecording();
  if(!(await showConfirm('녹음을 중단할까요?','지금까지의 녹음은 저장되지 않습니다.'))) return;
  s.recordings.forEach(r => r?.url && URL.revokeObjectURL(r.url));
  goHome();
};

// ═══════════════════════════════════════════════════════════════════════════
// 녹음숙제 v2 — N회 반복 + 무결성 클라 검증 + 마지막 라운드만 AI 평가 (Phase 5.5+)
// 흐름: IDLE → RECORDING → PRE-CHECK → [PASS: SAVED | FAIL: ALERT 유지] → 다음 회차
//        N회 다 SAVED → SUBMITTING (마지막 라운드만 업로드+AI) → RESULT
//        AI 점수 < 통과점수 → 마지막 라운드만 다시 녹음 가능
// ═══════════════════════════════════════════════════════════════════════════

let _rv2 = {
  test: null,
  question: null,
  totalRounds: 3,         // q.recordingCount 동적 (1~4)
  currentRound: 0,
  savedRounds: [],
  currentTake: null,
  stream: null,
  mediaRecorder: null,
  chunks: [],
  isRecording: false,
  timerInterval: null,
  timerStart: 0,
  alertMessage: null,     // persistent 알림 — pre-check fail 시 세팅, 새 녹음 시작 시 클리어
  retryMode: false,       // AI 점수 미달 후 마지막 라운드 재시도 모드
};
let _rv2ResultAudioUrls = [];

async function _raStartV2(test, question) {
  const totalRounds = Math.max(1, Math.min(parseInt(question?.recordingCount) || 3, 4));

  // Phase A+ : userCompleted.inProgress 복원 (자동 중간 저장)
  let resumedRounds = [];
  let resumedCurrent = 0;
  if (currentUser) {
    try {
      const compSnap = await getDoc(doc(db, 'genTests', test.id, 'userCompleted', currentUser.uid));
      if (compSnap.exists()) {
        const c = compSnap.data();
        const ip = c.inProgress;
        if (ip && Array.isArray(ip.rounds) && ip.rounds.length > 0 && ip.totalRounds === totalRounds) {
          resumedRounds = ip.rounds.map(rd => ({
            blob: null,           // 복원분은 blob 없음 (audioUrl 사용)
            url: null,
            mime: rd.mimeType || 'audio/webm',
            duration: rd.duration || 0,
            voiceActivity: rd.voiceActivity,
            voiceBandRatio: (typeof rd.voiceBandRatio === 'number') ? rd.voiceBandRatio : null,
            monotony: (typeof rd.monotony === 'number') ? rd.monotony : null,
            audioUrl: rd.audioUrl,
            uploaded: true,
            hash: null,
          }));
          resumedCurrent = Math.min(resumedRounds.length, totalRounds - 1);
        }
      }
    } catch (e) { console.warn('[_raStartV2] inProgress 복원 실패', e); }
  }

  _rv2 = {
    test,
    question,
    totalRounds,
    currentRound: resumedCurrent,
    savedRounds: resumedRounds,
    currentTake: null,
    stream: null,
    mediaRecorder: null,
    chunks: [],
    isRecording: false,
    timerInterval: null,
    timerStart: 0,
    alertMessage: null,
    retryMode: false,
  };
  show('recAiQuiz');
  _acquireWakeLock();
  _rv2Render();
  if (resumedRounds.length > 0) {
    showToast(`▶ 이어서 진행 — ${resumedRounds.length}/${totalRounds} 회차 완료됨`);
  }
  // Edge case: 모든 회차 저장 완료됐지만 _rv2Submit 호출 전에 앱 종료된 케이스 → 자동 제출
  if (resumedRounds.length === totalRounds) {
    setTimeout(() => {
      showToast('모든 녹음이 저장되어 있어요. AI 평가를 진행합니다.');
      _rv2Submit();
    }, 800);
  }
}

// Phase A+ : 회차 즉시 Storage 업로드 + userCompleted.inProgress 갱신 (자동 중간 저장)
async function _rv2UploadRound(i) {
  if (!currentUser || !_rv2.test?.id) return;
  const r = _rv2.savedRounds[i];
  if (!r || r.audioUrl) return;  // 이미 업로드된 회차
  if (!r.blob) return;  // 복원분 (blob 없음) — skip
  const storage = getStorage();
  const ext = r.mime?.includes('mp4') ? 'm4a' : 'webm';
  const tsBase = Date.now();
  const path = `recordings/genTests/${_rv2.test.id}/${currentUser.uid}/round${i+1}_${tsBase}_${i}.${ext}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, r.blob);
  const url = await getDownloadURL(fileRef);
  r.audioUrl = url;
  r.uploaded = true;

  // userCompleted.inProgress 갱신 — 모든 업로드된 회차 정보 박음
  try {
    const rounds = _rv2.savedRounds
      .filter(rd => rd && rd.audioUrl)
      .map((rd, ix) => ({
        round: ix + 1,
        audioUrl: rd.audioUrl,
        duration: rd.duration || 0,
        voiceActivity: (typeof rd.voiceActivity === 'number') ? rd.voiceActivity : null,
        voiceBandRatio: (typeof rd.voiceBandRatio === 'number') ? rd.voiceBandRatio : null,
        monotony: (typeof rd.monotony === 'number') ? rd.monotony : null,
        mimeType: rd.mime || '',
      }));
    await setDoc(
      doc(db, 'genTests', _rv2.test.id, 'userCompleted', currentUser.uid),
      {
        uid: currentUser.uid,
        userName: userProfile?.name || '',
        inProgress: {
          rounds,
          totalRounds: _rv2.totalRounds,
          updatedAt: serverTimestamp(),
        },
      },
      { merge: true }
    );
  } catch (e) {
    console.warn('[_rv2UploadRound] inProgress 박기 실패', e);
  }
}

function _rv2FormatDuration(seconds) {
  const s = Math.round(seconds || 0);
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}

// 코랄 헤더 + 단계바 + N회차 카드 + persistent 알림
function _rv2Render() {
  const screen = document.getElementById('recAiQuiz');
  if (!screen) return;
  const q = _rv2.question;
  const cur = _rv2.currentRound;
  const N = _rv2.totalRounds;

  // persistent 알림 (pre-check fail 메시지) — 새 녹음 시작 시 클리어
  const alertHtml = _rv2.alertMessage
    ? `<div id="rv2Alert" style="background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;padding:12px 14px;margin-bottom:12px;">
         <div style="display:flex;gap:8px;align-items:flex-start;">
           <div style="font-size:18px;line-height:1;">⚠️</div>
           <div style="flex:1;font-size:13px;color:#b91c1c;line-height:1.5;font-weight:600;">${esc(_rv2.alertMessage)}</div>
         </div>
       </div>`
    : '';

  // Phase A+ : 직전 회차 말소리 비율·속도 피드백 (회차 끝나면 즉시 박힘, 새 회차 시작해도 유지)
  const lrf = _rv2.lastRoundFeedback;
  const lrfMetrics = lrf && (lrf.vaPct !== null || lrf.wpm > 0)
    ? `${lrf.vaPct !== null ? `말소리 ${lrf.vaPct}%` : ''}${(lrf.vaPct !== null && lrf.wpm > 0) ? ' · ' : ''}${lrf.wpm > 0 ? `속도 ${lrf.wpm} WPM` : ''}`
    : '';
  const lastRoundHtml = lrf
    ? `<div style="background:${lrf.bg};border:1px solid ${lrf.color}33;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:${lrf.color};line-height:1.5;">
        <div><span style="font-weight:700;">${lrf.emoji} 직전 회차</span> — ${esc(lrf.text)}</div>
        ${lrfMetrics ? `<div style="font-size:11px;margin-top:4px;opacity:0.85;font-weight:600;">${lrfMetrics}</div>` : ''}
      </div>`
    : '';

  // Phase A+ : AI 피드백 기준 안내 — 마지막 회차 카드 아래에 항상 표시 (모든 회차 화면)
  const lastInfoHtml = `<div style="background:#f0f9ff;border-left:3px solid #38BDF8;border-radius:6px;padding:8px 12px;margin-top:10px;font-size:11px;color:#075985;line-height:1.5;">
      ℹ️ AI 피드백은 충분히 연습된 <strong>마지막 회차</strong>를 기준으로 합니다.
    </div>`;

  screen.innerHTML = `
    <!-- 코랄 히어로 헤더 + 숙제 내용 -->
    <div style="background:var(--brand-header-gradient);padding:48px 20px 28px;flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <button class="back-btn" style="color:rgba(255,255,255,0.85);font-size:22px;" onclick="rv2Quit()">‹</button>
        <span style="font-size:16px;font-weight:800;color:white;flex:1;">${iconSvg('bot')} AI 녹음숙제</span>
        <button onclick="showRecordingTermsModal()" title="용어 안내" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.35);color:white;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:15px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;">ⓘ</button>
      </div>
      <div style="background:rgba(255,255,255,0.15);border-radius:16px;padding:14px 16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="font-size:10px;color:rgba(255,255,255,0.75);font-weight:600;">숙제 내용</div>
          ${(() => {
            const qMax = q?.maxDurationSec;
            const cfgMax = window.MY_ACADEMY_RECORDING_CFG?.maxDurationSec || 600;
            const maxSec = (typeof qMax === 'number' && qMax > 0) ? Math.min(qMax, 600) : Math.min(cfgMax, 600);
            const qMin = q?.minDurationSec;
            const cfgMin = window.MY_ACADEMY_RECORDING_CFG?.minDurationSec || 60;
            const minSec = (typeof qMin === 'number' && qMin > 0) ? qMin : cfgMin;
            return `<div style="font-size:10px;color:rgba(255,255,255,0.85);font-weight:700;background:rgba(0,0,0,0.18);padding:3px 8px;border-radius:10px;">⏱️ ${minSec}~${maxSec}초</div>`;
          })()}
        </div>
        <div style="font-size:14px;color:white;line-height:1.7;white-space:pre-wrap;">${esc(q.instructionKo || '')}</div>
      </div>
    </div>

    <!-- 바디 -->
    <div style="background:var(--bg);border-radius:24px 24px 0 0;margin-top:-14px;flex:1;overflow:hidden;display:flex;flex-direction:column;">
      <div class="scroll-content" style="padding:16px 16px 24px;">

        ${alertHtml}
        ${lastRoundHtml}

        <!-- N단계 진행 표시 -->
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:16px;">
          ${_rv2RenderStepBar()}
        </div>

        <!-- N개 회차 카드 -->
        ${Array.from({length: N}, (_, i) => _rv2RenderRoundCard(i, cur)).join('')}

        <!-- AI 피드백 기준 안내 — 마지막 회차 카드 아래 항상 표시 -->
        ${lastInfoHtml}

      </div>
    </div>
  `;
}

function _rv2RenderStepBar() {
  const N = _rv2.totalRounds;
  const circleStyle = (i) => {
    if (_rv2.savedRounds[i] != null) return 'background:#059669;color:white;';
    if (i === _rv2.currentRound) return 'background:var(--c-brand);color:white;';
    return 'background:var(--c-brand-cream);color:var(--c-brand);';
  };
  const content = (i) => _rv2.savedRounds[i] != null ? '✓' : (i+1);
  const lineFill = (i) => _rv2.savedRounds[i] != null ? 100 : 0;
  let html = '';
  for (let i = 0; i < N; i++) {
    if (i > 0) html += `<div style="flex:1;height:3px;background:var(--c-brand-cream);border-radius:2px;"><div style="width:${lineFill(i-1)}%;height:3px;background:#059669;border-radius:2px;transition:width .4s;"></div></div>`;
    html += `<div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;${circleStyle(i)}">${content(i)}</div>`;
  }
  return html;
}

function _rv2RenderRoundCard(i, cur) {
  const saved = _rv2.savedRounds[i];
  const isCurrent = (i === cur) && !saved;
  const isFuture = (i > cur);
  const isRecording = isCurrent && _rv2.isRecording;
  const hasTake = isCurrent && !!_rv2.currentTake;
  const isLast = (i === _rv2.totalRounds - 1);

  // 상태 뱃지
  let statusBadge;
  if (saved)           statusBadge = '<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:#d1fae5;color:#059669;font-weight:700;">✓ 저장됨</span>';
  else if (isRecording) statusBadge = '<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:#fee2e2;color:#DC2626;font-weight:700;">● 녹음 중</span>';
  else if (hasTake)     statusBadge = '<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:#FFF5E5;color:#BA7517;font-weight:700;">녹음 완료</span>';
  else if (isCurrent)   statusBadge = '<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:var(--c-brand-cream);color:var(--c-brand);font-weight:700;">진행 중</span>';
  else                  statusBadge = '<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:#f5f5f5;color:#aaa;">대기</span>';

  // 오디오 영역
  let audioHtml = '';
  if (saved) {
    audioHtml = `<div style="margin-bottom:10px;"><audio src="${saved.url}" controls style="width:100%;height:36px;"></audio></div>`;
  } else if (hasTake) {
    audioHtml = `<div style="margin-bottom:10px;"><audio src="${_rv2.currentTake.url}" controls preload="auto" style="width:100%;height:36px;"></audio></div>`;
  }

  // 버튼 영역
  let buttonsHtml = '';
  if (saved) {
    buttonsHtml = `<div style="text-align:center;font-size:11px;color:var(--gray);padding:4px 0;">✓ 저장 완료 · 되돌릴 수 없어요</div>`;
  } else if (isRecording) {
    const isPaused = !!_rv2.isPaused;
    const pauseBtnHtml = isPaused
      ? `<button onclick="rv2ResumeRecord()" style="flex:1;padding:12px;border-radius:12px;border:none;background:#F4936A;color:white;font-size:13px;font-weight:700;cursor:pointer;">▶ 재개</button>`
      : `<button onclick="rv2PauseRecord()" style="flex:1;padding:12px;border-radius:12px;border:none;background:#FFF5E5;color:#BA7517;font-size:13px;font-weight:700;cursor:pointer;">⏸ 일시정지</button>`;
    const pausedBadge = isPaused
      ? `<div style="text-align:center;font-size:11px;color:#BA7517;font-weight:700;margin-top:6px;">일시정지됨 — [재개] 누르면 이어서 녹음됩니다</div>
         <div style="text-align:center;font-size:11px;color:#DC2626;font-weight:700;margin-top:4px;">⚠️ 이 화면을 벗어나면 저장되지 않습니다.</div>`
      : '';
    buttonsHtml = `
      <div style="display:flex;gap:8px;">
        ${pauseBtnHtml}
        <button onclick="rv2StopRecord()" style="flex:1;padding:12px;border-radius:12px;border:none;background:#DC2626;color:white;font-size:13px;font-weight:700;cursor:pointer;">⏹ 녹음 종료</button>
      </div>
      <div id="rv2Timer" style="text-align:center;font-size:14px;font-weight:700;color:var(--text);margin-top:8px;font-variant-numeric:tabular-nums;">00:00</div>
      <!-- 실시간 게인 — 마이크 입력 강도 막대 + 안내 텍스트 (2026-06-28) -->
      <div style="margin-top:10px;padding:8px 10px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:14px;flex-shrink:0;">🎤</span>
          <div style="flex:1;height:8px;background:#e2e8f0;border-radius:6px;overflow:hidden;position:relative;">
            <div id="rv2GainBar" style="height:100%;width:2%;background:#9ca3af;border-radius:6px;transition:width 0.08s ease-out,background 0.2s;"></div>
          </div>
        </div>
        <div id="rv2GainText" style="text-align:center;font-size:11px;color:#9ca3af;margin-top:4px;font-weight:600;">🎤 마이크 준비 중...</div>
      </div>
      ${pausedBadge}
    `;
  } else if (hasTake) {
    buttonsHtml = `
      <div style="display:flex;gap:8px;">
        <button onclick="rv2Retake()" style="flex:1;padding:12px;border-radius:12px;border:none;background:#FFF5E5;color:#BA7517;font-size:13px;font-weight:700;cursor:pointer;">🔄 다시</button>
        <button onclick="rv2SaveRound()" style="flex:1;padding:12px;border-radius:12px;border:none;background:${isLast?'#059669':'#F4936A'};color:white;font-size:13px;font-weight:700;cursor:pointer;">${isLast ? '📤 제출' : '✔ 확인'}</button>
      </div>
    `;
  } else if (isCurrent) {
    buttonsHtml = `
      <div style="display:flex;gap:8px;">
        <button onclick="rv2StartRecord()" style="flex:1;padding:12px;border-radius:12px;border:none;background:var(--c-brand);color:white;font-size:13px;font-weight:700;cursor:pointer;">🎙 녹음</button>
      </div>
    `;
  } else {
    buttonsHtml = `
      <div style="display:flex;gap:8px;">
        <button disabled style="flex:1;padding:12px;border-radius:12px;border:none;background:#e5e7eb;color:#9ca3af;font-size:13px;font-weight:700;cursor:not-allowed;">🎙 녹음</button>
      </div>
    `;
  }

  const cardOpacity = isFuture ? 0.55 : 1;
  return `
    <div style="background:white;border-radius:16px;padding:16px;box-shadow:0 2px 10px rgba(232,113,74,.08);margin-bottom:12px;opacity:${cardOpacity};">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="font-weight:700;font-size:14px;color:#222;">녹음 ${i+1}회차</div>
        ${statusBadge}
      </div>
      ${audioHtml}
      ${buttonsHtml}
    </div>
  `;
}

window.rv2StartRecord = async () => {
  try {
    // 새 녹음 시작 시 persistent 알림 클리어 (학생이 행동했으니 이전 알림 의미 없음)
    _rv2.alertMessage = null;
    _rv2.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm');
    _rv2.mediaRecorder = new MediaRecorder(_rv2.stream, { mimeType: mime });
    _rv2.chunks = [];
    _rv2.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) _rv2.chunks.push(e.data); };
    _rv2.mediaRecorder.onstop = () => _rv2AfterStop(mime);
    _rv2.mediaRecorder.start();
    _rv2.isRecording = true;
    _rv2.isPaused = false;
    _rv2.elapsedSec = 0;
    _rv2.lastTick = Date.now();
    // 디바이스 정보 박음 (학원장 진단용, 학생 비공개) — 2026-06-28
    _rv2.deviceInfo = _rv2BuildDeviceInfo();
    _rv2Render();

    // 실시간 게인 측정 (Web Audio API AnalyserNode + requestAnimationFrame)
    _rv2StartGainMeter();
    _rv2StartTimerLoop();
  } catch(e) {
    console.error(e);
    showToast('마이크 접근 실패: ' + (e.message || '권한을 허용해주세요'));
  }
};

// 디바이스 정보 — userAgent / platform 박음 (학원장 진단·문제 폰 모델 식별용)
function _rv2BuildDeviceInfo() {
  try {
    const ua = (navigator.userAgent || '').slice(0, 200);
    const platform = navigator.platform || '';
    // 간단한 OS·브라우저 추정 (학원장이 즉시 인지 가능하게)
    let os = 'Unknown';
    if (/Android/i.test(ua)) os = 'Android';
    else if (/iPad|iPhone|iPod/i.test(ua)) os = 'iOS';
    else if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Mac/i.test(ua)) os = 'Mac';
    let browser = 'Unknown';
    if (/KAKAOTALK/i.test(ua)) browser = '카카오톡 인앱';
    else if (/SamsungBrowser/i.test(ua)) browser = '삼성 브라우저';
    else if (/Chrome\//i.test(ua) && !/Edg|OPR/i.test(ua)) browser = 'Chrome';
    else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';
    else if (/Edg/i.test(ua)) browser = 'Edge';
    return { ua, platform, os, browser };
  } catch (_) { return null; }
}

// 실시간 게인 측정 — AnalyserNode → RMS → UI 막대 갱신
// 음성 강도 낮으면 학생에게 안내 ("마이크 확인 후 다시 녹음")
function _rv2StartGainMeter() {
  _rv2StopGainMeter();
  if (!_rv2.stream) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    _rv2.audioCtx = new Ctx();
    const source = _rv2.audioCtx.createMediaStreamSource(_rv2.stream);
    const analyser = _rv2.audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    _rv2.analyser = analyser;
    _rv2.gainBuf = new Uint8Array(analyser.frequencyBinCount);
    _rv2.lowVoiceStreakMs = 0;          // 낮은 음량 연속 시간
    _rv2.lowVoiceAlerted = false;       // 안내 모달 1회만
    _rv2.lastGainTick = performance.now();

    const loop = () => {
      if (!_rv2.isRecording || !_rv2.analyser) { _rv2.gainAnimFrame = null; return; }
      _rv2.analyser.getByteTimeDomainData(_rv2.gainBuf);
      // RMS — 0~127 범위 (Uint8 1byte 중앙=128)
      let sum = 0;
      for (let i = 0; i < _rv2.gainBuf.length; i++) {
        const v = (_rv2.gainBuf[i] - 128) / 128;  // -1 ~ 1
        sum += v * v;
      }
      const rms = Math.sqrt(sum / _rv2.gainBuf.length);  // 0 ~ 1
      const level = Math.min(100, Math.round(rms * 200));  // 0~100% (보기 좋게 가중)
      _rv2UpdateGainUI(level);

      // 낮은 음량 누적 감지 — 일시정지 중엔 무시
      const now = performance.now();
      const dt = now - (_rv2.lastGainTick || now);
      _rv2.lastGainTick = now;
      if (!_rv2.isPaused) {
        if (level < 5) _rv2.lowVoiceStreakMs += dt;
        else _rv2.lowVoiceStreakMs = 0;
        // 5초 연속 거의 무음 → 1회 안내
        if (!_rv2.lowVoiceAlerted && _rv2.lowVoiceStreakMs >= 5000) {
          _rv2.lowVoiceAlerted = true;
          _rv2NoticeLowVoice();
        }
      }
      _rv2.gainAnimFrame = requestAnimationFrame(loop);
    };
    _rv2.gainAnimFrame = requestAnimationFrame(loop);
  } catch (e) {
    console.warn('[gain] init failed:', e.message);
  }
}

function _rv2StopGainMeter() {
  if (_rv2.gainAnimFrame) { cancelAnimationFrame(_rv2.gainAnimFrame); _rv2.gainAnimFrame = null; }
  if (_rv2.audioCtx) { try { _rv2.audioCtx.close(); } catch(_) {} _rv2.audioCtx = null; }
  _rv2.analyser = null;
  _rv2.gainBuf = null;
}

function _rv2UpdateGainUI(level) {
  const bar = document.getElementById('rv2GainBar');
  const text = document.getElementById('rv2GainText');
  if (!bar) return;
  // 색상 분기 — 낮음 빨강 / 작음 호박 / 정상 초록 (그라데이션)
  let color, label;
  if (level < 5) { color = '#dc2626'; label = '🔇 마이크 소리가 들리지 않아요'; }
  else if (level < 15) { color = '#f59e0b'; label = '🔉 소리가 작아요 — 조금 더 크게'; }
  else if (level < 40) { color = '#22c55e'; label = '🔊 잘 들려요'; }
  else { color = '#16a34a'; label = '🔊 좋아요!'; }
  bar.style.width = Math.max(2, level) + '%';
  bar.style.background = color;
  if (text) { text.textContent = label; text.style.color = color; }
}

// 5초 연속 낮은 음량 — 학생 안내 + 재녹음 옵션
async function _rv2NoticeLowVoice() {
  const proceed = await showConfirm(
    '🔇 마이크 소리가 들리지 않아요',
    '5초 동안 거의 무음이에요. 다음을 확인해 보세요:\n\n• 폰 케이스가 마이크 구멍을 막고 있지 않은지\n• 음소거 상태가 아닌지\n• 다른 앱(전화·카톡 음성)을 끄기\n• 폰을 입 가까이 두기 (30cm 이내)\n\n[확인] 다시 녹음 / [취소] 계속 녹음'
  );
  if (proceed) {
    // 다시 녹음 — 현재 녹음 중단 후 초기화
    if (_rv2.mediaRecorder && _rv2.isRecording) {
      try { _rv2.mediaRecorder.stop(); } catch(_) {}
    }
    _rv2.isRecording = false;
    _rv2StopGainMeter();
    _rv2.chunks = [];
    _rv2.elapsedSec = 0;
    showToast('마이크 확인 후 다시 [🎙 녹음] 눌러 주세요');
    _rv2Render();
  } else {
    // 그래도 계속 — 다시 감지 시작 (한 번 더 누적될 수 있음)
    _rv2.lowVoiceStreakMs = 0;
    _rv2.lowVoiceAlerted = false;  // 다시 5초 누적되면 또 안내
  }
}

// 타이머 — elapsedSec 누적 (일시정지 시 멈춤). 250ms 마다 갱신
function _rv2StartTimerLoop() {
  if (_rv2.timerInterval) clearInterval(_rv2.timerInterval);
  _rv2.timerInterval = setInterval(() => {
    if (!_rv2.isRecording || _rv2.isPaused) return;
    const now = Date.now();
    _rv2.elapsedSec += (now - _rv2.lastTick) / 1000;
    _rv2.lastTick = now;
    const sec = Math.floor(_rv2.elapsedSec);
    const el = document.getElementById('rv2Timer');
    if (el) el.textContent = _rv2FormatDuration(sec);
    // 학원장 입력 시험별 옵션 우선 (max 600 cap) — 없으면 학원 default
    const qMax = _rv2.question?.maxDurationSec;
    const cfgMax = window.MY_ACADEMY_RECORDING_CFG?.maxDurationSec || 600;
    const maxSec = (typeof qMax === 'number' && qMax > 0) ? Math.min(qMax, 600) : Math.min(cfgMax, 600);
    if (sec >= maxSec) {
      showToast(`최대 녹음 시간 (${Math.round(maxSec/60)}분) 도달 — 자동 종료됐어요. 제출하거나 다시 녹음하세요.`);
      rv2StopRecord();
    }
  }, 250);
}

window.rv2PauseRecord = () => {
  if (!_rv2.mediaRecorder || !_rv2.isRecording || _rv2.isPaused) return;
  try { _rv2.mediaRecorder.pause(); } catch (e) { console.warn('pause:', e); }
  // 일시정지 직전까지의 경과 시간 누적 마무리
  const now = Date.now();
  _rv2.elapsedSec += (now - _rv2.lastTick) / 1000;
  _rv2.lastTick = now;
  _rv2.isPaused = true;
  _rv2Render();
};

window.rv2ResumeRecord = () => {
  if (!_rv2.mediaRecorder || !_rv2.isRecording || !_rv2.isPaused) return;
  try { _rv2.mediaRecorder.resume(); } catch (e) { console.warn('resume:', e); }
  _rv2.isPaused = false;
  _rv2.lastTick = Date.now();
  _rv2Render();
};

window.rv2StopRecord = () => {
  if (!_rv2.mediaRecorder || !_rv2.isRecording) return;
  // 일시정지 상태에서 stop 호출도 정상 작동 (MediaRecorder 표준)
  // 최종 elapsedSec 마무리 (일시정지 중이면 lastTick 이후 시간 없으니 += 0)
  if (!_rv2.isPaused) {
    const now = Date.now();
    _rv2.elapsedSec += (now - _rv2.lastTick) / 1000;
  }
  _rv2.mediaRecorder.stop();
  _rv2.stream?.getTracks()?.forEach(t => t.stop());
  _rv2.isRecording = false;
  _rv2.isPaused = false;
  if (_rv2.timerInterval) { clearInterval(_rv2.timerInterval); _rv2.timerInterval = null; }
  _rv2StopGainMeter();   // 게인 측정 종료
};

async function _rv2AfterStop(mime) {
  const blob = new Blob(_rv2.chunks, { type: mime });
  // 일시정지 시간 제외한 실제 녹음 시간 (elapsedSec 누적값)
  const duration = Math.floor(_rv2.elapsedSec || 0);

  // Pre-check (AI 호출 X) — 길이·VAD·hash·일관성·대역·자기상관
  // 시험 단위 q 의 필드 (minDurationSec / maxDurationSec / accuracyThreshold) 우선
  const q = _rv2.question || {};
  const qThreshold = (typeof q.accuracyThreshold === 'number')
    ? (q.accuracyThreshold > 1 ? q.accuracyThreshold / 100 : q.accuracyThreshold)
    : null;
  const check = await _rv2PreCheckRecording(blob, duration, _rv2.savedRounds, qThreshold, {
    minDurationSec: q.minDurationSec,
    maxDurationSec: q.maxDurationSec,
    fullText: q.fullText || '',
  });
  if (!check.ok) {
    // persistent 알림 — 새 녹음 시작 (rv2StartRecord) 까지 화면에 유지
    _rv2.alertMessage = check.reason;
    if (_rv2.currentTake?.url) URL.revokeObjectURL(_rv2.currentTake.url);
    _rv2.currentTake = null;
    _rv2Render();
    return;
  }

  const url = URL.createObjectURL(blob);
  if (_rv2.currentTake?.url) URL.revokeObjectURL(_rv2.currentTake.url);
  _rv2.currentTake = {
    blob, url, mime, duration, hash: check.hash,
    voiceActivity: check.voiceActivity,
    voiceBandRatio: check.voiceBandRatio,   // 학원장 상세 참고용
    monotony: check.monotony,
    warnings: check.warnings || [],         // sanity check — 제출 모달용
  };
  // warning 있으면 안내 표시 (거부 아님 — [저장] 가능). 없으면 알림 제거.
  _rv2.alertMessage = check.warning || null;
  _rv2Render();
}

// 녹음 blob → SHA-256 hex (Web Crypto). 실패 시 빈 문자열.
async function _rv2BlobHash(blob) {
  try {
    const buf = await blob.arrayBuffer();
    const h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) { return ''; }
}

// 녹음 무결성 사전 검사 (AI 호출 없음, 100% 클라이언트)
//   기본: 길이 / VAD (음성 활동 비율)
//   추가:
//     A. Hash 비교 — 이전 라운드와 동일한 녹음 (재제출) 차단
//     B. 다라운드 길이 일관성 — 평균 ± 30% 이상 벗어나면 reject
//     C. 음성 대역 에너지 (300~3400Hz) — 음악·소음 차단
//     D. 자기상관 (간이 spectral entropy) — 단조로운 음 ("아아아") 차단
//   디코드 실패·예외 시 bypass (도구 실패로 학생 막지 않음)
async function _rv2PreCheckRecording(blob, duration, savedRounds, currentThreshold, qOverrides) {
  const cfg = window.MY_ACADEMY_RECORDING_CFG || { minVoiceActivity: 0.4, minDurationSec: 60, maxDurationSec: 600 };
  // 시험 단위 q 의 필드 우선 (시험 배정 시 학원장이 정한 값), 없으면 학원 기본값 폴백
  const minDur = (qOverrides && typeof qOverrides.minDurationSec === 'number') ? qOverrides.minDurationSec : cfg.minDurationSec;
  const maxDur = (qOverrides && typeof qOverrides.maxDurationSec === 'number') ? qOverrides.maxDurationSec : cfg.maxDurationSec;
  const minVA = (typeof currentThreshold === 'number' && currentThreshold > 0)
    ? currentThreshold
    : cfg.minVoiceActivity;

  // 1. 길이 검사
  if (duration < minDur) {
    return { ok: false, reason: `조금 더 길게 읽어볼까요? 최소 ${minDur}초는 필요해요. (현재 ${duration}초)` };
  }
  if (duration > maxDur + 5) {
    return { ok: false, reason: `조금 짧게 줄여볼까요? 최대 ${Math.round(maxDur / 60)}분까지 가능해요.` };
  }

  // 2. Hash 비교 (A) — 이전 라운드와 동일?
  const hash = await _rv2BlobHash(blob);
  if (hash && Array.isArray(savedRounds)) {
    const dup = savedRounds.find(r => r.hash && r.hash === hash);
    if (dup) {
      return { ok: false, reason: '직전 회차와 거의 같은 녹음 같아요. 새로 읽어볼까요?' };
    }
  }

  // 3. (제거됨 2026-05-24) 다라운드 길이 일관성 검사 — 일시정지 시 elapsedSec 가 줄어
  //    이전 회차 평균과 30% 초과 차이로 오판해 제출 거부되던 문제. 학원장 결정으로 검사 폐기.
  //    (일시정지·자연스러운 호흡 차이를 막던 부작용 > 회차별 분량 강제 이득)

  // 4. 오디오 분석 (VAD + 음성 대역 + 자기상관)
  let vadRatio = null, voiceBandRatio = null, monotony = null;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return { ok: true, hash, _bypassed: 'no-audio-ctx' };
    const ctx = new Ctx();
    const arr = await blob.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr);
    const ch = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const winSize = Math.floor(sr * 0.05);
    const RMS_THRESHOLD = 0.012;

    // VAD
    let voiceWindows = 0, totalWindows = 0;
    for (let i = 0; i + winSize <= ch.length; i += winSize) {
      let sum = 0;
      for (let j = 0; j < winSize; j++) sum += ch[i + j] * ch[i + j];
      const rms = Math.sqrt(sum / winSize);
      if (rms > RMS_THRESHOLD) voiceWindows++;
      totalWindows++;
    }
    vadRatio = totalWindows > 0 ? voiceWindows / totalWindows : 0;

    // 음성 대역 에너지 비율 (C) + 단조로움 추정 (D)
    // 5초 간격으로 1024 샘플 윈도우 추출 → DFT 로 주파수 binning → 평균
    // 분석 부하 줄이기 위해 표본 윈도우 N개만
    const FFT_SIZE = 1024;
    const sampleStep = Math.max(FFT_SIZE, Math.floor(sr * 5));  // 5초마다
    const VOICE_LOW = 300, VOICE_HIGH = 3400;
    const voiceLowBin = Math.floor(VOICE_LOW * FFT_SIZE / sr);
    const voiceHighBin = Math.ceil(VOICE_HIGH * FFT_SIZE / sr);

    let totalVoiceEnergy = 0, totalEnergy = 0, entropySum = 0, entropyCount = 0;

    for (let s = 0; s + FFT_SIZE < ch.length; s += sampleStep) {
      // 단순 magnitude DFT (FFT 대용 — 윈도우 1024 샘플이라 부하 작음)
      // 단, 풀 DFT 는 O(N^2) — 1024² = 1M 연산. 수십 표본이면 합리적.
      // 더 빠른 alternative: AnalyserNode (real-time only) 또는 webfft 라이브러리
      // 여기선 적당히 다운샘플 (256 샘플) + DFT
      const DOWN = 256;
      const stride = Math.floor(FFT_SIZE / DOWN);
      const samples = new Float32Array(DOWN);
      for (let i = 0; i < DOWN; i++) samples[i] = ch[s + i * stride] || 0;
      const lowBin = Math.floor(VOICE_LOW * DOWN / (sr / stride));
      const highBin = Math.ceil(VOICE_HIGH * DOWN / (sr / stride));

      // magnitude
      const mag = new Float32Array(DOWN / 2);
      let sumE = 0;
      for (let k = 0; k < DOWN / 2; k++) {
        let re = 0, im = 0;
        for (let n = 0; n < DOWN; n++) {
          const phase = -2 * Math.PI * k * n / DOWN;
          re += samples[n] * Math.cos(phase);
          im += samples[n] * Math.sin(phase);
        }
        const m = Math.sqrt(re * re + im * im);
        mag[k] = m;
        sumE += m;
      }
      let voiceE = 0;
      for (let k = lowBin; k <= highBin && k < mag.length; k++) voiceE += mag[k];
      totalVoiceEnergy += voiceE;
      totalEnergy += sumE;

      // entropy — 정규화된 magnitude 분포의 Shannon entropy
      if (sumE > 1e-6) {
        let h = 0;
        for (let k = 0; k < mag.length; k++) {
          const p = mag[k] / sumE;
          if (p > 1e-9) h -= p * Math.log2(p);
        }
        const maxH = Math.log2(mag.length);
        entropySum += h / maxH;  // 0~1 정규화
        entropyCount++;
      }
    }

    voiceBandRatio = totalEnergy > 0 ? totalVoiceEnergy / totalEnergy : 0;
    monotony = entropyCount > 0 ? 1 - (entropySum / entropyCount) : 0;  // 1=완전 단조, 0=다양
    await ctx.close();
  } catch (e) {
    console.warn('[VAD] 분석 실패 — bypass:', e.message);
    return { ok: true, hash, _bypassed: 'analysis-error' };
  }

  // VAD / 음성 대역(C) / 단조로움(D) — 거부 폐기 (2026-05-29 학원장 결정).
  // 정상 녹음(저가 마이크·조용한 발음·또박또박 읽기)도 막던 부작용 > 부정 차단 이득.
  // 대신 (1) 학생에게 안내 메시지(거부 아님, 저장 가능) (2) 수치는 회차에 저장해 학원장 상세 참고용.
  let warning = null;
  if (voiceBandRatio !== null && voiceBandRatio < 0.40) {
    warning = '말소리 외 다른 소리가 조금 섞인 것 같아요. 다음엔 조용한 곳에서 또렷이 읽으면 더 좋아요. (그대로 저장해도 됩니다)';
  } else if (monotony !== null && monotony > 0.55) {
    warning = '같은 소리가 반복되는 느낌이에요. 다음엔 본문을 차근차근 읽어보세요. (그대로 저장해도 됩니다)';
  }

  // sanity check — 명백 abnormal 케이스 (학생 제출 전 확인 모달 트리거)
  // AI 채점 부정확 사례 다발 (2026-06-27 학원장 보고) — 명백 abnormal 시
  // 학생에게 안내 + 제출 여부 확인 후 진행. 쉬운 안내 문구.
  const warnings = [];
  if (vadRatio !== null && vadRatio < 0.10) {
    warnings.push('녹음 소리가 거의 들리지 않아요. 마이크가 가까운지, 음소거 상태가 아닌지 확인해 주세요.');
  }
  if (voiceBandRatio !== null && voiceBandRatio < 0.30) {
    warnings.push('말소리가 잘 잡히지 않아요. 주변이 시끄럽거나 마이크가 멀리 있는 것 같아요.');
  }
  if (monotony !== null && monotony > 0.70) {
    warnings.push('녹음이 너무 단조로워요. 본문을 차근차근 읽고 있는지 확인해 주세요.');
  }
  if (duration < minDur * 0.5) {
    warnings.push(`녹음이 많이 짧아요. 본문을 끝까지 다 읽었는지 확인해 주세요. (현재 ${duration}초 · 권장 최소 ${minDur}초)`);
  }
  // 본문 단어수 기반 자동 임계 — 학원장 minDurationSec 설정과 별개 (2026-06-27)
  // 본문 일부만 읽거나 반복 읽기 차단. 150 WPM 기준 예상 시간의 30% 미만이면 경고.
  const fullText = (qOverrides && qOverrides.fullText) || '';
  const wordCount = fullText.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount >= 30) {
    const expectedDuration = Math.round((wordCount / 150) * 60);  // 150 WPM
    if (duration < expectedDuration * 0.3 && !warnings.some(w => w.includes('많이 짧'))) {
      warnings.push(`본문을 일부만 읽었거나 반복해서 읽은 것 같아요. 본문 전체를 처음부터 끝까지 차근차근 읽어 주세요. (현재 ${duration}초 · 본문 예상 ${expectedDuration}초)`);
    }
  }

  return { ok: true, hash, voiceActivity: vadRatio, voiceBandRatio, monotony, warning, warnings, wordCount, expectedDuration: wordCount >= 30 ? Math.round((wordCount / 150) * 60) : null };
}

window.rv2Retake = () => {
  if (_rv2.currentTake?.url) URL.revokeObjectURL(_rv2.currentTake.url);
  _rv2.currentTake = null;
  _rv2Render();
};

window.rv2SaveRound = async () => {
  if (!_rv2.currentTake) return;
  // sanity check — 명백 abnormal 측정값 있으면 학생 확인 (2026-06-27)
  // "그래도 제출" 시 통과 / "다시 녹음" 시 currentTake 폐기
  const warnings = _rv2.currentTake.warnings || [];
  if (warnings.length > 0) {
    const list = warnings.map(w => '• ' + w).join('\n');
    const proceed = await showConfirm(
      '⚠️ 녹음 다시 확인해 주세요',
      list + '\n\n그대로 제출할까요? (다시 녹음을 권장해요)'
    );
    if (!proceed) {
      // 다시 녹음 — currentTake 폐기, 회차 카운트는 그대로
      if (_rv2.currentTake?.url) URL.revokeObjectURL(_rv2.currentTake.url);
      _rv2.currentTake = null;
      _rv2.alertMessage = '다시 녹음해 주세요. 위 안내를 참고하면 좋아요.';
      _rv2Render();
      return;
    }
  }
  _rv2.savedRounds.push(_rv2.currentTake);
  _rv2.currentTake = null;
  const idx = _rv2.savedRounds.length - 1;
  const isLast = _rv2.currentRound === _rv2.totalRounds - 1;

  // Phase A+ : 회차 즉시 성실도·속도 피드백 박음 (다음 회차 화면 상단에 표시)
  _rv2.lastRoundFeedback = _rv2BuildRoundMessage(_rv2.savedRounds[idx], idx, _rv2.question?.fullText || '');

  // 회차 즉시 Storage 업로드 (자동 중간 저장)
  if (!isLast) {
    try {
      showToast(`💾 ${idx+1}회차 저장 중...`);
      await _rv2UploadRound(idx);
      showToast(`✓ ${idx+1}회차 저장 완료`);
    } catch (e) {
      console.error('[rv2SaveRound] upload failed', e);
      // 실패해도 메모리상 진행. [제출] 시 _rv2Submit 가 다시 시도.
    }
    _rv2.currentRound++;
    _rv2Render();
    return;
  }

  // 마지막 회차 — 업로드는 _rv2Submit 안 통합 흐름에서 처리
  await _rv2Submit();
};

window.rv2Quit = async () => {
  if (_rv2.isRecording) {
    _rv2.mediaRecorder?.stop();
    _rv2.stream?.getTracks()?.forEach(t => t.stop());
    _rv2.isRecording = false;
    if (_rv2.timerInterval) { clearInterval(_rv2.timerInterval); _rv2.timerInterval = null; }
  }
  // Phase A+ : savedRounds 는 이미 Storage·Firestore 에 자동 저장됨 (이어서 진행 가능)
  // currentTake 는 메모리에만 — 저장 안 됨
  const savedCount = _rv2.savedRounds.filter(r => r?.audioUrl).length;
  const hasCurrentTake = _rv2.currentTake != null;
  if (savedCount > 0) {
    if (!(await showConfirm(
      '녹음 중단',
      `${savedCount}회 녹음이 자동 저장되어 있어요.\n언제든 시험에 다시 들어와서 이어서 진행할 수 있습니다.${hasCurrentTake ? '\n\n(현재 회차 녹음은 저장되지 않습니다)' : ''}`
    ))) return;
  } else if (hasCurrentTake) {
    if (!(await showConfirm('녹음을 중단할까요?', '현재 회차 녹음은 저장되지 않습니다.'))) return;
  }
  _rv2.savedRounds.forEach(r => r?.url && URL.revokeObjectURL(r.url));
  if (_rv2.currentTake?.url) URL.revokeObjectURL(_rv2.currentTake.url);
  goHome();
};

// Gemini 전송 전 오디오 앞부분만 잘라 전송 (토큰 비용 절감)
// 원본 blob 은 Storage 에 그대로 업로드 — Gemini 전송용 사본만 잘림
// 실패 시 원본 blob 반환 (디코딩 불가 포맷 등 폴백)
async function _trimAudioForGemini(blob, maxSeconds) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return blob;
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buf.duration <= maxSeconds) {
      await ctx.close();
      return blob;
    }
    const sr = buf.sampleRate;
    const numCh = Math.min(buf.numberOfChannels, 2);
    const maxSamples = Math.floor(maxSeconds * sr);
    const trimmed = ctx.createBuffer(numCh, maxSamples, sr);
    for (let ch = 0; ch < numCh; ch++) {
      const src = buf.getChannelData(ch);
      const dst = trimmed.getChannelData(ch);
      for (let i = 0; i < maxSamples; i++) dst[i] = src[i];
    }
    const wav = _audioBufferToWav(trimmed);
    await ctx.close();
    console.log(`[trim] ${(blob.size/1024).toFixed(0)}KB → ${(wav.size/1024).toFixed(0)}KB (${buf.duration.toFixed(1)}s → ${maxSeconds}s)`);
    return wav;
  } catch (e) {
    console.warn('[trim] 실패 → 원본 사용:', e.message);
    return blob;
  }
}

function _audioBufferToWav(audioBuffer) {
  const numCh = audioBuffer.numberOfChannels;
  const sr = audioBuffer.sampleRate;
  const bits = 16;
  const len = audioBuffer.length;
  const dataLen = len * numCh * (bits / 8);
  const arr = new ArrayBuffer(44 + dataLen);
  const view = new DataView(arr);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * (bits / 8), true);
  view.setUint16(32, numCh * (bits / 8), true);
  view.setUint16(34, bits, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);
  let off = 44;
  const channels = [];
  for (let ch = 0; ch < numCh; ch++) channels.push(audioBuffer.getChannelData(ch));
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([arr], { type: 'audio/wav' });
}

function _rv2ShowSubmitting(title, subtitle) {
  const screen = document.getElementById('recAiQuiz');
  if (!screen) return;
  screen.innerHTML = `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;text-align:center;">
      <div style="font-size:52px;margin-bottom:16px;">${iconSvg('bot')}</div>
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">${esc(title)}</div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:18px;">${esc(subtitle)}</div>
      <div style="width:200px;height:4px;background:#e5e7eb;border-radius:4px;overflow:hidden;">
        <div style="width:40%;height:100%;background:linear-gradient(90deg,#8B5CF6,#6366F1);animation:rv2Slide 1.3s ease-in-out infinite;"></div>
      </div>
      <style>@keyframes rv2Slide { 0%{margin-left:-40%;} 100%{margin-left:100%;} }</style>
    </div>
  `;
}

// (D) AbortController 로 30초 timeout + (C) 1회 자동 재시도 fetch helper
async function _rv2FetchWithRetry(url, opts, retries = 1) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(tid);
      return res;
    } catch (e) {
      clearTimeout(tid);
      lastErr = e;
      const isAbort = e.name === 'AbortError';
      console.warn(`[rv2 fetch] attempt ${i+1}/${retries+1} failed (${isAbort?'timeout':'error'}):`, e.message);
      if (i === retries) {
        throw new Error(isAbort ? '평가 timeout (30초 초과). 네트워크를 확인하세요' : (e.message || '네트워크 오류'));
      }
      await new Promise(r => setTimeout(r, 5000));  // 5초 대기 후 재시도
    }
  }
  throw lastErr;
}

async function _rv2Submit() {
  if (_rv2.savedRounds.length !== _rv2.totalRounds) {
    showToast(`${_rv2.totalRounds}회 녹음이 모두 필요합니다`);
    return;
  }
  if (_rv2._submitted || _rv2._submitting) return;
  _rv2._submitting = true;
  const t = _rv2.test;
  const q = _rv2.question;
  // 통과점수: 시험의 passScore (학원장이 시험 배정 시 설정)
  const passScore = t.passScore || q.accuracyThreshold || 80;
  if (!currentUser) { _rv2._submitting = false; showToast('로그인이 필요해요'); return; }

  _rv2ShowSubmitting('🎤 녹음 업로드 중...', `${_rv2.totalRounds}개 파일 Storage 에 저장`);

  let stage = 'upload';
  let _retryCount = 0;
  // catch 블록에서도 접근 가능하도록 try 밖에서 선언 (eval 실패 시 학원장 재평가용)
  let recordingsDetail = [];
  try {
    console.log('[rv2Submit] START', { testId: t.id, totalRounds: _rv2.totalRounds });
    const storage = getStorage();
    // 모든 라운드 Storage 업로드 (학원장이 회차별 audio 다 들을 수 있도록).
    // AI 평가는 마지막 라운드만 (정책 그대로 — 비용·일관성).
    const tsBase = Date.now();
    for (let i = 0; i < _rv2.savedRounds.length; i++) {
      const r = _rv2.savedRounds[i];
      // Phase A+ : 이미 자동 업로드된 회차 (rv2SaveRound 에서 업로드 완료) — skip
      if (r.audioUrl) {
        recordingsDetail.push({
          round: i + 1,
          audioUrl: r.audioUrl,
          duration: r.duration || 0,
          voiceActivity: (typeof r.voiceActivity === 'number') ? r.voiceActivity : null,
          voiceBandRatio: (typeof r.voiceBandRatio === 'number') ? r.voiceBandRatio : null,
          monotony: (typeof r.monotony === 'number') ? r.monotony : null,
          ...(_rv2.deviceInfo ? { deviceInfo: _rv2.deviceInfo } : {}),
        });
        continue;
      }
      // 미업로드 회차 — 마지막 회차이거나 자동 업로드 실패 백업
      const ext = r.mime.includes('mp4') ? 'm4a' : 'webm';
      const path = `recordings/genTests/${t.id}/${currentUser.uid}/round${i+1}_${tsBase}_${i}.${ext}`;
      const fileRef = ref(storage, path);
      console.log(`[rv2Submit] upload round${i+1} → ${path} (${r.blob.size} bytes)`);
      await uploadBytes(fileRef, r.blob);
      const url = await getDownloadURL(fileRef);
      r.audioUrl = url;
      recordingsDetail.push({
        round: i + 1,
        audioUrl: url,
        duration: r.duration || 0,
        voiceActivity: (typeof r.voiceActivity === 'number') ? r.voiceActivity : null,
        voiceBandRatio: (typeof r.voiceBandRatio === 'number') ? r.voiceBandRatio : null,
        monotony: (typeof r.monotony === 'number') ? r.monotony : null,
        ...(_rv2.deviceInfo ? { deviceInfo: _rv2.deviceInfo } : {}),
      });
      _rv2ShowSubmitting(`🎤 녹음 업로드 중... (${i+1}/${_rv2.savedRounds.length})`, `Storage 저장`);
    }
    const lastIdx = _rv2.totalRounds - 1;
    const lastRound = _rv2.savedRounds[lastIdx];
    const audioUrl = recordingsDetail[lastIdx].audioUrl;
    console.log('[rv2Submit] all uploads done');

    _rv2ShowSubmitting('🤖 AI 평가 중...', '마지막 회차 분석 + 피드백 생성 (10~20초)\n실패 시 1회 자동 재시도');
    stage = 'eval';

    // 통합 호출 — score + feedback 한 번에
    // Vercel 4.5MB body 한도 회피: base64 인라인 대신 Storage URL 전송 (서버가 fetch)
    const sendMime = lastRound.mime;
    console.log(`[rv2Submit] eval audioUrl=${audioUrl.slice(0, 60)}... mime=${sendMime}`);
    const idToken = currentUser ? await currentUser.getIdToken() : '';
    // 평가구간: q.evaluationSeconds 우선 (시험별), 없으면 0 (전체)
    const evalSec = (typeof q.evaluationSeconds === 'number') ? q.evaluationSeconds : 0;
    // 본문 단어수 + 예상 시간 + 실제 녹음 길이 — AI 가 "본문 일부만 읽은 케이스" 차단용 (2026-06-27)
    const _ftWords = (q.fullText || '').trim().split(/\s+/).filter(Boolean).length;
    const _expectedDur = _ftWords >= 30 ? Math.round((_ftWords / 150) * 60) : null;
    const _actualDur = lastRound.duration || 0;
    const res = await _rv2FetchWithRetry('/api/check-recording', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        originalText: q.fullText,
        audioUrl,           // Storage URL — 서버가 fetch (4.5MB body 한도 회피)
        mimeType: sendMime,
        evaluationSeconds: evalSec,
        wordCount: _ftWords,
        expectedDuration: _expectedDur,
        actualDuration: _actualDur,
      }),
    }, 1);  // 1회 재시도
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(`평가 실패: ${data?.error || res.status}`);
    }
    const score = data.score || 0;
    const missedWords = data.missedWords || [];
    const note = data.note || '';
    const feedback = data.feedback || { missedWords: [], weakPronunciation: [], tips: [], positives: [], intonation: '', stress: '' };
    // Phase C 신규: 카테고리별 점수·코멘트
    const categoryScores = data.categoryScores || null;
    const categoryComments = data.categoryComments || null;
    console.log(`[rv2Submit] eval done: score=${score}`);

    // 마지막 회차 detail 에 AI 평가 결과 추가 (회차별 audio + 마지막에만 평가)
    recordingsDetail[lastIdx].score = score;
    recordingsDetail[lastIdx].missedWords = missedWords;
    recordingsDetail[lastIdx].note = note;
    recordingsDetail[lastIdx].feedback = feedback;
    if (categoryScores) recordingsDetail[lastIdx].categoryScores = categoryScores;
    if (categoryComments) recordingsDetail[lastIdx].categoryComments = categoryComments;
    // 완독률 — 객관적 본문 단어 매칭 비율 (학원장 화면 표시용, 2026-06-27)
    if (typeof data.completionRate === 'number') recordingsDetail[lastIdx].completionRate = data.completionRate;
    if (typeof data.bookWordCount === 'number') recordingsDetail[lastIdx].bookWordCount = data.bookWordCount;
    if (typeof data.heardWordCount === 'number') recordingsDetail[lastIdx].heardWordCount = data.heardWordCount;

    // Phase B : 통과/불통 개념 폐기 — 모든 응시는 "제출 완료" 단일 흐름
    const today = _ymdKST();

    // scores doc — passed 일관 true (학원장은 점수만 본다)
    const scoresPayload = {
      academyId: window.MY_ACADEMY_ID || 'default',
      uid: currentUser.uid,
      userId: currentUser.uid,
      userName: userProfile?.name || '',
      name: userProfile?.name || '',
      group: userProfile?.group || '',
      testId: t.id,
      testName: t.name || '',
      unitId: t.id,
      unitName: t.name || '',
      bookName: t.bookName || '',
      mode: 'recording',
      score,
      correct: 1,
      wrong: 0,
      total: 1,
      passed: true,
      recordings: recordingsDetail,
      date: today,
      createdAt: serverTimestamp(),
    };

    _rv2ShowSubmitting('💾 결과 저장 중...', '곧 결과 화면으로 이동해요');
    stage = 'firestore';

    await addDoc(collection(db,'scores'), scoresPayload);

    try {
      await setDoc(
        doc(db,'genTests',t.id,'userCompleted',currentUser.uid),
        {
          uid: currentUser.uid,
          userName: userProfile?.name || '',
          score,
          passed: true,
          date: today,
          recordings: recordingsDetail,
          completedAt: serverTimestamp(),
          // cleanup — 옛 미통과/에러 마커 제거 (Phase B: 통과/불통 폐기)
          latestFailedScore: deleteField(),
          latestFailedAt: deleteField(),
          latestErrorStage: null,
          latestErrorMessage: null,
          latestAttemptAt: null,
          // Phase A+ : 중간 저장 진행 상태 정리
          inProgress: deleteField(),
        },
        { merge: true }
      );
    } catch(e) { console.warn('genTest 완료 기록 실패', e); }

    _rv2.savedRounds.forEach(r => r?.url && URL.revokeObjectURL(r.url));
    console.log('[rv2Submit] DONE');
    _rv2._submitted = true;
    _rv2RenderResult({ missedWords, note, feedback, audioUrl, recordings: recordingsDetail, fullText: q.fullText, categoryComments });
  } catch(e) {
    console.error(`[rv2Submit] FAILED at stage=${stage}`, e);
    _rv2._submitting = false;  // 재시도 가능하도록

    // (A) 시도 흔적 기록 — 학원장이 '학생 시도했지만 AI/네트워크 실패' 인 걸 볼 수 있도록
    // userCompleted 에 latestAttemptAt + latestErrorStage + latestErrorMessage 박기.
    // 추가: 이미 업로드된 recordings 도 박음 → 학원장 [재평가] 가능
    if (currentUser && t?.id) {
      try {
        const errPayload = {
          uid: currentUser.uid,
          userName: userProfile?.name || '',
          latestAttemptAt: serverTimestamp(),
          latestErrorStage: stage,  // 'upload' / 'eval' / 'firestore'
          latestErrorMessage: (e?.message || String(e) || '').slice(0, 200),
        };
        // Storage 업로드 성공한 부분이라도 박아둠 (eval/firestore 단계 실패 시 모두 채워짐).
        // 학원장이 [🔁 재평가] 누르면 이 audioUrl 로 재시도 가능.
        if (recordingsDetail.length > 0) {
          errPayload.recordings = recordingsDetail;
        }
        await setDoc(
          doc(db,'genTests',t.id,'userCompleted',currentUser.uid),
          errPayload,
          { merge: true }
        );
      } catch(_) {}
    }
    // 화면에 에러 유지 표시 (토스트는 짧게 사라지므로)
    const screen = document.getElementById('recAiQuiz');
    if (screen) {
      screen.innerHTML = `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;text-align:center;">
          <div style="font-size:52px;margin-bottom:14px;">⚠️</div>
          <div style="font-size:17px;font-weight:800;color:#DC2626;margin-bottom:6px;">제출 실패</div>
          <div style="font-size:12px;color:var(--gray);margin-bottom:8px;">단계: <code style="background:#f3f4f6;padding:1px 6px;border-radius:3px;">${esc(stage)}</code></div>
          <div style="font-size:12px;color:var(--text);background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;max-width:340px;word-break:break-word;margin-bottom:16px;">${esc(e.message||String(e))}</div>
          <div style="font-size:11px;color:var(--gray);margin-bottom:20px;max-width:320px;line-height:1.5;">
            네트워크를 확인하거나 관리자에게 문의하세요.<br>
            ※ 녹음 데이터는 메모리에 유지되어 있어요
          </div>
          <div style="display:flex;gap:10px;">
            <button onclick="goHome()" style="padding:12px 18px;background:white;border:1px solid var(--border);border-radius:10px;font-size:13px;font-weight:700;color:var(--text);cursor:pointer;">홈으로</button>
            <button onclick="_rv2Submit()" style="padding:12px 20px;background:#8B5CF6;border:none;border-radius:10px;font-size:13px;font-weight:700;color:white;cursor:pointer;">🔄 다시 시도</button>
          </div>
        </div>
      `;
    } else {
      showToast(`제출 실패 (${stage}): ${e.message}`);
    }
  } finally {
    if (!_rv2._submitted) _rv2._submitting = false;
  }
}

// 재시도 버튼용 전역 노출
window._rv2Submit = _rv2Submit;

// 완료된 v2 시험 결과 재조회 (재시험 불가, Feedback 유지)
window.viewRecAiResult = async (testId) => {
  try {
    if (!currentUser) { showToast('로그인이 필요해요'); return; }
    const [testSnap, compSnap] = await Promise.all([
      getDoc(doc(db,'genTests',testId)),
      getDoc(doc(db,'genTests',testId,'userCompleted',currentUser.uid)),
    ]);
    if (!compSnap.exists()) {
      showToast('완료 기록을 찾을 수 없어요');
      return;
    }
    const completed = compSnap.data();
    const recordings = completed.recordings || [];

    // 새 데이터 모델 (commit 6a538cb): 회차별 audioUrl 모두 + score/feedback 은 마지막 회차에만
    const lastRec = recordings[recordings.length - 1];
    const hasNewData = recordings.length >= 1 && lastRec?.audioUrl && lastRec?.score !== undefined;
    if (!hasNewData) {
      // 옛 데이터 (audio·feedback 없음) — 점수 토스트만
      const oldScore = completed.score ?? completed.latestScore;
      showToast(`완료됨: ${oldScore ?? '-'}점 · ${completed.date || completed.latestAt || ''}`);
      return;
    }

    const test = testSnap.exists() ? testSnap.data() : {};
    const fullText = (Array.isArray(test.questions) && test.questions[0]?.fullText) || '';
    // Phase D: 30일 만료 판정 (학생 재생 차단)
    const completedTs = completed.completedAt || completed.latestFailedAt;
    const audioExpired = _rv2IsAudioExpired(completedTs);

    show('recAiQuiz');
    _rv2RenderResult({
      missedWords: lastRec.missedWords || [],
      note: lastRec.note || '',
      feedback: lastRec.feedback || null,
      audioUrl: lastRec.audioUrl,
      recordings,  // 회차별 audio + 성실도·속도 메시지
      fullText,
      categoryComments: lastRec.categoryComments || null,
      audioExpired,
    });
  } catch(e) {
    console.error(e);
    showToast('결과 불러오기 실패: ' + e.message);
  }
};

// Phase A2 : 영어 단어 클릭 → 발음 재생 (Web Speech API, en-US)
// weakPronunciation.word, issue, tips 안 모든 영단어에 적용
window._playEnglishWord = (word) => {
  if (!window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.85;
    u.pitch = 1.0;
    window.speechSynthesis.speak(u);
  } catch (e) { console.warn('TTS 실패', e); }
};

// 말하기 결과 — 정답 단어 클릭 발음 (클릭마다 보통↔천천히 토글)
let _vqAnsWord = '';
let _vqAnsSlowNext = false;   // false=다음 클릭 보통, true=천천히
window._vqSpeakAnswer = () => {
  const w = _vqAnsWord;
  if (!w || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const slow = _vqAnsSlowNext;
    const u = new SpeechSynthesisUtterance(w);
    u.lang = 'en-US';
    u.rate = slow ? 0.55 : 1.0;   // 보통 1.0 / 천천히 0.55
    u.pitch = 1.0;
    window.speechSynthesis.speak(u);
    _vqAnsSlowNext = !slow;       // 토글
    const hint = document.getElementById('vqSpkAnsHint');
    if (hint) hint.textContent = slow ? '🐢 천천히 — 다시 누르면 보통 속도' : '🔊 보통 — 다시 누르면 천천히';
  } catch (e) { console.warn('TTS 실패', e); }
};

// "X처럼 들렸어요" 같은 한글 음역 멘트 제거 — 의미 없는 표현이라 학생 혼란
// 패턴: "마이티처럼 들렸어요." / "X와 같이 들렸어요." 등
function _cleanIssue(issue) {
  let s = String(issue || '').trim();
  // 앞쪽 음역 멘트 제거 (점·! 다음까지)
  s = s.replace(/^[^.!?]{1,40}처럼\s*들렸[어어]?요[.!?\s]*/, '');
  s = s.replace(/^[^.!?]{1,40}와\s*같[이게]\s*들렸[어어]?요[.!?\s]*/, '');
  s = s.replace(/^[^.!?]{1,40}로\s*들렸[어어]?요[.!?\s]*/, '');
  return s.trim();
}

// esc 한 텍스트 안 영단어를 클릭 가능한 발음 버튼으로 wrap
function _renderInlineWithTTS(text) {
  const escaped = esc(text);
  return escaped.replace(
    /\b([A-Za-z][A-Za-z']{1,})\b/g,
    (m) => `<span onclick="_playEnglishWord('${m.replace(/'/g,"&#39;")}')" style="cursor:pointer;color:#0369a1;text-decoration:underline dotted;text-underline-offset:2px;font-weight:600;" title="발음 듣기">${m}</span>`
  );
}

// 회차별 말소리 비율·속도 분석 메시지
// 우선순위: 말소리 비율 < 40% → 속도 (느림 < 0.8 wps · 빠름 > 3.5 wps) → 격려
// 반환에 vaPct(말소리 비율 %) + wpm(분당 단어 수) 포함 — 학생·학원장 노출용
function _rv2BuildRoundMessage(round, idx, fullText) {
  const va = (typeof round.voiceActivity === 'number') ? round.voiceActivity : null;
  const dur = round.duration || 0;
  const words = (fullText || '').trim().split(/\s+/).filter(Boolean).length;
  const wps = (dur > 0 && words > 0) ? words / dur : 0;
  const wpm = wps > 0 ? Math.round(wps * 60) : 0;
  const vaPct = va !== null ? Math.round(va * 100) : null;
  const n = idx + 1;
  let emoji, text, color, bg;
  if (va !== null && va < 0.4) {
    emoji = '⚠'; color = '#DC2626'; bg = '#fef2f2';
    text = `${n}회차는 끊기거나 말소리가 적었어요. 또렷하게 한 호흡으로 읽어보세요.`;
  } else if (wps > 0 && wps < 0.8) {
    emoji = '🐢'; color = '#CA8A04'; bg = '#fef3c7';
    text = `${n}회차는 천천히 읽었어요. 자연스러운 속도로 읽어보세요.`;
  } else if (wps > 3.5) {
    emoji = '🏃'; color = '#CA8A04'; bg = '#fef3c7';
    text = `${n}회차는 빠르게 읽었어요. 한 단어씩 분명히 읽어주세요.`;
  } else {
    emoji = '👍'; color = '#059669'; bg = '#ecfdf5';
    text = `${n}회차는 잘 읽었어요!`;
  }
  return { emoji, text, color, bg, vaPct, wpm, idx: n };
}

// Phase D: 녹음 audio 만료 판정 (30일 이상 = 학생 재생 차단)
// 기준: userCompleted.completedAt 또는 latestFailedAt
// 학원장은 60일까지 그대로 (Storage 자동 삭제 전까지 접근)
function _rv2IsAudioExpired(completedTs) {
  if (!completedTs) return false;
  const ms = completedTs.toMillis ? completedTs.toMillis() : (completedTs._seconds ? completedTs._seconds * 1000 : 0);
  if (!ms) return false;
  const daysSince = (Date.now() - ms) / (1000 * 60 * 60 * 24);
  return daysSince > 30;
}

// 인포 모달 — 녹음 화면 ⓘ 클릭 시 용어 설명
// 학생앱은 학원장 앱의 동적 showModal 패턴이 없어 자체 overlay 생성/제거
window.closeRecordingTermsModal = () => {
  const el = document.getElementById('recTermsOverlay');
  if (el) el.remove();
};
// ── 마이크·음성인식 사전 체크 (녹음숙제·말하기 시험 진입 전) ───────
// 권한 거부·미지원 시 학생에게 안내 모달 → 학생이 권한 허용 후 [재시도] 시 자동 통과
// resolves: true=통과(시험 진행), false=학생 [돌아가기]
async function _checkMicSupport(opts = {}) {
  const needSpeech = !!opts.needSpeech;  // 말하기 시험만 true (Web Speech API 추가 체크)

  // 1) 브라우저 자체가 API 미지원
  if (!navigator.mediaDevices?.getUserMedia) {
    return _showMicBlockModal({
      title: '브라우저가 마이크를 지원하지 않아요',
      detail: '브라우저를 최신 버전으로 업데이트하거나 다른 브라우저(Chrome / Safari)로 접속해주세요.',
      needSpeech,
    });
  }
  if (needSpeech && !(window.SpeechRecognition || window.webkitSpeechRecognition)) {
    return _showMicBlockModal({
      title: '이 브라우저는 음성 인식을 지원하지 않아요',
      detail: 'iPhone 은 iOS 14.5 이상 필요해요. 폰을 업데이트하거나 Chrome 으로 접속해보세요.',
      needSpeech,
    });
  }

  // 2) 마이크 권한 — getUserMedia 시도. 즉시 stop 해서 LED·자원 해제
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
  } catch (e) {
    const code = e?.name || e?.message || '';
    const denied = /NotAllowed|SecurityError|Permission/i.test(code);
    return _showMicBlockModal({
      title: denied ? '마이크 권한이 차단되어 있어요' : '마이크를 사용할 수 없어요',
      detail: denied
        ? '브라우저 설정 → 마이크 권한 → "허용" 으로 변경 후 [재시도] 해주세요.'
        : '다른 앱이 마이크를 사용 중이거나 폰 자체 문제일 수 있어요. 다른 앱 종료 후 [재시도]·또는 폰을 재시작 해주세요.',
      needSpeech,
    });
  }

  // (Web Speech 실제 작동 체크는 시간 비용 큼 — 시험 중 onerror 로 처리)
  return true;
}

// 차단 모달 — Promise 반환. 학생 [재시도] 시 _checkMicSupport 재호출 → 통과면 true / 실패면 다시 모달
function _showMicBlockModal({ title, detail, needSpeech }) {
  return new Promise((resolve) => {
    // 이미 떠 있으면 제거 (재시도 케이스)
    const existing = document.getElementById('micBlockOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'micBlockOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:white;border-radius:14px;width:min(440px,94vw);max-height:88vh;overflow-y:auto;padding:22px 22px 18px;box-shadow:0 12px 40px rgba(0,0,0,0.25);">
        <div style="font-size:32px;text-align:center;margin-bottom:10px;">🎙️</div>
        <div style="font-size:17px;font-weight:800;text-align:center;margin-bottom:10px;color:#dc2626;">${esc(title)}</div>
        <div style="font-size:13px;color:var(--text);line-height:1.7;margin-bottom:14px;text-align:center;">${esc(detail)}</div>
        <div style="padding:10px 12px;background:#f0f9ff;border-left:3px solid #38BDF8;border-radius:6px;font-size:12px;color:#075985;line-height:1.6;margin-bottom:14px;">
          📢 자세한 해결 방법은 <b>공지사항</b>에 안내되어 있어요. 그래도 안 되면 학원에 알려주세요.
        </div>
        <div style="display:flex;gap:8px;">
          <button id="micBlockBack" style="flex:1;padding:11px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">돌아가기</button>
          <button id="micBlockRetry" style="flex:1.5;padding:11px;background:var(--c-brand);color:white;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">권한 허용 후 재시도</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('micBlockBack').onclick = () => { overlay.remove(); resolve(false); };
    document.getElementById('micBlockRetry').onclick = async () => {
      overlay.remove();
      const ok = await _checkMicSupport({ needSpeech });
      resolve(ok);
    };
  });
}

window.showRecordingTermsModal = () => {
  // 이미 떠 있으면 다시 안 띄움
  if (document.getElementById('recTermsOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'recTermsOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) window.closeRecordingTermsModal();
  });
  overlay.innerHTML = `
    <div style="background:white;border-radius:14px;width:min(520px,94vw);max-height:88vh;overflow-y:auto;padding:18px 22px;box-shadow:0 12px 40px rgba(0,0,0,0.25);">
      <div style="font-size:18px;font-weight:800;margin-bottom:14px;color:var(--text);">📖 용어 안내</div>

      <div style="margin-bottom:18px;">
        <div style="font-size:14px;font-weight:700;color:#0369a1;margin-bottom:6px;">${iconSvg('chart')} 말소리 비율</div>
        <div style="font-size:12px;color:var(--text);line-height:1.7;">
          녹음 시간 중 실제 말소리가 들린 비율입니다.<br>
          <span style="color:#059669;font-weight:600;">70% 이상</span> : 잘 읽음<br>
          <span style="color:#CA8A04;font-weight:600;">50~70%</span> : 보통<br>
          <span style="color:#DC2626;font-weight:600;">40% 미만</span> : 끊기거나 작게 말함
        </div>
      </div>

      <div style="margin-bottom:18px;">
        <div style="font-size:14px;font-weight:700;color:#0369a1;margin-bottom:6px;">🏃 읽기 속도 (WPM)</div>
        <div style="font-size:12px;color:var(--text);line-height:1.7;">
          1분 동안 읽은 단어 수 (Words Per Minute)<br>
          <span style="color:#059669;font-weight:600;">100~180 WPM</span> : 학생 적정 학습 속도<br>
          <span style="color:#94a3b8;font-weight:600;">150 WPM</span> : 영어 원어민 일상 대화<br>
          <span style="color:#CA8A04;font-weight:600;">50 WPM 미만</span> : 너무 느림<br>
          <span style="color:#CA8A04;font-weight:600;">210 WPM 이상</span> : 너무 빠름
        </div>
      </div>

      <div style="padding:10px 12px;background:#f0f9ff;border-left:3px solid #38BDF8;border-radius:6px;font-size:11px;color:#075985;line-height:1.6;">
        💡 두 수치는 각 회차마다 자동으로 측정되어 표시됩니다.<br>
        다음 회차 녹음 시 참고해서 더 또렷하고 자연스러운 속도로 읽어보세요.
      </div>

      <div style="margin-top:16px;text-align:right;">
        <button onclick="closeRecordingTermsModal()" style="padding:10px 18px;background:var(--c-brand);color:white;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">확인</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

// 결과 화면 — "제출 완료" 단일 헤드라인 + 회차별 audio·성실도 메시지 + AI 피드백
// 학생에겐 점수·통과 라벨 비공개 (학원장만 봄). passScore 개념 폐기.
// Phase C: 잘한 점·억양·강세·카테고리별 정성 코멘트 추가
// Phase D: 30일 이상 = audio 재생 차단 (audioExpired=true)
// 보관 정책 안내: 30일 재생
function _rv2RenderResult({ missedWords, note, feedback, audioUrl, recordings, fullText, categoryComments, audioExpired }) {
  _releaseWakeLock();
  const screen = document.getElementById('recAiQuiz');
  if (!screen) return;
  screen.dataset.stage = 'result';  // popstate 뒤로가기 보호 분기 — 결과 보기 중엔 모달 X
  const ft = fullText || _rv2?.question?.fullText || '';
  const hasMultiple = Array.isArray(recordings) && recordings.length > 1;
  // Phase C: feedback 의 새 필드들
  const fbPositives = feedback?.positives || [];
  const fbIntonation = feedback?.intonation || '';
  const fbStress = feedback?.stress || '';
  // 카테고리별 정성 코멘트 (학생에게는 점수 X, 코멘트만)
  const cc = categoryComments || {};
  const hasCategoryComments = !!(cc.pronunciation || cc.intonation || cc.pace || cc.accuracy);

  screen.innerHTML = `
    <div style="flex:1;overflow-y:auto;padding:20px 16px;">

      <div style="background:white;border-radius:16px;padding:28px 20px;box-shadow:0 2px 12px rgba(0,0,0,0.08);text-align:center;margin-bottom:14px;">
        <div style="font-size:64px;margin-bottom:8px;">📤</div>
        <div style="font-size:28px;font-weight:800;color:#059669;">제출 완료</div>
        <div style="font-size:12px;color:var(--gray);margin-top:8px;line-height:1.5;">수고했어요! 아래 피드백을 확인해주세요.</div>
        ${note ? `<div style="margin-top:16px;padding:10px 12px;background:#f8f9fa;border-radius:6px;font-size:12px;color:var(--text);line-height:1.5;">${esc(note)}</div>` : ''}
      </div>

      <div style="background:white;border-radius:14px;padding:14px 16px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        ${audioExpired ? `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="font-size:11px;font-weight:700;color:var(--gray);">🎧 녹음 다시 듣기</div>
            <button onclick="showRecordingTermsModal()" title="용어 안내" style="background:#f0f9ff;border:1px solid #bae6fd;color:#0369a1;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;">ⓘ</button>
          </div>
          <div style="padding:18px 14px;background:#f8f9fa;border:1px dashed #d1d5db;border-radius:8px;text-align:center;">
            <div style="font-size:28px;margin-bottom:6px;">🔒</div>
            <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px;">녹음 다시 듣기 만료</div>
            <div style="font-size:11px;color:var(--gray);line-height:1.5;">제출된 녹음은 30일 동안만 다시 들을 수 있어요.<br>AI 피드백은 계속 확인 가능합니다.</div>
          </div>
        ` : hasMultiple ? `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="font-size:11px;font-weight:700;color:var(--gray);">🎧 회차별 녹음 다시 듣기 (총 ${recordings.length}회)</div>
            <button onclick="showRecordingTermsModal()" title="용어 안내" style="background:#f0f9ff;border:1px solid #bae6fd;color:#0369a1;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;">ⓘ</button>
          </div>
          ${recordings.map((r, i) => {
            const isLast = i === recordings.length - 1;
            const dur = r.duration ? r.duration + '초' : '';
            const msg = _rv2BuildRoundMessage(r, i, ft);
            const vaTxt = msg.vaPct !== null ? `말소리 ${msg.vaPct}%` : '';
            const wpmTxt = msg.wpm > 0 ? `속도 ${msg.wpm} WPM` : '';
            const metricsTxt = [vaTxt, wpmTxt].filter(Boolean).join(' · ');
            const lastTag = isLast ? ' <span style="color:#7C3AED;font-weight:700;">← AI 피드백 기준</span>' : '';
            return `<div style="margin-top:6px;padding:6px 10px;background:#f9fafb;border-radius:6px;">
              <div style="font-size:10px;color:var(--gray);margin-bottom:3px;">${i+1}회차${dur ? ' · ' + dur : ''}${metricsTxt ? ' · ' + metricsTxt : ''}${lastTag}</div>
              <audio src="${esc(r.audioUrl||'')}" controls preload="none" style="width:100%;height:32px;"></audio>
              <div style="margin-top:5px;padding:5px 8px;background:${msg.bg};border-radius:4px;font-size:11px;color:${msg.color};line-height:1.4;">${msg.emoji} ${esc(msg.text)}</div>
            </div>`;
          }).join('')}
        ` : `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="font-size:11px;font-weight:700;color:var(--gray);">🎧 마지막 녹음 다시 듣기</div>
            <button onclick="showRecordingTermsModal()" title="용어 안내" style="background:#f0f9ff;border:1px solid #bae6fd;color:#0369a1;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;">ⓘ</button>
          </div>
          ${(Array.isArray(recordings) && recordings.length === 1) ? (() => {
            const r = recordings[0];
            const dur = r.duration ? r.duration + '초' : '';
            const msg = _rv2BuildRoundMessage(r, 0, ft);
            const vaTxt = msg.vaPct !== null ? `말소리 ${msg.vaPct}%` : '';
            const wpmTxt = msg.wpm > 0 ? `속도 ${msg.wpm} WPM` : '';
            const metricsTxt = [vaTxt, wpmTxt].filter(Boolean).join(' · ');
            return `<div style="font-size:10px;color:var(--gray);margin-bottom:5px;">1회차${dur ? ' · ' + dur : ''}${metricsTxt ? ' · ' + metricsTxt : ''}</div>`;
          })() : ''}
          <audio src="${esc(audioUrl)}" controls preload="none" style="width:100%;height:36px;"></audio>
          ${(Array.isArray(recordings) && recordings.length === 1) ? (() => {
            const msg = _rv2BuildRoundMessage(recordings[0], 0, ft);
            return `<div style="margin-top:8px;padding:6px 10px;background:${msg.bg};border-radius:4px;font-size:11px;color:${msg.color};line-height:1.4;">${msg.emoji} ${esc(msg.text)}</div>`;
          })() : ''}
        `}
      </div>

      ${(hasCategoryComments || fbPositives.length || missedWords?.length || feedback?.missedWords?.length || feedback?.weakPronunciation?.length || feedback?.tips?.length) ? `
        <div style="background:white;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <div style="font-size:11px;font-weight:700;color:#7C3AED;margin-bottom:10px;">${iconSvg('bot')} AI 피드백</div>

          ${hasCategoryComments ? `
            <div style="margin-bottom:12px;">
              <div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:6px;">${iconSvg('chart')} 항목별 코멘트</div>
              <div style="display:grid;grid-template-columns:1fr;gap:4px;">
                ${cc.pronunciation ? `<div style="font-size:11px;padding:6px 10px;background:#eff6ff;border-left:2px solid #3b82f6;border-radius:3px;line-height:1.5;"><strong style="color:#1d4ed8;">🔊 발음</strong> · ${_renderInlineWithTTS(cc.pronunciation)}</div>` : ''}
                ${cc.intonation ? `<div style="font-size:11px;padding:6px 10px;background:#f0fdf4;border-left:2px solid #22c55e;border-radius:3px;line-height:1.5;"><strong style="color:#15803d;">🎵 억양</strong> · ${_renderInlineWithTTS(cc.intonation)}</div>` : ''}
                ${cc.pace ? `<div style="font-size:11px;padding:6px 10px;background:#fefce8;border-left:2px solid #eab308;border-radius:3px;line-height:1.5;"><strong style="color:#a16207;">🏃 속도</strong> · ${_renderInlineWithTTS(cc.pace)}</div>` : ''}
                ${cc.accuracy ? `<div style="font-size:11px;padding:6px 10px;background:#faf5ff;border-left:2px solid #a855f7;border-radius:3px;line-height:1.5;"><strong style="color:#7e22ce;">🎯 정확도</strong> · ${_renderInlineWithTTS(cc.accuracy)}</div>` : ''}
              </div>
            </div>` : ''}

          ${fbPositives.length ? `
            <div style="margin-bottom:12px;">
              <div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:5px;">👍 잘한 점</div>
              ${fbPositives.map(t => `<div style="font-size:12px;padding:5px 10px;background:#ecfdf5;border-left:2px solid #10b981;margin-bottom:3px;border-radius:3px;color:#065f46;line-height:1.5;">${_renderInlineWithTTS(t)}</div>`).join('')}
            </div>` : ''}

          ${(feedback?.missedWords?.length || missedWords?.length) ? `
            <div style="margin-bottom:12px;">
              <div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:5px;">${iconSvg('pen')} 생략된 단어 <span style="font-weight:400;color:#94a3b8;">(클릭하면 발음을 들을 수 있어요)</span></div>
              <div style="font-size:12px;">
                ${(feedback?.missedWords?.length ? feedback.missedWords : missedWords).map(w => `<span onclick="_playEnglishWord('${esc(w).replace(/'/g,"&#39;")}')" style="cursor:pointer;background:#fee2e2;color:#DC2626;padding:2px 8px;border-radius:4px;margin-right:4px;display:inline-block;margin-bottom:3px;font-weight:600;" title="발음 듣기">🔊 ${esc(w)}</span>`).join('')}
              </div>
            </div>` : ''}
          ${feedback?.weakPronunciation?.length ? `
            <div style="margin-bottom:12px;">
              <div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:5px;">🔊 발음 개선 <span style="font-weight:400;color:#94a3b8;">(영단어 클릭 시 발음)</span></div>
              ${feedback.weakPronunciation.map(p => {
                const cleaned = _cleanIssue(p.issue);
                if (!cleaned) return '';
                return `<div style="font-size:12px;padding:6px 10px;background:#fef3c7;border-left:2px solid #CA8A04;margin-bottom:4px;border-radius:3px;">
                  <span onclick="_playEnglishWord('${esc(p.word).replace(/'/g,"&#39;")}')" style="cursor:pointer;background:#fde68a;padding:1px 8px;border-radius:3px;font-weight:700;" title="발음 듣기">🔊 ${esc(p.word)}</span> → ${_renderInlineWithTTS(cleaned)}
                </div>`;
              }).join('')}
            </div>` : ''}
          ${feedback?.tips?.length ? `
            <div>
              <div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:5px;">${iconSvg('lightbulb')} 개선 팁</div>
              ${feedback.tips.map(t => `<div style="font-size:12px;color:var(--text);padding:5px 0;line-height:1.5;">• ${_renderInlineWithTTS(t)}</div>`).join('')}
            </div>` : ''}
        </div>
      ` : ''}

      <div style="padding:10px 14px;background:#f0f9ff;border-left:3px solid #38BDF8;border-radius:6px;margin-bottom:14px;font-size:11px;color:#075985;line-height:1.6;">
        📅 제출된 녹음은 <strong>30일</strong> 동안 다시 들을 수 있어요.
      </div>

      <div style="display:flex;gap:10px;margin-top:16px;">
        <button onclick="goHome()" style="flex:1;padding:14px;background:#8B5CF6;border:none;border-radius:12px;font-size:14px;font-weight:700;color:white;cursor:pointer;">홈으로</button>
      </div>
    </div>
  `;
}

// 미통과 시 마지막 라운드만 다시 녹음
//   - savedRounds 의 마지막 (옛) 녹음 제거 → 마지막 카드가 다시 "녹음 가능" 상태
//   - 정상 흐름으로 녹음 → pre-check → push → 다시 _rv2Submit 호출됨
window.rv2RetryLastRound = () => {
  const lastIdx = _rv2.totalRounds - 1;
  const old = _rv2.savedRounds[lastIdx];
  if (old?.url) URL.revokeObjectURL(old.url);
  _rv2.savedRounds.length = lastIdx;  // 마지막 라운드만 비우기
  _rv2.alertMessage = null;
  _rv2.currentTake = null;
  _rv2.currentRound = lastIdx;
  _rv2.retryMode = false;
  _rv2._submitting = false;
  _rv2._submitted = false;
  _rv2Render();
};


// ── 랭킹 ─────────────────────────────────────────────────
// Phase 6E (2026-04-21) 에서 녹음숙제 탭 제거 → 점수 랭킹 단일 화면.
// switchRankTab / rankHwList 잔재 코드는 2026-04-29 정리 완료.
window.goRanking=async()=>{
  document.getElementById('rankingGroupTitle').textContent='🏫 '+(userProfile?.group||'그룹');
  await renderRanking();show('ranking');
};
// 랭킹 기간 — 'week' | 'month' (default: week). '누적' 폐기 (read 비용 — 2026-05-13)
let _rankPeriod = 'week';

// KST 기준 기간 시작 YYYY-MM-DD 반환.
function _rankPeriodStartYmd(period) {
  const now = new Date(Date.now() + 9 * 3600 * 1000); // KST 변환
  if (period === 'month') {
    return now.toISOString().slice(0, 7) + '-01'; // YYYY-MM-01
  }
  // week — 이번 주 월요일까지 빼기 (월=1, 일=0)
  const dow = now.getUTCDay();
  const diff = dow === 0 ? 6 : dow - 1;
  const monday = new Date(now.getTime() - diff * 86400000);
  return monday.toISOString().slice(0, 10);
}

window.rankingSetPeriod = async (period) => {
  if (!['week','month'].includes(period)) return;
  _rankPeriod = period;
  // 토글 버튼 활성/비활성 시각 갱신
  document.querySelectorAll('#rankPeriodToggle button').forEach(b => {
    const active = b.dataset.period === period;
    b.style.background = active ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.18)';
    b.style.color = active ? 'white' : 'rgba(255,255,255,0.8)';
    b.style.fontWeight = active ? '700' : '600';
  });
  await renderRanking();
};

// 랭킹 일일 snapshot 계산 (lazy generation, 2026-05-13)
// month 시작일 기준 1회 fetch + week 는 client filter → fetch 절감
async function _computeRankingSnapshot(group) {
  const monthStartYmd = _ymdKST().slice(0,7) + '-01';
  const weekStartYmd = _rankPeriodStartYmd('week');

  const usersSnap = await getDocs(query(
    collection(db,'users'),
    where('academyId','==', window.MY_ACADEMY_ID),
    where('group','==', group)
  ));
  const students = usersSnap.docs.map(d => ({uid:d.id, ...d.data()})).filter(u => u.role === 'student');

  const scoresSnap = await getDocs(query(
    collection(db,'scores'),
    where('academyId','==', window.MY_ACADEMY_ID),
    where('group','==', group),
    where('date','>=', monthStartYmd),
    orderBy('date','desc'),
    limit(1000)
  ));

  const buildMap = (startYmd) => {
    const map = {};
    scoresSnap.docs.forEach(d => {
      const s = d.data();
      if ((s.date || '') < startYmd) return;
      if (!map[s.uid]) map[s.uid] = { best: 0, count: 0, total: 0 };
      // 녹음숙제는 best 비교 제외 (점수 비공개 정책). count/total 은 누적
      if (s.mode !== 'recording' && (s.score || 0) > map[s.uid].best) map[s.uid].best = s.score || 0;
      map[s.uid].count++;
      map[s.uid].total += (s.score || 0);
    });
    return map;
  };

  const buildStudents = (map) => students.map(u => ({
    uid: u.uid,
    name: u.name || '',
    best: map[u.uid]?.best || 0,
    count: map[u.uid]?.count || 0,
    total: map[u.uid]?.total || 0,
  })).sort((a, b) => b.best - a.best);

  return {
    week: buildStudents(buildMap(weekStartYmd)),
    month: buildStudents(buildMap(monthStartYmd)),
  };
}

// 학원 랭킹 일일 snapshot — 그날 doc 있으면 read, 없으면 lazy compute + setDoc
// 첫 학생만 50~1000 reads + 1 write, 다른 학생은 1 read 만 (~1/50 추가 절감)
// race 시 두 번째 학생 setDoc 거부 (Rules update:false) → catch + read
async function _loadOrComputeRanking(group) {
  const ymd = _ymdKST();
  const docId = `${window.MY_ACADEMY_ID}_${group}_${ymd}`;
  const ref = doc(db, 'academyRankings', docId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
  } catch(e) { console.warn('[ranking] read:', e.message); }

  const data = await _computeRankingSnapshot(group);
  try {
    await setDoc(ref, {
      academyId: window.MY_ACADEMY_ID,
      group, ymd,
      week: data.week, month: data.month,
      computedAt: serverTimestamp(),
    });
    return data;
  } catch(e) {
    console.warn('[ranking] setDoc fail (race?):', e.message);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) return snap.data();
    } catch(_) {}
    return data;
  }
}

async function renderRanking(){
  const group=userProfile?.group, meUid=currentUser?.uid;
  const listEl = document.getElementById('rankScoreList');
  const podiumEl = document.getElementById('rankPodium');
  if (!group) {
    if (listEl) listEl.innerHTML = '<div class="empty-msg">그룹 정보가 없습니다.</div>';
    return;
  }
  if (listEl) listEl.innerHTML = '<div class="empty-msg" style="padding:30px;color:#aaa;">로딩 중...</div>';

  const data = await _loadOrComputeRanking(group);
  if (!data) {
    if (listEl) listEl.innerHTML = '<div class="empty-msg">랭킹 불러오기 실패</div>';
    return;
  }

  const sorted = data[_rankPeriod] || [];
  const nc=['gold','silver','bronze'];

  // 포디움 (top3)
  if(podiumEl){
    if(sorted.length>0){
      const podOrder=[1,0,2]; // 2등,1등,3등 순서로 배치
      const heights=['36px','52px','24px'];
      const sizes=['38px','44px','38px'];
      podiumEl.innerHTML=podOrder.map((idx,pos)=>{
        const u=sorted[idx]; if(!u) return '';
        const isFirst=idx===0;
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
          ${isFirst?'<div style="font-size:13px;">👑</div>':'<div style="height:18px;"></div>'}
          <div style="width:${sizes[pos]};height:${sizes[pos]};border-radius:50%;background:rgba(255,255,255,${isFirst?'0.35':'0.22'});display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;">${esc((u.name||'?')[0])}</div>
          <div style="font-size:9px;color:rgba(255,255,255,0.9);font-weight:600;max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(u.name)}</div>
          <div style="background:rgba(255,255,255,${isFirst?'0.3':'0.18'});border-radius:8px 8px 0 0;width:56px;height:${heights[pos]};display:flex;align-items:center;justify-content:center;">
            <span style="font-size:10px;font-weight:800;color:white;">${idx+1}위</span>
          </div>
        </div>`;
      }).join('');
    } else {
      podiumEl.innerHTML='';
    }
  }

  if (listEl) listEl.innerHTML=sorted.map((u,i)=>{
    const isMe=u.uid===meUid;
    return `<div class="rank-item${isMe?' me':''}">
      <div class="rank-num ${nc[i]||''}">${i+1}</div>
      <div class="rank-info">
        <div class="rank-name">${esc(u.name)}${isMe?'<span>(나)</span>':''}</div>
        <div style="font-size:11px;color:#aaa;margin-top:1px;">${u.count}회 응시</div>
      </div>
      <div class="rank-score">${u.best}<span style="font-size:11px;color:#aaa;font-weight:400;">점</span></div>
    </div>`;
  }).join('')||'<div class="empty-msg">아직 점수가 없습니다</div>';
}

window.goComingSoon=type=>{
  const info={pronunciation:{title:'발음 평가',emoji:'🎤',name:'발음 평가',desc:'AI가 발음을 분석해 점수를 알려주는\n기능을 준비하고 있어요.'},
    recording:{title:'녹음 숙제',emoji:'🎙',name:'녹음 숙제',desc:'선생님이 내주신 단어를 직접 읽고\n녹음해서 제출하는 기능이에요.'}};
  const i=info[type];
  document.getElementById('comingTitle').textContent=i.title;
  document.getElementById('comingEmoji').textContent=i.emoji;
  document.getElementById('comingName').textContent=i.name;
  document.getElementById('comingDesc').textContent=i.desc;
  show('comingSoon');
};

// (회원가입 기능 제거 — 학원장이 관리자앱에서 직접 학생 등록. 멀티테넌시 정책)


// ── 뒤로가기 (History API 화면 스택) ─────────────────────
const screenStack=[];
const _originalShow=window.show;
const NO_STACK_SCREENS=new Set(['loading','login']);
let _exitToast=null; // 종료 안내 토스트 타이머

// SW 자동 reload (2026-06-05) — 시험 중이면 대기, 다른 화면 전환 시 자동 적용
// 새 sw.js activate 시 SW_UPDATED postMessage 받음 (sw.js 의 activate handler)
const _EXAM_SCREENS = new Set(['vocabQuiz','unscrambleQuiz','recAiQuiz','readingMcq','fillBlank','result']);
function _isInExam(id) { return _EXAM_SCREENS.has(id); }
let _pendingReload = false;
function _trySwReload() {
  if (sessionStorage.getItem('_swReloadDone')) return;
  const id = document.querySelector('.screen.active')?.id;
  if (_isInExam(id)) { _pendingReload = true; return; }
  sessionStorage.setItem('_swReloadDone', '1');
  setTimeout(() => location.reload(), 300);
}
if ('serviceWorker' in navigator) {
  let _swInitialMsg = true;
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'SW_UPDATED') {
      if (_swInitialMsg) { _swInitialMsg = false; return; }
      _trySwReload();
    }
  });
}

window.show=id=>{
  const cur=document.querySelector('.screen.active');
  const curId=cur?.id;
  if(id==='login'||id==='loading'){
    screenStack.length=0;
    history.replaceState({screen:'login'},'',location.pathname);
  } else if(id==='admin'){
    screenStack.length=0;
    history.replaceState({screen:'admin'},'',location.pathname);
    // 관리자 화면에서 뒤로가기 막기용 히스토리 하나 추가
    history.pushState({screen:'admin_block'},'',location.pathname);
  } else if(curId&&curId!==id&&!NO_STACK_SCREENS.has(curId)){
    screenStack.push(curId);
    history.pushState({screen:id},'',location.pathname);
  }
  // 시험 화면 진입 시 dataset.stage 리셋 (이전 결과 보기 마커 제거)
  const newScreen = document.getElementById(id);
  if (newScreen && _isInExam(id)) newScreen.dataset.stage = '';
  _originalShow(id);
  // 시험 화면 벗어났는데 SW reload 대기 중이면 적용
  if (_pendingReload && !_isInExam(id)) _trySwReload();
};

// 시험 유형별 quit 함수 — 상단 X 버튼과 동일 흐름 (중단 확인 + 저장 여부 확인 + goHome)
const _EXAM_QUIT_FNS = {
  vocabQuiz: 'quitVocab',
  recAiQuiz: 'quitRecAi',
  unscrambleQuiz: 'quitUnscramble2',
  readingMcq: 'quitReadingMcq',
  fillBlank: 'quitFillBlank',
};

window.addEventListener('popstate', async e=>{
  const cur=document.querySelector('.screen.active');
  const curId=cur?.id;

  // 시험 화면에서 뒤로가기 → 시험 유형별 quit 함수 호출 (X 버튼과 동일 흐름)
  // 결과 보기 중 (screen.dataset.stage === 'result') 은 제외 — 자연스러운 뒤로가기
  const isResultView = cur?.dataset?.stage === 'result';
  const quitFnName = _EXAM_QUIT_FNS[curId];
  if (quitFnName && !isResultView && typeof window[quitFnName] === 'function') {
    // 즉시 현재 state 복원 — quit 함수의 모달 동안 화면 유지
    history.pushState({screen: curId}, '', location.pathname);
    // quit 함수가 자체 흐름 처리: 중단 확인 → 저장 여부 → goHome()
    // 학생이 첫 모달 [취소] 시 quit 함수가 즉시 종료 → 화면 유지
    window[quitFnName]();
    return;
  }

  // 관리자 화면: 뒤로가기 → 종료 안내
  if(curId==='admin'){
    history.pushState({screen:'admin_block'},'',location.pathname);
    if(_exitToast){
      clearTimeout(_exitToast);
      _exitToast=null;
      history.go(-2); // 실제 앱 종료
      return;
    }
    showToast('한 번 더 누르면 앱이 종료돼요');
    _exitToast=setTimeout(()=>{ _exitToast=null; }, 2500);
    return;
  }

  if(screenStack.length>0){
    const prev=screenStack.pop();
    _originalShow(prev);
    return;
  }

  // 스택 비었을 때 = 홈 또는 로그인에서 뒤로가기
  if(_exitToast){
    clearTimeout(_exitToast);
    _exitToast=null;
    history.go(-1);
    return;
  }
  history.pushState({screen:curId},'',location.pathname);
  showToast('한 번 더 누르면 앱이 종료돼요');
  _exitToast=setTimeout(()=>{ _exitToast=null; }, 2500);
});

// ── PWA 홈화면 추가 ──────────────────────────────────────
let _deferredPrompt=null;

window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  _deferredPrompt=e;
});

// 학생 메인 화면 점3개 메뉴의 [홈화면에 추가] 항목 — standalone 아니면 노출
function _refreshInstallMenuItem() {
  const item = document.getElementById('ddInstallItem');
  if (!item) return;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  item.style.display = isStandalone ? 'none' : 'flex';
}
document.addEventListener('DOMContentLoaded', _refreshInstallMenuItem);
window.addEventListener('beforeinstallprompt', _refreshInstallMenuItem);

window.installApp=async()=>{
  const ua = navigator.userAgent || '';
  // iPad 데스크톱 모드 (iPadOS 13+) — UA 가 'Macintosh' 로 위장. maxTouchPoints 로 검출
  const isIPadDesktop = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || isIPadDesktop;
  const isAndroid = /android/i.test(ua);
  const isStandalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;

  if(isStandalone){
    showToast('이미 앱으로 실행 중이에요!');
    return;
  }
  // Android 크롬 - 설치 프롬프트 사용
  if(_deferredPrompt){
    _deferredPrompt.prompt();
    const {outcome}=await _deferredPrompt.userChoice;
    _deferredPrompt=null;
    if(outcome==='accepted') showToast('홈화면에 추가됐어요! 🎉');
    return;
  }
  // iOS Safari
  if(isIOS){
    alert('📱 홈화면 추가 방법 (iOS)\n\n① 하단 공유 버튼 (□↑)\n② 메뉴에서 "홈 화면에 추가" 선택\n   (안 보이면 [더 보기] 눌러주세요)\n③ 우상단 "추가"\n\n※ Safari 에서 열어주세요\n\n⚠️ 이전에 추가한 아이콘이 있으면\n   먼저 삭제 후 다시 추가하세요');
    return;
  }
  // Android 기타 브라우저
  if(isAndroid){
    alert('📱 홈화면 추가 방법 (Android)\n\n① 브라우저 우상단 메뉴(⋮) 탭\n② "홈 화면에 추가" 또는\n   "앱 설치" 선택\n\n※ 크롬 브라우저를 권장해요\n\n⚠️ 이전에 추가한 아이콘이 있으면\n   먼저 삭제 후 다시 추가하세요');
    return;
  }
  // PC (또는 UA 가 모바일로 인식 안 된 케이스 — iPad 데스크톱 모드 등)
  alert('💻 PC 에서 바로가기 추가\n\n① 크롬 주소창 우측 ⊕ 설치 아이콘 클릭\n  (또는 우상단 ⋮ → "앱 설치")\n② 설치\n\n⚠️ 이전 아이콘 있으면 먼저 삭제 후 추가');
};

window.addEventListener('appinstalled',()=>{
  showToast('앱이 설치됐어요! 🎉');
});

// ── 모바일 키패드 대응 ────────────────────────────────────
function adjustForKeyboard(){
  if(!window.visualViewport) return;
  const vv = window.visualViewport;
  const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);

  // 스펠링 화면: footer가 키패드 위에 위치
  const spelling = document.getElementById('spelling');
  if(spelling){
    spelling.style.bottom = spelling.classList.contains('active') ? keyboardHeight + 'px' : '0';
  }

  // 빈칸채우기 화면: footer(타이머/제출/SKIP)가 키패드 위에 위치
  const fillBlank = document.getElementById('fillBlank');
  if(fillBlank){
    fillBlank.style.bottom = fillBlank.classList.contains('active') ? keyboardHeight + 'px' : '0';
  }

  // 단어시험 v2 (스펠링 모드에서 키패드 노출): footer가 키패드 위
  const vocabQuiz = document.getElementById('vocabQuiz');
  if(vocabQuiz){
    vocabQuiz.style.bottom = vocabQuiz.classList.contains('active') ? keyboardHeight + 'px' : '0';
  }

  // 로그인 화면: 키패드 높이만큼 카드 하단 패딩 확보
  const loginCard = document.querySelector('.login-card');
  const login = document.getElementById('login');
  if(loginCard && login){
    if(login.classList.contains('active') && keyboardHeight > 0){
      loginCard.style.paddingBottom = (keyboardHeight + 24) + 'px';
      const focused = document.activeElement;
      if(focused && (focused.id === 'usernameInput' || focused.id === 'passwordInput')){
        setTimeout(() => focused.scrollIntoView({behavior:'smooth', block:'center'}), 50);
      }
    } else {
      loginCard.style.paddingBottom = '24px';
    }
  }
}

// 기존 함수명 호환용 alias
function adjustSpellingForKeyboard(){ adjustForKeyboard(); }

if(window.visualViewport){
  window.visualViewport.addEventListener('resize', adjustForKeyboard);
  window.visualViewport.addEventListener('scroll', ()=>{
    window.scrollTo(0, 0);
    adjustForKeyboard();
  });
}


// ── 내 정보 변경 ─────────────────────────────────────────
window.goMyInfo=()=>{
  document.getElementById('dd1').classList.remove('open');
  document.getElementById('myName').value=userProfile?.name||'';
  document.getElementById('myParentName').value=userProfile?.parentName||'';
  document.getElementById('myParentPhone').value=userProfile?.parentPhone||'';
  document.getElementById('myNewPw').value='';
  const confirmEl=document.getElementById('myNewPwConfirm');
  if(confirmEl) confirmEl.value='';
  const confirmRow=document.getElementById('myNewPwConfirmRow');
  if(confirmRow) confirmRow.style.display='none';
  // 새 비번 칸 비번 type + 토글 아이콘 리셋 (이전 진입에서 토글한 상태 잔존 방지)
  const pwEl=document.getElementById('myNewPw');
  if(pwEl) pwEl.type='password';
  if(confirmEl) confirmEl.type='password';
  document.querySelectorAll('#myInfo button[onclick^="togglePwVis"]').forEach(b=>{ b.innerHTML=_SVG_EYE; });
  _renderNotifPermBadge();  // 알림 권한 상태 표시
  show('myInfo');
};

// 알림 권한 상태 배지 — 학원장이 학생 폰 잠깐 봐서 즉시 진단 (2026-06-07)
function _renderNotifPermBadge() {
  const el = document.getElementById('notifPermBadge');
  if (!el) return;
  if (!('Notification' in window)) {
    el.style.background = '#f3f4f6';
    el.style.color = '#6b7280';
    el.innerHTML = '<span style="font-weight:600;">알림 — 브라우저 미지원</span><span style="font-size:11px;">옛 브라우저</span>';
    return;
  }
  const perm = Notification.permission;
  if (perm === 'granted') {
    el.style.background = '#dcfce7';
    el.style.color = '#166534';
    el.innerHTML = '<span style="font-weight:700;">알림 ON</span><span style="font-size:11px;">학원 메시지 받음</span>';
  } else if (perm === 'denied') {
    el.style.background = '#fee2e2';
    el.style.color = '#991b1b';
    el.innerHTML = '<span style="font-weight:700;">알림 거부됨</span><span style="font-size:11px;">폰 설정에서 켜기</span>';
  } else {
    el.style.background = '#fef3c7';
    el.style.color = '#92400e';
    el.innerHTML = '<span style="font-weight:700;">알림 미설정</span><button type="button" onclick="requestNotifPerm()" style="font-size:12px;padding:5px 12px;background:#f59e0b;color:white;border:none;border-radius:5px;cursor:pointer;font-weight:700;">알림 받기</button>';
  }
}

window.requestNotifPerm = async () => {
  if (!('Notification' in window)) return;
  try {
    const perm = await Notification.requestPermission();
    _renderNotifPermBadge();
    if (perm === 'granted') {
      // FCM 토큰 발급 시도 — 기존 등록 함수 활용
      if (typeof doRegisterToken === 'function') {
        try { await doRegisterToken(); } catch(_) {}
      }
      showToast('알림 허용됨 — 학원 메시지를 받을 수 있어요');
    } else if (perm === 'denied') {
      showToast('거부됨 — 폰 설정에서 알림 허용 후 다시 켤 수 있어요');
    }
  } catch(e) { console.warn('notif permission:', e); }
};

// 이모지 → SVG 아이콘 헬퍼 (Lucide 풍 stroke) — 2026-06-03 Phase 2
const ICONS = {
  edit:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  pen:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>`,
  search:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  save:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
  settings:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/></svg>`,
  mic:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  clipboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`,
  x:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  chart:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>`,
  bot:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></svg>`,
  lightbulb: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>`,
};
function iconSvg(name, size=16) {
  const svg = ICONS[name] || '';
  return `<span style="display:inline-flex;width:${size}px;height:${size}px;color:currentColor;vertical-align:-3px;">${svg}</span>`;
}
window.iconSvg = iconSvg;

// 비번 보기/숨기기 토글 — 학생앱 (학원장 앱과 별개)
const _SVG_EYE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const _SVG_EYE_OFF = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;
window.togglePwVis = (id, btnEl) => {
  const inp = document.getElementById(id);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  if (btnEl) btnEl.innerHTML = inp.type === 'password' ? _SVG_EYE : _SVG_EYE_OFF;
};

// 새 비번 입력 시 확인 칸 노출 (비우면 다시 숨김)
document.addEventListener('DOMContentLoaded', () => {
  const pw = document.getElementById('myNewPw');
  const row = document.getElementById('myNewPwConfirmRow');
  if (pw && row) {
    pw.addEventListener('input', () => {
      row.style.display = pw.value ? '' : 'none';
      if (!pw.value) {
        const c = document.getElementById('myNewPwConfirm');
        if (c) c.value = '';
      }
    });
  }
});

window.saveMyInfo=async()=>{
  const name=document.getElementById('myName').value.trim();
  const parentName=document.getElementById('myParentName').value.trim();
  const parentPhone=document.getElementById('myParentPhone').value.trim();
  const newPw=document.getElementById('myNewPw').value.trim();
  const newPwConfirm=(document.getElementById('myNewPwConfirm')?.value||'').trim();
  if(!name){showToast('이름을 입력하세요.');return;}
  if(newPw){
    if(newPw.length<6){showToast('비밀번호는 6자 이상이어야 합니다.');return;}
    if(newPw!==newPwConfirm){showToast('비밀번호 확인이 일치하지 않습니다.');return;}
  }
  try{
    await updateDoc(doc(db,'users',currentUser.uid),{name,parentName,parentPhone});
    userProfile.name=name; userProfile.parentName=parentName; userProfile.parentPhone=parentPhone;
    const greetEl=document.getElementById('greetName');
    if(greetEl) greetEl.textContent=name+' 님';
    if(newPw){
      await updatePassword(currentUser,newPw);
      // 비번 변경 이력 박기 (2026-06-03) — 학원장 추적용
      try {
        await updateDoc(doc(db,'users',currentUser.uid),{
          passwordHistory: arrayUnion({
            ts: new Date(),
            actor: 'student_self',
            actorUid: currentUser.uid,
            actorName: userProfile?.name || '',
            method: 'self_change',
          }),
        });
      } catch(e) { console.warn('passwordHistory 기록 실패:', e.message); }
      showToast('✅ 정보와 비밀번호가 변경됐어요!');
    } else {
      showToast('✅ 정보가 저장됐어요!');
    }
    show('home');
  }catch(e){
    if(e.code==='auth/requires-recent-login'){
      showToast('보안을 위해 재로그인 후 비밀번호를 변경해주세요.');
    } else {
      showToast('저장 실패: '+e.message);
    }
  }
};

// ── 초기화 + 자동 로그인 ──────────────────────────────────
const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 1일 = 86400000ms

const savedId = localStorage.getItem('savedId');
if(savedId) document.getElementById('usernameInput').value = savedId;
if(savedId) document.getElementById('saveIdCheck').checked = true;
// 이전 버전에서 저장된 비밀번호 제거
localStorage.removeItem('savedPw');

// 히스토리 초기 설정
history.replaceState({screen:'loading'},'',location.pathname);
history.pushState({screen:'login'},'',location.pathname);

// Firebase Auth 상태 감지 → 1일 이내면 자동 로그인, 초과면 로그아웃
// LexiAI 기본 브랜딩 — onAuthStateChanged 내부에서 첫 호출 시 1회 fetch
// (페이지 로드 즉시 self-executing async 는 Firestore SDK 와 race 유발 — INTERNAL ASSERTION FAILED)
let _lexiFetched = false;

onAuthStateChanged(auth, async (user)=>{
  // 첫 호출 시 LexiAI 기본 브랜딩 fetch (Auth 초기화 후라 race 없음)
  if (!_lexiFetched) {
    _lexiFetched = true;
    try {
      const lexiSnap = await getDoc(doc(db, 'appConfig', 'branding'));
      if (lexiSnap.exists()) {
        window.LEXIAI_BRANDING = lexiSnap.data();
        // 비로그인 시 _applyAcademyBranding 호출 제거 — cache 보존이 우선.
        // 인라인 FOUC script 가 이미 cache 적용했고, cache 비어있으면 HTML default (LexiAI) 그대로.
        // 호출하면 헤더를 LexiAI 로 강제 갈아치워 학원장 cache 가 무시됨.
      }
    } catch (e) { console.warn('[LexiAI branding]', e.message); }
  }

  if(user){
    // 1일 자동 로그아웃 정책 폐기 (2026-06-05) — 사용 중 강제 로그아웃 부작용
    // Firebase Auth 의 자동 토큰 갱신 + persistence local 에 맡김.
    // 학생 분실/실수는 학원장 비번 재설정 (tokensValidAfterTime 갱신)으로 강제 invalidate 가능.
    // 자동 로그인 진입
    try{
      const snap = await getDoc(doc(db,'users',user.uid));
      if(snap.exists()){
        userProfile = {...snap.data(), uid:user.uid};
        currentUser = user;
        await _loadMyAcademyContext(user, snap.data());
        // 활동 시각 갱신
        localStorage.setItem('lastLoginAt', Date.now().toString());
        if(userProfile.role==='admin'){
          localStorage.setItem('adminProfile', JSON.stringify(userProfile));
          window.location.href = '/admin/';
          return;
        } else {
          const greetEl = document.getElementById('greetName');
          if(greetEl) greetEl.textContent = (userProfile.name||'학생')+' 님';
          await loadHomeData();
          _originalShow('home');
          // 미확인 알림 팝업 + 뱃지 (약간 딜레이) — 수동 로그인과 동일 패턴
          setTimeout(async()=>{
            await updateNotifBadge();
            checkUnreadNotifs();
          }, 1500);
          // FCM 토큰 등록
          setTimeout(registerFCMToken, 2000);
          setupForegroundMessage();
        }
        return;
      }
    }catch(e){
      console.log('자동로그인 실패:', e.message);
    }
  }
  // 로그인 안 된 상태 → 로그인 화면
  setTimeout(()=>_originalShow('login'), 1200);
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 6C: 단어시험 v2 (vocab) — genTests(testMode='vocab') 기반
// vocabOptions 를 읽어 매 시작마다 format/direction/shuffle 적용
// ═══════════════════════════════════════════════════════════════════════════

function _rngShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let _vqState = {
  test: null,
  questions: [],
  currentIdx: 0,
  answers: [],   // [{input, direction, format, choices?, correctIdx?}]
  opts: null,
};

// ── 단어시험 중간 저장 (먹통/중단 시 이어풀기) — localStorage, 당일(KST) TTL ──
// 1인1PC 타깃이라 localStorage 가 적절(개인·동기기·학원공유 불필요). 제출 완료/처음부터 선택 시 삭제.
function _vqProgKey(testId) {
  const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || 'anon';
  return `vqProgress_${testId}_${uid}`;
}
function _vqClearProgress(testId) {
  try { if (testId) localStorage.removeItem(_vqProgKey(testId)); } catch (_) {}
}
function _vqSaveProgress() {
  try {
    const s = _vqState;
    if (!s || !s.test || !s.test.id || !Array.isArray(s.answers)) return false;
    localStorage.setItem(_vqProgKey(s.test.id), JSON.stringify({
      v: 1, testId: s.test.id, ymd: _ymdKST(), savedAt: Date.now(),
      currentIdx: s.currentIdx || 0,
      test: s.test, questions: s.questions, answers: s.answers, opts: s.opts,
    }));
    return true;
  } catch (e) { console.warn('[vq] 진행 저장 실패', e); return false; }
}
function _vqLoadProgress(testId) {
  try {
    const raw = localStorage.getItem(_vqProgKey(testId));
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!snap || snap.testId !== testId) return null;
    if (snap.ymd !== _ymdKST()) { _vqClearProgress(testId); return null; }  // 당일만 유효
    if (!Array.isArray(snap.questions) || !Array.isArray(snap.answers) || !snap.questions.length) return null;
    if ((snap.currentIdx || 0) >= snap.questions.length) { _vqClearProgress(testId); return null; }
    return snap;
  } catch (_) { return null; }
}

window.goVocab = async () => {
  show('vocabList');
  await loadVocabList();
};

const loadVocabList = () => _loadTestListByType('vocab');

const _vqMakeCard = (t, isCompleted, onclick, completedScore, latestFailedScore) =>
  _makeTypeCard('vocab', t, isCompleted, onclick, completedScore, latestFailedScore);

window.startVocab = async (testId, testName) => {
  try {
    const snap = await getDoc(doc(db,'genTests',testId));
    if (!snap.exists()) { showToast('시험 정보를 불러올 수 없어요.'); return; }
    const test = { id: testId, ...snap.data() };
    let questions = (test.questions || []).filter(q => q.type === 'vocab');
    if (questions.length === 0) { showToast('문제가 비어있습니다.'); return; }

    // 중간 저장된 진행분 있으면 "이어서 풀까요?" 확인 (없으면 처음부터)
    const _prog = _vqLoadProgress(testId);
    if (_prog) {
      const doneN = _prog.currentIdx || 0;
      const totalN = _prog.questions.length;
      if (await showConfirm('중단된 시험이 있어요', `${totalN}문제 중 ${doneN + 1}번부터 이어서 풀까요? (아니오 = 처음부터 다시)`)) {
        _screenPrepare('vocabQuiz', '#vqProgressBar', () => {
          if (typeof _vqBindSpellInput === 'function') _vqBindSpellInput();
        });
        const rOpts = _prog.opts || {};
        if ((_prog.answers || []).some(a => a && a.format === 'speaking')) {
          const ok = await _checkMicSupport({ needSpeech: true });
          if (!ok) return;
        }
        _vqState = {
          test: _prog.test, questions: _prog.questions,
          currentIdx: Math.min(doneN, totalN - 1),
          answers: _prog.answers, opts: rOpts,
          spk: { attempt: 0, recognition: null, strictness: (rOpts && rOpts.speakingStrictness) || 'normal', gen: 0 },
        };
        show('vocabQuiz');
        _vqRenderStep();
        return;
      }
      _vqClearProgress(testId);   // "처음부터" → 저장분 삭제
    }

    // 원본 템플릿 복원 + 스펠 input 리스너 재바인딩 (복원된 DOM 에는 기존 리스너 없음)
    _screenPrepare('vocabQuiz', '#vqProgressBar', () => {
      if (typeof _vqBindSpellInput === 'function') _vqBindSpellInput();
    });

    // vocabOptions — 신모델(슬라이더 mcqRatio/en2koRatio) + 구모델(format='short'|'mcq', direction) 하위호환
    const _raw = test.vocabOptions || {};
    let _fmt = _raw.format || 'mixed';
    let _mcqRatio = (typeof _raw.mcqRatio === 'number') ? _raw.mcqRatio : 50;
    // 구 형식값 정규화: 주관식(스펠링)=비율0% / 객관식=비율100% → 모두 'mixed' 로 흡수
    if (_fmt === 'short') { _fmt = 'mixed'; _mcqRatio = 0; }
    else if (_fmt === 'mcq') { _fmt = 'mixed'; _mcqRatio = 100; }
    // 영→한 비율: 신필드 우선, 없으면 구 direction 매핑 (en2ko=100 / ko2en=0 / mixed·미설정=50)
    let _en2koRatio;
    if (typeof _raw.en2koRatio === 'number') _en2koRatio = _raw.en2koRatio;
    else if (_raw.direction === 'en2ko') _en2koRatio = 100;
    else if (_raw.direction === 'ko2en') _en2koRatio = 0;
    else _en2koRatio = 50;
    const opts = {
      format: _fmt,                                       // mixed | mixed_mcq_first | mixed_short_first | speaking
      mcqRatio: Math.max(0, Math.min(100, _mcqRatio)),
      en2koRatio: Math.max(0, Math.min(100, _en2koRatio)),
      shuffleQ: _raw.shuffleQ !== false,
      shuffleChoices: _raw.shuffleChoices !== false,
      speakingStrictness: _raw.speakingStrictness || 'normal',
    };
    const isSpeaking = opts.format === 'speaking';

    // 1) 문제 순서 섞기 (재풀이 시에도 매번 새로)
    if (opts.shuffleQ) questions = _rngShuffle(questions);

    // 2) 각 문제에 format/direction 배정 (객·주 선택, 영→한 모두 비율 기반 랜덤)
    let answers = questions.map((q) => {
      const fmt = isSpeaking ? 'speaking' : ((Math.random() * 100 < opts.mcqRatio) ? 'mcq' : 'short');
      let dir = (Math.random() * 100 < opts.en2koRatio) ? 'en2ko' : 'ko2en';
      // 스펠링 쓰기·말하기는 항상 한글→영어
      if (fmt === 'short' || fmt === 'speaking') dir = 'ko2en';
      const ans = { input: '', direction: dir, format: fmt };
      // MCQ 라면 보기 미리 생성 (shuffleChoices 반영)
      if (fmt === 'mcq') {
        const correctText = dir === 'en2ko' ? q.meaning : q.word;
        const pool = questions.filter(x => x !== q);
        const wrongs = _rngShuffle(pool).slice(0, 3)
          .map(w => dir === 'en2ko' ? w.meaning : w.word)
          .filter(x => x && x !== correctText);
        // 부족하면 채우기
        while (wrongs.length < 3) wrongs.push('—');
        let choices = [correctText, ...wrongs.slice(0, 3)];
        if (opts.shuffleChoices) choices = _rngShuffle(choices);
        ans.choices = choices;
        ans.correctIdx = choices.indexOf(correctText);
      }
      return ans;
    });

    // 3) 형식별 출제 순서 정렬 — 객→주 / 주→객 (객·주 선택은 위에서 랜덤, 여기선 그룹 순서만)
    //    같은 그룹 내부는 안정 정렬로 셔플된 순서 그대로 유지. questions·answers 인덱스 동기.
    if (opts.format === 'mixed_mcq_first' || opts.format === 'mixed_short_first') {
      const mcqFirst = opts.format === 'mixed_mcq_first';
      const order = answers
        .map((a, i) => ({ i, mcq: a.format === 'mcq' }))
        .sort((x, y) => x.mcq === y.mcq ? 0 : (mcqFirst ? (x.mcq ? -1 : 1) : (x.mcq ? 1 : -1)));
      questions = order.map(o => questions[o.i]);
      answers = order.map(o => answers[o.i]);
    }

    // speaking 모드 — 마이크 권한 + Web Speech API 사전 체크 (차단 모달, 재시도 자동 진입)
    const hasSpeaking = answers.some(a => a.format === 'speaking');
    if (hasSpeaking) {
      const ok = await _checkMicSupport({ needSpeech: true });
      if (!ok) return;  // 학생 [돌아가기] — 시험 시작 안 함
    }

    _vqState = {
      test, questions, currentIdx: 0, answers, opts,
      spk: { attempt: 0, recognition: null, strictness: opts.speakingStrictness || 'normal', gen: 0 },
    };

    show('vocabQuiz');
    _vqRenderStep();
  } catch(e) {
    console.error(e);
    showToast('시험 시작 실패: ' + e.message);
  }
};

// 구버전 스타일 렌더 (quiz-instruction + word-card + choices/spell-boxes + quiz-footer)
let _vqTimer = null;
let _vqTimeLeft = 10;

function _vqRenderStep() {
  const s = _vqState;
  const q = s.questions[s.currentIdx];
  if (!q) return;

  // 이전 문제의 피드백 배너 감추기
  _vqHideFeedbackBanner();

  // 진행바 + pill
  const pct = Math.round(((s.currentIdx + 1) / s.questions.length) * 100);
  const bar = document.getElementById('vqProgressBar');
  const pill = document.getElementById('vqProgressText');
  if (bar) bar.style.width = pct + '%';
  if (pill) pill.textContent = `${s.currentIdx + 1}/${s.questions.length}`;

  const ans = s.answers[s.currentIdx];
  const instEl = document.getElementById('vqInstruction');
  const labelEl = document.getElementById('vqLabel');
  const promptEl = document.getElementById('vqPrompt');
  const headerHint = document.getElementById('vqHeaderHint');
  const choicesArea = document.getElementById('vqChoicesArea');
  const spellBoxes = document.getElementById('vqSpellBoxes');

  // 지시문
  if (ans.format === 'mcq') {
    if (instEl) instEl.textContent = ans.direction === 'en2ko' ? '뜻과 일치하는 한글을 고르세요.' : '알맞은 영어 단어를 고르세요.';
  } else if (ans.format === 'speaking') {
    if (instEl) instEl.textContent = '🎤 한글 뜻에 해당하는 영어 단어를 발음하세요.';
  } else {
    if (instEl) instEl.textContent = '뜻에 알맞는 영어 단어를 입력하세요.';
  }

  // 주황 헤더: 라벨 + 큰 질문 + (선택적) 힌트
  if (ans.direction === 'en2ko') {
    if (labelEl) labelEl.textContent = '영단어';
    if (promptEl) promptEl.textContent = q.word || '';
    if (headerHint) {
      if (q.example) { headerHint.style.display = ''; headerHint.textContent = '“' + q.example + '”'; }
      else headerHint.style.display = 'none';
    }
    // TTS: 영단어 질문이 뜨면 발음 재생 (학습용)
    if (q.word) _fbSpeakWords([q.word]);
  } else {
    if (labelEl) {
      labelEl.textContent = ans.format === 'short' ? '한글 뜻 (영단어 쓰기)'
                          : ans.format === 'speaking' ? '한글 뜻 (영어로 발음)'
                          : '한글 뜻';
    }
    if (promptEl) promptEl.textContent = q.meaning || '';
    if (headerHint) {
      if (ans.format === 'short') {
        headerHint.style.display = '';
        headerHint.textContent = `힌트: ${(q.word||'').length}글자`;
      } else headerHint.style.display = 'none';
    }
  }

  // 영역 전환: MCQ / 스펠 / 말하기
  // 말하기는 카드 안 vqSpeakArea + 하단 vqSpkLive(실시간 STT) + vqSpkMicZone(마이크 버튼) + footer hintBtn 토글
  const speakArea = document.getElementById('vqSpeakArea');
  const micZone = document.getElementById('vqSpkMicZone');
  const liveZone = document.getElementById('vqSpkLive');
  const hintBtnFooter = document.getElementById('vqSpkHintBtn');
  if (ans.format === 'mcq') {
    if (choicesArea) { choicesArea.style.display = 'flex'; _vqRenderChoices(ans, choicesArea); }
    if (spellBoxes) spellBoxes.style.display = 'none';
    if (speakArea) speakArea.style.display = 'none';
    if (micZone) micZone.style.display = 'none';
    if (liveZone) liveZone.style.display = 'none';
    if (hintBtnFooter) hintBtnFooter.style.display = 'none';
  } else if (ans.format === 'speaking') {
    if (choicesArea) choicesArea.style.display = 'none';
    if (spellBoxes) spellBoxes.style.display = 'none';
    if (speakArea) speakArea.style.display = 'flex';
    if (micZone) micZone.style.display = 'flex';
    if (liveZone) liveZone.style.display = 'none';   // 3차 진입 시에만 표시 — _vqSpkStart 에서 처리
    if (hintBtnFooter) hintBtnFooter.style.display = 'inline-block';   // footer 에 항상 표시 (정답 시도 유지)
    _vqSpkRenderArea();
  } else {
    if (spellBoxes) { spellBoxes.style.display = ''; _vqRenderSpellBoxes(ans); }
    if (choicesArea) choicesArea.style.display = 'none';
    if (speakArea) speakArea.style.display = 'none';
    if (micZone) micZone.style.display = 'none';
    if (liveZone) liveZone.style.display = 'none';
    if (hintBtnFooter) hintBtnFooter.style.display = 'none';
    // 스펠 input 초기화 + 포커스
    const inp = document.getElementById('vqSpellInput');
    if (inp) {
      inp.value = ans.input || '';
      setTimeout(() => {
        try { inp.focus({ preventScroll: true }); } catch(e) { inp.focus(); }
        window.scrollTo(0, 0);
      }, 50);
    }
  }

  _vqUpdateSubmitBtn();
  _vqStartTimer();
}

function _vqRenderChoices(ans, container) {
  const selected = ans.input;
  container.innerHTML = ans.choices.map((opt, j) => `
    <button onclick="vqSelectMcq(${j})"
      style="padding:14px 16px;background:${selected === opt ? 'var(--teal)' : 'white'};border:2px solid var(--teal);color:${selected === opt ? 'white' : 'var(--teal)'};border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 2px 4px rgba(232,113,74,0.15);text-align:left;">
      ${['①','②','③','④'][j]} ${esc(opt)}
    </button>
  `).join('');
}

function _vqRenderSpellBoxes(ans) {
  const boxes = document.getElementById('vqSpellBoxes');
  if (!boxes) return;
  const s = _vqState;
  const q = s.questions[s.currentIdx];
  const target = ans.direction === 'en2ko' ? (q.meaning || '') : (q.word || '');
  const len = target.length;
  const val = ans.input || '';
  const boxW = len > 12 ? 26 : len > 8 ? 30 : 34;
  const fontSize = len > 12 ? 13 : len > 8 ? 15 : 17;
  boxes.innerHTML = Array.from({length:len},(_,i)=>{
    const ch = val[i] || '';
    const cls = ch ? 'spell-box filled' : (i === val.length ? 'spell-box active' : 'spell-box');
    return `<div class="${cls}" onclick="_vqFocusSpellInput()"
      style="width:${boxW}px;height:${boxW+18}px;font-size:${fontSize}px;border-radius:6px;">${ch||'_'}</div>`;
  }).join('');
}

function _vqUpdateSubmitBtn() {
  const btn = document.getElementById('vqSubmitBtn');
  if (!btn) return;
  const s = _vqState;
  const ans = s.answers[s.currentIdx];
  const hasInput = !!(ans.input && String(ans.input).trim());
  const isLast = s.currentIdx === s.questions.length - 1;
  btn.disabled = !hasInput;
  btn.textContent = isLast ? '완료 ▶' : '제출 ▶';
  btn.style.opacity = hasInput ? '1' : '0.4';
}

window._vqFocusSpellInput = () => {
  const inp = document.getElementById('vqSpellInput');
  if (inp) {
    try { inp.focus({ preventScroll: true }); } catch(e) { inp.focus(); }
    window.scrollTo(0, 0);
  }
};

// 타이머 — 학원장 설정 우선 (모든 형식 통일)
// 우선순위: test.timeLimitSec (신규) > vocabOptions.timeLimitSec (옛 단어시험 호환) > 형식별 default
function _vqStartTimer(){
  _vqStopTimer();
  const s = _vqState;
  const ans = s.answers[s.currentIdx];
  const v = parseInt(s.test?.timeLimitSec ?? s.opts?.timeLimitSec);
  const total = (isFinite(v) && v >= 5 && v <= 120)
    ? v
    : (ans.format === 'mcq' ? 10 : 30);
  _vqTimeLeft = total;
  _vqUpdateTimerUI(total);
  _vqTimer = setInterval(() => {
    _vqTimeLeft--;
    _vqUpdateTimerUI(total);
    if (_vqTimeLeft <= 0) {
      _vqStopTimer();
      // 시간 만료 → 현재 답(또는 공백) 으로 다음
      vqNext({ allowEmpty: true });
    }
  }, 1000);
}
function _vqStopTimer(){ if(_vqTimer){ clearInterval(_vqTimer); _vqTimer=null; } }
function _vqUpdateTimerUI(total){
  const t = document.getElementById('vqTimerText');
  const arc = document.getElementById('vqTimerArc');
  if (t) t.textContent = _vqTimeLeft;
  if (arc) arc.style.strokeDashoffset = 113 * (1 - _vqTimeLeft / total);
}

window.vqSkip = () => {
  const s = _vqState;
  s.answers[s.currentIdx].input = '';
  _vqStopTimer();
  if (s.currentIdx < s.questions.length - 1) {
    s.currentIdx++;
    _vqRenderStep();
  } else {
    _vqSubmit();
  }
};

// ─── 말하기 (Speaking) — 마이크 영역 렌더 + 음성 인식 + 채점 ───
// 2026-05-23: 3차 AI(check-word) 의존 폐기 → 빈칸 문장 SR 흐름.
//   1차 영어 STT (en-US, 닫힌후보 가드) → 2차 한국어 STT (ko-KR, 한글 발음표기) → 3차 영어 STT (en-US, 빈칸 문장 안 목표 단어 매칭)
//   응시 시점 AI 호출 0. 출제 시점에 questions[i].speakingKoPron/Sent/SentKo 미리 박힘 (백필 / Phase 1 게이트로 보장).
function _vqSpkRenderArea() {
  const s = _vqState;
  const ans = s.answers[s.currentIdx];
  // 새 문제 진입 시 spk 상태 리셋
  s.spk.attempt = 0;
  s.spk.busy = false;
  s.spk.srResolved = false;
  s.spk.lastHeard = '';
  s.spk.hint = 0;  // 힌트 카운트 (0~2, 점수 영향 없음)
  if (s.spk.timeoutId) { clearTimeout(s.spk.timeoutId); s.spk.timeoutId = null; }
  if (s.spk.recognition) {
    try { s.spk.recognition.stop(); } catch(_) {}
    s.spk.recognition = null;
  }
  // UI 초기화
  const btn = document.getElementById('vqSpkMicBtn');
  const status = document.getElementById('vqSpkStatus');
  const attemptEl = document.getElementById('vqSpkAttempt');
  const result = document.getElementById('vqSpkResult');
  const hintBtn = document.getElementById('vqSpkHintBtn');
  const hintBoxes = document.getElementById('vqSpkHintBoxes');
  const sentArea = document.getElementById('vqSpkSentenceArea');
  if (btn) { btn.style.background = MIC_BTN_IDLE; btn.disabled = !!ans._locked; btn.textContent = '🎤'; }
  if (status) status.textContent = ans._locked ? '✓ 채점 완료' : '마이크 버튼을 누르고 영어로 말해보세요';
  if (attemptEl) attemptEl.textContent = '';
  if (result) result.style.display = ans._locked ? 'block' : 'none';
  // 힌트 버튼은 footer 에 있음 — _vqRenderStep 가 표시 토글, 여기선 disabled/라벨만 갱신
  if (hintBoxes) { hintBoxes.style.display = 'none'; hintBoxes.innerHTML = ''; }
  if (sentArea) { sentArea.style.display = 'none'; }
  // 라이브 STT 영역 초기화 — 3차 진입 시에만 표시
  const liveEl = document.getElementById('vqSpkLive');
  if (liveEl) { liveEl.style.display = 'none'; liveEl.textContent = ''; }
  _vqUpdateHintBtn();
}

// ─── 말하기 채점 헬퍼 ───

// 공백 무시 한글 유사도 — 2차 한국어 STT 가 띄어쓰기를 다르게 인식하는 케이스 대응
// (예: "오트 투" vs "오트투")
function _vqSimNoSpace(a, b) {
  if (typeof _spkLev !== 'function') return 0;  // safety
  const aa = String(a || '').replace(/\s/g, '');
  const bb = String(b || '').replace(/\s/g, '');
  if (!aa && !bb) return 1;
  const L = Math.max(aa.length, bb.length);
  if (!L) return 0;
  return 1 - _spkLev(aa, bb) / L;
}

// 3차 빈칸 문장 안 목표 단어(또는 여러 단어 구) 매칭 — 문장 전체가 아닌 목표 부분만 비교
// (다른 단어 변동 무시, STT 가 띄어쓰기 다르게 인식한 케이스도 포함)
function _vqBestPhraseSim(sentence, target) {
  const sw = String(sentence || '').toLowerCase().replace(/[^a-z'\s가-힣]/g, ' ').split(/\s+/).filter(Boolean);
  const tw = String(target || '').toLowerCase().split(/\s+/).filter(Boolean);
  const n = tw.length;
  if (!n || !sw.length) return { sim: 0, word: '' };
  const tj = tw.join('');
  let best = 0, bestW = '';
  for (let i = 0; i + n <= sw.length; i++) {
    const win = sw.slice(i, i + n);
    const s1 = _spkSim(win.join(' '), tw.join(' '));
    const s2 = _spkSim(win.join(''), tj);
    const ss = Math.max(s1, s2);
    if (ss > best) { best = ss; bestW = win.join(' '); }
  }
  if (n > 1) {
    // 구를 STT 가 한 단어로 붙여 인식한 경우
    for (let j = 0; j < sw.length; j++) {
      const ss = _spkSim(sw[j], tj);
      if (ss > best) { best = ss; bestW = sw[j]; }
    }
  }
  return { sim: best, word: bestW };
}

// 단어 stem → 발음 유사도(레벤슈타인) 보조 (헬퍼 — _spkGradeAnswer 가 export 안 한 경우 polyfill)
function _spkLev(a, b) {
  a = a || ''; b = b || '';
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
  }
  return d[m][n];
}
function _spkSim(a, b) {
  const aa = String(a || '').toLowerCase().trim();
  const bb = String(b || '').toLowerCase().trim();
  if (!aa && !bb) return 1;
  const L = Math.max(aa.length, bb.length);
  if (!L) return 0;
  return 1 - _spkLev(aa, bb) / L;
}

// 힌트 박스 렌더링 — 스펠링 N글자(EX.hint) 표시
function _vqRenderHintBoxes() {
  const s = _vqState;
  const q = s.questions[s.currentIdx];
  const hintBoxes = document.getElementById('vqSpkHintBoxes');
  if (!hintBoxes || !q) return;
  if (s.spk.hint <= 0) { hintBoxes.style.display = 'none'; hintBoxes.innerHTML = ''; return; }
  const w = String(q.word || '');
  const boxes = w.split('').map((c, i) => {
    if (c === ' ') return '<span style="display:inline-block;width:10px;"></span>';
    const ch = i < s.spk.hint ? esc(c) : '';
    return `<span style="display:inline-block;border-bottom:3px solid var(--c-brand);width:22px;height:30px;line-height:30px;text-align:center;font-weight:800;color:var(--c-brand);font-size:18px;margin:0 2px;">${ch}</span>`;
  }).join('');
  hintBoxes.innerHTML = boxes;
  hintBoxes.style.display = 'block';
}

function _vqUpdateHintBtn() {
  const s = _vqState;
  const q = s.questions[s.currentIdx];
  const btn = document.getElementById('vqSpkHintBtn');
  if (!btn || !q) return;
  // footer 의 힌트 버튼 — 정답 나와도 사라지지 않게 위치 유지 (혼란 방지). 채점 완료 시 disabled.
  const ans = s.answers[s.currentIdx];
  const w = String(q.word || '');
  const max = Math.min(2, w.replace(/\s/g, '').length);
  const left = max - s.spk.hint;
  btn.disabled = !!ans?._locked || s.spk.hint >= max;
  btn.textContent = `힌트${left > 0 && !ans?._locked ? ` (${left}회)` : ''}`;
}

// 힌트 클릭 — 스펠링 한 글자 추가 노출 (최대 2글자, 점수 영향 없음)
window.vqSpkUseHint = () => {
  const s = _vqState;
  const q = s.questions[s.currentIdx];
  const ans = s.answers[s.currentIdx];
  if (!q || ans?._locked) return;
  const max = Math.min(2, String(q.word || '').replace(/\s/g, '').length);
  if (s.spk.hint >= max) return;
  s.spk.hint += 1;
  _vqRenderHintBoxes();
  _vqUpdateHintBtn();
};

// 2026-05-23 신 1·2·3차 흐름:
//   1차 = 영어 STT (en-US, _spkGradeAnswer 닫힌후보 가드 유지)
//   2차 = 한국어 STT (ko-KR, q.speakingKoPron 와 simNoSpace 비교, 임계값 0.7)
//   3차 = 영어 STT (en-US, q.speakingSent 표시 후 _vqBestPhraseSim 으로 목표 부분만 매칭, 임계값 0.7)
// 응시 시점 AI 호출 0 (check-word 폐기). 출제 시점에 questions[i].speakingKoPron/Sent/SentKo 미리 박힘.
window.vqSpkStart = async () => {
  const s = _vqState;
  const ans = s.answers[s.currentIdx];
  if (ans._locked) return;
  const q = s.questions[s.currentIdx];

  const MAX_ATTEMPTS = 3;

  // 안전 가드 — 3회 시도 끝, 또는 처리 중
  if ((s.spk.attempt || 0) >= MAX_ATTEMPTS) return;
  if (s.spk.busy) return;
  s.spk.busy = true;
  // 번호표(세대 토큰) — 이 시도 고유 번호. 더 새 시도가 시작되면(gen 증가) 옛 콜백·타이머 전부 무효.
  const myGen = (s.spk.gen = (s.spk.gen || 0) + 1);
  const _stale = () => myGen !== s.spk.gen;

  // 옛 SR 인스턴스 cleanup — 이전 시도의 onend 가 늦게 발화해서
  // 새 시도의 버튼 색을 푸른색으로 되돌리는 버그 방지 (2026-05-15)
  if (s.spk.recognition) {
    try {
      s.spk.recognition.onresult = null;
      s.spk.recognition.onerror = null;
      s.spk.recognition.onend = null;
      s.spk.recognition.onstart = null;
      s.spk.recognition.abort();
    } catch (_) {}
    s.spk.recognition = null;
  }
  if (s.spk.timeoutId) { clearTimeout(s.spk.timeoutId); s.spk.timeoutId = null; }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast('이 브라우저는 음성 인식을 지원하지 않습니다.');
    s.spk.busy = false;
    return;
  }

  // 2차+ 시도 — 이전 SR 마이크 해제 대기 (안드로이드 빨강→파랑 깜빡임 fix +
  // 한국어/영어 SR 핸드오프 안정). SR 은 stream 미노출 → abort + 대기로 해제 보장.
  if ((s.spk.attempt || 0) >= 1) {
    await new Promise(r => setTimeout(r, 400));
    if (s.answers[s.currentIdx]?._locked) { s.spk.busy = false; return; }
  }

  s.spk.attempt = (s.spk.attempt || 0) + 1;
  const attempt = s.spk.attempt;

  // 차수별 stage 결정 — 데이터 누락 시 가능한 단계로 폴백
  //   1차: 항상 영어 STT (en-US)
  //   2차: q.speakingKoPron 있으면 한국어 STT, 없으면 영어 STT (옛 시험 안전망)
  //   3차: q.speakingSent 있으면 빈칸 문장 STT, 없으면 영어 STT (옛 시험 안전망)
  let stage;
  if (attempt === 1) stage = 'en1';
  else if (attempt === 2) stage = q.speakingKoPron ? 'ko2' : 'en1';
  else stage = q.speakingSent ? 'sent3' : 'en1';

  // ── SR 설정 (차수별 lang + UI) ──
  const rec = new SR();
  rec.lang = (stage === 'ko2') ? 'ko-KR' : 'en-US';
  rec.continuous = false;
  // 3차만 interim 활성 — 실시간 STT 표시 (학생이 자기 발음 즉시 확인 가능)
  rec.interimResults = (stage === 'sent3');
  rec.maxAlternatives = 5;
  s.spk.recognition = rec;

  const btn = document.getElementById('vqSpkMicBtn');
  const status = document.getElementById('vqSpkStatus');
  const attemptEl = document.getElementById('vqSpkAttempt');
  const sentArea = document.getElementById('vqSpkSentenceArea');
  const sentEl = document.getElementById('vqSpkSentence');
  const sentKoEl = document.getElementById('vqSpkSentenceKo');
  const liveEl = document.getElementById('vqSpkLive');

  if (btn) { btn.style.background = MIC_BTN_RECORDING; btn.disabled = true; }
  if (attemptEl) attemptEl.textContent = `${attempt}/${MAX_ATTEMPTS}`;
  // 안내 문구 단순화 — 평가 방식까지 알릴 필요 없음
  if (status) status.textContent = '🔴 듣고 있어요...';
  // 3차 — 빈칸 문장 표시 (목표 단어 가림 + 다른 배경색) + 한글 해석은 강조 표시
  if (sentArea && sentEl && sentKoEl) {
    if (stage === 'sent3' && q.speakingSent) {
      // 목표 단어 가림 — 글자색을 배경과 같게 + select 방지
      const re = new RegExp('\\b' + String(q.word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      const sentHtml = esc(q.speakingSent).replace(re, m => `<span style="background:#94a3b8;color:#94a3b8;user-select:none;padding:0 8px;border-radius:4px;letter-spacing:1px;">${m}</span>`);
      sentEl.innerHTML = sentHtml;
      sentKoEl.innerHTML = q.speakingSentKo ? esc(q.speakingSentKo).replace(/\[([^\]]+)\]/g, '<span style="background:#fde68a;padding:0 4px;border-radius:3px;color:#92400e;font-weight:700;">$1</span>') : '';
      sentArea.style.display = 'block';
      // 3차 라이브 STT 영역 활성화 (마이크 위)
      if (liveEl) {
        liveEl.style.display = 'block';
        liveEl.innerHTML = '<span style="color:#94a3b8;font-size:13px;">말하기 시작하면 여기에 표시됩니다</span>';
      }
    } else {
      sentArea.style.display = 'none';
      if (liveEl) { liveEl.style.display = 'none'; liveEl.textContent = ''; }
    }
  }

  s.spk.srResolved = false;

  // 차수별 채점 + 결과 처리
  const gradeFromResult = (e) => {
    if (stage === 'en1') {
      // 1차 — 기존 _spkGradeAnswer (닫힌후보 가드 + 발음변형)
      const grading = _spkGradeAnswer(e.results[0], q.word, s.spk.strictness, q.homophones,
        (s.questions || []).map(qq => qq && qq.word), q.accentVariants);
      const heard = (e.results[0]?.[0]?.transcript || '').toLowerCase().trim();
      return { correct: grading.correct, heard, matchedWith: grading.matchedWith, sim: grading.bestSimilarity || 0 };
    }
    if (stage === 'ko2') {
      // 2차 — 한국어 STT 결과를 q.speakingKoPron 와 공백 무시 비교, 임계값 0.7
      let bestSim = 0, bestHeard = '';
      for (let i = 0; i < e.results[0].length; i++) {
        const t = String(e.results[0][i].transcript || '').trim();
        const ss = _vqSimNoSpace(t, q.speakingKoPron || '');
        if (ss > bestSim) { bestSim = ss; bestHeard = t; }
      }
      return { correct: bestSim >= 0.7, heard: bestHeard, sim: bestSim };
    }
    // sent3 — 영어 STT 결과 안에서 목표 단어 부분만 매칭, 임계값 0.7
    let bestSim = 0, bestHeard = '';
    for (let i = 0; i < e.results[0].length; i++) {
      const t = String(e.results[0][i].transcript || '').trim();
      const bp = _vqBestPhraseSim(t, q.word || '');
      if (bp.sim > bestSim) { bestSim = bp.sim; bestHeard = t; }
    }
    return { correct: bestSim >= 0.7, heard: bestHeard, sim: bestSim };
  };

  const handleFail = (heard, simVal) => {
    if (_stale()) return;   // 더 새 시도가 시작됨 → 옛 실패는 무시 (연타 cross-talk 방지)
    if (attempt >= MAX_ATTEMPTS) {
      // 3차 실패 → 오답 finalize
      _vqSpkFinalize(false, heard, { source: `webspeech-${attempt}` });
      return;
    }
    // 1·2차 실패 → 재시도 안내 (lock 안 함, 버튼 활성)
    const nextNo = attempt + 1;
    const msg = stage === 'ko2'
      ? `❌ 발음을 인식하지 못했어요 · 다시 한번 (${nextNo}/${MAX_ATTEMPTS})`
      : (heard ? `❌ "${heard}"처럼 들렸어요 · 다시 한번 (${nextNo}/${MAX_ATTEMPTS})` : `❌ 다시 한번 발음해보세요 (${nextNo}/${MAX_ATTEMPTS})`);
    if (status) status.textContent = msg;
    if (btn) { btn.style.background = MIC_BTN_IDLE; btn.disabled = true; }
    setTimeout(() => {
      if (_stale()) return;
      s.spk.busy = false;
      if (btn) btn.disabled = false;
    }, 700);
  };

  rec.onstart = () => { console.log('[vqSpk] SR onstart, attempt:', attempt, 'stage:', stage); };

  rec.onresult = (e) => {
    if (_stale()) return;
    // 3차 interim 처리 — 실시간 발음 텍스트 vqSpkLive 에 표시
    if (stage === 'sent3' && liveEl) {
      let interim = '', finalT = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalT += r[0].transcript;
        else interim += r[0].transcript;
      }
      const interimColor = '#94a3b8';
      liveEl.innerHTML = (finalT ? `<span style="color:#111;font-weight:700;">${esc(finalT)}</span>` : '') +
        (interim ? `<span style="color:${interimColor};"> ${esc(interim)}</span>` : '');
    }
    // 최종 결과가 도착했을 때만 채점 (interim 만으로 채점 X)
    const hasFinal = Array.from(e.results).some(r => r.isFinal);
    if (!hasFinal) return;
    s.spk.srResolved = true;
    const g = gradeFromResult(e);
    s.spk.lastHeard = g.heard;
    console.log('[vqSpk] result attempt:', attempt, 'stage:', stage, 'correct:', g.correct, 'sim:', g.sim, 'heard:', g.heard);
    if (g.correct) {
      s.spk.busy = false;
      // 통과 시 source = 어느 차수에서 통과했는지 기록 (1/2/3)
      _vqSpkFinalize(true, g.matchedWith || q.word, { source: `webspeech-${attempt}` });
    } else {
      handleFail(g.heard, g.sim);
    }
  };

  rec.onerror = (e) => {
    if (_stale()) return;
    s.spk.srResolved = true;
    console.warn('[vqSpk] error:', e.error, 'attempt:', attempt);
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      s.spk.busy = false;
      if (status) status.textContent = '⚠️ 마이크 권한이 필요합니다.';
      _vqSpkFinalize(false, '', { source: `webspeech-${attempt}`, spkError: e.error });
      return;
    }
    handleFail(s.spk.lastHeard || '', 0);
  };

  rec.onend = () => {
    if (_stale()) return;
    console.log('[vqSpk] SR onend, resolved:', s.spk.srResolved, 'attempt:', attempt);
    if (!s.spk.srResolved && !ans._locked) {
      s.spk.srResolved = true;
      handleFail(s.spk.lastHeard || '', 0);
    }
  };

  try { rec.start(); } catch(e) {
    s.spk.attempt = Math.max(0, attempt - 1);
    s.spk.busy = false;
    if (btn) { btn.style.background = MIC_BTN_IDLE; btn.disabled = false; }
    if (status) status.textContent = '인식 시작 실패. 다시 시도하세요.';
    return;
  }

  // 5초 safety net — onstart/onresult/onerror/onend 모두 발화 안 하는 hang 케이스
  s.spk.timeoutId = setTimeout(() => {
    if (s.answers[s.currentIdx]?._locked || s.spk.srResolved) return;
    s.spk.srResolved = true;
    console.warn('[vqSpk] SR timeout 5s, attempt:', attempt);
    try { rec.stop(); } catch (_) {}
    handleFail(s.spk.lastHeard || '', 0);
  }, 5000);
};

function _vqSpkFinalize(correct, heard, meta) {
  const s = _vqState;
  const ans = s.answers[s.currentIdx];
  const q = s.questions[s.currentIdx];
  ans._locked = true;
  // SR hang 대비 타임아웃 정리
  if (s.spk.timeoutId) { clearTimeout(s.spk.timeoutId); s.spk.timeoutId = null; }
  ans.input = correct ? (q.word || '') : '';
  ans.spkHeard = heard || '';
  ans.spkAttempts = s.spk.attempt;
  ans.spkCorrect = correct;
  // source 값: 'webspeech-1'/'webspeech-2'/'webspeech-3' (어느 차수에서 통과/실패)
  // 옛 'webspeech'/'ai'/'ai-error' 호환 — 상세 표시 측에서 그대로 받음
  ans.spkSource = meta?.source || 'webspeech';
  ans.spkHintUsed = s.spk.hint || 0;  // 사용한 힌트 수 (분석용, 점수 영향 없음)
  _vqStopTimer();

  const btn = document.getElementById('vqSpkMicBtn');
  const status = document.getElementById('vqSpkStatus');
  const result = document.getElementById('vqSpkResult');
  const icon = document.getElementById('vqSpkResultIcon');
  const heardEl = document.getElementById('vqSpkHeard');
  const answerEl = document.getElementById('vqSpkAnswer');
  const hintBoxes = document.getElementById('vqSpkHintBoxes');
  const sentArea = document.getElementById('vqSpkSentenceArea');
  const sentEl = document.getElementById('vqSpkSentence');
  const liveEl = document.getElementById('vqSpkLive');
  if (btn) { btn.disabled = true; btn.style.background = '#cbd5e1'; }
  if (status) status.textContent = '';
  if (result) result.style.display = 'block';
  if (icon) {
    icon.textContent = correct ? '⭐' : '❌';
    icon.style.color = correct ? '#22c55e' : '#dc2626';
  }
  // 힌트 버튼은 footer 에 있어 위치 유지 (정답 시도 사라지지 않게) — _vqUpdateHintBtn 에서 disabled 처리
  _vqUpdateHintBtn();
  if (hintBoxes) hintBoxes.style.display = 'none';
  // 3차 (sent3) 일 땐 라이브 STT 유지 — 학생이 자기 발음 인식 결과 확인 가능.
  // 1·2차는 어차피 display:none 이라 무관. 다음 문제 진입 시 _vqSpkRenderArea 가 초기화.
  const src3 = String(meta?.source || '').toLowerCase() === 'webspeech-3';
  if (liveEl && !src3) { liveEl.style.display = 'none'; liveEl.textContent = ''; }
  // 3차 정답 시 sentArea 유지 + 목표 단어 노출 + 클릭 재발음. 그 외엔 숨김.
  if (sentArea && sentEl && correct && src3 && q.speakingSent) {
    const re = new RegExp('\\b' + String(q.word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    const sentHtml = esc(q.speakingSent).replace(re, m =>
      `<span style="background:#dcfce7;padding:0 4px;border-radius:3px;color:#047857;font-weight:800;">${m}</span>`
    );
    sentEl.innerHTML = sentHtml + ' <span style="font-size:13px;color:#0369a1;text-decoration:underline dotted;">🔊</span>';
    sentEl.style.cursor = 'pointer';
    sentEl.title = '클릭하면 다시 듣기';
    sentEl.onclick = () => _fbSpeakWords([q.speakingSent]);
    sentArea.style.display = 'block';
  } else if (sentArea) {
    sentArea.style.display = 'none';
    if (sentEl) { sentEl.onclick = null; sentEl.style.cursor = ''; }
  }

  // ── 결과 메시지 분기 ──
  // 통과: 차수별 안내. 2차 통과는 평가 방식 멘트 제거하고 q.speakingTip 있으면 코칭만 표시.
  // 오답: "X처럼 들렸어요" + 정답 노출
  if (heardEl) {
    const src = String(meta?.source || '').toLowerCase();
    const tip = String(q.speakingTip || '').trim();
    if (correct) {
      if (src === 'webspeech-2' && tip) {
        // 2차 통과 + 단어별 코칭 — 발음 팁만 (한국식 인식 멘트 제거)
        heardEl.innerHTML = `<div style="font-size:13px;color:#7c3aed;margin-top:6px;font-weight:600;">${iconSvg('lightbulb')} ${esc(tip)}</div>`;
      } else if (src === 'webspeech-3' && tip) {
        heardEl.innerHTML = `<div style="font-size:13px;color:#7c3aed;margin-top:6px;font-weight:600;">${iconSvg('lightbulb')} ${esc(tip)}</div>`;
      } else {
        // 1차 정답 또는 tip 없음 — 부가 표시 X (깔끔하게)
        heardEl.innerHTML = '';
      }
    } else {
      // 오답 — 들린 단어 (부수적 — 한 단계 작게)
      let html = '';
      if (heard) {
        html += `<div style="font-size:12px;color:#6b7280;">"<strong>${esc(heard)}</strong>"로 들렸어요</div>`;
      } else {
        html += `<div style="font-size:12px;color:#9ca3af;">음성이 명확하지 않았어요</div>`;
      }
      // 오답 시 코칭도 노출 (학습 효과)
      if (tip) html += `<div style="font-size:13px;color:#7c3aed;margin-top:6px;font-weight:600;">${iconSvg('lightbulb')} ${esc(tip)}</div>`;
      heardEl.innerHTML = html;
    }
  }
  if (answerEl) {
    _vqAnsWord = q.word || '';
    _vqAnsSlowNext = false;   // 새 결과 → 첫 클릭은 보통 속도
    // 글자 크기: 문제 부분(vqPrompt) 22px 와 같게. 🔊 이모지는 더 크게 (28px) — 누르면 발음하는 직관성. 안내 텍스트 제거.
    answerEl.innerHTML = `<span style="font-size:22px;font-weight:800;color:#222;">정답: <span onclick="_vqSpeakAnswer()" style="cursor:pointer;color:#0369a1;text-decoration:underline dotted;text-underline-offset:4px;" title="클릭하면 다시 듣기 — 다시 누르면 천천히">${esc(q.word || '')}</span></span> <span onclick="_vqSpeakAnswer()" style="cursor:pointer;font-size:30px;vertical-align:middle;display:inline-block;margin-left:4px;" title="클릭하면 다시 듣기">🔊</span>`;
  }

  // 정답 발음 들려주기 (학습 효과)
  // 3차 정답 → 문장 전체 (학생이 단어가 들어간 자연스러운 문장 학습)
  // 그 외(1·2차 정답 / 오답) → 단어만
  if (correct && src3 && q.speakingSent) {
    _fbSpeakWords([q.speakingSent]);
  } else if (q.word) {
    _fbSpeakWords([q.word]);
  }

  if (typeof _vqShowNextButton === 'function') _vqShowNextButton();
}

// MCQ 선택 → 즉시 정답/오답 피드백 → 자동 다음 (구버전 운영 방식)
window.vqSelectMcq = async (choiceIdx) => {
  const s = _vqState;
  const ans = s.answers[s.currentIdx];
  if (ans._locked) return;
  ans.input = ans.choices[choiceIdx] || '';
  ans._locked = true;
  _vqStopTimer();
  const q = s.questions[s.currentIdx];
  // 피드백 렌더 (배너 + 보기 색상)
  _vqRenderMcqFeedback(ans);
  // 자동 진행
  await _vqAutoAdvance(q, ans);
  _vqAutoNext();
};

function _vqRenderMcqFeedback(ans) {
  const s = _vqState;
  const q = s.questions[s.currentIdx];
  const correctText = ans.direction === 'en2ko' ? (q.meaning||'') : (q.word||'');
  const container = document.getElementById('vqChoicesArea');
  if (!container) return;
  // 시간만료/입력누락 — input 이 비었음. 정답/오답 표시를 시간만료용으로 분기 (2026-06-21)
  // 옛 버전: 시간만료여도 정답 옵션에 ✓ 표시 + banner 오답 → 학생 혼란 (정답 누른 줄 아는데 오답 나옴)
  const userInputEmpty = !ans.input || !String(ans.input).trim();
  container.innerHTML = ans.choices.map((opt, j) => {
    const isUser = opt === ans.input;
    const isCorrect = opt === correctText;
    let bg = 'white', color = 'var(--teal)', border = 'var(--teal)';
    if (isCorrect) {
      // 시간만료 시 정답을 호박색 + (정답) 으로 표시 — ✓ (학생이 누른 듯) 와 구분
      if (userInputEmpty) { bg = '#fef3c7'; color = '#92400e'; border = '#f59e0b'; }
      else { bg = '#d1fae5'; color = '#047857'; border = '#10b981'; }
    } else if (isUser) {
      bg = '#fee2e2'; color = '#b91c1c'; border = '#ef4444';
    }
    const mark = isCorrect
      ? (userInputEmpty ? ' (정답)' : ' ✓')
      : (isUser ? ' ✗' : '');
    return `<button disabled
      style="padding:14px 16px;background:${bg};border:2px solid ${border};color:${color};border-radius:14px;font-size:15px;font-weight:700;font-family:inherit;box-shadow:0 2px 4px rgba(0,0,0,0.08);text-align:left;opacity:${isCorrect||isUser?1:0.5};">
      ${['①','②','③','④'][j]} ${esc(opt)}${mark}
    </button>`;
  }).join('');
  // 배너 — 시간만료 시 명시 ("⏰ 시간 만료") 로 학생 혼란 차단
  if (userInputEmpty) {
    _vqShowFeedbackBanner(false, '⏰ 시간 만료 — 정답: ' + correctText);
  } else {
    _vqShowFeedbackBanner(ans.input === correctText, correctText);
  }
}

// 스펠링 채점 정규화: NFKC + hidden 공백/zero-width 제거 + collapse + lowercase
// 정답의 공백 위치는 자동 삽입. 학생이 공백 안 눌러도 알아서 띄움.
// 'itmightbe' + target 'it might be' → 'it might be' 자동 변환.
function _vqAutoSpaces(userInput, target) {
  if (!target || target.indexOf(' ') === -1) return userInput;  // 공백 없는 정답은 그대로
  const cleanUser = String(userInput || '').replace(/\s+/g, '');  // 학생 입력 공백 모두 제거
  let result = '';
  let ui = 0;
  for (let i = 0; i < target.length; i++) {
    if (target[i] === ' ') {
      result += ' ';
    } else if (ui < cleanUser.length) {
      result += cleanUser[ui++];
    } else {
      break;
    }
  }
  return result;
}

function _vqNormStr(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[   ]/g, ' ')        // NBSP / 좁은 공백 → 일반 공백
    .replace(/[​‌‍﻿]/g, '')   // zero-width 제거
    .replace(/[^\p{L}\p{N}\s]/gu, '')             // 영숫자·한글·공백만 — 특수문자(~>()등) 제거
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
// per-character 비교용 (길이 유지). 특수문자는 빈 문자열 반환 → 박스 비교에서 무시 처리.
function _vqNormCh(ch) {
  if (!ch) return '';
  const cp = ch.codePointAt(0);
  if (cp === 0x00A0 || cp === 0x2009 || cp === 0x202F) return ' ';
  if (cp === 0x200B || cp === 0x200C || cp === 0x200D || cp === 0xFEFF) return '';
  // 영숫자·한글·공백 외 (~ > ( ) , . 등) → 빈 문자열 (채점 무시)
  if (!/[\p{L}\p{N}\s]/u.test(ch)) return '';
  return ch.toLowerCase();
}

function _vqIsAnsCorrect(q, ans) {
  const user = _vqNormStr(ans.input);
  const target = _vqNormStr(ans.direction === 'en2ko' ? (q.meaning||'') : (q.word||''));
  return !!user && user === target;
}

// 스펠링 제출: 정답 체크 + 박스 피드백 + 자동 다음
window.vqNext = async (opts) => {
  _vqStopTimer();
  const s = _vqState;
  const ans = s.answers[s.currentIdx];

  // 이미 피드백 락 상태면 다음으로
  if (ans._locked) return _vqAutoNext();

  // 시간 만료 시엔 빈 답 허용. 일반 제출은 답 있어야 함
  if (!(opts && opts.allowEmpty) && (!ans.input || !String(ans.input).trim())) return;

  ans._locked = true;
  const q = s.questions[s.currentIdx];
  const isCorrect = _vqIsAnsCorrect(q, ans);

  if (ans.format === 'short') {
    _vqRenderSpellFeedback(ans, isCorrect);
  } else {
    _vqRenderMcqFeedback(ans);
  }
  // 버튼 비활성화 (자동 진행 중)
  const btn = document.getElementById('vqSubmitBtn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
  // 자동 진행: TTS 또는 1초 후 _vqAutoNext
  await _vqAutoAdvance(q, ans);
  _vqAutoNext();
};

// 자동 진행 흐름 — TTS (있으면) 또는 1초 대기
async function _vqAutoAdvance(q, ans) {
  // 시작 시 영단어 TTS 있었던 경우 (en2ko): 추가 TTS X, 1초 대기
  // 시작 시 TTS 없었던 경우 (ko2en, mcq): 정답 영단어 TTS → 끝나면 즉시
  if (ans.direction === 'en2ko') {
    await new Promise(r => setTimeout(r, 1000));
  } else if (q.word) {
    await _speakAndWait(q.word);
  } else {
    await new Promise(r => setTimeout(r, 1000));
  }
}

function _vqShowNextButton(){
  const btn = document.getElementById('vqSubmitBtn');
  if (!btn) return;
  const s = _vqState;
  const isLast = s.currentIdx === s.questions.length - 1;
  btn.disabled = false;
  btn.style.opacity = '1';
  btn.textContent = isLast ? '완료 ▶' : '다음 ▶';
}

function _vqRenderSpellFeedback(ans, isCorrect) {
  const s = _vqState;
  const q = s.questions[s.currentIdx];
  const target = ans.direction === 'en2ko' ? (q.meaning || '') : (q.word || '');
  const len = target.length;
  const val = ans.input || '';
  const boxes = document.getElementById('vqSpellBoxes');
  if (!boxes) return;
  const boxW = len > 12 ? 26 : len > 8 ? 30 : 34;
  const fontSize = len > 12 ? 13 : len > 8 ? 15 : 17;
  boxes.innerHTML = Array.from({length:len},(_,i)=>{
    const userCh = val[i] || '';
    const correctCh = target[i] || '';
    const correctNorm = _vqNormCh(correctCh);
    const userNorm = _vqNormCh(userCh);
    // 정답이 특수문자 (~>()등) 라 정규화 시 빈 문자열 → 학생 입력 무관 정답 처리
    const isOptional = correctCh !== '' && correctNorm === '';
    const match = isOptional || (!!userCh && userNorm === correctNorm);
    const bg = match ? '#d1fae5' : (userCh ? '#fee2e2' : '#fef3c7');
    const color = match ? '#047857' : (userCh ? '#b91c1c' : '#92400e');
    const border = match ? '#10b981' : (userCh ? '#ef4444' : '#f59e0b');
    // 표시: optional 박스 = 정답 char (~ 등) / match = 학생 입력 / mismatch = 학생 친 글자 + 정답 작은 회색
    const mainCh = isOptional ? correctCh : (match ? userCh : (userCh || '_'));
    const subCh = (!match && userCh) ? correctCh : '';
    const subHtml = subCh ? `<div style="font-size:9px;line-height:1;margin-top:1px;color:#6b7280;font-weight:600;">→${esc(subCh)}</div>` : '';
    return `<div class="spell-box" style="width:${boxW}px;height:${boxW+18}px;font-size:${fontSize}px;border-radius:6px;background:${bg};border:2px solid ${border};color:${color};display:flex;flex-direction:column;align-items:center;justify-content:center;">${esc(mainCh)}${subHtml}</div>`;
  }).join('');

  // 배너로 결과 표시 (빈칸채우기와 동일 스타일)
  _vqShowFeedbackBanner(isCorrect, target);
}

function _vqShowFeedbackBanner(isCorrect, correctText){
  const banner = document.getElementById('vqFeedbackBanner');
  if (!banner) return;
  banner.style.display = 'block';
  banner.innerHTML = isCorrect
    ? '<span style="color:#059669;">✓ 정답!</span>'
    : `<span style="color:#DC2626;">✗ 오답 · 정답: ${esc(correctText)}</span>`;
}
function _vqHideFeedbackBanner(){
  const banner = document.getElementById('vqFeedbackBanner');
  if (banner) banner.style.display = 'none';
}

async function _vqAutoNext() {
  const s = _vqState;
  if (s.currentIdx < s.questions.length - 1) {
    s.currentIdx++;
    _vqRenderStep();
  } else {
    await _vqSubmit();
  }
}

async function _vqSubmit() {
  const s = _vqState;
  const t = s.test;
  if (!t || !currentUser) return;
  if (s._submitted || s._submitting) return;  // 이중 저장 방지
  s._submitting = true;

  let correct = 0;
  const total = s.questions.length;
  s.questions.forEach((q, i) => {
    if (_vqIsAnsCorrect(q, s.answers[i])) correct++;
  });

  const score = total ? Math.round((correct / total) * 100) : 0;
  const passScore = t.passScore ?? 80;
  const passed = score >= passScore;
  const today = _ymdKST();

  try {
    await addDoc(collection(db,'scores'), {
      academyId: window.MY_ACADEMY_ID || 'default',
      uid: currentUser.uid, userId: currentUser.uid,
      userName: userProfile?.name || '', name: userProfile?.name || '',
      group: userProfile?.group || '',
      testId: t.id, testName: t.name || '',
      unitId: t.id, unitName: t.name || '',
      bookName: t.bookName || '',
      mode: 'vocab',
      // 시험 삭제돼도 성적리포트 배지 판정 가능하도록 메타 보존 (2026-05-16)
      vocabFormat: t.vocabOptions?.format || s.opts?.format || '',
      score, correct, wrong: total - correct, total,
      passed, passScore,
      date: today,
      createdAt: serverTimestamp(),
    });
    try {
      await _writeUserCompleted(t.id, {
        score, passed, passScore,
        correct, wrong: total - correct, total,
        questions: s.questions, answers: s.answers,
      });
    } catch(e) { console.warn('genTest 완료 기록 실패', e); }
    s._submitted = true;
    _vqClearProgress(t.id);   // 제출 완료 → 중간 저장분 삭제
  } catch(e) {
    console.error(e);
    showToast('점수 저장 실패: ' + e.message);
  } finally {
    s._submitting = false;
  }
  _vqRenderResult({
    correct, wrong: total - correct, total, score, passed, passScore,
    questions: s.questions, answers: s.answers,
  });
}

function _vqBuildDetail(questions, answers) {
  if (!questions || !answers) return '';
  return (questions||[]).map((q, i) => {
    const a = answers[i] || {};
    const dir = a.direction || 'en2ko';
    const prompt = dir === 'en2ko' ? (q.word||'') : (q.meaning||'');
    const target = dir === 'en2ko' ? (q.meaning||'') : (q.word||'');
    const user = (a.input || '').trim();
    const isCorrect = !!user && _vqNormStr(user) === _vqNormStr(target);
    const bg = isCorrect ? '#F0FDF4' : '#FEF2F2';
    const border = isCorrect ? '#BBF7D0' : '#FECACA';
    return `
      <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:10px 12px;margin-bottom:8px;text-align:left;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:11px;color:var(--gray);font-weight:700;">Q${i+1}</span>
          <span style="font-size:12px;color:${isCorrect?'#059669':'#dc2626'};font-weight:700;">${isCorrect?'✓ 정답':'✗ 오답'}</span>
          <span style="font-size:10px;color:var(--gray);">${dir==='en2ko'?'영→한':'한→영'} · ${a.format==='mcq'?'객관식':a.format==='speaking'?'🎤 말하기':'단답'}</span>
        </div>
        <div style="font-size:13px;color:var(--text);margin-bottom:3px;font-weight:600;">${esc(prompt)}</div>
        <div style="font-size:11px;color:var(--gray);">
          ${a.format === 'speaking'
            ? (() => {
                const _heard = a.spkAiHeard || a.spkHeard;
                // 신 흐름 차수별 라벨 (학생 비공개 정확도·attempt 횟수는 표시 안 함)
                const src = String(a.spkSource || '').toLowerCase();
                let _stageHtml = '';
                if (isCorrect) {
                  if (src === 'webspeech-2') _stageHtml = ' · <span style="color:#CA8A04;">2차 통과</span>';
                  else if (src === 'webspeech-3') _stageHtml = ' · <span style="color:#CA8A04;">3차 통과 (문장)</span>';
                }
                return `<span style="color:${isCorrect?'#059669':'#dc2626'};">${isCorrect ? '⭐ 정답' : '❌ 오답'}</span>${_heard ? ` · 들린 단어: "${esc(_heard)}"` : ''} · <span style="color:#059669;">정답: ${esc(target)}</span>${_stageHtml}`;
              })()
            : `<span style="color:${isCorrect?'#059669':'#dc2626'};">내답: ${esc(user||'(미입력)')}</span>${!isCorrect ? ` · <span style="color:#059669;">정답: ${esc(target)}</span>` : ''}`}
        </div>
      </div>`;
  }).join('');
}

function _vqRenderResult({ correct, wrong, total, score, passed, passScore, questions, answers }) {
  const screen = document.getElementById('vocabQuiz');
  if (!screen) return;
  _screenSnapshotOnce('vocabQuiz');
  screen.innerHTML = _renderResultShell('vocab', {
    correct, wrong, total, score, passed, passScore,
    detailHtml: _vqBuildDetail(questions, answers),
  });
  screen.dataset.stage = 'result';  // popstate 뒤로가기 보호 분기 — 결과 보기 중엔 모달 X
  updateVocabBadge();
}

// 결과 화면에서 현재 시험 재응시 (파라미터 없이 state 참조 → 특수문자 이스케이프 이슈 회피)
window.vqRetakeCurrent = () => {
  const t = _vqState?.test;
  if (!t?.id) { showToast('시험 정보 없음'); return; }
  startVocab(t.id, t.name || '');
};

// 완료된 단어시험 이전 결과 보기
window.vqViewPreviousResult = async (testId, testName) => {
  try {
    const [testSnap, compSnap] = await Promise.all([
      getDoc(doc(db,'genTests',testId)),
      getDoc(doc(db,'genTests',testId,'userCompleted',currentUser.uid)),
    ]);
    if (!testSnap.exists() || !compSnap.exists()) {
      showToast('이전 결과를 불러올 수 없습니다. 새로 시작합니다.');
      startVocab(testId, testName);
      return;
    }
    const test = { id: testId, ...testSnap.data() };
    const comp = compSnap.data();
    // 응시 당시 스냅샷 우선 사용 (셔플 순서 보존). 구기록은 test.questions 로 폴백
    const questions = (Array.isArray(comp.questions) && comp.questions.length)
      ? comp.questions
      : (test.questions || []).filter(q => q.type === 'vocab');
    _vqState = { test, questions, currentIdx: 0, answers: comp.answers || [], opts: test.vocabOptions || {} };

    _screenSnapshotOnce('vocabQuiz');
    show('vocabQuiz');
    _vqRenderResult({
      correct: comp.correct || 0,
      wrong: comp.wrong || 0,
      total: comp.total || questions.length,
      score: comp.score || 0,
      passed: comp.passed ?? ((comp.score||0) >= (comp.passScore||80)),
      passScore: comp.passScore || 80,
      questions,
      answers: comp.answers || [],
    });
  } catch (e) {
    console.error('단어시험 이전 결과 로드 실패', e);
    showToast('로드 실패: ' + e.message);
    startVocab(testId, testName);
  }
};

window.quitVocab = async () => {
  if (!(await showConfirm('시험을 중단할까요?', ''))) return;
  // 지금까지 푼 내용 저장 여부 묻기 → 저장 시 다음 진입에서 이어풀기
  const save = await showConfirm('진행 내용을 저장할까요?', '저장하면 중단된 문제부터 이어서 풀 수 있어요. 단, 저장은 오늘(자정)까지만 유효하며 내일부터는 처음부터 다시 풀어야 해요.');
  if (save) {
    if (_vqSaveProgress()) showToast('저장 완료 — 오늘 안에 다시 열면 이어서 풀 수 있어요 (내일부터는 처음부터)');
  } else if (_vqState?.test?.id) {
    _vqClearProgress(_vqState.test.id);
  }
  _vqStopTimer();
  // 음성 인식 정리 (speaking 모드 종료 시)
  if (_vqState?.spk?.recognition) {
    try { _vqState.spk.recognition.stop(); } catch(_) {}
    _vqState.spk.recognition = null;
  }
  goHome();
};

const updateVocabBadge = () => _updateAllBadgesAtOnce();

// updateAllBadges 확장 (vocab)
const _origUpdateAllBadgesForVocab = window.updateAllBadges;
// no-op: updateVocabBadge 는 testBadge 를 관리하므로 기존 updateTestBadge 와 동일 element
// Phase 6D 에서 updateTestBadge 제거 시 updateVocabBadge 로 완전 대체

// ═══════════════════════════════════════════════════════════════════════════
// 말하기 시험 — 음성 인식 채점 헬퍼 (T1)
// vocab 시험의 한 변형 (vocabOptions.format='speaking') 으로 동작. T2 에서 _vqState 분기.
// ═══════════════════════════════════════════════════════════════════════════
// 마이크 버튼 색 (학원 brand 색 무시 — 녹음 중 시각적 구분 우선, 2026-05-15)
const MIC_BTN_IDLE = '#60a5fa';       // 옅은 파랑 — 평소 (대기)
const MIC_BTN_RECORDING = '#dc2626';  // 진한 빨강 — 녹음/발음 중

const SPK_STRICTNESS_CONFIG = {
  // 2026-05-15 두번째 재조정 — 0.7/0.8/0.9 → 0.6/0.7/0.8 (이전 강화가 너무 타이트)
  lenient: { maxAlternatives: 5, similarityThreshold: 0.6, label: '🟢 너그러움' },
  normal:  { maxAlternatives: 5, similarityThreshold: 0.7, label: '🟡 보통' },
  strict:  { maxAlternatives: 1, similarityThreshold: 0.8, label: '🔴 엄격' },
};

function _spkLevenshteinSimilarity(a, b) {
  if (!a || !b) return 0;
  a = String(a).toLowerCase();
  b = String(b).toLowerCase();
  const m = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) m[0][i] = i;
  for (let j = 0; j <= b.length; j++) m[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[j][i] = Math.min(m[j][i - 1] + 1, m[j - 1][i] + 1, m[j - 1][i - 1] + cost);
    }
  }
  const dist = m[b.length][a.length];
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

// 단어 말하기 채점 — 정확일치 + 통합 가드 (닫힌후보 1번 + 발음코드 3번 + 동음이의어/발음변형)
// 2026-05-19 검증: scripts/diag/test-spk-grading.js 14/14 통과.
//   · 정확일치: 들린=정답/동음이의어/발음변형 (시험 내 다른 단어와 겹치는 후보는 제외 → false positive 차단)
//   · 가드: 정답군 최고유사도(bestG)가 "이 시험의 다른 단어들" 최고유사도(bestO)를 마진 이상 앞설 때만 인정
//       강한매칭 bestG>=임계 & gap>=0.15  /  임계미만 구제 bestG>=0.45 & gap>=0.30
//   · 발음코드(metaphone-lite)는 가드 안 유사도에만 반영 (단독 통과 불가 — cat/cot 등 false positive 억제)
// allWords: 이 시험의 모든 영단어(닫힌 후보군). accentVariants: AI 발음변형(2번, 후속 — 현재 미사용 가능).
function _spkNorm(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function _spkPcode(s) {
  let x = _spkNorm(s).replace(/[^a-z]/g, '');
  if (!x) return '';
  x = x.replace(/ph/g, 'f').replace(/gh/g, '').replace(/ck/g, 'k')
    .replace(/sch/g, 'sk').replace(/tch/g, 'ch')
    .replace(/^wr/, 'r').replace(/^kn/, 'n').replace(/mb$/, 'm')
    .replace(/c([eiy])/g, 's$1').replace(/c/g, 'k')
    .replace(/q/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's')
    .replace(/w/g, '').replace(/h/g, '')
    .replace(/[eiy]/g, 'i').replace(/(.)\1+/g, '$1').replace(/e$/, '');
  return x;
}
function _spkPhoneticEqual(a, b) {
  const ca = _spkPcode(a), cb = _spkPcode(b);
  return ca.length >= 2 && ca === cb;
}
function _spkWordSim(said, w) {
  return Math.max(_spkLevenshteinSimilarity(said, w), _spkPhoneticEqual(said, w) ? 0.92 : 0);
}
const _SPK_FLOOR = 0.45, _SPK_MARGIN = 0.15, _SPK_BIG_MARGIN = 0.30;

function _spkGradeAnswer(recognitionResults, correctEnglish, strictness, homophones, allWords, accentVariants) {
  const cfg = SPK_STRICTNESS_CONFIG[strictness] || SPK_STRICTNESS_CONFIG.normal;
  const ans = _spkNorm(correctEnglish);
  if (!ans) return { correct: false, alternatives: [] };

  // 시험의 다른 단어들 (정답 제외)
  const others = [];
  for (const w of (allWords || [])) { const x = _spkNorm(w); if (x && x !== ans && !others.includes(x)) others.push(x); }

  // 인정 후보 = 정답 + 동음이의어 + 발음변형. 단 다른 시험단어와 겹치는 건 제외(애매 → false positive 차단)
  const group = [ans];
  const addCand = (raw) => { const x = _spkNorm(raw); if (x && x !== ans && !group.includes(x) && !others.includes(x)) group.push(x); };
  if (Array.isArray(homophones)) homophones.forEach(addCand);
  if (Array.isArray(accentVariants)) accentVariants.forEach(addCand);

  const alts = Array.from(recognitionResults || []).slice(0, cfg.maxAlternatives)
    .map(a => _spkNorm(a && a.transcript)).filter(Boolean);

  let trackSim = 0, trackHeard = '';
  for (const said of alts) {
    // 진짜 정확일치 — 항상 안전
    for (const g of group) {
      if (said === g) return { correct: true, matchedWith: said, similarity: 1, viaHomophone: g !== ans, via: 'exact' };
    }
    let bestG = 0;
    for (const g of group) { const s = _spkWordSim(said, g); if (s > bestG) bestG = s; }
    let bestO = 0;
    for (const o of others) { const s = _spkWordSim(said, o); if (s > bestO) bestO = s; }
    const gap = bestG - bestO;
    const strong = bestG >= cfg.similarityThreshold && gap >= _SPK_MARGIN;
    const rescue = bestG >= _SPK_FLOOR && gap >= _SPK_BIG_MARGIN;
    if (strong || rescue) {
      return { correct: true, matchedWith: said, similarity: +bestG.toFixed(2), viaHomophone: false, via: strong ? 'strong' : 'rescue' };
    }
    if (bestG > trackSim) { trackSim = bestG; trackHeard = said; }
  }
  return { correct: false, alternatives: alts, bestSimilarity: trackSim, bestHeard: trackHeard };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 6C: 언스크램블 v2 (unscramble) — genTests(testMode='unscramble') 기반
// 홈 "언스크램블" 카드는 새 로직으로 완전 교체. 기존 goUnscramble 덮어씀
// ═══════════════════════════════════════════════════════════════════════════

let _uqState = {
  test: null,
  questions: [],
  currentIdx: 0,
  answers: [],   // [{placed: [chunkIdx...], chunks: shuffled[]}]
  feedback: null, // {isCorrect, userSentence, targetSentence} — 피드백 단계
};

// 기존 goUnscramble 덮어쓰기 (tests 기반 → genTests 기반)
window.goUnscramble = async () => {
  show('unscrambleList');
  await loadUnscrambleList2();
};

const loadUnscrambleList2 = () => _loadTestListByType('unscramble');

const _uqMakeCard = (t, isCompleted, onclick, completedScore, latestFailedScore) =>
  _makeTypeCard('unscramble', t, isCompleted, onclick, completedScore, latestFailedScore);

window.startUnscramble2 = async (testId, testName) => {
  try {
    const snap = await getDoc(doc(db,'genTests',testId));
    if (!snap.exists()) { showToast('시험 정보를 불러올 수 없어요.'); return; }
    const test = { id: testId, ...snap.data() };
    let questions = (test.questions || []).filter(q => q.type === 'unscramble');
    if (questions.length === 0) { showToast('문제가 비어있습니다.'); return; }

    // 매번 문제 순서 섞기
    questions = _rngShuffle(questions);

    // 각 문제의 청크도 섞어 answers 준비
    const answers = questions.map(q => {
      const chunks = (q.chunkedSentence || '').split('/').map(s => s.trim()).filter(Boolean);
      const shuffled = _rngShuffle(chunks.map((c, i) => ({ text: c, origIdx: i })));
      return { placed: [], chunks: shuffled };
    });

    _screenPrepare('unscrambleQuiz', '#uqProgressBar');

    _uqState = { test, questions, currentIdx: 0, answers, feedback: null };
    show('unscrambleQuiz');
    _uqRenderStep();
  } catch(e) {
    console.error(e);
    showToast('시험 시작 실패: ' + e.message);
  }
};

function _uqRenderStep() {
  const s = _uqState;
  const q = s.questions[s.currentIdx];
  if (!q) return;

  const pct = Math.round(((s.currentIdx + 1) / s.questions.length) * 100);
  const bar = document.getElementById('uqProgressBar');
  const pill = document.getElementById('uqProgressText');
  if (bar) bar.style.width = pct + '%';
  if (pill) pill.textContent = `${s.currentIdx + 1}/${s.questions.length}`;

  const meanEl = document.getElementById('uqMeaningKo');
  if (meanEl) meanEl.textContent = q.meaningKo || '';

  const ans = s.answers[s.currentIdx];
  const builtEl = document.getElementById('uqBuilt');
  const chunkBox = document.getElementById('uqChunkBox');

  // 완성 중인 문장 (구버전 스타일: 인라인 텍스트, 개별 청크 탭으로 제거)
  if (builtEl) {
    if (ans.placed.length === 0) {
      builtEl.innerHTML = '<span style="color:#c0a0c0;font-size:12px;">아래 청크를 순서대로 탭하세요</span>';
    } else {
      builtEl.innerHTML = ans.placed.map((shufIdx, pos) => {
        const chunk = ans.chunks[shufIdx];
        return `<span onclick="uqRemovePlaced(${pos})"
          style="display:inline-block;padding:2px 8px;margin:2px 3px;background:var(--teal);color:white;border-radius:6px;cursor:pointer;user-select:none;">${esc(chunk.text)}</span>`;
      }).join(' ');
    }
  }

  // 섞인 청크 버튼 (구버전 스타일)
  if (chunkBox) {
    const used = new Set(ans.placed);
    chunkBox.innerHTML = ans.chunks.map((chunk, shufIdx) => {
      const isUsed = used.has(shufIdx);
      return `<button onclick="uqTapChunk(${shufIdx})" ${isUsed?'disabled':''}
        style="padding:10px 14px;background:${isUsed?'#f3f4f6':'white'};border:2px solid ${isUsed?'#e5e7eb':'var(--teal)'};color:${isUsed?'#aaa':'var(--teal)'};border-radius:10px;font-size:15px;font-weight:700;cursor:${isUsed?'not-allowed':'pointer'};font-family:inherit;${isUsed?'text-decoration:line-through;opacity:0.5;':''}box-shadow:${isUsed?'none':'0 2px 4px rgba(232,113,74,0.15)'};">${esc(chunk.text)}</button>`;
    }).join('');
  }

  _uqUpdateSubmitBtn();
  _uqStartTimer();

  // 긴 문장 시 한글뜻·완성중·청크 글자를 단계적으로 축소 (15→13px), 그래도 안 들어가면 청크만 스크롤
  requestAnimationFrame(_uqFitContent);
}

// 단계 정의 — 한글뜻 / 완성중인 문장 / 청크 버튼 글자 사이즈
const _UQ_FONT_TIERS = [
  { mean: 15, built: 14, chunk: 15 },  // tier 0 (기본)
  { mean: 14, built: 13, chunk: 14 },  // tier 1
  { mean: 13, built: 13, chunk: 13 },  // tier 2 (최소)
];
function _uqApplyFontTier(tier) {
  const meanEl = document.getElementById('uqMeaningKo');
  const builtEl = document.getElementById('uqBuilt');
  const chunkArea = document.getElementById('uqChunkArea');
  if (meanEl) meanEl.style.fontSize = tier.mean + 'px';
  if (builtEl) builtEl.style.fontSize = tier.built + 'px';
  if (chunkArea) {
    chunkArea.querySelectorAll('button').forEach(b => {
      b.style.fontSize = tier.chunk + 'px';
    });
  }
}
function _uqFitContent() {
  const chunkArea = document.getElementById('uqChunkArea');
  if (!chunkArea) return;
  chunkArea.style.overflowY = 'hidden';
  for (let i = 0; i < _UQ_FONT_TIERS.length; i++) {
    _uqApplyFontTier(_UQ_FONT_TIERS[i]);
    if (chunkArea.scrollHeight <= chunkArea.clientHeight + 2) return;
  }
  // 13px 까지 줄여도 안 들어가면 청크 영역만 스크롤 (안전망)
  chunkArea.style.overflowY = 'auto';
}

function _uqUpdateSubmitBtn() {
  const btn = document.getElementById('uqSubmitBtn');
  if (!btn) return;
  const s = _uqState;
  const ans = s.answers[s.currentIdx];
  const done = ans.placed.length === ans.chunks.length;
  const isLast = s.currentIdx === s.questions.length - 1;
  btn.disabled = !done;
  btn.textContent = isLast ? '완료 ▶' : '제출 ▶';
  btn.style.opacity = done ? '1' : '0.4';
}

// 타이머 (구버전 30초)
let _uqTimer = null;
let _uqTimeLeft = 30;
function _uqStartTimer(){
  _uqStopTimer();
  // 학원장 설정 test.timeLimitSec 우선, 없으면 default 30
  const v = parseInt(_uqState?.test?.timeLimitSec);
  const total = (isFinite(v) && v >= 5 && v <= 120) ? v : 30;
  _uqTimeLeft = total;
  _uqUpdateTimerUI(total);
  _uqTimer = setInterval(() => {
    _uqTimeLeft--;
    _uqUpdateTimerUI(total);
    if (_uqTimeLeft <= 0) {
      _uqStopTimer();
      uqNext({ allowPartial: true });
    }
  }, 1000);
}
function _uqStopTimer(){ if(_uqTimer){ clearInterval(_uqTimer); _uqTimer=null; } }
function _uqUpdateTimerUI(total){
  const t = document.getElementById('uqTimerText');
  const arc = document.getElementById('uqTimerArc');
  if (t) t.textContent = _uqTimeLeft;
  if (arc && total) arc.style.strokeDashoffset = 113 * (1 - _uqTimeLeft / total);
}

window.uqSkip = () => {
  const s = _uqState;
  _uqStopTimer();
  // 피드백 중이면 skip 도 다음 문제로
  s.feedback = null;
  if (s.currentIdx < s.questions.length - 1) {
    s.currentIdx++;
    _uqRenderStep();
  } else {
    _uqSubmit();
  }
};

// 부분 갱신 (타이머 재시작 안 함)
function _uqRefreshBuiltAndChunks() {
  const s = _uqState;
  const ans = s.answers[s.currentIdx];
  const builtEl = document.getElementById('uqBuilt');
  const chunkBox = document.getElementById('uqChunkBox');
  if (builtEl) {
    if (ans.placed.length === 0) {
      builtEl.innerHTML = '<span style="color:#c0a0c0;font-size:12px;">아래 청크를 순서대로 탭하세요</span>';
    } else {
      builtEl.innerHTML = ans.placed.map((shufIdx, pos) => {
        const chunk = ans.chunks[shufIdx];
        return `<span onclick="uqRemovePlaced(${pos})"
          style="display:inline-block;padding:2px 8px;margin:2px 3px;background:var(--teal);color:white;border-radius:6px;cursor:pointer;user-select:none;">${esc(chunk.text)}</span>`;
      }).join(' ');
    }
  }
  if (chunkBox) {
    const used = new Set(ans.placed);
    chunkBox.innerHTML = ans.chunks.map((chunk, shufIdx) => {
      const isUsed = used.has(shufIdx);
      return `<button onclick="uqTapChunk(${shufIdx})" ${isUsed?'disabled':''}
        style="padding:10px 14px;background:${isUsed?'#f3f4f6':'white'};border:2px solid ${isUsed?'#e5e7eb':'var(--teal)'};color:${isUsed?'#aaa':'var(--teal)'};border-radius:10px;font-size:15px;font-weight:700;cursor:${isUsed?'not-allowed':'pointer'};font-family:inherit;${isUsed?'text-decoration:line-through;opacity:0.5;':''}box-shadow:${isUsed?'none':'0 2px 4px rgba(232,113,74,0.15)'};">${esc(chunk.text)}</button>`;
    }).join('');
  }
  _uqUpdateSubmitBtn();
}

window.uqTapChunk = (shufIdx) => {
  const s = _uqState;
  if (s.feedback) return;
  const ans = s.answers[s.currentIdx];
  if (ans.placed.includes(shufIdx)) return;
  ans.placed.push(shufIdx);
  _uqRefreshBuiltAndChunks();
};

window.uqRemovePlaced = (pos) => {
  if (_uqState.feedback) return;
  _uqState.answers[_uqState.currentIdx].placed.splice(pos, 1);
  _uqRefreshBuiltAndChunks();
};

window.uqReset = () => {
  if (_uqState.feedback) return;
  _uqState.answers[_uqState.currentIdx].placed = [];
  _uqRefreshBuiltAndChunks();
};

window.uqNext = async (opts) => {
  _uqStopTimer();
  const s = _uqState;

  // 피드백 화면 → [다음] 클릭 시 다음 문제 진행
  if (s.feedback) {
    s.feedback = null;
    if (s.currentIdx < s.questions.length - 1) {
      s.currentIdx++;
      _uqRenderStep();
    } else {
      await _uqSubmit();
    }
    return;
  }

  // 답 제출 → 채점 + 피드백 화면
  const ans = s.answers[s.currentIdx];
  const q = s.questions[s.currentIdx];
  if (!(opts && opts.allowPartial) && ans.placed.length !== ans.chunks.length) return;

  const userSeq = ans.placed.map(idx => ans.chunks[idx].text);
  const targetSeq = (q.chunkedSentence || '').split('/').map(x => x.trim()).filter(Boolean);
  const isCorrect = userSeq.length === targetSeq.length
    && userSeq.every((c, j) => c === targetSeq[j]);

  s.feedback = {
    isCorrect,
    userSentence: userSeq.join(' '),
    targetSentence: targetSeq.join(' '),
    meaningKo: q.meaningKo || '',
  };
  _uqRenderFeedback();
};

function _uqRenderFeedback() {
  const s = _uqState;
  const fb = s.feedback;
  if (!fb) return;
  const builtEl = document.getElementById('uqBuilt');
  const chunkBox = document.getElementById('uqChunkBox');
  const submitBtn = document.getElementById('uqSubmitBtn');
  const isLast = s.currentIdx === s.questions.length - 1;

  if (builtEl) {
    builtEl.innerHTML = `
      <div style="text-align:center;padding:8px 4px;">
        <div style="font-size:36px;margin-bottom:4px;">${fb.isCorrect ? '🎉' : '💪'}</div>
        <div style="font-size:15px;font-weight:800;color:${fb.isCorrect ? '#059669' : '#DC2626'};margin-bottom:10px;">
          ${fb.isCorrect ? '정답입니다!' : '아쉬워요'}
        </div>
        <div style="font-size:10px;color:var(--gray);margin-bottom:3px;text-align:left;">정답</div>
        <div style="font-size:14px;font-weight:700;color:#059669;padding:8px 10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;text-align:left;">${esc(fb.targetSentence)}</div>
        ${!fb.isCorrect ? `
          <div style="font-size:10px;color:var(--gray);margin-top:8px;margin-bottom:3px;text-align:left;">내 답</div>
          <div style="font-size:13px;color:#DC2626;padding:8px 10px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;text-align:left;text-decoration:line-through;">${esc(fb.userSentence)}</div>
        ` : ''}
      </div>
    `;
  }
  if (chunkBox) chunkBox.innerHTML = '';  // 청크 버튼 숨김
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = isLast ? '완료 ▶' : '다음 문제 ▶';
    submitBtn.style.opacity = '1';
  }
}

async function _uqSubmit() {
  const s = _uqState;
  const t = s.test;
  if (!t || !currentUser) return;
  if (s._submitted || s._submitting) return;
  s._submitting = true;

  let correct = 0;
  const total = s.questions.length;
  s.questions.forEach((q, i) => {
    const ans = s.answers[i];
    const userSeq = ans.placed.map(idx => ans.chunks[idx].text);
    const targetSeq = (q.chunkedSentence || '').split('/').map(x => x.trim()).filter(Boolean);
    if (userSeq.length === targetSeq.length && userSeq.every((c, j) => c === targetSeq[j])) {
      correct++;
    }
  });

  const score = total ? Math.round((correct / total) * 100) : 0;
  const passScore = t.passScore ?? 80;
  const passed = score >= passScore;
  const today = _ymdKST();

  try {
    await addDoc(collection(db,'scores'), {
      academyId: window.MY_ACADEMY_ID || 'default',
      uid: currentUser.uid, userId: currentUser.uid,
      userName: userProfile?.name || '', name: userProfile?.name || '',
      group: userProfile?.group || '',
      testId: t.id, testName: t.name || '',
      unitId: t.id, unitName: t.name || '',
      bookName: t.bookName || '',
      mode: 'unscramble',
      score, correct, wrong: total - correct, total,
      passed, passScore,
      date: today,
      createdAt: serverTimestamp(),
    });
    try {
      await _writeUserCompleted(t.id, {
        score, passed, passScore,
        correct, wrong: total - correct, total,
        questions: s.questions, answers: s.answers,
      });
    } catch(e) { console.warn('genTest 완료 기록 실패', e); }
    s._submitted = true;
  } catch(e) {
    console.error(e);
    showToast('점수 저장 실패: ' + e.message);
  } finally {
    s._submitting = false;
  }
  _uqRenderResult({ correct, wrong: total - correct, total, score, passed, passScore,
    questions: s.questions, answers: s.answers });
}

function _uqBuildDetail(questions, answers) {
  if (!questions || !answers) return '';
  return (questions||[]).map((q, i) => {
    const ans = answers[i] || { placed: [], chunks: [] };
    const userChunks = (ans.placed || []).map(idx => (ans.chunks||[])[idx]?.text || '').filter(Boolean);
    const targetChunks = (q.chunkedSentence || '').split('/').map(c => c.trim()).filter(Boolean);
    const isCorrect = userChunks.length === targetChunks.length &&
      userChunks.every((c, j) => c === targetChunks[j]);
    const bg = isCorrect ? '#F0FDF4' : '#FEF2F2';
    const border = isCorrect ? '#BBF7D0' : '#FECACA';
    return `
      <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:10px 12px;margin-bottom:8px;text-align:left;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:11px;color:var(--gray);font-weight:700;">Q${i+1}</span>
          <span style="font-size:12px;color:${isCorrect?'#059669':'#dc2626'};font-weight:700;">${isCorrect?'✓ 정답':'✗ 오답'}</span>
        </div>
        ${q.meaningKo ? `<div style="font-size:12px;color:var(--gray);margin-bottom:4px;">${esc(q.meaningKo)}</div>` : ''}
        <div style="font-size:11px;color:var(--gray);line-height:1.6;">
          <span style="color:${isCorrect?'#059669':'#dc2626'};">내답: ${esc(userChunks.join(' / ') || '(미제출)')}</span>
          ${!isCorrect ? `<br><span style="color:#059669;">정답: ${esc(targetChunks.join(' / '))}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

function _uqRenderResult({ correct, wrong, total, score, passed, passScore, questions, answers }) {
  const screen = document.getElementById('unscrambleQuiz');
  if (!screen) return;
  _screenSnapshotOnce('unscrambleQuiz');
  screen.innerHTML = _renderResultShell('unscramble', {
    correct, wrong, total, score, passed, passScore,
    detailHtml: _uqBuildDetail(questions, answers),
  });
  updateUnscBadge2();
}

// 결과 화면에서 현재 시험 재응시 (파라미터 없이 state 참조)
window.uqRetakeCurrent = () => {
  const t = _uqState?.test;
  if (!t?.id) { showToast('시험 정보 없음'); return; }
  startUnscramble2(t.id, t.name || '');
};

// ─── 완료된 언스크램블 시험의 이전 결과 보기 + 재응시 선택 ───
window.uqViewPreviousResult = async (testId, testName) => {
  try {
    const [testSnap, compSnap] = await Promise.all([
      getDoc(doc(db, 'genTests', testId)),
      getDoc(doc(db, 'genTests', testId, 'userCompleted', currentUser.uid)),
    ]);
    if (!testSnap.exists() || !compSnap.exists()) {
      showToast('이전 결과를 불러올 수 없습니다. 새로 시작합니다.');
      startUnscramble2(testId, testName);
      return;
    }
    const test = { id: testId, ...testSnap.data() };
    const comp = compSnap.data();
    // 응시 당시 스냅샷 우선 (셔플 순서 유지)
    const questions = (Array.isArray(comp.questions) && comp.questions.length)
      ? comp.questions
      : (test.questions || []).filter(q => q.type === 'unscramble');

    // 재응시 버튼에서 test 참조할 수 있도록 상태 세팅
    _uqState = { test, questions, currentIdx: 0, answers: comp.answers || [], feedback: null };

    _screenSnapshotOnce('unscrambleQuiz');
    show('unscrambleQuiz');

    const total = comp.total ?? questions.length;
    const correct = comp.correct ?? 0;
    const wrong = comp.wrong ?? (total - correct);
    const score = comp.score ?? 0;
    const passScore = comp.passScore ?? (test.passScore ?? 80);
    const passed = comp.passed ?? (score >= passScore);

    _uqRenderResult({
      correct, wrong, total, score, passed, passScore,
      questions, answers: comp.answers || [],
    });
  } catch (e) {
    console.error('언스크램블 이전 결과 로드 실패', e);
    showToast('로드 실패: ' + e.message);
    startUnscramble2(testId, testName);
  }
};

window.quitUnscramble2 = async () => {
  if (!(await showConfirm('시험을 중단할까요?','지금까지의 답안은 저장되지 않습니다.'))) return;
  _uqStopTimer();
  goHome();
};

// updateUnscBadge 덮어쓰기: genTests(unscramble) 기반
const updateUnscBadge2 = () => _updateAllBadgesAtOnce();

// 기존 updateTestBadge / updateUnscBadge 호출 지점을 v2 로 연결
window.updateTestBadge = updateVocabBadge;
window.updateUnscBadge = updateUnscBadge2;

// 스펠 input 이벤트 바인딩 (DOM 복원 시마다 재호출 필요)
// 자동 제출 제거 (2026-06-02) — 마지막 글자 입력 시 자동 진행하면 오타 수정 불가.
// 학생이 [제출 ▶] 또는 Enter 로 명시적 진행.

function _vqBindSpellInput(){
  const inp = document.getElementById('vqSpellInput');
  if (!inp || inp._vqBound) return;
  inp._vqBound = true;
  inp.addEventListener('input', function(){
    const s = _vqState;
    if (!s.answers || !s.questions[s.currentIdx]) return;
    const ans = s.answers[s.currentIdx];
    if (ans.format !== 'short') return;
    if (ans._locked) return;
    const q = s.questions[s.currentIdx];
    const target = ans.direction === 'en2ko' ? (q.meaning||'') : (q.word||'');
    let v = this.value;
    // 영단어 입력 — 한글·한자·일본어 등 비-라틴 문자만 차단 (특수문자는 자유)
    // 모바일 한글 IME 함정만 회피. +, ?, ! 등 모든 특수문자 자유 입력.
    // 대소문자는 학생 입력 그대로 (채점·박스 비교 시 _vqNormCh 가 lowercase 처리).
    if (ans.direction === 'ko2en') v = v.replace(/[가-힯ㄱ-ㆎ぀-ゟ゠-ヿ一-鿿]/g, '');
    // 정답의 공백 위치는 자동 삽입 — 학생이 글자만 입력해도 OK ('itmightbe' → 'it might be')
    v = _vqAutoSpaces(v, target);
    if (v.length > target.length) v = v.slice(0, target.length);
    this.value = v;
    ans.input = v;
    _vqRenderSpellBoxes(ans);
    _vqUpdateSubmitBtn();
  });
  inp.addEventListener('keydown', function(e){
    if (e.key === 'Enter') {
      e.preventDefault();
      const ans = _vqState.answers[_vqState.currentIdx];
      if (ans && ans.input && String(ans.input).trim()) vqNext();
      return;
    }
    // Backspace 가 자동 띄어쓰기 위에서 작동하도록:
    // 커서 직전이 공백이면 공백 + 앞 글자 함께 삭제.
    // (그렇지 않으면 _vqAutoSpaces 가 input 이벤트에서 공백 즉시 복원해 backspace 무효)
    if (e.key === 'Backspace' && this.selectionStart === this.selectionEnd) {
      const pos = this.selectionStart;
      if (pos >= 2 && this.value[pos - 1] === ' ') {
        e.preventDefault();
        this.value = this.value.slice(0, pos - 2) + this.value.slice(pos);
        this.selectionStart = this.selectionEnd = pos - 2;
        this.dispatchEvent(new Event('input'));
      }
    }
  });
  const boxes = document.getElementById('vqSpellBoxes');
  if (boxes && !boxes._vqBound) {
    boxes._vqBound = true;
    boxes.addEventListener('click', _vqFocusSpellInput);
  }
}
// 최초 1회 바인딩 (페이지 최초 로드 시)
_vqBindSpellInput();

// ═══════════════════════════════════════════════════════════════════════════
// FCM 토큰 등록 + 알림 (Phase 6F 정리 시 누락되어 복구 — 2026-04-29)
// 호출처: 로그인 성공(line ~173, ~2980), HTML notifModal/notifPanel(index.html)
// ═══════════════════════════════════════════════════════════════════════════

const VAPID_KEY = 'BGbPEBiwM8RHNH08eDa7xpX-bQB4T_GKoo9_cFYUttHRq8sAdn4157bMKNznq4lw_k1r0Xq6517LBKSyYaEgmG8';

// 실제 FCM 토큰 발급 및 저장
//   - fcmTokens (array): 멀티 디바이스 (학생 + 학부모 같은 ID 다른 폰) 지원
//   - fcmToken (string): 레거시 호환 — 가장 최근 토큰
//   - 모듈 변수에 캐시 (현재 디바이스 토큰 추적)
//   - 서버 claim API 호출 (다른 user 가 가지고 있던 같은 토큰 → 제거. 디바이스 소유권 이전)
let _myCurrentFcmToken = null;
async function doRegisterToken() {
  if(!messaging || !currentUser) return false;
  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if(token) {
      _myCurrentFcmToken = token;
      // 1) 자기 user doc 갱신 (Rules: isOwner 만 가능)
      await updateDoc(doc(db,'users',currentUser.uid), {
        fcmToken: token,
        fcmTokens: arrayUnion(token),
      });
      // 2) 서버 claim — 같은 토큰 가진 다른 user 들에서 제거 (admin SDK 통해)
      //    fire-and-forget — 실패해도 본인 토큰 등록은 됐으니 알림 수신은 정상
      currentUser.getIdToken().then(idToken => {
        fetch('/api/claimFcmToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, fcmToken: token }),
        }).then(r => r.json()).then(data => {
          if (data?.claimed > 0) console.log(`FCM 토큰 claim: ${data.claimed} user 에서 이전`);
        }).catch(e => console.warn('FCM claim 실패:', e.message));
      }).catch(e => console.warn('idToken 가져오기 실패:', e.message));
      console.log('FCM 토큰 등록 완료');
      return true;
    }
  } catch(e) {
    console.log('FCM 토큰 등록 실패:', e.message);
  }
  return false;
}

window.requestNotifPermission = async() => {
  document.getElementById('notifModal').classList.add('hidden');
  const permission = await Notification.requestPermission();
  if(permission === 'granted') {
    const ok = await doRegisterToken();
    if(ok) showToast('✅ 알림이 설정됐어요! 🎉');
  }
};

window.dismissNotifModal = () => {
  document.getElementById('notifModal').classList.add('hidden');
};

// 로그인 후 알림 설정 시작
async function registerFCMToken() {
  if(!messaging || !currentUser) return;
  if(userProfile?.role === 'admin') return;

  if(Notification.permission === 'granted') {
    await doRegisterToken();
    return;
  }
  if(Notification.permission === 'denied') return;

  setTimeout(() => {
    if(!currentUser || userProfile?.role === 'admin') return;
    document.getElementById('notifModal').classList.remove('hidden');
  }, 3000);
}

// 포그라운드 알림 수신 — onMessage 리스너 1회만 등록 (중복 시 모달 N번 뜸)
let _fcmListenerBound = false;
let _fcmVisibilityBound = false;
function setupForegroundMessage() {
  if(!messaging || _fcmListenerBound) return;
  _fcmListenerBound = true;
  onMessage(messaging, (payload) => {
    const { title, body } = payload.notification || {};
    showNotifModal(title||'알림', body||'');
    // 새 푸시 도착 → 뱃지 즉시 갱신 (확인 버튼 누르기 전이라도 미확인 카운트 반영)
    updateNotifBadge();
  });
  // 앱이 백그라운드 → 포그라운드 복귀 시 뱃지 갱신 (그동안 도착한 푸시·다른 기기 변화 반영)
  if (!_fcmVisibilityBound) {
    _fcmVisibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && currentUser) {
        updateNotifBadge();
      }
    });
  }
}

// 알림 팝업 모달 (포그라운드 수신 전용)
// 이전엔 checkUnreadNotifs 가 이걸로 미확인 알림 순차 노출했지만, 2026-04-29 부터
// 로그인 시엔 합산 summary 모달 (showUnreadSummaryModal) 만 띄우고 개별 노출 안 함.
function showNotifModal(title, body, docId, attachmentOrList){
  const overlay = document.getElementById('notifModalOverlay');
  const titleEl = document.getElementById('notifModalTitle');
  const bodyEl  = document.getElementById('notifModalBody');
  const btn     = document.getElementById('notifModalBtn');
  if(!overlay) return;
  if(titleEl) titleEl.textContent = title;
  if(bodyEl) {
    // body 텍스트 + 첨부 다운로드 영역 (다중 지원)
    bodyEl.innerHTML = '';
    const bodyDiv = document.createElement('div');
    bodyDiv.style.whiteSpace = 'pre-wrap';
    bodyDiv.style.wordBreak = 'break-word';
    bodyDiv.textContent = body || '';
    bodyEl.appendChild(bodyDiv);
    // attachmentOrList: 옛 단일 객체 또는 배열 둘 다 처리
    const atts = Array.isArray(attachmentOrList)
      ? attachmentOrList
      : (attachmentOrList && attachmentOrList.url ? [attachmentOrList] : []);
    atts.forEach(att => {
      if (att && att.url && att.name) bodyEl.appendChild(_buildNotifAttachmentEl(att));
    });
  }
  overlay.style.display='flex';
  if(btn){
    btn.onclick = async() => {
      overlay.style.display='none';
      if(docId && currentUser){
        try{ await updateDoc(doc(db,'userNotifications',docId),{read:true}); }catch(e){console.warn(e);}
      }
      await updateNotifBadge();
    };
  }
}

// 알림 표시용 — attachments 배열 우선, 옛 attachment 단수 폴백
function _notifAttachments(n) {
  if (Array.isArray(n?.attachments) && n.attachments.length > 0) return n.attachments;
  if (n?.attachment && n.attachment.url && n.attachment.name) return [n.attachment];
  return [];
}

// 첨부 파일 표시 요소 — 다운로드 버튼 + 만료일 안내
function _buildNotifAttachmentEl(att) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:12px;padding:10px 12px;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:8px;';
  const now = Date.now();
  const expMs = att.expiresAt ? new Date(att.expiresAt).getTime() : 0;
  const expired = expMs > 0 && now > expMs;
  const expDate = expMs > 0 ? new Date(expMs).toLocaleDateString('ko-KR') : '';

  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px;display:flex;align-items:center;gap:6px;';
  nameRow.textContent = att.name + (att.sizeKB ? ` (${att.sizeKB} KB)` : '');
  wrap.appendChild(nameRow);

  if (expired) {
    const info = document.createElement('div');
    info.style.cssText = 'font-size:12px;color:#888;';
    info.textContent = '보관 기간 만료 (다운로드 불가)';
    wrap.appendChild(info);
  } else {
    const a = document.createElement('a');
    a.href = att.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.download = att.name;
    a.style.cssText = 'display:inline-block;margin-top:4px;padding:8px 14px;background:var(--c-brand,#E8714A);color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;';
    a.textContent = '파일 다운로드';
    wrap.appendChild(a);
    if (expDate) {
      const info = document.createElement('div');
      info.style.cssText = 'font-size:11px;color:var(--gray);margin-top:6px;';
      info.textContent = `${expDate} 까지 다운로드 가능`;
      wrap.appendChild(info);
    }
  }
  return wrap;
}

// 미확인 알림 합산 모달 (로그인 직후 1회만 표시)
function showUnreadSummaryModal(count){
  const existing = document.getElementById('unreadSummaryOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'unreadSummaryOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = `
    <div style="background:white;border-radius:18px;padding:24px 20px;max-width:340px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.2);text-align:center;">
      <div style="font-size:42px;margin-bottom:10px;">🔔</div>
      <div style="font-size:17px;font-weight:700;color:var(--text);margin-bottom:6px;">확인하지 않은 알림</div>
      <div style="font-size:14px;color:var(--gray);margin-bottom:18px;">미확인 알림이 <b style="color:var(--teal);">${count}건</b> 있어요</div>
      <div style="display:flex;gap:8px;">
        <button id="usmDismissBtn" style="flex:1;padding:11px;background:#f5f5f5;border:none;border-radius:12px;font-size:14px;color:#555;cursor:pointer;font-weight:600;">나중에</button>
        <button id="usmOpenBtn" style="flex:1;padding:11px;background:var(--teal);color:white;border:none;border-radius:12px;font-size:14px;cursor:pointer;font-weight:700;">지금 확인</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('usmDismissBtn').onclick = () => overlay.remove();
  document.getElementById('usmOpenBtn').onclick = () => {
    overlay.remove();
    if (typeof openNotifPanel === 'function') openNotifPanel();
  };
}

// 앱 진입 시 미확인 알림 합산 표시 (1개 모달, 풀스크린 차단 X)
// aggregate count — 안 읽음 doc 전체 fetch 대신 1 read 만 (2026-06-18, reads ~90% 절감)
async function checkUnreadNotifs(){
  if(!currentUser) return;
  try{
    const q = query(
      collection(db,'userNotifications'),
      where('uid','==',currentUser.uid),
      where('read','==',false)
    );
    let count = 0;
    try {
      const c = await getCountFromServer(q);
      count = c.data().count;
    } catch (e) {
      // 폴백 — 옛 getDocs 방식 (네트워크/일시 오류 시 안전망)
      console.warn('[checkUnreadNotifs] getCountFromServer 실패, getDocs 폴백:', e.message);
      const snap = await getDocs(q);
      count = snap.size;
    }
    await updateNotifBadge(count);
    if (count === 0) return;
    showUnreadSummaryModal(count);
  }catch(e){ console.log('알림 확인 실패',e); }
}

// 헤더 종 뱃지 업데이트
async function updateNotifBadge(count){
  const badge = document.getElementById('notifBadge');
  if(!badge) return;
  if(count===undefined && currentUser){
    // aggregate count — 안 읽음 doc 전체 fetch 대신 1 read 만 (2026-06-18, reads ~90% 절감)
    try{
      const c = await getCountFromServer(query(
        collection(db,'userNotifications'),
        where('uid','==',currentUser.uid),
        where('read','==',false)
      ));
      count = c.data().count;
    }catch(e){
      // 인덱스/네트워크 오류 시 폴백 — 옛 방식 getDocs + size
      console.warn('[notifBadge] getCountFromServer 실패, getDocs 폴백:', e.message);
      try{
        const snap = await getDocs(query(
          collection(db,'userNotifications'),
          where('uid','==',currentUser.uid),
          where('read','==',false)
        ));
        count = snap.size;
      }catch(_){ count=0; }
    }
  }
  if(count>0){
    badge.textContent = count>9?'9+':count;
    badge.style.display='flex';
  } else {
    badge.style.display='none';
  }
}

// 알림 패널 (헤더 🔔 클릭)
// 알림 패널 페이지네이션 (2026-06-18) — 10개 + 더보기 (reads ~94% 절감)
const NOTIF_PAGE_SIZE = 10;
let _notifPanelState = { lastDoc: null, exhausted: false, notifs: [] };

function _renderNotifRow(n) {
  return `<div id="notifRow-${n.id}" onclick="readNotif('${n.id}')" style="padding:14px 16px;border-bottom:1px solid #f5f5f5;cursor:pointer;background:${n.read?'white':'#f0fafa'};">
    <div style="display:flex;align-items:flex-start;gap:10px;">
      <span data-role="notif-icon" style="font-size:20px;flex-shrink:0;">${n.read?'🔔':'🔴'}</span>
      <div style="flex:1;min-width:0;">
        <div data-role="notif-title" style="font-weight:${n.read?'500':'700'};font-size:14px;color:${n.read?'#555':'#111'};margin-bottom:3px;">${esc(n.title||'알림')}</div>
        <div style="font-size:12px;color:#777;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${esc(n.body||'')}</div>
        ${_notifAttachments(n).map(a => _renderNotifRowAttachment(a)).join('')}
        <div style="font-size:11px;color:#bbb;margin-top:4px;">${n.createdAt?.toDate?n.createdAt.toDate().toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):''}</div>
      </div>
    </div>
  </div>`;
}

function _renderNotifPanelMore() {
  return _notifPanelState.exhausted
    ? '<div style="text-align:center;padding:12px;color:#bbb;font-size:11px;">모두 표시됨</div>'
    : `<div id="notifMoreWrap" style="text-align:center;padding:10px;"><button onclick="loadMoreNotifs()" style="background:#f5f5f5;border:none;border-radius:8px;padding:8px 18px;font-size:12px;color:#555;cursor:pointer;">+ ${NOTIF_PAGE_SIZE}개 더 보기</button></div>`;
}

async function _fetchNotifsPage(reset = false) {
  if (reset) _notifPanelState = { lastDoc: null, exhausted: false, notifs: [] };
  if (_notifPanelState.exhausted) return;
  try {
    const constraints = [
      where('uid','==',currentUser.uid),
      orderBy('createdAt','desc'),
      limit(NOTIF_PAGE_SIZE),
    ];
    if (_notifPanelState.lastDoc) constraints.push(startAfter(_notifPanelState.lastDoc));
    const snap = await getDocs(query(collection(db,'userNotifications'), ...constraints));
    _notifPanelState.lastDoc = snap.docs[snap.docs.length - 1] || _notifPanelState.lastDoc;
    _notifPanelState.exhausted = snap.size < NOTIF_PAGE_SIZE;
    snap.docs.forEach(d => _notifPanelState.notifs.push({ id: d.id, ...d.data() }));
  } catch (e) {
    // 인덱스 빌드 중 또는 부재 시 폴백 — where(uid) 만 + 클라 정렬 + 클라 slice
    // (옛 동작과 동일 — reads 절감 효과는 없지만 학생 영향 0)
    console.warn('[notifPanel] indexed query failed, falling back to client-side sort:', e.message);
    if (reset) {
      const snap = await getDocs(query(collection(db,'userNotifications'), where('uid','==',currentUser.uid)));
      const all = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      _notifPanelState.notifs = all.slice(0, NOTIF_PAGE_SIZE);
      _notifPanelState._fallbackAll = all;  // 더보기용
      _notifPanelState.exhausted = all.length <= NOTIF_PAGE_SIZE;
    } else if (Array.isArray(_notifPanelState._fallbackAll)) {
      const next = _notifPanelState._fallbackAll.slice(
        _notifPanelState.notifs.length,
        _notifPanelState.notifs.length + NOTIF_PAGE_SIZE
      );
      _notifPanelState.notifs.push(...next);
      _notifPanelState.exhausted = _notifPanelState.notifs.length >= _notifPanelState._fallbackAll.length;
    }
  }
}

window.openNotifPanel = async() => {
  const panel = document.getElementById('notifPanel');
  const list  = document.getElementById('notifPanelList');
  if(!panel||!list) return;
  panel.style.display='block';
  list.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:13px;">로딩 중...</div>';
  try{
    await _fetchNotifsPage(true);
    if(!_notifPanelState.notifs.length){
      list.innerHTML='<div style="padding:32px 16px;text-align:center;color:#bbb;font-size:13px;">📭 알림이 없어요</div>';
      return;
    }
    list.innerHTML = _notifPanelState.notifs.map(_renderNotifRow).join('') + _renderNotifPanelMore();
  }catch(e){ console.warn(e); list.innerHTML='<div style="padding:20px;color:#e05050;">불러오기 실패</div>'; }
};

window.loadMoreNotifs = async() => {
  const btn = document.querySelector('#notifMoreWrap button');
  if (btn) { btn.disabled = true; btn.textContent = '로딩 중...'; }
  try {
    const prevLen = _notifPanelState.notifs.length;
    await _fetchNotifsPage(false);
    const list = document.getElementById('notifPanelList');
    if (!list) return;
    const added = _notifPanelState.notifs.slice(prevLen);
    const moreWrap = document.getElementById('notifMoreWrap');
    if (moreWrap) moreWrap.remove();
    list.insertAdjacentHTML('beforeend', added.map(_renderNotifRow).join('') + _renderNotifPanelMore());
  } catch(e) { console.warn('[loadMoreNotifs]', e); if (btn) { btn.disabled = false; btn.textContent = `+ ${NOTIF_PAGE_SIZE}개 더 보기`; } }
};

// 알림 패널 행에 첨부 표시 (HTML 문자열 반환 — innerHTML 안에 박힘)
function _renderNotifRowAttachment(att) {
  const expMs = att.expiresAt ? new Date(att.expiresAt).getTime() : 0;
  const expired = expMs > 0 && Date.now() > expMs;
  const expDate = expMs > 0 ? new Date(expMs).toLocaleDateString('ko-KR') : '';
  const sizeStr = att.sizeKB ? ` (${att.sizeKB} KB)` : '';
  if (expired) {
    return `<div style="margin-top:6px;padding:6px 8px;background:#f5f5f5;border-radius:6px;font-size:11px;color:#888;">${esc(att.name)}${sizeStr} - 보관 만료</div>`;
  }
  return `<div style="margin-top:6px;padding:6px 10px;background:#fff7f4;border:1px solid #f5d0c2;border-radius:6px;font-size:12px;">
    <div style="font-weight:600;color:var(--text);">${esc(att.name)}${sizeStr}</div>
    <a href="${esc(att.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation();"
      style="display:inline-block;margin-top:4px;padding:4px 10px;background:var(--c-brand,#E8714A);color:#fff;text-decoration:none;border-radius:4px;font-size:11px;font-weight:600;">파일 다운로드</a>
    ${expDate ? `<span style="font-size:10px;color:var(--gray);margin-left:6px;">${esc(expDate)} 까지</span>` : ''}
  </div>`;
}

window.readNotif = async(docId) => {
  try{
    await updateDoc(doc(db,'userNotifications',docId),{read:true});
    // 서지컬 갱신 — 전체 재fetch 폐기 (2026-06-18, reads 0 추가)
    const entry = _notifPanelState.notifs.find(n => n.id === docId);
    if (entry) entry.read = true;
    const row = document.getElementById('notifRow-'+docId);
    if (row) {
      row.style.background = 'white';
      const icon = row.querySelector('[data-role="notif-icon"]');
      if (icon) icon.textContent = '🔔';
      const titleEl = row.querySelector('[data-role="notif-title"]');
      if (titleEl) {
        titleEl.style.fontWeight = '500';
        titleEl.style.color = '#555';
      }
    }
    await updateNotifBadge();
  }catch(e){console.warn(e);}
};

window.closeNotifPanel = () => {
  const panel = document.getElementById('notifPanel');
  if(panel) panel.style.display='none';
};

window.markAllNotifsRead = async() => {
  if(!currentUser) return;
  try{
    const snap = await getDocs(query(
      collection(db,'userNotifications'),
      where('uid','==',currentUser.uid),
      where('read','==',false)
    ));
    await Promise.all(snap.docs.map(d=>updateDoc(d.ref,{read:true})));
    // 서지컬 갱신 — 전체 재fetch 폐기 (2026-06-18)
    _notifPanelState.notifs.forEach(n => { n.read = true; });
    const list = document.getElementById('notifPanelList');
    if (list && _notifPanelState.notifs.length) {
      list.innerHTML = _notifPanelState.notifs.map(_renderNotifRow).join('') + _renderNotifPanelMore();
    }
    await updateNotifBadge(0);
    showToast('모두 읽음 처리됐어요!');
  }catch(e){console.warn(e);}
};
