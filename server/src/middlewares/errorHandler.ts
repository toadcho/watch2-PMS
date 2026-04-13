import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Error:', err.message || err);

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    data: null,
    message: err.message || '서버 내부 오류가 발생했습니다.',
    errorCode: err.errorCode || 'ERR_INTERNAL',
  });
}
