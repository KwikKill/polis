'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { curvedLocalPlacement, type SurfaceCurvature } from '@/lib/sphere-curve'
import type { Building } from '@/lib/types'

const FORK_CAP_HEIGHT = 0.4
const EDGE_TRIM = 0.1 // corner-bar thickness, Tron-style glowing edges
const WINDOW_WIDTH = 0.24
const WINDOW_HEIGHT = 0.32
const WINDOW_ROW_SPACING = 1.4
const WINDOW_COL_SPACING = 0.85
const MAX_WINDOW_ROWS = 9
const MAX_WINDOW_COLS = 4
const WINDOW_LIT_PROB_ACTIVE = 0.75
const WINDOW_LIT_PROB_STALE = 0.1
const WINDOW_COLOR = '#ffe3a8'
const ROOF_PROP_COLOR = '#342e40'
const TIER_MIN_HEIGHT = 10 // only buildings at least this tall get a setback tier
const TIER_PROBABILITY = 0.5

interface BuildingFieldProps {
  buildings: Building[]
  onHover: (building: Building | null) => void
  onSelect: (building: Building) => void
  curvature?: SurfaceCurvature
}

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const yawScratch = new THREE.Quaternion()

// Every instance below is placed via this instead of a raw
// dummy.position.set/dummy.rotation.set pair: without curvature it's
// exactly that (zero-diff for the flat /u/[username] page). With it, each
// individual wall/trim bar/window/roof prop/tier gets *its own* corrected
// surface point and "standing up straight" tilt (curvedLocalPlacement)
// rather than inheriting one shared orientation from the city's own
// tangent-plane group — at real planet scale a big city's buildings
// otherwise both float off the true sphere near the city's edge and all
// lean at the same angle instead of each standing normal to the surface
// under it.
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

interface WindowInstance {
  x: number
  y: number
  z: number
  rotationY: number
}

interface RoofProp {
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
}

interface Tier {
  x: number
  y: number
  z: number
  width: number
  height: number
  depth: number
  color: THREE.Color
}

// Bloom (see city-scene.tsx) reacts to raw pixel luminance, not a material's
// `emissive` channel specifically — so "glow" here just means pushing the
// instance color past 1.0 with toneMapped=false on an *unlit* material.
// meshStandardMaterial was used before, but its diffuse output still scales
// with the scene's (deliberately dim, night-ambient) light — under that
// lighting a scaled-up albedo can still render under the bloom threshold.
// meshBasicMaterial sidesteps that: the instance color IS the pixel color.
//
// Being fully unlit loses all directional shading though — every face
// renders as one flat color, which reads as a cartoon block rather than a
// building. `shadedBoxGeometry` bakes a fixed per-face brightness (like
// static ambient occlusion) as vertex colors so the volume still reads
// correctly regardless of scene lighting, while the *instance* color stays
// deliberately restrained — most of a building's glow should come from its
// edge trim and windows, not the walls themselves blowing out.
// Range compressed vs. what you'd use on a bright material — bodyColor's
// lightness is now deliberately low, so multiplying by anything much
// smaller than ~0.55 crushes the dim faces to indistinguishable black.
const FACE_SHADE = [0.85, 0.7, 1, 0.55, 0.9, 0.65] // +x, -x, +y, -y, +z, -z

function shadedBoxGeometry(): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 1)
  const colors = new Float32Array(24 * 3)
  for (let face = 0; face < 6; face++) {
    const shade = FACE_SHADE[face]
    for (let v = 0; v < 4; v++) {
      const idx = (face * 4 + v) * 3
      colors[idx] = shade
      colors[idx + 1] = shade
      colors[idx + 2] = shade
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

const hslScratch = { h: 0, s: 0, l: 0 }

// The "fluorescent toy block" look wasn't really a brightness problem —
// scaling a fully-saturated hex color by <1 just makes a darker version of
// the same saturated hue, it doesn't make it read as a material. Pulling
// *saturation* down (keeping only a hint of the language hue) and clamping
// lightness low gives a dark, muted structural volume instead — the
// language color's job becomes the edge trim and windows, not the walls.
function bodyColor(b: Building): THREE.Color {
  new THREE.Color(b.color).getHSL(hslScratch)
  const lightness = b.stale ? 0.05 : 0.09 + b.intensity * 0.08
  const saturation = b.stale ? 0.12 : 0.32
  return new THREE.Color().setHSL(hslScratch.h, saturation, lightness)
}

function trimColor(b: Building): THREE.Color {
  const color = new THREE.Color(b.color)
  const boost = b.stale ? 0.3 : 1.0 + b.intensity * 1.0
  return color.multiplyScalar(boost)
}

function buildWindows(buildings: Building[]): WindowInstance[] {
  const windows: WindowInstance[] = []
  for (const b of buildings) {
    const rows = Math.min(MAX_WINDOW_ROWS, Math.max(1, Math.floor(b.height / WINDOW_ROW_SPACING)))
    const cols = Math.min(MAX_WINDOW_COLS, Math.max(1, Math.floor(b.width / WINDOW_COL_SPACING)))
    const litProb = b.stale ? WINDOW_LIT_PROB_STALE : WINDOW_LIT_PROB_ACTIVE

    for (const side of [1, -1]) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() > litProb) continue
          windows.push({
            x: b.x + side * (b.width / 2 + 0.03),
            y: ((r + 0.5) / rows) * b.height,
            z: b.z + ((c + 0.5) / cols) * b.width - b.width / 2,
            rotationY: side === 1 ? Math.PI / 2 : -Math.PI / 2,
          })
        }
      }
    }
  }
  return windows
}

