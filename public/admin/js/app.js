import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc, query, where, orderBy, serverTimestamp, limit, increment, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
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
    _applyAdminBranding(acData);
    // PWA manifest 학원별 갱신 (바로가기 추가 시 학원 로고로 등록)
    if (typeof window.updateAdminManifest === 'function') window.updateAdminManifest(academyId);
  } catch(_) { window.MY_ACADEMY_NAME = ''; }
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
  document.title = acadName + ' 관리자';
  // 다음 진입 시 FOUC 방지용 캐시 (학생 앱과 동일 키)
  try {
    if (logoUrl) localStorage.setItem('lexiLogo192', logoUrl);
    if (acadName) localStorage.setItem('lexiAppName', acadName);
    if (presetId) localStorage.setItem('lexiBrandPreset', presetId);
  } catch (_) {}
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
  'test-list':'시험 목록',
  'score-report':'성적 리포트', 'score-personal':'성장 리포트',
  message:'메시지 관리', notice:'공지 관리', hwfile:'자료실', payment:'결제 관리',
  quotaUsage:'AI 사용량',
  branding:'학원 브랜딩',
  generator:'AI OCR',
  'quiz-generate':'AI Generator', 'quiz-sets':'문제 세트 목록',
  'test-word':'단어시험',
  'test-unscramble':'언스크램블',
  'test-blank':'빈칸채우기',
  'test-mcq':'내용이해_객관식',
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
  else if(id==='test-list') await loadTestList();
  else if(id==='score-report') initScoreReport();
  else if(id==='score-personal') await loadPersonalStudentList();
  else if(id==='generator') await loadGenerator();
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
// billings: yearMonth 필드 (기존 인덱스 academyId+yearMonth 활용)
// genTests: academyId+createdAt 기존 인덱스 → limit 300 fetch 후 클라에서 date 필터
const _bigcalState = {
  cur: { year: new Date().getFullYear(), month: new Date().getMonth() },  // 0-indexed month
  events: {},        // {'YYYY-MM-DD': { billings:[...], tests:[...] }}
  selected: null,    // 'YYYY-MM-DD'
  loading: false,
};

function _bigcalYM(y, m){ return `${y}-${String(m+1).padStart(2,'0')}`; }
function _bigcalDateKey(y, m, d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

async function _bigcalLoadEvents(year, month){
  const academyId = window.MY_ACADEMY_ID;
  if (!academyId) return {};
  const ym = _bigcalYM(year, month);
  const lastDay = new Date(year, month+1, 0).getDate();
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(lastDay).padStart(2,'0')}`;
  const events = {};
  for (let d=1; d<=lastDay; d++) events[_bigcalDateKey(year, month, d)] = { billings:[], tests:[] };

  try {
    // 결제 — billings.yearMonth 기준 (이번 달 청구서)
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
      if (!events[key]) events[key] = { billings:[], tests:[] };
      events[key].billings.push({
        billingId: docSnap.id,
        userId: b.studentUid || '',
        userName: b.studentName || '-',
        groupName: b.groupName || '',
        amount: b.totalAmount || 0,
        paidAmount: b.paidAmount || 0,
        status: b.status || 'unpaid',  // 'paid' | 'partial' | 'unpaid'
      });
    });

    // 시험 — genTests.date 문자열 (academyId+createdAt 기존 인덱스 후 클라 필터)
    const tSnap = await getDocs(query(
      collection(db, 'genTests'),
      where('academyId','==', academyId),
      orderBy('createdAt','desc'),
      limit(300)
    ));
    tSnap.forEach(docSnap => {
      const t = docSnap.data();
      const date = t.date;
      if (!date || date < monthStart || date > monthEnd) return;
      if (!events[date]) events[date] = { billings:[], tests:[] };
      events[date].tests.push({
        id: docSnap.id,
        name: t.name || '-',
        mode: t.mode || t.testMode || 'vocab',
        speaking: !!(t.vocabOptions?.format === 'speaking'),
      });
    });
  } catch (e) {
    console.warn('[bigcal] load events 실패:', e);
  }
  return events;
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

    const billItems = ev.billings.map(b => {
      const cls = b.status === 'paid' ? 'evt-billing-paid'
              : b.status === 'partial' ? 'evt-billing-partial'
              : 'evt-billing-unpaid';
      const icon = b.status === 'paid' ? '✅' : b.status === 'partial' ? '⏳' : '💳';
      const statusLabel = b.status === 'paid' ? '납부' : b.status === 'partial' ? '일부' : '미납';
      return `<div class="bigcal-event ${cls}" title="${esc(b.userName)} ${b.amount.toLocaleString()}원 (${statusLabel})">${icon} ${esc(b.userName)}</div>`;
    });
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

  if (ev.billings.length){
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
      const speak = t.speaking ? ' <span class="badge" style="background:#fef3c7;color:#78350f;font-size:9px;padding:1px 5px;border-radius:8px;font-weight:700;">🎤</span>' : '';
      return `<div class="bigcal-side-row" onclick="goPage('test-list')">
        <div>
          <div class="bigcal-side-name">${esc(t.name)}${speak}</div>
          <div class="bigcal-side-meta">${badge}</div>
        </div>
      </div>`;
    }).join('');
    html += `<div>
      <div class="bigcal-side-section-title">📝 시험 ${ev.tests.length}건</div>
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
          <div style="font-size:13px;font-weight:700;color:var(--text);">📋 항목 (${items.length})</div>
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
async function initDashboard(){
  const now = new Date();
  document.getElementById('dashDate').textContent = now.toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'});
  await Promise.all([loadDashStats(), loadDashNotices(), loadApiUsage(), bigcalInit()]);
}
window.refreshDashboard = initDashboard;

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

    // 5분류 (상세 페이지·super 앱과 동일 순서: OCR → 정리 → Generator → 녹음 → 리포트)
    const items = [
      { label: '📷 OCR',         dailyKeys: ['ocr'],             monthCounter: 'ocrCallsThisMonth',           limitField: 'ocrPerMonth' },
      { label: '🧹 OCR 정리',    dailyKeys: ['cleanup-ocr'],     monthCounter: 'cleanupCallsThisMonth',       limitField: 'cleanupPerMonth' },
      { label: '✨ Generator',   dailyKeys: ['generate-quiz'],   monthCounter: 'generatorCallsThisMonth',     limitField: 'generatorPerMonth' },
      { label: '🎤 녹음숙제',     dailyKeys: ['check-recording'], monthCounter: 'recordingCallsThisMonth',     limitField: 'recordingPerMonth' },
      { label: '📈 성장 리포트', dailyKeys: ['growth-report'],   monthCounter: 'growthReportCallsThisMonth',  limitField: 'growthReportPerMonth' },
    ];

    const fracBar = (cur, lim) => {
      if (typeof lim !== 'number' || lim <= 0) return '';
      const p = Math.min(100, Math.round((cur / lim) * 100));
      const c = p >= 90 ? '#dc2626' : (p >= 70 ? '#f59e0b' : '#059669');
      return `<div style="height:3px;background:#eee;border-radius:2px;overflow:hidden;margin-top:2px;"><div style="height:100%;width:${p}%;background:${c};"></div></div>`;
    };

    // 한 줄에 [라벨 / 일사용량 / 월사용량/한도 + 진도바] — 5분류 통일 형식
    const renderRow = (it) => {
      const day = it.dailyKeys.reduce((s,k) => s + cnt(k), 0);
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
            <span>💾 Storage <span style="color:#bbb;font-size:9px;">(${reconciledStr})</span></span>
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
        <span style="margin-left:auto;font-size:11px;"><a onclick="goPage('quotaUsage')" style="color:var(--teal);cursor:pointer;text-decoration:none;">📊 상세 →</a></span>
      </div>

      <!-- 7줄: 학생 + 5분류 + Storage -->
      <div style="display:flex;flex-direction:column;gap:6px;font-size:11px;">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
            <span>👥 학생</span>
            <span style="color:var(--gray);font-size:10px;">재원생 <b style="color:var(--text);">${studentCur}</b>/${studentLim}</span>
          </div>
          ${fracBar(studentCur, studentLim)}
        </div>
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

    const items = [
      { label: '📷 OCR (이미지 인식)',       counter: 'ocrCallsThisMonth',       limitField: 'ocrPerMonth',          color: '#0ea5e9' },
      { label: '🧹 Cleanup (텍스트 정리)',    counter: 'cleanupCallsThisMonth',   limitField: 'cleanupPerMonth',      color: '#06b6d4' },
      { label: '✨ Generator (AI 문제 생성)', counter: 'generatorCallsThisMonth', limitField: 'generatorPerMonth',    color: '#f59e0b' },
      { label: '🎙 녹음 평가',                counter: 'recordingCallsThisMonth', limitField: 'recordingPerMonth',    color: '#8b5cf6' },
      { label: '📈 성장 리포트',              counter: 'growthReportCallsThisMonth',   limitField: 'growthReportPerMonth', color: '#10b981' },
    ];

    const planName = (plan.displayName || planId).toUpperCase();
    header.innerHTML = `<span class="badge badge-teal" style="font-size:11px;">${esc(planName)}</span>
      <span style="margin-left:8px;">${esc(acad.name || '')} · 학생 한도 ${esc(tier)}명</span>`;

    const _fmtBytes = (n) => {
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
      return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
    };

    grid.innerHTML = items.map(item => {
      const current = usage[item.counter] || 0;
      const limitRaw = customLimits[item.limitField] ?? tierLimits[item.limitField];
      const limit = (typeof limitRaw === 'number') ? limitRaw : 0;
      const isOverride = customLimits[item.limitField] !== undefined;
      const percent = limit > 0 ? Math.min(100, (current / limit) * 100) : 0;
      const barColor = percent >= 95 ? '#dc2626' : percent >= 80 ? '#f59e0b' : item.color;
      const labelColor = percent >= 95 ? '#dc2626' : percent >= 80 ? '#f59e0b' : 'var(--text)';

      return `
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin-bottom:4px;">
            <span style="font-weight:600;">${item.label}${isOverride ? ' <span style="color:#0ea5e9;font-size:11px;">(override)</span>' : ''}</span>
            <span style="color:${labelColor};"><b>${current.toLocaleString()}</b> / ${limit.toLocaleString()} <span style="color:var(--gray);font-size:11px;">(${percent.toFixed(1)}%)</span></span>
          </div>
          <div style="background:#eee;height:14px;border-radius:7px;overflow:hidden;">
            <div style="background:${barColor};height:100%;width:${percent}%;transition:width 0.3s;"></div>
          </div>
          ${percent >= 95 ? `<div style="font-size:11px;color:#dc2626;margin-top:3px;">⚠ 한도 ${Math.round(percent)}% 도달 — 곧 차단됩니다</div>`
            : percent >= 80 ? `<div style="font-size:11px;color:#f59e0b;margin-top:3px;">한도 ${Math.round(percent)}% 도달</div>`
            : ''}
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
            <span style="font-weight:600;">💾 Storage (파일 저장)${isOverride ? ' <span style="color:#0ea5e9;font-size:11px;">(override)</span>' : ''}</span>
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
    const usersSnap = await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID)));
    let active=0, pause=0, out=0;
    usersSnap.forEach(d=>{
      const s=d.data().status||'active';
      const r=d.data().role;
      if(r!=='student') return;
      if(s==='active') active++;
      else if(s==='pause') pause++;
      else if(s==='out') out++;
    });
    document.getElementById('statTotal').textContent = active+pause+out;
    document.getElementById('statActive').textContent = active;
    document.getElementById('statPause').textContent = pause;

    // 미납 = 이번 달 billings 중 status !== 'paid' (unpaid + partial)
    const ym = _ymdKST().slice(0,7);
    const billSnap = await getDocs(query(collection(db,'billings'),where('academyId','==',window.MY_ACADEMY_ID),where('yearMonth','==',ym)));
    let unpaidCnt = 0;
    billSnap.forEach(d => { if ((d.data().status || 'unpaid') !== 'paid') unpaidCnt++; });
    document.getElementById('statUnpaid').textContent = unpaidCnt;

    // 오늘 출제된 시험 = genTests where date == today
    const today = _ymdKST();
    const testSnap = await getDocs(query(collection(db,'genTests'),where('academyId','==',window.MY_ACADEMY_ID),where('date','==',today)));
    document.getElementById('statTests').textContent = testSnap.size;
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
      <td class="td-center">${g.hideApp?'<span class="badge badge-amber">숨김</span>':'-'}</td>
      <td class="td-center">${g.allBooks?'<span class="badge badge-blue">허용</span>':'-'}</td>
      <td class="td-sub">${g.createdAt?.toDate?g.createdAt.toDate().toLocaleDateString('ko-KR'):'-'}</td>
    </tr>`, 'classPagination', 7);
  }catch(e){document.getElementById('classTableBody').innerHTML='<tr><td colspan="7" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';}
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
  if (!name) { showAlert('입력 확인', '반 이름을 입력하세요.'); return; }
  await addDoc(collection(db,'groups'),{name,teacher,createdAt:serverTimestamp(),academyId:window.MY_ACADEMY_ID||'default'});
  closeModal(); showToast('반이 생성됐어요!'); await loadClasses();
};
window.deleteClass = async(id,name) => {
  if(!await showConfirm(`"${name}" 반을 삭제할까요?`))return;
  await deleteDoc(doc(db,'groups',id));
  showToast('삭제됐어요.'); await loadClasses();
};

// ── 학생 관리 ──────────────────────────────────────
async function loadStudents(status='active'){
  const elMap={'active':'studentTableBody','pause':'pauseTableBody','out':'outTableBody'};
  const el=document.getElementById(elMap[status]);
  if(!el)return;
  try{
    const snap=await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID),where('role','==','student'),where('status','==',status)));
    allStudents=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderStudentTable(status, allStudents);
    if(status==='active'){
      const classSnap=await getDocs(query(collection(db,'groups'),where('academyId','==',window.MY_ACADEMY_ID)));
      const sel=document.getElementById('studentClassFilter');
      if(sel) sel.innerHTML='<option value="">전체 반</option>'+classSnap.docs.map(d=>`<option value="${esc(d.data().name)}">${esc(d.data().name)}</option>`).join('');
    }
  }catch(e){el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';}
}

function renderStudentTable(status, students){
  const tbodyMap={'active':'studentTableBody','pause':'pauseTableBody','out':'outTableBody'};
  const pgMap={'active':'studentPagination','pause':'pausePagination','out':'outPagination'};
  const tbodyId=tbodyMap[status], pgId=pgMap[status];
  if(status==='active'){
    initPagination(tbodyId, students, (u,i)=>`<tr>
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
    </tr>`, pgId, 10);
  } else {
    initPagination(tbodyId, students, (u,i)=>`<tr>
      <td><input type="checkbox" value="${u.id}"></td>
      <td>${i+1}</td>
      <td class="td-mono">${esc(u.username)||'-'}</td>
      <td style="font-weight:600;">${esc(u.name)||'-'}</td>
      <td class="td-sm">${esc(u.birth)||'-'}</td>
      <td class="td-sm">${esc(u.school)||'-'}</td>
      <td class="td-sm">${esc(u.grade)||'-'}</td>
      <td class="td-sub">${u.createdAt?.toDate?u.createdAt.toDate().toLocaleDateString('ko-KR'):'-'}</td>
      <td class="td-sub">${u.statusDate||'-'}</td>
    </tr>`, pgId, 9);
  }
}

