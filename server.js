const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { exec } = require('child_process');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
// Restrict cross-origin Socket.IO connections (same-origin by default)
const io = new Server(server, {
  cors: { origin: false }
});

// Respect proxy headers for correct IP logging if behind reverse proxy
app.set('trust proxy', true);
app.disable('x-powered-by');

// --- Security headers via Helmet ---
app.use(helmet({
  // Keep defaults; add our CSP tailored to this app
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // inline scripts in HTML files
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://www.omdbapi.com'],
      mediaSrc: ["'self'", 'https:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));

// Extra caching for static assets (immutable), no-cache for HTML
const oneYear = 31536000; // seconds
app.use(express.static('public', {
  setHeaders: (res, p) => {
    if (p.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    } else if (/\.(?:css|js|svg|png|jpg|jpeg|gif|webp|ico|vtt)$/.test(p)) {
      res.setHeader('Cache-Control', `public, max-age=${oneYear}, immutable`);
    }
  }
}));

// --- IP/User-Agent helpers ---
function getReqIp(req) {
  try {
    const xf = (req.headers['x-forwarded-for'] || '').toString();
    if (xf) return xf.split(',')[0].trim();
    return req.ip || req.connection?.remoteAddress || '';
  } catch (_) { return ''; }
}
function getReqUA(req) {
  try { return (req.headers['user-agent'] || '').toString(); } catch (_) { return ''; }
}
function getSocketIp(socket) {
  try {
    const xf = (socket.handshake?.headers?.['x-forwarded-for'] || '').toString();
    if (xf) return xf.split(',')[0].trim();
    return socket.handshake?.address || '';
  } catch (_) { return ''; }
}
function getSocketUA(socket) {
  try { return (socket.handshake?.headers?.['user-agent'] || '').toString(); } catch (_) { return ''; }
}

// Detect ffmpeg availability at startup for clearer logs
let FFMPEG_AVAILABLE = false;
let FFMPEG_VERSION = '';
try {
  exec('ffmpeg -version', { timeout: 5000 }, (err, stdout) => {
    if (err) {
      console.warn('[startup] FFmpeg not detected. SRT conversion will use JS fallback.');
      FFMPEG_AVAILABLE = false;
    } else {
      const first = String(stdout || '').split('\n')[0].trim();
      FFMPEG_AVAILABLE = true;
      FFMPEG_VERSION = first || 'ffmpeg (version unknown)';
      console.log(`[startup] FFmpeg detected: ${FFMPEG_VERSION}`);
    }
  });
} catch (_) {
  console.warn('[startup] FFmpeg check failed; assuming unavailable.');
}

// Ensure the public/subtitles directory exists
const subtitlesDir = path.join(__dirname, 'public', 'subtitles');
if (!fs.existsSync(subtitlesDir)) {
    fs.mkdirSync(subtitlesDir, { recursive: true });
}

// Ensure logs directory exists (per-room logs)
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  try { fs.mkdirSync(logsDir, { recursive: true }); } catch (_) {}
}

// Append a JSON line into this room's log file
function roomLog(roomId, type, data = {}) {
  try {
    const logPath = path.join(logsDir, `room_${roomId}.log`);
    const entry = { ts: new Date().toISOString(), type, room: roomId, ...data };
    fs.appendFile(logPath, JSON.stringify(entry) + "\n", { encoding: 'utf8' }, () => {});
  } catch (_) {}
}

// Configure multer for file uploads (limit size and allow only .srt)
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    try {
      const name = (file.originalname || '').toLowerCase();
      if (name.endsWith('.srt')) return cb(null, true);
      return cb(new Error('Only .srt subtitle files are allowed'));
    } catch (_) {
      return cb(new Error('Invalid file'));
    }
  }
});

