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

# Removed: Dynamic port selection and CUSTOM_PORT variable
# The port will now be entirely determined by ecosystem.config.js

echo "🚀 Starting the server with pm2..."

# Start the server using pm2. The port will be read from ecosystem.config.js
pm2 start ecosystem.config.js --env production --update-env --interpreter bash --name bahambin --output /dev/null --error /dev/null --log-date-format "YYYY-MM-DD HH:mm:ss" --watch

pm2 save

echo "✅ All done! The BahamBin server is running."
echo "🌐 Check ecosystem.config.js or pm2 show bahambin for the exact port."
