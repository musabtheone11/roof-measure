'use strict';
/* xactimate.js - insurance estimate in the Xactimate layout, built from the measured roof.
 * Same pages, wording and line item descriptions as the Xactimate estimates in Diversity's claim files (carrier
 * adjuster reports and Diversity supplements): header page, roof sketch, line items with TAX / RCV / DEPREC. / ACV,
 * Summary for Dwelling, Recap of Taxes, Recap by Room, Recap by Category. Printed under the company's own name.
 *
 * Every quantity comes from the measurements or from a count entered in the panel; nothing is added that is not on the
 * roof. The scope is the full code-compliant replacement (the items carriers pay on supplements: starter on eaves and
 * rakes, re-nail, sealed deck seam tape, sealant along the drip edge, mastic at penetrations, steep / high charges...).
 * Unit prices are the Jacksonville price list values from the estimates in the claim files; edit them under Prices.
 * Uses globals from app.js / report.js: state, computeTotals, esc, fmt, $, toast, download, fileBase, company,
 * roofrDiagram, permit.
 */

// ------------------------------------------------------------------ price list
// [description, unit, unit price, material cost per unit (taxable part), recap category]
// Prices: FLJA8X_SEP26 unless marked; the material part is the tax per unit seen on the estimates / 7%.
const XM_PRICE_LIST = 'FLJA8X_SEP26';
const XM_DEFAULT_PRICES = {
  rem_lam:      ['Remove Laminated - comp. shingle rfg. - w/ felt', 'SQ', 80.86, 0, 'GENERAL DEMOLITION'],
  tear_lam:     ['Tear off, haul and dispose of comp. shingles - Laminated', 'SQ', 80.86, 0, 'GENERAL DEMOLITION'],
  rem_3tab:     ['Remove 3 tab - 25 yr. - composition shingle roofing - incl. felt', 'SQ', 78.49, 0, 'GENERAL DEMOLITION'],
  rem_layer:    ['Remove Laminated - comp. shingle rfg. - w/out felt', 'SQ', 80.74, 0, 'GENERAL DEMOLITION'],            // AUG26; second layer
  lam:          ['Laminated - comp. shingle rfg. - w/out felt', 'SQ', 293.88, 128.77, 'ROOFING'],
  tab3:         ['3 tab - 25 yr. - comp. shingle roofing - w/out felt', 'SQ', 266.31, 127.52, 'ROOFING'],
  felt30:       ['Roofing felt - 30 lb.', 'SQ', 49.17, 17.96, 'ROOFING'],
  synth:        ['Roofing felt - synthetic underlayment', 'SQ', 52.04, 16.82, 'ROOFING'],
  renail:       ['Re-nailing of roof sheathing - complete re-nail', 'SF', 0.30, 0.01, 'ROOFING'],
  tape:         ['Water barrier joint taping - Mod. bitumen - 4" seam tape', 'SF', 0.37, 0.11, 'ROOFING'],
  membrane:     ['Water barrier membrane - Mod. bitumen - entire surface', 'SF', 0.99, 0.54, 'ROOFING'],
  drip:         ['Drip edge', 'LF', 3.34, 1.39, 'ROOFING'],
  rr_drip:      ['R&R Drip edge', 'LF', 3.81, 1.11, 'ROOFING'],
  starter:      ['Asphalt starter - universal starter course', 'LF', 2.11, 0.63, 'ROOFING'],
  sealant:      ['Apply roofing sealant/cement - per LF', 'LF', 0.85, 0.34, 'ROOFING'],
  valley:       ['Valley metal', 'LF', 7.06, 2.71, 'ROOFING'],
  rr_valley:    ['R&R Valley metal', 'LF', 7.91, 2.71, 'ROOFING'],
  iws:          ['Ice & water barrier', 'SF', 2.06, 0.64, 'ROOFING'],                                                 // AUG26
  step:         ['Step flashing', 'LF', 12.56, 2.41, 'ROOFING'],
  wallflash:    ['R&R Aluminum sidewall/endwall flashing - color finish', 'LF', 10.23, 5.04, 'ROOFING'],             // JUN26
  chim_small:   ['R&R Chimney flashing - small (24" x 24")', 'EA', 422.17, 70.29, 'ROOFING'],                         // AUG26
  chim_avg:     ['R&R Chimney flashing - average (32" x 36")', 'EA', 539.31, 123.71, 'ROOFING'],                      // AUG26
  pipe_lead:    ['Flashing - pipe jack - lead', 'EA', 93.94, 56.96, 'ROOFING'],
  rr_pipe_lead: ['R&R Flashing - pipe jack - lead', 'EA', 104.11, 56.96, 'ROOFING'],                                  // AUG26
  pipe:         ['Flashing - pipe jack', 'EA', 61.08, 21.76, 'ROOFING'],
  exhaust4:     ['R&R Exhaust cap - through roof - up to 4"', 'EA', 118.03, 34.14, 'ROOFING'],
  exhaust8:     ['R&R Exhaust cap - through roof - 6" to 8"', 'EA', 131.62, 57.29, 'ROOFING'],                        // AUG26
  turtle:       ['Roof vent - turtle type - Metal', 'EA', 85.16, 30.79, 'ROOFING'],                                   // AUG26
  offridge4:    ['R&R Roof vent - off ridge type - 4\'', 'EA', 174.80, 54.93, 'ROOFING'],
  offridge6:    ['R&R Roof vent - off ridge type - 6\'', 'EA', 241.94, 67.93, 'ROOFING'],
  ridgevent:    ['R&R Continuous ridge vent - shingle-over style', 'LF', 12.59, 4.91, 'ROOFING'],                     // AUG26
  ridgecap:     ['Hip / Ridge cap - Standard profile - composition shingles', 'LF', 6.75, 3.21, 'ROOFING'],
  ridgecap3:    ['Hip / Ridge cap - cut from 3 tab - composition shingles', 'LF', 5.38, 1.42, 'ROOFING'],
  rain:         ['Flashing - rain diverter', 'EA', 52.99, 15.21, 'ROOFING'],                                          // AUG26
  steep79_rem:  ['Remove Additional charge for steep roof - 7/12 to 9/12 slope', 'SQ', 18.55, 0, 'GENERAL DEMOLITION'],   // AUG26
  steep79:      ['Additional charge for steep roof - 7/12 to 9/12 slope', 'SQ', 49.34, 0, 'ROOFING'],                 // AUG26
  steep1012_rem:['Remove Additional charge for steep roof - 10/12 - 12/12 slope', 'SQ', 31.13, 0, 'GENERAL DEMOLITION'],
  steep1012:    ['Additional charge for steep roof - 10/12 - 12/12 slope', 'SQ', 79.26, 0, 'ROOFING'],
  steep12_rem:  ['Remove Additional charge for steep roof greater than 12/12 slope', 'SQ', null, 0, 'GENERAL DEMOLITION'], // not in the claim files: enter it
  steep12:      ['Additional charge for steep roof greater than 12/12 slope', 'SQ', null, 0, 'ROOFING'],           // not in the claim files: enter it
  high_rem:     ['Remove Additional charge for high roof (2 stories or greater)', 'SQ', 7.64, 0, 'GENERAL DEMOLITION'],  // JUL26
  high:         ['Additional charge for high roof (2 stories or greater)', 'SQ', 25.20, 0, 'ROOFING'],                // JUL26
  mastic:       ['Apply mastic around vent pipes to repair leakage', 'EA', 33.61, 1.07, 'ROOFING'],
  satellite:    ['Digital satellite system - Detach & reset', 'EA', 56.48, 0, 'ELECTRICAL - SPECIAL SYSTEMS'],
  gutter:       ['Gutter / downspout - Detach & reset', 'LF', 4.30, 0, 'SOFFIT, FASCIA, & GUTTER'],                   // JUL26
  haul:         ['Haul debris - per pickup truck load - including dump fees', 'EA', 195.18, 0, 'GENERAL DEMOLITION'],
  dumpster:     ['Dumpster load - Approx. 30 yards, 5-7 tons of debris', 'EA', 884.95, 0, 'GENERAL DEMOLITION'],
  permit:       ['Taxes, insurance, permits & fees (Bid Item)', 'EA', 350.00, 0, 'PERMITS AND FEES'],
};

