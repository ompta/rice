// js/app.js — VERDANT. A sea of green.
//
// Layout of the whole experience:
//   sky dome      raw shader: scattering gradient that rides the sun's height,
//                 fbm cloud with a lit rim, sun disc + bloom, and horizon haze
//                 in the fog's own colour so the hills dissolve into it
//   hills         three unlit silhouette bands, terraced and hazier the further
//                 they are, with one far peak sitting behind the field
//   tree line     instanced trunks + canopies, irregular spacing
//   far field     one ring plane on the same plot lattice as the floor: a
//                 patchwork of green, ripe and open-water plots, the near ones
//                 riding the same wave train as the rice
//   ground        lit paddy floor under the rice: each plot at its own level,
//                 modelled bunds merged into the same mesh, and a shallow
//                 water film mirroring the sky it is standing under
//   rice          three InstancedMesh tiers (near / mid / far), GPU wind, and
//                 one plant shared by all of them - the lush foreground one,
//                 its drooping head hung with ripe gold ears
//   hover         pointing at the field outlines one plant in bright leaf edges
//                 and notices an animal standing under the cursor
//   skill check   clicking a plant arms a meter, a second click plays it and a
//                 pass cuts the plant; clicking an animal arms the same meter on
//                 a shorter sweep and a pass drives that one animal off
//   cut fragments a pass also slices the plant: five slivers of leaf tear off
//                 at the cut plane and fall, all of them one InstancedMesh
//   sickle        a toggle on the panel hands the pointer over to a sickle: a
//                 held drag (a flick on a phone) draws a line for a second
//                 instead of turning the view, and every plant the line passes
//                 over is cut at the stubble
//   sound         the daylight hours loop the small bird, the golden hour loops
//                 the evening cicada, and the skill check answers itself: a
//                 great cut, an ordinary cut, a miss - and so does a beast's
//                 strike, on the same cue keyed by the species that paid it
//   purse         a cut pays the field: 1 gold for a normal cut, 2 for a good
//                 one, 3 for a great one, and every sickle swipe begun takes
//                 1 gold off the purse
//   combo         great cuts landed back to back are a run: the run is counted
//                 on the verdict and in the readout, and each great after the
//                 first pays one gold more than the table until the cut is
//                 worth 10 and stops growing
//   shop          the purse buys: a card on the glass sells the field's own
//                 kit - a whetstone, blade oil, a longer snath, a gilded
//                 sickle - and a purchase spends the fee off the purse the
//                 same way a swipe does, so a piece the purse cannot pay is
//                 refused rather than debt
//   flair         a cut answers at the point the blade went through: a shockwave
//                 opens there, a fan of sparks climbs out of it and falls back,
//                 and the claim itself lifts off the cut and dies a capped
//                 height above it - the whole answer dressed by the run, so a
//                 deep one reads grander than the nick that opened it
//   beasts        the field's own wildlife: the day opens with one animal already
//                 walking the stand and the field asks for the next one on a random
//                 30-60 s draw rather than on a fast beat, so a bear, a boar and a
//                 snake are let loose through the stand at random and walk toward the
//                 player, and a beast that reaches arm's length winds up and strikes -
//                 the strike takes its damage through hurt(), so the bar on the glass,
//                 the ration and the collapse are the same ledger a bite answers to.
//                 Each animal is primitives merged into one geometry per species, so a
//                 beast is one draw call, a swipe ending with one inside the ring spends
//                 that animal's own hide rather than only driving it off, and a check
//                 aimed at one plays the cut's own meter - dressed orange rather than
//                 the crop's green, which is what says the gauge belongs to a hide - on
//                 the animal's shorter sweep to do the same to that one animal. A check
//                 that goes wrong about an animal costs the hand nothing: the answer
//                 belongs to the animal rather than to the arm, so a failed one leaves
//                 the hide and the day both alone
//
// Nothing is loaded: every geometry and material here is procedural, so the
// page's only dependency is three.js itself, which index.html's import map
// pulls from a CDN pinned to r170 - the exact build the onBeforeCompile
// injections in js/shaders.js are written against. Nothing is vendored here;
// "npm install three@0.170.0" plus a one-line url swap is the offline fallback.
import * as THREE from "three";
import { buildPlantGeometry, mulberry32, windOffset, REAP_SPINE } from "./plants.js";
import {
  makeWindMaterial,
  makeGroundMaterial,
  makeFarFieldMaterial,
  makeSkyMaterial,
  prepareWind,
  updateWind,
} from "./shaders.js";

// ---------------------------------------------------------------------------
// Page-level state. Everything the control panel can touch lives here.
// ---------------------------------------------------------------------------
export const state = {
  wind: 0.34, // 0..1, straight from the slider
  paused: false,
  light: "morning", // the hour; it walks itself through PRESETS unless ?light= pins one
  view: "open",
  quality: "high",
  walk: true, // free camera walking: arrow keys / WASD move, a held drag looks
  sickle: false, // the sickle drawn on the panel: a held drag reaps instead of looking
  touch: false, // touch controls armed: a thumb pad walks, a tap arms the check
};

export const params = (() => {
  const q = new URLSearchParams( location.href.split( "?" )[1] || "" );
  const num = ( name, def ) => {
    const v = q.get( name );
    return v === null || v === "" || isNaN( parseFloat( v ) ) ? def : parseFloat( v );
  };
  const pick = ( name, def ) => {
    const v = q.get( name );
    return v === null || v === "" ? def : String( v );
  };
  return {
    wind: num( "wind", 0.34 ),
    // an hour named in the url pins it and the field stays under that one light;
    // with no light= the hour walks itself through the presets (cycleLight),
    // holding each one for ?cycle= seconds - one minute by default, which is
    // what a viewer sits under. The harnesses name a short cycle or pin one hour,
    // since a comparable pair of frames has to be lit by one known hour
    light: pick( "light", "morning" ),
    lightPinned: q.get( "light" ) !== null && q.get( "light" ) !== "",
    cycle: num( "cycle", 60 ), // seconds per hour; 60 = one minute, 0 = hold the opening hour
    // fragments a cut throws off. Five is what a slice reads as: the severed
    // top plus four leaf shavings scattering around it. A harness names it to
    // prove the burst size it asked for is the burst size the page runs under
    perts: Math.max( 0, Math.round( num( "perts", 5 ) ) ),
    view: pick( "view", "open" ),
    paused: num( "paused", 0 ) > 0,
    quality: pick( "quality", "high" ),
    dpr: num( "dpr", 0 ), // 0 = use the device ratio, capped
    // the field's volume: 0 mutes it, so a harness can prove which cue the page
    // chose for an outcome without a browser spending its audio on one
    sound: num( "sound", 1 ),
    seed: num( "seed", 20260 ),
    autotest: num( "autotest", 0 ) > 0,
    walk: num( "walk", 1 ) > 0, // 0 = keep the camera locked to the preset framings
    touch: num( "touch", 0 ) > 0, // 1 = force the phone layout on a desktop
    // 1 = start with the sickle already drawn, so a harness can drive a swipe
    // without first clicking the panel
    sickle: num( "sickle", 0 ) > 0,
    // 1 = open the shop card at start, so a harness can price a purchase without
    // first clicking the bar
    shop: num( "shop", 0 ) > 0,
    // how many beasts the stand may be holding at once: the bear, the boar and
    // the snake are let loose through it at random and walk toward the player,
    // so the number named is the population rather than a rate. 0 turns the
    // field's own wildlife off altogether, which is what a harness that is not
    // about the beasts pins - a hand that is being measured for a screenshot
    // should not be paying for a bear on top of it
    beast: Math.max( 0, Math.round( num( "beast", 4 ) ) ),
    // how far the hand works, in metres: the radius of the ring around the
    // player inside which either tool cuts. Two and a half metres is an arm
    // plus the swing the snath gives it, which is what makes the stand the
    // player is standing in the stand that gets cut rather than the whole
    // field. ?reach= moves the ring - a harness that is about something other
    // than the reach pins it wide so the ring never quietly decides its result
    reach: num( "reach", 2.5 ),
  };
})();

state.wind = params.wind;
state.light = params.light;
state.view = params.view;
state.paused = params.paused;
state.quality = params.quality;
state.walk = params.walk;
state.sickle = params.sickle;

// A phone or tablet has no keys, so it gets its own control set: a thumb pad for
// walking, hold-to-press elevation buttons, and a tap (never a drag) to arm the
// skill check. The pointer kind is read once at load - it never changes during a
// session - and ?touch=1 forces the same layout on a desktop so the harness can
// drive it. app.js puts .touch on <html> and the stylesheet keys every phone rule
// on that class, so the DOM and the CSS cannot disagree about which layout is
// live.
export function coarsePointer() {
  if ( window.matchMedia && window.matchMedia( "(pointer: coarse)" ).matches ) return true;
  return "ontouchstart" in window;
}

state.touch = params.touch || coarsePointer();

// A single shared clock uniform: every patched material reads the same one, so
// pausing freezes the whole environment at once rather than one layer at a time.
export const uniforms = {
  uTime: { value: 0 },
  uWind: { value: state.wind },
  uWindSpeed: { value: 1 },
  uGust: { value: 1 },
  // hover highlight: display-space addend (see HI_FRAGMENT), so these are not
  // colour-managed scene colours and no light is added to the scene. uHiWidth
  // is the share of a half-leaf the rim covers, so 0.72 is a thick band rather
  // than a hairline, and uHiColor sits near the display ceiling so the picked
  // plant reads at a glance instead of needing to be hunted for
  uHiColor: { value: new THREE.Vector3( 0.9, 1.0, 0.6 ) },
  uHiWidth: { value: 0.72 },
};

export const fatal = ( msg ) => {
  const el = document.getElementById( "err" ) || document.createElement( "div" );
  if ( !document.getElementById( "err" ) ) {
    el.id = "err";
    document.body.appendChild( el );
  }
  el.textContent = ( el.textContent ? el.textContent + " || " : "" ) + String( msg );
  console.error( msg );
};

// ---------------------------------------------------------------------------
// Lighting modes. Each one moves the sun, the colour temperature, the sky
// gradient, the fog and the exposure together, which is what makes a mode
// change read as a change of hour rather than a filter over the lens.
// ---------------------------------------------------------------------------
function makePreset( sun, sky, ground, fog, extra ) {
  const C = ( hex ) => new THREE.Color( hex );
  return {
    sunDir: new THREE.Vector3( sun[0], sun[1], sun[2] ).normalize(),
    sunColor: C( sun[3] ),
    sunIntensity: sun[4],
    fillDir: new THREE.Vector3( sun[5], sun[6], sun[7] ).normalize(),
    fillColor: C( sun[8] ),
    fillIntensity: sun[9],
    hemiSky: C( sky[0] ),
    hemiGround: C( ground[0] ),
    hemiIntensity: ground[1],
    skyTop: C( sky[1] ),
    skyMid: C( sky[2] ),
    skyHorizon: C( sky[3] ),
    cloud: sky[4],
    fogColor: C( fog[0] ),
    fogDensity: fog[1],
    farNear: C( fog[2] ),
    farFar: C( fog[3] ),
    exposure: fog[4],
  };
}

export const PRESETS = {
  morning: makePreset(
    [ -0.62, 0.20, -0.55, "#f4e6d2", 1.42, 0.72, 0.28, 0.55, "#9db4c8", 0.60 ],
    [ "#c6d6e6", "#6889ad", "#a7c0d6", "#e2e6e2", 0.66 ],
    [ "#3e4a2e", 0.92 ],
    [ "#cdd6de", 0.0092, "#4e6a42", "#83948a", 1.0 ]
  ),
  afternoon: makePreset(
    [ 0.18, 0.90, -0.30, "#fbf7ec", 2.0, -0.62, 0.34, 0.52, "#b6c6da", 0.66 ],
    [ "#b8cde2", "#4f7bb0", "#93b6d0", "#e0e7ea", 0.46 ],
    [ "#465236", 1.05 ],
    [ "#d6dee5", 0.0062, "#547a44", "#8fa48e", 0.98 ]
  ),
  golden: makePreset(
    [ 0.86, 0.14, 0.36, "#ffc481", 2.5, -0.72, 0.34, 0.40, "#6f88b0", 0.72 ],
    [ "#93a6c0", "#d9b98f", "#f2d4a2", "#ffd9ac", 0.60 ],
    [ "#5a5236", 1.0 ],
    [ "#e8d3b0", 0.0080, "#667a44", "#a89b78", 1.06 ]
  ),
};

// The rig the scene is actually showing, plus the one it is easing toward.
export const rigNow = (() => {
  const base = PRESETS[ params.light ] || PRESETS.afternoon;
  const copy = {};
  for ( const k in base ) {
    const v = base[ k ];
    copy[ k ] = v instanceof THREE.Color
      ? new THREE.Color().copy( v )
      : v instanceof THREE.Vector3 ? new THREE.Vector3().copy( v ) : v;
  }
  return copy;
})();

export const skyU = {
  uSkyTop: { value: rigNow.skyTop },
  uSkyMid: { value: rigNow.skyMid },
  uSkyHorizon: { value: rigNow.skyHorizon },
  uSunDir: { value: rigNow.sunDir },
  uSunColor: { value: rigNow.sunColor },
  uCloud: { value: rigNow.cloud },
  uFogColor: { value: rigNow.fogColor },
  uTime: uniforms.uTime,
};

export const farU = {
  uFarNear: { value: rigNow.farNear },
  uFarFar: { value: rigNow.farFar },
};

// The floor and the distant field both mirror the sky and dissolve into the
// fog, so they read the very same live uniform objects the dome does: easeRig
// mutates rigNow's colours in place, which is what keeps all three layers in
// step with whatever hour the rig is easing through.
export const envU = {
  sunDir: skyU.uSunDir,
  sunColor: skyU.uSunColor,
  skyHorizon: skyU.uSkyHorizon,
  skyMid: skyU.uSkyMid,
  farNear: farU.uFarNear,
  farFar: farU.uFarFar,
  fogColor: skyU.uFogColor,
};


window.addEventListener( "error", ( e ) => fatal( e.message + " @ " + e.filename + " :: " + String( e.error && e.error.stack || "" ).replace( /\s+/g, " " ).slice( 0, 900 ) ) );

// ---------------------------------------------------------------------------
// Renderer + scene graph.
// ---------------------------------------------------------------------------
export let renderer = null;
export let scene = null;
export let camera = null;
export let skyMesh = null;
export let sunLight = null;
export let fillLight = null;
export let hemiLight = null;

export function build() {
  const canvas = document.getElementById( "scene-canvas" );
  // Verification mode keeps the drawing buffer so a headless screenshot or a
  // readPixels probe sees the same frame a real user does; normal play does
  // not pay for that copy.
  renderer = new THREE.WebGLRenderer( {
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: params.autotest,
  } );
  const cap = params.dpr > 0 ? params.dpr : 2;
  renderer.setPixelRatio( Math.min( window.devicePixelRatio || 1, cap ) );
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = rigNow.exposure;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2( rigNow.fogColor.getHex(), rigNow.fogDensity );

  camera = new THREE.PerspectiveCamera( 48, 16 / 9, 0.05, 760 );
  camera.rotation.order = "YXZ"; // yaw then pitch, so the parallax stays horizon-stable

  hemiLight = new THREE.HemisphereLight( rigNow.hemiSky, rigNow.hemiGround, rigNow.hemiIntensity );
  scene.add( hemiLight );

  sunLight = new THREE.DirectionalLight( rigNow.sunColor, rigNow.sunIntensity );
  scene.add( sunLight );

  fillLight = new THREE.DirectionalLight( rigNow.fillColor, rigNow.fillIntensity );
  scene.add( fillLight );

  // --- sky dome -------------------------------------------------------------
  const skyGeo = new THREE.SphereGeometry( 620, 32, 18 );
  const skyMat = makeSkyMaterial( skyU );
  skyMesh = new THREE.Mesh( skyGeo, skyMat );
  // Draw order here is a performance decision rather than a look decision:
  // nothing in the scene is blended, so with the depth test on any order
  // paints the same pixels. What changes is how much shading the GPU has to
  // throw away. three sorts opaque objects back-to-front by object centre,
  // which is the worst case for early depth rejection: every hidden fragment
  // of the ground, the distant field, the trees and the hills gets shaded and
  // then painted over. Near-to-far instead lets the depth buffer reject that
  // work before the fragment shader runs, and putting the dome last means it
  // only shades the pixels the field actually leaves uncovered.
  skyMesh.renderOrder = 7;
  scene.add( skyMesh );

  // --- hills: three silhouette bands, paler and hazier the further they are
  const hillLayers = [
    {
      z: -104, depth: 26, base: -7, amp: 12.5, freq: 0.0102, seed: 11.3,
      top: "#547049", bot: "#3d5340", haze: "#7d9687", hazeAt: 0.30, terrace: true,
    },
    {
      z: -150, depth: 40, base: -4, amp: 15.0, freq: 0.0071, seed: 4.7,
      top: "#63785f", bot: "#4d6157", haze: "#8fa6a2", hazeAt: 0.46, terrace: true,
    },
    {
      z: -215, depth: 60, base: 0, amp: 17.0, freq: 0.0049, seed: 21.9,
      top: "#8194a0", bot: "#6c7f8e", haze: "#a9bbcc", hazeAt: 0.72,
      // one far peak: a Japanese field almost always has a mountain sitting
      // behind it, and a lone cone reads as a volcano rather than as a range
      peak: { x: -96, w: 150, h: 34 },
    },
  ];
  for ( const h of hillLayers ) {
    const band = hillBand( h );
    band.renderOrder = 6; // the furthest thing in the scene
    scene.add( band );
  }

  // --- tree line: irregular spacing, varied heights, a few real gaps ------
  const trees = buildTreeLine( -170, 170, -96, 0x24be );
  for ( const t of trees ) {
    t.renderOrder = 5;
    scene.add( t );
  }

  // --- ground + distant field ----------------------------------------------
  // The floor is a real paddy: each plot sits at its own level and the bunds
  // between them are modelled, not painted, so they catch the sun and throw a
  // shade side. The distant field is a ring that takes over past 13 m, so it
  // floats just above the highest mud the floor reaches and the two layers
  // never fight over the same pixel.
  const ground = new THREE.Mesh(
    paddyFloor( 150, 96, 62 ),
    makeGroundMaterial( uniforms, "#e8eadc", envU )
  );
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = 3; // behind the rice, in front of the distant field
  scene.add( ground );
  // the floor mesh, so a harness can read the height its vertices actually
  // reach and tell a modelled bund from a bund painted on a flat plane
  field.ground = ground;

  const farField = new THREE.Mesh(
    new THREE.RingGeometry( 13, 175, 128, 5 ),
    makeFarFieldMaterial( uniforms, {
      color: "#ffffff",
      near: farU.uFarNear,
      far: farU.uFarFar,
      env: envU,
    } )
  );
  farField.rotation.x = -Math.PI / 2;
  farField.position.y = 0.07;
  farField.renderOrder = 4;
  scene.add( farField );

  // --- cut fragments --------------------------------------------------------
  // One InstancedMesh for every fragment the whole session will throw, so a cut
  // costs no draw call and no allocation. See spawnCutFx / stepFx below.
  buildFx();

  // --- the sickle -----------------------------------------------------------
  // The one item the viewer can hold: it rides the camera and takes the scene's
  // own lights, so it is a real object in the field rather than a HUD decal.
  // See reapSickle / stepSickle below.
  buildSickle();

  return { renderer, scene, camera };
}

