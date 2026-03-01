"""
Gotland Explorer API
FastAPI backend som exponerar väder, sevärdheter, färjetider och dagsplanering.
"""

import json
import math
import time
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

# ── App & CORS ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Gotland Explorer API",
    description="Datadriven guide till Gotland – väder, platser, färjor och dagsturer.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Tillåt alla origins (portfolio på S3, localhost, etc.)
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ── Filsökvägar ───────────────────────────────────────────────────────────────

DATA_DIR   = Path(__file__).parent / "data"
CACHE_FILE = DATA_DIR / "cache.json"
PLACES_FILE = DATA_DIR / "places.json"

CACHE_TTL = 3600  # Sekunder (1 timme) innan väderdatan hämtas på nytt

# ── Koordinater för de tre orterna ────────────────────────────────────────────

LOCATIONS = {
    "visby":  {"lat": 57.6348, "lon": 18.2948, "name": "Visby"},
    "slite":  {"lat": 57.7074, "lon": 18.7986, "name": "Slite"},
    "hemse":  {"lat": 57.2404, "lon": 18.3645, "name": "Hemse"},
}

SMHI_BASE = (
    "https://opendata-download-metfcst.smhi.se"
    "/api/category/pmp3g/version/2/geotype/point"
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
    Extraherar relevanta fält ur SMHI:s API-svar.

    Parametrar som används:
      t      – temperatur (°C)
      ws     – vindhastighet (m/s)
      pcat   – nederbördstyp (0=ingen, 1=snö, 3=regn, 4=duggregn …)
      Wsymb2 – väder-symbol (1=klart, 27=kraftigt snöfall)
    """
    series = raw.get("timeSeries", [])
    if not series:
        return {}

    now = series[0]
    params = {p["name"]: p["values"][0] for p in now["parameters"]}

    return {
        "time":            now["validTime"],
        "temp_c":          params.get("t"),
        "wind_ms":         params.get("ws"),
        "precip_category": params.get("pcat"),
        "weather_symbol":  params.get("Wsymb2"),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/", tags=["root"])
async def root():
    """Hälsningssida – bekräftar att API:t är igång."""
    return {
        "message": "Gotland Explorer API är igång 🏝️",
        "docs":    "/docs",
        "endpoints": ["/api/weather", "/api/places", "/api/ferry", "/api/dayplan"],
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
            "Approximativa tider – se destinationgotland.se för exakta avgångstider "
            "och säsongsvariationer."
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

    def with_distance(lst):
        for p in lst:
            p = dict(p)  # kopiera för att inte mutera original
            p["_dist_km"] = haversine(
                start_loc["lat"], start_loc["lon"], p["lat"], p["lon"]
            )
        return lst

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
