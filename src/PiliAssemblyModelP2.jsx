import React, { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import { P2, PARTS, CHUNKS, MESH_B64 } from "./geometryP2.js";
import { PART_INFO, SUB_OF } from "./partInfoP2.js";

/* ================================================================
   PILI NUT SHELL CRACKER — SIMULATION, DRAWING SET Rev P3 (closed nut path)
   Revision of PiliAssemblyModelRevD.jsx (Rev D audited build).

   What changed from Rev D
   · Geometry now comes from the Rev P2 drawing model (params.py /
     model.py, the same model that produced the 13 sheets). The meshes
     are exported by tools/export_sim.py into src/geometryP2.js, so every
     part has the drawn shape and position. Re-run that script after a
     params.py change and the simulation follows the sheets.
   · Grading deck: parallel bars, 25.5 mm (top) and 22.5 mm (middle)
     clear, solid tray at the bottom (Rev3 §10.2). A nut drops through
     a bar level when its width is smaller than the bar spacing.
   · Drives: main motor 1.5 kW → V-belt → WPA 40:1 → slip coupling →
     fixed roller (44 rpm); separate DC deck gearmotor with an 8 mm
     eccentric and connecting rod (180 rpm, 3 Hz); separate blower.
     Each drive starts and stops on its own; one latching E-stop stops
     all three. Optional Sheet 13 interlock (K1 needs K2).
   · Feed (P3): staggered deck lips → 3-compartment bin box → selector plate
     (slides across) → 30° chute → single file → metering gate → nip.
     A \"nuts lost\" counter checks the whole closed path; it must stay 0.
     (the Rev D V-channel and slide gates are gone).
   · Separation: catch funnel → canvas sleeve → oscillating 8 mm screen
     box (driven from the deck) with blower air → kernel chute → PP tub;
     fines and small chips → pan.
   Kept from Rev D: operator workflow, nut motion framework, crack
   judgement, controls, readouts, part inspector, exploded view,
   subsystem toggles, camera presets, scale reference.

   Drawing coordinates are used inside the machine group: mm, X right,
   Y back, Z up, fixed-roller axis at X = 0, Y = 0, Z = Zr. The group is
   turned −90° about X so three.js keeps y-up (front = +z on screen).
   ================================================================ */

"use strict";

// ---------------- numbers from the calculations (Rev3, Addendum A rev B) ----------------
const D2R = Math.PI / 180;
const ROLLER_RPM = 44;                          // Rev3 §4: 1 760 rpm / 40
const W_ROLL = (ROLLER_RPM * 2 * Math.PI) / 60; // rad/s
const VNIP = (Math.PI * P2.D * ROLLER_RPM) / 60; // roller rim speed, mm/s (≈ 205)
const DECK_RPM0 = 180;                          // Rev3 §10.3, Add. B §15-B
const ECC = P2.ecc;                             // 8 mm eccentric (16 mm stroke)
const MU_DECK = 0.35, G_MS2 = 9.81;             // nut-on-rod friction (Rev3 §10, [VERIFY])
const A_MIN = G_MS2 * (MU_DECK * Math.cos(P2.deck_inc * D2R) - Math.sin(P2.deck_inc * D2R));   // 1.68 m/s²: below this nuts do not move
const A_BACK = G_MS2 * (MU_DECK * Math.cos(P2.deck_inc * D2R) + Math.sin(P2.deck_inc * D2R));  // ≈ 5.1 m/s²: above this nuts may slide back
const deckAcc = (rpm) => (ECC / 1000) * Math.pow((rpm * 2 * Math.PI) / 60, 2);
const V_CONV0 = 60;                             // mm/s conveying speed at 180 rpm — ANIMATION ASSUMPTION, not calculated
const convSpeed = (rpm) => { const A = deckAcc(rpm), A0 = deckAcc(DECK_RPM0); return A <= A_MIN ? 0 : V_CONV0 * Math.min(1.6, (A - A_MIN) / (A0 - A_MIN)); };
// crack judgement (Rev3 §2): crack needs compression ≥ δf; kernel needs gap ≥ k + ck
const DF = 1.08, CK = 0.5, MARGIN = 0.5;
const GAPMIN = +(P2.gap_S - 2).toFixed(1), GAPMAX = 27;   // carriage slot starts 2 mm below the small-grade stop
// grade statistics from our nut measurement sheet (Rev3 Table 1); shares from the 91 / 177 / 33 nuts measured
const GRADES = [
  { key: "large", label: "Large", range: "≥ 25.0", w: [25.0, 27.9], wm: 25.72, ws: 0.84, k: [14.2, 18.4], km: 16.18, ks: 1.06, share: 33, gap: P2.gap_L, color: 0x4f351f },
  { key: "medium", label: "Medium", range: "22.0–24.9", w: [22.0, 24.7], wm: 23.0, ws: 0.76, k: [12.0, 17.0], km: 14.5, ks: 1.02, share: 177, gap: P2.gap_M, color: 0x5d3f26 },
  { key: "small", label: "Small", range: "≤ 21.9", w: [19.3, 21.9], wm: 20.87, ws: 0.66, k: [11.0, 16.28], km: 12.85, ks: 0.97, share: 91, gap: P2.gap_S, color: 0x6b4a2e },
];
const recWindow = (g) => [+(g.k[1] + CK).toFixed(2), +(g.w[0] - DF - MARGIN).toFixed(2)];   // Rev3 Table 2: e_low, e_high
function judge(gap, nut) {
  if (nut.w - gap < DF) return "uncracked";
  if (gap < nut.k + CK) return "crushed";
  return "whole";
}

// ---------------- layout derived from the drawing parameters ----------------
const Zr = P2.Zr, C0 = P2.C, GAP0 = P2.gap_M;
const DK = { cx: P2.deck_cx, cz: P2.deck_cz, L: P2.deck_L, W: P2.deck_W, h: P2.dck_h, th: P2.deck_inc * D2R, bd: P2.bar_d, g: P2.gi };
const LVL_ZC = [P2.lv_mid + P2.deck_lv, P2.lv_mid, P2.gi];             // bar centre lines (top, middle) and tray floor, deck-local z (P3: 95 / 45)
const LVL_S = [P2.bar_top, P2.bar_mid, null];                       // clear bar spacing per level
const LVL_PCH = [P2.bar_top + P2.bar_d, P2.bar_mid + P2.bar_d, null];
const LIP_END = [P2.pxL, P2.pxM, DK.L];                              // where each level discharges, deck-local x (large lip, medium lip, tray end)
const LIP_Z = [P2.zlipL, P2.zlipM, P2.gi];                           // lip / tray top surface, deck-local z
const deckPt = (px, pz) => { const X_ = px - DK.L / 2, Z_ = pz - DK.h / 2, c = Math.cos(DK.th), s = Math.sin(DK.th); return [DK.cx + X_ * c + Z_ * s, DK.cz - X_ * s + Z_ * c]; };
const deckPx = (X, pz) => { const Z_ = pz - DK.h / 2; return (X - DK.cx - Z_ * Math.sin(DK.th)) / Math.cos(DK.th) + DK.L / 2; };
// ---- grade bin box PNC-010: three compartments in a row under the staggered lips (Add. C §C2–C3)
const BX = [P2.bin_xs0, P2.bin_D1, P2.bin_D2, P2.bin_xL1];          // downstream wall, dividers, end wall (global X)
const BTOP = P2.bin_tops;                                            // tops of those four walls (global Z)
const BW = P2.bin_Wb / 2;                                            // inside half-width (Y)
const GRADE_COMP = [2, 1, 0];                                        // grade (0 large, 1 medium, 2 small) → compartment (0 S, 1 M, 2 L)
const COMP_CAP = [170, 92, 13];                                      // nuts per compartment: 5.2 / 3.4 / 0.6 L at 0.5 kg/L, 15 / 18.5 / 24 g (Add. C §C3, estimate)
const compOfX = (x) => (x < BX[1] ? 0 : x < BX[2] ? 1 : 2);
const CHUTE = { xo: P2.chute[0], zo: P2.chute[1], s1: P2.chute[2], s2: P2.chute[3], send: P2.chute[4], a: P2.chute_ang * D2R };
const chuteZ = (X) => CHUTE.zo + (X - CHUTE.xo) * Math.tan(CHUTE.a);                 // chute floor top (P3: passes through the exit point)
const binFloorZ = (X) => chuteZ(X) + (P2.bin_nb0 + P2.gi) / Math.cos(CHUTE.a);      // bin floor top, global
const chuteHalf = (s) => (s <= CHUTE.s1 ? P2.ch_sf / 2 : s >= CHUTE.s2 ? P2.ch_w / 2 : P2.ch_sf / 2 + ((s - CHUTE.s1) / (CHUTE.s2 - CHUTE.s1)) * (P2.ch_w - P2.ch_sf) / 2);
const CH_T = new THREE.Vector3(Math.cos(CHUTE.a), 0, Math.sin(CHUTE.a));       // up-chute
const CH_N = new THREE.Vector3(-Math.sin(CHUTE.a), 0, Math.cos(CHUTE.a));      // chute floor normal
const S_GATE = (118 - CHUTE.xo) / Math.cos(CHUTE.a);                            // metering gate PNC-043, 44 mm up from the exit
const CH_SLOTS = [S_GATE + 22, S_GATE + 80, S_GATE + 138, S_GATE + 196];        // single-file queue behind the gate, mm along the chute
const OUT_S = P2.bin_out_s.map((s) => s + P2.out_l / 2), OUT_Y = P2.bin_out_y;  // bin outlet centres (along the chute, Y)
const SEL_SHIFT = (k) => (1 - k) * P2.sel_pitch;                                 // selector Y offset that opens compartment k
const selShiftOfGrade = (gi) => SEL_SHIFT(GRADE_COMP[gi]);
const FUN = { top: P2.fun_z0 + P2.fun_h, x: C0 / 2 };
const SB = { cx: P2.sb_c[0], cz: P2.sb_c[1], th: P2.sb_inc * D2R, zb: P2.sb_zb };
const screenZ = (X) => { const Z_ = SB.zb + P2.ss - SB.cz, c = Math.cos(SB.th), s = Math.sin(SB.th); const X_ = (X - SB.cx - Z_ * s) / c; return SB.cz - X_ * s + Z_ * c; };
const sbPt = (xl, zl) => { const X_ = xl - SB.cx, Z_ = zl - SB.cz, c = Math.cos(SB.th), s = Math.sin(SB.th); return [SB.cx + X_ * c + Z_ * s, SB.cz - X_ * s + Z_ * c]; };
const SB_HOLES_END = SB.cx + (P2.sb_x0 + P2.sb_L - 60 - SB.cx) * Math.cos(SB.th) + (SB.zb + P2.ss - SB.cz) * Math.sin(SB.th);
const SB_HOLES_START = sbPt(P2.sb_x0 + 15, SB.zb)[0];
const SB_OUT = P2.sbpt_out[0] - 4;
const SPOUT = (() => { const [x, z] = sbPt(P2.sb_x0 + 225, SB.zb + 58); return { x, z, y: P2.sb_W / 2 + 50 }; })();   // chip spout PNC-045 mouth
const BAG = { x: SPOUT.x, y: P2.sb_W / 2 + 92, z0: SPOUT.z - 330 };
const KCH = { x0: P2.kc_top[0], z0: P2.kc_top[1], dx: Math.cos(68 * D2R), dz: -Math.sin(68 * D2R), len: 130 };
const TUB = { x: P2.tub[0], floor: P2.tub[2] + 3, x0: P2.tub[0] - 62, x1: P2.tub[0] + 62, y0: -86, y1: 86, top: P2.tub[2] + P2.tub[5] };
const PAN = { x0: P2.pan[0] + 2, x1: P2.pan[0] + P2.pan[3] - 2, y0: P2.pan[1] + 2, y1: P2.pan[1] + P2.pan[4] - 2, floor: P2.pan[2] + 1.5 };
const HOP = { x: P2.hop_x, z: P2.fz + 10 };
const PANEL = { x: P2.fx1 - P2.ang - P2.pan_w, z: 700, y0: P2.fy0 };

// ---------------- materials ----------------
const NUTMAT = GRADES.map((g) => new THREE.MeshStandardMaterial({ color: g.color, roughness: 0.9 }));
const KERNELMAT = new THREE.MeshStandardMaterial({ color: 0xead9b4, roughness: 0.7 });
const KERNELBAD = new THREE.MeshStandardMaterial({ color: 0xa8352a, roughness: 0.7 });
const SHELLMAT = new THREE.MeshStandardMaterial({ color: 0x3d2a18, roughness: 0.95, side: THREE.DoubleSide });
const CHIPMAT = new THREE.MeshStandardMaterial({ color: 0x4e3620, roughness: 0.95 });
const DUSTMAT = new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 1 });
function partMaterial(p) {
  const c = new THREE.Color(p.col[0], p.col[1], p.col[2]);
  const k = p.ck;
  if (k === "guard") return new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.28, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide, depthWrite: false });
  if (k === "canvas") return new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.55, roughness: 0.95, side: THREE.DoubleSide, depthWrite: false });
  if (k === "pp") return new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.6, roughness: 0.5, side: THREE.DoubleSide, depthWrite: false });
  const metal = { shaft: 0.75, roller: 0.75, sprocket: 0.7, chain: 0.7, bearing: 0.5, hub: 0.7, zinc: 0.6, gi: 0.55, ss: 0.8, ss202: 0.8, screen: 0.7, pulley: 0.6, disc: 0.6, gearbox: 0.5 }[k];
  return new THREE.MeshStandardMaterial({ color: c, metalness: metal ?? 0.25, roughness: metal ? 0.4 : 0.65, side: THREE.DoubleSide });
}

