"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const crypto_1 = require("crypto");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
// Load environment variables from common locations. Try (in order): root .env,
// src/.env. This makes the server more forgiving about where the user stores
// their .env file.
let _envLoadedFrom = null;
try {
    const r = dotenv_1.default.config();
    if (r.parsed) {
        _envLoadedFrom = path_1.default.resolve(process.cwd(), '.env');
    }
    else {
        const r2 = dotenv_1.default.config({ path: path_1.default.resolve(process.cwd(), 'src', '.env') });
        if (r2.parsed)
            _envLoadedFrom = path_1.default.resolve(process.cwd(), 'src', '.env');
    }
}
catch (e) {
    // ignore and proceed; we'll log below whether a key was found
}
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: true, credentials: true }));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
app.use(express_1.default.static('public'));
const PORT = process.env.PORT || 3000;
const SESSIONS_FILE = path_1.default.resolve(process.cwd(), 'data', 'sessions.json');
const USERS_FILE = path_1.default.resolve(process.cwd(), 'data', 'users.json');
const PREFS_FILE = path_1.default.resolve(process.cwd(), 'data', 'session_prefs.json');
let OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const hasOpenAI = !!OPENAI_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
// Ensure sessions dir/file exists
async function ensureSessionsFile() {
    try {
        await promises_1.default.mkdir(path_1.default.dirname(SESSIONS_FILE), { recursive: true });
        await promises_1.default.access(SESSIONS_FILE);
    }
    catch {
        await promises_1.default.writeFile(SESSIONS_FILE, JSON.stringify({}), 'utf-8');
    }
}
async function readSessions() {
    try {
        const raw = await promises_1.default.readFile(SESSIONS_FILE, 'utf-8');
        return JSON.parse(raw || '{}');
    }
    catch (err) {
        return {};
    }
}
async function writeSessions(data) {
    await promises_1.default.writeFile(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
async function ensureUsersFile() {
    try {
        await promises_1.default.mkdir(path_1.default.dirname(USERS_FILE), { recursive: true });
        await promises_1.default.access(USERS_FILE);
    }
    catch {
        await promises_1.default.writeFile(USERS_FILE, JSON.stringify({}), 'utf-8');
    }
}
async function ensurePrefsFile() {
    try {
        await promises_1.default.mkdir(path_1.default.dirname(PREFS_FILE), { recursive: true });
        await promises_1.default.access(PREFS_FILE);
    }
    catch {
        await promises_1.default.writeFile(PREFS_FILE, JSON.stringify({}), 'utf-8');
    }
}
async function readPrefs() {
    try {
        const raw = await promises_1.default.readFile(PREFS_FILE, 'utf-8');
        return JSON.parse(raw || '{}');
    }
    catch (err) {
        return {};
    }
}
async function writePrefs(data) {
    await promises_1.default.writeFile(PREFS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
async function readUsers() {
    try {
        const raw = await promises_1.default.readFile(USERS_FILE, 'utf-8');
        return JSON.parse(raw || '{}');
    }
    catch (err) {
        return {};
    }
}
async function writeUsers(data) {
    await promises_1.default.writeFile(USERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
async function getSessionId(req, res) {
    let sid = req.cookies?.novachat_session;
    if (!sid) {
        sid = (0, crypto_1.randomUUID)();
        // httpOnly for security; sameSite lax to allow simple navigation
        res.cookie('novachat_session', sid, { httpOnly: true, sameSite: 'lax' });
    }
    return sid;
}
function getCurrentUserId(req) {
    const uid = req.cookies?.novachat_user;
    return uid || null;
}
async function getCurrentUser(req) {
    const uid = getCurrentUserId(req);
    if (!uid)
        return null;
    const users = await readUsers();
    return users[uid] || null;
}
// Simple fallback responder
function fallbackRespond(message) {
    const msg = (message || '').trim().toLowerCase();
    if (!msg)
        return "Hi — I'm Novachat. Say something and I'll reply.";
    if (msg.includes('hello') || msg.includes('hi'))
        return "Hello! I'm Novachat — how can I help today?";
    if (msg.includes('help'))
        return "You can ask me to summarize text, draft messages, or just chat. If you set OPENAI_API_KEY I can do much more.";
    if (msg.endsWith('?'))
        return "That's a great question — here's a friendly thought: " + message;
    return `Novachat echo: ${message}`;
}
// POST /api/chat -> non-streaming reply (returns full reply JSON)
app.post('/api/chat', async (req, res) => {
    const { message } = req.body || {};
    if (!message)
        return res.status(400).json({ error: 'message required' });
    const sid = await getSessionId(req, res);
    const sessions = await readSessions();
    if (!sessions[sid])
        sessions[sid] = [];
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
    }
    catch (e) {
        console.warn('memory handling error', e);
    }
    try {
        // enforce simple per-session rate limit (e.g., 200 requests per 24h)
        const prefs = await readPrefs();
        const pref = prefs[sid] || { requests: [] };
        const now = Date.now();
        const windowMs = 24 * 60 * 60 * 1000;
        pref.requests = (pref.requests || []).filter((t) => now - t < windowMs);
        const limit = parseInt(process.env.SESSION_DAILY_LIMIT || '200', 10);
        if (pref.requests.length >= limit) {
            return res.status(429).json({ error: 'rate_limited', detail: 'session daily limit reached' });
        }
        pref.requests.push(now);
        prefs[sid] = pref;
        await writePrefs(prefs);
        // respect session preferred model if present
        const prefsAll = await readPrefs();
        const sessionPref = prefsAll[sid] || {};
        const modelToUse = sessionPref.model || OPENAI_MODEL; // Use session's model if available
        let reply = '';
        if (hasOpenAI) {
            // Use OpenAI API (non-streaming) via fetch
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_KEY}`
                },
                body: JSON.stringify({ model: modelToUse, messages: sessions[sid].map(m => ({ role: m.role, content: m.content })), temperature: 0.7, max_tokens: 600 })
            });
            if (!resp.ok) {
                const txt = await resp.text().catch(() => '');
                console.error('OpenAI non-streaming error', resp.status, txt);
                throw new Error('OpenAI non-streaming request failed');
            }
            const data = await resp.json();
            reply = data.choices?.[0]?.message?.content?.trim() || '';
        }
        else {
            reply = fallbackRespond(message);
        }
        sessions[sid].push({ role: 'assistant', content: reply });
        await writeSessions(sessions);
        return res.json({ reply });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'server error', detail: String(err) });
    }
});
// Auth endpoints
app.post('/auth/signup', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password)
        return res.status(400).json({ error: 'username and password required' });
    const users = await readUsers();
    // simple uniqueness check
    const exists = Object.values(users).some(u => u.username.toLowerCase() === username.toLowerCase());
    if (exists)
        return res.status(409).json({ error: 'username_taken' });
    const id = (0, crypto_1.randomUUID)();
    const hash = await bcryptjs_1.default.hash(password, 10);
    const user = { id, username, passwordHash: hash, createdAt: new Date().toISOString(), memory: [] };
    users[id] = user;
    await writeUsers(users);
    // set cookie
    res.cookie('novachat_user', id, { httpOnly: true, sameSite: 'lax' });
    return res.json({ ok: true, user: { id: user.id, username: user.username } });
});
app.post('/auth/signin', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password)
        return res.status(400).json({ error: 'username and password required' });
    const users = await readUsers();
    const found = Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!found)
        return res.status(401).json({ error: 'invalid_credentials' });
    const ok = await bcryptjs_1.default.compare(password, found.passwordHash);
    if (!ok)
        return res.status(401).json({ error: 'invalid_credentials' });
    res.cookie('novachat_user', found.id, { httpOnly: true, sameSite: 'lax' });
    return res.json({ ok: true, user: { id: found.id, username: found.username } });
});
app.post('/auth/signout', async (req, res) => {
    res.clearCookie('novachat_user');
    return res.json({ ok: true });
});
app.get('/auth/me', async (req, res) => {
    const user = await getCurrentUser(req);
    if (!user)
        return res.json({ user: null });
    return res.json({ user: { id: user.id, username: user.username, memory: user.memory || [] } });
});
app.delete('/auth/delete', async (req, res) => {
    const user = await getCurrentUser(req);
    if (!user)
        return res.status(401).json({ error: 'not_authenticated' });
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
// Admin status endpoint (safe: does not expose API key)
app.get('/admin/openai-status', async (req, res) => {
    return res.json({ enabled: hasOpenAI, model: OPENAI_MODEL, envPath: _envLoadedFrom || null });
});
// Session model preference endpoint
app.post('/session/model', async (req, res) => {
    const { model } = req.body || {};
    const sid = await getSessionId(req, res);
    const prefs = await readPrefs();
    prefs[sid] = prefs[sid] || {};
    prefs[sid].model = model;
    await writePrefs(prefs);
    return res.json({ ok: true, model });
});
// POST /api/stream -> streams incremental tokens to client by proxying OpenAI stream
app.post('/api/stream', async (req, res) => {
    const { message } = req.body || {};
    if (!message)
        return res.status(400).json({ error: 'message required' });
    const sid = await getSessionId(req, res);
    const sessions = await readSessions();
    if (!sessions[sid])
        sessions[sid] = [];
    sessions[sid].push({ role: 'user', content: message });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Accel-Buffering', 'no');
    // rate limit similar to non-streaming endpoint
    const prefs = await readPrefs();
    const pref = prefs[sid] || { requests: [] };
    const now = Date.now();
    const windowMs = 24 * 60 * 60 * 1000;
    pref.requests = (pref.requests || []).filter((t) => now - t < windowMs);
    const limit = parseInt(process.env.SESSION_DAILY_LIMIT || '200', 10);
    if (pref.requests.length >= limit) {
        res.statusCode = 429;
        res.write('rate_limited');
        return res.end();
    }
    pref.requests.push(now);
    prefs[sid] = pref;
    await writePrefs(prefs);
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
        }
        catch (e) {
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
        // respect session preferred model if present for streaming too
        const prefsAll = await readPrefs();
        const sessionPref = prefsAll[sid] || {};
        const modelToUseStream = sessionPref.model || OPENAI_MODEL;
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_KEY}`
            },
            body: JSON.stringify({ model: modelToUseStream, messages: sessions[sid].map(m => ({ role: m.role, content: m.content })), temperature: 0.7, max_tokens: 600, stream: true })
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
                    if (!line)
                        continue;
                    if (!line.startsWith('data:'))
                        continue;
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
                    }
                    catch (e) {
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
    }
    catch (err) {
        console.error('streaming proxy error', err);
        try {
            res.end();
        }
        catch (e) { }
    }
});
// GET /api/session -> returns current session history (server-side persisted)
app.get('/api/session', async (req, res) => {
    const sid = await getSessionId(req, res);
    const sessions = await readSessions();
    res.json({ sessionId: sid, history: sessions[sid] || [] });
});
// POST /api/session/clear -> clear server-side session history
app.post('/api/session/clear', async (req, res) => {
    const sid = await getSessionId(req, res);
    const sessions = await readSessions();
    sessions[sid] = [];
    await writeSessions(sessions);
    res.json({ ok: true });
});
(async () => {
    await ensureSessionsFile();
    await ensureUsersFile();
    await ensurePrefsFile();
    app.listen(PORT, () => {
        console.log(`Novachat (TypeScript) server running on http://localhost:${PORT}`);
        if (hasOpenAI)
            console.log('OpenAI enabled.');
        else
            console.log('OpenAI not configured — using fallback responder.');
    });
})();
