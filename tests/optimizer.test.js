import test from 'node:test';
import assert from 'node:assert/strict';
import { optimize } from '../src/optimizer.js';

const panel = (id, length, width, extra = {}) => ({ id, length, width, ...extra });
const stock = (id, length, width, extra = {}) => ({ id, length, width, ...extra });
const project = (panels, sheets, options = {}) => ({ panels, stock: sheets, options });
const near = (a, b) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
const equalNumber = (a, b, message) => assert.ok(near(a, b), `${message}: ${a} ≈ ${b}`);
const rectEqual = (a, b) => ['x', 'y', 'width', 'height'].every(key => near(a[key], b[key]));
const rectArea = r => r.width * r.height;

/**
 * Independent physical verifier: replay every saw stroke against the current
 * disconnected rectangular workpieces. A legal stroke must span one entire
 * workpiece and leave a blade-width gap. The final leaves must be exactly the
 * reported placements and offcuts, accounting for the entire usable area.
 */
function verify(project, result) {
  const { kerf = 0, trim = 0 } = project.options || {};
  const enabledPanels = project.panels.filter(p => p.enabled !== false);
  const enabledStock = project.stock.filter(s => s.enabled !== false);
  const requested = enabledPanels.reduce((sum, p) => sum + (p.quantity ?? 1), 0);
  const usedStock = new Map();
  const counts = new Map();
  const ids = new Set();
  let usedArea = 0;
  let totalArea = 0;
  let cutLength = 0;
  let cutCount = 0;

  assert.ok(Array.isArray(result.warnings));
  assert.equal(result.stats.requested, requested);
  if (project.options?.oneSheet) assert.ok(result.sheets.length <= 1);

  for (const sheet of result.sheets) {
    const source = enabledStock.find(s => s.id === sheet.stockId);
    assert.ok(source, 'opened stock exists');
    usedStock.set(source.id, (usedStock.get(source.id) || 0) + 1);
    assert.ok(usedStock.get(source.id) <= (source.quantity ?? 1), 'stock quantity respected');
    assert.equal(sheet.length, source.length);
    assert.equal(sheet.width, source.width);
    assert.equal(sheet.material, source.material ?? '');
    assert.ok(sheet.placements.length > 0, 'no empty opened sheets');
    const root = { x: trim, y: trim, width: sheet.length - 2 * trim, height: sheet.width - 2 * trim };
    const leaves = [root];
    let bladeArea = 0;
    for (const cut of sheet.cuts) {
      for (const key of ['x1', 'y1', 'x2', 'y2', 'length']) assert.ok(Number.isFinite(cut[key]));
      const vertical = cut.x1 === cut.x2;
      assert.ok(vertical || cut.y1 === cut.y2, 'axis-aligned cut');
      assert.ok(cut.length > 0, 'nonzero cut');
      equalNumber(cut.length, Math.hypot(cut.x2 - cut.x1, cut.y2 - cut.y1), 'cut length');
      const index = leaves.findIndex(r => vertical
        ? near(cut.y1, r.y) && near(cut.y2, r.y + r.height) &&
          cut.x1 > r.x && cut.x1 < r.x + r.width && cut.x1 + kerf <= r.x + r.width + 1e-8
        : near(cut.x1, r.x) && near(cut.x2, r.x + r.width) &&
          cut.y1 > r.y && cut.y1 < r.y + r.height && cut.y1 + kerf <= r.y + r.height + 1e-8);
      assert.notEqual(index, -1, 'cut must span a single current rectangle, in physical sequence');
      const r = leaves.splice(index, 1)[0];
      if (vertical) {
        leaves.push({ x: r.x, y: r.y, width: cut.x1 - r.x, height: r.height });
        const remainder = r.x + r.width - cut.x1 - kerf;
        if (remainder > 1e-9) leaves.push({ x: cut.x1 + kerf, y: r.y, width: remainder, height: r.height });
      } else {
        leaves.push({ x: r.x, y: r.y, width: r.width, height: cut.y1 - r.y });
        const remainder = r.y + r.height - cut.y1 - kerf;
        if (remainder > 1e-9) leaves.push({ x: r.x, y: cut.y1 + kerf, width: r.width, height: remainder });
      }
      bladeArea += kerf * cut.length;
      cutLength += cut.length;
      cutCount++;
    }

    const reported = [...sheet.placements, ...sheet.freeRects];
    for (const r of reported) {
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(r[key]));
      assert.ok(r.width > 0 && r.height > 0);
      assert.ok(r.x >= trim - 1e-8 && r.y >= trim - 1e-8);
      assert.ok(r.x + r.width <= sheet.length - trim + 1e-8, 'horizontal bound');
      assert.ok(r.y + r.height <= sheet.width - trim + 1e-8, 'vertical bound');
      const index = leaves.findIndex(leaf => rectEqual(leaf, r));
      // Ignore only numerical slivers smaller than the verification tolerance.
      if (r.width > 1e-9 && r.height > 1e-9) {
        assert.notEqual(index, -1, 'each reported rectangle is an intact final guillotine leaf');
        leaves.splice(index, 1);
      }
    }
    assert.equal(leaves.filter(r => r.width > 1e-9 && r.height > 1e-9).length, 0, 'all final leaves reported');
    for (let i = 0; i < reported.length; i++) {
      for (let j = i + 1; j < reported.length; j++) {
        const a = reported[i];
        const b = reported[j];
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        assert.ok(overlapX <= 1e-8 || overlapY <= 1e-8, 'pieces and offcuts never overlap');
      }
    }

    for (const p of sheet.placements) {
      assert.ok(!ids.has(p.id), 'unique expanded piece ID');
      ids.add(p.id);
      const sourcePanel = enabledPanels.find(row => row.id === p.panelId);
      assert.ok(sourcePanel);
      assert.equal(typeof p.rotated, 'boolean');
      if (p.rotated) {
        assert.notEqual(project.options?.allowRotation, false);
        assert.notEqual(sourcePanel.rotate, false);
        assert.notEqual(project.options?.grain, true);
      }
      equalNumber(p.width, p.rotated ? sourcePanel.width : sourcePanel.length, 'placed width');
      equalNumber(p.height, p.rotated ? sourcePanel.length : sourcePanel.width, 'placed height');
      if (project.options?.considerMaterials !== false) {assert.equal(p.material, sheet.material);assert.equal(p.finish,sheet.finish);}
      counts.set(p.panelId, (counts.get(p.panelId) || 0) + 1);
    }
    const placedArea = sheet.placements.reduce((sum, p) => sum + rectArea(p), 0);
    const freeArea = sheet.freeRects.reduce((sum, r) => sum + rectArea(r), 0);
    equalNumber(placedArea + freeArea + bladeArea, rectArea(root), 'usable area conservation');
    usedArea += placedArea;
    totalArea += sheet.length * sheet.width;
  }
  for (const p of result.unplaced) {
    assert.ok(!ids.has(p.id));
    ids.add(p.id);
    assert.equal(typeof p.reason, 'string');
    assert.ok(p.reason.length > 0);
    assert.equal(p.quantity, 1);
    const source = enabledPanels.find(row => row.id === p.panelId);
    assert.ok(source);
    assert.equal(p.length, source.length);
    assert.equal(p.width, source.width);
    counts.set(p.panelId, (counts.get(p.panelId) || 0) + 1);
  }
  for (const p of enabledPanels) assert.equal(counts.get(p.id), p.quantity ?? 1);
  assert.equal(ids.size, requested);
  assert.equal(result.stats.placed + result.unplaced.length, requested);
  assert.equal(result.stats.placed, result.sheets.reduce((sum, s) => sum + s.placements.length, 0));
  assert.equal(result.stats.sheetCount, result.sheets.length);
  equalNumber(result.stats.totalArea, totalArea, 'opened area');
  equalNumber(result.stats.usedArea, usedArea, 'used area');
  equalNumber(result.stats.wasteArea, totalArea - usedArea, 'waste includes trim and kerf');
  equalNumber(result.stats.utilization, totalArea ? 100 * usedArea / totalArea : 0, 'utilization percentage');
  equalNumber(result.stats.cutLength, cutLength, 'total cut length');
  assert.equal(result.stats.cutCount, cutCount);
  assert.ok(result.stats.utilization <= 100);
  for (const value of Object.values(result.stats)) assert.ok(Number.isFinite(value) && value >= 0);
}

