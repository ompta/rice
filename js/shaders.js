// js/shaders.js — the single place that owns every GLSL string in the scene.
//
// Everything green here is procedural: no textures are loaded, so the only
// thing the page fetches is the pinned three.js build itself. The rice field is
// one InstancedMesh per level of detail whose
// MeshLambertMaterial is patched (onBeforeCompile) with a wind function that
// runs entirely on the GPU - the CPU never touches a plant per frame.
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Wind. One function, shared by every LOD tier, so a plant 4 m away and one
// 60 m away answer to the same weather.
//
// The wave train itself is evaluated on the CPU (see prepareWind / updateWind
// below) and handed to the shader as five floats per plant, because the wave
// only depends on the plant's root: doing it in the vertex shader would pay
// six trig functions for every one of the ~1.7 M vertices on screen instead
// of for every one of the ~12 k plants. What stays in the shader is only the
// per-leaf flutter, and that is a couple of multiply-adds because plants.js
// bakes sin / cos of each leaf's phase into aWave.
//
//   aFlex  per vertex: 0 at the root, ~1 at the leaf tip -> roots stay planted
//   aWave  per vertex: sin / cos of that leaf's own phase
//   aWind  per instance, per frame: base wave, flutter cos / sin coefficients,
//          amplitude (without flex)
//   aWindZ per instance, per frame: the sideways sway term
// ---------------------------------------------------------------------------
export const WIND_GLSL = `
attribute float aFlex;    // per vertex: 0 at the root, ~1 at the leaf tip
attribute float aTone;    // per vertex: 0 at the base, 1 at the tip (colour only)
attribute float aPart;    // per vertex: 0 foliage, 1 rice head
attribute vec2  aWave;    // per vertex: sin, cos of the leaf's own phase
attribute vec4  aWind;    // per instance, per frame
attribute float aWindZ;   // per instance, per frame
attribute vec3 aTint;     // per instance: the plant's own colour

vec3 gWindOffset;
vec3 gWindTilt;

vec3 verdantWind( float flex ) {
  // the four wave trains have already been summed on the CPU into aWind.xyz,
  // where aWind.y / aWind.z carry sin and cos of the frame part of the small
  // local flutter and aWave carries cos / sin of the per-leaf part
  float wave = aWind.x + aWind.y * aWave.y + aWind.z * aWave.x;
  float amp = aWind.w * flex;

  vec3 dir = normalize( vec3( 1.0, 0.0, 0.26 ) );
  vec3 off = dir * ( wave * amp );

  // tips arc over rather than slide sideways: the vertical term is tied to how
  // far the tip has travelled, so a bent stem reads as a bend, not a shift
  off.y += amp * ( 0.09 * min( wave, 0.0 ) - 0.40 * max( wave, 0.0 ) );
  off.z += amp * 0.16 * aWindZ;

  gWindTilt = dir * ( wave * flex * 0.42 );
  return off;
}
`;


// Runs first in the vertex shader. three transforms normals before positions,
// so the wind is evaluated once here and reused by the normal and position
// patches below.
export const WIND_CALC = `
{
  gWindOffset = verdantWind( aFlex );
}
`;

// ---------------------------------------------------------------------------
// The same wave train, on the CPU.
//
// Every term of the wave depends only on the plant's root, the plant's seed
// and the clock - never on which vertex of the plant is being shaded. The old
// vertex shader paid six trig calls for each of the ~1.7 M vertices on screen;
// this pays six per frame and then two multiply-adds per plant, because
//
//   sin( t * f + phase ) = sin( t * f ) * cos( phase ) + cos( t * f ) * sin( phase )
//
// and the phase is static, so its sine and cosine are baked in once per plant
// by prepareWind. The per-leaf flutter is factored the same way: plants.js
// bakes sin / cos of each leaf's phase into aWave, so the shader only has to
// combine the frame part (aWind.y / aWind.z) with that.
// ---------------------------------------------------------------------------
const W_TAU = 6.2831853071795866;

