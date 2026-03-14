Here is a technical Game Design Document (GDD) tailored for a high-performance, open-data WebXR application that captures the scale of Earth VR while introducing spatial scrapbooking.

# Technical Game Design Document: WebXR World (Working Title)

## 1. Executive Summary

**Concept:** A web-native, immersive globe-exploration application. Users can fly over 3D topological and architectural map data at "god-scale" or human scale, utilizing WebXR to drop pins, create photo albums, and build persistent spatial memory collages tethered to real-world coordinates.
**Core Pillars:**

* **Frictionless Access:** Zero-install, browser-based execution relying entirely on WebXR.
* **Open Ecosystem:** Exclusively utilizing free, libre, and open map data pipelines.
* **Spatial Memory:** Transforming the globe from a static map into a collaborative or personal life-logging canvas via scrapbooking collections.

## 2. Target Platforms & Performance

Because maps and WebGL are notoriously difficult to optimize due to massive draw calls and memory management, the architecture must heavily leverage Level of Detail (LOD) and dynamic streaming.

* **Primary Hardware Targets:** High-end standalone headsets (Meta Quest 3) and advanced spatial computers (Apple Vision Pro) via compatible WebXR browsers (Meta Quest Browser, Safari for visionOS).
* **Performance Budget:** 72Hz–90Hz minimum refresh rate.
* **Polygon Budget:** < 1.5 million visible triangles per frame (aggressive frustum culling required).

## 3. Technology Stack Architecture

To achieve high-performance WebXR while handling the complexities of planetary-scale coordinates, the following stack is recommended:

### 3.1 3D Engine & Geospatial Rendering

* **Rendering Framework:** **Babylon.js** or **CesiumJS**.
* *Approach A (Cesium-First):* Use **CesiumJS** directly, as it is the industry standard for the 3D Tiles (OGC) specification. It natively handles the WGS84 ellipsoid, massive coordinate precision (64-bit float workarounds in WebGL), and streaming of global terrain. WebXR support would require a custom camera rig implementation layered over the Cesium viewer.
* *Approach B (Babylon-First):* Use **Babylon.js** for its unparalleled, native WebXR support and interaction toolkits. Utilize Babylon's recent support for loading **3D Tiles** directly to stream cityscapes and terrain.


* **Recommendation:** Babylon.js driving the WebXR lifecycle, paired with a customized 3D Tiles loader streaming optimized glTF fragments to ensure smooth frame rates in standalone headsets.

### 3.2 Data Pipelines

* **Map & POI Data:** **Overture Maps Foundation** (an open data scheme merging OSM, Meta, and Microsoft data) for building footprints, roads, and places.
* **Terrain/Elevation:** **OpenTopography** or AWS Open Data terrain tiles.
* **Building Meshes:** Procedural generation of buildings based on OSM/Overture footprints, or utilizing openly licensed 3D city models (e.g., OpenStreetMap 3D).

## 4. Core Systems

### 4.1 Locomotion and "God-Scale" Manipulation

The iconic "Earth VR" feel relies on intuitive, physics-based grab-and-drag mechanics.

* **World Dragging:** The user grabs the empty space; the movement of the controllers translates to a rotation of the parent globe node, giving the illusion of dragging the earth.
* **Dynamic Scaling:** Squeezing the grip buttons scales the user's camera rig relative to the globe. At high altitudes, the user moves kilometers per second. As they zoom in, movement speed algorithmically decreases to allow for human-scale walking/flying.
* **Precision Math:** Because standard 32-bit WebGL floats jitter at planetary distances, the application must use floating origin techniques (Moving the world around a stationary camera, rather than moving the camera around a static WGS84 globe) or implement Relative-to-Center (RTC) rendering.

### 4.2 The Scrapbooking System (Spatial Memory)

This system elevates the app from a map to a personal canvas. Users upload 2D images, 360 photos, or spatial videos, tethering them to GPS coordinates.

* **Data Structure:** A localized or decentralized database (e.g., IndexedDB for local-first, or IPFS/gun.js for decentralized sharing) stores `ScrapbookNode` JSON objects containing `[Lat, Long, Alt, MediaURL, Timestamp, Orientation]`.
* **Visual Representation:** * *Distant View:* Heatmaps or glowing pillars indicating clusters of personal memories.
* *Local View:* Floating geometric frames that the user can grab, scale, and arrange.


* **Memory Collections:** Users can string together geographical nodes into "Journeys" (e.g., "AWE to GDC 2024"), allowing the camera to automatically fly along a spline curve between scrapbook memories.

## 5. Technical Challenges & Mitigations

### 5.1 The WebGL Memory Bottleneck

Streaming 3D tiles for map data rapidly consumes VRAM, leading to catastrophic browser crashes on standalone headsets.

* **Mitigation:** Implement strict memory pooling. Instead of creating and destroying meshes (which triggers expensive garbage collection pauses in V8/JavaScript), instantiate a fixed pool of glTF meshes. When a map tile leaves the frustum, its mesh data is overwritten by incoming tile data rather than destroyed.

### 5.2 Floating Point Jitter

Rendering a 1-meter scrapbook photo on a 6,371 km radius planet causes severe vertex shaking in WebGL.

* **Mitigation:**  Implement a floating origin. The WebXR camera remains at `[0,0,0]`. When the user "moves," the entire globe and all scrapbook nodes are translated in the opposite direction.

### 5.3 Asynchronous Asset Loading

WebXR sessions must maintain frame rate; synchronous texture decoding will drop frames and cause motion sickness.

* **Mitigation:** Utilize Web Workers for decoding incoming Overture/OSM data and converting it to render-ready arrays before passing it back to the main thread. Use `createImageBitmap` for off-thread image decoding of the user's scrapbook photos.