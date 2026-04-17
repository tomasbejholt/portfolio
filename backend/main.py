"""
Gotland Explorer API
FastAPI backend som exponerar väder, sevärdheter, färjetider och dagsplanering.
"""

import json
import math
import time
from pathlib import Path
from typing import Optional
from collections import defaultdict

import os

import anthropic
import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client

# ── App & CORS ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Gotland Explorer API",
    description="Datadriven guide till Gotland – väder, platser, färjor och dagsturer.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Tillåt alla origins (portfolio på S3, localhost, etc.)
    allow_methods=["GET", "POST", "HEAD"],
    allow_headers=["*"],
)

# ── Filsökvägar ───────────────────────────────────────────────────────────────

DATA_DIR    = Path(__file__).parent / "data"
CACHE_FILE  = DATA_DIR / "cache.json"
PLACES_FILE = DATA_DIR / "places.json"

SUPABASE_URL      = os.getenv("SUPABASE_URL")
SUPABASE_KEY      = os.getenv("SUPABASE_KEY")
ANALYTICS_KEY     = os.getenv("ANALYTICS_KEY", "")
DASHBOARD_PIN     = os.getenv("DASHBOARD_PIN", "")
DISCORD_WEBHOOK   = os.getenv("DISCORD_WEBHOOK", "")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None

CACHE_TTL = 3600  # Sekunder (1 timme) innan väderdatan hämtas på nytt

# ── Koordinater för de tre orterna ────────────────────────────────────────────

LOCATIONS = {
    "visby":  {"lat": 57.6348, "lon": 18.2948, "name": "Visby"},
    "slite":  {"lat": 57.7074, "lon": 18.7986, "name": "Slite"},
    "hemse":  {"lat": 57.2404, "lon": 18.3645, "name": "Hemse"},
}

SMHI_BASE = (
    "https://opendata-download-metfcst.smhi.se"
    "/api/category/snow1g/version/1/geotype/point"
)

# ── Hjälpfunktioner ───────────────────────────────────────────────────────────

def load_cache() -> dict:
    """Läser cache-filen. Returnerar tom dict om filen saknas."""
    if CACHE_FILE.exists():
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    return {}


def save_cache(data: dict) -> None:
    """Sparar data till cache-filen (skapar mappen om den saknas)."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def load_places() -> list:
    """Läser places.json och returnerar en lista med platser."""
    return json.loads(PLACES_FILE.read_text(encoding="utf-8"))


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Beräknar fågelvägsavstånd i km mellan två koordinatpar."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def fetch_smhi(lat: float, lon: float) -> dict:
    """Hämtar SMHI:s punktprognos för givna koordinater."""
    url = f"{SMHI_BASE}/lon/{lon}/lat/{lat}/data.json"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.json()


def parse_smhi(raw: dict) -> dict:
    """
    Extraherar relevanta fält ur SMHI:s snow1g v1 API-svar.

    Parametrar som används:
      air_temperature                          – temperatur (°C)
      wind_speed                               – vindhastighet (m/s)
      predominant_precipitation_type_at_surface – nederbördstyp
      symbol_code                              – väder-symbol (1=klart …)
    """
    series = raw.get("timeSeries", [])
    if not series:
        return {}

    now = series[0]
    params = now.get("data", {})

    return {
        "time":            now.get("time"),
        "temp_c":          params.get("air_temperature"),
        "wind_ms":         params.get("wind_speed"),
        "precip_category": params.get("predominant_precipitation_type_at_surface"),
        "weather_symbol":  params.get("symbol_code"),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

TOMAS_SYSTEM_PROMPT = """
You are a portfolio assistant for Tomas Bejholt. Answer questions about him honestly and warmly.
Answer in the same language the visitor writes in (Swedish or English).

