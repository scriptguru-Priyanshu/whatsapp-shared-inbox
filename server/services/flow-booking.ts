import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { FlowError } from '../../shared/whatsapp-flows.js'
import { flowTokenHash } from './native-flows.js'

const timezone = () => process.env.APPOINTMENT_TIMEZONE || 'Asia/Kolkata'
const slotTitle = (date: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: timezone(), day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date)
export async function availableFlowSlots(notice?: string) {
  const slots = await prisma.appointmentSlot.findMany({ where: { startsAt: { gt: new Date() }, appointment: null }, orderBy: { startsAt: 'asc' }, take: 100 })
  return { screen: 'APPOINTMENT', data: { slots: slots.map(slot => ({ id: slot.id, title: slotTitle(slot.startsAt) })), available: !!slots.length, notice: notice || (slots.length ? `Choose an available time. Times are in ${timezone()}.` : 'No appointments are available right now. Please contact us in the chat.') } }
}
export function validateBookingDetails(data: any) {
  const name = typeof data?.name === 'string' ? data.name.trim() : ''
  const ageText = String(data?.age ?? ''), idLast4 = String(data?.idLast4 ?? '')
  if (!name || name.length > 100 || !/^\d{1,3}$/.test(ageText) || Number(ageText) > 120 || !/^\d{4}$/.test(idLast4) || typeof data?.slotId !== 'string' || data.slotId.length > 100) throw new FlowError('Enter a name, an age from 0 to 120, four ID digits and an available appointment.')
  return { name, age: Number(ageText), idLast4, slotId: data.slotId }
}
const success = (token: string, result: any) => ({ screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: token, ...result } } } })

export async function handleBookingExchange(request: any) {
  if (request?.action === 'ping') return { data: { status: 'active' } }
  const token = request?.flow_token
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new FlowError('This booking link is no longer available. Ask us for a new one.', 427)
  const session = await prisma.whatsAppFlowSession.findUnique({ where: { tokenHash: flowTokenHash(token) }, include: { flow: true } })
  if (!session || session.expiresAt.getTime() <= Date.now() || session.flow.endpointMode !== 'APPOINTMENT' || !['DRAFT', 'PUBLISHED'].includes(session.flow.status)) throw new FlowError('This booking link has expired. Ask us for a new one.', 427)
  if (request.data?.error) return { data: { acknowledged: true } }
  if (session.result) return success(token, session.result)
  if (request.action === 'INIT' || request.action === 'BACK') return availableFlowSlots()
  if (request.action !== 'data_exchange') throw new FlowError('Unsupported Flow action')
  if (request.screen === 'APPOINTMENT') {
    let details: ReturnType<typeof validateBookingDetails>
    try { details = validateBookingDetails(request.data) } catch (error) { return availableFlowSlots((error as Error).message) }
    const slot = await prisma.appointmentSlot.findFirst({ where: { id: details.slotId, startsAt: { gt: new Date() }, appointment: null } })
    if (!slot) return availableFlowSlots('That appointment is no longer available. Please choose another time.')
    const selection = randomBytes(16).toString('hex')
    const updated = await prisma.whatsAppFlowSession.updateMany({ where: { id: session.id, result: { equals: Prisma.DbNull } }, data: { selection: { ...details, key: selection } } })
    if (!updated.count) {
      const completed = await prisma.whatsAppFlowSession.findUniqueOrThrow({ where: { id: session.id } })
      return success(token, completed.result)
    }
    return { screen: 'REVIEW', data: { selection, summary: `${details.name}\nAge: ${details.age}\n${slotTitle(slot.startsAt)} (${timezone()})\n\nConfirm to reserve this appointment.` } }
  }
  if (request.screen !== 'REVIEW') throw new FlowError('Unknown booking screen')
  try {
    const result = await prisma.$transaction(async tx => {
      // Serialize confirmations for the same token across processes; a slot also has a UNIQUE constraint.
      await tx.$queryRaw`SELECT "id" FROM "WhatsAppFlowSession" WHERE "id" = ${session.id} FOR UPDATE`
      const current = await tx.whatsAppFlowSession.findUniqueOrThrow({ where: { id: session.id } })
      if (current.result) return current.result
      if (current.expiresAt.getTime() <= Date.now()) throw new FlowError('This booking link has expired.', 427)
      const selection = current.selection as any
      if (!selection || typeof request.data?.selection !== 'string' || request.data.selection !== selection.key) throw new FlowError('Your selection changed. Please choose the appointment again.', 409)
      const slot = await tx.appointmentSlot.findFirst({ where: { id: selection.slotId, startsAt: { gt: new Date() }, appointment: null } })
      if (!slot) throw new FlowError('That appointment was just booked. Please choose another time.', 409)
      const patient = await tx.patient.upsert({ where: { contactId: current.contactId }, update: { name: selection.name, age: selection.age, idLast4: selection.idLast4 }, create: { contactId: current.contactId, name: selection.name, age: selection.age, idLast4: selection.idLast4 } })
      const appointment = await tx.appointment.create({ data: { reference: `APT-${randomBytes(8).toString('hex').toUpperCase()}`, slotId: slot.id, patientId: patient.id, contactId: current.contactId } })
      const result = { appointment_reference: appointment.reference, appointment_time: slot.startsAt.toISOString() }
      await tx.whatsAppFlowSession.update({ where: { id: current.id }, data: { result, selection: Prisma.DbNull } })
      return result
    }, { timeout: 10000 })
    return success(token, result)
  } catch (error) {
    if ((error instanceof FlowError && error.status === 409) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) return { screen: 'REVIEW', data: { selection: '', summary: 'That selection is no longer available. Tap the back arrow to see current appointment times and choose again.' } }
    throw error
  }
}

export async function flowCompletionBody(incoming: any, contactId: string) {
  const raw = incoming.interactive?.nfm_reply?.response_json
  if (typeof raw !== 'string' || raw.length > 100_000) return 'Flow response received'
  let response: any
  try { response = JSON.parse(raw) } catch { return 'Flow response received (invalid response data)' }
  if (typeof response?.flow_token !== 'string') return 'Flow response received'
  const session = await prisma.whatsAppFlowSession.findUnique({ where: { tokenHash: flowTokenHash(response.flow_token) }, include: { flow: true } })
  if (!session || session.contactId !== contactId) return 'Flow response received (unrecognized session)'
  if (session.flow.endpointMode === 'APPOINTMENT' && !session.result) return 'Booking form closed without a confirmed appointment'
  if (!session.completedAt) {
    const { flow_token: _token, ...answers } = response
    await prisma.whatsAppFlowSession.updateMany({ where: { id: session.id, completedAt: null }, data: { completedAt: new Date(), ...(!session.result ? { result: { answers } } : {}) } })
  }
  if (session.result && typeof (session.result as any).appointment_reference === 'string') return `Appointment booked: ${(session.result as any).appointment_reference}\n${(session.result as any).appointment_time}`
  // An untrusted completion payload never creates an appointment. The encrypted confirmation does.
  const answers = (session.result as any)?.answers ?? Object.fromEntries(Object.entries(response).filter(([key]) => key !== 'flow_token'))
  return `Flow completed\n${Object.entries(answers).slice(0, 30).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n').slice(0, 5000)}`
}
