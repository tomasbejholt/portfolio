(() => {
  const API_BASE = 'https://portfolio-wivy.onrender.com';

  // ── Load Inter font ──────────────────────────────────────────────────────────
  if (!document.getElementById('cw-inter-font')) {
    const link = document.createElement('link');
    link.id   = 'cw-inter-font';
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  }

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
  const bubble    = document.getElementById('cw-bubble');
  const panel     = document.getElementById('cw-panel');
  const messages  = document.getElementById('cw-messages');
  const input     = document.getElementById('cw-input');
  const sendBtn   = document.getElementById('cw-send');
  const iconOpen  = document.getElementById('cw-icon-open');
  const iconClose = document.getElementById('cw-icon-close');
  let isOpen    = false;
  let isLoading = false;

  const SS_OPEN = 'cw_open';
  const SS_MSGS = 'cw_messages';

  // ── Persist helpers ──────────────────────────────────────────────────────────
  function saveState() {
    sessionStorage.setItem(SS_OPEN, isOpen ? '1' : '0');
  }

  // Save in display order (oldest → newest) — DOM is reversed due to column-reverse
  function saveMsgs() {
    const nodes = messages.querySelectorAll('.cw-msg');
    const data  = Array.from(nodes).reverse().map(n => ({
      text: n.textContent,
      role: n.classList.contains('cw-msg--bot') ? 'bot' : 'user',
    }));
    sessionStorage.setItem(SS_MSGS, JSON.stringify(data));
  }

  // ── Toggle ───────────────────────────────────────────────────────────────────
  function toggle() {
    isOpen = !isOpen;
    panel.classList.toggle('cw-open', isOpen);
    panel.setAttribute('aria-hidden', String(!isOpen));
    iconOpen.style.display  = isOpen ? 'none' : '';
    iconClose.style.display = isOpen ? ''     : 'none';
    saveState();
    if (isOpen) setTimeout(() => input.focus({ preventScroll: true }), 300);
  }

  // ── Restore state from previous page ─────────────────────────────────────────
  // With flex-direction:column-reverse, scrollTop=0 is always the bottom.
  // No scroll calculation needed — just restore DOM and open state.
  requestAnimationFrame(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(SS_MSGS) || 'null');
      if (stored && stored.length) {
        messages.innerHTML = '';
        // stored is oldest→newest; prepend each so newest ends up at DOM start = visual bottom
        stored.forEach(({ text, role }) => {
          const div = document.createElement('div');
          div.className = `cw-msg cw-msg--${role}`;
          div.textContent = text;
          messages.prepend(div);
        });
      }
    } catch (_) {}

    if (sessionStorage.getItem(SS_OPEN) === '1') {
      isOpen = true;
      panel.style.transition = 'none';
      panel.classList.add('cw-open');
      panel.setAttribute('aria-hidden', 'false');
      iconOpen.style.display  = 'none';
      iconClose.style.display = '';
      // scrollTop=0 is already the bottom with column-reverse — nothing to calculate
      messages.scrollTop = 0;
      requestAnimationFrame(() => { panel.style.transition = ''; });
    }
  });

  bubble.addEventListener('click', toggle);

  // ── Send message ─────────────────────────────────────────────────────────────
  function addMsg(text, role) {
    const div = document.createElement('div');
    div.className = `cw-msg cw-msg--${role}`;
    div.textContent = text;
    messages.prepend(div);                                    // newest at DOM start = visual bottom
    messages.scrollTo({ top: 0, behavior: 'smooth' });       // 0 = bottom with column-reverse
    saveMsgs();
    return div;
  }

  async function send() {
    const text = input.value.trim();
    if (!text || isLoading) return;

    isLoading = true;
    input.value = '';
    sendBtn.disabled = true;
    addMsg(text, 'user');

    const thinking = document.createElement('div');
    thinking.className = 'cw-msg cw-msg--bot cw-typing';
    thinking.innerHTML = '<span></span><span></span><span></span>';
    messages.prepend(thinking);
    messages.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      thinking.className = 'cw-msg cw-msg--bot';
      thinking.textContent = data.reply || 'Something went wrong.';
      saveMsgs();
    } catch (_) {
      thinking.className = 'cw-msg cw-msg--bot';
      thinking.textContent = 'Could not reach the server. Try again in a moment.';
      saveMsgs();
    } finally {
      isLoading = false;
      sendBtn.disabled = false;
      input.focus({ preventScroll: true });
      messages.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
})();