window.filterStudents = () => {
  const cls=document.getElementById('studentClassFilter').value;
  const filtered=cls?allStudents.filter(u=>u.group===cls):allStudents;
  renderStudentTable('active',filtered);
};
window.searchStudents = () => {
  const q=document.getElementById('studentSearch').value.toLowerCase();
  const filtered=q?allStudents.filter(u=>(u.name||'').toLowerCase().includes(q)||(u.username||'').toLowerCase().includes(q)):allStudents;
  renderStudentTable('active',filtered);
};
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
    showToast('휴원처리 완료!'); await loadStudents('active');
  } else if(action==='out'){
    if(!await showConfirm(`선택한 ${checked.length}명을 퇴원처리 할까요?`))return;
    for(const id of checked) await updateDoc(doc(db,'users',id),{status:'out',statusDate:_ymdKST(),'tuitionPlan.active':false});
    await _adjustActiveStudentCount(-checked.length);  // active → out: -N
    showToast('퇴원처리 완료!'); await loadStudents('active');
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
  closeModal(); showToast('반 배정 완료!'); await loadStudents('active');
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
  if(currentPage==='student-pause') await loadStudents('pause');
  else await loadStudents('out');
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
          <div><div style="color:var(--gray);margin-bottom:5px;">비밀번호 *</div><input id="sPw" type="password" placeholder="6자 이상" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
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
      idToken, username, password: pw, name, group,
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
    closeModal(); showToast('✅ 학생이 추가됐어요!'); await loadStudents('active');
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
    if(snap.empty){el.innerHTML='<tr><td colspan="5" style="text-align:center;color:#bbb;padding:20px;">공지가 없습니다</td></tr>';return;}
    const notices=snap.docs.map(d=>({id:d.id,...d.data()}));
    initPagination('noticeTableBody', notices, (n,i)=>`<tr>
        <td><input type="checkbox" value="${n.id}"></td>
        <td>${i+1}</td>
        <td style="font-weight:600;cursor:pointer;color:var(--teal);" onclick="editNotice('${n.id}','${(n.title||'').replace(/'/g,"\\'")}')">${esc(n.title)||'-'}</td>
        <td><span class="badge badge-teal">${n.target==='all'?'전체':esc(n.target)||'-'}</span></td>
        <td class="td-sub">${esc(n.date)||''}</td>
      </tr>`, 'noticePagination', 10);
  }catch(e){el.innerHTML='<tr><td colspan="5" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';}
}
window.openNoticeModal = async() => {
  const classSnap=await getDocs(query(collection(db,'groups'),where('academyId','==',window.MY_ACADEMY_ID)));
  const opts='<option value="all">전체</option>'+classSnap.docs.map(d=>`<option value="${esc(d.data().name)}">${esc(d.data().name)}</option>`).join('');
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">공지 작성</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">대상</div>
            <select id="noticeTarget" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${opts}</select></div>
          <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">제목 *</div>
            <input id="noticeTitle" type="text" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">내용 *</div>
            <textarea id="noticeContent" rows="5" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;resize:vertical;outline:none;"></textarea></div>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="saveNotice()">등록</button>
      </div>
    </div>
  `);
};
window.saveNotice = async() => {
  const title=document.getElementById('noticeTitle').value.trim();
  const content=document.getElementById('noticeContent').value.trim();
  const target=document.getElementById('noticeTarget').value;
  if (!title||!content) { showAlert('입력 확인', '제목과 내용을 입력하세요.'); return; }
  await addDoc(collection(db,'notices'),{title,content,target,date:_ymdKST(),createdAt:serverTimestamp(),academyId:window.MY_ACADEMY_ID||'default'});
  closeModal(); showToast('공지가 등록됐어요!'); await loadNotices();
};
window.deleteNotice = async(id) => {
  if(!await showConfirm('공지를 삭제할까요?'))return;
  await deleteDoc(doc(db,'notices',id));
  showToast('삭제됐어요.'); await loadNotices();
};

// ── 자료실 (구 숙제파일) ─────────────────────────────────
async function loadHwFileAdmin(){
  const el = document.getElementById('hwfileTableBody'); if(!el) return;
  try{
    const snap = await getDocs(query(collection(db,'hwFiles'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('createdAt','desc')));
    const files = snap.docs.map(d=>({id:d.id,...d.data()}));
    const icons={pdf:'📄',docx:'📝',doc:'📝',jpg:'🖼',jpeg:'🖼',png:'🖼',hwp:'📋'};
    initPagination('hwfileTableBody', files, (f,i)=>`<tr>
      <td><input type="checkbox" value="${f.id}"></td>
      <td>${i+1}</td>
      <td style="font-weight:600;">${esc(f.name)||'-'}</td>
      <td><span class="badge badge-teal">${f.group==='전체'?'전체':esc(f.group)||'-'}</span></td>
      <td>${icons[f.type]||'📄'} ${(f.type||'').toUpperCase()}</td>
      <td class="td-sub">${f.date||''}</td>
      <td><a href="${f.url||'#'}" target="_blank" class="btn btn-secondary btn-sm">다운로드</a></td>
      <td><button class="btn btn-secondary btn-sm" onclick="editHwFile('${f.id}')">✏️ 수정</button></td>
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

  // 반/학생 목록 로드
  const usersSnap = await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID),where('role','==','student'),where('status','==','active')));
  const students = usersSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.name||'').localeCompare(b.name||'','ko'));
  const groups = [...new Set(students.map(u=>u.group).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));

  // 현재 대상값 결정
  let currentTarget = 'all';
  if(f.targetUid) currentTarget = 'uid:'+f.targetUid;
  else if(f.group && f.group !== '전체') currentTarget = 'group:'+f.group;

  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">✏️ 자료 수정</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="display:flex;flex-direction:column;gap:14px;font-size:13px;">
          <div>
            <div style="color:var(--gray);margin-bottom:6px;">파일명</div>
            <input id="hwfEditName" type="text" value="${(f.name||'').replace(/"/g,'&quot;')}"
              style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;outline:none;">
          </div>
          <div>
            <div style="color:var(--gray);margin-bottom:6px;">대상 선택</div>
            <select id="hwfEditTarget" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;outline:none;">
              <option value="all" ${currentTarget==='all'?'selected':''}>전체</option>
              <optgroup label="── 반별 ──">
                ${groups.map(g=>`<option value="group:${g}" ${currentTarget==='group:'+g?'selected':''}>${g}</option>`).join('')}
              </optgroup>
              <optgroup label="── 개별 학생 ──">
                ${students.map(u=>`<option value="uid:${u.id}" ${currentTarget==='uid:'+u.id?'selected':''}>${u.name} (${esc(u.group)||'-'})</option>`).join('')}
              </optgroup>
            </select>
          </div>
          <div style="padding:10px 12px;background:#f8f9fa;border-radius:8px;font-size:12px;color:var(--gray);">
            📎 현재 파일: <b style="color:var(--text);">${esc(f.name)||'-'}.${f.type||''}</b>
            <br><span style="font-size:11px;">파일 자체를 교체하려면 삭제 후 새로 등록하세요.</span>
          </div>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="saveHwFileEdit('${id}')">💾 저장</button>
      </div>
    </div>`);
  setTimeout(()=>document.getElementById('hwfEditName')?.focus(),100);
};

window.saveHwFileEdit = async(id) => {
  const name = document.getElementById('hwfEditName')?.value.trim();
  const targetVal = document.getElementById('hwfEditTarget')?.value||'all';
  if (!name) { showAlert('입력 확인', '파일명을 입력하세요.'); return; }

  let group = '전체', targetUid = null;
  if(targetVal.startsWith('group:')) group = targetVal.replace('group:','');
  else if(targetVal.startsWith('uid:')){ targetUid = targetVal.replace('uid:',''); group = targetUid; }

  await updateDoc(doc(db,'hwFiles',id),{ name, group, targetUid: targetUid||null, updatedAt:serverTimestamp() });
  closeModal();
  showToast('✅ 수정됐어요!');
  await loadHwFileAdmin();
};

window.openHwFileModal = async() => {
  // 반/학생 목록 로드
  const usersSnap = await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID),where('role','==','student'),where('status','==','active')));
  const students = usersSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.name||'').localeCompare(b.name||'','ko'));
  const groups = [...new Set(students.map(u=>u.group).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));

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
            <div style="color:var(--gray);margin-bottom:6px;">대상 선택</div>
            <select id="hwfTarget" onchange="onHwfTargetChange()" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;outline:none;">
              <option value="all">전체</option>
              <optgroup label="── 반별 ──">
                ${groups.map(g=>`<option value="group:${g}">반: ${g}</option>`).join('')}
              </optgroup>
              <optgroup label="── 개별 학생 ──">
                ${students.map(u=>`<option value="uid:${u.id}">학생: ${u.name} (${esc(u.group)||'-'})</option>`).join('')}
              </optgroup>
            </select>
          </div>
          <div>
            <div style="color:var(--gray);margin-bottom:6px;">파일 선택</div>
            <input type="file" id="hwfFile" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx,.jpg,.jpeg,.png,.gif,.bmp,.webp,.heic,.heif,.txt,.csv"
              style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">
            <div style="margin-top:6px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;color:#475569;line-height:1.6;">
              <div style="font-weight:600;color:#0f172a;margin-bottom:2px;">📋 허용 형식 (단일 파일 최대 20 MB)</div>
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
  const targetVal = document.getElementById('hwfTarget')?.value||'all';
  const fileEl = document.getElementById('hwfFile');
  const file = fileEl?.files[0];
  if (!name) { showAlert('입력 확인', '파일명을 입력하세요.'); return; }
  if (!file) { showAlert('입력 확인', '파일을 선택하세요.'); return; }

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

  // 대상 파싱
  let group = '전체', targetUid = null;
  if(targetVal.startsWith('group:')) group = targetVal.replace('group:','');
  else if(targetVal.startsWith('uid:')){ targetUid = targetVal.replace('uid:',''); group = targetUid; }

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

    await addDoc(collection(db,'hwFiles'),{
      name, url, group,
      targetUid: targetUid||null,
      type: ext,
      date: today,
      storagePath: path,
      createdAt: serverTimestamp(),
      academyId: window.MY_ACADEMY_ID || 'default',
    });

    closeModal();
    showToast('✅ 파일이 등록됐어요!');
    await loadHwFileAdmin();
  }catch(e){
    showToast('업로드 실패: '+e.message);
    if(btn){ btn.disabled=false; btn.textContent='📤 업로드'; }
  }
};

window.deleteSelectedHwFile = async() => {
  const ids = getCheckedIds('hwfileTableBody');
  if (!ids.length) { showAlert('입력 확인', '삭제할 파일을 선택하세요.'); return; }
  if(!await showConfirm(`선택한 파일 ${ids.length}개를 삭제할까요?`)) return;
  for(const id of ids){
    try{
      const d = await getDoc(doc(db,'hwFiles',id));
      if(d.exists() && d.data().storagePath){
        try{ await deleteObject(ref(storage, d.data().storagePath)); }catch(e){console.warn(e);}
      }
      await deleteDoc(doc(db,'hwFiles',id));
    }catch(e){console.warn(e);}
  }
  showToast('삭제됐어요.'); await loadHwFileAdmin();
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
let _billings = [];             // 현재 월 청구서
let _billingFilterGroup = '';   // 반 필터
let _billingFilterStatus = '';  // 상태 필터

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

async function _renderBillingGrid(generated = 0) {
  const main = document.getElementById('billingMain');
  if (!main) return;
  const academyId = window.MY_ACADEMY_ID || 'default';

  // 청구서 로드
  const billingSnap = await getDocs(query(
    collection(db, 'billings'),
    where('academyId', '==', academyId),
    where('yearMonth', '==', _billingMonth),
  ));
  _billings = billingSnap.docs.map(d => ({ id: d.id, ...d.data() }));
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
        <button onclick="event.stopPropagation();_billingDeleteRow('${b.id}','${esc(b.studentName||'').replace(/'/g,"&#39;")}','${esc(b.studentUid||'')}')" title="이 청구서 삭제 + 자동 청구 영구 OFF" style="padding:5px 10px;font-size:12px;background:white;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;font-weight:600;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;"><span style="font-size:14px;line-height:1;">🗑</span>삭제</button>
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

  const billingSnap = await getDocs(query(
    collection(db, 'billings'),
    where('academyId', '==', academyId),
    where('yearMonth', '==', _billingMonth),
  ));
  const billings = billingSnap.docs.map(d => ({ id: d.id, ...d.data() }));

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

  // 3개월 청구서 일괄 fetch (in 쿼리)
  const billingSnap = await getDocs(query(
    collection(db, 'billings'),
    where('academyId', '==', academyId),
    where('yearMonth', 'in', months),
  ));
  const billings = billingSnap.docs.map(d => ({ id: d.id, ...d.data() }));

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
    await updateDoc(doc(db, 'billings', billingId), { items, totalAmount, paidAmount, status, updatedAt: serverTimestamp() });
    await _renderBillingGrid();
  } catch (e) { showAlert('저장 실패', e.message); }
};

// ── 항목 사이드 패널 (P1-6) ────────────────────────────
let _billingPanelId = null;
let _billingPanelChannel = null;

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
          <button class="action-btn danger" onclick="_billingDeleteItem('${it.itemId}')" style="padding:3px 7px;font-size:11px;">🗑</button>
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
    await updateDoc(doc(db, 'billings', b.id), { items, totalAmount, paidAmount, updatedAt: serverTimestamp() });
    b.items = items; b.totalAmount = totalAmount; b.paidAmount = paidAmount;
    _billingRenderItemPanel();
  } catch (e) { showAlert('추가 실패', e.message); }
};

window._billingUpdateItem = async (itemId, field, value) => {
  const b = _billings.find(x => x.id === _billingPanelId);
  if (!b) return;
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
    // 그리드도 백그라운드 갱신 (모달 닫을 때 보일 수 있도록)
  } catch (e) { showAlert('저장 실패', e.message); }
};

// 완료 버튼 — 활성 input blur 강제 → 진행 중 저장 완료 대기 → 모달 닫기
window._billingPanelDone = async () => {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')) {
    active.blur();  // pending blur 핸들러 fire (async updateDoc 시작)
  }
  // 짧은 대기로 updateDoc 완료 보장 (Firestore 보통 100~300ms)
  await new Promise(r => setTimeout(r, 350));
  closeModal();  // closeModal hook 이 그리드 자동 갱신
};

window._billingDeleteItem = async (itemId) => {
  if (!await showConfirm('항목 삭제', '이 항목을 삭제할까요?')) return;
  const b = _billings.find(x => x.id === _billingPanelId);
  if (!b) return;
  try {
    const items = (b.items || []).filter(i => i.itemId !== itemId);
    const totalAmount = items.reduce((s, i) => s + (i.amount || 0), 0);
    const paidAmount = items.filter(i => i.paid).reduce((s, i) => s + (i.amount || 0), 0);
    const status = totalAmount === 0 ? 'paid' : (paidAmount >= totalAmount ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid'));
    await updateDoc(doc(db, 'billings', b.id), { items, totalAmount, paidAmount, status, updatedAt: serverTimestamp() });
    b.items = items; b.totalAmount = totalAmount; b.paidAmount = paidAmount; b.status = status;
    _billingRenderItemPanel();
  } catch (e) { showAlert('삭제 실패', e.message); }
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
        ${icon} ${label}${tplHasCustom ? ' <span style="font-size:9px;opacity:0.85;">✏️</span>' : ''}
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
    ? `<div style="padding:6px 10px;background:#ecfeff;border-radius:5px;font-size:11px;color:#0e7490;margin-bottom:8px;">✏️ 학원에서 편집한 템플릿이 적용됨 — 모든 학생에 동일.</div>`
    : '';

  const footerHtml = isBulk
    ? `<button class="btn btn-secondary" onclick="_billingBulkSkip()" style="font-size:12px;">⏭ 건너뛰기</button>
       <button class="btn btn-primary" onclick="_billingCopyMessage()" style="font-size:13px;font-weight:700;">📋 복사 후 다음 →</button>`
    : `<button class="btn btn-secondary" onclick="_billingOpenTemplateEditor('${s.template}')" style="font-size:12px;" title="모든 학생에게 적용되는 템플릿 편집">⚙️ 템플릿 편집</button>
       <button class="btn btn-secondary" onclick="closeModal()" style="font-size:12px;">닫기</button>
       <button class="btn btn-primary" onclick="_billingCopyMessage()" style="font-size:13px;font-weight:700;">📋 복사하기</button>`;

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
    return `<button onclick="_billingTplChangeTab('${key}')" style="padding:6px 12px;border:1px solid var(--border);background:${isActive ? 'var(--teal)' : 'white'};color:${isActive ? 'white' : 'var(--text)'};border-radius:6px;font-size:12px;font-weight:${isActive ? '700' : '500'};cursor:pointer;">${icon} ${label}${(tplCust || draftDirty) ? ' <span style="font-size:9px;opacity:0.85;">✏️</span>' : ''}</button>`;
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
              <span style="font-size:12px;font-weight:600;">✏️ 내가 쓸 메시지 ${isCust ? '<span style="color:#0d9488;font-weight:400;">(편집됨)</span>' : '<span style="color:#bbb;font-weight:400;">(기본값)</span>'}</span>
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
        <button class="btn btn-primary" onclick="_billingTplSaveAll()" style="font-size:13px;font-weight:700;">💾 모든 학생에 적용</button>
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
    if (currentPage === 'payment') _renderBillingGrid();
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
    const defaultDueDay = _billingSettings?.defaultDueDay || 15;
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
  _billingWizardData = {
    defaultDueDay: existing.defaultDueDay || 15,
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
  const dueDayOpts = ['<option value="0">말일</option>',
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
    defaultDueDay: d.defaultDueDay || 15,
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

// ── 메시지 관리 ──────────────────────────────────────
window.onMsgTypeChange = async() => {
  const type=document.querySelector('input[name=msgType]:checked').value;
  document.getElementById('msgGroupRow').style.display=type==='group'?'':'none';
  document.getElementById('msgStudentRow').style.display=type==='student'?'':'none';
  if(type==='group'){
    const snap=await getDocs(query(collection(db,'groups'),where('academyId','==',window.MY_ACADEMY_ID)));
    document.getElementById('msgGroup').innerHTML=snap.docs.map(d=>`<option value="${esc(d.data().name)}">${esc(d.data().name)}</option>`).join('');
  }
  if(type==='student'){
    const snap=await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID),where('role','==','student'),where('status','==','active')));
    document.getElementById('msgStudent').innerHTML=snap.docs.map(d=>{const u=d.data();return`<option value="uid:${d.id}">${u.name} (${esc(u.group)||'-'})</option>`;}).join('');
  }
};
window.sendMessage = async() => {
  const type=document.querySelector('input[name=msgType]:checked').value;
  let target='all';
  if(type==='group') target=document.getElementById('msgGroup').value;
  if(type==='student') target=document.getElementById('msgStudent').value;
  const title=document.getElementById('msgTitle').value.trim();
  const body=document.getElementById('msgBody').value.trim();
  if (!title||!body) { showAlert('입력 확인', '제목과 내용을 입력하세요.'); return; }
  try{
    const idToken = await currentUser.getIdToken();
    const res=await fetch('/api/sendPush',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,body,target,idToken})});
    const result=await res.json();
    showToast(result.success?'✅ '+result.message:'⚠️ '+(result.message||result.error));
  }catch(e){showToast('❌ 발송 실패: '+e.message);}
};
window.saveMessage = async() => {
  const type=document.querySelector('input[name=msgType]:checked').value;
  let target='all';
  if(type==='group') target=document.getElementById('msgGroup').value;
  if(type==='student') target=document.getElementById('msgStudent').value;
  const title=document.getElementById('msgTitle').value.trim();
  const body=document.getElementById('msgBody').value.trim();
  if (!title||!body) { showAlert('입력 확인', '제목과 내용을 입력하세요.'); return; }
  await addDoc(collection(db,'pushNotifications'),{target,title,body,sent:false,date:_ymdKST(),createdAt:serverTimestamp(),academyId:window.MY_ACADEMY_ID||'default'});
  showToast('💾 저장됐어요!'); await loadMessages();
};
async function loadMessages(){
  const el=document.getElementById('savedMsgList');
  try{
    const snap=await getDocs(query(collection(db,'pushNotifications'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','desc')));
    if(snap.empty){el.innerHTML='<div style="color:#bbb;font-size:13px;text-align:center;padding:20px;">메시지가 없습니다</div>';return;}

    const drafts=[], sent=[];
    snap.docs.forEach(d=>{ (d.data().sent ? sent : drafts).push(d); });

    const renderDraft=d=>{
      const n=d.data();
      const isStudent=n.target?.startsWith('uid:');
      const targetLabel=isStudent?'개별학생':(n.target==='all'?'전체':n.target||'-');
      return `<div style="border:1px dashed var(--border);background:#fffbf3;border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:.15s;"
        onclick="reuseMsg('${d.id}')" title="클릭하면 입력창에 채워집니다"
        onmouseover="this.style.background='#fef6e7'" onmouseout="this.style.background='#fffbf3'">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;">${esc(n.title)||''}</div>
            <div style="font-size:11px;color:var(--gray);margin-top:2px;">${esc(n.body||'').slice(0,50)}${(n.body||'').length>50?'...':''}</div>
            <div style="font-size:11px;color:#bbb;margin-top:3px;">${esc(targetLabel)} · ${esc(n.date)||''}</div>
          </div>
          <button onclick="event.stopPropagation();delDraftMsg('${d.id}')" title="초안 삭제" style="background:none;border:none;color:#e05050;cursor:pointer;font-size:15px;padding:0 4px;flex-shrink:0;">✕</button>
        </div>
      </div>`;
    };

    const renderSent=d=>{
      const n=d.data();
      const isStudent=n.target?.startsWith('uid:');
      const targetLabel=isStudent?'개별학생':(n.target==='all'?'전체':n.target||'-');
      return `<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:.15s;"
        onclick="showMsgReadStatus('${d.id}','${(n.title||'').replace(/'/g,"\\'")}')"
        onmouseover="this.style.background='#f0fafa'" onmouseout="this.style.background=''">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;">${esc(n.title)||''}</div>
            <div style="font-size:11px;color:var(--gray);margin-top:2px;">${esc(n.body||'').slice(0,50)}${(n.body||'').length>50?'...':''}</div>
            <div style="font-size:11px;color:#bbb;margin-top:3px;">${esc(targetLabel)} · ${esc(n.date)||''}</div>
          </div>
          <div style="display:flex;gap:2px;flex-shrink:0;">
            <button onclick="event.stopPropagation();reuseMsg('${d.id}')" title="재활용 — 제목·내용을 입력창에 채움" style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:14px;padding:2px 6px;">♻</button>
            <button onclick="event.stopPropagation();delMsg('${d.id}')" title="삭제 (학생 알림함도 함께 사라짐)" style="background:none;border:none;color:#e05050;cursor:pointer;font-size:15px;padding:0 4px;">✕</button>
          </div>
        </div>
      </div>`;
    };

    const sectionHeader=(label, count)=>`<div style="font-size:11px;font-weight:700;color:var(--gray);margin:6px 2px 6px;letter-spacing:.5px;">${label} (${count})</div>`;

    let html='';
    if(drafts.length) html += sectionHeader('💾 저장된 초안', drafts.length) + drafts.map(renderDraft).join('');
    if(sent.length)   html += sectionHeader('📤 발송 이력', sent.length) + sent.map(renderSent).join('');
    el.innerHTML = html;
  }catch(e){
    console.error('[loadMessages]', e);
    el.innerHTML=`<div style="color:#e05050;font-size:13px;">불러오기 실패: ${esc(e.message||e.code||'')}</div>`;
  }
}

// 초안 삭제 — userNotifications cascade 불필요 (안 보냈으니 자녀 doc 없음)
window.delDraftMsg = async(id) => {
  if(!(await showConfirm('초안 삭제할까요?'))) return;
  try{
    await deleteDoc(doc(db,'pushNotifications',id));
    showToast('삭제됐어요.');
    await loadMessages();
  }catch(e){ showToast('삭제 실패: '+e.message); }
};

window.showMsgReadStatus = async(pushId, title) => {
  const titleEl = document.getElementById('msgReadTitle');
  const listEl  = document.getElementById('msgReadList');
  if(!listEl) return;
  if(titleEl) titleEl.innerHTML = `👁 읽음 현황 <span style="font-size:13px;color:var(--text);font-weight:600;">${esc(title)}</span>`;
  listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#bbb;">로딩 중...</div>';
  try{
    // 이 알림(pushId)에 해당하는 userNotifications 조회 — academyId 필터 필수
    const snap = await getDocs(query(
      collection(db,'userNotifications'),
      where('academyId','==',window.MY_ACADEMY_ID),
      where('pushId','==',pushId),
    ));

    let notifs = snap.docs.map(d=>({id:d.id,...d.data()}));

    if(!notifs.length){
      // pushId 없는 구버전: title 로 fallback (academyId 필터 동반)
      const fbSnap = await getDocs(query(
        collection(db,'userNotifications'),
        where('academyId','==',window.MY_ACADEMY_ID),
        where('title','==',title),
      ));
      notifs = fbSnap.docs.map(d=>({id:d.id,...d.data()}));
    }

    if(!notifs.length){
      listEl.innerHTML='<div style="padding:20px;text-align:center;color:#bbb;font-size:13px;">확인 데이터가 없습니다<br><span style="font-size:11px;">이전 방식으로 발송된 알림입니다</span></div>';
      return;
    }

    // uid 목록으로 학생 이름 조회
    const uids = [...new Set(notifs.map(n=>n.uid))];
    const userSnap = await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID),where('role','==','student')));
    const userMap = {};
    userSnap.docs.forEach(d=>userMap[d.id]={name:d.data().name||'-', group:d.data().group||''});

    const read    = notifs.filter(n=>n.read===true);
    const unread  = notifs.filter(n=>!n.read);
    const readPct = notifs.length ? Math.round(read.length/notifs.length*100) : 0;

    listEl.innerHTML = `
      <!-- 요약 -->
      <div style="display:flex;gap:12px;padding:12px 16px;background:#f8f9fa;border-bottom:1px solid var(--border);font-size:13px;flex-wrap:wrap;">
        <span>총 <b>${notifs.length}</b>명</span>
        <span style="color:#059669;">✅ 읽음 <b>${read.length}</b>명</span>
        <span style="color:#e05050;">🔴 미읽음 <b>${unread.length}</b>명</span>
        <span style="margin-left:auto;font-weight:700;color:var(--teal);">${readPct}%</span>
      </div>
      <!-- 미읽음 먼저 -->
      ${unread.length?`
        <div style="padding:8px 16px 4px;font-size:11px;font-weight:700;color:#e05050;">🔴 미읽음 (${unread.length}명)</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 16px 10px;">
          ${unread.map(n=>`<span style="padding:4px 10px;background:#fee2e2;color:#b91c1c;border-radius:20px;font-size:12px;font-weight:600;">
            ${esc(userMap[n.uid]?.name||n.uid)} <span style="font-size:10px;opacity:.7;">${esc(userMap[n.uid]?.group||'')}</span>
          </span>`).join('')}
        </div>`:''
      }
      <!-- 읽음 -->
      ${read.length?`
        <div style="padding:8px 16px 4px;font-size:11px;font-weight:700;color:#059669;">✅ 읽음 (${read.length}명)</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 16px 10px;">
          ${read.map(n=>`<span style="padding:4px 10px;background:#d1fae5;color:#065f46;border-radius:20px;font-size:12px;">
            ${esc(userMap[n.uid]?.name||n.uid)} <span style="font-size:10px;opacity:.7;">${esc(userMap[n.uid]?.group||'')}</span>
          </span>`).join('')}
        </div>`:''
      }`;
  }catch(e){ listEl.innerHTML=`<div style="padding:16px;color:#e05050;">불러오기 실패: ${e.message}</div>`; }
};
window.reuseMsg = async(id) => {
  const snap=await getDoc(doc(db,'pushNotifications',id));
  const n=snap.data();if(!n)return;
  document.getElementById('msgTitle').value=n.title||'';
  document.getElementById('msgBody').value=n.body||'';
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
    await loadMessages();
  } catch(e) {
    console.error('[delMsg]', e);
    showToast('삭제 실패: ' + (e.message || e.code));
  }
};

// ── 성적 관리 ────────────────────────────────────────
async function initScoreReport(){
  const todayStr = _ymdKST();
  const from = todayStr.slice(0,7) + '-01';
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

function renderScoreReportRows(){
  const el = document.getElementById('scoreReportBody');
  if(!el) return;

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
      <td style="font-size:12px;max-width:100px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${s.bookName||''}">${esc(s.bookName)||'-'}</td>
      <td style="font-size:12px;max-width:160px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${s.testName||''}">${s.testName||'-'}${s._isSpeaking ? ' <span class="badge" style="background:#fef3c7;color:#78350f;font-size:9px;padding:1px 5px;border-radius:8px;font-weight:700;">🎤</span>' : ''}</td>
      <td class="td-center">${s.correct||0}/${s.total||0}</td>
      <td><span class="badge ${sbadge(s.score||0)}">${s.score||0}점</span></td>
      <td class="td-sub">${s._dateTime||s.date||''}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();showScoreDetail('${s.id}','${s.testId||''}')">상세</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="10" style="text-align:center;color:#bbb;padding:20px;">결과가 없습니다</td></tr>';
}

window.searchScoreReport = () => renderScoreReportRows();

window.sortScoreReport = (col) => {
  if(_srSort.col===col){
    _srSort.dir = _srSort.dir==='asc' ? 'desc' : 'asc';
  } else {
    _srSort = {col, dir:'asc'};
  }
  renderScoreReportRows();
};

window.loadScoreReport = async() => {
  const el=document.getElementById('scoreReportBody');
  el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#bbb;padding:20px;">로딩 중...</td></tr>';
  try{
    const snap=await getDocs(query(collection(db,'scores'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','desc')));
    const scores=snap.docs.map(d=>({id:d.id,...d.data()}));
    const from=document.getElementById('scoreFrom').value;
    const to=document.getElementById('scoreTo').value;
    const cls=document.getElementById('scoreClassFilter').value;
    const modeFilter=document.getElementById('scoreModeFilter').value;

    // mode 필터 — 마이그레이션 완료 후 mode 만 사용 (testMode 폴백 제거 2026-05-02)
    const filtered=scores.filter(s=>{
      const d=s.date||'';
      const m = s.mode || '';
      if (modeFilter && m !== modeFilter) return false;
      return(!from||d>=from)&&(!to||d<=to)&&(!cls||s.group===cls);
    });
    if(!filtered.length){
      el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#bbb;padding:20px;">결과가 없습니다</td></tr>';
      _srData=[]; return;
    }

    // testId → speaking 여부 맵 (말하기 시험 배지 표시용 — vocab + vocabOptions.format='speaking')
    const speakingMap = {};
    try {
      const gtSnap = await getDocs(query(collection(db,'genTests'),where('academyId','==',window.MY_ACADEMY_ID)));
      gtSnap.docs.forEach(d => {
        const t = d.data();
        if ((t.testMode || 'vocab') === 'vocab' && t.vocabOptions?.format === 'speaking') {
          speakingMap[d.id] = true;
        }
      });
    } catch(e) { console.warn('speaking map fetch:', e.message); }

    // 정렬용 필드 정규화 (레거시 tests fallback 제거 — Phase 6F)
    _srData = filtered.map(s=>{
      const m = s.mode || 'vocab';
      return {
        ...s,
        bookName: s.bookName||s.unitName||'-',
        testName: s.testName||'-',
        mode: m,  // 표준 키 유지 (vocab/fill_blank/mcq/unscramble/recording/subjective)
        score: s.score||0,
        correct: s.correct||0,
        _isSpeaking: !!speakingMap[s.testId],
        _dateTime: s.createdAt?.toDate
          ? s.createdAt.toDate().toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
          : s.date||'',
      };
    });

    _srSort = {col:'date', dir:'desc'};
    renderScoreReportRows();
  }catch(e){el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';}
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
    const isCorrect=user && user.toLowerCase()===target.trim().toLowerCase();
    const bg=isCorrect?'#F0FDF4':'#FEF2F2';
    const border=isCorrect?'#BBF7D0':'#FECACA';
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
          ${!isCorrect?` · <span style="color:#059669;">정답: ${esc(target)}</span>`:''}
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
function _adminRecBuildDetail(recordings){
  if(!Array.isArray(recordings)||!recordings.length) return '';
  return recordings.map((r,i)=>{
    const score=typeof r.score==='number'?r.score:null;
    const pass=score!=null?score>=80:null;
    const isLast = i === recordings.length - 1;
    const bg=pass===true?'#F0FDF4':pass===false?'#FEF2F2':'#f8f9fa';
    const border=pass===true?'#BBF7D0':pass===false?'#FECACA':'#e5e7eb';
    // 필드명: audioUrl (신규) 우선, url (레거시) 폴백
    const audio = r.audioUrl || r.url || '';
    const fb = r.feedback;  // 마지막 회차에만 있음
    return `
      <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:10px 12px;margin-bottom:8px;text-align:left;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <span style="font-size:11px;color:var(--gray);font-weight:700;">${isLast?'최종':'Q'+(i+1)}</span>
          ${score!=null?`<span style="font-size:12px;color:${pass?'#059669':'#dc2626'};font-weight:700;">${score}점</span>`:''}
          ${r.duration?`<span style="font-size:10px;color:var(--gray);">${r.duration}초</span>`:''}
        </div>
        ${r.sentence?`<div style="font-size:12px;color:var(--text);line-height:1.4;margin-bottom:6px;">${esc(r.sentence)}</div>`:''}
        ${audio?`<audio src="${esc(audio)}" controls preload="none" style="width:100%;height:30px;"></audio>`:''}
        ${Array.isArray(r.missedWords)&&r.missedWords.length?`<div style="font-size:11px;color:#dc2626;margin-top:6px;">놓친 단어: ${esc(r.missedWords.join(', '))}</div>`:''}
        ${r.note?`<div style="font-size:11px;color:var(--gray);margin-top:4px;">${esc(r.note)}</div>`:''}
        ${fb ? `
          <details style="margin-top:8px;">
            <summary style="font-size:11px;color:#7C3AED;cursor:pointer;font-weight:700;">🤖 AI 피드백 (3회차 통과)</summary>
            <div style="margin-top:6px;padding:8px 10px;background:#faf5ff;border-radius:6px;font-size:11px;line-height:1.6;">
              ${Array.isArray(fb.missedWords)&&fb.missedWords.length?`<div><strong>생략:</strong> ${fb.missedWords.map(esc).join(', ')}</div>`:''}
              ${Array.isArray(fb.weakPronunciation)&&fb.weakPronunciation.length?`<div style="margin-top:4px;"><strong>발음:</strong> ${fb.weakPronunciation.map(p=>`${esc(p.word||'')} (${esc(p.issue||'')})`).join(' · ')}</div>`:''}
              ${Array.isArray(fb.tips)&&fb.tips.length?`<div style="margin-top:4px;"><strong>팁:</strong> ${fb.tips.map(esc).join(' · ')}</div>`:''}
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
  if(m==='recording')   return _adminRecBuildDetail(comp.recordings);
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

    const bookName = s.bookName || genTest?.bookName || s.unitName || '-';
    const testName = s.testName || genTest?.name || '-';
    const passScore = s.passScore || genTest?.passScore || 80;
    const passed = s.passed || (s.score>=passScore);
    const pct = s.score || 0;
    const badge = pct>=80?'badge-green':pct>=60?'badge-amber':'badge-red';

    // 상세 본문 결정
    // _writeUserCompleted는 최고점 통과 시에만 questions/answers를 저장함
    //   - 미통과(passed=false) → 스냅샷 없음 → '미통과' 안내
    //   - 통과했지만 기존 최고점 이하인 재응시 → 스냅샷 있으나 이번 score와 불일치 → '재응시' 안내
    //   - genTests 자체가 없는 진짜 레거시 → '레거시' 안내
    const hasDetail = comp && (
      (comp.questions && comp.answers) ||
      (mode==='recording' && Array.isArray(comp.recordings) && comp.recordings.length)
    );
    const isThisAttemptBest = hasDetail && comp.score === s.score && (comp.date||'') === (s.date||'');

    let detailHtml;
    if(isThisAttemptBest){
      detailHtml = _adminBuildDetail(mode, comp);
    } else if(!genTest){
      detailHtml = `<div style="text-align:center;padding:24px 12px;color:var(--gray);font-size:12px;line-height:1.6;">
        <div style="font-size:24px;margin-bottom:6px;">📄</div>
        <div style="font-weight:600;color:#888;">레거시 시험 - 상세 답안 정보가 없습니다</div>
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
              </div>
            </div>
            <span class="badge ${badge}" style="font-size:18px;padding:6px 14px;flex-shrink:0;">${pct}점</span>
          </div>
        </div>

        <div style="padding:16px 22px;overflow-y:auto;flex:1;">
          <div style="margin-bottom:16px;">
            <div style="font-weight:700;font-size:13px;margin-bottom:8px;">📋 시험 결과</div>
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
              <div style="background:${passed?'#d1fae5':'#fef9c3'};border-radius:8px;padding:12px 6px;text-align:center;">
                <div style="font-size:14px;font-weight:800;color:${passed?'#059669':'#b45309'};line-height:1.4;">${passed?'✅':'⚠️'}<br>${passed?'통과':'미통과'}</div>
                <div style="font-size:11px;color:var(--gray);margin-top:2px;">기준 ${passScore}점</div>
              </div>
            </div>
          </div>

          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <div style="font-weight:700;font-size:13px;">📝 문제별 상세</div>
              ${dateStr?`<div style="font-size:11px;color:#bbb;">${esc(dateStr)}</div>`:''}
            </div>
            <div style="word-break:break-word;">
              ${detailHtml}
            </div>
          </div>
        </div>

        <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;">
          <button class="btn btn-secondary" onclick="closeModal()">닫기</button>
        </div>
      </div>
    `);
  }catch(e){ showToast('상세 불러오기 실패: '+e.message); }
};
// 학생 목록 캐시 (검색·트리 재렌더 시 재사용)
let _personalStudents = [];
const _personalGroupOpen = new Set();   // 펼쳐진 반 이름들
let _personalSelectedUid = null;

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
    // uid 표준 키 + academyId 필터 (멀티테넌시 rules 통과). 정렬은 클라 측.
    const scoresSnap=await getDocs(query(
      collection(db,'scores'),
      where('uid','==',uid),
      where('academyId','==',window.MY_ACADEMY_ID),
    ));
    const scores=scoresSnap.docs.map(d=>d.data())
      .sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
    const avg=scores.length?Math.round(scores.reduce((s,r)=>s+r.score,0)/scores.length):0;

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

    // 이력 표 (또는 안내문)
    const historyHtml = history.length === 0
      ? `<div style="padding:14px 16px;text-align:center;color:var(--gray);font-size:12px;background:#f8fafc;border-radius:8px;">이전 성장 리포트가 없습니다. [📈 새 리포트 생성] 클릭 시 첫 리포트를 만들어요.</div>`
      : `<table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead style="background:#f8fafc;">
            <tr>
              <th style="text-align:left;padding:8px 10px;font-weight:600;">생성일</th>
              <th style="text-align:right;padding:8px 10px;font-weight:600;">평균</th>
              <th style="text-align:right;padding:8px 10px;font-weight:600;">응시</th>
              <th style="text-align:left;padding:8px 10px;font-weight:600;">요약</th>
              <th style="text-align:center;padding:8px 6px;font-weight:600;width:32px;"></th>
              <th style="text-align:center;padding:8px 6px;font-weight:600;width:32px;"></th>
            </tr>
          </thead>
          <tbody>
          ${history.map(h => {
            const at = h.generatedAt?.toDate?.() ? h.generatedAt.toDate() : new Date();
            const dateStr = at.toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
            const avgScore = h.report?.avgScore ?? '-';
            const totalAtt = h.report?.totalAttempts ?? '-';
            const summary = (h.report?.summary || '').slice(0, 60);
            return `<tr style="cursor:pointer;border-bottom:1px solid #f0f0f0;"
                       onclick="grShowFromList('${esc(h.id)}')"
                       onmouseover="this.style.background='#fef2ec'" onmouseout="this.style.background=''">
              <td class="td-sub" style="padding:8px 10px;">${esc(dateStr)}</td>
              <td style="padding:8px 10px;text-align:right;font-weight:600;">${avgScore}점</td>
              <td style="padding:8px 10px;text-align:right;color:var(--gray);">${totalAtt}회</td>
              <td style="padding:8px 10px;font-size:11px;color:#475569;overflow:hidden;text-overflow:ellipsis;max-width:0;white-space:nowrap;">${esc(summary)}${summary.length >= 60 ? '…' : ''}</td>
              <td style="padding:8px 6px;text-align:center;">👁</td>
              <td style="padding:8px 6px;text-align:center;" onclick="event.stopPropagation();grDeleteReport('${esc(h.id)}','${esc(uid)}')" title="삭제"
                  onmouseover="this.style.color='#dc2626'" onmouseout="this.style.color=''">🗑</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>`;

    detail.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div class="card-title" style="margin:0;">${esc(u.name)} · ${esc(u.group)||'-'}</div>
        <button class="btn btn-primary" style="font-size:12px;padding:6px 12px;" onclick="openGrowthReport('${esc(uid)}')">📈 새 리포트 생성</button>
      </div>

      <div style="margin-bottom:18px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:8px;">📚 이전 성장 리포트${history.length ? ` (${history.length}건)` : ''}</div>
        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;">${historyHtml}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
        <div style="background:#f8f9fa;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:24px;font-weight:800;color:var(--teal);">${scores.length}</div>
          <div style="font-size:12px;color:var(--gray);margin-top:2px;">응시 횟수</div>
        </div>
        <div style="background:#f8f9fa;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:24px;font-weight:800;color:var(--teal);">${avg}점</div>
          <div style="font-size:12px;color:var(--gray);margin-top:2px;">평균 점수</div>
        </div>
        <div style="background:#f8f9fa;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:24px;font-weight:800;color:var(--teal);">${scores.filter(s=>s.score>=80).length}</div>
          <div style="font-size:12px;color:var(--gray);margin-top:2px;">80점 이상</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>No</th><th>유형</th><th>교재명</th><th>시험명</th><th>점수</th><th>정답/전체</th><th>날짜</th></tr></thead>
          <tbody>${scores.map((s,i)=>{
            const modeHtml = _unifiedTypeBadge(s.mode || 'vocab');
            const bookName=s.bookName||s.unitName||'-';
            const testName=s.testName||'-';
            return `<tr>
              <td>${i+1}</td>
              <td>${modeHtml}</td>
              <td class="td-sm">${esc(bookName)}</td>
              <td style="font-size:12px;max-width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${testName}</td>
              <td><span class="badge ${s.score>=80?'badge-green':s.score>=60?'badge-amber':'badge-red'}">${s.score}점</span></td>
              <td>${s.correct||0}/${s.total||0}</td>
              <td class="td-sub">${s.date||''}</td>
            </tr>`;
          }).join('')||'<tr><td colspan="7" style="text-align:center;color:#bbb;padding:12px;">응시 내역이 없습니다</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }catch(e){
    console.error('[loadPersonalScore]', e);
    detail.innerHTML=`<div style="color:#e05050;padding:20px;">불러오기 실패: ${esc(e.message||e.code||'')}</div>`;
  }
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
        <!-- 통계 카드 -->
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
          <div style="font-weight:700;font-size:13px;margin-bottom:6px;">📝 총평</div>
          <div style="font-size:13px;line-height:1.7;color:#333;background:#fefce8;border-left:3px solid #eab308;padding:10px 14px;border-radius:4px;">${esc(r.summary||'')}</div>
        </div>

        <!-- 모드별 점수 -->
        <div style="margin-bottom:18px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:8px;">📊 모드별 점수</div>
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
            <div style="font-weight:700;font-size:13px;margin-bottom:6px;color:#0ea5e9;">💡 추천</div>
            ${list(r.recommendations, '#eff6ff')}
          </div>
        </div>

        <!-- 추세 -->
        <div style="padding:10px 14px;background:#f8fafc;border-radius:6px;font-size:12px;color:#475569;line-height:1.6;">
          <b>추세:</b> ${esc(r.improvementNote||'')}
        </div>

        <div style="font-size:10px;color:#bbb;margin-top:12px;text-align:right;">${reportId ? 'reportId: ' + esc(reportId) : ''}</div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <button class="btn btn-secondary" style="background:#fef2f2;color:#dc2626;border-color:#fecaca;" onclick="grDeleteReport('${esc(currentId||'')}','${esc(uid||'')}',true)">🗑 이 리포트 삭제</button>
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
};
window.closeModal = () => { document.getElementById('modalOverlay').style.display='none'; document.getElementById('modalBox').style.width=''; };
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
  let ok=0;
  const idToken = await currentUser.getIdToken();
  for(const id of ids){
    try{
      await fetch('/api/deleteUser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:id, idToken})});
      ok++;
    }catch(e){console.log('삭제실패:',e);}
  }
  showToast(`✅ ${ok}명 삭제 완료!`); await loadStudents('active');
};
window.deleteSelectedOutStudent = async() => {
  const ids = getCheckedIds('outTableBody');
  if (!ids.length) { showAlert('입력 확인', '삭제할 학생을 선택하세요.'); return; }
  if(!await showConfirm(`선택한 ${ids.length}명을 완전 삭제할까요?`))return;
  let ok=0;
  const idToken = await currentUser.getIdToken();
  for(const id of ids){
    try{
      await fetch('/api/deleteUser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:id, idToken})});
      ok++;
    }catch(e){console.log('삭제실패:',e);}
  }
  showToast(`✅ ${ok}명 삭제 완료!`); await loadStudents('out');
};
window.deleteStudent = async(id, name) => {
  await deleteUserFull(id, name);
  await loadStudents(currentPage==='student-out'?'out':currentPage==='student-pause'?'pause':'active');
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
  for(const id of ids) await deleteDoc(doc(db,'groups',id));
  showToast('삭제됐어요.'); await loadClasses();
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
  showToast('재원처리 완료!'); await loadStudents(status);
};
window.outSelectedStudent = async() => {
  const ids = getCheckedIds('pauseTableBody');
  if (!ids.length) { showAlert('입력 확인', '학생을 선택하세요.'); return; }
  if(!await showConfirm(`선택한 ${ids.length}명을 퇴원처리 할까요?`))return;
  for(const id of ids) await updateDoc(doc(db,'users',id),{status:'out',statusDate:_ymdKST(),'tuitionPlan.active':false});
  // pause → out: active 카운터 변동 없음 (둘 다 비활성). tuitionPlan.active 는 false 유지
  showToast('퇴원처리 완료!'); await loadStudents('pause');
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
  showToast('삭제됐어요.'); await loadNotices();
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
  for(const id of ids) await deleteDoc(doc(db, 'genTests', id));
  showToast('삭제됐어요.'); await loadTestList();
};

// ── 엑셀 등록 (재원생 일괄 등록) ────────────────────
window.downloadSampleExcel = () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['아이디','이름','반','생일','학교','학년','연락처','부모님성함','부모님연락처'],
    ['student01','홍길동','1반','2015-03-15','영남초등학교','5','010-1234-5678','홍아버지','010-9876-5432'],
    ['student02','김철수','2반','2014-07-22','강남초등학교','6','010-2345-6789','',''],
  ]);
  ws['!cols'] = [12,8,6,14,16,6,14,10,14].map(w=>({wch:w}));
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
      const payload = {
        idToken, username, password:'123456', name,
        group:(row[2]||'').toString().trim(),
        birth:(row[3]||'').toString().trim(),
        school:(row[4]||'').toString().trim(),
        grade:(row[5]||'').toString().trim(),
        phone:(row[6]||'').toString().trim(),
        parentName:(row[7]||'').toString().trim(),
        parentPhone:(row[8]||'').toString().trim(),
      };
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
      <div style="font-weight:600;margin-bottom:6px;">📊 등록 결과</div>
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
    return ` <span class="badge" style="background:#fef3c7;color:#78350f;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:700;vertical-align:middle;">🎤 말하기</span>`;
  }
  return '';
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
  const targetSet = _resolveTestTargetUids(t.targets, students);
  return {
    avg,
    attemptedCount: attemptedSet.size,
    passedCount,
    targetCount: targetSet.size,
  };
}

