---
name: roblox-world-builder
description: Design standard and workflow for Roblox maps and environments. Use when designing, building, rebuilding, expanding, detailing, lighting or optimizing a Roblox map, level, world, biome, region, terrain, landmark or environmental 3D asset (rocks, trees, crystals, ruins, structures), in any Roblox project. Load it before placing environment geometry, even for a small area.
---

# Roblox world builder

You are the environment artist and level designer here, not a prop scatterer.
Every map task produces a coherent, memorable place the player can actually
play in: readable from far away, impressive at play distance, rewarding up
close, and cheap enough to run.

These are default standards, not a template. Explicit instructions for the
current project always win. Adapt everything below to the game's genre,
movement system and gameplay; reuse the method, never another project's layout,
theme, biome count or systems.

## Related skills

- This skill decides **what** to build and **how good it must be**. The
  `world-builder` and `scene-architect` skills and the `roblox-studio-mcp`
  skill are tool references for **how to place geometry**. Where their advice
  conflicts with this skill (primitives only, generic material tables, small
  first-pass budgets as a quality ceiling), this skill wins for map and
  environment work.
- Particles, beams, glows and other effects in the world: also load
  `roblox-vfx-animation` (custom textures, emit module, frame-by-frame checks).
- Region-switch UI or HUD: `roblox-gui`.

## 1. Design the world, not objects

For every map, decide before building:

- **Structure:** overall composition, where the big masses sit, what the player
  sees from spawn.
- **Movement:** how the player travels (walk, jump, swim, fly, drive) and from
  which camera; routes, sightlines and spaces follow from that.
- **Landmarks:** a few large, distinct silhouettes the player can navigate by.
- **Transitions:** how one area flows into the next (gates, narrowing, light
  change, material blend), never a hard seam.
- **Variation:** open vs. enclosed, high vs. low, dense vs. empty, near vs. far.
- **Verticality and depth** where the movement supports it.
- **Connections:** loops, shortcuts, alternate and optional paths where the game
  is non-linear.
- **Story:** what happened here; let shapes, wear and placement tell it.
- **Light, colour, hierarchy:** where the eye goes first.
- **Function:** collisions, spawns, triggers, performance.

## 2. Default art style: detailed stylized micro-voxel

Unless the project asks for another style, environment geometry uses a
**detailed, stylized micro-voxel / blocky 3D** language:

- Cubic, stepped, faceted, voxel-inspired forms with strong, composed
  silhouettes; handcrafted, not procedural noise.
- "Micro" is the **detail grain**, not the object size. A 200-stud cliff is
  still built from stepped ledges, chunky strata and small cubic breakups.
- Detail hierarchy on one asset: big blocky mass → stepped secondary forms
  (ledges, bevels made of steps, offset slabs) → small cubic accents (chips,
  studs, inset bands, crystal shards) concentrated at edges and focal points,
  with calm areas between.
- Cohesive palette and material treatment per asset family: 3–5 tones per
  material, value steps between faces and layers instead of one flat colour,
  accents sparing. Every asset should look like it came from the same game.
- Different categories get different geometry rules (organic = clustered,
  tapering, irregular steps; architecture = regular grid, repeated modules;
  minerals = sharp facets, radial clusters).
- Not this: basic Minecraft-style 1-block builds, generic smooth low-poly,
  unrelated smooth Blender assets, or piles of oversized default primitives.

With another requested style, drop this section's look but keep every other
section.

## 3. Three scales, always

Build every environment from all three, in this order of importance:

| Scale | Role | Typical size vs. a ~5-stud character | Examples |
| --- | --- | --- | --- |
| **Macro** | Defines the map from a distance; navigation anchors | 10×–60×+ (50–300+ studs), landmarks may fill a large part of the view | Cliffs, giant trees/mushrooms/corals, crystal spires, arches, ruins, huge machines, monuments |
| **Meso** | Shapes spaces and routes; connects macro forms | 2×–8× (10–40 studs) | Rock clusters, shelves, medium vegetation, secondary structures, crystal groups |
| **Micro** | Finishes and rewards close inspection | ≤ 1.5× (under ~8 studs) | Small plants, fragments, minerals, trim, patterns, subtle effects |

Rules:

- Macro first, meso second, micro last. Micro supports the composition; it
  never replaces it.
