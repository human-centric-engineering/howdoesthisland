/**
 * The landing page's copy (t-62), adapted from the prototype's `homeCopy`
 * (`prototype/src/App.jsx`), with what is now wrong corrected: the free offer
 * is a review unlocked by a code, never "free in 10 seconds" and never a
 * scan. The review is described as a panel of AI reviewers, never counted
 * or listed one by one, so the panel can change without the page going
 * stale (the owner's ruling, 2026-11-21).
 *
 * Kept apart from the page so the self-score reviews exactly the words the
 * page shows: {@link HOME_PAGE_TEXT} is built from these strings, not
 * written a second time. Words follow app-plan §4, "The words we use".
 */

export const HOME_COPY = {
  slug: 'Galley 01 · The art of changing minds',
  h1Lead: 'Find out why your words aren’t landing,',
  h1Turn: 'before your reader does.',
  sub: 'HowDoesThisLand reads your CV, pitch or proposal the way your reader will. A panel of AI reviewers scores its credibility, emotion, logic and timing, shows you where each one works, and helps you strengthen the case so your reader can say yes for their own reasons.',
  story:
    'It’s eleven at night, the deadline is tomorrow, and you’ve reread your proposal so many times you can’t tell if it’s any good.',
  story2:
    'You’re not alone: most people struggle to judge their own writing, because they already know what they meant. Psychologists call it the curse of knowledge, and it’s why a second reader helps.',
  compare:
    'Unlike a grammar checker, which tells you whether a sentence is correct, or a colleague, who tells you whether they like it, HowDoesThisLand tells you whether it will persuade the person you’re sending it to, and why.',
  nowH: 'Fluent writing is now free. Trust isn’t.',
  now: 'Since anyone can now produce polished copy in seconds, polish no longer persuades. Readers have learned to spot the formula, and research on persuasion knowledge shows that when people notice a tactic, they push back. What wins now is what was always hardest to fake: real evidence, honest limits and a clear reason to act. The only persuasion that still lands is the kind that holds up when your reader can see exactly how it works.',
  rootsH: 'Rooted in 2,400 years of rhetoric.',
  roots:
    'Aristotle named three ways to persuade: the speaker’s character, the audience’s feelings and the argument itself. The Greeks added kairos, the right moment. HowDoesThisLand keeps those four at its core, then tests each one against modern research, because an old idea earns its place only if it still works.',
  stepsH: 'How it works',
  steps: [
    {
      title: 'Paste, upload or link',
      body: 'Paste your copy, upload a Word file, PDF or slides, or give the address of a page. Say who will read it, because a sceptical CTO reads differently from a time-poor board.',
    },
    {
      title: 'A panel of AI reviewers reads it',
      body: 'Each reviewer reads through a different lens, from credibility, emotion, logic and timing to purpose, craft and the reader you have in mind. Every note quotes your copy, so you can check it.',
    },
    {
      title: 'Edit, then review again',
      body: 'The report marks up your copy, ranks what to change first and suggests better wording for each point, in your voice. It never invents a fact. Make your edits and review the next draft to see what changed.',
    },
  ],
  honestH: 'Built on evidence, and honest about its limits.',
  honest:
    'You might be wondering whether a score can capture something as human as persuasion. It can’t, entirely. Most message tweaks make a small difference, and some popular advice doesn’t replicate. That’s why every check in the model is marked by how strong the evidence behind it is, and why HowDoesThisLand saves its best scores for copy that earns them with real proof and honest limits. The model draws on thinkers from Aristotle and Cicero to Cialdini, Kahneman and Godin, and on published studies, each marked by how well it has held up.',
  good: 'But what if your writing is already good? Then HowDoesThisLand will say so, and show you why it works, so you can do it again.',
  who: 'Built for people who write things that matter: founders, consultants, job seekers and anyone with a pitch to make.',
  kinds: [
    'CVs and cover letters',
    'Landing pages',
    'Sales emails',
    'Proposals',
    'Board papers',
    'Pitch decks',
    'Fundraising appeals',
    'Speeches',
    'Change announcements',
  ],
  ctaH: 'Your next important message deserves a second reader.',
  cta: 'Every week you send important messages without a second reader, some of them miss. If you have a free review code, use it on the message that matters most this week. Make a case you’d be happy for them to examine.',
} as const;

/** The four appeals, as the model names them (`appeals` in model 0.5.1). */
export const HOME_APPEALS = [
  {
    id: 'ethos',
    name: 'Ethos',
    greek: 'ἦθος',
    question: 'Why should this audience believe this speaker?',
  },
  {
    id: 'pathos',
    name: 'Pathos',
    greek: 'πάθος',
    question: 'Why should this audience care, and feel moved to act?',
  },
  {
    id: 'logos',
    name: 'Logos',
    greek: 'λόγος',
    question: 'Why should this audience think it is true and makes sense?',
  },
  {
    id: 'kairos',
    name: 'Kairos',
    greek: 'καιρός',
    question: 'Why this, why now, and why should the audience act?',
  },
] as const;

export type HomeAppealId = (typeof HOME_APPEALS)[number]['id'];

/**
 * The page's own words, in reading order, as the self-score reviews them:
 * the headline, the body copy and the steps. Labels, buttons and the panel
 * the score sits in are left out, as the prototype left them out.
 */
export const HOME_PAGE_TEXT = [
  `${HOME_COPY.h1Lead} ${HOME_COPY.h1Turn}`,
  HOME_COPY.sub,
  `${HOME_COPY.story} ${HOME_COPY.story2}`,
  HOME_COPY.compare,
  HOME_COPY.nowH,
  HOME_COPY.now,
  HOME_COPY.rootsH,
  HOME_COPY.roots,
  ...HOME_COPY.steps.map((s) => `${s.title}. ${s.body}`),
  HOME_COPY.honestH,
  HOME_COPY.honest,
  HOME_COPY.good,
  HOME_COPY.who,
  HOME_COPY.ctaH,
  HOME_COPY.cta,
].join('\n\n');

/** Who the page is for, as the self-score reads it: a landing page, to a cold reader. */
export const HOME_CONTEXT = {
  contentType: 'landing_page',
  audience: { relationship: 'cold' },
} as const;
