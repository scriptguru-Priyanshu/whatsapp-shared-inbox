import { request, type ApiMessage } from '../api'
import type { FlowInput, NativeFlow } from '../../shared/whatsapp-flows'
const base = '/api/whatsapp-flows'
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
export type FlowSetup = { publicKey: string; keyError: string; endpointUrl: string; endpointReady: boolean; metaReady: boolean; timezone: string }
export type FlowSlot = { id: string; startsAt: string; appointment: { reference: string } | null }
export const flowsApi = {
  list: () => request<NativeFlow[]>(base),
  create: (data: FlowInput) => request<NativeFlow>(base, json('POST', data)),
  save: (id: string, data: FlowInput) => request<NativeFlow>(`${base}/${id}`, json('PUT', data)),
  action: (flow: NativeFlow, action: string, extra = {}) => request<NativeFlow>(`${base}/${flow.id}/${action}`, json('POST', { revision: flow.revision, ...extra })),
  delete: (flow: NativeFlow) => request(`${base}/${flow.id}`, json('DELETE', { revision: flow.revision })),
  sync: () => request<{ count: number }>(`${base}/sync`, json('POST', {})),
  preview: (id: string) => request<{ preview_url: string; expires_at: string }>(`${base}/${id}/preview`),
  setup: () => request<FlowSetup>(`${base}/setup`),
  registerKey: () => request(`${base}/setup/register-key`, json('POST', {})),
  keyStatus: () => request<any>(`${base}/setup/key-status`),
  slots: () => request<FlowSlot[]>(`${base}/slots`),
  addSlots: (startsAt: string[]) => request(`${base}/slots`, json('POST', { startsAt })),
  removeSlot: (id: string) => request(`${base}/slots/${id}`, { method: 'DELETE' }),
  send: (id: string, data: Record<string, unknown>) => request<ApiMessage>(`${base}/${id}/send`, json('POST', data)),
}
