# Architectural Product Plan for 'Companion Atlas': WebXR, WebGPU, and Planetary-Scale Open-Source Ecosystems

> Historical planning doc, retained for its engine/rendering research. Superseded
> as product direction by [`REIMAGINE.md`](REIMAGINE.md), which recommends
> CesiumJS over the three.js/WebXR path outlined below. The product was renamed
> from "Companion Earth" to "Companion Atlas" during that reimagining.

The conceptualization and execution of 'Companion Atlas' represent a formidable convergence of spatial computing, geographic information systems (GIS), and high-performance web graphics. As a cross-platform, planetary-scale immersive application, its architecture must reconcile the extreme computational demands of rendering a 1:1 scale Earth with the strict latency and framerate requirements of immersive headsets such as the Meta Quest 3, alongside graceful fallbacks for mobile and desktop browser environments. The strategic mandate of this product plan is to define a comprehensive technical blueprint explicitly optimized for an autonomous AI coding agent. This agent will be responsible for orchestrating the application's infrastructure, developing custom shading logic, and managing real-time geospatial data pipelines entirely within an open-source software (OSS) ecosystem.

Designing a technology stack for an AI coding agent requires a fundamental shift in architectural priorities. Traditional 3D graphics development relies heavily on string-based shader languages (GLSL) and imperative, highly coupled object-oriented hierarchies. These paradigms introduce significant hallucination vectors and syntax error rates during Large Language Model (LLM) code generation. To maximize the AI agent's velocity, determinism, and debugging capabilities, the architecture must prioritize declarative frameworks, strongly typed APIs, Entity-Component-System (ECS) data structures, and node-based shading languages.

This document provides an exhaustive, peer-level analysis of the necessary open-source technologies required to build 'Companion Atlas'. The report systematically evaluates and recommends the core 3D rendering engine by comparing Three.js, Babylon.js, and CesiumJS. It details the complex mathematical solutions required for planetary-scale rendering via WebGPU, including floating origin implementations and atmospheric scattering. Furthermore, it outlines a robust cross-platform WebXR interaction model utilizing the Immersive Web SDK (IWSDK), formulates a strategy for streaming OGC 3D Tiles, and architects a highly scalable, serverless backend utilizing free mapping data from the Overture Maps Foundation and the United States Geological Survey (USGS). By adhering to this blueprint, the AI coding agent can autonomously construct, test, and deploy a seamless spatial computing experience.


## Comparative Analysis of Core Open-Source Rendering Engines

The foundational layer of the 'Companion Atlas' architecture relies on the selection of an open-source WebGL and WebGPU rendering engine. This engine must support massive geospatial datasets, handle immersive WebXR sessions seamlessly, and provide a programmatic interface that aligns with the code-generation strengths of an AI agent. The ecosystem is currently dominated by three primary frameworks: Three.js, Babylon.js, and CesiumJS. Each represents a divergent philosophy regarding library modularity, engine scalability, and domain specificity.


## Architectural Philosophies and Engine Capabilities

The selection process requires evaluating how each engine manages the inherent complexities of rendering geometry exceeding 500MB, their respective paths toward WebGPU adoption, and their out-of-the-box support for virtual reality contexts.


<table>
  <tr>
   <td><strong>Feature Domain</strong>
   </td>
   <td><strong>Three.js</strong>
   </td>
   <td><strong>Babylon.js</strong>
   </td>
   <td><strong>CesiumJS</strong>
   </td>
  </tr>
  <tr>
   <td><strong>Core Architecture</strong>
   </td>
   <td>A lightweight, highly decentralized 3D rendering library. Provides a scene graph, cameras, and materials, but relies on third-party modules for physics, ECS, and UI.<sup>1</sup>
   </td>
   <td>A monolithic, "batteries-included" game engine. Ships with built-in physics (Havok), collision detection, audio, and GUI systems directly out of the box.<sup>1</sup>
   </td>
   <td>A highly specialized 3D geospatial visualization platform. Engineered specifically for precise WGS84 globes and streaming massive remote sensing datasets.<sup>2</sup>
   </td>
  </tr>
  <tr>
   <td><strong>WebGPU Readiness</strong>
   </td>
   <td>Implements a robust WebGPURenderer and introduces the Three.js Shading Language (TSL) for declarative, node-based shader construction.<sup>3</sup>
   </td>
   <td>Features strong WebGPU readiness with a seamless initialization upgrade path and an integrated visual Node Material Editor.<sup>1</sup>
   </td>
   <td>WebGPU support remains an exploratory roadmap objective, currently limiting the platform to WebGL graphics pipelines.<sup>6</sup>
   </td>
  </tr>
  <tr>
   <td><strong>WebXR Integration</strong>
   </td>
   <td>Requires manual configuration via the WebXR Manager. Often necessitates building a custom architectural layer or relying on wrappers for complex VR logic.<sup>7</sup>
   </td>
   <td>Treats WebXR as a first-class citizen. Includes helper scenes, straightforward AR/VR setup, and native support for advanced features like multiview rendering.<sup>7</sup>
   </td>
   <td>Nascent and experimental. Pull requests for initial WebXR display support exist, but VR is primarily delegated to native game engine integrations (Unreal/Unity).<sup>10</sup>
   </td>
  </tr>
  <tr>
   <td><strong>Planetary Scale Data</strong>
   </td>
   <td>Delegates OGC 3D Tiles and massive coordinate systems to third-party community libraries (e.g., NASA-AMMOS).<sup>11</sup>
   </td>
   <td>Utilizes third-party loaders for 3D Tiles but natively includes engine-level flags like useLargeWorldRendering for 64-bit precision management.<sup>12</sup>
   </td>
   <td>The industry standard for planetary data. Features best-in-class, native implementation of 3D Tiles and heterogeneous data streaming.<sup>13</sup>
   </td>
  </tr>
  <tr>
   <td><strong>AI Agent Suitability</strong>
   </td>
   <td>Exceptionally high. TSL allows shaders to be written in native JS/TS, drastically reducing LLM hallucinations associated with raw GLSL string manipulation.<sup>14</sup>
   </td>
   <td>Very high. The highly opinionated, structured API reduces ambiguity during code generation, though the bundle size is larger.<sup>15</sup>
   </td>
   <td>Moderate. While unparalleled for pure GIS tasks, its rigid structure makes building highly custom, game-like immersive interactions difficult.<sup>16</sup>
   </td>
  </tr>
</table>


