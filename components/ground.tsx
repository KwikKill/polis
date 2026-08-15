'use client'

import { Grid, MeshReflectorMaterial } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { Building, District } from '@/lib/types'

const STREETLIGHT_COUNT = 44
const STREETLIGHT_CLEARANCE = 1.2
const STREETLIGHT_MIN_GAP = 3

const TERRAIN_SIZE = 220
const TERRAIN_SEGMENTS = 100
const TERRAIN_AMPLITUDE = 0.16
// Extra clearance beyond a building's own footprint before terrain noise
// ramps back up to full amplitude — keeps every building sitting on a flat
// pad regardless of how the ground undulates around it.
const FLATTEN_MARGIN = 1.6

const ROAD_WIDTH = 0.9
const ROAD_HEIGHT = 0.05
const ROAD_COLOR = '#c400e6'
const RING_SPACING = 11

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
function terrainHeight(x: number, z: number): number {
  return (
    (Math.sin(x * 0.15 + z * 0.11) * 0.5 +
      Math.sin(x * 0.07 - z * 0.19 + 1.3) * 0.35 +
      Math.sin(x * 0.31 + z * 0.05 + 4.2) * 0.15) *
    TERRAIN_AMPLITUDE
  )
}

// Displace the reflective ground plane's own vertices, flattened to zero
// right under every building footprint (ramping back up over FLATTEN_MARGIN)
// so the relief never clips through a building's base.
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
    let clearance = Infinity
    for (const b of buildings) {
      const d = Math.hypot(localX - b.x, localY - b.z) - b.width / 2
      if (d < clearance) clearance = d
      if (clearance <= 0) break
    }
    const attenuation = THREE.MathUtils.smoothstep(clearance, 0, FLATTEN_MARGIN)
    pos.setZ(i, terrainHeight(localX, localY) * attenuation)
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

// One avenue per district boundary — literally the street separating one
// language's neighborhood from the next.
function RadialRoad({ angle, length }: { angle: number; length: number }) {
  return (
    <mesh
      position={[(Math.cos(angle) * length) / 2, 0.03, (Math.sin(angle) * length) / 2]}
      rotation={[0, Math.PI / 2 - angle, 0]}
    >
      <boxGeometry args={[ROAD_WIDTH, ROAD_HEIGHT, length]} />
      <meshBasicMaterial color={ROAD_COLOR} toneMapped={false} />
    </mesh>
  )
}

function RingRoad({ radius }: { radius: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <ringGeometry args={[radius - ROAD_WIDTH / 2, radius + ROAD_WIDTH / 2, 64]} />
      <meshBasicMaterial color={ROAD_COLOR} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

// Wet-asphalt reflection (Blade Runner) under a faint glowing grid (Tron),
// with gentle terrain relief and an actual road network (one avenue per
// district boundary, plus ring roads) layered on top — the reflection and
// grid sell the depth, the roads make the layout legible as a real city
// rather than a scatter of buildings on a plane.
export default function Ground({
  buildings,
  districts,
}: {
  buildings: Building[]
  districts: District[]
}) {
  const radius = useMemo(() => cityRadius(buildings), [buildings])
  const terrainGeometry = useMemo(() => buildTerrainGeometry(buildings), [buildings])
  const streetlights = useMemo(() => scatterStreetlights(buildings, radius), [buildings, radius])
  const rings = useMemo(() => {
    const list: number[] = []
    for (let r = RING_SPACING; r < radius; r += RING_SPACING) list.push(r)
    return list
  }, [radius])

  return (
    <group>
      <mesh
        geometry={terrainGeometry}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
      >
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
      <Grid
        position={[0, 0, 0]}
        cellSize={4}
        cellThickness={0.4}
        cellColor="#3a1c5c"
        sectionSize={20}
        sectionThickness={0.8}
        sectionColor="#ff00ff"
        fadeDistance={140}
        fadeStrength={1}
        infiniteGrid
      />

      {districts.map((d) => (
        <RadialRoad key={d.language} angle={d.startAngle} length={radius} />
      ))}
      {rings.map((r) => (
        <RingRoad key={r} radius={r} />
      ))}

      {streetlights.map((l, i) => (
        <Streetlight key={i} x={l.x} z={l.z} />
      ))}
    </group>
  )
}
