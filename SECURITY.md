# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, **please do NOT open a public issue**.

Instead, email **smsm.sy@hotmail.com** with:

- A description of the vulnerability
- Steps to reproduce
- Any relevant logs or screenshots

You will receive a response within 48 hours acknowledging the report, and a follow-up within 7 days with a fix plan.

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | ✅        |

## Security Best Practices for Contributors

- **Never** commit secrets, API keys, or credentials to the repository.
- All secrets must go in `.env` (which is git-ignored).
- Use `process.env.*` for server-side secrets (Azure Functions).
- Use `import.meta.env.VITE_*` for client-side config (Vite).
- Review the `.env.example` file for the list of required variables.
