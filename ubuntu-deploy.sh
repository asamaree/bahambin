#!/usr/bin/env bash
# Note: moved to repo root for easier curl | bash usage

# BahamBin Ubuntu Deployment Helper
# - Installs Node.js, PM2, Nginx
# - Issues SSL via acme.sh (Let's Encrypt) with optional Cloudflare DNS
# - Runs the app with PM2 and reverse proxy via Nginx on 443
# - Updates from GitHub only when newer
# - Removes app, Nginx config, and PM2 services cleanly

set -euo pipefail

# Pretty output colors
NC="\033[0m"; BOLD="\033[1m"; GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; CYAN="\033[36m"

APP_NAME="bahambin"
DEFAULT_REPO="https://github.com/asamaree/bahambin.git"
APP_DIR="/opt/${APP_NAME}"
NGINX_SITE="/etc/nginx/sites-available/${APP_NAME}.conf"
NGINX_SITE_LINK="/etc/nginx/sites-enabled/${APP_NAME}.conf"
NGINX_SSL_DIR="/etc/nginx/ssl"
# Cert and key paths are optional and only used if provided and exist
CERT_PATH=""
KEY_PATH=""
DOMAIN=""
EMAIL=""
CF_TOKEN=""
PORT=""
REPO_URL="${DEFAULT_REPO}"
# Installer behavior
NON_INTERACTIVE=0
UFW_AUTO=1

log() { echo -e "${CYAN}[${APP_NAME}]${NC} $*"; }
ok() { echo -e "${GREEN}[${APP_NAME}]${NC} $*"; }
warn() { echo -e "${YELLOW}[${APP_NAME}] WARN:${NC} $*"; }
err() { echo -e "${RED}[${APP_NAME}] ERROR:${NC} $*" >&2; }

confirm() {
  local prompt="${1:-Are you sure?}"; local default_yes="${2:-y}"; local ans
  if [[ "$default_yes" =~ ^[Yy]$ ]]; then
    read -r -p "${prompt} [Y/n]: " ans || true
    [[ -z "$ans" || "$ans" =~ ^[Yy] ]] && return 0 || return 1
  else
    read -r -p "${prompt} [y/N]: " ans || true
    [[ "$ans" =~ ^[Yy] ]] && return 0 || return 1
  fi
}

ask() {
  local prompt="$1"; local default_val="$2"; local out
  read -r -p "${prompt} [${default_val}]: " out || true
  if [[ -z "$out" ]]; then echo "$default_val"; else echo "$out"; fi
}

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    err "Please run as root (use sudo)."; exit 1
  fi
}

detect_port_from_ecosystem() {
  local dir="$1"
  if command -v node >/dev/null 2>&1 && [[ -f "${dir}/ecosystem.config.js" ]]; then
    node -e "try{const c=require('${dir}/ecosystem.config.js');console.log((c.apps?.[0]?.env?.PORT)||'');}catch(e){console.log('');}" || true
  else
    echo ""
  fi
}

ensure_deps() {
  log "Updating apt cache and installing dependencies..."
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y curl git nginx ffmpeg ufw

  if ! command -v node >/dev/null 2>&1; then
    log "Installing Node.js 18 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
  else
    log "Node.js already present: $(node -v)"
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    log "Installing PM2 globally..."
    npm i -g pm2
  else
    log "PM2 already present: $(pm2 -v)"
  fi

  mkdir -p "${NGINX_SSL_DIR}"
}

has_ssl() {
  [[ -n "${DOMAIN}" && -n "${CERT_PATH}" && -n "${KEY_PATH}" && -f "${CERT_PATH}" && -f "${KEY_PATH}" ]]
}

configure_ufw() {
  log "Configuring UFW firewall..."
  # Ensure OpenSSH is always allowed to avoid lockout
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp || true

  if has_ssl; then
    # If SSL is configured, allow 443 too
    ufw allow 80/tcp || true
    ufw allow 443/tcp || true
  else
    # No SSL yet: just HTTP for Nginx
    ufw allow 80/tcp || true
  fi

  if [[ "${UFW_AUTO}" -eq 1 ]]; then
    # Enable UFW if inactive
    local state
    state=$(ufw status | awk 'NR==1{print tolower($2)}' || true)
    if [[ "${state}" == "inactive" ]]; then
      log "Enabling UFW (non-interactive)..."
      ufw --force enable || true
    fi
  else
    warn "Skipping UFW enable (per selection)."
  fi

  ufw status verbose || true
}

