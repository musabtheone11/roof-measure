import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {OrgStore} from './store.mjs';
const cli=fileURLToPath(new URL('./cli.mjs',import.meta.url));
async function waitFor(fn,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await delay(100);}throw new Error('Process acceptance deadline');}
test('actual CLI discovers new report, stops, restarts and does not duplicate extraction', {timeout:30000},async t=>{
  const root=mkdtempSync(join(tmpdir(),'roof-org-process-')),downloads=join(root,'Downloads'),state=join(root,'state');mkdirSync(downloads);
  const children=[];t.after(()=>{for(const c of children)c.kill('SIGKILL');rmSync(root,{recursive:true,force:true});});
  const observer=new OrgStore(state);t.after(()=>observer.close());
  function start(){const child=spawn(process.execPath,[cli,'start','--downloads',downloads,'--state',state],{stdio:['ignore','pipe','pipe']});children.push(child);let output='';child.stdout.on('data',b=>{output+=b.toString();});child.stderr.on('data',b=>{output+=b.toString();});return {child,output:()=>output};}
  const first=start();await waitFor(()=>first.output().includes('"started": true'));
  const text='Roofr roof area 1,234.50 sqft pitch 6/12';writeFileSync(join(downloads,'roof-report.txt'),text);
  await waitFor(()=>observer.listTasks().some(t=>t.stage==='reference'&&t.status==='needs-human'));
  assert.equal(observer.listTasks().length,2);observer.setControl('stopped');await waitFor(()=>first.child.exitCode!==null);
  const second=start();await waitFor(()=>second.output().includes('"started": true'));await delay(3100);
  assert.equal(observer.listTasks().length,2);assert.equal(observer.ledger().requests,0);assert.equal(readFileSync(join(downloads,'roof-report.txt'),'utf8'),text);
  observer.setControl('stopped');await waitFor(()=>second.child.exitCode!==null);
});
