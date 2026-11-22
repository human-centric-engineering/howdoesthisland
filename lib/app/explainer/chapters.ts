/**
 * The model, explained in human terms for the public pages (t-63).
 *
 * The model is HowDoesThisLand's IP (owner ruling, 2026-11-22): what makes it
 * work (rubrics, weights, formulas, caps, detection patterns, reviewer
 * instructions) is never published. This is a companion to it, written by
 * hand as copy: what a review looks for and why, in plain words, with where
 * each idea comes from. It is kept apart from the model so the model does
 * not grow to carry prose for the website.
 *
 * - **A pointer** on an entry names the model concept it explains (a kind and
 *   an id, or `section` and a top-level part). It is never shown. A test
 *   fails when the newest model file in the repo no longer has it, so a model
 *   change that leaves the explainer wrong fails in the PR that brings it.
 * - **Sources** are ids in `./sources.ts`, which gives each one context for
 *   someone meeting it for the first time.
 * - **Nothing counts the model's parts**, so a new version does not leave a
 *   page wrong; and nothing names a version.
 * - The culture review is left out while its switch is off in production
 *   (D11): its data is still being checked.
 *
 * Words follow app-plan §4, "The words we use". UK English. Sentences under
 * thirty words, the point first.
 */

export interface Pointer {
  /** A record kind (`dimension`, `red_flag`), or `section` for a top-level part of the model. */
  kind: string;
  id: string;
}

export interface Entry {
  id: string;
  title: string;
  /** A short term shown beside the title: the Greek or Latin word, or a reader's key question. */
  aside?: string;
  /** One line: the point of it. */
  summary: string;
  body: readonly string[];
  example?: { before: string; after: string };
  sources?: readonly string[];
  pointer?: Pointer;
}

export interface Group {
  id: string;
  title: string;
  intro?: readonly string[];
  sources?: readonly string[];
  pointer?: Pointer;
  entries: readonly Entry[];
}

export interface Chapter {
  /** Its URL segment under `/model`. */
  slug: string;
  title: string;
  /** For the page's meta description: one or two sentences. */
  description: string;
  lead: readonly string[];
  groups: readonly Group[];
}

// ─── The reader ─────────────────────────────────────────────────────────────

const reader: Chapter = {
  slug: 'the-reader',
  title: 'The reader you’re writing for',
  description:
    'Why every review starts with your reader: how involvement, awareness, trust, expertise and motivation change how the same copy lands.',
  lead: [
    'A review starts with your reader, not your copy. The same paragraph can win over a sceptical finance director and lose a hopeful founder.',
    'So you say who will read it, and every note is written for that reader. Here is what a review takes into account, and why each one matters.',
  ],
  groups: [
    {
      id: 'what-readers-bring',
      title: 'What every reader brings',
      intro: [
        'No two readers come to a page the same way. These are the differences that change most how a message is received.',
      ],
      entries: [
        {
          id: 'curse-of-knowledge',
          title: 'You know too much',
          summary: 'The hardest reader to imagine is one who doesn’t know what you know.',
          body: [
            'When people tapped out well-known songs, they expected half their listeners to name the tune. About one in forty did. The tappers could hear the melody; the listeners heard knocking.',
            'Every writer reads their own draft with the meaning already in their head. A review reads it without that, as your reader will.',
          ],
          sources: ['newton-1990', 'camerer-1989', 'heath-made-to-stick'],
          pointer: { kind: 'audience_modifier', id: 'expertise' },
        },
        {
          id: 'involvement',
          title: 'How closely they’ll read',
          summary: 'A careful reader weighs your argument; a hurried one goes by surface cues.',
          body: [
            'A reader facing a big decision reads closely, and weak evidence is punished. A reader skimming between meetings judges by length, confidence and who is speaking.',
            'The same copy can work for one and fail the other, so a review weighs evidence more heavily when the stakes are high.',
          ],
          sources: ['petty-cacioppo-elm'],
          pointer: { kind: 'audience_modifier', id: 'involvement' },
        },
        {
          id: 'awareness',
          title: 'What they already know about the problem',
          summary: 'Meet the reader where their awareness is, not where yours is.',
          body: [
            'Some readers don’t yet see the problem. Some see it but not the answer. Some are already comparing you with others.',
            'An opening that suits one stage loses the others: a reader comparing suppliers doesn’t want the problem explained.',
          ],
          sources: ['schwartz-1966'],
          pointer: { kind: 'audience_modifier', id: 'awareness' },
        },
        {
          id: 'relationship',
          title: 'Whether they know you',
          summary: 'A stranger needs more proof than a client who already trusts you.',
          body: [
            'Credibility doesn’t start at the first word. A cold reader gives you little, so the copy must earn it; a long-standing client gives you some on account.',
            'A review asks more of the copy when the relationship is new.',
          ],
          sources: ['trusted-advisor'],
          pointer: { kind: 'audience_modifier', id: 'relationship' },
        },
        {
          id: 'who-decides',
          title: 'Who else decides',
          summary:
            'A message to one person reads differently from one a committee will pass around.',
          body: [
            'When several people decide, your copy has to survive being forwarded: read by someone with a different job, different worries and none of the conversation that came before.',
          ],
          pointer: { kind: 'audience_modifier', id: 'decision_unit' },
        },
        {
          id: 'motivation',
          title: 'What drives them: gains or safety',
          summary: 'Some readers want to win; others want not to lose.',
          body: [
            'A reader focused on growth responds to what becomes possible. A reader focused on safety responds to what is protected.',
            'Copy framed for the motivation a reader already has tends to feel right to them, and the opposite frame can feel slightly off without their knowing why.',
          ],
          sources: ['higgins-regulatory-focus'],
          pointer: { kind: 'audience_modifier', id: 'focus' },
        },
      ],
    },
    {
      id: 'kinds-of-reader',
      title: 'Kinds of reader',
      intro: [
        'To help you picture your reader, a review offers a few reader types. They are built on research into how people differ: how much they enjoy reasoning, whether they lean towards growth or safety, and how much they resist being sold to.',
        'They are a working model, not a personality test. Real people mix them, and read differently under pressure. Use them to ask better questions about the actual person.',
      ],
      sources: ['need-for-cognition', 'higgins-regulatory-focus', 'friestad-wright-1994'],
      pointer: { kind: 'audience_modifier', id: 'archetype' },
      entries: [
        {
          id: 'the-auditor',
          title: 'The Auditor',
          aside: '“Can I check this, and what happens if it’s wrong?”',
          summary: 'Values accuracy, defensibility and protection from the downside.',
          body: [
            'Wants claims they could defend to someone else. Numbers, sources and risks stated plainly win them; enthusiasm without evidence loses them.',
          ],
          pointer: { kind: 'archetype', id: 'auditor' },
        },
        {
          id: 'the-builder',
          title: 'The Builder',
          aside: '“Who does what, by when, with what?”',
          summary: 'Values feasibility, sequence, resources and clear ownership.',
          body: [
            'Wants to see how it would actually happen. A plan, an owner and a timeline win them; a vision with no steps loses them.',
          ],
          pointer: { kind: 'archetype', id: 'builder' },
        },
        {
          id: 'the-pathfinder',
          title: 'The Pathfinder',
          aside: '“What becomes possible, and what would we regret not doing?”',
          summary: 'Values growth, ambition, advantage and momentum.',
          body: [
            'Wants to see the bigger opportunity. A clear picture of what could be won wins them; caution without a prize loses them.',
          ],
          pointer: { kind: 'archetype', id: 'pathfinder' },
        },
        {
          id: 'the-connector',
          title: 'The Connector',
          aside: '“How will this land with the people affected?”',
          summary: 'Values people, relationships, fairness and shared purpose.',
          body: [
            'Wants to know who is affected and how. Showing you have thought about the people wins them; treating people as numbers loses them.',
          ],
          pointer: { kind: 'archetype', id: 'connector' },
        },
        {
          id: 'the-sceptic',
          title: 'The Sceptic',
          aside: '“What’s the catch, and why should I believe you over what I already think?”',
          summary: 'Values independence, intellectual honesty and not being sold to.',
          body: [
            'Spots a sales tactic at once and discounts everything after it. Candour, admitted limits and room to make up their own mind win them; pressure loses them for good.',
          ],
          sources: ['friestad-wright-1994'],
          pointer: { kind: 'archetype', id: 'sceptic' },
        },
      ],
    },
  ],
};

