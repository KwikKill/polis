'use client'

import { Billboard, Text } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import BuildingField from '@/components/building-field'
import Ground from '@/components/ground'
import { cityExtent } from '@/lib/city-builder'
import type { Building, PlanetCity as PlanetCityData } from '@/lib/types'

const UP = new THREE.Vector3(0, 1, 0)

// A city, "stuck" onto a point on the planet's surface, its local origin
// sits at unitVector*radius, and the wrapping group is rotated so local +Y
// matches the outward normal there. Both BuildingField and Ground get the
// same `curvature` (this city's own normal/quaternion/radius), so every
// wall, road, sidewalk, vehicle and streetlight is individually pulled onto
// the sphere's true surface and tilted to stand normal to it there, instead
// of all inheriting one flat tangent-plane orientation shared by the whole
// city, at real planet scale a big city's own extent is no longer
// negligible next to the planet's radius, so that flat approximation showed
// up as buildings/roads visibly floating off the surface near a city's
// edge, not just the ground disc beneath them.
export default function PlanetCity({
  city,
  radius,
  suppressSelect,
  onHover,
}: {
  city: PlanetCityData
  radius: number
  suppressSelect: boolean
  onHover: (building: Building | null) => void
}) {
  const normal = useMemo(
    () => new THREE.Vector3(city.planetX, city.planetY, city.planetZ).normalize(),
    [city.planetX, city.planetY, city.planetZ],
  )
  const position = useMemo(() => normal.clone().multiplyScalar(radius), [normal, radius])
  const quaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, normal), [normal])

  const groundRadius = useMemo(() => cityExtent(city.buildings), [city.buildings])
  const labelY = useMemo(
    () => Math.max(...city.buildings.map((b) => b.height), 0) + 8,
    [city.buildings],
  )

  return (
    <group position={position} quaternion={quaternion}>
      <BuildingField
        buildings={city.buildings}
        onHover={onHover}
        onSelect={
          suppressSelect
            ? () => {}
            : (b) => window.open(b.htmlUrl, '_blank', 'noopener,noreferrer')
        }
        curvature={{ normal, quaternion, planetRadius: radius }}
      />
      <Ground
        roads={city.roads}
        reflective={false}
        groundRadius={groundRadius}
        curvature={{ normal, quaternion, planetRadius: radius }}
      />
      {/* Nested inside the already-rotated group, so its local up already
          points radially outward at this city's own surface point. */}
      <Billboard position={[0, labelY, 0]}>
        <Text
          fontSize={2.2}
          color="#ff2fd6"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.06}
          outlineColor="#0a0714"
        >
          {city.username}
        </Text>
      </Billboard>
    </group>
  )
}
