module.exports = {
  apps : [{
    name: "bahambin",   // Application name
    script: "server.js",  // Main server script
    watch: true,          // Restart the app if files change
    env: {
      PORT: 8443          // Set your desired port here (e.g., 8443, 3000, etc.)
    }
  }]
}