// ---------------- helpers (kept from Rev D) ----------------
function tag(obj, name, desc) { obj.traverse((o) => { o.userData.pname = name; o.userData.pdesc = desc; }); return obj; }
function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }
function cyl(r, h, mat, seg = 24) { return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); }
// pili nut: triangular-section spindle, long axis local +y, ridge (a triangle vertex) at local +z
function nutMesh(w, L, mat) {
  const r = 0.62 * w, g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * r, r, 0.52 * L, 3, 1, false), mat); top.position.y = 0.26 * L;
  const bot = new THREE.Mesh(new THREE.CylinderGeometry(r, 0.28 * r, 0.48 * L, 3, 1, false), mat); bot.position.y = -0.24 * L;
  g.add(top, bot); return g;
}
const _qm = new THREE.Matrix4(), _vx = new THREE.Vector3();
function basisQuat(longAxis, ridge) {   // local +y → longAxis, local +z → ridge
  const y = longAxis.clone().normalize(), z = ridge.clone().normalize();
  _vx.crossVectors(y, z).normalize();
  _qm.makeBasis(_vx, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(_qm);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);
function gauss() { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function truncNorm(m, s, lo, hi) { for (let i = 0; i < 30; i++) { const x = m + s * gauss(); if (x >= lo && x <= hi) return x; } return Math.min(hi, Math.max(lo, m)); }
// perforated sheet: canvas tile with staggered holes, used as an alpha map (drawing XY plane)
function perfMaterial(lenX, lenY, aperture, pitch) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"); const s = 128 / (2 * pitch);
  g.fillStyle = "#d6dce1"; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = "destination-out";
  const r = (aperture / 2) * s;
  for (const [hx, hy] of [[pitch / 2, pitch / 2], [pitch * 1.5, pitch / 2], [0, pitch * 1.5], [pitch, pitch * 1.5], [2 * pitch, pitch * 1.5]]) { g.beginPath(); g.arc(hx * s, hy * s, r, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(lenX / (2 * pitch), lenY / (2 * pitch));
  return new THREE.MeshStandardMaterial({ map: t, metalness: 0.6, roughness: 0.4, alphaTest: 0.5, side: THREE.DoubleSide });
}
const Q_CHUTE = basisQuat(CH_T.clone().negate(), CH_N);           // lying on the chute, long axis down-slope
const Q_NIP = basisQuat(V(0, 0, -1), V(1, 0, 0));                  // tip-first, ridge toward the movable roller (+X)
const chutePt = (s, y, up) => V(CHUTE.xo + s * CH_T.x + up * CH_N.x, y, CHUTE.zo + s * CH_T.z + up * CH_N.z);

// ---------------- serpentine chain path (port of model.py chain_path, Rev3 §6) ----------------
function chainWheels(Cc) {
  const rs = P2.Dp_spk / 2, ri = P2.Dp_idl / 2;
  return [[[0, Zr], rs, 1], [[P2.I1x, Zr + P2.I1z], ri, 1], [[Cc + rs + ri, Zr + P2.I2z], ri, 1], [[Cc, Zr], rs, -1]];
}
function chainPath(Cc, nArc = 48) {
  const Wh = chainWheels(Cc), n = Wh.length, arr = {}, lea = {}, TAU = 2 * Math.PI;
  for (let i = 0; i < n; i++) {
    const [ca, ra, sa] = Wh[i], [cb, rb, sb] = Wh[(i + 1) % n]; const dx = cb[0] - ca[0], dz = cb[1] - ca[1];
    const t = Math.atan2(dz, dx) + Math.asin((sb * rb - sa * ra) / Math.hypot(dx, dz)); const nR = [Math.sin(t), -Math.cos(t)];
    lea[i] = [ca[0] - sa * ra * nR[0], ca[1] - sa * ra * nR[1]]; arr[(i + 1) % n] = [cb[0] - sb * rb * nR[0], cb[1] - sb * rb * nR[1]];
  }
  const pts = [];
  Wh.forEach(([c, r, s], i) => {
    const a0 = Math.atan2(arr[i][1] - c[1], arr[i][0] - c[0]), a1 = Math.atan2(lea[i][1] - c[1], lea[i][0] - c[0]);
    const sw = ((((s > 0) ? a0 - a1 : a1 - a0) % TAU) + TAU) % TAU;
    for (let k = 0; k <= nArc; k++) { const a = a0 - (s * sw * k) / nArc; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  });
  const cum = [0]; for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  return { pts, cum, L: cum[cum.length - 1] };
}
function chainAt(path, s) {
  const L = path.L; s = ((s % L) + L) % L; let lo = 0, hi = path.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path.cum[m] <= s) lo = m; else hi = m; }
  const a = path.pts[lo], b = path.pts[(lo + 1) % path.pts.length], f = (s - path.cum[lo]) / Math.max(1e-9, path.cum[lo + 1] - path.cum[lo]);
  return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
}

function decodeMeshes() {
  const bin = atob(MESH_B64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const buf = u8.buffer, out = [];
  for (const c of CHUNKS) {
    const q = new Int16Array(buf, c.off, c.nv * 3), pos = new Float32Array(c.nv * 3);
    for (let i = 0; i < pos.length; i++) pos[i] = q[i] * 0.1;
    const idx = c.big ? new Uint32Array(buf, c.ioff, c.nt * 3) : new Uint16Array(buf, c.ioff, c.nt * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals(); g.computeBoundingSphere();
    out.push({ c, g });
  }
  return out;
}

function buildScene(mountEl, hooks) {
/* ---------- state ---------- */
const LIVE = { gap: GAP0, explode: 0, feeding: true, speed: 1, main: true, deck: true, blower: true, estop: false, interlock: true, deckRpm: DECK_RPM0, air: 0 };
const api = {};
let selGrade = 1;
const showPick = (name, desc) => hooks.onPick(name ? { name, desc: desc || "" } : null);
const pushDrives = () => hooks.onDrives({ main: LIVE.main, deck: LIVE.deck, blower: LIVE.blower, estop: LIVE.estop, interlock: LIVE.interlock });
/* ---------- scene ---------- */
const mount = mountEl;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe4e8);
const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / Math.max(1, mount.clientHeight), 5, 15000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(mount.clientWidth, mount.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
mount.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9096, 0.85));
const key = new THREE.DirectionalLight(0xffffff, 0.75); key.position.set(900, 1800, 1200); scene.add(key);
const fill = new THREE.DirectionalLight(0xcfe0f0, 0.35); fill.position.set(-1000, 700, -900); scene.add(fill);
const grid = new THREE.GridHelper(4000, 40, 0xa8b2ba, 0xccd3d9); grid.position.y = -1; scene.add(grid);

// machine group in drawing coordinates (Z up) → three.js y-up
const root = new THREE.Group(); root.rotation.x = -Math.PI / 2; scene.add(root);
const SUBVEC = {   // exploded-view direction per subsystem, drawing coordinates (× 220 mm)
  frame: V(0, 0, 0), cracking: V(0, -0.9, 0.25), adjustment: V(0.9, -0.9, 0.25), drive: V(0, 1.4, -0.2), deckdrive: V(-0.8, 0.6, 0.3),
  sorting: V(0, 0, 1.3), feeding: V(0.7, 0, 0.6), separation: V(-0.3, 0, -0.6), guards: V(0, -2.0, 0.2),
};
const subMeshes = {}; Object.keys(SUBVEC).forEach((k) => (subMeshes[k] = []));
const subVis = { frame: true, cracking: true, adjustment: true, drive: true, deckdrive: true, sorting: true, feeding: true, separation: true, guards: true, flow: true, nuts: true, scale: true };
const exMeshes = [];

/* ---------- bodies (pivot groups) ---------- */
function pivotGroup(parent, px, py, pz) {
  const g = new THREE.Group(); g.position.set(px, py, pz); const inner = new THREE.Group(); inner.position.set(-px, -py, -pz); g.add(inner); parent.add(g); g.userData.inner = inner; return g;
}
const I1 = [P2.I1x, Zr + P2.I1z];
const i2x0 = C0 + P2.Dp_spk / 2 + P2.Dp_idl / 2, I2 = [i2x0, Zr + P2.I2z];
const PHI0 = P2.crank_phi, ECC_C = P2.ecc_c, K0 = [ECC_C[0] + ECC * Math.cos(PHI0), ECC_C[1] + ECC * Math.sin(PHI0)], L0 = P2.lug;
const ROD_ANG0 = Math.atan2(L0[1] - K0[1], L0[0] - K0[0]);
const HANG = P2.hang_z;                                  // [x, z_low (deck pin), z_top (frame pin)]
const SBP = P2.sb_pins;                                  // [x, z_low (box pin), z_top]
const ARM = P2.arm;                                      // [xd, zdeck pin, za (link height), xa (box bracket), yarm]
const A0 = [ARM[0], ARM[2]], B0 = [ARM[3], ARM[2]], LINK_LEN = Math.hypot(B0[0] - A0[0], B0[1] - A0[1]);
const SPR_FIX = P2.spring_x0 + P2.sp_Lp;
const body = {};
body.static = root;
body.rotF = pivotGroup(root, 0, 0, Zr);
body.carriage = pivotGroup(root, 0, 0, 0);
body.rotC = pivotGroup(body.carriage.userData.inner, C0, 0, Zr);
body.rotI2 = pivotGroup(body.carriage.userData.inner, I2[0], P2.ys, I2[1]);
body.rotI1 = pivotGroup(root, I1[0], P2.ys, I1[1]);
body.springs = pivotGroup(root, SPR_FIX, 0, Zr); body.springF = body.springs; body.springB = body.springs;
body.pulU = pivotGroup(root, P2.pul_x, P2.y_red, P2.z_worm);
body.pulL = pivotGroup(root, P2.pul_x, P2.y_red, P2.z_mot);
body.deck = pivotGroup(root, 0, 0, 0);
body.hangA = pivotGroup(root, HANG[0][0], 0, HANG[0][2]);
body.hangB = pivotGroup(root, HANG[1][0], 0, HANG[1][2]);
body.ecc = pivotGroup(root, ECC_C[0], 0, ECC_C[1]);
body.rod = pivotGroup(root, K0[0], 0, K0[1]);
body.selector = pivotGroup(root, 0, 0, 0);
body.box = pivotGroup(root, 0, 0, 0);
body.sbl0 = pivotGroup(root, SBP[0][0], 0, SBP[0][2]);
body.sbl1 = pivotGroup(root, SBP[1][0], 0, SBP[1][2]);
body.sblink = pivotGroup(root, A0[0], 0, A0[1]);

const partByPn = Object.fromEntries(PARTS.map((p) => [p.pn, p]));
const matByPn = {};
function partDesc(p, bodyKey) {
  const info = PART_INFO[`${p.pn}:${bodyKey}`] || PART_INFO[p.pn] || "";
  return `${info} — ${p.kind === "buy" ? "Purchased" : "Made"}: ${p.mat}${p.qty > 1 ? `, qty ${p.qty}` : ""}.${p.proc ? " Make: " + p.proc + "." : ""}`;
}
function registerMesh(m, pn, bodyKey, exObj) {
  const p = partByPn[pn]; const sub = SUB_OF[pn] || "frame";
  tag(m, `${pn} — ${p ? p.name : pn}`, p ? partDesc(p, bodyKey) : "");
  m.userData.pn = pn; m.userData.sub = sub;
  const ex = SUBVEC[sub].clone().multiplyScalar(220); if (p) ex.add(V(p.ex[0], p.ex[1], p.ex[2]).multiplyScalar(1.2));
  const eo = exObj || m; eo.userData.ex = ex; exMeshes.push(eo); subMeshes[sub].push(m);
}
// a mesh placed at its own position gets a wrapper group, so the exploded-view offset does not overwrite the placement
function placed(parent, mesh, x, y, z) { const w = new THREE.Group(); parent.add(w); mesh.position.set(x, y, z); w.add(mesh); return w; }
for (const { c, g } of decodeMeshes()) {
  if (c.pn === "PNC-037") continue;                         // the screen is rebuilt below with a perforated texture
  const p = partByPn[c.pn]; if (!matByPn[c.pn]) matByPn[c.pn] = partMaterial(p);
  const m = new THREE.Mesh(g, matByPn[c.pn]);
  if (p.ck === "guard") m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: 0xc89a10 })));
  if (c.pn === "J") m.userData.isStopNut = true;
  const tgt = body[c.body] || root; (tgt === root ? root : tgt.userData.inner).add(m);
  registerMesh(m, c.pn, c.body);
  if (c.pn === "J") m.traverse((o) => (o.userData.isStopNut = true));
}
// screen PNC-037: perforated part (holes end 60 mm before the outlet) + plain end, on the box
{
  const ss = P2.ss, x0 = P2.sb_x0 + ss, x1 = P2.sb_x0 + P2.sb_L - ss, xh = P2.sb_x0 + P2.sb_L - 60, wY = P2.sb_W - 2 * ss;
  const mk = (a, b, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, wY, ss), mat);
    const w = new THREE.Group(), piv = new THREE.Group(); piv.position.set(SB.cx, 0, SB.cz); piv.rotation.y = SB.th;   // +10° about +Y drops the +X end
    m.position.set((a + b) / 2 - SB.cx, 0, SB.zb + ss / 2 - SB.cz); piv.add(m); w.add(piv); body.box.userData.inner.add(w);
    registerMesh(m, "PNC-037", "box", w); return m;
  };
  mk(x0, xh, perfMaterial(xh - x0, wY, P2.screen, P2.scr_pitch));
  mk(xh, x1, new THREE.MeshStandardMaterial({ color: 0xdadfe3, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }));
}
// E-stop mushroom and start buttons on the panel face (coloured overlays on part P)
let estopMesh = null;
{
  const ex = PANEL.x + P2.pan_w / 2, ez = PANEL.z + P2.pan_h - 50;
  estopMesh = cyl(19, 17, new THREE.MeshStandardMaterial({ color: 0xd01a12, roughness: 0.45, emissive: 0x000000 }));
  registerMesh(estopMesh, "P", "static", placed(root, estopMesh, ex, PANEL.y0 - 22, ez));
  tag(estopMesh, "Emergency stop (S0) — click to press", "Latching red mushroom on the panel. Stops the main motor, the deck gearmotor and the blower together (stop category 0, Sheet 13). Reset it in the panel before restarting.");
  estopMesh.userData.isEstop = true;
  const g1 = cyl(11.5, 11, new THREE.MeshStandardMaterial({ color: 0x2f9e44, roughness: 0.5 })); registerMesh(g1, "P", "static", placed(root, g1, PANEL.x + 60, PANEL.y0 - 7, PANEL.z + 90));
  const g2 = cyl(11.5, 11, new THREE.MeshStandardMaterial({ color: 0x1f2328, roughness: 0.5 })); registerMesh(g2, "P", "static", placed(root, g2, PANEL.x + 110, PANEL.y0 - 7, PANEL.z + 90));
}

