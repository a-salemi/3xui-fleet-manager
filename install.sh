#!/bin/bash
# ───────────────────────────────────────────────────────────
#  3X-UI Inbound Manager — Installer for Ubuntu 22+
# ───────────────────────────────────────────────────────────
set -e

APP_DIR="/opt/xui-manager"
SERVICE_NAME="xui-manager"
PORT=8181

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║   3X-UI Inbound Manager — Installer        ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# ─── 1. Install Python & pip ───────────────────────────────
echo "[1/5] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-venv > /dev/null 2>&1
echo "  ✓ Python3 ready"

# ─── 2. Create app directory ──────────────────────────────
echo "[2/5] Setting up application directory..."
mkdir -p "$APP_DIR"
cp -r . "$APP_DIR/"
cd "$APP_DIR"
echo "  ✓ Files copied to $APP_DIR"

# ─── 3. Virtual environment ──────────────────────────────
echo "[3/5] Creating virtual environment..."
python3 -m venv venv
source venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
echo "  ✓ Dependencies installed"

# ─── 4. Create systemd service ────────────────────────────
echo "[4/5] Creating systemd service..."
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
echo "  ✓ Service created and started"

# ─── 5. Firewall (optional) ──────────────────────────────
echo "[5/5] Opening port ${PORT}..."
if command -v ufw &> /dev/null; then
    ufw allow ${PORT}/tcp > /dev/null 2>&1 || true
    echo "  ✓ UFW rule added"
else
    echo "  ⚠ UFW not found, make sure port ${PORT} is open"
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
echo "║  Service: systemctl status ${SERVICE_NAME}  "
echo "║  Logs:    journalctl -u ${SERVICE_NAME} -f  "
echo "║                                            ║"
echo "╚════════════════════════════════════════════╝"
echo ""
