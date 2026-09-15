import { buildSendComponents, type SendOptions } from '../../shared/template-send.js'
import { variableKeys } from '../../shared/templates.js'
import { prisma } from '../db.js'
import { metaErrorMessage, metaFetch, required, templateBody } from './meta.js'

export class WhatsAppSendError extends Error {}

export function messageBody(message: any) {
  if (message.interactive?.nfm_reply) return message.text?.body || 'Flow completed'
  if (message.type === 'text') return message.text?.body
  if (message.type === 'button') return message.button?.text
  if (message.type === 'interactive') return message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title
  return `[${message.type} message]`
}

export function messageReplyId(message: any) {
  if (message.type === 'button') return message.button?.payload ?? message.button?.text
  if (message.type === 'interactive') return message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id
  return null
}

export async function sendTextAndStore(conversationId: string, waId: string, body: string) {
  return sendWhatsAppAndStore(conversationId, waId, { type: 'text', text: { body } }, body)
}

export async function sendInteractiveAndStore(conversationId: string, waId: string, interactive: any, body: string) {
  return sendWhatsAppAndStore(conversationId, waId, { type: 'interactive', interactive }, body)
}

export async function sendTemplateAndStore(conversationId: string, waId: string, template: any, parameters: string[], options: SendOptions = {}) {
  if (template.status !== 'APPROVED') throw new Error('Only an approved template can be sent')
  const bodyText = templateBody(template.components)
  const componentList = Array.isArray(template.components) ? template.components : []
  const components = buildSendComponents(componentList, parameters, options, template.category === 'AUTHENTICATION')
  const payload: any = { messaging_product: 'whatsapp', to: waId, type: 'template', template: { name: template.name, language: { code: template.language }, ...(components.length ? { components } : {}) } }
  const keys = variableKeys(bodyText)
  const rendered = template.category === 'AUTHENTICATION' ? `Authentication code: ${parameters[0]}` : keys.reduce((text, key, index) => text.replaceAll(`{{${key}}}`, parameters[index]), bodyText)
  const response = await metaFetch(`/${required('WHATSAPP_PHONE_NUMBER_ID')}/messages`, { method: 'POST', body: JSON.stringify(payload) })
  const result: any = await response.json()
  if (!response.ok) throw new WhatsAppSendError(metaErrorMessage(result.error))
  const now = new Date()
  const snapshot = structuredClone(options)
  for (const button of Object.values(snapshot.buttons || {})) delete button.flowToken
  const message = await prisma.message.create({ data: { conversationId, metaMessageId: result.messages?.[0]?.id, direction: 'OUTBOUND', type: 'template', body: rendered, templateName: template.name, templateLanguage: template.language, templateComponents: template.components, templateParameters: { body: parameters, ...snapshot } as any, status: 'SENT', sentAt: now } })
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } })
  return message
}

async function sendWhatsAppAndStore(conversationId: string, waId: string, content: any, body: string) {
  const response = await metaFetch(`/${required('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: waId, ...content }),
  })
  const result: any = await response.json()
  if (!response.ok) throw new WhatsAppSendError(metaErrorMessage(result.error))
  const now = new Date()
  const message = await prisma.message.create({ data: { conversationId, metaMessageId: result.messages?.[0]?.id, direction: 'OUTBOUND', type: content.type, body, status: 'SENT', sentAt: now } })
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } })
  return message
}

export function statusUpdate(update: any) {
  const now = new Date()
  const status = String(update.status ?? '')
  if (status === 'sent') return { status: 'SENT' as const, sentAt: now }
  if (status === 'delivered') return { status: 'DELIVERED' as const, deliveredAt: now }
  if (status === 'read') return { status: 'READ' as const, readAt: now }
  if (status === 'failed') return { status: 'FAILED' as const, errorMessage: (update.errors ?? []).map((error: any) => metaErrorMessage(error)).join('; ') || 'WhatsApp delivery failed' }
  return null
}
