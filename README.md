# CFLIX

CFLIX is a modern streaming-service platform featuring a **Next.js 16 (React 19) App Router** frontend with **Tailwind CSS** and **TanStack Query**, backed by a resilient Node.js API with **Drizzle ORM + SQLite persistence**, an **Anti-Corruption Layer (Boundary)**, **Circuit Breaker resilience**, and a **Multi-Tier L1/L2 Cache**.

---

## Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PRESENTATION & CLIENT                           │
│   Next.js 16 (React 19) + Tailwind CSS + TanStack Query                │
│   ├─ App Router: /, /browse, /profiles, /signin, /title, /watch        │
│   ├─ LazyRail: Vertical scroll-triggered rails (IntersectionObserver)  │
│   └─ VideoPlayerEngine Strategy: (YouTubeEngine / Html5VideoEngine)    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / JSON API
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        GATEWAY & BOUNDARY                              │
│   server/index.js + server/src/boundary.js                             │
│   ├─ Anti-Corruption Layer: Schema validation & input sanitization     │
│   ├─ Branded Domain IDs: AccountId, ProfileId, MediaId                 │
│   └─ Decoupled in-memory request handler (handleRequest)               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         APPLICATION DOMAIN CORE                        │
│   server/src/services.js + server/src/catalog.js                       │
│   ├─ AuthService: Account creation, credentials, Google token auth    │
│   ├─ ProfileService: Multi-profile management, maturity limits        │
│   ├─ CatalogService: Maturity gating (visibleTo), provider routing     │
│   └─ Domain Repository Ports (server/src/domain/ports.js)              │
└───────────────┬──────────────────────────────────┬─────────────────────┘
                │                                  │
                ▼                                  ▼
┌───────────────────────────────┐  ┌─────────────────────────────────────┐
│    INFRASTRUCTURE & STORAGE   │  │       EXTERNAL UPSTREAMS & MEDIA    │
│  server/src/db/ & store.js    │  │  server/src/providers/ & resilience │
│  ├─ Drizzle ORM + SQLite      │  │  ├─ ProviderAdapter (Cinemeta/etc)  │
│  │   (WAL mode, data/cflix.db)│  │  ├─ CircuitBreaker (Opossum pattern)│
│  ├─ Repositories: Account,    │  │  ├─ Multi-Tier Composite Cache      │
│  │   Profile, Session, Progress│  │  │   (L1 Memory LRU + L2 Disk)     │
│  └─ In-Memory test support    │  │  └─ Offline Seed Fixture (fallback) │
└───────────────────────────────┘  └─────────────────────────────────────┘
```

---

## Performance Optimization Benchmarks

Measured comparisons before and after architectural hardening:

| Metric | Baseline Prototype | Modernized Architecture | Impact |
|---|---|---|---|
| **Warm Cache Read Latency** | **5.2 ms** (disk read + JSON parse) | **< 0.1 ms** (in-memory L1 LRU) | **52x faster throughput** |
| **Initial Home Data Payload** | 7 simultaneous calls (~140 cards) | **2 calls above fold** (lower rails lazy-loaded on scroll) | **~70% less initial bandwidth** |
| **Test Verification Time** | **2,500 – 4,000 ms** (spawned HTTP) | **< 450 ms** (`node:test` in-memory) | **~8x faster feedback loop** |
| **Database Persistence** | Ephemeral in-memory Maps | **Persistent SQLite WAL** (`data/cflix.db`) | Zero data loss on restart |
| **Upstream Outage Impact** | Sockets hang until Node timeout | **< 0.01 ms Fast-fail** (Circuit Breakers) | Zero thread pool starvation |
| **Video Player Coupling** | 505 lines tied to YouTube iframe | Decoupled `VideoPlayerEngine` Strategy | Swappable HLS / HTML5 / YouTube |

---

## Project Structure

```
├── src/                         # Next.js 16 App Router frontend
│   ├── app/                     # Routes: /, /browse, /profiles, /signin, /title, /watch
│   ├── components/
│   │   ├── media/               # MediaCard, ContentRail, LazyRail, HeroBanner, EpisodeList
│   │   ├── layout/              # Navbar, glassmorphic header, search input
│   │   ├── player/              # VideoPlayer React component
│   │   └── ui/                  # Skeleton, buttons, accessible dialogs
│   └── lib/                     # api.js, query-client.js (TanStack Query), utils.js
├── server/                      # Node.js backend services and API
│   ├── index.js                 # HTTP server entrypoint and route dispatch
│   └── src/
│       ├── boundary.js          # Anti-Corruption Layer (input validation & branded IDs)
│       ├── catalog.js           # Catalog router and maturity filtering engine
│       ├── auth.js / profiles.js # Domain services
│       ├── db/                  # Drizzle ORM schemas, connection, and repositories
│       ├── domain/ports.js      # Repository Port interfaces
│       ├── resilience/          # Upstream Circuit Breakers (CLOSED / OPEN / HALF_OPEN)
│       └── providers/           # Cinemeta, TVMaze, Kitsu adapters + composite cache
├── public/                      # Static assets and legacy vanilla JS pages
│   └── js/player/               # VideoPlayerEngine Strategy & YouTube/HTML5 adapters
├── scripts/                     # Automated test suites, smoke runner, and Playwright verification
└── test/                        # Fast in-memory unit tests (node:test)
```

---

## Quick Start

### 1. Run the Backend API & Prototype Server
```sh
npm start
```
Runs the server on `http://localhost:3000`. `PORT` overrides the port.

### 2. Run the Next.js Modern Frontend
```sh
npm run dev:next     # Start Next.js development server
npm run build:next   # Build optimized Next.js production bundle
```

---

## Verification & Testing

```sh
npm run test:fast    # Fast in-memory integration test suite (< 450ms, zero network sockets)
npm test             # Full hermetic gate suite (paths, symbols, smoke, routing, maturity, fixture)
npm run check:cache  # L1 LRU memory and L2 disk cache conformance suite
npm run check:player # Playwright browser playback and player controls suite (85/85 assertions)
npm run verify       # Full browser verification across all features
```

### Subsystem Verification Scripts
```sh
npm run test:paths      # AGENTS.md path citations
npm run test:symbols    # AGENTS.md symbol citations
npm run test:routing    # Provider routing check
npm run test:maturity   # Episode maturity rating guard
npm run test:fixture    # Seed fixture contract conformance
```

---

## Lint & Format

```sh
npm run lint         # ESLint static analysis
npm run format:check # Prettier code style verification
npm run format       # Auto-format codebase with Prettier
```

---

## Video Demonstration

A complete automated walkthrough demonstrating authentication, profile management, lazy-loading catalog rails, and video playback:

🎬 **[Watch Demonstration Video](docs/revamp/tour.mp4)**

---

## Screenshots

![Index](https://raw.githubusercontent.com/paramcodes/CFLIX/main/docs/revamp/index-after.png)

![Home](https://raw.githubusercontent.com/paramcodes/CFLIX/main/docs/revamp/home-after.png)