window.loadTestList = async() => {
  const el = document.getElementById('testListBody');
  try{
    // genTests 만 로드 (레거시 tests 컬렉션 조회 제거 — Phase 6F)
    const gSnap = await getDocs(query(collection(db,'genTests'),where('academyId','==',window.MY_ACADEMY_ID),orderBy('createdAt','desc'))).catch(()=>({docs:[]}));
    const genTests = gSnap.docs.map(d=>({id:d.id,_src:'genTests',...d.data()}));

    if(genTests.length===0){
      el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#bbb;padding:20px;">출제된 시험이 없습니다</td></tr>';
      return;
    }

    // scores 전체 로드 후 testId 별로 집계 (tests / genTests 공통)
    const scoresSnap = await getDocs(query(collection(db,'scores'),where('academyId','==',window.MY_ACADEMY_ID)));
    const allScores = scoresSnap.docs.map(d=>d.data());

    // 학생 전체 (대상자 계산용 — 반 타겟을 uid 로 확장하려면 필요)
    if (!Array.isArray(allStudents) || allStudents.length === 0) {
      try {
        const sSnap = await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID), where('role','==','student')));
        allStudents = sSnap.docs.map(d => ({ id:d.id, ...d.data() }));
      } catch(e) { console.warn('학생 로드 실패(대상자 집계 정확도 저하):', e); }
    }

    const attachStats = (t) => {
      const scoresArr = allScores.filter(s => s.testId === t.id);
      const stats = _computeTestStats(t, scoresArr, allStudents);
      return { ...t,
        attemptCount: scoresArr.length, // 제출 횟수 (하위 호환)
        avgScore: stats.avg,
        _passedCount: stats.passedCount,
        _attemptedCount: stats.attemptedCount,
        _targetCount: stats.targetCount,
      };
    };

    // genTests 만 (Phase 6F: 레거시 tests 제거됨)
    const combined = genTests
      .map(attachStats)
      .sort((a,b)=>{
        const at = a.createdAt?.toMillis?.() || 0;
        const bt = b.createdAt?.toMillis?.() || 0;
        return bt - at;
      });

    initPagination('testListBody', combined, (t,i)=>{
      // 독해 시험(genTests) 은 진행상세(토글) 현재 지원하지 않음 (Phase 2 MVP)
      const isGen = t._src === 'genTests';
      const count = isGen ? (t.questionCount||t.questions?.length||0) : (t.count||0);
      const bookName = t.bookName || (isGen ? (t.sourceSetNames?.join(', ')||'-') : '-');
      return `
      <tr style="cursor:pointer;" onclick="tpToggleTestProgress('${t.id}','tl')" id="tl-row-${t.id}">
        <td onclick="event.stopPropagation()"><input type="checkbox" value="${t.id}" data-src="${t._src}"></td>
        <td>${i+1}</td>
        <td class="td-main">${esc(t.name)||'-'}${_testNameSpeakingBadge(t)}</td>
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
    }, 'testPagination', 10, { pageSize: 20 });
  }catch(e){
    console.error(e);
    el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';
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

    let html = `<div style="display:flex;gap:16px;margin-bottom:10px;font-size:12px;flex-wrap:wrap;">
      <span>총 <b>${students.length}</b>명</span>
      <span style="color:#059669;">✅ 완료 <b>${done.length}</b>명</span>
      <span style="color:#b45309;">🔄 응시중 <b>${tried.length}</b>명</span>
      <span style="color:#aaa;">⬜ 미시작 <b>${notYet.length}</b>명</span>
      <span style="color:var(--blue);">통과점수 <b>${t.passScore||80}점</b></span>
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
    let headers, rows;
    if(status==='active'){
      headers = ['No','반','아이디','이름','생일','학교','학년','연락처','부모님성함','부모님연락처','등록일'];
      rows = students.map((u,i)=>[
        i+1, u.group||'', u.username||'', u.name||'', u.birth||'',
        u.school||'', u.grade||'', u.phone||'',
        u.parentName||'', u.parentPhone||'',
        u.createdAt?.toDate?u.createdAt.toDate().toLocaleDateString('ko-KR'):''
      ]);
    } else {
      const dateCol = status==='pause'?'휴원일':'퇴원일';
      headers = ['No','아이디','이름','생일','학교','학년','등록일',dateCol];
      rows = students.map((u,i)=>[
        i+1, u.username||'', u.name||'', u.birth||'',
        u.school||'', u.grade||'',
        u.createdAt?.toDate?u.createdAt.toDate().toLocaleDateString('ko-KR'):'',
        u.statusDate||''
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
  if (!name) { showAlert('입력 확인', '반 이름을 입력하세요.'); return; }
  await updateDoc(doc(db,'groups',id),{name,teacher});
  closeModal(); showToast('✅ 반 정보가 수정됐어요!'); await loadClasses();
};

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
            <input id="euPw" type="password" placeholder="변경 시만 입력" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
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
    await loadStudents(currentPage==='student-pause'?'pause':currentPage==='student-out'?'out':'active');
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
    const defaultDueDay = _billingSettings?.defaultDueDay || 15;
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
  const classSnap = await getDocs(query(collection(db,'groups'),where('academyId','==',window.MY_ACADEMY_ID)));
  const opts = '<option value="all" '+(n.target==='all'?'selected':'')+'>전체</option>'
    + classSnap.docs.map(d=>`<option value="${esc(d.data().name)}" ${n.target===d.data().name?'selected':''}>${esc(d.data().name)}</option>`).join('');
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">공지 수정</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">대상</div>
            <select id="enTarget" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${opts}</select></div>
          <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">제목 *</div>
            <input id="enTitle" type="text" value="${(n.title||'').replace(/"/g,'&quot;')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">내용 *</div>
            <textarea id="enContent" rows="5" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;resize:vertical;outline:none;">${esc(n.content)||''}</textarea></div>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="updateNotice('${id}')">저장</button>
      </div>
    </div>
  `);
};
window.updateNotice = async(id) => {
  const title = document.getElementById('enTitle').value.trim();
  const content = document.getElementById('enContent').value.trim();
  const target = document.getElementById('enTarget').value;
  if (!title||!content) { showAlert('입력 확인', '제목과 내용을 입력하세요.'); return; }
  await updateDoc(doc(db,'notices',id),{title,content,target});
  closeModal(); showToast('✅ 공지가 수정됐어요!'); await loadNotices();
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

window.loadGenerator = async () => {
  _genInitResizer();
  try {
    const [pSnap, cSnap, bSnap] = await Promise.all([
      getDocs(query(collection(db,'genPages'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('serialNumber','asc'))),
      getDocs(query(collection(db,'genChapters'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('order','asc'))),
      getDocs(query(collection(db,'genBooks'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('createdAt','asc'))),
    ]);
    _genPages = pSnap.docs.map(d=>({id:d.id,...d.data()}));
    _genChapters = cSnap.docs.map(d=>({id:d.id,...d.data()}));
    _genBooks = bSnap.docs.map(d=>({id:d.id,...d.data()}));
    _genCheckedPages.clear(); _genCheckedChapters.clear(); _genCheckedBooks.clear();
    _genActiveBook = null; _genActiveChapter = null; _genActivePage = null;
    _genPageCur = 1;
    _genRenderAll();
    _cleanupLoadPresets();  // 프리셋 백그라운드 로드 (에디터 드롭다운 채움)
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
  const t = x => (x?.updatedAt?.toMillis?.() || x?.createdAt?.toMillis?.() || 0);
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
window.genClickBook = (id) => {
  _genActiveBook = _genActiveBook === id ? null : id;
  _genActiveChapter = null;
  _genPageCur = 1;
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

// ── OCR 실행 ──
window.runGenOcr = async () => {
  if (!_genImages.length) { showAlert('입력 확인', '이미지를 먼저 업로드하세요.'); return; }
  const btn = document.getElementById('genOcrBtn');
  const status = document.getElementById('genOcrStatus');
  btn.disabled = true;
  // 미배정(chapterId 없음) Page 수 + 1 부터 넘버링 시작
  let nextSerial = _genPages.filter(p => !p.chapterId).length;
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
      await addDoc(collection(db,'genPages'),{
        title:`Page ${nextSerial}`, serialNumber:nextSerial,
        chapterId:null, chapterName:'', bookId:null, bookName:'',
        text:data.text||'', ocrConfidence:(data.confidence||0)/100,
        ocrProvider:data.provider||'google-vision', imageUrl:'', edited:false,
        createdAt:serverTimestamp(), createdBy:auth.currentUser?.uid||'',
        academyId: window.MY_ACADEMY_ID || 'default',
      });
      saved++;
    } catch(e){ showToast(`[${i+1}] 오류: ${e.message}`); }
  }
  if (status) { status.textContent=`완료! ${saved}개 Page 저장됨`; setTimeout(()=>{ status.textContent=''; },3000); }
  btn.disabled=false;
  _genImages=[]; _genRenderThumbnails();
  await loadGenerator();
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
  const maxSerial=_genPages.reduce((m,p)=>Math.max(m,p.serialNumber||0),0)+1;
  try {
    await addDoc(collection(db,'genPages'),{
      title:title||`Page ${maxSerial}`, serialNumber:maxSerial,
      chapterId:null, chapterName:'', bookId:null, bookName:'',
      text:text||'', ocrConfidence:0, ocrProvider:'', imageUrl:'', edited:true,
      createdAt:serverTimestamp(), createdBy:auth.currentUser?.uid||'',
      academyId: window.MY_ACADEMY_ID || 'default',
    });
    closeModal(); await loadGenerator();
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
    closeModal(); await loadGenerator();
  } catch(e){ showToast('저장 실패: '+e.message); }
};

// 여러 Page 선택 + [수정] → 병합 모달
function _genOpenMergePagesModal() {
  const ids = [..._genCheckedPages];
  const pages = ids.map(id => _genPages.find(p => p.id === id)).filter(Boolean);
  // serialNumber 오름차순 (없으면 끝으로)
  pages.sort((a, b) => (a.serialNumber || 9e9) - (b.serialNumber || 9e9));
  if (pages.length < 2) return;

  // 챕터 일치 검사
  const chapterIds = [...new Set(pages.map(p => p.chapterId || ''))];
  const sameChapter = chapterIds.length === 1 && chapterIds[0];
  const targetChapter = sameChapter ? pages[0] : null;
  const chapterInfo = sameChapter
    ? `같은 챕터 <b>'${esc(targetChapter.chapterName || '-')}'</b> 로 배정`
    : '챕터 다름 (또는 미배정 섞임) → <b>미배정</b> 으로 저장';

  const list = pages.map((p, i) => `
    <li style="margin-bottom:4px;">
      <span style="color:var(--gray);">${i + 1}.</span>
      <b>${esc(p.title || '-')}</b>
      <span style="color:var(--gray);font-size:11px;">${esc((p.text || '').slice(0, 40))}${(p.text || '').length > 40 ? '…' : ''}</span>
    </li>`).join('');

  const defaultTitle = (pages[0].title || 'Page') + ' (병합)';

  showModal(`
    <div style="width:min(640px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">✂ Page 병합</div>
        <div style="margin-top:6px;font-size:13px;color:var(--gray);">선택된 ${pages.length}개 페이지의 본문을 순서대로 합쳐 1개로 만듭니다.</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">병합될 페이지 (이 순서)</div>
        <ol style="font-size:13px;line-height:1.6;padding-left:22px;margin:0 0 14px 0;">${list}</ol>
        <div style="font-size:12px;color:var(--text);margin-bottom:14px;background:#fafafa;border:1px solid var(--border);border-radius:6px;padding:8px 10px;">→ ${chapterInfo}</div>

        <div style="margin-bottom:14px;">
          <div style="font-size:12px;color:var(--gray);margin-bottom:6px;">새 Page 제목 <span style="color:#dc2626;">*</span></div>
          <input id="gnMT" type="text" value="${esc(defaultTitle)}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;">
        </div>

        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;user-select:none;">
          <input id="gnMDel" type="checkbox" checked style="width:16px;height:16px;cursor:pointer;">
          <span>병합 후 원본 ${pages.length}개 삭제 <span style="color:var(--gray);font-size:11px;">(해제 시 원본 보존)</span></span>
        </label>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="genDoMergePages('${ids.join(',')}')">✂ 병합 실행</button>
      </div>
    </div>`);
}

window.genDoMergePages = async (idsCsv) => {
  const ids = idsCsv.split(',').filter(Boolean);
  const newTitle = (document.getElementById('gnMT')?.value || '').trim();
  const deleteOriginals = !!document.getElementById('gnMDel')?.checked;

  if (!newTitle) { showAlert('입력 확인', '새 Page 제목을 입력하세요.'); return; }

  const pages = ids.map(id => _genPages.find(p => p.id === id)).filter(Boolean);
  if (pages.length < 2) { showToast('병합할 페이지가 부족합니다'); return; }
  pages.sort((a, b) => (a.serialNumber || 9e9) - (b.serialNumber || 9e9));

  // 본문 합치기 — 사이에 빈 줄
  const mergedText = pages.map(p => (p.text || '').trim()).filter(Boolean).join('\n\n');

  // 챕터 일치 → 그 챕터 사용, 아니면 미배정
  const chapterIds = [...new Set(pages.map(p => p.chapterId || ''))];
  const sameChapter = chapterIds.length === 1 && chapterIds[0];
  const ch = sameChapter ? pages[0] : null;

  // serialNumber: 미배정 페이지 수 + 1 (OCR 패턴 동일)
  const nextSerial = _genPages.filter(p => !p.chapterId).length + 1;

  try {
    await addDoc(collection(db, 'genPages'), {
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
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || '',
      academyId: window.MY_ACADEMY_ID || 'default',
    });

    if (deleteOriginals) {
      await Promise.all(ids.map(id => deleteDoc(doc(db, 'genPages', id))));
    }

    _genCheckedPages.clear();
    closeModal();
    await loadGenerator();
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
    await updateDoc(doc(db,'genPages',pid),{title,text:text||'',edited:true});
    const page = _genPages.find(p=>p.id===pid);
    if (page) { page.title = title; page.text = text||''; page.edited = true; }
    showToast('저장 완료');
    _genRenderPages();
  } catch(e){ showToast('저장 실패: '+e.message); }
};

window.genDeletePages = async () => {
  if (!_genCheckedPages.size) return;
  const ok=await showConfirm(`Page ${_genCheckedPages.size}개를 삭제하시겠습니까?`,'삭제된 데이터는 복구할 수 없습니다.');
  if (!ok) return;
  try {
    await Promise.all([..._genCheckedPages].map(id=>deleteDoc(doc(db,'genPages',id))));
    _genCheckedPages.clear(); await loadGenerator();
  } catch(e){ showToast('삭제 실패: '+e.message); }
};

window.genExcludePages = async () => {
  if (!_genCheckedPages.size) return;
  try {
    await Promise.all([..._genCheckedPages].map(id=>updateDoc(doc(db,'genPages',id),{chapterId:null,chapterName:'',bookId:null,bookName:''})));
    showToast('미지정 상태로 변경됨'); await loadGenerator();
  } catch(e){ showToast('실패: '+e.message); }
};

window.genMovePages = async () => {
  if (!_genCheckedPages.size) return;
  if (!_genChapters.length) { showAlert('입력 확인', 'Chapter가 없습니다. 먼저 Chapter를 생성하세요.'); return; }
  const chapters = _genRecentSort(_genChapters);
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">&#8594; Chapter 이동</div>
        <div style="font-size:12px;color:var(--gray);margin-top:5px;">${_genCheckedPages.size}개 Page 이동 · 최근 수정순</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;">
          ${chapters.map(c=>`
            <div data-cid="${esc(c.id)}" data-bid="${esc(c.bookId||'')}" data-bname="${esc(c.bookName||'')}" data-cname="${esc(c.name)}" onclick="window.genDoMovePages(this.dataset.cid,this.dataset.bid,this.dataset.bname,this.dataset.cname)" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;transition:.15s;" onmouseover="this.style.background='var(--teal-light)'" onmouseout="this.style.background=''">
              <div style="font-weight:600;font-size:13px;pointer-events:none;">${esc(c.name)}</div>
              <div style="font-size:11px;color:${c.bookId?'var(--gray)':'#bbb'};font-style:${c.bookId?'normal':'italic'};pointer-events:none;">${c.bookId?esc(c.bookName||''):'Book 미지정'}</div>
            </div>`).join('')}
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      </div>
    </div>`);
};
window.genDoMovePages = async (chapterId,bookId,bookName,chapterName) => {
  try {
    const ids=[..._genCheckedPages];
    await Promise.all(ids.map(id=>updateDoc(doc(db,'genPages',id),{chapterId,chapterName,bookId:bookId||null,bookName:bookName||''})));
    closeModal(); _genCheckedPages.clear();
    showToast(`"${chapterName}"으로 이동 완료`);
    await loadGenerator();
  } catch(e){ showToast('실패: '+e.message); }
};

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
    await addDoc(collection(db,'genChapters'),{
      name, bookId:null, bookName:'', order:_genChapters.length+1, pageCount:0,
      createdAt:serverTimestamp(), createdBy:auth.currentUser?.uid||'',
      academyId: window.MY_ACADEMY_ID || 'default',
    });
    closeModal(); await loadGenerator();
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
    await Promise.all(_genPages.filter(p=>p.chapterId===cid).map(p=>updateDoc(doc(db,'genPages',p.id),{chapterName:name})));
    closeModal(); await loadGenerator();
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
    _genCheckedChapters.clear(); await loadGenerator();
  } catch(e){ showToast('삭제 실패: '+e.message); }
};

