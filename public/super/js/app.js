// 슈퍼 관리자 앱 — Phase 5 분리 (학원장 앱과 별도)
// 기능:
//   - 학원 목록 (academies) + 사용량 표시
//   - 외부 대시보드 링크 (Gemini, Firebase, Vercel)
//   - role==='super_admin' 검증 (아니면 /admin 으로 추방)

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut, updatePassword, EmailAuthProvider, reauthenticateWithCredential, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, updateDoc, query, orderBy, where, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

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

// ── 유틸 ─────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => t.style.opacity = '0', 2500);
}

window.doLogout = async () => {
  await signOut(auth);
  location.href = '/';
};

window.goTab = (id) => {
  document.querySelectorAll('.super-tabs button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + id)?.classList.add('active');
  // .page 는 admin/style.css 에서 display:none / .active=display:block 클래스 기반
  document.querySelectorAll('main .page').forEach(p => {
    p.classList.remove('active');
    p.style.display = '';  // 인라인 display 제거 — CSS 클래스로 위임
  });
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  if (id === 'academies') loadAcademies();
  else if (id === 'users') runUserSearch();
};

// ── 사용자 검색 ──────────────────────────────────────
let _allUsersCache = null;
let _userSortKey = 'name';
let _userSortDir = 1;  // 1 asc, -1 desc

window.sortUsers = (key) => {
  if (_userSortKey === key) _userSortDir *= -1;
  else { _userSortKey = key; _userSortDir = 1; }
  runUserSearch();
};

function _applyUserSort(arr) {
  const k = _userSortKey;
  const dir = _userSortDir;
  return [...arr].sort((a, b) => {
    let av, bv;
    if (k === 'createdAt') {
      av = a.createdAt?.toMillis?.() || 0;
      bv = b.createdAt?.toMillis?.() || 0;
    } else if (k === 'academyName') {
      av = a.academyName || '';
      bv = b.academyName || '';
    } else {
      av = String(a[k] || '');
      bv = String(b[k] || '');
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

function _renderSortMarks() {
  ['name','username','email','academyName','role','status','createdAt'].forEach(k => {
    const el = document.getElementById('sortMark-' + k);
    if (!el) return;
    if (k === _userSortKey) el.textContent = _userSortDir === 1 ? '▲' : '▼';
    else el.textContent = '';
  });
}
async function _loadAllUsers() {
  if (_allUsersCache) return _allUsersCache;
  const snap = await getDocs(collection(db, 'users'));
  _allUsersCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  return _allUsersCache;
}

window.runUserSearch = async () => {
  const tbody = document.getElementById('userSearchBody');
  const term = (document.getElementById('userSearchInput')?.value || '').trim().toLowerCase();
  const roleFilter = document.getElementById('userRoleFilter')?.value || '';
  try {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#bbb;padding:20px;">로딩 중...</td></tr>';
    const [all] = await Promise.all([
      _loadAllUsers(),
      _academiesCache.length === 0 ? loadAcademies() : Promise.resolve(),
    ]);
    const academyNameMap = {};
    _academiesCache.forEach(a => { academyNameMap[a.id] = a.name || a.id; });
    let filtered = all.map(u => ({ ...u, academyName: u.academyId ? (academyNameMap[u.academyId] || u.academyId) : '' }));
    if (roleFilter) filtered = filtered.filter(u => u.role === roleFilter);
    if (term) {
      filtered = filtered.filter(u => {
        const fields = [u.name, u.email, u.username, u.uid].map(s => String(s || '').toLowerCase());
        return fields.some(f => f.includes(term));
      });
    }
    filtered = _applyUserSort(filtered);
    _renderSortMarks();
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#bbb;padding:20px;">결과 없음</td></tr>';
      return;
    }
    const fmtDate = (t) => {
      if (!t) return '-';
      let d;
      if (typeof t.toDate === 'function') d = t.toDate();
      else if (t.seconds !== undefined) d = new Date(t.seconds * 1000);
      else if (t._seconds !== undefined) d = new Date(t._seconds * 1000);
      else if (typeof t === 'string') d = new Date(t);
      else return '-';
      return isNaN(d.getTime()) ? '-' : d.toISOString().slice(0, 10);
    };
    tbody.innerHTML = filtered.slice(0, 200).map(u => {
      const acaName = u.academyName || '-';
      const acaId = u.academyId || '';
      return `
      <tr style="cursor:pointer;" onclick="onUserRowClick('${u.uid}')">
        <td class="td-main">${esc(u.name || '-')}</td>
        <td class="td-mono">${esc(u.username || '-')}</td>
        <td class="td-sub">${esc(u.email || '-')}</td>
        <td>${esc(acaName)}${acaId && acaId !== acaName ? `<span style="color:#bbb;font-size:11px;margin-left:4px;">(${esc(acaId)})</span>` : ''}</td>
        <td><span class="badge ${u.role === 'super_admin' ? 'badge-red' : (u.role === 'admin' ? 'badge-teal' : '')}">${esc(u.role || '-')}</span></td>
        <td class="td-sub">${esc(u.status || '-')}</td>
        <td class="td-sub">${fmtDate(u.createdAt)}</td>
      </tr>`;
    }).join('') + (filtered.length > 200 ? `<tr><td colspan="7" style="text-align:center;color:#bbb;padding:8px;">... 외 ${filtered.length - 200}건 (검색어 더 좁히기)</td></tr>` : '');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#e05050;padding:20px;">검색 실패: ${esc(e.message)}</td></tr>`;
  }
};

window.onUserRowClick = async (uid) => {
  const all = await _loadAllUsers();
  const u = all.find(x => x.uid === uid);
  if (!u) { showToast('사용자 없음'); return; }
  if (u.role === 'admin' && u.academyId) {
    // 학원장 → 학원 모달
    if (!_academiesCache.length) await loadAcademies();
    openAcademyModal(u.academyId);
  } else {
    // 학생 / super_admin → 사용자 단독 편집 모달
    openUserEditModal(uid);
  }
};

window.openUserEditModal = (uid) => {
  const u = (_allUsersCache || []).find(x => x.uid === uid);
  if (!u) return;
  const overlay = document.getElementById('modalOverlay');
  const box = document.getElementById('modalBox');
  box.innerHTML = `
    <div style="width:min(520px,94vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">👤 ${esc(u.name || '-')} <span style="color:#999;font-weight:400;font-size:13px;">(${esc(u.role || '-')} / ${esc(u.academyId || '-')})</span></div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:14px;">
        <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">이름</div>
          <input id="ueName" type="text" value="${esc(u.name || '')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
        <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">username</div>
          <input id="ueUsername" type="text" value="${esc(u.username || '')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
        <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">이메일</div>
          <input id="ueEmail" type="email" value="${esc(u.email || '')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
        <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">새 비밀번호 (변경 시)</div>
          <input id="uePw" type="password" placeholder="6자 이상" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
        <input type="hidden" id="ueUid" value="${esc(u.uid)}">
        <input type="hidden" id="ueOrigName" value="${esc(u.name || '')}">
        <input type="hidden" id="ueOrigUsername" value="${esc(u.username || '')}">
        <input type="hidden" id="ueOrigEmail" value="${esc(u.email || '')}">
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="saveUserEdit()">저장</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
};

window.saveUserEdit = async () => {
  const uid = document.getElementById('ueUid')?.value;
  const fields = {};
  const newName = (document.getElementById('ueName')?.value || '').trim();
  const newUsername = (document.getElementById('ueUsername')?.value || '').trim().toLowerCase();
  const newEmail = (document.getElementById('ueEmail')?.value || '').trim().toLowerCase();
  const newPw = (document.getElementById('uePw')?.value || '').trim();
  const origName = document.getElementById('ueOrigName')?.value || '';
  const origUsername = document.getElementById('ueOrigUsername')?.value || '';
  const origEmail = document.getElementById('ueOrigEmail')?.value || '';
  if (newName && newName !== origName) fields.name = newName;
  if (newUsername && newUsername !== origUsername.toLowerCase()) fields.username = newUsername;
  if (newEmail && newEmail !== origEmail.toLowerCase()) fields.email = newEmail;
  if (newPw) fields.password = newPw;
  if (Object.keys(fields).length === 0) { showToast('변경된 항목 없음'); return; }
  try {
    const idToken = await _currentUser.getIdToken();
    const r = await fetch('/api/superAdmin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, action: 'updateAcademyAdmin', uid, fields }),
    });
    const j = await r.json();
    if (!j.success) { showToast('저장 실패: ' + j.error); return; }
    closeModal();
    _allUsersCache = null; // 캐시 무효화
    showToast('✅ 저장됨');
    runUserSearch();
  } catch (e) {
    showToast('오류: ' + e.message);
  }
};

let _currentUser = null;
let _currentProfile = null;
let _academiesCache = [];
let _plansCache = {};

// ── 인증 ─────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = '/'; return; }
  // role 검증
  let role = null;
  try {
    const tk = await user.getIdTokenResult();
    role = tk.claims.role || null;
  } catch (_) {}
  if (role !== 'super_admin') {
    showToast('슈퍼 관리자 권한 필요 — 학원장 앱으로 이동');
    setTimeout(() => location.href = '/admin/', 1500);
    return;
  }
  _currentUser = user;
  // 프로필 로드
  try {
    const ps = await getDoc(doc(db, 'users', user.uid));
    _currentProfile = ps.exists() ? ps.data() : null;
  } catch (_) {}
  document.getElementById('superName').textContent = _currentProfile?.name || user.email || user.uid.slice(0,8);
  await loadAcademies();
});

// ── 내 정보 모달 ─────────────────────────────────────
window.openProfileModal = () => {
  if (!_currentUser) return;
  const p = _currentProfile || {};
  const overlay = document.getElementById('modalOverlay');
  const box = document.getElementById('modalBox');
  box.innerHTML = `
    <div style="width:min(480px,92vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;">⚙ 내 정보 수정</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:14px;">
        <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">이름</div>
          <input id="profName" type="text" value="${esc(p.name || '')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
        <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">이메일 (읽기 전용)</div>
          <input type="text" value="${esc(_currentUser.email || '')}" disabled style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:#f5f5f5;color:#888;"></div>
        <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">현재 비밀번호 (변경 시만)</div>
          <input id="profPwOld" type="password" placeholder="비번 변경 시 입력" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
        <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">새 비밀번호 (변경 시만)</div>
          <input id="profPwNew" type="password" placeholder="6자 이상" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="saveProfile()">저장</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
};

window.closeModal = () => {
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.style.display = 'none';
};

// ── 학원 관리 합계 카드 ───────────────────────────────
function _renderAcademiesSummary(academies, planMap) {
  const el = document.getElementById('academiesSummary');
  if (!el) return;
  let totalStudents = 0, totalAi = 0, totalRec = 0, totalLimit = 0, totalAiLimit = 0;
  let active = 0;
  academies.forEach(a => {
    const u = a.usage || {};
    const p = planMap[a.planId] || {};
    const cl = a.customLimits || {};
    totalStudents += (u.activeStudentsCount || 0);
    totalAi += (u.aiCallsThisMonth || 0);
    totalRec += (u.recordingCallsThisMonth || 0);
    totalLimit += (a.studentLimit || 0);
    totalAiLimit += (cl.aiQuotaPerMonth || p.limits?.aiQuotaPerMonth || 0);
    if (a.billingStatus === 'active') active++;
  });
  const aiPct = totalAiLimit ? Math.min(100, Math.round((totalAi / totalAiLimit) * 100)) : 0;
  const studentPct = totalLimit ? Math.min(100, Math.round((totalStudents / totalLimit) * 100)) : 0;
  const card = (label, big, sub, color) => `
    <div class="card" style="padding:12px 14px;text-align:center;">
      <div style="font-size:11px;color:var(--gray);margin-bottom:4px;">${label}</div>
      <div style="font-size:22px;font-weight:800;color:${color || 'var(--text)'};line-height:1.1;">${big}</div>
      ${sub ? `<div style="font-size:10px;color:#999;margin-top:4px;">${sub}</div>` : ''}
    </div>`;
  el.innerHTML = [
    card('🏢 학원 수', `${academies.length}`, `${active} active`, 'var(--teal)'),
    card('👥 총 학생', `${totalStudents}`, `한도 ${totalLimit} (${studentPct}%)`),
    card('✨ AI 월 호출', `${totalAi}`, `한도 ${totalAiLimit || '-'} (${aiPct}%)`, aiPct >= 70 ? '#f59e0b' : 'var(--text)'),
    card('🎤 녹음 월 평가', `${totalRec}`, '학원별 한도 합', ''),
    card('💳 active', `${active}/${academies.length}`, '결제 활성', active === academies.length ? '#059669' : '#dc2626'),
  ].join('');
}

// ── 학원 삭제 모달 (위험) ─────────────────────────────
window.openAcademyDeleteModal = async (academyId) => {
  const a = _academiesCache.find(x => x.id === academyId);
  if (!a) { showToast('학원 정보 없음'); return; }
  const overlay = document.getElementById('modalOverlay');
  const box = document.getElementById('modalBox');
  // 1차: 영향 범위 로딩 화면
  box.innerHTML = `
    <div style="width:min(560px,94vw);padding:22px;text-align:center;">
      <div style="font-size:14px;color:var(--gray);">영향 범위 조회 중...</div>
    </div>`;
  overlay.style.display = 'flex';

  // API 호출
  let counts = null;
  try {
    const idToken = await _currentUser.getIdToken();
    const r = await fetch('/api/superAdmin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, action: 'getAcademyImpact', academyId }),
    });
    const j = await r.json();
    if (!j.success) { showToast('조회 실패: ' + j.error); closeModal(); return; }
    counts = j.counts;
  } catch (e) {
    showToast('조회 오류: ' + e.message); closeModal(); return;
  }

  const totalRows = (counts.users.total || 0)
    + (counts.notices||0) + (counts.scores||0) + (counts.payments||0)
    + (counts.hwFiles||0) + (counts.groups||0) + (counts.genTests||0)
    + (counts.genQuestionSets||0) + (counts.genBooks||0) + (counts.genChapters||0)
    + (counts.genPages||0) + (counts.pushNotifications||0) + (counts.userNotifications||0)
    + (counts.genCleanupPresets||0) + (counts.apiUsage||0);

  const row = (label, n) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><span>${label}</span><span style="font-weight:600;">${n}</span></div>`;

  box.innerHTML = `
    <div style="width:min(640px,94vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);background:#fef2f2;">
        <div style="font-size:17px;font-weight:700;color:#dc2626;">🗑 학원 영구 삭제 — ${esc(a.name)}</div>
        <div style="font-size:12px;color:var(--gray);margin-top:5px;">subdomain: <code>${esc(a.subdomain || a.id)}</code></div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:14px;">

        <div>
          <div style="font-weight:700;font-size:13px;margin-bottom:6px;">영향 범위 (이번 달 기준)</div>
          <div style="background:#fafafa;border:1px solid var(--border);border-radius:8px;padding:10px 14px;">
            ${row('👥 학원장', counts.users.admin)}
            ${row('👥 학생', counts.users.student)}
            ${row('📢 공지', counts.notices||0)}
            ${row('📊 점수 (scores)', counts.scores||0)}
            ${row('📝 시험 (genTests)', counts.genTests||0)}
            ${row('📋 문제 세트 (genQuestionSets)', counts.genQuestionSets||0)}
            ${row('📚 교재 (genBooks)', counts.genBooks||0)}
            ${row('📖 챕터 (genChapters)', counts.genChapters||0)}
            ${row('📄 페이지 (genPages)', counts.genPages||0)}
            ${row('🏷 반 (groups)', counts.groups||0)}
            ${row('💳 결제', counts.payments||0)}
            ${row('📁 숙제파일', counts.hwFiles||0)}
            ${row('🔔 푸시 + 알림', (counts.pushNotifications||0) + (counts.userNotifications||0))}
            ${row('🧹 AI 정리 프리셋', counts.genCleanupPresets||0)}
            ${row('📈 일별 API 사용량', counts.apiUsage||0)}
            <div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;display:flex;justify-content:space-between;font-size:13px;font-weight:700;">
              <span>총 데이터 row</span><span>${totalRows}</span>
            </div>
          </div>
          <div style="font-size:11px;color:#888;margin-top:6px;">
            ※ Storage (숙제파일/녹음파일) 의 실제 파일은 Firestore 외부라 별도 정리됩니다.
          </div>
        </div>

        <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:12px;color:#92400e;line-height:1.6;">
          <b>⚠️ 영구 삭제 — 복구 불가</b><br>
          삭제 전에 <b>백업 JSON 다운로드</b> 필수. 복원: <code>npm run restore-academy --file backup.json --apply</code>
        </div>

        <div id="acDelConfirmArea" style="display:none;padding:12px 14px;border:2px solid #dc2626;border-radius:8px;background:#fef2f2;">
          <div style="font-size:13px;font-weight:700;color:#dc2626;margin-bottom:8px;">최종 확인</div>
          <div style="font-size:12px;color:var(--text);margin-bottom:8px;line-height:1.5;">
            아래 칸에 학원 코드(subdomain) <code style="background:white;padding:2px 6px;border-radius:4px;font-weight:700;">${esc(a.subdomain || a.id)}</code> 를 정확히 입력하세요.
          </div>
          <input id="acDelConfirmInput" type="text" placeholder="${esc(a.subdomain || a.id)}" oninput="onAcDelConfirmInput('${esc(a.subdomain || a.id)}')"
            style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:monospace;outline:none;">
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;align-items:center;">
        <span id="acDelStatus" style="font-size:11px;color:var(--gray);"></span>
        <button class="btn btn-secondary" onclick="closeModal()">닫기</button>
        <button class="btn btn-secondary" id="acDelBackupBtn" onclick="exportAcademyBackup('${esc(a.id)}')">📥 백업 다운로드</button>
        <button class="btn btn-primary" id="acDelDeleteBtn" disabled style="opacity:.5;background:#dc2626;border-color:#dc2626;" onclick="executeAcademyDelete('${esc(a.id)}','${esc(a.subdomain || a.id)}')">🗑 영구 삭제</button>
      </div>
    </div>`;
};

// 백업 다운로드 후 확정 영역 노출하도록 — exportAcademyBackup 의 마지막에 호출
function _showAcDelConfirmArea() {
  const area = document.getElementById('acDelConfirmArea');
  if (area) area.style.display = '';
}

window.onAcDelConfirmInput = (expectedSubdomain) => {
  const inp = document.getElementById('acDelConfirmInput');
  const btn = document.getElementById('acDelDeleteBtn');
  if (!inp || !btn) return;
  const ok = inp.value.trim() === expectedSubdomain;
  btn.disabled = !ok;
  btn.style.opacity = ok ? '1' : '.5';
};

window.executeAcademyDelete = async (academyId, subdomain) => {
  const inp = document.getElementById('acDelConfirmInput');
  const confirmSubdomain = (inp?.value || '').trim();
  if (confirmSubdomain !== subdomain) { showToast('subdomain 불일치'); return; }

  const yes = window.confirm(`정말로 학원 "${academyId}" 를 영구 삭제할까요?\n\n복구 불가합니다 (백업 JSON 으로만).`);
  if (!yes) return;

  const status = document.getElementById('acDelStatus');
  const btn = document.getElementById('acDelDeleteBtn');
  const backupBtn = document.getElementById('acDelBackupBtn');
  if (btn) btn.disabled = true;
  if (backupBtn) backupBtn.disabled = true;
  if (inp) inp.disabled = true;
  if (status) status.innerHTML = '<span style="color:#dc2626;">삭제 진행 중... (시간 좀 걸릴 수 있음)</span>';

  try {
    const idToken = await _currentUser.getIdToken();
    const r = await fetch('/api/superAdmin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, action: 'deleteAcademy', academyId, confirmSubdomain }),
    });
    const j = await r.json();
    if (!j.success) {
      if (status) status.innerHTML = `<span style="color:#dc2626;">삭제 실패: ${esc(j.error || '')}</span>`;
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
      if (inp) inp.disabled = false;
      return;
    }
    closeModal();
    const totalDeleted = Object.values(j.deleted).filter(v => typeof v === 'number').reduce((s,v) => s + v, 0);
    showToast(`✅ 학원 영구 삭제 완료 (${totalDeleted} docs)`);
    // 캐시 무효화 + 새로고침
    _academiesCache = [];
    _allUsersCache = null;
    await loadAcademies();
  } catch (e) {
    if (status) status.innerHTML = `<span style="color:#dc2626;">오류: ${esc(e.message)}</span>`;
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    if (inp) inp.disabled = false;
  }
};

// ── 백업 JSON 다운로드 (2단계) ────────────────────────
window.exportAcademyBackup = async (academyId) => {
  const btn = document.getElementById('acDelBackupBtn');
  const status = document.getElementById('acDelStatus');
  if (btn) btn.disabled = true;
  if (status) status.textContent = '백업 생성 중...';
  try {
    const academySnap = await getDoc(doc(db, 'academies', academyId));
    if (!academySnap.exists()) { showToast('학원 없음'); return; }
    const academyData = academySnap.data();

    const cols = [
      'users', 'notices', 'scores', 'payments', 'hwFiles', 'groups',
      'genTests', 'genQuestionSets', 'genBooks', 'genChapters', 'genPages',
      'pushNotifications', 'userNotifications', 'genCleanupPresets', 'apiUsage',
    ];

    const data = {
      _exportedAt: new Date().toISOString(),
      _exportedBy: _currentUser?.email || _currentUser?.uid || 'unknown',
      _schemaVersion: 1,
      _note: '큰소리 영어 학원 백업 — Storage 파일은 별도',
      academy: { id: academyId, ...academyData },
      collections: {},
    };

    for (const col of cols) {
      if (status) status.textContent = `백업 중: ${col}...`;
      const snap = await getDocs(query(collection(db, col), where('academyId', '==', academyId)));
      data.collections[col] = snap.docs.map(d => {
        const obj = { id: d.id, ...d.data() };
        // Timestamp → ISO string
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (v && typeof v.toDate === 'function') obj[k] = v.toDate().toISOString();
        }
        return obj;
      });
    }

    // genTests 의 userCompleted 서브컬렉션 백업 (학생 응시 기록)
    if (status) status.textContent = '백업 중: userCompleted (서브컬렉션)...';
    const ucMap = {};
    for (const t of data.collections.genTests) {
      const ucSnap = await getDocs(collection(db, 'genTests', t.id, 'userCompleted'));
      if (!ucSnap.empty) {
        ucMap[t.id] = ucSnap.docs.map(d => {
          const obj = { id: d.id, ...d.data() };
          for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (v && typeof v.toDate === 'function') obj[k] = v.toDate().toISOString();
          }
          return obj;
        });
      }
    }
    data.collections.genTests_userCompleted = ucMap;

    // 다운로드
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `academy-backup-${academyId}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const totalDocs = Object.values(data.collections).reduce((s, v) =>
      s + (Array.isArray(v) ? v.length : Object.values(v).reduce((s2, arr) => s2 + arr.length, 0)), 0);
    if (status) status.innerHTML = `<span style="color:#059669;">✓ 백업 완료 (${totalDocs} docs · ${(json.length/1024).toFixed(1)} KB)</span>`;
    showToast(`✅ 백업 다운로드 완료 (${totalDocs} docs)`);
    if (btn) btn.disabled = false;
    // 백업 후 확정 영역 노출 (subdomain 입력 → 영구 삭제 가능)
    _showAcDelConfirmArea();
  } catch (e) {
    if (status) status.innerHTML = `<span style="color:#dc2626;">백업 실패</span>`;
    showToast('백업 실패: ' + e.message);
    if (btn) btn.disabled = false;
  }
};

// ── 신규 학원 추가 모달 ──────────────────────────────
window.openAcademyCreateModal = () => {
  const planOpts = Object.keys(_plansCache).length
    ? Object.keys(_plansCache).map(pid => `<option value="${esc(pid)}">${esc(_plansCache[pid].displayName || pid)}</option>`).join('')
    : '<option value="lite">Lite</option><option value="standard">Standard</option><option value="pro">Pro</option>';
  const overlay = document.getElementById('modalOverlay');
  const box = document.getElementById('modalBox');
  box.innerHTML = `
    <div style="width:min(560px,94vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">+ 신규 학원 등록</div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:14px;">
        <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">학원명 *</div>
          <input id="newAcName" type="text" placeholder="예: ABC공부방" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
        <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">학원코드 (subdomain) *</div>
          <input id="newAcSubdomain" type="text" placeholder="영소문자/숫자/_/- (예: abc)" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;font-family:monospace;"></div>
        <div style="display:flex;gap:12px;">
          <div style="flex:1;"><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">플랜</div>
            <select id="newAcPlan" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${planOpts}</select></div>
          <div style="flex:1;"><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">학생 한도</div>
            <select id="newAcLimit" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">
              <option value="30">30명</option><option value="60">60명</option><option value="100">100명</option>
            </select></div>
        </div>
        <div style="font-weight:700;font-size:13px;color:var(--text);border-bottom:1px solid #eee;padding-bottom:6px;margin-top:8px;">학원장 정보</div>
        <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">이메일 *</div>
          <input id="newAdEmail" type="email" placeholder="owner@example.com" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
        <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">임시 비밀번호 *</div>
          <input id="newAdPw" type="text" placeholder="8자 이상 (학원장에게 전달)" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
        <div style="font-size:11px;color:var(--gray);">※ 학원장 username 은 학원코드(subdomain)와 동일하게 자동 생성됩니다.</div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="submitNewAcademy()">등록</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
};

window.submitNewAcademy = async () => {
  const name = (document.getElementById('newAcName')?.value || '').trim();
  const subdomain = (document.getElementById('newAcSubdomain')?.value || '').trim().toLowerCase();
  const planId = document.getElementById('newAcPlan')?.value || 'lite';
  const studentLimit = parseInt(document.getElementById('newAcLimit')?.value) || 30;
  const adminEmail = (document.getElementById('newAdEmail')?.value || '').trim().toLowerCase();
  const adminPassword = (document.getElementById('newAdPw')?.value || '').trim();

  if (!name) { showToast('학원명을 입력하세요'); return; }
  if (!subdomain || !/^[a-z0-9_-]+$/.test(subdomain)) { showToast('학원코드: 영소문자/숫자/_/- 만'); return; }
  if (subdomain === 'default') { showToast("'default' 는 예약된 코드"); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) { showToast('유효한 이메일'); return; }
  if (adminPassword.length < 8) { showToast('비밀번호 8자 이상'); return; }

  try {
    const idToken = await _currentUser.getIdToken();
    const r = await fetch('/api/createAcademy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, name, subdomain, adminEmail, adminPassword, planId, studentLimit }),
    });
    const j = await r.json();
    if (!j.success) { showToast('등록 실패: ' + (j.error || j.detail || '')); return; }
    closeModal();
    showToast(`✅ ${name} 등록 완료 (username: ${j.adminUsername})`);
    await loadAcademies();
  } catch (e) {
    showToast('등록 오류: ' + e.message);
  }
};

// ── 학원 상세 / 편집 모달 ────────────────────────────
window.openAcademyModal = async (academyId) => {
  const a = _academiesCache.find(x => x.id === academyId);
  if (!a) { showToast('학원 정보 없음'); return; }

  // 학원장 (academy_admin) 조회 — 첫 번째 admin 1명
  let admins = [];
  try {
    const qs = await getDocs(query(collection(db, 'users'),
      where('academyId', '==', academyId),
      where('role', '==', 'admin')
    ));
    admins = qs.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch (e) { console.warn(e); }
  const adminUser = admins[0] || null;

  const planOpts = Object.keys(_plansCache).map(pid =>
    `<option value="${esc(pid)}" ${a.planId === pid ? 'selected' : ''}>${esc(_plansCache[pid].displayName || pid)}</option>`
  ).join('');

  const overlay = document.getElementById('modalOverlay');
  const box = document.getElementById('modalBox');
  box.innerHTML = `
    <div style="width:min(640px,94vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);">
        <div style="font-size:17px;font-weight:700;line-height:1.3;">🏢 ${esc(a.name)} <span style="color:#999;font-weight:400;font-size:13px;">(${esc(a.subdomain || a.id)})</span></div>
      </div>
      <div style="padding:16px 22px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:14px;">
        <div style="font-weight:700;font-size:13px;color:var(--text);border-bottom:1px solid #eee;padding-bottom:6px;">학원 정보</div>

        <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">학원명</div>
          <input id="acName" type="text" value="${esc(a.name || '')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>

        <div style="display:flex;gap:12px;">
          <div style="flex:1;"><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">플랜</div>
            <select id="acPlan" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">${planOpts}</select></div>
          <div style="flex:1;"><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">학생 한도</div>
            <input id="acLimit" type="number" min="0" value="${a.studentLimit || 30}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div style="flex:1;"><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">상태</div>
            <select id="acStatus" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;">
              <option value="active" ${a.billingStatus === 'active' ? 'selected' : ''}>active</option>
              <option value="suspended" ${a.billingStatus === 'suspended' ? 'selected' : ''}>suspended</option>
              <option value="cancelled" ${a.billingStatus === 'cancelled' ? 'selected' : ''}>cancelled</option>
            </select></div>
        </div>

        <details style="margin-top:4px;">
          <summary style="cursor:pointer;font-size:12px;color:var(--gray);user-select:none;">⚙️ 한도 override (비워두면 플랜 기본값 사용)</summary>
          <div style="display:flex;gap:12px;margin-top:8px;padding:10px 12px;background:#fafafa;border:1px solid var(--border);border-radius:8px;">
            <div style="flex:1;"><div style="font-size:12px;color:var(--gray);margin-bottom:4px;">AI 월 호출 (override)</div>
              <input id="acLimitAi" type="number" min="0" placeholder="${(_plansCache[a.planId]?.limits?.aiQuotaPerMonth) || '∞'}" value="${a.customLimits?.aiQuotaPerMonth || ''}" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px;outline:none;"></div>
            <div style="flex:1;"><div style="font-size:12px;color:var(--gray);margin-bottom:4px;">녹음 월 평가 (override)</div>
              <input id="acLimitRec" type="number" min="0" placeholder="${(_plansCache[a.planId]?.limits?.perTypeQuota?.recording?.check) || '∞'}" value="${a.customLimits?.recordingPerMonth || ''}" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px;outline:none;"></div>
          </div>
          <div style="font-size:10px;color:#999;margin-top:4px;">※ 입력 시 plan 한도 무시. 비워두면 plan 기본값 사용.</div>
        </details>

        <div style="font-weight:700;font-size:13px;color:var(--text);border-bottom:1px solid #eee;padding-bottom:6px;margin-top:8px;">학원장 정보 ${adminUser ? '' : '(없음)'}</div>

        ${adminUser ? `
          <div style="display:flex;gap:12px;">
            <div style="flex:1;"><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">이름</div>
              <input id="adName" type="text" value="${esc(adminUser.name || '')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
            <div style="flex:1;"><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">username</div>
              <input id="adUsername" type="text" value="${esc(adminUser.username || '')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          </div>
          <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">이메일</div>
            <input id="adEmail" type="email" value="${esc(adminUser.email || '')}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <div><div style="font-size:13px;color:var(--gray);margin-bottom:6px;">새 비밀번호 (변경 시만)</div>
            <input id="adPw" type="password" placeholder="6자 이상" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;"></div>
          <input type="hidden" id="adUid" value="${esc(adminUser.uid)}">
          <input type="hidden" id="adOrigUsername" value="${esc(adminUser.username || '')}">
          <input type="hidden" id="adOrigEmail" value="${esc(adminUser.email || '')}">
          <input type="hidden" id="adOrigName" value="${esc(adminUser.name || '')}">
        ` : `<div style="color:#888;font-size:13px;">학원장 계정이 없습니다. CLI 로 생성 필요.</div>`}

        <div style="margin-top:12px;padding:14px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2;">
          <div style="font-weight:700;font-size:13px;color:#dc2626;margin-bottom:6px;">⚠️ 위험 영역</div>
          <div style="font-size:12px;color:var(--gray);margin-bottom:10px;line-height:1.5;">
            학원을 영구 삭제합니다. 소속 학생/시험/점수/공지 등 모든 데이터가 사라집니다.<br>
            백업 JSON 다운로드 → 영구 삭제 단계로 진행됩니다.
          </div>
          <button class="btn btn-secondary" style="background:#fee2e2;color:#b91c1c;border-color:#fecaca;" onclick="openAcademyDeleteModal('${a.id}')">🗑 학원 영구 삭제</button>
        </div>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="saveAcademy('${a.id}')">저장</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
};

window.saveAcademy = async (academyId) => {
  const a = _academiesCache.find(x => x.id === academyId);
  if (!a) return;
  const idToken = await _currentUser.getIdToken();

  // 학원 정보 변경분
  const acFields = {};
  const newName = (document.getElementById('acName')?.value || '').trim();
  const newPlan = document.getElementById('acPlan')?.value;
  const newLimit = parseInt(document.getElementById('acLimit')?.value);
  const newStatus = document.getElementById('acStatus')?.value;
  if (newName && newName !== a.name) acFields.name = newName;
  if (newPlan && newPlan !== a.planId) acFields.planId = newPlan;
  if (!isNaN(newLimit) && newLimit !== a.studentLimit) acFields.studentLimit = newLimit;
  if (newStatus && newStatus !== a.billingStatus) acFields.billingStatus = newStatus;

  // customLimits override
  const aiOver = document.getElementById('acLimitAi')?.value.trim();
  const recOver = document.getElementById('acLimitRec')?.value.trim();
  const newCustom = {};
  if (aiOver) newCustom.aiQuotaPerMonth = parseInt(aiOver);
  if (recOver) newCustom.recordingPerMonth = parseInt(recOver);
  const oldCustom = a.customLimits || {};
  const customChanged =
    (newCustom.aiQuotaPerMonth || 0) !== (oldCustom.aiQuotaPerMonth || 0) ||
    (newCustom.recordingPerMonth || 0) !== (oldCustom.recordingPerMonth || 0);
  if (customChanged) acFields.customLimits = newCustom;

  // 학원장 정보 변경분
  const adminFields = {};
  let adminUid = null;
  const uidEl = document.getElementById('adUid');
  if (uidEl) {
    adminUid = uidEl.value;
    const origName = document.getElementById('adOrigName')?.value || '';
    const origUsername = document.getElementById('adOrigUsername')?.value || '';
    const origEmail = document.getElementById('adOrigEmail')?.value || '';
    const adName = (document.getElementById('adName')?.value || '').trim();
    const adUsername = (document.getElementById('adUsername')?.value || '').trim().toLowerCase();
    const adEmail = (document.getElementById('adEmail')?.value || '').trim().toLowerCase();
    const adPw = (document.getElementById('adPw')?.value || '').trim();
    if (adName && adName !== origName) adminFields.name = adName;
    if (adUsername && adUsername !== origUsername.toLowerCase()) adminFields.username = adUsername;
    if (adEmail && adEmail !== origEmail.toLowerCase()) adminFields.email = adEmail;
    if (adPw) adminFields.password = adPw;
  }

  const acChanged = Object.keys(acFields).length > 0;
  const adminChanged = Object.keys(adminFields).length > 0;
  if (!acChanged && !adminChanged) { showToast('변경된 항목 없음'); return; }

  try {
    if (acChanged) {
      const r = await fetch('/api/superAdmin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, action: 'updateAcademy', academyId, fields: acFields }),
      });
      const j = await r.json();
      if (!j.success) { showToast('학원 변경 실패: ' + j.error); return; }
    }
    if (adminChanged && adminUid) {
      const r = await fetch('/api/superAdmin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, action: 'updateAcademyAdmin', uid: adminUid, fields: adminFields }),
      });
      const j = await r.json();
      if (!j.success) { showToast('학원장 변경 실패: ' + j.error); return; }
    }
    closeModal();
    showToast('✅ 저장됨');
    await loadAcademies();
  } catch (e) {
    showToast('저장 오류: ' + e.message);
  }
};