export function prepareWind( mesh ) {
  const count = mesh.count;
  const seed = mesh.geometry.attributes.aSeed.array;
  const m = mesh.instanceMatrix.array;
  const sn = [];
  const cs = [];
  for ( let k = 0; k < 6; k++ ) {
    sn.push( new Float32Array( count ) );
    cs.push( new Float32Array( count ) );
  }
  for ( let i = 0; i < count; i++ ) {
    const o = i * 16;
    const bx = m[ o + 12 ];
    const bz = m[ o + 14 ];
    const sd = seed[ i ];
    // the six static phase offsets the wave train uses
    const p0 = ( bx * 0.072 + bz * 0.021 ) * W_TAU + sd * 0.83;
    const p1 = ( bx * 0.027 - bz * 0.039 ) * W_TAU + sd * 1.71 + 2.0;
    const p2 = ( bx * 0.185 + bz * 0.128 ) * W_TAU + sd * 3.29;
    const p3 = sd * 11.0 + bz * 0.55;
    const p4 = sd * 5.0 + bx * 0.05;
    const p5 = bx * 0.0104 + bz * 0.0061;
    sn[ 0 ][ i ] = Math.sin( p0 );
    cs[ 0 ][ i ] = Math.cos( p0 );
    sn[ 1 ][ i ] = Math.sin( p1 );
    cs[ 1 ][ i ] = Math.cos( p1 );
    sn[ 2 ][ i ] = Math.sin( p2 );
    cs[ 2 ][ i ] = Math.cos( p2 );
    sn[ 3 ][ i ] = Math.sin( p3 );
    cs[ 3 ][ i ] = Math.cos( p3 );
    sn[ 4 ][ i ] = Math.sin( p4 );
    cs[ 4 ][ i ] = Math.cos( p4 );
    sn[ 5 ][ i ] = Math.sin( p5 );
    cs[ 5 ][ i ] = Math.cos( p5 );
  }
  mesh.userData.windPh = { sn, cs };
}

export function updateWind( tiers, uTime, uWind, uWindSpeed, uGust ) {
  const t = uTime * uWindSpeed;
  const s = [
    Math.sin( t * 0.86 ), Math.sin( t * 0.47 ), Math.sin( t * 1.53 ),
    Math.sin( t * 2.87 ), Math.sin( t * 0.61 ), Math.sin( t * 0.17 ),
  ];
  const c = [
    Math.cos( t * 0.86 ), Math.cos( t * 0.47 ), Math.cos( t * 1.53 ),
    Math.cos( t * 2.87 ), Math.cos( t * 0.61 ), Math.cos( t * 0.17 ),
  ];
  const kw = 0.040 + 0.115 * uWind;
  const gu = 0.11 * uGust;
  for ( const mesh of tiers ) {
    const ph = mesh.userData.windPh;
    if ( !ph ) continue;
    const sn = ph.sn;
    const cs = ph.cs;
    const wind = mesh.geometry.attributes.aWind;
    const sway = mesh.geometry.attributes.aWindZ;
    const w = wind.array;
    const z = sway.array;
    const m = mesh.instanceMatrix.array;
    const count = mesh.count;
    for ( let i = 0; i < count; i++ ) {
      const o = i * 16;
      // the plant's own height, which is what the instance matrix carries in
      // its up column - a cut plant has that column shrunk to a stubble, so
      // the amplitude follows the cut rather than staying full size
      const ux = m[ o + 1 ], uy = m[ o + 5 ], uz = m[ o + 9 ];
      const scale = Math.sqrt( ux * ux + uy * uy + uz * uz );
      const w1 = s[ 0 ] * cs[ 0 ][ i ] + c[ 0 ] * sn[ 0 ][ i ];
      const w2 = s[ 1 ] * cs[ 1 ][ i ] + c[ 1 ] * sn[ 1 ][ i ];
      const w3 = s[ 2 ] * cs[ 2 ][ i ] + c[ 2 ] * sn[ 2 ][ i ];
      const gust = s[ 5 ] * cs[ 5 ][ i ] + c[ 5 ] * sn[ 5 ][ i ];
      // sin / cos of the frame part plus the plant part of the small flutter;
      // the leaf part is folded in in the shader by aWave
      const sinU = s[ 3 ] * cs[ 3 ][ i ] + c[ 3 ] * sn[ 3 ][ i ];
      const cosU = c[ 3 ] * cs[ 3 ][ i ] - s[ 3 ] * sn[ 3 ][ i ];
      const k = i * 4;
      w[ k ] = 0.57 * w1 + 0.23 * w2 + 0.12 * w3;
      w[ k + 1 ] = gu * sinU; // multiplies cos( leaf phase )
      w[ k + 2 ] = gu * cosU; // multiplies sin( leaf phase )
      w[ k + 3 ] = kw * ( 0.70 + 0.62 * gust ) * scale;
      z[ i ] = s[ 4 ] * cs[ 4 ][ i ] + c[ 4 ] * sn[ 4 ][ i ];
    }
    wind.needsUpdate = true;
    sway.needsUpdate = true;
  }
}

