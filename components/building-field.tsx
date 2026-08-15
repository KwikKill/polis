'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
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

interface BuildingFieldProps {
  buildings: Building[]
  onHover: (building: Building | null) => void
  onSelect: (building: Building) => void
}

interface WindowInstance {
  x: number
  y: number
  z: number
  rotationY: number
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
const FACE_SHADE = [0.8, 0.6, 1, 0.35, 0.9, 0.5] // +x, -x, +y, -y, +z, -z

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

function bodyColor(b: Building): THREE.Color {
  const color = new THREE.Color(b.color)
  const boost = b.stale ? 0.28 : 0.45 + b.intensity * 0.45
  return color.multiplyScalar(boost)
}

function trimColor(b: Building): THREE.Color {
  const color = new THREE.Color(b.color)
  const boost = b.stale ? 0.3 : 1.1 + b.intensity * 1.2
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

export default function BuildingField({ buildings, onHover, onSelect }: BuildingFieldProps) {
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const forkMesh = useRef<THREE.InstancedMesh>(null!)
  const trimMesh = useRef<THREE.InstancedMesh>(null!)
  const windowMesh = useRef<THREE.InstancedMesh>(null!)

  const bodyGeometry = useMemo(() => shadedBoxGeometry(), [])
  const landmarks = useMemo(() => buildings.filter((b) => b.landmark), [buildings])
  const forks = useMemo(() => buildings.filter((b) => b.fork), [buildings])
  const windows = useMemo(() => buildWindows(buildings), [buildings])

  useLayoutEffect(() => {
    if (!mesh.current) return
    const dummy = new THREE.Object3D()
    buildings.forEach((b, i) => {
      dummy.position.set(b.x, b.height / 2, b.z)
      dummy.scale.set(b.width, b.height, b.depth)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
      mesh.current.setColorAt(i, bodyColor(b))
    })
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
  }, [buildings])

  useLayoutEffect(() => {
    if (!forkMesh.current || forks.length === 0) return
    const dummy = new THREE.Object3D()
    forks.forEach((b, i) => {
      dummy.position.set(b.x, b.height + FORK_CAP_HEIGHT / 2, b.z)
      dummy.scale.set(b.width * 0.55, FORK_CAP_HEIGHT, b.depth * 0.55)
      dummy.updateMatrix()
      forkMesh.current.setMatrixAt(i, dummy.matrix)
    })
    forkMesh.current.instanceMatrix.needsUpdate = true
  }, [forks])

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
        dummy.position.set(
          b.x + (cx * b.width) / 2,
          b.height / 2,
          b.z + (cz * b.depth) / 2,
        )
        dummy.scale.set(EDGE_TRIM, b.height, EDGE_TRIM)
        dummy.updateMatrix()
        trimMesh.current.setMatrixAt(idx, dummy.matrix)
        trimMesh.current.setColorAt(idx, color)
        idx++
      })
    })
    trimMesh.current.instanceMatrix.needsUpdate = true
    if (trimMesh.current.instanceColor) trimMesh.current.instanceColor.needsUpdate = true
  }, [buildings])

  useLayoutEffect(() => {
    if (!windowMesh.current || windows.length === 0) return
    const dummy = new THREE.Object3D()
    windows.forEach((w, i) => {
      dummy.position.set(w.x, w.y, w.z)
      dummy.rotation.set(0, w.rotationY, 0)
      dummy.scale.set(WINDOW_WIDTH, WINDOW_HEIGHT, 1)
      dummy.updateMatrix()
      windowMesh.current.setMatrixAt(i, dummy.matrix)
    })
    windowMesh.current.instanceMatrix.needsUpdate = true
  }, [windows])

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
        <mesh key={b.repoName} position={[b.x, b.height + 6, b.z]}>
          <cylinderGeometry args={[0.04, 0.04, 12, 6]} />
          <meshBasicMaterial color={b.color} toneMapped={false} transparent opacity={0.55} />
        </mesh>
      ))}
    </>
  )
}