window.saveProfile = async () => {
  const newName = (document.getElementById('profName')?.value || '').trim();
  const pwOld = (document.getElementById('profPwOld')?.value || '').trim();
  const pwNew = (document.getElementById('profPwNew')?.value || '').trim();
  if (!newName) { showToast('이름을 입력하세요.'); return; }
  if (pwNew && pwNew.length < 6) { showToast('새 비밀번호는 6자 이상.'); return; }
  if (pwNew && !pwOld) { showToast('비번 변경 시 현재 비번 입력.'); return; }

  try {
    // 1) 이름 변경 (변경된 경우만)
    if (newName !== (_currentProfile?.name || '')) {
      await updateDoc(doc(db, 'users', _currentUser.uid), { name: newName, updatedAt: serverTimestamp() });
      try { await updateProfile(_currentUser, { displayName: newName }); } catch (_) {}
      _currentProfile = { ..._currentProfile, name: newName };
      document.getElementById('superName').textContent = newName;
    }
    // 2) 비번 변경
    if (pwNew) {
      const cred = EmailAuthProvider.credential(_currentUser.email, pwOld);
      await reauthenticateWithCredential(_currentUser, cred);
      await updatePassword(_currentUser, pwNew);
    }
    closeModal();
    showToast('✅ 저장됨');
  } catch (e) {
    if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
      showToast('현재 비밀번호가 일치하지 않습니다.');
    } else {
      showToast('저장 실패: ' + (e.message || e.code));
    }
  }
};