// ─── What makes copy land ───────────────────────────────────────────────────

const appeals: Chapter = {
  slug: 'what-makes-copy-land',
  title: 'What makes copy land',
  description:
    'The questions a careful reader asks of persuasive writing, from Aristotle’s ethos, pathos and logos and the Greek idea of kairos to modern research on credibility, emotion, reasoning and timing.',
  lead: [
    'Behind every score is a set of questions a careful reader asks, often without noticing. The oldest of them are about 2,400 years old.',
    'Aristotle named three ways a speech persuades: the speaker’s character, the audience’s feelings and the argument itself. The Greeks added kairos, the right moment. Each is broken into the specific things a review looks for.',
    'A good piece doesn’t max them all out. The right mix depends on what you’re writing and who will read it: a CV leans on credibility, a fundraising appeal on emotion.',
  ],
  groups: [
    {
      id: 'ethos',
      title: 'Ethos: why should I believe you?',
      intro: [
        'Aristotle meant the character a speaker shows in the speech itself: practical wisdom, virtue and goodwill. Modern research says much the same. We judge others first on whether they can do it and whether they are on our side.',
      ],
      sources: ['aristotle-rhetoric', 'fiske-warmth-competence'],
      pointer: { kind: 'appeal', id: 'ethos' },
      entries: [
        {
          id: 'competence',
          title: 'Competence and judgement',
          summary: 'Show you know what you’re doing, in the text itself.',
          body: [
            'Titles and adjectives don’t convince. Specific results do, and so does sound judgement about the reader’s situation: a diagnosis, a trade-off weighed, a risk named.',
          ],
          example: {
            before: 'We are experienced experts in logistics.',
            after: 'Since 2019 we have moved 40,000 pallets a month for retailers your size.',
          },
          pointer: { kind: 'dimension', id: 'eth_competence' },
        },
        {
          id: 'integrity',
          title: 'Integrity and candour',
          summary: 'Claim no more than you can back up, and say what you can’t do.',
          body: [
            'Proportionate claims read as honest. Admitting a limit can raise credibility, as long as you then answer it.',
            'Inflated claims do the opposite, and a review will not let polish make up for them.',
          ],
          sources: ['pratfall-effect'],
          pointer: { kind: 'dimension', id: 'eth_integrity' },
        },
        {
          id: 'goodwill',
          title: 'Goodwill and reader focus',
          summary: 'Be visibly on the reader’s side.',
          body: [
            'Copy about the reader’s world is trusted more than copy about the writer. The more a message is about you, the less it is believed.',
          ],
          sources: ['trusted-advisor'],
          pointer: { kind: 'dimension', id: 'eth_goodwill' },
        },
        {
          id: 'borrowed-credibility',
          title: 'Borrowed credibility',
          summary: 'Let others vouch for you, specifically.',
          body: [
            'Testimonials, named clients and endorsements help most when the people vouching resemble the reader, and when the proof is specific: a name, a number, a result.',
          ],
          sources: ['cialdini-influence'],
          pointer: { kind: 'dimension', id: 'eth_borrowed' },
        },
        {
          id: 'shared-identity',
          title: 'Shared identity',
          summary: 'Sound like someone the reader recognises as one of their own.',
          body: [
            'Shared background, language or struggle makes a reader lower their guard. Copy that sounds like the reader’s own words earns a kinder hearing.',
          ],
          sources: ['cialdini-influence', 'godin'],
          pointer: { kind: 'dimension', id: 'eth_identification' },
        },
        {
          id: 'polish',
          title: 'Polish and consistency',
          summary: 'Errors are read as a sign of how you work.',
          body: [
            'Typos, shifting tone and shouting formatting make a reader doubt the competence behind them, fairly or not.',
          ],
          pointer: { kind: 'dimension', id: 'eth_polish' },
        },
      ],
    },
    {
      id: 'pathos',
      title: 'Pathos: why should I care?',
      intro: [
        'Aristotle saw that emotion changes judgement, so a speaker must understand what the audience feels, about whom, and why. Today the question is motivation: what is at stake for this reader, and does the copy make it felt?',
      ],
      sources: ['aristotle-rhetoric', 'heath-made-to-stick'],
      pointer: { kind: 'appeal', id: 'pathos' },
      entries: [
        {
          id: 'stakes',
          title: 'What’s at stake',
          summary: 'Name the reader’s problem in their words, and the outcome they want.',
          body: [
            'A reader moves when they recognise their own situation and can see a better one. Both have to be named in terms they would use themselves.',
          ],
          pointer: { kind: 'dimension', id: 'pat_stakes' },
        },
        {
          id: 'vividness',
          title: 'Concrete and vivid',
          summary: 'Give the reader something they can picture.',
          body: [
            'Abstract language moves nobody. A specific moment, place, person or object does.',
          ],
          example: {
            before: 'Our solution drives operational efficiencies.',
            after: 'Your team stops re-keying orders at five o’clock on a Friday.',
          },
          sources: ['heath-made-to-stick'],
          pointer: { kind: 'dimension', id: 'pat_vividness' },
        },
        {
          id: 'story',
          title: 'Story',
          summary: 'A character, a problem, a turning point and a result.',
          body: [
            'A reader carried into a story argues back less. Even a two-line story can carry an argument that a list of claims cannot.',
          ],
          sources: ['green-brock-transportation'],
          pointer: { kind: 'dimension', id: 'pat_story' },
        },
        {
          id: 'identity',
          title: 'Identity and belonging',
          summary: 'Acting on it should say something good about who the reader is.',
          body: [
            'People take up ideas that fit who they are or want to be. “People like us do things like this” persuades in a way that facts alone don’t.',
          ],
          sources: ['godin'],
          pointer: { kind: 'dimension', id: 'pat_identity' },
        },
        {
          id: 'empathy',
          title: 'Empathy',
          summary: 'Show you understand how the reader feels.',
          body: [
            'Naming a reader’s worry, and setting a tone that suits the moment, tells them you are writing to them and not at them.',
          ],
          pointer: { kind: 'dimension', id: 'pat_empathy' },
        },
        {
          id: 'surprise',
          title: 'Surprise and delight',
          summary: 'Something the reader didn’t predict.',
          body: [
            'Surprise is the emotion most able to shift a settled view, and a moment of wit helps a reader remember. It has to fit the setting.',
          ],
          sources: ['heath-made-to-stick'],
          pointer: { kind: 'dimension', id: 'pat_surprise' },
        },
      ],
    },
    {
      id: 'logos',
      title: 'Logos: why is it true?',
      intro: [
        'Aristotle meant the argument itself, and noticed that the best arguments leave unsaid what the audience already believes. Today that means evidence, a clear line of reasoning, and the doubts a reader will raise.',
      ],
      sources: ['aristotle-rhetoric', 'hopkins'],
      pointer: { kind: 'appeal', id: 'logos' },
      entries: [
        {
          id: 'evidence',
          title: 'Specific claims and evidence',
          summary: 'Specific beats general, and evidence beats assertion.',
          body: [
            'A precise, checkable claim is believed; a vague one is skipped. Numbers, named examples and sources do the work adjectives can’t.',
          ],
          example: {
            before: 'We dramatically improve customer satisfaction.',
            after: 'Complaints fell from 41 a month to 9 in the first quarter.',
          },
          sources: ['hopkins'],
          pointer: { kind: 'dimension', id: 'log_evidence' },
        },
        {
          id: 'reason-why',
          title: 'The reason why',
          summary: 'Explain how and why, not just what.',
          body: [
            'Saying how a result comes about, with a “because” or a “which means”, makes it believable. Small asks need only a reason; big asks need a real one.',
          ],
          pointer: { kind: 'dimension', id: 'log_mechanism' },
        },
        {
          id: 'structure',
          title: 'Structure and flow',
          summary: 'The main point first, then each point earning the next.',
          body: [
            'A reader who knows where the argument is going follows it more easily and trusts it more. Order is part of the case.',
          ],
          pointer: { kind: 'dimension', id: 'log_structure' },
        },
        {
          id: 'comparison',
          title: 'Contrast and alternatives',
          summary: 'Show the reader what they would otherwise do, including nothing.',
          body: [
            'Value is judged relative to something. If you don’t give the comparison, the reader picks one, and it may not be kind to you.',
          ],
          sources: ['anchoring'],
          pointer: { kind: 'dimension', id: 'log_comparison' },
        },
        {
          id: 'objections',
          title: 'Answering objections',
          summary: 'Raise the strongest doubt yourself, and answer it.',
          body: [
            'A reader who sees their objection answered relaxes. Answering it in advance also makes your case more resistant when someone else raises it later.',
          ],
          sources: ['inoculation-theory'],
          pointer: { kind: 'dimension', id: 'log_objections' },
        },
        {
          id: 'clarity',
          title: 'Clarity',
          summary: 'Plain words and short sentences are believed more.',
          body: [
            'Text that is easy to process is judged more true and more credible. Every sentence the reader has to read twice costs you some of their trust.',
          ],
          sources: ['illusory-truth', 'kahneman-2011'],
          pointer: { kind: 'dimension', id: 'log_clarity' },
        },
      ],
    },
    {
      id: 'kairos',
      title: 'Kairos: why now?',
      intro: [
        'The Greeks had two words for time: chronos, time passing, and kairos, the right moment. Aristotle centred on the first three appeals; kairos comes from the wider Greek tradition, and HowDoesThisLand treats it as a fourth.',
        'It catches the commonest failure in business writing: a good case with no reason to act now.',
      ],
      sources: ['kairos'],
      pointer: { kind: 'appeal', id: 'kairos' },
      entries: [
        {
          id: 'fit-to-the-moment',
          title: 'Why now',
          summary: 'Tie the message to something real happening in the reader’s world.',
          body: [
            'A change, a deadline, a season or a decision point answers “why now?” before the reader asks it.',
          ],
          pointer: { kind: 'dimension', id: 'kai_moment' },
        },
        {
          id: 'cost-of-delay',
          title: 'The cost of waiting',
          summary: 'Show truthfully what doing nothing costs.',
          body: [
            'The status quo is rarely as safe as it feels. Say what it costs this reader, honestly. Dressing a gain up as a loss is no magic trick: on average the two persuade about equally.',
          ],
          sources: ['framing-effect'],
          pointer: { kind: 'dimension', id: 'kai_stakes' },
        },
        {
          id: 'hope-and-agency',
          title: 'Hope and a way forward',
          summary: 'Urgency works only when the reader feels able to act.',
          body: [
            'A threat with no way out produces denial, not action. Pair the urgency with a path the reader can see themselves taking.',
          ],
          sources: ['witte-eppm'],
          pointer: { kind: 'dimension', id: 'kai_efficacy' },
        },
        {
          id: 'genuine-urgency',
          title: 'Real urgency',
          summary: 'Deadlines that are real, and in the reader’s interest.',
          body: [
            'Readers have learned to spot countdown theatre. Urgency persuades when it is specific, true and serves them, not just you.',
          ],
          pointer: { kind: 'dimension', id: 'kai_integrity' },
        },
        {
          id: 'call-to-act',
          title: 'The call to act',
          summary: 'One clear, easy next step, sized to the trust you’ve earned.',
          body: [
            'Motivation is wasted without a prompt and an easy way to act. Ask for one thing, say what happens next, and don’t ask for more than the copy has earned.',
          ],
          sources: ['fogg'],
          pointer: { kind: 'dimension', id: 'kai_call' },
        },
      ],
    },
  ],
};