The analysis of these engines reveals a critical architectural paradox for the 'Companion Atlas' project. CesiumJS is unequivocally the most powerful tool for rendering a mathematically precise globe and streaming massive 3D photogrammetry.<sup>2</sup> However, its lack of native WebXR support and its delayed adoption of WebGPU fundamental disqualifies it as the primary rendering layer for a next-generation, high-performance Meta Quest 3 application.<sup>6</sup>

Babylon.js offers higher engine-level scalability and faster production workflows due to its integrated tooling and native WebXR integration.<sup>8</sup> Its useLargeWorldRendering flag provides an immediate solution to floating-point precision errors at planetary scales.<sup>12</sup> However, Babylon.js requires a heavier initial bundle load and utilizes a highly opinionated architecture that can sometimes restrict custom rendering pipelines.<sup>1</sup>

Conversely, Three.js struggles with very large, monolithic models due to the single-threaded nature of JavaScript and standard browser memory limits.<sup>17</sup> Yet, when combined with WebGPU, Three.js excels at managing models exceeding 500MB through direct GPU memory control, parallel processing, and compute shaders.<sup>17</sup> Most importantly for an AI coding agent, Three.js has introduced the Three.js Shading Language (TSL).<sup>4</sup> TSL represents a paradigm shift; it abstracts both WGSL and GLSL into a unified JavaScript/TypeScript syntax.<sup>14</sup> This allows the AI agent to compose complex rendering logic using standard JavaScript operators and variables without manipulating error-prone shader strings. Given the AI agent's proficiency with modular JavaScript and the unparalleled size of the Three.js community plugin ecosystem, **Three.js** is the recommended foundational engine, provided it is augmented with specific modular libraries to handle WebXR and 3D Tiles.


## Planetary-Scale Rendering Mathematics and WebGPU Paradigms

Simulating a 1:1 scale Earth in a real-time web environment immediately encounters severe mathematical and hardware limitations. The AI coding agent must be explicitly programmed to construct architectural workarounds for these constraints, leveraging the low-level compute capabilities of the WebGPU API.


## Mitigating Spatial Jitter via Floating Origins

Standard graphics pipelines utilize 32-bit floating-point numbers (Float32) to track vertex positions. A Float32 value can reliably represent approximately 7 significant decimal digits.<sup>12</sup> In a planetary context, where Earth's radius is roughly 

<p id="gdcalert1" ><span style="color: red; font-weight: bold">>>>>>  gd2md-html alert: inline image link here (to images/image1.png). Store image on your image server and adjust path/filename/extension if necessary. </span><br>(<a href="#">Back to top</a>)(<a href="#gdcalert2">Next alert</a>)<br><span style="color: red; font-weight: bold">>>>>> </span></p>


![alt_text](images/image1.png "image_tooltip")
 meters, placing the planet at the world origin 

<p id="gdcalert2" ><span style="color: red; font-weight: bold">>>>>>  gd2md-html alert: inline image link here (to images/image2.png). Store image on your image server and adjust path/filename/extension if necessary. </span><br>(<a href="#">Back to top</a>)(<a href="#gdcalert3">Next alert</a>)<br><span style="color: red; font-weight: bold">>>>>> </span></p>


![alt_text](images/image2.png "image_tooltip")
 and moving the camera to the surface forces the GPU to calculate micro-movements using massive base numbers.<sup>19</sup> At a distance of 1,000,000 units from the origin, the smallest representable increment degrades to roughly 0.06 units.<sup>12</sup> This loss of precision causes catastrophic spatial jitter, Z-fighting (polygon flickering), and severe geometry wobbling, even when objects are entirely stationary.<sup>12</sup>

To resolve this precision degradation, the AI agent must implement a floating origin architecture. Instead of moving the camera through a static, massive coordinate system, the engine maintains the camera at or near the absolute origin 

<p id="gdcalert3" ><span style="color: red; font-weight: bold">>>>>>  gd2md-html alert: inline image link here (to images/image3.png). Store image on your image server and adjust path/filename/extension if necessary. </span><br>(<a href="#">Back to top</a>)(<a href="#gdcalert4">Next alert</a>)<br><span style="color: red; font-weight: bold">>>>>> </span></p>


![alt_text](images/image3.png "image_tooltip")
.<sup>19</sup> As the user traverses the environment, the application calculates the inverse velocity vector and translates the entire world—including the planetary mesh, 3D tiles, and atmospheric bounding spheres—in the opposite direction.<sup>21</sup>

The agent can achieve this using two primary methodologies within the WebGPU pipeline:



1. **Relative-To-Center (RTC):** Defining a local origin for individual mesh chunks (or 3D tiles) and storing vertex positions relative to that specific local center.<sup>20</sup>
2. **Relative-To-Eye (RTE):** Splitting each high-precision 64-bit vertex coordinate into two 32-bit floating-point values (High and Low).<sup>20</sup> The AI agent will utilize TSL to author a custom vertex shader node that intercepts the Model-View-Projection (MVP) matrix. The shader will compute the vertex positions relative to the camera directly on the GPU, seamlessly bypassing the Float32 bottleneck without requiring expensive CPU-side matrix recalculations every frame.<sup>20</sup>


## Advanced Frustum Culling and Logarithmic Depth

Rendering millions of polygons across a planetary surface demands aggressive occlusion and frustum culling. Standard frustum culling in Three.js operates on the CPU, iterating through the bounding sphere of every object in the scene graph to determine visibility.<sup>23</sup> At planetary scales, especially when dealing with high-density instanced meshes (e.g., global forests or city-scale building footprints), iterating through tens of thousands of bounding boxes on the single-threaded JavaScript CPU becomes a critical bottleneck.<sup>17</sup>

The migration to WebGPU provides the AI agent with the ability to implement Compute Shader-driven Frustum Culling.<sup>25</sup> The agent will develop a parallel compute pipeline that evaluates bounding boxes against the camera frustum entirely on the GPU. Instead of the CPU deciding what to draw, the compute shader dynamically packs the indices of visible instances into an indirect draw buffer.<sup>26</sup> This allows the WebGPURenderer to execute a single, massive draw call for millions of objects, dramatically reducing driver overhead and CPU latency.<sup>26</sup>

Furthermore, to combat severe Z-fighting at extreme render distances (e.g., distinguishing between a mountain peak and the cloud layer behind it from orbital altitudes), the WebGPURenderer must be explicitly initialized to utilize a logarithmic depth buffer.<sup>28</sup> This mathematical technique redistributes depth precision logarithmically, allocating a significantly higher density of depth values to geometry immediately in front of the camera, while preserving sufficient precision to sort distant macro-structures accurately.<sup>28</sup>


