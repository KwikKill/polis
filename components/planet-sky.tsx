'use client'

import { Stars } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

const VERTEX_SHADER = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Nebula blobs are placed by *direction* (a dot product against a fixed unit
// vector), not by height/horizon like city-sky.tsx's gradient. That's the
// deliberate difference: this dome is viewed from an OrbitControls camera
// that circles the whole planet, from directly overhead to underneath, so
// there is no consistent "down" to anchor a horizon band to (that mismatch
// is exactly what made the old reused CitySky show a seam here). A
// direction-based blob has no such reference frame, it looks the same
// regardless of which way is "up" for the current orbit angle.
const FRAGMENT_SHADER = `
  varying vec3 vDir;
  uniform vec3 baseColor;
  uniform float uTime;

  vec3 rotY(vec3 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
  }

  float blob(vec3 dir, vec3 center, float size) {
    return smoothstep(size, 1.0, dot(dir, center));
  }

  void main() {
    // A slow drift so the nebula field isn't perfectly static, independent
    // of camera orbit (rotating the sample direction, not the geometry).
    vec3 dir = rotY(vDir, uTime * 0.004);

    vec3 col = baseColor;
    col += vec3(1.0, 0.0, 1.0) * blob(dir, normalize(vec3(0.5, 0.62, -0.32)), 0.55) * 0.5;
    col += vec3(0.541, 0.169, 0.886) * blob(dir, normalize(vec3(-0.7, -0.22, 0.5)), 0.5) * 0.4;
    col += vec3(1.0, 0.412, 0.706) * blob(dir, normalize(vec3(0.22, -0.8, 0.4)), 0.6) * 0.35;
    col += vec3(0.541, 0.169, 0.886) * blob(dir, normalize(vec3(-0.42, 0.52, 0.72)), 0.62) * 0.3;
    col += vec3(1.0, 0.0, 1.0) * blob(dir, normalize(vec3(0.8, 0.12, -0.52)), 0.65) * 0.28;
    col += vec3(0.224, 0.902, 1.0) * blob(dir, normalize(vec3(-0.58, -0.6, -0.32)), 0.86) * 0.09;

    gl_FragColor = vec4(col, 1.0);
  }
`

// The planet-scale replacement for city-sky.tsx's dome: same "recenter on
// the camera every frame" trick so it behaves like an infinitely far
// skybox, but built for a camera that orbits the whole sphere rather than
// one that always looks down at flat ground.
export default function PlanetSky() {
  const meshRef = useRef<THREE.Mesh>(null!)

  useFrame(({ camera, clock }) => {
    meshRef.current.position.copy(camera.position)
    ;(meshRef.current.material as THREE.ShaderMaterial).uniforms.uTime.value = clock.elapsedTime
  })

  const uniforms = useMemo(
    () => ({
      baseColor: { value: new THREE.Color('#06040f') },
      uTime: { value: 0 },
    }),
    [],
  )

  return (
    <>
      <mesh ref={meshRef} renderOrder={-1}>
        <sphereGeometry args={[280, 32, 16]} />
        <shaderMaterial
          side={THREE.BackSide}
          vertexShader={VERTEX_SHADER}
          fragmentShader={FRAGMENT_SHADER}
          uniforms={uniforms}
          toneMapped={false}
          fog={false}
          depthWrite={false}
        />
      </mesh>
      <Stars radius={260} depth={90} count={2400} factor={2} saturation={0} fade speed={0.35} />
    </>
  )
}