// ─── The whole piece ────────────────────────────────────────────────────────

const wholePiece: Chapter = {
  slug: 'the-whole-piece',
  title: 'Reading the whole piece',
  description:
    'Qualities no single sentence can carry: one clear purpose, the bigger story, fit to the form and room for the reader to think, and the job a piece is doing for its reader.',
  lead: [
    'Some qualities belong to no single sentence. A piece can be credible, moving and logical line by line and still be about nothing in particular.',
    'So a review also reads the piece as a whole: its purpose, the story it belongs to, its fit to the form, and the job it does.',
  ],
  groups: [
    {
      id: 'lenses',
      title: 'Lenses',
      intro: [
        'The lenses come from Greek ideas about speech. They are reported beside the appeals, not folded into the score.',
      ],
      sources: ['aristotle-rhetoric'],
      entries: [
        {
          id: 'telos',
          title: 'One clear purpose',
          aside: 'Telos (τέλος)',
          summary: 'Could you say the point of the piece in one sentence?',
          body: [
            'Telos is the end a thing serves. A piece persuades when everything in it serves one idea and one change in the reader: what they should think, feel and do afterwards.',
          ],
          pointer: { kind: 'lens', id: 'lens_telos' },
        },
        {
          id: 'mythos',
          title: 'The bigger story',
          aside: 'Mythos (μῦθος)',
          summary: 'The worldview the reader is invited to join.',
          body: [
            'Brands and movements persuade through a story of the world as it should be, not only through claims. Mythos asks what larger story your message belongs to.',
          ],
          pointer: { kind: 'lens', id: 'lens_mythos' },
        },
        {
          id: 'prepon',
          title: 'Fit to the audience and the form',
          aside: 'Prepon (πρέπον)',
          summary: 'The right register, length and format for this kind of piece.',
          body: [
            'Aristotle asked that style suit the subject and the audience. A technique that works on a landing page can sink a CV, and a joke that works in a speech can wreck a crisis statement.',
          ],
          sources: ['aristotle-rhetoric', 'gunning-fog'],
          pointer: { kind: 'lens', id: 'lens_prepon' },
        },
        {
          id: 'dialogue',
          title: 'Room to reason together',
          aside: 'Dialogos (διάλογος)',
          summary: 'Does the piece treat the reader as a partner in thinking?',
          body: [
            'Copy that acknowledges other views, answers the strongest objection and invites a reply builds lasting conviction. Copy that demands agreement may win the moment and lose the reader.',
          ],
          pointer: { kind: 'lens', id: 'lens_dialogue' },
        },
      ],
    },
    {
      id: 'duties',
      title: 'The job a piece does for its reader',
      intro: [
        'Cicero, the Roman statesman and lawyer, wrote in De Oratore (55 BC) that a speaker has three jobs: to teach, to delight and to move. HowDoesThisLand adds two more.',
        'One is to steer, Aristotle’s aim of advising a course of action. The other is to unsettle, after Socrates’ habit of questioning what people take for granted. A review shows which jobs your copy is doing, and whether that suits what you’re writing.',
      ],
      sources: ['cicero-de-oratore', 'aristotle-rhetoric', 'socratic-method'],
      entries: [
        {
          id: 'teach',
          title: 'Teach',
          aside: 'docere',
          summary: 'Make it known and understood.',
          body: ['Facts, evidence and explanation: what is true and how it works.'],
          pointer: { kind: 'duty', id: 'teach' },
        },
        {
          id: 'delight',
          title: 'Delight',
          aside: 'delectare',
          summary: 'Hold attention with pleasure.',
          body: [
            'Curiosity, wit, surprise, scene and voice: the things that make a reader want to keep going.',
          ],
          pointer: { kind: 'duty', id: 'delight' },
        },
        {
          id: 'move',
          title: 'Move',
          aside: 'movere',
          summary: 'Stir feeling and commitment.',
          body: [
            'Emotion, values, belief and identity: why it matters, and why the reader should care.',
          ],
          pointer: { kind: 'duty', id: 'move' },
        },
        {
          id: 'steer',
          title: 'Steer',
          aside: 'consilium',
          summary: 'Advise a course of action.',
          body: ['Options, a recommendation, a plan and the next step.'],
          pointer: { kind: 'duty', id: 'steer' },
        },
        {
          id: 'unsettle',
          title: 'Unsettle',
          aside: 'elenchus',
          summary: 'Question what the reader assumes.',
          body: [
            'Exposing an assumption, a myth or a blind spot, so the reader reconsiders rather than simply agrees.',
          ],
          sources: ['socratic-method'],
          pointer: { kind: 'duty', id: 'unsettle' },
        },
      ],
    },
  ],
};

