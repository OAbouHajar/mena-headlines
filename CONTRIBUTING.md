# Contributing to Middle East Live

Thanks for your interest in contributing! This guide will help you get started.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/<your-username>/mena-headlines.git
   cd mena-headlines
   ```
3. **Install** dependencies:
   ```bash
   npm install
   ```
4. **Copy** the environment template and fill in your keys:
   ```bash
   cp .env.example .env
   ```
5. **Start** the dev server:
   ```bash
   npm run dev
   ```

## Development Workflow

1. Create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes and test locally.
3. Commit with a clear message:
   ```bash
   git commit -m "feat: add cool new widget"
   ```
4. Push and open a Pull Request against `main`.

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org):

| Prefix     | Purpose                        |
|------------|--------------------------------|
| `feat:`    | New feature                    |
| `fix:`     | Bug fix                        |
| `docs:`    | Documentation only             |
| `style:`   | Formatting, no code change     |
| `refactor:`| Code restructuring             |
| `test:`    | Adding or fixing tests         |
| `chore:`   | Tooling, deps, CI changes      |

## Project Structure

```
├── index.html            # Main HTML entry point
├── src/                  # Client-side modules (Vite + vanilla JS)
│   ├── main.js           # App bootstrap
│   ├── channels.js       # Default YouTube channels
│   ├── firebase.js       # Firebase Realtime Database client
│   ├── intelligence.js   # AI intelligence panel
│   ├── presence.js       # Live user count
│   ├── stats.js          # Market stats panel
│   ├── sync.js           # Channel sync across users
│   ├── ticker.js         # Price ticker
│   ├── store.js          # Client-side state
│   ├── i18n.js           # Internationalization (EN/AR)
│   └── styles.css        # All styles
├── api/                  # Azure Functions (serverless API)
│   ├── intelligence/     # AI geopolitical reports
│   ├── flights/          # Middle East flight data
│   ├── tweets/           # RSS news feed
│   ├── stats/            # Market + conflict stats
│   ├── presence/         # Live user counting
│   └── resolve-channel/  # YouTube channel resolver
├── vite.config.js        # Vite config + dev API plugins
└── staticwebapp.config.json  # Azure Static Web Apps routing
```

## Code Guidelines

- **No hardcoded secrets** — use environment variables (see `.env.example`).
- Keep the frontend vanilla JS — no frameworks.
- API functions run on Azure Functions (Node.js 18+).
- Test against the local dev server before submitting a PR.

## Reporting Issues

- Check existing issues before creating a new one.
- Include browser version, OS, and steps to reproduce.
- For security issues, see [SECURITY.md](SECURITY.md) instead.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