// A deliberately weak shear on the normal keeps shading honest while a leaf
// bends, without letting the light flip frame to frame. gWindTilt is a world
// space direction, so it is carried into view space with viewMatrix before it
// is added to the already-view-space normal.
export const NORMAL_TILT = `
transformedNormal = normalize( transformedNormal + 0.55 * ( viewMatrix * vec4( gWindTilt, 0.0 ) ).xyz );
`;

// Custom projection. The wind offset is added in WORLD space, after the
// instance matrix, so every plant bends downwind whatever way it faces.
export const PROJECT_WIND = `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelMatrix * mvPosition;
mvPosition.xyz += gWindOffset;
mvPosition = viewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

// ---------------------------------------------------------------------------
// The cut. A plant the blade has taken is shrunk toward the ground by its own
// instance matrix, which is honest for the culm and the leaves but not for the
// rice: a shrunken plant would still wear a shrunken ear, and a stubble with a
// head on it reads as a seedling rather than as what a reaping leaves behind.
//
// aPart is 1 on exactly the panicle - the rachis, the kernels and the awns -
// and 0 on the culm and the leaves, and every ribbon is one or the other end to
// end, so no triangle straddles the fold. The cut bit of aFlags is 2 per
// instance, written by cutPlant - the plant already asks the shader for
// every attribute slot the field's GL context allows, so the outline and the
// cut share one instanced float rather than taking two: a 14th declaration
// makes the program fail to link and the whole stand stops drawing. Folding
// every head vertex onto one point gives every triangle of the head zero area,
// so the rasteriser never produces a fragment for it: no
// extra geometry, no second mesh, no draw call, and the severed part the page
// throws into the air is a separate object that keeps its ears.
// ---------------------------------------------------------------------------
export const CUT_HIDE = `
if ( aFlags > 1.5 && aPart > 0.5 ) {
  transformed = vec3( 0.0, 1.0, 0.0 ); // the culm tip: the head collapses onto it
}
`;

// Per-vertex colour ramp: cool and dark at the base, warmer and brighter at
// the tip. The ears are ripe gold rather than the olive the plant's own green
// tint would leave them in, so aPart also fades that tint out at the head.
// vShade fakes cavity darkening near the roots of a clump.
export const TINT_CALC = `
vec3 straw = vec3( 1.34, 1.04, 0.30 );
vec3 foliage = mix( vec3( 0.80, 1.00, 0.82 ), straw, aPart * 0.94 );
vec3 earTint = mix( aTint, vec3( 0.94, 0.90, 0.82 ), aPart * 0.82 );
vTint = earTint * foliage * mix( vec3( 0.58, 0.64, 0.74 ), vec3( 1.10, 1.05, 0.95 ), aTone );
vShade = mix( 0.72, 1.0, clamp( aTone * 1.15, 0.0, 1.0 ) );
`;

export const WIND_FRAGMENT_TAIL = `
diffuseColor.rgb *= vTint * vShade;
`;

// ---------------------------------------------------------------------------
// Hover highlight. The pointer picks one plant and that plant's leaf edges
// light up. aEdge is 0 on one side of a ribbon and 1 on the other, so the
// interpolated value is the across-leaf coordinate and the outer band is the
// leaf outline. uHiWidth is the share of a half-leaf that band covers, and it
// is deliberately generous: the picked plant has to read at a glance against
// a moving sea of green, not be hunted for. The band's inner edge is a short
// step rather than a long gradient, so a wide band still looks like an edge
// instead of a wash over the whole leaf. The outline bit of aFlags is 0 or 1
// per instance and is
// rewritten on the CPU when the pointer moves, so the highlight rides along
// with the wind for free - same vertex shader, same bend, no second pass over
// the field.
//
// The patch runs after tone mapping and colour space conversion, so uHiColor
// is a display-space addend rather than a scene colour: it brightens the
// finished pixel, which keeps the outline legible in shade and at dusk.
// ---------------------------------------------------------------------------
export const HI_VERTEX = `
vEdge = aEdge;
vHi = mod( aFlags, 2.0 );   // the outline bit; the cut bit rides the same float
`;

export const HI_FRAGMENT = `
// vHi is flat-shaded per instance (it comes from an instanced attribute that
// is exactly 0 or 1), so this test is uniform across every triangle of a plant
// and the whole block is skipped rather than multiplied by zero for the
// twelve thousand plants nobody is pointing at.
if ( vHi > 0.0 ) {
  float across = clamp( abs( vEdge * 2.0 - 1.0 ), 0.0, 1.0 ); // 0 leaf centre, 1 leaf edge
  float inner = 1.0 - uHiWidth; // where the band starts, measured inwards from the edge
  // the ramp is capped well before the edge so a wide band is solid over most
  // of its width; min() keeps the old soft-to-the-edge look if uHiWidth is small
  float rim = smoothstep( inner, min( inner + 0.35, 1.0 ), across ) * vHi;
  gl_FragColor.rgb += uHiColor * rim;
}
`;

// ---------------------------------------------------------------------------
// Ground: procedural paddy floor - wet mud, trampled ridges, faint sheen that
// answers to the same wind as the rice.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// The paddy grid. These constants are the ones js/app.js builds the floor
// geometry from, so the painted bunds land exactly on the modelled ones:
// a plot is a cell of a warped 5.6 m lattice, its level is a function of the
// cell index, and the bund is the band that straddles the cell border.
// ---------------------------------------------------------------------------
export const PADDY_CELL = 5.6;

export const PADDY_PARS = `
uniform float uTime;
uniform float uWind;
uniform float uWindSpeed;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyMid;
uniform vec3 uFarNear;
uniform vec3 uFarFar;
uniform vec3 uFogColor;

