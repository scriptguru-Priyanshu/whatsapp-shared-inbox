export type ApiMessage = {
  id: string
  direction: 'INBOUND' | 'OUTBOUND'
  body: string | null
  type: string
  templateName: string | null
  templateLanguage: string | null
  templateComponents: Array<{type:string;format?:string;text?:string;buttons?:Array<{type:string;text:string;url?:string;phone_number?:string}>}> | null
  templateParameters: string[] | ({ body: string[]; header?: HeaderMediaInput } & SendOptions) | null
  errorMessage: string | null
  status: 'RECEIVED' | 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
  createdAt: string
}

export type WhatsAppHealth = { connected: boolean; displayPhoneNumber?: string; verifiedName?: string; qualityRating?: string; error?: string }
export type WhatsAppConnection = {
  id: string
  label: string
  metaBusinessId: string | null
  metaBusinessName: string | null
  wabaId: string
  wabaName: string | null
  phoneNumberId: string
  displayPhoneNumber: string | null
  verifiedName: string | null
  profileAbout: string | null
  profileAddress: string | null
  profileDescription: string | null
  profileEmail: string | null
  profilePictureUrl: string | null
  profileWebsites: string[]
  profileVertical: string | null
  status: 'PENDING' | 'ACTIVE' | 'ERROR'
  errorMessage: string | null
  connectedAt: string | null
  createdAt: string
}
export type EmbeddedSignupConfig = { hostedUrl: string; appId: string; configId: string; graphApiVersion: string }

export type ApiConversation = {
  id: string
  lastMessageAt: string
  lastCustomerMessageAt: string | null
  archivedAt: string | null
  closedAt: string | null
  unreadCount?: number
  contact: { id: string; waId: string; phone: string; profileName: string | null }
  messages: ApiMessage[]
  assignee: { id: string; name: string; email: string } | null
  claimedBy: { id: string; name: string; email: string } | null
}

export type ApiUser = { id: string; email: string; name: string; role: 'ADMIN'|'AGENT'; active?: boolean; createdAt?: string }

export type { TemplateDraft } from '../shared/templates.js'
import type { TemplateDraft } from '../shared/templates.js'
export type { HeaderMediaInput, SendOptions } from '../shared/template-send.js'
import type { HeaderMediaInput, SendOptions } from '../shared/template-send.js'

export type ApiTemplate = {
  id: string
  name: string
  language: string
  category: string
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED'
  components: Array<Record<string, any>>
  parameterLabels: string[] | null
  rejectionReason: string | null
  updatedAt: string
}

export type AutomationField = { key: string; label: string }
export type ApiAutomationTrigger = { id: string; key: string; name: string; description: string | null; fields: AutomationField[]; system: boolean; updatedAt: string }
export type ApiAutomationFlow = {
  id: string
  name: string
  trigger: string
  enabled: boolean
  actionType: 'MESSAGE' | 'TEMPLATE'
  messageBody: string | null
  templateId: string | null
  parameterMappings: string[] | null
  template: ApiTemplate | null
  updatedAt: string
}
export type AutomationFlowInput = { name: string; trigger: string; enabled: boolean; actionType: 'MESSAGE'|'TEMPLATE'; messageBody: string; templateId: string; parameterMappings: string[] }
export type ApiContact = {
  id: string
  waId: string
  phone: string
  profileName: string | null
  updatedAt: string
  conversations: Array<{ id: string; lastCustomerMessageAt: string | null; lastMessageAt: string; archivedAt: string|null; closedAt: string|null; unreadCount?:number }>
}
export type ApiAudience = { id: string; name: string; updatedAt: string; members: Array<{ contactId: string; contact: Omit<ApiContact, 'conversations'> }> }
export type BulkSendResult = { sent: number; failed: number; results: Array<{ contactId: string; ok: boolean; error?: string }> }

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('relay_token')
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(path, { ...init, headers })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error ?? `Request failed (${response.status})`)
  return data as T
}

// Multipart uploads must NOT set a Content-Type header manually — the browser needs to add its
// own boundary, so this deliberately skips the JSON header that `request` would otherwise imply.
async function uploadRequest<T>(path: string, file: File): Promise<T> {
  const token = localStorage.getItem('relay_token')
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const body = new FormData()
  body.set('file', file)
  const response = await fetch(path, { method: 'POST', headers, body })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error ?? `Upload failed (${response.status})`)
  return data as T
}

