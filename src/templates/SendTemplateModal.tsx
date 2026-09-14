import { useEffect, useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import type { ApiTemplate } from '../api'
import { buildSendComponents, templateSendFields, type SendOptions, type HeaderMediaInput } from '../../shared/template-send'
import { type Component, variableKeys } from '../../shared/templates'
import { component, unsupportedTemplateReason } from './drafts'
import { MediaPicker } from './MediaPicker'
import { useDialog } from './TemplateModal'
import { flowsApi } from '../flows/api'

function DeliveryHeader({ header, value, text, change, busy }: { header?: Component; value?: HeaderMediaInput; text?: string; change: (data: Partial<SendOptions>) => void; busy: (value: boolean) => void }) {
  const [mode, setMode] = useState('upload')
  if (!header) return null
  const type = String(header.format).toUpperCase()
  if (type === 'TEXT') return variableKeys(header.text).length ? <label>Header value for {'{{' + variableKeys(header.text)[0] + '}}'}<input value={text || ''} onChange={e => change({ headerText: e.target.value })} /></label> : null
  if (type === 'LOCATION') {
    const location = value?.kind === 'location' ? value : { kind: 'location' as const, name: '', address: '', latitude: NaN, longitude: NaN }
    return <div className="template-subcard"><b>Location header</b>{(['name', 'address'] as const).map(key => <label key={key}>{key}<input value={location[key]} onChange={e => change({ headerMedia: { ...location, [key]: e.target.value } })} /></label>)}<div className="template-grid">{(['latitude', 'longitude'] as const).map(key => <label key={key}>{key}<input type="number" step="any" value={Number.isFinite(location[key]) ? location[key] : ''} onChange={e => change({ headerMedia: { ...location, [key]: e.target.value === '' ? NaN : Number(e.target.value) } })} /></label>)}</div></div>
  }
  if (type === 'PRODUCT') {
    const product = value?.kind === 'product' ? value : { kind: 'product' as const, catalogId: '', productRetailerId: '' }
    return <div className="template-subcard"><b>Product header</b><label>Catalog ID<input value={product.catalogId} onChange={e => change({ headerMedia: { ...product, catalogId: e.target.value } })} /></label><label>Product retailer ID<input value={product.productRetailerId} onChange={e => change({ headerMedia: { ...product, productRetailerId: e.target.value } })} /></label></div>
  }
  return <div className="template-subcard"><label>{type.toLowerCase()} header source<select value={mode} onChange={e => { setMode(e.target.value); change({ headerMedia: undefined }) }}><option value="upload">Upload a file</option><option value="link">Public HTTPS URL</option><option value="id">Existing WhatsApp media ID</option></select></label>{mode === 'upload' ? <MediaPicker type={type as 'IMAGE' | 'VIDEO' | 'DOCUMENT'} value={value && 'value' in value ? value.value : ''} delivery onChange={id => change({ headerMedia: { kind: 'id', value: id } })} onBusy={busy} /> : <label>{mode === 'link' ? 'Public HTTPS media URL' : 'WhatsApp media ID'}<input value={value && 'value' in value ? value.value : ''} onChange={e => change({ headerMedia: { kind: mode as 'id' | 'link', value: e.target.value } })} /></label>}<small>The template review sample is not automatically delivered.</small></div>
}
function ValueFields({ components, values, change, authentication = false, labels }: { components: Component[]; values: string[]; change: (values: string[]) => void; authentication?: boolean; labels?: string[] | null }) {
  return <>{templateSendFields(components, authentication).map((field, i) => <label key={field.key}>{authentication ? field.label : field.key.startsWith('url_') ? field.label : labels?.[i] || field.label}<input value={values[i] || ''} onChange={e => change(values.map((v, n) => n === i ? e.target.value : v))} /></label>)}</>
}
export function SendForm({ template, send, close, onBusy }: { template: ApiTemplate; send: (name: string, language: string, values: string[], options: SendOptions) => Promise<void>; close: () => void; onBusy: (busy: boolean) => void }) {
  const cs = template.components, carousel = component(cs, 'CAROUSEL'), buttons: Component[] = component(cs, 'BUTTONS')?.buttons || []
  const [values, setValues] = useState<string[]>(templateSendFields(cs, template.category === 'AUTHENTICATION').map(() => ''))
  const [options, setOptions] = useState<SendOptions>({ cards: carousel?.cards.map((card: Component) => ({ parameters: templateSendFields(card.components).map(() => '') })) })
  const [busy, setBusy] = useState(false), [sending, setSending] = useState(false), [error, setError] = useState(''), [flowJson, setFlowJson] = useState<Record<number, string>>({})
  const [managedFlows, setManagedFlows] = useState<number[]>([])
  useEffect(() => {
    if (!buttons.some(button => button.type?.toUpperCase() === 'FLOW')) return
    flowsApi.list().then(flows => setManagedFlows(buttons.flatMap((button, i) => flows.some(flow => flow.status === 'PUBLISHED' && flow.endpointMode !== 'EXTERNAL' && (flow.metaFlowId === button.flow_id || flow.name === button.flow_name)) ? [i] : []))).catch(() => {})
  }, [template.id])
  useEffect(() => { onBusy(busy || sending); return () => onBusy(false) }, [busy, sending, onBusy])
  const productCarousel = component(carousel?.cards[0]?.components || [], 'HEADER')?.format?.toUpperCase() === 'PRODUCT'
  const deliveryCards = productCarousel ? options.cards?.map((_, i) => carousel!.cards[i % carousel!.cards.length]) : carousel?.cards
  const patch = (next: Partial<SendOptions>) => setOptions(o => ({ ...o, ...next }))
  const patchButton = (i: number, next: NonNullable<SendOptions['buttons']>[string]) => setOptions(o => ({ ...o, buttons: { ...o.buttons, [i]: { ...o.buttons?.[i], ...next } } }))
  const submit = async () => {
    setError('')
    try {
      const data: SendOptions = { ...options, buttons: { ...options.buttons } }
      for (const index of managedFlows) data.buttons![index] = { ...data.buttons![index], flowToken: 'issued-by-server-on-send' }
      for (const [index, json] of Object.entries(flowJson)) {
        if (!json.trim()) continue
        const parsed = JSON.parse(json)
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Flow data must be a JSON object')
        data.buttons![index] = { ...data.buttons![index], flowData: parsed }
      }
      buildSendComponents(cs, values, data, template.category === 'AUTHENTICATION')
      setSending(true)
      await send(template.name, template.language, values, data)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to send template'); setSending(false) }
  }
  return <form onSubmit={e => { e.preventDefault(); void submit() }} noValidate><fieldset disabled={busy || sending}>
    <DeliveryHeader header={component(cs, 'HEADER')} value={options.headerMedia} text={options.headerText} change={patch} busy={setBusy} />
    <ValueFields components={cs} values={values} change={setValues} authentication={template.category === 'AUTHENTICATION'} labels={template.parameterLabels} />
    {buttons.map((button, i) => { const type = String(button.type).toUpperCase(), input = options.buttons?.[i] || {}; return <div key={i}>
      {type === 'COPY_CODE' && <label>Coupon code to send<input maxLength={component(cs, 'LIMITED_TIME_OFFER') ? 15 : 20} value={input.couponCode || ''} onChange={e => patchButton(i, { couponCode: e.target.value })} /></label>}
      {type === 'FLOW' && <>{managedFlows.includes(i) ? <p className="template-note">A secure link for this customer will be created automatically.</p> : <label>Session token from your Flow backend<input value={input.flowToken || ''} onChange={e => patchButton(i, { flowToken: e.target.value })} /></label>}<label>Initial Flow data (optional JSON object)<textarea value={flowJson[i] || ''} onChange={e => setFlowJson(v => ({ ...v, [i]: e.target.value }))} placeholder={'{"order_id":"123"}'} /></label></>}
      {['CATALOG', 'MPM'].includes(type) && <label>Thumbnail product retailer ID {type === 'CATALOG' && '(optional)'}<input value={input.thumbnailProductRetailerId || ''} onChange={e => patchButton(i, { thumbnailProductRetailerId: e.target.value })} /></label>}
      {type === 'MPM' && <div className="template-subcard"><b>Catalog sections · up to 30 products total</b>{input.sections?.map((section, n) => <div className="template-subcard" key={n}><label>Section title<input maxLength={24} value={section.title} onChange={e => patchButton(i, { sections: input.sections!.map((s, k) => k === n ? { ...s, title: e.target.value } : s) })} /></label><label>Product retailer IDs, separated by commas<input value={section.productIds.join(',')} onChange={e => patchButton(i, { sections: input.sections!.map((s, k) => k === n ? { ...s, productIds: e.target.value.split(',') } : s) })} /></label><button type="button" aria-label="Remove product section" onClick={() => patchButton(i, { sections: input.sections!.filter((_, k) => k !== n) })}><Trash2 size={14} /></button></div>)}<button type="button" disabled={(input.sections?.length || 0) >= 10} onClick={() => patchButton(i, { sections: [...(input.sections || []), { title: '', productIds: [] }] })}><Plus size={14} /> Add section</button></div>}
    </div> })}
    {component(cs, 'LIMITED_TIME_OFFER')?.limited_time_offer?.has_expiration && <label>Offer expiration (your local time)<input type="datetime-local" onChange={e => patch({ expirationTimeMs: new Date(e.target.value).getTime() })} /></label>}
    {deliveryCards?.map((card: Component, i: number) => <section key={i} className="template-subcard"><h3>Card {i + 1}</h3><DeliveryHeader header={component(card.components, 'HEADER')} value={options.cards?.[i].headerMedia} change={data => patch({ cards: options.cards!.map((c, n) => n === i ? { ...c, ...data } : c) })} busy={setBusy} /><ValueFields components={card.components} values={options.cards![i].parameters} change={parameters => patch({ cards: options.cards!.map((c, n) => n === i ? { ...c, parameters } : c) })} />{productCarousel && <button type="button" disabled={options.cards!.length <= 2 || i !== options.cards!.length - 1} onClick={() => patch({ cards: options.cards!.slice(0, -1) })}>Remove last product</button>}</section>)}
    {productCarousel && <button type="button" disabled={options.cards!.length >= 10} onClick={() => patch({ cards: [...options.cards!, { parameters: templateSendFields(carousel!.cards[options.cards!.length % carousel!.cards.length].components).map(() => '') }] })}>Add product</button>}
    <div className="template-note">{template.category === 'AUTHENTICATION' ? 'Your verification code will be sent.' : variableKeys(component(cs, 'BODY')?.text).reduce((text, key, i) => text.replaceAll(`{{${key}}}`, values[i] || `{{${key}}}`), component(cs, 'BODY')?.text || '')}</div>
  </fieldset>{error && <p className="template-error" role="alert">{error}</p>}<div className="template-editor-actions"><button type="button" disabled={busy || sending} onClick={close}>Cancel</button><button className="new-template" type="submit" disabled={busy || sending}>{busy ? 'Uploading…' : sending ? 'Sending…' : 'Send template'}</button></div></form>
}
export function SendTemplateModal({ templates, close, send }: { templates: ApiTemplate[]; close: () => void; send: (name: string, language: string, parameters: string[], options: SendOptions) => Promise<void> }) {
  const approved = templates.filter(t => t.status === 'APPROVED' && !unsupportedTemplateReason(t)), [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const template = approved.find(t => t.id === selected), dialog = useDialog(close, busy)
  return <div className="overlay template-overlay"><div className="template-editor" style={{ maxWidth: 640 }} role="dialog" aria-modal="true" aria-labelledby="send-template-title" tabIndex={-1} {...dialog}><div className="template-editor-head"><div><h2 id="send-template-title">Send approved template</h2><p>Provide delivery media and personalized values.</p></div><button aria-label="Close" onClick={close} disabled={busy}><X size={20} /></button></div><div style={{ padding: '0 24px 24px' }}><label>Template<select value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}><option value="">Choose an approved template</option>{approved.map(t => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}</select></label>{template && <SendForm key={template.id} template={template} send={send} close={close} onBusy={setBusy} />}{!approved.length && <p>No supported approved templates are available. Submit a template and sync after approval.</p>}</div></div></div>
}
