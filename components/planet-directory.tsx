'use client'

import { useMemo, useState } from 'react'
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
//
// Below the sm breakpoint this defaults *closed*, a small tap target
// pinned near the bottom-right rather than the full-height sidebar — on a
// narrow portrait viewport that sidebar ate a real chunk of the planet
// view. `isOpen` starts false on both server and client so there's no
// hydration mismatch, and only actually changes anything below sm: at
// sm and above the ul/positioning is forced open unconditionally via `sm:`
// overrides, desktop behavior is unchanged from before this.
export default function PlanetDirectory({
  cities,
  focusedUsername,
  onSelect,
}: {
  cities: PlanetCityData[]
  focusedUsername: string | null
  onSelect: (city: PlanetCityData) => void
}) {
  const [isOpen, setIsOpen] = useState(false)

  const ranked = useMemo(
    () =>
      cities
        .map((city) => ({ city, population: estimatePopulation(city.buildings) }))
        .sort((a, b) => b.population - a.population),
    [cities],
  )

  if (ranked.length === 0) return null

  function handleSelect(city: PlanetCityData) {
    setIsOpen(false)
    onSelect(city)
  }

  return (
    <div
      className={`polis-hud-panel pointer-events-auto fixed z-10 flex flex-col sm:top-24 sm:right-6 sm:bottom-24 sm:left-auto sm:w-60 sm:max-h-none ${
        isOpen ? 'left-4 right-4 bottom-24 max-h-72' : 'right-4 bottom-24 w-auto'
      }`}
    >
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-2 sm:pointer-events-none"
      >
        <div>
          <p className="font-display text-xs uppercase tracking-widest text-foreground/60">
            Cities {!isOpen && <span className="tabular-nums sm:hidden">({ranked.length})</span>}
          </p>
          <p className="mt-0.5 hidden text-[0.65rem] text-foreground/40 sm:block">
            Tab to cycle · click to visit · by population
          </p>
        </div>
        <span className="shrink-0 font-display text-[0.65rem] uppercase tracking-wide text-foreground/50 sm:hidden">
          {isOpen ? 'Hide' : 'Show'}
        </span>
      </button>
      <ul className={`min-h-0 flex-1 overflow-y-auto px-1 py-1 sm:block ${isOpen ? '' : 'hidden'}`}>
        {ranked.map(({ city, population }) => {
          const isFocused = city.username.toLowerCase() === focusedUsername?.toLowerCase()
          return (
            <li key={city.username}>
              <button
                type="button"
                onClick={() => handleSelect(city)}
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
