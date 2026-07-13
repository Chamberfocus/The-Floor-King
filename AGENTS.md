<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Floor King CRM — project conventions

A cloud CRM for Cleveland Floor King. Audiences: office staff, field crew (mobile), and customers (portal). See the build plan at `~/.claude/plans/joyful-twirling-honey.md`.

## Stack
- Next.js 16 (App Router, `src/`), React 19, TypeScript.
- Tailwind v4 + shadcn/ui — **style is `base-nova`, built on `@base-ui/react` (NOT Radix).**
- Supabase (Postgres + Auth + Storage). Stripe later (payments).
- Hosting: Vercel. Code: GitHub.

## Gotchas learned the hard way
- **Middleware is `proxy`.** Use `src/proxy.ts` exporting `proxy()`; there is no `middleware.ts` in Next 16.
- **No `asChild`.** base-ui components use a `render={<Component/>}` prop instead (e.g. `<SheetTrigger render={<Button/>}>`).
- `cookies()` is async — always `await cookies()`.
- Page `params`/`searchParams` are Promises — `await` them.
- Mutations use Server Functions (`"use server"`); forms use React 19 `useActionState`.

## Code map
- `src/lib/supabase/{client,server,proxy}.ts` — browser / server / proxy Supabase clients.
- `src/lib/auth.ts` — `getUser`, `getProfile`, `requireProfile` (server-side).
- `src/lib/types.ts` — `UserRole`, `Profile`, `ROLE_LABELS`.
- `src/lib/nav.ts` — `NAV_ITEMS` + `navItemsForRole(role)`; APP_NAME / COMPANY_NAME.
- `src/components/app-shell.tsx` — responsive sidebar shell (client).
- `src/app/(auth)/` — public auth pages. `src/app/(app)/` — protected app (guarded by `requireProfile`).
- `supabase/migrations/` — SQL run manually in the Supabase SQL editor.

## Roles
`admin`, `office`, `crew`, `customer`. RLS enforces access; role escalation is blocked by a trigger. Promote the first user to `admin` via SQL (see migration footer).

## Local dev
`npm run dev` (Turbopack). Env in `.env.local` (placeholders are committed-safe and let the app build before Supabase is connected; `isSupabaseConfigured()` gates real auth).

## Whole-App Integrity — applies to EVERY change
Any change, update, or new feature must flow through the ENTIRE app. Before finishing any task:
1. TRACE every dependent: what other pages, components, links, queries, or processes reference what I just changed? Update ALL of them.
2. Never leave a dangling reference: if something is moved, renamed, or refactored, every caller must be updated in the same change.
3. Processes must follow through end to end: if an action is supposed to trigger something downstream (a status change, a notification, a hand-off to another page or role), verify that it actually fires — don't stop at the boundary of the page being edited.
4. One source of truth: read shared state from the shared module. Never create a second, parallel way of computing or storing the same thing.
5. Before declaring done, verify: no broken links, no orphaned references, every dependent updated, every downstream process actually fires.
This is not optional and applies to every task, even small ones.
