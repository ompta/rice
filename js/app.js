// js/app.js — VERDANT. A sea of green.
//
// Layout of the whole experience:
//   sky dome      raw shader, gradient + cloud + sun bloom
//   hills         three unlit silhouette bands, atmospheric perspective
//   tree line     instanced trunks + canopies, irregular spacing
//   far field     one ring plane, coloured by the same wave train as the rice
//   ground        lit paddy floor under the rice, procedural
//   rice          three InstancedMesh tiers (near / mid / far), GPU wind
//   hover         pointing at the field outlines one plant in bright leaf edges
//   skill check   clicking a plant arms a meter, a second click plays it and a
//                 pass cuts the plant
//   cut fragments a pass also slices the plant: five slivers of leaf tear off
//                 at the cut plane and fall, all of them one InstancedMesh
//   sound         golden hour loops the evening cicada and the skill check
//                 answers itself: a great cut, an ordinary cut, a miss
//
// Nothing is loaded: every geometry and material here is procedural, so the
// page's only dependency is three.js itself, which index.html's import map
// pulls from a CDN pinned to r170 - the exact build the onBeforeCompile
// injections in js/shaders.js are written against. Nothing is vendored here;
// "npm install three@0.170.0" plus a one-line url swap is the offline fallback.
import * as THREE from "three";
import { buildPlantGeometry, mulberry32 } from "./plants.js";
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
  };
})();

state.wind = params.wind;
state.light = params.light;
state.view = params.view;
state.paused = params.paused;
state.quality = params.quality;
state.walk = params.walk;

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
    [ -0.58, 0.34, -0.52, "#e6ecf2", 1.55, 0.7, 0.25, 0.6, "#9db4c8", 0.55 ],
    [ "#b8c9dd", "#7e97b4", "#a9bccd", "#d3dbe2", 0.62 ],
    [ "#465236", 0.95 ],
    [ "#c4d0dc", 0.0074, "#5f7d52", "#8ba39a", 1.02 ]
  ),
  afternoon: makePreset(
    [ 0.22, 0.86, -0.36, "#f4f2ea", 1.95, -0.6, 0.3, 0.55, "#aebccf", 0.62 ],
    [ "#a6bfd6", "#7e9cb8", "#c2cdd6", 0.5 ],
    [ "#4d5a38", 1.05 ],
    [ "#c8d2d9", 0.0066, "#5f7f4c", "#93a68e", 1.0 ]
  ),
  golden: makePreset(
    [ 0.88, 0.17, 0.34, "#ffd9a2", 2.35, -0.7, 0.35, 0.4, "#7f96b8", 0.7 ],
    [ "#8fa3bd", "#c0b4a4", "#f0d9ae", 0.58 ],
    [ "#5a5236", 1.0 ],
    [ "#e6cfab", 0.0072, "#6d7a45", "#a89b78", 1.06 ]
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
  uTime: uniforms.uTime,
};

export const farU = {
  uFarNear: { value: rigNow.farNear },
  uFarFar: { value: rigNow.farFar },
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
    { z: -104, depth: 26, base: -7, amp: 12.5, freq: 0.0102, seed: 11.3, top: "#4e6a4a", bot: "#3d5340" },
    { z: -150, depth: 40, base: -4, amp: 15.0, freq: 0.0071, seed: 4.7, top: "#63785f", bot: "#4d6157" },
    { z: -215, depth: 60, base: 0, amp: 17.0, freq: 0.0049, seed: 21.9, top: "#8194a0", bot: "#6c7f8e" },
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
  const ground = new THREE.Mesh(
    displacedGround( 150, 84, 0.05 ),
    makeGroundMaterial( uniforms, "#6b7a58" )
  );
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = 3; // behind the rice, in front of the distant field
  scene.add( ground );

  const farField = new THREE.Mesh(
    new THREE.RingGeometry( 13, 175, 128, 5 ),
    makeFarFieldMaterial( uniforms, { color: "#ffffff", near: farU.uFarNear, far: farU.uFarFar } )
  );
  farField.rotation.x = -Math.PI / 2;
  farField.position.y = 0.02;
  farField.renderOrder = 4;
  scene.add( farField );

  // --- cut fragments --------------------------------------------------------
  // One InstancedMesh for every fragment the whole session will throw, so a cut
  // costs no draw call and no allocation. See spawnCutFx / stepFx below.
  buildFx();

  return { renderer, scene, camera };
}

