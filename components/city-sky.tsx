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

const FRAGMENT_SHADER = `
  varying vec3 vDir;
  uniform vec3 zenithColor;
  uniform vec3 horizonColor;
  uniform vec3 glowColor;
  uniform float glowIntensity;

  void main() {
    float h = clamp(vDir.y, -1.0, 1.0);
    // The default camera pitches steeply downward, so the visible sky sits
    // entirely at h < 0 (looking at the lower half of the dome) — a
    // one-sided smoothstep/max(h,0) here clamps that whole region to a
    // single value instead of a gradient. Shift + normalize so the curve
    // works regardless of which way the camera is actually pitched.
    float t = clamp((h + 0.15) / 0.85, 0.0, 1.0);
    vec3 base = mix(horizonColor, zenithColor, pow(t, 1.4));
    // Light-pollution glow hugging the skyline, the same magenta as the
    // city's own neon — a tight band centered on true horizontal (h = 0),
    // not a wash across the whole visible sky.
    float glow = exp(-pow(h * 14.0, 2.0)) * glowIntensity;
    gl_FragColor = vec4(base + glowColor * glow, 1.0);
  }
`

// A gradient sky dome (deep violet zenith -> plum horizon) plus a magenta
// glow band standing in for city light pollution reflecting off smog/cloud,
// in the same theme-ghost register as the buildings and ground. Values are
// pushed past 1.0 and toneMapped=false so the horizon glow catches Bloom
// too, tying the sky into the same glow language as the neon buildings.
export default function CitySky() {
  const meshRef = useRef<THREE.Mesh>(null!)

  // The sphere is centered at the world origin, but OrbitControls moves the
  // camera far from it — at that offset the horizon ring (vDir.y ≈ 0)
  // projects as a thick, skewed band instead of a thin line. Recentering
  // the dome on the camera every frame makes it behave like a proper
  // "infinitely far" skybox regardless of orbit position.
  useFrame(({ camera }) => {
    meshRef.current.position.copy(camera.position)
  })

  const uniforms = useMemo(
    () => ({
      zenithColor: { value: new THREE.Color('#0a0714') },
      horizonColor: { value: new THREE.Color('#241040') },
      glowColor: { value: new THREE.Color('#ff2fd6') },
      glowIntensity: { value: 0.45 },
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
      <Stars radius={260} depth={80} count={1000} factor={2} saturation={0} fade speed={0.4} />
    </>
  )
}
