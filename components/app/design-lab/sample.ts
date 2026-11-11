/**
 * Real content for the design lab, generated once from the prototype's engine
 * (prototype/src/engine.js over howdoesthisland_model.json v0.5.0 and
 * calibration case ev05) so the lab never reads prototype/ (plan §2).
 *
 * Throwaway: t-4 (a2) deletes the lab with this file.
 */
export const SAMPLE = {
  brand: {
    name: 'HowDoesThisLand',
    tagline: 'The art of changing minds',
    origin:
      "Named for the question every writer should ask before pressing send: how does this land with the person reading it? The method behind it goes back to Peitho (Πειθώ), the Greek goddess of persuasion, and to Aristotle's Rhetoric.",
    visual: {
      direction:
        'Intellectual and connected: editorial typography, clean contemporary layout, overlapping forms for perspectives meeting. Classical references used sparingly, never marble-and-columns.',
      mark: 'Two overlapping circles; the shared space between them is where perspectives meet.',
      type: 'Newsreader (editorial serif) for the wordmark and reading text; Schibsted Grotesk for interface.',
    },
    h1: "Find out why your words aren't landing, before your reader does.",
    sub: 'HowDoesThisLand reads your CV, pitch or proposal the way your reader will. It scores credibility, emotion, logic and timing, shows you where each one works, and helps you strengthen the case so your reader can say yes for their own reasons. You can try it now, free, in under a minute.',
  },
  modelVersion: '0.5.0',
  appeals: [
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
  ],
  bands: [
    {
      min: 0,
      max: 39,
      label: 'Weak',
    },
    {
      min: 40,
      max: 59,
      label: 'Developing',
    },
    {
      min: 60,
      max: 74,
      label: 'Solid',
    },
    {
      min: 75,
      max: 89,
      label: 'Strong',
    },
    {
      min: 90,
      max: 100,
      label: 'Exceptional',
    },
  ],
  before: {
    title: 'Sender-centred cold email',
    text: "Subject: Quick question\n\nHi Sarah,\n\nI hope this email finds you well! My name is Tom and I am the Business Development Manager at BrightPath Consulting. We are a leading provider of digital transformation solutions and we have worked with many of the world's top companies.\n\nWe offer a wide range of services including cloud migration, process optimisation and change management. Our innovative approach delivers outstanding results for our clients.\n\nI would love to set up a 45-minute call to walk you through our capabilities and discuss how we could potentially work together.\n\nLet me know if you have any questions!\n\nTom",
    scores: {
      overall: 34,
      band: 'Weak',
      balance_index: 74,
      ethos: 36,
      pathos: 17,
      logos: 43,
      kairos: 45,
    },
    annotations: [
      {
        start: 36,
        end: 69,
        quote: 'I hope this email finds you well!',
        appeal: 'ethos',
        dimension: 'Goodwill and reader focus',
        note: 'Starts with the author, not the reader.',
        why: '',
        change: 0,
      },
      {
        start: 70,
        end: 151,
        quote: 'My name is Tom and I am the Business Development Manager at BrightPath Consulting',
        appeal: 'ethos',
        dimension: 'Goodwill and reader focus',
        note: 'Start with her problem, not your job title',
        why: "The Trust Equation puts self-orientation at the bottom of the fraction: the more a message is about the sender, the less it's trusted.",
        change: 1,
      },
      {
        start: 153,
        end: 273,
        quote:
          "We are a leading provider of digital transformation solutions and we have worked with many of the world's top companies.",
        appeal: 'ethos',
        dimension: 'Goodwill and reader focus',
        note: 'Starts with the author, not the reader.',
        why: '',
        change: 0,
      },
      {
        start: 275,
        end: 379,
        quote:
          'We offer a wide range of services including cloud migration, process optimisation and change management.',
        appeal: 'ethos',
        dimension: 'Goodwill and reader focus',
        note: 'Starts with the author, not the reader.',
        why: '',
        change: 0,
      },
      {
        start: 380,
        end: 448,
        quote: 'Our innovative approach delivers outstanding results for our clients',
        appeal: 'logos',
        dimension: 'Mechanism and reasoning',
        note: 'Show how, not just what',
        why: "Builders ask 'who does what, by when?'. A named method makes a familiar promise believable.",
        change: 2,
      },
      {
        start: 451,
        end: 527,
        quote: 'I would love to set up a 45-minute call to walk you through our capabilities',
        appeal: 'kairos',
        dimension: 'The call to act',
        note: 'Shrink the ask, and give a reason for now',
        why: "A small first step inside the reader's comfort zone is far more likely to be taken than a large one.",
        change: 4,
      },
      {
        start: 581,
        end: 619,
        quote: 'Let me know if you have any questions!',
        appeal: 'pathos',
        dimension: 'Empathy and emotional resonance',
        note: 'Exclamation-heavy enthusiasm',
        why: '',
        change: 0,
      },
    ],
    balance: [
      {
        name: 'All about the author',
        message: "The text talks mostly about the author. Flip it to the reader's world.",
      },
    ],
  },
  after: {
    text: "Subject: Keeping delivery on track after your cloud move\n\nHi Sarah,\n\nYour Q3 update mentioned the cloud migration twice, and both times the worry was the same: teams slowing down in the month after the switch. You're right to flag it. That dip is common, and it's usually a change problem, not a technical one.\n\nWhen we worked with [client in a similar sector], a firm about your size, delivery held steady through a similar move because we ran a two-week readiness check and gave each team a named coach. [Result, e.g. support tickets fell by X% in the first quarter.]\n\nYou might be wondering whether this means another big programme. It doesn't. The check takes two weeks, it fits around your existing plan, and if it finds nothing worth fixing, you've lost very little.\n\nYou're planning the cutover for the new year, so the next six weeks are when this is cheapest to fix.\n\nIf it's useful, I can send the one-page readiness checklist we use. Just reply \"checklist\". No call needed, and no hard feelings if the timing's wrong.\n\nTom",
    scores: {
      overall: 55,
      band: 'Developing',
      balance_index: 72,
      ethos: 50,
      pathos: 33,
      logos: 61,
      kairos: 89,
    },
  },
  context: {
    contentType: 'Sales / outreach email',
    archetype: 'The Builder',
    role: 'Chief Operating Officer',
    relationship: 'Cold',
    awareness: 'Problem aware',
  },
  notes: {
    verdict:
      "The original reads as a brochure sent to a stranger. It talks about the sender for four sentences before the reader appears, and asks a busy operations director for 45 minutes with nothing in return. The rewrite starts from a risk Sarah has already named, explains how it's handled, answers the obvious objection and asks for one word.",
    appeals: {
      ethos:
        "Credibility is claimed, not shown: 'leading provider', 'world's top companies' and 'outstanding results' with no names or numbers. To a Builder, unbacked claims read as risk.",
      pathos:
        "There is no reader in the email. Sarah's own problem never appears, so there is nothing for her to feel or recognise.",
      logos:
        'Services are listed but no mechanism is offered. Nothing explains how the work would reduce her risk.',
      kairos:
        "No reason to reply now, and the ask (45 minutes to 'walk through our capabilities') is far bigger than the trust built.",
    },
    changes: [
      {
        dim: 'eth_goodwill',
        title: 'Start with her problem, not your job title',
        why: "The Trust Equation puts self-orientation at the bottom of the fraction: the more a message is about the sender, the less it's trusted.",
        before:
          'My name is Tom and I am the Business Development Manager at BrightPath Consulting.',
        after:
          'Your Q3 update mentioned the cloud migration twice, and both times the worry was the same.',
        dimension: 'Goodwill and reader focus',
      },
      {
        dim: 'log_mechanism',
        title: 'Show how, not just what',
        why: "Builders ask 'who does what, by when?'. A named method makes a familiar promise believable.",
        before: 'Our innovative approach delivers outstanding results for our clients.',
        after: 'We ran a two-week readiness check and gave each team a named coach.',
        dimension: 'Mechanism and reasoning',
      },
      {
        dim: 'log_objections',
        title: 'Answer the objection before she raises it',
        why: 'Two-sided messages that raise and answer a counter-argument beat one-sided messages in meta-analyses.',
        before: '(No objection addressed)',
        after: "You might be wondering whether this means another big programme. It doesn't.",
        dimension: 'Objection handling',
      },
      {
        dim: 'kai_call',
        title: 'Shrink the ask, and give a reason for now',
        why: "A small first step inside the reader's comfort zone is far more likely to be taken than a large one.",
        before: 'I would love to set up a 45-minute call to walk you through our capabilities.',
        after: 'Just reply "checklist". No call needed.',
        dimension: 'The call to act',
      },
    ],
    honesty:
      "The rewrite leaves two facts as placeholders: a comparable client and a result. HowDoesThisLand won't invent proof; Tom has to supply it, or cut the sentence.",
  },
  contentTypes: [
    'General content',
    'CV / résumé',
    'LinkedIn profile / bio',
    'Cover letter',
    'Landing page / website',
    'Product description',
    'Sales / outreach email',
    'Proposal / business case',
    'Pitch deck',
    'Executive briefing / board paper',
    'Change announcement / internal comms',
    'Case study',
    'Social post',
    'Press release',
    'Fundraising / charity appeal',
    'Speech / keynote',
  ],
  archetypes: [
    'General audience',
    'The Auditor',
    'The Builder',
    'The Pathfinder',
    'The Connector',
    'The Sceptic',
  ],
  audience: [
    {
      id: 'involvement',
      name: 'Reader involvement',
      options: ['High: reads carefully, big decision', 'Medium', 'Low: skims, small decision'],
    },
    {
      id: 'awareness',
      name: 'Reader awareness',
      options: [
        'Unaware of the problem',
        'Problem aware',
        'Solution aware',
        'Product aware',
        'Most aware',
      ],
    },
    {
      id: 'relationship',
      name: 'Relationship with the reader',
      options: ["Cold: they don't know you", 'Warm: some familiarity', 'Trusted relationship'],
    },
    {
      id: 'decision_unit',
      name: 'Who decides',
      options: ['One person', 'A buying group or panel'],
    },
    {
      id: 'archetype',
      name: 'Audience archetype',
      options: [
        'General audience',
        'The Auditor: Prove it',
        'The Builder: Show me the plan',
        'The Pathfinder: Where could this take us?',
        'The Connector: Who does this help?',
        "The Sceptic: Convince me I'm wrong",
      ],
    },
    {
      id: 'focus',
      name: "Reader's motivation",
      options: ['Not sure', 'Growth: wants gains and progress', 'Safety: wants to avoid mistakes'],
    },
    {
      id: 'expertise',
      name: "Reader's expertise in the topic",
      options: ['New to the topic', 'Informed', 'Expert'],
    },
  ],
  judgeCatalogue: [
    {
      id: 'core',
      name: 'The four appeals',
      description: 'Credibility, emotion, reason and timing. Always on.',
      always: true,
    },
    {
      id: 'craft',
      name: 'Craft editor',
      description: 'Structure, length, clarity, cohesion, tone and whether claims would stand up.',
      always: false,
    },
    {
      id: 'audience',
      name: 'Audience',
      description:
        'Fit to this reader, first impression, assumed knowledge and inclusive language.',
      always: false,
    },
    {
      id: 'culture',
      name: 'Culture',
      description: "Fit to the reader's culture on nine scales, plus idioms that won't travel.",
      always: false,
    },
    {
      id: 'lenses',
      name: 'Lenses and duties',
      description: 'Purpose, worldview, fit to form, dialogue, and what job the text is doing.',
      always: false,
    },
    {
      id: 'influence',
      name: 'Influence panel',
      description: 'Thirteen schools of influence, lever by lever.',
      always: false,
    },
  ],
  counts: {
    thinkers: 58,
    studies: 57,
    perspectives: 13,
    moves: 58,
  },
} as const;

export type Sample = typeof SAMPLE;
export type AppealId = 'ethos' | 'pathos' | 'logos' | 'kairos';
