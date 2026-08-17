'use client'

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

const VERTEX = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// A self-contained GLSL value-noise fbm, not the baked terrain heightmap —
// clouds have no placement/routing logic depending on them (unlike land
// vs. ocean), so there's no "must match a JS source of truth" constraint
// here, a cheap procedural pattern is the simpler, correct choice.
const FRAGMENT = `
  varying vec3 vDir;
  uniform float uTime;
  uniform vec3 cloudColor;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
          mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
          mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z
    );
  }

  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * noise(p);
      p *= 2.02;
      amp *= 0.5;
    }
    return sum;
  }

  vec3 rotY(vec3 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
  }

  void main() {
    // Rotating the *sample direction*, not the geometry, same drift trick
    // planet-sky.tsx's nebula already uses, keeps this artifact-free
    // regardless of camera orbit.
    vec3 dir = rotY(vDir, uTime * 0.015);
    float n = fbm(dir * 2.6);
    float coverage = smoothstep(0.42, 0.7, n);
    gl_FragColor = vec4(cloudColor, coverage * 0.03);
  }
`

// A thin, slowly-drifting translucent shell between the planet's own
// surface (and halo) and the outer data rings — the "atmosphere" this
// scene previously had none of: the sky dome's nebula is effectively
// infinitely far away, and the halo is a barely-there fresnel glow right
// at the surface, nothing occupied the middle distance.
export default function PlanetClouds({ radius }: { radius: number }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null!)

  useFrame(({ clock }) => {
    materialRef.current.uniforms.uTime.value = clock.elapsedTime
  })

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      cloudColor: { value: new THREE.Color('#4de8ff') },
    }),
    [],
  )

  return (
    <mesh raycast={() => null} scale={1.07}>
      <sphereGeometry args={[radius, 64, 40]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        toneMapped={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}
