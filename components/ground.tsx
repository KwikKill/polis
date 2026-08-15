'use client'

import { Grid, MeshReflectorMaterial } from '@react-three/drei'

// Wet-asphalt reflection (Blade Runner) under a faint glowing grid (Tron) —
// the reflection is what sells the "night city" depth, the grid keeps the
// near-camera ground legible instead of just black void.
export default function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[500, 500]} />
        <MeshReflectorMaterial
          blur={[300, 100]}
          resolution={1024}
          mixBlur={1}
          mixStrength={35}
          roughness={1}
          depthScale={1.2}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color="#050308"
          metalness={0.4}
        />
      </mesh>
      <Grid
        position={[0, 0, 0]}
        cellSize={2}
        cellThickness={0.5}
        cellColor="#3a1c5c"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#ff00ff"
        fadeDistance={90}
        fadeStrength={1}
        infiniteGrid
      />
    </group>
  )
}
