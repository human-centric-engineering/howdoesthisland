/**
 * Where the ideas behind HowDoesThisLand come from, for someone meeting them
 * for the first time (t-63). The public pages cite these by id: the model
 * explainer (`./chapters.ts`) and `/about`.
 *
 * Each source says who, what and when, and in one or two sentences why it
 * matters here, so a citation never leaves a reader asking "who is that?".
 * A link goes to a stable, readable account (an encyclopedia entry, or the
 * paper itself by DOI) where there is one.
 *
 * Copy, not model data: nothing here is read from the model, and the model
 * does not read this.
 */

export interface Source {
  id: string;
  /** How the source is named in a citation: `Kunda (1990)`. */
  cite: string;
  /** The work itself. */
  title: string;
  /** Who, for a reader who does not know: `Ziva Kunda, a social psychologist`. */
  who: string;
  /** When it appeared, as people say it. */
  when: string;
  /** Why it matters to how a message lands, in plain words. */
  context: string;
  /** A stable place to read more, when there is one. */
  url?: string;
}

export const SOURCES: readonly Source[] = [
  {
    id: 'aristotle-rhetoric',
    cite: 'Aristotle, Rhetoric',
    title: 'Rhetoric',
    who: 'Aristotle, the Greek philosopher who taught in Athens',
    when: '4th century BC',
    context:
      'The first systematic handbook on persuasion. It names three ways a speech persuades: through the speaker’s character (ethos), the audience’s feelings (pathos) and the argument itself (logos). It also asks that style fit the subject and the audience.',
    url: 'https://plato.stanford.edu/entries/aristotle-rhetoric/',
  },
  {
    id: 'cicero-de-oratore',
    cite: 'Cicero, De Oratore',
    title: 'De Oratore (On the Orator)',
    who: 'Marcus Tullius Cicero, the Roman statesman, lawyer and orator',
    when: '55 BC',
    context:
      'Cicero wrote that a speaker has three jobs: to teach (docere), to delight (delectare) and to move (movere). The idea that a piece of writing has a job to do for its reader starts here.',
    url: 'https://en.wikipedia.org/wiki/De_Oratore',
  },
  {
    id: 'kairos',
    cite: 'Kairos, Greek rhetoric',
    title: 'Kairos: the opportune moment',
    who: 'The Greek rhetoricians, among them Gorgias and Isocrates',
    when: '5th and 4th centuries BC',
    context:
      'The Greeks had two words for time: chronos, time passing, and kairos, the right moment. Saying the right thing at the wrong time persuades no one, so timeliness was treated as part of persuasion itself.',
    url: 'https://en.wikipedia.org/wiki/Kairos',
  },
  {
    id: 'peitho',
    cite: 'Peitho',
    title: 'Peitho, goddess of persuasion',
    who: 'A figure of Greek religion and myth',
    when: 'Ancient Greece',
    context:
      'Peitho personified persuasion and was linked with goodwill and attraction rather than force. In Greek, the word for persuasion sits close to pistis, trust.',
    url: 'https://en.wikipedia.org/wiki/Peitho',
  },
  {
    id: 'socratic-method',
    cite: 'Socrates, elenchus',
    title: 'The Socratic method (elenchus)',
    who: 'Socrates, the Athenian philosopher, as Plato records him',
    when: '5th century BC',
    context:
      'Socrates questioned people until they saw that something they took for granted did not hold. Writing that helps a reader rethink an assumption, rather than just agree, follows him.',
    url: 'https://en.wikipedia.org/wiki/Socratic_method',
  },
  {
    id: 'newton-1990',
    cite: 'Newton (1990)',
    title: 'The song-tapping study, from her doctoral research',
    who: 'Elizabeth Newton, then a psychology doctoral student at Stanford University',
    when: '1990',
    context:
      'People tapped out well-known songs for listeners to name. Tappers expected about half to be recognised; listeners named about one in forty. It is the best-known demonstration of the curse of knowledge.',
    url: 'https://en.wikipedia.org/wiki/Curse_of_knowledge',
  },
  {
    id: 'camerer-1989',
    cite: 'Camerer, Loewenstein and Weber (1989)',
    title: 'The curse of knowledge in economic settings',
    who: 'Colin Camerer, George Loewenstein and Martin Weber, economists',
    when: '1989, in the Journal of Political Economy',
    context:
      'Named the curse of knowledge: once you know something, you find it hard to imagine not knowing it, and you misjudge what others know. Every writer reading their own draft is under it.',
    url: 'https://en.wikipedia.org/wiki/Curse_of_knowledge',
  },
  {
    id: 'kunda-1990',
    cite: 'Kunda (1990)',
    title: 'The case for motivated reasoning',
    who: 'Ziva Kunda, a social psychologist',
    when: '1990, in Psychological Bulletin',
    context:
      'People reason towards the conclusions they want, accepting welcome evidence easily and picking at unwelcome evidence. A message that threatens what a reader wants to believe has to work much harder.',
    url: 'https://doi.org/10.1037/0033-2909.108.3.480',
  },
  {
    id: 'friestad-wright-1994',
    cite: 'Friestad and Wright (1994)',
    title: 'The persuasion knowledge model',
    who: 'Marian Friestad and Peter Wright, consumer researchers',
    when: '1994, in the Journal of Consumer Research',
    context:
      'Readers learn to recognise persuasion tactics, and when they spot one they discount the message or push back. It is why polish and formula persuade less than they used to.',
    url: 'https://doi.org/10.1086/209380',
  },
  {
    id: 'okeefe-hoeken-2021',
    cite: 'O’Keefe and Hoeken (2021)',
    title:
      'Message design choices don’t make much difference to persuasiveness and can’t be counted on',
    who: 'Daniel O’Keefe and Hans Hoeken, communication researchers',
    when: '2021, in Frontiers in Psychology',
    context:
      'Across more than a thousand studies, choices like story versus data or gain versus loss made small and inconsistent differences. Who the reader is, what you offer and whether they trust you usually matter more. It is why a score is guidance, not a forecast.',
    url: 'https://doi.org/10.3389/fpsyg.2021.664160',
  },
  {
    id: 'petty-cacioppo-elm',
    cite: 'Petty and Cacioppo (1986)',
    title: 'The Elaboration Likelihood Model of persuasion',
    who: 'Richard Petty and John Cacioppo, social psychologists',
    when: '1986',
    context:
      'A reader who cares and has time weighs the argument closely; a reader who does not goes by surface cues such as length, confidence or who is speaking. The same copy can succeed with one and fail with the other.',
    url: 'https://en.wikipedia.org/wiki/Elaboration_likelihood_model',
  },
  {
    id: 'need-for-cognition',
    cite: 'Cacioppo and Petty (1982)',
    title: 'Need for cognition',
    who: 'John Cacioppo and Richard Petty, social psychologists',
    when: '1982',
    context:
      'Some people enjoy thinking things through and want the reasoning; others prefer a clear conclusion. It is one of the research dimensions the reader types are built on.',
    url: 'https://en.wikipedia.org/wiki/Need_for_cognition',
  },
  {
    id: 'higgins-regulatory-focus',
    cite: 'Higgins (1997)',
    title: 'Regulatory focus theory',
    who: 'E. Tory Higgins, a social psychologist',
    when: '1997',
    context:
      'Some readers are drawn by gains and growth, others by safety and avoiding mistakes. A message framed for the motivation the reader already has tends to feel more right to them.',
    url: 'https://en.wikipedia.org/wiki/Regulatory_focus_theory',
  },
  {
    id: 'schwartz-1966',
    cite: 'Schwartz (1966)',
    title: 'Breakthrough Advertising',
    who: 'Eugene Schwartz, an American copywriter',
    when: '1966',
    context:
      'Copy has to meet the reader where their awareness is: unaware of the problem, aware of it, aware of solutions, or already comparing yours. An opening that suits one stage loses the others.',
  },
  {
    id: 'cialdini-influence',
    cite: 'Cialdini (1984)',
    title: 'Influence: The Psychology of Persuasion',
    who: 'Robert Cialdini, a social psychologist',
    when: '1984, revised since',
    context:
      'Set out principles of influence such as reciprocity, social proof, authority, liking, scarcity and commitment, and later unity. They work, which is exactly why they are easy to misuse.',
    url: 'https://en.wikipedia.org/wiki/Influence:_Science_and_Practice',
  },
  {
    id: 'kahneman-2011',
    cite: 'Kahneman (2011)',
    title: 'Thinking, Fast and Slow',
    who: 'Daniel Kahneman, a psychologist awarded the Nobel prize in economics',
    when: '2011',
    context:
      'Most judgements are made quickly and intuitively, and only some are checked by slow, effortful thought. Copy that is easy to process gets a kinder first reading.',
    url: 'https://en.wikipedia.org/wiki/Thinking,_Fast_and_Slow',
  },
  {
    id: 'heath-made-to-stick',
    cite: 'Heath and Heath (2007)',
    title: 'Made to Stick',
    who: 'Chip Heath and Dan Heath, writers on business and psychology',
    when: '2007',
    context:
      'Ideas that last tend to be simple, unexpected, concrete, credible, emotional and told as stories. The book popularised Newton’s tapping study.',
    url: 'https://en.wikipedia.org/wiki/Made_to_Stick',
  },
  {
    id: 'fiske-warmth-competence',
    cite: 'Fiske and colleagues (2002)',
    title: 'The stereotype content model: warmth and competence',
    who: 'Susan Fiske, Amy Cuddy, Peter Glick and Jun Xu, social psychologists',
    when: '2002',
    context:
      'We judge others on two things first: are they on my side (warmth), and can they do it (competence)? Credibility in writing needs both.',
    url: 'https://en.wikipedia.org/wiki/Stereotype_content_model',
  },
  {
    id: 'trusted-advisor',
    cite: 'Maister, Green and Galford (2000)',
    title: 'The Trusted Advisor',
    who: 'David Maister, Charles H. Green and Robert Galford, consultants',
    when: '2000',
    context:
      'Proposed the trust equation: credibility, reliability and intimacy, divided by self-orientation. The more a message is about the writer, the less it is trusted.',
  },
  {
    id: 'pratfall-effect',
    cite: 'Aronson and colleagues (1966)',
    title: 'The pratfall effect',
    who: 'Elliot Aronson, Ben Willerman and Joanne Floyd, social psychologists',
    when: '1966',
    context:
      'A competent person who admits a small flaw can become more likeable. In writing, admitting a limit helps credibility, as long as you then answer it.',
    url: 'https://en.wikipedia.org/wiki/Pratfall_effect',
  },
  {
    id: 'illusory-truth',
    cite: 'Reber and Schwarz (1999)',
    title: 'Processing fluency and the illusory truth effect',
    who: 'Rolf Reber and Norbert Schwarz, psychologists',
    when: '1999',
    context:
      'Statements that are easy to read are more likely to be judged true. Clarity is not decoration: it changes how much a reader believes you.',
    url: 'https://en.wikipedia.org/wiki/Illusory_truth_effect',
  },
  {
    id: 'brehm-reactance',
    cite: 'Brehm (1966)',
    title: 'Psychological reactance',
    who: 'Jack Brehm, a social psychologist',
    when: '1966',
    context:
      'When people feel their freedom to choose is threatened, they push back, sometimes towards the very thing they were told not to do. Pressure and commands often defeat themselves.',
    url: 'https://en.wikipedia.org/wiki/Reactance_(psychology)',
  },
  {
    id: 'inoculation-theory',
    cite: 'McGuire (1961)',
    title: 'Inoculation theory',
    who: 'William McGuire, a social psychologist',
    when: '1961',
    context:
      'Raising a counter-argument and answering it makes a position more resistant to that argument later, much as a vaccine works. It is why answering objections beats ignoring them.',
    url: 'https://en.wikipedia.org/wiki/Inoculation_theory',
  },
  {
    id: 'green-brock-transportation',
    cite: 'Green and Brock (2000)',
    title: 'Narrative transportation',
    who: 'Melanie Green and Timothy Brock, psychologists',
    when: '2000',
    context:
      'A reader carried into a story argues back less and is more open to what it implies. Story persuades by changing how a reader engages, not just what they learn.',
    url: 'https://en.wikipedia.org/wiki/Transportation_theory_(psychology)',
  },
  {
    id: 'witte-eppm',
    cite: 'Witte (1992)',
    title: 'The extended parallel process model',
    who: 'Kim Witte, a communication researcher',
    when: '1992',
    context:
      'A threat moves people to act only when they also believe they can do something about it. Fear without a way forward produces denial instead.',
    url: 'https://en.wikipedia.org/wiki/Extended_parallel_process_model',
  },
  {
    id: 'anchoring',
    cite: 'Tversky and Kahneman (1974)',
    title: 'Anchoring and adjustment',
    who: 'Amos Tversky and Daniel Kahneman, psychologists',
    when: '1974, in Science',
    context:
      'Judgements lean towards whatever number or comparison comes first. Readers judge value relative to something, so what you compare yourself with matters.',
    url: 'https://en.wikipedia.org/wiki/Anchoring_effect',
  },
  {
    id: 'framing-effect',
    cite: 'Tversky and Kahneman (1981)',
    title: 'The framing of decisions',
    who: 'Amos Tversky and Daniel Kahneman, psychologists',
    when: '1981, in Science',
    context:
      'The same facts described as a gain or as a loss can lead to different choices. Later research found the effect on persuasion smaller and less reliable than often claimed.',
    url: 'https://en.wikipedia.org/wiki/Framing_effect_(psychology)',
  },
  {
    id: 'godin',
    cite: 'Godin (2008)',
    title: 'Tribes',
    who: 'Seth Godin, a marketer and author',
    when: '2008',
    context:
      'People join ideas that say something about who they are: “people like us do things like this.” Messages that offer belonging travel further than messages that only inform.',
    url: 'https://en.wikipedia.org/wiki/Seth_Godin',
  },
  {
    id: 'hopkins',
    cite: 'Hopkins (1923)',
    title: 'Scientific Advertising',
    who: 'Claude C. Hopkins, an American advertising pioneer',
    when: '1923',
    context:
      'Argued that specific claims persuade and general ones do not: a vague boast is shrugged off, while a precise, testable claim is believed.',
    url: 'https://en.wikipedia.org/wiki/Claude_C._Hopkins',
  },
  {
    id: 'fogg',
    cite: 'Fogg (2009)',
    title: 'The Fogg behaviour model',
    who: 'BJ Fogg, a behaviour scientist at Stanford University',
    when: '2009',
    context:
      'A behaviour happens when motivation, ability and a prompt come together. Copy that motivates but makes the next step hard, or never asks, loses the reader at the last moment.',
    url: 'https://en.wikipedia.org/wiki/Fogg_behavior_model',
  },
  {
    id: 'self-determination',
    cite: 'Deci and Ryan (1985)',
    title: 'Self-determination theory',
    who: 'Edward Deci and Richard Ryan, psychologists',
    when: '1985',
    context:
      'People act most willingly when they feel the choice is theirs, they are able to do it, and it connects them to others. Persuasion that respects choice lasts longer than pressure.',
    url: 'https://en.wikipedia.org/wiki/Self-determination_theory',
  },
  {
    id: 'moral-foundations',
    cite: 'Haidt (2012)',
    title: 'The Righteous Mind and moral foundations theory',
    who: 'Jonathan Haidt, a social psychologist',
    when: '2012',
    context:
      'People weigh values such as care, fairness, loyalty, authority and liberty differently. A case made in the writer’s values can miss a reader who holds different ones.',
    url: 'https://en.wikipedia.org/wiki/Moral_foundations_theory',
  },
  {
    id: 'nudge',
    cite: 'Thaler and Sunstein (2008)',
    title: 'Nudge',
    who: 'Richard Thaler, an economist, and Cass Sunstein, a legal scholar',
    when: '2008',
    context:
      'How a choice is presented shapes what people choose. Behavioural economics brought anchors, defaults and framing into everyday persuasion.',
    url: 'https://en.wikipedia.org/wiki/Nudge_(book)',
  },
  {
    id: 'tares',
    cite: 'Baker and Martinson (2001)',
    title: 'The TARES test of ethical persuasion',
    who: 'Sherry Baker and David Martinson, scholars of media ethics',
    when: '2001',
    context:
      'Five questions for persuasion: is it truthful, authentic, respectful, equitable and socially responsible? HowDoesThisLand asks them of every review.',
  },
  {
    id: 'dark-patterns',
    cite: 'Brignull (2010)',
    title: 'Dark patterns',
    who: 'Harry Brignull, a user-experience designer, who coined the term',
    when: '2010',
    context:
      'Design and wording that tricks people into choices they did not mean to make, such as shaming someone for saying no. Readers increasingly recognise them, and regulators act on them.',
    url: 'https://en.wikipedia.org/wiki/Dark_pattern',
  },
  {
    id: 'gunning-fog',
    cite: 'Gunning (1952)',
    title: 'The Gunning fog index',
    who: 'Robert Gunning, an American businessman and writer on readability',
    when: '1952',
    context:
      'A readability measure built from sentence length and long words, roughly the years of schooling a reader needs to follow a text on one read.',
    url: 'https://en.wikipedia.org/wiki/Gunning_fog_index',
  },
];

const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

/** A source by id; throws on an id the list does not have (a test checks every citation). */
export function source(id: string): Source {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`No source "${id}"`);
  return found;
}
