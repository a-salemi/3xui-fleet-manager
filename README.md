# ⚡ 3X-UI Inbound Manager

A sleek, dark-themed web dashboard to schedule and automate enabling/disabling 3X-UI inbounds via REST API with Bearer Token authentication — no direct database access needed.

## 🚀 Quick Install (Ubuntu 22.04+)

```bash
bash <(curl -Ls https://raw.githubusercontent.com/a-salemi/3xui-inbound-manager/main/install.sh)
```

Or clone and install manually:

```bash
git clone https://github.com/a-salemi/3xui-inbound-manager.git /opt/xui-manager
cd /opt/xui-manager && chmod +x install.sh && ./install.sh
```

> **Smart Mirror:** The installer automatically falls back to fast Iranian PyPI mirrors (Runflare / Liara) if the global server is slow or unreachable.

## 🔑 Default Credentials

| Field | Value |
|-------|-------|
| URL | `http://YOUR_SERVER_IP:8181` |
| Username | `admin` |
| Password | `asdf1234!!@@` |

All credentials and the web port can be changed from the **Settings** tab inside the panel.

## ✨ Features

- 🖥 **Multi-Panel Support** — Connect multiple 3X-UI instances with API tokens
- ⏰ **Smart Scheduling** — Set enable/disable times for inbounds (e.g. nightly service 02:00–07:00)
- ⚙️ **In-Panel Settings** — Change username, password, and web port from the UI
- ▶️ **Manual Toggle** — Instant ON/OFF buttons for each inbound
- 📋 **Activity Logs** — Track all scheduling events and actions
- 🎨 **Dark Minimal UI** — Modern, responsive dark theme

## 🛠 Service Commands

```bash
systemctl status xui-manager      # Check status
systemctl restart xui-manager     # Restart (e.g. after port change)
journalctl -u xui-manager -f      # Live logs
```
