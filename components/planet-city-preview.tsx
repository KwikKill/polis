'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Building } from '@/lib/types'
import type { Vec3 } from '@/lib/planet-builder'

const UP = new THREE.Vector3(0, 1, 0)
const PREVIEW_COLOR = '#7ee8ff'

// A translucent ghost of the viewer's own buildings at a candidate spot —
// deliberately simplified (one flat-colored InstancedMesh, not the full
// BuildingField layer stack) so it reads clearly as "not committed yet"
// rather than a second full-detail city, and so it doesn't need opacity
// threaded through every one of BuildingField's several materials.
export default function PlanetCityPreview({
  buildings,
  candidate,
  radius,
}: {
  buildings: Building[]
  candidate: Vec3
  radius: number
}) {
  const mesh = useRef<THREE.InstancedMesh>(null!)

  const normal = useMemo(
    () => new THREE.Vector3(candidate[0], candidate[1], candidate[2]).normalize(),
    [candidate],
  )
  const position = useMemo(() => normal.clone().multiplyScalar(radius), [normal, radius])
  const quaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, normal), [normal])

  useLayoutEffect(() => {
    if (!mesh.current || buildings.length === 0) return
    const dummy = new THREE.Object3D()
    buildings.forEach((b, i) => {
      dummy.position.set(b.x, b.height / 2, b.z)
      dummy.scale.set(b.width, b.height, b.depth)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
    })
    mesh.current.instanceMatrix.needsUpdate = true
  }, [buildings])

  if (buildings.length === 0) return null

  return (
    <group position={position} quaternion={quaternion}>
      <instancedMesh ref={mesh} args={[undefined, undefined, buildings.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color={PREVIEW_COLOR}
          toneMapped={false}
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  )
}