test('defaults, exact full sheet, metadata and input immutability', () => {
  const p = project([panel('p', 100, 50, { label: 'Porta', edges: { top: true } })], [stock('s', 100, 50)]);
  delete p.options;
  const original = structuredClone(p);
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  freeze(p);
  const result = optimize(p);
  verify(p, result);
  assert.deepEqual(p, original);
  assert.equal(result.stats.utilization, 100);
  assert.equal(result.stats.cutCount, 0);
  assert.deepEqual(result.sheets[0].freeRects, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.sheets[0].placements[0].label, 'Porta');
  assert.deepEqual(result.sheets[0].placements[0].edges, { top: true, bottom: false, left: false, right: false });
  assert.deepEqual(optimize(p), result);
});

test('kerf is charged only for cuts and can consume the entire remainder', () => {
  for (const [length, kerf, expected] of [[100, 0, 2], [100, 1, 1], [101, 1, 2], [103, 3, 2]]) {
    const p = project([panel('p', 50, 50, { quantity: 2 })], [stock('s', length, 50)], { kerf });
    const result = optimize(p);
    assert.equal(result.stats.placed, expected);
    verify(p, result);
    if (expected === 2) assert.equal(result.stats.cutCount, 1);
  }
  const exact = project([panel('p', 100, 50)], [stock('s', 100, 50)], { kerf: 1000 });
  const result = optimize(exact);
  verify(exact, result);
  assert.equal(result.stats.placed, 1);
  assert.equal(result.stats.cutCount, 0);
  const consumes = project([panel('p', 100, 47)], [stock('s', 100, 50)], { kerf: 3 });
  const consumed = optimize(consumes);
  verify(consumes, consumed);
  assert.equal(consumed.stats.cutCount, 1);
  assert.equal(consumed.stats.cutLength, 100);
  assert.deepEqual(consumed.sheets[0].freeRects, []);
});

