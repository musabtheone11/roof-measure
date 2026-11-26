import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const s=fs.readFileSync(new URL('../roofpdf.js',import.meta.url),'utf8');const code=s.slice(s.indexOf('function rpCompactIds('),s.indexOf('// ------------------------------------------------------------------ sheet 2:',s.indexOf('function rpCompactIds(')));
const c=vm.createContext({});vm.runInContext(code,c);
assert.equal(c.rpCompactIds(['F3','F1','F2','F7','F9']),'F1-F3, F7, F9');
assert.equal(c.rpCompactIds(['01','02','03','05']),'01-03, 05');
const M={zones:[],facets:[],lines:[],src:null,rv:null,status:{reasons:[]}};
for(let i=1;i<=1000;i++){M.lines.push({key:String(i).padStart(2,'0'),e:{modelId:'E'+i}});M.status.reasons.push({code:'quantity-evidence',id:'E'+i,quantity:'length',text:'Missing length for E'+i,needs:'Record the dated source, basis and revision.'});}
const notes=c.rpReviewItems(M);assert.equal(notes.length,1);assert(notes[0].title.includes('E1-E1000'));assert(notes[0].action.includes('01-1000'));assert(notes[0].action.includes('dated source'));
console.log('Evidence notes: 1,000 findings retain complete ID ranges and plan-key lookup in one readable group');
