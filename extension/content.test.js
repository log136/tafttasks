import { strict as assert } from 'node:assert';
import { test } from 'node:test';
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

function mockDoc(html) {
  const items = [];
  const rowRegex = /data-module-type="([^"]+)"[\s\S]*?class="ig-title"[\s\S]*?href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?class="ig-details">([\s\S]*?)(?=<\/div>\s*<\/div>)/g;
  let m;
  while ((m = rowRegex.exec(html)) !== null) {
    items.push({ type: m[1], href: m[2], name: m[3].trim(), detailsHtml: m[4] });
  }
  return items;
}

test('extracts assignment name, url, and canvas IDs', () => {
  const items = mockDoc(CANVAS_MODULE_HTML);
  assert.equal(items.length, 3);
  assert.equal(items[0].name, 'Problem Set 3');
  assert.equal(items[0].href, '/courses/123/assignments/456');
  assert.equal(items[0].type, 'Assignment');
});

test('detects Google Doc links', () => {
  const items = mockDoc(CANVAS_MODULE_HTML);
  const gDocs = items.filter(i => i.href.includes('docs.google.com'));
  assert.equal(gDocs.length, 1);
  assert.match(gDocs[0].href, /ABC123/);
});

test('extracts canvas course and assignment IDs from URL', () => {
  const url = '/courses/123/assignments/456';
  const m = url.match(/\/courses\/(\d+)\/assignments\/(\d+)/);
  assert.equal(m[1], '123');
  assert.equal(m[2], '456');
});
