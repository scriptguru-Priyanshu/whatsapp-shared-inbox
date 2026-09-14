import { prisma } from '../db.js'
import { sendTemplateAndStore, sendTextAndStore } from './messaging.js'

export async function runAutomationFlows(trigger: string, conversationId: string, waId: string, context: Record<string, string>) {
  const flows = await prisma.automationFlow.findMany({
    where: { trigger, enabled: true },
    include: { template: true },
    orderBy: { createdAt: 'asc' },
  })
  for (const flow of flows) {
    try {
      if (flow.actionType === 'MESSAGE') {
        if (!flow.messageBody) throw new Error('The flow has no message text')
        await sendTextAndStore(conversationId, waId, renderAutomationText(flow.messageBody, context))
      } else {
        if (!flow.template) throw new Error('The selected template no longer exists')
        const mappings = Array.isArray(flow.parameterMappings) ? flow.parameterMappings.map(String) : []
        await sendTemplateAndStore(conversationId, waId, flow.template, mappings.map(key => context[key] ?? ''))
      }
    } catch (error) {
      console.error(`Automation flow ${flow.id} failed:`, error)
    }
  }
}

export function runAppointmentBookedFlows(conversationId: string, waId: string, context: Record<string, string>) {
  return runAutomationFlows('APPOINTMENT_BOOKED', conversationId, waId, context)
}

export function renderAutomationText(body: string, context: Record<string, string>) {
  return body.replace(/\{\{([a-z_]+)\}\}/g, (_match, key) => context[key] ?? '')
}
