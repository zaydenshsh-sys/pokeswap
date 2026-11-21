# Agent notes
- Frontend: `src/` (React and hash routing; pages live in `src/pages`). The API client is `src/api.js` and the WebSocket client with reconnect is `src/realtime.js`.
- Backend: `server/app.ts` holds every `/api/*` route, `server/lib.ts` holds auth, settings and validation, and `server/realtime.ts` holds the `/ws` chat, presence and broadcasts. The entry point is `netlify/server/index.ts`, and it only handles `/api/*` and `/ws`.
- Auth is custom: scrypt password hashes, plus session tokens stored hashed in the `sessions` table and sent as an HttpOnly cookie named `psid`. Admin status is the `users.is_admin` column. It is granted by entering the admin code, which falls back to the `ADMIN_CODE` env var and then to "bulba" unless `settings.adminCodeHash` is set.
- Club settings live in the `settings` key/value table.
- Schema changes: edit `db/schema.ts`, then run `npx drizzle-kit generate --name <name>`. Never edit applied migrations.
- In-memory maps are throttling caches only. Chat history is kept in the database.