About Tomas:
- Full name: John Tomas Louis Jakobsson Bejholt, goes by Tomas. Born 1984, 41 years old.
- Lives in Stockholm, Sweden.
- Currently studying PIA25 – Python Programming in AI at Nackademin (August 2025 – May 2027).
- Completed courses so far: Python Programming, Database Technology, DevOps, Web Development, Frameworks in Python. Also studying Business Skills. Upcoming: Machine Learning & Deep Learning, Thesis Project, and LIA (internship).
- Background: worked in construction, moving services, distribution, and ran his own trucking business. Discovered a passion for tech through CAD/CAM and CNC programming. Completed primary and secondary school through Komvux as an adult.
- Projects:
  1. Neon Snake – classic Snake with a neon aesthetic, built in vanilla JavaScript and Canvas API. Features Easy/Hard modes and a live global leaderboard backed by FastAPI and Supabase.
  2. Gotland Explorer – a REST API built with Python and FastAPI, serving live Gotland data: real-time SMHI weather, curated places, ferry schedules, and a day-trip planner. Hosted on Render.
  3. Churn Prediction – a full ML app predicting customer churn for a telecom company. Three models trained on imbalanced data (73/27 split): Random Forest (baseline), MLP with PyTorch (best recall: 0.84), and LightGBM (best overall: AUC-ROC 0.85, F1 0.63). Served via FastAPI, with a multi-page Streamlit UI for live predictions, model comparison, SHAP feature importance, learning curves, and EDA. Key learnings: recall matters more than accuracy on imbalanced data, pos_weight helped MLP find churned customers, and all preprocessing must happen after train/test split to avoid data leakage.
  4. National Crisis Dashboard – a real-time Streamlit dashboard aggregating live incident data from four official Swedish sources: Swedish Police API, SMHI API, Krisinformation.se RSS, and Trafikverket API. Features an interactive national map (Folium) with color-coded severity markers, Isolation Forest anomaly detection to flag unusual patterns, filtering by source/severity/time window/county, cloud-backed storage with duplicate prevention via Supabase, and an auto-generated situation summary per session. Stack: Python, Streamlit, Supabase, scikit-learn, Folium, pandas.
- Personal: has three children, enjoys outdoor activities.
- Looking for an LIA internship in Stockholm. Open to any company or industry.
- Contact: tomas_bejholt@outlook.com. LinkedIn and a contact form are also available on the portfolio site.

The last project in the list above is always the most recent one.