// ─── Craft and fit ──────────────────────────────────────────────────────────

const craft: Chapter = {
  slug: 'craft-and-fit',
  title: 'Craft, and fit to the reader',
  description:
    'Whether a piece is well made and right for its reader: structure, length, clarity, cohesion, tone, claims you can stand behind, first impressions and assumed knowledge.',
  lead: [
    'A persuasive idea can still be badly made. Before a reader weighs your case, they have to get through your sentences.',
    'Two of the AI reviewers look at craft and at fit to the particular reader, the way a good editor would.',
  ],
  groups: [
    {
      id: 'craft',
      title: 'Is it well made?',
      pointer: { kind: 'group', id: 'craft' },
      entries: [
        {
          id: 'structure',
          title: 'Structure',
          summary: 'The point early, a sensible order, and an end that says where to go next.',
          body: [
            'A skim reader should get the whole argument from the opening and the headings. If the ask is in the last paragraph, many readers will never reach it.',
          ],
          pointer: { kind: 'extra_dimension', id: 'craft_structure' },
        },
        {
          id: 'length',
          title: 'Length',
          summary: 'Long enough to make the case, short enough to be read.',
          body: [
            'Each type of copy has a length readers expect. A cover letter that runs to three pages, or a proposal of four lines, is judged before it is read.',
          ],
          pointer: { kind: 'extra_dimension', id: 'craft_length' },
        },
        {
          id: 'clarity-and-readability',
          title: 'Clarity and readability',
          summary: 'How easily the intended reader can take it in.',
          body: [
            'Sentence length, familiar words, active voice and little jargon decide whether the reader follows on one read. Readability measures give a rough guide, not a verdict.',
          ],
          sources: ['gunning-fog'],
          pointer: { kind: 'extra_dimension', id: 'craft_clarity' },
        },
        {
          id: 'cohesion',
          title: 'Cohesion',
          summary: 'Ideas that hang together, with the links between them signalled.',
          body: [
            'Sentences that connect, key terms used consistently and paragraphs that share a thread make a piece feel like one argument rather than a pile of points.',
          ],
          pointer: { kind: 'extra_dimension', id: 'craft_cohesion' },
        },
        {
          id: 'tone-and-voice',
          title: 'Tone and voice',
          summary: 'A consistent voice that suits the form and the relationship.',
          body: [
            'Formality, warmth and confidence should match who you’re writing to. A voice that wobbles between chummy and corporate makes a reader wonder who is speaking.',
          ],
          pointer: { kind: 'extra_dimension', id: 'craft_tone' },
        },
        {
          id: 'claims-you-can-stand-behind',
          title: 'Claims you can stand behind',
          summary: 'Could you back up every claim if the reader asked?',
          body: [
            'Sources for statistics, evidence for comparisons, and no promises you can’t keep. HowDoesThisLand can’t check your facts; it can flag the claims a reader is likely to question.',
          ],
          pointer: { kind: 'extra_dimension', id: 'craft_claims' },
        },
      ],
    },
    {
      id: 'audience',
      title: 'Does it suit this reader?',
      pointer: { kind: 'group', id: 'audience' },
      entries: [
        {
          id: 'fit-to-this-reader',
          title: 'Fit to this reader',
          summary: 'The right depth and reading level for who will read it.',
          body: [
            'An expert wants the detail; a busy executive wants the decision. The same facts, pitched wrongly, lose either one.',
          ],
          pointer: { kind: 'extra_dimension', id: 'aud_suitability' },
        },
        {
          id: 'first-impression',
          title: 'First impression',
          summary: 'Does the opening earn the next line?',
          body: [
            'Most readers decide in the first few lines whether to keep going. A specific, reader-focused opening beats one that clears its throat.',
          ],
          example: {
            before:
              'I hope this email finds you well. I wanted to reach out to introduce our company.',
            after:
              'Your March invoices took 41 days to pay. Here is how three firms like yours cut that to 12.',
          },
          pointer: { kind: 'extra_dimension', id: 'aud_hook' },
        },
        {
          id: 'assumed-knowledge',
          title: 'Assumed knowledge',
          summary: 'Undefined acronyms and insider terms shut readers out.',
          body: [
            'This is the curse of knowledge in practice: what is obvious to you may be a wall to your reader. Define it, or leave it out.',
          ],
          sources: ['camerer-1989'],
          pointer: { kind: 'extra_dimension', id: 'aud_knowledge' },
        },
        {
          id: 'inclusive-language',
          title: 'Inclusive language',
          summary: 'Language that welcomes every reader.',
          body: [
            'Gendered defaults and assumptions about age, background or ability quietly tell some readers the message isn’t for them.',
          ],
          pointer: { kind: 'extra_dimension', id: 'aud_inclusivity' },
        },
      ],
    },
  ],
};

