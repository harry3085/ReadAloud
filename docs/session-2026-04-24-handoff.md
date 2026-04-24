# 2026-04-24 세션 인수인계 (멀티테넌시 Phase 0)

> 다음 세션에서 읽고 시작. 오늘 진행 내용 + 내일 시작 지점 + 주의사항.

---

## 최종 배포 상태 (2026-04-25 01:35)

**프로덕션 상태**: **롤백 후 안정 (B1+B2 커밋까지만 활성)**

### 활성 커밋 (Rules + 클라이언트)

```
f3e579b Revert "feat(multitenancy): pre-auth users 쿼리 제거"  ← 롤백
d7be6de Revert "feat(multitenancy): Rules(users read → isSignedIn)"  ← 롤백
f9943c2 feat(multitenancy): Rules + 관리자앱 학생 추가 usernameLookup  ← 롤백됨 (B3 2차)
9e2bc92 feat(multitenancy): pre-auth users 쿼리 제거 + 학생 추가/삭제  ← 롤백됨 (B3 1차)
55ee8b2 feat(recording): Gemini 오디오 자르기  ← 기능 비활성 (3/3 0점 버그)
b349ff8 feat(rules): Custom Claims 기반 isAdmin() + 신규 컬렉션 3종  ← 유지
537fbcc feat(student/login): usernameLookup 기반 로그인 전환  ← 유지
6279f6e feat(multitenancy): usernameLookup 컬렉션 시드  ← 유지
0e68fc6 feat(multitenancy): Custom Claims 백필 68명  ← 유지
e566831 feat(multitenancy): plans/academies + academyId 마이그레이션  ← 유지
```

### 현재 상태 요약

- **SW 캐시**: v112 (안정 버전)
- **Firestore Rules**: B1+B2 적용 (isAdmin claims-first + 신규 컬렉션 규칙)
  - `users allow read: if true` **유지** (B3 롤백으로 돌아옴)
  - `usernameLookup write: isSuperAdmin()` **유지** (B3 롤백)
- **클라이언트 doLogin**: usernameLookup 우선 + users 쿼리 폴백 (537fbcc 상태)

### 프로덕션 서비스 상태
✅ 학생 로그인 정상
✅ 관리자 로그인 정상
✅ 관리자 학생 추가/삭제 정상 (옛 방식)
⚠️ 녹음숙제 제출 시 3/3 0점 (55ee8b2 버그, 기능 안 씀)

---

## 데이터 상태 (안 건드리고 유지됨)

### Firestore

- `plans/lite`, `plans/standard`, `plans/pro` — 생성됨, 아직 읽히지 않음
- `academies/default` — 생성됨, 아직 읽히지 않음
- `usernameLookup/*` — **75건** (73 기존 + test2026 + test2026b)
- 모든 기존 컬렉션 — `academyId: "default"` 필드 보유, 무시됨
- `users` 74건 + test2026, test2026b **= 76건** (2명 잔여 테스트 학생)

### Firebase Auth

- 68명 Custom Claims 주입됨 (`{academyId:"default", role:"academy_admin"|"student"}`)
- test2026, test2026b 에는 Custom Claims **미주입** (backfill 이후 추가됐음)

### 롤백 후 잔여 처리 필요 (내일)

- `users/{test2026 uid}` 및 `users/{test2026b uid}` — 관리자 UI 에서 삭제 가능
- 해당 `usernameLookup/default_test2026*` 도 동반 삭제됨 (현재 코드가 그렇게 되어있진 않음, 수동 필요)

---

## 오늘 성공한 작업 (유지 중)

1. **Phase 0 기반 인프라** (e566831) — plans/academies/마이그레이션 전부 완료
2. **Custom Claims 백필** (0e68fc6) — 68명 주입
3. **usernameLookup 시드** (6279f6e) — 73개 생성
4. **학생 로그인 전환** (537fbcc) — usernameLookup 기반 + 폴백 (안정)
5. **Rules B1+B2** (b349ff8) — isAdmin() claims 이중 경로 + 신규 컬렉션 규칙
6. **녹음 오디오 자르기** (55ee8b2) — **코드는 있으나 0점 버그**. 기능 미사용 상태라 방치

---

## 내일 세션 시작 지점

### 남은 Phase 0 작업

| 작업 | 상태 | 비고 |
|---|---|---|
| B3a: 클라이언트 pre-auth users 쿼리 제거 | **롤백됨, 재접근 필요** | 오늘 실패 |
| B3b: Rules users allow read 제거 | **롤백됨, 재접근 필요** | B3a 이후 |
| D: api/createStudent.js 서버 API | 미시작 | B3 이후 자연스러움 |
| E: 클라이언트 쿼리 academyId 필터 | 미시작 | 두 번째 학원 생길 때 의미 |

### 녹음숙제 트랙 (별도)

