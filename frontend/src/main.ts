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

// Header with auth controls
const header = document.createElement('header');
header.innerHTML = `<h1>Novachat</h1>`;
const authArea = document.createElement('div');
authArea.id = 'auth-area';
authArea.className = 'auth-area';
header.appendChild(authArea);

const controls = document.createElement('div');
controls.className = 'controls';
controls.innerHTML = `<label class="stream-toggle"><input id="stream" type="checkbox" /> Stream responses</label> <button id="clear-session" class="clear-btn" type="button">Clear history</button>`;

app.appendChild(header);
app.appendChild(messagesEl);
app.appendChild(form);
app.appendChild(controls);

const streamToggle = document.getElementById('stream') as HTMLInputElement;
const clearBtn = document.getElementById('clear-session') as HTMLButtonElement;

const history: Array<{role: string, content: string}> = [];
let currentUser: { id: string; username: string; memory?: string[] } | null = null;

function renderAuthArea() {
  authArea.innerHTML = '';
  if (currentUser) {
    const btn = document.createElement('button');
    btn.textContent = currentUser.username;
    btn.className = 'user-btn';
    const dropdown = document.createElement('div');
    dropdown.className = 'user-dropdown';
    dropdown.innerHTML = `
      <button id="view-data">User data</button>
      <button id="logout">Log out</button>
      <button id="delete-account">Delete account</button>
    `;
    btn.addEventListener('click', () => {
      dropdown.classList.toggle('open');
    });
    authArea.appendChild(btn);
    authArea.appendChild(dropdown);

    dropdown.querySelector('#view-data')!.addEventListener('click', () => {
      alert(JSON.stringify({ username: currentUser!.username, memory: currentUser!.memory || [] }, null, 2));
    });
    dropdown.querySelector('#logout')!.addEventListener('click', async () => {
      await fetch('/auth/signout', { method: 'POST' });
      currentUser = null;
      renderAuthArea();
      await loadSession();
    });
    dropdown.querySelector('#delete-account')!.addEventListener('click', async () => {
      if (!confirm('Delete your account? This is irreversible.')) return;
      const resp = await fetch('/auth/delete', { method: 'DELETE' });
      if (resp.ok) {
        currentUser = null;
        renderAuthArea();
        await loadSession();
        alert('Account deleted');
      } else {
        alert('Failed to delete account');
      }
    });
  } else {
    const signInBtn = document.createElement('button');
    signInBtn.textContent = 'Sign In';
    const signUpBtn = document.createElement('button');
    signUpBtn.textContent = 'Sign Up';
    authArea.appendChild(signInBtn);
    authArea.appendChild(signUpBtn);

    signInBtn.addEventListener('click', () => showAuthForm('signin'));
    signUpBtn.addEventListener('click', () => showAuthForm('signup'));
  }
}

function showAuthForm(mode: 'signin' | 'signup') {
  // simple inline form
  const formDiv = document.createElement('div');
  formDiv.className = 'auth-form';
  formDiv.innerHTML = `
    <input id="auth-username" placeholder="username" />
    <input id="auth-password" placeholder="password" type="password" />
    <button id="auth-submit">${mode === 'signin' ? 'Sign In' : 'Sign Up'}</button>
    <button id="auth-cancel">Cancel</button>
  `;
  authArea.appendChild(formDiv);
  formDiv.querySelector('#auth-cancel')!.addEventListener('click', () => { formDiv.remove(); });
  formDiv.querySelector('#auth-submit')!.addEventListener('click', async () => {
    const u = (formDiv.querySelector('#auth-username') as HTMLInputElement).value.trim();
    const p = (formDiv.querySelector('#auth-password') as HTMLInputElement).value;
    if (!u || !p) return alert('username and password required');
    const url = mode === 'signin' ? '/auth/signin' : '/auth/signup';
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      alert('Error: ' + (data.error || resp.statusText));
      return;
    }
    const data = await resp.json();
    currentUser = data.user;
    formDiv.remove();
    renderAuthArea();
    await loadSession();
  });
}

async function loadUser() {
  try {
    const resp = await fetch('/auth/me', { credentials: 'include' });
    const data = await resp.json();
    currentUser = data.user;
    renderAuthArea();
  } catch (e) {
    console.warn('failed to load user', e);
  }
}

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
loadUser();
