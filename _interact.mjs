// _interact.mjs — puppeteer drives the REAL page: it clicks the buttons, drags
// the wind slider, and screenshots before/after so the harness can prove the
// controls changed the render (pixel deltas), not just the DOM.
//
//   node _interact.mjs
import cp from "child_process";
import fs from "fs";
import puppeteer from "puppeteer-core";
import { decodeBuffer, stats, diff } from "./tools/_png.mjs";

const root = "c:/Users/ompta/.cline/s_rice";
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 8795;

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
await page.goto( "http://127.0.0.1:" + port + "/index.html?autotest=1&seed=7&quality=low&dpr=1&wind=0.3&light=morning&view=open", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
} );

await page.waitForFunction(
  () => {
    const s = document.getElementById( "stats" );
    return s && s.textContent.length > 0;
  },
  { timeout: 30000 }
);

const readState = async () => await page.evaluate( "window.__verdant ? JSON.stringify( window.__verdant.state ) : 'no-autotest'" );
const readStats = async () => await page.evaluate( "document.getElementById('stats') ? document.getElementById('stats').textContent : ''" );
const readErr = async () => await page.evaluate( "document.getElementById('err') ? document.getElementById('err').textContent : ''" );

const report = [];
async function step( label, img ) {
  const st = stats( img );
  report.push( { label, horizonFrac: st.horizonFrac, greenFrac: st.greenFrac, distinct: st.distinct, brightest: st.brightestColor } );
  return st;
}

async function shot( name ) {
  const file = root + "/_interact_" + name + ".png";
  await page.screenshot( { path: file, fullPage: false } );
  return decodeBuffer( fs.readFileSync( file ) );
}

async function click( selector ) {
  const el = await page.$( selector );
  if ( !el ) throw new Error( "no element for " + selector );
  await el.click();
  await new Promise( ( _ ) => setTimeout( _, 700 ) );
}

async function dragWind( frac ) {
  const box = await page.evaluate( async () => {
    const r = document.getElementById( "wind-track" ).getBoundingClientRect();
    return { x: r.x, y: r.y + r.height / 2, w: r.width };
  } );
  await page.mouse.move( box.x + box.w * 0.3, box.y );
  await page.mouse.down();
  await page.mouse.move( box.x + box.w * frac, box.y, { steps: 8 } );
  await page.mouse.up();
  await new Promise( ( _ ) => setTimeout( _, 700 ) );
}

console.log( "== boot" );
console.log( "  stats: " + await readStats() );
console.log( "  state: " + await readState() );
console.log( "  err:   " + await readErr() );

const base = await shot( "base" );
await step( "base", base );

/* 1. wind slider: drag it hard right, the field must move */
await dragWind( 0.95 );
console.log( "  state after wind drag: " + await readState() );
const windy = await shot( "windy" );
const windDelta = diff( base, windy );
console.log( "  wind drag -> mean diff=" + windDelta.mean + " moved px=" + windDelta.moved );

/* 2. lighting: golden hour should repaint the whole frame */
await click( "button[data-action='light'][data-value='golden']" );
console.log( "  state after light click: " + await readState() );
const golden = await shot( "golden" );
const lightDelta = diff( windy, golden );
console.log( "  light click -> mean diff=" + lightDelta.mean + " moved px=" + lightDelta.moved );

/* 3. view: walking among the rice replaces the horizon with stalks */
await click( "button[data-action='view'][data-value='among']" );
console.log( "  state after view click: " + await readState() );
const among = await shot( "among" );
const viewDelta = diff( golden, among );
const amongStats = await step( "among", among );
console.log( "  view click -> mean diff=" + viewDelta.mean + " moved px=" + viewDelta.moved );

/* 4. pause: two frames of a frozen scene must be pixel-identical */
await click( "button[data-action='pause'][data-value='true']" );
console.log( "  state after pause: " + await readState() );
const p1 = await shot( "paused1" );
await new Promise( ( _ ) => setTimeout( _, 900 ) );
const p2 = await shot( "paused2" );
const paused = diff( p1, p2 );
console.log( "  paused pair -> mean diff=" + paused.mean + " moved px=" + paused.moved + " identical=" + paused.identical );

/* 5. resume: the same two frames must now differ */
await click( "button[data-action='pause'][data-value='false']" );
console.log( "  state after resume: " + await readState() );
const r1 = await shot( "resumed1" );
await new Promise( ( _ ) => setTimeout( _, 900 ) );
const r2 = await shot( "resumed2" );
const resumed = diff( r1, r2 );
console.log( "  resumed pair -> mean diff=" + resumed.mean + " moved px=" + resumed.moved );

/* 6. keyboard shortcuts also work: space toggles the pause */
await page.evaluate( () => {
  // the pause/resume buttons keep DOM focus, and a focused button re-fires its
  // click handler on Space - blur them first so the key means what it says
  for ( const el of document.querySelectorAll( "[data-action]" ) ) el.blur();
} );
await page.evaluate( () => {
  window.__keylog = [];
  window.addEventListener( "keydown", ( e ) => {
    window.__keylog.push( String( e.key ) + "|" + String( e.code ) );
  } );
} );
await page.focus( "body" );
await page.keyboard.press( "Space" );
await new Promise( ( _ ) => setTimeout( _, 600 ) );
console.log( "  delivered keydown: " + await page.evaluate( "JSON.stringify( window.__keylog )" ) );
console.log( "  state after space key: " + await readState() );
// plain arrows now walk, so the wind nudge is Shift+Arrow
await page.keyboard.down( "Shift" );
await page.keyboard.press( "ArrowRight" );
await page.keyboard.press( "ArrowRight" );
await page.keyboard.up( "Shift" );
await new Promise( ( _ ) => setTimeout( _, 600 ) );
console.log( "  state after two shift+arrow-right keys: " + await readState() );

