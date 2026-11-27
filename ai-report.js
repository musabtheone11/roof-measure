'use strict';
// Source-pixel reviews are separate from geographic roof jobs. This module reads
// a revision-bound snapshot only; it never changes a model or starts a download.
(function (host) {
  const SQFT = 10.763910416709722, FT = 3.280839895013123;
  const stable = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  const copy = value => JSON.parse(JSON.stringify(value));
  const fail = text => { throw new Error(text); };
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const dateOK = value => { const d = /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? new Date(value + 'T00:00:00Z') : null; return d && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value; };
  const stated = value => typeof value === 'string' && value.trim().length > 0;
  const area = ring => { const o = ring[0]; return Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + (p[0] - o[0]) * (q[1] - o[1]) - (q[0] - o[0]) * (p[1] - o[1]); }, 0) / 2); };
  const length = points => points.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
  const sameNumber = (got, expected) => Math.abs(got - expected) <= 1e-6 * Math.max(1, Math.abs(expected));
  function transform(metadata) {
    if (metadata.view !== 'orthographic' || metadata.perspective === 'oblique') return null;
    // Geographic reconstruction has its own validated projection pipeline. This
    // image-only PDF independently validates a current pixel calibration instead
    // of duplicating that pipeline or inventing a geographic scale.
    if (metadata.georef?.verified === true) return null;
    const raw = metadata.calibration;
    if (!raw) return null;
    const c = { ...raw, a: raw.a || raw.start, b: raw.b || raw.end, distance: raw.distance ?? raw.lengthFt, unit: raw.unit || (raw.lengthFt != null ? 'ft' : null) };
    const inside = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= 0 && p[1] >= 0 && p[0] <= metadata.width && p[1] <= metadata.height;
    if (c.verified !== true || !stated(c.source) || !dateOK(c.date) || !inside(c.a) || !inside(c.b) || !finite(c.distance) || c.distance === 0 || !['ft', 'm'].includes(c.unit)) return null;
    const pixels = Math.hypot(c.a[0] - c.b[0], c.a[1] - c.b[1]); if (!pixels) return null;
    const factor = c.distance * (c.unit === 'ft' ? 0.3048 : 1) / pixels;
    return { basis: c, point: p => [p[0] * factor, p[1] * factor] };
  }
  function prepareAIReviewReport(payload) {
    if (!payload || payload.app !== 'roof-measure-ai-review' || payload.version !== 2) fail('A version 2 source-image review is required.');
    if (payload.revision == null || !String(payload.revision).length) fail('The review has no model revision.');
    const result = payload.latestResult, snapshot = payload.measurementSnapshot, model = payload.model, metadata = payload.imageMetadata;
    if (payload.measurementStatus !== 'current' || !result?.measurements || String(result.model?.revision) !== String(payload.revision)) fail('Measurements are stale or unavailable. Recalculate this revision before exporting.');
    if (!snapshot || String(snapshot.revision) !== String(payload.revision) || stable(snapshot.model) !== stable(model) || stable(snapshot.imageMetadata) !== stable(metadata)) fail('The measured model or source metadata differs from the current review. Recalculate before exporting.');
    if (stable(result.model.originalProposal) !== stable(model)) fail('The measurement response describes a different model.');
    if (!metadata || !Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width < 1 || metadata.height < 1 || metadata.width > 12000 || metadata.height > 12000) fail('Valid source-image dimensions are required.');
    if (!model || !Array.isArray(model.outline) || !Array.isArray(model.facets) || !Array.isArray(model.edges) || model.facets.length > 300 || model.edges.length > 1000) fail('The review geometry exceeds the report limits.');
    let points = 0;
    const ring = (value, minimum) => { if (!Array.isArray(value) || value.length < minimum || value.length > 10000) fail('A source boundary has too few or too many points.'); for (const p of value) if (++points > 20000 || !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || p[0] < 0 || p[1] < 0 || p[0] > metadata.width || p[1] > metadata.height) fail('Source geometry must use finite coordinates within the image.'); return value; };
    // An absent target boundary is a review finding, not grounds to invent one.
    ring(model.outline, 0);
    const ids = new Set();
    const identity = item => { if (!stated(item.id) || item.id.length > 200 || ids.has(item.id)) fail('Facet and edge IDs must be unique.'); ids.add(item.id); };
    model.facets.forEach(f => { identity(f); ring(f.polygon, 3); }); model.edges.forEach(e => { identity(e); ring(e.points, 2); });
    const m = result.measurements, geometryOK = m.validation?.ok === true && model.outline.length >= 3;
    const restricted = metadata.sourceRestrictions?.perspective === true || model.measurementRestrictions?.perspective === true || metadata.view !== 'orthographic' || metadata.perspective === 'oblique';
    const frame = restricted ? null : transform(metadata), physical = geometryOK && !!frame;
    if (physical && stable(m.measurementBasis) !== stable(frame.basis)) fail('The measurement basis does not match the current calibration.');
    const geometryStatus = value => value == null ? 'inferred' : ['inferred', 'user-provided', 'unresolved'].includes(value) ? value : 'unresolved';
    const rowStatus = (row, item) => { const status = geometryStatus(row.status); if (status !== geometryStatus(item.status)) fail('The measurement geometry status differs from the current model.'); return status; };
    const number = (value, expected, label) => { if (value == null) return null; if (!finite(value) || expected != null && !sameNumber(value, expected)) fail('Inconsistent ' + label + ' in the measurement response.'); return value; };
    const facets = model.facets.map((f, i) => {
      const values = (m.facets || []).filter(q => q.id === f.id); if (values.length > 1) fail('Duplicate facet measurement ID.'); const row = values[0] || {};
      const status = rowStatus(row, f), supported = physical && status !== 'unresolved';
      if (physical && status === 'unresolved' && (row.projectedAreaM2 != null || row.slopedAreaM2 != null)) fail('An unresolved facet has a physical quantity.');
      const px = geometryOK ? number(row.pixels2, area(f.polygon), 'facet pixel area') : null;
      const projected = supported ? number(row.projectedAreaM2, area(f.polygon.map(frame.point)), 'projected facet area') : null;
      const p = f.pitch, knownPitch = p && stated(p.source) && finite(p.rise) && finite(p.run) && p.run > 0 && finite(p.uncertainty) && ['measured', 'user-provided'].includes(p.status);
      if (row.pitch != null && stable(row.pitch) !== stable(p)) fail('The pitch record differs from the current model.');
      const sloped = supported && knownPitch ? number(row.slopedAreaM2, area(f.polygon.map(frame.point)) * Math.hypot(p.run, p.rise) / p.run, 'sloped facet area') : null;
      if (physical && !knownPitch && row.slopedAreaM2 != null) fail('A sloped area has no supported pitch.');
      return { id: f.id, key: 'F' + (i + 1), polygon: copy(f.polygon), pixels2: px, projected, sloped, pitch: knownPitch ? copy(p) : null, status };
    });
    const edges = model.edges.map((e, i) => {
      const values = (m.edges || []).filter(q => q.id === e.id); if (values.length > 1) fail('Duplicate edge measurement ID.'); const row = values[0] || {};
      const status = rowStatus(row, e), classified = !!e.type && !['unspecified', 'obstruction'].includes(e.type);
      if (physical && (status === 'unresolved' || !classified) && row.horizontalLengthM != null) fail('An unresolved, unspecified or obstruction edge has a physical quantity.');
      if (row.type != null && row.type !== e.type) fail('An edge classification differs from the current model.');
      return { id: e.id, key: 'E' + (i + 1), type: e.type || 'unspecified', points: copy(e.points), status, pixels: geometryOK && row.valid !== false ? number(row.lengthPixels, length(e.points), 'edge pixel length') : null,
        horizontal: physical && status !== 'unresolved' && classified && row.valid !== false ? number(row.horizontalLengthM, length(e.points.map(frame.point)), 'horizontal edge length') : null,
        // A planar image does not establish a true 3D edge length.
        sloped: null };
    });
    const total = (key, value) => { if (!physical || value == null) return null; if (!facets.length || facets.some(f => f[key] == null)) fail('A roof total includes unsupported facet quantities.'); return number(value, facets.reduce((n, f) => n + f[key], 0), 'roof total'); };
    const annotations = model.annotations || payload.originalAI?.structure?.annotations || [];
    if (!Array.isArray(annotations) || annotations.length > 300) fail('Too many source annotations for one review.');
    const annotationRows = annotations.map((a, i) => {
      const region = a.region?.length ? ring(a.region, 3) : [];
      const xs = region.map(point => point[0]), ys = region.map(point => point[1]);
      return { key: 'A' + (i + 1), id: String(a.id || ''), kind: String(a.kind || 'annotation'),
        text: String(a.text || ''), status: 'SOURCE-REPORTED / UNVERIFIED',
        bounds: region.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null };
    });
    const issues = [...(m.issues || []), ...(payload.originalAI?.quality?.issues || []), ...(payload.originalAI?.adjudication?.decisions || [])].map(q => typeof q === 'string' ? q : String(q.text || q.message || q.reason || q.code || 'Review required') + (q.ids?.length ? ' [' + q.ids.join(', ') + ']' : ''));
    const reviewRecords = [...model.facets.map(f => ({ item: f, kind: 'Facet' })), ...model.edges.map(e => ({ item: e, kind: 'Edge' }))].filter(q => q.item.geometryReview && typeof q.item.geometryReview === 'object').map(({ item, kind }) => {
      const r = item.geometryReview, bounded = value => String(value ?? '').slice(0, 10000);
      return { id: bounded(item.id), kind, status: r.status === 'user-provided' ? 'USER-PROVIDED / NOT INDEPENDENTLY VERIFIED' : 'INVALIDATED / NOT ACCEPTED', source: bounded(r.source), date: bounded(r.date), note: bounded(r.note) };
    });
    const corrections = (payload.corrections || []).map(e => String(e.at || '') + ' / revision ' + String(e.revision ?? '') + ' / ' + String(e.action || 'Correction'));
    if (annotationRows.reduce((n, a) => n + a.text.length, 0) + issues.join('').length + corrections.join('').length + reviewRecords.reduce((n, r) => n + Object.values(r).join('').length, 0) > 100000) fail('Review text exceeds the bounded PDF limit. Save the review JSON for the complete audit.');
    return { revision: String(payload.revision), metadata: copy(metadata), outline: copy(model.outline), facets, edges, annotations: annotationRows, issues, corrections, reviewRecords,
      projected: total('projected', m.projectedAreaM2), sloped: total('sloped', m.slopedAreaM2), physical, geometryOK, restricted, previousReviews: payload.previousReviews?.length || 0,
      status: 'SOURCE IMAGE REVIEW', fingerprint: stable({ revision: payload.revision, model, metadata, latestResult: result, measurementSnapshot: snapshot, sourceImage: payload.sourceImage }) };
  }

  async function buildAIReviewPDF(payload, options = {}) {
    const internalReview = options.internalReview === true;
    if (!host.jspdf?.jsPDF) fail('The PDF library has not loaded.');
    const prepared = prepareAIReviewReport(payload), data = copy(payload);
    const stillCurrent = () => { if (prepareAIReviewReport(payload).fingerprint !== prepared.fingerprint) fail('The review changed while the PDF was being prepared. Export the current revision again.'); };
    let logo = null;
    try { const response = await fetch('assets/logo-black.png'); if (response.ok) { const blob = await response.blob(); logo = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); } } catch (_) { /* Text brand remains available offline. */ }
    if (data.sourceImage) {
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(data.sourceImage) || data.sourceImage.length > 20 * 1024 * 1024) fail('The source preview must be a bounded image data URL.');
      const fp = prepared.metadata.imageFingerprint;
      if (fp?.algorithm !== 'SHA-256' || !/^[a-f0-9]{64}$/i.test(fp.sha256 || '') || !host.crypto?.subtle) fail('The source preview needs its current SHA-256 image fingerprint.');
      const bytes = Uint8Array.from(atob(data.sourceImage.split(',')[1]), c => c.charCodeAt(0));
      const actual = [...new Uint8Array(await host.crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
      if (actual !== fp.sha256.toLowerCase()) fail('The source preview differs from the reviewed image.');
      await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => image.naturalWidth === prepared.metadata.width && image.naturalHeight === prepared.metadata.height ? resolve() : reject(Error('The preview dimensions differ from the model source.')); image.onerror = () => reject(Error('The source preview could not be decoded.')); image.src = data.sourceImage; });
    }
    stillCurrent();
    const doc = new host.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
    const W = 612, H = 792, L = 32, R = 580, FOOT = 748, textBoxes = [], unplaced = [];
    let page = 1, y = 0;
    const text = (value, x, yy, size = 9, bold = false, width = null, align = 'left') => { doc.setCharSpace(0); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(26); const lines = width ? doc.splitTextToSize(String(value), width) : [String(value)]; doc.text(lines, x, yy, { align, lineHeightFactor: 1.3 }); for (let i = 0; i < lines.length; i++) { const w = doc.getTextWidth(lines[i]); textBoxes.push({ page, x0: align === 'right' ? x - w : x, x1: align === 'right' ? x : x + w, y0: yy + i * size * 1.3 - size, y1: yy + i * size * 1.3 + size * .3 }); } return yy + lines.length * size * 1.3; };
    const line = (yy) => { doc.setDrawColor(150); doc.setLineWidth(.5); doc.line(L, yy, R, yy); };
    const header = title => { if (logo) doc.addImage(logo, 'PNG', 32, 20, 92, 45); else text('DIVERSITY CONTRACTING', 32, 38, 10, true); text(internalReview ? 'SOURCE IMAGE REVIEW' : 'ROOF MEASUREMENT SUMMARY', 144, 32, 8, true); text('REVIEW REQUIRED', R, 32, 8, true, null, 'right'); text('Revision ' + prepared.revision, 144, 48, 9, true); text('Source date: ' + (prepared.metadata.date || 'not recorded'), R, 48, 8, false, null, 'right'); line(76); text(title, L, 108, 21, true); y = 132; };
    const next = title => { doc.addPage('letter', 'portrait'); page++; header(title); };
    const paragraph = (value, size = 8.5, gap = 7) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(size);
      const lines = doc.splitTextToSize(String(value), 548);
      if (lines.length <= 4 && y + lines.length * size * 1.3 > FOOT - 20) next('Review notes (continued)');
      for (const row of lines) {
        if (y + size * 1.3 > FOOT - 20) next('Review notes (continued)');
        y = text(row, L, y, size);
      }
      y += gap;
    };
    const section = title => { if (y + 35 > FOOT - 20) next('Review schedules (continued)'); y = text(title, L, y, 12, true) + 4; };
    const table = (title, widths, headings, rows) => {
      section(title);
      const head = () => { doc.setFillColor(237); doc.rect(L, y - 10, 548, 17, 'F'); let x = L; headings.forEach((h, i) => { text(h, x + 5, y + 1, 7.8, true); x += widths[i]; }); y += 22; };
      head();
      for (const cells of rows) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
        const wrapped = cells.map((c, i) => doc.splitTextToSize(String(c), widths[i] - 10)), height = Math.max(16, Math.max(...wrapped.map(a => a.length)) * 10.4 + 6);
        if (height > FOOT - 175) fail('A schedule identifier is too long for a readable report.');
        if (y + height > FOOT - 20) { next('Review schedules (continued)'); section(title + ' (continued)'); head(); }
        let x = L; wrapped.forEach((rows, i) => { text(rows.join('\n'), x + 5, y + 1, 8, false, widths[i] - 10); x += widths[i]; });
        doc.setDrawColor(210); doc.setLineWidth(.3); doc.line(L, y + height - 7, R, y + height - 7); y += height;
      }
      y += 17;
    };
    const number = (value, factor = 1, digits = 2) => value == null ? '' : (value * factor).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    header(internalReview ? 'Source image review' : 'Roof measurement summary');
    text(internalReview ? 'Proposed geometry / independent review required' : 'Provisional quantities / independent review required', L, 130, 8, false);
    const columns = [['PROJECTED AREA / PROVISIONAL', number(prepared.projected, SQFT) + (prepared.projected == null ? '' : ' ft²')], ['SLOPED AREA / PROVISIONAL', number(prepared.sloped, SQFT) + (prepared.sloped == null ? '' : ' ft²')], internalReview ? ['FACETS / EDGES', prepared.facets.length + ' / ' + prepared.edges.length] : ['ROOF SQUARES / PROVISIONAL', number(prepared.sloped, SQFT / 100)]];
    columns.forEach(([label, value], i) => { text(label, L + i * 184, 156, 7.2, true); text(value, L + i * 184, 176, 14, true); }); line(190);
    let box = null, bounds = null, scale = null;
    if (internalReview) {
    const sourcePoints = [prepared.outline, ...prepared.facets.map(f => f.polygon), ...prepared.edges.map(e => e.points)].flat();
    const xs = sourcePoints.map(p => p[0]), ys = sourcePoints.map(p => p[1]); bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    if (!sourcePoints.length) fail('No source geometry is available to draw.');
    box = { x: 46, y: 212, w: 520, h: 370 }; scale = Math.min((box.w - 36) / Math.max(1, bounds[2] - bounds[0]), (box.h - 36) / Math.max(1, bounds[3] - bounds[1]));
    const P = p => [box.x + box.w / 2 + (p[0] - (bounds[0] + bounds[2]) / 2) * scale, box.y + box.h / 2 + (p[1] - (bounds[1] + bounds[3]) / 2) * scale];
    const path = (points, closed, fill, dashed) => { const pts = points.map(P); doc.setLineWidth(.7); doc.setDrawColor(45); if (fill != null) doc.setFillColor(fill); doc.setLineDashPattern(dashed ? [4, 2] : [], 0); doc.lines(pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]), pts[0][0], pts[0][1], [1, 1], closed && fill != null ? 'FD' : 'S', closed); doc.setLineDashPattern([], 0); };
    for (const f of prepared.facets) path(f.polygon, true, f.status === 'unresolved' ? 247 : 239, true);
    for (const e of prepared.edges) path(e.points, false, null, true);
    if (prepared.outline.length >= 3) path(prepared.outline, true, null, true);
    const occupied = [];
    const key = (value, anchor, dark) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); const w = doc.getTextWidth(value) + 6, h = 12;
      for (let radius = 0; radius <= 72; radius += 12) for (const [dx, dy] of radius ? [[0, -1], [1, 0], [-1, 0], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]] : [[0, 0]]) {
        const x = anchor[0] + dx * radius - w / 2, yy = anchor[1] + dy * radius - h / 2, r = [x, yy, x + w, yy + h];
        if (r[0] < box.x || r[2] > box.x + box.w || r[1] < box.y || r[3] > box.y + box.h || occupied.some(a => r[0] < a[2] + 2 && r[2] > a[0] - 2 && r[1] < a[3] + 2 && r[3] > a[1] - 2)) continue;
        occupied.push(r); if (radius) { doc.setDrawColor(130); doc.setLineWidth(.3); doc.line(anchor[0], anchor[1], x + w / 2, yy + h / 2); }
        doc.setFillColor(dark ? 45 : 255); doc.setDrawColor(130); doc.rect(x, yy, w, h, 'FD'); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(dark ? 255 : 26); doc.text(value, x + 3, yy + 8.5); return;
      }
      unplaced.push(value);
    };
    prepared.facets.forEach(f => key(f.key, P(f.polygon.reduce((s, p) => [s[0] + p[0] / f.polygon.length, s[1] + p[1] / f.polygon.length], [0, 0])), true));
    prepared.edges.forEach(e => { const half = length(e.points) / 2; let walked = 0, anchor = e.points[0]; for (let i = 1; i < e.points.length; i++) { const d = length(e.points.slice(i - 1, i + 1)); if (walked + d >= half) { const t = d ? (half - walked) / d : 0; anchor = [e.points[i - 1][0] + (e.points[i][0] - e.points[i - 1][0]) * t, e.points[i - 1][1] + (e.points[i][1] - e.points[i - 1][1]) * t]; break; } walked += d; } key(e.key, P(anchor), false); });
    text('Source-image orientation; uniformly fitted vector plan. No geographic north or map scale is established here.', L, 606, 8.2, false, 548);
    text('Dashed: proposed / inferred geometry. Keys identify the current model; quantities remain provisional.', L, 628, 8.2, false, 548);
    if (data.sourceImage) { const k = Math.min(140 / prepared.metadata.width, 70 / prepared.metadata.height), w = prepared.metadata.width * k, h = prepared.metadata.height * k; doc.addImage(data.sourceImage, undefined, R - w, 646, w, h); text('Source preview / reference only', 440, 730, 7); }
    text('SOURCE IMAGE REVIEW / not a geographic job or certified roof measurement.', L, 667, 8.5, true, data.sourceImage ? 395 : 548);
    text('Unknown quantities are blank. Source-printed dimensions are unverified statements. No order quantities.', L, 690, 8.2, false, data.sourceImage ? 395 : 548);
    } else {
      y = 222;
      paragraph('Unknown quantities are blank. Source-printed dimensions are unverified statements. No order quantities. No geographic north or map scale is established here.');
      paragraph('Squares equal 100 square feet. Projected area is horizontal footprint area; sloped area requires supported pitch.');
    }
    if (internalReview) next('Current measurement schedules');
    const modelId = row => row.key === row.id ? row.key : row.key + ' / ' + row.id;
    const pitchText = f => f.pitch ? number(f.pitch.rise / f.pitch.run * 12, 1, 1) + ' / 12 ±' + number(f.pitch.uncertainty, 1, 2) : '';
    if (internalReview) {
      table('Facet schedule / provisional areas', [118, 86, 100, 100, 144], ['Key / model ID / status', 'Image px²', 'Projected ft²', 'Sloped ft²', 'Sourced pitch'], prepared.facets.map(f => [modelId(f) + ' / ' + f.status, number(f.pixels2), number(f.projected, SQFT), number(f.sloped, SQFT), pitchText(f)]));
      table('Edge schedule / path lengths, not chords', [118, 110, 88, 116, 116], ['Key / model ID', 'Candidate type', 'Image px', 'Horizontal ft', 'True sloped ft'], prepared.edges.map(e => [modelId(e), e.type + ' / ' + e.status + ' / unverified', number(e.pixels), number(e.horizontal, FT), '']));
    } else {
      table('Area and pitch schedule / provisional', [160, 120, 120, 148], ['Reference / status', 'Projected ft²', 'Sloped ft²', 'Sourced pitch'], prepared.facets.map(f => [modelId(f) + ' / ' + f.status, number(f.projected, SQFT), number(f.sloped, SQFT), pitchText(f)]));
      table('Edge measurement schedule / provisional', [160, 150, 118, 120], ['Reference', 'Type / status', 'Horizontal ft', 'True sloped ft'], prepared.edges.map(e => [modelId(e), e.type + ' / ' + e.status + ' / unverified', number(e.horizontal, FT), '']));
    }
    if (unplaced.length) paragraph('Keys not placed on the plan because of density: ' + unplaced.join(', ') + '. Their model IDs and quantities remain in the schedules.');
    paragraph((internalReview ? 'Facet and edge IDs refer only to source pixels in this revision. ' : '') + 'Physical quantities, when present, use the stated calibration and sourced pitch; they are provisional review values. True sloped edge lengths are not established by a planar image.');
    next('Source and review notes');
    paragraph('Source: ' + (prepared.metadata.source || 'not recorded') + '. Source date: ' + (prepared.metadata.date || 'not recorded') + '. Purpose: ' + (prepared.metadata.purpose || 'image') + '; page ' + (prepared.metadata.sourcePage || 1) + '; rotation ' + (prepared.metadata.rotation || 0) + ' degrees.');
    paragraph('Image: ' + prepared.metadata.width + ' × ' + prepared.metadata.height + ' pixels. Fingerprint: ' + (prepared.metadata.imageFingerprint?.sha256 || 'not provided') + '. Current model revision: ' + prepared.revision + '.');
    paragraph(prepared.physical ? 'Physical basis: ' + (prepared.metadata.georef?.source || prepared.metadata.calibration?.source || 'recorded calibration') + '. This does not certify the roof outline, pitch or source statements.' : 'Physical quantities withheld: ' + (prepared.restricted ? 'perspective, oblique or uncalibrated source orientation.' : !prepared.geometryOK ? 'geometry validation requires correction.' : prepared.metadata.georef?.verified ? 'georeferenced quantities require the geographic validation/report path; this PDF validates image calibration only.' : 'no usable verified image calibration.'));
    if (prepared.physical && prepared.metadata.calibration) {
      const c = prepared.metadata.calibration;
      paragraph('Horizontal reference segment ' + (c.a || c.start).join(', ') + ' to ' + (c.b || c.end).join(', ') +
        ' px, ' + (c.distance ?? c.lengthFt) + ' ' + (c.unit || 'ft') + '. Calibration date ' + (c.date || 'unknown') + '.');
    }
    const pitched = prepared.facets.filter(f => f.pitch);
    if (pitched.length) {
      section('Pitch evidence');
      for (const f of pitched) paragraph(modelId(f) + ' / ' + f.pitch.source);
    }
    if (prepared.annotations.length) {
      section('Source-reported annotations / never verified takeoff');
      for (const a of prepared.annotations) {
        paragraph(a.key + (a.id ? ' / ' + a.id : '') + ' / ' + a.kind + ' / ' + a.status, 8.5);
        paragraph('Source page ' + (prepared.metadata.sourcePage || 1) + (a.bounds
          ? ', image region from (' + a.bounds.slice(0, 2).join(', ') + ') to (' + a.bounds.slice(2).join(', ') + ') px.' : ', image region unavailable.'));
        paragraph(a.text);
      }
    }
    if (prepared.reviewRecords.length) { section('User boundary reviews / not independent certification'); for (const r of prepared.reviewRecords) { paragraph(r.kind + ' / ' + r.id + ' / ' + r.status, 8.5); paragraph('Source: ' + (r.source || 'not recorded') + '; date: ' + (r.date || 'not recorded') + '. ' + r.note); } }
    if (prepared.issues.length) { section('Review findings'); prepared.issues.forEach(q => paragraph(q)); }
    if (prepared.corrections.length) { section('Current revision correction history'); prepared.corrections.forEach(q => paragraph(q, 8.5, 3)); }
    paragraph('Prior reviews retained in the saved JSON: ' + prepared.previousReviews + '. This PDF contains current-revision quantities only. Preserve the review JSON and original image for the complete audit.');
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); page = i; line(748); text('DIVERSITY CONTRACTING / ' + (internalReview ? 'SOURCE IMAGE REVIEW' : 'ROOF MEASUREMENT SUMMARY'), L, 764, 7, true); text(i + ' of ' + pages, R, 764, 7, true, null, 'right'); }
    const outside = textBoxes.filter(b => b.x0 < 0 || b.x1 > W || b.y0 < 0 || b.y1 > H);
    if (outside.length) fail('A source review text item would be clipped. Shorten its identifier or metadata.');
    stillCurrent();
    doc.setProperties({ title: (internalReview ? 'Source image review' : 'Roof measurement summary') + ' / revision ' + prepared.revision, author: 'Diversity Contracting', subject: internalReview ? 'REVIEW REQUIRED; source-pixel geometry, no geographic or purchasing certification' : 'REVIEW REQUIRED; provisional measurement tables; no segmentation imagery or certification' });
    const blob = new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
    blob.reviewReport = { revision: prepared.revision, pages, status: prepared.status, internalReview, plan: internalReview ? { box, bounds, uniformPointsPerPixel: scale } : null, unplacedKeys: unplaced, clippedText: outside.length };
    return blob;
  }
  host.buildAIReviewPDF = buildAIReviewPDF;
  host.prepareAIReviewReport = prepareAIReviewReport;
  if (typeof module !== 'undefined' && module.exports) module.exports = { prepareAIReviewReport, buildAIReviewPDF };
})(typeof window !== 'undefined' ? window : globalThis);
