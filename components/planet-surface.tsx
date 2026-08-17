'use client'

import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import {
  buildHeightmapData,
  groundSurfaceEpsilon,
  SEA_LEVEL_HEIGHT01,
  TERRAIN_AMPLITUDE_FRACTION,
  terrainRadius,
} from '@/lib/terrain'

const SURFACE_VERTEX = `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// A faint glowing circuit-trace grid over the planet ball (this is a
// city-from-code site, the planet doubles as a motherboard) plus a handful
// of brighter "bus" lines and sparse pulsing via-nodes at some
// intersections. Lat/long based, so lines pinch slightly at the poles, an
// accepted stylized trade for staying a single cheap analytic grid rather
// than a texture.
//
// Land and ocean are read straight off a heightmap texture baked from the
// exact same terrainHeight01() field lib/planet-builder.ts uses for city
// placement and road routing (see buildHeightmapData in lib/terrain.ts) —
// one continuous field thresholded at SEA_LEVEL_HEIGHT01, not a list of
// separately placed/sized shapes, so the coastline comes out naturally
// connected instead of a cluster of circles that happen to be near each
// other. The circuit grid is masked to land only (open ocean reads as
// quiet space between "components," not the same trace pattern
// everywhere), and the water color itself shifts toward the site's cyan
// "data" accent near the shoreline, staying deep violet further out —
// depth read as color, not a flat fill.
const SURFACE_FRAGMENT = `
  varying vec3 vPos;
  uniform float uTime;
  uniform vec3 baseColor;
  uniform vec3 waterColorDeep;
  uniform vec3 waterColorShallow;
  uniform sampler2D uHeightMap;
  uniform float uSeaLevel;
  uniform float uCoastBand;
  uniform float uShallowBand;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec3 n = normalize(vPos);
    float lon = atan(n.z, n.x);
    float lat = asin(clamp(n.y, -1.0, 1.0));

    const float PI = 3.14159265;
    const float LON_LINES = 28.0;
    const float LAT_LINES = 14.0;

    // Same (lon, lat) -> texture UV convention buildHeightmapData() uses
    // to bake the texture in the first place, so a fragment here samples
    // the height for its own actual direction, not some other point.
    float texU = lon / (2.0 * PI) + 0.5;
    float texV = lat / PI + 0.5;
    float height01 = texture2D(uHeightMap, vec2(texU, texV)).r * 2.0 - 1.0;

    // Soft-edged land/ocean split (a hard step would alias into a jagged
    // coastline at the pixel level); the shallow-water tint band is
    // separate and wider, so it can fade gently well before the coastline
    // itself starts anti-aliasing.
    float landMask = smoothstep(uSeaLevel - uCoastBand, uSeaLevel + uCoastBand, height01);
    // 0 in deep water (far below sea level), ramping up to 1 right at the
    // shoreline — NOT inverted, height01 rising *toward* uSeaLevel is what
    // "shallower" means here.
    float shallow = clamp(smoothstep(uSeaLevel - uShallowBand, uSeaLevel, height01), 0.0, 1.0);
    vec3 oceanColor = mix(waterColorDeep, waterColorShallow, shallow);
    vec3 base = mix(oceanColor, baseColor, landMask);

    float u = (lon / (2.0 * PI) + 0.5) * LON_LINES;
    float v = (lat / PI + 0.5) * LAT_LINES;

    float du = fwidth(u) + 1e-4;
    float dv = fwidth(v) + 1e-4;
    float gridU = 1.0 - clamp(abs(fract(u - 0.5) - 0.5) / du, 0.0, 1.0);
    float gridV = 1.0 - clamp(abs(fract(v - 0.5) - 0.5) / dv, 0.0, 1.0);

    float ix = floor(u);
    float iy = floor(v);
    float majorU = mod(ix, 7.0) < 0.5 ? 1.0 : 0.0;
    float majorV = mod(iy, 5.0) < 0.5 ? 1.0 : 0.0;

    // Longitude lines converge at the poles, fade the whole overlay out
    // there rather than let it solidify into a bright cap.
    float poleFade = 1.0 - smoothstep(0.82, 0.98, abs(n.y));

    // The grid breathes as a whole, a slow shared pulse rather than each
    // line pulsing on its own (which would look like noise, not a circuit
    // board with current running through it).
    float gridPulse = 0.5 + 0.5 * sin(uTime * 0.7);

    vec3 traceColor = vec3(1.0, 0.0, 1.0);
    vec3 overlay = vec3(0.0);
    overlay += traceColor * gridU * mix(0.04, 0.22, majorU) * gridPulse;
    overlay += traceColor * gridV * mix(0.04, 0.22, majorV) * gridPulse;

    float nodeChance = hash(vec2(ix, iy));
    float atNode = gridU * gridV;
    if (nodeChance > 0.9 && atNode > 0.15) {
      float pulse = 0.6 + 0.4 * sin(uTime * 1.6 + nodeChance * 20.0);
      overlay += vec3(1.0, 0.2, 0.9) * atNode * pulse * 0.55;
    }

    // Traveling "data packet" glints along the major bus lines only — a
    // bright point sliding down a trace, distinct from the grid's own
    // uniform breathing pulse above, the classic circuit-board-current
    // look. Two packets per line (half a cycle apart) so a line is never
    // fully dark between passes; each line's speed/phase is hashed off its
    // own index so lines don't all move in lockstep.
    vec3 glintColor = vec3(1.0, 0.55, 0.95);
    if (majorU > 0.5 && gridU > 0.25) {
      float lineSeed = hash(vec2(ix, 3.0));
      float speed = 0.05 + lineSeed * 0.05;
      float t = v / LAT_LINES - uTime * speed + lineSeed * 12.0;
      float glint = max(
        1.0 - smoothstep(0.0, 0.035, abs(fract(t) - 0.5)),
        1.0 - smoothstep(0.0, 0.035, abs(fract(t + 0.5) - 0.5))
      );
      overlay += glintColor * gridU * glint * 1.05;
    }
    if (majorV > 0.5 && gridV > 0.25) {
      float lineSeed = hash(vec2(7.0, iy));
      float speed = 0.05 + lineSeed * 0.05;
      float t = u / LON_LINES - uTime * speed + lineSeed * 12.0;
      float glint = max(
        1.0 - smoothstep(0.0, 0.035, abs(fract(t) - 0.5)),
        1.0 - smoothstep(0.0, 0.035, abs(fract(t + 0.5) - 0.5))
      );
      overlay += glintColor * gridV * glint * 1.05;
    }

    // Confined to land — the circuit board is where the "components" are,
    // open ocean reads as quiet space between them instead of the same
    // uniform trace pattern regardless of what's underneath it.
    overlay *= landMask;

    vec3 ground = base + overlay * poleFade;

    gl_FragColor = vec4(ground, 1.0);
  }