// item notes in the wording Diversity uses on its supplements (shown under the line, like Xactimate line item notes)
const XM_NOTES = {
  mastic: 'Apply approved roofing mastic/sealant around existing vent pipe flashing and penetration points to maintain a watertight roof assembly and prevent leakage. 2023 FBC Plumbing P903.3 requires the vent pipe/roof junction to be made watertight by approved flashing; FBC Residential R903.2 requires flashing to prevent moisture intrusion at roof penetrations.',
  haul: 'For non-shingle debris generated during roof replacement.',
  starter: 'Starter at eaves and rakes per the shingle manufacturer\'s installation instructions, which 2023 FBC Residential R904.1 and R905.1 require to be followed; also required for the manufacturer\'s wind warranty.',
  drip: 'Drip edge at eaves and gables of shingle roofs per 2023 FBC Residential R905.2.8.5.',
  renail: 'Roof deck re-nailed to the ring-shank schedule of 2023 FBC Residential R908.7.1 / FBC Existing Building 706.7.1, required when the roof covering is replaced on a house permitted before March 1, 2002.',
  tape: 'Sealed roof deck per 2023 FBC Residential R905.1.1.1: self-adhered tape over all deck joints with approved underlayment over the entire roof. R908.1 applies this to reroofs.',
  membrane: 'Sealed roof deck per 2023 FBC Residential R905.1.1.1: self-adhered membrane over the entire roof deck. R908.1 applies this to reroofs.',
  sealant: 'A 4-inch width of roof cement over the drip edge flange at eaves and rakes per 2023 FBC Residential R905.2.8.5.',
  iws: 'Self-adhering ASTM D1970 membrane at least 36 inches wide in valleys per 2023 FBC Residential R905.2.8.2.',
  step: 'Step flashing at wall/roof intersections per 2023 FBC Residential R903.2.1 and R905.2.8.3.',
  wallflash: 'Base and counter flashing at roof/wall intersections per 2023 FBC Residential R905.2.8.1.',
  permit: 'Building permit (Fla. Stat. 553.79) and Notice of Commencement (Fla. Stat. 713.13) required for the reroof.',
};

// ------------------------------------------------------------------ settings (saved in this browser)
const XM_DEFAULTS = {
  insured: '', phone: '', email: '', claim: '', policy: '', lossType: 'Wind Damage', dateOfLoss: '', dateInspected: '',
  deductible: '', priceList: XM_PRICE_LIST, taxRate: '', estName: '',
  shingle: 'lam', waste: '', underlay: 'felt30', deck: 'tape', drip: 'rr', valley: 'rr', iws: true, renail: true, sealant: true,
  starter: true, ridgeVent: false, mastic: true, steep: true, high: true, notes: true, op: false, removal: 'tear',
  pipeLead: 3, pipe: 0, exhaust4: 0, exhaust8: 0, turtle: 0, offridge4: 0, offridge6: 0, rain: 0, satellite: 0, chimney: 'none',
  gutterLF: 0, haul: 1, dumpster: 0, permit: true, permitAmt: 350, bold: true, appendToReport: false, prices: {},
};
const xm = Object.assign({}, XM_DEFAULTS, JSON.parse(localStorage.getItem('rm.xm') || '{}'));
const xmSave = () => { const s = Object.assign({}, xm); for (const k of ['insured', 'phone', 'email', 'claim', 'policy', 'dateOfLoss', 'dateInspected', 'deductible', 'estName']) delete s[k]; localStorage.setItem('rm.xm', JSON.stringify(s)); };
const xmPrice = (k) => { const d = XM_DEFAULT_PRICES[k]; const o = xm.prices[k]; return { desc: d[0], unit: d[1], price: o && o.price != null ? +o.price : d[2], mat: o && o.mat != null ? +o.mat : d[3], cat: d[4] }; };

