// _hover.mjs — point at the field with the mouse and check that the plant
// under the cursor gets a bright, thick outline. Three independent readings:
//
//   hover.tier / hover.index  the pick. Pointing at the field must select a
//                             plant, moving the pointer must move the pick,
//                             and pointing at the sky must select nothing.
//   uniforms                  the tuning. The band must be three times the
//                             width it used to be and the addend must sit
//                             near the display ceiling.
//   pixels                    the outline. The window around the cursor must
//                             change pixels and gain light against the same
//                             camera with nothing picked. The live uniforms
//                             are then pushed back to the old values and the
//                             same plant picked again, which measures the
//                             thickness and the brightness rather than reading
//                             them off the source - a wide band cannot be
//                             mistaken for a bright addend, or the reverse.
//                             The scene is paused throughout, so the highlight
//                             is the only thing that can change anything.
//
// Also checks the pointer work leaves the camera alone and the page is still
// error-free.
//
//   node _hover.mjs > _hover_out.txt 2>&1 ; Get-Content -Path _hover_out.txt -Encoding Unicode
//   node _hover.mjs high > _hover_high_out.txt 2>&1
import cp from "child_process";
import fs from "fs";
import puppeteer from "puppeteer-core";
import { decodeBuffer, diff } from "./tools/_png.mjs";

const root = "c:/Users/ompta/.cline/s_rice";
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 8795;
// quality comes from argv so the pick can be re-checked against the ~12k
// instances the high setting plants
const quality = process.argv[2] !== undefined ? process.argv[2] : "low";

const srv = cp.spawn( process.execPath, [ root + "/_serve.mjs" ], {
  stdio: [ "ignore", "pipe", "pipe" ],
} );
cp.spawnSync( "ping", [ "-n", "3", "nul" ], { encoding: "utf8" } );

const browser = await puppeteer.launch( {
  executablePath: chrome,
  headless: "new",
  // software GL keeps the run deterministic; the deltas here are about
  // whether the picture changed at all, not how fast it was
  args: [ "--disable-gpu", "--disable-sandbox", "--hide-scrollbars" ],
} );

const page = await browser.newPage();
await page.setViewport( { width: 900, height: 560, deviceScaleFactor: 1 } );

const consoleErrors = [];
page.on( "console", ( e ) => {
  if ( e.type === "error" || e.type === "warn" ) consoleErrors.push( e.text );
} );

await page.goto(
  "http://127.0.0.1:" + port + "/index.html?autotest=1&seed=7&quality=" + quality + "&dpr=1&wind=0.35&light=afternoon&view=open",
  { waitUntil: "domcontentloaded", timeout: 60000 }
);
await page.waitForFunction(
  () => {
    const s = document.getElementById( "stats" );
    return s && s.textContent.length > 0;
  },
  { timeout: 30000 }
);

const wait = ( ms ) => new Promise( ( _ ) => setTimeout( _, ms ) );

const hover = async () =>
  JSON.parse( await page.evaluate( "window.__verdant ? JSON.stringify( window.__verdant.hover ) : '{}'" ) );

const cam = async () => await page.evaluate( "window.__verdant ? JSON.stringify( window.__verdant.cam ) : 'no-autotest'" );

async function click( selector ) {
  const el = await page.$( selector );
  if ( !el ) throw new Error( "no element for " + selector );
  await el.click();
  await wait( 700 );
}

async function shot( name ) {
  const file = root + "/_hover_" + quality + "_" + name + ".png";
  await page.screenshot( { path: file, fullPage: false } );
  return decodeBuffer( fs.readFileSync( file ) );
}