// --- Simple per-route rate limiters ---
const limiterGeneral = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const limiterCreate = rateLimit({ windowMs: 10 * 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const limiterUpload = rateLimit({ windowMs: 10 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
const limiterApi = rateLimit({ windowMs: 10_000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use(limiterGeneral);

// --- TOTP (Google Authenticator) support for room creation ---
// Configure with env var: TOTP_SECRET_BASE32. If not set, TOTP is not enforced.
// Optionals: TOTP_ISSUER (default: BahamBin), TOTP_ACCOUNT (default: Creator)
// Client provides code via body `totp`, header `x-totp`, or query `?totp=XXXXXX`
const crypto = require('crypto');

function base32DecodeToBuffer(base32) {
  // RFC 4648 base32 decoding (uppercase, no padding required)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(base32 || '').toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) continue; // skip invalid chars silently
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(counter, key) {
  const buf = Buffer.alloc(8);
  let tmp = BigInt(counter);
  for (let i = 7; i >= 0; i--) { buf[i] = Number(tmp & 0xffn); tmp >>= 8n; }
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[19] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | (hmac[offset + 3]);
  return code % 1_000_000; // 6 digits
}

function verifyTotp({ code, secretBase32, step = 30, window = 1, epochMs = Date.now() }) {
  if (!code || !secretBase32) return false;
  const clean = String(code).trim();
  if (!/^\d{6}$/.test(clean)) return false;
  const expected = parseInt(clean, 10);
  const key = base32DecodeToBuffer(secretBase32);
  const counter = Math.floor(epochMs / 1000 / step);
  for (let w = -window; w <= window; w++) {
    const otp = hotp(counter + w, key);
    if (otp === expected) return true;
  }
  return false;
}

function checkCreateTotp(req, res, next) {
  try {
    const secret = (process.env.TOTP_SECRET_BASE32 || '').trim();
    if (!secret) return next(); // not configured → allow (dev default)
    const bodyCode = req.body?.totp || req.body?.otp;
    const headerCode = req.headers['x-totp'];
    const queryCode = req.query?.totp;
    const code = String(bodyCode || headerCode || queryCode || '').trim();
    if (verifyTotp({ code, secretBase32: secret })) return next();
    return res.status(403).send('Invalid or missing authenticator code.');
  } catch (e) {
    return res.status(403).send('Invalid or missing authenticator code.');
  }
}

// MFA setup endpoints have been disabled for security once configured

// Log otpauth at startup for convenience (do not log the secret repeatedly in prod logs)
try {
  const secret = (process.env.TOTP_SECRET_BASE32 || '').trim();
  if (secret) {
    const issuer = encodeURIComponent(process.env.TOTP_ISSUER || 'BahamBin');
    const account = encodeURIComponent(process.env.TOTP_ACCOUNT || 'Creator');
    console.log(`[mfa] TOTP is enabled for room creation.`);
  } else {
    console.log('[mfa] TOTP not configured. Set TOTP_SECRET_BASE32 to enable.');
  }
} catch (_) {}

// State and user storage for each room
const roomStates = {};
const roomHosts = {};
const roomUsers = {}; // { roomId: Map<clientId, { name, clientId, socketId, status, lastSeen, rttMs, _lastPoorAt? }> }
const roomMessages = {};
const messageReactions = {};
// Lightweight room registry for landing page
// roomMeta[roomId] = { id, name, video, subtitle, createdAt, lastActivity }
const roomMeta = {};

function touchRoom(roomId, fields = {}) {
  if (!roomId) return;
  const m = roomMeta[roomId] || { id: roomId, createdAt: Date.now() };
  Object.assign(m, fields);
  m.lastActivity = Date.now();
  roomMeta[roomId] = m;
}

// --- Input validation and escaping helpers ---
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidHttpUrl(v) {
  try {
    const u = new URL(String(v));
    if (!/^https?:$/.test(u.protocol)) return false;
    // Basic length and path checks
    if (u.href.length > 2000) return false;
    return true;
  } catch (_) { return false; }
}

function hasAllowedVideoExt(v) {
  try {
    const u = new URL(String(v));
    const ext = path.extname(u.pathname || '').toLowerCase();
    // Keep aligned with UI hint; extend if needed
    return ['.mkv'].includes(ext);
  } catch (_) { return false; }
}

// --- Notification helpers ---
function notifyRoom(room, payload) {
  try { io.to(room).emit('notify', payload); } catch (_) {}
}
function notifyHost(room, payload) {
  const sid = roomHosts[room];
  if (sid) {
    try { io.to(sid).emit('notify', { audience: 'host', ...payload }); } catch (_) {}
  }
}
function notifySocket(socketId, payload) {
  if (socketId) {
    try { io.to(socketId).emit('notify', payload); } catch (_) {}
  }
}

// Utilities to derive a concise, pretty room name from a video URL
function extractBaseName(videoUrl) {
  try {
    const u = new URL(videoUrl);
    return decodeURIComponent(path.parse(path.basename(u.pathname || '')).name);
  } catch (_) {
    const raw = String(videoUrl || '');
    const noQuery = raw.split('?')[0];
    const last = decodeURIComponent((noQuery.split('/') || []).pop() || '');
    return path.parse(last).name;
  }
}

function prettifyName(name) {
  if (!name) return '';
  let s = name.replace(/[._-]+/g, ' ');

  // Remove common release/source/codec/group tags
  const tagRe = new RegExp(
    String([
      '480p','720p','1080p','2160p','4k',
      'WEB ?DL','WEB\s?Rip','WEB','BluRay','BRRip','HDRip','HDTV','CAM','TS','R5',
      'x264','x265','H\.?264','H\.?265','HEVC','AVC','10bit','8bit',
      'AAC','E?AC3','DDP?\d?(?:\.\d)?','DTS(?:-HD)? ?MA?','Atmos','TrueHD',
      'YTS','YIFY','RARBG','EVO','PAHE','Pahe','AvaMovie','Ganool','ShAaNiG','NTb','FLUX','DIMENSION','AMZN','NF',
      'PROPER','REPACK','EXTENDED','REMASTERED','SUBS?','HC-?SUBS?','SoftSub'
    ]).replace(/,/g,'|'),
    'ig'
  );
  s = s.replace(tagRe, ' ');

  // Collapse leftover bracketed tokens that are now mostly tags
  s = s.replace(/[\[\(\{][^\]\)\}]{1,40}[\]\)\}]/g, ' ');

  // Keep season/episode and year tokens if present
  const seMatch = s.match(/\bS(\d{1,2})E(\d{1,3})\b/i);
  const yearMatch = s.match(/\b(19|20)\d{2}\b/);

  // Normalize whitespace
  s = s.replace(/\s+/g, ' ').trim();

  // Build a concise name using title + key token
  const MAX_LEN = 40;
  if (seMatch) {
    const idx = s.search(/\bS\d{1,2}E\d{1,3}\b/i);
    let title = s.slice(0, idx).trim();
    if (!title) title = s; // fallback
    const token = seMatch[0].toUpperCase();
    let out = `${title} ${token}`.trim();
    if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN - 1).trimEnd() + '…';
    return out;
  }
  if (yearMatch) {
    const idx = s.indexOf(yearMatch[0]);
    let title = idx > 0 ? s.slice(0, idx).trim() : s;
    const token = yearMatch[0];
    let out = `${title} ${token}`.trim();
    if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN - 1).trimEnd() + '…';
    return out;
  }

  // Generic truncate
  if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN - 1).trimEnd() + '…';
  return s;
}

function deriveRoomName(videoUrl, fallback) {
  const base = extractBaseName(videoUrl);
  let pretty = prettifyName(base);
  if (!pretty) pretty = fallback || 'Room';
  return pretty;
}

// Random names for guests (famous characters)
const RANDOM_NAMES = [
  'Hermione Granger','Harry Potter','Jon Snow','Daenerys Targaryen','Walter White','Jesse Pinkman',
  'Tony Stark','Natasha Romanoff','Bruce Wayne','Clark Kent','Frodo Baggins','Aragorn',
  'Katniss Everdeen','Sherlock Holmes','John Watson','Lara Croft','Ellen Ripley','Neo',
  'Trinity','Morpheus','Luke Skywalker','Leia Organa','Han Solo','Anakin Skywalker',
  'Buzz Lightyear','Woody','Rick Sanchez','Morty Smith','Michael Scott','Dwight Schrute',
  'Arya Stark','Tyrion Lannister','Chandler Bing','Monica Geller','Ross Geller','Rachel Green'
];

function getExistingNames(room) {
  const users = roomUsers[room];
  const set = new Set();
  if (!users) return set;
  for (const [, u] of users) set.add(u.name);
  return set;
}

function pickRandomName(room) {
  const used = getExistingNames(room);
  const pool = RANDOM_NAMES.filter(n => !used.has(n));
  if (pool.length > 0) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  // Fallback if pool exhausted
  return `Guest-${Math.random().toString(36).slice(2, 6)}`;
}

function makeUniqueName(room, base) {
  const used = getExistingNames(room);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

// Presence statuses: online, reconnecting, offline
// Show "reconnecting" for up to 20s after drop, then mark offline for 40s before removal
const DISCONNECT_GRACE_MS = 20_000; // 20 seconds reconnecting window
const OFFLINE_RETENTION_MS = 40_000; // 40 seconds offline retention (total ~60s)

// roomUsers structure becomes Map<clientId, { name, clientId, socketId, status, lastSeen, rttMs }>

// Home page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Existing /create GET route
app.get('/create', limiterCreate, checkCreateTotp, (req, res) => {
    const video = req.query.video;
    const username = req.query.username || "Guest";
    const subtitle = req.query.subtitle || "";
    if (!video || !isValidHttpUrl(video) || !hasAllowedVideoExt(video)) {
      return res.status(400).send("Invalid video URL.");
    }
    const roomId = nanoid(12);
    // Register room metadata (opaque link; do not expose data in URL)
    try {
      if (!roomMeta[roomId]) {
        touchRoom(roomId, {
          name: deriveRoomName(video, roomId),
          video,
          subtitle: subtitle || '',
        });
      }
    } catch (_) {}
    // Per-room creation log without embedding data in link
    try { roomLog(roomId, 'room_created', { by: username, ip: getReqIp(req), ua: getReqUA(req), method: 'get_create' }); } catch (_) {}
    res.redirect(`/room/${roomId}`);
});

// Route to handle SRT upload and room creation
// Important: run multer before TOTP check so `req.body.totp` is available for multipart forms
app.post('/upload-and-create', limiterUpload, upload.single('srtSubtitle'), checkCreateTotp, (req, res) => {
    // Minimal stdout logging only
    console.log('POST /upload-and-create received.');

    const video = req.body.video;
    const username = req.body.username || "Guest";
    let subtitleUrl = "";

    if (!video || !isValidHttpUrl(video) || !hasAllowedVideoExt(video)) {
        console.error('Video URL is missing.'); // Log error
        return res.status(400).send("Invalid or missing video URL."); // Send 400 for bad request
    }

    if (req.file) {
        console.log(`SRT file detected, starting conversion... (ffmpeg available: ${FFMPEG_AVAILABLE ? 'yes' : 'no'})`);
        const srtFilePath = req.file.path;
        const uniqueSrtName = `${nanoid(12)}.srt`;
        const uniqueVttName = `${nanoid(12)}.vtt`;
        const tempSrtPath = path.join(__dirname, 'uploads', uniqueSrtName);
        const outputVttPath = path.join(subtitlesDir, uniqueVttName);

        try {
            fs.renameSync(srtFilePath, tempSrtPath);
            console.log(`Renamed temp file from ${srtFilePath} to ${tempSrtPath}`);
        } catch (renameError) {
            console.error(`Error renaming temp file: ${renameError}`);
            return res.status(500).send("Server error during file processing.");
        }

        const ffmpegCommand = `ffmpeg -i "${tempSrtPath}" -map 0:s:0 -c:s webvtt -f webvtt "${outputVttPath}"`;
        console.log(`Executing ffmpeg command: ${ffmpegCommand}`);

        // Helper: minimal SRT -> VTT converter (fallback when ffmpeg is missing)
        function srtToVttString(srtText) {
            try {
                let text = String(srtText || '');
                // Normalize newlines
                text = text.replace(/\r+/g, '\n').replace(/\n{3,}/g, '\n\n');
                // Replace time separators 00:00:00,000 -> 00:00:00.000
                text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
                // Remove pure index lines
                text = text.replace(/^\s*\d+\s*$/gm, '').trim();
                return 'WEBVTT\n\n' + text + (text.endsWith('\n') ? '' : '\n');
            } catch (e) {
                console.error('Fallback SRT->VTT conversion failed:', e);
                return null;
            }
        }

        // Try ffmpeg first; if it fails (e.g. ffmpeg not installed), fall back to JS converter
        exec(ffmpegCommand, { maxBuffer: 5 * 1024 * 1024, timeout: 60000 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`ffmpeg exec error: ${error}`);
                console.error(`ffmpeg stdout: ${stdout}`);
                console.error(`ffmpeg stderr: ${stderr}`);

                // Fallback path using JS converter
                try {
                    const srtContent = fs.readFileSync(tempSrtPath, 'utf8');
                    const vttContent = srtToVttString(srtContent);
                    if (!vttContent) throw new Error('Generated VTT content is empty');
                    fs.writeFileSync(outputVttPath, vttContent, 'utf8');
                    console.log(`Fallback converter wrote: ${outputVttPath}`);
                } catch (fallbackErr) {
                    console.error('Fallback conversion error:', fallbackErr);
                    // Cleanup temp and return error
                    fs.unlink(tempSrtPath, (err) => {
                        if (err) console.error(`Error deleting temp SRT file ${tempSrtPath}:`, err);
                    });
                    let errorMessage = "Error converting subtitle.";
                    if (String(error).includes('ENOENT')) {
                        errorMessage += " FFmpeg not found. Installed ffmpeg or rely on built-in fallback.";
                    }
                    errorMessage += " Please ensure ffmpeg is installed or try another SRT file.";
                    return res.status(500).send(errorMessage);
                }

                // Fallback succeeded — proceed like success path
                try { fs.unlinkSync(tempSrtPath); } catch (e) { /* ignore */ }
                subtitleUrl = `/subtitles/${uniqueVttName}`;
                const roomId = nanoid(12);
                try {
                  touchRoom(roomId, {
                    name: deriveRoomName(video, roomId),
                    video,
                    subtitle: subtitleUrl || ''
                  });
                } catch (_) {}
                try { roomLog(roomId, 'room_created', { by: username, ip: getReqIp(req), ua: getReqUA(req), method: 'fallback' }); } catch (_) {}
                console.log(`Redirecting to (fallback opaque): /room/${roomId}`);
                return res.redirect(`/room/${roomId}`);
            }

            // ffmpeg path success
            console.log(`ffmpeg stdout: ${stdout}`);
            console.log(`ffmpeg stderr: ${stderr}`);
            console.log(`Subtitle converted successfully: ${tempSrtPath} -> ${outputVttPath}`);
            try { fs.unlinkSync(tempSrtPath); } catch (e) { /* ignore */ }
            subtitleUrl = `/subtitles/${uniqueVttName}`;

            const roomId = nanoid(12);
            try {
              touchRoom(roomId, {
                name: deriveRoomName(video, roomId),
                video,
                subtitle: subtitleUrl || ''
              });
            } catch (_) {}
            try { roomLog(roomId, 'room_created', { by: username, ip: getReqIp(req), ua: getReqUA(req), method: 'ffmpeg' }); } catch (_) {}
            console.log(`Redirecting to opaque room: /room/${roomId}`);
            res.redirect(`/room/${roomId}`);
        });
    } else {
        console.log('No SRT file uploaded, creating room directly.');
        const roomId = nanoid(12);
        try {
          touchRoom(roomId, {
            name: deriveRoomName(video, roomId),
            video,
            subtitle: ''
          });
        } catch (_) {}
        try { roomLog(roomId, 'room_created', { by: username, ip: getReqIp(req), ua: getReqUA(req), method: 'no_subtitle' }); } catch (_) {}
        console.log(`Redirecting to opaque room: /room/${roomId}`);
        res.redirect(`/room/${roomId}`);
    }
});

