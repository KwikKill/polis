'use client'

import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import type { PlanetRoad } from '@/lib/types'

const ROAD_WIDTH = 1.2
const ROAD_HEIGHT = 0.4
const ROAD_COLOR = '#9d1fb8'

// Same instanced-box-per-segment idiom as the flat city's RoadField, but
// oriented in full 3D (outward normal at the segment as "up," rather than
// RoadField's flat-ground Y-only atan2 rotation) since planet roads aren't
// coplanar — each short segment approximates one curved great-circle-ish
// connection between two nearby cities (see buildPlanetRoads).
export default function PlanetRoads({ roads }: { roads: PlanetRoad[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null!)

  useLayoutEffect(() => {
    if (!mesh.current || roads.length === 0) return

    const dummy = new THREE.Object3D()
    const basis = new THREE.Matrix4()
    const start = new THREE.Vector3()
    const end = new THREE.Vector3()
    const mid = new THREE.Vector3()
    const up = new THREE.Vector3()

    roads.forEach((r, i) => {
      start.set(r.x1, r.y1, r.z1)
      end.set(r.x2, r.y2, r.z2)
      mid.copy(start).add(end).multiplyScalar(0.5)
      up.copy(mid).normalize()

      const length = start.distanceTo(end)
      basis.lookAt(start, end, up)

      dummy.position.copy(mid)
      dummy.quaternion.setFromRotationMatrix(basis)
      dummy.scale.set(ROAD_WIDTH, ROAD_HEIGHT, Math.max(length, 0.01))
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
    })
    mesh.current.instanceMatrix.needsUpdate = true
  }, [roads])

  if (roads.length === 0) return null

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, roads.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={ROAD_COLOR} toneMapped={false} />
    </instancedMesh>
  )
}
