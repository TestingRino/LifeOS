# Life.OS Backend Server

Backend API for Google Calendar sync and photo OCR. Built with Express, Claude Vision, and Google Calendar API.

## Features

- **Phase 1:** Google OAuth + Calendar sync (pull/push events)
- **Phase 2:** Image OCR with intelligent routing (goals, schedule, workouts, habits, journal, etc.)
- **Phase 3:** Bidirectional sync between Life.OS and Google Calendar

## Prerequisites

- Node.js 18+
- Google OAuth credentials ([setup guide](https://developers.google.com/identity/protocols/oauth2))
- Claude API key (from https://console.anthropic.com)

## Setup (Development)

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Fill in your credentials in .env
# - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
# - ANTHROPIC_API_KEY

# Run development server with auto-reload
npm run dev
```

Server starts on http://localhost:3001.

## API Endpoints

### Authentication (Phase 1)

- `GET /api/auth/google/url` — Get Google OAuth login URL
- `POST /api/auth/google/token` — Exchange auth code for tokens
- `POST /api/auth/google/refresh` — Refresh expired access token

### Calendar (Phase 1 & 3)

- `GET /api/calendar/events?accessToken=...&from=2026-11-01&to=2026-12-01` — Fetch calendar events
- `POST /api/calendar/events` — Create event
- `PUT /api/calendar/events/:eventId` — Update event

### OCR (Phase 2)

- `POST /api/ocr/analyze` — Analyze single image (multipart/form-data)
  - Form fields: `image` (file), `type` (optional: auto|schedule|goals|workouts|habits|shopping|journal|bucket|reading|projects|events|reflections)
  - Returns: `{ type, data, suggestions }`

- `POST /api/ocr/batch` — Analyze multiple images
  - Form fields: `images[]` (files), `types[]` (optional types per image)
  - Returns: `{ results: [{index, type, data}] }`

### Health

- `GET /health` — Server status check

## How to Use

### 1. Connect Google Calendar (Phase 1)

Frontend calls:
```javascript
const urlRes = await fetch('/api/auth/google/url');
const { url } = await urlRes.json();
window.location = url;
// User logs in, browser redirects to /auth/callback with ?code=...
// Frontend exchanges code for token
const tokenRes = await fetch('/api/auth/google/token', {
  method: 'POST',
  body: JSON.stringify({ code }),
});
const { access_token } = await tokenRes.json();
localStorage.setItem('google_access_token', access_token);
```

### 2. Sync Calendar Events (Phase 1 & 3)

Frontend fetches calendar events:
```javascript
const eventsRes = await fetch(
  `/api/calendar/events?accessToken=${token}&from=2026-11-01&to=2026-12-01`
);
const { events } = await eventsRes.json();
// Parse events and add to Life.OS schedule
```

### 3. Upload Photo (Phase 2)

Frontend:
```javascript
const formData = new FormData();
formData.append('image', fileInput.files[0]);
formData.append('type', 'auto'); // or specific type

const result = await fetch('/api/ocr/analyze', {
  method: 'POST',
  body: formData,
});
const { type, data, suggestions } = await result.json();
// Show suggestions menu to user
// User picks route, frontend adds data to appropriate section
```

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Connect repo to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy: `vercel deploy`

### Railway

1. Connect GitHub repo
2. Set environment variables
3. Auto-deploys on push

### Heroku

```bash
heroku login
heroku create lifeos-api
heroku config:set GOOGLE_CLIENT_ID=...
heroku config:set GOOGLE_CLIENT_SECRET=...
heroku config:set ANTHROPIC_API_KEY=...
git push heroku main
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package* .
RUN npm install --production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

## Testing

```bash
# Test health check
curl http://localhost:3001/health

# Test auth URL generation
curl http://localhost:3001/api/auth/google/url

# Test OCR (requires image file)
curl -X POST \
  -F "image=@photo.jpg" \
  -F "type=schedule" \
  http://localhost:3001/api/ocr/analyze
```

## Architecture

```
server/
├── app.js                 Express app setup
├── routes/
│   ├── auth.js           Google OAuth flow
│   ├── calendar.js       Calendar sync
│   ├── ocr.js            Claude Vision OCR
│   └── parse.js          Result parsing & routing
└── .env                  Environment variables
```

## Error Handling

All errors return JSON:
```json
{ "error": "Error message here" }
```

Status codes:
- 400: Bad request (missing params)
- 500: Server error (API failures)

## Future Enhancements

- Rate limiting
- Request logging
- Database for sync state
- Webhook support for real-time Calendar updates
- Multi-user support
- Image storage with retention policy
