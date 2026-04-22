# CEO Right-Hand AI — Phase 0: Integrations

A webapp that proves the core integrations work for the CEO Right-Hand AI product. Users sign in with Google (connecting Gmail and Calendar read access) and connect their WhatsApp number via Twilio. No AI yet — this is the integration foundation.

---

## Prerequisites

- **Node.js 18+**
- A **Google Cloud project** with the Gmail API and Google Calendar API enabled
- A **Twilio account** with the WhatsApp Sandbox activated

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd crh
npm install
```

### 2. Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create (or select) a project
3. Enable these APIs:
   - **Gmail API** (APIs & Services → Library → search "Gmail")
   - **Google Calendar API**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
5. Copy the **Client ID** and **Client Secret**

### 3. Twilio WhatsApp Sandbox

1. Sign in to [twilio.com/console](https://twilio.com/console)
2. Go to **Messaging → Try it out → Send a WhatsApp message**
3. Note your sandbox number (e.g. `+14155238886`) and your **Account SID** + **Auth Token**
4. Under **Sandbox settings**, set the webhook for incoming messages to:
   ```
   https://<your-ngrok-url>/api/whatsapp/webhook
   ```
5. To expose localhost during development, run:
   ```bash
   ngrok http 3000
   ```

### 4. Configure environment

```bash
cp .env.local.example .env.local
```

Fill in `.env.local`:

```env
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>

NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<run: openssl rand -base64 32>

DATABASE_URL="file:./dev.db"

TWILIO_ACCOUNT_SID=<from Twilio Console>
TWILIO_AUTH_TOKEN=<from Twilio Console>
TWILIO_WHATSAPP_NUMBER=+14155238886

APP_URL=http://localhost:3000
```

### 5. Initialize the database

```bash
npx prisma db push
```

### 6. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Testing each integration

### Gmail & Calendar

1. Click **Sign in with Google** — you'll be prompted to grant Gmail and Calendar permissions
2. On the dashboard, click **View Recent Emails** — should see your last 20 inbox emails
3. Click **View Upcoming Events** — should see events for the next 7 days

### WhatsApp

1. On the dashboard, enter your WhatsApp number in E.164 format (`+33612345678`)
2. Click **Connect**
3. Click **Send Test Message** — you'll receive a WhatsApp from the Twilio sandbox
4. Reply from your phone — it appears in the message log (webhook auto-replies `Received: ...`)
5. Use the chat input to send custom messages

> **Note:** For inbound messages to work, your ngrok URL must be configured as the Twilio sandbox webhook.

---

## Architecture

```
Browser
  └── Next.js App Router (TypeScript)
        ├── /              — Landing / sign-in (server component)
        ├── /dashboard     — Integration dashboard (server + client components)
        └── /api
              ├── auth/[...nextauth]  — Google OAuth via NextAuth.js
              ├── gmail/emails        — Gmail API read
              ├── calendar/events     — Calendar API read
              ├── whatsapp/send       — Twilio outbound messages
              ├── whatsapp/webhook    — Twilio inbound webhook
              ├── whatsapp/messages   — Message log from DB
              └── user/whatsapp       — Save/fetch WhatsApp number

SQLite (dev.db via Prisma)
  ├── User              — Google tokens + WhatsApp number
  └── WhatsAppMessage   — Inbound & outbound message log
```

**Token refresh:** Google access tokens expire after 1 hour. `src/lib/google.ts` automatically refreshes them and updates the DB before each API call.

---

## What's next (Phase 1+)

- AI email classification and triage
- Draft generation with style learning
- Morning briefing automation
- Meeting scheduling logic
- Contact graph
