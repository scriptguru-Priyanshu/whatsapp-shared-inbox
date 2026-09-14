import { Router } from 'express'
import { prisma } from '../db.js'

export const contactsRouter = Router()

contactsRouter.get('/', async (_req, res) => {
  res.json(await prisma.contact.findMany({ include: { conversations: { where: { archivedAt: null }, orderBy: { lastMessageAt: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' } }))
})

contactsRouter.post('/', async (req, res) => {
  const profileName = String(req.body.name ?? '').trim()
  const phone = String(req.body.phone ?? '').replace(/\D/g, '')
  if (!profileName) return res.status(400).json({ error: 'Contact name is required' })
  if (phone.length < 8 || phone.length > 15) return res.status(400).json({ error: 'Enter a valid phone number including country code' })
  const contact = await prisma.contact.upsert({ where: { waId: phone }, update: { profileName, phone }, create: { waId: phone, phone, profileName } })
  let conversation = await prisma.conversation.findFirst({ where: { contactId: contact.id, archivedAt: null } })
  conversation ??= await prisma.conversation.create({ data: { contactId: contact.id } })
  res.status(201).json({ ...contact, conversations: [conversation] })
})