window.genExcludeChapters = async () => {
  if (!_genCheckedChapters.size) return;
  const ids=[..._genCheckedChapters];
  try {
    await Promise.all(ids.map(id=>updateDoc(doc(db,'genChapters',id),{bookId:null,bookName:'',updatedAt:serverTimestamp()})));
    await Promise.all(_genPages.filter(p=>ids.includes(p.chapterId)).map(p=>updateDoc(doc(db,'genPages',p.id),{bookId:null,bookName:''})));
    showToast('Book에서 제외됨'); await loadGenerator();
  } catch(e){ showToast('실패: '+e.message); }
};

window.genMoveChapters = async () => {
  if (!_genCheckedChapters.size) return;
  if (!_genBooks.length) { showAlert('입력 확인', 'Book이 없습니다. 먼저 Book을 생성하세요.'); return; }
  const books = _genRecentSort(_genBooks);
  showModal(`
    <div style="width:min(560px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">&#8594; Book 이동</div>
        <div style="font-size:12px;color:var(--gray);margin-top:5px;">${_genCheckedChapters.size}개 Chapter 이동 · 최근 수정순</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;">
          ${books.map(b=>`
            <div onclick="genDoMoveChapters('${b.id}','${esc(b.name).replace(/'/g,"&#39;")}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;transition:.15s;" onmouseover="this.style.background='var(--teal-light)'" onmouseout="this.style.background=''">
              <div style="font-weight:600;font-size:13px;">${esc(b.name)}</div>
              <div style="font-size:11px;color:var(--gray);">Chapter ${b.chapterCount||0}개</div>
            </div>`).join('')}
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
      </div>
    </div>`);
};
window.genDoMoveChapters = async (bookId,bookName) => {
  const ids=[..._genCheckedChapters];
  try {
    await Promise.all(ids.map(id=>updateDoc(doc(db,'genChapters',id),{bookId,bookName,updatedAt:serverTimestamp()})));
    await Promise.all(_genPages.filter(p=>ids.includes(p.chapterId)).map(p=>updateDoc(doc(db,'genPages',p.id),{bookId,bookName})));
    closeModal(); _genCheckedChapters.clear();
    showToast(`"${bookName}"으로 이동 완료`);
    await loadGenerator();
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
    await addDoc(collection(db,'genBooks'),{
      name, chapterCount:0, pageCount:0,
      createdAt:serverTimestamp(), createdBy:auth.currentUser?.uid||'',
      academyId: window.MY_ACADEMY_ID || 'default',
    });
    closeModal(); await loadGenerator();
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
    await Promise.all([
      ..._genChapters.filter(c=>c.bookId===bid).map(c=>updateDoc(doc(db,'genChapters',c.id),{bookName:name})),
      ..._genPages.filter(p=>p.bookId===bid).map(p=>updateDoc(doc(db,'genPages',p.id),{bookName:name})),
    ]);
    closeModal(); await loadGenerator();
  } catch(e){ showToast('저장 실패: '+e.message); }
};

