#!/bin/bash

APP_NAME="bahambin" # Define the application name consistently
PROJECT_DIR="/root/sync-video-player" # Define the project directory consistently
# Note: This assumes you clone into /root/sync-video-player. Adjust if your path is different.

echo "🛠 Starting BahamBin Management Script..."

# --- Functions ---

install_bahambin() {
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
    if ! command -v ffmpeg &> /dev:null
    then
        echo "⬇ ffmpeg not found. Installing ffmpeg..."
        sudo apt-get install -y ffmpeg
    else
        echo "✅ ffmpeg already installed."
    fi

    # Start the server using pm2. The port will be read from ecosystem.config.js
    echo "🚀 Starting the server with pm2..."
    pm2 start ecosystem.config.js --env production --update-env --interpreter bash --name "$APP_NAME" --output /dev/null --error /dev/null --log-date-format "YYYY-MM-DD HH:mm:ss" --watch
    pm2 save

    echo "✅ All done! The BahamBin server is running."
    echo "🌐 Check ecosystem.config.js or 'pm2 show $APP_NAME' for the exact port."
    echo "Remember to configure Nginx/firewall if needed for public access."
}

uninstall_bahambin() {
    echo "Are you sure you want to completely uninstall BahamBin? This will stop and delete the PM2 app, remove project files, and optionally PM2 and ffmpeg."
    read -p "Type 'yes' to confirm: " CONFIRM_UNINSTALL
    if [[ "$CONFIRM_UNINSTALL" != "yes" ]]; then
        echo "Uninstall cancelled."
        exit 0
    fi

    echo "🛑 Stopping and deleting PM2 app '$APP_NAME'..."
    pm2 stop "$APP_NAME" 2>/dev/null || true
    pm2 delete "$APP_NAME" 2>/dev/null || true
    pm2 save 2>/dev/null || true

    echo "🗑 Removing project directory: $PROJECT_DIR..."
    if [ -d "$PROJECT_DIR" ]; then
        sudo rm -rf "$PROJECT_DIR"
        echo "✅ Project directory removed."
    else
        echo "ℹ Project directory not found, skipping removal."
    fi

    read -p "Do you want to uninstall PM2 globally? (yes/no): " UNINSTALL_PM2
    if [[ "$UNINSTALL_PM2" == "yes" ]]; then
        echo "🗑 Uninstalling PM2 globally..."
        sudo npm uninstall -g pm2
        echo "✅ PM2 uninstalled."
    fi

    read -p "Do you want to uninstall ffmpeg? (yes/no): " UNINSTALL_FFMPEG
    if [[ "$UNINSTALL_FFMPEG" == "yes" ]]; then
        echo "🗑 Uninstalling ffmpeg..."
        sudo apt-get purge ffmpeg -y
        echo "✅ FFmpeg uninstalled."
    fi

    echo "🎉 BahamBin uninstallation complete."
}

update_bahambin() {
    echo "🔄 Updating BahamBin..."

    if [ ! -d "$PROJECT_DIR/.git" ]; then
        echo "❌ Error: Git repository not found in $PROJECT_DIR. Cannot update."
        echo "Please ensure you are running this script from the project root or specify the correct PROJECT_DIR."
        exit 1
    fi

    echo "🛑 Stopping PM2 app '$APP_NAME'..."
    pm2 stop "$APP_NAME" 2>/dev/null || true

    echo "⬇ Pulling latest changes from Git..."
    git -C "$PROJECT_DIR" pull origin main # Assuming 'main' branch. Change if different.

    echo "📦 Reinstalling npm packages..."
    npm install --prefix "$PROJECT_DIR" # Use --prefix to ensure install in project dir

    echo "🚀 Restarting PM2 app '$APP_NAME'..."
    pm2 restart "$APP_NAME" --update-env # --update-env ensures new env vars from ecosystem.config.js are applied
    pm2 save

    echo "✅ BahamBin update complete."
}

# --- Main Script Logic ---

if [ "$EUID" -ne 0 ]; then
    echo "Please run as root or with sudo."
    exit 1
fi

case "$1" in
    install)
        install_bahambin
        ;;
    uninstall)
        uninstall_bahambin
        ;;
    update)
        update_bahambin
        ;;
    *)
        echo "Usage: $0 {install|uninstall|update}"
        echo "  install   - Installs BahamBin, Node.js, PM2, and FFmpeg."
        echo "  uninstall - Removes BahamBin, PM2 app, and optionally PM2/FFmpeg."
        echo "  update    - Pulls latest code, reinstalls npm packages, and restarts the app."
        exit 1
        ;;
esac

