import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { prisma } from '../db.js'
import { appointmentFlow } from '../../shared/whatsapp-flows.js'
import { issueFlowSession } from '../services/native-flows.js'
import { handleBookingExchange } from '../services/flow-booking.js'

// Explicit opt-in command. Isolated fixtures only; no customer messages or Meta calls.
const marker = `flow_test_${randomBytes(8).toString('hex')}`
const contacts: string[] = [], slots: string[] = []
let flowId: string | undefined
try {
  const flow = await prisma.whatsAppFlow.create({ data: { name: marker, categories: ['APPOINTMENT_BOOKING'], flowJson: appointmentFlow(), endpointMode: 'APPOINTMENT', status: 'PUBLISHED' } })
  flowId = flow.id
  const tokens: string[] = []
  for (let i = 0; i < 3; i++) {
    const contact = await prisma.contact.create({ data: { waId: `${marker}_${i}`, phone: `${marker}_${i}` } }); contacts.push(contact.id)
    const conversation = await prisma.conversation.create({ data: { contactId: contact.id } })
    tokens.push(await issueFlowSession(flow, conversation.id, contact.id))
  }
  for (let i = 0; i < 2; i++) {
    const slot = await prisma.appointmentSlot.create({ data: { startsAt: new Date(Date.UTC(2090, 0, 1) + Number.parseInt(randomBytes(5).toString('hex'), 16)) } }); slots.push(slot.id)
  }
  async function review(token: string, slotId: string) {
    const response: any = await handleBookingExchange({ action: 'data_exchange', screen: 'APPOINTMENT', flow_token: token, data: { name: 'Integration fixture', age: '30', idLast4: '0000', slotId } })
    assert.equal(response.screen, 'REVIEW')
    return { action: 'data_exchange', screen: 'REVIEW', flow_token: token, data: { selection: response.data.selection } }
  }
  const repeated = await review(tokens[0], slots[0])
  const retries = await Promise.all(Array.from({ length: 5 }, () => handleBookingExchange(repeated)))
  assert.ok(retries.every((r: any) => r.screen === 'SUCCESS'))
  assert.equal(new Set(retries.map((r: any) => r.data.extension_message_response.params.appointment_reference)).size, 1)
  assert.equal(await prisma.appointment.count({ where: { slotId: slots[0] } }), 1)
  const requests = await Promise.all([review(tokens[1], slots[1]), review(tokens[2], slots[1])])
  const race = await Promise.all(requests.map(handleBookingExchange))
  assert.equal(race.filter((r: any) => r.screen === 'SUCCESS').length, 1)
  assert.equal(race.filter((r: any) => r.screen === 'REVIEW').length, 1)
  assert.equal(await prisma.appointment.count({ where: { slotId: slots[1] } }), 1)
  assert.equal(await prisma.whatsAppFlowSession.count({ where: { flowId, result: { path: ['appointment_reference'], not: '' } } }), 2)
  console.log('Database checks passed: five simultaneous retries created one appointment; two customers competing for one slot produced exactly one booking.')
} finally {
  await prisma.appointment.deleteMany({ where: { slotId: { in: slots } } })
  await prisma.contact.deleteMany({ where: { id: { in: contacts } } })
  if (flowId) await prisma.whatsAppFlow.delete({ where: { id: flowId } })
  await prisma.appointmentSlot.deleteMany({ where: { id: { in: slots } } })
  await prisma.$disconnect()
}
