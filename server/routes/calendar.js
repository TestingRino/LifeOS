import express from 'express';
import axios from 'axios';

const router = express.Router();

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

async function getCalendarEvents(accessToken, timeMin, timeMax) {
  try {
    const response = await axios.get(`${CALENDAR_API}/calendars/primary/events`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
      },
    });
    return response.data.items || [];
  } catch (err) {
    console.error('Calendar fetch error:', err.response?.data || err.message);
    throw err;
  }
}

async function createCalendarEvent(accessToken, event) {
  try {
    const response = await axios.post(
      `${CALENDAR_API}/calendars/primary/events`,
      event,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response.data;
  } catch (err) {
    console.error('Event creation error:', err.response?.data || err.message);
    throw err;
  }
}

async function updateCalendarEvent(accessToken, eventId, event) {
  try {
    const response = await axios.put(
      `${CALENDAR_API}/calendars/primary/events/${eventId}`,
      event,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response.data;
  } catch (err) {
    console.error('Event update error:', err.response?.data || err.message);
    throw err;
  }
}

router.get('/events', async (req, res) => {
  const { accessToken, from, to } = req.query;
  if (!accessToken) return res.status(400).json({ error: 'Missing access token' });

  try {
    const events = await getCalendarEvents(accessToken, from, to);
    res.json({ events });
  } catch (err) {
    res.status(err.response?.status === 401 ? 401 : 400).json({ error: err.response?.data?.error?.message || err.message });
  }
});

router.post('/events', async (req, res) => {
  const { accessToken, event } = req.body;
  if (!accessToken || !event) return res.status(400).json({ error: 'Missing parameters' });

  try {
    const created = await createCalendarEvent(accessToken, {
      summary: event.summary || event.text || 'Untitled',
      description: event.description || event.notes || '',
      start: event.start ? { dateTime: event.start, ...(event.timeZone && { timeZone: event.timeZone }) } : { date: event.date },
      end: event.end ? { dateTime: event.end, ...(event.timeZone && { timeZone: event.timeZone }) } : event.date ? { date: addDays(event.date, 1) } : undefined,
      ...(Array.isArray(event.recurrence) && { recurrence: event.recurrence }),
      location: event.location || '',
      reminders: { useDefault: true },
    });
    res.json({ event: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/events/:eventId', async (req, res) => {
  const { accessToken, event } = req.body;
  const { eventId } = req.params;
  if (!accessToken || !event) return res.status(400).json({ error: 'Missing parameters' });

  try {
    const updated = await updateCalendarEvent(accessToken, eventId, event);
    res.json({ event: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export default router;
