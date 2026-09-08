import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import express from 'express';
import router from './Router';
import authRouter from './Router/authRoute';
import productRoute from './Router/product.router';
import cartRoute from './Router/cartRouter';
import modulesRouter from './Router/modules';
import notFound from './Middlewares/notFound';
import errorHandler from './Middlewares/errorHandler';

// Load environment variables from Backend/.env before anything reads them.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();

// Manual CORS (no external cors package).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  );

  // Answer preflight requests directly.
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

app.use(express.json({ limit: '1mb' }));

// Health check.
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'API healthy' });
});

// Routes.
app.use('/users', router);
app.use('/auth', authRouter);
app.use('/products', productRoute);
app.use('/cart', cartRoute);

// RYNEX versioned platform gateway (Trust, Passport, Intelligence, Parts,
// Service, Fleet, Finance, Data). Modules self-register in Router/modules.
// Version banner: every /api/v1 response advertises the API version.
app.use('/api/v1', (_req, res, next) => {
  res.setHeader('X-API-Version', 'v1');
  next();
});

// OpenAPI 3 contract for the gateway, served straight from the service root.
// path.resolve(__dirname, '../openapi.yaml') resolves to
// <service-root>/openapi.yaml for BOTH layouts:
//   - compiled:  dist/server.js   -> __dirname = <root>/dist -> ../ = <root>
//   - in-place:  src/server.js    -> __dirname = <root>/src  -> ../ = <root>
app.get('/api/v1/openapi.yaml', (_req, res) => {
  try {
    const spec = fs.readFileSync(path.resolve(__dirname, '../openapi.yaml'), 'utf8');
    res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
    res.status(200).send(spec);
  } catch (error) {
    console.error('[openapi] failed to read openapi.yaml:', error);
    res.status(500).json({ success: false, message: 'OpenAPI contract unavailable' });
  }
});

app.use('/api/v1', modulesRouter);

// 404 handler first, then the global error handler.
app.use(notFound);
app.use(errorHandler);

export default app;

// Only start listening when executed directly (tests import the app).
if (require.main === module) {
  const port = process.env.PORT || 4000;
  app.listen(port, () => console.log(`Server running on port ${port}`));
}
