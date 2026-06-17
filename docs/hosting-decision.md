# Hosting Decision

## Recommendation

Use Vercel for the web dashboard unless we later discover a hard requirement that Render handles better.

## Why Vercel Fits This Project

- The dashboard plan uses Next.js, and Vercel is the most direct hosting path for Next.js.
- Vercel has a free Hobby plan for personal projects and early testing.
- Vercel handles previews, environment variables, automatic deploys, CDN, and serverless routes with very little setup.
- The admin dashboard mostly needs frontend pages plus a few server-side routes for admin-only operations and Supabase Storage signed screenshot URLs.

## When Render Would Be Better

Use Render if we later decide the dashboard needs a long-running traditional backend server.

Good Render use cases:

- Always-on Node/Python API server.
- Background workers.
- Cron jobs managed in the same hosting platform.
- Docker-based deployment.
- A full web service where server process behavior matters more than frontend framework convenience.

## Free Tier Notes

- Vercel: the Hobby plan is free forever, with usage limits.
- Render: static sites start at $0, and free web services are available with limits.
- For this project, Supabase handles the database, auth, and screenshot storage, so Vercel only needs to host the admin dashboard and secure server routes.

## Current Choice

- Dashboard hosting: Vercel.
- Database/auth: Supabase.
- Screenshot storage: Supabase Storage.
- Desktop agent distribution: direct `.exe` download, hosting location to decide later.