/* ---------- chain #50, 58 links, generated and animated here ---------- */
const chainG = new THREE.Group(); root.add(chainG);
const NL = P2.links | 0;
const chainMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.75, roughness: 0.45 });
const rollerI = new THREE.InstancedMesh(new THREE.CylinderGeometry(P2.roll_d / 2, P2.roll_d / 2, P2.roll_w, 14), chainMat, NL);
const pinI = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.55, 2.55, P2.roll_w + 4 * P2.plate_t + 2.4, 8), new THREE.MeshStandardMaterial({ color: 0x9aa3ac, metalness: 0.8, roughness: 0.35 }), NL);
let plateI;
{
  const p = P2.pitch, r = 0.43 * P2.plate_h, sh = new THREE.Shape();
  sh.absarc(p, 0, r, -Math.PI / 2, Math.PI / 2, false); sh.absarc(0, 0, r, Math.PI / 2, 1.5 * Math.PI, false);
  const g = new THREE.ExtrudeGeometry(sh, { depth: P2.plate_t, bevelEnabled: false, curveSegments: 8 });
  g.rotateX(Math.PI / 2); g.translate(0, P2.plate_t / 2, 0);
  plateI = new THREE.InstancedMesh(g, chainMat, NL * 2);
}
chainG.add(rollerI, pinI, plateI);
[rollerI, pinI, plateI].forEach((m) => registerMesh(m, "G", "chain"));
let chainPathNow = chainPath(C0), chainS = 0;
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _yAx = new THREE.Vector3(0, 1, 0);
function placeChain() {
  const path = chainPathNow, step = path.L / NL, ys = P2.ys, w = P2.roll_w, t = P2.plate_t; const pts = [];
  for (let k = 0; k < NL; k++) pts.push(chainAt(path, chainS + k * step));
  for (let k = 0; k < NL; k++) {
    const [x, z] = pts[k]; _q.identity(); _p.set(x, ys, z); _s.set(1, 1, 1);
    _m4.compose(_p, _q, _s); rollerI.setMatrixAt(k, _m4); pinI.setMatrixAt(k, _m4);
    const [x2, z2] = pts[(k + 1) % NL]; const ang = Math.atan2(z2 - z, x2 - x), d = Math.hypot(x2 - x, z2 - z);
    const off = k % 2 === 0 ? w / 2 + t / 2 : w / 2 + 1.5 * t;
    _q.setFromAxisAngle(_yAx, -ang); _s.set(d / P2.pitch, 1, 1);
    for (let j = 0; j < 2; j++) { _p.set(x, ys + (j ? 1 : -1) * off, z); _m4.compose(_p, _q, _s); plateI.setMatrixAt(2 * k + j, _m4); }
  }
  rollerI.instanceMatrix.needsUpdate = pinI.instanceMatrix.needsUpdate = plateI.instanceMatrix.needsUpdate = true;
}
placeChain();

/* ---------- air stream (blower → duct → screen box), shown while the blower runs ---------- */
const airG = new THREE.Group(); root.add(airG);
const airMat = new THREE.MeshBasicMaterial({ color: 0x5aa9e6, transparent: true, opacity: 0.0, depthWrite: false });
const airP = [];
for (let i = 0; i < 22; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(3.2, 6, 4), airMat); m.userData.s = Math.random(); m.userData.y = rnd(-40, 40); m.userData.dz = rnd(-20, 25); airG.add(m); airP.push(m); }
const AIR0 = [P2.blw_x + P2.blw_d / 2 + 8, P2.blw_z + (P2.blw_d / 2) * 0.55 - 5 + P2.duct_h / 2];
function placeAir(dt) {
  airMat.opacity = 0.55 * LIVE.air;
  for (const m of airP) {
    m.userData.s = (m.userData.s + dt * 0.9 * LIVE.air) % 1; const s = m.userData.s;
    const x = AIR0[0] + s * (300 - AIR0[0]); const zs = x < P2.sbpt_inlet[0] ? AIR0[1] : screenZ(x) + 25 + m.userData.dz + 30 * s;
    m.position.set(x + (x > P2.sbpt_inlet[0] ? bxNow : 0), m.userData.y, zs + (x > P2.sbpt_inlet[0] ? bzNow : 0));
  }
}

/* ---------- flow-path overlay ---------- */
const flowG = new THREE.Group(); root.add(flowG);
{
  const seg = (p1, p2, name, col = 0x1f8a4c) => {
    const dir = new THREE.Vector3().subVectors(p2, p1); const len = dir.length();
    const a = new THREE.ArrowHelper(dir.clone().normalize(), p1, len, col, Math.min(26, len * 0.3), 14);
    flowG.add(tag(a, "Material flow: " + name, "Toggleable overlay — hopper → bar deck (grading by width) → grade bins → selector plate → feed chute → nip → funnel → oscillating 8 mm screen with air → kernel chute → tub; fines to the pan; dashed = manual return of uncracked nuts."));
  };
  const dp = (px, lv) => { const [x, z] = deckPt(px, LVL_ZC[lv] + 25); return V(x, 0, z); };
  seg(V(HOP.x, 0, HOP.z + 10), V(HOP.x, 0, deckPt(deckPx(HOP.x, LVL_ZC[0]), LVL_ZC[0])[1] + 30), "hopper → top bars");
  seg(dp(160, 0), dp(560, 0), "top bars: nuts ≥ 25.5 mm wide stay on top");
  seg(dp(300, 0).add(V(0, 0, -20)), dp(300, 1).add(V(0, 0, 5)), "narrower than the bar spacing → drops through");
  seg(dp(330, 1).add(V(0, 0, -20)), dp(330, 2).add(V(0, 0, 5)), "narrower than 22.5 mm → drops to the tray");
  GRADES.forEach((g, gi) => {        // each level runs off its own lip and drops into its own compartment
    const [x, z] = deckPt(LIP_END[gi] - 20, LIP_Z[gi] + 25); const k = GRADE_COMP[gi]; const xb = Math.min(BX[k + 1] - 20, Math.max(BX[k] + 20, x + 25));
    seg(V(x, -60 + 40 * gi, z), V(xb, -60 + 40 * gi, binFloorZ(xb) + 20), `${g.label.toLowerCase()} lip → ${g.label.toLowerCase()} compartment`);
  });
  const so = OUT_S[1]; const P0 = chutePt(so, 0, P2.bin_nb0 + 10), P1 = chutePt(so, 0, 12);
  seg(V(P0.x, OUT_Y, P0.z), V(P1.x, OUT_Y, P1.z), "selected compartment → selector opening → chute");
  const Q0 = chutePt(OUT_S[0], 0, 25), Q1 = chutePt(S_GATE + 10, 0, 25);
  seg(Q0, Q1, "30° feed chute → single file → metering gate");
  const R0 = chutePt(S_GATE - 5, 0, 20); seg(R0, V(C0 / 2 + 10, 0, Zr + 60), "gate → nip, one nut at a time");
  seg(V(C0 / 2, 0, Zr - 30), V(C0 / 2, 0, P2.fun_z0 - 5), "nip → catch funnel → canvas sleeve");
  seg(V(70, 0, screenZ(70) + 30), V(SB_OUT, 0, screenZ(SB_OUT) + 30), "oscillating screen → kernel outlet");
  seg(V(180, 0, screenZ(180) - 10), V(180, 0, PAN.floor + 30), "fines and small chips → pan", 0x777777);
  seg(V(KCH.x0, 0, KCH.z0 + 10), V(TUB.x, 0, TUB.floor + 140), "kernel chute → tub");
  seg(V(AIR0[0] - 30, 0, AIR0[1]), V(P2.sbpt_inlet[0] + 30, 0, AIR0[1]), "blower air → screen box", 0x2f7fc2);
  seg(V(120, 0, screenZ(120) + 45), V(SPOUT.x, SPOUT.y - 20, SPOUT.z), "light chips carried by the air → chip spout (cover PNC-045)", 0xb0692a);
  seg(V(SPOUT.x, SPOUT.y + 20, SPOUT.z - 20), V(BAG.x, BAG.y, BAG.z0 + 40), "chip spout → chip bag T", 0xb0692a);
  const dash = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(TUB.x, -120, TUB.floor + 120), V(TUB.x, -380, 900), V(BX[3] + 60, -260, 1250), V(BX[3] - 30, 0, BTOP[3] + 20)]), new THREE.LineDashedMaterial({ color: 0x1f8a4c, dashSize: 18, gapSize: 12 }));
  dash.computeLineDistances(); flowG.add(tag(dash, "Manual return of uncracked nuts", "The operator picks uncracked nuts out of the tub and returns them to the matching compartment for one repass — logged as operator time"));
}

/* ---------- scale reference: 1.70 m operator + floor scale bar (three.js world, y-up) ---------- */
const scaleG = new THREE.Group(); scene.add(scaleG);
{
  const skin = new THREE.MeshStandardMaterial({ color: 0x8d99a6, roughness: 0.85, transparent: true, opacity: 0.4, depthWrite: false });
  const op = new THREE.Group();
  const limb = (r, h, x, y) => { const m = cyl(r, h, skin, 12); m.position.set(x, y, 0); return m; };
  op.add(limb(58, 880, -85, 440), limb(58, 880, 85, 440));
  const torso = box(360, 560, 200, skin); torso.position.y = 1170; op.add(torso);
  op.add(limb(46, 540, -238, 1150), limb(46, 540, 238, 1150));
  const neck = cyl(45, 70, skin, 10); neck.position.y = 1480; op.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(105, 16, 12), skin); head.position.y = 1585; op.add(head);
  op.position.set(-760, 0, 420);
  scaleG.add(tag(op, "Operator (1.70 m) — scale reference", "Not part of the machine. Stands at the front, where the panel and E-stop, the selector plate handle, the grade bins and the tub are within reach. Toggle it off under Show subsystems."));
  const barY = -4, barZ = 1000, barX0 = -500;
  for (let s = 0; s < 4; s++) {
    const seg = box(250, 4, 46, new THREE.MeshStandardMaterial({ color: s % 2 ? 0xf2f4f6 : 0x2b3238, roughness: 0.9 })); seg.position.set(barX0 + 125 + s * 250, barY, barZ);
    scaleG.add(tag(seg, "Scale bar — 1 m", "Four 250 mm segments; floor grid squares are 100 mm."));
  }
}

/* ---------- NUT SIMULATION (Rev P3, closed path): hopper throat → bar deck → staggered lips → bin box → selector → 30° chute → metering gate → nip → screen → tub / pan / chip bag ---------- */
const nutsG = new THREE.Group(); root.add(nutsG);
const G = 9810;                                     // gravity, mm/s²
const PART = [];
// counts.bins / mis are indexed by GRADE (0 large, 1 medium, 2 small); comps by compartment (0 S, 1 M, 2 L)
const counts = { hopper: 60, bins: [0, 0, 0], mis: [0, 0, 0], chute: 0, cracked: 0, whole: 0, crushed: 0, halves: 0, uncracked: 0, fines: 0, chipsTub: 0, blown: 0, bag: 0,
  repassed: 0, lost: 0, crossed: 0, waiting: 0, fed: 0 };