## Implementing Preetham Atmospheric Scattering via TSL

A static texture map applied to a spherical geometry is insufficient for a high-fidelity 'Companion Atlas' experience. To achieve photorealism, the AI agent must implement a volumetric atmospheric scattering model based on the rigorously defined Preetham and Nishita physical equations.<sup>29</sup>

The atmosphere is modeled not as a solid boundary, but as a dense volume of particles that absorb, reflect, and scatter light based on the optical depth of the viewing ray. The agent's implementation must account for two primary physical phenomena:



1. **Rayleigh Scattering:** This models the interaction of light with microscopic air molecules. The scattering is highly dependent on the wavelength of the light, specifically inversely proportional to the fourth power of the wavelength (

<p id="gdcalert4" ><span style="color: red; font-weight: bold">>>>>>  gd2md-html alert: inline image link here (to images/image4.png). Store image on your image server and adjust path/filename/extension if necessary. </span><br>(<a href="#">Back to top</a>)(<a href="#gdcalert5">Next alert</a>)<br><span style="color: red; font-weight: bold">>>>>> </span></p>


![alt_text](images/image4.png "image_tooltip")
).<sup>31</sup> This mathematical reality is what causes the blue appearance of the sky during midday and the deep red hues during sunrise and sunset, as the light must traverse a vastly thicker slice of the atmosphere.<sup>32</sup>
2. **Mie Scattering:** This models how light interacts with larger atmospheric aerosols, such as dust, water vapor, and pollution. Mie scattering is largely independent of wavelength and scatters light predominantly in the forward direction, creating the intense, white anisotropic glare visible directly around the sun.<sup>31</sup>

Historically in WebGL, calculating the integral of optical depth along a ray path for every fragment was too computationally expensive for real-time framerates, forcing developers to rely on precomputed 2D lookup tables (LUTs).<sup>30</sup> However, utilizing the WebGPU backend and the Three.js Shading Language (TSL), the AI agent can leverage parallel compute architectures to calculate these scattering equations dynamically.<sup>4</sup>

The AI agent will author a highly modular TSL node network that injects atmospheric density functions directly into the planetary material's fragment stage.<sup>34</sup> By defining uniforms for rayleigh, mieCoefficient, mieDirectionalG, and sunPosition, the agent enables dynamic time-of-day transitions and seamless ground-to-orbit camera flights.<sup>35</sup> Because TSL compiles down to highly optimized WGSL, this volumetric effect can be rendered continuously without dropping below the strict framerate requirements of immersive headsets.<sup>4</sup>


## Dynamic Weather Systems via Compute Shaders

To further enhance the realism of the digital twin, the AI agent can implement global weather patterns utilizing WebGPU compute shaders. Rendering massive, irregular weather datasets (e.g., ECMWF forecast data containing millions of points) directly on the CPU would instantly crash the browser thread.<sup>36</sup>

Instead, the agent will architect a multi-pass GPU pipeline. Irregular grid data is mapped via binary search in a WGSL compute pass. The compute shader executes a marching squares algorithm to extract isobar contours and utilizes Chaikin subdivision for curve smoothing through ping-pong buffers.<sup>36</sup> For wind visualization, the agent will deploy tens of thousands of particle lines seeded uniformly across a Fibonacci sphere.<sup>36</sup> To keep the particles bound to the spherical surface without expensive reprojections, the shader will utilize the Rodrigues rotation formula, tracing geodesic movement seamlessly across the globe.<sup>36</sup> This entire weather pipeline executes within sub-3 millisecond frame times, leaving ample processing headroom for XR tracking.<sup>36</sup>


## Cross-Platform WebXR Architecture: Mobile, Desktop, and Meta Quest 3

Delivering 'Companion Atlas' across mobile touchscreens, desktop mouse/keyboard configurations, and 6DoF (Degrees of Freedom) immersive headsets like the Meta Quest 3 requires a highly decoupled interaction architecture. The application must process high-frequency input data and render stereoscopic displays without bottlenecking the main WebGPU rendering thread.


## The Immersive Web SDK (IWSDK) Integration

To bridge the substantial gap between the low-level rendering capabilities of Three.js and the complex interaction state requirements of WebXR, the AI agent will utilize the Immersive Web SDK (IWSDK). Open-sourced by Meta and released in late 2024, IWSDK is an enterprise-grade toolkit designed specifically for building AI-native WebXR experiences on top of Three.js.<sup>37</sup>

IWSDK introduces a high-performance Entity-Component-System (ECS) architecture powered by ELICS.<sup>38</sup> This represents a vital architectural choice for an AI coding agent. By leveraging an ECS, the AI agent can mutate the application state declaratively. For example, rather than writing complex, deeply nested object-oriented inheritance classes to handle physics, the agent simply adds a LocomotionEnvironment component to a newly streamed 3D terrain tile.<sup>40</sup> This single line of code instantly registers the mesh within the physics engine, rendering it walkable and collidable.<sup>40</sup>

Furthermore, IWSDK includes an integrated AI-assisted development workflow (referred to as "Vibe Coding").<sup>38</sup> This natively allows AI agents to inspect the live scene graph, simulate controller input, and debug the ECS state in real-time within a browser-based WebXR emulator (IWER), vastly accelerating the development cycle by removing the need to constantly compile and test on physical headset hardware.<sup>38</sup>


## Planetary Locomotion and Multimodal Input

Navigating a planetary-scale environment requires translating standard human-scale WebXR movements (such as teleportation arcs and sliding) into macro-scale geographic navigation. The AI agent will implement the @iwsdk/locomotor module, which utilizes a specialized, lightweight physics engine optimized for XR.<sup>41</sup> Rather than deploying a full, expensive rigid-body physics solver, the locomotor utilizes Bounding Volume Hierarchy (BVH) shapecasts against triangle meshes.<sup>41</sup> This approach provides fast, robust collision detection that avoids complex contact-solving overhead.<sup>41</sup>

To maintain the strict 72–120 Hz refresh rates required by the Meta Quest 3 to prevent user motion sickness, the AI agent must configure the locomotion engine to operate in **Worker Mode**.<sup>41</sup> This offloads the locomotion engine into a dedicated Web Worker running at a fixed update rate (e.g., 60 Hz). The worker calculates grounded motion, gravity, and parabolic ray hits, posting highly compact transformation arrays back to the main thread, where they are smoothly interpolated.<sup>41</sup> This architecture strictly isolates physics computations from render spikes, ensuring frame stability even when the scene is congested with dense 3D tiles.<sup>41</sup>

