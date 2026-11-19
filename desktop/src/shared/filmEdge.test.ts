import { describe, expect, it } from 'vitest';
import { ALL_FEATURES, FILM_PARAMS_DEFAULT, fullDelta } from './params';
import { GEOMETRY_DEFAULT, outputSize } from './geometry';
import { StockCatalog } from './stocks';
import { captureDate, shootingText, edgeText, resolveFilmEdgeParams, canvasGeometryFor, sourceGeometryFor, gateFramed, datePrints, dateEffective, edgeEffective, geometryInNegative } from './filmEdge';
import { decodeSidecar, encodeSidecar, newSidecar } from './sidecar';
import stockData from '../../../modern_UI/Spektrafilm/Spektrafilm/Resources/StockCatalog.json';
const catalog = new StockCatalog(stockData.stocks);
const native = { width: 6000, height: 4000 };
const crop = { ...GEOMETRY_DEFAULT, crop: { x: .1, y: .1, width: .6, height: .7 }, angle: 3, quarterTurns: 1, flipH: true };

describe('the camera gate and date back contract', () => {
  it('bypasses the film edge and date back without losing normal crop, rotation or saved parameters', () => {
    const p = structuredClone(FILM_PARAMS_DEFAULT);
    p.filmEdge.active = true; p.dateBack.active = true;
    const saved = structuredClone(p);
    expect(edgeEffective(p.filmEdge, ALL_FEATURES, true)).toBe(false);
    expect(dateEffective(p.dateBack, p.filmEdge, ALL_FEATURES, true)).toBe(false);
    expect(geometryInNegative(p, ALL_FEATURES, true)).toBe(false);
    expect(sourceGeometryFor(p, crop, ALL_FEATURES, true)).toBeNull();
    expect(canvasGeometryFor(p, crop, ALL_FEATURES, true)).toBe(crop);
    expect(sourceGeometryFor(p, crop, ALL_FEATURES, false)).toBe(crop);
    expect(canvasGeometryFor(p, crop, ALL_FEATURES, false)).toEqual(GEOMETRY_DEFAULT);
    expect(p).toEqual(saved);
  });
  it('accepts host ISO and EXIF dates without inventing unavailable or invalid shooting data', () => {
    expect(captureDate('2026-10-01T12:34:56', 'japan')).toBe("'26 10 1");
    expect(captureDate('2026:10:01 12:34:56', 'us')).toBe("10 1 '26");
    expect(captureDate('2026-02-29T12:00:00', 'japan')).toBe('');
    expect(captureDate('2024-02-29', 'japan')).toBe("'24 2 29");
    expect(shootingText(null)).toBe('');
    expect(shootingText({ focal_mm: 50 })).toBe(''); // not equivalent focal length
    expect(shootingText({ shutter_s: 1 / 250, aperture: 2.8, exposure_program: 3, exposure_bias_ev: .3, focal_35mm: 50 })).toBe('1/250 F2.8 A +0.3 50mm');
  });
  it.each([
    ['kodak_portra_160nc', 'KODAK 160NC', 'KODAK 160NC-2'],
    ['kodak_portra_160vc', 'KODAK 160VC', 'KODAK 160VC-2'],
    ['kodak_portra_400nc', 'KODAK 400NC', 'KODAK 400NC-3'],
    ['kodak_portra_400vc', 'KODAK 400VC', 'KODAK 400VC-3'],
  ])('uses each Portra NC/VC stock’s own lettering on 135 and 120 (%s)', (id, small, medium) => {
    expect(edgeText(catalog.stock(id), '135')).toBe(small);
    expect(edgeText(catalog.stock(id), '120_6x6')).toBe(medium);
  });
  it('uses released silver-stock lettering and resolves metadata identically on repeated passes', () => {
    expect(edgeText(catalog.stock('kodak_tri_x_400'), '135')).toBe('KODAK 400TX');
    expect(edgeText(catalog.stock('fujifilm_neopan_acros_100_ii'), '120_6x6')).toBe('FUJI 100 ACROS II');
    const p = { ...FILM_PARAMS_DEFAULT, filmStock: 'kodak_tri_x_400' };
    const metadata = { datetime_original: '2026-10-01T12:00:00', aperture: 4 };
    const resolved = resolveFilmEdgeParams(p, crop, metadata, catalog, native);
    expect(resolveFilmEdgeParams(resolved, crop, metadata, catalog, native)).toEqual(resolved);
    expect(resolved).toMatchObject({ filmEdge: { edgeText: 'KODAK 400TX', fNumber: 4 }, dateBack: { text: "'26 10 1", framing: expect.any(String) } });
  });
  it('uses a 2:1 strip and black perforations for full-width 135 without changing saved settings', () => {
    const filmEdge = { ...FILM_PARAMS_DEFAULT.filmEdge, active: true, format: '135_sprocket', view: 'filed', holes: 'white' };
    const p = { ...FILM_PARAMS_DEFAULT, filmEdge };
    expect(gateFramed(GEOMETRY_DEFAULT, filmEdge, native).lockedRatio).toBe(2);
    expect(fullDelta(p, ALL_FEATURES)).toMatchObject({ overscan_active: true, overscan_format: '135_sprocket', overscan_mode: 'strip', overscan_holes: 'black' });
    expect(p.filmEdge).toMatchObject({ view: 'filed', holes: 'white' });
  });
  it('keeps the optional KS perforation setting on 120 only', () => {
    const filmEdge = { ...FILM_PARAMS_DEFAULT.filmEdge, active: true, format: '120_6x6', perforation: 'ks65' };
    const p = { ...FILM_PARAMS_DEFAULT, filmEdge };
    expect(fullDelta(p, ALL_FEATURES).overscan_perforation).toBe('ks65');
    expect(fullDelta({ ...p, filmEdge: { ...filmEdge, format: '135' } }, ALL_FEATURES).overscan_perforation).toBe('none');
    expect(fullDelta(p, { ...ALL_FEATURES, overscanKs65: false })).not.toHaveProperty('overscan_perforation');
  });
  it('uses a movie strip and its own crop for each cine format on a compatible host', () => {
    for (const [format, ratio] of [['8_super', 5.79 / 4.01], ['16_super', 12.35 / 7.5],
      ['35_4perf', 24.89 / 18.67], ['65_5perf', 52.63 / 23.01], ['65_15perf', 70.41 / 52.63]] as const) {
      const filmEdge = { ...FILM_PARAMS_DEFAULT.filmEdge, active: true, format, view: 'filed', edgeText: 'FACTORY MARK' };
      const p = { ...FILM_PARAMS_DEFAULT, filmEdge, dateBack: { ...FILM_PARAMS_DEFAULT.dateBack, active: true } };
      expect(gateFramed(GEOMETRY_DEFAULT, filmEdge, native).lockedRatio).toBe(ratio);
      expect(fullDelta(p)).toMatchObject({ overscan_active: true, overscan_format: format, overscan_mode: 'strip',
        overscan_edge_text: '', date_imprint_active: false });
      const olderHost = fullDelta(p, { ...ALL_FEATURES, overscanCine: false });
      expect(olderHost.overscan_active).toBe(false);
      expect(olderHost).not.toHaveProperty('overscan_format', format);
    }
  });
  it('holds a physical gate ratio, with post geometry identity and original crop retained in the sidecar', () => {
    const p = { ...FILM_PARAMS_DEFAULT, filmEdge: { ...FILM_PARAMS_DEFAULT.filmEdge, active: true, format: '135_half' } };
    const g = gateFramed(crop, p.filmEdge, native);
    expect(g.crop.width * native.width / (g.crop.height * native.height)).toBeCloseTo(4 / 3, 8);
    expect(sourceGeometryFor(p, g)).toBe(g);
    expect(canvasGeometryFor(p, g)).toEqual(GEOMETRY_DEFAULT);
    const sc = { ...newSidecar(), params: p, geometry: g, heldCrop: crop };
    expect(decodeSidecar(encodeSidecar(sc))).toMatchObject({ geometry: g, heldCrop: crop });
    expect(encodeSidecar({ ...sc, heldCrop: null })).not.toHaveProperty('heldCrop');
    expect(sourceGeometryFor(p, g, { ...ALL_FEATURES, overscan: false })).toBeNull();
  });
  it('allows bare 135 dates, requires an edge for data/120, and refuses panoramic backs', () => {
    const d = { ...FILM_PARAMS_DEFAULT.dateBack, active: true };
    const e = FILM_PARAMS_DEFAULT.filmEdge;
    expect(dateEffective(d, e)).toBe(true);
    expect(datePrints('data', d, e)).toBe(false);
    expect(dateEffective({ ...d, camera: '120_645' }, e)).toBe(false);
    expect(dateEffective(d, { ...e, active: true, format: '120_645' })).toBe(true);
    expect(dateEffective(d, { ...e, active: true, format: '135_xpan' })).toBe(false);
    const p = { ...FILM_PARAMS_DEFAULT, dateBack: d };
    expect(sourceGeometryFor(p, GEOMETRY_DEFAULT)).toBeNull();
    expect(sourceGeometryFor(p, crop)).toBe(crop);
  });
  it('writes perforation data in camera order, and only for a supported perforated gate', () => {
    const p = {
      ...FILM_PARAMS_DEFAULT,
      filmEdge: { ...FILM_PARAMS_DEFAULT.filmEdge, active: true, format: '135' },
      dateBack: { ...FILM_PARAMS_DEFAULT.dateBack, active: true, face: 'perfs' },
    };
    const m = { exposure_program: 3, metering_mode: 5, shutter_s: 1 / 180, aperture: 8, exposure_bias_ev: 0 };
    const resolved = resolveFilmEdgeParams(p, GEOMETRY_DEFAULT, m, catalog, native);
    expect(fullDelta(resolved, ALL_FEATURES)).toMatchObject({ date_imprint_active: true, date_imprint_style: 'data', date_imprint_data_placement: 'perfs', date_imprint_text: 'Av|{meter:multi}|180|F8|±0.0' });
    expect(fullDelta(resolved, { ...ALL_FEATURES, datePerforationData: false })).toMatchObject({ date_imprint_active: false });
    expect(fullDelta({ ...resolved, filmEdge: { ...resolved.filmEdge, active: false } }, ALL_FEATURES)).toMatchObject({ date_imprint_active: false });
    expect(resolveFilmEdgeParams(p, GEOMETRY_DEFAULT, {}, catalog, native).dateBack.text).toBe('');
  });
  it('scales date-only physical pitch on the cut and emits real metadata, never a stale other-frame date', () => {
    const p = { ...FILM_PARAMS_DEFAULT, filmFormatMM: 36, dateBack: { ...FILM_PARAMS_DEFAULT.dateBack, active: true, withData: true } };
    const cut = { ...GEOMETRY_DEFAULT, crop: { x: .25, y: .25, width: .5, height: .5 } };
    const resolved = resolveFilmEdgeParams(p, cut, { datetime_original: '2026-10-01T00:00:00' }, catalog, native);
    expect(fullDelta(resolved)).toMatchObject({ date_imprint_active: true, date_imprint_text: "'26 10 1", date_imprint_data_text: '', film_format_mm: 18 });
    expect(outputSize(cut, native)).toEqual({ width: 3000, height: 2000 });
    expect(fullDelta(resolveFilmEdgeParams(resolved, cut, null, catalog, native))).toHaveProperty('date_imprint_text', '');
  });
});

