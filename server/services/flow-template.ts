import { prisma } from '../db.js'
import { issueFlowSession } from './native-flows.js'
import { FlowError } from '../../shared/whatsapp-flows.js'
import type { SendOptions } from '../../shared/template-send.js'

function flowButtons(components: any[]) {
  const buttons = components.find(item => item.type?.toUpperCase() === 'BUTTONS')?.buttons || []
  return buttons.map((button: any, index: number) => ({ button, index })).filter(({ button }: any) => button.type?.toUpperCase() === 'FLOW')
}

async function managedFlow(button: any, automatic = false) {
  if (!button.flow_id && !button.flow_name) {
    if (automatic) throw new FlowError('Flow buttons used by automations must reference a published Flow ID or Flow name.')
    return null
  }
  const flow = button.flow_id
    ? await prisma.whatsAppFlow.findUnique({ where: { metaFlowId: String(button.flow_id) } })
    : await prisma.whatsAppFlow.findFirst({ where: { name: button.flow_name, status: 'PUBLISHED' } })
  if (!flow) {
    if (automatic) throw new FlowError('The Flow attached to this template is not available in WhatsApp Flows.')
    return null
  }
  if (flow.status !== 'PUBLISHED') throw new FlowError('The Flow attached to this template is not published.')
  if (flow.endpointMode === 'EXTERNAL') {
    if (automatic) throw new FlowError('Automated sends require a locally managed Flow so a customer session can be created securely.')
    return null
  }
  if (flow.endpointMode === 'APPOINTMENT' && button.flow_action !== 'data_exchange') throw new FlowError('This appointment template must use the backend data exchange action. Update the template before sending.')
  return flow
}

export async function validateAutomaticFlowTemplate(components: any[]) {
  for (const { button } of flowButtons(components)) await managedFlow(button, true)
}

// Runs only after conversation authorization. Bind managed Flow launches to this customer.
export async function prepareFlowTemplate(conversationId: string, components: any[], options: SendOptions) {
  const prepared: SendOptions = { ...options, buttons: { ...options.buttons } }
  for (const { button, index } of flowButtons(components)) {
    const flow = await managedFlow(button)
    if (!flow) continue
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })
    prepared.buttons![index] = { ...prepared.buttons![index], flowToken: await issueFlowSession(flow, conversationId, conversation.contactId) }
  }
  return prepared
}