// ─── Honest scores ──────────────────────────────────────────────────────────

const honest: Chapter = {
  slug: 'honest-scores',
  title: 'How scores stay honest',
  description:
    'Why HowDoesThisLand rewards copy that earns agreement and marks down copy that tries to take it: limits no polish can lift, red flags that cost trust, and checks on fairness to the reader.',
  lead: [
    'Persuasion can be used well or badly, and the techniques themselves don’t care which. A model that only rewarded technique would reward cleverness over honesty.',
    'So the best scores are kept for copy that earns them. The Greeks had a goddess of persuasion, Peitho, linked with goodwill rather than force, and the standard here is hers.',
  ],
  groups: [
    {
      id: 'rules',
      title: 'What keeps the best scores honest',
      sources: ['peitho', 'tares'],
      entries: [
        {
          id: 'limits-polish-cannot-lift',
          title: 'Some failings limit a score, however good the rest',
          summary: 'Style can’t buy its way past dishonesty.',
          body: [
            'Manufactured urgency can’t produce a strong score for timing. Misleading claims hold credibility down, however polished the rest of the piece is.',
          ],
          pointer: { kind: 'section', id: 'scoring' },
        },
        {
          id: 'more-is-not-better',
          title: 'More is not always better',
          summary: 'The right mix depends on what you’re writing.',
          body: [
            'Pushing every appeal to the maximum produces hype. A CV loaded with emotion is a worse CV, so each type of copy is judged against the mix it needs.',
          ],
          pointer: { kind: 'limitation', id: 'lim_more_is_not_better' },
        },
        {
          id: 'quotes',
          title: 'Every note quotes your words',
          summary: 'You can always check what a note is about.',
          body: [
            'When an AI reviewer comments on a line, it quotes that line exactly, so the note sits on your words and you can judge it for yourself.',
          ],
        },
        {
          id: 'fair-to-the-reader',
          title: 'Would the reader feel fairly treated?',
          summary: 'Persuasion you’d be happy for your reader to see through.',
          body: [
            'Every review asks whether the copy is truthful, authentic, respectful and fair, and whether the reader would still feel well treated if they saw everything you know.',
          ],
          sources: ['tares'],
          pointer: { kind: 'perspective', id: 'pv_ethics' },
        },
      ],
    },
    {
      id: 'red-flags',
      title: 'Red flags',
      intro: [
        'Some patterns cost a reader’s trust as soon as they notice them, and readers have grown good at noticing. A review flags them wherever they appear.',
      ],
      sources: ['friestad-wright-1994'],
      entries: [
        {
          id: 'manufactured-urgency',
          title: 'Manufactured urgency',
          summary: 'Deadlines and scarcity with nothing specific behind them.',
          body: [
            'Readers increasingly read vague urgency as manipulation, and discount everything around it.',
          ],
          example: {
            before: 'Act now! This offer won’t last!',
            after: 'Prices rise on 1 March, when our new supplier contract starts.',
          },
          pointer: { kind: 'red_flag', id: 'rf_false_urgency' },
        },
        {
          id: 'hype',
          title: 'Hype and superlatives',
          summary: 'Self-awarded praise that costs credibility.',
          body: [
            '“World-class” and “revolutionary” tell a sceptical reader you have nothing more specific to say.',
          ],
          pointer: { kind: 'red_flag', id: 'rf_hype' },
        },
        {
          id: 'absolute-promises',
          title: 'Absolute promises',
          summary: 'Guarantees nobody can keep.',
          body: [
            '“Guaranteed results” invites disbelief, and can be a legal risk as well. A specific, honest commitment persuades more.',
          ],
          pointer: { kind: 'red_flag', id: 'rf_absolute_promise' },
        },
        {
          id: 'weasel-claims',
          title: 'Weasel claims',
          summary: 'Claims that sound specific but commit to nothing.',
          body: [
            '“Up to 50% savings” and “studies show” promise less than they seem to, and careful readers notice.',
          ],
          pointer: { kind: 'red_flag', id: 'rf_weasel' },
        },
        {
          id: 'fear-without-a-path',
          title: 'Fear without a way out',
          summary: 'Threats with no achievable response.',
          body: ['Doom with no way forward makes readers defensive rather than active.'],
          sources: ['witte-eppm'],
          pointer: { kind: 'red_flag', id: 'rf_fear' },
        },
        {
          id: 'buzzwords',
          title: 'Buzzword clusters',
          summary: 'Abstract words stacked until nothing is said.',
          body: [
            'When a sentence is made of “synergy”, “leverage” and “transformation”, the reader can’t tell what you actually offer.',
          ],
          pointer: { kind: 'red_flag', id: 'rf_buzzword_cluster' },
        },
        {
          id: 'making-the-reader-wrong',
          title: 'Making the reader wrong',
          summary: 'Attacking the reader’s current choice.',
          body: ['Telling someone their present approach is foolish makes them defend it.'],
          pointer: { kind: 'red_flag', id: 'rf_status_threat' },
        },
        {
          id: 'confirmshaming',
          title: 'Confirmshaming',
          summary: 'Shaming the reader for saying no.',
          body: [
            '“No thanks, I like wasting money” is a recognised dark pattern. It wins a click and loses the reader.',
          ],
          sources: ['dark-patterns'],
          pointer: { kind: 'red_flag', id: 'rf_confirmshaming' },
        },
        {
          id: 'controlling-language',
          title: 'Controlling language',
          summary: 'Commands and pressure that threaten the reader’s choice.',
          body: [
            'People push back when they feel told what to do, sometimes towards the opposite.',
          ],
          sources: ['brehm-reactance'],
          pointer: { kind: 'red_flag', id: 'rf_controlling' },
        },
      ],
    },
  ],
};

