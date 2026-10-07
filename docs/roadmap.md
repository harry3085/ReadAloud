# 큰소리 영어 (ReadAloudApp) — 진행 계획

> 최종 갱신 **2026-10-07**
>
> 흩어져 있던 보류 작업을 한곳에 모은 문서. 각 항목은 **트리거**(언제 착수할지)를 갖는다.
> 날짜로 밀어붙이지 않고 조건이 충족될 때 꺼내 쓴다.
>
> 상세 배경·구현 메모는 `~/.claude/projects/d--ReadAloudApp/memory/` 의 메모리 파일에 있다
> (각 항목의 `memory:` 참고). 이 문서는 **목록과 우선순위**만 관리한다.

---

## 0. 지금 관찰 중

착수 완료, 결과를 보고 다음을 정하는 단계.

| 항목 | 상태 | 다음 확인 |
|---|---|---|
| **카톡 인앱 차단** (v821~823, 10/6) | 배포 완료 | 일일 리포트의 `인앱 차단·로그아웃` 기록. 대상 7명이 브라우저로 넘어갔는지 / 신규 인앱 로그인이 생기는지 |
| **Firestore 전송량** | 1차로 **약 88% 절감** 확인 (월 환산 ~2GB) | 10월 말 전체 월 실적 1회. 월 5GB 초과 시에만 2차 |
| 말하기 안정성 (iOS SR) | WebKit 버그라 근본 해결 불가 | iOS 27 학생 3명 추이 |

- memory: `project_kakao_inapp_login_block` · `project_firestore_egress_reduction`

---

## 1. Phase 5 — 출시 준비 ⭐ 최우선 미착수

**진행률 0%.** 베타 운영 대응에 밀려 손대지 못한 가장 큰 덩어리.

### 1-1. 도메인
- 자체 도메인 도입 (예: kunsori.com)
- **`ALLOWED_ORIGINS` env 갱신 필수** — 잊으면 전 학원 차단
- Vercel Domains · Firebase Auth 승인 도메인 · FCM · manifest `start_url` 묶음
- memory: `project_domain_change_checklist` (체크리스트 완비, 그대로 따라가면 됨)

### 1-2. 약관 · 개인정보처리방침
- 학생 개인정보(이름·녹음·발화 기록) 수집 고지
- 녹음 60일 / 메시지 첨부 10일 / 공지 첨부 1년 보관 정책은 이미 적용 중 → 문서화만

### 1-3. 결제 PG 연동
- 현재는 학원장 수기 확인 방식 (청구서 생성 → 입금 체크)
- 자동 청구·카드 결제는 미구현
- 선행: 결제 데이터 모델은 이미 안정 (수강료·교재·앱사용료 3분류 + anchor month)

---

## 2. 다른 학원이 실제 운용을 시작하기 전

현재 등록 6곳 중 **실운용은 default 하나**. 두 번째 학원이 학생을 받기 전에 처리.

| 항목 | 내용 | memory |
|---|---|---|
| **학원별 공유 링크 og 태그** | 카톡 카드에 그 학원 로고·이름. 학원 분기는 **이미 동작**, og 태그만 없음 (~30분, 추가 조회 0회) | `project_academy_share_link_og` |
| **학원 설정 페이지** | 학원장이 직접 로고·홍보문구·본인 정보 수정. super 앱과 양방향 동기 | `project_academy_settings_page` |
| 로고 업로드 | 6곳 중 로고 보유는 default·raloud2 **둘뿐** | — |

---

## 3. 트리거 대기 — 조건이 생기면

