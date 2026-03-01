# Gotland Explorer API

FastAPI-backend som exponerar live-data om Gotland.
Designad för att köras gratis på Render/Railway och konsumeras av en statisk portfolio på AWS S3.

## Endpoints

| Endpoint | Beskrivning |
|---|---|
| `GET /api/weather` | Väder för Visby, Slite och Hemse (SMHI, cachat 1h) |
| `GET /api/places?category=natur` | Sevärdheter (natur / kultur / mat) |
| `GET /api/ferry` | Approximativa färjetider Destination Gotland |
| `GET /api/dayplan?start=visby&hours=6&interest=natur` | Förslag på dagstur |

Interaktiv API-dokumentation finns på `/docs` (Swagger UI).

---

## Lokal setup

```bash
# 1. Skapa och aktivera virtuell miljö
python -m venv venv
source venv/bin/activate        # Mac/Linux
venv\Scripts\activate           # Windows

# 2. Installera beroenden
pip install -r requirements.txt

# 3. Starta servern
uvicorn main:app --reload
```

API:t körs nu på `http://localhost:8000`.

---

## Deploy på Render (gratis)

1. Pusha projektet till GitHub.
2. Gå till [render.com](https://render.com) → **New → Web Service**.
3. Koppla ditt GitHub-repo.
4. Inställningar:
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Plan:** Free
5. Klicka **Deploy**.

Din API-url ser ut ungefär så här:
`https://gotland-explorer-api.onrender.com`

> **OBS:** Render:s gratisplan spinner ned tjänsten efter ~15 min inaktivitet.
> Första anropet tar ca 30–60 sek att vakna. Lägg till en "wake-up"-fetch i portfolion om det är ett problem.

---

## Deploy på Railway (alternativ)

```bash
# Installera Railway CLI
npm install -g @railway/cli

railway login
railway init
railway up
```

Railway ger en permanent URL direkt utan cold-start-problem (men har begränsad gratiskvot).

---

## Exempel: fetch() från statisk portfolio

Ersätt `API_BASE` med din Render/Railway-URL när du deployer.

```javascript
const API_BASE = "https://gotland-explorer-api.onrender.com";
// Lokalt: const API_BASE = "http://localhost:8000";

// ── Väder ──────────────────────────────────────────────
async function loadWeather() {
  const res  = await fetch(`${API_BASE}/api/weather`);
  const data = await res.json();

  // data.visby.temp_c, data.visby.wind_ms, osv.
  document.getElementById("temp-visby").textContent =
    `${data.visby.temp_c} °C`;
}

// ── Platser (filtrera på kategori) ─────────────────────
async function loadPlaces(category = "natur") {
  const res    = await fetch(`${API_BASE}/api/places?category=${category}`);
  const places = await res.json();

  const list = document.getElementById("places-list");
  list.innerHTML = places
    .map(p => `<li><strong>${p.name}</strong> – ${p.description}</li>`)
    .join("");
}

// ── Dagsplanering ──────────────────────────────────────
async function planDay(start = "visby", hours = 6, interest = "natur") {
  const res  = await fetch(
    `${API_BASE}/api/dayplan?start=${start}&hours=${hours}&interest=${interest}`
  );
  const plan = await res.json();

  console.log(`Planerade ${plan.plan.length} stopp, ${plan.hours_used}h`);
  plan.plan.forEach(stop => {
    console.log(`• ${stop.name} (${stop.distance_km} km, ${stop.duration_hours}h)`);
  });
}

// ── Anropa vid sidladdning ─────────────────────────────
loadWeather();
loadPlaces("kultur");
planDay("visby", 8, "natur");
```

---

## Exempel-svar

### GET /api/weather
```json
{
  "visby": {
    "name": "Visby",
    "time": "2024-07-15T12:00:00Z",
    "temp_c": 22.1,
    "wind_ms": 5.3,
    "precip_category": 0,
    "weather_symbol": 2
  },
  "slite": { "name": "Slite", "temp_c": 21.4, "..." : "..." },
  "hemse": { "name": "Hemse", "temp_c": 23.0, "..." : "..." }
}
```

### GET /api/places?category=natur
```json
[
  {
    "id": "lummelunda-grottan",
    "name": "Lummelundagrottan",
    "category": "natur",
    "description": "Gotlands och ett av Skandinaviens längsta grottsystem...",
    "lat": 57.7417,
    "lon": 18.3167,
    "duration_hours": 2.0,
    "indoor": true,
    "website": "https://lummelundagrottan.se"
  }
]
```

### GET /api/dayplan?start=visby&hours=6&interest=natur
```json
{
  "start": "Visby",
  "hours": 6,
  "interest": "natur",
  "weather": { "temp_c": 22.1, "wind_ms": 5.3, "precip_category": 0 },
  "hours_used": 5.5,
  "plan": [
    {
      "name": "Tofta strand",
      "category": "natur",
      "description": "Populärt sandstrand söder om Visby...",
      "distance_km": 12.3,
      "duration_hours": 2.5,
      "indoor": false,
      "website": null
    },
    {
      "name": "Gnisvärd",
      "category": "natur",
      "description": "Charmerande fiskeläge med långa sandstränder...",
      "distance_km": 14.1,
      "duration_hours": 1.5,
      "indoor": false,
      "website": null
    }
  ]
}
```

---

## Datalägen

- **Väder:** Live från SMHI:s öppna API (cachat 1h lokalt i `data/cache.json`)
- **Platser:** Kuraterat JSON (`data/places.json`) – enkelt att utöka
- **Färja:** Hårdkodade approximativa tider – uppdatera manuellt per säsong
- **Dagsplan:** Beräknad logik baserat på avstånd och timbudget

## Struktur

```
backend/
├── main.py              # FastAPI-app med alla routes
├── requirements.txt
├── render.yaml          # Render deploy-config
├── .gitignore
├── README.md
└── data/
    ├── places.json      # Kuraterade platser
    └── cache.json       # Autogenererad väder-cache (git-ignorerad)
```
