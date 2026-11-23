# Simulation revision: Rev D → final drawings Rev P2

The source is `src/PiliAssemblyModelRevD.jsx` (Rev D audited build), revised into `src/PiliAssemblyModelP2.jsx`. The Rev D file is still in the project, unchanged, so the two can be compared in the switcher.

## What changed

**Geometry (frame, levels, positions, parts).** The hand-built Rev D shapes are replaced by meshes exported from the Rev P2 drawing model (`tools/export_sim.py` → `src/geometryP2.js`): 57 drawing parts, about 71 000 triangles. This covers:

- the frame (40 × 40 × 4 angle) with rails at 150, 640, 1150 and 1480, the welded foot plates and rubber pads, and the reducer and motor base plates;
- the hopper, the deck tray and bar sets, the grade bins, the selector plate, the feed chute and the side plates;
- the Ø89 serrated rollers, the shafts, the carriage, the UCFL208 bearings, the die springs and stop studs;
- the toothed 50B17 sprockets and 15T idlers, and the slip coupling;
- the motor, belt, pulleys and WPA reducer;
- the deck gearmotor and bracket, the eccentric and rod, and the deck links;
- the catch funnel, canvas sleeve, screen box, screen hanger links, screen drive arm and link;
- the blower and duct, the kernel chute, the pan and the tub;
- the belt, chain and coupling guards, and the control panel.

The #50 chain (58 links) is generated in the browser along the drawing's serpentine path (S1–I1–I2–S2), and is re-routed live when the gap changes.

**Grading deck.** Parallel bars replace the three perforated decks: top bars 25.5 mm clear, middle bars 22.5 mm, and a solid tray at the bottom (Rev3 §10.2). A nut now settles into the groove between two bars and drops through when its width is smaller than the clear spacing. A nut that stays up rides on the two bars, and its height in the groove is computed from its width and the bar pitch. Each level discharges at the lower deck end into its own bin. Widths and kernels are sampled from our measurement sheet (Rev3 Table 1), replacing the old 20–36 mm placeholder ranges.

**Drives.**
- Main drive: the 0.5 hp motor and jaw coupling are replaced by 1.5 kW → V-belt 1:1 → WPA 40:1 → slip coupling → fixed roller.
- Deck drive: the take-off chain and jackshaft are gone. A separate DC deck gearmotor drives the 8 mm eccentric, which drives the 130 mm rod, which drives the deck. The deck hangs on four 40 mm links and is solved as a parallelogram.
- Screen box: the old rocker lever driven from the main shaft is gone. The box now hangs on four 50 mm links and is driven from the deck through the arm and link, as drawn.
- Blower: separate.
- Each drive has its own Start/Stop. One latching E-stop (panel button or the red mushroom in the 3D panel) stops all three.
- Optional Sheet 13 interlock (K1 needs K2).
- New deck-speed (PWM) slider. Nuts stop moving below A = rω² = 1.68 m/s².

**Numbers from the calculations.**

| Quantity | Rev D | Now |
|---|---|---|
| Roller speed | 36 rpm | 44 rpm, nip transit at the rim speed of 205 mm/s |
| Roller diameter | Ø150 | Ø89 |
| Gaps | 10–27 mm, old window | Rev3 stops 17.7 / 20.4 / 23.4 mm; window from Table 2 (e_low = k_max + 0.5, e_high = w_min − 1.08 − 0.5) |
| Crack judgement | DEFORM 1.1 / CLEAR 0.5 | δf = 1.08 / ck = 0.5 |
| Deck | 52 strokes/min, 4 mm throw | 180 rpm, 16 mm stroke (3 Hz) |
| Bin release | slide gates | one nut per roller revolution |

**Feed and separation.**
- Slide gates, interlock bar, funnel and V-channel are replaced by the sliding selector plate (it moves under the chosen bin) and the 35° chute with an 88 mm throat.
- The coarse screen, sorting tray, cross-flow split, kernel tray, chip tray and waste drawer are replaced by the oscillating 8 mm screen box with air, the kernel chute and tub, and the fines pan.
- Shell halves and uncracked nuts now ride to the tub, where they are picked off (Rev3 §12). The repass button returns uncracked nuts from the tub.

**Readouts and views.**
- Count rows were updated for the new outputs:
  - mis-graded nuts in the bins
  - nuts through the nip in the last minute
  - fines in the pan
  - large chips in the tub
  - chips lifted out by the air
- Camera presets were moved to the new layout. There are new Deck drive and Screen drive views, and the nip view draws the parts in front of the nip see-through.
- The part inspector now shows the drawing part number, the material, how the part is made or bought, and the calculation it comes from.

**Correction (23 Nov).** The reducer text no longer says the worm is self-locking. At the efficiency the 1.5 kW motor needs (≥ 0.64) it is not (Rev3 §5.6).

## What was kept

- The operator workflow: start, choose a grade, set the gap, watch, return uncracked nuts, refill the hopper.
- The particle framework and stage-by-stage nut motion, the triangular nut shape, nut orientation (lying on the chute, tip-first into the nip, ridge toward the movable roller), and the crack judgement logic.
- Fragments: kernel, two halves, chips and dust.
- The playback speed, exploded view, subsystem toggles, part inspector, flow-path overlay, 1.70 m operator and 1 m scale bar.
- Drag-to-orbit, zoom, pinch, and tap-to-identify.
- The React panel layout and styling.

## Still differs from the drawings, or needs a team check

1. **Deck stroke is offset.** With the drawn 130 mm rod, the drawn pose (links vertical) is one end of the stroke. The deck and screen box move 0 to 16 mm toward the upper end, the deck links swing 0 to −24° (not ±11° as the notes say), the screen links 0 to −19°, and the deck rises 3.4 mm at the end of each stroke. A rod of about 138 mm c/c, or the lug moved 8 mm, centres the stroke. The simulation animates it as drawn.
2. **Large shell chips have nowhere to go.** Chips too big for the 8 mm holes are lifted by the air, but the drawings have no chip outlet or hood. The simulation shows them leaving the open top of the screen box. Add an outlet, or accept hand-picking.
3. **Deck-level-to-bin routing lips are not drawn.** The simulation assumes top → back bin (large), middle → centre (medium), tray → front (small).
4. **Separate drive switching is not in the drawn circuit.** In the Sheet 13 circuit the deck drive and the blower share relay K2, so they cannot be started separately. The separate Start buttons are a what-if; separate switching needs a second relay or switches on the panel.
5. **Bar count.** The drawings show 9 + 9 = 18 bars of Ø9.5, while Add. B R4-B says "16 bars Ø10". Settle one figure for the BOM.
6. **Tubs.** The BOM lists 3 PP tubs, but only one is drawn, under the kernel chute. Say where the other two go, or change the quantity.
7. **Hopper feed rate.** The hopper empties straight onto the deck with no gate, so the feed rate is not controlled on the drawings. The conveying speed (60 mm/s) and where nuts fall through are animation assumptions. Measure both on the bench deck.
8. **Visual simplifications only.** The screen holes are a texture (8 mm at 12 mm pitch, approximate stagger). The chain links are spaced evenly along the live path, within about 1 mm of exact tooth seating. The pulleys turn slower than 1 760 rpm.
