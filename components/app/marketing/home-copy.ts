/**
 * The landing page's copy (t-62), adapted from the prototype's `homeCopy`
 * (`prototype/src/App.jsx`), with what is now wrong corrected: the free offer
 * is a review unlocked by a code, never "free in 10 seconds" and never a
 * scan. The review is described as a panel of AI reviewers, never counted
 * or listed one by one, so the panel can change without the page going
 * stale (the owner's ruling, 2026-11-21).
 *
 * Words follow app-plan §4, "The words we use".
 */

export const HOME_COPY = {
  slug: 'Galley 01 · The art of changing minds',
  h1Lead: 'Find out why your words aren’t landing,',
  h1Turn: 'before your reader does.',
  sub: 'HowDoesThisLand reads your CV, pitch or proposal the way your reader will. A panel of AI reviewers scores its credibility, emotion, logic and timing, marks the lines that win your reader over and the ones that lose them, and helps you strengthen the case so your reader can say yes for their own reasons.',
  story:
    'It’s eleven at night, the deadline is tomorrow, and you’ve reread your proposal so many times you can’t tell if it’s any good.',
  story2:
    'You’re not alone: most people struggle to judge their own writing, because they already know what they meant. Psychologists call it the curse of knowledge, and it’s why a second reader helps. So paste it in, say who will read it, and see which lines would lose that reader and what to say instead, before you hit send.',
  compare:
    'Unlike a grammar checker, which tells you whether a sentence is correct, or a colleague, who tells you whether they like it, HowDoesThisLand tells you whether it will persuade the person you’re sending it to, and why.',
  nowH: 'Fluent writing is now free. Trust isn’t.',
  now: 'Since anyone can now produce polished copy in seconds, polish no longer persuades. Readers have learned to spot the formula, and research on persuasion knowledge (Friestad and Wright, 1994) shows that when people notice a tactic, they push back. What wins now is what was always hardest to fake: real evidence, honest limits and a clear reason to act.',
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
      body: 'Each reviewer reads it as that reader would, through a different lens, from credibility, emotion, logic and timing to purpose and craft. When a note is about a line, it quotes that line exactly, so you can check it.',
    },
    {
      title: 'Edit, then review again',
      body: 'The report marks up your copy, ranks what to change first and suggests better wording for each point, in your voice. Where a point needs a fact only you have, it leaves a gap for you to fill instead of making one up. Make your edits and review the next draft to see what changed.',
    },
  ],
  honestH: 'Built on evidence, and honest about its limits.',
  honest:
    'You might be wondering whether a score can capture something as human as persuasion. It can’t, entirely. Most message tweaks make a small difference, and some popular advice doesn’t replicate. That’s why every check in the model is marked by how strong the evidence behind it is, and why HowDoesThisLand saves its best scores for copy that earns them with real proof and honest limits. The model draws on thinkers from Aristotle and Cicero to Cialdini, Kahneman and Godin, and on published studies, each marked by how well it has held up. And it can’t tell whether your facts are true: that part is still yours.',
  good: 'But what if your writing is already good? Then HowDoesThisLand will say so, and show you why it works, so you can do it again.',
  who: 'Built for people who would rather earn a yes than polish their way to one: founders, consultants, job seekers and anyone with a pitch to make.',
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
  cta: 'When an important message misses, nobody writes back to say which paragraph lost them. You get a polite no, or silence. Have a free review code? Use it on the message that matters most this week, and make a case you’d be happy for your reader to examine.',
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