// county material sales tax (state 6% + county surtax)
const XM_COUNTY_TAX = { Duval: 7.5, Clay: 7.5, 'St. Johns': 6.5, 'St Johns': 6.5, Nassau: 7.0, Baker: 7.0, Putnam: 7.0, Flagler: 7.0 };
function xmTaxRate() {
  if (xm.taxRate !== '' && xm.taxRate != null && isFinite(+xm.taxRate)) return +xm.taxRate / 100;
  const c = typeof permit !== 'undefined' && permit.data && permit.data.county;
  if (c && XM_COUNTY_TAX[c] != null) return XM_COUNTY_TAX[c] / 100;
  if (/ponte vedra|st\.? augustine|saint johns|st\.? johns|nocatee/i.test(state.address || '')) return 0.065;
  return 0.075;                                                     // Jacksonville / Duval
}

// ------------------------------------------------------------------ scope from the measurements
const r2 = (x) => Math.round((x + 1e-9) * 100) / 100;
const third = (sq) => Math.ceil(sq * 3 - 1e-6) / 3;                 // shingles are bought by the bundle (1/3 square)

function xmScope() {
  const t = computeTotals();
  const bt = t.byType;
  const L = (k) => (bt[k] ? bt[k].true : 0);
  const area = t.pitched;                                           // shingle area (flat sections are not shingled)
  const SQ = area / 100;
  const eaves = L('eave'), rakes = L('rake'), per = eaves + rakes, valleys = L('valley'), hips = L('hip'), ridges = L('ridge');
  const waste = xm.waste !== '' && xm.waste != null && isFinite(+xm.waste) ? +xm.waste : (t.recWaste != null ? t.recWaste : 10);
  const installSQ = third(SQ * (1 + waste / 100));
  const g = t.pitchGroups;
  const sqAt = (lo, hi) => Object.keys(g).map(Number).filter((p) => p >= lo && p <= hi).reduce((s, p) => s + Math.max(0, g[p]), 0) / 100;
  const s79 = sqAt(7, 9.49), s1012 = sqAt(9.5, 12.49), s12 = sqAt(12.5, 99);
  const twoStorySQ = t.twoStory / 100, twoLayerSQ = t.twoLayer / 100;
  const pen = (+xm.pipeLead || 0) + (+xm.pipe || 0) + (+xm.exhaust4 || 0) + (+xm.exhaust8 || 0) + (+xm.turtle || 0) + (+xm.offridge4 || 0) + (+xm.offridge6 || 0);
  const lines = [];
  const add = (key, qty, extra = {}) => { if (qty > 0.004) lines.push(Object.assign({ key, qty: r2(qty) }, extra)); };

  add(xm.removal === 'tear' ? 'tear_lam' : xm.shingle === 'tab3' ? 'rem_3tab' : 'rem_lam', SQ);
  add('rem_layer', twoLayerSQ);
  if (xm.steep) { add('steep79_rem', s79); add('steep1012_rem', s1012); add('steep12_rem', s12); }
  if (xm.high) add('high_rem', twoStorySQ);
  add(xm.shingle === 'tab3' ? 'tab3' : 'lam', installSQ);
  if (xm.steep) { add('steep79', s79); add('steep1012', s1012); add('steep12', s12); }      // measured squares, no waste (carrier guidelines)
  if (xm.high) add('high', twoStorySQ);
  add(xm.underlay === 'synth' ? 'synth' : 'felt30', SQ);
  // the re-nail code note only applies to houses permitted before March 1, 2002 (FBC-EB 706.7 exception)
  const built = typeof permit !== 'undefined' && permit.data && permit.data.yearBuilt;
  if (xm.renail) add('renail', area, { note: built && +built >= 2002 ? null : 'renail' });
  if (xm.deck === 'tape') add('tape', area, { note: 'tape' }); else if (xm.deck === 'membrane') add('membrane', area, { note: 'membrane' });
  add(xm.drip === 'rr' ? 'rr_drip' : 'drip', per, { note: 'drip' });
  if (xm.starter && xm.shingle !== 'tab3') add('starter', per, { note: 'starter' });    // 3-tab starter rows are inside the shingle waste
  if (xm.sealant) add('sealant', per, { note: 'sealant' });
  if (xm.valley !== 'none') add(xm.valley === 'rr' ? 'rr_valley' : 'valley', valleys);
  if (xm.iws) add('iws', valleys * 3, { note: 'iws' });
  add('step', L('step'), { note: 'step' });
  add('wallflash', L('wall'), { note: 'wallflash' });
  if (xm.chimney === 'small') add('chim_small', 1); else if (xm.chimney === 'avg') add('chim_avg', 1);
  add('pipe_lead', +xm.pipeLead || 0); add('pipe', +xm.pipe || 0);
  add('exhaust4', +xm.exhaust4 || 0); add('exhaust8', +xm.exhaust8 || 0);
  add('turtle', +xm.turtle || 0); add('offridge4', +xm.offridge4 || 0); add('offridge6', +xm.offridge6 || 0);
  if (xm.ridgeVent) add('ridgevent', ridges);
  add(xm.shingle === 'tab3' ? 'ridgecap3' : 'ridgecap', hips + ridges);
  add('rain', +xm.rain || 0);
  if (xm.mastic) add('mastic', pen, { note: 'mastic' });
  add('satellite', +xm.satellite || 0);
  add('gutter', +xm.gutterLF || 0);
  add('haul', +xm.haul || 0, { note: 'haul' }); add('dumpster', +xm.dumpster || 0);
  if (xm.permit) add('permit', 1, { note: 'permit', price: +xm.permitAmt || 0 });

  const meas = { area: t.sloped, SQ: t.sloped / 100, per, ridges, hips, valleys, eaves, rakes, step: L('step'), wall: L('wall'), waste, installSQ, flat: t.flat };
  return { lines, meas, t };
}

