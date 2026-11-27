import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const MAX_PDF=16*1024*1024,MAX_DATA=1024*1024,MAX_PAGES=50,MAX_TEXT=250000;
const SCOPE='Generated text-only customer PDF consistency/layout check; not physical measurement or field accuracy verification';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const normalized=value=>String(value).normalize('NFC').replace(/\s+/g,' ').trim();
const escape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const failure=code=>({ok:false,issues:[{code}],pages:0,imageryCount:0,vectorOperationCount:0,quantityRowsChecked:0,textCharacters:0,scope:SCOPE});

async function boundedFile(path,max) {
  if(typeof path!=='string'||!path)throw new Error('FILE_PATH_REQUIRED');
  const entry=await lstat(path);
  if(!entry.isFile()||entry.isSymbolicLink()||entry.size<1||entry.size>max)throw new Error('FILE_SIZE_OR_TYPE');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try {
    const before=await handle.stat();
    if(before.dev!==entry.dev||before.ino!==entry.ino||before.size!==entry.size)throw new Error('FILE_CHANGED');
    const bytes=Buffer.alloc(before.size);let offset=0;
    while(offset<bytes.length) {
      const part=await handle.read(bytes,offset,bytes.length-offset,offset);
      if(!part.bytesRead)break;offset+=part.bytesRead;
    }
    const after=await handle.stat();
    if(offset!==bytes.length||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new Error('FILE_CHANGED');
    return bytes;
  }finally {await handle.close();}
}

function expectedData(bytes) {
  let data;try{data=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('INVALID_CUSTOMER_DATA');}
  const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=1000;
  if(!data||data.schemaVersion!==1||data.status!=='REVIEW REQUIRED'||
    !['jobId','revision','date','buildingScope'].every(key=>text(data[key]))||
    !Array.isArray(data.quantities)||data.quantities.length>200||!Array.isArray(data.notes))throw new Error('INVALID_CUSTOMER_DATA');
  const names=new Set();
  for(const q of data.quantities) {
    if(!q||!['name','unit','status','source'].every(key=>text(q[key]))||names.has(normalized(q.name))||
      !['source-reported','reviewed','inferred','user-provided','measured','unknown'].includes(q.status)||
      !(q.value===null||(Number.isFinite(q.value)&&q.value>=0))||(q.status==='unknown'&&q.value!==null))throw new Error('INVALID_CUSTOMER_DATA');
    names.add(normalized(q.name));
  }
  return data;
}

async function inspectPDF(bytes) {
  const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,enableXfa:false,
    useSystemFonts:false,disableFontFace:true,stopAtErrors:true,
    standardFontDataUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url))});
  try {
    const document=await loading.promise;
    if(document.numPages<1||document.numPages>MAX_PAGES)throw new Error('PAGE_LIMIT');
    const issues=[],pageSizes=[],texts=[];let imageryCount=0,vectorOperationCount=0,textCharacters=0;
    const imageOps=new Set(Object.entries(OPS).filter(([name])=>/image/i.test(name)).map(([,value])=>value));
    const vectorOps=new Set(['constructPath','moveTo','lineTo','curveTo','curveTo2','curveTo3','rectangle','stroke','closeStroke',
      'fill','eoFill','fillStroke','eoFillStroke','closeFillStroke','closeEOFillStroke','shadingFill'].map(name=>OPS[name]).filter(value=>Number.isInteger(value)));
    function issue(code,details={}){if(issues.length<200)issues.push({code,...details});}
    for(let index=1;index<=document.numPages;index++) {
      const page=await document.getPage(index),viewport=page.getViewport({scale:1,rotation:0});
      pageSizes.push({page:index,width:viewport.width,height:viewport.height,rotation:page.rotate});
      if(Math.abs(viewport.width-612)>.5||Math.abs(viewport.height-792)>.5||page.rotate!==0)issue('PAGE_NOT_PORTRAIT_LETTER',{page:index});
      const content=await page.getTextContent(),operators=await page.getOperatorList();
      // PDF.js may omit fully off-page/invisible text from getTextContent. Inspect
      // its actual text operators too instead of treating omission as clean layout.
      const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
      let ctm=[1,0,0,1,0,0],tm=[1,0,0,1,0,0],lm=[1,0,0,1,0,0],fontSize=0,leading=0,charSpace=0,wordSpace=0,hScale=1,fillColor='#000000',opacity=1;
      const stack=[];
      const move=(x,y)=>{lm=multiply(lm,[1,0,0,1,x,y]);tm=[...lm];};
      for(let opIndex=0;opIndex<operators.fnArray.length;opIndex++) {
        const op=operators.fnArray[opIndex],args=operators.argsArray[opIndex]||[];
        if(op===OPS.save)stack.push({ctm:[...ctm],fontSize,leading,charSpace,wordSpace,hScale,fillColor,opacity});
        else if(op===OPS.restore&&stack.length)({ctm,fontSize,leading,charSpace,wordSpace,hScale,fillColor,opacity}=stack.pop());
        else if(op===OPS.transform)ctm=multiply(ctm,args);
        else if(op===OPS.beginText){tm=[1,0,0,1,0,0];lm=[...tm];}
        else if(op===OPS.setFont)fontSize=args[1];
        else if(op===OPS.setLeading)leading=args[0];
        else if(op===OPS.setCharSpacing)charSpace=args[0];
        else if(op===OPS.setWordSpacing)wordSpace=args[0];
        else if(op===OPS.setHScale)hScale=args[0]/100;
        else if(op===OPS.setFillRGBColor)fillColor=typeof args[0]==='string'?args[0]:null;
        else if(op===OPS.setGState) {
          for(const setting of args[0]||[])if(setting[0]==='ca')opacity=setting[1];
        }
        else if(op===OPS.setTextMatrix){tm=[...args];lm=[...tm];}
        else if(op===OPS.moveText)move(args[0],args[1]);
        else if(op===OPS.setLeadingMoveText){leading=-args[1];move(args[0],args[1]);}
        else if(op===OPS.nextLine)move(0,-leading);
        else if(op===OPS.setTextRenderingMode&&args[0]!==0)issue('UNSUPPORTED_TEXT_RENDERING_MODE',{page:index});
        else if(op===OPS.showText||op===OPS.showSpacedText) {
          const glyphs=args[0];
          if(!Array.isArray(glyphs)) {issue('INVALID_TEXT_GEOMETRY',{page:index});continue;}
          let advance=0;
          for(const glyph of glyphs) {
            if(typeof glyph==='number')advance-=glyph/1000*fontSize*hScale;
            else if(glyph&&Number.isFinite(glyph.width))advance+=(glyph.width/1000*fontSize+charSpace+(glyph.isSpace?wordSpace:0))*hScale;
            else issue('INVALID_TEXT_GEOMETRY',{page:index});
          }
          const matrix=multiply(ctm,tm),[a,b,c,d,x,y]=matrix,width=advance*a,height=Math.abs(fontSize*d);
          if(!Number.isFinite(opacity)||opacity<1)issue('UNSUPPORTED_TEXT_OPACITY',{page:index});
          if(!Number.isFinite(hScale)||hScale<=0||advance<=0)issue('UNREADABLE_TEXT_SCALE',{page:index});
          if(!/^#[a-f0-9]{6}$/i.test(fillColor||''))issue('UNSUPPORTED_TEXT_COLOR',{page:index});
          else {
            const rgb=[1,3,5].map(offset=>parseInt(fillColor.slice(offset,offset+2),16)/255)
              .map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
            const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
            if(1.05/(luminance+.05)<4.5)issue('LOW_TEXT_CONTRAST',{page:index});
          }
          if(![a,b,c,d,x,y,width,height].every(Number.isFinite)||a<=0||d<=0||Math.abs(b)>.01||Math.abs(c)>.01)issue('UNSUPPORTED_TEXT_TRANSFORM',{page:index});
          if(height<7)issue('TEXT_TOO_SMALL',{page:index});
          if(x<-.5||y<-.5||x+width>viewport.width+.5||y+height>viewport.height+.5)issue('CLIPPED_TEXT',{page:index,x,y,width,height});
          tm=multiply(tm,[1,0,0,1,advance,0]);
        }
      }
      const rectangles=[];
      for(const item of content.items) {
        if(typeof item.str!=='string'||!item.str.trim())continue;
        texts.push(item.str);textCharacters+=item.str.length;
        if(textCharacters>MAX_TEXT)throw new Error('TEXT_LIMIT');
        const transform=item.transform,[a,b,c,d,x,y]=transform||[];
        if(![a,b,c,d,x,y,item.width,item.height].every(Number.isFinite)) {issue('INVALID_TEXT_GEOMETRY',{page:index});continue;}
        // These generated reports are horizontal text. A separate layout contract
        // would be required for transformed text instead of guessing its bounds.
        if(Math.abs(b)>.01||Math.abs(c)>.01||a<=0||d<=0)issue('UNSUPPORTED_TEXT_TRANSFORM',{page:index});
        const width=Math.abs(item.width),height=Math.abs(item.height);
        if(height<7)issue('TEXT_TOO_SMALL',{page:index});
        if(x<-.5||y<-.5||x+width>viewport.width+.5||y+height>viewport.height+.5)issue('CLIPPED_TEXT',{page:index,x,y,width,height});
        rectangles.push({x,y,width,height});
      }
      for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++) {
        const a=rectangles[i],b=rectangles[j],overlapX=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),
          overlapY=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
        if(overlapX>.5&&overlapY>.5)issue('OVERLAPPING_TEXT',{page:index});
      }
      imageryCount+=operators.fnArray.filter(op=>imageOps.has(op)).length;
      vectorOperationCount+=operators.fnArray.filter(op=>vectorOps.has(op)).length;
      page.cleanup();
    }
    if(imageryCount)issue('IMAGERY_IN_TEXT_ONLY_REPORT');
    if(vectorOperationCount)issue('VECTOR_DRAWING_IN_TEXT_ONLY_REPORT');
    if(!textCharacters)issue('NO_READABLE_TEXT');
    return {issues,pages:document.numPages,pageSizes,imageryCount,vectorOperationCount,textCharacters,text:normalized(texts.join(' '))};
  }finally {await loading.destroy();}
}

