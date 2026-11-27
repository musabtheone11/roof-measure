import {readFileSync} from 'node:fs';
export const AUTHORIZED_BUDGET = Object.freeze({requestLimit:16,maxUsd:1,hourUsd:1,dayUsd:3,weekUsd:20,monthUsd:80});
export function loadBudget(filename) {
  if (!filename) return {...AUTHORIZED_BUDGET};
  const text=readFileSync(filename,'utf8'); if(Buffer.byteLength(text)>4096)throw new Error('Budget configuration exceeds limit');
  const config=JSON.parse(text);
  if(!config||Array.isArray(config)||Object.keys(config).some(k=>!Object.hasOwn(AUTHORIZED_BUDGET,k)))throw new Error('Unknown budget fields');
  const limits={requestLimit:16,maxUsd:20,hourUsd:20,dayUsd:20,weekUsd:20,monthUsd:80};
  for(const [key,value] of Object.entries(config)) if(!Number.isFinite(value)||value<0||value>limits[key]||(key==='requestLimit'&&!Number.isInteger(value)))throw new Error('Budget exceeds authorized ceiling or is invalid');
  return {...AUTHORIZED_BUDGET,...config};
}
