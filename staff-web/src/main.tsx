import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { Notifications } from '@mantine/notifications';
import { DirectionProvider } from '@mantine/core';
import { theme, MantineProvider } from './theme';
import App from './App';

document.documentElement.dir = 'rtl';
document.documentElement.lang = 'ar';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DirectionProvider initialDirection="rtl">
      <MantineProvider theme={theme} defaultColorScheme="light">
        <Notifications position="top-left" />
        <App />
      </MantineProvider>
    </DirectionProvider>
  </StrictMode>,
);