| 작업 | 상태 |
|---|---|
| 오디오 자르기 디버그 | **롤백 필요 or 비활성화** |
| 클라이언트 성실도 체크 3종 | 미시작 |
| AI 평가 실패 재시도 + eval_error 상태 | 미시작 |
| 관리자 대시보드 상태 배지 | 미시작 |

---

## B3 오늘 실패 원인 분석 (내일 접근법 힌트)

### 무엇이 실패했나

1. **최초 누락**: 관리자 앱 본연의 `saveStudent()` (admin/js/app.js:644) 를 처음 B3 1차에서 빠뜨림
   - 학생 앱 내 레거시 관리자 플로우만 수정
   - 결과: test2026b 생성 시 `users` 는 쓰이는데 `usernameLookup` 안 씀 → 로그인 불가

2. **2차 수정 후 버튼 무반응**:
   - `window.saveStudent` 는 `function` 으로 존재 (직접 호출 시 Promise pending)
   - 하지만 HTML `<button onclick="saveStudent()">` 클릭이 함수를 호출 안 함
   - F12 로그에 아무 것도 안 찍힘
   - **원인 미규명** — ES 모듈/inline onclick 스코프 이슈, SW 캐시 잔여물, 모달 오버레이 등 가능성

### 내일 B3 재시도 시 접근법

**원샷 배포 대신 2조각으로 쪼갠다**:

#### B3a (세션 1: 클라이언트만, Rules 유지)
- doLogin 폴백 제거
- doSignup, 관리자 학생 추가, **관리자 앱 본연 saveStudent** (admin/js/app.js:644) **모두** 같이 수정
- 엑셀 일괄 등록도 수정
- 학생 삭제 4곳에 usernameLookup 삭제 연동
- **배포 후 하루 이틀 모니터링** — 실제 학생/관리자 로그인 이슈 없는지
- Rules 는 아직 `users allow read: if true` 유지

#### B3b (세션 2: Rules만 변경)
- users `allow read: if true` → `isSignedIn()`
- usernameLookup `write: isSuperAdmin()` → `create/update/delete: isAdmin()`
- B3a 에서 pre-auth 쿼리 전부 제거됐음이 확인됐을 때만 배포

### 핵심 체크리스트 (내일 작업 시)

- [ ] **pre-auth users 쿼리 grep 전수** — 학생앱 + 관리자앱 양쪽 모두
- [ ] **학생 추가 함수 2곳 모두 확인** — student app 내부 + admin app 본연
- [ ] **엑셀 일괄 등록도 같은 플로우 적용**
- [ ] **버튼 onclick 테스트**: 단순 최소 코드로 `onclick="saveStudent()"` 잘 연결되는지 먼저 확인
- [ ] **배포 전 F12 로컬 테스트** — Python simple HTTP server 또는 Vercel dev 로 먼저

---

## 진단 데이터 (오늘 수집)

### 관리자 앱 `saveStudent` 위치
- `public/admin/js/app.js:644` — 단건 추가 (모달 UI)
- `public/admin/js/app.js:1895~` — 엑셀 일괄 등록

### 학생 앱 내 관리자 플로우 위치
- `public/js/app.js:2948` (중복체크), `:2956` (users write), `:3029` (단건 삭제)

### 학생 앱 자체 가입 위치
- `public/js/app.js:3597` (doSignup)

### 학생 앱 학생 조회 (반 랭킹)
- `public/js/app.js:2616` (renderRanking, where('group','==',group))

---

## 유용한 재사용 가능 자원

### 로컬 스크립트 (scripts/)
- `npm run backup` — Firestore 전체 로컬 JSON 백업
- `npm run migrate:username-lookup` — 누락 lookup 채우기 (DRY-RUN 가능)
- `npm run migrate:backfill-claims` — Custom Claims 백필

### 참조 문서 (사용자가 제공해준 것)
- `plan-pricing-final.md`
- `multitenancy-implementation.md`
- `ai-features-integrated.md`
- `recording-homework-rework.md`
- `roadmap-and-workflow.md`

---

## 주의사항 (반복하지 말 것)

1. **원샷 배포 금지**: 클라이언트 + Rules 같이 변경 + 배포 = 실패 시 디버그 어려움. 쪼개서 배포.
2. **관리자 앱 본연의 플로우도 반드시 확인**: admin/js/app.js 는 별도 파일. grep 전수 필수.
3. **녹음 오디오 자르기**: WAV 인코딩이 Gemini에서 0점 처리됨. 다음 접근 때 Gemini 요구 포맷 재조사 필요 (샘플레이트/비트 등).
4. **하드 리프레시 중요성**: SW 캐시 때문에 v113→v114 바뀌어도 이전 탭은 옛 코드. 테스트 전 항상 Ctrl+Shift+R.
5. **세션 피로도**: 3시간 넘어가면 실수 확률 급증. B3 같은 큰 작업은 세션 초반에만.
