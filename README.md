
# 📺 BahamBin — Watch Videos Together in Real-Time

**BahamBin** is a self-hosted platform designed for synchronized group video watching.  
It allows multiple users to stream videos together in real-time, offering synchronized playback, rich chat functionalities, and intuitive host management — all within a user-friendly interface.

Built with a focus on ease of deployment and a lean tech stack, **BahamBin** makes shared viewing effortless and engaging.

---

## ✨ Features

- Room creation: create rooms with a video URL and optional `.srt` upload; automatic SRT → VTT conversion using `ffmpeg`, with a built‑in JS fallback when `ffmpeg` isn’t available; smart, human‑friendly room names derived from the video filename.
- Landing page: Active Rooms grid shows title, playing/paused + current time, users online/total, and Join links; optional movie/series posters via OMDb with in‑memory caching; Create Room modal with preferred name persistence and subtitle filename preview.
- Video sync: host broadcasts state every 2s with sentAt timestamp; clients predict host position, perform hard seeks for large drift and soft “nudge” via temporary playbackRate for small drift; tap‑to‑play overlay to satisfy autoplay policies; mobile aspect‑ratio adjusts to video metadata; resumes sync on tab return.
- Presence & roles: stable per‑tab clientId to avoid ghost users; unique usernames with smart “Guest” auto‑assignment; presence states (online, reconnecting, offline with retention); host assignment on first join, transfer host control, and auto‑reassign on host disconnect.
- Chat & reactions: real‑time chat with host badge, timestamps, reply threading with quoted preview and sender notifications; emoji reactions with counts and per‑user toggles; initial chat state (messages + reactions) on join.
- Notifications: rich server‑side notify events; system notifications (when permitted) with toast fallback; chat‑only mute toggle; self‑actions are not notified; targeted notices for replies, host changes, and connectivity issues.
- Participants panel: avatar initials, status dots, connected/total counters, host crown and transfer host modal; mobile tabs to switch between Chat and Participants.
- API & metadata: `/api/rooms` lists active rooms with name, users online/total, host, play state, current time, and timestamps; media URLs and subtitles are not exposed.
- Logging & ops: per‑room JSONL logs (creation, page enter, joins, disconnects, offline/removal) including IP/UA; `app.set('trust proxy', true)` for accurate IPs behind reverse proxies; PM2 ecosystem file included.
- Compatibility & UX: Safari/iOS compatibility warnings; RTL detection for messages/usernames; keyboard‑friendly focus states; responsive layout and panel sizing on mobile.

---

## 🚀 Installation

The easiest way to install on Ubuntu is via the one‑liner installer, which guides you through an interactive wizard and sets up PM2 + Nginx:

```bash
curl -fsSL https://raw.githubusercontent.com/asamaree/bahambin/main/ubuntu-deploy.sh | sudo bash -s -- install
```

Non‑interactive example (CI or quick provisioning):

```bash
curl -fsSL https://raw.githubusercontent.com/asamaree/bahambin/main/ubuntu-deploy.sh | sudo bash -s -- install --yes --domain watch.example.com --port 3000
```

After install, access the app at:

- http://YOUR_SERVER_IP/ (HTTP via Nginx)
- https://YOUR_DOMAIN/ (if you later configure SSL via `set-ssl`)

---

## 🧰 Ubuntu Auto-Deploy (PM2 + Nginx)

Use the integrated helper to install on Ubuntu, run under PM2, configure Nginx, manage the firewall, update from GitHub, and remove cleanly. You can add HTTPS later by supplying your own certificate and key.

File: `ubuntu-deploy.sh`

Quick start examples:

```bash
# One-liner (interactive)
curl -fsSL https://raw.githubusercontent.com/asamaree/bahambin/main/ubuntu-deploy.sh | sudo bash -s -- install

# One-liner (non-interactive)
curl -fsSL https://raw.githubusercontent.com/asamaree/bahambin/main/ubuntu-deploy.sh | sudo bash -s -- install --yes --domain watch.example.com --port 3000

# Local script usage (repo cloned)
sudo bash ubuntu-deploy.sh install --domain watch.example.com

# Update only if a newer commit exists on origin/HEAD
sudo bash ubuntu-deploy.sh update

# Remove PM2 app, Nginx site, and app directory
sudo bash ubuntu-deploy.sh remove

# Check status
sudo bash ubuntu-deploy.sh status

# Configure UFW (OpenSSH, 80/443)
sudo bash ubuntu-deploy.sh firewall

# Later: provide your own cert and key for HTTPS
sudo bash ubuntu-deploy.sh set-ssl \
  --domain watch.example.com \
  --cert /etc/ssl/certs/your_fullchain.pem \
  --key /etc/ssl/private/your_privkey.pem
```

Notes:
- The script installs Node.js 18, PM2, Nginx, ffmpeg, and ufw if missing.
- Default install path is `/opt/bahambin`; configure with `--app-dir`.
- Internal app port is read from `ecosystem.config.js` (`env.PORT`); override with `--port`.
- UFW: The installer safely allows `OpenSSH` and `80/tcp`. It allows `443/tcp` only after HTTPS is configured via `set-ssl`.
- After install, a helper command is available: `sudo bahambin <command>` (symlink to the deploy script).

---

## 🌐 How to Use

1. Open your browser and go to:
   - `http://YOUR_SERVER_IP/` (HTTP)
   - or `https://YOUR_DOMAIN/` if you configured SSL
2. Enter your name and a direct link to a `.mkv` video.
3. _(Optional)_ Upload a `.srt` subtitle file — it will be auto-converted to `.vtt`.
4. Click **Start Room** to begin.
5. Share the room link to invite others!

---

## 🔗 Room URL Structure

Opaque, immutable room links (no media or user data in URL):

```
http://YOUR_SERVER_IP:PORT/room/ROOM_ID
```

- Video URL and subtitle path are stored server-side when the room is created and are not visible in the link.
- Each participant chooses their username on join; it is not part of the link.
- Room media (video/subtitle) are immutable after creation.

---

## 📥 Uploading Videos and Subtitles (Self-Hosted)

If you’re self-hosting, upload your media like this:

### 🔹 Upload a Video

Place your `.mkv` file in the server’s `public/videos/` folder on the server (default install path `/opt/bahambin`):

```bash
sudo mv my_movie.mkv /opt/bahambin/public/videos/
```

Then use the following link format in the Create Room form:

```
http://YOUR_SERVER_IP/videos/my_movie.mkv
```

### 🔹 Upload a Subtitle File

Place your `.vtt` file in `public/subtitles/` folder on the server:

```bash
sudo mv my_sub.vtt /opt/bahambin/public/subtitles/
```

Then use:

```
http://YOUR_SERVER_IP/subtitles/my_sub.vtt
```

---

## 🛠️ Dependencies

- [Node.js](https://nodejs.org/)
- [Express](https://expressjs.com/)
- [Socket.io](https://socket.io/)
- [FFmpeg](https://ffmpeg.org/) (for subtitle conversion)

---

## 📄 License

MIT License.  
Feel free to modify and use for your own self-hosted setups.

---

## 🙌 Credits

Created and maintained by [@asamaree](https://github.com/asamaree)  
Contributions welcome!