const camState = async () => await page.evaluate(
  "window.__verdant ? JSON.stringify( { move: window.__verdant.cam.move, look: window.__verdant.cam.look, mouse: window.__verdant.cam.mouse, heading: window.__verdant.camera.rotation.y } ) : 'no-autotest'"
);

/* 7. camera walk: held keys glide the camera, so the framing must repaint */
await click( "button[data-action='pause'][data-value='false']" );
const walkBefore = await shot( "walk_before" );
console.log( "  cam before walk: " + await camState() );
await page.keyboard.down( "KeyW" );
await page.keyboard.down( "ArrowLeft" );
await new Promise( ( _ ) => setTimeout( _, 1400 ) );
await page.keyboard.up( "KeyW" );
await page.keyboard.up( "ArrowLeft" );
await new Promise( ( _ ) => setTimeout( _, 500 ) );
console.log( "  cam after W + arrow-left: " + await camState() );
const walkAfter = await shot( "walk_after" );
const walked = diff( walkBefore, walkAfter );
console.log( "  walk -> mean diff=" + walked.mean + " moved px=" + walked.moved );

/* 8. mouse: pause first so any pixel change can only be the camera or the
     hover outline. A bare move must leave the camera readout alone - the
     outline may still light a plant under the cursor, which is why the frame
     is no longer required to be pixel-identical; a held drag grabs the world,
     so drag right slides the scenery right (the camera turns LEFT, yaw
     increases) and dragging back left turns it right (yaw decreases). Yaw is
     unbounded, so these legs are free to pass the old +/-66 deg limit. The
     outline itself is covered by _hover.mjs, which points at the near stand */
await click( "button[data-action='pause'][data-value='true']" );
console.log( "  state before mouse work: " + await readState() );
const mouseBase = await shot( "mouse_base" );
const camBeforeBare = await camState();
await page.mouse.move( 450, 280 );
await page.mouse.move( 700, 180, { steps: 10 } );
await new Promise( ( _ ) => setTimeout( _, 500 ) );
const camAfterBare = await camState();
console.log( "  cam after bare hover: " + camAfterBare );
// the pointer bookkeeping is expected to change on a bare move; the framing
// (where the viewer stands and which way they look) must not
const framing = ( s ) => {
  const o = JSON.parse( s );
  return JSON.stringify( { move: o.move, look: o.look, heading: o.heading } );
};
const hovered = await shot( "hover" );
const hoverDelta = diff( mouseBase, hovered );
console.log( "  bare mouse move -> mean diff=" + hoverDelta.mean + " moved px=" + hoverDelta.moved + " identical=" + hoverDelta.identical );
console.log( "  bare move verdict: " + ( framing( camBeforeBare ) === framing( camAfterBare ) ? "camera untouched" : "CAMERA MOVED" ) );
await page.mouse.down();
await page.mouse.move( 780, 200, { steps: 12 } );
await page.mouse.up();
await new Promise( ( _ ) => setTimeout( _, 500 ) );
console.log( "  cam after drag right: " + await camState() );
const draggedRight = await shot( "drag_right" );
const rightDelta = diff( hovered, draggedRight );
console.log( "  drag right -> mean diff=" + rightDelta.mean + " moved px=" + rightDelta.moved );
await page.mouse.down();
await page.mouse.move( 320, 200, { steps: 14 } );
await page.mouse.up();
await new Promise( ( _ ) => setTimeout( _, 500 ) );
console.log( "  cam after drag left: " + await camState() );
const draggedLeft = await shot( "drag_left" );
const leftDelta = diff( draggedRight, draggedLeft );
console.log( "  drag left -> mean diff=" + leftDelta.mean + " moved px=" + leftDelta.moved );
await click( "button[data-action='pause'][data-value='false']" );
console.log( "  state after resume: " + await readState() );

/* 9. the camera row gates the walk: Hold still must freeze it, Walk must resume
     it, Reset framing must drop whatever the viewer walked to */
await click( "button[data-action='walk'][data-value='off']" );
console.log( "  state after hold still: " + await readState() );
await page.keyboard.down( "KeyW" );
await new Promise( ( _ ) => setTimeout( _, 900 ) );
await page.keyboard.up( "KeyW" );
await new Promise( ( _ ) => setTimeout( _, 400 ) );
console.log( "  cam while held still: " + await camState() );
await page.mouse.down();
await page.mouse.move( 600, 200, { steps: 10 } );
await page.mouse.up();
await new Promise( ( _ ) => setTimeout( _, 500 ) );
console.log( "  cam after drag while held still: " + await camState() );
await click( "button[data-action='walk'][data-value='on']" );
console.log( "  state after walk: " + await readState() );
await page.keyboard.down( "KeyS" );
await new Promise( ( _ ) => setTimeout( _, 900 ) );
await page.keyboard.up( "KeyS" );
await new Promise( ( _ ) => setTimeout( _, 400 ) );
console.log( "  cam after walking again: " + await camState() );
await click( "button[data-action='walk'][data-value='reset']" );
console.log( "  cam after reset framing: " + await camState() );
console.log( "  move readout: " + await page.evaluate( "document.getElementById('move-readout') ? document.getElementById('move-readout').textContent : ''" ) );

console.log( "== final" );
console.log( "  stats: " + await readStats() );
console.log( "  err:   " + await readErr() );
for ( const r of report ) {
  console.log( "  " + r.label + ": horizon=" + r.horizonFrac + " green=" + r.greenFrac + " distinct=" + r.distinct + " sun=" + r.brightest );
}

await browser.close();
srv.kill( "SIGTERM" );

