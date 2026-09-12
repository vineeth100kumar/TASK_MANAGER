# 100% Free Public Hosting Guide for Raspberry Pi 5 via Cloudflare Tunnel

This guide walks you through exposing your **Sage Life & Task OS** on your Raspberry Pi 5 to the public internet securely at **$0 cost**, with **automatic SSL/HTTPS**, **DDoS protection**, and **zero port forwarding**.

---

## Why Cloudflare Tunnel?
- **Zero Port Forwarding**: Keeps your home router firewall completely locked down.
- **Bypasses CGNAT & Dynamic IP**: Works even if your home ISP uses CGNAT or changes your IP address daily.
- **Automatic Free SSL Certificate**: iOS Safari requires valid HTTPS to install PWAs, send Web Push notifications, and run WebSockets. Cloudflare provides this automatically.
- **Zero-Trust Access (Optional)**: Free for up to 50 users, allowing you to put a one-time PIN or Google Login wall in front of your system.

---

## Step-by-Step Setup Instructions

### Step 1: Create a Free Cloudflare Account
1. Go to [cloudflare.com](https://dash.cloudflare.com/sign-up) and create a free account (no credit card required).
2. If you already have a domain (or a free domain from Dynadot/DuckDNS/Freenom), add it to Cloudflare.
   *(Alternatively, you can test instantly using Cloudflare's TryCloudflare quick tunnel without owning any domain!)*

### Step 2: Create a Cloudflare Tunnel
1. In the Cloudflare Dashboard, click **Zero Trust** in the left sidebar (or navigate to [one.dash.cloudflare.com](https://one.dash.cloudflare.com/)).
2. Go to **Networks** → **Tunnels** → **Create a Tunnel**.
3. Select **Cloudflared** as the connector type and click **Next**.
4. Name your tunnel: `sage-pi5` and click **Save Tunnel**.

### Step 3: Run the Connector on your Raspberry Pi 5
1. On the configuration page, Cloudflare provides an installation command under **Debian / ARM64**.
2. It looks like:
   ```bash
   sudo cloudflared service install eyJhIjoi...YOUR_SECRET_TOKEN...
   ```
3. Run that command in your Raspberry Pi 5 terminal.
4. The service will start and Cloudflare's dashboard will show the status change to **Active** (Green).

### Step 4: Route Public Traffic to your Task Manager
1. In the Cloudflare Tunnel configuration, go to the **Public Hostnames** tab.
2. Click **Add a public hostname**.
3. Configure the route:
   - **Subdomain**: `sage` (or `tasks`)
   - **Domain**: Select your domain (e.g. `yourdomain.com`)
   - **Type**: `HTTP`
   - **URL**: `localhost:80` (or `frontend:80` if using Docker Compose)
4. Under **Additional application settings**:
   - Enable **HTTP2 Support**
   - Enable **WebSocket** (required for real-time live sync between PC & iPhone)
5. Click **Save Hostname**.

---

## Accessing from PC and iPhone

### On PC Desktop:
Open `https://sage.yourdomain.com` in your browser.
- Press `Ctrl + K` to trigger the AI Brain Dump.
- Enjoy the wide-screen Kanban board and Finance ledger.

### On iPhone / iPad (iOS):
1. Open `https://sage.yourdomain.com` in **Safari**.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.
5. Launch **Sage OS** from your iPhone Home Screen. It runs in full standalone mode without browser navigation bars, adapts to your Dynamic Island, and connects live to your Raspberry Pi 5!

---

## Alternative: Quick Instant Tunnel (No Domain Required)
If you do not own a domain yet and want an immediate free public URL to test:
```bash
cloudflared tunnel --url http://localhost:80
```
This prints an instant public URL like `https://random-words.trycloudflare.com` with free HTTPS valid for testing!