const lostLog = [];                                 // where each escape happened (must stay empty)
function markLost(p, where) {
  counts.lost++; lostLog.push({ where, kind: p.kind, x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), t: +simT.toFixed(1) });
  if (lostLog.length > 50) lostLog.shift();
  p.stage = "lostFall"; p.t = 0;
}
const binQueues = [[], [], []];                     // by grade
const chuteList = [];
const piles = { tub: [] };
const tubUncracked = [];
const crackTimes = [];
let nipBusy = false, spawnTimer = 0.3, releaseTimer = 0, simT = 0;
let dxDeck = 0, dzDeck = 0, bxNow = 0, bzNow = 0, dgNow = 0, convNow = 0;
const hopperPile = new THREE.Mesh(new THREE.BoxGeometry(108, 138, 1), new THREE.MeshStandardMaterial({ color: 0x5a3e27, roughness: 0.95 }));
hopperPile.position.set(HOP.x, 0, HOP.z + 40); nutsG.add(tag(hopperPile, "Nuts in the hopper", "Dried, depulped nuts; fill to the line 100 mm above the outlet (5.5 L batch, Add. C §C3). The throat lip 40 mm above the top bars lets the deck draw them out one layer at a time."));
// piles in the three compartments: a slab lying on the 30° bin floor that thickens with the count
const compPiles = [0, 1, 2].map((k) => {
  const len = (BX[k + 1] - BX[k] - 4) / Math.cos(CHUTE.a);
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, 2 * BW - 8, 1), NUTMAT[GRADE_COMP.indexOf(k)]);
  const w = new THREE.Group(); w.add(m); const xm = (BX[k] + BX[k + 1]) / 2; w.position.set(xm, 0, binFloorZ(xm)); w.rotation.y = -CHUTE.a;
  nutsG.add(w); return m;
});
const compH = (k, n) => 2 + (n / COMP_CAP[k]) * (k === 2 ? 30 : k === 1 ? 45 : 60);   // drawn pile thickness, mm (visual only)
function compCount(k) { return counts.bins[GRADE_COMP.indexOf(k)]; }

