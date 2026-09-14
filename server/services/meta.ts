import { variableKeys } from '../../shared/templates.js'
import crypto from 'node:crypto'

export function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

export function metaFetch(path: string, init: RequestInit = {}) {
  return fetch(`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v26.0'}${path}`, {
    signal: AbortSignal.timeout(30000),
    ...init,
    headers: {
      Authorization: `Bearer ${required('META_SYSTEM_TOKEN')}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

export function metaErrorMessage(error: any) {
  if (!error) return 'Meta rejected the request'
  const parts = [error.error_user_title, error.error_user_msg, error.message].filter(Boolean)
  const code = error.code ? `Meta code ${error.code}${error.error_subcode ? `/${error.error_subcode}` : ''}` : ''
  return [...new Set(parts), code].filter(Boolean).join(' — ')
}

export function appSecretProof(token: string) {
  return crypto.createHmac('sha256', required('META_APP_SECRET')).update(token).digest('hex')
}

export function verifyMetaSignature(body: Buffer, signature?: string) {
  const secret = process.env.META_APP_SECRET
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

export function mapTemplateStatus(value?: string) {
  const valid = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'] as const
  return valid.includes(value as any) ? value as typeof valid[number] : 'PENDING'
}

export function templateVariableCount(body: string) {
  return variableKeys(body).length
}

export function templateBody(components: unknown) {
  const list = Array.isArray(components) ? components : []
  return String(list.find((component: any) => component.type?.toUpperCase() === 'BODY')?.text ?? '')
}

export function normalizeTemplateButtons(input: any[]): { buttons: any[] } | { error: string } {
  if (input.length > 10) return { error: 'Meta allows at most 10 buttons per template' }
  const quickReplies = input.filter(button => button.type === 'QUICK_REPLY')
  const urls = input.filter(button => button.type === 'URL')
  const phones = input.filter(button => button.type === 'PHONE_NUMBER')
  if (quickReplies.length > 10) return { error: 'A template can have at most 10 quick-reply buttons' }
  if (urls.length > 2) return { error: 'A template can have at most 2 URL buttons' }
  if (phones.length > 1) return { error: 'A template can have at most 1 phone button' }
  const labels = input.map(button => String(button.text ?? '').trim().toLowerCase())
  if (new Set(labels).size !== labels.length) return { error: 'Every button must have unique text' }
  const buttons: any[] = []
  const grouped = [...quickReplies, ...urls, ...phones]
  for (const raw of grouped) {
    const type = String(raw.type ?? '').toUpperCase(), text = String(raw.text ?? '').trim()
    if (!['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(type)) return { error: 'Unsupported button type' }
    if (!text || text.length > 25) return { error: 'Button text must contain 1–25 characters' }
    if (type === 'QUICK_REPLY') buttons.push({ type, text })
    if (type === 'PHONE_NUMBER') {
      const phone_number = String(raw.value ?? '').replace(/[\s()-]/g, '')
      if (!/^\+[1-9]\d{7,14}$/.test(phone_number)) return { error: 'Phone buttons require an international number such as +919876543210' }
      buttons.push({ type, text, phone_number })
    }
    if (type === 'URL') {
      const url = String(raw.value ?? '').trim()
      if (!/^https:\/\//i.test(url)) return { error: 'Button URLs must start with https://' }
      const variables = Array.from(url.matchAll(/\{\{(\d+)\}\}/g))
      if (variables.length > 1 || (variables.length === 1 && !url.endsWith('{{1}}'))) return { error: 'A dynamic URL may contain only {{1}}, at the end' }
      const button: any = { type, text, url }
      if (variables.length) {
        const example = String(raw.example ?? '').trim()
        if (!example) return { error: 'Dynamic URL buttons require an example value' }
        button.example = [url.replace('{{1}}', example)]
      }
      buttons.push(button)
    }
  }
  return { buttons }
}
