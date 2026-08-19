'use client'

import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import type { PlanetCity as PlanetCityData } from '@/lib/types'

// CSS pixel size of the radar panel — exported so planet-scene.tsx's own
// <canvas> element can be styled to exactly this box regardless of the
// backing pixel buffer's actual (devicePixelRatio-scaled) resolution.
export const RADAR_SIZE = 168
const RADAR_PADDING = 11

// Beyond this angular distance from the camera's own current sub-point, a
// city is on the far side of the planet, not "nearby" in any useful sense
// (the directory panel already covers "browse every city by name") — a
// touch past a full hemisphere so something just past the horizon still
// shows near the radar's edge as a hint to keep orbiting that way.
const RADAR_MAX_ANGLE = (100 * Math.PI) / 180

const BG_COLOR = 'rgba(10, 7, 20, 0.6)'
const RING_COLOR = 'rgba(157, 77, 255, 0.32)'
const FRAME_COLOR = 'rgba(255, 47, 214, 0.55)'
const DOT_COLOR = '#4de8ff'
const FOCUS_COLOR = '#ff2fd6'
const SELF_COLOR = '#ffffff'

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const FALLBACK_UP = new THREE.Vector3(1, 0, 0)

// Draws a 2D compass-style radar straight onto an external <canvas> DOM
// node (owned by planet-scene.tsx, passed in via `canvasRef`), every
// frame, from inside useFrame — not React state, the same "mutate
// directly, skip re-rendering" idiom already used for the hover tooltip
// (see planet-scene.tsx's own tooltipRef). This component renders no 3D
// geometry itself and returns null; it only needs to live inside <Canvas>
// for useFrame's access to the live `camera`.
//
// Each city's position on the dial is its bearing (angle around the ring,
// relative to a "north" derived from the world's own +Y axis projected
// into the camera's current tangent plane) and distance (radial position,
// mapped from its true angular distance to the camera's own sub-point on
// the sphere) — not a literal top-down map, there's no fixed "up" on a
// sphere, this is the closest analogue: "how far and which way to turn."
export default function PlanetRadar({
  cities,
  canvasRef,
  focusedUsername,
}: {
  cities: PlanetCityData[]
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  focusedUsername: string | null
}) {
  const dprRef = useRef(0)

  useFrame(({ camera }) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    if (dprRef.current !== dpr) {
      dprRef.current = dpr
      canvas.width = RADAR_SIZE * dpr
      canvas.height = RADAR_SIZE * dpr
      ctx.scale(dpr, dpr)
    }

    const cx = RADAR_SIZE / 2
    const cy = RADAR_SIZE / 2
    const r = RADAR_SIZE / 2 - RADAR_PADDING

    ctx.clearRect(0, 0, RADAR_SIZE, RADAR_SIZE)

    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = BG_COLOR
    ctx.fill()

    ctx.strokeStyle = RING_COLOR
    ctx.lineWidth = 1
    for (const frac of [0.34, 0.67, 1]) {
      ctx.beginPath()
      ctx.arc(cx, cy, r * frac, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = FRAME_COLOR
    ctx.lineWidth = 1.5
    ctx.stroke()

    // The camera's own sub-point (the spot on the sphere it's currently
    // "above") is the radar's center; a tangent-plane "north" derived from
    // world +Y gives every frame a consistent bearing reference as the
    // camera orbits, rather than one tied to the camera's own roll. Falls
    // back to world +X near either pole, where +Y projects to ~zero in the
    // tangent plane — same fallback-axis idiom lib/planet-builder.ts's
    // pointsOnCap already uses for the same reason.
    const subCameraDir = camera.position.clone().normalize()
    const referenceUp = Math.abs(subCameraDir.y) > 0.99 ? FALLBACK_UP : WORLD_UP
    const up2d = referenceUp
      .clone()
      .addScaledVector(subCameraDir, -subCameraDir.dot(referenceUp))
      .normalize()
    const right2d = new THREE.Vector3().crossVectors(subCameraDir, up2d).normalize()

    ctx.beginPath()
    ctx.arc(cx, cy, 3, 0, Math.PI * 2)
    ctx.fillStyle = SELF_COLOR
    ctx.fill()

    const cityDir = new THREE.Vector3()
    const tangent = new THREE.Vector3()

    for (const city of cities) {
      cityDir.set(city.planetX, city.planetY, city.planetZ).normalize()
      const dot = THREE.MathUtils.clamp(subCameraDir.dot(cityDir), -1, 1)
      const angularDist = Math.acos(dot)
      if (angularDist > RADAR_MAX_ANGLE) continue

      tangent.copy(cityDir).addScaledVector(subCameraDir, -dot)
      const tangentLen = tangent.length()
      const bx = tangentLen > 1e-5 ? tangent.dot(right2d) / tangentLen : 0
      const by = tangentLen > 1e-5 ? tangent.dot(up2d) / tangentLen : 0

      const pixelR = (angularDist / RADAR_MAX_ANGLE) * r
      const px = cx + bx * pixelR
      const py = cy - by * pixelR

      const isFocused = city.username.toLowerCase() === focusedUsername?.toLowerCase()
      ctx.beginPath()
      ctx.arc(px, py, isFocused ? 3.4 : 2.2, 0, Math.PI * 2)
      ctx.fillStyle = isFocused ? FOCUS_COLOR : DOT_COLOR
      ctx.shadowColor = isFocused ? FOCUS_COLOR : DOT_COLOR
      ctx.shadowBlur = isFocused ? 6 : 3
      ctx.fill()
      ctx.shadowBlur = 0
    }
  })

  return null
}
