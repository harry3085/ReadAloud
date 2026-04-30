# 2026-04-30 세션 인수인계 — SuperAdmin Phase A (T1~T5) 완료

> 다음 세션에서 읽고 시작. 오늘 완료 + 다음 시작 지점.

---

## 최종 배포 상태

**프로덕션**: `https://raloud.vercel.app/super/` (master `b2c9d26`)

### 활성 커밋 (오늘 진행)
```
b2c9d26 feat(superadmin): T5 사용량·모니터링 탭 + Gemini 글로벌 배너
e260654 fix(superadmin): 매출 카드 인덱스 매칭 + 만료 임박 기준 10일
7884fa3 refactor(superadmin): 슈퍼 앱 confirm/prompt 통일 (showSuperConfirm/Prompt)
ab6e9df fix(superadmin): T4 Summary 매출/만료임박 카드 갱신 누락
4ab4d00 feat(superadmin): T4 구독 결제 관리 (subscriptions 컬렉션)
947e13d chore(usage): mcqCallsThisMonth + storageBytes 제거 (실사용 없음)
a990ffa fix(superadmin): T3 사용량 탭 죽은 카운터 제거 (A안)
87e4cce feat(superadmin): T3 학원 관리 강화 (4탭 모달 + 가입경로/메모/타임라인)
e4664ca feat(superadmin): T2 adminLogs 컬렉션 + 슈퍼 작업 자동 로깅
68f478e feat(superadmin): T1 academies 스키마 확장
```

---

## 오늘 완료 (Phase A T1~T5)

### T1. academies 스키마 확장
- 신규 필드: `acquisitionChannel`, `internalMemo`, `featureFlags`, `contactLog`, `lastAdminLoginAt`
- `grandfatheredPrice` 객체화 (`{enabled, monthlyPrice, yearlyPrice, grantedAt, note}`)
- 학원 6곳 마이그레이션 적용 (default/dongbu/first/ipark/raloud2/saloud)
- 학원장 로그인 시 `lastAdminLoginAt` 갱신 — `firestore.rules` 부분 완화

### T2. adminLogs 자동 로깅
- 컬렉션 `adminLogs` (super_admin read/create, update/delete 차단 — 불변)
- `logAdminAction` 헬퍼 + 9개 작업에 호출 (create/delete/update_academy, update_academy_admin, update_user, update_prompts_config, update/delete_preset_config, add_contact_log, create/approve/reject/refund_subscription)
- 민감 값(비밀번호 등) 절대 details에 저장 안 함 — `changedFields` 키 목록만

### T3. 학원 관리 강화
- 학원 생성 모달: 가입 경로, 얼리어답터 가격(월/연/메모), 운영자 메모
- 학원 상세 모달 4탭: **기본정보 / 📜타임라인 / 📝메모 / 📊사용량**
  - 타임라인: `adminLogs.targetId == academyId` 시간 역순 50건 (인덱스 빌드 완료)
  - 메모: `internalMemo` + `contactLog` (call/email/kakao/meeting), 연락 기록은 즉시 저장
  - 사용량: T5에서 채움 (학생 한도 + AI/녹음 한도 % + 진행 바)
- 학원 목록: 만료일·마지막 로그인 컬럼 추가, billingStatus 4단계 배지
- Summary 5장 카드 마스터 설계대로 재구성

### T4. 구독 결제 관리 (subscriptions 컬렉션)
- **결정**: 기존 `payments`(학원장 → 학생 수강료)와 분리, 새 컬렉션 `subscriptions`(학원 → 우리 구독료)
- 5개 섹션: 결제 대기 / 만료 임박 / 미납 학원 / 결제 등록 / 결제 이력
- 결제 등록 모달: 즉시 승인 옵션, 얼리어답터 가격 자동 채움
- 승인 시 `writeBatch`로 academies.billingStatus / planExpiresAt / planId / studentLimit 동시 갱신
- 거부 / 환불 액션 (환불은 academies 자동 변경 X)
- CSV Export, 학원 상세 모달 결제 이력 5건 박스
- T3 매출 카드 진짜 데이터 활성화 (인덱스 ASC/DESC 매칭 버그 해결)

