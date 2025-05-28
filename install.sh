#!/bin/bash

# Colors
red='\033[0;31m'
green='\033[0;32m'
yellow='\033[0;33m'
plain='\033[0m'

echo -e "${green}🛠 Starting BahamBin Auto Installer...${plain}"

# Check for root
if [[ $EUID -ne 0 ]]; then
    echo -e "${red}❌ Please run this script as root!${plain}"
    exit 1
fi

# Detect OS
if [[ -f /etc/os-release ]]; then
    source /etc/os-release
    release=$ID
else
    echo -e "${red}❌ Cannot detect OS. Exiting.${plain}"
    exit 1
fi
echo -e "${green}✔ OS detected: $release${plain}"

# System update
echo -e "${yellow}🔄 Updating packages...${plain}"
apt-get update -y

# Install base tools
apt-get install -y curl ffmpeg

# Install Node.js
if ! command -v node &> /dev/null; then
    echo -e "${yellow}⬇ Installing Node.js 18.x...${plain}"
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
else
    echo -e "${green}✔ Node.js installed: $(node -v)${plain}"
fi

# Install npm packages
echo -e "${yellow}📦 Installing npm dependencies...${plain}"
npm install

# Install PM2
if ! command -v pm2 &> /dev/null; then
    echo -e "${yellow}⬇ Installing PM2...${plain}"
    npm install -g pm2
else
    echo -e "${green}✔ PM2 already installed${plain}"
fi

# Start the server
echo -e "${yellow}🚀 Launching BahamBin with PM2...${plain}"
pm2 start ecosystem.config.js --env production --update-env --interpreter bash --name bahambin
pm2 save

echo -e "${green}✅ BahamBin is now running.${plain}"