// AC units, tanks, vents — the rooftop clutter real buildings have instead
// of a perfectly clean flat top. Neutral utility color, not tied to the
// building's own language hue, since these read as infrastructure.
function buildRoofProps(buildings: Building[]): RoofProp[] {
  const props: RoofProp[] = []
  for (const b of buildings) {
    if (b.landmark) continue // keep the beacon's roof clean
    const count = 1 + Math.floor(Math.random() * 3)
    for (let i = 0; i < count; i++) {
      const margin = 0.3
      const usable = Math.max(0.15, b.width - margin * 2)
      const sy = 0.15 + Math.random() * 0.3
      props.push({
        x: b.x + (Math.random() - 0.5) * usable,
        y: b.height + sy / 2,
        z: b.z + (Math.random() - 0.5) * usable,
        sx: 0.15 + Math.random() * 0.25,
        sy,
        sz: 0.15 + Math.random() * 0.25,
      })
    }
  }
  return props
}

// A narrower "penthouse" volume on top of some taller buildings, giving a
// stepped-setback silhouette instead of every tower being a plain extruded
// box. Reuses bodyColor so it reads as part of the same structure.
function buildTiers(buildings: Building[]): Tier[] {
  const tiers: Tier[] = []
  for (const b of buildings) {
    if (b.height < TIER_MIN_HEIGHT || Math.random() > TIER_PROBABILITY) continue
    const startFrac = 0.55 + Math.random() * 0.25
    const baseY = b.height * startFrac
    const height = b.height - baseY + b.height * 0.08
    const inset = 0.55 + Math.random() * 0.2
    tiers.push({
      x: b.x,
      y: baseY + height / 2,
      z: b.z,
      width: b.width * inset,
      height,
      depth: b.depth * inset,
      color: bodyColor(b),
    })
  }
  return tiers
}

function LandmarkBeacon({ building: b, curvature }: { building: Building; curvature?: SurfaceCurvature }) {
  const { position, quaternion } = useMemo(() => {
    if (!curvature) return { position: new THREE.Vector3(b.x, b.height + 6, b.z), quaternion: undefined }
    const { position: p, tiltQuaternion } = curvedLocalPlacement(
      b.x,
      b.height + 6,
      b.z,
      curvature.normal,
      curvature.planetRadius,
      curvature.quaternion,
    )
    return { position: p, quaternion: tiltQuaternion }
  }, [b.x, b.z, b.height, curvature])

  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[0.04, 0.04, 12, 6]} />
      <meshBasicMaterial color={b.color} toneMapped={false} transparent opacity={0.55} />
    </mesh>
  )
}