function sampleNut() {
  const tot = GRADES.reduce((a, g) => a + g.share, 0); let r = Math.random() * tot, gi = 0;
  while (r > GRADES[gi].share && gi < 2) { r -= GRADES[gi].share; gi++; }
  const g = GRADES[gi], z = gauss();
  const w = truncNorm(g.wm, g.ws, g.w[0], g.w[1]);
  const kz = 0.5 * ((w - g.wm) / g.ws) + 0.866 * z;
  const k = Math.min(g.k[1], Math.max(g.k[0], g.km + g.ks * kz));
  return { g: gi, w, k, L: Math.min(58, Math.max(34, w * rnd(1.6, 2.1))) };
}
function addP(p) { PART.push(p); nutsG.add(p.mesh); return p; }
function removeP(p) { const i = PART.indexOf(p); if (i >= 0) PART.splice(i, 1); nutsG.remove(p.mesh); }
function nutParticle(d, stage) {
  const mesh = nutMesh(d.w, d.L, NUTMAT[d.g]);
  tag(mesh, `${GRADES[d.g].label} pili nut — ${d.w.toFixed(1)} mm wide, kernel ${d.k.toFixed(1)} mm`, "Width and kernel sampled from our measurement sheet (Rev3 Table 1). On the deck it drops through a bar level when its width is smaller than the bar spacing (25.5 / 22.5 mm); each level then discharges over its own lip into its own compartment.");
  return { kind: "nut", mesh, stage, t: 0, v: V(0, 0, 0), x: 0, y: 0, z: 0, ...d, rad: 0.31 * d.w };
}
const lieQuat = (yaw) => basisQuat(V(Math.cos(yaw), Math.sin(yaw), 0), V(0, 0, 1));
const Q_DECK = basisQuat(V(Math.cos(DK.th), 0, -Math.sin(DK.th)), V(Math.sin(DK.th), 0, Math.cos(DK.th)));
// nut centre height (deck-local z) on a level: in the groove between two bars, on a solid lip past the bar ends, or on the tray
function lvlZ(lvl, w, px) {
  if (lvl === 2) return LVL_ZC[2] + 0.31 * w;
  if (px !== undefined && px > DK.L - 8) return LIP_Z[lvl] + 0.31 * w;
  const half = (w + DK.bd) / 2, p2 = LVL_PCH[lvl] / 2;
  return LVL_ZC[lvl] + Math.sqrt(Math.max(0, half * half - p2 * p2)) + 0.05 * w;
}
const slotY = (lvl, y) => { if (lvl === 2) return Math.max(-DK.W / 2 + 25, Math.min(DK.W / 2 - 25, y)); const p = LVL_PCH[lvl]; const k = Math.max(-4, Math.min(3, Math.floor(y / p))); return (k + 0.5) * p; };
function spawnHopperNut() {
  const d = sampleNut(); const p = nutParticle(d, "hopperDrop");
  p.x = HOP.x + rnd(-45, 45); p.y = rnd(-55, 55);
  const px = deckPx(p.x, LVL_ZC[0]); p.z = deckPt(px, LVL_ZC[0] + DK.bd / 2 + P2.thr_gap - 6)[1];      // leaves under the throat lip
  p.v.set(0, 0, -60); p.yaw = rnd(0, Math.PI);
  p.mesh.quaternion.copy(lieQuat(p.yaw)); addP(p); counts.hopper--; counts.fed++;
}
function releaseFromBin(gi) {
  const k = GRADE_COMP[gi], d = binQueues[gi].shift(); counts.bins[gi]--; if (d.g !== gi) counts.mis[gi]--;
  const p = nutParticle(d, "binDrop"); const so = OUT_S[k] + rnd(-12, 12);
  const P0 = chutePt(so, 0, P2.bin_nb0 + P2.gi);
  p.x = P0.x; p.y = OUT_Y + rnd(-18, 18) + (selNow - selShiftOfGrade(gi)); p.z = P0.z; p.s = so; p.v.set(0, 0, 0);
  p.mesh.quaternion.copy(lieQuat(rnd(-0.4, 0.4))); addP(p); chuteList.push(p); counts.chute = chuteList.length;
}
function fragMesh(kind, p, size) {
  if (kind === "kernel") {
    const g = new THREE.SphereGeometry(p.k / 2, 14, 10); g.scale(1, 1, 1.55);
    const m = new THREE.Mesh(g, p.outcome === "crushed" ? KERNELBAD : KERNELMAT);
    if (p.outcome === "crushed") m.scale.set(1.15, 1.15, 0.5);
    return tag(m, p.outcome === "crushed" ? "Crushed kernel" : "Whole kernel", p.outcome === "crushed" ? "The stop was set below this nut's kernel width + 0.5 mm" : "Shell fractured; the kernel cleared the stop");
  }
  if (kind === "half") { const m = nutMesh(p.w, p.L * 0.9, SHELLMAT); m.scale.z = 0.45; return tag(m, "Shell half", "Too heavy for the air (Rev3 §12): rides to the tub, where the operator picks it off"); }
  if (kind === "chip") return tag(new THREE.Mesh(new THREE.TetrahedronGeometry(size * 0.55), CHIPMAT), `Shell chip ≈ ${size.toFixed(0)} mm`, size < P2.screen ? "Smaller than the 8 mm holes: drops through the screen into the pan" : "Bigger than the 8 mm holes: lifted by the air and carried out through the chip spout into the chip bag (P3)");
  return tag(new THREE.Mesh(new THREE.SphereGeometry(1.6, 6, 5), DUSTMAT), "Dust", "Passes the 8 mm screen into the pan");
}
function spawnFragments(p) {
  const xc = (C0 + dgNow) / 2;
  const mk = (kind, vx, vy, size = 0) => {
    const f = { kind, mesh: fragMesh(kind, p, size), stage: "fall", t: 0, x: xc + rnd(-4, 4), y: rnd(-12, 12), z: Zr - 50, v: V(vx, vy, -150), w: p.w, k: p.k, g: p.g, L: p.L, outcome: p.outcome, size,
      rad: kind === "kernel" ? p.k / 2 : kind === "half" ? 0.14 * p.w : kind === "chip" ? size * 0.3 : 1.6, spin: V(rnd(-4, 4), rnd(-4, 4), rnd(-4, 4)) };
    if (kind === "half") f.mesh.quaternion.copy(lieQuat(rnd(0, Math.PI)));
    addP(f);
  };
  mk("kernel", rnd(-10, 10), rnd(-10, 10));
  mk("half", rnd(-60, -20), rnd(-20, 20)); mk("half", rnd(20, 60), rnd(-20, 20));
  for (let i = 0; i < 3; i++) mk("chip", rnd(-40, 40), rnd(-30, 30), rnd(3, 12));
  mk("dust", rnd(-30, 30), rnd(-30, 30)); mk("dust", rnd(-30, 30), rnd(-30, 30));
}
function settleTub(p) {
  p.stage = "settled"; const pile = piles.tub;
  p.x = rnd(TUB.x0 + p.rad + 4, TUB.x1 - p.rad - 4); p.y = rnd(TUB.y0 + p.rad + 4, TUB.y1 - p.rad - 4);
  p.z = TUB.floor + p.rad + Math.min(30, pile.length * 0.8);
  p.mesh.position.set(p.x, p.y, p.z); p.mesh.rotation.set(rnd(0, 1), rnd(0, 1), rnd(0, 6));
  pile.push(p);
  if (pile.length > 46) { const old = pile.find((q) => !(q.kind === "nut")); if (old) { pile.splice(pile.indexOf(old), 1); removeP(old); } }
}
// wall test for a nut falling from a lip into the bin box: returns false if it would leave the box (= lost)
function binWalls(p) {
  if (Math.abs(p.y) + p.rad > BW) return false;                          // past a side wall
  for (let i = 0; i < 4; i++) {                                          // the four cross walls: hit only below their tops
    const xw = BX[i] + (i === 0 ? 1.5 : 0.75);
    if (p.z - p.rad < BTOP[i]) {
      if (p.px0 < xw && p.x + p.rad > xw) { p.x = xw - p.rad; p.v.x = -0.25 * Math.abs(p.v.x); }
      else if (p.px0 > xw && p.x - p.rad < xw) { p.x = xw + p.rad; p.v.x = 0.25 * Math.abs(p.v.x); }
    }
  }
  return p.x > BX[0] && p.x < BX[3] + 1.5;
}
function updateParticles(dt) {
  simT += dt;
  const deckMoves = LIVE.deck && convNow > 0;
  // hopper: nuts leave only while the deck carries them away from under the throat lip
  spawnTimer -= dt;
  if (LIVE.feeding && deckMoves && counts.hopper > 0 && spawnTimer <= 0) { spawnHopperNut(); spawnTimer = 1.3 * (V_CONV0 / Math.max(15, convNow)); }
  const hp = Math.max(4, (counts.hopper / 60) * 150); hopperPile.scale.z = hp; hopperPile.position.z = HOP.z + 5 + hp / 2;
  // release from the selected compartment through the selector opening (one nut per roller revolution; the single-file queue holds four)
  releaseTimer -= dt;
  if (binQueues[selGrade].length > 0 && chuteList.length < CH_SLOTS.length && releaseTimer <= 0 && Math.abs(selNow - selShiftOfGrade(selGrade)) < 2) { releaseFromBin(selGrade); releaseTimer = 60 / ROLLER_RPM; }
  for (let k = 0; k < 3; k++) { const n = compCount(k); compPiles[k].scale.z = compH(k, n); compPiles[k].position.z = compH(k, n) / 2; compPiles[k].visible = n > 0; }
  counts.waiting = 0;
  for (let i = PART.length - 1; i >= 0; i--) {
    const p = PART[i], m = p.mesh; p.t += dt;
    switch (p.stage) {
      case "hopperDrop": {
        p.v.z = Math.max(-1500, p.v.z - G * dt); p.z += p.v.z * dt;
        const px = deckPx(p.x - dxDeck, LVL_ZC[0]); const zs = deckPt(px, lvlZ(0, p.w) + 4 + DK.bd / 2)[1] + dzDeck;
        if (Math.abs(p.y) + p.rad > DK.W / 2) markLost(p, "hopper to deck: outside the skirts");
        else if (p.z <= zs) { p.stage = "deck"; p.lvl = 0; p.px = px; p.fallAt = p.w < LVL_S[0] ? Math.min(DK.L - 24, px + rnd(30, 170)) : 1e9; p.settle = 0; }
        m.position.set(p.x, p.y, p.z); break;
      }
      case "deck": {
        // a full compartment backs its lip up: the nut waits at the lip end (stays on the deck, not lost)
        const k = GRADE_COMP[p.lvl], full = compCount(k) + PART.filter((q) => q.stage === "lipFall" && q.lvl === p.lvl).length >= COMP_CAP[k];
        const stop = LIP_END[p.lvl] - 12;
        if (deckMoves && !(full && p.px >= stop)) { p.px = Math.min(full ? stop : 1e9, p.px + convNow * dt); p.settle = Math.min(1, p.settle + 3 * dt); }
        if (full && p.px >= stop) counts.waiting++;
        p.y += (slotY(p.lvl, p.y) - p.y) * Math.min(1, (deckMoves ? 5 : 0) * dt);
        const zl = lvlZ(p.lvl, p.w, p.px) + (1 - p.settle) * (DK.bd / 2 + 4);
        const [x, z] = deckPt(p.px, zl); p.x = x + dxDeck; p.z = z + dzDeck;
        m.quaternion.copy(Q_DECK); m.position.set(p.x, p.y, p.z);
        if (Math.abs(p.y) + p.rad > DK.W / 2 + 0.5) { markLost(p, "deck: over a skirt"); break; }
        if (p.lvl < 2 && p.px >= p.fallAt && p.px < DK.L - 8 && Math.abs(slotY(p.lvl, p.y) - p.y) < 1.5) { p.stage = "deckFall"; p.v.set(convNow * Math.cos(DK.th), 0, 0); }
        else if (p.px >= LIP_END[p.lvl]) {                    // over the lip end: falls with the deck's and the conveying speed
          const vDeck = (2 * Math.PI * LIVE.deckRpm / 60) * ECC * Math.cos(thE);
          p.stage = "lipFall"; p.px0 = p.x; p.v.set(convNow * Math.cos(DK.th) + vDeck * rnd(0, 1), 0, -convNow * Math.sin(DK.th)); p.t = 0;
        }
        break;
      }
      case "deckFall": {
        p.v.z = Math.max(-1500, p.v.z - G * dt); p.z += p.v.z * dt; p.x += p.v.x * dt;
        const nl = p.lvl + 1, px = deckPx(p.x - dxDeck, LVL_ZC[nl]); const zs = deckPt(px, lvlZ(nl, p.w, px))[1] + dzDeck;
        if (p.z <= zs) { p.lvl = nl; p.px = px; p.stage = "deck"; p.settle = 1; p.fallAt = nl < 2 && p.w < LVL_S[nl] ? Math.min(DK.L - 24, px + rnd(20, 140)) : 1e9; }
        m.position.set(p.x, p.y, p.z); break;
      }
      case "lipFall": {                                       // free fall into the bin box; walls are real, so a bad overlap would show here
        p.v.z = Math.max(-1500, p.v.z - G * dt); p.px0 = p.x; p.x += p.v.x * dt; p.z += p.v.z * dt; m.rotation.x += 3 * dt;
        if (!binWalls(p)) { markLost(p, "deck lip to bin: outside the bin box"); break; }
        const k = compOfX(p.x), top = binFloorZ(p.x) + compH(k, compCount(k)) + p.rad;
        if (p.z <= top) {
          const gi = GRADE_COMP.indexOf(k);
          if (k !== GRADE_COMP[p.lvl]) counts.crossed++;   // landed in another grade's compartment: must stay 0
          counts.bins[gi]++; if (p.g !== gi) counts.mis[gi]++; binQueues[gi].push({ g: p.g, w: p.w, k: p.k, L: p.L }); removeP(p);
        } else m.position.set(p.x, p.y, p.z);
        break;
      }
      case "binDrop": {                                       // through the bin outlet and the selector opening onto the chute
        p.v.z = Math.max(-1500, p.v.z - G * dt); p.z += p.v.z * dt;
        const zs = chuteZ(p.x) + p.rad / Math.cos(CHUTE.a);
        if (p.z <= zs) {
          if (Math.abs(p.y) + p.rad > chuteHalf(p.s) + 0.5) { const j = chuteList.indexOf(p); if (j >= 0) chuteList.splice(j, 1); counts.chute = chuteList.length; markLost(p, "bin outlet: missed the chute channel"); break; }
          p.stage = "chute"; p.vs = 0; p.q0 = m.quaternion.clone(); p.t = 0;
        }
        m.position.set(p.x, p.y, p.z); break;
      }
      case "chute": {
        const idx = chuteList.indexOf(p); const target = CH_SLOTS[Math.max(0, idx)];
        p.vs = Math.min(1200, p.vs + 1932 * dt);              // g(sin30 − 0.35 cos30) = 1.93 m/s² (Add. C §C3)
        if (p.s > target) p.s = Math.max(target, p.s - p.vs * dt); else p.vs = 0;
        const half = chuteHalf(p.s) - p.rad - 1;
        p.y += (0 - p.y) * Math.min(1, (p.s < CHUTE.s2 ? 6 : 1.5) * dt); p.y = Math.max(-half, Math.min(half, p.y));
        m.position.copy(chutePt(p.s, p.y, p.rad)); m.quaternion.copy(p.q0).slerp(Q_CHUTE, Math.min(1, p.t * 3));
        if (idx === 0 && p.s <= target + 0.01 && !nipBusy && LIVE.main) {   // the gate lets the first nut through when the nip is free
          nipBusy = true; chuteList.shift(); counts.chute = chuteList.length;
          p.stage = "gate"; p.t = 0;
        }
        break;
      }
      case "gate": {                                          // under the metering gate and down the single-file channel to the exit
        p.vs = Math.min(1200, p.vs + 1932 * dt); p.s -= Math.max(120, p.vs) * dt; p.y *= 0.8;
        m.position.copy(chutePt(Math.max(0, p.s), p.y, p.rad)); m.quaternion.copy(Q_CHUTE);
        if (p.s <= 0) { p.stage = "entry"; p.t = 0; p.from = m.position.clone(); p.outcome = judge(LIVE.gap, p); }
        break;
      }
      case "entry": {
        const k = Math.min(1, p.t / 0.3); const to = V((C0 + dgNow) / 2, 0, Zr + P2.D / 2 + 0.2 * p.L);
        m.position.lerpVectors(p.from, to, k); m.quaternion.copy(Q_CHUTE).slerp(Q_NIP, k);
        if (k >= 1) { p.stage = "nip"; p.z = to.z; }
        break;
      }
      case "nip": {
        if (LIVE.main) p.z -= VNIP * dt;              // a nut in the nip moves only while the rollers turn
        m.position.set((C0 + dgNow) / 2, 0, p.z);
        const sq = Math.max(0.55, LIVE.gap / p.w);
        if (p.outcome !== "uncracked") { const f = Math.max(0, Math.min(1, (Zr + 30 - p.z) / 30)); m.scale.z = 1 - (1 - sq) * f; }
        if (p.z <= Zr - 50) {
          nipBusy = false; crackTimes.push(simT);
          if (p.outcome === "uncracked") { counts.uncracked++; p.kind = "nut"; p.stage = "fall"; p.x = (C0 + dgNow) / 2; p.y = 0; p.v.set(0, 0, -VNIP); p.rad = 0.31 * p.w; p.spin = V(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)); m.scale.z = 1; }
          else { counts.cracked++; counts[p.outcome]++; removeP(p); spawnFragments(p); }
        }
        break;
      }
      case "fall": {                                          // between the side plates (Y ±47) into the catch funnel
        p.v.z = Math.max(-1800, p.v.z - G * dt);
        p.x += p.v.x * dt; p.y += p.v.y * dt; p.z += p.v.z * dt;
        if (p.z > FUN.top) { const yl = P2.pl_y - p.rad; if (Math.abs(p.y) > yl) { p.y = Math.sign(p.y) * yl; p.v.y *= -0.3; } }
        if (!p.inFun && p.z <= FUN.top) {
          p.inFun = true;
          if (Math.abs(p.x - FUN.x) > 150 || Math.abs(p.y) > 45) { markLost(p, "nip to funnel: missed the funnel mouth"); break; }
        }
        if (p.z < FUN.top) { const k = Math.min(1, 5 * dt); p.x += (FUN.x - p.x) * k; p.y += (0 - p.y) * k; p.v.x *= 0.85; p.v.y *= 0.85; }
        if (p.spin) { m.rotation.x += p.spin.x * dt; m.rotation.y += p.spin.y * dt; m.rotation.z += p.spin.z * dt; }
        if (p.z <= screenZ(p.x - bxNow) + p.rad + bzNow) {
          p.sx = p.x - bxNow; p.t = 0; p.y = Math.max(-75, Math.min(75, p.y + rnd(-25, 25)));
          if (p.kind === "dust" || (p.kind === "chip" && p.size < P2.screen)) { p.stage = "onScreen"; p.passAt = p.sx + rnd(5, 60); }
          else if (p.kind === "chip" && LIVE.air > 0.5) { p.stage = "blown"; p.t = 0; p.from = V(p.x, p.y, p.z); counts.blown++; }
          else { p.stage = "onScreen"; p.passAt = 1e9; if (p.kind === "nut" || p.kind === "half") m.quaternion.copy(lieQuat(rnd(-0.5, 0.5))); }
        }
        m.position.set(p.x, p.y, p.z); break;
      }
      case "onScreen": {
        if (deckMoves) p.sx += convNow * dt;           // the screen box is driven from the deck: no deck drive, no conveying
        p.x = p.sx + bxNow; p.z = screenZ(p.sx) + p.rad + bzNow;
        m.position.set(p.x, p.y, p.z); if (p.spin && deckMoves) m.rotation.z += p.spin.z * 0.2 * dt;
        if (p.sx >= p.passAt && p.sx < SB_HOLES_END) { p.stage = "toPan"; p.v.set(0, 0, -60); }
        else if (p.sx >= SB_OUT) { p.stage = "kchute"; p.t = 0; p.from = m.position.clone(); }
        break;
      }
      case "toPan": {
        p.v.z = Math.max(-1500, p.v.z - G * dt); p.z += p.v.z * dt; m.position.set(p.x, p.y, p.z);
        if (p.z <= PAN.floor + p.rad) {
          if (p.x < PAN.x0 || p.x > PAN.x1 || p.y < PAN.y0 || p.y > PAN.y1) { markLost(p, "screen to pan: missed the pan"); break; }
          p.z = PAN.floor + p.rad; m.position.z = p.z; p.stage = "vanish"; p.t = 0; counts.fines++;
        }
        break;
      }
      case "blown": {                                         // carried by the air along the covered box and out of the chip spout into the bag
        const k = Math.min(1, p.t / 0.9);
        const a = p.from, b = V(SPOUT.x + bxNow, SPOUT.y, SPOUT.z + bzNow);
        p.x = a.x + (b.x - a.x) * k; p.y = a.y + (b.y - a.y) * k; p.z = a.z + (b.z - a.z) * k + Math.sin(k * Math.PI) * 25;
        if (p.spin) { m.rotation.x += p.spin.x * 2 * dt; m.rotation.z += p.spin.z * 2 * dt; }
        m.position.set(p.x, p.y, p.z);
        if (k >= 1) { p.stage = "bagFall"; p.v.set(0, 60, -100); }
        break;
      }
      case "bagFall": {                                       // inside the chip bag T (hangs from the spout)
        p.v.z = Math.max(-900, p.v.z - G * 0.4 * dt); p.z += p.v.z * dt; p.y = Math.min(BAG.y + 30, p.y + p.v.y * dt); m.position.set(p.x, p.y, p.z);
        if (p.z <= BAG.z0 + 8 + Math.min(40, counts.bag * 0.4)) { counts.bag++; p.stage = "vanish"; p.t = 0; }
        break;
      }
      case "lostFall": {                                      // an escaped particle: shown red as it drops to the floor
        if (!p.red) { p.red = true; p.mesh.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.color?.setHex(0xe02020); o.material.emissive?.setHex(0x550000); } }); }
        p.v.z = Math.max(-2000, p.v.z - G * dt); p.z += p.v.z * dt; p.x += p.v.x * dt; m.position.set(p.x, p.y, Math.max(2, p.z));
        if (p.z <= 2 && p.t > 3) removeP(p);
        break;
      }
      case "vanish": { if (p.t > 2.5) removeP(p); break; }
      case "kchute": {                                        // past the rubber flap onto the kernel chute (its lip runs 25 mm under the box floor)
        const k = Math.min(1, p.t / 0.5); const s = k * KCH.len;
        p.x = KCH.x0 + s * KCH.dx; p.z = KCH.z0 + s * KCH.dz + p.rad + 2; m.position.set(p.x, p.y * (1 - k * 0.6), p.z);
        if (k >= 1) { p.stage = "tubFall"; p.v.set(20, 0, -200); p.y *= 0.4; }
        break;
      }
      case "tubFall": {
        p.v.z = Math.max(-1500, p.v.z - G * dt); p.x += p.v.x * dt; p.z += p.v.z * dt; m.position.set(p.x, p.y, p.z);
        if (p.z <= TUB.top && (p.x < TUB.x0 || p.x > TUB.x1 || p.y < TUB.y0 || p.y > TUB.y1)) { markLost(p, "kernel chute to tub: missed the tub"); break; }
        if (p.z <= TUB.floor + p.rad + Math.min(30, piles.tub.length * 0.8)) {
          if (p.kind === "nut") tubUncracked.push({ p, d: { g: p.g, w: p.w, k: p.k, L: p.L } });
          else if (p.kind === "half") counts.halves++;
          else if (p.kind === "chip") counts.chipsTub++;
          settleTub(p);
        }
        break;
      }
      default: break;
    }
  }
  while (crackTimes.length && simT - crackTimes[0] > 60) crackTimes.shift();
}
api.returnUncracked = () => {
  let n = 0;
  while (tubUncracked.length) { const { p, d } = tubUncracked.pop(); binQueues[d.g].push(d); counts.bins[d.g]++; n++; const i = piles.tub.indexOf(p); if (i >= 0) piles.tub.splice(i, 1); removeP(p); }
  counts.uncracked = 0; counts.repassed += n; return n;
};
api.refill = () => { counts.hopper = 60; };

