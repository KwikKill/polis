// Matches the credit-line convention used by amphion/athena, small muted
// copyright + "Made by" linking back to the main portfolio. Polis is a
// fullscreen scene rather than a scrolling page, so it's pinned to the
// bottom as part of the HUD chrome instead of sitting in normal doc flow.
export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex justify-center p-3">
      <p className="pointer-events-auto text-[0.7rem] text-foreground/40">
        © {year} Polis · Made by{' '}
        <a
          href="https://gabriel.blaisot.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground/60 underline decoration-primary/40 underline-offset-2 transition-colors hover:text-primary"
        >
          KwikKill
        </a>
      </p>
    </footer>
  )
}