// ─── The AI reviewers ───────────────────────────────────────────────────────

const reviewers: Chapter = {
  slug: 'the-ai-reviewers',
  title: 'The AI reviewers',
  description:
    'Who reads your copy in a full review, what each AI reviewer looks for, the schools of influence behind them, and how the free quick scan differs.',
  lead: [
    'A full review gives your copy to a panel of AI reviewers. Each reads it as your reader would, through one lens, and quotes your exact words for every note.',
    'Together they mark the lines that would win your reader over and the ones that would lose them, and suggest what to say instead, in your voice.',
  ],
  groups: [
    {
      id: 'panels',
      title: 'Who is on the panel',
      entries: [
        {
          id: 'the-appeals',
          title: 'The appeals',
          summary: 'Credibility, emotion, reason and timing. Always on.',
          body: [
            'The core of every review: why should I believe you, why should I care, why is it true, and why now?',
          ],
          pointer: { kind: 'judge_profile', id: 'core' },
        },
        {
          id: 'craft-editor',
          title: 'Craft editor',
          summary: 'Structure, length, clarity, cohesion, tone and claims.',
          body: [
            'Reads like a demanding editor: is the piece well made, and would every claim stand up?',
          ],
          pointer: { kind: 'judge_profile', id: 'craft' },
        },
        {
          id: 'audience-reviewer',
          title: 'Audience',
          summary: 'Fit to this reader, from the first line to the last.',
          body: [
            'Checks depth and reading level, the opening, assumed knowledge and inclusive language against the reader you described.',
          ],
          pointer: { kind: 'judge_profile', id: 'audience' },
        },
        {
          id: 'lenses-and-duties',
          title: 'Lenses and duties',
          summary:
            'Purpose, the bigger story, fit to form, dialogue, and the job the piece is doing.',
          body: ['Reads the piece as a whole rather than line by line.'],
          pointer: { kind: 'judge_profile', id: 'lenses' },
        },
        {
          id: 'influence-panel',
          title: 'Influence panel',
          summary: 'The levers of influence at work, and whether they are used fairly.',
          body: [
            'Draws on schools of thought from classical rhetoric to behavioural science and ethics, listed below.',
          ],
          pointer: { kind: 'judge_profile', id: 'influence' },
        },
      ],
    },
    {
      id: 'quick-or-full',
      title: 'The quick scan and a full review',
      entries: [
        {
          id: 'quick-scan',
          title: 'The quick scan',
          summary: 'A free surface check of word patterns, without AI.',
          body: [
            'It notices things like hype words, vague claims, missing numbers and long sentences, in a moment. It can’t tell whether your argument holds up or how your reader will take it.',
          ],
        },
        {
          id: 'full-review',
          title: 'A full review',
          summary: 'The AI reviewers read your copy as your reader would.',
          body: [
            'They judge the argument, the evidence and the fit to your reader, mark up your copy line by line, and suggest rewrites. Where a point needs a fact only you have, they leave a gap rather than invent one.',
          ],
        },
      ],
    },
    {
      id: 'schools-of-influence',
      title: 'Schools of influence behind the panel',
      intro: [
        'Each school asks its own question of your copy. Together they catch what any one view would miss, including the ways persuasion can go wrong.',
      ],
      entries: [
        {
          id: 'classical-rhetoric',
          title: 'Classical rhetoric',
          aside: 'Aristotle, Cicero, Quintilian',
          summary: 'Is the argument well made and well said?',
          body: [
            'The oldest tradition: proof, arrangement, style and the devices that make a point memorable.',
          ],
          sources: ['aristotle-rhetoric', 'cicero-de-oratore'],
          pointer: { kind: 'perspective', id: 'pv_rhetoric' },
        },
        {
          id: 'social-influence',
          title: 'Social influence',
          aside: 'Robert Cialdini',
          summary: 'Which principles of influence are at work, and are they used truthfully?',
          body: [
            'Reciprocity, social proof, authority, liking, scarcity, commitment and unity, each checked for honest use.',
          ],
          sources: ['cialdini-influence'],
          pointer: { kind: 'perspective', id: 'pv_cialdini' },
        },
        {
          id: 'tribes-and-change',
          title: 'Tribes and change',
          aside: 'Seth Godin',
          summary: 'Is it for someone specific, and does it offer a change worth making?',
          body: [
            'Messages travel when they speak to a particular group and the tension it wants resolved.',
          ],
          sources: ['godin'],
          pointer: { kind: 'perspective', id: 'pv_godin' },
        },
        {
          id: 'behavioural-economics',
          title: 'Behavioural economics',
          aside: 'Kahneman, Thaler and others',
          summary: 'How do framing, anchors and the shape of the choice affect the decision?',
          body: [
            'People don’t weigh options in a vacuum; how a choice is presented changes what they choose.',
          ],
          sources: ['kahneman-2011', 'nudge', 'anchoring'],
          pointer: { kind: 'perspective', id: 'pv_behavioural_econ' },
        },
        {
          id: 'behaviour-design',
          title: 'Behaviour design',
          aside: 'BJ Fogg and others',
          summary: 'Will the reader actually be able, and prompted, to act?',
          body: [
            'Motivation alone isn’t enough: the next step has to be easy and clearly asked for.',
          ],
          sources: ['fogg'],
          pointer: { kind: 'perspective', id: 'pv_behaviour_design' },
        },
        {
          id: 'processing-and-attention',
          title: 'Processing and attention',
          aside: 'Petty and Cacioppo, Schwarz',
          summary: 'Does it work for how this reader will process it?',
          body: [
            'Careful readers weigh arguments; hurried ones go by cues. Easy reading is believed more.',
          ],
          sources: ['petty-cacioppo-elm', 'illusory-truth'],
          pointer: { kind: 'perspective', id: 'pv_dual_process' },
        },
        {
          id: 'narrative-psychology',
          title: 'Narrative psychology',
          aside: 'Green and Brock and others',
          summary: 'Does a story carry the reader somewhere?',
          body: ['A reader absorbed in a story is more open to where it leads.'],
          sources: ['green-brock-transportation'],
          pointer: { kind: 'perspective', id: 'pv_narrative' },
        },
        {
          id: 'identity-and-values',
          title: 'Identity and values',
          aside: 'Haidt and others',
          summary: 'Whose values does the message speak to?',
          body: ['A case made in your values can miss a reader who holds different ones.'],
          sources: ['moral-foundations'],
          pointer: { kind: 'perspective', id: 'pv_identity_values' },
        },
        {
          id: 'resistance-and-reactance',
          title: 'Resistance and reactance',
          aside: 'Brehm, Friestad and Wright',
          summary: 'What will make the reader push back, and does the copy reduce it?',
          body: [
            'Readers resist pressure and recognised tactics; good copy lowers resistance rather than overpowering it.',
          ],
          sources: ['brehm-reactance', 'friestad-wright-1994'],
          pointer: { kind: 'perspective', id: 'pv_resistance' },
        },
        {
          id: 'trust-and-relationship',
          title: 'Trust and relationship',
          aside: 'Maister, Fiske and Cuddy',
          summary: 'Does the reader trust your intentions as well as your ability?',
          body: [
            'Competence without warmth, or warmth without competence, leaves trust half built.',
          ],
          sources: ['trusted-advisor', 'fiske-warmth-competence'],
          pointer: { kind: 'perspective', id: 'pv_trust' },
        },
        {
          id: 'motivation-and-emotion',
          title: 'Motivation and emotion',
          aside: 'Higgins, Witte, Deci and Ryan',
          summary: 'Does the emotional tone fit the reader and lead to action?',
          body: [
            'The right feeling, pitched at the reader’s motivation and paired with a way to act.',
          ],
          sources: ['higgins-regulatory-focus', 'witte-eppm', 'self-determination'],
          pointer: { kind: 'perspective', id: 'pv_motivation' },
        },
        {
          id: 'ethics-and-respect',
          title: 'Ethics and respect',
          aside: 'Baker and Martinson',
          summary: 'Would the reader still feel fairly treated if they saw everything?',
          body: [
            'Truthful, authentic, respectful, fair and responsible: the test persuasion should pass.',
          ],
          sources: ['tares', 'dark-patterns'],
          pointer: { kind: 'perspective', id: 'pv_ethics' },
        },
        {
          id: 'critical-suspicion',
          title: 'Critical suspicion',
          aside: 'Nietzsche, Kunda',
          summary: 'Who benefits, and is the reader being helped to think or just to agree?',
          body: [
            'We tend to believe what we want to. This school asks whether the copy exploits that, or respects the reader’s judgement.',
          ],
          sources: ['kunda-1990'],
          pointer: { kind: 'perspective', id: 'pv_critical' },
        },
      ],
    },
  ],
};