/* ---------- camera (three.js world: x = X, y = Z, z = −Y) ---------- */
const VIEWS = {
  iso: { t: V(90, 820, 40), th: 0.72, ph: 1.12, r: 3200, name: "" },
  grading: { t: V(40, 1290, 0), th: 0.42, ph: 0.95, r: 1500, name: "Hopper throat → parallel-bar deck (25.5 / 22.5 mm, solid tray) inside 190 mm skirts → staggered lips → three compartments" },
  feed: { t: V(330, 1110, -20), th: 1.05, ph: 0.62, r: 1250, name: "Deck lips → bin box (S / M / L) → selector plate → 30° chute → metering gate → nip" },
  nip: { t: V(C0 / 2 + 20, 815, 0), th: 0.12, ph: 0.98, r: 760, name: "Nip (front side plate, bearings, sprockets, chain and guard drawn see-through): fixed roller left, movable roller on the carriage right" },
  sep: { t: V(140, 440, 0), th: -0.5, ph: 0.78, r: 1150, name: "Catch funnel → canvas sleeve → oscillating 8 mm screen with blower air → kernel chute → tub; fines to the pan" },
  drive: { t: V(160, 520, -320), th: Math.PI + 0.55, ph: 1.15, r: 1750, name: "Main drive: 1.5 kW motor → V-belt → WPA 40:1 → slip coupling → fixed roller → #50 serpentine chain" },
  ddrive: { t: V(-160, 1190, -110), th: Math.PI + 0.95, ph: 1.1, r: 760, name: "Deck drive: DC gearmotor → 8 mm eccentric → connecting rod → deck lug; deck on four 40 mm links" },
  sdrive: { t: V(-100, 545, 175), th: -0.3, ph: 1.53, r: 520, name: "Screen-box drive: arm bolted to the deck → link → screen box on four 50 mm links" },
  top: { t: V(80, 800, -90), th: 0, ph: 0.12, r: 3200, name: "" },
};
let theta = VIEWS.iso.th, phi = VIEWS.iso.ph, radius = VIEWS.iso.r; const target = VIEWS.iso.t.clone();
function placeCam() {
  camera.position.set(target.x + radius * Math.sin(phi) * Math.sin(theta), target.y + radius * Math.cos(phi), target.z + radius * Math.sin(phi) * Math.cos(theta));
  camera.lookAt(target);
}
placeCam();
// nip view: the parts in front of the nip are drawn see-through so the rollers and the nut can be seen
const XRAY_PNS = ["PNC-013", "PNC-016", "PNC-017", "PNC-018", "PNC-020", "D", "E", "F", "PNC-035", "J", "PNC-033", "H", "PNC-019"];
function setXray(on) {
  const mats = XRAY_PNS.map((pn) => matByPn[pn]).filter(Boolean).concat([chainMat]);
  for (const m of mats) {
    if (m.userData.x0 === undefined) m.userData.x0 = { t: m.transparent, o: m.opacity, d: m.depthWrite };
    const x0 = m.userData.x0; m.transparent = on || x0.t; m.opacity = on ? Math.min(0.18, x0.o) : x0.o; m.depthWrite = on ? false : x0.d; m.needsUpdate = true;
  }
}
api.setView = (v) => { const vw = VIEWS[v] || VIEWS.iso; theta = vw.th; phi = vw.ph; radius = vw.r; target.copy(vw.t); placeCam(); setXray(v === "nip"); hooks.onStage(vw.name); };

/* ---------- drives, interlock, E-stop ---------- */
api.setDrive = (name, on) => {
  if (on && LIVE.estop) { showPick("E-stop is latched", "Twist-release the E-stop (Reset button in the panel) before starting any drive."); return; }
  if (name === "main" && on && LIVE.interlock && !(LIVE.deck && LIVE.blower)) {
    LIVE.deck = true; LIVE.blower = true;
    showPick("Start sequence (Sheet 13)", "START energises relay K2 first (deck gearmotor + blower); K2's contact then lets K1 start the main motor. Untick the interlock to run the main motor on its own.");
  }
  LIVE[name] = on;
  if (!on && LIVE.interlock && LIVE.main && (name === "deck" || name === "blower")) {
    LIVE.main = false;
    showPick("Main motor dropped out", "With the Sheet 13 interlock, K1 (rollers) is wired through a contact of relay K2 (deck + blower): stopping the deck or the blower stops the rollers too. In the drawn circuit the deck and the blower are on the same relay, so they cannot really be started separately.");
  }
  pushDrives();
};
api.estop = () => { LIVE.main = LIVE.deck = LIVE.blower = false; LIVE.estop = true; pushDrives(); showPick("EMERGENCY STOP", "All three drives stopped together (stop category 0). The rollers carry very little energy at 44 rpm, so they stop almost at once (the worm is not self-locking at the required efficiency, Rev3 §5.6). Reset the E-stop before restarting."); };
api.resetEstop = () => { LIVE.estop = false; pushDrives(); };
api.setInterlock = (b) => { LIVE.interlock = b; if (b && LIVE.main && !(LIVE.deck && LIVE.blower)) LIVE.main = false; pushDrives(); };
api.setDeckRpm = (r) => { LIVE.deckRpm = r; };

/* ---------- interaction ---------- */
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let dragging = false, moved = 0, px = 0, py = 0; const ADJ = { active: false, ly: 0 };
const cxy = (e) => [e.clientX ?? e.touches?.[0]?.clientX, e.clientY ?? e.touches?.[0]?.clientY];
const setMouse = (e) => { const r2 = renderer.domElement.getBoundingClientRect(); const [hx, hy] = cxy(e); mouse.x = ((hx - r2.left) / r2.width) * 2 - 1; mouse.y = -((hy - r2.top) / r2.height) * 2 + 1; ray.setFromCamera(mouse, camera); };
const visibleHits = () => ray.intersectObjects(scene.children, true).filter((h) => { if (h.object.isLine) return false; let o = h.object; while (o) { if (!o.visible) return false; o = o.parent; } return true; });
const nutHitAt = (e) => { setMouse(e); const h = visibleHits(); return h.length && h[0].object.userData.isStopNut; };
const onDown = (e) => { const [dx0, dy0] = cxy(e); if (nutHitAt(e)) { ADJ.active = true; ADJ.ly = dy0; moved = 99; return; } dragging = true; moved = 0; px = dx0; py = dy0; };
const onMove = (e) => {
  if (ADJ.active) { const [, my] = cxy(e); const d = my - ADJ.ly; ADJ.ly = my; LIVE.gap = Math.round(Math.min(GAPMAX, Math.max(GAPMIN, LIVE.gap - d * 0.03)) * 10) / 10; hooks.onGap(LIVE.gap); return; }
  if (!dragging) return;
  const [cx2, cy2] = cxy(e); moved += Math.abs(cx2 - px) + Math.abs(cy2 - py);
  theta -= (cx2 - px) * 0.005; phi = Math.min(1.55, Math.max(0.1, phi - (cy2 - py) * 0.005)); px = cx2; py = cy2; placeCam();
};
const onUp = () => { dragging = false; ADJ.active = false; };
const onWheel = (e) => { e.preventDefault(); radius = Math.min(6000, Math.max(250, radius + e.deltaY * 1.5)); placeCam(); };
renderer.domElement.addEventListener("mousedown", onDown);
renderer.domElement.addEventListener("touchstart", onDown, { passive: true });
const winOn = [["mousemove", onMove, undefined], ["touchmove", onMove, { passive: true }], ["mouseup", onUp, undefined], ["touchend", onUp, undefined]];
winOn.forEach(([t, f, o]) => window.addEventListener(t, f, o));
renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
let highlighted = null, hlColor = 0;
renderer.domElement.addEventListener("click", (e) => {
  if (moved > 6) return; setMouse(e);
  const all = visibleHits().filter((h) => h.object.userData.pname);
  const solid = all.filter((h) => !(h.object.material && h.object.material.transparent && h.object.material.opacity < 0.5));
  const hits = solid.length ? solid : all;
  if (highlighted) { highlighted.material.emissive?.setHex(hlColor); highlighted = null; }
  if (hits.length) {
    const o = hits[0].object;
    if (o.userData.isEstop) { api.estop(); return; }
    if (o.material?.emissive && !o.material.map && !o.isInstancedMesh) {
      // shared per-part materials: give the picked mesh its own copy so only it lights up
      if (!o.userData.ownMat) { o.material = o.material.clone(); o.userData.ownMat = true; }
      hlColor = o.material.emissive.getHex(); o.material.emissive.setHex(0x224466); highlighted = o;
    }
    showPick(o.userData.pname, o.userData.pdesc);
    if (o.userData.pn === "PNC-010" || o.userData.pn === "PNC-011") {     // which compartment was clicked: by drawing X (= three.js x)
      const k = compOfX(hits[0].point.x); api.selectGrade(GRADE_COMP.indexOf(k));
    }
  } else showPick(null, null);
});

/* ---------- kinematics ---------- */
let thF = 0, thM = 0, thE = PHI0, phiH = 0, psiB = 0, selNow = 0, lastGap = LIVE.gap;
function solveDeck(th) {      // parallelogram deck on 40 mm links, driven by the eccentric through the 138 mm rod (stroke centred, P3)
  const R = P2.rod_len, Lh = P2.hang_L, K = [ECC_C[0] + ECC * Math.cos(th), ECC_C[1] + ECC * Math.sin(th)];
  for (let i = 0; i < 8; i++) {
    const d = [Lh * Math.sin(phiH), Lh * (1 - Math.cos(phiH))], dd = [Lh * Math.cos(phiH), Lh * Math.sin(phiH)];
    const r = [L0[0] + d[0] - K[0], L0[1] + d[1] - K[1]]; const f = r[0] * r[0] + r[1] * r[1] - R * R, fp = 2 * (r[0] * dd[0] + r[1] * dd[1]);
    if (Math.abs(fp) < 1e-9) break; phiH -= f / fp; if (Math.abs(f) < 1e-6) break;
  }
  return K;
}
function solveBox(d) {        // screen box on 50 mm links, pulled by the link from the deck arm
  const Lb = P2.sb_link, A = [A0[0] + d[0], A0[1] + d[1]];
  for (let i = 0; i < 8; i++) {
    const b = [Lb * Math.sin(psiB), Lb * (1 - Math.cos(psiB))], db = [Lb * Math.cos(psiB), Lb * Math.sin(psiB)];
    const r = [B0[0] + b[0] - A[0], B0[1] + b[1] - A[1]]; const f = r[0] * r[0] + r[1] * r[1] - LINK_LEN * LINK_LEN, fp = 2 * (r[0] * db[0] + r[1] * db[1]);
    if (Math.abs(fp) < 1e-9) break; psiB -= f / fp; if (Math.abs(f) < 1e-6) break;
  }
  return A;
}
function poseBodies() {
  const dg = LIVE.gap - GAP0; dgNow = dg;
  body.carriage.position.x = dg;
  body.springs.scale.x = (P2.sp_Lp - dg) / P2.sp_Lp;
  body.rotF.rotation.y = thF; body.rotC.rotation.y = -thF;
  const rr = P2.Dp_spk / P2.Dp_idl; body.rotI1.rotation.y = thF * rr; body.rotI2.rotation.y = thF * rr;
  body.pulU.rotation.x = thM; body.pulL.rotation.x = thM;
  const K = solveDeck(thE);
  const d = [P2.hang_L * Math.sin(phiH), P2.hang_L * (1 - Math.cos(phiH))]; dxDeck = d[0]; dzDeck = d[1];
  body.deck.position.set(d[0], 0, d[1]);
  body.hangA.rotation.y = -phiH; body.hangB.rotation.y = -phiH;
  body.ecc.rotation.y = -(thE - PHI0);
  const L = [L0[0] + d[0], L0[1] + d[1]];
  body.rod.position.set(K[0], 0, K[1]); body.rod.rotation.y = -(Math.atan2(L[1] - K[1], L[0] - K[0]) - ROD_ANG0);
  const A = solveBox(d); const b = [P2.sb_link * Math.sin(psiB), P2.sb_link * (1 - Math.cos(psiB))]; bxNow = b[0]; bzNow = b[1];
  body.box.position.set(b[0], 0, b[1]); body.sbl0.rotation.y = -psiB; body.sbl1.rotation.y = -psiB;
  const Bp = [B0[0] + b[0], B0[1] + b[1]];
  body.sblink.position.set(A[0], 0, A[1]); body.sblink.rotation.y = -Math.atan2(Bp[1] - A[1], Bp[0] - A[0]);
  selNow += (selShiftOfGrade(selGrade) - selNow) * 0.12; body.selector.position.y = selNow;
}


