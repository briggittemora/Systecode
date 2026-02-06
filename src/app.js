require('dotenv').config();
const express = require('express');
const cors = require('cors');

const filesRouter = require('./routes/files');
const uploadRouter = require('./routes/upload');
const archivosRouter = require('./routes/archivos');
const membershipRouter = require('./routes/membership');
const meRouter = require('./routes/me');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// mount routers
app.use('/api', filesRouter);
app.use('/api', uploadRouter);
app.use('/api', membershipRouter);
app.use('/api', meRouter);
app.use('/', archivosRouter);

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Backend SysteCode' });
});

module.exports = app;
