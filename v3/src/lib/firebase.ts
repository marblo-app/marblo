import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
} from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// 패키징(loopback) 인증 모드 감지자 (단일 소스). 패키징 빌드는 127.0.0.1
// static-server origin 에서 로드되는데, 이 origin 의 top 프레임에서 Firebase
// authDomain iframe(marblo-2253d.firebaseapp.com/__/auth/iframe)은 storage
// 파티셔닝으로 핸드셰이크가 hang 한다. 그래서 패키징에선 시스템 브라우저 loopback
// OAuth(RFC 8252 + PKCE) 로 id_token 을 받아 signInWithCredential 로 마무리한다
// (티켓 QvaYPAjA). signInWithCredential 은 resolver/iframe 이 전혀 필요없다.
// 이 iframe 을 로드하는 것(popupRedirectResolver·getRedirectResult)은 패키징에서
// 반드시 피해야 한다 — 로드되면 auth event manager 흐름을 막아 signInWithCredential
// 이 timeout→auth/network-request-failed 로 귀결된다 (티켓 KVId8CCsu8pXYGhRGtz3).
// dev/웹(import.meta.env.DEV)은 기존 in-window redirect/popup 흐름을 그대로 쓴다.
// 게이트 스타일은 AuthProvider.loginWithGoogle 과 동일하게 맞춘다.
export const isPackagedLoopbackAuth =
  !import.meta.env.DEV &&
  typeof window !== "undefined" &&
  typeof window.electronAPI?.auth?.googleLoopback === "function";

// ★signInWithCredential network-request-failed 의 진짜 근본원인 (티켓
// kjqOupLBNbkL1MOziadX). 이전 수정들(#324 loopback, #327 iframe 우회)에도
// 패키징 로그인 마지막 단계 signInWithCredential 이 ≈30s 뒤 auth/network-request-failed
// 로 실패했다. 오케 CDP 실측으로 네트워크·CORS·키·authorizedDomains·signInWithIdp REST(200)
// 전부 정상 확인됨에도 실패 → 네트워크가 아니라 firebase SDK 내부 문제로 확정.
//
// 번들 소스 직독으로 밝혀진 체인:
//   signInWithCredential → _performApiRequest → _performFetchWithErrorHandling 는
//   fetchFn() 을 30s NetworkTimeout(DEFAULT_API_TIMEOUT_MS=Delay(30000,60000)) 과
//   Promise.race 한다. 그런데 fetchFn() 은 실제 fetch 이전에 먼저
//   `await auth._getAdditionalHeaders()` 를 부르고, 이건
//   `await heartbeatService.getHeartbeatsHeader()`(@firebase/app) 를 기다린다.
//   HeartbeatServiceImpl 은 heartbeat 텔레메트리를 IndexedDB(idb openDB /
//   validateIndexedDBOpenable → indexedDB.open())에서 읽는다. 이 127.0.0.1
//   static-server origin 에선 indexedDB.open() 이 success/error/upgradeneeded 를
//   전혀 발화하지 않고 hang(티켓 Oq63rrnxMYv6fdeNeani/XscLxYM75DR9ou52o7Za 로 이미
//   검증된 환경적 사실). → 헤더 준비가 영원히 pending → 실제 fetch 는 발사조차 안 됨
//   (Network 탭 무활동) → 30s 뒤 NetworkTimeout 이 race 승리 → network-request-failed.
//   (firebase-js-sdk #5910, #8858 과 동일 클래스. heartbeat 헤더를 critical path 에서
//   빼거나 per-open timeout 을 준 SDK 버전은 없어 버전업/다운으로는 안 고쳐진다.)
//
// auth persistence 는 이미 localStorage-first 로 이 hang 을 우회했지만(위 티켓들),
// heartbeat 저장소는 @firebase/app 의 별개 서비스라 여전히 IndexedDB 를 무조건 쓴다 —
// 이게 남아있던 마지막 hang 지점.
//
// 근본 수정: 이 origin 에서 IndexedDB 는 어차피 비기능(hang)이므로, firebase init 이전에
// window.indexedDB 를 제거해 firebase 자신의 가드(isIndexedDBAvailable() = `typeof
// indexedDB === 'object'`)가 즉시 false 를 반환하게 한다. 그러면 heartbeat 의
// runIndexedDBEnvironmentCheck 가 hang 지점(validateIndexedDBOpenable) 호출 전에 바로
// false → storage.read() 가 {heartbeats:[]} 즉시 반환 → getHeartbeatsHeader '' 즉시 →
// 헤더 준비 즉시 완료 → 실제 fetch 발사 → signInWithCredential 정상 완료.
// 우회가 아니라 "깨진 API 를 깨진 것으로 보고"하게 만드는 현실 반영이다.
// 안전성: 이 앱에서 IndexedDB 소비자가 없다 — auth=localStorage-first(위), Firestore=
// memory cache(initializeFirestore 에 persistence 미설정), functions/app-check/messaging
// 미사용. dev/웹(isPackagedLoopbackAuth=false)은 손대지 않아 회귀 없음.
if (isPackagedLoopbackAuth) {
  try {
    // Object.defineProperty: window.indexedDB 는 프로토타입의 non-writable
    // accessor 일 수 있어 단순 대입은 무시/throw 될 수 있다. own 프로퍼티로
    // 섀도잉해 typeof 가 확실히 'undefined' 가 되게 한다.
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: undefined,
    });
    console.info(
      "[firebase] packaged loopback origin: IndexedDB neutralized " +
        "(heartbeat hang guard, ticket kjqOupLBNbkL1MOziadX)",
    );
  } catch (e) {
    // defineProperty 가 막히면 대입 폴백. 그래도 실패하면 조용히 넘어간다 —
    // 최악의 경우 기존(회귀 전) 동작으로 남을 뿐 새 회귀는 없다.
    try {
      (window as unknown as { indexedDB?: unknown }).indexedDB = undefined;
    } catch {
      console.warn(
        "[firebase] could not neutralize IndexedDB; heartbeat may still hang",
        e,
      );
    }
  }
}

