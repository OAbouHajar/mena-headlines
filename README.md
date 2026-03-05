# Middle East Live

A real-time intelligence dashboard that streams multiple Middle East news channels, live flight data, market tickers, conflict statistics, and AI-powered geopolitical analysis — all in one screen.

<img width="1909" height="1055" alt="image" src="https://github.com/user-attachments/assets/a2b6f7f1-84fa-4fa2-a6c7-b02befe3c299" />


## Features

- **Multi-Channel Live Viewer** — Watch multiple YouTube live news streams simultaneously (Al Jazeera, Al Arabiya, Sky News Arabia, and more)
- **AI Intelligence Reports** — Automated geopolitical analysis powered by Azure OpenAI, updated every 3 hours with 12-hour history
- **Live Flight Map** — Real-time Middle East airspace visualization using OpenSky Network + FlightRadar24 data
- **Market Ticker** — Oil (WTI/Brent), Gold, Natural Gas, and major stock prices with live changes
- **Conflict Statistics** — ACLED-sourced fatality and event data
- **RSS News Feed** — Aggregated headlines from major Arabic and English news sources
- **Live Presence** — See how many users are watching in real-time
- **Bilingual UI** — Full English and Arabic interface with RTL support
- **Channel Sync** — Synchronized channel switching across connected viewers via Firebase

## Tech Stack

| Layer       | Technology                                          |
|-------------|-----------------------------------------------------|
| Frontend    | Vanilla JS, CSS, Vite                               |
| Backend API | Azure Functions (Node.js 18+)                       |
| Hosting     | Azure Static Web Apps                               |
| Realtime DB | Firebase Realtime Database                          |
| AI          | Azure OpenAI (GPT)                                  |
| Maps        | Leaflet.js                                          |
| Flight Data | OpenSky Network API + FlightRadar24                 |
| Market Data | Yahoo Finance                                       |
| Conflict    | ACLED (Armed Conflict Location & Event Data)        |
| News        | RSS feeds (Al Jazeera, BBC, Sky News, Al Arabiya)   |

## Prerequisites

- [Node.js](https://nodejs.org) 18+ (LTS recommended)
- npm 9+
- A Firebase project (free tier works)
- _(Optional)_ Azure OpenAI resource for AI reports
- _(Optional)_ ACLED account for conflict data
- _(Optional)_ OpenSky Network account for authenticated flight data

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/OAbouHajar/mena-headlines.git
cd mena-headlines

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env and fill in your values (see Environment Variables below)

# 4. Start the dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Environment Variables

Copy `.env.example` to `.env` and configure the following:

### Required

| Variable                     | Description                          |
|------------------------------|--------------------------------------|
| `VITE_FIREBASE_API_KEY`      | Firebase Web API key                 |
| `VITE_FIREBASE_AUTH_DOMAIN`  | Firebase auth domain                 |
| `VITE_FIREBASE_PROJECT_ID`   | Firebase project ID                  |
| `VITE_FIREBASE_APP_ID`       | Firebase app ID                      |

### Optional (enable extra features)

| Variable                              | Description                                       |
|---------------------------------------|---------------------------------------------------|
| `AZURE_OPENAI_API_KEY`                | Azure OpenAI key (enables AI intelligence panel)  |
| `AZURE_OPENAI_ENDPOINT`               | Azure OpenAI endpoint URL                         |
| `AZURE_OPENAI_DEPLOYMENT`             | Azure OpenAI deployment name (default: `gpt-4o-mini`) |
| `AZURE_STORAGE_CONNECTION_STRING`     | Azure Blob Storage (caches AI reports)             |
| `ACLED_EMAIL`                          | ACLED account email (enables conflict stats)      |
| `ACLED_PASSWORD`                       | ACLED account password                            |
| `OPENSKY_USERNAME`                     | OpenSky account (improves flight data rate limits)|
| `OPENSKY_CLIENT_ID`                    | OpenSky OAuth client ID                           |
| `OPENSKY_CLIENT_SECRET`                | OpenSky OAuth client secret                       |
| `OPENSKY_PASSWORD`                     | OpenSky account password                          |
| `VITE_APPINSIGHTS_CONNECTION_STRING`   | Azure Application Insights (telemetry)            |

> **Note:** The app works without the optional variables — those features will simply be disabled or use public/anonymous endpoints.

## Development

### Dev Server

```bash
npm run dev
```

Vite runs with built-in dev middleware that mirrors the Azure Functions locally, so the full API surface (`/api/intelligence`, `/api/flights`, `/api/stats`, `/api/tweets`, `/api/presence`, `/api/resolve-channel`) works in development without deploying.

### Build for Production

```bash
npm run build
```

Output goes to `dist/`. The production deployment targets Azure Static Web Apps with the `api/` folder deployed as Azure Functions.

### Preview Production Build

```bash
npm run preview
```

## Deployment

This project is designed for **Azure Static Web Apps**:

1. Push to your GitHub repo.
2. Create an Azure Static Web App linked to the repo.
3. Set all environment variables from `.env.example` in the Azure portal under **Configuration > Application settings**.
4. The `staticwebapp.config.json` handles SPA routing automatically.

## Project Structure

```
├── index.html                 # Main HTML entry
├── src/                       # Client-side modules
│   ├── main.js                # App bootstrap & event wiring
│   ├── channels.js            # Default YouTube channel list
│   ├── firebase.js            # Firebase config & initialization
│   ├── intelligence.js        # AI report panel logic
│   ├── presence.js            # Live viewer count
│   ├── stats.js               # Market + conflict stats
│   ├── sync.js                # Firebase channel synchronization
│   ├── ticker.js              # Price ticker animation
│   ├── store.js               # Client-side state management
│   ├── i18n.js                # English/Arabic translations
│   └── styles.css             # All styles
├── api/                       # Azure Functions (serverless)
│   ├── intelligence/          # AI geopolitical reports
│   ├── flights/               # Middle East flight tracking
│   ├── tweets/                # RSS news aggregation
│   ├── stats/                 # Market & conflict data
│   ├── presence/              # Live user presence
│   └── resolve-channel/       # YouTube channel resolver
├── vite.config.js             # Vite config + dev API middleware
├── staticwebapp.config.json   # Azure SWA routing
├── .env.example               # Environment variable template
└── package.json
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, commit conventions, and guidelines.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE)
