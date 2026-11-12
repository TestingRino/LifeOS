/* Life.OS — the suggestion library: who you might be (personas) and the roles, goals and habits we suggest.
   Pure data plus a one-time normalisation. Usable in the browser and in Node tests. */
(function (root) {
  'use strict';
  const P = typeof module !== 'undefined' && module.exports ? require('./plan.js') : root.LifePlan;

  const PERSONAS = [
    { id: 'student', label: 'I\'m a student', sub: 'school, college or training', purpose: 'To learn deeply, finish what I start and become who I want to be.' },
    { id: 'parent', label: 'I\'m a parent', sub: 'raising kids at home', purpose: 'To raise kids who feel loved, capable and known.' },
    { id: 'partner', label: 'I\'m married or partnered', sub: 'a relationship to nurture', purpose: 'To keep choosing my partner and build a strong home together.' },
    { id: 'work', label: 'I work full-time', sub: 'a job or career', purpose: 'To do work I am proud of and still have energy for the people I love.' },
    { id: 'business', label: 'I run a business', sub: 'owner, founder or freelancer', purpose: 'To build something that serves people well and gives me room to live.' },
    { id: 'caregiver', label: 'I\'m caring for a family member', sub: 'aging parent, partner or child with needs', purpose: 'To care well for those who need me without losing myself.' },
    { id: 'retired', label: 'I\'m retired or semi-retired', sub: 'time to shape on my terms', purpose: 'To spend this season on people, purpose and joy.' },
    { id: 'health', label: 'I want to get healthier', sub: 'fitness, sleep, energy', purpose: 'To have the health and energy to show up fully for my life.' },
    { id: 'faith', label: 'Faith is central to my life', sub: 'prayer, worship, service', purpose: 'To grow in faith and let it shape how I love and serve.' },
    { id: 'creative', label: 'I make things', sub: 'writing, art, music, projects', purpose: 'To make things worth sharing and finish what I begin.' },
  ];
  const G = (f, role, area, title, why, steps, x) => Object.assign({ title, steps, role, area, why, for: f }, x || {});
  const H = (f, role, area, title, perWeek, x) => Object.assign({ title, perWeek, role, area, for: f }, x || {});
  const SUGGEST = {
    roles: [
      { name: 'Parent', why: 'Be present and intentional with my kids while they are young.', for: ['parent'] },
      { name: 'Partner', why: 'Build a strong, loving relationship.', for: ['partner'] },
      { name: 'Professional', why: 'Grow in skill and contribute work I am proud of.', for: ['work'] },
      { name: 'Healthy person', why: 'Energy and health let me show up well for everything else.', for: ['health', 'retired'] },
      { name: 'Friend', why: 'Community is built by showing up.', for: [] },
      { name: 'Learner', why: 'Stay curious and keep growing.', for: ['student', 'retired'] },
      { name: 'Family', why: 'Show up for the people who made me.', for: ['caregiver'] },
      { name: 'Student', why: 'These years shape the options I will have for decades.', for: ['student'] },
      { name: 'Business owner', why: 'Build something that serves customers and sustains my family.', for: ['business'] },
      { name: 'Leader', why: 'Help the people around me do their best work.', for: ['work', 'business'] },
      { name: 'Caregiver', why: 'Love shown through steady, patient care.', for: ['caregiver'] },
      { name: 'Household manager', why: 'A well-run home gives everyone room to breathe.', for: ['parent', 'partner', 'retired'] },
      { name: 'Retiree', why: 'Shape this season of life on purpose, not by default.', for: ['retired'] },
      { name: 'Grandparent', why: 'Be the steady, delighted presence I wish every child had.', for: ['retired'] },
      { name: 'Community member', why: 'The place I live is better when I show up for it.', for: ['retired', 'faith', 'parent'] },
      { name: 'Person of faith', why: 'My faith is the root that everything else grows from.', for: ['faith'] },
      { name: 'Creator', why: 'Making things is how I understand the world and share it.', for: ['creative'] },
      { name: 'Money steward', why: 'Calm finances protect the people and plans I care about.', for: [] },
    ],
    goals: [
      // everyone
      G([], 'Family', 'friends', 'Build a closer relationship with Dad', 'He will not always be a phone call away.', ['Pick a regular call day and time', 'Plan a weekend visit'], { routine: { text: 'Call Dad', perWeek: 1 } }),
      G([], 'Friend', 'friends', 'Reconnect with a close friend', 'Friendships fade unless I tend them.', ['Text a friend to set a coffee', 'Send a birthday card']),
      G([], 'Money steward', 'home', 'Save a three-month emergency fund', 'Financial peace of mind for the people I love.', ['Total up three months of expenses', 'Open a dedicated savings account', 'Set up an automatic transfer']),
      G([], 'Money steward', 'home', 'Create a monthly budget and stick to it', 'Money goes where I decide, not where it drifts.', ['Track spending for one month', 'Set a number for each category', 'Review it on the first of each month']),
      G([], 'Money steward', 'home', 'Pay off a debt', 'Every payment buys back future freedom.', ['List every debt with its rate', 'Pick the one to attack first', 'Automate the extra payment']),
      G([], 'Household manager', 'home', 'Declutter and organize the house', 'A calm home makes room for what matters.', ['Pick the first room to tackle', 'Donate or toss one full box', 'Finish the second room']),
      G([], 'Learner', 'projects', 'Finish a hobby project I keep putting off', 'Finishing it frees mental space.', ['List what is left to do', 'Gather the supplies', 'Finish the next piece']),
      G([], 'Friend', 'friends', 'Host friends or family for a gathering', 'Strong friendships take intention.', ['Pick a date and guest list', 'Send invitations', 'Plan the menu']),
      G([], 'Learner', 'projects', 'Read twelve books this year', 'Reading keeps me learning and curious.', ['Pick the next three books', 'Set a reading goal per month', 'Finish book one']),
      G([], 'Learner', 'fun', 'Try something new every month', 'A life of new things stays vivid.', ['List twelve things I have never tried', 'Put the first one on the calendar', 'Invite someone along']),
      G([], 'Learner', 'projects', 'Learn a new language', 'It opens people, places and a sharper mind.', ['Pick an app or class', 'Set a daily ten-minute slot', 'Have a first conversation']),
      G([], 'Friend', 'friends', 'Make a new friend or join a community', 'Belonging does not happen by accident.', ['List three groups or classes nearby', 'Go to one this month', 'Invite someone for coffee']),
      G([], 'Healthy person', 'health', 'Get a full health checkup', 'Small problems are cheap to fix early.', ['Book physical, dental and eye exams', 'Get bloodwork done', 'Write down my questions']),
      G([], 'Learner', 'home', 'Do a digital declutter', 'Less noise on my phone gives me back attention.', ['Unsubscribe from fifteen lists', 'Delete unused apps', 'Set up a simple photo backup']),
      // student
      G(['student'], 'Student', 'work', 'Finish this term strong', 'The habits I build now carry into the career I want.', ['List every assignment and exam date', 'Block weekly study time on the calendar', 'Meet each teacher or professor once', 'Finish with my target grades']),
      G(['student'], 'Student', 'work', 'Build a study system that works', 'Studying smarter beats studying longer.', ['Choose a regular study spot', 'Try a weekly review of my notes', 'Make flashcards for the hardest subject']),
      G(['student'], 'Student', 'work', 'Land an internship or first job', 'Real experience turns learning into options.', ['Update my resume', 'Apply to five places', 'Practice an interview with a friend', 'Follow up on every application']),
      G(['student'], 'Student', 'work', 'Graduate on time', 'Finishing on schedule saves money and momentum.', ['Meet with my advisor', 'Map every remaining requirement', 'Register for next term']),
      G(['student'], 'Money steward', 'home', 'Live on a student budget without stress', 'Staying out of debt keeps my choices open.', ['Track spending for one month', 'Set a weekly spending limit', 'Open a savings account']),
      G(['student'], 'Friend', 'friends', 'Join a club or team', 'Friends and mentors are half of what school gives.', ['List three clubs that interest me', 'Go to one meeting', 'Take on a small role']),
      // parent
      G(['parent'], 'Parent', 'home', 'One-on-one time with each kid', 'They will remember the time, not the stuff.', ['Pick an activity for each child', 'Put it on the calendar'], { routine: { text: 'Bedtime talk with one child', perWeek: 3 } }),
      G(['parent'], 'Parent', 'fun', 'Take a family trip together', 'Shared experiences become the stories we tell for years.', ['Pick the destination and dates', 'Set the trip budget', 'Book travel and lodging', 'Plan activities with the kids'], { purpose: true }),
      G(['parent'], 'Parent', 'home', 'Teach one new skill a month to the kids', 'Mentor my children to be better versions of themselves.', ['Pick a skill for the month', 'Schedule the lesson on a weekend', 'Review what they learned']),
      G(['parent'], 'Parent', 'fun', 'Start a weekly family night', 'A predictable time together builds belonging.', ['Pick the night', 'Let the kids list ideas', 'Hold the first one']),
      G(['parent'], 'Parent', 'home', 'Calm the family mornings', 'A better start sets the tone for the whole day.', ['Name the three things that cause chaos', 'Prepare bags and clothes the night before', 'Try the new routine for two weeks']),
      G(['parent'], 'Money steward', 'home', 'Start saving for the kids\' future', 'A little each month grows into real options.', ['Open an education or savings account', 'Set an automatic monthly deposit', 'Review it each quarter']),
      G(['parent'], 'Parent', 'fun', 'Make a family photo book', 'These years pass quickly and the photos get buried.', ['Gather this year\'s photos', 'Pick the best fifty', 'Order the book']),
      // partner
      G(['partner'], 'Partner', 'friends', 'Deepen my marriage', 'Our kids learn love by watching ours.', ['Plan a monthly date night', 'Book a weekend away'], { routine: { text: 'Daily check-in with my spouse', perWeek: 7 } }),
      G(['partner'], 'Partner', 'friends', 'Plan a weekend away with my spouse', 'Our relationship deserves focused time together.', ['Pick dates that work for both of us', 'Arrange childcare', 'Book the getaway']),
      G(['partner'], 'Partner', 'home', 'Get on the same page about money', 'Shared goals ease the biggest source of conflict.', ['Pick a monthly money-talk date', 'List our shared goals', 'Set up a shared budget']),
      G(['partner'], 'Partner', 'fun', 'Take up a hobby together', 'Doing something new side by side keeps us curious about each other.', ['Brainstorm five ideas each', 'Try one together', 'Put a regular time on the calendar']),
      // work
      G(['work'], 'Professional', 'work', 'Complete one skill-building course', 'Investing in skills opens the next opportunity.', ['Choose the course', 'Block weekly study time on the calendar', 'Finish half the lessons', 'Finish the final project']),
      G(['work'], 'Professional', 'work', 'Earn a promotion or a bigger role', 'I want my work to grow along with me.', ['Ask my manager what great looks like', 'Pick one visible project', 'Share progress every month']),
      G(['work'], 'Professional', 'work', 'Protect two hours of deep work every day', 'My best work happens without interruptions.', ['Pick the hours that suit me best', 'Block them on my calendar', 'Mute notifications during them']),
      G(['work'], 'Professional', 'work', 'Build my professional network', 'Opportunities come through people.', ['List ten people to reconnect with', 'Send three coffee invitations', 'Attend one industry event']),
      G(['work', 'student'], 'Professional', 'work', 'Find a mentor', 'Someone further down the road saves me years.', ['List three people I admire', 'Ask one for a conversation', 'Agree on a regular check-in']),
      G(['work', 'business'], 'Professional', 'work', 'Set a work-life boundary', 'Rest is what makes the work sustainable.', ['Choose a hard stop time', 'Silence work notifications after hours', 'Plan something I look forward to after work']),
      G(['work', 'business'], 'Money steward', 'home', 'Grow my retirement savings', 'Future me will thank present me.', ['Check what my employer offers', 'Raise my contribution by one percent', 'Review my investments once a year']),
      G(['work', 'business'], 'Leader', 'work', 'Become a better leader for my team', 'People remember how I made them feel.', ['Ask for honest feedback', 'Start weekly one-on-ones', 'Recognize one person\'s work each week']),
      // business
      G(['business'], 'Business owner', 'work', 'Hit my revenue goal this year', 'A clear number keeps every week pointed the right way.', ['Write the number down', 'Review the numbers every Friday', 'Find the one thing that moves it most']),
      G(['business'], 'Business owner', 'work', 'Systemize one process in my business', 'Checklists give me my time back.', ['Pick the task that eats the most time', 'Write it as a checklist', 'Hand it off or automate it']),
      G(['business'], 'Business owner', 'work', 'Build a steady marketing rhythm', 'Consistency beats bursts of effort.', ['Choose one channel', 'Schedule weekly posts or outreach', 'Track what brings customers']),
      G(['business'], 'Business owner', 'work', 'Delegate or hire one role', 'I cannot be the bottleneck forever.', ['Write down what the role does', 'Post it or ask for referrals', 'Interview and decide']),
      G(['business'], 'Money steward', 'home', 'Set aside taxes and pay myself on schedule', 'Surprises are expensive and stressful.', ['Open a tax savings account', 'Move a percentage with every payment', 'Meet my accountant each quarter']),
      G(['business'], 'Business owner', 'fun', 'Take a real vacation from the business', 'Rest is part of building something that lasts.', ['Pick the dates', 'Write the hand-off notes', 'Go, and stay offline']),
      // caregiver
      G(['caregiver'], 'Caregiver', 'home', 'Build a care team so I am not alone', 'Sharing the load makes care sustainable.', ['List who could help and with what', 'Ask one person for one specific favor', 'Set up a shared care calendar']),
      G(['caregiver'], 'Caregiver', 'home', 'Organize medical information and appointments', 'Calm paperwork means calm visits.', ['Put medications and contacts in one folder', 'Put every appointment on the calendar', 'Keep a short log of changes']),
      G(['caregiver'], 'Caregiver', 'health', 'Protect my own health while I care', 'I can only pour from a full cup.', ['Book my own checkup', 'Schedule a weekly break', 'Say yes the next time someone offers help']),
      G(['caregiver'], 'Caregiver', 'health', 'Arrange regular respite care', 'Rest keeps me patient and well.', ['Research respite or day programs', 'Pick a recurring day', 'Use it without guilt']),
      G(['caregiver', 'retired'], 'Family', 'home', 'Get the legal and financial paperwork in order', 'Clear plans spare the family hard choices later.', ['Locate wills and powers of attorney', 'Meet with an elder-law or estate advisor', 'Store copies where family can find them']),
      G(['caregiver', 'retired', 'parent'], 'Family', 'friends', 'Capture family stories', 'These stories live only as long as someone writes them down.', ['Choose one question to ask each visit', 'Record or write the answers', 'Share them with the family']),
      // retired
      G(['retired'], 'Grandparent', 'friends', 'Be a regular presence for my grandchildren', 'These are the memories they will keep.', ['Pick a weekly call or visit', 'Plan one activity with each grandchild', 'Write each a letter'], { routine: { text: 'Call or video-chat a grandchild', perWeek: 2 } }),
      G(['retired'], 'Retiree', 'fun', 'Take the trip that has been on my list', 'I have the time now. I should use it.', ['Choose the place', 'Set a budget and dates', 'Book it']),
      G(['retired', 'faith', 'student'], 'Community member', 'friends', 'Volunteer for a cause I care about', 'Giving my time is how I belong.', ['List three causes I care about', 'Visit one organization', 'Commit to a regular shift']),
      G(['retired'], 'Retiree', 'home', 'Simplify and downsize', 'Fewer things means more freedom.', ['Walk through one room at a time', 'Decide keep, give, sell or toss', 'Hold the first donation drop-off']),
      G(['retired'], 'Healthy person', 'health', 'Stay strong, active and independent', 'Mobility and balance protect my freedom.', ['Book a checkup', 'Pick a gentle activity I enjoy', 'Add strength work twice a week']),
      G(['retired', 'creative'], 'Creator', 'projects', 'Write my life story', 'My family will treasure it.', ['Outline the chapters', 'Write one page a day for a week', 'Share a chapter with family']),
      G(['retired'], 'Money steward', 'home', 'Review my income plan and my legacy', 'Clarity lets me spend and give with confidence.', ['Gather statements in one place', 'Meet with an advisor', 'Update beneficiaries']),
      // health
      G(['health'], 'Healthy person', 'health', 'Run a 10K', 'Proving I can build a hard thing step by step.', ['Run 5K without stopping', 'Register for a 10K race', 'Run 8K', 'Finish the 10K']),
      G(['health'], 'Healthy person', 'health', 'Reach a healthy weight', 'Feeling good in my body changes how I show up.', ['Set a realistic target with my doctor', 'Plan meals for the week', 'Weigh in once a week']),
      G(['health'], 'Healthy person', 'health', 'Build real strength', 'Strength carries over into everything.', ['Pick a three-day plan', 'Learn the basic lifts', 'Log every session']),
      G(['health'], 'Healthy person', 'health', 'Sleep seven hours most nights', 'Sleep makes everything else easier.', ['Choose a bedtime', 'Move screens out of the bedroom', 'Track sleep for two weeks']),
      G(['health', 'parent', 'student'], 'Healthy person', 'home', 'Cook at home most nights', 'Home cooking is better for my body and my budget.', ['Pick five go-to recipes', 'Make a weekly meal plan', 'Stock the pantry']),
      // faith
      G(['faith'], 'Person of faith', 'projects', 'Read through my scripture this year', 'I want to know it, not just know about it.', ['Choose a reading plan', 'Pick a daily time', 'Finish the first book']),
      G(['faith'], 'Person of faith', 'health', 'Deepen my prayer life', 'It is how I stay rooted.', ['Choose a time and place', 'Keep a short prayer journal', 'Find a prayer partner']),
      G(['faith'], 'Person of faith', 'friends', 'Join or lead a small group', 'Faith grows best in community.', ['Find a group that fits my schedule', 'Attend the first meeting', 'Offer to host once']),
      G(['faith'], 'Person of faith', 'home', 'Set up a regular giving plan', 'Generosity loosens money\'s hold on me.', ['Decide on a giving percentage', 'Pick where it goes', 'Automate it']),
      // creative
      G(['creative'], 'Creator', 'projects', 'Finish a creative project', 'A finished piece teaches more than ten started ones.', ['Define what finished means', 'Break it into sessions', 'Share it with one person']),
      G(['creative'], 'Creator', 'projects', 'Write a book or series of essays', 'I have something to say.', ['Outline it', 'Write 500 words a day for a week', 'Edit the first chapter']),
      G(['creative'], 'Creator', 'projects', 'Learn an instrument', 'Music is a joy I can keep for life.', ['Pick the instrument and a teacher or course', 'Practice fifteen minutes a day', 'Play one full song']),
      G(['creative'], 'Creator', 'work', 'Share my work publicly', 'Work becomes real when someone sees it.', ['Choose where to share', 'Publish the first piece', 'Ask for feedback']),
      G(['creative'], 'Creator', 'projects', 'Make something every day for thirty days', 'Showing up beats waiting for inspiration.', ['Pick the medium', 'Set a daily time', 'Keep a simple log']),
    ],
    habits: [
      H([], 'Healthy person', 'health', 'Workout', 5, { purpose: true }),
      H([], 'Learner', 'projects', 'Read a book', 7),
      H([], 'Healthy person', 'health', 'Quiet time or prayer', 7),
      H([], 'Learner', 'projects', 'Journal', 5),
      H([], 'Healthy person', 'health', 'Walk or move outdoors', 5),
      H([], 'Healthy person', 'health', 'In bed on time', 7),
      H([], 'Healthy person', 'health', 'Drink enough water', 7),
      H([], 'Learner', 'projects', 'Write three things I am grateful for', 7),
      H([], 'Friend', 'friends', 'Call or text a friend or family member', 3),
      H([], 'Healthy person', 'health', 'Limit screens before bed', 7),
      H(['parent'], 'Parent', 'home', 'Read to the kids before bed', 7, { purpose: true }),
      H(['parent'], 'Parent', 'fun', 'Spend time outside with the kids', 7),
      H(['parent'], 'Parent', 'home', 'Eat dinner together', 5),
      H(['parent', 'partner', 'retired'], 'Household manager', 'home', 'Ten-minute tidy', 7),
      H(['partner'], 'Partner', 'friends', 'Date night with my spouse', 1),
      H(['partner'], 'Partner', 'friends', 'Walk and talk with my spouse', 3),
      H(['student'], 'Student', 'work', 'Study session', 5, { purpose: true }),
      H(['student'], 'Student', 'work', 'Review notes after class', 4),
      H(['student', 'work', 'business'], 'Professional', 'work', 'Plan tomorrow tonight', 5),
      H(['work', 'business', 'creative'], 'Professional', 'work', 'Deep work block', 5),
      H(['business'], 'Business owner', 'work', 'Reach out to a customer or lead', 5),
      H(['business'], 'Business owner', 'work', 'Review the numbers', 1),
      H(['caregiver'], 'Caregiver', 'friends', 'Check in on my loved one', 7, { purpose: true }),
      H(['caregiver'], 'Caregiver', 'health', 'Take a break just for me', 4),
      H(['retired'], 'Retiree', 'health', 'Morning walk', 7),
      H(['retired'], 'Grandparent', 'friends', 'Call a grandchild', 2),
      H(['retired', 'student'], 'Learner', 'projects', 'Language practice', 5),
      H(['health'], 'Healthy person', 'health', 'Strength training', 3, { purpose: true }),
      H(['health'], 'Healthy person', 'health', 'Stretch or mobility', 4),
      H(['health'], 'Healthy person', 'health', 'Prep meals for the week', 1),
      H(['faith'], 'Person of faith', 'health', 'Read scripture', 7, { purpose: true }),
      H(['faith'], 'Person of faith', 'friends', 'Worship or community gathering', 1),
      H(['creative'], 'Creator', 'projects', 'Make something', 5, { purpose: true }),
      H(['creative'], 'Creator', 'projects', 'Practice my instrument or craft', 5),
    ],
    ideal: [
      { text: 'Workout', time: '06:30', workout: true }, { text: 'Family night', time: '18:00' }, { text: 'Date night', time: '19:00' },
      { text: 'Activities', time: '16:00' }, { text: 'Community impact', time: '17:30' }, { text: 'Home & car maintenance', time: '17:30' },
      { text: 'Plan next week', time: '15:00' }, { text: 'Deep work', time: '09:00' },
    ],
    starterWeek: { 1: ['Workout', 'Home & car maintenance'], 2: ['Workout', 'Family night'], 3: ['Workout', 'Activities'], 4: ['Workout', 'Community impact'], 5: ['Workout', 'Plan next week'] },
  };


  const AREA_FIX = { 'Finish a hobby project I keep putting off': 'personal', 'Host friends or family for a gathering': 'personal', 'Make a new friend or join a community': 'personal', 'Take up a hobby together': 'personal', 'Call or text a friend or family member': 'personal', 'Protect my own health while I care': 'mental', 'Take the trip that has been on my list': 'personal' };
  [...SUGGEST.goals, ...SUGGEST.habits].forEach((x) => { x.area = AREA_FIX[x.title] || P.lifeArea(x.area, x.role, x.title, true); });


  /* ---------- fill in a goal for someone: first steps and a reason, from its words and its life area ---------- */
  const STEP_RULES = [
    [/\b(run|marathon|5k|10k|half marathon|jog|swim|bike|cycle|triathlon|walk)\b/i, ['Pick a training plan and a start date', 'Complete the first full week of sessions', 'Reach the halfway distance', 'Finish the event or hit the target']],
    [/\b(lose|weight|strength|lift|gym|workout|exercise|fitness|healthy|sleep)\b/i, ['Pick a simple weekly plan you can keep', 'Do it three times in the first two weeks', 'Review how it feels and adjust', 'Keep it going for a full month']],
    [/\b(save|saving|budget|debt|invest|retire|retirement|emergency fund|tax|taxes|net worth)\b/i, ['Write down where things stand today', 'Set the target number and the date', 'Automate the first transfer or payment', 'Review progress on the first of each month']],
    [/\b(learn|course|study|class|language|degree|certificate|certification|exam|lesson|skill)\b/i, ['Choose the course or resource', 'Block weekly study time on the calendar', 'Finish the first third', 'Finish and use it on something real']],
    [/\b(write|writing|book|novel|blog|essay|article|podcast|video|album|paint|draw|art|song|music|instrument)\b/i, ['Define what finished looks like', 'Outline the main pieces', 'Make the first piece', 'Share it with one person']],
    [/\b(trip|travel|vacation|holiday|getaway|weekend away)\b/i, ['Pick the destination and dates', 'Set the budget', 'Book travel and lodging', 'Plan what to do there']],
    [/\b(declutter|organi[sz]e|clean|garage|closet|house|home|garden|repair|renovat|move|paperwork)\b/i, ['Pick the first space or job to tackle', 'Set aside one block of time for it', 'Finish the first space and note the result', 'Do the next one']],
    [/\b(launch|business|customer|client|sales|marketing|revenue|startup|product|promotion|raise|interview|resume|job|career|network)\b/i, ['Write down the one result that counts', 'List the three actions that move it most', 'Do the first action this week', 'Check results in a month and adjust']],
    [/\b(call|visit|reconnect|friend|friends|mom|dad|mother|father|sister|brother|grandparent|grandchild|relationship|marriage|spouse|date night|kids?|child|children|family)\b/i, ['Decide who and how often', 'Put the first one on the calendar', 'Do it, then note how it went', 'Make it a regular rhythm']],
    [/\b(pray|prayer|scripture|bible|church|worship|faith|meditat|gratitude|volunteer|serve|give|donate)\b/i, ['Choose a time and place that works', 'Do it every day for one week', 'Find someone to do it with or tell', 'Review what it is changing']],
  ];
  const AREA_STEPS = {
    career: ['Write down what success looks like', 'List the three actions that move it most', 'Do the first action this week', 'Review in a month'],
    finances: ['Write down where things stand today', 'Set a target and a date', 'Automate the first step', 'Review monthly'],
    family: ['Decide what would make a difference', 'Put the first time on the calendar', 'Do it, then note how it went', 'Make it a rhythm'],
    faith: ['Choose a time and place', 'Do it daily for a week', 'Add one person to share it with', 'Review what it is changing'],
    fitness: ['Pick a simple plan you can keep', 'Do the first week', 'Check how it feels and adjust', 'Keep going for a month'],
    mental: ['Name what drains and what restores you', 'Schedule one restorative block this week', 'Notice the difference', 'Keep what helps'],
    learning: ['Choose what to learn and how', 'Block weekly time for it', 'Finish the first part', 'Use it on something real'],
    community: ['Pick the cause or group', 'Make the first contact', 'Show up the first time', 'Set a regular commitment'],
    personal: ['Decide what done looks like', 'Gather what you need', 'Do the first piece', 'Finish and enjoy it'],
    home: ['Pick the first thing to tackle', 'Set aside a block of time', 'Finish it and note the result', 'Do the next one'],
  };
  const AREA_WHY = {
    career: 'Work I am proud of is how I provide and grow.', finances: 'Calm finances protect the people and plans I care about.', family: 'The people closest to me are what matter most.',
    faith: 'My faith is the root everything else grows from.', fitness: 'Energy and health let me show up well for everything else.', mental: 'Rest and peace of mind make everything else possible.',
    learning: 'Staying curious keeps me growing.', community: 'The place I live is better when I show up for it.', personal: 'Time for what I love keeps life full.', home: 'A well-kept home gives everyone room to breathe.',
  };
  /* First steps for a goal. The wording of the title wins; the life area is the fallback. */
  function suggestSteps(title, area, n) {
    const t = String(title || '');
    const hit = STEP_RULES.find(([re]) => re.test(t));
    const steps = hit ? hit[1] : (AREA_STEPS[area] || ['Define what "done" looks like', 'Break it into three steps', 'Schedule the first work block', 'Check progress in a month']);
    return steps.slice(0, n || 3);
  }
  const suggestWhy = (area) => AREA_WHY[area] || '';

  const api = { PERSONAS, SUGGEST, suggestSteps, suggestWhy, STEP_RULES, AREA_STEPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LifeLibrary = api;
})(typeof window !== 'undefined' ? window : globalThis);
