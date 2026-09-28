import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { Providers, bootTheme } from '@/app/providers';
import { ErrorBoundary } from '@/app/components/error-boundary';

bootTheme();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <ErrorBoundary where="dashboard" page>
        <App />
      </ErrorBoundary>
    </Providers>
  </StrictMode>,
);
