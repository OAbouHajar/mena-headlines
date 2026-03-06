/**
 * Azure Static Web Apps API function.
 * GET  /api/chat?since={timestamp}  — returns messages newer than timestamp
 * POST /api/chat { username, message, replyTo? }  — send a new message
 * POST /api/chat { messageId, reaction }           — toggle emoji reaction
 *
 * Messages stored in Azure Blob Storage as chat-messages.json.
 * Keeps last 200 messages, prunes older ones on write.
 */

const { BlobServiceClient } = require('@azure/storage-blob');

const BLOB_CONTAINER = 'chat-data';
const BLOB_NAME      = 'chat-messages.json';
const MAX_MESSAGES   = 200;
const MAX_MSG_LEN    = 500;

function getContainerClient() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) return null;
  return BlobServiceClient.fromConnectionString(connStr).getContainerClient(BLOB_CONTAINER);
}

async function readMessages(container) {
  try {
    const client = container.getBlockBlobClient(BLOB_NAME);
    const download = await client.download();
    const chunks = [];
    for await (const chunk of download.readableStreamBody) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch (e) {
    if (e.statusCode === 404) return [];
    throw e;
  }
}

async function writeMessages(container, messages) {
  const client = container.getBlockBlobClient(BLOB_NAME);
  const json = JSON.stringify(messages);
  await client.upload(json, Buffer.byteLength(json), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    overwrite: true,
  });
}

module.exports = async function (context, req) {
  const container = getContainerClient();
  if (!container) {
    context.res = { status: 503, body: { error: 'Storage not configured' } };
    return;
  }

  // Ensure container exists
  await container.createIfNotExists();

  if (req.method === 'GET') {
    // Return messages since a given timestamp
    const since = parseInt(req.query?.since) || 0;
    try {
      const messages = await readMessages(container);
      const filtered = since > 0 ? messages.filter(m => m.timestamp > since) : messages;
      context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: { messages: filtered },
      };
    } catch (err) {
      context.res = { status: 500, body: { error: 'Failed to read messages', detail: err.message } };
    }
    return;
  }

  if (req.method === 'POST') {
    const body = req.body || {};

    // --- Toggle reaction on existing message ---
    if (body.messageId && body.reaction) {
      const { messageId, reaction, username } = body;
      if (!username || !reaction) {
        context.res = { status: 400, body: { error: 'Missing username or reaction' } };
        return;
      }
      try {
        const messages = await readMessages(container);
        const msg = messages.find(m => m.id === messageId);
        if (!msg) {
          context.res = { status: 404, body: { error: 'Message not found' } };
          return;
        }
        if (!msg.reactions) msg.reactions = {};
        if (!msg.reactions[reaction]) msg.reactions[reaction] = [];

        const idx = msg.reactions[reaction].indexOf(username);
        if (idx >= 0) {
          msg.reactions[reaction].splice(idx, 1);
          if (msg.reactions[reaction].length === 0) delete msg.reactions[reaction];
        } else {
          msg.reactions[reaction].push(username);
        }

        await writeMessages(container, messages);
        context.res = {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: { message: msg },
        };
      } catch (err) {
        context.res = { status: 500, body: { error: 'Failed to update reaction', detail: err.message } };
      }
      return;
    }

    // --- Send new message ---
    const { username, message, replyTo } = body;
    if (!username || !message) {
      context.res = { status: 400, body: { error: 'Missing username or message' } };
      return;
    }
    if (message.length > MAX_MSG_LEN) {
      context.res = { status: 400, body: { error: `Message too long (max ${MAX_MSG_LEN} chars)` } };
      return;
    }

    try {
      const messages = await readMessages(container);
      const newMsg = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        username: username.slice(0, 30),
        message: message.slice(0, MAX_MSG_LEN),
        timestamp: Date.now(),
        reactions: {},
      };
      if (replyTo) {
        const parent = messages.find(m => m.id === replyTo);
        if (parent) {
          newMsg.replyTo = {
            id: parent.id,
            username: parent.username,
            message: parent.message.slice(0, 80),
          };
        }
      }

      messages.push(newMsg);

      // Prune to last MAX_MESSAGES
      const pruned = messages.slice(-MAX_MESSAGES);
      await writeMessages(container, pruned);

      context.res = {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: { message: newMsg },
      };
    } catch (err) {
      context.res = { status: 500, body: { error: 'Failed to send message', detail: err.message } };
    }
    return;
  }

  context.res = { status: 405, body: { error: 'Method not allowed' } };
};
