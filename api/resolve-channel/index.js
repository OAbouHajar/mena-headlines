/**
 * Azure Static Web Apps API function.
 * Fetches a YouTube channel page and extracts metadata.
 * 
 * GET /api/resolve-channel?handle=@almayadeentv
 */
export default async function (context, req) {
  const handle = req.query?.handle || '';
  if (!handle) {
    context.res = { status: 400, body: JSON.stringify({ error: 'Missing handle parameter' }) };
    return;
  }

  const ytUrl = handle.startsWith('http')
    ? handle
    : `https://www.youtube.com/${handle.startsWith('@') ? handle : '@' + handle}`;

  try {
    const res = await fetch(ytUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const html = await res.text();

    const idMatch = html.match(/"externalId":"(UC[^"]+)"/) ||
                    html.match(/"channelId":"(UC[^"]+)"/) ||
                    html.match(/<meta itemprop="channelId" content="(UC[^"]+)"/);
    const channelId = idMatch ? idMatch[1] : '';

    const nameMatch = html.match(/<meta property="og:title" content="([^"]+)"/) ||
                      html.match(/"author":"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : '';

    const handleMatch = html.match(/"vanityChannelUrl":"[^"]*\/@([^"]+)"/) ||
                        html.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/);
    const resolvedHandle = handleMatch ? '@' + handleMatch[1] : '';

    const logoMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
    let logo = logoMatch ? logoMatch[1] : '';
    if (logo) logo = logo.replace(/=s\d+/, '=s88');

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, handle: resolvedHandle, channelId, logo }),
    };
  } catch (err) {
    context.res = {
      status: 500,
      body: JSON.stringify({ error: 'Failed to fetch channel page', detail: err.message }),
    };
  }
}
