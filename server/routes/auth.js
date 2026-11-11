import express from 'express';
import axios from 'axios';

const router = express.Router();

const GOOGLE_OAUTH_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://testingrino.github.io/LifeOS/';

router.post('/google/token', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing authorization code' });

  try {
    const response = await axios.post(GOOGLE_OAUTH_URL, new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }));

    const { access_token, refresh_token, expires_in, scope, id_token } = response.data;
    res.json({ access_token, refresh_token, expires_in, scope, id_token });
  } catch (err) {
    console.error('OAuth token exchange failed:', err.response?.data || err.message);
    res.status(400).json({ error: 'Token exchange failed' });
  }
});

router.post('/google/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: 'Missing refresh token' });

  try {
    const response = await axios.post(GOOGLE_OAUTH_URL, new URLSearchParams({
      refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }));

    const { access_token, expires_in } = response.data;
    res.json({ access_token, expires_in });
  } catch (err) {
    console.error('Token refresh failed:', err.response?.data || err.message);
    res.status(400).json({ error: 'Token refresh failed' });
  }
});

router.get('/google/url', (req, res) => {
  // Each kind asks only for what that feature needs. Writing to a calendar is a separate, later request.
  const CALENDAR = ['https://www.googleapis.com/auth/calendar.readonly'];             // see your events and the list of your calendars
  const CALENDAR_WRITE = [...CALENDAR, 'https://www.googleapis.com/auth/calendar.events']; // also add events (photo imports, ideal week, scheduled tasks)
  const SYNC = [
    'openid', 'email',                                    // who is signed in (shown in Settings)
    'https://www.googleapis.com/auth/drive.appdata',      // Life.OS's own hidden app folder in the user's Drive
  ];
  const kind = req.query.scopes;
  const scope = (kind === 'sync' || kind === 'signin' ? SYNC : kind === 'all' ? [...CALENDAR, ...SYNC] : kind === 'calendarwrite' ? CALENDAR_WRITE : CALENDAR).join(' ');

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
  });

  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});


export default router;