// ── 학원 목록 ────────────────────────────────────────
async function loadAcademies() {
  const el = document.getElementById('academiesTableBody');
  try {
    el.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#bbb;padding:20px;">로딩 중...</td></tr>';
    const [acadSnap, planSnap] = await Promise.all([
      getDocs(query(collection(db, 'academies'), orderBy('createdAt', 'asc'))),
      getDocs(collection(db, 'plans')),
    ]);
    const planMap = {};
    planSnap.docs.forEach(d => { planMap[d.id] = d.data(); });

    const academies = acadSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!academies.length) {
      el.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#bbb;padding:20px;">학원이 없습니다.</td></tr>';
      return;
    }

    const fmtDate = (t) => {
      if (!t) return '-';
      let d;
      if (typeof t.toDate === 'function') d = t.toDate();
      else if (t.seconds !== undefined) d = new Date(t.seconds * 1000);
      else if (t._seconds !== undefined) d = new Date(t._seconds * 1000);
      else if (typeof t === 'string') d = new Date(t);
      else return '-';
      return isNaN(d.getTime()) ? '-' : d.toISOString().slice(0, 10);
    };
    const fmtUsage = (a) => {
      const u = a.usage || {};
      const p = planMap[a.planId] || {};
      const cl = a.customLimits || {};
      const aiLimit = cl.aiQuotaPerMonth || p.limits?.aiQuotaPerMonth || '∞';
      const recLimit = cl.recordingPerMonth || p.limits?.perTypeQuota?.recording?.check || '∞';
      const aiOver = !!cl.aiQuotaPerMonth;
      const recOver = !!cl.recordingPerMonth;
      const mark = (overridden) => overridden ? '<span title="override" style="color:#f59e0b;">*</span>' : '';
      return `<div style="font-size:11px;line-height:1.5;">
        학생 <b>${u.activeStudentsCount || 0}</b>/${a.studentLimit || '∞'}<br>
        AI <b>${u.aiCallsThisMonth || 0}</b>/${aiLimit}${mark(aiOver)}<br>
        녹음 <b>${u.recordingCallsThisMonth || 0}</b>/${recLimit}${mark(recOver)}
      </div>`;
    };

    _academiesCache = academies;
    _plansCache = planMap;
    _renderAcademiesSummary(academies, planMap);
    el.innerHTML = academies.map(a => `
      <tr style="cursor:pointer;" onclick="openAcademyModal('${a.id}')">
        <td class="td-main">${esc(a.name || '-')}</td>
        <td class="td-mono">${esc(a.subdomain || a.id)}</td>
        <td><span class="badge badge-teal">${esc(a.planId || '-')}</span></td>
        <td class="td-center">${a.studentLimit || '-'}</td>
        <td>${fmtUsage(a)}</td>
        <td class="td-sub">${fmtDate(a.createdAt)}</td>
        <td><span class="badge ${a.billingStatus === 'active' ? 'badge-green' : 'badge-red'}">${esc(a.billingStatus || '-')}</span></td>
      </tr>
    `).join('');
  } catch (e) {
    console.error(e);
    el.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#e05050;padding:20px;">불러오기 실패: ${esc(e.message)}</td></tr>`;
  }
}
