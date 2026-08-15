'use client'

import { Billboard, Text } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import BuildingField from '@/components/building-field'
import Ground from '@/components/ground'
import { cityExtent } from '@/lib/city-builder'
import type { Building, PlanetCity as PlanetCityData } from '@/lib/types'

const UP = new THREE.Vector3(0, 1, 0)

// A city, unmodified, "stuck" onto a point on the planet's surface — its
// local origin sits at unitVector*radius, and the wrapping group is
// rotated so local +Y matches the outward normal there. BuildingField only
// ever reasons in each building's local x/z, so it works nested inside an
// arbitrarily positioned/rotated group without any changes of its own. No
// true per-building spherical curvature: each city's own extent is small
// relative to the planet radius, so a flat "sticker" reads correctly.
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
      />
      <Ground roads={city.roads} reflective={false} groundRadius={groundRadius} />
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
