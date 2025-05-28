#!/bin/bash

# --- Global Variables ---
APP_NAME="bahambin"
PROJECT_GIT_URL="https://github.com/asamaree/sync-video-player.git" # <<< IMPORTANT: Replace with your actual BahamBin GitHub URL
PROJECT_DIR="/opt/$APP_NAME" # Recommended: /opt for optional software
PM2_CONFIG_FILE="$PROJECT_DIR/ecosystem.config.js"
GLOBAL_CMD_PATH="/usr/local/bin/$APP_NAME" # Path for the global command

# --- Colors for output ---
red='\033[0;31m'
green='\033[0;32m'
blue='\033[0;34m'
yellow='\033[0;33m'
plain='\033[0m'

# --- Helper Functions ---

check_root() {
    [[ $EUID -ne 0 ]] && echo -e "${red}Fatal error: ${plain} Please run this script with root privilege \n" && exit 1
}

check_os_arch_glibc() {
    # Check OS and set release variable
    if [[ -f /etc/os-release ]]; then
        source /etc/os-release
        release=$ID
    elif [[ -f /usr/lib/os-release ]]; then
        source /usr/lib/os-release
        release=$ID
    else
        echo -e "${red}Failed to check the system OS, please contact the author!${plain}" >&2
        exit 1
    fi
    echo -e "${blue}OS Release: ${plain}${release}"

    # Check Architecture
    case "$(uname -m)" in
        x86_64 | x64 | amd64) ARCH='amd64' ;;
        armv8* | armv8 | arm64 | aarch64) ARCH='arm64' ;;
        armv7* | armv7 | arm) ARCH='armv7' ;;
        armv6* | armv6) ARCH='armv6' ;;
        armv5* | armv5) ARCH='armv5' ;;
        s390x) ARCH='s390x' ;;
        *) echo -e "${red}Unsupported CPU architecture! ${plain}" && exit 1 ;;
    esac
    echo -e "${blue}CPU Architecture: ${plain}${ARCH}"

    # Check GLIBC version (example from 3x-ui, adjust if BahamBin has specific needs)
    if command -v ldd &> /dev/null; then
        glibc_version=$(ldd --version | head -n1 | awk '{print $NF}')
        required_version="2.32" # Adjust if BahamBin has a different GLIBC requirement
        if [[ "$(printf '%s\n' "$required_version" "$glibc_version" | sort -V | head -n1)" != "$required_version" ]]; then
            echo -e "${red}GLIBC version $glibc_version is too old! Required: $required_version or higher${plain}"
            echo "Please upgrade to a newer version of your operating system."
            exit 1
        fi
        echo -e "${blue}GLIBC Version: ${plain}${glibc_version} (meets requirement of ${required_version}+)"
    else
        echo -e "${yellow}Warning: ldd not found. Cannot check GLIBC version.${plain}"
    fi
}

install_base_deps() {
    echo -e "${blue}Installing base system dependencies (wget, curl, tar, git, tzdata)...${plain}"
    case "${release}" in
        ubuntu | debian | armbian)
            apt-get update && apt-get install -y -q wget curl tar git tzdata
            ;;
        centos | almalinux | rocky | ol)
            yum -y update && yum install -y -q wget curl tar git tzdata
            ;;
        fedora | amzn | virtuozzo)
            dnf -y update && dnf install -y -q wget curl tar git tzdata
            ;;
        arch | manjaro | parch)
            pacman -Syu --noconfirm && pacman -Syu --noconfirm wget curl tar git tzdata
            ;;
        opensuse-tumbleweed)
            zypper refresh && zypper -q install -y wget curl tar git timezone
            ;;
        *)
            echo -e "${yellow}Warning: Unknown OS, attempting apt-get for base deps.${plain}"
            apt-get update && apt install -y -q wget curl tar git tzdata
            ;;
    esac
    if [[ $? -ne 0 ]]; then
        echo -e "${red}Failed to install base dependencies.${plain}"
        exit 1
    fi
    echo -e "${green}Base dependencies installed.${plain}"
}

install_nodejs_npm() {
    if ! command -v node &> /dev/null; then
        echo -e "${blue}Node.js not found. Installing Node.js 18.x...${plain}"
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
        if [[ $? -ne 0 ]]; then
            echo -e "${red}Failed to install Node.js.${plain}"
            exit 1
        fi
    else
        echo -e "${green}Node.js already installed: $(node -v)${plain}"
    fi
}

install_pm2() {
    if ! command -v pm2 &> /dev/null; then
        echo -e "${blue}PM2 not found. Installing pm2 globally...${plain}"
        sudo npm install -g pm2
        if [[ $? -ne 0 ]]; then
            echo -e "${red}Failed to install PM2.${plain}"
            exit 1
        fi
    else
        echo -e "${green}PM2 already installed.${plain}"
    fi
}

