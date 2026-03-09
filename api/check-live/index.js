/**
 * Azure Static Web Apps API function.
 * Fetches a YouTube channel's /streams page and extracts live video IDs.
 *
 * GET /api/check-live?handle=@SyriaTelevision
 * GET /api/check-live?channelId=UC...
 *
 * Returns: { videoId: "abc123", videoIds: ["abc123", "def456"] }
 */
module.exports = async function (context, req) {
  const handle = req.query?.handle || '';
  const channelId = req.query?.channelId || '';

  if (!handle && !channelId) {
    context.res = { status: 400, body: JSON.stringify({ error: 'Missing handle or channelId parameter' }) };
    return;
  }

  // Build the /streams URL
  let streamsUrl;
  if (handle) {
    const h = handle.startsWith('@') ? handle : '@' + handle;
    streamsUrl = `https://www.youtube.com/${h}/streams`;
  } else {
    streamsUrl = `https://www.youtube.com/channel/${channelId}/streams`;
  }

  try {
    const res = await fetch(streamsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await res.text();

    const videoIds = extractLiveVideoIds(html);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
      body: JSON.stringify({
        videoId: videoIds[0] || '',
        videoIds,
      }),
    };
  } catch (err) {
    context.res = {
      status: 500,
      body: JSON.stringify({ error: 'Failed to fetch streams page', detail: err.message }),
    };
  }
};

/**
 * Extract live video IDs from YouTube channel page HTML.
 * Looks for videos marked with LIVE badges in the embedded JSON data.
 */
function extractLiveVideoIds(html) {
  const ids = [];

  try {
    // YouTube embeds initial data as ytInitialData JSON in a script tag
    const dataMatch = html.match(/var\s+ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!dataMatch) return ids;

    const data = JSON.parse(dataMatch[1]);

    // Walk the JSON to find video renderers with LIVE badges
    const items = findAllVideoRenderers(data);

    for (const item of items) {
      const videoId = item.videoId;
      if (!videoId) continue;

      // Check for live badge indicators
      const hasLiveBadge =
        JSON.stringify(item).includes('"LIVE"') ||
        JSON.stringify(item).includes('"style":"LIVE"') ||
        JSON.stringify(item).includes('"isLive":true');

      if (hasLiveBadge) {
        ids.push(videoId);
      }
    }
  } catch {
    // Fallback: regex-based extraction for live streams
    // Look for videoId near "LIVE" badge markers
    const pattern = /"videoId":"([a-zA-Z0-9_-]{11})"[^}]*?"style":"LIVE"/g;
    let m;
    while ((m = pattern.exec(html)) !== null) {
      if (!ids.includes(m[1])) ids.push(m[1]);
    }

    // Also try broader pattern
    if (ids.length === 0) {
      const broader = /"videoId":"([a-zA-Z0-9_-]{11})".*?"isLive":true/g;
      while ((m = broader.exec(html)) !== null) {
        if (!ids.includes(m[1])) ids.push(m[1]);
      }
    }
  }

  return ids;
}

/**
 * Recursively find all video renderer objects in the YouTube data structure.
 */
function findAllVideoRenderers(obj) {
  const results = [];

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.videoId && typeof node.videoId === 'string') {
      results.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else {
      for (const key of Object.keys(node)) {
        if (key === 'videoRenderer' || key === 'gridVideoRenderer' || key === 'richItemRenderer') {
          walk(node[key]);
        } else {
          walk(node[key]);
        }
      }
    }
  }

  walk(obj);
  return results;
}
