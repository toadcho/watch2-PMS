import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'pms-dev-jwt-secret';
const JWT_EXPIRES_IN = '2h';
const REFRESH_EXPIRES_IN = '7d';

export interface JwtPayload {
  userId: string;
  userName: string;
  email: string;
  systemRole: string;
  department?: string;
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function generateRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

// 인증 미들웨어
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  // Authorization 헤더 또는 쿼리 파라미터에서 토큰 추출
  const authHeader = req.headers.authorization;
  const queryToken = req.query?.token as string | undefined;
  const tokenStr = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : queryToken;

  if (!tokenStr) {
    res.status(401).json({ success: false, message: '인증 토큰이 필요합니다.' });
    return;
  }

  try {
    const token = tokenStr;
    const decoded = verifyToken(token);
    (req as any).user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ success: false, message: '토큰이 만료되었습니다.', errorCode: 'TOKEN_EXPIRED' });
    } else {
      res.status(401).json({ success: false, message: '유효하지 않은 토큰입니다.' });
    }
  }
}

// 역할 기반 인가
export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user as JwtPayload;
    if (!user || !roles.includes(user.systemRole)) {
      res.status(403).json({ success: false, message: '접근 권한이 없습니다.' });
      return;
    }
    next();
  };
}
