import { supportsAutomaticTemplate, templateSendFields } from '../../shared/template-send.js'
import { Router } from 'express'
import { prisma } from '../db.js'
import { runAutomationFlows } from '../services/automations.js'
import { validateAutomaticFlowTemplate } from '../services/flow-template.js'

export const automationsRouter = Router()
const builtInFields = [
  { key: 'patient_name', label: 'Patient name' },
  { key: 'patient_age', label: 'Patient age' },
  { key: 'appointment_datetime', label: 'Appointment date and time' },
  { key: 'booking_reference', label: 'Booking reference' },
  { key: 'client_phone', label: 'Client phone' },
]

async function ensureBuiltInTrigger() {
  return prisma.automationTrigger.upsert({ where: { key: 'APPOINTMENT_BOOKED' }, update: { name: 'Appointment booked', description: 'Runs after an appointment is successfully booked.', fields: builtInFields, system: true }, create: { key: 'APPOINTMENT_BOOKED', name: 'Appointment booked', description: 'Runs after an appointment is successfully booked.', fields: builtInFields, system: true } })
}

automationsRouter.get('/triggers', async (_req, res) => {
  await ensureBuiltInTrigger()
  res.json(await prisma.automationTrigger.findMany({ orderBy: [{ system: 'desc' }, { name: 'asc' }] }))
})

