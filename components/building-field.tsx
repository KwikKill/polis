'use client'

import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { curvedLocalPlacement, type SurfaceCurvature } from '@/lib/sphere-curve'
import type { Building } from '@/lib/types'

const FORK_CAP_HEIGHT = 0.4
const EDGE_TRIM = 0.1 // corner-bar thickness, Tron-style glowing edges
const WINDOW_WIDTH = 0.24
const WINDOW_HEIGHT = 0.32
const WINDOW_ROW_SPACING = 1.4
const WINDOW_COL_SPACING = 0.85
const MAX_WINDOW_ROWS = 9
const MAX_WINDOW_COLS = 4
const WINDOW_LIT_PROB_ACTIVE = 0.75
const WINDOW_LIT_PROB_STALE = 0.1
const WINDOW_COLOR = '#ffe3a8'
// A cheap fake reflection tint, no cubemap/render target: a fresnel term
// (view direction vs. the window's own world-space facing direction) mixed
// with a cool tone, so glass brightens toward a grazing viewing angle
// instead of always reading as a flat plane. A cool tint against the warm
// interior glow reads as sky/exterior light bouncing off the pane.
const WINDOW_REFLECTION_COLOR = '#7fa8ff'
const WINDOW_REFLECTION_STRENGTH = 0.5
const WINDOW_REFLECTION_POWER = 2.2
// Only a minority of lit windows actually flicker (a hashed per-instance
// amount, not a shared uniform pulse) — the rest stay steady, so it reads
// as a few offices/apartments with a bad fixture rather than the whole
// tower breathing in sync.
const WINDOW_FLICKER_PROB = 0.12
const WINDOW_FLICKER_MIN = 0.35
const WINDOW_FLICKER_MAX = 0.85
const WINDOW_FLICKER_SPEED = 2.0
const ROOF_PROP_COLOR = '#342e40'
const TIER_MIN_HEIGHT = 10 // only buildings at least this tall get a setback tier
const TIER_PROBABILITY = 0.5

// Body silhouette, most buildings stay a plain extruded box; a minority
// get a tapered "spire" or a genuinely round tower instead, so the skyline
// reads as more than one repeated shape. Landmarks are exempt (always
// 'box') to keep the top-starred repos visually canonical against their
// own beacon.
type BodyVariant = 'box' | 'tower' | 'cylinder'
const CYLINDER_PROBABILITY = 0.14
const TOWER_PROBABILITY = 0.18
// A second, smaller undecorated volume attached to one side of some
// larger box-variant buildings, for an L-shaped footprint — only
// considered for buildings at least this big on both axes, a tiny
// building with a wing reads as clutter, not a footprint shape.
const LWING_PROBABILITY = 0.35
const LWING_MIN_SIZE = 3.4

function pickBodyVariant(b: Building): BodyVariant {
  if (b.landmark) return 'box'
  const r = Math.random()
  if (r < CYLINDER_PROBABILITY) return 'cylinder'
  if (r < CYLINDER_PROBABILITY + TOWER_PROBABILITY) return 'tower'
  return 'box'
}

interface BuildingFieldProps {
  buildings: Building[]
  onHover: (building: Building | null) => void
  onSelect: (building: Building) => void
  curvature?: SurfaceCurvature
}

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const yawScratch = new THREE.Quaternion()

// Every instance below is placed via this instead of a raw
// dummy.position.set/dummy.rotation.set pair: without curvature it's
// exactly that (zero-diff for the flat /u/[username] page). With it, each
// individual wall/trim bar/window/roof prop/tier gets *its own* corrected
// surface point and "standing up straight" tilt (curvedLocalPlacement)
// rather than inheriting one shared orientation from the city's own
// tangent-plane group, at real planet scale a big city's buildings
// otherwise both float off the true sphere near the city's edge and all
// lean at the same angle instead of each standing normal to the surface
// under it.
function placeDummy(
  dummy: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  yaw: number,
  curvature: SurfaceCurvature | undefined,
) {
  if (curvature) {
    const { position, tiltQuaternion } = curvedLocalPlacement(
      x,
      y,
      z,
      curvature.normal,
      curvature.planetRadius,
      curvature.quaternion,
    )
    dummy.position.copy(position)
    dummy.quaternion.copy(tiltQuaternion).multiply(yawScratch.setFromAxisAngle(Y_AXIS, yaw))
  } else {
    dummy.position.set(x, y, z)
    dummy.rotation.set(0, yaw, 0)
  }
}

