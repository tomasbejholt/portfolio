# Portfolio – Tomas Bejholt

Personal portfolio website for Tomas Bejholt, a Fullstack & AI developer currently studying Python Programming in AI at Nackademin (PIA25, 2025–2027).

## Overview

The project is split into a static frontend and a Python backend, deployed separately on Vercel and Render.

### Frontend (`/frontend`)

Static site built with plain HTML, CSS, and JavaScript. No frameworks — just clean, hand-written code.

- **Home** – Hero section with animated blob background and contact links
- **About** – Background, education, and skills
- **Projects** – Showcase of completed and ongoing projects
- **Chat widget** – Embedded AI assistant that visitors can use to ask questions about Tomas
- **Analytics** – Lightweight page visit tracking

Deployed on **Vercel**.

### Backend (`/backend`)

FastAPI service that powers the chat assistant, visitor analytics, and a Gotland Explorer API.

| Endpoint | Description |
|---|---|
| `POST /api/chat` | AI-powered chat assistant (Claude API) |
| `GET /api/weather` | Live weather for Visby, Slite, and Hemse (SMHI, cached 1 h) |
| `GET /api/places` | Curated attractions filtered by category (nature / culture / food) |
| `GET /api/ferry` | Approximate ferry schedules for Destination Gotland |
| `GET /api/dayplan` | Suggested day trip based on starting point, hours, and interest |

Interactive API docs available at `/docs` (Swagger UI).

Deployed on **Render** (free tier — expect a ~30 s cold start after inactivity).

## Tech Stack

- **Frontend:** HTML · CSS · Vanilla JS
- **Backend:** Python · FastAPI · Uvicorn
- **AI:** Anthropic Claude API
- **Data:** SMHI open weather API · curated JSON
- **Hosting:** Vercel (frontend) · Render (backend)

## Local Development

```bash
# Backend
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn main:app --reload
# API runs at http://localhost:8000
```

The frontend is plain HTML — just open `frontend/index.html` in a browser or serve it with any static file server.
