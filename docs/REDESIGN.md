# Companion Atlas — UX Redesign: "your memories in space & time"

> **Private & Confidential — Property of Lifescope Inc.**
> Direction doc + build plan for the total UI/UX rethink. Grounded in: the
> **XR Time Machine** product vision (ci.computer), **CI-Common** (`@companionintelligence/ui`
> + tokens), **CI-Server MemoryPage** (Map/Timeline/Gallery/Graph), the two XR viewers
> (**CI-Spatial-Companion-WebXR**, **CI-WebXR-Time-Machine**), and the original **lifescope-xr**.
> Mockup: `docs/redesign/atlas-redesign.html` (interactive). Last updated 2026-07-15.

## 1. The idea in one line

Companion Atlas is the **spatial + temporal lens on Companion Memory** — a photoreal
memory globe you fly through in space *and scrub through in time*, where your located
photos/videos surface as a **scrapbook** pinned to place, on a journey ordered by time.
Google Earth VR × personal time machine × scrapbook, delivered as a first-class CI product.

**North star (ci.computer):** *"Curate anything from your history in social XR — make your
own XR gallery."* Atlas is the appliance-grade, memory-connected realization of that.

## 2. The single most important architectural decision

**Atlas is the FIFTH renderer of the Companion Memory `search()` query — not a new data path.**
CI-Server's MemoryPage is *one* GraphQL query rendered as List / Map / Gallery / Graph
(`useEntityService.tsx`). Atlas mounts on that same contract as `?view=globe`, deriving
`hasLocation:true` like the map does. It then inherits, for free: filters, the time range,
people/place/tag filters, bbox area-search, pagination, semantic search, saved searches,
and the shared entity detail drawer. **Same data, same mental model, same tokens.**

- Coordinate contract (reuse verbatim): `readGeoJsonPoint` / `readCoordinates`
  (`MemoryPage/MapView/mapCoordinates.ts`) — GeoJSON `[lng,lat]`, `(0,0)` rejected. Primary
  field `EventType.locationCoordinates`.
- Time: `time ?? startTime`. Title: `eventDisplayTitle` → *"Photo · Malibu, CA · Jun 17, 2026"*.
- Media/scrapbook: `getEntityMedia` + `MediaLightbox` (`GalleryView/`) — reuse for globe-anchored photos.
- URL-driven state (shareable/restorable): `search, from, to, tags, people, places, bbox, semantic, view`.

## 3. Visual language

**A committed dark "night-space" world** (like a planetarium — deliberately single-theme, not
a naive light inversion). All chrome uses CI-Common tokens; boldness is spent in the 3D scene.

| Token | Value | Use |
|---|---|---|
| `--background` | `#041620` | space ground |
| `--card` / glass | `#0a222e` / `rgba(9,32,43,.66)` + blur | panels (the CI `--xr-glass-*` surface) |
| `--primary` (teal) | `#abd4d8` | brand, active states, pins |
| `--aqua` / `--aqua-light` | `#00a9a7` / `#72ddd4` | glows, journey arc |
| `--mint` | `#58ebbf` | timeline density + playhead (from CI-Server timeline nodes) |
| `--teal-mid` | `#409b9b` | the **synthwave grid horizon** (the "time-machine floor," CI-teal not magenta) |
| `--dusk` | `#ffb27a` | the **time-of-day** cue (sky-follows-the-moment) |
| entity accents | place `#b79cff` · focused `#ff8d6e` | pin variants (mirror `entityVisuals.tsx`) |

Type: **Montserrat** (CI canon) + a mono for coordinates/timestamps. Iconography: lucide.

## 4. Screen anatomy → CI-Common component → data source

| Region | What it does | Build from (`@companionintelligence/ui`) | Data |
|---|---|---|---|
| **App frame** | icon rail + top bar | `AppShell` (`nav`, `user`, `actions`, `renderNavLink`) | — |
| **View switcher** | Globe · Gallery · Timeline · Graph | `Tabs`, `?view=` | Memory views |
| **⌘K palette** | jump to place / date / person / collection | `Command` / `CommandDialog` (replaces XR SavedSearches) | saved searches, places, people |
| **Backdrop** | space + drifting glows behind the globe | `GradientBackground` (literally "deep teal-navy + mint/cyan glows") | — |
| **The globe** | photoreal Cesium Earth; memory **pins**, clusters, **journey arc** | Cesium (Resium) inside `AppShell` `<main>`; markers mirror `entityVisuals` | `locationCoordinates`, route = time-ordered `routeLocations` |
| **Place chip** | current focus + coordinates | `Badge`/glass chip | `locationName`, coords |
| **Scrapbook frames** | floating photo cards for the memories in the time window around the playhead (place-anchoring to each pin is Phase D) | `Card` / `Carousel` (echoes lifescope diorama ring) | `previewUrl`, `eventDisplayTitle`, time |
| **Memory inspector** | selected memory detail | `Drawer` / `Sheet` (= CI-Server `EntityDetails`) | full `EventType` + tags + related |
| **Time Machine** (hero) | density histogram + **scrubber** that flies the camera along the route and filters by date; **sky follows the moment** | net-new (seed: `BlendTimeline`); drives Cesium `Clock` | bucketed `startTime` (`groupEntitiesByBucket`) |
| **Stats ribbon** | memories / places / years | `StatCard` | query aggregates |
| **Empty/first-run** | no memories / onboarding | `EmptyState` + onboarding overlay (from Spatial Companion) | — |

