'use client'

import { MeshReflectorMaterial } from '@react-three/drei'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Building, Road } from '@/lib/types'

const MAX_STREETLIGHTS = 60
const MIN_ROAD_LENGTH_FOR_LIGHT = 1.5
const STREETLIGHT_OFFSET = 0.45 // perpendicular offset from the road centerline — the "sidewalk"

const TERRAIN_SIZE = 220
const TERRAIN_SEGMENTS = 100
const TERRAIN_AMPLITUDE = 0.16
// Extra clearance beyond a building's own footprint before terrain noise
// ramps back up to full amplitude — keeps every building sitting on a flat
// pad regardless of how the ground undulates around it.
const FLATTEN_MARGIN = 1.8

const ROAD_WIDTH = 0.55
const ROAD_HEIGHT = 0.05
const ROAD_Y = 0.03
const ROAD_COLOR = '#9d1fb8'

interface Point {
  x: number
  z: number
}

// Cheap smooth "value noise" via a few layered sine waves — no external
// noise library needed, deterministic, good enough for gentle ground relief.
function terrainNoise(x: number, z: number): number {
  return (
    (Math.sin(x * 0.15 + z * 0.11) * 0.5 +
      Math.sin(x * 0.07 - z * 0.19 + 1.3) * 0.35 +
      Math.sin(x * 0.31 + z * 0.05 + 4.2) * 0.15) *
    TERRAIN_AMPLITUDE
  )
}

// Shared by the terrain mesh displacement and by road placement, so a road
// sits exactly on the ground surface everywhere along its length instead of
// floating above or sinking into it. Flattens to zero right at a building's
// footprint, ramping back up to full noise over FLATTEN_MARGIN.
function groundHeight(x: number, z: number, buildings: Building[]): number {
  let clearance = Infinity
  for (const b of buildings) {
    const d = Math.hypot(x - b.x, z - b.z) - b.width / 2
    if (d < clearance) clearance = d
    if (clearance <= 0) break
  }
  const attenuation = THREE.MathUtils.smoothstep(clearance, 0, FLATTEN_MARGIN)
  return terrainNoise(x, z) * attenuation
}

function buildTerrainGeometry(buildings: Building[]): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  )
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const localX = pos.getX(i)
    const localY = pos.getY(i) // pre-rotation local Y maps to world Z on this plane
    pos.setZ(i, groundHeight(localX, localY, buildings))
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

// One lamp per road segment (skipping tiny ones), offset to one side of the
// centerline like a real sidewalk light — placing them independent of the
// roads was the previous bug ("ça ne fait pas de sens sinon"). Segment
// count can run into the hundreds for a busy city, so subsample down to a
// readable density rather than lighting every single block edge.
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
    // perpendicular to the road direction
    const px = -nz * side
    const pz = nx * side

    candidates.push({
      x: (r.x1 + r.x2) / 2 + px * STREETLIGHT_OFFSET,
      z: (r.z1 + r.z2) / 2 + pz * STREETLIGHT_OFFSET,
    })
  }

  if (candidates.length <= MAX_STREETLIGHTS) return candidates

  // Reservoir-ish random subsample so density stays readable city-wide
  // rather than biased toward whichever roads happened to come first.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  return candidates.slice(0, MAX_STREETLIGHTS)
}

function Streetlight({ x, z }: Point) {
  return (
    <group position={[x, 0, z]}>
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

// One instanced segment per road, oriented to connect its two endpoints
// exactly (including their different ground heights, so a street climbing
// over a terrain bump tilts to match rather than clipping through it).
function RoadField({ roads, buildings }: { roads: Road[]; buildings: Building[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null!)

  useLayoutEffect(() => {
    if (!mesh.current || roads.length === 0) return
    const dummy = new THREE.Object3D()
    const dir = new THREE.Vector3()
    const zAxis = new THREE.Vector3(0, 0, 1)

    roads.forEach((r, i) => {
      const y1 = ROAD_Y + groundHeight(r.x1, r.z1, buildings)
      const y2 = ROAD_Y + groundHeight(r.x2, r.z2, buildings)
      dir.set(r.x2 - r.x1, y2 - y1, r.z2 - r.z1)
      const length = dir.length()
      dir.normalize()

      dummy.position.set((r.x1 + r.x2) / 2, (y1 + y2) / 2, (r.z1 + r.z2) / 2)
      dummy.quaternion.setFromUnitVectors(zAxis, dir)
      dummy.scale.set(ROAD_WIDTH, ROAD_HEIGHT, length)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
    })
    mesh.current.instanceMatrix.needsUpdate = true
  }, [roads, buildings])

  if (roads.length === 0) return null

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, roads.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={ROAD_COLOR} toneMapped={false} />
    </instancedMesh>
  )
}

// Wet-asphalt reflection (Blade Runner) with gentle terrain relief, and an
// actual road network — the Voronoi cell boundary of every building, so
// streets run through the real gaps between buildings (a grid of blocks)
// rather than a shape overlaid on top of the layout.
export default function Ground({ buildings, roads }: { buildings: Building[]; roads: Road[] }) {
  const terrainGeometry = useMemo(() => buildTerrainGeometry(buildings), [buildings])
  const streetlights = useMemo(() => streetlightsAlongRoads(roads), [roads])

  return (
    <group>
      <mesh geometry={terrainGeometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
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

      <RoadField roads={roads} buildings={buildings} />

      {streetlights.map((l, i) => (
        <Streetlight key={i} x={l.x} z={l.z} />
      ))}
    </group>
  )
}
