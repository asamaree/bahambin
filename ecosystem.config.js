module.exports = {
  apps : [{
    name: "video-sync",   // Application name
    script: "server.js",  // Main server script
    watch: true,          // Restart the app if files change
    env: {
      PORT: 3000          // Default port
    }
  }]
}
