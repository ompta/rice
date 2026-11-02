// _shot.mjs — headless-Chrome screenshots of the REAL page, then numeric
// analysis of the PNG bytes: how much of the frame is sky, where the horizon
// sits, per-band colour statistics, and how much the image changed when the
// wind changed (motion proof). Deterministic: --disable-gpu pins the run to
// Chrome's own SwiftShader, so the same machine gets the same numbers.
//
// Capture path: puppeteer (CDP), not Chrome's --screenshot flag. On this
// machine the CLI flag writes a PNG whose canvas area is black — the compositor
// never gets the WebGL layer — while CDP capture shows the scene. The sibling
// project used the CLI flag successfully; here it does not, so the harness
// drives the browser instead and keeps the same numeric analysis.
//
//   node _shot.mjs
import puppeteer from "puppeteer-core";
import cp from "child_process";
import fs from "fs";
import { decodePng, stats, ascii, diff } from "./tools/_png.mjs";

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
  // Software GL: the only deterministic capture path on this machine.
  args: [ "--disable-gpu", "--disable-sandbox", "--hide-scrollbars" ],
} );

const shots = [
  { name: "a", q: "seed=7&quality=low&dpr=1&wind=0.35&light=golden&view=open" },
  { name: "b", q: "seed=7&quality=low&dpr=1&wind=0.95&light=golden&view=open" },
  { name: "c", q: "seed=7&quality=low&dpr=1&wind=0.35&light=morning&view=among" },
];

const hud = {};
const images = {};

for ( const s of shots ) {
  const out = root + "/_shot_" + s.name + ".png";
  if ( fs.existsSync( out ) ) fs.unlinkSync( out );
  const page = await browser.newPage();
  await page.setViewport( { width: 800, height: 500, deviceScaleFactor: 1 } );
  await page.goto( "http://127.0.0.1:" + port + "/index.html?autotest=1&" + s.q, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  } );
  // The HUD is written by the render loop, so waiting for it means the scene
  // built and at least one frame rendered.
  await page.waitForFunction(
    () => {
      const el = document.getElementById( "stats" );
      return el && el.textContent.length > 0;
    },
    { timeout: 30000 }
  );
  hud[ s.name ] = await page.evaluate( () => document.getElementById( "stats" ).textContent );
  hud[ s.name + "_err" ] = await page.evaluate( () => document.getElementById( "err" ).textContent );
  await page.screenshot( { path: out } );
  await page.close();
}

await browser.close();
srv.kill( "SIGTERM" );

for ( const s of shots ) {
  const path = root + "/_shot_" + s.name + ".png";
  if ( !fs.existsSync( path ) ) {
    console.log( s.name + ": NO PNG" );
    continue;
  }
  const img = await decodePng( path );
  images[ s.name ] = img;
  const st = stats( img );
  console.log( "== shot " + s.name + " (" + s.q + ")" );
  console.log( "  size=" + img.w + "x" + img.h + " ch=" + img.ch + " distinct=" + st.distinct );
  console.log( "  horizon row=" + st.horizonRow + " (" + st.horizonFrac + " of height)" );
  console.log( "  green fraction=" + st.greenFrac + " brightest=" + st.brightest + " @" + st.brightestColor );
  for ( let b = 0; b < st.bands.length; b++ ) console.log( "  band " + b + " mean=" + st.bands[ b ].join( "," ) );
  if ( s.name === "a" ) console.log( "  ascii:\n" + ascii( img ) );
  console.log( "  hud=" + hud[ s.name ] + " err=" + hud[ s.name + "_err" ] );
}

if ( images.a && images.b ) {
  const d = diff( images.a, images.b );
  console.log( "== wind delta a->b: mean abs diff=" + d.mean + " moved px=" + d.moved + " identical=" + d.identical );
}
if ( images.a && images.c ) {
  const d = diff( images.a, images.c );
  console.log( "== light+view delta a->c: mean abs diff=" + d.mean + " moved px=" + d.moved + " identical=" + d.identical );
}
