import { useEffect, useState } from 'react'
import { flowsApi } from './api'
import type { NativeFlow } from '../../shared/whatsapp-flows'
import type { ButtonDraft } from '../../shared/templates'

export function TemplateFlowPicker({ value, change }: { value: ButtonDraft; change: (value: Partial<ButtonDraft>) => void }) {
  const [flows, setFlows] = useState<NativeFlow[]>([]), [error, setError] = useState('')
  useEffect(() => { flowsApi.list().then(all => setFlows(all.filter(flow => flow.status === 'PUBLISHED'))).catch(() => setError('Could not load Flows. You can enter a Flow ID below.')) }, [])
  return <><label>Choose a published Flow<select value={flows.find(flow => flow.metaFlowId === value.flowId)?.id || ''} onChange={e => { const flow = flows.find(item => item.id === e.target.value); if (flow) change({ flowId: flow.metaFlowId!, flowName: undefined, flowJson: undefined, flowAction: flow.endpointMode === 'NONE' ? 'navigate' : 'data_exchange', navigateScreen: flow.flowJson.screens?.[0]?.id || '' }) }}><option value="">Select a Flow, or enter one manually below</option>{flows.map(flow => <option key={flow.id} value={flow.id}>{flow.name}</option>)}</select></label>{error && <small>{error}</small>}{!flows.length && !error && <small>Create and publish a Flow in WhatsApp Flows to choose it here.</small>}</>
}
