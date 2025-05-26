⸻

📺 BahamBin — Watch Videos Together in Real-Time

BahamBin is a self-hosted platform designed for synchronized group video watching. It allows multiple users to stream videos together in real-time, offering synchronized playback, rich chat functionalities, and intuitive host management — all within a user-friendly interface.

Built with a focus on ease of deployment and a lean tech stack, BahamBin makes shared viewing effortless and engaging.

⸻

✨ Key Features & Enhancements

Over recent developments, BahamBin has gained significant features and UI refinements:

🔹 Modern & Intuitive Landing Page
	•	Clean, modern aesthetic, similar to popular login interfaces.
	•	Prominent “BahamBin” brand name and tagline:
“Watch videos together, synchronized, effortlessly.”
	•	Simplified video input (supports .mkv format).
	•	Streamlined subtitle upload with a styled button and dynamic file name display.

🔹 Automated Subtitle Handling
	•	Hosts can upload .srt subtitle files directly.
	•	Server converts .srt files to browser-compatible .vtt using ffmpeg.

🔹 Advanced Chat Box
	•	Messenger-like UI: Modern, bubble-style chat messages.
	•	User Identity: Unique colors for users; initials in avatars.
	•	Host Recognition: “Host” badge on messages from the room creator.
	•	Timestamps: Exact send time shown on each message.
	•	Replies: Quoted replies with sender info.
	•	Emoji Reactions: Real-time reactions (👍, ❤️, 😂, 😮, 😢, 👏, 🔥).
	•	Notifications: Join/leave events shown in the chat timeline.
	•	Responsive Layout: Input area stays visible with long chat history.
	•	Polished Input: Rounded corners, hover/focus effects.

🔹 Host Room Management & User List
	•	User Panel: Displayed above chat; video player stays unaffected.
	•	User List: Shows names, host status, and host controls.
	•	Transfer Host: Assign host role to another user via “Make Host” button.

⸻

🚀 Installation

BahamBin is designed for easy self-hosting.

sudo apt install git -y
cd /root
git clone https://github.com/asamaree/sync-video-player.git
cd sync-video-player
bash install.sh

During install.sh, you’ll be asked to enter your desired port.

Once installed, access your server at:

http://YOUR_SERVER_IP:YOUR_CHOSEN_PORT


⸻

🌐 How to Use
	1.	Open your browser and go to:
http://YOUR_SERVER_IP:YOUR_CHOSEN_PORT
	2.	Enter your name and a direct link to a .mkv video.
	3.	(Optional) Upload a .srt subtitle file — it will be auto-converted to .vtt.
	4.	Click Start Room to begin.
	5.	Share the room link to invite others!

⸻

🔗 Room URL Structure

http://YOUR_SERVER_IP:PORT/room/ROOM_ID?video=VIDEO_URL&username=USERNAME&subtitle=SUBTITLE_URL

Example:

http://123.123.123.123:3000/room/abc123?video=https://example.com/my_movie.mkv&username=Alice&subtitle=/subtitles/my_sub.vtt

	•	video= → Direct .mkv video URL (must be accessible).
	•	username= → Display name in room.
	•	subtitle= → Optional .vtt subtitle URL.

⸻

📥 Uploading Videos and Subtitles (Self-Hosted)

If you’re self-hosting, upload your media like this:

🔹 Upload a Video

Place your .mkv file in the server’s public/videos/ folder:

scp myvideo.mkv root@YOUR_SERVER_IP:/root/video-sync/public/videos/

Then use:

/videos/myvideo.mkv

🔹 Upload a Subtitle

You can:
	•	Upload .srt through the web interface (auto-converted), or
	•	Upload .vtt directly to public/subtitles/:

scp mysub.vtt root@YOUR_SERVER_IP:/root/video-sync/public/subtitles/

Then use:

/subtitles/mysub.vtt


⸻

⚠ Known Limitations
	•	Mobile browsers (especially iOS Safari) may not sync properly due to autoplay restrictions.
	•	Embedded subtitles in video files are not supported — use external .vtt instead.

⸻

👨‍💻 Project Structure

bahambin/
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


⸻

❤️ Credits

Built with:
	•	Node.js
	•	Socket.IO
	•	HTML5 video
	•	Pure JavaScript + CSS
	•	ffmpeg for subtitle conversion

No frontend frameworks — lightweight by design.

⸻

🎬 BahamBin

Your plug-and-play video sync system.
Enjoy it and share the room!
