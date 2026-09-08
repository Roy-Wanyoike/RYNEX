import { NextFunction, Request, Response } from 'express';

/**
 * Error shape accepted by the error handler.
 * Allows either `status` or `statusCode` to carry the HTTP code.
 */
export interface HttpError extends Error {
  status?: number;
  statusCode?: number;
}

/**
 * Global error-handling middleware (Express 4, 4-argument signature).
 * Logs the full error server-side but never leaks raw exception
 * details to clients: 5xx responses use a generic message.
 */
const errorHandler = (
  err: HttpError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error(err);

  const status = err.status || err.statusCode || 500;

  res.status(status).json({
    success: false,
    message: status >= 500 ? 'Internal server error' : err.message
  });
};

export { errorHandler };
export default errorHandler;
