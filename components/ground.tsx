'use client'

import { MeshReflectorMaterial } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { buildCurvedDiscGeometry, curvedLocalPlacement, type SurfaceCurvature } from '@/lib/sphere-curve'
import type { Road } from '@/lib/types'

const MAX_STREETLIGHTS = 60
const MIN_ROAD_LENGTH_FOR_LIGHT = 1.5
const STREETLIGHT_OFFSET = 0.45 // perpendicular offset from the road centerline, the "sidewalk"

const ROAD_WIDTH = 0.55
const ROAD_HEIGHT = 0.05
const ROAD_Y = 0.03
const ROAD_COLOR = '#9d1fb8'
// A "data packet" travelling along each road segment's own length at a
// roughly constant world-space speed, the same idiom planet-surface.tsx's
// ground shader already uses for its circuit-grid bus lines, now on the
// actual streets instead of only the ground beneath them. Replaces the
// static parked-vehicle field this file used to have (see VehicleField's
// removal) — moving light instead of motionless "traffic."
const ROAD_GLINT_COLOR = new THREE.Color(1.0, 0.55, 0.95)
const ROAD_GLINT_SPEED = 6 // world units per second
// Fixed real-world spacing between pulses, *not* each segment's own
// length, a short segment used to complete its own full glint cycle much
// quicker than a long one at the same world speed, reading as a faster
// flicker purely because it was short, not because anything actually moved
// faster. A fixed wavelength decouples the two: every segment just shows
// whatever slice of one continuous, constant-speed traveling pattern
// happens to overlap it, exactly matching planet-roads.tsx's own inter-city
// version for a consistent feel across both scales.
const ROAD_GLINT_WAVELENGTH = 26
const ROAD_GLINT_WIDTH = 0.06
const ROAD_GLINT_INTENSITY = 1.6

const SIDEWALK_WIDTH = 0.32
const SIDEWALK_HEIGHT = 0.035
const SIDEWALK_Y = 0.025
const SIDEWALK_COLOR = '#4a4258'

// A circuit-grid overlay for the standalone city page's reflective floor
// (see the `reflective` branch below) — that plane used to be entirely
// featureless, just a flat mirror. Same fwidth-based line technique
// planet-surface.tsx's own ground grid already uses, applied to the
// plane's flat local XY instead of lon/lat, layered a hair above the
// reflection itself rather than baked into MeshReflectorMaterial (which
// has no texture/pattern input worth fighting for this).
const CITY_GRID_COLOR = new THREE.Color('#ff2fd6')
const CITY_GRID_SPACING = 6

const CITY_GRID_VERTEX = `
  varying vec2 vXy;
  void main() {
    vXy = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const CITY_GRID_FRAGMENT = `
  varying vec2 vXy;
  uniform vec3 gridColor;

  void main() {
    vec2 c = vXy / ${CITY_GRID_SPACING.toFixed(1)};
    vec2 d = fwidth(c) + 1e-4;
    vec2 gridLine = 1.0 - clamp(abs(fract(c - 0.5) - 0.5) / d, 0.0, 1.0);
    float line = max(gridLine.x, gridLine.y);
    gl_FragColor = vec4(gridColor, line * 0.35);
  }
