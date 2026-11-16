#!/bin/bash
# ───────────────────────────────────────────────────────────
#  3X-UI Fleet Manager — Interactive Installer (Ubuntu 22+)
# ───────────────────────────────────────────────────────────
set -e

# Ensure terminal input is connected when executed via curl process substitution
if [ ! -t 0 ]; then
    exec < /dev/tty 2>/dev/null || true
fi

APP_DIR="/opt/xui-manager"
SERVICE_NAME="xui-manager"
REPO_URL="https://github.com/a-salemi/3xui-fleet-manager.git"

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║       ⚡ 3X-UI Fleet Manager — Installation Setup      ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# ─── Function to generate a random 4-digit unused port ─────
get_random_free_port() {
    while true; do
        local p=$((RANDOM % 8900 + 1050))
        # Verify port is not currently bound
        if ! ss -tuln 2>/dev/null | grep -q ":$p\b" && ! netstat -tuln 2>/dev/null | grep -q ":$p\b"; then
            echo "$p"
            return
        fi
    done
}

RANDOM_PORT=$(get_random_free_port)

# ─── Interactive Setup Prompts ─────────────────────────────
echo ">> Configure Initial Administrator & Port:"
echo "--------------------------------------------------------"

# 1. Username
while true; do
    read -rp "Enter Admin Username: " CHOSEN_USER
    CHOSEN_USER=$(echo "$CHOSEN_USER" | xargs)
    if [ -n "$CHOSEN_USER" ]; then
        break
    fi
    echo "  [!] Username cannot be empty. Please enter a valid username."
done

# 2. Password
while true; do
    read -rp "Enter Admin Password: " CHOSEN_PASS
    CHOSEN_PASS=$(echo "$CHOSEN_PASS" | xargs)
    if [ -n "$CHOSEN_PASS" ]; then
        break
    fi
    echo "  [!] Password cannot be empty. Please enter a valid password."
done

# 3. Port (with random 4-digit fallback)
read -rp "Enter Web Dashboard Port [Press Enter for random: ${RANDOM_PORT}]: " INPUT_PORT
INPUT_PORT=$(echo "$INPUT_PORT" | xargs)
if [ -z "$INPUT_PORT" ]; then
    CHOSEN_PORT="$RANDOM_PORT"
else
    CHOSEN_PORT="$INPUT_PORT"
fi

echo ""
echo ">> Selected Configuration:"
echo "   - Username : $CHOSEN_USER"
echo "   - Port     : $CHOSEN_PORT"
echo "--------------------------------------------------------"
echo ""

# ─── 0. DNS Configuration ──────────────────────────────────
echo "[0/5] Checking DNS configuration..."
if ! grep -q "8.8.8.8" /etc/resolv.conf 2>/dev/null; then
    echo "nameserver 8.8.8.8" >> /etc/resolv.conf 2>/dev/null || true
    echo "nameserver 1.1.1.1" >> /etc/resolv.conf 2>/dev/null || true
fi

# ─── 1. Install System Dependencies ────────────────────────
echo "[1/5] Installing system dependencies (git, python3)..."
apt-get update -qq
apt-get install -y -qq git python3 python3-pip python3-venv curl > /dev/null 2>&1
echo "  ✓ Dependencies verified"

# ─── 2. Setup Application Directory ────────────────────────
echo "[2/5] Setting up application files..."
systemctl stop ${SERVICE_NAME} 2>/dev/null || true
fuser -k ${CHOSEN_PORT}/tcp 2>/dev/null || true

CURRENT_DIR=$(pwd)
if [ "$CURRENT_DIR" != "$APP_DIR" ]; then
    rm -rf "$APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
else
    git fetch --all 2>/dev/null || true
    git reset --hard origin/main 2>/dev/null || true
fi

mkdir -p "${APP_DIR}/app/data"

# Save initial credentials & port directly
python3 - <<EOF
import json
from datetime import datetime

# 1. settings.json
settings = {
    "port": int("${CHOSEN_PORT}"),
    "telegram": {
        "enabled": False,
        "bot_token": "",
        "chat_id": "",
        "socks_proxy": "",
        "api_server": ""
    },
    "two_factor": {
        "enabled": False,
        "secret": ""
    }
}
with open("${APP_DIR}/app/data/settings.json", "w", encoding="utf-8") as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)

# 2. users.json
users = [
    {
        "id": "root-admin",
        "username": "${CHOSEN_USER}",
        "password": "${CHOSEN_PASS}",
        "role": "admin",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
]
with open("${APP_DIR}/app/data/users.json", "w", encoding="utf-8") as f:
    json.dump(users, f, indent=2, ensure_ascii=False)
EOF

echo "  ✓ Credentials and custom port saved"

# ─── 3. Virtual Environment & Dependencies ─────────────────
echo "[3/5] Setting up Python virtual environment..."
rm -rf venv
python3 -m venv venv
source venv/bin/activate

echo "  Installing packages..."
# Fallback mirror strategy: Global PyPI -> Runflare -> Liara
if ! pip install --default-timeout=60 --no-cache-dir -r requirements.txt; then
    echo "  [!] Global PyPI mirror timed out, switching to Iranian mirror (Runflare)..."
    if ! pip install --default-timeout=120 --trusted-host mirror-pypi.runflare.com -i https://mirror-pypi.runflare.com/simple/ -r requirements.txt; then
        echo "  [!] Runflare timed out, switching to Liara mirror..."
        pip install --default-timeout=120 -i https://package-mirror.liara.ir/repository/pypi/ -r requirements.txt
    fi
fi
echo "  ✓ Python dependencies installed successfully"

# ─── 4. Configure systemd Service ──────────────────────────
echo "[4/5] Configuring systemd service..."
cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=3X-UI Fleet Manager
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/venv/bin/python run.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}
echo "  ✓ Service started and enabled at boot"

# ─── 5. Firewall Configuration ─────────────────────────────
echo "[5/5] Configuring firewall for port ${CHOSEN_PORT}..."
if command -v ufw &> /dev/null; then
    ufw allow ${CHOSEN_PORT}/tcp > /dev/null 2>&1 || true
    echo "  ✓ Port ${CHOSEN_PORT} allowed in UFW"
fi

# ─── Done ──────────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║          ✅ Installation Completed Successfully!       ║"
echo "╠════════════════════════════════════════════════════════╣"
echo "║                                                        ║"
echo "║  🌐 Dashboard URL : http://${SERVER_IP}:${CHOSEN_PORT} "
echo "║  👤 Username      : ${CHOSEN_USER}                      "
echo "║  🔑 Password      : ${CHOSEN_PASS}                      "
echo "║                                                        ║"
echo "║  Check status     : systemctl status ${SERVICE_NAME}   "
echo "║  View live logs   : journalctl -u ${SERVICE_NAME} -f   "
echo "║                                                        ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