export const api = {
  login: (email: string, password: string) => request<{token:string;user:ApiUser}>('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }),
  me: () => request<ApiUser>('/api/auth/me'),
  agents: () => request<ApiUser[]>('/api/auth/agents'),
  createAgent: (data: {name:string;email:string;password:string}) => request<ApiUser>('/api/auth/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  whatsappHealth: () => request<WhatsAppHealth>('/api/health/whatsapp'),
  embeddedSignupConfig: () => request<EmbeddedSignupConfig>('/api/whatsapp-connections/config'),
  whatsappConnections: () => request<WhatsAppConnection[]>('/api/whatsapp-connections'),
  prepareEmbeddedSignup: (data: {label:string;pin:string}) => request<EmbeddedSignupConfig>('/api/whatsapp-connections/prepare', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  }),
  conversations: (includeArchived = false) => request<ApiConversation[]>(`/api/conversations${includeArchived ? '?includeArchived=true' : ''}`),
  updateConversation: (conversationId: string, action: 'read'|'open'|'close'|'archive'|'unarchive') => request<ApiConversation>(`/api/conversations/${conversationId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
  }),
  assignConversation: (conversationId: string, assigneeId: string|null) => request<ApiConversation>(`/api/conversations/${conversationId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assigneeId }) }),
  claimConversation: (conversationId: string, claim: boolean) => request<ApiConversation>(`/api/conversations/${conversationId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim }) }),
  messages: (conversationId: string) => request<ApiMessage[]>(`/api/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, body: string) => request<ApiMessage>(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  }),
  templates: (sync = false) => request<ApiTemplate[]>(`/api/templates${sync ? '?sync=true' : ''}`),
  createTemplate: (data: TemplateDraft) => request<ApiTemplate>('/api/templates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  }),
  updateTemplate: (id: string, data: Omit<TemplateDraft, 'name'|'language'> & { name?: string; language?: string }) => request<ApiTemplate>(`/api/templates/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  }),
  deleteTemplate: (id: string) => request<null>(`/api/templates/${id}`, { method: 'DELETE' }),
  uploadTemplateExampleMedia: (file: File) => uploadRequest<{ handle: string }>('/api/templates/media/example', file),
  // Sample media for template CREATION — reviewed by Meta, never delivered to a customer.
  // Actual media for a template SEND — a fresh upload per message, returns a ~30-day media ID.
  uploadSendMedia: (file: File) => uploadRequest<{ mediaId: string }>('/api/templates/media/send', file),
  sendTemplate: (conversationId: string, data: { name: string; language: string; parameters: string[] } & SendOptions) => request<ApiMessage>(`/api/conversations/${conversationId}/templates`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  }),
  contacts: () => request<ApiContact[]>('/api/contacts'),
  createContact: (data: { name: string; phone: string }) => request<ApiContact>('/api/contacts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  }),
  audiences: () => request<ApiAudience[]>('/api/audiences'),
  createAudience: (data: { name: string; contactIds: string[] }) => request<ApiAudience>('/api/audiences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  updateAudience: (id: string, data: { name: string; contactIds: string[] }) => request<ApiAudience>(`/api/audiences/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  deleteAudience: (id: string) => request<null>(`/api/audiences/${id}`, { method: 'DELETE' }),
  sendBulkTemplate: (data: { contactIds: string[]; audienceIds: string[]; name: string; language: string; parameters: string[] } & SendOptions) => request<BulkSendResult>('/api/audiences/send-template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  automationFlows: () => request<ApiAutomationFlow[]>('/api/automations'),
  automationTriggers: () => request<ApiAutomationTrigger[]>('/api/automations/triggers'),
  createAutomationFlow: (data: AutomationFlowInput) => request<ApiAutomationFlow>('/api/automations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  updateAutomationFlow: (id: string, data: AutomationFlowInput) => request<ApiAutomationFlow>(`/api/automations/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  toggleAutomationFlow: (id: string, enabled: boolean) => request<ApiAutomationFlow>(`/api/automations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }),
  deleteAutomationFlow: (id: string) => request<null>(`/api/automations/${id}`, { method: 'DELETE' }),
  createAutomationTrigger: (data: { name: string; description: string; fields: AutomationField[] }) => request<ApiAutomationTrigger>('/api/automations/triggers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  deleteAutomationTrigger: (id: string) => request<null>(`/api/automations/triggers/${id}`, { method: 'DELETE' }),
}
