# scripts/ — 관리자·마이그레이션 스크립트

멀티테넌시 전환, 학원 생성·관리, 데이터 마이그레이션용 로컬 스크립트 모음.

## 디렉토리 구조

```
scripts/
├── lib/
│   ├── firebase-admin.js     # Admin SDK 공용 초기화
│   └── plans-schema.js       # 플랜 정의 단일 소스
├── admin/
│   ├── create-plans.js                # plans/{lite|standard|pro} 문서 생성
│   └── create-default-academy.js      # academies/default 문서 생성
├── migrate/
│   └── add-academy-id.js              # 기존 문서에 academyId 필드 일괄 추가
└── README.md
```

---

## 최초 1회 설정

### 1) Firebase 서비스 계정 키 발급

1. [Firebase Console](https://console.firebase.google.com/) → `readaloud-51113` 프로젝트 선택
2. 좌측 ⚙️ (설정) → **프로젝트 설정**
3. **서비스 계정** 탭 → **새 비공개 키 생성** 버튼
4. 다운로드된 JSON 파일을 `scripts/.firebase-admin-key.json` 이름으로 저장
   - `.gitignore` 에 이미 포함되어 있어 실수로 커밋되지 않음
   - **이 파일은 프로덕션 전체 권한을 가진 비밀키입니다. 공유·업로드 절대 금지.**

또는 `.env.local` 에 아래 3개 환경변수를 넣어도 됩니다 (Vercel 이 쓰는 방식과 동일):
```
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### 2) 의존성 설치

```bash
npm install
```

`dotenv` (devDependency) 가 설치되어 `.env.local` 자동 로드를 지원합니다.

### 3) 연결 확인

```bash
npm run seed:plans
```

`(DRY-RUN)` 표시와 함께 플랜 3개가 출력되면 자격 증명 성공입니다.
아무것도 쓰지 않으니 반복 실행해도 안전합니다.

---

## 스크립트 목록

모든 스크립트는 **DRY-RUN 기본**. `--apply` 플래그가 있어야 실제로 씁니다.

### `seed:plans` — 플랜 3종 생성

```bash
npm run seed:plans           # DRY-RUN
npm run seed:plans:apply     # 실제 쓰기
```

`plans/lite`, `plans/standard`, `plans/pro` 문서를 upsert 합니다.
plans-schema.js 수정 후 재실행하면 필드가 갱신됩니다.

### `seed:default-academy` — 기본 학원 생성

```bash
npm run seed:default-academy          # DRY-RUN
npm run seed:default-academy:apply    # 실제 쓰기
```

`academies/default` 문서를 생성합니다. 기존 프로덕션 사용자를 이 학원에 귀속시키는
마이그레이션 전략입니다. 재실행해도 `usage` 카운터·`subscribedAt` 은 보존됩니다.

### `migrate:add-academy-id` — academyId 필드 일괄 추가

```bash
npm run migrate:add-academy-id                           # DRY-RUN (컬렉션별 대상 건수 리포트만)
npm run migrate:add-academy-id:apply                     # 전체 실행

# 특정 컬렉션만
node scripts/migrate/add-academy-id.js --apply --only=users,scores
```

대상 컬렉션 19개 + 서브컬렉션 3개의 모든 문서에 `academyId: "default"` 를 추가합니다.

⚠️ **실행 전 반드시 Firestore Export 백업을 받으세요.**
- Firebase Console → Firestore → Import/Export → Export
- 또는: `gcloud firestore export gs://YOUR-BUCKET/backups/$(date +%Y%m%d)`

---

## 권장 실행 순서 (Phase 0)

아직 Phase 0 준비 단계입니다. 아래 순서는 실제 마이그레이션일에 따를 체크리스트입니다.

1. [ ] `npm run seed:plans:apply` — 플랜 3종 생성
2. [ ] `npm run seed:default-academy:apply` — 기본 학원 생성
3. [ ] **Firestore Export 백업** (필수)
4. [ ] `npm run migrate:add-academy-id` — DRY-RUN 으로 예상 건수 확인
5. [ ] `npm run migrate:add-academy-id:apply` — 실제 마이그레이션
6. [ ] (향후) Custom Claims 백필 스크립트 실행
7. [ ] (향후) usernameLookup 컬렉션 생성 스크립트 실행

---

## 보안 주의

- `scripts/.firebase-admin-key.json` 과 `.env.local` 은 **절대 커밋 금지**
- 서비스 계정 키 유출 시 Firebase Console → IAM 에서 즉시 키 폐기
- 이 스크립트들은 **프로덕션 전권**을 가집니다. `--apply` 전에 한 번 더 확인하세요.
