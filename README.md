# 큰소리 영어 - 배포 가이드

## 폴더 구조
```
kunsori-english/
├── public/
│   ├── index.html      ← 앱 전체
│   ├── manifest.json   ← PWA 설정
│   ├── sw.js           ← Service Worker
│   └── icons/          ← 아이콘 폴더 (직접 추가 필요)
│       ├── icon-192.png
│       └── icon-512.png
└── vercel.json         ← Vercel 설정
```

---

## 1단계: 아이콘 파일 추가
`public/icons/` 폴더를 만들고 큰소리 영어 아이콘을 두 가지 크기로 저장하세요:
- `icon-192.png` (192×192px)
- `icon-512.png` (512×512px)

---

## 2단계: Firebase 설정

### Firebase Authentication 활성화
1. Firebase 콘솔 → Authentication → 시작하기
2. **이메일/비밀번호** 로그인 방법 활성화

### Firebase Firestore 활성화
1. Firebase 콘솔 → Firestore Database → 데이터베이스 만들기
2. **테스트 모드**로 시작 (나중에 Rules 수정)
3. 아래 컬렉션들이 자동 생성됨:
   - `users` - 사용자 정보
   - `units` - 단어 단원
   - `notices` - 공지사항
   - `hwFiles` - 숙제 파일
   - `scores` - 학습 점수
   - `hwSubmissions` - 숙제 제출 현황

### 관리자 계정 수동 생성
Firebase 콘솔에서 직접 생성:

**Authentication** → 사용자 추가:
- 이메일: `admin@kunsori.app`
- 비밀번호: 원하는 비밀번호

**Firestore** → users 컬렉션 → 문서 추가:
- 문서 ID: (Authentication에서 생성된 UID 복사)
- 필드:
  ```
  username: "admin"
  name: "관리자"
  email: "admin@kunsori.app"
  role: "admin"
  group: ""
  ```

---

## 3단계: Vercel 배포

### 방법 A: GitHub 연동 (권장)
1. 이 폴더를 GitHub 저장소에 올리기
2. [vercel.com](https://vercel.com) → New Project → GitHub 저장소 선택
3. **Root Directory**: `kunsori-english` (또는 루트면 그냥 배포)
4. Deploy 클릭!

### 방법 B: Vercel CLI
```bash
npm i -g vercel
cd kunsori-english
vercel --prod
```

---

## 4단계: Firebase Rules (보안 강화)
배포 후 Firestore Rules를 아래로 수정:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    match /units/{unitId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    match /notices/{id} {
      allow read: if request.auth != null;
      allow write: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    match /hwFiles/{id} {
      allow read: if request.auth != null;
      allow write: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    match /scores/{id} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    match /hwSubmissions/{id} {
      allow read, write: if request.auth != null;
    }
  }
}
```

---

## 학생 계정 추가 방법
관리자 로그인 후 → 학생 탭에서 추가
- 이메일은 자동 생성됨: `아이디@kunsori.app`

---

## PWA 설치 방법 (학생용)
- **Android**: 브라우저 메뉴 → "홈 화면에 추가"
- **iPhone**: Safari → 공유 버튼 → "홈 화면에 추가"
