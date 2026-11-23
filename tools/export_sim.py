"""Export the drawing model (Rev P2) as triangle meshes for the browser simulation.

Run:  python3 export_sim.py  [out_dir]
Writes  geometryP2.js  (base64 mesh bundle and a manifest) for src/ of the pili-models project.

Every mesh is in drawing coordinates (mm, X right, Y back, Z up; fixed roller axis at X = 0, Y = 0, Z = Zr).
Parts that move in the simulation are split into 'bodies'; the simulation places each body on its own pivot.
Change params.py, rebuild nothing else: run this script again and the simulation geometry follows the sheets.
"""
import sys, os, json, math, gzip, base64, struct, time
import cadquery as cq
import model
from model import P, B, CY, rot

TOL, ANG = 0.25, 0.35          # tessellation: 0.25 mm chord, 0.35 rad angle


def bbox(s):
    b = s.BoundingBox(); return (b.xmin, b.xmax, b.ymin, b.ymax, b.zmin, b.zmax)


def classify(pn, s, C):
    """return body key for one solid of part pn"""
    x0, x1, y0, y1, z0, z1 = bbox(s); xc, yc, zc = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
    if pn in ('PNC-014', 'PNC-015', 'E'):
        return 'rotF' if xc < C / 2 else 'rotC'
    if pn == 'D':
        return 'static' if xc < C / 2 else 'carriage'
    if pn in ('PNC-016', 'PNC-020', 'J'):
        return 'carriage'
    if pn == 'F':
        return 'rotI1' if abs(xc - P['I1x']) < 30 and zc > P['Zr'] else 'rotI2'
    if pn == 'H':
        return 'springF' if yc < 0 else 'springB'
    if pn in ('PNC-027', 'PNC-028', 'PNC-029', 'C1', 'C2', 'C3'):
        return 'rotF'
    if pn == 'N':
        return 'pulU' if zc > (P['z_worm'] + P['z_mot']) / 2 else 'pulL'
    if pn in ('PNC-004', 'PNC-005', 'PNC-006', 'PNC-040', 'PNC-041'):
        return 'deck'
    if pn == 'PNC-007':
        return 'hangA' if abs(xc - (P['hang_x1'] + P['hang_dx'])) < 40 else 'hangB'
    if pn == 'PNC-008':
        return 'ecc'
    if pn == 'PNC-009':
        return 'rod'
    if pn == 'PNC-011':
        return 'selector'
    if pn in ('PNC-022', 'PNC-037', 'PNC-045', 'T', 'U'):
        return 'box'
    if pn == 'PNC-031':
        if (x1 - x0) > 25:
            return 'static'                       # clip (30 wide) welded to the 640 rail; the links are 20 wide
        return 'sbl0' if xc < P['sb_x0'] + P['sb_L'] / 2 else 'sbl1'
    if pn == 'PNC-032':
        return 'deck' if (z1 - z0) > 200 else 'sblink'   # arm rides on the deck; short link joins arm and box
    return 'static'


def tess(s):
    v, t = s.tessellate(TOL, ANG)
    return [(p.x, p.y, p.z) for p in v], t