// ─── Evidence and limits ────────────────────────────────────────────────────

const evidence: Chapter = {
  slug: 'evidence-and-limits',
  title: 'Evidence and limits',
  description:
    'How strong the evidence is behind persuasion advice, what the research says about how much wording matters, and the honest limits of any score.',
  lead: [
    'Most persuasion advice is practitioner wisdom: some of it holds up, some doesn’t. HowDoesThisLand marks every idea it uses by how strong the evidence behind it is.',
    'It also says plainly what it can’t do. A score is a well-informed second opinion, not a forecast.',
  ],
  groups: [
    {
      id: 'evidence',
      title: 'How strong is the evidence?',
      entries: [
        {
          id: 'graded-evidence',
          title: 'Every idea is graded',
          summary: 'Strong, mixed, weak or practitioner lore, and the model says which.',
          body: [
            'Some ideas, like anchoring, are robust. Some, like scarcity, are mixed. Some are craft wisdom with little research behind them. Each is marked, and the model was changed where the research disagreed with popular advice.',
          ],
          sources: ['anchoring'],
          pointer: { kind: 'section', id: 'research' },
        },
        {
          id: 'small-effects',
          title: 'Wording matters less than you might think',
          summary: 'Message tweaks make small and inconsistent differences.',
          body: [
            'Across more than a thousand studies, choices like story versus data or gain versus loss changed persuasiveness only a little, and not reliably. Who the reader is, what you offer and whether they trust you usually matter more.',
          ],
          sources: ['okeefe-hoeken-2021'],
          pointer: { kind: 'limitation', id: 'lim_small_effects' },
        },
        {
          id: 'folk-wisdom',
          title: 'Some popular advice doesn’t replicate',
          summary:
            '“Loss beats gain” and “one story beats a statistic” are weaker than often taught.',
          body: [
            'Where well-known claims turned out weaker than their reputation, the model follows the evidence rather than the folklore.',
          ],
          sources: ['framing-effect'],
          pointer: { kind: 'limitation', id: 'lim_folk_wisdom' },
        },
      ],
    },
    {
      id: 'limits',
      title: 'What a review can’t do',
      entries: [
        {
          id: 'facts',
          title: 'It can’t check your facts',
          summary: 'Whether your claims are true is still yours to answer for.',
          body: [
            'A review can flag claims a reader is likely to question. It can’t know whether they are right.',
          ],
        },
        {
          id: 'text-not-speaker',
          title: 'It judges the text, not the speaker',
          summary: 'Your reputation does work no text can see.',
          body: [
            'Real credibility also comes from who you are and what the reader already knows of you. A brilliant cold email from a stranger still starts with less trust than a note from a valued colleague.',
          ],
          pointer: { kind: 'limitation', id: 'lim_text_only' },
        },
        {
          id: 'overlap',
          title: 'The categories overlap',
          summary: 'One line can do several jobs at once.',
          body: [
            'A testimonial is credibility, evidence and story all at once. A review lets a note touch several things rather than forcing one label.',
          ],
          pointer: { kind: 'limitation', id: 'lim_overlap' },
        },
        {
          id: 'persuasive-is-not-good',
          title: 'Persuasive is not the same as good',
          summary: 'Technique is morally neutral; the model is not.',
          body: [
            'On their own, the appeals can reward cleverness over honesty. That is why fairness to the reader is checked in every review.',
          ],
          sources: ['tares'],
          pointer: { kind: 'limitation', id: 'lim_ethics' },
        },
        {
          id: 'western-and-verbal',
          title: 'Rooted in Western, written persuasion',
          summary: 'Greek rhetoric and mostly Anglo-American practice, in text.',
          body: [
            'Directness, emotion and authority work differently across cultures, and spoken or visual delivery isn’t assessed.',
          ],
          pointer: { kind: 'limitation', id: 'lim_cultural' },
        },
        {
          id: 'reader-types-are-simplifications',
          title: 'Reader types are simplifications',
          summary: 'A prompt for thinking about your reader, not a diagnosis.',
          body: [
            'Real readers mix styles and change under pressure. Check what a review assumes against what you know of the actual person.',
          ],
          pointer: { kind: 'limitation', id: 'lim_archetypes' },
        },
        {
          id: 'kairos-as-an-appeal',
          title: 'Kairos as a fourth appeal is a choice',
          summary: 'Aristotle centred on three; timing comes from the wider Greek tradition.',
          body: [
            'Treating timeliness as a fourth appeal follows scholarship that restores it to the centre, and it catches the commonest failure in business writing: no reason to act now.',
          ],
          sources: ['kairos', 'aristotle-rhetoric'],
          pointer: { kind: 'limitation', id: 'lim_kairos_added' },
        },
      ],
    },
  ],
};

