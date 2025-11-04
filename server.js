const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

let openai = null;
if (process.env.OPENAI_API_KEY) {
  try {
    const { Configuration, OpenAIApi } = require('openai');
    const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
    openai = new OpenAIApi(configuration);
    console.log('OpenAI integration enabled.');
  } catch (err) {
    console.warn('OpenAI package not available or failed to initialize. Falling back to simple responder.');
    openai = null;
  }
} else {
  console.log('No OPENAI_API_KEY found — running with fallback local responder.');
}

// Simple fallback responder when OpenAI isn't configured
function fallbackRespond(message) {
  const msg = message.trim().toLowerCase();
  if (!msg) return "Hi — I'm Novachat. Say something and I'll reply.";
  if (msg.includes('hello') || msg.includes('hi')) return "Hello! I'm Novachat — how can I help today?";
  if (msg.includes('help')) return "You can ask me to summarize text, draft messages, or just chat. If you set OPENAI_API_KEY I can do much more.";
  if (msg.endsWith('?')) return "That's a great question — here's a friendly thought: " + message;
  return `Novachat echo: ${message}`;
}

app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body || {};
  if (!message && (!history || history.length === 0)) {
    return res.status(400).json({ error: 'message or history required' });
  }

  // If OpenAI is configured, use it; otherwise fallback
  if (openai) {
    try {
      const messages = [];
      if (Array.isArray(history)) {
        // Expect history items like {role: 'user'|'assistant', content: '...'}
        history.forEach(h => {
          if (h && h.role && h.content) messages.push({ role: h.role, content: h.content });
        });
      }
      messages.push({ role: 'user', content: message });

      const completion = await openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages,
        temperature: 0.7,
        max_tokens: 600
      });

      const reply = completion.data.choices?.[0]?.message?.content?.trim() || "(no reply)";
      return res.json({ reply });
    } catch (err) {
      console.error('OpenAI request failed:', err?.message || err);
      return res.status(500).json({ error: 'OpenAI request failed', detail: err?.message || String(err) });
    }
  }

  // fallback
  const reply = fallbackRespond(message || (history && history.length ? history[history.length - 1].content : ''));
  return res.json({ reply });
});

// Streaming endpoint: POST /api/stream
// Streams the full reply back to the client in chunked responses (simple chunking).
app.post('/api/stream', async (req, res) => {
  const { message, history } = req.body || {};
  if (!message && (!history || history.length === 0)) {
    return res.status(400).json({ error: 'message or history required' });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no'); // disable buffering on some proxies

  try {
    let replyText = '';

    if (openai) {
      // Build messages for OpenAI
      const messages = [];
      if (Array.isArray(history)) {
        history.forEach(h => {
          if (h && h.role && h.content) messages.push({ role: h.role, content: h.content });
        });
      }
      messages.push({ role: 'user', content: message });

      const completion = await openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages,
        temperature: 0.7,
        max_tokens: 600
      });

      replyText = completion.data.choices?.[0]?.message?.content?.trim() || '';
    } else {
      replyText = fallbackRespond(message || (history && history.length ? history[history.length - 1].content : ''));
    }

    // Stream the reply in small chunks so the UI can render progressively.
    const chunkSize = 40; // characters per chunk
    for (let i = 0; i < replyText.length; i += chunkSize) {
      const chunk = replyText.slice(i, i + chunkSize);
      res.write(chunk);
      // small pause to simulate streaming
      await new Promise(r => setTimeout(r, 40));
    }

    res.end();
  } catch (err) {
    console.error('Streaming error:', err?.message || err);
    // If we have started sending data, ensure the connection is closed gracefully.
    try { res.end(); } catch (e) {}
  }
});

app.listen(PORT, () => {
  console.log(`Novachat server running on http://localhost:${PORT}`);
});
