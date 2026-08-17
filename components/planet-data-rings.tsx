'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

// A thin flat annulus in the local XZ plane with angle-mapped UVs (u wraps
// once around the circle, v spans the ring's narrow width) rather than
// THREE.RingGeometry's default radial UV mapping, so a horizontally
// repeating texture reads as text scrolling around the circumference
// instead of being stretched from center to edge.
function buildRingGeometry(innerRadius: number, outerRadius: number, segments: number): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    positions.push(cos * innerRadius, 0, sin * innerRadius)
    uvs.push(i / segments, 0)
    positions.push(cos * outerRadius, 0, sin * outerRadius)
    uvs.push(i / segments, 1)
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2
    const b = i * 2 + 1
    const c = i * 2 + 2
    const d = i * 2 + 3
    indices.push(a, b, c, b, d, c)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

// A repeating strip of technical glyphs baked into a canvas, not real 3D
// text — the same monospace/binary/hex glyph language decrypt-text.tsx
// already established for the 2D UI's own decrypt effect, reused here
// rather than introducing a different alphabet (or borrowing kanji purely
// as decoration the way the original reference image did).
function buildGlyphTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.font = '600 42px ui-monospace, "SF Mono", Menlo, Consolas, monospace'
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  let x = 0
  while (x < canvas.width) {
    ctx.fillText(text, x, canvas.height / 2)
    x += ctx.measureText(text).width + 60
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// Canvas texture creation needs `document`, client-only — the ring
// geometry itself renders immediately, the texture attaches once a
// useEffect (mount-only, never runs during SSR) builds it.
function DataRing({
  innerRadius,
  outerRadius,
  tiltX,
  tiltZ,
  text,
  color,
  spin,
  scroll,
}: {
  innerRadius: number
  outerRadius: number
  tiltX: number
  tiltZ: number
  text: string
  color: string
  spin: number
  scroll: number
}) {
  const groupRef = useRef<THREE.Group>(null!)
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null)
  const reducedMotion = useRef(false)

  useEffect(() => {
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const created = buildGlyphTexture(text, color)
    setTexture(created)
    return () => created.dispose()
  }, [text, color])

  const geometry = useMemo(
    () => buildRingGeometry(innerRadius, outerRadius, 128),
    [innerRadius, outerRadius],
  )

  useFrame((_, delta) => {
    if (reducedMotion.current) return
    if (groupRef.current) groupRef.current.rotation.y += delta * spin
    if (texture) texture.offset.x -= delta * scroll
  })

  if (!texture) return null

  return (
    <group ref={groupRef} rotation={[tiltX, 0, tiltZ]}>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

// Two thin orbital rings beyond the halo, textured with scrolling
// technical readouts — the "data telemetry" analogue of Saturn's rings,
// tied to the same circuit-board-planet concept the ground shader already
// commits to. Purely decorative chrome: no raycasting, no placement logic,
// independent of the terrain/water rework in planet-surface.tsx.
export default function PlanetDataRings({ radius }: { radius: number }) {
  return (
    <>
      <DataRing
        innerRadius={radius * 1.32}
        outerRadius={radius * 1.35}
        tiltX={0.35}
        tiltZ={0.08}
        text="01001101 10110101   POLIS   01101100 00110101   SEC.09   "
        color="#ff2fd6"
        spin={0.02}
        scroll={0.04}
      />
      <DataRing
        innerRadius={radius * 1.52}
        outerRadius={radius * 1.545}
        tiltX={-0.22}
        tiltZ={0.5}
        text="NODE.04A2 // TRACE // NODE.04A2 // TRACE //   "
        color="#4de8ff"
        spin={-0.015}
        scroll={-0.03}
      />
    </>
  )
}
