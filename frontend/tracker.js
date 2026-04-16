(() => {
  const API = 'https://portfolio-wivy.onrender.com';
  const ANALYTICS_KEY = 'tb_analytics_2026';

  const isOwner = !!localStorage.getItem('_owner');

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

    document.querySelectorAll('[data-project]').forEach(el => {
      el.addEventListener('click', () => track('project_click', el.dataset.project));
    });

    const chatToggle = document.getElementById('chat-toggle');
    if (chatToggle) {
      chatToggle.addEventListener('click', () => track('chat_open'));
    }
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
      localStorage.setItem('_owner', '1'); // markera som ägare, sluta spåra
      openDashboard();
    }
  });

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

    fetch(`${API}/api/analytics?key=${ANALYTICS_KEY}`)
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
        const lastA = new Date(a[1][a[1].length - 1].created_at);
        const lastB = new Date(b[1][b[1].length - 1].created_at);
        return lastB - lastA;
      })
      .map(([vid, events]) => {
        const first = new Date(events[0].created_at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
        const steps = events.map(e => `<span class="an-step">${eventLabel(e, pageLabels)}</span>`).join('<span class="an-arrow">→</span>');
        return `
          <div class="an-journey">
            <div class="an-journey-meta">
              <span class="an-vid">${vid.slice(0, 8)}</span>
              <span class="an-journey-time">${first}</span>
            </div>
            <div class="an-journey-steps">${steps}</div>
          </div>`;
      }).join('') || '<p class="an-empty">Inga besök ännu</p>';

    document.getElementById('an-body').innerHTML = `
      <div class="an-stat-row">
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
  }
})();