// ------------------------------------------------------------------ pricing
function xmPriced() {
  const { lines, meas, t } = xmScope();
  const rate = xmTaxRate();
  let n = 0;
  const unpriced = [];                                              // items with no price on file are left out and listed in the panel
  const items = lines.filter((l) => { const p = xmPrice(l.key); if (l.price == null && (p.price == null || !isFinite(p.price))) { unpriced.push(`${p.desc} (${q2(l.qty)} ${p.unit})`); return false; } return true; }).map((l) => {
    const p = xmPrice(l.key);
    const price = l.price != null ? l.price : p.price;
    const ext = r2(l.qty * price);
    const tax = r2(l.qty * p.mat * rate);
    return { n: ++n, key: l.key, desc: p.desc, unit: p.unit, qty: l.qty, price, ext, tax, rcv: r2(ext + tax), deprec: 0, cat: p.cat, note: xm.notes && l.note ? XM_NOTES[l.note] : '' };
  });
  const lit = r2(items.reduce((s, i) => s + i.ext, 0));
  const tax = r2(items.reduce((s, i) => s + i.tax, 0));
  const overhead = xm.op ? r2((lit + tax) * 0.10) : 0, profit = xm.op ? r2((lit + tax) * 0.10) : 0;
  if (xm.op) { // O&P column: each line's share
    for (const i of items) { i.op = r2((i.ext + i.tax) * 0.20); i.rcv = r2(i.ext + i.tax + i.op); }
  }
  const rcv = r2(lit + tax + overhead + profit);
  const deprec = 0, acv = rcv;
  const deductible = +String(xm.deductible || '').replace(/[^\d.]/g, '') || 0;
  return { items, lit, tax, rate, overhead, profit, rcv, deprec, acv, deductible, net: r2(acv - deductible), meas, t };
}

