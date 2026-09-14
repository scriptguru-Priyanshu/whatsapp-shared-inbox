import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../db.js'
import { requireAdmin, requireAuth, signToken, type AuthRequest } from '../auth.js'

export const authRouter = Router()

authRouter.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), password = String(req.body.password || '')
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user?.active || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password' })
  const safe = { id: user.id, email: user.email, name: user.name, role: user.role }
  res.json({ token: signToken(safe), user: safe })
})
authRouter.use(requireAuth)
authRouter.get('/me', (req: AuthRequest, res) => res.json(req.user))
authRouter.get('/agents', async (_req, res) => res.json(await prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, active: true, createdAt: true }, orderBy: { createdAt: 'desc' } })))
authRouter.post('/agents', requireAdmin, async (req, res) => {
  const name = String(req.body.name || '').trim(), email = String(req.body.email || '').trim().toLowerCase(), password = String(req.body.password || '')
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return res.status(400).json({ error: 'Enter a name, valid email, and password of at least 8 characters' })
  try { res.status(201).json(await prisma.user.create({ data: { name, email, passwordHash: await bcrypt.hash(password, 12), role: 'AGENT' }, select: { id: true, email: true, name: true, role: true, active: true, createdAt: true } })) }
  catch { res.status(409).json({ error: 'An account with this email already exists' }) }
})