test('a positive offcut smaller than the blade is not a feasible cut', () => {
  const p = project([panel('p', 99.5, 50)], [stock('s', 100, 50)], { kerf: 1 });
  const result = optimize(p);
  verify(p, result);
  assert.equal(result.stats.placed, 0);
  assert.match(result.unplaced[0].reason, /não cabe/);
});

test('rotation is clockwise, carries edge orientation, and respects every rotation gate', () => {
  const edges = { top: 'T', right: 'R', bottom: 'B', left: 'L' };
  const make = (options = {}, extra = {}) => project([panel('p', 7, 4, { edges, ...extra })], [stock('s', 4, 7)], options);
  const p = make();
  const result = optimize(p);
  verify(p, result);
  assert.equal(result.stats.placed, 1);
  assert.equal(result.sheets[0].placements[0].rotated, true);
  assert.deepEqual(result.sheets[0].placements[0].edges, { top: 'L', right: 'T', bottom: 'R', left: 'B' });
  for (const blocked of [make({ allowRotation: false }), make({ grain: true }), make({}, { rotate: false })]) {
    const output = optimize(blocked);
    verify(blocked, output);
    assert.equal(output.stats.placed, 0);
  }
});

test('material matching, per-stock quantities, disabled rows and expanded reasons', () => {
  const p = project([
    panel('a', 6, 4, { quantity: 2, material: 'A' }),
    panel('b', 6, 4, { material: 'B' }),
    panel('c', 1, 1, { material: 'C' }),
    { enabled: false, quantity: -1 },
  ], [stock('a', 6, 4, { material: 'A' }), stock('b', 6, 4, { material: 'B' }), { enabled: false }]);
  const result = optimize(p);
  verify(p, result);
  assert.equal(result.stats.placed, 2);
  assert.match(result.unplaced.find(row => row.panelId === 'a').reason, /esgotada/);
  assert.match(result.unplaced.find(row => row.panelId === 'c').reason, /material/);
  const ignored = project([panel('p', 6, 4, { quantity: 3, material: 'B' })],
    [stock('s', 6, 4, { quantity: 3, material: 'A' })], { considerMaterials: false });
  const mixed = optimize(ignored);
  verify(ignored, mixed);
  assert.equal(mixed.stats.placed, 3);
  assert.ok(mixed.sheets.every(sheet => sheet.material === 'A' && sheet.placements[0].material === 'B'));
});

