import { RequestHandler } from 'express';

/**
 * Catch-all for unmatched routes. Mounted after every router so any
 * request that falls through receives a JSON 404 instead of the
 * default HTML error page.
 */
const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
};

export { notFound };
export default notFound;
