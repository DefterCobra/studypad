# Self-hosting StudyPad (Raspberry Pi + Cloudflare Tunnel)

The same code still deploys to GitHub Pages. On the Pi, `server/server.ts`
serves the static build and adds **Cloud sync**: each user's notes are stored
as JSON files in `./data` and shared by every device that connects.

## One-time setup

```bash
bun install
bun run build                       # static site -> ./out (no base path)

# a long random token = the password for sync (the server is public!)
echo "STUDYPAD_SYNC_TOKEN=$(openssl rand -hex 32)" > .env
cat .env                            # keep this; you paste it into each device once

sudo cp deploy/studypad.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now studypad
```

The server listens on `127.0.0.1:8383` (change with `PORT` / `HOST` in `.env`).

## Cloudflare Tunnel

Point the tunnel's public hostname at `http://localhost:8383`
(or `cloudflared tunnel --url http://localhost:8383` to try it).
Optionally put Cloudflare Access in front for a second lock.

## Using it

Open the site -> Data menu -> **Cloud sync…** -> paste the token -> Connect.
Do the same on each device. Profiles (Manage users) sync too.

- Edits are pushed ~2.5 s after you stop typing; returning to the tab pulls changes.
- If a pad changed on the server *and* on this device you choose which copy wins.
  Pulling keeps a local backup; overwriting the server keeps one previous version (`data/<id>.json.bak`).
- Without `STUDYPAD_SYNC_TOKEN` the server just serves the site and the sync menu is hidden.

## Static vs self-hosted mode

- **Server:** `STUDYPAD_MODE=static` in `.env` serves the site only (no sync API, even if a token is set). Default is `selfhost`.
- **Build:** `NEXT_PUBLIC_STUDYPAD_MODE=static bun run build` makes the app skip the sync probe entirely.
  Without it the app auto-detects, which is why the GitHub Pages build needs no change.

## Updating

```bash
git pull && bun install && bun run build && sudo systemctl restart studypad
```

Back up by copying `./data`.
