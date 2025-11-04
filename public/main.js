const form = document.getElementById('chat-form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const streamToggle = document.getElementById('stream');
const clearBtn = document.getElementById('clear-session');

// Local conversation history kept in-memory for the UI. Each item: { role: 'user'|'assistant', content }
const history = [];

function addMessage(role, text) {
  const li = document.createElement('li');
  li.className = `message ${role}`;
  li.textContent = text;
  messages.appendChild(li);
  messages.scrollTop = messages.scrollHeight;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addMessage('user', text);
  history.push({ role: 'user', content: text });
  input.value = '';
  // create placeholder assistant message
  addMessage('system', '...');
  const systemMsg = messages.querySelector('.system:last-child');

  const useStream = !!(streamToggle && streamToggle.checked);
  if (useStream) {
    // Streamed response: POST to /api/stream and read chunks as they arrive
    try {
      const resp = await fetch('/api/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
        credentials: 'include'
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        systemMsg.textContent = `Error: ${err.error || resp.statusText}`;
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumulated = '';
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) {
          const chunk = decoder.decode(value);
          accumulated += chunk;
          systemMsg.textContent = accumulated;
          messages.scrollTop = messages.scrollHeight;
        }
      }

      // push assistant message to history
      history.push({ role: 'assistant', content: accumulated });
    } catch (err) {
      systemMsg.textContent = 'Network error.';
      console.error(err);
    }
  } else {
    // Non-streaming: single request to /api/chat
    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
        credentials: 'include'
      });
      const data = await resp.json();
      if (data.error) {
        systemMsg.textContent = `Error: ${data.error}`;
      } else {
        systemMsg.textContent = data.reply;
        history.push({ role: 'assistant', content: data.reply });
      }
    } catch (err) {
      systemMsg.textContent = 'Network error.';
      console.error(err);
    }
  }
});

// Load session history from server on page load
async function loadSession() {
  try {
    const resp = await fetch('/api/session', { credentials: 'include' });
    const data = await resp.json();
    if (data && Array.isArray(data.history)) {
      messages.innerHTML = '';
      data.history.forEach(h => addMessage(h.role === 'user' ? 'user' : 'system', h.content));
      // sync local history
      history.length = 0;
      data.history.forEach(h => history.push(h));
    }
  } catch (e) {
    console.warn('failed to load session', e);
  }
}

if (clearBtn) {
  clearBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/session/clear', { method: 'POST', credentials: 'include' });
      messages.innerHTML = '';
      history.length = 0;
    } catch (e) {
      console.warn('failed to clear session', e);
    }
  });
}

loadSession();
