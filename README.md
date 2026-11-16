<div align="center">

# ⚡ 3X-UI Fleet Manager (Enterprise Suite)

**The Ultimate Multi-Node Orchestration, Core Automation, Inbound Scheduling, Telemetry & Security Hub for 3X-UI Panels**

[![Python Version](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)](https://fastapi.tiangolo.com/)
[![Security: 2FA & Shield](https://img.shields.io/badge/Security-2FA%20%7C%20Brute--force%20Shield-10b981.svg)](#-security-shield--two-factor-authentication)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Multi-Language](https://img.shields.io/badge/i18n-EN%20%7C%20FA%20%7C%20RU%20%7C%20TR%20%7C%20ZH-8b5cf6.svg)](#-internationalization--languages)
[![Theme: Dark/Light](https://img.shields.io/badge/Theme-Obsidian%20Dark%20%7C%20Light-f59e0b.svg)](#-sleek-glassmorphism-ui--themes)

<p align="center">
  <a href="#-quick-install-ubuntu-2204">Quick Install</a> •
  <a href="#-key-features">Key Features</a> •
  <a href="#-task-types--automation-engine">Automation Tasks</a> •
  <a href="#-security-shield--two-factor-authentication">Security & 2FA</a> •
  <a href="#-telemetry--panel-health">Live Telemetry</a> •
  <a href="#-backup--disaster-recovery">Backup & Restore</a> •
  <a href="#-service-management">Service Management</a>
</p>

---

</div>

## 🚀 Quick Install (Ubuntu 22.04+)

Deploy the entire suite in seconds with our automated one-line interactive installer:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/a-salemi/3xui-fleet-manager/main/install.sh)
```

### 🪄 Interactive Installer Highlights:
- **Custom Credentials**: Sets your chosen Administrator Username & Password during setup.
- **Random Port Generator**: Automatically suggests a conflict-free 4-digit port (or type your own).
- **Smart Mirror Fallback**: Automatically falls back to fast domestic mirrors (Runflare / Liara) if global PyPI is throttled or unreachable.
- **Auto systemd Service**: Configures, enables, and launches `xui-manager.service` automatically on boot.

---

## ✨ Key Features

### ⚡ Multi-Task Automation Engine
- **Inbound State Scheduling**: Schedule inbounds `ON` / `OFF` with custom 24-hour windows.
- **Xray Core Lifecycle Automation**: Automate core maintenance (`Restart Core`, `Stop Core`, `Start Core`) on schedules.
- **Scheduled Host Shell Execution**: Execute automated maintenance bash commands directly on the host (safely sandboxed, admin-only, execution timeout, with return codes logged).
- **Day-of-Week Granularity**: Choose specific days of the week (e.g., Weekends only, specific weekdays, or every day).
- **Instant Window Sync**: Modifying a schedule immediately evaluates the current time window and synchronizes panel states without waiting for the next cron tick.
- **Visual Task Indicators**: Badges in the dashboard clearly display task types (`Inbound`, `Core Restart`, `Core Stop`, `Core Start`, `Shell Script`) before editing.

### 🛡️ Security Shield & Access Control
- **Two-Factor Authentication (2FA / TOTP)**: Optional RFC 6238 TOTP authentication compatible with **Google Authenticator**, **Microsoft Authenticator**, and **2FAS**.
- **100% Offline QR Code Setup**: QR codes are generated directly in the browser with zero external CDN calls or tracking, ensuring complete privacy.
- **Brute-Force & Rate Limiting Shield**: Automatic sliding-window rate limiter temporarily locks out IPs after consecutive failed login attempts.
- **Multi-User RBAC**: Distinct roles (`Admin`, `Operator`, `Viewer`) for secure team delegation.
- **Audit Logging**: Comprehensive activity logs track every schedule trigger, credential update, and panel interaction.

### 📊 Live Telemetry & Health Checks
- **Real-Time Inbound Stats**: Live client counts, uplink/downlink traffic, and total data usage formatted dynamically (`MB`, `GB`, `TB`).
- **Heartbeat Latency Check**: Test ping and response time to any connected 3X-UI panel in real time.
- **Port Reachability Checker**: Quickly verify whether inbound ports are open and accessible from the server.

### 🤖 Telegram Bot & Disaster Recovery
- **Instant Event Alerts**: Instant notifications when tasks run, inbounds change state, or panel connection errors occur.
- **SOCKS5 & Custom API Support**: Seamlessly route Telegram alerts through local/remote SOCKS5 proxies or custom reverse-proxy API servers.
- **One-Click Backup & Restore**: Download a complete JSON snapshot of all panels, schedules, users, and configurations, or restore with one click.
- **Automated Telegram Backups**: Dispatches database backup files directly to your private Telegram channel.

### 🎨 Obsidian Glassmorphism UI & Themes
- **Dark / Light Mode**: Instant toggle between Obsidian Dark glass and Clean Light mode with persistent preferences.
- **Responsive Mobile-First Design**: Optimized for phones, tablets, and desktop displays.
- **Multi-Language (i18n)**: Instant switching between **5 languages** with bidirectional RTL/LTR support.

---

## 📋 Task Types & Automation Engine

3X-UI Fleet Manager supports diverse automation tasks beyond simple inbound toggling:

| Task Type | Description | Target |
| :--- | :--- | :--- |
| **Inbound Schedule** | Automatically turns inbounds ON and OFF based on 24h start/stop times. | Target Inbound on Panel |
| **Restart Xray Core** | Clears memory leaks and refreshes connections by restarting the Xray core. | 3X-UI Panel Node |
| **Stop Xray Core** | Gracefully shuts down the Xray core at a scheduled time. | 3X-UI Panel Node |
| **Start Xray Core** | Starts the Xray core service on a panel node. | 3X-UI Panel Node |
| **Host Shell Script** | Runs maintenance bash scripts on the host (e.g. log rotation, cache cleaning). | Local Host Server |

### 📅 Day-of-Week Scheduling
Each task can be configured for all days or restricted to specific days of the week:
- `Sat`, `Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri` (Customizable selection)

---

## 🔒 Security Shield & Two-Factor Authentication

### Enabling 2FA (TOTP)
1. Navigate to **Settings** in the dashboard.
2. Under the **Two-Factor Authentication (2FA / TOTP)** card, click **🔐 Setup & Enable 2FA**.
3. Scan the generated QR code using **Google Authenticator** or **Microsoft Authenticator** (or copy the manual secret key).
4. Enter the 6-digit confirmation code from your app and click **Verify & Enable 2FA**.
5. Once active, all future logins will require your password + the one-time 6-digit code.

> [!NOTE]
> 2FA is **completely optional**. If disabled, standard username and password authentication applies.

---

## 👥 Multi-User Roles (RBAC)

| Permission / Action | Admin | Operator | Viewer |
| :--- | :---: | :---: | :---: |
| View Overview & Real-Time Stats | ✅ | ✅ | ✅ |
| View Schedules & Execution Logs | ✅ | ✅ | ✅ |
| Create & Edit Schedules | ✅ | ✅ | ❌ |
| Force Trigger Tasks Manually | ✅ | ✅ | ❌ |
| Manage 3X-UI Panels | ✅ | ❌ | ❌ |
| Run Host Shell Tasks | ✅ | ❌ | ❌ |
| Manage Users & Passwords | ✅ | ❌ | ❌ |
| System Web Port & 2FA Configuration | ✅ | ❌ | ❌ |
| Backup & Restore Operations | ✅ | ❌ | ❌ |

---

## 🌍 Internationalization & Languages

Built-in one-click language switcher with native Bidirectional (RTL / LTR) support:

| Language | Code | Text Direction | Translation Status |
| :--- | :---: | :---: | :---: |
| **English (US)** | `en` | LTR | Complete (Default) |
| **فارسی (Persian)** | `fa` | RTL | Complete |
| **Русский (Russian)** | `ru` | LTR | Complete |
| **Türkçe (Turkish)** | `tr` | LTR | Complete |
| **简体中文 (Chinese)** | `zh` | LTR | Complete |

---

## 🛠 Service Management & Updates

Manage the background daemon on your server using standard `systemctl` commands:

```bash
# Check service status
systemctl status xui-manager

# Restart the service
systemctl restart xui-manager

# View live execution logs
journalctl -u xui-manager -f

# Stop the service
systemctl stop xui-manager
```

### 🔄 Updating to the Latest Version:
To fetch the latest features and updates without losing your configurations:

```bash
cd /opt/xui-manager && git pull && systemctl restart xui-manager
```

---

## 📁 Backup & Disaster Recovery

All configuration data, panel tokens, schedules, and user credentials reside safely inside:
```
/opt/xui-manager/app/data/
├── panels.json       # Connected 3X-UI panels
├── schedules.json    # Automation tasks and schedules
├── settings.json     # Web port, 2FA secret, Telegram configuration
├── users.json        # RBAC user accounts
└── logs.json         # Execution audit logs
```

Use the **Backup & Restore** module in the Settings page to export or import your entire configuration with a single click.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).  
Developed with ❤️ for the community by [a-salemi](https://github.com/a-salemi).
