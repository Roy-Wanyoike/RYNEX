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
