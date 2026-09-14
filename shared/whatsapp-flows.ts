export type FlowObject = Record<string, any>
export const FLOW_CATEGORIES = ['SIGN_UP', 'SIGN_IN', 'APPOINTMENT_BOOKING', 'LEAD_GENERATION', 'CONTACT_US', 'CUSTOMER_SUPPORT', 'SURVEY', 'OTHER'] as const
export type FlowMode = 'NONE' | 'APPOINTMENT' | 'EXTERNAL'
export type FlowInput = { name: string; categories: string[]; flowJson: FlowObject; endpointMode: FlowMode; endpointUri: string; revision?: number }
export type NativeFlow = FlowInput & { id: string; metaFlowId: string | null; status: string; revision: number; syncedRevision: number | null; validationErrors: FlowObject[]; remoteDetails: FlowObject; updatedAt: string }
export class FlowError extends Error { constructor(message: string, public status = 400) { super(message) } }
export const isEditableFlow = (status: string) => ['LOCAL_DRAFT', 'DRAFT'].includes(status)

// Deliberately structural: Meta remains the authority on version-specific component rules.
// Unknown components/properties survive editing, import, export and upload unchanged.
export function validateFlowJson(json: unknown): string[] {
  const errors: string[] = []
  if (!json || typeof json !== 'object' || Array.isArray(json)) return ['Flow JSON must be an object']
  const doc = json as FlowObject
  if (JSON.stringify(json).length > 1_000_000) errors.push('Flow JSON exceeds the 1 MB editor limit')
  if (typeof doc.version !== 'string' || !/^\d+\.\d+$/.test(doc.version)) errors.push('Set a Flow JSON version, such as 7.3')
  if (!Array.isArray(doc.screens) || !doc.screens.length) return [...errors, 'Add at least one screen']
  if (doc.screens.length > 100) errors.push('The editor supports up to 100 screens per Flow')
  const inspectComponents = (items: unknown[], depth = 0) => {
    if (depth > 30) { errors.push('Component nesting exceeds the editor limit'); return }
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof (item as FlowObject).type !== 'string') { errors.push('Each component must be an object with a type'); continue }
      const component = item as FlowObject
      if ('children' in component) {
        if (!Array.isArray(component.children)) errors.push('Component children must be an array')
        else inspectComponents(component.children, depth + 1)
      }
    }
  }
  const ids = new Set<string>()
  for (const screen of doc.screens) {
    if (!screen || typeof screen.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(screen.id)) errors.push('Each screen needs a valid ID')
    else if (ids.has(screen.id)) errors.push(`Duplicate screen ID: ${screen.id}`)
    else ids.add(screen.id)
    if (screen?.layout?.type !== 'SingleColumnLayout' || !Array.isArray(screen?.layout?.children)) errors.push(`Screen ${screen?.id || '?'} needs a SingleColumnLayout with children`)
    else inspectComponents(screen.layout.children)
  }
  if (!doc.screens.some((screen: FlowObject) => screen?.terminal === true)) errors.push('Mark at least one screen as terminal')
  if (doc.routing_model) for (const [from, targets] of Object.entries(doc.routing_model)) {
    if (!ids.has(from)) errors.push(`Unknown route source: ${from}`)
    if (!Array.isArray(targets) || targets.some(target => !ids.has(target))) errors.push(`Invalid route targets for ${from}`)
  }
  return errors
}
export function canonicalFlowJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalFlowJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalFlowJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export function validateFlowInput(value: FlowInput): FlowInput {
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 200) throw new FlowError('Use a Flow name of 1–200 characters')
  if (!Array.isArray(value.categories) || !value.categories.length || value.categories.some(c => !FLOW_CATEGORIES.includes(c as any))) throw new FlowError('Choose at least one supported category')
  if (!['NONE', 'APPOINTMENT', 'EXTERNAL'].includes(value.endpointMode)) throw new FlowError('Select a valid endpoint mode')
  if (value.endpointMode === 'EXTERNAL') {
    let url: URL
    try { url = new URL(value.endpointUri) } catch { throw new FlowError('Set a public HTTPS endpoint URL') }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new FlowError('Set a public HTTPS endpoint URL without credentials or a fragment')
  }
  const errors = validateFlowJson(value.flowJson)
  if (errors.length) throw new FlowError(errors.join('; '))
  if (value.endpointMode !== 'NONE' && value.flowJson.data_api_version !== '3.0') throw new FlowError('Data exchange requires data_api_version 3.0')
  if (value.endpointMode === 'NONE' && JSON.stringify(value.flowJson).includes('"data_exchange"')) throw new FlowError('Select a backend endpoint for data exchange actions')
  if (value.endpointMode === 'APPOINTMENT') validateAppointmentContract(value.flowJson)
  return { ...value, name: value.name.trim(), categories: [...new Set(value.categories)], endpointUri: value.endpointMode === 'EXTERNAL' ? value.endpointUri.trim() : '' }
}
export function blankFlow(): FlowObject {
  return { version: '7.3', screens: [{ id: 'WELCOME', title: 'Welcome', terminal: true, success: true, data: {}, layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'form', children: [{ type: 'TextHeading', text: 'How can we help?' }, { type: 'Footer', label: 'Done', 'on-click-action': { name: 'complete', payload: {} } }] }] } }] }
}
const textSchema = (example: string) => ({ type: 'string', __example__: example })
export function validateAppointmentContract(doc: FlowObject) {
  const normalize = (value: any): any => {
    if (Array.isArray(value)) return value.map(normalize)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.keys(value).sort().filter(key => !['title', 'helper-text', '__example__', 'version'].includes(key)).map(key => [key, ['text', 'label'].includes(key) && typeof value[key] === 'string' && !value[key].startsWith('${') ? '__wording__' : normalize(value[key])]))
  }
  if (JSON.stringify(normalize(doc)) !== JSON.stringify(normalize(appointmentFlow()))) throw new FlowError('The built-in booking steps must keep their connected fields and actions. Start from the appointment starter, or select your own backend for a custom booking form.')
}
export function appointmentFlow(): FlowObject {
  return { version: '7.3', data_api_version: '3.0', routing_model: { APPOINTMENT: ['REVIEW'], REVIEW: [] }, screens: [
    { id: 'APPOINTMENT', title: 'Book an appointment', refresh_on_back: true, data: {
      slots: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } }, __example__: [{ id: 'sample', title: '10 Sep, 10:00 AM' }] },
      notice: textSchema('Choose an available time. Times are in Asia/Kolkata.'), available: { type: 'boolean', __example__: true },
    }, layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'booking', children: [
      { type: 'TextBody', text: '${data.notice}' },
      { type: 'TextInput', name: 'name', label: 'Patient name', required: true, 'max-chars': 100 },
      { type: 'TextInput', name: 'age', label: 'Age', 'input-type': 'number', required: true },
      { type: 'TextInput', name: 'idLast4', label: 'ID last 4 digits', 'input-type': 'number', required: true, 'min-chars': 4, 'max-chars': 4 },
      { type: 'Dropdown', name: 'slotId', label: 'Available appointments', 'data-source': '${data.slots}', required: true, enabled: '${data.available}' },
      { type: 'Footer', label: 'Review booking', enabled: '${data.available}', 'on-click-action': { name: 'data_exchange', payload: { name: '${form.name}', age: '${form.age}', idLast4: '${form.idLast4}', slotId: '${form.slotId}' } } },
    ] }] } },
    { id: 'REVIEW', title: 'Confirm appointment', terminal: true, success: true, data: { summary: textSchema('Appointment for Alex'), selection: textSchema('server-issued selection') }, layout: { type: 'SingleColumnLayout', children: [
      { type: 'TextHeading', text: 'Review your appointment' }, { type: 'TextBody', text: '${data.summary}' },
      { type: 'Footer', label: 'Confirm booking', 'on-click-action': { name: 'data_exchange', payload: { selection: '${data.selection}' } } },
    ] } },
  ] }
}
export const FLOW_COMPONENTS = ['TextHeading', 'TextSubheading', 'TextBody', 'TextCaption', 'RichText', 'TextInput', 'TextArea', 'CheckboxGroup', 'RadioButtonsGroup', 'Dropdown', 'ChipsSelector', 'DatePicker', 'CalendarPicker', 'OptIn', 'Image', 'ImageCarousel', 'PhotoPicker', 'DocumentPicker', 'EmbeddedLink', 'NavigationList', 'Footer', 'Form', 'If', 'Switch']
export function componentExample(type: string, key: string): FlowObject {
  if (type.startsWith('Text') && !['TextInput', 'TextArea'].includes(type)) return { type, text: 'Your text' }
  if (['TextInput', 'TextArea', 'DatePicker', 'CalendarPicker', 'OptIn'].includes(type)) return { type, name: key, label: 'Your label', required: true }
  if (['Dropdown', 'CheckboxGroup', 'RadioButtonsGroup', 'ChipsSelector'].includes(type)) return { type, name: key, label: 'Choose an option', 'data-source': [{ id: 'option_1', title: 'Option 1' }], required: true }
  if (type === 'Footer') return { type, label: 'Continue', 'on-click-action': { name: 'complete', payload: {} } }
  if (type === 'Form') return { type, name: key, children: [] }
  if (type === 'Image') return { type, src: '', 'alt-text': 'Image description', height: 180, 'scale-type': 'contain' }
  if (type === 'PhotoPicker') return { type, name: key, label: 'Upload photos', 'photo-source': 'camera_gallery', 'max-uploaded-photos': 3 }
  if (type === 'DocumentPicker') return { type, name: key, label: 'Upload documents', 'max-uploaded-documents': 3 }
  if (type === 'EmbeddedLink') return { type, text: 'Learn more', 'on-click-action': { name: 'open_url', url: 'https://example.com' } }
  return { type } // Advanced components require version-specific properties in the property editor.
}