// A low-lying silhouette band: bottom edge near, ridge edge far, vertex
// colours so the ridge catches a little more light than the valley.
function hillBand( spec ) {
  const N = 190;
  const pos = [];
  const col = [];
  const idx = [];
  const topC = new THREE.Color( spec.top );
  const botC = new THREE.Color( spec.bot );
  for ( let i = 0; i <= N; i++ ) {
    const x = -350 + 700 * i / N;
    const wob =
      Math.sin( x * spec.freq + spec.seed ) * 0.62 +
      Math.sin( x * spec.freq * 2.7 + spec.seed * 2.3 ) * 0.26 +
      Math.sin( x * spec.freq * 6.1 - spec.seed ) * 0.12;
    const top = spec.base + spec.amp * ( 0.72 + 0.42 * wob );
    pos.push( x, spec.base - 9, spec.z );
    pos.push( x, top, spec.z + spec.depth * 0.55 );
    col.push( botC.r, botC.g, botC.b );
    col.push( topC.r, topC.g, topC.b );
  }
  for ( let i = 0; i < N; i++ ) {
    const a = i * 2;
    idx.push( a, a + 2, a + 3, a, a + 3, a + 1 );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute( "position", new THREE.Float32BufferAttribute( pos, 3 ) );
  geo.setAttribute( "color", new THREE.Float32BufferAttribute( col, 3 ) );
  geo.setIndex( idx );
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial( { vertexColors: true, fog: true } );
  return new THREE.Mesh( geo, mat );
}

// The paddy floor: a wide plane with a gentle noise displacement so the
// surface is not dead flat under the wind shader.
function displacedGround( radius, segs, amp ) {
  const geo = new THREE.PlaneGeometry( radius * 2, radius * 2, segs, segs );
  const p = geo.attributes.position.array;
  const rnd = mulberry32( 0x51de );
  for ( let i = 0; i < p.length; i += 3 ) {
    const x = p[ i ];
    const y = p[ i + 1 ];
    p[ i + 2 ] =
      amp * ( Math.sin( x * 0.07 ) * 0.5 + Math.cos( y * 0.09 ) * 0.4 + rnd() * 0.5 - 0.25 );
  }
  geo.computeVertexNormals();
  return geo;
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
// One jittered grid pass per LOD tier. Rows stay rows (that is what sells the
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

// ---------------------------------------------------------------------------
// Skill check: clicking a plant arms a Dead by Daylight style meter - a needle
// sweeps the track left to right and the next click plays it. Where the needle
// happens to be decides the grade, and every pass cuts the plant.
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

export const harvest = { cut: 0, great: 0, good: 0, normal: 0, fail: 0 };

export const skill = {
  active: false,
  tier: -1,
  index: -1,
  x: 0, // where the click landed, so the meter stays put while the cursor roams
  y: 0,
  zone: 0, // centre of the target zone, 0..1 along the track
  needle: 0, // 0..1 along the track
  startedAt: 0,
  at: 0, // where the needle was when the last click landed
  last: "", // "" | fail | normal | good | great
  verdictAt: -1, // when the last verdict was shown, -1 before the first check
};

// the grade is a distance from the zone centre against the nested bands, so
// one subtraction decides all four variants
export function gradeAt( pos ) {
  const d = Math.abs( pos - skill.zone );
  if ( d <= SKILL.bands.great ) return "great";
  if ( d <= SKILL.bands.good ) return "good";
  if ( d <= SKILL.bands.normal ) return "normal";
  return "fail";
}

export function armSkill() {
  if ( hover.tier < 0 ) return; // nothing under the cursor: nothing to check
  skill.active = true;
  skill.tier = hover.tier;
  skill.index = hover.index;
  skill.x = hover.x;
  skill.y = hover.y;
  // the zone centre stays a whole normal band plus the lead in from both ends,
  // which is what makes an instant click a guaranteed miss
  const span = 1 - 2 * ( SKILL.bands.normal + SKILL.lead );
  skill.zone = SKILL.bands.normal + SKILL.lead + Math.random() * span;
  skill.needle = 0;
  skill.startedAt = performance.now();
}

export function resolveSkill() {
  const grade = gradeAt( skill.needle );
  skill.at = skill.needle;
  skill.last = grade;
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
  const hi = mesh.geometry.getAttribute( "aHi" );
  if ( hi.array[ index ] !== 0 ) {
    hi.array[ index ] = 0;
    hi.needsUpdate = true;
  }
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
// nothing. The pool is sized for a burst a second across the whole life of a
// fragment - a few dozen slots - so the field never gets near it.
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
  pool: 96,            // slots the one draw call carries
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

// the meter advances on the wall clock rather than on perf.simTime, so a paused
// field still plays the check - pausing holds the environment, not the UI
export function stepSkill( now ) {
  if ( skill.active ) {
    skill.needle = ( now - skill.startedAt ) / ( SKILL.sweep * 1000 );
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
    const half = SKILL.bands[ key ];
    band.style.left = pct( skill.zone - half );
    band.style.width = pct( half * 2 );
  }
  const needle = document.getElementById( "skill-needle" );
  if ( needle ) needle.style.left = pct( skill.needle );
  if ( meterVerdict ) {
    const fresh = skill.verdictAt >= 0 && now - skill.verdictAt < SKILL.verdict * 1000;
    meterVerdict.textContent = fresh ? verdictText( skill.last ) : "";
    meterVerdict.className = "verdict " + skill.last;
  }
}

function verdictText( grade ) {
  if ( grade === "great" ) return "Great cut";
  if ( grade === "good" ) return "Good cut";
  if ( grade === "normal" ) return "Cut";
  if ( grade === "fail" ) return "Missed";
  return "";
}

// ---------------------------------------------------------------------------
// Sound. Four files, and none of them is fetched until it is asked for: an
// Audio element made with preload="none" costs nothing on the wire until play(),
// so a field that never reaches golden hour and is never cut never moves a byte
// over the network.
//
// The hour owns one of them. higurashi (the evening cicada, whose cry is what
// marks dusk over the paddies) loops for as long as the field is under the
// golden preset - the page's sunset hour - and is stopped and rewound the moment
// the hour leaves, so the next golden hour starts the cicada at the top of its
// loop rather than at wherever the last one left it.
//
// The skill check owns the other three, and it answers itself: a great cut, an
// ordinary cut (good and normal share one cue) and a miss.
// ---------------------------------------------------------------------------
export const SOUND = {
  ambience: "higurashi.mp3",
  great: "cutgreat.mp3",
  normal: "cutnormal.mp3",
  hurt: "hurt.mp3",
  golden: "golden", // the hour the cicada belongs to
  ambienceVolume: 0.55, // the loop sits under the field rather than over it
  effectVolume: 0.9,
};

export const sound = {
  volume: Math.min( 1, Math.max( 0, params.sound ) ), // ?sound=0 mutes the field
  ambience: null, // the looping element while the golden hour holds
  ambienceName: "",
  plays: [], // what the page chose to play, oldest first: { name, reason, at, stop }
  elements: {}, // file -> element, so a cue is fetched once and replayed from memory
};

// the element for a file, made on the first request and kept: replaying a cue
// never re-requests the mp3
function element( name ) {
  const held = sound.elements[ name ];
  if ( held ) return held;
  const a = new Audio( name );
  a.preload = "none";
  a.volume = sound.volume * ( name === SOUND.ambience ? SOUND.ambienceVolume : SOUND.effectVolume );
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

// the cicadas follow the hour rather than the pause: a paused field keeps its
// light, so it keeps its insects
export function ambience() {
  if ( state.light === SOUND.golden ) {
    if ( sound.ambience || sound.volume <= 0 ) return;
    const a = element( SOUND.ambience );
    a.loop = true;
    a.currentTime = 0;
    a.play().catch( () => {} );
    sound.ambience = a;
    sound.ambienceName = SOUND.ambience;
    logPlay( SOUND.ambience, "golden hour", false );
    return;
  }
  if ( !sound.ambience ) return;
  const left = sound.ambienceName;
  sound.ambience.pause();
  // rewind so the next golden hour starts the cicada from the top of the loop
  // rather than from wherever the last one left it
  sound.ambience.currentTime = 0;
  sound.ambience = null;
  sound.ambienceName = "";
  logPlay( left, "left golden hour", true );
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
    { name: "near", detail: "near", r0: 0, r1: 7.2, step: 0.31, lean: 0.05 },
    { name: "mid", detail: "mid", r0: 7.2, r1: 25, step: 0.56, lean: 0.06 },
    { name: "far", detail: "far", r0: 25, r1: 84, step: 1.28, lean: 0.07 },
  ];

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
        spots.push( px, pz, d );
        if ( spec.detail === "near" && rnd() > 0.9 ) {
          spots.push( px + ( rnd() - 0.5 ) * 0.5, pz + ( rnd() - 0.5 ) * 0.5, d );
        }
      }
    }

    const count = spots.length / 3;
    const geo = new THREE.BufferGeometry();
    const src = buildPlantGeometry( spec.detail );
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
    // 0 for every plant until the pointer picks one; the pick rewrites this
    // one float per hover change and the rice material turns it into a bright
    // leaf edge, so the highlight costs no extra draw call
    geo.setAttribute( "aHi", new THREE.InstancedBufferAttribute( new Float32Array( count ), 1 ) );
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
  open: { x: 0.55, y: 1.78, z: 6.4, pitch: 2.55, yaw: 0.0, fov: 48.5 },
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
  minY: 0.45, // eye height never goes below the rice
  maxY: 9, // and never becomes a map view
  dragPitch: 0.3,
  dragSens: 0.0045, // radians per pixel of drag
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

// A view button is also a framing reset: whatever the viewer walked to is
// dropped, which is what makes the two framings reliable reference shots.
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

export function applyCamera() {
  const p = currentViewPose();
  const yaw = THREE.MathUtils.degToRad( p.yaw ) + cam.look.yaw;
  const pitch = THREE.MathUtils.degToRad( p.pitch ) + cam.look.pitch;
  camera.position.set( p.x + cam.move.x, p.y + cam.move.y, p.z + cam.move.z );
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
// here. Only the view row (plus the elevation row a phone needs) carries
// buttons now: the light row is gone because the hour walks itself through the
// presets a minute at a time, and the wind slider, the camera row and the
// playback row were removed, so Shift+Arrow nudges the wind, Space toggles
// pause, and the arrow keys / WASD walk with nothing gating them. setWind /
// setPaused / setWalk stay
// exported because the autotest harness drives them straight over the DevTools
// protocol, and setLight stays exported because the harness pins one hour.
// ---------------------------------------------------------------------------
export function setWind( v ) {
  state.wind = Math.max( 0, Math.min( 1, v ) );
  uniforms.uWind.value = state.wind;
}

export function setPaused( p ) {
  state.paused = !!p;
}

export function wireUI() {
  // the view row is the only row left with buttons, so this loop has one action
  // to serve; the hour is automatic and wind / pause / walk are keyboard-only
  for ( const node of document.querySelectorAll( "[data-action]" ) ) {
    node.addEventListener( "click", ( e ) => {
      setView( node.getAttribute( "data-value" ) );
      node.classList.toggle( "on", true );
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
    else if ( e.key === "v" ) setView( state.view === "open" ? "among" : "open" );
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
  // in the aHi instanced attribute, which the patched rice material turns into
  // a bright leaf edge. The pick is independent of the camera controls and of
  // "Hold still", so a paused or held view can still be inspected.
  // ---------------------------------------------------------------------------
  const pickMatrix = new THREE.Matrix4();

  function setHover( tier, index, height ) {
    if ( hover.tier === tier && hover.index === index ) return;
    if ( hover.tier >= 0 ) {
      const prev = field.tiers[ hover.tier ].geometry.getAttribute( "aHi" );
      prev.array[ hover.index ] = 0;
      prev.needsUpdate = true;
    }
    hover.tier = tier;
    hover.index = index;
    hover.height = height;
    if ( tier >= 0 && index >= 0 ) {
      const attr = field.tiers[ tier ].geometry.getAttribute( "aHi" );
      attr.array[ index ] = 1;
      attr.needsUpdate = true;
    }
    // a live check keeps its own plant lit even when the cursor wanders off it,
    // so the plant the meter is about is the plant the outline is on
    if ( skill.active && skill.tier >= 0 ) {
      const held = field.tiers[ skill.tier ].geometry.getAttribute( "aHi" );
      if ( held.array[ skill.index ] === 0 ) {
        held.array[ skill.index ] = 1;
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
    let bestTier = -1;
    let bestIndex = -1;
    let bestHeight = 0;
    let best = hover.radius; // only a plant this close to the cursor counts
    for ( let t = 0; t < field.tiers.length; t++ ) {
      const mesh = field.tiers[ t ];
      const m = mesh.instanceMatrix.array;
      const cut = mesh.userData.cut;
      for ( let i = 0; i < mesh.count; i++ ) {
        const o = i * 16;
        if ( cut[ i ] ) continue; // a cut plant is stubble: nothing to point at
        const x = m[ o + 12 ];
        const z = m[ o + 14 ];
        const hy = Math.hypot( m[ o + 1 ], m[ o + 5 ], m[ o + 9 ] );
        const rw = e[ 3 ] * x + e[ 11 ] * z + e[ 15 ];
        if ( rw <= 0 ) continue; // root behind the camera
        const rx = ( ( e[ 0 ] * x + e[ 8 ] * z + e[ 12 ] ) / rw * 0.5 + 0.5 ) * w;
        // cheap reject first: the camera never rolls, so a stem (and the
        // vertical segment we score it on) projects to a vertical screen
        // line, which means the column alone can rule a plant out. Most of
        // the field is somewhere else on the screen, and at high quality the
        // field is ~12k instances, so this is what keeps a pointer move cheap
        const across = rx - cx;
        if ( across > best + 1 || across < -( best + 1 ) ) continue;
        const tw = e[ 3 ] * x + e[ 7 ] * hy + e[ 11 ] * z + e[ 15 ];
        if ( tw <= 0 ) continue; // tip behind the camera
        const ry = ( 0.5 - ( e[ 1 ] * x + e[ 9 ] * z + e[ 13 ] ) / rw * 0.5 ) * h;
        const tx = ( ( e[ 0 ] * x + e[ 4 ] * hy + e[ 8 ] * z + e[ 12 ] ) / tw * 0.5 + 0.5 ) * w;
        const ty = ( 0.5 - ( e[ 1 ] * x + e[ 5 ] * hy + e[ 9 ] * z + e[ 13 ] ) / tw * 0.5 ) * h;
        const sx = tx - rx;
        const sy = ty - ry;
        const l2 = sx * sx + sy * sy;
        let k = l2 > 1e-6 ? ( ( cx - rx ) * sx + ( cy - ry ) * sy ) / l2 : 0;
        if ( k < 0 ) k = 0;
        else if ( k > 1 ) k = 1;
        const qx = rx + sx * k - cx;
        const qy = ry + sy * k - cy;
        // a slight bias toward nearer plants stops a plant far behind another
        // from winning when both sit under the cursor
        const d = Math.hypot( qx, qy ) + Math.hypot( x - ex, z - ez ) * 0.02;
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
      else if ( hover.tier >= 0 ) armSkill();
    } );
    canvas.addEventListener( "pointermove", ( e ) => {
      const r = canvas.getBoundingClientRect();
      if ( r.width > 0 && r.height > 0 ) {
        cam.mouse.x = ( e.clientX - r.left ) / r.width * 2 - 1;
        cam.mouse.y = -( ( e.clientY - r.top ) / r.height * 2 - 1 );
        pickPlant( e.clientX - r.left, e.clientY - r.top, r.width, r.height );
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
      if ( !state.walk ) return; // "Hold still" also freezes the drag look
      // yaw is unbounded: fold it into -PI..PI rather than clamping it, so the
      // view can spin round and round without the number drifting away
      cam.look.yaw = ( ( cam.look.yaw + dx * WALK.dragSens + Math.PI ) % ( Math.PI * 2 ) + Math.PI * 2 ) % ( Math.PI * 2 ) - Math.PI;
      cam.look.pitch = Math.max( -WALK.dragPitch, Math.min( WALK.dragPitch, cam.look.pitch - dy * WALK.dragSens * 0.8 ) );
    } );
    canvas.addEventListener( "pointerup", ( e ) => {
      cam.drag = null;
      if ( !cam.tap ) return;
      const slid = Math.hypot( e.clientX - cam.tap.x0, e.clientY - cam.tap.y0 );
      const held = performance.now() - cam.tap.t0;
      cam.tap = null;
      // the finger was down long or slid far: that was a look, and a look never
      // spends a check
      if ( held > TOUCH.tapMs || slid > TOUCH.tapPx ) return;
      // a tap: re-pick where the finger left the glass so the check binds to the
      // plant under the tap rather than wherever the finger drifted
      const r = canvas.getBoundingClientRect();
      if ( r.width <= 0 || r.height <= 0 ) return;
      pickPlant( e.clientX - r.left, e.clientY - r.top, r.width, r.height );
      if ( skill.active ) resolveSkill();
      else if ( hover.tier >= 0 ) armSkill();
    } );
    canvas.addEventListener( "pointerleave", ( e ) => {
      cam.drag = null;
      cam.tap = null; // a finger that left the field mid-touch is not a tap
      setHover( -1, -1, 0 ); // the pointer left the field: nothing is outlined
    } );
    // the panel sits on top of the canvas, so a pointer that lands on it never
    // reaches the canvas listener and the pick would stay lit while the cursor
    // is elsewhere. A window-level listener sees every move, and its target is
    // whatever is under the pointer, so anything that is not the canvas clears
    // the pick - the drag above is unaffected, it reads cam.drag, not the pick
    window.addEventListener( "pointermove", ( e ) => {
      if ( e.target !== canvas ) setHover( -1, -1, 0 );
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
  // the cicadas follow the hour rather than the pause: a paused field keeps its
  // light, so it keeps its insects - pause holds the picture, not the field's
  // own sounds
  ambience();
  easeRig( dt );
  applyRig();
  stepCamera( dt );
  applyCamera();
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
        " · cut " + harvest.cut +
        " · buffer " + perf.buffer;
    }
  }
}

export function start() {
  build();
  buildField();
  wireUI();
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
      state,
      uniforms,
      field,
      hover,
      renderer,
      skill,
      harvest,
      gradeAt,
      SKILL,
      TOUCH,
      // the fragment burst, so a harness can count what one cut threw off and
      // watch it fall rather than infer it from pixels
      cutFx,
      CUT_FX,
      // the burst's own step, so a harness can park fragments anywhere and have
      // the page rewrite their matrices rather than duplicating the matrix math
      stepFx,
      // the cues and the record of what the page chose to play, so a harness can
      // check the sound an outcome was answered with rather than listen to it
      sound,
      SOUND,
      playSound,
      ambience,
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
