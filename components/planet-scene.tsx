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
import { isValidPlacement, type Vec3 } from '@/lib/planet-builder'
import { relocateCity } from '@/lib/planet-service'
import type { Building, PlanetCity as PlanetCityData, PlanetRoad } from '@/lib/types'

// The planet-scale analogue of city-scene.tsx: sky/fog/lights/Bloom are
// singletons mounted once here (CitySky already recenters on the camera
// every frame and Bloom is a screen-space post-process independent of
// scene object count, so neither needs to scale with city count), then
// every city renders as its own full-detail PlanetCity sticker.
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

  const otherPositions = useMemo(
    () =>
      cities
        .filter((c) => c.username.toLowerCase() !== viewerUsername?.toLowerCase())
        .map((c) => [c.planetX, c.planetY, c.planetZ] as Vec3),
    [cities, viewerUsername],
  )

  // Looking down from near the planet's "north" (global +Y) rather than
  // aimed at any specific city's own local vertical — aiming directly
  // along a city's own surface normal flattens it into a top-down view of
  // its roofs (what a lone city on the planet looked like before). Viewed
  // obliquely from above instead, any city away from the exact pole reads
  // as a proper side-on skyline silhouette.
  const initialCameraPosition = useMemo((): [number, number, number] => {
    const dist = radius * 1.9
    const dx = 0.35
    const dy = 1
    const dz = 0.35
    const len = Math.hypot(dx, dy, dz)
    return [(dx / len) * dist, (dy / len) * dist, (dz / len) * dist]
  }, [radius])

  function handlePlanetClick(e: ThreeEvent<MouseEvent>) {
    if (!placementMode || pending) return
    e.stopPropagation()

    const len = e.point.length()
    if (len < 1e-6) return
    const candidate: Vec3 = [e.point.x / len, e.point.y / len, e.point.z / len]

    // Instant client-side feedback using the same pure function and
    // positions already in props — the server re-validates authoritatively
    // regardless inside relocateCity's transaction, this check is UX only.
    if (!isValidPlacement(candidate, otherPositions, radius)) {
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
        {/* Tuned against the initial camera's actual diagonal distance from
            origin (~1.9*radius given the position above), not just
            `radius` itself — an earlier version fogged out almost the
            entire default view because of that gap. */}
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
          enableDamping
          dampingFactor={0.08}
          minDistance={radius * 1.05}
          maxDistance={radius * 3.5}
          target={[0, 0, 0]}
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
                  Click a spot on the planet to preview moving your city there.
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
