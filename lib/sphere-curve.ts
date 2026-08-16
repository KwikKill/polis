import * as THREE from 'three'
import { terrainRadius } from '@/lib/terrain'

const UP = new THREE.Vector3(0, 1, 0)

// The three pieces every curved-surface consumer needs: which way is
// "outward" at the sticker's contact point, the sticker group's own
// orientation, and the sphere's current radius. Shared across Ground,
// BuildingField and PlanetFeatures rather than each declaring its own copy.
export interface SurfaceCurvature {
  normal: THREE.Vector3
  quaternion: THREE.Quaternion
  planetRadius: number
}

// Given a point in a tangent plane's local coordinates (the same local
// space used inside a <group position={normal*radius}
// quaternion={Quaternion.setFromUnitVectors(UP, normal)}> wrapper), return
// the corresponding point pulled onto the sphere's true curved surface, in
// absolute world space (i.e. still centered on the planet's own origin, not
// re-expressed relative to the sticker group). Used anywhere a curved point
// is needed *outside* of a per-sticker group's own transform, e.g. finding
// where a city's road network actually touches the sphere so an inter-city
// road can meet it there instead of just aiming at the city's center point.
// `fixedSurfaceRadius`, when given, skips the terrain lookup and pulls the
// point onto a perfect sphere of that exact radius instead — needed for
// lakes, which must render as flat water sitting at one elevation, not a
// puddle draped over every terrain wrinkle underneath it.
// The tangent contact point sits on the *true* (terrain-adjusted) surface
// at `normal`, not a flat `normal * planetRadius` — it's the point every
// caller's wrapping `<group position=...>` actually sits at (see
// planet-city.tsx / planet-features.tsx's useSurfaceTransform), so local
// coordinates built relative to it stay consistent with that group's own
// transform instead of drifting by however much the terrain deviates at
// that particular spot.
function terrainAnchor(normal: THREE.Vector3, planetRadius: number): THREE.Vector3 {
  return normal.clone().multiplyScalar(terrainRadius(normal.x, normal.y, normal.z, planetRadius))
}

export function curveWorldPoint(
  x: number,
  z: number,
  normal: THREE.Vector3,
  planetRadius: number,
  quaternion: THREE.Quaternion,
  fixedSurfaceRadius?: number,
): THREE.Vector3 {
  const tangentPoint = terrainAnchor(normal, planetRadius)
  const flatOffset = new THREE.Vector3(x, 0, z).applyQuaternion(quaternion)
  const flatWorld = tangentPoint.clone().add(flatOffset)
  const dir = flatWorld.normalize()
  const r = fixedSurfaceRadius ?? terrainRadius(dir.x, dir.y, dir.z, planetRadius)
  return dir.multiplyScalar(r)
}

// Same point, but converted back into the tangent plane's own local space,
// the same local space used inside a <group position={normal*radius}
// quaternion={Quaternion.setFromUnitVectors(UP, normal)}> wrapper, drops
// straight into existing per-vertex geometry without needing to bypass the
// group's transform. A flat local point increasingly diverges from the
// sphere as it moves away from the tangent contact point (became visible
// once features got large enough for the gap to show, edges "floating"
// above/below the surface); this undoes that by re-normalizing the
// corresponding world point and converting back to local space.
export function curveLocalPoint(
  x: number,
  z: number,
  normal: THREE.Vector3,
  planetRadius: number,
  quaternion: THREE.Quaternion,
  fixedSurfaceRadius?: number,
): THREE.Vector3 {
  const tangentPoint = terrainAnchor(normal, planetRadius)
  const curvedWorld = curveWorldPoint(x, z, normal, planetRadius, quaternion, fixedSurfaceRadius)
  return curvedWorld.sub(tangentPoint).applyQuaternion(quaternion.clone().invert())
}

