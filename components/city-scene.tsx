'use client'

import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useRef, useState } from 'react'
import AtmosphereParticles from '@/components/atmosphere-particles'
import BuildingField from '@/components/building-field'
import CitySky from '@/components/city-sky'
import Footer from '@/components/footer'
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
  // Not React state (see planet-scene.tsx's own version of this same fix):
  // a plain pointermove-driven state update re-renders this whole
  // component tree on every pixel of mouse movement, including while just
  // orbiting the camera. The tooltip below reads its position straight off
  // this ref instead, mutated directly in the handler, bypassing React.
  const tooltipRef = useRef<HTMLDivElement>(null)

  return (
    <div
      className="relative h-full w-full"
      onPointerMove={(e) => {
        if (tooltipRef.current) {
          tooltipRef.current.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 16}px)`
        }
      }}
    >
      <Canvas
        dpr={[1, 1.5]}
        // near=1 rather than the more permissive 0.1: OrbitControls' own
        // minDistance below (12) means the camera is never legitimately
        // closer than that to anything, so a smaller near plane bought
        // nothing but a worse near:far ratio — depth-buffer precision
        // degrades non-linearly with that ratio, and it was coarse enough
        // that the city ground's grid overlay (see ground.tsx's
        // CITY_GRID_* mesh, sitting only slightly above the reflective
        // floor) lost its z-fight against the floor and visibly vanished
        // once the camera moved far enough out.
        //
        // far=600, not the original 320: that was a *hard clip*, not a
        // precision issue — the ground plane is a flat 500x500 square
        // (250-unit half-extent from origin), OrbitControls lets the
        // camera get up to 150 units from its target and pitch to
        // maxPolarAngle (near-horizontal, grazing the ground), and at that
        // combination the camera-to-far-corner distance can reach roughly
        // 150 (camera-to-target, worst case near-horizontal) + ~4
        // (target's own y-offset) + 250*sqrt(2) (origin-to-corner) ≈ 508
        // units — comfortably past the old far=320, which is exactly why
        // parts of the ground plane were disappearing under wide, low-angle
        // views instead of just fading into fog like the rest of it.
        // far=600 clears that worst case with margin; fog (independent of
        // this value, computed per-fragment from real world distance) still
        // fades the far ground out naturally well before it, this only
        // stops it from being hard-clipped before fog gets the chance to.
        camera={{ position: [42, 34, 42], fov: 45, near: 1, far: 600 }}
        gl={{ antialias: true }}
      >
        <fogExp2 attach="fog" args={['#170a28', 0.007]} />
        <ambientLight intensity={0.2} color="#4b2a6b" />
        <hemisphereLight args={['#2a1a40', '#050308', 0.35]} />

        <CitySky />
        <Ground roads={city.roads} />
        <AtmosphereParticles />
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
          <Bloom luminanceThreshold={0.55} luminanceSmoothing={0.5} intensity={0.5} mipmapBlur />
        </EffectComposer>
      </Canvas>

      <div
        ref={tooltipRef}
        className="polis-hud-panel pointer-events-none fixed z-10 max-w-xs px-3 py-2 text-xs"
        style={{ left: 0, top: 0, display: hovered ? 'block' : 'none' }}
      >
        {hovered && (
          <>
            <p className="polis-glow-text font-display text-sm">{hovered.repoName}</p>
            <p className="text-data">
              {hovered.language ?? 'Unknown'} · {hovered.stars}★ · {hovered.commits} commits
              {hovered.fork && ' · fork'}
              {hovered.stale && ' · dormant'}
            </p>
          </>
        )}
      </div>

      <Footer />

      {children}
    </div>
  )
}
