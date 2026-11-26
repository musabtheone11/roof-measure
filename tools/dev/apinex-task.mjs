// Bounded API NEX specialist task runner (development use). One task = one authenticated chat request to an assigned model.
//   node tools/dev/apinex-task.mjs --task <task.json> --out <dir>
// task.json: { id, model, role, revisionDir?, system, question, files: [{ path, from?, to? }], images?: [png paths], maxTokens?, timeoutMs?, json? }
// Rules: the model must be on the authenticated roster (no substitution); one retry only for 429/5xx/timeout with backoff;
// 4xx other than 429 is permanent and never retried; responses are bounded; the credential is read at request time from
// APINEX_API_KEY (or supplied by the session's egress proxy) and is never printed or written. The record keeps the request
// ID, returned model, usage and the provider-reported cost when present; otherwise billing is recorded as unknown.
// Inputs are source code and synthetic fixtures only: never customer documents, addresses or Google imagery.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const BASE = 'https://api.apinex.bond/v1';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const task = JSON.parse(fs.readFileSync(arg('task'), 'utf8')), out = arg('out', '.devcache/apinex');
fs.mkdirSync(out, { recursive: true });
const auth = () => 'Bearer ' + (process.env.APINEX_API_KEY || 'proxy-injected');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(url, body, timeoutMs) {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: auth(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  let text = '';
  if (body && body.stream && r.status === 200) {
    // server-sent events: keeps the connection alive past gateway idle limits; rebuild one chat.completion object
    const dec = new TextDecoder(); let buf = '', content = '', last = null, usage = null, finish = null;
    for await (const chunk of r.body) { buf += dec.decode(chunk, { stream: true }); if (buf.length + content.length > 4 * 1024 * 1024) throw Object.assign(new Error('response exceeds 4 MiB'), { permanent: true });
      let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line.startsWith('data:')) continue; const d = line.slice(5).trim(); if (d === '[DONE]') continue;
        let j; try { j = JSON.parse(d); } catch { continue; } last = j; if (j.usage) usage = j.usage; const c = j.choices && j.choices[0]; if (c && c.delta && c.delta.content) content += c.delta.content; if (c && c.finish_reason) finish = c.finish_reason; } }
    text = JSON.stringify({ id: last && last.id, model: last && last.model, usage, choices: [{ message: { content }, finish_reason: finish }], streamed: true });
  } else { text = await r.text(); if (text.length > 4 * 1024 * 1024) throw Object.assign(new Error('response exceeds 4 MiB'), { permanent: true }); }
  return { status: r.status, headers: Object.fromEntries(r.headers), text };
}
const rec = { id: task.id, role: task.role, assignedModel: task.model, sourceRevision: execFileSync('git', ['-C', task.revisionDir || '.', 'rev-parse', 'HEAD']).toString().trim(), startedAt: new Date().toISOString(), inputs: [], attempts: [] };
const roster = await call(BASE + '/models', null, 20000);
if (roster.status !== 200) { rec.outcome = 'roster unavailable: HTTP ' + roster.status; finish(2); }
if (!JSON.parse(roster.text).data.some((m) => m.id === task.model)) { rec.outcome = 'assigned model absent from the authenticated roster; not substituted'; finish(2); }
const bal0 = JSON.parse((await call(BASE + '/balance', null, 20000)).text); rec.balanceBeforeUsd = bal0.balance_usd;
let text = task.question + '\n\n';
for (const f of task.files || []) {
  const lines = fs.readFileSync(f.path, 'utf8').split('\n'); const a = (f.from || 1) - 1, b = f.to || lines.length;
  const body = lines.slice(a, b).map((l, i) => `${a + i + 1}: ${l}`).join('\n');
  rec.inputs.push({ path: f.path, lines: [a + 1, b], sha256: crypto.createHash('sha256').update(body).digest('hex') });
  text += `===== ${f.path} (lines ${a + 1}-${b}) =====\n${body}\n\n`;
}
const content = [{ type: 'text', text }];
for (const p of task.images || []) { content.push({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + fs.readFileSync(p).toString('base64') } }); rec.inputs.push({ path: p, image: true, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') }); }
const body = { model: task.model, max_tokens: task.maxTokens || 6000, stream: task.stream !== false, ...(task.stream !== false ? { stream_options: { include_usage: true } } : {}), messages: [{ role: 'system', content: task.system }, { role: 'user', content: task.images ? content : text }], ...(task.json ? { response_format: { type: 'json_object' } } : {}) };
let res = null;
for (let attempt = 0; attempt <= 1; attempt++) {
  const t0 = Date.now();
  try {
    res = await call(BASE + '/chat/completions', body, task.timeoutMs || 300000);
    rec.attempts.push({ attempt: attempt + 1, httpStatus: res.status, ms: Date.now() - t0, requestId: res.headers['x-request-id'] || res.headers['request-id'] || null });
    if (res.status === 200) break;
    if (res.status !== 429 && res.status < 500) { rec.outcome = 'permanent HTTP ' + res.status + ' (not retried)'; break; }
  } catch (e) { rec.attempts.push({ attempt: attempt + 1, error: e.name === 'TimeoutError' ? 'timeout' : e.message, ms: Date.now() - t0 }); if (e.permanent) break; }
  if (attempt === 0) await sleep(res && res.headers['retry-after'] ? Math.min(60000, +res.headers['retry-after'] * 1000) : 5000);
}
if (res && res.status === 200) {
  const j = JSON.parse(res.text); const msg = j.choices && j.choices[0] && j.choices[0].message;
  rec.returnedModel = j.model || null; rec.responseId = j.id || null; rec.usage = j.usage || null; rec.finishReason = j.choices && j.choices[0] && j.choices[0].finish_reason;
  rec.reportedCostTokens = (j.usage && j.usage.cost_tokens) ?? j.cost_tokens ?? null;
  rec.modelMatches = rec.returnedModel === task.model;
  fs.writeFileSync(path.join(out, task.id + '.response.md'), (msg && msg.content) || '');
  rec.outcome = rec.outcome || 'response received (a proposal, not evidence; validate locally)';
}
const bal1 = JSON.parse((await call(BASE + '/balance', null, 20000)).text); rec.balanceAfterUsd = bal1.balance_usd;
rec.balanceDeltaUsd = +(rec.balanceBeforeUsd - rec.balanceAfterUsd).toFixed(6);
rec.billing = rec.reportedCostTokens != null ? 'provider-reported cost_tokens' : 'balance delta only (shared account: concurrent use would mix in; otherwise unknown)';
finish(res && res.status === 200 ? 0 : 1);
function finish(code) { rec.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(out, task.id + '.record.json'), JSON.stringify(rec, null, 1)); console.log(JSON.stringify({ id: rec.id, model: rec.assignedModel, returned: rec.returnedModel, outcome: rec.outcome, usage: rec.usage, delta: rec.balanceDeltaUsd, attempts: rec.attempts })); process.exit(code); }
