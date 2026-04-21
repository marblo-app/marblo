import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Prevent Vite HMR from full-page reloading after sleep/wake
// When Mac sleeps, Vite WS disconnects. On wake, Vite reconnects and
// triggers a full reload if it detects stale modules — this kills all
// Zustand state (rootPath, agents, orchestrator). Suppress it.
if (import.meta.hot) {
  let wasDisconnected = false;
  import.meta.hot.on('vite:ws:disconnect', () => {
    wasDisconnected = true;
    console.log('[HMR] WebSocket disconnected (likely sleep)');
  });
  import.meta.hot.on('vite:ws:connect', () => {
    if (wasDisconnected) {
      console.log('[HMR] WebSocket reconnected after disconnect — state preserved');
      wasDisconnected = false;
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