test('oneSheet caps physical sheets, including copies and different stock types', () => {
  const p = project([panel('p', 10, 10, { quantity: 3 })],
    [stock('s', 10, 10, { quantity: 2 }), stock('other', 10, 10)], { oneSheet: true });
  const result = optimize(p);
  verify(p, result);
  assert.equal(result.stats.placed, 1);
  assert.equal(result.sheets.length, 1);
  assert.ok(result.unplaced.every(row => /uma chapa/.test(row.reason)));
  p.options.oneSheet = false;
  const multiple = optimize(p);
  verify(p, multiple);
  assert.equal(multiple.stats.placed, 3);
});

test('oneSheet explores larger stock and smaller-first orders to maximize placed quantity', () => {
  const p = project([panel('p', 4, 4, { quantity: 4 })],
    [stock('small', 4, 4, { quantity: 4 }), stock('large', 8, 8)], { oneSheet: true });
  const result = optimize(p);
  verify(p, result);
  assert.equal(result.stats.placed, 4);
  assert.equal(result.sheets[0].stockId, 'large');

  const competing = project([panel('large', 6, 6), panel('small', 3, 3, { quantity: 4 })],
    [stock('s', 6, 6)], { oneSheet: true });
  const output = optimize(competing);
  verify(competing, output);
  assert.equal(output.stats.placed, 4);
  assert.equal(output.unplaced[0].panelId, 'large');
});

test('trim is inset on all sides, excluded from cuts with an explicit warning', () => {
  const p = project([panel('p', 96, 46)], [stock('s', 100, 50)], { trim: 2, kerf: 10 });
  const result = optimize(p);
  verify(p, result);
  assert.equal(result.stats.placed, 1);
  assert.equal(result.sheets[0].placements[0].x, 2);
  assert.equal(result.sheets[0].placements[0].y, 2);
  assert.equal(result.stats.cutCount, 0);
  assert.equal(result.stats.wasteArea, 100 * 50 - 96 * 46);
  assert.match(result.warnings.join(' '), /refilo não estão incluídos/);
  for (const trim of [25, 26, 100]) {
    const blocked = project([panel('p', 1, 1)], [stock('s', 100, 50)], { trim });
    const output = optimize(blocked);
    verify(blocked, output);
    assert.equal(output.stats.sheetCount, 0);
  }
});

test('a 2D tiled fixture is packed with executable guillotine subdivisions', () => {
  const p = project([panel('a', 6, 6), panel('b', 4, 6), panel('c', 6, 4), panel('d', 4, 4)],
    [stock('s', 10, 10)], { allowRotation: false });
  const result = optimize(p);
  verify(p, result);
  assert.equal(result.stats.placed, 4);
  assert.equal(result.stats.sheetCount, 1);
  assert.equal(result.stats.usedArea, 100);
  assert.equal(result.stats.wasteArea, 0);
  assert.equal(result.stats.cutCount, 3);
});

test('impossible pieces do not open sheets or prevent smaller pieces from being packed', () => {
  const p = project([panel('huge', 100, 100, { quantity: 2 }), panel('small', 2, 2)], [stock('s', 4, 4)]);
  const result = optimize(p);
  verify(p, result);
  assert.equal(result.stats.placed, 1);
  assert.equal(result.unplaced.length, 2);
  assert.equal(result.sheets.length, 1);
  assert.ok(result.unplaced.every(row => row.panelId === 'huge' && /não cabe/.test(row.reason)));
  const impossible = project([panel('p', 100, 100)], [stock('s', 4, 4)]);
  const output = optimize(impossible);
  verify(impossible, output);
  assert.equal(output.stats.utilization, 0);
  assert.equal(output.stats.totalArea, 0);
});

