#!/bin/bash
# ───────────────────────────────────────────────────────────
#  3X-UI Inbound Manager — Installer for Ubuntu 22+
# ───────────────────────────────────────────────────────────
set -e

APP_DIR="/opt/xui-manager"
SERVICE_NAME="xui-manager"
REPO_URL="https://github.com/a-salemi/3xui-inbound-manager.git"

echo ""
echo "=============================================="
echo "    3X-UI Inbound Manager — Installer"
echo "=============================================="
echo ""

# ─── 0. Fix DNS if needed ─────────────────────────────────
echo "[0/5] Checking DNS configuration..."
if ! grep -q "8.8.8.8" /etc/resolv.conf 2>/dev/null; then
    echo "nameserver 8.8.8.8" >> /etc/resolv.conf 2>/dev/null || true
    echo "nameserver 1.1.1.1" >> /etc/resolv.conf 2>/dev/null || true
fi

# ─── 1. Install System Dependencies ───────────────────────
echo "[1/5] Installing system dependencies (git, python3)..."
apt-get update -qq
apt-get install -y -qq git python3 python3-pip python3-venv curl > /dev/null 2>&1
echo "  ✓ System dependencies ready"

# ─── 2. Setup Application Directory ───────────────────────
echo "[2/5] Setting up application directory..."
systemctl stop ${SERVICE_NAME} 2>/dev/null || true

# If we are not already inside /opt/xui-manager, clone or update it
CURRENT_DIR=$(pwd)
if [ "$CURRENT_DIR" != "$APP_DIR" ]; then
    rm -rf "$APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
else
    git fetch --all 2>/dev/null || true
    git reset --hard origin/main 2>/dev/null || true
fi
echo "  ✓ Project files ready at $APP_DIR"

# ─── 3. Virtual Environment & Dependencies ────────────────
echo "[3/5] Setting up Python virtual environment..."
rm -rf venv
python3 -m venv venv
source venv/bin/activate

echo "  Installing dependencies..."
# Try global PyPI first, fallback to Runflare, then Liara
if ! pip install --default-timeout=60 --no-cache-dir -r requirements.txt; then
    echo "  ⚠ Global PyPI mirror timed out, switching to Iranian mirror (Runflare)..."
    if ! pip install --default-timeout=120 --trusted-host mirror-pypi.runflare.com -i https://mirror-pypi.runflare.com/simple/ -r requirements.txt; then
        echo "  ⚠ Runflare timed out, switching to Liara mirror..."
        pip install --default-timeout=120 -i https://package-mirror.liara.ir/repository/pypi/ -r requirements.txt
    fi
fi
echo "  ✓ Dependencies installed successfully"

# ─── 4. Create systemd Service ────────────────────────────
echo "[4/5] Configuring systemd service..."
cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=3X-UI Inbound Manager
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

# ─── 5. Firewall ──────────────────────────────────────────
echo "[5/5] Checking firewall..."
PORT=$(python3 -c "import json; print(json.load(open('app/data/settings.json'))['port'])" 2>/dev/null || echo "8181")
if command -v ufw &> /dev/null; then
    ufw allow ${PORT}/tcp > /dev/null 2>&1 || true
    echo "  ✓ Port ${PORT} allowed in UFW"
fi

# ─── Done ─────────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "=============================================="
echo "   ✅ Installation Complete!"
echo "=============================================="
echo "  URL:  http://${SERVER_IP}:${PORT}"
echo "  User: admin"
echo "  Pass: asdf1234!!@@"
echo ""
echo "  Status: systemctl status ${SERVICE_NAME}"
echo "  Logs:   journalctl -u ${SERVICE_NAME} -f"
echo "=============================================="
echo ""