/** The chapters, in reading order. */
export const CHAPTERS: readonly Chapter[] = [
  reader,
  appeals,
  wholePiece,
  craft,
  honest,
  reviewers,
  evidence,
];

/** The hub's own copy, on `/model`. */
export const MODEL_HUB = {
  slug: 'The model',
  title: 'How a review works',
  description:
    'What HowDoesThisLand looks for when it reviews your copy, and why: your reader, credibility, emotion, reasoning and timing, the whole piece, craft, honest scores, the AI reviewers and the evidence behind them.',
  lead: [
    'Every review is scored against a model of what makes a message land, built on 2,400 years of rhetoric and tested against modern research.',
    'This is that model in plain words: what a review looks for, why it matters to your reader, and where each idea comes from. Read it in order, or go straight to the part you need.',
  ],
  sourcesTitle: 'Sources',
  sourcesDescription:
    'The thinkers, books and studies behind HowDoesThisLand, each with who, what, when and why it matters, for anyone meeting them for the first time.',
  sourcesLead:
    'Where the ideas behind HowDoesThisLand come from, each with a sentence or two on why it matters, for anyone meeting it for the first time.',
} as const;

export function chapter(slug: string): Chapter | null {
  return CHAPTERS.find((c) => c.slug === slug) ?? null;
}
