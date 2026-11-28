import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {installOfflineMap} from './offline-map.mjs';
import {testServer} from './ui-test-server.mjs';

// Exercise production handlers through DOM clicks. Only Maps transport/projection
// and Solar responses are synthetic; no private property, imagery or API key is used.
const artifacts = path.resolve('.devcache/solar-selection-recovery');
await fs.mkdir(artifacts, {recursive:true});
const server = await testServer(process.argv[2]);
let browser;
const errors = [];
function record(loc, name = 'fixture/selected-roof') {
  return {name,center:{latitude:loc.lat,longitude:loc.lng},
    boundingBox:{sw:{latitude:loc.lat-.000045,longitude:loc.lng-.000045},ne:{latitude:loc.lat+.000045,longitude:loc.lng+.000045}},
    imageryDate:{year:2025,month:2,day:11},imageryQuality:'HIGH',
    solarPotential:{wholeRoofStats:{areaMeters2:110,groundAreaMeters2:100},roofSegmentStats:[]}};
}
function installClickableMap() {
  const BaseMap = google.maps.Map;
  google.maps.LatLng.prototype.equals = function(other) { return this.lat() === other.lat() && this.lng() === other.lng(); };
  google.maps.geometry.spherical.computeArea = points => RM.planSqft(points) / RM.SQFT;
  google.maps.Geocoder = class {
    async geocode({address,location}) {
      const loc = location || {lat:30.3,lng:-81.6};
      return {results:[{formatted_address:address || 'Synthetic recovery fixture',types:['street_address'],
        geometry:{location:new google.maps.LatLng(loc),location_type:'ROOFTOP'}}]};
    }
  };
  google.maps.Map = class extends BaseMap {
    constructor(el, options) {
      super(el); this.center = new google.maps.LatLng(options.center); this.listeners = {};
      el.style.background = '#263743';
      el.innerHTML = '<div style="position:absolute;top:100px;left:24px;right:24px;color:white;pointer-events:none">SYNTHETIC MAP FIXTURE — no satellite imagery or real property</div><svg style="position:absolute;left:30%;top:32%;width:40%;height:30%;pointer-events:none" viewBox="0 0 300 160"><path d="M10 20H290V140H10Z M10 20L150 80L290 20 M150 80V140" stroke="#9bc9d7" fill="#435763" stroke-width="3"/></svg>';
      el.addEventListener('click', event => {
        const box=el.getBoundingClientRect(), k=RM.scale(this.center.lat());
        const latLng=new google.maps.LatLng(this.center.lat()-(event.clientY-box.y-box.height/2)/5/k.ky,
          this.center.lng()+(event.clientX-box.x-box.width/2)/5/k.kx);
        for(const listener of this.listeners.click || []) listener({latLng,domEvent:event});
      });
    }
    addListener(name, listener) { (this.listeners[name] ||= []).push(listener); return {remove:()=>{this.listeners[name]=this.listeners[name].filter(fn=>fn!==listener);}}; }
    getCenter() { return this.center; }
    setCenter(loc) { this.center = new google.maps.LatLng(loc); }
    panTo(loc) { this.setCenter(loc); }
    panBy(x,y) { const k=RM.scale(this.center.lat()); this.setCenter({lat:this.center.lat()+y/5/k.ky,lng:this.center.lng()-x/5/k.kx}); }
  };
  initMap();
  document.querySelector('#nokey').hidden=true;
}

