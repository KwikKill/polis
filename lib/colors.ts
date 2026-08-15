// Night-city neon palette. Kept in the theme-ghost (magenta/violet) register,
// each language pushed to a distinct hue so a TypeScript-dominated skyline
// (the common case) doesn't read as monochrome. See app/globals.css for the
// ambient/base colors this is meant to sit against.
export const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3B82F6',
  JavaScript: '#F5A623',
  Python: '#F4D03F',
  Vue: '#3DDC84',
  'C#': '#9B59B6',
  Java: '#E67E22',
  'C++': '#FF69B4',
  C: '#7FDBFF',
  Go: '#00FFFF',
  Rust: '#FF4500',
  PHP: '#8E7CC3',
  Ruby: '#FF2D55',
  HTML: '#E34C26',
  CSS: '#B983FF',
  Shell: '#89E051',
  Dockerfile: '#00E5FF',
}

export const FALLBACK_LANGUAGE_COLOR = '#8A2BE2' // ambient violet — unlisted languages blend in rather than clash

export function getLanguageColor(language: string | null): string {
  if (!language) return FALLBACK_LANGUAGE_COLOR
  return LANGUAGE_COLORS[language] ?? FALLBACK_LANGUAGE_COLOR
}
