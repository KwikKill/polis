'use client'

import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useState } from 'react'
import BuildingField from '@/components/building-field'
import Ground from '@/components/ground'
import type { Building, CityData } from '@/lib/types'

export default function CityScene({
  city,
  children,
}: {
  city: CityData
  children?: React.ReactNode
}) {
  const [hovered, setHovered] = useState<Building | null>(null)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })

  return (
    <div
      className="relative h-full w-full"
      onPointerMove={(e) => setPointer({ x: e.clientX, y: e.clientY })}
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [42, 34, 42], fov: 45, near: 0.1, far: 320 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#0a0714']} />
        <fogExp2 attach="fog" args={['#0a0714', 0.007]} />
        <ambientLight intensity={0.2} color="#4b2a6b" />
        <hemisphereLight args={['#2a1a40', '#050308', 0.35]} />

        <Ground buildings={city.buildings} />
        <BuildingField
          buildings={city.buildings}
          onHover={setHovered}
          onSelect={(b) => window.open(b.htmlUrl, '_blank', 'noopener,noreferrer')}
        />

        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minDistance={12}
          maxDistance={150}
          maxPolarAngle={Math.PI / 2 - 0.02}
          target={[0, 4, 0]}
        />

        <EffectComposer>
          <Bloom luminanceThreshold={0.25} luminanceSmoothing={0.9} intensity={1.1} mipmapBlur />
        </EffectComposer>
      </Canvas>

      {hovered && (
        <div
          className="polis-hud-panel pointer-events-none fixed z-10 max-w-xs px-3 py-2 text-xs"
          style={{ left: pointer.x + 16, top: pointer.y + 16 }}
        >
          <p className="polis-glow-text font-display text-sm">{hovered.repoName}</p>
          <p className="text-foreground/70">
            {hovered.language ?? 'Unknown'} · {hovered.stars}★ · {hovered.commits} commits
            {hovered.fork && ' · fork'}
            {hovered.stale && ' · dormant'}
          </p>
        </div>
      )}

      {children}
    </div>
  )
}