## 5. The signature interactions (what makes it a *time machine*, not a map)

1. **Time scrubber → camera + reveal.** The one thing neither XR repo has. Drag the bottom
   scrubber (or press play): the camera flies along the time-ordered route, pins reveal as the
   date cursor advances, the scrapbook re-populates. This is `Story → CZML → Cesium Clock`
   (already built + tested in `@companion-atlas/story`) made the primary control.
2. **Sky follows the moment** (revive from lifescope-xr `setSkyFromFocusedCell`). Selecting a
   7:42 PM memory sets the globe's lighting/atmosphere to that time-of-day — dusk. A late-night
   memory → stars; noon → sun. The environment *is* the time indicator.
3. **God-scale ↔ human-scale** (from Spatial Companion `scaleBy/recenter/resetScale`). Pinch the
   planet down to a **tabletop globe**, or blow it up and stand on the surface — the "Earth VR" feel.
4. **Map↔timeline linkage** (from CI-Server): hover a memory → pin pulses + connector; click a pin
   → scrub to it. Preserve, then elevate to the globe.
5. **Journey = flight path** (from CI-Server `RouteLayer` + Time Machine breadcrumbs): the
   time-ordered located memories are the camera's travel path and the drawn arc.

## 6. Build plan (phased, targets `viewer-react` — the canonical Resium viewer)

Status as of 2026-07-15 (Companion-Atlas PR #13): A/C delivered, B/D partial.

- **Phase A — CI shell. ✅ delivered** (as a vendored-token reproduction). Icon rail + top bar +
  view switcher + ⌘K command palette, themed from vendored `@companionintelligence/tokens`.
  *Remaining:* adopt the real `@companionintelligence/ui` `AppShell`/`Command` components.
- **Phase B — Memory data. ✅ delivered.** The viewer connects to a live CI-Server: `memoryToStory`
  maps the located `search()` result (`includeTypes:["event"]`, `hasLocation:true`) into a Story, and
  `fetchMemoryStory` does the transport with a Portal OIDC bearer / session cookie. Point the viewer
  with `?memory=<ci-server-url>` (or `VITE_MEMORY_URL`) and the globe renders real memories — title,
  narrative, place, time, and presigned media all flow through. *Remaining:* pagination past the
  first page, bbox/time-window server-side filtering, and write-back (`createEvent`).
- **Phase C — Time Machine. ✅ delivered.** Scrubber (density histogram + keyboard-operable playhead)
  driving the Cesium `Clock` via `storyToCzml`; sky-follows-the-moment lighting; journey arc,
  clock-driven traveler, camera fly-through; globe pin click/hover picking.
- **Phase D — Scrapbook + scale. ◐ partial.** Time-window scrapbook + `Lightbox` delivered, plus the
  Gallery/Timeline/Graph alternate views. *Remaining:* place-anchor each frame to its pin
  (`SceneTransforms.worldToWindowCoordinates` + connector); `scaleBy/recenter` god↔human scale; then
  the R3F/XR immersive path (in-world `XRControlPanel` tiles, companion guide).

Retire the vanilla `src/` viewer once `viewer-react` reaches parity.

## 7. What each reference contributed
- **ci.computer / lifescope-xr** — the vision: gallery-of-your-life on a globe, dioramas, the
  **time-of-day sky** mechanic, saved-searches-as-collections.
- **CI-Server MemoryPage** — the data spine + Map/Timeline linkage + Gallery-as-scrapbook + tokens.
- **CI-Spatial-Companion-WebXR** — the CI `--xr-glass` HUD, floating dock, collapsible panel,
  world-scale/recenter, in-world spatial tiles.
- **CI-WebXR-Time-Machine** — POI/breadcrumb model, X-ray markers, category layers, log-depth/floating-origin.
- **CI-Common `ui`** — the actual components to build all chrome from.
