import * as THREE from 'three'

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
