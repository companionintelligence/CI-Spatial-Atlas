import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the Companion Atlas iOS + Android shell.
 *
 * The shell ships the viewer-react Vite build as-is (`webDir` -> ../dist, i.e.
 * viewer-react/dist); there is no separate mobile UI. Build the web bundle
 * first (`npm run build` at the repo root, or `npm run build` in this
 * directory, which does both), then `npx cap sync`.
 *
 * Runtime configuration is baked into that bundle at build time, exactly as it
 * is for the web image: VITE_CESIUM_ION_TOKEN, VITE_GOOGLE_MAPS_API_KEY,
 * VITE_MEMORY_URL, ... (see viewer-react/.env.example). The app has no address
 * bar, so the `?memory=` / `?story=` URL parameters the browser build accepts
 * have no equivalent inside it: a shell that should show real memories needs
 * VITE_MEMORY_URL set when the web bundle is built. Without it the shell opens
 * the bundled sample story, labelled as demo data.
 */
const config: CapacitorConfig = {
  appId: 'com.companionintelligence.atlas',
  appName: 'Companion Atlas',
  webDir: '../dist',
  server: {
    // Android serves the bundle from https://localhost (iOS: capacitor://localhost). Those
    // are the page origins a CI-Server's CORS_ALLOWED_ORIGINS has to allow.
    androidScheme: 'https',
  },
  // Atlas night-space background (--teal-950 in CI-Common tokens) behind the web view,
  // so the safe-area strips and any overscroll are the app colour, not white.
  backgroundColor: '#041620',
  ios: {
    // The Atlas shell is a fixed full-viewport grid with its own top bar, so it has to
    // start BELOW the status bar / Dynamic Island. With the default ('never') the web
    // view runs under it and the top bar's controls are hidden behind the clock.
    contentInset: 'always',
  },
  android: {
    // targetSdk 36 forces edge-to-edge; without this the WebView draws under the
    // status bar and the navigation bar. Capacitor 8 makes 'auto' the default.
    adjustMarginsForEdgeToEdge: 'auto',
  },
  plugins: {
    SplashScreen: {
      // Atlas night-space background (--teal-950 in CI-Common tokens). The globe
      // takes a moment to boot (Cesium workers + imagery), so hold the splash a
      // little longer than the 500 ms default instead of flashing a blank page.
      backgroundColor: '#041620',
      launchShowDuration: 1500,
      launchAutoHide: true,
      launchFadeOutDuration: 300,
      showSpinner: false,
    },
    StatusBar: {
      // Capacitor DARK = light glyphs, for a dark app.
      style: 'DARK',
      backgroundColor: '#041620',
    },
  },
};

export default config;
