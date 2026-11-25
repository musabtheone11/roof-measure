// Runtime agent contracts. Geometry is a pixel-space proposal, never a measurement.
export const ROLES = ['quality', 'outline', 'structure', 'independent', 'adjudication'];
export const EDGE_TYPES = ['eave','rake','ridge','hip','valley','step','wall','transition','parapet','unspecified','obstruction'];
export class ContractError extends Error { constructor(message) { super(message); this.name = 'ContractError'; this.code = 'INVALID_AGENT_OUTPUT'; } }
const fail = message => { throw new ContractError(message); };
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v, max=2000) => typeof v === 'string' && v.length > 0 && v.length <= max;
const finite = v => typeof v === 'number' && Number.isFinite(v);
function keys(v, allowed, required=allowed) { if (!object(v) || Object.keys(v).some(k=>!allowed.includes(k)) || required.some(k=>!(k in v))) fail('Unexpected or missing response fields'); }
function point(p, meta) { if (!Array.isArray(p) || p.length!==2 || !p.every(finite) || p[0]<0 || p[1]<0 || p[0]>meta.width || p[1]>meta.height) fail('Point is outside the source image'); return p.slice(); }
function points(v, meta, min) { if (!Array.isArray(v) || v.length<min || v.length>1000) fail('Invalid point list'); return v.map(p=>point(p,meta)); }
function notes(v) { if (!Array.isArray(v) || v.length>100 || !v.every(x=>string(x))) fail('Invalid review notes'); return v; }
function evidence(v) { if (!string(v)) fail('A visible evidence description is required'); return v; }
function status(v) { if (!['inferred','unresolved'].includes(v)) fail('AI proposals must be inferred or unresolved'); return v; }
function ring(v, meta) { const r=points(v,meta,3); if(r.length>3&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1])r.pop(); if(r.length<3||new Set(r.map(p=>p.join(','))).size<3)fail('Polygon has fewer than three distinct vertices'); return r; }
export function imageHeaderDimensions(dataURL) {
  const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataURL||'');
  if(!match)fail('Supply a supported image data URL');
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.length<16||bytes.toString('base64')!==match[2])fail('Invalid image encoding');
  let width,height;
  if(match[1]==='png') {
    if(bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')fail('Invalid PNG header');
    width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);
  } else if(match[1]==='jpeg') {
    if(bytes[0]!==255||bytes[1]!==216)fail('Invalid JPEG header');
    let offset=2;
    while(offset+4<=bytes.length) {
      if(bytes[offset++]!==255)fail('Invalid JPEG marker');
      while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];if(marker===217||marker===218)break;
      if(marker===1||marker>=208&&marker<=215)continue;
      if(offset+2>bytes.length)break;const length=bytes.readUInt16BE(offset);
      if(length<2||offset+length>bytes.length)fail('Truncated JPEG segment');
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {if(length<8)fail('Invalid JPEG frame');height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;}
      offset+=length;
    }
  } else {
    if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.length<30||bytes.readUInt32LE(4)+8>bytes.length)fail('Invalid WebP header');
    const kind=bytes.toString('ascii',12,16);
    if(kind==='VP8X'){width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3);}
    else if(kind==='VP8L'&&bytes[20]===47){const v=bytes.readUInt32LE(21);width=1+(v&16383);height=1+((v>>>14)&16383);}
    else if(kind==='VP8 '&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=bytes.readUInt16LE(26)&16383;height=bytes.readUInt16LE(28)&16383;}
    else fail('Unsupported WebP frame header');
  }
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width*height>40000000)fail('Image dimensions exceed supported limits');
  return {width,height,mime:'image/'+match[1]};
}
export function validateBudget(budget) {
  if(!object(budget))fail('Budget must be an object');
  const limits={maxRequests:[20,true],maxTokens:[20000000,true],maxOutputTokens:[8000,true],maxUsd:[20,false],maxCostUsd:[20,false]};
  if(Object.keys(budget).some(name=>!Object.hasOwn(limits,name)))fail('Unknown budget limit');
  for(const [name,[max,integer]] of Object.entries(limits)) if(Object.hasOwn(budget,name)) {
    const value=budget[name];
    if(!finite(value)||value<0||value>max||(integer&&!Number.isInteger(value)))fail('Invalid explicit budget limit: '+name);
  }
  if(Object.hasOwn(budget,'maxUsd')&&Object.hasOwn(budget,'maxCostUsd')&&budget.maxUsd!==budget.maxCostUsd)fail('Conflicting dollar budget limits');
  return budget;
}
export function validateInput(input) {
  if (!object(input) || !string(input.revision,1000000)) fail('A model revision is required');
  if (input.consentExternal!==true) fail('Explicit authorization for external image processing is required');
  const m=input.imageMetadata;
  if (!object(m)||!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<16||m.height<16||m.width>8192||m.height>8192) fail('Source image dimensions are invalid');
  if(m.purpose!==undefined&&!['photo','roof-sketch','document'].includes(m.purpose))fail('Invalid source purpose');
  if(m.sourcePage!==undefined&&(!Number.isInteger(m.sourcePage)||m.sourcePage<1||m.sourcePage>1000))fail('Invalid source page index');
  if(m.rotation!==undefined&&![0,90,180,270].includes(m.rotation))fail('Rotation describes an already-rendered quarter turn');
  if (m.targetPixel != null) point(m.targetPixel,m);
  if (!['orthographic','oblique','unknown'].includes(m.view)) fail('Identify source perspective');
  if (!string(input.image,16000000))fail('Supply a bounded supported image data URL');
  const actual=imageHeaderDimensions(input.image);if(actual.width!==m.width||actual.height!==m.height)fail('Declared dimensions do not match the image header');
  if (m.crop && (!object(m.crop)||!Array.isArray(m.crop.origin)||!m.crop.origin.every(finite)||!finite(m.crop.scale)||m.crop.scale<=0))fail('Invalid crop transform');
  if(input.budget!==undefined)validateBudget(input.budget);
  if (input.models && (!object(input.models)||Object.keys(input.models).some(k=>!ROLES.includes(k))||!Object.values(input.models).every(x=>string(x,200))))fail('Invalid model selection');
  return input;
}
export function normalizeAgentJSON(content) {
  if (typeof content!=='string'||content.length>250000)fail('Agent response is not bounded JSON text');
  const text=content.trim();
  // Only a complete, single JSON envelope is compatible formatting. Prose,
  // additional blocks and trailing content are not searched or repaired.
  const fenced=/^```json\r?\n([\s\S]*?)\r?\n```$/.exec(text);
  if(fenced) {
    if(fenced[1].includes('```'))fail('Multiple or nested JSON envelopes are not accepted');
    const inner=fenced[1].trim();
    if(!inner.startsWith('{')||!inner.endsWith('}'))fail('The JSON envelope must contain one object');
    return {text:inner,normalization:'single-json-code-fence'};
  }
  return {text,normalization:'none'};
}
export function parseAgentJSON(content) {
  const {text}=normalizeAgentJSON(content);
  try { return JSON.parse(text); } catch { fail('Agent returned malformed JSON'); }
}

