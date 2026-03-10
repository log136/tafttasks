import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { extractAssignments } from './content.js';

const CANVAS_MODULE_HTML = `
<div id="context_modules">
  <div class="context_module">
    <div class="ig-row" data-module-item-id="101" data-module-type="Assignment">
      <span class="ig-title">
        <a href="/courses/123/assignments/456">Problem Set 3</a>
      </span>
      <div class="ig-details">
        <div class="due_date_display">Jan 15 at 11:59pm</div>
      </div>
    </div>
    <div class="ig-row" data-module-item-id="102" data-module-type="Quiz">
      <span class="ig-title">
        <a href="/courses/123/quizzes/789">Chapter 4 Quiz</a>
      </span>
      <div class="ig-details"></div>
    </div>
    <div class="ig-row" data-module-item-id="103" data-module-type="ExternalUrl">
      <span class="ig-title">
        <a href="https://docs.google.com/document/d/ABC123/edit">Assignment Sheet</a>
      </span>
      <div class="ig-details"></div>
    </div>
  </div>
</div>`;

function makeDoc(html) {
  return new JSDOM(html).window.document;
}

test('extracts assignment name, url, type, and canvas IDs', () => {
  const { assignments } = extractAssignments(makeDoc(CANVAS_MODULE_HTML));
  assert.equal(assignments.length, 2); // Google Doc row excluded
  assert.equal(assignments[0].name, 'Problem Set 3');
  assert.equal(assignments[0].canvasCourseId, 123);
  assert.equal(assignments[0].canvasAssignmentId, 456);
  assert.equal(assignments[0].type, 'homework');
  assert.equal(assignments[1].type, 'quiz');
});

test('separates Google Doc links into googleDocIds', () => {
  const { assignments, googleDocIds } = extractAssignments(makeDoc(CANVAS_MODULE_HTML));
  assert.equal(googleDocIds.length, 1);
  assert.equal(googleDocIds[0], 'ABC123');
  assert.equal(assignments.length, 2); // Google Doc not in assignments
});

test('parseDue handles Canvas date format', () => {
  const { assignments } = extractAssignments(makeDoc(CANVAS_MODULE_HTML));
  // "Jan 15 at 11:59pm" should parse to a date string, not null
  assert.ok(assignments[0].due !== null, 'due date should not be null');
  assert.match(assignments[0].due, /^\d{4}-\d{2}-\d{2}$/);
});