// ★설정부재 방어 (P3-11). 렌더러 config 는 빌드타임 VITE_FIREBASE_* env 에서만
// 온다. 정상 서명빌드엔 반드시 채워지므로 이 가드는 오빌드(env 누락) 한정으로만
// 발화한다 — 정상 빌드엔 무영향. apiKey 가 비면 아래 initializeAuth 가 모듈 로드
// 도중 auth/invalid-api-key 로 크래시해 화면 전체가 백지가 되고 원인이 불명확해진다.
// 그 전에 명확한 에러로 즉시 중단시켜 진단을 쉽게 한다 (MCP firebase.ts 의 apiKey
// 부재 방어와 동일 취지, 티켓 MRJKgyJ4C1qPhj2Ui3vJ).
if (!firebaseConfig.apiKey) {
  throw new Error(
    "[firebase] VITE_FIREBASE_* env 가 빌드에 주입되지 않았습니다 " +
      "(apiKey 비어있음). 이 렌더러 번들은 Firebase 설정 없이 빌드됐습니다 — " +
      "vite build 시 .env(VITE_FIREBASE_API_KEY 등)를 확인하세요.",
  );
}

// ★getApps() 가드 (P3-11). HMR·중복 모듈 eval 시 initializeApp 재호출이
// "Firebase: Firebase App named '[DEFAULT]' already exists" 로 throw 하는 것을
// 막는다 (MCP firebase.ts 의 getApps 패턴과 동일). 이미 초기화됐으면 기존 앱을
// 재사용한다. 첫 로드(정상 경로)에선 getApps().length === 0 이라 동작 무변화.
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// initializeAuth(getAuth 대신): persistence 를 명시적 폴백 배열로 지정한다.
// 패키징 앱은 electron main 의 http.createServer 로 127.0.0.1:랜덤포트 static
// server 에서 로드되는데, 이 origin 에서 Firebase 의 기본 persistence(IndexedDB)
// 초기화가 네트워크 요청 이전 단계에서 조용히 hang → onAuthStateChanged 미발화 →
// 로그인 불가 회귀가 발생했다 (티켓 Oq63rrnxMYv6fdeNeani).
//
// ★순서 = localStorage → IndexedDB → in-memory (티켓 XscLxYM75DR9ou52o7Za).
// 과거엔 IndexedDB-first 였는데, 위 hang 이 init 뿐 아니라 signInWithRedirect 의
// pending-redirect 상태 write 까지 조용히 멈춰 "Google 버튼 무반응(navigation 미발생·
// 에러도 없음)" 회귀를 일으켰다. browserLocalPersistence(localStorage)는 이 127.0.0.1
// origin 에서 안정적으로 동작하므로 최우선으로 둔다. 랜덤포트라 cross-launch persistence
// 는 어차피 유지되지 않아 localStorage-first 로 내려도 UX 손실은 미미하고, IndexedDB 는
// 정상 환경을 위해 폴백으로 남긴다.
// ★popupRedirectResolver: initializeAuth 는 getAuth 와 달리 기본 resolver 를
// 자동 포함하지 않는다. dev/웹에선 이게 없으면 redirect/popup OAuth 가
// auth/argument-error 로 실패한다 (티켓 HYvcR2xwBf5uTkHpkKS8). Google 은 redirect
// flow 를 사용해 COOP 에 끊기는 popup window.closed 경로를 피한다.
// ★단, 패키징(loopback) 모드에선 resolver 를 지정하지 않는다. resolver 는 요청 시
// authDomain iframe 을 로드하는데, 127.0.0.1 top origin 에선 이 iframe 핸드셰이크가
// hang 하여 signInWithCredential 이 auth/network-request-failed 로 죽는다
// (티켓 KVId8CCsu8pXYGhRGtz3). loopback 은 signInWithCredential 만 쓰므로 resolver
// 가 불필요하다.
export const auth = initializeAuth(app, {
  persistence: [
    browserLocalPersistence,
    indexedDBLocalPersistence,
    inMemoryPersistence,
  ],
  ...(isPackagedLoopbackAuth
    ? {}
    : { popupRedirectResolver: browserPopupRedirectResolver }),
});
// ignoreUndefinedProperties: mission engine 등에서 partial patch 시
// optional 필드가 undefined 로 새어 들어가도 addDoc/updateDoc 가 실패하지 않도록.
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
export const functions = getFunctions(app);
