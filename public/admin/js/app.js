import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc, query, where, orderBy, serverTimestamp, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage, ref, deleteObject, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';


// ── 유틸 ─────────────────────────────────────────────────
function esc(str){return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function showToast(msg){const t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}
function showConfirm(title,sub=''){
  return new Promise(resolve=>{
    document.getElementById('confirmTitle').textContent=title;
    document.getElementById('confirmSub').textContent=sub;
    const modal=document.getElementById('confirmModal');
    modal.style.display='flex';
    const ok=document.getElementById('confirmOk');
    const cancel=document.getElementById('confirmCancel');
    const done=(val)=>{modal.style.display='none';ok.onclick=null;cancel.onclick=null;resolve(val);};
    ok.onclick=()=>done(true);
    cancel.onclick=()=>done(false);
  });
}

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

// ── 인증 체크 ──────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if(!user){ window.location.href='/'; return; }
  const snap = await getDoc(doc(db,'users',user.uid));
  if(!snap.exists() || snap.data().role !== 'admin'){
    window.location.href='/'; return;
  }
  currentUser = user;
  adminProfile = {uid: user.uid, ...snap.data()};
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
  'book-mybook':'My Book', 'book-allbook':'My Book 출력',
  'test-create':'시험 출제', 'test-list':'시험 목록', 'test-print':'시험지 출력',
  'rec-content':'숙제목록 작성', 'rec-assign':'숙제 생성', 'rec-status':'제출 현황',
  'score-report':'성적 리포트', 'score-personal':'개인별 분석',
  message:'메시지 관리', notice:'공지 관리', hwfile:'숙제파일 관리', payment:'결제 관리',
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
  else if(id==='book-mybook') await loadBooks();
  else if(id==='book-allbook') await loadAllBookTree();
  else if(id==='notice') await loadNotices();
  else if(id==='hwfile') await loadHwFileAdmin();
  else if(id==='payment') await loadPayments();
  else if(id==='message') await loadMessages();
  else if(id==='test-list') await loadTestList();
  else if(id==='test-print') loadPrintTestList();
  else if(id==='rec-content') await loadRecContent();
  else if(id==='rec-assign') await loadRecAssign();
  else if(id==='rec-status') await loadRecStatus();
  else if(id==='score-report') initScoreReport();
  else if(id==='score-personal') await loadPersonalStudentList();
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

// ── 대시보드 ──────────────────────────────────────────
async function initDashboard(){
  const now = new Date();
  document.getElementById('dashDate').textContent = now.toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'});
  renderCalendar();
  await Promise.all([loadDashStats(), loadDashNotices(), loadDashScores(), loadDashStudents(), loadDashRecStatus()]);
}
window.refreshDashboard = initDashboard;

async function loadDashStats(){
  try {
    const usersSnap = await getDocs(collection(db,'users'));
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

    const paySnap = await getDocs(query(collection(db,'payments'),where('status','==','unpaid')));
    document.getElementById('statUnpaid').textContent = paySnap.size;

    const today = new Date().toISOString().slice(0,10);
    const testSnap = await getDocs(query(collection(db,'scores'),where('date','==',today)));
    document.getElementById('statTests').textContent = testSnap.size;
  } catch(e){ console.log(e); }
}

async function loadDashNotices(){
  const el=document.getElementById('dashNotices');
  try{
    const snap=await getDocs(query(collection(db,'notices'),orderBy('createdAt','desc'),limit(5)));
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
    const snap=await getDocs(query(collection(db,'scores'),orderBy('createdAt','desc'),limit(20)));
    if(snap.empty){el.innerHTML='<tr><td colspan="7" style="text-align:center;color:#bbb;padding:20px;">시험 결과가 없습니다</td></tr>';return;}

    // testId로 교재명 보완
    const testIds=[...new Set(snap.docs.map(d=>d.data().testId).filter(Boolean))];
    const testMap={};
    await Promise.all(testIds.map(async id=>{
      try{ const d=await getDoc(doc(db,'tests',id)); if(d.exists()) testMap[id]=d.data(); }catch(e){console.warn(e);}
    }));

    el.innerHTML=snap.docs.map((d,i)=>{
      const s=d.data();
      const t=testMap[s.testId]||{};
      const isUnsc = s.testMode==='unscramble'||s.mode==='unscramble'||t.testMode==='unscramble';
      const modeHtml = isUnsc
        ? '<span class="badge" style="background:#fff8e1;color:#b45309;border:1px solid #ffe082;font-size:10px;">🔀 언스크램블</span>'
        : '<span class="badge badge-teal" style="font-size:10px;">📝 단어시험</span>';
      const pct=s.score||0;
      const badge=pct>=80?'badge-green':pct>=60?'badge-amber':'badge-red';
      // 교재명: bookName 우선, 없으면 testMap의 bookName, 없으면 unitName
      const bookName = s.bookName || t.bookName || s.unitName || '-';
      return `<tr>
        <td>${i+1}</td>
        <td>${esc(s.group)||'-'}</td>
        <td style="font-weight:600;">${esc(s.userName)||'-'}</td>
        <td>${modeHtml}</td>
        <td style="font-size:12px;max-width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${esc(bookName)}</td>
        <td><span class="badge ${badge}">${pct}점</span></td>
        <td style="color:var(--gray);font-size:12px;">${s.createdAt?.toDate?s.createdAt.toDate().toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):''}</td>
      </tr>`;
    }).join('');
  }catch(e){el.innerHTML='<tr><td colspan="7" style="text-align:center;color:#bbb;padding:12px;">불러오기 실패</td></tr>';}
}

async function loadDashRecStatus(){
  const el=document.getElementById('dashRecStatus');
  try{
    // 최근 배정된 숙제 5개
    const hwSnap=await getDocs(query(collection(db,'recHw'),orderBy('createdAt','desc'),limit(5)));
    const hws=hwSnap.docs.map(d=>({id:d.id,...d.data()})).filter(hw=>hw.active!==false);
    if(!hws.length){el.innerHTML='<div style="color:#bbb;font-size:13px;text-align:center;padding:12px;">배정된 숙제가 없습니다</div>';return;}

    // 제출 현황 집계
    const subSnap=await getDocs(collection(db,'recSubmissions'));
    const subMap={}; // hwId → Set(uid)
    subSnap.docs.forEach(d=>{
      const s=d.data();
      if(!subMap[s.hwId]) subMap[s.hwId]=new Set();
      subMap[s.hwId].add(s.uid);
    });

    el.innerHTML=hws.map(hw=>{
      const targets=hw.targets||[];
      const totalStudents=targets.reduce((acc,t)=>acc+(t.type==='class'?999:1),0); // 대략적
      const submittedUids=subMap[hw.id]?.size||0;
      const pct=hw.targetCount?Math.round(submittedUids/hw.targetCount*100):null;
      return `<div style="padding:7px 0;border-bottom:1px solid #f5f5f5;font-size:13px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:15px;">🎙</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(hw.title)||'-'}</div>
            <div style="font-size:11px;color:var(--gray);">${esc(hw.targetName)||'-'} · 제출 <b style="color:var(--teal);">${submittedUids}</b>명${hw.dueDate?' · 마감 '+hw.dueDate:''}</div>
          </div>
          <button onclick="goPage('rec-status')" style="background:none;border:none;color:var(--teal);font-size:12px;cursor:pointer;flex-shrink:0;">확인 ›</button>
        </div>
      </div>`;
    }).join('');
  }catch(e){el.innerHTML='<div style="color:#bbb;font-size:13px;">불러오기 실패</div>';}
}

async function loadDashStudents(){
  const el=document.getElementById('dashStudents');
  try{
    const snap=await getDocs(query(collection(db,'users'),where('role','==','student'),where('status','==','active'),limit(8)));
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

async function loadDashBooks(){
  const el=document.getElementById('dashBooks');
  try{
    const snap=await getDocs(query(collection(db,'books'),orderBy('createdAt','desc'),limit(6)));
    if(snap.empty){el.innerHTML='<div style="color:#bbb;font-size:13px;text-align:center;padding:12px;">교재가 없습니다</div>';return;}
    el.innerHTML=snap.docs.map(d=>{
      const b=d.data();
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f5f5f5;font-size:13px;">
        <span style="font-size:16px;">📘</span>
        <div style="flex:1;">
          <div style="font-weight:600;">${esc(b.name)||'-'}</div>
          <div style="font-size:11px;color:var(--gray);">Unit ${b.unitCount||0}개 · 단어 ${b.wordCount||0}개</div>
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
    const snap=await getDocs(query(collection(db,'groups'),orderBy('createdAt','asc')));
    const data=snap.docs.map(d=>({id:d.id,...d.data()}));
    initPagination('classTableBody', data, (g,i)=>`<tr>
      <td><input type="checkbox" value="${g.id}"></td>
      <td>${i+1}</td>
      <td style="font-weight:600;cursor:pointer;color:var(--teal);" onclick="editClass('${g.id}')">${esc(g.name)||'-'}</td>
      <td>${esc(g.teacher)||'-'}</td>
      <td style="text-align:center;">${g.hideApp?'<span class="badge badge-amber">숨김</span>':'-'}</td>
      <td style="text-align:center;">${g.allBooks?'<span class="badge badge-blue">허용</span>':'-'}</td>
      <td style="color:var(--gray);font-size:12px;">${g.createdAt?.toDate?g.createdAt.toDate().toLocaleDateString('ko-KR'):'-'}</td>
    </tr>`, 'classPagination', 7);
  }catch(e){document.getElementById('classTableBody').innerHTML='<tr><td colspan="7" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';}
}

window.openClassModal = () => {
  showModal(`
    <div style="font-size:17px;font-weight:700;margin-bottom:20px;">반 생성</div>
    <div style="display:flex;flex-direction:column;gap:12px;font-size:13px;">
      <div><div style="color:var(--gray);margin-bottom:4px;">반 이름 *</div>
      <input id="className" type="text" placeholder="예: 1반, 초급반" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:4px;">담당 선생님</div>
      <input id="classTeacher" type="text" placeholder="선택사항" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:20px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="saveClass()" style="flex:1;justify-content:center;">저장</button>
    </div>
  `);
};
window.saveClass = async() => {
  const name=document.getElementById('className').value.trim();
  const teacher=document.getElementById('classTeacher').value.trim();
  if(!name){showToast('반 이름을 입력하세요.');return;}
  await addDoc(collection(db,'groups'),{name,teacher,createdAt:serverTimestamp()});
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
    const snap=await getDocs(query(collection(db,'users'),where('role','==','student'),where('status','==',status)));
    allStudents=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderStudentTable(status, allStudents);
    if(status==='active'){
      const classSnap=await getDocs(collection(db,'groups'));
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
      <td style="font-family:monospace;font-size:12px;">${esc(u.username)||'-'}</td>
      <td style="font-weight:600;cursor:pointer;color:var(--teal);" onclick="editStudent('${u.id}')">${esc(u.name)||'-'}</td>
      <td style="font-size:12px;">${esc(u.birth)||'-'}</td>
      <td style="font-size:12px;">${esc(u.school)||'-'}</td>
      <td style="font-size:12px;">${esc(u.grade)||'-'}</td>
      <td><span class="badge ${u.fcmToken?'badge-green':'badge-gray'}">${u.fcmToken?'수신':'미설정'}</span></td>
      <td style="color:var(--gray);font-size:12px;">${u.createdAt?.toDate?u.createdAt.toDate().toLocaleDateString('ko-KR'):'-'}</td>
    </tr>`, pgId, 10);
  } else {
    initPagination(tbodyId, students, (u,i)=>`<tr>
      <td><input type="checkbox" value="${u.id}"></td>
      <td>${i+1}</td>
      <td style="font-family:monospace;font-size:12px;">${esc(u.username)||'-'}</td>
      <td style="font-weight:600;">${esc(u.name)||'-'}</td>
      <td style="font-size:12px;">${esc(u.birth)||'-'}</td>
      <td style="font-size:12px;">${esc(u.school)||'-'}</td>
      <td style="font-size:12px;">${esc(u.grade)||'-'}</td>
      <td style="color:var(--gray);font-size:12px;">${u.createdAt?.toDate?u.createdAt.toDate().toLocaleDateString('ko-KR'):'-'}</td>
      <td style="color:var(--gray);font-size:12px;">${u.statusDate||'-'}</td>
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
window.bulkAction = async(action) => {
  const checked=[...document.querySelectorAll('#studentTableBody input[type=checkbox]:checked')].map(c=>c.value);
  if(!checked.length){showToast('학생을 선택하세요.');return;}
  if(action==='pause'){
    if(!await showConfirm(`선택한 ${checked.length}명을 휴원처리 할까요?`))return;
    for(const id of checked) await updateDoc(doc(db,'users',id),{status:'pause',statusDate:new Date().toISOString().slice(0,10)});
    showToast('휴원처리 완료!'); await loadStudents('active');
  } else if(action==='out'){
    if(!await showConfirm(`선택한 ${checked.length}명을 퇴원처리 할까요?`))return;
    for(const id of checked) await updateDoc(doc(db,'users',id),{status:'out',statusDate:new Date().toISOString().slice(0,10)});
    showToast('퇴원처리 완료!'); await loadStudents('active');
  } else if(action==='assign'){
    const classSnap=await getDocs(collection(db,'groups'));
    const opts=classSnap.docs.map(d=>`<option value="${esc(d.data().name)}">${esc(d.data().name)}</option>`).join('');
    showModal(`
      <div style="font-size:17px;font-weight:700;margin-bottom:16px;">반 배정 (${checked.length}명)</div>
      <select id="assignClass" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;margin-bottom:16px;">${opts}</select>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
        <button class="btn btn-primary" onclick="doAssignClass([${checked.map(id=>`'${id}'`).join(',')}])" style="flex:1;justify-content:center;">배정</button>
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
  await updateDoc(doc(db,'users',id),{status:'active',statusDate:new Date().toISOString().slice(0,10)});
  showToast('재원처리 완료!');
  if(currentPage==='student-pause') await loadStudents('pause');
  else await loadStudents('out');
};
window.deleteStudent = async(id,name) => {
  if(!await showConfirm(`"${name}" 학생을 삭제할까요?`))return;
  await deleteDoc(doc(db,'users',id));
  showToast('삭제됐어요.');
  await loadStudents(currentPage==='student-out'?'out':currentPage==='student-pause'?'pause':'active');
};
window.openStudentModal = async() => {
  const classSnap=await getDocs(collection(db,'groups'));
  const opts=classSnap.docs.map(d=>`<option value="${esc(d.data().name)}">${esc(d.data().name)}</option>`).join('');
  showModal(`
    <div style="font-size:17px;font-weight:700;margin-bottom:20px;">재원생 추가</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">
      <div><div style="color:var(--gray);margin-bottom:3px;">아이디 *</div><input id="sId" type="text" placeholder="영문/숫자" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">이름 *</div><input id="sName" type="text" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">비밀번호 *</div><input id="sPw" type="password" placeholder="6자 이상" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">반</div><select id="sGroup" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${opts}</select></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">생일</div><input id="sBirth" type="date" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">학교</div><input id="sSchool" type="text" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">학년</div><input id="sGrade" type="text" placeholder="예: 5학년" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">연락처</div><input id="sPhone" type="tel" placeholder="010-0000-0000" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">부모님 성함</div><input id="sParentName" type="text" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">부모님 연락처</div><input id="sParentPhone" type="tel" placeholder="010-0000-0000" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:20px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="saveStudent()" style="flex:2;justify-content:center;">저장</button>
    </div>
  `);
};
window.saveStudent = async() => {
  const username=document.getElementById('sId').value.trim();
  const name=document.getElementById('sName').value.trim();
  const pw=document.getElementById('sPw').value;
  const group=document.getElementById('sGroup').value;
  if(!username||!name||!pw){showToast('아이디, 이름, 비밀번호는 필수입니다.');return;}
  if(pw.length<6){showToast('비밀번호는 6자 이상이어야 합니다.');return;}
  const email=username+'@kunsori.app';
  try{
    const {initializeApp:ia}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const {getAuth:ga,createUserWithEmailAndPassword:cu,signOut:so}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    let secApp;try{const {getApp}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');secApp=getApp('sec');}catch(e){secApp=ia({...firebaseConfig},'sec');}
    const a2=ga(secApp);
    const cred=await cu(a2,email,pw);
    await so(a2);
    await setDoc(doc(db,'users',cred.user.uid),{
      username,name,email,group,role:'student',status:'active',
      birth:document.getElementById('sBirth').value,
      school:document.getElementById('sSchool').value.trim(),
      grade:document.getElementById('sGrade').value.trim(),
      phone:document.getElementById('sPhone').value.trim(),
      parentName:document.getElementById('sParentName').value.trim(),
      parentPhone:document.getElementById('sParentPhone').value.trim(),
      createdAt:serverTimestamp()
    });
    closeModal(); showToast('✅ 학생이 추가됐어요!'); await loadStudents('active');
  }catch(e){showToast('추가 실패: '+e.message);}
};

// ── 교재(MyBook) 관리 ────────────────────────────────
window.openMyBookModal = () => {
  document.getElementById('mybookModal').style.display='flex';
  document.getElementById('bookName').value='';
  document.getElementById('pasteData').value='';
  document.getElementById('bookPreview').innerHTML='';
  const msgEl = document.getElementById('splitPreviewMsg');
  if(msgEl) msgEl.textContent='';
  // 저장된 wordsPerUnit 복원
  try{
    const saved = localStorage.getItem('kunsori_wordsPerUnit');
    const el = document.getElementById('wordsPerUnit');
    if(el && saved) el.value = saved;
  }catch(e){console.warn(e);}
};
window.closeMyBookModal = () => { document.getElementById('mybookModal').style.display='none'; };
window.switchBookTab = (tab) => {
  if(tab==='paste'){
    document.getElementById('tabPasteArea').style.display='';
    document.getElementById('tabExcelArea').style.display='none';
    document.getElementById('tabPaste').className='btn btn-primary';
    document.getElementById('tabExcel').className='btn btn-secondary';
  } else {
    document.getElementById('tabPasteArea').style.display='none';
    document.getElementById('tabExcelArea').style.display='';
    document.getElementById('tabPaste').className='btn btn-secondary';
    document.getElementById('tabExcel').className='btn btn-primary';
  }
};
window.loadBookExcel = (e) => {
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=(ev)=>{
    const wb=XLSX.read(ev.target.result,{type:'binary'});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1}).filter(r=>r[0]||r[1]);
    const text=rows.map(r=>(r[0]||'')+'\t'+(r[1]||'')).join('\n');
    document.getElementById('pasteData').value=text;
    switchBookTab('paste');
    previewBookData();
  };
  reader.readAsBinaryString(file);
};
window.removeDuplicates = () => {
  const text=document.getElementById('pasteData').value;
  const lines=text.split('\n').filter(l=>l.trim());
  const seen=new Set();
  const unique=lines.filter(l=>{
    const key=l.split('\t')[0].trim().toLowerCase();
    if(seen.has(key))return false;
    seen.add(key); return true;
  });
  document.getElementById('pasteData').value=unique.join('\n');
  previewBookData();
  showToast(`중복 제거: ${lines.length-unique.length}개 제거됨`);
};
document.getElementById('pasteData').addEventListener('input', previewBookData);
function previewBookData(){
  const text=document.getElementById('pasteData').value;
  const lines=text.split('\n').filter(l=>l.trim());
  const words=lines.map(l=>{ const p=l.split('\t'); return {en:(p[0]||'').trim(),ko:(p[1]||'').trim()}; }).filter(w=>w.en);
  const el=document.getElementById('bookPreview');
  if(!words.length){el.innerHTML='';return;}
  el.innerHTML=`<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:200px;overflow-y:auto;margin-top:8px;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#f8f9fa;"><th style="padding:8px 12px;text-align:left;color:var(--gray);">영어 (${words.length}개)</th><th style="padding:8px 12px;text-align:left;color:var(--gray);">한글</th></tr></thead>
      <tbody>${words.slice(0,50).map(w=>`<tr><td style="padding:6px 12px;border-bottom:1px solid #f5f5f5;">${w.en}</td><td style="padding:6px 12px;border-bottom:1px solid #f5f5f5;color:var(--gray);">${w.ko}</td></tr>`).join('')}
      ${words.length>50?`<tr><td colspan="2" style="padding:8px 12px;text-align:center;color:#bbb;">... 외 ${words.length-50}개</td></tr>`:''}
      </tbody>
    </table>
  </div>`;
}
// Unit 자동분할 토글
window.toggleAutoSplit = () => {
  const on = document.getElementById('autoSplitUnit')?.checked;
  const wrap = document.getElementById('unitSizeWrap');
  if(wrap) wrap.style.opacity = on ? '1' : '0.4';
  updateSplitPreview();
};

// 분할 미리보기 메시지
window.updateSplitPreview = () => {
  const text = document.getElementById('pasteData')?.value || '';
  const lines = text.split('\n').filter(l=>l.trim());
  const words = lines.map(l=>{const p=l.split('\t');return{en:(p[0]||'').trim(),ko:(p[1]||'').trim()};}).filter(w=>w.en);
  const autoSplit = document.getElementById('autoSplitUnit')?.checked;
  const perUnit = parseInt(document.getElementById('wordsPerUnit')?.value)||35;
  const prefix = document.getElementById('unitPrefix')?.value.trim()||'Unit';
  const msgEl = document.getElementById('splitPreviewMsg');
  if(!msgEl) return;
  if(!words.length){ msgEl.textContent=''; return; }
  if(!autoSplit){
    msgEl.innerHTML = `<span style="color:var(--teal);">총 ${words.length}개 단어 → ${prefix} 1개로 저장</span>`;
    return;
  }
  const unitCount = Math.ceil(words.length / perUnit);
  const parts = Array.from({length:unitCount},(_,i)=>{
    const from = i*perUnit+1, to = Math.min((i+1)*perUnit, words.length);
    return `${prefix} ${i+1} (${from}~${to}번, ${to-from+1}개)`;
  });
  msgEl.innerHTML = `<span style="color:var(--teal);font-weight:600;">총 ${words.length}개 → ${unitCount}개 Unit으로 자동 분할</span><br>
    <span style="color:#888;">${parts.join(' / ')}</span>`;
};

window.saveMyBook = async() => {
  const bookName = document.getElementById('bookName').value.trim();
  const unitPrefix = document.getElementById('unitPrefix')?.value.trim() || 'Unit';
  const autoSplit = document.getElementById('autoSplitUnit')?.checked ?? true;
  const wordsPerUnit = parseInt(document.getElementById('wordsPerUnit')?.value)||35;

  if(!bookName){ showToast('교재명을 입력하세요.'); return; }

  // 단어 파싱 (붙여넣기 or 엑셀 미리보기 데이터)
  const text = document.getElementById('pasteData').value;
  const lines = text.split('\n').filter(l=>l.trim());
  const words = lines.map(l=>{
    const p = l.split('\t');
    return { en:(p[0]||'').trim(), ko:(p[1]||'').trim() };
  }).filter(w=>w.en);

  if(!words.length){ showToast('단어를 입력하세요.'); return; }

  // Unit 분할 계산
  let units = [];
  if(autoSplit && words.length > wordsPerUnit){
    const unitCount = Math.ceil(words.length / wordsPerUnit);
    for(let i=0;i<unitCount;i++){
      units.push({
        name: `${unitPrefix} ${i+1}`,
        words: words.slice(i*wordsPerUnit, (i+1)*wordsPerUnit)
      });
    }
  } else {
    // 단일 Unit
    units = [{ name: `${unitPrefix} 1`, words }];
  }

  const btn = document.querySelector('#mybookModal .btn-primary:last-child');
  if(btn){ btn.textContent='저장 중...'; btn.disabled=true; }

  try{
    // books 컬렉션에 교재 생성
    const bookRef = await addDoc(collection(db,'books'),{
      name: bookName,
      unitCount: units.length,
      wordCount: words.length,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });

    // 각 Unit 저장
    for(const u of units){
      await addDoc(collection(db,'books',bookRef.id,'units'),{
        name: u.name,
        words: u.words,
        wordCount: u.words.length,
        createdAt: serverTimestamp()
      });
    }

    closeMyBookModal();
    // 입력 초기화
    document.getElementById('bookName').value='';
    document.getElementById('pasteData').value='';
    document.getElementById('bookPreview').innerHTML='';
    document.getElementById('splitPreviewMsg').textContent='';

    if(units.length > 1){
      showToast(`✅ "${esc(bookName)}" 교재 생성 완료! (${units.length}개 Unit, 총 ${words.length}개 단어)`);
    } else {
      showToast(`✅ "${esc(bookName)}" 교재가 생성됐어요! (단어 ${words.length}개)`);
    }
    await loadBooks();
  }catch(e){
    showToast('저장 실패: '+e.message);
  } finally {
    if(btn){ btn.textContent='✅ 교재 저장'; btn.disabled=false; }
  }
};
async function loadBooks(){
  // 기본: 폴더 미배정 교재만 표시
  await showUnassignedBooks();
  await loadFolders();
}

// 폴더 미배정 교재만 표시
window.showUnassignedBooks = async() => {
  const el = document.getElementById('bookTableBody');
  const label = document.getElementById('bookListLabel');
  if(label) label.textContent = '폴더 미배정';
  window._currentFolderId = null;
  // 선택된 폴더 하이라이트 해제
  document.querySelectorAll('.folder-row').forEach(r=>r.style.background='');
  try{
    const snap = await getDocs(query(collection(db,'books'),orderBy('createdAt','desc')));
    allBooks = snap.docs.map(d=>({id:d.id,...d.data()}));
    // 폴더에 배정되지 않은 교재만
    const unassigned = allBooks.filter(b=>!b.folderId);
    if(!unassigned.length){
      el.innerHTML='<tr><td colspan="6" style="text-align:center;color:#bbb;padding:20px;">폴더 미배정 교재가 없습니다</td></tr>';
      document.getElementById('bookPagination').innerHTML='';
      return;
    }
    initPagination('bookTableBody', unassigned, (b,i)=>`<tr>
      <td><input type="checkbox" value="${b.id}"></td>
      <td>${i+1}</td>
      <td style="font-weight:600;cursor:pointer;color:var(--teal);" onclick="openBookDetail('${b.id}','${b.name.replace(/'/g,"\\'")}')">📘 ${esc(b.name)}</td>
      <td style="text-align:center;">${b.unitCount||0}</td>
      <td style="text-align:center;">${b.wordCount||0}</td>
      <td style="color:var(--gray);font-size:12px;">${b.createdAt?.toDate?b.createdAt.toDate().toLocaleDateString('ko-KR'):'-'}</td>
    </tr>`, 'bookPagination', 6);
  }catch(e){ el.innerHTML='<tr><td colspan="6" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>'; }
};

// 폴더 선택 시 해당 폴더 교재 표시
window.showFolderBooks = async(folderId, folderName) => {
  const el = document.getElementById('bookTableBody');
  const label = document.getElementById('bookListLabel');
  const folderLabel = document.getElementById('folderSelectedLabel');
  if(label) label.textContent = `📁 ${folderName}`;
  if(folderLabel) folderLabel.textContent = `선택됨`;
  window._currentFolderId = folderId;
  // 폴더 하이라이트
  document.querySelectorAll('.folder-row').forEach(r=>r.style.background='');
  const selRow = document.getElementById('folder-row-'+folderId);
  if(selRow) selRow.style.background='#e0f5f5';
  try{
    const snap = await getDocs(query(collection(db,'books'),orderBy('createdAt','desc')));
    allBooks = snap.docs.map(d=>({id:d.id,...d.data()}));
    const folderBooks = allBooks.filter(b=>b.folderId===folderId);
    if(!folderBooks.length){
      el.innerHTML=`<tr><td colspan="6" style="text-align:center;color:#bbb;padding:20px;">"${folderName}" 폴더에 교재가 없습니다</td></tr>`;
      document.getElementById('bookPagination').innerHTML='';
      return;
    }
    initPagination('bookTableBody', folderBooks, (b,i)=>`<tr>
      <td><input type="checkbox" value="${b.id}"></td>
      <td>${i+1}</td>
      <td style="font-weight:600;cursor:pointer;color:var(--teal);" onclick="openBookDetail('${b.id}','${b.name.replace(/'/g,"\\'")}')">📘 ${esc(b.name)}</td>
      <td style="text-align:center;">${b.unitCount||0}</td>
      <td style="text-align:center;">${b.wordCount||0}</td>
      <td style="color:var(--gray);font-size:12px;">${b.createdAt?.toDate?b.createdAt.toDate().toLocaleDateString('ko-KR'):'-'}</td>
    </tr>`, 'bookPagination', 6);
  }catch(e){ el.innerHTML='<tr><td colspan="6" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>'; }
};
window.openBookDetail = async(bookId, bookName) => {
  const unitsSnap=await getDocs(collection(db,'books',bookId,'units'));
  const units=unitsSnap.docs.map(d=>({id:d.id,...d.data()}));
  showModal(`
    <div style="font-size:17px;font-weight:700;margin-bottom:16px;">📘 ${esc(bookName)}</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:12px;">Unit ${units.length}개</div>
    ${units.map(u=>`
      <div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;cursor:pointer;" onclick="viewUnit('${bookId}','${u.id}','${u.name}')">
        <div style="font-weight:600;">${esc(u.name)} <span style="font-size:12px;color:var(--gray);font-weight:400;">단어 ${u.wordCount||u.words?.length||0}개</span></div>
      </div>
    `).join('')}
    <button class="btn btn-secondary" onclick="closeModal()" style="width:100%;justify-content:center;margin-top:8px;">닫기</button>
  `);
};
window.addUnit = (bookId, bookName) => {
  showModal(`
    <div style="font-size:17px;font-weight:700;margin-bottom:20px;">📘 ${esc(bookName)} — Unit 추가</div>
    <div style="margin-bottom:12px;"><div style="font-size:13px;color:var(--gray);margin-bottom:4px;">Unit명 *</div>
    <input id="newUnitN" type="text" placeholder="예: Unit 2, Chapter 2" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;"></div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:4px;">단어 붙여넣기 (영어↔한글 탭 구분)</div>
    <textarea id="newUnitWords" rows="6" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;resize:none;outline:none;font-family:monospace;"></textarea>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="saveUnit('${bookId}')" style="flex:1;justify-content:center;">저장</button>
    </div>
  `);
};
window.saveUnit = async(bookId) => {
  const name=document.getElementById('newUnitN').value.trim();
  const text=document.getElementById('newUnitWords').value;
  if(!name){showToast('Unit명을 입력하세요.');return;}
  const words=text.split('\n').filter(l=>l.trim()).map(l=>{const p=l.split('\t');return{en:(p[0]||'').trim(),ko:(p[1]||'').trim()};}).filter(w=>w.en);
  if(!words.length){showToast('단어를 입력하세요.');return;}
  await addDoc(collection(db,'books',bookId,'units'),{name,words,wordCount:words.length,createdAt:serverTimestamp()});
  const bookSnap=await getDoc(doc(db,'books',bookId));
  const prev=bookSnap.data();
  await updateDoc(doc(db,'books',bookId),{unitCount:(prev.unitCount||0)+1,wordCount:(prev.wordCount||0)+words.length});
  closeModal(); showToast('Unit이 추가됐어요!'); await loadBooks();
};
window.deleteBook = async(id,name) => {
  if(!await showConfirm(`"${name}" 교재를 삭제할까요?`))return;
  await deleteDoc(doc(db,'books',id));
  showToast('삭제됐어요.'); await loadBooks();
};
async function loadFolders(){
  const el = document.getElementById('folderTableBody');
  try{
    const snap = await getDocs(query(collection(db,'folders'),orderBy('createdAt','desc')));
    allFolders = snap.docs.map(d=>({id:d.id,...d.data()}));

    // 폴더별 실제 교재 수 계산
    const booksSnap = await getDocs(collection(db,'books'));
    const folderBookCount = {};
    booksSnap.docs.forEach(d=>{
      const fid = d.data().folderId;
      if(fid) folderBookCount[fid] = (folderBookCount[fid]||0)+1;
    });

    if(!allFolders.length){
      el.innerHTML='<tr><td colspan="5" style="text-align:center;color:#bbb;padding:20px;">폴더가 없습니다</td></tr>';
      return;
    }
    initPagination('folderTableBody', allFolders, (f,i)=>`<tr id="folder-row-${f.id}" class="folder-row"
      onclick="showFolderBooks('${f.id}','${f.name.replace(/'/g,"\\'")}');this.parentElement.querySelectorAll('tr').forEach(r=>r.style.background='');this.style.background='#e0f5f5';"
      style="cursor:pointer;">
      <td onclick="event.stopPropagation();"><input type="checkbox" value="${f.id}" onclick="event.stopPropagation();document.getElementById('folderCheckAll').checked=false;"></td>
      <td>${i+1}</td>
      <td style="font-weight:600;color:var(--teal);">📁 ${esc(f.name)}</td>
      <td style="text-align:center;">${folderBookCount[f.id]||0}</td>
      <td style="color:var(--gray);font-size:12px;">${f.createdAt?.toDate?f.createdAt.toDate().toLocaleDateString('ko-KR'):'-'}</td>
    </tr>`, 'folderPagination', 5);
  }catch(e){ el.innerHTML='<tr><td colspan="5" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>'; }
}

// 폴더에서 교재 제외 (미배정 상태로)
window.excludeFromFolder = async() => {
  const ids = getCheckedIds('bookTableBody');
  if(!ids.length){ showToast('제외할 교재를 선택하세요.'); return; }
  if(!window._currentFolderId){ showToast('먼저 폴더를 선택하세요.'); return; }
  if(!(await showConfirm(`선택한 ${ids.length}개 교재를 폴더에서 제외할까요?\n미배정 상태로 돌아갑니다.`))) return;
  for(const id of ids){
    await updateDoc(doc(db,'books',id),{folderId:null, folderName:null});
  }
  showToast(`✅ ${ids.length}개 교재가 폴더에서 제외됐어요.`);
  // 현재 폴더 다시 로드
  const folderId = window._currentFolderId;
  const folder = allFolders.find(f=>f.id===folderId);
  await loadFolders();
  if(folder) await showFolderBooks(folderId, folder.name);
};
window.openFolderModal = () => {
  showModal(`
    <div style="font-size:17px;font-weight:700;margin-bottom:16px;">폴더 생성</div>
    <input id="folderName" type="text" placeholder="폴더명" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;margin-bottom:16px;">
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="saveFolder()" style="flex:1;justify-content:center;">생성</button>
    </div>
  `);
};
window.saveFolder = async() => {
  const name=document.getElementById('folderName').value.trim();
  if(!name){showToast('폴더명을 입력하세요.');return;}
  await addDoc(collection(db,'folders'),{name,bookCount:0,createdAt:serverTimestamp()});
  closeModal(); showToast('폴더가 생성됐어요!'); await loadFolders();
};
window.deleteFolder = async(id,name) => {
  if(!await showConfirm(`"${name}" 폴더를 삭제할까요?`))return;
  await deleteDoc(doc(db,'folders',id));
  showToast('삭제됐어요.'); await loadFolders();
};

// ── 공지 관리 ────────────────────────────────────────
async function loadNotices(){
  const el=document.getElementById('noticeTableBody');
  try{
    const snap=await getDocs(query(collection(db,'notices'),orderBy('createdAt','desc')));
    if(snap.empty){el.innerHTML='<tr><td colspan="5" style="text-align:center;color:#bbb;padding:20px;">공지가 없습니다</td></tr>';return;}
    el.innerHTML=snap.docs.map((d,i)=>{
      const n=d.data();
      return `<tr>
        <td>${i+1}</td>
        <td style="font-weight:600;cursor:pointer;color:var(--teal);" onclick="editNotice('${d.id}','${(n.title||'').replace(/'/g,'\\\'')}')">${esc(n.title)||'-'}</td>
        <td><span class="badge badge-teal">${n.target==='all'?'전체':esc(n.target)||'-'}</span></td>
        <td style="color:var(--gray);font-size:12px;">${esc(n.date)||''}</td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteNotice('${d.id}')">삭제</button></td>
      </tr>`;
    }).join('');
  }catch(e){el.innerHTML='<tr><td colspan="5" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';}
}
window.openNoticeModal = async() => {
  const classSnap=await getDocs(collection(db,'groups'));
  const opts='<option value="all">전체</option>'+classSnap.docs.map(d=>`<option value="${esc(d.data().name)}">${esc(d.data().name)}</option>`).join('');
  showModal(`
    <div style="font-size:17px;font-weight:700;margin-bottom:20px;">공지 작성</div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div><div style="font-size:13px;color:var(--gray);margin-bottom:4px;">대상</div>
      <select id="noticeTarget" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${opts}</select></div>
      <div><div style="font-size:13px;color:var(--gray);margin-bottom:4px;">제목 *</div>
      <input id="noticeTitle" type="text" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="font-size:13px;color:var(--gray);margin-bottom:4px;">내용 *</div>
      <textarea id="noticeContent" rows="5" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;resize:none;outline:none;"></textarea></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:20px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="saveNotice()" style="flex:1;justify-content:center;">등록</button>
    </div>
  `);
};
window.saveNotice = async() => {
  const title=document.getElementById('noticeTitle').value.trim();
  const content=document.getElementById('noticeContent').value.trim();
  const target=document.getElementById('noticeTarget').value;
  if(!title||!content){showToast('제목과 내용을 입력하세요.');return;}
  await addDoc(collection(db,'notices'),{title,content,target,date:new Date().toISOString().slice(0,10),createdAt:serverTimestamp()});
  closeModal(); showToast('공지가 등록됐어요!'); await loadNotices();
};
window.deleteNotice = async(id) => {
  if(!await showConfirm('공지를 삭제할까요?'))return;
  await deleteDoc(doc(db,'notices',id));
  showToast('삭제됐어요.'); await loadNotices();
};

// ── 숙제파일 관리 ────────────────────────────────────────
async function loadHwFileAdmin(){
  const el = document.getElementById('hwfileTableBody'); if(!el) return;
  try{
    const snap = await getDocs(query(collection(db,'hwFiles'), orderBy('createdAt','desc')));
    const files = snap.docs.map(d=>({id:d.id,...d.data()}));
    const icons={pdf:'📄',docx:'📝',doc:'📝',jpg:'🖼',jpeg:'🖼',png:'🖼',hwp:'📋'};
    initPagination('hwfileTableBody', files, (f,i)=>`<tr>
      <td><input type="checkbox" value="${f.id}"></td>
      <td>${i+1}</td>
      <td style="font-weight:600;">${esc(f.name)||'-'}</td>
      <td><span class="badge badge-teal">${f.group==='전체'?'전체':esc(f.group)||'-'}</span></td>
      <td>${icons[f.type]||'📄'} ${(f.type||'').toUpperCase()}</td>
      <td style="color:var(--gray);font-size:12px;">${f.date||''}</td>
      <td><a href="${f.url||'#'}" target="_blank" class="btn btn-secondary btn-sm">다운로드</a></td>
      <td><button class="btn btn-secondary btn-sm" onclick="editHwFile('${f.id}')">✏️ 수정</button></td>
    </tr>`, 'hwfilePagination', 7);
  }catch(e){ el.innerHTML='<tr><td colspan="8" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>'; }
}

window.editSelectedHwFile = () => {
  const ids = getCheckedIds('hwfileTableBody');
  if(ids.length !== 1){ showToast('수정할 파일을 하나만 선택하세요.'); return; }
  editHwFile(ids[0]);
};

window.editHwFile = async(id) => {
  const snap = await getDoc(doc(db,'hwFiles',id));
  if(!snap.exists()){ showToast('파일 정보를 찾을 수 없습니다.'); return; }
  const f = snap.data();

  // 반/학생 목록 로드
  const usersSnap = await getDocs(query(collection(db,'users'),where('role','==','student'),where('status','==','active')));
  const students = usersSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.name||'').localeCompare(b.name||'','ko'));
  const groups = [...new Set(students.map(u=>u.group).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));

  // 현재 대상값 결정
  let currentTarget = 'all';
  if(f.targetUid) currentTarget = 'uid:'+f.targetUid;
  else if(f.group && f.group !== '전체') currentTarget = 'group:'+f.group;

  showModal(`
    <div style="font-size:16px;font-weight:700;margin-bottom:14px;">✏️ 숙제파일 수정</div>
    <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;">
      <div>
        <div style="color:var(--gray);margin-bottom:4px;">파일명</div>
        <input id="hwfEditName" type="text" value="${(f.name||'').replace(/"/g,'&quot;')}"
          style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;outline:none;">
      </div>
      <div>
        <div style="color:var(--gray);margin-bottom:4px;">대상 선택</div>
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
    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="saveHwFileEdit('${id}')" style="flex:2;justify-content:center;">💾 저장</button>
    </div>`);
  setTimeout(()=>document.getElementById('hwfEditName')?.focus(),100);
};

window.saveHwFileEdit = async(id) => {
  const name = document.getElementById('hwfEditName')?.value.trim();
  const targetVal = document.getElementById('hwfEditTarget')?.value||'all';
  if(!name){ showToast('파일명을 입력하세요.'); return; }

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
  const usersSnap = await getDocs(query(collection(db,'users'),where('role','==','student'),where('status','==','active')));
  const students = usersSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.name||'').localeCompare(b.name||'','ko'));
  const groups = [...new Set(students.map(u=>u.group).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));

  showModal(`
    <div style="font-size:16px;font-weight:700;margin-bottom:14px;">📁 숙제파일 등록</div>
    <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;">
      <div>
        <div style="color:var(--gray);margin-bottom:4px;">파일명 (표시 이름)</div>
        <input id="hwfName" type="text" placeholder="예: 1단원 받아쓰기" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;outline:none;">
      </div>
      <div>
        <div style="color:var(--gray);margin-bottom:4px;">대상 선택</div>
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
        <div style="color:var(--gray);margin-bottom:4px;">파일 선택</div>
        <input type="file" id="hwfFile" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.hwp"
          style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">
      </div>
      <div id="hwfProgress" style="display:none;height:6px;background:#eee;border-radius:10px;overflow:hidden;">
        <div id="hwfProgressBar" style="height:100%;background:var(--teal);width:0%;transition:width .3s;"></div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" id="hwfUploadBtn" onclick="uploadHwFileAdmin()" style="flex:2;justify-content:center;">📤 업로드</button>
    </div>`);
  setTimeout(()=>document.getElementById('hwfName')?.focus(),100);
};

window.uploadHwFileAdmin = async() => {
  const name = document.getElementById('hwfName')?.value.trim();
  const targetVal = document.getElementById('hwfTarget')?.value||'all';
  const fileEl = document.getElementById('hwfFile');
  const file = fileEl?.files[0];
  if(!name){ showToast('파일명을 입력하세요.'); return; }
  if(!file){ showToast('파일을 선택하세요.'); return; }

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
    const today = new Date().toISOString().slice(0,10);

    await addDoc(collection(db,'hwFiles'),{
      name, url, group,
      targetUid: targetUid||null,
      type: ext,
      date: today,
      storagePath: path,
      createdAt: serverTimestamp()
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
  if(!ids.length){ showToast('삭제할 파일을 선택하세요.'); return; }
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

// ── 결제 관리 ────────────────────────────────────────
async function loadPayments(){
  const el=document.getElementById('paymentTableBody');
  try{
    const snap=await getDocs(query(collection(db,'payments'),orderBy('createdAt','desc')));
    const pays=snap.docs.map(d=>({id:d.id,...d.data()}));
    let total=0,paid=0,unpaid=0;
    pays.forEach(p=>{total+=p.amount||0;if(p.status==='paid')paid+=p.amount||0;else unpaid+=p.amount||0;});
    document.getElementById('payTotal').textContent=(total/10000).toFixed(0)+'만원';
    document.getElementById('payPaid').textContent=(paid/10000).toFixed(0)+'만원';
    document.getElementById('payUnpaid').textContent=(unpaid/10000).toFixed(0)+'만원';
    if(!pays.length){el.innerHTML='<tr><td colspan="9" style="text-align:center;color:#bbb;padding:20px;">결제 내역이 없습니다</td></tr>';return;}
    const slabel={paid:'납부완료',unpaid:'미납',pending:'확인중'};
    const sbadge={paid:'badge-green',unpaid:'badge-red',pending:'badge-amber'};
    initPagination('paymentTableBody', pays, (p,i)=>`<tr>
      <td><input type="checkbox" value="${p.id}"></td>
      <td>${i+1}</td>
      <td style="font-weight:600;">${esc(p.userName)||'-'}</td>
      <td>${esc(p.group)||'-'}</td>
      <td>${esc(p.title)||'-'}</td>
      <td style="font-weight:600;">${(p.amount||0).toLocaleString()}원</td>
      <td style="font-size:12px;">${p.due||'-'}</td>
      <td><span class="badge ${sbadge[p.status]||'badge-gray'}">${slabel[p.status]||'미납'}</span></td>
      <td style="color:var(--gray);font-size:12px;">${p.memo||'-'}</td>
    </tr>`, 'paymentPagination', 9);
  }catch(e){el.innerHTML='<tr><td colspan="9" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';}
}
window.updatePayStatus = async(id,status) => {
  await updateDoc(doc(db,'payments',id),{status});
  showToast('상태가 변경됐어요.'); await loadPayments();
};
window.delPayment = async(id) => {
  if(!await showConfirm('삭제할까요?'))return;
  await deleteDoc(doc(db,'payments',id));
  showToast('삭제됐어요.'); await loadPayments();
};
window.openPaymentModal = async() => {
  const usersSnap=await getDocs(query(collection(db,'users'),where('role','==','student'),where('status','==','active')));
  const opts=usersSnap.docs.map(d=>{const u=d.data();return `<option value="${d.id}|${u.name}|${u.group||''}">${u.name} (${esc(u.group)||'-'})</option>`;}).join('');
  showModal(`
    <div style="font-size:17px;font-weight:700;margin-bottom:20px;">결제 등록</div>
    <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;">
      <div><div style="color:var(--gray);margin-bottom:3px;">학생 *</div><select id="payStudent" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${opts}</select></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">항목 *</div><input id="payTitle" type="text" placeholder="예: 4월 수강료" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">금액 *</div><input id="payAmount" type="number" placeholder="150000" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">납부 기한</div><input id="payDue" type="date" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">상태</div><select id="payStatus" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;"><option value="unpaid">미납</option><option value="paid">납부완료</option></select></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:20px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="savePayment()" style="flex:1;justify-content:center;">등록</button>
    </div>
  `);
};
window.savePayment = async() => {
  const sel=document.getElementById('payStudent').value.split('|');
  const uid=sel[0],userName=sel[1],group=sel[2];
  const title=document.getElementById('payTitle').value.trim();
  const amount=parseInt(document.getElementById('payAmount').value)||0;
  const due=document.getElementById('payDue').value;
  const status=document.getElementById('payStatus').value;
  if(!title||!amount){showToast('항목과 금액을 입력하세요.');return;}
  await addDoc(collection(db,'payments'),{uid,userName,group,title,amount,due,status,createdAt:serverTimestamp()});
  closeModal(); showToast('✅ 등록됐어요!'); await loadPayments();
};

// ── 메시지 관리 ──────────────────────────────────────
window.onMsgTypeChange = async() => {
  const type=document.querySelector('input[name=msgType]:checked').value;
  document.getElementById('msgGroupRow').style.display=type==='group'?'':'none';
  document.getElementById('msgStudentRow').style.display=type==='student'?'':'none';
  if(type==='group'){
    const snap=await getDocs(collection(db,'groups'));
    document.getElementById('msgGroup').innerHTML=snap.docs.map(d=>`<option value="${esc(d.data().name)}">${esc(d.data().name)}</option>`).join('');
  }
  if(type==='student'){
    const snap=await getDocs(query(collection(db,'users'),where('role','==','student'),where('status','==','active')));
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
  if(!title||!body){showToast('제목과 내용을 입력하세요.');return;}
  try{
    const res=await fetch('/api/sendPush',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,body,target})});
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
  if(!title||!body){showToast('제목과 내용을 입력하세요.');return;}
  await addDoc(collection(db,'pushNotifications'),{target,title,body,sent:false,date:new Date().toISOString().slice(0,10),createdAt:serverTimestamp()});
  showToast('💾 저장됐어요!'); await loadMessages();
};
async function loadMessages(){
  const el=document.getElementById('savedMsgList');
  try{
    const snap=await getDocs(query(collection(db,'pushNotifications'),orderBy('createdAt','desc')));
    if(snap.empty){el.innerHTML='<div style="color:#bbb;font-size:13px;text-align:center;padding:20px;">발송된 알림이 없습니다</div>';return;}
    el.innerHTML=snap.docs.map(d=>{
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
          <button onclick="event.stopPropagation();delMsg('${d.id}')" style="background:none;border:none;color:#e05050;cursor:pointer;font-size:15px;padding:0 4px;flex-shrink:0;">✕</button>
        </div>
      </div>`;
    }).join('');
  }catch(e){el.innerHTML='<div style="color:#bbb;font-size:13px;">불러오기 실패</div>';}
}

window.showMsgReadStatus = async(pushId, title) => {
  const titleEl = document.getElementById('msgReadTitle');
  const listEl  = document.getElementById('msgReadList');
  if(!listEl) return;
  if(titleEl) titleEl.innerHTML = `👁 읽음 현황 <span style="font-size:13px;color:var(--text);font-weight:600;">${esc(title)}</span>`;
  listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#bbb;">로딩 중...</div>';
  try{
    // 이 알림(pushId)에 해당하는 userNotifications 조회
    const snap = await getDocs(query(collection(db,'userNotifications'),where('pushId','==',pushId)));

    // pushId 없는 경우 (구버전 알림) - createdAt 기준으로 title+body 매칭
    let notifs = snap.docs.map(d=>({id:d.id,...d.data()}));

    if(!notifs.length){
      // pushId 없는 구버전: title로 fallback
      const fbSnap = await getDocs(query(collection(db,'userNotifications'),where('title','==',title)));
      notifs = fbSnap.docs.map(d=>({id:d.id,...d.data()}));
    }

    if(!notifs.length){
      listEl.innerHTML='<div style="padding:20px;text-align:center;color:#bbb;font-size:13px;">확인 데이터가 없습니다<br><span style="font-size:11px;">이전 방식으로 발송된 알림입니다</span></div>';
      return;
    }

    // uid 목록으로 학생 이름 조회
    const uids = [...new Set(notifs.map(n=>n.uid))];
    const userSnap = await getDocs(query(collection(db,'users'),where('role','==','student')));
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
  if(!(await showConfirm('삭제할까요?')))return;
  await deleteDoc(doc(db,'pushNotifications',id));
  showToast('삭제됐어요.'); await loadMessages();
};

// ── 성적 관리 ────────────────────────────────────────
async function initScoreReport(){
  const today=new Date();
  const from=new Date(today.getFullYear(),today.getMonth(),1).toISOString().slice(0,10);
  document.getElementById('scoreFrom').value=from;
  document.getElementById('scoreTo').value=today.toISOString().slice(0,10);

  // 반 목록 채우기 (users에서 실제 그룹값 추출)
  const sel = document.getElementById('scoreClassFilter');
  if(sel && sel.options.length <= 1){
    try{
      const snap = await getDocs(query(collection(db,'users'),where('role','==','student')));
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

  const {col, dir} = _srSort;
  const sorted = [..._srData].sort((a,b)=>{
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
    const isUnsc = s._isUnsc;
    const modeHtml = isUnsc
      ? '<span class="badge" style="background:#fff8e1;color:#b45309;border:1px solid #ffe082;font-size:10px;">🔀 언스크램블</span>'
      : '<span class="badge badge-teal" style="font-size:10px;">📝 단어시험</span>';
    return `<tr style="cursor:pointer;" onclick="showScoreDetail('${s.id}','${s.testId||''}')">
      <td>${i+1}</td>
      <td>${esc(s.group)||'-'}</td>
      <td style="font-weight:600;">${esc(s.userName)||'-'}</td>
      <td>${modeHtml}</td>
      <td style="font-size:12px;max-width:100px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${s.bookName||''}">${esc(s.bookName)||'-'}</td>
      <td style="font-size:12px;max-width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${s.testName||''}">${s.testName||'-'}</td>
      <td style="text-align:center;">${s.correct||0}/${s.total||0}</td>
      <td><span class="badge ${sbadge(s.score||0)}">${s.score||0}점</span></td>
      <td style="color:var(--gray);font-size:12px;">${s._dateTime||s.date||''}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();showScoreDetail('${s.id}','${s.testId||''}')">상세</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="10" style="text-align:center;color:#bbb;padding:20px;">결과가 없습니다</td></tr>';
}

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
    const snap=await getDocs(query(collection(db,'scores'),orderBy('createdAt','desc')));
    const scores=snap.docs.map(d=>({id:d.id,...d.data()}));
    const from=document.getElementById('scoreFrom').value;
    const to=document.getElementById('scoreTo').value;
    const cls=document.getElementById('scoreClassFilter').value;
    const modeFilter=document.getElementById('scoreModeFilter').value;

    const filtered=scores.filter(s=>{
      const d=s.date||'';
      const isUnsc=s.testMode==='unscramble'||s.mode==='unscramble';
      if(modeFilter==='word' && isUnsc) return false;
      if(modeFilter==='unscramble' && !isUnsc) return false;
      return(!from||d>=from)&&(!to||d<=to)&&(!cls||s.group===cls);
    });
    if(!filtered.length){
      el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#bbb;padding:20px;">결과가 없습니다</td></tr>';
      _srData=[]; return;
    }

    // testId로 교재명·시험명 보완
    const testIds=[...new Set(filtered.map(s=>s.testId).filter(Boolean))];
    const testMap={};
    await Promise.all(testIds.map(async id=>{
      try{ const d=await getDoc(doc(db,'tests',id)); if(d.exists()) testMap[id]=d.data(); }catch(e){console.warn(e);}
    }));

    // 정렬용 필드 정규화
    _srData = filtered.map(s=>{
      const t=testMap[s.testId]||{};
      const isUnsc=s.testMode==='unscramble'||s.mode==='unscramble'||t.testMode==='unscramble';
      return {
        ...s,
        _isUnsc: isUnsc,
        bookName: s.bookName||t.bookName||s.unitName||'-',
        testName: s.testName||t.name||'-',
        mode: isUnsc?'unscramble':'word',
        score: s.score||0,
        correct: s.correct||0,
        _dateTime: s.createdAt?.toDate
          ? s.createdAt.toDate().toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
          : s.date||'',
      };
    });

    _srSort = {col:'date', dir:'desc'};
    renderScoreReportRows();
  }catch(e){el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';}
};

window.showScoreDetail = async(scoreId, testId) => {
  try{
    const scoreDoc = await getDoc(doc(db,'scores',scoreId));
    if(!scoreDoc.exists()){ showToast('데이터 없음'); return; }
    const s = scoreDoc.data();
    const isUnsc = s.testMode==='unscramble'||s.mode==='unscramble';

    let testData=null, words=[];
    if(testId){
      try{
        const tDoc=await getDoc(doc(db,'tests',testId));
        if(tDoc.exists()){ testData=tDoc.data(); words=testData.words||testData.sentences||[]; }
      }catch(e){console.warn(e);}
    }

    const bookName=s.bookName||testData?.bookName||s.unitName||'-';
    const testName=s.testName||testData?.name||'-';
    const passScore=s.passScore||testData?.passScore||80;
    const passed=s.passed||(s.score>=passScore);
    const pct=s.score||0;
    const badge=pct>=80?'badge-green':pct>=60?'badge-amber':'badge-red';

    // 단어/문장 목록 HTML
    const itemsHtml = words.length
      ? isUnsc
        ? `<div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:6px;">📋 시험 문장 (${words.length}개)</div>
           <div style="display:flex;flex-direction:column;gap:3px;">
             ${words.map((w,i)=>`
               <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 10px;border-radius:8px;background:${i%2===0?'#f8f9fa':'white'};font-size:12px;">
                 <span style="color:#ccc;font-size:11px;width:18px;flex-shrink:0;">${i+1}</span>
                 <div>
                   <div style="font-weight:600;">${w.sentence||w.en||''}</div>
                   ${w.ko?`<div style="color:var(--gray);font-size:11px;">${w.ko}</div>`:''}
                 </div>
               </div>`).join('')}
           </div>`
        : `<div style="font-size:11px;font-weight:700;color:var(--gray);margin-bottom:6px;">📋 시험 단어 (${words.length}개) · 정답 ${s.correct||0}개 · 오답 ${s.wrong||0}개</div>
           <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;">
             ${words.map((w,i)=>`
               <div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:8px;background:${i%2===0?'#f8f9fa':'white'};font-size:12px;">
                 <span style="color:#ccc;font-size:10px;width:16px;flex-shrink:0;">${i+1}</span>
                 <span style="font-weight:600;">${w.en||''}</span>
                 <span style="color:var(--gray);margin-left:auto;">${w.ko||''}</span>
               </div>`).join('')}
           </div>`
      : `<div style="color:#bbb;font-size:12px;text-align:center;padding:16px;">시험 단어 데이터가 없습니다</div>`;

    showModal(`
      <!-- 헤더 -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;">
        <div>
          <div style="font-size:16px;font-weight:700;">${esc(s.userName)||'-'}
            <span style="font-size:12px;color:var(--gray);font-weight:400;">${esc(s.group)||''}</span>
          </div>
          <div style="font-size:12px;color:var(--gray);margin-top:3px;">
            ${isUnsc
              ? '<span style="background:#fff8e1;color:#b45309;border:1px solid #ffe082;border-radius:20px;padding:1px 7px;font-size:11px;">🔀 언스크램블</span>'
              : '<span style="background:#e0f5f5;color:var(--teal);border-radius:20px;padding:1px 7px;font-size:11px;">📝 단어시험</span>'}
            &nbsp;${esc(bookName)} &nbsp;·&nbsp; ${testName}
          </div>
        </div>
        <span class="badge ${badge}" style="font-size:18px;padding:6px 14px;">${pct}점</span>
      </div>
      <!-- 요약 4칸 -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;">
        <div style="background:#f0fafa;border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:20px;font-weight:800;color:var(--teal);">${s.correct||0}</div>
          <div style="font-size:11px;color:var(--gray);margin-top:1px;">정답</div>
        </div>
        <div style="background:#fee2e2;border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:20px;font-weight:800;color:#e05050;">${s.wrong||0}</div>
          <div style="font-size:11px;color:var(--gray);margin-top:1px;">오답</div>
        </div>
        <div style="background:#f8f9fa;border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:20px;font-weight:800;color:#555;">${s.total||0}</div>
          <div style="font-size:11px;color:var(--gray);margin-top:1px;">전체</div>
        </div>
        <div style="background:${passed?'#d1fae5':'#fef9c3'};border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:14px;font-weight:800;color:${passed?'#059669':'#b45309'};line-height:1.4;">${passed?'✅':'⚠️'}<br>${passed?'통과':'미통과'}</div>
          <div style="font-size:11px;color:var(--gray);margin-top:1px;">기준 ${passScore}점</div>
        </div>
      </div>
      <!-- 시험 문항 목록 -->
      <div style="border:1px solid var(--border);border-radius:10px;padding:12px;max-height:300px;overflow-y:auto;">
        ${itemsHtml}
      </div>
      <div style="font-size:11px;color:#bbb;text-align:right;margin-top:6px;">${s.date||''} ${s.createdAt?.toDate?s.createdAt.toDate().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):''}</div>
      <button class="btn btn-secondary" onclick="closeModal()" style="width:100%;justify-content:center;margin-top:10px;">닫기</button>
    `);
  }catch(e){ showToast('상세 불러오기 실패: '+e.message); }
};
async function loadPersonalStudentList(){
  const el=document.getElementById('personalStudentList');
  try{
    const snap=await getDocs(query(collection(db,'users'),where('role','==','student'),where('status','==','active')));
    const students=snap.docs.map(d=>({id:d.id,...d.data()}));
    el.innerHTML=students.map(u=>`
      <div onclick="loadPersonalScore('${u.id}')" style="padding:10px 12px;border-bottom:1px solid #f5f5f5;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background=''">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--teal);color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${(u.name||'?').charAt(0)}</div>
        <div><div style="font-weight:600;">${u.name}</div><div style="font-size:11px;color:var(--gray);">${esc(u.group)||'-'}</div></div>
      </div>
    `).join('');
  }catch(e){console.warn(e);}
}
window.loadPersonalScore = async(uid) => {
  if(!uid)return;
  const detail=document.getElementById('personalDetail');
  detail.innerHTML='<div class="loading"><div class="spinner"></div>로딩 중</div>';
  try{
    const userSnap=await getDoc(doc(db,'users',uid));
    const u=userSnap.data();
    const scoresSnap=await getDocs(query(collection(db,'scores'),where('userId','==',uid),orderBy('createdAt','desc')));
    const scores=scoresSnap.docs.map(d=>d.data());
    const avg=scores.length?Math.round(scores.reduce((s,r)=>s+r.score,0)/scores.length):0;
    detail.innerHTML=`
      <div class="card-title">${u.name} · ${esc(u.group)||'-'}</div>
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
          <thead><tr><th>No</th><th>종류</th><th>교재명</th><th>시험명</th><th>점수</th><th>정답/전체</th><th>날짜</th></tr></thead>
          <tbody>${scores.map((s,i)=>{
            const isUnsc=s.testMode==='unscramble'||s.mode==='unscramble';
            const modeHtml=isUnsc
              ?'<span class="badge" style="background:#fff8e1;color:#b45309;border:1px solid #ffe082;font-size:10px;">🔀</span>'
              :'<span class="badge badge-teal" style="font-size:10px;">📝</span>';
            const bookName=s.bookName||s.unitName||'-';
            const testName=s.testName||'-';
            return `<tr>
              <td>${i+1}</td>
              <td>${modeHtml}</td>
              <td style="font-size:12px;">${esc(bookName)}</td>
              <td style="font-size:12px;max-width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${testName}</td>
              <td><span class="badge ${s.score>=80?'badge-green':s.score>=60?'badge-amber':'badge-red'}">${s.score}점</span></td>
              <td>${s.correct||0}/${s.total||0}</td>
              <td style="color:var(--gray);font-size:12px;">${s.date||''}</td>
            </tr>`;
          }).join('')||'<tr><td colspan="7" style="text-align:center;color:#bbb;padding:12px;">응시 내역이 없습니다</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }catch(e){detail.innerHTML='<div style="color:#e05050;padding:20px;">불러오기 실패</div>';}
};

// ── 공통 유틸 ─────────────────────────────────────────
window.showModal = (html) => {
  document.getElementById('modalContent').innerHTML=html;
  document.getElementById('modalOverlay').style.display='flex';
};
window.closeModal = () => { document.getElementById('modalOverlay').style.display='none'; };
document.getElementById('modalOverlay').addEventListener('click', e => { if(e.target===document.getElementById('modalOverlay')) closeModal(); });

let toastTimer=null;
window.showToast = (msg) => {
  let t=document.getElementById('adminToast');
  if(!t){t=document.createElement('div');t.id='adminToast';t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#222;color:white;padding:10px 20px;border-radius:10px;font-size:14px;z-index:999;opacity:0;transition:opacity .3s;pointer-events:none;';document.body.appendChild(t);}
  t.textContent=msg;t.style.opacity='1';
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{t.style.opacity='0';},2500);
};

// ── Auth + Firestore 동시 삭제 ────────────────────────────
async function deleteUserFull(uid, name){
  if(!(await showConfirm(`"${name}" 학생을 완전 삭제할까요?\nFirebase 계정과 모든 데이터가 삭제됩니다.`))) return false;
  try{
    const res = await fetch('/api/deleteUser',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({uid})
    });
    const result = await res.json();
    if(result.success){ showToast('✅ 계정이 완전 삭제됐어요!'); return true; }
    else { showToast('❌ 삭제 실패: '+result.error); return false; }
  } catch(e){ showToast('❌ 삭제 실패: '+e.message); return false; }
}

// ── 테이블 정렬 엔진 ─────────────────────────────────────
const _sortState = {}; // {tableId: {col, dir}}

window.sortTable = (tableId, colIdx) => {
  const s = _pageState[tableId]; if(!s) return;
  const prev = _sortState[tableId]||{col:-1,dir:'asc'};
  const dir = (prev.col===colIdx && prev.dir==='asc') ? 'desc' : 'asc';
  _sortState[tableId] = {col:colIdx, dir};

  // 헤더 클래스 업데이트
  const table = document.getElementById(tableId)?.closest('table');
  if(table){
    table.querySelectorAll('thead th').forEach((th,i)=>{
      th.classList.remove('sort-asc','sort-desc');
      if(i===colIdx+1) th.classList.add(dir==='asc'?'sort-asc':'sort-desc'); // +1 체크박스 열 때문
    });
  }

  // 데이터 정렬
  const sorted = [...s.data].sort((a,b)=>{
    const aEl = document.createElement('div'); aEl.innerHTML = a._row||'';
    const bEl = document.createElement('div'); bEl.innerHTML = b._row||'';
    // 렌더된 행에서 텍스트 추출하는 방식 대신 데이터 키 기반 정렬
    const keys = Object.keys(a);
    const val = (obj) => {
      // 컬럼 인덱스로 데이터 접근 (대략적 매핑)
      const vals = Object.values(obj).filter(v=>typeof v==='string'||typeof v==='number');
      return (vals[colIdx]||'').toString().toLowerCase();
    };
    const av = val(a), bv = val(b);
    const n = parseFloat(av), m = parseFloat(bv);
    if(!isNaN(n)&&!isNaN(m)) return dir==='asc'?n-m:m-n;
    return dir==='asc'?av.localeCompare(bv,'ko'):bv.localeCompare(av,'ko');
  });

  refreshPagination(tableId, sorted);
};

// ── 시험 대상 선택 트리 ──────────────────────────────────
let _testTargets = []; // 선택된 대상 배열 [{type:'class'|'student', id, name, groupName}]

window.renderTestStep1 = async function(){
  updateStepUI(1);
  _testTargets = [];

  // 학생이 있는 반만 로드
  const usersSnap = await getDocs(query(collection(db,'users'),where('role','==','student'),where('status','==','active')));
  const students = usersSnap.docs.map(d=>({id:d.id,...d.data()}));

  // 반별로 그룹화 + 가나다순 정렬
  const groupMap = {};
  students.forEach(u=>{
    const g = u.group||'미배정';
    if(!groupMap[g]) groupMap[g]=[];
    groupMap[g].push(u);
  });
  // 학생 이름 가나다순 정렬
  Object.keys(groupMap).forEach(g=>{
    groupMap[g].sort((a,b)=>(a.name||'').localeCompare(b.name||'','ko'));
  });
  const groups = Object.keys(groupMap).sort((a,b)=>a.localeCompare(b,'ko'));

  document.getElementById('testStep1Content').innerHTML = `
    <div style="font-size:14px;font-weight:600;margin-bottom:16px;">① 시험 대상 선택</div>
    <div style="display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start;">
      <div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:6px;font-weight:600;">
          클래스 / 학생 선택 <span style="font-weight:400;">(반 클릭: 전체선택, 학생 클릭: 개별선택)</span>
        </div>
        <div style="margin-bottom:8px;">
          <input type="text" id="testSearchInput" placeholder="🔍 학생 이름 검색..." oninput="filterTestTree(this.value)"
            style="width:100%;border:1px solid var(--border);border-radius:8px;padding:7px 12px;font-size:13px;outline:none;">
        </div>
        <div class="target-tree" id="testTargetTree">
          ${groups.map(g=>`
            <div>
              <div class="tree-class-row" id="cls-${g}" onclick="toggleTreeClass('${g}')">
                <span class="tree-toggle">›</span>
                <input type="checkbox" id="chk-cls-${g}" onclick="event.stopPropagation();toggleClassCheck('${g}')" style="cursor:pointer;">
                <span>👥 ${g}</span>
                <span style="margin-left:auto;font-size:11px;color:#aaa;">${groupMap[g].length}명</span>
              </div>
              <div class="tree-student-list" id="list-${g}">
                ${groupMap[g].map(u=>`
                  <div class="tree-student-row" id="std-${u.id}" onclick="toggleStudentCheck('${u.id}','${u.name}','${g}')">
                    <input type="checkbox" id="chk-${u.id}" onclick="event.stopPropagation();toggleStudentCheck('${u.id}','${u.name}','${g}')" style="cursor:pointer;">
                    <span style="color:var(--gray);font-size:11px;width:14px;">${groupMap[g].indexOf(u)+1}</span>
                    <span>👤 ${esc(u.name)}</span>
                  </div>`).join('')}
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:6px;font-weight:600;">
          선택된 대상 <span id="targetCount" style="color:var(--teal);">0명</span>
          <button onclick="clearAllTargets()" style="margin-left:8px;background:none;border:none;color:#bbb;cursor:pointer;font-size:11px;">전체해제</button>
        </div>
        <div class="selected-tags" id="selectedTargetTags">
          <span style="color:#bbb;font-size:12px;align-self:center;">대상을 선택하세요</span>
        </div>
        <div style="margin-top:16px;padding:10px 12px;background:#f8f9fa;border-radius:8px;font-size:12px;color:var(--gray);">
          선택된 반은 시험 배정 시 해당 반 전체 학생에게 적용됩니다.
        </div>
      </div>
    </div>
    <div style="margin-top:16px;text-align:right;">
      <button class="btn btn-primary" onclick="testStep1Next()">다음 → 교재 선택</button>
    </div>
  `;
}

window.toggleTreeClass = (group) => {
  const row = document.getElementById('cls-'+group);
  const list = document.getElementById('list-'+group);
  row?.classList.toggle('expanded');
  list?.classList.toggle('open');
};

window.toggleClassCheck = (group) => {
  const cb = document.getElementById('chk-cls-'+group);
  const isChecked = cb.checked;
  // 반 전체를 추가/제거
  if(isChecked){
    // 반이 이미 선택목록에 없으면 추가
    if(!_testTargets.find(t=>t.type==='class'&&t.id===group)){
      _testTargets = _testTargets.filter(t=>!(t.type==='student'&&t.groupName===group));
      _testTargets.push({type:'class', id:group, name:group+' 전체', groupName:group});
    }
    // 해당 반 학생 체크박스도 모두 체크
    document.querySelectorAll(`#list-${group} input[type=checkbox]`).forEach(c=>c.checked=true);
    document.querySelectorAll(`#list-${group} .tree-student-row`).forEach(r=>r.classList.add('selected'));
    // 반 펼치기
    document.getElementById('cls-'+group)?.classList.add('expanded');
    document.getElementById('list-'+group)?.classList.add('open');
  } else {
    _testTargets = _testTargets.filter(t=>!(t.id===group&&t.type==='class'));
    document.querySelectorAll(`#list-${group} input[type=checkbox]`).forEach(c=>c.checked=false);
    document.querySelectorAll(`#list-${group} .tree-student-row`).forEach(r=>r.classList.remove('selected'));
  }
  renderTargetTags();
};

window.toggleStudentCheck = (uid, name, group) => {
  const cb = document.getElementById('chk-'+uid);
  const row = document.getElementById('std-'+uid);
  const isChecked = !cb.checked;
  cb.checked = isChecked;
  if(isChecked){
    row?.classList.add('selected');
    // 반 전체 선택 해제
    _testTargets = _testTargets.filter(t=>!(t.type==='class'&&t.id===group));
    document.getElementById('chk-cls-'+group).checked = false;
    if(!_testTargets.find(t=>t.id===uid)){
      _testTargets.push({type:'student', id:uid, name, groupName:group});
    }
  } else {
    row?.classList.remove('selected');
    _testTargets = _testTargets.filter(t=>t.id!==uid);
  }
  renderTargetTags();
};

function renderTargetTags(){
  const el = document.getElementById('selectedTargetTags');
  const cnt = document.getElementById('targetCount');
  if(!_testTargets.length){
    el.innerHTML='<span style="color:#bbb;font-size:12px;align-self:center;">대상을 선택하세요</span>';
    cnt.textContent='0명';
    return;
  }
  // 가나다순 정렬
  const sorted = [..._testTargets].sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  el.innerHTML = sorted.map(t=>`
    <span class="sel-tag">
      ${t.type==='class'?'👥':'👤'} ${esc(t.name)}
      <span class="sel-tag-x" onclick="removeTarget('${t.id}')">×</span>
    </span>`).join('');
  cnt.textContent = _testTargets.length+'명/반';
}

window.removeTarget = (id) => {
  const target = _testTargets.find(t=>t.id===id);
  if(!target) return;
  _testTargets = _testTargets.filter(t=>t.id!==id);
  // 체크박스 해제
  const cb = document.getElementById('chk-'+id) || document.getElementById('chk-cls-'+id);
  if(cb) cb.checked = false;
  document.getElementById('std-'+id)?.classList.remove('selected');
  renderTargetTags();
};

window.clearAllTargets = () => {
  _testTargets = [];
  document.querySelectorAll('.tree-class-row input, .tree-student-row input').forEach(cb=>cb.checked=false);
  document.querySelectorAll('.tree-student-row').forEach(r=>r.classList.remove('selected'));
  renderTargetTags();
};

window.filterTestTree = (q) => {
  const lq = q.toLowerCase();
  document.querySelectorAll('.tree-student-row').forEach(row=>{
    const name = row.querySelector('span:last-child')?.textContent||'';
    row.style.display = (!lq||name.includes(lq)) ? '' : 'none';
  });
  // 검색 시 모든 반 펼치기
  if(lq){
    document.querySelectorAll('.tree-class-row').forEach(r=>r.classList.add('expanded'));
    document.querySelectorAll('.tree-student-list').forEach(l=>l.classList.add('open'));
  }
};

window.testStep1Next = () => {
  if(!_testTargets.length){showToast('시험 대상을 선택하세요.');return;}
  // testData에 저장
  testData.targetType = _testTargets.length===1&&_testTargets[0].type==='class'?'class':'mixed';
  testData.targetId = _testTargets.map(t=>t.id).join(',');
  testData.targetName = _testTargets.length===1?_testTargets[0].name:`${_testTargets.length}명/반 선택`;
  testData.targets = [..._testTargets];
  renderTestStep2();
};

// ── 삭제 함수 오버라이드 (Auth 포함 삭제) ────────────────
window.deleteSelectedStudent = async() => {
  const ids = getCheckedIds('studentTableBody');
  if(!ids.length){showToast('삭제할 학생을 선택하세요.');return;}
  if(!(await showConfirm(`선택한 ${ids.length}명을 완전 삭제할까요?\nFirebase 계정과 모든 데이터가 삭제됩니다.`)))return;
  let ok=0;
  for(const id of ids){
    try{
      await fetch('/api/deleteUser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:id})});
      ok++;
    }catch(e){console.log('삭제실패:',e);}
  }
  showToast(`✅ ${ok}명 삭제 완료!`); await loadStudents('active');
};
window.deleteSelectedOutStudent = async() => {
  const ids = getCheckedIds('outTableBody');
  if(!ids.length){showToast('삭제할 학생을 선택하세요.');return;}
  if(!await showConfirm(`선택한 ${ids.length}명을 완전 삭제할까요?`))return;
  let ok=0;
  for(const id of ids){
    try{
      await fetch('/api/deleteUser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:id})});
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
  if(ids.length !== 1){showToast('수정할 반을 하나만 선택하세요.');return;}
  editClass(ids[0]);
};
window.deleteSelectedClass = async() => {
  const ids = getCheckedIds('classTableBody');
  if(!ids.length){showToast('삭제할 반을 선택하세요.');return;}
  if(!await showConfirm(`선택한 ${ids.length}개 반을 삭제할까요?`))return;
  for(const id of ids) await deleteDoc(doc(db,'groups',id));
  showToast('삭제됐어요.'); await loadClasses();
};

// ── 학생 선택 액션 ──────────────────────────────────
window.editSelectedStudent = () => {
  const ids = getCheckedIds('studentTableBody');
  if(ids.length !== 1){showToast('수정할 학생을 하나만 선택하세요.');return;}
  editStudent(ids[0]);
};
window.deleteSelectedStudent = async() => {
  const ids = getCheckedIds('studentTableBody');
  if(!ids.length){showToast('삭제할 학생을 선택하세요.');return;}
  if(!await showConfirm(`선택한 ${ids.length}명을 삭제할까요?`))return;
  for(const id of ids) await deleteDoc(doc(db,'users',id));
  showToast('삭제됐어요.'); await loadStudents('active');
};
window.restoreSelectedStudent = async(status) => {
  const tbodyId = status==='pause'?'pauseTableBody':'outTableBody';
  const ids = getCheckedIds(tbodyId);
  if(!ids.length){showToast('학생을 선택하세요.');return;}
  if(!await showConfirm(`선택한 ${ids.length}명을 재원처리 할까요?`))return;
  for(const id of ids) await updateDoc(doc(db,'users',id),{status:'active',statusDate:new Date().toISOString().slice(0,10)});
  showToast('재원처리 완료!'); await loadStudents(status);
};
window.outSelectedStudent = async() => {
  const ids = getCheckedIds('pauseTableBody');
  if(!ids.length){showToast('학생을 선택하세요.');return;}
  if(!await showConfirm(`선택한 ${ids.length}명을 퇴원처리 할까요?`))return;
  for(const id of ids) await updateDoc(doc(db,'users',id),{status:'out',statusDate:new Date().toISOString().slice(0,10)});
  showToast('퇴원처리 완료!'); await loadStudents('pause');
};
window.deleteSelectedOutStudent = async() => {
  const ids = getCheckedIds('outTableBody');
  if(!ids.length){showToast('삭제할 학생을 선택하세요.');return;}
  if(!(await showConfirm(`선택한 ${ids.length}명을 완전 삭제할까요?`)))return;
  for(const id of ids) await deleteDoc(doc(db,'users',id));
  showToast('삭제됐어요.'); await loadStudents('out');
};

// ── 공지 선택 액션 ──────────────────────────────────
window.editSelectedNotice = () => {
  const ids = getCheckedIds('noticeTableBody');
  if(ids.length !== 1){showToast('수정할 공지를 하나만 선택하세요.');return;}
  editNotice(ids[0]);
};
window.deleteSelectedNotice = async() => {
  const ids = getCheckedIds('noticeTableBody');
  if(!ids.length){showToast('삭제할 공지를 선택하세요.');return;}
  if(!(await showConfirm(`선택한 ${ids.length}개 공지를 삭제할까요?`)))return;
  for(const id of ids) await deleteDoc(doc(db,'notices',id));
  showToast('삭제됐어요.'); await loadNotices();
};

// ── 결제 선택 액션 ──────────────────────────────────
window.markSelectedPaid = async() => {
  const ids = getCheckedIds('paymentTableBody');
  if(!ids.length){showToast('항목을 선택하세요.');return;}
  for(const id of ids) await updateDoc(doc(db,'payments',id),{status:'paid'});
  showToast('납부완료 처리됐어요.'); await loadPayments();
};
window.deleteSelectedPayment = async() => {
  const ids = getCheckedIds('paymentTableBody');
  if(!ids.length){showToast('삭제할 항목을 선택하세요.');return;}
  if(!(await showConfirm(`선택한 ${ids.length}개를 삭제할까요?`)))return;
  for(const id of ids) await deleteDoc(doc(db,'payments',id));
  showToast('삭제됐어요.'); await loadPayments();
};

// ── 교재 선택 액션 ──────────────────────────────────
window.editSelectedBook = () => {
  const ids = getCheckedIds('bookTableBody');
  if(ids.length !== 1){showToast('수정할 교재를 하나만 선택하세요.');return;}
  const book = allBooks.find(b=>b.id===ids[0]);
  if(!book) return;
  showModal(`
    <div style="font-size:17px;font-weight:700;margin-bottom:16px;">교재 이름 수정</div>
    <input id="editBookName" type="text" value="${esc(book.name)}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;margin-bottom:16px;">
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="updateBookName('${ids[0]}')" style="flex:1;justify-content:center;">저장</button>
    </div>
  `);
};
window.updateBookName = async(id) => {
  const name = document.getElementById('editBookName').value.trim();
  if(!name){showToast('교재명을 입력하세요.');return;}
  await updateDoc(doc(db,'books',id),{name});
  closeModal(); showToast('교재명이 수정됐어요!'); await loadBooks();
};
window.addUnitToSelected = () => {
  const ids = getCheckedIds('bookTableBody');
  if(ids.length !== 1){showToast('교재를 하나만 선택하세요.');return;}
  const book = allBooks.find(b=>b.id===ids[0]);
  if(book) addUnit(book.id, book.name);
};
window.moveSelectedBook = async() => {
  const ids = getCheckedIds('bookTableBody');
  if(!ids.length){showToast('이동할 교재를 선택하세요.');return;}
  const folderOpts = allFolders.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('');
  if(!folderOpts){showToast('폴더가 없습니다. 폴더를 먼저 생성하세요.');return;}
  showModal(`
    <div style="font-size:17px;font-weight:700;margin-bottom:16px;">📁 폴더 이동 (${ids.length}개)</div>
    <select id="moveFolderId" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;margin-bottom:16px;">${folderOpts}</select>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="doMoveBooks([${ids.map(id=>`'${id}'`).join(',')}])" style="flex:1;justify-content:center;">이동</button>
    </div>
  `);
};
window.doMoveBooks = async(ids) => {
  const folderId = document.getElementById('moveFolderId').value;
  const folder = allFolders.find(f=>f.id===folderId);
  for(const id of ids) await updateDoc(doc(db,'books',id),{folderId,folderName:folder?.name||''});
  await updateDoc(doc(db,'folders',folderId),{bookCount:(folder?.bookCount||0)+ids.length});
  closeModal(); showToast('폴더로 이동했어요!'); await loadBooks();
};
window.deleteSelectedBook = async() => {
  const ids = getCheckedIds('bookTableBody');
  if(!ids.length){showToast('삭제할 교재를 선택하세요.');return;}
  if(!(await showConfirm(`선택한 ${ids.length}개 교재를 삭제할까요?`)))return;
  for(const id of ids) await deleteDoc(doc(db,'books',id));
  showToast('삭제됐어요.'); await loadBooks();
};
window.deleteSelectedFolder = async() => {
  const ids = getCheckedIds('folderTableBody');
  if(!ids.length){showToast('삭제할 폴더를 선택하세요.');return;}
  if(!(await showConfirm(`선택한 ${ids.length}개 폴더를 삭제할까요?`)))return;
  for(const id of ids) await deleteDoc(doc(db,'folders',id));
  showToast('삭제됐어요.'); await loadFolders();
};

// ── 시험 선택 액션 ──────────────────────────────────
window.reprintSelectedTest = async() => {
  const ids = getCheckedIds('testListBody');
  if(ids.length !== 1){showToast('재출력할 시험을 하나만 선택하세요.');return;}
  reprintTest(ids[0]);
};
window.deleteSelectedTest = async() => {
  const ids = getCheckedIds('testListBody');
  if(!ids.length){showToast('삭제할 시험을 선택하세요.');return;}
  if(!(await showConfirm(`선택한 ${ids.length}개 시험을 삭제할까요?`)))return;
  for(const id of ids) await deleteDoc(doc(db,'tests',id));
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
      if(!rows || rows.length < 2){ showToast('데이터가 없습니다.'); return; }
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
  if(!rows||rows.length<2){ showToast('먼저 엑셀 파일을 업로드하세요.'); return; }
  const dataRows = rows.slice(1).filter(r=>(r[0]||'').toString().trim());
  if(!dataRows.length){ showToast('등록할 학생이 없습니다.'); return; }
  if(!(await showConfirm(`${dataRows.length}명을 재원생으로 등록할까요?\n기본 비밀번호: 123456`))) return;
  const btn = document.getElementById('excelImportBtn');
  btn.textContent='등록 중... 0/'+dataRows.length; btn.disabled=true;
  let success=0, fail=0, failList=[];
  for(let i=0;i<dataRows.length;i++){
    const row=dataRows[i];
    const username=(row[0]||'').toString().trim();
    const name=(row[1]||'').toString().trim();
    if(!username||!name){failList.push(username||'?');fail++;continue;}
    const email=username+'@kunsori.app';
    try{
      const {initializeApp:ia}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const {getAuth:ga,createUserWithEmailAndPassword:cu,signOut:so}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
      const {getApp:gapp}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      let secApp;try{secApp=gapp('sec');}catch(e){secApp=ia({...firebaseConfig},'sec');}
      const a2=ga(secApp);
      const cred=await cu(a2,email,'123456');
      await so(a2);
      await setDoc(doc(db,'users',cred.user.uid),{
        username, name, email,
        group:(row[2]||'').toString().trim(),
        birth:(row[3]||'').toString().trim(),
        school:(row[4]||'').toString().trim(),
        grade:(row[5]||'').toString().trim(),
        phone:(row[6]||'').toString().trim(),
        parentName:(row[7]||'').toString().trim(),
        parentPhone:(row[8]||'').toString().trim(),
        role:'student', status:'active', createdAt:serverTimestamp()
      });
      success++;
    }catch(e){ console.log(username,'실패:',e.message); failList.push(username); fail++; }
    btn.textContent=`등록 중... ${success+fail}/${dataRows.length}`;
  }
  btn.textContent='✅ 일괄 등록하기'; btn.disabled=false;
  const resultColor = fail===0?'#d1fae5':'#fef3c7';
  document.getElementById('excelPreview').innerHTML += `
    <div style="margin-top:12px;padding:14px;border-radius:8px;background:${resultColor};font-size:13px;">
      <div style="font-weight:600;margin-bottom:6px;">📊 등록 결과</div>
      <div>✅ 성공: <b>${success}명</b></div>
      ${fail>0?`<div>❌ 실패: <b>${fail}명</b> (${failList.slice(0,5).join(', ')}${failList.length>5?'...':''})</div>`:''}
      ${fail>0?`<div style="margin-top:4px;font-size:12px;color:#666;">실패 원인: 중복 아이디이거나 이미 가입된 계정</div>`:''}
    </div>`;
  window._excelRows=null;
  document.getElementById('excelUpload').value='';
  document.getElementById('excelImportBtnWrap').style.display='none';
  if(success>0) showToast(`✅ ${success}명 등록 완료!`);
};
window.loadTestList = async() => {
  const el = document.getElementById('testListBody');
  try{
    const snap = await getDocs(query(collection(db,'tests'),orderBy('createdAt','desc')));
    if(snap.empty){el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#bbb;padding:20px;">출제된 시험이 없습니다</td></tr>';return;}
    const tests = snap.docs.map(d=>({id:d.id,...d.data()}));

    const scoresSnap = await getDocs(collection(db,'scores'));
    const allScores = scoresSnap.docs.map(d=>d.data());

    const testsWithStats = tests.map(t=>{
      const ts = allScores.filter(s=>s.testId===t.id);
      const avg = ts.length ? Math.round(ts.reduce((sum,s)=>sum+(s.score||0),0)/ts.length) : null;
      return {...t, attemptCount:ts.length, avgScore:avg};
    });

    const modeLabel = (t) => {
      if(t.testMode==='unscramble') return '<span class="badge" style="background:#fff8e1;color:#b45309;border:1px solid #ffe082;">🔀 언스크램블</span>';
      return '<span class="badge badge-teal">📝 단어시험</span>';
    };

    el.innerHTML = testsWithStats.map((t,i)=>`
      <tr style="cursor:pointer;" onclick="toggleTestProgress('${t.id}',this)" id="test-row-${t.id}">
        <td onclick="event.stopPropagation()"><input type="checkbox" value="${t.id}"></td>
        <td>${i+1}</td>
        <td style="font-weight:600;color:var(--teal);">${esc(t.name)||'-'}</td>
        <td>${modeLabel(t)}</td>
        <td><span class="badge badge-teal">${t.targetName||'-'}</span></td>
        <td style="font-size:12px;">${t.bookName||'-'}</td>
        <td style="text-align:center;">${t.count||0}문제</td>
        <td style="color:var(--gray);font-size:12px;">${t.date||''}</td>
        <td style="text-align:center;font-weight:600;color:var(--blue);">${t.attemptCount||0}</td>
        <td style="text-align:center;">
          ${t.avgScore!==null?`<span class="badge ${t.avgScore>=80?'badge-green':t.avgScore>=60?'badge-amber':'badge-red'}">${t.avgScore}점</span>`:'-'}
        </td>
      </tr>
      <tr id="progress-${t.id}" style="display:none;background:#f0faff;">
        <td colspan="10" style="padding:0;border-top:none;">
          <div id="progress-content-${t.id}" style="padding:14px 16px 14px 48px;font-size:12px;color:#bbb;">로딩 중...</div>
        </td>
      </tr>`).join('');

    // 페이지네이션 숨김
    const pgEl = document.getElementById('testPagination');
    if(pgEl) pgEl.innerHTML = `<span class="tbl-page-info">총 ${testsWithStats.length}개</span>`;
  }catch(e){el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';}
};

window.toggleTestProgress = async(testId) => {
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
    const testDoc = await getDoc(doc(db,'tests',testId));
    if(!testDoc.exists()){ contentEl.textContent='시험 데이터 없음'; return; }
    const t = testDoc.data();
    const targets = t.targets||[];

    // 대상 학생 목록
    let students = [];
    for(const tg of targets){
      if(tg.type==='student') students.push({uid:tg.id, name:tg.name, group:''});
      else {
        const gs = await getDocs(query(collection(db,'users'),where('group','==',tg.id)));
        gs.docs.filter(d=>d.data().role==='student').forEach(d=>
          students.push({uid:d.id, name:d.data().name, group:d.data().group||''})
        );
      }
    }
    const seen=new Set(); students=students.filter(s=>{if(seen.has(s.uid))return false;seen.add(s.uid);return true;});
    students.sort((a,b)=>(a.group+a.name).localeCompare(b.group+b.name,'ko'));

    // 완료 목록
    const compSnap = await getDocs(collection(db,'tests',testId,'userCompleted'));
    const compMap = {}; // uid → {score}
    compSnap.docs.forEach(d=>{ compMap[d.id]=d.data(); });

    // 점수 목록 (응시 여부 확인용)
    const scoreSnap = await getDocs(query(collection(db,'scores'),where('testId','==',testId)));
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
window.reprintTest = async(id) => {
  const snap = await getDoc(doc(db,'tests',id));
  const t = snap.data(); if(!t) return;
  printExamPDF(t.words||[], t.name, t.academy||'큰소리영어', t.date, 'both', t.qType||'both');
};
window.deleteTest = async(id) => {
  if(!(await showConfirm('시험을 삭제할까요?')))return;
  await deleteDoc(doc(db,'tests',id));
  showToast('삭제됐어요.'); await loadTestList();
};

// ── 엑셀 내보내기 ────────────────────────────────────────
window.exportStudentExcel = async(status='active') => {
  try{
    const snap = await getDocs(query(collection(db,'users'),where('role','==','student'),where('status','==',status)));
    const students = snap.docs.map(d=>({id:d.id,...d.data()}));
    if(!students.length){showToast('내보낼 학생이 없습니다.');return;}

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
    const today = new Date().toISOString().slice(0,10);
    XLSX.writeFile(wb, `큰소리영어_${statusLabel[status]}_${today}.xlsx`);
    showToast(`✅ ${statusLabel[status]} ${students.length}명 엑셀 다운로드 완료!`);
  }catch(e){ showToast('내보내기 실패: '+e.message); }
};

// ── 클래스 수정 ──────────────────────────────────────────
window.editClass = async(id) => {
  const snap = await getDoc(doc(db,'groups',id));
  const g = snap.data(); if(!g) return;
  showModal(`
    <div style="font-size:17px;font-weight:700;margin-bottom:20px;">반 수정</div>
    <div style="display:flex;flex-direction:column;gap:12px;font-size:13px;">
      <div><div style="color:var(--gray);margin-bottom:4px;">반 이름 *</div>
      <input id="editClassName" type="text" value="${esc(g.name||'')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:4px;">담당 선생님</div>
      <input id="editClassTeacher" type="text" value="${esc(g.teacher||'')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:20px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="updateClass('${id}')" style="flex:1;justify-content:center;">저장</button>
    </div>
  `);
};
window.updateClass = async(id) => {
  const name = document.getElementById('editClassName').value.trim();
  const teacher = document.getElementById('editClassTeacher').value.trim();
  if(!name){showToast('반 이름을 입력하세요.');return;}
  await updateDoc(doc(db,'groups',id),{name,teacher});
  closeModal(); showToast('✅ 반 정보가 수정됐어요!'); await loadClasses();
};

// ── 학생 수정 ────────────────────────────────────────────
window.editStudent = async(id) => {
  const snap = await getDoc(doc(db,'users',id));
  const u = snap.data(); if(!u) return;
  const classSnap = await getDocs(collection(db,'groups'));
  const opts = classSnap.docs.map(d=>`<option value="${esc(d.data().name)}" ${u.group===d.data().name?'selected':''}>${esc(d.data().name)}</option>`).join('');
  showModal(`
    <div style="font-size:17px;font-weight:700;margin-bottom:20px;">학생 정보 수정</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">
      <div><div style="color:var(--gray);margin-bottom:3px;">아이디</div>
      <input type="text" value="${u.username||''}" disabled style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:#f5f5f5;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">이름 *</div>
      <input id="euName" type="text" value="${u.name||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">반</div>
      <select id="euGroup" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${opts}</select></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">생일</div>
      <input id="euBirth" type="date" value="${u.birth||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">학교</div>
      <input id="euSchool" type="text" value="${u.school||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">학년</div>
      <input id="euGrade" type="text" value="${u.grade||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">연락처</div>
      <input id="euPhone" type="tel" value="${u.phone||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">새 비밀번호</div>
      <input id="euPw" type="password" placeholder="변경 시만 입력" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">부모님 성함</div>
      <input id="euParentName" type="text" value="${u.parentName||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="color:var(--gray);margin-bottom:3px;">부모님 연락처</div>
      <input id="euParentPhone" type="tel" value="${u.parentPhone||''}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:20px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="updateStudent('${id}')" style="flex:2;justify-content:center;">저장</button>
    </div>
  `);
};
window.updateStudent = async(id) => {
  const name = document.getElementById('euName').value.trim();
  if(!name){showToast('이름을 입력하세요.');return;}
  const data = {
    name, group:document.getElementById('euGroup').value,
    birth:document.getElementById('euBirth').value,
    school:document.getElementById('euSchool').value.trim(),
    grade:document.getElementById('euGrade').value.trim(),
    phone:document.getElementById('euPhone').value.trim(),
    parentName:document.getElementById('euParentName').value.trim(),
    parentPhone:document.getElementById('euParentPhone').value.trim(),
  };
  await updateDoc(doc(db,'users',id), data);
  closeModal(); showToast('✅ 학생 정보가 수정됐어요!');
  await loadStudents(currentPage==='student-pause'?'pause':currentPage==='student-out'?'out':'active');
};

// ── 공지 수정 ────────────────────────────────────────────
window.editNotice = async(id) => {
  const snap = await getDoc(doc(db,'notices',id));
  const n = snap.data(); if(!n) return;
  const classSnap = await getDocs(collection(db,'groups'));
  const opts = '<option value="all" '+(n.target==='all'?'selected':'')+'>전체</option>'
    + classSnap.docs.map(d=>`<option value="${esc(d.data().name)}" ${n.target===d.data().name?'selected':''}>${esc(d.data().name)}</option>`).join('');
  showModal(`
    <div style="font-size:17px;font-weight:700;margin-bottom:20px;">공지 수정</div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div><div style="font-size:13px;color:var(--gray);margin-bottom:4px;">대상</div>
      <select id="enTarget" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${opts}</select></div>
      <div><div style="font-size:13px;color:var(--gray);margin-bottom:4px;">제목 *</div>
      <input id="enTitle" type="text" value="${(n.title||'').replace(/"/g,'&quot;')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      <div><div style="font-size:13px;color:var(--gray);margin-bottom:4px;">내용 *</div>
      <textarea id="enContent" rows="5" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;resize:none;outline:none;">${esc(n.content)||''}</textarea></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:20px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="updateNotice('${id}')" style="flex:1;justify-content:center;">저장</button>
    </div>
  `);
};
window.updateNotice = async(id) => {
  const title = document.getElementById('enTitle').value.trim();
  const content = document.getElementById('enContent').value.trim();
  const target = document.getElementById('enTarget').value;
  if(!title||!content){showToast('제목과 내용을 입력하세요.');return;}
  await updateDoc(doc(db,'notices',id),{title,content,target});
  closeModal(); showToast('✅ 공지가 수정됐어요!'); await loadNotices();
};

// ── 테스트 출제 ──────────────────────────────────────────
let testData = { targetType:'class', targetId:'', targetName:'', bookId:'', bookName:'', unitIds:[], words:[], examName:'', mix:true, qType:'both', count:20 };

window.goPage_testCreate = async() => {
  testData = { targetType:'class', targetId:'', targetName:'', bookId:'', bookName:'', unitIds:[], words:[], examName:'', mix:true, qType:'both', count:20 };
  goPage('test-create');
  await renderTestStep1();
};

window.renderTestStep2 = async function(){
  updateStepUI(2);
  // 초기화
  testData.unitIds = []; testData.unitNames = []; testData.words = [];
  document.getElementById('testStep1Content').innerHTML = `
    <div style="font-size:14px;font-weight:600;margin-bottom:16px;">② 교재 / Unit 선택</div>
    <div style="display:grid;grid-template-columns:1fr 320px;gap:16px;">
      <!-- 폴더→교재→Unit 트리 -->
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;max-height:420px;">
        <div style="padding:10px 14px;background:#f8f9fa;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;">
          <span>📁 폴더 / 교재 / Unit</span>
          <input type="text" id="testBookSearch" placeholder="🔍 검색..." oninput="filterTestBookTree(this.value)"
            style="border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:12px;outline:none;width:130px;">
        </div>
        <div id="testBookTree" style="overflow-y:auto;flex:1;">
          <div style="padding:20px;text-align:center;color:#bbb;font-size:13px;">로딩 중...</div>
        </div>
      </div>
      <!-- 선택된 Unit 목록 + 단어수 -->
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;flex:1;">
          <div style="padding:10px 14px;background:#f8f9fa;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;display:flex;justify-content:space-between;align-items:center;">
            <span>✅ 선택된 Unit</span>
            <button onclick="clearTestUnitSelection()" style="background:none;border:none;color:#bbb;font-size:11px;cursor:pointer;">전체 해제</button>
          </div>
          <div id="testSelectedUnitList" style="padding:8px;max-height:300px;overflow-y:auto;font-size:13px;color:#bbb;min-height:60px;">
            Unit을 선택하세요
          </div>
        </div>
        <div style="padding:10px 14px;background:#f0fafa;border:1px solid var(--teal-light);border-radius:8px;font-size:13px;text-align:center;">
          선택된 단어: <b id="testWordCount" style="color:var(--teal);font-size:16px;">0</b>개
        </div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="renderTestStep1()">← 이전</button>
      <button class="btn btn-primary" onclick="testStep2Next()">다음 → 문제 구성</button>
    </div>`;

  // 트리 로드
  try{
    const treeData = await buildFolderBookTree();
    window._testTreeData = treeData;
    document.getElementById('testBookTree').innerHTML = renderTestFolderTree(treeData);
  }catch(e){
    document.getElementById('testBookTree').innerHTML = `<div style="padding:16px;color:#e05050;">${e.message}</div>`;
  }
};

// 시험출제 전용 트리 렌더 (폴더→교재→Unit 체크박스)
function renderTestFolderTree(treeData){
  const {folders, folderMap, unassigned} = treeData;
  let html = '';

  const renderUnitRows = (b) => b.units.map(u=>`
    <div style="display:flex;align-items:center;gap:8px;padding:7px 12px 7px 52px;border-bottom:1px solid #f5f5f5;cursor:pointer;"
      onclick="toggleTestUnit('${b.id}','${b.name.replace(/'/g,"\\'")}','${u.id}','${u.name.replace(/'/g,"\\'")}',${JSON.stringify(u.words||[]).replace(/"/g,'&quot;')})">
      <input type="checkbox" id="tc-uchk-${u.id}"
        onclick="event.stopPropagation();toggleTestUnit('${b.id}','${b.name.replace(/'/g,"\\'")}','${u.id}','${u.name.replace(/'/g,"\\'")}',${JSON.stringify(u.words||[]).replace(/"/g,'&quot;')})"
        style="cursor:pointer;">
      <span style="flex:1;font-size:13px;">${u.name}</span>
      <span style="font-size:11px;color:#aaa;flex-shrink:0;">${u.words?.length||0}개</span>
    </div>`).join('');

  const renderBookNode = (b, indent) => `
    <div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px 8px ${indent}px;background:#fafffe;border-bottom:1px solid #f0f0f0;cursor:pointer;"
        onclick="toggleTreeNode('tc-b-${b.id}','tc-bt-${b.id}')">
        <span id="tc-bt-${b.id}" style="font-size:11px;color:#aaa;transition:.2s;">›</span>
        <input type="checkbox" id="tc-bchk-${b.id}"
          onclick="event.stopPropagation();testCheckBook('${b.id}')"
          style="cursor:pointer;">
        <span style="font-size:13px;font-weight:600;flex:1;white-space:nowrap;">📘 ${esc(b.name)}</span>
        <span style="font-size:11px;color:#aaa;flex-shrink:0;">${b.units.length}Unit</span>
      </div>
      <div id="tc-b-${b.id}" style="display:none;">${renderUnitRows(b)}</div>
    </div>`;

  folders.forEach(f=>{
    const fBooks = folderMap[f.id]?.books||[];
    if(!fBooks.length) return;
    html += `
      <div>
        <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:#f0f4f8;border-bottom:1px solid var(--border);cursor:pointer;"
          onclick="toggleTreeNode('tc-f-${f.id}','tc-ft-${f.id}')">
          <span id="tc-ft-${f.id}" style="font-size:11px;color:#aaa;transition:.2s;">›</span>
          <input type="checkbox" id="tc-fchk-${f.id}"
            onclick="event.stopPropagation();testCheckFolder('${f.id}')"
            style="cursor:pointer;">
          <span style="font-weight:700;font-size:13px;flex:1;white-space:nowrap;">📁 ${esc(f.name)}</span>
          <span style="font-size:11px;color:#aaa;flex-shrink:0;">${fBooks.length}교재</span>
        </div>
        <div id="tc-f-${f.id}" style="display:none;">
          ${fBooks.map(b=>renderBookNode(b,28)).join('')}
        </div>
      </div>`;
  });

  if(unassigned.length){
    // My Book은 항상 폴더에 배정 - 미배정 교재 표시 안 함
  }

  return html || '<div style="padding:16px;text-align:center;color:#bbb;">교재가 없습니다</div>';
}

// 시험출제 트리 - 폴더 전체 체크
window.testCheckFolder = (folderId) => {
  const cb = document.getElementById('tc-fchk-'+folderId);
  const books = folderId==='unassigned'
    ? (window._treeBooks||[]).filter(b=>!b.folderId)
    : (window._treeBooks||[]).filter(b=>b.folderId===folderId);
  books.forEach(b=>{
    const bcb = document.getElementById('tc-bchk-'+b.id);
    if(bcb) bcb.checked = cb.checked;
    b.units.forEach(u=>{
      const ucb = document.getElementById('tc-uchk-'+u.id);
      if(ucb) ucb.checked = cb.checked;
    });
    if(cb.checked){
      const el=document.getElementById('tc-b-'+b.id);
      const t=document.getElementById('tc-bt-'+b.id);
      if(el){el.style.display='';if(t)t.style.transform='rotate(90deg)';}
    }
  });
  if(cb.checked){
    const el=document.getElementById('tc-f-'+folderId);
    const t=document.getElementById('tc-ft-'+folderId);
    if(el){el.style.display='';if(t)t.style.transform='rotate(90deg)';}
  }
  rebuildTestData();
};

// 시험출제 트리 - 교재 전체 체크
window.testCheckBook = (bookId) => {
  const cb = document.getElementById('tc-bchk-'+bookId);
  const book = (window._treeBooks||[]).find(b=>b.id===bookId);
  if(!book) return;
  book.units.forEach(u=>{
    const ucb = document.getElementById('tc-uchk-'+u.id);
    if(ucb) ucb.checked = cb.checked;
  });
  if(cb.checked){
    const el=document.getElementById('tc-b-'+bookId);
    const t=document.getElementById('tc-bt-'+bookId);
    if(el){el.style.display='';if(t)t.style.transform='rotate(90deg)';}
  }
  rebuildTestData();
};

// 시험출제 트리 - Unit 개별 체크
window.toggleTestUnit = (bookId, bookName, unitId, unitName, words) => {
  const cb = document.getElementById('tc-uchk-'+unitId);
  cb.checked = !cb.checked;
  rebuildTestData();
};

// 체크된 Unit을 수집해서 testData 재구성
function rebuildTestData(){
  testData.unitIds = []; testData.unitNames = []; testData.words = [];
  testData.bookId = ''; testData.bookName = '';

  const books = window._treeBooks || [];
  const selectedUnits = [];

  books.forEach(b=>{
    b.units.forEach(u=>{
      const cb = document.getElementById('tc-uchk-'+u.id);
      if(cb?.checked){
        selectedUnits.push({bookId:b.id, bookName:b.name, unitId:u.id, unitName:u.name, words:u.words||[]});
        testData.unitIds.push(u.id);
        testData.unitNames.push(u.name);
        testData.words.push(...(u.words||[]));
      }
    });
  });

  // 대표 교재명 (첫 번째 선택 교재)
  if(selectedUnits.length){
    testData.bookId = selectedUnits[0].bookId;
    testData.bookName = selectedUnits[0].bookName;
  }

  // 선택된 Unit 태그 표시
  const listEl = document.getElementById('testSelectedUnitList');
  const countEl = document.getElementById('testWordCount');
  if(listEl){
    if(!selectedUnits.length){
      listEl.innerHTML='<span style="color:#bbb;">Unit을 선택하세요</span>';
    } else {
      listEl.innerHTML = selectedUnits.map(u=>`
        <div style="display:flex;align-items:center;gap:6px;padding:5px 6px;border-bottom:1px solid #f5f5f5;font-size:12px;">
          <span style="color:var(--teal);">📘</span>
          <span style="flex:1;">${u.bookName} › ${u.unitName}</span>
          <span style="color:#aaa;">${u.words.length}개</span>
        </div>`).join('');
    }
  }
  if(countEl) countEl.textContent = testData.words.length;
}

window.clearTestUnitSelection = () => {
  document.querySelectorAll('[id^="tc-uchk-"],[id^="tc-bchk-"],[id^="tc-fchk-"]').forEach(cb=>cb.checked=false);
  rebuildTestData();
};

window.filterTestBookTree = (q) => {
  const lq = q.toLowerCase();
  (window._treeBooks||[]).forEach(b=>{
    const match = !lq || b.name.toLowerCase().includes(lq) || b.units.some(u=>u.name.toLowerCase().includes(lq));
    const el = document.getElementById('tc-b-'+b.id)?.parentElement;
    if(el) el.style.display = match ? '' : 'none';
    if(lq && match){
      const bel=document.getElementById('tc-b-'+b.id); const bt=document.getElementById('tc-bt-'+b.id);
      if(bel){bel.style.display='';if(bt)bt.style.transform='rotate(90deg)';}
    }
  });
};

window.selectTestBook = async() => {}; // 구버전 호환용

window.testStep2Next = () => {
  if(!testData.unitIds.length){showToast('Unit을 선택하세요.');return;}
  if(testData.words.length < 4){showToast('단어가 최소 4개 이상 필요합니다.');return;}
  const unitPart = (testData.unitNames||[]).join(', ');
  testData.defaultExamName = testData.bookName + (unitPart ? ' ' + unitPart : '');
  renderTestStep3();
};

window.renderTestStep3 = function(){
  updateStepUI(3);
  const allWords = testData.words;
  const maxCount = allWords.length;

  const spellableCount = allWords.length;
  const defaultCount = Math.min(20, maxCount);

  // testData 초기화
  testData.spellRatio = testData.spellRatio || 30; // 기본 스펠링 30%

  document.getElementById('testStep1Content').innerHTML = `
    <div style="font-size:14px;font-weight:600;margin-bottom:20px;">③ 문제 구성</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">

      <!-- 왼쪽: 문제 유형 + 스펠링 비율 -->
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div>
          <div style="font-size:13px;color:var(--gray);margin-bottom:8px;font-weight:600;">문제 방향</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:10px 12px;border:1px solid var(--border);border-radius:8px;">
              <input type="radio" name="qtype" value="both" checked onchange="testData.qType=this.value"> 혼합 (영→한 + 한→영)
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:10px 12px;border:1px solid var(--border);border-radius:8px;">
              <input type="radio" name="qtype" value="en2ko" onchange="testData.qType=this.value"> 영→한 (영어 보고 한글 고르기)
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:10px 12px;border:1px solid var(--border);border-radius:8px;">
              <input type="radio" name="qtype" value="ko2en" onchange="testData.qType=this.value"> 한→영 (한글 보고 영어 고르기)
            </label>
          </div>
        </div>

        <div>
          <div style="font-size:13px;color:var(--gray);margin-bottom:8px;font-weight:600;">
            스펠링 비율
            ${spellableCount===0?'<span style="color:#e05050;font-size:11px;font-weight:400;">(단일단어 없음 - 사용불가)</span>':''}
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
              <span style="font-size:12px;color:var(--gray);width:60px;">4지선다</span>
              <input type="range" id="spellRatioSlider" min="0" max="100" step="10" value="${testData.spellRatio}"
                oninput="updateSpellRatio(this.value)"
                style="flex:1;accent-color:var(--teal);">
              <span style="font-size:12px;color:var(--gray);width:50px;">스펠링</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div style="font-size:13px;">
                4지선다 <b id="mcRatioDisplay" style="color:var(--teal);">${100-testData.spellRatio}%</b>
                &nbsp;+&nbsp;
                스펠링 <b id="spellRatioDisplay" style="color:var(--blue);">${testData.spellRatio}%</b>
              </div>
            </div>
            <div style="margin-top:8px;background:#f8f9fa;border-radius:6px;padding:8px 10px;font-size:12px;color:var(--gray);">
              전체 <b>${spellableCount}개</b> 단어 모두 스펠링 출제 가능해요.
            </div>
          </div>
          ${spellableCount===0?`<div style="font-size:12px;color:#e05050;margin-top:4px;">선택한 단어 중 스펠링 출제 가능한 단어가 없어요.</div>`:''}
        </div>
      </div>

      <!-- 오른쪽: 문항 수 + 단어 분석 -->
      <div style="display:flex;flex-direction:column;gap:16px;">

        <!-- 언스크램블 토글 (최상단) -->
        <div style="background:#fff8e1;border:2px solid #ffe082;border-radius:10px;padding:12px 14px;">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
            <input type="checkbox" id="unscrambleCheck"
              onchange="toggleUnscrambleMode(this.checked)"
              ${testData.isUnscramble?'checked':''}
              style="width:18px;height:18px;cursor:pointer;">
            <div>
              <div style="font-size:13px;font-weight:700;color:#b45309;">🔀 언스크램블 문제</div>
              <div style="font-size:11px;color:#92400e;margin-top:2px;">단어(문장)를 섞어놓고 순서대로 클릭하는 문제</div>
            </div>
          </label>
          <!-- 언스크램블 전용 순서 섞기 옵션 -->
          <div id="unscrambleMixOption" style="margin-top:10px;padding-top:10px;border-top:1px solid #ffe082;display:${testData.isUnscramble?'block':'none'};">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;color:#92400e;">
              <input type="checkbox" id="unscrambleMixCheck" ${testData.mix!==false?'checked':''} onchange="testData.mix=this.checked">
              문제 출제 순서 랜덤하게 섞기
            </label>
          </div>
        </div>

        <!-- 일반 문제 구성 (언스크램블 선택 시 비활성) -->
        <div id="normalTestOptions">
          <div style="margin-bottom:16px;">
            <div style="font-size:13px;color:var(--gray);margin-bottom:8px;font-weight:600;">문항 수</div>
            <div style="display:flex;align-items:center;gap:10px;font-size:13px;">
              <input type="number" id="testCount" value="${defaultCount}" min="4" max="${maxCount}"
                onchange="testData.count=parseInt(this.value)||20;updateSpellPreview()"
                style="border:1px solid var(--border);border-radius:6px;padding:8px 12px;width:80px;font-size:14px;font-weight:600;outline:none;text-align:center;">
              <span style="color:#bbb;">/ 최대 ${maxCount}개</span>
            </div>
          </div>
          <div style="margin-bottom:16px;">
            <div style="font-size:13px;color:var(--gray);margin-bottom:8px;font-weight:600;">옵션</div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
              <input type="checkbox" id="mixCheck" checked onchange="testData.mix=this.checked"> 문제 순서 섞기
            </label>
          </div>
          <!-- 문제 구성 미리보기 -->
          <div style="background:#f0fafa;border:1px solid var(--teal-light);border-radius:10px;padding:14px;margin-bottom:0;">
            <div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:10px;">📊 문제 구성 미리보기</div>
            <div id="spellPreview" style="font-size:13px;line-height:2;"></div>
          </div>
        </div>

        <div>
          <div style="font-size:13px;color:var(--gray);margin-bottom:8px;font-weight:600;">
            통과 점수 <span style="font-weight:400;font-size:11px;">(이 점수 이상이면 시험 완료 처리)</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="number" id="passScore" value="${testData.passScore||80}" min="0" max="100"
              style="border:1px solid var(--border);border-radius:6px;padding:8px 12px;width:80px;font-size:14px;font-weight:600;outline:none;text-align:center;">
            <span style="color:#bbb;">점 이상</span>
            <span style="font-size:12px;color:var(--teal);padding:3px 8px;background:#e0f5f5;border-radius:10px;">기본 80점</span>
          </div>
        </div>

        <!-- 선택된 단어/문장 목록 미리보기 -->
        <div style="background:#f8f9fa;border-radius:8px;padding:10px 12px;max-height:160px;overflow-y:auto;">
          <div style="font-size:11px;font-weight:600;color:var(--gray);margin-bottom:6px;">선택된 단어/문장 목록</div>
          ${allWords.slice(0,20).map(w=>`
            <div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px solid #eee;">
              <span>${w.en}</span>
              <span style="color:var(--gray);">${w.ko}</span>
            </div>`).join('')}
          ${allWords.length>20?`<div style="text-align:center;color:#bbb;font-size:11px;margin-top:4px;">... 외 ${allWords.length-20}개</div>`:''}
        </div>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-top:24px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="renderTestStep2()">← 이전</button>
      <button class="btn btn-primary" onclick="goStep4FromStep3()">다음 → 출제 확인</button>
    </div>
  `;

  // 초기 미리보기 업데이트
  testData.count = defaultCount;
  updateSpellPreview();
};

// ── 스펠링 비율 업데이트 ─────────────────────────────────
window.updateSpellRatio = (val) => {
  testData.spellRatio = parseInt(val)||0;
  const mc = 100 - testData.spellRatio;
  const el1 = document.getElementById('mcRatioDisplay');
  const el2 = document.getElementById('spellRatioDisplay');
  if(el1) el1.textContent = mc+'%';
  if(el2) el2.textContent = testData.spellRatio+'%';
  updateSpellPreview();
};

window.updateSpellPreview = () => {
  const el = document.getElementById('spellPreview');
  if(!el) return;
  const count = parseInt(document.getElementById('testCount')?.value) || testData.count || 20;
  testData.count = count;
  const ratio = testData.spellRatio || 0;

  // 모든 단어 스펠링 가능
  const spellCount = ratio > 0 ? Math.round(count * ratio / 100) : 0;
  const mcCount = count - spellCount;

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <div style="width:12px;height:12px;border-radius:50%;background:var(--teal);flex-shrink:0;"></div>
      <span>4지선다: <b style="color:var(--teal);">${mcCount}문제</b></span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <div style="width:12px;height:12px;border-radius:50%;background:var(--blue);flex-shrink:0;"></div>
      <span>스펠링: <b style="color:var(--blue);">${spellCount}문제</b>
        ${ratio>0&&spellCount<Math.round(count*ratio/100)?
          '<span style="font-size:11px;color:#f59e0b;">(단일단어 부족으로 조정됨)</span>':''}
      </span>
      </span>
    </div>
    <div style="height:10px;border-radius:5px;overflow:hidden;background:#eee;display:flex;">
      <div style="width:${mcCount/count*100}%;background:var(--teal);transition:.3s;"></div>
      <div style="width:${spellCount/count*100}%;background:var(--blue);transition:.3s;"></div>
    </div>`;
};

window.toggleUnscrambleMode = (checked) => {
  testData.isUnscramble = checked;
  const el = document.getElementById('normalTestOptions');
  if(el){ el.style.opacity = checked ? '0.35' : '1'; el.style.pointerEvents = checked ? 'none' : ''; }
  const mixOpt = document.getElementById('unscrambleMixOption');
  if(mixOpt) mixOpt.style.display = checked ? 'block' : 'none';
};

window.goStep4FromStep3 = () => {
  testData.isUnscramble = document.getElementById('unscrambleCheck')?.checked || false;
  testData.count = parseInt(document.getElementById('testCount')?.value)||20;
  // 언스크램블이면 전용 mix 체크박스, 일반이면 기본 mix 체크박스
  testData.mix = testData.isUnscramble
    ? (document.getElementById('unscrambleMixCheck')?.checked ?? true)
    : (document.getElementById('mixCheck')?.checked ?? true);
  testData.qType = document.querySelector('input[name=qtype]:checked')?.value || 'both';
  testData.spellRatio = parseInt(document.getElementById('spellRatioSlider')?.value)||0;
  testData.passScore = parseInt(document.getElementById('passScore')?.value)||80;
  renderTestStep4();
};

window.renderTestStep4 = function(){
  updateStepUI(4);
  const qTypeLabel = {both:'영→한 + 한→영', en2ko:'영→한', ko2en:'한→영'}[testData.qType]||'혼합';
  const targetList = (testData.targets||[]).map(t=>`
    <span style="display:inline-flex;align-items:center;gap:4px;background:var(--teal-light);color:var(--teal-dark);padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;margin:2px;">
      ${t.type==='class'?'👥':'👤'} ${esc(t.name)}
    </span>`).join('') || `<span style="color:var(--teal);font-weight:600;">${testData.targetName}</span>`;

  const spellCount = testData.spellRatio > 0 ? Math.round(testData.count * testData.spellRatio / 100) : 0;
  const mcCount = testData.count - spellCount;

  document.getElementById('testStep1Content').innerHTML = `
    <div style="font-size:14px;font-weight:600;margin-bottom:16px;">④ 출제 확인</div>

    <div style="margin-bottom:16px;">
      <div style="font-size:13px;color:var(--gray);margin-bottom:6px;font-weight:600;">시험명 * <span style="font-weight:400;">(학생 앱에 표시될 이름)</span></div>
      <input id="ti_name" type="text" value="${testData.defaultExamName||''}" placeholder="예: Captain Awesome Unit 1" autofocus
        style="width:100%;border:2px solid var(--teal);border-radius:8px;padding:10px 14px;font-size:14px;outline:none;">
    </div>

    <div style="background:#f0fafa;border:1px solid var(--teal-light);border-radius:12px;padding:18px 20px;margin-bottom:20px;">
      <div style="font-size:13px;font-weight:700;color:var(--teal);margin-bottom:12px;">📋 출제 요약</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">
        <div>
          <div style="color:var(--gray);font-size:11px;margin-bottom:3px;">시험 대상</div>
          <div style="flex-wrap:wrap;display:flex;gap:2px;">${targetList}</div>
        </div>
        <div>
          <div style="color:var(--gray);font-size:11px;margin-bottom:3px;">교재</div>
          <div style="font-weight:600;">📘 ${testData.bookName||'-'}</div>
        </div>
        <div>
          <div style="color:var(--gray);font-size:11px;margin-bottom:3px;">문제 유형</div>
          <div style="font-weight:600;">${qTypeLabel}</div>
        </div>
        <div>
          <div style="color:var(--gray);font-size:11px;margin-bottom:3px;">문항 구성</div>
          <div style="font-weight:600;">
            4지선다 <span style="color:var(--teal);">${mcCount}문제</span>
            ${spellCount>0?' + 스펠링 <span style="color:var(--blue);">'+spellCount+'문제</span>':''}
          </div>
        </div>
        <div>
          <div style="color:var(--gray);font-size:11px;margin-bottom:3px;">총 문항</div>
          <div style="font-weight:600;">${testData.count}문제</div>
        </div>
        <div>
          <div style="color:var(--gray);font-size:11px;margin-bottom:3px;">문제 섞기</div>
          <div style="font-weight:600;">${testData.mix?'✅ 사용':'❌ 미사용'}</div>
        </div>
        <div>
          <div style="color:var(--gray);font-size:11px;margin-bottom:3px;">통과 점수</div>
          <div style="font-weight:600;color:var(--teal);">${testData.passScore||80}점 이상</div>
        </div>
        ${testData.isUnscramble?`
        <div style="grid-column:1/-1;">
          <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:700;color:#b45309;">
            🔀 언스크램블 모드 — 문장 순서 맞추기 문제
          </div>
        </div>`:''}
      </div>
    </div>

    <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:12px 14px;font-size:13px;margin-bottom:20px;display:flex;gap:8px;align-items:flex-start;">
      <span style="font-size:18px;">📱</span>
      <div>
        <div style="font-weight:600;margin-bottom:3px;">출제하면 학생 앱에 즉시 표시됩니다</div>
        <div style="color:var(--gray);">대상 학생이 로그인하면 시험 목록에 나타나요. 시험지 PDF 출력은 <b>시험지 출력</b> 메뉴에서 할 수 있어요.</div>
      </div>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="renderTestStep3()">← 이전</button>
      <button class="btn btn-primary" id="publishTestBtn" onclick="publishTest()"
        style="min-width:160px;justify-content:center;font-size:14px;padding:10px 20px;">
        🚀 출제하기
      </button>
    </div>
  `;
};

window.updateStepUI = function(step){
  [1,2,3,4].forEach(i=>{
    const el = document.getElementById('sti-'+i);
    if(!el) return;
    const circle = el.querySelector('.step-circle');
    if(i < step){ el.style.color='var(--teal)'; circle.style.background='var(--teal)'; circle.style.color='white'; circle.innerHTML='✓'; }
    else if(i === step){ el.style.color='var(--teal)'; circle.style.background='var(--teal)'; circle.style.color='white'; circle.innerHTML=i; }
    else { el.style.color='var(--gray)'; circle.style.background='#eee'; circle.style.color='var(--gray)'; circle.innerHTML=i; }
  });
}

// ── 시험 출제 (학생 앱에 배포) ───────────────────────────
window.publishTest = async() => {
  const examName = document.getElementById('ti_name')?.value.trim();
  if(!examName){ showToast('시험명을 입력하세요.'); document.getElementById('ti_name')?.focus(); return; }

  const btn = document.getElementById('publishTestBtn');
  if(btn){ btn.textContent='출제 중...'; btn.disabled=true; }

  // 문제 생성 - 스펠링 비율 반영하여 분류
  const spellRatio = testData.spellRatio || 0;
  let allWords = [...testData.words];
  if(testData.mix) allWords = allWords.sort(()=>Math.random()-0.5);
  allWords = allWords.slice(0, testData.count);

  // 모든 단어 스펠링 가능
  const spellCount = spellRatio > 0 ? Math.round(allWords.length * spellRatio / 100) : 0;
  const shuffledAll = [...allWords].sort(()=>Math.random()-0.5);
  const spellWords = shuffledAll.slice(0, spellCount).map(w=>({...w, testType:'spelling'}));
  const mcWords = shuffledAll.slice(spellCount).map(w=>({...w, testType:'meaning'}));
  let finalWords = [...spellWords, ...mcWords];
  if(testData.mix) finalWords = finalWords.sort(()=>Math.random()-0.5);

  const today = new Date().toISOString().slice(0,10);

  try{
    await addDoc(collection(db,'tests'),{
      name: examName,
      academy: '큰소리영어',
      date: today,
      targetType: testData.targetType,
      targetId: testData.targetId,
      targetName: testData.targetName,
      targets: testData.targets||[],
      bookId: testData.bookId,
      bookName: testData.bookName,
      unitIds: testData.unitIds,
      qType: testData.qType,
      spellRatio,
      spellCount,
      count: finalWords.length,
      mix: testData.mix,
      words: finalWords.map(w=>({en:w.en, ko:w.ko, testType:w.testType})),
      active: true,
      passScore: testData.passScore||80,
      testMode: testData.isUnscramble ? 'unscramble' : 'word',
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });

    // 성공 화면
    document.getElementById('testStep1Content').innerHTML = `
      <div style="text-align:center;padding:40px 20px;">
        <div style="font-size:56px;margin-bottom:16px;">🎉</div>
        <div style="font-size:20px;font-weight:700;margin-bottom:8px;">출제 완료!</div>
        <div style="font-size:14px;color:var(--gray);margin-bottom:16px;">
          <b>${examName}</b> 시험이 출제됐어요.<br>
          대상 학생이 앱에 로그인하면 시험 목록에 표시됩니다.
        </div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:20px;">
          <div style="background:#f0fafa;border:1px solid var(--teal-light);border-radius:8px;padding:10px 16px;font-size:13px;">
            4지선다 <b style="color:var(--teal);">${finalWords.filter(w=>w.testType==='meaning').length}문제</b>
          </div>
          <div style="background:#e0eeff;border:1px solid #b3ccff;border-radius:8px;padding:10px 16px;font-size:13px;">
            스펠링 <b style="color:var(--blue);">${finalWords.filter(w=>w.testType==='spelling').length}문제</b>
          </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
          <button class="btn btn-secondary" onclick="goPage_testCreate()" style="padding:10px 20px;">+ 새 시험 출제</button>
          <button class="btn btn-secondary" onclick="goPage('test-list')" style="padding:10px 20px;">📋 시험 목록</button>
          <button class="btn btn-primary" onclick="printPublishedTest()" style="padding:10px 20px;">🖨 시험지 PDF 출력</button>
        </div>
      </div>`;

    // 스텝바 완료
    [1,2,3,4].forEach(i=>{
      const el = document.getElementById('sti-'+i); if(!el) return;
      const circle = el.querySelector('.step-circle');
      el.style.color='var(--teal)'; circle.style.background='var(--teal)'; circle.style.color='white'; circle.innerHTML='✓';
    });

    // 출력용 단어 저장
    testData._publishedWords = finalWords;
    testData._publishedName = examName;

  }catch(e){
    showToast('❌ 출제 실패: '+e.message);
    if(btn){ btn.textContent='🚀 출제하기'; btn.disabled=false; }
  }
};

// 출제 후 바로 PDF 출력
window.printPublishedTest = () => {
  const words = testData._publishedWords || testData.words;
  const name = testData._publishedName || testData.examName || '시험';
  showModal(`
    <div style="font-size:17px;font-weight:700;margin-bottom:20px;">🖨 시험지 출력 설정</div>
    <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;margin-bottom:20px;">
      <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;">
        <input type="radio" name="prtType" value="both" checked> 시험지 + 답안지
      </label>
      <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;">
        <input type="radio" name="prtType" value="exam"> 시험지만
      </label>
      <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;">
        <input type="radio" name="prtType" value="answer"> 답안지만
      </label>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="doFinalPrint()" style="flex:2;justify-content:center;">출력</button>
    </div>
  `);
};
window.doFinalPrint = () => {
  const ptype = document.querySelector('input[name=prtType]:checked')?.value||'both';
  closeModal();
  printExamPDF(
    testData._publishedWords||testData.words,
    testData._publishedName||'시험',
    '큰소리영어',
    new Date().toISOString().slice(0,10),
    ptype,
    testData.qType||'both'
  );
};


window.generateAndSaveTest = async() => {
  const examName = document.getElementById('ti_name')?.value.trim();
  const academy = document.getElementById('ti_academy')?.value.trim()||'큰소리영어';
  const date = document.getElementById('ti_date')?.value||new Date().toISOString().slice(0,10);
  const ptype = document.getElementById('ti_ptype')?.value||'both';
  if(!examName){showToast('시험명을 입력하세요.');return;}

  testData.examName = examName;

  // 문제 생성
  let words = [...testData.words];
  if(testData.mix) words = words.sort(()=>Math.random()-0.5);
  words = words.slice(0, testData.count);

  // Firestore에 시험 저장 (active:true = 학생앱에 표시)
  try{
    await addDoc(collection(db,'tests'),{
      name:examName, academy, date,
      targetType:testData.targetType, targetId:testData.targetId, targetName:testData.targetName,
      targets:testData.targets||[],
      bookId:testData.bookId, bookName:testData.bookName, unitIds:testData.unitIds,
      qType:testData.qType, count:words.length, mix:testData.mix,
      words:words.map(w=>({en:w.en,ko:w.ko})),
      active:true,
      passScore: testData.passScore||80,
      testMode: testData.isUnscramble ? 'unscramble' : 'word',
      createdAt:serverTimestamp(), createdBy:currentUser.uid
    });
    showToast('✅ 시험이 저장됐어요! 학생 앱에 표시됩니다.');
  }catch(e){ showToast('❌ 저장 실패: '+e.message); return; }

  // PDF 출력 창 열기
  printExamPDF(words, examName, academy, date, ptype, testData.qType);
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

// ── 공통: 폴더→교재→Unit 트리 빌더 ─────────────────────
async function buildFolderBookTree(){
  // 폴더 로드
  const folderSnap = await getDocs(query(collection(db,'folders'),orderBy('createdAt','asc')));
  const folders = folderSnap.docs.map(d=>({id:d.id,...d.data()}));
  // 교재 로드
  const bookSnap = await getDocs(query(collection(db,'books'),orderBy('createdAt','desc')));
  const books = bookSnap.docs.map(d=>({id:d.id,...d.data()}));
  // 교재별 Unit 로드
  const booksWithUnits = await Promise.all(books.map(async b=>{
    const uSnap = await getDocs(collection(db,'books',b.id,'units'));
    const units = uSnap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b2)=>(a.name||'').localeCompare(b2.name||'','ko'));
    return {...b, units};
  }));
  window._treeBooks = booksWithUnits;

  // 폴더별 그룹화
  const folderMap = {};
  folders.forEach(f=>{ folderMap[f.id]={...f, books:[]}; });
  const unassigned = [];
  booksWithUnits.forEach(b=>{
    if(b.folderId && folderMap[b.folderId]) folderMap[b.folderId].books.push(b);
    else unassigned.push(b);
  });

  return { folders, folderMap, unassigned, booksWithUnits };
}

// 트리 HTML 생성 (prefix: 'ws' or 'pt' for IDs)
function renderFolderTree(treeData, prefix){
  const { folders, folderMap, unassigned } = treeData;
  let html = '';

  // 폴더별 교재
  folders.forEach(f=>{
    const fBooks = folderMap[f.id]?.books || [];
    if(!fBooks.length) return; // 교재 없는 폴더 숨김
    html += `
      <div>
        <!-- 폴더 행 -->
        <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:#f0f4f8;border-bottom:1px solid var(--border);cursor:pointer;"
          onclick="toggleTreeNode('${prefix}-f-${f.id}','${prefix}-ft-${f.id}')">
          <span id="${prefix}-ft-${f.id}" style="font-size:11px;color:#aaa;display:inline-block;transition:.2s;">›</span>
          <input type="checkbox" id="${prefix}-fchk-${f.id}"
            onclick="event.stopPropagation();treeCheckFolder('${prefix}','${f.id}')"
            style="cursor:pointer;">
          <span style="font-weight:700;font-size:13px;flex:1;white-space:nowrap;">📁 ${esc(f.name)}</span>
          <span style="font-size:11px;color:#aaa;flex-shrink:0;">${fBooks.length}개 교재</span>
        </div>
        <!-- 폴더 내 교재 -->
        <div id="${prefix}-f-${f.id}" style="display:none;">
          ${fBooks.map(b=>renderBookNode(b, prefix, 1)).join('')}
        </div>
      </div>`;
  });

  // 폴더 미배정 교재 (숨김 - My Book은 항상 폴더에 배정)
  // 미배정 교재는 My Book 관리 페이지에서 폴더 이동 후 사용하세요.
  return html || '<div style="padding:16px;text-align:center;color:#bbb;font-size:13px;">교재가 없습니다</div>';
}

function renderBookNode(b, prefix, depth){
  const indent = depth * 16;
  return `
    <div>
      <!-- 교재 행 -->
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px 8px ${12+indent}px;background:#fafffe;border-bottom:1px solid #f0f0f0;cursor:pointer;"
        onclick="toggleTreeNode('${prefix}-b-${b.id}','${prefix}-bt-${b.id}')">
        <span id="${prefix}-bt-${b.id}" style="font-size:11px;color:#aaa;display:inline-block;transition:.2s;">›</span>
        <input type="checkbox" id="${prefix}-bchk-${b.id}"
          onclick="event.stopPropagation();treeCheckBook('${prefix}','${b.id}')"
          style="cursor:pointer;">
        <span style="font-size:13px;font-weight:600;flex:1;white-space:nowrap;">📘 ${esc(b.name)}</span>
        <span style="font-size:11px;color:#aaa;flex-shrink:0;">${b.units.length}Unit</span>
      </div>
      <!-- Unit 행 -->
      <div id="${prefix}-b-${b.id}" style="display:none;">
        ${b.units.map(u=>`
          <div style="display:flex;align-items:center;gap:8px;padding:7px 12px 7px ${12+indent+20}px;border-bottom:1px solid #f5f5f5;cursor:pointer;"
            onclick="treeCheckUnit('${prefix}','${b.id}','${u.id}')">
            <input type="checkbox" id="${prefix}-uchk-${u.id}"
              onclick="event.stopPropagation();treeCheckUnit('${prefix}','${b.id}','${u.id}')"
              style="cursor:pointer;">
            <span style="font-size:13px;flex:1;white-space:nowrap;">${u.name}</span>
            <span style="font-size:11px;color:#aaa;flex-shrink:0;">${u.words?.length||0}개</span>
          </div>`).join('')}
      </div>
    </div>`;
}

window.toggleTreeNode = (nodeId, toggleId) => {
  const el = document.getElementById(nodeId);
  const toggle = document.getElementById(toggleId);
  if(!el) return;
  const isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : '';
  if(toggle) toggle.style.transform = isOpen ? '' : 'rotate(90deg)';
};

// 폴더 전체 체크
window.treeCheckFolder = (prefix, folderId) => {
  const cb = document.getElementById(`${prefix}-fchk-${folderId}`);
  const books = folderId === 'unassigned'
    ? (window._treeBooks||[]).filter(b=>!b.folderId)
    : (window._treeBooks||[]).filter(b=>b.folderId===folderId);
  books.forEach(b=>{
    const bcb = document.getElementById(`${prefix}-bchk-${b.id}`);
    if(bcb) bcb.checked = cb.checked;
    b.units.forEach(u=>{
      const ucb = document.getElementById(`${prefix}-uchk-${u.id}`);
      if(ucb) ucb.checked = cb.checked;
    });
  });
  // 펼치기
  if(cb.checked){
    const el = document.getElementById(`${prefix}-f-${folderId}`);
    const toggle = document.getElementById(`${prefix}-ft-${folderId}`);
    if(el){ el.style.display=''; if(toggle) toggle.style.transform='rotate(90deg)'; }
  }
  if(prefix === 'ws') { updateWsSelCount(); window.updateWsPreview(); }
  else { updatePtSelCount(); updatePtPreview(); }
};

// 교재 전체 체크
window.treeCheckBook = (prefix, bookId) => {
  const cb = document.getElementById(`${prefix}-bchk-${bookId}`);
  const book = (window._treeBooks||[]).find(b=>b.id===bookId);
  if(!book) return;
  book.units.forEach(u=>{
    const ucb = document.getElementById(`${prefix}-uchk-${u.id}`);
    if(ucb) ucb.checked = cb.checked;
  });
  if(cb.checked){
    const el = document.getElementById(`${prefix}-b-${bookId}`);
    const toggle = document.getElementById(`${prefix}-bt-${bookId}`);
    if(el){ el.style.display=''; if(toggle) toggle.style.transform='rotate(90deg)'; }
  }
  if(prefix === 'ws') { updateWsSelCount(); window.updateWsPreview(); }
  else { updatePtSelCount(); updatePtPreview(); }
};

// Unit 체크 토글
window.treeCheckUnit = (prefix, bookId, unitId) => {
  const cb = document.getElementById(`${prefix}-uchk-${unitId}`);
  cb.checked = !cb.checked;
  if(prefix === 'ws') { updateWsSelCount(); window.updateWsPreview(); }
  else { updatePtSelCount(); updatePtPreview(); }
};

// 선택된 Unit 목록 수집
function getSelectedUnits(prefix){
  const result = [];
  (window._treeBooks||[]).forEach(b=>{
    b.units.forEach(u=>{
      const cb = document.getElementById(`${prefix}-uchk-${u.id}`);
      if(cb?.checked) result.push({bookId:b.id, bookName:b.name, unitId:u.id, unitName:u.name, words:u.words||[]});
    });
  });
  return result;
}

// ── 설정값 localStorage 저장/복원 ────────────────────────

// My Book 출력 설정 저장
window.saveWsSettings = () => {
  try{
    localStorage.setItem('kunsori_ws', JSON.stringify({
      perPage: document.getElementById('wsPerPage')?.value || '50',
      perCol:  document.getElementById('wsPerCol')?.value  || '25',
      div:     _wsSettings.div,
      content: _wsSettings.content,
      layout:  _wsSettings.layout,
      order:   _wsSettings.order,
      size:    _wsSettings.size,
      noDup:   document.getElementById('wsNoDup')?.checked || false,
    }));
  }catch(e){console.warn(e);}
};

// My Book 출력 설정 복원
function loadWsSettings(){
  try{
    const saved = JSON.parse(localStorage.getItem('kunsori_ws')||'{}');
    if(saved.perPage){
      const pp = document.getElementById('wsPerPage');
      if(pp) pp.value = saved.perPage;
    }
    if(saved.perCol){
      const pc = document.getElementById('wsPerCol');
      if(pc) pc.value = saved.perCol;
    }
    if(saved.noDup !== undefined){
      const nd = document.getElementById('wsNoDup');
      if(nd) nd.checked = saved.noDup;
    }
    // 버튼 상태 복원 (silent=true: 저장/미리보기 중복 호출 방지)
    if(saved.div)     setWsOpt('div',     saved.div,     'wsDiv-',     true);
    if(saved.content) setWsOpt('content', saved.content, 'wsContent-', true);
    if(saved.layout)  setWsOpt('layout',  saved.layout,  'wsLayout-',  true);
    if(saved.order)   setWsOpt('order',   saved.order,   'wsOrder-',   true);
    if(saved.size)    setWsOpt('size',    saved.size,    'wsSize-',    true);
  }catch(e){console.warn(e);}
}

// 시험지 출력 설정 저장
window.savePtSettings = () => {
  try{
    localStorage.setItem('kunsori_pt', JSON.stringify({
      mcEn2Ko:  document.getElementById('pt_mcEn2Ko')?.value  || '20',
      subjEn2Ko:document.getElementById('pt_subjEn2Ko')?.value || '0',
      mcKo2En:  document.getElementById('pt_mcKo2En')?.value  || '0',
      subjKo2En:document.getElementById('pt_subjKo2En')?.value || '0',
    }));
  }catch(e){console.warn(e);}
};

// 시험지 출력 설정 복원
function loadPtSettings(){
  try{
    const saved = JSON.parse(localStorage.getItem('kunsori_pt')||'{}');
    const fields = ['mcEn2Ko','subjEn2Ko','mcKo2En','subjKo2En'];
    fields.forEach(f=>{
      const el = document.getElementById('pt_'+f);
      if(el && saved[f] !== undefined) el.value = saved[f];
    });
  }catch(e){console.warn(e);}
}

// ── My Book 출력 ─────────────────────────────────────────
window.loadAllBookTree = async() => {
  const el = document.getElementById('bookTreeArea');
  if(!el) return;
  el.innerHTML='<div style="padding:16px;text-align:center;color:#bbb;">로딩 중...</div>';
  // 저장된 설정 복원
  loadWsSettings();
  try{
    const treeData = await buildFolderBookTree();
    window._wsTreeData = treeData;
    el.innerHTML = renderFolderTree(treeData, 'ws');
    _allBookSelected = [];
    updateWsSelCount();
    window.updateWsPreview();
  }catch(e){ el.innerHTML=`<div style="padding:16px;color:#e05050;">${e.message}</div>`; }
};

function updateWsSelCount(){
  const sel = getSelectedUnits('ws');
  _allBookSelected = sel;
  const cnt = document.getElementById('wsSelCount');
  if(cnt) cnt.textContent = sel.length ? `${sel.length}개 Unit 선택` : '';
}

// ── 워크시트 미리보기 ────────────────────────────────────
window.updateWsPreview = function(){
  _wsSettings.perPage = parseInt(document.getElementById('wsPerPage')?.value)||20;
  _wsSettings.perCol  = parseInt(document.getElementById('wsPerCol')?.value)||10;
  _wsSettings.noDup   = document.getElementById('wsNoDup')?.checked||false;

  updateWsSelCount();
  const sel = _allBookSelected;
  const previewEl = document.getElementById('wsPreviewArea');
  const countEl   = document.getElementById('wsWordCount');
  if(!previewEl) return;

  if(!sel.length){
    previewEl.innerHTML = buildWsEmptyPage();
    if(countEl) countEl.textContent = '';
    return;
  }

  let allWords = sel.flatMap(s=>s.words||[]);
  if(_wsSettings.noDup){ const seen=new Set(); allWords=allWords.filter(w=>{const k=w.en.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;}); }
  if(_wsSettings.order==='scramble') allWords=[...allWords].sort(()=>Math.random()-0.5);
  if(countEl) countEl.textContent = '총 '+allWords.length+'개';

  const pages = generateWsPages(sel, allWords);
  previewEl.innerHTML = pages.map((pg,pi)=>buildWsPageHTML(pg,pi,false)).join('');
};

function buildWsEmptyPage(){
  return `<div style="background:white;margin:0 auto;padding:24px;max-width:600px;min-height:400px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.15);">
    <div style="text-align:center;color:#bbb;padding:60px 0;font-size:13px;">왼쪽에서 교재/Unit을 선택하세요</div>
  </div>`;
}

function generateWsPages(sel, allWords){
  const perPage = _wsSettings.perPage;
  const pages = [];
  if(_wsSettings.div==='unit'){
    sel.forEach(s=>{
      let words = s.words||[];
      if(_wsSettings.noDup){ const seen=new Set(); words=words.filter(w=>{const k=w.en.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;}); }
      if(_wsSettings.order==='scramble') words=[...words].sort(()=>Math.random()-0.5);
      for(let i=0;i<words.length;i+=perPage)
        pages.push({bookName:s.bookName, unitName:s.unitName, words:words.slice(i,i+perPage)});
    });
  } else {
    const bookNames=[...new Set(sel.map(s=>s.bookName))].join(', ');
    for(let i=0;i<allWords.length;i+=perPage)
      pages.push({bookName:bookNames, unitName:`${i+1}~${Math.min(i+perPage,allWords.length)}번`, words:allWords.slice(i,i+perPage)});
  }
  return pages;
}

function buildWsPageHTML(pg, pageIdx, isPrint){
  const {bookName, unitName, words} = pg;
  const is2col = _wsSettings.layout==='2col';
  const content = _wsSettings.content;
  const sizeMap = {small:'10px', medium:'12px', large:'14px'};
  const fontSize = sizeMap[_wsSettings.size]||'12px';
  const logoHTML = _wsLogoDataUrl
    ? `<img src="${_wsLogoDataUrl}" style="width:44px;height:44px;object-fit:contain;border-radius:6px;">`
    : `<div style="width:44px;height:44px;border-radius:6px;background:#3BBFBF;display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:700;text-align:center;line-height:1.3;">큰소리<br>영어</div>`;

  const makeRow = (w, num) => {
    const numStyle = `color:#3BBFBF;font-weight:700;min-width:20px;text-align:right;font-size:${fontSize};flex-shrink:0;`;
    const enStyle  = `font-size:${fontSize};flex:1;`;
    const koStyle  = `font-size:${fontSize};color:#555;flex:1;`;
    if(content==='spell')
      return `<div style="display:flex;align-items:baseline;gap:5px;padding:2px 0;"><span style="${numStyle}">${num}</span><span style="${enStyle}">${w.en}</span></div>`;
    if(content==='meaning')
      return `<div style="display:flex;align-items:baseline;gap:5px;padding:2px 0;"><span style="${numStyle}">${num}</span><span style="${koStyle}">${w.ko}</span></div>`;
    return `<div style="display:flex;align-items:baseline;gap:5px;padding:2px 0;"><span style="${numStyle}">${num}</span><span style="${enStyle}">${w.en}</span><span style="${koStyle}">${w.ko}</span></div>`;
  };

  let wordsHTML = '';
  if(is2col){
    const half = Math.ceil(words.length/2);
    wordsHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px;border-top:1px solid #ddd;padding-top:8px;">
      <div>${words.slice(0,half).map((w,i)=>makeRow(w,i+1)).join('')}</div>
      <div style="border-left:1px solid #eee;padding-left:14px;">${words.slice(half).map((w,i)=>makeRow(w,half+i+1)).join('')}</div>
    </div>`;
  } else {
    wordsHTML = `<div style="border-top:1px solid #ddd;padding-top:8px;">${words.map((w,i)=>makeRow(w,i+1)).join('')}</div>`;
  }

  // 인쇄/미리보기 공통 A4 스타일 (794px × 1123px)
  const commonStyle = `
    width:794px;
    min-height:1123px;
    background:white;
    padding:28px 36px 24px;
    font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;
    box-sizing:border-box;
  `;
  const previewStyle = `${commonStyle}
    margin:0 auto 16px;
    border-radius:4px;
    box-shadow:0 2px 10px rgba(0,0,0,.2);
  `;
  const printStyle = `${commonStyle}
    page-break-after:always;
  `;

  return `<div style="${isPrint ? printStyle : previewStyle}">
    <div style="text-align:center;font-size:18px;font-weight:900;letter-spacing:2px;color:#222;margin-bottom:12px;">WORK SHEET</div>
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ccc;padding-bottom:8px;margin-bottom:12px;font-size:12px;">
      <span>교재 : <b>${esc(bookName)}</b></span>
      <span>차시 : <b>${unitName}</b></span>
    </div>
    ${wordsHTML}
    <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #ddd;margin-top:12px;padding-top:8px;">
      <span style="font-size:11px;color:#888;">학원명 : 큰소리영어</span>
      ${logoHTML}
    </div>
  </div>`;
}

window.printWorksheet = () => {
  if(!_allBookSelected.length){ showToast('Unit을 선택하세요.'); return; }
  let allWords = _allBookSelected.flatMap(s=>s.words||[]);
  if(_wsSettings.noDup){ const seen=new Set(); allWords=allWords.filter(w=>{const k=w.en.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;}); }
  if(_wsSettings.order==='scramble') allWords=[...allWords].sort(()=>Math.random()-0.5);
  const pages = generateWsPages(_allBookSelected, allWords);
  const pagesHTML = pages.map((pg,i)=>buildWsPageHTML(pg,i,true)).join('');
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>WORK SHEET</title>
    <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;background:white;}
    @media print{@page{margin:8mm;size:A4;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}</style>
    </head><body>${pagesHTML}
    <script>window.onload=()=>{window.print();}<\/script></body></html>`);
  win.document.close();
};
window.printAllBook = window.printWorksheet;

window.clearAllBookSelection = () => {
  document.querySelectorAll('[id^="ws-uchk-"],[id^="ws-bchk-"],[id^="ws-fchk-"]').forEach(cb=>cb.checked=false);
  _allBookSelected = [];
  updateWsSelCount();
  window.updateWsPreview();
};

// ── 시험지 출력 (My Book 출력과 동일한 구조) ─────────────
window.loadPrintTestList = async() => {
  const el = document.getElementById('printBookTreeArea');
  if(!el) return;
  el.innerHTML='<div style="padding:16px;text-align:center;color:#bbb;">로딩 중...</div>';
  // 저장된 설정 복원
  loadPtSettings();
  try{
    const treeData = await buildFolderBookTree();
    window._ptTreeData = treeData;
    el.innerHTML = renderFolderTree(treeData, 'pt');
    updatePtSelCount();
    updatePtPreview();
  }catch(e){ el.innerHTML=`<div style="padding:16px;color:#e05050;">${e.message}</div>`; }
};

function updatePtSelCount(){
  const sel = getSelectedUnits('pt');
  window._ptSelectedUnits = sel;
  const cnt = document.getElementById('ptSelCount');
  if(cnt) cnt.textContent = sel.length ? `${sel.length}개 Unit 선택` : '';
  // 시험명 자동 입력
  if(sel.length > 0){
    const nameEl = document.getElementById('ptExamName');
    if(nameEl && !nameEl._userEdited){
      const defaultName = sel.length === 1
        ? `${sel[0].bookName} ${sel[0].unitName}`
        : `${sel[0].bookName} ${sel.map(u=>u.unitName).join(', ')}`;
      nameEl.value = defaultName;
    }
  }
  // 총 단어수
  const total = [...new Map(sel.flatMap(u=>u.words).map(w=>[w.en,w])).values()].length;
  const cnt2 = document.getElementById('ptWordCount');
  if(cnt2) cnt2.textContent = total ? `총 ${total}개 단어` : '';
}

window.clearPrintSelection = () => {
  document.querySelectorAll('[id^="pt-uchk-"],[id^="pt-bchk-"],[id^="pt-fchk-"]').forEach(cb=>cb.checked=false);
  window._ptSelectedUnits = [];
  updatePtSelCount();
  updatePtPreview();
};

window.updatePtPreview = () => {
  const sel = getSelectedUnits('pt');
  window._ptSelectedUnits = sel;
  updatePtSelCount();

  const mcEn2Ko   = parseInt(document.getElementById('pt_mcEn2Ko')?.value)||0;
  const subjEn2Ko = parseInt(document.getElementById('pt_subjEn2Ko')?.value)||0;
  const mcKo2En   = parseInt(document.getElementById('pt_mcKo2En')?.value)||0;
  const subjKo2En = parseInt(document.getElementById('pt_subjKo2En')?.value)||0;
  const total = mcEn2Ko+subjEn2Ko+mcKo2En+subjKo2En;
  const cnt = document.getElementById('ptTotalCount');
  if(cnt) cnt.textContent = total;

  const previewEl = document.getElementById('ptPreviewArea');
  if(!previewEl) return;

  const examName = (sel.length ? (document.getElementById('ptExamName')?.value.trim()
    || (sel.length===1 ? sel[0].bookName+' '+sel[0].unitName : sel[0].bookName+' '+sel.map(u=>u.unitName).join(', '))) : '');
  const academy = document.getElementById('ptAcademy')?.value.trim() || '큰소리영어';

  const emptyBlock = `<div style="width:794px;min-height:1123px;background:white;margin:0 auto 16px;border-radius:4px;
    box-shadow:0 2px 10px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;box-sizing:border-box;">
    <div style="text-align:center;color:#bbb;font-size:13px;">${!sel.length?'왼쪽에서 교재/Unit을 선택하세요':'문항 수를 입력하면 미리보기가 표시됩니다'}</div>
  </div>`;

  if(!sel.length || total===0){ previewEl.innerHTML='<div style="padding:16px;">'+emptyBlock+'</div>'; return; }

  // 단어 수집 (중복 제거)
  const wordMap = new Map();
  sel.forEach(u=>(u.words||[]).forEach(w=>{if(!wordMap.has(w.en))wordMap.set(w.en,w);}));
  const allWords = [...wordMap.values()];

  // 문제 생성
  let shuffled = [...allWords].sort(()=>Math.random()-0.5);
  const questions = []; let idx = 0;
  for(let i=0;i<mcEn2Ko&&idx<shuffled.length;i++,idx++)   questions.push({...shuffled[idx],isEn2Ko:true,qStyle:'mc',num:0});
  for(let i=0;i<subjEn2Ko&&idx<shuffled.length;i++,idx++) questions.push({...shuffled[idx],isEn2Ko:true,qStyle:'subj',num:0});
  for(let i=0;i<mcKo2En&&idx<shuffled.length;i++,idx++)   questions.push({...shuffled[idx],isEn2Ko:false,qStyle:'mc',num:0});
  for(let i=0;i<subjKo2En&&idx<shuffled.length;i++,idx++) questions.push({...shuffled[idx],isEn2Ko:false,qStyle:'subj',num:0});
  questions.sort(()=>Math.random()-0.5).forEach((q,i)=>q.num=i+1);

  // 보기 캐시
  const choicesCache = {};
  questions.forEach(q=>{
    if(q.qStyle==='mc'){
      const answer = q.isEn2Ko?q.ko:q.en;
      const others = allWords.filter(w=>w.en!==q.en).sort(()=>Math.random()-0.5).slice(0,3);
      const choices = [...others.map(o=>q.isEn2Ko?o.ko:o.en),answer].sort(()=>Math.random()-0.5);
      choicesCache[q.num] = {choices, ansIdx:choices.indexOf(answer)+1};
    }
  });

  const makeQHTML = (q) => {
    const question = q.isEn2Ko?q.en:q.ko;
    if(q.qStyle==='subj') return `
      <div style="margin-bottom:18px;break-inside:avoid;">
        <div style="font-size:10pt;font-weight:700;margin-bottom:6px;">${q.num}. ${question}</div>
        <div style="border-bottom:1.2px solid #333;width:85%;">&nbsp;</div>
      </div>`;
    const {choices=[],ansIdx=0} = choicesCache[q.num]||{};
    return `
      <div style="margin-bottom:15px;break-inside:avoid;">
        <div style="font-size:10pt;font-weight:700;margin-bottom:4px;">${q.num}. ${question}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px 4px;font-size:9pt;padding-left:4px;">
          ${choices.map((c,i)=>`<div>${i+1}. ${c}</div>`).join('')}
        </div>
      </div>`;
  };

  // A4 한 장당 약 26문제 기준 페이지 분할
  const PER_PAGE = 26;
  const pageGroups = [];
  for(let i=0;i<questions.length;i+=PER_PAGE) pageGroups.push(questions.slice(i,i+PER_PAGE));

  // 1페이지 헤더 높이 계산용 상수 (px): 제목+학교란+여백 합산
  // padding-top 20px + 제목줄 약 30px + mb14 + 학교란 약 26px + pb8+mb20 = 약 118px
  const HEADER_H = '118px';

  const makePageHTML = (qs, pgIdx) => {
    const half = Math.ceil(qs.length/2);
    return `
      <div style="width:794px;min-height:1123px;background:white;margin:0 auto 12px;border-radius:4px;
        box-shadow:0 2px 10px rgba(0,0,0,.2);padding:20px 36px 16px;
        font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;box-sizing:border-box;">
        ${pgIdx===0 ? `
          <!-- 1페이지: 제목 + 학교/이름란 -->
          <div style="font-size:15pt;font-weight:900;margin-bottom:10px;">${examName}</div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #000;padding-bottom:6px;margin-bottom:14px;">
            <div style="font-size:9.5pt;font-weight:700;">학원명 : <span style="font-weight:400;">${academy}</span></div>
            <div style="font-size:8.5pt;">
              학교 : <span style="display:inline-block;width:70px;border-bottom:1px solid #000;">&nbsp;</span>
              &nbsp;학년 : <span style="display:inline-block;width:28px;border-bottom:1px solid #000;">&nbsp;</span>
              &nbsp;반 : <span style="display:inline-block;width:28px;border-bottom:1px solid #000;">&nbsp;</span>
              &nbsp;이름 : <span style="display:inline-block;width:70px;border-bottom:1px solid #000;">&nbsp;</span>
            </div>
          </div>` : `
          <!-- 2페이지~: 헤더 높이만큼 여백 (내용 시작 위치 동일) -->
          <div style="height:${HEADER_H};display:flex;align-items:flex-end;padding-bottom:14px;border-bottom:1px dashed #ddd;margin-bottom:14px;box-sizing:border-box;">
            <span style="font-size:9pt;color:#bbb;">${examName} — ${pgIdx+1} / ${pageGroups.length}</span>
          </div>`}
        <div style="display:grid;grid-template-columns:1fr 1px 1fr;gap:0 18px;">
          <div>${qs.slice(0,half).map(q=>makeQHTML(q)).join('')}</div>
          <div style="background:#ccc;"></div>
          <div style="padding-left:18px;">${qs.slice(half).map(q=>makeQHTML(q)).join('')}</div>
        </div>
        <div style="text-align:right;font-size:8pt;color:#bbb;margin-top:8px;">— ${pgIdx+1} / ${pageGroups.length} —</div>
      </div>`;
  };

  previewEl.innerHTML = '<div style="padding:12px;">' + pageGroups.map((qs,i)=>makePageHTML(qs,i)).join('') + '</div>';
};
window.doPrintExamFromTree = (ptype) => {
  const sel = window._ptSelectedUnits || getSelectedUnits('pt');
  if(!sel.length){ showToast('교재/Unit을 선택하세요.'); return; }
  const examName = document.getElementById('ptExamName')?.value.trim() || '단어시험';
  const academy = document.getElementById('ptAcademy')?.value.trim() || '큰소리영어';
  const today = new Date().toISOString().slice(0,10);
  const mcEn2Ko  = parseInt(document.getElementById('pt_mcEn2Ko')?.value)||0;
  const subjEn2Ko= parseInt(document.getElementById('pt_subjEn2Ko')?.value)||0;
  const mcKo2En  = parseInt(document.getElementById('pt_mcKo2En')?.value)||0;
  const subjKo2En= parseInt(document.getElementById('pt_subjKo2En')?.value)||0;
  if(mcEn2Ko+subjEn2Ko+mcKo2En+subjKo2En===0){ showToast('문항 수를 입력하세요.'); return; }
  const wordMap = new Map();
  sel.forEach(u=>(u.words||[]).forEach(w=>{if(!wordMap.has(w.en))wordMap.set(w.en,w);}));
  const allWords = [...wordMap.values()];
  let shuffled = [...allWords].sort(()=>Math.random()-0.5);
  const questions = []; let idx = 0;
  for(let i=0;i<mcEn2Ko&&idx<shuffled.length;i++,idx++)   questions.push({...shuffled[idx],isEn2Ko:true,qStyle:'mc'});
  for(let i=0;i<subjEn2Ko&&idx<shuffled.length;i++,idx++)  questions.push({...shuffled[idx],isEn2Ko:true,qStyle:'subj'});
  for(let i=0;i<mcKo2En&&idx<shuffled.length;i++,idx++)   questions.push({...shuffled[idx],isEn2Ko:false,qStyle:'mc'});
  for(let i=0;i<subjKo2En&&idx<shuffled.length;i++,idx++) questions.push({...shuffled[idx],isEn2Ko:false,qStyle:'subj'});
  questions.sort(()=>Math.random()-0.5).forEach((q,i)=>q.num=i+1);
  printMixedExamPDF(questions, examName, academy, today, ptype, allWords);
};

let _allBookSelected = [];
let _wsLogoDataUrl = null;
let _wsSettings = {
  div: 'unit',       // unit | count
  content: 'both',   // spell | meaning | both
  layout: '2col',    // 1col | 2col
  order: 'ordered',  // scramble | ordered
  size: 'medium',    // small | medium | large
  perPage: 20,
  perCol: 10,
  noDup: false,
};

// 옵션 토글 공통
function setWsOpt(group, value, prefix, silent){
  document.querySelectorAll(`[id^="${prefix}"]`).forEach(b=>b.classList.remove('active'));
  document.getElementById(`${prefix}${value}`)?.classList.add('active');
  _wsSettings[group] = value;
  if(!silent){
    window.saveWsSettings();
    window.updateWsPreview();
  }
}
window.setWsDiv     = (v) => setWsOpt('div',     v, 'wsDiv-');
window.setWsContent = (v) => setWsOpt('content', v, 'wsContent-');
window.setWsLayout  = (v) => setWsOpt('layout',  v, 'wsLayout-');
window.setWsOrder   = (v) => setWsOpt('order',   v, 'wsOrder-');
window.setWsSize    = (v) => setWsOpt('size',     v, 'wsSize-');

window.loadWsLogo = (e) => {
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    _wsLogoDataUrl = ev.target.result;
    document.getElementById('wsLogoPreview').innerHTML =
      `<img src="${_wsLogoDataUrl}" style="width:76px;height:56px;object-fit:contain;border-radius:4px;">`;
    window.updateWsPreview();
  };
  reader.readAsDataURL(file);
};

window.closeWsPreview = () => {
  _allBookSelected = [];
  document.querySelectorAll('[id^="chk-unit-"],[id^="chk-book-"]').forEach(cb=>cb.checked=false);
  document.getElementById('wsPreviewArea').innerHTML = `
    <div style="background:white;margin:0 auto;padding:24px;max-width:600px;min-height:400px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.15);">
      <div style="text-align:center;color:#bbb;padding:60px 0;font-size:13px;">왼쪽에서 교재/Unit을 선택하세요</div>
    </div>`;
  document.getElementById('wsWordCount').textContent = '';
};


window.togglePrintBook = (treeId, toggleId) => {
  const tree = document.getElementById(treeId);
  const toggle = document.getElementById(toggleId);
  if(!tree) return;
  const isOpen = tree.style.display!=='none';
  tree.style.display = isOpen?'none':'';
  if(toggle) toggle.style.transform = isOpen?'':'rotate(90deg)';
};

window.checkAllUnits = (bookId) => {
  const cb = document.getElementById('pbc-'+bookId);
  const book = window._printBooksWithUnits?.find(b=>b.id===bookId);
  if(!book) return;
  book.units.forEach(u=>{
    const ucb = document.getElementById('puc-'+u.id);
    if(ucb) ucb.checked = cb.checked;
  });
  // 트리 펼치기
  if(cb.checked){ const tree=document.getElementById('pb-'+bookId); if(tree){tree.style.display='';document.getElementById('pt-'+bookId).style.transform='rotate(90deg)';} }
  updatePrintSelectedList();
};

window.togglePrintUnit = (bookId, unitId) => {
  const cb = document.getElementById('puc-'+unitId);
  cb.checked = !cb.checked;
  updatePrintSelectedList();
};

window.filterPrintBooks = (q) => {
  const lq = q.toLowerCase();
  window._printBooksWithUnits?.forEach(b=>{
    const bookEl = document.getElementById('pb-'+b.id)?.parentElement;
    if(!bookEl) return;
    const match = !lq || b.name.toLowerCase().includes(lq) || b.units.some(u=>u.name.toLowerCase().includes(lq));
    bookEl.style.display = match?'':'none';
    if(lq && match){ const tree=document.getElementById('pb-'+b.id); if(tree){tree.style.display='';document.getElementById('pt-'+b.id).style.transform='rotate(90deg)';} }
  });
};

window.addPrintSelected = () => { updatePrintSelectedList(); };
window.clearPrintSelection = () => {
  document.querySelectorAll('[id^="puc-"],[id^="pbc-"]').forEach(cb=>cb.checked=false);
  updatePrintSelectedList();
};

function updatePrintSelectedList(){
  const selected = [];
  window._printBooksWithUnits?.forEach(b=>{
    b.units.forEach(u=>{
      if(document.getElementById('puc-'+u.id)?.checked)
        selected.push({bookId:b.id, bookName:b.name, unitId:u.id, unitName:u.name, words:u.words||[]});
    });
  });
  _printData.selectedUnits = selected;
  const el = document.getElementById('printSelectedList');
  const cnt = document.getElementById('printSelectedCount');
  if(cnt) cnt.textContent = selected.length+'개';
  if(!el) return;
  if(!selected.length){ el.innerHTML='<div style="color:#bbb;font-size:13px;text-align:center;padding:20px;">교재/Unit을 선택하세요</div>'; return; }
  el.innerHTML = selected.map(s=>`
    <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid #f5f5f5;font-size:13px;">
      <span style="flex:1;">📘 ${s.bookName} › ${s.unitName}</span>
      <span style="font-size:11px;color:#aaa;">${s.words.length}개</span>
      <span onclick="removePrintUnit('${s.bookId}','${s.unitId}')" style="cursor:pointer;color:#bbb;font-size:16px;">✕</span>
    </div>`).join('');
}

window.removePrintUnit = (bookId, unitId) => {
  const cb = document.getElementById('puc-'+unitId);
  if(cb) cb.checked = false;
  updatePrintSelectedList();
};

window.printStep1Next = () => {
  if(!_printData.selectedUnits.length){ showToast('교재/Unit을 선택하세요.'); return; }
  renderPrintStep2();
};

// ── Step 2: 출력 설정 ───────────────────────────────────
function renderPrintStep2(){
  updatePrintStepUI(2);
  const totalWords = _printData.selectedUnits.reduce((s,u)=>s+u.words.length,0);
  // 중복 제거 기준 단어 수
  const uniqueWords = [...new Map(_printData.selectedUnits.flatMap(u=>u.words).map(w=>[w.en,w])).values()];
  const total = uniqueWords.length;
  const defaultMc = Math.min(Math.round(total*0.7), total);
  const defaultSubj = total - defaultMc;

  document.getElementById('printStepContent').innerHTML = `
    <div style="font-size:14px;font-weight:600;margin-bottom:20px;">Step 2 출력설정</div>
    <div style="margin-bottom:12px;font-size:13px;color:var(--gray);">
      선택 단어: <b style="color:var(--teal);">${total}개</b> (중복제거 기준)
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div>
        <div style="font-size:13px;font-weight:700;margin-bottom:12px;padding:8px 12px;background:#f0fafa;border-radius:8px;color:var(--teal);">
          영어 → 한글 (뜻 맞추기)
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:13px;">
          <span style="width:80px;">객관식</span>
          <input type="number" id="mcEn2Ko" value="${Math.round(defaultMc/2)}" min="0" max="${total}"
            oninput="updatePrintTotal()"
            style="width:70px;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:13px;outline:none;">
          <span style="color:#bbb;">개</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;font-size:13px;">
          <span style="width:80px;">주관식</span>
          <input type="number" id="subjEn2Ko" value="${Math.round(defaultSubj/2)}" min="0" max="${total}"
            oninput="updatePrintTotal()"
            style="width:70px;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:13px;outline:none;">
          <span style="color:#bbb;">개</span>
        </div>
      </div>
      <div>
        <div style="font-size:13px;font-weight:700;margin-bottom:12px;padding:8px 12px;background:#e0eeff;border-radius:8px;color:var(--blue);">
          한글 → 영어 (스펠링)
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:13px;">
          <span style="width:80px;">객관식</span>
          <input type="number" id="mcKo2En" value="${Math.round(defaultMc/2)}" min="0" max="${total}"
            oninput="updatePrintTotal()"
            style="width:70px;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:13px;outline:none;">
          <span style="color:#bbb;">개</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;font-size:13px;">
          <span style="width:80px;">주관식</span>
          <input type="number" id="subjKo2En" value="${Math.round(defaultSubj/2)}" min="0" max="${total}"
            oninput="updatePrintTotal()"
            style="width:70px;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:13px;outline:none;">
          <span style="color:#bbb;">개</span>
        </div>
      </div>
    </div>
    <div style="margin-top:16px;padding:12px 14px;background:#f8f9fa;border-radius:8px;font-size:13px;">
      총 문항: <b id="printTotalCount" style="color:var(--teal);font-size:16px;">${Math.round(defaultMc/2)+Math.round(defaultSubj/2)+Math.round(defaultMc/2)+Math.round(defaultSubj/2)}</b>문제
      <span style="color:#bbb;margin-left:8px;">(객관식 <span id="ptMc">0</span>개 + 주관식 <span id="ptSubj">0</span>개)</span>
    </div>
    <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="loadPrintTestList()">← 이전</button>
      <button class="btn btn-primary" onclick="printStep2Next()">다음 → 출력 정보</button>
    </div>`;
  updatePrintTotal();
}

window.updatePrintTotal = () => {
  const mc1 = parseInt(document.getElementById('mcEn2Ko')?.value)||0;
  const subj1 = parseInt(document.getElementById('subjEn2Ko')?.value)||0;
  const mc2 = parseInt(document.getElementById('mcKo2En')?.value)||0;
  const subj2 = parseInt(document.getElementById('subjKo2En')?.value)||0;
  const total = mc1+subj1+mc2+subj2;
  const mc = mc1+mc2, subj = subj1+subj2;
  const el = document.getElementById('printTotalCount');
  const elMc = document.getElementById('ptMc');
  const elSubj = document.getElementById('ptSubj');
  if(el) el.textContent = total;
  if(elMc) elMc.textContent = mc;
  if(elSubj) elSubj.textContent = subj;
  _printData.mcEn2Ko=mc1; _printData.subjEn2Ko=subj1;
  _printData.mcKo2En=mc2; _printData.subjKo2En=subj2;
};

window.printStep2Next = () => {
  _printData.mcEn2Ko = parseInt(document.getElementById('mcEn2Ko')?.value)||0;
  _printData.subjEn2Ko = parseInt(document.getElementById('subjEn2Ko')?.value)||0;
  _printData.mcKo2En = parseInt(document.getElementById('mcKo2En')?.value)||0;
  _printData.subjKo2En = parseInt(document.getElementById('subjKo2En')?.value)||0;
  const total = _printData.mcEn2Ko+_printData.subjEn2Ko+_printData.mcKo2En+_printData.subjKo2En;
  if(total===0){ showToast('문항 수를 입력하세요.'); return; }
  renderPrintStep3();
};

// ── Step 3: 출력 정보 ───────────────────────────────────
window.renderPrintStep3 = function(){
  updatePrintStepUI(3);
  // 기본 시험명: 교재명 + Unit명
  const defaultName = _printData.selectedUnits.length===1
    ? `${_printData.selectedUnits[0].bookName} ${_printData.selectedUnits[0].unitName}`
    : _printData.selectedUnits.map(u=>u.unitName).join(', ');
  const today = new Date().toISOString().slice(0,10);
  const mc = _printData.mcEn2Ko+_printData.mcKo2En;
  const subj = _printData.subjEn2Ko+_printData.subjKo2En;

  document.getElementById('printStepContent').innerHTML = `
    <div style="font-size:14px;font-weight:600;margin-bottom:20px;">Step 3 출력정보</div>
    <div style="max-width:500px;margin:0 auto;">
      <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:24px;">
        <div>
          <div style="font-size:13px;color:var(--gray);margin-bottom:4px;">학원명</div>
          <input id="pi_academy" type="text" value="큰소리영어"
            style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:14px;outline:none;">
        </div>
        <div>
          <div style="font-size:13px;color:var(--gray);margin-bottom:4px;">시험명 <span style="font-size:11px;">(수정 가능)</span></div>
          <input id="pi_name" type="text" value="${defaultName}"
            style="width:100%;border:2px solid var(--teal);border-radius:8px;padding:10px 14px;font-size:14px;outline:none;">
        </div>
      </div>
      <div style="background:#f8f9fa;border-radius:10px;padding:14px 16px;margin-bottom:24px;font-size:13px;">
        <div style="font-weight:700;margin-bottom:8px;">출제 요약</div>
        <div style="color:var(--gray);line-height:2;">
          ${_printData.selectedUnits.map(u=>`📘 ${u.bookName} › ${u.unitName} (${u.words.length}개)`).join('<br>')}
          <br>총 문항: <b style="color:var(--text);">${mc+subj}문제</b>
          (객관식 <b>${mc}</b>개 + 주관식 <b>${subj}</b>개)
        </div>
      </div>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button class="btn btn-secondary" style="flex:1;justify-content:center;padding:12px;" onclick="renderPrintStep2()">← 이전</button>
        <button class="btn btn-primary" style="flex:1;justify-content:center;padding:12px;font-size:15px;" onclick="doPrintExam('exam')">📄 시험지</button>
        <button style="flex:1;justify-content:center;padding:12px;font-size:15px;background:#4bc27d;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;" onclick="doPrintExam('answer')">📋 답안지</button>
        <button style="flex:1;justify-content:center;padding:12px;font-size:14px;background:var(--blue);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;" onclick="doPrintExam('both')">🖨 둘 다</button>
      </div>
    </div>`;
};
window.renderPrintStep2 = renderPrintStep2; // alias

window.doPrintExam = (ptype) => {
  const examName = document.getElementById('pi_name')?.value.trim() || '단어시험';
  const academy = document.getElementById('pi_academy')?.value.trim() || '큰소리영어';
  const today = new Date().toISOString().slice(0,10);

  // 단어 수집 (중복 제거)
  const wordMap = new Map();
  _printData.selectedUnits.forEach(u=>{
    (u.words||[]).forEach(w=>{ if(!wordMap.has(w.en)) wordMap.set(w.en,w); });
  });
  const allWords = [...wordMap.values()];
  if(!allWords.length){ showToast('단어가 없습니다.'); return; }

  // 문제 구성
  const mcEn2Ko = parseInt(_printData.mcEn2Ko)||0;
  const subjEn2Ko = parseInt(_printData.subjEn2Ko)||0;
  const mcKo2En = parseInt(_printData.mcKo2En)||0;
  const subjKo2En = parseInt(_printData.subjKo2En)||0;

  let shuffled = [...allWords].sort(()=>Math.random()-0.5);
  const questions = [];
  let idx = 0;
  // 영→한 객관식
  for(let i=0;i<mcEn2Ko&&idx<shuffled.length;i++,idx++)
    questions.push({...shuffled[idx], testType:'meaning', isEn2Ko:true, qStyle:'mc'});
  // 영→한 주관식
  for(let i=0;i<subjEn2Ko&&idx<shuffled.length;i++,idx++)
    questions.push({...shuffled[idx], testType:'meaning', isEn2Ko:true, qStyle:'subj'});
  // 한→영 객관식
  for(let i=0;i<mcKo2En&&idx<shuffled.length;i++,idx++)
    questions.push({...shuffled[idx], testType:'meaning', isEn2Ko:false, qStyle:'mc'});
  // 한→영 주관식
  for(let i=0;i<subjKo2En&&idx<shuffled.length;i++,idx++)
    questions.push({...shuffled[idx], testType:'meaning', isEn2Ko:false, qStyle:'subj'});

  // 섞기
  questions.sort(()=>Math.random()-0.5);
  questions.forEach((q,i)=>q.num=i+1);

  printMixedExamPDF(questions, examName, academy, today, ptype, allWords);
};

function printMixedExamPDF(questions, examName, academy, date, ptype, allWords){
  // 객관식 보기 캐시
  const choicesCache = {};
  questions.forEach(q=>{
    if(q.qStyle==='mc'){
      const answer = q.isEn2Ko ? q.ko : q.en;
      const others = allWords.filter(w=>w.en!==q.en).sort(()=>Math.random()-0.5).slice(0,3);
      const choices = [...others.map(o=>q.isEn2Ko?o.ko:o.en), answer].sort(()=>Math.random()-0.5);
      choicesCache[q.num] = { choices, ansIdx: choices.indexOf(answer)+1 };
    }
  });

  const makeQHTML = (q, showAnswer) => {
    const question = q.isEn2Ko ? q.en : q.ko;
    const answer   = q.isEn2Ko ? q.ko : q.en;
    if(q.qStyle === 'subj') return `
      <div style="margin-bottom:18px;break-inside:avoid;">
        <div style="font-size:11pt;font-weight:700;margin-bottom:5px;">
          ${q.num}. ${question}
          ${showAnswer ? `<span style="font-weight:400;color:#1a6b1a;font-size:10pt;margin-left:8px;">${answer}</span>` : ''}
        </div>
        ${!showAnswer ? `<div style="border-bottom:1.5px solid #333;width:85%;margin-left:4px;">&nbsp;</div>` : ''}
      </div>`;
    const { choices=[], ansIdx=0 } = choicesCache[q.num] || {};
    return `
      <div style="margin-bottom:16px;break-inside:avoid;">
        <div style="font-size:11pt;font-weight:700;margin-bottom:4px;">
          ${q.num}. ${question}
          ${showAnswer ? `<span style="font-size:9pt;font-weight:400;color:#555;">(정답: ${ansIdx}번)</span>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px 6px;font-size:9.5pt;padding-left:6px;">
          ${choices.map((c,i)=>`<div style="${showAnswer&&(i+1===ansIdx)?'font-weight:700;color:#1a6b1a;':''}">${i+1}. ${c}</div>`).join('')}
        </div>
      </div>`;
  };

  // 페이지당 문제 수 기준으로 분할
  const PER_PAGE = 26;
  const pageGroups = [];
  for(let i=0;i<questions.length;i+=PER_PAGE) pageGroups.push(questions.slice(i,i+PER_PAGE));
  const totalPages = pageGroups.length;

  // 헤더 높이 (인쇄용 - 미리보기와 동일)
  // 제목(15pt≈20px)+mb10 + 학교란(≈26px)+pb6+mb14 = 약 76px
  const HEADER_H = '76px';

  const makeOnePage = (qs, pgIdx, isAnswer) => {
    const half = Math.ceil(qs.length/2);
    const titleSuffix = isAnswer ? ' (답안지)' : '';
    const header = pgIdx===0 ? `
      <div style="font-size:15pt;font-weight:900;margin-bottom:10px;">${examName}${titleSuffix}</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #000;padding-bottom:6px;margin-bottom:14px;">
        <div style="font-size:9.5pt;font-weight:700;">학원명 : <span style="font-weight:400;">${academy}</span></div>
        <div style="font-size:8.5pt;">
          학교 : <span style="display:inline-block;width:70px;border-bottom:1px solid #000;">&nbsp;</span>
          &nbsp;학년 : <span style="display:inline-block;width:28px;border-bottom:1px solid #000;">&nbsp;</span>
          &nbsp;반 : <span style="display:inline-block;width:28px;border-bottom:1px solid #000;">&nbsp;</span>
          &nbsp;이름 : <span style="display:inline-block;width:70px;border-bottom:1px solid #000;">&nbsp;</span>
        </div>
      </div>` : `
      <div style="height:${HEADER_H};display:flex;align-items:flex-end;padding-bottom:14px;border-bottom:1px solid #eee;margin-bottom:14px;box-sizing:border-box;">
        <span style="font-size:8pt;color:#aaa;">${examName}${titleSuffix} — ${pgIdx+1} / ${totalPages}</span>
      </div>`;
    return `
      <div style="page-break-after:always;padding:16px 22px 12px;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;background:white;">
        ${header}
        <div style="display:grid;grid-template-columns:1fr 1px 1fr;gap:0 18px;">
          <div>${qs.slice(0,half).map(q=>makeQHTML(q,isAnswer)).join('')}</div>
          <div style="background:#ccc;"></div>
          <div style="padding-left:18px;">${qs.slice(half).map(q=>makeQHTML(q,isAnswer)).join('')}</div>
        </div>
        ${totalPages>1?`<div style="text-align:right;font-size:8pt;color:#bbb;margin-top:6px;">— ${pgIdx+1} / ${totalPages} —</div>`:''}
      </div>`;
  };

  let pageHTML = '';
  if(ptype==='both'||ptype==='exam')
    pageGroups.forEach((qs,i)=>{ pageHTML += makeOnePage(qs,i,false); });
  if(ptype==='both'||ptype==='answer')
    pageGroups.forEach((qs,i)=>{ pageHTML += makeOnePage(qs,i,true); });

  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${examName}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;background:white;}
      @media print{
        @page{margin:10mm;size:A4;}
        body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      }
    </style>
    </head><body>${pageHTML}
    <script>window.onload=()=>{window.print();}<\/script></body></html>`);
  win.document.close();
}

window.generatePDF = () => { showToast('시험지 출력 메뉴에서 교재를 선택 후 출력하세요.'); };
window.selectPrintTest = async() => {};
window.toggleTestActive = async(testId, isActive) => {
  await updateDoc(doc(db,'tests',testId),{active:!isActive});
  showToast(isActive?'시험이 종료됐어요.':'시험이 재개됐어요.');
  await loadTestList();
};
window.doPrintSelected = () => {};
window.testNextStep = (step) => { showToast('단계를 순서대로 진행하세요.'); };
window.setStudentMode = (id,mode) => { showToast(mode.toUpperCase()+' 모드 설정 준비 중...'); };
// ═══════════════════════════════════════════════════════
// 녹음숙제 관리
// ═══════════════════════════════════════════════════════
// 녹음숙제 관리
// ═══════════════════════════════════════════════════════
let _recFolders = [], _recCurrentFolderId = null, _recContents = [];
let _recAssignTargets = [], _recSelectedContents = [];

// ── 숙제목록 작성 (MyBook 구조) ──────────────────────────
window.loadRecContent = async() => {
  await loadRecFolderTable();
};

async function loadRecFolderTable(){
  const el = document.getElementById('recFolderTableBody'); if(!el) return;
  el.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#bbb;padding:20px;">로딩 중...</td></tr>';
  try{
    const snap = await getDocs(query(collection(db,'recFolders'),orderBy('createdAt','asc')));
    _recFolders = snap.docs.map(d=>({id:d.id,...d.data()}));
    if(!_recFolders.length){
      el.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#bbb;padding:20px;">폴더가 없습니다</td></tr>';
      return;
    }
    // 각 폴더의 숙제 수 가져오기
    const counts = await Promise.all(_recFolders.map(async f=>{
      const s = await getDocs(query(collection(db,'recContents'),where('folderId','==',f.id)));
      return s.size;
    }));
    el.innerHTML = _recFolders.map((f,i)=>`
      <tr style="cursor:pointer;" onclick="selectRecFolderRow('${f.id}','${f.name.replace(/'/g,"\'")}');this.parentElement.querySelectorAll('tr').forEach(r=>r.style.background='');this.style.background='#e0f5f5';">
        <td><input type="checkbox" value="${f.id}"></td>
        <td>${i+1}</td>
        <td style="font-weight:600;">📁 ${esc(f.name)}</td>
        <td style="text-align:center;">${counts[i]}개</td>
        <td style="color:var(--gray);font-size:12px;">${f.createdAt?.toDate?f.createdAt.toDate().toLocaleDateString('ko-KR'):'-'}</td>
      </tr>`).join('');
  }catch(e){ el.innerHTML=`<tr><td colspan="5" style="color:#e05050;text-align:center;padding:16px;">불러오기 실패</td></tr>`; }
}

window.selectRecFolderRow = async(folderId, folderName) => {
  _recCurrentFolderId = folderId;
  const label = document.getElementById('recContentLabel');
  const selLabel = document.getElementById('recFolderSelectedLabel');
  if(label) label.textContent = `📁 ${folderName}`;
  if(selLabel) selLabel.textContent = '선택됨';
  await loadRecContentTable(folderId);
};

async function loadRecContentTable(folderId){
  const el = document.getElementById('recContentTableBody'); if(!el) return;
  el.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#bbb;padding:20px;">로딩 중...</td></tr>';
  try{
    const snap = await getDocs(query(collection(db,'recContents'),where('folderId','==',folderId)));
    _recContents = snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));
    if(!_recContents.length){
      el.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#bbb;padding:20px;">숙제 내용이 없습니다<br>위 + 추가 버튼으로 작성하세요</td></tr>';
      return;
    }
    el.innerHTML = _recContents.map((c,i)=>`
      <tr>
        <td><input type="checkbox" value="${c.id}"></td>
        <td>${i+1}</td>
        <td style="font-weight:600;cursor:pointer;color:var(--teal);" onclick="editRecContent('${c.id}')">📄 ${esc(c.title)||'제목없음'}</td>
        <td style="color:var(--gray);font-size:12px;max-width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${esc((c.content||'').split('\n')[0])}</td>
        <td style="color:var(--gray);font-size:12px;">${c.createdAt?.toDate?c.createdAt.toDate().toLocaleDateString('ko-KR'):'-'}</td>
      </tr>`).join('');
  }catch(e){ el.innerHTML=`<tr><td colspan="5" style="color:#e05050;text-align:center;padding:16px;">불러오기 실패</td></tr>`; }
}

window.openRecFolderModal = () => {
  showModal(`
    <div style="font-size:16px;font-weight:700;margin-bottom:16px;">📁 폴더 추가</div>
    <input id="recFolderName" type="text" placeholder="폴더명 (예: 중3 교재, Arthur 시리즈)"
      style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;outline:none;margin-bottom:16px;">
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="saveRecFolder()" style="flex:1;justify-content:center;">저장</button>
    </div>`);
  setTimeout(()=>document.getElementById('recFolderName')?.focus(),100);
};

window.saveRecFolder = async() => {
  const name = document.getElementById('recFolderName')?.value.trim();
  if(!name){ showToast('폴더명을 입력하세요.'); return; }
  await addDoc(collection(db,'recFolders'),{name, createdAt:serverTimestamp()});
  closeModal(); showToast('폴더가 추가됐어요!');
  await loadRecFolderTable();
};

window.deleteSelectedRecFolder = async() => {
  const ids = getCheckedIds('recFolderTableBody');
  if(!ids.length){ showToast('삭제할 폴더를 선택하세요.'); return; }
  if(!(await showConfirm(`선택한 폴더 ${ids.length}개를 삭제할까요?\n폴더 내 숙제 목록도 모두 삭제됩니다.`))) return;
  for(const id of ids){
    const snap = await getDocs(query(collection(db,'recContents'),where('folderId','==',id)));
    for(const d of snap.docs) await deleteDoc(d.ref);
    await deleteDoc(doc(db,'recFolders',id));
    if(_recCurrentFolderId===id) _recCurrentFolderId=null;
  }
  showToast('삭제됐어요.');
  await loadRecFolderTable();
  document.getElementById('recContentTableBody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:#bbb;padding:20px;">폴더를 선택하세요</td></tr>';
};

window.openRecContentModal = (existingId) => {
  if(!_recCurrentFolderId){ showToast('먼저 오른쪽에서 폴더를 선택하세요.'); return; }
  showModal(`
    <div style="font-size:16px;font-weight:700;margin-bottom:14px;">${existingId?'✏️ 숙제 내용 수정':'📝 숙제 내용 추가'}</div>
    <div style="margin-bottom:10px;">
      <div style="font-size:12px;color:var(--gray);margin-bottom:4px;">제목 (교재명/단원 등)</div>
      <input id="recContentTitle" type="text" placeholder="예: Arthur Chapter 3"
        style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;">
    </div>
    <div style="margin-bottom:14px;">
      <div style="font-size:12px;color:var(--gray);margin-bottom:4px;">숙제 내용</div>
      <textarea id="recContentBody" rows="6" placeholder="예: XX교재 Page 23, 시작문장 ~ Page 26 종료문장"
        style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;resize:vertical;outline:none;line-height:1.6;"></textarea>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="saveRecContent('${existingId||''}')" style="flex:2;justify-content:center;">💾 저장</button>
    </div>`);
  if(existingId){
    getDoc(doc(db,'recContents',existingId)).then(snap=>{
      const d=snap.data();
      if(document.getElementById('recContentTitle')) document.getElementById('recContentTitle').value=d.title||'';
      if(document.getElementById('recContentBody')) document.getElementById('recContentBody').value=d.content||'';
    });
  }
  setTimeout(()=>document.getElementById('recContentTitle')?.focus(),100);
};

window.editRecContent = (id) => { openRecContentModal(id); };
window.editSelectedRecContent = () => {
  const ids = getCheckedIds('recContentTableBody');
  if(ids.length!==1){ showToast('수정할 항목을 하나만 선택하세요.'); return; }
  editRecContent(ids[0]);
};

window.saveRecContent = async(existingId) => {
  const title = document.getElementById('recContentTitle')?.value.trim();
  const content = document.getElementById('recContentBody')?.value.trim();
  if(!title){ showToast('제목을 입력하세요.'); return; }
  if(!content){ showToast('숙제 내용을 입력하세요.'); return; }
  if(existingId){
    await updateDoc(doc(db,'recContents',existingId),{title,content,updatedAt:serverTimestamp()});
    showToast('수정됐어요!');
  } else {
    await addDoc(collection(db,'recContents'),{title,content,folderId:_recCurrentFolderId,createdAt:serverTimestamp()});
    showToast('추가됐어요!');
  }
  closeModal();
  if(_recCurrentFolderId) await loadRecContentTable(_recCurrentFolderId);
};

window.deleteSelectedRecContent = async() => {
  const ids = getCheckedIds('recContentTableBody');
  if(!ids.length){ showToast('삭제할 항목을 선택하세요.'); return; }
  if(!(await showConfirm(`선택한 항목 ${ids.length}개를 삭제할까요?`))) return;
  for(const id of ids) await deleteDoc(doc(db,'recContents',id));
  showToast('삭제됐어요.');
  if(_recCurrentFolderId) await loadRecContentTable(_recCurrentFolderId);
  await loadRecFolderTable();
};

// ── 숙제 생성 (시험출제 구조) ─────────────────────────────

function updateRecStepUI(step){
  [1,2,3].forEach(i=>{
    const el = document.getElementById('rsti-'+i); if(!el) return;
    const circle = el.querySelector('.step-circle');
    if(i < step){
      el.style.color='var(--teal)'; circle.style.background='var(--teal)'; circle.style.color='white'; circle.textContent='✓';
    } else if(i === step){
      el.style.color='var(--teal)'; circle.style.background='var(--teal)'; circle.style.color='white'; circle.textContent=i;
    } else {
      el.style.color='var(--gray)'; circle.style.background='#eee'; circle.style.color='var(--gray)'; circle.textContent=i;
    }
  });
}

window.loadRecAssign = async() => {
  _recAssignTargets = [];
  _recSelectedContents = [];
  await renderRecStep1();
};

async function renderRecStep1(){
  updateRecStepUI(1);
  // 시험출제 Step1과 동일한 방식으로 학생 로드
  const usersSnap = await getDocs(query(collection(db,'users'),where('role','==','student'),where('status','==','active')));
  const students = usersSnap.docs.map(d=>({id:d.id,...d.data()}));
  const groupMap = {};
  students.forEach(u=>{ const g=u.group||'미배정'; if(!groupMap[g])groupMap[g]=[]; groupMap[g].push(u); });
  Object.keys(groupMap).forEach(g=>groupMap[g].sort((a,b)=>(a.name||'').localeCompare(b.name||'','ko')));
  const groups = Object.keys(groupMap).sort((a,b)=>a.localeCompare(b,'ko'));

  document.getElementById('recAssignContent').innerHTML = `
    <div style="font-size:14px;font-weight:600;margin-bottom:16px;">① 숙제 대상 선택</div>
    <div style="display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start;">
      <div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:6px;font-weight:600;">
          클래스 / 학생 선택 <span style="font-weight:400;">(반 클릭: 전체선택, 학생 클릭: 개별선택)</span>
        </div>
        <div style="margin-bottom:8px;">
          <input type="text" id="recSearchInput" placeholder="🔍 학생 이름 검색..." oninput="filterRecTree(this.value)"
            style="width:100%;border:1px solid var(--border);border-radius:8px;padding:7px 12px;font-size:13px;outline:none;">
        </div>
        <div class="target-tree" id="recTargetTree">
          ${groups.map(g=>`
            <div>
              <div class="tree-class-row" id="rcls-${g}" onclick="toggleRecTreeClass('${g}')">
                <span class="tree-toggle">›</span>
                <input type="checkbox" id="rchk-cls-${g}" onclick="event.stopPropagation();toggleRecClassCheck('${g}')" style="cursor:pointer;">
                <span>👥 ${g}</span>
                <span style="margin-left:auto;font-size:11px;color:#aaa;">${groupMap[g].length}명</span>
              </div>
              <div class="tree-student-list" id="rlist-${g}">
                ${groupMap[g].map(u=>`
                  <div class="tree-student-row" id="rstd-${u.id}" onclick="toggleRecStudentCheck('${u.id}','${u.name.replace(/'/g,"\'")}','${g}')">
                    <input type="checkbox" id="rchk-${u.id}" onclick="event.stopPropagation();toggleRecStudentCheck('${u.id}','${u.name.replace(/'/g,"\'")}','${g}')" style="cursor:pointer;">
                    <span style="color:var(--gray);font-size:11px;width:14px;">${groupMap[g].indexOf(u)+1}</span>
                    <span>👤 ${esc(u.name)}</span>
                  </div>`).join('')}
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:6px;font-weight:600;">
          선택된 대상 <span id="recTargetCount" style="color:var(--teal);">0명</span>
          <button onclick="clearRecTargets()" style="margin-left:8px;background:none;border:none;color:#bbb;cursor:pointer;font-size:11px;">전체해제</button>
        </div>
        <div class="selected-tags" id="recSelectedTags">
          <span style="color:#bbb;font-size:12px;align-self:center;">대상을 선택하세요</span>
        </div>
        <div style="margin-top:16px;padding:10px 12px;background:#f8f9fa;border-radius:8px;font-size:12px;color:var(--gray);">
          선택된 반은 배정 시 해당 반 전체 학생에게 적용됩니다.
        </div>
      </div>
    </div>
    <div style="margin-top:16px;text-align:right;">
      <button class="btn btn-primary" onclick="recStep1Next()">다음 → 숙제 선택</button>
    </div>`;
}

window.toggleRecTreeClass = (g) => {
  document.getElementById('rcls-'+g)?.classList.toggle('expanded');
  document.getElementById('rlist-'+g)?.classList.toggle('open');
};
window.toggleRecClassCheck = (g) => {
  const cb = document.getElementById('rchk-cls-'+g);
  const isChecked = cb.checked;
  if(isChecked){
    if(!_recAssignTargets.find(t=>t.type==='class'&&t.id===g)){
      _recAssignTargets = _recAssignTargets.filter(t=>!(t.type==='student'&&t.groupName===g));
      _recAssignTargets.push({type:'class',id:g,name:g+' 전체',groupName:g});
    }
    // 학생 체크박스 전체 체크 + 열기
    document.querySelectorAll('#rlist-'+g+' input[type=checkbox]').forEach(c=>c.checked=true);
    document.querySelectorAll('#rlist-'+g+' .tree-student-row').forEach(r=>r.classList.add('selected'));
    document.getElementById('rcls-'+g)?.classList.add('expanded');
    document.getElementById('rlist-'+g)?.classList.add('open');
  } else {
    _recAssignTargets = _recAssignTargets.filter(t=>!(t.id===g&&t.type==='class'));
    document.querySelectorAll('#rlist-'+g+' input[type=checkbox]').forEach(c=>c.checked=false);
    document.querySelectorAll('#rlist-'+g+' .tree-student-row').forEach(r=>r.classList.remove('selected'));
  }
  updateRecTargetTags();
};
window.toggleRecStudentCheck = (uid, name, g) => {
  const cb = document.getElementById('rchk-'+uid);
  const row = document.getElementById('rstd-'+uid);
  const isNowChecked = !cb.checked;
  cb.checked = isNowChecked;
  if(isNowChecked){
    row?.classList.add('selected');
    _recAssignTargets = _recAssignTargets.filter(t=>!(t.type==='class'&&t.id===g));
    const clsCb=document.getElementById('rchk-cls-'+g); if(clsCb)clsCb.checked=false;
    if(!_recAssignTargets.find(t=>t.id===uid))
      _recAssignTargets.push({type:'student',id:uid,name,groupName:g});
  } else {
    row?.classList.remove('selected');
    _recAssignTargets = _recAssignTargets.filter(t=>t.id!==uid);
  }
  updateRecTargetTags();
};
window.clearRecTargets = () => {
  _recAssignTargets = [];
  document.querySelectorAll('[id^="rchk-"]').forEach(el=>el.checked=false);
  document.querySelectorAll('.tree-student-row').forEach(r=>r.classList.remove('selected'));
  updateRecTargetTags();
};
function updateRecTargetTags(){
  const cnt = document.getElementById('recTargetCount');
  const tags = document.getElementById('recSelectedTags');
  if(cnt) cnt.textContent = _recAssignTargets.length+'명/반';
  if(tags){
    if(!_recAssignTargets.length){
      tags.innerHTML='<span style="color:#bbb;font-size:12px;align-self:center;">대상을 선택하세요</span>';
      return;
    }
    tags.innerHTML = _recAssignTargets.map(t=>`
      <span class="tag" onclick="removeRecTarget('${t.id}')" style="cursor:pointer;">${t.name} ✕</span>`).join('');
  }
}
window.removeRecTarget = (id) => {
  _recAssignTargets = _recAssignTargets.filter(t=>t.id!==id);
  const cb=document.getElementById('rchk-'+id)||document.getElementById('rchk-cls-'+id);
  if(cb) cb.checked=false;
  document.getElementById('rstd-'+id)?.classList.remove('selected');
  updateRecTargetTags();
};
window.filterRecTree = (val) => {
  const v=val.toLowerCase();
  document.querySelectorAll('[id^="rstd-"]').forEach(el=>{
    el.style.display=!v||el.textContent.toLowerCase().includes(v)?'':'none';
  });
  if(v){
    document.querySelectorAll('.tree-class-row').forEach(r=>r.classList.add('expanded'));
    document.querySelectorAll('.tree-student-list').forEach(l=>l.classList.add('open'));
  }
};
window.recStep1Next = () => {
  if(!_recAssignTargets.length){ showToast('대상을 선택하세요.'); return; }
  renderRecStep2();
};

async function renderRecStep2(){
  updateRecStepUI(2);
  const targetName = _recAssignTargets.length===1 ? _recAssignTargets[0].name : `${_recAssignTargets.length}명/반 선택`;
  const folderSnap = await getDocs(query(collection(db,'recFolders'),orderBy('createdAt','asc')));
  const folders = folderSnap.docs.map(d=>({id:d.id,...d.data()}));
  const foldersWithContents = await Promise.all(folders.map(async f=>{
    const cSnap = await getDocs(query(collection(db,'recContents'),where('folderId','==',f.id)));
    return {...f, contents: cSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0))};
  }));

  // 폴더→숙제내용 트리 HTML 생성 (시험출제 Step2와 동일 구조)
  const treeHtml = foldersWithContents.filter(f=>f.contents.length).map(f=>`
    <div>
      <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:#f0f4f8;border-bottom:1px solid var(--border);cursor:pointer;"
        onclick="toggleTreeNode('rc-f-${f.id}','rc-ft-${f.id}')">
        <span id="rc-ft-${f.id}" style="font-size:11px;color:var(--teal);transition:.2s;">›</span>
        <span style="font-weight:700;font-size:13px;">📁 ${esc(f.name)}</span>
        <span style="margin-left:auto;font-size:11px;color:#aaa;">${f.contents.length}개</span>
      </div>
      <div id="rc-f-${f.id}" style="display:none;">
        ${f.contents.map(c=>`
          <div style="display:flex;align-items:flex-start;gap:8px;padding:9px 12px 9px 28px;border-bottom:1px solid #f5f5f5;cursor:pointer;"
            onclick="toggleRecContent('${c.id}','${(c.title||'').replace(/'/g,"\\'")}','${(c.content||'').replace(/'/g,"\\'").replace(/\n/g,'\\n')}')">
            <input type="checkbox" id="rc-chk-${c.id}" style="cursor:pointer;margin-top:2px;flex-shrink:0;"
              onclick="event.stopPropagation();toggleRecContent('${c.id}','${(c.title||'').replace(/'/g,"\\'")}','${(c.content||'').replace(/'/g,"\\'").replace(/\n/g,'\\n')}')">
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;">📄 ${c.title||'제목없음'}</div>
              <div style="font-size:11px;color:var(--gray);margin-top:2px;">${(c.content||'').split('\\n')[0].slice(0,60)}...</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('') || '<div style="padding:20px;text-align:center;color:#bbb;">숙제 내용이 없습니다<br>먼저 숙제목록 작성에서 내용을 추가하세요</div>';

  document.getElementById('recAssignContent').innerHTML = `
    <div style="font-size:14px;font-weight:600;margin-bottom:16px;">② 숙제 선택</div>
    <div style="display:grid;grid-template-columns:1fr 320px;gap:16px;">
      <!-- 폴더→숙제 트리 -->
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;max-height:420px;">
        <div style="padding:10px 14px;background:#f8f9fa;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;flex-shrink:0;">
          📁 폴더 / 숙제 목록
        </div>
        <div id="recContentTree" style="overflow-y:auto;flex:1;">${treeHtml}</div>
      </div>
      <!-- 선택된 숙제 목록 -->
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;flex:1;">
          <div style="padding:10px 14px;background:#f8f9fa;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;display:flex;justify-content:space-between;align-items:center;">
            <span>✅ 선택된 숙제</span>
            <button onclick="clearRecContentSel()" style="background:none;border:none;color:#bbb;font-size:11px;cursor:pointer;">전체 해제</button>
          </div>
          <div id="recSelectedContentList" style="padding:8px;max-height:200px;overflow-y:auto;font-size:13px;color:#bbb;min-height:40px;">
            숙제를 선택하세요
          </div>
        </div>
        <div>
          <div style="font-size:12px;color:var(--gray);margin-bottom:4px;">제출 마감일 (선택)</div>
          <input type="date" id="recDueDate" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;">
        </div>
        <div style="padding:10px 12px;background:#f0fafa;border:1px solid var(--teal-light);border-radius:8px;font-size:12px;color:var(--gray);">
          📌 대상: <b style="color:var(--text);">${targetName}</b>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="loadRecAssign()">← 이전</button>
      <button class="btn btn-primary" onclick="recStep2Next()">다음 → 생성 확인</button>
    </div>`;
}

// 선택된 숙제 목록 관리
window.toggleRecContent = (id, title, content) => {
  const cb = document.getElementById('rc-chk-'+id);
  const exists = _recSelectedContents.find(c=>c.id===id);
  if(exists){
    _recSelectedContents = _recSelectedContents.filter(c=>c.id!==id);
    if(cb) cb.checked = false;
  } else {
    _recSelectedContents.push({id, title, content:content.replace(/\\n/g,'\n')});
    if(cb) cb.checked = true;
  }
  renderRecSelectedList();
};
window.clearRecContentSel = () => {
  _recSelectedContents = [];
  document.querySelectorAll('[id^="rc-chk-"]').forEach(el=>el.checked=false);
  renderRecSelectedList();
};
function renderRecSelectedList(){
  const el = document.getElementById('recSelectedContentList'); if(!el) return;
  if(!_recSelectedContents.length){
    el.innerHTML='<div style="color:#bbb;padding:8px;font-size:13px;">숙제를 선택하세요</div>';
    return;
  }
  el.innerHTML = _recSelectedContents.map(c=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-bottom:1px solid #f5f5f5;font-size:13px;">
      <span>📄 ${c.title}</span>
      <button onclick="toggleRecContent('${c.id}','${c.title.replace(/'/g,"\\'")}','')" style="background:none;border:none;color:#bbb;cursor:pointer;font-size:12px;">✕</button>
    </div>`).join('');
}

window.recStep2Next = () => {
  if(!_recSelectedContents.length){ showToast('숙제 내용을 선택하세요.'); return; }
  const dueDate = document.getElementById('recDueDate')?.value||'';
  renderRecStep3(_recSelectedContents, dueDate);
};

function renderRecStep3(contents, dueDate){
  updateRecStepUI(3);
  const targetName = _recAssignTargets.length===1 ? _recAssignTargets[0].name : `${_recAssignTargets.length}명/반 선택`;
  document.getElementById('recAssignContent').innerHTML = `
    <div style="font-size:14px;font-weight:600;margin-bottom:16px;">③ 생성 확인</div>
    <div style="background:#f0fafa;border:1px solid var(--teal-light);border-radius:12px;padding:16px 20px;margin-bottom:20px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div>
        <div style="color:var(--gray);font-size:11px;margin-bottom:3px;">대상</div>
        <div style="font-weight:600;">${targetName}</div>
      </div>
      <div>
        <div style="color:var(--gray);font-size:11px;margin-bottom:3px;">마감일</div>
        <div style="font-weight:600;">${dueDate||'미설정'}</div>
      </div>
      <div style="grid-column:1/-1;">
        <div style="color:var(--gray);font-size:11px;margin-bottom:6px;">숙제 내용 (${contents.length}개)</div>
        ${contents.map(c=>`<div style="font-size:13px;padding:4px 0;border-bottom:1px solid #e0f0f0;">📄 ${c.title}</div>`).join('')}
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="loadRecAssign()">← 처음으로</button>
      <button class="btn btn-primary" id="recCreateBtn" onclick="createRecHw(${JSON.stringify(contents).replace(/"/g,'&quot;')},'${dueDate}')" style="min-width:140px;justify-content:center;padding:10px 20px;">🎙 숙제 생성</button>
    </div>`;
}

window.createRecHw = async(contents, dueDate) => {
  const btn = document.getElementById('recCreateBtn');
  if(btn){ btn.textContent='생성 중...'; btn.disabled=true; }
  const today = new Date().toISOString().slice(0,10);
  const targetName = _recAssignTargets.length===1 ? _recAssignTargets[0].name : `${_recAssignTargets.length}명/반 선택`;
  try{
    for(const c of contents){
      await addDoc(collection(db,'recHw'),{
        contentId:c.id, title:c.title, content:c.content,
        targets:[..._recAssignTargets], targetName,
        dueDate:dueDate||'', active:true,
        date:today, createdAt:serverTimestamp(), createdBy:currentUser.uid
      });
    }
    document.getElementById('recAssignContent').innerHTML = `
      <div style="text-align:center;padding:48px 20px;">
        <div style="font-size:48px;margin-bottom:12px;">🎉</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:8px;">숙제 생성 완료!</div>
        <div style="font-size:13px;color:var(--gray);margin-bottom:20px;">${targetName}에게 ${contents.length}개 숙제가 배정됐어요.</div>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button class="btn btn-secondary" onclick="loadRecAssign()">+ 새 숙제 생성</button>
          <button class="btn btn-primary" onclick="goPage('rec-status')">📋 제출 현황 확인</button>
        </div>
      </div>`;
    // 스텝 완료 표시
    [1,2,3].forEach(i=>{
      const el=document.getElementById('rsti-'+i); if(!el) return;
      const c=el.querySelector('.step-circle');
      el.style.color='var(--teal)'; c.style.background='var(--teal)'; c.style.color='white'; c.textContent='✓';
    });
  }catch(e){ showToast('생성 실패: '+e.message); if(btn){btn.textContent='🎙 숙제 생성';btn.disabled=false;} }
};

// ── 제출 현황 ──────────────────────────────────────────────
window.loadRecStatus = async() => {
  const el = document.getElementById('recStatusHwList'); if(!el) return;
  el.innerHTML = '<div style="padding:16px;text-align:center;color:#bbb;">로딩 중...</div>';
  try{
    const snap = await getDocs(query(collection(db,'recHw'),orderBy('createdAt','desc')));
    // active:false 제외 (삭제된 숙제 숨김)
    const hws = snap.docs.map(d=>({id:d.id,...d.data()})).filter(hw=>hw.active!==false);
    el.innerHTML = hws.map(hw=>`
      <div style="border-bottom:1px solid #f5f5f5;">
        <div onclick="loadRecHwDetail('${hw.id}','${(hw.title||'').replace(/'/g,"\\'")}') "
          style="padding:12px 16px 8px;cursor:pointer;font-size:13px;"
          onmouseover="this.parentElement.style.background='#f8f9fa'" onmouseout="this.parentElement.style.background=''">
          <div style="font-weight:600;margin-bottom:2px;">📄 ${esc(hw.title)||'-'}</div>
          <div style="font-size:11px;color:var(--gray);">${esc(hw.targetName)||'-'} · ${hw.date||''} ${hw.dueDate?'~ '+hw.dueDate:''}</div>
        </div>
        <div style="padding:0 12px 10px;display:flex;gap:6px;">
          <button onclick="editRecHw('${hw.id}')" class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 8px;">✏️ 수정</button>
          <button onclick="deleteRecHw('${hw.id}','${(hw.title||'').replace(/'/g,"\\'")}') " class="btn btn-sm" style="font-size:11px;padding:3px 8px;background:#fee2e2;color:#b91c1c;border:none;border-radius:6px;cursor:pointer;">🗑 삭제</button>
        </div>
      </div>`).join('') || '<div style="padding:20px;text-align:center;color:#bbb;">생성된 숙제가 없습니다</div>';
  }catch(e){ el.innerHTML='<div style="padding:16px;color:#e05050;">불러오기 실패</div>'; }
};

window.editRecHw = async(hwId) => {
  const snap = await getDoc(doc(db,'recHw',hwId));
  if(!snap.exists()) return;
  const hw = snap.data();
  showModal(`
    <div style="font-size:16px;font-weight:700;margin-bottom:14px;">✏️ 숙제 수정</div>
    <div style="margin-bottom:10px;">
      <div style="font-size:12px;color:var(--gray);margin-bottom:4px;">제목</div>
      <input id="editHwTitle" value="${(hw.title||'').replace(/"/g,'&quot;')}"
        style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;">
    </div>
    <div style="margin-bottom:10px;">
      <div style="font-size:12px;color:var(--gray);margin-bottom:4px;">숙제 내용</div>
      <textarea id="editHwContent" rows="5"
        style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;resize:vertical;outline:none;">${hw.content||''}</textarea>
    </div>
    <div style="margin-bottom:14px;">
      <div style="font-size:12px;color:var(--gray);margin-bottom:4px;">마감일</div>
      <input type="date" id="editHwDue" value="${hw.dueDate||''}"
        style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;">
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="saveRecHwEdit('${hwId}')" style="flex:2;justify-content:center;">💾 저장</button>
    </div>`);
};

window.saveRecHwEdit = async(hwId) => {
  const title = document.getElementById('editHwTitle')?.value.trim();
  const content = document.getElementById('editHwContent')?.value.trim();
  const dueDate = document.getElementById('editHwDue')?.value||'';
  if(!title){ showToast('제목을 입력하세요.'); return; }
  await updateDoc(doc(db,'recHw',hwId),{title,content,dueDate,updatedAt:serverTimestamp()});
  showToast('수정됐어요!'); closeModal();
  await loadRecStatus();
};

window.deleteRecHw = async(hwId, title) => {
  if(!(await showConfirm(`"${title}" 숙제를 완전히 삭제할까요?\n\n⚠️ 학생들의 녹음 파일과 제출 기록, 피드백이 모두 삭제됩니다.`))) return;

  const el = document.getElementById('recStatusHwList');
  if(el) el.innerHTML = '<div style="padding:16px;text-align:center;color:#bbb;">삭제 중...</div>';

  try{
    // 1. 제출된 녹음 파일 Storage에서 삭제
    const subSnap = await getDocs(query(collection(db,'recSubmissions'),where('hwId','==',hwId)));
    for(const d of subSnap.docs){
      const path = d.data().storagePath;
      if(path){
        try{ await deleteObject(ref(storage, path)); }catch(e){ console.log('스토리지 삭제 실패',e); }
      }
    }
    // 2. recSubmissions 삭제
    for(const d of subSnap.docs) await deleteDoc(d.ref);

    // 3. recFeedbacks 삭제
    const fbSnap = await getDocs(query(collection(db,'recFeedbacks'),where('hwId','==',hwId)));
    for(const d of fbSnap.docs) await deleteDoc(d.ref);

    // 4. recHw 문서 삭제
    await deleteDoc(doc(db,'recHw',hwId));

    showToast('✅ 숙제와 관련 데이터가 모두 삭제됐어요.');
    // 오른쪽 패널 초기화
    const detailEl = document.getElementById('recStatusDetail');
    if(detailEl) detailEl.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;">왼쪽에서 숙제를 선택하세요</div>';
    const titleEl = document.getElementById('recStatusTitle');
    if(titleEl) titleEl.textContent = '학생별 제출 현황';
    await loadRecStatus();
  }catch(e){
    showToast('삭제 실패: '+e.message);
    await loadRecStatus();
  }
};

let _currentHwId = null;
window.loadRecHwDetail = async(hwId, title) => {
  _currentHwId = hwId;
  const detailEl = document.getElementById('recStatusDetail');
  const titleEl = document.getElementById('recStatusTitle');
  if(titleEl) titleEl.textContent = `📄 ${title}`;
  if(detailEl) detailEl.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;">로딩 중...</div>';
  try{
    const hwDoc = await getDoc(doc(db,'recHw',hwId));
    const hw = hwDoc.data();

    // 제출 내역
    const subSnap = await getDocs(query(collection(db,'recSubmissions'),where('hwId','==',hwId)));
    const subs = {}; // uid → [slot1, slot2, slot3]
    subSnap.docs.forEach(d=>{ const s=d.data(); if(!subs[s.uid])subs[s.uid]=[]; subs[s.uid].push(s); });

    // 피드백 내역 (학생별 1개: hwId+uid)
    const fbSnap = await getDocs(query(collection(db,'recFeedbacks'),where('hwId','==',hwId)));
    const fbs = {}; // uid → {feedback, docId}
    fbSnap.docs.forEach(d=>{ const f=d.data(); fbs[f.uid]={...f, docId:d.id}; });

    // 대상 학생
    const targets = hw.targets||[];
    let studentIds = [];
    for(const t of targets){
      if(t.type==='student') studentIds.push({uid:t.id, name:t.name, group:''});
      else {
        const gs = await getDocs(query(collection(db,'users'),where('group','==',t.id)));
        gs.docs.filter(d=>d.data().role==='student').forEach(d=>studentIds.push({uid:d.id,name:d.data().name,group:d.data().group||''}));
      }
    }
    const seen=new Set(); studentIds=studentIds.filter(s=>{if(seen.has(s.uid))return false;seen.add(s.uid);return true;});
    studentIds.sort((a,b)=>a.name.localeCompare(b.name,'ko'));

    const submitted = studentIds.filter(s=>(subs[s.uid]||[]).length>0).length;
    const full = studentIds.filter(s=>(subs[s.uid]||[]).length>=3).length;

    detailEl.innerHTML = `
      <div style="padding:10px 16px;background:#f0fafa;border-bottom:1px solid var(--border);font-size:12px;color:var(--gray);display:flex;gap:16px;">
        <span>총 <b>${studentIds.length}</b>명</span>
        <span>제출 <b style="color:var(--teal);">${submitted}</b>명</span>
        <span>완료 <b style="color:#059669;">${full}</b>명</span>
      </div>
      <!-- 헤더 -->
      <div style="display:grid;grid-template-columns:80px 1fr 1fr 1fr 1fr;gap:4px;padding:6px 12px;background:#f8f9fa;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--gray);">
        <span>학생</span><span style="text-align:center;">녹음1</span><span style="text-align:center;">녹음2</span><span style="text-align:center;">녹음3</span><span>피드백</span>
      </div>
      ${studentIds.map(s=>{
        const mySubs = subs[s.uid]||[];
        const slots = [1,2,3].map(n=>mySubs.find(x=>x.slot===n));
        const completed = slots.every(x=>x);
        const fb = fbs[s.uid];
        return `<div style="display:grid;grid-template-columns:80px 1fr 1fr 1fr 1fr;gap:4px;padding:8px 12px;border-bottom:1px solid #f5f5f5;align-items:center;">
          <!-- 학생명 -->
          <div>
            <div style="font-weight:600;font-size:12px;">${s.name}</div>
            <div style="font-size:10px;color:#bbb;">${s.group}</div>
            <span style="font-size:10px;padding:1px 5px;border-radius:8px;font-weight:700;background:${completed?'#d1fae5':'#fef9c3'};color:${completed?'#059669':'#92400e'};">${completed?'완료':'미완료'}</span>
          </div>
          <!-- 녹음 1/2/3 (각 1셀) -->
          ${[1,2,3].map(n=>{ const sub=slots[n-1];
            return `<div style="text-align:center;">
              ${sub
                ? `<audio src="${sub.url}" controls style="width:100%;height:24px;"></audio>`
                : `<span style="font-size:10px;color:#ccc;">미제출</span>`}
            </div>`;
          }).join('')}
          <!-- 피드백 -->
          <div>
            <div style="display:flex;gap:4px;align-items:flex-start;">
              <textarea id="fb-${s.uid}" rows="2" placeholder="피드백..."
                style="flex:1;min-width:0;border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:11px;resize:none;outline:none;">${fb?fb.feedback:''}</textarea>
              <button onclick="saveRecFeedback('${hwId}','${s.uid}','${s.name.replace(/'/g,"\\'")}','${fb?fb.docId:''}')"
                style="background:var(--teal);color:white;border:none;border-radius:6px;padding:4px 6px;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0;white-space:nowrap;">
                ${fb?'수정':'저장'}
              </button>
            </div>
            ${fb?`<div style="font-size:10px;color:#059669;margin-top:2px;">✓ ${fb.updatedAt?.toDate?fb.updatedAt.toDate().toLocaleDateString('ko-KR'):'-'}</div>`:''}
          </div>
        </div>`;
      }).join('')||'<div style="padding:20px;text-align:center;color:#bbb;">대상 학생이 없습니다</div>'}`;
  }catch(e){ detailEl.innerHTML=`<div style="padding:20px;color:#e05050;">불러오기 실패: ${e.message}</div>`; }
};

window.saveRecFeedback = async(hwId, uid, studentName, docId) => {
  const val = document.getElementById(`fb-${uid}`)?.value.trim();
  if(!val){ showToast('피드백 내용을 입력하세요.'); return; }
  try{
    if(docId){
      // 기존 피드백 수정
      await updateDoc(doc(db,'recFeedbacks',docId),{
        feedback:val, updatedAt:serverTimestamp()
      });
    } else {
      // 신규 피드백 저장
      await addDoc(collection(db,'recFeedbacks'),{
        hwId, uid, feedback:val,
        studentName, teacherId:currentUser.uid,
        read:false,  // 학생 알림용
        createdAt:serverTimestamp(), updatedAt:serverTimestamp()
      });
    }
    showToast(`✅ ${studentName} 피드백 저장!`);
    // 저장 버튼 "수정"으로 변경
    await loadRecHwDetail(hwId, document.getElementById('recStatusTitle')?.textContent?.replace('📄 ',''));
  }catch(e){ showToast('저장 실패: '+e.message); }
};
window.viewUnit = (bid, uid, name) => {
  // 먼저 최신 unit 데이터 로드
  getDoc(doc(db,'books',bid,'units',uid)).then(snap=>{
    if(!snap.exists()){ showToast('Unit을 찾을 수 없습니다.'); return; }
    const u = {id:uid, ...snap.data()};
    const words = u.words||[];
    showModal(`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-size:16px;font-weight:700;">📖 ${u.name}</div>
        <span style="font-size:12px;color:var(--gray);">단어 ${words.length}개</span>
      </div>
      <!-- 단어 목록 -->
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:320px;overflow-y:auto;margin-bottom:14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;background:#f8f9fa;padding:8px 12px;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);">
          <span>영어</span><span>한글</span>
        </div>
        ${words.map((w,i)=>`
          <div style="display:grid;grid-template-columns:1fr 1fr;padding:7px 12px;font-size:13px;border-bottom:1px solid #f5f5f5;background:${i%2===0?'white':'#fafafa'};">
            <span style="font-weight:500;">${w.en}</span>
            <span style="color:var(--gray);">${w.ko}</span>
          </div>`).join('')}
        ${words.length===0?`<div style="padding:20px;text-align:center;color:#bbb;">단어가 없습니다</div>`:''}
      </div>
      <!-- 버튼 -->
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">닫기</button>
        <button class="btn btn-primary" onclick="editUnit('${bid}','${uid}','${u.name.replace(/'/g,"\\'")}')" style="flex:1;justify-content:center;">✏️ 수정</button>
      </div>
    `);
  }).catch(e=>showToast('불러오기 실패: '+e.message));
};

window.editUnit = async(bid, uid, name) => {
  const snap = await getDoc(doc(db,'books',bid,'units',uid));
  if(!snap.exists()){ showToast('Unit을 찾을 수 없습니다.'); return; }
  const u = {id:uid, ...snap.data()};
  const words = u.words||[];
  // 현재 단어를 탭 구분 텍스트로 변환
  const wordsText = words.map(w=>`${w.en}\t${w.ko}`).join('\n');

  showModal(`
    <div style="font-size:16px;font-weight:700;margin-bottom:14px;">✏️ Unit 수정</div>
    <div style="margin-bottom:10px;">
      <div style="font-size:12px;color:var(--gray);margin-bottom:4px;">Unit 이름</div>
      <input id="editUnitName" type="text" value="${u.name.replace(/"/g,'&quot;')}"
        style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px;outline:none;">
    </div>
    <div style="margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;">
      <div style="font-size:12px;color:var(--gray);">단어 목록 (영어↔한글 탭 구분)</div>
      <span style="font-size:11px;color:var(--teal);">총 <span id="editWordCount">${words.length}</span>개</span>
    </div>
    <textarea id="editUnitWords" rows="10"
      oninput="document.getElementById('editWordCount').textContent=this.value.split('\\n').filter(l=>l.trim()).length"
      style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;resize:vertical;outline:none;font-family:monospace;"
      placeholder="영어단어(또는문장)	한글뜻">${wordsText}</textarea>
    <div style="font-size:11px;color:#bbb;margin-bottom:14px;">※ 엑셀에서 두 열 선택 후 복사·붙여넣기 가능</div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="viewUnit('${bid}','${uid}','${name.replace(/'/g,"\\'")}');" style="flex:1;justify-content:center;">← 뒤로</button>
      <button class="btn btn-danger" onclick="deleteUnitConfirm('${bid}','${uid}','${name.replace(/'/g,"\\'")}','${(words.length)}');" style="flex:1;justify-content:center;background:#e05050;color:white;border:none;border-radius:8px;cursor:pointer;padding:9px;">🗑 삭제</button>
      <button class="btn btn-primary" onclick="saveEditUnit('${bid}','${uid}')" style="flex:2;justify-content:center;">💾 저장</button>
    </div>
  `);
};

window.saveEditUnit = async(bid, uid) => {
  const newName = document.getElementById('editUnitName')?.value.trim();
  const text = document.getElementById('editUnitWords')?.value||'';
  if(!newName){ showToast('Unit 이름을 입력하세요.'); return; }

  const lines = text.split('\n').filter(l=>l.trim());
  const words = lines.map(l=>{
    const p = l.split('\t');
    return { en:(p[0]||'').trim(), ko:(p[1]||'').trim() };
  }).filter(w=>w.en);

  if(!words.length){ showToast('단어를 입력하세요.'); return; }

  try{
    // Unit 수정
    await updateDoc(doc(db,'books',bid,'units',uid),{
      name: newName,
      words: words,
      wordCount: words.length,
      updatedAt: serverTimestamp()
    });
    // 교재 wordCount 재계산
    const allUnitsSnap = await getDocs(collection(db,'books',bid,'units'));
    const totalWords = allUnitsSnap.docs.reduce((s,d)=>s+(d.data().wordCount||d.data().words?.length||0),0);
    await updateDoc(doc(db,'books',bid),{
      wordCount: totalWords,
      unitCount: allUnitsSnap.size
    });

    showToast(`✅ "${newName}" 저장 완료! (${words.length}개 단어)`);
    closeModal();
    // 교재 목록 새로고침
    await loadBooks();
  }catch(e){ showToast('저장 실패: '+e.message); }
};

window.deleteUnitConfirm = (bid, uid, name, wordCount) => {
  showModal(`
    <div style="text-align:center;padding:10px 0 20px;">
      <div style="font-size:36px;margin-bottom:10px;">🗑</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:6px;">"${name}" 삭제</div>
      <div style="font-size:13px;color:var(--gray);">단어 ${wordCount}개가 함께 삭제됩니다.<br>이 작업은 되돌릴 수 없어요.</div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="editUnit('${bid}','${uid}','${name.replace(/'/g,"\\'")}');" style="flex:1;justify-content:center;">취소</button>
      <button style="flex:1;background:#e05050;color:white;border:none;border-radius:8px;cursor:pointer;padding:10px;font-size:14px;font-weight:600;" onclick="doDeleteUnit('${bid}','${uid}','${name.replace(/'/g,"\\'")}')">삭제 확인</button>
    </div>
  `);
};

window.doDeleteUnit = async(bid, uid, name) => {
  try{
    await deleteDoc(doc(db,'books',bid,'units',uid));
    // 교재 unitCount/wordCount 갱신
    const allUnitsSnap = await getDocs(collection(db,'books',bid,'units'));
    const totalWords = allUnitsSnap.docs.reduce((s,d)=>s+(d.data().wordCount||d.data().words?.length||0),0);
    await updateDoc(doc(db,'books',bid),{
      unitCount: allUnitsSnap.size,
      wordCount: totalWords
    });
    showToast(`🗑 "${name}" 삭제 완료`);
    closeModal();
    await loadBooks();
  }catch(e){ showToast('삭제 실패: '+e.message); }
};
window.moveToFolder = (id) => { showToast('폴더 이동 준비 중...'); };
