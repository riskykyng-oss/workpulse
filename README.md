# WorkPulse

An attendance and presence platform for the Harcourt Group. Devices (companion phones) report presence through a simulated network feed; WorkPulse turns raw detection events into a live register, daily statuses, a monthly register with exports, and an audit trail — with no manual data entry.

- **No-install demo**: an embedded PostgreSQL database boots with the app, auto-migrates and seeds canonical demo data on first start.
- **Mock detection adapter**: a built-in simulated network feed pushes arrival / departure / lunch / outage events, so the whole flow works offline.
- **Real-time**: the socket feed updates the live register every minute; the monthly register is compiled on schedule.

## Stack

- **Backend** (`.workpulse/backend`): Node 24 + Express + Prisma + `embedded-postgres` + Zod, Socket.IO, `node-cron`, ExcelJS, PDFKit, Vitest.
- **Frontend** (`/frontend`): Vite + React 18 + React Query + Tailwind CSS.
- Packages are managed with npm **workspaces**; run everything from the repo root.

## Quick start

```sh
npm install            # install (workspaces: backend + frontend)
npm run setup          # backend setup: prisma generate + seed
npm run dev            # both: API on :4000, web on :5173
```

Then open <http://localhost:5173>.

- The first boot initializes the embedded database (creates `backend/.pgdata`), runs `prisma db push`, and seeds 248 employees with a full 2026-08 register and a live 2026-09 register. The seed does **not** run again once a database exists.
- To reset to the canonical demo dataset at any time:

```sh
cd backend
node scripts/reset.js   # stop the API first (port 4000)
```

### Environment

Copy `backend/.env.example` to `backend/.env` if you need to change defaults — sensible defaults are already in place.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | API port |
| `JWT_SECRET` | demo secret | change for anything real |
| `DATABASE_URL` | *(unset)* | set to use your own PostgreSQL (see `docker-compose.yml`) instead of the embedded one |
| `EMBEDDED_PG_PORT` | `5433` | embedded cluster port (used when `DATABASE_URL` unset) |
| `AUTO_SETUP` | `1` | auto-migrate + seed empty databases on boot |
| `DEMO_TODAY_YMD` | `2026-09-21` | pins the demo "today" so canonical registers stay authoritative whenever the app is run |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS / WebSocket origin |

## Demo logins

All passwords are `workpulse`.

| Email | Role | Sees |
| --- | --- | --- |
| `root@harcourt.co.zw` | Super admin | everything, incl. rules and settings |
| `admin@harcourt.co.zw` | HR admin | everything |
| `sarah.ncube@harcourt.co.zw` | Manager | Finance department scope |
| `tendai.chikore@harcourt.co.zw` | Employee | own attendance ("Me") |

## Security notes

- **Roles & scoping** — managers are confined to their own department across every read surface (dashboard, live register, history, evidence, employees, departments, devices). Employees can only read their own attendance (e.g. the `Me` month calendar). The backend enforces this; the UI merely hides what the API refuses to return.
- **Login hardening** — `/api/auth/login` is rate-limited to 10 attempts per 5 minutes per IP; there's a baseline API throttle (600/min) and `helmet` sets secure HTTP headers.
- **JWT secret** — the shipped `JWT_SECRET` is a demo default; the API warns at startup when it's still in use. Generate a real one (`node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`) before any real deployment.
- **Token storage** — the session token lives in `localStorage` so fetch and the Socket.IO handshake can reuse it. Trade-off: any XSS can read it. The httpOnly-cookie alternative is deferred since this API returns only JSON.

## The demo "today"

The seed's canonical day is **2026-09-21**. `DEMO_TODAY_YMD` pins the app's "today" to that day wherever the live register, dashboard, exceptions and "today" feed are computed, so the demo remains the same on any machine / date. Remove it to run in "follow the real clock" mode (an empty day then simply shows 0 expected employees until arrivals stream in).

## What the system does

### Presence engine
A raw **detection feed** (device connect/disconnect events) is turned into an attendance day:

- an 08:00 start, a 13:00–14:00 lunch break, a 17:00 finish (all configurable in **Rules**);
- arrivals after **08:10** are `LATE`; still on site counts towards live net hours;
- anything past the **10:00 absent cutoff** with no on-site time is `ABSENT`;
- a 5-minute confirmation window guards micro-detections; a 10-minute disconnect bridge joins short network blips;
- lunch: `HYBRID` mode uses the detected gap clamped to 30–90 min; `FIXED` mode deducts a fixed 60 min.

### Live register & dashboard
Current status for every employee — `PRESENT`, `LATE`, `ON_LEAVE`, `ABSENT`, `NOT_EXPECTED` — plus live net hours, department rollups, and a real-time feed. Evidence drawer shows the raw detections, timeline and device that produced each status.

### Monthly register
One compile per month per department, plus company totals:

- company: **90.1%** attendance (4693 / 5208 present-days), 312 lates, 72 leaves, 365 absents, **8h 12m** avg net for 2026-08;
- per-employee rows with present / late / absent / leave / net hours / avg arrival & departure;
- **CSV / XLSX / PDF** exports;
- states: `IN_PROGRESS → READY_FOR_REVIEW → CLOSED` (reopen requires a reason); editing is locked once closed;
- the compile scheduler runs at 23:55 and, on the last day of the month, compiles the period automatically.

### Corrections & exceptions
HR can correct a day's status with an audited reason; the engine re-evaluates. Attendance exceptions group unresolved absents, needs-review days, network gaps and late logins so nothing slips through silently.

### Devices, simulation & networking
- **Devices**: register named companions, pick a primary device, see last-seen.
- **Simulation** (super/HR admin only): push synthetic arrivals, departures, lunches, unknown devices and network outages through the feed.
- **Network**: a status pill (mock feed = online) with last-sync info, exposed via API and Socket.IO.

## Project layout

```
backend/
  prisma/           schema + canonical seed
  scripts/          setup, reset (db push + generate + seed)
  src/
    controllers/    Express handlers
    services/       presence engine, attendance, presence, monthly, audit...
    socket/         Socket.IO feed + network status
    jobs/           monthly compile scheduler, live ticker, network ping
    routes/         API routes + auth/role middleware
    utils/          tz/calendar helpers, validation
    server.js       entrypoint (ensureDatabase → sync → seed-if-empty → listen)
  src/services/presenceEngine.test.js   18 unit tests (npm test)
frontend/
  src/pages/        Login, Dashboard, LiveRegister, Employees, Devices,
                    Departments, Monthly, Rules, Audit, History, Me
  src/lib/          api client (proxy /api + socket), formatting
  vite.config.js    dev proxy → :4000
docker-compose.yml  optional external PostgreSQL on :5433
```

## Scripts

```sh
npm run dev              # API + web together (concurrently)
npm run dev:backend      # API only
npm run dev:frontend     # Vite only
npm run test             # backend unit tests (presence engine)
npm run seed             # re-seed the canonical dataset (see reset note below)
node backend/scripts/reset.js   # full canonical reset (stop the API on :4000 first)
```

## Notes & gotchas

- The backend boots in ~10–15 s on first run (it creates the embedded cluster, applies the schema and seeds).
- `node scripts/reset.js` runs `prisma db push --force-reset` before `prisma generate`; if the API is running it will fail with an `EPERM` on the Prisma engine DLL — **stop the API first**, then re-run.
- Vite's dev proxy forwards `/api` and socket traffic to `:4000`; if you open the Vite port directly it binds localhost only.
- Frontend builds with a single ~800 kB (gzip ~225 kB) JS chunk — a perf smell we've accepted for the demo; route-level code-splitting is the obvious next step.