/**
 * The app's model file is a byte-identical copy of the reviewed model in
 * `prototype/` (app-plan §2), and its checksum is recorded here, so a change
 * to either is deliberate and seen in review.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sha256 } from '@/lib/app/frameworks/store';

const DATA = 'lib/app/frameworks/howdoesthisland/data/model-0.5.1.json';
const PROTOTYPE = 'prototype/howdoesthisland_model.json';
const SHA256_0_5_1 = '6b4f0d80a0eaf60ccab2ab9b7a99b96d53d6d0f850fcbf3f98c1c797d187344e';

describe('model-0.5.1.json', () => {
  it('is byte-identical to the prototype’s model', () => {
    expect(readFileSync(DATA).equals(readFileSync(PROTOTYPE))).toBe(true);
  });

  it('has the recorded sha256', () => {
    expect(sha256(readFileSync(DATA, 'utf8'))).toBe(SHA256_0_5_1);
  });

  it('is version 0.5.1, as its name says', () => {
    const meta = (JSON.parse(readFileSync(DATA, 'utf8')) as { meta: { version: string } }).meta;
    expect(meta.version).toBe('0.5.1');
  });
});
