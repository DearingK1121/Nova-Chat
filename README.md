# Novachat

A minimal AI chatbot scaffold. Novachat runs a small Express server that exposes `/api/chat`. If you provide an `OPENAI_API_KEY` in the environment, Novachat will use the OpenAI Chat API (gpt-3.5-turbo). If not, it will fall back to a simple local responder.

## What you get

- `server.js`: Express server and `/api/chat` endpoint.
- `public/`: frontend UI (index.html, main.js, styles.css) — a simple chat interface.
- `package.json`: scripts and dependencies.
- `.env.example`: sample env file.

## Setup

1. Install dependencies

```bash
cd "$(dirname "$0")" # ensure you're in the repo root if running from here
npm install
```

2. Optional: enable OpenAI

- Copy `.env.example` to `.env` and set `OPENAI_API_KEY`.

3. Run

```bash
# development (auto-restart with nodemon)
npm run dev

# or production
npm start
```

4. Open the app

Visit http://localhost:3000 (or the port you set) and try sending messages.

## Notes & next steps

- This scaffold keeps things intentionally small. You can extend it by adding conversation history support on the frontend, user sessions, websocket streaming, or advanced prompt engineering.
- If you add the OpenAI key, watch your usage and costs.

If you'd like, I can:
- Add conversation history in the UI
- Add streaming responses using Server-Sent Events (SSE)
- Add authentication or multi-user support

Frontend (Vite + TypeScript)

- Development (separate dev server with HMR):

```bash
# start the Vite dev server for the frontend
npm run client:dev

# start the TypeScript server in another terminal
npm run dev
```

- Production / build

```bash
# build frontend into `public/` and then run the server
npm run client:build
npm run build
npm start
```

Tell me which next step you'd like and I'll implement it.
