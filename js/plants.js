// js/plants.js — procedural rice plants. No meshes are loaded: a plant is
// assembled from ribbons at runtime, so the page has zero asset dependencies.
//
// A plant is three things, and all three matter for the close-up read:
//   culm    the main stem - a curved, tapered spine (four ribbons near up)
//   leaves  slender ribbons that leave the stem, rise, then droop over
//   panicle the drooping rice head: kernels at its edge, each with an awn of
//           chaff past the tip, so the head hangs rather than bristles out
//
// `detail` can scale the ribbon counts down for a cheaper stand-in, but the
// page stopped asking for one: the field tiers are distance bands rather than
// levels of plant detail, and all three of them build "near", so every plant
// in the stand is this plant. The cheaper variants remain only as a knob.
//
// Per-vertex attributes the wind shader reads:
//   aFlex  0 at the root, larger toward the tip -> roots stay planted
//   aWave  sin / cos of the leaf's own flutter phase, precomputed here so the
//          shader never has to take a trig function of a per-vertex value
//   aTone  0 at the base, 1 at the tip          -> colour ramp
//   aPart  0 for foliage, 1 for the rice head   -> green to straw
//   aEdge  0 on one side of a ribbon, 1 on the other -> leaf outline (hover)
export function buildPlantGeometry(detail) {
  const pos = [];
  const nor = [];
  const flex = [];
  const wave = [];
  const tone = [];
  const part = [];
  const edge = [];
  const idx = [];
  let vcount = 0;

  const rnd = mulberry32( 0x5eed );

  // A ribbon following a curved spine: `path` is the spine, `halfFn` the half
  // width, `upFn` the face-normal hint. Two verts per spine point.
  function addRibbon( path, halfFn, upFn, metaFn ) {
    const n = path.length;
    const start = vcount;
    for ( let i = 0; i < n; i++ ) {
      const p = path[ i ];
      const q = path[ Math.min( i + 1, n - 1 ) ];
      let tx = q[0] - p[0], ty = q[1] - p[1], tz = q[2] - p[2];
      if ( i === n - 1 ) {
        const r = path[ Math.max( i - 1, 0 ) ];
        tx = p[0] - r[0]; ty = p[1] - r[1]; tz = p[2] - r[2];
      }
      const tl = Math.hypot( tx, ty, tz ) || 1;
      tx /= tl; ty /= tl; tz /= tl;

      const up = upFn( i, n );
      let ux = up[0], uy = up[1], uz = up[2];
      // side = tangent x up
      let sx = ty * uz - tz * uy;
      let sy = tz * ux - tx * uz;
      let sz = tx * uy - ty * ux;
      const sl = Math.hypot( sx, sy, sz );
      if ( sl < 1e-6 ) { sx = 1; sy = 0; sz = 0; } else { sx /= sl; sy /= sl; sz /= sl; }
      // face normal = side x tangent
      let nx = sy * tz - sz * ty;
      let ny = sz * tx - sx * tz;
      let nz = sx * ty - sy * tx;
      const nl = Math.hypot( nx, ny, nz ) || 1;
      nx /= nl; ny /= nl; nz /= nl;

      const hw = halfFn( i, n );
      const m = metaFn( i, n );
      for ( let s = -1; s <= 1; s += 2 ) {
        pos.push( p[0] + sx * hw * s, p[1] + sy * hw * s, p[2] + sz * hw * s );
        nor.push( nx, ny, nz );
        flex.push( m[0] );
        // the shader used to take sin(phase * 3.7) per vertex per frame; the
        // phase never changes, so its sine and cosine are baked in once here
        const pv = ( s < 0 ? 0.30 : 1.0 ) * m[1] * 3.7;
        wave.push( Math.sin( pv ), Math.cos( pv ) );
        tone.push( m[2] );
        part.push( m[3] );
        edge.push( s < 0 ? 0 : 1 ); // across the ribbon: 0 one side, 1 the other
      }
    }
    for ( let i = 0; i < n - 1; i++ ) {
      const a = start + i * 2;
      idx.push( a, a + 1, a + 3, a, a + 3, a + 2 );
    }
    vcount += n * 2;
  }

  const H = 1.0; // unit plant; the instance matrix sets the real height

  // ---- culm: a spine that leans and kinks, never a straight line
  const rings = detail === "near" ? 8 : detail === "mid" ? 5 : 4;
  const bendX = 0.055, bendZ = 0.024;
  const spine = [];
  for ( let i = 0; i < rings; i++ ) {
    const h = i / ( rings - 1 );
    const lean = h * h * ( 0.86 + 0.22 * Math.sin( h * 2.1 ) );
    spine.push( [ bendX * lean, h * H, bendZ * lean ] );
  }
  const upDirs = [ [ 1, 0, 0 ], [ 0, 0, 1 ], [ -1, 0, 0 ], [ 0, 0, -1 ] ];
  const stripDirs = detail === "near" ? upDirs : detail === "mid" ? [ upDirs[0], upDirs[1] ] : [ upDirs[0] ];
  for ( const up of stripDirs ) {
    addRibbon(
      spine,
      ( i, n ) => 0.0105 * ( 1 - 0.72 * ( i / ( n - 1 ) ) ) + 0.0012,
      () => up,
      ( i, n ) => {
        const h = i / ( n - 1 );
        return [ Math.pow( h, 1.45 ), 0.4 + h * 0.6, h * 0.9, 0 ];
      }
    );
  }

  // ---- leaves: they leave the stem, rise a little, then droop over
  // a fuller plant: seven leaves rather than six, so the skirt reads dense
  const leafCount = detail === "near" ? 7 : detail === "mid" ? 4 : 2;
  const leafRings = detail === "near" ? 7 : detail === "mid" ? 4 : 2;
  const leafW = detail === "near" ? 0.0135 : detail === "mid" ? 0.0125 : 0.017;
  for ( let li = 0; li < leafCount; li++ ) {
    const az = ( li / leafCount ) * Math.PI * 2 + 0.4 + rnd() * 0.55;
    const hs = 0.26 + ( li / leafCount ) * 0.5 + rnd() * 0.1;
    const L = ( detail === "far" ? 0.20 : 0.30 ) + rnd() * ( detail === "near" ? 0.22 : 0.14 );
    const curlSign = rnd() < 0.5 ? -1 : 1;
    const ph = li * 2.399 + rnd() * 1.4;
    const dx = Math.cos( az ), dz = Math.sin( az );
    const px = -dz, pz = dx;
    const attachX = bendX * hs * hs, attachZ = bendZ * hs * hs;
    const path = [];
    for ( let i = 0; i < leafRings; i++ ) {
      const t = i / ( leafRings - 1 );
      const reach = L * ( t - 0.12 * t * t );
      const rise = 0.40 * t - 0.92 * t * t * t + 0.10 * t * t;
      const curl = L * 0.14 * Math.sin( t * 2.4 ) * curlSign;
      path.push( [
        attachX + dx * reach + px * curl,
        hs * H + L * rise,
        attachZ + dz * reach + pz * curl,
      ] );
    }
    addRibbon(
      path,
      ( i, n ) => {
        const t = i / ( n - 1 );
        const prof = Math.pow( Math.max( Math.sin( Math.max( t, 0.02 ) * Math.PI ), 0.05 ), 0.5 );
        return leafW * ( 0.20 + 0.80 * prof );
      },
      ( i, n ) => {
        const t = i / ( n - 1 );
        // face up near the stem, edge-on toward the tip: leaves twist
        const k = t * 0.62;
        return [ px * k, 1 - k, pz * k ];
      },
      ( i, n ) => {
        const t = i / ( n - 1 );
        const h = Math.min( 1, path[ i ][1] / H );
        return [
          Math.pow( h, 1.15 ) * ( 0.72 + 0.62 * t ),
          ph + t * 1.9,
          0.30 + 0.70 * Math.max( h, t * 0.6 ),
          0,
        ];
      }
    );
  }

  // ---- panicle: the rice head droops over; grains hang off the rachis
  if ( detail !== "far" ) {
    const pRings = detail === "near" ? 7 : 5;
    // a long rachis: the head has to reach past the leaf tips so the ears sit
    // at the edge of the plant rather than inside the skirt of leaves
    const Lp = 0.30 + rnd() * 0.08;
    const az = rnd() * Math.PI * 2;
    const dx = Math.cos( az ), dz = Math.sin( az );
    const topX = bendX, topZ = bendZ;
    const ppath = [];
    for ( let i = 0; i < pRings; i++ ) {
      const t = i / ( pRings - 1 );
      const reach = Lp * ( t - 0.05 * t * t );
      const rise = 0.55 * t - 1.45 * t * t;
      ppath.push( [ topX + dx * reach, H + Lp * rise, topZ + dz * reach ] );
    }
    addRibbon(
      ppath,
      ( i, n ) => 0.0035 * ( 1 - 0.4 * ( i / ( n - 1 ) ) ) + 0.0008,
      () => [ 0, 1, 0 ],
      ( i, n ) => {
        const t = i / ( n - 1 );
        return [ 0.95 + 0.55 * t, 5.1 + t * 2.2, 0.86 + 0.14 * t, 1 ];
      }
    );

    // the ears: kernels down the outer rachis, each one angled out and down so
    // the head hangs rather than bristling straight out. Two crossed quads give
    // a kernel a body from any angle, and the near tier adds an awn - a thin
    // bristle of chaff past the tip - which is what makes the cluster read as
    // an ear at a distance instead of as a string of beads.
    const grains = detail === "near" ? 13 : 5;
    const awns = detail === "near" ? 7 : 0;
    for ( let gi = 0; gi < grains; gi++ ) {
      const t = 0.28 + ( gi / grains ) * 0.72;
      const seg = Math.min( pRings - 2, Math.floor( t * ( pRings - 1 ) ) );
      const a = ppath[ seg ], b = ppath[ seg + 1 ];
      const k = t * ( pRings - 1 ) - seg;
      const cx = a[0] + ( b[0] - a[0] ) * k;
      const cy = a[1] + ( b[1] - a[1] ) * k;
      const cz = a[2] + ( b[2] - a[2] ) * k;
      const side = gi % 2 === 0 ? 1 : -1;
      const off = 0.017 * side;
      const gx = cx + dx * off * 0.5 + 0.004 * side;
      const gz = cz + dz * off * 0.5;
      const gy = cy - 0.010 - 0.012 * ( t - 0.5 );
      // kernels vary a little down the head: length, and ripeness, so the
      // shaded inner grains sit greener under the sunlit outer ones
      const gl = 0.024 + ( gi % 3 ) * 0.004;
      const gw = 0.0075;
      const hang = 0.016 + 0.012 * t;
      const gpath = [
        [ gx - dx * gl * 0.30, gy + 0.003, gz - dz * gl * 0.30 ],
        [ gx + dx * gl * 0.70, gy - hang * 0.6, gz + dz * gl * 0.70 ],
      ];
      // the kernel tapers to its tip: wide where it joins the head, narrow at
      // the far end, so a quad reads as a grain rather than as a bead
      const kernel = ( i, n ) => gw * ( i === 0 ? 0.62 : 0.12 );
      const grain = () => [ 1.5, 6.3 + gi * 0.7, 0.90 + 0.10 * ( gi / grains ), 1 ];
      addRibbon( gpath, kernel, () => [ 0, 1, 0 ], grain );
      if ( detail === "near" ) {
        // a crossing quad gives the kernel body when seen from any angle
        addRibbon( gpath, kernel, () => [ -dz, 0, dx ], grain );
      }
      if ( gi < awns ) {
        // the awn: chaff past the kernel tip, on the same out-and-down line
        const tx = gpath[ 1 ][0], ty = gpath[ 1 ][1], tz = gpath[ 1 ][2];
        addRibbon(
          [
            [ tx, ty, tz ],
            [ tx + dx * 0.020, ty - 0.020, tz + dz * 0.020 ],
          ],
          ( i, n ) => 0.0011 * ( i === 0 ? 1 : 0.25 ),
          () => [ 0, 1, 0 ],
          grain
        );
      }
    }
  }

  return {
    position: new Float32Array( pos ),
    normal: new Float32Array( nor ),
    aFlex: new Float32Array( flex ),
    aWave: new Float32Array( wave ),
    aTone: new Float32Array( tone ),
    aPart: new Float32Array( part ),
    aEdge: new Float32Array( edge ),
    index: new Uint16Array( idx ),
    verts: vcount,
    tris: idx.length / 3,
  };
}

// Deterministic PRNG shared by the field layout and the geometry builder, so
// the same seed always gives the same field.
export function mulberry32( seed ) {
  let s = seed & 0xffffffff;
  return function () {
    s = ( s + 0x6d2b79f5 ) & 0xffffffff;
    let t = s;
    t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
    t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
    return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
  };
}
