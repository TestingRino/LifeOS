import express from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import parse from '../lib/ocr-normalize.js';
import { ocrQuota } from '../middleware/security.js';
import { plannerHint } from '../lib/planner-hints.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const client = new Anthropic();

const OCR_PROMPTS = {
  calendar: `This is a screenshot or photo of a calendar (day, week or month view; possibly dark mode; from Outlook, Google, Apple or similar). Read each day header to work out the date of every column, using today's date to resolve the month and year. Extract EVERY event. For each give: date (YYYY-MM-DD); start (24-hour HH:MM) and end (HH:MM) read from the hour labels on the left if they are visible; if the hour labels are NOT visible, estimate start and end from the vertical position and block height relative to other events and any current-time marker, and set approx true; title exactly as written (if it is cut off, give your best reading and set approx true); allDay true for banner events at the top of a day or events that span several days, with endDate (the last day, inclusive) for multi-day ones. A recurring event that shows on several days is listed once per day. Return ONLY JSON: {events: [{date, start, end, title, allDay, endDate, approx}]}`,
  schedule: `Extract schedule entries from this image. For each entry, extract: date (YYYY-MM-DD if visible), time (HH:MM), and activity text. Return JSON: {entries: [{date, time, text}]}`,
  goals: `This is a roles-and-goals planner page. Read the handwriting carefully. Extract: each role (e.g. Parent) with its WHY (the underlying reasons the role matters); every written goal; and the handwritten Monthly, Weekly and Daily action text for the role. For each goal give: title, why (if any), target date (YYYY-MM-DD, empty if none), area (work|home|friends|projects|fun|health), role, and cadence: "daily" if it repeats every day, "weekly" if it repeats every week, "monthly" if it repeats every month, otherwise "once". Return ONLY JSON: {roles: [{name, why, monthly, weekly, daily}], goals: [{title, why, target, area, role, cadence}]}`,
  workouts: `Extract workout log from this image. For each entry, extract: date (YYYY-MM-DD), type (e.g., running, lifting), duration in minutes, details. Return JSON: {workouts: [{date, type, minutes, details}]}`,
  weights: `Extract weight entries from this image. For each entry, extract: date (YYYY-MM-DD) and weight value. Return JSON: {weights: [{date, value}]}`,
  habits: `Extract habit tracker from this image. Extract: habit names and target days per week. Return JSON: {habits: [{name, target}]}`,
  shopping: `Extract shopping list from this image. For each item, extract the text. Return JSON: {items: [{text}]}`,
  journal: `Extract written thoughts, reflections, or notes from this image. Return the text as-is. Return JSON: {text: "..."}`,
  bucket: `Extract bucket list items from this image. For each item, extract: text, budget if mentioned, target date if mentioned. Return JSON: {items: [{text, budget, target}]}`,
  reading: `Extract reading list from this image. For each book/item, extract: title, author, genre. Return JSON: {items: [{title, by, genre}]}`,
  projects: `Extract project/hobby plans from this image. For each project, extract: name and steps/next actions. Return JSON: {projects: [{name, steps: [{text}]}]}`,
  events: `Extract key dates/events from this image. For each event, extract: date (YYYY-MM-DD or MM-DD for yearly), text, and whether it's yearly. Return JSON: {events: [{date, text, yearly}]}`,
  page: `This is a photo of a page from a paper planner, diary or bullet journal (a daily page, a weekly or monthly spread, a rapid-log page, a habit tracker grid, or a mix). Work out which layout it is and read EVERYTHING written on it. Rules:
- Dates: resolve every item to YYYY-MM-DD using today's date for the month and year. A daily page has one date (usually printed at the top). A weekly spread has a date per day column or row (headings like "Mon 9"); give each item the date of the day it sits under. A monthly grid gives each item the date of its cell. Use "" when the date is genuinely unknown.
- Priorities: items in a box or list titled Big 3, Top 3, Priorities, Daily Greatness, Most important, or coded A1/B2/C3 (keep the code). done is true when the checkbox is ticked, filled, crossed out or marked with a check or x.
- Schedule: anything with a time (hourly grid, time axis, "9:30 dentist"). Give start and end in 24-hour HH:MM read from the hour labels printed down the side; if the hour labels are not readable estimate from position and set approx true. allDay true for untimed all-day banners.
- Tasks: checkbox or bulleted to-dos without a time. done as above.
- Bullet journal symbols: • task, × done, > migrated, < scheduled, ○ event, – note, * priority, ! inspiration. Give each rapid-log line a kind: task, done, migrated, scheduled, event, note or priority.
- Notes: written reflections, wins, ideas. Gratitude: gratitude lines (strings). Habits: for a habit tracker grid give each habit name and the dates whose boxes are ticked.
- Read handwriting carefully. Keep each item's own words; do not invent items. Leave empty boxes out.
Return ONLY JSON: {"layout": "daily|weekly|monthly|rapidlog|habits|other", "planner": "brand if recognizable else empty", "date": "YYYY-MM-DD or empty", "priorities": [{"text", "done", "code", "date"}], "schedule": [{"date", "start", "end", "text", "allDay", "approx"}], "tasks": [{"date", "text", "done", "kind"}], "notes": [{"date", "text"}], "gratitude": ["..."], "habits": [{"name", "days": ["YYYY-MM-DD"]}]}`,
  reflections: `Extract reflections from this image. Extract any mentions of: progress on goals, areas to improve, and memorable moments. Return JSON: {progress: "...", improve: "...", memories: "..."}`,
};

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function analyzeImage(base64Image, mediaType, type = 'auto', ctx = {}) {
  const brand = plannerHint(ctx.planner);
  const formats = Object.entries(OCR_PROMPTS).map(([k, v]) => `- type "${k}": ${v}`).join('\n');
  const prompt = type === 'auto'
    ? `Analyze this image of a handwritten or printed planner page and decide which type of life planning data it contains. Types and the JSON shape of "data" for each:\n${formats}\nA screenshot or photo of a calendar grid with time slots or day columns is type \"calendar\". A roles-and-goals page (a role with its WHY, goals and monthly/weekly/daily actions) is type "goals". A page from a paper planner, diary or bullet journal (a daily page with priorities and a to-do list, a weekly or monthly spread, a rapid log, a habit tracker grid) is type "page". Pick the single best type, read the handwriting carefully, then return ONLY JSON: {"type": "<type>", "data": {...}} with data in that type's shape.`
    : (OCR_PROMPTS[type] || OCR_PROMPTS.journal);

  const hinted = brand ? `${prompt}\n\n${brand}` : prompt;
  const dated = ctx.today && /^\d{4}-\d{2}-\d{2}$/.test(ctx.today) ? `${hinted}\n\nToday's date is ${ctx.today} (${new Date(`${ctx.today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}).` : hinted;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-5-5',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: MEDIA_TYPES.includes(mediaType) ? mediaType : 'image/jpeg', data: base64Image },
            },
            { type: 'text', text: dated },
          ],
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');

    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('JSON parse error:', e.message, 'Response:', content.text);
      return { raw: content.text, error: 'Could not parse response as JSON' };
    }
  } catch (err) {
    console.error('Claude API error:', err.message);
    throw err;
  }
}

router.post('/analyze', ocrQuota, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });

  const { type = 'auto', today, planner = '' } = req.body;
  const base64 = req.file.buffer.toString('base64');

  try {
    const result = await analyzeImage(base64, req.file.mimetype, type, { today, planner });
    if (result.error) return res.status(502).json({ error: 'Could not read structured data from that photo. Try a clearer, closer shot.' });
    const detected = type === 'auto' ? (result.type || 'journal') : type;
    const unwrapped = type !== 'auto' && result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : result;
    const parsed = parse.normalizeByType(detected, (type === 'auto' ? result.data : unwrapped) || {});
    res.json({ type: detected, data: parsed, suggestions: parse.getRoutingSuggestions(detected, parsed) });
  } catch (err) {
    console.error('OCR analyze failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/batch', ocrQuota, upload.array('images', 5), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No images provided' });

  const { types = [] } = req.body;
  const results = [];

  try {
    for (let i = 0; i < req.files.length; i++) {
      const base64 = req.files[i].buffer.toString('base64');
      const type = types[i] || 'auto';
      const result = await analyzeImage(base64, req.files[i].mimetype, type);
      results.push({ index: i, type, data: result });
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
