# The Love Media

A private local queer live chat and social experience.

## Run locally

1. Install dependencies:
2. 
3. 
   npm install
2. In one terminal, start the app:
   npm run dev
3. In a second terminal, start the private account and video server:
   npm run signaling
4. Open `http://localhost:3000`.

The app uses port `3000` for the web page and port `3002` for accounts and video signaling. The web port is locked so Vite stops with an error instead of silently changing the URL when port `3000` is already in use.

## Free hosting on Render

The static site and the API can both stay on Render's free plan.

- The static site never sleeps.
- The API sleeps after 15 minutes without traffic and needs about a minute to wake.
  A free uptime monitor (for example UptimeRobot) that requests
  `https://the-love-media-api.onrender.com/api/health` every 5 minutes keeps it
  warm; 750 free instance-hours per month covers one always-on service.
- Render's **free Postgres is deleted 30 days after creation**. Use a free Neon
  database instead: create a project at https://console.neon.tech (no card
  required), copy its connection string, and set it as `DATABASE_URL` on the API
  service in Render. The server picks it up with no code changes.

## App download link

The login page footer links to the app installer. Set `VITE_APP_DOWNLOAD_URL` to
the public installer URL (a Microsoft Store listing, a Google Play listing, or a
hosted `.msix`/`.exe` file) and rebuild. Until it is set, the login page shows
"App download coming soon" rather than a broken link.

## Stripe donation setup

1. In the project folder, copy `.env.example` and name the copy `.env`.
2. In Stripe, use test mode and copy your secret key into `STRIPE_SECRET_KEY`.
3. Leave `STRIPE_WEBHOOK_SECRET` empty until a Stripe webhook endpoint is created.
4. Restart the signaling server after changing `.env`:
   `npm.cmd run signaling`

Never paste Stripe secret keys into browser code, chat, screenshots, or Git. The `.env` file is ignored by Git.

## Deploy on Render

This repository includes `render.yaml` for a Static Site plus Node Web Service deployment.

1. Push the repository to GitHub or GitLab.
2. In Render, choose **New > Blueprint** and select the repository.
3. After the services are created, confirm the generated URLs match the values in `render.yaml`:
   - `FRONTEND_URL` on the API service
   - `ALLOWED_ORIGINS` on the API service
   - `VITE_API_URL` and `VITE_WS_URL` on the Static Site
4. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as Render secret environment variables.
5. Update Stripe success/cancel URLs and webhook configuration after the public URL is available.

Render provisions Postgres through `render.yaml`; the API uses `DATABASE_URL` automatically in production and keeps `accounts.json` only as the local-development fallback.
