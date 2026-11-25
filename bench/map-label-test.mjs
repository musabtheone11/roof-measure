import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');const c=vm.createContext({});vm.runInContext(src.match(/^function mapLabelFits\([^]*?^\}/m)[0],c);
const original=[{left:0,right:100,top:0,bottom:20},{left:50,right:150,top:0,bottom:20},{left:105,right:150,top:0,bottom:20}];
const snapshot=JSON.stringify(original),placed=[];for(const b of original)if(c.mapLabelFits(b,placed))placed.push(b);
assert.equal(placed.length,2);assert.equal(JSON.stringify(original),snapshot,'decluttering cannot move label anchors or geometry');assert.equal(c.mapLabelFits({left:0,right:10,top:24,bottom:34},placed),true);
console.log('Map labels: collisions omitted without moving anchors; selected-label ordering is render-only');