// A low-lying silhouette band: bottom edge near, ridge edge far, vertex
// colours so the ridge catches a little more light than the valley. Each band
// carries several rows rather than two, which is what lets the near bands read
// as terraced slopes and lets the haze sit on the height rather than on the
// whole band at once.
function hillBand( spec ) {
  const N = 190;
  const ROWS = 4;
  const pos = [];
  const col = [];
  const idx = [];
  const topC = new THREE.Color( spec.top );
  const botC = new THREE.Color( spec.bot );
  const hazeC = new THREE.Color( spec.haze );
  const floor = spec.base - 9;
  for ( let i = 0; i <= N; i++ ) {
    const x = -350 + 700 * i / N;
    const wob =
      Math.sin( x * spec.freq + spec.seed ) * 0.62 +
      Math.sin( x * spec.freq * 2.7 + spec.seed * 2.3 ) * 0.26 +
      Math.sin( x * spec.freq * 6.1 - spec.seed ) * 0.12;
    let amp = spec.amp * ( 0.72 + 0.42 * wob );
    if ( spec.peak ) {
      const dx = ( x - spec.peak.x ) / spec.peak.w;
      amp += spec.peak.h * Math.max( 0, 1 - dx * dx ) * ( 0.86 + 0.14 * wob );
    }
    const top = spec.base + amp;
    for ( let r = 0; r < ROWS; r++ ) {
      const u = r / ( ROWS - 1 );
      pos.push( x, floor + ( top - floor ) * u, spec.z + spec.depth * 0.55 * u );
      const c = botC.clone().lerp( topC, u );
      c.lerp( hazeC, u * u * spec.hazeAt );
      if ( spec.terrace ) {
        // a step in the crop every couple of metres of height: a terraced
        // hillside, which is how the ground behind a paddy field is usually
        // cut rather than a smooth green flank
        const band = Math.sin( floor + ( top - floor ) * u * 2.6 + spec.seed );
        c.multiplyScalar( 0.90 + 0.16 * ( 0.5 + 0.5 * band ) );
      }
      col.push( c.r, c.g, c.b );
    }
  }
  for ( let i = 0; i < N; i++ ) {
    for ( let r = 0; r < ROWS - 1; r++ ) {
      const a = i * ROWS + r;
      const b = a + ROWS;
      idx.push( a, b, b + 1, a, b + 1, a + 1 );
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute( "position", new THREE.Float32BufferAttribute( pos, 3 ) );
  geo.setAttribute( "color", new THREE.Float32BufferAttribute( col, 3 ) );
  geo.setIndex( idx );
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial( { vertexColors: true, fog: true } );
  return new THREE.Mesh( geo, mat );
}

// ---------------------------------------------------------------------------
// The paddy grid. These constants are the ones js/shaders.js paints the floor
// and the distant field with, kept in step by step: a plot is a cell of a
// warped 5.6 m lattice, its level is a function of the cell index, and the
// bund is the band that straddles the cell border. Move one side without the
// other and the painted bunds stop sitting on the modelled ones.
// ---------------------------------------------------------------------------
const PADDY_CELL = 5.6;
const PADDY_BUND = 0.34; // base half-width of an earthen bund
const PADDY_RIDGE = 0.3; // how high a bund stands over its plot

function bendX( z ) {
  return Math.sin( z * 0.045 + 1.3 ) * 0.9 + Math.sin( z * 0.011 - 0.7 ) * 1.7;
}
function bendZ( x ) {
  return Math.sin( x * 0.038 - 2.1 ) * 1.1 + Math.sin( x * 0.009 + 0.4 ) * 1.5;
}
// metres from the nearest bund centre line, which is also how close a plant
// may sit to one before the layout drops it
function bundEdge( x, z ) {
  const gx = ( x + bendX( z ) ) / PADDY_CELL;
  const gz = ( z + bendZ( x ) ) / PADDY_CELL;
  const fx = Math.min( gx - Math.floor( gx ), 1 - ( gx - Math.floor( gx ) ) );
  const fz = Math.min( gz - Math.floor( gz ), 1 - ( gz - Math.floor( gz ) ) );
  return Math.min( fx, fz ) * PADDY_CELL;
}
function plotLevel( x, z ) {
  const cx = Math.floor( ( x + bendX( z ) ) / PADDY_CELL );
  const cz = Math.floor( ( z + bendZ( x ) ) / PADDY_CELL );
  return 0.03 * ( 0.5 + 0.5 * Math.sin( cx * 1.7 + Math.sin( cz * 2.3 ) * 1.1 ) );
}
function mudNoise( x, z ) {
  return (
    Math.sin( x * 0.31 ) * 0.34 +
    Math.sin( z * 0.37 ) * 0.3 +
    Math.sin( x * 0.71 + z * 0.53 ) * 0.22 +
    Math.sin( x * 1.3 - z * 0.9 ) * 0.14
  );
}
// the mud surface: the same expression the floor shader solves for the water
// line, so the flooded part of a plot is flooded in both places
function floorTop( x, z ) {
  return plotLevel( x, z ) - 0.03 + 0.055 * ( 0.5 + 0.5 * mudNoise( x, z ) );
}

// The paddy floor: a wide heightfield whose plots each sit at their own level,
// with the bunds between them merged into the SAME geometry - one mesh, one
// draw call, and a ridge that catches the sun and throws a shade side rather
// than being painted on flat. Bunds are modelled out to `bundRadius`; past it
// they are only a pixel wide, where the floor and distant shaders keep painting
// them on the same lattice.
function paddyFloor( radius, segs, bundRadius ) {
  const geo = new THREE.PlaneGeometry( radius * 2, radius * 2, segs, segs );
  const p = geo.attributes.position.array;
  for ( let i = 0; i < p.length; i += 3 ) {
    // the plane lies in xy and is turned flat by the mesh, so local y is world
    // -z: the height the shader reads is the plane's own z
    const wx = p[ i ];
    const wz = -p[ i + 1 ];
    p[ i + 2 ] = floorTop( wx, wz );
  }
  geo.deleteAttribute( "uv" );

  const pos = Array.from( p );
  const idx = Array.from( geo.index.array );
  const base = p.length / 3;
  const n = Math.ceil( bundRadius * 2 / 2.0 );
  const kMax = Math.ceil( bundRadius / PADDY_CELL );
  let v = base;
  for ( let axis = 0; axis < 2; axis ++ ) {
    for ( let k = -kMax; k <= kMax; k ++ ) {
      for ( let s = 0; s <= n; s ++ ) {
        const t = -bundRadius + bundRadius * 2 * s / n;
        const cx = axis === 0 ? k * PADDY_CELL - bendX( t ) : t;
        const cz = axis === 0 ? t : k * PADDY_CELL - bendZ( t );
        const lv = plotLevel( cx, cz );
        // the cross axis is the run turned a quarter turn, so one winding
        // serves both directions; and the strip has to be pushed in the plane's
        // own space - local y is world -z and the height rides local z - rather
        // than as world x/y/z, which would stand the bunds tens of metres up
        const ax = axis === 0 ? -1 : 0;
        const az = axis === 0 ? 0 : 1;
        pos.push( cx + ax * PADDY_BUND, -( cz + az * PADDY_BUND ), lv - 0.03 );
        pos.push( cx + ax * PADDY_BUND * 0.3, -( cz + az * PADDY_BUND * 0.3 ), lv + PADDY_RIDGE );
        pos.push( cx - ax * PADDY_BUND * 0.3, -( cz - az * PADDY_BUND * 0.3 ), lv + PADDY_RIDGE );
        pos.push( cx - ax * PADDY_BUND, -( cz - az * PADDY_BUND ), lv - 0.03 );
      }
      for ( let s = 0; s < n; s ++ ) {
        const a = v + s * 4;
        for ( let j = 0; j < 3; j ++ ) {
          idx.push( a + j, a + 4 + j, a + 5 + j, a + j, a + 5 + j, a + j + 1 );
        }
      }
      v += ( n + 1 ) * 4;
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute( "position", new THREE.Float32BufferAttribute( pos, 3 ) );
  out.setIndex( idx );
  out.computeVertexNormals();
  return out;
}

// Two crossed, tapered quads make a trunk that reads correctly from a
// distance without spending triangles on a cylinder.
function trunkGeometry( height, width ) {
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  const quads = [ [ 1, 0 ], [ 0, 1 ] ]; // which horizontal axis the quad spans
  for ( const [ ax, az ] of quads ) {
    const base = pos.length / 3;
    const wB = width;
    const wT = width * 0.42;
    const corners = [
      [ -wB * ax, 0, -wB * az ],
      [ wB * ax, 0, wB * az ],
      [ wT * ax, height, wT * az ],
      [ -wT * ax, height, -wT * az ],
    ];
    const nx = az; // normal is perpendicular to the quad's axis
    const nz = ax;
    for ( const c of corners ) {
      pos.push( c[0], c[1], c[2] );
      nor.push( nx, 0, nz );
      col.push( 1, 1, 1 );
    }
    idx.push( base, base + 1, base + 2, base, base + 2, base + 3 );
    idx.push( base + 2, base + 1, base, base + 3, base + 2, base );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute( "position", new THREE.Float32BufferAttribute( pos, 3 ) );
  geo.setAttribute( "normal", new THREE.Float32BufferAttribute( nor, 3 ) );
  geo.setAttribute( "color", new THREE.Float32BufferAttribute( col, 3 ) );
  geo.setIndex( idx );
  return geo;
}

function canopyGeometry() {
  const src = new THREE.SphereGeometry( 1, 9, 6 );
  const n = src.attributes.position.count;
  const white = new Float32Array( n * 3 );
  for ( let i = 0; i < white.length; i++ ) white[ i ] = 1;
  src.setAttribute( "color", new THREE.BufferAttribute( white, 3 ) );
  return src;
}


// Trees along the far edge of the field. Irregular spacing, a few deliberate
// gaps, occasional small clusters — a tree line that is not a hedge.
function buildTreeLine( x0, x1, z, seed ) {
  const rnd = mulberry32( seed );
  const trunkGeo = trunkGeometry( 1, 0.16 );
  const canopyGeo = canopyGeometry();
  const trunkMat = new THREE.MeshLambertMaterial( { color: "#3a3228", vertexColors: true } );
  const canopyMat = new THREE.MeshLambertMaterial( { color: "#2c4a2e", vertexColors: true } );

  const places = [];
  let x = x0;
  while ( x < x1 ) {
    const gap = 2.4 + rnd() * 6.2;
    if ( rnd() > 0.1 ) {
      const h = 6.5 + rnd() * 8.5;
      places.push( { x: x + rnd() * 1.6, z: z + rnd() * 9 - 3, h, r: h * ( 0.26 + rnd() * 0.12 ) } );
      if ( rnd() > 0.72 ) {
        places.push( { x: x + 1.2 + rnd() * 2.4, z: z + rnd() * 7 - 2, h: h * ( 0.6 + rnd() * 0.3 ), r: h * 0.26 } );
      }
    }
    x += gap;
  }

  const trunks = new THREE.InstancedMesh( trunkGeo, trunkMat, places.length );
  const canopies = new THREE.InstancedMesh( canopyGeo, canopyMat, places.length );
  const tint = new THREE.Color();
  const dummy = new THREE.Object3D();
  for ( let i = 0; i < places.length; i++ ) {
    const t = places[ i ];
    dummy.position.set( t.x, 0, t.z );
    dummy.rotation.set( 0, rnd() * Math.PI, 0 );
    dummy.scale.set( 1, t.h, 1 );
    dummy.updateMatrix();
    trunks.setMatrixAt( i, dummy.matrix );

    dummy.position.set( t.x, t.h * 0.72, t.z );
    dummy.scale.set( t.r, t.r * ( 0.72 + rnd() * 0.3 ), t.r );
    dummy.updateMatrix();
    canopies.setMatrixAt( i, dummy.matrix );

    const v = 0.72 + rnd() * 0.42;
    tint.setRGB( v * ( 0.72 + rnd() * 0.2 ), v, v * ( 0.78 + rnd() * 0.2 ) );
    canopies.setColorAt( i, tint );
    tint.setRGB( 0.8 + rnd() * 0.35, 0.75 + rnd() * 0.3, 0.7 + rnd() * 0.3 );
    trunks.setColorAt( i, tint );
  }
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  if ( trunks.instanceColor ) trunks.instanceColor.needsUpdate = true;
  if ( canopies.instanceColor ) canopies.instanceColor.needsUpdate = true;
  trunks.frustumCulled = false;
  canopies.frustumCulled = false;
  return [ trunks, canopies ];
}

// ---------------------------------------------------------------------------
// The rice itself.
//
// One jittered grid pass per tier. The tiers are distance bands that set
// spacing and submission order, not levels of plant detail: every band carries
// the same plant, so a distant stem is the foreground one seen from far away
// rather than a cheaper stand-in. Rows stay rows (that is what sells the
// agronomy at a distance) but every plant is nudged off its lattice point,
// roughly 7% of the lattice is skipped to leave gaps, and near the camera a
// few extra plants are tucked in beside each other to make small clumps.
// ---------------------------------------------------------------------------
const QUALITY = { high: 1, med: 0.55, low: 0.24 };

export const field = { tiers: [], instances: 0, triangles: 0 };

// the plant currently under the pointer: tier / index are -1 when nothing is
// picked, height is that plant's height in metres, x / y is the cursor in
// canvas pixels, and radius is how close (in px) the cursor must be to a stem
// to count as pointing at it. The hover highlight reads this; see pickPlant.
export const hover = { tier: -1, index: -1, height: 0, x: -1, y: -1, radius: 13 };
// the animal standing under the cursor or null, and the middle of its body on
// the glass: an animal is a scene object rather than an instance, so there is no
// per-instance flag to light for it and the pick only says what the next click
// answers to. See pickBeast.
hover.beastX = -1;
hover.beastY = -1;
// the animal itself is kept on the pick rather than beside it, so armSkill has
// one place to ask what the click answers to - and it is made non-enumerable on
// purpose. The beast carries the mesh it wears, a mesh carries the scene it is
// in, and the scene carries the meshes again, so a plain property would make the
// hover object circular and JSON.stringify( hover ) - which is how the harnesses
// read the pick back - would throw rather than print it. A hidden property keeps
// the dump the same six numbers it always was while the page still reads the
// animal straight off hover.beast wherever it needs it
Object.defineProperty( hover, "beast", { value: null, writable: true, enumerable: false, configurable: true } );

// ---------------------------------------------------------------------------
// The arm's reach: the ring around the player both tools answer to. A check
// only arms on a plant the hand can touch, and a swipe only takes the plants
// inside the same ring, so a line drawn across the whole glass reaps the swathe
// nearest the player rather than the whole stand, and a click on a plant
// further away than the arm is not a wasted check - it arms nothing at all.
//
// The ring is measured in the field plane from the player's own seat rather
// than from the eye: the seat's height is free - the opening framing stands
// 40 cm over the mud and the Elevate pair takes it up to 9 m - so a plant two
// and a half metres out is two and a half metres out whatever the framing's
// height is. Measuring to the eye instead would make the reach quietly grow
// every time the eye got higher, which is what the open framing would do - and
// the two framings would disagree about how far the same hand is.
//
// The hover pick deliberately stays outside this rule: a viewer can outline and
// inspect a plant anywhere in the field, and only the two tools that cut answer
// to the ring.
// ---------------------------------------------------------------------------
export const REACH = Math.max( 0, params.reach ); // metres; ?reach= moves the ring

// the ring as the hand actually works it: REACH is the bare arm and stays put
// so a harness can read the ring it was told, while hand.reach is what the ring
// became once anything that lengthens it is carried. Both tools and the readout
// answer to hand.reach, so the ring a click cuts on is the ring the readout
// names rather than one the viewer has to guess.
export const hand = { reach: REACH, reach2: REACH * REACH };

// squared metres from the player's seat to a point on the field. The camera is
// the player: walking moves it, and the ring walks with it. Squared because
// both callers ask only "inside or outside", and the reap asks it of every
// plant in the stand on every pointer move.
export function fromPlayerD2( x, z ) {
  const dx = x - camera.position.x;
  const dz = z - camera.position.z;
  return dx * dx + dz * dz;
}

// ---------------------------------------------------------------------------
// Skill check: clicking a plant arms a Dead by Daylight style meter - a needle
// sweeps the track left to right and the next click plays it. Where the needle
// happens to be decides the grade, and every pass cuts the plant. Clicking an
// animal standing in the stand arms the same meter on that animal instead, on a
// shorter sweep (BEAST_RULE.attack.sweep rather than SKILL.sweep), and a pass
// drives that one animal off rather than cutting - so the gauge, the bands and
// the grading are one rule for both, and only the sweep and the outcome differ.
//
// The three bands are nested half widths measured as a share of the track, so
// grading is one distance against three thresholds and the DOM draws them as
// three stacked divs instead of three separate gauges. `lead` keeps the zone
// away from both ends, which does two things at once: the needle can always
// reach the zone, and a click the instant the meter appears is always a miss -
// so the check costs something rather than being free.
//
// A pass shrinks the instance toward its root rather than deleting it: the
// instance origin is the plant's root, so scaling the three basis columns
// leaves stubble, keeps the instance count and the one draw call per tier, and
// leaves the plant out of the pick from then on. Better grades cut lower, so a
// great check leaves a short stub and a normal one a tall one.
// ---------------------------------------------------------------------------
export const SKILL = {
  sweep: 1.5, // seconds for the needle to cross the track
  lead: 0.1, // keep the zone centre this far from either end
  bands: { great: 0.035, good: 0.09, normal: 0.17 }, // nested half widths
  stub: { great: 0.1, good: 0.16, normal: 0.22 }, // stubble height, share of the plant
  verdict: 0.9, // seconds the verdict stays on screen
};

// the check's bands as the whetstone leaves them: SKILL.bands is the bare table
// a harness was told and stays put, while bands is what the meter is drawn and
// graded with. Keeping the two apart is what lets a honed blade widen the target
// the player aims at without moving the table anything is measured against, and
// with nothing carried the two are the same three numbers
export const bands = {
  great: SKILL.bands.great,
  good: SKILL.bands.good,
  normal: SKILL.bands.normal,
};

export const harvest = { cut: 0, great: 0, good: 0, normal: 0, fail: 0 };

// ---------------------------------------------------------------------------
// The purse. A cut pays the field, and the grade decides how much: a normal
// cut is worth 1 gold, a good one 2 and a great one 3, so the money reads back
// exactly the way the verdict does. A miss earns nothing, which is what makes
// the check worth playing rather than spamming.
//
// The sickle is the other half of the rule: a swipe is a use of the tool
// rather than a free mow, so the fee is spent on the press that starts the
// swipe - a line drawn over already-cut ground or open water still costs gold.
//
// earned and spent are kept apart so the readout can name both sides of the
// ledger: gold is what the player actually holds, and a fee with nothing left
// to pay is recorded as unpaid rather than debt, since a purse that reads
// "-2 gold" is not a thing a player can carry.
// ---------------------------------------------------------------------------
export const GOLD = { normal: 1, good: 2, great: 3, sickle: 1 };

// the run: great cuts landed back to back are a combo rather than a count of
// cuts, so the grade that keeps a run going is named here, and so is the most
// one cut can pay - table value and bonus together. The cap is what keeps a
// long run from turning the field into a coin farm: the run still reads, it
// just stops buying.
export const COMBO = { grade: "great", cap: 10 };

export const purse = { earned: 0, spent: 0, unpaid: 0, gold: 0 };

// the run as it stands: streak is how many great cuts in a row the player has
// just landed, and it goes back to 0 the moment anything else lands - a good
// cut, a normal one, a miss, or a meter left to expire. best is the longest run
// this session reached, kept apart from the streak so a harness can tell a run
// that grew to three from one that was broken and started again
export const combo = { streak: 0, best: 0 };

// what a grade is worth, 0 for a grade the table does not name (a miss).
// The run is counted before the value is read, so the great that opens a run
// pays the table's 3 and every great after it pays one gold more than the one
// before it - 3, 4, 5 ... - until the cut is worth COMBO.cap and stops growing.
// A grade that is not great lands in the run's place and ends it, which is what
// makes the bonus something to aim for rather than free money
export function earnGold( grade ) {
  const base = GOLD[ grade ] !== undefined ? GOLD[ grade ] : 0;
  if ( grade === COMBO.grade ) combo.streak = combo.streak + 1;
  else combo.streak = 0;
  if ( combo.streak > combo.best ) combo.best = combo.streak;
  if ( base <= 0 ) return 0;
  const bonus = grade === COMBO.grade ? combo.streak - 1 : 0;
  // the cap settles what the run buys; the gild is a flat addition to the cut
  // rather than to the run, so a capped cut still pays more once the blade is
  // gilded and the same capped cut with nothing carried reads as it did before
  const value = Math.min( base + bonus, COMBO.cap ) + gear.pay;
  purse.earned = purse.earned + value;
  purse.gold = purse.earned - purse.spent;
  return value;
}

// spend a fee off the purse, capped at what is actually held: the returned
// number is what was really paid, so a caller can count what went unpaid
export function payGold( amount ) {
  const held = purse.earned - purse.spent;
  const paid = Math.max( 0, Math.min( amount, held ) );
  purse.spent = purse.spent + paid;
  purse.unpaid = purse.unpaid + ( amount - paid );
  purse.gold = purse.earned - purse.spent;
  return paid;
}

// ---------------------------------------------------------------------------
// The hand's health. The purse counts what the cuts pay in; the hand counts what
// they cost. A working day is not endless: a check that goes through the air
// costs the arm 20 - the swing was made and nothing was cut - and each hour that
// passes costs it 10, which is what makes standing in the sun a decision rather
// than free time. The meter is a bar on the glass rather than a number the
// player has to find in the readout, so the cost of the next miss is legible
// while the needle is still crossing the track.
//
// HP is the bare table a harness was told and stays put; health.hp is what the
// hand actually holds, and lost / restored are the two sides of that ledger -
// the same shape the purse keeps its money in. Nothing here is a stat the field
// invents: every number is a cost one of the field's own outcomes already pays.
//
// A hand at 0 is not the bottom of a bar - it is the end of the player. Neither
// tool works (the check refuses to arm and the blade refuses to swing), and the
// body falls: this page has no player model to animate, so the eye is the body
// and the fall is the camera's own move rather than an animation on a model
// there is none of. Nothing lifts a fallen body back up - the hour's rest rests
// an arm that is still standing and a meal needs a hand to hold it - so the
// hour takes from and gives to a body on the ground nothing at all, the sky
// walks over it, and the only way back to a standing player is a fresh page.
// ---------------------------------------------------------------------------
export const HP = { max: 100, fail: 20, hour: 10, rest: 10, recover: 40, low: 30 };

// the hand as it stands: hp is what is left of the day, lost and restored are
// the two sides of that ledger, hurtAt / healedAt are when the last of each
// happened so a harness can tell a fresh cost from a stale one, and dead / fall
// say whether the day has come out of the hand for good and how far through the
// collapse the eye is
export const health = { hp: HP.max, lost: 0, restored: 0, hurtAt: -1, healedAt: -1, dead: false, fall: 0 };

// take the cost of an outcome off the hand, floored at 0: a hand cannot owe
// health, which is the same reason a purse cannot read "-2 gold". lost counts
// what was really taken rather than what was asked for, so a miss that lands
// on a hand with 10 left costs that 10 and closes the ledger at the day's length
export function hurt( amount ) {
  const before = health.hp;
  health.hp = Math.max( 0, health.hp - amount );
  health.lost = health.lost + ( before - health.hp );
  health.hurtAt = performance.now();
  // the last of the day is not the bottom of a bar: the player falls, and the
  // eye falls with him
  if ( health.hp <= 0 ) downPlayer();
  paintHealth();
}

// give it back, capped at the day's length: a hand that has rested past full
// recovers nothing further, which is what lets the ration's 40 land as 30 when
// only 30 was missing. A fallen body is left out before any of that: the hour's
// rest rests an arm that is still standing and a meal needs a hand to hold it,
// so neither answers a body that is lying in the mud
export function heal( amount ) {
  if ( health.dead ) return;
  const before = health.hp;
  health.hp = Math.min( HP.max, health.hp + amount );
  health.restored = health.restored + ( health.hp - before );
  health.healedAt = performance.now();
  paintHealth();
}

// the day has come out of the hand for good. The walk is taken away rather than
// a new flag invented for it: state.walk is the one gate both the move keys and
// the drag look already answer to, so a body face-up in the mud neither walks
// nor turns its head and the state readout says so on its own
export function downPlayer() {
  if ( health.dead ) return;
  health.dead = true;
  state.walk = false;
}

// the hour the field stepped into: a working hand pays for it, a spent one rests
// and a fallen body takes the hour from neither - the sky walks over it either
// way, which is what keeps a collapse from reading as the field stopping
export function passHour() {
  if ( health.hp <= 0 ) heal( HP.rest );
  else hurt( HP.hour );
}

// the meter on the glass: the fill is a share of the bar rather than a bar of
// its own width, so app.js writes one number and the layout never moves
const healthNodes = { bar: null, fill: null };

export function paintHealth() {
  const bar = healthNodes.bar || ( healthNodes.bar = document.getElementById( "health" ) );
  if ( !bar ) return;
  const fill = healthNodes.fill || ( healthNodes.fill = document.getElementById( "health-fill" ) );
  if ( !fill ) return;
  fill.style.width = Math.round( 100 * ( health.hp / HP.max ) ) + "%";
  // a hand under a third of its day wears the same rust the shop prices a
  // refused piece in, so the meter answers the field rather than the player.
  // A spent hand is left out: its bar is empty rather than rusted, which is
  // what keeps an empty bar from reading as two different things
  bar.classList.toggle( "low", health.hp > 0 && health.hp <= HP.low );
}

// ---------------------------------------------------------------------------
// The shop. The purse is a ledger rather than a score, so it can also buy: a
// card on the glass sells the field's own kit, each piece priced in the very
// gold the cuts pay into and the sickle spends from. A purchase spends its fee
// through payGold rather than subtracting it from a total, so a piece the purse
// cannot pay is refused rather than debt - the same rule a swipe answers to -
// and the refusal is named in the readout for as long as it is fresh, which is
// what keeps a refused click from reading as a dead button.
//
// Nothing here is a stat the field invents. Each piece moves one number the
// field already has: the whetstone widens the bands the check grades on, the
// oil drops the fee a swipe spends, the snath moves the ring both tools answer
// to, the gild pays more per cut. With nothing carried every one of those
// numbers is the bare table it was told, which is what keeps the harnesses that
// grade a pass or read the ledger honest.
// ---------------------------------------------------------------------------
export const EQUIPMENT = [
  { id: "whetstone", name: "Whetstone", cost: 6, note: "the check's great and good bands widen" },
  { id: "bladeoil", name: "Blade Oil", cost: 8, note: "a swipe spends nothing off the purse" },
  { id: "snath", name: "Long Snath", cost: 10, note: "the ring both tools answer to grows by 1.2 m" },
  { id: "gild", name: "Gilded Sickle", cost: 16, note: "every cut pays one gold more" },
  // the ration is the one row that can be bought again: it is eaten rather than
  // carried, so it moves the hand rather than a number the field runs on. Its
  // cost is a meal's, weighed against the 20 a miss already costs the arm
  { id: "ration", name: "Rice Ration", cost: 12, consumable: true, recover: HP.recover, note: "the hand recovers 40 hp" },
];

// the same table keyed by id, so a click on a row's button finds its price by
// the id the row carries rather than by its position in a list
export const EQUIPMENT_BY_ID = (() => {
  const byId = {};
  for ( const item of EQUIPMENT ) byId[ item.id ] = item;
  return byId;
})();

// the shop's own ledger: open is whether the card is on the glass, owned is
// what the player is carrying (a piece is carried once, never twice), bought
// counts the carried pieces for the readout, refusedAt is when a piece the purse
// could not pay was last asked for, eaten counts the meals the purse paid for -
// kept apart from bought, since a ration fills the hand rather than moving a
// number the field runs on - fullAt is when a ration was asked for with a hand
// that had nothing left to fill, and goneAt is when one was asked for by a body
// that has fallen: the hand has room left in its day and no hand left to fill it
export const shop = { open: params.shop, owned: {}, bought: 0, refusedAt: -1, eaten: 0, fullAt: -1, goneAt: -1 };

// the numbers the carried kit moves: fee is what starting a swipe spends off
// the purse and pay is the gold every cut pays on top of the table. Both start
// at the bare value, so a field with nothing carried runs the bare rule
export const gear = { fee: GOLD.sickle, pay: 0 };

// what a carried piece does to the field's own numbers. Each branch writes the
// live holder rather than the bare table, so REACH / SKILL.bands / GOLD stay
// exactly what a harness was told and only the values the field runs on move.
// The whetstone widens the two inner bands only and keeps them inside the
// normal one, which is what keeps the three nested bands honest
export function equip( id ) {
  if ( id === "whetstone" ) {
    bands.great = SKILL.bands.great * 1.6;
    bands.good = SKILL.bands.good * 1.4;
    return true;
  }
  if ( id === "bladeoil" ) {
    gear.fee = 0;
    return true;
  }
  if ( id === "snath" ) {
    hand.reach = REACH + 1.2;
    hand.reach2 = hand.reach * hand.reach;
    return true;
  }
  if ( id === "gild" ) {
    gear.pay = 1;
    return true;
  }
  return false;
}

// buy one row by the id it carries: false for a row the table does not name, one
// already carried, a ration eaten into a full hand, or one the purse cannot pay.
// A ration is the only row that can go through more than once, since eating it
// fills the hand rather than carrying a piece - and buying one with a full day
// left recovers nothing, so it is refused rather than paid for, which is what
// keeps a meal from being money spent on nothing
export function buy( id ) {
  const item = EQUIPMENT_BY_ID[ id ];
  if ( !item ) return false;
  if ( item.consumable === true ) {
    // a fallen body is refused before the fee is paid rather than after: money
    // spent on a meal nothing can eat is money thrown away
    if ( health.dead ) {
      shop.goneAt = performance.now();
      return false;
    }
    if ( health.hp >= HP.max ) {
      shop.fullAt = performance.now();
      return false;
    }
  } else if ( shop.owned[ id ] === true ) return false;
  if ( purse.gold < item.cost ) {
    shop.refusedAt = performance.now();
    return false;
  }
  payGold( item.cost );
  // a meal is eaten rather than carried, so it leaves the ledger of carried kit
  // alone: the hand is what moves, and the hand's own ledger counts it
  if ( item.consumable === true ) {
    shop.eaten = shop.eaten + 1;
    heal( item.recover );
    return true;
  }
  shop.owned[ id ] = true;
  shop.bought = shop.bought + 1;
  equip( item.id );
  return true;
}

// the card on the glass: the Shop row's button and the b key take the same flip,
// so a thumb and a keyboard cannot disagree about whether the kit is showing.
// The hidden attribute is what the stylesheet keys display on, so dropping it
// is the whole open and a closed card pays the layout nothing
let shopButton = null;

// the card's own purse line, remembered rather than looked up every frame: the
// money the player holds walks on the readout's clock, so a price weighed
// against it is the purse as of now rather than as of the last purchase
let shopCoins = null;

export function setShop( v ) {
  shop.open = v === true || v === 1 || v === "on" || v === "true" || v === "1";
  if ( shopButton ) shopButton.classList.toggle( "on", shop.open );
  const card = document.getElementById( "shop" );
  if ( card ) {
    if ( shop.open ) card.removeAttribute( "hidden" );
    else card.setAttribute( "hidden", "" );
  }
  paintShop();
}

// the rows read the ledger they are priced against, so the price a button names
// is the price buy() spends and the purse line is what the player holds now.
// A carried piece answers with the word rather than with a price, a piece the
// purse cannot pay keeps its price but takes the broke class, and a ration takes
// the full class when the hand has nothing left to fill - which is what makes
// each refusal legible before the click rather than after it
export function paintShop() {
  if ( !shopCoins ) shopCoins = document.getElementById( "shop-purse" );
  if ( shopCoins ) shopCoins.textContent = purse.gold + " gold";
  for ( const node of document.querySelectorAll( "[data-buy]" ) ) {
    const id = node.getAttribute( "data-buy" );
    const item = EQUIPMENT_BY_ID[ id ];
    if ( !item ) continue;
    // a ration is eaten rather than carried, so its row never answers "carried":
    // it keeps its price for as long as the hand has room left to fill, and
    // answers the refusal when it does not
    if ( item.consumable === true ) {
      // a fallen body has room left in its day and no hand left to fill it, so
      // the row answers a different refusal rather than the one a full hand
      // gives: the price stays off the glass either way, but the word says why
      const gone = health.dead;
      const full = !gone && health.hp >= HP.max;
      node.classList.toggle( "gone", gone );
      node.classList.toggle( "full", full );
      node.classList.toggle( "broke", !gone && !full && purse.gold < item.cost );
      node.textContent = gone ? "no hand" : full ? "not hungry" : item.cost + " gold";
      continue;
    }
    if ( shop.owned[ id ] === true ) {
      node.classList.toggle( "owned", true );
      node.classList.toggle( "broke", false );
      node.textContent = "carried";
      continue;
    }
    node.classList.toggle( "owned", false );
    node.classList.toggle( "broke", purse.gold < item.cost );
    node.textContent = item.cost + " gold";
  }
}

// ---------------------------------------------------------------------------
// The purse made visible. A cut does not only pay - it answers, and it answers
// at the very point the blade went through: a shockwave opens on the glass
// there, a burst of sparks climbs out of it and falls back under gravity, and
// the claim itself lifts off the cut and dies a limited height above it. The
// climb is capped on purpose - a firework's rocket rises and settles, it does
// not fly off the glass - and the whole answer dies on the check's own window,
// so the burst and the words the meter pays in are one beat rather than two
// clocks that can drift apart.
//
// The run decides how dressed the answer is. A lone nick is a nick; a run of
// great cuts earns more motes, a hotter colour, a wider fan and a bigger
// flourish, so the field's own reward is legible the moment a player is deep
// enough in one to want to know it. The words never change - the claim stays
// exactly what the harnesses read back - so what grows is the typography, the
// light and the ornaments around it.
//
// Everything here is DOM rather than geometry: the burst belongs to the glass,
// it must never eat the click that follows a cut, and it has to survive a
// paused field exactly as the meter does. The nodes are a fixed pool built once
// and reused - a cut writes transforms, it allocates nothing - and the layer
// stays hidden while nothing is live, so a field that has never been cut pays
// no compositor anything.
// ---------------------------------------------------------------------------
export const FLAIR = {
  life: SKILL.verdict, // seconds a burst lives: the check's own window, so the
                       // sparks and the claim die on one clock
  rise: 104, // px of climb for the claim: limited, which is what makes it a
             // firework's rise rather than a caption walking off the glass
  pop: 0.3, // share of the life the claim spends punching in
  fade: 0.72, // share of the life it holds before starting to fade out
  ringLife: 0.34, // seconds the shockwave takes to open and die
  sparks: [ 5, 9, 13, 18, 24 ], // motes per tier: the fan grows with the run
  fan: [ 44, 62, 80, 98, 122 ], // px of reach per tier
  ring: [ 30, 44, 58, 74, 92 ], // px of shockwave per tier
  // px/s of upward throw per tier. The fan's own width is what makes a run read
  // wider rather than taller, so the throw is a ladder of its own: the bare
  // cut's sparks have to clear the head they came out of rather than sit on it
  // as a puff, and a deep run's have to clear the claim that is already climbing
  lift: [ 120, 165, 210, 255, 300 ],
  pool: 24, // motes the one layer carries: the top tier's fan, so one burst
            // owns the pool whole and a cut never recycles a live mote
  arc: 1.3, // how far past the cut a mote falls by the end of its climb: the
            // parabola below peaks at a third of the burst and lets the motes
            // drop under the cut they came out of, which is what reads as a
            // firework rather than as a spray that only ever went up
};

// the claim's climb is a decelerating lift - it leaves the cut fast and settles
// into place. The curve has to be monotone: the punch easing below starts below
// 1 and would drag the claim under the cut it landed on
const flairClimb = ( p ) => 1 - ( 1 - p ) * ( 1 - p );

// the run's own ladder: 0 is a nick, 4 is a run that has topped out. The grade
// sets the floor - a miss never dresses, a good cut earns one step - and the
// streak decides the rest, which is what keeps the flourish something a player
// is rewarded for rather than something every cut wears
export function flairTier( grade, streak ) {
  if ( grade === "fail" || grade === "normal" ) return 0;
  if ( grade === "good" ) return 1;
  if ( streak <= 1 ) return 1;
  if ( streak <= 3 ) return 2;
  if ( streak <= 6 ) return 3;
  return 4;
}

// the burst as it stands. Ages and poses live in flat arrays so a cut costs no
// allocation, exactly as the fragment pool does
export const flair = {
  live: 0, // motes on screen right now
  tier: 0, // the tier the last burst wore
  at: -1, // when the last burst was asked for, -1 before the first cut
  lastAt: -1, // when the burst was last walked, so the step takes a wall gap
  swipe: -1, // plants the last swipe took, -1 while no swipe is answering
  alive: null,
  age: null,
  life: null,
  vx: null, // px/s of sideways throw at the moment of the burst
  vy: null, // px/s of upward throw, before gravity takes it back
  size: null,
};

// the nodes the pool owns, kept apart from the numbers above so the state a
// harness reads stays plain JSON
const flairNodes = { layer: null, ring: null, swipe: null, spark: null };

// the pool is built once, at start rather than at the first cut, so the first
// pass through the field answers the same way the hundredth one does
export function buildFlair() {
  const layer = document.getElementById( "flair" );
  if ( !layer ) return;
  flairNodes.layer = layer;
  layer.hidden = true;

  flairNodes.ring = document.createElement( "div" );
  flairNodes.ring.className = "ring";
  flairNodes.ring.style.display = "none";
  layer.appendChild( flairNodes.ring );

  flairNodes.swipe = document.createElement( "div" );
  flairNodes.swipe.className = "swipe";
  flairNodes.swipe.style.display = "none";
  layer.appendChild( flairNodes.swipe );

  flairNodes.spark = new Array( FLAIR.pool );
  for ( let i = 0; i < FLAIR.pool; i++ ) {
    const mote = document.createElement( "div" );
    mote.className = "spark";
    mote.style.display = "none";
    layer.appendChild( mote );
    flairNodes.spark[ i ] = mote;
  }

  flair.alive = new Uint8Array( FLAIR.pool );
  flair.age = new Float32Array( FLAIR.pool );
  flair.life = new Float32Array( FLAIR.pool );
  flair.vx = new Float32Array( FLAIR.pool );
  flair.vy = new Float32Array( FLAIR.pool );
  flair.size = new Float32Array( FLAIR.pool );
}

// arm a burst at a point on the glass. tier picks how dressed it is; swipe is
// the plants a sickle took, or -1 when the burst belongs to a skill check and
// the claim is already being paid by the meter
export function spawnFlair( x, y, tier, swipe ) {
  const layer = flairNodes.layer;
  if ( !layer ) return;
  const now = performance.now();
  const t = tier < 0 ? 0 : tier > 4 ? 4 : tier;
  flair.tier = t;
  flair.at = now;
  flair.lastAt = now;
  flair.swipe = swipe;
  layer.hidden = false;

  const ring = flairNodes.ring;
  ring.className = "ring f" + t;
  ring.style.left = x.toFixed( 0 ) + "px";
  ring.style.top = y.toFixed( 0 ) + "px";

  const n = FLAIR.sparks[ t ];
  const reach = FLAIR.fan[ t ];
  const lift = FLAIR.lift[ t ];
  for ( let i = 0; i < FLAIR.pool; i++ ) {
    const mote = flairNodes.spark[ i ];
    if ( i >= n ) {
      flair.alive[ i ] = 0;
      mote.style.display = "none";
      continue;
    }
    // the fan is a firework's own shape: motes thrown up and out from the cut,
    // spread round the upper half so the burst reads as a crown rather than as
    // a random spray, and thrown harder the deeper the run
    const u = n > 1 ? i / ( n - 1 ) : 0.5;
    const a = Math.PI * ( 0.06 + 0.88 * u );
    const power = reach * ( 0.66 + 0.34 * Math.random() );
    flair.alive[ i ] = 1;
    flair.age[ i ] = 0;
    flair.life[ i ] = FLAIR.life * ( 0.6 + 0.4 * Math.random() );
    flair.vx[ i ] = Math.cos( a ) * power;
    flair.vy[ i ] = -Math.sin( a ) * lift * ( 0.72 + 0.5 * Math.random() );
    flair.size[ i ] = 0.7 + 0.6 * Math.random();
    mote.className = "spark f" + t;
    mote.style.left = x.toFixed( 0 ) + "px";
    mote.style.top = y.toFixed( 0 ) + "px";
    mote.style.display = "";
  }

  const claim = flairNodes.swipe;
  if ( swipe >= 0 ) {
    claim.className = "swipe f" + t;
    claim.textContent = swipe + ( swipe === 1 ? " plant" : " plants" );
    claim.style.left = x.toFixed( 0 ) + "px";
    claim.style.top = y.toFixed( 0 ) + "px";
    claim.style.display = "";
  } else {
    claim.textContent = "";
    claim.style.display = "none";
  }
}

// walk the burst: a mote climbs, gravity takes it back down, and it thins out
// as it goes, which is what a spark reads as rather than as a dot on a wire
export function stepFlair( now ) {
  const layer = flairNodes.layer;
  if ( !layer || layer.hidden ) return;
  const dt = flair.lastAt >= 0 ? Math.min( 0.06, Math.max( 0, ( now - flair.lastAt ) / 1000 ) ) : 0;
  flair.lastAt = now;

  let live = 0;
  for ( let i = 0; i < FLAIR.pool; i++ ) {
    if ( flair.alive[ i ] === 0 ) continue;
    flair.age[ i ] += dt;
    const a = flair.age[ i ];
    const l = flair.life[ i ];
    const mote = flairNodes.spark[ i ];
    if ( a >= l ) {
      flair.alive[ i ] = 0;
      mote.style.display = "none";
      continue;
    }
    const u = a / l;
    const dx = flair.vx[ i ] * a;
    // the mote's own parabola, normalised to the burst rather than to a
    // gravity constant: it peaks at a third of the way through its life and
    // drops under the cut it came out of by the end, so the fan reads as a
    // firework rather than as a spray that only ever went up
    const dy = flair.vy[ i ] * a * ( 1 - FLAIR.arc * a );
    const s = flair.size[ i ] * ( 1 - u * 0.55 );
    mote.style.transform = "translate(" + dx.toFixed( 1 ) + "px," + dy.toFixed( 1 ) + "px) scale(" + s.toFixed( 3 ) + ")";
    mote.style.opacity = ( u < 0.58 ? 1 : 1 - ( u - 0.58 ) / 0.42 ).toFixed( 3 );
    live++;
  }
  flair.live = live;

  // the shockwave opens fast and settles, so the cut reads as an impact rather
  // than as a plant that simply stopped being there
  const ring = flairNodes.ring;
  const rt = ( now - flair.at ) / ( FLAIR.ringLife * 1000 );
  if ( rt >= 1 ) {
    ring.style.display = "none";
  } else {
    const e = 1 - ( 1 - rt ) * ( 1 - rt );
    const k = 0.12 + ( FLAIR.ring[ flair.tier ] / 100 ) * e;
    ring.style.display = "";
    ring.style.transform = "scale(" + k.toFixed( 3 ) + ")";
    ring.style.opacity = ( 1 - rt ).toFixed( 3 );
  }

  // the swipe's readout climbs on the same capped arc the claim does, so the
  // sickle's answer and the check's answer rise at the same rate
  if ( flair.swipe >= 0 ) {
    const claim = flairNodes.swipe;
    const c = Math.min( 1, ( now - flair.at ) / ( FLAIR.life * 1000 ) );
    const climb = FLAIR.rise * flairClimb( c );
    claim.style.transform = "translate(-50%,-50%) translateY(" + ( -climb ).toFixed( 1 ) + "px)";
    claim.style.opacity = ( c < FLAIR.fade ? 1 : 1 - ( c - FLAIR.fade ) / ( 1 - FLAIR.fade ) ).toFixed( 3 );
  }

  // one clock settles the whole layer: every mote, the ring and the swipe
  // readout die inside FLAIR.life, so past it there is nothing left to paint
  if ( now - flair.at >= FLAIR.life * 1000 ) {
    flair.at = -1;
    flair.live = 0;
    flair.swipe = -1;
    flair.lastAt = -1;
    layer.hidden = true;
    flairNodes.ring.style.display = "none";
    flairNodes.swipe.style.display = "none";
    flairNodes.swipe.textContent = "";
    // the motes go out with the layer rather than staying displayed under a
    // hidden parent, so a harness that counts what is showing counts nothing
    // once the burst is over
    for ( let i = 0; i < FLAIR.pool; i++ ) flairNodes.spark[ i ].style.display = "none";
  }
}

export const skill = {
  active: false,
  tier: -1,
  index: -1,
  // what the live check is bound to: "" before the first arm, "plant" for a
  // stalk and "beast" for an animal standing in the stand. The two share one
  // meter and one grading, so only the sweep and what a pass does differ
  target: "",
  // seconds this check's needle takes to cross the track: the cut's own 1.5 s
  // for a stalk, the animal's shorter sweep for a beast. Kept on the check so
  // the one line that advances the needle never has to know which it is on
  sweep: SKILL.sweep,
  x: 0, // where the click landed, so the meter stays put while the cursor roams
  y: 0,
  zone: 0, // centre of the target zone, 0..1 along the track
  needle: 0, // 0..1 along the track
  startedAt: 0,
  at: 0, // where the needle was when the last click landed
  last: "", // "" | fail | normal | good | great
  gold: 0, // the money the last pass paid in, 0 for a miss
  verdictAt: -1, // when the last verdict was shown, -1 before the first check
  // when the last click the ring refused landed, -1 before the first refusal.
  // A click on a plant the hand cannot reach arms no meter and spends no check,
  // so the refusal is the only outcome that would otherwise read as a dead
  // cursor - the corner readout names it for as long as the click is fresh
  farAt: -1,
};

// the animal this check is bound to, kept apart from the literal above for the
// same reason hover.beast is kept apart: the beast carries the mesh it wears and
// the mesh carries the scene it stands in, so a plain property would make the
// check circular and JSON.stringify( skill ) - which is how the harnesses read
// the meter back - would throw rather than print the gauge it was promised
Object.defineProperty( skill, "beast", { value: null, writable: true, enumerable: false, configurable: true } );

// the grade is a distance from the zone centre against the nested bands, so
// one subtraction decides all four variants
export function gradeAt( pos ) {
  const d = Math.abs( pos - skill.zone );
  if ( d <= bands.great ) return "great";
  if ( d <= bands.good ) return "good";
  if ( d <= bands.normal ) return "normal";
  return "fail";
}

// the same arming, bound to an animal rather than a stalk: one meter, one
// grading and one ring, so only the sweep and what a pass does differ. The
// sweep is the animal's own and shorter, which is what makes the check about a
// beast the same rule at a riskier window rather than a second game. Reach is
// measured the way a plant's is - off the field position, from the player's own
// seat - so the ring both tools answer to is one ring
function armBeast( b ) {
  if ( fromPlayerD2( b.x, b.z ) > hand.reach2 ) {
    // the animal is outlined by nothing and the hand cannot touch it: no meter,
    // no check spent, and the readout says so rather than leaving a dead cursor
    skill.farAt = performance.now();
    return;
  }
  skill.active = true;
  skill.target = "beast";
  skill.beast = b;
  skill.sweep = BEAST_RULE.attack.sweep;
  // the check is bound to the animal rather than to a stalk, so the plant pick
  // stays out of it and a pass can never reach cutPlant
  skill.tier = -1;
  skill.index = -1;
  // the meter floats over the middle of the animal's body rather than over the
  // cursor, so the gauge reads as the animal's own answer
  skill.x = hover.beastX;
  skill.y = hover.beastY;
  // the zone centre stays a whole normal band plus the lead in from both ends,
  // which is what makes an instant click a guaranteed miss
  const span = 1 - 2 * ( bands.normal + SKILL.lead );
  skill.zone = bands.normal + SKILL.lead + Math.random() * span;
  skill.needle = 0;
  skill.startedAt = performance.now();
}

export function armSkill() {
  // a spent hand: the check does not arm, so no meter appears, no check is
  // spent and nothing is cut. The readout names the hand as down rather than
  // leaving the click on it to read as a dead cursor
  if ( health.hp <= 0 ) return;
  // an animal standing under the cursor answers the click ahead of any plant
  // behind it, so a hand aimed at a beast is a hand aimed at the beast
  if ( hover.beast ) {
    armBeast( hover.beast );
    return;
  }
  if ( hover.tier < 0 ) return; // nothing under the cursor: nothing to check
  // the ring: a plant the hand cannot touch is outlined for inspection but
  // never armed, so a click there spends nothing and no meter appears. The
  // root is what is measured - the same point the reap measures - so the check
  // and the blade agree on which plants the player is standing in
  const held = field.tiers[ hover.tier ];
  const o = hover.index * 16;
  if ( fromPlayerD2( held.instanceMatrix.array[ o + 12 ], held.instanceMatrix.array[ o + 14 ] ) > hand.reach2 ) {
    // the plant is outlined but the hand is not near it: no meter, no check
    // spent, nothing cut - and the readout says so rather than leaving the
    // viewer to wonder whether the click did anything
    skill.farAt = performance.now();
    return;
  }
  skill.active = true;
  skill.target = "plant";
  skill.beast = null;
  skill.sweep = SKILL.sweep;
  skill.tier = hover.tier;
  skill.index = hover.index;
  skill.x = hover.x;
  skill.y = hover.y;
  // the zone centre stays a whole normal band plus the lead in from both ends,
  // which is what makes an instant click a guaranteed miss
  const span = 1 - 2 * ( bands.normal + SKILL.lead );
  skill.zone = bands.normal + SKILL.lead + Math.random() * span;
  skill.needle = 0;
  skill.startedAt = performance.now();
}

export function resolveSkill() {
  const grade = gradeAt( skill.needle );
  skill.at = skill.needle;
  skill.last = grade;
  // an animal rather than a stalk: the grade is the same rule and the meter is
  // the same gauge, but the pass pays one animal a grade-scaled hit rather than
  // cutting a stalk - so the harvest counts and the combo run stay exactly as the
  // cut's own table left them and no plant is left standing shorter. An animal the
  // hit brings down pays its species' coin into the purse, which is what the
  // verdict names below it; one that only went off pays nothing, and neither kind
  // of pass lands in a run
  if ( skill.target === "beast" ) {
    const prey = skill.beast;
    skill.gold = 0;
    spawnFlair( skill.x, skill.y, flairTier( grade, combo.streak ), -1 );
    skill.verdictAt = performance.now();
    skill.active = false;
    if ( grade !== "fail" ) {
      // what the purse held before the answer, so the verdict can name the coin
      // this check actually paid rather than the number a species' table would
      // have paid: an animal that only went off pays nothing and one that came
      // down pays its species' hide
      const earned = purse.earned;
      strikeBeast( prey, grade );
      skill.gold = purse.earned - earned;
      // the species that answered keys the cue, which is what lets a harness
      // prove the answer the animal paid rather than the cut's
      playSound( grade === "great" ? SOUND.great : SOUND.normal, prey ? prey.spec.id : grade );
    } else {
      playSound( SOUND.hurt, grade );
      // the swing went wrong, but the answer belongs to the animal rather than to
      // the arm: nothing is spent off the hand's own day. A missed cut costs the
      // arm because the arm is what a cut answers to; a check about an animal
      // answers to that animal's hide, and a failed one leaves the hide it never
      // touched and the day it never spent both alone - the risk the shorter
      // sweep carries is a lost hit rather than a bite the player owes
    }
    skill.beast = null;
    return;
  }
  // the money the pass paid in, kept on the check so the verdict can name it.
  // A miss is not in the table, so it earns nothing and the verdict stays bare
  skill.gold = earnGold( grade );
  // the purse answers at the very point the blade went through, dressed by the
  // run this cut just landed in - earnGold above already settled the streak, so
  // the tier reads the run the player actually has rather than the one before it
  spawnFlair( skill.x, skill.y, flairTier( grade, combo.streak ), -1 );
  skill.verdictAt = performance.now();
  skill.active = false;
  harvest[ grade ] = harvest[ grade ] + 1;
  if ( grade !== "fail" ) {
    cutPlant( skill.tier, skill.index, SKILL.stub[ grade ] );
    harvest.cut = harvest.cut + 1;
    // the great band gets its own cue, good and normal share the ordinary cut
    playSound( grade === "great" ? SOUND.great : SOUND.normal, grade );
  } else {
    playSound( SOUND.hurt, grade );
    // the swing was made and nothing was cut, so the arm paid for it. The cost
    // is the bare table's, so a honed blade or a gilded one changes what a miss
    // is worth to the purse rather than what it costs the hand
    hurt( HP.fail );
  }
}

export function cutPlant( tier, index, share ) {
  const mesh = field.tiers[ tier ];
  const m = mesh.instanceMatrix.array;
  const o = index * 16;
  // the plant's real height is the length of its up column and the cut plane is
  // share of that up from the root; both are read before the shrink below, which
  // is what the fragment burst is aimed at
  const hy = Math.hypot( m[ o + 1 ], m[ o + 5 ], m[ o + 9 ] );
  const px = m[ o + 12 ];
  const pz = m[ o + 14 ];
  // the instance origin is the plant's root, so scaling the three basis
  // columns shrinks the whole plant toward the ground and leaves a stubble
  for ( let c = 0; c < 3; c++ ) {
    const b = o + c * 4;
    m[ b ] *= share;
    m[ b + 1 ] *= share;
    m[ b + 2 ] *= share;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.cut[ index ] = 1;
  // the head does not survive the blade: flag the instance so the rice material
  // folds the panicle onto a point and the stubble left behind is culm and
  // leaves rather than a whole plant shrunk to a seedling. The cut is bit 1 of
  // the shared flag float, and a cut plant is never the picked one, so bit 0
  // goes with it
  const flags = mesh.geometry.getAttribute( "aFlags" );
  flags.array[ index ] = 2;
  flags.needsUpdate = true;
  // the slice: the severed part does not vanish, it goes into the air, wearing
  // the colour of the plant it came off
  const tint = mesh.geometry.getAttribute( "aTint" );
  const t = index * 3;
  spawnCutFx( px, hy * share, pz, hy * ( 1 - share ), tint.array[ t ], tint.array[ t + 1 ], tint.array[ t + 2 ] );
}

// ---------------------------------------------------------------------------
// The cut, made visible: five fragments per pass.
//
// A pass does more than shrink a plant - it slices it, and the severed part has
// to go somewhere. It goes into the air: CUT_FX.perts slivers of leaf tear off
// along the cut, tumble over downwind (the same world direction the wind shader
// bends the rice along) and settle on the paddy floor.
//
// All of them share ONE InstancedMesh, so a cut costs no draw call and no
// allocation: the slots live in a ring buffer, and a dead slot is parked at
// zero scale, which collapses its four verts onto one point and rasterises
// nothing. The pool is sized for a whole sickle swathe at the default burst
// size - a swipe may take as many plants as still fit in it, which is what
// SICKLE.max derives - so the field never gets near it either.
//
// Nothing is blended here either: the fragments are opaque bits of leaf, so they
// take the depth test exactly like the rice does and the scene's "any order
// paints the same pixels" rule still holds. A fragment fades by shrinking
// rather than by alpha, which is what keeps it out of a transparent queue.
//
// The colour comes from the plant that was cut - the aTint the field already
// stores per instance - mixed toward the pale straw of a freshly torn end, so a
// fragment belongs to its own plant rather than to a generic particle sprite.
// ---------------------------------------------------------------------------
export const CUT_FX = {
  perts: params.perts, // fragments a cut throws off; ?perts= overrides
  pool: 192,           // slots the one draw call carries: sized so one sickle
                       // swipe at the default burst size still fits whole (see
                       // SICKLE.max, which derives from this)
  life: 1.5,           // seconds a fragment stays on screen
  fall: 4.2,           // m/s of gravity: a leaf is light, so it floats down
  drift: 0.9,          // m/s of wind push on a fragment, scaled by uWind
  floor: 0.006,        // how far above the paddy floor a resting fragment sits
};

// the world-space downwind direction the wind shader bends the rice along, and
// the horizontal direction at right angles to it
const DOWNWIND_X = 0.974732, DOWNWIND_Z = 0.25343;

export const cutFx = {
  mesh: null,
  pool: 0,
  cursor: 0, // next slot the ring buffer hands out
  live: 0, // fragments on screen right now
  alive: null, // 0 / 1 per slot
  age: null,
  life: null,
  size: null, // uniform scale of the sliver, so the cap reads bigger than a shaving
  pos: null,
  vel: null,
  rot: null,
  spin: null,
};

// A sliver of leaf: one tapered quad, two triangles, authored at real size so
// the per-instance scale only ever fine-tunes it. The white vertex colours are
// what let the per-instance colour through - the same pattern the tree canopies
// already use.
function cutFxGeometry() {
  const L = 0.1;
  const W = 0.011; // the leaf half width plants.js gives a near plant
  const geo = new THREE.BufferGeometry();
  geo.setAttribute( "position", new THREE.Float32BufferAttribute( [
    -L * 0.5, -W, 0,
    L * 0.5, -W * 0.24, 0,
    L * 0.5, W * 0.24, 0,
    -L * 0.5, W, 0,
  ], 3 ) );
  geo.setAttribute( "normal", new THREE.Float32BufferAttribute( [ 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1 ], 3 ) );
  geo.setAttribute( "color", new THREE.Float32BufferAttribute( [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ], 3 ) );
  geo.setIndex( [ 0, 1, 2, 0, 2, 3 ] );
  return geo;
}

// The fragment pose written straight into the instance matrix: three basis
// columns of a yaw / pitch / roll rotation times the shrinking scale, then the
// position. Doing it here rather than through an Object3D keeps a cut to plain
// array writes - there is no dummy to compose and no matrix to copy.
function writeFxMatrix( i, shrink ) {
  const m = cutFx.mesh.instanceMatrix.array;
  const o = i * 16;
  const p = i * 3;
  const s = cutFx.size[i] * shrink;
  m[o + 12] = cutFx.pos[p];
  m[o + 13] = cutFx.pos[p + 1];
  m[o + 14] = cutFx.pos[p + 2];
  m[o + 15] = 1;
  if ( s <= 0 ) {
    m[o] = 0; m[o + 1] = 0; m[o + 2] = 0;
    m[o + 4] = 0; m[o + 5] = 0; m[o + 6] = 0;
    m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = 0;
    return;
  }
  const rx = cutFx.rot[p], ry = cutFx.rot[p + 1], rz = cutFx.rot[p + 2];
  const cx = Math.cos( rx ), sx = Math.sin( rx );
  const cy = Math.cos( ry ), sy = Math.sin( ry );
  const cz = Math.cos( rz ), sz = Math.sin( rz );
  m[o] = cz * cy * s;
  m[o + 1] = sz * cy * s;
  m[o + 2] = -sy * s;
  m[o + 4] = ( cz * sy * sx - sz * cx ) * s;
  m[o + 5] = ( sz * sy * sx + cz * cx ) * s;
  m[o + 6] = cy * sx * s;
  m[o + 8] = ( cz * sy * cx + sz * sx ) * s;
  m[o + 9] = ( sz * sy * cx - cz * sx ) * s;
  m[o + 10] = cy * cx * s;
}

// the meter nodes are looked up once and kept: paintMeter runs every frame and
// a getElementById per frame across five nodes is pure overhead
let meterNode = null;
let meterVerdict = null;

// the claim's three spans, looked up once and kept: paintMeter runs every frame,
// and the spans are made on the first verdict that lands and reused after it
let verdictWord = null;
let verdictGain = null;
let verdictRun = null;

// the meter advances on the wall clock rather than on perf.simTime, so a paused
// field still plays the check - pausing holds the environment, not the UI
export function stepSkill( now ) {
  if ( skill.active ) {
    skill.needle = ( now - skill.startedAt ) / ( skill.sweep * 1000 );
    // the needle reached the far end with no click: that is a miss, and the
    // lead rule means gradeAt(1) can never read as a pass
    if ( skill.needle >= 1 ) {
      skill.needle = 1;
      resolveSkill();
    }
  }
  paintMeter( now );
}

function paintMeter( now ) {
  const el = meterNode || ( meterNode = document.getElementById( "skill" ) );
  if ( !el ) return;
  // one gauge and one grading for both answers the hand makes, but the glass says
  // which answer it belongs to before any grade has landed: a check aimed at an
  // animal wears orange rather than the crop's green, which is what tells the
  // player the hide rather than the arm is what this check spends - and that a
  // failed one spends neither. The class is written rather than a style so the
  // ladder lives in the stylesheet with the rest of the glass's look
  el.classList.toggle( "beast", skill.target === "beast" );
  if ( !meterVerdict ) meterVerdict = document.getElementById( "skill-verdict" );
  const showing = skill.active || ( skill.verdictAt >= 0 && now - skill.verdictAt < SKILL.verdict * 1000 );
  if ( !showing ) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  // anchor the track above the plant the click landed on and clamp it, so a
  // plant near a screen edge still gets a whole meter rather than a clipped one
  const w = el.clientWidth || 190;
  const x = Math.max( 8, Math.min( window.innerWidth - w - 8, skill.x - w * 0.5 ) );
  const y = Math.max( 26, Math.min( window.innerHeight - 40, skill.y - 96 ) );
  el.style.left = x.toFixed( 0 ) + "px";
  el.style.top = y.toFixed( 0 ) + "px";
  const pct = ( v ) => ( v * 100 ).toFixed( 2 ) + "%";
  for ( const key of [ "normal", "good", "great" ] ) {
    const band = document.getElementById( "skill-" + key );
    if ( !band ) continue;
    const half = bands[ key ];
    band.style.left = pct( skill.zone - half );
    band.style.width = pct( half * 2 );
  }
  const needle = document.getElementById( "skill-needle" );
  if ( needle ) needle.style.left = pct( skill.needle );
  if ( meterVerdict ) {
    const fresh = skill.verdictAt >= 0 && now - skill.verdictAt < SKILL.verdict * 1000;
    if ( !fresh ) {
      // the meter is armed but no verdict has landed yet: the claim stays empty,
      // which is what keeps a harness reading "" rather than a stale claim
      if ( verdictWord ) {
        verdictWord.textContent = "";
        verdictGain.textContent = "";
        verdictRun.textContent = "";
      } else {
        meterVerdict.textContent = "";
      }
      meterVerdict.style.display = "none";
      return;
    }
    // the run decides how dressed the claim is, and the tier is a class rather
    // than a style so the ladder lives in the stylesheet with the rest of the
    // purse's look
    const tier = flairTier( skill.last, combo.streak );
    meterVerdict.className = "verdict " + skill.last + " f" + tier;
    // the claim is one string the harnesses read back, so its three parts are
    // written as three spans with no whitespace between them: the element's
    // textContent still concatenates to exactly the claim it was promised, while
    // the glass can dress the grade, the run and the coin separately
    if ( !verdictWord ) {
      verdictWord = document.createElement( "span" );
      verdictWord.className = "word";
      verdictGain = document.createElement( "span" );
      verdictGain.className = "gain";
      verdictRun = document.createElement( "span" );
      verdictRun.className = "run";
      meterVerdict.appendChild( verdictWord );
      // the run goes on before the gold: the claim reads grade, run, coin, so
      // the order the spans are appended in is the order the parts are built in
      // and the order the harnesses read the claim back in
      meterVerdict.appendChild( verdictRun );
      meterVerdict.appendChild( verdictGain );
    }
    const parts = verdictParts( skill.last, skill.target === "beast" );
    verdictWord.textContent = parts.word;
    verdictGain.textContent = parts.gain;
    verdictRun.textContent = parts.run;
    // the claim lifts off the very point the blade went through rather than
    // sitting above the meter. The meter's own box is clamped to the glass, so
    // the cut point is measured back from it rather than assumed, and the popup
    // is held inside the glass by the same 12px the meter keeps for its edges
    const cx = Math.max( 12 - x, Math.min( window.innerWidth - 12 - x, skill.x - x ) );
    const cy = Math.max( 12 - y, Math.min( window.innerHeight - 12 - y, skill.y - y ) );
    meterVerdict.style.left = cx.toFixed( 0 ) + "px";
    meterVerdict.style.top = cy.toFixed( 0 ) + "px";
    // the climb is capped at FLAIR.rise and eased out, so the words read as a
    // firework's rocket that rises and settles rather than as a caption that
    // walks off the glass; the punch in overshoots and lands on the beat, which
    // is what makes the claim arrive rather than appear
    const age = ( now - skill.verdictAt ) / ( SKILL.verdict * 1000 );
    const climb = FLAIR.rise * flairClimb( age );
    const p = Math.min( 1, age / FLAIR.pop );
    const q = p - 1;
    const punch = 1 + 2.7 * q * q * q + 1.7 * q * q;
    meterVerdict.style.display = "";
    meterVerdict.style.transform = "translate(-50%,-50%) translateY(" + ( -climb ).toFixed( 1 ) + "px) scale(" + ( 0.56 + 0.44 * punch ).toFixed( 3 ) + ")";
    meterVerdict.style.opacity = ( age < FLAIR.fade ? 1 : 1 - ( age - FLAIR.fade ) / ( 1 - FLAIR.fade ) ).toFixed( 3 );
  }
}

function verdictParts( grade, runless ) {
  // the claim's three parts, so the display can dress the grade, the run it is
  // in and the gold it paid separately. They are written in the order the glass
  // appends them - grade, run, gold - and each carries the space that belongs
  // to the part after it rather than to the part before, which is what lets the
  // spans sit flush against each other and still read as one line: "$1" for a
  // normal cut, "Good $2", "GREAT $3" for the great that opens a run and
  // "GREAT 6 Combo $8" once the run is a run
  const gain = skill.gold > 0 ? "$" + skill.gold : "";
  // the run earns a name only once it is a run: the great that opens one reads
  // exactly as a lone cut did, so the count never claims a combo of one. runless
  // is set for a check about an animal, which lands in no run whatever the grade,
  // so the glass cannot dress a streak the animal's pass did not make
  const run = !runless && grade === "great" && combo.streak > 1 ? combo.streak + " Combo " : "";
  // a normal cut is worth its gold alone, so the grade the purse already named
  // stays out of the claim and the claim is just the coin
  const word = grade === "great" ? "GREAT " : grade === "good" ? "Good " : grade === "normal" ? "" : grade === "fail" ? "Missed" : "";
  return { word, gain, run };
}

function verdictText( grade ) {
  // the whole claim, for anything that wants the one string rather than the
  // three parts the glass dresses - and the string the harnesses read back out
  // of #skill-verdict is this concatenation, spaces and all. The runless flag
  // is the live check's own, so the one string and the three spans the glass
  // dresses agree about which checks land in a run
  const parts = verdictParts( grade, skill.target === "beast" );
  return parts.word + parts.run + parts.gain;
}

// ---------------------------------------------------------------------------
// Sound. Five files, and none of them is fetched until it is asked for: an
// Audio element made with preload="none" costs nothing on the wire until play(),
// so a field that never reaches an hour's loop and is never cut never moves a
// byte over the network.
//
// The hour owns two of them and they take turns over the day. samllbirdvoice
// (the small bird, spelled as the file on disk is) calls through the daylight
// hours - morning and afternoon - and higurashi (the evening cicada, whose cry
// is what marks dusk over the paddies) takes over for as long as the field is
// under the golden preset, the page's sunset hour. Whichever loop is running is
// stopped and rewound the moment its hour leaves, so the hour that asks for a
// file again starts it at the top of its loop rather than at wherever the last
// one left it.
//
// A loop is owned only once the browser has accepted its play. The autoplay
// policy refuses one before the visitor has touched the page, and a refused
// play never asks for the mp3 at all - the element stays at readyState 0 - so
// owning the hour on the file name alone would silence the whole session, since
// the hour never asks again for a file it already believes it has. A refusal
// therefore leaves the hour unowned and the next frame asks again, which is what
// brings the bird in the moment the visitor moves.
//
// The skill check owns the other three, and it answers itself: a great cut, an
// ordinary cut (good and normal share one cue) and a miss.
// ---------------------------------------------------------------------------
export const SOUND = {
  bird: "samllbirdvoice.mp3", // the small bird's call
  ambience: "higurashi.mp3", // the evening cicada
  great: "cutgreat.mp3",
  normal: "cutnormal.mp3",
  hurt: "hurt.mp3",
  golden: "golden", // the hour the cicada belongs to
  birdHours: [ "morning", "afternoon" ], // the hours the small bird belongs to
  ambienceVolume: 0.55, // the loop sits under the field rather than over it
  effectVolume: 0.9,
};

export const sound = {
  volume: Math.min( 1, Math.max( 0, params.sound ) ), // ?sound=0 mutes the field
  ambience: null, // the looping element while the current hour's loop holds
  ambienceName: "", // which loop file that element is, "" while nothing loops
  pending: false, // a loop play the browser has not answered yet
  plays: [], // what the page chose to play, oldest first: { name, reason, at, stop }
  elements: {}, // file -> element, so a cue is fetched once and replayed from memory
};

// the element for a file, made on the first request and kept: replaying a cue
// never re-requests the mp3. Both hour loops share the low ambience volume and
// sit under the field; only the cues get the loud one
function element( name ) {
  const held = sound.elements[ name ];
  if ( held ) return held;
  const a = new Audio( name );
  a.preload = "none";
  a.volume = sound.volume * ( name === SOUND.ambience || name === SOUND.bird ? SOUND.ambienceVolume : SOUND.effectVolume );
  sound.elements[ name ] = a;
  return a;
}

// the record is a small ring: a long session cuts many plants, and a growing
// array of play records is the one thing this page would otherwise leak
function logPlay( name, reason, stop ) {
  sound.plays.push( { name, reason, at: performance.now(), stop } );
  if ( sound.plays.length > 64 ) sound.plays.shift();
}

// one shot, from the start. play() answers a promise the browser may refuse
// (its autoplay policy wants a user gesture first on some platforms); the
// refusal is swallowed on purpose - the field keeps running and the console
// stays clean, which is the one thing the harnesses count
export function playSound( name, reason ) {
  if ( sound.volume <= 0 ) return;
  const a = element( name );
  a.loop = false;
  a.currentTime = 0;
  a.play().catch( () => {} );
  logPlay( name, reason, false );
}

// which file the hour is asking for: the small bird owns the daylight hours and
// the cicada owns the golden one, so the field always has one voice over it
// rather than a silence between the cues
function loopFor( hour ) {
  if ( hour === SOUND.golden ) return SOUND.ambience;
  if ( SOUND.birdHours.indexOf( hour ) >= 0 ) return SOUND.bird;
  return "";
}

// the loops follow the hour rather than the pause: a paused field keeps its
// light, so it keeps its bird and its insects
export function ambience() {
  const want = loopFor( state.light );
  // the hour already owns the loop it wants, so there is nothing to swap - and
  // a bird that carries on from morning into afternoon never restarts mid-call
  if ( want === sound.ambienceName ) return;
  // the last attempt is still being answered by the browser, so nothing is
  // known about it yet: waiting one frame is cheaper than starting a second
  // fetch for the same file behind it
  if ( sound.pending ) return;
  if ( sound.ambience ) {
    const left = sound.ambienceName;
    sound.ambience.pause();
    // rewind so the hour that asks for this file again starts it at the top of
    // its loop rather than from wherever this hour left it
    sound.ambience.currentTime = 0;
    sound.ambience = null;
    sound.ambienceName = "";
    logPlay( left, "left the hour", true );
  }
  // a muted page never makes an element at all, and an hour with no loop of its
  // own never asks for one
  if ( !want || sound.volume <= 0 ) return;
  const a = element( want );
  a.loop = true;
  a.currentTime = 0;
  // a play() before the visitor has touched the page is refused outright: the
  // browser's autoplay policy wants a user gesture first, and a refused play
  // leaves the element at readyState 0 - the mp3 is never even asked for. Owning
  // the loop on the name alone would therefore silence the whole session, since
  // the hour never asks again for a file it already believes it has. So the loop
  // is owned only once its play has actually been accepted, and a refusal leaves
  // the hour unowned: the next frame asks again, and the bird starts the moment
  // the visitor moves
  sound.pending = true;
  const accepted = () => {
    sound.pending = false;
    sound.ambience = a;
    sound.ambienceName = want;
    logPlay( want, state.light, false );
  };
  // the refusal is still swallowed on purpose - the field keeps running and the
  // console stays clean - but it leaves nothing owning the hour, which is what
  // lets the next frame ask for the loop again
  const refused = () => {
    sound.pending = false;
    sound.ambience = null;
    sound.ambienceName = "";
  };
  const attempt = a.play();
  if ( attempt ) attempt.then( accepted, refused );
  else accepted(); // a browser that hands back no promise never refuses one
}

// The pool is built once, with every slot parked at zero scale: four verts on
// one point, nothing rasterised, and the one draw call stays one draw call
// whether or not the field has ever been cut.
function buildFx() {
  const geo = cutFxGeometry();
  const mat = new THREE.MeshLambertMaterial( {
    color: "#ffffff",
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: true,
  } );
  const f = cutFx;
  const mesh = new THREE.InstancedMesh( geo, mat, CUT_FX.pool );
  f.mesh = mesh;
  f.pool = CUT_FX.pool;
  f.alive = new Uint8Array( f.pool );
  f.age = new Float32Array( f.pool );
  f.life = new Float32Array( f.pool );
  f.size = new Float32Array( f.pool );
  f.pos = new Float32Array( f.pool * 3 );
  f.vel = new Float32Array( f.pool * 3 );
  f.rot = new Float32Array( f.pool * 3 );
  f.spin = new Float32Array( f.pool * 3 );
  // the colour buffer is made once here, so a spawn is an array write rather
  // than a Color object per fragment
  mesh.instanceColor = new THREE.InstancedBufferAttribute( new Float32Array( f.pool * 3 ), 3 );
  const m = mesh.instanceMatrix.array;
  for ( let i = 0; i < f.pool; i++ ) m[ i * 16 + 15 ] = 1;
  // the geometry's own bounds say "one sliver at the origin", which says nothing
  // about where the fragments actually are
  mesh.frustumCulled = false;
  // opaque and tiny, so the submission order only ever buys early-z
  mesh.renderOrder = 0;
  scene.add( mesh );
}

// x / y / z is the cut plane, span is how much plant was severed, and r / g / b
// is that plant's own tint. The first fragment is the cap - the severed top
// itself, which is why it is the biggest, the slowest and the least flung.
export function spawnCutFx( x, y, z, span, r, g, b ) {
  const f = cutFx;
  const n = CUT_FX.perts > 0 ? Math.round( CUT_FX.perts ) : 0;
  if ( f.pool === 0 || n === 0 ) return;
  const col = f.mesh.instanceColor.array;
  for ( let i = 0; i < n; i++ ) {
    const slot = f.cursor;
    f.cursor = f.cursor + 1 >= f.pool ? 0 : f.cursor + 1;
    // reusing a live slot means the fragment that was in it dies here, so the
    // live count only moves when the slot was free
    if ( f.alive[slot] === 0 ) f.live++;
    f.alive[slot] = 1;
    const p = slot * 3;
    const cap = i === 0;
    // torn off along the severed part rather than all from one point
    const along = cap ? 0.62 : 0.12 + Math.random() * 0.72;
    f.pos[p] = x + ( Math.random() - 0.5 ) * 0.1;
    f.pos[p + 1] = y + Math.max( 0.02, span ) * along;
    f.pos[p + 2] = z + ( Math.random() - 0.5 ) * 0.1;
    // downwind and a little across: the severed part topples the way the wind
    // bends the rest of the stand
    const fwd = ( cap ? 0.3 : 0.45 ) + Math.random() * ( cap ? 0.4 : 0.95 );
    const side = ( Math.random() - 0.5 ) * 0.8;
    f.vel[p] = DOWNWIND_X * fwd - DOWNWIND_Z * side;
    f.vel[p + 1] = ( cap ? 0.12 : 0.35 ) + Math.random() * ( cap ? 0.3 : 0.75 );
    f.vel[p + 2] = DOWNWIND_Z * fwd + DOWNWIND_X * side;
    f.rot[p] = Math.random() * 6.2832;
    f.rot[p + 1] = Math.random() * 6.2832;
    f.rot[p + 2] = Math.random() * 6.2832;
    const rpm = ( cap ? 1.2 : 3.0 ) + Math.random() * ( cap ? 1.6 : 6.0 );
    f.spin[p] = rpm * ( Math.random() - 0.5 ) * 2;
    f.spin[p + 1] = rpm * ( Math.random() - 0.5 ) * 2;
    f.spin[p + 2] = rpm * ( Math.random() - 0.5 ) * 2;
    f.size[slot] = ( cap ? 1.7 : 0.55 ) + Math.random() * ( cap ? 0.6 : 0.62 );
    f.age[slot] = 0;
    f.life[slot] = CUT_FX.life * ( cap ? 1.15 : 0.7 + Math.random() * 0.45 );
    // the plant's own colour mixed toward the pale straw of a torn end
    const mix = 0.3 + Math.random() * 0.34;
    const v = 0.86 + Math.random() * 0.26;
    col[p] = ( r + ( 1.22 - r ) * mix ) * v;
    col[p + 1] = ( g + ( 1.06 - g ) * mix ) * v;
    col[p + 2] = ( b + ( 0.6 - b ) * mix ) * v;
    // written here as well as in stepFx: a recycled slot still carries the pose
    // of the fragment that was in it, and that pose must not survive this frame
    writeFxMatrix( slot, 1 );
  }
  f.mesh.instanceMatrix.needsUpdate = true;
  f.mesh.instanceColor.needsUpdate = true;
}

// The fragments take the same capped simulation step as the stalks, so pausing
// holds them mid-air along with everything else in the environment.
export function stepFx( dt ) {
  const f = cutFx;
  if ( f.pool === 0 || f.live === 0 ) return;
  const m = f.mesh.instanceMatrix.array;
  // the wind catches a fragment as it bends the stand
  const push = CUT_FX.drift * ( 0.2 + uniforms.uWind.value ) * dt;
  let touched = false;
  for ( let i = 0; i < f.pool; i++ ) {
    if ( f.alive[i] === 0 ) continue;
    const p = i * 3;
    const a = f.age[i] + dt;
    if ( a >= f.life[i] ) {
      f.alive[i] = 0;
      f.live--;
      const o = i * 16;
      m[o] = 0; m[o + 1] = 0; m[o + 2] = 0;
      m[o + 4] = 0; m[o + 5] = 0; m[o + 6] = 0;
      m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = 0;
      m[o + 15] = 1;
      touched = true;
      continue;
    }
    f.age[i] = a;
    f.vel[p] += DOWNWIND_X * push;
    f.vel[p + 2] += DOWNWIND_Z * push;
    f.vel[p + 1] -= CUT_FX.fall * dt;
    f.pos[p] += f.vel[p] * dt;
    f.pos[p + 1] += f.vel[p + 1] * dt;
    f.pos[p + 2] += f.vel[p + 2] * dt;
    if ( f.pos[p + 1] < CUT_FX.floor ) {
      f.pos[p + 1] = CUT_FX.floor;
      // a light fragment bounces once and then lies down on the paddy floor
      if ( f.vel[p + 1] < -0.5 ) f.vel[p + 1] = -f.vel[p + 1] * 0.24;
      else f.vel[p + 1] = 0;
      f.vel[p] *= 0.5;
      f.vel[p + 2] *= 0.5;
      f.spin[p] *= 0.25;
      f.spin[p + 1] *= 0.25;
      f.spin[p + 2] *= 0.25;
    }
    f.rot[p] += f.spin[p] * dt;
    f.rot[p + 1] += f.spin[p + 1] * dt;
    f.rot[p + 2] += f.spin[p + 2] * dt;
    // the last third of its life shrinks it away, so a fragment settles rather
    // than popping out of existence
    const t = a / f.life[i];
    writeFxMatrix( i, t < 0.7 ? 1 : 1 - ( t - 0.7 ) / 0.3 );
    touched = true;
  }
  if ( touched ) f.mesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// The sickle: the item the viewer holds, and the reaping it does.
//
// Drawing the sickle on the panel hands the pointer over to it. A held drag -
// a flick on a phone - then draws a line on the glass for as long as a second
// and never touches the camera: every standing plant whose stem projects within
// a blade's width of the line just drawn is cut at the stubble, so the swathe
// follows the hand rather than the view.
//
// The pick is the hover pick seen from the other side. pickPlant asks "which
// stem is nearest this one point"; reapSickle asks "which stems are near this
// line", and both answer it by pushing each plant's root and tip through the
// same camera matrix and measuring in canvas pixels - no ray against three
// thousand plants, and no world-space unprojection of the stroke either. The
// stroke stays on the glass because the glass is where the hand drew it.
//
// The item itself is one mesh, one material, one draw call: a grip and a
// crescent blade authored as ribbons in one geometry and told apart by vertex
// colour, the same way the tree trunks and the cut fragments are. It rides the
// camera as a scene child whose pose is copied over each frame, so it keeps its
// place in the frame whatever the viewer walks to, and it is hidden outright
// while the sickle is sheathed - which is why a field at rest still draws the
// same twelve calls it always did.
// ---------------------------------------------------------------------------
export const SICKLE = {
  draw: 1.0, // seconds a swipe may keep drawing for: a swipe, not a stroke
  band: 12, // canvas px either side of the line the blade reaches
  stub: 0.14, // stubble a sickle leaves, as a share of the plant's height
  vary: 0.06, // how much that stubble wanders along one swathe
  swish: 8, // plants one swipe has to clear to earn the great cue
  // plants one swipe may take at most. It is pinned to the fragment pool rather
  // than to a taste: a cut throws CUT_FX.perts fragments and the pool is the one
  // draw call's slots, so this is exactly the swathe whose bursts still fit
  // without recycling a live slot - a flick cannot mow the field, and it cannot
  // spend the fx pool either. Deriving it is what keeps the cap honest when
  // ?perts= moves the burst size
  max: Math.max( 6, Math.floor( CUT_FX.pool / Math.max( 1, CUT_FX.perts ) ) ),
  // where the item sits in the frame: right of centre, below the horizon,
  // about arm's length from the eye - all camera-space metres
  hx: 0.3,
  hy: -0.27,
  hz: -0.56,
};

// what the last swipe did, so a harness can read the reaping itself rather than
// infer it from pixels: the points the hand drew, the plants the blade took, and
// the band it used
export const sickle = {
  stroke: [], // canvas-space points, in the order the hand drew them, flat x,y
  pointerType: "", // "mouse" | "touch" | "pen": what the last swipe was drawn with
  band: 0, // px the last swipe actually used
  cut: [], // { tier, index, share } the last swipe took off
  swings: 0, // swipes begun this session
  plants: 0, // plants the sickle has taken off this session
  spent: false, // the second is used up: the rest of the drag draws nothing
  startedAt: 0, // when the last swipe began, on the wall clock
  lastAt: 0, // when the last point was actually drawn: a swipe longer than
  // SICKLE.draw seconds stops moving this number, which is what proves the
  // stroke is a swipe rather than a stroke
};

// the item's own pose state: the swing eased from the swipe, and the nodes the
// drawn line is painted into
export const sickleRig = { group: null, mesh: null, swing: 0 };

// A grip and a crescent blade, authored as flat ribbons in the sickle's own
// plane (x across, y up, the flat facing the viewer). The blade is an arc swept
// from forward to up-left, tapering from a thick heel to a point, which is what
// a crescent reads as from any angle; the grip is a short bent strip of the same
// sweep hung off the heel.
function sickleGeometry() {
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  const steel = new THREE.Color( "#c9cfc7" );
  const wood = new THREE.Color( "#6a4a2c" );

  // one ribbon along a polyline: each ring puts two verts either side of the
  // path, perpendicular to the run of the edge, so the strip keeps its width
  // round a curve
  const sweep = ( path, halfWidth, color ) => {
    const base = pos.length / 3;
    for ( let i = 0; i < path.length; i++ ) {
      const prev = path[ i > 0 ? i - 1 : i ];
      const next = path[ i < path.length - 1 ? i + 1 : i ];
      let dx = next[ 0 ] - prev[ 0 ];
      let dy = next[ 1 ] - prev[ 1 ];
      const len = Math.hypot( dx, dy ) || 1;
      dx /= len;
      dy /= len;
      const nx = -dy; // the in-plane perpendicular: the ribbon's width axis
      const ny = dx;
      const t = path.length > 1 ? i / ( path.length - 1 ) : 0;
      const w = halfWidth( t );
      const c = color( t );
      const p = path[ i ];
      pos.push( p[ 0 ] + nx * w, p[ 1 ] + ny * w, 0 );
      pos.push( p[ 0 ] - nx * w, p[ 1 ] - ny * w, 0 );
      nor.push( 0, 0, 1, 0, 0, 1 );
      col.push( c.r, c.g, c.b, c.r, c.g, c.b );
    }
    for ( let i = 0; i < path.length - 1; i++ ) {
      const a = base + i * 2;
      idx.push( a, a + 2, a + 3, a, a + 3, a + 1 );
    }
  };

  // the blade: thirteen rings round an arc of about 105 deg, heel to point
  const blade = [];
  const R = 0.14;
  for ( let i = 0; i < 13; i++ ) {
    const a = -0.2 + ( 1.66 - -0.2 ) * i / 12;
    blade.push( [ R * Math.cos( a ), 0.01 + R * Math.sin( a ) ] );
  }
  sweep(
    blade,
    ( t ) => 0.0115 * ( 1 - t ) * ( 1 - t ) + 0.0016,
    ( t ) => steel
  );

  // the grip: a short bent strip hung below the heel, thick enough to read as a
  // hand rather than as another sliver of leaf
  sweep(
    [
      [ 0.004, 0.006 ],
      [ -0.006, -0.05 ],
      [ -0.016, -0.1 ],
      [ -0.024, -0.16 ],
    ],
    ( t ) => 0.0115 - 0.0022 * t,
    ( t ) => wood
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute( "position", new THREE.Float32BufferAttribute( pos, 3 ) );
  geo.setAttribute( "normal", new THREE.Float32BufferAttribute( nor, 3 ) );
  geo.setAttribute( "color", new THREE.Float32BufferAttribute( col, 3 ) );
  geo.setIndex( idx );
  return geo;
}

// The item is built once and hidden: while the sickle is sheathed there is
// nothing to shade, so the field keeps the twelve draw calls it always had and
// a toggle costs no allocation.
function buildSickle() {
  const geo = sickleGeometry();
  const mat = new THREE.MeshLambertMaterial( {
    color: "#ffffff",
    vertexColors: true,
    side: THREE.DoubleSide,
    // the item is arm's length from the eye, so the field's haze has nothing
    // to say about it - the fog would only wash the steel
    fog: false,
  } );
  const mesh = new THREE.Mesh( geo, mat );
  mesh.visible = false;
  mesh.position.set( SICKLE.hx, SICKLE.hy, SICKLE.hz );
  const group = new THREE.Group();
  // the camera's own rotation order, so copying its three angles over each
  // frame lands the item exactly where the frame says it should be
  group.rotation.order = "YXZ";
  group.add( mesh );
  scene.add( group );
  sickleRig.group = group;
  sickleRig.mesh = mesh;
}

// The blade drawn from the last point on the stroke to this one: every standing
// plant whose stem projects within the band of that segment is cut at the
// stubble. The stroke is capped at SICKLE.draw seconds, so a hand that keeps
// dragging after the second is up draws nothing - the swipe is spent.
export function beginStroke( x, y, type ) {
  sickle.stroke.length = 0;
  sickle.cut.length = 0;
  // a spent hand cannot swing: the press draws no line, spends no fee and cuts
  // nothing, so the swipe costs the purse nothing while the field is down. The
  // draw is marked spent so the drag that follows reaps nothing rather than
  // continuing a line that never started
  if ( health.hp <= 0 ) {
    sickle.spent = true;
    return;
  }
  sickle.stroke.push( x, y );
  sickle.pointerType = type;
  sickle.startedAt = performance.now();
  sickle.lastAt = sickle.startedAt;
  sickle.spent = false;
  // a fingertip is sloppier than a cursor, and hover.radius already encodes how
  // much sloppier: widening the band by the same amount keeps the blade honest
  sickle.band = SICKLE.band + Math.max( 0, hover.radius - 13 );
  // the swipe is a use of the tool, so the fee is spent on the press that
  // starts it rather than on the plants it finds: a line over already-cut
  // ground or open water still costs gold, which is what makes a flick a
  // decision rather than a free mow of the stand. gear.fee is that fee as the
  // blade oil leaves it, so an oiled field spends nothing on the press
  payGold( gear.fee );
  sickle.swings = sickle.swings + 1;
}

export function reapStroke( x, y ) {
  if ( sickle.spent ) return;
  const now = performance.now();
  if ( now - sickle.startedAt > SICKLE.draw * 1000 ) {
    sickle.spent = true;
    return;
  }
  const n = sickle.stroke.length;
  if ( n < 2 ) return;
  reapSickle( sickle.stroke[ n - 2 ], sickle.stroke[ n - 1 ], x, y );
  sickle.stroke.push( x, y );
  // the point landed on the glass at this instant, so a harness can tell a
  // swipe that ran out of second from one that never stopped drawing
  sickle.lastAt = now;
}

export function endStroke() {
  const took = sickle.cut.length;
  if ( took > 0 ) {
    // one cue per swipe, not one per plant: a swish that clears a whole
    // swathe answers with the great cut, a nick answers with the ordinary one
    playSound( took >= SICKLE.swish ? SOUND.great : SOUND.normal, "sickle" );
    // and it answers on the glass where the blade ended, with the same burst
    // the check answers with. A swathe is a swathe rather than a pass, so the
    // readout names the plants it took rather than a grade - but a swish earns
    // the wider fan, which is what lets a player see the swipe was worth more
    // than a nick without counting the readout
    const n = sickle.stroke.length;
    spawnFlair(
      n >= 2 ? sickle.stroke[ n - 2 ] : 0,
      n >= 2 ? sickle.stroke[ n - 1 ] : 0,
      took >= SICKLE.swish ? 2 : 0,
      took
    );
  }
  // the blade at arm's length answers a beast as well as the stand: the swipe
  // drives whatever was standing in the ring off rather than killing it, which
  // is what leaves a beast a hazard to be walked out of rather than a target to
  // be farmed. It runs after the reap rather than inside it, so the plants the
  // swipe took and the fee it paid are exactly as they were
  frightenBeasts();
  sickle.stroke.length = 0;
  sickle.spent = false;
}

const reapMatrix = new THREE.Matrix4();

function reapSickle( x0, y0, x1, y1 ) {
  const el = document.getElementById( "scene-canvas" );
  if ( !el ) return;
  const r = el.getBoundingClientRect();
  if ( r.width <= 0 || r.height <= 0 ) return;
  reapSickleOn( x0, y0, x1, y1, r.width, r.height );
}

// squared distance from a point to a segment: the band is a screen distance, so
// both the stem and the drawn line are walked in canvas px
function pointSegD2( px, py, ax, ay, bx, by ) {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  if ( l2 <= 1e-9 ) return ( px - ax ) * ( px - ax ) + ( py - ay ) * ( py - ay );
  let u = ( ( px - ax ) * vx + ( py - ay ) * vy ) / l2;
  if ( u < 0 ) return ( px - ax ) * ( px - ax ) + ( py - ay ) * ( py - ay );
  if ( u > 1 ) return ( px - bx ) * ( px - bx ) + ( py - by ) * ( py - by );
  const qx = ax + vx * u - px;
  const qy = ay + vy * u - py;
  return qx * qx + qy * qy;
}

// does the drawn segment pass within band of the whole stem: the blade went
// clean through it, or the closest the two segments come to each other is inside
// the band. For two segments that do not cross, that closest approach is always
// one of the four endpoint-to-segment gaps, so four of them settle the question
// exactly - a stem near the camera is 300 px tall on the glass, and a sampler
// that only rings it at a few heights leaves the middle of the stem untested
function stemInBand( ax, ay, bx, by, cx, cy, dx, dy, band2 ) {
  const abx = bx - ax;
  const aby = by - ay;
  const cdx = dx - cx;
  const cdy = dy - cy;
  const o1 = abx * ( cy - ay ) - aby * ( cx - ax );
  const o2 = abx * ( dy - ay ) - aby * ( dx - ax );
  const o3 = cdx * ( ay - cy ) - cdy * ( ax - cx );
  const o4 = cdx * ( by - cy ) - cdy * ( bx - cx );
  if ( o1 * o2 < 0 && o3 * o4 < 0 ) return true; // the blade crossed the stem
  if ( pointSegD2( ax, ay, cx, cy, dx, dy ) <= band2 ) return true;
  if ( pointSegD2( bx, by, cx, cy, dx, dy ) <= band2 ) return true;
  if ( pointSegD2( cx, cy, ax, ay, bx, by ) <= band2 ) return true;
  return pointSegD2( dx, dy, ax, ay, bx, by ) <= band2;
}

// The plant the player sees is not the straight column the instance matrix
// describes. Two things move it: the culm's own curve (plants.js bends the
// spine rather than drawing a rod) and the wind, which the vertex shader adds
// in world space after the instance matrix (PROJECT_WIND). At a stiff breeze a
// plant stands up to 0.15 m off its own column - 18 px of glass at arm's length,
// and more the closer the eye gets - so a blade aimed at the column misses a
// plant the player aimed at, which is what left plants standing under a drawn
// line. The reap therefore walks the same spine the geometry draws, pushed by
// the same wind term the shader applies for this frame; the spine itself lives
// in plants.js next to the numbers the geometry is built from, so the two
// cannot drift apart.
//
// Scratch for the spine's four points, reused across plants and across the
// reap's per-pointer-move calls so the walk allocates nothing.
const REAP_WIND = [ 0, 0, 0 ];
const REAP_PX = [ 0, 0, 0, 0 ];
const REAP_PY = [ 0, 0, 0, 0 ];

// One plant's drawn spine, in canvas px: the same spine the reap walks and the
// hover picks on, so what the eye calls "on the line" and what the blade takes
// are the same numbers rather than two guesses at a plant that leans. Fills px
// / py and returns how many of the spine's points landed in front of the eye.
function spineToScreen( e, m, o, wind, k4, zs, w, h, px, py ) {
  const x = m[ o + 12 ], y = m[ o + 13 ], z = m[ o + 14 ];
  const axx = m[ o ], axy = m[ o + 1 ], axz = m[ o + 2 ];
  const aux = m[ o + 4 ], auy = m[ o + 5 ], auz = m[ o + 6 ];
  const azx = m[ o + 8 ], azy = m[ o + 9 ], azz = m[ o + 10 ];
  const w0 = wind[ k4 ], w1 = wind[ k4 + 1 ], w2 = wind[ k4 + 2 ], w3 = wind[ k4 + 3 ];
  let n = 0;
  for ( let s = 0; s < REAP_SPINE.length; s += 6 ) {
    windOffset( w0, w1, w2, w3, zs, REAP_SPINE[ s + 3 ], REAP_SPINE[ s + 4 ], REAP_SPINE[ s + 5 ], REAP_WIND );
    const k = REAP_SPINE[ s ];
    const lx = REAP_SPINE[ s + 1 ], lz = REAP_SPINE[ s + 2 ];
    const wx = x + axx * lx + aux * k + azx * lz + REAP_WIND[ 0 ];
    const wy = y + axy * lx + auy * k + azy * lz + REAP_WIND[ 1 ];
    const wz = z + axz * lx + auz * k + azz * lz + REAP_WIND[ 2 ];
    const cw = e[ 3 ] * wx + e[ 7 ] * wy + e[ 11 ] * wz + e[ 15 ];
    if ( cw <= 0.05 ) continue; // this point of the stem is behind the eye
    px[ n ] = ( ( e[ 0 ] * wx + e[ 4 ] * wy + e[ 8 ] * wz + e[ 12 ] ) / cw * 0.5 + 0.5 ) * w;
    py[ n ] = ( 0.5 - ( e[ 1 ] * wx + e[ 5 ] * wy + e[ 9 ] * wz + e[ 13 ] ) / cw * 0.5 ) * h;
    n++;
  }
  return n;
}

// how far a plant's drawn stem can land from the screen column its root sits
// on, in px. A plant fits in a sphere of `reach` metres around its root, and the
// rows of the camera product say how much a metre of world is worth on the glass
// at this depth: the sideways row gives the offset itself, the depth row gives it
// scaled by the root's own place on the glass, since a point nearer the eye
// spreads wider over it. Deliberately generous - it only ever rules out plants
// the blade could not have reached, which is what keeps a pointer move over
// twelve thousand plants cheap.
function rootDrift( e, r1, r3, rw, ndcx, reach, w ) {
  const near = rw - reach * r3;
  if ( near <= 0.05 ) return 1e9; // close enough to the eye that nothing is ruled out
  return 0.5 * w * reach * ( r1 + r3 * Math.abs( ndcx ) ) / near;
}

function reapSickleOn( x0, y0, x1, y1, w, h ) {
  const band = sickle.band;
  reapMatrix.copy( camera.projectionMatrix ).multiply( camera.matrixWorldInverse );
  const e = reapMatrix.elements;
  const band2 = band * band;
  const minX = Math.min( x0, x1 ) - band;
  const maxX = Math.max( x0, x1 ) + band;
  const minY = Math.min( y0, y1 ) - band;
  const maxY = Math.max( y0, y1 ) + band;
  // the rows of the same product, as lengths per metre of world: clip x grows
  // by r1 per metre sideways, clip w by r3 per metre of depth. A plant fits in a
  // sphere around its own root, so those two numbers bound how far its drawn
  // stem can land from the screen column its root sits on - which is what keeps
  // the walk over the whole stand cheap without ever ruling out a plant the
  // blade could actually have reached.
  const r1 = Math.hypot( e[ 0 ], e[ 4 ], e[ 8 ] );
  const r3 = Math.hypot( e[ 3 ], e[ 7 ], e[ 11 ] );
  // the ring the hand works in, read once per drawn segment: a plant outside it
  // is beyond the blade whatever the line says, and the test runs before any of
  // the screen work so the walk over the whole stand stays cheap
  const playerX = camera.position.x;
  const playerZ = camera.position.z;
  for ( let t = 0; t < field.tiers.length; t++ ) {
    const mesh = field.tiers[ t ];
    const m = mesh.instanceMatrix.array;
    const cut = mesh.userData.cut;
    const wind = mesh.geometry.attributes.aWind.array;
    const sway = mesh.geometry.attributes.aWindZ.array;
    for ( let i = 0; i < mesh.count; i++ ) {
      if ( sickle.cut.length >= SICKLE.max ) return; // one flick cannot mow the field
      if ( cut[ i ] ) continue; // already stubble: nothing to take
      const o = i * 16;
      const x = m[ o + 12 ];
      const y = m[ o + 13 ];
      const z = m[ o + 14 ];
      // the ring: the same two metres the check answers to, measured to the
      // plant's root, so a drawn line reaps the swathe the player is standing
      // in and leaves the rest of the stand put
      const dxp = x - playerX;
      const dzp = z - playerZ;
      if ( dxp * dxp + dzp * dzp > hand.reach2 ) continue;
      const rw = e[ 3 ] * x + e[ 7 ] * y + e[ 11 ] * z + e[ 15 ];
      if ( rw <= 0.05 ) continue; // the plant's base is behind the camera
      const k4 = i * 4;
      // the plant's own height is the length of its up column, and the sphere
      // that holds the whole plant is that height plus the culm's lean plus the
      // wind the shader is pushing it by this frame
      const hy = Math.hypot( m[ o + 4 ], m[ o + 5 ], m[ o + 9 ] );
      const ndcx = ( e[ 0 ] * x + e[ 4 ] * y + e[ 8 ] * z + e[ 12 ] ) / rw;
      const drift = rootDrift( e, r1, r3, rw, ndcx, hy + 0.09 + 1.7 * Math.abs( wind[ k4 + 3 ] ), w );
      const rx = ( ndcx * 0.5 + 0.5 ) * w;
      if ( rx < minX - drift ) continue;
      if ( rx > maxX + drift ) continue;
      // the spine as the shader draws it, in canvas px
      const n = spineToScreen( e, m, o, wind, k4, sway[ i ], w, h, REAP_PX, REAP_PY );
      if ( n < 2 ) continue; // too little of it is in front of the eye to cut
      let lox = 1e9, hix = -1e9, loy = 1e9, hiy = -1e9;
      for ( let j = 0; j < n; j++ ) {
        if ( REAP_PX[ j ] < lox ) lox = REAP_PX[ j ];
        if ( REAP_PX[ j ] > hix ) hix = REAP_PX[ j ];
        if ( REAP_PY[ j ] < loy ) loy = REAP_PY[ j ];
        if ( REAP_PY[ j ] > hiy ) hiy = REAP_PY[ j ];
      }
      if ( lox > maxX || hix < minX || loy > maxY || hiy < minY ) continue;
      let hit = false;
      for ( let j = 1; j < n; j++ ) {
        if ( stemInBand( REAP_PX[ j - 1 ], REAP_PY[ j - 1 ], REAP_PX[ j ], REAP_PY[ j ], x0, y0, x1, y1, band2 ) ) {
          hit = true;
          break;
        }
      }
      if ( !hit ) continue;
      // the stubble wanders a little along the swathe, so the cut reads as a
      // scythe's arc rather than as one perfectly level line
      const share = SICKLE.stub + Math.random() * SICKLE.vary;
      cutPlant( t, i, share );
      sickle.cut.push( { tier: t, index: i, share: share } );
      sickle.plants = sickle.plants + 1;
      harvest.cut = harvest.cut + 1;
    }
  }
}

// The drawn line, painted as DOM over the canvas rather than as geometry in
// front of it: the stroke belongs to the glass, it must never eat a pointer
// event, and its points are the same numbers the reaping ran on - so a harness
// can read the line back out of the markup and compare it with what it asked
// the hand to draw.
let strokeNode = null;
let strokeBand = null;
let strokeLine = null;

function paintStroke() {
  const el = strokeNode || ( strokeNode = document.getElementById( "stroke" ) );
  if ( !el ) return;
  const pts = sickle.stroke;
  if ( pts.length < 4 ) {
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  if ( !strokeLine ) strokeLine = document.getElementById( "stroke-line" );
  if ( !strokeBand ) strokeBand = document.getElementById( "stroke-band" );
  let s = "";
  for ( let i = 0; i < pts.length; i += 2 ) {
    if ( i ) s += " ";
    s += pts[ i ].toFixed( 1 ) + "," + pts[ i + 1 ].toFixed( 1 );
  }
  if ( strokeBand ) strokeBand.setAttribute( "points", s );
  if ( strokeLine ) strokeLine.setAttribute( "points", s );
}

// The item rides the camera rather than the viewer's seat, so it keeps its
// place in the frame whatever the walk does to the framing. The swing is eased
// from the swipe's own second: the arm follows the line the hand drew.
export function stepSickle( now ) {
  const rig = sickleRig;
  if ( !rig.group ) return;
  const drawn = sickle.stroke.length >= 4;
  if ( state.sickle && drawn ) {
    const el = ( now - sickle.startedAt ) / ( SICKLE.draw * 1000 );
    rig.swing = Math.min( 1, Math.max( 0, el ) );
  } else if ( rig.swing > 0 ) {
    // the swipe is over: the arm settles back rather than snapping to rest
    rig.swing = Math.max( 0, rig.swing - 0.09 );
  }
  rig.mesh.visible = state.sickle;
  if ( !state.sickle ) return;
  rig.group.position.copy( camera.position );
  rig.group.rotation.x = camera.rotation.x;
  rig.group.rotation.y = camera.rotation.y;
  rig.group.rotation.z = camera.rotation.z;
  const s = rig.swing;
  const ease = s * s * ( 3 - 2 * s );
  // rest: the blade held up and a little across the body. swing: the arm turns
  // over and the crescent sweeps down through the frame with the drawn line
  rig.mesh.rotation.x = -0.34 - 1.5 * ease;
  rig.mesh.rotation.y = 0.22 - 0.72 * ease;
  rig.mesh.rotation.z = 0.12 + 0.52 * ease;
  rig.mesh.position.set(
    SICKLE.hx - 0.1 * ease,
    SICKLE.hy + 0.05 - 0.07 * ease,
    SICKLE.hz + 0.05 * ease
  );
}

// ---------------------------------------------------------------------------
// The field's own wildlife. Three species - a bear, a boar and a snake - are
// let loose through the stand at random and walk toward the viewer: a beast
// that gets within arm's length of the player winds up and strikes, and a
// strike takes its damage off the hand through hurt(), which is the one ledger
// the bar on the glass, the ration and the collapse already answer to. Nothing
// is loaded: each animal is assembled at runtime out of three.js's own
// primitives merged into ONE geometry per species, so a beast is one mesh, one
// material and one draw call, and the page's asset count stays where it was.
//
// A beast is a scene object rather than a HUD decal, so it takes the field's
// own lights, its own fog and its own floor: it stands on the mud at floorTop()
// and dissolves into the haze the further out it has wandered. The rice is a
// metre deep, which is why a boar reads as a parting shoulder and a snake as a
// raised head rather than as a whole animal - the stand is what hides them, and
// a player hears the cue before finding the beast that paid it.
//
// The hand's answer is the two tools it already has, and both now land on the
// animals' own hides rather than only scaring them: a swipe ending with beasts
// inside the ring pays one hit to EVERY animal standing in it, and the cursor
// aimed at one pays that single animal a grade-scaled hit. An animal that
// survives is driven off as it always was; one whose hide the hit brings down
// leaves the stand and pays its species' coin into the purse. The reap's own
// numbers (sickle.cut, the grade table, the fragment pool, the combo run) are
// untouched by either, which is what keeps a kill a second answer rather than a
// dressed cut - the purse grows from the wildlife, the harvest counts do not
// ---------------------------------------------------------------------------

// the bare table a harness is told: what each species is worth, how fast it
// comes and how often it bites. beasts.cap is the population the field actually
// runs under, so ?beast= moves the live number rather than this one
export const BEASTS = [
  {
    id: "bear",
    name: "Bear",
    // a bear is the slowest to arrive and the heaviest to land: it cannot be
    // outrun at a walk by much, so the answer to it is the blade rather than a
    // retreat
    speed: 2.2,
    turn: 1.9,
    aggro: 26,
    reach: 1.9,
    wind: 0.5,
    lunge: 1.5,
    cool: 2.8,
    damage: 18,
    gaitRate: 7.4,
    bob: 0.055,
    roll: 0.06,
    sway: 0,
    rear: 0.5,
    // the animal's own hide: how much the hand has to land on it before it comes
    // down, and the coin that hide is worth once it does. A bear is the heaviest
    // to bring down and the richest, which is what makes finishing one a decision
    // rather than free coin - the same trade the species' damage already makes
    hp: 60,
    gold: 9,
  },
  {
    id: "boar",
    name: "Boar",
    // the fastest of the three and the one that bites most often: a boar is
    // worth less per hit and comes back for more, which is what makes it the
    // species a player has to keep turning to face
    speed: 2.9,
    turn: 2.6,
    aggro: 20,
    reach: 1.5,
    wind: 0.3,
    lunge: 1.8,
    cool: 2.0,
    damage: 12,
    gaitRate: 9.6,
    bob: 0.05,
    roll: 0.07,
    sway: 0,
    rear: 0.34,
    // a boar is the quickest to come back for more and the cheapest to bring
    // down: it is worth less per fall than a bear, which is what makes it the
    // species a player clears through rather than the one a player pays for
    hp: 36,
    gold: 5,
  },
  {
    id: "snake",
    name: "Snake",
    // the shortest reach and the smallest wind-up: a snake does not chase, it
    // closes over ground and bites at whatever is already near it, so the
    // answer to it is not to stand where one has been seen
    speed: 1.5,
    turn: 1.4,
    aggro: 13,
    reach: 1.1,
    wind: 0.26,
    lunge: 0.9,
    cool: 2.2,
    damage: 9,
    gaitRate: 5.2,
    bob: 0.012,
    roll: 0.03,
    sway: 0.2,
    rear: 0.3,
    // the least hide and the least coin: a snake goes down in two good swipes,
    // which is what lets a player clear the stand's smallest animals rather than
    // having to bring the whole arm to bear on each one
    hp: 20,
    gold: 3,
  },
];

// the field's own clock for letting them loose
export const BEAST_RULE = {
  // the day opens with one animal already walking the stand rather than one to
  // come a second later, and the field asks for the next one on a random 30-60
  // s draw rather than on a 3.5-8.5 s beat: the stand's population is what the
  // url names, so the animals it is allowed to hold arrive one at a time across
  // the day rather than as a herd the player has to clear before the rice is cut
  first: 0, // seconds before the stand gets its first beast: the day starts with it
  every: [ 30, 60 ], // seconds between the next one and the one after, drawn at random
  strike: 0.3, // seconds the dash a bite rides on lasts
  leave: 58, // metres from the player past which a beast is let go
  minX: -124,
  maxX: 124,
  minZ: -96,
  maxZ: 14, // the stand's own edges, walked to rather than past
  // the hand's own answer to an animal: the same meter the cut plays and the
  // same grading, on a shorter sweep. The bands stay the cut's, so an animal's
  // great band spans 56 ms on the glass rather than the cut's 105 - the check
  // is one rule at a riskier window rather than a second game, which is what
  // makes walking up to a beast a decision rather than free work
  attack: {
    sweep: 0.8, // seconds for the needle to cross the track about an animal
    pick: 26, // px from the animal's body that counts as pointing at it
    // the two hits the hand lands on an animal, and both sit under the species'
    // own hide rather than over it: a swipe pays one hit to EVERY animal standing
    // in the ring the swipe ends in, so the blade attacks all of the beasts the
    // arm covers at once rather than the nearest one, and the aimed check pays
    // one animal a grade-scaled hit. A bear (60 hp) therefore takes five swipes
    // or three great checks rather than falling to the first touch
    blade: 13, // damage the swipe pays each animal inside the ring
    hit: { great: 26, good: 15, normal: 7 }, // damage the aimed check pays per grade
    shove: { great: 4.2, good: 2.6, normal: 1.2 }, // metres the pass drives it back
    cool: { great: 1.6, good: 1.1, normal: 0.7 }, // seconds of extra cool it pays
  },
};

// the field's own stream of randomness, kept apart from the layout's so a
// harness that pins ?seed= sees the same beasts in the same order
const beastRnd = mulberry32( ( ( params.seed | 0 ) * 7919 + 13 ) & 0x7fffffff );

export const beasts = {
  cap: params.beast, // ?beast= moves the population; 0 = no beasts
  list: [], // the beasts standing in the stand right now
  live: 0, // how many that is, kept in step with the list
  loose: 0, // beasts the field has let loose this session
  struck: 0, // strikes that landed on the hand
  frightened: 0, // beasts the blade has driven off
  driven: 0, // beasts the hand's own check has driven off, kept apart from the
  // swipe's count so a harness told one number still reads that one number
  hurt: 0, // hits the hand has landed on an animal, either answer either grade
  felled: 0, // animals that came down, kept apart from the two counts above
  // because an animal that only went off is not one that went down
  felledAt: -1, // when the last of them came down
  lastFell: "", // which species came down
  paid: 0, // the coin the purse has taken off felled animals, kept apart from
  // purse.earned so a harness can tell a kill's money from a cut's
  struckAt: -1, // when the last one landed
  last: "", // which species landed it
  clock: 0, // seconds of field time the beasts have been walking
  nextAt: BEAST_RULE.first, // when the next beast is asked for
  struckPainted: false, // whether the bar is currently wearing the struck class
};

// the beasts' own nodes: one geometry per species, one material for all three,
// and a pool of released meshes per species to answer the next spawn with, so
// the stand never allocates a mesh per beast once it has been running
const beastNodes = { mat: null, geo: {}, pool: {}, size: {} };

// the bars the animals wear: one fixed pool of DOM nodes sized to the population
// the stand can hold rather than to the one it happens to be holding, so an
// animal writes a bar rather than allocating one and a stand that has never been
// let loose in owns no nodes at all. The layer is pointer-transparent on the
// same reason the burst's is - a gauge floating over an animal must never eat
// the click that aims the check at that same animal
const beastHpNodes = { layer: null, bar: null, fill: null, free: null };

// the one product the bars are placed by, kept apart from the pick's so the two
// passes never read each other's half-written matrix
const beastMatrix = new THREE.Matrix4();

// one primitive merged into a shared buffer under its own transform, so an
// animal is one geometry: the same "nothing is an asset" rule the plants, the
// sickle and the hills all already answer to. A part is a primitive, the colour
// it wears, where it sits, how big it is and which way it is turned - front of
// an animal is +z, the same way the camera's own forward is read, so a beast's
// heading turns it to face where it is walking
function mergeParts( parts ) {
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  const dummy = new THREE.Object3D();
  const mat = new THREE.Matrix4();
  const nmat = new THREE.Matrix3();
  const v = new THREE.Vector3();
  let base = 0;
  for ( const p of parts ) {
    // a part that does not say where it sits, how big it is or which way it is
    // turned is a unit primitive at the animal's own origin, at its own size,
    // square to it - the parts that do say are the ones that matter: a tusk, a
    // tongue, a bristle ridge
    const at = p.at || [ 0, 0, 0 ];
    const s = p.s || [ 1, 1, 1 ];
    const r = p.r || [ 0, 0, 0 ];
    dummy.position.set( at[ 0 ], at[ 1 ], at[ 2 ] );
    dummy.rotation.set( r[ 0 ], r[ 1 ], r[ 2 ] );
    dummy.scale.set( s[ 0 ], s[ 1 ], s[ 2 ] );
    dummy.updateMatrix();
    mat.copy( dummy.matrix );
    nmat.getNormalMatrix( mat );
    const g = p.g;
    const pa = g.attributes.position.array;
    const na = g.attributes.normal.array;
    const ia = g.index ? g.index.array : null;
    const c = p.c;
    const count = pa.length / 3;
    for ( let i = 0; i < count; i++ ) {
      const k = i * 3;
      v.set( pa[ k ], pa[ k + 1 ], pa[ k + 2 ] ).applyMatrix4( mat );
      pos.push( v.x, v.y, v.z );
      v.set( na[ k ], na[ k + 1 ], na[ k + 2 ] ).applyMatrix3( nmat );
      const l = v.length() || 1;
      nor.push( v.x / l, v.y / l, v.z / l );
      col.push( c.r, c.g, c.b );
    }
    if ( ia ) {
      for ( let i = 0; i < ia.length; i++ ) idx.push( base + ia[ i ] );
    } else {
      for ( let i = 0; i < count; i++ ) idx.push( base + i );
    }
    base += count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute( "position", new THREE.Float32BufferAttribute( pos, 3 ) );
  geo.setAttribute( "normal", new THREE.Float32BufferAttribute( nor, 3 ) );
  geo.setAttribute( "color", new THREE.Float32BufferAttribute( col, 3 ) );
  geo.setIndex( idx );
  return geo;
}

// the bear: a heavy barrel with a hump over the shoulders, a low head off the
// front of it and four straight legs. At a metre and a bit at the shoulder it
// reads over the top of the stand, which is what makes it the species a player
// sees first rather than hears first
function bearParts( u ) {
  const fur = new THREE.Color( "#6a4a30" );
  const dark = new THREE.Color( "#4a3423" );
  const pale = new THREE.Color( "#8b6b4a" );
  const nose = new THREE.Color( "#241c18" );
  return [
    // the body and the hump: the hump is the highest thing about a bear, and
    // it is what a bear's outline is made of
    { g: u.ball, c: fur, at: [ 0, 0.72, -0.06 ], s: [ 0.4, 0.34, 0.5 ] },
    { g: u.ball, c: fur, at: [ 0, 0.98, 0.14 ], s: [ 0.34, 0.24, 0.3 ] },
    // the head sits forward and low off the hump, with a pale muzzle and a
    // nose at the very front of it
    { g: u.ball, c: fur, at: [ 0, 0.94, 0.46 ], s: [ 0.22, 0.2, 0.22 ] },
    { g: u.ball, c: pale, at: [ 0, 0.88, 0.66 ], s: [ 0.11, 0.09, 0.14 ] },
    { g: u.ball, c: nose, at: [ 0, 0.9, 0.78 ], s: [ 0.045, 0.035, 0.05 ] },
    // the ears are small and round, set wide on the head, which is what keeps
    // a bear's head reading as a head rather than as a ball
    { g: u.ball, c: dark, at: [ 0.17, 1.1, 0.42 ], s: [ 0.075, 0.075, 0.075 ] },
    { g: u.ball, c: dark, at: [ -0.17, 1.1, 0.42 ], s: [ 0.075, 0.075, 0.075 ] },
    // four legs: a bear walks on the whole foot rather than on its toes, so the
    // hind legs are the thicker pair
    { g: u.tube, c: dark, at: [ 0.2, 0.3, 0.34 ], s: [ 0.1, 0.3, 0.1 ] },
    { g: u.tube, c: dark, at: [ -0.2, 0.3, 0.34 ], s: [ 0.1, 0.3, 0.1 ] },
    { g: u.tube, c: dark, at: [ 0.21, 0.3, -0.36 ], s: [ 0.11, 0.32, 0.11 ] },
    { g: u.tube, c: dark, at: [ -0.21, 0.3, -0.36 ], s: [ 0.11, 0.32, 0.11 ] },
    { g: u.ball, c: dark, at: [ 0, 0.84, -0.56 ], s: [ 0.07, 0.07, 0.07 ] },
  ];
}

// the boar: a low, bristle-backed barrel with a flat snout on the front of it
// and two small tusks under that snout. At eighty centimetres it is the species
// that hides in the stand the most, and the one whose tusks are the only part
// of it that reads over the rice
function boarParts( u ) {
  const hide = new THREE.Color( "#4a423c" );
  const dark = new THREE.Color( "#26221e" );
  const tusk = new THREE.Color( "#ddd0b4" );
  return [
    { g: u.ball, c: hide, at: [ 0, 0.56, -0.04 ], s: [ 0.29, 0.25, 0.4 ] },
    { g: u.ball, c: hide, at: [ 0, 0.62, 0.34 ], s: [ 0.18, 0.16, 0.18 ] },
    // the snout is a disc on the head's own front rather than a nose cone,
    // which is what a boar's profile is made of
    { g: u.tube, c: dark, at: [ 0, 0.58, 0.52 ], s: [ 0.085, 0.09, 0.085 ], r: [ Math.PI / 2, 0, 0 ] },
    { g: u.cone, c: tusk, at: [ 0.09, 0.56, 0.55 ], s: [ 0.028, 0.13, 0.028 ], r: [ 0.5, 0, -0.45 ] },
    { g: u.cone, c: tusk, at: [ -0.09, 0.56, 0.55 ], s: [ 0.028, 0.13, 0.028 ], r: [ 0.5, 0, 0.45 ] },
    { g: u.cone, c: dark, at: [ 0.1, 0.78, 0.3 ], s: [ 0.06, 0.12, 0.06 ], r: [ -0.35, 0, 0.2 ] },
    { g: u.cone, c: dark, at: [ -0.1, 0.78, 0.3 ], s: [ 0.06, 0.12, 0.06 ], r: [ -0.35, 0, -0.2 ] },
    // the bristle ridge: a thin slab standing a little off the back, which is
    // what makes a boar's outline bristle rather than smooth
    { g: u.slab, c: dark, at: [ 0, 0.82, -0.02 ], s: [ 0.05, 0.1, 0.46 ] },
    { g: u.tube, c: dark, at: [ 0.15, 0.19, 0.26 ], s: [ 0.055, 0.19, 0.055 ] },
    { g: u.tube, c: dark, at: [ -0.15, 0.19, 0.26 ], s: [ 0.055, 0.19, 0.055 ] },
    { g: u.tube, c: dark, at: [ 0.16, 0.19, -0.28 ], s: [ 0.06, 0.19, 0.06 ] },
    { g: u.tube, c: dark, at: [ -0.16, 0.19, -0.28 ], s: [ 0.06, 0.19, 0.06 ] },
    { g: u.cone, c: dark, at: [ 0, 0.66, -0.42 ], s: [ 0.02, 0.12, 0.02 ], r: [ 2.5, 0, 0 ] },
  ];
}

// the snake: a chain of spheres tapering from tail to head, curving sideways so
// it reads as a body that has been dragged through the mud rather than as a
// straight one. The forebody lifts, because a metre of rice hides a snake's own
// length and the head has to come up out of the stand for the player to see it
// at all - which is also what makes a snake the species that is heard before it
// is seen
function snakeParts( u ) {
  const back = new THREE.Color( "#5f5a33" );
  const belly = new THREE.Color( "#8a7f5c" );
  const eye = new THREE.Color( "#1c1a16" );
  const tongue = new THREE.Color( "#a8443a" );
  const parts = [];
  const coils = 11;
  for ( let i = 0; i < coils; i++ ) {
    const t = i / ( coils - 1 );
    const r = 0.045 + t * 0.072;
    const z = -0.66 + t * 1.16;
    const x = Math.sin( t * 5.4 ) * 0.14 * ( 1 - t * 0.35 );
    const y = r + 0.02 + ( t > 0.55 ? ( t - 0.55 ) * 1.9 : 0 );
    parts.push( { g: u.ball, c: t > 0.5 ? back : belly, at: [ x, y, z ], s: [ r, r * 0.86, r * 1.3 ] } );
  }
  const hx = Math.sin( 5.4 ) * 0.14 * 0.65;
  const hy = 0.117 + 0.02 + 0.45 * 1.9;
  const hz = 0.5;
  parts.push( { g: u.ball, c: back, at: [ hx, hy + 0.05, hz + 0.08 ], s: [ 0.12, 0.1, 0.16 ] } );
  parts.push( { g: u.ball, c: eye, at: [ hx + 0.07, hy + 0.1, hz + 0.16 ], s: [ 0.026, 0.026, 0.026 ] } );
  parts.push( { g: u.ball, c: eye, at: [ hx - 0.07, hy + 0.1, hz + 0.16 ], s: [ 0.026, 0.026, 0.026 ] } );
  // the tongue is the only red on the animal, and it is what lets a player tell
  // a snake's raised head from a bund's corner at a glance
  parts.push( { g: u.cone, c: tongue, at: [ hx, hy + 0.02, hz + 0.26 ], s: [ 0.012, 0.1, 0.012 ], r: [ Math.PI / 2, 0, 0 ] } );
  return parts;
}

// the beasts' nodes are built once: three merged geometries, one material for
// all three, and an empty pool per species. Nothing is added to the scene until
// a beast is actually let loose, so a field with ?beast=0 draws no more than it
// did before
export function buildBeasts() {
  const u = {
    // the unit primitives, reused at a scale per part: a sphere becomes a body,
    // a tube becomes a leg, a cone becomes a tusk or a tongue
    ball: new THREE.SphereGeometry( 1, 10, 7 ),
    tube: new THREE.CylinderGeometry( 1, 1, 1, 8 ),
    cone: new THREE.ConeGeometry( 1, 1, 7 ),
    slab: new THREE.BoxGeometry( 1, 1, 1 ),
  };
  beastNodes.mat = new THREE.MeshLambertMaterial( { color: "#ffffff", vertexColors: true, fog: true } );
  for ( const spec of BEASTS ) {
    const parts = spec.id === "bear" ? bearParts( u ) : spec.id === "boar" ? boarParts( u ) : snakeParts( u );
    const geo = beastNodes.geo[ spec.id ] = mergeParts( parts );
    beastNodes.pool[ spec.id ] = [];
    // the animal's own height off the ground and half-width, read off the merged
    // geometry once rather than guessed per species, so the pick that decides
    // what a click answers to has the body the animal actually wears
    geo.computeBoundingBox();
    beastNodes.size[ spec.id ] = {
      h: geo.boundingBox.max.y,
      w: Math.max( geo.boundingBox.max.x, geo.boundingBox.max.z ),
    };
  }
}

// a mesh for one beast: the released one of its species if the stand has one to
// hand back, a new one otherwise. A beast is added to the scene the moment it is
// let loose rather than hidden in it from the start, so the draw count the readout
// prints is the field's own plus the beasts actually standing in it
function takeBeastMesh( id ) {
  const pool = beastNodes.pool[ id ];
  const fresh = !pool.length;
  const mesh = fresh ? new THREE.Mesh( beastNodes.geo[ id ], beastNodes.mat ) : pool.pop();
  // YXZ rather than the default: a beast's heading is applied first and its
  // wind-up pitch after it, so a bear rearing is a rear about its own side
  // rather than a roll about the field's
  mesh.rotation.order = "YXZ";
  mesh.visible = true;
  // a released mesh is still in the scene, wearing its invisible half of the
  // frame, so only a new one is added to it - adding a mesh twice would draw it
  // twice rather than once
  if ( fresh ) scene.add( mesh );
  return mesh;
}

// a beast that has walked clear out of the field's hearing is let go rather than
// left to trail further and further out, so the stand never accumulates animals
// the player can never come back to
function releaseBeast( b ) {
  b.mesh.visible = false;
  beastNodes.pool[ b.spec.id ].push( b.mesh );
  // the bar it wore goes back with the animal rather than with the next one of
  // its species, so a released slot never leaves a gauge floating where an animal
  // that is no longer standing used to be
  freeBeastHpSlot( b );
}

// take the next free bar out of the pool, or -1 when the stand has asked for
// more animals than the population it was told to hold. spawnBeast refuses at
// that population, so in play the pool always has one left
function takeBeastHpSlot() {
  return beastHpNodes.free && beastHpNodes.free.length ? beastHpNodes.free.pop() : -1;
}

// put a bar back: the node is hidden here rather than at the next paint, so a
// gauge never reads for one frame more than the animal that wore it
function freeBeastHpSlot( b ) {
  const i = b.slot;
  if ( i === undefined || i < 0 ) return;
  b.slot = -1;
  if ( !beastHpNodes.free ) return;
  beastHpNodes.free.push( i );
  const bar = beastHpNodes.bar ? beastHpNodes.bar[ i ] : null;
  if ( !bar ) return;
  bar.style.display = "none";
  bar.classList.remove( "low" );
}

export function clearBeasts() {
  for ( const b of beasts.list ) releaseBeast( b );
  beasts.list.length = 0;
  beasts.live = 0;
}

// the bars the animals wear: the pool is sized to the population the stand can
// hold rather than to the one it happens to be holding, so an animal writes a
// bar rather than allocating one and a field with ?beast=0 owns no nodes at all.
// Each bar is a frame with a fill inside it, the same shape the hand's own bar is
// drawn in, so app.js writes one share per animal and the layout never moves
export function buildBeastHp() {
  const layer = document.getElementById( "beasthp" );
  if ( !layer ) return;
  beastHpNodes.layer = layer;
  layer.hidden = true;
  const cap = Math.max( 0, beasts.cap | 0 );
  beastHpNodes.bar = new Array( cap );
  beastHpNodes.fill = new Array( cap );
  beastHpNodes.free = [];
  for ( let i = 0; i < cap; i++ ) {
    const bar = document.createElement( "div" );
    bar.className = "bhp";
    bar.style.display = "none";
    const fill = document.createElement( "div" );
    // the hand starts an animal at the top of its hide, so the bar reads full
    // before app.js has written a share into it - the same reason the hand's own
    // bar does, and the same reason a fresh animal is never a felled one
    fill.className = "fill";
    fill.style.width = "100%";
    bar.appendChild( fill );
    layer.appendChild( bar );
    beastHpNodes.bar[ i ] = bar;
    beastHpNodes.fill[ i ] = fill;
    beastHpNodes.free.push( i );
  }
}

// paint the bars the standing animals wear: each is placed over the top of the
// body it belongs to by the same product the pick runs and the same pixel
// convention, so the gauge on the glass and the animal under it are the same
// point rather than a guess. An animal behind the eye or off the glass hides its
// bar rather than leaving a gauge pinned to the edge of the frame, which is what
// keeps a beast walking out of view from reading as one standing at the side
export function paintBeastHp() {
  const layer = beastHpNodes.layer;
  if ( !layer || !beastHpNodes.bar ) return;
  if ( !beasts.list.length ) {
    // the layer hides itself while the stand holds nothing, on the same reason
    // the burst's does: a field with no wildlife in it owns no compositor layer
    if ( !layer.hidden ) layer.hidden = true;
    return;
  }
  layer.hidden = false;
  const el = document.getElementById( "scene-canvas" );
  if ( !el ) return;
  const r = el.getBoundingClientRect();
  const w = r.width;
  const h = r.height;
  if ( w <= 0 || h <= 0 ) return;
  beastMatrix.copy( camera.projectionMatrix ).multiply( camera.matrixWorldInverse );
  const e = beastMatrix.elements;
  for ( const b of beasts.list ) {
    const i = b.slot;
    if ( i === undefined || i < 0 || i >= beastHpNodes.bar.length ) continue;
    const bar = beastHpNodes.bar[ i ];
    const size = beastNodes.size[ b.spec.id ];
    const base = floorTop( b.x, b.z );
    const top = base + size.h;
    const rw = e[ 3 ] * b.x + e[ 7 ] * top + e[ 11 ] * b.z + e[ 15 ];
    if ( rw <= 0.05 ) {
      bar.style.display = "none"; // the animal is behind the eye
      continue;
    }
    const x = ( ( e[ 0 ] * b.x + e[ 4 ] * top + e[ 8 ] * b.z + e[ 12 ] ) / rw * 0.5 + 0.5 ) * w;
    const y = ( 0.5 - ( e[ 1 ] * b.x + e[ 5 ] * top + e[ 9 ] * b.z + e[ 13 ] ) / rw * 0.5 ) * h;
    if ( x < -60 || x > w + 60 || y < -40 || y > h + 40 ) {
      bar.style.display = "none";
      continue;
    }
    bar.style.display = "";
    bar.style.left = x.toFixed( 0 ) + "px";
    bar.style.top = y.toFixed( 0 ) + "px";
    // the fill is a share of the frame rather than a bar of its own width, so
    // app.js writes one number per animal. The hide is the animal's own rather
    // than the species' table, so an animal that has been hit reads against the
    // hide it started with rather than against a number the player has to look up
    const share = b.maxHp > 0 ? b.hp / b.maxHp : 0;
    beastHpNodes.fill[ i ].style.width = Math.round( 100 * share ) + "%";
    // under a third of its hide the bar wears the same rust the shop prices a
    // refused piece in, so an animal that is nearly down says so on the glass
    // rather than leaving the player to measure the fill's edge. A hide at none
    // left is not rusted: the animal is not standing any more
    bar.classList.toggle( "low", share > 0 && share <= 1 / 3 );
  }
}

// let another beast loose through the stand. It arrives at a random bearing and
// a random distance out of the player's own - far enough to have been heard
// rather than seen, close enough that the field it is walking across is the
// field the player is standing in - and it arrives facing the player, because a
// beast that has come to find them has not come to walk away from them
export function spawnBeast() {
  if ( beasts.live >= beasts.cap ) return false;
  const spec = BEASTS[ Math.floor( beastRnd() * BEASTS.length ) % BEASTS.length ];
  const px = camera.position.x;
  const pz = camera.position.z;
  let x = px;
  let z = pz;
  for ( let attempt = 0; attempt < 10; attempt++ ) {
    const a = beastRnd() * Math.PI * 2;
    const r = 13 + beastRnd() * 17;
    x = px + Math.sin( a ) * r;
    z = pz + Math.cos( a ) * r;
    if ( x < BEAST_RULE.minX || x > BEAST_RULE.maxX || z < BEAST_RULE.minZ || z > BEAST_RULE.maxZ ) continue;
    if ( Math.hypot( x - px, z - pz ) >= 11 ) break;
  }
  // a beast whose bearing put it past the tree line still has to have ground to
  // run on, so the position is walked back inside the stand's own edges
  x = Math.min( BEAST_RULE.maxX, Math.max( BEAST_RULE.minX, x ) );
  z = Math.min( BEAST_RULE.maxZ, Math.max( BEAST_RULE.minZ, z ) );
  const b = {
    spec,
    mesh: takeBeastMesh( spec.id ),
    x,
    z,
    heading: Math.atan2( px - x, pz - z ),
    state: "", // "" is a beast with no attack in progress; wind, strike and cool are
    timer: 0.4 + beastRnd() * 1.6, // the phase clock, or the roam's own re-pick timer
    cool: 0, // seconds until it will answer another bite
    phase: beastRnd() * 6.2832, // where in its gait it is, seeded so a herd is not in step
    bob: 0,
    roll: 0,
    pitch: 0,
    sway: 0,
    // the animal's own hide, seeded from its species rather than invented per
    // animal, so a harness that pins ?seed= sees the same beasts with the same
    // hides. maxHp is kept beside hp because the bar on the glass is a share of
    // the hide the animal started with rather than a share of a table
    hp: spec.hp,
    maxHp: spec.hp,
    hurtAt: -1, // when the hand last landed on it, -1 before the first hit
    slot: takeBeastHpSlot(), // which of the pool's bars this animal wears
  };
  beasts.list.push( b );
  beasts.live = beasts.list.length;
  beasts.loose = beasts.loose + 1;
  return true;
}

// a strike landing on the hand: the damage goes through hurt(), which is the one
// ledger the bar on the glass, the ration and the collapse already answer to, so
// a beast never has to know anything about health of its own
function bite( b, spec ) {
  hurt( spec.damage );
  playSound( SOUND.hurt, spec.id );
  beasts.struck = beasts.struck + 1;
  beasts.struckAt = performance.now();
  beasts.last = spec.id;
  b.cool = spec.cool;
}

// the bar wears a struck class for a moment after a strike lands, which is what
// lets a player see that the drop in the hand was an animal rather than a
// misjudged cut - the class is only ever worn, never counted, so the bar's own
// low class and the readout's number are untouched
export function paintStruck() {
  const bar = healthNodes.bar || ( healthNodes.bar = document.getElementById( "health" ) );
  if ( !bar ) return;
  const fresh = beasts.struckAt >= 0 && performance.now() - beasts.struckAt < 900;
  if ( fresh === beasts.struckPainted ) return;
  beasts.struckPainted = fresh;
  bar.classList.toggle( "struck", fresh );
}

// put coin into the purse from something that is not a cut: the ledger moves the
// same way earnGold moves it, but the run does not, since a felled animal is not
// a grade and a kill must neither dress nor extend a streak - the purse grows
// from the stand's own wildlife while the reap's run stays the reap's
export function giveGold( amount ) {
  purse.earned = purse.earned + amount;
  purse.gold = purse.earned - purse.spent;
  beasts.paid = beasts.paid + amount;
  return amount;
}

// an animal that has come down: it leaves the stand the same way one that has
// walked out of the field's hearing does, so its mesh goes back to the pool and
// the bar it wore goes back with it, and its hide is worth the coin its species
// names. Nothing about the cut changes: the harvest counts, the grade table and
// the combo run stay where the reap left them, which is what keeps a kill a
// second answer rather than a dressed cut
function fellBeast( b ) {
  const i = beasts.list.indexOf( b );
  if ( i < 0 ) return false;
  releaseBeast( b );
  beasts.list.splice( i, 1 );
  beasts.live = beasts.list.length;
  beasts.felled = beasts.felled + 1;
  beasts.felledAt = performance.now();
  beasts.lastFell = b.spec.id;
  giveGold( b.spec.gold );
  // the great-cut cue keyed by the species: the same "one cue rather than three"
  // rule a strike already answers with, so a fall is audible as something landing
  // rather than as a third sound the field has never made
  playSound( SOUND.great, b.spec.id );
  return true;
}

// land a hit on an animal: the number is what the hand's answer is worth, and the
// animal either takes it and stays standing or comes down. Returns true when the
// animal went down, so a caller knows there is nothing left to drive off. The
// animal's own hide is the only ledger here - the hand pays nothing for touching
// an animal, which is what keeps attacking one a decision about the purse rather
// than about the day
export function damageBeast( b, amount ) {
  if ( !b || beasts.list.indexOf( b ) < 0 ) return false;
  b.hp = Math.max( 0, b.hp - amount );
  b.hurtAt = performance.now();
  beasts.hurt = beasts.hurt + 1;
  if ( b.hp > 0 ) return false;
  return fellBeast( b );
}

// the blade at arm's length answers an animal as well as the stand: a swipe
// ending with beasts inside the ring lands one hit on EVERY animal standing in
// it, so the hand attacks all of the beasts the arm covers at once rather than
// the nearest one alone. An animal that survives the hit is driven off as it
// always was; one whose hide the hit brings down leaves the stand and pays its
// species' coin. It runs after the reap rather than inside it, so the plants the
// swipe took and the fee it paid are exactly as they were
export function frightenBeasts() {
  // walked backwards because a fall splices the roster down: the entries above
  // the splice have already been answered, the ones below it have not moved
  for ( let i = beasts.list.length - 1; i >= 0; i-- ) {
    const b = beasts.list[ i ];
    if ( fromPlayerD2( b.x, b.z ) > hand.reach2 ) continue;
    // the hit goes first, so a fall is a fall rather than a drive-off that
    // happens to leave an animal with no hide left
    if ( damageBeast( b, BEAST_RULE.attack.blade ) ) continue;
    // the strike it was winding up is broken, and the beast turns and goes
    b.state = "cool";
    b.timer = b.spec.cool * 0.6;
    b.cool = b.spec.cool;
    b.heading = Math.atan2( b.x - camera.position.x, b.z - camera.position.z );
    beasts.frightened = beasts.frightened + 1;
  }
}

// the hand's own answer to one animal: the check the cursor was aimed at pays one
// animal a grade-scaled hit rather than every animal in the ring, and the grade
// decides both how hard it landed and - when the animal survives - how far it
// goes and how long it stays put. A hit that brings the animal down takes it out
// of the stand and pays its species' coin through the purse; a hit that does not
// only drives it off. Either way the harvest counts and the combo run stay where
// the cut's own table left them, so the purse is the one ledger a kill moves
export function strikeBeast( b, grade ) {
  // the animal can have walked out of the stand between the arm and the click
  // that played it, in which case there is nothing here to answer
  if ( !b || beasts.list.indexOf( b ) < 0 ) return false;
  // the hit goes first, so a fall is a fall rather than a drive-off that happens
  // to leave an animal with no hide left
  if ( damageBeast( b, BEAST_RULE.attack.hit[ grade ] ) ) return true;
  const spec = b.spec;
  // the strike it was winding up is broken and the animal turns and goes: the
  // same answer the swipe gives it at arm's length, dressed by the grade
  b.state = "cool";
  b.timer = spec.cool * 0.6;
  b.cool = spec.cool + BEAST_RULE.attack.cool[ grade ];
  b.heading = Math.atan2( b.x - camera.position.x, b.z - camera.position.z );
  // the grade also decides how far back it goes, walked back inside the stand's
  // own edges so a shove cannot push an animal past the tree line
  const shove = BEAST_RULE.attack.shove[ grade ];
  b.x = Math.min( BEAST_RULE.maxX, Math.max( BEAST_RULE.minX, b.x + Math.sin( b.heading ) * shove ) );
  b.z = Math.min( BEAST_RULE.maxZ, Math.max( BEAST_RULE.minZ, b.z + Math.cos( b.heading ) * shove ) );
  beasts.driven = beasts.driven + 1;
  return true;
}

// the beasts walk on the field's own capped step, so a paused stand holds them
// with the stalks and a stalled tab does not teleport a bear across the plot
export function stepBeasts( dt ) {
  const px = camera.position.x;
  const pz = camera.position.z;
  beasts.clock += dt;
  // the field lets another beast loose on its own clock until the population
  // named in the url is standing in the stand. spawnBeast refuses when the stand
  // is already holding that many, so this loop is one beat rather than a queue
  while ( beasts.clock >= beasts.nextAt ) {
    spawnBeast();
    beasts.nextAt = beasts.clock + BEAST_RULE.every[ 0 ] + beastRnd() * ( BEAST_RULE.every[ 1 ] - BEAST_RULE.every[ 0 ] );
  }
  for ( let i = beasts.list.length - 1; i >= 0; i-- ) {
    const b = beasts.list[ i ];
    const spec = b.spec;
    b.timer -= dt;
    b.cool = Math.max( 0, b.cool - dt );

    let dx = px - b.x;
    let dz = pz - b.z;
    let d2 = dx * dx + dz * dz;

    // a beast that has wandered clear out of the field's hearing is let go, so
    // the stand never accumulates animals the player can never come back to
    if ( d2 > BEAST_RULE.leave * BEAST_RULE.leave ) {
      releaseBeast( b );
      beasts.list.splice( i, 1 );
      beasts.live = beasts.list.length;
      continue;
    }

    // a body lying in the mud is not a meal: the beasts lose interest in it and
    // drift off, which is what keeps a collapse from reading as a feeding
    const hunting = !health.dead;
    let gait = 0; // 0..1 of the species' own pace
    let want = b.heading;

    if ( b.state === "" ) {
      if ( hunting && d2 <= spec.aggro * spec.aggro ) {
        want = Math.atan2( dx, dz );
        gait = 1;
        if ( d2 <= spec.reach * spec.reach && b.cool <= 0 ) {
          // at arm's length the beast winds up rather than biting on the spot,
          // which is what lets a player who is already walking back out of it
          // still get away
          b.state = "wind";
          b.timer = spec.wind;
          gait = 0.12;
        }
      } else {
        if ( b.timer <= 0 ) {
          b.timer = 1.2 + beastRnd() * 2.4;
          b.heading += ( beastRnd() - 0.5 ) * 2.2;
        }
        if ( !hunting && d2 < 900 ) want = Math.atan2( -dx, -dz );
        gait = 0.42;
      }
    } else if ( b.state === "cool" ) {
      if ( b.timer <= 0 ) {
        b.state = "";
        b.timer = 0.6 + beastRnd() * 1.4;
      }
      want = Math.atan2( -dx, -dz );
      gait = 0.5;
    } else if ( b.state === "wind" ) {
      if ( b.timer <= 0 ) {
        b.state = "strike";
        b.timer = BEAST_RULE.strike;
      }
      gait = 0.12;
    }

    // the turn: a beast turns at its own rate rather than snapping to its target,
    // which is what lets a player step aside from a charge
    let da = want - b.heading;
    while ( da > Math.PI ) da -= 6.2832;
    while ( da < -Math.PI ) da += 6.2832;
    const turn = spec.turn * dt;
    b.heading += Math.max( -turn, Math.min( turn, da ) );

    // the step: a strike is a dash rather than a walk, so the bite lands at the
    // far end of it and a player who has turned aside is missed
    if ( b.state === "strike" ) {
      const dash = spec.lunge * dt / BEAST_RULE.strike;
      b.x += Math.sin( b.heading ) * dash;
      b.z += Math.cos( b.heading ) * dash;
      if ( b.timer <= 0 ) {
        dx = px - b.x;
        dz = pz - b.z;
        d2 = dx * dx + dz * dz;
        if ( !health.dead && d2 <= spec.reach * spec.reach ) bite( b, spec );
        b.state = "cool";
        b.timer = spec.cool;
      }
    } else if ( gait > 0 ) {
      const step = spec.speed * gait * dt;
      b.x += Math.sin( b.heading ) * step;
      b.z += Math.cos( b.heading ) * step;
    }

    // a beast that has walked up to the stand's own edge turns back rather than
    // grinding along the tree line
    const ex = Math.min( BEAST_RULE.maxX, Math.max( BEAST_RULE.minX, b.x ) );
    const ez = Math.min( BEAST_RULE.maxZ, Math.max( BEAST_RULE.minZ, b.z ) );
    if ( ex !== b.x || ez !== b.z ) {
      b.x = ex;
      b.z = ez;
      b.heading = Math.atan2( -Math.sin( b.heading ), -Math.cos( b.heading ) );
    }

    // the gait: a quadruped bobs and lists on it, a snake sways. The amplitudes
    // are the species' own, which is why a snake reads as a body being dragged
    // rather than as an animal walking
    b.phase += dt * spec.gaitRate * ( 0.3 + gait );
    const swing = Math.sin( b.phase );
    const lift = Math.abs( Math.cos( b.phase ) );
    const amp = 0.3 + gait;
    b.bob = lift * spec.bob * amp;
    b.roll = swing * spec.roll * amp;
    b.sway = swing * spec.sway * amp;
    if ( b.state === "wind" ) {
      // the wind-up: the forehand comes off the ground, which is the one thing
      // a player can see a strike is made of
      const w = 1 - Math.max( 0, b.timer ) / spec.wind;
      b.pitch = -spec.rear * w;
    } else if ( b.state === "strike" ) {
      const k = 1 - Math.max( 0, b.timer ) / BEAST_RULE.strike;
      b.pitch = spec.rear * ( 1.5 * k - 0.6 );
    } else {
      b.pitch = swing * spec.bob * 1.4 * amp;
    }

    // the beast stands on the mud at the field's own floor, so it takes the
    // field's own lights, fog and ground rather than a flat plane of its own
    b.mesh.position.set( b.x, floorTop( b.x, b.z ) + b.bob, b.z );
    b.mesh.rotation.set( b.pitch, b.heading + b.sway, b.roll );
  }
  paintStruck();
}

export function buildField() {
  const qf = QUALITY[ state.quality ] !== undefined ? QUALITY[ state.quality ] : 1;
  const rnd = mulberry32( params.seed );
  const FX = 0;
  const FZ = 4; // the layout is graded against the default camera, not the origin
  const X0 = -132;
  const X1 = 132;
  const Z0 = -98;
  const Z1 = 15;

  const tierSpec = [
    { name: "near", r0: 0, r1: 7.2, step: 0.31, lean: 0.05 },
    { name: "mid", r0: 7.2, r1: 25, step: 0.56, lean: 0.06 },
    { name: "far", r0: 25, r1: 84, step: 1.28, lean: 0.07 },
  ];

  // The plant is built once for the whole field: the lush foreground one, with
  // its four culm strips, six leaves and its drooping rice head. The tiers
  // below only differ in where they sit, how thickly they are seeded and which
  // way they are submitted, so the same per-vertex arrays are handed to all
  // three geometries and only the per-instance attributes (seed, tint,
  // highlight, wave) are built per tier.
  const lush = buildPlantGeometry( "near" );

  const palette = [ "#47612c", "#587033", "#6c8340", "#879457", "#3d5628", "#7b8b4d" ];
  const pal = [];
  for ( const hex of palette ) pal.push( new THREE.Color( hex ) );
  const tint = new THREE.Color();

  for ( const spec of tierSpec ) {
    const step = spec.step / Math.sqrt( qf );
    const spots = [];
    for ( let z = Z0; z < Z1; z += step ) {
      for ( let x = X0; x < X1; x += step ) {
        const px = x + ( rnd() - 0.5 ) * step * 0.86;
        const pz = z + ( rnd() - 0.5 ) * step * 0.86;
        const d = Math.hypot( px - FX, pz - FZ );
        if ( d < spec.r0 || d >= spec.r1 ) continue;
        if ( rnd() < 0.07 ) continue; // gaps in the stand
        // rice grows in the plots, not on the earthen bunds between them, and
        // the same lattice the floor geometry and the distant field shaders
        // use is what keeps the bare strips lined up with the ridges. The strip
        // is wider than the bund's base on purpose: a rice stand is planted up
        // off the ridge, so the earthen margin is what reads from the path
        if ( bundEdge( px, pz ) < PADDY_BUND + 0.16 ) continue;
        spots.push( px, pz, d );
        // a second seed beside some of the foreground plants: a density rule,
        // keyed to the band rather than to a plant detail that no longer exists
        if ( spec.name === "near" && rnd() > 0.9 ) {
          spots.push( px + ( rnd() - 0.5 ) * 0.5, pz + ( rnd() - 0.5 ) * 0.5, d );
        }
      }
    }

    const count = spots.length / 3;
    const geo = new THREE.BufferGeometry();
    // the same arrays for every tier: three geometries, one plant
    const src = lush;
    geo.setAttribute( "position", new THREE.Float32BufferAttribute( src.position, 3 ) );
    geo.setAttribute( "normal", new THREE.Float32BufferAttribute( src.normal, 3 ) );
    geo.setAttribute( "aFlex", new THREE.Float32BufferAttribute( src.aFlex, 1 ) );
    geo.setAttribute( "aWave", new THREE.Float32BufferAttribute( src.aWave, 2 ) );
    geo.setAttribute( "aTone", new THREE.Float32BufferAttribute( src.aTone, 1 ) );
    geo.setAttribute( "aPart", new THREE.Float32BufferAttribute( src.aPart, 1 ) );
    geo.setAttribute( "aEdge", new THREE.Float32BufferAttribute( src.aEdge, 1 ) );
    geo.setIndex( new THREE.Uint16BufferAttribute( src.index, 1 ) );

    // Submission order is a depth order, not a look order: nothing here is
    // blended, so the same pixels come out either way, but instances nearest
    // the camera have to be submitted first or the depth buffer cannot reject
    // the fragments of the plants behind them. The grid loop above walks the
    // field far to near, which is the worst case, so the plants are dealt out
    // through this permutation instead - same spots, same seeds, same tints,
    // same poses, only different slot numbers.
    const order = new Int32Array( count );
    for ( let i = 0; i < count; i++ ) order[ i ] = i;
    order.sort( ( a, b ) => spots[ b * 3 + 1 ] - spots[ a * 3 + 1 ] );

    const seeds = new Uint8Array( count );
    const tints = new Float32Array( count * 3 );
    for ( let i = 0; i < count; i++ ) {
      const slot = order[ i ];
      seeds[ slot ] = Math.floor( rnd() * 255 );
      const a = pal[ Math.floor( rnd() * pal.length ) ];
      const b = pal[ Math.floor( rnd() * pal.length ) ];
      const k = rnd();
      tint.copy( a ).lerp( b, k );
      const v = 0.86 + rnd() * 0.26;
      tints[ slot * 3 ] = tint.r * v;
      tints[ slot * 3 + 1 ] = tint.g * v;
      tints[ slot * 3 + 2 ] = tint.b * v;
    }
    geo.setAttribute( "aSeed", new THREE.InstancedBufferAttribute( seeds, 1 ) );
    geo.setAttribute( "aTint", new THREE.InstancedBufferAttribute( tints, 3 ) );
    // Two flags share one instanced float rather than taking two slots: the
    // plant already asks the shader for every attribute the field's GL
    // context allows, and one more declaration makes the program fail to link
    // (three then says "Too many attributes" and the whole stand stops
    // drawing). Bit 0 is the hover outline and bit 1 is the cut, so the pick
    // rewrites one float per hover change and the rice material turns it into
    // a bright leaf edge - and folds the head - at no extra draw call.
    geo.setAttribute( "aFlags", new THREE.InstancedBufferAttribute( new Float32Array( count ), 1 ) );
    // the wave train, refilled once per plant per frame by updateWind: four
    // floats of summed wave + amplitude and one of sideways sway per plant,
    // instead of six trig calls per plant vertex in the shader
    geo.setAttribute( "aWind", new THREE.InstancedBufferAttribute( new Float32Array( count * 4 ), 4 ) );
    geo.setAttribute( "aWindZ", new THREE.InstancedBufferAttribute( new Float32Array( count ), 1 ) );

    const mat = makeWindMaterial( uniforms, {
      color: "#ffffff",
      side: THREE.DoubleSide,
    } );

    const mesh = new THREE.InstancedMesh( geo, mat, count );
    // flagged 1 once a skill check has cut this plant; the pick skips flagged
    // plants, so a stubble can never be clicked again
    mesh.userData.cut = new Uint8Array( count );
    const dummy = new THREE.Object3D();
    for ( let i = 0; i < count; i++ ) {
      const slot = order[ i ];
      const x = spots[ slot * 3 ];
      const z = spots[ slot * 3 + 1 ];
      const h = 0.92 + rnd() * 0.42 + ( z < -60 ? 0.12 : 0 );
      dummy.position.set( x, 0, z );
      dummy.rotation.set(
        ( rnd() - 0.5 ) * spec.lean * 2,
        rnd() * Math.PI * 2,
        ( rnd() - 0.5 ) * spec.lean * 2
      );
      dummy.scale.set( 0.86 + rnd() * 0.3, h, 0.86 + rnd() * 0.3 );
      dummy.updateMatrix();
      mesh.setMatrixAt( slot, dummy.matrix );
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    // near tier first, then mid, then far: the depth buffer then rejects the
    // plants that are hidden behind closer ones before their fragments run
    mesh.renderOrder = field.tiers.length;
    prepareWind( mesh );
    scene.add( mesh );

    field.tiers.push( mesh );
    field.instances += count;
    field.triangles += src.index.length / 3 * count;
  }

  // seed the wave buffers so a field that starts paused is already bent rather
  // than standing straight up until the first unpaused frame
  updateWind(
    field.tiers,
    uniforms.uTime.value,
    uniforms.uWind.value,
    uniforms.uWindSpeed.value,
    uniforms.uGust.value
  );
}

// ---------------------------------------------------------------------------
// Camera: two composed framings, eased between on demand, plus a free walker.
//
// The walker never edits a preset. It only stacks an offset on top of the
// eased preset pose - a world-space move and an accumulated look - so a view
// button always puts the camera back on the tripod and the framing stays
// authored rather than fighting whatever the viewer wandered to.
// ---------------------------------------------------------------------------
const VIEWS = {
  // the opening seat starts 40 cm above the paddy floor rather than a head
  // above the crop: the eye starts down in the stand, and the Elevate pair
  // (and E / Q) takes it up from there, which is what makes the field open on
  // a view out of the rice rather than over it. WALK.minY is the same 40 cm,
  // so the framing the field opens on is also the lowest seat the hand works
  // from and the start of the elevation is a number rather than a walk
  open: { x: 0.55, y: 0.4, z: 6.4, pitch: 2.55, yaw: 0.0, fov: 48.5 },
  among: { x: -0.3, y: 1.02, z: 0.1, pitch: -1.4, yaw: 0.12, fov: 42 },
};

// Walking bounds. The field itself spans x -132..132 / z -98..15; the camera
// keeps a margin inside that so you never walk out past the tree line or sink
// under the paddy floor.
const WALK = {
  speed: 2.6, // units per second on the move keys
  rise: 1.6, // units per second on the raise / lower keys
  minX: -120,
  maxX: 120,
  minZ: -92,
  maxZ: 13,
  minY: 0.4, // never below the 40 cm the opening seat starts at, so the field's own start is the floor of the elevation
  maxY: 9, // and never becomes a map view
  dragPitch: 0.3,
  dragSens: 0.0045, // radians per pixel of drag
};

// The collapse, in the same seat the WALK table owns. There is no player model
// to tip over, so the camera is the body and the fall is the camera's own move.
// The eye drops to the height a body lying in the mud rests at, the horizon
// rolls as the body tips onto its side, and the head ends up a little along the
// direction it fell rather than straight down the shaft it stood in. The drop
// eases IN rather than smoothstepping, which is the whole point: a body
// accelerates on the way down, and the smoothstep the framings use would make
// the collapse read as one more eased camera move rather than as gravity.
export const FALL = {
  seconds: 1.25, // the time the collapse takes
  lie: 0.24, // eye height once the body is lying in the mud
  slide: 0.9, // metres the body ends up along the direction it fell
  roll: 1.22, // radians the horizon rolls (~70 deg) as the body tips over
  pitch: -0.26, // radians the head tips down once it is on the ground
  lift: 0.07, // metres the body takes off the mud at the thud
  thud: 0.78, // the fraction of the fall at which the body hits the ground
};

// Touch tuning. A finger is not a cursor: it is wider than a stem, it slides
// instead of hovering, and the one gesture it makes on the field (press and
// slide) is exactly the gesture that must NOT spend a skill check. So a tap is
// decided on lift-off from how long and how far the finger was down, and the
// plant pick gets a wider radius because the contact patch is that wide.
export const TOUCH = {
  padDead: 0.14, // a thumb resting this close to the pad centre means "stand still"
  tapMs: 320, // a touch shorter than this on the field is a tap, longer is a look
  tapPx: 16, // and it must not have slid further than this to still count as one
  tapRadius: 26, // a fingertip covers more glass than a cursor, so widen the pick
};

export const cam = {
  view: params.view in VIEWS ? params.view : "open",
  target: params.view in VIEWS ? params.view : "open",
  t: 1, // 0..1 blend between `from` and `to`
  from: VIEWS[ params.view in VIEWS ? params.view : "open" ],
  to: VIEWS[ params.view in VIEWS ? params.view : "open" ],
  mouse: { x: 0, y: 0 }, // raw pointer over the canvas - bookkeeping only, a bare move never moves the camera
  look: { yaw: 0, pitch: 0 }, // radians of free look, wound up by a drag
  move: { x: 0, y: 0, z: 0 }, // world offset from the preset framing
  keys: {}, // held move keys, keyed by KeyboardEvent.code
  drag: null, // last pointer position while the button is down
  pad: { x: 0, y: 0, on: false }, // thumb pad: knob offset from the pad centre, -1..1, and whether a finger holds it
  hold: 0, // -1 / +1 while a hold-to-elevate button is pressed; the phone has no E / Q keys
  tap: null, // a finger down on the field: { x0, y0, x, y, moved, t0 } until lift says whether it was a tap
};

// Swapping the framing is also a framing reset: whatever the viewer walked to
// is dropped, which is what makes the two framings reliable reference shots.
export function setView( name ) {
  if ( !( name in VIEWS ) ) return;
  state.view = name;
  resetWalk();
  if ( name === cam.view ) return;
  cam.from = currentViewPose();
  cam.to = VIEWS[ name ];
  cam.t = 0;
  cam.view = name;
}

export function setWalk( value ) {
  if ( value === "reset" ) {
    resetWalk();
    return;
  }
  // a fallen body does not get a walk back: "hold still" is the only state it
  // has, so neither a key nor the bar's button can stand it back up
  if ( health.dead ) return;
  state.walk = value === true || value === 1 || value === "on" || value === "true" || value === "1";
}

export function resetWalk() {
  cam.move.x = 0;
  cam.move.y = 0;
  cam.move.z = 0;
  cam.look.yaw = 0;
  cam.look.pitch = 0;
  cam.mouse.x = 0;
  cam.mouse.y = 0;
  cam.drag = null;
}

export function currentViewPose() {
  const a = cam.from;
  const b = cam.to;
  const k = cam.t * cam.t * ( 3 - 2 * cam.t ); // smoothstep
  return {
    x: a.x + ( b.x - a.x ) * k,
    y: a.y + ( b.y - a.y ) * k,
    z: a.z + ( b.z - a.z ) * k,
    pitch: a.pitch + ( b.pitch - a.pitch ) * k,
    yaw: a.yaw + ( b.yaw - a.yaw ) * k,
    fov: a.fov + ( b.fov - a.fov ) * k,
  };
}

// Walking. Direction is relative to where the camera is looking, so "forward"
// always means "deeper into the field" from the viewer's seat, and the step is
// taken from the clock rather than from keydown repeats - holding a key glides
// instead of stuttering.
export function stepCamera( dt ) {
  if ( !state.walk ) return;
  const k = cam.keys;
  let fwd = ( k.ArrowUp ? 1 : 0 ) + ( k.KeyW ? 1 : 0 ) - ( k.ArrowDown ? 1 : 0 ) - ( k.KeyS ? 1 : 0 );
  let side = ( k.ArrowRight ? 1 : 0 ) + ( k.KeyD ? 1 : 0 ) - ( k.ArrowLeft ? 1 : 0 ) - ( k.KeyA ? 1 : 0 );
  const rise = ( k.KeyE ? 1 : 0 ) - ( k.KeyQ ? 1 : 0 ) + cam.hold;

  // The thumb pad stacks analog motion on top of the keys: the knob's offset
  // from the pad centre is the push, so a thumb near the middle creeps and one
  // stretched to the rim walks at full pace. Keys stay digital, so a desktop
  // that never shows the pad gets exactly the step it always had.
  if ( cam.pad.on ) {
    fwd += -cam.pad.y; // pushing the knob up the pad means walking away
    side += cam.pad.x;
  }

  const reach = Math.hypot( fwd, side );
  if ( reach <= TOUCH.padDead && !rise ) return;

  const p = currentViewPose();
  const yaw = THREE.MathUtils.degToRad( p.yaw ) + cam.look.yaw;
  const sin = Math.sin( yaw );
  const cos = Math.cos( yaw );
  // the camera looks down its own -Z, so world forward is (-sin, 0, -cos) and
  // world right is (cos, 0, -sin)
  const run = reach || 1;
  // direction is normalized once, so the pad's magnitude is what sets the pace:
  // keys read as reach 1 (a diagonal keys push is normalized to the same speed
  // as a cardinal one, exactly as before), a half pad push walks half as fast
  const step = WALK.speed * dt * Math.min( 1, reach );
  cam.move.x += ( -sin * fwd + cos * side ) * step / run;
  cam.move.z += ( -cos * fwd - sin * side ) * step / run;
  cam.move.y += rise * WALK.rise * dt;

  // clamp the walked-to position, not the offset, so the bounds mean the field
  cam.move.x = Math.min( WALK.maxX - p.x, Math.max( WALK.minX - p.x, cam.move.x ) );
  cam.move.z = Math.min( WALK.maxZ - p.z, Math.max( WALK.minZ - p.z, cam.move.z ) );
  cam.move.y = Math.min( WALK.maxY - p.y, Math.max( WALK.minY - p.y, cam.move.y ) );
}

// the collapse's own two reads: how far through the fall the eye is, eased in
// rather than smoothstepped so the body accelerates, and the one non-monotonic
// beat in it - the body hits the ground and takes a hand's width off the mud
// before settling. The drop reaches the ground at FALL.thud rather than at the
// end of the fall, which is what makes the bounce a thud on the mud rather than
// a hitch in mid-air
function fallEase( t ) {
  const d = Math.min( 1, t / FALL.thud );
  return d * d;
}

function fallThud( t ) {
  if ( t < FALL.thud ) return 0;
  const k = ( t - FALL.thud ) / ( 1 - FALL.thud );
  return Math.sin( k * Math.PI ) * FALL.lift;
}

// the collapse walks on the wall clock rather than the capped step, so a stalled
// tab still sees the whole fall rather than a body stuck halfway to the mud
export function stepFall( raw ) {
  if ( !health.dead || health.fall >= 1 ) return;
  health.fall = Math.min( 1, health.fall + raw / FALL.seconds );
}

export function applyCamera() {
  const p = currentViewPose();
  const yaw = THREE.MathUtils.degToRad( p.yaw ) + cam.look.yaw;
  let pitch = THREE.MathUtils.degToRad( p.pitch ) + cam.look.pitch;
  // the fall is stacked on top of whatever framing the camera is on rather than
  // replacing it, so a view button pressed after the collapse still leaves the
  // body lying rather than standing it back up on the tripod
  if ( health.fall > 0 ) {
    const e = fallEase( health.fall );
    const eye = p.y + cam.move.y;
    // the camera looks down its own -Z, so the direction the body fell along is
    // the same one the walker takes its steps from
    camera.position.set(
      p.x + cam.move.x - Math.sin( yaw ) * FALL.slide * e,
      eye - ( eye - FALL.lie ) * e + fallThud( health.fall ),
      p.z + cam.move.z - Math.cos( yaw ) * FALL.slide * e
    );
    // rotation order is YXZ, so z is the camera's own view axis: this is a roll
    // of the horizon rather than a lean the body would have to be standing to
    // take
    camera.rotation.z = FALL.roll * e;
    pitch += FALL.pitch * e;
  } else {
    camera.position.set( p.x + cam.move.x, p.y + cam.move.y, p.z + cam.move.z );
    camera.rotation.z = 0;
  }
  camera.rotation.x = pitch;
  camera.rotation.y = yaw;
  if ( Math.abs( camera.fov - p.fov ) > 0.01 ) {
    camera.fov = p.fov;
    camera.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------------------
// Lighting mode changes ease over a second so an hour does not snap.
// ---------------------------------------------------------------------------
export let rigTarget = null;
export let rigBlend = 1;

export function setLight( name ) {
  const preset = PRESETS[ name ];
  if ( !preset ) return;
  // the hour only costs the hand when it actually moved: naming the hour the
  // field is already under pins it and spends nothing, which is what keeps a
  // pinned screenshot harness from paying for a day it never walked through
  if ( name !== state.light ) passHour();
  rigTarget = preset;
  rigBlend = 0;
  state.light = name;
}

// The hour walks itself. Nothing on the page picks it any more, so the field
// steps through the presets in markup order - morning, afternoon, golden hour,
// back to morning - every ?cycle= seconds (60 by default = one minute) and each
// step eases over the same second a manual change would, which is what makes it
// read as an hour passing rather than a cut. Two things keep it out of the way:
// a paused field never advances its light (the clock only runs in the live
// branch of the loop), and an hour named in the url pins the scene to that one
// light - every screenshot harness names one, and a moving hour would make its
// frame pairs incomparable.
export const LIGHT_ORDER = Object.keys( PRESETS );
export let lightStage = Math.max( 0, LIGHT_ORDER.indexOf( params.light ) );
export let lightClock = 0;

export function advanceLight() {
  lightStage = ( lightStage + 1 ) % LIGHT_ORDER.length;
  lightClock = 0;
  setLight( LIGHT_ORDER[ lightStage ] );
}

export function cycleLight( wallDt ) {
  if ( params.lightPinned || params.cycle <= 0 ) return;
  // the hour rides the wall clock rather than the capped simulation step, so a
  // minute stays a real minute on screen whatever the frame rate is: the 0.06s
  // clamp the rest of the scene takes would stretch it to about 90s at 11fps,
  // which is exactly where a software-GL harness would disagree with a viewer
  lightClock += wallDt;
  // a floor of 2s keeps a tiny ?cycle= from strobing the sky every frame
  if ( lightClock < Math.max( 2, params.cycle ) ) return;
  advanceLight();
}

function easeRig( dt ) {
  if ( rigBlend < 1 ) {
    rigBlend = Math.min( 1, rigBlend + dt * 1.15 );
  }
  const k = rigBlend * rigBlend * ( 3 - 2 * rigBlend );
  const to = rigTarget;
  if ( !to ) return;
  const lerpNum = ( name ) => {
    rigNow[ name ] = rigNow[ name ] + ( to[ name ] - rigNow[ name ] ) * k;
  };
  const lerpCol = ( name ) => {
    rigNow[ name ].lerp( to[ name ], k );
  };
  const lerpVec = ( name ) => {
    rigNow[ name ].lerp( to[ name ], k ).normalize();
  };
  lerpVec( "sunDir" );
  lerpVec( "fillDir" );
  lerpCol( "sunColor" );
  lerpCol( "fillColor" );
  lerpCol( "hemiSky" );
  lerpCol( "hemiGround" );
  lerpCol( "skyTop" );
  lerpCol( "skyMid" );
  lerpCol( "skyHorizon" );
  lerpCol( "fogColor" );
  lerpCol( "farNear" );
  lerpCol( "farFar" );
  lerpNum( "sunIntensity" );
  lerpNum( "fillIntensity" );
  lerpNum( "hemiIntensity" );
  lerpNum( "fogDensity" );
  lerpNum( "cloud" );
  lerpNum( "exposure" );
}

export function applyRig() {
  sunLight.position.copy( rigNow.sunDir ).multiplyScalar( 240 );
  sunLight.color.copy( rigNow.sunColor );
  sunLight.intensity = rigNow.sunIntensity;
  fillLight.position.copy( rigNow.fillDir ).multiplyScalar( 180 );
  fillLight.color.copy( rigNow.fillColor );
  fillLight.intensity = rigNow.fillIntensity;
  hemiLight.color.copy( rigNow.hemiSky );
  hemiLight.groundColor.copy( rigNow.hemiGround );
  hemiLight.intensity = rigNow.hemiIntensity;
  scene.fog.color.copy( rigNow.fogColor );
  scene.fog.density = rigNow.fogDensity;
  renderer.toneMappingExposure = rigNow.exposure;
}

// ---------------------------------------------------------------------------
// Controls. The page owns the DOM; this module owns the scene, so the panel
// stays declarative in the markup and every control is a small state change
// here. The sickle toggle and the shop row are the two rows carrying action
// buttons now (plus the elevation row a phone needs): the light row is gone
// because the hour walks itself through the presets a minute at a time, and the
// wind slider, the camera row and the playback row were removed, so Shift+Arrow
// nudges the wind, Space toggles pause, k draws or sheathes the sickle, b opens
// or closes the shop card, and the arrow keys / WASD walk with nothing gating
// them. setWind / setPaused / setWalk / setSickle / setShop stay exported
// because the autotest harnesses drive them straight over the DevTools
// protocol, and setLight stays exported because the harness pins one hour.
// ---------------------------------------------------------------------------
export function setWind( v ) {
  state.wind = Math.max( 0, Math.min( 1, v ) );
  uniforms.uWind.value = state.wind;
}

export function setPaused( p ) {
  state.paused = !!p;
}

// drawing or sheathing the sickle: the same flip the panel's toggle and the k
// key take, so a thumb and a keyboard cannot disagree about which of the two
// the pointer is holding. Sheathing drops a swipe that was mid-way through.
//
// the panel's own toggle is remembered here rather than only in the click
// handler, because the keyboard flips the same mode and the panel must not
// still read "sheathed" while the blade is out
let sickleButton = null;

export function setSickle( v ) {
  state.sickle = v === true || v === 1 || v === "on" || v === "true" || v === "1";
  if ( sickleButton ) sickleButton.classList.toggle( "on", state.sickle );
  if ( state.sickle ) return;
  sickle.stroke.length = 0;
  sickle.cut.length = 0;
  sickle.spent = false;
}

export function wireUI() {
  // the actions are still found by their data-action rather than by where they
  // sit: the sickle is the bar at the lower left and the shop flip is its own
  // control at the top of the left edge. The framing is still reached with the
  // v key and with ?view= in the url, which is why setView stays exported
  for ( const node of document.querySelectorAll( "[data-action]" ) ) {
    const action = node.getAttribute( "data-action" );
    node.addEventListener( "click", ( e ) => {
      if ( action === "sickle" ) {
        // setSickle paints the .on class itself, so the click and the k key
        // leave the panel reading the same thing the mode is
        setSickle( !state.sickle );
        return;
      }
      if ( action === "shop" ) setShop( !shop.open );
    } );
    if ( action === "sickle" ) {
      sickleButton = node;
      // ?sickle=1 starts with the blade already drawn, so the panel has to
      // agree with the mode before a single click has happened
      sickleButton.classList.toggle( "on", state.sickle );
    }
    if ( action === "shop" ) {
      shopButton = node;
      // ?shop=1 opens the card at start, so the button has to read open before
      // a single click has happened
      shopButton.classList.toggle( "on", shop.open );
    }
  }

  // the card's own state, the prices and the purse line are written at start
  // rather than at the first click, so ?shop=1 shows a priced card the moment
  // the page boots and a closed card still reads the purse the player holds
  setShop( shop.open );

  // the hand's bar is painted at start rather than at the first cost, so the
  // meter reads a full day the moment the page boots and a harness never sees
  // an empty bar that the hand has not actually spent
  paintHealth();

  // The shop's own buttons: each carries the id of the piece it sells, so one
  // loop wires all of them and buy() decides whether the purse can pay. The row
  // re-reads the ledger the purchase just moved, so the price, the word and the
  // purse line all answer the same click rather than the next one.
  for ( const node of document.querySelectorAll( "[data-buy]" ) ) {
    const id = node.getAttribute( "data-buy" );
    node.addEventListener( "click", ( e ) => {
      buy( id );
      paintShop();
    } );
  }

  // -------------------------------------------------------------------------
  // Touch. A phone has no keys, so walking moves onto the glass: a thumb pad in
  // the lower right (held with the near thumb) steers through the same stepCamera
  // math the keys feed, and a pair of hold-to-press buttons covers the E / Q
  // rise. Both are plain DOM, so they take the same pointer events as everything
  // else, and a desktop never sees them - the stylesheet only paints them once
  // app.js marks <html> with .touch, which is the same test that armed them.
  // -------------------------------------------------------------------------
  if ( state.touch ) {
    document.documentElement.classList.add( "touch" );
    // a fingertip covers more glass than a cursor, so the pick has to be wider
    // or taps keep missing the stem they were aimed at
    hover.radius = TOUCH.tapRadius;

    const pad = document.getElementById( "pad" );
    const knob = document.getElementById( "pad-knob" );
    if ( pad ) {
      // park the pad just above the control bar rather than in a fixed corner:
      // the bar's height is whatever its rows came out to (they wrap on a narrow
      // phone), and a landscape phone is shorter than the bar plus a pad, so the
      // clamp keeps the pad on the glass instead of under the buttons
      const bar = document.getElementById( "panel" );
      if ( bar ) {
        const b = bar.getBoundingClientRect();
        const vh = window.innerHeight || b.bottom;
        const padH = pad.getBoundingClientRect().height;
        const above = vh - b.top + 14; // bar top plus a thumb's gap, from the bottom edge
        const highest = Math.max( 8, vh - padH - 8 ); // never clip off the top
        pad.style.bottom = Math.min( above, highest ) + "px";
      }

      let box = null;

      const push = ( cx, cy ) => {
        if ( !box || box.width <= 0 ) return;
        const rx = box.width / 2;
        const ry = box.height / 2;
        let x = ( cx - ( box.left + rx ) ) / rx;
        let y = ( cy - ( box.top + ry ) ) / ry;
        const m = Math.hypot( x, y );
        if ( m > 1 ) {
          // the knob stops at the rim, so the push never reads as more than a
          // full walk and a thumb that slides past the edge keeps walking straight
          x /= m;
          y /= m;
        }
        cam.pad.x = x;
        cam.pad.y = y;
        if ( knob ) {
          // the knob rides up to 34px of a 58px radius, so it stays inside the rim
          knob.style.transform = "translate(" + 34 * cam.pad.x + "px," + 34 * cam.pad.y + "px)";
        }
      };

      const engage = ( e ) => {
        box = pad.getBoundingClientRect();
        if ( box.width <= 0 ) return;
        cam.pad.on = true;
        push( e.clientX, e.clientY );
      };

      const release = () => {
        cam.pad.on = false;
        cam.pad.x = 0;
        cam.pad.y = 0;
        if ( knob ) knob.style.transform = "";
      };

      pad.addEventListener( "pointerdown", engage );
      pad.addEventListener( "pointermove", ( e ) => {
        if ( cam.pad.on ) push( e.clientX, e.clientY );
      } );
      pad.addEventListener( "pointerup", release );
      pad.addEventListener( "pointerleave", release );
    }

    // Hold-to-elevate: the press is what matters rather than a click, so these
    // listen to the pointer. data-hold rather than data-action keeps them out of
    // the button loop above, which would otherwise read a tap as a toggle.
    for ( const node of document.querySelectorAll( "[data-hold]" ) ) {
      const dir = parseFloat( node.getAttribute( "data-hold" ) );
      node.addEventListener( "pointerdown", ( e ) => {
        cam.hold = dir;
        node.classList.toggle( "on", true );
      } );
      const lift = () => {
        if ( cam.hold === dir ) cam.hold = 0;
        node.classList.toggle( "on", false );
      };
      node.addEventListener( "pointerup", lift );
      node.addEventListener( "pointerleave", lift );
    }
  }

  // Keyboard. Move keys are tracked rather than fired: keydown repeats would
  // otherwise stutter the pace, so the actual step is taken from the clock in
  // stepCamera and a held key just glides. Codes (not e.key) are matched so the
  // walk works on non-Latin layouts and under Shift.
  const MOVE_KEYS = {
    ArrowUp: 1,
    ArrowDown: 1,
    ArrowLeft: 1,
    ArrowRight: 1,
    KeyW: 1,
    KeyA: 1,
    KeyS: 1,
    KeyD: 1,
    KeyE: 1,
    KeyQ: 1,
  };

  window.addEventListener( "keydown", ( e ) => {
    if ( e.repeat ) return; // the held state is already in cam.keys
    if ( e.code === "Space" || e.key === " " ) {
      setPaused( !state.paused );
      return;
    }
    // plain arrows now walk, so the wind nudge moved under Shift
    if ( e.shiftKey && ( e.code === "ArrowLeft" || e.code === "ArrowRight" ) ) {
      setWind( state.wind + ( e.code === "ArrowRight" ? 0.08 : -0.08 ) );
      return;
    }
    if ( MOVE_KEYS[ e.code ] ) {
      cam.keys[ e.code ] = true;
      return;
    }
    // l steps to the next hour by hand - the same step the automatic cycle takes,
    // so it also resets the clock and does not immediately re-trigger
    if ( e.key === "l" ) advanceLight();
    // v is now the only way a viewer reaches the two framings by hand: the
    // view row left the panel, and setView still drops whatever they walked to
    else if ( e.key === "v" ) setView( state.view === "open" ? "among" : "open" );
    // k draws or sheathes the sickle: the same flip the panel's toggle takes, so
    // a keyboard and a thumb cannot disagree about which of the two the pointer
    // is holding
    else if ( e.key === "k" ) setSickle( !state.sickle );
    // b opens or closes the shop card: the same flip the Shop row's button takes.
    // b is free of the walk, which is all keys are: KeyS is a walk key rather than
    // a shop key, which is why the card does not answer to s
    else if ( e.key === "b" ) setShop( !shop.open );
  } );

  window.addEventListener( "keyup", ( e ) => {
    if ( MOVE_KEYS[ e.code ] ) delete cam.keys[ e.code ];
  } );

  // ---------------------------------------------------------------------------
  // Hover highlight: pointing at the field picks the plant whose stem is
  // nearest the cursor IN SCREEN SPACE. The instance matrix carries what we
  // need - column 4 is the plant root and column 1 is its up vector, whose
  // length is the plant height - so root and tip are pushed through the camera
  // once each and the cursor distance to that short segment decides the pick.
  // That is a few thousand multiply adds per pointer move, and it never needs
  // a ray/triangle test against three thousand plants. The winner is flagged
  // in the aFlags instanced attribute, which the patched rice material turns into
  // a bright leaf edge. The pick is independent of the camera controls and of
  // "Hold still", so a paused or held view can still be inspected.
  // ---------------------------------------------------------------------------
  const pickMatrix = new THREE.Matrix4();

  function setHover( tier, index, height ) {
    if ( hover.tier === tier && hover.index === index ) return;
    if ( hover.tier >= 0 ) {
      const prev = field.tiers[ hover.tier ].geometry.getAttribute( "aFlags" );
      // drop the outline bit only: a plant the blade took keeps its cut bit
      prev.array[ hover.index ] &= ~1;
      prev.needsUpdate = true;
    }
    hover.tier = tier;
    hover.index = index;
    hover.height = height;
    if ( tier >= 0 && index >= 0 ) {
      const attr = field.tiers[ tier ].geometry.getAttribute( "aFlags" );
      attr.array[ index ] |= 1;
      attr.needsUpdate = true;
    }
    // a live check keeps its own plant lit even when the cursor wanders off it,
    // so the plant the meter is about is the plant the outline is on
    if ( skill.active && skill.tier >= 0 ) {
      const held = field.tiers[ skill.tier ].geometry.getAttribute( "aFlags" );
      if ( ( held.array[ skill.index ] & 1 ) === 0 ) {
        held.array[ skill.index ] |= 1;
        held.needsUpdate = true;
      }
    }
  }

  function pickPlant( cx, cy, w, h ) {
    hover.x = cx;
    hover.y = cy;
    pickMatrix.copy( camera.projectionMatrix ).multiply( camera.matrixWorldInverse );
    const e = pickMatrix.elements;
    const ex = camera.position.x;
    const ez = camera.position.z;
    const r1 = Math.hypot( e[ 0 ], e[ 4 ], e[ 8 ] );
    const r3 = Math.hypot( e[ 3 ], e[ 7 ], e[ 11 ] );
    let bestTier = -1;
    let bestIndex = -1;
    let bestHeight = 0;
    let best = hover.radius; // only a plant this close to the cursor counts
    for ( let t = 0; t < field.tiers.length; t++ ) {
      const mesh = field.tiers[ t ];
      const m = mesh.instanceMatrix.array;
      const cut = mesh.userData.cut;
      const wind = mesh.geometry.attributes.aWind.array;
      const sway = mesh.geometry.attributes.aWindZ.array;
      for ( let i = 0; i < mesh.count; i++ ) {
        const o = i * 16;
        if ( cut[ i ] ) continue; // a cut plant is stubble: nothing to point at
        const x = m[ o + 12 ];
        const y = m[ o + 13 ];
        const z = m[ o + 14 ];
        const rw = e[ 3 ] * x + e[ 7 ] * y + e[ 11 ] * z + e[ 15 ];
        if ( rw <= 0.05 ) continue; // root behind the camera
        const k4 = i * 4;
        const hy = Math.hypot( m[ o + 4 ], m[ o + 5 ], m[ o + 9 ] );
        const ndcx = ( e[ 0 ] * x + e[ 4 ] * y + e[ 8 ] * z + e[ 12 ] ) / rw;
        // cheap reject first: the drawn stem can only be so far from the screen
        // column its root sits on, so a plant whose column is elsewhere on the
        // glass never needs its spine projected at all. Most of the field is
        // somewhere else, and at high quality the stand is ~12k instances, so
        // this is what keeps a pointer move cheap.
        const across = rootDrift( e, r1, r3, rw, ndcx, hy + 0.09 + 1.7 * Math.abs( wind[ k4 + 3 ] ), w );
        const rx = ( ndcx * 0.5 + 0.5 ) * w;
        if ( rx - across > cx + best ) continue;
        if ( rx + across < cx - best ) continue;
        // the same spine the reap walks, so the outlined plant is the plant the
        // blade will actually take rather than the one its root stands under
        const n = spineToScreen( e, m, o, wind, k4, sway[ i ], w, h, REAP_PX, REAP_PY );
        if ( n < 2 ) continue;
        let d2 = 1e18;
        for ( let j = 1; j < n; j++ ) {
          const dd = pointSegD2( cx, cy, REAP_PX[ j - 1 ], REAP_PY[ j - 1 ], REAP_PX[ j ], REAP_PY[ j ] );
          if ( dd < d2 ) d2 = dd;
        }
        // a slight bias toward nearer plants stops a plant far behind another
        // from winning when both sit under the cursor
        const d = Math.sqrt( d2 ) + Math.hypot( x - ex, z - ez ) * 0.02;
        if ( d < best ) {
          best = d;
          bestTier = t;
          bestIndex = i;
          bestHeight = hy;
        }
      }
    }
    setHover( bestTier, bestIndex, bestHeight );
  }

  // the animal under the cursor: the same screen-space reading pickPlant takes of
  // a stem, against the animal's own body rather than a stalk. A beast is a
  // scene object rather than an instance, so there is no per-instance flag to
  // light for it - the pick only decides what the next click answers to, and it
  // answers to the animal ahead of the plant standing behind it. The body is a
  // straight segment from the mud to the top of the merged geometry, which is
  // what an animal is: it does not bend like a stem, it bobs. The ring is wider
  // than a stem's 13 px because an animal is wider than a stalk and because a
  // hand aimed at a beast is a hand that has to be able to reach it.
  function pickBeast( cx, cy, w, h ) {
    hover.beast = null;
    hover.beastX = -1;
    hover.beastY = -1;
    if ( !beasts.list.length ) return;
    pickMatrix.copy( camera.projectionMatrix ).multiply( camera.matrixWorldInverse );
    const e = pickMatrix.elements;
    const ex = camera.position.x;
    const ez = camera.position.z;
    let best = BEAST_RULE.attack.pick; // only an animal this close on the glass counts
    let winner = null;
    let wx = 0;
    let wy = 0;
    for ( const b of beasts.list ) {
      const size = beastNodes.size[ b.spec.id ];
      const base = floorTop( b.x, b.z );
      const rw = e[ 3 ] * b.x + e[ 7 ] * base + e[ 11 ] * b.z + e[ 15 ];
      if ( rw <= 0.05 ) continue; // the animal is behind the eye
      const rx = ( ( e[ 0 ] * b.x + e[ 4 ] * base + e[ 8 ] * b.z + e[ 12 ] ) / rw * 0.5 + 0.5 ) * w;
      const ry = ( 0.5 - ( e[ 1 ] * b.x + e[ 5 ] * base + e[ 9 ] * b.z + e[ 13 ] ) / rw * 0.5 ) * h;
      const top = base + size.h;
      const tx = ( ( e[ 0 ] * b.x + e[ 4 ] * top + e[ 8 ] * b.z + e[ 12 ] ) / rw * 0.5 + 0.5 ) * w;
      const ty = ( 0.5 - ( e[ 1 ] * b.x + e[ 5 ] * top + e[ 9 ] * b.z + e[ 13 ] ) / rw * 0.5 ) * h;
      const d2 = pointSegD2( cx, cy, rx, ry, tx, ty );
      // the same slight bias toward nearer animals the plant pick carries, so an
      // animal far behind another does not win when both sit under the cursor
      const d = Math.sqrt( d2 ) + Math.hypot( b.x - ex, b.z - ez ) * 0.02;
      if ( d < best ) {
        best = d;
        winner = b;
        wx = ( rx + tx ) * 0.5;
        wy = ( ry + ty ) * 0.5;
      }
    }
    hover.beast = winner;
    hover.beastX = wx;
    hover.beastY = wy;
  }


  // Pointer: a bare move never touches the camera. Only a held button drags,
  // and a drag grabs the world: dragging right slides the scenery right, which
  // means the camera turns LEFT - the camera looks down its own -Z, so turning
  // left means yaw INCREASES. Yaw is unbounded, so a long drag spins all the way
  // round; it is folded to -PI..PI only to keep the number and the heading readout
  // readable, and the fold renders identically. Pitch stays clamped, so the
  // horizon can never flip over the top.
  const canvas = document.getElementById( "scene-canvas" );
  if ( canvas ) {
    canvas.addEventListener( "pointerdown", ( e ) => {
      cam.drag = { x: e.clientX, y: e.clientY };
      const r = canvas.getBoundingClientRect();
      if ( r.width <= 0 || r.height <= 0 ) return;
      pickPlant( e.clientX - r.left, e.clientY - r.top, r.width, r.height );
      // the animal's own pick runs after the plant's, so a click answers to
      // whichever of the two the cursor is nearer rather than to the stand alone
      pickBeast( e.clientX - r.left, e.clientY - r.top, r.width, r.height );
      // With the sickle drawn the press belongs to the blade, not to the check:
      // it puts the tip on the glass and starts a swipe, and the drag that
      // follows draws the line rather than turning the view. A cursor and a
      // finger take the same path here - a flick is a drag.
      if ( state.sickle ) {
        beginStroke( e.clientX - r.left, e.clientY - r.top, e.pointerType );
        return;
      }
      // A cursor arms on the press: it hovers first, so the press is a decision
      // the viewer already made. A finger cannot hover, and press-and-slide is
      // the one gesture the field uses to look around, so arming on press would
      // spend a check every time a viewer merely turned the head. The finger
      // instead leaves a tap record here and lift-off decides from how long and
      // how far it was down.
      if ( e.pointerType === "touch" ) {
        cam.tap = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: 0, t0: performance.now() };
        return;
      }
      if ( skill.active ) resolveSkill();
      else if ( hover.beast || hover.tier >= 0 ) armSkill();
    } );
    canvas.addEventListener( "pointermove", ( e ) => {
      const r = canvas.getBoundingClientRect();
      if ( r.width > 0 && r.height > 0 ) {
        cam.mouse.x = ( e.clientX - r.left ) / r.width * 2 - 1;
        cam.mouse.y = -( ( e.clientY - r.top ) / r.height * 2 - 1 );
        pickPlant( e.clientX - r.left, e.clientY - r.top, r.width, r.height );
        pickBeast( e.clientX - r.left, e.clientY - r.top, r.width, r.height );
      }
      if ( cam.tap ) {
        cam.tap.moved += Math.hypot( e.clientX - cam.tap.x, e.clientY - cam.tap.y );
        cam.tap.x = e.clientX;
        cam.tap.y = e.clientY;
        // the finger slid far enough that this was a look: drop the tap record
        // so the gesture arms nothing and the check stays unspent
        if ( cam.tap.moved > TOUCH.tapPx ) cam.tap = null;
      }
      if ( !cam.drag ) return; // no hover look: the pointer alone does nothing
      const dx = e.clientX - cam.drag.x;
      const dy = e.clientY - cam.drag.y;
      cam.drag.x = e.clientX;
      cam.drag.y = e.clientY;
      // the sickle drawn: the drag draws a line and reaps what is under it, and
      // the view stays put - which is the whole point of the toggle
      if ( state.sickle ) {
        if ( r.width > 0 && r.height > 0 ) reapStroke( e.clientX - r.left, e.clientY - r.top );
        return;
      }
      if ( !state.walk ) return; // "Hold still" also freezes the drag look
      // yaw is unbounded: fold it into -PI..PI rather than clamping it, so the
      // view can spin round and round without the number drifting away
      cam.look.yaw = ( ( cam.look.yaw + dx * WALK.dragSens + Math.PI ) % ( Math.PI * 2 ) + Math.PI * 2 ) % ( Math.PI * 2 ) - Math.PI;
      cam.look.pitch = Math.max( -WALK.dragPitch, Math.min( WALK.dragPitch, cam.look.pitch - dy * WALK.dragSens * 0.8 ) );
    } );
    canvas.addEventListener( "pointerup", ( e ) => {
      cam.drag = null;
      // the swipe ends: the blade finishes its cut and lifts off the glass, and
      // the cue it earned is answered for the whole swathe at once
      if ( state.sickle ) {
        endStroke();
        return;
      }
      if ( !cam.tap ) return;
      const slid = Math.hypot( e.clientX - cam.tap.x0, e.clientY - cam.tap.y0 );
      const held = performance.now() - cam.tap.t0;
      cam.tap = null;
      // the finger was down long or slid far: that was a look, and a look never
      // spends a check
      if ( held > TOUCH.tapMs || slid > TOUCH.tapPx ) return;
      // a tap: re-pick where the finger left the glass so the check binds to the
      // plant under the tap rather than wherever the finger drifted, and to the
      // animal under it if an animal is what the finger left on
      const r = canvas.getBoundingClientRect();
      if ( r.width <= 0 || r.height <= 0 ) return;
      pickPlant( e.clientX - r.left, e.clientY - r.top, r.width, r.height );
      pickBeast( e.clientX - r.left, e.clientY - r.top, r.width, r.height );
      if ( skill.active ) resolveSkill();
      else if ( hover.beast || hover.tier >= 0 ) armSkill();
    } );
    canvas.addEventListener( "pointerleave", ( e ) => {
      cam.drag = null;
      cam.tap = null; // a finger that left the field mid-touch is not a tap
      if ( state.sickle ) endStroke(); // a hand that left the glass spent the swipe
      setHover( -1, -1, 0 ); // the pointer left the field: nothing is outlined
      // and no animal is answered to: the pick is the cursor's, so leaving the
      // glass clears it rather than leaving a beast armed at the last place seen
      hover.beast = null;
      hover.beastX = -1;
      hover.beastY = -1;
    } );
    // the panel sits on top of the canvas, so a pointer that lands on it never
    // reaches the canvas listener and the pick would stay lit while the cursor
    // is elsewhere. A window-level listener sees every move, and its target is
    // whatever is under the pointer, so anything that is not the canvas clears
    // the pick - the drag above is unaffected, it reads cam.drag, not the pick
    window.addEventListener( "pointermove", ( e ) => {
      if ( e.target !== canvas ) {
        setHover( -1, -1, 0 );
        // the animal pick is the cursor's own, so a pointer that has moved onto
        // the panel is not a hand aimed at a beast
        hover.beast = null;
        hover.beastX = -1;
        hover.beastY = -1;
      }
    } );
  }
}

// ---------------------------------------------------------------------------
// The loop.
// ---------------------------------------------------------------------------
export const perf = { frames: 0, fps: 0, last: 0, lastStats: 0, simTime: 0, buffer: "" };

export function resize() {
  const el = document.getElementById( "scene-canvas" );
  if ( !el ) return;
  const w = Math.max( 1, Math.floor( el.clientWidth ) );
  const h = Math.max( 1, Math.floor( el.clientHeight ) );
  renderer.setSize( w, h, false );
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // what the GPU is actually being asked to shade. A frame this large is bound
  // by how many pixels it covers rather than by how many plants it holds, so
  // the buffer size and the multisampling the context ended up with belong in
  // the readout next to the frame rate
  const gl = renderer.getContext();
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize( size );
  perf.buffer = size.x + "x" + size.y + " @" + ( gl.SAMPLES ? gl.getParameter( gl.SAMPLES ) : 1 ) + "x";
}

export function frame( now ) {
  // raw is the true wall-clock gap and dt the capped simulation step: the stalks
  // take the cap so a stalled tab cannot teleport the wave train, the hour takes
  // raw so "one minute" stays a minute on screen at any frame rate
  const raw = Math.min( 0.5, Math.max( 0, ( now - perf.last ) / 1000 ) );
  const dt = Math.min( 0.06, raw );
  perf.last = now;
  if ( cam.t < 1 ) cam.t = Math.min( 1, cam.t + dt * 0.85 );
  if ( !state.paused ) {
    perf.simTime += dt;
    uniforms.uTime.value = perf.simTime;
    // the hour only advances in the live branch, so a paused field keeps its
    // light frozen along with the stalks; it takes the wall gap rather than the
    // capped step so a minute stays a minute
    cycleLight( raw );
  }
  // the loops follow the hour rather than the pause: a paused field keeps its
  // light, so it keeps its bird and its insects - pause holds the picture, not
  // the field's own sounds
  ambience();
  easeRig( dt );
  applyRig();
  stepCamera( dt );
  // the collapse belongs to the viewer rather than to the field's clock, so it
  // runs outside the pause guard along with the walk - and takes the wall gap
  // rather than the capped step so the fall is the same length at any frame rate
  stepFall( raw );
  applyCamera();
  // the field's own wildlife walks on the environment's clock, so a paused stand
  // holds the beasts with the stalks - and it reads the player's seat only once
  // the camera has actually been put where the walk says it is
  if ( !state.paused ) stepBeasts( dt );
  // the bars the animals wear are DOM rather than geometry, so they are painted
  // on the same pass as the rest of the glass - and outside the pause guard,
  // since a paused stand still shows what each animal has left of its hide
  paintBeastHp();
  // the held item rides the camera, so it follows the framing whether the
  // environment is paused or running - the arm belongs to the viewer, not to the
  // field's own clock
  stepSickle( now );
  // the wave train is a per-plant CPU pass, so it only runs when the
  // environment is actually moving
  if ( !state.paused )
    updateWind(
      field.tiers,
      uniforms.uTime.value,
      uniforms.uWind.value,
      uniforms.uWindSpeed.value,
      uniforms.uGust.value
    );
  // the fragment burst belongs to the environment, so it freezes with the rest
  // of it when the field is paused
  if ( !state.paused ) stepFx( dt );
  stepSkill( now );
  // the drawn line is DOM rather than geometry, so it is painted on the same
  // pass as the meter rather than in the scene graph
  paintStroke();
  // the burst a cut answers with is DOM as well, and it walks on the wall clock
  // like the meter does - pausing holds the environment, not the purse's answer,
  // so a cut made just before the pause still finishes its climb
  stepFlair( now );
  renderer.render( scene, camera );

  perf.frames++;
  if ( now - perf.lastStats > 500 ) {
    perf.fps = perf.frames * 1000 / ( now - perf.lastStats );
    perf.frames = 0;
    perf.lastStats = now;
    const stats = document.getElementById( "stats" );
    if ( stats ) {
      stats.textContent =
        "fps " + perf.fps.toFixed( 0 ) +
        " · plants " + field.instances.toLocaleString( "en-US" ) +
        " · draws " + renderer.info.render.calls +
        " · wind " + ( 100 * state.wind ).toFixed( 0 ) + "%" +
        // the hour is no longer a control, so the readout names the one the
        // field is under - otherwise an automatic change reads as a glitch
        " · light " + state.light +
        ( state.paused ? " · paused" : "" ) +
        // the sickle is a mode rather than a number, so the readout only names
        // it while it is drawn - a sheathed field reads exactly as before
        ( state.sickle ? " · sickle" : "" ) +
        // the shop card is a mode rather than a number, so the readout only
        // names it while the card is on the glass
        ( shop.open ? " · shop" : "" ) +
        " · cut " + harvest.cut +
        // the purse: what the cuts have paid in less what the sickle has
        // spent, so the money the player holds is readable at a glance
        " · gold " + purse.gold +
        // the kit the player is carrying: only named once anything is carried,
        // which is what keeps a field that has never been shopped in reading
        // the way it did before
        ( shop.bought > 0 ? " · gear " + shop.bought : "" ) +
        // a meal the purse paid for: named only once one has been eaten, which
        // is what keeps a field that has never bought food reading the way it
        // did before. It is kept apart from the carried kit, since a ration
        // fills the hand rather than moving a number the field runs on
        ( shop.eaten > 0 ? " · ate " + shop.eaten : "" ) +
        // the hand's own day: the bar on the glass is the same number, so the
        // cost of the next miss is legible in both places rather than one
        " · hp " + health.hp +
        // the fall the body is in: the eye is still moving while the collapse
        // runs, so the readout says which half of it the player is watching
        // rather than naming a state the picture has not reached yet
        ( health.dead ? ( health.fall < 1 ? " · falling" : " · down" ) : "" ) +
        // the field's own wildlife: named only while there is something standing
        // in the stand, which is what keeps a field that has never been let
        // loose in reading the way it did before
        ( beasts.live > 0 ? " · beasts " + beasts.live : "" ) +
        // the strike that just landed: the bar on the glass flashes with it, so
        // the readout names the animal that paid it for as long as it is fresh -
        // otherwise a drop in the hand would read as a misjudged cut
        ( performance.now() - beasts.struckAt < 1200 ? " · struck by " + beasts.last : "" ) +
        // an animal the hand's own check has driven off: named once any has
        // been, so the field's own wildlife reads as answered rather than as
        // only ever biting. It is kept apart from the blade's own count, since
        // the two answers are two answers rather than one tally
        ( beasts.driven > 0 ? " · driven " + beasts.driven : "" ) +
        // an animal the hand brought down rather than only drove off: named once
        // any has, so the stand reads as answered rather than as only ever biting,
        // and the fall is kept apart from the two drive-offs above because an
        // animal that went down is not one that only went off
        ( beasts.felled > 0 ? " · felled " + beasts.felled : "" ) +
        // the coin the purse has taken off those falls: kept apart from the gold
        // the cuts have paid so the readout says which of the two the purse grew
        // from, and named only once a kill has actually paid
        ( beasts.paid > 0 ? " · from hides " + beasts.paid : "" ) +
        // the fall that just happened: the bar over the animal goes away with it
        // and the purse takes the coin up, so the readout names the species that
        // paid it for as long as the fall is fresh
        ( performance.now() - beasts.felledAt < 1200 ? " · felled " + beasts.lastFell : "" ) +
        // the run the player is in: the count the verdict and the purse both
        // answer to, so a harness can read the streak rather than infer it from
        // the gold a cut paid. It stays out of the readout until the run is a
        // run, which is what keeps a field that has never been run through
        // reading the way it did before
        ( combo.streak > 1 ? " · combo " + combo.streak : "" ) +
        // the ring the hand works in: both tools answer to it, so the rule that
        // decides what a click can cut is legible rather than something the
        // viewer has to guess from a dead click. hand.reach is that ring as the
        // snath leaves it, so the number named is the ring the click actually cut
        " · reach " + hand.reach + "m" +
        // a click the ring refused: the check spent nothing, so the refusal is
        // named for as long as it is fresh - otherwise the one outcome the ring
        // produces would read as a cursor that did nothing at all
        ( performance.now() - skill.farAt < SKILL.verdict * 1000 ? " · too far" : "" ) +
        // a purchase the purse refused: the fee was spent nothing, so the refusal
        // is named for as long as it is fresh - otherwise a click on a piece the
        // purse cannot pay would read as a button that did nothing at all
        ( performance.now() - shop.refusedAt < SKILL.verdict * 1000 ? " · purse too light" : "" ) +
        // a ration the hand refused: the fee was spent nothing, so the refusal
        // is named for as long as it is fresh - otherwise a click on a row that
        // can recover nothing would read as a button that did nothing at all
        ( performance.now() - shop.fullAt < SKILL.verdict * 1000 ? " · not hungry" : "" ) +
        // a ration a fallen body asked for: the fee was spent nothing, so the
        // refusal is named for as long as it is fresh - otherwise a click on the
        // row would read as a button that did nothing at all
        ( performance.now() - shop.goneAt < SKILL.verdict * 1000 ? " · no hand" : "" ) +
        " · buffer " + perf.buffer;
    }
    // the card reads the ledger it is priced against on the same 500 ms clock
    // the readout walks, so a price the purse has since grown stops wearing the
    // rust and one the purse has since spent stops reading as affordable: the
    // rows answer the purse rather than the last click, which is what keeps a
    // closed card paying the layout nothing at all
    if ( shop.open ) paintShop();
  }
}

export function start() {
  build();
  buildField();
  // the beasts' geometries are merged once at start rather than at the first
  // spawn, so the first bear the stand lets loose costs the same as the tenth
  buildBeasts();
  // the bars the animals wear are built at start rather than at the first spawn,
  // so the first beast the stand lets loose wears a bar the same way the tenth
  // one does
  buildBeastHp();
  wireUI();
  // the burst's node pool is built at start rather than at the first cut, so
  // the first pass through the field answers the same way the hundredth does
  buildFlair();
  resize();
  window.addEventListener( "resize", () => resize() );
  if ( params.autotest ) {
    window.__verdant = {
      setWind,
      setLight,
      setPaused,
      setView,
      setWalk,
      resetWalk,
      cam,
      camera,
      // the framing the camera runs on, so a harness can turn the view onto an
      // animal rather than wait for one to walk into frame: the bars the animals
      // wear are pinned to the camera, so a leg that reads them back needs the
      // glass over a body to read against
      applyCamera,
      state,
      uniforms,
      field,
      hover,
      renderer,
      skill,
      harvest,
      // the purse and its table, so a harness can check the money an outcome
      // earned rather than infer it from the readout
      purse,
      GOLD,
      // the run: its state and its cap, so a harness can watch a streak grow,
      // read the gold it bought and prove where it stopped growing
      combo,
      COMBO,
      // the shop: its ledger, its table, the numbers the carried kit moves and
      // the two halves that price and buy a piece, so a harness can prove a
      // purchase spent its fee off the purse, moved the rule it names and left
      // the bare table alone rather than click a button
      shop,
      EQUIPMENT,
      EQUIPMENT_BY_ID,
      gear,
      buy,
      setShop,
      paintShop,
      // the hand's day: its ledger, its bare table, and the two halves that pay
      // a cost and take a meal back, so a harness can prove a miss and an hour
      // spent the hand off rather than read the bar's width back
      health,
      HP,
      hurt,
      heal,
      passHour,
      paintHealth,
      // the collapse: the table the camera work runs on and the two halves that
      // mark the body down and walk the eye down after it, so a harness can read
      // the fall back out of the camera rather than infer it from a screenshot
      FALL,
      downPlayer,
      stepFall,
      // the field's own wildlife: its state, its table, its rule and the halves
      // that let a beast loose, walk the stand, clear it and drive a beast off -
      // by the blade or by the check aimed at one - so a harness can prove a
      // bear reached the hand and paid its damage off the hand's own ledger
      // rather than watch for one in a screenshot
      beasts,
      BEASTS,
      BEAST_RULE,
      spawnBeast,
      stepBeasts,
      clearBeasts,
      frightenBeasts,
      strikeBeast,
      // the animals' own hides: the hit that lands on one, the fall that takes it
      // out of the stand, the coin a fall pays into the purse and the two halves
      // that build and paint the bars the animals wear - so a harness can prove
      // an attack spent an animal's hide rather than its day, that a fall left
      // the roster rather than an animal standing at zero, and read a bar's share
      // back out of the markup rather than out of a screenshot
      damageBeast,
      fellBeast,
      giveGold,
      buildBeastHp,
      paintBeastHp,
      // the hour's own two halves, so a harness can walk the field one hour at
      // a time rather than wait out a minute for the page to do it
      advanceLight,
      cycleLight,
      // the live holders the carried kit moves: the ring the hand works in and
      // the bands the check grades on, so a harness can prove the snath and the
      // whetstone moved the rule rather than the table it was told
      hand,
      bands,
      gradeAt,
      // the check's own two halves, so a harness can play a named grade rather
      // than fight the frame clock to land the needle on it
      armSkill,
      resolveSkill,
      SKILL,
      TOUCH,
      // the fragment burst, so a harness can count what one cut threw off and
      // watch it fall rather than infer it from pixels
      cutFx,
      CUT_FX,
      // the burst's own step, so a harness can park fragments anywhere and have
      // the page rewrite their matrices rather than duplicating the matrix math
      stepFx,
      // the purse made visible: the burst's state and its ladder, and the two
      // halves that arm and walk it, so a harness can prove a cut answered at the
      // point it went through and that the answer dressed itself with the run
      // rather than infer any of it from pixels
      flair,
      FLAIR,
      flairTier,
      spawnFlair,
      stepFlair,
      // the cues and the record of what the page chose to play, so a harness can
      // check the sound an outcome was answered with rather than listen to it
      sound,
      SOUND,
      playSound,
      ambience,
      // the sickle: the mode, the swipe's own record, and the item's pose, so a
      // harness can read what a drawn line reaped rather than infer it from
      // pixels
      sickle,
      SICKLE,
      // the bare ring both tools answer to, so a harness can prove which plants
      // the hand was near and that a carried piece moved the live holder rather
      // than the table it was told
      REACH,
      sickleRig,
      setSickle,
      beginStroke,
      reapStroke,
      endStroke,
      paintStroke,
      // the url knobs, so a harness can read the hour length it is actually
      // running under rather than assume it
      params,
    };
  }
  perf.lastStats = performance.now();
  perf.last = performance.now();
  let raf = 0;
  const step = () => {
    frame( performance.now() );
    raf = requestAnimationFrame( step );
  };
  frame( performance.now() );
  raf = requestAnimationFrame( step );
}

start();
