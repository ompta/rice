// _skill.mjs — click a plant, play the skill check, and check that a pass cuts
// it. Five independent readings:
//
//   skill.active / zone       the meter. The first click on a plant must arm it
//                             bound to that plant, the zone must sit inside the
//                             track with the lead margin on both sides, and the
//                             DOM meter must be visible and click-through.
//   gradeAt( pos )            the grading. Sample positions across the live zone
//                             must read great / good / normal / fail, so all
//                             four variants are proven without fighting the clock.
//   harvest / instanceMatrix  the outcome. A pass must shrink that instance
//                             toward its root (the up column gets shorter by the
//                             grade's stubble share) and a fail must leave it
//                             alone. A cut plant must never be picked again.
//   pixels                    the cut is visible: the window around the plant
//                             changes between before and after.
//   framing                   clicking never moves the camera. A click without
//                             movement is a press and release on the same pixel,
//                             so the drag look must stay put.
//
// The pass leg aims at the zone centre from the page's own clock, so the needle
// lands within a band half-width of it whatever the frame rate was; the miss leg
// never clicks at all, which is the one grade that needs no timing at all.
//
//   node _skill.mjs > _skill_out.txt 2>&1 ; Get-Content -Path _skill_out.txt -Encoding Unicode
import cp from "child_process";
import fs from "fs";
import puppeteer from "puppeteer-core";
import { decodeBuffer } from "./tools/_png.mjs";

const root = "c:/Users/ompta/.cline/s_rice";
const chrome = "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe";
const port = 8795;
const quality = process.argv[2] !== undefined ? process.argv[2] : "low";

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

const skillState = async () =>
  JSON.parse( await page.evaluate( "window.__verdant ? JSON.stringify( window.__verdant.skill ) : '{}'" ) );

const harvestState = async () =>
  JSON.parse( await page.evaluate( "window.__verdant ? JSON.stringify( window.__verdant.harvest ) : '{}'" ) );

const hoverState = async () =>
  JSON.parse( await page.evaluate( "window.__verdant ? JSON.stringify( window.__verdant.hover ) : '{}'" ) );

const framing = async () =>
  await page.evaluate(
    "window.__verdant ? JSON.stringify({ move: window.__verdant.cam.move, look: window.__verdant.cam.look, heading: window.__verdant.camera.rotation.y }) : 'no-autotest'"
  );

// the instance's up column length is the plant height, so a cut reads as that
// number getting shorter by the grade's stubble share
const plantState = async ( t, i ) =>
  JSON.parse( await page.evaluate( `(() => {
  const mesh = window.__verdant.field.tiers[${t}];
  const m = mesh.instanceMatrix.array;
  const o = ${i} * 16;
  return JSON.stringify({ up: Math.hypot( m[o+1], m[o+5], m[o+9] ), x: m[o+12], z: m[o+14], cut: mesh.userData.cut[${i}] });
})()` ) );

const meterDom = async () =>
  JSON.parse( await page.evaluate( `(() => {
  const el = document.getElementById("skill");
  if ( !el ) return "{}";
  const r = el.getBoundingClientRect();
  return JSON.stringify({
    hidden: el.hidden,
    x: Math.round( r.x ),
    y: Math.round( r.y ),
    w: Math.round( r.width ),
    verdict: document.getElementById("skill-verdict") ? document.getElementById("skill-verdict").textContent : "(none)",
  });
})()` ) );

// gradeAt against synthetic offsets from the live zone centre: this proves the
// four variants and their order without depending on when a click landed
const bandProbe = async ( offsets ) =>
  JSON.parse( await page.evaluate( `(() => {
  const s = window.__verdant.skill;
  const out = [];
  for ( const off of [${offsets}] ) out.push( window.__verdant.gradeAt( s.zone + off ) );
  return JSON.stringify( out );
})()` ) );

// how long to wait so the next click lands on the zone centre, measured against
// the page's own clock rather than the harness's
const msToCentre = async () =>
  JSON.parse( await page.evaluate(
    "window.__verdant ? String( Math.round( window.__verdant.skill.zone * window.__verdant.SKILL.sweep * 1000 - ( performance.now() - window.__verdant.skill.startedAt ) ) ) : '-1'"
  ) );

async function clickPanel( selector ) {
  const el = await page.$( selector );
  if ( !el ) throw new Error( "no element for " + selector );
  await el.click();
  await wait( 700 );
}

