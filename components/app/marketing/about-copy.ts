/**
 * The About page's copy (t-63): why HowDoesThisLand exists and where the idea
 * comes from, the lineage the prototype's `AboutView` told.
 *
 * It describes what makes a message land, not the model's current shape:
 * nothing here counts or names the model's parts, so a new version of the
 * model never leaves this page wrong. The classical appeals appear as an
 * older layer underneath, which is how the product uses them, not as the
 * product itself. `/model` is where the model's own detail lives.
 *
 * Written to the model's own standards: the point early, one idea per
 * paragraph, sentences under thirty words, claims sourced, limits admitted,
 * one call to act. Words follow app-plan §4, "The words we use".
 */

export const ABOUT_COPY = {
  slug: 'About',
  h1: 'How does this land?',
  sub: 'It’s the question worth asking before you press send. HowDoesThisLand helps you answer it honestly, from your reader’s side of the page.',

  storyH: 'You can hear the tune. Your reader can’t.',
  story:
    'In 1990, Elizabeth Newton, a psychology student at Stanford, asked people to tap out the rhythm of a well-known song while a listener tried to name it. The tappers expected half their listeners to get it. Of 120 songs, listeners named three.',
  story2:
    'The tappers could hear the melody in their heads as they tapped. The listeners heard knuckles on a table. Writing works the same way: you read your draft with everything you meant still in mind, and your reader gets only the words.',

  perceiveH: 'Every reader reads a different message.',
  perceive:
    'Nobody reads from nowhere. Each of us brings our own history, worries, expertise and mood to a page, and they change what the words mean. A sceptical finance director and a hopeful founder can read the same paragraph and reach opposite conclusions.',
  bias: 'Some of that gap is bias, and none of us is immune. Psychologists call the tapper’s problem the curse of knowledge: once you know something, it is hard to imagine not knowing it. We also read what we want to be true (Kunda, 1990), and push back when we sense we are being sold to (Friestad and Wright, 1994). Writers are readers too, which is why our own drafts are the hardest to judge.',
  unknowable:
    'So here is the honest part. You can never know for certain how a message will be received. Not even your reader knows until they read it. What you can do is cut down the guesswork.',

  helpH: 'A reader before your reader.',
  help: 'HowDoesThisLand gives your copy to a panel of AI reviewers, each reading it as your reader might, through a different lens. They mark the lines that would win that reader over and the ones that would lose them, say why, and suggest what to say instead.',
  help2:
    'It can’t read minds. What it can do is find the gaps you can’t see because you already know what you meant. Close them, and your reader no longer has to work out what you are saying. They can spend their attention on deciding.',

  qualitiesH: 'What makes a message land',
  qualitiesLead:
    'Behind every score is a plain view of what good persuasive writing does for the person reading it.',
  qualities: [
    {
      name: 'Clarity',
      body: 'The point is plain on the first reading, with no second pass needed.',
    },
    { name: 'Simplicity', body: 'Every word earns its place, so the reader has less to carry.' },
    {
      name: 'Cohesion',
      body: 'Each part follows from the one before, and the whole adds up to one idea.',
    },
    {
      name: 'Sincerity',
      body: 'It says what the writer believes, in their own voice, not in the formula everyone has learned to skim.',
    },
    {
      name: 'Integrity',
      body: 'Claims the writer can stand behind, limits admitted, and nothing manufactured: no false urgency, no borrowed proof.',
    },
    {
      name: 'Elegance',
      body: 'The form fits the thought. Copy that is easy to read is easier to believe, so care with the shape is care for the reader.',
    },
    {
      name: 'Intrigue',
      body: 'A reason to keep reading: a question opened, a surprise, a detail that doesn’t fit yet.',
    },
    {
      name: 'Storytelling',
      body: 'A story the reader can see themselves in, carrying the argument rather than decorating it.',
    },
    {
      name: 'Meaning',
      body: 'It matters to this reader, for their reasons, not only to the writer.',
    },
    {
      name: 'Sensemaking',
      body: 'It helps the reader understand their own situation: what is happening, why, and what follows from it.',
    },
    {
      name: 'A clear call to action',
      body: 'One next step, sized to the trust the piece has earned, with the decision left to the reader.',
    },
  ],

  layerH: 'An older layer underneath.',
  layer:
    'Beneath all of this sits rhetoric about 2,400 years old. Aristotle named three ways a speech persuades: the character of the speaker, the feelings of the audience and the argument itself. The Greeks added kairos, the right moment.',
  appeals: [
    { name: 'Ethos', greek: 'ἦθος', question: 'Why should I believe you?' },
    { name: 'Pathos', greek: 'πάθος', question: 'Why should I care?' },
    { name: 'Logos', greek: 'λόγος', question: 'Why is it true?' },
    { name: 'Kairos', greek: 'καιρός', question: 'Why now?' },
  ],
  layer2:
    'We use them the way a good editor does: not as boxes to tick, but as a dependable way to notice what a piece is missing. Each one is tested against modern research, from Cialdini and Kahneman to the Heath brothers, and kept only where it still holds.',

  trustH: 'Persuasion that earns trust.',
  trust:
    'The Greeks had a goddess of persuasion, Peitho, and in Greek the word for persuasion sits close to the word for trust, pistis. Winning someone over meant goodwill, not force. HowDoesThisLand holds to that standard. It rewards copy that earns agreement, marks down copy that tries to take it, and leaves every decision with the reader.',
  limits:
    'It has limits, and says so. It can’t tell whether your facts are true. Changes to wording usually make modest differences (O’Keefe and Hoeken, 2021): who you are, what you offer and whether your reader trusts you matter more. Treat a score as a well-informed second opinion, not a forecast.',

  sourcesH: 'Where these ideas come from',
  sourcesLead: 'Open any of them for who, what and why it matters.',
  /** Ids in `lib/app/explainer/sources.ts`, in the order the page draws on them. */
  sources: [
    'newton-1990',
    'camerer-1989',
    'kunda-1990',
    'friestad-wright-1994',
    'aristotle-rhetoric',
    'kairos',
    'cialdini-influence',
    'kahneman-2011',
    'heath-made-to-stick',
    'peitho',
    'okeefe-hoeken-2021',
  ],

  ctaH: 'See how your next message lands.',
  cta: 'Have a free review code? Use it on a message that matters, and read it from your reader’s side before you send it.',
  modelLink: 'How a review works: the model in plain words',
} as const;
