# travel-app
https://byutravelapp.vercel.app/

Next.js app with a React frontend and API routes in one project.
TypeScript is enabled.

## Structure
- `pages` - UI pages and API routes (`/api/health`)
- `styles` - global styles

## Auth (Supabase)

Auth uses Supabase Auth with email/password. Store in `.env`:

- `NEXT_PUBLIC_SUPABASE_URL` – Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` – anon (public) key

In Supabase Dashboard: **Authentication → Providers → Email** – enable Email provider and optionally disable "Confirm email" for local development.

Signup stores `first_name` and `last_name` in `user_metadata`.

## Places cache

The `/api/collab-places` endpoint caches responses for performance. Set in `.env`:

- `PLACES_CACHE_MAX_AGE` – Cache TTL in seconds (default: `0` = no caching). Set e.g. `3600` for 1 hour.

Examples: `86400` = 1 day, `3600` = 1 hour, `300` = 5 minutes.

## Local dev
Install deps at the repo root:

```
npm install
```

Start the app:

```
npm run dev
```

The frontend calls the health check at `/api/health`.

## PYTHON
Activate Python environment:
    WINDOWS: travelapp-py-env\Scripts\activate

    pip install -r requirements.txt

## Linting

```
npm run lint
```

## ERD
https://drive.google.com/file/d/1Kuw2Z2jBo8kG9XY9axR5OcgbPoac1_DT/view?usp=sharing