The architecture must also dynamically map user input across devices. IWSDK's XRInputManager automatically handles the visual representation of controllers or fully articulated hands based on the active WebXR profile.<sup>43</sup> For the Quest 3, the agent will implement support for the latest WebXR Multimodal Input APIs.<sup>44</sup> This allows users to seamlessly mix input types—for example, utilizing 6DoF hand tracking with the left hand for direct object manipulation, while wielding a physical controller or a tracked stylus (like the Logitech MX Ink) in the right hand for precision geographic measurements.<sup>44</sup> The right-hand thumbstick vectors will be mapped to continuous sliding locomotion, while hand-tracking micro-gestures can trigger snap-turns or distance grabbing.<sup>42</sup>


## Spatial UI via UIKitML and Cross-Platform Fallbacks

Traditional Document Object Model (DOM) HTML elements cannot be rendered directly inside a WebGL/WebGPU WebXR context. However, forcing an AI agent to programmatically generate custom geometry and raycasting logic for every menu, button, and text field is highly inefficient.

To solve this, the AI agent will utilize UIKitML, a subsystem integrated into IWSDK that relies on pmndrs/uikit.<sup>45</sup> UIKitML provides a familiar HTML and CSS-like syntax specifically for authoring 3D spatial interfaces.<sup>45</sup> The AI agent can generate standard, declarative HTML markup strings (e.g., defining Flexbox layouts, paddings, and typography). The Vite plugin compiler then translates this markup at build time into highly optimized, GPU-accelerated 3D meshes positioned contextually within the virtual space.<sup>45</sup> This ensures the UI is readable at a distance, scales appropriately to avoid neck strain, and responds natively to XR pointer events.<sup>45</sup>

For users accessing the application outside of a VR headset, the architecture guarantees a seamless fallback. Because the IWSDK is built on Three.js, users on standard desktop browsers or mobile devices will default to an inline session. The WebXR emulator handles mouse-and-keyboard emulation natively, translating mouse drag events into pitch/yaw camera rotations and keyboard inputs (WASD) into locomotor translations, ensuring cross-platform parity from a single unified codebase.<sup>46</sup>


## 3D Tiles Streaming Infrastructure

A digital twin of the Earth cannot load static assets directly into client memory; the geometric data is simply too vast. To visualize urban centers, intricate topography, and real-world photogrammetry, 'Companion Atlas' requires a dynamic Level of Detail (LOD) streaming solution based on the Open Geospatial Consortium (OGC) 3D Tiles specification.<sup>48</sup>


## Integrating the NASA-AMMOS Renderer

Because Three.js does not natively support the OGC 3D Tiles specification out of the box, the AI agent will integrate the open-source 3DTilesRendererJS library developed by NASA-AMMOS.<sup>11</sup> This library acts as an essential bridge, bringing advanced spatial hierarchy parsing capabilities—comparable to those found in CesiumJS—directly into the Three.js ecosystem.<sup>50</sup>

The renderer works by traversing the tileset's internal bounding volume hierarchy (BVH). During the render loop, it calculates the geometric screen-space error based on the camera's current distance, viewing angle, and field of view.<sup>48</sup> As the camera approaches an object, the renderer asynchronously fetches higher-resolution glTF or glb mesh tiles, swapping them seamlessly while maintaining a strictly controlled memory footprint via LRUCache and PriorityQueue algorithms.<sup>11</sup>


## Navigating the WebGPU Transition Strategy

Integrating 3D Tiles into a modern WebGPU architecture presents a specific technical hurdle that the AI agent must navigate. As of 2025, the 3DTilesRendererJS ecosystem is still in an active transition phase toward full WebGPU support.<sup>52</sup> The core library contains legacy dependencies on WebGLRenderer and ShaderMaterial within utility files (such as TextureReadUtility.js), which trigger compilation errors when executed in a pure WebGPU environment.<sup>53</sup>

To establish a resilient pipeline, the AI coding agent must implement the following structural patches:



1. **Bundler Aliasing:** The agent will configure the Vite bundler to actively alias legacy WebGL imports to their modern WebGPU equivalents during the build process, or inject a post-install Node.js script to gracefully strip deprecated utility files that conflict with the WebGPURenderer.<sup>53</sup>
2. **Material Refactoring:** The NASA-AMMOS renderer relies heavily on custom shaders for vital features like batch table queries, structural metadata extraction, and topographic texture overlays.<sup>54</sup> Because legacy WebGL RawShaderMaterial code is incompatible with the WebGPU backend, the AI agent will utilize the library's built-in plugin architecture (TilesRenderer.registerPlugin()).<sup>54</sup> By intercepting newly loaded tiles, the agent can dynamically replace the standard materials with modern, WebGPU-compatible NodeMaterial instances authored via TSL.<sup>54</sup>

To further ensure smooth performance and eliminate micro-stutters on the Meta Quest 3, the agent will deploy the TilesCompressionPlugin to aggressively compress incoming tile geometry and reduce texture mipmap overhead in GPU memory.<sup>54</sup> Additionally, the UpdateOnChangePlugin will be implemented to halt the heavy BVH traversal algorithm when the user's camera is stationary, freeing vital CPU cycles for physics processing and spatial UI interactions.<sup>54</sup>


## Open-Source Mapping Data Backends and Serverless Pipelines

A planetary-scale spatial application is entirely beholden to the quality, structure, and availability of its underlying geographic data. Relying on commercial, proprietary providers like Google Map Tiles introduces severe vendor lock-in and prohibitive API costs for high-traffic or open-source applications.<sup>56</sup> Therefore, the AI agent will architect a data pipeline reliant entirely on robust, free, and self-hostable open-source mapping backends.


## The Overture Maps Foundation Ecosystem

The cornerstone of the application's data strategy is the Overture Maps Foundation. Founded by a collaborative coalition of major technology companies (including AWS, Meta, Microsoft, and TomTom), Overture releases massive, highly interoperable global map datasets on a monthly cadence.<sup>57</sup> Crucially, this data is structured using the Global Entity Reference System (GERS).<sup>59</sup> GERS assigns a persistent, unique cryptographic ID to every geospatial entity—be it a specific building footprint, a segment of road, or a local point of interest. This ensures that disparate datasets from civic organizations and open sources can be joined effortlessly without spatial conflation errors or overlapping geometry.<sup>59</sup>

