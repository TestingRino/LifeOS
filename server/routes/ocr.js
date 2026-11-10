import express from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import parse from './parse.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const client = new Anthropic();

const OCR_PROMPTS = {
  schedule: `Extract schedule entries from this image. For each entry, extract: date (YYYY-MM-DD if visible), time (HH:MM), and activity text. Return JSON: {entries: [{date, time, text}]}`,
  goals: `Extract goals from this image. For each goal, extract: title, why/reason, target date (YYYY-MM-DD), and area (work|home|friends|projects|fun|health). Return JSON: {goals: [{title, why, target, area}]}`,
  workouts: `Extract workout log from this image. For each entry, extract: date (YYYY-MM-DD), type (e.g., running, lifting), duration in minutes, details. Return JSON: {workouts: [{date, type, minutes, details}]}`,
  weights: `Extract weight entries from this image. For each entry, extract: date (YYYY-MM-DD) and weight value. Return JSON: {weights: [{date, value}]}`,
  habits: `Extract habit tracker from this image. Extract: habit names and target days per week. Return JSON: {habits: [{name, target}]}`,
  shopping: `Extract shopping list from this image. For each item, extract the text. Return JSON: {items: [{text}]}`,
  journal: `Extract written thoughts, reflections, or notes from this image. Return the text as-is. Return JSON: {text: "..."}`,
  bucket: `Extract bucket list items from this image. For each item, extract: text, budget if mentioned, target date if mentioned. Return JSON: {items: [{text, budget, target}]}`,
  reading: `Extract reading list from this image. For each book/item, extract: title, author, genre. Return JSON: {items: [{title, by, genre}]}`,
  projects: `Extract project/hobby plans from this image. For each project, extract: name and steps/next actions. Return JSON: {projects: [{name, steps: [{text}]}]}`,
  events: `Extract key dates/events from this image. For each event, extract: date (YYYY-MM-DD or MM-DD for yearly), text, and whether it's yearly. Return JSON: {events: [{date, text, yearly}]}`,
  reflections: `Extract reflections from this image. Extract any mentions of: progress on goals, areas to improve, and memorable moments. Return JSON: {progress: "...", improve: "...", memories: "..."}`,
};

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function analyzeImage(base64Image, mediaType, type = 'auto') {
  const prompt = type === 'auto'
    ? `Analyze this image and detect what type of life planning data it contains (schedule, goals, workouts, weights, habits, shopping, journal, bucket, reading, projects, events, or reflections). Then extract the data. Return ONLY JSON: {type: "...", data: {...}} where data uses the shape for that type.`
    : (OCR_PROMPTS[type] || OCR_PROMPTS.journal);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-5-5',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: MEDIA_TYPES.includes(mediaType) ? mediaType : 'image/jpeg', data: base64Image },
            },
            { type: 'text', text: prompt },
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

router.post('/analyze', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });

  const { type = 'auto' } = req.body;
  const base64 = req.file.buffer.toString('base64');

  try {
    const result = await analyzeImage(base64, req.file.mimetype, type);
    if (result.error) return res.status(502).json({ error: 'Could not read structured data from that photo. Try a clearer, closer shot.' });
    const detected = type === 'auto' ? (result.type || 'journal') : type;
    const parsed = parse.normalizeByType(detected, (type === 'auto' ? result.data : result) || {});
    res.json({ type: detected, data: parsed, suggestions: parse.getRoutingSuggestions(detected, parsed) });
  } catch (err) {
    console.error('OCR analyze failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/batch', upload.array('images', 5), async (req, res) => {
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
