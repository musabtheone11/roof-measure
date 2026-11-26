import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {installOfflineMap} from './offline-map.mjs';
import {testServer} from './ui-test-server.mjs';

const server = await testServer(process.argv[2]);
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || chromium.executablePath()});
  const context = await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:2});
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(server.baseURL).origin
    ? route.continue() : route.abort());
  await context.addInitScript(installOfflineMap);
  const page = await context.newPage();
  await page.goto(server.baseURL);
  await page.evaluate(() => {
    const pane = document.createElement('div');
    document.body.append(pane);
    // Only the projection is synthetic. LabelLayer measures real rendered
    // DOM rectangles with the production fonts, padding and transforms.
    google.maps.OverlayView = class {
      setMap() { this.onAdd(); }
      getPanes() { return {floatPane:pane}; }
      getProjection() { return {fromLatLngToDivPixel:q=>({x:q.lng(),y:q.lat()})}; }
    };
    initMap();
    labels.setItems([{lng:210,lat:100,html:'Priority roof label',priority:200},
      {lng:209,lat:100,html:'Overlapping outline label',priority:40},
      {lng:410,lat:100,html:'Separate facet',priority:40}]);
  });
  assert.equal(await page.locator('.labels').getAttribute('data-hidden-labels'),'1');
  assert.deepEqual(await page.locator('.labels .lbl').allTextContents(),['Priority roof label','Separate facet']);

  await page.click('#panelAITrace > summary');
  await page.click('#btnOpenAITrace');
  const png = await page.evaluate(() => {
    const image=document.createElement('canvas');image.width=320;image.height=180;
    return image.toDataURL('image/png').split(',')[1];
  });
  await page.setInputFiles('#aiFile',{name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>rmAIReview.snapshot().sourceReady);
  // Letterboxing, rescaling and client offsets are deliberately present.
  await page.addStyleTag({content:'#aiCanvas{width:480px;height:330px;max-width:none;max-height:none;object-fit:contain}'});
  await page.click('#aiTraceOutline');
  const box = await page.locator('#aiCanvas').boundingBox();
  const scale=1.5, top=box.y+30, left=box.x;
  for (const [x,y] of [[30,40],[35,40],[120,90],[30,100]]) await page.mouse.click(left+x*scale,top+y*scale);
  await page.click('#aiTraceDone');
  const before = await page.evaluate(()=>rmAIReview.snapshot().model.outline);
  // Both handles are in the 12 CSS-pixel hit radius; the second is closest.
  await page.mouse.move(left+35*scale,top+40*scale);
  await page.mouse.down();
  await page.mouse.move(left+45*scale,top+52*scale,{steps:3});
  await page.mouse.up();
  const after = await page.evaluate(()=>rmAIReview.snapshot().model.outline);
  assert.deepEqual(after[0],before[0]);
  assert(Math.abs(after[1][0]-45)<1 && Math.abs(after[1][1]-52)<1,JSON.stringify(after));
  console.log('Chromium: overlapping labels suppressed at fixed anchors, nearest vertex moved correctly at DPR 2 on a letterboxed canvas.');
} finally {
  await browser?.close();
  await server.close();
}
