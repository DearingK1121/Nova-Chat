import './styles.css';

const app = document.getElementById('app') as HTMLDivElement;

function createInput() {
  const form = document.createElement('form');
  form.id = 'chat-form';
  form.className = 'chat-form';

  const input = document.createElement('input');
  input.id = 'input';
  input.autocomplete = 'off';
  input.placeholder = 'Type a message...';

  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.textContent = 'Send';

  form.appendChild(input);
  form.appendChild(btn);
  return { form, input };
}

function createMessages() {
  const ul = document.createElement('ul');
  ul.id = 'messages';
  ul.className = 'messages';
  return ul;
}

function addMessage(role: 'user' | 'system', text: string) {
  const messages = document.getElementById('messages') as HTMLUListElement;
  const li = document.createElement('li');
  li.className = `message ${role}`;
  li.textContent = text;
  messages.appendChild(li);
  messages.scrollTop = messages.scrollHeight;
}

const messagesEl = createMessages();
const { form, input } = createInput();

const controls = document.createElement('div');
controls.className = 'controls';
controls.innerHTML = `<label class="stream-toggle"><input id="stream" type="checkbox" /> Stream responses</label> <button id="clear-session" class="clear-btn" type="button">Clear history</button>`;

app.appendChild(document.createElement('header'));
app.appendChild(messagesEl);
app.appendChild(form);
app.appendChild(controls);

const streamToggle = document.getElementById('stream') as HTMLInputElement;
const clearBtn = document.getElementById('clear-session') as HTMLButtonElement;

const history: Array<{role: string, content: string}> = [];

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = (input as HTMLInputElement).value.trim();
  if (!text) return;
  addMessage('user', text);
  history.push({ role: 'user', content: text });
  (input as HTMLInputElement).value = '';
  addMessage('system', '...');
  const systemMsg = document.querySelector('.system:last-child') as HTMLLIElement;

  const useStream = !!(streamToggle && streamToggle.checked);
  if (useStream) {
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

      const reader = resp.body!.getReader();
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
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }

      history.push({ role: 'assistant', content: accumulated });
    } catch (err) {
      systemMsg.textContent = 'Network error.';
      console.error(err);
    }
  } else {
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

clearBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/session/clear', { method: 'POST', credentials: 'include' });
    messagesEl.innerHTML = '';
    history.length = 0;
  } catch (e) {
    console.warn('failed to clear session', e);
  }
});

async function loadSession() {
  try {
    const resp = await fetch('/api/session', { credentials: 'include' });
    const data = await resp.json();
    if (data && Array.isArray(data.history)) {
      messagesEl.innerHTML = '';
      data.history.forEach((h: any) => addMessage(h.role === 'user' ? 'user' : 'system', h.content));
      history.length = 0;
      data.history.forEach((h: any) => history.push(h));
    }
  } catch (e) {
    console.warn('failed to load session', e);
  }
}

loadSession();
