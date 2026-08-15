'use client'

import { Grid, MeshReflectorMaterial } from '@react-three/drei'
import { useMemo } from 'react'
import type { Building } from '@/lib/types'

const STREETLIGHT_COUNT = 44
const STREETLIGHT_CLEARANCE = 1.2
const STREETLIGHT_MIN_GAP = 3

interface Point {
  x: number
  z: number
}

// Rejection-sample points inside the city's footprint, keeping clear of
// every building and of each other — cheap scatter for street-level decor
// without needing an actual road graph.
function scatterStreetlights(buildings: Building[]): Point[] {
  if (buildings.length === 0) return []

  const cityRadius =
    Math.max(...buildings.map((b) => Math.hypot(b.x, b.z) + b.width / 2)) + 4
  const lights: Point[] = []
  let attempts = 0

  while (lights.length < STREETLIGHT_COUNT && attempts < STREETLIGHT_COUNT * 25) {
    attempts++
    const angle = Math.random() * Math.PI * 2
    const radius = Math.sqrt(Math.random()) * cityRadius
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius

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

// Wet-asphalt reflection (Blade Runner) under a faint glowing grid (Tron) —
// the reflection is what sells the "night city" depth, the grid keeps the
// near-camera ground legible instead of just black void. Cell size is tuned
// to the city's own building spacing so it reads as streets/blocks rather
// than abstract graph paper.
export default function Ground({ buildings }: { buildings: Building[] }) {
  const streetlights = useMemo(() => scatterStreetlights(buildings), [buildings])

  return (
    <group>
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
      <Grid
        position={[0, 0, 0]}
        cellSize={4}
        cellThickness={0.6}
        cellColor="#3a1c5c"
        sectionSize={20}
        sectionThickness={1.2}
        sectionColor="#ff00ff"
        fadeDistance={140}
        fadeStrength={1}
        infiniteGrid
      />
      {streetlights.map((l, i) => (
        <Streetlight key={i} x={l.x} z={l.z} />
      ))}
    </group>
  )
}
