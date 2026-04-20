import { initializeApp, getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, updatePassword, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc, query, where, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
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
let adminUnits = [], allGroups = [], allNotices = [];
let selectedHwFile = null;
let lastSelectedUnitId = null;

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
function clearTimers(){if(timerInterval)clearInterval(timerInterval);if(spellTimer)clearInterval(spellTimer);}
function esc(str){return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

// ── 드롭다운 ──────────────────────────────────────────────
window.toggleDropdown = id => {
  ['dd1','dd2'].forEach(d=>{if(d!==id)document.getElementById(d)?.classList.remove('open');});
  document.getElementById(id).classList.toggle('open');
};
document.addEventListener('click', e=>{if(!e.target.closest('.home-header')){document.getElementById('dd1')?.classList.remove('open');document.getElementById('dd2')?.classList.remove('open');}});

// ── 로그인 ─────────────────────────────────────────────────
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
    const snap = await getDocs(query(collection(db,'users'), where('username','==',uid)));
    if(snap.empty){err.textContent='존재하지 않는 아이디입니다.';return;}
    const profile = snap.docs[0].data();
    await signInWithEmailAndPassword(auth, profile.email, pw);
    userProfile = {...profile, uid: snap.docs[0].id};
    currentUser = auth.currentUser;
    localStorage.setItem('lastLoginAt', Date.now().toString());
    if(profile.role==='admin'){
      // PC 관리자 앱으로 이동
      localStorage.setItem('adminProfile', JSON.stringify({...profile, uid: snap.docs[0].id}));
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
  await signOut(auth);
  currentUser=null; userProfile=null; clearTimers();
  localStorage.removeItem('lastLoginAt');
  show('login');
};
window.goHome = ()=>{show('home');clearTimers();clearUnscTimer();updateAllBadges();};

// ── 홈 데이터 ─────────────────────────────────────────────
async function loadHomeData(){
  await Promise.all([loadNoticePreview(), loadHwFiles()]);
  await updateAllBadges(true);
}


async function updateAllBadges(force=false){
  const now = Date.now();
  if(!force && now - _badgeCache.ts < BADGE_TTL) return;
  _badgeCache.ts = now;
  await Promise.all([updateTestBadge(), updateUnscBadge(), updateRecBadge()]);
}
async function updateTestBadge(){
  const badge = document.getElementById('testBadge');
  if(!badge || !currentUser || !userProfile) return;
  try{
    const myGroup = userProfile.group||'';
    const myUid = currentUser.uid;
    const snap = await getDocs(query(collection(db,'tests'), orderBy('createdAt','desc')));
    const allTests = snap.docs.map(d=>({id:d.id,...d.data()}));
    // 내 시험 필터 + 언스크램블 제외 (단어시험만)
    const myTests = allTests.filter(t=>{
      if(!t.active && t.active !== undefined) return false;
      if(t.testMode === 'unscramble') return false;  // 언스크램블은 별도 뱃지
      const targets = t.targets||[];
      if(!targets.length){
        return (t.targetType==='class'&&t.targetId===myGroup)||(t.targetType==='student'&&t.targetId===myUid)||(t.targetId===myGroup);
      }
      return targets.some(tg=>(tg.type==='class'&&tg.id===myGroup)||(tg.type==='student'&&tg.id===myUid));
    });
    // 완료된 시험 확인
    const completedSet = new Set();
    await Promise.all(myTests.map(async t=>{
      try{
        const d = await getDoc(doc(db,'tests',t.id,'userCompleted',myUid));
        if(d.exists()) completedSet.add(t.id);
      }catch(e){console.warn(e);}
    }));
    const unfinished = myTests.filter(t=>!completedSet.has(t.id)).length;
    if(unfinished > 0){
      badge.textContent = unfinished > 99 ? '99+' : unfinished;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }catch(e){ badge.style.display='none'; }
}

async function loadNoticePreview(){
  const group = userProfile?.group||'';
  const snap = await getDocs(query(collection(db,'notices'),orderBy('createdAt','desc')));
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
  const snap = await getDocs(query(collection(db,'hwFiles'),orderBy('createdAt','desc')));
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
  const snap=await getDocs(query(collection(db,'notices'),orderBy('createdAt','desc')));
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

window.goUnits = async()=>{
  const elP = document.getElementById('unitListPending');
  const elC = document.getElementById('unitListCompleted');
  if(elP) elP.innerHTML='<div class="empty-msg" style="padding:20px;">로딩 중...</div>';
  show('units');
  try{
    const myGroup=userProfile?.group||'', myUid=currentUser?.uid||'';
    const snap=await getDocs(query(collection(db,'tests'),orderBy('createdAt','desc')));
    const allTests=snap.docs.map(d=>({id:d.id,...d.data()}));
    const myTests=filterMyTests(allTests,myGroup,myUid).filter(t=>t.testMode!=='unscramble');

    // 완료 정보 (score 포함)
    const completedMap=new Map(); // testId → score
    await Promise.all(myTests.map(async t=>{
      try{
        const d=await getDoc(doc(db,'tests',t.id,'userCompleted',myUid));
        if(d.exists()) completedMap.set(t.id, d.data().score??null);
      }catch(e){console.warn(e);}
    }));

    const pending=myTests.filter(t=>!completedMap.has(t.id));
    const completed=myTests.filter(t=>completedMap.has(t.id));

    const oc = id=>`selectTest('${id}','${(myTests.find(t=>t.id===id)?.name||'').replace(/'/g,"\\'")}')`;
    if(elP) elP.innerHTML=pending.length
      ? pending.map(t=>makeTestCard(t,false,oc(t.id),null)).join('')
      : '<div class="empty-msg" style="padding:20px;color:#bbb;">진행 중인 시험이 없습니다.</div>';
    if(elC) elC.innerHTML=completed.length
      ? completed.map(t=>makeTestCard(t,true,oc(t.id),completedMap.get(t.id))).join('')
      : '<div class="empty-msg" style="padding:20px;color:#bbb;">완료된 시험이 없습니다.</div>';
  }catch(e){
    if(elP) elP.innerHTML=`<div class="empty-msg" style="padding:20px;">불러오기 실패</div>`;
  }
};

// ─── 교재이해 (Reading MCQ) 카드 — Phase 1 플레이스홀더, Phase 2에서 기능 구현 ───
window.goReadingMcq = () => {
  show('readingMcqList');
};

// ─── 빈칸채우기 카드 — Phase 1 플레이스홀더, Phase 3에서 기능 구현 ───
window.goFillBlank = () => {
  show('fillBlankList');
};

window.goUnscramble = async()=>{
  const elP=document.getElementById('unscListPending');
  const elC=document.getElementById('unscListCompleted');
  if(elP) elP.innerHTML='<div class="empty-msg" style="padding:20px;">로딩 중...</div>';
  show('unscrambleList');
  try{
    const myGroup=userProfile?.group||'', myUid=currentUser?.uid||'';
    const snap=await getDocs(query(collection(db,'tests'),orderBy('createdAt','desc')));
    const allTests=snap.docs.map(d=>({id:d.id,...d.data()}));
    const myTests=filterMyTests(allTests,myGroup,myUid).filter(t=>t.testMode==='unscramble');

    const completedMap=new Map();
    await Promise.all(myTests.map(async t=>{
      try{
        const d=await getDoc(doc(db,'tests',t.id,'userCompleted',myUid));
        if(d.exists()) completedMap.set(t.id, d.data().score??null);
      }catch(e){console.warn(e);}
    }));

    const pending=myTests.filter(t=>!completedMap.has(t.id));
    const completed=myTests.filter(t=>completedMap.has(t.id));

    const oc = id=>`startUnscrambleTest('${id}','${(myTests.find(t=>t.id===id)?.name||'').replace(/'/g,"\\'")}')`;
    if(elP) elP.innerHTML=pending.length
      ? pending.map(t=>makeTestCard(t,false,oc(t.id),null)).join('')
      : '<div class="empty-msg" style="padding:20px;color:#bbb;">진행 중인 언스크램블이 없습니다.</div>';
    if(elC) elC.innerHTML=completed.length
      ? completed.map(t=>makeTestCard(t,true,oc(t.id),completedMap.get(t.id))).join('')
      : '<div class="empty-msg" style="padding:20px;color:#bbb;">완료된 항목이 없습니다.</div>';
  }catch(e){
    if(elP) elP.innerHTML='<div class="empty-msg" style="padding:20px;">불러오기 실패</div>';
  }
};

window.selectTest = async(testId, testName)=>{
  currentTestId = testId;
  currentTestName = testName;
  const snap = await getDoc(doc(db,'tests',testId));
  const testDoc = snap.data();
  if(!testDoc){ showToast('시험 정보를 불러올 수 없어요.'); return; }

  currentUnitWords = testDoc.words || [];
  currentUnitId = testId;
  window._currentTestData = testDoc;
  document.getElementById('modeUnitName').textContent = testName;

  // testType이 지정된 경우 (새 출제 방식) → 직접 시작
  const hasTestType = currentUnitWords.some(w => w.testType);
  if(hasTestType){
    // 정보 모달 표시
    const mcCount = currentUnitWords.filter(w=>w.testType==='meaning').length;
    const spCount = currentUnitWords.filter(w=>w.testType==='spelling').length;
    document.getElementById('infoModalTitle').textContent = testName;
    document.getElementById('modalWordCount').textContent = currentUnitWords.length;
    document.getElementById('modalTime').innerHTML =
      `객관식 <b>10초</b> / 주관식 <b>30초</b>`;
    document.getElementById('modalPoint').textContent =
      (window._currentTestData?.passScore ?? 80) + '점 이상';
    document.getElementById('infoModal').classList.remove('hidden');
    // 혼합 모드 플래그
    lastMode = 'mixed';
  } else {
    // 구형 방식 → 모드 선택 화면
    show('modeSelect');
  }
};

window.selectUnit = async(unitId,unitName)=>{
  // 하위 호환 유지
  currentUnitId=unitId;
  document.getElementById('modeUnitName').textContent=unitName;
  const snap=await getDoc(doc(db,'units',unitId));
  currentUnitWords=snap.data()?.words||[];
  show('modeSelect');
};

window.startSession = mode=>{
  lastMode=mode;
  document.getElementById('infoModalTitle').textContent=mode==='spelling'?'스펠링 테스트':'뜻 맞추기';
  document.getElementById('modalWordCount').textContent=currentUnitWords.length;
  document.getElementById('modalTime').textContent=mode==='spelling'?'30':'10';
  document.getElementById('modalPoint').textContent='80';
  document.getElementById('infoModal').classList.remove('hidden');
};

window.doStart = ()=>{
  closeModal('infoModal'); correct=0; wrong=0;
  if(lastMode==='mixed'){
    // testType 기반 혼합 모드
    startMixedTest();
  } else if(lastMode==='meaning'){
    questions=shuffle([...currentUnitWords]); currentQ=0; showQuizQuestion(); show('quiz');
  } else {
    spellQuestions=shuffle([...currentUnitWords]); spellQ=0; showSpellQuestion(); show('spelling');
  }
};

// ── 혼합 시험 진행 (testType 기반) ──────────────────────
let mixedQueue = []; // {word, testType}
let mixedIdx = 0;

function startMixedTest(){
  // testType 순서대로 큐 구성 (이미 섞여 있음)
  mixedQueue = currentUnitWords.map(w=>({word:w, testType:w.testType||'meaning'}));
  mixedIdx = 0;
  correct = 0; wrong = 0;
  showMixedQuestion();
}

function showMixedQuestion(){
  clearTimers();
  if(mixedIdx >= mixedQueue.length){ showResult(); return; }
  const {word, testType} = mixedQueue[mixedIdx];
  if(testType === 'spelling'){
    // 스펠링 모드로 전환
    spellQuestions = [word];
    spellQ = 0;
    // progress 표시 업데이트
    document.getElementById('spellProgress').textContent = `${mixedIdx+1}/${mixedQueue.length}`;
    document.getElementById('spellWord').textContent = word.ko;
    document.getElementById('spellHint').textContent = '총 '+word.en.length+'글자';
    const input = document.getElementById('spellInput');
    input.value='';
    renderSpellBoxes('', word.en.length);
    // 스펠링 화면으로 전환
    show('spelling');
    setTimeout(()=>focusSpellInput(), 150);
    startSpellTimer();
  } else {
    // 4지선다 모드로 전환
    document.getElementById('quizProgress').textContent = `${mixedIdx+1}/${mixedQueue.length}`;
    document.getElementById('quizWord').textContent = word.en;
    const others = currentUnitWords.filter(w=>w.en!==word.en).sort(()=>Math.random()-0.5).slice(0,3);
    const choices = shuffle([word, ...others]);
    document.getElementById('choicesArea').innerHTML = choices.map((c,i)=>`
      <button class="choice-btn" id="choice${i}" onclick="answerMixed(${i},${choices[i].en===word.en})">
        <span class="choice-num" id="cn${i}">${i+1}</span>${c.ko}
      </button>`).join('');
    show('quiz');
    // >> 버튼 비활성
    const btn = document.getElementById('quizSubmitBtn');
    if(btn) btn.disabled = true;
    window._mixedSelectedIdx = undefined;
    // 자동 음성 읽기
    setTimeout(()=>speakWord(word.en), 300);
    startTimer();
  }
}

window.answerMixed = (idx, ok) => {
  // 선택만 표시 - 즉시 평가 안 함
  document.querySelectorAll('.choice-btn').forEach(b=>b.classList.remove('selected'));
  document.getElementById('choice'+idx)?.classList.add('selected');
  window._mixedSelectedIdx = idx;
  window._mixedSelectedOk = ok;
  // >> 버튼 활성화
  const btn = document.getElementById('quizSubmitBtn');
  if(btn) btn.disabled = false;
};

window.submitQuiz = () => {
  // 4지선다 공통 제출 (일반/혼합 모드)
  if(lastMode === 'mixed'){
    const idx = window._mixedSelectedIdx;
    const ok  = window._mixedSelectedOk;
    if(idx === undefined){ return; } // 선택 안 했으면 무시
    clearTimers();
    _evaluateQuizChoice(idx, ok, ()=>{ mixedIdx++; showMixedQuestion(); });
  } else {
    const idx = window._quizSelectedIdx;
    const ok  = window._quizSelectedOk;
    if(idx === undefined){ return; }
    clearTimers();
    _evaluateQuizChoice(idx, ok, ()=>{ currentQ++; showQuizQuestion(); });
  }
};

window.skipQuiz = () => {
  clearTimers(); wrong++;
  window._quizSelectedIdx = undefined; window._mixedSelectedIdx = undefined;
  if(lastMode==='mixed'){ mixedIdx++; showMixedQuestion(); }
  else { currentQ++; showQuizQuestion(); }
};

function _evaluateQuizChoice(idx, ok, nextFn){
  if(ok){
    document.getElementById('choice'+idx)?.classList.add('correct');
    document.getElementById('cn'+idx)?.classList.add('correct');
    correct++;
  } else {
    document.getElementById('choice'+idx)?.classList.remove('selected');
    document.getElementById('choice'+idx)?.classList.add('wrong');
    document.getElementById('cn'+idx)?.classList.add('wrong');
    wrong++;
    // 정답 버튼 강조 - data 속성 기반으로 찾기 (더 안전)
    document.querySelectorAll('.choice-btn').forEach((b,i)=>{
      const onclickStr = b.getAttribute('onclick')||'';
      if(onclickStr.includes(',true)')){
        b.classList.add('correct');
        document.getElementById('cn'+i)?.classList.add('correct');
      }
    });
  }
  // >> 버튼 비활성화
  const btn = document.getElementById('quizSubmitBtn');
  if(btn) btn.disabled = true;
  window._quizSelectedIdx = undefined;
  window._mixedSelectedIdx = undefined;
  setTimeout(nextFn, ok ? 500 : 900);
}

function showQuizQuestion(){
  clearTimers();
  window._quizSelectedIdx = undefined;
  if(currentQ>=questions.length){showResult();return;}
  const q=questions[currentQ];
  document.getElementById('quizProgress').textContent=(currentQ+1)+'/'+questions.length;
  const qBar=document.getElementById('quizProgressBar');
  if(qBar) qBar.style.width=Math.round(((currentQ+1)/questions.length)*100)+'%';
  document.getElementById('quizWord').textContent=q.en;
  const choices=shuffle([q,...shuffle(currentUnitWords.filter(w=>w.en!==q.en)).slice(0,3)]);
  document.getElementById('choicesArea').innerHTML=choices.map((c,i)=>`
    <button class="choice-btn" id="choice${i}" onclick="selectQuiz(${i},${choices[i].en===q.en})">
      <span class="choice-num" id="cn${i}">${i+1}</span><span>${c.ko}</span>
    </button>`).join('');
  // >> 버튼 비활성
  const btn = document.getElementById('quizSubmitBtn');
  if(btn) btn.disabled = true;
  // 자동 음성 읽기
  setTimeout(()=>speakWord(q.en), 300);
  startTimer();
}

window.selectQuiz = (idx, ok) => {
  // 선택만 - 즉시 평가 안 함
  document.querySelectorAll('.choice-btn').forEach(b=>b.classList.remove('selected'));
  document.getElementById('choice'+idx)?.classList.add('selected');
  window._quizSelectedIdx = idx;
  window._quizSelectedOk = ok;
  const btn = document.getElementById('quizSubmitBtn');
  if(btn) btn.disabled = false;
};

window.answerQuiz = window.selectQuiz; // 혹시 남은 참조 대비

window.nextQuestion=()=>{
  if(lastMode==='mixed'){mixedIdx++;showMixedQuestion();}
  else{currentQ++;showQuizQuestion();}
};
function startTimer(){
  timeLeft=10;updateTimerUI();
  timerInterval=setInterval(()=>{
    timeLeft--;updateTimerUI();
    if(timeLeft<=0){
      clearTimers();
      // 타이머 만료: 선택된 것 있으면 그걸로 평가, 없으면 wrong++
      if(lastMode==='mixed'){
        if(window._mixedSelectedIdx !== undefined){
          _evaluateQuizChoice(window._mixedSelectedIdx, window._mixedSelectedOk, ()=>{ mixedIdx++; showMixedQuestion(); });
        } else { wrong++; mixedIdx++; showMixedQuestion(); }
      } else {
        if(window._quizSelectedIdx !== undefined){
          _evaluateQuizChoice(window._quizSelectedIdx, window._quizSelectedOk, ()=>{ currentQ++; showQuizQuestion(); });
        } else { wrong++; currentQ++; showQuizQuestion(); }
      }
    }
  },1000);
}
function updateTimerUI(){document.getElementById('timerText').textContent=timeLeft;document.getElementById('timerArc').style.strokeDashoffset=113*(1-timeLeft/10);}

// ── 공통 TTS 함수 ─────────────────────────────────────────
function speakWord(word){
  if(!word) return;
  if('speechSynthesis' in window){
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang='en-US'; utter.rate=0.85; utter.pitch=1;
    window.speechSynthesis.speak(utter);
  }
}

function showSpellQuestion(){
  clearTimers();
  if(spellQ>=spellQuestions.length){showResult();return;}
  const q=spellQuestions[spellQ];
  document.getElementById('spellProgress').textContent=(spellQ+1)+'/'+spellQuestions.length;
  const sBar=document.getElementById('spellProgressBar');
  if(sBar) sBar.style.width=Math.round(((spellQ+1)/spellQuestions.length)*100)+'%';
  document.getElementById('spellWord').textContent=q.ko;
  document.getElementById('spellInput').value='';
  document.getElementById('spellHint').textContent='총 '+q.en.length+'글자';
  renderSpellBoxes('',q.en.length);
  // >> 버튼 비활성
  const btn = document.getElementById('spellSubmitBtn');
  if(btn) btn.disabled = true;
  setTimeout(()=>focusSpellInput(),100);
  startSpellTimer();
}

function focusSpellInput(){
  const inp = document.getElementById('spellInput');
  if(inp){ inp.focus(); inp.click(); }
}

function renderSpellBoxes(val, len){
  const boxes = document.getElementById('spellBoxes');
  const boxW = len > 12 ? 26 : len > 8 ? 30 : 34;
  const fontSize = len > 12 ? 13 : len > 8 ? 15 : 17;
  boxes.innerHTML = Array.from({length:len},(_,i)=>{
    const ch = val[i]||'';
    const cls = ch ? 'spell-box filled' : (i===val.length ? 'spell-box active' : 'spell-box');
    return `<div class="${cls}" id="sb${i}"
      style="width:${boxW}px;height:${boxW+8}px;font-size:${fontSize}px;border-radius:6px;"
      onclick="focusSpellInput()">${ch||'_'}</div>`;
  }).join('');
}

document.getElementById('spellBoxes').addEventListener('click', focusSpellInput);

document.getElementById('spellInput').addEventListener('input',function(){
  const q=spellQuestions[spellQ]; if(!q) return;
  let val = this.value.toLowerCase().replace(/[^a-z ]/g,'');
  if(val.length > q.en.length) val = val.slice(0, q.en.length);
  this.value = val;
  renderSpellBoxes(val, q.en.length);

  // >> 버튼: 한 글자라도 입력 시 활성화
  const btn = document.getElementById('spellSubmitBtn');
  if(btn) btn.disabled = (val.length === 0);
});

// 스펠링 >> 버튼 제출
window.submitSpell = () => {
  const q=spellQuestions[spellQ]; if(!q) return;
  const val = document.getElementById('spellInput').value.trim().toLowerCase();
  clearTimers();
  _evaluateSpell(val, q);
};

// 스펠링 SKIP
window.skipSpell = () => {
  clearTimers(); wrong++;
  const btn = document.getElementById('spellSubmitBtn');
  if(btn) btn.disabled = true;
  if(lastMode==='mixed'){ mixedIdx++; showMixedQuestion(); }
  else { spellQ++; showSpellQuestion(); }
};

function _evaluateSpell(val, q){
  const ok = val === q.en.toLowerCase();
  if(ok) correct++; else wrong++;

  // 결과 색상 표시
  const boxes = document.getElementById('spellBoxes');
  if(boxes){
    boxes.querySelectorAll('.spell-box').forEach((b,i)=>{
      const correct_char = q.en[i]?.toLowerCase();
      const input_char = val[i];
      if(ok){
        b.style.background='#d4f5e9'; b.style.borderColor='var(--teal)'; b.style.color='#1a6b1a';
      } else {
        b.style.background = (input_char===correct_char)?'#d4f5e9':'#fde8e8';
        b.style.borderColor = (input_char===correct_char)?'var(--teal)':'#e05050';
        b.style.color = (input_char===correct_char)?'#1a6b1a':'#e05050';
        if(!ok) b.textContent = q.en[i]; // 정답 표시
      }
    });
  }

  const btn = document.getElementById('spellSubmitBtn');
  if(btn) btn.disabled = true;

  setTimeout(()=>{
    if(lastMode==='mixed'){ mixedIdx++; showMixedQuestion(); }
    else { spellQ++; showSpellQuestion(); }
  }, ok ? 500 : 900);
}

document.getElementById('spellInput').addEventListener('keydown',function(e){
  if(e.key==='Enter'){
    const q=spellQuestions[spellQ]; if(!q) return;
    const val = this.value.trim().toLowerCase();
    if(!val.length) return;
    clearTimers();
    _evaluateSpell(val, q);
  }
});
function startSpellTimer(){
  spellTimeLeft=30;updateSpellTimerUI();
  spellTimer=setInterval(()=>{
    spellTimeLeft--;updateSpellTimerUI();
    if(spellTimeLeft<=0){
      clearTimers();
      // 타이머 만료: 입력된 값으로 자동 평가 (wrong 처리)
      const q=spellQuestions[spellQ];
      if(q){
        const val = (document.getElementById('spellInput')?.value||'').trim().toLowerCase();
        _evaluateSpell(val, q);
      } else {
        wrong++;
        if(lastMode==='mixed'){ mixedIdx++; showMixedQuestion(); }
        else nextSpell();
      }
    }
  },1000);
}
function updateSpellTimerUI(){document.getElementById('timerText2').textContent=spellTimeLeft;document.getElementById('timerArc2').style.strokeDashoffset=113*(1-spellTimeLeft/30);}
window.nextSpell=()=>{
  if(lastMode==='mixed'){mixedIdx++;showMixedQuestion();}
  else{spellQ++;showSpellQuestion();}
};

async function showResult(){
  clearTimers();
  const total=correct+wrong,score=Math.round((correct/Math.max(total,1))*100);

  // 통과점수 확인
  const passScore = window._currentTestData?.passScore ?? 80;
  const passed = score >= passScore;

  document.getElementById('resultScore').textContent=score+'점';
  document.getElementById('resultLabel').textContent=
    passed ? `🎉 통과! (${passScore}점 이상)` :
    score>=60 ? '잘 했어요!' : '조금 더 연습해요 💪';
  document.getElementById('resultCorrect').textContent=correct;
  document.getElementById('resultWrong').textContent=wrong;
  document.getElementById('resultTotal').textContent=total;
  show('result');

  if(currentUser&&userProfile){
    try{
      const today = new Date().toISOString().slice(0,10);
      const testId = currentTestId || currentUnitId;
      const testName = currentTestName || '';

      // scores 저장
      await addDoc(collection(db,'scores'),{
        uid:currentUser.uid,
        userId:currentUser.uid,
        userName:userProfile.name,
        name:userProfile.name,
        group:userProfile.group||'',
        testId, testName,
        unitId:currentUnitId,
        unitName:testName||currentTestName||'',
        bookName:window._currentTestData?.bookName||'',
        mode:lastMode,
        score,correct,wrong,total,
        passed, passScore,
        date:today,
        createdAt:serverTimestamp()
      });

      // 통과하면 해당 시험을 완료 처리 (userCompleted 서브컬렉션)
      if(passed && testId){
        try{
          await setDoc(
            doc(db,'tests',testId,'userCompleted',currentUser.uid),
            { uid:currentUser.uid, userName:userProfile.name,
              score, date:today, completedAt:serverTimestamp() },
            {merge:true}
          );
        }catch(e){console.log('완료처리실패',e);}
      }
    }catch(e){console.log('점수저장실패',e);}
  }
}
window.retrySession=()=>{
  if(lastMode==='unscramble'){
    // 언스크램블 재시작
    _unscIdx=0; _unscCorrect=0; _unscWrong=0;
    if(_unscSentences.length>0){ show('unscramble'); showUnscQuestion(); }
    else { goHome(); }
  } else {
    correct=0; wrong=0; currentQ=0; spellQ=0;
    doStart();
  }
};

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
  const usersSnap=await getDocs(query(collection(db,'users'),where('group','==',group)));
  const students=usersSnap.docs.map(d=>({uid:d.id,...d.data()})).filter(u=>u.role==='student');
  if(tab==='score'){
    const scoresSnap=await getDocs(query(collection(db,'scores'),where('group','==',group)));
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
  } else {
    // 녹음숙제 제출 현황 (recSubmissions + recHw)
    const hwSnap = await getDocs(query(collection(db,'recHw'),orderBy('createdAt','desc')));
    const myHws = hwSnap.docs.map(d=>({id:d.id,...d.data()})).filter(hw=>{
      if(hw.active===false) return false;
      const targets=hw.targets||[];
      return targets.some(t=>(t.type==='class'&&t.id===group)||students.some(s=>t.type==='student'&&t.id===s.uid));
    });

    // 학생별 제출 수 집계
    const subMap={}; // uid → {submitted: n, total: m}
    students.forEach(u=>{ subMap[u.uid]={submitted:0,total:myHws.length*3}; });
    const subSnap = await getDocs(query(collection(db,'recSubmissions')));
    const hwIds = new Set(myHws.map(h=>h.id));
    subSnap.docs.forEach(d=>{
      const s=d.data();
      if(hwIds.has(s.hwId) && subMap[s.uid]) subMap[s.uid].submitted++;
    });

    const sorted=[...students].sort((a,b)=>(subMap[b.uid]?.submitted||0)-(subMap[a.uid]?.submitted||0));
    const nc=['gold','silver','bronze'];
    // 포디움 업데이트 (녹음숙제 탭)
    const podiumElHw=document.getElementById('rankPodium');
    if(podiumElHw && sorted.length>0){
      const podOrder=[1,0,2];
      const heights=['28px','40px','20px'];
      const sizes=['32px','38px','32px'];
      podiumElHw.innerHTML=podOrder.map((idx,pos)=>{
        const u=sorted[idx]; if(!u) return '';
        const sm2=subMap[u?.uid]||{submitted:0,total:0};
        const pct2=sm2.total>0?Math.round((sm2.submitted/sm2.total)*100):0;
        const isFirst=idx===0;
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
          ${isFirst?'<div style="font-size:13px;">👑</div>':'<div style="height:16px;"></div>'}
          <div style="width:${sizes[pos]};height:${sizes[pos]};border-radius:50%;background:rgba(255,255,255,${isFirst?'0.35':'0.22'});display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white;">${idx+1}</div>
          <div style="font-size:8px;color:rgba(255,255,255,0.9);font-weight:600;max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(u.name)}</div>
          <div style="background:rgba(255,255,255,${isFirst?'0.3':'0.18'});border-radius:6px 6px 0 0;width:48px;height:${heights[pos]};display:flex;align-items:center;justify-content:center;">
            <span style="font-size:9px;font-weight:800;color:white;">${pct2}%</span>
          </div>
        </div>`;
      }).join('');
    }
    let h='';
    sorted.forEach((u,i)=>{
      const sm=subMap[u.uid]||{submitted:0,total:0};
      const isMe=u.uid===meUid;
      const pct=sm.total>0?Math.round((sm.submitted/sm.total)*100):0;
      const done=sm.total>0&&sm.submitted>=sm.total;
      h+=`<div class="rank-item${isMe?' me':''}">
        <div class="rank-num ${nc[i]||''}">${i+1}</div>
        <div class="rank-info">
          <div class="rank-name">${esc(u.name)}${isMe?'<span>(나)</span>':''}</div>
          <div style="margin-top:5px;height:5px;background:#FFE0D4;border-radius:3px;">
            <div style="width:${pct}%;height:5px;background:var(--teal);border-radius:3px;transition:width .4s;"></div>
          </div>
          <div style="font-size:9px;color:#aaa;margin-top:2px;">${sm.submitted}/${sm.total}</div>
        </div>
        <span class="hw-badge ${done?'hw-done':'hw-none'}" style="font-size:11px;flex-shrink:0;">${done?'완료':'진행중'}</span>
      </div>`;
    });
    document.getElementById('rankHwList').innerHTML = h||'<div class="empty-msg">녹음숙제가 없습니다</div>';
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

// ══════════════════════════════════════════════════════════
// 관리자 기능
// ══════════════════════════════════════════════════════════
let selectedUserGroupFilter = 'all';

async function loadAdminData(){
  await loadGroups();
  await loadAdminUnits();
}

// ── 그룹 관리 (학생탭) ────────────────────────────────────
async function loadGroups(){
  const snap=await getDocs(collection(db,'groups'));
  allGroups=snap.docs.map(d=>({id:d.id,...d.data()}));
  renderGroupTags();
  renderUserGroupFilter();
  renderAllGroupSelects();
}

function renderGroupTags(){
  const el=document.getElementById('groupTagArea'); if(!el)return;
  el.innerHTML=allGroups.map(g=>`
    <span style="display:inline-flex;align-items:center;gap:5px;background:#FEE4D8;color:var(--teal);border-radius:20px;padding:5px 12px;font-size:13px;font-weight:600;">
      ${esc(g.name)}
      <span onclick="deleteGroup('${g.id}','${esc(g.name)}')" style="cursor:pointer;color:#aaa;font-size:11px;line-height:1;">✕</span>
    </span>`).join('')||'<span style="font-size:13px;color:#bbb;">그룹이 없습니다</span>';
}

function renderUserGroupFilter(){
  const el=document.getElementById('userGroupFilter'); if(!el)return;
  const cur=selectedUserGroupFilter;
  const chip=(label,val)=>'<span onclick="filterByUserGroup(\''+val+'\')" style="display:inline-flex;cursor:pointer;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;background:'+(cur===val?'var(--teal)':'#f0f0f0')+';color:'+(cur===val?'white':'var(--gray)')+';">'+label+'</span>';
  el.innerHTML=chip('전체','all')+allGroups.map(g=>chip(g.name,g.name)).join('');
}

function renderAllGroupSelects(){
  // 공지/알림 대상
  const opts='<option value="all">전체</option>'+allGroups.map(g=>`<option value="${g.name}">${g.name}</option>`).join('');
  // 숙제 그룹
  const hwOpts='<option value="전체">전체</option>'+allGroups.map(g=>`<option value="${g.name}">${g.name}</option>`).join('');
  // 학생 그룹
  const stuOpts=allGroups.map(g=>`<option value="${g.name}">${g.name}</option>`).join('')||'<option value="">그룹 없음</option>';
  ['noticeTarget','pushTarget','schedPushTarget'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=opts;});
  ['newFileGroup'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=hwOpts;});
  ['newUserGroup'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=stuOpts;});
  // 단원 그룹 셀렉트
  const unitGroupOpts='<option value="">그룹 없음</option>'+allGroups.map(g=>`<option value="${g.name}">${g.name}</option>`).join('');
  ['newUnitGroup','editUnitGroup'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=unitGroupOpts;});
  renderStatsGroupFilter();
}

window.filterByUserGroup=async (val)=>{
  selectedUserGroupFilter=val;
  renderUserGroupFilter();
  await loadAdminUsers();
};

window.addGroup=async()=>{
  const name=document.getElementById('newGroupName').value.trim(); if(!name)return;
  if(allGroups.find(g=>g.name===name)){showToast('이미 있는 그룹이에요.');return;}
  await addDoc(collection(db,'groups'),{name,createdAt:serverTimestamp()});
  document.getElementById('newGroupName').value='';
  showToast('그룹 추가됐어요!'); await loadGroups();
};
window.deleteGroup=async(id,name)=>{
  if(!await showConfirm(`"${name}" 그룹을 삭제할까요?`))return;
  await deleteDoc(doc(db,'groups',id));
  showToast('삭제됐어요.'); await loadGroups();
};

// ── 단원/단어 관리 ─────────────────────────────────────────
async function loadAdminUnits(){
  const snap=await getDocs(collection(db,'units'));
  adminUnits=snap.docs.map(d=>({id:d.id,...d.data()}));
  renderUnitSelect();
  if(lastSelectedUnitId)renderWordTable();
}
function renderUnitSelect(){
  const el=document.getElementById('unitItemList');if(!el)return;
  el.innerHTML=adminUnits.map(u=>{
    const groupBadge=u.group?`<span style="font-size:11px;background:#FEE4D8;color:var(--teal);border-radius:8px;padding:1px 7px;margin-left:6px;">${esc(u.group)}</span>`:'';
    const border=lastSelectedUnitId===u.id?'var(--teal)':'transparent';
    return `<div onclick="selectAdminUnit('${u.id}','${esc(u.name)}')" style="background:white;border-radius:10px;padding:8px 12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;box-shadow:0 1px 4px rgba(0,0,0,.05);border:2px solid ${border};margin-bottom:6px;">
      <div style="flex:1;min-width:0;">
        <span style="font-size:14px;font-weight:600;color:var(--text);">${esc(u.name)}</span>
        ${groupBadge}
        <span style="font-size:11px;color:#bbb;margin-left:6px;">단어 ${u.words?.length||0}개</span>
      </div>
      <div style="display:flex;gap:2px;flex-shrink:0;" onclick="event.stopPropagation()">
        <button onclick="openUnitEdit('${u.id}','${u.name}','${u.group||''}')" style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:14px;padding:3px 6px;">✏️</button>
        <button onclick="deleteUnit('${u.id}','${u.name}')" style="background:none;border:none;color:#e05050;cursor:pointer;font-size:14px;padding:3px 6px;">🗑</button>
      </div>
    </div>`;
  }).join('')||'<div style="text-align:center;color:#bbb;padding:12px;font-size:13px;">단원이 없습니다</div>';
}
window.selectAdminUnit=(unitId,unitName)=>{
  lastSelectedUnitId=unitId;
  document.getElementById('currentUnitLabel').textContent='— '+unitName;
  document.getElementById('wordEditorSection').style.display='';
  renderUnitSelect();renderWordTable();
};
window.addUnit=async()=>{
  const name=document.getElementById('newUnit').value.trim();if(!name)return;
  const group=document.getElementById('newUnitGroup').value||'';
  const docRef=await addDoc(collection(db,'units'),{name,group,words:[],createdAt:serverTimestamp()});
  document.getElementById('newUnit').value='';
  showToast('단원 추가됐어요!');await loadAdminUnits();
  selectAdminUnit(docRef.id,name);
};
window.deleteUnit=async(unitId,unitName)=>{
  if(!await showConfirm(`"${unitName}" 단원을 삭제할까요?`))return;
  await deleteDoc(doc(db,'units',unitId));
  if(lastSelectedUnitId===unitId){lastSelectedUnitId=null;document.getElementById('wordEditorSection').style.display='none';}
  showToast('단원이 삭제됐어요.');await loadAdminUnits();
};

// ── 단원 이름/그룹 수정 ─────────────────────────────────────
window.openUnitEdit=(unitId,unitName,unitGroup)=>{
  document.getElementById('editUnitName').value=unitName;
  document.getElementById('editUnitGroup').value=unitGroup||'';
  document.getElementById('unitEditSection').style.display='';
  document.getElementById('unitEditSection').dataset.uid=unitId;
  document.getElementById('editUnitName').focus();
};
window.cancelUnitEdit=()=>{
  document.getElementById('unitEditSection').style.display='none';
};
window.saveUnitEdit=async()=>{
  const el=document.getElementById('unitEditSection');
  const unitId=el.dataset.uid;
  const name=document.getElementById('editUnitName').value.trim();
  const group=document.getElementById('editUnitGroup').value||'';
  if(!name){showToast('단원명을 입력하세요.');return;}
  await updateDoc(doc(db,'units',unitId),{name,group});
  document.getElementById('currentUnitLabel').textContent='— '+name;
  showToast('단원이 수정됐어요!');
  cancelUnitEdit();
  await loadAdminUnits();
};
window.addWord=async()=>{
  const unitId=lastSelectedUnitId;
  if(!unitId){showToast('단원을 먼저 선택하세요.');return;}
  const en=document.getElementById('newEng').value.trim();
  const ko=document.getElementById('newKor').value.trim();
  if(!en||!ko){showToast('영어와 한글 뜻을 입력하세요.');return;}
  const unit=adminUnits.find(u=>u.id===unitId);
  const words=[...(unit.words||[]),{en,ko}];
  await setDoc(doc(db,'units',unitId),{words},{merge:true});
  document.getElementById('newEng').value='';document.getElementById('newKor').value='';
  document.getElementById('newEng').focus();
  await loadAdminUnits();renderWordTable();
};

// ── 단어 수정 ─────────────────────────────────────────────
window.openWordEdit=(unitId,wi)=>{
  const unit=adminUnits.find(u=>u.id===unitId);if(!unit)return;
  const w=unit.words[wi];
  document.getElementById('editWordUnitId').value=unitId;
  document.getElementById('editWordIdx').value=wi;
  document.getElementById('editWordEn').value=w.en;
  document.getElementById('editWordKo').value=w.ko;
  document.getElementById('wordEditModal').classList.remove('hidden');
};
window.saveWordEdit=async()=>{
  const unitId=document.getElementById('editWordUnitId').value;
  const wi=parseInt(document.getElementById('editWordIdx').value);
  const en=document.getElementById('editWordEn').value.trim();
  const ko=document.getElementById('editWordKo').value.trim();
  if(!en||!ko)return;
  const unit=adminUnits.find(u=>u.id===unitId);
  const words=[...(unit.words||[])];words[wi]={en,ko};
  await setDoc(doc(db,'units',unitId),{words},{merge:true});
  closeModal('wordEditModal');showToast('수정됐어요!');
  await loadAdminUnits();renderWordTable();
};
window.delWord=async(unitId,wi)=>{
  const unit=adminUnits.find(u=>u.id===unitId);
  const words=[...(unit.words||[])];words.splice(wi,1);
  await setDoc(doc(db,'units',unitId),{words},{merge:true});
  lastSelectedUnitId=unitId;await loadAdminUnits();
};
function renderWordTable(){
  const unitId=lastSelectedUnitId;if(!unitId)return;
  const unit=adminUnits.find(u=>u.id===unitId);
  const words=unit?.words||[];
  document.getElementById('wordCount').textContent=words.length?`(${words.length}개)`:'';
  document.getElementById('wordTableBody').innerHTML=words.map((w,wi)=>`<tr>
    <td><b>${esc(w.en)}</b></td>
    <td>${esc(w.ko)}</td>
    <td style="white-space:nowrap;">
      <button onclick="openWordEdit('${unitId}',${wi})" style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:14px;padding:2px 4px;">✏️</button>
      <button class="del-btn" onclick="delWord('${unitId}',${wi})">✕</button>
    </td>
  </tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:#bbb;padding:16px;">단어가 없습니다</td></tr>';
}


// ── 클립보드/붙여넣기 임포트 ─────────────────────────────
window.importFromPaste=async()=>{
  const text=document.getElementById('pasteArea').value.trim();
  if(!text){showToast('붙여넣을 내용이 없습니다.');return;}
  const unitId=lastSelectedUnitId;if(!unitId){showToast('단원을 먼저 선택하세요.');return;}
  const lines=text.split('\n').filter(l=>l.trim());
  const newWords=[];
  for(const line of lines){
    const parts=line.split('\t');
    if(parts.length>=2){const en=parts[0].trim(),ko=parts[1].trim();if(en&&ko)newWords.push({en,ko});}
  }
  if(!newWords.length){showToast('탭으로 구분된 영어-한글 형식이어야 해요. (엑셀 두 열 복사)');return;}
  const unit=adminUnits.find(u=>u.id===unitId);
  await setDoc(doc(db,'units',unitId),{words:[...(unit.words||[]),...newWords]},{merge:true});
  document.getElementById('pasteArea').value='';
  showToast(`✅ ${newWords.length}개 단어 추가됐어요!`);
  await loadAdminUnits();renderWordTable();
};
// ── 엑셀 임포트 ───────────────────────────────────────────
window.importExcel=async (e)=>{
  const file=e.target.files[0];if(!file)return;
  const unitId=lastSelectedUnitId;
  if(!unitId){showToast('먼저 단원을 선택하세요.');e.target.value='';return;}
  try{
    const data=await file.arrayBuffer();
    const wb=XLSX.read(data);
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1});
    const newWords=rows.filter(r=>r[0]&&r[1]).map(r=>({en:String(r[0]).trim(),ko:String(r[1]).trim()}));
    if(!newWords.length){showToast('A열: 영어, B열: 한글 형식으로 입력해주세요.');return;}
    const unit=adminUnits.find(u=>u.id===unitId);
    const words=[...(unit.words||[]),...newWords];
    await setDoc(doc(db,'units',unitId),{words},{merge:true});
    lastSelectedUnitId=unitId;
    showToast(`✅ ${newWords.length}개 단어가 추가됐어요!`);
    await loadAdminUnits();e.target.value='';
  }catch(err){showToast('엑셀 파일을 읽을 수 없어요: '+err.message);}
};

// ── 학생 관리 ─────────────────────────────────────────────
async function loadAdminUsers(){
  const clrs=['#E8714A','#EF9F27','#D4537E','#F4936A','#f5a623','#e05050'];
  const q2 = selectedUserGroupFilter==='all'
    ? query(collection(db,'users'),where('role','==','student'))
    : query(collection(db,'users'),where('role','==','student'),where('group','==',selectedUserGroupFilter));
  const snap=await getDocs(q2);
  const students=snap.docs.map(d=>({uid:d.id,...d.data()}));
  document.getElementById('studentCardList').innerHTML=students.map((u,i)=>`
    <div class="student-card" onclick="viewStudent('${u.uid}')">
      <div class="student-header">
        <div class="student-avatar" style="background:${clrs[i%clrs.length]}">${esc(u.name?.[0]||'?')}</div>
        <div class="student-info">
          <div class="student-name">${esc(u.name)} <span style="font-size:12px;color:var(--gray);font-weight:400;">(${esc(u.username)})</span></div>
          <div class="student-meta">${esc(u.group||'')} ${u.parentPhone?'· 📞 '+esc(u.parentPhone):''}</div>
        </div>
        <span style="color:#ddd;font-size:18px;">›</span>
      </div>
      ${u.memo?'<div style="font-size:13px;color:var(--gray);margin-top:8px;padding-top:8px;border-top:1px solid #f5f5f5;">'+esc(u.memo)+'</div>':''}
    </div>`).join('')||'<div class="empty-msg">학생이 없습니다</div>';
}

// 학생 추가/수정 통합 함수
window.saveUser=async()=>{
  const editId=document.getElementById('editingUserId').value;
  const name=document.getElementById('newUserName').value.trim();
  const group=document.getElementById('newUserGroup').value;
  const pw=document.getElementById('newUserPw').value.trim();
  const parentName=document.getElementById('newUserParentName').value.trim();
  const parentPhone=document.getElementById('newUserParentPhone').value.trim();
  const memo=document.getElementById('newUserMemo').value.trim();
  if(editId){
    // 수정 모드
    await updateDoc(doc(db,'users',editId),{name,group,parentName,parentPhone,memo});
    showToast('✅ 학생 정보가 수정됐어요!');
    cancelEditUser();await loadAdminUsers();
  } else {
    // 신규 추가
    const username=document.getElementById('newUserId').value.trim();
    if(!username||!name||!pw){showToast('아이디, 이름, 비밀번호는 필수입니다.');return;}
    if(pw.length<6){showToast('비밀번호는 6자 이상이어야 합니다.');return;}
    const email=username+'@kunsori.app';
    try{
      // 중복 확인
      const dup=await getDocs(query(collection(db,'users'),where('username','==',username)));
      if(!dup.empty){showToast('이미 사용 중인 아이디입니다.');return;}
      const {initializeApp:ia}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const {getAuth:ga,createUserWithEmailAndPassword:cu,signOut:so}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
      let secApp;try{const {getApp}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');secApp=getApp('sec');}catch(e){secApp=ia(firebaseConfig,'sec');}
      const auth2=ga(secApp);
      const cred=await cu(auth2,email,pw);
      await so(auth2);
      await setDoc(doc(db,'users',cred.user.uid),{username,name,email,group,role:'student',parentName,parentPhone,memo,avatarUrl:'',createdAt:serverTimestamp()});
      cancelEditUser();showToast('✅ 학생 계정이 추가됐어요!');await loadAdminUsers();
    }catch(e){
      console.error(e);
      if(e.code==='auth/email-already-in-use')showToast('이미 Auth에 계정이 있습니다. Firebase 콘솔에서 삭제 후 재시도하세요.');
      else showToast('계정 생성 실패: '+e.message);
    }
  }
};
window.cancelEditUser=()=>{
  document.getElementById('editingUserId').value='';
  document.getElementById('newUserId').disabled=false;
  ['newUserId','newUserName','newUserPw','newUserParentName','newUserParentPhone','newUserMemo'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('studentFormTitle').textContent='학생 추가';
  document.getElementById('userSaveBtn').textContent='+ 학생 추가';
  document.getElementById('userCancelBtn').style.display='none';
};
window.addUser=window.saveUser;

let _editingStudentId=null,_editingStudentData=null;
window.viewStudent=async (uid)=>{
  const snap=await getDoc(doc(db,'users',uid));
  const u=snap.data();if(!u)return;
  _editingStudentId=uid;_editingStudentData=u;
  document.getElementById('studentDetailContent').innerHTML=`
    <div style="display:flex;flex-direction:column;gap:10px;font-size:14px;">
      <div style="display:flex;gap:8px;"><span style="color:var(--gray);width:80px;font-size:13px;">이름</span><b>${u.name}</b></div>
      <div style="display:flex;gap:8px;"><span style="color:var(--gray);width:80px;font-size:13px;">아이디</span>${u.username}</div>
      <div style="display:flex;gap:8px;"><span style="color:var(--gray);width:80px;font-size:13px;">그룹</span>${u.group||'-'}</div>
      <div style="display:flex;gap:8px;"><span style="color:var(--gray);width:80px;font-size:13px;">부모님</span>${u.parentName||'-'}</div>
      <div style="display:flex;gap:8px;"><span style="color:var(--gray);width:80px;font-size:13px;">연락처</span>${u.parentPhone||'-'}</div>
      <div style="display:flex;gap:8px;"><span style="color:var(--gray);width:80px;font-size:13px;">메모</span>${u.memo||'-'}</div>
    </div>`;
  document.getElementById('studentDetailModal').classList.remove('hidden');
};
window.startEditStudent=()=>{
  if(!_editingStudentId||!_editingStudentData)return;
  closeModal('studentDetailModal');
  const u=_editingStudentData;
  document.getElementById('editingUserId').value=_editingStudentId;
  document.getElementById('newUserId').value=u.username;
  document.getElementById('newUserId').disabled=true;
  document.getElementById('newUserName').value=u.name;
  document.getElementById('newUserGroup').value=u.group||'';
  document.getElementById('newUserPw').value='';
  document.getElementById('newUserParentName').value=u.parentName||'';
  document.getElementById('newUserParentPhone').value=u.parentPhone||'';
  document.getElementById('newUserMemo').value=u.memo||'';
  document.getElementById('studentFormTitle').textContent='학생 정보 수정';
  document.getElementById('userSaveBtn').textContent='수정 저장';
  document.getElementById('userCancelBtn').style.display='';
  document.getElementById('studentFormSection')?.scrollIntoView({behavior:'smooth'});
};

window.deleteCurrentStudent=()=>{
  if(!_editingStudentId||!_editingStudentData){showToast('삭제할 학생 정보가 없습니다.');return;}
  deleteStudent(_editingStudentId, _editingStudentData.name);
};

window.deleteStudent=async(uid,name)=>{
  if(!await showConfirm(name+' 학생을 삭제할까요?', 'Firestore 계정이 삭제되고 로그인이 차단됩니다.'))return;
  try{
    await deleteDoc(doc(db,'users',uid));
    closeModal('studentDetailModal');
    showToast('✅ '+name+' 계정이 삭제됐어요!');
    await loadAdminUsers();
  }catch(e){
    console.error(e);
    showToast('삭제 실패: '+e.message);
  }
};

// ── 공지 관리 (클릭 수정 지원) ───────────────────────────
let _editingNoticeId=null;
async function loadAdminNotices(){
  const snap=await getDocs(query(collection(db,'notices'),orderBy('createdAt','desc')));
  const notices=snap.docs.map(d=>({id:d.id,...d.data()}));
  const el=document.getElementById('noticeCardList'); if(!el)return;
  el.innerHTML=notices.map(n=>`
    <div onclick="startEditNotice('${n.id}')" style="background:white;border-radius:14px;padding:14px 18px;margin-bottom:8px;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.05);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <span style="font-size:15px;font-weight:600;color:var(--text);">${esc(n.title)}</span>
        <button onclick="event.stopPropagation();delNotice('${n.id}')" style="background:none;border:none;color:#e05050;cursor:pointer;font-size:16px;padding:2px 6px;">✕</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
        <span class="notice-tag${n.target==='all'?' all':''}">${n.target==='all'?'전체':esc(n.target)}</span>
        <span style="font-size:12px;color:var(--gray);">${esc(n.date||'')}</span>
      </div>
      <div style="font-size:13px;color:var(--gray);line-height:1.5;">${esc((n.content||'').length>80?(n.content||'').slice(0,80)+'…':(n.content||''))}</div>
    </div>`).join('')||'<div class="empty-msg">공지가 없습니다</div>';
}
window.startEditNotice=async (id)=>{
  const snap=await getDoc(doc(db,'notices',id));
  const n=snap.data();if(!n)return;
  _editingNoticeId=id;
  document.getElementById('editingNoticeId').value=id;
  document.getElementById('noticeTitle').value=n.title;
  document.getElementById('noticeContent').value=n.content;
  document.getElementById('noticeTarget').value=n.target;
  document.getElementById('noticeFormTitle').textContent='공지 수정';
  document.getElementById('noticeSaveBtn').textContent='수정 저장';
  document.getElementById('noticeCancelBtn').style.display='';
  document.getElementById('adminNotice').scrollTop=0;
};
window.cancelEditNotice=()=>{
  _editingNoticeId=null;
  document.getElementById('editingNoticeId').value='';
  ['noticeTitle','noticeContent'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('noticeFormTitle').textContent='공지 작성';
  document.getElementById('noticeSaveBtn').textContent='+ 공지 등록';
  document.getElementById('noticeCancelBtn').style.display='none';
};
window.saveNotice=async()=>{
  const title=document.getElementById('noticeTitle').value.trim();
  const content=document.getElementById('noticeContent').value.trim();
  const target=document.getElementById('noticeTarget').value;
  if(!title||!content){showToast('제목과 내용을 입력하세요.');return;}
  const today=new Date().toISOString().slice(0,10);
  const editId=document.getElementById('editingNoticeId').value;
  if(editId){
    await updateDoc(doc(db,'notices',editId),{title,content,target,date:today});
    showToast('공지가 수정됐어요!');
  } else {
    await addDoc(collection(db,'notices'),{title,content,target,date:today,createdAt:serverTimestamp()});
    showToast('공지가 등록됐어요!');
  }
  cancelEditNotice(); await loadAdminNotices();
};
window.addNotice=window.saveNotice;
window.delNotice=async (id)=>{if(!await showConfirm('공지를 삭제할까요?'))return;await deleteDoc(doc(db,'notices',id));showToast('삭제됐어요.');await loadAdminNotices();};

// ── 숙제 파일 (Firebase Storage 직접 업로드) ───────────────
window.onHwFileSelected=e=>{
  selectedHwFile=e.target.files[0];
  document.getElementById('selectedFileName').textContent=selectedHwFile?selectedHwFile.name:'파일을 선택하세요';
  if(selectedHwFile&&!document.getElementById('newFileName').value){
    document.getElementById('newFileName').value=selectedHwFile.name;
  }
};

window.uploadHwFile=async()=>{
  const name=document.getElementById('newFileName').value.trim();
  const group=document.getElementById('newFileGroup').value;
  if(!name){showToast('파일명을 입력하세요.');return;}
  if(!selectedHwFile){showToast('파일을 선택하세요.');return;}
  const ext=selectedHwFile.name.split('.').pop().toLowerCase();
  const type=['pdf'].includes(ext)?'pdf':['doc','docx'].includes(ext)?'docx':'img';
  const storageRef=ref(storage,`hwFiles/${Date.now()}_${selectedHwFile.name}`);
  const progressEl=document.getElementById('uploadProgress');
  const progressBar=document.getElementById('uploadProgressBar');
  progressEl.style.display='block';
  try{
    const uploadTask=uploadBytesResumable(storageRef,selectedHwFile);
    await new Promise((resolve,reject)=>{
      uploadTask.on('state_changed',
        snap=>{const pct=Math.round((snap.bytesTransferred/snap.totalBytes)*100);progressBar.style.width=pct+'%';},
        reject, resolve);
    });
    const url=await getDownloadURL(storageRef);
    const today=new Date().toISOString().slice(0,10);
    await addDoc(collection(db,'hwFiles'),{name,url,group,type,date:today,storageRef:storageRef.fullPath,createdAt:serverTimestamp()});
    document.getElementById('newFileName').value='';document.getElementById('selectedFileName').textContent='파일을 선택하세요';
    document.getElementById('hwFileInput').value='';selectedHwFile=null;
    progressEl.style.display='none';progressBar.style.width='0%';
    showToast('✅ 파일이 업로드됐어요!');await loadAdminFiles();
  }catch(e){progressEl.style.display='none';showToast('업로드 실패: '+e.message);}
};

async function loadAdminFiles(){
  const snap=await getDocs(query(collection(db,'hwFiles'),orderBy('createdAt','desc')));
  const files=snap.docs.map(d=>({id:d.id,...d.data()}));
  document.getElementById('fileTableBody').innerHTML=files.map(f=>`<tr>
    <td style="font-size:13px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.name)}</td>
    <td><span class="notice-tag${f.group==='전체'?' all':''}">${esc(f.group)}</span></td>
    <td><button class="del-btn" onclick="delFile('${f.id}','${f.storageRef||''}')">✕</button></td>
  </tr>`).join('');
}
window.delFile=async(id,storagePath)=>{
  if(!await showConfirm('파일을 삭제할까요?'))return;
  if(storagePath){try{await deleteObject(ref(storage,storagePath));}catch(e){console.log('스토리지 삭제 실패',e);}}
  await deleteDoc(doc(db,'hwFiles',id));showToast('삭제됐어요.');await loadAdminFiles();
};

// ── 진도 현황 ─────────────────────────────────────────────
function renderStatsGroupFilter(){
  const el=document.getElementById('statsGroupFilter');if(!el)return;
  const btns='<button class="filter-btn active" onclick="loadStats(\'all\',this)">전체</button>'
    +allGroups.map(g=>`<button class="filter-btn" onclick="loadStats('${g.name}',this)">${g.name}</button>`).join('');
  el.innerHTML=btns;
}

window.loadStats=async(group,btn)=>{
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  const usersQuery=group==='all'
    ?query(collection(db,'users'),where('role','==','student'))
    :query(collection(db,'users'),where('role','==','student'),where('group','==',group));
  const usersSnap=await getDocs(usersQuery);
  const students=usersSnap.docs.map(d=>({uid:d.id,...d.data()}));
  const scoresSnap=await getDocs(collection(db,'scores'));
  const scoresMap={};
  scoresSnap.docs.forEach(d=>{const s=d.data();if(!scoresMap[s.uid])scoresMap[s.uid]=[];scoresMap[s.uid].push(s);});
  const unitsSnap=await getDocs(collection(db,'units'));
  const units=unitsSnap.docs.map(d=>({id:d.id,...d.data()}));
  const el=document.getElementById('statsContent');
  if(!students.length){el.innerHTML='<div class="empty-msg">학생이 없습니다</div>';return;}
  el.innerHTML=students.map(u=>{
    const scores=scoresMap[u.uid]||[];
    const unitRows=units.map(unit=>{
      const sp=scores.find(s=>s.unitId===unit.id&&s.mode==='spelling');
      const mn=scores.find(s=>s.unitId===unit.id&&s.mode==='meaning');
      if(!sp&&!mn)return '';
      return `<div style="margin-bottom:8px;">
        <div class="stats-row"><span class="stats-unit">${esc(unit.name)}</span>
          <span style="font-size:12px;color:var(--gray);">스펠링 <b style="color:var(--teal)">${sp?sp.score+'점':'미응시'}</b> · 뜻맞추기 <b style="color:var(--blue)">${mn?mn.score+'점':'미응시'}</b></span>
        </div>
        <div class="stats-bar"><div class="stats-bar-fill" style="width:${sp&&mn?Math.round((sp.score+mn.score)/2)+'%':sp?sp.score+'%':mn?mn.score+'%':'0%'}"></div></div>
      </div>`;
    }).filter(Boolean).join('');
    const totalScore=scores.length?Math.round(scores.reduce((s,r)=>s+r.score,0)/scores.length):null;
    return `<div class="stats-card">
      <div class="stats-student-name">
        <span>${esc(u.name)} <span style="font-size:12px;color:var(--gray);font-weight:400;">${esc(u.group||'')}</span></span>
        ${totalScore!==null?'<span style="font-size:16px;color:var(--teal);font-weight:800;">'+totalScore+'점</span>':'<span style="font-size:13px;color:#bbb;">미응시</span>'}
      </div>
      ${unitRows||'<div class="no-data">아직 응시한 시험이 없습니다</div>'}
    </div>`;
  }).join('');
};

// ── 결제 관리 ─────────────────────────────────────────────
async function renderPaymentStudentSelect(){
  const el=document.getElementById('paymentStudent');if(!el)return;
  const snap=await getDocs(query(collection(db,'users'),where('role','==','student')));
  el.innerHTML=snap.docs.map(d=>{const u=d.data();return `<option value="${d.id}">${u.name||'?'} (${u.group||'-'})</option>`;}).join('')||'<option>학생 없음</option>';
}
window.savePayment=async()=>{
  const editId=document.getElementById('editingPaymentId').value;
  const uid=document.getElementById('paymentStudent').value;
  const title=document.getElementById('paymentTitle').value.trim();
  const amount=parseInt(document.getElementById('paymentAmount').value)||0;
  const due=document.getElementById('paymentDue').value;
  const status=document.getElementById('paymentStatus').value;
  const memo=document.getElementById('paymentMemo').value.trim();
  if(!title||!amount){showToast('항목과 금액을 입력하세요.');return;}
  if(editId){
    await updateDoc(doc(db,'payments',editId),{title,amount,due,status,memo});
    showToast('✅ 결제 내역이 수정됐어요!');
  } else {
    const uSnap=await getDoc(doc(db,'users',uid));
    const uData=uSnap.data()||{};
    await addDoc(collection(db,'payments'),{uid,userName:uData.name||'',group:uData.group||'',title,amount,due,status,memo,createdAt:serverTimestamp()});
    showToast('✅ 결제 내역이 등록됐어요!');
  }
  cancelEditPayment();
  await loadPayments();
};
window.addPayment=window.savePayment;
window.cancelEditPayment=()=>{
  document.getElementById('editingPaymentId').value='';
  ['paymentTitle','paymentAmount','paymentDue','paymentMemo'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('paymentStatus').value='unpaid';
  document.getElementById('paymentSaveBtn').textContent='+ 결제 등록';
  document.getElementById('paymentCancelBtn').style.display='none';
};
window.startEditPayment=async (id)=>{
  const snap=await getDoc(doc(db,'payments',id));
  const p=snap.data();if(!p)return;
  document.getElementById('editingPaymentId').value=id;
  document.getElementById('paymentTitle').value=p.title||'';
  document.getElementById('paymentAmount').value=p.amount||'';
  document.getElementById('paymentDue').value=p.due||'';
  document.getElementById('paymentStatus').value=p.status||'unpaid';
  document.getElementById('paymentMemo').value=p.memo||'';
  document.getElementById('paymentSaveBtn').textContent='수정 저장';
  document.getElementById('paymentCancelBtn').style.display='';
  // 학생 선택도 맞춰주기
  const sel=document.getElementById('paymentStudent');
  if(sel) sel.value=p.uid||'';
  document.getElementById('adminPayment').scrollTop=0;
  showToast('수정할 내용을 변경 후 저장하세요.');
};
async function loadPayments(){
  const snap=await getDocs(query(collection(db,'payments'),orderBy('createdAt','desc')));
  const payments=snap.docs.map(d=>({id:d.id,...d.data()}));
  const slabel={paid:'납부완료',unpaid:'미납',pending:'확인중'};
  const scls={paid:'paid',unpaid:'unpaid',pending:'pending'};
  const el=document.getElementById('paymentList');if(!el)return;
  el.innerHTML=payments.map(p=>`
    <div style="background:white;border-radius:16px;padding:16px 18px;margin-bottom:8px;box-shadow:0 1px 6px rgba(0,0,0,.05);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;">
        <div>
          <div style="font-size:15px;font-weight:600;">${esc(p.userName)} — ${esc(p.title)}</div>
          <div style="font-size:12px;color:var(--gray);margin-top:2px;">${esc(p.group||'')} ${p.due?'· 기한: '+esc(p.due):''} ${p.memo?'· '+esc(p.memo):''}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:16px;font-weight:800;color:var(--teal);">${(p.amount||0).toLocaleString()}원</div>
          <span style="display:inline-flex;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${p.status==='paid'?'#FEE4D8':p.status==='pending'?'#fff3e0':'#fde8e8'};color:${p.status==='paid'?'#D85A30':p.status==='pending'?'#e6820a':'#e05050'};">${slabel[p.status]||'미납'}</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;">
        <button onclick="updatePaymentStatus('${p.id}','paid')" style="flex:1;background:#FEE4D8;color:#D85A30;border:none;border-radius:8px;padding:7px;font-size:12px;font-weight:600;cursor:pointer;" ${p.status==='paid'?'disabled':''}>납부완료</button>
        <button onclick="updatePaymentStatus('${p.id}','unpaid')" style="flex:1;background:#f0f0f0;color:#888;border:none;border-radius:8px;padding:7px;font-size:12px;font-weight:600;cursor:pointer;" ${p.status==='unpaid'?'disabled':''}>미납</button>
        <button onclick="startEditPayment('${p.id}')" style="background:#FEE4D8;color:var(--teal);border:none;border-radius:8px;padding:7px 10px;font-size:12px;cursor:pointer;">수정</button>
        <button onclick="delPayment('${p.id}')" style="background:none;border:none;color:#e05050;cursor:pointer;padding:4px 8px;font-size:16px;">✕</button>
      </div>
    </div>`).join('')||'<div class="empty-msg">결제 내역이 없습니다</div>';
}
window.updatePaymentStatus=async(id,status)=>{await updateDoc(doc(db,'payments',id),{status});showToast('상태 변경됐어요.');await loadPayments();};
window.delPayment=async (id)=>{if(!await showConfirm('삭제할까요?'))return;await deleteDoc(doc(db,'payments',id));showToast('삭제됐어요.');await loadPayments();};

// ── 푸시 알림 관리 (개별학생 + 저장/재활용) ──────────────
window.onPushTypeChange=async()=>{
  const isStudent=document.getElementById('pushTypeStudent').checked;
  document.getElementById('pushGroupRow').style.display=isStudent?'none':'';
  document.getElementById('pushStudentRow').style.display=isStudent?'':'none';
  if(isStudent){
    const snap=await getDocs(query(collection(db,'users'),where('role','==','student')));
    const el=document.getElementById('pushStudentTarget');
    el.innerHTML=snap.docs.map(d=>{const u=d.data();return `<option value="uid:${d.id}">${u.name} (${u.group||'-'})</option>`;}).join('')||'<option>학생 없음</option>';
  }
};
// ── FCM 토큰 등록 ─────────────────────────────────────────
const VAPID_KEY = 'BGbPEBiwM8RHNH08eDa7xpX-bQB4T_GKoo9_cFYUttHRq8sAdn4157bMKNznq4lw_k1r0Xq6517LBKSyYaEgmG8';

// 실제 FCM 토큰 발급 및 저장
async function doRegisterToken() {
  if(!messaging || !currentUser) return false;
  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if(token) {
      await updateDoc(doc(db,'users',currentUser.uid), { fcmToken: token });
      console.log('FCM 토큰 등록 완료');
      return true;
    }
  } catch(e) {
    console.log('FCM 토큰 등록 실패:', e.message);
  }
  return false;
}

// 알림 허용 버튼 클릭
window.requestNotifPermission = async() => {
  document.getElementById('notifModal').classList.add('hidden');
  const permission = await Notification.requestPermission();
  if(permission === 'granted') {
    const ok = await doRegisterToken();
    if(ok) showToast('✅ 알림이 설정됐어요! 🎉');
  }
};

// 나중에 버튼 → 그냥 닫기 (다음 로그인 때 다시 뜸)
window.dismissNotifModal = () => {
  document.getElementById('notifModal').classList.add('hidden');
};

// 로그인 후 알림 설정 시작 (로그인할 때만 1회 호출)
async function registerFCMToken() {
  if(!messaging || !currentUser) return;
  if(userProfile?.role === 'admin') return; // 관리자는 불필요

  // 이미 허용된 경우 → 바로 토큰 등록 (팝업 없음)
  if(Notification.permission === 'granted') {
    await doRegisterToken();
    return;
  }
  // 차단된 경우 → 팝업 띄워도 의미없으므로 스킵
  if(Notification.permission === 'denied') return;

  // 기본 상태 → 3초 후 팝업 1회 표시
  setTimeout(() => {
    if(!currentUser || userProfile?.role === 'admin') return;
    document.getElementById('notifModal').classList.remove('hidden');
  }, 3000);
}

// 포그라운드 알림 수신
function setupForegroundMessage() {
  if(!messaging) return;
  onMessage(messaging, (payload) => {
    const { title, body } = payload.notification || {};
    // 포그라운드 수신 시 모달 팝업
    showNotifModal(title||'알림', body||'');
  });
}


// ── 알림 팝업 모달 ──────────────────────────────────────────
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
      checkUnreadNotifs();
    };
  }
}

// 앱 진입 시 미확인 알림 순차 표시
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
    const sorted = snap.docs.sort((a,b)=>(a.data().createdAt?.seconds||0)-(b.data().createdAt?.seconds||0));
    const first = sorted[0];
    const d = first.data();
    showNotifModal(d.title||'알림', d.body||'', first.id);
  }catch(e){ console.log('알림 확인 실패',e); }
}

// 뱃지 업데이트
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

// 알림 패널 열기
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

// 개별 알림 읽음 처리
window.readNotif = async(docId) => {
  try{
    await updateDoc(doc(db,'userNotifications',docId),{read:true});
    await openNotifPanel(); // 새로고침
    await updateNotifBadge();
  }catch(e){console.warn(e);}
};

// 알림 패널 닫기
window.closeNotifPanel = () => {
  const panel = document.getElementById('notifPanel');
  if(panel) panel.style.display='none';
};

// 모두 읽음
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

// ── 푸시 알림 발송 (Vercel Function 경유) ─────────────────
function getPushFormData() {
  const isStudent=document.getElementById('pushTypeStudent').checked;
  const target=isStudent
    ? document.getElementById('pushStudentTarget').value
    : document.getElementById('pushTarget').value;
  const title=document.getElementById('pushTitle').value.trim();
  const body=document.getElementById('pushBody').value.trim();
  return { isStudent, target, title, body };
}

// 저장만 (발송 안 함)
window.savePushOnly=async()=>{
  const { target, title, body } = getPushFormData();
  if(!title||!body){showToast('제목과 내용을 입력하세요.');return;}
  const today=new Date().toISOString().slice(0,10);
  await addDoc(collection(db,'pushNotifications'),{
    target, title, body, sent:false, date:today, createdAt:serverTimestamp()
  });
  showToast('💾 알림이 저장됐어요!');
  await loadSavedPushList();
};

// 발송만 (저장 안 함)
window.sendPushNotification=async()=>{
  const { target, title, body } = getPushFormData();
  if(!title||!body){showToast('제목과 내용을 입력하세요.');return;}

  const btns = document.querySelectorAll('#adminPush .add-btn');
  btns.forEach(b=>{ b.disabled=true; });
  btns[0].textContent='발송 중...';

  try {
    const res = await fetch('/api/sendPush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, target }),
    });
    const result = await res.json();
    if(result.success) {
      showToast('✅ ' + result.message);
    } else {
      showToast('⚠️ ' + (result.message || result.error));
    }
  } catch(e) {
    console.error(e);
    showToast('❌ 발송 실패: ' + e.message);
  } finally {
    btns.forEach(b=>{ b.disabled=false; });
    btns[0].textContent='🔔 발송';
  }
};
window.reuseNotification=async (id)=>{
  const snap=await getDoc(doc(db,'pushNotifications',id));
  const n=snap.data();if(!n)return;
  document.getElementById('pushTitle').value=n.title;
  document.getElementById('pushBody').value=n.body;
  // 대상 복원
  if(n.target&&n.target.startsWith('uid:')){
    document.getElementById('pushTypeStudent').checked=true;
    await onPushTypeChange();
    document.getElementById('pushStudentTarget').value=n.target;
  } else {
    document.getElementById('pushTypeGroup').checked=true;
    document.getElementById('pushGroupRow').style.display='';
    document.getElementById('pushStudentRow').style.display='none';
    document.getElementById('pushTarget').value=n.target;
  }
  showToast('내용을 불러왔어요. 수정 후 발송하세요!');
  document.getElementById('adminPush').scrollTop=0;
};
window.delSavedPush=async (id)=>{
  if(!await showConfirm('삭제할까요?'))return;
  await deleteDoc(doc(db,'pushNotifications',id));
  showToast('삭제됐어요.');await loadSavedPushList();
};
async function loadSavedPushList(){
  const el=document.getElementById('savedPushList');if(!el)return;
  try{
    const snap=await getDocs(query(collection(db,'pushNotifications'),orderBy('createdAt','desc')));
    const items=snap.docs.map(d=>({id:d.id,...d.data()}));
    el.innerHTML=items.map(n=>{
      const isStudent=n.target?.startsWith('uid:');
      const targetLabel=isStudent?'개별학생':(n.target==='all'?'전체':n.target||'-');
      return `<div style="background:white;border-radius:14px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 6px rgba(0,0,0,.05);">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;">
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:600;">${esc(n.title)}</div>
            <div style="font-size:12px;color:var(--gray);margin-top:2px;">${esc(n.body?.length>50?n.body.slice(0,50)+'…':n.body||'')}</div>
            <div style="font-size:11px;color:#bbb;margin-top:4px;">${esc(targetLabel)} · ${esc(n.date||'')}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px;">
            <button onclick="reuseNotification('${n.id}')" style="background:#FEE4D8;color:var(--teal);border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;">재활용</button>
            <button onclick="delSavedPush('${n.id}')" style="background:none;border:none;color:#e05050;cursor:pointer;font-size:16px;padding:4px 6px;">✕</button>
          </div>
        </div>
      </div>`;
    }).join('')||'<div class="empty-msg">저장된 알림이 없습니다</div>';
  }catch(e){el.innerHTML='<div class="empty-msg">불러오기 실패</div>';}
}

// ── 탭 전환 ──────────────────────────────────────────────
window.switchAdminTab=tab=>{
  const tabs=['words','users','notice','homework','payment','stats','push'];
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',tabs[i]===tab));
  const map={words:'adminWords',users:'adminUsers',notice:'adminNotice',homework:'adminHomework',payment:'adminPayment',stats:'adminStats',push:'adminPush'};
  Object.entries(map).forEach(([k,v])=>{const el=document.getElementById(v);if(el)el.style.display=k===tab?'':'none';});
  if(tab==='users'){renderGroupTags();renderUserGroupFilter();renderAllGroupSelects();loadAdminUsers();}
  else if(tab==='notice'){renderAllGroupSelects();loadAdminNotices();}
  else if(tab==='homework'){renderAllGroupSelects();loadAdminFiles();}
  else if(tab==='payment'){renderAllGroupSelects();renderPaymentStudentSelect();loadPayments();}
  else if(tab==='stats'){renderStatsGroupFilter();loadStats('all',document.querySelector('#statsGroupFilter .filter-btn'));}
  else if(tab==='push'){renderAllGroupSelects();onPushTypeChange();loadSavedPushList();}
};

// ── 회원가입 ──────────────────────────────────────────────
window.goSignup=async()=>{
  // 그룹 목록 로드
  try{
    const snap=await getDocs(collection(db,'groups'));
    const groups=snap.docs.map(d=>d.data());
    const el=document.getElementById('signupGroup');
    el.innerHTML=groups.map(g=>`<option value="${g.name}">${g.name}</option>`).join('')||'<option value="">그룹 없음</option>';
  }catch(e){console.warn(e);}
  ['signupId','signupName','signupPw','signupPw2','signupPhone','signupParentName','signupParentPhone'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('signupError').textContent='';
  show('signup');
};
window.doSignup=async()=>{
  const err=document.getElementById('signupError');
  err.textContent='';
  const username=document.getElementById('signupId').value.trim();
  const name=document.getElementById('signupName').value.trim();
  const pw=document.getElementById('signupPw').value;
  const pw2=document.getElementById('signupPw2').value;
  const phone=document.getElementById('signupPhone').value.trim();
  const parentName=document.getElementById('signupParentName').value.trim();
  const parentPhone=document.getElementById('signupParentPhone').value.trim();
  if(!username||!name||!pw||!phone){err.textContent='아이디, 이름, 비밀번호, 연락처는 필수입니다.';return;}
  if(!/^[a-zA-Z0-9]+$/.test(username)){err.textContent='아이디는 영문/숫자만 가능해요.';return;}
  if(pw!==pw2){err.textContent='비밀번호가 일치하지 않습니다.';return;}
  if(pw.length<6){err.textContent='비밀번호는 6자 이상이어야 합니다.';return;}
  const email=username+'@kunsori.app';
  try{
    const dup=await getDocs(query(collection(db,'users'),where('username','==',username)));
    if(!dup.empty){err.textContent='이미 사용 중인 아이디입니다.';return;}
    const {initializeApp:ia}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const {getAuth:ga,createUserWithEmailAndPassword:cu,signOut:so}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    let secApp;try{const {getApp}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');secApp=getApp('sec');}catch(e2){secApp=ia(firebaseConfig,'sec');}
    const auth2=ga(secApp);
    const cred=await cu(auth2,email,pw);
    await so(auth2);
    // 그룹은 미정으로 등록 (관리자가 나중에 배정)
    await setDoc(doc(db,'users',cred.user.uid),{username,name,email,phone,group:'미배정',role:'student',parentName,parentPhone,avatarUrl:'',createdAt:serverTimestamp()});
    showToast('✅ 가입 완료! 관리자가 그룹을 배정하면 이용 가능합니다.');
    show('login');
    document.getElementById('usernameInput').value=username;
  }catch(e){
    console.error(e);
    err.textContent=e.code==='auth/email-already-in-use'?'이미 사용 중인 아이디입니다.':'가입 실패: '+e.message;
  }
};

// ── 언스크램블 ──────────────────────────────────────────────
let _unscTest = null;
let _unscSentences = [];
let _unscIdx = 0;
let _unscBuilt = [];
let _unscTimer = null;
let _unscTimeLeft = 60;
let _unscCorrect = 0, _unscWrong = 0;
let _unscSubmitted = false;  // 이중 제출 방지 플래그

window.startUnscrambleTest = async(testId, testName)=>{
  const snap = await getDoc(doc(db,'tests',testId));
  if(!snap.exists()){ showToast('시험을 찾을 수 없습니다.'); return; }
  _unscTest = {id:testId, ...snap.data()};
  window._currentTestData = _unscTest;
  currentTestId = testId;
  currentTestName = testName;

  const words = _unscTest.words||[];
  let sentences = words.map(w=>{
    const raw = (w.en||'').trim();
    // '/' 포함 시 청크(숙어) 단위 분할, 없으면 단어 단위
    const tokens = raw.includes('/')
      ? raw.split('/').map(s=>s.trim()).filter(Boolean)
      : raw.split(/\s+/).filter(Boolean);
    return { en: tokens.join(' '), ko: w.ko||'', tokens, shuffled: shuffle([...tokens]) };
  });
  // mix:true면 문제 출제 순서도 랜덤
  if(_unscTest.mix !== false) sentences = shuffle(sentences);
  _unscSentences = sentences;
  _unscIdx = 0; _unscCorrect = 0; _unscWrong = 0; _unscSubmitted = false;
  show('unscramble');
  showUnscQuestion();
};

function showUnscQuestion(){
  clearUnscTimer();
  _unscSubmitted = false;  // 새 문제마다 제출 플래그 초기화

  if(_unscIdx >= _unscSentences.length){
    showUnscResult();
    return;
  }

  const q = _unscSentences[_unscIdx];
  _unscBuilt = [];

  document.getElementById('unscProgress').textContent = (_unscIdx+1)+'/'+_unscSentences.length;
  const uBar=document.getElementById('unscProgressBar');
  if(uBar) uBar.style.width=Math.round(((_unscIdx+1)/_unscSentences.length)*100)+'%';
  document.getElementById('unscMeaning').textContent = q.ko;

  const builtEl = document.getElementById('unscBuilt');
  if(builtEl){
    builtEl.innerHTML = '';
    builtEl.style.color = '';
    builtEl.style.background = '';
  }

  document.getElementById('unscWords').innerHTML = q.shuffled.map((w,i)=>
    `<button class="unsc-word-btn" id="unscW${i}" onclick="pickUnscWord(${i},'${w.replace(/'/g,"\\'")}')">
      ${w}
    </button>`
  ).join('');

  const submitBtn = document.getElementById('unscSubmitBtn');
  if(submitBtn){
    submitBtn.disabled = true;
    submitBtn.textContent = '▶▶';
    submitBtn.style.background = '';
    submitBtn.style.fontSize = '';
  }
  const resetBtn = document.getElementById('unscResetBtn');
  if(resetBtn) resetBtn.style.opacity = '0.3';

  startUnscTimer();
}

window.submitUnscramble = ()=>{
  // 2단계: 결과 확인 후 ▶▶ 누르면 다음 문제
  if(_unscSubmitted === 'confirmed'){
    _unscIdx++;
    showUnscQuestion();
    return;
  }

  // 1단계: 첫 제출 → 정답/오답 표시
  if(_unscSubmitted) return;
  if(_unscBuilt.length === 0) return;

  _unscSubmitted = true;
  clearUnscTimer();

  const q = _unscSentences[_unscIdx];
  if(!q){ showUnscResult(); return; }

  const answer = _unscBuilt.map(b=>b.word).join(' ');
  const isCorrect = answer.trim().toLowerCase() === q.en.trim().toLowerCase();

  // 단어 버튼 클릭 불가, R 버튼 비활성
  document.querySelectorAll('.unsc-word-btn').forEach(b=>{ b.style.pointerEvents='none'; });
  const resetBtn = document.getElementById('unscResetBtn');
  if(resetBtn) resetBtn.style.opacity='0.3';

  // 정답/오답 표시
  const builtEl = document.getElementById('unscBuilt');
  if(builtEl){
    if(isCorrect){
      builtEl.innerHTML = `<span style="color:#059669;font-weight:700;font-size:15px;">✅ 정답!</span><br><span style="color:#059669;">${answer}</span>`;
      builtEl.style.background = '#d1fae5';
    } else {
      builtEl.innerHTML =
        `<div style="color:#e05050;font-weight:700;font-size:12px;">❌ 오답 &nbsp;<span style="text-decoration:line-through;font-weight:400;">${answer}</span></div>` +
        `<div style="color:#059669;font-weight:700;margin-top:6px;">✅ 정답: ${esc(q.en)}</div>`;
      builtEl.style.background = '#fde8e8';
    }
  }

  if(isCorrect) _unscCorrect++; else _unscWrong++;

  // ▶▶ 버튼을 "다음 →"으로 변경해서 다시 눌러야 다음으로
  _unscSubmitted = 'confirmed';
  const submitBtn = document.getElementById('unscSubmitBtn');
  if(submitBtn){
    submitBtn.disabled = false;
    submitBtn.textContent = '다음 ›';
    submitBtn.style.background = isCorrect ? '#059669' : '#e05050';
    submitBtn.style.fontSize = '15px';
  }
};

window.pickUnscWord = (idx, word)=>{
  if(_unscSubmitted) return;  // 제출 후엔 클릭 무시
  const btn = document.getElementById('unscW'+idx);
  if(!btn || btn.classList.contains('used')) return;
  btn.classList.add('used');
  _unscBuilt.push({idx, word});
  const builtEl = document.getElementById('unscBuilt');
  if(builtEl) builtEl.textContent = _unscBuilt.map(b=>b.word).join(' ');
  const submitBtn = document.getElementById('unscSubmitBtn');
  if(submitBtn) submitBtn.disabled = false;
  const resetBtn = document.getElementById('unscResetBtn');
  if(resetBtn) resetBtn.style.opacity = '1';
};

window.resetUnscramble = ()=>{
  if(_unscSubmitted) return;
  _unscBuilt = [];
  document.querySelectorAll('.unsc-word-btn').forEach(b=>b.classList.remove('used'));
  const builtEl = document.getElementById('unscBuilt');
  if(builtEl){ builtEl.innerHTML=''; builtEl.style.background=''; }
  const submitBtn = document.getElementById('unscSubmitBtn');
  if(submitBtn) submitBtn.disabled = true;
  const resetBtn = document.getElementById('unscResetBtn');
  if(resetBtn) resetBtn.style.opacity = '0.3';
};

window.skipUnscramble = ()=>{
  if(_unscSubmitted) return;
  _unscSubmitted = 'confirmed';
  clearUnscTimer();
  _unscWrong++;
  const q = _unscSentences[_unscIdx];
  const builtEl = document.getElementById('unscBuilt');
  if(builtEl && q){
    builtEl.innerHTML = `<div style="color:#aaa;font-size:12px;margin-bottom:4px;">건너뜀</div><div style="color:#059669;font-weight:700;">✅ 정답: ${esc(q.en)}</div>`;
    builtEl.style.background = '#f8f9fa';
  }
  document.querySelectorAll('.unsc-word-btn').forEach(b=>{ b.style.pointerEvents='none'; });
  const resetBtn = document.getElementById('unscResetBtn');
  if(resetBtn) resetBtn.style.opacity = '0.3';
  const submitBtn = document.getElementById('unscSubmitBtn');
  if(submitBtn){
    submitBtn.disabled = false;
    submitBtn.textContent = '다음 ›';
    submitBtn.style.background = '#888';
    submitBtn.style.fontSize = '15px';
  }
};

function startUnscTimer(){
  _unscTimeLeft = 60;
  updateUnscTimerUI();
  _unscTimer = setInterval(()=>{
    _unscTimeLeft--;
    updateUnscTimerUI();
    if(_unscTimeLeft <= 0){
      clearUnscTimer();
      if(_unscSubmitted) return;
      if(_unscBuilt.length > 0){
        // 입력 있으면 그대로 제출 (결과 확인 후 다음)
        submitUnscramble();
      } else {
        // 아무것도 선택 안 했으면 틀림 처리 후 결과 표시
        _unscSubmitted = 'confirmed';
        _unscWrong++;
        const q = _unscSentences[_unscIdx];
        const builtEl = document.getElementById('unscBuilt');
        if(builtEl && q){
          builtEl.innerHTML = `<div style="color:#aaa;font-size:12px;margin-bottom:4px;">시간 초과</div><div style="color:#059669;font-weight:700;">✅ 정답: ${esc(q.en)}</div>`;
          builtEl.style.background = '#f8f9fa';
        }
        const submitBtn = document.getElementById('unscSubmitBtn');
        if(submitBtn){
          submitBtn.disabled = false;
          submitBtn.textContent = '다음 ›';
          submitBtn.style.background = '#888';
          submitBtn.style.fontSize = '15px';
        }
        document.querySelectorAll('.unsc-word-btn').forEach(b=>{ b.style.pointerEvents='none'; });
        const resetBtn = document.getElementById('unscResetBtn');
        if(resetBtn) resetBtn.style.opacity = '0.3';
      }
    }
  }, 1000);
}
function clearUnscTimer(){ clearInterval(_unscTimer); }
function updateUnscTimerUI(){
  const txt = document.getElementById('unscTimerText');
  const arc = document.getElementById('unscTimerArc');
  if(txt) txt.textContent = _unscTimeLeft;
  if(arc) arc.style.strokeDashoffset = 113*(1-_unscTimeLeft/60);
}

async function showUnscResult(){
  const total = _unscCorrect + _unscWrong;
  const score = Math.round((_unscCorrect/Math.max(total,1))*100);
  const passScore = _unscTest?.passScore ?? 80;
  const passed = score >= passScore;
  lastMode = 'unscramble'; // 다시 풀기 시 올바른 모드 재시작 위해

  show('result');
  document.getElementById('resultScore').textContent = score+'점';
  document.getElementById('resultLabel').textContent =
    passed ? `🎉 통과! (${passScore}점 이상)` : score>=60?'잘 했어요!':'조금 더 연습해요 💪';
  document.getElementById('resultCorrect').textContent = _unscCorrect;
  document.getElementById('resultWrong').textContent = _unscWrong;
  document.getElementById('resultTotal').textContent = total;

  if(currentUser && userProfile && currentTestId){
    try{
      const today = new Date().toISOString().slice(0,10);
      await addDoc(collection(db,'scores'),{
        uid:currentUser.uid, userId:currentUser.uid,
        userName:userProfile.name, name:userProfile.name,
        group:userProfile.group||'',
        testId:currentTestId, testName:currentTestName,
        bookName:_unscTest?.bookName||'',
        mode:'unscramble', testMode:'unscramble',
        score, correct:_unscCorrect, wrong:_unscWrong, total,
        passed, passScore,
        date:today, createdAt:serverTimestamp()
      });
      if(passed){
        await setDoc(
          doc(db,'tests',currentTestId,'userCompleted',currentUser.uid),
          {uid:currentUser.uid, userName:userProfile.name, score, date:today, completedAt:serverTimestamp()},
          {merge:true}
        );
      }
    }catch(e){ console.log('점수저장실패',e); }
  }
}

// updateTestBadge에 언스크램블 뱃지도 추가
async function updateUnscBadge(){
  const badge = document.getElementById('unscrambleBadge');
  if(!badge||!currentUser||!userProfile) return;
  try{
    const myGroup=userProfile.group||'', myUid=currentUser.uid;
    const snap=await getDocs(query(collection(db,'tests'),orderBy('createdAt','desc')));
    const allTests=snap.docs.map(d=>({id:d.id,...d.data()}));
    const myTests=filterMyTests(allTests,myGroup,myUid).filter(t=>t.testMode==='unscramble');
    const completedSet=new Set();
    await Promise.all(myTests.map(async t=>{
      try{ const d=await getDoc(doc(db,'tests',t.id,'userCompleted',myUid)); if(d.exists())completedSet.add(t.id); }catch(e){console.warn(e);}
    }));
    const n=myTests.filter(t=>!completedSet.has(t.id)).length;
    badge.textContent = n>99?'99+':n;
    badge.style.display = n>0?'flex':'none';
  }catch(e){ badge.style.display='none'; }
}

// ── TTS 발음 읽기 ─────────────────────────────────────────
window.speakCurrentWord=()=>{
  let word = null;
  if(lastMode==='mixed'){
    // 혼합 모드: mixedQueue에서 현재 단어
    const item = mixedQueue[mixedIdx];
    word = item?.word?.en || item?.en;
  } else {
    // 일반 4지선다 모드
    const q = questions[currentQ];
    word = q?.en;
  }
  if(!word) return;
  speakWord(word);
};

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

// ── 녹음 숙제 ─────────────────────────────────────────────
let _recCurrentHw = null;      // 현재 숙제 데이터
let _recMediaRecorders = {};   // slot → MediaRecorder
let _recBlobs = {};            // slot → Blob (녹음 데이터)
let _recStreams = {};           // slot → MediaStream
let _recSubmittedSlots = {};   // slot → true/false

window.goRecHw = async() => {
  show('recHwList');
  await loadRecHwList();
  await updateRecBadge();
};

window.loadRecHwList = async() => {
  const elP = document.getElementById('recHwPending');
  const elC = document.getElementById('recHwCompleted');
  if(elP) elP.innerHTML = '<div class="empty-msg" style="padding:20px;">로딩 중...</div>';
  try{
    const myGroup = userProfile?.group||'', myUid = currentUser?.uid||'';
    const snap = await getDocs(query(collection(db,'recHw'), orderBy('createdAt','desc')));
    const allHws = snap.docs.map(d=>({id:d.id,...d.data()}));
    // 내 숙제 필터
    const myHws = allHws.filter(hw=>{
      if(!hw.active && hw.active!==undefined) return false;
      const targets = hw.targets||[];
      return targets.some(t=>(t.type==='class'&&t.id===myGroup)||(t.type==='student'&&t.id===myUid));
    });
    // 제출 현황 확인
    const submittedMap = new Map(); // hwId → [slot numbers]
    await Promise.all(myHws.map(async hw=>{
      try{
        const snap2 = await getDocs(query(collection(db,'recSubmissions'),
          where('hwId','==',hw.id), where('uid','==',myUid)));
        submittedMap.set(hw.id, snap2.docs.map(d=>d.data()).map(d=>d.slot));
      }catch(e){ submittedMap.set(hw.id,[]); }
    }));

    const pending = myHws.filter(hw=>{
      const slots = submittedMap.get(hw.id)||[];
      return slots.length < 3;
    });
    const completed = myHws.filter(hw=>{
      const slots = submittedMap.get(hw.id)||[];
      return slots.length >= 3;
    });

    const makeCard = (hw, done) => {
      const slots = submittedMap.get(hw.id)||[];
      const badge = done
        ? `<span style="font-size:11px;background:#d1fae5;color:#059669;padding:2px 8px;border-radius:20px;font-weight:700;">✅ 완료</span>`
        : `<span style="font-size:11px;background:#f3f0ff;color:#7c3aed;padding:2px 8px;border-radius:20px;">${slots.length}/3 제출</span>`;
      return `<div class="unit-card" onclick="openRecHwDetail('${hw.id}')">
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div class="unit-name">🎙 ${hw.title||'숙제'}</div>${badge}
          </div>
          <div class="unit-count">${hw.dueDate?'마감: '+hw.dueDate:''}</div>
        </div>
        <span class="unit-arrow" style="color:${done?'#059669':''};">${done?'✓':'›'}</span>
      </div>`;
    };

    if(elP) elP.innerHTML = pending.length
      ? pending.map(hw=>makeCard(hw,false)).join('')
      : '<div class="empty-msg" style="padding:20px;color:#bbb;">진행 중인 숙제가 없습니다.</div>';
    if(elC) elC.innerHTML = completed.length
      ? completed.map(hw=>makeCard(hw,true)).join('')
      : '<div class="empty-msg" style="padding:20px;color:#bbb;">완료된 숙제가 없습니다.</div>';
  }catch(e){
    if(elP) elP.innerHTML = `<div class="empty-msg" style="padding:20px;">불러오기 실패</div>`;
  }
};

window.openRecHwDetail = async(hwId) => {
  const snap = await getDoc(doc(db,'recHw',hwId));
  if(!snap.exists()){ showToast('숙제를 찾을 수 없습니다.'); return; }
  _recCurrentHw = {id:hwId, ...snap.data()};
  _recBlobs = {}; _recMediaRecorders = {}; _recStreams = {}; _recSubmittedSlots = {};

  document.getElementById('recHwDetailTitle').textContent = _recCurrentHw.title||'녹음 숙제';
  document.getElementById('recHwContent').textContent = _recCurrentHw.content||'';

  const myUid = currentUser.uid;

  // 기존 제출 내역 + URL 저장
  const subSnap = await getDocs(query(collection(db,'recSubmissions'), where('hwId','==',hwId), where('uid','==',myUid)));
  const submittedUrls = {}; // slot → url
  subSnap.docs.forEach(d=>{
    _recSubmittedSlots[d.data().slot] = true;
    submittedUrls[d.data().slot] = d.data().url;
  });

  // 피드백 (학생별 1개)
  const fbSnap = await getDocs(query(collection(db,'recFeedbacks'), where('hwId','==',hwId), where('uid','==',myUid)));
  const feedback = fbSnap.empty ? null : fbSnap.docs[0].data().feedback;

  // 피드백 읽음 처리
  if(!fbSnap.empty && fbSnap.docs[0].data().read===false){
    updateDoc(fbSnap.docs[0].ref, {read:true}).catch(()=>{});
    updateRecBadge();
  }

  // 각 슬롯 UI 초기화 (피드백은 별도 처리)
  [1,2,3].forEach(n => resetRecSlotUI(n, _recSubmittedSlots[n]===true, submittedUrls[n]));

  // 격려/피드백 영역 표시
  const allSubmitted = [1,2,3].every(n=>_recSubmittedSlots[n]);
  const encEl = document.getElementById('recEncourage');
  if(encEl){
    if(allSubmitted){
      if(feedback){
        encEl.innerHTML = `<div style="background:#e0f2fe;border-radius:12px;padding:14px 16px;border-left:4px solid #0284c7;">
          <div style="font-size:12px;color:#0284c7;font-weight:700;margin-bottom:6px;">💬 선생님 피드백</div>
          <div style="font-size:14px;color:#1e40af;white-space:pre-wrap;">${feedback}</div>
        </div>`;
      } else {
        encEl.innerHTML = `<div style="background:#f0fdf4;border-radius:12px;padding:14px 16px;border-left:4px solid #059669;">
          <div style="font-size:14px;color:#059669;font-weight:600;">🎉 3번 모두 녹음 제출 완료!</div>
          <div style="font-size:13px;color:#065f46;margin-top:4px;">정말 열심히 녹음했어요! 수고했습니다 👏</div>
        </div>`;
      }
      encEl.style.display='block';
    } else {
      encEl.style.display='none';
    }
  }

  show('recHwDetail');
};

function resetRecSlotUI(n, alreadySubmitted, audioUrl){
  const statusEl = document.getElementById('recStatus'+n);
  const audioWrap = document.getElementById('recAudioWrap'+n);
  const btnRecord = document.getElementById('recBtnRecord'+n);
  const btnConfirm = document.getElementById('recBtnConfirm'+n);
  const btnSubmit = document.getElementById('recBtnSubmit'+n);
  const audioEl = document.getElementById('recAudio'+n);

  if(alreadySubmitted){
    if(statusEl){ statusEl.textContent='✅ 제출완료'; statusEl.style.background='#d1fae5'; statusEl.style.color='#059669'; }
    // 재녹음/재제출 버튼 완전 숨김
    if(btnRecord) btnRecord.style.display='none';
    if(btnConfirm) btnConfirm.style.display='none';
    if(btnSubmit) btnSubmit.style.display='none';
    // 다시 듣기: URL이 있으면 오디오 표시
    if(audioUrl && audioEl){
      audioEl.src = audioUrl;
      if(audioWrap) audioWrap.style.display='block';
    }
  } else {
    if(statusEl){ statusEl.textContent='대기'; statusEl.style.background='#f5f5f5'; statusEl.style.color='#aaa'; }
    if(btnRecord){ btnRecord.style.display=''; btnRecord.textContent='🎙 녹음'; btnRecord.style.background='#E8714A'; btnRecord.style.color='white'; }
    if(btnConfirm) btnConfirm.style.display='none';
    if(btnSubmit) btnSubmit.style.display='none';
    if(audioWrap) audioWrap.style.display='none';
  }
}

window.toggleRecording = async(n) => {
  const recorder = _recMediaRecorders[n];
  // 녹음 중이면 정지
  if(recorder && recorder.state === 'recording'){
    recorder.stop();
    return;
  }
  // 새 녹음 시작
  try{
    // 기존 스트림 정리
    if(_recStreams[n]){ _recStreams[n].getTracks().forEach(t=>t.stop()); }
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    _recStreams[n] = stream;
    const chunks = [];
    const mr = new MediaRecorder(stream);
    _recMediaRecorders[n] = mr;
    mr.ondataavailable = e=>{ if(e.data.size>0) chunks.push(e.data); };
    mr.onstop = ()=>{
      _recBlobs[n] = new Blob(chunks, {type:'audio/webm'});
      stream.getTracks().forEach(t=>t.stop());
      // UI 업데이트: 확인/제출 버튼 표시
      const audioEl = document.getElementById('recAudio'+n);
      const audioWrap = document.getElementById('recAudioWrap'+n);
      const btnRecord = document.getElementById('recBtnRecord'+n);
      const btnConfirm = document.getElementById('recBtnConfirm'+n);
      const btnSubmit = document.getElementById('recBtnSubmit'+n);
      const statusEl = document.getElementById('recStatus'+n);
      if(audioEl) audioEl.src = URL.createObjectURL(_recBlobs[n]);
      if(audioWrap) audioWrap.style.display='block';
      if(btnRecord){ btnRecord.textContent='🎙 다시 녹음'; btnRecord.style.background='#e5e7eb'; btnRecord.style.color='#555'; }
      if(btnConfirm) btnConfirm.style.display='block';
      if(btnSubmit) btnSubmit.style.display='none';
      if(statusEl){ statusEl.textContent='녹음완료'; statusEl.style.background='#e0f2fe'; statusEl.style.color='#0284c7'; }
    };
    mr.start();
    // UI: 녹음 중 표시
    const btnRecord = document.getElementById('recBtnRecord'+n);
    const statusEl = document.getElementById('recStatus'+n);
    const btnConfirm = document.getElementById('recBtnConfirm'+n);
    const btnSubmit = document.getElementById('recBtnSubmit'+n);
    if(btnRecord){ btnRecord.textContent='⏹ 정지'; btnRecord.style.background='#e05050'; btnRecord.style.color='white'; }
    if(statusEl){ statusEl.textContent='🔴 녹음 중'; statusEl.style.background='#fee2e2'; statusEl.style.color='#b91c1c'; }
    if(btnConfirm) btnConfirm.style.display='none';
    if(btnSubmit) btnSubmit.style.display='none';
  }catch(e){
    showToast('마이크 접근 실패: '+e.message);
  }
};

window.confirmRec = (n) => {
  // 확인 클릭 → 제출 버튼 활성화
  const btnConfirm = document.getElementById('recBtnConfirm'+n);
  const btnSubmit = document.getElementById('recBtnSubmit'+n);
  const statusEl = document.getElementById('recStatus'+n);
  if(btnConfirm) btnConfirm.style.display='none';
  if(btnSubmit) btnSubmit.style.display='block';
  if(statusEl){ statusEl.textContent='제출 대기'; statusEl.style.background='#fef9c3'; statusEl.style.color='#92400e'; }
};

window.submitRec = async(n) => {
  if(!_recBlobs[n]){ showToast('먼저 녹음해주세요.'); return; }
  const btnSubmit = document.getElementById('recBtnSubmit'+n);
  const statusEl = document.getElementById('recStatus'+n);
  if(btnSubmit){ btnSubmit.disabled=true; btnSubmit.textContent='업로드 중...'; }
  try{
    const fileName = `recHw/${_recCurrentHw.id}/${currentUser.uid}_slot${n}_${Date.now()}.webm`;
    const storageRef = ref(storage, fileName);
    await uploadBytes(storageRef, _recBlobs[n]);
    const url = await getDownloadURL(storageRef);
    // Firestore에 제출 기록
    await addDoc(collection(db,'recSubmissions'),{
      hwId: _recCurrentHw.id,
      uid: currentUser.uid,
      userName: userProfile.name,
      group: userProfile.group||'',
      slot: n,
      url,
      storagePath: fileName,
      submittedAt: serverTimestamp()
    });
    _recSubmittedSlots[n] = true;
    if(statusEl){ statusEl.textContent='✅ 제출완료'; statusEl.style.background='#d1fae5'; statusEl.style.color='#059669'; }
    // 단계 표시기 업데이트
    const stepEl = document.getElementById('recStep'+n);
    if(stepEl){ stepEl.style.background='#E8714A'; stepEl.style.color='white'; }
    if(n<3){ const lineEl=document.getElementById('recStepLine'+n); if(lineEl) lineEl.style.width='100%'; }
    if(n<3){ const nextStep=document.getElementById('recStep'+(n+1)); if(nextStep){ nextStep.style.background='#FEE4D8'; nextStep.style.color='#E8714A'; } }
    if(btnSubmit) btnSubmit.style.display='none';
    // 재녹음 버튼 숨김 (제출 완료 후 재제출 불가)
    const btnRecord = document.getElementById('recBtnRecord'+n);
    if(btnRecord) btnRecord.style.display='none';
    const btnConfirm2 = document.getElementById('recBtnConfirm'+n);
    if(btnConfirm2) btnConfirm2.style.display='none';
    // 제출된 녹음 다시 듣기
    const audioEl2 = document.getElementById('recAudio'+n);
    const audioWrap2 = document.getElementById('recAudioWrap'+n);
    if(audioEl2){ audioEl2.src = url; }
    if(audioWrap2) audioWrap2.style.display='block';
    showToast(`🎙 녹음 ${n}회차 제출 완료!`);
    // 3개 모두 완료 시 격려 메시지
    if([1,2,3].every(s=>_recSubmittedSlots[s])){
      const encEl = document.getElementById('recEncourage');
      if(encEl){
        encEl.innerHTML = `<div style="background:#f0fdf4;border-radius:12px;padding:14px 16px;border-left:4px solid #059669;">
          <div style="font-size:14px;color:#059669;font-weight:600;">🎉 3번 모두 녹음 제출 완료!</div>
          <div style="font-size:13px;color:#065f46;margin-top:4px;">정말 열심히 녹음했어요! 수고했습니다 👏</div>
        </div>`;
        encEl.style.display='block';
      }
      setTimeout(()=>showToast('🎉 모든 녹음 제출 완료!'), 600);
    }
    await updateRecBadge();
  }catch(e){
    showToast('제출 실패: '+e.message);
    if(btnSubmit){ btnSubmit.disabled=false; btnSubmit.textContent='▶ 제출'; }
  }
};

// 녹음숙제 홈 뱃지 (미완료 + 미읽은 피드백)
async function updateRecBadge(){
  const badge = document.getElementById('recBadge');
  if(!badge||!currentUser||!userProfile) return;
  try{
    const myGroup=userProfile.group||'', myUid=currentUser.uid;
    const snap=await getDocs(query(collection(db,'recHw'),orderBy('createdAt','desc')));
    const allHws=snap.docs.map(d=>({id:d.id,...d.data()}));
    const myHws=allHws.filter(hw=>{
      if(!hw.active&&hw.active!==undefined) return false;
      const targets=hw.targets||[];
      return targets.some(t=>(t.type==='class'&&t.id===myGroup)||(t.type==='student'&&t.id===myUid));
    });
    let count = 0;
    await Promise.all(myHws.map(async hw=>{
      try{
        const s=await getDocs(query(collection(db,'recSubmissions'), where('hwId','==',hw.id), where('uid','==',myUid)));
        const myCount=s.docs.length;
        if(myCount<3){ count++; return; }
        // 제출 완료 후 미읽은 피드백 확인
        const fb=await getDocs(query(collection(db,'recFeedbacks'), where('hwId','==',hw.id), where('uid','==',myUid)));
        if(!fb.empty && fb.docs[0].data().read===false) count++;
      }catch(e){ count++; }
    }));
    badge.textContent = count>99?'99+':count;
    badge.style.display = count>0?'flex':'none';
  }catch(e){ badge.style.display='none'; }
}

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