/* ---------- escape test: sweeps the deck speed through the PWM range and every grade, then reports "nuts lost" ---------- */
let TEST = null;
api.startEscapeTest = () => {
  TEST = { t0: simT, fed0: counts.fed, lost0: counts.lost, crossed0: counts.crossed, step: -1, speed0: LIVE.speed, rpm0: LIVE.deckRpm, rpms: [140, 160, 180, 200, 220, 240] };
  LIVE.speed = 8; LIVE.main = LIVE.deck = LIVE.blower = true; LIVE.feeding = true; LIVE.estop = false; pushDrives();
  showPick("Escape test running", "Deck 140 → 240 rpm in six steps, hopper refilled, every grade cracked in turn, 8× playback. Watch the 'Nuts lost' counter: it must stay at 0.");
};
function testTick() {
  if (!TEST) return;
  const el = simT - TEST.t0, step = Math.min(TEST.rpms.length - 1, Math.floor(el / 45));
  if (step !== TEST.step) { TEST.step = step; LIVE.deckRpm = TEST.rpms[step]; hooks.onDeckRpm?.(LIVE.deckRpm); }
  if (counts.hopper < 5 && counts.fed - TEST.fed0 < 300) counts.hopper = 60;
  if (binQueues[selGrade].length === 0 && chuteList.length === 0) {   // move on to a grade that has nuts waiting; set its Rev3 stop
    const gi = [0, 1, 2].find((g) => binQueues[g].length > 0);
    if (gi !== undefined && gi !== selGrade) { api.selectGrade(gi); LIVE.gap = GRADES[gi].gap; hooks.onGap(LIVE.gap); }
  }
  const done = el > 270 || (counts.fed - TEST.fed0 >= 300 && el > 60 && binQueues.every((q) => q.length === 0) && chuteList.length === 0);
  if (done) {
    const lost = counts.lost - TEST.lost0, crossed = counts.crossed - TEST.crossed0, fed = counts.fed - TEST.fed0;
    LIVE.speed = TEST.speed0; LIVE.deckRpm = TEST.rpm0; hooks.onDeckRpm?.(LIVE.deckRpm); TEST = null;
    window.__escapeResult = { fed, lost, crossed, simSeconds: Math.round(el), log: lostLog.slice() };
    showPick(lost === 0 && crossed === 0 ? "Escape test passed: 0 nuts lost" : `Escape test FAILED: ${lost} lost, ${crossed} grade crossings`,
      `${fed} nuts fed over ${Math.round(el)} s of machine time at 140–240 rpm deck speed. Lost = any nut, kernel, shell or chip that left the closed path (deck skirts, lips, bin box, chute, funnel, screen box, pan, tub, chip bag). Crossings = a nut landing in another grade's compartment.`);
  }
}

/* ---------- animation ---------- */
const clock = new THREE.Clock();
let raf = 0, alive = true;
function animate() {
  if (!alive) return;
  raf = requestAnimationFrame(animate);
  const dtRaw = Math.min(clock.getDelta(), 0.05), dt = dtRaw * LIVE.speed, L = LIVE;
  if (Math.abs(L.gap - lastGap) > 0.05) { lastGap = L.gap; chainPathNow = chainPath(C0 + (L.gap - GAP0)); }
  for (const m of exMeshes) if (m.userData.ex) m.position.copy(m.userData.ex).multiplyScalar(L.explode);
  const quiet = L.explode < 0.05;
  nutsG.visible = quiet && subVis.nuts; flowG.visible = quiet && subVis.flow; airG.visible = quiet;
  L.air += ((L.blower ? 1 : 0) - L.air) * Math.min(1, dt * (L.blower ? 1.6 : 0.8));
  if (quiet) {
    convNow = convSpeed(L.deckRpm);
    const nSub = Math.max(1, Math.ceil(dt / 0.012)), h = dt / nSub;      // substeps keep falls and wall checks exact at high playback speed
    for (let k = 0; k < nSub; k++) {
      if (L.main) { thF += W_ROLL * h; thM += Math.min(25, W_ROLL * 40) * h; chainS += W_ROLL * (P2.Dp_spk / 2) * h; }
      if (L.deck) thE += ((L.deckRpm * 2 * Math.PI) / 60) * h;
      poseBodies(); updateParticles(h);
    }
    placeChain(); placeAir(dt); testTick();
  } else { poseBodies(); placeChain(); }
  renderer.render(scene, camera);
}
animate();
const onResize = () => { const w2 = mount.clientWidth, h2 = mount.clientHeight; if (!w2 || !h2) return; camera.aspect = w2 / h2; camera.updateProjectionMatrix(); renderer.setSize(w2, h2); };
window.addEventListener("resize", onResize);
api.zoomBy = (f) => { radius = Math.min(6000, Math.max(250, radius * f)); placeCam(); };

/* ---------- API exposed to React ---------- */
api.selectGrade = (gi) => { selGrade = gi; hooks.onGrade(gi); };
api.getGrade = () => selGrade;
api.setGap = (g) => { LIVE.gap = g; };
api.setSpeed = (s) => { LIVE.speed = s; };
api.setExplode = (e) => { LIVE.explode = e; };
api.setFeeding = (f) => { LIVE.feeding = f; };
api.getCounts = () => ({ ...counts, bins: [...counts.bins], mis: [...counts.mis], perMin: crackTimes.length, simT });
api.getLostLog = () => lostLog.slice();
api.debugStages = () => { const o = {}; for (const q of PART) { const k = q.stage + (q.lvl !== undefined ? ':' + q.lvl : ''); o[k] = (o[k] || 0) + 1; } return o; };
api.debugPart = () => PART.filter((q) => q.kind === 'nut').slice(0, 6).map((q) => ({ st: q.stage, lvl: q.lvl, px: q.px && Math.round(q.px), x: Math.round(q.x), z: Math.round(q.z), w: +q.w.toFixed(1) }));
api.debugSetLip = (lvl, px) => { LIP_END[lvl] = px; };   // negative control for the test only
api.fastForward = (sec) => {          // runs the machine without drawing (for the automated escape test)
  const h = 0.012, n = Math.round(sec / h), L = LIVE;
  for (let i = 0; i < n; i++) {
    convNow = convSpeed(L.deckRpm); L.air += ((L.blower ? 1 : 0) - L.air) * Math.min(1, h * 1.6);
    if (L.main) { thF += W_ROLL * h; chainS += W_ROLL * (P2.Dp_spk / 2) * h; }
    if (L.deck) thE += ((L.deckRpm * 2 * Math.PI) / 60) * h;
    poseBodies(); updateParticles(h); if (i % 20 === 0) testTick();
  }
  return { ...counts, simT };
};
if (typeof window !== 'undefined') window.__piliApi = api;
api.setGrade = (gi) => { selGrade = gi; };
api.recWindow = (gi) => recWindow(GRADES[gi]);
api.toggleSub = (k) => {
  subVis[k] = !subVis[k];
  if (subMeshes[k]) subMeshes[k].forEach((m) => (m.visible = subVis[k]));
  if (k === "drive") chainG.visible = subVis[k];
  if (k === "scale") scaleG.visible = subVis[k];
  return subVis[k];
};
api.showMessage = (name, desc) => showPick(name, desc);

let pinchD = 0;
const pdist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
const onTS = (e) => { if (e.touches.length === 2) pinchD = pdist(e); };
const onTM = (e) => { if (e.touches.length === 2 && pinchD) { e.stopPropagation(); const d2 = pdist(e); if (d2 > 0) api.zoomBy(pinchD / d2); pinchD = d2; } };
const onTE = (e) => { if (e.touches.length < 2) pinchD = 0; };
window.addEventListener("touchstart", onTS, { capture: true, passive: true });
window.addEventListener("touchmove", onTM, { capture: true, passive: true });
window.addEventListener("touchend", onTE, { capture: true, passive: true });

api.dispose = () => {
  alive = false;
  cancelAnimationFrame(raf);
  winOn.forEach(([t, f, o]) => window.removeEventListener(t, f, o));
  window.removeEventListener("resize", onResize);
  window.removeEventListener("touchstart", onTS, { capture: true });
  window.removeEventListener("touchmove", onTM, { capture: true });
  window.removeEventListener("touchend", onTE, { capture: true });
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => { if (x.map) x.map.dispose(); x.dispose(); });
    else if (m) { if (m.map) m.map.dispose(); m.dispose(); }
  });
  renderer.dispose();
  if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
};
pushDrives();
return api;
}

const SUBS = [
  ["frame", "Frame and foot pads"], ["cracking", "Rollers, plates, carriage"],
  ["adjustment", "Springs and stop studs"], ["drive", "Main drive and chain"],
  ["deckdrive", "Deck gearmotor and rod"], ["sorting", "Hopper and bar deck"],
  ["feeding", "Bins, selector, chute"], ["separation", "Screen box, blower, tub"],
  ["guards", "Guards and panel"], ["flow", "Flow-path arrows"],
  ["nuts", "Nuts and kernels"], ["scale", "Operator / scale bar"],
];

const VIEW_BTNS = [
  ["iso", "Overview"], ["grading", "Hopper and deck"], ["feed", "Bins and chute"],
  ["nip", "Roller nip"], ["sep", "Separation"], ["drive", "Main drive"],
  ["ddrive", "Deck drive"], ["sdrive", "Screen drive"], ["top", "Top"],
];

const COUNT_ROWS = [
  ["Hopper", (c) => c.hopper],
  ["Large compartment", (c) => c.bins[0]],
  ["Medium compartment", (c) => c.bins[1]],
  ["Small compartment", (c) => c.bins[2]],
  ["  of these, mis-graded at the bars", (c) => c.mis[0] + c.mis[1] + c.mis[2]],
  ["Waiting on a lip (compartment full)", (c) => c.waiting],
  ["On the feed chute", (c) => c.chute],
  ["Nuts through the nip, last minute", (c) => c.perMin],
  ["Whole kernels (tub)", (c) => c.whole],
  ["Crushed kernels (tub)", (c) => c.crushed],
  ["Shell halves (tub, pick off)", (c) => c.halves],
  ["Uncracked nuts (tub)", (c) => c.uncracked],
  ["Fines and small chips (pan)", (c) => c.fines],
  ["Large chips in the tub", (c) => c.chipsTub],
  ["Chips in the chip bag", (c) => c.bag],
  ["Returned for repass", (c) => c.repassed],
];

const C = {
  panel: "#10151b", line: "#2a3542", ink: "#d9e0e7", ink2: "#93a3b3",
  ink3: "#5f6f7f", accent: "#f0932b", ok: "#6fc38a", warn: "#e0b04a", bad: "#e0614f",
};

const btnBase = {
  padding: "6px 9px", fontFamily: "inherit", fontSize: 11.5, cursor: "pointer",
  borderRadius: 3, background: "transparent", color: C.ink2, border: `1px solid ${C.line}`,
};

function DriveRow({ label, sub, on, onClick, disabled }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button onClick={onClick} disabled={disabled}
        style={{ width: 74, padding: "7px 0", fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", borderRadius: 3,
                 border: `1px solid ${on ? C.ok : C.line}`, background: on ? "#1a2a22" : "transparent", color: on ? C.ok : disabled ? C.ink3 : C.ink2 }}>
        {on ? "Stop" : "Start"}
      </button>
      <div style={{ lineHeight: 1.25 }}>
        <div style={{ fontSize: 12.5, color: on ? C.ink : C.ink2 }}>{label} <span style={{ color: on ? C.ok : C.ink3, fontSize: 11 }}>{on ? "● running" : "○ stopped"}</span></div>
        <div style={{ fontSize: 10.8, color: C.ink3 }}>{sub}</div>
      </div>
    </div>
  );
}

