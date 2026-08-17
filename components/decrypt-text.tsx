'use client'

import { useEffect, useState } from 'react'

// Terminal/technical glyphs, not decorative script, matches a value
// "resolving" out of noise rather than a generic typewriter reveal.
const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&/\\<>[]'

function scrambleFrame(text: string, revealCount: number): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (i < revealCount || text[i] === ' ') out += text[i]
    else out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
  }
  return out
}

// A headline "decrypting" into its real value, left to right, out of
// random technical glyphs — the terminal-readout equivalent of a fade-in,
// used sparingly for genuine page/panel-arrival moments (not on content
// that changes continuously, like a hover tooltip, where it would just
// feel laggy rather than deliberate).
//
// Renders the real `text` on the server and on first client paint (so
// there's no hydration mismatch and no dependency on JS for the actual
// content, screen readers and no-JS visits just see the plain text); the
// scramble only starts from a `useEffect` after mount. The visible,
// scrambling characters are `aria-hidden`, an `aria-label` on the wrapper
// carries the real text throughout, so assistive tech never reads noise.
export default function DecryptText({
  text,
  as: Tag = 'span',
  className,
  scrambleMs,
  startDelayMs = 0,
}: {
  text: string
  as?: 'h1' | 'p' | 'span'
  className?: string
  scrambleMs?: number
  /** Delay before the scramble starts resolving, for staggering several of
   * these against a page's own entrance sequence (see the boot-sequence
   * note in globals.css). Shows a single static scrambled frame during the
   * wait rather than sitting on the final text, so it reads as "still
   * resolving" the whole time instead of two disconnected beats. */
  startDelayMs?: number
}) {
  const [display, setDisplay] = useState(text)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(text)
      return
    }

    const duration = scrambleMs ?? Math.min(900, Math.max(350, text.length * 28))
    let frame: number
    let startTimer: ReturnType<typeof setTimeout> | undefined

    function begin() {
      const start = performance.now()
      function tick(now: number) {
        const t = Math.min(1, (now - start) / duration)
        setDisplay(scrambleFrame(text, Math.floor(t * text.length)))
        if (t < 1) frame = requestAnimationFrame(tick)
        else setDisplay(text)
      }
      frame = requestAnimationFrame(tick)
    }

    if (startDelayMs > 0) {
      setDisplay(scrambleFrame(text, 0))
      startTimer = setTimeout(begin, startDelayMs)
    } else {
      begin()
    }

    return () => {
      cancelAnimationFrame(frame)
      if (startTimer) clearTimeout(startTimer)
    }
  }, [text, scrambleMs, startDelayMs])

  return (
    <Tag className={className} aria-label={text}>
      <span aria-hidden="true">{display}</span>
    </Tag>
  )
}
