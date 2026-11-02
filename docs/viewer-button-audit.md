# Viewer button audit

Every button a visitor can reach in the Companion Atlas viewer, checked against one question:
does the label say what the control does, and is it worth a place on screen? Demo means the
bundled story with no Companion Memory connected. Connected means a memory server is loaded.

## Rail (left on desktop, bottom bar on phones)

| Control | Does | Decision |
| --- | --- | --- |
| Show all memories | Frames every memory on the globe | Kept. Was "Globe — frame everything", which read as a view of the globe. |
| People | Opens the people panel | Kept. |
| Scrapbook | Opens the memories you saved | Kept. |
| Present the story | Steps through the story's scenes | Kept, and it is the demo's tour. Was "Present". |
| Draw on the globe | Arms the drawing tools | Authoring only. Hidden in demo. |
| Scenes | Opens the scene deck editor | Authoring only. Hidden in demo. |
| Import & export | Imports KML/GeoJSON, shares a view | Authoring only. Hidden in demo. |

## Top bar

| Control | Does | Decision |
| --- | --- | --- |
| Demo badge | Says the story is a demo | Now a button, "Connect your memories". Opens the connect sheet. |
| Search | Opens the command palette (⌘K) | Kept. |
| Named places | Toggles the CI-Server places layer | Hidden in demo, since there is no Places API without a connection. Hidden on phones. |
| Map layers | Basemap, sun lighting, buildings | Kept. |
| What's shown on the globe (eye) | Hides notes, pins, outlines, areas, images | Kept. Icon only on phones; the title says what it does. |
| Fit all places | Frames every memory | Removed. It was a second copy of "Show all memories" on the rail. |
| Show my location | Tracks the device position | Kept. |
| Nearby alerts (bell) | Alerts when a memory is within 300 m | Renamed from "Nearby memories", which described the place rather than the action. Hidden on phones. |
| 3D / 2.5D / 2D | Projection | Kept. The phone shows one cycling button instead. |
| View in AR | Reloads into the AR entry | Kept. Only offered where AR can start. |

## Timeline

| Control | Does | Decision |
| --- | --- | --- |
| Previous / next memory | Moves the playhead to the neighbouring memory | Kept. |
| Play / pause | Plays the journey | Kept. A demo starts paused, so the visitor chooses the moment. |
| Day and night lighting | Toggles sun lighting | Kept. |
| Scrub | Moves the clock | Kept. |

## Memory card

| Control | Does | Decision |
| --- | --- | --- |
| Fly here | Flies the camera to the memory | Kept. |
| Save / Saved | Adds the memory to the scrapbook | Renamed from "Collect", which did not say what it collects into. |

## New in this change

| Control | Does |
| --- | --- |
| Take the tour | Starts Present mode. |
| Connect my memories | Opens the connect sheet. |
| Dismiss (×) | Hides the welcome card. The choice is remembered in this browser. |
| Connect (sheet) | Reloads the viewer with `?memory=` set to the address entered. |
| Not now (sheet) | Closes the sheet. |

## Left as they are, with reasons

- The phone top bar stays icon-only. Labels would need another 12px of height, and every icon has a title.
- The projection cycle button on phones reads "2D" or "3D". It is the phone's compact form of the segmented control.
- The Sign in with Companion button stays on the Memory sign-in screen. It needs the `VITE_OIDC_*` values in a production build, and the browser token exchange needs its CORS fix deployed first.