- Never fix an empty-looking map by scattering hundreds of small props.
- Never call one huge structure in empty space a finished environment.
- Sizes are role-based, not maximized: a landmark is huge because it is a
  landmark; a path-side rock is not.

## 4. Judge scale from the player's view

Know the actual avatar (R15/R6, any custom scale), camera mode and zoom range
(`StarterPlayer.CameraMinZoomDistance` / `CameraMaxZoomDistance`), movement
values (WalkSpeed, JumpHeight/JumpPower, swim/fly speed) and typical view
distance before sizing anything. Stock defaults: character ~5 studs tall,
WalkSpeed 16, JumpHeight 7.2, a comfortable horizontal jump ~10–12 studs;
check the project, it may differ.

Check important structures at three distances:

- **Far:** the silhouette is recognizable and distinct from its neighbours.
- **Play distance:** the composition looks impressive, not toy-like.
- **Close:** micro-voxel detail rewards inspection.

If a "monumental" landmark reads as a decoration at play distance, enlarge or
redesign it.

## 5. Compose complete environments

- Macro forms decide where meso goes; meso decides where micro goes (micro
  gathers at bases, edges, cracks, junctions and focal points).
- Vary density, height, width, spacing, complexity, openness, enclosure,
  elevation, silhouette, sightlines and direction of travel.
- Keep negative space, especially around landmarks, so they read.
- No even spacing, grids of decoration, or copy-pasted clusters. Reuse assets,
  but vary rotation, scale, grouping, terrain contact (sunk, tilted, wedged,
  overhanging) and context.

## 6. Geography and level design

- Do not default to a straight corridor of sequential zones. Unless the game
  needs linear progression, consider multiple directions, elevation changes,
  broad open spaces and enclosed pockets, curved and branching paths, natural
  passages, optional side areas, loops, shortcuts and cross-connections.
- Open-world, exploration, underwater, fantasy and large adventure maps should
  feel like one physical place, not a list of levels.
- Keep intentionally linear games linear (obby, racing track, dungeon run,
  narrative corridor) and polish them within that structure.
- Design for the traversal mechanic:
  - swimming / flying: full 3D; use height layers, overhangs, tunnels, vertical
    shafts; avoid flat layouts;
  - vehicles: turning radii, road width, long sightlines, safe run-offs;
  - platforming: readable jumps within the measured jump range, clear landing
    zones, safe recovery.

## 7. Distinct regions

Each biome, district or room has its own identity, built from several of:
large silhouettes, terrain and spatial structure, material and colour palette,
density and arrangement, unique landmark formations, lighting and atmosphere,
local effects, ambient audio, and its transitions to neighbours. A recolour of
the same layout is not a new region.

### Lighting and atmosphere

- Inspect the existing lighting first: `Lighting` properties, `Atmosphere`,
  `Sky`, post effects (ColorCorrection, Bloom, DepthOfField, SunRays) and any
  scripts that already drive them. Integrate; never overwrite blindly.
- Give each region a deliberate profile: ambient/outdoor ambient, contrast,
  shadows, colour correction, atmospheric depth, local light sources.
- Region lighting that differs per player runs **on the client** (a
  LocalScript reacting to the local player's region, tweening local Lighting
  and effect values). The server must not switch shared Lighting per player.
- Transitions are tweened and intentional.
- Fog, bloom, Neon and particles support composition; they never stand in for
  it. Keep the world readable.

## 8. Reference images

When the user gives images or a reference folder:

1. Find the folder and actually open the images (Read shows them); filenames
   alone are not references.
2. Note shapes, scale, composition, palette, atmosphere, lighting, details.
3. Extract what is consistent across them.
4. Translate them into the project's style, traversal, scale and budget; do not
   copy mechanically.
5. Keep using them as a check during the build.

If some images cannot be opened, say which and continue with the rest. Without
references, derive direction from the brief and the existing project, not from
an unrelated theme.

## 9. Existing projects: inspect and preserve

Before changing an existing map, find:

- terrain and map objects; spawns and spawn logic; zones and triggers;
- interactables and anything with collision dependencies;
- scripts referencing Workspace objects (search scripts for map object names
  and paths, `FindFirstChild`/`WaitForChild` on map parts, CollectionService
  tags, attributes);
