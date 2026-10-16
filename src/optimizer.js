/**
 * Independent, synchronous browser/Node ESM guillotine optimizer (no dependencies).
 *
 * optimize(project) never mutates project. Dimensions are numbers in one unit;
 * length is the horizontal (x) dimension, width the vertical (y) dimension.
 * Missing quantities default to 1, enabled/allowRotation/considerMaterials to true,
 * and kerf/trim/grain/oneSheet to 0/0/false/false. Materials match exactly.
 * Each enabled list is limited to 2000 expanded items. IDs must be unique within
 * their list. Disabled rows are ignored, including their unfinished fields.
 *
 * Placement edges describe the placed orientation; rotation is 90° clockwise.
 * Cut coordinates follow the retained edge; the blade consumes kerf to its right
 * (vertical cut) or below (horizontal cut). Cuts are in executable guillotine
 * order within the pretrimmed rectangle. Trim cuts are EXCLUDED and reported in
 * warnings: trim is an inset on every side, not an additional blade allowance.
 * Free rectangles exclude pieces, trim and kerf; wasteArea includes all three
 * kinds of waste (offcuts, trim, sawdust), using the full opened sheet area.
 *
 * A deterministic portfolio searches six orders, two fit scores, three split
 * strategies and smallest/largest stock first. This is a heuristic, not a proof
 * of optimality. Plans first
 * maximize placed quantity, then placed area. priority='waste'/'area' prefers
 * less opened area next, 'cuts' prefers fewer cuts, 'cutLength' shorter cuts;
 * other strings (including the default 'balanced') prefer fewer sheets first.
 */

const LIMIT = 2000;
// Prevent overflow even when all cuts span a very long, narrow sheet.
const MAX_DIMENSION = Number.MAX_VALUE / (LIMIT * 16);
const EDGE_NAMES = ['top', 'bottom', 'left', 'right'];
const close = (a, b) => Math.abs(a - b) <= 8 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
const area = item => item.length * item.width;

