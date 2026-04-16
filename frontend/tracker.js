(() => {
  const API = 'https://portfolio-wivy.onrender.com';

  const isOwner = !!localStorage.getItem('_owner');

  function getToken() { return sessionStorage.getItem('_dash_token'); }

  // ── Spårning – körs bara för riktiga besökare ─────────────────────────────
  if (!isOwner) {
    function getVisitorId() {
      let id = localStorage.getItem('_vid');
      if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
        localStorage.setItem('_vid', id);
      }
      return id;
    }

    const visitorId = getVisitorId();
    const page = document.title.includes('Projects') ? 'projects'
               : document.title.includes('About')    ? 'about'
               : 'home';

    function track(event, data) {
      fetch(`${API}/api/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitor_id: visitorId, page, event, data: data || null }),
      }).catch(() => {});
    }

    track('pageview');

    document.addEventListener('click', e => {
      const t = e.target.closest('[data-project], #cw-bubble, #start-btn, #gtl-plan-btn');
      if (!t) return;
      if (t.dataset.project)          track('project_click', t.dataset.project);
      else if (t.id === 'cw-bubble')  track('chat_open');
      else if (t.id === 'start-btn')  track('snake_start');
      else if (t.id === 'gtl-plan-btn') track('dayplan_use');
    });
  }

  // ── 5-click dashboard trigger ─────────────────────────────────────────────
  const trigger = document.getElementById('analytics-trigger');
  if (!trigger) return;

  let clicks = 0;
  let timer = null;

  trigger.addEventListener('click', () => {
    clicks++;
    clearTimeout(timer);
    timer = setTimeout(() => { clicks = 0; }, 3000);
    if (clicks >= 5) {
      clicks = 0;
      clearTimeout(timer);
      if (getToken()) { openDashboard(); return; }
      showPinModal();
    }
  });

  // ── PIN-modal ─────────────────────────────────────────────────────────────
  function showPinModal() {
    const style = document.createElement('style');
    style.textContent = `
      #pin-overlay {
        position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(6px);
        display:flex;align-items:center;justify-content:center;z-index:9999;
        animation:pinFadeIn .2s ease;
      }
      @keyframes pinFadeIn { from{opacity:0;transform:scale(.96)} to{opacity:1;transform:scale(1)} }
      @keyframes pinShake {
        0%,100%{transform:translateX(0)}
        20%{transform:translateX(-8px)}
        40%{transform:translateX(8px)}
        60%{transform:translateX(-5px)}
        80%{transform:translateX(5px)}
      }
      #pin-card {
        background:rgba(15,15,30,.9);border:1px solid rgba(59,130,246,.4);
        border-radius:20px;padding:2rem 1.75rem;width:280px;
        box-shadow:0 0 40px rgba(59,130,246,.25),0 0 80px rgba(59,130,246,.1);
        display:flex;flex-direction:column;align-items:center;gap:1.5rem;
      }
      #pin-card.shake { animation:pinShake .35s ease; }
      #pin-label {
        color:#93c5fd;font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;
      }
      #pin-dots { display:flex;gap:.75rem; }
      .pin-dot {
        width:12px;height:12px;border-radius:50%;border:2px solid #1e3a5f;
        transition:all .15s ease;
      }
      .pin-dot.filled {
        background:#3b82f6;border-color:#3b82f6;
        box-shadow:0 0 8px rgba(59,130,246,.8);
      }
      .pin-dot.error { background:#f87171;border-color:#f87171;box-shadow:0 0 8px rgba(248,113,113,.8); }
      #pin-pad { display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem;width:100%; }
      .pin-btn {
        background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);
        border-radius:12px;color:#e0e0e0;font-size:1.25rem;font-weight:500;
        padding:.75rem;cursor:pointer;transition:all .1s ease;user-select:none;
      }
      .pin-btn:hover { background:rgba(59,130,246,.2);border-color:rgba(59,130,246,.4); }
      .pin-btn:active { transform:scale(.93);background:rgba(59,130,246,.35); }
      .pin-btn.del { font-size:1rem;color:#93c5fd; }
      .pin-btn.empty { visibility:hidden; }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'pin-overlay';
    overlay.innerHTML = `
      <div id="pin-card">
        <span id="pin-label">Access</span>
        <div id="pin-dots">
          ${Array(6).fill('<div class="pin-dot"></div>').join('')}
        </div>
        <div id="pin-pad">
          ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="pin-btn" data-n="${n}">${n}</button>`).join('')}
          <button class="pin-btn empty" aria-hidden="true"></button>
          <button class="pin-btn" data-n="0">0</button>
          <button class="pin-btn del" id="pin-del">⌫</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    let entered = '';
    const dots = overlay.querySelectorAll('.pin-dot');

    function onKey(e) {
      if (e.key >= '0' && e.key <= '9') {
        if (entered.length >= 6) return;
        entered += e.key;
        updateDots();
        if (entered.length === 6) tryLogin();
      } else if (e.key === 'Backspace') {
        entered = entered.slice(0, -1);
        updateDots();
      } else if (e.key === 'Escape') {
        overlay.remove();
        style.remove();
        document.removeEventListener('keydown', onKey);
      }
    }
    document.addEventListener('keydown', onKey);

    function updateDots(error) {
      dots.forEach((d, i) => {
        d.classList.remove('filled', 'error');
        if (i < entered.length) d.classList.add(error ? 'error' : 'filled');
      });
    }

    function tryLogin() {
      fetch(`${API}/api/analytics/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: entered }),
      }).then(r => r.json()).then(res => {
        if (res.token) {
          sessionStorage.setItem('_dash_token', res.token);
          localStorage.setItem('_owner', '1');
          document.removeEventListener('keydown', onKey);
          overlay.remove();
          style.remove();
          openDashboard();
        } else {
          updateDots(true);
          const card = document.getElementById('pin-card');
          card.classList.add('shake');
          card.addEventListener('animationend', () => {
            card.classList.remove('shake');
            entered = '';
            updateDots();
          }, { once: true });
        }
      }).catch(() => {});
    }

    overlay.addEventListener('click', e => {
      const btn = e.target.closest('.pin-btn');
      if (!btn || btn.classList.contains('empty')) return;
      if (btn.id === 'pin-del') {
        entered = entered.slice(0, -1);
        updateDots();
        return;
      }
      if (entered.length >= 6) return;
      entered += btn.dataset.n;
      updateDots();
      if (entered.length === 6) tryLogin();
    });

    overlay.addEventListener('click', e => { if (e.target === overlay) { document.removeEventListener('keydown', onKey); overlay.remove(); style.remove(); } });
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  function openDashboard() {
    const existing = document.getElementById('analytics-overlay');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'analytics-overlay';
    overlay.innerHTML = `
      <div class="an-panel">
        <button class="an-close" id="an-close">✕</button>
        <h2 class="an-title">Dashboard</h2>
        <div id="an-body" class="an-loading">Laddar...</div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('an-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    fetch(`${API}/api/analytics?key=${getToken()}`)
      .then(r => r.json())
      .then(renderDashboard)
      .catch(() => {
        document.getElementById('an-body').textContent = 'Kunde inte hämta data.';
      });
  }

  function eventLabel(e, pageLabels) {
    if (e.event === 'pageview')      return `📄 ${pageLabels[e.page] || e.page}`;
    if (e.event === 'project_click') return `🖱️ ${e.data}`;
    if (e.event === 'chat_open')     return '💬 Öppnade chatten';
    if (e.event === 'snake_start')   return '🐍 Spelade Snake';
    if (e.event === 'dayplan_use')   return '🗺️ Planerade dag';
    return e.event;
  }

  function renderDashboard(d) {
    const pageLabels = { home: 'Home', projects: 'Projects', about: 'About' };
    const allEvents  = d.recent || [];

    // ── Statistik ──
    const pageViewRows = Object.entries(d.page_views || {})
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `<tr><td>${pageLabels[p] || p}</td><td class="an-num">${n}</td></tr>`)
      .join('') || '<tr><td colspan="2">Inga data</td></tr>';

    const projectRows = Object.entries(d.project_clicks || {})
      .sort((a, b) => b[1] - a[1])
      .map(([proj, n]) => `<tr><td>${proj}</td><td class="an-num">${n}</td></tr>`)
      .join('') || '<tr><td colspan="2">Inga klick ännu</td></tr>';

    // ── Besökarresor – gruppera per visitor_id ──
    const byVisitor = {};
    [...allEvents].reverse().forEach(e => {
      if (!byVisitor[e.visitor_id]) byVisitor[e.visitor_id] = [];
      byVisitor[e.visitor_id].push(e);
    });

    const journeyRows = Object.entries(byVisitor)
      .sort((a, b) => {
        const firstA = new Date(a[1][0].created_at).getTime();
        const firstB = new Date(b[1][0].created_at).getTime();
        return firstB - firstA;
      })
      .map(([vid, events], i) => {
        const first = new Date(events[0].created_at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
        const visitCount = events.filter(e => e.event === 'pageview').length;
        const steps = events.map(e => `<span class="an-step">${eventLabel(e, pageLabels)}</span>`).join('<span class="an-arrow">→</span>');
        const rowId = `journey-${i}`;
        return `
          <div class="an-journey" onclick="
            const d = document.getElementById('${rowId}');
            const a = this.querySelector('.an-journey-arrow');
            d.style.display = d.style.display === 'none' ? 'flex' : 'none';
            a.textContent = d.style.display === 'none' ? '▶' : '▼';
          ">
            <div class="an-journey-meta">
              <span class="an-journey-arrow">▶</span>
              <span class="an-vid">${vid.slice(0, 8)}</span>
              <span class="an-journey-time">${first}</span>
              <span class="an-journey-count">${visitCount} besök · ${events.length} events</span>
              <button class="an-block-btn" data-vid="${vid}" title="Blockera besökare">🚫</button>
            </div>
            <div class="an-journey-steps" id="${rowId}" style="display:none">${steps}</div>
          </div>`;
      }).join('') || '<p class="an-empty">Inga besök ännu</p>';

    const body = document.getElementById('an-body');
    body.innerHTML = `
      <div class="an-stat-row">
        <div class="an-stat">
          <span class="an-stat-num">${d.total_visits ?? 0}</span>
          <span class="an-stat-label">Totalt besök</span>
        </div>
        <div class="an-stat">
          <span class="an-stat-num">${d.unique_visitors}</span>
          <span class="an-stat-label">Unika besökare</span>
        </div>
        <div class="an-stat">
          <span class="an-stat-num">${Object.values(d.page_views || {}).reduce((a, b) => a + b, 0)}</span>
          <span class="an-stat-label">Sidvisningar</span>
        </div>
        <div class="an-stat">
          <span class="an-stat-num">${Object.values(d.project_clicks || {}).reduce((a, b) => a + b, 0)}</span>
          <span class="an-stat-label">Projektklick</span>
        </div>
      </div>

      <h3 class="an-section-title">Sidvisningar</h3>
      <table class="an-table"><thead><tr><th>Sida</th><th>Visningar</th></tr></thead>
      <tbody>${pageViewRows}</tbody></table>

      <h3 class="an-section-title">Mest klickade projekt</h3>
      <table class="an-table"><thead><tr><th>Projekt</th><th>Klick</th></tr></thead>
      <tbody>${projectRows}</tbody></table>

      <h3 class="an-section-title">Besökarresor</h3>
      ${journeyRows}`;

    body.addEventListener('click', e => {
      const btn = e.target.closest('.an-block-btn');
      if (!btn) return;
      e.stopPropagation();
      const vid = btn.dataset.vid;
      fetch(`${API}/api/analytics/block?key=${getToken()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitor_id: vid }),
      }).then(r => r.json()).then(res => {
        if (res.ok) {
          fetch(`${API}/api/analytics?key=${getToken()}`)
            .then(r => r.json())
            .then(renderDashboard)
            .catch(() => {});
        }
      }).catch(() => {});
    });
  }
})();
