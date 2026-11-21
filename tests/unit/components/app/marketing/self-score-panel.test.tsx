// @vitest-environment happy-dom

/**
 * Tests: the landing page's self-score panel (t-62).
 *
 * @see components/app/marketing/self-score-panel.tsx
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SelfScorePanel } from '@/components/app/marketing/self-score-panel';
import type { SelfScore } from '@/lib/app/quick-scan/self-score';

const SCORE: SelfScore = {
  overall: 63,
  band: 'Solid',
  appeals: [
    { id: 'ethos', score: 71 },
    { id: 'pathos', score: 50 },
    { id: 'logos', score: 73 },
    { id: 'kairos', score: 69 },
  ],
  weakest: 'pathos',
  scoredWith: 'howdoesthisland@0.5.1',
};

describe('SelfScorePanel', () => {
  it('shows the score, its band, the version that scored it and the weakest appeal', () => {
    render(<SelfScorePanel score={SCORE} />);
    const panel = screen.getByTestId('self-score');
    expect(panel).toHaveTextContent('Quick scan · howdoesthisland@0.5.1');
    expect(panel).toHaveTextContent('Solid · out of 100');
    expect(panel).toHaveTextContent('Solid, not perfect. Weakest appeal: pathos.');
  });

  it('names each appeal beside its score', () => {
    render(<SelfScorePanel score={SCORE} />);
    const chart = screen.getByTestId('self-score-appeals');
    for (const [name, value] of [
      ['Ethos', '71'],
      ['Pathos', '50'],
      ['Logos', '73'],
      ['Kairos', '69'],
    ]) {
      expect(chart).toHaveTextContent(name);
      expect(chart).toHaveTextContent(value);
    }
  });

  it('does not call a perfect score imperfect', () => {
    render(<SelfScorePanel score={{ ...SCORE, overall: 100, band: 'Exceptional' }} />);
    const panel = screen.getByTestId('self-score');
    expect(panel).toHaveTextContent('Exceptional. Weakest appeal');
    expect(panel).not.toHaveTextContent('not perfect');
  });
});
