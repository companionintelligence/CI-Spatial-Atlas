# Third-party software

The third-party software inside the Companion Atlas apps, listed from the lockfiles by
[`scripts/third-party-notices.mjs`](scripts/third-party-notices.mjs). Development tools that
do not ship in an app (Vite, TypeScript, the test runners, the Capacitor CLI) and the
processing server's dependencies are not listed.

| Part | Ships in | Components | Listed from |
| --- | --- | ---: | --- |
| Web viewer | the website, the viewer image, and inside every app | 157 npm packages | `package-lock.json`: the runtime dependencies of `viewer-react` and of the workspace packages it uses |
| Desktop | the Windows, macOS and Linux installers | 236 Rust crates | `viewer-react/desktop/src-tauri/Cargo.lock`, for each target platform |
| Android | the APK | 9 npm packages, 62 Android libraries | `viewer-react/mobile/package-lock.json`; Gradle's `releaseRuntimeClasspath` |

The licence texts, with the upstream NOTICE files, are in `THIRD-PARTY-NOTICES.txt`. Each app
carries it in a `licenses` folder (next to the executable on Windows and Linux, in
`Contents/Resources` on macOS, in the APK's assets on Android), and each release has it as a
download. [NOTICE.md](NOTICE.md) has the notices that the licences require.

## Licences

Counts per part. The desktop and Android apps also carry the web viewer.

| Licence | Web viewer | Desktop | Android |
| --- | ---: | ---: | ---: |
| MIT | 115 | 60 | 8 |
| Apache-2.0 OR MIT |  | 135 |  |
| Apache-2.0 | 18 | 1 | 57 |
| Unicode-3.0 |  | 15 |  |
| ISC | 11 |  | 1 |
| Apache-2.0 OR MIT OR Zlib |  | 9 |  |
| BSD-3-Clause | 7 | 2 |  |
| MIT OR Unlicense |  | 5 |  |
| Android SDK License |  |  | 4 |
| 0BSD | 1 |  | 1 |
| Apache-2.0 OR Apache-2.0 WITH LLVM-exception OR MIT |  | 2 |  |
| (MIT OR Apache-2.0) AND Unicode-3.0 |  | 1 |  |
| 0BSD OR Apache-2.0 OR MIT |  | 1 |  |
| Apache-2.0 AND BSD-3-Clause | 1 |  |  |
| Apache-2.0 AND MIT |  | 1 |  |
| Apache-2.0 OR CC0-1.0 OR MIT-0 |  | 1 |  |
| Apache-2.0 OR MPL-2.0 | 1 |  |  |
| BSD-3-Clause AND MIT |  | 1 |  |
| BSD-3-Clause OR MIT |  | 1 |  |
| CC-BY-4.0 AND MIT | 1 |  |  |
| MIT AND Zlib | 1 |  |  |
| MPL-2.0 |  | 1 |  |
| OFL-1.1 | 1 |  |  |

## Web viewer (npm)

| Package | Version | Licence |
| --- | --- | --- |
| [`@babel/runtime`](https://www.npmjs.com/package/@babel/runtime/v/7.29.7) | 7.29.7 | MIT |
| [`@bufbuild/protobuf`](https://www.npmjs.com/package/@bufbuild/protobuf/v/2.12.1) | 2.12.1 | Apache-2.0 AND BSD-3-Clause |
| [`@cesium/core`](https://www.npmjs.com/package/@cesium/core/v/0.1.1) | 0.1.1 | Apache-2.0 |
| [`@cesium/engine`](https://www.npmjs.com/package/@cesium/engine/v/26.5.0) | 26.5.0 | Apache-2.0 |
| [`@cesium/gltf`](https://www.npmjs.com/package/@cesium/gltf/v/0.1.1) | 0.1.1 | Apache-2.0 |
| [`@cesium/wasm-splats`](https://www.npmjs.com/package/@cesium/wasm-splats/v/0.1.0-alpha.2) | 0.1.0-alpha.2 | Apache-2.0 |
| [`@cesium/widgets`](https://www.npmjs.com/package/@cesium/widgets/v/16.3.1) | 16.3.1 | Apache-2.0 |
| [`@dimforge/rapier3d-compat`](https://www.npmjs.com/package/@dimforge/rapier3d-compat/v/0.12.0) | 0.12.0 | Apache-2.0 |
| [`@emotion/is-prop-valid`](https://www.npmjs.com/package/@emotion/is-prop-valid/v/1.4.0) | 1.4.0 | MIT |
| [`@emotion/memoize`](https://www.npmjs.com/package/@emotion/memoize/v/0.9.0) | 0.9.0 | MIT |
| [`@fontsource/manrope`](https://www.npmjs.com/package/@fontsource/manrope/v/5.3.0) | 5.3.0 | OFL-1.1 |
| [`@fortawesome/fontawesome-common-types`](https://www.npmjs.com/package/@fortawesome/fontawesome-common-types/v/6.6.0) | 6.6.0 | MIT |
| [`@fortawesome/fontawesome-svg-core`](https://www.npmjs.com/package/@fortawesome/fontawesome-svg-core/v/6.6.0) | 6.6.0 | MIT |
| [`@fortawesome/free-solid-svg-icons`](https://www.npmjs.com/package/@fortawesome/free-solid-svg-icons/v/6.6.0) | 6.6.0 | CC-BY-4.0 AND MIT |
| [`@fortawesome/react-fontawesome`](https://www.npmjs.com/package/@fortawesome/react-fontawesome/v/0.2.2) | 0.2.2 | MIT |
| [`@iwer/devui`](https://www.npmjs.com/package/@iwer/devui/v/1.1.2) | 1.1.2 | MIT |
| [`@iwer/sem`](https://www.npmjs.com/package/@iwer/sem/v/0.2.5) | 0.2.5 | MIT |
| [`@mapbox/point-geometry`](https://www.npmjs.com/package/@mapbox/point-geometry/v/1.1.0) | 1.1.0 | ISC |
| [`@mapbox/vector-tile`](https://www.npmjs.com/package/@mapbox/vector-tile/v/2.0.5) | 2.0.5 | BSD-3-Clause |
| [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.17) | 0.10.17 | Apache-2.0 |
| [`@monogrid/gainmap-js`](https://www.npmjs.com/package/@monogrid/gainmap-js/v/3.4.0) | 3.4.0 | MIT |
| [`@pmndrs/handle`](https://www.npmjs.com/package/@pmndrs/handle/v/6.6.30) | 6.6.30 | MIT (declared: SEE LICENSE IN LICENSE) |
| [`@pmndrs/pointer-events`](https://www.npmjs.com/package/@pmndrs/pointer-events/v/6.6.30) | 6.6.30 | MIT (declared: SEE LICENSE IN LICENSE) |
| [`@pmndrs/xr`](https://www.npmjs.com/package/@pmndrs/xr/v/6.6.30) | 6.6.30 | MIT (declared: SEE LICENSE IN LICENSE) |
| [`@react-spring/animated`](https://www.npmjs.com/package/@react-spring/animated/v/9.7.5) | 9.7.5 | MIT |
| [`@react-spring/core`](https://www.npmjs.com/package/@react-spring/core/v/9.7.5) | 9.7.5 | MIT |
| [`@react-spring/rafz`](https://www.npmjs.com/package/@react-spring/rafz/v/9.7.5) | 9.7.5 | MIT |
| [`@react-spring/shared`](https://www.npmjs.com/package/@react-spring/shared/v/9.7.5) | 9.7.5 | MIT |
| [`@react-spring/three`](https://www.npmjs.com/package/@react-spring/three/v/9.7.5) | 9.7.5 | MIT |
| [`@react-spring/types`](https://www.npmjs.com/package/@react-spring/types/v/9.7.5) | 9.7.5 | MIT |
| [`@react-three/drei`](https://www.npmjs.com/package/@react-three/drei/v/9.122.0) | 9.122.0 | MIT |
| [`@react-three/fiber`](https://www.npmjs.com/package/@react-three/fiber/v/8.18.0) | 8.18.0 | MIT |
| [`@react-three/xr`](https://www.npmjs.com/package/@react-three/xr/v/6.6.30) | 6.6.30 | MIT (declared: SEE LICENSE IN LICENSE) |
| [`@spz-loader/core`](https://www.npmjs.com/package/@spz-loader/core/v/0.3.1) | 0.3.1 | Apache-2.0 |
| [`@tweenjs/tween.js`](https://www.npmjs.com/package/@tweenjs/tween.js/v/23.1.3) | 23.1.3 | MIT |
| [`@tweenjs/tween.js`](https://www.npmjs.com/package/@tweenjs/tween.js/v/25.0.0) | 25.0.0 | MIT |
| [`@types/draco3d`](https://www.npmjs.com/package/@types/draco3d/v/1.4.10) | 1.4.10 | MIT |
| [`@types/geojson`](https://www.npmjs.com/package/@types/geojson/v/7946.0.16) | 7946.0.16 | MIT |
| [`@types/offscreencanvas`](https://www.npmjs.com/package/@types/offscreencanvas/v/2019.7.3) | 2019.7.3 | MIT |
| [`@types/prop-types`](https://www.npmjs.com/package/@types/prop-types/v/15.7.15) | 15.7.15 | MIT |
| [`@types/react`](https://www.npmjs.com/package/@types/react/v/18.3.31) | 18.3.31 | MIT |
| [`@types/react-reconciler`](https://www.npmjs.com/package/@types/react-reconciler/v/0.26.7) | 0.26.7 | MIT |
| [`@types/react-reconciler`](https://www.npmjs.com/package/@types/react-reconciler/v/0.28.9) | 0.28.9 | MIT |
| [`@types/stats.js`](https://www.npmjs.com/package/@types/stats.js/v/0.17.4) | 0.17.4 | MIT |
| [`@types/three`](https://www.npmjs.com/package/@types/three/v/0.183.1) | 0.183.1 | MIT |
| [`@types/trusted-types`](https://www.npmjs.com/package/@types/trusted-types/v/2.0.7) | 2.0.7 | MIT |
| [`@types/webxr`](https://www.npmjs.com/package/@types/webxr/v/0.5.24) | 0.5.24 | MIT |
| [`@use-gesture/core`](https://www.npmjs.com/package/@use-gesture/core/v/10.3.1) | 10.3.1 | MIT |
| [`@use-gesture/react`](https://www.npmjs.com/package/@use-gesture/react/v/10.3.1) | 10.3.1 | MIT |
| [`@webgpu/types`](https://www.npmjs.com/package/@webgpu/types/v/0.1.69) | 0.1.69 | BSD-3-Clause |
| [`@zip.js/zip.js`](https://www.npmjs.com/package/@zip.js/zip.js/v/2.25.0) | 2.25.0 | BSD-3-Clause |
| [`3d-tiles-renderer`](https://www.npmjs.com/package/3d-tiles-renderer/v/0.4.28) | 0.4.28 | Apache-2.0 |
| [`autolinker`](https://www.npmjs.com/package/autolinker/v/4.1.5) | 4.1.5 | MIT |
| [`base64-js`](https://www.npmjs.com/package/base64-js/v/1.5.1) | 1.5.1 | MIT |
| [`bidi-js`](https://www.npmjs.com/package/bidi-js/v/1.0.3) | 1.0.3 | MIT |
| [`bitmap-sdf`](https://www.npmjs.com/package/bitmap-sdf/v/1.0.4) | 1.0.4 | MIT |
| [`buffer`](https://www.npmjs.com/package/buffer/v/6.0.3) | 6.0.3 | MIT |
| [`camelize`](https://www.npmjs.com/package/camelize/v/1.0.1) | 1.0.1 | MIT |
| [`camera-controls`](https://www.npmjs.com/package/camera-controls/v/2.10.1) | 2.10.1 | MIT |
| [`case-anything`](https://www.npmjs.com/package/case-anything/v/2.1.13) | 2.1.13 | MIT |
| [`cesium`](https://www.npmjs.com/package/cesium/v/1.147.0) | 1.147.0 | Apache-2.0 |
| [`commander`](https://www.npmjs.com/package/commander/v/2.20.3) | 2.20.3 | MIT |
| [`cross-env`](https://www.npmjs.com/package/cross-env/v/7.0.3) | 7.0.3 | MIT |
| [`cross-spawn`](https://www.npmjs.com/package/cross-spawn/v/7.0.6) | 7.0.6 | MIT |
| [`css-color-keywords`](https://www.npmjs.com/package/css-color-keywords/v/1.0.0) | 1.0.0 | ISC |
| [`css-to-react-native`](https://www.npmjs.com/package/css-to-react-native/v/3.2.0) | 3.2.0 | MIT |
| [`csstype`](https://www.npmjs.com/package/csstype/v/3.2.3) | 3.2.3 | MIT |
| [`detect-gpu`](https://www.npmjs.com/package/detect-gpu/v/5.0.70) | 5.0.70 | MIT |
| [`detect-libc`](https://www.npmjs.com/package/detect-libc/v/1.0.3) | 1.0.3 | Apache-2.0 |
| [`dompurify`](https://www.npmjs.com/package/dompurify/v/3.4.17) | 3.4.17 | Apache-2.0 OR MPL-2.0 |
| [`dprint-node`](https://www.npmjs.com/package/dprint-node/v/1.0.8) | 1.0.8 | MIT |
| [`draco3d`](https://www.npmjs.com/package/draco3d/v/1.5.7) | 1.5.7 | Apache-2.0 |
| [`earcut`](https://www.npmjs.com/package/earcut/v/3.0.2) | 3.0.2 | ISC |
| [`fast-xml-parser`](https://www.npmjs.com/package/fast-xml-parser/v/4.5.7) | 4.5.7 | MIT |
| [`fflate`](https://www.npmjs.com/package/fflate/v/0.6.10) | 0.6.10 | MIT |
| [`fflate`](https://www.npmjs.com/package/fflate/v/0.8.2) | 0.8.2 | MIT |
| [`gl-matrix`](https://www.npmjs.com/package/gl-matrix/v/3.4.4) | 3.4.4 | MIT |
| [`glsl-noise`](https://www.npmjs.com/package/glsl-noise/v/0.0.0) | 0.0.0 | MIT |
| [`grapheme-splitter`](https://www.npmjs.com/package/grapheme-splitter/v/1.0.4) | 1.0.4 | MIT |
| [`hls.js`](https://www.npmjs.com/package/hls.js/v/1.6.16) | 1.6.16 | Apache-2.0 |
| [`ieee754`](https://www.npmjs.com/package/ieee754/v/1.2.1) | 1.2.1 | BSD-3-Clause |
| [`immediate`](https://www.npmjs.com/package/immediate/v/3.0.6) | 3.0.6 | MIT |
| [`is-promise`](https://www.npmjs.com/package/is-promise/v/2.2.2) | 2.2.2 | MIT |
| [`isexe`](https://www.npmjs.com/package/isexe/v/2.0.0) | 2.0.0 | ISC |
| [`its-fine`](https://www.npmjs.com/package/its-fine/v/1.2.5) | 1.2.5 | MIT |
| [`iwer`](https://www.npmjs.com/package/iwer/v/2.3.0) | 2.3.0 | MIT |
| [`js-tokens`](https://www.npmjs.com/package/js-tokens/v/4.0.0) | 4.0.0 | MIT |
| [`jsep`](https://www.npmjs.com/package/jsep/v/1.6.0) | 1.6.0 | MIT |
| [`kdbush`](https://www.npmjs.com/package/kdbush/v/4.1.0) | 4.1.0 | ISC |
| [`ktx-parse`](https://www.npmjs.com/package/ktx-parse/v/2.0.0) | 2.0.0 | MIT |
| [`lerc`](https://www.npmjs.com/package/lerc/v/2.0.0) | 2.0.0 | Apache-2.0 |
| [`lie`](https://www.npmjs.com/package/lie/v/3.3.0) | 3.3.0 | MIT |
| [`long`](https://www.npmjs.com/package/long/v/5.3.2) | 5.3.2 | Apache-2.0 |
| [`loose-envify`](https://www.npmjs.com/package/loose-envify/v/1.4.0) | 1.4.0 | MIT |
| [`maath`](https://www.npmjs.com/package/maath/v/0.10.8) | 0.10.8 | MIT |
| [`mersenne-twister`](https://www.npmjs.com/package/mersenne-twister/v/1.1.0) | 1.1.0 | MIT |
| [`meshline`](https://www.npmjs.com/package/meshline/v/3.3.1) | 3.3.1 | MIT |
| [`meshoptimizer`](https://www.npmjs.com/package/meshoptimizer/v/1.0.1) | 1.0.1 | MIT |
| [`meshoptimizer`](https://www.npmjs.com/package/meshoptimizer/v/1.3.0) | 1.3.0 | MIT |
| [`nosleep.js`](https://www.npmjs.com/package/nosleep.js/v/0.12.0) | 0.12.0 | MIT |
| [`object-assign`](https://www.npmjs.com/package/object-assign/v/4.1.1) | 4.1.1 | MIT |
| [`pako`](https://www.npmjs.com/package/pako/v/3.0.3) | 3.0.3 | MIT AND Zlib |
| [`path-key`](https://www.npmjs.com/package/path-key/v/3.1.1) | 3.1.1 | MIT |
| [`pbf`](https://www.npmjs.com/package/pbf/v/4.0.2) | 4.0.2 | BSD-3-Clause |
| [`pmtiles`](https://www.npmjs.com/package/pmtiles/v/4.5.0) | 4.5.0 | BSD-3-Clause |
| [`postcss-value-parser`](https://www.npmjs.com/package/postcss-value-parser/v/4.2.0) | 4.2.0 | MIT |
| [`potpack`](https://www.npmjs.com/package/potpack/v/1.0.2) | 1.0.2 | ISC |
| [`promise-worker-transferable`](https://www.npmjs.com/package/promise-worker-transferable/v/1.0.4) | 1.0.4 | Apache-2.0 |
| [`prop-types`](https://www.npmjs.com/package/prop-types/v/15.8.1) | 15.8.1 | MIT |
| [`protobufjs`](https://www.npmjs.com/package/protobufjs/v/8.8.1) | 8.8.1 | BSD-3-Clause |
| [`protocol-buffers-schema`](https://www.npmjs.com/package/protocol-buffers-schema/v/3.6.1) | 3.6.1 | MIT |
| [`quickselect`](https://www.npmjs.com/package/quickselect/v/3.0.0) | 3.0.0 | ISC |
| [`rbush`](https://www.npmjs.com/package/rbush/v/4.0.1) | 4.0.1 | MIT |
| [`react`](https://www.npmjs.com/package/react/v/18.3.1) | 18.3.1 | MIT |
| [`react-composer`](https://www.npmjs.com/package/react-composer/v/5.0.3) | 5.0.3 | MIT |
| [`react-dom`](https://www.npmjs.com/package/react-dom/v/18.3.1) | 18.3.1 | MIT |
| [`react-is`](https://www.npmjs.com/package/react-is/v/16.13.1) | 16.13.1 | MIT |
| [`react-reconciler`](https://www.npmjs.com/package/react-reconciler/v/0.27.0) | 0.27.0 | MIT |
| [`react-use-measure`](https://www.npmjs.com/package/react-use-measure/v/2.1.7) | 2.1.7 | MIT |
| [`require-from-string`](https://www.npmjs.com/package/require-from-string/v/2.0.2) | 2.0.2 | MIT |
| [`resium`](https://www.npmjs.com/package/resium/v/1.24.0) | 1.24.0 | MIT |
| [`resolve-protobuf-schema`](https://www.npmjs.com/package/resolve-protobuf-schema/v/2.1.0) | 2.1.0 | MIT |
| [`scheduler`](https://www.npmjs.com/package/scheduler/v/0.21.0) | 0.21.0 | MIT |
| [`scheduler`](https://www.npmjs.com/package/scheduler/v/0.23.2) | 0.23.2 | MIT |
| [`shebang-command`](https://www.npmjs.com/package/shebang-command/v/2.0.0) | 2.0.0 | MIT |
| [`shebang-regex`](https://www.npmjs.com/package/shebang-regex/v/3.0.0) | 3.0.0 | MIT |
| [`stats-gl`](https://www.npmjs.com/package/stats-gl/v/2.4.2) | 2.4.2 | MIT |
| [`stats.js`](https://www.npmjs.com/package/stats.js/v/0.17.0) | 0.17.0 | MIT |
| [`strnum`](https://www.npmjs.com/package/strnum/v/1.1.2) | 1.1.2 | MIT |
| [`styled-components`](https://www.npmjs.com/package/styled-components/v/6.4.4) | 6.4.4 | MIT |
| [`stylis`](https://www.npmjs.com/package/stylis/v/4.3.6) | 4.3.6 | MIT |
| [`suspend-react`](https://www.npmjs.com/package/suspend-react/v/0.1.3) | 0.1.3 | MIT |
| [`three`](https://www.npmjs.com/package/three/v/0.165.0) | 0.165.0 | MIT |
| [`three`](https://www.npmjs.com/package/three/v/0.170.0) | 0.170.0 | MIT |
| [`three`](https://www.npmjs.com/package/three/v/0.183.2) | 0.183.2 | MIT |
| [`three-mesh-bvh`](https://www.npmjs.com/package/three-mesh-bvh/v/0.7.8) | 0.7.8 | MIT |
| [`three-stdlib`](https://www.npmjs.com/package/three-stdlib/v/2.36.1) | 2.36.1 | MIT |
| [`topojson-client`](https://www.npmjs.com/package/topojson-client/v/3.1.0) | 3.1.0 | ISC |
| [`troika-three-text`](https://www.npmjs.com/package/troika-three-text/v/0.52.4) | 0.52.4 | MIT |
| [`troika-three-utils`](https://www.npmjs.com/package/troika-three-utils/v/0.52.4) | 0.52.4 | MIT |
| [`troika-worker-utils`](https://www.npmjs.com/package/troika-worker-utils/v/0.52.0) | 0.52.0 | MIT |
| [`ts-poet`](https://www.npmjs.com/package/ts-poet/v/6.12.0) | 6.12.0 | Apache-2.0 |
| [`ts-proto`](https://www.npmjs.com/package/ts-proto/v/2.12.0) | 2.12.0 | ISC |
| [`ts-proto-descriptors`](https://www.npmjs.com/package/ts-proto-descriptors/v/2.1.0) | 2.1.0 | ISC |
| [`tslib`](https://www.npmjs.com/package/tslib/v/2.8.1) | 2.8.1 | 0BSD |
| [`tunnel-rat`](https://www.npmjs.com/package/tunnel-rat/v/0.1.2) | 0.1.2 | MIT |
| [`urijs`](https://www.npmjs.com/package/urijs/v/1.19.11) | 1.19.11 | MIT |
| [`use-sync-external-store`](https://www.npmjs.com/package/use-sync-external-store/v/1.6.0) | 1.6.0 | MIT |
| [`utility-types`](https://www.npmjs.com/package/utility-types/v/3.11.0) | 3.11.0 | MIT |
| [`webgl-constants`](https://www.npmjs.com/package/webgl-constants/v/1.1.1) | 1.1.1 | MIT (declared: (none)) |
| [`webgl-sdf-generator`](https://www.npmjs.com/package/webgl-sdf-generator/v/1.1.1) | 1.1.1 | MIT |
| [`webxr-layers-polyfill`](https://www.npmjs.com/package/webxr-layers-polyfill/v/1.1.0) | 1.1.0 | Apache-2.0 |
| [`which`](https://www.npmjs.com/package/which/v/2.0.2) | 2.0.2 | ISC |
| [`zod`](https://www.npmjs.com/package/zod/v/3.25.76) | 3.25.76 | MIT |
| [`zustand`](https://www.npmjs.com/package/zustand/v/3.7.2) | 3.7.2 | MIT |
| [`zustand`](https://www.npmjs.com/package/zustand/v/4.5.7) | 4.5.7 | MIT |
| [`zustand`](https://www.npmjs.com/package/zustand/v/5.0.14) | 5.0.14 | MIT |

## Desktop (Rust crates)

| Crate | Version | Licence | Platforms |
| --- | --- | --- | --- |
| [`adler2`](https://crates.io/crates/adler2/2.0.1) | 2.0.1 | 0BSD OR Apache-2.0 OR MIT | macos |
| [`aho-corasick`](https://crates.io/crates/aho-corasick/1.1.5) | 1.1.5 | MIT OR Unlicense | all |
| [`alloc-no-stdlib`](https://crates.io/crates/alloc-no-stdlib/3.0.0) | 3.0.0 | BSD-3-Clause | all |
| [`alloc-stdlib`](https://crates.io/crates/alloc-stdlib/0.3.0) | 0.3.0 | BSD-3-Clause | all |
| [`anyhow`](https://crates.io/crates/anyhow/1.0.104) | 1.0.104 | Apache-2.0 OR MIT | all |
| [`async-broadcast`](https://crates.io/crates/async-broadcast/0.7.2) | 0.7.2 | Apache-2.0 OR MIT | linux |
| [`async-channel`](https://crates.io/crates/async-channel/2.5.0) | 2.5.0 | Apache-2.0 OR MIT | linux |
| [`async-executor`](https://crates.io/crates/async-executor/1.14.1) | 1.14.1 | Apache-2.0 OR MIT | linux |
| [`async-io`](https://crates.io/crates/async-io/2.6.0) | 2.6.0 | Apache-2.0 OR MIT | linux |
| [`async-lock`](https://crates.io/crates/async-lock/3.5.0) | 3.5.0 | Apache-2.0 OR MIT | linux |
| [`async-process`](https://crates.io/crates/async-process/2.5.0) | 2.5.0 | Apache-2.0 OR MIT | linux |
| [`async-signal`](https://crates.io/crates/async-signal/0.2.14) | 0.2.14 | Apache-2.0 OR MIT | linux |
| [`async-task`](https://crates.io/crates/async-task/4.7.1) | 4.7.1 | Apache-2.0 OR MIT | linux |
| [`atk`](https://crates.io/crates/atk/0.18.2) | 0.18.2 | MIT | linux |
| [`atk-sys`](https://crates.io/crates/atk-sys/0.18.2) | 0.18.2 | MIT | linux |
| [`atomic-waker`](https://crates.io/crates/atomic-waker/1.1.2) | 1.1.2 | Apache-2.0 OR MIT | linux |
| [`base64`](https://crates.io/crates/base64/0.23.1) | 0.23.1 | Apache-2.0 OR MIT | all |
| [`bitflags`](https://crates.io/crates/bitflags/1.3.2) | 1.3.2 | Apache-2.0 OR MIT | linux |
| [`bitflags`](https://crates.io/crates/bitflags/2.13.2) | 2.13.2 | Apache-2.0 OR MIT | all |
| [`block2`](https://crates.io/crates/block2/0.6.2) | 0.6.2 | MIT | macos |
| [`blocking`](https://crates.io/crates/blocking/1.7.0) | 1.7.0 | Apache-2.0 OR MIT | linux |
| [`brotli`](https://crates.io/crates/brotli/9.1.1) | 9.1.1 | BSD-3-Clause AND MIT | all |
| [`brotli-decompressor`](https://crates.io/crates/brotli-decompressor/6.2.0) | 6.2.0 | BSD-3-Clause OR MIT | all |
| [`bytes`](https://crates.io/crates/bytes/1.12.1) | 1.12.1 | MIT | all |
| [`cairo-rs`](https://crates.io/crates/cairo-rs/0.18.5) | 0.18.5 | MIT | linux |
| [`cairo-sys-rs`](https://crates.io/crates/cairo-sys-rs/0.18.2) | 0.18.2 | MIT | linux |
| [`cfb`](https://crates.io/crates/cfb/0.14.0) | 0.14.0 | MIT | all |
| [`cfg-if`](https://crates.io/crates/cfg-if/1.0.5) | 1.0.5 | Apache-2.0 OR MIT | all |
| [`concurrent-queue`](https://crates.io/crates/concurrent-queue/2.5.0) | 2.5.0 | Apache-2.0 OR MIT | linux |
| [`cookie`](https://crates.io/crates/cookie/0.18.2) | 0.18.2 | Apache-2.0 OR MIT | all |
| [`core-foundation`](https://crates.io/crates/core-foundation/0.10.1) | 0.10.1 | Apache-2.0 OR MIT | macos |
| [`core-foundation-sys`](https://crates.io/crates/core-foundation-sys/0.8.7) | 0.8.7 | Apache-2.0 OR MIT | macos |
| [`core-graphics`](https://crates.io/crates/core-graphics/0.25.0) | 0.25.0 | Apache-2.0 OR MIT | macos |
| [`core-graphics-types`](https://crates.io/crates/core-graphics-types/0.2.0) | 0.2.0 | Apache-2.0 OR MIT | macos |
| [`crc32fast`](https://crates.io/crates/crc32fast/1.5.4) | 1.5.4 | Apache-2.0 OR MIT | macos |
| [`crossbeam-channel`](https://crates.io/crates/crossbeam-channel/0.5.17) | 0.5.17 | Apache-2.0 OR MIT | all |
| [`crossbeam-utils`](https://crates.io/crates/crossbeam-utils/0.8.23) | 0.8.23 | Apache-2.0 OR MIT | all |
| [`ctor`](https://crates.io/crates/ctor/1.0.13) | 1.0.13 | Apache-2.0 OR MIT | all |
| [`dbus`](https://crates.io/crates/dbus/0.9.12) | 0.9.12 | Apache-2.0 OR MIT | linux |
| [`deranged`](https://crates.io/crates/deranged/0.5.9) | 0.5.9 | Apache-2.0 OR MIT | all |
| [`dirs`](https://crates.io/crates/dirs/7.0.0) | 7.0.0 | Apache-2.0 OR MIT | all |
| [`dirs-sys`](https://crates.io/crates/dirs-sys/0.5.0) | 0.5.0 | Apache-2.0 OR MIT | all |
| [`dispatch2`](https://crates.io/crates/dispatch2/0.3.1) | 0.3.1 | Apache-2.0 OR MIT OR Zlib | macos |
| [`dlopen2`](https://crates.io/crates/dlopen2/0.8.2) | 0.8.2 | MIT | linux |
| [`dpi`](https://crates.io/crates/dpi/0.1.2) | 0.1.2 | Apache-2.0 AND MIT | all |
| [`dunce`](https://crates.io/crates/dunce/1.0.5) | 1.0.5 | Apache-2.0 OR CC0-1.0 OR MIT-0 | all |
| [`embed_plist`](https://crates.io/crates/embed_plist/1.2.2) | 1.2.2 | Apache-2.0 OR MIT | macos |
| [`endi`](https://crates.io/crates/endi/1.1.1) | 1.1.1 | MIT | linux |
| [`enumflags2`](https://crates.io/crates/enumflags2/0.7.12) | 0.7.12 | Apache-2.0 OR MIT | linux |
| [`equivalent`](https://crates.io/crates/equivalent/1.0.3) | 1.0.3 | Apache-2.0 OR MIT | all |
| [`erased-serde`](https://crates.io/crates/erased-serde/0.4.11) | 0.4.11 | Apache-2.0 OR MIT | all |
| [`errno`](https://crates.io/crates/errno/0.3.15) | 0.3.15 | Apache-2.0 OR MIT | linux |
| [`event-listener`](https://crates.io/crates/event-listener/5.4.2) | 5.4.2 | Apache-2.0 OR MIT | linux |
| [`event-listener-strategy`](https://crates.io/crates/event-listener-strategy/0.5.4) | 0.5.4 | Apache-2.0 OR MIT | linux |
| [`fastrand`](https://crates.io/crates/fastrand/2.5.0) | 2.5.0 | Apache-2.0 OR MIT | linux |
| [`fdeflate`](https://crates.io/crates/fdeflate/0.3.7) | 0.3.7 | Apache-2.0 OR MIT | macos |
| [`field-offset`](https://crates.io/crates/field-offset/0.3.6) | 0.3.6 | Apache-2.0 OR MIT | linux |
| [`flate2`](https://crates.io/crates/flate2/1.1.10) | 1.1.10 | Apache-2.0 OR MIT | macos |
| [`fnv`](https://crates.io/crates/fnv/1.0.7) | 1.0.7 | Apache-2.0 OR MIT | all |
| [`foreign-types`](https://crates.io/crates/foreign-types/0.5.0) | 0.5.0 | Apache-2.0 OR MIT | macos |
| [`foreign-types-shared`](https://crates.io/crates/foreign-types-shared/0.3.1) | 0.3.1 | Apache-2.0 OR MIT | macos |
| [`form_urlencoded`](https://crates.io/crates/form_urlencoded/1.2.2) | 1.2.2 | Apache-2.0 OR MIT | all |
| [`futures-channel`](https://crates.io/crates/futures-channel/0.3.34) | 0.3.34 | Apache-2.0 OR MIT | linux |
| [`futures-core`](https://crates.io/crates/futures-core/0.3.34) | 0.3.34 | Apache-2.0 OR MIT | linux |
| [`futures-executor`](https://crates.io/crates/futures-executor/0.3.34) | 0.3.34 | Apache-2.0 OR MIT | linux |
| [`futures-io`](https://crates.io/crates/futures-io/0.3.34) | 0.3.34 | Apache-2.0 OR MIT | linux |
| [`futures-lite`](https://crates.io/crates/futures-lite/2.6.1) | 2.6.1 | Apache-2.0 OR MIT | linux |
| [`futures-task`](https://crates.io/crates/futures-task/0.3.34) | 0.3.34 | Apache-2.0 OR MIT | linux |
| [`futures-util`](https://crates.io/crates/futures-util/0.3.34) | 0.3.34 | Apache-2.0 OR MIT | linux |
| [`gdk`](https://crates.io/crates/gdk/0.18.2) | 0.18.2 | MIT | linux |
| [`gdk-pixbuf`](https://crates.io/crates/gdk-pixbuf/0.18.5) | 0.18.5 | MIT | linux |
| [`gdk-pixbuf-sys`](https://crates.io/crates/gdk-pixbuf-sys/0.18.0) | 0.18.0 | MIT | linux |
| [`gdk-sys`](https://crates.io/crates/gdk-sys/0.18.2) | 0.18.2 | MIT | linux |
| [`gdkwayland-sys`](https://crates.io/crates/gdkwayland-sys/0.18.2) | 0.18.2 | MIT | linux |
| [`gdkx11`](https://crates.io/crates/gdkx11/0.18.2) | 0.18.2 | MIT | linux |
| [`gdkx11-sys`](https://crates.io/crates/gdkx11-sys/0.18.2) | 0.18.2 | MIT | linux |
| [`getrandom`](https://crates.io/crates/getrandom/0.3.4) | 0.3.4 | Apache-2.0 OR MIT | all |
| [`gio`](https://crates.io/crates/gio/0.18.4) | 0.18.4 | MIT | linux |
| [`gio-sys`](https://crates.io/crates/gio-sys/0.18.1) | 0.18.1 | MIT | linux |
| [`glib`](https://crates.io/crates/glib/0.18.5) | 0.18.5 | MIT | linux |
| [`glib-sys`](https://crates.io/crates/glib-sys/0.18.1) | 0.18.1 | MIT | linux |
| [`glob`](https://crates.io/crates/glob/0.3.4) | 0.3.4 | Apache-2.0 OR MIT | all |
| [`gobject-sys`](https://crates.io/crates/gobject-sys/0.18.0) | 0.18.0 | MIT | linux |
| [`gtk`](https://crates.io/crates/gtk/0.18.2) | 0.18.2 | MIT | linux |
| [`gtk-sys`](https://crates.io/crates/gtk-sys/0.18.2) | 0.18.2 | MIT | linux |
| [`hashbrown`](https://crates.io/crates/hashbrown/0.17.1) | 0.17.1 | Apache-2.0 OR MIT | all |
| [`heck`](https://crates.io/crates/heck/0.5.0) | 0.5.0 | Apache-2.0 OR MIT | all |
| [`hex`](https://crates.io/crates/hex/0.4.3) | 0.4.3 | Apache-2.0 OR MIT | linux |
| [`http`](https://crates.io/crates/http/1.5.0) | 1.5.0 | Apache-2.0 OR MIT | all |
| [`icu_collections`](https://crates.io/crates/icu_collections/2.4.0) | 2.4.0 | Unicode-3.0 | all |
| [`icu_locale_core`](https://crates.io/crates/icu_locale_core/2.4.0) | 2.4.0 | Unicode-3.0 | all |
| [`icu_normalizer`](https://crates.io/crates/icu_normalizer/2.4.0) | 2.4.0 | Unicode-3.0 | all |
| [`icu_normalizer_data`](https://crates.io/crates/icu_normalizer_data/2.4.0) | 2.4.0 | Unicode-3.0 | all |
| [`icu_properties`](https://crates.io/crates/icu_properties/2.4.0) | 2.4.0 | Unicode-3.0 | all |
| [`icu_properties_data`](https://crates.io/crates/icu_properties_data/2.4.0) | 2.4.0 | Unicode-3.0 | all |
| [`icu_provider`](https://crates.io/crates/icu_provider/2.4.0) | 2.4.0 | Unicode-3.0 | all |
| [`idna`](https://crates.io/crates/idna/1.1.0) | 1.1.0 | Apache-2.0 OR MIT | all |
| [`idna_adapter`](https://crates.io/crates/idna_adapter/1.2.2) | 1.2.2 | Apache-2.0 OR MIT | all |
| [`indexmap`](https://crates.io/crates/indexmap/2.14.2) | 2.14.2 | Apache-2.0 OR MIT | all |
| [`infer`](https://crates.io/crates/infer/0.22.0) | 0.22.0 | MIT | all |
| [`is-docker`](https://crates.io/crates/is-docker/0.2.0) | 0.2.0 | MIT | linux |
| [`is-wsl`](https://crates.io/crates/is-wsl/0.4.0) | 0.4.0 | MIT | linux |
| [`itoa`](https://crates.io/crates/itoa/1.0.18) | 1.0.18 | Apache-2.0 OR MIT | all |
| [`javascriptcore-rs`](https://crates.io/crates/javascriptcore-rs/1.1.2) | 1.1.2 | MIT | linux |
| [`javascriptcore-rs-sys`](https://crates.io/crates/javascriptcore-rs-sys/1.1.1) | 1.1.1 | MIT | linux |
| [`json-patch`](https://crates.io/crates/json-patch/4.2.0) | 4.2.0 | Apache-2.0 OR MIT | all |
| [`jsonptr`](https://crates.io/crates/jsonptr/0.7.1) | 0.7.1 | Apache-2.0 OR MIT | all |
| [`keyboard-types`](https://crates.io/crates/keyboard-types/0.8.3) | 0.8.3 | Apache-2.0 OR MIT | all |
| [`libc`](https://crates.io/crates/libc/0.2.191) | 0.2.191 | Apache-2.0 OR MIT | all |
| [`libdbus-sys`](https://crates.io/crates/libdbus-sys/0.2.7) | 0.2.7 | Apache-2.0 OR MIT | linux |
| [`linux-raw-sys`](https://crates.io/crates/linux-raw-sys/0.12.1) | 0.12.1 | Apache-2.0 OR Apache-2.0 WITH LLVM-exception OR MIT | linux |
| [`litemap`](https://crates.io/crates/litemap/0.8.3) | 0.8.3 | Unicode-3.0 | all |
| [`lock_api`](https://crates.io/crates/lock_api/0.4.14) | 0.4.14 | Apache-2.0 OR MIT | linux, windows |
| [`log`](https://crates.io/crates/log/0.4.35) | 0.4.35 | Apache-2.0 OR MIT | all |
| [`memchr`](https://crates.io/crates/memchr/2.8.3) | 2.8.3 | MIT OR Unlicense | all |
| [`memoffset`](https://crates.io/crates/memoffset/0.9.1) | 0.9.1 | MIT | linux |
| [`mime`](https://crates.io/crates/mime/0.3.17) | 0.3.17 | Apache-2.0 OR MIT | all |
| [`miniz_oxide`](https://crates.io/crates/miniz_oxide/0.8.9) | 0.8.9 | Apache-2.0 OR MIT OR Zlib | macos |
| [`miniz_oxide`](https://crates.io/crates/miniz_oxide/0.9.1) | 0.9.1 | Apache-2.0 OR MIT OR Zlib | macos |
| [`muda`](https://crates.io/crates/muda/0.20.0) | 0.20.0 | Apache-2.0 OR MIT | all |
| [`num-conv`](https://crates.io/crates/num-conv/0.2.2) | 0.2.2 | Apache-2.0 OR MIT | all |
| [`objc2`](https://crates.io/crates/objc2/0.6.5) | 0.6.5 | MIT | macos |
| [`objc2-app-kit`](https://crates.io/crates/objc2-app-kit/0.3.2) | 0.3.2 | Apache-2.0 OR MIT OR Zlib | macos |
| [`objc2-core-foundation`](https://crates.io/crates/objc2-core-foundation/0.3.2) | 0.3.2 | Apache-2.0 OR MIT OR Zlib | macos |
| [`objc2-encode`](https://crates.io/crates/objc2-encode/4.1.0) | 4.1.0 | MIT | macos |
| [`objc2-exception-helper`](https://crates.io/crates/objc2-exception-helper/0.1.1) | 0.1.1 | Apache-2.0 OR MIT OR Zlib | macos |
| [`objc2-foundation`](https://crates.io/crates/objc2-foundation/0.3.2) | 0.3.2 | MIT | macos |
| [`objc2-quartz-core`](https://crates.io/crates/objc2-quartz-core/0.3.2) | 0.3.2 | Apache-2.0 OR MIT OR Zlib | macos |
| [`objc2-web-kit`](https://crates.io/crates/objc2-web-kit/0.3.2) | 0.3.2 | Apache-2.0 OR MIT OR Zlib | macos |
| [`once_cell`](https://crates.io/crates/once_cell/1.21.4) | 1.21.4 | Apache-2.0 OR MIT | all |
| [`open`](https://crates.io/crates/open/5.4.5) | 5.4.5 | MIT | all |
| [`option-ext`](https://crates.io/crates/option-ext/0.2.0) | 0.2.0 | MPL-2.0 | all |
| [`ordered-stream`](https://crates.io/crates/ordered-stream/0.2.0) | 0.2.0 | Apache-2.0 OR MIT | linux |
| [`pango`](https://crates.io/crates/pango/0.18.3) | 0.18.3 | MIT | linux |
| [`pango-sys`](https://crates.io/crates/pango-sys/0.18.0) | 0.18.0 | MIT | linux |
| [`parking`](https://crates.io/crates/parking/2.2.1) | 2.2.1 | Apache-2.0 OR MIT | linux |
| [`parking_lot`](https://crates.io/crates/parking_lot/0.12.5) | 0.12.5 | Apache-2.0 OR MIT | linux, windows |
| [`parking_lot_core`](https://crates.io/crates/parking_lot_core/0.9.12) | 0.9.12 | Apache-2.0 OR MIT | linux, windows |
| [`percent-encoding`](https://crates.io/crates/percent-encoding/2.3.2) | 2.3.2 | Apache-2.0 OR MIT | all |
| [`phf`](https://crates.io/crates/phf/0.13.1) | 0.13.1 | MIT | all |
| [`phf_shared`](https://crates.io/crates/phf_shared/0.13.1) | 0.13.1 | MIT | all |
| [`pin-project-lite`](https://crates.io/crates/pin-project-lite/0.2.17) | 0.2.17 | Apache-2.0 OR MIT | all |
| [`piper`](https://crates.io/crates/piper/0.2.5) | 0.2.5 | Apache-2.0 OR MIT | linux |
| [`plist`](https://crates.io/crates/plist/1.10.3) | 1.10.3 | MIT | all |
| [`png`](https://crates.io/crates/png/0.18.1) | 0.18.1 | Apache-2.0 OR MIT | macos |
| [`polling`](https://crates.io/crates/polling/3.11.0) | 3.11.0 | Apache-2.0 OR MIT | linux |
| [`potential_utf`](https://crates.io/crates/potential_utf/0.1.6) | 0.1.6 | Unicode-3.0 | all |
| [`powerfmt`](https://crates.io/crates/powerfmt/0.2.1) | 0.2.1 | Apache-2.0 OR MIT | all |
| [`proc-macro2`](https://crates.io/crates/proc-macro2/1.0.107) | 1.0.107 | Apache-2.0 OR MIT | linux |
| [`quick-xml`](https://crates.io/crates/quick-xml/0.42.0) | 0.42.0 | MIT | all |
| [`quote`](https://crates.io/crates/quote/1.0.47) | 1.0.47 | Apache-2.0 OR MIT | linux |
| [`raw-window-handle`](https://crates.io/crates/raw-window-handle/0.6.2) | 0.6.2 | Apache-2.0 OR MIT OR Zlib | all |
| [`regex`](https://crates.io/crates/regex/1.13.1) | 1.13.1 | Apache-2.0 OR MIT | all |
| [`regex-automata`](https://crates.io/crates/regex-automata/0.4.18) | 0.4.18 | Apache-2.0 OR MIT | all |
| [`regex-syntax`](https://crates.io/crates/regex-syntax/0.8.11) | 0.8.11 | Apache-2.0 OR MIT | all |
| [`rustix`](https://crates.io/crates/rustix/1.1.6) | 1.1.6 | Apache-2.0 OR Apache-2.0 WITH LLVM-exception OR MIT | linux |
| [`same-file`](https://crates.io/crates/same-file/1.0.6) | 1.0.6 | MIT OR Unlicense | all |
| [`scopeguard`](https://crates.io/crates/scopeguard/1.2.0) | 1.2.0 | Apache-2.0 OR MIT | linux, windows |
| [`semver`](https://crates.io/crates/semver/1.0.28) | 1.0.28 | Apache-2.0 OR MIT | all |
| [`serde`](https://crates.io/crates/serde/1.0.229) | 1.0.229 | Apache-2.0 OR MIT | all |
| [`serde_core`](https://crates.io/crates/serde_core/1.0.229) | 1.0.229 | Apache-2.0 OR MIT | all |
| [`serde_json`](https://crates.io/crates/serde_json/1.0.154) | 1.0.154 | Apache-2.0 OR MIT | all |
| [`serde_spanned`](https://crates.io/crates/serde_spanned/1.1.2) | 1.1.2 | Apache-2.0 OR MIT | all |
| [`serde_with`](https://crates.io/crates/serde_with/3.24.0) | 3.24.0 | Apache-2.0 OR MIT | all |
| [`serde-untagged`](https://crates.io/crates/serde-untagged/0.1.9) | 0.1.9 | Apache-2.0 OR MIT | all |
| [`serialize-to-javascript`](https://crates.io/crates/serialize-to-javascript/0.1.2) | 0.1.2 | Apache-2.0 OR MIT | all |
| [`signal-hook-registry`](https://crates.io/crates/signal-hook-registry/1.4.8) | 1.4.8 | Apache-2.0 OR MIT | linux |
| [`simd-adler32`](https://crates.io/crates/simd-adler32/0.3.10) | 0.3.10 | MIT | macos |
| [`siphasher`](https://crates.io/crates/siphasher/1.0.4) | 1.0.4 | Apache-2.0 OR MIT | all |
| [`slab`](https://crates.io/crates/slab/0.4.12) | 0.4.12 | MIT | linux |
| [`smallvec`](https://crates.io/crates/smallvec/1.16.4) | 1.16.4 | Apache-2.0 OR MIT | all |
| [`softbuffer`](https://crates.io/crates/softbuffer/0.4.8) | 0.4.8 | Apache-2.0 OR MIT | windows |
| [`soup3`](https://crates.io/crates/soup3/0.5.0) | 0.5.0 | MIT | linux |
| [`soup3-sys`](https://crates.io/crates/soup3-sys/0.5.0) | 0.5.0 | MIT | linux |
| [`stable_deref_trait`](https://crates.io/crates/stable_deref_trait/1.2.1) | 1.2.1 | Apache-2.0 OR MIT | all |
| [`syn`](https://crates.io/crates/syn/3.0.9) | 3.0.9 | Apache-2.0 OR MIT | linux |
| [`tao`](https://crates.io/crates/tao/0.37.2) | 0.37.2 | Apache-2.0 | all |
| [`tauri`](https://crates.io/crates/tauri/2.12.5) | 2.12.5 | Apache-2.0 OR MIT | all |
| [`tauri-plugin-opener`](https://crates.io/crates/tauri-plugin-opener/2.7.3) | 2.7.3 | Apache-2.0 OR MIT | all |
| [`tauri-runtime`](https://crates.io/crates/tauri-runtime/2.12.2) | 2.12.2 | Apache-2.0 OR MIT | all |
| [`tauri-runtime-wry`](https://crates.io/crates/tauri-runtime-wry/2.12.3) | 2.12.3 | Apache-2.0 OR MIT | all |
| [`tauri-utils`](https://crates.io/crates/tauri-utils/2.10.2) | 2.10.2 | Apache-2.0 OR MIT | all |
| [`thiserror`](https://crates.io/crates/thiserror/1.0.69) | 1.0.69 | Apache-2.0 OR MIT | linux |
| [`thiserror`](https://crates.io/crates/thiserror/2.0.21) | 2.0.21 | Apache-2.0 OR MIT | all |
| [`time`](https://crates.io/crates/time/0.3.55) | 0.3.55 | Apache-2.0 OR MIT | all |
| [`time-core`](https://crates.io/crates/time-core/0.1.9) | 0.1.9 | Apache-2.0 OR MIT | all |
| [`tinystr`](https://crates.io/crates/tinystr/0.8.5) | 0.8.5 | Unicode-3.0 | all |
| [`tokio`](https://crates.io/crates/tokio/1.54.1) | 1.54.1 | MIT | all |
| [`toml`](https://crates.io/crates/toml/1.1.8+spec-1.1.0) | 1.1.8+spec-1.1.0 | Apache-2.0 OR MIT | all |
| [`toml_datetime`](https://crates.io/crates/toml_datetime/1.1.2+spec-1.1.0) | 1.1.2+spec-1.1.0 | Apache-2.0 OR MIT | all |
| [`toml_parser`](https://crates.io/crates/toml_parser/1.1.5+spec-1.1.0) | 1.1.5+spec-1.1.0 | Apache-2.0 OR MIT | all |
| [`toml_writer`](https://crates.io/crates/toml_writer/1.1.3+spec-1.1.0) | 1.1.3+spec-1.1.0 | Apache-2.0 OR MIT | all |
| [`tracing`](https://crates.io/crates/tracing/0.1.44) | 0.1.44 | MIT | linux, windows |
| [`tracing-core`](https://crates.io/crates/tracing-core/0.1.36) | 0.1.36 | MIT | linux, windows |
| [`typeid`](https://crates.io/crates/typeid/1.0.3) | 1.0.3 | Apache-2.0 OR MIT | all |
| [`unicode-ident`](https://crates.io/crates/unicode-ident/1.0.27) | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 | linux |
| [`unicode-segmentation`](https://crates.io/crates/unicode-segmentation/1.13.3) | 1.13.3 | Apache-2.0 OR MIT | windows |
| [`url`](https://crates.io/crates/url/2.5.8) | 2.5.8 | Apache-2.0 OR MIT | all |
| [`urlpattern`](https://crates.io/crates/urlpattern/0.6.0) | 0.6.0 | MIT | all |
| [`utf_types`](https://crates.io/crates/utf_types/1.0.0) | 1.0.0 | Apache-2.0 OR MIT | all |
| [`utf8_iter`](https://crates.io/crates/utf8_iter/1.1.0) | 1.1.0 | Apache-2.0 OR MIT | all |
| [`uuid`](https://crates.io/crates/uuid/1.29.0) | 1.29.0 | Apache-2.0 OR MIT | all |
| [`walkdir`](https://crates.io/crates/walkdir/2.5.0) | 2.5.0 | MIT OR Unlicense | all |
| [`web-time`](https://crates.io/crates/web-time/1.1.0) | 1.1.0 | Apache-2.0 OR MIT | all |
| [`webkit2gtk`](https://crates.io/crates/webkit2gtk/2.0.2) | 2.0.2 | MIT | linux |
| [`webkit2gtk-sys`](https://crates.io/crates/webkit2gtk-sys/2.0.2) | 2.0.2 | MIT | linux |
| [`webview2-com`](https://crates.io/crates/webview2-com/0.39.1) | 0.39.1 | MIT | windows |
| [`webview2-com-sys`](https://crates.io/crates/webview2-com-sys/0.39.1) | 0.39.1 | MIT; links the Microsoft WebView2 loader (WebView2LoaderStatic.lib): WebView2 SDK licence (BSD-3-Clause style) | windows |
| [`winapi-util`](https://crates.io/crates/winapi-util/0.1.11) | 0.1.11 | MIT OR Unlicense | windows |
| [`window-vibrancy`](https://crates.io/crates/window-vibrancy/0.8.1) | 0.8.1 | Apache-2.0 OR MIT | macos, windows |
| [`windows`](https://crates.io/crates/windows/0.62.2) | 0.62.2 | Apache-2.0 OR MIT | windows |
| [`windows-collections`](https://crates.io/crates/windows-collections/0.3.2) | 0.3.2 | Apache-2.0 OR MIT | windows |
| [`windows-core`](https://crates.io/crates/windows-core/0.62.2) | 0.62.2 | Apache-2.0 OR MIT | windows |
| [`windows-future`](https://crates.io/crates/windows-future/0.3.2) | 0.3.2 | Apache-2.0 OR MIT | windows |
| [`windows-link`](https://crates.io/crates/windows-link/0.2.1) | 0.2.1 | Apache-2.0 OR MIT | windows |
| [`windows-numerics`](https://crates.io/crates/windows-numerics/0.3.1) | 0.3.1 | Apache-2.0 OR MIT | windows |
| [`windows-result`](https://crates.io/crates/windows-result/0.4.1) | 0.4.1 | Apache-2.0 OR MIT | windows |
| [`windows-strings`](https://crates.io/crates/windows-strings/0.5.1) | 0.5.1 | Apache-2.0 OR MIT | windows |
| [`windows-sys`](https://crates.io/crates/windows-sys/0.61.2) | 0.61.2 | Apache-2.0 OR MIT | windows |
| [`windows-threading`](https://crates.io/crates/windows-threading/0.2.1) | 0.2.1 | Apache-2.0 OR MIT | windows |
| [`windows-version`](https://crates.io/crates/windows-version/0.1.7) | 0.1.7 | Apache-2.0 OR MIT | windows |
| [`winnow`](https://crates.io/crates/winnow/1.0.4) | 1.0.4 | MIT | all |
| [`writeable`](https://crates.io/crates/writeable/0.6.4) | 0.6.4 | Unicode-3.0 | all |
| [`wry`](https://crates.io/crates/wry/0.57.1) | 0.57.1 | Apache-2.0 OR MIT | all |
| [`x11`](https://crates.io/crates/x11/2.21.0) | 2.21.0 | MIT | linux |
| [`x11-dl`](https://crates.io/crates/x11-dl/2.21.0) | 2.21.0 | MIT | linux |
| [`yoke`](https://crates.io/crates/yoke/0.8.4) | 0.8.4 | Unicode-3.0 | all |
| [`zbus`](https://crates.io/crates/zbus/5.19.0) | 5.19.0 | MIT | linux |
| [`zbus_names`](https://crates.io/crates/zbus_names/4.3.5) | 4.3.5 | MIT | linux |
| [`zcheapstr`](https://crates.io/crates/zcheapstr/1.2.0) | 1.2.0 | MIT | linux |
| [`zerofrom`](https://crates.io/crates/zerofrom/0.1.8) | 0.1.8 | Unicode-3.0 | all |
| [`zerotrie`](https://crates.io/crates/zerotrie/0.2.5) | 0.2.5 | Unicode-3.0 | all |
| [`zerovec`](https://crates.io/crates/zerovec/0.11.9) | 0.11.9 | Unicode-3.0 | all |
| [`zmij`](https://crates.io/crates/zmij/1.0.23) | 1.0.23 | MIT | all |
| [`zvariant`](https://crates.io/crates/zvariant/5.15.1) | 5.15.1 | MIT | linux |
| [`zvariant_utils`](https://crates.io/crates/zvariant_utils/4.2.0) | 4.2.0 | MIT | linux |

## Android

### Capacitor shell (npm)

| Package | Version | Licence |
| --- | --- | --- |
| [`@capacitor/android`](https://www.npmjs.com/package/@capacitor/android/v/8.6.0) | 8.6.0 | MIT |
| [`@capacitor/core`](https://www.npmjs.com/package/@capacitor/core/v/8.6.0) | 8.6.0 | MIT |
| [`@capacitor/geolocation`](https://www.npmjs.com/package/@capacitor/geolocation/v/8.2.4) | 8.2.4 | MIT |
| [`@capacitor/local-notifications`](https://www.npmjs.com/package/@capacitor/local-notifications/v/8.3.1) | 8.3.1 | MIT |
| [`@capacitor/splash-screen`](https://www.npmjs.com/package/@capacitor/splash-screen/v/8.0.2) | 8.0.2 | MIT |
| [`@capacitor/status-bar`](https://www.npmjs.com/package/@capacitor/status-bar/v/8.0.4) | 8.0.4 | MIT |
| [`@capacitor/synapse`](https://www.npmjs.com/package/@capacitor/synapse/v/1.0.4) | 1.0.4 | ISC |
| [`capacitor-secure-storage-plugin`](https://www.npmjs.com/package/capacitor-secure-storage-plugin/v/0.13.0) | 0.13.0 | MIT |
| [`tslib`](https://www.npmjs.com/package/tslib/v/2.9.1) | 2.9.1 | 0BSD |

### Android libraries (Maven)

| Library | Version | Licence |
| --- | --- | --- |
| [`androidx.activity:activity`](https://developer.android.com/jetpack/androidx) | 1.11.0 | Apache-2.0 |
| [`androidx.activity:activity-ktx`](https://developer.android.com/jetpack/androidx) | 1.11.0 | Apache-2.0 |
| [`androidx.annotation:annotation`](https://developer.android.com/jetpack/androidx) | 1.8.1 | Apache-2.0 |
| [`androidx.annotation:annotation-experimental`](https://developer.android.com/jetpack/androidx) | 1.4.1 | Apache-2.0 |
| [`androidx.annotation:annotation-jvm`](https://developer.android.com/jetpack/androidx) | 1.8.1 | Apache-2.0 |
| [`androidx.appcompat:appcompat`](https://developer.android.com/jetpack/androidx) | 1.7.1 | Apache-2.0 |
| [`androidx.appcompat:appcompat-resources`](https://developer.android.com/jetpack/androidx) | 1.7.1 | Apache-2.0 |
| [`androidx.arch.core:core-common`](https://developer.android.com/jetpack/androidx) | 2.2.0 | Apache-2.0 |
| [`androidx.arch.core:core-runtime`](https://developer.android.com/jetpack/androidx) | 2.2.0 | Apache-2.0 |
| [`androidx.collection:collection`](https://developer.android.com/jetpack/androidx) | 1.4.2 | Apache-2.0 |
| [`androidx.collection:collection-jvm`](https://developer.android.com/jetpack/androidx) | 1.4.2 | Apache-2.0 |
| [`androidx.concurrent:concurrent-futures`](https://developer.android.com/jetpack/androidx) | 1.1.0 | Apache-2.0 |
| [`androidx.coordinatorlayout:coordinatorlayout`](https://developer.android.com/jetpack/androidx) | 1.3.0 | Apache-2.0 |
| [`androidx.core:core`](https://developer.android.com/jetpack/androidx) | 1.17.0 | Apache-2.0 |
| [`androidx.core:core-ktx`](https://developer.android.com/jetpack/androidx) | 1.17.0 | Apache-2.0 |
| [`androidx.core:core-splashscreen`](https://developer.android.com/jetpack/androidx) | 1.2.0 | Apache-2.0 |
| [`androidx.core:core-viewtree`](https://developer.android.com/jetpack/androidx) | 1.0.0 | Apache-2.0 |
| [`androidx.cursoradapter:cursoradapter`](https://developer.android.com/jetpack/androidx) | 1.0.0 | Apache-2.0 |
| [`androidx.customview:customview`](https://developer.android.com/jetpack/androidx) | 1.0.0 | Apache-2.0 |
| [`androidx.drawerlayout:drawerlayout`](https://developer.android.com/jetpack/androidx) | 1.0.0 | Apache-2.0 |
| [`androidx.emoji2:emoji2`](https://developer.android.com/jetpack/androidx) | 1.3.0 | Apache-2.0 |
| [`androidx.emoji2:emoji2-views-helper`](https://developer.android.com/jetpack/androidx) | 1.3.0 | Apache-2.0 |
| [`androidx.fragment:fragment`](https://developer.android.com/jetpack/androidx) | 1.8.9 | Apache-2.0 |
| [`androidx.interpolator:interpolator`](https://developer.android.com/jetpack/androidx) | 1.0.0 | Apache-2.0 |
| [`androidx.lifecycle:lifecycle-common`](https://developer.android.com/jetpack/androidx) | 2.6.2 | Apache-2.0 |
| [`androidx.lifecycle:lifecycle-livedata`](https://developer.android.com/jetpack/androidx) | 2.6.2 | Apache-2.0 |
| [`androidx.lifecycle:lifecycle-livedata-core`](https://developer.android.com/jetpack/androidx) | 2.6.2 | Apache-2.0 |
| [`androidx.lifecycle:lifecycle-process`](https://developer.android.com/jetpack/androidx) | 2.6.2 | Apache-2.0 |
| [`androidx.lifecycle:lifecycle-runtime`](https://developer.android.com/jetpack/androidx) | 2.6.2 | Apache-2.0 |
| [`androidx.lifecycle:lifecycle-runtime-ktx`](https://developer.android.com/jetpack/androidx) | 2.6.2 | Apache-2.0 |
| [`androidx.lifecycle:lifecycle-viewmodel`](https://developer.android.com/jetpack/androidx) | 2.6.2 | Apache-2.0 |
| [`androidx.lifecycle:lifecycle-viewmodel-ktx`](https://developer.android.com/jetpack/androidx) | 2.6.2 | Apache-2.0 |
| [`androidx.lifecycle:lifecycle-viewmodel-savedstate`](https://developer.android.com/jetpack/androidx) | 2.6.2 | Apache-2.0 |
| [`androidx.loader:loader`](https://developer.android.com/jetpack/androidx) | 1.0.0 | Apache-2.0 |
| [`androidx.profileinstaller:profileinstaller`](https://developer.android.com/jetpack/androidx) | 1.4.0 | Apache-2.0 |
| [`androidx.resourceinspection:resourceinspection-annotation`](https://developer.android.com/jetpack/androidx) | 1.0.1 | Apache-2.0 |
| [`androidx.savedstate:savedstate`](https://developer.android.com/jetpack/androidx) | 1.2.1 | Apache-2.0 |
| [`androidx.savedstate:savedstate-ktx`](https://developer.android.com/jetpack/androidx) | 1.2.1 | Apache-2.0 |
| [`androidx.startup:startup-runtime`](https://developer.android.com/jetpack/androidx) | 1.1.1 | Apache-2.0 |
| [`androidx.tracing:tracing`](https://developer.android.com/jetpack/androidx) | 1.2.0 | Apache-2.0 |
| [`androidx.vectordrawable:vectordrawable`](https://developer.android.com/jetpack/androidx) | 1.1.0 | Apache-2.0 |
| [`androidx.vectordrawable:vectordrawable-animated`](https://developer.android.com/jetpack/androidx) | 1.1.0 | Apache-2.0 |
| [`androidx.versionedparcelable:versionedparcelable`](https://developer.android.com/jetpack/androidx) | 1.1.1 | Apache-2.0 |
| [`androidx.viewpager:viewpager`](https://developer.android.com/jetpack/androidx) | 1.0.0 | Apache-2.0 |
| [`androidx.webkit:webkit`](https://developer.android.com/jetpack/androidx) | 1.14.0 | Apache-2.0 |
| [`com.google.android.gms:play-services-base`](https://developer.android.com/studio/terms) | 18.5.0 | Android SDK License |
| [`com.google.android.gms:play-services-basement`](https://developer.android.com/studio/terms) | 18.4.0 | Android SDK License |
| [`com.google.android.gms:play-services-location`](https://developer.android.com/studio/terms) | 21.3.0 | Android SDK License |
| [`com.google.android.gms:play-services-tasks`](https://developer.android.com/studio/terms) | 18.2.0 | Android SDK License |
| [`com.google.code.gson:gson`](https://github.com/google/gson) | 2.13.2 | Apache-2.0 |
| [`com.google.errorprone:error_prone_annotations`](https://github.com/google/error-prone) | 2.41.0 | Apache-2.0 |
| [`com.google.guava:listenablefuture`](https://github.com/google/guava) | 1.0 | Apache-2.0 |
| [`io.ionic.libs:iongeolocation-android`](https://github.com/ionic-team/ion-android-geolocation) | 2.2.2 | MIT |
| [`org.apache.cordova:framework`](https://cordova.apache.org) | 14.0.1 | Apache-2.0 |
| [`org.jetbrains:annotations`](https://github.com/JetBrains/java-annotations) | 23.0.0 | Apache-2.0 |
| [`org.jetbrains.kotlin:kotlin-stdlib`](https://kotlinlang.org) | 2.2.20 | Apache-2.0 |
| [`org.jetbrains.kotlinx:kotlinx-coroutines-android`](https://github.com/Kotlin) | 1.10.2 | Apache-2.0 |
| [`org.jetbrains.kotlinx:kotlinx-coroutines-bom`](https://github.com/Kotlin) | 1.10.2 | Apache-2.0 |
| [`org.jetbrains.kotlinx:kotlinx-coroutines-core`](https://github.com/Kotlin) | 1.10.2 | Apache-2.0 |
| [`org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm`](https://github.com/Kotlin) | 1.10.2 | Apache-2.0 |
| [`org.jetbrains.kotlinx:kotlinx-coroutines-play-services`](https://github.com/Kotlin) | 1.10.2 | Apache-2.0 |
| [`org.jspecify:jspecify`](https://jspecify.dev) | 1.0.0 | Apache-2.0 |

---

_Generated by [`scripts/third-party-notices.mjs`](scripts/third-party-notices.mjs) (web: 157 npm packages, desktop: 236 crates, android: 9 npm packages, android: 62 Android libraries). Regenerate it rather than editing it: after `npm install` at the root and in viewer-react/mobile and `npx cap sync android`, run `node scripts/third-party-notices.mjs --scope web,desktop,android --gradle viewer-react/mobile/android --docs`._