interface WindowInstance {
  x: number
  y: number
  z: number
  rotationY: number
  phase: number
  flicker: number
}

interface RoofProp {
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
}

interface Tier {
  x: number
  y: number
  z: number
  width: number
  height: number
  depth: number
  color: THREE.Color
}

// Bloom (see city-scene.tsx) reacts to raw pixel luminance, not a material's
// `emissive` channel specifically, so "glow" here just means pushing the
// instance color past 1.0 with toneMapped=false on an *unlit* material.
// meshStandardMaterial was used before, but its diffuse output still scales
// with the scene's (deliberately dim, night-ambient) light, under that
// lighting a scaled-up albedo can still render under the bloom threshold.
// meshBasicMaterial sidesteps that: the instance color IS the pixel color.
//
// Being fully unlit loses all directional shading though, every face
// renders as one flat color, which reads as a cartoon block rather than a
// building. `shadedBoxGeometry` bakes a fixed per-face brightness (like
// static ambient occlusion) as vertex colors so the volume still reads
// correctly regardless of scene lighting, while the *instance* color stays
// deliberately restrained, most of a building's glow should come from its
// edge trim and windows, not the walls themselves blowing out.
// Range compressed vs. what you'd use on a bright material, bodyColor's
// lightness is now deliberately low, so multiplying by anything much
// smaller than ~0.55 crushes the dim faces to indistinguishable black.
const FACE_SHADE = [0.85, 0.7, 1, 0.55, 0.9, 0.65] // +x, -x, +y, -y, +z, -z

