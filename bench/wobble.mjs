// Outline wobble: adjacent perimeter lines (eave / rake) that meet at a shallow turn (3-25 deg). A real roof outline turns
// at building corners (~45 / 90 deg) or runs straight; a shallow kink is a traced eave bending where the real one is
// straight. Works on engine output (metres) and on a saved job (lat/lng).
export function wobble(lines, minDeg = 3, maxDeg = 25, tolM = 0.08) {
  const ends = []; lines.forEach((L, i) => { ends.push({ i, p: L[0], q: L[1] }); ends.push({ i, p: L[L.length - 1], q: L[L.length - 2] }); });
  const out = [];
  for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) {
    const A = ends[a], B = ends[b]; if (A.i === B.i || Math.hypot(A.p[0] - B.p[0], A.p[1] - B.p[1]) > tolM) continue;
    const u = [A.p[0] - A.q[0], A.p[1] - A.q[1]], v = [B.q[0] - B.p[0], B.q[1] - B.p[1]];   // direction into the joint, out of it
    const c = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1); const turn = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
    if (turn >= minDeg && turn <= maxDeg) out.push({ at: A.p, turn, lines: [A.i, B.i] });
  }
  return out;
}
