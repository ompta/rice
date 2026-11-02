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
// instead of a wash over the whole leaf. aHi is 0 or 1 per instance and is
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
vHi = aHi;
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
export const GROUND_PARS = `
uniform float uTime;
uniform float uWind;
uniform float uWindSpeed;
varying vec3 vGroundPos;
`;

export const GROUND_VERTEX = `
vGroundPos = worldPos;
`;

export const GROUND_FRAGMENT = `
{
  vec3 p = vGroundPos;
  float row = fract( ( p.x + p.z * 0.12 ) * 3.1 );
  float ridge = smoothstep( 0.05, 0.28, row ) * smoothstep( 0.95, 0.68, row );
  float n = sin( p.x * 1.9 ) * sin( p.z * 2.3 ) + sin( p.x * 0.41 + 1.7 ) * sin( p.z * 0.53 - 0.9 );
  float mud = 0.34 + 0.10 * n;
  vec3 wet = vec3( 0.150, 0.176, 0.132 );
  vec3 dry = vec3( 0.245, 0.268, 0.196 );
  vec3 col = mix( wet, dry, clamp( mud, 0.0, 1.0 ) );
  col = mix( col, col * 1.22, ridge * 0.5 );
  float sheen = 0.5 + 0.5 * sin( uTime * uWindSpeed * 0.86 + p.x * 0.45 + p.z * 0.13 );
  col += vec3( 0.012, 0.020, 0.010 ) * sheen * uWind;
  diffuseColor.rgb *= col * 3.2;
}
`;

// ---------------------------------------------------------------------------
// Distant field: the plain beyond the instanced rice. One plane, coloured and
// animated by the same wave train, so the sea keeps rolling to the tree line.
// ---------------------------------------------------------------------------
export const FAR_FIELD_PARS = `
uniform float uTime;
uniform float uWind;
uniform float uWindSpeed;
uniform vec3 uFarNear;
uniform vec3 uFarFar;
varying vec3 vFarPos;
`;

export const FAR_FIELD_VERTEX = `
vFarPos = worldPos;
`;

export const FAR_FIELD_FRAGMENT = `
{
  vec3 p = vFarPos;
  float d = clamp( ( length( p.xz - cameraPosition.xz ) - 40.0 ) / 110.0, 0.0, 1.0 );
  float t = uTime * uWindSpeed;
  float w1 = sin( t * 0.86 + ( p.x * 0.072 + p.z * 0.021 ) * 6.283185 );
  float w2 = sin( t * 1.53 + ( p.x * 0.185 + p.z * 0.128 ) * 6.283185 );
  float wave = w1 * 0.72 + w2 * 0.34;
  float streak = 0.5 + 0.5 * sin( p.x * 11.0 + p.z * 2.2 + sin( p.z * 0.22 ) * 4.0 );
  vec3 col = mix( uFarNear, uFarFar, d );
  col *= 0.86 + 0.20 * ( 0.5 + 0.5 * wave ) * ( 0.35 + 0.65 * uWind );
  col *= 0.90 + 0.16 * streak;
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
uniform float uCloud;
uniform float uTime;
varying vec3 vSkyDir;
`;

export const SKY_VERTEX = `
vSkyDir = normalize( ( modelMatrix * vec4( position, 1.0 ) ).xyz - cameraPosition );
`;

export const SKY_FRAGMENT = `
{
  vec3 dir = normalize( vSkyDir );
  float up = clamp( dir.y, -1.0, 1.0 );

  float grad = pow( max( up, 0.0 ), 0.52 );
  vec3 col = mix( uSkyHorizon, uSkyMid, smoothstep( 0.0, 0.34, grad ) );
  col = mix( col, uSkyTop, smoothstep( 0.30, 1.0, grad ) );

  // below the horizon the dome picks up field haze instead of sky
  col = mix( col, uSkyHorizon * 0.94, smoothstep( 0.0, -0.22, up ) );

  // layered cloud: three soft octaves projected onto the dome
  float h = max( up, 0.02 );
  vec2 q = dir.xz / ( h + 0.22 );
  float c1 = sin( q.x * 0.42 + uTime * 0.012 ) * sin( q.y * 0.37 - uTime * 0.009 );
  float c2 = sin( q.x * 1.05 - uTime * 0.02 ) * sin( q.y * 0.88 + uTime * 0.015 );
  float c3 = sin( q.x * 2.3 + 1.7 ) * sin( q.y * 1.9 - 0.6 );
  float cloud = c1 * 0.55 + c2 * 0.30 + c3 * 0.15;
  cloud = smoothstep( 0.05, 0.72, cloud * 0.5 + 0.5 );
  cloud *= smoothstep( 0.02, 0.30, up ) * smoothstep( 0.92, 0.42, up );
  vec3 cloudTint = mix( vec3( 1.04, 1.04, 1.05 ), uSunColor * 1.6, 0.35 );
  col = mix( col, col * cloudTint, cloud * uCloud );

  // sun bloom plus a soft warm halo, so the light direction is legible
  float sd = max( dot( dir, normalize( uSunDir ) ), 0.0 );
  col += uSunColor * pow( sd, 90.0 ) * 1.25;
  col += uSunColor * pow( sd, 7.0 ) * 0.16 * smoothstep( 0.0, 0.35, up );

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
      "\nvarying vec3 vTint;\nvarying float vShade;\nvarying float vEdge;\nvarying float vHi;\nattribute float aEdge;\nattribute float aHi;\n" +
      shader.vertexShader;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n" + HI_VERTEX
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

// Ground: Lambert + procedural paddy floor.
export function makeGroundMaterial(uniforms, color) {
  const mat = new THREE.MeshLambertMaterial({ color, fog: true });
  mat.onBeforeCompile = ( shader ) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed;
    shader.vertexShader = "varying vec3 vGroundPos;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n vGroundPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;"
    );
    shader.fragmentShader =
      "uniform float uTime;\nuniform float uWind;\nuniform float uWindSpeed;\nvarying vec3 vGroundPos;\n" +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      GROUND_FRAGMENT
    );
  };
  return mat;
}

// Distant field: unlit but fogged plane, coloured by the same wave train.
export function makeFarFieldMaterial(uniforms, opts) {
  const mat = new THREE.MeshBasicMaterial({ color: opts.color, fog: true });
  mat.onBeforeCompile = ( shader ) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed;
    shader.uniforms.uFarNear = opts.near;
    shader.uniforms.uFarFar = opts.far;
    shader.vertexShader = "varying vec3 vFarPos;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n vFarPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;"
    );
    shader.fragmentShader =
      "uniform float uTime;\nuniform float uWind;\nuniform float uWindSpeed;\nuniform vec3 uFarNear;\nuniform vec3 uFarFar;\nvarying vec3 vFarPos;\n" +
      shader.fragmentShader;
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


