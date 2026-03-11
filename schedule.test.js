// Tests for schedule utility functions
// Run: node --experimental-vm-modules node_modules/.bin/jest schedule.test.js

import { parseTaftTime, isCurrentBlock, advanceDay } from './schedule-utils.js';

describe('parseTaftTime', () => {
  test('parses am time', () => {
    const d = parseTaftTime('8:15 am');
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(15);
  });
  test('parses pm time', () => {
    const d = parseTaftTime('1:05 pm');
    expect(d.getHours()).toBe(13);
    expect(d.getMinutes()).toBe(5);
  });
  test('parses 12:00 pm as noon', () => {
    const d = parseTaftTime('12:00 pm');
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(0);
  });
  test('parses 12:00 am as midnight', () => {
    const d = parseTaftTime('12:00 am');
    expect(d.getHours()).toBe(0);
  });
});

describe('isCurrentBlock', () => {
  test('returns true when now is within block window', () => {
    const now = new Date(); now.setHours(10, 30, 0, 0);
    expect(isCurrentBlock({ start: '10:00 am', end: '11:00 am' }, now)).toBe(true);
  });
  test('returns false when now is before block', () => {
    const now = new Date(); now.setHours(9, 0, 0, 0);
    expect(isCurrentBlock({ start: '10:00 am', end: '11:00 am' }, now)).toBe(false);
  });
  test('returns false when now is at or after end', () => {
    const now = new Date(); now.setHours(11, 0, 0, 0);
    expect(isCurrentBlock({ start: '10:00 am', end: '11:00 am' }, now)).toBe(false);
  });
});

describe('advanceDay', () => {
  test('Monday advances to Tuesday', () => {
    expect(advanceDay(1, 1)).toBe(2);
  });
  test('Saturday advances to next Monday (skips Sunday)', () => {
    expect(advanceDay(6, 1)).toBe(1);
  });
  test('Saturday goes back to Friday', () => {
    expect(advanceDay(6, -1)).toBe(5);
  });
  test('Monday goes back to Saturday (skips Sunday)', () => {
    expect(advanceDay(1, -1)).toBe(6);
  });
});
