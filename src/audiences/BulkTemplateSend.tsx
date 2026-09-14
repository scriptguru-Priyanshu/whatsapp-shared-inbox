import { useState } from 'react'
import { api, type ApiAudience, type ApiContact, type ApiTemplate } from '../api'
import { SendForm } from '../templates/SendTemplateModal'
import { unsupportedTemplateReason } from '../templates/drafts'
import { ContactPicker } from './Audiences'

type RecipientMode = 'AUDIENCE' | 'CONTACTS'

export function BulkTemplateSend({ templates, contacts, audiences }: { templates: ApiTemplate[]; contacts: ApiContact[]; audiences: ApiAudience[] }) {
  const approved = templates.filter(template => template.status === 'APPROVED' && !unsupportedTemplateReason(template))
  const [templateId, setTemplateId] = useState(''), [mode, setMode] = useState<RecipientMode>('AUDIENCE'), [audienceId, setAudienceId] = useState(''), [contactIds, setContactIds] = useState<string[]>([]), [busy, setBusy] = useState(false), [result, setResult] = useState(''), [formKey, setFormKey] = useState(0)
  const template = approved.find(item => item.id === templateId), audience = audiences.find(item => item.id === audienceId)
  const recipientCount = mode === 'AUDIENCE' ? audience?.members.length || 0 : contactIds.length
  const chooseMode = (next: RecipientMode) => { setMode(next); setResult(''); if (next === 'AUDIENCE') setContactIds([]); else setAudienceId('') }

  return <div className="templates"><div className="mx-auto max-w-3xl"><h2 className="m-0 font-display text-lg font-bold">Send a template</h2><p className="mt-1 text-xs text-slate-500">Send one approved WhatsApp template to an audience or selected contacts.</p><div className="template-editor mt-5 !max-h-none !w-full !overflow-visible !rounded-xl !shadow-none"><div className="p-6">
    <label>Approved template<select value={templateId} disabled={busy} onChange={e => { setTemplateId(e.target.value); setResult('') }}><option value="">Choose a template</option>{approved.map(item => <option key={item.id} value={item.id}>{item.name.replaceAll('_', ' ')} ({item.language})</option>)}</select></label>
    {!approved.length && <p className="template-note">No approved templates are currently available.</p>}
    <h3 className="mt-7 !mb-2">Who should receive it?</h3>
    <div className="grid grid-cols-2 gap-3"><button type="button" className={mode === 'AUDIENCE' ? '!border-relay-500 !bg-relay-50 !text-relay-700' : ''} onClick={() => chooseMode('AUDIENCE')}>One audience</button><button type="button" className={mode === 'CONTACTS' ? '!border-relay-500 !bg-relay-50 !text-relay-700' : ''} onClick={() => chooseMode('CONTACTS')}>Individual contacts</button></div>
    {mode === 'AUDIENCE' ? <label>Audience<select value={audienceId} disabled={busy} onChange={e => { setAudienceId(e.target.value); setResult('') }}><option value="">Choose one saved audience</option>{audiences.map(item => <option key={item.id} value={item.id}>{item.name} ({item.members.length} contacts)</option>)}</select></label> : <div className="mt-4"><ContactPicker contacts={contacts} selected={contactIds} change={ids => { setContactIds(ids); setResult('') }} /></div>}
    <p className="template-note"><b>{recipientCount} recipient{recipientCount === 1 ? '' : 's'} selected</b><br />{mode === 'AUDIENCE' ? 'Everyone saved in this audience will receive the template.' : 'Only the selected contacts will receive the template.'}</p>
    {result && <p role="status" className="template-note">{result}</p>}
    {template && recipientCount > 0 ? <SendForm key={`${template.id}-${formKey}`} template={template} close={() => {}} onBusy={setBusy} send={async (name, language, parameters, options) => { const response = await api.sendBulkTemplate({ contactIds: mode === 'CONTACTS' ? contactIds : [], audienceIds: mode === 'AUDIENCE' ? [audienceId] : [], name, language, parameters, ...options }); setResult(`${response.sent} sent${response.failed ? ` · ${response.failed} failed` : ''}`); setFormKey(value => value + 1) }} /> : <div className="template-editor-actions"><button className="new-template" type="button" disabled>{!template ? 'Choose a template to continue' : 'Select recipients to continue'}</button></div>}
  </div></div></div></div>
}
