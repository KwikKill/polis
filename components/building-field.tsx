'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Building } from '@/lib/types'

const FORK_CAP_HEIGHT = 0.4

interface BuildingFieldProps {
  buildings: Building[]
  onHover: (building: Building | null) => void
  onSelect: (building: Building) => void
}

// Bloom (see city-scene.tsx) reacts to raw pixel luminance, not a material's
// `emissive` channel specifically — so "glow" here just means pushing the
// instance color past 1.0 with toneMapped=false, not literal emissive maps.
function glowColor(base: string, intensity: number): THREE.Color {
  const color = new THREE.Color(base)
  color.multiplyScalar(0.4 + intensity * 2.4)
  return color
}

export default function BuildingField({ buildings, onHover, onSelect }: BuildingFieldProps) {
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const forkMesh = useRef<THREE.InstancedMesh>(null!)
  const landmarks = useMemo(() => buildings.filter((b) => b.landmark), [buildings])
  const forks = useMemo(() => buildings.filter((b) => b.fork), [buildings])

  useLayoutEffect(() => {
    if (!mesh.current) return
    const dummy = new THREE.Object3D()
    buildings.forEach((b, i) => {
      dummy.position.set(b.x, b.height / 2, b.z)
      dummy.scale.set(b.width, b.height, b.depth)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
      mesh.current.setColorAt(i, glowColor(b.color, b.intensity))
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

  return (
    <>
      <instancedMesh
        ref={mesh}
        args={[undefined, undefined, buildings.length]}
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
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial toneMapped={false} roughness={0.35} metalness={0.15} />
      </instancedMesh>

      {/* Forks get a small "prefab" cap — a modular block bolted on top,
          distinct from an original repo's clean single volume. */}
      {forks.length > 0 && (
        <instancedMesh ref={forkMesh} args={[undefined, undefined, forks.length]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#cfd8ff" toneMapped={false} roughness={0.7} />
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