function fail(message) {
  throw new Error(message);
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} deve ser um objeto.`);
  return value;
}

function boolean(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(`${name} deve ser verdadeiro ou falso.`);
  return value;
}

function dimension(value, name, zero = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value > MAX_DIMENSION ||
      (zero ? value < 0 : value <= 0)) {
    fail(`${name} deve ser um número finito ${zero ? 'não negativo' : 'positivo'} dentro dos limites numéricos.`);
  }
  return value;
}

function string(value, name) {
  if (value === undefined) return '';
  if (typeof value !== 'string') fail(`${name} deve ser um texto.`);
  return value;
}

function normalize(project) {
  object(project, 'O projeto');
  const rawOptions = project.options === undefined ? {} : object(project.options, 'As opções');
  const options = {
    kerf: dimension(rawOptions.kerf === undefined ? 0 : rawOptions.kerf, 'A espessura de corte', true),
    trim: dimension(rawOptions.trim === undefined ? 0 : rawOptions.trim, 'O refilo', true),
    allowRotation: boolean(rawOptions.allowRotation, true, 'Permitir rotação'),
    considerMaterials: boolean(rawOptions.considerMaterials, true, 'Considerar materiais'),
    grain: boolean(rawOptions.grain, false, 'Respeitar o veio'),
    oneSheet: boolean(rawOptions.oneSheet, false, 'Usar apenas uma chapa'),
    priority: rawOptions.priority === undefined ? 'balanced' : string(rawOptions.priority, 'A prioridade'),
  };

  function rows(list, name, isPanel) {
    if (!Array.isArray(list)) fail(`${name} deve ser uma lista.`);
    const result = [];
    const ids = new Set();
    let count = 0;
    let totalArea = 0;
    for (const [index, raw] of list.entries()) {
      object(raw, `${name}, linha ${index + 1}`);
      if (!boolean(raw.enabled, true, 'O campo habilitado')) continue;
      const { id } = raw;
      if (!((typeof id === 'string' && id.trim().length > 0) ||
            (typeof id === 'number' && Number.isFinite(id)))) fail(`${name}: identificador inválido.`);
      // String equivalence also avoids ambiguous IDs in browser controls.
      if (ids.has(String(id))) fail(`${name}: identificador duplicado (${id}).`);
      ids.add(String(id));
      const quantity = raw.quantity === undefined ? 1 : raw.quantity;
      if (!Number.isSafeInteger(quantity) || quantity <= 0) fail(`${name}: a quantidade deve ser um inteiro positivo.`);
      count += quantity;
      if (count > LIMIT) fail(`${name}: o total não pode exceder ${LIMIT} unidades.`);
      const item = {
        id,
        length: dimension(raw.length, `${name}: comprimento`),
        width: dimension(raw.width, `${name}: largura`),
        quantity,
        material: string(raw.material, 'O material'),
        finish: raw.finish === undefined ? 'twoFaces' : string(raw.finish, 'O acabamento'),
      };
      if (!['twoFaces', 'raw'].includes(item.finish)) fail('O acabamento deve ser 2 faces ou Cru.');
      const itemArea = area(item);
      totalArea += itemArea * quantity;
      if (!(itemArea > 0) || !Number.isFinite(totalArea)) fail(`${name}: a área excede os limites numéricos.`);
      if (isPanel) {
        item.label = string(raw.label, 'A descrição');
        item.rotate = boolean(raw.rotate, true, 'A rotação da peça');
        const edges = raw.edges === undefined ? {} : object(raw.edges, 'As bordas');
        item.edges = Object.fromEntries(EDGE_NAMES.map(edge => [edge, edges[edge] === undefined ? false : edges[edge]]));
      }
      result.push(item);
    }
    if (!result.length) fail(isPanel ? 'Não há peças habilitadas.' : 'Não há chapas habilitadas.');
    return result;
  }

  const panels = rows(project.panels, 'As peças', true);
  const stock = rows(project.stock, 'As chapas', false);
  const pieces = panels.flatMap((panel, index) => Array.from({ length: panel.quantity }, (_, copy) => ({
    ...panel, quantity: 1, panelId: panel.id, id: `piece-${index + 1}-${copy + 1}`,
  })));
  return { pieces, stock, options };
}

// Returns the effective size or NaN. A nonzero offcut needs a full blade width;
// an exact dimension needs no cut. Only floating-point roundoff is snapped.
function fitDimension(size, extent, kerf) {
  if (close(size, extent)) return extent;
  const gap = extent - size;
  return gap > 0 && (gap >= kerf || close(gap, kerf)) ? size : NaN;
}

function compare(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function findFit(rects, piece, options, scoreMode) {
  let best = null;
  const rotate = options.allowRotation && piece.rotate && !options.grain && piece.length !== piece.width;
  for (let index = 0; index < rects.length; index++) {
    const rect = rects[index];
    for (let orientation = 0; orientation < (rotate ? 2 : 1); orientation++) {
      const width = fitDimension(orientation ? piece.width : piece.length, rect.width, options.kerf);
      const height = fitDimension(orientation ? piece.length : piece.width, rect.height, options.kerf);
      if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
      const dx = rect.width - width;
      const dy = rect.height - height;
      const waste = Math.max(0, rect.width * rect.height - width * height);
      const short = Math.min(dx, dy);
      const long = Math.max(dx, dy);
      const score = scoreMode === 'area' ? [waste, short, long] : [short, long, waste];
      if (!best || compare(score, best.score) < 0) {
        best = { index, width, height, rotated: orientation === 1, score };
      }
    }
  }
  return best;
}

function usable(stock, trim) {
  const width = stock.length - 2 * trim;
  const height = stock.width - 2 * trim;
  return width > 0 && height > 0 ? { x: trim, y: trim, width, height } : null;
}

function sameMaterial(stock, piece, options) {
  return !options.considerMaterials || (stock.material === piece.material && stock.finish === piece.finish);
}

function rotatedEdges(edges) {
  return { top: edges.left, right: edges.top, bottom: edges.right, left: edges.bottom };
}

function place(sheet, piece, fit, kerf, splitMode) {
  const rect = sheet.freeRects.splice(fit.index, 1)[0];
  const { width, height } = fit;
  const dx = rect.width - width;
  const dy = rect.height - height;
  const right = Math.max(0, dx - kerf);
  const below = Math.max(0, dy - kerf);
  // Adaptive splitting preserves the larger of the two possible full offcuts.
  const vertical = splitMode === 'vertical' || (splitMode === 'adaptive' &&
    right * rect.height >= below * rect.width);
  const addRect = (x, y, w, h) => {
    if (w > 0 && h > 0) sheet.freeRects.push({ x, y, width: w, height: h });
  };
  const cutV = h => {
    if (dx > 0) sheet.cuts.push({ x1: rect.x + width, y1: rect.y, x2: rect.x + width, y2: rect.y + h, length: h });
  };
  const cutH = w => {
    if (dy > 0) sheet.cuts.push({ x1: rect.x, y1: rect.y + height, x2: rect.x + w, y2: rect.y + height, length: w });
  };
  if (vertical) {
    cutV(rect.height);
    cutH(width);
    addRect(rect.x + width + kerf, rect.y, right, rect.height);
    addRect(rect.x, rect.y + height + kerf, width, below);
  } else {
    cutH(rect.width);
    cutV(height);
    addRect(rect.x, rect.y + height + kerf, rect.width, below);
    addRect(rect.x + width + kerf, rect.y, right, height);
  }
  sheet.placements.push({
    id: piece.id, panelId: piece.panelId, x: rect.x, y: rect.y, width, height,
    label: piece.label, material: piece.material, finish: piece.finish, rotated: fit.rotated,
    edges: fit.rotated ? rotatedEdges(piece.edges) : { ...piece.edges },
  });
}

function run(pieces, stock, options, splitMode, scoreMode, stockMode) {
  const remaining = stock.map(item => item.quantity);
  const sheets = [];
  const unplaced = [];
  const placedAreas = [];
  for (const piece of pieces) {
    let chosen = null;
    let chosenFit = null;
    for (const sheet of sheets) {
      if (!sameMaterial(sheet, piece, options)) continue;
      const fit = findFit(sheet.freeRects, piece, options, scoreMode);
      if (fit && (!chosenFit || compare(fit.score, chosenFit.score) < 0)) {
        chosen = sheet;
        chosenFit = fit;
      }
    }
    if (!chosen && (!options.oneSheet || sheets.length === 0)) {
      let stockIndex = -1;
      let openingScore = null;
      for (let i = 0; i < stock.length; i++) {
        if (!remaining[i] || !sameMaterial(stock[i], piece, options)) continue;
        const rect = usable(stock[i], options.trim);
        if (!rect) continue;
        const fit = findFit([rect], piece, options, scoreMode);
        if (!fit) continue;
        const score = [stockMode === 'small' ? area(stock[i]) : -area(stock[i]), ...fit.score];
        if (!openingScore || compare(score, openingScore) < 0) {
          stockIndex = i;
          chosenFit = fit;
          openingScore = score;
        }
      }
      if (stockIndex >= 0) {
        const item = stock[stockIndex];
        remaining[stockIndex]--;
        chosen = {
          id: `sheet-${sheets.length + 1}`, stockId: item.id,
          length: item.length, width: item.width, material: item.material, finish: item.finish,
          placements: [], freeRects: [usable(item, options.trim)], cuts: [],
        };
        sheets.push(chosen);
      }
    }
    if (chosen) {
      place(chosen, piece, chosenFit, options.kerf, splitMode);
      placedAreas.push(area(piece));
    }
    else unplaced.push(piece);
  }
  const totalArea = sheets.reduce((sum, sheet) => sum + area(sheet), 0);
  const usedArea = Math.min(totalArea,
    sheets.reduce((sum, sheet) => sum + sheet.placements.reduce((a, p) => a + p.width * p.height, 0), 0));
  const stats = {
    requested: pieces.length, placed: pieces.length - unplaced.length, sheetCount: sheets.length,
    totalArea, usedArea, wasteArea: Math.max(0, totalArea - usedArea),
    utilization: totalArea ? usedArea / totalArea * 100 : 0,
    cutCount: sheets.reduce((sum, sheet) => sum + sheet.cuts.length, 0),
    cutLength: sheets.reduce((sum, sheet) => sum + sheet.cuts.reduce((a, cut) => a + cut.length, 0), 0),
  };
  // Canonical nominal areas prevent ULP differences from overriding sheet/cut
  // priorities when the same pieces were placed in a different order/orientation.
  const placedArea = placedAreas.sort((a, b) => a - b).reduce((sum, a) => sum + a, 0);
  return { sheets, unplaced, stats, placedArea };
}

function planScore(plan, priority) {
  const s = plan.stats;
  const common = [-s.placed, -plan.placedArea];
  if (priority === 'waste' || priority === 'area') return [...common, s.totalArea, s.sheetCount, s.cutLength, s.cutCount];
  if (priority === 'cuts') return [...common, s.cutCount, s.cutLength, s.sheetCount, s.totalArea];
  if (priority === 'cutLength') return [...common, s.cutLength, s.cutCount, s.sheetCount, s.totalArea];
  return [...common, s.sheetCount, s.totalArea, s.cutLength, s.cutCount];
}

function reason(piece, stock, options, sheets) {
  const matching = stock.filter(item => sameMaterial(item, piece, options));
  if (!matching.length) return 'Nenhuma chapa disponível com o material e acabamento da peça.';
  const fitting = matching.filter(item => {
    const rect = usable(item, options.trim);
    return rect && findFit([rect], piece, options, 'area');
  });
  if (!fitting.length) return 'A peça não cabe nas chapas com o refilo, a rotação e a espessura de corte configurados.';
  if (options.oneSheet && sheets.length) return 'Limite de uma chapa atingido; sem espaço ou material compatível na chapa aberta.';
  return 'Quantidade de chapas compatíveis esgotada; sem espaço nas chapas abertas.';
}

export function optimize(project) {
  const { pieces, stock, options } = normalize(project);
  const orderKeys = [area, p => Math.max(p.length, p.width), p => Math.min(p.length, p.width), p => p.length, p => p.width, p => -area(p)];
  const seen = new Set();
  let best = null;
  let bestScore = null;
  for (const key of orderKeys) {
    const ordered = pieces.map((piece, index) => ({ piece, index }))
      .sort((a, b) => key(b.piece) - key(a.piece) || area(b.piece) - area(a.piece) || a.index - b.index)
      .map(item => item.piece);
    const signature = ordered.map(piece => piece.id).join(',');
    if (seen.has(signature)) continue;
    seen.add(signature);
    for (const split of ['vertical', 'horizontal', 'adaptive']) {
      for (const score of ['area', 'shortSide']) {
        for (const stockMode of ['small', 'large']) {
          const plan = run(ordered, stock, options, split, score, stockMode);
          const rank = planScore(plan, options.priority);
          if (!best || compare(rank, bestScore) < 0) {
            best = plan;
            bestScore = rank;
          }
        }
      }
    }
  }
  // Keep expanded unplaced pieces in input order, independently of winning sort.
  const missing = new Set(best.unplaced.map(piece => piece.id));
  const unplaced = pieces.filter(piece => missing.has(piece.id)).map(piece => ({
    ...piece, edges: { ...piece.edges }, reason: reason(piece, stock, options, best.sheets),
  }));
  const warnings = options.trim > 0
    ? ['Os cortes de refilo não estão incluídos: a sequência começa na área útil com o recuo informado em todos os lados.']
    : [];
  return { sheets: best.sheets, unplaced, stats: best.stats, warnings };
}
