# Floor King CRM — Setup

A few one-time steps connect the app to your cloud accounts. Do them in order.

## 1. Create your Supabase project (database + logins)

1. Go to **https://supabase.com** → sign up (free) → **New project**.
2. Name it `floorking-crm`, choose a strong database password (save it), pick the
   region closest to Ohio (**East US**), and create it. Wait ~2 minutes for it to provision.
3. Open **Settings → API Keys** (or the **Connect** button at the top). Copy these three values:
   - **Project URL** — looks like `https://xxxxxxxx.supabase.co`
   - **Publishable key** — starts with `sb_publishable_...` (safe for the browser)
   - **Secret key** — starts with `sb_secret_...` (server only — keep private)
4. Paste them into `.env.local` (replace the placeholders):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
   ```

## 2. Create the database tables

1. In Supabase, open **SQL Editor → New query**.
2. Paste the entire contents of `supabase/migrations/0001_init.sql` and click **Run**.

## 3. Create your login + make yourself admin

1. In Supabase, go to **Authentication → Users → Add user → Create new user**.
   Use your email and a password. (Tick "Auto confirm" so you can log in immediately.)
2. Back in **SQL Editor**, run:
   ```sql
   update public.profiles set role = 'admin'
   where email = 'karam@clevelandfloorking.com';
   ```

## 4. Run it locally

```bash
cd ~/floorking-crm
npm run dev
```
Open http://localhost:3000 — sign in with the user you created. You should land on the dashboard.

## 5. Deploy to the cloud (GitHub + Vercel)

Handled in a guided step — creates a GitHub repo, pushes the code, connects Vercel,
and copies your environment variables so the live site has the same database.
