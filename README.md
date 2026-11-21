# PokéSwap Club

A friends-only club for trading, buying and selling Pokémon items and snacks (snacks carry expiration dates). It includes live chat and an admin panel unlocked with a secret code (default `bulba`, which admins can change).

## Tech
- React + Vite frontend (`src/`)
- Express + WebSockets backend running as a Netlify Server (`netlify/server/index.ts` → `server/`)
- Netlify Database (Postgres) with Drizzle ORM (`db/schema.ts`, migrations in `netlify/database/migrations/`)
- Netlify Blobs for listing photos

## Run locally
```
npm install
netlify dev --port 8889
```

## Roadmap
- More activities (battles, quizzes, etc.)
