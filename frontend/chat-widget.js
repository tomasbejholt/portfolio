(() => {
  const API_BASE = 'https://portfolio-wivy.onrender.com';

  // ── Inject HTML ──────────────────────────────────────────────────────────────
  document.body.insertAdjacentHTML('beforeend', `
    <div id="cw-bubble" aria-label="Chat with Tomas's assistant" title="Ask me anything about Tomas">
      <svg id="cw-icon-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      <svg id="cw-icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="display:none">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </div>

    <div id="cw-panel" aria-hidden="true">
      <div id="cw-panel-header">
        <div id="cw-avatar">TB</div>
        <div>
          <div id="cw-panel-title">Ask Tomas</div>
          <div id="cw-panel-sub">AI assistant · usually instant</div>
        </div>
      </div>
      <div id="cw-messages">
        <div class="cw-msg cw-msg--bot">Hi! I'm Tomas's portfolio assistant. Ask me anything about him — his background, projects, or what he's looking for.</div>
      </div>
      <div id="cw-input-row">
        <input id="cw-input" type="text" placeholder="Ask something…" maxlength="300" autocomplete="off" />
        <button id="cw-send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    </div>
  `);

  // ── State ────────────────────────────────────────────────────────────────────
  const bubble   = document.getElementById('cw-bubble');
  const panel    = document.getElementById('cw-panel');
  const messages = document.getElementById('cw-messages');
  const input    = document.getElementById('cw-input');
  const sendBtn  = document.getElementById('cw-send');
  const iconOpen  = document.getElementById('cw-icon-open');
  const iconClose = document.getElementById('cw-icon-close');
  let isOpen = false;
  let isLoading = false;

  // ── Toggle ───────────────────────────────────────────────────────────────────
  function toggle() {
    isOpen = !isOpen;
    panel.classList.toggle('cw-open', isOpen);
    panel.setAttribute('aria-hidden', String(!isOpen));
    iconOpen.style.display  = isOpen ? 'none' : '';
    iconClose.style.display = isOpen ? ''     : 'none';
    if (isOpen) setTimeout(() => input.focus(), 300);
  }

  bubble.addEventListener('click', toggle);

  // ── Send message ─────────────────────────────────────────────────────────────
  function addMsg(text, role) {
    const div = document.createElement('div');
    div.className = `cw-msg cw-msg--${role}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  async function send() {
    const text = input.value.trim();
    if (!text || isLoading) return;

    isLoading = true;
    input.value = '';
    sendBtn.disabled = true;
    addMsg(text, 'user');

    const thinking = addMsg('…', 'bot');

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      thinking.textContent = data.reply || 'Something went wrong.';
    } catch (_) {
      thinking.textContent = 'Could not reach the server. Try again in a moment.';
    } finally {
      isLoading = false;
      sendBtn.disabled = false;
      input.focus();
      messages.scrollTop = messages.scrollHeight;
    }
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
})();
