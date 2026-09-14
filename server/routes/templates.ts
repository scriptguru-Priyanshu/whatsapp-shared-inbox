import { Router } from 'express'
import { prisma } from '../db.js'
import { mapTemplateStatus, metaErrorMessage, metaFetch, required } from '../services/meta.js'

import { buildTemplate, TemplateValidationError } from '../../shared/templates.js'
import { receiveTemplateMedia, validateUploadedMedia, uploadReviewSample, uploadMessageMedia, removeUpload } from '../services/template-media.js'

export const templatesRouter = Router()

async function syncTemplatesFromMeta() {
  const seen = new Set<string>()
  let after = ''
  do {
  const query = new URLSearchParams({ fields: 'id,name,language,category,status,components,rejected_reason', limit: '100', ...(after ? { after } : {}) })
  const response = await metaFetch(`/${required('WHATSAPP_BUSINESS_ACCOUNT_ID')}/message_templates?${query}`)
  const result: any = await response.json()
  if (!response.ok) throw new Error(result.error?.message ?? 'Unable to synchronize templates')
  for (const item of result.data ?? []) await prisma.messageTemplate.upsert({
    where: { name_language: { name: item.name, language: item.language } },
    update: { metaTemplateId: item.id, category: item.category, status: mapTemplateStatus(item.status), components: item.components, rejectionReason: item.rejected_reason ?? null },
    create: { metaTemplateId: item.id, name: item.name, language: item.language, category: item.category, status: mapTemplateStatus(item.status), components: item.components, rejectionReason: item.rejected_reason ?? null },
  })
  after = result.paging?.next ? result.paging?.cursors?.after || '' : ''
  if (after && seen.has(after)) throw new Error('Meta returned a repeated pagination cursor')
  if (after) seen.add(after)
  } while (after)
}

templatesRouter.get('/', async (req, res) => {
  let syncWarning: string | undefined
  if (req.query.sync === 'true') try { await syncTemplatesFromMeta() } catch (error) { syncWarning = error instanceof Error ? error.message : 'Meta synchronization failed'; console.warn('Template sync skipped:', syncWarning) }
  if (syncWarning) res.setHeader('X-Template-Sync-Warning', encodeURIComponent(syncWarning))
  res.json(await prisma.messageTemplate.findMany({ orderBy: { updatedAt: 'desc' } }))
})

for (const purpose of ['example', 'send'] as const) {
  templatesRouter.post(`/media/${purpose}`, receiveTemplateMedia, async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Choose an image, video, or PDF' })
      const type = await validateUploadedMedia(req.file)
      const value = purpose === 'example' ? await uploadReviewSample(req.file) : await uploadMessageMedia(req.file)
      res.json({ [purpose === 'example' ? 'handle' : 'mediaId']: value, type })
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Media upload failed' }) }
    finally { await removeUpload(req.file) }
  })
}

templatesRouter.post('/validate', (req, res) => {
  try { res.json(buildTemplate(req.body)) }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid template', field: error instanceof TemplateValidationError ? error.field : undefined }) }
})

templatesRouter.post('/', async (req, res) => {
  try {
    const payload = buildTemplate(req.body)
    const { name, language, components } = payload
    const existing = await prisma.messageTemplate.findUnique({ where: { name_language: { name, language } } })
    if (existing) return res.status(409).json({ error: 'A template with this name and language already exists. Edit it or choose another name.' })
    const response = await metaFetch(`/${required('WHATSAPP_BUSINESS_ACCOUNT_ID')}/message_templates`, { method: 'POST', body: JSON.stringify(payload) })
    const result: any = await response.json()
    if (!response.ok) return res.status(response.status).json({ error: metaErrorMessage(result.error) })
    if (!result.id) return res.status(502).json({ error: 'Meta returned an incomplete response. Sync templates before retrying.' })
    const parameterLabels = payload.category === 'AUTHENTICATION' ? [] : req.body.parameterLabels
    const template = await prisma.messageTemplate.upsert({ where: { name_language: { name, language } }, update: { metaTemplateId: result.id, category: result.category || payload.category, components, parameterLabels, status: mapTemplateStatus(result.status), rejectionReason: null }, create: { metaTemplateId: result.id, name, language, category: result.category || payload.category, components, parameterLabels, status: mapTemplateStatus(result.status) } })
    return res.status(201).json(template)
  } catch (error) { return res.status(error instanceof TemplateValidationError ? 400 : 502).json({ error: error instanceof Error ? error.message : 'Unable to create template', field: error instanceof TemplateValidationError ? error.field : undefined }) }
})

templatesRouter.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.messageTemplate.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Template not found' })
    if (!existing.metaTemplateId) return res.status(400).json({ error: 'This local draft has no Meta template ID' })
    if (!['APPROVED', 'REJECTED', 'PAUSED'].includes(existing.status)) return res.status(409).json({ error: 'Only approved, rejected, or paused templates can be edited. Sync the status before retrying.' })
    if (req.body.name && req.body.name !== existing.name || req.body.language && req.body.language !== existing.language) return res.status(400).json({ error: 'Template name and language cannot change when editing' })
    if (req.body.category && req.body.category !== existing.category) return res.status(400).json({ error: 'Create a new template to use a different category' })
    const payload = buildTemplate({ ...req.body, name: existing.name, language: existing.language, category: existing.category })
    const response = await metaFetch(`/${existing.metaTemplateId}`, { method: 'POST', body: JSON.stringify({ components: payload.components }) })
    const result: any = await response.json()
    if (!response.ok) return res.status(response.status).json({ error: metaErrorMessage(result.error) })
    if (result.success !== true) return res.status(502).json({ error: 'Meta did not confirm the edit. Sync templates before retrying.' })
    const template = await prisma.messageTemplate.update({ where: { id: existing.id }, data: { components: payload.components, parameterLabels: payload.category === 'AUTHENTICATION' ? [] : req.body.parameterLabels, status: 'PENDING', rejectionReason: null } })
    return res.json(template)
  } catch (error) { return res.status(error instanceof TemplateValidationError ? 400 : 502).json({ error: error instanceof Error ? error.message : 'Unable to update template', field: error instanceof TemplateValidationError ? error.field : undefined }) }
})

templatesRouter.delete('/:id', async (req, res) => {
  const template = await prisma.messageTemplate.findUnique({ where: { id: req.params.id } })
  if (!template) return res.status(404).json({ error: 'Template not found' })
  if (await prisma.automationFlow.count({ where: { templateId: template.id } })) return res.status(409).json({ error: 'Remove this template from automation flows before deleting it' })
  if (template.metaTemplateId) {
    const query = new URLSearchParams({ name: template.name, hsm_id: template.metaTemplateId })
    const response = await metaFetch(`/${required('WHATSAPP_BUSINESS_ACCOUNT_ID')}/message_templates?${query}`, { method: 'DELETE' })
    const result: any = await response.json()
    if (!response.ok) return res.status(response.status).json({ error: metaErrorMessage(result.error), details: result.error })
  }
  await prisma.messageTemplate.delete({ where: { id: template.id } })
  res.sendStatus(204)
})