export function validateResponse(role, value, meta) {
  if(role==='quality') {
    keys(value,['traceable','target','issues','evidence']);
    if(typeof value.traceable!=='boolean')fail('Invalid traceability decision');
    if(value.target!==null)point(value.target,meta);
    const issues=value.issues;if(!Array.isArray(issues)||issues.length>100)fail('Invalid image quality issues');
    for(const x of issues){keys(x,['kind','region','reason']);if(!['obstruction','shadow','perspective','resolution','wrong-target','unknown'].includes(x.kind))fail('Unknown image issue');ring(x.region,meta);evidence(x.reason);}
    evidence(value.evidence);return structuredClone(value);
  }
  if(role==='outline'||role==='independent') {
    keys(value,['buildings','notes']);notes(value.notes);
    if(!Array.isArray(value.buildings)||value.buildings.length>20)fail('Invalid building proposals');
    const ids=new Set();for(const b of value.buildings){keys(b,['id','target','vertices','status','evidence']);if(!string(b.id,80)||ids.has(b.id)||typeof b.target!=='boolean')fail('Invalid building identifier');ids.add(b.id);b.vertices=ring(b.vertices,meta);status(b.status);evidence(b.evidence);}
    if(value.buildings.filter(b=>b.target).length>1)fail('Multiple target buildings require review');return structuredClone(value);
  }
  if(role==='structure') {
    keys(value,['planes','edges','notes','annotations'],['planes','edges','notes']);notes(value.notes);
    if(!Array.isArray(value.planes)||value.planes.length>300||!Array.isArray(value.edges)||value.edges.length>1000)fail('Invalid roof structure proposals');
    const ids=new Set();for(const p of value.planes){keys(p,['id','vertices','status','evidence']);if(!string(p.id,80)||ids.has(p.id))fail('Duplicate or invalid plane ID');ids.add(p.id);p.vertices=ring(p.vertices,meta);status(p.status);evidence(p.evidence);}
    const edgeIds=new Set();for(const e of value.edges){keys(e,['id','type','points','status','evidence']);if(!string(e.id,80)||edgeIds.has(e.id)||!EDGE_TYPES.includes(e.type))fail('Invalid edge identifier or classification');edgeIds.add(e.id);e.points=points(e.points,meta,2);status(e.status);evidence(e.evidence);}
    if(value.annotations!==undefined) {
      if(!Array.isArray(value.annotations)||value.annotations.length>200)fail('Invalid source annotations');
      const annotationIds=new Set();
      for(const a of value.annotations) {
        keys(a,['id','kind','text','region','status']);
        if(!string(a.id,80)||annotationIds.has(a.id)||!['dimension','pitch','area','label','contradiction'].includes(a.kind)||!string(a.text,2000)||!['source-reported','unresolved'].includes(a.status))fail('Invalid literal source annotation');
        annotationIds.add(a.id);a.region=ring(a.region,meta);
      }
    }
    return structuredClone(value);
  }
  if(role==='adjudication') {
    keys(value,['decisions','notes']);notes(value.notes);if(!Array.isArray(value.decisions)||value.decisions.length>100)fail('Invalid adjudication decisions');
    for(const d of value.decisions){keys(d,['id','resolution','region','reason']);if(!string(d.id,80)||!['unresolved','prefer-first','prefer-independent','needs-crop','needs-field'].includes(d.resolution))fail('Invalid dispute resolution');ring(d.region,meta);evidence(d.reason);}
    return structuredClone(value);
  }
  fail('Unknown runtime role');
}
export const OUTPUT_CONTRACTS = {
 quality:'{"traceable":boolean,"target":[x,y]|null,"issues":[{"kind":"obstruction|shadow|perspective|resolution|wrong-target|unknown","region":[[x,y],...],"reason":string}],"evidence":string}',
 outline:'{"buildings":[{"id":string,"target":boolean,"vertices":[[x,y],...],"status":"inferred|unresolved","evidence":string}],"notes":[string]}',
 independent:'{"buildings":[{"id":string,"target":boolean,"vertices":[[x,y],...],"status":"inferred|unresolved","evidence":string}],"notes":[string]}',
 structure:'{"planes":[{"id":string,"vertices":[[x,y],...],"status":"inferred|unresolved","evidence":string}],"edges":[{"id":string,"type":"eave|rake|ridge|hip|valley|step|wall|transition|parapet|unspecified|obstruction","points":[[x,y],...],"status":"inferred|unresolved","evidence":string}],"annotations":[{"id":string,"kind":"dimension|pitch|area|label|contradiction","text":string,"region":[[x,y],...],"status":"source-reported|unresolved"}],"notes":[string]}',
 adjudication:'{"decisions":[{"id":string,"resolution":"unresolved|prefer-first|prefer-independent|needs-crop|needs-field","region":[[x,y],...],"reason":string}],"notes":[string]}'
};