test('decimal arithmetic supports exact fits, blade gaps and trim without phantom cuts', () => {
  for (const p of [
    project([panel('p', 0.1, 0.2, { quantity: 3 })], [stock('s', 0.3, 0.2)], { allowRotation: false }),
    project([panel('p', 0.1, 0.2, { quantity: 2 })], [stock('s', 0.21, 0.2)], { kerf: 0.01, allowRotation: false }),
    project([panel('p', 0.1, 0.2)], [stock('s', 0.3, 0.4)], { trim: 0.1, kerf: 0.001 }),
  ]) {
    const result = optimize(p);
    verify(p, result);
    assert.equal(result.unplaced.length, 0);
  }
  const p = project([panel('p', 0.1 + 0.2, 0.2)], [stock('s', 0.3, 0.2)], { kerf: 1 });
  const result = optimize(p);
  verify(p, result);
  assert.equal(result.stats.cutCount, 0);
  assert.equal(result.stats.placed, 1);
});

test('stock selection avoids unnecessary opened area and all priorities are deterministic', () => {
  const p = project([panel('p', 4, 4, { quantity: 2 })], [stock('big', 100, 100), stock('small', 8, 4)], { priority: 'waste' });
  const result = optimize(p);
  verify(p, result);
  assert.equal(result.sheets[0].stockId, 'small');
  assert.equal(result.stats.totalArea, 32);
  for (const priority of ['balanced', 'area', 'waste', 'cuts', 'cutLength', 'sheets', 'custom']) {
    p.options.priority = priority;
    const output = optimize(p);
    verify(p, output);
    assert.deepEqual(output, optimize(p));
  }
});

test('waste and sheet priorities choose different concrete stock tradeoffs', () => {
  const p = project([panel('p', 4, 4, { quantity: 4 })],
    [stock('small', 4, 4, { quantity: 4 }), stock('large', 9, 9)]);
  const fewerSheets = optimize(p);
  verify(p, fewerSheets);
  assert.equal(fewerSheets.stats.placed, 4);
  assert.equal(fewerSheets.stats.sheetCount, 1);
  assert.equal(fewerSheets.stats.totalArea, 81);
  p.options.priority = 'waste';
  const lessWaste = optimize(p);
  verify(p, lessWaste);
  assert.equal(lessWaste.stats.placed, 4);
  assert.equal(lessWaste.stats.sheetCount, 4);
  assert.equal(lessWaste.stats.totalArea, 64);
  assert.equal(lessWaste.stats.wasteArea, 0);
});

test('numeric IDs and duplicate copies retain identity without aliasing edges', () => {
  const p = project([panel(0, 1, 1, { quantity: 2, edges: { top: true } })], [stock(0, 2, 1)]);
  const result = optimize(p);
  verify(p, result);
  const [a, b] = result.sheets[0].placements;
  assert.notEqual(a.id, b.id);
  assert.equal(a.panelId, 0);
  a.edges.top = false;
  assert.equal(b.edges.top, true);
  assert.equal(p.panels[0].edges.top, true);
});