export default function PiliAssemblyModelP2() {
  const mountRef = useRef(null);
  const apiRef = useRef(null);

  const [picked, setPicked] = useState(null);
  const [stage, setStage] = useState("");
  const [grade, setGrade] = useState(1);
  const [gap, setGap] = useState(GAP0);
  const [speed, setSpeed] = useState(1);
  const [explode, setExplode] = useState(0);
  const [feeding, setFeeding] = useState(true);
  const [deckRpm, setDeckRpm] = useState(DECK_RPM0);
  const [drives, setDrives] = useState({ main: true, deck: true, blower: true, estop: false, interlock: true });
  const [counts, setCounts] = useState(null);
  const [vis, setVis] = useState(() => Object.fromEntries(SUBS.map(([k]) => [k, true])));

  useEffect(() => {
    const api = buildScene(mountRef.current, {
      onPick: setPicked,
      onStage: setStage,
      onGrade: setGrade,
      onGap: (g) => setGap(g),
      onDrives: setDrives,
      onDeckRpm: setDeckRpm,
    });
    apiRef.current = api;
    const t = setInterval(() => setCounts(api.getCounts()), 250);
    return () => { clearInterval(t); api.dispose(); apiRef.current = null; };
  }, []);

  const api = () => apiRef.current;

  const pickGrade = useCallback((gi) => { setGrade(gi); api()?.selectGrade(gi); }, []);
  const changeGap = useCallback((g) => { setGap(g); api()?.setGap(g); }, []);

  const [lo, hi] = recWindow(GRADES[grade]);
  const gapNote =
    gap < lo ? { cls: C.bad, txt: `Below the Rev3 window ${lo}–${hi} mm for this grade: kernels wider than ${(gap - CK).toFixed(1)} mm get crushed.` }
    : gap > hi ? { cls: C.warn, txt: `Above the Rev3 window ${lo}–${hi} mm: the narrowest nuts of this grade get less than δf + margin = 1.58 mm of squeeze, so some pass uncracked.` }
    : { cls: C.ok, txt: `Inside the Rev3 window ${lo}–${hi} mm (gap ≥ largest kernel + 0.5; gap ≤ narrowest nut − 1.08 − 0.5). Rev3 stop for this grade: ${GRADES[grade].gap} mm.` };

  const A = deckAcc(deckRpm);
  const deckNote = A <= A_MIN ? { cls: C.bad, txt: `A = rω² = ${A.toFixed(2)} m/s², below the ${A_MIN.toFixed(2)} m/s² needed: nuts and kernels do not move (Rev3 §10.3).` }
    : A >= A_BACK ? { cls: C.warn, txt: `A = ${A.toFixed(2)} m/s², above ${A_BACK.toFixed(2)} m/s²: nuts may slide back up the deck.` }
    : { cls: C.ok, txt: `A = rω² = ${A.toFixed(2)} m/s² (needs ≥ ${A_MIN.toFixed(2)}), ${(deckRpm / 60).toFixed(1)} Hz, 16 mm stroke.` };

  const toggle = (k) => api()?.setDrive(k, !drives[k]);

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#171d24", color: C.ink,
                  fontFamily: '"IBM Plex Sans", system-ui, sans-serif', fontSize: 13 }}>
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <div ref={mountRef} style={{ position: "absolute", inset: 0, cursor: "grab" }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "10px 14px",
                      display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12,
                      background: "linear-gradient(rgba(23,29,36,0.92), rgba(23,29,36,0))", pointerEvents: "none" }}>
          <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            Pili nut shell cracker <span style={{ color: C.ink2, fontWeight: 400 }}>— drawing set Rev P3 (Package B, closed nut path)</span>
          </h1>
          <div style={{ fontSize: 11.5, color: C.ink2, textAlign: "right", maxWidth: 440 }}>
            Drag to orbit, wheel or pinch to zoom, tap a part to identify it. Tap a bin compartment to select its grade. Drag the stop-stud nuts to change the roller gap. Tap the red mushroom on the panel for the E-stop.
          </div>
        </div>
        {stage && (
          <div style={{ position: "absolute", bottom: 52, left: 12, font: '500 11.5px "IBM Plex Mono", monospace',
                        color: C.accent, pointerEvents: "none", maxWidth: "70%" }}>{stage}</div>
        )}
        <div style={{ position: "absolute", bottom: 12, left: 12, display: "flex", flexWrap: "wrap", gap: 6, maxWidth: "calc(100% - 24px)" }}>
          {VIEW_BTNS.map(([k, label]) => (
            <button key={k} onClick={() => api()?.setView(k)}
              style={{ ...btnBase, fontWeight: 500, background: "rgba(16,21,27,0.85)" }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ width: 340, flexShrink: 0, borderLeft: `1px solid ${C.line}`, padding: "14px 16px 18px",
                    display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", background: C.panel }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "0 0 auto" }}>
          <div style={{ fontSize: 11.5, color: C.ink2 }}>Drives (each starts and stops on its own)</div>
          <DriveRow label="Main motor" sub="1.5 kW → V-belt → WPA 40:1 → slip coupling → rollers 44 rpm" on={drives.main} disabled={drives.estop} onClick={() => toggle("main")} />
          <DriveRow label="Deck gearmotor" sub={`DC 24 V, PWM: ${deckRpm} rpm → deck and screen box`} on={drives.deck} disabled={drives.estop} onClick={() => toggle("deck")} />
          <DriveRow label="Blower" sub="≥ 0.045 m³/s at 100 Pa → screen box" on={drives.blower} disabled={drives.estop} onClick={() => toggle("blower")} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
            {!drives.estop ? (
              <button onClick={() => api()?.estop()}
                style={{ flex: 1, padding: "10px 0", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", borderRadius: 3,
                         border: "1px solid #ff6b5e", background: "#b3261e", color: "#fff", letterSpacing: 0.5 }}>E-STOP (all three)</button>
            ) : (
              <button onClick={() => api()?.resetEstop()}
                style={{ flex: 1, padding: "10px 0", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, cursor: "pointer", borderRadius: 3,
                         border: `1px solid ${C.warn}`, background: "#3a2d12", color: C.warn }}>E-stop latched — twist to reset</button>
            )}
          </div>
          <label style={{ fontSize: 11.2, color: C.ink2, display: "flex", gap: 6, alignItems: "flex-start", lineHeight: 1.4 }}>
            <input type="checkbox" checked={drives.interlock} onChange={(e) => api()?.setInterlock(e.target.checked)} style={{ accentColor: C.accent, marginTop: 2 }} />
            <span>Sheet 13 interlock: the rollers run only while the deck drive and the blower run (relay K2 → K1). Untick to run the drives fully independently.</span>
          </label>
          <div>
            <div style={{ fontSize: 11.5, color: C.ink2, marginBottom: 4 }}>Deck speed (PWM) <b style={{ color: C.ink }}>{deckRpm} rpm</b></div>
            <input type="range" min={100} max={220} step={5} value={deckRpm} style={{ width: "100%", accentColor: C.accent }}
              onChange={(e) => { const r = +e.target.value; setDeckRpm(r); api()?.setDeckRpm(r); }} />
            <div style={{ fontSize: 11.2, lineHeight: 1.4, marginTop: 2, color: deckNote.cls }}>{deckNote.txt}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flex: "0 0 auto", alignItems: "center" }}>
          <button onClick={() => { const f = !feeding; setFeeding(f); api()?.setFeeding(f); }}
            style={{ ...btnBase, background: feeding ? "#1e2a36" : "transparent", color: feeding ? C.ink : C.ink2 }}>
            {feeding ? "Hopper feeding" : "Hopper paused"}
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11.5, color: C.ink2, marginBottom: 3 }}>
              Playback speed <b style={{ color: C.ink }}>{speed.toFixed(2).replace(/\.?0+$/, "")}×</b>
            </div>
            <input type="range" min={0.25} max={4} step={0.25} value={speed} style={{ width: "100%", accentColor: C.accent }}
              onChange={(e) => { const s = +e.target.value; setSpeed(s); api()?.setSpeed(s); }} />
          </div>
        </div>

        <div style={{ flex: "0 0 auto" }}>
          <div style={{ fontSize: 11.5, color: C.ink2, marginBottom: 5 }}>
            Grade being cracked (slides the selector plate's opening under that compartment)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
            {GRADES.map((g, k) => {
              const on = grade === k;
              return (
                <button key={g.key} onClick={() => pickGrade(k)}
                  style={{ ...btnBase, borderColor: on ? C.accent : C.line, color: on ? C.accent : C.ink2, background: on ? "#2a2018" : "transparent" }}>
                  {g.label} {g.range}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ flex: "0 0 auto" }}>
          <div style={{ fontSize: 11.5, color: C.ink2, marginBottom: 5, display: "flex", justifyContent: "space-between" }}>
            <span>Roller gap (stop studs) <b style={{ color: C.ink }}>{gap.toFixed(1)}</b> mm</span>
            <button onClick={() => changeGap(GRADES[grade].gap)}
              style={{ ...btnBase, padding: "2px 7px", fontSize: 11 }}>Set Rev3 stop ({GRADES[grade].gap})</button>
          </div>
          <input type="range" min={GAPMIN} max={GAPMAX} step={0.1} value={gap} style={{ width: "100%", accentColor: C.accent }}
            onChange={(e) => changeGap(+e.target.value)} />
          <div style={{ fontSize: 11.5, lineHeight: 1.45, marginTop: 4, color: gapNote.cls }}>{gapNote.txt}</div>
        </div>

        <div style={{ flex: "0 0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "7px 9px", borderRadius: 6,
                        background: counts && (counts.lost || counts.crossed) ? "#3a1512" : "#11281a", border: `1px solid ${counts && (counts.lost || counts.crossed) ? C.bad : C.ok}` }}>
            <div style={{ flex: 1, fontSize: 12, color: C.ink }}>
              <b>Nuts lost: {counts ? counts.lost : 0}</b>
              <span style={{ color: C.ink2 }}> · grade crossings at the bins: {counts ? counts.crossed : 0}</span>
              <div style={{ fontSize: 10.5, color: C.ink2, marginTop: 2 }}>Must stay 0 in normal running. Anything that leaves the closed path turns red and is logged.</div>
            </div>
            <button style={{ ...btnBase, padding: "4px 8px", fontSize: 11 }} onClick={() => api()?.startEscapeTest()}>Escape test</button>
          </div>
          <div style={{ fontSize: 11.5, color: C.ink2, marginBottom: 5 }}>Where the nuts are</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: '"IBM Plex Mono", monospace', fontSize: 11.5 }}>
            <tbody>
              {COUNT_ROWS.map(([label, get]) => (
                <tr key={label}>
                  <td style={{ padding: "3px 0", borderBottom: "1px solid #1c252f", color: C.ink2, whiteSpace: "pre" }}>{label}</td>
                  <td style={{ padding: "3px 0", borderBottom: "1px solid #1c252f", color: C.ink, textAlign: "right" }}>
                    {counts ? get(counts) : 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button style={btnBase} onClick={() => {
              const n = api().returnUncracked();
              api().showMessage(
                n ? `${n} uncracked nut${n > 1 ? "s" : ""} returned for a repass` : "Nothing to return",
                n ? "Picked out of the tub and returned to the matching compartment; this time counts as operator-hours in the throughput comparison."
                  : "No uncracked nuts in the tub.");
            }}>Return uncracked nuts (repass)</button>
            <button style={btnBase} onClick={() => api().refill()}>Refill hopper</button>
          </div>
        </div>

        <div style={{ flex: "0 0 auto" }}>
          <div style={{ fontSize: 11.5, color: C.ink2, marginBottom: 5 }}>
            Exploded view {explode > 0.05 && <span style={{ color: C.accent }}>(motion paused)</span>}
          </div>
          <input type="range" min={0} max={1} step={0.01} value={explode} style={{ width: "100%", accentColor: C.accent }}
            onChange={(e) => { const v = +e.target.value; setExplode(v); api()?.setExplode(v); }} />
        </div>

        <div style={{ flex: "0 0 auto" }}>
          <div style={{ fontSize: 11.5, color: C.ink2, marginBottom: 5 }}>Show subsystems</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
            {SUBS.map(([k, label]) => (
              <button key={k} onClick={() => setVis((v) => ({ ...v, [k]: api().toggleSub(k) }))}
                style={{ ...btnBase, textAlign: "left", background: vis[k] ? "#1e2a36" : "transparent",
                         color: vis[k] ? C.ink : C.ink3, borderColor: vis[k] ? "#3b4c5e" : C.line }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ border: `1px solid ${picked ? C.accent : C.line}`, borderRadius: 3, padding: "10px 12px",
                      minHeight: 84, height: "auto", flex: "0 0 auto", overflowWrap: "anywhere" }}>
          <div style={{ fontSize: 11.5, color: C.ink2 }}>Part inspector</div>
          {picked ? (
            <>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: C.accent, margin: "2px 0 4px" }}>{picked.name}</div>
              <div style={{ fontSize: 11.8, color: "#b9c5d0", lineHeight: 1.5 }}>{picked.desc}</div>
            </>
          ) : (
            <div style={{ fontSize: 11.8, color: C.ink3, lineHeight: 1.5 }}>
              Tap any part of the machine: you get its drawing part number, material and what it does. Bins select the grade; the stop-stud nuts set the gap.
            </div>
          )}
        </div>

        <div style={{ fontSize: 11.5, color: C.ink2, lineHeight: 1.5, borderLeft: `2px solid ${C.accent}`, padding: "2px 0 2px 10px", flex: "0 0 auto" }}>
          Geometry is exported from the Rev P3 drawing model (tools/export_sim.py → src/geometryP2.js), so the parts have the drawn shapes and positions. Speeds and gaps are the Rev3 / Addendum A rev B and C values: rollers 44 rpm (rim 0.205 m/s), deck 180 rpm with an 8 mm eccentric, stops 17.7 / 20.4 / 23.4 mm, bars 25.5 / 22.5 mm.
        </div>

        <div style={{ fontSize: 10.5, color: C.ink3, lineHeight: 1.55, borderTop: `1px solid ${C.line}`, paddingTop: 10, flex: "0 0 auto" }}>
          <b style={{ color: C.ink2 }}>Animation assumptions, not calculations:</b> conveying speed on the deck and screen (60 mm/s at 180 rpm), where a nut falls through along the deck, how far it flies off a lip (conveying speed plus a random part of the deck speed), compartment capacities in nuts (from the 5.2 / 3.4 / 0.6 L volumes), release at one nut per roller revolution, and the paths of chips and dust. The walls, lips, outlets, chute width, funnel, pan and tub positions are the drawn ones, so an escape would show.
          {" "}<b style={{ color: C.ink2 }}>Open in the design:</b> deck and blower share relay K2 in the drawn circuit; the batch is limited by the large compartment (0.6 L); nuts turning lengthwise at the gate and hopper arching are to be checked in the trials.
        </div>
      </div>
    </div>
  );
}
