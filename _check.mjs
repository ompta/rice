// _check.mjs — start the static server, load the REAL page in headless Chrome,
// and read the live HUD back out of the DOM. This is the console-error and
// DOM-state harness: it proves the page boots, paints, and reports its own
// numbers (fps / draw calls / plants / wind) exactly as a user would see them.
//
//   node _check.mjs [label] [extra-query]
//
// Chrome's own --dump-dom CLI is unreliable on this machine (it dies on named-pipe
// errors), so the page is driven over the DevTools protocol with puppeteer instead.
import cp from "child_process";
import fs from "fs";
import puppeteer from "puppeteer-core";

const root = "c:/Users/ompta/.cline/s_rice";
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 8795;
const label = process.argv[2] || "check";
const extra = process.argv[3] || "quality=low&dpr=1&wind=0.42";

/* 1. boot the static server as a child process, keep it for the whole run */
const srv = cp.spawn( process.execPath, [ root + "/_serve.mjs" ], {
  stdio: [ "ignore", "pipe", "pipe" ],
} );
cp.spawnSync( "ping", [ "-n", "3", "nul" ], { encoding: "utf8" } );

const url = "http://127.0.0.1:" + port + "/index.html?autotest=1&" + extra;
console.log( "== " + label + " url=" + url );

/* 2. load it over CDP. --disable-gpu pins the run to Chrome's own SwiftShader,
   so the measurement is deterministic across machines. */
const browser = await puppeteer.launch( {
  executablePath: chrome,
  headless: "new",
  args: [ "--disable-gpu", "--disable-sandbox", "--hide-scrollbars" ],
} );
const page = await browser.newPage();
await page.setViewport( { width: 1280, height: 800, deviceScaleFactor: 1 } );

/* 3. keep every console.* line the page emits: three.js reports shader
   compile failures through console.error, so this is where GLSL bugs show up */
const msgs = [];
const pick = ( obj, key ) => {
  try {
    const v = obj[ key ];
    return typeof v === "function" ? String( obj[ key ]() ) : String( v );
  } catch ( _ ) {
    return "";
  }
};
page.on( "console", ( m ) => {
  msgs.push( pick( m, "type" ) + " " + pick( m, "text" ) );
} );
page.on( "pageError", ( e ) => {
  msgs.push( "pageError " + ( e && ( e.message || e ) ) );
} );

await page.goto( url, { waitUntil: "domcontentloaded", timeout: 60000 } );
await page.waitForFunction(
  () => {
    const s = document.getElementById( "stats" );
    return s && s.textContent.length > 0;
  },
  { timeout: 30000 }
);

/* 4. dump the live DOM so the run is inspectable after the fact */
const dom = await page.content();
fs.writeFileSync( root + "/_dom_" + label + ".html", dom );
console.log( "  dom bytes=" + dom.length );

const read = ( expr ) => page.evaluate( expr );

console.log( "  #stats: " + await read( "document.getElementById('stats') ? document.getElementById('stats').textContent : '(no element)'" ) );
console.log( "  #err:   " + await read( "document.getElementById('err') ? document.getElementById('err').textContent : '(no element)'" ) );
console.log( "  #move:  " + await read( "document.getElementById('move-readout') ? document.getElementById('move-readout').textContent : '(no element)'" ) );

const cv = /<canvas[^>]*>/.exec( dom );
console.log( "  canvas: " + ( cv ? cv[ 0 ].replace( /\s+/g, " " ) : "none" ) );

const st = await read(
  "window.__verdant ? JSON.stringify({ wind: window.__verdant.state.wind, light: window.__verdant.state.light, view: window.__verdant.state.view, paused: window.__verdant.state.paused, walk: window.__verdant.state.walk, move: window.__verdant.cam.move, look: window.__verdant.cam.look, plants: window.__verdant.field.instances, triangles: window.__verdant.field.triangles, tiers: window.__verdant.field.tiers.length, calls: window.__verdant.renderer.info.render.calls }) : 'no-autotest'"
);
console.log( "  autotest state: " + st );

const bad = String( dom ).match( /(Uncaught|SyntaxError|ReferenceError|TypeError)[^\n<]{0,160}/g );
console.log( "  dom errors: " + ( bad ? bad.slice( 0, 6 ).join( " | " ) : "none" ) );

const noisy = msgs.filter( ( m ) => /error|warn/i.test( m ) );
console.log( "  console messages: " + msgs.length + " total, " + noisy.length + " error/warn" );
for ( const m of noisy.slice( 0, 12 ) ) console.log( "    " + m.replace( /\s+/g, " " ).slice( 0, 300 ) );

await browser.close();
srv.kill( "SIGTERM" );

