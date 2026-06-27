const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeHtmlContent } = require('../src/utils/security');

test('sanitizeHtmlContent removes scripts and unsafe event handlers', () => {
  const html = '<div onclick="alert(1)">Hello</div><script>alert(1)</script><a href="javascript:alert(1)">x</a>';
  const result = sanitizeHtmlContent(html);

  assert.equal(result.includes('<script'), false);
  assert.equal(result.includes('onclick='), false);
  assert.equal(result.includes('javascript:'), false);
  assert.match(result, /Hello/);
});
