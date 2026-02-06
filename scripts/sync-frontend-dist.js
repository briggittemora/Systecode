/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function rmDirSafe(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const link = fs.readlinkSync(srcPath);
      fs.symlinkSync(link, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const frontendDist = path.resolve(repoRoot, 'frontend', 'dist');
  const backendDist = path.resolve(repoRoot, 'backend', 'dist');

  if (!fs.existsSync(frontendDist)) {
    console.error('[sync-frontend-dist] No existe frontend/dist. Ejecuta el build del frontend antes.');
    process.exit(1);
  }

  rmDirSafe(backendDist);
  copyDir(frontendDist, backendDist);

  const indexHtml = path.join(backendDist, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    console.error('[sync-frontend-dist] Copia realizada pero falta dist/index.html en backend/dist.');
    process.exit(1);
  }

  console.log('[sync-frontend-dist] OK: frontend/dist -> backend/dist');
}

main();