// ------------------------------------------------------------------ formatting
const money = (x) => (x < 0 ? '(' + money(-x) + ')' : x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const paren = (x) => '(' + money(x) + ')';
const q2 = (x) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dstr = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const dtstr = (d) => `${dstr(d)} ${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
const dIn = (s) => { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null; };
function xmEstName() {
  if (xm.estName) return xm.estName.toUpperCase();
  const nm = (xm.insured || state.jobName || '').trim();
  // accented letters keep their base letter (José García -> GARCIA-JOSE), other characters are dropped
  if (nm) { const p = nm.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[Đđ]/g, 'D').replace(/[^A-Za-z\s-]/g, '').split(/\s+/).filter(Boolean); if (p.length >= 2) return (p[p.length - 1] + '-' + p[0]).toUpperCase(); return p[0].toUpperCase(); }
  return ((state.address || 'ESTIMATE').split(',')[0]).toUpperCase().replace(/\s+/g, '-');
}
function xmAddrLines() {
  const a = (state.address || '').replace(/,\s*(USA|United States)$/i, '');
  const i = a.indexOf(','); if (i < 0) return [a, ''];
  return [a.slice(0, i).trim(), a.slice(i + 1).trim().replace(/,\s*FL\b/, ' , FL')];
}

// ------------------------------------------------------------------ CSS (Xactimate print look: Times, black rules)
const XM_CSS = `
@page { size: letter; margin: 0; }
.xm { font-family: "Times New Roman", Times, "Liberation Serif", serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.xm * { box-sizing: border-box; }
.xm .xm-page table { font-size: 10pt; border-collapse: collapse; }
.xm .xm-page th, .xm .xm-page td { background: none; color: #000; border: 0; padding: 1px 3px; font-weight: normal; text-align: left; }
.xm-page { width: 8.5in; height: 11in; margin: 0 auto; padding: .45in .42in .4in; background: #fff; display: flex; flex-direction: column; position: relative; page-break-after: always; break-after: page; overflow: hidden; font-size: 10.5pt; line-height: 1.22; }
.xm-page:last-child { page-break-after: auto; break-after: auto; }
.xm .hd { display: flex; align-items: flex-end; gap: 10px; margin-bottom: .32in; }
.xm .hd img { height: .44in; width: auto; display: block; }
.xm .hd .co { flex: 1; font-weight: bold; font-size: 12.5pt; border-bottom: 1px solid #000; padding-bottom: 2px; letter-spacing: .2px; }
.xm .ft { margin-top: auto; display: flex; font-size: 10pt; padding-top: 8px; }
.xm .ft span:first-child { flex: 1; } .xm .ft span:nth-child(2) { width: 1.25in; } .xm .ft span:last-child { width: .6in; text-align: right; }
.xm table { border-collapse: collapse; }
.xm .hdr { width: 100%; margin-top: .25in; }
.xm .hdr td { padding: 1px 4px; vertical-align: top; }
.xm .hdr td.l { text-align: right; white-space: nowrap; width: 1.25in; }
.xm .hdr td.l2 { text-align: right; white-space: nowrap; width: 1.1in; }
.xm .hdr .gap td { height: 14px; }
.xm .claimrow { display: flex; gap: .3in; margin: 6px 0 10px .1in; } .xm .claimrow b { margin-right: 4px; }
.xm .ctr { text-align: center; font-weight: bold; }
.xm .room { margin: 10px 0 4px 2.0in; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 1px; }
.xm .areas { display: grid; grid-template-columns: repeat(3, auto); justify-content: start; gap: 1px 28px; margin: 2px 0 8px .05in; font-size: 9.5pt; }
.xm .areas span b { font-weight: normal; display: inline-block; min-width: .8in; text-align: right; margin-right: 6px; }
.xm .li { width: 100%; font-size: 10pt; table-layout: fixed; }
.xm .li th:nth-child(1) { width: 45%; } .xm .li th:nth-child(2) { width: 11.5%; } .xm .li th:nth-child(3) { width: 9.5%; }
.xm .li th:nth-child(4) { width: 7%; } .xm .li th:nth-child(n+5) { width: 9%; }
.xm .li th { font-weight: bold; text-align: right; padding: 2px 3px; border-bottom: 1px solid #000; white-space: nowrap; }
.xm .li th:first-child { text-align: left; }
.xm .li td { padding: 1px 3px; text-align: right; vertical-align: top; white-space: nowrap; }
.xm .li td:first-child { text-align: left; white-space: normal; padding-left: 0; }
.xm .li tr.b td { font-weight: bold; }
.xm .li td.xnote { white-space: normal; text-align: left; padding: 0 0 6px 14px; font-weight: normal !important; font-size: 10pt; color: #000; }
.xm .li tr.tot td { font-weight: bold; border-top: 3px double #000; padding-top: 4px; padding-bottom: 6px; }
.xm .sum { width: 6.9in; margin: 0 auto; }
.xm .sum td { padding: 2px 4px; } .xm .sum td.v { text-align: right; width: 1.5in; }
.xm .sum tr.rule td.v { border-top: 1px solid #000; } .xm .sum tr.b td { font-weight: bold; }
.xm .sum tr.dbl td.v { border-bottom: 3px double #000; }
.xm h3 { text-align: center; font-size: 12pt; margin: .1in 0 .12in; }
.xm .sig { margin: .55in 0 0 3.0in; width: 2.3in; border-top: 1px solid #000; padding-top: 2px; }
.xm .recap { width: 100%; } .xm .recap td, .xm .recap th { padding: 3px 4px; text-align: right; } .xm .recap td:first-child, .xm .recap th:first-child { text-align: left; }
.xm .recap th { border-bottom: 1px solid #000; } .xm .recap tr.t td { font-weight: bold; border-top: 3px double #000; }
.xm .sketch { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.xm .sketch svg { width: 100%; height: 100%; }
`;

// ------------------------------------------------------------------ pages
function xmHead() {
  const logo = localStorage.getItem('rm.logo');
  return `<div class="hd">${logo ? `<img src="${logo}" alt="">` : ''}<div class="co">${esc((company.name || '').toUpperCase())}</div></div>`;
}
function xmPage(inner, ctx) { ctx.n++; return `<section class="xm-page">${xmHead()}${inner}<div class="ft"><span>${esc(ctx.name)}</span><span>${ctx.date}</span><span>Page: ${ctx.n}</span></div></section>`; }

function xmHeaderPage(E, ctx) {
  const [a1, a2] = xmAddrLines();
  const now = new Date(), dl = dIn(xm.dateOfLoss), di = dIn(xm.dateInspected);
  const row = (l, v, l2, v2) => `<tr><td class="l">${l}</td><td>${v || ''}</td><td class="l2">${l2 || ''}</td><td>${v2 || ''}</td></tr>`;
  return xmPage(`<table class="hdr">
      ${row('Insured:', esc(xm.insured || ''), xm.phone ? 'Cellular:' : '', esc(xm.phone || ''))}
      ${row('Home:', esc(a1), xm.email ? 'E-mail:' : '', esc(xm.email || ''))}
      ${row('', esc(a2))}
      ${row('Property:', esc(a1))}
      ${row('', esc(a2))}
      <tr class="gap"><td colspan="4"></td></tr>
      ${row('Estimator:', esc(company.name || ''), 'Business:', esc(company.phone || ''))}
    </table>
    <div class="claimrow"><span><b>Claim Number:</b>${esc(xm.claim || '')}</span><span><b>Policy Number:</b>${esc(xm.policy || '')}</span><span><b>Type of Loss:</b>${esc(xm.lossType || '')}</span></div>
    <table class="hdr" style="margin-top:4px">
      ${row('Date of Loss:', dl ? dtstr(new Date(dl.setHours(0, 0))) : '', 'Date Entered:', dtstr(now))}
      ${row('Date Inspected:', di ? dtstr(new Date(di.setHours(0, 0))) : '')}
      <tr class="gap"><td colspan="4"></td></tr>
      ${row('Price List:', esc(xm.priceList || XM_PRICE_LIST))}
      ${row('', 'Restoration/Service/Remodel')}
      ${row('Estimate:', esc(ctx.name))}
    </table><div style="flex:1"></div>`, ctx);
}

function xmSketchPage(E, ctx) {
  const t = E.t;
  if (!t.facets.length || typeof roofrDiagram !== 'function') return '';
  return xmPage(`<div class="ctr">${esc(ctx.name)}</div><div class="ctr" style="margin-bottom:6px">Main Level</div>
    <div class="room">Dwelling Roof</div>${xmAreas(E)}
    <div class="sketch">${roofrDiagram(t, 'lengths', 700, 640)}</div>`, ctx);
}
function xmAreas(E) {
  const m = E.meas;
  const cells = [[q2(m.area), 'Surface Area'], [q2(m.SQ), 'Number of Squares'], [q2(m.per), 'Total Perimeter Length'], [q2(m.ridges), 'Total Ridge Length'], [q2(m.hips), 'Total Hip Length'], [q2(m.valleys), 'Total Valley Length']];
  return `<div class="areas">${cells.map(([v, l]) => `<span><b>${v}</b>${l}</span>`).join('')}</div>`;
}

// split the line items over pages (Xactimate keeps the room heading and column header on each page)
function xmLinePages(E, ctx) {
  const op = !!xm.op;
  const thead = `<tr><th>DESCRIPTION</th><th>QUANTITY</th><th>UNIT PRICE</th><th>TAX</th>${op ? '<th>O&amp;P</th>' : ''}<th>RCV</th><th>DEPREC.</th><th>ACV</th></tr>`;
  const cols = op ? 8 : 7;
  const rowHtml = (i) => {
    const b = xm.bold && /^(renail|tape|membrane|starter|sealant|iws|mastic|steep|high|haul|permit|rr_valley|step|wallflash)/.test(i.key) ? ' class="b"' : '';
    const r = `<tr${b}><td>${i.n}.&nbsp; ${esc(i.desc)}</td><td>${q2(i.qty)} ${i.unit}</td><td>${money(i.price)}</td><td>${money(i.tax)}</td>${op ? `<td>${money(i.op)}</td>` : ''}<td>${money(i.rcv)}</td><td>${paren(i.deprec)}</td><td>${money(i.rcv - i.deprec)}</td></tr>`;
    return i.note ? r + `<tr><td class="xnote" colspan="${cols}">${esc(i.note)}</td></tr>` : r;
  };
  const lineCost = (i) => Math.ceil(i.desc.length / 44) + (i.note ? Math.ceil(i.note.length / 125) + 0.4 : 0);
  const totals = (label) => `<tr class="tot"><td>${label}</td><td></td><td></td><td>${money(E.tax)}</td>${op ? `<td>${money(E.overhead + E.profit)}</td>` : ''}<td>${money(E.rcv)}</td><td>${money(E.deprec)}</td><td>${money(E.acv)}</td></tr>`;
  const pages = [];
  let cur = [], used = 0, first = true;
  const CAP_FIRST = 34, CAP = 40;
  for (const i of E.items) {
    const c = lineCost(i);
    if (used + c > (first ? CAP_FIRST : CAP) && cur.length) { pages.push({ rows: cur, first }); cur = []; used = 0; first = false; }
    cur.push(i); used += c;
  }
  const tailNeeds = 6;
  if (used + tailNeeds > (first ? CAP_FIRST : CAP)) { pages.push({ rows: cur, first }); cur = []; first = false; }
  pages.push({ rows: cur, first, last: true });
  return pages.map((p) => xmPage(`${p.first ? `<div class="ctr">${esc(ctx.name)}</div><div class="ctr" style="margin-bottom:4px">Main Level</div>` : ''}
    <div class="room">Dwelling Roof${p.first ? '' : ' (continued)'}</div>${p.first ? xmAreas(E) : ''}
    <table class="li">${thead}${p.rows.map(rowHtml).join('')}
    ${p.last ? totals('Totals:&nbsp; Dwelling Roof') + totals('Total:&nbsp; Main Level') + totals(`Line Item Totals:&nbsp; ${esc(ctx.name)}`) : ''}</table>`, ctx)).join('');
}

function xmSummaryPage(E, ctx) {
  const rows = [['Line Item Total', money(E.lit)], ['Material Sales Tax', money(E.tax)]];
  if (xm.op) rows.push(['Overhead', money(E.overhead)], ['Profit', money(E.profit)]);
  let h = rows.map(([l, v]) => `<tr><td>${l}</td><td class="v">${v}</td></tr>`).join('');
  h += `<tr class="rule b"><td>Replacement Cost Value</td><td class="v">$${money(E.rcv)}</td></tr>`;
  if (E.deprec) h += `<tr><td>Less Depreciation</td><td class="v">${paren(E.deprec)}</td></tr><tr class="rule b"><td>Actual Cash Value</td><td class="v">$${money(E.acv)}</td></tr>`;
  if (E.deductible) h += `<tr><td>Less Deductible</td><td class="v">${paren(E.deductible)}</td></tr>`;
  h += `<tr class="rule b dbl"><td>Net Claim</td><td class="v">$${money(E.net)}</td></tr>`;
  return xmPage(`<div style="height:.35in"></div><h3>Summary for Dwelling</h3><table class="sum">${h}</table>
    <div class="sig">${esc(company.name || '')}</div><div style="flex:1"></div>`, ctx);
}

function xmTaxPage(E, ctx) {
  const pct = (E.rate * 100).toFixed(1).replace(/\.0$/, '');
  return xmPage(`<div style="height:.35in"></div><h3>Recap of Taxes</h3>
    <table class="recap"><tr><th></th><th>Material Sales Tax (${pct}%)</th><th>Laundering Tax (2%)</th><th>Manuf. Home Tax (6%)</th><th>Storage Rental Tax (${pct}%)</th></tr>
    <tr><td><b>Line Items</b></td><td>${money(E.tax)}</td><td>0.00</td><td>0.00</td><td>0.00</td></tr>
    <tr class="t"><td>Total</td><td>${money(E.tax)}</td><td>0.00</td><td>0.00</td><td>0.00</td></tr></table><div style="flex:1"></div>`, ctx);
}

function xmRecapPages(E, ctx) {
  const base = E.lit;
  const pct = (v) => (base ? (v / base * 100) : 0).toFixed(2) + '%';
  const room = xmPage(`<div style="height:.35in"></div><h3>Recap by Room</h3>
    <div style="margin:0 0 8px">Estimate: ${esc(ctx.name)}</div>
    <table class="recap"><tr><td colspan="3"><b>Area: Main Level</b></td></tr>
    <tr><td style="padding-left:.3in">Dwelling Roof</td><td>${money(base)}</td><td>${pct(base)}</td></tr>
    <tr class="t"><td>Area Subtotal: Main Level</td><td>${money(base)}</td><td>${pct(base)}</td></tr>
    <tr><td>Subtotal of Areas</td><td>${money(base)}</td><td>${pct(base)}</td></tr>
    <tr class="t"><td>Total</td><td>${money(base)}</td><td>${pct(base)}</td></tr></table><div style="flex:1"></div>`, ctx);
  const cats = {};
  for (const i of E.items) cats[i.cat] = (cats[i.cat] || 0) + i.ext;
  const order = Object.keys(cats).sort();
  const total = E.rcv;
  const p2 = (v) => (total ? (v / total * 100) : 0).toFixed(2) + '%';
  const catRows = order.map((c) => `<tr><td>${c}</td><td>${money(r2(cats[c]))}</td><td>${p2(cats[c])}</td></tr>`).join('');
  const extra = [['Material Sales Tax', E.tax]].concat(xm.op ? [['Overhead', E.overhead], ['Profit', E.profit]] : []);
  const cat = xmPage(`<div style="height:.35in"></div><h3>Recap by Category</h3>
    <table class="recap"><tr><th>Items</th><th>Total</th><th>%</th></tr>${catRows}
    <tr class="t"><td>Subtotal</td><td>${money(base)}</td><td>${p2(base)}</td></tr>
    ${extra.map(([l, v]) => `<tr><td>${l}</td><td>${money(v)}</td><td>${p2(v)}</td></tr>`).join('')}
    <tr class="t"><td>Total</td><td>${money(total)}</td><td>100.00%</td></tr></table><div style="flex:1"></div>`, ctx);
  return room + cat;
}

function xmBuildHTML(startPage = 0) {
  const E = xmPriced();
  const ctx = { n: startPage, name: xmEstName(), date: dstr(new Date()) };
  const html = [xmHeaderPage(E, ctx), xmSketchPage(E, ctx), xmLinePages(E, ctx), xmSummaryPage(E, ctx), xmTaxPage(E, ctx), xmRecapPages(E, ctx)].join('');
  return { html: `<style>${XM_CSS}</style><div class="xm">${html}</div>`, E };
}

// ------------------------------------------------------------------ print / download
async function xmEnsureRoof() {
  if (!state.location && !state.facets.length) { toast('Enter an address and measure the roof first.', true); return false; }
  if (!state.facets.length && typeof autoTraceRoof === 'function') {
    if (!state.solar && typeof runSolar === 'function') await runSolar();
    toast('Tracing the roof for the estimate...');
    try { await autoTraceRoof(); } catch (e) { toast('Auto-trace failed (' + e.message + '). Trace the roof first.', true); return false; }
  }
  if (!state.facets.length) { toast('Trace the roof first (panel 2).', true); return false; }
  if (typeof permitEnsure === 'function' && xm.taxRate === '') { try { await Promise.race([permitEnsure(), new Promise((r) => setTimeout(r, 4000))]); } catch (_) { /* tax falls back to Duval */ } }
  return true;
}
async function xmPrint() {
  if (!await xmEnsureRoof()) return;
  const { html } = xmBuildHTML();
  $('#report').innerHTML = html;
  const imgs = [...$('#report').querySelectorAll('img')].filter((i) => !i.complete);
  await Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), new Promise((r) => setTimeout(r, 3000))]);
  window.print();
}
async function xmDownload() {
  if (!await xmEnsureRoof()) return;
  const { html } = xmBuildHTML();
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(xmEstName())}</title><style>body{margin:0;background:#555}.xm-page{margin:16px auto;box-shadow:0 2px 12px rgba(0,0,0,.4)}@media print{body{background:#fff}.xm-page{margin:0;box-shadow:none}.pbtn{display:none}}.pbtn{position:fixed;top:10px;right:10px;background:#1d3b5c;color:#fff;border:0;border-radius:6px;padding:10px 16px;font:600 14px Arial;cursor:pointer;z-index:9}</style></head><body><button class="pbtn" onclick="window.print()">Print / Save as PDF</button>${html}</body></html>`;
  const name = fileBase() + '_Estimate.html';
  if (typeof deliverFile === 'function') { const saved = await deliverFile(new Blob([doc], { type: 'text/html' }), name); toast('Ready: ' + name + (saved ? '; copy saved in the reports folder' : '')); return; }
  download(name, doc, 'text/html');
}

// ------------------------------------------------------------------ panel
function xmRenderSummary() {
  const el = $('#xmOut'); if (!el) return;
  if (!state.facets.length) { el.innerHTML = '<span class="muted">Measure or auto-trace the roof first; the estimate is built from it.</span>'; return; }
  const E = xmPriced();
  const m = E.meas;
  el.innerHTML = `<div class="kv"><span>Roof</span><b>${q2(m.SQ)} SQ, waste ${m.waste}% (${q2(m.installSQ)} SQ shingles)</b></div>
    <div class="kv"><span>Line items</span><b>${E.items.length}</b></div>
    <div class="kv"><span>Line item total</span><b>$${money(E.lit)}</b></div>
    <div class="kv"><span>Material tax (${(E.rate * 100).toFixed(1)}%)</span><b>$${money(E.tax)}</b></div>
    ${xm.op ? `<div class="kv"><span>Overhead + profit</span><b>$${money(E.overhead + E.profit)}</b></div>` : ''}
    <div class="kv"><span>Replacement cost value</span><b>$${money(E.rcv)}</b></div>
    ${E.deductible ? `<div class="kv"><span>Net claim</span><b>$${money(E.net)}</b></div>` : ''}
    ${m.flat > 1 ? `<div class="muted small">Flat area (${fmt(m.flat)} sf) is not in this estimate; add it by hand.</div>` : ''}`;
}
function xmPriceEditor() {
  const el = $('#xmPrices'); if (!el) return;
  el.innerHTML = `<table class="xmp"><tr><th>Line item</th><th>Unit</th><th>Price</th></tr>${Object.keys(XM_DEFAULT_PRICES).map((k) => { const p = xmPrice(k); return `<tr><td>${esc(p.desc)}</td><td>${p.unit}</td><td><input data-k="${k}" type="number" step="0.01" value="${p.price}"></td></tr>`; }).join('')}</table>
    <button id="xmPriceReset" class="ghost small" style="margin-top:6px">Reset prices</button>`;
  el.querySelectorAll('input[data-k]').forEach((inp) => { inp.onchange = () => { const k = inp.dataset.k; xm.prices[k] = Object.assign({}, xm.prices[k], { price: +inp.value }); xmSave(); xmRenderSummary(); }; });
  $('#xmPriceReset').onclick = () => { xm.prices = {}; xmSave(); xmPriceEditor(); xmRenderSummary(); };
}
(function wireXm() {
  if (!$('#panelXm')) return;
  const bind = (id, key, kind) => {
    const el = $('#' + id); if (!el) return;
    if (kind === 'chk') el.checked = !!xm[key]; else el.value = xm[key] == null ? '' : xm[key];
    el.addEventListener(kind === 'chk' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      xm[key] = kind === 'chk' ? el.checked : kind === 'num' ? (el.value === '' ? '' : +el.value) : el.value;
      xmSave(); xmRenderSummary();
    });
  };
  [['xm_insured', 'insured'], ['xm_phone', 'phone'], ['xm_email', 'email'], ['xm_claim', 'claim'], ['xm_policy', 'policy'], ['xm_lossType', 'lossType'], ['xm_dol', 'dateOfLoss'], ['xm_doi', 'dateInspected'],
    ['xm_deductible', 'deductible'], ['xm_priceList', 'priceList'], ['xm_estName', 'estName'], ['xm_shingle', 'shingle'], ['xm_underlay', 'underlay'], ['xm_deck', 'deck'], ['xm_drip', 'drip'],
    ['xm_valley', 'valley'], ['xm_chimney', 'chimney'], ['xm_removal', 'removal']].forEach(([id, k]) => bind(id, k));
  [['xm_taxRate', 'taxRate'], ['xm_waste', 'waste'], ['xm_pipeLead', 'pipeLead'], ['xm_pipe', 'pipe'], ['xm_exhaust4', 'exhaust4'], ['xm_exhaust8', 'exhaust8'], ['xm_turtle', 'turtle'], ['xm_offridge4', 'offridge4'],
    ['xm_offridge6', 'offridge6'], ['xm_rain', 'rain'], ['xm_satellite', 'satellite'], ['xm_gutterLF', 'gutterLF'], ['xm_haul', 'haul'], ['xm_dumpster', 'dumpster'], ['xm_permitAmt', 'permitAmt']].forEach(([id, k]) => bind(id, k, 'num'));
  [['xm_iws', 'iws'], ['xm_renail', 'renail'], ['xm_sealant', 'sealant'], ['xm_starter', 'starter'], ['xm_ridgeVent', 'ridgeVent'], ['xm_mastic', 'mastic'], ['xm_steep', 'steep'], ['xm_high', 'high'],
    ['xm_notes', 'notes'], ['xm_op', 'op'], ['xm_permit', 'permit'], ['xm_bold', 'bold'], ['xm_append', 'appendToReport']].forEach(([id, k]) => bind(id, k, 'chk'));
  // the estimate is priced from the roof totals, so it passes the same review gate as the roof report
  const run = (fn, btn) => async () => { const b = $(btn); b.disabled = true; try { if (state.facets.length && typeof window.rmExportGate === 'function' && !window.rmExportGate()) return; await fn(); } finally { b.disabled = false; } };
  $('#btnXmPrint').onclick = run(xmPrint, '#btnXmPrint');
  $('#btnXmDownload').onclick = run(xmDownload, '#btnXmDownload');
  const logo = $('#co_logo');
  if (logo) logo.onchange = () => { const f = logo.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { localStorage.setItem('rm.logo', rd.result); toast('Logo saved for the estimate header.'); } catch (_) { toast('Logo too large; use an image under 1 MB.', true); } }; rd.readAsDataURL(f); };
  const clr = $('#co_logoClear'); if (clr) clr.onclick = () => { localStorage.removeItem('rm.logo'); toast('Logo removed.'); };
  $('#panelXm').addEventListener('toggle', () => { if ($('#panelXm').open) { xmRenderSummary(); if (!$('#xmPrices').children.length) xmPriceEditor(); } });
  // refresh the summary whenever the roof changes (setLocation / recompute are app.js globals)
  if (typeof recompute === 'function') { const prev = recompute; recompute = function () { const r = prev.apply(this, arguments); try { xmRenderSummary(); } catch (_) { /* panel not ready */ } return r; }; }
  // "add to the end of the roof report": wrap the report builder
  if (typeof buildReportHTML === 'function') {
    const prevBuild = buildReportHTML;
    buildReportHTML = async function () {
      const res = await prevBuild.apply(this, arguments);
      if (xm.appendToReport && state.facets.length) { const { html } = xmBuildHTML(); res.html += html; }
      return res;
    };
  }
  xmRenderSummary();
})();
