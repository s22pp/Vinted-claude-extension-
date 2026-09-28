import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Companion } from '@/app/companion/Companion';
import { Providers, bootTheme } from '@/app/providers';
import { EraDataProvider } from '@/app/state';
import { ErrorBoundary } from '@/app/components/error-boundary';

bootTheme();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <ErrorBoundary where="sidepanel" page>
        <EraDataProvider>
          <div className="era-backdrop" aria-hidden="true" />
          <Companion mode="panel" />
        </EraDataProvider>
      </ErrorBoundary>
    </Providers>
  </StrictMode>,
);