function inWorker(bytes,{signal,timeoutMs}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new Error('CANCELLED'));return;}
    // This self-contained file worker must not inherit CLI-only input/test flags
    // or injected preload scripts from its caller.
    const worker=new Worker(new URL(import.meta.url),{execArgv:[],workerData:{kind:'roof-cloud-pdf-v1',bytes:new Uint8Array(bytes)},
      resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32}});
    let done=false;
    const finish=(error,value)=>{
      if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();
      error?reject(error):resolve(value);
    };
    const abort=()=>finish(new Error('CANCELLED'));
    const timer=setTimeout(()=>finish(new Error('PDF_VERIFICATION_TIMEOUT')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    worker.once('message',value=>value.ok?finish(null,value.result):finish(new Error(value.code||'PDF_PARSE_FAILED')));
    worker.once('error',()=>finish(new Error('PDF_WORKER_FAILED')));
    worker.once('exit',code=>{if(!done)finish(new Error(`PDF_WORKER_EXIT_${code}`));});
  });
}

export async function verifyCloudPDF({pdfPath,dataPath,signal,timeoutMs=45000}={}) {
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>45000)throw new Error('PDF verification deadline must be1..45000ms');
  try {
    if(signal?.aborted)return failure('CANCELLED');
    const [pdfBytes,dataBytes]=await Promise.all([boundedFile(pdfPath,MAX_PDF),boundedFile(dataPath,MAX_DATA)]);
    const data=expectedData(dataBytes),inspection=await inWorker(pdfBytes,{signal,timeoutMs});
    const {text,...result}=inspection,issues=[...result.issues];let quantityRowsChecked=0;
    const missing=(code,details={})=>{if(issues.length<200)issues.push({code,...details});};
    if(!text.includes('REVIEW REQUIRED'))missing('REVIEW_STATUS_MISSING');
    for(const key of ['jobId','revision','date','buildingScope'])if(!text.includes(normalized(`${key}: ${data[key]}`)))missing('REPORT_METADATA_MISMATCH',{field:key});
    for(const q of data.quantities) {
      const row=normalized(`${q.name}: ${q.value===null?'Unknown':q.value} ${q.unit} | ${q.status} | Source: ${q.source}`);
      const labels=text.match(new RegExp(escape(normalized(q.name))+'\\s*:', 'g'))||[];
      if(labels.length!==1)missing('QUANTITY_LABEL_COUNT_MISMATCH',{name:q.name,count:labels.length});
      if(!text.includes(row))missing('QUANTITY_ROW_MISMATCH',{name:q.name});else quantityRowsChecked++;
    }
    for(const note of data.notes)if(typeof note!=='string'||!text.includes(normalized(note)))missing('REPORT_NOTE_MISMATCH');
    return {...result,ok:issues.length===0,issues,quantityRowsChecked,pdfSha256:hash(pdfBytes),dataSha256:hash(dataBytes),scope:SCOPE};
  }catch(error) {
    const safe=new Set(['FILE_PATH_REQUIRED','FILE_SIZE_OR_TYPE','FILE_CHANGED','INVALID_CUSTOMER_DATA','PAGE_LIMIT','TEXT_LIMIT',
      'CANCELLED','PDF_VERIFICATION_TIMEOUT','PDF_WORKER_FAILED']);
    return failure(safe.has(error.message)?error.message:'PDF_PARSE_OR_READ_FAILED');
  }
}

if(!isMainThread&&workerData?.kind==='roof-cloud-pdf-v1') {
  inspectPDF(workerData.bytes).then(result=>parentPort.postMessage({ok:true,result})).catch(error=>{
    parentPort.postMessage({ok:false,code:['PAGE_LIMIT','TEXT_LIMIT'].includes(error.message)?error.message:'PDF_PARSE_FAILED'});
  });
}