// Room page
app.get('/room/:room', (req, res) => {
    const roomId = req.params.room;
    const meta = roomMeta[roomId];
    if (!meta || !meta.video) {
        return res.status(404).send("Room not found or expired.");
    }

    // Use stored metadata only; do not accept query overrides
    const video = meta.video;
    const subtitle = meta.subtitle || "";
    const roomName = meta.name || deriveRoomName(video, roomId);

    // Update activity timestamp only
    try { touchRoom(roomId, { name: roomName }); } catch (_) {}

    // Log HTTP-level room entry (page load)
    try {
      const ip = getReqIp(req);
      const ua = getReqUA(req);
      const ref = (req.headers['referer'] || req.headers['referrer'] || '').toString();
      roomLog(roomId, 'page_enter', { ip, ua, referer: ref });
    } catch (_) {}

    let html = fs.readFileSync('public/room.html', 'utf8');
    // Escape values to prevent HTML/script injection
    html = html.replace(/{{roomId}}/g, escapeHtml(roomId))
               .replace(/{{video}}/g, escapeHtml(video))
               .replace(/{{username}}/g, 'Guest')
               .replace(/{{subtitle}}/g, escapeHtml(subtitle))
               .replace(/{{roomName}}/g, escapeHtml(roomName));
    res.send(html);
});

