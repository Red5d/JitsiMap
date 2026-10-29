import { describe, expect, it } from 'vitest';

import { isTypingTarget } from '../src/game/movement';

describe('isTypingTarget (§5.3 keyboard yields to typing)', () => {
  it('matches text-entry elements by tagName', () => {
    expect(isTypingTarget({ tagName: 'input' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'select' })).toBe(true);
  });

  it('matches contentEditable elements', () => {
    expect(isTypingTarget({ tagName: 'div', isContentEditable: true })).toBe(true);
  });

  it('rejects non-text elements and non-objects', () => {
    expect(isTypingTarget({ tagName: 'div', isContentEditable: false })).toBe(false);
    expect(isTypingTarget({ tagName: 'CANVAS' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget('input')).toBe(false);
    expect(isTypingTarget(42)).toBe(false);
  });
});
