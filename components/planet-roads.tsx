'use client'

import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import type { PlanetRoad } from '@/lib/types'

// Exactly ground.tsx's in-city ROAD_WIDTH/ROAD_HEIGHT (was 1.2/0.4 before,
// visibly wider than an in-city road for no real reason, an inter-city
// road is still a road). Sharing this width means the per-segment
// straight-box joints along a curved connection are also narrower, and so
// less forgiving of any angular kink between adjacent segments than the
// old wide version was, see buildPlanetRoads/buildFeatureDetour's own
// DETOUR_ARC_POINTS for the corresponding fix on the geometry side.
const ROAD_WIDTH = 0.55
const ROAD_HEIGHT = 0.05
const ROAD_COLOR = '#9d1fb8'

// Exactly ground.tsx's in-city SidewalkField dimensions too.
const SIDEWALK_WIDTH = 0.32
const SIDEWALK_HEIGHT = 0.035
const SIDEWALK_COLOR = '#4a4258'
const SIDEWALK_OFFSET = ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2 + 0.03

// Same instanced-box-per-segment idiom as the flat city's RoadField, but
// oriented in full 3D (outward normal at the segment as "up," rather than
// RoadField's flat-ground Y-only atan2 rotation) since planet roads aren't
// coplanar, each short segment approximates one curved great-circle-ish
// connection between two nearby cities (see buildPlanetRoads). A grey
// sidewalk strip on each side matches the in-city road's own look, an
// inter-city road with no shoulder read as a different, plainer kind of
// road instead of a continuation of the same street network.
export default function PlanetRoads({ roads }: { roads: PlanetRoad[] }) {
  const roadMesh = useRef<THREE.InstancedMesh>(null!)
  const sidewalkMesh = useRef<THREE.InstancedMesh>(null!)

  useLayoutEffect(() => {
    if (!roadMesh.current || roads.length === 0) return

    const dummy = new THREE.Object3D()
    const basis = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const start = new THREE.Vector3()
    const end = new THREE.Vector3()
    const mid = new THREE.Vector3()
    const up = new THREE.Vector3()
    const right = new THREE.Vector3()
    let sidewalkIdx = 0

    roads.forEach((r, i) => {
      start.set(r.x1, r.y1, r.z1)
      end.set(r.x2, r.y2, r.z2)
      mid.copy(start).add(end).multiplyScalar(0.5)
      up.copy(mid).normalize()

      const length = start.distanceTo(end)
      basis.lookAt(start, end, up)
      quaternion.setFromRotationMatrix(basis)
      right.setFromMatrixColumn(basis, 0)

      dummy.position.copy(mid)
      dummy.quaternion.copy(quaternion)
      dummy.scale.set(ROAD_WIDTH, ROAD_HEIGHT, Math.max(length, 0.01))
      dummy.updateMatrix()
      roadMesh.current.setMatrixAt(i, dummy.matrix)

      if (sidewalkMesh.current) {
        for (const side of [1, -1]) {
          dummy.position.copy(mid).addScaledVector(right, SIDEWALK_OFFSET * side)
          dummy.quaternion.copy(quaternion)
          dummy.scale.set(SIDEWALK_WIDTH, SIDEWALK_HEIGHT, Math.max(length, 0.01))
          dummy.updateMatrix()
          sidewalkMesh.current.setMatrixAt(sidewalkIdx, dummy.matrix)
          sidewalkIdx++
        }
      }
    })
    roadMesh.current.instanceMatrix.needsUpdate = true
    if (sidewalkMesh.current) sidewalkMesh.current.instanceMatrix.needsUpdate = true
  }, [roads])

  if (roads.length === 0) return null

  return (
    <>
      <instancedMesh ref={roadMesh} args={[undefined, undefined, roads.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={ROAD_COLOR} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={sidewalkMesh} args={[undefined, undefined, roads.length * 2]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={SIDEWALK_COLOR} toneMapped={false} />
      </instancedMesh>
    </>
  )
}