def main(out):
    t0 = time.time(); parts = model.build(); C = P['C']
    print('model built in %.0f s' % (time.time() - t0))
    # screen: export the plain perforated plate outline; the browser draws the 8 mm holes as a texture
    sbL, sbW, sbH, ss = P['sb_L'], P['sb_W'], P['sb_H'], P['ss']
    sbx0 = P['sb_x0']; sbc = (sbx0 + sbL / 2, 0, P['sb_z']); zb_ = sbc[2] - sbH / 2
    plain_screen = rot(B(sbx0 + ss, sbx0 + sbL - ss, -sbW / 2 + ss, sbW / 2 - ss, zb_, zb_ + ss), 'y', P['sb_inc'], sbc)
    chunks, blobs = [], []; off = 0; ntri = 0
    for p in parts:
        pn = p['pn']
        if pn == 'G':
            continue                              # chain is generated and animated in the browser
        solids = [plain_screen] if pn == 'PNC-037' else (p['shape'].Solids() or [p['shape']])
        groups = {}
        for s in solids:
            groups.setdefault(classify(pn, s, C), []).append(s)
        for body, ss_ in groups.items():
            V, T = [], []
            for s in ss_:
                v, t = tess(s); base = len(V); V += v; T += [(a + base, b + base, c + base) for a, b, c in t]
            if not T:
                continue
            q = bytearray()
            for x, y, z in V:
                q += struct.pack('<hhh', *(int(round(c * 10)) for c in (x, y, z)))
            while len(q) % 4:
                q += b'\0'
            big = len(V) > 65535
            idx = bytearray()
            for tri in T:
                idx += struct.pack('<III' if big else '<HHH', *tri)
            while len(idx) % 4:
                idx += b'\0'
            chunks.append(dict(pn=pn, body=body, nv=len(V), nt=len(T), big=big, off=off, ioff=off + len(q)))
            blobs.append(bytes(q) + bytes(idx)); off += len(q) + len(idx); ntri += len(T)
    raw = b''.join(blobs)
    gz = gzip.compress(raw, 9)
    meta = []
    for p in parts:
        meta.append(dict(pn=p['pn'], name=p['name'], mat=p['mat'], qty=p['qty'], grp=p['grp'], col=[round(c, 3) for c in p['col']],
                         ck=p['ck'], ex=list(p['ex']), kind=p['kind'], proc=p['proc']))
    # numbers the simulation needs (all from params.py / model.py, nothing typed by hand)
    keys = ['D', 'Wr', 'gap_S', 'gap_M', 'gap_L', 'travel', 'Zr', 'C', 'C_S', 'C_L', 'pitch', 'roll_d', 'roll_w', 'plate_h', 'plate_t',
            'Nt_spk', 'Nt_idl', 'Dp_spk', 'Dp_idl', 'I1x', 'I1z', 'I2z', 'links', 'ys', 'yB', 'sp_y', 'sp_Lp', 'sp_D', 'pocket', 'pad_t', 'car_w',
            'bar_top', 'bar_mid', 'bar_d', 'deck_inc', 'ecc', 'deck_L', 'deck_W', 'deck_lv', 'deck_cx', 'deck_cz', 'hang_L', 'hang_dx', 'lug_x', 'lug_z',
            'chute_ang', 'hop_x', 'hop_top', 'hop_bot', 'hop_boty', 'hop_h', 'bin_x0', 'sel_open', 'screen', 'scr_pitch', 'lv_mid', 'dck_h', 'x_lipM', 'x_lipL',
            'bin_xs0', 'bin_D1', 'bin_D2', 'bin_xL1', 'bin_Wb', 'ch_w', 'ch_sf', 'ch_wall', 'sel_pitch', 'gate_h', 'thr_gap', 'z_up_r', 'out_l', 'pxM', 'pxL', 'zlipM', 'zlipL', 'bin_out_y', 'bin_nb0',
            'duct_w', 'duct_h', 'sb_L', 'sb_W', 'sb_H', 'sb_inc', 'sb_link', 'sb_z', 'sb_x0', 'fun_h', 'blw_x', 'blw_z', 'blw_d', 'blw_w',
            'fx0', 'fx1', 'fy0', 'fy1', 'fz', 'z_bot', 'z_mid', 'z_up', 'gi', 'ss', 'flange', 'z_worm', 'z_mot', 'y_red', 'pul_x', 'pul_d',
            'mot_x0', 'mot_L', 'pan_w', 'pan_h', 'pan_d', 'ang', 'ang_t', 'rod_len', 'n_top', 'n_mid', 'n_holes', 'sp_dp']
    par = {k: P[k] for k in keys}
    par['hang_z'] = P['hang_z']; par['arm'] = P['arm']; par['chute'] = P['chute']
    par['ecc_c'] = [-180, P['z_up'] - P['ang'] + 35]
    lx, lz = P['deck_place'](P['lug_x'], -P['lug_z']); par['lug'] = [lx, lz]
    par['hang_x'] = list(P['hang_x'])
    # screen-box hanger pins (rest): bottom pin on the box, top pin
    th = math.radians(P['sb_inc'])
    def sbpt(xl, zl):
        X_, Z_ = xl - sbc[0], zl - sbc[2]; return sbc[0] + X_ * math.cos(th) + Z_ * math.sin(th), sbc[2] - X_ * math.sin(th) + Z_ * math.cos(th)
    pins = []
    for xx in (sbx0 + 40, sbx0 + sbL - 60):
        xp, zp_ = sbpt(xx, zb_ + sbH - 15); pins.append([xp, zp_, zp_ + P['sb_link']])
    par['sb_pins'] = pins
    par['sbpt_inlet'] = sbpt(sbx0, zb_ + 15); par['sbpt_out'] = sbpt(sbx0 + sbL, zb_)
    par['sb_c'] = [sbc[0], sbc[2]]; par['sb_zb'] = zb_
    par['fun_z0'] = P['Zr'] - 60 - P['fun_h']
    par['bin_tops'] = [P['bin_tops'][k] for k in (P['bin_xs0'], P['bin_D1'], P['bin_D2'], P['bin_xL1'])]
    par['bin_out_s'] = list(P['bin_out_s'])
    par['tub'] = [420, 0, P['z_bot'], 150, 200, 120]
    par['pan'] = list(P['pan']) + [40]
    par['kc_top'] = list(P['kc_top']); par['kc_lip'] = list(P['kc_lip']); par['crank_phi'] = P['crank_phi']
    par['spring_x0'] = P['C'] + P['car_w'] / 2 + P['pad_t'] - P['pocket']
    js = ('// GENERATED by export_sim.py from the Rev P3 drawing model (params.py / model.py). Do not edit by hand.\n'
          '// Re-run the script after changing params.py; the simulation geometry then follows the 13 sheets.\n'
          'export const P2 = ' + json.dumps(par, separators=(',', ':')) + ';\n'
          'export const PARTS = ' + json.dumps(meta, separators=(',', ':')) + ';\n'
          'export const CHUNKS = ' + json.dumps(chunks, separators=(',', ':')) + ';\n'
          'export const MESH_B64 = "' + base64.b64encode(raw).decode() + '";\n')
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'geometryP2.js'), 'w') as f:
        f.write(js)
    print('%d chunks, %d triangles, raw %.2f MB, gz %.2f MB, js %.2f MB' % (len(chunks), ntri, len(raw) / 1e6, len(gz) / 1e6, len(js) / 1e6))
    for c in sorted(chunks, key=lambda c: -c['nt'])[:12]:
        print('  ', c['pn'], c['body'], c['nt'])


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'sim_out')
