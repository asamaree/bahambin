#!/bin/bash

echo "🛠 Starting Video-Sync Auto Installer..."

# Update the system packages
echo "🔄 Updating system packages..."
sudo apt-get update -y

# Check if Node.js is installed
if ! command -v node &> /dev/null
then
    echo "⬇ Node.js not found. Installing Node.js 18.x..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "✅ Node.js already installed: $(node -v)"
fi

# Install npm packages for the project
echo "📦 Installing project npm packages..."
npm install

# Check if pm2 is installed
if ! command -v pm2 &> /dev/null
then
    echo "⬇ PM2 not found. Installing pm2 globally..."
    sudo npm install -g pm2
else
    echo "✅ PM2 already installed."
fi

# Check and install ffmpeg
if ! command -v ffmpeg &> /dev/null
then
    echo "⬇ ffmpeg not found. Installing ffmpeg..."
    sudo apt-get install -y ffmpeg
else
    echo "✅ ffmpeg already installed."
fi

# NEW: Ask the user for the desired port
read -p "Enter the port you want the server to run on (default: 3000): " CUSTOM_PORT

# Set default port if user input is empty
if [ -z "$CUSTOM_PORT" ]; then
    CUSTOM_PORT=3000
fi

echo "🚀 Starting the server with pm2 on port $CUSTOM_PORT..."

# Start the server using pm2, directly passing the custom port as an environment variable
# This overrides any 'env' block in ecosystem.config.js for PORT during startup
pm2 start ecosystem.config.js --env production --update-env --interpreter bash --name bahambin --output /dev/null --error /dev/null --log-date-format "YYYY-MM-DD HH:mm:ss" --watch -- < <(echo "export PORT=${CUSTOM_PORT}")
# Removed the separate 'pm2 set env PORT $CUSTOM_PORT bahambin' command as it's now direct

pm2 save

echo "✅ All done! The BahamBin server is running on port $CUSTOM_PORT."
echo "🌐 Open your browser and go to http://YOUR_SERVER_IP:$CUSTOM_PORT"