- lighting/environment controllers; project docs and conventions.

Rules:

- Preserve gameplay systems and player data. Never delete scripts, spawns or
  gameplay objects because they sit inside the old map folder.
- Before destructive changes, make a checkpoint: duplicate the old map into a
  backup folder (e.g. `ServerStorage`), and/or ask the user to save the place;
  record a ChangeHistoryService waypoint when editing through scripts.
- When replacing geometry that scripts reference, keep names/paths/tags or
  update the references deliberately, then verify the behaviour.
- Integrate with working systems instead of rewriting them.

## 10. Implementation

Tools, by job (use only what the current session actually exposes; check
first):

- **Roblox Studio MCP:** hierarchy, geometry, Terrain, materials, lighting,
  native effects, gameplay integration (`execute_luau`), screenshots
  (`screen_capture`), walking the route (`character_navigation`, playtests).
- **Blender MCP:** custom meshes when custom geometry clearly beats parts
  (organic macro forms, complex stepped silhouettes, repeated hero assets).
  A mesh must reach Roblox through an upload (Open Cloud via
  `roblox-vfx-animation/scripts/upload.mjs`, or Studio's importer by the user);
  uploads are permanent and moderated, so say what and how many first.
- **Existing project tools** when they already do the job.

Technical rules:

- Organize: one folder/model per region and per scale layer
  (e.g. `Map/<Region>/Macro|Meso|Micro|Lighting|Gameplay`), descriptive names.
- Anchor static geometry. Collide only what the player should touch. Micro
  props: `CanCollide = false`, `CanTouch = false`, `CanQuery = false` unless
  needed, `CastShadow = false` for small pieces. MeshParts: simple
  `CollisionFidelity` (Box/Hull) unless precise collision matters.
- Do not simulate detail with thousands of individual Parts. Prefer meshes,
  unions only where stable, or reusable grouped models / Packages; balance
  quality, flexibility and cost.
- Use Terrain where it suits (large ground, water, caves), dressed with
  voxel-style parts or meshes to fit the art style.
- Large maps: consider StreamingEnabled and model streaming modes; keep
  particle counts and light counts controlled.
- Build reusable assets/modules where reuse is real; do not over-engineer
  one-off content.
- Spread effort across the whole playable world before polishing one hero
  asset.

## 11. Workflow

Scale the depth to the task; a small request does not need ten write-ups, but
it still follows the principles.

- **A. Understand:** game, genre, movement, camera, existing systems, docs,
  references, what the map must achieve.
- **B. Spatial structure:** layout, landmarks, routes, sightlines, elevation,
  connections. No prop scattering yet. For a large map, share the plan with
  the user before building.
- **C. Scale:** measure the player, traversal spaces, meso and macro sizes.
- **D. Blockout:** rough playable spaces and landmark masses; walk the routes
  and look from spawn and key viewpoints before detailing.
- **E. Macro structures:** final big forms and each region's identity.
- **F. Meso composition:** supporting structures, terrain shaping, routing.
- **G. Micro detail:** selective micro-voxel detailing, materials, props,
  restrained effects.
- **H. Lighting and atmosphere:** region profiles, local lights, transitions.
- **I. Optimize and integrate:** remove waste, fix collisions, reconnect
  gameplay references, check counts.
- **J. Test and refine:** look from the player's camera (screenshots at the
  three distances), travel the real routes in a playtest, check console
  errors, then fix scale, composition, readability, lighting and traversal.

## 12. Quality check before calling it done

**World design:** coherent place? routes readable and functional? layout fits
the movement? real variation in space and elevation? landmarks placed on
purpose?

**Scale:** macro truly monumental where intended? meso supporting the
composition? micro selective? impressive at play distance?

**Art direction:** assets consistent? shapes in the chosen style? repetition
varied? each region recognizable?

**Lighting:** supports rather than hides the world? per-region differences
where needed? effects controlled? transitions behave, per player where
relevant?

**Technical:** collisions match gameplay? counts and geometry reasonable?
scripts and gameplay dependencies intact? no console errors, broken
references or unfinished areas?

Report honestly: what was **built**, what was **verified** (and how: screenshot,
playtest, script check), and what is **unverified or unfinished**. Never claim
a map is tested if it was not playtested.
