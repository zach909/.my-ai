/**
 * Whether this browser has already been shown the guided tour.
 *
 * Split out of AppTour.tsx because a file exporting both a component and a
 * plain function breaks React Fast Refresh — the module gets fully remounted
 * on edit instead of hot-swapping, which is why eslint's react-refresh rule
 * treats it as an error rather than a style preference.
 *
 * The key is versioned so the tour can be shown again when its content changes
 * materially, without needing a migration.
 */

const TOUR_VERSION = 1
const SEEN_KEY = `neuroclaw.tour.seen.v${TOUR_VERSION}`

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    // Private windows and blocked site data throw on access. Reporting "not
    // seen" means the tour reappears, a far better failure than refusing to
    // render the app.
    return false
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // Same reasoning: a tour that reappears next launch beats a crash.
  }
}
