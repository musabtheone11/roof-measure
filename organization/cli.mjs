#!/usr/bin/env node
import {resolve, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync, writeFileSync, watch} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {execFileSync} from 'node:child_process';
import {OrgStore} from './store.mjs';
import {DownloadsDiscovery} from './discovery.mjs';
import {createWorkflow, CAPABILITIES} from './workflow.mjs';
import {workOnce} from './worker.mjs';
import {verifyRoster} from './provider.mjs';
import {customerProjection, renderCustomerPDF} from './customer-report.mjs';
import {AUTHORIZED_BUDGET,loadBudget} from './config.mjs';
import {writeHealth,readHealth} from './health.mjs';

const ACTORS = Object.freeze({extraction: 'extraction-local', reference: 'reference-curator', engineering: 'engineering-author',
  critique: 'critique-independent', verification: 'verification-isolated', ceo: 'ceo-advisory', operations: 'operations-trusted', reporting: 'reporting-publisher'});
function sourceRevision() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8'}).trim(); }
  catch { return 'unversioned-no-release'; }
}
export async function inventory(store, discovery) {
  const items = await discovery.scan(store), revision = sourceRevision(); let enqueued = 0;
  for (const item of items) {
    const id = `source-literal-v1-${item.hash}`;
    if (store.getTask(`${id}:extraction`)) continue;
    store.enqueue(createWorkflow({id, sourceHash: item.hash, sourceRevision: revision, extension: item.extension, actors: ACTORS})); enqueued++;
  }
  const summary = {...discovery.inventory, enqueued};
  if (enqueued || summary.inaccessible || summary.truncated) store.event(null, 'inventory', summary);
  return summary;
}
export function status(store) {
  const tasks = store.listTasks(), counts = {};
  for (const task of tasks) counts[task.status] = (counts[task.status] || 0) + 1;
  return {control: store.getControl(), counts, tasks: tasks.map(t => ({id: t.id, team: t.role, stage: t.stage, actor: t.actorId, status: t.status, error: t.error})),
    spending: store.ledger(), configuredBudget: AUTHORIZED_BUDGET, capabilities: CAPABILITIES,
    ceoHistory: tasks.filter(t => t.role === 'ceo').map(t => ({id: t.id, status: t.status, result: t.result})),
    lastInventory: store.events().filter(e => e.kind === 'inventory').at(-1) || null,
    lastSuccessfulProcessing: tasks.filter(t => t.status === 'complete' && t.stage === 'extraction').at(-1)?.updatedAt || null,
    lastSuccessfulEvaluation: tasks.filter(t => t.status === 'complete' && t.stage === 'verification').at(-1)?.updatedAt || null,
    accuracyTrends: null, actualUserDownloadsProcessed: 'not established by this status; inspect source inventory',
    worker:readHealth(store.directory),persistentOSService: 'not installed or verified by this CLI'};
}
export async function main(args = process.argv.slice(2)) {
  const command = args[0] || 'status';
  const arg = key => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
  const directory = resolve(arg('--state') || process.env.ROOF_ORG_STATE || '.devcache/organization');
  const budget=loadBudget(arg('--budget-file') || process.env.ROOF_ORG_BUDGET_FILE);
  const store = new OrgStore(directory);
  const print = value => console.log(JSON.stringify(value, null, 2));
  try {
    if (command === 'status' || command === 'health') { const current=status(store);print(command==='health'?current.worker:current);if(command==='health'&&!current.worker.processHealthy)process.exitCode=1;return; }
    if (['pause', 'resume', 'stop'].includes(command)) { store.setControl({pause: 'paused', resume: 'running', stop: 'stopped'}[command]); print({control: store.getControl()}); return; }
    if (command === 'cancel') { store.cancel(args[1]); print({cancelled: args[1]}); return; }
    if (command === 'retry') {
      if (!arg('--reason')) throw new Error('Retry requires --reason and does not reset attempts or billing');
      store.retryFailed(args[1], {operatorId: process.env.USER || process.env.USERNAME || 'local-operator', evidence: arg('--reason')});
      print({retryRequested: args[1]}); return;
    }
    if (command === 'roster') { print(await verifyRoster()); return; }
    if (command === 'customer-report') {
      const report = customerProjection(JSON.parse(readFileSync(args[1], 'utf8')));
      const output = arg('--output'); if (!output) throw new Error('Explicit --output PDF path required');
      writeFileSync(output, renderCustomerPDF(report), {mode: 0o600}); print({output}); return;
    }
    if (command === 'rollback') throw new Error('Rollback blocked: register an authenticated deployment adapter with recorded known-good digest and reconciliation; no deployment is claimed');
    if (command === 'once') { print(await workOnce(store, {budget})); return; }
    if (!['discover', 'start', 'run'].includes(command)) throw new Error('Commands: status health discover start run once pause resume stop cancel retry roster customer-report rollback');
    const root = arg('--downloads') || process.env.ROOF_DOWNLOADS;
    if (!root || !isAbsolute(root)) throw new Error('Configure the actual local absolute Downloads path with --downloads or ROOF_DOWNLOADS; this cloud cannot read your computer');
    const discovery = new DownloadsDiscovery(root, {roofOnlyFolder: args.includes('--roof-only-folder')});
    if (command === 'discover') {
      await inventory(store, discovery); await delay(2100); print(await inventory(store, discovery)); return;
    }
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    let watcher, dirty = true, lastScan = 0;
    try {
      try { watcher = watch(root, {recursive: true}, () => { dirty = true; }); watcher.on('error', () => { dirty = true; }); } catch { /* reconciliation remains authoritative */ }
      store.setControl('running');
      print({started: true, root, state: directory, paidInferenceEnabled: false, reason: 'Source authorization and production role adapters are not installed', budget});
      while (!controller.signal.aborted && store.getControl() !== 'stopped') {
        writeHealth(directory,{control:store.getControl()});
        if (store.getControl() === 'running') {
          if (dirty || Date.now() - lastScan >= 60000) {
            const summary = await inventory(store, discovery); lastScan = Date.now(); dirty = summary.unstable > 0;
            if (summary.enqueued || summary.inaccessible || summary.truncated) print({inventory: summary});
          }
          const done = await workOnce(store, {budget, signal: controller.signal});
          if (done) print(done);
        }
        try { await delay(1000, null, {signal: controller.signal}); } catch { break; }
      }
    } finally { controller.abort(); watcher?.close();writeHealth(directory,{control:'stopped'}); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
  } finally { store.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
