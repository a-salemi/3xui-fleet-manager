#!/bin/bash
# ───────────────────────────────────────────────────────────
#  3X-UI Inbound Manager — Installer for Ubuntu 22+
# ───────────────────────────────────────────────────────────
set -e

APP_DIR="/opt/xui-manager"
SERVICE_NAME="xui-manager"
PORT=8181
REPO_URL="https://github.com/a-salemi/3xui-inbound-manager.git"

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║   3X-UI Inbound Manager — Installer        ║"
╚════════════════════════════════════════════╝"
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

if [ -f "run.py" ] && [ -f "requirements.txt" ]; then
    mkdir -p "$APP_DIR"
    cp -r . "$APP_DIR/"
else
    rm -rf "$APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
echo "  ✓ Files ready at $APP_DIR"

# ─── 3. Virtual Environment & Dependencies ────────────────
echo "[3/5] Installing Python packages..."
rm -rf venv
python3 -m venv venv
source venv/bin/activate

# Upgrade pip (ignore failure if offline)
pip install --no-cache-dir --upgrade pip 2>/dev/null || true

# Install requirements with retry
pip install --no-cache-dir -r requirements.txt
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
if command -v ufw &> /dev/null; then
    ufw allow ${PORT}/tcp > /dev/null 2>&1 || true
    echo "  ✓ Port ${PORT} allowed in UFW"
fi

# ─── Done ─────────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║   ✅ Installation Complete!                 ║"
echo "╠════════════════════════════════════════════╣"
echo "║                                            ║"
echo "║  URL:  http://${SERVER_IP}:${PORT}          "
echo "║  User: admin                               ║"
echo "║  Pass: asdf1234!!@@                         ║"
echo "║                                            ║"
echo "║  Check status: systemctl status ${SERVICE_NAME} "
echo "║  View logs:    journalctl -u ${SERVICE_NAME} -f "
echo "║                                            ║"
echo "╚════════════════════════════════════════════╝"
echo ""