Important guidelines:
- Tomas is a student actively learning – never claim he is an expert or highly skilled in any area yet. Be honest about where he is in his journey.
- Keep answers short, friendly, and to the point.
- If asked something you don't know about Tomas, say so honestly.
""".strip()


class ChatRequest(BaseModel):
    message: str


class ScoreEntry(BaseModel):
    name: str
    score: int
    mode: str = "easy"


@app.head("/health", tags=["health"], include_in_schema=False)
async def health_head():
    return {}

@app.get("/health", tags=["health"], include_in_schema=False)
async def health_get():
    return {"status": "ok"}

@app.get("/", tags=["root"])
async def root():
    """Hälsningssida – bekräftar att API:t är igång."""
    return {
        "message": "Gotland Explorer API är igång 🏝️",
        "docs":    "/docs",
        "endpoints": ["/api/weather", "/api/places", "/api/ferry", "/api/dayplan", "/api/chat"],
    }


@app.get("/api/weather", tags=["weather"])
async def get_weather():
    """
    Returnerar aktuell väderprognos för Visby, Slite och Hemse.
    Datan cachas i 1 timme för att inte överbelasta SMHI:s API.

    Exempel-svar:
    ```json
    {
      "visby": { "name": "Visby", "temp_c": 12.3, "wind_ms": 4.1, ... },
      "slite": { ... },
      "hemse": { ... }
    }
    ```
    """
    cache = load_cache()
    now_ts = time.time()

    # Returnera cachad data om den är färsk nog
    if (
        "weather" in cache
        and now_ts - cache["weather"].get("fetched_at", 0) < CACHE_TTL
    ):
        return cache["weather"]["data"]

    # Hämta ny data från SMHI för alla tre orter
    result = {}
    for key, loc in LOCATIONS.items():
        try:
            raw = await fetch_smhi(loc["lat"], loc["lon"])
            result[key] = {"name": loc["name"], **parse_smhi(raw)}
        except Exception as e:
            result[key] = {"name": loc["name"], "error": str(e)}

    cache["weather"] = {"fetched_at": now_ts, "data": result}
    save_cache(cache)
    return result


@app.get("/api/places", tags=["places"])
async def get_places(
    category: Optional[str] = Query(
        None, description="Filtrera på kategori: natur | kultur | mat"
    )
):
    """
    Returnerar kuraterad lista med Gotlands sevärdheter.
    Valfritt filter: ?category=natur  (natur, kultur eller mat)
    """
    places = load_places()
    if category:
        places = [p for p in places if p["category"] == category.lower()]
    return places


@app.get("/api/ferry", tags=["ferry"])
async def get_ferry():
    """
    Returnerar ett approximativt schema för Destination Gotlands färjer.
    OBS: Kontrollera alltid aktuella tider på destinationgotland.se.
    """
    return {
        "note": (
            "Approximate times – check destinationgotland.se for exact departures "
            "and seasonal variations."
        ),
        "routes": [
            {
                "from": "Nynäshamn", "to": "Visby",
                "departures": ["06:00", "09:00", "14:30", "20:00"],
                "duration_hours": 3.5,
            },
            {
                "from": "Visby", "to": "Nynäshamn",
                "departures": ["07:30", "12:00", "17:30", "22:00"],
                "duration_hours": 3.5,
            },
            {
                "from": "Oskarshamn", "to": "Visby",
                "departures": ["08:00", "17:00"],
                "duration_hours": 4.0,
            },
            {
                "from": "Visby", "to": "Oskarshamn",
                "departures": ["09:30", "20:00"],
                "duration_hours": 4.0,
            },
        ],
    }


@app.get("/api/dayplan", tags=["dayplan"])
async def get_dayplan(
    start: str = Query("visby", description="Startort: visby | slite | hemse"),
    hours: int = Query(6, ge=2, le=12, description="Tillgängliga timmar (2–12)"),
    interest: str = Query(
        "natur", description="Intresse: natur | kultur | mat"
    ),
):
    """
    Genererar ett dagstur-förslag baserat på startort, antal timmar och intresse.

    Algoritm:
    1. Filtrera platser på vald kategori.
    2. Sortera på avstånd från startorten.
    3. Välj greedy upp till 4 platser som ryms inom timbudjetet.
    4. Komplettera med andra kategorier om för få platser hittades.
    5. Inkludera väderprognos för startorten.
    """
    if start not in LOCATIONS:
        return {
            "error": f"Okänd startort. Välj bland: {', '.join(LOCATIONS.keys())}"
        }

    # Normalisera engelska alias → svenska
    alias = {"nature": "natur", "culture": "kultur", "food": "mat"}
    category = alias.get(interest.lower(), interest.lower())

    start_loc = LOCATIONS[start]
    places = load_places()

    # Primär: filtrera på kategori och sortera på avstånd
    primary = sorted(
        [dict(p) for p in places if p["category"] == category],
        key=lambda p: haversine(
            start_loc["lat"], start_loc["lon"], p["lat"], p["lon"]
        ),
    )

    selected = []
    hours_used = 0.5  # 30 min startbuffert (parkering/kaffe)

    def try_add(candidates):
        for p in candidates:
            if len(selected) >= 4:
                break
            dist = haversine(
                start_loc["lat"], start_loc["lon"], p["lat"], p["lon"]
            )
            duration = p.get("duration_hours", 1.0)
            travel   = max(0.25, dist / 60)  # grov uppskattning: 60 km/h
            if hours_used + travel + duration <= hours:
                p["_dist_km"] = round(dist, 1)
                selected.append(p)
                # Uppdatera hours_used via nonlocal workaround
                return travel + duration
        return 0

    # Primär runda
    for p in primary:
        added = try_add([p])
        hours_used += added

    # Supplement om färre än 2 platser valts
    if len(selected) < 2:
        others = sorted(
            [dict(p) for p in places if p not in selected and p["category"] != category],
            key=lambda p: haversine(
                start_loc["lat"], start_loc["lon"], p["lat"], p["lon"]
            ),
        )
        for p in others:
            added = try_add([p])
            hours_used += added
            if len(selected) >= 3:
                break

    # Hämta väder för startorten
    try:
        raw     = await fetch_smhi(start_loc["lat"], start_loc["lon"])
        weather = parse_smhi(raw)
    except Exception:
        weather = None

    return {
        "start":      start_loc["name"],
        "hours":      hours,
        "interest":   category,
        "weather":    weather,
        "hours_used": round(hours_used, 1),
        "plan": [
            {
                "name":          p["name"],
                "category":      p["category"],
                "description":   p["description"],
                "distance_km":   p.get("_dist_km", 0),
                "duration_hours": p.get("duration_hours", 1.0),
                "indoor":        p.get("indoor", False),
                "website":       p.get("website"),
            }
            for p in selected
        ],
    }


@app.post("/api/chat", tags=["chat"])
async def chat(req: ChatRequest):
    """
    Tar emot ett meddelande och returnerar ett svar från en AI-assistent
    som känner till Tomas Bejholt och kan svara på frågor om honom.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Chat is not configured.")

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        system=TOMAS_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": req.message}],
    )
    return {"reply": message.content[0].text}