`

const HALO_VERTEX = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

// A Fresnel term (surface normal vs. view direction) does NOT give a thin
// rim here the way it would for a planet viewed from far orbit: at
// OrbitControls' default distance (3x radius) the sphere's projected disc
// is small enough that "grazing" area, which scales with the *square* of
// the angular radius from the sub-camera point, already covers a large
// fraction of the visible disc well before the true silhouette. Cranking
// the exponent (tried up to 14) only pushes where it starts, not how much
// screen area it ends up covering, confirmed by rendering the raw dot
// product directly. So this leans into that instead of fighting it: a
// gentle, deliberately soft "sunlit hemisphere" glow rather than a rim
// hugging the edge, at low enough intensity to read as mood lighting.
const HALO_FRAGMENT = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  uniform vec3 colorInner;
  uniform vec3 colorOuter;
  uniform float uCameraDistRatio;

  void main() {
    float grazing = 1.0 - clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
    float fres = pow(grazing, 3.2);
    // Still fades out on approach to the surface, close up this would
    // otherwise wash over the whole visible cap rather than reading as
    // limb-ish shading.
    float distFade = smoothstep(1.15, 1.7, uCameraDistRatio);
    vec3 col = mix(colorInner, colorOuter, fres);
    // Kept faint on purpose: the ground's own color is the point now, this
    // is only meant to be a whisper of atmosphere at the edge, not
    // something that tints the whole visible disc.
    gl_FragColor = vec4(col * 0.055 * distFade, fres * 0.055 * distFade);
  }
`

