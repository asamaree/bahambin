module.exports = {
  apps : [{
    name: "bahambin",   // Application name
    script: "server.js",  // Main server script
    watch: true,          // Restart the app if files change
    env: {
      PORT: 3000,         // Set your desired port here (e.g., 8443, 3000, etc.)
      // TOTP (Google Authenticator) — add your base32 secret and labels
      // Remove these if you want to disable MFA for room creation
      TOTP_SECRET_BASE32: "M3DPN46UK56CSUUBQZEBSDBA6NEQT4E3",
      TOTP_ISSUER: "BahamBin",
      TOTP_ACCOUNT: "Creator",
    }
  }]
}
