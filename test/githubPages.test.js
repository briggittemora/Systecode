const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGitHubPagesFilePath, buildGitHubPagesFileUrl } = require('../src/utils/githubPages');

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

test('shortens very long file names for GitHub Pages paths', () => {
  const path = buildGitHubPagesFilePath({
    id: '1782813816460',
    name: '557 usuario buenos días mi vida. Hoy desperté con tu sonrisa en mi mente y con el corazón lleno de alegría por tenerte en mi vida. Eres mi razón, mi paz y mi mayor tesoro.',
  });

  assert.match(path, /^files\/1782813816460_[a-z0-9-]+\.html$/i);
  assert.ok(path.length < 180);
});