`

interface Point {
  x: number
  z: number
}

// Deterministic-ish per-segment phase from its own position, not
// Math.random() — keeps two segments that happen to render on the same
// frame from ever coincidentally sharing a phase, without needing to carry
// a separate seed value around.
function hashPhase(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
  return s - Math.floor(s)
}

function Streetlight({ x, z, curvature }: Point & { curvature?: SurfaceCurvature }) {
  const { position, quaternion } = useMemo(() => {
    if (!curvature) return { position: new THREE.Vector3(x, 0, z), quaternion: undefined }
    const { position: p, tiltQuaternion } = curvedLocalPlacement(
      x,
      0,
      z,
      curvature.normal,
      curvature.planetRadius,
      curvature.quaternion,
    )
    return { position: p, quaternion: tiltQuaternion }
  }, [x, z, curvature])

  return (
    <group position={position} quaternion={quaternion}>
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 2.2, 6]} />
        <meshBasicMaterial color="#1a1024" toneMapped={false} />
      </mesh>
      <mesh position={[0, 2.28, 0]}>
        <sphereGeometry args={[0.09, 8, 8]} />
        <meshBasicMaterial color="#ff00ff" toneMapped={false} />
      </mesh>
    </group>
  )
}

// One lamp per road segment (skipping tiny ones), offset to one side of the
// centerline like a real sidewalk light. Segment count can run into the
// hundreds for a busy city, so subsample down to a readable density.
function streetlightsAlongRoads(roads: Road[]): Point[] {
  const candidates: Point[] = []

  for (const r of roads) {
    const dx = r.x2 - r.x1
    const dz = r.z2 - r.z1
    const length = Math.hypot(dx, dz)
    if (length < MIN_ROAD_LENGTH_FOR_LIGHT) continue

    const nx = dx / length
    const nz = dz / length
    const side = Math.random() < 0.5 ? 1 : -1
    const px = -nz * side
    const pz = nx * side

    candidates.push({
      x: (r.x1 + r.x2) / 2 + px * STREETLIGHT_OFFSET,
      z: (r.z1 + r.z2) / 2 + pz * STREETLIGHT_OFFSET,
    })
  }

  return shuffleAndCap(candidates, MAX_STREETLIGHTS)
}

function shuffleAndCap<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items.slice(0, max)
}

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const yawScratch = new THREE.Quaternion()

// Shared by every instanced prop below: without curvature, place/yaw it
// exactly as before (zero-diff for the flat /u/[username] page). With it,
// look up that instance's *own* corrected surface point and "standing up
// straight" direction (curvedLocalPlacement) instead of the whole city's
// single shared tangent-plane orientation, a prop out near a large city's
// edge otherwise both floats off the true sphere and stands tilted to the
// city center's normal rather than its own.
function placeDummy(
  dummy: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  yaw: number,
  curvature: SurfaceCurvature | undefined,
) {
  if (curvature) {
    const { position, tiltQuaternion } = curvedLocalPlacement(
      x,
      y,
      z,
      curvature.normal,
      curvature.planetRadius,
      curvature.quaternion,
    )
    dummy.position.copy(position)
    dummy.quaternion.copy(tiltQuaternion).multiply(yawScratch.setFromAxisAngle(Y_AXIS, yaw))
  } else {
    dummy.position.set(x, y, z)
    dummy.rotation.set(0, yaw, 0)
  }
}

// One instanced segment per road, oriented flat along the ground between
// its two endpoints.
function RoadField({ roads, curvature }: { roads: Road[]; curvature?: SurfaceCurvature }) {
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const shader = useRef<{ uniforms: { uTime: { value: number } } } | null>(null)

  useLayoutEffect(() => {
    if (!mesh.current || roads.length === 0) return
    const dummy = new THREE.Object3D()
    const phases = new Float32Array(roads.length)
    const lengths = new Float32Array(roads.length)
    roads.forEach((r, i) => {
      const dx = r.x2 - r.x1
      const dz = r.z2 - r.z1
      const length = Math.hypot(dx, dz)
      const mx = (r.x1 + r.x2) / 2
      const mz = (r.z1 + r.z2) / 2
      placeDummy(dummy, mx, ROAD_Y, mz, Math.atan2(dx, dz), curvature)
      dummy.scale.set(ROAD_WIDTH, ROAD_HEIGHT, length)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
      phases[i] = hashPhase(mx, mz)
      lengths[i] = length
    })
    mesh.current.instanceMatrix.needsUpdate = true
    mesh.current.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1))
    mesh.current.geometry.setAttribute('aLength', new THREE.InstancedBufferAttribute(lengths, 1))
  }, [roads, curvature])

  useFrame(({ clock }) => {
    if (shader.current) shader.current.uniforms.uTime.value = clock.elapsedTime
  })

  if (roads.length === 0) return null

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, roads.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        color={ROAD_COLOR}
        toneMapped={false}
        onBeforeCompile={(s) => {
          s.uniforms.uTime = { value: 0 }
          s.uniforms.glintColor = { value: ROAD_GLINT_COLOR }
          s.vertexShader = s.vertexShader
            .replace(
              '#include <common>',
              '#include <common>\nattribute float aPhase;\nattribute float aLength;\nvarying float vLocalZ;\nvarying float vPhase;\nvarying float vLength;',
            )
            .replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>\nvLocalZ = position.z;\nvPhase = aPhase;\nvLength = aLength;',
            )
          s.fragmentShader = s.fragmentShader
            .replace(
              '#include <common>',
              '#include <common>\nuniform float uTime;\nuniform vec3 glintColor;\nvarying float vLocalZ;\nvarying float vPhase;\nvarying float vLength;',
            )
            .replace(
              '#include <color_fragment>',
              `#include <color_fragment>
              float roadWorldPos = (vLocalZ + 0.5) * vLength;
              float roadGT = fract(roadWorldPos / ${ROAD_GLINT_WAVELENGTH.toFixed(1)} - uTime * ${ROAD_GLINT_SPEED.toFixed(1)} / ${ROAD_GLINT_WAVELENGTH.toFixed(1)} + vPhase);
              float roadGlint = 1.0 - smoothstep(0.0, ${ROAD_GLINT_WIDTH.toFixed(2)}, roadGT);
              diffuseColor.rgb += glintColor * roadGlint * ${ROAD_GLINT_INTENSITY.toFixed(1)};`,
            )
          shader.current = s as unknown as { uniforms: { uTime: { value: number } } }
        }}
      />
    </instancedMesh>
  )
}

// A shoulder strip on each side of every road, the difference between "a
// coloured line" and "a street with a curb," cheap detail around the roads.
function SidewalkField({ roads, curvature }: { roads: Road[]; curvature?: SurfaceCurvature }) {
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const count = roads.length * 2

  useLayoutEffect(() => {
    if (!mesh.current || roads.length === 0) return
    const dummy = new THREE.Object3D()
    const offset = ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2 + 0.03
    let idx = 0
    roads.forEach((r) => {
      const dx = r.x2 - r.x1
      const dz = r.z2 - r.z1
      const length = Math.hypot(dx, dz)
      if (length < 1e-4) return
      const nx = dx / length
      const nz = dz / length
      const px = -nz
      const pz = nx
      const angle = Math.atan2(dx, dz)
      const mx = (r.x1 + r.x2) / 2
      const mz = (r.z1 + r.z2) / 2

      for (const side of [1, -1]) {
        placeDummy(dummy, mx + px * offset * side, SIDEWALK_Y, mz + pz * offset * side, angle, curvature)
        dummy.scale.set(SIDEWALK_WIDTH, SIDEWALK_HEIGHT, length)
        dummy.updateMatrix()
        mesh.current.setMatrixAt(idx, dummy.matrix)
        idx++
      }
    })
    mesh.current.instanceMatrix.needsUpdate = true
  }, [roads, curvature])

  if (roads.length === 0) return null

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={SIDEWALK_COLOR} toneMapped={false} />
    </instancedMesh>
  )
}

// Wet-asphalt reflection (Blade Runner), plus a road network, the Voronoi
// cell boundary of every building, so streets run through the real gaps
// between buildings, with sidewalks and streetlights layered along it, and
// a light pulse travelling each road segment's own length in place of the
// static parked vehicles this file used to scatter along wider gaps.
//
// `reflective`/`groundRadius` exist for the planet view, where many full
// cities render at once: MeshReflectorMaterial is a real extra scene
// render from a mirrored camera every frame, per instance, unlike more
// InstancedMesh triangles (cheap to batch), that cost doesn't batch and
// stacks linearly with city count. Set reflective={false} there to swap
// the reflection for a flat matte disc sized to that city's own footprint,
// while every other detail layer stays exactly as rich as this default.
//
// `curvature`, also planet-only: a flat disc's edges visibly float above
// (or sink below) the sphere once the disc is large enough relative to the
// planet's own radius for the gap to show. When provided, the ground disc
// is built from vertices individually pulled onto the true sphere surface
// (buildCurvedDiscGeometry) instead of a flat CircleGeometry.
export default function Ground({
  roads,
  reflective = true,
  groundRadius = 250,
  curvature,
}: {
  roads: Road[]
  reflective?: boolean
  groundRadius?: number
  curvature?: SurfaceCurvature
}) {
  const streetlights = useMemo(() => streetlightsAlongRoads(roads), [roads])
  const cityGridUniforms = useMemo(() => ({ gridColor: { value: CITY_GRID_COLOR } }), [])

  const curvedGeometry = useMemo(() => {
    if (!curvature) return null
    return buildCurvedDiscGeometry(
      groundRadius,
      curvature.planetRadius,
      curvature.normal,
      curvature.quaternion,
    )
  }, [curvature, groundRadius])

  return (
    <group>
      {reflective ? (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
            <planeGeometry args={[500, 500]} />
            <MeshReflectorMaterial
              blur={[300, 100]}
              resolution={1024}
              mixBlur={1}
              mixStrength={35}
              roughness={1}
              depthScale={1.2}
              minDepthThreshold={0.4}
              maxDepthThreshold={1.4}
              color="#050308"
              metalness={0.4}
            />
          </mesh>
          {/* Sits at -0.008: a real 0.012-unit gap above the reflective
              floor (-0.02) and a real 0.013-unit gap below the roads' own
              lowest face (ROAD_Y - ROAD_HEIGHT/2 = 0.005) — both roughly
              2.5x the original 0.005 gap that caused the floor z-fight, and
              deliberately closer to the floor than to the roads so the
              polygonOffset below only ever needs to win against the floor,
              never risking an overshoot past the roads the way an earlier
              -4/-4 factor did. `units` (not `factor`) bumped further than
              that first correction: `units` scales with the depth buffer's
              own locally-resolvable step, which grows non-linearly with
              distance from the camera (see city-scene.tsx's near/far
              comment) — a plain small offset that held up near the camera
              stopped being enough once the camera moved far enough out,
              and the grid visibly lost its z-fight against the floor
              there. `factor` (slope-driven, the term responsible for the
              earlier roads overshoot) stays untouched. */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.008, 0]}>
            <planeGeometry args={[500, 500]} />
            <shaderMaterial
              vertexShader={CITY_GRID_VERTEX}
              fragmentShader={CITY_GRID_FRAGMENT}
              uniforms={cityGridUniforms}
              transparent
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-1}
              polygonOffsetUnits={-4}
              toneMapped={false}
            />
          </mesh>
        </>
      ) : curvedGeometry ? (
        <mesh geometry={curvedGeometry} position={[0, -0.02, 0]}>
          <meshBasicMaterial color="#0d0a16" toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ) : (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
          <circleGeometry args={[groundRadius, 48]} />
          <meshBasicMaterial color="#0d0a16" toneMapped={false} />
        </mesh>
      )}

      <SidewalkField roads={roads} curvature={curvature} />
      <RoadField roads={roads} curvature={curvature} />

      {streetlights.map((l, i) => (
        <Streetlight key={i} x={l.x} z={l.z} curvature={curvature} />
      ))}
    </group>
  )
}
