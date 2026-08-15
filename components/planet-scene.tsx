'use client'

import { OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
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

const YAW_SPEED = 0.006
const PITCH_SPEED = 0.006
const PITCH_LIMIT = 1.2 // radians (~69deg) either side of level — keeps the far pole out of view
const CLICK_DRAG_THRESHOLD = 6 // px — below this, a pointer up/down pair counts as a click, not a drag

// The camera stays fixed near the planet's pole; dragging spins the
// *planet* underneath it instead — left/right rotates around the polar
// axis (scrolling through parallels/longitude at a fixed latitude),
// up/down tilts which latitude band faces the camera (scrolling through
// meridians), clamped so the opposite pole never comes into view. Lives
// inside the Canvas (needs useThree) and talks to the rest of the scene
// purely via the group ref + callback — no scene state of its own.
function PlanetController({
  groupRef,
  radius,
  placementMode,
  onPlanetClick,
}: {
  groupRef: React.RefObject<THREE.Group | null>
  radius: number
  placementMode: boolean
  onPlanetClick: (candidate: Vec3) => void
}) {
  const { camera, gl } = useThree()
  const onPlanetClickRef = useRef(onPlanetClick)
  onPlanetClickRef.current = onPlanetClick

  useEffect(() => {
    const dom = gl.domElement
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const drag = { active: false, lastX: 0, lastY: 0, startX: 0, startY: 0 }
    const rotation = { yaw: 0, pitch: 0 }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return
      drag.active = true
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      drag.startX = e.clientX
      drag.startY = e.clientY
    }

    function onPointerMove(e: PointerEvent) {
      if (!drag.active || !groupRef.current) return
      const dx = e.clientX - drag.lastX
      const dy = e.clientY - drag.lastY
      drag.lastX = e.clientX
      drag.lastY = e.clientY

      rotation.yaw += dx * YAW_SPEED
      rotation.pitch = Math.max(
        -PITCH_LIMIT,
        Math.min(PITCH_LIMIT, rotation.pitch + dy * PITCH_SPEED),
      )
      groupRef.current.quaternion.setFromEuler(
        new THREE.Euler(rotation.pitch, rotation.yaw, 0, 'YXZ'),
      )
    }

    function onPointerUp(e: PointerEvent) {
      if (!drag.active) return
      drag.active = false

      const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY)
      if (dist > CLICK_DRAG_THRESHOLD || !placementMode || !groupRef.current) return

      const rect = dom.getBoundingClientRect()
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)

      // The planet sphere is always centered at the world origin and
      // perfectly round, so rotating it doesn't change this at all —
      // solving the ray/sphere intersection analytically avoids needing to
      // raycast against a specific mesh, which could hit a building or
      // lake sitting on the surface instead of the sphere itself.
      const origin = raycaster.ray.origin
      const direction = raycaster.ray.direction
      const b = 2 * origin.dot(direction)
      const c = origin.dot(origin) - radius * radius
      const discriminant = b * b - 4 * c
      if (discriminant < 0) return
      const t = (-b - Math.sqrt(discriminant)) / 2
      if (t < 0) return

      const hitWorld = origin.clone().addScaledVector(direction, t)
      groupRef.current.updateMatrixWorld(true)
      const hitLocal = groupRef.current.worldToLocal(hitWorld.clone()).normalize()
      onPlanetClickRef.current([hitLocal.x, hitLocal.y, hitLocal.z])
    }

    dom.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [camera, gl, groupRef, placementMode, radius])

  return null
}

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
  const planetGroupRef = useRef<THREE.Group>(null)
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

  // The camera itself never moves — anchored near the planet's north pole
  // (global +Y, the surface point at [0, radius, 0]) with the same
  // ~40-unit offset city-scene.tsx uses from a city's own origin, so
  // anything near the pole reads at building-scale immediately, side-on.
  // PlanetController rotates the planet group in response to drag input
  // instead of moving the camera around it.
  const initialCameraPosition: [number, number, number] = [42, radius + 34, 42]
  const orbitTarget: [number, number, number] = [0, radius + 4, 0]

  function handlePlanetClick(candidate: Vec3) {
    if (pending) return

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
        {/* A fixed density, not scaled by planet radius — the camera is
            anchored near the pole's surface with the same ~40-unit offset
            city-scene.tsx uses, so nearby viewing distances stay
            city-scale regardless of how large the planet grows. */}
        <fogExp2 attach="fog" args={['#170a28', 0.006]} />
        <ambientLight intensity={0.22} color="#4b2a6b" />
        <hemisphereLight args={['#2a1a40', '#050308', 0.35]} />

        <CitySky />

        <group ref={planetGroupRef}>
          <mesh>
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
        </group>

        <PlanetController
          groupRef={planetGroupRef}
          radius={radius}
          placementMode={placementMode}
          onPlanetClick={handlePlanetClick}
        />

        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          enableRotate={false}
          enablePan={false}
          minDistance={12}
          maxDistance={Math.max(400, radius * 1.5)}
          target={orbitTarget}
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
