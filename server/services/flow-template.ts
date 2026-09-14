import { prisma } from '../db.js'
import { issueFlowSession } from './native-flows.js'
import { FlowError } from '../../shared/whatsapp-flows.js'
import type { SendOptions } from '../../shared/template-send.js'

// Runs only after conversation authorization. Bind managed Flow launches to this customer.
export async function prepareFlowTemplate(conversationId: string, components: any[], options: SendOptions) {
  const buttons = components.find(item => item.type?.toUpperCase() === 'BUTTONS')?.buttons || []
  const prepared: SendOptions = { ...options, buttons: { ...options.buttons } }
  for (const [index, button] of buttons.entries()) {
    if (button.type?.toUpperCase() !== 'FLOW' || (!button.flow_id && !button.flow_name)) continue
    const flow = button.flow_id ? await prisma.whatsAppFlow.findUnique({ where: { metaFlowId: String(button.flow_id) } }) : await prisma.whatsAppFlow.findFirst({ where: { name: button.flow_name, status: 'PUBLISHED' } })
    if (!flow || flow.endpointMode === 'EXTERNAL') continue
    if (flow.status !== 'PUBLISHED') throw new FlowError('The Flow attached to this template is not published.')
    if (flow.endpointMode === 'APPOINTMENT' && button.flow_action !== 'data_exchange') throw new FlowError('This appointment template must use the backend data exchange action. Update the template before sending.')
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })
    prepared.buttons![index] = { ...prepared.buttons![index], flowToken: await issueFlowSession(flow, conversationId, conversation.contactId) }
  }
  return prepared
}
