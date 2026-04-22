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
  'test-list':'시험 목록',
  'score-report':'성적 리포트', 'score-personal':'개인별 분석',
  message:'메시지 관리', notice:'공지 관리', hwfile:'숙제파일 관리', payment:'결제 관리',
  generator:'Generator',
  'quiz-generate':'AI 문제 생성', 'quiz-sets':'문제 세트 목록',
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

// ── 대시보드 ──────────────────────────────────────────
async function initDashboard(){
  const now = new Date();
  document.getElementById('dashDate').textContent = now.toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'});
  renderCalendar();
  await Promise.all([loadDashStats(), loadDashNotices(), loadDashScores(), loadDashStudents()]);
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
        <td class="td-sub">${s.createdAt?.toDate?s.createdAt.toDate().toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):''}</td>
      </tr>`;
    }).join('');
  }catch(e){el.innerHTML='<tr><td colspan="7" style="text-align:center;color:#bbb;padding:12px;">불러오기 실패</td></tr>';}
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


// ── 공지 관리 ────────────────────────────────────────
async function loadNotices(){
  const el=document.getElementById('noticeTableBody');
  try{
    const snap=await getDocs(query(collection(db,'notices'),orderBy('createdAt','desc')));
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
      <td class="td-sub">${f.date||''}</td>
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
      <td class="td-sm">${p.due||'-'}</td>
      <td><span class="badge ${sbadge[p.status]||'badge-gray'}">${slabel[p.status]||'미납'}</span></td>
      <td class="td-sub">${p.memo||'-'}</td>
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
      <td class="td-center">${s.correct||0}/${s.total||0}</td>
      <td><span class="badge ${sbadge(s.score||0)}">${s.score||0}점</span></td>
      <td class="td-sub">${s._dateTime||s.date||''}</td>
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
  }catch(e){detail.innerHTML='<div style="color:#e05050;padding:20px;">불러오기 실패</div>';}
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


// ── 시험 선택 액션 ──────────────────────────────────
window.editSelectedTest = async() => {
  const ids = getCheckedIds('testListBody');
  if(ids.length !== 1){showToast('수정할 시험을 하나만 선택하세요.');return;}
  openTestEditModal(ids[0]);
};
window.reprintSelectedTest = async() => {
  const ids = getCheckedIds('testListBody');
  if(ids.length !== 1){showToast('재출력할 시험을 하나만 선택하세요.');return;}
  reprintTest(ids[0]);
};
window.deleteSelectedTest = async() => {
  const rows = [...document.querySelectorAll('#testListBody input[type=checkbox]:checked')]
    .map(cb => ({ id: cb.value, src: cb.dataset.src || 'tests' }))
    .filter(r => r.id && r.id !== 'on');
  if(!rows.length){showToast('삭제할 시험을 선택하세요.');return;}
  if(!(await showConfirm(`선택한 ${rows.length}개 시험을 삭제할까요?`)))return;
  for(const r of rows) {
    const coll = (r.src === 'genTests') ? 'genTests' : 'tests';
    await deleteDoc(doc(db, coll, r.id));
  }
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
function _testModeLabel(t){
  if(t.testMode==='unscramble')
    return '<span class="badge" style="background:#fff8e1;color:#b45309;border:1px solid #ffe082;">🔀 언스크램블</span>';
  if(t.testMode==='reading-mcq')
    return '<span class="badge" style="background:#fff4e6;color:#c2410c;border:1px solid #fed7aa;">📖 독해</span>';
  return '<span class="badge badge-teal">📝 단어시험</span>';
}

// ─── 시험 통계 공용 계산 (시험 목록 + 시험 유형별 최근 시험 공유) ───
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
    // tests + genTests 병렬 로드
    const [snap, gSnap] = await Promise.all([
      getDocs(query(collection(db,'tests'),orderBy('createdAt','desc'))),
      getDocs(query(collection(db,'genTests'),orderBy('createdAt','desc'))).catch(()=>({docs:[]})),
    ]);
    const tests = snap.docs.map(d=>({id:d.id,_src:'tests',...d.data()}));
    const genTests = gSnap.docs.map(d=>({id:d.id,_src:'genTests',...d.data()}));

    if(tests.length===0 && genTests.length===0){
      el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#bbb;padding:20px;">출제된 시험이 없습니다</td></tr>';
      return;
    }

    // scores 전체 로드 후 testId 별로 집계 (tests / genTests 공통)
    const scoresSnap = await getDocs(collection(db,'scores'));
    const allScores = scoresSnap.docs.map(d=>d.data());

    // 학생 전체 (대상자 계산용 — 반 타겟을 uid 로 확장하려면 필요)
    if (!Array.isArray(allStudents) || allStudents.length === 0) {
      try {
        const sSnap = await getDocs(query(collection(db,'users'), where('role','==','student')));
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

    // 병합 + createdAt desc 재정렬
    const combined = [...tests, ...genTests]
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
      <tr style="cursor:pointer;" onclick="toggleTestProgress('${t.id}','${t._src}')" id="test-row-${t.id}">
        <td onclick="event.stopPropagation()"><input type="checkbox" value="${t.id}" data-src="${t._src}"></td>
        <td>${i+1}</td>
        <td class="td-main">${esc(t.name)||'-'}</td>
        <td>${_testModeLabel(t)}</td>
        <td><span class="badge badge-teal">${esc(t.targetName)||'-'}</span></td>
        <td class="td-sm">${esc(bookName)}</td>
        <td class="td-center">${count}문제</td>
        <td class="td-sub">${esc(t.date)||''}</td>
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
      <tr id="progress-${t.id}" style="display:none;background:#f0faff;">
        <td colspan="10" style="padding:0;border-top:none;">
          <div id="progress-content-${t.id}" style="padding:14px 16px 14px 48px;font-size:12px;color:#bbb;">로딩 중...</div>
        </td>
      </tr>`;
    }, 'testPagination', 10, { pageSize: 20 });
  }catch(e){
    console.error(e);
    el.innerHTML='<tr><td colspan="10" style="text-align:center;color:#e05050;">불러오기 실패</td></tr>';
  }
};

window.toggleTestProgress = async(testId, source='tests') => {
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
    const coll = (source === 'genTests') ? 'genTests' : 'tests';
    const testDoc = await getDoc(doc(db, coll, testId));
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
        const gs = await getDocs(query(collection(db,'users'),where('group','==',gName)));
        gs.docs.filter(d=>d.data().role==='student').forEach(d=>
          students.push({uid:d.id, name:d.data().name, group:d.data().group||''})
        );
      }
    }
    const seen=new Set(); students=students.filter(s=>{if(seen.has(s.uid))return false;seen.add(s.uid);return true;});
    students.sort((a,b)=>(a.group+a.name).localeCompare(b.group+b.name,'ko'));

    // 완료 목록
    const compSnap = await getDocs(collection(db, coll, testId, 'userCompleted'));
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

window.openTestEditModal = async(testId) => {
  const snap = await getDoc(doc(db,'tests',testId));
  if(!snap.exists()){ showToast('시험 데이터 없음'); return; }
  const t = snap.data();
  const isUnsc = t.testMode === 'unscramble';

  const wordsHtml = (t.words||[]).map((w,i)=>`
    <tr>
      <td style="padding:4px;color:var(--gray);font-size:12px;text-align:center;">${i+1}</td>
      <td style="padding:4px;">
        <input data-wi="${i}" data-field="en" value="${esc(w.en||'')}"
          style="width:100%;border:1px solid var(--border);border-radius:5px;padding:5px 8px;font-size:12px;outline:none;">
      </td>
      <td style="padding:4px;">
        <input data-wi="${i}" data-field="ko" value="${esc(w.ko||'')}"
          style="width:100%;border:1px solid var(--border);border-radius:5px;padding:5px 8px;font-size:12px;outline:none;">
      </td>
      <td style="padding:4px;text-align:center;">
        <button onclick="this.closest('tr').remove()" style="background:none;border:none;color:#ccc;cursor:pointer;font-size:16px;line-height:1;">✕</button>
      </td>
    </tr>`).join('');

  showModal(`
    <div style="font-size:16px;font-weight:700;margin-bottom:16px;">✏️ 시험 수정</div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:4px;">시험명</div>
        <input id="editTestName" value="${esc(t.name||'')}"
          style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;outline:none;">
      </div>
      <div style="display:flex;gap:12px;">
        <div style="flex:1;">
          <div style="font-size:12px;color:var(--gray);margin-bottom:4px;">통과점수</div>
          <input id="editTestPass" type="number" value="${t.passScore||80}" min="0" max="100"
            style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;outline:none;text-align:center;">
        </div>
        <div style="flex:1;">
          <div style="font-size:12px;color:var(--gray);margin-bottom:4px;">활성화</div>
          <select id="editTestActive" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;">
            <option value="1" ${t.active!==false?'selected':''}>활성</option>
            <option value="0" ${t.active===false?'selected':''}>비활성</option>
          </select>
        </div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;">
          <span>단어 목록 ${isUnsc?'<span style="color:#b45309;font-size:11px;">(언스크램블: / 로 청크 구분)</span>':''}</span>
          <button onclick="addEditWordRow()" style="background:var(--teal);color:white;border:none;border-radius:5px;padding:3px 10px;font-size:12px;cursor:pointer;">+ 추가</button>
        </div>
        <div style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#f8f9fa;font-size:11px;color:var(--gray);">
              <th style="padding:6px 4px;text-align:center;width:28px;">No</th>
              <th style="padding:6px 4px;text-align:left;">영어</th>
              <th style="padding:6px 4px;text-align:left;">한글</th>
              <th style="width:28px;"></th>
            </tr></thead>
            <tbody id="editWordList">${wordsHtml}</tbody>
          </table>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="saveTestEdit('${testId}')" style="flex:1;justify-content:center;">저장</button>
    </div>`);
  document.getElementById('modalBox').style.width = '900px';
};