automationsRouter.post('/triggers', async (req, res) => {
  const name = String(req.body.name ?? '').trim()
  const key = String(req.body.key || name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
  const description = String(req.body.description ?? '').trim() || null
  const fields = normalizeFields(req.body.fields)
  if (!name || !key) return res.status(400).json({ error: 'Trigger name is required' })
  if (!fields.length) return res.status(400).json({ error: 'Add at least one event field' })
  try { res.status(201).json(await prisma.automationTrigger.create({ data: { key, name, description, fields } })) }
  catch (error: any) { res.status(error?.code === 'P2002' ? 409 : 500).json({ error: error?.code === 'P2002' ? 'A trigger with this key already exists' : 'Unable to create trigger' }) }
})

automationsRouter.put('/triggers/:id', async (req, res) => {
  const existing = await prisma.automationTrigger.findUnique({ where: { id: req.params.id } })
  if (!existing) return res.status(404).json({ error: 'Trigger not found' })
  if (existing.system) return res.status(400).json({ error: 'Built-in triggers cannot be edited' })
  const name = String(req.body.name ?? '').trim(), description = String(req.body.description ?? '').trim() || null, fields = normalizeFields(req.body.fields)
  if (!name || !fields.length) return res.status(400).json({ error: 'Trigger name and at least one field are required' })
  res.json(await prisma.automationTrigger.update({ where: { id: existing.id }, data: { name, description, fields } }))
})

automationsRouter.delete('/triggers/:id', async (req, res) => {
  const trigger = await prisma.automationTrigger.findUnique({ where: { id: req.params.id } })
  if (!trigger) return res.status(404).json({ error: 'Trigger not found' })
  if (trigger.system) return res.status(400).json({ error: 'Built-in triggers cannot be deleted' })
  if (await prisma.automationFlow.count({ where: { trigger: trigger.key } })) return res.status(409).json({ error: 'Delete flows using this trigger first' })
  await prisma.automationTrigger.delete({ where: { id: trigger.id } })
  res.sendStatus(204)
})

automationsRouter.post('/triggers/:key/fire', async (req, res) => {
  const trigger = await prisma.automationTrigger.findUnique({ where: { key: req.params.key.toUpperCase() } })
  if (!trigger) return res.status(404).json({ error: 'Trigger not found' })
  const conversation = await prisma.conversation.findUnique({ where: { id: String(req.body.conversationId ?? '') }, include: { contact: true } })
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
  const fields = Array.isArray(trigger.fields) ? trigger.fields as Array<{ key: string }> : []
  const supplied = req.body.data && typeof req.body.data === 'object' ? req.body.data : {}
  const context = Object.fromEntries(fields.map(field => [field.key, String(supplied[field.key] ?? '')]))
  if (fields.some(field => !context[field.key])) return res.status(400).json({ error: 'Provide a value for every trigger field' })
  await runAutomationFlows(trigger.key, conversation.id, conversation.contact.waId, context)
  res.status(202).json({ accepted: true })
})

automationsRouter.get('/', async (_req, res) => res.json(await prisma.automationFlow.findMany({ include: { template: true }, orderBy: { updatedAt: 'desc' } })))
automationsRouter.post('/', async (req, res) => saveFlow(req, res))
automationsRouter.put('/:id', async (req, res) => saveFlow(req, res, req.params.id))
automationsRouter.patch('/:id', async (req, res) => {
  if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' })
  try { res.json(await prisma.automationFlow.update({ where: { id: req.params.id }, data: { enabled: req.body.enabled }, include: { template: true } })) }
  catch { res.status(404).json({ error: 'Automation flow not found' }) }
})
automationsRouter.delete('/:id', async (req, res) => {
  try { await prisma.automationFlow.delete({ where: { id: req.params.id } }); res.sendStatus(204) }
  catch { res.status(404).json({ error: 'Automation flow not found' }) }
})

async function saveFlow(req: any, res: any, id?: string) {
  const name = String(req.body.name ?? '').trim(), triggerKey = String(req.body.trigger ?? '').toUpperCase(), actionType = String(req.body.actionType ?? '').toUpperCase()
  const messageBody = String(req.body.messageBody ?? '').trim() || null, templateId = String(req.body.templateId ?? '').trim() || null
  const parameterMappings = Array.isArray(req.body.parameterMappings) ? req.body.parameterMappings.map(String) : []
  if (!name) return res.status(400).json({ error: 'Flow name is required' })
  const trigger = await prisma.automationTrigger.findUnique({ where: { key: triggerKey } })
  if (!trigger) return res.status(400).json({ error: 'Select a valid trigger' })
  const availableFields = new Set((Array.isArray(trigger.fields) ? trigger.fields as Array<{ key: string }> : []).map(field => field.key))
  if (!['MESSAGE', 'TEMPLATE'].includes(actionType)) return res.status(400).json({ error: 'Choose a message or template action' })
  if (actionType === 'MESSAGE') {
    if (!messageBody) return res.status(400).json({ error: 'Message text is required' })
    if (messageBody.length > 4096) return res.status(400).json({ error: 'Message text cannot exceed 4,096 characters' })
    const tokens = Array.from(messageBody.matchAll(/\{\{([^}]+)\}\}/g), match => match[1])
    if (tokens.some(token => !availableFields.has(token))) return res.status(400).json({ error: 'The message contains a field not defined by this trigger' })
  }
  if (actionType === 'TEMPLATE') {
    const template = templateId ? await prisma.messageTemplate.findUnique({ where: { id: templateId } }) : null
    if (!template || template.status !== 'APPROVED') return res.status(400).json({ error: 'Select an approved template' })
    const components = Array.isArray(template.components) ? template.components as any[] : []
    if (!supportsAutomaticTemplate({ ...template, components })) return res.status(400).json({ error: 'This template needs delivery media or interactive values. Send it from the inbox.' })
    try { await validateAutomaticFlowTemplate(components) }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'The template Flow button is not available for automation.' }) }
    const required = templateSendFields(components, template.category === 'AUTHENTICATION').length
    if (parameterMappings.length !== required || parameterMappings.some((value: string) => !availableFields.has(value))) return res.status(400).json({ error: `Map all ${required} template parameter${required === 1 ? '' : 's'} to trigger fields` })
  }
  const data: any = { name, trigger: trigger.key, enabled: req.body.enabled !== false, actionType, messageBody: actionType === 'MESSAGE' ? messageBody : null, templateId: actionType === 'TEMPLATE' ? templateId : null, parameterMappings: actionType === 'TEMPLATE' ? parameterMappings : [] }
  try { res.status(id ? 200 : 201).json(id ? await prisma.automationFlow.update({ where: { id }, data, include: { template: true } }) : await prisma.automationFlow.create({ data, include: { template: true } })) }
  catch { res.status(id ? 404 : 500).json({ error: id ? 'Automation flow not found' : 'Unable to create automation flow' }) }
}

function normalizeFields(input: unknown) {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  return input.map((field: any) => ({ key: String(field.key || field.label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), label: String(field.label ?? '').trim() })).filter(field => field.key && field.label && !seen.has(field.key) && seen.add(field.key)).slice(0, 25)
}
