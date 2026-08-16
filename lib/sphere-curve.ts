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
// The tangent contact point sits on the *true* (terrain-adjusted) surface
// at `normal`, not a flat `normal * planetRadius` — it's the point every
// caller's wrapping `<group position=...>` actually sits at (see
// planet-city.tsx / planet-features.tsx's useSurfaceTransform), so local
// coordinates built relative to it stay consistent with that group's own
// transform instead of drifting by however much the terrain deviates at
// that particular spot.
//
// This is a flat tangent-plane ("gnomonic") projection, which is only
// close to linear near its own contact point — fine for buildings, roads,
// and other props that stay small relative to the planet, but it distorts
// severely far from center. Large sphere-hugging shapes (lakes/oceans,
// see buildSphericalCapFanGeometry below) need a projection that stays
// exact regardless of size, not this one.
function terrainAnchor(normal: THREE.Vector3, planetRadius: number): THREE.Vector3 {
  return normal.clone().multiplyScalar(terrainRadius(normal.x, normal.y, normal.z, planetRadius))
}

export function curveWorldPoint(
  x: number,
  z: number,
  normal: THREE.Vector3,
  planetRadius: number,
  quaternion: THREE.Quaternion,
): THREE.Vector3 {
  const tangentPoint = terrainAnchor(normal, planetRadius)
  const flatOffset = new THREE.Vector3(x, 0, z).applyQuaternion(quaternion)
  const flatWorld = tangentPoint.clone().add(flatOffset)
  const dir = flatWorld.normalize()
  const r = terrainRadius(dir.x, dir.y, dir.z, planetRadius)
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
): THREE.Vector3 {
  const tangentPoint = terrainAnchor(normal, planetRadius)
  const curvedWorld = curveWorldPoint(x, z, normal, planetRadius, quaternion)
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

// A point at true angular distance `angularRadius` (radians) from
// `center` (a unit vector), in the direction `azimuth` — exact spherical
// polar coordinates, via Rodrigues' rotation formula, rather than a flat
// tangent-plane projection. This is what a lake/ocean's shoreline needs:
// curveWorldPoint's gnomonic projection is only accurate close to its own
// contact point, and a large enough shape (tried up to ~22% of planet
// radius) gets distorted enough to reorder points and self-intersect —
// confirmed directly (forcing a small fixed size made the artifact
// disappear, restoring the real size reproduced it identically,
// regardless of triangulation order). Rotating the center point by an
// exact angle stays exact for any size up to just under a hemisphere, no
// distortion to accumulate in the first place.
function sphericalCapPoint(center: THREE.Vector3, angularRadius: number, azimuth: number): THREE.Vector3 {
  const arbitraryUp = Math.abs(center.y) < 0.99 ? UP : new THREE.Vector3(1, 0, 0)
  const tangentA = arbitraryUp.clone().cross(center).normalize()
  const tangentB = center.clone().cross(tangentA)
  const direction = tangentA
    .clone()
    .multiplyScalar(Math.cos(azimuth))
    .addScaledVector(tangentB, Math.sin(azimuth))
  const axis = center.clone().cross(direction).normalize()
  return center.clone().applyAxisAngle(axis, angularRadius)
}

// A flat cap (fixed distance from planet center) built from true angular
// polar coordinates around `center` — the lake/ocean shoreline geometry,
// replacing the old flat-outline `buildCurvedFanGeometry`. `angularRadiusAt`
// gives the (possibly wobbling) angular radius at each azimuth; points come
// out already in true azimuth order by construction, no post-hoc re-sort
// needed the way the old tangent-plane version required. Builds directly
// in absolute world space (not a sticker group's local space) since there's
// no flat tangent plane involved at all here.
export function buildSphericalCapFanGeometry(
  center: THREE.Vector3,
  angularRadiusAt: (azimuth: number) => number,
  segments: number,
  surfaceRadius: number,
): THREE.BufferGeometry {
  const positions: number[] = [center.x * surfaceRadius, center.y * surfaceRadius, center.z * surfaceRadius]
  for (let i = 0; i < segments; i++) {
    const azimuth = (i / segments) * Math.PI * 2
    const p = sphericalCapPoint(center, angularRadiusAt(azimuth), azimuth)
    positions.push(p.x * surfaceRadius, p.y * surfaceRadius, p.z * surfaceRadius)
  }

  const indices: number[] = []
  for (let i = 0; i < segments; i++) indices.push(0, 1 + i, 1 + ((i + 1) % segments))

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
