# 2026-04-25 세션 인수인계 (멀티테넌시 Phase 2~4)

> 다음 세션에서 읽고 시작. 오늘 진행 + 내일 시작 지점.

---

## 최종 배포 상태

**프로덕션**: SW v127, 안정 (Phase 4-2 까지 활성, 4-3 일괄 시도 후 롤백)

### 활성 커밋
```
b1e3e51 Revert "feat(phase4-3+4): 79개 일괄"  ← 롤백 (인덱스 누락 다발)
ea15926 feat(phase4-3+4): 79개 academyId 필터  ← 롤백됨
cf13d11 feat(phase4-2): 핵심 4개 쿼리 academyId 필터  ✅ 활성
6ddc23e feat(phase4-1): window.MY_ACADEMY_ID 전역 세팅  ✅ 활성
8217bbf feat(phase2): super_admin + createAcademy + CLI  ✅ 활성
6335496 feat(B3b/rules): users allow read 제한  ✅ 활성
f7e6e70 fix(B3a/student): pre-auth users 쿼리 제거  ✅ 활성
13dc838 feat(admin/ux): 검증 토스트 87곳 → showAlert  ✅ 활성
e575edb feat(student): doSignup 완전 제거  ✅ 활성
70fa5ab fix(admin): deleteSelectedStudent 중복 정의 제거  ✅ 활성
```

---

## 오늘 핵심 성과

### 1. 어제 미해결 버그 진짜 원인 발견·해결
- `deleteSelectedStudent` 가 두 번 정의 → 옛 버전(Firestore만 삭제)이 항상 이김
- → orphan 발생 패턴 진짜 원인. 70fa5ab 에서 해결

### 2. UX 일괄 정리
- 검증 토스트 87곳 → showAlert 모달 (사용자가 놓치던 경고들 명확히)
- doSignup 회원가입 기능 통째 제거 (학원장 직접 등록 정책)

### 3. Phase 2 마무리
- super_admin Custom Claims 도구 (`scripts/admin/promote-super-admin.js`)
- 신규 학원 생성 API (`api/createAcademy.js`)
- 신규 학원 생성 CLI (`scripts/admin/create-academy.js`)
- 사용자 admin 계정을 super_admin 으로 승격 완료

### 4. Phase 5 부분 검증
- 테스트 학원 `raloud2` (큰소리 지점) 생성 — Pro 플랜, 학생 한도 30
- 학원장: moon308500@gmail.com (별도 임시 비번)
- 검증용 학생 1명 (raloud2_test1) 추가
- **격리 실패 확인**: default 학원 admin 화면에 raloud2 학생 노출 → Phase 4 필요성 입증

### 5. Phase 4 진행
- **4-1 ✅** : `window.MY_ACADEMY_ID` 전역 세팅 (Custom Claims 우선, users 폴백, 'default' 최종)
- **4-2 ✅** : 핵심 4개 쿼리 (loadStudents, loadDashStats) academyId 필터 — raloud2 격리 확인
- **4-3+4 ❌→롤백** : 79개 일괄 변환 시도 후 인덱스 누락으로 화면 다발 깨짐 → revert

---

## 내일 시작 지점

### Phase 4-3 점진 재시도 (핵심 작업)

**전략 변경**: 화면별 1~3개 묶음씩 + 인덱스 사전 추가.

매 사이클:
1. firestore.indexes.json 에 필요 인덱스 추가
2. `firebase deploy --only firestore:indexes` (5~10분 빌드)
3. 빌드 완료 후 해당 화면 쿼리 academyId 필터 추가
4. 클라이언트 push
5. 검증 (raloud2 데이터 안 보이는지)

### 우선순위 (사용 빈도)

| 순위 | 컬렉션 | 인덱스 |
|---|---|---|
| 1 | notices | academyId + createdAt desc |
| 2 | genTests | academyId + createdAt desc |
| 3 | scores | academyId + date / academyId + uid |
| 4 | payments | academyId + status (+createdAt) |
| 5 | hwFiles | academyId + createdAt desc |
| 6 | genBooks/Chapters/Pages | academyId + createdAt desc / + bookId |

### 도구 재활용

`scripts/refactor/add-academy-filter.js` 는 롤백으로 사라짐. 필요시 git history (ea15926) 에서 복원 가능. 하지만 **점진 적용에는 부적합** (한 번에 79건). 한 컬렉션씩만 변환하도록 `--only=collection_name` 옵션 추가하면 점진 가능.

---

## 잔여 정리 사항 (선택)

- raloud2 / raloud2_test1 / raloud2_admin: 그대로 유지 (다른 평가용으로 사용 예정)
- 4-3 점진 적용 완료 후 raloud2 격리 최종 검증

---

## 다음 세션 추천 진행 방향

**옵션 A (권장)**: Phase 4-3 점진 적용
- 1~6 순위 한 화면씩 (총 1~2일)
- 매 단계 격리 검증

**옵션 B**: AI Generator 같은 큰 모듈 우선
- genBooks/Chapters/Pages/QuestionSets 한 묶음 (단, 인덱스 종류 많아 신중)

**옵션 C**: Phase 3 (다른 api/*.js 의 academyId/플랜/쿼터 체크)
- ocr, generate-quiz, check-recording, cleanup-ocr 에 academyId 검증
- AI 비용 추적 시급도 따라

**오늘 마무리 시점 권장**: A (Phase 4-3 점진)
