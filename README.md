# HowDoesThisLand

**HowDoesThisLand** tells you how a piece of writing is likely to land before you
send it. It scores the text against Aristotle's three modes of persuasion — ethos
(why believe this speaker), pathos (why care), logos (why think it is true) — plus
kairos (why this, why now). Each score comes with the passages behind it and
specific rewrites. Underneath is a detailed model of influence: 43 dimensions, 13
influence perspectives, 58 moves, red flags, audience archetypes and culture
profiles, each tied to the research it rests on.

You will be able to use it in the browser, or call it from your own software
through an API.

> **Status: planning.** Nothing is built yet. The working reference is the
> original Claude artefact in [`prototype/`](./prototype/); start with
> [`prototype/BRIEF.md`](./prototype/BRIEF.md). The plan lives in the HCE Hub
> (project `howdoesthisland`), and its spec in [`.context/app/`](./.context/app/).

> **Built on Sunrise.** HowDoesThisLand is a leaf app on the
> [Sunrise](https://github.com/human-centric-engineering/sunrise) starter
> template, forked from Sunrise **v0.18.0**. Later Sunrise releases come in
> through the `upstream` remote. The platform is extended through Sunrise's
> designed seams (`lib/app/*`, `components/app/*`, `prisma/schema/app.prisma`)
> rather than edited in place, so upgrades stay clean merges. Every edit to a
> Sunrise-owned file is recorded in
> [`.context/app/platform-divergences.md`](./.context/app/platform-divergences.md).
> Start with [`CUSTOMIZATION.md`](./CUSTOMIZATION.md) if you're working in this
> repo.

## Getting started

### Prerequisites

- Node.js 24+ (see `.nvmrc`)
- PostgreSQL 15+ (local, Docker, or hosted)

### Setup

```bash
git clone https://github.com/human-centric-engineering/howdoesthisland.git
cd howdoesthisland

# Create your environment file, then set DATABASE_URL and BETTER_AUTH_SECRET in it
cp .env.example .env.local
openssl rand -base64 32   # a value for BETTER_AUTH_SECRET

npm install
npm run db:migrate:dev
npm run dev
```

Open http://localhost:3026. The port is set by `PORT` in the committed
`.env.development`, so it does not clash with the other HCE apps on the same
machine.

On a fresh database, the first account you create at `/signup` becomes the
admin. There are no default login credentials.

### Commands

```bash
npm run dev              # Start the dev server
npm run validate         # CHANGELOG + Node version + type-check + lint + format
npm run test:changed     # Tests this branch affects
npm test                 # Full test suite
npm run db:studio        # Open Prisma Studio
```

Full command reference: [`.context/commands.md`](./.context/commands.md).

## Documentation

- [`prototype/BRIEF.md`](./prototype/BRIEF.md) — what the artefact does, what it
  depends on, and the questions the plan has to answer
- [`.context/app/`](./.context/app/) — this app's own docs, including the
  divergence ledger
- [`CUSTOMIZATION.md`](./CUSTOMIZATION.md) — building on Sunrise: the seams, and
  how to take a Sunrise release
- [`.context/substrate.md`](./.context/substrate.md) — Sunrise's platform docs

## License

MIT — see [`LICENSE`](./LICENSE).
