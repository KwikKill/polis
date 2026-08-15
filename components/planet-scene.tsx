'use client'

import { OrbitControls } from '@react-three/drei'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import CitySky from '@/components/city-sky'
import Footer from '@/components/footer'
import PlanetCity from '@/components/planet-city'
import PlanetCityPreview from '@/components/planet-city-preview'
import PlanetFeatures from '@/components/planet-features'
import PlanetRoads from '@/components/planet-roads'
import { cityExtent } from '@/lib/city-builder'
import { isValidPlacement, type PlacedCity, type Vec3 } from '@/lib/planet-builder'
import { relocateCity } from '@/lib/planet-service'
import type { Building, PlanetCity as PlanetCityData, PlanetRoad } from '@/lib/types'

export default function PlanetScene({
  cities,
  radius,
  roads,
  viewerUsername,
  children,
}: {
  cities: PlanetCityData[]
  radius: number
  roads: PlanetRoad[]
  viewerUsername: string | null
  children?: React.ReactNode
}) {
  const router = useRouter()
  const [hovered, setHovered] = useState<Building | null>(null)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })
  const [placementMode, setPlacementMode] = useState(false)
  const [previewCandidate, setPreviewCandidate] = useState<Vec3 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const ownCity = useMemo(
    () =>
      viewerUsername
        ? (cities.find((c) => c.username.toLowerCase() === viewerUsername.toLowerCase()) ?? null)
        : null,
    [cities, viewerUsername],
  )

  const otherCities = useMemo(
    (): PlacedCity[] =>
      cities
        .filter((c) => c.username.toLowerCase() !== viewerUsername?.toLowerCase())
        .map((c) => ({
          position: [c.planetX, c.planetY, c.planetZ] as Vec3,
          extent: cityExtent(c.buildings),
        })),
    [cities, viewerUsername],
  )

  const ownExtent = useMemo(() => (ownCity ? cityExtent(ownCity.buildings) : 0), [ownCity])

  // The same OrbitControls setup as atlas's globe (components/enhanced-
  // globe.tsx in the atlas project): plain orbit around the sphere's true
  // center (the default `target`, never overridden), no pan, distance
  // clamped to a margin just above the surface up to a few radii out.
  // Atlas starts pulled back at 3x its fixed radius (camera.position.z =
  // 300 against a radius-100 Earth) rather than hugging the surface —
  // ported here as the same ratio scaled to the current planetRadius,
  // since a fixed close offset was the earlier design and specifically
  // what read as broken.
  const initialCameraPosition: [number, number, number] = [radius, radius * 2, radius * 2]

  function handlePlanetClick(e: ThreeEvent<MouseEvent>) {
    if (!placementMode || pending) return
    e.stopPropagation()

    const len = Math.hypot(e.point.x, e.point.y, e.point.z)
    if (len < 1e-6) return
    const candidate: Vec3 = [e.point.x / len, e.point.y / len, e.point.z / len]

    // Instant client-side feedback using the same pure function and
    // positions already in props — the server re-validates authoritatively
    // regardless inside relocateCity's transaction, this check is UX only.
    if (!isValidPlacement(candidate, ownExtent, otherCities, radius)) {
      setError('Too close to another city or a natural feature — try a different spot.')
      return
    }

    setError(null)
    setPreviewCandidate(candidate)
  }

  function confirmMove() {
    if (!previewCandidate || pending) return
    startTransition(async () => {
      const result = await relocateCity(previewCandidate)
      if (result.ok) {
        setPlacementMode(false)
        setPreviewCandidate(null)
        router.refresh()
      } else {
        setError(result.error)
        setPreviewCandidate(null)
      }
    })
  }

  function cancelMove() {
    setPlacementMode(false)
    setPreviewCandidate(null)
    setError(null)
  }

  return (
    <div
      className="relative h-full w-full"
      onPointerMove={(e) => setPointer({ x: e.clientX, y: e.clientY })}
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{
          position: initialCameraPosition,
          fov: 45,
          near: 0.1,
          far: radius * 8,
        }}
        gl={{ antialias: true }}
      >
        {/* Density scales as ~1/radius, not a fixed value — atlas's orbit
            camera ranges from just above the surface out to several planet
            radii, unlike the earlier fixed close-up framing this replaced,
            so a flat density either does nothing up close or fogs out the
            entire planet from the default pulled-back view. */}
        <fogExp2 attach="fog" args={['#170a28', 0.3 / radius]} />
        <ambientLight intensity={0.22} color="#4b2a6b" />
        <hemisphereLight args={['#2a1a40', '#050308', 0.35]} />

        <CitySky />

        <mesh onClick={handlePlanetClick}>
          <sphereGeometry args={[radius, 48, 32]} />
          <meshBasicMaterial color="#0d0818" toneMapped={false} />
        </mesh>

        <PlanetFeatures radius={radius} />
        <PlanetRoads roads={roads} />

        {cities.map((city) => (
          <PlanetCity
            key={city.username}
            city={city}
            radius={radius}
            suppressSelect={placementMode}
            onHover={setHovered}
          />
        ))}

        {previewCandidate && ownCity && (
          <PlanetCityPreview
            buildings={ownCity.buildings}
            candidate={previewCandidate}
            radius={radius}
          />
        )}

        <OrbitControls
          enablePan={false}
          minDistance={radius * 1.05}
          maxDistance={radius * 3}
          rotateSpeed={0.5}
          zoomSpeed={0.5}
          makeDefault
        />

        <EffectComposer>
          <Bloom luminanceThreshold={0.55} luminanceSmoothing={0.5} intensity={0.5} mipmapBlur />
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

      {ownCity && (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-10 flex flex-col items-center gap-2">
          {error && (
            <p className="polis-hud-panel pointer-events-auto px-3 py-2 text-xs text-accent">
              {error}
            </p>
          )}
          {placementMode ? (
            previewCandidate ? (
              <div className="pointer-events-auto flex items-center gap-3">
                <p className="polis-hud-panel px-3 py-2 text-xs text-foreground/70">
                  Move your city here?
                </p>
                <button
                  type="button"
                  className="polis-btn"
                  disabled={pending}
                  onClick={confirmMove}
                >
                  {pending ? 'Moving…' : 'Confirm'}
                </button>
                <button type="button" className="polis-btn" disabled={pending} onClick={cancelMove}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="pointer-events-auto flex items-center gap-3">
                <p className="polis-hud-panel px-3 py-2 text-xs text-foreground/70">
                  Drag to look around. Click a spot to preview moving your city there.
                </p>
                <button type="button" className="polis-btn" onClick={cancelMove}>
                  Cancel
                </button>
              </div>
            )
          ) : (
            <button
              type="button"
              className="polis-btn pointer-events-auto"
              onClick={() => setPlacementMode(true)}
            >
              Move my city
            </button>
          )}
        </div>
      )}

      <Footer />

      {children}
    </div>
  )
}
