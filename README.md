# The Love Media

A private local queer live chat and social experience.

## Run locally

1. Install dependencies:
   npm install
2. In one terminal, start the app:
   npm run dev
3. In a second terminal, start the private account and video server:
   npm run signaling
4. Open `http://localhost:3000`.

The app uses port `3000` for the web page and port `3002` for accounts and video signaling. The web port is locked so Vite stops with an error instead of silently changing the URL when port `3000` is already in use.

The deployed API serves both the WebSocket signaling endpoint and the health check at `https://the-love-media-api.onrender.com/health`. The frontend connects to the signaling endpoint over `wss://the-love-media-api.onrender.com`; no separate WebRTC server URL is needed. WebRTC media uses Google's public STUN server, so a TURN service is still needed for users behind restrictive networks.

## Windows desktop app

The project includes a Tauri wrapper for building a lightweight Windows desktop app from the same Vite frontend.

1. Install Rust through `rustup` and restart VS Code.
2. Start the desktop development app:
   `npm.cmd run tauri:dev`
3. Build the Windows installer:
   `npm.cmd run tauri:build`

The desktop app still connects to the hosted account and WebSocket services. Tauri build output is created under `src-tauri/target/release/bundle/`.

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
