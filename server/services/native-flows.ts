import { createHash, randomBytes } from 'node:crypto'
import type { WhatsAppFlow } from '@prisma/client'
import { prisma } from '../db.js'
import { FlowError, isEditableFlow, validateFlowInput, type FlowInput } from '../../shared/whatsapp-flows.js'
import { metaErrorMessage, metaFetch, required } from './meta.js'

export const flowTokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
export const publicFlow = ({ operationToken: _token, operationUntil: _until, ...flow }: WhatsAppFlow) => flow
export async function graphFlow(path: string, body?: Record<string, unknown> | FormData, method = body ? 'POST' : 'GET'): Promise<any> {
  let response: Response
  if (body instanceof FormData) response = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v26.0'}${path}`, { method, headers: { Authorization: `Bearer ${required('META_SYSTEM_TOKEN')}` }, body, signal: AbortSignal.timeout(30000) })
  else response = await metaFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
  const result = await response.json().catch(() => null)
  if (!response.ok || result?.error) throw new FlowError(metaErrorMessage(result?.error), 502)
  if (!result || typeof result !== 'object') throw new FlowError('Meta returned an incomplete response. Refresh the Flow before retrying.', 502)
  return result
}
export function assertFlowRevision(flow: WhatsAppFlow, revision: unknown) {
  if (!Number.isInteger(revision) || revision !== flow.revision) throw new FlowError('This Flow has changed. Reload it before saving or publishing.', 409)
}
export async function withFlowLock<T>(id: string, operation: (flow: WhatsAppFlow) => Promise<T>): Promise<T> {
  const token = randomBytes(16).toString('hex')
  const claimed = await prisma.whatsAppFlow.updateMany({ where: { id, OR: [{ operationUntil: null }, { operationUntil: { lt: new Date() } }] }, data: { operationToken: token, operationUntil: new Date(Date.now() + 180_000) } })
  if (!claimed.count) throw new FlowError('Flow is unavailable or another operation is in progress. Refresh and try again.', 409)
  try {
    const flow = await prisma.whatsAppFlow.findUniqueOrThrow({ where: { id } })
    return await operation(flow)
  } finally { await prisma.whatsAppFlow.updateMany({ where: { id, operationToken: token }, data: { operationToken: null, operationUntil: null } }) }
}
export function effectiveEndpoint(flow: Pick<WhatsAppFlow, 'endpointMode' | 'endpointUri'>) {
  const uri = flow.endpointMode === 'APPOINTMENT' ? required('WHATSAPP_FLOW_ENDPOINT_URL') : flow.endpointUri
  if (flow.endpointMode !== 'NONE' && (!uri || !uri.startsWith('https://'))) throw new FlowError('Configure a public HTTPS Flow endpoint first')
  return uri
}
export async function refreshFlow(flow: WhatsAppFlow) {
  if (!flow.metaFlowId) return flow
  const remote = await graphFlow(`/${encodeURIComponent(flow.metaFlowId)}?fields=id,name,status,categories,validation_errors,health_status,endpoint_uri`)
  if (!remote.status) throw new FlowError('Meta did not return the Flow status', 502)
  return prisma.whatsAppFlow.update({ where: { id: flow.id }, data: { status: remote.status, validationErrors: remote.validation_errors ?? [], remoteDetails: remote } })
}
export async function uploadFlow(flow: WhatsAppFlow) {
  validateFlowInput(flow as unknown as FlowInput)
  if (flow.metaFlowId) flow = await refreshFlow(flow)
  if (!isEditableFlow(flow.status)) throw new FlowError('Published Flows cannot be edited. Make a copy to create a new version.', 409)
  const metadata = { name: flow.name, categories: flow.categories, ...(flow.endpointMode !== 'NONE' ? { endpoint_uri: effectiveEndpoint(flow) } : flow.metaFlowId ? { endpoint_uri: '' } : {}) }
  if (!flow.metaFlowId) {
    const remote = await graphFlow(`/${required('WHATSAPP_BUSINESS_ACCOUNT_ID')}/flows`, metadata)
    if (!remote.id) throw new FlowError('Meta did not return a Flow ID. Sync from Meta before retrying.', 502)
    flow = await prisma.whatsAppFlow.update({ where: { id: flow.id }, data: { metaFlowId: remote.id, status: 'DRAFT' } })
  } else {
    const result = await graphFlow(`/${flow.metaFlowId}`, metadata)
    if (result.success !== true) throw new FlowError('Meta did not confirm the metadata update', 502)
  }
  const form = new FormData()
  form.set('file', new Blob([JSON.stringify(flow.flowJson)], { type: 'application/json' }), 'flow.json')
  form.set('name', 'flow.json'); form.set('asset_type', 'FLOW_JSON')
  const result = await graphFlow(`/${flow.metaFlowId}/assets`, form)
  const errors = result.validation_errors ?? []
  if (!Array.isArray(errors)) throw new FlowError('Meta returned an invalid validation response', 502)
  const saved = await prisma.whatsAppFlow.update({ where: { id: flow.id }, data: { validationErrors: errors, syncedRevision: result.success === true && !errors.length ? flow.revision : null } })
  if (result.success !== true && !errors.length) throw new FlowError('Meta did not confirm the Flow upload', 502)
  return saved
}
export async function issueFlowSession(flow: WhatsAppFlow, conversationId: string, contactId: string) {
  const token = randomBytes(32).toString('base64url')
  await prisma.whatsAppFlowSession.create({ data: { flowId: flow.id, conversationId, contactId, tokenHash: flowTokenHash(token), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } })
  return token
}
export async function downloadFlowJson(metaFlowId: string) {
  const assets = await graphFlow(`/${encodeURIComponent(metaFlowId)}/assets`)
  const asset = assets.data?.find((item: any) => item.asset_type === 'FLOW_JSON')
  if (!asset) throw new FlowError('This Meta Flow has no uploaded JSON asset', 409)
  const url = new URL(asset.download_url)
  if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname.endsWith('.fbcdn.net') || url.hostname.endsWith('.facebook.com'))) throw new FlowError('Meta returned an unsupported asset host', 502)
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!response.ok || !response.body) throw new FlowError('Unable to download Flow JSON', 502)
  let size = 0; const chunks: Uint8Array[] = []
  for await (const chunk of response.body as any) { size += chunk.length; if (size > 1_000_000) { throw new FlowError('Flow JSON exceeds the editor size limit', 400) } chunks.push(chunk) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
