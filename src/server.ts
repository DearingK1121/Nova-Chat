import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Message, Sessions, User, Users } from './types';
import bcrypt from 'bcryptjs';

// Load environment variables from common locations. Try (in order): root .env,
// src/.env. This makes the server more forgiving about where the user stores
// their .env file.
let _envLoadedFrom: string | null = null;
try {
  const r = dotenv.config();
  if (r.parsed) {
    _envLoadedFrom = path.resolve(process.cwd(), '.env');
  } else {
    const r2 = dotenv.config({ path: path.resolve(process.cwd(), 'src', '.env') });
    if (r2.parsed) _envLoadedFrom = path.resolve(process.cwd(), 'src', '.env');
  }
} catch (e) {
  // ignore and proceed; we'll log below whether a key was found
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const SESSIONS_FILE = path.resolve(process.cwd(), 'data', 'sessions.json');
const USERS_FILE = path.resolve(process.cwd(), 'data', 'users.json');

let OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const hasOpenAI = !!OPENAI_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

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

async function ensureUsersFile() {
  try {
    await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });
    await fs.access(USERS_FILE);
  } catch {
    await fs.writeFile(USERS_FILE, JSON.stringify({}), 'utf-8');
  }
}

async function readUsers(): Promise<Users> {
  try {
    const raw = await fs.readFile(USERS_FILE, 'utf-8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    return {};
  }
}

async function writeUsers(data: Users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
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

function getCurrentUserId(req: express.Request): string | null {
  const uid = req.cookies?.novachat_user;
  return uid || null;
}

async function getCurrentUser(req: express.Request): Promise<User | null> {
  const uid = getCurrentUserId(req);
  if (!uid) return null;
  const users = await readUsers();
  return users[uid] || null;
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

  // Memory handling: if user asks 'remember ...' store it (only for signed-in users)
  try {
    const lower = (message || '').trim();
    const rememberMatch = lower.match(/^remember\s+(.+)/i);
    const recallQuery = /(what do you remember|what do you recall|remember what)/i;
    const currentUser = await getCurrentUser(req);
    if (rememberMatch && currentUser) {
      const mem = rememberMatch[1].trim();
      const users = await readUsers();
      const u = users[currentUser.id];
      if (u) {
        u.memory = u.memory || [];
        u.memory.push(mem);
      }
      await writeUsers(users);
      const confirm = `Okay — I'll remember: "${mem}"`;
      sessions[sid].push({ role: 'assistant', content: confirm });
      await writeSessions(sessions);
      return res.json({ reply: confirm });
    }
    if (recallQuery.test(message)) {
      if (currentUser) {
        const mems = currentUser.memory || [];
        const reply = mems.length ? `I remember: ${mems.map((m, i) => `(${i + 1}) ${m}`).join('\n')}` : "I don't have any saved memories for you.";
        sessions[sid].push({ role: 'assistant', content: reply });
        await writeSessions(sessions);
        return res.json({ reply });
      }
    }
  } catch (e) {
    console.warn('memory handling error', e);
  }

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
        body: JSON.stringify({ model: OPENAI_MODEL, messages: sessions[sid].map(m => ({ role: m.role, content: m.content })), temperature: 0.7, max_tokens: 600 })
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

// Auth endpoints
app.post('/auth/signup', async (req: express.Request, res: express.Response) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const users = await readUsers();
  // simple uniqueness check
  const exists = Object.values(users).some(u => u.username.toLowerCase() === username.toLowerCase());
  if (exists) return res.status(409).json({ error: 'username_taken' });
  const id = randomUUID();
  const hash = await bcrypt.hash(password, 10);
  const user: User = { id, username, passwordHash: hash, createdAt: new Date().toISOString(), memory: [] };
  users[id] = user;
  await writeUsers(users);
  // set cookie
  res.cookie('novachat_user', id, { httpOnly: true, sameSite: 'lax' });
  return res.json({ ok: true, user: { id: user.id, username: user.username } });
});

app.post('/auth/signin', async (req: express.Request, res: express.Response) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const users = await readUsers();
  const found = Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!found) return res.status(401).json({ error: 'invalid_credentials' });
  const ok = await bcrypt.compare(password, found.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  res.cookie('novachat_user', found.id, { httpOnly: true, sameSite: 'lax' });
  return res.json({ ok: true, user: { id: found.id, username: found.username } });
});

app.post('/auth/signout', async (req: express.Request, res: express.Response) => {
  res.clearCookie('novachat_user');
  return res.json({ ok: true });
});

app.get('/auth/me', async (req: express.Request, res: express.Response) => {
  const user = await getCurrentUser(req);
  if (!user) return res.json({ user: null });
  return res.json({ user: { id: user.id, username: user.username, memory: user.memory || [] } });
});

app.delete('/auth/delete', async (req: express.Request, res: express.Response) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  const users = await readUsers();
  delete users[user.id];
  await writeUsers(users);
  // clear cookie
  res.clearCookie('novachat_user');
  // also remove any session owned by this user (optional) - we'll just clear server-side sessions that have no messages
  const sessions = await readSessions();
  for (const sid of Object.keys(sessions)) {
    // no strict ownership tracking; skipping deep cleanup for now
  }
  await writeSessions(sessions);
  return res.json({ ok: true });
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
    // Memory handling (same as non-stream path)
    try {
      const rememberMatch = (message || '').trim().match(/^remember\s+(.+)/i);
      const currentUser = await getCurrentUser(req);
      if (rememberMatch && currentUser) {
        const mem = rememberMatch[1].trim();
        const users = await readUsers();
        const u2 = users[currentUser.id];
        if (u2) {
          u2.memory = u2.memory || [];
          u2.memory.push(mem);
        }
        await writeUsers(users);
        const confirm = `Okay — I'll remember: "${mem}"`;
        for (let i = 0; i < confirm.length; i += 40) {
          res.write(confirm.slice(i, i + 40));
          await new Promise(r => setTimeout(r, 30));
        }
        sessions[sid].push({ role: 'assistant', content: confirm });
        await writeSessions(sessions);
        return res.end();
      }
      const recallQuery = /(what do you remember|what do you recall|remember what)/i;
      if (recallQuery.test(message) && currentUser) {
        const mems = currentUser.memory || [];
        const reply = mems.length ? `I remember: ${mems.map((m, i) => `(${i + 1}) ${m}`).join('\n')}` : "I don't have any saved memories for you.";
        for (let i = 0; i < reply.length; i += 40) {
          res.write(reply.slice(i, i + 40));
          await new Promise(r => setTimeout(r, 30));
        }
        sessions[sid].push({ role: 'assistant', content: reply });
        await writeSessions(sessions);
        return res.end();
      }
    } catch (e) {
      console.warn('memory handling error', e);
    }
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
      body: JSON.stringify({ model: OPENAI_MODEL, messages: sessions[sid].map(m => ({ role: m.role, content: m.content })), temperature: 0.7, max_tokens: 600, stream: true })
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

  // also, if the user asked to remember something in this conversation, we already handled above for non-openai; for OpenAI streaming we won't parse remembering explicitly here.

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