test('invalid input produces Portuguese Errors, including numeric overflow/underflow', () => {
  const valid = () => project([panel('p', 10, 10)], [stock('s', 20, 20)]);
  const cases = [undefined, null, [], {}, { ...valid(), panels: [] }, { ...valid(), stock: [] }];
  const mutations = [
    p => { p.panels = 'bad'; }, p => { p.stock = {}; },
    p => { p.panels[0] = null; }, p => { p.stock[0] = []; },
    p => { p.panels[0].enabled = false; }, p => { p.stock[0].enabled = false; },
    p => { p.panels[0].id = ''; }, p => { p.stock[0].id = Infinity; },
    p => { p.panels.push({ ...p.panels[0] }); }, p => { p.stock.push({ ...p.stock[0] }); },
    p => { p.panels[0].enabled = 'true'; }, p => { p.panels[0].rotate = 1; },
    p => { p.panels[0].edges = []; }, p => { p.panels[0].label = {}; },
    p => { p.stock[0].material = 42; }, p => { p.options = null; },
    p => { p.options.priority = 42; },
  ];
  for (const key of ['length', 'width']) {
    for (const value of [0, -1, NaN, Infinity, -Infinity, '10', null, Number.MAX_VALUE]) {
      mutations.push(p => { p.panels[0][key] = value; });
      mutations.push(p => { p.stock[0][key] = value; });
    }
  }
  for (const value of [0, -1, 1.5, NaN, Infinity, '1', null, 2001, Number.MAX_SAFE_INTEGER + 1]) {
    mutations.push(p => { p.panels[0].quantity = value; });
    mutations.push(p => { p.stock[0].quantity = value; });
  }
  for (const key of ['kerf', 'trim']) {
    for (const value of [-1, NaN, Infinity, '1', null, Number.MAX_VALUE]) mutations.push(p => { p.options[key] = value; });
  }
  for (const key of ['allowRotation', 'considerMaterials', 'grain', 'oneSheet']) {
    mutations.push(p => { p.options[key] = 'false'; });
  }
  mutations.push(p => { p.panels[0].length = 1e200; p.panels[0].width = 1e200; });
  mutations.push(p => { p.stock[0].length = 1e-250; p.stock[0].width = 1e-250; });
  mutations.push(p => { p.panels[0].quantity = 1500; p.panels.push(panel('p2', 1, 1, { quantity: 501 })); });
  mutations.push(p => { p.stock[0].quantity = 1500; p.stock.push(stock('s2', 1, 1, { quantity: 501 })); });
  for (const mutate of mutations) { const p = valid(); mutate(p); cases.push(p); }
  for (const value of cases) assert.throws(() => optimize(value), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /deve|inválido|duplicado|exced|Não há|limites/);
    return true;
  });
});

test('the 2000-piece boundary is accepted without truncation', () => {
  const p = project([panel('p', 1, 1, { quantity: 2000 })], [stock('s', 2000, 1)], { allowRotation: false });
  const result = optimize(p);
  assert.equal(result.stats.requested, 2000);
  assert.equal(result.stats.placed, 2000);
  assert.equal(result.stats.usedArea, 2000);
  assert.equal(result.stats.cutCount, 1999);
  assert.equal(result.sheets[0].placements.length, 2000);
  assert.equal(new Set(result.sheets[0].placements.map(p => p.id)).size, 2000);
  assert.deepEqual(result.unplaced, []);
});

test('seeded random small projects conserve area and replay as legal guillotine cuts', () => {
  let state = 0x1234abcd;
  const random = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
  for (let iteration = 0; iteration < 80; iteration++) {
    const unit = iteration % 2 ? 0.1 : 1;
    const materials = ['', 'MDF', 'Plywood'];
    const panels = Array.from({ length: 3 + random(8) }, (_, i) => panel(`p${i}`, (1 + random(18)) * unit, (1 + random(18)) * unit, {
      quantity: 1 + random(3), material: materials[random(3)], rotate: random(3) !== 0,
    }));
    const sheets = Array.from({ length: 1 + random(4) }, (_, i) => stock(`s${i}`, (8 + random(25)) * unit, (8 + random(25)) * unit, {
      quantity: 1 + random(3), material: materials[random(3)],
    }));
    const p = project(panels, sheets, {
      kerf: random(3) * unit / 2, trim: random(3) * unit / 2,
      allowRotation: random(4) !== 0, grain: random(4) === 0,
      considerMaterials: random(3) !== 0, oneSheet: iteration % 7 === 0,
      priority: ['balanced', 'cuts', 'waste', 'cutLength'][iteration % 4],
    });
    const before = structuredClone(p);
    const result = optimize(p);
    verify(p, result);
    assert.deepEqual(p, before, `project ${iteration} unchanged`);
    assert.deepEqual(result, optimize(p), `project ${iteration} deterministic`);
  }
});