install_ffmpeg() {
    if ! command -v ffmpeg &> /dev/null; then # Corrected /dev:null to /dev/null
        echo -e "${blue}FFmpeg not found. Installing FFmpeg...${plain}"
        sudo apt-get install -y ffmpeg
        if [[ $? -ne 0 ]]; then
            echo -e "${red}Failed to install FFmpeg.${plain}"
            exit 1
        fi
    else
        echo -e "${green}FFmpeg already installed.${plain}"
    fi
}

# --- Core Management Functions ---

install_bahambin() {
    echo -e "${blue}Starting BahamBin installation...${plain}"

    if [ ! -d "$PROJECT_DIR/.git" ]; then
        echo -e "${blue}Cloning BahamBin repository from ${PROJECT_GIT_URL} to ${PROJECT_DIR}...${plain}"
        sudo mkdir -p "$PROJECT_DIR"
        sudo git clone "$PROJECT_GIT_URL" "$PROJECT_DIR"
        if [[ $? -ne 0 ]]; then
            echo -e "${red}Failed to clone BahamBin repository. Check URL or network.${plain}"
            exit 1
        fi
    else
        echo -e "${green}BahamBin repository already exists at ${PROJECT_DIR}. Skipping clone.${plain}"
    fi

    cd "$PROJECT_DIR" || { echo -e "${red}Failed to change directory to ${PROJECT_DIR}. Exiting.${plain}"; exit 1; }

    echo -e "${blue}Installing npm packages for the project...${plain}"
    npm install --prefix "$PROJECT_DIR"
    if [[ $? -ne 0 ]]; then
        echo -e "${red}Failed to install npm packages.${plain}"
        exit 1
    fi

    # Ensure uploads and public/subtitles directories exist and have correct permissions
    echo -e "${blue}Ensuring necessary directories exist and have permissions...${plain}"
    sudo mkdir -p "$PROJECT_DIR/uploads"
    sudo mkdir -p "$PROJECT_DIR/public/subtitles"
    sudo chmod -R 777 "$PROJECT_DIR/uploads" # For Multer to write temp files
    sudo chmod -R 777 "$PROJECT_DIR/public/subtitles" # For FFmpeg to write VTT files
    echo -e "${green}Directories checked/created.${plain}"

    echo -e "${blue}Starting BahamBin server with PM2...${plain}"
    # Stop and delete any old PM2 instance of the app
    pm2 stop "$APP_NAME" 2>/dev/null || true
    pm2 delete "$APP_NAME" 2>/dev/null || true

    # Start the server using pm2. Port from ecosystem.config.js
    pm2 start "$PM2_CONFIG_FILE" --env production --update-env --interpreter bash --name "$APP_NAME" --output /dev/null --error /dev/null --log-date-format "YYYY-MM-DD HH:mm:ss" --watch
    pm2 save

    # Create global command symlink
    echo -e "${blue}Creating global command: ${GLOBAL_CMD_PATH}${plain}"
    sudo rm -f "$GLOBAL_CMD_PATH" # Remove old symlink if exists
    sudo ln -s "$(readlink -f "$0")" "$GLOBAL_CMD_PATH" # Link to this script itself
    sudo chmod +x "$GLOBAL_CMD_PATH" # Ensure it's executable

    echo -e "${green}🎉 BahamBin installation complete!${plain}"
    echo -e "${yellow}You can now manage BahamBin by typing '${APP_NAME}' in your terminal.${plain}"
    echo -e "${blue}🌐 Check ecosystem.config.js or 'pm2 show $APP_NAME' for the exact port.${plain}"
    echo -e "${yellow}Remember to configure Nginx/firewall if needed for public access on that port.${plain}"
}

uninstall_bahambin() {
    echo -e "${red}WARNING: This will completely uninstall BahamBin, including stopping the PM2 app, removing project files, and optionally PM2 and FFmpeg.${plain}"
    read -p "Type 'yes' to confirm: " CONFIRM_UNINSTALL
    if [[ "$CONFIRM_UNINSTALL" != "yes" ]]; then
        echo -e "${yellow}Uninstall cancelled.${plain}"
        return 0
    fi

    echo -e "${blue}🛑 Stopping and deleting PM2 app '$APP_NAME'..."
    pm2 stop "$APP_NAME" 2>/dev/null || true
    pm2 delete "$APP_NAME" 2>/dev/null || true
    pm2 save 2>/dev/null || true
    echo -e "${green}PM2 app stopped and deleted.${plain}"

    echo -e "${blue}🗑 Removing project directory: $PROJECT_DIR...${plain}"
    if [ -d "$PROJECT_DIR" ]; then
        sudo rm -rf "$PROJECT_DIR"
        echo -e "${green}Project directory removed.${plain}"
    else
        echo -e "${yellow}ℹ Project directory not found, skipping removal.${plain}"
    fi

    echo -e "${blue}🗑 Removing global command: ${GLOBAL_CMD_PATH}...${plain}"
    sudo rm -f "$GLOBAL_CMD_PATH"
    echo -e "${green}Global command removed.${plain}"

    read -p "Do you want to uninstall PM2 globally? (yes/no): " UNINSTALL_PM2
    if [[ "$UNINSTALL_PM2" == "yes" ]]; then
        echo -e "${blue}🗑 Uninstalling PM2 globally...${plain}"
        sudo npm uninstall -g pm2
        echo -e "${green}PM2 uninstalled.${plain}"
    fi

    read -p "Do you want to uninstall ffmpeg? (yes/no): " UNINSTALL_FFMPEG
    if [[ "$UNINSTALL_FFMPEG" == "yes" ]]; then
        echo -e "${blue}🗑 Uninstalling ffmpeg...${plain}"
        sudo apt-get purge ffmpeg -y
        echo -e "${green}FFmpeg uninstalled.${plain}"
    fi

    echo -e "${green}🎉 BahamBin uninstallation complete.${plain}"
}

