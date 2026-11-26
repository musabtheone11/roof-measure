// Static hosting (GitHub Pages): no /api/ai/* behind the app. Opening the AI image review must say plainly that the
// service is not available here, raise no page error, and never ask for or use a browser-side API key.
import { createRequire } from 'node:module';
import { start } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const srv = await start(8197, {});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
let code = 0;
try {
  const p = await browser.newPage(); const errors = [], aiRequests = [];
  p.on('pageerror', (e) => errors.push(e.message)); p.on('request', (r) => { if (/\/api\/ai\//.test(r.url())) aiRequests.push(r.url()); });
  await p.goto('http://localhost:8197/'); await p.waitForFunction(() => document.getElementById('btnOpenAITrace'));
  await p.evaluate(() => document.getElementById('btnOpenAITrace').click());
  await p.waitForFunction(() => /not available on this site/.test(document.body.innerText), null, { timeout: 15000 });
  const text = await p.evaluate(() => document.body.innerText);
  if (/is not valid JSON|Unexpected token/.test(text)) throw new Error('raw parser error shown to the user');
  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  if (aiRequests.some((u) => !/\/api\/ai\/config$/.test(u))) throw new Error('unexpected AI request: ' + aiRequests.join(', '));
  console.log('static hosting: AI review reports the service as unavailable; local review keeps working; no page errors');
} catch (e) { console.error('FAIL ' + e.message); code = 1; }
finally { await browser.close(); if (srv && srv.close) srv.close(); }
process.exit(code);
