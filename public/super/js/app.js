// 슈퍼 관리자 앱 — Phase 5 분리 (학원장 앱과 별도)
// 기능:
//   - 학원 목록 (academies) + 사용량 표시
//   - 외부 대시보드 링크 (Gemini, Firebase, Vercel)
//   - role==='super_admin' 검증 (아니면 /admin 으로 추방)

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut, updatePassword, EmailAuthProvider, reauthenticateWithCredential, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, updateDoc, query, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

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
  document.querySelectorAll('main .page').forEach(p => p.style.display = 'none');
  const page = document.getElementById('page-' + id);
  if (page) page.style.display = '';
  if (id === 'academies') loadAcademies();
};

let _currentUser = null;
let _currentProfile = null;

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
      const d = t?.toDate ? t.toDate() : null;
      return d ? d.toISOString().slice(0, 10) : '-';
    };
    const fmtUsage = (a) => {
      const u = a.usage || {};
      const p = planMap[a.planId] || {};
      const aiLimit = p.limits?.aiQuotaPerMonth ?? '∞';
      const recLimit = p.limits?.perTypeQuota?.recording?.check ?? '∞';
      return `<div style="font-size:11px;line-height:1.5;">
        학생 <b>${u.activeStudentsCount || 0}</b>/${a.studentLimit || '∞'}<br>
        AI <b>${u.aiCallsThisMonth || 0}</b>/${aiLimit}<br>
        녹음 <b>${u.recordingCallsThisMonth || 0}</b>/${recLimit}
      </div>`;
    };

    el.innerHTML = academies.map(a => `
      <tr>
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
