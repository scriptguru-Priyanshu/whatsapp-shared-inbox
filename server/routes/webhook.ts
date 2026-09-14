import crypto from 'node:crypto'
import { Router } from 'express'
import { prisma } from '../db.js'
import { mapTemplateStatus, verifyMetaSignature } from '../services/meta.js'
import { messageBody, messageReplyId, statusUpdate } from '../services/messaging.js'
import { flowCompletionBody } from '../services/flow-booking.js'
import { captureHostedSignupEvent } from '../services/hosted-signup.js'

const MAX_ATTEMPTS = 5

async function processChange(change: any, broadcastEvent: (event: string) => void) {
  const value = change?.value ?? {}
  if (change?.field === 'account_update' && await captureHostedSignupEvent(value)) broadcastEvent('whatsapp-connections')
  if (change?.field === 'message_template_status_update' || value.event === 'APPROVED' || value.event === 'REJECTED') {
    const templateName = value.message_template_name ?? value.name
    const language = value.message_template_language ?? value.language
    if (templateName && language) await prisma.messageTemplate.updateMany({
      where: { name: templateName, language },
      data: { status: mapTemplateStatus(value.event ?? value.status), rejectionReason: value.reason ?? null },
    })
    broadcastEvent('templates')
  }
  const profileNames = new Map((value.contacts ?? []).map((contact: any) => [contact.wa_id, contact.profile?.name]))
  for (const incoming of value.messages ?? []) {
    if (await prisma.message.findUnique({ where: { metaMessageId: incoming.id } })) continue
    const contact = await prisma.contact.upsert({
      where: { waId: incoming.from }, update: { profileName: profileNames.get(incoming.from) as string | undefined },
      create: { waId: incoming.from, phone: incoming.from, profileName: profileNames.get(incoming.from) as string | undefined },
    })
    let conversation = await prisma.conversation.findFirst({ where: { contactId: contact.id, archivedAt: null } })
    conversation ??= await prisma.conversation.create({ data: { contactId: contact.id } })
    const receivedAt = new Date(Number(incoming.timestamp) * 1000)
    if (incoming.interactive?.nfm_reply) incoming.text = { body: await flowCompletionBody(incoming, contact.id) }
    await prisma.$transaction([
      prisma.message.create({ data: { metaMessageId: incoming.id, conversationId: conversation.id, direction: 'INBOUND', type: incoming.type, body: messageBody(incoming), replyId: messageReplyId(incoming), status: 'RECEIVED', sentAt: receivedAt } }),
      prisma.conversation.update({ where: { id: conversation.id }, data: { lastCustomerMessageAt: receivedAt, lastMessageAt: receivedAt, closedAt: null, archivedAt: null, unreadCount: { increment: 1 } } }),
    ])
  }
  for (const status of value.statuses ?? []) {
    const data = statusUpdate(status)
    if (data) await prisma.message.updateMany({ where: { metaMessageId: status.id }, data })
  }
  broadcastEvent('inbox')
}

