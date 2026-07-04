const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGitHubPagesFileUrl } = require('../src/utils/githubPages');

test('builds GitHub Pages URL from owner/repo when no base URL is provided', () => {
  const url = buildGitHubPagesFileUrl({
    owner: 'baque2005',
    repo: 'public-files',
    path: 'files/1782079656421_formulas-geogebra.html',
  });

  assert.equal(url, 'https://baque2005.github.io/public-files/files/1782079656421_formulas-geogebra.html');
});

test('uses explicit base URL when provided', () => {
  const url = buildGitHubPagesFileUrl({
    owner: 'baque2005',
    repo: 'public-files',
    baseUrl: 'https://baque2005.github.io/public-files',
    path: 'files/example.html',
  });

  assert.equal(url, 'https://baque2005.github.io/public-files/files/example.html');
});
