import { sendTemplateAndStore } from '../services/messaging.js'
import { prepareFlowTemplate } from '../services/flow-template.js'
import { TemplateValidationError } from '../../shared/templates.js'
import { Router } from 'express'
import { prisma } from '../db.js'
import type { AuthRequest } from '../auth.js'
import { metaErrorMessage, metaFetch, required } from '../services/meta.js'

export const conversationsRouter = Router()
const conversationInclude = { contact: true, assignee: { select: { id: true, name: true, email: true } }, claimedBy: { select: { id: true, name: true, email: true } }, messages: { orderBy: { createdAt: 'desc' as const }, take: 1 } }
const canInteract = (req: AuthRequest, conversation: { assigneeId: string | null; claimedById: string | null }) => Boolean(conversation.claimedById) && (conversation.claimedById === req.user?.id || conversation.assigneeId === req.user?.id)

conversationsRouter.get('/', async (req, res) => {
  const conversations = await prisma.conversation.findMany({ where: req.query.includeArchived === 'true' ? {} : { archivedAt: null }, include: conversationInclude, orderBy: { lastMessageAt: 'desc' } })
  res.json(conversations)
})

conversationsRouter.patch('/:id', async (req: AuthRequest, res) => {
  if ('claim' in req.body) {
    const conversation = await prisma.conversation.findUnique({ where: { id: String(req.params.id) } })
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
    if (req.body.claim === true) {
      if (conversation.claimedById && conversation.claimedById !== req.user?.id) return res.status(409).json({ error: 'This conversation is already claimed by another agent' })
      if (!conversation.claimedById) await prisma.conversation.update({ where: { id: String(req.params.id) }, data: { claimedById: req.user?.id } })
    } else if (req.body.claim === false) {
      if (conversation.claimedById !== req.user?.id && req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Only the claiming agent or an administrator can release this conversation' })
      await prisma.conversation.update({ where: { id: String(req.params.id) }, data: { claimedById: null } })
    } else return res.status(400).json({ error: 'Claim must be true or false' })
    return res.json(await prisma.conversation.findUnique({ where: { id: String(req.params.id) }, include: conversationInclude }))
  }
  if ('assigneeId' in req.body) {
    const conversation = await prisma.conversation.findUnique({ where: { id: String(req.params.id) } })
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
    if (req.user?.role !== 'ADMIN' && conversation.claimedById !== req.user?.id) return res.status(403).json({ error: 'Only the claiming agent or an administrator can change the assignment' })
    try { return res.json(await prisma.conversation.update({ where: { id: String(req.params.id) }, data: { assigneeId: req.body.assigneeId || null }, include: conversationInclude })) }
    catch { return res.status(404).json({ error: 'Conversation or agent not found' }) }
  }
  const action = String(req.body.action ?? '')
  const data = action === 'read' ? { unreadCount: 0 } : action === 'close' ? { closedAt: new Date() } : action === 'open' ? { closedAt: null } : action === 'archive' ? { archivedAt: new Date() } : action === 'unarchive' ? { archivedAt: null } : null
  if (!data) return res.status(400).json({ error: 'Action must be read, open, close, archive, or unarchive' })
  try {
    const conversation = await prisma.conversation.update({ where: { id: String(req.params.id) }, data, include: conversationInclude })
    res.json(conversation)
  } catch { res.status(404).json({ error: 'Conversation not found' }) }
})

conversationsRouter.get('/:id/messages', async (req, res) => {
  res.json(await prisma.message.findMany({ where: { conversationId: String(req.params.id) }, orderBy: { createdAt: 'asc' } }))
})

conversationsRouter.post('/:id/templates', async (req: AuthRequest, res) => {
  const name = String(req.body.name ?? ''), language = String(req.body.language ?? 'en_US')
  const parameters = Array.isArray(req.body.parameters) ? req.body.parameters.map(String) : []
  const conversation = await prisma.conversation.findUnique({ where: { id: String(req.params.id) }, include: { contact: true } })
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
  if (!canInteract(req, conversation)) return res.status(403).json({ error: conversation.claimedById ? `This conversation is claimed by ${conversation.claimedById === req.user?.id ? 'you' : 'another agent'}` : 'Claim this conversation before sending messages' })
  const template = await prisma.messageTemplate.findUnique({ where: { name_language: { name, language } } })
  if (!template || template.status !== 'APPROVED') return res.status(400).json({ error: 'Only an approved template can be sent' })
  try {
    const { headerMedia, headerText, buttons, cards, expirationTimeMs } = req.body
    const options = await prepareFlowTemplate(conversation.id, template.components as any[], { headerMedia, headerText, buttons, cards, expirationTimeMs })
    const message = await sendTemplateAndStore(conversation.id, conversation.contact.waId, template, parameters, options)
    res.status(201).json(message)
  } catch (error) { res.status(error instanceof TemplateValidationError ? 400 : 502).json({ error: error instanceof Error ? error.message : 'Unable to send template' }) }

})

conversationsRouter.post('/:id/messages', async (req: AuthRequest, res) => {
  const body = String(req.body.body ?? '').trim()
  if (!body) return res.status(400).json({ error: 'Message body is required' })
  const conversation = await prisma.conversation.findUnique({ where: { id: String(req.params.id) }, include: { contact: true } })
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
  if (!canInteract(req, conversation)) return res.status(403).json({ error: conversation.claimedById ? `This conversation is claimed by ${conversation.claimedById === req.user?.id ? 'you' : 'another agent'}` : 'Claim this conversation before sending messages' })
  const serviceWindowOpen = conversation.lastCustomerMessageAt && Date.now() - conversation.lastCustomerMessageAt.getTime() < 24 * 60 * 60 * 1000
  if (!serviceWindowOpen) return res.status(400).json({ error: 'The 24-hour customer service window is closed. Send an approved template instead.' })
  try {
    const response = await metaFetch(`/${required('WHATSAPP_PHONE_NUMBER_ID')}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: conversation.contact.waId, type: 'text', text: { body } }) })
    const result: any = await response.json()
    if (!response.ok) return res.status(response.status).json({ error: metaErrorMessage(result.error), details: result.error })
    const message = await prisma.message.create({ data: { conversationId: conversation.id, metaMessageId: result.messages?.[0]?.id, direction: 'OUTBOUND', type: 'text', body, status: 'SENT', sentAt: new Date() } })
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } })
    res.status(201).json(message)
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to send message' }) }
})
