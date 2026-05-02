# F1 Live

F1 live race tracker built for Meta smart glasses (Hypernova platform). Uses the free [OpenF1 API](https://openf1.org) for real-time and historical session data.

## Architecture

Three static files, no build step:

- `index.html` — screens and layout (600x600 viewport for Hypernova display)
- `styles.css` — dark theme with F1 red accent, focus states for D-pad/EMG navigation
- `app.js` — single IIFE with API layer, navigation, rendering, and refresh logic

## Screens

| Screen | Tab | Description |
|--------|-----|-------------|
| Leaderboard (Race) | Board | Race / Sprint Race only. Positions, team colors, tyre compound/age, gap/interval, PIT/DNF/FIN status |
| Leaderboard (Timed) | Board | Qualifying / Practice. Drivers ranked by best lap time, gap to P1's best |
| Track Map | Map | Circuit outline drawn from one lap of location data, car dots in team colors |
| Race Control | Race Ctrl | Flag messages (yellow/red/green/blue/chequered) with timestamps |
| Weather | Weather | Air/track temp, humidity, wind, pressure, rainfall |
| Driver Detail | (tap driver) | Position, gap, interval cards + last 15 lap times with sector splits |

The leaderboard branches on `session.session_type` early (before any race-only endpoint is requested), so Quali/Practice loads skip `/position`, `/intervals`, `/stints`, and `/pit` entirely. The glasses talk to the OpenF1 API through a Bluetooth proxy on the phone, so each saved round-trip matters.

## OpenF1 API Endpoints Used

| Endpoint | Purpose | Cache |
|----------|---------|-------|
| `/sessions` | Session metadata, live/finished status | 60s |
| `/drivers` | Driver names, teams, numbers | 60s |
| `/position` | Current standings | 60s |
| `/intervals` | Gaps to leader and intervals | 60s |
| `/stints` | Tyre compound and age, DNF detection | 60s |
| `/pit` | Pit stop times, in-pit detection | 60s |
| `/laps` | Lap times and sector splits (per driver on detail; whole field on Quali/Practice leaderboard) | 60s |
| `/location` | Track outline + live car positions (map) | 2-3s on map |
| `/race_control` | Flag and race control messages | 60s |
| `/weather` | Track conditions | 60s |

## Refresh Behavior

- **Leaderboard auto-refresh**: 10s interval, runs whenever the Board (home) screen is visible AND the session is live. No user toggle — live data when it matters, idle otherwise. Pauses immediately when the user navigates to Map / Race Ctrl / Weather / Driver Detail.
- **Map refresh**: 3s interval, only when the Map tab is active and session is live. Only fetches `/location`.
- **Rate limit handling**: 429 responses retry up to 2 times with backoff. Sequential API calls to avoid bursts.
- **Non-live sessions**: refresh stays off. The session header shows "Ended Xm ago" or "Starts in Xh"; manual Refresh button is the only data pull.
- **Manual refresh**: clears the cache and reloads. Useful when a session transitions from upcoming to live, since the auto loop only starts after a load that detects `sessionLive=true`.

## Key Design Decisions

- API calls are sequential (not parallel) to avoid 429 rate limits from OpenF1.
- Track outline is fetched once from a single driver's first complete timed lap (~600 location points), then cached for the session. Lap 1 is skipped because it's an out-lap from the pit garage and only covers part of the circuit; the loader walks the lap list to find the first lap with `is_pit_out_lap=false` and a non-null `lap_duration`.
- `session_key=latest` always returns the most recent session even between race weekends.
- DNF detection is derived from stints data (driver's last lap_end vs session max) since the API has no explicit retirement field.
- Date filtering in the OpenF1 API uses comparison operators in the parameter key itself (e.g., `date%3E%3D` for `date>=`).

## Deployment

- **Repo**: https://github.com/beltzner/f1-live
- **Hosting**: Vercel (auto-deploys on push to main)
- **Device**: Use `/hypernova-webapp:deploy` to push to connected Meta glasses

## Input Model

Designed for Hypernova hardware — D-pad navigation (arrow keys), Enter/tap to select, Escape/back to go back. No touch input. All interactive elements have `.focusable` class with visible focus ring.