clone_or_update_repo() {
  local repo="$1"; local dir="$2"
  if [[ -d "${dir}/.git" ]]; then
    log "Existing repo found in ${dir}. Skipping clone."
  else
    log "Cloning ${repo} into ${dir}..."
    rm -rf "${dir}"
    git clone --depth=1 "${repo}" "${dir}"
  fi
}

install_app() {
  need_root
  ensure_deps

  # Interactive wizard unless non-interactive
  if [[ "${NON_INTERACTIVE}" -ne 1 ]]; then
    echo
    echo -e "${BOLD}Welcome to BahamBin installer${NC}"
    echo "This will set up the app under PM2 with Nginx as a reverse proxy."
    echo
    local def_port
    def_port=$(detect_port_from_ecosystem "${APP_DIR}"); def_port="${def_port:-3000}"
    APP_DIR=$(ask "Install directory" "${APP_DIR}")
    REPO_URL=$(ask "Git repository URL" "${REPO_URL}")
    DOMAIN=$(ask "Domain (leave empty for none)" "${DOMAIN}")
    PORT=$(ask "Internal app port" "${PORT:-$def_port}")
    local ufw_ans; ufw_ans=$(ask "Enable UFW firewall (OpenSSH + 80${DOMAIN:+,+443})" "yes")
    [[ "${ufw_ans,,}" =~ ^(y|yes)$ ]] && UFW_AUTO=1 || UFW_AUTO=0

    echo
    echo -e "${BOLD}Summary${NC}"
    echo "  Directory: ${APP_DIR}"
    echo "  Repo URL : ${REPO_URL}"
    echo "  Domain   : ${DOMAIN:-(none)}"
    echo "  Port     : ${PORT}"
    echo "  UFW      : $([[ ${UFW_AUTO} -eq 1 ]] && echo enable || echo skip)"
    echo
    confirm "Proceed with installation?" y || { warn "Installation cancelled."; exit 1; }
  fi

  clone_or_update_repo "${REPO_URL}" "${APP_DIR}"

  log "Installing npm dependencies..."
  cd "${APP_DIR}"
  npm ci || npm install

  # Derive port if still empty
  local derived_port
  derived_port=$(detect_port_from_ecosystem "${APP_DIR}")
  PORT="${PORT:-${derived_port:-3000}}"
  log "Using app port: ${PORT}"

  log "Starting app with PM2..."
  if [[ -f ecosystem.config.js ]]; then
    PORT="${PORT}" pm2 start ecosystem.config.js --env production --name "${APP_NAME}" || true
  else
    PORT="${PORT}" pm2 start server.js --name "${APP_NAME}" || true
  fi
  pm2 save

  log "Configuring PM2 to start on boot..."
  local pm2_user="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
  local pm2_home="/home/${pm2_user}"
  if [[ "${pm2_user}" == "root" ]]; then pm2_home="/root"; fi
  pm2 startup systemd -u "${pm2_user}" --hp "${pm2_home}" >/dev/null 2>&1 || true

  log "Configuring Nginx reverse proxy..."
  configure_nginx

  # Configure UFW ports (OpenSSH + 80; +443 if domain provided and SSL set)
  configure_ufw

  systemctl enable nginx || true
  systemctl restart nginx

  # Provide an easy CLI entry
  ln -sf "${APP_DIR}/ubuntu-deploy.sh" /usr/local/bin/bahambin || true

  ok "Installation finished."
  echo -e "${BOLD}Next steps${NC}"
  echo "  - Point your domain DNS (optional) to this server."
  echo "  - Visit: http://YOUR_SERVER_IP/"
  echo "  - To set up HTTPS later:"
  echo "      sudo bahambin set-ssl --domain your.domain.com --cert /path/fullchain.pem --key /path/privkey.pem"
}

configure_nginx() {
  if [[ -z "${PORT}" ]]; then
    local dp
    dp=$(detect_port_from_ecosystem "${APP_DIR}")
    PORT="${dp:-3000}"
  fi

  if has_ssl; then
    # With valid cert and key: redirect HTTP to HTTPS and serve SSL on 443
    cat > "${NGINX_SITE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate ${CERT_PATH};
    ssl_certificate_key ${KEY_PATH};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
  else
    # No SSL configured: only HTTP proxy (useful pre-SSL)
    cat > "${NGINX_SITE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN:-_};

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
  fi

  ln -sf "${NGINX_SITE}" "${NGINX_SITE_LINK}"

  # Disable default site if present
  if [[ -e /etc/nginx/sites-enabled/default ]]; then
    rm -f /etc/nginx/sites-enabled/default || true
  fi

  nginx -t
}

