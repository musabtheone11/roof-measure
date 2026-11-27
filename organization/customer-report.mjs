import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const ROOT_KEYS = new Set(['schemaVersion', 'jobId', 'revision', 'date', 'buildingScope', 'status', 'quantities', 'notes']);
const Q_KEYS = new Set(['name', 'value', 'unit', 'status', 'source']);
const TEXT = v => typeof v === 'string' && v.length <= 1000 && !/[\x00-\x08\x0b-\x1f]/.test(v);
export function customerProjection(input) {
  if (!input || Object.keys(input).some(k => !ROOT_KEYS.has(k)) || input.schemaVersion !== 1 ||
      !['jobId', 'revision', 'date', 'buildingScope', 'status'].every(k => TEXT(input[k])) ||
      input.status !== 'REVIEW REQUIRED' || !Array.isArray(input.quantities) || input.quantities.length > 200 ||
      !Array.isArray(input.notes) || input.notes.length > 30 || input.notes.some(x => !TEXT(x))) throw new Error('Invalid customer report projection');
  for (const q of input.quantities) {
    if (!q || Object.keys(q).some(k => !Q_KEYS.has(k)) || !['name', 'unit', 'status', 'source'].every(k => TEXT(q[k])) ||
        !['source-reported', 'reviewed', 'inferred', 'user-provided', 'measured', 'unknown'].includes(q.status) ||
        !(q.value === null || (Number.isFinite(q.value) && q.value >= 0)) || (q.status === 'unknown' && q.value !== null))
      throw new Error('Invalid report quantity');
  }
  // A private geometry model must never be spread into this output.
  return structuredClone(input);
}
export function renderCustomerPDF(input) {
  const report = customerProjection(input);
  const {jsPDF} = require('../vendor/jspdf/jspdf.umd.min.js');
  const doc = new jsPDF({unit: 'pt', format: 'letter'});
  let y = 54;
  function line(text, {bold = false} = {}) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 13 : 10);
    for (const row of doc.splitTextToSize(text, 500)) {
      if (y > 730) { doc.addPage(); y = 54; }
      doc.text(row, 54, y); y += 15;
    }
  }
  line('Diversity Contracting | Roof Measurement Review', {bold: true});
  line('REVIEW REQUIRED - source-reported or reviewed quantities; not accuracy certification.');
  for (const key of ['jobId', 'revision', 'date', 'buildingScope']) line(`${key}: ${report[key]}`);
  y += 10;
  line('Measurement summary', {bold: true});
  for (const q of report.quantities) line(`${q.name}: ${q.value === null ? 'Unknown' : q.value} ${q.unit} | ${q.status} | Source: ${q.source}`);
  y += 10; line('Notes and exclusions', {bold: true});
  for (const note of report.notes) line(note);
  return Buffer.from(doc.output('arraybuffer'));
}
