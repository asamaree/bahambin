---

## 📺 Video Sync — Watch Videos Together in Real-Time

A self-hosted platform where multiple users can watch videos together, chat, and stay synchronized — even across different devices!

---

### 🔧 Manual Install

```bash
sudo apt install git -y
cd /root
git clone https://github.com/asamaree/sync-video-player.git
cd sync-video-player
bash install.sh
```

Server will be available on:

```bash
http://YOUR_SERVER_IP:3000
```

---

### 🌐 How to Use

1. Open your browser and go to your server IP.
2. Paste your video URL (e.g. `https://example.com/video.mkv`) and enter a name.
3. Share the generated room link with others.

---

### 🔗 Room URL Structure

```plaintext
http://YOUR_SERVER_IP:3000/room/ROOM_ID?video=VIDEO_URL&username=USERNAME&subtitle=SUBTITLE_URL
```

**Example:**

```plaintext
http://123.123.123.123:3000/room/abc123?video=https://example.com/video.mkv&username=Ali&subtitle=https://example.com/sub.vtt
```

* `video=` → Direct link to video file (must be supported by browser).
* `username=` → Display name in the room.
* `subtitle=` → Optional `.vtt` file URL.

---

### 📥 Uploading Videos and Subtitles

If you host the server yourself, you can upload your own video and subtitle files directly:

#### 🔹 Upload a Video (e.g. `.mkv`, `.mp4`)

Place the file in the `/public/videos/` directory on your server:

```bash
scp myvideo.mkv root@YOUR_SERVER_IP:/root/video-sync/public/videos/
```

Then use it like this:

```
http://YOUR_SERVER_IP:3000/room/abc123?video=/videos/myvideo.mkv&username=Ali
```

---

#### 🔹 Upload a Subtitle (`.vtt` required)

Only `.vtt` (WebVTT) subtitles are supported.

```bash
scp mysub.vtt root@YOUR_SERVER_IP:/root/video-sync/public/subtitles/
```

Then link to it like this:

```
http://YOUR_SERVER_IP:3000/room/abc123?video=/videos/myvideo.mkv&username=Ali&subtitle=/subtitles/mysub.vtt
```

---

#### ⚠️ About `.srt` Files

Browsers do **not** support `.srt` directly.
To convert `.srt` to `.vtt`:

```bash
ffmpeg -i subtitle.srt subtitle.vtt
```

Or use an online tool:
[https://subtitletools.com/convert-to-vtt-online](https://subtitletools.com/convert-to-vtt-online)

---

### ⚠ Known Limitations

* Mobile browsers (especially iOS Safari) may not sync time position correctly due to autoplay and media restrictions.
* MKV playback may not work on all mobile browsers — we recommend using MP4 or WebM if targeting mobile users.
* Embedded subtitles inside `.mkv` files are **not** supported by browsers. Use external `.vtt` files instead.

---

### 👨‍💻 Project Structure

```
video-sync/
├── server.js
├── install.sh
├── ecosystem.config.js
├── package.json
├── public/
│   ├── index.html
│   ├── room.html
│   ├── style.css
│   ├── videos/
│   └── subtitles/
```

---

### ❤️ Credits

Built using:

* Node.js
* Socket.IO
* HTML5 video
* Pure JS + CSS
* No frontend frameworks (to keep it light)

---

**This is your plug-and-play video sync system. Enjoy it and share the room! 🎬**
