# ⚡ 3X-UI Inbound Manager

A minimal, modern web dashboard to schedule and automate enabling/disabling 3X-UI inbounds via REST API (Bearer Token).

## 🚀 One-Line Fast Install (Ubuntu 22.04+)

Replace `YOUR_USERNAME` with your GitHub username:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/YOUR_USERNAME/3xui-inbound-manager/main/install.sh)
```

*(Or simply clone and run `install.sh`)*

```bash
git clone https://github.com/YOUR_USERNAME/3xui-inbound-manager.git
cd 3xui-inbound-manager
chmod +x install.sh
sudo ./install.sh
```

---

## 🔑 Default Credentials
- **Port:** `8181` (accessible at `http://YOUR_SERVER_IP:8181`)
- **Username:** `admin`
- **Password:** `asdf1234!!@@`
*(You can change credentials in `app/main.py`)*

## 🛠 Features
- 🔌 Multi-panel support (connect multiple 3X-UI instances)
- ⏰ Automated inbound schedule (e.g. Nightly service 02:00 to 07:00)
- 🌐 Native API token auth (no direct DB access required)
- ⚡ Manual one-click instant toggle (ON / OFF)
- 🎨 Sleek Dark / Minimal UI
