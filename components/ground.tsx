'use client'

import { MeshReflectorMaterial } from '@react-three/drei'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { buildCurvedDiscGeometry, curvedLocalPlacement, type SurfaceCurvature } from '@/lib/sphere-curve'
import type { Road } from '@/lib/types'

const MAX_STREETLIGHTS = 60
const MIN_ROAD_LENGTH_FOR_LIGHT = 1.5
const STREETLIGHT_OFFSET = 0.45 // perpendicular offset from the road centerline — the "sidewalk"

const ROAD_WIDTH = 0.55
const ROAD_HEIGHT = 0.05
const ROAD_Y = 0.03
const ROAD_COLOR = '#9d1fb8'

const SIDEWALK_WIDTH = 0.32
const SIDEWALK_HEIGHT = 0.035
const SIDEWALK_Y = 0.025
const SIDEWALK_COLOR = '#4a4258'

const MAX_VEHICLES = 45
const VEHICLE_MIN_ROAD_LENGTH = 2.2
const VEHICLE_SPAWN_CHANCE = 0.4
const VEHICLE_OFFSET = 0.28
const VEHICLE_SIZE: [number, number, number] = [0.5, 0.2, 0.26]
const VEHICLE_COLORS = ['#e6e6f0', '#7ee8ff', '#ffb454', '#3a3244']

interface Point {
  x: number
  z: number
}

interface Vehicle extends Point {
  angle: number
  color: string
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

// A couple of parked-looking blocks along wider gaps — cheap street-level
// life, same technique as the streetlights but on the opposite shoulder.
function vehiclesAlongRoads(roads: Road[]): Vehicle[] {
  const candidates: Vehicle[] = []

  for (const r of roads) {
    if (Math.random() > VEHICLE_SPAWN_CHANCE) continue
    const dx = r.x2 - r.x1
    const dz = r.z2 - r.z1
    const length = Math.hypot(dx, dz)
    if (length < VEHICLE_MIN_ROAD_LENGTH) continue

    const nx = dx / length
    const nz = dz / length
    const side = Math.random() < 0.5 ? 1 : -1
    const px = -nz * side
    const pz = nx * side
    const t = 0.3 + Math.random() * 0.4

    candidates.push({
      x: r.x1 + dx * t + px * VEHICLE_OFFSET,
      z: r.z1 + dz * t + pz * VEHICLE_OFFSET,
      angle: Math.atan2(dx, dz),
      color: VEHICLE_COLORS[Math.floor(Math.random() * VEHICLE_COLORS.length)],
    })
  }

  return shuffleAndCap(candidates, MAX_VEHICLES)
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
// single shared tangent-plane orientation — a prop out near a large city's
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

  useLayoutEffect(() => {
    if (!mesh.current || roads.length === 0) return
    const dummy = new THREE.Object3D()
    roads.forEach((r, i) => {
      const dx = r.x2 - r.x1
      const dz = r.z2 - r.z1
      const length = Math.hypot(dx, dz)
      placeDummy(dummy, (r.x1 + r.x2) / 2, ROAD_Y, (r.z1 + r.z2) / 2, Math.atan2(dx, dz), curvature)
      dummy.scale.set(ROAD_WIDTH, ROAD_HEIGHT, length)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
    })
    mesh.current.instanceMatrix.needsUpdate = true
  }, [roads, curvature])

  if (roads.length === 0) return null

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, roads.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={ROAD_COLOR} toneMapped={false} />
    </instancedMesh>
  )
}

// A shoulder strip on each side of every road — the difference between "a
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

function VehicleField({ vehicles, curvature }: { vehicles: Vehicle[]; curvature?: SurfaceCurvature }) {
  const mesh = useRef<THREE.InstancedMesh>(null!)

  useLayoutEffect(() => {
    if (!mesh.current || vehicles.length === 0) return
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    vehicles.forEach((v, i) => {
      placeDummy(dummy, v.x, VEHICLE_SIZE[1] / 2 + 0.02, v.z, v.angle, curvature)
      dummy.scale.set(...VEHICLE_SIZE)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
      mesh.current.setColorAt(i, color.set(v.color))
    })
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
  }, [vehicles, curvature])

  if (vehicles.length === 0) return null

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, vehicles.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}

// Wet-asphalt reflection (Blade Runner), plus a road network — the Voronoi
// cell boundary of every building, so streets run through the real gaps
// between buildings — with sidewalks, streetlights and parked vehicles
// layered along it.
//
// `reflective`/`groundRadius` exist for the planet view, where many full
// cities render at once: MeshReflectorMaterial is a real extra scene
// render from a mirrored camera every frame, per instance — unlike more
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
  const vehicles = useMemo(() => vehiclesAlongRoads(roads), [roads])

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
      <VehicleField vehicles={vehicles} curvature={curvature} />

      {streetlights.map((l, i) => (
        <Streetlight key={i} x={l.x} z={l.z} curvature={curvature} />
      ))}
    </group>
  )
}
