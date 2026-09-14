import type { Request, Response } from 'express'
import { verifyMetaSignature } from '../services/meta.js'
import { decryptFlow, encryptFlow } from '../services/flow-crypto.js'
import { handleBookingExchange } from '../services/flow-booking.js'
import { FlowError } from '../../shared/whatsapp-flows.js'

let active = 0
export async function flowDataEndpoint(req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store')
  if (!Buffer.isBuffer(req.body) || !verifyMetaSignature(req.body, req.header('x-hub-signature-256'))) return res.sendStatus(432)
  if (active >= 32) return res.sendStatus(503)
  active++
  try {
    let decrypted: ReturnType<typeof decryptFlow>
    try { decrypted = decryptFlow(JSON.parse(req.body.toString('utf8'))) } catch { return res.sendStatus(421) }
    try { return res.type('text/plain').send(encryptFlow(await handleBookingExchange(decrypted.data), decrypted.key, decrypted.iv)) }
    catch (error) {
      if (error instanceof FlowError) return res.status(error.status === 427 ? 427 : 400).type('text/plain').send(encryptFlow({ error_msg: error.message }, decrypted.key, decrypted.iv))
      console.error('WhatsApp Flow endpoint failed', { code: (error as any)?.code || 'INTERNAL_ERROR' })
      return res.sendStatus(500)
    }
  } finally { active-- }
}
