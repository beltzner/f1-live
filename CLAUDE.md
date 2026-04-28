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
| Leaderboard | Board | Driver positions, team colors, tyre compound/age, gap/interval, PIT/DNF/FIN status |
| Track Map | Map | Circuit outline drawn from one lap of location data, car dots in team colors |
| Race Control | Race Ctrl | Flag messages (yellow/red/green/blue/chequered) with timestamps |
| Weather | Weather | Air/track temp, humidity, wind, pressure, rainfall |
| Driver Detail | (tap driver) | Position, gap, interval cards + last 15 lap times with sector splits |

## OpenF1 API Endpoints Used

| Endpoint | Purpose | Cache |
|----------|---------|-------|
| `/sessions` | Session metadata, live/finished status | 60s |
| `/drivers` | Driver names, teams, numbers | 60s |
| `/position` | Current standings | 60s |
| `/intervals` | Gaps to leader and intervals | 60s |
| `/stints` | Tyre compound and age, DNF detection | 60s |
| `/pit` | Pit stop times, in-pit detection | 60s |
| `/laps` | Lap times and sector splits (per driver) | 60s |
| `/location` | Track outline + live car positions (map) | 2-3s on map |
| `/race_control` | Flag and race control messages | 60s |
| `/weather` | Track conditions | 60s |

## Refresh Behavior

- **Leaderboard auto-refresh**: 10s interval, only when session is live. Paused when map tab is active.
- **Map refresh**: 3s interval, only when map tab is active and session is live. Only fetches `/location`.
- **Rate limit handling**: 429 responses retry up to 2 times with backoff. Sequential API calls to avoid bursts.
- **Non-live sessions**: Auto-refresh is blocked. Data loads once on screen entry.

## Key Design Decisions

- API calls are sequential (not parallel) to avoid 429 rate limits from OpenF1.
- Track outline is fetched once from a single driver's lap 25 location data (~600 points), then cached for the session.
- `session_key=latest` always returns the most recent session even between race weekends.
- DNF detection is derived from stints data (driver's last lap_end vs session max) since the API has no explicit retirement field.
- Date filtering in the OpenF1 API uses comparison operators in the parameter key itself (e.g., `date%3E%3D` for `date>=`).

## Deployment

- **Repo**: https://github.com/beltzner/f1-live
- **Hosting**: Vercel (auto-deploys on push to main)
- **Device**: Use `/hypernova-webapp:deploy` to push to connected Meta glasses

## Input Model

Designed for Hypernova hardware — D-pad navigation (arrow keys), Enter/tap to select, Escape/back to go back. No touch input. All interactive elements have `.focusable` class with visible focus ring.
