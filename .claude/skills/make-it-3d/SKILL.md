---
name: make-it-3d
description: Turn any page, app screen, landing page, portfolio or artifact into an immersive, cinematic 3D web experience — dark space, drifting particle fields, a glowing ring/emblem with a particle trail, floating glass cards that dissolve into particles, scroll-driven camera flight, mouse parallax and a particle-formed logo finale. TRIGGER whenever the user says "make it 3D", "I guess make it 3D", "3D it", "go 3D", "add the 3D stuff", "make it immersive", or asks for the "floating cards / particle" look — for Free-birds, the Eclipse models, or any other project. Apply it on top of whatever they asked to build; keep their content and purpose, upgrade the presentation.
---

# Make it 3D

The user's preset: when they say **"make it 3D"** (any phrasing), build whatever they asked for as an
immersive Three.js experience in this style. Their content stays the star; the 3D is the stage.

## The look (non-negotiable ingredients)

1. **Void background** — near-black (`#07070a`) with a soft radial vignette, faint fog for depth.
2. **Particle field** — thousands of tiny additive-blended points drifting slowly; a few colored
   sparks (violet `#7b6cff`, cyan `#5ad1ff`, warm amber `#ffb36b`).
3. **Hero emblem** — a glowing torus/ring (or the project's logo extruded) that slowly rotates,
   with a curved particle trail (a figure-eight / lemniscate tube of points) flowing beneath it.
4. **Floating glass cards** — one per item (project, playlist, model, product). Rounded planes with
   a frosted-glass look (`MeshPhysicalMaterial` transmission/roughness, or a translucent shader),
   a thumbnail texture, and a big monospace title rendered in the card (e.g. `PROMETHEUS`).
   Cards are scattered in depth along a path; the camera flies past them on scroll.
5. **Particle dissolve** — when a card is passed (or hovered/clicked), it breaks into particles
   that drift away, then reforms when scrolled back. Use a points mesh sampled from the card's
   plane + a `uProgress` uniform for the scatter.
6. **Mouse parallax** — camera/scene tilts gently toward the pointer (lerped, never jerky).
7. **Finale** — the brand name forms out of particles (sample text pixels from a 2D canvas into
   point positions) with radiating light rays.
8. **HUD overlay (HTML, not WebGL)** — small monospace UI: a pill nav top-right
   (`WORK —— CONTACT` style), a left-side menu ("WHAT ARE YOU LOOKING FOR?" → `→ item` list with
   real categories from the user's content), a ghost-outline CTA button. Uppercase, letter-spaced,
   low-contrast white (`rgba(255,255,255,.7)`).

Typography: a monospace/technical display face (Google Fonts: `Space Mono`, `JetBrains Mono` or
`Major Mono Display`) for titles, `Inter` for body.

## How to build it

- Start from `template.html` in this folder — a working single-file reference with every
  ingredient above. Copy it, then swap in the user's content (items → cards, categories → menu,
  name → finale text, colors → their palette if they have one).
- Three.js via import map, pinned: `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js`
  (addons from `.../three@0.160.0/examples/jsm/`). Never unpinned.
- For a React/Vite/Next codebase (e.g. Free-birds' frontend or the Eclipse app), port the same scene
  into a component (`@react-three/fiber` + `@react-three/drei` if already in deps, otherwise plain
  three in a `useEffect` with cleanup) — keep the scene logic in one module, HUD as normal components.
- Data drives the scene: build cards from an array (`[{title, image, tag, href}]`) so real content
  (YouTube playlists, Eclipse models, projects) slots straight in.

## Quality bar

- 60fps target: cap `devicePixelRatio` at 2, particle counts ~4–8k desktop, halve on mobile
  (`matchMedia('(max-width: 768px)')`), pause the loop when the tab is hidden.
- `prefers-reduced-motion`: disable the scroll flight + dissolve, show cards as a static grid.
- Resize handling, disposal of geometries/materials/textures on unmount.
- No WebGL? Fall back to the HUD + a CSS grid of the cards. Content must always be reachable.
- Phone width works: HUD collapses, cards stay tappable, no horizontal scroll.
- Original work only — echo the *mood* (dark, particles, glass, cinematic), never copy a real
  studio's site, names, logos or copy.

## Project notes

- **Free-birds** (YouTube intelligence app): cards = playlists / sorted categories, card image =
  video thumbnail, menu = AI categories, finale = "FREE BIRDS".
- **Eclipse models**: cards = each model, emblem = an eclipse (dark sphere with a glowing corona
  ring) instead of the plain torus.
- Anything else: map the user's main list of things to cards; ask nothing extra unless there is
  no content at all.