// A UV sphere with every vertex pulled out (or in) to the true terrain
// radius in its own direction (lib/terrain.ts) instead of sitting on a
// perfect sphere — built once per radius change, not per frame, the
// terrain is static. The fragment shader needs no changes for this: it
// already derives the grid/pulse/glints entirely from normalize(vPos),
// and radial displacement doesn't change a vertex's direction, only its
// distance from center, so the grid automatically drapes over the bumps.
function buildTerrainSurfaceGeometry(radius: number): THREE.BufferGeometry {
  // Every city's own ground disc and building bases sit at exactly the
  // true terrain radius (see sphere-curve.ts), the same radius this mesh
  // would otherwise use — coincident surfaces z-fight, which used to be
  // invisible against one flat color but now shows as flicker through the
  // grid. Inset very slightly so this mesh is always just under every
  // city's own footprint.
  const epsilon = groundSurfaceEpsilon(radius)
  const geometry = new THREE.SphereGeometry(radius, 96, 64)
  const position = geometry.attributes.position
  const dir = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    dir.set(position.getX(i), position.getY(i), position.getZ(i)).normalize()
    const r = terrainRadius(dir.x, dir.y, dir.z, radius) - epsilon
    position.setXYZ(i, dir.x * r, dir.y * r, dir.z * r)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

// Baked once (deterministic, same seed as every other terrain read in the
// app) and shared by every mounted PlanetSurface instance, the same
// "compute the fixed thing once at module scope" pattern lib/planet-
// builder.ts already used for its own now-removed water-body list.
const HEIGHTMAP_WIDTH = 512
const HEIGHTMAP_HEIGHT = 256
const heightmapData = buildHeightmapData(HEIGHTMAP_WIDTH, HEIGHTMAP_HEIGHT)

// The planet ball, replacing the flat single-color sphere this used to be.
// The halo mesh is excluded from raycasting so it never steals the
// placement click meant for the surface mesh underneath it.
export default function PlanetSurface({
  radius,
  onClick,
}: {
  radius: number
  onClick?: (e: ThreeEvent<MouseEvent>) => void
}) {
  const surfaceMeshRef = useRef<THREE.Mesh>(null!)
  const haloMaterialRef = useRef<THREE.ShaderMaterial>(null!)

  useFrame(({ clock, camera }) => {
    ;(surfaceMeshRef.current.material as THREE.ShaderMaterial).uniforms.uTime.value =
      clock.elapsedTime
    haloMaterialRef.current.uniforms.uCameraDistRatio.value = camera.position.length() / radius
  })

  const surfaceGeometry = useMemo(() => buildTerrainSurfaceGeometry(radius), [radius])

  // Single-channel (RedFormat, WebGL2) since it's just an elevation value,
  // no color — flipY explicit rather than relying on DataTexture's default,
  // since buildHeightmapData()'s row-0-is-the-south-pole convention has to
  // match whichever way the GPU actually samples row 0 at texture-V 0.
  // wrapS repeats so the longitude seam at lon = ±PI blends across the u=0
  // /u=1 boundary instead of showing a hard seam.
  const heightmapTexture = useMemo(() => {
    const texture = new THREE.DataTexture(
      heightmapData,
      HEIGHTMAP_WIDTH,
      HEIGHTMAP_HEIGHT,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    )
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.flipY = false
    texture.needsUpdate = true
    return texture
  }, [])

  const surfaceUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      baseColor: { value: new THREE.Color('#0d0818') },
      waterColorDeep: { value: new THREE.Color('#9d4dff') },
      // Violet mixed only 40% toward the site's cyan accent, not a pure
      // cyan — even right at the shoreline the water should read as a
      // tinted violet, not a different hue entirely, matching the
      // depth-tint mockup the user actually approved (see round notes).
      waterColorShallow: { value: new THREE.Color('#7d8bff') },
      uHeightMap: { value: heightmapTexture },
      uSeaLevel: { value: SEA_LEVEL_HEIGHT01 },
      uCoastBand: { value: 0.01 },
      uShallowBand: { value: 0.07 },
    }),
    [heightmapTexture],
  )
  const haloUniforms = useMemo(
    () => ({
      colorInner: { value: new THREE.Color('#ff00ff') },
      colorOuter: { value: new THREE.Color('#8a2be2') },
      uCameraDistRatio: { value: 3 },
    }),
    [],
  )

  return (
    <>
      <mesh ref={surfaceMeshRef} onClick={onClick} geometry={surfaceGeometry}>
        <shaderMaterial
          vertexShader={SURFACE_VERTEX}
          fragmentShader={SURFACE_FRAGMENT}
          uniforms={surfaceUniforms}
          toneMapped={false}
        />
      </mesh>
      {/* A perfect sphere, deliberately not terrain-displaced — an
          atmosphere shell shouldn't hug every wrinkle — but sized to clear
          the tallest possible terrain peak (TERRAIN_AMPLITUDE_FRACTION)
          plus a small margin, not the old flat 1.012. */}
      <mesh raycast={() => null} scale={1 + TERRAIN_AMPLITUDE_FRACTION + 0.02}>
        <sphereGeometry args={[radius, 48, 32]} />
        <shaderMaterial
          ref={haloMaterialRef}
          vertexShader={HALO_VERTEX}
          fragmentShader={HALO_FRAGMENT}
          uniforms={haloUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </>
  )
}
