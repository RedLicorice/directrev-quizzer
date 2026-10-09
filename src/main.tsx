import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted fonts (no Google Fonts: CSP-ready, works offline). Latin subset, the weights
// Tailwind/index.css actually use: Inter 400–800 (font-sans), JetBrains Mono 400/500 (font-mono).
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './index.css';
import App from './App';

const root = createRoot(document.getElementById('root')!);

if (import.meta.env.VITE_DEPLOY === 'aws') {
  // Hosted build: everything waits for /auth/me. The Pages build never loads this chunk.
  void import('./aws/auth/AuthGate').then(({ default: AuthGate }) => {
    root.render(
      <StrictMode>
        <AuthGate>
          <App />
        </AuthGate>
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
