require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const filesRouter = require('./routes/files');
const uploadRouter = require('./routes/upload');
const archivosRouter = require('./routes/archivos');
const membershipRouter = require('./routes/membership');
const meRouter = require('./routes/me');
const purchasesRouter = require('./routes/purchases');
const guestPurchasesRouter = require('./routes/guestPurchases');
const profileRouter = require('./routes/profile');
const configRouter = require('./routes/config');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple request logger to help debug missing routes
app.use((req, res, next) => {
  try {
    console.log(`[req] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  } catch (e) {}
  next();
});

const NODE_ENV = process.env.NODE_ENV || 'development';
const CLIENT_URL_DEV = process.env.CLIENT_URL_DEV || 'http://localhost:3000';
const CLIENT_URL_PROD = process.env.CLIENT_URL_PROD || null;

// Build allowed origins from env; include localhost dev hosts by default.
const allowedOrigins = [CLIENT_URL_PROD, CLIENT_URL_DEV, 'http://localhost:5173', 'http://127.0.0.1:5173']
  .filter(Boolean);

// Apply CORS middleware that allows both dev and prod origins. If origin is not
// in the allow list, respond without CORS headers instead of throwing an error.
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow non-browser requests like curl/postman (no origin)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
      // Deny by returning `false` (no CORS headers) rather than erroring.
      return callback(null, false);
    },
    credentials: true,
  })
);

// Serve built frontend (Vite) when available.
// Prefer backend/dist, then dist/ at repo root, then frontend/dist.
const backendDistPath = path.resolve(__dirname, '..', 'dist');
const rootDistPath = path.resolve(__dirname, '..', '..', 'dist');
const frontendDistPath = path.resolve(__dirname, '..', '..', 'frontend', 'dist');

const backendDistExists = fs.existsSync(backendDistPath);
const rootDistExists = fs.existsSync(rootDistPath);
const frontendDistExists = fs.existsSync(frontendDistPath);

const distPath = backendDistExists
  ? backendDistPath
  : (rootDistExists
    ? rootDistPath
    : (frontendDistExists ? frontendDistPath : null));

// Debug logs to verify which dist path is used (useful in Render).
console.log('[static] NODE_ENV:', NODE_ENV);
console.log('[static] cwd:', process.cwd());
console.log('[static] __dirname:', __dirname);
console.log('[static] backend/dist:', backendDistPath, 'exists=', backendDistExists);
console.log('[static] backend/dist/index.html exists=', fs.existsSync(path.join(backendDistPath, 'index.html')));
console.log('[static] root dist:', rootDistPath, 'exists=', rootDistExists);
console.log('[static] root dist/index.html exists=', fs.existsSync(path.join(rootDistPath, 'index.html')));
console.log('[static] frontend/dist:', frontendDistPath, 'exists=', frontendDistExists);
console.log('[static] frontend/dist/index.html exists=', fs.existsSync(path.join(frontendDistPath, 'index.html')));
console.log('[static] serving distPath:', distPath || '(none)');

// mount routers
app.use('/api', filesRouter);
app.use('/api', uploadRouter);
app.use('/api', membershipRouter);
app.use('/api', meRouter);
app.use('/api', purchasesRouter);
app.use('/api', guestPurchasesRouter);
app.use('/api/profile', profileRouter);
app.use('/api', configRouter);

if (distPath) {
  app.use(express.static(distPath));

  // SPA fallback: serve index.html for non-API routes.
  app.get(/^\/(?!api\/).*/, (req, res) => {
    return res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // If we are NOT serving the SPA, keep the legacy redirect route.
  // (In production with dist present, /archivos/:slug/:id is handled by the frontend router.)
  app.use('/', archivosRouter);

  // Dev/diagnostic root response when the frontend build is not present.
  app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Backend SysteCode' });
  });
}

module.exports = app;
