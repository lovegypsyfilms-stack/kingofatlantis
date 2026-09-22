# King of Atlantis — v4 daily loop

Play it: serve this folder (for example `python3 -m http.server`) and open `index.html`. Add `?debug&seed=7` to get the debug overlay and a deterministic seed. In debug mode, **N** force-completes the current state and **`** toggles the overlay.

Controls: WASD or arrows to move · mouse or tap to aim · click, tap or Space to fire · E, Enter or the on-screen ACT button to interact. On touch devices the left thumb works a movement stick, and during the night fight you tap anywhere to aim and fire.

## Asset authority (as built)

| Role | Authoritative path | Status in this build |
|---|---|---|
| Moving Ben | `masters/sprites/ben-directional-walk-v3-gold-crown.png` | **Missing**. A procedural stand-in is used (tan shirt, sandy hair and beard, gold crown). |
| Night room | `masters/backgrounds/02-bens-room-astral-night.png` | Found and used |
| Day room | `masters/backgrounds/01-bens-room-day.png` | **Missing**. The stand-in is a colour grade of the night plate. |
| Backyard | `masters/backgrounds/03-state-housing-backyard.png` | **Missing**. The stand-in is painted to the same layout. |
| VFX | `masters/vfx/astral-entities-energy-atlas.png` | Found and used (27 frames, alpha cleaned) |
| Lesser entities | `masters/v4/astral-lesser-entities-atlas.png` | **Missing**. The stand-ins are the shade figures from the VFX atlas, tinted into 4 types. |
| Boss demon | `masters/v4/astral-boss-demon-atlas.png` | **Missing**. A procedural winged demon is used, with 5 fracture stages. |
| Guinea pig | `masters/v4/guinea-pig-carrot-atlas.png` | **Missing**. A procedural stand-in is used (run, 3-frame eat, gold sparkle). |
| Props | `masters/v4/daily-loop-props-atlas.png` | **Missing**. The grocery bag, ice-cream tub and spoon are procedural. |
| Safeway map | `masters/maps/v3/safeway-6x3/*` | 17 of 18 found. `r2-c6` is synthesised from `r1-c6` (block interior, so navigation is unaffected). |
| Beach map | `masters/maps/v3/beach-2x6/*` | **Missing** (0 of 12). The district is disabled, and this loop doesn't need it. |
| Street traffic | `masters/street/kapaa-pedestrian-atlas.png`, `vehicles-kpd-atlas.png` | Found and used |

These files are ignored on purpose and never loaded. The loader hard-blocks the first two.
`masters/obsolete_reference/ben-directional-action-atlas.png`, `ben-directional-walk-v2-poster-likeness.png`, `supermarket-r2-c1/c2.png`, `coastal-r1-c1.png` and the v2 `map-layout.json`.

Wherever a stand-in is on screen, the game labels it in the bottom-right corner.

### Dropping in the real art
1. Put each file at its exact path in the table above. The masters are never modified.
2. Run `python3 tools/preprocess.py`. It removes the backdrop (existing alpha, or a key against an estimated backdrop field), extracts the frames and writes `runtime/**.png` + `.json`. The metadata covers rect, pivot, animation, duration and events. It also writes a `*_contact.png` sheet for checking each atlas, plus `runtime/manifest.js`.
3. The game switches to the real atlases automatically. The v4 sheets use auto row detection, so check each contact sheet and adjust the row-to-animation mapping in `tools/atlas_specs.json` if the layout differs. The mapping currently expects: lesser = 4 rows (move 0-2, hit 3, dissolve 4-6), demon = fly/fracture/lunge/hit/death, guinea = run/eat/sparkle, props = bag/icecream/misc. Ben v3 is assumed to be 3 columns × 8 rows (N, NE, E, SE, S, SW, W, NW), the same as v2.
4. If the real day or backyard plate frames things differently, adjust `ROOM` and `YARD` in `js/game.js`. These hold the floor polygon, door, bed and gate positions.

## State machine
`NIGHT_CLOSE → ASTRAL_REVEAL → LESSER_ENTITIES → DEMON_BATTLE → DAWN → ROOM_MORNING → BACKYARD_MORNING → STREET_OUTBOUND → SAFEWAY → STREET_RETURN → BACKYARD_EVENING → ROOM_EATING → BED → NIGHT_CLOSE`

Each state has exactly one completion condition, listed in `COMPLETE_WHEN` in `js/game.js` and shown in the debug overlay. The game saves only at the start of `NIGHT_CLOSE` and `ROOM_MORNING`, and only after the state's fade has finished. Balance values are in `CFG` in `js/core.js`.

## Tests
- `python3 tests/play_loop.py` plays the whole loop with real keyboard and mouse input and checks every acceptance criterion. It passed 46/46.
- `python3 tests/smoke.py` steps through all states with debug skip and takes screenshots.

## Play-test 1 changes
- **Ben's look:** Ben now uses the first pack's full-motion sheet (`ben-directional-action-atlas.png`) as a bridge. `tools/recolor_ben.py` recolours it to a tan shirt, sandy hair and beard, and a solid gold crown. It covers walking in 8 directions, idle, cast, brace, knock-down and lying in bed. If `masters/sprites/ben-directional-walk-v3-gold-crown.png` is added, it takes priority for walking.
- **Street fire-back:** click or tap a person, or press Space / F (FIRE button on touch), to fire. It auto-aims at the nearest charged person. Anyone hit is knocked back, then either leaves and fades out or crosses to the far sidewalk and carries on. A shot costs 1 astral, with a 0.6 s cooldown.
- **Audio:** cars coming toward Ben make a chiptune pass-by sound that pitches down and is panned to the car's side. Police cars add a siren blip. Charged people call out as they come at Ben ("Hey King!", "Gimme that crown!", "Watch out, your douchiness!" …) through the browser's built-in voice, with a speech bubble.
- **Controls:** clicking the game gives it keyboard focus. Click or tap anywhere to take the offered action, or to walk to that spot.
- **Still missing (stand-ins in use):** guinea pig/carrot, props (grocery bag, ice cream), day room plate and backyard/apartment exterior plate. None of these are in the project or in Downloads, Desktop or Documents on the Mac.

## Play-test 2: real art installed
All packs were found on the Mac at `Desktop/GAMES DESIGN/KING OF ATLANTIS/ASSETS/` and are now in use:
- **v1 pack:** `01-bens-room-day.png` and `03-state-housing-backyard.png`, the exterior of Ben's apartment block. Ben's ground-floor door is on the right and the exit path is bottom-left; the layout lives in `YARD` in `js/game.js`.
- **v3 correction pack:** `ben-directional-walk-v3-gold-crown.png` is used for walking and idle. It is 3 columns × 8 rows, in the order S, SE, E, NE, N, NW, W, SW. The missing `safeway-r2-c6.png` plate is also now in place.
- **v4 supplement:**
  - lesser entities: 4 types × move/attack/hit/dissolve
  - boss demon: 8 directional flight frames, 5 fracture stages, lunge and death
  - guinea pig: run left and right, alert, 3 eating frames, carrot and sparkle
  - props: directional grocery bags, ice-cream stages, spoon and sparkles
- **Ben's other poses:** cast, brace, knock-down and asleep still come from the recoloured first-pack motion set.
- Only the 12 beach plates aren't loaded, because this loop doesn't use the beach district.

## Play-test 3: the beach, day 2 and the end of Act 1
- **Route:** home yard → **Beach** (v3 beach 2×6 plates, 1024×3072, walk from the south end to the north) → Safeway district → Safeway, then back the same way. The yard is the short section before and after the beach. The beach's walkable area is a measured cell mask covering the main road, sidewalks, cross streets and the coastal footpath (`tools/walkmask.py` → `runtime/maps/walk_beach.js`). Tap-to-walk finds its way along it.
- **Barrier wave:** 4 lesser shades guard the north end of the beach. Ben can't pass until all four are shot down. They wake as he approaches and cost astral and body energy on contact. If he runs out of astral here, shots burn body energy instead, so the fight can't soft-lock.
- **Difficulty:** night N runs at 1.5^(N−1) speed (lesser entities, demon orbit and lunge, beach shades). `CFG.daySpeedUp`.
- **Day 2+:** at the gate the only way out is **Bring Guinea Pig friend**. The guinea pig then follows Ben across the beach and town maps and walks home with him.
- **Night 3:** after the demon falls → DREAM ("He dreams…") → end card: *It wasn't always like this…* / **ACT 2: KALALAU** / TO BE CONTINUED. Tapping returns to the title. Continue replays night 3.
- **Camera:** town and beach maps are 2× closer (`streetZoom 3.0`). The day room is 1.5× closer (`roomZoom 2.3`). Night fights are ~1.25× closer.
- Tests: `tests/play_loop.py` passes 60/60, on both the source and the `dist/web` build.

## Play-test 4: photoreal Kapaʻa, new poster, and ACT 2: KALALAU

### Act 1 changes
- **Title screen** uses the new poster; buttons sit under the painted title. A third button, **Act 2: Kalalau**, starts the chapter directly.
- **Photoreal plates**: day room, astral-night room and backyard from the Photoreal Kapaʻa Pack (same 1672×941 composition, so `ROOM`/`YARD` layouts are unchanged). Town uses the three True-Photoreal Kapaʻa masters cut into 512 cells. The route is now yard → **coastal** map (footpath north, barrier wave of 4 at the top road) → **residential** grid (north) → **Safeway district** → Safeway, and back. Walkable roads/sidewalks/lot/footpath are hand-authored rectangles in `js/game.js` (`townMap`), rasterised to an 8 px grid; nothing is derived from the photo at runtime.
- The night-3 end card now leads into Act 2.

### Act 2: Kalalau (`js/kalalau.js`, `runtime/kalalau/`)
- **Terrain**: the eight photoreal masters (Kalalau-Photoreal-Maps-v2), cut into 512 cells, north up, fixed near-top-down camera, Ben at a constant scale. **Night** is graded at runtime from the same tiles (multiply + torch/fire light), so day/night geometry and collision are identical by construction. The pack's illustrated day/night masters are not loaded (they differ from the photoreal set).
- **Navigation layer**: `masters/kalalau/layout.json` — corridors (polyline + half-width), open polygons, named reciprocal portals, hiding spots, camp/LZ/kama/trailhead points, ledge checkpoints. Rasterised to an 8 px grid on load (`Kal.grid`), with an eroded interior grid for path-finding so routes stay off the edges. Corridor ends and hiding spots get short connectors automatically. Debug **C** shows the grid, **X** the portals.
- **Sprites**: `tools/kalalau_extract.py` cuts the six atlases (alpha sheets, plus magenta keying for the supernatural/FX sheets with a G-channel coverage signal for soft mist/downwash). Contact sheets in `runtime/kalalau/*_contact.png`. Ben = `kben` only; the crowned Ben never loads in this chapter.
- **Phases** (`Kal.phase`): TENT_WAKE → BEACH_SOCIAL → FREE_EXPLORE; CAMP_CONFRONTATION → DEESCALATED / FIGHT → HELICOPTER_RESPONSE → RANGER_CHASE → HIDDEN / ARRESTED → TRAILHEAD_EXPULSION → HIKE_OUT; JETSKI arrival → CAMP_FIRE → AFTERMATH; NIGHTFALL → SUPERNATURAL_ACTIVITY → KAMAPUAA_ENCOUNTER; CHAPTER_EXIT from Crawler's Ledge.
- **Hiding rule** (strict): E at a shrub. If any pursuing ranger is within the current viewport → immediate arrest. Otherwise Ben is concealed, movement stops, rangers search the map for `KCFG.hideSearch` seconds and move on; he is released when the map is clear. Debug overlay labels each spot *eligible* / *ranger on screen*.
- **Arrest** → trailhead at Red Dirt Hill; the ranger line is verbatim; portals back into the valley are refused during HIKE_OUT.
- **Camp**: intact → burning (ignition → blaze → grey smoke → black smoke) → burned tent; the fire hurts Ben if he stands in it. Knife: **K** draws/sheathes; it changes dialogue outcomes and makes a fight far worse (`flags.knifeUsed`).
- **Night**: Menehune watch from the edge of visibility and vanish when approached; night marchers walk the main path with torches — stand in their way and they pass through him (astral/body loss); kneel (prompt) and they move on. Kamapuaʻa: mist → six materialisation stages → circles, spear strikes, expanding mist volumes, vines that emerge/crawl/grab and can be severed with the knife; survive `KCFG.kama.encounter` s and he returns to mist.
- **Crawler's Ledge**: cliff wall on the right, drop on the left. `KCFG.wind`: 0.75 s telegraph (gentle streaks + cue) → 1.5 s reaction window ("BRACE RIGHT") → 2–3 s gust. Holding right within the shelter strip braces Ben; otherwise he is pushed toward the drop, past the fall boundary → fall → reload the last trail checkpoint. Each gust shortens the warning ×0.85 and raises force ×1.25.
- **Save**: phase, clock/night, map, position, inventory, camp state, alert, checkpoint, outcomes, actor positions; written on every map entry. Title offers "Continue — Act 2: <map>".
- **Debug keys** (with `?debug`): T day/night · R rangers · H helicopter · F camp fire · G Kamapuaʻa (advance stages) · W wind strength · C collision · X exits · M Menehune · P marchers · J jet-skis · V skip social.
- **Tests**: `tests/kalalau.py` — 35 checks covering the nine first-playable criteria (35/35 on source and web build). `tests/play_loop.py` — 62 Act 1 checks.

### Connective invention (for approval)
- Hiker names (Mara, Dane, Walt, Ines, Rosie, Cole, Theo). The four residents use the atlas labels (Kai, Leilani, Makani, Noa).
- Dialogue beyond the mandated lines is minimal and functional (see `Kal.beachSocial`, `campConfrontation`, `raidConfrontation`).
- Map graph: beach E ↔ valley S and rear-clearing E ↔ river N are added loops so pursuers can be evaded.
- The "threaten" outcome raises the alert to 1: a two-ranger foot patrol appears on the beach the next time Ben goes there (no helicopter).
- The jet-ski raid is triggered after the camp confrontation resolves (or ~3 game hours after the beach scene) when Ben is at the beach or camp. With the knife drawn the group backs off that day; without it the tent burns.
- Kamapuaʻa cannot be defeated; the encounter resolves by surviving or leaving the clearing.
- Night uses graded day tiles rather than the pack's illustrated night masters (photoreal set chosen).

## Play-test 5 changes
- **Zoom**: town and Kalalau maps zoomed out 2× (`streetZoom 1.5`, `KCFG.zoomMul 0.85`); bedroom out 1.5× (`roomZoom 1.55`).
- **Guinea pig guardian** (day 2+ on the maps): when a charged person or a beach shade comes within `CFG.pigGuardRange`, the pig circles Ben fast with an orbit that bulges toward the threat and knocks back whatever it clips (automatic; `pigOrbitRadius`, `pigOrbitSpeed`, 1.1 s between hits).
- **Dream guide**: on night 3 the guinea pig appears on the bed and says "Let me take you on a spirit journey." (spoken) before the Act 2 card.
- **Kalalau guide**: a large bar along the bottom always says what to do next (the `GUIDE` chain in `js/kalalau.js`), with a bouncing arrow over the target, an edge arrow when it is off screen, and a dotted route along the planned path. If Ben is on the wrong map it names the exit to take. Live events override the text (rangers, hidden, Kamapuaʻa, wind, choices). The chain: wake → beach → talk → back to camp (visitors now arrive as he gets home) → visitors → beach (jet skis) → camp (raid) → valley → river → waterfall clearing (night falls there; Kamapuaʻa) → back west → valley → Red Dirt Hill → trail → Crawler's Ledge → exit. Arrest jumps to the hike-out part of the chain.
- **Night marchers**: still kneel-to-pass. Open question for the next round: whether Ben should be able to push them back with an astral wave, or whether the point is that you cannot fight them.

## Play-test 6: carrots fuel the guinea pig
- A carrot buys **3 guinea-pig attacks** (`CFG.pigAttacksPerCarrot`). When the pig needs to fight and has no charge left it eats a carrot from the bag automatically (munch + sparkle); with no carrots it only follows and Ben is told it needs one. Charges show on the HUD as 🐹 n/3 next to 🥕.
- Carrots come from Safeway (+4 with the groceries) and from **wild carrots growing along the paths in Kalalau** (2–4 per map, seeded, "Pick wild carrots" prompt, +1 each).
- The guinea pig comes along to Kalalau as his guide and fights the same way there: it trips pursuing rangers (1.4 s stun), severs vines, and hits anyone in a camp fight.

## Play-test 7: no-pig default + test toggle
- **Guinea pig companion is OFF by default.** With it off: the day-2 gate is a normal "Out the gate", no pig follows on the Act 1 maps, and Kalalau has no pig and no wild carrots. The dream scene (the pig as spirit guide) is unchanged.
- **Toggle**: a small "Test: guinea pig companion — ON/OFF" button under the title buttons (or press G on the title screen). It is remembered in this browser. URL override: `?pig=1` / `?pig=0`.
- With it ON, everything from play-test 6 applies, now at **1 carrot = 2 attacks** (`CFG.pigAttacksPerCarrot`).

## Play-test 8: music + freeze guard
- **Music** (`Music` in `js/core.js`, files in `runtime/music/`, masters in `masters/music/`): streamed looping `<audio>` with 1.6 s crossfades, started on the first click/key (browser rule).
  - `battle-day` = Rhythm Scott "Action Drums" — Act 1 streets while people are charging Ben (holds 5 s after the last one) and during the beach shade wave; Kalalau camp fight, helicopter/ranger chase, camp fire.
  - `battle-night` = Rhythm Scott "Full Strength" — the night fight in Ben's room (lesser entities + demon), Kamapuaʻa, the night-marcher procession.
  - `town` = Mountain Dreamers "Spirits Over The High Ridge" — the everyday Kapaʻa music in the yard, streets and coast when nobody is fighting.
  - **M** mutes/unmutes in game (remembered); a "Music — ON/OFF" button on the title screen.
- **Freeze guard**: the main loop now schedules the next frame before running the current one and catches any error, showing a small "Glitch (game kept running)" line with the message at the bottom instead of stopping dead. The debug overlay shows the error count and last message. The reported post-Safeway freeze did not reproduce in Chromium (tested ~3 min of random play on the return, pig on and off), so it is likely Safari-specific; if it happens again the on-screen message will say where.

## Play-test 9: story order, Ben's voice, coast mob, Kamapuaʻa on the trail out
### Act 1
- **Starts in the morning** (ROOM_MORNING, day 1). Ben: *"Okay. Better get up and get some food at Safeway."* — a small italic subtitle in the lower third, also spoken with the browser voice (`Game.benLine`).
- Day 1 → Safeway run → evening → bed: *"The nights are the hardest."* → **the first night fight** (lesser entities + demon, base speed).
- **Day 2** morning: *"Made it through another night. Alright… better get to Safeway. Not sure how much longer I can live like this."* The guinea pig comes along **automatically** from the gate (no button). Day 2 streets run 1.5× (`dayK`); night fights use `nightK` so the first night is ×1.
- **Night 2 has no fight**: bed → DREAM (the guinea pig: "Let me take you on a spirit journey") → *It wasn't always like this…* → ACT 2: KALALAU. (`CFG.lastDay = 2`.)
- **Coast barrier is now four charged-up people** (drifter, local, jogger, office worker), each needing 2 pushes (`CFG.beachFoeHp`); they call out, grab at Ben on contact, and back off and fade when beaten. The guinea pig can hit them on day 2.
### Act 2
- **Hike-out runs right-to-left along the coast**: Red Dirt Hill (top-right exit) → the trail out, entered from its east end → west (left) → Crawler's Ledge, entered at its bottom-right end → climb to the top-left exit. The cliff wall is still screen-right on the ledge, so bracing is still "hold RIGHT".
- **Kamapuaʻa is on the trail out**: entering the trail brings nightfall; he rises from the mist as Ben walks on (six stages), then fights. **Push him back 5 times** (Space / F / FIRE button / tap him) — each push costs 3 astral, he's briefly invulnerable after a hit, he telegraphs his spear with a red flare (back off), raises mist that drains astral, and wakes vines (a push cuts a vine). After the fifth he lowers his spear and returns to the mist; first light follows for the ledge. This happens on both paths (arrested or not). The rear waterfall clearing still has him at night for explorers.
- **Ben's astral push** works on the spirit world only (Kamapuaʻa, vines, night marchers).
- **Night marchers**: kneel (E) and they pass, or push them (Space) and the whole procession recoils, veers off the path and fades into the dark.
- Guide chain after the camp: valley → Red Dirt Hill → trail out (Kamapuaʻa) → west to Crawler's Ledge → top-left exit. Exits are bigger (radius 100), Ben arrives further inside a map, and taps are ignored for half a second after arriving (stops accidental double-exits).
- Kalalau guinea pig stays behind the title-screen test toggle (default OFF).
