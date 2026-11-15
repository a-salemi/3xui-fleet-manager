<div align="center">

# ⚡ 3X-UI Inbound Manager (Pro Suite)

**The Ultimate Automation, Inbound Scheduler & Telegram Bot Hub for 3X-UI Panels**

[![Python Version](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)](https://fastapi.tiangolo.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Multi-Language](https://img.shields.io/badge/i18n-EN%20%7C%20FA%20%7C%20RU%20%7C%20TR%20%7C%20ZH-8b5cf6.svg)](#-internationalization--languages)

<p align="center">
  <a href="#-quick-install-ubuntu-2204">Quick Install</a> •
  <a href="#-features">Features</a> •
  <a href="#-telegram-bot-integration">Telegram Bot</a> •
  <a href="#-multi-user-access-control">Multi-User</a> •
  <a href="#-service-management">Service Management</a>
</p>

---

</div>

## 🚀 Quick Install (Ubuntu 22.04+)

Run the interactive one-line installer:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/a-salemi/3xui-inbound-manager/main/install.sh)
```

### 🪄 Interactive Setup Features:
- **Custom Credentials**: Prompts for your chosen Administrator Username & Password during setup.
- **Random 4-Digit Port**: Automatically suggests a conflict-free random 4-digit port (press `Enter` to accept or type your custom port).
- **Smart Mirror Fallback**: Automatically falls back to fast domestic mirrors (Runflare / Liara) if global PyPI is throttled or unreachable.

---

## ✨ Features

- ⏰ **Smart Inbound Scheduling**: Automate turning inbounds `ON` and `OFF` on custom 24-hour schedules (e.g. Nightly packages 02:00 – 07:00).
- 🔄 **Real-time Window Sync**: Adding or modifying a schedule immediately evaluates the current time and synchronizes the inbound state (no waiting for the next cron cycle).
- 📱 **Mobile-First 24-Hour Picker**: Intuitive Hour & Minute selectors designed for touch screens, with one-click presets (`Nightly 02:00-07:00`, `Daytime`, etc.).
- 🤖 **Telegram Bot Integration**: Instant alerts when inbounds turn ON or OFF, with native support for **SOCKS5 Proxies** and **Custom/Local Telegram API servers**.
- 👥 **Multi-User Access Control (RBAC)**: Manage sub-admins and operators with granular roles (`Admin`, `Operator`, `Viewer`).
- 🌐 **Multi-Language (i18n)**: One-click instant switching between **English**, **Persian (فارسی - RTL)**, **Russian (Русский)**, **Turkish (Türkçe)**, and **Chinese (简体中文)**.
- 🔌 **Native 3X-UI REST API**: Zero database touching; communicates purely via 3X-UI Bearer API Tokens.
- 🎨 **Obsidian Dark Aesthetic**: Sleek glassmorphism UI with real-time stat metrics, live log auditing, and responsive navigation.

---

## 🌍 Internationalization & Languages

The web panel includes built-in one-click language switching with full RTL/LTR bidirectional support:

| Language | Code | Direction | Status |
| :--- | :---: | :---: | :---: |
| **English (US)** | `en` | LTR | Default |
| **فارسی (Persian)** | `fa` | RTL | Complete |
| **Русский (Russian)** | `ru` | LTR | Complete |
| **Türkçe (Turkish)** | `tr` | LTR | Complete |
| **简体中文 (Chinese)** | `zh` | LTR | Complete |

---

## 🤖 Telegram Bot Integration

Stay notified in real time whenever an automation job runs or if an inbound fails to connect.

- **Telegram Bot Token**: Get one from [@BotFather](https://t.me/BotFather).
- **Chat ID**: Numeric chat ID or channel ID.
- **SOCKS5 Proxy (Optional)**: Connect via `socks5://user:pass@ip:port` for filtered or censored servers.
- **Custom Telegram API Server (Optional)**: Support for local reverse proxies or self-hosted Bot API servers (e.g. `https://api.example.com`).
- **Test Channel**: Click `🔔 Send Test Notification` in the dashboard to verify connectivity in 1 second.

---

## 👥 Multi-User Roles

| Role | Permissions |
| :--- | :--- |
| **Admin** | Full control: Manage panels, schedules, users, system web port, and Telegram settings. |
| **Operator** | Operational control: Create, edit, toggle, and force-trigger schedules. View logs. |
| **Viewer** | Read-only observation: View live statuses and audit logs without modification rights. |

---

## 🛠 Service Management

Manage the background daemon on your Ubuntu server:

```bash
# Check service status
systemctl status xui-manager

# Restart the manager
systemctl restart xui-manager

# View live execution logs
journalctl -u xui-manager -f

# Force update to latest GitHub release
cd /opt/xui-manager && git fetch origin && git reset --hard origin/main && systemctl restart xui-manager
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
Developed with ❤️ for the 3X-UI community by [a-salemi](https://github.com/a-salemi).
