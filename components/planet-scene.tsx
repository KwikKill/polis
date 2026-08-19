'use client'

import { OrbitControls } from '@react-three/drei'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Footer from '@/components/footer'
import PlanetCameraFlight, {
  focusMaxDistance,
  FOCUS_MIN_DISTANCE,
  type OrbitControlsLike,
} from '@/components/planet-camera-flight'
import PlanetCity from '@/components/planet-city'
import PlanetCityPreview from '@/components/planet-city-preview'
import PlanetClouds from '@/components/planet-clouds'
import PlanetDataRings from '@/components/planet-data-rings'
import PlanetDirectory from '@/components/planet-directory'
import PlanetRadar, { RADAR_SIZE } from '@/components/planet-radar'
import PlanetRoads from '@/components/planet-roads'
import PlanetSky from '@/components/planet-sky'
import PlanetSurface from '@/components/planet-surface'
import { cityExtent, estimatePopulation } from '@/lib/city-builder'
import { devRefreshAllCities } from '@/lib/dev-service'
import { isValidPlacement, type PlacedCity, type Vec3 } from '@/lib/planet-builder'
import { devSetCityPosition, relocateCity, type DevCity } from '@/lib/planet-service'
import type { Building, PlanetCity as PlanetCityData, PlanetRoad } from '@/lib/types'

// Elements Tab shouldn't be hijacked away from — a real interactive
// control still needs normal browser Tab behavior, the city-cycling
// shortcut below only kicks in when focus is nowhere in particular (the
// scene itself, or the page body).
const FOCUSABLE_TAGS = new Set(['INPUT', 'SELECT', 'BUTTON', 'A', 'TEXTAREA'])