### T5. 사용량·모니터링
- `apiUsage` 컬렉션은 이미 `{academyId}_{YYYY-MM-DD}` 학원별 분리 형식 (작업지시서의 Phase B 5-G 마이그레이션은 사실상 완료된 상태)
- 5장 카드: 활성 학원 / 이번 달 AI / Gemini 오늘 / 매출 / 신규
- 🤖 Gemini 게이지 (1000 RPD, 엔드포인트 3종 분포)
- 📊 학원별 Top 10 (academies.usage 기준)
- 🧩 엔드포인트 분포 (Gemini/Vision 색 구분)
- ⚡ 시스템 헬스 (7일 학원장 활성도)
- 글로벌 경고 배너 (헤더 아래, 80%↑ 자동 표시, 5분마다 갱신)
- 임계값 표준화 `_thresholdColor`: 95↑빨강 / 80↑노랑 / 50↑파랑 / 그 외 초록

### 부수 청소
- `mcqCallsThisMonth`, `storageBytes` 제거 (academies.usage 죽은 placeholder)
- 살아있는 카운터: `activeStudentsCount`, `aiCallsThisMonth`, `recordingCallsThisMonth`, `lastResetAt` (api/_lib/quota.js 가 관리)
- 슈퍼 앱 `confirm()`/`prompt()` 6곳 → `showSuperConfirm` / `showSuperPrompt` 자체 모달 통일

---

## 신규 스크립트

| 경로 | 용도 |
|---|---|
| `scripts/migrate/extend-academies-schema.js` | T1 — academies 신규 필드 + grandfatheredPrice 객체화 (멱등) |
| `scripts/migrate/remove-dead-usage-fields.js` | mcqCallsThisMonth/storageBytes 제거 (멱등) |
| `scripts/diag/check-billing-state.js` | 학원별 만료일·D-day·subscriptions 합계 진단 |
| `scripts/diag/check-api-usage.js` | apiUsage 컬렉션 구조·오늘 합계 진단 |

---

## 컬렉션·인덱스 변경

### Firestore 컬렉션
- 신규: `adminLogs`, `subscriptions`
- 학원장이 학생에게 받는 수강료는 기존 `payments` 그대로 (학원장 앱 사용)

### Firestore 인덱스 (firestore.indexes.json)
- `adminLogs`: targetId ASC + at DESC
- `subscriptions`: status ASC + requestedAt DESC
- `subscriptions`: status ASC + approvedAt DESC
- `subscriptions`: academyId ASC + requestedAt DESC

### Firestore 룰 변경
- `academies`: update 부분 완화 (학원장이 자기 학원 `lastAdminLoginAt` 단일 필드만 갱신 가능)
- `adminLogs`: super_admin read/create, update/delete 차단
- `subscriptions`: super_admin write, 자기 학원장 read

---

## Phase A 진행률

마스터 설계 PHASE-A.md 기준:

| 작업 | 상태 |
|---|---|
| T1 academies 스키마 확장 | ✅ |
| T2 adminLogs 자동 로깅 | ✅ |
| T3 학원 관리 강화 | ✅ |
| T4 결제 관리 | ✅ |
| T5 사용량·모니터링 | ✅ |
| T6 외부 알림 (카카오/이메일) | ⏸ Phase B로 미룸 (글로벌 배너로 대체) |
| T7 통합 테스트 + 운영 가이드 | ⏳ 다음 세션 |

**핵심 인프라(T1~T5) 완료. 베타 첫 학원 받을 준비 인프라적으로 끝.**

---

## 다음 세션 시작 지점

### 옵션 1: T7 (운영 가이드 + 통합 검증) ← 추천
베타 시작 직전 가장 가치 있음:
- `docs/superadmin-operations-guide.md` 한국어 운영 매뉴얼
  - 신규 학원 가입 / 결제 승인 / 비밀번호 분실 / 미납 처리 / Gemini 80% 도달 / 학원 해지 절차
- `docs/superadmin-prelaunch-checklist.md` 베타 시작 직전 체크리스트
- 코드 변경은 발견 시 fix 정도

### 옵션 2: 베타 첫 학원 받기
인프라는 다 됐음. 운영 시작 → 발견된 이슈 즉시 수정.

### 옵션 3: Phase B 진입
- T8 공지·알림 탭 (전사 공지 발송)
- T9 Cloud Function 일일 집계 (systemHealth)
- T10 일별 추이 차트
→ 운영 데이터가 쌓여야 의미 있어 베타 후 권장

---

## 검증 학원 (베타용 X)

- `default`: ✅ 실사용 중. 변경 시 보수적으로
- `raloud2`: 멀티테넌시 격리 검증용 (학원장 비번 `123456`)
- `dongbu / ipark / first / saloud`: T3~T4 검증 중 사용자가 만든 학원
- `subscriptions/{id}` 1건 active (ipark, 30,000원, 2026-04-30~05-30)

---

## 알려진 운영 이슈 (없음)

오늘 작업 중 발견된 이슈는 모두 그 자리에서 fix 완료. 추가 청소 대상 없음.