set_ssl() {
  need_root
  if [[ -z "${DOMAIN}" || -z "${CERT_PATH}" || -z "${KEY_PATH}" ]]; then
    err "set-ssl requires --domain, --cert, and --key"; exit 1
  fi
  if [[ ! -f "${CERT_PATH}" || ! -f "${KEY_PATH}" ]]; then
    err "Cert or key file not found. CERT='${CERT_PATH}' KEY='${KEY_PATH}'"; exit 1
  fi

  log "Applying SSL using provided certificate and key..."
  configure_nginx
  systemctl reload nginx
  configure_ufw
  log "SSL configured for ${DOMAIN}."
}

update_app() {
  need_root
  if [[ ! -d "${APP_DIR}/.git" ]]; then
    err "App directory is not a git repo: ${APP_DIR}. Use install first."; exit 1
  fi
  log "Checking for updates in ${APP_DIR}..."
  cd "${APP_DIR}"
  local local_ref remote_ref
  local_ref=$(git rev-parse HEAD)
  remote_ref=$(git ls-remote origin HEAD | awk '{print $1}')
  if [[ -z "${remote_ref}" ]]; then
    err "Unable to query remote origin. Check network or repo URL."; exit 1
  fi
  if [[ "${local_ref}" == "${remote_ref}" ]]; then
    log "Already up-to-date."
    exit 0
  fi

  log "Updating to latest..."
  git fetch --depth=1 origin
  git reset --hard "${remote_ref}"
  npm ci || npm install

  log "Restarting PM2 app..."
  pm2 reload "${APP_NAME}" || pm2 restart "${APP_NAME}" || true
  pm2 save
  log "Update complete."
}

remove_app() {
  need_root
  log "Stopping and deleting PM2 app..."
  pm2 delete "${APP_NAME}" || true
  pm2 save || true

  log "Removing Nginx site config..."
  rm -f "${NGINX_SITE}" "${NGINX_SITE_LINK}" || true
  nginx -t && systemctl reload nginx || true

  log "Optionally removing app directory ${APP_DIR}..."
  rm -rf "${APP_DIR}" || true

  log "Removal complete. SSL cert files kept at ${NGINX_SSL_DIR}. Use acme.sh to remove if desired."
}

status_app() {
  pm2 status || true
  systemctl status nginx --no-pager || true
}

usage() {
  cat <<EOF
Usage: $0 <command> [options]

Commands:
  install              Guided install (interactive by default)
  set-ssl              Configure Nginx to use provided cert and key
  update               Update the app from GitHub only if newer
  remove               Remove PM2 app, Nginx config, and app files
  status               Show PM2 and Nginx status
  firewall             Configure UFW (OpenSSH + HTTP[/HTTPS])

Options:
  --domain <name>      Domain name (e.g., watch.example.com)
  --repo <url>         Git repo URL (default: https://github.com/asamaree/bahambin.git)
  --app-dir <path>     Install directory (default: /opt/bahambin)
  --port <port>        App internal port (default: from ecosystem or 3000)
  --cert <path>        Fullchain certificate path for HTTPS
  --key <path>         Private key path for HTTPS
  --yes                Non-interactive mode (accept defaults for missing values)
  --no-ufw             Do not enable UFW automatically

Examples:
  sudo $0 install --domain watch.example.com --repo https://github.com/asamaree/bahambin.git
  sudo $0 set-ssl --domain watch.example.com --cert /etc/ssl/certs/my.crt --key /etc/ssl/private/my.key
  sudo $0 update
  sudo $0 remove

Notes:
  - Create a DNS A record for the domain pointing to this server.
EOF
}

main() {
  if [[ $# -lt 1 ]]; then usage; exit 1; fi
  local cmd="$1"; shift || true

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain) DOMAIN="$2"; shift 2 ;;
      --repo) REPO_URL="$2"; shift 2 ;;
      --app-dir) APP_DIR="$2"; shift 2 ;;
      --port) PORT="$2"; shift 2 ;;
      --cert) CERT_PATH="$2"; shift 2 ;;
      --key) KEY_PATH="$2"; shift 2 ;;
      --yes|--non-interactive) NON_INTERACTIVE=1; shift 1 ;;
      --no-ufw) UFW_AUTO=0; shift 1 ;;
      -h|--help) usage; exit 0 ;;
      *) err "Unknown option: $1"; usage; exit 1 ;;
    esac
  done

  case "${cmd}" in
    install) install_app ;;
    set-ssl) set_ssl ;;
    update) update_app ;;
    remove) remove_app ;;
    status) status_app ;;
    firewall) configure_ufw ;;
    *) err "Unknown command: ${cmd}"; usage; exit 1 ;;
  esac
}

main "$@"
