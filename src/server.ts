import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Message, Sessions } from './types';

dotenv.config();

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const SESSIONS_FILE = path.resolve(process.cwd(), 'data', 'sessions.json');

let OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const hasOpenAI = !!OPENAI_KEY;

// Ensure sessions dir/file exists
async function ensureSessionsFile() {
  try {
    await fs.mkdir(path.dirname(SESSIONS_FILE), { recursive: true });
    await fs.access(SESSIONS_FILE);
  } catch {
    await fs.writeFile(SESSIONS_FILE, JSON.stringify({}), 'utf-8');
  }
}

async function readSessions(): Promise<Sessions> {
  try {
    const raw = await fs.readFile(SESSIONS_FILE, 'utf-8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    return {};
  }
}

async function writeSessions(data: Sessions) {
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

async function getSessionId(req: express.Request, res: express.Response) {
  let sid = req.cookies?.novachat_session;
  if (!sid) {
    sid = randomUUID();
    // httpOnly for security; sameSite lax to allow simple navigation
    res.cookie('novachat_session', sid, { httpOnly: true, sameSite: 'lax' });
  }
  return sid;
}

// Simple fallback responder
function fallbackRespond(message: string) {
  const msg = (message || '').trim().toLowerCase();
  if (!msg) return "Hi — I'm Novachat. Say something and I'll reply.";
  if (msg.includes('hello') || msg.includes('hi')) return "Hello! I'm Novachat — how can I help today?";
  if (msg.includes('help')) return "You can ask me to summarize text, draft messages, or just chat. If you set OPENAI_API_KEY I can do much more.";
  if (msg.endsWith('?')) return "That's a great question — here's a friendly thought: " + message;
  return `Novachat echo: ${message}`;
}

// POST /api/chat -> non-streaming reply (returns full reply JSON)
app.post('/api/chat', async (req: express.Request, res: express.Response) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const sid = await getSessionId(req, res);
  const sessions = await readSessions();
  if (!sessions[sid]) sessions[sid] = [];

  sessions[sid].push({ role: 'user', content: message });

  try {
    let reply = '';
    if (hasOpenAI) {
      // Use OpenAI API (non-streaming)
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_KEY}`
        },
        body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: sessions[sid].map(m => ({ role: m.role, content: m.content })), temperature: 0.7, max_tokens: 600 })
      });
      if (!resp.ok) {
        const txt = await resp.text();
        console.error('OpenAI non-streaming error', resp.status, txt);
        throw new Error('OpenAI non-streaming request failed');
      }
      const data = await resp.json();
      reply = data.choices?.[0]?.message?.content?.trim() || '';
    } else {
      reply = fallbackRespond(message);
    }

    sessions[sid].push({ role: 'assistant', content: reply });
    await writeSessions(sessions);

    return res.json({ reply });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error', detail: String(err) });
  }
});

// POST /api/stream -> streams incremental tokens to client by proxying OpenAI stream
app.post('/api/stream', async (req: express.Request, res: express.Response) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const sid = await getSessionId(req, res);
  const sessions = await readSessions();
  if (!sessions[sid]) sessions[sid] = [];
  sessions[sid].push({ role: 'user', content: message });

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no');

  if (!hasOpenAI) {
    // Simulate streaming using fallback responder
    const reply = fallbackRespond(message);
    for (let i = 0; i < reply.length; i += 40) {
      res.write(reply.slice(i, i + 40));
      await new Promise(r => setTimeout(r, 30));
    }
    sessions[sid].push({ role: 'assistant', content: reply });
    await writeSessions(sessions);
    return res.end();
  }

  try {
    // Make streaming request to OpenAI
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: sessions[sid].map(m => ({ role: m.role, content: m.content })), temperature: 0.7, max_tokens: 600, stream: true })
    });

    if (!resp.ok || !resp.body) {
      const t = await resp.text().catch(() => '');
      console.error('OpenAI stream request failed', resp.status, t);
      res.status(500).end('OpenAI stream request failed');
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let buffer = '';
    let assistantAccum = '';

    while (!done) {
      const { value, done: d } = await reader.read();
      done = d;
      if (value) {
        buffer += decoder.decode(value, { stream: true });

        // OpenAI streaming uses lines prefixed with 'data: '
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line) continue;
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.replace(/^data:\s*/, '');
          if (jsonStr === '[DONE]') {
            // stream finished
            done = true;
            break;
          }
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) {
              assistantAccum += delta;
              res.write(delta);
            }
          } catch (e) {
            // ignore parse errors for now
            console.warn('stream parse err', e);
          }
        }
      }
    }

    // Save assistant reply to session
    sessions[sid].push({ role: 'assistant', content: assistantAccum });
    await writeSessions(sessions);

    return res.end();
  } catch (err) {
    console.error('streaming proxy error', err);
    try { res.end(); } catch (e) {}
  }
});

// GET /api/session -> returns current session history (server-side persisted)
app.get('/api/session', async (req: express.Request, res: express.Response) => {
  const sid = await getSessionId(req, res);
  const sessions = await readSessions();
  res.json({ sessionId: sid, history: sessions[sid] || [] });
});

// POST /api/session/clear -> clear server-side session history
app.post('/api/session/clear', async (req: express.Request, res: express.Response) => {
  const sid = await getSessionId(req, res);
  const sessions = await readSessions();
  sessions[sid] = [];
  await writeSessions(sessions);
  res.json({ ok: true });
});

(async () => {
  await ensureSessionsFile();
  app.listen(PORT, () => {
    console.log(`Novachat (TypeScript) server running on http://localhost:${PORT}`);
    if (hasOpenAI) console.log('OpenAI enabled.');
    else console.log('OpenAI not configured — using fallback responder.');
  });
})();