window.genDeleteBooks = async () => {
  if (!_genCheckedBooks.size) return;
  const ok=await showConfirm(`Book ${_genCheckedBooks.size}개를 삭제하시겠습니까?`,'삭제 시 소속 Chapter/Page는 미지정 상태로 돌아갑니다.');
  if (!ok) return;
  try {
    const ids=[..._genCheckedBooks];
    await Promise.all([
      ..._genChapters.filter(c=>ids.includes(c.bookId)).map(c=>updateDoc(doc(db,'genChapters',c.id),{bookId:null,bookName:''})),
      ..._genPages.filter(p=>ids.includes(p.bookId)).map(p=>updateDoc(doc(db,'genPages',p.id),{bookId:null,bookName:''})),
      ...ids.map(id=>deleteDoc(doc(db,'genBooks',id))),
    ]);
    _genCheckedBooks.clear(); await loadGenerator();
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
3. 번호, 불릿, 점선, 장식 기호 모두 제거 (예: "1.", "①", "•", "...", ">")
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

// ─── 프리셋 로드 + 최초 시드 ───
async function _cleanupLoadPresets() {
  try {
    const snap = await getDocs(query(collection(db, 'genCleanupPresets'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('order', 'asc')));
    _cleanupPresets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (_cleanupPresets.length === 0) {
      await _cleanupSeedDefaults();
      const snap2 = await getDocs(query(collection(db, 'genCleanupPresets'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('order', 'asc')));
      _cleanupPresets = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
    }
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

async function _cleanupSeedDefaults() {
  const uid = auth.currentUser?.uid || '';
  const defaults = await _getEffectiveCleanupDefaults();
  await Promise.all(defaults.map(p =>
    addDoc(collection(db, 'genCleanupPresets'), {
      ...p,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: uid,
      academyId: window.MY_ACADEMY_ID || 'default',
    })
  ));
}

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
    <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
      <div style="font-size:17px;font-weight:700;line-height:1.3;">✨ AI 정리 결과 비교</div>
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
  showModal(html);
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
    <div style="font-size:32px;margin-bottom:10px;">🤖</div>
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
    <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
      <div style="font-size:17px;font-weight:700;line-height:1.3;">✨ 일괄 AI 정리 결과</div>
      <div style="font-size:12px;color:var(--gray);margin-top:5px;">프리셋: ${esc(presetName)} · 각 페이지별로 적용/건너뜀 선택</div>
    </div>
    <div style="padding:10px 22px 0;overflow-x:auto;white-space:nowrap;border-bottom:1px solid var(--teal-light);">${tabs}</div>
    ${body}
    <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center;justify-content:space-between;">
      ${footerLeft}
      <div style="display:flex;gap:8px;align-items:center;">${footerRight}</div>
    </div>
  </div>`;
  showModal(html);
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
          `<button class="action-btn" onclick="cleanupEditPreset('${esc(p.id)}')">✏️ 편집</button>`,
          isDefaultNamed
            ? `<button class="action-btn" onclick="cleanupResetPreset('${esc(p.id)}')" ${isDirty?'':'disabled style="opacity:.4;"'}>↺ 기본값</button>`
            : '',
          `<button class="action-btn" onclick="cleanupDuplicatePreset('${esc(p.id)}')">⎘ 복제</button>`,
          isDefaultNamed
            ? '' // 기본 프리셋은 삭제 불가 (이름 매칭 기준)
            : `<button class="action-btn danger" onclick="cleanupDeletePreset('${esc(p.id)}')">🗑 삭제</button>`,
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
        <div style="font-size:17px;font-weight:700;line-height:1.3;">⚙ AI 정리 프리셋 관리</div>
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

window.cleanupSavePreset = async (id) => {
  const name = document.getElementById('cleanupEditName')?.value.trim() || '';
  const description = document.getElementById('cleanupEditDesc')?.value.trim() || '';
  const order = parseInt(document.getElementById('cleanupEditOrder')?.value || '0') || 0;
  const prompt = document.getElementById('cleanupEditPrompt')?.value || '';

  if (name.length < 1) { showAlert('입력 확인', '이름을 입력하세요'); return; }
  if (prompt.trim().length < 10) { showAlert('입력 확인', '프롬프트는 최소 10자 이상이어야 합니다'); return; }

  try {
    if (id) {
      await updateDoc(doc(db, 'genCleanupPresets', id), {
        name, description, prompt, order,
        updatedAt: serverTimestamp(),
      });
    } else {
      await addDoc(collection(db, 'genCleanupPresets'), {
        name, description, prompt, order,
        isDefault: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || '',
        academyId: window.MY_ACADEMY_ID || 'default',
      });
    }
    showToast(id ? '수정 완료' : '추가 완료');
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
    await addDoc(collection(db, 'genCleanupPresets'), {
      name: p.name + ' (복제)',
      description: p.description || '',
      prompt: p.prompt || '',
      order: (p.order || 0) + 1,
      isDefault: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || '',
      academyId: window.MY_ACADEMY_ID || 'default',
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
  const globals = await _cleanupGetGlobalDefaultsByName();
  if (globals[p.name]) {
    showAlert('삭제 불가', '기본 프리셋은 삭제할 수 없습니다. 편집해서 사용하시거나 [↺ 기본값] 으로 글로벌 default 와 동기화하세요.');
    return;
  }
  const ok = await showConfirm(`"${p.name}" 프리셋을 삭제하시겠습니까?`, '삭제된 프리셋은 복구할 수 없습니다.');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'genCleanupPresets', id));
    showToast('삭제됨');
    // 활성 프리셋이 삭제되면 에디터 선택 해제
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
let _qsList = [];                       // 문제 세트 목록 (Firestore에서 로드)
let _qsBooks = [];                      // Book 목록 (폴더 이름 표시용, genBooks 에서 로드)
let _qsEditState = null;                // 수정 중인 세트 (Phase: 세트 내용 편집)

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
    label: '내용이해_객관식',
    icon: '📖',
    enabled: true,
    phaseLabel: null,
    noteHint: '본문을 읽고 4지선다로 내용을 확인합니다.',
    options: [
      { key:'count',      label:'문제수',  type:'number', default:5, min:1, max:50 },
      { key:'difficulty', label:'난이도',  type:'select', choices:['하','중','상'], default:'중' },
    ],
  },
  'subjective': {
    label: '해석하기_주관식',
    icon: '✍️',
    enabled: true,
    phaseLabel: null,
    noteHint: '원문 문장을 제시하고 학생이 손으로 한글 해석을 쓰는 시험지를 생성합니다. (학생앱 배정 없음)',
    options: [
      { key:'count',      label:'문제수',  type:'number', default:5, min:1, max:50 },
      { key:'difficulty', label:'난이도',  type:'select', choices:['하','중','상'], default:'중' },
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

window.loadQuizGenerate = async () => {
  // Generator 데이터 부분 fetch — 시험관리(books/chapters만 채움) 등 다른 경로로
  // 일부만 캐시된 상태에서 AI Generator 진입 시 0개로 표시되던 race 수정.
  // 각 컬렉션 비어있을 때만 fetch.
  try {
    const tasks = [];
    if (!_genPages.length) {
      tasks.push(
        getDocs(query(collection(db,'genPages'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('serialNumber','asc')))
          .then(s => { _genPages = s.docs.map(d=>({id:d.id,...d.data()})); })
      );
    }
    if (!_genChapters.length) {
      tasks.push(
        getDocs(query(collection(db,'genChapters'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('order','asc')))
          .then(s => { _genChapters = s.docs.map(d=>({id:d.id,...d.data()})); })
      );
    }
    if (!_genBooks.length) {
      tasks.push(
        getDocs(query(collection(db,'genBooks'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('createdAt','asc')))
          .then(s => { _genBooks = s.docs.map(d=>({id:d.id,...d.data()})); })
      );
    }
    if (tasks.length) await Promise.all(tasks);
  } catch(e) {
    showToast('AI OCR 데이터 로드 실패: '+e.message);
    return;
  }

  _qgSelectedPageIds.clear();
  _qgGenerated = [];
  _qgExcluded.clear();
  // Phase 2.5: 필터 리셋 (유형은 직전 선택 유지)
  _qgActiveBook = null;
  _qgActiveChapter = null;
  _qgRender();
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
          <span style="cursor:pointer;user-select:none;" onclick="qgToggleSort('pages')">📄 Page <span id="qgPageHeaderCount" style="font-size:11px;color:var(--gray);font-weight:400;">${pages.length === allPages.length ? pages.length : `${pages.length}/${allPages.length}`}개</span> <span style="font-size:11px;color:var(--gray);font-weight:400;">· 선택 <span id="qgSelCount" style="color:var(--teal);">${_qgSelectedPageIds.size}</span>개 · <span id="qgTokenEst"></span></span> <span id="qgPageSortMark" style="font-size:10px;color:var(--gray);font-weight:400;">${_qgSortLabel('pages')}</span></span>
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
            Page 는 최대 20개 동시 작업 가능하며,<br>본문 20자 미만의 Page 는 작업에서 제외됩니다.
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
  let all = (_genPages || []).filter(p => (p.text||'').trim().length >= 20);
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
window.qgSelectBook = (bookId) => {
  const b = (_genBooks||[]).find(x => x.id === bookId);
  if (!b) return;
  if (_qgActiveBook?.id === bookId) {
    _qgActiveBook = null;
    _qgActiveChapter = null;
  } else {
    _qgActiveBook = { id: b.id, name: b.name };
    _qgActiveChapter = null;
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

function _qgUpdateSelCount() {
  const el = document.getElementById('qgSelCount');
  if (el) el.textContent = _qgSelectedPageIds.size;
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

  // 'word' (단어시험) 전용 Wordsnap 입력 섹션 — 통과점수 아래, AI 로 문제 생성 버튼 위
  const wordsnapHtml = (type === 'word') ? _qgBuildWordsnapSection() : '';
  panel.innerHTML = optionsHtml + wordsnapHtml;
  if (type === 'word') setTimeout(() => window._qgWordsnapUpdateStatus?.(), 0);

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
  if (_qgSelectedPageIds.size > 20) {
    const status0 = document.getElementById('qgStatus');
    if (status0) status0.innerHTML = `<span style="color:#c33;">⚠️ Page 수를 20이하로 줄이세요 (현재 ${_qgSelectedPageIds.size}개)</span>`;
    showToast('Page 수를 20이하로 줄이세요');
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
    const res = await _geminiFetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages: selectedPages, count: opts.count, type: 'mcq', difficulty: _qgMapDifficulty(opts.difficulty), customSystemPrompt: _qgGetCustomPrompt('mcq') || undefined }),
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
      body: JSON.stringify({ pages: selectedPages, count: opts.count, type: 'subjective', difficulty: _qgMapDifficulty(opts.difficulty), customSystemPrompt: _qgGetCustomPrompt('subjective') || undefined }),
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
  return `
    <div style="margin-top:14px;padding:12px;border:2px dashed var(--teal);border-radius:8px;background:var(--teal-light);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:6px;">
        <div style="font-size:11px;font-weight:700;color:var(--teal);">📋 Wordsnap · 클립보드 입력</div>
        <button class="btn btn-secondary" onclick="qgWordsnapPaste()"
          style="font-size:10px;padding:2px 8px;flex-shrink:0;">📥 붙여넣기</button>
      </div>
      <div style="font-size:10px;color:var(--gray);margin-bottom:6px;line-height:1.5;">
        각 줄: <code style="background:white;padding:1px 5px;border-radius:3px;font-size:10px;">영단어/숙어<span style="color:#c33;font-weight:700;">[Tab]</span>해석</code>
      </div>
      <textarea id="qgWordsnapInput" rows="5" spellcheck="false"
        oninput="_qgWordsnapUpdateStatus()"
        placeholder="apple&#9;사과&#10;banana&#9;바나나&#10;give up&#9;포기하다"
        style="width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:4px;font-family:'Consolas','Malgun Gothic',monospace;font-size:11px;line-height:1.6;resize:vertical;box-sizing:border-box;"></textarea>
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

  // 활성 Book/Chapter 있으면 sourcePages 로 기록 → 문제세트 목록의 폴더에 표시됨
  const sourcePages = (_qgActiveBook || _qgActiveChapter) ? [{
    pageId: '',
    pageTitle: 'Wordsnap 수동 입력',
    bookId: _qgActiveBook?.id || '',
    chapterId: _qgActiveChapter?.id || '',
  }] : [];

  const btn = document.getElementById('qgWordsnapBtn');
  if (btn) btn.disabled = true;
  try {
    await addDoc(collection(db, 'genQuestionSets'), {
      name: setName,
      academyId: window.MY_ACADEMY_ID || 'default',
      sourceType: 'vocab',
      sourcePages,
      questions,
      questionCount: questions.length,
      aiModel: 'Wordsnap 수동 입력',
      aiGeneratedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || '',
      updatedAt: serverTimestamp(),
    });
    showToast(`✓ "${setName}" 저장됨 (${questions.length}단어)`);
    ta.value = '';
    window._qgWordsnapUpdateStatus();
    setTimeout(() => goPage('quiz-sets'), 400);
  } catch(e) {
    showToast('저장 실패: ' + e.message);
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

    _qgShowResultModal({ ...data, questions: _qgGenerated, defaultName: _qgBuildSetDefaultName('단어시험'), _qgOpts: opts });
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

    _qgShowResultModal({ ...data, questions: _qgGenerated, defaultName: _qgBuildSetDefaultName('언스크램블'), _qgOpts: opts });
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

  const pages = (_genPages || [])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .sort((a, b) => {
      const ao = (a.chapterOrder ?? 0) * 10000 + (a.order ?? 0);
      const bo = (b.chapterOrder ?? 0) * 10000 + (b.order ?? 0);
      return ao - bo;
    });

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
    `실제 책을 보며 연속으로 3회 반복 녹음하세요.`;

  const question = {
    type: 'recording',
    schemaV: 2,
    roundsRequired: 3,
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
          <button onclick="qgDiscardModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--gray);flex-shrink:0;">✕</button>
        </div>
      </div>

      <div style="padding:16px 22px;flex:1;overflow-y:auto;">
        <div id="qgResultList">
          ${_qgGenerated.map((q,i) => _qgRenderQuestion(q,i)).join('')}
        </div>
        <div style="margin-top:16px;padding-top:14px;border-top:1px dashed var(--border);">
          <label style="font-size:12px;color:var(--gray);display:block;margin-bottom:6px;">세트 이름</label>
          <input type="text" id="qgSetName" value="${esc(defaultName)}" placeholder="예: Lesson 3 - 객관식 5문제"
            style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
        </div>
      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="qgDiscardModal()">버리기</button>
        <button class="btn btn-primary" onclick="qgSaveSet()">💾 문제 세트로 저장</button>
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
      <div style="font-size:11px;color:#CA8A04;font-weight:700;margin-bottom:5px;">🎤 Page 단위 녹음숙제 (3회 반복)</div>
      <div style="font-size:12px;color:var(--text);padding:8px 12px;background:#fefce8;border-left:3px solid #CA8A04;margin-bottom:8px;">${esc(q.instructionKo || '')}</div>
      <div style="font-size:13px;line-height:1.6;padding:10px 14px;background:#f5f5f5;border-radius:6px;color:#444;margin-bottom:6px;">${esc(preview)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:11px;">
        <span style="background:#e0f2fe;padding:3px 10px;border-radius:10px;color:#0369a1;font-weight:600;">📄 ${q.pageCount||1} Page</span>
        <span style="background:#fce7f3;padding:3px 10px;border-radius:10px;color:#be185d;font-weight:600;">🎯 ${q.accuracyThreshold||70}점</span>
        <span style="background:#dcfce7;padding:3px 10px;border-radius:10px;color:#166534;font-weight:600;">⏱ ${q.evaluationSeconds||60}초</span>
        <span style="background:#f3e8ff;padding:3px 10px;border-radius:10px;color:#6b21a8;font-weight:600;">🔁 3회 반복</span>
      </div>
    `;
  } else if (q.type === 'recording') {
    body = `
      <div style="font-size:11px;color:#7C3AED;font-weight:700;margin-bottom:5px;">🎤 녹음 대상 문장</div>
      <div style="font-size:14px;line-height:1.7;padding:10px 14px;background:#F5F3FF;border-left:3px solid #8B5CF6;margin-bottom:6px;">${esc(q.sentence)}</div>
      <div style="font-size:12px;color:var(--gray);">${esc(q.questionKo||'')}</div>
    `;
  } else if (q.type === 'vocab') {
    body = `
      <div style="font-size:11px;color:#0ea5e9;font-weight:700;margin-bottom:5px;">📝 단어</div>
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
        <div style="font-size:10px;color:var(--gray);margin-top:4px;">📝 완성: ${esc(chunks.join(' '))}</div>
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
        ${q.explanation?`<div style="font-size:11px;color:#666;margin-top:6px;background:#fff8e1;padding:6px 8px;border-left:2px solid #ffc107;">💡 ${esc(q.explanation)}</div>`:''}
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
  const sourcePages = [...new Set(finalQuestions.map(q => q.sourcePageId))]
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

  try {
    await addDoc(collection(db,'genQuestionSets'), {
      name,
      academyId: window.MY_ACADEMY_ID || 'default',
      sourceType: finalQuestions[0]?.type || 'mcq',
      sourcePages,
      questions: finalQuestions,
      questionCount: finalQuestions.length,
      aiModel: _qgModel || 'unknown',
      aiGeneratedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || '',
      updatedAt: serverTimestamp(),
    });
    showToast(`✓ "${name}" 저장됨 (${finalQuestions.length}문제)`);
    _qgGenerated = [];
    _qgExcluded.clear();
    closeModal();
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
    const [setSnap, bookSnap] = await Promise.all([
      getDocs(query(collection(db,'genQuestionSets'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('createdAt','desc'))),
      getDocs(query(collection(db,'genBooks'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('createdAt','asc'))),
    ]);
    _qsList = setSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    _qsBooks = bookSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    _qsRenderList();
  } catch(e) {
    showToast('세트 목록 로드 실패: '+e.message);
  }
};

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

  if (_qsList.length === 0) {
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
  const recent = _qsSortSets(_qsList.slice(0, _QS_RECENT_LIMIT), _qsSortTop);
  return `
    <div style="padding:10px 14px;border-bottom:1px solid var(--border);background:#f8f9fa;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <span>🕘 최근 생성 <span style="font-weight:400;color:var(--gray);font-size:11px;">(최근 ${_QS_RECENT_LIMIT}개)</span></span>
      <span style="font-size:11px;color:var(--gray);font-weight:400;">총 ${_qsList.length}개</span>
    </div>
    <div style="flex:1;overflow:auto;">
      <table class="data-table" style="width:max-content;table-layout:fixed;font-size:12px;">
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
      </table>
    </div>
  `;
}

// ─── 하단 왼쪽: Book 폴더 리스트 ───
function _qsRenderBookPane() {
  // Book 별 집계
  const bookCounts = new Map();
  _qsList.forEach(s => {
    const bid = _qsPrimaryBookId(s);
    bookCounts.set(bid, (bookCounts.get(bid)||0) + 1);
  });
  // 정렬: 즐겨찾기 먼저 → 이름 순 → 미지정은 맨 마지막
  const items = [...bookCounts.entries()].map(([bid, cnt]) => ({
    id: bid,
    name: _qsBookName(bid),
    count: cnt,
    fav: _qsFavBooks.has(bid),
    isUnassigned: bid === _QS_UNASSIGNED,
  }));
  items.sort((a,b) => {
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
    if (a.fav !== b.fav) return a.fav ? -1 : 1;
    return a.name.localeCompare(b.name, 'ko');
  });

  // "전체" 가상 폴더를 맨 위에
  const totalActive = _qsActiveBookId == null;
  const allRow = `
    <div onclick="qsSelectBook(null)" style="padding:8px 12px;border-bottom:1px solid #f0f0f0;cursor:pointer;background:${totalActive?'var(--teal-light)':''};display:flex;align-items:center;gap:8px;">
      <span style="font-size:14px;">📋</span>
      <div style="flex:1;font-weight:600;font-size:13px;color:${totalActive?'var(--teal)':'var(--text)'};">전체</div>
      <span style="font-size:11px;color:var(--gray);">${_qsList.length}</span>
    </div>`;

  const rows = items.map(it => {
    const active = _qsActiveBookId === it.id;
    return `
    <div onclick="qsSelectBook('${esc(it.id)}')" style="padding:8px 12px;border-bottom:1px solid #f0f0f0;cursor:pointer;background:${active?'var(--teal-light)':''};display:flex;align-items:center;gap:8px;">
      <span onclick="event.stopPropagation();qsToggleFavBook('${esc(it.id)}')" style="cursor:pointer;font-size:14px;color:${it.fav?'#f0b000':'#ccc'};" title="즐겨찾기">${it.fav?'★':'☆'}</span>
      <span style="font-size:14px;">${it.isUnassigned?'📂':'📚'}</span>
      <div style="flex:1;font-weight:${it.fav?700:600};font-size:13px;color:${active?'var(--teal)':'var(--text)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(it.name)}">${esc(it.name)}</div>
      <span style="font-size:11px;color:var(--gray);">${it.count}</span>
    </div>`;
  }).join('');

  return `
    <div style="padding:10px 14px;border-bottom:1px solid var(--border);background:#f8f9fa;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <span>📚 Book 폴더</span>
      <span style="font-size:11px;color:var(--gray);font-weight:400;">${items.length}개</span>
    </div>
    <div style="flex:1;overflow:auto;">
      ${allRow}
      ${rows || '<div style="padding:20px;text-align:center;color:#bbb;font-size:12px;">폴더가 없습니다</div>'}
    </div>
  `;
}

// ─── 하단 오른쪽: 선택된 Book 의 세트 리스트 ───
function _qsRenderSetPane() {
  const filtered = _qsActiveBookId == null
    ? _qsList
    : _qsList.filter(s => _qsPrimaryBookId(s) === _qsActiveBookId);
  const sorted = _qsSortSets(filtered, _qsSortBottom);
  const bookLabel = _qsActiveBookId == null ? '전체' : _qsBookName(_qsActiveBookId);

  return `
    <div style="padding:10px 14px;border-bottom:1px solid var(--border);background:#f8f9fa;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <span>📋 ${esc(bookLabel)} · <span style="font-weight:400;color:var(--gray);font-size:11px;">세트 ${sorted.length}개</span></span>
    </div>
    <div style="flex:1;overflow:auto;">
      <table class="data-table" style="width:max-content;table-layout:fixed;font-size:12px;">
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
      </table>
    </div>
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
      <button class="action-btn danger" onclick="qsDeleteSet('${esc(s.id)}')" style="font-size:11px;padding:3px 8px;">🗑 삭제</button>
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
window.qsSelectBook = (bid) => {
  _qsActiveBookId = bid;
  _qsSavePrefs();
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
          ${s.questions?.length||0}문제 · 유형 <code>${esc(s.sourceType||'-')}</code> · 모델 <code>${esc(s.aiModel||'')}</code>
          ${s.sourcePages?.length ? ' · 출처 '+s.sourcePages.length+'개 Page' : ''}
        </div>
      </div>
      <div style="padding:16px 24px;flex:1;overflow-y:auto;min-height:0;">
        ${(s.questions||[]).map((q, i) => _qsRenderViewCard(q, i)).join('')}
      </div>
      <div style="padding:16px 24px;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:8px;background:white;flex-shrink:0;">
        <button class="btn btn-secondary" onclick="closeModal();qsEditSet('${esc(s.id)}')">✏️ 수정하기</button>
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
  const header = `<div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:6px;">${icon} ${i+1}번 · [${esc(diff)}]${q.sourcePageTitle?` · 출처: ${esc(q.sourcePageTitle)}`:''}</div>`;
  const explanation = q.explanation ? `<div style="font-size:11px;color:#666;margin-top:6px;background:#fff8e1;padding:6px 8px;border-left:2px solid #ffc107;">💡 ${esc(q.explanation)}</div>` : '';

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
        <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:11px;">
          <span style="background:#e0f2fe;padding:3px 10px;border-radius:10px;color:#0369a1;font-weight:600;">📄 ${q.pageCount||1} Page</span>
          <span style="background:#fce7f3;padding:3px 10px;border-radius:10px;color:#be185d;font-weight:600;">🎯 ${q.accuracyThreshold||70}점</span>
          <span style="background:#dcfce7;padding:3px 10px;border-radius:10px;color:#166534;font-weight:600;">⏱ ${q.evaluationSeconds||60}초</span>
          <span style="background:#f3e8ff;padding:3px 10px;border-radius:10px;color:#6b21a8;font-weight:600;">🔁 3회 반복</span>
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
    await loadQuestionSets();
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
    await loadQuestionSets();
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
        <div style="font-size:17px;font-weight:700;">✏️ 문제 세트 수정</div>
        <div style="font-size:11px;color:var(--gray);margin-top:4px;">총 ${st.questions.length}문제 · 유형: ${esc(typeLabel)}</div>
      </div>

      <div style="padding:14px 22px;border-bottom:1px solid var(--border);background:#fafafa;flex-shrink:0;display:grid;grid-template-columns:1fr 280px;gap:12px;align-items:end;">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--gray);">세트 이름</label>
          <input type="text" id="qsEditName" value="${esc(st.name)}"
            style="width:100%;padding:9px 12px;margin-top:5px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--gray);">📚 Book 폴더</label>
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
        <button class="btn btn-primary" onclick="qsSaveEdits()" style="font-weight:700;">💾 저장하기</button>
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
      return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:10px;background:#fafafa;">
        ${header}
        <label style="font-size:11px;color:var(--gray);">지시문 (학생에게 표시)</label>
        <textarea oninput="qsEditUpdate(${idx},'instructionKo',this.value)" rows="3"
          style="width:100%;padding:7px 9px;margin:4px 0 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit;">${esc(q.instructionKo||'')}</textarea>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <div>
            <label style="font-size:11px;color:var(--gray);">정확도 임계값 (점)</label>
            <input type="number" value="${q.accuracyThreshold||70}" min="50" max="95"
              oninput="qsEditUpdate(${idx},'accuracyThreshold',parseInt(this.value)||70)"
              style="width:100%;padding:7px 9px;margin-top:3px;border:1px solid var(--border);border-radius:4px;font-size:13px;">
          </div>
          <div>
            <label style="font-size:11px;color:var(--gray);">평가 구간 (초)</label>
            <input type="number" value="${q.evaluationSeconds||60}" min="30" max="180"
              oninput="qsEditUpdate(${idx},'evaluationSeconds',parseInt(this.value)||60)"
              style="width:100%;padding:7px 9px;margin-top:3px;border:1px solid var(--border);border-radius:4px;font-size:13px;">
          </div>
        </div>
        <label style="font-size:11px;color:var(--gray);">전체 본문 (AI 평가 대상, 수정 신중)</label>
        <textarea oninput="qsEditUpdate(${idx},'fullText',this.value)" rows="4"
          style="width:100%;padding:7px 9px;margin:4px 0 0;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit;">${esc(q.fullText||'')}</textarea>
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

  if (!(await showConfirm('수정사항을 저장할까요?', `${st.questions.length}문제 업데이트`))) return;

  try {
    await updateDoc(doc(db,'genQuestionSets',st.setId), {
      name: newName,
      questions: st.questions,
      questionCount: st.questions.length,
      sourcePages,
      updatedAt: serverTimestamp(),
    });
    showToast(`✓ "${newName}" 저장됨`);
    _qsEditState = null;
    closeModal();
    await loadQuestionSets();
  } catch(e) {
    showToast('저장 실패: ' + e.message);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 내용이해_객관식 시험 배정 (Phase 2)
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
            <div style="font-weight:700;font-size:14px;">📋 문제 세트 선택</div>
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
          <div style="font-weight:700;font-size:13px;margin-bottom:10px;">📝 시험 정보</div>

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
  let students = [];
  try {
    const snap = await getDocs(query(collection(db,'users'),where('academyId','==',window.MY_ACADEMY_ID),where('role','==','student'),where('status','==','active')));
    students = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e) {
    showToast('학생 목록 로드 실패: '+e.message);
    return;
  }

  const groupMap = {};
  students.forEach(u => {
    const g = u.group || '(미지정)';
    if (!groupMap[g]) groupMap[g] = [];
    groupMap[g].push(u);
  });
  Object.keys(groupMap).forEach(g => groupMap[g].sort((a,b)=>(a.name||'').localeCompare(b.name||'','ko')));

  const sortedGroups = Object.keys(groupMap).sort((a,b)=>a.localeCompare(b,'ko'));

  const selClassIds = new Set(_mcqTargets.filter(t=>t.type==='class').map(t=>t.id));
  const selStudentIds = new Set(_mcqTargets.filter(t=>t.type==='student').map(t=>t.id));

  const html = `
    <div style="width:min(640px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">👥 배정 대상 선택</div>
        <div style="font-size:11px;color:var(--gray);margin-top:5px;">반 체크 = 반 전체 · 학생 체크 = 개별 지정 (중복 선택시 우선)</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        ${sortedGroups.map(g => {
          const cls = selClassIds.has(g) ? 'checked' : '';
          return `
            <div style="margin-bottom:10px;border:1px solid var(--border);border-radius:6px;overflow:hidden;">
              <div style="padding:8px 12px;background:#f8f9fa;display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="mcqTpToggleGroup('${esc(g)}')">
                <input type="checkbox" ${cls} onclick="event.stopPropagation();mcqTpToggleGroup('${esc(g)}')">
                <span style="font-weight:600;font-size:13px;">👥 ${esc(g)}</span>
                <span style="font-size:11px;color:var(--gray);margin-left:auto;">${groupMap[g].length}명</span>
              </div>
              <div style="padding:4px 12px 8px;display:flex;flex-wrap:wrap;gap:4px;">
                ${groupMap[g].map(u => {
                  const sc = selStudentIds.has(u.id) ? 'checked' : '';
                  return `<label style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border:1px solid var(--border);border-radius:12px;cursor:pointer;font-size:11px;">
                    <input type="checkbox" ${sc} onchange="mcqTpToggleStudent('${esc(u.id)}','${esc(u.name||'')}','${esc(g)}')">
                    👤 ${esc(u.name||'')}
                  </label>`;
                }).join('')}
              </div>
            </div>`;
        }).join('')}
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">닫기</button>
      </div>
    </div>
  `;
  showModal(html);
};

window.mcqTpToggleGroup = (g) => {
  const exists = _mcqTargets.find(t => t.type==='class' && t.id===g);
  if (exists) {
    _mcqTargets = _mcqTargets.filter(t => !(t.type==='class' && t.id===g));
  } else {
    _mcqTargets.push({ type:'class', id:g, name:g+' 전체', groupName:g });
  }
  mcqOpenTargetPicker();
  _mcqRender();
};

window.mcqTpToggleStudent = (uid, name, group) => {
  const exists = _mcqTargets.find(t => t.type==='student' && t.id===uid);
  if (exists) {
    _mcqTargets = _mcqTargets.filter(t => !(t.type==='student' && t.id===uid));
  } else {
    _mcqTargets.push({ type:'student', id:uid, name, groupName:group });
  }
  _mcqRender();
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

    const docRef = await addDoc(collection(db,'genTests'), {
      name,
      academy: '큰소리영어',
      academyId: window.MY_ACADEMY_ID || 'default',
      date,
      testMode: 'mcq',
      targetType, targetId, targetName,
      targets: [..._mcqTargets],
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
    hint: '교재이해(객관식)를 학생앱에 배정하거나 시험지로 출력합니다.',
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
    hint: 'Page 단위 3회 반복 녹음을 학생앱에 배정합니다. AI 가 정확도를 평가합니다.',
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

let _tpSets = [];                   // 현재 유형의 genQuestionSets
let _tpGenTests = [];               // 현재 유형의 genTests
let _tpSelectedSets = new Set();    // 체크된 세트 ID
let _activeTestType = null;         // 현재 활성 서브메뉴 type
let _activeTestFolderKey = null;    // null = 전체

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

  if (cfg.enabled && cfg.sourceType) {
    try {
      const setSnap = await getDocs(query(collection(db,'genQuestionSets'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('createdAt','desc')));
      _tpSets = setSnap.docs.map(d => ({id:d.id, ...d.data()}))
        .filter(s => (s.sourceType || 'mcq') === cfg.sourceType);

      // actions에 'assign' 이 없으면 genTests 조회 생략 (배정 안 하므로)
      if (!cfg.actions?.includes('assign')) {
        _tpGenTests = [];
      } else {
        const testSnap = await getDocs(query(collection(db,'genTests'),where('academyId','==',window.MY_ACADEMY_ID), orderBy('createdAt','desc')));
        _tpGenTests = testSnap.docs.map(d => ({id:d.id, ...d.data()}))
          .filter(t => t.testMode === cfg.testMode);
      }
    } catch(e) {
      console.error(e);
      _tpSets = [];
      _tpGenTests = [];
      showToast('데이터 로드 실패: '+e.message);
    }
  } else {
    _tpSets = [];
    _tpGenTests = [];
  }

  _tpRender();

  if (cfg.enabled && _tpGenTests.length > 0) _tpLoadTestStats();
}

function _tpRender() {
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  const root = document.getElementById(cfg.rootId);
  if (!root) return;

  // 재렌더 시 스크롤 위치 보존 (체크박스 토글 등)
  const prevScroll = document.getElementById('tpSetsScroll')?.scrollTop || 0;

  const folders = _tpBuildFolders(_tpSets);
  const filteredSets = _activeTestFolderKey
    ? _tpSets.filter(s => _tpFolderKeyOf(s) === _activeTestFolderKey)
    : _tpSets;

  root.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;height:calc(100vh - 180px);min-height:560px;">

      <div id="tpTopRow" style="display:flex;gap:0;flex:1;min-height:0;">

        <div id="tpSetsPane" style="flex:1 1 50%;min-width:200px;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden;">
          <div style="padding:12px 16px;background:#f8f9fa;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:14px;">📚 문제 세트 ${_activeTestFolderKey?'<span style="color:var(--teal);font-size:11px;font-weight:500;">(폴더 필터)</span>':''}</div>
              <div style="font-size:11px;color:var(--gray);">
                선택 <span style="color:var(--teal);font-weight:700;">${_tpSelectedSets.size}</span>개 · 표시 ${filteredSets.length} / ${_tpSets.length}
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
              : (filteredSets.length === 0
                  ? _tpRenderNoSets(cfg)
                  : filteredSets.map(s => _tpRenderSetRow(s)).join('')
                )
            }
          </div>
        </div>

        <div id="tpResizer" title="드래그하여 폭 조정" style="width:8px;cursor:col-resize;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:transparent;">
          <div style="width:2px;height:40px;background:var(--border);border-radius:1px;"></div>
        </div>

        <div id="tpFoldersPane" style="flex:1 1 50%;min-width:200px;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden;">
          <div style="padding:12px 16px;background:#f8f9fa;border-bottom:1px solid var(--border);">
            <div style="font-weight:700;font-size:14px;">📁 폴더</div>
            <div style="font-size:11px;color:var(--gray);">Book · Chapter 별 자동 분류</div>
          </div>
          <div style="flex:1;overflow-y:auto;">
            ${_tpRenderFolderItem({key:null, name:'전체', count:_tpSets.length}, _activeTestFolderKey === null)}
            ${folders.length === 0
              ? '<div style="padding:16px;text-align:center;color:#bbb;font-size:11px;">폴더가 없습니다</div>'
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
          ${cfg.actions?.includes('assign') ? `<button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="_renderTestAssignDetail('${esc(_activeTestType)}')">↻ 새로고침</button>` : ''}
        </div>
        <div style="flex:1;overflow-y:auto;">
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

  // 스크롤 위치 복원 — 체크박스 토글 시 깜빡임 방지
  if (prevScroll > 0) {
    const newEl = document.getElementById('tpSetsScroll');
    if (newEl) newEl.scrollTop = prevScroll;
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

function _tpFolderKeyOf(set) {
  const sp = (set.sourcePages && set.sourcePages[0]) || {};
  return `${sp.bookId||''}::${sp.chapterId||''}`;
}

function _tpBuildFolders(sets) {
  const map = new Map();
  sets.forEach(s => {
    const key = _tpFolderKeyOf(s);
    if (!map.has(key)) {
      const sp = (s.sourcePages && s.sourcePages[0]) || {};
      const book = _genBooks.find(b => b.id === sp.bookId);
      const chap = _genChapters.find(c => c.id === sp.chapterId);
      const bookName = book?.name || (sp.bookId ? '(삭제된 책)' : '(책 없음)');
      const chapName = chap?.name || (sp.chapterId ? '(삭제된 챕터)' : '(챕터 없음)');
      map.set(key, {
        key,
        name: `${bookName} · ${chapName}`,
        bookId: sp.bookId || '',
        chapterId: sp.chapterId || '',
        count: 0,
        lastTime: 0,
      });
    }
    const folder = map.get(key);
    folder.count++;
    const t = s.updatedAt?.toMillis?.() || s.createdAt?.toMillis?.() || 0;
    if (t > folder.lastTime) folder.lastTime = t;
  });
  // 최근 생성/수정된 폴더가 위로 (포함된 세트 중 가장 최신 시각 기준)
  return [...map.values()].sort((a,b) => b.lastTime - a.lastTime);
}

function _tpRenderFolderItem(f, isActive) {
  const bg = isActive ? 'background:var(--teal-light);color:var(--teal);' : '';
  const fontW = isActive ? 'font-weight:700;' : 'font-weight:500;';
  const onclick = f.key === null
    ? `tpSelectFolder(null)`
    : `tpSelectFolder('${esc(f.key)}')`;
  return `
    <div onclick="${onclick}"
      style="padding:10px 14px;border-bottom:1px solid #f5f5f5;cursor:pointer;font-size:12px;${bg}${fontW}display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.key === null ? '📦 전체' : '📁 ' + esc(f.name)}</span>
      <span style="font-size:10px;color:${isActive?'var(--teal)':'var(--gray)'};flex-shrink:0;">${f.count}개</span>
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
        <div style="font-size:13px;margin-bottom:10px;">이 폴더에 해당하는 세트가 없습니다</div>
        <button class="btn btn-secondary" onclick="tpSelectFolder(null)">📦 전체 보기</button>
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
    </table>`;
}

function _tpRenderTestRow(t, i) {
  const qCount = t.questionCount || t.questions?.length || 0;
  const bookName = t.bookName || t.sourceSetNames?.join(', ') || '-';
  const cellBase = 'padding:10px 12px;border-bottom:1px solid #f5f5f5;';
  return `
    <tr style="cursor:pointer;" onclick="tpToggleTestProgress('${esc(t.id)}','tp')" id="tp-row-${t.id}">
      <td style="${cellBase}font-size:12px;color:var(--gray);">${(i||0)+1}</td>
      <td style="${cellBase}font-size:13px;font-weight:600;color:var(--text);">${esc(t.name||'-')}${_testNameSpeakingBadge(t)}</td>
      <td style="${cellBase}font-size:12px;"><span class="badge badge-teal">${esc(_buildTargetName(t.targets) || t.targetName || '-')}</span></td>
      <td style="${cellBase}font-size:12px;color:var(--text);max-width:180px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${esc(bookName)}">${esc(bookName)}</td>
      <td style="${cellBase}text-align:center;font-size:12px;color:var(--text);">${qCount}문제</td>
      <td style="${cellBase}font-size:11px;color:var(--gray);white-space:nowrap;">${_fmtTestDateTime(t)}</td>
      <td style="${cellBase}text-align:center;font-size:11px;white-space:nowrap;" id="tp-attempt-${t.id}"><span style="color:#ccc;">…</span></td>
      <td style="${cellBase}text-align:center;" id="tp-avg-${t.id}"><span style="color:#ccc;">…</span></td>
      <td style="${cellBase}text-align:center;">
        <button onclick="event.stopPropagation();tpDeleteGenTest('${esc(t.id)}')" style="padding:6px 12px;font-size:12px;background:white;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;font-weight:600;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;" title="시험 삭제"><span style="font-size:15px;line-height:1;">🗑</span>삭제</button>
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
    const scoresSnap = await getDocs(query(collection(db,'scores'),where('academyId','==',window.MY_ACADEMY_ID)));
    const allScores = scoresSnap.docs.map(d => d.data());

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

window.tpSelectFolder = (key) => {
  _activeTestFolderKey = key;
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
window.tpExcludeStudent = async (testId, uid, studentName) => {
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
    // 펼침 화면 다시 그리기 — 같은 행 다시 클릭하면 갱신된 상태 표시
    await tpToggleTestProgress(testId);
    await tpToggleTestProgress(testId);
  } catch(e) {
    showAlert('제외 실패', e.message);
  }
};

// 시험(genTests) 단건 삭제 — 하위 userCompleted 도 cascade 삭제. scores 는 보존(이력 가치).
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
  showToast(fail === 0 ? `✓ ${success}개 세트 삭제됨` : `${success}개 삭제 / ${fail}개 실패`);
  await _renderTestAssignDetail(_activeTestType);
};

window.tpOpenPublishModal = async () => {
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  if (!cfg?.enabled) return;
  if (_tpSelectedSets.size === 0) { showAlert('입력 확인', '문제 세트를 선택하세요'); return; }

  const selectedSets = _tpSets.filter(s => _tpSelectedSets.has(s.id));
  const questions = selectedSets.flatMap(s => s.questions || []);
  if (questions.length === 0) { showAlert('입력 확인', '선택된 세트에 문제가 없습니다'); return; }

  let students = [];
  try {
    const snap = await getDocs(query(
      collection(db,'users'),
      where('academyId','==',window.MY_ACADEMY_ID),
      where('role','==','student'),
      where('status','==','active')
    ));
    students = snap.docs.map(d => ({id:d.id, ...d.data()}));
  } catch(e) {
    showToast('학생 목록 로드 실패: '+e.message);
    return;
  }

  const groupMap = {};
  students.forEach(u => {
    const g = u.group || '(미지정)';
    (groupMap[g] = groupMap[g] || []).push(u);
  });
  Object.keys(groupMap).forEach(g =>
    groupMap[g].sort((a,b) => (a.name||'').localeCompare(b.name||'', 'ko'))
  );
  const sortedGroups = Object.keys(groupMap).sort((a,b) => a.localeCompare(b, 'ko'));

  window._tpModalTargets = [];
  // 시험명 기본값: 선택된 세트 이름 (1개면 그대로, 여러 개면 "첫이름 외 N")
  const defaultName = selectedSets.length === 1
    ? (selectedSets[0].name || `${cfg.kindLabel} 시험`)
    : `${selectedSets[0]?.name || cfg.kindLabel} 외 ${selectedSets.length - 1}`;

  const html = `
    <div style="width:min(640px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;">📝 시험출제</div>
        <div style="font-size:11px;color:var(--gray);margin-top:4px;">
          ${esc(cfg.kindLabel)} · ${selectedSets.length}개 세트 · 총 ${questions.length}문제
        </div>
      </div>

      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="margin-bottom:16px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:8px;">📋 시험 정보</div>
          <div style="display:grid;grid-template-columns:1fr 100px 110px 140px;gap:8px;">
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--gray);">시험명 *</label>
              <input type="text" id="tpName" value="${esc(defaultName)}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:3px;">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--gray);">통과점수</label>
              <input type="number" id="tpPassScore" value="80" min="0" max="100" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:3px;">
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
              const curThPct = Math.round((q0.accuracyThreshold ?? 0.4) * (q0.accuracyThreshold > 1 ? 1 : 100));
              return `<div style="margin-bottom:14px;padding:10px 12px;background:#fff8e1;border-radius:6px;border:1px solid #ffc107;">
              <div style="font-size:11px;font-weight:700;color:#8a6d1c;margin-bottom:8px;">🎤 녹음숙제 옵션 (시험별 조정)</div>
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
                    value="${q0.minDurationSec ?? 60}"
                    style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;">
                </div>
                <div>
                  <label style="font-size:11px;font-weight:600;color:var(--gray);">최대 시간(초)</label>
                  <input type="number" id="tpRecMaxDur" min="60" max="1800" step="60"
                    value="${q0.maxDurationSec ?? 600}"
                    style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;">
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div>
                  <label style="font-size:11px;font-weight:600;color:var(--gray);">평가구간</label>
                  <select id="tpRecEvalSec" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;background:white;">
                    ${[0,60,90,120,180].map(n => `<option value="${n}"${n === (q0.evaluationSeconds ?? 0) ? ' selected' : ''}>${n === 0 ? '전체 녹음' : '앞 ' + n + '초'}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label style="font-size:11px;font-weight:600;color:var(--gray);">성실도 임계값 (%)</label>
                  <input type="number" id="tpRecThreshold" min="20" max="80" step="5"
                    value="${curThPct}"
                    style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;">
                </div>
              </div>
              <div style="font-size:10px;color:#8a6d1c;margin-top:8px;line-height:1.5;">
                ※ 통과점수(상단)는 AI 가 마지막 녹음을 평가한 점수 기준 — 미달 시 학생이 마지막 라운드만 다시 녹음 가능<br>
                ※ 평가구간 "전체" 가 가장 정확하지만 토큰 비용 높음 (5분 녹음 vs 60초)
              </div>
            </div>`;
            })()
          : ''}

        ${cfg.testMode === 'vocab'
          ? `<div style="margin-bottom:14px;padding:10px 12px;background:#eff6ff;border-radius:6px;border:1px solid #bfdbfe;">
              <div style="font-size:11px;font-weight:700;color:#1e40af;margin-bottom:8px;">📝 단어시험 풀이 옵션 (학생앱 적용)</div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                <div>
                  <label style="font-size:11px;font-weight:600;color:var(--gray);">형식</label>
                  <select id="tpVocabFormat" onchange="_tpVocabFormatChanged()" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;background:white;">
                    <option value="mixed" selected>혼합</option>
                    <option value="short">주관식(스펠링)</option>
                    <option value="mcq">객관식</option>
                    <option value="speaking">🎤 말하기 (음성 인식)</option>
                  </select>
                </div>
                <div>
                  <label style="font-size:11px;font-weight:600;color:var(--gray);">방향</label>
                  <select id="tpVocabDirection" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;background:white;">
                    <option value="mixed" selected>혼합</option>
                    <option value="en2ko">영→한</option>
                    <option value="ko2en">한→영</option>
                  </select>
                </div>
                <div>
                  <label style="font-size:11px;font-weight:600;color:var(--gray);">객관식 비율 (%)</label>
                  <input type="number" id="tpVocabMcqRatio" value="50" min="0" max="100"
                    style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;">
                  <div style="font-size:10px;color:var(--gray);margin-top:2px;">혼합 형식일 때만 반영</div>
                </div>
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
                <div style="font-size:11px;font-weight:700;color:#78350f;margin-bottom:6px;">🎤 말하기 채점 옵션</div>
                <div style="display:grid;grid-template-columns:1fr;gap:6px;">
                  <div>
                    <label style="font-size:11px;font-weight:600;color:#78350f;">엄격도</label>
                    <select id="tpSpeakingStrictness" style="width:100%;padding:7px 10px;border:1px solid #fcd34d;border-radius:6px;font-size:12px;margin-top:3px;background:white;">
                      <option value="lenient">🟢 너그러움 (오타·비슷한 발음 허용)</option>
                      <option value="normal" selected>🟡 보통 (일반 학습용)</option>
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
          <div id="tpTargetSummary" style="padding:8px 12px;background:#f8f9fa;border-radius:6px;font-size:12px;color:var(--gray);margin-bottom:10px;min-height:32px;display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
            <span>반/학생을 선택하세요</span>
          </div>
          <div style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;">
            ${sortedGroups.map(g => `
              <div style="border-bottom:1px solid #f0f0f0;">
                <div style="padding:8px 12px;background:#f8f9fa;display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="tpModalToggleGroup('${esc(g)}')">
                  <input type="checkbox" id="tp-g-${esc(g)}" onclick="event.stopPropagation();tpModalToggleGroup('${esc(g)}')">
                  <span style="font-weight:600;font-size:13px;">👥 ${esc(g)}</span>
                  <span style="font-size:11px;color:var(--gray);margin-left:auto;">${groupMap[g].length}명</span>
                </div>
                <div style="padding:4px 12px 8px;display:flex;flex-wrap:wrap;gap:4px;">
                  ${groupMap[g].map(u => `
                    <label style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border:1px solid var(--border);border-radius:12px;cursor:pointer;font-size:11px;">
                      <input type="checkbox" id="tp-s-${esc(u.id)}" onchange="tpModalToggleStudent('${esc(u.id)}','${esc(u.name||'')}','${esc(g)}')">
                      👤 ${esc(u.name||'')}
                    </label>`).join('')}
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="tpPublish()" style="font-weight:700;">📤 배정하기</button>
      </div>
    </div>
  `;
  showModal(html);
  _tpUpdateModalSummary();
};

// 단어시험 형식 변경 시 — 말하기 모드 옵션 토글 + 방향·비율 옵션 무력화
window._tpVocabFormatChanged = () => {
  const fmt = document.getElementById('tpVocabFormat')?.value;
  const isSpeaking = fmt === 'speaking';
  const speakOpts = document.getElementById('tpSpeakingOpts');
  const direction = document.getElementById('tpVocabDirection');
  const mcqRatio = document.getElementById('tpVocabMcqRatio');
  if (speakOpts) speakOpts.style.display = isSpeaking ? 'block' : 'none';
  if (direction) {
    direction.disabled = isSpeaking;
    direction.style.opacity = isSpeaking ? '0.4' : '1';
    if (isSpeaking) direction.value = 'ko2en';  // 시각적으로도 ko2en 표시
  }
  if (mcqRatio) {
    mcqRatio.disabled = isSpeaking;
    mcqRatio.style.opacity = isSpeaking ? '0.4' : '1';
  }
};

window.tpModalToggleGroup = (g) => {
  const cb = document.getElementById('tp-g-' + g);
  const exists = window._tpModalTargets.find(t => t.type==='class' && t.id===g);
  if (exists) {
    window._tpModalTargets = window._tpModalTargets.filter(t => !(t.type==='class' && t.id===g));
    if (cb) cb.checked = false;
  } else {
    window._tpModalTargets.push({type:'class', id:g, name:g+' 전체', groupName:g});
    if (cb) cb.checked = true;
  }
  _tpUpdateModalSummary();
};

window.tpModalToggleStudent = (uid, name, group) => {
  const cb = document.getElementById('tp-s-' + uid);
  if (!cb) return;
  if (cb.checked) {
    if (!window._tpModalTargets.find(t => t.type==='student' && t.id===uid)) {
      window._tpModalTargets.push({type:'student', id:uid, name, groupName:group});
    }
  } else {
    window._tpModalTargets = window._tpModalTargets.filter(t => !(t.type==='student' && t.id===uid));
  }
  _tpUpdateModalSummary();
};

function _tpUpdateModalSummary() {
  const el = document.getElementById('tpTargetSummary');
  if (!el) return;
  const ts = window._tpModalTargets || [];
  if (ts.length === 0) {
    el.innerHTML = '<span>반/학생을 선택하세요</span>';
    return;
  }
  const sorted = [...ts].sort((a,b) => (a.name||'').localeCompare(b.name||'', 'ko'));
  el.innerHTML = sorted.map(t =>
    `<span style="background:#f0fafa;border:1px solid var(--teal-light);border-radius:14px;padding:3px 10px;font-size:11px;display:inline-flex;align-items:center;gap:4px;">
      ${t.type==='class'?'👥':'👤'} ${esc(t.name)}
    </span>`
  ).join('');
}

window.tpPublish = async () => {
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  if (!cfg?.enabled) return;

  const name = document.getElementById('tpName')?.value.trim();
  const passScore = parseInt(document.getElementById('tpPassScore')?.value) || 80;
  const date = document.getElementById('tpDate')?.value || _ymdKST();
  const targets = window._tpModalTargets || [];

  if (!name) { showAlert('입력 확인', '시험명을 입력하세요'); document.getElementById('tpName')?.focus(); return; }
  if (targets.length === 0) { showAlert('입력 확인', '배정 대상을 선택하세요'); return; }
  if (_tpSelectedSets.size === 0) { showAlert('입력 확인', '문제 세트가 비어있습니다'); return; }

  const selectedSets = _tpSets.filter(s => _tpSelectedSets.has(s.id));
  let questions = selectedSets.flatMap(s => s.questions || []);
  if (questions.length === 0) { showAlert('입력 확인', '선택된 세트에 문제가 없습니다'); return; }

  // 출제 문제수 — 입력값이 전체보다 작으면 랜덤 셔플 후 N개만 픽
  const poolTotal = questions.length;
  const qcRaw = parseInt(document.getElementById('tpQuestionCount')?.value);
  const desiredCount = isFinite(qcRaw) ? Math.max(1, Math.min(poolTotal, qcRaw)) : poolTotal;
  if (desiredCount < poolTotal) {
    questions = questions.slice().sort(() => Math.random() - 0.5).slice(0, desiredCount);
  }

  // 녹음숙제: 시험 배정 모달에서 5개 옵션 override (시험별·학년별 조정)
  if (cfg.testMode === 'recording' && questions.some(q => q.schemaV === 2)) {
    const recCount = parseInt(document.getElementById('tpRecCount')?.value);
    const minDur = parseInt(document.getElementById('tpRecMinDur')?.value);
    const maxDur = parseInt(document.getElementById('tpRecMaxDur')?.value);
    const evalSec = parseInt(document.getElementById('tpRecEvalSec')?.value);
    const thresholdPct = parseInt(document.getElementById('tpRecThreshold')?.value);

    if (!isNaN(recCount) && recCount >= 1 && recCount <= 4) {
      questions.forEach(q => { if (q.schemaV === 2) q.recordingCount = recCount; });
    }
    if (isFinite(minDur) && minDur >= 10 && minDur <= 300) {
      questions.forEach(q => { if (q.schemaV === 2) q.minDurationSec = minDur; });
    }
    if (isFinite(maxDur) && maxDur >= 60 && maxDur <= 1800) {
      questions.forEach(q => { if (q.schemaV === 2) q.maxDurationSec = maxDur; });
    }
    if (isFinite(evalSec) && [0, 60, 90, 120, 180].includes(evalSec)) {
      questions.forEach(q => { if (q.schemaV === 2) q.evaluationSeconds = evalSec; });
    }
    if (!isNaN(thresholdPct) && thresholdPct >= 20 && thresholdPct <= 80) {
      // 임계값을 0~1 비율로 저장 (학생앱 _rv2PreCheckRecording 와 호환)
      questions.forEach(q => { if (q.schemaV === 2) q.accuracyThreshold = thresholdPct / 100; });
    }
  }

  // Phase 6B: vocab 풀이 옵션 (학생앱에서 매번 적용)
  let vocabOptions = null;
  if (cfg.testMode === 'vocab') {
    const fmt = document.getElementById('tpVocabFormat')?.value || 'mixed';
    vocabOptions = {
      format: fmt,                                                                                    // mixed | short | mcq | speaking
      direction: fmt === 'speaking' ? 'ko2en' : (document.getElementById('tpVocabDirection')?.value || 'mixed'),
      mcqRatio: Math.max(0, Math.min(100, parseInt(document.getElementById('tpVocabMcqRatio')?.value) || 50)),
      shuffleQ: document.getElementById('tpVocabShuffleQ')?.checked !== false,
      shuffleChoices: document.getElementById('tpVocabShuffleChoices')?.checked !== false,
    };
    // 🎤 말하기 모드일 때만 엄격도 저장
    if (fmt === 'speaking') {
      vocabOptions.speakingStrictness = document.getElementById('tpSpeakingStrictness')?.value || 'normal';
    }
  }

  const qcLine = questions.length < poolTotal
    ? `${selectedSets.length}개 세트 · ${questions.length}문제 (전체 ${poolTotal} 중 랜덤)`
    : `${selectedSets.length}개 세트 · ${questions.length}문제`;
  const summary = `${qcLine}\n대상 ${targets.length}명/반\n통과점수 ${passScore}점`;
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
    await addDoc(collection(db,'genTests'), {
      name, academy:'큰소리영어',
      academyId: window.MY_ACADEMY_ID || 'default',
      date,
      testMode: cfg.testMode,
      targetType, targetId, targetName, targets: [...targets],
      active: true,
      questions,
      questionCount: questions.length,
      sourceSetIds: selectedSets.map(s => s.id),
      sourceSetNames: selectedSets.map(s => s.name || ''),
      passScore,
      bookName,
      ...(vocabOptions ? { vocabOptions } : {}),
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || '',
    });

    showToast(`✓ "${name}" 배정 완료 (${questions.length}문제)`);
    window._tpModalTargets = [];
    closeModal();

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
        const wrongs = others.slice().sort(() => Math.random() - 0.5).slice(0, 3);
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
      q._printChunks = chunks.slice().sort(() => Math.random() - 0.5);
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
  s.questions = s.questions.slice().sort(() => Math.random() - 0.5);
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
        q._printSlots = q._printSlots.slice().sort(() => Math.random() - 0.5);
      }
    });
  } else if (s.sourceType === 'mcq') {
    s.questions.forEach(q => {
      if (Array.isArray(q.choices) && q.choices.length >= 2) {
        q.choices = q.choices.slice().sort(() => Math.random() - 0.5);
      }
    });
  } else if (s.sourceType === 'unscramble') {
    s.questions.forEach(q => {
      if (Array.isArray(q._printChunks) && q._printChunks.length >= 2) {
        q._printChunks = q._printChunks.slice().sort(() => Math.random() - 0.5);
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
window.tpToggleTestProgress = async (testId, prefix) => {
  if (prefix) _tpLastPrefix = prefix;
  const p = _tpLastPrefix;
  const prog = document.getElementById(p + '-progress-' + testId);
  if (!prog) return;
  const isOpen = prog.getAttribute('data-open') === '1';

  document.querySelectorAll(`[id^="${p}-progress-"][data-open="1"]`).forEach(r => {
    r.style.display = 'none';
    r.setAttribute('data-open', '0');
  });
  if (isOpen) return;

  prog.style.display = 'table-row';
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
    content.innerHTML = `
      <div style="padding:8px 4px;">
        <div style="font-size:11px;color:var(--gray);margin-bottom:6px;padding:0 8px;">
          응시 ${doneCount} / 총 ${studentList.length} · 미응시 <span style="color:#e65100;font-weight:700;">${studentList.length - doneCount}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(150px,1fr));gap:5px;padding:0 4px;">
          ${studentList.map(s => {
            const c = completed.get(s.uid);
            if (c) {
              // 시험관리 페이지면 _activeTestType, 시험 목록이면 시험 doc 자체의 testMode/mode
              const tMode = (t.testMode || t.mode || '').toLowerCase();
              const recs = c.recordings || [];
              const isRec = tMode === 'recording' && recs.length >= 1 && recs[0]?.audioUrl;
              if (isRec) {
                // 마지막 녹음만 저장됨 (신규 흐름) — 학생 통과 시도만
                const last = recs[recs.length - 1];
                const fb = last?.feedback;
                const passScore = c.passScore || 80;
                const isPassed = last.score >= passScore;
                return `
                  <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;font-size:11px;grid-column:span 2;position:relative;">
                    <button onclick="event.stopPropagation();tpExcludeStudent('${esc(testId)}','${esc(s.uid)}','${esc(s.name||'').replace(/'/g,"&#39;")}')" title="이 학생을 시험에서 제외 (응시 기록 삭제)" style="position:absolute;top:6px;right:6px;width:20px;height:20px;background:rgba(0,0,0,0.05);color:#999;border:none;border-radius:50%;cursor:pointer;font-size:12px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;">✕</button>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-right:24px;">
                      <div style="font-weight:700;color:var(--text);">${esc(s.name||'?')}</div>
                      <span style="color:${isPassed ? '#059669' : '#CA8A04'};font-weight:700;">${last.score}점</span>
                    </div>
                    <audio src="${esc(last.audioUrl)}" controls preload="none" style="width:100%;height:32px;margin-bottom:6px;"></audio>
                    <div style="font-size:10px;color:var(--gray);padding-top:4px;border-top:1px solid #f3f4f6;">
                      ${esc(c.date || '')}${last.duration ? ' · ' + last.duration + '초' : ''} · 마지막 녹음 (총 ${recs.length}회 중)
                    </div>
                    ${fb ? `
                      <details style="margin-top:8px;">
                        <summary style="font-size:10px;color:#7C3AED;cursor:pointer;font-weight:700;">🤖 AI 피드백 (3회차)</summary>
                        <div style="margin-top:6px;padding:8px 10px;background:#faf5ff;border-radius:4px;font-size:10px;line-height:1.6;">
                          ${fb.missedWords?.length ? `<div><strong>생략:</strong> ${fb.missedWords.map(esc).join(', ')}</div>` : ''}
                          ${fb.weakPronunciation?.length ? `<div style="margin-top:3px;"><strong>발음:</strong> ${fb.weakPronunciation.map(p=>`${esc(p.word)} (${esc(p.issue)})`).join(' · ')}</div>` : ''}
                          ${fb.tips?.length ? `<div style="margin-top:3px;"><strong>팁:</strong> ${fb.tips.map(esc).join(' · ')}</div>` : ''}
                        </div>
                      </details>
                    ` : '<div style="font-size:10px;color:var(--gray);margin-top:6px;">마지막 회차가 임계점 미달 → 피드백 없음</div>'}
                  </div>
                `;
              }
              // 일반 시험 (vocab/mcq/fill_blank/unscramble/subjective)
              // _writeUserCompleted 정책: c.score/passed/date 는 최고점 통과 시에만 저장
              // 미통과면 latestScore/latestPassed/latestAt 폴백 사용
              const score = c.score ?? c.latestScore ?? 0;
              const passed = c.passed ?? c.latestPassed ?? false;
              const dateStr = c.date
                || (c.latestAt?.toDate?.() ? _ymdKST(c.latestAt.toDate()) : '');
              const passScore = c.passScore || t.passScore || 80;
              const xBtn = `<button onclick="event.stopPropagation();tpExcludeStudent('${esc(testId)}','${esc(s.uid)}','${esc(s.name||'').replace(/'/g,"&#39;")}')" title="이 학생을 시험에서 제외 (응시 기록 삭제)" style="position:absolute;top:3px;right:4px;width:18px;height:18px;background:rgba(0,0,0,0.05);color:#999;border:none;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;">✕</button>`;
              if (passed) {
                return `<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:6px;padding:5px 22px 5px 9px;font-size:11px;position:relative;">
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
            const xBtn = `<button onclick="event.stopPropagation();tpExcludeStudent('${esc(testId)}','${esc(s.uid)}','${esc(s.name||'').replace(/'/g,"&#39;")}')" title="이 학생을 시험에서 제외" style="position:absolute;top:3px;right:4px;width:18px;height:18px;background:rgba(0,0,0,0.05);color:#999;border:none;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;">✕</button>`;
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
const _qgAiPromptTypes = ['mcq', 'fill_blank', 'subjective', 'recording', 'word', 'unscramble'];
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
    <div style="font-size:10px;color:var(--gray);margin-top:4px;">📝 완성: ${esc(chunks.join(' '))}</div>
  `;
};
const _qgAiPromptDefaults = {};  // API GET 으로 로드 후 캐시
let _qgPromptEditingType = 'mcq';

function _qgGetCustomPrompt(type) {
  try { return localStorage.getItem('ai_prompt_custom_' + type) || ''; }
  catch { return ''; }
}

function _qgSetCustomPrompt(type, value) {
  try {
    if (value && value.trim()) localStorage.setItem('ai_prompt_custom_' + type, value);
    else localStorage.removeItem('ai_prompt_custom_' + type);
  } catch(e) { console.warn(e); }
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
        <div style="font-size:17px;font-weight:700;line-height:1.3;">📋 AI 프롬프트 편집</div>
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
          <button class="btn btn-primary" onclick="qgSavePrompt()">💾 저장</button>
        </div>
      </div>
    </div>
  `;
  showModal(html);
  _qgRenderPromptTabs();
  await _qgLoadPromptIntoTextarea(_qgPromptEditingType);
};

function _qgRenderPromptTabs() {
  const tabs = document.getElementById('qgPromptTabs');
  if (!tabs) return;
  tabs.innerHTML = _qgAiPromptTypes.map(t => {
    const cfg = QG_TYPE_OPTIONS[t] || {};
    const active = t === _qgPromptEditingType;
    const hasCustom = !!_qgGetCustomPrompt(_qgApiTypeOf(t));
    const icon = cfg.icon || '•';
    const label = cfg.label || t;
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
          <button class="btn btn-primary" ${locked ? 'disabled' : ''} onclick="_brandingSave()" style="font-size:13px;font-weight:700;">💾 색상·문구 저장</button>
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
