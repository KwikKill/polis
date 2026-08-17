'use client'

import { useMemo } from 'react'
import { estimatePopulation } from '@/lib/city-builder'
import type { PlanetCity as PlanetCityData } from '@/lib/types'

const populationFormatter = new Intl.NumberFormat('en', { notation: 'compact' })

// A plain scrollable roster next to the planet, not the full bracketed
// .polis-btn treatment per row — with a dozen-plus cities that much chrome
// repeated down a list would be noise, so rows stay plain text in the same
// font/color vocabulary instead. Clicking a row (or landing on it via
// Tab, see planet-scene.tsx) hands the city up to PlanetCameraFlight.
// Sorted by estimatePopulation()'s made-up but real number, biggest city
// first — reads as a leaderboard rather than an arbitrary alphabetical
// list, and the number itself doubles as a bit of texture on a page that
// was otherwise just names.
export default function PlanetDirectory({
  cities,
  focusedUsername,
  onSelect,
}: {
  cities: PlanetCityData[]
  focusedUsername: string | null
  onSelect: (city: PlanetCityData) => void
}) {
  const ranked = useMemo(
    () =>
      cities
        .map((city) => ({ city, population: estimatePopulation(city.buildings) }))
        .sort((a, b) => b.population - a.population),
    [cities],
  )

  if (ranked.length === 0) return null

  return (
    <div className="polis-hud-panel pointer-events-auto fixed top-24 right-6 bottom-24 z-10 flex w-60 flex-col">
      <div className="shrink-0 border-b border-line px-3 py-2">
        <p className="font-display text-xs uppercase tracking-widest text-foreground/60">Cities</p>
        <p className="mt-0.5 text-[0.65rem] text-foreground/40">
          Tab to cycle · click to visit · by population
        </p>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {ranked.map(({ city, population }) => {
          const isFocused = city.username.toLowerCase() === focusedUsername?.toLowerCase()
          return (
            <li key={city.username}>
              <button
                type="button"
                onClick={() => onSelect(city)}
                className={`flex w-full items-baseline justify-between gap-2 px-2 py-1.5 text-left font-display text-xs uppercase tracking-wide transition-colors hover:text-primary ${
                  isFocused ? 'text-data' : 'text-foreground/70'
                }`}
              >
                <span className="truncate">{city.username}</span>
                <span className="shrink-0 text-[0.68rem] text-foreground/40 tabular-nums">
                  {populationFormatter.format(population)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
