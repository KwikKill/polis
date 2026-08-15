import { redirect } from 'next/navigation'
import { joinPlanet } from '@/lib/planet-service'

export default function AddToPlanetButton() {
  return (
    <form
      action={async () => {
        'use server'
        await joinPlanet()
        redirect('/planet')
      }}
    >
      <button type="submit" className="polis-btn">
        Add my city to the planet
      </button>
    </form>
  )
}
