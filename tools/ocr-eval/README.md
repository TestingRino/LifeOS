# Photo-reader accuracy harness

Photo import is the feature that sets Life.OS apart, so measure it before you promise it.

1. Pick 3 to 5 planner layouts your first users actually own (for example Full Focus, Panda Planner, Bullet Journal spreads, an Outlook or Google week screenshot).
2. For each layout, take 5 to 10 real photos in normal conditions (phone, desk light, slight angle).
3. Next to each photo `name.jpg`, write `name.expected.json` with what is truly on the page:

```json
{ "type": "goals", "data": { "roles": [{ "name": "Parent" }], "goals": [{ "title": "Run a 10K" }] } }
```

For calendars use `{"type":"calendar","data":{"events":[{"date":"2026-03-02","time":"09:00","text":"Standup"}]}}`.

4. Run it against your API with a Google access token from an approved account:

```bash
node tools/ocr-eval.js tools/ocr-eval/fixtures --token "$TOKEN" --url https://life-os-bice-xi.vercel.app --min 0.85
```

It reports precision (what it read was real), recall (what was on the page it found) and F1 per page and overall, lists what it missed, and writes `report.json`. Keep fixtures out of git if they contain personal pages (`tools/ocr-eval/fixtures/` is ignored).

Work the misses layout by layout: tighten the prompt in `server/routes/ocr.js` for that layout, re-run, and only widen to a new layout once the current ones hold above your target.

## Planner pages

Use `"type": "page"` for any page from a paper planner or journal. The reader returns priorities, schedule items, to-dos, notes and (for habit grids) ticked days in one shape. `tools/ocr-eval/examples/` has starting `.expected.json` files for the most common layouts; copy one next to your photo and edit it to match the page:

| Layout | Example file |
|---|---|
| Full Focus (Daily Big 3, hourly schedule, tasks) | `fullfocus-daily` |
| Panda Planner (priorities, gratitude, to-dos) | `panda-daily` |
| Passion Planner / Happy Planner / Erin Condren (weekly spread) | `passion-weekly` |
| Franklin Covey (A1/B2 task codes, appointment times) | `franklin-daily` |
| Bullet journal rapid log (symbols) | `bujo-rapidlog` |
| Habit tracker grid | `habit-grid` |

Add `"planner": "panda"` style hints by choosing the planner in the photo dialog; the eval script sends the same field when the sidecar file has `"planner"`.
