import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseClaudeResponse } from './ai-parse.js';

test('parseClaudeResponse extracts assignment array from valid JSON', () => {
  const raw = JSON.stringify({
    assignments: [
      { name: 'Read chapter 3', type: 'reading', due: '2026-01-15' },
      { name: 'Problem set 4', type: 'homework', due: null },
    ],
  });
  const result = parseClaudeResponse(raw);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'Read chapter 3');
  assert.equal(result[0].type, 'reading');
});

test('parseClaudeResponse returns empty array for malformed JSON', () => {
  const result = parseClaudeResponse('not json at all');
  assert.deepEqual(result, []);
});

test('parseClaudeResponse handles missing assignments key', () => {
  const result = parseClaudeResponse(JSON.stringify({ items: [] }));
  assert.deepEqual(result, []);
});