@app.get("/api/scores", tags=["snake"])
async def get_scores(mode: str = Query("easy", description="Läge: easy | hard")):
    """Returnerar top-10 highscore-listan för valt läge (easy eller hard)."""
    if mode not in ("easy", "hard"):
        raise HTTPException(status_code=422, detail="mode måste vara 'easy' eller 'hard'.")
    if not supabase:
        raise HTTPException(status_code=503, detail="Databasen är inte konfigurerad.")
    res = (
        supabase.table("scores")
        .select("name, score")
        .eq("mode", mode)
        .order("score", desc=True)
        .limit(10)
        .execute()
    )
    return res.data


@app.post("/api/scores", tags=["snake"])
async def post_score(entry: ScoreEntry):
    """Lägger till ett resultat och returnerar uppdaterad top-10."""
    mode = entry.mode if entry.mode in ("easy", "hard") else "easy"
    name = entry.name.strip()[:20]
    if not name:
        raise HTTPException(status_code=422, detail="Namn får inte vara tomt.")
    if entry.score <= 0:
        raise HTTPException(status_code=422, detail="Score måste vara > 0.")
    if not supabase:
        raise HTTPException(status_code=503, detail="Databasen är inte konfigurerad.")

    supabase.table("scores").insert({"name": name, "score": entry.score, "mode": mode}).execute()

    res = (
        supabase.table("scores")
        .select("name, score")
        .eq("mode", mode)
        .order("score", desc=True)
        .limit(10)
        .execute()
    )
    return res.data


# ── Analytics ─────────────────────────────────────────────────────────────────

class TrackEvent(BaseModel):
    visitor_id: str
    page: str
    event: str
    data: Optional[str] = None


class BlockEvent(BaseModel):
    visitor_id: str


class AuthRequest(BaseModel):
    pin: str


async def send_discord(message: str):
    if not DISCORD_WEBHOOK:
        return
    try:
        async with httpx.AsyncClient() as client:
            await client.post(DISCORD_WEBHOOK, json={"content": message}, timeout=5)
    except Exception:
        pass


BOT_PATTERNS = [
    "bot", "crawl", "spider", "slurp", "preview", "facebookexternalhit",
    "linkedinbot", "twitterbot", "discordbot", "whatsapp", "telegrambot",
    "curl", "python-httpx", "python-requests", "go-http-client", "axios",
    "wget", "libwww", "httpclient", "java/", "okhttp",
    "headlesschrome", "phantomjs", "selenium", "puppeteer", "playwright",
    "scrapy", "aiohttp", "httpx", "node-fetch", "got/", "undici",
    "googlebot", "bingbot", "yandex", "baidu", "duckduckbot", "semrush",
    "ahrefsbot", "mj12bot", "dotbot", "rogerbot",
]

# In-memory deduplication to prevent double Discord notifications
# visitor_id → last_notified_ts  (cleared after 10 min)
_notified_visitors: dict[str, float] = {}
# ip → last_notified_ts  (cleared after 2 min)
_notified_ips: dict[str, float] = {}
_VISITOR_TTL = 600   # 10 minutes
_IP_TTL      = 120   # 2 minutes

def _clean_notified():
    now = time.time()
    for d, ttl in ((_notified_visitors, _VISITOR_TTL), (_notified_ips, _IP_TTL)):
        stale = [k for k, t in d.items() if now - t > ttl]
        for k in stale:
            del d[k]