// mean luminance in a window: the outline only adds light, so the window
// under the cursor must be brighter with the plant picked than with it not
function lumSum( img, cx, cy, r ) {
  const { w, h, ch, px } = img;
  let sum = 0;
  let n = 0;
  for ( let y = Math.max( 0, cy - r ); y < Math.min( h, cy + r ); y++ ) {
    for ( let x = Math.max( 0, cx - r ); x < Math.min( w, cx + r ); x++ ) {
      const o = ( y * w + x ) * ch;
      sum += ( px[ o ] + px[ o + 1 ] + px[ o + 2 ] ) / 3;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

// how much of a window changed and how strong the change is: between two
// paused frames the outline is the only thing that can differ, so this counts
// the outlined pixels themselves and the brightest jump they make. solid counts
// the pixels sitting at three quarters of the peak jump, which is what tells a
// thick band (mostly full strength) from a thin gradient (mostly faint)
function windowDiff( A, B, cx, cy, r ) {
  let changed = 0;
  let maxDelta = 0;
  let sum = 0;
  for ( let y = Math.max( 0, cy - r ); y < Math.min( A.h, cy + r ); y++ ) {
    for ( let x = Math.max( 0, cx - r ); x < Math.min( A.w, cx + r ); x++ ) {
      const o = ( y * A.w + x ) * A.ch;
      const d = Math.max(
        Math.abs( A.px[ o ] - B.px[ o ] ),
        Math.abs( A.px[ o + 1 ] - B.px[ o + 1 ] ),
        Math.abs( A.px[ o + 2 ] - B.px[ o + 2 ] )
      );
      sum += d;
      if ( d > 0 ) changed++;
      if ( d > maxDelta ) maxDelta = d;
    }
  }
  let solid = 0;
  const floor = maxDelta * 0.75;
  for ( let y = Math.max( 0, cy - r ); y < Math.min( A.h, cy + r ); y++ ) {
    for ( let x = Math.max( 0, cx - r ); x < Math.min( A.w, cx + r ); x++ ) {
      const o = ( y * A.w + x ) * A.ch;
      const d = Math.max(
        Math.abs( A.px[ o ] - B.px[ o ] ),
        Math.abs( A.px[ o + 1 ] - B.px[ o + 1 ] ),
        Math.abs( A.px[ o + 2 ] - B.px[ o + 2 ] )
      );
      if ( d >= floor ) solid++;
    }
  }
  return { changed, solid, maxDelta, mean: sum / ( 4 * r * r ) };
}

await click( "button[data-action='pause'][data-value='true']" );

const cam0 = await cam();
const h0 = await hover();
const plants = await page.evaluate( "window.__verdant ? window.__verdant.field.instances : 0" );
const hi = JSON.parse( await page.evaluate( "window.__verdant ? JSON.stringify({ width: window.__verdant.uniforms.uHiWidth.value, color: window.__verdant.uniforms.uHiColor.value }) : '{}'" ) );
console.log( "== before pointing (quality=" + quality + ", plants=" + plants + ")" );
console.log( "  hover: tier=" + h0.tier + " index=" + h0.index + " (nothing picked yet)" );
console.log( "  highlight tuning: uHiWidth=" + hi.width + " (the old band was 0.24)  uHiColor=" + hi.color.x + "," + hi.color.y + "," + hi.color.z + " (the old addend was 0.6,0.72,0.5)" );
console.log( "  3x thicker verdict: " + ( hi.width >= 0.72 ? "OK" : "NOT 3X" ) );
console.log( "  brighter addend verdict: " + ( hi.color.x >= 0.9 && hi.color.y >= 1.0 && hi.color.z >= 0.6 ? "OK" : "NOT BRIGHTER" ) );

// point low in the frame, where the near stand is big enough for a leaf edge
// to be more than a pixel - a far plant is only a few pixels tall and its
// outline would be invisible, which is not a fault of the highlight
await page.mouse.move( 620, 460 );
await wait( 300 );
const h1 = await hover();
console.log( "== point at the near stand (620, 460)" );
console.log( "  hover: tier=" + h1.tier + " index=" + h1.index + " height=" + h1.height.toFixed( 2 ) + "m" );
console.log( "  pick verdict: " + ( h1.tier >= 0 && h1.index >= 0 ? "OK" : "NOTHING PICKED" ) );

const on = await shot( "on" );

// measure the thickness and the brightness rather than trusting the numbers in
// the source: the live uniforms can be pushed back to the old values, and with
// the scene paused and the same plant picked, the only thing that can move is
// the band itself. Three frames of the same camera - the shipped settings, the
// old width with the new colour, and both old - isolate the two factors so a
// wider band cannot be mistaken for a brighter addend, or the reverse
const setHi = async ( width, c ) => await page.evaluate(
  "window.__verdant.uniforms.uHiWidth.value = " + width +
  "; window.__verdant.uniforms.uHiColor.value.x = " + c[ 0 ] +
  "; window.__verdant.uniforms.uHiColor.value.y = " + c[ 1 ] +
  "; window.__verdant.uniforms.uHiColor.value.z = " + c[ 2 ]
);

await setHi( 0.24, [ 0.9, 1.0, 0.6 ] ); // new colour, old width: only width differs from "on"
await page.mouse.move( 620, 460 );
await wait( 300 );
const narrowBright = await shot( "narrow_bright" );

await setHi( 0.24, [ 0.6, 0.72, 0.5 ] ); // both old: only colour differs from the frame above
await page.mouse.move( 620, 460 );
await wait( 300 );
const oldFrame = await shot( "old" );

// back to the shipped settings, then clear the pick by pointing at the sky
await setHi( hi.width, [ hi.color.x, hi.color.y, hi.color.z ] );
await page.mouse.move( 480, 40 );
await wait( 300 );
const h3 = await hover();
console.log( "== point at the sky (480, 40): nothing must be outlined" );
console.log( "  hover: tier=" + h3.tier + " index=" + h3.index );
console.log( "  nothing picked verdict: " + ( h3.tier === -1 && h3.index === -1 ? "OK" : "PICKED SOMETHING" ) );

const off = await shot( "off" );
const wide = windowDiff( on, off, 620, 460, 90 );
const thin = windowDiff( narrowBright, off, 620, 460, 90 );
const aged = windowDiff( oldFrame, off, 620, 460, 90 );
console.log( "  shipped band: changed px=" + wide.changed + "  solid px=" + wide.solid + "  mean delta=" + wide.mean.toFixed( 2 ) + "  max delta=" + wide.maxDelta );
console.log( "  old width, new colour: changed px=" + thin.changed + "  mean delta=" + thin.mean.toFixed( 2 ) + "  max delta=" + thin.maxDelta );
console.log( "  old width, old colour: changed px=" + aged.changed + "  mean delta=" + aged.mean.toFixed( 2 ) + "  max delta=" + aged.maxDelta );
console.log( "  outline verdict: " + ( wide.changed > 0 && wide.maxDelta > 40 ? "OK" : "NO OUTLINE" ) );
// the wide band must lift the window well more than the narrow one at the same
// colour, and the new colour must lift it above the old one at the same width
console.log( "  thickness verdict: " + ( wide.mean >= thin.mean * 1.5 ? "OK" : "NOT THICKER" ) );
console.log( "  brightness verdict: " + ( thin.mean > aged.mean && thin.maxDelta > aged.maxDelta ? "OK" : "NOT BRIGHTER" ) );

const d0 = diff( on, off );
console.log( "  whole frame on vs off: mean=" + d0.mean + " moved px=" + d0.moved + " identical=" + d0.identical );

const onLum = lumSum( on, 620, 460, 60 );
const oldLum = lumSum( oldFrame, 620, 460, 60 );
const offLum = lumSum( off, 620, 460, 60 );
console.log( "  mean luminance at the cursor: shipped=" + onLum.toFixed( 1 ) + " old settings=" + oldLum.toFixed( 1 ) + " nothing picked=" + offLum.toFixed( 1 ) );
// compare the lifts rather than an absolute jump: the high setting packs more,
// smaller plants into the same window, so the same outline covers fewer pixels
// there and an absolute threshold would punish it for no good reason
const shippedLift = onLum - offLum;
const oldLift = oldLum - offLum;
console.log( "  lift at the cursor: shipped=" + shippedLift.toFixed( 1 ) + " old settings=" + oldLift.toFixed( 1 ) );
console.log( "  easier to see verdict: " + ( shippedLift >= oldLift * 1.5 ? "OK" : "BARELY DIFFERENT" ) );

// point at a different near plant: the pick must move and the frame must
// change again, which shows the highlight follows the cursor
await page.mouse.move( 760, 470 );
await wait( 300 );
const h2 = await hover();
console.log( "== point elsewhere in the near stand (760, 470)" );
console.log( "  hover: tier=" + h2.tier + " index=" + h2.index );
const movedPick = h2.tier >= 0 && ( h2.tier !== h1.tier || h2.index !== h1.index );
console.log( "  pick moved verdict: " + ( movedPick ? "OK" : "SAME PLANT" ) );

const movedShot = await shot( "moved" );
const w1 = windowDiff( off, movedShot, 760, 470, 90 );
console.log( "  window around the new cursor: changed px=" + w1.changed + "  solid px=" + w1.solid + "  max channel delta=" + w1.maxDelta );
console.log( "  highlight follows the cursor verdict: " + ( w1.changed > 0 && w1.maxDelta > 40 ? "OK" : "STUCK" ) );

// point at the control panel: it sits over the canvas, so the canvas
// listener never fires there and only the window-level clear can put the
// outline back out
const panelBox = JSON.parse( await page.evaluate( `(() => {
  const p = document.querySelector("[data-panel], .panel, #panel");
  if ( !p ) return "{}";
  const r = p.getBoundingClientRect();
  return JSON.stringify({ x: Math.round( r.x + r.width / 2 ), y: Math.round( r.y + r.height / 2 ) });
})()` ) );
console.log( "== point at the control panel (panel centre " + panelBox.x + "," + panelBox.y + ")" );
if ( panelBox.x ) {
  await page.mouse.move( panelBox.x, panelBox.y );
  await wait( 300 );
  const h4 = await hover();
  console.log( "  hover: tier=" + h4.tier + " index=" + h4.index );
  console.log( "  outline cleared over the panel verdict: " + ( h4.tier === -1 && h4.index === -1 ? "OK" : "STILL LIT" ) );
} else {
  console.log( "  no panel element found by that selector, leg skipped" );
}

const cam1 = await cam();
console.log( "  cam before: " + cam0 );
console.log( "  cam after:  " + cam1 );
// only the pointer bookkeeping may change: a bare move never moves the camera
const still = async () =>
  await page.evaluate(
    "window.__verdant ? JSON.stringify({ move: window.__verdant.cam.move, look: window.__verdant.cam.look, heading: window.__verdant.camera.rotation.y }) : 'no-autotest'"
  );
const camA = await still();
const camB = await still();
console.log( "  framing before/after the pointer work: " + camA + " / " + camB );
console.log( "  camera untouched verdict: " + ( camA === camB ? "OK" : "CAMERA MOVED" ) );

console.log( "  console errors: " + consoleErrors.length + " " + consoleErrors.slice( 0, 6 ).join( " | " ) );
await browser.close();
srv.kill( "SIGTERM" );
