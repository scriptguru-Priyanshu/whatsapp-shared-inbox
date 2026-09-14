import { Router } from 'express'
import { requireAdmin } from '../auth.js'
import { prisma } from '../db.js'
import { encryptConnectionToken } from '../services/connection-token.js'
import { required } from '../services/meta.js'

export const whatsappConnectionsRouter = Router()

whatsappConnectionsRouter.use(requireAdmin)

function embeddedSignupConfig() {
  const hostedUrl = required('META_HOSTED_SIGNUP_URL')
  const parsed = new URL(hostedUrl)
  if (parsed.protocol !== 'https:') throw new Error('META_HOSTED_SIGNUP_URL must use HTTPS')
  const appId = process.env.META_APP_ID?.trim() || parsed.searchParams.get('app_id')
  const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim() || parsed.searchParams.get('config_id')
  if (!appId) throw new Error('META_APP_ID is required for SDK Embedded Signup')
  if (!configId) throw new Error('META_EMBEDDED_SIGNUP_CONFIG_ID is required for SDK Embedded Signup')
  return { hostedUrl, appId, configId, graphApiVersion: process.env.META_GRAPH_API_VERSION?.trim() || 'v26.0' }
}

whatsappConnectionsRouter.get('/config', (_req, res) => {
  try {
    res.json(embeddedSignupConfig())
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'Embedded Signup is not configured' })
  }
})

whatsappConnectionsRouter.get('/', async (_req, res) => {
  const rows = await prisma.whatsAppConnection.findMany({ orderBy: { createdAt: 'desc' } })
  res.json(rows.map(({ tokenCiphertext: _token, ...row }) => row))
})

whatsappConnectionsRouter.post('/prepare', async (req, res) => {
  const label = String(req.body.label || '').trim()
  const pin = String(req.body.pin || '').trim()
  if (!label || label.length > 100) return res.status(400).json({ error: 'Enter a business label (maximum 100 characters)' })
  if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'Enter a six-digit Cloud API registration PIN' })
  try {
    const { hostedUrl } = embeddedSignupConfig()
    await prisma.hostedSignupRequest.updateMany({
      where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } },
      data: { status: 'EXPIRED', errorMessage: 'Signup was not completed within 30 minutes', pinCiphertext: '' },
    })
    const pending = await prisma.hostedSignupRequest.findFirst({ where: { status: 'PENDING' } })
    if (pending) return res.status(409).json({ error: 'Another WhatsApp signup is awaiting Meta completion. Complete or retry it before starting another.' })
    await prisma.hostedSignupRequest.create({ data: { label, pinCiphertext: encryptConnectionToken(pin) } })
    res.status(201).json({ hostedUrl })
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'Unable to start Hosted Signup' })
  }
})
