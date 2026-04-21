# Marblo v3 Firebase 설정 가이드

Marblo v3 Electron 앱은 Firebase를 인증, 데이터베이스, 호스팅에 사용합니다.
이 문서는 Firebase 프로젝트를 처음부터 설정하는 방법을 설명합니다.

---

## 1. Firebase 프로젝트 생성

1. [Firebase Console](https://console.firebase.google.com) 접속
2. **프로젝트 추가** 클릭
3. 프로젝트 이름 입력 (예: `marblo`)
4. Google Analytics는 선택사항 (비활성화해도 무방)
5. **프로젝트 만들기** 클릭

## 2. 웹 앱 등록

1. Firebase Console에서 프로젝트 선택
2. **프로젝트 설정** (톱니바퀴 아이콘) > **일반** 탭
3. 하단의 **내 앱** 섹션에서 **웹** 아이콘 (`</>`) 클릭
4. 앱 닉네임 입력 (예: `marblo-web`)
5. **앱 등록** 클릭
6. 표시되는 `firebaseConfig` 값을 복사해 둔다:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

## 3. Authentication 설정

Firebase Console > **Authentication** > **Sign-in method** 탭에서 아래 제공업체를 활성화합니다.

### 이메일/비밀번호
1. **이메일/비밀번호** 클릭
2. **사용 설정** 토글 켜기
3. **저장**

### Google 로그인
1. **Google** 클릭
2. **사용 설정** 토글 켜기
3. 프로젝트의 공개용 이름과 지원 이메일 입력
4. **저장**

### 익명 인증
1. **익명** 클릭
2. **사용 설정** 토글 켜기
3. **저장**

## 4. Firestore 데이터베이스 설정

### 데이터베이스 생성
1. Firebase Console > **Firestore Database** > **데이터베이스 만들기**
2. 위치 선택 (예: `asia-northeast3` = 서울)
3. **프로덕션 모드에서 시작** 선택 (보안 규칙은 아래에서 별도 설정)
4. **만들기** 클릭

### 인덱스 생성
복합 쿼리를 사용하는 경우 Firestore에서 자동으로 인덱스 생성을 요청합니다.
에러 메시지에 포함된 링크를 클릭하면 자동으로 인덱스가 생성됩니다.

또는 CLI로 배포:

```bash
firebase deploy --only firestore:indexes
```

## 5. Firebase Hosting 배포 (marblo-web 판매사이트용)

marblo-web 디렉토리의 판매/랜딩 페이지를 Firebase Hosting으로 배포할 수 있습니다.

### 초기 설정

```bash
# Firebase CLI 설치 (아직 없는 경우)
npm install -g firebase-tools

# Firebase 로그인
firebase login

# 프로젝트 디렉토리에서 초기화
cd /path/to/marblo-web
firebase init hosting
```

초기화 질문 응답:
- **Public directory**: `out` (Next.js static export의 경우) 또는 `dist`
- **Single-page app으로 설정?**: `Yes`
- **GitHub 자동 배포 설정?**: 선택사항

### 배포

```bash
# 빌드
npm run build

# 배포
firebase deploy --only hosting
```

배포 후 `https://your-project.web.app`에서 확인 가능합니다.

### 커스텀 도메인 연결
Firebase Console > **Hosting** > **커스텀 도메인 추가**에서 도메인을 연결할 수 있습니다.

## 6. .env 설정

프로젝트 루트의 `.env.example`을 `.env`로 복사한 후 값을 채웁니다:

```bash
cp .env.example .env
```

### 변수별 설명

| 변수 | 설명 | 찾는 위치 |
|------|------|-----------|
| `VITE_FIREBASE_API_KEY` | Firebase API 키 | Firebase Console > 프로젝트 설정 > 일반 > 웹 앱의 `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | 인증 도메인 | 같은 위치의 `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | 프로젝트 ID | 같은 위치의 `projectId` |
| `VITE_FIREBASE_STORAGE_BUCKET` | 스토리지 버킷 | 같은 위치의 `storageBucket` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | 메시징 발신자 ID | 같은 위치의 `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | 앱 ID | 같은 위치의 `appId` |
| `ANTHROPIC_API_KEY` | Anthropic Claude API 키 (선택) | [console.anthropic.com](https://console.anthropic.com) > API Keys |
| `OPENAI_API_KEY` | OpenAI API 키 (선택) | [platform.openai.com](https://platform.openai.com) > API Keys |
| `GOOGLE_AI_API_KEY` | Google AI API 키 (선택) | [aistudio.google.com](https://aistudio.google.com) > API Keys |
| `VITE_PADDLE_CLIENT_TOKEN` | Paddle 클라이언트 토큰 (해외결제) | [vendors.paddle.com](https://vendors.paddle.com) > Developer Tools > Authentication |
| `VITE_PADDLE_ENVIRONMENT` | Paddle 환경 (`sandbox` 또는 `production`) | 개발: `sandbox`, 운영: `production` |
| `VITE_PADDLE_PRO_PRICE_ID` | Pro 플랜 가격 ID | Paddle > Catalog > Prices |
| `VITE_PADDLE_TEAM_PRICE_ID` | Team 플랜 가격 ID | Paddle > Catalog > Prices |
| `VITE_TOSS_CLIENT_KEY` | TossPayments 클라이언트 키 (국내결제) | [developers.tosspayments.com](https://developers.tosspayments.com) > 내 개발정보 |

> **참고**: LLM API 키는 `.env`에 설정하지 않아도 앱 내 **Settings > API Keys**에서 직접 입력할 수 있습니다.

## 7. Firestore 보안 규칙

프로젝트에는 이미 `firestore.rules` 파일이 포함되어 있습니다. 주요 규칙 구조:

```
firestore.rules          # 보안 규칙 정의
firestore.indexes.json   # 복합 인덱스 정의
firestore.rules.test.ts  # 보안 규칙 테스트
```

### 규칙 배포

```bash
firebase deploy --only firestore:rules
```

### 규칙 개요

현재 프로젝트의 보안 규칙 구조는 다음과 같습니다:

| 컬렉션 | 읽기 | 쓰기 | 비고 |
|---------|------|------|------|
| `users` | 인증된 사용자 | 본인만 생성/수정 | 삭제 불가 |
| `projects` | 프로젝트 멤버만 | 멤버: 수정, 소유자: 삭제 | `members` 배열로 멤버십 관리 |
| `tasks` | 인증된 사용자 | 인증된 사용자 | |
| `agents` | 인증된 사용자 | 인증된 사용자 | |
| `activities` | 인증된 사용자 | 생성만 가능 | 수정/삭제 불가 |
| `flows` | 인증된 사용자 | 인증된 사용자 | |
| `invitations` | 멤버 또는 초대받은 사람 | admin/owner만 생성 | 상태 변경 규칙 적용 |
| `memberRoles` | 프로젝트 멤버 | admin/owner만 | owner 역할 직접 할당 불가 |
| `subscriptions` | 본인만 | Cloud Functions만 | 클라이언트 쓰기 불가 |

### 규칙에서 사용되는 헬퍼 함수

```javascript
// 인증 확인
isAuthenticated()        // request.auth != null

// 소유권 확인
isOwner(userId)          // request.auth.uid == userId

// 프로젝트 멤버십 확인
isProjectMember(projectId)  // members 배열에 uid 포함 여부
isProjectOwner(projectId)   // ownerId와 uid 일치 여부
isAdminOrOwner(projectId)   // owner이거나 memberRoles에서 admin인지
```

### 커스텀 규칙 수정 시 주의사항

- 규칙 수정 후 반드시 `firestore.rules.test.ts`로 테스트
- `firebase deploy --only firestore:rules`로 배포 전 `firebase emulators:start`로 로컬 테스트 권장
- `request.resource.data`(쓰기 요청 데이터)와 `resource.data`(기존 데이터) 구분에 주의
