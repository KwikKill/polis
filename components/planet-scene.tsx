'use client'

import { OrbitControls } from '@react-three/drei'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import Footer from '@/components/footer'
import PlanetCity from '@/components/planet-city'
import PlanetCityPreview from '@/components/planet-city-preview'
import PlanetDataRings from '@/components/planet-data-rings'
import PlanetRoads from '@/components/planet-roads'
import PlanetSky from '@/components/planet-sky'
import PlanetSurface from '@/components/planet-surface'
import { cityExtent } from '@/lib/city-builder'
import { isValidPlacement, type PlacedCity, type Vec3 } from '@/lib/planet-builder'
import { devSetCityPosition, relocateCity, type DevCity } from '@/lib/planet-service'
import type { Building, PlanetCity as PlanetCityData, PlanetRoad } from '@/lib/types'

export default function PlanetScene({
  cities,
  radius,
  roads,
  viewerUsername,
  devMode = false,
  devCities,
  children,
}: {
  cities: PlanetCityData[]
  radius: number
  roads: PlanetRoad[]
  viewerUsername: string | null
  devMode?: boolean
  devCities?: DevCity[]
  children?: React.ReactNode
}) {
  const router = useRouter()
  const [hovered, setHovered] = useState<Building | null>(null)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })
  const [devTargetUsername, setDevTargetUsername] = useState<string | null>(null)
  const [placementMode, setPlacementMode] = useState(false)
  const [previewCandidate, setPreviewCandidate] = useState<Vec3 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // In dev mode, the "active" city being placed/moved is whichever one the
  // dev picker below has selected, standing in for the normal "only your
  // own city" restriction, which still applies exactly as before once
  // devMode is off (activeUsername just equals viewerUsername then).
  const activeUsername = devMode && devTargetUsername ? devTargetUsername : viewerUsername

  // Buildings/roads for the preview ghost need to come from devCities in
  // dev mode, since the picker can target a city that isn't on the planet
  // yet at all (and so isn't in `cities`, which only ever holds already-
  // placed ones).
  const activeCity = useMemo(() => {
    if (!activeUsername) return null
    const pool = devMode && devCities ? devCities : cities
    return pool.find((c) => c.username.toLowerCase() === activeUsername.toLowerCase()) ?? null
  }, [activeUsername, devMode, devCities, cities])

  // In non-dev mode activeCity only ever comes from `cities` (already-
  // placed cities by construction, see getPlanetCities), so this is
  // trivially true there; in dev mode activeCity can be an unplaced
  // DevCity, whose planetX is genuinely nullable.
  const activeIsOnPlanet = Boolean(activeCity && activeCity.planetX !== null)

  const otherCities = useMemo(
    (): PlacedCity[] =>
      cities
        .filter((c) => c.username.toLowerCase() !== activeUsername?.toLowerCase())
        .map((c) => ({
          position: [c.planetX, c.planetY, c.planetZ] as Vec3,
          extent: cityExtent(c.buildings),
        })),
    [cities, activeUsername],
  )

  const activeExtent = useMemo(() => (activeCity ? cityExtent(activeCity.buildings) : 0), [activeCity])

  // The same OrbitControls setup as atlas's globe (components/enhanced-
  // globe.tsx in the atlas project): plain orbit around the sphere's true
  // center (the default `target`, never overridden), no pan, distance
  // clamped to a margin just above the surface up to a few radii out.
  // Atlas starts pulled back at 3x its fixed radius (camera.position.z =
  // 300 against a radius-100 Earth) rather than hugging the surface,
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
    // positions already in props, the server re-validates authoritatively
    // regardless inside relocateCity's transaction, this check is UX only.
    if (!isValidPlacement(candidate, activeExtent, otherCities, radius)) {
      setError('Too close to another city or a natural feature, try a different spot.')
      return
    }

    setError(null)
    setPreviewCandidate(candidate)
  }

  function confirmMove() {
    if (!previewCandidate || pending || !activeUsername) return
    startTransition(async () => {
      const result =
        devMode && devTargetUsername
          ? await devSetCityPosition(devTargetUsername, previewCandidate)
          : await relocateCity(previewCandidate)
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
        {/* Density scales as ~1/radius, not a fixed value, atlas's orbit
            camera ranges from just above the surface out to several planet
            radii, unlike the earlier fixed close-up framing this replaced,
            so a flat density either does nothing up close or fogs out the
            entire planet from the default pulled-back view. */}
        <fogExp2 attach="fog" args={['#170a28', 0.3 / radius]} />
        <ambientLight intensity={0.22} color="#4b2a6b" />
        <hemisphereLight args={['#2a1a40', '#050308', 0.35]} />

        <PlanetSky />

        {/* Land, ocean and the circuit grid are all painted directly into
            PlanetSurface's own fragment shader — see planet-surface.tsx. */}
        <PlanetSurface radius={radius} onClick={handlePlanetClick} />
        <PlanetDataRings radius={radius} />

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

        {previewCandidate && activeCity && (
          <PlanetCityPreview
            buildings={activeCity.buildings}
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
          <p className="text-data">
            {hovered.language ?? 'Unknown'} · {hovered.stars}★ · {hovered.commits} commits
            {hovered.fork && ' · fork'}
            {hovered.stale && ' · dormant'}
          </p>
        </div>
      )}

      {(activeCity || (devMode && devCities)) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-10 flex flex-col items-center gap-2">
          {error && (
            <p className="polis-hud-panel pointer-events-auto px-3 py-2 text-xs text-accent">
              {error}
            </p>
          )}

          {devMode && devCities && !placementMode && (
            <div className="polis-hud-panel pointer-events-auto flex items-center gap-2 px-3 py-2">
              <span className="text-xs uppercase tracking-widest text-accent">Dev</span>
              <select
                value={devTargetUsername ?? ''}
                onChange={(e) => setDevTargetUsername(e.target.value || null)}
                className="border border-line bg-background/80 px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="">Select a city…</option>
                {devCities.map((c) => (
                  <option key={c.username} value={c.username}>
                    {c.username} {c.planetX === null ? '(not on planet)' : ''}
                  </option>
                ))}
              </select>
              {activeCity && (
                <button type="button" className="polis-btn" onClick={() => setPlacementMode(true)}>
                  {activeIsOnPlanet ? 'Move this city' : 'Place this city'}
                </button>
              )}
            </div>
          )}

          {placementMode &&
            activeCity &&
            (previewCandidate ? (
              <div className="pointer-events-auto flex items-center gap-3">
                <p className="polis-hud-panel px-3 py-2 text-xs text-foreground/70">
                  {activeIsOnPlanet ? 'Move' : 'Place'} {activeUsername}&rsquo;s city here?
                </p>
                <button
                  type="button"
                  className="polis-btn"
                  disabled={pending}
                  onClick={confirmMove}
                >
                  {pending ? 'Saving…' : 'Confirm'}
                </button>
                <button type="button" className="polis-btn" disabled={pending} onClick={cancelMove}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="pointer-events-auto flex items-center gap-3">
                <p className="polis-hud-panel px-3 py-2 text-xs text-foreground/70">
                  Drag to look around. Click a spot to preview{' '}
                  {activeIsOnPlanet ? 'moving' : 'placing'} the city there.
                </p>
                <button type="button" className="polis-btn" onClick={cancelMove}>
                  Cancel
                </button>
              </div>
            ))}

          {!devMode && !placementMode && activeIsOnPlanet && (
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
