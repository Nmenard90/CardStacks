import type { CapacitorConfig } from '@capacitor/cli';

// CAP_DEV_SERVER=1 points the wrapper at the Vite dev server on the host
// machine's emulator loopback (10.0.2.2) for live reload while iterating in
// the emulator. Unset (the default, and always for release builds) packages
// the built dist/ instead -- a release pointed at 10.0.2.2 would be broken
// on every real device, so this must never be on by default.
const config: CapacitorConfig = {
  appId: 'com.poketracker.app',
  appName: 'CardStacks',
  webDir: 'dist',
  ...(process.env.CAP_DEV_SERVER ? { server: { url: 'http://10.0.2.2:5173', cleartext: true } } : {}),
};

export default config;