def _is_bot_ua(ua: str) -> bool:
    if not ua:
        return True
    return any(p in ua for p in BOT_PATTERNS)


@app.post("/api/track", tags=["analytics"], include_in_schema=False)
async def track(ev: TrackEvent, request: Request):
    """Tar emot ett spårningsevent från frontend och sparar i Supabase."""
    ua = request.headers.get("user-agent", "").lower()
    if _is_bot_ua(ua):
        return {"ok": False}

    # Require Accept header — real browsers always send it, most bots skip it
    if not request.headers.get("accept"):
        return {"ok": False}

    if not supabase:
        return {"ok": False}

    _clean_notified()

    vid = ev.visitor_id[:64]
    ip  = request.headers.get("x-forwarded-for", request.client.host if request.client else "").split(",")[0].strip()

    # Only send Discord for first pageview of a new visitor
    if ev.event == "pageview":
        now = time.time()
        already_notified_visitor = vid in _notified_visitors
        already_notified_ip      = ip and ip in _notified_ips

        if not already_notified_visitor and not already_notified_ip:
            # Check DB as authoritative source
            is_new = not supabase.table("events") \
                .select("id").eq("visitor_id", vid).limit(1).execute().data
            if is_new:
                _notified_visitors[vid] = now
                if ip:
                    _notified_ips[ip] = now
                await send_discord("🟢 Ny besökare på portfolion!")

    supabase.table("events").insert({
        "visitor_id": vid,
        "page":       ev.page[:32],
        "event":      ev.event[:32],
        "data":       ev.data[:64] if ev.data else None,
    }).execute()

    return {"ok": True}


@app.post("/api/analytics/auth", tags=["analytics"], include_in_schema=False)
async def analytics_auth(req: AuthRequest):
    """Verifierar dashboard-PIN och returnerar access-token."""
    if not DASHBOARD_PIN or req.pin != DASHBOARD_PIN:
        raise HTTPException(status_code=403, detail="Fel PIN")
    return {"token": ANALYTICS_KEY}


@app.post("/api/analytics/block", tags=["analytics"], include_in_schema=False)
async def block_visitor(req: BlockEvent, key: str = Query("")):
    """Flaggar en besökare som blockerad – räknas inte längre i statistiken."""
    if not ANALYTICS_KEY or key != ANALYTICS_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not supabase:
        raise HTTPException(status_code=503, detail="Databasen är inte konfigurerad.")
    supabase.table("events").insert({
        "visitor_id": req.visitor_id[:64],
        "page": "system",
        "event": "blocked",
        "data": None,
    }).execute()
    return {"ok": True}


@app.get("/api/analytics", tags=["analytics"], include_in_schema=False)
async def analytics(key: str = Query("")):
    """Returnerar aggregerad besöksstatistik. Kräver rätt nyckel."""
    if not ANALYTICS_KEY or key != ANALYTICS_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not supabase:
        raise HTTPException(status_code=503, detail="Databasen är inte konfigurerad.")

    all_events = supabase.table("events").select("*").order("created_at", desc=True).limit(1000).execute().data

    blocked_ids = {e["visitor_id"] for e in all_events if e["event"] == "blocked"}
    events = [e for e in all_events if e["visitor_id"] not in blocked_ids and e["event"] != "blocked"]

    unique_visitors = len({e["visitor_id"] for e in events})
    total_visits = sum(1 for e in events if e["event"] == "pageview")

    page_views = {}
    for e in events:
        if e["event"] == "pageview":
            page_views[e["page"]] = page_views.get(e["page"], 0) + 1

    project_clicks = {}
    project_event_map = {
        "snake_start":  "Neon Snake",
        "dayplan_use":  "Gotland Explorer",
        "chat_open":    "Chat",
    }
    for e in events:
        if e["event"] == "project_click" and e["data"]:
            project_clicks[e["data"]] = project_clicks.get(e["data"], 0) + 1
        elif e["event"] in project_event_map:
            name = project_event_map[e["event"]]
            project_clicks[name] = project_clicks.get(name, 0) + 1

    recent = events[:50]

    return {
        "total_visits": total_visits,
        "unique_visitors": unique_visitors,
        "page_views": page_views,
        "project_clicks": project_clicks,
        "recent": recent,
    }
