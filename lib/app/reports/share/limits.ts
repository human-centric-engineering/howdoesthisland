/**
 * How often one IP may open share links (t-32), page and API together.
 *
 * Someone reading a report opens it a few times; a script guessing tokens
 * opens it as often as it is let. 256-bit tokens make guessing hopeless at
 * any rate, so this bounds the cost of the attempt (each one a database read)
 * rather than its odds. Shared by everyone behind one address, so it leaves
 * room for an office opening the same link.
 */
export const SHARED_REPORT_VIEWS_PER_MINUTE = 30;
