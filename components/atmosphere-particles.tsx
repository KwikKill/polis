'use client'

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

const PARTICLE_COUNT = 450
const FALL_SPEED_MIN = 0.35
const FALL_SPEED_MAX = 0.9
const SWAY_SPEED_MIN = 0.3
const SWAY_SPEED_MAX = 0.7
const SWAY_AMOUNT = 0.6
const PARTICLE_COLOR = new THREE.Color('#bcd6ff')

const VERTEX = `
  attribute float aSize;
  attribute float aSeed;
  varying float vSeed;
  void main() {
    vSeed = aSeed;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (220.0 / max(-mvPosition.z, 1.0));
    gl_Position = projectionMatrix * mvPosition;
  }
`

const FRAGMENT = `
  uniform vec3 particleColor;
  varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, d);
    float twinkle = 0.7 + 0.3 * sin(vSeed * 37.0);
    gl_FragColor = vec4(particleColor * glow * twinkle, glow * 0.55);
  }
`

// A slow drift of fine glowing dust between the towers, the middle
// distance city-scene.tsx otherwise has nothing occupying: the wet-street
// reflective floor already implies weather, but nothing was actually
// moving through the air above it. Positions are mutated directly in a
// typed array each frame (the same "own the buffer, skip React" idiom
// road/streetlight instancing already uses here), not per-particle React
// state, so a few hundred of these cost one draw call and no
// re-rendering.
//
// Deliberately scoped to the single-city page only, not the planet view:
// every city on the planet already renders at full detail (an explicit
// standing decision, see planet-city.tsx) — adding a few hundred extra
// points per city there would multiply this exact cost by city count,
// working directly against the perf pass that was just done.
export default function AtmosphereParticles({
  radius = 60,
  height = 45,
}: {
  radius?: number
  height?: number
}) {
  const pointsRef = useRef<THREE.Points>(null!)

  const { positions, sizes, seeds, speeds, swayPhases, swaySpeeds, baseX, baseZ } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3)
    const sizes = new Float32Array(PARTICLE_COUNT)
    const seeds = new Float32Array(PARTICLE_COUNT)
    const speeds = new Float32Array(PARTICLE_COUNT)
    const swayPhases = new Float32Array(PARTICLE_COUNT)
    const swaySpeeds = new Float32Array(PARTICLE_COUNT)
    const baseX = new Float32Array(PARTICLE_COUNT)
    const baseZ = new Float32Array(PARTICLE_COUNT)

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * radius
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      baseX[i] = x
      baseZ[i] = z
      positions[i * 3] = x
      positions[i * 3 + 1] = Math.random() * height
      positions[i * 3 + 2] = z
      sizes[i] = 1.2 + Math.random() * 2.2
      seeds[i] = Math.random() * 100
      speeds[i] = FALL_SPEED_MIN + Math.random() * (FALL_SPEED_MAX - FALL_SPEED_MIN)
      swayPhases[i] = Math.random() * Math.PI * 2
      swaySpeeds[i] = SWAY_SPEED_MIN + Math.random() * (SWAY_SPEED_MAX - SWAY_SPEED_MIN)
    }

    return { positions, sizes, seeds, speeds, swayPhases, swaySpeeds, baseX, baseZ }
  }, [radius, height])

  useFrame((_, delta) => {
    const posAttr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute
    const arr = posAttr.array as Float32Array
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let y = arr[i * 3 + 1] - speeds[i] * delta
      if (y < 0) y += height
      arr[i * 3 + 1] = y

      swayPhases[i] += delta * swaySpeeds[i]
      arr[i * 3] = baseX[i] + Math.sin(swayPhases[i]) * SWAY_AMOUNT
      arr[i * 3 + 2] = baseZ[i] + Math.cos(swayPhases[i] * 0.8) * SWAY_AMOUNT
    }
    posAttr.needsUpdate = true
  })

  const uniforms = useMemo(() => ({ particleColor: { value: PARTICLE_COLOR } }), [])

  return (
    <points ref={pointsRef} raycast={() => null}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  )
}
