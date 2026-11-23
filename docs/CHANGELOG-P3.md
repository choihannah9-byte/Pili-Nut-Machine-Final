# Changelog — simulation Rev P3 (23 Nov 2026)

Revision of the P2 simulation to drawing set P3 (closed nut path, Addendum A Revision C). Not a rebuild: the scene, drives, controls, nip judgement and separation framework are kept.

## Geometry
- Re-exported from the P3 drawing model (`tools/export_sim.py`): new parts PNC-040 / -041 (discharge lips, move with the deck), PNC-042 (hopper throat), PNC-043 (metering gate), PNC-044 (chute supports), PNC-045 (screen-box cover with chip spout), T (chip bag) and U (rubber flap) on the screen box; PNC-010 is the 3-compartment bin box; PNC-011 the 3-opening selector; PNC-012 the 30° chute with single-file channel.
- Deck bar levels 45 / 95 mm; frame 50 mm narrower; right-face upper rail at 1 100 mm.
- Crank drawn at the angle that puts the 138 mm rod at mid-stroke (fixes the P2 off-centre stroke).

## Nut path
- Hopper: nuts leave under the throat lip (40 mm above the top bars).
- Deck: nuts ride the bars, then the solid lip of their level, and fall off the lip end with the conveying speed plus part of the deck speed.
- Bins: free fall with the drawn wall positions and tops; a compartment counts its nuts (capacities from the 5.2 / 3.4 / 0.6 L volumes); a full compartment makes nuts wait at the lip end.
- Feed: release through the aligned selector opening onto the 30° chute (1.93 m/s²), single-file queue of four behind the metering gate, one nut through the gate when the nip is free.
- Separation: fragments between the side plates into the funnel; chips carried by the air to the spout and into the bag (P2 sent them to the floor); fines must land in the pan; kernels via the chute must land in the tub.

## Checks
- `Nuts lost` and `grade crossings` counters with a log of where any escape happened; escaped particles turn red.
- `Escape test` button (and `window.__piliApi.fastForward()` for automated runs).
- Results (headless run, 23 Nov 2026): escape test 224 nuts, 140–240 rpm, all grades: 0 lost, 0 crossings. Normal 180 rpm run: 0 / 0. Negative controls: medium lip cut back to the tray end → 32 crossings; large lip cut back to the bar ends → 13 crossings.

## Still differs from the drawings / limits
- Conveying speed (60 mm/s at 180 rpm), the fly-off speed at a lip and where a nut falls through the bars are animation assumptions, not calculations.
- Compartment capacities are in nuts from an assumed 0.5 kg/L bulk density.
- Nuts are spheres for collisions; tumbling and jamming at the metering gate are not modelled (trial item).
- The standalone HTML export is still Rev D; use the Vite project.