// Keep answers connected when fields are added/removed in the guided builder.
// Literal custom payloads and backend actions are left intact.
export function connectFormAnswers(doc: FlowObject) {
  const flatten = (items: FlowObject[]): FlowObject[] => items.flatMap(item => [item, ...(Array.isArray(item.children) ? flatten(item.children) : [])])
  for (let pass = 0; pass < doc.screens.length; pass++) for (const screen of doc.screens) {
    const components = flatten(screen.layout.children), answers: FlowObject = {}
    for (const key of Object.keys(screen.data || {})) answers[key] = { ref: '${data.' + key + '}', schema: screen.data[key] }
    for (const form of components.filter(item => item.type === 'Form')) for (const input of flatten(form.children || [])) {
      if (!input.name || input.type === 'Form') continue
      const schema = input.type === 'OptIn' ? { type: 'boolean', __example__: false } : ['CheckboxGroup', 'ChipsSelector'].includes(input.type) ? { type: 'array', items: { type: 'string' }, __example__: ['option_1'] } : { type: 'string', __example__: 'Example' }
      if (!['PhotoPicker', 'DocumentPicker'].includes(input.type)) answers[input.name] = { ref: '${form.' + input.name + '}', schema }
    }
    for (const component of components) {
      const action = component['on-click-action']
      if (component.type !== 'Footer' || !['complete', 'navigate'].includes(action?.name)) continue
      action.payload ||= {}
      for (const [key, ref] of Object.entries(action.payload)) if (typeof ref === 'string' && /^\$\{form\.[^}]+\}$/.test(ref) && !answers[ref.slice(7, -1)]) delete action.payload[key]
      for (const [key, answer] of Object.entries(answers)) if (!(key in action.payload)) action.payload[key] = answer.ref
      if (action.name === 'complete') for (const input of components) if (['PhotoPicker', 'DocumentPicker'].includes(input.type) && input.name && !(input.name in action.payload)) action.payload[input.name] = '${form.' + input.name + '}'
      if (action.name === 'navigate') {
        const next = doc.screens.find((candidate: FlowObject) => candidate.id === action.next?.name)
        if (next) { next.data ||= {}; for (const [key, ref] of Object.entries(action.payload)) if (answers[key]?.ref === ref) next.data[key] ||= structuredClone(answers[key].schema) }
      }
    }
  }
  return doc
}