float paddyBendX( float z ) {
  return sin( z * 0.045 + 1.3 ) * 0.9 + sin( z * 0.011 - 0.7 ) * 1.7;
}
float paddyBendZ( float x ) {
  return sin( x * 0.038 - 2.1 ) * 1.1 + sin( x * 0.009 + 0.4 ) * 1.5;
}
float paddyLevel( vec2 cell ) {
  return 0.030 * ( 0.5 + 0.5 * sin( cell.x * 1.7 + sin( cell.y * 2.3 ) * 1.1 ) );
}
float paddyMud( vec2 p ) {
  return sin( p.x * 0.31 ) * 0.34 + sin( p.y * 0.37 ) * 0.30
    + sin( p.x * 0.71 + p.y * 0.53 ) * 0.22 + sin( p.x * 1.3 - p.y * 0.9 ) * 0.14;
}
float paddyKind( vec2 cell ) {
  return 0.5 + 0.5 * sin( cell.x * 2.11 + sin( cell.y * 1.73 ) * 2.2 );
}
`;

export const GROUND_PARS = PADDY_PARS + `
varying vec3 vGroundPos;
`;

export const GROUND_VERTEX = `
vGroundPos = worldPos;
`;

export const GROUND_FRAGMENT = `
{
  vec3 p = vGroundPos;
  float t = uTime * uWindSpeed;

  // --- the plot grid, shared with the floor geometry ---------------------
  vec2 g = vec2( p.x + paddyBendX( p.z ), p.z + paddyBendZ( p.x ) );
  vec2 cell = floor( g / 5.6 );
  vec2 f = fract( g / 5.6 );
  float edge = min( min( f.x, 1.0 - f.x ), min( f.y, 1.0 - f.y ) ) * 5.6;

  // each plot sits at its own level and holds its own water: the mud under it
  // varies, the surface does not, so the flooded part of a plot is wherever
  // the mud sits below the water line
  float level = paddyLevel( cell );
  float mudTop = level - 0.030 + 0.055 * ( 0.5 + 0.5 * paddyMud( p.xz ) );
  float depth = level + 0.045 - mudTop;
  float flooded = smoothstep( 0.0, 0.014, depth );

  // --- the bund: an earthen ridge with grass on the crest ----------------
  // the band is kept just wider than the modelled bund's base (0.34 m), so the
  // painted bund sits on the modelled one instead of smearing out into the plot
  float bund = 1.0 - smoothstep( 0.26, 0.44, edge );
  float crest = 1.0 - smoothstep( 0.0, 0.16, edge );
  float blade = 0.5 + 0.5 * sin( p.x * 41.0 + p.z * 7.0 + sin( p.z * 0.9 ) * 9.0 );
  vec3 bundCol = mix( vec3( 0.098, 0.086, 0.062 ), vec3( 0.132, 0.168, 0.086 ), crest );
  bundCol *= 0.80 + 0.34 * blade;
  // a wet dark seam where the bund meets the water
  bundCol = mix( bundCol, bundCol * 0.55, smoothstep( 0.34, 0.16, edge ) * flooded );

  // --- the mud under the water -------------------------------------------
  vec3 mudCol = mix( vec3( 0.086, 0.098, 0.074 ), vec3( 0.176, 0.162, 0.126 ),
                     smoothstep( 0.012, -0.026, depth ) );
  mudCol *= 0.80 + 0.38 * ( 0.5 + 0.5 * paddyMud( p.xz * 3.7 ) );

  // --- the water film: the sky, mirrored and rippled ---------------------
  vec3 toEye = normalize( cameraPosition - p );
  vec3 refl = vec3( -toEye.x, max( toEye.y, 0.02 ), -toEye.z );
  float ripple = sin( ( p.x + p.z * 0.22 ) * 9.0 + t * 1.3 + sin( p.z * 0.7 ) * 3.0 )
    + 0.6 * sin( ( p.x * 0.4 - p.z * 0.9 ) * 14.0 - t * 2.1 );
  refl.xz += ripple * 0.030 * uWind;
  float ry = clamp( refl.y, 0.0, 1.0 );
  vec3 skyRef = mix( uSkyHorizon, uSkyMid, pow( ry, 0.55 ) );
  skyRef = mix( skyRef, uSunColor * 1.12, pow( max( dot( normalize( refl ),
      normalize( uSunDir ) ), 0.0 ), 6.0 ) * 0.42 );
  float fres = 0.16 + 0.84 * pow( 1.0 - clamp( toEye.y, 0.0, 1.0 ), 3.4 );
  vec3 waterCol = mix( mudCol * 0.82, skyRef, fres * 0.66 );
  waterCol += vec3( 0.030, 0.034, 0.026 ) * max( ripple, 0.0 ) * 0.5 * uWind;
  // the rows of rice throw a soft shade into the shallow water
  waterCol *= 1.0 - 0.16 * ( 0.5 + 0.5 * sin( p.x * 19.0 + sin( p.z * 0.6 ) * 5.0 ) );
  // duckweed: a few bits of green resting on the surface
  vec2 wd = floor( p.xz * 13.0 );
  float weed = step( 0.955, fract( sin( dot( wd, vec2( 7.31, 31.73 ) ) ) * 4137.31 ) );
  waterCol = mix( waterCol, vec3( 0.104, 0.166, 0.070 ), weed * flooded * 0.85 );

  vec3 col = mix( waterCol, bundCol, bund );

  // --- the seam: past 13 m the distant field takes over, so hand the floor
  // over as the same patchwork the distant field paints ------------------
  float dist = length( p.xz - cameraPosition.xz );
  float kind = paddyKind( cell );
  vec3 plotCol = mix( vec3( 0.150, 0.170, 0.104 ), vec3( 0.205, 0.196, 0.120 ), kind );
  plotCol = mix( plotCol, uFarNear, 0.55 );
  col = mix( col, plotCol, smoothstep( 10.5, 13.0, dist ) * 0.92 );

  diffuseColor.rgb *= col * 2.6;
}
`;

// ---------------------------------------------------------------------------
// Distant field: the plain beyond the instanced rice. One plane, coloured and
// animated by the same wave train, so the sea keeps rolling to the tree line.
// ---------------------------------------------------------------------------
export const FAR_FIELD_PARS = PADDY_PARS + `
varying vec3 vFarPos;
`;

export const FAR_FIELD_VERTEX = `
vFarPos = worldPos;
`;

export const FAR_FIELD_FRAGMENT = `
{
  vec3 p = vFarPos;
  float t = uTime * uWindSpeed;
  float dist = length( p.xz - cameraPosition.xz );

  // the same plot lattice the floor under the rice is built from, so the
  // distant patchwork lines up with the paddies the camera stands in
  vec2 g = vec2( p.x + paddyBendX( p.z ), p.z + paddyBendZ( p.x ) );
  vec2 cell = floor( g / 5.6 );
  vec2 f = fract( g / 5.6 );
  float edge = min( min( f.x, 1.0 - f.x ), min( f.y, 1.0 - f.y ) ) * 5.6;
  float kind = paddyKind( cell );
  float bund = 1.0 - smoothstep( 0.16, 0.44, edge );

  // the wave train the rice itself rides, but only over the plots that hold
  // a crop: a ploughed or flooded plot stays flat water
  float w1 = sin( t * 0.86 + ( p.x * 0.072 + p.z * 0.021 ) * 6.283185 );
  float w2 = sin( t * 1.53 + ( p.x * 0.185 + p.z * 0.128 ) * 6.283185 );
  float wave = w1 * 0.72 + w2 * 0.34;
  float crop = smoothstep( 0.16, 0.40, kind );

  // a plot is green rice, ripe gold, or open water with the sky on it
  vec3 green = vec3( 0.150, 0.196, 0.104 );
  vec3 ripe = vec3( 0.236, 0.212, 0.126 );
  vec3 water = mix( uSkyHorizon, uSkyMid, 0.55 ) * 0.62;
  vec3 col = mix( water, mix( green, ripe, smoothstep( 0.52, 0.86, kind ) ), crop );
  col *= 0.84 + 0.30 * ( 0.5 + 0.5 * wave ) * ( 0.30 + 0.70 * uWind );
  col = mix( col, vec3( 0.128, 0.150, 0.086 ), bund );

  // aerial haze: the patchwork loses its contrast and picks up the fog
  float d = clamp( ( dist - 16.0 ) / 118.0, 0.0, 1.0 );
  vec3 near = mix( col, uFarNear, 0.35 );
  col = mix( near, uFarFar, d );
  col = mix( col, uFogColor, d * d * 0.45 );
  diffuseColor.rgb = col;
}
`;


// ---------------------------------------------------------------------------
// Sky dome: soft gray-blue gradient, layered cloud, warm horizon seam.
// ---------------------------------------------------------------------------
export const SKY_PARS = `
uniform vec3 uSkyTop;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uCloud;
uniform float uTime;
varying vec3 vSkyDir;

float skyHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
float skyNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 q = fract( p );
  float a = skyHash( i );
  float b = skyHash( i + vec2( 1.0, 0.0 ) );
  float c = skyHash( i + vec2( 0.0, 1.0 ) );
  float d = skyHash( i + vec2( 1.0, 1.0 ) );
  vec2 u = q * q * ( 3.0 - 2.0 * q );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
float skyFbm( vec2 p ) {
  float v = 0.0;
  float amp = 0.52;
  for ( int i = 0; i < 4; i ++ ) {
    v += amp * skyNoise( p );
    p = p * 2.07 + vec2( 13.1, -7.7 );
    amp *= 0.5;
  }
  return v;
}
`;

export const SKY_VERTEX = `
vSkyDir = normalize( ( modelMatrix * vec4( position, 1.0 ) ).xyz - cameraPosition );
`;

export const SKY_FRAGMENT = `
{
  vec3 dir = normalize( vSkyDir );
  float up = clamp( dir.y, -1.0, 1.0 );
  vec3 sun = normalize( uSunDir );
  float az = dot( dir, sun );
  float warm = pow( max( az, 0.0 ), 2.2 );
  float sunUp = clamp( sun.y, -0.25, 1.0 );

  // the ramp sits lower and paler when the sun is low, higher and deeper when
  // it is overhead, which is what makes the hour read as an hour
  float lift = 0.30 + 0.42 * smoothstep( -0.1, 0.8, sunUp );
  float grad = pow( max( up, 0.0 ), lift );
  vec3 col = mix( uSkyHorizon, uSkyMid, smoothstep( 0.0, 0.32, grad ) );
  col = mix( col, uSkyTop, smoothstep( 0.28, 0.98, grad ) );

  // haze along the horizon in the fog's own colour, so the hills and the tree
  // line dissolve into the sky instead of cutting a hard line against it
  float haze = smoothstep( 0.34, 0.01, up ) * smoothstep( -0.10, 0.03, up );
  col = mix( col, uFogColor, haze * 0.80 );

  // the sun-side horizon glows, and the glow is strongest on a low sun
  float glow = warm * smoothstep( 0.30, 0.0, up ) * ( 0.35 + 0.65 * ( 1.0 - smoothstep( 0.0, 0.6, sunUp ) ) );
  col = mix( col, uSunColor * 1.06, glow * 0.62 );

  // cloud: four octaves of value noise projected onto the dome, drifting
  float h = max( up, 0.03 );
  vec2 q = dir.xz / ( h + 0.16 ) * 0.42 + vec2( uTime * 0.006, uTime * 0.004 );
  float fbm = skyFbm( q );
  float cover = smoothstep( 0.60 - 0.26 * uCloud, 0.88 - 0.10 * uCloud, fbm );
  float thick = smoothstep( 0.58, 0.96, fbm );
  cover *= smoothstep( 0.015, 0.22, up ) * smoothstep( 0.95, 0.46, up );

  // a cloud body is brighter at the top and greyer at its base, where it picks
  // up the field bounce rather than the sky
  vec3 cloudCol = mix( uFogColor * 0.92, vec3( 1.05, 1.04, 1.02 ), 0.42 + 0.58 * thick );
  cloudCol = mix( cloudCol, uSkyMid * 1.10, smoothstep( 0.30, 0.75, up ) * 0.45 );
  // the sun catches the cloud's rim on the side it sits
  cloudCol += uSunColor * pow( max( az, 0.0 ), 5.0 ) * ( 0.30 + 0.70 * thick );
  col = mix( col, cloudCol, cover );

  // the sun itself: a disc, a tight bloom and a wide atmospheric halo
  float disc = smoothstep( 0.99958, 0.99982, az );
  col = mix( col, vec3( 1.25, 1.16, 1.02 ) * ( 1.0 + uSunColor ), disc );
  col += uSunColor * pow( max( az, 0.0 ), 120.0 ) * 0.85;
  col += uSunColor * pow( max( az, 0.0 ), 9.0 ) * 0.14 * smoothstep( -0.02, 0.30, up );
  col += uSunColor * pow( max( az, 0.0 ), 2.2 ) * 0.05;

  // below the horizon the dome stops being sky and becomes field haze
  col = mix( col, uFogColor * 0.92, smoothstep( 0.0, -0.20, up ) );

  gl_FragColor = vec4( col, 1.0 );
}
`;

// ---------------------------------------------------------------------------
// Material patchers. Each keeps three's lighting, fog and tone mapping and
// only swaps the pieces we care about, so this stays a real lit 3D scene.
// ---------------------------------------------------------------------------

// Rice: Lambert + wind + per-instance tint.
export function makeWindMaterial(uniforms, opts) {
  const mat = new THREE.MeshLambertMaterial({
    color: opts.color,
    side: opts.side,
    fog: true,
  });
  mat.onBeforeCompile = ( shader ) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed;
    shader.uniforms.uGust = uniforms.uGust;
    shader.uniforms.uHiColor = uniforms.uHiColor;
    shader.uniforms.uHiWidth = uniforms.uHiWidth;

    shader.vertexShader =
      WIND_GLSL +
      "\nvarying vec3 vTint;\nvarying float vShade;\nvarying float vEdge;\nvarying float vHi;\nattribute float aEdge;\nattribute float aFlags;\n" +
      shader.vertexShader;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <begin_vertex>",
        // the fold happens here, before the custom projection below reads
        // `transformed`, so a cut plant's head is already gone when the wind
        // offset and the instance matrix are applied to it
        "#include <begin_vertex>\n" + CUT_HIDE + HI_VERTEX
      )
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\n" + WIND_CALC
      )
      .replace(
        "#include <defaultnormal_vertex>",
        "#include <defaultnormal_vertex>\n" + NORMAL_TILT
      )
      .replace(
        "#include <color_vertex>",
        TINT_CALC + "\n#include <color_vertex>"
      )
      .replace( "#include <project_vertex>", PROJECT_WIND );

    shader.fragmentShader =
      "varying vec3 vTint;\nvarying float vShade;\nvarying float vEdge;\nvarying float vHi;\nuniform vec3 uHiColor;\nuniform float uHiWidth;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      WIND_FRAGMENT_TAIL
    );
    // added after lighting and after tone mapping, so the highlight reads as a
    // bright edge on the finished pixel rather than as extra scene light
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <fog_fragment>",
      HI_FRAGMENT + "\n#include <fog_fragment>"
    );
  };
  mat.userData.wind = true;
  return mat;
}

// Ground: Lambert + procedural paddy floor. `env` hands the floor the same
// live sky/fog uniform objects the dome and the distant field read, so the
// water on the floor reflects whatever hour the rig is easing through.
export function makeGroundMaterial(uniforms, color, env) {
  const mat = new THREE.MeshLambertMaterial({ color, fog: true });
  mat.onBeforeCompile = ( shader ) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed;
    shader.uniforms.uSunDir = env.sunDir;
    shader.uniforms.uSunColor = env.sunColor;
    shader.uniforms.uSkyHorizon = env.skyHorizon;
    shader.uniforms.uSkyMid = env.skyMid;
    shader.uniforms.uFarNear = env.farNear;
    shader.uniforms.uFarFar = env.farFar;
    shader.uniforms.uFogColor = env.fogColor;
    shader.vertexShader = "varying vec3 vGroundPos;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n vGroundPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;"
    );
    shader.fragmentShader =
      PADDY_PARS + "\nvarying vec3 vGroundPos;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      GROUND_FRAGMENT
    );
  };
  return mat;
}

// Distant field: unlit but fogged plane, coloured as the same patchwork of
// plots the floor under the rice is built from.
export function makeFarFieldMaterial(uniforms, opts) {
  const mat = new THREE.MeshBasicMaterial({ color: opts.color, fog: true });
  mat.onBeforeCompile = ( shader ) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed;
    shader.uniforms.uSunDir = opts.env.sunDir;
    shader.uniforms.uSunColor = opts.env.sunColor;
    shader.uniforms.uSkyHorizon = opts.env.skyHorizon;
    shader.uniforms.uSkyMid = opts.env.skyMid;
    shader.uniforms.uFarNear = opts.near;
    shader.uniforms.uFarFar = opts.far;
    shader.uniforms.uFogColor = opts.env.fogColor;
    shader.vertexShader = "varying vec3 vFarPos;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n vFarPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;"
    );
    shader.fragmentShader =
      PADDY_PARS + "\nvarying vec3 vFarPos;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      FAR_FIELD_FRAGMENT
    );
  };
  return mat;
}

// Sky dome: raw shader, no fog, drawn first.
export function makeSkyMaterial(params) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSkyTop: params.uSkyTop,
      uSkyMid: params.uSkyMid,
      uSkyHorizon: params.uSkyHorizon,
      uSunDir: params.uSunDir,
      uSunColor: params.uSunColor,
      uFogColor: params.uFogColor,
      uCloud: params.uCloud,
      uTime: params.uTime,
    },
    vertexShader:
      "varying vec3 vSkyDir;\nvoid main() {\n" + SKY_VERTEX + "\n gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n}",
    fragmentShader:
      SKY_PARS + "\nvoid main() {\n" + SKY_FRAGMENT + "\n}",
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  return mat;
}