function shadedBoxGeometry(): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 1)
  const colors = new Float32Array(24 * 3)
  for (let face = 0; face < 6; face++) {
    const shade = FACE_SHADE[face]
    for (let v = 0; v < 4; v++) {
      const idx = (face * 4 + v) * 3
      colors[idx] = shade
      colors[idx + 1] = shade
      colors[idx + 2] = shade
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

// The generalized version of FACE_SHADE above for a geometry whose faces
// aren't fixed to the six cardinal directions a box's are: a box's own
// per-face-index brightness table already implicitly assumes a light from
// roughly this same fixed direction, this derives the same effect from
// each vertex's own normal instead, so it still works for a tapered or
// round profile. Three.js's own primitive geometries (CylinderGeometry
// included) already ship a correct 'normal' attribute at construction, no
// computeVertexNormals() call needed here.
const FAKE_LIGHT_DIR = new THREE.Vector3(0.45, 0.78, 0.44).normalize()
const SHADE_MIN = 0.5
const SHADE_MAX = 1.0

function bakeLitVertexColors(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const normal = geo.attributes.normal
  const colors = new Float32Array(normal.count * 3)
  const n = new THREE.Vector3()
  for (let i = 0; i < normal.count; i++) {
    n.set(normal.getX(i), normal.getY(i), normal.getZ(i))
    const shade = SHADE_MIN + (SHADE_MAX - SHADE_MIN) * Math.max(0, (n.dot(FAKE_LIGHT_DIR) + 1) / 2)
    colors[i * 3] = shade
    colors[i * 3 + 1] = shade
    colors[i * 3 + 2] = shade
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

// A tapered "spire" profile: a square-prism frustum narrower at the roof
// than the base (radialSegments=4, rotated an eighth-turn so its flat
// faces align with the +x/+z axes instead of meeting at a corner).
//
// CylinderGeometry's own `radius` argument is the *circumradius* out to
// each of its radialSegments vertices, not the flat face's own
// perpendicular distance from center — for a 4-sided prism with faces
// rotated onto the axes, a face sits at `radius * cos(PI/4)` (≈0.71x),
// not at `radius` itself, so passing 0.5 there (matching a unit box's own
// half-width) rendered a body ~29% narrower than every consumer of
// b.width/b.depth assumed, at every row from base to roof. Scaled up by
// 1/cos(PI/4) here so the *rendered face* lands exactly at 0.5, matching
// a box's own half-width convention (see buildWindows, which relies on
// exactly that).
const TOWER_TOP_FRACTION = 0.72
const TOWER_APOTHEM_CORRECTION = 1 / Math.cos(Math.PI / 4)
function shadedTowerGeometry(): THREE.BufferGeometry {
  return bakeLitVertexColors(
    new THREE.CylinderGeometry(
      0.5 * TOWER_TOP_FRACTION * TOWER_APOTHEM_CORRECTION,
      0.5 * TOWER_APOTHEM_CORRECTION,
      1,
      4,
      1,
      false,
      Math.PI / 4,
    ),
  )
}

// A genuinely round tower, inscribed in the same (width, depth) footprint
// every other body shape uses — a non-uniform width/depth scale turns the
// circle into an ellipse, which reads as "round," not a bug.
const CYLINDER_SEGMENTS = 14
function shadedCylinderGeometry(): THREE.BufferGeometry {
  return bakeLitVertexColors(new THREE.CylinderGeometry(0.5, 0.5, 1, CYLINDER_SEGMENTS))
}

const hslScratch = { h: 0, s: 0, l: 0 }

// The "fluorescent toy block" look wasn't really a brightness problem,
// scaling a fully-saturated hex color by <1 just makes a darker version of
// the same saturated hue, it doesn't make it read as a material. Pulling
// *saturation* down (keeping only a hint of the language hue) and clamping
// lightness low gives a dark, muted structural volume instead, the
// language color's job becomes the edge trim and windows, not the walls.
function bodyColor(b: Building): THREE.Color {
  new THREE.Color(b.color).getHSL(hslScratch)
  const lightness = b.stale ? 0.05 : 0.09 + b.intensity * 0.08
  const saturation = b.stale ? 0.12 : 0.32
  return new THREE.Color().setHSL(hslScratch.h, saturation, lightness)
}

function trimColor(b: Building): THREE.Color {
  const color = new THREE.Color(b.color)
  const boost = b.stale ? 0.3 : 1.0 + b.intensity * 1.0
  return color.multiplyScalar(boost)
}

// `taperTopFraction` matches shadedTowerGeometry's own top-radius fraction
// (1 for a plain box, no taper at all): a tower's wall isn't at a constant
// `b.width/2` from center the way a box's is, it narrows linearly toward
// the roof, a fixed offset put every upper-row window floating outside the
// actual (now narrower) body — visible even at typical building sizes, not
// a subtle edge case. `widthAt(rowFrac)` gives each row's own true wall
// half-width instead, both for how far out the window sits (the bug) and
// for how its own column spread is laid out across that row's own width,
// so nothing changes at all for a plain box (taperTopFraction=1 collapses
// widthAt to a constant b.width, identical to the old fixed formula).
function buildWindows(buildings: Building[], taperTopFraction = 1): WindowInstance[] {
  const windows: WindowInstance[] = []
  for (const b of buildings) {
    const rows = Math.min(MAX_WINDOW_ROWS, Math.max(1, Math.floor(b.height / WINDOW_ROW_SPACING)))
    const cols = Math.min(MAX_WINDOW_COLS, Math.max(1, Math.floor(b.width / WINDOW_COL_SPACING)))
    const litProb = b.stale ? WINDOW_LIT_PROB_STALE : WINDOW_LIT_PROB_ACTIVE

    for (const side of [1, -1]) {
      for (let r = 0; r < rows; r++) {
        const rowFrac = (r + 0.5) / rows
        const widthAtRow = b.width * (1 - rowFrac * (1 - taperTopFraction))
        for (let c = 0; c < cols; c++) {
          if (Math.random() > litProb) continue
          windows.push({
            x: b.x + side * (widthAtRow / 2 + 0.03),
            y: rowFrac * b.height,
            z: b.z + ((c + 0.5) / cols) * widthAtRow - widthAtRow / 2,
            rotationY: side === 1 ? Math.PI / 2 : -Math.PI / 2,
            phase: Math.random() * Math.PI * 2,
            flicker:
              Math.random() < WINDOW_FLICKER_PROB
                ? WINDOW_FLICKER_MIN + Math.random() * (WINDOW_FLICKER_MAX - WINDOW_FLICKER_MIN)
                : 0,
          })
        }
      }
    }
  }
  return windows
}

// AC units, tanks, vents, the rooftop clutter real buildings have instead
// of a perfectly clean flat top. Neutral utility color, not tied to the
// building's own language hue, since these read as infrastructure.
// `taperTopFraction` (see buildWindows) — a tower's actual roof is
// narrower than its base by this same fraction, jittering props across
// the full base-width `usable` range would land some of them past the
// real (narrower) rooftop's own edge, same "assumes a box footprint" bug
// as the windows one, just for the roof clutter instead of the walls.
function buildRoofProps(buildings: Building[], taperTopFraction = 1): RoofProp[] {
  const props: RoofProp[] = []
  for (const b of buildings) {
    if (b.landmark) continue // keep the beacon's roof clean
    const count = 1 + Math.floor(Math.random() * 3)
    const roofWidth = b.width * taperTopFraction
    for (let i = 0; i < count; i++) {
      const margin = 0.3
      const usable = Math.max(0.15, roofWidth - margin * 2)
      const sy = 0.15 + Math.random() * 0.3
      props.push({
        x: b.x + (Math.random() - 0.5) * usable,
        y: b.height + sy / 2,
        z: b.z + (Math.random() - 0.5) * usable,
        sx: 0.15 + Math.random() * 0.25,
        sy,
        sz: 0.15 + Math.random() * 0.25,
      })
    }
  }
  return props
}

// A narrower "penthouse" volume on top of some taller buildings, giving a
// stepped-setback silhouette instead of every tower being a plain extruded
// box. Reuses bodyColor so it reads as part of the same structure.
function buildTiers(buildings: Building[]): Tier[] {
  const tiers: Tier[] = []
  for (const b of buildings) {
    if (b.height < TIER_MIN_HEIGHT || Math.random() > TIER_PROBABILITY) continue
    const startFrac = 0.55 + Math.random() * 0.25
    const baseY = b.height * startFrac
    const height = b.height - baseY + b.height * 0.08
    const inset = 0.55 + Math.random() * 0.2
    tiers.push({
      x: b.x,
      y: baseY + height / 2,
      z: b.z,
      width: b.width * inset,
      height,
      depth: b.depth * inset,
      color: bodyColor(b),
    })
  }
  return tiers
}

interface BoxVolume {
  owner: Building
  x: number
  y: number
  z: number
  width: number
  height: number
  depth: number
  color: THREE.Color
}

// One volume per box-variant building, plus a second smaller undecorated
// "wing" volume on a minority of the bigger ones, attached flush against
// one side, for an L-shaped footprint — reuses the same proven box
// geometry/shading rather than hand-building a true extruded L outline,
// the same "undecorated secondary volume" idea buildTiers already uses,
// just offset to a side instead of stacked on top. `owner` carries the
// wing back to its parent building for hover/click, a wing has no repo of
// its own to open.
function buildBoxVolumes(boxBuildings: Building[]): BoxVolume[] {
  const volumes: BoxVolume[] = []
  for (const b of boxBuildings) {
    const color = bodyColor(b)
    volumes.push({
      owner: b,
      x: b.x,
      y: b.height / 2,
      z: b.z,
      width: b.width,
      height: b.height,
      depth: b.depth,
      color,
    })

    const eligible = !b.landmark && b.width >= LWING_MIN_SIZE && b.depth >= LWING_MIN_SIZE
    if (!eligible || Math.random() > LWING_PROBABILITY) continue

    const dir = Math.floor(Math.random() * 4) // 0:+x 1:-x 2:+z 3:-z
    const extendsAlongX = dir < 2
    const spanMax = extendsAlongX ? b.depth : b.width
    const wingProtrusion = (extendsAlongX ? b.width : b.depth) * (0.35 + Math.random() * 0.25)
    const wingSpan = spanMax * (0.4 + Math.random() * 0.3)
    const wingHeight = b.height * (0.4 + Math.random() * 0.4)
    const overlap = 0.15 // slight overlap into the main volume, no seam
    const jitter = (Math.random() * 2 - 1) * Math.max(0, (spanMax - wingSpan) / 2)

    let wx = b.x
    let wz = b.z
    if (dir === 0) wx = b.x + b.width / 2 + wingProtrusion / 2 - overlap
    else if (dir === 1) wx = b.x - b.width / 2 - wingProtrusion / 2 + overlap
    else if (dir === 2) wz = b.z + b.depth / 2 + wingProtrusion / 2 - overlap
    else wz = b.z - b.depth / 2 - wingProtrusion / 2 + overlap

    if (extendsAlongX) wz += jitter
    else wx += jitter

    volumes.push({
      owner: b,
      x: wx,
      y: wingHeight / 2,
      z: wz,
      width: extendsAlongX ? wingProtrusion : wingSpan,
      height: wingHeight,
      depth: extendsAlongX ? wingSpan : wingProtrusion,
      color,
    })
  }
  return volumes
}

export default function BuildingField({ buildings, onHover, onSelect, curvature }: BuildingFieldProps) {
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const towerMesh = useRef<THREE.InstancedMesh>(null!)
  const cylinderMesh = useRef<THREE.InstancedMesh>(null!)
  const forkMesh = useRef<THREE.InstancedMesh>(null!)
  const trimMesh = useRef<THREE.InstancedMesh>(null!)
  const windowMesh = useRef<THREE.InstancedMesh>(null!)
  const roofPropMesh = useRef<THREE.InstancedMesh>(null!)
  const tierMesh = useRef<THREE.InstancedMesh>(null!)
  const landmarkMesh = useRef<THREE.InstancedMesh>(null!)

  const bodyGeometry = useMemo(() => shadedBoxGeometry(), [])
  const towerGeometry = useMemo(() => shadedTowerGeometry(), [])
  const cylinderGeometry = useMemo(() => shadedCylinderGeometry(), [])

  const variantByRepo = useMemo(() => {
    const map = new Map<string, BodyVariant>()
    for (const b of buildings) map.set(b.repoName, pickBodyVariant(b))
    return map
  }, [buildings])
  const boxBuildings = useMemo(
    () => buildings.filter((b) => variantByRepo.get(b.repoName) === 'box'),
    [buildings, variantByRepo],
  )
  const towerBuildings = useMemo(
    () => buildings.filter((b) => variantByRepo.get(b.repoName) === 'tower'),
    [buildings, variantByRepo],
  )
  const cylinderBuildings = useMemo(
    () => buildings.filter((b) => variantByRepo.get(b.repoName) === 'cylinder'),
    [buildings, variantByRepo],
  )
  const boxVolumes = useMemo(() => buildBoxVolumes(boxBuildings), [boxBuildings])

  const landmarks = useMemo(() => buildings.filter((b) => b.landmark), [buildings])
  const forks = useMemo(() => buildings.filter((b) => b.fork), [buildings])
  // Windows only make sense on a body with flat side walls — box and
  // tower both qualify, a round cylinder's curved wall has no flat plane
  // to place one on. The tower call passes its own TOWER_TOP_FRACTION so
  // buildWindows can taper each row's placement to match (see its own
  // comment) — the box call leaves it at the default (no taper).
  const windows = useMemo(
    () => [...buildWindows(boxBuildings), ...buildWindows(towerBuildings, TOWER_TOP_FRACTION)],
    [boxBuildings, towerBuildings],
  )
  const roofProps = useMemo(
    () => [
      ...buildRoofProps(boxBuildings),
      ...buildRoofProps(towerBuildings, TOWER_TOP_FRACTION),
      ...buildRoofProps(cylinderBuildings),
    ],
    [boxBuildings, towerBuildings, cylinderBuildings],
  )
  const tiers = useMemo(() => buildTiers(boxBuildings), [boxBuildings])

  useLayoutEffect(() => {
    if (!mesh.current || boxVolumes.length === 0) return
    const dummy = new THREE.Object3D()
    boxVolumes.forEach((v, i) => {
      placeDummy(dummy, v.x, v.y, v.z, 0, curvature)
      dummy.scale.set(v.width, v.height, v.depth)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
      mesh.current.setColorAt(i, v.color)
    })
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
  }, [boxVolumes, curvature])

  // Tapered and round bodies each get their own instanced field, sized and
  // colored exactly like a box body would be (same bodyColor, same
  // per-building footprint), just a different base geometry.
  useLayoutEffect(() => {
    if (!towerMesh.current || towerBuildings.length === 0) return
    const dummy = new THREE.Object3D()
    towerBuildings.forEach((b, i) => {
      placeDummy(dummy, b.x, b.height / 2, b.z, 0, curvature)
      dummy.scale.set(b.width, b.height, b.depth)
      dummy.updateMatrix()
      towerMesh.current.setMatrixAt(i, dummy.matrix)
      towerMesh.current.setColorAt(i, bodyColor(b))
    })
    towerMesh.current.instanceMatrix.needsUpdate = true
    if (towerMesh.current.instanceColor) towerMesh.current.instanceColor.needsUpdate = true
  }, [towerBuildings, curvature])

  useLayoutEffect(() => {
    if (!cylinderMesh.current || cylinderBuildings.length === 0) return
    const dummy = new THREE.Object3D()
    cylinderBuildings.forEach((b, i) => {
      placeDummy(dummy, b.x, b.height / 2, b.z, 0, curvature)
      dummy.scale.set(b.width, b.height, b.depth)
      dummy.updateMatrix()
      cylinderMesh.current.setMatrixAt(i, dummy.matrix)
      cylinderMesh.current.setColorAt(i, bodyColor(b))
    })
    cylinderMesh.current.instanceMatrix.needsUpdate = true
    if (cylinderMesh.current.instanceColor) cylinderMesh.current.instanceColor.needsUpdate = true
  }, [cylinderBuildings, curvature])

  useLayoutEffect(() => {
    if (!forkMesh.current || forks.length === 0) return
    const dummy = new THREE.Object3D()
    forks.forEach((b, i) => {
      placeDummy(dummy, b.x, b.height + FORK_CAP_HEIGHT / 2, b.z, 0, curvature)
      dummy.scale.set(b.width * 0.55, FORK_CAP_HEIGHT, b.depth * 0.55)
      dummy.updateMatrix()
      forkMesh.current.setMatrixAt(i, dummy.matrix)
    })
    forkMesh.current.instanceMatrix.needsUpdate = true
  }, [forks, curvature])

  // Four thin glowing corner bars per box-variant building, the actual
  // Tron-style "glowing edges on a dark volume" look; the body color alone
  // (however bright) still reads as a flat box without this. Tapered and
  // round bodies don't get one — a round tower has no corners, and a
  // straight vertical bar at the tapered tower's full base width would
  // visibly jut past its own narrower top.
  useLayoutEffect(() => {
    if (!trimMesh.current || boxBuildings.length === 0) return
    const dummy = new THREE.Object3D()
    const corners: Array<[number, number]> = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]
    let idx = 0
    boxBuildings.forEach((b) => {
      const color = trimColor(b)
      corners.forEach(([cx, cz]) => {
        placeDummy(dummy, b.x + (cx * b.width) / 2, b.height / 2, b.z + (cz * b.depth) / 2, 0, curvature)
        dummy.scale.set(EDGE_TRIM, b.height, EDGE_TRIM)
        dummy.updateMatrix()
        trimMesh.current.setMatrixAt(idx, dummy.matrix)
        trimMesh.current.setColorAt(idx, color)
        idx++
      })
    })
    trimMesh.current.instanceMatrix.needsUpdate = true
    if (trimMesh.current.instanceColor) trimMesh.current.instanceColor.needsUpdate = true
  }, [boxBuildings, curvature])

  useLayoutEffect(() => {
    if (!windowMesh.current || windows.length === 0) return
    const dummy = new THREE.Object3D()
    const phases = new Float32Array(windows.length)
    const flickers = new Float32Array(windows.length)
    windows.forEach((w, i) => {
      placeDummy(dummy, w.x, w.y, w.z, w.rotationY, curvature)
      dummy.scale.set(WINDOW_WIDTH, WINDOW_HEIGHT, 1)
      dummy.updateMatrix()
      windowMesh.current.setMatrixAt(i, dummy.matrix)
      phases[i] = w.phase
      flickers[i] = w.flicker
    })
    windowMesh.current.instanceMatrix.needsUpdate = true
    windowMesh.current.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1))
    windowMesh.current.geometry.setAttribute('aFlicker', new THREE.InstancedBufferAttribute(flickers, 1))
  }, [windows, curvature])

  // Captured once from onBeforeCompile below, then mutated in place every
  // frame — three.js keeps reading the same object reference for a raw
  // (non-ShaderMaterial) material's compiled uniforms, this is the
  // standard way to animate an onBeforeCompile hook after the fact.
  const windowShader = useRef<{ uniforms: { uTime: { value: number } } } | null>(null)
  useFrame(({ clock }) => {
    if (windowShader.current) windowShader.current.uniforms.uTime.value = clock.elapsedTime
  })

  useLayoutEffect(() => {
    if (!roofPropMesh.current || roofProps.length === 0) return
    const dummy = new THREE.Object3D()
    roofProps.forEach((p, i) => {
      placeDummy(dummy, p.x, p.y, p.z, 0, curvature)
      dummy.scale.set(p.sx, p.sy, p.sz)
      dummy.updateMatrix()
      roofPropMesh.current.setMatrixAt(i, dummy.matrix)
    })
    roofPropMesh.current.instanceMatrix.needsUpdate = true
  }, [roofProps, curvature])

  useLayoutEffect(() => {
    if (!tierMesh.current || tiers.length === 0) return
    const dummy = new THREE.Object3D()
    tiers.forEach((t, i) => {
      placeDummy(dummy, t.x, t.y, t.z, 0, curvature)
      dummy.scale.set(t.width, t.height, t.depth)
      dummy.updateMatrix()
      tierMesh.current.setMatrixAt(i, dummy.matrix)
      tierMesh.current.setColorAt(i, t.color)
    })
    tierMesh.current.instanceMatrix.needsUpdate = true
    if (tierMesh.current.instanceColor) tierMesh.current.instanceColor.needsUpdate = true
  }, [tiers, curvature])

  // Rooftop beacons on the top-starred repos — a thin glowing spire per
  // landmark, cheap and low-count on its own, but a non-instanced `<mesh>`
  // per landmark (what this used to be) is still its own draw call, and
  // this scene can have many landmark-bearing cities rendered at once (see
  // planet-scene.tsx). Instanced like every other prop here instead.
  useLayoutEffect(() => {
    if (!landmarkMesh.current || landmarks.length === 0) return
    const dummy = new THREE.Object3D()
    landmarks.forEach((b, i) => {
      placeDummy(dummy, b.x, b.height + 6, b.z, 0, curvature)
      dummy.updateMatrix()
      landmarkMesh.current.setMatrixAt(i, dummy.matrix)
      landmarkMesh.current.setColorAt(i, new THREE.Color(b.color))
    })
    landmarkMesh.current.instanceMatrix.needsUpdate = true
    if (landmarkMesh.current.instanceColor) landmarkMesh.current.instanceColor.needsUpdate = true
  }, [landmarks, curvature])

  return (
    <>
      <instancedMesh
        ref={mesh}
        args={[bodyGeometry, undefined, boxVolumes.length]}
        onPointerMove={(e) => {
          e.stopPropagation()
          if (e.instanceId != null) onHover(boxVolumes[e.instanceId]?.owner ?? null)
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation()
          const owner = e.instanceId != null ? boxVolumes[e.instanceId]?.owner : undefined
          if (owner) onSelect(owner)
        }}
      >
        <meshBasicMaterial toneMapped={false} vertexColors />
      </instancedMesh>

      {towerBuildings.length > 0 && (
        <instancedMesh
          ref={towerMesh}
          args={[towerGeometry, undefined, towerBuildings.length]}
          onPointerMove={(e) => {
            e.stopPropagation()
            if (e.instanceId != null) onHover(towerBuildings[e.instanceId])
          }}
          onPointerOut={() => onHover(null)}
          onClick={(e) => {
            e.stopPropagation()
            if (e.instanceId != null) onSelect(towerBuildings[e.instanceId])
          }}
        >
          <meshBasicMaterial toneMapped={false} vertexColors />
        </instancedMesh>
      )}

      {cylinderBuildings.length > 0 && (
        <instancedMesh
          ref={cylinderMesh}
          args={[cylinderGeometry, undefined, cylinderBuildings.length]}
          onPointerMove={(e) => {
            e.stopPropagation()
            if (e.instanceId != null) onHover(cylinderBuildings[e.instanceId])
          }}
          onPointerOut={() => onHover(null)}
          onClick={(e) => {
            e.stopPropagation()
            if (e.instanceId != null) onSelect(cylinderBuildings[e.instanceId])
          }}
        >
          <meshBasicMaterial toneMapped={false} vertexColors />
        </instancedMesh>
      )}

      <instancedMesh ref={trimMesh} args={[undefined, undefined, boxBuildings.length * 4]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {windows.length > 0 && (
        <instancedMesh ref={windowMesh} args={[undefined, undefined, windows.length]}>
          <planeGeometry args={[1, 1]} />
          {/* A handful of windows dim and recover on a hashed sine phase
              (aFlicker=0 for most, so they stay perfectly steady), plus a
              fake fresnel reflection — both grafted onto the stock material
              via onBeforeCompile rather than a full custom shader, since
              everything else about a window (color, double-sided plane) is
              still just meshBasicMaterial. The reflection reads the
              instance's own world-space facing direction straight out of
              `instanceMatrix` (already correctly baked with each window's
              individual curvature tilt, see placeDummy) composed with
              `modelMatrix`, both standard three.js built-ins, no extra
              per-instance attribute needed for it. */}
          <meshBasicMaterial
            color={WINDOW_COLOR}
            toneMapped={false}
            side={THREE.DoubleSide}
            onBeforeCompile={(shader) => {
              shader.uniforms.uTime = { value: 0 }
              shader.uniforms.reflectionColor = { value: new THREE.Color(WINDOW_REFLECTION_COLOR) }
              shader.vertexShader = shader.vertexShader
                .replace(
                  '#include <common>',
                  '#include <common>\nattribute float aPhase;\nattribute float aFlicker;\nvarying float vPhase;\nvarying float vFlicker;\nvarying vec3 vNormalW;\nvarying vec3 vWorldPosW;',
                )
                .replace(
                  '#include <begin_vertex>',
                  `#include <begin_vertex>
                  vPhase = aPhase;
                  vFlicker = aFlicker;
                  vNormalW = normalize((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
                  vWorldPosW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`,
                )
              shader.fragmentShader = shader.fragmentShader
                .replace(
                  '#include <common>',
                  '#include <common>\nuniform float uTime;\nuniform vec3 reflectionColor;\nvarying float vPhase;\nvarying float vFlicker;\nvarying vec3 vNormalW;\nvarying vec3 vWorldPosW;',
                )
                .replace(
                  '#include <color_fragment>',
                  `#include <color_fragment>
                  float windowFlickerFactor = 1.0 - vFlicker * (0.5 + 0.5 * sin(uTime * ${WINDOW_FLICKER_SPEED.toFixed(1)} + vPhase));
                  diffuseColor.rgb *= windowFlickerFactor;
                  vec3 windowViewDir = normalize(cameraPosition - vWorldPosW);
                  float windowFresnel = pow(1.0 - clamp(abs(dot(normalize(vNormalW), windowViewDir)), 0.0, 1.0), ${WINDOW_REFLECTION_POWER.toFixed(1)});
                  diffuseColor.rgb += reflectionColor * windowFresnel * ${WINDOW_REFLECTION_STRENGTH.toFixed(2)};`,
                )
              windowShader.current = shader as unknown as { uniforms: { uTime: { value: number } } }
            }}
          />
        </instancedMesh>
      )}

      {tiers.length > 0 && (
        <instancedMesh ref={tierMesh} args={[bodyGeometry, undefined, tiers.length]}>
          <meshBasicMaterial toneMapped={false} vertexColors />
        </instancedMesh>
      )}

      {roofProps.length > 0 && (
        <instancedMesh ref={roofPropMesh} args={[undefined, undefined, roofProps.length]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={ROOF_PROP_COLOR} toneMapped={false} />
        </instancedMesh>
      )}

      {/* Forks get a small "prefab" cap, a modular block bolted on top,
          distinct from an original repo's clean single volume. */}
      {forks.length > 0 && (
        <instancedMesh ref={forkMesh} args={[undefined, undefined, forks.length]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#cfd8ff" toneMapped={false} />
        </instancedMesh>
      )}

      {landmarks.length > 0 && (
        <instancedMesh ref={landmarkMesh} args={[undefined, undefined, landmarks.length]}>
          <cylinderGeometry args={[0.04, 0.04, 12, 6]} />
          <meshBasicMaterial toneMapped={false} transparent opacity={0.55} />
        </instancedMesh>
      )}
    </>
  )
}
