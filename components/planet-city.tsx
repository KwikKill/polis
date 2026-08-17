'use client'

import { Billboard, Line, Text } from '@react-three/drei'
import { useMemo, useState } from 'react'
import * as THREE from 'three'
import BuildingField from '@/components/building-field'
import Ground from '@/components/ground'
import { cityExtent } from '@/lib/city-builder'
import { terrainRadius } from '@/lib/terrain'
import type { Building, PlanetCity as PlanetCityData } from '@/lib/types'

const UP = new THREE.Vector3(0, 1, 0)

// Corner-bracket reticle, the same motif .polis-hud-panel already draws in
// 2D (CSS corner gradients), rebuilt here as four short polylines so it can
// frame a city's floating username label in the 3D scene — a targeting-
// lock read when hovering a city, doubling as a hover indicator rather
// than being decoration with no function.
function CityReticle({ width, height }: { width: number; height: number }) {
  const hw = width / 2
  const hh = height / 2
  const arm = Math.min(2.2, Math.min(width, height) * 0.32)
  const corners: Array<Array<[number, number, number]>> = [
    [
      [-hw, hh - arm, 0],
      [-hw, hh, 0],
      [-hw + arm, hh, 0],
    ],
    [
      [hw - arm, hh, 0],
      [hw, hh, 0],
      [hw, hh - arm, 0],
    ],
    [
      [-hw, -hh + arm, 0],
      [-hw, -hh, 0],
      [-hw + arm, -hh, 0],
    ],
    [
      [hw, -hh + arm, 0],
      [hw, -hh, 0],
      [hw - arm, -hh, 0],
    ],
  ]
  return (
    <>
      {corners.map((points, i) => (
        <Line key={i} points={points} color="#4de8ff" lineWidth={1.6} transparent opacity={0.9} />
      ))}
    </>
  )
}

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
  isFocused = false,
}: {
  city: PlanetCityData
  radius: number
  suppressSelect: boolean
  onHover: (building: Building | null) => void
  /** Keyboard-focused via Tab (see planet-scene.tsx), independent of mouse
   * hover — the reticle below responds to either. */
  isFocused?: boolean
}) {
  const normal = useMemo(
    () => new THREE.Vector3(city.planetX, city.planetY, city.planetZ).normalize(),
    [city.planetX, city.planetY, city.planetZ],
  )
  // The city's own anchor point sits on the *true* terrain surface, not a
  // flat `radius` — matches the terrain-adjusted tangent point sphere-
  // curve.ts's helpers use internally, so everything inside this group
  // (buildings, ground, roads) lines up with where it actually sits rather
  // than floating above/sinking below by however much the terrain
  // deviates here.
  const position = useMemo(
    () => normal.clone().multiplyScalar(terrainRadius(normal.x, normal.y, normal.z, radius)),
    [normal, radius],
  )
  const quaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, normal), [normal])

  const groundRadius = useMemo(() => cityExtent(city.buildings), [city.buildings])
  const labelY = useMemo(
    () => Math.max(...city.buildings.map((b) => b.height), 0) + 8,
    [city.buildings],
  )
  const [isHovered, setIsHovered] = useState(false)

  return (
    <group
      position={position}
      quaternion={quaternion}
      onPointerOver={() => setIsHovered(true)}
      onPointerOut={() => setIsHovered(false)}
    >
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
        {/* Sibling of the Text, inside the *same* Billboard, not a second
            Billboard offset along the outer group's own local Y — that
            axis is the surface normal at this city's spot, whose on-screen
            "up-ness" varies with camera angle (near the sub-camera point
            it points almost straight at the camera, barely up on screen
            at all), so a second Billboard positioned along it drifted
            visibly off from the text for cities near screen-center. A
            Billboard's own local Y, once it's already facing the camera,
            reliably means "up on screen" the same way anchorY="bottom"
            already relies on for the text above, so the bracket now uses
            that same frame to stay actually centered on the label
            regardless of where the city sits. */}
        {(isHovered || isFocused) && (
          <group position={[0, 1.3, 0]}>
            <CityReticle width={Math.max(10, city.username.length * 1.9)} height={5} />
          </group>
        )}
      </Billboard>
    </group>
  )
}
