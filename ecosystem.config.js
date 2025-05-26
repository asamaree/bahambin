module.exports = {
  apps : [{
    name: "bahambin",   // Application name changed to "bahambin"
    script: "server.js",  // Main server script
    watch: true,          // Restart the app if files change
    env: {
      PORT: process.env.PORT || 3000 // Dynamically use the PORT environment variable, fallback to 3000
    }
  }]
}
