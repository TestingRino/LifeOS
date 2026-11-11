/* What the popular paper planners look like, so the photo reader knows where to look.
   Editions change, so each hint says "typically": the model must always trust what is actually printed on the page.
   The ids match the planner choices in the app's photo dialog (index.html #uploadPlanner). */
export const PLANNERS = {
  fullfocus: { label: 'Full Focus Planner', hint: 'Daily pages typically have a "Daily Big 3" (three priority lines with checkboxes), an hourly schedule, a task list and notes. Weekly pages have a Weekly Big 3 and a weekly preview. Quarterly pages have roles, annual goals and 90-day goals.' },
  panda: { label: 'Panda Planner', hint: 'Daily pages typically have gratitude lines, "Daily Greatness" or top three priorities, an hourly schedule, a to-do list with checkboxes, and a short reflection. Weekly pages have weekly priorities and a day-by-day plan.' },
  passion: { label: 'Passion Planner', hint: 'Weekly spreads typically show Monday to Sunday columns with an hourly grid down the side, plus a weekly focus, "good things that happened" and a to-do list. Monthly pages have a calendar grid and monthly goals.' },
  daydesigner: { label: 'Day Designer', hint: 'Daily pages typically have "Top 3 priorities", an hourly schedule on the left (times printed in the margin), a to-do list with checkboxes on the right, and notes or gratitude at the bottom.' },
  franklin: { label: 'Franklin Covey', hint: 'Daily pages typically have a prioritized daily task list where each task has a code like A1, A2, B1, C3 (letter = importance, number = order) with a status mark, an appointment schedule with times down the side, and a daily record of events.' },
  bujo: { label: 'Bullet Journal (rapid logging)', hint: 'Free-form pages of short lines, each starting with a symbol: • task, × done, > migrated forward, < scheduled, ○ event, – note, * priority, ! inspiration. Dates appear as headings (a day, a week or a month log). A future log may list months with events.' },
  happyplanner: { label: 'Happy Planner', hint: 'Weekly layouts are usually vertical: seven day columns, often split into morning, afternoon and evening boxes, with checkbox lists and a notes area. Monthly layouts are a calendar grid with a notes column.' },
  erincondren: { label: 'Erin Condren LifePlanner', hint: 'Weekly layouts are usually vertical: seven day columns split into morning, afternoon and evening, with checkboxes and a notes or to-do column. Monthly layouts are a calendar grid.' },
  moleskine: { label: 'Moleskine / Leuchtturm1917 / weekly diary', hint: 'Plain diaries: a week on one or two pages, each day a lined block with a date heading, handwritten appointments and tasks with little structure. Monthly pages are a calendar grid.' },
  hobonichi: { label: 'Hobonichi Techo', hint: 'One day per page, often with a vertical time axis down the left margin (a narrow hour scale) beside free-form handwriting, small drawings and notes. Treat timed entries on the axis as the schedule and the rest as notes or tasks.' },
  cultivate: { label: 'Cultivate What Matters (Powersheets)', hint: 'Goal-setting pages: a goal title, why it matters, and numbered steps or monthly actions; also weekly priorities and a monthly review. Treat goals with their steps as goals and tasks.' },
  simplified: { label: 'Simplified Planner / Ink+Volt / Clever Fox', hint: 'Weekly or daily layouts with a priorities box, a checkbox to-do list, a time-blocked schedule and notes. Treat boxes titled priorities or top tasks as priorities.' },
  other: { label: 'Another planner or notebook', hint: '' },
};
export const plannerHint = (id) => (PLANNERS[id] && PLANNERS[id].hint ? `The writer says this is a ${PLANNERS[id].label}. ${PLANNERS[id].hint}` : '');
