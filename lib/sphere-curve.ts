import * as THREE from 'three'

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
// the corresponding point pulled onto the sphere's true curved surface,
// still expressed in that same local space — drops straight into existing
// per-vertex geometry without needing to bypass the group's transform. A
// flat local point increasingly diverges from the sphere as it moves away
// from the tangent contact point (became visible once features got large
// enough for the gap to show, edges "floating" above/below the surface);
// this undoes that by re-normalizing the corresponding world point and
// converting back to local space.
export function curveLocalPoint(
  x: number,
  z: number,
  normal: THREE.Vector3,
  planetRadius: number,
  quaternion: THREE.Quaternion,
): THREE.Vector3 {
  const tangentPoint = normal.clone().multiplyScalar(planetRadius)
  const flatOffset = new THREE.Vector3(x, 0, z).applyQuaternion(quaternion)
  const flatWorld = tangentPoint.clone().add(flatOffset)
  const curvedWorld = flatWorld.normalize().multiplyScalar(planetRadius)
  return curvedWorld.sub(tangentPoint).applyQuaternion(quaternion.clone().invert())
}

// The per-instance analogue of curveLocalPoint, for InstancedMesh "dummy"
// placement (position + a tilt quaternion) instead of raw geometry
// vertices — used for props scattered across a city's footprint (building
// walls, trim, windows, roof clutter, roads, sidewalks, vehicles,
// streetlights) that each need their *own* corrected position and
// "standing up straight" orientation, not just the single shared
// tangent-plane quaternion the whole city group uses. Without this, a prop
// out near a large city's edge both floats off the true surface (the same
// gap curveLocalPoint fixes for the ground disc) *and* stands tilted at
// the city-center's normal instead of its own — most visible for the
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
  const tangentPoint = normal.clone().multiplyScalar(planetRadius)
  const flatOffset = new THREE.Vector3(x, 0, z).applyQuaternion(quaternion)
  const flatWorld = tangentPoint.clone().add(flatOffset)
  const worldUp = flatWorld.clone().normalize()
  const curvedWorld = worldUp.clone().multiplyScalar(planetRadius)
  const inverseQuaternion = quaternion.clone().invert()

  const localBase = curvedWorld.clone().sub(tangentPoint).applyQuaternion(inverseQuaternion)
  const localUp = worldUp.applyQuaternion(inverseQuaternion)
  const tiltQuaternion = new THREE.Quaternion().setFromUnitVectors(UP, localUp)
  const position = localBase.addScaledVector(localUp, y)

  return { position, tiltQuaternion }
}

// A disc built from curved vertices instead of CircleGeometry's flat ones
// — the ground plate under a city, following the planet's true curvature
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
// points around a center, rather than a perfect circle — used for the
// lakes' non-circular shoreline.
export function buildCurvedFanGeometry(
  outline: Array<[number, number]>,
  planetRadius: number,
  normal: THREE.Vector3,
  quaternion: THREE.Quaternion,
): THREE.BufferGeometry {
  const positions: number[] = [0, 0, 0]
  for (const [x, z] of outline) {
    const curved = curveLocalPoint(x, z, normal, planetRadius, quaternion)
    positions.push(curved.x, curved.y, curved.z)
  }

  const n = outline.length
  const indices: number[] = []
  for (let i = 0; i < n; i++) indices.push(0, 1 + i, 1 + ((i + 1) % n))

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