update_bahambin() {
    echo -e "${blue}Starting BahamBin update...${plain}"

    if [ ! -d "$PROJECT_DIR/.git" ]; then
        echo -e "${red}❌ Error: BahamBin project directory not found or not a Git repository at ${PROJECT_DIR}.${plain}"
        echo -e "${yellow}Please run 'install' first or ensure the project is correctly cloned.${plain}"
        return 1
    fi

    echo -e "${blue}🛑 Stopping PM2 app '$APP_NAME' (if running)...${plain}"
    pm2 stop "$APP_NAME" 2>/dev/null || true

    cd "$PROJECT_DIR" || { echo -e "${red}Failed to change directory to ${PROJECT_DIR}. Exiting.${plain}"; exit 1; }

    echo -e "${blue}⬇ Pulling latest changes from Git...${plain}"
    git pull origin main # Assuming 'main' branch. Change if different.
    if [[ $? -ne 0 ]]; then
        echo -e "${red}Failed to pull latest changes. Resolve Git conflicts or check network.${plain}"
        return 1
    fi

    echo -e "${blue}📦 Reinstalling npm packages...${plain}"
    npm install --prefix "$PROJECT_DIR"
    if [[ $? -ne 0 ]]; then
        echo -e "${red}Failed to reinstall npm packages.${plain}"
        return 1
    fi

    echo -e "${blue}🚀 Restarting PM2 app '$APP_NAME'...${plain}"
    pm2 restart "$APP_NAME" --update-env # --update-env ensures new env vars from ecosystem.config.js are applied
    pm2 save

    echo -e "${green}✅ BahamBin update complete.${plain}"
}

show_status() {
    echo -e "${blue}Fetching BahamBin status...${plain}"
    pm2 show "$APP_NAME"
    echo -e "${blue}Last 20 lines of BahamBin logs:${plain}"
    pm2 logs "$APP_NAME" --lines 20
    echo -e "${blue}Listening ports on the server:${plain}"
    sudo netstat -tulnp | grep "node" || echo "Node.js process not found listening on any port."
    echo -e "${green}Status check complete.${plain}"
}

show_menu() {
    check_root
    check_os_arch_glibc
    install_base_deps # Ensure base deps are there even for menu
    install_nodejs_npm # Ensure node/npm for pm2/npm commands
    install_pm2 # Ensure pm2 for management commands

    while true; do
        echo -e "\n--- ${green}BahamBin Management Menu${plain} ---"
        echo -e "${green}1.${plain} Install BahamBin"
        echo -e "${green}2.${plain} Update BahamBin"
        echo -e "${green}3.${plain} Uninstall BahamBin"
        echo -e "${green}4.${plain} Show BahamBin Status"
        echo -e "${green}0.${plain} Exit"
        echo -e "----------------------------------"
        read -p "Enter your choice: " choice

        case "$choice" in
            1) install_bahambin ;;
            2) update_bahambin ;;
            3) uninstall_bahambin ;;
            4) show_status ;;
            0) echo -e "${green}Exiting. Goodbye!${plain}"; exit 0 ;;
            *) echo -e "${red}Invalid choice. Please enter a number from the menu.${plain}" ;;
        esac
    done
}

# --- Main Script Execution ---

check_root # Always check root at the very beginning

if [[ -z "$1" ]]; then
    # If no arguments, show the interactive menu
    show_menu
else
    # If arguments are provided, execute the corresponding function
    case "$1" in
        install)
            check_os_arch_glibc
            install_base_deps
            install_nodejs_npm
            install_pm2
            install_ffmpeg
            install_bahambin
            ;;
        uninstall)
            uninstall_bahambin
            ;;
        update)
            update_bahambin
            ;;
        status) # Allow 'status' as a direct argument
            show_status
            ;;
        *)
            echo -e "${red}Usage: $0 {install|uninstall|update|status}${plain}"
            echo -e "${yellow}Or run without arguments for interactive menu: $0${plain}"
            exit 1
            ;;
    esac
fi
