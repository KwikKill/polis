'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { cityExtent } from '@/lib/city-builder'
import type { Building } from '@/lib/types'
import type { Vec3 } from '@/lib/planet-builder'

const UP = new THREE.Vector3(0, 1, 0)
const PREVIEW_COLOR = '#7ee8ff'
const INVALID_COLOR = '#ff4d5e'

const GRID_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Same fwidth-based line technique planet-surface.tsx's own circuit grid
// already uses, applied to a flat disc's local UV instead of lon/lat — a
// faint fill wash plus brighter grid lines, both in the ghost's own cyan,
// so the preview reads as "a real plot of ground," not buildings floating
// with nothing under them.
const GRID_FRAGMENT = `
  varying vec2 vUv;
  uniform vec3 gridColor;
  uniform float discRadius;

  void main() {
    vec2 p = (vUv - 0.5) * 2.0 * discRadius;
    float spacing = 3.0;
    vec2 c = p / spacing;
    vec2 d = fwidth(c) + 1e-4;
    vec2 gridLine = 1.0 - clamp(abs(fract(c - 0.5) - 0.5) / d, 0.0, 1.0);
    float line = max(gridLine.x, gridLine.y);
    gl_FragColor = vec4(gridColor, max(line * 0.55, 0.06));
  }
`

// A translucent ghost of the viewer's own buildings at a candidate spot,
// deliberately simplified (one flat-colored InstancedMesh, not the full
// BuildingField layer stack) so it reads clearly as "not committed yet"
// rather than a second full-detail city, and so it doesn't need opacity
// threaded through every one of BuildingField's several materials. The
// ground disc below is similarly simplified: a flat circle, not the real
// curved/reflective Ground, just enough to show the footprint and grid.
//
// Renders even when `valid` is false (turning red instead of cyan) — a
// rejected click used to just show a text error with nothing at the spot
// itself, this puts the actual footprint down so it's obvious *why* a
// click was too tight, not just that it was.
export default function PlanetCityPreview({
  buildings,
  candidate,
  radius,
  valid = true,
}: {
  buildings: Building[]
  candidate: Vec3
  radius: number
  valid?: boolean
}) {
  const mesh = useRef<THREE.InstancedMesh>(null!)

  const normal = useMemo(
    () => new THREE.Vector3(candidate[0], candidate[1], candidate[2]).normalize(),
    [candidate],
  )
  const position = useMemo(() => normal.clone().multiplyScalar(radius), [normal, radius])
  const quaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, normal), [normal])
  const groundRadius = useMemo(() => cityExtent(buildings), [buildings])
  const tint = valid ? PREVIEW_COLOR : INVALID_COLOR

  const gridUniforms = useMemo(
    () => ({
      gridColor: { value: new THREE.Color(tint) },
      discRadius: { value: groundRadius },
    }),
    [groundRadius, tint],
  )

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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[groundRadius, 48]} />
        <shaderMaterial
          vertexShader={GRID_VERTEX}
          fragmentShader={GRID_FRAGMENT}
          uniforms={gridUniforms}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <instancedMesh ref={mesh} args={[undefined, undefined, buildings.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color={tint}
          toneMapped={false}
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  )
}
