'use client'

import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import * as THREE from 'three'
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

const UP = new THREE.Vector3(0, 1, 0)
const AZIMUTH_SPEED = 0.006
const POLAR_SPEED = 0.006
// "An offset so we only ever see one pole" is polar-angle clamping: this
// keeps the point the camera is anchored near within a band around the
// north pole, so azimuth (unclamped, full rotation) scrolls
// parallels/longitude and polar angle (clamped) scrolls meridians/latitude
// without ever crossing the equator into the far hemisphere.
const MIN_POLAR_ANGLE = 0.12 // ~7deg off dead-on-top — avoids a perfectly flat top-down view
const MAX_POLAR_ANGLE = 1.3 // ~74.5deg — stays well clear of the equator/far pole
const INITIAL_POLAR_ANGLE = 0.25
// The camera's offset from its anchor point, in that point's own local
// tangent frame — the same [42, 34, 42]/[0, 4, 0] framing city-scene.tsx
// and every earlier round of this feature used from a city's own origin.
// This is what keeps things at building scale: an OrbitControls-style
// camera aimed at the sphere's true *center* from this same close range
// was tried first and was a real bug, not just an aesthetic miss — from
// only ~40 units off a ~200-unit-radius surface, the sphere's apparent
// angular size vastly exceeds the 45deg FOV, so the entire screen fills
// with the sphere's own flat, unlit color and reads as a blank void.
// Anchoring the camera to a point on the surface like any other sticker
// (same tangent-plane technique as PlanetCity/PlanetFeatures) sidesteps
// that entirely, and also guarantees a level horizon for free: the
// camera's `up` is set to that point's own true outward normal every
// frame, so it can never end up tilted regardless of how far azimuth or
// polar angle have been dragged — unlike an earlier version that instead
// rotated the *planet* under a fixed camera via hand-rolled nested Euler
// angles, where the pitch axis silently rotated together with yaw and the
// horizon visibly tilted the moment both had been dragged at all.
const CAMERA_OFFSET = new THREE.Vector3(42, 34, 42)
const TARGET_OFFSET = new THREE.Vector3(0, 4, 0)
const MIN_ZOOM = 0.45
const MAX_ZOOM = 2.2
const ZOOM_SPEED = 0.0012

// Lives inside the Canvas (needs useThree/useFrame) and owns the camera
// directly — drag to orbit (azimuth/polar angle around the sphere), wheel
// to zoom (scales the local offset, not the underlying spherical
// coordinates). Recomputes camera position/up/lookAt from scratch every
// frame from plain (azimuth, polarAngle, zoom) numbers in a ref, the same
// "recompute, don't accumulate transforms" approach OrbitControls itself
// uses internally — cheap, and avoids any chance of the state drifting.
function PlanetCamera({ radius }: { radius: number }) {
  const { camera, gl } = useThree()
  const state = useRef({ azimuth: 0, polar: INITIAL_POLAR_ANGLE, zoom: 1 })

  useEffect(() => {
    const dom = gl.domElement
    const drag = { active: false, lastX: 0, lastY: 0 }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return
      drag.active = true
      drag.lastX = e.clientX
      drag.lastY = e.clientY
    }

    function onPointerMove(e: PointerEvent) {
      if (!drag.active) return
      const dx = e.clientX - drag.lastX
      const dy = e.clientY - drag.lastY
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      state.current.azimuth += dx * AZIMUTH_SPEED
      state.current.polar = Math.max(
        MIN_POLAR_ANGLE,
        Math.min(MAX_POLAR_ANGLE, state.current.polar + dy * POLAR_SPEED),
      )
    }

    function onPointerUp() {
      drag.active = false
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      state.current.zoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, state.current.zoom + e.deltaY * ZOOM_SPEED),
      )
    }

    dom.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    dom.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      dom.removeEventListener('wheel', onWheel)
    }
  }, [gl])

  useFrame(() => {
    const { azimuth, polar, zoom } = state.current
    const normal = new THREE.Vector3(
      Math.sin(polar) * Math.cos(azimuth),
      Math.cos(polar),
      Math.sin(polar) * Math.sin(azimuth),
    )
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, normal)
    const surfacePoint = normal.clone().multiplyScalar(radius)
    const camOffset = CAMERA_OFFSET.clone().multiplyScalar(zoom).applyQuaternion(quaternion)
    const targetOffset = TARGET_OFFSET.clone().applyQuaternion(quaternion)

    camera.position.copy(surfacePoint).add(camOffset)
    camera.up.copy(normal)
    camera.lookAt(surfacePoint.clone().add(targetOffset))
  })

  return null
}

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

  const initialCameraPosition: [number, number, number] = [42, radius + 34, 42]

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
        {/* A fixed density, not scaled by planet radius — the camera stays
            close to the pole's surface regardless of how large the planet
            grows, so nearby viewing distances stay city-scale. */}
        <fogExp2 attach="fog" args={['#170a28', 0.006]} />
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

        <PlanetCamera radius={radius} />

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
