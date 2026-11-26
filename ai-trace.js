'use strict';
// Uploaded images are isolated from the saved map job. External processing requires explicit consent.
(function () {
  const root = document.createElement('section'); root.className = 'ai-review'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'AI roof image review');
  root.innerHTML = `<div class="ai-head"><strong>Roof image review</strong><span id="aiStatus">Choose an image</span><button id="aiClose">Close</button></div><div class="ai-workspace"><div class="ai-controls">
    <label>Authorized roof image <input id="aiFile" class="ai-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <label>Local PDF document<input id="aiPDFFile" type="file" accept="application/pdf,.pdf"></label><label>PDF page<select id="aiPDFPage" disabled></select></label><p class="ai-help">PDFs render locally. Only the selected page image can be sent after separate consent. Check missing fonts or symbols against your original document; no dimensions are automatically trusted.</p><label>Reopen saved review JSON<input id="aiImport" type="file" accept="application/json,.json"></label><p class="ai-help">Upload the same image first. Reopened geometry is checked against its image fingerprint. Re-enter and verify calibration for this session.</p><label>Source / imagery provider <input id="aiSource" placeholder="Source and permission basis"></label><label>Capture date, if known <input id="aiDate" type="date"></label>
    <label>Image purpose<select id="aiPurpose"><option value="photo">Roof photograph</option><option value="roof-sketch">Roof sketch</option><option value="document">Document page</option></select></label><label>Source page number<input id="aiSourcePage" type="number" min="1" step="1" value="1"></label><div class="ai-actions"><button id="aiRotateLeft">Rotate left</button><button id="aiRotateRight">Rotate right</button></div><p class="ai-help">Upload document pages as images, one page per review. Rotation clears active geometry and calibration. Printed dimensions remain source statements until independently verified.</p><label>Image view <select id="aiView"><option value="unknown">Unknown / not calibrated</option><option value="orthographic">Overhead orthographic image</option><option value="oblique">Oblique / perspective photograph</option></select></label>
    <details><summary>Known horizontal scale</summary><p class="ai-help">Use an independently measured horizontal segment in an overhead image. An address or screenshot scale guess is not calibration.</p><div class="ai-grid"><label>Start x (px)<input id="aiX1" type="number" min="0"></label><label>Start y (px)<input id="aiY1" type="number" min="0"></label><label>End x (px)<input id="aiX2" type="number" min="0"></label><label>End y (px)<input id="aiY2" type="number" min="0"></label></div><label>Horizontal segment length (ft)<input id="aiLength" type="number" min="0" step="any"></label><label>Calibration source<input id="aiCalibrationSource" placeholder="Field record or calibrated source"></label><label class="ai-inline"><input id="aiCalibrationVerified" type="checkbox"> I verified this horizontal length and its pixel endpoints.</label></details>
    <details><summary>Processing limits</summary><label>Maximum AI requests<input id="aiRequests" type="number" min="1" max="20" value="8"></label><label>Maximum total tokens<input id="aiTokens" type="number" min="500" max="6000000" value="6000000"></label><label>Maximum cost (USD; optional)<input id="aiCost" type="number" min="0.01" step="0.01" placeholder="Requires verified server pricing"></label></details>
    <label class="ai-inline"><input id="aiConsent" type="checkbox"> I authorize sending this image to APINEX for this trace.</label><p class="ai-help">Saved jobs, email attachments and other customer imagery are never sent automatically.</p>
    <div class="ai-actions"><button id="aiRun" class="primary">Analyze image</button><button id="aiCancel" disabled>Cancel</button><button id="aiExport" disabled>Save review JSON</button><button id="aiPDF">Save review PDF</button><button id="aiZIP" title="Download the reviewed page image, review JSON and PDF together">Save review ZIP</button></div><div id="aiMessage" class="ai-notice">AI proposes geometry. Measurements and validity are calculated separately. Results require review.</div><div id="aiRecovery" hidden><p>An earlier analysis is pending in this tab. Select the same source to recover it, or cancel the saved request before starting another analysis.</p><div class="ai-actions"><button id="aiResume">Recover analysis</button><button id="aiStopSaved">Cancel saved request</button></div></div><div id="aiProgress" class="ai-progress" role="log" aria-live="polite"></div>
    <button id="aiPickTarget">Choose target building on image</button><p class="ai-help">Set a point inside the intended roof before analysis when other buildings appear in the image.</p><hr><label>Selected shape<select id="aiShape"><option value="outline">Roof outline</option></select></label><label>Editing tool<select id="aiTool"><option value="move">Move vertices</option><option value="add">Add vertex on a segment</option><option value="delete">Delete vertex</option></select></label><p class="ai-help">Click a vertex to move or delete it. To add a vertex, click a segment. Changes cancel pending AI work and invalidate older measurements.</p>
    <div class="ai-actions"><button id="aiTraceOutline">Trace / replace roof outline</button><button id="aiTraceFacet">Trace new facet</button><button id="aiTraceEdge">Trace new edge</button><button id="aiTraceDone" disabled>Finish trace</button><button id="aiTraceCancel" disabled>Cancel trace</button><button id="aiRemoveShape" disabled>Remove selected shape</button><button id="aiUndo" disabled>Undo last geometry edit</button><button id="aiRedo" disabled>Redo geometry edit</button></div><p class="ai-help">Trace the outline first. Add visible facets or edges, then confirm each boundary against the source. Removing a facet or edge preserves the original AI proposal in the audit record. The outline cannot be removed.</p><label>Selected edge classification<select id="aiEdgeType"><option value="unspecified">Unspecified / unresolved</option><option value="eave">Eave</option><option value="rake">Rake</option><option value="ridge">Ridge</option><option value="hip">Hip</option><option value="valley">Valley</option><option value="parapet">Parapet</option><option value="transition">Roof transition</option><option value="step">Step flashing</option><option value="wall">Wall flashing</option><option value="obstruction">Obstruction / unknown boundary</option></select></label>
    <label>Boundary review evidence note<textarea id="aiBoundaryNote" rows="2" maxlength="2000" placeholder="What visible evidence supports this facet or edge boundary?"></textarea></label><button id="aiConfirmBoundary" disabled>Confirm visible boundary</button><p class="ai-help">Confirmation records your review of this shape, with its image fingerprint and date. It does not verify perspective, scale or pitch. Changing its boundary requires confirmation again.</p><label>Selected facet pitch (rise / 12; leave unknown blank)<input id="aiPitch" type="number" min="0" max="60" step="any"></label><label>Pitch evidence source<input id="aiPitchSource" placeholder="Field measurement or supported plane source"></label><label>Pitch uncertainty (rise / 12)<input id="aiPitchUncertainty" type="number" min="0" step="any" placeholder="Required for known pitch"></label><button id="aiSavePitch">Apply pitch</button>
    <div id="aiResults" class="ai-results" aria-live="polite"></div></div><div class="ai-canvas-wrap"><canvas id="aiCanvas" width="900" height="650" aria-label="Editable roof boundary and planes"></canvas></div></div>`;
  document.body.appendChild(root);
  const $ = id => root.querySelector('#' + id), canvas = $('aiCanvas'), ctx = canvas.getContext('2d');
  const S = { sourceRestrictions:{perspective:false,reasons:[]}, traceDraft:null, traceKind:'outline', undo:[], redo:[], committedModel:null, sourceReady:false, revision: 0, image: null, imageData: null, metadata: null, model: null, original: null, result: null, edits: [], jobId: null, requestId:null, poll: null, drag: null, controller: null, measureTimer: null, latestMeasurement: null, targetMode: false, history: [], importedSourceMetadata: null };
  let csrfToken = null, configPromise=null, cancellationPromise=null, intentEpoch=0;
  let fileLoadId = 0;
  // Store no image, customer name, calibration, model output or credentials in this receipt.
  const receiptKey = 'roof-measure.pending-analysis.v1';
  function readReceipt() {
    try {
      const value = JSON.parse(sessionStorage.getItem(receiptKey));
      return value && /^[a-f0-9-]{36}$/i.test(value.nonce) && /^[a-f0-9]{64}$/.test(value.hash) ? value : null;
    } catch { return null; }
  }
  function recoveryControls() {
    const receipt = readReceipt();
    $('aiRecovery').hidden = !receipt || S.requestId === receipt.nonce;
  }
  function forgetReceipt(nonce) {
    if (nonce && readReceipt()?.nonce === nonce) sessionStorage.removeItem(receiptKey);
    recoveryControls();
  }
  function recordReceipt(nonce) {
    const m = metadata();
    const receipt = {nonce, hash:m.imageFingerprint.sha256, page:m.sourcePage, rotation:m.rotation,
      pdf:!!m.originalPDF, purpose:m.purpose, view:m.view, target:m.targetPixel || null,
      perspective:m.sourceRestrictions?.perspective === true};
    sessionStorage.setItem(receiptKey, JSON.stringify(receipt));
  }
  recoveryControls();

  let localPDF = null, localPDFFile = null;
  const knownSourceRestrictions=new Map();
  async function imageFingerprint(data) { const bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0)); return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join(''); }
  function validateImportedModel(model) {
    if(!model||!Array.isArray(model.outline)||!Array.isArray(model.facets)||!Array.isArray(model.edges)||model.facets.length>1000||model.edges.length>5000)throw Error('Invalid review geometry.');
    let count=0;const points=(ring,min)=>{if(!Array.isArray(ring)||ring.length<min||ring.length>10000)throw Error('Invalid review vertices.');for(const p of ring){if(++count>50000||!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<0||p[1]<0||p[0]>canvas.width||p[1]>canvas.height)throw Error('Review vertices must lie within this image.');}};
    const ids=new Set();const id=x=>{if(typeof x!=='string'||!x||x.length>200||ids.has(x))throw Error('Invalid or duplicate shape identifier.');ids.add(x);};
    points(model.outline,model.outline.length===0?0:3);for(const f of model.facets){id(f.id);points(f.polygon,3);if(f.pitch!=null){const p=f.pitch;if(typeof p!=='object'||!Number.isFinite(p.rise)||p.rise<0||!Number.isFinite(p.run)||p.run<=0||!Number.isFinite(p.uncertainty)||p.uncertainty<0||typeof p.source!=='string'||!p.source.trim()||!['user-provided','measured'].includes(p.status))throw Error('Imported pitch requires its evidence source and uncertainty.');}}
    const types=new Set([...$('aiEdgeType').options].map(o=>o.value));for(const e of model.edges){id(e.id);points(e.points,2);if(!types.has(e.type))throw Error('Unknown imported edge classification.');}if(model.annotations!=null){if(!Array.isArray(model.annotations)||model.annotations.length>2000)throw Error('Invalid source annotations.');for(const a of model.annotations){if(typeof a.id!=='string'||!['dimension','pitch','area','label','contradiction'].includes(a.kind)||typeof a.text!=='string'||a.text.length>2000||!['source-reported','unresolved'].includes(a.status))throw Error('Invalid source annotation.');points(a.region,3);}}return leanModel(model);
  }
  function config() {if(configPromise)return configPromise;configPromise=(async()=>{ const response = await fetch('/api/ai/config', { credentials: 'same-origin' }); const data = await response.json(); if (!response.ok || !data.csrfToken) throw new Error('The server-backed AI service is unavailable.'); csrfToken = data.csrfToken; return data; })().catch(e=>{configPromise=null;throw e;});return configPromise;}
  const clone = x => JSON.parse(JSON.stringify(x));
  const setMessage = text => { $('aiMessage').textContent = text; };
  const status = text => { $('aiStatus').textContent = text; };
  async function request(url, options = {}) { if (!csrfToken) await config(); const method = options.method || 'GET'; if (!['GET','HEAD'].includes(method)) options.headers = { ...(options.headers || {}), 'X-Roof-CSRF': csrfToken }; const response = await fetch(url, { credentials: 'same-origin', ...options }); let data; try { data = await response.json(); } catch { throw new Error('The AI service is unavailable here. Open the server-backed preview.'); } if (!response.ok) throw new Error(data.error?.message || data.error || 'Request failed (' + response.status + ')'); return data; }
  function point(p) { return Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.x), Number(p.y)]; }
  function ring(value) { if (!Array.isArray(value)) return []; if (Array.isArray(value[0]?.[0])) value = value[0]; return value.map(point); }
  function leanModel(value){if(!value)return null;const model=clone(value);delete model.originalAI;delete model.originalProposal;return model;}
  function originalOnce(value){const original=clone(value),nested=original.model?.originalAI||original.model?.originalProposal;if(original.model)original.model=leanModel(original.model);if(!original.originalAI&&nested)original.originalAI=nested;const proposal=value.model?.originalProposal;if(proposal&&JSON.stringify(proposal)!==JSON.stringify(nested)&&JSON.stringify(proposal)!==JSON.stringify(original.model))original.legacyOriginalProposal=clone(proposal);return original;}
  function geometryChanges(before,after){const changes=[];before=before||{};after=after||{};if(JSON.stringify(before.outline||[])!==JSON.stringify(after.outline||[]))changes.push({kind:'outline',before:before.outline||[],after:after.outline||[]});for(const[kind,key]of [['facet','facets'],['edge','edges']]){const a=new Map((before[key]||[]).map(x=>[String(x.id),x])),b=new Map((after[key]||[]).map(x=>[String(x.id),x]));for(const id of new Set([...a.keys(),...b.keys()]))if(JSON.stringify(a.get(id))!==JSON.stringify(b.get(id)))changes.push({kind,id,before:a.get(id)||null,after:b.get(id)||null});}const other=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['outline','facets','edges','originalAI','originalProposal'].includes(k)));if(JSON.stringify(other(before))!==JSON.stringify(other(after)))changes.push({kind:'modelMetadata',before:other(before),after:other(after)});return clone(changes);}
  function compactLegacyEdits(entries,baseline){let previous=leanModel(baseline);return entries.map(entry=>{if(!entry.model)return clone(entry);const model=leanModel(entry.model),out={revision:entry.revision,at:entry.at,action:entry.action,changes:geometryChanges(previous,model)};previous=model;return out;});}
  function mergeRestrictions(...values){const reasons=new Set();let perspective=false;for(const v of values){if(v?.perspective===true)perspective=true;for(const reason of Array.isArray(v?.reasons)?v.reasons:[])if(typeof reason==='string'&&reason.trim())reasons.add(reason.slice(0,2000));}if(perspective&&!reasons.size)reasons.add('Perspective source requires a new independently orthorectified image.');return{perspective,reasons:[...reasons].slice(0,100)};}
  function qualityRestrictions(quality){const findings=(Array.isArray(quality?.issues)?quality.issues:[]).filter(x=>x?.kind==='perspective');return{perspective:quality?.perspective===true||findings.length>0,reasons:findings.map(x=>x.reason||x.message||'Perspective source finding').filter(x=>typeof x==='string')};}
  function sourceEvidence(review,hash,depth=0){if(!review||typeof review!=='object'||depth>4)return null;const boundHash=review.imageMetadata?.imageFingerprint?.sha256;if(boundHash&&hash&&boundHash!==hash)return null;return mergeRestrictions(review.measurementRestrictions,review.model?.measurementRestrictions,review.sourceRestrictions,review.imageMetadata?.sourceRestrictions,qualityRestrictions(review.quality),sourceEvidence(review.originalAI,hash,depth+1));}
  function historyRestrictions(entries,hash){let restrictions=mergeRestrictions();for(const entry of (Array.isArray(entries)?entries:[]).slice(0,1000)){const boundHash=entry?.imageMetadata?.imageFingerprint?.sha256;if(boundHash&&boundHash!==hash)continue;const evidence=sourceEvidence(entry,hash);if(evidence?.perspective)restrictions=mergeRestrictions(restrictions,evidence,!boundHash?{perspective:true,reasons:['Historical perspective warning has unresolved source identity; verify a new orthorectified source.']}:null);}return restrictions;}
  function rememberSourceRestriction(){const hash=S.metadata?.imageFingerprint?.sha256;if(hash){knownSourceRestrictions.set(hash,clone(S.sourceRestrictions));if(knownSourceRestrictions.size>100)knownSourceRestrictions.delete(knownSourceRestrictions.keys().next().value);}}
  function restrictModel(model,...sources){S.sourceRestrictions=mergeRestrictions(S.sourceRestrictions,model?.measurementRestrictions,...sources);rememberSourceRestriction();if(model&&S.sourceRestrictions.perspective)model.measurementRestrictions={...(model.measurementRestrictions||{}),...clone(S.sourceRestrictions)};return model;}
  function normalize(result) { const raw = result.model || result.canonicalModel || result.canonical || {}; const outline = ring(raw.outline || raw.boundary || result.outline?.outline || result.outline?.boundary || result.outline?.polygon || result.outline?.points || []); return restrictModel({ ...leanModel(raw), outline, facets: (raw.facets || result.structure?.facets || result.structure?.planes || []).map((f,i)=>({...f,id:f.id||'F'+(i+1),polygon:ring(f.polygon||f.points||f.vertices),status:f.status||'inferred'})), edges: (raw.edges || result.structure?.edges || []).map((e,i)=>({...e,id:e.id||'E'+(i+1),points:ring(e.points||e.path||e.vertices),type:e.type||'unspecified',status:e.status||'inferred'})) },sourceEvidence(result,S.metadata?.imageFingerprint?.sha256)); }
  function metadata() { const m = { ...S.metadata, sourceRestrictions:clone(S.sourceRestrictions), source: $('aiSource').value.trim(), date: $('aiDate').value || null, view: $('aiView').value, purpose:$('aiPurpose').value, sourcePage:S.metadata?.originalPDF ? S.metadata.sourcePage : Math.max(1,Math.min(1000,Math.floor(Number($('aiSourcePage').value)||1))), rotation:S.metadata?.rotation||0 }; const fields = ['aiX1','aiY1','aiX2','aiY2','aiLength']; if (fields.every(id=>$(id).value!=='')) { const values=fields.map(id=>Number($(id).value)); m.calibration={start:values.slice(0,2),end:values.slice(2,4),lengthFt:values[4],source:$('aiCalibrationSource').value.trim(),date:m.date,verified:$('aiCalibrationVerified').checked}; } return m; }
  function selectedShape() {
    const value = $('aiShape').value, separator = value.indexOf(':');
    return separator < 0 ? [value, ''] : [value.slice(0, separator), value.slice(separator + 1)];
  }
  function selected() { const [kind,id] = selectedShape(); if (kind==='facet') return S.model?.facets.find(f=>String(f.id)===id)?.polygon; if(kind==='edge')return S.model?.edges.find(e=>String(e.id)===id)?.points; return S.model?.outline; }
  function selections() { const prior=$('aiShape').value; $('aiShape').replaceChildren(); const option=(v,t)=>{const e=document.createElement('option');e.value=v;e.textContent=t;$('aiShape').appendChild(e);};option('outline','Roof outline');for(const f of S.model?.facets||[])option('facet:'+f.id,'Facet '+f.id);for(const e of S.model?.edges||[])option('edge:'+e.id,'Edge '+e.id);if([...$('aiShape').options].some(o=>o.value===prior))$('aiShape').value=prior;syncFields(); }
  function syncFields(){const [kind,id]=selectedShape();const f=S.model?.facets.find(f=>String(f.id)===id);const e=S.model?.edges.find(e=>String(e.id)===id);$('aiEdgeType').disabled=kind!=='edge';$('aiPitch').disabled=kind!=='facet';$('aiSavePitch').disabled=kind!=='facet';$('aiConfirmBoundary').disabled=!S.sourceReady||!['facet','edge'].includes(kind);$('aiBoundaryNote').value=(kind==='facet'?f:kind==='edge'?e:null)?.geometryReview?.note||'';$('aiRemoveShape').disabled=!S.sourceReady||!['facet','edge'].includes(kind);$('aiUndo').disabled=!S.undo.length;$('aiRedo').disabled=!S.redo.length;if(kind==='edge'&&e)$('aiEdgeType').value=e.type||'unspecified';$('aiPitch').value=kind==='facet'&&f?.pitch!=null?(typeof f.pitch==='object'?Number(f.pitch.rise)/Number(f.pitch.run)*12:f.pitch):'';$('aiPitchSource').value=f?.pitch?.source||'';$('aiPitchUncertainty').value=f?.pitch?.uncertainty??'';draw();}
  function poly(points,color,closed=true,dash=[]){if(!points?.length)return;ctx.beginPath();ctx.moveTo(...points[0]);for(const p of points.slice(1))ctx.lineTo(...p);if(closed)ctx.closePath();ctx.strokeStyle=color;ctx.lineWidth=Math.max(1.5,canvas.width/500);ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);}
  function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);if(S.image)ctx.drawImage(S.image,0,0,canvas.width,canvas.height);if(S.metadata?.targetPixel){const[x,y]=S.metadata.targetPixel;ctx.strokeStyle='#ff5555';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x-9,y);ctx.lineTo(x+9,y);ctx.moveTo(x,y-9);ctx.lineTo(x,y+9);ctx.stroke();}if(S.traceDraft)poly(S.traceDraft,'#ffb54a',false,[5,3]);if(!S.model){ctx.fillStyle='#c8d0d9';ctx.font='18px sans-serif';ctx.fillText(S.traceDraft?'Click the boundary corners':S.image?'Trace the outline or analyze the image':'Choose an authorized roof image',25,45);return;}for(const f of S.model.facets)poly(f.polygon,'#8bd8f0',true,f.status==='unresolved'?[5,5]:[]);for(const e of S.model.edges)poly(e.points,e.status==='unresolved'?'#ffb35a':'#b5e89b',false);poly(S.model.outline,'#fff');const independent=ring(S.result?.independent?.outline||S.result?.independent?.boundary||S.result?.independent?.polygon||S.result?.independent?.buildings?.find(b=>b.target)?.vertices||[]);for(const issue of [...(S.result?.quality?.issues||[]),...(S.result?.adjudication?.decisions||[])])poly(ring(issue.region),'#ff7979',true,[4,4]);for(const a of S.model?.annotations||S.result?.structure?.annotations||[])poly(ring(a.region),'#bf9fff',true,[3,3]);poly(independent,'#e5a7fa',true,[8,5]);const points=selected()||[];poly(points,'#ffb54a',selectedShape()[0]!=='edge');for(const [x,y]of points){ctx.beginPath();ctx.arc(x,y,Math.max(4,canvas.width/180),0,Math.PI*2);ctx.fillStyle='#ffb54a';ctx.fill();}}
  async function cancel(silent=false){
    if(!silent)intentEpoch++;
    if(!cancellationPromise){
      if(S.controller)S.controller.abort();if(S.poll)clearTimeout(S.poll);
      const id=S.jobId,nonce=S.requestId;$('aiRun').disabled=true;
      cancellationPromise=Promise.resolve().then(async()=>{let confirmed=true;try{if(nonce)await request('/api/ai/requests/'+encodeURIComponent(nonce),{method:'DELETE'});else if(id)await request('/api/ai/jobs/'+encodeURIComponent(id),{method:'DELETE'});if(S.requestId===nonce)S.requestId=null;if(S.jobId===id)S.jobId=null;forgetReceipt(nonce);}catch(e){confirmed=false;status('Cancellation unconfirmed');setMessage('Cancellation could not be confirmed: '+e.message+'. The server may still be processing this request.');}finally{cancellationPromise=null;$('aiCancel').disabled=confirmed;$('aiRun').disabled=!S.sourceReady;}return confirmed;});
    }
    const confirmed=await cancellationPromise;
    if(!silent&&confirmed){status('Cancelled');setMessage('Processing cancelled. Calls already sent may still be billed.');}
    return confirmed;
  }


  function invalidateChangedReviews(before,after){for(const key of ['facets','edges']){const prior=new Map((before?.[key]||[]).map(x=>[String(x.id),x]));for(const shape of after?.[key]||[]){const old=prior.get(String(shape.id));if(!old||!shape.geometryReview)continue;const geometryKey=key==='facets'?'polygon':'points';if(JSON.stringify(old[geometryKey])!==JSON.stringify(shape[geometryKey])||(key==='edges'&&old.type!==shape.type)){shape.status='unresolved';shape.geometryReview={...shape.geometryReview,status:'invalidated',invalidatedAt:new Date().toISOString(),reason:'Boundary coordinates or edge classification changed; confirm the visible boundary again.'};}}}}
  function edit(action,skipUndo=false){const before=S.committedModel;invalidateChangedReviews(before,S.model);const changes=geometryChanges(before,S.model);if(!skipUndo&&before&&changes.length){S.redo=[];S.undo.push(clone(before));if(S.undo.length>50)S.undo.shift();}const currentMetadata=clone(metadata());if(S.committedMetadata&&JSON.stringify(S.committedMetadata)!==JSON.stringify(currentMetadata))changes.push({kind:'imageMetadata',before:S.committedMetadata,after:currentMetadata});S.committedMetadata=currentMetadata;S.committedModel=S.model?leanModel(S.model):null;$('aiUndo').disabled=!S.undo.length;$('aiRedo').disabled=!S.redo.length;S.revision++;S.latestMeasurement=null;status('Review required');S.edits.push({revision:S.revision,at:new Date().toISOString(),action,changes});void cancel(true);S.result={...S.result,revision:S.revision,status:'REVIEW REQUIRED'};$('aiResults').textContent='Geometry changed. Recalculating; prior measurements are stale.';clearTimeout(S.measureTimer);S.measureTimer=setTimeout(measure,180);draw();}

  async function measure(){if(!S.sourceReady||!S.model||S.traceDraft)return;restrictModel(S.model);const revision=S.revision,snapshot={revision,model:clone(S.model),imageMetadata:clone(metadata())};try{const data=await request('/api/ai/measure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:String(revision),model:snapshot.model,imageMetadata:snapshot.imageMetadata})});if(revision!==S.revision)return;if(S.sourceRestrictions.perspective&&(data.measurements?.projectedAreaM2!=null||data.measurements?.slopedAreaM2!=null))throw Error('Physical measurements withheld: the server did not apply this source restriction. Upload a newly orthorectified source.');S.latestMeasurement={revision,data:clone(data),snapshot};showResults(data);status('Review required');}catch(e){if(revision===S.revision)setMessage(e.message);}}
  function showResults(data){
    const m=data.measurements||data.measurement||{}, issues=[...(data.issues||m.issues||data.reviewReasons||[]),...(S.result?.quality?.issues||[]),...(S.result?.adjudication?.decisions||[])];
    const fmt=v=>v==null?'Unknown / withheld':Number(v).toLocaleString(undefined,{maximumFractionDigits:2});
    const lines=['REVIEW REQUIRED','Horizontal roof area: '+(m.projectedAreaM2==null?'Unknown / withheld':fmt(m.projectedAreaM2*10.7639104)+' ft²'),'Sloped roof area: '+(m.slopedAreaM2==null?'Unknown / withheld':fmt(m.slopedAreaM2*10.7639104)+' ft²')];
    if(S.sourceRestrictions.perspective)lines.push(S.sourceRestrictions.reasons.some(r=>r.includes('Historical perspective warning has unresolved source identity'))?'Unresolved source review: physical measurements are withheld until a new independently orthorectified source is verified.':'Perspective source: upload a new independently orthorectified image for physical measurements. Retry, target selection, rotation and planar calibration cannot remove this restriction.',...S.sourceRestrictions.reasons);
    for(const f of m.facets||[])lines.push(f.id+' ['+(f.status||'inferred')+']: '+fmt(f.pixels2)+' px²; horizontal '+(f.projectedAreaSqft==null?'unknown':fmt(f.projectedAreaSqft)+' ft²')+'; sloped '+(f.slopedAreaM2==null?'unknown':fmt(f.slopedAreaM2*10.7639104)+' ft²'));
    for(const e of m.edges||[])lines.push(e.id+' '+(e.type||'unclassified')+' ['+(e.status||'inferred')+']: '+fmt(e.lengthPixels)+' px'+(e.horizontalLengthM==null?'':'; horizontal '+fmt(e.horizontalLengthM/0.3048)+' ft'));
    const ledger=S.result?.ledger;if(ledger){const unknown=ledger.unknownBillingRequests??ledger.usageMissing??0;lines.push('AI requests: '+ledger.requests);if(unknown)lines.push((Number(ledger.billedUsd)>0?'At least $'+Number(ledger.billedUsd).toFixed(4)+' recorded; ':'')+unknown+' request(s) have unknown usage or billing.');else lines.push('Recorded cost: $'+Number(ledger.billedUsd||0).toFixed(4));if(ledger.exactCostRequests)lines.push('Provider-reported debit: '+ledger.exactCostRequests+' request(s).');if(ledger.rateEstimatedCostRequests)lines.push('Rate-estimated cost: '+ledger.rateEstimatedCostRequests+' request(s).');}
    if(S.result?.failures?.length)lines.push('AI tasks needing retry:',...S.result.failures.map(f=>f.role+': '+f.message));
    for(const a of S.model?.annotations||S.result?.structure?.annotations||[])lines.push('Source '+(a.kind||'annotation')+' ['+(a.status||'unresolved')+']: '+String(a.text||''));
    if(issues.length)lines.push('Review findings:',...issues.map(x=>typeof x==='string'?x:(x.message||x.reason||x.text||x.code||'Review required')+(x.ids?.length?' ['+x.ids.join(', ')+']':'')));
    $('aiResults').textContent=lines.join('\n');
  }

  async function poll(id,revision){if(cancellationPromise||id!==S.jobId||revision!==S.revision)return;try{const job=await request('/api/ai/jobs/'+encodeURIComponent(id));if(cancellationPromise||id!==S.jobId||revision!==S.revision)return;const events=Array.isArray(job.progress)?job.progress:[job.progress||job.status];$('aiProgress').textContent=events.filter(Boolean).map(e=>typeof e==='string'?e:((e.state||e.status)==='schema-repair'?'Retrying an invalid AI response':(e.state||e.status)==='target-selection-required'?'Choose a point inside the intended roof':(e.message||[({outline:'Roof outline',independent:'Independent review',structure:'Roof planes',quality:'Image quality',adjudication:'Review disagreements'})[e.role]||'Analysis',e.state||e.status].filter(Boolean).join(': ')||'Processing'))).join('\n');if(job.error?.code==='TARGET_SELECTION_REQUIRED'){$('aiPickTarget').classList.add('ai-target-needed');throw Error('Choose a point inside the intended roof, then analyze again.');}if(job.status==='failed'||job.status==='error')throw new Error(job.error?.message||job.error||'AI processing failed');if(job.status==='cancelled'){await cancel();return;}if(job.result||['completed','complete','done','succeeded'].includes(job.status)){const result=job.result||job;if(S.original)S.history.push({imageMetadata:clone(metadata()),originalAI:S.original,model:S.model?clone(S.model):null,corrections:clone(S.edits)});S.latestMeasurement=null;S.edits=[];S.result=result;S.original=originalOnce(result);S.model=normalize(result);S.committedModel=clone(S.model);S.committedMetadata=clone(metadata());S.undo=[];S.redo=[];S.traceDraft=null;forgetReceipt(S.requestId);S.jobId=null;S.requestId=null;$('aiCancel').disabled=true;$('aiRun').disabled=false;$('aiExport').disabled=false;selections();$('aiResults').textContent='Validating current source measurements; previous quantities are withheld.';status('Review required');if(result.failures?.some(f=>f.code==='TARGET_SELECTION_REQUIRED')){$('aiPickTarget').classList.add('ai-target-needed');setMessage('Choose a point inside the intended roof, then analyze again.');}else setMessage('Review the white proposal against the dashed independent trace. Disagreements and unsupported measurements need correction.');draw();await measure();return;}S.poll=setTimeout(()=>poll(id,revision),750);}catch(e){if(id!==S.jobId)return;if(!await cancel(true))return;status('Processing failed');setMessage(e.message+' Processing was stopped; you can retry with the image and limits retained.');}}
  function invalidateSourceSelection(){intentEpoch++;S.history=[];S.importedSourceMetadata=null;S.committedMetadata=null;S.drag=null;endTrace();S.undo=[];S.redo=[];S.committedModel=null;S.sourceReady=false;S.imageData=null;S.image=null;S.metadata=null;S.revision++;S.latestMeasurement=null;S.model=null;S.original=null;S.result=null;S.edits=[];S.targetMode=false;for(const id of ['aiX1','aiY1','aiX2','aiY2','aiLength','aiCalibrationSource'])$(id).value='';$('aiCalibrationVerified').checked=false;$('aiConsent').checked=false;$('aiRun').disabled=true;$('aiExport').disabled=true;$('aiSource').value='';$('aiDate').value='';$('aiProgress').textContent='';$('aiResults').textContent='New source selected; prior measurements withheld.';selections();}
  async function acceptImage(data,file,loadId,extraMetadata={}){const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=data;});if(loadId!==fileLoadId)return;if(image.naturalWidth>8192||image.naturalHeight>8192||image.naturalWidth*image.naturalHeight>40000000){setMessage('Choose an image at most 8,192 pixels on either side and 40 million pixels total.');return;}const normalized=document.createElement('canvas');normalized.width=image.naturalWidth;normalized.height=image.naturalHeight;normalized.getContext('2d').drawImage(image,0,0);const normalizedData=normalized.toDataURL('image/png');if(normalizedData.length>10*1024*1024){setMessage('The decoded image is too large to process. Choose a smaller crop and calibrate that image.');return;}const sha256=await imageFingerprint(normalizedData);if(loadId!==fileLoadId)return;for(const id of ['aiX1','aiY1','aiX2','aiY2','aiLength','aiCalibrationSource','aiSource','aiDate'])$(id).value='';$('aiCalibrationVerified').checked=false;$('aiView').value='unknown';$('aiPurpose').value=extraMetadata.purpose||'photo';$('aiSourcePage').value=String(extraMetadata.sourcePage||1);$('aiSourcePage').readOnly=!!extraMetadata.originalPDF;S.revision++;S.sourceRestrictions=mergeRestrictions(knownSourceRestrictions.get(sha256));S.sourceReady=true;S.image=image;S.imageData=normalizedData;S.metadata={...extraMetadata,imageFingerprint:{algorithm:'SHA-256',sha256},originalFile:{name:file.name,type:file.type,bytes:file.size},normalizedSource:{type:'image/png',orientation:'Browser-decoded orientation; no resize',coordinateSpace:'Normalized full-image zero-based pixels'},width:image.naturalWidth,height:image.naturalHeight,fileName:file.name,sourceToDisplay:{matrix:[1,0,0,0,1,0],convention:'x=a*x+b*y+c; y=d*x+e*y+f',coordinateSpace:'full-image pixels'}};S.model=null;S.result=null;S.original=null;S.edits=[];S.latestMeasurement=null;S.importedSourceMetadata=null;S.targetMode=false;$('aiConsent').checked=false;$('aiExport').disabled=true;canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;$('aiRun').disabled=false;status('Image ready');setMessage('Choose the image view, add any verified calibration, and authorize external processing before analysis.');draw();}
  $('aiFile').onchange=async()=>{const loadId=++fileLoadId,file=$('aiFile').files[0];if(localPDF)void localPDF.destroy();localPDF=null;localPDFFile=null;$('aiPDFPage').disabled=true;invalidateSourceSelection();await cancel(true);if(loadId!==fileLoadId||!file)return;$('aiRun').disabled=true;try{if(file.size>8*1024*1024)throw Error('Choose an image smaller than 8 MB.');const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('The image could not be read. Choose another image.'));r.readAsDataURL(file);});if(loadId!==fileLoadId)return;await acceptImage(data,file,loadId);}catch(e){if(loadId===fileLoadId)setMessage(e.message||'The image could not be decoded. Choose a PNG or JPEG image.');}};
  async function showPDFPage(){if(!localPDF||!localPDFFile)return;const loadId=++fileLoadId,pdf=localPDF,file=localPDFFile,page=Number($('aiPDFPage').value);invalidateSourceSelection();await cancel(true);if(loadId!==fileLoadId)return;$('aiRun').disabled=true;status('Rendering PDF page');try{const rendered=await pdf.render(page);if(loadId!==fileLoadId||pdf!==localPDF)return;await acceptImage(rendered.dataURL,file,loadId,{purpose:'document',sourcePage:page,rotation:rendered.pageRotation,originalPDF:{name:file.name,type:file.type,bytes:file.size,pageCount:pdf.pageCount},pdfRender:{scale:rendered.renderScale,embeddedPageRotation:rendered.pageRotation,renderer:'pdfjs-dist 6.5.438',warning:'Check rendered fonts and symbols against the source; source dimensions are unverified.'}});}catch(e){if(loadId===fileLoadId){status('PDF page failed');setMessage(e.message);}}}
  $('aiPDFFile').onchange=async()=>{const loadId=++fileLoadId,file=$('aiPDFFile').files[0];invalidateSourceSelection();await cancel(true);if(!file||loadId!==fileLoadId)return;$('aiRun').disabled=true;status('Opening local PDF');if(localPDF)void localPDF.destroy();localPDF=null;localPDFFile=null;$('aiPDFPage').disabled=true;try{const {openLocalPDF}=await import('./pdf-import.mjs');const pdf=await openLocalPDF(file);if(loadId!==fileLoadId){void pdf.destroy();return;}if(localPDF)void localPDF.destroy();localPDF=pdf;localPDFFile=file;$('aiPDFPage').replaceChildren();for(let i=1;i<=pdf.pageCount;i++){const o=document.createElement('option');o.value=String(i);o.textContent='Page '+i+' of '+pdf.pageCount;$('aiPDFPage').appendChild(o);}$('aiPDFPage').disabled=false;await showPDFPage();}catch(e){if(loadId===fileLoadId){status('PDF could not open');setMessage(e.message||'The PDF reader is unavailable. Export a page as PNG.');}}};
  $('aiPDFPage').onchange=()=>void showPDFPage();

  $('aiRun').onclick=async()=>{const runIntent=++intentEpoch;if(readReceipt()&&!S.requestId){recoveryControls();setMessage('Recover or cancel the saved request before starting another analysis.');return;}if(cancellationPromise){setMessage('Wait for the current cancellation to finish before starting again.');return;}if(!S.sourceReady||!S.imageData){setMessage('Wait for a valid source image or PDF page to finish loading.');return;}if(!$('aiConsent').checked){setMessage('Authorize external processing for this image before starting.');return;}const sourceLoadId=fileLoadId,sourceRevision=S.revision;if(!await cancel(true))return;if(runIntent!==intentEpoch||!S.sourceReady||sourceLoadId!==fileLoadId||sourceRevision!==S.revision||!$('aiConsent').checked)return;const revision=++S.revision;const budget={maxRequests:Number($('aiRequests').value),maxTokens:Number($('aiTokens').value)};if($('aiCost').value)budget.maxCostUsd=Number($('aiCost').value);const nonce=crypto.randomUUID();try{recordReceipt(nonce);}catch{setMessage('This tab cannot retain a recovery receipt. Enable session storage before starting an analysis.');return;}S.requestId=nonce;recoveryControls();S.controller=new AbortController();$('aiRun').disabled=true;$('aiCancel').disabled=false;status('Processing');$('aiProgress').textContent='Starting independent roof agents…';try{const data=await request('/api/ai/trace',{method:'POST',headers:{'Content-Type':'application/json','X-Roof-Request-ID':nonce},signal:S.controller.signal,body:JSON.stringify({revision:String(revision),image:S.imageData,imageMetadata:metadata(),consentExternal:true,budget})});if(revision!==S.revision||S.requestId!==nonce){await request('/api/ai/requests/'+encodeURIComponent(nonce),{method:'DELETE'}).catch(e=>setMessage('Stale request cancellation could not be confirmed: '+e.message));return;}S.jobId=data.jobId;if(!S.jobId)throw Error('The service did not return a processing job.');await poll(S.jobId,revision);}catch(e){if(e.name==='AbortError'||S.requestId!==nonce)return;if(!await cancel(true))return;status('Processing failed');setMessage(e.message+' The request was stopped; you can retry.');}};
  $('aiStopSaved').onclick = async () => {
    const receipt = readReceipt();
    if (!receipt || S.requestId) return;
    intentEpoch++;
    try {
      await request('/api/ai/requests/' + receipt.nonce, {method:'DELETE'});
      forgetReceipt(receipt.nonce);
      setMessage('Saved request cancelled. Previously dispatched work may still be billed.');
    } catch (error) { setMessage('Cancellation unconfirmed. ' + error.message); }
  };
  $('aiResume').onclick = async () => {
    const receipt = readReceipt(), loadId = fileLoadId, revision = S.revision, intent = ++intentEpoch;
    if (!receipt || S.requestId) return;
    if (!S.sourceReady || S.metadata.imageFingerprint.sha256 !== receipt.hash ||
        (receipt.pdf && (!S.metadata.originalPDF || S.metadata.sourcePage !== receipt.page)) ||
        (S.metadata.rotation || 0) !== receipt.rotation)
      return setMessage('Select the same image or rotated document page before recovering this request.');
    if (S.model || S.drag || S.traceDraft) return setMessage('Save current edits and reselect the matching source before recovery.');
    try {
      const record = await request('/api/ai/requests/' + receipt.nonce);
      if (intent !== intentEpoch || loadId !== fileLoadId || revision !== S.revision ||
          receipt.nonce !== readReceipt()?.nonce) return;
      if (record.status === 'creating') return setMessage('The server is admitting this request. Recover it again shortly or cancel it.');
      if (!['running','completed'].includes(record.status) || !record.jobId) {
        forgetReceipt(receipt.nonce);
        return setMessage('Earlier analysis ended (' + record.status + '). Previously dispatched work may be billed.');
      }
      const settings = record.sourceSettings;
      if (record.sourceHash !== S.metadata.imageFingerprint.sha256 || !settings ||
          settings.sourcePage !== receipt.page || settings.rotation !== receipt.rotation ||
          settings.view !== receipt.view || settings.purpose !== receipt.purpose ||
          JSON.stringify(settings.targetPixel) !== JSON.stringify(receipt.target))
        return setMessage('The server source binding differs or is unavailable. Cancel this saved request before starting another analysis.');
      // Reapply the selected target but explicitly withhold all prior physical quantities.
      for (const id of ['aiX1','aiY1','aiX2','aiY2','aiLength','aiCalibrationSource']) $(id).value = '';
      $('aiCalibrationVerified').checked = $('aiConsent').checked = false;
      $('aiView').value = receipt.view === 'oblique' ? 'oblique' : 'unknown';
      $('aiPurpose').value = receipt.purpose;
      $('aiSourcePage').value = String(receipt.page);
      if (receipt.target) S.metadata.targetPixel = receipt.target;
      else delete S.metadata.targetPixel;
      if (receipt.perspective || receipt.view === 'oblique')
        restrictModel(null, {perspective:true, reasons:['Recovered request recorded a perspective source.']});
      S.jobId = record.jobId;
      S.requestId = receipt.nonce;
      S.latestMeasurement = null;
      $('aiCancel').disabled = false;
      $('aiRun').disabled = true;
      recoveryControls();
      status('Recovering existing analysis');
      setMessage('Reopening the original analysis. Verify calibration again before using physical quantities.');
      draw();
      await poll(S.jobId, ++S.revision);
    } catch (error) {
      setMessage(error.message + ' The saved request remains available for recovery or cancellation.');
    }
  };
  $('aiCancel').onclick=()=>cancel();$('aiClose').onclick=()=>{intentEpoch++;root.hidden=true;void cancel(true);};$('aiShape').onchange=syncFields;
  function endTrace(){S.traceDraft=null;$('aiTraceDone').disabled=true;$('aiTraceCancel').disabled=true;}
  function beginTrace(kind) {
    if (!S.sourceReady || !S.image) return setMessage('Load a source before tracing.');
    if (S.drag || S.traceDraft) return setMessage('Finish or cancel the current edit before starting a new trace.');
    if (kind !== 'outline' && !(S.model?.outline.length >= 3)) return setMessage('Trace the roof outline before adding a facet or edge.');
    if ((kind === 'facet' && S.model.facets.length >= 300) || (kind === 'edge' && S.model.edges.length >= 1000))
      return setMessage('This source exceeds the supported shape count.');
    S.traceKind = kind;
    S.revision++;
    S.latestMeasurement = null;
    S.traceDraft = [];
    S.targetMode = false;
    void cancel(true);
    $('aiTraceDone').disabled = $('aiTraceCancel').disabled = false;
    $('aiResults').textContent = 'Tracing in progress. Measurements are withheld.';
    setMessage(kind === 'edge' ? 'Click the points along this roof edge, then finish the trace.' :
      'Click each visible ' + kind + ' corner, then finish the trace.');
    draw();
  }
  $('aiTraceOutline').onclick = () => beginTrace('outline');
  $('aiTraceFacet').onclick = () => beginTrace('facet');
  $('aiTraceEdge').onclick = () => beginTrace('edge');
  $('aiTraceDone').onclick = () => {
    if (!S.sourceReady || !S.traceDraft) return;
    const kind = S.traceKind, points = S.traceDraft, minimum = kind === 'edge' ? 2 : 3;
    if (new Set(points.map(p => p.join(','))).size < minimum)
      return setMessage('Trace at least ' + minimum + ' distinct points.');
    if (!S.model) S.model = { outline: [], facets: [], edges: [] };
    let selection = 'outline', action = 'User traced replacement roof outline';
    if (kind === 'outline') S.model.outline = points;
    else {
      const ids = new Set([...S.model.facets, ...S.model.edges].map(s => s.id));
      const prefix = kind === 'facet' ? 'F' : 'E';
      let n = 1;
      while (ids.has(prefix + n)) n++;
      const id = prefix + n;
      if (kind === 'facet') S.model.facets.push({id, polygon:points, status:'unresolved'});
      else S.model.edges.push({id, points, type:'unspecified', status:'unresolved'});
      selection = kind + ':' + id;
      action = 'User traced new ' + kind + ' ' + id;
    }
    endTrace();
    $('aiExport').disabled = false;
    edit(action);
    selections();
    $('aiShape').value = selection;
    syncFields();
    setMessage(kind === 'outline' ? 'Outline saved. Trace the visible facets and edges.' :
      'Trace saved. Review this boundary against the source before confirming it.');
  };
  $('aiTraceCancel').onclick = () => {
    endTrace();
    draw();
    if (S.model) void measure();
    setMessage('Trace cancelled. The existing geometry is unchanged.');
  };
  $('aiRemoveShape').onclick=()=>{if(!S.sourceReady||!S.model)return;const[kind,id]=selectedShape();if(!['facet','edge'].includes(kind))return setMessage('The roof outline is protected. Select a facet or edge to remove.');const key=kind==='facet'?'facets':'edges';S.model[key]=S.model[key].filter(x=>String(x.id)!==id);edit('Removed '+kind+' '+id);selections();};
  function restoreGeometry(from, to, action) {
    if (!S.sourceReady || S.drag || !from.length || !S.model) return;
    endTrace();
    to.push(leanModel(S.model));
    S.model = restrictModel(from.pop());
    edit(action, true);
    selections();
  }
  $('aiUndo').onclick = () => restoreGeometry(S.undo, S.redo, 'Undid previous geometry edit');
  $('aiRedo').onclick = () => restoreGeometry(S.redo, S.undo, 'Redid geometry edit');
  $('aiEdgeType').onchange=()=>{const[,id]=selectedShape();const edge=S.model?.edges.find(e=>String(e.id)===id);if(!edge)return;edge.type=$('aiEdgeType').value;edge.classificationEvidence={status:'user-provided',source:'User-selected edge classification',date:new Date().toISOString()};edit('Edge '+id+' classification changed');};
  $('aiConfirmBoundary').onclick=()=>{if(!S.sourceReady||!S.model||S.traceDraft)return setMessage('Finish tracing before reviewing a boundary.');const[kind,id]=selectedShape(),shape=kind==='facet'?S.model.facets.find(f=>String(f.id)===id):kind==='edge'?S.model.edges.find(e=>String(e.id)===id):null;if(!shape)return;const note=$('aiBoundaryNote').value.trim();if(!note)return setMessage('Add an evidence note describing the visible boundary before confirming.');if(kind==='edge'&&['unspecified','obstruction'].includes(shape.type))return setMessage('Choose a supported roof edge classification, then separately confirm its visible boundary.');shape.status='user-provided';shape.geometryReview={status:'user-provided',source:'User review of visible boundary in normalized source image',note:note.slice(0,2000),date:new Date().toISOString(),imageFingerprint:clone(S.metadata.imageFingerprint),revision:S.revision+1};edit('Confirmed visible '+kind+' '+id+' boundary with evidence note');syncFields();};
  $('aiSavePitch').onclick=()=>{const[,id]=selectedShape();const facet=S.model?.facets.find(f=>String(f.id)===id);if(!facet)return;const value=$('aiPitch').value;if(value!==''&&(!Number.isFinite(Number(value))||Number(value)<0||Number(value)>60))return setMessage('Enter a pitch from 0 through 60 rise per 12, or leave it unknown.');if(value!==''&&(!$('aiPitchSource').value.trim()||$('aiPitchUncertainty').value===''||!Number.isFinite(Number($('aiPitchUncertainty').value))||Number($('aiPitchUncertainty').value)<0)){setMessage('State the pitch evidence source and nonnegative uncertainty before applying a pitch.');return;}facet.pitch=value===''?null:{rise:Number(value),run:12,source:$('aiPitchSource').value.trim(),uncertainty:Number($('aiPitchUncertainty').value),status:'user-provided'};facet.pitchEvidence=value===''?null:{source:$('aiPitchSource').value.trim(),date:$('aiDate').value||null,status:'user-provided'};edit('Facet '+id+' pitch changed');};
  for(const id of ['aiPurpose','aiSourcePage','aiView','aiX1','aiY1','aiX2','aiY2','aiLength','aiCalibrationSource','aiCalibrationVerified','aiSource','aiDate'])$(id).onchange=()=>{if(S.model)edit('Imagery or calibration metadata changed');else{S.revision++;S.latestMeasurement=null;void cancel(true);if(S.image){status('Metadata changed');setMessage('Image metadata changed. Start a new analysis with these settings.');}}};
  function imagePoint(e) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    if (!(scale > 0)) return null;
    const left = rect.left + (rect.width - canvas.width * scale) / 2;
    const top = rect.top + (rect.height - canvas.height * scale) / 2;
    return {p: [(e.clientX - left) / scale, (e.clientY - top) / scale], scale};
  }
  const distance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
  $('aiPickTarget').onclick=()=>{if(!S.image){setMessage('Choose an image first.');return;}$('aiPickTarget').classList.remove('ai-target-needed');endTrace();S.targetMode=true;setMessage('Click inside the intended roof. A new target clears the active proposal and preserves its review history.');};
  canvas.onpointerdown = e => {
    if (S.drag || e.isPrimary === false || e.button !== 0) return;
    const hit = imagePoint(e);
    if (!hit) return;
    const {p, scale} = hit;
    if (p[0] < 0 || p[0] > canvas.width || p[1] < 0 || p[1] > canvas.height) return;
    if (S.traceDraft) { S.traceDraft.push(p); draw(); return; }
    if(S.targetMode){if(S.original)S.history.push({imageMetadata:clone(metadata()),originalAI:S.original,model:S.model?clone(S.model):null,corrections:clone(S.edits)});S.metadata.targetPixel=p;S.targetMode=false;S.revision++;S.latestMeasurement=null;endTrace();S.undo=[];S.redo=[];S.committedModel=null;S.model=null;S.result=null;S.original=null;S.edits=[];void cancel(true);$('aiExport').disabled=!S.history.length;$('aiResults').textContent='New target selected; analyze this roof before using measurements.';status('Target selected');draw();return;}
    const points = selected();
    if (!points?.length) return;
    const tolerance = 12 / scale;
    let index = -1, closest = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.hypot(points[i][0] - p[0], points[i][1] - p[1]);
      if (d <= tolerance && d < closest) { index = i; closest = d; }
    }
    const tool = $('aiTool').value, isEdge = $('aiShape').value.startsWith('edge:');
    if (tool === 'delete' && index >= 0) {
      const min = isEdge ? 2 : 3;
      if (points.length <= min) { setMessage('Keep at least ' + min + ' vertices.'); return; }
      points.splice(index, 1); edit('Vertex deleted');
    } else if (tool === 'add') {
      let best = -1, d = Infinity;
      for (let i = 0; i < (isEdge ? points.length - 1 : points.length); i++) {
        const v = distance(p, points[i], points[(i+1) % points.length]);
        if (v <= tolerance && v < d) { d = v; best = i; }
      }
      if (best >= 0) { points.splice(best + 1, 0, p); edit('Vertex added'); }
    } else if (tool === 'move' && index >= 0) {
      S.revision++; S.latestMeasurement = null; void cancel(true);
      $('aiResults').textContent = 'Editing geometry; previous measurements are stale.';
      S.drag = {points, index, before: clone(points[index]), pointerId: e.pointerId};
      canvas.setPointerCapture(e.pointerId);
    }
  };
  canvas.onpointermove = e => {
    if (S.drag?.pointerId !== e.pointerId) return;
    const hit = imagePoint(e);
    if (!hit) return;
    S.drag.points[S.drag.index] = [Math.max(0, Math.min(canvas.width, hit.p[0])), Math.max(0, Math.min(canvas.height, hit.p[1]))];
    draw();
  };
  canvas.onpointerup = e => {
    if (S.drag?.pointerId !== e.pointerId) return;
    const drag = S.drag;
    S.drag = null;
    if (drag.points === selected()) edit('Vertex moved');
  };
  canvas.onpointercancel = canvas.onlostpointercapture = e => {
    if (S.drag?.pointerId !== e.pointerId) return;
    const drag = S.drag;
    S.drag = null;
    drag.points[drag.index] = drag.before;
    if (drag.points !== selected()) return;
    draw(); clearTimeout(S.measureTimer); S.measureTimer = setTimeout(measure, 180);
  };
  async function rotateImage(clockwise){if(!S.sourceReady||!S.image){setMessage('Choose an image first.');return;}const revision=++S.revision,loadId=++fileLoadId;S.sourceReady=false;S.latestMeasurement=null;await cancel(true);if(revision!==S.revision||loadId!==fileLoadId)return;const w=canvas.width,h=canvas.height,rotated=document.createElement('canvas');rotated.width=h;rotated.height=w;const c=rotated.getContext('2d');if(clockwise){c.translate(h,0);c.rotate(Math.PI/2);}else{c.translate(0,w);c.rotate(-Math.PI/2);}c.drawImage(S.image,0,0);const data=rotated.toDataURL('image/png');if(data.length>10*1024*1024){S.sourceReady=true;if(S.model)void measure();setMessage('Rotated image is too large. Choose a smaller source crop.');return;}const sha256=await imageFingerprint(data);if(revision!==S.revision||loadId!==fileLoadId)return;const before=metadata();S.history.push({action:'Rotated source image; prior geometry/calibration withheld',imageMetadata:clone(before),originalAI:S.original,model:S.model?clone(S.model):null,corrections:clone(S.edits)});const matrix=clockwise?[0,-1,h,1,0,0]:[0,1,0,-1,0,w];S.metadata={...S.metadata,width:h,height:w,imageFingerprint:{algorithm:'SHA-256',sha256},rotation:((before.rotation||0)+(clockwise?90:270))%360,sourceTransforms:[...(S.metadata.sourceTransforms||[]),{from:{width:w,height:h},to:{width:h,height:w},matrix,convention:'x=a*x+b*y+c; y=d*x+e*y+f'}]};delete S.metadata.targetPixel;delete S.metadata.calibration;rememberSourceRestriction();S.sourceReady=true;S.image=rotated;S.imageData=data;endTrace();S.undo=[];S.redo=[];S.committedModel=null;S.model=null;S.original=null;S.result=null;S.edits=[];for(const id of ['aiX1','aiY1','aiX2','aiY2','aiLength','aiCalibrationSource'])$(id).value='';$('aiCalibrationVerified').checked=false;$('aiConsent').checked=false;$('aiExport').disabled=false;canvas.width=h;canvas.height=w;status('Image rotated');$('aiResults').textContent='Rotated image: prior geometry and measurements withheld.';setMessage('Rotation applied to source pixels. Select the target and re-enter calibration before a new analysis.');draw();}
  $('aiRotateLeft').onclick=()=>void rotateImage(false).catch(e=>setMessage(e.message));$('aiRotateRight').onclick=()=>void rotateImage(true).catch(e=>setMessage(e.message));
  $('aiImport').onchange=async()=>{const file=$('aiImport').files[0],revision=S.revision,loadId=fileLoadId;try{if(!S.sourceReady||!S.image||!file)throw Error('Upload the matching image before reopening a review.');if(file.size>8*1024*1024)throw Error('Review JSON exceeds the 8 MB limit.');const saved=JSON.parse(await file.text());if(revision!==S.revision||loadId!==fileLoadId)throw Error('The image changed while loading the review. Try again.');if(saved.app!=='roof-measure-ai-review'||saved.version!==2)throw Error('This review lacks a supported image fingerprint. Reopen requires a version 2 review.');const m=saved.imageMetadata;if(m?.imageFingerprint?.algorithm!=='SHA-256'||m.imageFingerprint.sha256!==S.metadata.imageFingerprint.sha256||m.width!==canvas.width||m.height!==canvas.height)throw Error('This review belongs to a different image. Upload the exact original image; cropped or changed images cannot reuse its geometry or scale.');const model=saved.model==null&&Array.isArray(saved.previousReviews)&&saved.previousReviews.length ? null : validateImportedModel(saved.model);if(!Array.isArray(saved.corrections)||saved.corrections.length>10000||!Array.isArray(saved.previousReviews)||saved.previousReviews.length>1000)throw Error('Invalid review history.');const priorRevision=Number(saved.revision);
    if(!Number.isSafeInteger(priorRevision)||priorRevision<0||priorRevision>=Number.MAX_SAFE_INTEGER-10000)throw Error('Invalid saved review revision.');
    if(!await cancel(true))return;
    if(revision!==S.revision||loadId!==fileLoadId)throw Error('The current review changed. Try reopening again.');
    S.revision=Math.max(S.revision,priorRevision)+1;S.model=restrictModel(model,saved.imageMetadata.sourceRestrictions,saved.sourceRestrictions,sourceEvidence(saved.originalAI,S.metadata?.imageFingerprint?.sha256),historyRestrictions(saved.previousReviews,S.metadata?.imageFingerprint?.sha256));S.committedModel=clone(S.model);S.committedMetadata=clone(metadata());S.undo=[];S.redo=[];S.traceDraft=null;S.original=saved.originalAI?originalOnce(saved.originalAI):(saved.model?.originalAI||saved.model?.originalProposal)?{originalAI:clone(saved.model.originalAI||saved.model.originalProposal),model:leanModel(saved.model)}:null;S.result=null;S.edits=compactLegacyEdits(saved.corrections,S.original?.model);S.edits.push({revision:S.revision,action:'Reopened matching-image review; saved calibration withheld',at:new Date().toISOString()});const lastReplacement=saved.previousReviews.findLastIndex(entry=>entry?.action==='Source replaced; prior source provenance');S.history=clone(saved.previousReviews.slice(lastReplacement+1));S.importedSourceMetadata=clone(saved.imageMetadata);S.history.push({action:"Reopened source provenance; untrusted for active calibration",imageMetadata:clone(saved.imageMetadata),importedAt:new Date().toISOString()});S.latestMeasurement=null;for(const id of ['aiX1','aiY1','aiX2','aiY2','aiLength','aiCalibrationSource'])$(id).value='';$('aiCalibrationVerified').checked=false;$('aiConsent').checked=false;$('aiExport').disabled=false;selections();draw();status('Review reopened');setMessage('Geometry and audit history restored for this image. Saved measurements and calibration were withheld. Re-enter verified calibration to calculate physical quantities.');await measure();}catch(e){setMessage(e.message);}finally{$('aiImport').value='';}};
  function reviewPayload(){return {app:'roof-measure-ai-review',version:2,revision:S.revision,status:'REVIEW REQUIRED',imageMetadata:metadata(),importedSourceMetadata:S.importedSourceMetadata,originalAI:S.original,model:S.model,corrections:S.edits,latestResult:S.latestMeasurement?.revision===S.revision?S.latestMeasurement.data:null,measurementSnapshot:S.latestMeasurement?.revision===S.revision?clone(S.latestMeasurement.snapshot):null,measurementStatus:S.latestMeasurement?.revision===S.revision?'current':'stale / withheld',previousReviews:S.history,exportedAt:new Date().toISOString()};}
  function saveDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function savedJSON(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
    if (bytes.byteLength > 8 * 1024 * 1024) throw Error('This review exceeds the 8 MB reopen limit. Save its PDF and retain the source for manual review.');
    return bytes;
  }

  $('aiExport').onclick = () => {
    try {
      if (!S.sourceReady || (!S.model && !S.history.length) || S.drag || S.traceDraft) throw Error('Finish the current geometry edit before saving a review.');
      saveDownload(new Blob([savedJSON(reviewPayload())], {type:'application/json'}), 'roof-ai-review.json');
    } catch (error) { setMessage(error.message); }
  };

  async function saveReport(bundle) {
    try {
      const revision = S.revision, loadId = fileLoadId;
      const current = () => S.sourceReady && S.model && !S.drag && !S.traceDraft &&
        S.revision === revision && fileLoadId === loadId && S.latestMeasurement?.revision === revision;
      if (!current()) throw Error('Wait for the current geometry measurement before saving a PDF.');
      if (typeof window.buildAIReviewPDF !== 'function') throw Error('The source image report builder is unavailable. Reload the server preview.');
      const payload = reviewPayload(), sourceImage = S.imageData;
      const json = bundle ? savedJSON(payload) : null;
      const pdf = await window.buildAIReviewPDF({...payload, sourceImage});
      let output = pdf instanceof Blob ? pdf : new Blob([pdf], {type:'application/pdf'});
      if (bundle) {
        const {zipSync} = await import('./vendor/fflate/browser.mjs');
        const png = Uint8Array.from(atob(sourceImage.split(',')[1]), c => c.charCodeAt(0));
        const bytes = new Uint8Array(await output.arrayBuffer());
        output = new Blob([zipSync({'review.pdf': bytes, 'review.json': json, 'source.png': png}, {level:0})], {type:'application/zip'});
      }
      if (!current()) throw Error('The review changed while building the PDF. Measure the latest revision and save again.');
      saveDownload(output, bundle ? 'roof-source-review.zip' : 'roof-source-image-review.pdf');
    } catch (error) { setMessage(error.message); }
  }
  $('aiPDF').onclick = () => saveReport(false);
  $('aiZIP').onclick = () => saveReport(true);
  document.getElementById('btnOpenAITrace').onclick=()=>{root.hidden=false;draw();void config().then(c=>{if(c.limits){$('aiRequests').max=c.limits.maxRequests;$('aiTokens').max=c.limits.maxTokens;if(!$('aiCost').value)$('aiCost').value=c.limits.maxCostUsd||'';}if(!c.available)setMessage('AI processing is unavailable on this server. Review and calibration remain local.');}).catch(e=>setMessage(e.message));};
  window.rmAIReview={open(){root.hidden=false;draw();},snapshot(){return{measurementRevision:S.latestMeasurement?.revision??null,cancelling:Boolean(cancellationPromise),sourceReady:S.sourceReady,revision:S.revision,metadata:metadata(),model:S.model?clone(S.model):null,edits:clone(S.edits)};}};
})();