export default function PlanetScene({
  cities,
  radius,
  roads,
  viewerUsername,
  devMode = false,
  devCities,
  explorable = false,
  children,
}: {
  cities: PlanetCityData[]
  radius: number
  roads: PlanetRoad[]
  viewerUsername: string | null
  devMode?: boolean
  devCities?: DevCity[]
  /** Turns on the city directory panel and keyboard (Tab/Enter) city
   * navigation — opted in only where the planet is the actual point of
   * the page (see app/planet/page.tsx), not on the homepage's background
   * instance, where a surprise Tab-hijack would be an odd thing to hit
   * while trying to reach the hero panel's own controls. */
  explorable?: boolean
  children?: React.ReactNode
}) {
  const router = useRouter()
  const [hovered, setHovered] = useState<Building | null>(null)
  // Deliberately *not* React state: this scene renders every city on the
  // planet at full detail (see PlanetCity's own docs), and `pointer` used
  // to be state set from every raw pointermove event, which re-renders
  // this entire component (and, since it's the parent, reconciles every
  // one of those cities' JSX) on every single pixel of mouse movement —
  // including while just orbiting the camera. Mutating the tooltip's DOM
  // node directly below skips React entirely for this, the standard fix
  // for a cursor-following element.
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [devTargetUsername, setDevTargetUsername] = useState<string | null>(null)
  const [placementMode, setPlacementMode] = useState(false)
  const [previewCandidate, setPreviewCandidate] = useState<Vec3 | null>(null)
  const [previewValid, setPreviewValid] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // Separate from `pending`/startTransition above (placement confirm) so a
  // refresh in progress doesn't show a stray "Saving…" on the placement
  // flow's own button, or vice versa — the two are unrelated actions that
  // can each be in flight independently.
  const [refreshPending, startRefreshTransition] = useTransition()
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [flyToCity, setFlyToCity] = useState<PlanetCityData | null>(null)
  const [focusedUsername, setFocusedUsername] = useState<string | null>(null)
  const [returnRequestId, setReturnRequestId] = useState(0)
  const controlsRef = useRef<OrbitControlsLike | null>(null)
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null)

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
    if (placementMode) {
      if (pending) return
      e.stopPropagation()

      const len = Math.hypot(e.point.x, e.point.y, e.point.z)
      if (len < 1e-6) return
      const candidate: Vec3 = [e.point.x / len, e.point.y / len, e.point.z / len]

      // Always shows the ghost now, valid or not (see PlanetCityPreview's
      // own `valid` prop, which turns it red) — a rejected click used to
      // just produce a floating text error with nothing at the spot
      // itself, this puts the actual rejected footprint down so it's
      // obvious why, not just that. The server re-validates
      // authoritatively regardless inside relocateCity's transaction
      // either way, this check is UX only.
      setPreviewValid(isValidPlacement(candidate, activeExtent, otherCities, radius))
      setError(null)
      setPreviewCandidate(candidate)
      return
    }

    // Not placing anything — a click on the bare planet surface while a
    // city is focused means "done looking at that one," the same request
    // PlanetCameraFlight's own zoom-out watcher makes, just triggered
    // immediately instead of by distance. Bumping the id (rather than
    // clearing focusedUsername/flyToCity directly here) is what lets the
    // flight actually *fly* back rather than snapping, and keeps the
    // state clear happening once true via onReturnedToOverview either way.
    if (focusedUsername) {
      e.stopPropagation()
      setReturnRequestId((n) => n + 1)
    }
  }

  function confirmMove() {
    if (!previewCandidate || !previewValid || pending || !activeUsername) return
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
    setPreviewValid(true)
    setError(null)
  }

  // Same underlying refresh POST /api/cities/refresh (and polis-cron)
  // both call, exposed as a plain server action here so this dev-only
  // button doesn't need the REFRESH_SECRET the real route is guarded by
  // (see lib/dev-service.ts's devRefreshAllCities).
  function refreshAllCities() {
    if (refreshPending) return
    setRefreshMessage(null)
    startRefreshTransition(async () => {
      const result = await devRefreshAllCities()
      setRefreshMessage(
        result.failed > 0
          ? `Refreshed ${result.refreshed}, ${result.failed} failed`
          : `Refreshed ${result.refreshed} cities`,
      )
      router.refresh()
    })
  }

  function visitCity(city: PlanetCityData) {
    setFocusedUsername(city.username)
    setFlyToCity(city)
  }

  // The camera flight's own "zoomed out past the focus range" watcher
  // calls this — clears the selection and, via the OrbitControls
  // min/maxDistance props below reverting to their planet-wide values,
  // lets a further zoom-out behave normally again instead of continuing
  // to orbit a point on the surface at the wrong scale.
  function exitCityFocus() {
    setFocusedUsername(null)
    setFlyToCity(null)
  }

  // Tab cycles the keyboard focus between cities (wrapping), flying the
  // camera to whichever one is focused and marking it with the same
  // reticle a mouse hover already shows; Enter opens that city's own page.
  // Guarded to only engage when focus isn't already inside a real control
  // (see FOCUSABLE_TAGS) — this is additive navigation for the 3D scene,
  // not a replacement for normal Tab order through the HUD's own buttons,
  // links and the dev picker's inputs.
  useEffect(() => {
    if (!explorable || cities.length === 0) return

    // Same order the directory panel itself shows (biggest estimated
    // population first) — Tab stepping through a different order than
    // what's visibly listed would feel disconnected from it.
    const sorted = [...cities].sort(
      (a, b) => estimatePopulation(b.buildings) - estimatePopulation(a.buildings),
    )

    function handleKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName
      if (tag && FOCUSABLE_TAGS.has(tag)) return

      if (e.key === 'Tab') {
        e.preventDefault()
        const currentIndex = sorted.findIndex(
          (c) => c.username.toLowerCase() === focusedUsername?.toLowerCase(),
        )
        const delta = e.shiftKey ? -1 : 1
        const nextIndex = currentIndex < 0 ? 0 : (currentIndex + delta + sorted.length) % sorted.length
        visitCity(sorted[nextIndex])
      } else if (e.key === 'Enter' && focusedUsername) {
        router.push(`/u/${focusedUsername}`)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [explorable, cities, focusedUsername, router])

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
        <PlanetClouds radius={radius} />
        <PlanetDataRings radius={radius} />

        <PlanetRoads roads={roads} />

        {explorable && (
          <PlanetRadar cities={cities} canvasRef={radarCanvasRef} focusedUsername={focusedUsername} />
        )}

        {cities.map((city) => (
          <PlanetCity
            key={city.username}
            city={city}
            radius={radius}
            suppressSelect={placementMode}
            onHover={setHovered}
            isFocused={explorable && city.username.toLowerCase() === focusedUsername?.toLowerCase()}
          />
        ))}

        {previewCandidate && activeCity && (
          <PlanetCityPreview
            buildings={activeCity.buildings}
            candidate={previewCandidate}
            radius={radius}
            valid={previewValid}
          />
        )}

        <OrbitControls
          // drei's OrbitControls ref type pulls in three-stdlib's full
          // class surface; PlanetCameraFlight only needs the couple of
          // members OrbitControlsLike declares, so the ref itself stays
          // typed to that minimal shape and gets cast here instead of
          // widening it everywhere else it's used.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={controlsRef as any}
          enablePan={false}
          // A city being focused needs a much tighter range than the
          // planet-wide default (see planet-camera-flight.tsx) — without
          // this, the planet-wide minDistance is far larger than the
          // close-up arrival distance, and OrbitControls' own clamping
          // would fight the flight back out to planet scale the instant
          // it next updates.
          minDistance={focusedUsername ? FOCUS_MIN_DISTANCE : radius * 1.05}
          maxDistance={focusedUsername ? focusMaxDistance(radius) : radius * 3}
          rotateSpeed={0.5}
          zoomSpeed={0.5}
          makeDefault
        />
        <PlanetCameraFlight
          target={flyToCity}
          radius={radius}
          controlsRef={controlsRef}
          onReturnedToOverview={exitCityFocus}
          returnRequestId={returnRequestId}
        />

        <EffectComposer>
          <Bloom luminanceThreshold={0.55} luminanceSmoothing={0.5} intensity={0.5} mipmapBlur />
        </EffectComposer>
      </Canvas>

      {/* Always mounted (visibility toggled via `display`, not conditional
          rendering) so tooltipRef stays live across hover changes — its
          position is updated directly in the pointermove handler above,
          never through React state/re-render. */}
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
              <button
                type="button"
                className="polis-btn"
                disabled={refreshPending}
                onClick={refreshAllCities}
              >
                {refreshPending ? 'Refreshing…' : 'Refresh all cities'}
              </button>
              {refreshMessage && (
                <span className="text-xs text-foreground/60">{refreshMessage}</span>
              )}
            </div>
          )}

          {placementMode &&
            activeCity &&
            (previewCandidate ? (
              <div className="pointer-events-auto flex items-center gap-3">
                {previewValid ? (
                  <>
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
                  </>
                ) : (
                  <p className="polis-hud-panel px-3 py-2 text-xs text-accent">
                    Too close to another city or a natural feature — try a different spot.
                  </p>
                )}
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

          {explorable && !devMode && !placementMode && activeIsOnPlanet && (
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

      {explorable && (
        <PlanetDirectory cities={cities} focusedUsername={focusedUsername} onSelect={visitCity} />
      )}

      {/* Desktop only, like the directory panel it mirrors — a fixed
          RADAR_SIZE canvas is a meaningful chunk of a phone screen, and
          the drawing itself (see planet-radar.tsx) already reads fine at
          this one size, no responsive variant to design for a first pass. */}
      {explorable && (
        <div className="polis-hud-panel pointer-events-none fixed bottom-24 left-6 z-10 hidden flex-col items-center gap-1 p-2 sm:flex">
          <span className="font-display text-[0.62rem] uppercase tracking-widest text-foreground/50">
            Radar
          </span>
          <canvas
            ref={radarCanvasRef}
            style={{ width: RADAR_SIZE, height: RADAR_SIZE }}
            aria-hidden="true"
          />
        </div>
      )}

      <Footer />

      {children}
    </div>
  )
}
