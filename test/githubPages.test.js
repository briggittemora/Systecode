const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGitHubPagesFilePath, buildGitHubPagesFileUrl, buildStorageHtmlPath } = require('../src/utils/githubPages');

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

test('preserves the existing GitHub Pages path when re-publishing an uploaded file', () => {
  const path = buildGitHubPagesFilePath({
    id: '580',
    name: 'te-amo-solo-a-ti',
    preferredFilename: 'te-amo-solo-a-ti.html',
    existingUrl: 'https://baque2005.github.io/public-files/files/1783655694758_te-amo-solo-a-ti.html',
  });

  assert.equal(path, 'files/1783655694758_te-amo-solo-a-ti.html');
});

test('preserves the existing storage path when updating an uploaded HTML file', () => {
  const path = buildStorageHtmlPath({
    id: '580',
    originalName: 'te-amo-solo-a-ti.html',
    existingPath: 'html/1783655694758_te-amo-solo-a-ti.html',
  });

  assert.equal(path, 'html/1783655694758_te-amo-solo-a-ti.html');
});

test('builds a user-specific GitHub Pages path for personalizations', () => {
  const path = buildGitHubPagesFilePath({
    id: '580',
    name: 'usuario galaxia para ti',
    preferredFilename: 'usuario-galaxia-para-ti.html',
    userId: '524',
    personalization: true,
    timestamp: '1782973615598',
  });

  assert.equal(path, '524-usuario-galaxia-para-ti-1782973615598.html');
});

test('builds a user-specific GitHub Pages path when userId is an object', () => {
  const path = buildGitHubPagesFilePath({
    id: '580',
    name: 'usuario galaxia para ti',
    preferredFilename: 'usuario-galaxia-para-ti.html',
    userId: { id: '524' },
    personalization: true,
    timestamp: '1782973615598',
  });

  assert.equal(path, '524-usuario-galaxia-para-ti-1782973615598.html');
});

test('builds a user-specific storage path for personalized HTML files', () => {
  const path = buildStorageHtmlPath({
    id: '580',
    originalName: 'usuario-galaxia-para-ti.html',
    userId: '524',
    personalization: true,
  });

  assert.equal(path, 'html/524_580_usuario-galaxia-para-ti.html');
});
