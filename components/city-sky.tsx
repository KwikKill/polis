'use client'

import { Stars } from '@react-three/drei'
import { useMemo } from 'react'
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
    vec3 base = mix(horizonColor, zenithColor, smoothstep(0.0, 0.9, h));
    // Light-pollution glow hugging the skyline, the same magenta as the
    // city's own neon — brightest right at the horizon, gone by mid-sky.
    float glow = exp(-pow(max(h, 0.0) * 6.0, 2.0)) * glowIntensity;
    gl_FragColor = vec4(base + glowColor * glow, 1.0);
  }
`

// A gradient sky dome (deep violet zenith -> plum horizon) plus a magenta
// glow band standing in for city light pollution reflecting off smog/cloud,
// in the same theme-ghost register as the buildings and ground. Values are
// pushed past 1.0 and toneMapped=false so the horizon glow catches Bloom
// too, tying the sky into the same glow language as the neon buildings.
export default function CitySky() {
  const uniforms = useMemo(
    () => ({
      zenithColor: { value: new THREE.Color('#0a0714') },
      horizonColor: { value: new THREE.Color('#241040') },
      glowColor: { value: new THREE.Color('#ff2fd6') },
      glowIntensity: { value: 2 },
    }),
    [],
  )

  return (
    <>
      <mesh renderOrder={-1}>
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