// The per-instance analogue of curveLocalPoint, for InstancedMesh "dummy"
// placement (position + a tilt quaternion) instead of raw geometry
// vertices, used for props scattered across a city's footprint (building
// walls, trim, windows, roof clutter, roads, sidewalks, vehicles,
// streetlights) that each need their *own* corrected position and
// "standing up straight" orientation, not just the single shared
// tangent-plane quaternion the whole city group uses. Without this, a prop
// out near a large city's edge both floats off the true surface (the same
// gap curveLocalPoint fixes for the ground disc) *and* stands tilted at
// the city-center's normal instead of its own, most visible for the
// biggest cities, where extent is no longer negligible next to the
// planet's radius.
export interface CurvedPlacement {
  position: THREE.Vector3
  tiltQuaternion: THREE.Quaternion
}

export function curvedLocalPlacement(
  x: number,
  y: number,
  z: number,
  normal: THREE.Vector3,
  planetRadius: number,
  quaternion: THREE.Quaternion,
): CurvedPlacement {
  const tangentPoint = terrainAnchor(normal, planetRadius)
  const flatOffset = new THREE.Vector3(x, 0, z).applyQuaternion(quaternion)
  const flatWorld = tangentPoint.clone().add(flatOffset)
  const worldUp = flatWorld.clone().normalize()
  const curvedWorld = worldUp
    .clone()
    .multiplyScalar(terrainRadius(worldUp.x, worldUp.y, worldUp.z, planetRadius))
  const inverseQuaternion = quaternion.clone().invert()

  const localBase = curvedWorld.clone().sub(tangentPoint).applyQuaternion(inverseQuaternion)
  const localUp = worldUp.applyQuaternion(inverseQuaternion)
  const tiltQuaternion = new THREE.Quaternion().setFromUnitVectors(UP, localUp)
  const position = localBase.addScaledVector(localUp, y)

  return { position, tiltQuaternion }
}

// A disc built from curved vertices instead of CircleGeometry's flat ones
//, the ground plate under a city, following the planet's true curvature
// instead of the flat tangent plane.
export function buildCurvedDiscGeometry(
  discRadius: number,
  planetRadius: number,
  normal: THREE.Vector3,
  quaternion: THREE.Quaternion,
  segments = 32,
): THREE.BufferGeometry {
  const positions: number[] = [0, 0, 0]
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const curved = curveLocalPoint(
      Math.cos(angle) * discRadius,
      Math.sin(angle) * discRadius,
      normal,
      planetRadius,
      quaternion,
    )
    positions.push(curved.x, curved.y, curved.z)
  }

  const indices: number[] = []
  for (let i = 1; i <= segments; i++) indices.push(0, i, i + 1)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

// Same idea from an arbitrary (possibly irregular) outline of local (x, z)
// points around a center, rather than a perfect circle, used for the
// lakes' non-circular shoreline.
export function buildCurvedFanGeometry(
  outline: Array<[number, number]>,
  planetRadius: number,
  normal: THREE.Vector3,
  quaternion: THREE.Quaternion,
  fixedSurfaceRadius?: number,
): THREE.BufferGeometry {
  const curved = outline.map(([x, z]) =>
    curveLocalPoint(x, z, normal, planetRadius, quaternion, fixedSurfaceRadius),
  )

  // Re-sort by each point's *own* angle after curving, not the angle it
  // was generated at. curveLocalPoint's tangent-plane-to-sphere
  // projection is only close to linear near the tangent point; for a
  // large enough outline (a big lake), the distortion far from center can
  // reorder points enough that the pre-curve angular order no longer
  // matches their true position around the local up axis — a fan built
  // from the stale order then has crossing triangles (visible as a
  // jagged, z-fighting mess where they overlap). Re-deriving the order
  // from the curved positions themselves keeps the fan valid regardless
  // of how much the projection distorted the shape.
  const ordered = curved
    .map((p) => ({ p, angle: Math.atan2(p.z, p.x) }))
    .sort((a, b) => a.angle - b.angle)

  const positions: number[] = [0, 0, 0]
  for (const { p } of ordered) positions.push(p.x, p.y, p.z)

  const n = ordered.length
  const indices: number[] = []
  for (let i = 0; i < n; i++) indices.push(0, 1 + i, 1 + ((i + 1) % n))

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