// API: list active rooms (at least one online user)
app.get('/api/rooms', limiterApi, (req, res) => {
  try {
    const out = [];
    // Consider rooms that have metadata and at least one user entry
    const roomIds = Object.keys(roomMeta);
    for (const id of roomIds) {
      const meta = roomMeta[id] || { id };
      const usersMap = roomUsers[id];
      const users = usersMap ? Array.from(usersMap.values()) : [];
      const total = users.length;
      const online = users.filter(u => String(u.status || '').toLowerCase() === 'online').length;
      if (online <= 0) continue; // only show currently active rooms

      // Derive host name if available
      let hostName = null;
      const hostSid = roomHosts[id];
      if (hostSid && usersMap) {
        for (const [, u] of usersMap) { if (u.socketId === hostSid) { hostName = u.name; break; } }
      }

      const state = roomStates[id] || {};
      out.push({
        id,
        name: meta.name || 'Room',
        // Do not expose video/subtitle in list API
        createdAt: meta.createdAt || null,
        lastActivity: meta.lastActivity || null,
        usersOnline: online,
        usersTotal: total,
        hostName,
        isPlaying: !!state.playing,
        currentTime: typeof state.time === 'number' ? state.time : null
      });
    }

    // Sort by lastActivity desc
    out.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
    res.json({ rooms: out });
  } catch (e) {
    res.json({ rooms: [] });
  }
});