try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || chromium.executablePath()});
  const context = await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1});
  await context.addInitScript(installOfflineMap);
  let responses = [], calls = 0;
  await context.route('**/*', async route => {
    const url=new URL(route.request().url());
    if (url.hostname === 'solar.googleapis.com') {
      calls++;
      const next=responses.shift();
      assert(next,'Unexpected Solar lookup; recovery must not loop automatically.');
      const loc={lat:Number(url.searchParams.get('location.latitude')),lng:Number(url.searchParams.get('location.longitude'))};
      const result=typeof next === 'function' ? await next(loc) : next;
      await route.fulfill({status:result.status || 200,contentType:'application/json',body:JSON.stringify(result.body || result)});
    } else if (url.origin === new URL(server.baseURL).origin) await route.continue();
    else await route.abort();
  });
  async function fresh() {
    const page=await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.baseURL);
    await page.evaluate(installClickableMap);
    // pin.js attaches its actual click handler after map initialization.
    await page.waitForFunction(()=>map.listeners.click?.length >= 2);
    return page;
  }
  async function address(page) {
    await page.fill('#address','Synthetic recovery fixture');
    await page.click('#btnGo');
    await page.waitForFunction(()=>state.location?.precision === 'ROOFTOP');
  }
  async function mapClick(page,x=0,y=0) {
    const box=await page.locator('#map').boundingBox();
    await page.mouse.click(box.x+box.width/2+x,box.y+box.height/2+y);
  }
  async function mismatch(page) {
    responses.push(loc=>record({...loc,lng:loc.lng+.0004},'fixture/neighbour'));
    await page.click('#btnSolar');
    await page.locator('#btnSolarManual').waitFor({state:'visible'}).catch(async error=>{
      await page.locator('#solarOut').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(artifacts,'failed-mismatch-recovery.png')});
      throw error;
    });
    assert.match(await page.locator('#solarOut').innerText(),/roof model does not match/i);
    assert.equal(await page.evaluate(()=>state.solarIssue?.code),'SOLAR_SELECTION_MISMATCH');
    assert(await page.locator('#btnAuto').isDisabled(),'A rejected neighbouring roof must stay untraceable.');
    assert.equal(await page.evaluate(()=>state.solar),null);
    for(const id of ['btnSolarPickRetry','btnSolarManual','btnSolarRetry']) assert(await page.locator('#'+id).isEnabled(),id);
  }
  async function drawFacet(page) {
    for(const [x,y] of [[-65,-40],[65,-40],[65,40],[-65,40]]) await mapClick(page,x,y);
    await page.click('#btnFinish');
    await page.waitForFunction(()=>state.facets.length === 1);
    const result=await page.evaluate(()=>({corners:pathToLiteral(state.facets[0].shape).length,plan:facetMetrics(state.facets[0]).plan}));
    assert.equal(result.corners,4);
    assert(result.plan > 4400 && result.plan < 4550,'Manual recovery must create the clicked 26 m × 16 m plan, in square feet.');
  }
  async function assertActionsFit(page) {
    const clipped=await page.evaluate(()=>{
      const side=document.querySelector('#sidebar').getBoundingClientRect();
      return ['btnSolar','btnAuto','btnScan','btnSolarPickRetry','btnSolarManual','btnSolarRetry'].filter(id=>{
        const box=document.getElementById(id).getBoundingClientRect();
        return box.left < side.left || box.right > side.right;
      });
    });
    assert.deepEqual(clipped,[],'Roof and recovery actions must fit inside the scrollable sidebar.');
  }

  // A geocoder ROOFTOP point is not an explicit pin. Preserve its safety check,
  // but give the user a visible path to continue drawing the intended house.
  const manual=await fresh();
  await address(manual);
  assert.equal(await manual.evaluate(()=>Boolean(state.location.selectedByPin)),false);
  await mismatch(manual);
  await assertActionsFit(manual);
  await manual.locator('#solarOut').scrollIntoViewIfNeeded();
  await manual.screenshot({path:path.join(artifacts,'mismatch-recovery-desktop.png')});
  await manual.setViewportSize({width:390,height:844});
  await assertActionsFit(manual);
  await manual.locator('#solarOut').scrollIntoViewIfNeeded();
  await manual.screenshot({path:path.join(artifacts,'mismatch-recovery-mobile.png')});
  await manual.setViewportSize({width:1440,height:960});
  await manual.click('#btnSolarManual');
  assert.equal(await manual.evaluate(()=>state.tool),'facet');
  assert.equal(await manual.locator('#panelTrace').getAttribute('open'),'');
  assert.equal(await manual.evaluate(()=>document.querySelector('#sidebar').getBoundingClientRect().left),0,
    'Manual recovery must not scroll the whole page sideways to expose the wide toolbar.');
  await drawFacet(manual);
  assert(await manual.locator('#btnSolar').isEnabled());
  assert(await manual.locator('#btnAuto').isDisabled());
  await manual.screenshot({path:path.join(artifacts,'manual-recovery-desktop.png')});

  // A previous successful response must not remain available after a newer
  // mismatch at the same location. The user's manually drawn geometry survives.
  responses.push(loc=>record(loc));
  await manual.click('#btnSolar');
  await manual.waitForFunction(()=>state.solar?.name === 'fixture/selected-roof');
  assert(await manual.locator('#btnAuto').isEnabled());
  await mismatch(manual);
  assert.equal(await manual.evaluate(()=>state.facets.length),1);
  assert.equal(await manual.evaluate(()=>state.solarShapes.length),0);
  const preserved=await manual.evaluate(()=>pathToLiteral(state.facets[0].shape));
  await manual.click('#btnSolarManual');
  assert.equal(await manual.evaluate(()=>state.facets.length),1,'Manual recovery must preserve existing roof edits.');
  assert.deepEqual(await manual.evaluate(()=>pathToLiteral(state.facets[0].shape)),preserved);
  await manual.close();

  // The mismatch repair action requests a new map pin and retries once after
  // locking, without accepting the rejected building or generating a call loop.
  const pick=await fresh();
  await pick.click('#btnPick');
  await mapClick(pick);
  await pick.waitForFunction(()=>state.location?.selectedByPin === true);
  await mismatch(pick);
  const beforeCancel=calls, oldLng=await pick.evaluate(()=>state.location.lng);
  await pick.click('#btnSolarPickRetry');
  assert.equal(await pick.evaluate(()=>pin.picking),true);
  await pick.keyboard.press('Escape');
  assert.equal(await pick.evaluate(()=>pin.picking),false);
  assert.equal(await pick.evaluate(()=>pin.afterLock),null);
  await pick.click('#btnPick');
  await mapClick(pick,-60,0);
  await pick.waitForFunction(lng=>state.location.lng !== lng && !pin.busy,oldLng);
  assert.equal(calls,beforeCancel,'A cancelled recovery must not attach its retry to a later ordinary pick.');
  await pick.click('#panelAuto > summary');
  await mismatch(pick);
  const beforePick=calls;
  responses.push(loc=>record(loc,'fixture/repicked-roof'));
  await pick.click('#btnSolarPickRetry');
  assert.equal(await pick.evaluate(()=>pin.picking),true);
  assert.equal(calls,beforePick,'Picking alone must not consume another API request.');
  await mapClick(pick,80,0);
  await pick.waitForFunction(()=>state.solar?.name === 'fixture/repicked-roof');
  assert.equal(calls,beforePick+1);
  assert.equal(await pick.evaluate(()=>pin.picking),false);
  assert(await pick.locator('#btnAuto').isEnabled());
  assert.equal(await pick.locator('#btnSolarPickRetry').count(),0);
  await pick.locator('#solarOut').scrollIntoViewIfNeeded();
  await pick.screenshot({path:path.join(artifacts,'repicked-recovery-desktop.png')});
  await pick.close();

  // Switching to manual tracing also cancels a roof lock whose reverse-geocoder
  // is already running. Its late completion cannot erase the user's new draft
  // or spend an automatic Solar retry for the abandoned pin.
  const inFlight=await fresh();
  await address(inFlight);
  await mismatch(inFlight);
  const beforeGeocodeCalls=calls;
  const originalLocation=await inFlight.evaluate(()=>({...state.location}));
  await inFlight.evaluate(()=>{
    const geocode=geocoder.geocode.bind(geocoder);
    geocoder.geocode=async request=>{
      const response=await geocode(request);
      if (!request.location) return response;
      return new Promise(resolve=>{window.__releaseRecoveryGeocode=()=>resolve(response);});
    };
  });
  await inFlight.click('#btnSolarPickRetry');
  await mapClick(inFlight,90,0);
  await inFlight.waitForFunction(()=>typeof window.__releaseRecoveryGeocode === 'function' && pin.busy);
  await inFlight.click('#panelAuto > summary');
  await inFlight.click('#btnSolarManual');
  assert.equal(await inFlight.evaluate(()=>pin.busy),false);
  for(const [x,y] of [[-65,-40],[65,-40]]) await mapClick(inFlight,x,y);
  const draftBefore=await inFlight.evaluate(()=>draft.points.map(point=>({lat:point.lat(),lng:point.lng()})));
  assert.equal(draftBefore.length,2);
  await inFlight.evaluate(()=>{
    window.__releaseRecoveryGeocode();
    return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  assert.deepEqual(await inFlight.evaluate(()=>({...state.location})),originalLocation,
    'An abandoned reverse-geocoder must not apply its old roof selection.');
  assert.equal(calls,beforeGeocodeCalls,'An abandoned roof lock must not trigger its Solar retry.');
  assert.equal(await inFlight.evaluate(()=>state.tool),'facet');
  assert.deepEqual(await inFlight.evaluate(()=>draft?.points.map(point=>({lat:point.lat(),lng:point.lng()}))),draftBefore,
    'The late roof-lock completion must preserve the manual draft.');
  for(const [x,y] of [[65,40],[-65,40]]) await mapClick(inFlight,x,y);
  await inFlight.click('#btnFinish');
  assert.equal(await inFlight.evaluate(()=>state.facets.length),1);
  assert.equal(await inFlight.evaluate(()=>pathToLiteral(state.facets[0].shape).length),4);
  assert(await inFlight.locator('#btnSolar').isEnabled());
  await inFlight.screenshot({path:path.join(artifacts,'cancelled-geocode-manual-recovery.png')});
  await inFlight.close();

  // Coverage/network failures are recoverable as well. Retry uses the existing
  // pin, while an old pending failure cannot replace a newly selected property.
  const retry=await fresh();
  await address(retry);
  responses.push({status:404,body:{error:{message:'No coverage'}}});
  await retry.click('#btnSolar');
  await retry.locator('#btnSolarRetry').waitFor({state:'visible'});
  assert.match(await retry.locator('#solarOut').innerText(),/no solar api coverage/i);
  const beforeRetry=calls;
  responses.push(loc=>record(loc,'fixture/retried-roof'));
  await retry.click('#btnSolarRetry');
  await retry.waitForFunction(()=>state.solar?.name === 'fixture/retried-roof');
  assert.equal(calls,beforeRetry+1);
  assert(await retry.locator('#btnAuto').isEnabled());
  let releaseOld;
  responses.push(()=>new Promise(resolve=>{releaseOld=()=>resolve({status:404,body:{error:{message:'Old property has no coverage'}}});}));
  await retry.click('#btnSolar');
  await retry.waitForFunction(()=>document.querySelector('#solarOut').textContent.includes('Fetching'));
  assert.equal(await retry.locator('#btnSolar').innerText(),'Getting roof data...');
  assert(await retry.locator('#btnSolar').isDisabled());
  await retry.fill('#address','30.301, -81.601');
  await retry.click('#btnGo');
  await retry.waitForFunction(()=>state.location?.lat === 30.301);
  assert.equal(await retry.locator('#btnSolar').innerText(),'Get roof data',
    'Moving to a new location must reset the abandoned lookup button label immediately.');
  assert(await retry.locator('#btnSolar').isEnabled());
  const oldResponse=retry.waitForResponse(response=>response.url().includes('solar.googleapis.com') && response.status() === 404);
  releaseOld();
  await oldResponse;
  // A local round trip ensures the response handler has had a turn to run.
  await retry.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await retry.locator('#btnSolarRetry').count(),0,'A stale failure must not insert recovery for a different property.');
  assert.doesNotMatch(await retry.locator('#solarOut').innerText(),/Old property|No Solar API coverage/);
  assert(await retry.locator('#btnSolar').isEnabled());
  assert.equal(await retry.locator('#btnSolar').innerText(),'Get roof data');
  assert(await retry.locator('#btnAuto').isDisabled());
  await retry.close();

  assert.equal(responses.length,0);
  assert.deepEqual(errors,[],'Recovery must not introduce browser exceptions.');
  console.log('Chromium: ROOFTOP and explicit-pin mismatch recovery, real manual facet clicks, desktop/mobile action layout, preserved edits/drafts, cancelled-pick/geocoder isolation, stale Solar removal, single repick retry, 404 retry and stale response/button-label isolation passed.');
  console.log('Illustrative browser screenshots: '+artifacts);
} finally {
  await browser?.close();
  await server.close();
}
