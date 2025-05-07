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

# Start the server using pm2
echo "🚀 Starting the server with pm2..."
pm2 start ecosystem.config.js --update-env
pm2 save

echo "✅ All done! The Video Sync server is running on port 3000."
echo "🌐 Open your browser and go to http://YOUR_SERVER_IP:3000"
