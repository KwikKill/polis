# Polis

Polis turns a GitHub account into a generative night city. Every repository
becomes a building: height maps to commit count, color maps to primary language,
and glow maps to stars. Cities can then be published to a shared, persistent 3D
planet where every connected user's city sits on the same sphere, linked by
roads.

Live at `polis.somi.blaisot.org`.

## Author

This project was created by [KwikKill](https://github.com/KwikKill) as a personal project to learn and practice React and Three.js. The project is open-source.


## Table of contents

- [Overview](#overview)
- [Tech stack](#tech-stack)
- [Data model](#data-model)
- [Technical deep dive](#technical-deep-dive)
- [GitHub data pipeline](#github-data-pipeline)
- [City generation](#city-generation)
- [Planet generation](#planet-generation)
- [Curved surface placement](#curved-surface-placement)
- [Terrain height field](#terrain-height-field)
- [Water rendering](#water-rendering)
- [Inter-city road routing](#inter-city-road-routing)
- [Concurrency control](#concurrency-control)
- [Development](#development)
- [Environment variables](#environment-variables)
- [Deployment](#deployment)

## Overview

Two views exist on top of the same underlying data:

- `/u/[username]`: one person's city, at full detail, generated from their
public GitHub repositories. - `/planet`: a single shared world. Any user with a
generated city can opt in from their own city page, and their city is placed on
a shared sphere alongside everyone else's, connected by roads.

The planet is one global, mutable space that many users write into concurrently,
which shapes a lot of the design described below.

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript - `@react-three/fiber` and
`three` for the 3D scenes, `@react-three/postprocessing` for bloom - Prisma 6
with PostgreSQL - Auth.js (`next-auth` v5 beta) with `@auth/prisma-adapter`,
GitHub OAuth, database sessions - `d3-delaunay` for city street layout,
`simplex-noise` for the planet's terrain field - Tailwind CSS 4 - Docker,
deployed behind nginx

## Data model

Two Prisma models carry the app's own data, alongside the standard Auth.js
adapter tables (`User`, `Account`, `Session`, `VerificationToken`):

```prisma
model City {
  id          String   @id @default(cuid())
  username    String   @unique
  userId      String   @unique
  data        Json 
  generatedAt DateTime @default(now())
  updatedAt   DateTime @updatedAt

  planetX Float?
  planetY Float?
  planetZ Float?
}
```

`data` is the full generated city (buildings, districts, roads) as JSON,
regenerated in place rather than versioned whenever the owner reconnects.
`planetX/Y/Z` is a unit vector on the planet's sphere. There is no separate
boolean flag for "is this city on the planet": `planetX !== null` is the flag,
so there is no reachable state where the fields disagree with each other.

## Technical deep dive

### GitHub data pipeline

`lib/github.ts` fetches up to 80 repositories per user (`type=owner`, sorted by
last push), then fetches each repo's per-language byte counts and commit count
with a small worker pool capped at 6 concurrent requests, so a large account
does not fire dozens of requests at once.

Commit count is not read from GitHub's `/stats/commit_activity` endpoint. That
endpoint is cache backed and returns `202 Accepted` on a cold cache while it
computes in the background, which is unreliable to block on during city
generation. Instead, `fetchCommitCount` requests exactly one commit per page
(`?per_page=1`) and reads the total commit count off the last page number in the
response's pagination `Link` header, a single synchronous request that also
covers full history rather than the last 52 weeks.

The first page of a user's repo list is treated specially: a 404 there means the
username does not exist, and a 403 with `x-ratelimit-remaining: 0` means the
request budget is exhausted (60 requests per hour per IP when unauthenticated).
Both surface as a distinct, readable error rather than silently producing an
empty city. Later pages or individual repo detail calls failing are left on the
existing quiet fallback, since a repo list with a few missing details is still
useful.

### City generation

`lib/city-builder.ts` takes a flat list of repositories and produces buildings,
districts, and roads.

**Layout is grouped by language.** Repositories are
grouped by primary language, and each language gets its own angular wedge sized
strictly proportionally to how many repos it has, with no minimum width floor: a
50/50 split between two languages renders as an exact half and half. The largest
language gets the first, most central wedge.

**Placement inside a wedge uses a low discrepancy sequence, not a random
scatter.** Within a district, repositories are placed oldest first, radiating
outward, using the fractional parts of `i * φ⁻¹` (the golden ratio conjugate,
`≈0.618`) to pick each point's angle within the wedge. This is the bounded
analogue of the classic sunflower spiral's golden angle, adapted because a full
2π sunflower spiral assumes the whole circle is available, while a district only
owns a slice of it. Radial growth is `BASE_RADIUS + SPIRAL_SPACING *
densityFactor * i^0.4`, where the exponent (0.4 instead of the usual 0.5) packs
more buildings close to downtown and less further out, and `densityFactor =
sqrt(2π / sectorWidth)` compensates narrow wedges so they do not cram their
buildings together relative to wide ones.

**Overlap is resolved afterward.** The spiral only
guarantees even density, not that two similarly sized buildings never collide. A
cheap O(n²) relaxation pass (`resolveOverlaps`) nudges overlapping pairs apart
along their center to center vector until nothing overlaps or a fixed iteration
budget is spent.

**Roads are the Voronoi diagram of the building centers**, built with
`d3-delaunay` (`Delaunay.from(points).voronoi(bounds)`).

Each building's cell is its own plot, and the boundaries between
neighboring cells are exactly the gaps between buildings, which is what actually
reads as a street network. Edges lying on the diagram's outer clipping rectangle
are filtered out so the clip itself does not show up as a rectangular frame.

Building height comes from a log normalized commit count, footprint from a log
normalized repo size, and glow intensity from a log normalized star count (with
a small floor so nothing is fully dark). The five most starred repos are marked
as landmarks and get a glow floor regardless of their computed intensity.
Staleness (no push in the last year, or archived) is applied as a rendering time
dimming multiplier rather than baked into the stored data, so a popular but
abandoned repo still reads as a large, dark, dead building rather than an
unremarkable small one.

### Planet generation

`lib/planet-builder.ts` places cities and water bodies on a shared sphere and
grows that sphere as more cities join: `radius = 120 + 35 * sqrt(cityCount)`.

**Placement is not a deterministic layout but a bounded rejection sampling**.
`findValidPlacement` draws uniformly distributed points on the unit sphere via
Marsaglia's method and tests each with `isValidPlacement`, which checks that the
candidate's own footprint (`cityExtent`, the real building reach, not just a
center point) clears every existing city's footprint and every water body's
footprint by a fixed security margin, using squared chord distance between unit
vectors (`|a-b|² = 2 - 2(a·b)`, monotonic with the angle between them, so no
inverse trig is needed just to compare distances). Joining the planet always
soft degrades to whichever candidate got furthest from its nearest neighbor if
no fully valid spot is found within the attempt budget, since the join itself
should not simply fail. A user explicitly relocating their own city, by
contrast, is rejected outright on an invalid spot, since silently placing them
elsewhere without asking would be worse.

**Water bodies are not scattered independently but chosen by terrain.** A wide,
evenly spread candidate pool (a Fibonacci lattice on the sphere, deterministic,
no randomness) is sampled against the terrain height field described below, and
the lowest candidates become water bodies. Each one's size is driven by how deep
its own spot is relative to the other selected bodies, raised to a power
(`t^2.5`) so the handful of deepest valleys come out ocean scale while most stay
modest lake scale, an intentionally uneven mix rather than a smooth gradient. A
multi pass collision pass then shrinks any pair of water bodies that ends up too
close, run for several passes since resolving one pair can reopen a conflict
with a third body in a tight cluster.

Nothing on the planet uses `Math.random()`. City placement is randomized by
design (any two users should not predictably collide), but the terrain, the
water bodies, and their sizes are all seeded and deterministic, the same for
every visitor.

### Curved surface placement

Every city on the planet is a "sticker": a local tangent plane group, positioned
at the city's own surface point and rotated so its local up axis matches the
outward surface normal there (`Quaternion.setFromUnitVectors`). Everything
inside that group (buildings, roads, sidewalks, streetlights, vehicles) is
generated in ordinary flat local coordinates, unaware it is being wrapped onto a
sphere.

At small sizes relative to the planet, a flat tangent plane point is close
enough to the true curved surface that the difference does not show. At real
city sizes it does: `lib/sphere-curve.ts` exists specifically to correct for
this. `curveWorldPoint` takes a local (x, z) offset, projects it outward from
the tangent contact point (a gnomonic style projection, only accurate near its
own contact point), then renormalizes the result onto the true surface at that
new direction. `curveLocalPoint` does the same thing but converts the result
back into the group's own local space, so it can be substituted directly for a
flat vertex without touching any of the surrounding geometry code.
`curvedLocalPlacement` is the per instance version used for scattered props
(individual buildings, streetlights, vehicles), returning both a corrected
position and its own tilt quaternion, since a prop out near a large city's edge
needs to stand normal to its own local surface, not the surface at the city's
center.

### Water rendering

Water bodies (lakes and, at the deep end of the size range, oceans) are painted
directly into the planet surface mesh's own fragment shader, rather than
rendered as a second mesh sitting on top of the ground.

This replaced two earlier techniques, both of which rendered water as a separate
shoreline mesh: first a flat tangent plane projection (which self-intersected
once a body's radius passed roughly ten percent of the planet's radius), then an
exact spherical polar coordinate version (which fixed the self-intersection but,
being a second surface, always needed some mechanism, a geometric lift or a GPU
depth bias, to avoid z-fighting or a visible seam against the ground beneath it,
and every version of that mechanism left a residual gap at some size). Since a
second mesh trying to stay perfectly aligned with a first one is the actual
source of the problem, the fix was to stop having a second mesh.

Instead, each water body is described purely as data (a center direction, an
angular radius, and a seed) passed to the ground shader as fixed length uniform
arrays sized to `WATER_COUNT`. Per fragment, `waterCoverage` reconstructs that
fragment's angular distance and azimuth from the body's center, using the same
`vPos`/`normalize(vPos)` the grid overlay above it already reads, applies a
small multi harmonic wobble to the body's edge for an irregular, non circular
shoreline, and blends to the water color inside a soft, anti-aliased angular
edge. Because the water color is computed from literally the same vertex data as
the ground it sits on, there is no second surface left that could ever be offset
from the first.

### Inter-city road routing

Planet wide roads (`buildPlanetRoads`) connect nearby cities to each other,
layered on top of the curved surface and terrain systems above.

**Neighbor selection is K nearest neighbors**. Planet cities are sparse and unevenly distributed, and a full
spherical Delaunay triangulation of a sparse point set tends to produce long
edges reaching across empty space just to remain a valid triangulation, the
opposite of "nearby." Each city connects to its three nearest neighbors (by
chord distance), with an edge kept if either city claims the other.

**The connections meets an actual street.**
`cityEdgePoint` picks whichever of a city's own road endpoints reaches furthest
toward a given direction, so an inter-city road visibly continues one of that
city's own streets instead of hovering in from directly overhead. The two ends
of a connection are chosen asymmetrically: one city's point aims at the other
city's center, and the other city's point then aims back at that already chosen
point rather than at a center independently, so the two ends face each other
instead of drifting slightly apart.

**A road that would cut through a third city's own footprint is dropped
entirely**, and not rerouted, on the reasoning that the third city is presumably
already connected to both endpoints through its own KNN edges, so the direct
link is redundant as well as visually wrong.

**A road that would cut through a lake or ocean is bent around it**, since there
is no third city to reroute through there. This needed two real fixes before it
worked. Pushing only the single closest point away from the water body left the
straight legs on either side of that point free to cut back through the
exclusion zone, so the actual fix samples several points along the stretch of
the original straight path that falls inside the exclusion zone and pushes each
of them out individually, which keeps the connecting chords close to the water
body's own boundary arc. 

Each rendered road segment is sampled densely enough (24 straight sub-segments
per curved leg) that its endpoints track the terrain height field underneath it,
so a road visibly rises and falls over hills instead of floating at one constant
height or clipping straight through them.

### Concurrency control

The planet is one set of database rows that many users can write to at the same
time. Two users joining or relocating at once is a real instance of write skew:
each transaction reads a snapshot of "who else is on the planet" that does not
include the other transaction's in-flight write, and neither PostgreSQL's
default READ COMMITTED nor REPEATABLE READ isolation level actually prevents
that for two separate rows. `joinPlanet` and `relocateCity` in
`lib/planet-service.ts` both run inside a SERIALIZABLE transaction, which does
detect the conflict, and both retry automatically on Prisma's `P2034` write
conflict error code up to five times.

## Development

```bash pnpm install pnpm dev ```

Requires a running PostgreSQL instance (`DATABASE_URL`) and, for a real sign-in,
a GitHub OAuth App. In `NODE_ENV=development`, the homepage also renders a dev
sign-in panel that creates a session for any username with no OAuth round trip
at all, generating that user's city unauthenticated the first time. Because
unauthenticated GitHub requests are capped at 60 per hour per IP and a single
city generation can be well over 100 requests, set `GITHUB_TOKEN` to any
personal access token (no scopes needed) locally to raise that to 5000 per hour.

## Environment variables

See `.env.example` for the full list. In short:

- `DATABASE_URL`: PostgreSQL connection string.
- `AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST`: Auth.js configuration.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: GitHub OAuth App credentials. Callback URL is
`<AUTH_URL>/api/auth/callback/github`.
- `GITHUB_TOKEN` (optional): raises the
GitHub API rate limit for local development, no scopes needed since only public
data is ever read.
- `REFRESH_SECRET`: bearer token required by `POST
/api/cities/refresh`, for a scheduled refresh of published cities.

## Deployment

Built and run via Docker (`Dockerfile`, `Dockerfile.dev` for local development),
served behind nginx. Compose files for both the production and beta environments
live at the repository root, alongside the shared `cert.sh` entry used to issue
this site's TLS certificate.

A `polis-cron` service (`polis/cron`, production compose file only) calls `POST
/api/cities/refresh` every six hours over the internal `polis` Docker network,
keeping published cities from going stale without any public endpoint or extra
credentials, it reuses each owner's own stored GitHub OAuth token. Small dcron
plus curl image, the same shape as the esport project's own cron container.