Overture data is distributed in the cloud-native **GeoParquet** format and hosted publicly on open Amazon S3 and Azure blob storage endpoints.<sup>60</sup> GeoParquet's columnar data structure and embedded row-group statistics allow analytic engines to execute complex queries across gigabytes of data by simply skipping irrelevant spatial bounds.<sup>61</sup> This means the application's backend does not have to download the entire planet's dataset to extract the buildings for a single city.<sup>61</sup>


## Serverless Extraction and Tile Generation Pipeline

To convert these massive datasets into streamable 3D formats usable by the Three.js front-end, the AI agent will establish an automated, serverless backend pipeline:



1. **Data Extraction and Filtering:** Utilizing DuckDB's spatial SQL capabilities within a serverless AWS Lambda function or AWS Batch job, the pipeline queries the Overture Spatiotemporal Asset Catalog (STAC) to locate the latest data release.<sup>61</sup> The pipeline executes geographic bounding box queries to extract precise building footprints, height attributes, and transportation networks.<sup>62</sup>
2. **Topographic Fusion:** To provide accurate terrain heights, the extracted Overture vector data will be contextualized by combining it with open Digital Elevation Models (DEMs). High-resolution datasets, such as the USGS 3D Elevation Program (3DEP) and global SRTM data provided via OpenTopography, will be merged to create accurate terrestrial mesh surfaces.<sup>64</sup>
3. **Tile Generation:** The extracted GeoParquet vectors and DEM rasters are processed using highly parallelized open-source tilers, such as Planetiler or Tippecanoe.<sup>63</sup> These tools generate PMTiles for scalable vector data, or convert the fused data directly into the OGC 3D Tiles format.<sup>63</sup>
4. **Static Serverless Hosting:** The generated 3D Tiles and PMTiles are subsequently stored in an AWS S3 bucket and served globally through an AWS CloudFront Content Delivery Network (CDN).<sup>66</sup> Because 3D Tiles are essentially a vast hierarchy of static JSON manifests and glTF/glb meshes, they require no active, expensive database computation on the server; the S3 endpoint acts natively as the API.<sup>61</sup> This results in a highly scalable, zero-maintenance backend architecture capable of handling massive user concurrency for pennies on the dollar.<sup>63</sup>

For secondary map styling and traditional 2D vector basemap layers that drape over the terrain, the architecture will integrate **OpenMapTiles**.<sup>67</sup> OpenMapTiles provides a free, open-source tile schema derived directly from OpenStreetMap, allowing the AI agent to generate dynamic, customizable street maps that render efficiently beneath the 3D geometry.<sup>67</sup>


## AI Coding Agent Operations and Visual Regression Testing

To successfully execute and maintain this highly complex product plan, the AI coding agent must operate within a structured environment characterized by continuous feedback loops and rigorous visual validation protocols.


## Declarative Vibe Coding Workflow

The agent will leverage the "Vibe Coding" methodology introduced by the IWSDK architecture.<sup>38</sup> Instead of blindly generating thousands of lines of code and hoping the application compiles, the agent operates in a closed-loop system deeply integrated with the Vite development server and the IWER WebXR emulator.<sup>38</sup>



* When the agent generates a new TSL shader node for atmospheric scattering or modifies the ECS parameters governing player locomotion, the development server instantly hot-reloads the application state.<sup>38</sup>
* The agent possesses the capability to query the live DOM, inspect the Three.js internal scene graph, and parse console errors in real-time.<sup>38</sup> For example, if a newly generated 3D Tile fails to load due to an improper Cross-Origin Resource Sharing (CORS) configuration on the AWS S3 bucket, the agent autonomously detects the console exception, rewrites the AWS CDK infrastructure-as-code configuration to apply the correct headers, and dynamically redeploys the backend pipeline.<sup>38</sup>


## Automated Visual Regression Testing in Spatial Computing

Validating spatial, 3D applications programmatically is notoriously difficult. Standard unit tests and integration pipelines cannot verify if a volumetric cloud shader rendered correctly, or if catastrophic Z-fighting is occurring on a mountain range rendered ten kilometers from the camera. To solve this, the AI agent will construct and maintain a robust visual regression testing strategy utilizing **Playwright**.<sup>69</sup>

The testing pipeline operates systematically:



1. **Environment Simulation:** Playwright launches headless browser instances simulating a variety of device profiles, including mobile viewports, standard desktop resolutions, and the WebXR emulator canvas.<sup>71</sup>
2. **Spatial Navigation:** The test script navigates the Three.js camera to predetermined, precise spatial coordinates within the generated 3D Tileset, ensuring the scene is fully loaded and stable.
3. **Pixel-Perfect Capture:** The pipeline utilizes Playwright's toHaveScreenshot() assertion to capture pixel-perfect graphical representations of the rendering output.<sup>69</sup>
4. **Baseline Comparison:** The newly generated output is compared pixel-by-pixel against established, verified baseline images.<sup>69</sup> The AI agent configures specific threshold tolerances to account for minor, expected GPU rasterization differences across different operating systems.<sup>69</sup>

If an updated TSL shader configuration or a new monthly release of the Overture Map data introduces visual anomalies, Playwright automatically fails the CI/CD pipeline and generates a visual diff image highlighting the mismatched pixels in red.<sup>69</sup> The AI agent then parses this visual diff alongside the specific WebGL/WebGPU console warnings to autonomously isolate the regression, revert or patch the offending code, and resolve the visual artifact prior to merging the updates into the production branch.<sup>69</sup>


## Architectural Synthesis

The product architecture for 'Companion Atlas' represents a highly optimized convergence of state-of-the-art open-source technologies, structured specifically to enable an AI coding agent to operate autonomously at maximum velocity. By designating Three.js as the core rendering engine, the architecture avoids the constraints of opinionated game engines while empowering the AI to utilize the JavaScript-native Three.js Shading Language (TSL). TSL elegantly bypasses the inherent complexities and LLM hallucination risks of traditional string-based GLSL development, enabling sophisticated WebGPU compute workflows for parallel frustum culling and real-time atmospheric scattering.

The integration of Meta's Immersive Web SDK (IWSDK) provides the crucial Entity-Component-System framework and Web Worker-driven locomotion necessary to guarantee a frictionless, high-performance WebXR experience on the Meta Quest 3, while preserving logical fallbacks for mobile and desktop users.

