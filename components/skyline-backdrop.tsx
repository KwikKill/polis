// A fixed, hand-picked skyline (not generated from any real data — used
// on pages with no city to actually draw), dim and faint enough to read
// as texture rather than content, just varied enough not to look like a
// repeating pattern. Shared by both the per-city not-found page and the
// site-wide one, so every "nothing here" route still feels like it's
// inside Polis rather than the app having broken.
const SKYLINE_HEIGHTS = [22, 40, 18, 55, 30, 62, 25, 45, 20, 38, 58, 28, 42, 19, 33, 50, 24, 44, 21, 36]

export default function SkylineBackdrop() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center gap-1 px-8 opacity-25">
        {SKYLINE_HEIGHTS.map((h, i) => (
          <div key={i} className="w-6 flex-1 bg-foreground/20" style={{ height: `${h}%` }} />
        ))}
      </div>
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(transparent 95%, rgba(255,47,214,0.06) 95%), linear-gradient(90deg, transparent 95%, rgba(255,47,214,0.06) 95%)',
          backgroundSize: '48px 48px',
        }}
      />
    </>
  )
}
