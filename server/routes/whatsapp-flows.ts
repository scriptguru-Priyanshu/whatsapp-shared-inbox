import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { requireAdmin, type AuthRequest } from '../auth.js'
import { canonicalFlowJson, FlowError, isEditableFlow, validateFlowInput, validateFlowJson, type FlowInput } from '../../shared/whatsapp-flows.js'
import { assertFlowRevision, downloadFlowJson, effectiveEndpoint, graphFlow, issueFlowSession, publicFlow, refreshFlow, uploadFlow, withFlowLock } from '../services/native-flows.js'
import { flowPublicKey } from '../services/flow-crypto.js'
import { required } from '../services/meta.js'
import { sendInteractiveAndStore } from '../services/messaging.js'

export const whatsappFlowsRouter = Router()
const route = (fn: (req: AuthRequest, res: any) => Promise<any>) => async (req: AuthRequest, res: any) => {
  try { await fn(req, res) } catch (error) {
    if (error instanceof FlowError) return res.status(error.status).json({ error: error.message })
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return res.status(404).json({ error: 'Flow not found' })
    console.error('Flow operation failed', { code: (error as any)?.code || 'INTERNAL_ERROR' })
    res.status(500).json({ error: 'Unable to complete the Flow operation. Check configuration and refresh before retrying.' })
  }
}
whatsappFlowsRouter.get('/', route(async (_req, res) => res.json((await prisma.whatsAppFlow.findMany({ orderBy: { updatedAt: 'desc' } })).map(publicFlow))))
whatsappFlowsRouter.get('/setup', requireAdmin, route(async (_req, res) => {
  let publicKey = '', keyError = ''
  try { publicKey = flowPublicKey() } catch (error) { keyError = (error as Error).message.includes('Configure') ? (error as Error).message : 'The configured private key could not be loaded' }
  const endpointUrl = process.env.WHATSAPP_FLOW_ENDPOINT_URL || ''
  res.json({ publicKey, keyError, endpointUrl, endpointReady: endpointUrl.startsWith('https://') && !!publicKey && !!process.env.META_APP_SECRET, metaReady: !!process.env.WHATSAPP_ACCESS_TOKEN && !!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID && !!process.env.WHATSAPP_PHONE_NUMBER_ID, timezone: process.env.APPOINTMENT_TIMEZONE || 'Asia/Kolkata' })
}))
whatsappFlowsRouter.post('/setup/register-key', requireAdmin, route(async (_req, res) => {
  const result = await graphFlow(`/${required('WHATSAPP_PHONE_NUMBER_ID')}/whatsapp_business_encryption`, { business_public_key: flowPublicKey() })
  if (result.success !== true) throw new FlowError('Meta did not confirm public key registration', 502)
  res.json(result)
}))
whatsappFlowsRouter.get('/setup/key-status', requireAdmin, route(async (_req, res) => res.json(await graphFlow(`/${required('WHATSAPP_PHONE_NUMBER_ID')}/whatsapp_business_encryption`))))
whatsappFlowsRouter.get('/slots', requireAdmin, route(async (_req, res) => res.json(await prisma.appointmentSlot.findMany({ where: { startsAt: { gt: new Date() } }, include: { appointment: { select: { reference: true } } }, orderBy: { startsAt: 'asc' }, take: 200 }))))
whatsappFlowsRouter.post('/slots', requireAdmin, route(async (req, res) => {
  const values = req.body.startsAt
  if (!Array.isArray(values) || !values.length || values.length > 100 || values.some(value => typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now())) throw new FlowError('Provide 1–100 future appointment times including a timezone')
  res.status(201).json(await prisma.appointmentSlot.createMany({ data: values.map(value => ({ startsAt: new Date(value) })), skipDuplicates: true }))
}))
whatsappFlowsRouter.delete('/slots/:id', requireAdmin, route(async (req, res) => {
  try {
    const result = await prisma.appointmentSlot.deleteMany({ where: { id: String(req.params.id), appointment: null } })
    if (!result.count) throw new FlowError('A booked appointment cannot be removed, or the slot no longer exists.', 409)
    res.json({ success: true })
  } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new FlowError('This slot has just been booked and cannot be removed.', 409); throw error }
}))
whatsappFlowsRouter.post('/', requireAdmin, route(async (req, res) => {
  const input = validateFlowInput(req.body)
  res.status(201).json(publicFlow(await prisma.whatsAppFlow.create({ data: { name: input.name, categories: input.categories, flowJson: input.flowJson as Prisma.InputJsonValue, endpointMode: input.endpointMode, endpointUri: input.endpointUri } })))
}))
whatsappFlowsRouter.post('/sync', requireAdmin, route(async (_req, res) => {
  let after = '', count = 0; const seen = new Set<string>()
  for (let page = 0; page < 100; page++) {
    const result = await graphFlow(`/${required('WHATSAPP_BUSINESS_ACCOUNT_ID')}/flows?fields=id,name,status,categories,validation_errors,endpoint_uri&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`)
    if (!Array.isArray(result.data)) throw new FlowError('Meta returned an invalid Flow list', 502)
    for (const remote of result.data) {
      const existing = await prisma.whatsAppFlow.findUnique({ where: { metaFlowId: String(remote.id) } })
      if (existing) {
        // Sync status only: never overwrite an unsent local draft.
        await withFlowLock(existing.id, async () => prisma.whatsAppFlow.update({ where: { id: existing.id }, data: { status: remote.status, validationErrors: remote.validation_errors ?? [], remoteDetails: remote } }))
      } else {
        let flowJson: any = { version: '7.3', screens: [] }
        try { flowJson = await downloadFlowJson(remote.id) } catch (error) { if (!(error instanceof FlowError && error.status === 409)) throw error }
        await prisma.whatsAppFlow.upsert({ where: { metaFlowId: String(remote.id) }, update: {}, create: { metaFlowId: String(remote.id), name: remote.name, status: remote.status, categories: remote.categories ?? ['OTHER'], flowJson, endpointMode: remote.endpoint_uri ? 'EXTERNAL' : 'NONE', endpointUri: remote.endpoint_uri || '', validationErrors: remote.validation_errors ?? [], remoteDetails: remote, syncedRevision: validateFlowJson(flowJson).length ? null : 1 } })
      }
      count++
    }
    if (!result.paging?.next) break
    after = result.paging?.cursors?.after
    if (!after || seen.has(after) || page === 99) throw new FlowError('Meta pagination did not complete. Some Flows were synced; retry to finish.', 502)
    seen.add(after)
  }
  res.json({ count })
}))
whatsappFlowsRouter.put('/:id', requireAdmin, route(async (req, res) => {
  const input = validateFlowInput(req.body)
  const flow = await withFlowLock(String(req.params.id), async current => {
    assertFlowRevision(current, input.revision)
    if (!isEditableFlow(current.status)) throw new FlowError('Make a copy to edit a published Flow.', 409)
    return prisma.whatsAppFlow.update({ where: { id: current.id }, data: { name: input.name, categories: input.categories, flowJson: input.flowJson as Prisma.InputJsonValue, endpointMode: input.endpointMode, endpointUri: input.endpointUri, revision: { increment: 1 }, syncedRevision: null, validationErrors: [] } })
  })
  res.json(publicFlow(flow))
}))
whatsappFlowsRouter.post('/:id/copy', requireAdmin, route(async (req, res) => {
  const flow = await prisma.whatsAppFlow.findUniqueOrThrow({ where: { id: String(req.params.id) } })
  res.status(201).json(publicFlow(await prisma.whatsAppFlow.create({ data: { name: `${flow.name.slice(0, 190)} (copy)`, categories: flow.categories as Prisma.InputJsonValue, flowJson: flow.flowJson as Prisma.InputJsonValue, endpointMode: flow.endpointMode, endpointUri: flow.endpointUri } })))
}))
whatsappFlowsRouter.post('/:id/upload', requireAdmin, route(async (req, res) => res.json(publicFlow(await withFlowLock(String(req.params.id), async flow => { assertFlowRevision(flow, req.body.revision); return uploadFlow(flow) })))) )
whatsappFlowsRouter.post('/:id/refresh', requireAdmin, route(async (req, res) => res.json(publicFlow(await withFlowLock(String(req.params.id), refreshFlow)))))
whatsappFlowsRouter.get('/:id/preview', route(async (req, res) => {
  const flow = await prisma.whatsAppFlow.findUniqueOrThrow({ where: { id: String(req.params.id) } })
  if (!flow.metaFlowId) throw new FlowError('Check with Meta first to create a preview')
  const result = await graphFlow(`/${flow.metaFlowId}?fields=preview.invalidate(false)`)
  const url = new URL(result.preview?.preview_url)
  if (url.protocol !== 'https:' || url.hostname !== 'business.facebook.com') throw new FlowError('Meta returned an invalid preview link', 502)
  res.json(result.preview)
}))
whatsappFlowsRouter.post('/:id/publish', requireAdmin, route(async (req, res) => {
  const flow = await withFlowLock(String(req.params.id), async current => {
    assertFlowRevision(current, req.body.revision)
    current = await refreshFlow(current)
    if (current.status !== 'DRAFT' || !current.metaFlowId || current.syncedRevision !== current.revision || (current.validationErrors as any[]).length) throw new FlowError('Save and check the latest draft with Meta before publishing.', 409)
    validateFlowInput(current as unknown as FlowInput)
    if (canonicalFlowJson(await downloadFlowJson(current.metaFlowId)) !== canonicalFlowJson(current.flowJson)) throw new FlowError('This Flow was changed in Meta. Check your local draft with Meta again before publishing.', 409)
    if (current.endpointMode === 'APPOINTMENT') {
      effectiveEndpoint(current); flowPublicKey(); required('META_APP_SECRET')
      const key = await graphFlow(`/${required('WHATSAPP_PHONE_NUMBER_ID')}/whatsapp_business_encryption`)
      const registered = key.data?.[0] ?? key
      if (registered.business_public_key_signature_status !== 'VALID' || registered.business_public_key?.trim() !== flowPublicKey().trim()) throw new FlowError('Register the configured public key with Meta before publishing.')
    }
    if (req.body.confirm !== true) throw new FlowError('Confirm publishing. Published screens cannot be edited.')
    const result = await graphFlow(`/${current.metaFlowId}/publish`, {})
    if (result.success !== true) throw new FlowError('Meta did not confirm publishing. Refresh before retrying.', 502)
    return prisma.whatsAppFlow.update({ where: { id: current.id }, data: { status: 'PUBLISHED' } })
  })
  res.json(publicFlow(flow))
}))
whatsappFlowsRouter.post('/:id/deprecate', requireAdmin, route(async (req, res) => {
  res.json(publicFlow(await withFlowLock(String(req.params.id), async current => {
    assertFlowRevision(current, req.body.revision); current = await refreshFlow(current)
    if (!['PUBLISHED', 'BLOCKED', 'THROTTLED'].includes(current.status) || !current.metaFlowId || req.body.confirm !== true) throw new FlowError('Confirm retiring a published Flow.', 409)
    if ((await graphFlow(`/${current.metaFlowId}/deprecate`, {})).success !== true) throw new FlowError('Meta did not confirm retiring the Flow', 502)
    return prisma.whatsAppFlow.update({ where: { id: current.id }, data: { status: 'DEPRECATED' } })
  })))
}))
whatsappFlowsRouter.delete('/:id', requireAdmin, route(async (req, res) => {
  await withFlowLock(String(req.params.id), async current => {
    assertFlowRevision(current, req.body.revision); current = await refreshFlow(current)
    if (!isEditableFlow(current.status)) throw new FlowError('Published Flows must be retired instead of deleted.', 409)
    if (await prisma.whatsAppFlowSession.count({ where: { flowId: current.id } })) throw new FlowError('This Flow has sent sessions. Keep it for the conversation history.', 409)
    if (current.metaFlowId && (await graphFlow(`/${current.metaFlowId}`, undefined, 'DELETE')).success !== true) throw new FlowError('Meta did not confirm deleting the Flow', 502)
    await prisma.whatsAppFlow.delete({ where: { id: current.id } })
  })
  res.json({ success: true })
}))
whatsappFlowsRouter.post('/:id/send', route(async (req, res) => {
  const conversation = await prisma.conversation.findUnique({ where: { id: String(req.body.conversationId || '') }, include: { contact: true } })
  if (!conversation) throw new FlowError('Choose a conversation', 404)
  if (!conversation.claimedById || (conversation.claimedById !== req.user?.id && conversation.assigneeId !== req.user?.id)) throw new FlowError('Claim this conversation in the inbox before sending a Flow.', 403)
  if (!conversation.lastCustomerMessageAt || Date.now() - conversation.lastCustomerMessageAt.getTime() >= 86400000) throw new FlowError('The 24-hour reply window has closed. Send an approved template with a Flow button instead.')
  const flow = await prisma.whatsAppFlow.findUniqueOrThrow({ where: { id: String(req.params.id) } })
  const draft = req.body.draft === true
  if (!flow.metaFlowId || (draft ? flow.status !== 'DRAFT' || req.user?.role !== 'ADMIN' : flow.status !== 'PUBLISHED')) throw new FlowError('Choose a published Flow, or an administrator can send a draft test.')
  if (draft && flow.syncedRevision !== flow.revision) throw new FlowError('Check the latest draft with Meta before sending a test.')
  const body = String(req.body.body || '').trim(), cta = String(req.body.cta || 'Open form').trim()
  if (!body || body.length > 1024 || !cta || cta.length > 20) throw new FlowError('Enter a message up to 1,024 characters and a button label up to 20 characters.')
  const document = flow.flowJson as any
  const screen = String(req.body.screen || document.screens?.[0]?.id || '')
  if (flow.endpointMode === 'EXTERNAL' && (typeof req.body.externalToken !== 'string' || !req.body.externalToken.trim() || req.body.externalToken.length > 1024)) throw new FlowError('Provide a session token issued by your backend in Advanced launch settings.')
  if (flow.endpointMode === 'NONE' && !document.screens?.some((item: any) => item.id === screen)) throw new FlowError('Choose a valid opening screen')
  const data = req.body.data ?? {}
  if (!data || typeof data !== 'object' || Array.isArray(data) || JSON.stringify(data).length > 10000) throw new FlowError('Opening screen data must be an object under 10 KB')
  const token = flow.endpointMode === 'EXTERNAL' ? req.body.externalToken : await issueFlowSession(flow, conversation.id, conversation.contactId)
  const parameters = { flow_message_version: '3', flow_id: flow.metaFlowId, flow_token: token, flow_cta: cta, mode: draft ? 'draft' : 'published', flow_action: flow.endpointMode !== 'NONE' ? 'data_exchange' : 'navigate', ...(flow.endpointMode === 'NONE' ? { flow_action_payload: { screen, data } } : {}) }
  res.status(201).json(await sendInteractiveAndStore(conversation.id, conversation.contact.waId, { type: 'flow', body: { text: body }, action: { name: 'flow', parameters } }, `${body}\n[${cta}]`))
}))