// 1.3.4's 0f71c4c9: the date alone cuts the frame only once the crop is not the whole frame, so
// the first ratio chosen in the crop tool turned framing on mid-session and the Mac's canvas
// jumped under the crop. Here the canvas frames on `geometryInNegative`, which does not depend
// on the crop: it shows the decode for the whole tool session, before and after that first ratio,
// while the engine's cut (`sourceGeometryFor`) follows the crop.
it('frames the decode for the whole crop session under the date alone, so the first ratio cannot jolt the canvas', () => {
  const p = { ...FILM_PARAMS_DEFAULT, dateBack: { ...FILM_PARAMS_DEFAULT.dateBack, active: true, face: 'lcd', placement: 'frame' } };
  expect(dateEffective(p.dateBack, p.filmEdge, ALL_FEATURES)).toBe(true);
  const whole = GEOMETRY_DEFAULT;
  const firstRatio = { ...GEOMETRY_DEFAULT, crop: { x: 0, y: 0.0833, width: 1, height: 0.8333 }, lockedRatio: 16 / 9 };
  expect(sourceGeometryFor(p, whole, ALL_FEATURES)).toBeNull();
  expect(sourceGeometryFor(p, firstRatio, ALL_FEATURES)).toEqual(firstRatio);
  // The canvas's framing switch (Canvas.tsx: cropping && geometryInNegative) is the same on both sides.
  expect(geometryInNegative(p, ALL_FEATURES)).toBe(true);
});
