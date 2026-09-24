import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Companion } from '@/app/companion/Companion';
import { Providers, bootTheme } from '@/app/providers';
import { EraDataProvider } from '@/app/state';

bootTheme();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <EraDataProvider>
        <div className="era-backdrop" aria-hidden="true" />
        <Companion mode="panel" />
      </EraDataProvider>
    </Providers>
  </StrictMode>,
);