window.addEditWordRow = () => {
  const tbody = document.getElementById('editWordList');
  if(!tbody) return;
  const i = tbody.rows.length;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td style="padding:4px;color:var(--gray);font-size:12px;text-align:center;">${i+1}</td>
    <td style="padding:4px;"><input data-wi="${i}" data-field="en" placeholder="영어"
      style="width:100%;border:1px solid var(--border);border-radius:5px;padding:5px 8px;font-size:12px;outline:none;"></td>
    <td style="padding:4px;"><input data-wi="${i}" data-field="ko" placeholder="한글"
      style="width:100%;border:1px solid var(--border);border-radius:5px;padding:5px 8px;font-size:12px;outline:none;"></td>
    <td style="padding:4px;text-align:center;">
      <button onclick="this.closest('tr').remove()" style="background:none;border:none;color:#ccc;cursor:pointer;font-size:16px;line-height:1;">✕</button>
    </td>`;
  tbody.appendChild(tr);
};

window.saveTestEdit = async(testId) => {
  const name = document.getElementById('editTestName')?.value.trim();
  if(!name){ showToast('시험명을 입력하세요.'); return; }
  const passScore = parseInt(document.getElementById('editTestPass')?.value)||80;
  const active = document.getElementById('editTestActive')?.value === '1';

  // 단어 수집
  const rows = document.getElementById('editWordList')?.querySelectorAll('tr')||[];
  const words = [];
  rows.forEach(tr=>{
    const en = tr.querySelector('[data-field="en"]')?.value.trim()||'';
    const ko = tr.querySelector('[data-field="ko"]')?.value.trim()||'';
    if(en||ko) words.push({en, ko});
  });
  if(!words.length){ showToast('단어를 하나 이상 입력하세요.'); return; }

  closeModal();

  // 진행/완료 학생 확인
  const [compSnap, scoreSnap] = await Promise.all([
    getDocs(collection(db,'tests',testId,'userCompleted')),
    getDocs(query(collection(db,'scores'),where('testId','==',testId)))
  ]);
  const affectedUids = new Set();
  compSnap.docs.forEach(d=>affectedUids.add(d.id));
  scoreSnap.docs.forEach(d=>affectedUids.add(d.data().uid));

  // 시험 데이터 업데이트
  await updateDoc(doc(db,'tests',testId),{ name, passScore, active, words, updatedAt: serverTimestamp() });

  // 영향받는 학생이 있으면 진도 초기화 + 알림 발송
  if(affectedUids.size > 0){
    const confirmed = await showConfirm(
      `시험 내용이 수정됩니다`,
      `응시/완료한 학생 ${affectedUids.size}명의 진도가 초기화되고 재응시 알림이 발송됩니다.`
    );
    if(!confirmed){
      showToast('✅ 시험 내용만 수정됐어요 (진도 유지)');
      await loadTestList();
      return;
    }

    // userCompleted 삭제
    await Promise.all(compSnap.docs.map(d=>deleteDoc(d.ref)));

    // scores 삭제
    await Promise.all(scoreSnap.docs.map(d=>deleteDoc(d.ref)));

    // 알림 발송
    await Promise.all([...affectedUids].map(uid=>addDoc(collection(db,'userNotifications'),{
      uid,
      title: '📝 시험이 수정됐어요',
      body: `"${name}" 시험 내용이 수정되어 다시 응시해주세요.`,
      type: 'test_updated',
      testId,
      read: false,
      createdAt: serverTimestamp()
    })));

    showToast(`✅ 수정 완료 · ${affectedUids.size}명에게 알림 발송`);
  } else {
    showToast('✅ 시험이 수정됐어요.');
  }

  await loadTestList();
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
      getDocs(query(collection(db,'genPages'), orderBy('serialNumber','asc'))),
      getDocs(query(collection(db,'genChapters'), orderBy('order','asc'))),
      getDocs(query(collection(db,'genBooks'), orderBy('createdAt','asc'))),
    ]);
    _genPages = pSnap.docs.map(d=>({id:d.id,...d.data()}));
    _genChapters = cSnap.docs.map(d=>({id:d.id,...d.data()}));
    _genBooks = bSnap.docs.map(d=>({id:d.id,...d.data()}));
    _genCheckedPages.clear(); _genCheckedChapters.clear(); _genCheckedBooks.clear();
    _genActiveBook = null; _genActiveChapter = null; _genActivePage = null;
    _genPageCur = 1;
    _genRenderAll();
    _cleanupLoadPresets();  // 프리셋 백그라운드 로드 (에디터 드롭다운 채움)
  } catch(e) { showToast('Generator 로드 실패: '+e.message); }
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

function _genRenderBooks() {
  const el = document.getElementById('genBookList');
  const cnt = document.getElementById('genBookCount');
  if (!el) return;
  if (!_genBooks.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:12px;">Book이 없습니다</div>';
    if (cnt) cnt.textContent = '';
    _genToolbar('book'); return;
  }
  if (cnt) cnt.textContent = _genBooks.length + '개';
  el.innerHTML = _genBooks.map(b => {
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
  if (!el) return;
  const filtered = _genFilteredChapters();
  if (!filtered.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:12px;">Chapter가 없습니다</div>';
    if (cnt) cnt.textContent = '';
    _genToolbar('chapter'); return;
  }
  if (cnt) cnt.textContent = filtered.length + '개';
  el.innerHTML = filtered.map(c => {
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
  if (!el) return;
  const filtered = _genFilteredPages();
  const total = filtered.length;
  const totalPgs = Math.ceil(total / _genPageSize) || 1;
  if (_genPageCur > totalPgs) _genPageCur = 1;
  const start = (_genPageCur-1)*_genPageSize;
  const slice = filtered.slice(start, start+_genPageSize);
  if (cnt) cnt.textContent = total + '개';
  if (!total) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:12px;">Page가 없습니다</div>';
    _genRenderPagePaging(0,0); _genToolbar('page'); return;
  }
  el.innerHTML = slice.map(p => {
    const active = _genActivePage === p.id;
    return `
    <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid #f0f0f0;background:${active?'var(--teal-light)':''};cursor:pointer;transition:background .1s;" onclick="genClickPage('${p.id}')">
      <input type="checkbox" data-id="${p.id}" ${_genCheckedPages.has(p.id)?'checked':''} onchange="genOnPageCheck(this)" onclick="event.stopPropagation()">
      <div style="flex:1;min-width:0;pointer-events:none;">
        <div style="font-weight:600;color:${active?'var(--teal)':'var(--text)'};font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.title||'Page '+p.serialNumber)}</div>
        <div style="font-size:11px;color:${p.chapterId?'var(--gray)':'#bbb'};font-style:${p.chapterId?'normal':'italic'};">#${p.serialNumber} · ${p.chapterId?esc(p.chapterName||''):'미지정'}</div>
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

function _genToolbar(type) {
  const cnt = type==='page'?_genCheckedPages.size:type==='chapter'?_genCheckedChapters.size:_genCheckedBooks.size;
  if (type==='page') {
    ['genPageEditBtn','genPageMoveBtn','genPageExcludeBtn','genPageDeleteBtn'].forEach((id,i)=>{
      const el=document.getElementById(id); if(el) el.disabled = i===0?cnt!==1:cnt===0;
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
window.genHandleDrop = (e) => {
  e.preventDefault();
  document.getElementById('genDropZone').style.borderColor='var(--border)';
  genHandleFiles(e.dataTransfer.files);
};
window.genHandleFiles = (files) => {
  [...files].forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => {
      _genImages.push({ base64: ev.target.result.split(',')[1], name: file.name, mimeType: file.type });
      _genRenderThumbnails();
    };
    reader.readAsDataURL(file);
  });
};
function _genRenderThumbnails() {
  const el = document.getElementById('genThumbnails');
  if (!el) return;
  el.innerHTML = _genImages.map((img,i) => `
    <div style="position:relative;width:72px;flex-shrink:0;">
      <img src="data:${img.mimeType};base64,${img.base64}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border);">
      <button onclick="genRemoveImage(${i})" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:none;background:#e05050;color:white;cursor:pointer;font-size:10px;padding:0;line-height:1;">x</button>
      <div style="font-size:9px;color:var(--gray);text-align:center;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(img.name)}</div>
    </div>`).join('');
}
window.genRemoveImage = (i) => { _genImages.splice(i,1); _genRenderThumbnails(); };

// ── OCR 실행 ──
window.runGenOcr = async () => {
  if (!_genImages.length) { showToast('이미지를 먼저 업로드하세요.'); return; }
  const btn = document.getElementById('genOcrBtn');
  const status = document.getElementById('genOcrStatus');
  btn.disabled = true;
  let maxSerial = _genPages.reduce((m,p)=>Math.max(m,p.serialNumber||0),0);
  let saved = 0;
  for (let i=0; i<_genImages.length; i++) {
    if (status) status.textContent = `처리 중... (${i+1}/${_genImages.length})`;
    try {
      const res = await fetch('/api/ocr',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({imageBase64:_genImages[i].base64,mimeType:_genImages[i].mimeType}),
      });
      const data = await res.json();
      if (!res.ok||data.error){ showToast(`[${i+1}] OCR 실패: ${data.error||res.status}`); continue; }
      maxSerial++;
      await addDoc(collection(db,'genPages'),{
        title:`Page ${maxSerial}`, serialNumber:maxSerial,
        chapterId:null, chapterName:'', bookId:null, bookName:'',
        text:data.text||'', ocrConfidence:(data.confidence||0)/100,
        ocrProvider:data.provider||'google-vision', imageUrl:'', edited:false,
        createdAt:serverTimestamp(), createdBy:auth.currentUser?.uid||'',
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
    <div style="font-size:16px;font-weight:700;margin-bottom:16px;">📄 Page 생성</div>
    <div style="margin-bottom:10px;"><div style="font-size:12px;color:var(--gray);margin-bottom:4px;">제목</div>
      <input id="gnPT" type="text" placeholder="비우면 자동 지정" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
    <div style="margin-bottom:16px;"><div style="font-size:12px;color:var(--gray);margin-bottom:4px;">본문</div>
      <textarea id="gnPX" rows="6" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;resize:vertical;font-family:inherit;"></textarea></div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="genDoCreatePage()" style="flex:2;justify-content:center;">저장</button>
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
    });
    closeModal(); await loadGenerator();
  } catch(e){ showToast('저장 실패: '+e.message); }
};

window.genEditPage = () => {
  if (_genCheckedPages.size!==1) return;
  const pid=[..._genCheckedPages][0];
  const page=_genPages.find(p=>p.id===pid);
  if (!page) return;
  showModal(`
    <div style="font-size:16px;font-weight:700;margin-bottom:16px;">&#9999;&#65039; Page 수정</div>
    <div style="margin-bottom:10px;"><div style="font-size:12px;color:var(--gray);margin-bottom:4px;">제목</div>
      <input id="gnET" type="text" value="${esc(page.title||'')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
    <div style="margin-bottom:16px;"><div style="font-size:12px;color:var(--gray);margin-bottom:4px;">본문</div>
      <textarea id="gnEX" rows="10" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;resize:vertical;font-family:inherit;">${esc(page.text||'')}</textarea></div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="genDoEditPage('${pid}')" style="flex:2;justify-content:center;">저장</button>
    </div>`);
  document.getElementById('modalBox').style.width='700px';
};
window.genDoEditPage = async (pid) => {
  const title=document.getElementById('gnET')?.value.trim();
  const text=document.getElementById('gnEX')?.value.trim();
  if (!title){ showToast('제목을 입력하세요.'); return; }
  try {
    await updateDoc(doc(db,'genPages',pid),{title,text:text||'',edited:true});
    closeModal(); await loadGenerator();
  } catch(e){ showToast('저장 실패: '+e.message); }
};

window.genSavePage = async () => {
  const pid=document.getElementById('genEditPageId')?.value;
  const title=document.getElementById('genEditTitle')?.value.trim();
  const text=document.getElementById('genEditText')?.value;
  if (!pid||!title){ showToast('제목을 입력하세요.'); return; }
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
  if (!_genChapters.length){ showToast('Chapter가 없습니다. 먼저 Chapter를 생성하세요.'); return; }
  showModal(`
    <div style="font-size:16px;font-weight:700;margin-bottom:12px;">&#8594; Chapter 이동</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:10px;">${_genCheckedPages.size}개 Page 이동</div>
    <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">
      ${_genChapters.map(c=>`
        <div data-cid="${esc(c.id)}" data-bid="${esc(c.bookId||'')}" data-bname="${esc(c.bookName||'')}" data-cname="${esc(c.name)}" onclick="window.genDoMovePages(this.dataset.cid,this.dataset.bid,this.dataset.bname,this.dataset.cname)" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;transition:.15s;" onmouseover="this.style.background='var(--teal-light)'" onmouseout="this.style.background=''">
          <div style="font-weight:600;font-size:13px;pointer-events:none;">${esc(c.name)}</div>
          <div style="font-size:11px;color:${c.bookId?'var(--gray)':'#bbb'};font-style:${c.bookId?'normal':'italic'};pointer-events:none;">${c.bookId?esc(c.bookName||''):'Book 미지정'}</div>
        </div>`).join('')}
    </div>
    <div style="margin-top:10px;"><button class="btn btn-secondary" onclick="closeModal()" style="width:100%;justify-content:center;">취소</button></div>`);
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
    <div style="font-size:16px;font-weight:700;margin-bottom:16px;">&#128218; Chapter 생성</div>
    <div style="margin-bottom:16px;"><div style="font-size:12px;color:var(--gray);margin-bottom:4px;">Chapter 이름 *</div>
      <input id="gnCN" type="text" placeholder="예: Chapter 1" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="genDoCreateChapter()" style="flex:2;justify-content:center;">저장</button>
    </div>`);
  setTimeout(()=>document.getElementById('gnCN')?.focus(),80);
};
window.genDoCreateChapter = async () => {
  const name=document.getElementById('gnCN')?.value.trim();
  if (!name){ showToast('이름을 입력하세요.'); return; }
  try {
    await addDoc(collection(db,'genChapters'),{
      name, bookId:null, bookName:'', order:_genChapters.length+1, pageCount:0,
      createdAt:serverTimestamp(), createdBy:auth.currentUser?.uid||'',
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
    <div style="font-size:16px;font-weight:700;margin-bottom:16px;">&#9999;&#65039; Chapter 수정</div>
    <div style="margin-bottom:16px;"><div style="font-size:12px;color:var(--gray);margin-bottom:4px;">Chapter 이름 *</div>
      <input id="gnCE" type="text" value="${esc(ch.name)}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="genDoEditChapter('${cid}')" style="flex:2;justify-content:center;">저장</button>
    </div>`);
  setTimeout(()=>document.getElementById('gnCE')?.focus(),80);
};
window.genDoEditChapter = async (cid) => {
  const name=document.getElementById('gnCE')?.value.trim();
  if (!name){ showToast('이름을 입력하세요.'); return; }
  try {
    await updateDoc(doc(db,'genChapters',cid),{name});
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
    await Promise.all(ids.map(id=>updateDoc(doc(db,'genChapters',id),{bookId:null,bookName:''})));
    await Promise.all(_genPages.filter(p=>ids.includes(p.chapterId)).map(p=>updateDoc(doc(db,'genPages',p.id),{bookId:null,bookName:''})));
    showToast('Book에서 제외됨'); await loadGenerator();
  } catch(e){ showToast('실패: '+e.message); }
};

window.genMoveChapters = async () => {
  if (!_genCheckedChapters.size) return;
  if (!_genBooks.length){ showToast('Book이 없습니다. 먼저 Book을 생성하세요.'); return; }
  showModal(`
    <div style="font-size:16px;font-weight:700;margin-bottom:12px;">&#8594; Book 이동</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:10px;">${_genCheckedChapters.size}개 Chapter 이동</div>
    <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">
      ${_genBooks.map(b=>`
        <div onclick="genDoMoveChapters('${b.id}','${esc(b.name).replace(/'/g,"&#39;")}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;transition:.15s;" onmouseover="this.style.background='var(--teal-light)'" onmouseout="this.style.background=''">
          <div style="font-weight:600;font-size:13px;">${esc(b.name)}</div>
          <div style="font-size:11px;color:var(--gray);">Chapter ${b.chapterCount||0}개</div>
        </div>`).join('')}
    </div>
    <div style="margin-top:10px;"><button class="btn btn-secondary" onclick="closeModal()" style="width:100%;justify-content:center;">취소</button></div>`);
};
window.genDoMoveChapters = async (bookId,bookName) => {
  const ids=[..._genCheckedChapters];
  try {
    await Promise.all(ids.map(id=>updateDoc(doc(db,'genChapters',id),{bookId,bookName})));
    await Promise.all(_genPages.filter(p=>ids.includes(p.chapterId)).map(p=>updateDoc(doc(db,'genPages',p.id),{bookId,bookName})));
    closeModal(); _genCheckedChapters.clear();
    showToast(`"${bookName}"으로 이동 완료`);
    await loadGenerator();
  } catch(e){ showToast('실패: '+e.message); }
};

// ── Book CRUD ──
window.genCreateBook = () => {
  showModal(`
    <div style="font-size:16px;font-weight:700;margin-bottom:16px;">&#128218; Book 생성</div>
    <div style="margin-bottom:16px;"><div style="font-size:12px;color:var(--gray);margin-bottom:4px;">Book 이름 *</div>
      <input id="gnBN" type="text" placeholder="예: 중등 영어 교과서 1-1" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="genDoCreateBook()" style="flex:2;justify-content:center;">저장</button>
    </div>`);
  setTimeout(()=>document.getElementById('gnBN')?.focus(),80);
};
window.genDoCreateBook = async () => {
  const name=document.getElementById('gnBN')?.value.trim();
  if (!name){ showToast('이름을 입력하세요.'); return; }
  try {
    await addDoc(collection(db,'genBooks'),{
      name, chapterCount:0, pageCount:0,
      createdAt:serverTimestamp(), createdBy:auth.currentUser?.uid||'',
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
    <div style="font-size:16px;font-weight:700;margin-bottom:16px;">&#9999;&#65039; Book 수정</div>
    <div style="margin-bottom:16px;"><div style="font-size:12px;color:var(--gray);margin-bottom:4px;">Book 이름 *</div>
      <input id="gnBE" type="text" value="${esc(book.name)}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;justify-content:center;">취소</button>
      <button class="btn btn-primary" onclick="genDoEditBook('${bid}')" style="flex:2;justify-content:center;">저장</button>
    </div>`);
  setTimeout(()=>document.getElementById('gnBE')?.focus(),80);
};
window.genDoEditBook = async (bid) => {
  const name=document.getElementById('gnBE')?.value.trim();
  if (!name){ showToast('이름을 입력하세요.'); return; }
  try {
    await updateDoc(doc(db,'genBooks',bid),{name});
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
    name: '단어장 (Snapshot)',
    description: '영단어[Tab]한글해석 형식으로 정리',
    prompt: `이 본문은 영어 단어장입니다.
각 항목을 "영단어[Tab]한글해석" 형식의 한 줄로 정리하세요.

규칙:
1. 각 줄: 영단어 → Tab 문자(\\t) → 한글 해석 → 줄바꿈
2. 번호, 불릿, 점선, 장식 기호 모두 제거 (예: "1.", "①", "•", "...", ">")
3. 한 영단어에 여러 뜻이 있으면 쉼표(, )로 구분해 같은 줄에 유지
4. 품사 표시(n./v./adj. 등)는 한글 해석 앞에 유지
5. 예문·설명 문장은 제거하고 단어-뜻 쌍만 남김
6. OCR 오인식 의심되는 경우에도 원문 단어를 그대로 유지 (추측 금지)

출력은 정리된 단어 목록만. 마크다운·서문·번호 매기기 금지.`,
    order: 1, isDefault: true,
  },
  {
    name: '기본 정리',
    description: '페이지번호/하이픈/줄바꿈 정리',
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
    name: '교재 문제지',
    description: '문제 번호/선택지/Answer Key 정리',
    prompt: `이 본문은 영어 교재의 문제 섹션입니다. 다음 규칙으로 정리하세요.
1. 문제 번호(1. 2. 3. 또는 ① ② ③) 유지, 번호 앞뒤 공백 정규화
2. 선택지(A/B/C/D 또는 ① ② ③ ④)는 각각 새 줄로
3. 지문(Passage)과 문제를 빈 줄로 구분
4. Answer Key 섹션은 별도 블록으로 분리
5. 페이지 번호·머리말 제거

정리된 본문만 출력. 마크다운·서문 금지.`,
    order: 3, isDefault: true,
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
    const snap = await getDocs(query(collection(db, 'genCleanupPresets'), orderBy('order', 'asc')));
    _cleanupPresets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (_cleanupPresets.length === 0) {
      await _cleanupSeedDefaults();
      const snap2 = await getDocs(query(collection(db, 'genCleanupPresets'), orderBy('order', 'asc')));
      _cleanupPresets = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    _cleanupRenderEditorSelect();
  } catch (e) {
    console.error('cleanup presets load error:', e);
    showToast('프리셋 로드 실패: ' + e.message);
  }
}

async function _cleanupSeedDefaults() {
  const uid = auth.currentUser?.uid || '';
  await Promise.all(_CLEANUP_DEFAULT_PRESETS.map(p =>
    addDoc(collection(db, 'genCleanupPresets'), {
      ...p,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: uid,
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
  if (!_genActivePage) { showToast('Page 를 먼저 선택하세요'); return; }
  if (!_cleanupActivePresetId) { showToast('프리셋을 먼저 선택하세요'); return; }

  const page = _genPages.find(p => p.id === _genActivePage);
  if (!page) return;
  const preset = _cleanupPresets.find(p => p.id === _cleanupActivePresetId);
  if (!preset) { showToast('프리셋을 찾을 수 없습니다'); return; }

  const currentText = document.getElementById('genEditText')?.value || page.text || '';
  if (currentText.trim().length < 5) { showToast('정리할 본문이 너무 짧습니다'); return; }

  const btn = document.getElementById('genCleanupBtn');
  if (btn) { btn.disabled = true; btn.textContent = '🤖 AI 호출 중...'; }

  try {
    const res = await fetch('/api/cleanup-ocr', {
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
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);">
      <div style="font-size:16px;font-weight:700;">✨ AI 정리 결과 비교</div>
      <div style="font-size:12px;color:var(--gray);margin-top:3px;">
        ${esc(pageTitle)} · 프리셋: ${esc(presetName)} · 모델: <code>${esc(model||'')}</code>
      </div>
    </div>
    <div style="flex:1;display:flex;gap:10px;padding:14px 18px;overflow:hidden;">
      <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
        <div style="font-size:12px;font-weight:600;color:var(--gray);margin-bottom:4px;">원본</div>
        <textarea readonly style="flex:1;min-height:45vh;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:monospace;background:#fafafa;resize:none;">${esc(original)}</textarea>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
        <div style="font-size:12px;font-weight:600;color:var(--teal);margin-bottom:4px;">AI 결과 <span style="font-weight:400;color:var(--gray);font-size:11px;">(적용 시 원본 덮어쓰기)</span></div>
        <textarea id="cleanupCompareEdit" style="flex:1;min-height:45vh;padding:10px;border:1px solid var(--teal);border-radius:6px;font-size:12px;font-family:monospace;resize:none;">${esc(cleaned)}</textarea>
      </div>
    </div>
    <div style="padding:10px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;background:#fafafa;">
      <button class="btn btn-secondary" onclick="closeModal()">취소</button>
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

// ─── 일괄 AI 정리 (Page 툴바 버튼) ───
window.genCleanupBatch = async () => {
  if (_genCheckedPages.size === 0) { showToast('Page 를 1개 이상 체크하세요'); return; }
  if (_cleanupPresets.length === 0) { showToast('프리셋이 없습니다'); return; }

  // 프리셋 선택 모달 먼저
  const presetId = await _cleanupPickPresetModal();
  if (!presetId) return;
  const preset = _cleanupPresets.find(p => p.id === presetId);
  if (!preset) return;

  const targets = _genPages.filter(p => _genCheckedPages.has(p.id) && (p.text||'').trim().length >= 5);
  if (targets.length === 0) { showToast('본문이 충분한 페이지가 없습니다'); return; }

  _cleanupBatchResults = [];
  _cleanupBatchTabIdx = 0;

  // 진행률 모달
  _cleanupShowBatchProgress(targets.length, 0);

  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    _cleanupShowBatchProgress(targets.length, i);
    try {
      const res = await fetch('/api/cleanup-ocr', {
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
    ? `<div style="padding:30px;text-align:center;color:#c33;font-size:13px;">
         <div style="font-size:24px;margin-bottom:8px;">⚠</div>
         <div>AI 정리 실패</div>
         <div style="color:var(--gray);margin-top:8px;font-size:12px;">${esc(cur.error)}</div>
       </div>`
    : `<div style="flex:1;display:flex;gap:10px;padding:14px;overflow:hidden;">
         <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
           <div style="font-size:12px;font-weight:600;color:var(--gray);margin-bottom:4px;">원본</div>
           <textarea readonly style="flex:1;min-height:40vh;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:monospace;background:#fafafa;resize:none;">${esc(cur.original)}</textarea>
         </div>
         <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
           <div style="font-size:12px;font-weight:600;color:var(--teal);margin-bottom:4px;">AI 결과</div>
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
         <button class="btn btn-primary" onclick="cleanupBatchApply()">적용 (덮어쓰기)</button>
         <button class="btn btn-secondary" onclick="cleanupBatchNext()">다음 →</button>`;

  const html = `
  <div style="width:min(1100px,95vw);height:min(85vh,750px);display:flex;flex-direction:column;">
    <div style="padding:12px 18px;border-bottom:1px solid var(--border);">
      <div style="font-size:15px;font-weight:700;">✨ 일괄 AI 정리 결과</div>
      <div style="font-size:12px;color:var(--gray);margin-top:2px;">프리셋: ${esc(presetName)} · 각 페이지별로 적용/건너뜀 선택</div>
    </div>
    <div style="padding:10px 14px 0;overflow-x:auto;white-space:nowrap;border-bottom:1px solid var(--teal-light);">${tabs}</div>
    ${body}
    <div style="padding:10px 18px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center;justify-content:space-between;background:#fafafa;">
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
    <div style="width:min(480px,92vw);padding:20px;">
      <div style="font-size:15px;font-weight:700;margin-bottom:6px;">✨ 일괄 AI 정리</div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:14px;">
        체크된 Page ${_genCheckedPages.size}개에 적용할 프리셋을 선택하세요.
      </div>
      <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">프리셋</label>
      <select id="cleanupPickSelect" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:white;">${opts}</select>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;">
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
window.cleanupOpenPresetManager = () => {
  _cleanupRenderPresetManager();
};

function _cleanupRenderPresetManager() {
  const rows = _cleanupPresets.length === 0
    ? '<tr><td colspan="4" style="padding:30px;text-align:center;color:#bbb;font-size:12px;">프리셋이 없습니다. 아래 "기본값 복원" 또는 "+ 새 프리셋"을 사용하세요.</td></tr>'
    : _cleanupPresets.map(p => `
      <tr style="border-bottom:1px solid var(--border);">
        <td class="td-main" style="padding:8px 10px;">${esc(p.name)}${p.isDefault?' <span style="font-size:10px;color:var(--gray);">(기본)</span>':''}</td>
        <td class="td-sub" style="padding:8px 10px;">${esc(p.description||'')}</td>
        <td class="td-center" style="padding:8px 10px;">${p.order||0}</td>
        <td style="padding:6px 10px;white-space:nowrap;">
          <button class="action-btn" onclick="cleanupEditPreset('${esc(p.id)}')">✏️ 편집</button>
          <button class="action-btn" onclick="cleanupDuplicatePreset('${esc(p.id)}')">⎘ 복제</button>
          <button class="action-btn danger" onclick="cleanupDeletePreset('${esc(p.id)}')">🗑</button>
        </td>
      </tr>`).join('');

  const html = `
  <div style="width:min(860px,95vw);max-height:85vh;display:flex;flex-direction:column;">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:16px;font-weight:700;">⚙ AI 정리 프리셋 관리</div>
        <div style="font-size:12px;color:var(--gray);margin-top:3px;">${_cleanupPresets.length}개 프리셋</div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-secondary" onclick="cleanupRestoreDefaults()" style="font-size:12px;">↻ 기본값 복원</button>
        <button class="btn btn-primary" onclick="cleanupEditPreset('')" style="font-size:12px;">+ 새 프리셋</button>
      </div>
    </div>
    <div style="flex:1;overflow:auto;padding:0 18px 14px;">
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
    <div style="padding:10px 18px;border-top:1px solid var(--border);text-align:right;background:#fafafa;">
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
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);">
      <div style="font-size:16px;font-weight:700;">${isNew?'+ 새 프리셋':'✏️ 프리셋 편집'}</div>
    </div>
    <div style="flex:1;overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px;">
      <div>
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">이름 *</label>
        <input id="cleanupEditName" type="text" value="${esc(p.name)}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">설명 (선택)</label>
        <input id="cleanupEditDesc" type="text" value="${esc(p.description||'')}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">정렬 순서</label>
        <input id="cleanupEditOrder" type="number" value="${p.order||0}" style="width:120px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
      </div>
      <div style="flex:1;display:flex;flex-direction:column;min-height:250px;">
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">프롬프트 *</label>
        <textarea id="cleanupEditPrompt" style="flex:1;min-height:250px;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:monospace;resize:vertical;box-sizing:border-box;">${esc(p.prompt||'')}</textarea>
      </div>
    </div>
    <div style="padding:10px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;background:#fafafa;">
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

  if (name.length < 1) { showToast('이름을 입력하세요'); return; }
  if (prompt.trim().length < 10) { showToast('프롬프트는 최소 10자 이상이어야 합니다'); return; }

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
      });
    }
    showToast(id ? '수정 완료' : '추가 완료');
    await _cleanupLoadPresets();
    _cleanupRenderPresetManager();
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
    });
    showToast('복제 완료');
    await _cleanupLoadPresets();
    _cleanupRenderPresetManager();
  } catch (e) {
    showToast('복제 실패: ' + e.message);
  }
};

window.cleanupDeletePreset = async (id) => {
  const p = _cleanupPresets.find(x => x.id === id);
  if (!p) return;
  const ok = await showConfirm(`"${p.name}" 프리셋을 삭제하시겠습니까?`, '삭제된 프리셋은 복구할 수 없습니다.');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'genCleanupPresets', id));
    showToast('삭제됨');
    // 활성 프리셋이 삭제되면 에디터 선택 해제
    if (_cleanupActivePresetId === id) _cleanupActivePresetId = '';
    await _cleanupLoadPresets();
    _cleanupRenderPresetManager();
  } catch (e) {
    showToast('삭제 실패: ' + e.message);
  }
};

// ─── 기본값 복원 (누락된 기본 프리셋만 재추가) ───
window.cleanupRestoreDefaults = async () => {
  const existingNames = new Set(_cleanupPresets.map(p => p.name));
  const missing = _CLEANUP_DEFAULT_PRESETS.filter(p => !existingNames.has(p.name));
  if (missing.length === 0) {
    showToast('모든 기본 프리셋이 이미 존재합니다');
    return;
  }
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
      })
    ));
    showToast(`${missing.length}개 복원됨`);
    await _cleanupLoadPresets();
    _cleanupRenderPresetManager();
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
      { key:'count',      label:'문제수',         type:'number', default:20, min:5, max:100 },
      { key:'difficulty', label:'난이도(학년)',   type:'select', choices:['초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'], default:'중1' },
      { key:'shuffleQ',   label:'문제 섞기',      type:'select', choices:['Off','On'], default:'On' },
      { key:'shuffleA',   label:'정답 섞기',      type:'select', choices:['Off','On'], default:'On' },
      { key:'passScore',  label:'통과점수',       type:'number', default:80, min:0, max:100 },
    ],
  },
  'unscramble': {
    label: '언스크램블',
    icon: '🔀',
    enabled: true,
    phaseLabel: null,
    noteHint: '본문 문장을 AI 가 청크 갯수에 맞게 나눠 언스크램블 문제를 만듭니다.',
    options: [
      { key:'count',       label:'문제수',       type:'number', default:10, min:3, max:50 },
      { key:'difficulty',  label:'난이도(학년)', type:'select', choices:['초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'], default:'중1' },
      { key:'chunkCount',  label:'청크 갯수',    type:'number', default:4, min:2, max:8 },
      { key:'shuffleQ',    label:'문제 섞기',    type:'select', choices:['Off','On'], default:'On' },
      { key:'passScore',   label:'통과점수',     type:'number', default:80, min:0, max:100 },
    ],
  },
  'fill_blank': {
    label: '빈칸채우기',
    icon: '✏️',
    enabled: true,
    phaseLabel: null,
    noteHint: '본문 문장에서 단어를 가리고 빈칸을 채우는 문제를 만듭니다.',
    options: [
      { key:'generationMode', label:'생성 방식', type:'select',
        choices:['규칙 기반 (즉시·무료)','AI 향상 (5~15초)'],
        default:'규칙 기반 (즉시·무료)' },
      { key:'count',             label:'문제수',             type:'number', default:5, min:1, max:50 },
      { key:'difficulty',        label:'난이도(학년)',       type:'select', choices:['초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'], default:'중1' },
      { key:'blanksPerSentence', label:'문장별 빈칸 개수',   type:'number', default:1, min:1, max:5 },
      { key:'passScore',         label:'통과점수',           type:'number', default:80, min:0, max:100 },
    ],
  },
  'mcq': {
    label: '내용이해_객관식',
    icon: '📖',
    enabled: true,
    phaseLabel: null,
    noteHint: '본문을 읽고 4지선다로 내용을 확인합니다.',
    options: [
      { key:'count',      label:'문제수',       type:'number', default:5, min:1, max:50 },
      { key:'difficulty', label:'난이도(학년)', type:'select', choices:['초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'], default:'중1' },
      { key:'passScore',  label:'통과점수',     type:'number', default:80, min:0, max:100 },
    ],
  },
  'subjective': {
    label: '해석하기_주관식',
    icon: '✍️',
    enabled: true,
    phaseLabel: null,
    noteHint: '원문 문장을 제시하고 학생이 손으로 한글 해석을 쓰는 시험지를 생성합니다. (학생앱 배정 없음)',
    options: [
      { key:'count',      label:'문제수',       type:'number', default:5, min:1, max:50 },
      { key:'difficulty', label:'난이도(학년)', type:'select', choices:['초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'], default:'중1' },
      { key:'passScore',  label:'통과점수',     type:'number', default:80, min:0, max:100 },
    ],
  },
  'recording': {
    label: '녹음숙제',
    icon: '🎤',
    enabled: true,
    phaseLabel: null,
    noAi: true,  // Phase 5.5: AI 호출 없이 로컬 생성
    noteHint: '선택한 Page 의 전체 문장을 학생이 3회 반복 녹음합니다. AI 가 정확도를 평가하고, 마지막(3회차) 녹음이 임계점을 넘으면 상세 피드백을 제공합니다.',
    options: [
      { key:'accuracyThreshold', label:'정확도 임계값 (점)', type:'number', default:70, min:50, max:95 },
      { key:'evaluationSeconds', label:'평가 구간 (초)',     type:'number', default:60, min:30, max:180 },
    ],
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
  // Generator 데이터가 없으면 먼저 로드
  if (!_genPages.length && !_genBooks.length) {
    try {
      const [pSnap, cSnap, bSnap] = await Promise.all([
        getDocs(query(collection(db,'genPages'), orderBy('serialNumber','asc'))),
        getDocs(query(collection(db,'genChapters'), orderBy('order','asc'))),
        getDocs(query(collection(db,'genBooks'), orderBy('createdAt','asc'))),
      ]);
      _genPages = pSnap.docs.map(d=>({id:d.id,...d.data()}));
      _genChapters = cSnap.docs.map(d=>({id:d.id,...d.data()}));
      _genBooks = bSnap.docs.map(d=>({id:d.id,...d.data()}));
    } catch(e) {
      showToast('Generator 데이터 로드 실패: '+e.message);
      return;
    }
  }

  _qgSelectedPageIds.clear();
  _qgGenerated = [];
  _qgExcluded.clear();
  // Phase 2.5: 필터 리셋 (유형은 직전 선택 유지)
  _qgActiveBook = null;
  _qgActiveChapter = null;
  _qgRender();
};

// ──────────────────────────────────────────────────────────────────────────
// Phase 2.5: 4컬럼 레이아웃 (Book | Chapter | Page | 설정)
// ──────────────────────────────────────────────────────────────────────────
function _qgRender() {
  const root = document.getElementById('quizGenRoot');
  if (!root) return;

  const books = _genBooks || [];
  const chapters = _qgFilteredChapters();
  const pages = _qgFilteredPages();

  root.innerHTML = `
    <div id="qgTopRow" style="display:flex;gap:0;height:calc(100vh - 210px);min-height:520px;">

      <!-- 1. Book 컬럼 -->
      <div id="qgBookPane" class="qg-pane" style="flex:25 1 0;min-width:150px;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:10px 12px;background:#f8f9fa;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;font-size:13px;">📚 Book</div>
            <div style="font-size:10px;color:var(--gray);">${books.length}개</div>
          </div>
          ${_qgActiveBook ? `<button style="background:none;border:none;color:var(--gray);cursor:pointer;font-size:11px;" onclick="qgClearBook()">해제</button>` : ''}
        </div>
        <div style="flex:1;overflow-y:auto;">
          ${books.length === 0
            ? '<div style="padding:16px;text-align:center;color:#bbb;font-size:12px;">Book 이 없습니다</div>'
            : books.map(b => {
                const isActive = _qgActiveBook?.id === b.id;
                const pageCount = (_genPages||[]).filter(p => p.bookId === b.id).length;
                return `<div onclick="qgSelectBook('${esc(b.id)}')"
                  style="padding:9px 12px;border-bottom:1px solid #f5f5f5;cursor:pointer;font-size:12px;${isActive?'background:var(--teal-light);color:var(--teal);font-weight:600;':''}">
                  <div style="font-weight:${isActive?'700':'500'};">${esc(b.name||'(이름 없음)')}</div>
                  <div style="font-size:10px;color:${isActive?'var(--teal)':'var(--gray)'};margin-top:2px;">${pageCount}P</div>
                </div>`;
              }).join('')
          }
        </div>
      </div>

      <div class="qg-resizer" data-idx="0" title="드래그하여 폭 조정" style="width:8px;cursor:col-resize;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:transparent;">
        <div style="width:2px;height:40px;background:var(--border);border-radius:1px;"></div>
      </div>

      <!-- 2. Chapter 컬럼 -->
      <div id="qgChapterPane" class="qg-pane" style="flex:25 1 0;min-width:150px;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:10px 12px;background:#f8f9fa;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;font-size:13px;">📂 Chapter</div>
            <div style="font-size:10px;color:var(--gray);">
              ${_qgActiveBook ? `${chapters.length}개 · ${esc(_qgActiveBook.name)}` : '모두 표시'}
            </div>
          </div>
          ${_qgActiveChapter ? `<button style="background:none;border:none;color:var(--gray);cursor:pointer;font-size:11px;" onclick="qgClearChapter()">해제</button>` : ''}
        </div>
        <div style="flex:1;overflow-y:auto;">
          ${chapters.length === 0
            ? `<div style="padding:16px;text-align:center;color:#bbb;font-size:12px;">
                ${_qgActiveBook ? '이 Book 엔 Chapter 가 없습니다.<br>(Page 컬럼에 Book 의 전체 Page 가 표시됩니다)' : 'Book 을 먼저 선택하세요'}
              </div>`
            : chapters.map(c => {
                const isActive = _qgActiveChapter?.id === c.id;
                const pageCount = (_genPages||[]).filter(p => p.chapterId === c.id).length;
                return `<div onclick="qgSelectChapter('${esc(c.id)}')"
                  style="padding:9px 12px;border-bottom:1px solid #f5f5f5;cursor:pointer;font-size:12px;${isActive?'background:var(--teal-light);color:var(--teal);font-weight:600;':''}">
                  <div style="font-weight:${isActive?'700':'500'};">${esc(c.name||'(이름 없음)')}</div>
                  <div style="font-size:10px;color:${isActive?'var(--teal)':'var(--gray)'};margin-top:2px;">${pageCount}P</div>
                </div>`;
              }).join('')
          }
        </div>
      </div>

      <div class="qg-resizer" data-idx="1" title="드래그하여 폭 조정" style="width:8px;cursor:col-resize;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:transparent;">
        <div style="width:2px;height:40px;background:var(--border);border-radius:1px;"></div>
      </div>

      <!-- 3. Page 컬럼 (체크박스 다중 선택) -->
      <div id="qgPagePane" class="qg-pane" style="flex:25 1 0;min-width:150px;background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:10px 12px;background:#f8f9fa;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;">📄 Page · 선택 <span id="qgSelCount" style="color:var(--teal);">${_qgSelectedPageIds.size}</span>개 <span style="font-weight:400;color:var(--gray);font-size:10px;">(최대 10개)</span></div>
            <div style="font-size:10px;color:var(--gray);">${pages.length}개 표시 중 (본문 20자 이상만)</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;" onclick="qgSelectAll()">전체</button>
            <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;" onclick="qgSelectNone()">해제</button>
          </div>
        </div>
        <div style="flex:1;overflow-y:auto;">
          ${pages.length === 0
            ? '<div style="padding:20px;text-align:center;color:#bbb;font-size:12px;">표시할 Page 가 없습니다</div>'
            : pages.map(p => {
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
              }).join('')
          }
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

  panel.innerHTML = cfg.options.map(opt => {
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

  if (!cfg.enabled) {
    showToast(`${cfg.label}은(는) ${cfg.phaseLabel} 이후 구현 예정입니다`);
    return;
  }

  if (_qgSelectedPageIds.size === 0) {
    showToast('Page 를 먼저 선택하세요');
    return;
  }
  if (_qgSelectedPageIds.size > 10) {
    showToast('한 번에 최대 10개 Page까지 가능합니다');
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
  if (status) status.innerHTML = '🤖 Gemini 호출 중...<br><span style="font-size:10px;">5~15초 소요</span>';

  const selectedPages = (_genPages||[])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .map(p => ({ id: p.id, title: p.title||'', text: p.text||'' }));

  try {
    const t0 = Date.now();
    const res = await fetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages: selectedPages, count: opts.count, type: 'mcq', customSystemPrompt: _qgGetCustomPrompt('mcq') || undefined }),
    });
    const data = await res.json();
    const sec = ((Date.now()-t0)/1000).toFixed(1);

    if (!res.ok || !data.success) {
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

// ─── Fill-blank API 호출 (Phase 3 + 4 하이브리드) ───
async function _qgCallFillBlank(opts) {
  const mode = opts.generationMode || '규칙 기반 (즉시·무료)';

  // 규칙 기반 모드: 로컬 즉시 생성 (API 호출 없음)
  if (mode.startsWith('규칙')) {
    _qgGenFillBlankLocal(opts);
    return;
  }

  const btn = document.getElementById('qgGenBtn');
  const status = document.getElementById('qgStatus');
  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '🤖 Gemini 호출 중...<br><span style="font-size:10px;">5~15초 소요</span>';

  const selectedPages = (_genPages||[])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .map(p => ({ id: p.id, title: p.title||'', text: p.text||'' }));

  try {
    const t0 = Date.now();
    const res = await fetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pages: selectedPages,
        count: opts.count,
        type: 'fill_blank',
        blanksPerSentence: opts.blanksPerSentence,
        customSystemPrompt: _qgGetCustomPrompt('fill_blank') || undefined,
      }),
    });
    const data = await res.json();
    const sec = ((Date.now()-t0)/1000).toFixed(1);

    if (!res.ok || !data.success) {
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

// ─── 빈칸채우기 규칙 기반 로컬 생성기 (Phase 4 하이브리드) ───
// API 호출 없이 클라이언트에서 즉시 생성. stopwords 제외 + 내용어(4자+) 무작위 선별
function _qgGenFillBlankLocal(opts) {
  const status = document.getElementById('qgStatus');
  const btn = document.getElementById('qgGenBtn');
  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '⚡ 규칙 기반 생성 중...';

  const t0 = Date.now();
  const requested = Math.max(1, parseInt(opts.count) || 5);
  const blanksPerSent = Math.min(Math.max(parseInt(opts.blanksPerSentence)||1, 1), 5);

  const selectedPages = (_genPages||[]).filter(p => _qgSelectedPageIds.has(p.id));

  const allSentences = [];
  selectedPages.forEach(p => {
    const raw = (p.text||'').replace(/\s+/g, ' ').trim();
    const sents = raw.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    sents.forEach(s => {
      if (s.length >= 20 && s.length <= 250) {
        allSentences.push({ sentence: s, pageId: p.id, pageTitle: p.title||'' });
      }
    });
  });

  if (allSentences.length === 0) {
    if (status) status.innerHTML = '<span style="color:#c33;">❌ 빈칸을 만들 문장이 부족합니다</span>';
    showToast('선택한 Page에 적절한 문장이 없습니다 (20~250자)');
    if (btn) btn.disabled = false;
    return;
  }

  allSentences.sort(() => Math.random() - 0.5);

  const stopwords = _qgStopwords();

  const questions = [];
  for (const item of allSentences) {
    if (questions.length >= requested) break;
    const q = _qgMakeBlankFromSentence(item, blanksPerSent, stopwords);
    if (q) questions.push(q);
  }

  const sec = ((Date.now()-t0)/1000).toFixed(2);

  if (questions.length === 0) {
    if (status) status.innerHTML = '<span style="color:#c33;">❌ 조건에 맞는 문제를 만들 수 없습니다</span>';
    showToast('조건에 맞는 문제 생성 실패. 빈칸 개수를 줄여보세요');
    if (btn) btn.disabled = false;
    return;
  }

  _qgGenerated = questions;
  _qgExcluded.clear();
  if (status) status.innerHTML = `<span style="color:#0a7a3a;">⚡ 즉시 생성 · ${sec}s · ${questions.length}/${requested}문제</span>`;
  if (btn) btn.disabled = false;

  _qgShowResultModal({
    questions,
    model: '규칙 기반 (로컬 생성)',
    requestedCount: requested,
  });
}

function _qgMakeBlankFromSentence(item, blanksPerSent, stopwords) {
  const sent = item.sentence;
  const words = sent.split(/\s+/);

  const candidates = [];
  words.forEach((w, i) => {
    const clean = w.replace(/[^a-zA-Z']/g, '');
    if (clean.length < 4) return;
    if (stopwords.has(clean.toLowerCase())) return;
    candidates.push({ word: clean, idx: i, original: w });
  });

  if (candidates.length < blanksPerSent) return null;

  const picked = candidates
    .slice()
    .sort(() => Math.random() - 0.5)
    .slice(0, blanksPerSent)
    .sort((a, b) => a.idx - b.idx);

  const blanks = picked.map(p => p.word);

  const newWords = [...words];
  picked.forEach(p => {
    newWords[p.idx] = newWords[p.idx].replace(p.word, '___');
  });

  return {
    type: 'fill_blank',
    sentence: newWords.join(' '),
    blanks,
    questionKo: '문장의 빈칸에 알맞은 단어를 쓰세요.',
    explanation: '',
    sourcePageId: item.pageId,
    sourcePageTitle: item.pageTitle,
    difficulty: 'medium',
  };
}

function _qgStopwords() {
  return new Set([
    'the','a','an','is','are','was','were','be','been','being','am',
    'to','of','in','on','at','for','with','by','from','as','into','about',
    'through','over','under','between','against','during','before','after',
    'and','or','but','so','because','if','when','while','since','than',
    'although','though','whereas','however','therefore','thus',
    'i','you','he','she','it','we','they','me','him','her','us','them',
    'this','that','these','those','my','your','his','her','its','our','their',
    'mine','yours','hers','ours','theirs',
    'not','no','yes','do','does','did','have','has','had','will','would',
    'can','could','should','may','might','must','shall',
    'just','also','only','even','still','always','never','often','sometimes',
    'there','here','where','what','which','who','whom','whose','how','why',
    'very','much','many','some','any','all','each','every','both','few','more','most','other','same','such',
  ]);
}

// ─── Subjective API 호출 (Phase 4) ───
async function _qgCallSubjective(opts) {
  const btn = document.getElementById('qgGenBtn');
  const status = document.getElementById('qgStatus');
  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '🤖 Gemini 호출 중...<br><span style="font-size:10px;">5~15초 소요</span>';

  const selectedPages = (_genPages||[])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .map(p => ({ id: p.id, title: p.title||'', text: p.text||'' }));

  try {
    const t0 = Date.now();
    const res = await fetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages: selectedPages, count: opts.count, type: 'subjective', customSystemPrompt: _qgGetCustomPrompt('subjective') || undefined }),
    });
    const data = await res.json();
    const sec = ((Date.now()-t0)/1000).toFixed(1);

    if (!res.ok || !data.success) {
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
  if (status) status.innerHTML = '🤖 Gemini 호출 중...<br><span style="font-size:10px;">5~15초 소요</span>';

  const selectedPages = (_genPages||[])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .map(p => ({ id: p.id, title: p.title||'', text: p.text||'' }));

  try {
    const t0 = Date.now();
    const res = await fetch('/api/generate-quiz', {
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

// ─── Vocab API 호출 (Phase 6) ───
async function _qgCallVocab(opts) {
  const btn = document.getElementById('qgGenBtn');
  const status = document.getElementById('qgStatus');
  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '🤖 Gemini 호출 중...<br><span style="font-size:10px;">5~15초 소요</span>';

  const selectedPages = (_genPages||[])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .map(p => ({ id: p.id, title: p.title||'', text: p.text||'' }));

  try {
    const t0 = Date.now();
    const res = await fetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pages: selectedPages,
        count: opts.count,
        type: 'vocab',
        difficulty: opts.difficulty,
        customSystemPrompt: _qgGetCustomPrompt('vocab') || undefined,
      }),
    });
    const data = await res.json();
    const sec = ((Date.now()-t0)/1000).toFixed(1);

    if (!res.ok || !data.success) {
      if (status) status.innerHTML = `<span style="color:#c33;">❌ 실패 (${sec}s) — ${esc(data.error||'unknown')}</span>`;
      showToast('생성 실패: ' + (data.error||'unknown'));
      return;
    }

    _qgGenerated = data.questions || [];
    _qgExcluded.clear();
    if (opts.shuffleQ === 'On') _qgGenerated.sort(() => Math.random() - 0.5);

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
  if (status) status.innerHTML = '🤖 Gemini 호출 중...<br><span style="font-size:10px;">5~15초 소요</span>';

  const selectedPages = (_genPages||[])
    .filter(p => _qgSelectedPageIds.has(p.id))
    .map(p => ({ id: p.id, title: p.title||'', text: p.text||'' }));

  try {
    const t0 = Date.now();
    const res = await fetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pages: selectedPages,
        count: opts.count,
        type: 'unscramble',
        difficulty: opts.difficulty,
        chunkCount: parseInt(opts.chunkCount) || 4,
        customSystemPrompt: _qgGetCustomPrompt('unscramble') || undefined,
      }),
    });
    const data = await res.json();
    const sec = ((Date.now()-t0)/1000).toFixed(1);

    if (!res.ok || !data.success) {
      if (status) status.innerHTML = `<span style="color:#c33;">❌ 실패 (${sec}s) — ${esc(data.error||'unknown')}</span>`;
      showToast('생성 실패: ' + (data.error||'unknown'));
      return;
    }

    _qgGenerated = data.questions || [];
    _qgExcluded.clear();
    if (opts.shuffleQ === 'On') _qgGenerated.sort(() => Math.random() - 0.5);

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
  if (_qgSelectedPageIds.size === 0) {
    showToast('Page 를 선택하세요');
    return;
  }

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
    accuracyThreshold: parseInt(opts.accuracyThreshold) || 70,
    evaluationSeconds: parseInt(opts.evaluationSeconds) || 60,
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
  if (!_qgGenerated.length) {
    showToast('AI가 문제를 생성하지 못했습니다. 본문이 너무 짧거나 부적절할 수 있습니다.');
    return;
  }
  _qgModel = data.model || '';

  const defaultName = data.defaultName || _qgBuildDefaultName();

  const html = `
    <div style="width:min(820px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:16px;font-weight:700;">🎯 AI 생성 결과 미리보기</div>
            <div style="font-size:11px;color:var(--gray);margin-top:2px;">
              제외할 문제는 체크박스 해제 · 모델: <code>${esc(data.model||'')}</code> · 선택 <span id="qgIncludeCount">${_qgGenerated.length}</span> / ${_qgGenerated.length}
            </div>
          </div>
          <button onclick="qgDiscardModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--gray);">✕</button>
        </div>
      </div>

      <div style="padding:14px 20px;flex:1;overflow-y:auto;">
        <div id="qgResultList">
          ${_qgGenerated.map((q,i) => _qgRenderQuestion(q,i)).join('')}
        </div>
      </div>

      <div style="padding:14px 20px;border-top:1px solid var(--border);background:#fafafa;">
        <label style="font-size:12px;font-weight:600;">세트 이름</label>
        <input type="text" id="qgSetName" value="${esc(defaultName)}" placeholder="예: Lesson 3 - 객관식 5문제"
          style="width:100%;padding:9px 12px;margin:5px 0 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" style="flex:1;" onclick="qgSaveSet()">💾 문제 세트로 저장</button>
          <button class="btn btn-secondary" onclick="qgDiscardModal()">✖ 버리기</button>
        </div>
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
    showToast('세트 이름을 입력하세요');
    nameInput?.focus();
    return;
  }

  // 제외된 문제 필터링
  const finalQuestions = _qgGenerated.filter((_, i) => !_qgExcluded.has(i));
  if (finalQuestions.length === 0) {
    showToast('저장할 문제가 하나도 없습니다');
    return;
  }

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
      getDocs(query(collection(db,'genQuestionSets'), orderBy('createdAt','desc'))),
      getDocs(query(collection(db,'genBooks'), orderBy('createdAt','asc'))),
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
function _qsTypeLabel(t) {
  return ({ mcq:'객관식', fill_blank:'빈칸', subjective:'주관식', recording:'녹음', vocab:'단어', unscramble:'언스크램블' })[t] || t || '-';
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
        <div style="font-size:12px;">'AI 문제 생성' 메뉴에서 새 세트를 만들어보세요</div>
        <button class="btn btn-primary" style="margin-top:16px;" onclick="goPage('quiz-generate')">✨ AI 문제 생성하러 가기</button>
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
      <button class="action-btn" onclick="qsAssignSet('${esc(s.id)}')" style="font-size:11px;padding:3px 8px;background:#e8f5e9;color:#2e7d32;border-color:#c8e6c9;">배정</button>
      <button class="action-btn" onclick="qsViewDetail('${esc(s.id)}')" style="font-size:11px;padding:3px 8px;">보기</button>
      <button class="action-btn" onclick="qsEditSet('${esc(s.id)}')" style="font-size:11px;padding:3px 8px;">수정</button>
      <button class="action-btn" onclick="qsRenameSet('${esc(s.id)}')" style="font-size:11px;padding:3px 8px;">이름</button>
      <button class="action-btn danger" onclick="qsDeleteSet('${esc(s.id)}')" style="font-size:11px;padding:3px 8px;">🗑</button>
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
  if (!s) { showToast('세트를 찾을 수 없음'); return; }
  if (!s.sourceType) { showToast('세트 유형이 없어 배정할 수 없습니다'); return; }

  const type = _QS_SOURCE_TO_UI_TYPE[s.sourceType] || s.sourceType;
  const cfg = _TEST_TYPE_CONFIG?.[type];
  if (!cfg) { showToast('지원하지 않는 유형: ' + s.sourceType); return; }
  if (!cfg.actions?.includes('assign')) {
    showToast(`${cfg.kindLabel||type}은(는) 학생앱 배정이 지원되지 않습니다 (인쇄만 가능)`);
    return;
  }

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
  const s = _qsList.find(x => x.id === setId);
  if (!s) { showToast('세트를 찾을 수 없음'); return; }

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
  if (!trimmed) { showToast('빈 이름 불가'); return; }
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

window.qsEditSet = (setId) => {
  const s = _qsList.find(x => x.id === setId);
  if (!s) { showToast('세트를 찾을 수 없음'); return; }

  _qsEditState = {
    setId: s.id,
    name: s.name || '',
    sourceType: s.sourceType || 'mcq',
    questions: JSON.parse(JSON.stringify(s.questions || [])),
  };
  _qsRenderEditModal();
};

function _qsRenderEditModal() {
  const st = _qsEditState;
  if (!st) return;
  const typeLabel = { mcq:'객관식', fill_blank:'빈칸채우기' }[st.sourceType] || st.sourceType;
  const html = `
    <div style="width:100%;flex:1;display:flex;flex-direction:column;min-height:0;">
      <div style="padding:16px 22px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div style="font-size:17px;font-weight:700;">✏️ 문제 세트 수정</div>
        <div style="font-size:11px;color:var(--gray);margin-top:4px;">총 ${st.questions.length}문제 · 유형: ${esc(typeLabel)}</div>
      </div>

      <div style="padding:14px 22px;border-bottom:1px solid var(--border);background:#fafafa;flex-shrink:0;">
        <label style="font-size:11px;font-weight:700;color:var(--gray);">세트 이름</label>
        <input type="text" id="qsEditName" value="${esc(st.name)}"
          style="width:100%;padding:9px 12px;margin-top:5px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
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
  if (!newName) { showToast('세트 이름을 입력하세요'); return; }

  // 검증 — 유형별
  for (let i = 0; i < st.questions.length; i++) {
    const q = st.questions[i];
    if (q.type === 'fill_blank') {
      const sentence = (q.sentence||'').trim();
      if (!sentence) { showToast(`${i+1}번: 문장이 비어있음`); return; }
      const markerCount = (sentence.match(/___/g) || []).length;
      if (markerCount === 0) { showToast(`${i+1}번: 문장에 ___ 마커가 없습니다`); return; }
      const blanks = (q.blanks || []).filter(b => b && b.trim());
      if (blanks.length !== markerCount) {
        showToast(`${i+1}번: ___ ${markerCount}개 vs 정답 ${blanks.length}개 불일치`);
        return;
      }
    } else if (q.type === 'subjective') {
      if (!(q.sentence||'').trim()) { showToast(`${i+1}번: 원문이 비어있음`); return; }
      // sampleAnswerKo 는 선택 항목
    } else if (q.type === 'vocab') {
      if (!(q.word||'').trim()) { showToast(`${i+1}번: 영단어가 비어있음`); return; }
      if (!(q.meaning||'').trim()) { showToast(`${i+1}번: 뜻이 비어있음`); return; }
    } else if (q.type === 'unscramble') {
      const chunked = (q.chunkedSentence||'').trim();
      if (!chunked) { showToast(`${i+1}번: 영문이 비어있음`); return; }
      const chunks = chunked.split('/').map(s=>s.trim()).filter(Boolean);
      if (chunks.length < 2) { showToast(`${i+1}번: 청크가 최소 2개 필요합니다`); return; }
      if (!(q.meaningKo||'').trim()) { showToast(`${i+1}번: 한글 뜻이 비어있음`); return; }
    } else if (q.type === 'recording') {
      if (q.schemaV === 2) {
        if (!(q.fullText||'').trim()) { showToast(`${i+1}번: 본문이 비어있음`); return; }
        if (!(q.instructionKo||'').trim()) { showToast(`${i+1}번: 지시문이 비어있음`); return; }
      } else {
        if (!(q.sentence||'').trim()) { showToast(`${i+1}번: 녹음 문장이 비어있음`); return; }
      }
    } else {
      // MCQ (기본)
      if (!(q.question||'').trim()) { showToast(`${i+1}번: 질문이 비어있음`); return; }
      const choices = q.choices || [];
      if (choices.length !== 4) { showToast(`${i+1}번: 선택지는 4개여야 합니다`); return; }
      const answerCount = choices.filter(c => c.isAnswer).length;
      if (answerCount !== 1) { showToast(`${i+1}번: 정답이 정확히 1개여야 합니다`); return; }
      if (choices.some(c => !(c.text||'').trim())) { showToast(`${i+1}번: 빈 선택지가 있습니다`); return; }
    }
  }

  if (!(await showConfirm('수정사항을 저장할까요?', `${st.questions.length}문제 업데이트`))) return;

  try {
    await updateDoc(doc(db,'genQuestionSets',st.setId), {
      name: newName,
      questions: st.questions,
      questionCount: st.questions.length,
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
        <div style="font-size:12px;">먼저 'AI 문제 생성' 메뉴에서 객관식 세트를 만들어주세요</div>
        <button class="btn btn-primary" style="margin-top:16px;" onclick="goPage('quiz-generate')">✨ AI 문제 생성하러 가기</button>
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
          <input type="date" id="mcqDate" value="${new Date().toISOString().slice(0,10)}"
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
    const snap = await getDocs(query(collection(db,'users'),where('role','==','student'),where('status','==','active')));
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
    <div style="max-width:560px;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:16px;font-weight:700;">👥 배정 대상 선택</div>
        <div style="font-size:11px;color:var(--gray);margin-top:4px;">반 체크 = 반 전체 · 학생 체크 = 개별 지정 (중복 선택시 우선)</div>
      </div>
      <div style="padding:12px 22px;max-height:55vh;overflow-y:auto;">
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
      <div style="padding:14px 22px;border-top:1px solid var(--border);text-align:right;">
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
    const date = document.getElementById('mcqDate')?.value || new Date().toISOString().slice(0,10);

    if (_mcqSelectedSets.size === 0) {
      console.warn('[mcqPublish] 중단: 선택된 세트 없음');
      showToast('문제 세트를 1개 이상 선택하세요');
      return;
    }
    if (!name) {
      console.warn('[mcqPublish] 중단: 시험명 없음');
      showToast('시험명을 입력하세요');
      document.getElementById('mcqName')?.focus();
      return;
    }
    if (_mcqTargets.length === 0) {
      console.warn('[mcqPublish] 중단: 배정 대상 없음');
      showToast('배정 대상을 선택하세요');
      return;
    }

    const selectedSets = _mcqSets.filter(s => _mcqSelectedSets.has(s.id));
    const questions = selectedSets.flatMap(s => s.questions || []);
    console.log('[mcqPublish] 합쳐진 문제 수:', questions.length);
    if (questions.length === 0) {
      showToast('선택된 세트에 문제가 없습니다');
      return;
    }

    const summary = `${selectedSets.length}개 세트 · ${questions.length}문제\n대상 ${_mcqTargets.length}명/반\n통과점수 ${passScore}점`;
    const confirmed = await showConfirm(`"${name}" 시험을 배정할까요?`, summary);
    console.log('[mcqPublish] showConfirm 결과:', confirmed);
    if (!confirmed) return;

    const targetType = (_mcqTargets.length===1 && _mcqTargets[0].type==='class') ? 'class' : 'mixed';
    const targetId = _mcqTargets.map(t => t.id).join(',');
    const targetName = _mcqTargets.length===1
      ? _mcqTargets[0].name
      : `${_mcqTargets.length}명/반 선택`;

    const bookName = selectedSets[0]?.sourcePages?.[0]?.pageTitle || '';

    const docRef = await addDoc(collection(db,'genTests'), {
      name,
      academy: '큰소리영어',
      date,
      testMode: 'reading-mcq',
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
    testMode: 'fill-blank',
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
    testMode: 'reading-mcq',
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
    testMode: 'recording-ai',
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
        getDocs(query(collection(db,'genBooks'), orderBy('createdAt','asc'))),
        getDocs(query(collection(db,'genChapters'), orderBy('order','asc'))),
      ]);
      _genBooks = bSnap.docs.map(d => ({id:d.id, ...d.data()}));
      _genChapters = cSnap.docs.map(d => ({id:d.id, ...d.data()}));
    } catch(e) { console.warn('gen data load:', e); }
  }

  if (cfg.enabled && cfg.sourceType) {
    try {
      const setSnap = await getDocs(query(collection(db,'genQuestionSets'), orderBy('createdAt','desc')));
      _tpSets = setSnap.docs.map(d => ({id:d.id, ...d.data()}))
        .filter(s => (s.sourceType || 'mcq') === cfg.sourceType);

      // actions에 'assign' 이 없으면 genTests 조회 생략 (배정 안 하므로)
      if (!cfg.actions?.includes('assign')) {
        _tpGenTests = [];
      } else {
        const testSnap = await getDocs(query(collection(db,'genTests'), orderBy('createdAt','desc')));
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
            </div>
          </div>
          <div style="flex:1;overflow-y:auto;">
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
      });
    }
    map.get(key).count++;
  });
  return [...map.values()].sort((a,b) => a.name.localeCompare(b.name, 'ko'));
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
    <div onclick="tpToggleSet('${esc(s.id)}')"
      style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:center;cursor:pointer;${_tpSelectedSets.has(s.id)?'background:#fff8e6;':''}">
      <input type="checkbox" ${checked} onclick="event.stopPropagation();tpToggleSet('${esc(s.id)}')" style="flex-shrink:0;">
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
      <button class="btn btn-primary" onclick="goPage('quiz-generate')">✨ AI 문제 생성하러 가기</button>
    </div>`;
}

function _tpRenderTestsTable() {
  return `
    <table style="width:100%;border-collapse:collapse;">
      <thead style="background:#f8f9fa;position:sticky;top:0;z-index:1;">
        <tr>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);">시험명</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);width:140px;">대상</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);width:70px;">문항</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);width:100px;" title="통과자 / 응시자 / 대상자 (고유 학생 수)">통과/응시/대상</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);width:80px;">평균</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--gray);border-bottom:1px solid var(--border);width:90px;">출제일</th>
        </tr>
      </thead>
      <tbody>
        ${_tpGenTests.map(t => _tpRenderTestRow(t)).join('')}
      </tbody>
    </table>`;
}

function _tpRenderTestRow(t) {
  const qCount = t.questionCount || t.questions?.length || 0;
  return `
    <tr style="cursor:pointer;" onclick="tpToggleTestProgress('${esc(t.id)}')" id="tp-row-${t.id}">
      <td style="padding:10px 12px;font-size:13px;font-weight:600;color:var(--text);border-bottom:1px solid #f5f5f5;">${esc(t.name||'-')}</td>
      <td style="padding:10px 12px;font-size:12px;color:var(--gray);border-bottom:1px solid #f5f5f5;">${esc(t.targetName||'-')}</td>
      <td style="padding:10px 12px;text-align:center;font-size:12px;color:var(--text);border-bottom:1px solid #f5f5f5;">${qCount}</td>
      <td style="padding:10px 12px;text-align:center;font-size:12px;color:var(--text);border-bottom:1px solid #f5f5f5;" id="tp-attempt-${t.id}"><span style="color:#ccc;">…</span></td>
      <td style="padding:10px 12px;text-align:center;font-size:12px;color:var(--text);border-bottom:1px solid #f5f5f5;" id="tp-avg-${t.id}"><span style="color:#ccc;">…</span></td>
      <td style="padding:10px 12px;font-size:11px;color:var(--gray);border-bottom:1px solid #f5f5f5;">${esc(t.date||'')}</td>
    </tr>
    <tr id="tp-progress-${t.id}" style="display:none;background:#f0faff;">
      <td colspan="6" style="padding:0;">
        <div id="tp-progress-content-${t.id}" style="padding:10px 16px;font-size:12px;color:var(--gray);">로딩 중...</div>
      </td>
    </tr>`;
}

async function _tpLoadTestStats() {
  try {
    const scoresSnap = await getDocs(collection(db,'scores'));
    const allScores = scoresSnap.docs.map(d => d.data());

    // 학생 전체 로드 (대상자 계산용)
    if (!Array.isArray(allStudents) || allStudents.length === 0) {
      try {
        const sSnap = await getDocs(query(collection(db,'users'), where('role','==','student')));
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

window.tpOpenPublishModal = async () => {
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  if (!cfg?.enabled) return;
  if (_tpSelectedSets.size === 0) { showToast('문제 세트를 선택하세요'); return; }

  const selectedSets = _tpSets.filter(s => _tpSelectedSets.has(s.id));
  const questions = selectedSets.flatMap(s => s.questions || []);
  if (questions.length === 0) { showToast('선택된 세트에 문제가 없습니다'); return; }

  let students = [];
  try {
    const snap = await getDocs(query(
      collection(db,'users'),
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
        <div style="font-size:17px;font-weight:700;">📝 시험 배정</div>
        <div style="font-size:11px;color:var(--gray);margin-top:4px;">
          ${esc(cfg.kindLabel)} · ${selectedSets.length}개 세트 · 총 ${questions.length}문제
        </div>
      </div>

      <div style="padding:16px 22px;overflow-y:auto;flex:1;">
        <div style="margin-bottom:16px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:8px;">📋 시험 정보</div>
          <div style="display:grid;grid-template-columns:1fr 110px 140px;gap:8px;">
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--gray);">시험명 *</label>
              <input type="text" id="tpName" value="${esc(defaultName)}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:3px;">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--gray);">통과점수</label>
              <input type="number" id="tpPassScore" value="80" min="0" max="100" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:3px;">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--gray);">출제일</label>
              <input type="date" id="tpDate" value="${new Date().toISOString().slice(0,10)}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-top:3px;">
            </div>
          </div>
        </div>

        ${cfg.testMode === 'recording-ai' && selectedSets.some(s => s.questions?.[0]?.schemaV === 2)
          ? `<div style="margin-bottom:14px;padding:10px 12px;background:#fff8e1;border-radius:6px;border:1px solid #ffc107;">
              <div style="font-size:11px;font-weight:700;color:#8a6d1c;margin-bottom:8px;">🎤 녹음숙제 평가 옵션 (반별 조정 가능)</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div>
                  <label style="font-size:11px;font-weight:600;color:var(--gray);">정확도 임계값</label>
                  <input type="number" id="tpRecThreshold" min="50" max="95"
                    value="${selectedSets[0]?.questions?.[0]?.accuracyThreshold || 70}"
                    style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;">
                  <div style="font-size:10px;color:var(--gray);margin-top:2px;">3회차가 이 점수 이상일 때만 피드백</div>
                </div>
                <div>
                  <label style="font-size:11px;font-weight:600;color:var(--gray);">평가 구간 (초)</label>
                  <input type="number" id="tpRecEvalSec" min="30" max="180"
                    value="${selectedSets[0]?.questions?.[0]?.evaluationSeconds || 60}"
                    style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;">
                  <div style="font-size:10px;color:var(--gray);margin-top:2px;">녹음 중 N초만 AI 가 평가</div>
                </div>
              </div>
            </div>`
          : ''}

        ${cfg.testMode === 'vocab'
          ? `<div style="margin-bottom:14px;padding:10px 12px;background:#eff6ff;border-radius:6px;border:1px solid #bfdbfe;">
              <div style="font-size:11px;font-weight:700;color:#1e40af;margin-bottom:8px;">📝 단어시험 풀이 옵션 (학생앱 적용)</div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                <div>
                  <label style="font-size:11px;font-weight:600;color:var(--gray);">형식</label>
                  <select id="tpVocabFormat" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;background:white;">
                    <option value="mixed" selected>혼합</option>
                    <option value="short">주관식(스펠링)</option>
                    <option value="mcq">객관식</option>
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
  const date = document.getElementById('tpDate')?.value || new Date().toISOString().slice(0,10);
  const targets = window._tpModalTargets || [];

  if (!name) { showToast('시험명을 입력하세요'); document.getElementById('tpName')?.focus(); return; }
  if (targets.length === 0) { showToast('배정 대상을 선택하세요'); return; }
  if (_tpSelectedSets.size === 0) { showToast('문제 세트가 비어있습니다'); return; }

  const selectedSets = _tpSets.filter(s => _tpSelectedSets.has(s.id));
  const questions = selectedSets.flatMap(s => s.questions || []);
  if (questions.length === 0) { showToast('선택된 세트에 문제가 없습니다'); return; }

  // Phase 5.5: recording-ai v2 의 경우 배정 모달에서 임계값·평가 시간 override
  if (cfg.testMode === 'recording-ai' && questions.some(q => q.schemaV === 2)) {
    const threshold = parseInt(document.getElementById('tpRecThreshold')?.value);
    const evalSec = parseInt(document.getElementById('tpRecEvalSec')?.value);
    if (!isNaN(threshold) && threshold >= 50 && threshold <= 95) {
      questions.forEach(q => { if (q.schemaV === 2) q.accuracyThreshold = threshold; });
    }
    if (!isNaN(evalSec) && evalSec >= 30 && evalSec <= 180) {
      questions.forEach(q => { if (q.schemaV === 2) q.evaluationSeconds = evalSec; });
    }
  }

  // Phase 6B: vocab 풀이 옵션 (학생앱에서 매번 적용)
  let vocabOptions = null;
  if (cfg.testMode === 'vocab') {
    vocabOptions = {
      format: document.getElementById('tpVocabFormat')?.value || 'mixed',         // mixed | short | mcq
      direction: document.getElementById('tpVocabDirection')?.value || 'mixed',   // mixed | en2ko | ko2en
      mcqRatio: Math.max(0, Math.min(100, parseInt(document.getElementById('tpVocabMcqRatio')?.value) || 50)),
      shuffleQ: document.getElementById('tpVocabShuffleQ')?.checked !== false,
      shuffleChoices: document.getElementById('tpVocabShuffleChoices')?.checked !== false,
    };
  }

  const summary = `${selectedSets.length}개 세트 · ${questions.length}문제\n대상 ${targets.length}명/반\n통과점수 ${passScore}점`;
  if (!(await showConfirm(`"${name}" 시험을 배정할까요?`, summary))) return;

  const targetType = (targets.length===1 && targets[0].type==='class') ? 'class' : 'mixed';
  const targetId = targets.map(t => t.id).join(',');
  const targetName = targets.length===1 ? targets[0].name : `${targets.length}명/반 선택`;
  // 교재: 첫 세트의 sourcePages[0] 에서 Book · Chapter 이름 조회
  const sp = selectedSets[0]?.sourcePages?.[0];
  const book = sp ? (_genBooks||[]).find(b => b.id === sp.bookId) : null;
  const chap = sp ? (_genChapters||[]).find(c => c.id === sp.chapterId) : null;
  const bookName = [book?.name, chap?.name].filter(Boolean).join(' · ') || '';

  try {
    await addDoc(collection(db,'genTests'), {
      name, academy:'큰소리영어', date,
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

window.tpOpenPrintModal = () => {
  const cfg = _TEST_TYPE_CONFIG[_activeTestType];
  if (!cfg?.enabled || !cfg.actions?.includes('print')) return;
  if (_tpSelectedSets.size === 0) { showToast('문제 세트를 선택하세요'); return; }

  const selectedSets = _tpSets.filter(s => _tpSelectedSets.has(s.id));
  const questions = selectedSets.flatMap(s => s.questions || []);
  if (questions.length === 0) { showToast('선택된 세트에 문제가 없습니다'); return; }

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
        <div style="display:flex;gap:8px;align-items:center;">
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);cursor:pointer;">
            <input type="checkbox" id="tpPrintShowAnswers" onchange="tpPrintRefreshPreview()"> 답지 보기
          </label>
          <button class="btn btn-secondary" onclick="closeModal()" style="font-size:12px;">취소</button>
          <button class="btn btn-primary" onclick="tpPrintNow()" style="font-size:12px;font-weight:700;">🖨 인쇄</button>
        </div>
      </div>

      <div style="padding:12px 20px;border-bottom:1px solid var(--border);background:#f8f9fa;flex-shrink:0;">
        <div style="display:grid;grid-template-columns:1fr 120px 130px;gap:10px;margin-bottom:${typeOptionsHtml?'10px':'0'};">
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
            <input type="date" id="tpPrintDate" value="${new Date().toISOString().slice(0,10)}"
              onchange="tpPrintRefreshPreview()"
              style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-top:3px;">
          </div>
        </div>
        ${typeOptionsHtml}
      </div>

      <div style="flex:1;overflow-y:auto;padding:20px;background:#e0e0e0;min-height:0;">
        <div id="tpPrintArea"></div>
      </div>

    </div>
  `;
  showModal(html, { fullFlex: true });
  window._tpPrintContext = { questions, bookName, chapName, sourceType };
  tpPrintRefreshPreview();
};

// 유형별 추가 옵션 UI (단어시험에 format/direction/columns 등)
function _tpBuildTypeOptionsUI(sourceType) {
  if (sourceType === 'vocab') {
    return `
      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);">
          형식:
          <select id="tpOptVocabFormat" onchange="tpPrintRefreshPreview()"
            style="padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;">
            <option value="mixed">혼합</option>
            <option value="short">주관식(스펠링)</option>
            <option value="mcq">객관식</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);">
          방향:
          <select id="tpOptVocabDirection" onchange="tpPrintRefreshPreview()"
            style="padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;">
            <option value="mixed">혼합</option>
            <option value="en2ko">영→한</option>
            <option value="ko2en">한→영</option>
          </select>
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
  const { title, academy, date, bookName, chapName, showAnswers, sourceType, typeOpts } = meta;

  // 유형별 렌더러 라우팅
  const renderers = {
    subjective: _printRenderSubj,
    vocab: _printRenderVocab,
    unscramble: _printRenderUnscramble,
    fill_blank: _printRenderBlank,
    mcq: _printRenderMcq,
  };
  const renderer = renderers[sourceType] || _printRenderSubj;
  const body = renderer(questions, { showAnswers, typeOpts: typeOpts || {} });

  return `
    <div style="background:white;max-width:720px;margin:0 auto;padding:28px 36px;box-shadow:0 2px 8px rgba(0,0,0,0.12);font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;">
      <div style="border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:18px;">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:10px;color:#888;">${esc(academy||'')}</div>
            <div style="font-size:20px;font-weight:800;color:#111;margin-top:3px;">${esc(title||'시험')}</div>
            <div style="font-size:11px;color:#555;margin-top:5px;">
              ${bookName?`Book: <strong>${esc(bookName)}</strong>`:''}
              ${chapName?` · Chapter: <strong>${esc(chapName)}</strong>`:''}
              · 총 ${questions.length}문항 · 출제일: ${esc(date||'')}
            </div>
          </div>
          <div style="font-size:11px;text-align:right;line-height:1.9;flex-shrink:0;border:1px solid #999;padding:6px 10px;border-radius:4px;">
            이름: <span style="display:inline-block;width:90px;border-bottom:1px solid #333;">&nbsp;</span><br>
            반: <span style="display:inline-block;width:60px;border-bottom:1px solid #333;">&nbsp;</span> 점수: <span style="display:inline-block;width:50px;border-bottom:1px solid #333;">&nbsp;</span>
          </div>
        </div>
      </div>

      ${body}

      <div style="text-align:center;margin-top:28px;padding-top:10px;border-top:1px dashed #ccc;font-size:10px;color:#aaa;">— 끝 —</div>
    </div>
  `;
}

// ─── 유형별 프린트 렌더러 (Phase 6B) ───

function _printRenderSubj(questions, { showAnswers }) {
  return questions.map((q, i) => `
    <div style="margin-bottom:22px;page-break-inside:avoid;">
      <div style="font-size:12px;font-weight:700;margin-bottom:5px;">${i+1}. ${esc(q.questionKo || '위 문장을 우리말로 해석하시오.')}</div>
      <div data-fb-sent="${i}" style="font-size:13px;line-height:1.7;padding:9px 12px;background:#f5f5f5;border-left:3px solid #333;margin-bottom:8px;">${esc(q.sentence || '')}</div>
      ${showAnswers && q.sampleAnswerKo
        ? `<div style="font-size:11px;line-height:1.5;padding:8px 12px;background:#e8f5e9;border-left:3px solid #2e7d32;color:#1b5e20;"><strong>모범답안:</strong> ${esc(q.sampleAnswerKo)}</div>`
        : `<div data-fb-ans="${i}"><div style="border-bottom:1px solid #aaa;height:28px;"></div></div>`
      }
    </div>
  `).join('');
}

function _printRenderVocab(questions, { showAnswers, typeOpts }) {
  const fmt = typeOpts?.format || 'mixed';         // mixed | short | mcq
  const dir = typeOpts?.direction || 'mixed';      // mixed | en2ko | ko2en
  const cols = parseInt(typeOpts?.columns) === 2 ? 2 : 1;
  const narrow = cols === 2;

  // 2단일 때는 폰트/여백/MCQ 레이아웃 축소
  const fSize = narrow ? 11 : 13;
  const choiceFSize = narrow ? 10 : 12;
  const itemMb = narrow ? 8 : 14;
  const qMinWidth = narrow ? 70 : 140;
  const lineH = narrow ? 16 : 20;
  const leftPad = narrow ? 10 : 18;
  // 2단이면 각 행이 1열, 1단이면 4지선다가 2x2
  const choiceGridStyle = narrow
    ? 'display:flex;flex-direction:column;gap:2px;'
    : 'display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;';

  const items = questions.map((q, i) => {
    let thisDir = dir;
    if (dir === 'mixed') thisDir = i % 2 === 0 ? 'en2ko' : 'ko2en';
    let thisFmt = fmt;
    if (fmt === 'mixed') thisFmt = i % 2 === 0 ? 'short' : 'mcq';

    const question = thisDir === 'en2ko' ? q.word : q.meaning;
    const answer = thisDir === 'en2ko' ? q.meaning : q.word;

    const wrap = `margin-bottom:${itemMb}px;break-inside:avoid;page-break-inside:avoid;`;

    if (thisFmt === 'short') {
      return `
        <div style="${wrap}display:flex;align-items:center;gap:8px;">
          <div style="font-size:${fSize}px;font-weight:700;min-width:22px;">${i+1}.</div>
          <div style="font-size:${fSize}px;font-weight:600;min-width:${qMinWidth}px;">${esc(question)}</div>
          <div style="flex:1;border-bottom:1px solid #aaa;height:${lineH}px;">
            ${showAnswers ? `<span style="font-size:${fSize-1}px;color:#2e7d32;font-weight:700;">${esc(answer)}</span>` : ''}
          </div>
        </div>`;
    }
    // MCQ: 같은 방향 다른 단어 3개를 오답으로
    const candidates = questions.filter(x => x !== q);
    const wrongs = candidates.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    const opts = [answer, ...wrongs.map(w => thisDir === 'en2ko' ? w.meaning : w.word)]
      .slice().sort(() => Math.random() - 0.5);
    const correctIdx = opts.indexOf(answer);
    return `
      <div style="${wrap}">
        <div style="font-size:${fSize}px;font-weight:700;margin-bottom:3px;">${i+1}. ${esc(question)}</div>
        <div style="${choiceGridStyle}margin-left:${leftPad}px;">
          ${opts.map((opt, j) => `
            <div style="font-size:${choiceFSize}px;${showAnswers && j === correctIdx ? 'color:#2e7d32;font-weight:700;' : ''}">
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
    const shuffled = chunks.slice().sort(() => Math.random() - 0.5);
    return `
      <div style="margin-bottom:22px;page-break-inside:avoid;">
        <div style="font-size:13px;font-weight:700;margin-bottom:4px;">${i+1}. ${esc(q.meaningKo || '')}</div>
        <div style="font-size:11px;color:#555;margin-left:20px;margin-bottom:8px;">다음 단어/구를 배열하여 위 뜻의 영문을 쓰시오.</div>
        <div style="margin-left:20px;border-bottom:1px solid #888;min-height:26px;padding:4px;${showAnswers ? 'background:#f0fdf4;' : ''}">
          ${showAnswers ? `<span style="font-size:13px;color:#2e7d32;font-weight:700;">${esc(chunks.join(' '))}</span>` : ''}
        </div>
        <div style="margin-left:20px;margin-top:8px;padding:8px 10px;background:#f9fafb;border:1px dashed #bbb;border-radius:4px;">
          <div style="font-size:10px;color:#888;margin-bottom:4px;">단어/구 묶음</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${shuffled.map(c => `<span style="padding:4px 10px;background:white;border:1px solid #bbb;border-radius:4px;font-size:12px;font-family:'Times New Roman',serif;">${esc(c)}</span>`).join('')}
          </div>
        </div>
      </div>`;
  }).join('');
}

function _printRenderBlank(questions, { showAnswers }) {
  return questions.map((q, i) => {
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
      <div style="margin-bottom:16px;page-break-inside:avoid;">
        <div style="font-size:13px;font-weight:700;margin-bottom:4px;">${i+1}. ${esc(q.questionKo || '문장의 빈칸에 알맞은 단어를 쓰세요.')}</div>
        <div style="font-size:14px;line-height:2;padding:8px 12px;background:#f9fafb;border-left:3px solid #333;margin-left:18px;">${html}</div>
      </div>`;
  }).join('');
}

function _printRenderMcq(questions, { showAnswers }) {
  // 지문(sourcePageId) 별로 그룹화
  const grouped = {};
  questions.forEach(q => {
    const key = q.sourcePageId || 'default';
    if (!grouped[key]) grouped[key] = { title: q.sourcePageTitle || '', items: [] };
    grouped[key].items.push(q);
  });

  return Object.values(grouped).map((group, gi) => `
    <div style="margin-bottom:22px;page-break-inside:avoid;">
      ${group.title ? `<div style="font-size:12px;font-weight:700;color:#555;margin-bottom:6px;padding:4px 8px;background:#f3f4f6;border-radius:4px;">📄 ${esc(group.title)}</div>` : ''}
      ${group.items.map((q, i) => {
        const correctIdx = (q.choices || []).findIndex(c => c.isAnswer);
        return `
          <div style="margin-bottom:14px;">
            <div style="font-size:13px;font-weight:700;margin-bottom:4px;">${gi+1}-${i+1}. ${esc(q.question || '')}</div>
            ${q.questionKo ? `<div style="font-size:11px;color:#666;margin-left:16px;margin-bottom:4px;">(${esc(q.questionKo)})</div>` : ''}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-left:16px;">
              ${(q.choices || []).map((c, j) => `
                <div style="font-size:12px;${showAnswers && j === correctIdx ? 'color:#2e7d32;font-weight:700;' : ''}">
                  ${['①','②','③','④'][j]} ${esc(c.text || '')}${showAnswers && j === correctIdx ? ' ✓' : ''}
                </div>`).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>
  `).join('');
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
    const lineHeight = parseFloat(cs.lineHeight) || 22;
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
    typeOpts.format = document.getElementById('tpOptVocabFormat')?.value || 'mixed';
    typeOpts.direction = document.getElementById('tpOptVocabDirection')?.value || 'mixed';
    typeOpts.columns = parseInt(document.getElementById('tpOptVocabColumns')?.value) || 1;
  }

  area.innerHTML = _tpBuildPrintHtml(ctx.questions, {
    title: titleEl?.value || '시험',
    academy: academyEl?.value || '',
    date: dateStr,
    bookName: ctx.bookName,
    chapName: ctx.chapName,
    showAnswers: !!showAnsEl?.checked,
    sourceType: ctx.sourceType,
    typeOpts,
  });
  // 주관식 답란 줄 수 맞추기 (subj 전용)
  if (ctx.sourceType === 'subjective') {
    setTimeout(() => _tpAdjustAnswerLines(), 0);
  }
};

window.tpPrintTogglePreview = () => tpPrintRefreshPreview();

window.tpPrintNow = () => {
  const area = document.getElementById('tpPrintArea');
  if (!area) { showToast('프리뷰 영역을 찾을 수 없습니다'); return; }

  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) { showToast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요'); return; }

  win.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>시험지 출력</title>
  <style>
    body { font-family: 'Malgun Gothic','Apple SD Gothic Neo',sans-serif; margin:0; padding:20px; background:#eee; }
    @media print {
      body { background:white; padding:0; }
      @page { margin: 15mm; size: A4; }
      div[style*='box-shadow'] { box-shadow:none !important; max-width:none !important; }
    }
  </style>
</head>
<body>
  ${area.innerHTML}
  <script>
    window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };
  <\/script>
</body>
</html>`);
  win.document.close();
};

window.tpToggleTestProgress = async (testId) => {
  const prog = document.getElementById('tp-progress-' + testId);
  if (!prog) return;
  const isOpen = prog.getAttribute('data-open') === '1';

  document.querySelectorAll('[id^="tp-progress-"][data-open="1"]').forEach(r => {
    r.style.display = 'none';
    r.setAttribute('data-open', '0');
  });
  if (isOpen) return;

  prog.style.display = 'table-row';
  prog.setAttribute('data-open', '1');

  const content = document.getElementById('tp-progress-content-' + testId);
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
          const gs = await getDocs(query(collection(db,'users'), where('group','==',tg.id)));
          gs.docs.filter(d => d.data().role==='student').forEach(d =>
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
              const cfgC = _TEST_TYPE_CONFIG[_activeTestType];
              const recs = c.recordings || [];
              const isRecV2 = cfgC?.testMode === 'recording-ai' && recs.length >= 2 && recs[0]?.audioUrl;
              if (isRecV2) {
                const last = recs[recs.length - 1];
                const fb = last?.feedback;
                return `
                  <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;font-size:11px;grid-column:span 2;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                      <div style="font-weight:700;color:var(--text);">${esc(s.name||'?')}</div>
                      <div style="display:flex;gap:6px;align-items:center;">
                        <span style="font-size:10px;color:var(--gray);">평균 ${_tpAvgScore(recs)}점</span>
                        <span style="color:${last.score >= 70 ? '#059669' : '#CA8A04'};font-weight:700;">최종 ${last.score}점</span>
                      </div>
                    </div>
                    ${recs.map((r, i) => `
                      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                        <span style="width:20px;height:20px;border-radius:50%;background:${i === recs.length-1 ? '#8B5CF6' : '#E5E7EB'};color:${i === recs.length-1 ? 'white' : '#6B7280'};display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;">${i+1}</span>
                        <audio src="${esc(r.audioUrl)}" controls preload="none" style="flex:1;height:28px;"></audio>
                        <span style="font-size:11px;color:${r.score >= 70 ? '#059669' : '#CA8A04'};font-weight:700;min-width:40px;text-align:right;">${r.score}점</span>
                      </div>
                    `).join('')}
                    <div style="font-size:10px;color:var(--gray);margin-top:6px;padding-top:6px;border-top:1px solid #f3f4f6;">
                      ${esc(c.date || '')} · 3회 반복 녹음
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
              return `<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:6px;padding:5px 9px;font-size:11px;">
                <div style="font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name||'?')}</div>
                <div style="color:#2e7d32;">✓ ${c.score||0}점 · ${esc(c.date||'')}</div>
              </div>`;
            }
            return `<div style="background:#fff3e0;border:1px solid #ffcc80;border-radius:6px;padding:5px 9px;font-size:11px;">
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

async function _qgFetchDefaultPrompt(type) {
  if (_qgAiPromptDefaults[type]) return _qgAiPromptDefaults[type];
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

  const html = `
    <div style="width:min(820px,94vw);max-height:92vh;display:flex;flex-direction:column;">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);">
        <div style="font-size:16px;font-weight:700;">📋 AI 프롬프트 편집</div>
        <div style="font-size:11px;color:var(--gray);margin-top:4px;">
          유형별 시스템 프롬프트를 확인·수정합니다. 저장 시 이 브라우저에만 적용 (localStorage).
        </div>
      </div>

      <div id="qgPromptTabs" style="padding:10px 20px;border-bottom:1px solid var(--border);display:flex;gap:6px;flex-wrap:wrap;"></div>

      <div style="padding:12px 20px 6px;flex:1;overflow-y:auto;display:flex;flex-direction:column;min-height:0;">
        <div id="qgPromptStatus" style="font-size:11px;color:var(--gray);margin-bottom:8px;">로딩 중...</div>
        <textarea id="qgPromptText" rows="20"
          style="width:100%;flex:1;min-height:320px;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:ui-monospace,Consolas,monospace;line-height:1.5;resize:vertical;"></textarea>
        <div style="font-size:10px;color:var(--gray);margin-top:6px;">
          💡 팁: 규칙·출력 JSON 형식을 바꾸면 파싱 실패로 이어질 수 있습니다. 수정 후 "AI 문제 생성" 으로 실제 테스트하세요.
        </div>
      </div>

      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:space-between;align-items:center;">
        <button class="btn btn-secondary" onclick="qgResetPrompt()" style="font-size:12px;">↺ 기본값으로 복원</button>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="closeModal()" style="font-size:12px;">닫기</button>
          <button class="btn btn-primary" onclick="qgSavePrompt()" style="font-size:12px;font-weight:700;">💾 저장</button>
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
  if (val.length < 20) {
    showToast('프롬프트가 너무 짧습니다 (최소 20자)');
    return;
  }
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
  if (!_qgGetCustomPrompt(apiType)) {
    showToast('이미 기본값 사용 중');
    return;
  }
  if (!(await showConfirm('기본값으로 복원?', `${label}의 사용자 정의가 삭제됩니다.`))) return;
  _qgSetCustomPrompt(apiType, '');
  showToast('기본값으로 복원됨');
  _qgRenderPromptTabs();
  await _qgLoadPromptIntoTextarea(_qgPromptEditingType);
};
