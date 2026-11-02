// _dragdir.mjs — ground truth for the drag direction. A rightward drag should
// turn the camera right, which on screen means the world slides LEFT. Two
// independent readings settle the sign: the camera's own basis from its world
// matrix (forward . old right > 0 means it turned right) and the sun bloom's
// screen column (a smaller x means the picture slid left).
import cp from "child_process";
import fs from "fs";
import puppeteer from "puppeteer-core";
import { decodeBuffer } from "./tools/_png.mjs";

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
  args: [ "--disable-gpu", "--disable-sandbox", "--hide-scrollbars" ],
} );

const page = await browser.newPage();
await page.setViewport( { width: 900, height: 560, deviceScaleFactor: 1 } );
await page.goto(
  "http://127.0.0.1:" + port + "/index.html?autotest=1&seed=7&quality=low&dpr=1&wind=0&paused=1&light=morning&view=open",
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

// the camera basis straight from its world matrix: column 0 is the camera's
// own right, column 2 is its backward, so forward is -column 2
const basis = async () =>
  JSON.parse( await page.evaluate( `(() => {
  const m = window.__verdant.camera.matrixWorld.elements;
  return JSON.stringify({ right: [ m[0], m[1], m[2] ], fwd: [ -m[8], -m[9], -m[10] ]});
})()` ) );

const look = async () =>
  JSON.parse( await page.evaluate( "window.__verdant ? JSON.stringify({ yaw: window.__verdant.cam.look.yaw, heading: window.__verdant.camera.rotation.y }) : '{}'" ) );

// the sun bloom is the brightest pixel in the SKY band - searching the whole
// frame finds the panel's bright handle, which is DOM and never slides
const sunSpot = ( img ) => {
  const { w, h, ch, px } = img;
  let best = -1;
  let bx = -1;
  let by = -1;
  for ( let y = 0; y < Math.floor( h * 0.35 ); y += 2 ) {
    for ( let x = 0; x < w; x += 2 ) {
      const o = y * w * ch + x * ch;
      const v = px[ o ] + px[ o + 1 ] + px[ o + 2 ];
      if ( v > best ) {
        best = v;
        bx = x;
        by = y;
      }
    }
  }
  return { x: bx, y: by };
};

async function shot( name ) {
  const file = root + "/_dragdir_" + name + ".png";
  await page.screenshot( { path: file, fullPage: false } );
  return decodeBuffer( fs.readFileSync( file ) );
}

async function click( selector ) {
  const el = await page.$( selector );
  if ( !el ) throw new Error( "no element for " + selector );
  await el.click();
  await wait( 700 );
}

await click( "button[data-action='pause'][data-value='true']" );

const b0 = await basis();
const l0 = await look();
const base = await shot( "base" );
const sun0 = sunSpot( base );
console.log( "== baseline (paused, so only the camera can change the frame)" );
console.log( "  look.yaw=" + l0.yaw.toFixed( 3 ) + " heading=" + l0.heading.toFixed( 3 ) );
console.log( "  fwd=" + b0.fwd.map( ( v ) => v.toFixed( 3 ) ).join( "," ) + "  right=" + b0.right.map( ( v ) => v.toFixed( 3 ) ).join( "," ) );
console.log( "  sun bloom at x=" + sun0.x + " y=" + sun0.y );

// drag right with the button held, well clear of the panel
await page.mouse.move( 400, 200 );
await page.mouse.down();
await page.mouse.move( 700, 200, { steps: 15 } );
await page.mouse.up();
await wait( 600 );

const b1 = await basis();
const l1 = await look();
const after = await shot( "right" );
const sun1 = sunSpot( after );
const turn = b1.fwd[0] * b0.right[0] + b1.fwd[1] * b0.right[1] + b1.fwd[2] * b0.right[2];
console.log( "== after a drag RIGHT (400 -> 700 px): want the scenery to slide RIGHT" );
console.log( "  look.yaw=" + l1.yaw.toFixed( 3 ) + " heading=" + l1.heading.toFixed( 3 ) );
console.log( "  sun slid " + ( sun1.x - sun0.x ) + " px  (positive = picture slid RIGHT)" );
console.log( "  newFwd . oldRight = " + turn.toFixed( 3 ) + "  (negative = camera turned LEFT)" );
console.log( "  verdict right drag: " + ( turn < 0 ? "OK" : "WRONG WAY" ) );

// drag back left: the scenery must slide left and the camera must turn right
await page.mouse.down();
await page.mouse.move( 400, 200, { steps: 15 } );
await page.mouse.up();
await wait( 600 );

const b2 = await basis();
const l2 = await look();
const back = await shot( "left" );
const sun2 = sunSpot( back );
const turn2 = b2.fwd[0] * b1.right[0] + b2.fwd[1] * b1.right[1] + b2.fwd[2] * b1.right[2];
console.log( "== after a drag LEFT (700 -> 400 px): want the scenery to slide LEFT" );
console.log( "  look.yaw=" + l2.yaw.toFixed( 3 ) + " heading=" + l2.heading.toFixed( 3 ) );
console.log( "  sun slid " + ( sun2.x - sun1.x ) + " px  (negative = picture slid LEFT)" );
console.log( "  newFwd . oldRight = " + turn2.toFixed( 3 ) + "  (positive = camera turned RIGHT)" );
console.log( "  verdict left drag: " + ( turn2 > 0 ? "OK" : "WRONG WAY" ) );

// spin far right: the old clamp stopped the view at 66 deg, so a long drag
// must turn well past that and still keep the heading inside -PI..PI
await page.mouse.move( 40, 200 );
await page.mouse.down();
await page.mouse.move( 860, 200, { steps: 30 } );
await page.mouse.up();
await wait( 600 );

const b3 = await basis();
const l3 = await look();
const dot3 = b3.fwd[0] * b2.fwd[0] + b3.fwd[1] * b2.fwd[1] + b3.fwd[2] * b2.fwd[2];
const turn3 = Math.acos( Math.max( -1, Math.min( 1, dot3 ) ) ) * 180 / Math.PI;
console.log( "== spin far RIGHT (40 -> 860 px): must turn past the old 66 deg limit" );
console.log( "  look.yaw=" + l3.yaw.toFixed( 3 ) + " heading=" + l3.heading.toFixed( 3 ) );
console.log( "  turned " + turn3.toFixed( 0 ) + " deg  (folded into -180..180, never clamped)" );
console.log( "  verdict unlimited spin: " + ( turn3 > 66 && Math.abs( l3.yaw ) <= Math.PI ? "OK" : "STILL CLAMPED" ) );

await browser.close();
srv.kill( "SIGTERM" );
