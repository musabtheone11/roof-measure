// node realmd.mjs  -> rewrites REAL.md from truth/*.json and the results real.mjs saved in real-cache/<address>.json
import fs from 'node:fs';
const T = ['eave', 'rake', 'ridge', 'hip', 'valley', 'step', 'wall', 'transition'];
const r0 = (v) => (v == null ? '-' : String(Math.round(v)));
const mix = (pa) => (pa ? Object.entries(pa).filter(([, a]) => a >= 1).sort((a, b) => b[1] - a[1]).map(([p, a]) => `${Math.round(+p)}/12:${Math.round(a)}`).join(' ') : '-');
const within = (e, g) => Math.abs(e - g) <= Math.max(5, 0.1 * g);
const grade = (t, s) => { if (!s) return 'not run'; const b = s.byType, g = t.ft, sum = (o, ks) => ks.reduce((a, k) => a + (o[k] || 0), 0);
  const fails = []; if (Math.abs(s.sloped - t.areaSqft) / t.areaSqft > 0.03) fails.push('area'); if (s.predominant !== t.predominantPitch) fails.push('pitch');
  for (const [lab, ks] of [['eave', ['eave']], ['rake', ['rake']], ['ridge+hip', ['ridge', 'hip']], ['valley', ['valley']], ['step+wall', ['step', 'wall']]]) if (!within(sum(b, ks), sum(g, ks))) fails.push(lab);
  if ((b.transition || 0) - (g.transition || 0) > 5) fails.push('transitions'); return fails.length ? 'no: ' + fails.join(', ') : 'YES'; };
let out = `# Real roofs: truth vs original engine vs current engine\n\nEach cell is **truth / original / current**. Lengths in feet, area in sq ft. "Original" is the frozen engine in \`engines/base\`.\nGAF-grade = area within 3%, predominant pitch exact, eave, rake, ridge+hip, valley and step+wall each within 10% or 5 ft, no phantom transitions.\nRegenerate with \`node realmd.mjs\` after \`node real.mjs --truth truth/<file>.json\` (first run of an address needs the Google key and costs about 10 cents; later runs use \`real-cache/\` and are free).\n\n`;
out += `| address | area | facets | ${T.join(' | ')} | pitch mix (truth) | pitch mix (current) | GAF-grade original | GAF-grade current |\n|${'---|'.repeat(T.length + 7)}\n`;
let nRun = 0, nGood = 0, nGood0 = 0, n = 0;
for (const f of fs.readdirSync('truth').filter((x) => x.endsWith('.json')).sort()) {
  const t = JSON.parse(fs.readFileSync('truth/' + f, 'utf8')); n++;
  const rf = `real-cache/${t.address.replace(/\W+/g, '_')}.json`; const res = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')) : null;
  const o = res ? res.orig : null, c = res ? res.now : null; const earlier = !res && t.ourOriginalReport ? t.ourOriginalReport : null;
  const cell = (g, a, b) => `${r0(g)} / ${r0(a)} / ${r0(b)}`;
  if (res) { nRun++; if (grade(t, c) === 'YES') nGood++; if (grade(t, o) === 'YES') nGood0++; }
  out += `| ${t.address} | ${cell(t.areaSqft, o ? o.sloped : earlier && earlier.areaSqft, c && c.sloped)} | ${cell(t.facets, o ? o.facetCount : earlier && earlier.facets, c && c.facetCount)} | ${T.map((k) => cell(t.ft[k] || 0, o ? o.byType[k] : earlier && earlier.ft[k], c && c.byType[k])).join(' | ')} | ${mix(t.pitchAreas)} | ${mix(c && c.pitchAreas)} | ${res ? grade(t, o) : earlier ? 'not run (numbers from the earlier app report)' : 'not run'} | ${grade(t, c)} |\n`;
}
out += `\n${n} addresses with truth, ${nRun} traced. GAF-grade: original ${nGood0}/${nRun}, current ${nGood}/${nRun}.\n`;
fs.writeFileSync('REAL.md', out); console.log(out);
