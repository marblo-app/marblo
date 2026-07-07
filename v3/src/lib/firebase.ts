import { initializeApp } from "firebase/app";
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

export const app = initializeApp(firebaseConfig);

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