Furthermore, by deliberately decoupling the application from commercial mapping providers, 'Companion Atlas' ensures long-term financial viability and unlimited scalability. Integrating the NASA-AMMOS 3D Tiles renderer with a fully serverless, self-hosted data pipeline—powered by Overture Maps GeoParquet datasets, DuckDB spatial processing, and AWS S3 static hosting—creates a free, globally comprehensive topographic backend. Operating within a closed-loop Playwright visual testing environment, the AI coding agent is equipped with both the declarative structural tools and the real-time visual feedback mechanisms required to continuously construct, deploy, and maintain a definitive planetary-scale spatial computing application.


#### Works cited



1. Three.js vs Babylon.js vs PlayCanvas | Comparison Guide 2026 - Utsubo, accessed March 13, 2026, [https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison](https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison)
2. CesiumJS – Cesium, accessed March 13, 2026, [https://cesium.com/platform/cesiumjs/](https://cesium.com/platform/cesiumjs/)
3. WebGPURenderer – three.js docs, accessed March 13, 2026, [https://threejs.org/docs/pages/WebGPURenderer.html](https://threejs.org/docs/pages/WebGPURenderer.html)
4. Field Guide to TSL and WebGPU - The Blog of Maxime Heckel, accessed March 13, 2026, [https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)
5. WebGPU Support - Babylon.js Documentation, accessed March 13, 2026, [https://doc.babylonjs.com/setup/support/webGPU](https://doc.babylonjs.com/setup/support/webGPU)
6. The CesiumJS Roadmap – Cesium, accessed March 13, 2026, [https://cesium.com/blog/2021/03/23/cesiumjs-roadmap/](https://cesium.com/blog/2021/03/23/cesiumjs-roadmap/)
7. Three.js vs. Babylon.js: Which is better for 3D web development? - LogRocket Blog, accessed March 13, 2026, [https://blog.logrocket.com/three-js-vs-babylon-js/](https://blog.logrocket.com/three-js-vs-babylon-js/)
8. Babylon.js vs Three.js: The 360 Technical Comparison for Production Workloads - Dev.to, accessed March 13, 2026, [https://dev.to/devin-rosario/babylonjs-vs-threejs-the-360deg-technical-comparison-for-production-workloads-2fn6](https://dev.to/devin-rosario/babylonjs-vs-threejs-the-360deg-technical-comparison-for-production-workloads-2fn6)
9. Multiview in webXR using Quest 3 in 2024 - Questions - Babylon.js, accessed March 13, 2026, [https://forum.babylonjs.com/t/multiview-in-webxr-using-quest-3-in-2024/48191](https://forum.babylonjs.com/t/multiview-in-webxr-using-quest-3-in-2024/48191)
10. Webxr in cesiumjs - Cesium Community, accessed March 13, 2026, [https://community.cesium.com/t/webxr-in-cesiumjs/22948](https://community.cesium.com/t/webxr-in-cesiumjs/22948)
11. GitHub - NASA-AMMOS/3DTilesRendererJS: Renderer for 3D Tiles in Javascript using three.js, Babylon.js, and r3f, accessed March 13, 2026, [https://github.com/NASA-AMMOS/3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS)
12. Large World Rendering / Floating Origin | Babylon.js Documentation, accessed March 13, 2026, [https://doc.babylonjs.com/features/featuresDeepDive/scene/large_world/](https://doc.babylonjs.com/features/featuresDeepDive/scene/large_world/)
13. Cesium: The Platform for 3D Geospatial, accessed March 13, 2026, [https://cesium.com/](https://cesium.com/)
14. Three.js Shading Language - GitHub, accessed March 13, 2026, [https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
15. Babylon.js vs Three.js: Which Should You Choose? | by Devin Rosario, accessed March 13, 2026, [https://javascript.plainenglish.io/babylon-js-vs-three-js-which-should-you-choose-14faef9f7d78](https://javascript.plainenglish.io/babylon-js-vs-three-js-which-should-you-choose-14faef9f7d78)
16. Top 5 GIS Tools for Next-Level 3D Visualization in 2025 - D5 Render, accessed March 13, 2026, [https://www.d5render.com/posts/top-5-gis-tools-3d-visualization](https://www.d5render.com/posts/top-5-gis-tools-3d-visualization)
17. Three.js vs WebGPU for Construction 3D Viewers: Which One Scales Beyond 500MB Models? | by AlterSquare | Jan, 2026, accessed March 13, 2026, [https://altersquare.medium.com/three-js-vs-webgpu-for-construction-3d-viewers-which-one-scales-beyond-500mb-models-00322de80991](https://altersquare.medium.com/three-js-vs-webgpu-for-construction-3d-viewers-which-one-scales-beyond-500mb-models-00322de80991)
18. Three.js vs WebGPU for Construction 3D Viewers: Which One Scales Beyond 500MB Models? - AlterSquare.io, accessed March 13, 2026, [https://altersquare.io/three-js-vs-webgpu-construction-3d-viewers-scale-beyond-500mb/](https://altersquare.io/three-js-vs-webgpu-construction-3d-viewers-scale-beyond-500mb/)
19. Camera and floating point origin - Questions - three.js forum, accessed March 13, 2026, [https://discourse.threejs.org/t/camera-and-floating-point-origin/51486](https://discourse.threejs.org/t/camera-and-floating-point-origin/51486)
20. Rendering Models with High Precision in Global Scenes | Re:Earth Engineering, accessed March 13, 2026, [https://reearth.engineering/posts/high-precision-rendering-en/](https://reearth.engineering/posts/high-precision-rendering-en/)
21. Camera and floating point origin - #10 by Attila_Schroeder - Questions - three.js forum, accessed March 13, 2026, [https://discourse.threejs.org/t/camera-and-floating-point-origin/51486/10](https://discourse.threejs.org/t/camera-and-floating-point-origin/51486/10)
22. TSL: Transitioning default GLSL Matrices to TSL · Issue #28070 · mrdoob/three.js - GitHub, accessed March 13, 2026, [https://github.com/mrdoob/three.js/issues/28070](https://github.com/mrdoob/three.js/issues/28070)
23. Instance geometry Frustum culling - three.js - Stack Overflow, accessed March 13, 2026, [https://stackoverflow.com/questions/51025071/instance-geometry-frustum-culling](https://stackoverflow.com/questions/51025071/instance-geometry-frustum-culling)
24. 100 Three.js Tips That Actually Improve Performance (2026) - Utsubo, accessed March 13, 2026, [https://www.utsubo.com/blog/threejs-best-practices-100-tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
25. [WebGPU] drawIndirect and drawIndexedIndirect · Issue #28389 · mrdoob/three.js - GitHub, accessed March 13, 2026, [https://github.com/mrdoob/three.js/issues/28389](https://github.com/mrdoob/three.js/issues/28389)
26. Ideas on performing fast per-instance frustum culling on InstancedMesh - three.js forum, accessed March 13, 2026, [https://discourse.threejs.org/t/ideas-on-performing-fast-per-instance-frustum-culling-on-instancedmesh/85156](https://discourse.threejs.org/t/ideas-on-performing-fast-per-instance-frustum-culling-on-instancedmesh/85156)
27. Understanding about WebGPURenderer - Questions - three.js forum, accessed March 13, 2026, [https://discourse.threejs.org/t/understanding-about-webgpurenderer/86635](https://discourse.threejs.org/t/understanding-about-webgpurenderer/86635)
28. How can I solve z-fighting using Three.js - Stack Overflow, accessed March 13, 2026, [https://stackoverflow.com/questions/40328722/how-can-i-solve-z-fighting-using-three-js](https://stackoverflow.com/questions/40328722/how-can-i-solve-z-fighting-using-three-js)
29. Procedural Atmosphere - Adam Alsegård, accessed March 13, 2026, [https://adamalsegard.github.io/lists/TNM084.pdf](https://adamalsegard.github.io/lists/TNM084.pdf)
30. Chapter 16. Accurate Atmospheric Scattering | NVIDIA Developer, accessed March 13, 2026, [https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-16-accurate-atmospheric-scattering](https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-16-accurate-atmospheric-scattering)
31. JolifantoBambla/webgpu-sky-atmosphere - GitHub, accessed March 13, 2026, [https://github.com/JolifantoBambla/webgpu-sky-atmosphere](https://github.com/JolifantoBambla/webgpu-sky-atmosphere)
32. Atmospheric Scattering - State of the Art, accessed March 13, 2026, [https://repositorium.uminho.pt/bitstreams/00ac3a4f-ceb0-4d07-9694-0a78ac47d1e0/download](https://repositorium.uminho.pt/bitstreams/00ac3a4f-ceb0-4d07-9694-0a78ac47d1e0/download)
33. jeantimex/precomputed_atmospheric_scattering: A Three.js implementation of Eric Bruneton's Precomputed Atmospheric Scattering model. - GitHub, accessed March 13, 2026, [https://github.com/jeantimex/precomputed_atmospheric_scattering](https://github.com/jeantimex/precomputed_atmospheric_scattering)
34. Volumetric lighting in WebGPU - Showcase - three.js forum, accessed March 13, 2026, [https://discourse.threejs.org/t/volumetric-lighting-in-webgpu/87959](https://discourse.threejs.org/t/volumetric-lighting-in-webgpu/87959)
35. SkyMesh – three.js docs, accessed March 13, 2026, [https://threejs.org/docs/pages/SkyMesh.html](https://threejs.org/docs/pages/SkyMesh.html)
36. Built a weather globe using WebGPU compute shaders - irregular grid sampling, marching squares, streamline tracing - Reddit, accessed March 13, 2026, [https://www.reddit.com/r/webgpu/comments/1qj6yln/built_a_weather_globe_using_webgpu_compute/](https://www.reddit.com/r/webgpu/comments/1qj6yln/built_a_weather_globe_using_webgpu_compute/)
37. Meet Immersive Web SDK: A New Era for Spatial Web Development - Meta for Developers, accessed March 13, 2026, [https://developers.meta.com/horizon/blog/immersive-web-sdk-new-era-spatial-web-development/](https://developers.meta.com/horizon/blog/immersive-web-sdk-new-era-spatial-web-development/)
38. Immersive Web SDK — AI-Assisted Development Tooling | Meta Horizon OS Developers, accessed March 13, 2026, [https://developers.meta.com/horizon/documentation/web/iwsdk-ai-assisted-dev-tooling/](https://developers.meta.com/horizon/documentation/web/iwsdk-ai-assisted-dev-tooling/)
39. Immersive Web SDK Overview | Meta Horizon OS Developers, accessed March 13, 2026, [https://developers.meta.com/horizon/documentation/web/iwsdk-overview/](https://developers.meta.com/horizon/documentation/web/iwsdk-overview/)
40. Built-in Interactions | Meta Horizon OS Developers, accessed March 13, 2026, [https://developers.meta.com/horizon/documentation/web/iwsdk-guide-built-in-interactions/](https://developers.meta.com/horizon/documentation/web/iwsdk-guide-built-in-interactions/)
41. Locomotion Performance | Meta Horizon OS Developers, accessed March 13, 2026, [https://developers.meta.com/horizon/documentation/web/iwsdk-concept-locomotion-performance/](https://developers.meta.com/horizon/documentation/web/iwsdk-concept-locomotion-performance/)
42. Locomotion Overview | Immersive Web SDK, accessed March 13, 2026, [https://iwsdk.dev/concepts/locomotion/](https://iwsdk.dev/concepts/locomotion/)
43. XR Input Visuals | Meta Horizon OS Developers, accessed March 13, 2026, [https://developers.meta.com/horizon/documentation/web/iwsdk-concept-xr-input-visuals/](https://developers.meta.com/horizon/documentation/web/iwsdk-concept-xr-input-visuals/)
44. Support for Latest WebXR Features in Babylon.js, accessed March 13, 2026, [https://forum.babylonjs.com/t/support-for-latest-webxr-features-in-babylon-js/54642](https://forum.babylonjs.com/t/support-for-latest-webxr-features-in-babylon-js/54642)
45. Chapter 10: Spatial UI with UIKitML - Immersive Web SDK, accessed March 13, 2026, [https://iwsdk.dev/guides/10-spatial-ui-uikitml.html](https://iwsdk.dev/guides/10-spatial-ui-uikitml.html)
46. GitHub - facebook/immersive-web-sdk: WebXR made simple. Full-featured framework with interactions, locomotion, and spatial UI. Powered by Three.js., accessed March 13, 2026, [https://github.com/facebook/immersive-web-sdk](https://github.com/facebook/immersive-web-sdk)
47. Movement, orientation, and motion: A WebXR example - Web APIs - MDN, accessed March 13, 2026, [https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Movement_and_motion](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Movement_and_motion)
48. Loading 3D Tiles - Babylon.js Documentation, accessed March 13, 2026, [https://doc.babylonjs.com/features/featuresDeepDive/geospatial/loading3dTiles/](https://doc.babylonjs.com/features/featuresDeepDive/geospatial/loading3dTiles/)
49. pka/awesome-3d-tiles - GitHub, accessed March 13, 2026, [https://github.com/pka/awesome-3d-tiles](https://github.com/pka/awesome-3d-tiles)
50. three-loader-3dtiles | This is a Three.js loader module for handling OGC 3D Tiles, created by Cesium. It currently supports the two main formats, Batched 3D Model (b3dm) - GitHub Pages, accessed March 13, 2026, [https://nytimes.github.io/three-loader-3dtiles/](https://nytimes.github.io/three-loader-3dtiles/)
51. 3d-Tiles-Renderer: A 3D Tiles implementation for three.js from NASA JPL - Resources, accessed March 13, 2026, [https://discourse.threejs.org/t/3d-tiles-renderer-a-3d-tiles-implementation-for-three-js-from-nasa-jpl/44136](https://discourse.threejs.org/t/3d-tiles-renderer-a-3d-tiles-implementation-for-three-js-from-nasa-jpl/44136)
52. Plugins & Custom Materials: Support for WebGPURenderer · Issue #1380 · NASA-AMMOS/3DTilesRendererJS - GitHub, accessed March 13, 2026, [https://github.com/NASA-AMMOS/3DTilesRendererJS/issues/1380](https://github.com/NASA-AMMOS/3DTilesRendererJS/issues/1380)
53. WebGLRenderTarget not found when using with WebGPU · Issue #759 · NASA-AMMOS/3DTilesRendererJS - GitHub, accessed March 13, 2026, [https://github.com/NASA-AMMOS/3DTilesRendererJS/issues/759](https://github.com/NASA-AMMOS/3DTilesRendererJS/issues/759)
54. Enhancements to the Three.js 3D Tiles Renderer - Cesium, accessed March 13, 2026, [https://cesium.com/blog/2024/09/11/enhancements-to-the-threejs-3d-tiles-renderer/](https://cesium.com/blog/2024/09/11/enhancements-to-the-threejs-3d-tiles-renderer/)
55. WebGLRenderer: Add support for Node Materials · Issue #30185 · mrdoob/three.js - GitHub, accessed March 13, 2026, [https://github.com/mrdoob/three.js/issues/30185](https://github.com/mrdoob/three.js/issues/30185)
56. 10 Free API Maps Alternatives to Google Maps - HubSpot Blog, accessed March 13, 2026, [https://blog.hubspot.com/website/free-api-maps](https://blog.hubspot.com/website/free-api-maps)
57. Overture Maps Foundation: Home, accessed March 13, 2026, [https://overturemaps.org/](https://overturemaps.org/)
58. Overture Maps Foundation Update - A Look at Progress, Possibilities, accessed March 13, 2026, [https://overturemaps.org/blog/2023/april-overture-release/](https://overturemaps.org/blog/2023/april-overture-release/)
59. Overture Maps Launches GERS, a Global Standard for Interoperable Geospatial IDs, to Drive Data Interoperability, accessed March 13, 2026, [https://overturemaps.org/announcements/2025/overture-maps-launches-gers-a-global-standard-for-interoperable-geospatial-ids-to-drive-data-interoperability/](https://overturemaps.org/announcements/2025/overture-maps-launches-gers-a-global-standard-for-interoperable-geospatial-ids-to-drive-data-interoperability/)
60. Overture Maps data now on the cloud: how to use it with CARTO, accessed March 13, 2026, [https://carto.com/blog/overture-maps-data-now-on-the-cloud-use-it-with-carto](https://carto.com/blog/overture-maps-data-now-on-the-cloud-use-it-with-carto)
61. Overture Has Fully Embraced STAC, accessed March 13, 2026, [https://docs.overturemaps.org/blog/2026/02/11/stac/](https://docs.overturemaps.org/blog/2026/02/11/stac/)
62. Quickstart | Overture Maps Documentation, accessed March 13, 2026, [https://docs.overturemaps.org/getting-data/](https://docs.overturemaps.org/getting-data/)
63. OvertureMaps/overture-tiles: Create PMTiles from Overture data - GitHub, accessed March 13, 2026, [https://github.com/OvertureMaps/overture-tiles](https://github.com/OvertureMaps/overture-tiles)
64. 3D Elevation Program | U.S. Geological Survey - USGS.gov, accessed March 13, 2026, [https://www.usgs.gov/3d-elevation-program](https://www.usgs.gov/3d-elevation-program)
65. OpenTopography: Home, accessed March 13, 2026, [https://opentopography.org/](https://opentopography.org/)
66. Overture Maps Foundation releases open map dataset | Hacker News, accessed March 13, 2026, [https://news.ycombinator.com/item?id=36879461](https://news.ycombinator.com/item?id=36879461)
67. OpenMapTiles Planet | Schema - MapTiler documentation, accessed March 13, 2026, [https://docs.maptiler.com/schema/omt-planet/](https://docs.maptiler.com/schema/omt-planet/)
68. OpenMapTiles: World maps you can self-host - powered by free OpenStreetMap vector tiles and open-source software, accessed March 13, 2026, [https://openmaptiles.org/](https://openmaptiles.org/)
69. How to Implement Playwright Visual Testing - OneUptime, accessed March 13, 2026, [https://oneuptime.com/blog/post/2026-01-27-playwright-visual-testing/view](https://oneuptime.com/blog/post/2026-01-27-playwright-visual-testing/view)
70. What is Visual Regression Testing with Playwright? - Checkly, accessed March 13, 2026, [https://www.checklyhq.com/blog/visual-regression-testing-with-playwright/](https://www.checklyhq.com/blog/visual-regression-testing-with-playwright/)
71. A Complete Guide To Playwright Visual Regression Testing - TestMu AI, accessed March 13, 2026, [https://www.testmuai.com/learning-hub/playwright-visual-regression-testing/](https://www.testmuai.com/learning-hub/playwright-visual-regression-testing/)
72. Visual Regression Testing with Playwright: Catch Every UI Change! - YouTube, accessed March 13, 2026, [https://www.youtube.com/watch?v=qaOHkqFVLm4](https://www.youtube.com/watch?v=qaOHkqFVLm4)