async function shot( name ) {
  const file = root + "/_skill_" + quality + "_" + name + ".png";
  await page.screenshot( { path: file, fullPage: false } );
  return decodeBuffer( fs.readFileSync( file ) );
}

// how much of a window changed and how strong the change is: the field is
// paused, so a cut stalk is the only thing that can differ between the two
function windowDiff( A, B, cx, cy, r ) {
  let changed = 0;
  let maxDelta = 0;
  for ( let y = Math.max( 0, cy - r ); y < Math.min( A.h, cy + r ); y++ ) {
    for ( let x = Math.max( 0, cx - r ); x < Math.min( A.w, cx + r ); x++ ) {
      const o = ( y * A.w + x ) * A.ch;
      const d = Math.max(
        Math.abs( A.px[ o ] - B.px[ o ] ),
        Math.abs( A.px[ o + 1 ] - B.px[ o + 1 ] ),
        Math.abs( A.px[ o + 2 ] - B.px[ o + 2 ] )
      );
      if ( d > 0 ) changed++;
      if ( d > maxDelta ) maxDelta = d;
    }
  }
  return { changed, maxDelta };
}

const variants = [ "fail", "normal", "good", "great" ];

// the field is paused so the only thing that can change a pixel window is the
// cut itself, and so the needle is the only moving thing under test
await clickPanel( "button[data-action='pause'][data-value='true']" );
const frame0 = await framing();
const harvest0 = await harvestState();
console.log( "  state before the click work: " + JSON.stringify( harvest0 ) );

/* ------------------------------------------------- miss: never play it --- */
console.log( "== miss leg: arm on (620,460) and never click again" );
await page.mouse.move( 620, 460 );
await wait( 300 );
const h1 = await hoverState();
console.log( "  hover: tier=" + h1.tier + " index=" + h1.index );
const p1 = h1.tier >= 0 ? await plantState( h1.tier, h1.index ) : null;
console.log( "  plant before: " + JSON.stringify( p1 ) );
const plain = await shot( "plain" );
await page.mouse.click( 620, 460 );
await wait( 150 );
const armed1 = await skillState();
console.log( "  armed: active=" + armed1.active + " tier=" + armed1.tier + " index=" + armed1.index + " zone=" + armed1.zone.toFixed( 3 ) );
const armedVerdict =
  h1.tier >= 0 && armed1.active && armed1.tier === h1.tier && armed1.index === h1.index;
console.log( "  armed on the clicked plant verdict: " + ( armedVerdict ? "OK" : "NOT ARMED" ) );
const margin = 0.17 + 0.1;
console.log( "  zone inside the track verdict: " + ( armed1.zone >= margin && armed1.zone <= 1 - margin ? "OK" : "TOO CLOSE TO AN END" ) );

const dom1 = await meterDom();
console.log( "  meter dom: " + JSON.stringify( dom1 ) );
console.log( "  meter visible verdict: " + ( !dom1.hidden && dom1.w > 0 ? "OK" : "HIDDEN" ) );

// the meter is DOM over a paused scene, so the only thing that can paint over
// the track window is the meter itself: count what it put down
const armedShot = await shot( "armed" );
const ink = windowDiff( plain, armedShot, dom1.x + dom1.w / 2, dom1.y + 5, dom1.w / 2 );
console.log( "  meter window: changed px=" + ink.changed + " max channel delta=" + ink.maxDelta );
console.log( "  the meter paints verdict: " + ( ink.changed > 1500 && ink.maxDelta > 30 ? "OK" : "BLANK" ) );

// the grading itself, read straight off the live zone
const probe = await bandProbe( "0, 0.05, -0.05, 0.12, -0.12, 0.3, -0.3" );
console.log( "  gradeAt across the zone: " + probe.join( " / " ) );
const want = [ "great", "good", "good", "normal", "normal", "fail", "fail" ];
let bandOk = true;
for ( let i = 0; i < want.length; i++ ) if ( probe[ i ] !== want[ i ] ) bandOk = false;
console.log( "  four variants verdict: " + ( bandOk ? "OK" : "WRONG BANDS " + probe.join( "/" ) ) );

// the needle crosses the far end on its own: that is the one grade that needs
// no click timing at all
await wait( 1600 );
const missed = await skillState();
console.log( "  after the sweep: active=" + missed.active + " needle=" + missed.needle.toFixed( 3 ) + " last=" + missed.last );
const harvest1 = await harvestState();
console.log( "  harvest: " + JSON.stringify( harvest1 ) );
const p1b = h1.tier >= 0 ? await plantState( h1.tier, h1.index ) : null;
console.log( "  plant after: " + JSON.stringify( p1b ) );
const missOk =
  missed.last === "fail" &&
  missed.needle >= 1 &&
  harvest1.cut === harvest0.cut &&
  harvest1.fail === harvest0.fail + 1 &&
  p1b.cut === 0 &&
  Math.abs( p1b.up - p1.up ) < 1e-6;
