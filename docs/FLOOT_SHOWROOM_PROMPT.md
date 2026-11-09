# Free Birds Showroom: build prompt

Build **Free Birds Showroom**, a public website that shows my saved YouTube playlists as an immersive, scroll-driven 3D journey. Free Birds (also called Noxara YouTube Intelligence) is my private app that reads my YouTube likes and playlists, sorts videos into AI categories I approve, and organizes them into playlists. This site is the beautiful public front for those playlists. I will put it on my own custom domain.

## What visitors do

1. Land on a dark, cinematic intro: a smooth chrome ring emblem with a glowing figure-eight light trail under it, drifting star dust, and a small sleek spaceship that flies across the frame with a HUD targeting reticle tracking it.
2. Scroll down. The camera flies forward along a smooth path into a corridor. A tall twisting column of soft, iridescent "smoke" made of glossy rounded blobs (the **spine**) flows downward through the middle.
3. Floating around the spine are glass cards with rounded corners. **Each card is one saved playlist.** It shows:
   - a living, slowly moving abstract background in that playlist's colors (or a soft mosaic of its video thumbnails)
   - the playlist title in large pixel/monospace letters with a glitchy RGB-split, doubled-echo effect that flickers now and then and on hover
   - a small spaced-out kicker line above it: the category name and the video count (for example `MUSIC · 42 VIDEOS`)
4. As the camera passes a card, the card dissolves into glowing particles that drift away, then reforms when scrolling back up.
5. Hovering a card makes it lift slightly and glitch harder. Clicking it opens a **playlist page**: the title, description, category, video count, last updated date, and a clean grid of its videos (thumbnail, title, channel, duration). Each video links out to YouTube. There is also a "Open on YouTube" button for the whole playlist.
6. Past the corridor, the camera enters a dark room with one hero object on a pedestal under a spotlight cone with hanging cables (feature the playlist I mark as "featured"). Then it passes a gallery wall of framed living panels (the most recently updated playlists), rises over it, and ends on a finale: the emblem emerging from a swirling nebula of particles with light rays, plus a "Contact" call to action.

## Interface on top of the 3D

- Top right: a small pill nav, `WORK —— CONTACT`, uppercase, letter-spaced, frosted glass.
- Bottom left, shown while in the corridor: "WHAT ARE YOU LOOKING FOR?" followed by `→ category` links built from my real categories. The category of the card nearest the camera lights up. Clicking a category filters the corridor to that category's playlists.
- A thin scroll-progress rail on the right edge and a "Scroll to explore" hint at the start.
- Typography: Space Mono for the interface, VT323 (or a similar pixel display font) for card titles.

## Data

Store everything in the database:

- **playlists**: id, youtube_playlist_id, title, description, category, video_count, color palette (3 hex colors), cover_thumbnail_url, featured (boolean), visible (boolean), sort_order, updated_at
- **videos**: id, playlist_id, youtube_video_id, title, channel_title, duration, thumbnail_url, position
- **categories**: id, name, sort_order

Admin (only me, behind login):

- Add, edit, hide, reorder and feature playlists; edit categories; pick each playlist's 3 colors with a color picker.
- **Import from Free Birds**: a button that calls my Free Birds API with a secret key and upserts playlists, categories and videos. Until that API exists, also allow pasting a YouTube playlist URL and entering details by hand.
- Seed the site with 8 example playlists across 5 categories (Music, Learning, Tech, Gaming, Inspiration) so it looks complete right away. Mark them clearly as examples in the admin so I can delete them.

Only playlists marked visible appear on the public site. Never show private video data beyond title, channel, duration and thumbnail.

## 3D quality bar (important)

This must look like a professional motion-design studio built it, not "programmer 3D". Use Three.js (React Three Fiber is fine):

- Smooth geometry only: high segment counts, rounded bevels (RoundedBox), and noise-displaced shapes with recomputed normals. No visible facets.
- Physically based materials: chrome, glass with transmission, iridescent clear-coat, sheen.
- Image-based lighting from an environment map, ACES filmic tone mapping, soft shadows, MSAA, and gentle bloom only on bright emissive parts.
- Camera moves along a smooth spline driven by scroll, with frame-rate-independent damping and a gentle tilt toward the mouse.
- Card backgrounds are animated shader footage (domain-warped noise in the playlist's palette, faint scanlines, soft vignette).

## Must work everywhere

- Phones: fewer particles and lower geometry detail, the interface collapses neatly, cards stay tappable, no sideways scrolling.
- If the visitor prefers reduced motion or WebGL is not available, show a clean grid of playlist cards instead, with the same links.
- Pause rendering when the tab is hidden. Load fast: show a minimal loader with the emblem while assets prepare.
- Good SEO: each playlist page has its own URL, title, description and share image.
