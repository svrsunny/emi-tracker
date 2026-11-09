import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { RouterProvider } from './lib/router';
import { StoreProvider } from './lib/store';
import { LockGate } from './components/LockGate';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <LockGate>
        <StoreProvider fallback={<div className="empty" style={{ paddingTop: '30vh' }}><h3>Opening your local ledger…</h3></div>}>
          <App />
        </StoreProvider>
      </LockGate>
    </RouterProvider>
  </StrictMode>,
);