console.log( "  miss leaves the plant standing verdict: " + ( missOk ? "OK" : "PLANT CUT OR GRADE WRONG" ) );
const dom2 = await meterDom();
console.log( "  verdict readout: " + dom2.verdict + " / hidden=" + dom2.hidden );
console.log( "  miss readout verdict: " + ( dom2.verdict === "Missed" ? "OK" : "NO READOUT" ) );

/* ------------------------------------------------- pass: play it on time -- */
console.log( "== pass leg: arm on (700,470) and click on the zone centre" );
await page.mouse.move( 700, 470 );
await wait( 300 );
const h2 = await hoverState();
console.log( "  hover: tier=" + h2.tier + " index=" + h2.index );
const p2 = h2.tier >= 0 ? await plantState( h2.tier, h2.index ) : null;
console.log( "  plant before: up=" + ( p2 ? p2.up.toFixed( 3 ) : "n/a" ) );
const before = await shot( "before" );
await page.mouse.click( 700, 470 );
await wait( 120 );
const armed2 = await skillState();
const lead = await msToCentre();
console.log( "  armed: zone=" + armed2.zone.toFixed( 3 ) + " -> ms to centre=" + lead );
// aim 40ms early: the click dispatch itself costs a little, and a band half
// width is 255ms of sweep, so landing near the centre is what is being tested
await wait( Math.max( 0, lead - 40 ) );
await page.mouse.click( 700, 470 );
await wait( 200 );
const played = await skillState();
const harvest2 = await harvestState();
console.log( "  played: active=" + played.active + " at=" + played.at.toFixed( 3 ) + " last=" + played.last );
console.log( "  harvest: " + JSON.stringify( harvest2 ) );
const p2b = h2.tier >= 0 ? await plantState( h2.tier, h2.index ) : null;
console.log( "  plant after: up=" + ( p2b ? p2b.up.toFixed( 3 ) : "n/a" ) + " cut=" + ( p2b ? p2b.cut : "-" ) );
const stubShare = played.last === "great" ? 0.1 : played.last === "good" ? 0.16 : 0.22;
const expectedUp = p2.up * stubShare;
const upRatio = p2.up > 0 ? p2b.up / p2.up : 1;
console.log( "  stubble share: got=" + upRatio.toFixed( 3 ) + " want=" + stubShare.toFixed( 3 ) );
const passOk =
  variants.indexOf( played.last ) >= 0 &&
  played.last !== "fail" &&
  harvest2.cut === harvest1.cut + 1 &&
  p2b.cut === 1 &&
  Math.abs( p2b.up - expectedUp ) < expectedUp * 0.05;
console.log( "  pass cuts the plant verdict: " + ( passOk ? "OK" : "NOT CUT" ) );
const after = await shot( "after" );
const cutWindow = windowDiff( before, after, 700, 470, 110 );
console.log( "  window around the plant: changed px=" + cutWindow.changed + " max channel delta=" + cutWindow.maxDelta );
console.log( "  the cut is visible verdict: " + ( cutWindow.changed > 200 && cutWindow.maxDelta > 20 ? "OK" : "INVISIBLE" ) );

// a cut plant is stubble: pointing at it again must never pick it again
await page.mouse.move( 700, 470 );
await wait( 300 );
const h3 = await hoverState();
console.log( "  re-point at the cut plant: tier=" + h3.tier + " index=" + h3.index );
const skipOk = h3.tier !== h2.tier || h3.index !== h2.index;
console.log( "  cut plant skipped by the pick verdict: " + ( skipOk ? "OK" : "STILL PICKABLE" ) );

/* ------------------------------ a click on nothing must arm nothing ----- */
console.log( "== empty click leg: click the sky" );
await page.mouse.move( 450, 120 );
await wait( 300 );
const hSky = await hoverState();
console.log( "  hover over the sky: tier=" + hSky.tier + " index=" + hSky.index );
const lastBefore = ( await skillState() ).last;
await page.mouse.click( 450, 120 );
await wait( 200 );
const skyState = await skillState();
console.log( "  after the sky click: active=" + skyState.active + " last=" + skyState.last );
console.log( "  a click on nothing arms nothing verdict: " + ( !skyState.active && skyState.last === lastBefore ? "OK" : "ARMED ON NOTHING" ) );

