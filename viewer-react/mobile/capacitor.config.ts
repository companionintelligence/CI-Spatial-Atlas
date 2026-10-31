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
    // Android serves the bundle from https://localhost (iOS: capacitor://localhost).
    // Companion-Memory allows both out of the box (nativeAppOrigins in
    // backend/apps/api/src/main.ts, with credentials), so a Memory server needs no
    // CORS_ALLOWED_ORIGINS entry for this shell.
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
    // Capacitor defaults this to false, which switches pinch-zoom off for the whole web
    // view and fails WCAG 1.4.4 (Resize text). Cesium's canvas keeps its own pinch
    // gesture; this is what lets people enlarge the panels and text around it.
    zoomEnabled: true,
  },
  android: {
    // Same reason as ios.zoomEnabled: the Android default is false.
    zoomEnabled: true,
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
      // Capacitor DARK = light glyphs, for a dark app. (backgroundColor is gone on
      // purpose: @capacitor/status-bar ignores it on Android 15+, which this app targets.
      // What shows behind the bars is set in values/colors.xml and values/styles.xml.)
      style: 'DARK',
    },
    SystemBars: {
      // Core plugin in Capacitor 8 (Android). Same intent as StatusBar.style: light glyphs on
      // the status and navigation bars. Without it the bars follow the phone's light/dark
      // setting and a light-mode phone paints dark icons onto the dark app.
      style: 'DARK',
    },
  },
};

export default config;
