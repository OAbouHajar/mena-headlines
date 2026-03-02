import { defineConfig } from 'vite';

/**
 * Dev-only middleware that mirrors the Azure Function /api/resolve-channel.
 * Fetches the YouTube channel page server-side (no CORS issue) and returns JSON.
 */
function resolveChannelPlugin() {
  return {
    name: 'resolve-channel',
    configureServer(server) {
      server.middlewares.use('/api/resolve-channel', async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const handle = url.searchParams.get('handle') || '';
        if (!handle) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing handle parameter' }));
          return;
        }

        const ytUrl = handle.startsWith('UC')
          ? `https://www.youtube.com/channel/${handle}`
          : `https://www.youtube.com/${handle.startsWith('@') ? handle : '@' + handle}`;

        try {
          const resp = await fetch(ytUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept-Language': 'en-US,en;q=0.9',
            },
          });
          const html = await resp.text();

          const idMatch =
            html.match(/"externalId":"(UC[^"]+)"/) ||
            html.match(/"channelId":"(UC[^"]+)"/) ||
            html.match(/<meta itemprop="channelId" content="(UC[^"]+)"/);
          const channelId = idMatch ? idMatch[1] : '';

          const nameMatch =
            html.match(/<meta property="og:title" content="([^"]+)"/) ||
            html.match(/"author":"([^"]+)"/);
          const name = nameMatch ? nameMatch[1] : '';

          const handleMatch =
            html.match(/"vanityChannelUrl":"[^"]*\/@([^"]+)"/) ||
            html.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/);
          const resolvedHandle = handleMatch ? '@' + handleMatch[1] : '';

          const logoMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
          let logo = logoMatch ? logoMatch[1] : '';
          if (logo) logo = logo.replace(/=s\d+/, '=s88');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ name, handle: resolvedHandle, channelId, logo }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to fetch channel page', detail: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [resolveChannelPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: true,
  },
});