// the legs left so far have cut whatever stood at (700,470), so which of these
// spots still holds a plant is not known up front - take the first that does
const spots = [ [ 620, 460 ], [ 700, 470 ], [ 560, 455 ], [ 640, 465 ], [ 680, 455 ], [ 600, 470 ] ];
async function findSpot( skip ) {
  for ( const s of spots ) {
    await page.mouse.move( s[ 0 ], s[ 1 ] );
    await wait( 250 );
    const hv = await hoverState();
    if ( hv.tier < 0 ) continue;
    if ( skip && hv.tier === skip.tier && hv.index === skip.index ) continue;
    console.log( "  spot " + s[ 0 ] + "," + s[ 1 ] + " -> tier=" + hv.tier + " index=" + hv.index );
    return { spot: s, hover: hv };
  }
  return null;
}

/* ------------------------------- the second click can land anywhere ------ */
console.log( "== early click leg: play it the instant the meter appears" );
const found1 = await findSpot( null );
if ( !found1 ) {
  console.log( "  no standing plant found, leg skipped" );
} else {
  const f1 = found1.spot;
  const h4 = found1.hover;
  const p4 = await plantState( h4.tier, h4.index );
  await page.mouse.click( f1[ 0 ], f1[ 1 ] );
  await wait( 140 );
  await page.mouse.click( f1[ 0 ], f1[ 1 ] );
  await wait( 200 );
  const early = await skillState();
  const harvest3 = await harvestState();
  console.log( "  early: active=" + early.active + " at=" + early.at.toFixed( 3 ) + " last=" + early.last );
  console.log( "  harvest: " + JSON.stringify( harvest3 ) );
  const p4b = await plantState( h4.tier, h4.index );
  console.log( "  plant before/after up: " + p4.up.toFixed( 3 ) + " / " + p4b.up.toFixed( 3 ) + " cut=" + p4b.cut );
  // whatever grade the clock happened to give, the grade and the outcome must
  // agree, and the grade must be what the needle position says it is
  const gradeFromNeedle = await page.evaluate(
    "window.__verdant ? window.__verdant.gradeAt( window.__verdant.skill.at ) : 'no-autotest'"
  );
  const outcomeOk =
    variants.indexOf( early.last ) >= 0 &&
    gradeFromNeedle === early.last &&
    ( early.last === "fail" ? p4b.cut === 0 && Math.abs( p4b.up - p4.up ) < 1e-6 : p4b.cut === 1 );
  console.log( "  grade from the needle: " + gradeFromNeedle + " / reported " + early.last );
  console.log( "  grade and outcome agree verdict: " + ( outcomeOk ? "OK" : "DISAGREEMENT" ) );

  /* ------------------------------------- the meter must not eat the click -- */
  console.log( "== click-through leg: play it by clicking on the meter itself" );
  const found2 = await findSpot( null );
  if ( !found2 ) {
    console.log( "  no standing plant found, leg skipped" );
  } else {
    const f2 = found2.spot;
    await page.mouse.click( f2[ 0 ], f2[ 1 ] );
    await wait( 200 );
    const dom3 = await meterDom();
    console.log( "  meter box: " + JSON.stringify( dom3 ) );
    if ( !dom3.hidden ) {
      await page.mouse.click( dom3.x + Math.round( dom3.w / 2 ), dom3.y + 5 );
      await wait( 250 );
      const through = await skillState();
      console.log( "  after clicking the meter: active=" + through.active + " last=" + through.last );
      console.log( "  meter is click-through verdict: " + ( !through.active && through.last !== "" ? "OK" : "METER ATE THE CLICK" ) );
    } else {
      console.log( "  meter was hidden, leg skipped" );
    }
  }
}

/* ------------------------------------------------------- the camera ------ */
const frame1 = await framing();
console.log( "  framing before: " + frame0 );
console.log( "  framing after:  " + frame1 );
console.log( "  clicks never moved the camera verdict: " + ( frame0 === frame1 ? "OK" : "CAMERA MOVED" ) );

const stats = await page.evaluate(
  "document.getElementById('stats') ? document.getElementById('stats').textContent : ''"
);
console.log( "  #stats: " + stats );
console.log( "  console errors: " + consoleErrors.length + " " + consoleErrors.slice( 0, 6 ).join( " | " ) );

await browser.close();
srv.kill( "SIGTERM" );