async function processAudit(id: string, broadcastEvent: (event: string) => void) {
  const staleBefore = new Date(Date.now() - 2 * 60 * 1000)
  const claimed = await prisma.metaWebhookEvent.updateMany({
    where: {
      id, attempts: { lt: MAX_ATTEMPTS },
      OR: [{ status: { in: ['RECEIVED', 'FAILED'] } }, { status: 'PROCESSING', processedAt: { lt: staleBefore } }],
    },
    data: { status: 'PROCESSING', attempts: { increment: 1 }, processedAt: new Date(), nextAttemptAt: null },
  })
  if (!claimed.count) return
  const audit = await prisma.metaWebhookEvent.findUnique({ where: { id } })
  if (!audit) return
  try {
    await processChange(audit.payload, broadcastEvent)
    await prisma.metaWebhookEvent.update({
      where: { id }, data: { status: 'PROCESSED', errorMessage: null, processedAt: new Date(), nextAttemptAt: null },
    })
    console.info('Meta webhook processed', { id, field: audit.field, event: audit.event || null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed'
    const delaySeconds = Math.min(300, 2 ** Math.max(1, audit.attempts + 1))
    await prisma.metaWebhookEvent.update({
      where: { id },
      data: { status: 'FAILED', errorMessage: message.slice(0, 1000), processedAt: new Date(), nextAttemptAt: new Date(Date.now() + delaySeconds * 1000) },
    }).catch(() => {})
    console.error('Meta webhook processing failed', { id, field: audit.field, attempt: audit.attempts + 1, message })
  }
}

export function createWebhookRouter(broadcastEvent: (event: string) => void) {
  const router = Router()
  let draining = false
  const drainRetries = async () => {
    if (draining) return
    draining = true
    try {
      const due = await prisma.metaWebhookEvent.findMany({
        where: {
          attempts: { lt: MAX_ATTEMPTS },
          OR: [
            { status: 'RECEIVED' },
            { status: 'FAILED', nextAttemptAt: { lte: new Date() } },
            { status: 'PROCESSING', processedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } },
          ],
        },
        orderBy: { receivedAt: 'asc' }, take: 50, select: { id: true },
      })
      await Promise.allSettled(due.map(item => processAudit(item.id, broadcastEvent)))
    } catch (error) {
      console.error('Unable to drain Meta webhook queue', { message: error instanceof Error ? error.message : String(error) })
    } finally { draining = false }
  }
  const retryTimer = setInterval(() => void drainRetries(), 15000)
  retryTimer.unref()

  router.get('/whatsapp', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge'])
    return res.sendStatus(403)
  })

  router.post('/whatsapp', async (req, res) => {
    const rawBody = req.body as Buffer
    if (!Buffer.isBuffer(rawBody)) return res.status(400).json({ error: 'Webhook body must be JSON' })
    if (!verifyMetaSignature(rawBody, req.header('x-hub-signature-256'))) return res.status(401).json({ error: 'Invalid Meta signature' })
    let payload: any
    try { payload = JSON.parse(rawBody.toString('utf8')) } catch { return res.status(400).json({ error: 'Invalid JSON payload' }) }

    const queuedIds: string[] = []
    try {
      const entries = Array.isArray(payload.entry) ? payload.entry : []
      for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        const entry = entries[entryIndex] ?? {}
        const changes = Array.isArray(entry.changes) ? entry.changes : []
        for (let changeIndex = 0; changeIndex < changes.length; changeIndex++) {
          const change = changes[changeIndex] ?? {}
          const value = change.value ?? {}
          const deliveryKey = crypto.createHash('sha256').update(rawBody).update(`:${entryIndex}:${changeIndex}`).digest('hex')
          try {
            const audit = await prisma.metaWebhookEvent.create({ data: {
              deliveryKey, object: String(payload.object || '') || null, entryId: String(entry.id || '') || null,
              field: String(change.field || 'unknown'), event: String(value.event || '') || null,
              wabaId: String(value.waba_info?.waba_id || entry.id || '') || null,
              phoneNumberId: String(value.metadata?.phone_number_id || '') || null, payload: change,
            } })
            queuedIds.push(audit.id)
          } catch (error: any) {
            if (error?.code !== 'P2002') throw error
            const existing = await prisma.metaWebhookEvent.findUnique({ where: { deliveryKey } })
            if (existing && existing.status === 'FAILED' && existing.attempts < MAX_ATTEMPTS) queuedIds.push(existing.id)
          }
        }
      }
      // Meta only needs confirmation that its signed delivery is durably queued.
      res.sendStatus(200)
      void Promise.allSettled(queuedIds.map(id => processAudit(id, broadcastEvent)))
    } catch (error) {
      console.error('Unable to enqueue Meta webhook', { message: error instanceof Error ? error.message : String(error) })
      res.sendStatus(500)
    }
  })
  void drainRetries()
  return router
}
