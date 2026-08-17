'use client'

import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { terrainRadius } from '@/lib/terrain'
import type { PlanetCity as PlanetCityData } from '@/lib/types'

const UP = new THREE.Vector3(0, 1, 0)
// city-scene.tsx's own fixed single-city camera offset (`[42, 34, 42]` /
// target `[0, 4, 0]`) scaled back a bit further (per direct request —
// the initial framing read as too tight/zoomed-in) rather than picked
// from scratch, still the same viewing angle, just pulled back along it.
const LOCAL_CAMERA_OFFSET = new THREE.Vector3(42, 34, 42).multiplyScalar(1.4)
const LOCAL_TARGET_OFFSET = new THREE.Vector3(0, 4, 0)
const FLIGHT_DURATION = 1.1

// Beyond this distance from a focused city's own target, the camera reads
// as "backing away," not "still looking at this city" — crossing it flies
// back to the planet overview and clears the selection automatically,
// rather than leaving the camera orbiting a point on the surface at
// planet-scale zoom (see the exported minimum/maximum below, sized around
// this same threshold).
const FOCUS_EXIT_DISTANCE = 190

// While a city is focused, OrbitControls' own min/maxDistance need to
// cover *this* tight range, not the planet-wide one (see planet-scene.tsx)
// — the planet-wide minDistance (~1.05x radius) is far larger than the
// close-up arrival distance here, so without a narrower range OrbitControls
// itself would clamp the camera straight back out the instant it next
// calls update(), fighting the flight before it even finishes. The max
// stays comfortably above both FOCUS_EXIT_DISTANCE and the return flight's
// own pull-back distance (2x radius), so the exit flight never gets
// clamped mid-transition either.
export const FOCUS_MIN_DISTANCE = 20
export function focusMaxDistance(radius: number): number {
  return Math.max(FOCUS_EXIT_DISTANCE + 60, radius * 2.2)
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

// The minimal shape this needs from drei's OrbitControls instance —
// avoids importing three-stdlib's own type just for this.
export interface OrbitControlsLike {
  target: THREE.Vector3
  update: () => void
}

type FlightMode = 'idle' | 'toCity' | 'toOverview'

// Smoothly moves the camera (and the OrbitControls target it orbits
// around) to a close-up framing of `target` whenever it changes — shared
// by both the planet directory's "click a city" and the keyboard
// Tab-to-next-city navigation in planet-scene.tsx — and, once settled
// there, returns to a planet overview (reporting the deselection via
// `onReturnedToOverview`) either when the user zooms back out past
// FOCUS_EXIT_DISTANCE, or immediately on request via `returnRequestId`
// (bumped when the user clicks elsewhere on the planet while a city is
// focused, see planet-scene.tsx) — both funnel through the same flight
// and the same completion callback, so a click-away and a zoom-away
// behave identically rather than being two separate code paths.
export default function PlanetCameraFlight({
  target,
  radius,
  controlsRef,
  onReturnedToOverview,
  returnRequestId = 0,
}: {
  target: PlanetCityData | null
  radius: number
  controlsRef: React.RefObject<OrbitControlsLike | null>
  onReturnedToOverview?: () => void
  returnRequestId?: number
}) {
  const mode = useRef<FlightMode>('idle')
  const progress = useRef(0)
  const startPos = useRef(new THREE.Vector3())
  const startTarget = useRef(new THREE.Vector3())
  const endPos = useRef(new THREE.Vector3())
  const endTarget = useRef(new THREE.Vector3())
  const lastKey = useRef<string | null>(null)
  const lastReturnRequestId = useRef(returnRequestId)

  useFrame(({ camera }, delta) => {
    const controls = controlsRef.current
    if (!controls) return

    function beginReturnToOverview() {
      mode.current = 'toOverview'
      progress.current = 0
      startPos.current.copy(camera.position)
      startTarget.current.copy(controls!.target)
      // Pull back along roughly the camera's current direction from the
      // planet's own center, so the transition continues whatever motion
      // was already in progress instead of cutting to an arbitrary angle.
      const dir = camera.position.clone().normalize()
      endPos.current.copy(dir.multiplyScalar(radius * 2))
      endTarget.current.set(0, 0, 0)
    }

    if (returnRequestId !== lastReturnRequestId.current) {
      lastReturnRequestId.current = returnRequestId
      beginReturnToOverview()
    }

    const key = target ? target.username : null

    if (key && key !== lastKey.current) {
      lastKey.current = key

      const normal = new THREE.Vector3(target!.planetX, target!.planetY, target!.planetZ).normalize()
      const surfaceR = terrainRadius(normal.x, normal.y, normal.z, radius)
      const surfacePoint = normal.clone().multiplyScalar(surfaceR)
      const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, normal)

      mode.current = 'toCity'
      progress.current = 0
      startPos.current.copy(camera.position)
      startTarget.current.copy(controls.target)
      endPos.current.copy(surfacePoint).add(LOCAL_CAMERA_OFFSET.clone().applyQuaternion(quaternion))
      endTarget.current.copy(surfacePoint).add(LOCAL_TARGET_OFFSET.clone().applyQuaternion(quaternion))
    } else if (!key) {
      lastKey.current = null
    }

    // Only watch for a zoom-out exit once settled (not mid-flight) on an
    // actual city — the camera legitimately sits far from (0,0,0) while
    // flying, that's not a signal to bail out.
    if (mode.current === 'idle' && key) {
      const dist = camera.position.distanceTo(controls.target)
      if (dist > FOCUS_EXIT_DISTANCE) beginReturnToOverview()
    }

    if (mode.current !== 'idle') {
      progress.current = Math.min(1, progress.current + delta / FLIGHT_DURATION)
      const t = easeInOutCubic(progress.current)
      camera.position.lerpVectors(startPos.current, endPos.current, t)
      controls.target.lerpVectors(startTarget.current, endTarget.current, t)
      controls.update()
      if (progress.current >= 1) {
        const finished = mode.current
        mode.current = 'idle'
        if (finished === 'toOverview') onReturnedToOverview?.()
      }
    }
  })

  return null
}
