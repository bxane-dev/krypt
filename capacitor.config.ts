import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.bxane.krypt',
  appName: 'KRYPT',
  webDir: 'apps/web/dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