// Broadcast full user list with presence status + latency
function emitUserList(room) {
  const users = roomUsers[room];
  if (!users) return;

  const list = Array.from(users.values()).map(u => ({
    id: u.socketId,        // socket id for client-side actions
    name: u.name,
    clientId: u.clientId,
    status: u.status,      // "online" | "reconnecting" | "offline"
    rttMs: u.rttMs,
    lastSeen: u.lastSeen
  }));

  io.to(room).emit('userList', { users: list, currentHostId: roomHosts[room] || null });
}

io.on('connection', (socket) => {
	socket.on('join', (data = {}) => {
	  const { room, username = 'Guest', clientId } = data;
	  if (!room) return;

	  socket.join(room);

	  // Initialize room users map if needed
	  if (!roomUsers[room]) roomUsers[room] = new Map();
	  try { touchRoom(room); } catch (_) {}

	  const id = clientId || socket.id; // fallback if client didn't send
	  const existing = roomUsers[room].get(id);

	  // Deduplicate by name: remove stale offline/reconnecting entries with same name
	  const normalizedName = String(username).slice(0, 40);
	  for (const [cid, u] of roomUsers[room]) {
	    const stale = (u.status === 'offline') || (u.status === 'reconnecting' && (Date.now() - u.lastSeen) > DISCONNECT_GRACE_MS);
	    if (stale && u.name === normalizedName) {
	      roomUsers[room].delete(cid);
	    }
	  }

	  let currentUserName = normalizedName;
	  if (existing) {
	    // Reconnect path: update socketId & status
	    const oldSocketId = existing.socketId;
	    existing.socketId = socket.id;
	    existing.status = 'online';
	    existing.lastSeen = Date.now();
	    currentUserName = existing.name;
	    // Preserve host if this client was the host (host tracked by socketId)
	    if (roomHosts[room] === oldSocketId) {
	      roomHosts[room] = socket.id;
	    }

	    // If user provided a new non-guest name on reconnect, update it uniquely
	    const requested = (normalizedName || '').trim();
	    const providedIsGuest = !requested || /^guest$/i.test(requested);
	    if (!providedIsGuest && requested && requested !== existing.name) {
	      const updated = makeUniqueName(room, requested);
	      if (updated !== existing.name) {
	        existing.name = updated;
	        currentUserName = updated;
	        socket.emit('nameAssigned', { name: updated });

	        // Reflect immediately in user list
	        emitUserList(room);
	      }
	    }
	  } else {
	    // Decide final display name
	    let finalName = normalizedName;
	    const providedIsGuest = !finalName || /^guest$/i.test(finalName);
	    if (providedIsGuest) {
	      finalName = pickRandomName(room);
	    } else {
	      finalName = makeUniqueName(room, finalName);
	    }
	    roomUsers[room].set(id, {
	      name: finalName,
	      clientId: id,
	      socketId: socket.id,
	      status: 'online',
	      lastSeen: Date.now(),
	      rttMs: null
	    });
	    currentUserName = finalName;
	    // Notify client if we changed their provided name
	    if (finalName !== normalizedName) {
	      socket.emit('nameAssigned', { name: finalName });
	    }
	  }

	  // Host assignment stays as you had (but switch to clientId if you prefer)
	  if (!roomHosts[room]) roomHosts[room] = socket.id;

	  // Send down role + update everyone’s list
	  socket.emit('role', { isHost: roomHosts[room] === socket.id });
	  emitUserList(room);
	  socket.emit('initialChatState', { messages: roomMessages[room] || [], reactions: messageReactions[room] || {} });

	  // Log join with IP/UA after final name is resolved (write to room log file)
	  try {
	    const ip = getSocketIp(socket);
	    const ua = getSocketUA(socket);
	    roomLog(room, 'user_join', { user: currentUserName, clientId: id, socketId: socket.id, ip, ua });
	  } catch (_) {}

	  // Notify: chat stream + host toast
	  io.to(room).emit('notification', `${currentUserName} joined the room.`);
	  notifyHost(room, { code: 'user_join', text: `${currentUserName} joined the room` });
	});

    socket.on('stateUpdate', (data) => {
        if (!data || !data.state) return;
        if (roomHosts[data.room] !== socket.id) return;
        roomStates[data.room] = data.state;
        socket.to(data.room).emit('stateUpdate', data);
        try { touchRoom(data.room); } catch (_) {}
    });
    
    socket.on('chatMessage', (data) => {
        const senderIsHost = (roomHosts[data.room] === socket.id);
        const messageId = nanoid(10);

        // Resolve authoritative author info from room state
        let authorName = data.username;
        let authorClientId = null;
        const users = roomUsers[data.room];
        if (users) {
            for (const [, u] of users) {
                if (u.socketId === socket.id) { authorClientId = u.clientId; authorName = u.name; break; }
            }
        }

        // Truncate message and reply payloads to sane limits
        const safeMessage = String(data.message || '').slice(0, 1000);
        const replied = data.repliedTo ? {
          id: String(data.repliedTo.id || '').slice(0, 40),
          username: String(data.repliedTo.username || '').slice(0, 80),
          message: String(data.repliedTo.message || '').slice(0, 120)
        } : null;

        const messageData = {
            id: messageId,
            username: authorName,
            authorId: authorClientId,
            message: safeMessage,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isHost: senderIsHost,
            repliedTo: replied
        };

        if (!roomMessages[data.room]) {
            roomMessages[data.room] = [];
        }
        roomMessages[data.room].push(messageData);

        messageReactions[messageId] = {};

        io.to(data.room).emit('chatMessage', messageData);
        try { touchRoom(data.room); } catch (_) {}

        // Notify host & users: new message
        notifyRoom(data.room, { code: 'chat_message', text: `New message from ${authorName}`, meta: { from: authorName, fromId: authorClientId, id: messageId } });

        // If this is a reply, notify original author (if online and not self)
        const replied = data.repliedTo && data.repliedTo.id;
        if (replied && Array.isArray(roomMessages[data.room])) {
          const original = roomMessages[data.room].find(m => m.id === data.repliedTo.id);
          if (original && original.authorId && original.authorId !== authorClientId) {
            const usersMap = roomUsers[data.room];
            if (usersMap) {
              for (const [, u] of usersMap) {
                if (u.clientId === original.authorId && u.status === 'online') {
                  notifySocket(u.socketId, { code: 'reply_to_you', text: `${authorName} replied to your message` , meta: { messageId: original.id } });
                  break;
                }
              }
            }
          }
        }
    });

    socket.on('addReaction', (data) => {
        const { room, messageId, emoji } = data;
        const userId = socket.id;

        if (!messageReactions[messageId]) {
            console.warn(`Attempted to react to non-existent message: ${messageId}`);
            return;
        }

        if (!messageReactions[messageId][emoji]) {
            messageReactions[messageId][emoji] = { count: 0, users: [] };
        }

        const reaction = messageReactions[messageId][emoji];
        const userIndex = reaction.users.indexOf(userId);

        if (userIndex === -1) {
            reaction.count++;
            reaction.users.push(userId);
        } else {
            reaction.count--;
            reaction.users.splice(userIndex, 1);
            if (reaction.count === 0) {
                delete messageReactions[messageId][emoji];
            }
        }

        io.to(room).emit('reactionUpdate', {
            messageId: messageId,
            reactions: messageReactions[messageId]
        });

        // Notify everyone about new reaction (lightweight)
        // Resolve reactor name
        let reactor = 'Someone';
        let reactorClientId = null;
        const usersMap = roomUsers[room];
        if (usersMap) {
          for (const [, u] of usersMap) { if (u.socketId === userId) { reactor = u.name; reactorClientId = u.clientId; break; } }
        }
        notifyRoom(room, { code: 'chat_reaction', text: `${reactor} reacted ${emoji}` , meta: { messageId, emoji, from: reactor, fromId: reactorClientId } });
    });

    // Host can transfer host status
    socket.on('transferHost', (data) => {
        const { room, newHostId } = data;
        if (roomHosts[room] !== socket.id) {
            socket.emit('notification', 'You are not the current host.');
            return;
        }
        if (newHostId === socket.id) {
            socket.emit('notification', 'You are already the host.');
            return;
        }

        // Ensure target user exists in room and is online
        let targetUser = null;
        const usersMap = roomUsers[room];
        if (usersMap) {
            for (const [, u] of usersMap) {
                if (u.socketId === newHostId) { targetUser = u; break; }
            }
        }

        if (!targetUser || targetUser.status !== 'online') {
            socket.emit('notification', 'Target user is not online and cannot be made host.');
            return;
        }

        const newHostSocket = io.sockets.sockets.get(newHostId);
        if (newHostSocket) {
            const oldHostId = roomHosts[room];
            roomHosts[room] = newHostId;

            io.to(oldHostId).emit('role', { isHost: false });
            io.to(oldHostId).emit('notification', 'You are no longer the host.');
            notifySocket(oldHostId, { code: 'lost_host', text: 'You are no longer the host.' });

            io.to(newHostId).emit('role', { isHost: true });
            const newHostName = targetUser?.name || 'A user';
            io.to(newHostId).emit('notification', `You are now the host.`);
            notifySocket(newHostId, { code: 'became_host', text: 'You are now the host.' });
            io.to(room).emit('notification', `${newHostName} is now the host.`);
            emitUserList(room); // Update user list for everyone on host change
        } else {
            socket.emit('notification', 'Target user for host transfer not found.');
        }
    });

	// Client round-trip ping for presence & latency
		socket.on('presence:ping', ({ room, t0 } = {}) => {
	  if (!room || !roomUsers[room]) return;
	  // locate user by socket.id
	  const users = roomUsers[room];
	  for (const [, u] of users) {
	    if (u.socketId === socket.id) {
	      u.lastSeen = Date.now();
	      u.rttMs = t0 ? (Date.now() - t0) : u.rttMs;
	      if (u.status !== 'online') u.status = 'online';

	      // Poor connection heuristic: high RTT
	      const THRESH_MS = 1200;
	      if (typeof u.rttMs === 'number' && u.rttMs >= THRESH_MS) {
	        const now = Date.now();
	        if (!u._lastPoorAt || (now - u._lastPoorAt) > 30_000) {
	          u._lastPoorAt = now;
	          notifyHost(room, { code: 'user_network_issue', text: `${u.name} may have connection issues` });
	          notifySocket(u.socketId, { code: 'your_network_issue', text: 'Your connection seems unstable' });
	        }
	      }
	      break;
	    }
	  }
	  emitUserList(room);
	  try { touchRoom(room); } catch (_) {}
	});

	socket.on('disconnect', () => {
	  // For every room this socket was in
	  for (const room of Object.keys(roomUsers)) {
	    const users = roomUsers[room];
	    if (!users) continue;

	    for (const [cid, u] of users) {
	      if (u.socketId === socket.id) {
	        u.status = 'reconnecting';
	        u.lastSeen = Date.now();
	        emitUserList(room);


	        // Log disconnect (start of grace window) to per-room log
	        try {
	          const ip = getSocketIp(socket);
	          const ua = getSocketUA(socket);
	          roomLog(room, 'user_disconnect', { user: u.name, clientId: cid, socketId: socket.id, ip, ua, status: 'reconnecting' });
	        } catch (_) {}

	        // Notify host about reconnecting user immediately
	        notifyHost(room, { code: 'user_network_issue', text: `${u.name} disconnected (reconnecting...)` });

	        // Host reassignment if needed (host used socket.id before)
	        if (roomHosts[room] === socket.id) {
	          // Pick the first online/reconnecting user if any
	          const next = Array.from(users.values()).find(x => x.clientId !== cid);
	          if (next) {
	            roomHosts[room] = next.socketId; // host by socketId (you can switch to clientId-based host later)
	            io.to(next.socketId).emit('role', { isHost: true });
	            io.to(room).emit('notification', `${next.name} is now the host (previous host disconnected).`);
	          } else {
	            // No one else left—optional: keep users as "offline" for a while or cleanup immediately
	          }
	        }

	        // After grace, mark offline (and optional hard cleanup later)
	        setTimeout(() => {
	          const u2 = users.get(cid);
	          if (!u2) return;
	          if (Date.now() - u2.lastSeen >= DISCONNECT_GRACE_MS) {
	            u2.status = 'offline';
	            emitUserList(room);
	            notifyHost(room, { code: 'user_left', text: `${u2.name} left the room` });
	            try { roomLog(room, 'user_offline', { user: u2.name, clientId: cid }); } catch (_) {}
	            // Remove entirely after retention window
	            setTimeout(() => {
	              const u3 = users.get(cid);
	              if (!u3) return;
	              if (u3.status === 'offline' && (Date.now() - u3.lastSeen) >= OFFLINE_RETENTION_MS) {
	                users.delete(cid);
	                emitUserList(room);
	                try { roomLog(room, 'user_removed', { user: u3.name, clientId: cid }); } catch (_) {}
	              }
	            }, OFFLINE_RETENTION_MS + 1000);
	          }
	        }, DISCONNECT_GRACE_MS + 500);

	        break;
	      }
	    }
	  }
	});
});

const PORT = process.env.PORT || 3000;

// 404 for unknown routes (after all handlers)
app.use((req, res) => {
  res.status(404).send('Not found');
});

// Generic error handler (avoid leaking stack traces)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  try { console.error('Unhandled error:', err && err.message); } catch (_) {}
  res.status(500).send('Server error');
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
