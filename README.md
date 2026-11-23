# pili-cracker-models

Interactive 3D models for the TUP BSME pili nut shell cracker capstone.
`npm install && npm run dev`, or import the folder into StackBlitz (Vite + React template).

## What's in here

| Model | File | Status |
|---|---|---|
| **Drawing set P3 simulation** | `src/PiliAssemblyModelP2.jsx` | **Current.** Loads by default. Follows drawing set Rev P3 (13 sheets, closed nut path). File names kept from P2 so StackBlitz only needs the files replaced. |
| Rev D assembly | `src/PiliAssemblyModelRevD.jsx` | Superseded by P2/P3. Kept for comparison. |
| Nip simulator | `src/PiliNipSimulator.jsx` | Single-nut crack behaviour vs. gap (older numbers). |
| Rev C2 / Rev B assembly | `src/PiliAssemblyModelRevC.jsx`, `...RevB.jsx` | Superseded. |

`src/App.jsx` is the model switcher. `standalone/` holds the old Rev C2 and Rev D HTML exports; there is no standalone export of P2 yet.

## Putting it on StackBlitz

Open the existing StackBlitz project and replace or add these files (drag them into the file tree):

- `src/PiliAssemblyModelP2.jsx` (changed for P3)
- `src/geometryP2.js` (changed, about 1.2 MB, generated from drawing set P3)
- `src/partInfoP2.js` (changed)
- `src/App.jsx` (label only)
- `README.md`, `docs/CHANGELOG-P3.md`, `tools/export_sim.py` (changed; not needed to run)

`package.json` is unchanged (React 18, three 0.128.0, Vite 5). Or start a new Vite + React project and drop the whole `pili-models` folder in.

## P3 changes at a glance (closed nut path)

- **Deck**: bars lowered to 45 / 95 mm inside the 190 mm skirts (90 mm freeboard); two solid discharge lips stagger the three outlets (tray end x = 279, medium lip x = 395, large lip x = 476); rod 138 mm, stroke centred.
- **Bins**: one bin box, three compartments in a row (S / M / L). A nut that runs off a lip falls under gravity past the real walls; if it would land outside the box it is **lost**, if it lands in another grade's compartment it is a **crossing**. A full compartment backs up its lip (the nut waits on the deck; it is not lost).
- **Feed**: selector plate slides across the machine (3 openings 90 apart) → 30° chute → 36 mm single file → metering gate → nip.
- **Separation**: covered screen box; chips are carried to the chip spout and bag; kernel chute lip under the box; larger pan.
- **Nuts lost counter** (top of the readouts, green at 0): every particle that leaves the closed path turns red and is logged. **Escape test** button: sweeps the deck 140 → 240 rpm, refills the hopper and cracks every grade at 8× speed, then reports. Last automated run: 224 nuts fed, 0 lost, 0 crossings. Negative control (medium lip cut back to the tray end): 32 crossings, so the counter does catch a bad layout.

## P2 simulation at a glance (still valid except where P3 changed it)

The **geometry is exported from the drawing model** (`params.py` / `model.py`, the same model that produced the 13 sheets), so every part has the drawn shape, size and position. Part numbers in the inspector are the Sheet 12 BOM numbers.

Coordinates inside the machine are the drawing coordinates: **mm, X right, Y back, Z up**, with the fixed-roller axis at X = 0, Y = 0, Z = 788. The machine group is turned −90° about X so three.js keeps y-up; the operator side (front, −Y) faces the default camera.

Flow: hopper → **parallel-bar deck** (top bars 25.5 mm clear, middle bars 22.5 mm, solid tray) → three grade bins → **sliding selector plate** (one 80 mm opening) → **35° feed chute** → nip (Ø89 rollers) → catch funnel → canvas sleeve → **oscillating 8 mm screen box with blower air** → kernel chute → PP tub. Fines and small chips drop into the pan.

- **Grading rule.** A nut drops through a bar level when its width is smaller than that level's clear spacing (Rev3 §10.2). Widths and kernels are sampled from our measurement sheet (Rev3 Table 1). Nuts near a boundary land in the "wrong" bin by geometry alone, which is why the bins show a mis-graded count.
- **Three drives.** Main motor 1.5 kW → V-belt 1:1 → WPA 40:1 → slip coupling → fixed roller, 44 rpm (rim 0.205 m/s). Deck gearmotor (DC 24 V, PWM, 180 rpm) → 8 mm eccentric → 138 mm rod → deck on four 40 mm links; the screen box follows through the arm and link. Blower on its own. Each has its own Start/Stop; **one latching E-stop stops all three**.
- **Sheet 13 interlock** (tick box, on by default): starting the main motor starts the deck and blower first, and stopping either of them drops the main motor. Untick it to run the three drives fully independently.
- **Deck speed slider.** A = rω² with r = 8 mm. Below 1.68 m/s² (about 138 rpm) the nuts do not move (Rev3 §10.3); the screen stops conveying too, because it is driven from the deck.
- **Gap.** Slider or drag the stop-stud nuts. "Set Rev3 stop" gives 17.7 / 20.4 / 23.4 mm. The carriage, movable roller, bearings, I2 idler and chain path all follow; the die springs compress or extend.
- **Crack judgement** (Rev3 §2): uncracked if w − gap < 1.08 mm (δf), crushed if gap < kernel + 0.5 mm, else whole.

## Regenerating the geometry after a drawing change

1. Copy `tools/export_sim.py` into the `script/` folder of the drawing package (`Pili_Cracker_Drawings_P2_DXF_STEP_Script.zip`, next to `params.py` and `model.py`).
2. Run `python3 export_sim.py out` (needs CadQuery, the same as the drawings; about 20 s).
3. Copy `out/geometryP2.js` over `src/geometryP2.js`.

The JSX reads every dimension it needs (deck spacing, roller size, link lengths, pin positions, chute angle and so on) from the `P2` object in that file, so nothing else has to be edited.

## Animation assumptions (not calculated)

Conveying speed on the deck and screen (60 mm/s at 180 rpm, scaled with A − 1.68), where along the deck a narrow nut falls through, the routing of each deck level into its bin (the lips are not drawn; top → back bin, middle → centre, tray → front), release from the selected bin at one nut per roller revolution, and the paths of chips and dust. Pulleys turn slower than the real 1 760 rpm so they can be seen.

See `docs/CHANGELOG-P2.md` for the change log and the list of things that still differ from the drawings.

---

## Rev D (superseded, kept for comparison)

Linear gravity cascade, flow +x to −x, y-up coordinates. Three oscillating perforated decks (31 / 25 / 20 mm), buffer bins with slide gates and an interlock bar, V-channel feed, Ø150 rollers at 36 rpm, 0.5 hp motor, take-off chain to the deck jackshaft, coarse screen + sorting tray + 8 mm screen + cross-flow air. All of these values predate Rev3 and Addendum A rev B. The Rev D audit notes (floating sub-assemblies and clipping fixes, Sept 2026) apply only to that file.
