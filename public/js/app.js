import { initializeApp, getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, updatePassword, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc, query, where, orderBy, serverTimestamp, increment, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
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
    err.textContent = e.code==='auth/invalid-credential'?'비밀번호가 틀렸습니다.':'오류: '+(e.code||e.message);
  }
};

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
// 공용 뱃지 업데이트 (genTests 기반, testMode 별칭 수용)
async function _updateGenTestBadge(testModes, badgeId) {
  const badge = document.getElementById(badgeId);
  if (!badge || !currentUser || !userProfile) return;
  try {
    const myGroup = userProfile.group || '';
    const myUid = currentUser.uid;
    const snap = await getDocs(query(collection(db,'genTests'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('createdAt','desc')));
    const myTests = filterMyTests(snap.docs.map(d => ({id:d.id,...d.data()})), myGroup, myUid)
      .filter(t => testModes.includes(t.testMode));
    const completedSet = new Set();
    await Promise.all(myTests.map(async t => {
      try {
        const d = await getDoc(doc(db,'genTests',t.id,'userCompleted',myUid));
        if (d.exists() && d.data().score !== undefined) completedSet.add(t.id);
      } catch(e) {}
    }));
    const unfinished = myTests.filter(t => !completedSet.has(t.id)).length;
    if (unfinished > 0) {
      badge.textContent = unfinished > 99 ? '99+' : unfinished;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  } catch(e) { badge.style.display = 'none'; }
}

const updateTestBadge   = () => _updateGenTestBadge(['vocab'], 'testBadge');
const updateMcqBadge    = () => _updateGenTestBadge(['mcq'], 'mcqBadge');
const updateFbBadge     = () => _updateGenTestBadge(['fill_blank'], 'blankBadge');

async function loadNoticePreview(){
  const group = userProfile?.group||'';
  const snap = await getDocs(query(collection(db,'notices'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','desc')));
  allNotices = snap.docs.map(d=>({id:d.id,...d.data()})).filter(n=>n.target==='all'||n.target===group);
  const el = document.getElementById('noticePreview');
  if(!allNotices.length){el.innerHTML='<div class="empty-msg">공지사항이 없습니다</div>';return;}
  el.innerHTML = allNotices.slice(0,3).map(n=>`
    <div class="notice-item" onclick="viewNotice('${n.id}')">
      <div class="notice-dot"></div>
      <div class="notice-item-text">
        <div class="notice-item-title">${esc(n.title)}</div>
        <div class="notice-item-meta"><span class="notice-tag${n.target==='all'?' all':''}">${n.target==='all'?'전체':esc(n.target)}</span><span>${esc(n.date||'')}</span></div>
      </div>
    </div>`).join('');
}

async function loadHwFiles(){
  const group = userProfile?.group||'';
  const uid = currentUser?.uid||'';
  const snap = await getDocs(query(collection(db,'hwFiles'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','desc')));
  const files = snap.docs.map(d=>({id:d.id,...d.data()})).filter(f=>{
    if(f.group==='전체') return true;
    if(f.group===group) return true;
    if(f.targetUid && f.targetUid===uid) return true;
    return false;
  });

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
        <div class="file-meta"><span class="notice-tag${f.group==='전체'?' all':''}">${f.group==='전체'?'전체':esc(f.group)}</span><span>${esc(f.date||'')}</span></div>
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

// ── 공지 보기 ─────────────────────────────────────────────
window.viewNotice = noticeId => {
  const n = allNotices.find(n=>n.id===noticeId); if(!n) return;
  document.getElementById('noticeFullList').innerHTML=`
    <div class="notice-full-item">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span class="notice-tag${n.target==='all'?' all':''}">${n.target==='all'?'전체':n.target}</span>
        <span style="font-size:12px;color:var(--gray);">${n.date||''}</span>
      </div>
      <div class="notice-full-title" style="font-size:17px;margin-bottom:14px;">${esc(n.title)}</div>
      <div class="notice-content">${esc(n.content)}</div>
    </div>`;
  document.getElementById('noticeScreenTitle').textContent='공지사항';
  document.getElementById('noticeBackBtn').onclick = ()=>show('home');
  show('noticeScreen');
};

window.goNoticeList = async()=>{
  const group=userProfile?.group||'';
  const snap=await getDocs(query(collection(db,'notices'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','desc')));
  allNotices=snap.docs.map(d=>({id:d.id,...d.data()})).filter(n=>n.target==='all'||n.target===group);
  document.getElementById('noticeFullList').innerHTML=allNotices.map(n=>`
    <div class="notice-full-item" onclick="viewNotice('${n.id}')" style="cursor:pointer;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <div class="notice-full-title" style="margin-bottom:0;">${esc(n.title)}</div>
        <span style="color:var(--teal);font-size:18px;">›</span>
      </div>
      <div class="notice-full-meta"><span class="notice-tag${n.target==='all'?' all':''}">${n.target==='all'?'전체':esc(n.target)}</span><span>${esc(n.date||'')}</span></div>
    </div>`).join('')||'<div class="empty-msg">공지사항이 없습니다</div>';
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
  const today = new Date().toISOString().slice(0,10);

  const data = {
    uid: currentUser.uid,
    userName: userProfile?.name || '',
    latestScore: score,
    latestPassed: passed,
    latestDate: today,
    latestAt: serverTimestamp(),
  };

  const isNewBest = passed && score > prevBest;
  if (isNewBest) {
    Object.assign(data, {
      score, passed: true, passScore,
      correct, wrong, total,
      questions: questions || [],
      answers: answers || [],
      date: today,
      completedAt: serverTimestamp(),
      ...(extra || {}),
    });
  }

  await setDoc(compRef, data, { merge: true });

  if (isNewBest && existing?.score !== undefined) {
    showToast(`🎉 새 기록! ${existing.score}점 → ${score}점`);
  } else if (passed && existing?.score !== undefined && !isNewBest) {
    showToast(`기존 최고점 ${existing.score}점 유지`);
  }
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
async function _loadTestListByType(type) {
  const ui = TEST_TYPE_UI[type];
  const elP = document.getElementById(ui.pendingElId);
  const elC = document.getElementById(ui.completedElId);
  if (elP) elP.innerHTML = '<div class="empty-msg" style="padding:20px;">로딩 중...</div>';
  try {
    const myGroup = userProfile?.group || '';
    const myUid = currentUser?.uid || '';
    const snap = await getDocs(query(collection(db,'genTests'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('createdAt','desc')));
    const allTests = snap.docs.map(d => ({id:d.id, ...d.data()}));
    const myTests = filterMyTests(allTests, myGroup, myUid).filter(t => t.testMode === type);

    const userCompMap = new Map();
    await Promise.all(myTests.map(async t => {
      try {
        const d = await getDoc(doc(db,'genTests',t.id,'userCompleted',myUid));
        if (d.exists()) userCompMap.set(t.id, d.data());
      } catch(e) {}
    }));

    const isCompleted = t => userCompMap.get(t.id)?.score !== undefined;
    const pending = myTests.filter(t => !isCompleted(t));
    const completed = myTests.filter(isCompleted);
    const quote = v => String(v||'').replace(/'/g,"\\'");
    const ocNew  = (id, name) => `${ui.startFn}('${id}','${quote(name)}')`;
    const ocDone = (id, name) => `${ui.viewPrevFn}('${id}','${quote(name)}')`;

    if (elP) elP.innerHTML = pending.length
      ? pending.map(t => _makeTypeCard(type, t, false, ocNew(t.id,t.name), null, userCompMap.get(t.id)?.latestScore)).join('')
      : '<div class="empty-msg" style="padding:20px;color:#bbb;">배정된 시험이 없습니다.</div>';
    if (elC) elC.innerHTML = completed.length
      ? completed.map(t => _makeTypeCard(type, t, true, ocDone(t.id,t.name), userCompMap.get(t.id)?.score ?? null, null)).join('')
      : '<div class="empty-msg" style="padding:20px;color:#bbb;">완료된 시험이 없습니다.</div>';
  } catch(e) {
    console.error(e);
    if (elP) elP.innerHTML = '<div class="empty-msg" style="padding:20px;">불러오기 실패</div>';
  }
}

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
  return `
    <div class="unit-card" onclick="${onclick}">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <div class="unit-name">${esc(t.name||ui.defaultName)}</div>
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

// Gemini API 호출 로거 (학원별 일별 집계, 위젯용)
async function _logApiCall(endpoint){
  try {
    const today = new Date().toISOString().slice(0,10);
    const academyId = window.MY_ACADEMY_ID || 'default';
    await setDoc(doc(db, 'apiUsage', `${academyId}_${today}`), {
      academyId,
      date: today,
      total: increment(1),
      byEndpoint: { [endpoint]: increment(1) },
      lastAt: serverTimestamp(),
    }, { merge: true });
  } catch(e) { /* silent: logging 실패해도 앱 동작엔 영향 없음 */ }
}

function filterMyTests(allTests, myGroup, myUid){
  return allTests.filter(t=>{
    if(!t.active && t.active !== undefined) return false;
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

// ─── 교재이해 (Reading MCQ) 카드 — Phase 2 구현 ───
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
// 교재이해 (Reading MCQ) - Phase 2
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

    // 매 응시마다 선지(①②③④) 위치 셔플 — 객체에 isAnswer 마커가 있어 자동 추적
    const questions = rawQuestions.map(q => {
      if (!Array.isArray(q.choices) || q.choices.length < 2) return { ...q };
      return { ...q, choices: q.choices.slice().sort(() => Math.random() - 0.5) };
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

window.mcqSelect = (choiceIdx) => {
  _mcqTakeState.answers[_mcqTakeState.currentIdx] = choiceIdx;
  _mcqRenderStep();
};

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
  const today = new Date().toISOString().slice(0,10);

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
    const questions = test.questions || [];
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
          html += `<span id="fb-box-${i}-${k}" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:28px;border:2px solid #ddd;background:white;color:#D85A30;border-radius:5px;font-size:17px;font-weight:700;line-height:1;">${esc(ch)}</span>`;
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
    _logApiCall('cleanup-ocr');
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
      box.style.borderColor = '#E8714A';
      box.style.background = '#FFF4ED';
      box.style.color = '#D85A30';
    } else if(isActiveBlank && k === curVal.length){
      box.style.borderColor = '#E8714A';
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
function _fbStartTimer(){
  _fbStopTimer();
  _fbTimeLeft = FB_TIME_PER_Q;
  _fbUpdateTimerUI();
  _fbTimer = setInterval(() => {
    _fbTimeLeft--;
    _fbUpdateTimerUI();
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

function _fbUpdateTimerUI(){
  const txt = document.getElementById('fbTimerText');
  const arc = document.getElementById('fbTimerArc');
  if(txt) txt.textContent = _fbTimeLeft;
  if(arc) arc.style.strokeDashoffset = 113 * (1 - _fbTimeLeft / FB_TIME_PER_Q);
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
  const letterCount = (q.blanks?.[blankIdx] || '').length;
  // 영문/공백만 허용, 최대 letterCount
  value = String(value||'').toLowerCase().replace(/[^a-z\s'-]/g, '').slice(0, letterCount);
  if(!s.answers[qIdx]) s.answers[qIdx] = [];
  s.answers[qIdx][blankIdx] = value;
  const inp = document.getElementById('fb-input-' + blankIdx);
  if(inp && inp.value !== value) inp.value = value;
  _fbRefreshBoxesForBlank(blankIdx);

  // 빈칸이 꽉 차면 다음 빈칸으로 자동 이동
  if(value.length === letterCount && letterCount > 0){
    const totalBlanks = (q.blanks||[]).length;
    if(blankIdx < totalBlanks - 1){
      setTimeout(() => fbFocusBlank(blankIdx + 1), 120);
    }
  }
};

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
  }
};

window.fbNext = async () => {
  _fbStopTimer();
  // 현재 문제 즉시 피드백 (1.5초 하이라이트)
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

    // 정답일 때 정답 단어(들) 음성 재생
    if (allCorrect) _fbSpeakWords(blanks);

    setTimeout(resolve, 1500);
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
  const today = new Date().toISOString().slice(0,10);

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
  const elC = document.getElementById('raListCompleted');
  if(elP) elP.innerHTML = '<div class="empty-msg" style="padding:20px;">로딩 중...</div>';
  try{
    const myGroup = userProfile?.group || '';
    const myUid = currentUser?.uid || '';
    const snap = await getDocs(query(collection(db,'genTests'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('createdAt','desc')));
    const allTests = snap.docs.map(d => ({id:d.id, ...d.data()}));
    const myTests = filterMyTests(allTests, myGroup, myUid).filter(t => t.testMode === 'recording');

    const completedMap = new Map();
    await Promise.all(myTests.map(async t => {
      try{
        const d = await getDoc(doc(db,'genTests',t.id,'userCompleted',myUid));
        if(d.exists()) completedMap.set(t.id, d.data().score ?? null);
      }catch(e){}
    }));

    const pending = myTests.filter(t => !completedMap.has(t.id));
    const completed = myTests.filter(t => completedMap.has(t.id));
    const mk = (t, done, score) => {
      const qCount = t.questionCount || t.questions?.length || 0;
      const name = (t.name||'AI 녹음 시험').replace(/'/g,"\\'");
      const onc = done ? `viewRecAiResult('${t.id}')` : `startRecAi('${t.id}','${name}')`;
      const badge = done
        ? `<span style="font-size:11px;background:#d1fae5;color:#059669;padding:2px 8px;border-radius:20px;font-weight:700;">✓ 완료${score!=null?' '+score+'점':''}</span>`
        : `<span style="font-size:11px;background:#ede9fe;color:#7c3aed;padding:2px 8px;border-radius:20px;">AI · ${qCount}문장</span>`;
      return `<div class="unit-card" onclick="${onc}">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div class="unit-name">🎙 ${esc(t.name||'AI 녹음 시험')}</div>${badge}
          </div>
          <div class="unit-count">${esc(t.bookName||'')}${t.date?' · '+esc(t.date):''}</div>
        </div>
        <span class="unit-arrow" style="color:${done?'#059669':''};">${done?'📊':'›'}</span>
      </div>`;
    };

    if(elP) elP.innerHTML = pending.length
      ? pending.map(t => mk(t,false,null)).join('')
      : '<div class="empty-msg" style="padding:20px;color:#bbb;">배정된 숙제가 없습니다.</div>';
    if(elC) elC.innerHTML = completed.length
      ? completed.map(t => mk(t,true,completedMap.get(t.id))).join('')
      : '<div class="empty-msg" style="padding:20px;color:#bbb;">완료된 숙제가 없습니다.</div>';
  }catch(e){
    console.error(e);
    if(elP) elP.innerHTML = '<div class="empty-msg" style="padding:20px;">불러오기 실패</div>';
  }
}

const updateRecBadge = () => _updateGenTestBadge(['recording'], 'recBadge');

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

    // Phase 5.5: schemaV===2 감지 → v2 플로우로 분기
    const firstQ = questions[0];
    if(firstQ?.schemaV === 2){
      // 이미 완료된 경우 재시험 불가 → 결과 보기로 전환
      if(currentUser){
        try{
          const compSnap = await getDoc(doc(db,'genTests',testId,'userCompleted',currentUser.uid));
          if(compSnap.exists()){
            showToast('이미 제출한 시험이에요. 결과를 표시합니다.');
            return viewRecAiResult(testId);
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

    const today = new Date().toISOString().slice(0,10);

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
// 녹음숙제 v2 — Page 단위 3회 반복 + 배치 제출 + 조건부 피드백 (Phase 5.5)
// 상태 머신: IDLE → RECORDING → TAKE_READY → [Retake|Save] → 다음 회차 or SUBMITTING → RESULT
// ═══════════════════════════════════════════════════════════════════════════

const _RV2_ROUNDS = 3;

let _rv2 = {
  test: null,
  question: null,
  currentRound: 0,
  savedRounds: [],
  currentTake: null,
  stream: null,
  mediaRecorder: null,
  chunks: [],
  isRecording: false,
  timerInterval: null,
  timerStart: 0,
};
let _rv2ResultAudioUrls = [];

function _raStartV2(test, question) {
  _rv2 = {
    test,
    question,
    currentRound: 0,
    savedRounds: [],
    currentTake: null,
    stream: null,
    mediaRecorder: null,
    chunks: [],
    isRecording: false,
    timerInterval: null,
    timerStart: 0,
  };
  show('recAiQuiz');
  _acquireWakeLock();
  _rv2Render();
}

function _rv2FormatDuration(seconds) {
  const s = Math.round(seconds || 0);
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}

// 기존 녹음숙제(recHwDetail) 스타일로 재구성: 코랄 헤더 + 단계바 + 3개 세로 카드
function _rv2Render() {
  const screen = document.getElementById('recAiQuiz');
  if (!screen) return;
  const q = _rv2.question;
  const cur = _rv2.currentRound;

  screen.innerHTML = `
    <!-- 코랄 히어로 헤더 + 숙제 내용 -->
    <div style="background:linear-gradient(150deg,#E8714A,#D85A30);padding:48px 20px 28px;flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <button class="back-btn" style="color:rgba(255,255,255,0.85);font-size:22px;" onclick="rv2Quit()">‹</button>
        <span style="font-size:16px;font-weight:800;color:white;">🤖 AI 녹음숙제</span>
      </div>
      <div style="background:rgba(255,255,255,0.15);border-radius:16px;padding:14px 16px;">
        <div style="font-size:10px;color:rgba(255,255,255,0.75);font-weight:600;margin-bottom:6px;">숙제 내용</div>
        <div style="font-size:14px;color:white;line-height:1.7;white-space:pre-wrap;">${esc(q.instructionKo || '')}</div>
      </div>
    </div>

    <!-- 바디 -->
    <div style="background:var(--bg);border-radius:24px 24px 0 0;margin-top:-14px;flex:1;overflow:hidden;display:flex;flex-direction:column;">
      <div class="scroll-content" style="padding:16px 16px 24px;">

        <!-- 3단계 진행 표시 -->
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:16px;">
          ${_rv2RenderStepBar()}
        </div>

        <!-- 3개 회차 카드 -->
        ${[0,1,2].map(i => _rv2RenderRoundCard(i, cur)).join('')}

      </div>
    </div>
  `;
}

function _rv2RenderStepBar() {
  const circleStyle = (i) => {
    if (_rv2.savedRounds[i] != null) return 'background:#059669;color:white;';
    if (i === _rv2.currentRound) return 'background:#E8714A;color:white;';
    return 'background:#FFE0D4;color:#E8714A;';
  };
  const content = (i) => _rv2.savedRounds[i] != null ? '✓' : (i+1);
  const lineFill = (i) => _rv2.savedRounds[i] != null ? 100 : 0;
  return `
    <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;${circleStyle(0)}">${content(0)}</div>
    <div style="flex:1;height:3px;background:#FFE0D4;border-radius:2px;"><div style="width:${lineFill(0)}%;height:3px;background:#059669;border-radius:2px;transition:width .4s;"></div></div>
    <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;${circleStyle(1)}">${content(1)}</div>
    <div style="flex:1;height:3px;background:#FFE0D4;border-radius:2px;"><div style="width:${lineFill(1)}%;height:3px;background:#059669;border-radius:2px;transition:width .4s;"></div></div>
    <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;${circleStyle(2)}">${content(2)}</div>
  `;
}

function _rv2RenderRoundCard(i, cur) {
  const saved = _rv2.savedRounds[i];
  const isCurrent = (i === cur) && !saved;
  const isFuture = (i > cur);
  const isRecording = isCurrent && _rv2.isRecording;
  const hasTake = isCurrent && !!_rv2.currentTake;
  const isLast = (i === 2);

  // 상태 뱃지
  let statusBadge;
  if (saved)           statusBadge = '<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:#d1fae5;color:#059669;font-weight:700;">✓ 저장됨</span>';
  else if (isRecording) statusBadge = '<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:#fee2e2;color:#DC2626;font-weight:700;">● 녹음 중</span>';
  else if (hasTake)     statusBadge = '<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:#FFF5E5;color:#BA7517;font-weight:700;">녹음 완료</span>';
  else if (isCurrent)   statusBadge = '<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:#FFE0D4;color:#E8714A;font-weight:700;">진행 중</span>';
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
    buttonsHtml = `
      <div style="display:flex;gap:8px;">
        <button onclick="rv2StopRecord()" style="flex:1;padding:12px;border-radius:12px;border:none;background:#DC2626;color:white;font-size:13px;font-weight:700;cursor:pointer;">⏹ 녹음 종료</button>
      </div>
      <div id="rv2Timer" style="text-align:center;font-size:14px;font-weight:700;color:var(--text);margin-top:8px;font-variant-numeric:tabular-nums;">00:00</div>
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
        <button onclick="rv2StartRecord()" style="flex:1;padding:12px;border-radius:12px;border:none;background:#E8714A;color:white;font-size:13px;font-weight:700;cursor:pointer;">🎙 녹음</button>
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
    _rv2.timerStart = Date.now();
    _rv2Render();

    _rv2.timerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - _rv2.timerStart) / 1000);
      const el = document.getElementById('rv2Timer');
      if (el) el.textContent = _rv2FormatDuration(sec);
    }, 250);
  } catch(e) {
    console.error(e);
    showToast('마이크 접근 실패: ' + (e.message || '권한을 허용해주세요'));
  }
};

window.rv2StopRecord = () => {
  if (!_rv2.mediaRecorder || !_rv2.isRecording) return;
  _rv2.mediaRecorder.stop();
  _rv2.stream?.getTracks()?.forEach(t => t.stop());
  _rv2.isRecording = false;
  if (_rv2.timerInterval) { clearInterval(_rv2.timerInterval); _rv2.timerInterval = null; }
};

function _rv2AfterStop(mime) {
  const blob = new Blob(_rv2.chunks, { type: mime });
  const url = URL.createObjectURL(blob);
  const duration = Math.floor((Date.now() - _rv2.timerStart) / 1000);
  if (_rv2.currentTake?.url) URL.revokeObjectURL(_rv2.currentTake.url);
  _rv2.currentTake = { blob, url, mime, duration };
  _rv2Render();
}

window.rv2Retake = () => {
  if (_rv2.currentTake?.url) URL.revokeObjectURL(_rv2.currentTake.url);
  _rv2.currentTake = null;
  _rv2Render();
};

window.rv2SaveRound = async () => {
  if (!_rv2.currentTake) return;
  _rv2.savedRounds.push(_rv2.currentTake);
  _rv2.currentTake = null;
  if (_rv2.currentRound === _RV2_ROUNDS - 1) {
    await _rv2Submit();
    return;
  }
  _rv2.currentRound++;
  _rv2Render();
};

window.rv2Quit = async () => {
  if (_rv2.isRecording) {
    _rv2.mediaRecorder?.stop();
    _rv2.stream?.getTracks()?.forEach(t => t.stop());
    _rv2.isRecording = false;
    if (_rv2.timerInterval) { clearInterval(_rv2.timerInterval); _rv2.timerInterval = null; }
  }
  const hasProgress = _rv2.savedRounds.length > 0 || _rv2.currentTake != null;
  if (hasProgress) {
    if (!(await showConfirm('녹음을 중단할까요?', '지금까지의 녹음은 저장되지 않습니다.'))) return;
  }
  _rv2.savedRounds.forEach(r => r?.url && URL.revokeObjectURL(r.url));
  if (_rv2.currentTake?.url) URL.revokeObjectURL(_rv2.currentTake.url);
  goHome();
};

function _rv2BlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

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
      <div style="font-size:52px;margin-bottom:16px;">🤖</div>
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">${esc(title)}</div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:18px;">${esc(subtitle)}</div>
      <div style="width:200px;height:4px;background:#e5e7eb;border-radius:4px;overflow:hidden;">
        <div style="width:40%;height:100%;background:linear-gradient(90deg,#8B5CF6,#6366F1);animation:rv2Slide 1.3s ease-in-out infinite;"></div>
      </div>
      <style>@keyframes rv2Slide { 0%{margin-left:-40%;} 100%{margin-left:100%;} }</style>
    </div>
  `;
}

async function _rv2Submit() {
  if (_rv2.savedRounds.length !== _RV2_ROUNDS) {
    showToast('3회 녹음이 모두 필요합니다');
    return;
  }
  if (_rv2._submitted || _rv2._submitting) return;
  _rv2._submitting = true;
  const t = _rv2.test;
  const q = _rv2.question;
  const threshold = q.accuracyThreshold || 70;
  const evalSec = q.evaluationSeconds || 60;
  if (!currentUser) { _rv2._submitting = false; showToast('로그인이 필요해요'); return; }

  _rv2ShowSubmitting('🎤 녹음 업로드 중...', '3개 파일 Storage 에 저장');

  let stage = 'upload';
  try {
    console.log('[rv2Submit] START', { testId: t.id, rounds: _rv2.savedRounds.length });
    const storage = getStorage();
    const uploadResults = await Promise.all(_rv2.savedRounds.map(async (r, i) => {
      const ext = r.mime.includes('mp4') ? 'm4a' : 'webm';
      const path = `recordings/genTests/${t.id}/${currentUser.uid}/r${i+1}_${Date.now()}.${ext}`;
      const fileRef = ref(storage, path);
      console.log(`[rv2Submit] upload ${i+1} → ${path} (${r.blob.size} bytes)`);
      await uploadBytes(fileRef, r.blob);
      const url = await getDownloadURL(fileRef);
      console.log(`[rv2Submit] uploaded ${i+1} ✓`);
      return { round: i + 1, audioUrl: url, duration: r.duration };
    }));
    console.log('[rv2Submit] upload done');

    _rv2ShowSubmitting('🤖 AI 평가 중...', '3개 녹음을 동시에 평가해요 (10~15초)');
    stage = 'check';

    const checkResults = await Promise.all(_rv2.savedRounds.map(async (r, i) => {
      try {
        // Gemini 전송용으로 앞부분만 잘라 전송 (토큰 비용 82% 절감)
        const trimmed = await _trimAudioForGemini(r.blob, evalSec + 5);
        const base64 = await _rv2BlobToBase64(trimmed);
        const sendMime = trimmed.type || r.mime;
        console.log(`[rv2Submit] check ${i+1} base64 len=${base64.length} mime=${sendMime}`);
        const idToken = currentUser ? await currentUser.getIdToken() : '';
        const res = await fetch('/api/check-recording', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken,
            mode: 'check',
            originalText: q.fullText,
            audioBase64: base64,
            mimeType: sendMime,
            evaluationSeconds: evalSec,
          }),
        });
        _logApiCall('check-recording');
        const data = await res.json();
        if (!res.ok || !data.success) {
          console.warn(`[rv2Submit] check ${i+1} failed`, res.status, data);
          return { round: i + 1, score: 0, missedWords: [], note: `평가 실패: ${data?.error || res.status}`, error: true };
        }
        // 서버가 200 을 주지만 score=0 + note 가 있는 케이스 (JSON 파싱 실패, 오디오 인식 실패 등)
        const isError = data.score === 0 && /해석하지 못|오디오 인식|평가 실패|Failed/i.test(data.note || '');
        console.log(`[rv2Submit] check ${i+1} score=${data.score}${isError?' (err)':''}`);
        return { round: i + 1, score: data.score, missedWords: data.missedWords || [], note: data.note || '', error: isError };
      } catch(e) {
        console.error(`[rv2Submit] check ${i+1} exception`, e);
        return { round: i + 1, score: 0, missedWords: [], note: '네트워크 에러: '+(e.message||''), error: true };
      }
    }));
    console.log('[rv2Submit] check done', checkResults.map(r => r.score));

    const lastResult = checkResults[_RV2_ROUNDS - 1];
    const lastScore = lastResult.score;
    const passed = lastScore >= threshold;

    let feedback = null;
    if (passed && !lastResult.error) {
      _rv2ShowSubmitting('💬 상세 피드백 생성 중...', '마지막 녹음이 임계점을 통과했어요!');
      try {
        const lastBlob = _rv2.savedRounds[_RV2_ROUNDS - 1].blob;
        const trimmed = await _trimAudioForGemini(lastBlob, evalSec + 5);
        const base64 = await _rv2BlobToBase64(trimmed);
        const sendMime = trimmed.type || _rv2.savedRounds[_RV2_ROUNDS - 1].mime;
        const idToken2 = currentUser ? await currentUser.getIdToken() : '';
        const fbRes = await fetch('/api/check-recording', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken: idToken2,
            mode: 'feedback',
            originalText: q.fullText,
            audioBase64: base64,
            mimeType: sendMime,
            evaluationSeconds: evalSec,
          }),
        });
        _logApiCall('check-recording');
        const fbData = await fbRes.json();
        if (fbRes.ok && fbData.success) {
          feedback = {
            missedWords: fbData.missedWords || [],
            weakPronunciation: fbData.weakPronunciation || [],
            tips: fbData.tips || [],
          };
        }
      } catch(e) { console.warn('feedback failed', e); }
    }

    _rv2ShowSubmitting('💾 결과 저장 중...', '곧 결과 화면으로 이동해요');
    stage = 'firestore';
    const today = new Date().toISOString().slice(0,10);

    const recordingsDetail = uploadResults.map((u, i) => ({
      ...u,
      score: checkResults[i].score,
      missedWords: checkResults[i].missedWords,
      note: checkResults[i].note,
      ...(i === _RV2_ROUNDS - 1 && feedback ? { feedback } : {}),
    }));

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
      score: lastScore,
      correct: passed ? 1 : 0,
      wrong: passed ? 0 : 1,
      total: 1,
      passed,
      passScore: threshold,
      recordings: recordingsDetail,
      date: today,
      createdAt: serverTimestamp(),
    });

    try {
      await setDoc(
        doc(db,'genTests',t.id,'userCompleted',currentUser.uid),
        {
          uid: currentUser.uid,
          userName: userProfile?.name || '',
          score: lastScore,
          date: today,
          recordings: recordingsDetail,
          completedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch(e) { console.warn('genTest 완료 기록 실패', e); }

    _rv2.savedRounds.forEach(r => r?.url && URL.revokeObjectURL(r.url));
    const allAudioUrls = uploadResults.map(u => u.audioUrl);
    console.log('[rv2Submit] DONE');
    _rv2._submitted = true;
    _rv2RenderResult(checkResults, feedback, passed, threshold, allAudioUrls);
  } catch(e) {
    console.error(`[rv2Submit] FAILED at stage=${stage}`, e);
    _rv2._submitting = false;  // 재시도 가능하도록
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

    // Phase 5.5 v2 판정 (audioUrl + score 둘 다 있어야 3회차 결과로 재구성 가능)
    const isV2 = recordings.length >= 2 && recordings[0]?.audioUrl && recordings[0]?.score !== undefined;
    if (!isV2) {
      // Phase 5 구버전 완료 — 간단한 결과 카드만
      showToast(`완료됨: ${completed.score ?? '-'}점 · ${completed.date || ''}`);
      return;
    }

    const test = testSnap.exists() ? testSnap.data() : {};
    const q = test.questions?.[0] || {};
    const threshold = q.accuracyThreshold || 70;

    const checkResults = recordings.map((r, i) => ({
      round: r.round || (i + 1),
      score: r.score ?? 0,
      missedWords: r.missedWords || [],
      note: r.note || '',
    }));

    const lastRec = recordings[recordings.length - 1];
    const feedback = lastRec?.feedback || null;
    const passed = (lastRec?.score ?? 0) >= threshold;
    const allAudioUrls = recordings.map(r => r.audioUrl || '');

    show('recAiQuiz');
    _rv2RenderResult(checkResults, feedback, passed, threshold, allAudioUrls);
  } catch(e) {
    console.error(e);
    showToast('결과 불러오기 실패: ' + e.message);
  }
};

function _rv2RenderResult(checkResults, feedback, passed, threshold, allAudioUrls) {
  _releaseWakeLock();
  _rv2ResultAudioUrls = allAudioUrls || [];
  const screen = document.getElementById('recAiQuiz');
  if (!screen) return;

  const lastScore = checkResults[_RV2_ROUNDS - 1].score;
  const avg = Math.round(checkResults.reduce((s, r) => s + (r.score || 0), 0) / checkResults.length);
  const emoji = passed ? '🎉' : '💪';
  const headline = passed ? '훌륭해요!' : '아깝네요!';
  const subline = passed
    ? 'AI 피드백을 확인해보세요'
    : `마지막 녹음이 임계점(${threshold}점)에 미달해 상세 피드백은 제공되지 않아요`;

  screen.innerHTML = `
    <div style="flex:1;overflow-y:auto;padding:20px 16px;">

      <div style="background:white;border-radius:16px;padding:24px 20px;box-shadow:0 2px 12px rgba(0,0,0,0.08);text-align:center;margin-bottom:14px;">
        <div style="font-size:56px;margin-bottom:6px;">${emoji}</div>
        <div style="font-size:20px;font-weight:800;color:var(--text);">${headline}</div>
        <div style="font-size:11px;color:var(--gray);margin-top:4px;line-height:1.5;">${esc(subline)}</div>
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid #eee;display:flex;justify-content:space-around;">
          <div>
            <div style="font-size:10px;color:var(--gray);margin-bottom:3px;">최종 (3회차)</div>
            <div style="font-size:28px;font-weight:800;color:${passed ? '#059669' : '#CA8A04'};line-height:1;">${lastScore}</div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--gray);margin-bottom:3px;">3회 평균</div>
            <div style="font-size:28px;font-weight:800;color:var(--text);line-height:1;">${avg}</div>
          </div>
        </div>
      </div>

      <div style="background:white;border-radius:14px;padding:14px 16px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:8px;">📊 회차별 점수</div>
        ${checkResults.map((r, i) => {
          const isLast = i === _RV2_ROUNDS - 1;
          const pass = r.score >= threshold;
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;${i < _RV2_ROUNDS - 1 ? 'border-bottom:1px solid #f3f4f6;' : ''}">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="width:22px;height:22px;border-radius:50%;background:${pass ? '#d1fae5' : '#fef3c7'};color:${pass ? '#059669' : '#CA8A04'};display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">${r.round}</span>
                <span style="font-size:13px;${isLast ? 'font-weight:700;color:var(--text);' : 'color:var(--gray);'}">${isLast ? '마지막 녹음 (피드백 대상)' : r.round + '회차'}</span>
              </div>
              <span style="font-size:15px;font-weight:700;color:${pass ? '#059669' : '#CA8A04'};">${r.score}점</span>
            </div>
            ${r.error ? `
              <div style="padding:6px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;font-size:11px;color:#DC2626;margin-top:2px;margin-bottom:6px;word-break:break-word;">
                ⚠️ ${esc(r.note || '평가 실패')}
              </div>` : (r.missedWords?.length > 0 && isLast ? `
              <div style="padding:6px 12px;background:#fef2f2;border-radius:4px;font-size:11px;color:#DC2626;margin-top:4px;">
                놓친 단어: ${r.missedWords.map(w => `<strong>${esc(w)}</strong>`).join(', ')}
              </div>` : '')}
          `;
        }).join('')}
      </div>

      <div style="background:white;border-radius:14px;padding:14px 16px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:10px;">🎧 내 녹음 다시 듣기</div>
        ${checkResults.map((r, i) => {
          const isLast = i === _RV2_ROUNDS - 1;
          const audioUrl = _rv2ResultAudioUrls[i] || '';
          return `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:${i < _RV2_ROUNDS - 1 ? '8px' : '0'};">
              <span style="width:22px;height:22px;border-radius:50%;background:${isLast ? '#8B5CF6' : '#E5E7EB'};color:${isLast ? 'white' : '#6B7280'};display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${r.round}</span>
              <audio src="${esc(audioUrl)}" controls preload="none" style="flex:1;height:32px;"></audio>
              <span style="font-size:11px;color:var(--gray);min-width:36px;text-align:right;">${r.score}점</span>
            </div>
          `;
        }).join('')}
        <div style="font-size:10px;color:var(--gray);margin-top:8px;text-align:center;">3회차(보라)가 피드백 대상 녹음이에요</div>
      </div>

      ${passed && feedback ? `
        <div style="background:white;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <div style="font-size:11px;font-weight:700;color:#7C3AED;margin-bottom:10px;">🤖 AI 피드백 (3회차 기준)</div>
          ${feedback.missedWords?.length ? `
            <div style="margin-bottom:12px;">
              <div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:5px;">📝 생략된 단어</div>
              <div style="font-size:12px;">
                ${feedback.missedWords.map(w => `<span style="background:#fee2e2;color:#DC2626;padding:2px 8px;border-radius:4px;margin-right:4px;display:inline-block;margin-bottom:3px;">${esc(w)}</span>`).join('')}
              </div>
            </div>` : ''}
          ${feedback.weakPronunciation?.length ? `
            <div style="margin-bottom:12px;">
              <div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:5px;">🔊 발음 개선</div>
              ${feedback.weakPronunciation.map(p => `
                <div style="font-size:12px;padding:6px 10px;background:#fef3c7;border-left:2px solid #CA8A04;margin-bottom:4px;border-radius:3px;">
                  <strong>${esc(p.word)}</strong> → ${esc(p.issue)}
                </div>`).join('')}
            </div>` : ''}
          ${feedback.tips?.length ? `
            <div>
              <div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:5px;">💡 개선 팁</div>
              ${feedback.tips.map(t => `<div style="font-size:12px;color:var(--text);padding:5px 0;line-height:1.5;">• ${esc(t)}</div>`).join('')}
            </div>` : ''}
        </div>
      ` : ''}

      <div style="display:flex;gap:10px;margin-top:16px;">
        <button onclick="goHome()" style="flex:1;padding:14px;background:#8B5CF6;border:none;border-radius:12px;font-size:14px;font-weight:700;color:white;cursor:pointer;">홈으로</button>
      </div>
    </div>
  `;
}


// ── 랭킹 ─────────────────────────────────────────────────
window.goRanking=async()=>{
  document.getElementById('rankingGroupTitle').textContent='🏫 '+(userProfile?.group||'그룹');
  await renderRanking('score');show('ranking');
};
window.switchRankTab=async (tab)=>{
  document.querySelectorAll('.ranking-tab').forEach((t,i)=>t.classList.toggle('active',(tab==='score'&&i===0)||(tab==='hw'&&i===1)));
  document.getElementById('rankScoreList').style.display=tab==='score'?'':'none';
  document.getElementById('rankHwList').style.display=tab==='hw'?'':'none';
  await renderRanking(tab);
};
async function renderRanking(tab){
  const group=userProfile?.group,meUid=currentUser?.uid;
  const colors=['#E8714A','#EF9F27','#D4537E','#F4936A','#f5a623','#e05050'];
  const usersSnap=await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID),where('group','==',group)));
  const students=usersSnap.docs.map(d=>({uid:d.id,...d.data()})).filter(u=>u.role==='student');
  if(tab==='score'){
    const scoresSnap=await getDocs(query(collection(db,'scores'),where('academyId','==',window.MY_ACADEMY_ID),where('group','==',group)));
    const scoresMap={};
    scoresSnap.docs.forEach(d=>{
      const s=d.data();
      if(!scoresMap[s.uid]) scoresMap[s.uid]={best:0, count:0, total:0};
      // 모든 mode 점수 반영 (spelling/meaning/mixed/word/unscramble)
      if(s.score > scoresMap[s.uid].best) scoresMap[s.uid].best = s.score;
      scoresMap[s.uid].count++;
      scoresMap[s.uid].total += (s.score||0);
    });
    const sorted=[...students].sort((a,b)=>(scoresMap[b.uid]?.best||0)-(scoresMap[a.uid]?.best||0));
    const maxScore=Math.max(...sorted.map(u=>scoresMap[u.uid]?.best||0), 1);
    const nc=['gold','silver','bronze'];
    // 포디움 업데이트 (top3)
    const podiumEl=document.getElementById('rankPodium');
    if(podiumEl && sorted.length>0){
      const podOrder=[1,0,2]; // 2등,1등,3등 순서로 배치
      const heights=['36px','52px','24px'];
      const sizes=['38px','44px','38px'];
      podiumEl.innerHTML=podOrder.map((idx,pos)=>{
        const u=sorted[idx]; if(!u) return '';
        const s=scoresMap[u?.uid]||{best:0};
        const isFirst=idx===0;
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
          ${isFirst?'<div style="font-size:13px;">👑</div>':'<div style="height:18px;"></div>'}
          <div style="width:${sizes[pos]};height:${sizes[pos]};border-radius:50%;background:rgba(255,255,255,${isFirst?'0.35':'0.22'});display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;">${esc(u.name[0])}</div>
          <div style="font-size:9px;color:rgba(255,255,255,0.9);font-weight:600;max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(u.name)}</div>
          <div style="background:rgba(255,255,255,${isFirst?'0.3':'0.18'});border-radius:8px 8px 0 0;width:56px;height:${heights[pos]};display:flex;align-items:center;justify-content:center;">
            <span style="font-size:10px;font-weight:800;color:white;">${idx+1}위</span>
          </div>
        </div>`;
      }).join('');
    }
    document.getElementById('rankScoreList').innerHTML=sorted.map((u,i)=>{
      const s=scoresMap[u.uid]||{best:0,count:0,total:0};
      const avg = s.count>0 ? Math.round(s.total/s.count) : 0;
      const isMe=u.uid===meUid;
      return `<div class="rank-item${isMe?' me':''}">
        <div class="rank-num ${nc[i]||''}">${i+1}</div>
        <div class="rank-info">
          <div class="rank-name">${esc(u.name)}${isMe?'<span>(나)</span>':''}</div>
          <div style="font-size:11px;color:#aaa;margin-top:1px;">${s.count}회 응시</div>
        </div>
        <div class="rank-score">${s.best}<span style="font-size:11px;color:#aaa;font-weight:400;">점</span></div>
      </div>`;
    }).join('')||'<div class="empty-msg">아직 점수가 없습니다</div>';
  }
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
  _originalShow(id);
};

window.addEventListener('popstate',e=>{
  const cur=document.querySelector('.screen.active');
  const curId=cur?.id;

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

window.installApp=async()=>{
  const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid=/android/i.test(navigator.userAgent);
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
    alert('📱 홈화면 추가 방법 (iOS)\n\n① 하단 공유 버튼 탭 (□↑)\n② "홈 화면에 추가" 선택\n③ 오른쪽 위 "추가" 탭\n\n※ 반드시 Safari에서 열어주세요');
    return;
  }
  // Android 기타 브라우저
  if(isAndroid){
    alert('📱 홈화면 추가 방법 (Android)\n\n① 브라우저 우상단 메뉴(⋮) 탭\n② "홈 화면에 추가" 또는\n   "앱 설치" 선택\n\n※ 크롬 브라우저를 권장해요');
    return;
  }
  // PC
  alert('📱 모바일에서 접속 후\n홈화면에 추가해주세요!');
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
  show('myInfo');
};

window.saveMyInfo=async()=>{
  const name=document.getElementById('myName').value.trim();
  const parentName=document.getElementById('myParentName').value.trim();
  const parentPhone=document.getElementById('myParentPhone').value.trim();
  const newPw=document.getElementById('myNewPw').value.trim();
  if(!name){showToast('이름을 입력하세요.');return;}
  try{
    await updateDoc(doc(db,'users',currentUser.uid),{name,parentName,parentPhone});
    userProfile.name=name; userProfile.parentName=parentName; userProfile.parentPhone=parentPhone;
    const greetEl=document.getElementById('greetName');
    if(greetEl) greetEl.textContent=name+' 님';
    if(newPw){
      if(newPw.length<6){showToast('비밀번호는 6자 이상이어야 합니다.');return;}
      await updatePassword(currentUser,newPw);
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
onAuthStateChanged(auth, async (user)=>{
  if(user){
    // 1일 경과 체크
    const lastLogin = parseInt(localStorage.getItem('lastLoginAt')||'0');
    const elapsed = Date.now() - lastLogin;
    if(lastLogin > 0 && elapsed > ONE_DAY_MS){
      // 1일 초과 → 자동 로그아웃
      await signOut(auth);
      localStorage.removeItem('savedPw');
      localStorage.removeItem('lastLoginAt');
      showToast('보안을 위해 자동 로그아웃됐어요. 다시 로그인해주세요.');
      setTimeout(()=>_originalShow('login'), 1200);
      return;
    }
    // 1일 이내 → 자동 로그인
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

    // 원본 템플릿 복원 + 스펠 input 리스너 재바인딩 (복원된 DOM 에는 기존 리스너 없음)
    _screenPrepare('vocabQuiz', '#vqProgressBar', () => {
      if (typeof _vqBindSpellInput === 'function') _vqBindSpellInput();
    });

    // vocabOptions (기본값 제공)
    const opts = Object.assign(
      { format:'mixed', direction:'mixed', mcqRatio:50, shuffleQ:true, shuffleChoices:true },
      test.vocabOptions || {}
    );

    // 1) 문제 순서 섞기 (재풀이 시에도 매번 새로)
    if (opts.shuffleQ) questions = _rngShuffle(questions);

    // 2) 각 문제에 format/direction 배정
    const answers = questions.map((q, i) => {
      // direction
      let dir = opts.direction;
      if (dir === 'mixed') dir = i % 2 === 0 ? 'en2ko' : 'ko2en';
      // format
      let fmt;
      if (opts.format === 'mixed') {
        fmt = Math.random() * 100 < opts.mcqRatio ? 'mcq' : 'short';
      } else {
        fmt = opts.format;
      }
      // 스펠링 쓰기는 항상 한글→영어 (알파벳 입력)
      if (fmt === 'short') dir = 'ko2en';
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

    _vqState = { test, questions, currentIdx: 0, answers, opts };

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
    if (labelEl) labelEl.textContent = ans.format === 'short' ? '한글 뜻 (영단어 쓰기)' : '한글 뜻';
    if (promptEl) promptEl.textContent = q.meaning || '';
    if (headerHint) {
      if (ans.format === 'short') {
        headerHint.style.display = '';
        headerHint.textContent = `힌트: ${(q.word||'').length}글자`;
      } else headerHint.style.display = 'none';
    }
  }

  // MCQ / 스펠 표시 전환
  if (ans.format === 'mcq') {
    if (choicesArea) { choicesArea.style.display = 'flex'; _vqRenderChoices(ans, choicesArea); }
    if (spellBoxes) spellBoxes.style.display = 'none';
  } else {
    if (spellBoxes) { spellBoxes.style.display = ''; _vqRenderSpellBoxes(ans); }
    if (choicesArea) choicesArea.style.display = 'none';
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
      style="width:${boxW}px;height:${boxW+8}px;font-size:${fontSize}px;border-radius:6px;">${ch||'_'}</div>`;
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

// 타이머 (구버전 스타일: MCQ 10초 / 스펠 30초)
function _vqStartTimer(){
  _vqStopTimer();
  const s = _vqState;
  const ans = s.answers[s.currentIdx];
  const total = ans.format === 'mcq' ? 10 : 30;
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

// MCQ 선택 → 즉시 정답/오답 피드백 → 자동 다음 (구버전 운영 방식)
window.vqSelectMcq = (choiceIdx) => {
  const s = _vqState;
  const ans = s.answers[s.currentIdx];
  if (ans._locked) return;
  ans.input = ans.choices[choiceIdx] || '';
  ans._locked = true;
  _vqStopTimer();
  // 한→영 정답이면 영단어 TTS
  const q = s.questions[s.currentIdx];
  const isCorrect = _vqIsAnsCorrect(q, ans);
  if (isCorrect && ans.direction === 'ko2en' && q.word) _fbSpeakWords([q.word]);
  // 피드백 렌더 (배너 + 보기 색상)
  _vqRenderMcqFeedback(ans);
  // 수동 진행: 제출 버튼을 '다음 ▶' 로 전환, 사용자 클릭 시 _vqAutoNext
  _vqShowNextButton();
};

function _vqRenderMcqFeedback(ans) {
  const s = _vqState;
  const q = s.questions[s.currentIdx];
  const correctText = ans.direction === 'en2ko' ? (q.meaning||'') : (q.word||'');
  const container = document.getElementById('vqChoicesArea');
  if (!container) return;
  container.innerHTML = ans.choices.map((opt, j) => {
    const isUser = opt === ans.input;
    const isCorrect = opt === correctText;
    let bg = 'white', color = 'var(--teal)', border = 'var(--teal)';
    if (isCorrect) { bg = '#d1fae5'; color = '#047857'; border = '#10b981'; }
    else if (isUser) { bg = '#fee2e2'; color = '#b91c1c'; border = '#ef4444'; }
    return `<button disabled
      style="padding:14px 16px;background:${bg};border:2px solid ${border};color:${color};border-radius:14px;font-size:15px;font-weight:700;font-family:inherit;box-shadow:0 2px 4px rgba(0,0,0,0.08);text-align:left;opacity:${isCorrect||isUser?1:0.5};">
      ${['①','②','③','④'][j]} ${esc(opt)}${isCorrect?' ✓':(isUser?' ✗':'')}
    </button>`;
  }).join('');
  // 배너로 결과 표시
  _vqShowFeedbackBanner(ans.input === correctText, correctText);
}

function _vqIsAnsCorrect(q, ans) {
  const user = (ans.input || '').trim().toLowerCase();
  const target = (ans.direction === 'en2ko' ? (q.meaning||'') : (q.word||'')).trim().toLowerCase();
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

  // TTS: 한글→영어 방향에서 정답이면 영단어 발음 재생
  if (isCorrect && ans.direction === 'ko2en' && q.word) {
    _fbSpeakWords([q.word]);
  }

  if (ans.format === 'short') {
    _vqRenderSpellFeedback(ans, isCorrect);
  } else {
    _vqRenderMcqFeedback(ans);
  }
  // 수동 진행: 제출 버튼을 '다음 ▶' 로 전환, 사용자 클릭 시 _vqAutoNext
  _vqShowNextButton();
};

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
    const match = userCh && userCh.toLowerCase() === correctCh.toLowerCase();
    const bg = match ? '#d1fae5' : (userCh ? '#fee2e2' : '#fef3c7');
    const color = match ? '#047857' : (userCh ? '#b91c1c' : '#92400e');
    const border = match ? '#10b981' : (userCh ? '#ef4444' : '#f59e0b');
    const showCh = isCorrect || match ? (userCh || correctCh) : correctCh;
    return `<div class="spell-box" style="width:${boxW}px;height:${boxW+8}px;font-size:${fontSize}px;border-radius:6px;background:${bg};border:2px solid ${border};color:${color};">${esc(showCh)}</div>`;
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
    const ans = s.answers[i];
    const user = (ans.input || '').trim().toLowerCase();
    const target = (ans.direction === 'en2ko' ? (q.meaning||'') : (q.word||'')).trim().toLowerCase();
    if (user && user === target) correct++;
  });

  const score = total ? Math.round((correct / total) * 100) : 0;
  const passScore = t.passScore ?? 80;
  const passed = score >= passScore;
  const today = new Date().toISOString().slice(0,10);

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
    const isCorrect = user && user.toLowerCase() === target.trim().toLowerCase();
    const bg = isCorrect ? '#F0FDF4' : '#FEF2F2';
    const border = isCorrect ? '#BBF7D0' : '#FECACA';
    return `
      <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:10px 12px;margin-bottom:8px;text-align:left;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:11px;color:var(--gray);font-weight:700;">Q${i+1}</span>
          <span style="font-size:12px;color:${isCorrect?'#059669':'#dc2626'};font-weight:700;">${isCorrect?'✓ 정답':'✗ 오답'}</span>
          <span style="font-size:10px;color:var(--gray);">${dir==='en2ko'?'영→한':'한→영'} · ${a.format==='mcq'?'객관식':'단답'}</span>
        </div>
        <div style="font-size:13px;color:var(--text);margin-bottom:3px;font-weight:600;">${esc(prompt)}</div>
        <div style="font-size:11px;color:var(--gray);">
          <span style="color:${isCorrect?'#059669':'#dc2626'};">내답: ${esc(user||'(미입력)')}</span>
          ${!isCorrect ? ` · <span style="color:#059669;">정답: ${esc(target)}</span>` : ''}
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
  if (!(await showConfirm('시험을 중단할까요?','지금까지의 답안은 저장되지 않습니다.'))) return;
  _vqStopTimer();
  goHome();
};

const updateVocabBadge = () => _updateGenTestBadge(['vocab'], 'testBadge');

// updateAllBadges 확장 (vocab)
const _origUpdateAllBadgesForVocab = window.updateAllBadges;
// no-op: updateVocabBadge 는 testBadge 를 관리하므로 기존 updateTestBadge 와 동일 element
// Phase 6D 에서 updateTestBadge 제거 시 updateVocabBadge 로 완전 대체

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
  _uqTimeLeft = 30;
  _uqUpdateTimerUI();
  _uqTimer = setInterval(() => {
    _uqTimeLeft--;
    _uqUpdateTimerUI();
    if (_uqTimeLeft <= 0) {
      _uqStopTimer();
      uqNext({ allowPartial: true });
    }
  }, 1000);
}
function _uqStopTimer(){ if(_uqTimer){ clearInterval(_uqTimer); _uqTimer=null; } }
function _uqUpdateTimerUI(){
  const t = document.getElementById('uqTimerText');
  const arc = document.getElementById('uqTimerArc');
  if (t) t.textContent = _uqTimeLeft;
  if (arc) arc.style.strokeDashoffset = 113 * (1 - _uqTimeLeft / 30);
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
  const today = new Date().toISOString().slice(0,10);

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
const updateUnscBadge2 = () => _updateGenTestBadge(['unscramble'], 'unscrambleBadge');

// 기존 updateTestBadge / updateUnscBadge 호출 지점을 v2 로 연결
window.updateTestBadge = updateVocabBadge;
window.updateUnscBadge = updateUnscBadge2;

// 스펠 input 이벤트 바인딩 (DOM 복원 시마다 재호출 필요)
function _vqBindSpellInput(){
  const inp = document.getElementById('vqSpellInput');
  if (!inp || inp._vqBound) return;
  inp._vqBound = true;
  inp.addEventListener('input', function(){
    const s = _vqState;
    if (!s.answers || !s.questions[s.currentIdx]) return;
    const ans = s.answers[s.currentIdx];
    if (ans.format !== 'short') return;
    const q = s.questions[s.currentIdx];
    const target = ans.direction === 'en2ko' ? (q.meaning||'') : (q.word||'');
    let v = this.value;
    if (ans.direction === 'ko2en') v = v.toLowerCase().replace(/[^a-z\s'-]/g,'');
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
function showNotifModal(title, body, docId){
  const overlay = document.getElementById('notifModalOverlay');
  const titleEl = document.getElementById('notifModalTitle');
  const bodyEl  = document.getElementById('notifModalBody');
  const btn     = document.getElementById('notifModalBtn');
  if(!overlay) return;
  if(titleEl) titleEl.textContent = title;
  if(bodyEl)  bodyEl.textContent  = body;
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
async function checkUnreadNotifs(){
  if(!currentUser) return;
  try{
    const snap = await getDocs(query(
      collection(db,'userNotifications'),
      where('uid','==',currentUser.uid),
      where('read','==',false)
    ));
    await updateNotifBadge(snap.size);
    if(snap.empty) return;
    showUnreadSummaryModal(snap.size);
  }catch(e){ console.log('알림 확인 실패',e); }
}

// 헤더 종 뱃지 업데이트
async function updateNotifBadge(count){
  const badge = document.getElementById('notifBadge');
  if(!badge) return;
  if(count===undefined && currentUser){
    try{
      const snap = await getDocs(query(
        collection(db,'userNotifications'),
        where('uid','==',currentUser.uid),
        where('read','==',false)
      ));
      count = snap.size;
    }catch(e){ count=0; }
  }
  if(count>0){
    badge.textContent = count>9?'9+':count;
    badge.style.display='flex';
  } else {
    badge.style.display='none';
  }
}

// 알림 패널 (헤더 🔔 클릭)
window.openNotifPanel = async() => {
  const panel = document.getElementById('notifPanel');
  const list  = document.getElementById('notifPanelList');
  if(!panel||!list) return;
  panel.style.display='block';
  list.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:13px;">로딩 중...</div>';
  try{
    const snap = await getDocs(query(
      collection(db,'userNotifications'),
      where('uid','==',currentUser.uid)
    ));
    const notifs = snap.docs
      .map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    if(!notifs.length){
      list.innerHTML='<div style="padding:32px 16px;text-align:center;color:#bbb;font-size:13px;">📭 알림이 없어요</div>';
      return;
    }
    list.innerHTML = notifs.map(n=>`
      <div onclick="readNotif('${n.id}')" style="padding:14px 16px;border-bottom:1px solid #f5f5f5;cursor:pointer;background:${n.read?'white':'#f0fafa'};">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:20px;flex-shrink:0;">${n.read?'🔔':'🔴'}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:${n.read?'500':'700'};font-size:14px;color:${n.read?'#555':'#111'};margin-bottom:3px;">${esc(n.title||'알림')}</div>
            <div style="font-size:12px;color:#777;line-height:1.5;">${esc(n.body||'')}</div>
            <div style="font-size:11px;color:#bbb;margin-top:4px;">${n.createdAt?.toDate?n.createdAt.toDate().toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):''}</div>
          </div>
        </div>
      </div>`).join('');
  }catch(e){ list.innerHTML='<div style="padding:20px;color:#e05050;">불러오기 실패</div>'; }
};

window.readNotif = async(docId) => {
  try{
    await updateDoc(doc(db,'userNotifications',docId),{read:true});
    await openNotifPanel();
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
    await openNotifPanel();
    await updateNotifBadge(0);
    showToast('모두 읽음 처리됐어요!');
  }catch(e){console.warn(e);}
};
