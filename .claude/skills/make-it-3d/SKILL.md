---
name: make-it-3d
description: Add smooth, professionally designed 3D models to whatever is being built — silky high-poly forms, glass, chrome, pearl, clear-coat, iridescent blobs, rounded bevels, orbiting systems — lit like a studio product shot, the way award-winning (Awwwards / motion-design) sites do it. TRIGGER when the user says "make it 3D" or "add 3D" (also "3D it", "go 3D", "I guess make it 3D"), for Free-birds, Eclipse, or any other project. Works with whatever background/theme the project already has; it is about model QUALITY, not a dark particle look.
---

# Make it 3D / Add 3D

When the user says **"make it 3D"** or **"add 3D"**, build what they asked for and give it 3D models that
look like a professional 3D/motion designer made them — smooth, softly lit, physically believable.
Never angular, never default-grey, never "programmer 3D".

The user's complaint about mediocre 3D: *angular, faceted, flat, cheap*. Everything below exists to kill that.

## Start from the reference

`showroom.html` (this folder) is a working, verified example of the bar to hit: a singularity with glossy
orbiters, a liquid iridescent blob, a refractive glass knot, a chrome/ceramic rounded-box stack — on a light
studio backdrop with soft shadows. Copy its renderer/lighting/post setup verbatim, then design the models
for the user's request. (`template.html` is an *optional* dark cinematic particle style — use it only when the
user asks for that vibe.)

## The pro-3D checklist (all of these, every time)

**Geometry — smooth by construction**
- High tessellation: spheres ≥ 128×64, torus/knots ≥ 256 tubular segments, icosahedron detail ≥ 48 for
  anything displaced. Scale down ~half on mobile, never below "no visible facets".
- No sharp boxes: `RoundedBoxGeometry` (bevel radius ~10–15% of size, 8+ segments). Bevels catch light —
  that is what reads as "designed".
- Organic shapes: displace a high-res sphere in the vertex shader with low-frequency simplex noise
  (1–2 octaves, low amplitude ~0.15–0.25) **and recompute normals in the shader** (neighbour-sample method in
  `showroom.html → morphing()`). High-frequency noise = rock; low-frequency = liquid.
- Need something custom? Build it from primitives with smooth unions: lathe (`LatheGeometry` with a
  spline profile), `TubeGeometry` on a `CatmullRomCurve3`, `ExtrudeGeometry` with `bevelEnabled` +
  `bevelSegments ≥ 8`, or SDF raymarching / marching cubes for melting/merging forms (metaballs).
- Real assets beat procedural when available: GLTF/GLB via `GLTFLoader` (+ `DRACOLoader`), then apply
  the materials below.

**Materials — `MeshPhysicalMaterial`, never Basic/Lambert/Phong for hero objects**
- Glass: `transmission: 1, thickness: .6–1.5, roughness: 0–.05, ior: 1.45–1.5`, tint with
  `attenuationColor` + `attenuationDistance`; put something colorful behind/inside so refraction shows.
- Chrome: `metalness: 1, roughness: .05–.15`. Brushed: roughness .3–.4.
- Pearl / soap-bubble: `iridescence: 1, iridescenceIOR: 1.3–1.4, iridescenceThicknessRange: [100, 500]`.
- Car-paint / lacquer / ceramic: base roughness .3–.6 + `clearcoat: 1, clearcoatRoughness: .05–.1`.
- Fabric / velvet / satin: `sheen: 1, sheenColor`.
- Glow: emissive colors with values > 1 (HDR) + bloom — glow only where it's motivated (energy, light).
- Pick a deliberate 2–4 material palette per scene; mix one hero material with calmer supports.

**Lighting — image-based, like a photo studio**
- Always set `scene.environment` (`RoomEnvironment` via `PMREMGenerator`, or an HDRI with `RGBELoader`).
  Reflections from an environment map are the single biggest jump from amateur to pro.
- One soft key `DirectionalLight` with shadows (`PCFSoftShadowMap`, 2048 map, radius 4–8) + the env.
- Grounding: `ShadowMaterial` floor (opacity ~.1–.15) and/or a radial-gradient contact-shadow blob.
  Floating objects without a shadow look pasted on.

**Renderer & post**
- `ACESFilmicToneMapping` (exposure ~1), sRGB output, pixel ratio capped at 2.
- `EffectComposer` on a `HalfFloatType` target with `samples: 4` (MSAA) → `RenderPass` →
  `UnrealBloomPass` (strength ~.3–.5, threshold ≥ 1 so only HDR emissives bloom) → `OutputPass`.
- Optional, tasteful: depth of field on product shots, a hair of film grain on dark scenes.

**Camera & composition**
- Long lens (FOV 25–35) = product-shot look; wide FOV distorts and cheapens.
- Hero object fills ~40–60% of its frame, slight top-down angle, generous negative space.
- Background matches the project (light studio gradient, brand color, or dark) — never pure #000/#fff flat.

**Motion — slow, damped, physical**
- Everything eases: `THREE.MathUtils.damp` (frame-rate independent) or springs; no linear snaps.
- Idle life: slow rotation (.1–.3 rad/s), gentle float bob, noise morph — subtle.
- Pointer: object/camera tilts toward the cursor a few degrees; hover = small scale/lift with damping.
- Orbits: tilted ellipses, varied speeds/radii, different materials per orbiter (see Singularity).

**Robustness**
- Mobile: halve segments, keep MSAA, drop shadow map to 1024.
- `prefers-reduced-motion`: freeze idle animation, keep the render.
- No WebGL → static image/CSS fallback; content still reachable.
- Dispose geometries/materials/textures/render targets on unmount in SPA frameworks.

## Fitting it into a project

- Plain HTML / artifact: import map with pinned `three@0.160.0` from `cdn.jsdelivr.net/npm/` (core + `examples/jsm/` addons).
- React: `@react-three/fiber` + `@react-three/drei` (`<Environment preset="studio">`, `<ContactShadows>`,
  `<MeshTransmissionMaterial>`, `<RoundedBox>`, `<Float>`) + `@react-three/postprocessing` if the stack
  allows; otherwise plain three inside a `useEffect` with cleanup.
- Data-driven: generate models from the project's real items (each playlist / model / product → an object
  with its own material or color).
- **Free-birds**: playlists/categories as a smooth orbiting system or a carousel of glossy forms, colored per category.
- **Eclipse**: the orbiting-singularity idea, done right — clear-coat black core, HDR accretion disk with
  bloom, high-poly orbiters in chrome/pearl/glass/satin on tilted ellipses (`showroom.html` specimen 1).
  Don't edit Eclipse unless the user asks; this is the recipe for when they do.

## Inspiration / research notes

Award-listed 3D/WebGL sites worth studying for the look (Awwwards 3D & WebGL collections): Fragment
(fragment.im), OSPLY (osply.co), Tinkeroll (layernative.com/tinkeroll), Ciuslabs (ciuslabs.com),
Continuance (continuance.ai), Infinity Socks (theinfinitysocks.com), Anemone (anemone.mina-massoud.com),
Dwell (dwell.au), Benno's Light (bennos-light.org). Three.js references: `webgl_materials_physical_transmission`,
`webgl_materials_physical_clearcoat` (flakes normal map + clearcoat normal map for car paint),
Three.js Journey "Wobbly Sphere", "Realistic render", "Environment map", "Modified materials".
If the user shares an example site/video, extract: forms, materials, lighting, camera, motion — then match
those with the checklist above. Echo the craft, never copy a studio's actual assets, names or branding.
