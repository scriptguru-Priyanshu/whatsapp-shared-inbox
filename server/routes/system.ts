import { Router } from 'express'
import { prisma } from '../db.js'
import { metaErrorMessage, metaFetch, required } from '../services/meta.js'

export const systemRouter = Router()

systemRouter.get('/health', async (_req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ status: 'ok', database: 'connected' }) }
  catch { res.status(503).json({ status: 'error', database: 'disconnected' }) }
})

systemRouter.get('/health/whatsapp', async (_req, res) => {
  try {
    const response = await metaFetch(`/${required('WHATSAPP_PHONE_NUMBER_ID')}?fields=id,display_phone_number,verified_name,quality_rating`)
    const result: any = await response.json()
    if (!response.ok) return res.status(response.status).json({ connected: false, error: metaErrorMessage(result.error) })
    res.json({ connected: true, displayPhoneNumber: result.display_phone_number, verifiedName: result.verified_name, qualityRating: result.quality_rating })
  } catch (error) { res.status(503).json({ connected: false, error: error instanceof Error ? error.message : 'Unable to reach Meta' }) }
})
