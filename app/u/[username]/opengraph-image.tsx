import { ImageResponse } from 'next/og'
import { getCity } from '@/lib/city-service'

export const alt = 'A generative city skyline built from a GitHub profile, on Polis'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Next wires this up to the page's own metadata automatically (the file
// convention alone is enough, no generateMetadata entry needed for the
// image itself) — sharing a /u/[username] link now shows that specific
// person's actual skyline instead of the one static site-wide card every
// page used to fall back to.
//
// No custom font loaded (Satori's bundled fallback is used as-is): a
// per-request remote font fetch is real complexity for a visual detail
// most viewers will only see for a second in a link preview, not worth it
// at this scope.
export default async function Image({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const city = await getCity(username)

  if (!city) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0a0910',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 26,
              letterSpacing: 8,
              textTransform: 'uppercase',
              color: '#756a94',
            }}
          >
            Polis
          </div>
          <div style={{ display: 'flex', fontSize: 52, marginTop: 18, fontWeight: 700, color: '#eee9f7' }}>
            City not found
          </div>
        </div>
      ),
      size,
    )
  }

  const maxHeight = Math.max(...city.buildings.map((b) => b.height), 1)
  // Left-to-right by actual radial position, not by height, so the card's
  // silhouette is that person's *real* layout rather than a sorted bar
  // chart that happens to use their colors.
  const skyline = [...city.buildings].sort((a, b) => a.x - b.x).slice(0, 48)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#0a0910',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            background: 'radial-gradient(ellipse at 50% 100%, rgba(255,47,214,0.18), transparent 65%)',
          }}
        />

        {/* The same corner-bracket motif .polis-hud-panel draws in the
            real UI, so a shared link reads as unmistakably Polis even
            before anyone clicks it. */}
        <div
          style={{
            position: 'absolute',
            top: 28,
            left: 28,
            width: 30,
            height: 30,
            display: 'flex',
            borderTop: '3px solid #ff2fd6',
            borderLeft: '3px solid #ff2fd6',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 28,
            right: 28,
            width: 30,
            height: 30,
            display: 'flex',
            borderTop: '3px solid #ff2fd6',
            borderRight: '3px solid #ff2fd6',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 28,
            left: 28,
            width: 30,
            height: 30,
            display: 'flex',
            borderBottom: '3px solid #ff2fd6',
            borderLeft: '3px solid #ff2fd6',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 28,
            right: 28,
            width: 30,
            height: 30,
            display: 'flex',
            borderBottom: '3px solid #ff2fd6',
            borderRight: '3px solid #ff2fd6',
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', padding: '56px 64px 0' }}>
          <div
            style={{
              display: 'flex',
              fontSize: 22,
              letterSpacing: 6,
              textTransform: 'uppercase',
              color: '#756a94',
            }}
          >
            Polis
          </div>
          <div style={{ display: 'flex', fontSize: 60, fontWeight: 700, color: '#eee9f7', marginTop: 6 }}>
            {city.username}
          </div>
          <div style={{ display: 'flex', fontSize: 24, color: '#4de8ff', marginTop: 10 }}>
            {city.buildings.length} {city.buildings.length === 1 ? 'repository' : 'repositories'}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 6,
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 320,
            padding: '0 40px',
          }}
        >
          {skyline.map((b, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flex: 1,
                height: `${Math.max(6, (b.height / maxHeight) * 260)}px`,
                background: b.color,
                opacity: b.stale ? 0.35 : 0.55 + b.intensity * 0.4,
              }}
            />
          ))}
        </div>
      </div>
    ),
    size,
  )
}
