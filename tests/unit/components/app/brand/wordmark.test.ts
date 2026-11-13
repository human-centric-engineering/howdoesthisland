/**
 * Tests: components/app/brand/wordmark.tsx — how the header writes the name.
 *
 * The header asks the product's question; every other surface keeps the brand
 * name as a name, so only the header form changes.
 */
import { describe, expect, it } from 'vitest';
import { headerForm } from '@/components/app/brand/wordmark';

describe('headerForm', () => {
  it('sets our name as the question it asks', () => {
    expect(headerForm('HowDoesThisLand')).toBe('How does this land?');
  });

  it('shows any other name as it is', () => {
    expect(headerForm('Sunrise')).toBe('Sunrise');
    expect(headerForm('Acme')).toBe('Acme');
  });
});
