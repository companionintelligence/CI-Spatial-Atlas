/**
 * Capture stage for Companion Atlas (viewer-react on Vite, see stage.sh).
 *
 * Software WebGL (SwiftShader) is the kit's default; the Cesium globe needs it
 * stated explicitly so the page does not stall. Cesium also needs the
 * `--ignore-gpu-blocklist` flag in headless Chromium.
 *
 * Every shot loads the BUNDLED sample story through `?story=`, which is a
 * disclosed fixture ("Pacific Crossing, Spring 2026"): it is not anyone's
 * memories and the film says so. `?renderer=cesium` pins the renderer.
 */
export default {
  baseURL: process.env.APP_URL ?? "http://127.0.0.1:4174",
  colorScheme: "dark",
  locale: "en-US",
  timezoneId: "UTC",
  fixedTime: "2026-10-29T15:04:00Z",
  // The default (SwiftShader) rasteriser cannot screenshot a Cesium globe at
  // 3840x2160: page.screenshot times out at 30s. `channel: "chromium"` uses the
  // GPU (ANGLE/Metal) build — see CI-Common video-kit 0.15.0.
  launch: { channel: "chromium", args: ["--ignore-gpu-blocklist", "--enable-webgl"] },
};