export default function BuildingField({ buildings, onHover, onSelect, curvature }: BuildingFieldProps) {
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const forkMesh = useRef<THREE.InstancedMesh>(null!)
  const trimMesh = useRef<THREE.InstancedMesh>(null!)
  const windowMesh = useRef<THREE.InstancedMesh>(null!)
  const roofPropMesh = useRef<THREE.InstancedMesh>(null!)
  const tierMesh = useRef<THREE.InstancedMesh>(null!)

  const bodyGeometry = useMemo(() => shadedBoxGeometry(), [])
  const landmarks = useMemo(() => buildings.filter((b) => b.landmark), [buildings])
  const forks = useMemo(() => buildings.filter((b) => b.fork), [buildings])
  const windows = useMemo(() => buildWindows(buildings), [buildings])
  const roofProps = useMemo(() => buildRoofProps(buildings), [buildings])
  const tiers = useMemo(() => buildTiers(buildings), [buildings])

  useLayoutEffect(() => {
    if (!mesh.current) return
    const dummy = new THREE.Object3D()
    buildings.forEach((b, i) => {
      placeDummy(dummy, b.x, b.height / 2, b.z, 0, curvature)
      dummy.scale.set(b.width, b.height, b.depth)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
      mesh.current.setColorAt(i, bodyColor(b))
    })
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
  }, [buildings, curvature])

  useLayoutEffect(() => {
    if (!forkMesh.current || forks.length === 0) return
    const dummy = new THREE.Object3D()
    forks.forEach((b, i) => {
      placeDummy(dummy, b.x, b.height + FORK_CAP_HEIGHT / 2, b.z, 0, curvature)
      dummy.scale.set(b.width * 0.55, FORK_CAP_HEIGHT, b.depth * 0.55)
      dummy.updateMatrix()
      forkMesh.current.setMatrixAt(i, dummy.matrix)
    })
    forkMesh.current.instanceMatrix.needsUpdate = true
  }, [forks, curvature])

  // Four thin glowing corner bars per building — the actual Tron-style
  // "glowing edges on a dark volume" look; the body color alone (however
  // bright) still reads as a flat box without this.
  useLayoutEffect(() => {
    if (!trimMesh.current || buildings.length === 0) return
    const dummy = new THREE.Object3D()
    const corners: Array<[number, number]> = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]
    let idx = 0
    buildings.forEach((b) => {
      const color = trimColor(b)
      corners.forEach(([cx, cz]) => {
        placeDummy(dummy, b.x + (cx * b.width) / 2, b.height / 2, b.z + (cz * b.depth) / 2, 0, curvature)
        dummy.scale.set(EDGE_TRIM, b.height, EDGE_TRIM)
        dummy.updateMatrix()
        trimMesh.current.setMatrixAt(idx, dummy.matrix)
        trimMesh.current.setColorAt(idx, color)
        idx++
      })
    })
    trimMesh.current.instanceMatrix.needsUpdate = true
    if (trimMesh.current.instanceColor) trimMesh.current.instanceColor.needsUpdate = true
  }, [buildings, curvature])

  useLayoutEffect(() => {
    if (!windowMesh.current || windows.length === 0) return
    const dummy = new THREE.Object3D()
    windows.forEach((w, i) => {
      placeDummy(dummy, w.x, w.y, w.z, w.rotationY, curvature)
      dummy.scale.set(WINDOW_WIDTH, WINDOW_HEIGHT, 1)
      dummy.updateMatrix()
      windowMesh.current.setMatrixAt(i, dummy.matrix)
    })
    windowMesh.current.instanceMatrix.needsUpdate = true
  }, [windows, curvature])

  useLayoutEffect(() => {
    if (!roofPropMesh.current || roofProps.length === 0) return
    const dummy = new THREE.Object3D()
    roofProps.forEach((p, i) => {
      placeDummy(dummy, p.x, p.y, p.z, 0, curvature)
      dummy.scale.set(p.sx, p.sy, p.sz)
      dummy.updateMatrix()
      roofPropMesh.current.setMatrixAt(i, dummy.matrix)
    })
    roofPropMesh.current.instanceMatrix.needsUpdate = true
  }, [roofProps, curvature])

  useLayoutEffect(() => {
    if (!tierMesh.current || tiers.length === 0) return
    const dummy = new THREE.Object3D()
    tiers.forEach((t, i) => {
      placeDummy(dummy, t.x, t.y, t.z, 0, curvature)
      dummy.scale.set(t.width, t.height, t.depth)
      dummy.updateMatrix()
      tierMesh.current.setMatrixAt(i, dummy.matrix)
      tierMesh.current.setColorAt(i, t.color)
    })
    tierMesh.current.instanceMatrix.needsUpdate = true
    if (tierMesh.current.instanceColor) tierMesh.current.instanceColor.needsUpdate = true
  }, [tiers, curvature])

  return (
    <>
      <instancedMesh
        ref={mesh}
        args={[bodyGeometry, undefined, buildings.length]}
        onPointerMove={(e) => {
          e.stopPropagation()
          if (e.instanceId != null) onHover(buildings[e.instanceId])
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation()
          if (e.instanceId != null) onSelect(buildings[e.instanceId])
        }}
      >
        <meshBasicMaterial toneMapped={false} vertexColors />
      </instancedMesh>

      <instancedMesh ref={trimMesh} args={[undefined, undefined, buildings.length * 4]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {windows.length > 0 && (
        <instancedMesh ref={windowMesh} args={[undefined, undefined, windows.length]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color={WINDOW_COLOR} toneMapped={false} side={THREE.DoubleSide} />
        </instancedMesh>
      )}

      {tiers.length > 0 && (
        <instancedMesh ref={tierMesh} args={[bodyGeometry, undefined, tiers.length]}>
          <meshBasicMaterial toneMapped={false} vertexColors />
        </instancedMesh>
      )}

      {roofProps.length > 0 && (
        <instancedMesh ref={roofPropMesh} args={[undefined, undefined, roofProps.length]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={ROOF_PROP_COLOR} toneMapped={false} />
        </instancedMesh>
      )}

      {/* Forks get a small "prefab" cap — a modular block bolted on top,
          distinct from an original repo's clean single volume. */}
      {forks.length > 0 && (
        <instancedMesh ref={forkMesh} args={[undefined, undefined, forks.length]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#cfd8ff" toneMapped={false} />
        </instancedMesh>
      )}

      {/* Rooftop beacons on the top-starred repos — cheap, low count, not instanced. */}
      {landmarks.map((b) => (
        <LandmarkBeacon key={b.repoName} building={b} curvature={curvature} />
      ))}
    </>
  )
}