| 항목 | 트리거 | memory |
|---|---|---|
| 말하기 accentVariants (R/L·F/P 발음변형 인정) | 인식 불만 **재발 시**. 적용 전 `test-spk-grading.js` 로 false positive 검증 필수 | `project_speaking_accent_variants` |
| 학원장앱 진도체크 헤드체크 | **멀티학원장 도입** 또는 학원장 다중 PC 사용 보고 (~30분) | `project_admin_headcheck_extension` |
| `createStudent` createdBy 기록 | 멀티학원장 도입 묶음 | — |
| super 앱 reads P2 | 결제 PG 연동·자동 청구 안정 후 | `project_super_reads_p2_after_billing` |
| super 앱 사용량 모니터링 정비 | 베타 후 SuperAdmin Phase B T10 묶음 | `project_super_usage_monitoring_revamp` |
| 학생 랭킹 빈 상태 | scores Rules 가 isOwner 만 허용 → server API 로 해결 권장 | `project_ranking_visibility` |
| Gemini 진단봇 (학원장앱 채팅) | Phase 5 후 검토 | `project_gemini_diagnosis_bot` |
| **AI OCR 정리 후속 보완** (괄호 짝 경고 · 마침표→쉼표 규칙 · Vision 대신 Gemini 이미지 OCR) | 학원장이 "필요하다"고 할 때. 괄호 경고(코드)·마침표 규칙(프롬프트)은 작음 / Gemini OCR 은 저해상도 이미지 한글 누락이 반복될 때 검토 | `project_ai_ocr_cleanup_pipeline` |
| **Gemini 파라미터 폐기 대응** (thinkingBudget·temperature·topP → thinking_level) | **새 Gemini 모델을 폴백 체인에 넣을 때** (현 모델은 영향 없음). api 6파일 + 스크립트 일괄, 공용 헬퍼화 | `project_gemini_param_deprecation` |

---

## 4. 여유 있을 때 — 품질 · 구조

운영에 지장은 없지만 쌓이면 비용이 되는 것들. **사용자가 "장시간 여유" 라고 할 때** 착수.

| 항목 | 규모 | memory |
|---|---|---|
| **admin app.js 모듈 분리** | 현재 ~17k 줄. 6 phase 점진 분리 계획 | `project_module_split` |
| **옛 schema 정리** | 14개 영역 (A 즉시 / B 마이그레이션 / C 보존), 3 Phase. 한 번에 하지 말 것 | `project_legacy_schema_cleanup` |
| **v1.0 Polish 사이클** | 디자인 토큰화(`--text-*`/`--gap-*`/`--radius-*`) · 컴포넌트 통합 · 로직 패턴 수렴 | `project_v1_polish_cycle` |
| 학원장 대시보드 달력 통합 | 큰 달력 + 생일·결제·시험 통합 뷰 | `project_dashboard_calendar` |
| 글로벌 설정 Option B | 학원 커스텀 Firestore 격리 (AI 프롬프트 localStorage 잔존분) | `project_global_config_refactor` |

---

## 5. 최근 완료 (참고)

| 시기 | 내용 |
|---|---|
| 2026-10-07 | AI OCR·정리 단어장 정비 — Vision 언어 힌트 ko,en(한글 뜻 누락 해소) · Snapshot 프롬프트 v1~v7(원문 충실·유형 A/B·발음기호/품사 제거·뜻 칸 규칙·~ 유지) · 정리 결과 후처리(없는 단어/중복 제거·복원, 누락·뜻 없음 경고) · 손글씨 촬영 안내 |
| 2026-10-06 | 카톡 인앱 전면 차단 + 자동 로그아웃 · 차단 화면 앱 양식 · 삼성 인터넷 경고 제거(완료율 95%로 근거 없음) |
| 2026-10-01 | Firestore 전송량 1차 — 응시 이력 전체 수신 제거, 약 88% 절감 |
| 2026-09 | 단어 학습(vocab-practice) · 문장시험 청크 학습 · 듣고 선택하기 신규 유형 / iOS 음성 안정화 / 말하기 기기 기록(speakLog) |
| 2026-08 | 틀린문제만 재응시 · 100점까지 옵션 / 문장시험 Phase 1~5 |
| 2026-06~07 | 녹음 AI 평가 종합 정비 (모델 변경·DP LCS 형광펜·다층 안전망) |

---

## 갱신 규칙

- **새 보류 항목이 생기면** 메모리에 쓰고 이 문서에 한 줄 추가 (트리거 명시)
- **착수·완료 시** 해당 줄을 §5 로 옮기고 메모리도 갱신
- 이 문서는 **목록**만, 구현 상세는 메모리에 — 중복 서술하지 않는다
