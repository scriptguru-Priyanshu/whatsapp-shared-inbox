import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'

export type AuthUser = { id: string; email: string; name: string; role: string }
export type AuthRequest = Request & { user?: AuthUser }
const secret = () => process.env.JWT_SECRET || 'relay-local-development-secret-change-me'

export function signToken(user: AuthUser) { return jwt.sign(user, secret(), { expiresIn: '12h' }) }
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || String(req.query.token || '')
  try { req.user = jwt.verify(token, secret()) as AuthUser; next() }
  catch { res.status(401).json({ error: 'Please sign in to continue' }) }
}
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Administrator access is required' })
  next()
}
