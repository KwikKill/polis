'use client'

import { MeshReflectorMaterial } from '@react-three/drei'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Building, Road } from '@/lib/types'

const STREETLIGHT_COUNT = 44
const STREETLIGHT_CLEARANCE = 1.4
const STREETLIGHT_MIN_GAP = 3

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

function cityRadius(buildings: Building[]): number {
  if (buildings.length === 0) return 20
  return Math.max(...buildings.map((b) => Math.hypot(b.x, b.z) + b.width / 2)) + 4
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

// Rejection-sample points inside the city's footprint, keeping clear of
// every building and of each other — cheap scatter for street-level decor
// without needing an actual road graph.
function scatterStreetlights(buildings: Building[], radius: number): Point[] {
  if (buildings.length === 0) return []

  const lights: Point[] = []
  let attempts = 0

  while (lights.length < STREETLIGHT_COUNT && attempts < STREETLIGHT_COUNT * 25) {
    attempts++
    const angle = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random()) * radius
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r

    const blocked = buildings.some(
      (b) => Math.hypot(b.x - x, b.z - z) < b.width / 2 + STREETLIGHT_CLEARANCE,
    )
    const crowded = lights.some((l) => Math.hypot(l.x - x, l.z - z) < STREETLIGHT_MIN_GAP)

    if (!blocked && !crowded) lights.push({ x, z })
  }

  return lights
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
// actual road network — one street per pair of Delaunay-adjacent buildings,
// so every road runs through a real gap between real neighbours instead of
// an arbitrary shape overlaid on top of the layout.
export default function Ground({ buildings, roads }: { buildings: Building[]; roads: Road[] }) {
  const radius = useMemo(() => cityRadius(buildings), [buildings])
  const terrainGeometry = useMemo(() => buildTerrainGeometry(buildings), [buildings])
  const streetlights = useMemo(() => scatterStreetlights(buildings, radius), [buildings, radius])

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
