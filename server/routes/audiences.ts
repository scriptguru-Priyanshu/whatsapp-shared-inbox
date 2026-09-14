import { Router } from 'express'
import { prisma } from '../db.js'
import { sendTemplateAndStore } from '../services/messaging.js'
import { prepareFlowTemplate } from '../services/flow-template.js'

export const audiencesRouter = Router()
const include = { members: { include: { contact: true } } }

audiencesRouter.get('/', async (_req, res) => {
  res.json(await prisma.audience.findMany({ include, orderBy: { updatedAt: 'desc' } }))
})

audiencesRouter.post('/', async (req, res) => {
  const name = String(req.body.name ?? '').trim()
  const contactIds: string[] = [...new Set<string>(Array.isArray(req.body.contactIds) ? req.body.contactIds.map((value: unknown) => String(value)) : [])]
  if (!name) return res.status(400).json({ error: 'Audience name is required' })
  if (!contactIds.length) return res.status(400).json({ error: 'Select at least one contact' })
  const count = await prisma.contact.count({ where: { id: { in: contactIds } } })
  if (count !== contactIds.length) return res.status(400).json({ error: 'One or more contacts no longer exist' })
  const audience = await prisma.audience.create({ data: { name, members: { create: contactIds.map(contactId => ({ contactId })) } }, include })
  res.status(201).json(audience)
})

audiencesRouter.put('/:id', async (req, res) => {
  const name = String(req.body.name ?? '').trim()
  const contactIds: string[] = [...new Set<string>(Array.isArray(req.body.contactIds) ? req.body.contactIds.map((value: unknown) => String(value)) : [])]
  if (!name || !contactIds.length) return res.status(400).json({ error: 'Provide a name and at least one contact' })
  try {
    const audience = await prisma.$transaction(async tx => {
      await tx.audience.update({ where: { id: String(req.params.id) }, data: { name, members: { deleteMany: {}, create: contactIds.map(contactId => ({ contactId })) } } })
      return tx.audience.findUniqueOrThrow({ where: { id: String(req.params.id) }, include })
    })
    res.json(audience)
  } catch { res.status(404).json({ error: 'Audience or contact not found' }) }
})

audiencesRouter.delete('/:id', async (req, res) => {
  try { await prisma.audience.delete({ where: { id: String(req.params.id) } }); res.status(204).end() }
  catch { res.status(404).json({ error: 'Audience not found' }) }
})

audiencesRouter.post('/send-template', async (req, res) => {
  const directIds: string[] = Array.isArray(req.body.contactIds) ? req.body.contactIds.map((value: unknown) => String(value)) : []
  const audienceIds: string[] = Array.isArray(req.body.audienceIds) ? req.body.audienceIds.map((value: unknown) => String(value)) : []
  const audiences = audienceIds.length ? await prisma.audienceContact.findMany({ where: { audienceId: { in: audienceIds } }, select: { contactId: true } }) : []
  const contactIds = [...new Set([...directIds, ...audiences.map(item => item.contactId)])]
  if (!contactIds.length) return res.status(400).json({ error: 'Select at least one recipient' })
  if (contactIds.length > 500) return res.status(400).json({ error: 'Send to at most 500 contacts at a time' })
  const template = await prisma.messageTemplate.findUnique({ where: { name_language: { name: String(req.body.name ?? ''), language: String(req.body.language ?? 'en_US') } } })
  if (!template || template.status !== 'APPROVED') return res.status(400).json({ error: 'Choose an approved template' })
  const contacts = await prisma.contact.findMany({ where: { id: { in: contactIds } } })
  const parameters = Array.isArray(req.body.parameters) ? req.body.parameters.map(String) : []
  const results: Array<{ contactId: string; ok: boolean; error?: string }> = []
  for (const contact of contacts) {
    try {
      let conversation = await prisma.conversation.findFirst({ where: { contactId: contact.id, archivedAt: null }, orderBy: { lastMessageAt: 'desc' } })
      conversation ??= await prisma.conversation.create({ data: { contactId: contact.id } })
      const { headerMedia, headerText, buttons, cards, expirationTimeMs } = req.body
      const options = await prepareFlowTemplate(conversation.id, template.components as any[], { headerMedia, headerText, buttons, cards, expirationTimeMs })
      await sendTemplateAndStore(conversation.id, contact.waId, template, parameters, options)
      results.push({ contactId: contact.id, ok: true })
    } catch (error) { results.push({ contactId: contact.id, ok: false, error: error instanceof Error ? error.message : 'Send failed' }) }
  }
  res.status(207).json({ sent: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length, results })
})
