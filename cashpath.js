'use strict';
/* cashpath.js - the two estimate paths.
 * Insurance claim: the existing Xactimate-format estimate (panel 6). Nothing about it changes.
 * Cash: the Diversity Roofing estimate builder in cash/ (kept exactly as built). This file only hands the measured roof
 * to that builder the way the builder already loads a saved estimate: its own localStorage key "currentEstimate",
 * read by loadEstimate() in cash/main.js when the page opens. No file in cash/ is modified. */
(function (root) {
  const r2 = (x) => Math.round(x * 100) / 100;

  // roof totals (computeTotals) -> the builder's saved-estimate fields
  function buildCashHandoff(t, st, now) {
    const area = Math.round(t.sloped || 0);
    const len = (k) => r2((t.byType && t.byType[k] && t.byType[k].true) || 0);
    const pitch = t.predominant == null ? null : +t.predominant;
    const d = now || new Date();
    const h = {
      propertyAddress: (st && st.address) || '',
      estimateDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      squareFootage: String(area),
      stories: (t.twoStory || 0) > (t.sloped || 0) / 2 ? '2' : '1',          // two story when most of the roof is flagged two story
      roofPitch: pitch == null ? 'medium' : pitch <= 4 ? 'low' : pitch <= 8 ? 'medium' : 'steep',
      // the same rows the builder shows after a roof report upload
      measurements: [
        { section: 'Main Roof Area', length: 0, width: 0, area },
        { section: 'Eaves', length: len('eave'), width: 0, area: 0 },
        { section: 'Hips', length: len('hip'), width: 0, area: 0 },
        { section: 'Ridges', length: len('ridge'), width: 0, area: 0 },
        { section: 'Rakes', length: len('rake'), width: 0, area: 0 },
      ],
    };
    if (len('valley') > 0) h.measurements.push({ section: 'Valleys', length: len('valley'), width: 0, area: 0 });
    if (st && st.jobName) h.customerName = st.jobName;
    return h;
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { buildCashHandoff }; return; }
  root.buildCashHandoff = buildCashHandoff;

  // ---------------------------------------------------------------- the path switch in panel 5
  async function openCash() {
    if (typeof xmEnsureRoof === 'function') { if (!await xmEnsureRoof()) return; }      // traces the roof first when needed (existing behaviour)
    else if (!state.facets.length) { toast('Measure the roof first.', true); return; }
    localStorage.setItem('currentEstimate', JSON.stringify(buildCashHandoff(computeTotals(), state)));
    window.open('cash/index.html', '_blank', 'noopener');
  }
  function openInsurance() {
    const p = document.getElementById('xmPanel') || [...document.querySelectorAll('details.panel')].find((d) => /Insurance estimate/i.test(d.querySelector('summary').textContent));
    if (!p) return; p.open = true; p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function wire() {
    const a = document.getElementById('btnPathInsurance'), b = document.getElementById('btnPathCash');
    if (a) a.onclick = openInsurance;
    if (b) b.onclick = async () => { b.disabled = true; try { await openCash(); } catch (e) { toast('Could not open the cash estimate: ' + e.message, true); } finally { b.disabled = false; } };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})(typeof window !== 'undefined' ? window : globalThis);
