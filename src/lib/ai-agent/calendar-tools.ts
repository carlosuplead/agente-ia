import { SchemaType } from '@google/generative-ai'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import type { AiAgentConfig, BuiltContext } from '@/lib/ai-agent/types'
import { createCalendarEvent, suggestAvailableSlots } from '@/lib/google/calendar-client'
import { sendSellerNotification } from '@/lib/ai-agent/external-notification'

export const CALENDAR_SUGGEST_SLOTS_TOOL = 'google_calendar_suggest_slots'
export const CALENDAR_CREATE_EVENT_TOOL = 'google_calendar_create_event'

export const calendarToolsPromptBlock = `Ferramentas Google Agenda (só disponíveis com conta ligada no dashboard):
- "${CALENDAR_SUGGEST_SLOTS_TOOL}": obtém intervalos livres entre datas e sugere horários para o cliente escolher. Usa timezone IANA (ex. Europe/Lisbon, America/Sao_Paulo).
- "${CALENDAR_CREATE_EVENT_TOOL}": cria o compromisso depois de o cliente confirmar um horário. Inclui sempre o nome e telefone do contacto na descrição do evento.`

export const calendarSuggestSlotsDescription = `Lista horários livres na Google Agenda do negócio para recomendar ao cliente. Parâmetros: range_start_date e range_end_date (YYYY-MM-DD), timezone (IANA), slot_duration_minutos (ex. 30), max_sugestões (1–20), horário_início e horário_fim do expediente (HH:mm, ex. 09:00 e 18:00).`

export const calendarCreateEventDescription = `Cria um evento na Google Agenda após confirmação explícita do horário pelo cliente. Parâmetros: titulo, inicio_iso e fim_iso (ISO 8601 com timezone ou local claro), timezone (IANA se as datas forem ambíguas), descricao_opcional (texto extra; o sistema acrescenta dados do contacto), email_cliente (opcional — email do lead capturado no chat; será adicionado como convidado e o Google envia convite por email automaticamente; emails fixos da equipa são adicionados pelo backend).`

export type GoogleCalendarMeta = {
    refreshToken: string
    calendarId: string
    defaultTimezone: string
}

export async function executeCalendarToolCall(
    name: string,
    args: Record<string, unknown>,
    calendar: GoogleCalendarMeta,
    context: BuiltContext,
    config?: AiAgentConfig
): Promise<string> {
    if (name === CALENDAR_SUGGEST_SLOTS_TOOL) {
        const rangeStart = String(args.range_start_date || args.rangeStartDate || '').trim()
        const rangeEnd = String(args.range_end_date || args.rangeEndDate || '').trim()
        const tz = String(args.timezone || calendar.defaultTimezone).trim() || calendar.defaultTimezone
        const slotMin = Number(args.slot_duration_minutos ?? args.slot_duration_minutes ?? 30)
        const maxSug = Number(args.max_sugestões ?? args.max_suggestions ?? 5)
        const wdStart = String(args.horário_início ?? args.horario_inicio ?? args.workday_start ?? '09:00')
        const wdEnd = String(args.horário_fim ?? args.horario_fim ?? args.workday_end ?? '18:00')
        return suggestAvailableSlots(calendar.refreshToken, calendar.calendarId, {
            rangeStartDate: rangeStart,
            rangeEndDate: rangeEnd || rangeStart,
            timezone: tz,
            slotDurationMinutes: Number.isFinite(slotMin) ? slotMin : 30,
            maxSuggestions: Number.isFinite(maxSug) ? maxSug : 5,
            workdayStart: wdStart,
            workdayEnd: wdEnd
        })
    }
    if (name === CALENDAR_CREATE_EVENT_TOOL) {
        const title = String((args.titulo ?? args.title) || '').trim()
        const start = String((args.inicio_iso ?? args.start_datetime ?? args.startDatetime) || '').trim()
        const end = String((args.fim_iso ?? args.end_datetime ?? args.endDatetime) || '').trim()
        const tz = String(args.timezone || calendar.defaultTimezone).trim() || calendar.defaultTimezone
        const extra = String((args.descricao_opcional ?? args.description) || '').trim()
        const contactLine = `Contacto WhatsApp: ${context.contactName} (${context.contactPhone})`
        const description = [extra, contactLine].filter(Boolean).join('\n\n')
        if (!title) return 'Erro: titulo é obrigatório.'

        // Junta email do cliente (vindo da IA) + lista fixa do workspace (config).
        const attendees: string[] = []
        const clientEmailRaw =
            (args.email_cliente ?? args.attendee_email ?? args.client_email ?? args.email) || ''
        const clientEmail = typeof clientEmailRaw === 'string' ? clientEmailRaw.trim() : ''
        if (clientEmail) attendees.push(clientEmail)
        const defaultsRaw = config?.google_calendar_default_attendees || ''
        if (defaultsRaw && typeof defaultsRaw === 'string') {
            for (const e of defaultsRaw.split(/[\n,;]+/)) {
                const email = e.trim()
                if (email) attendees.push(email)
            }
        }

        const result = await createCalendarEvent(calendar.refreshToken, calendar.calendarId, {
            title,
            startDatetime: start,
            endDatetime: end,
            timezone: tz,
            description,
            attendees
        })

        // Fire-and-forget: notifica o vendedor via UAZAPI dedicada quando o
        // evento foi de facto criado (sucesso — mensagem começa por "Evento criado").
        const createdOk = typeof result === 'string' && result.startsWith('Evento criado')
        if (createdOk && config) {
            const appointmentAt = formatAppointmentHuman(start, tz) || `${start} (${tz})`
            const summary = extra || title
            void sendSellerNotification({
                config,
                context,
                event: 'appointment_created',
                payload: {
                    stageLabel: 'Agendamento confirmado',
                    appointmentAt,
                    eventTitle: title,
                    summary,
                    eventLink: extractEventLink(result)
                }
            }).catch(e => {
                console.error('[calendar-tools] sendSellerNotification failed', e)
            })
        }

        return result
    }
    return 'Função de calendário desconhecida.'
}

function formatAppointmentHuman(iso: string, timezone: string): string | null {
    try {
        if (!iso) return null
        // Aceita ISO com timezone próprio ou datetime "local" + tz explícito.
        const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)
        const d = hasTz ? new Date(iso) : new Date(`${iso}${iso.includes('T') ? '' : 'T00:00:00'}`)
        if (Number.isNaN(d.getTime())) return null
        const fmt = new Intl.DateTimeFormat('pt-BR', {
            timeZone: timezone || 'UTC',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
        return `${fmt.format(d)} (${timezone})`
    } catch {
        return null
    }
}

function extractEventLink(result: string): string | undefined {
    const m = /Link:\s*(\S+)/.exec(result)
    if (!m) return undefined
    const v = m[1].trim()
    return v && v !== 'n/d' ? v : undefined
}

export function calendarGeminiFunctionDeclarations(): Array<Record<string, unknown>> {
    return [
        {
            name: CALENDAR_SUGGEST_SLOTS_TOOL,
            description: calendarSuggestSlotsDescription,
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    range_start_date: {
                        type: SchemaType.STRING,
                        description: 'Primeiro dia (YYYY-MM-DD)'
                    },
                    range_end_date: {
                        type: SchemaType.STRING,
                        description: 'Último dia (YYYY-MM-DD), inclusive'
                    },
                    timezone: {
                        type: SchemaType.STRING,
                        description: 'Fuso IANA, ex. Europe/Lisbon'
                    },
                    slot_duration_minutes: {
                        type: SchemaType.NUMBER,
                        description: 'Duração de cada slot em minutos (ex. 30)'
                    },
                    max_suggestions: { type: SchemaType.NUMBER, description: 'Máximo de sugestões (1–20)' },
                    workday_start: { type: SchemaType.STRING, description: 'Início do expediente HH:mm' },
                    workday_end: { type: SchemaType.STRING, description: 'Fim do expediente HH:mm' }
                },
                required: ['range_start_date', 'range_end_date', 'timezone']
            }
        },
        {
            name: CALENDAR_CREATE_EVENT_TOOL,
            description: calendarCreateEventDescription,
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    title: { type: SchemaType.STRING, description: 'Título do evento' },
                    start_datetime: { type: SchemaType.STRING, description: 'Início ISO 8601' },
                    end_datetime: { type: SchemaType.STRING, description: 'Fim ISO 8601' },
                    timezone: { type: SchemaType.STRING, description: 'Fuso IANA' },
                    description: { type: SchemaType.STRING, description: 'Notas opcionais (o contacto é anexado automaticamente)' },
                    email_cliente: { type: SchemaType.STRING, description: 'Email do cliente capturado na conversa (opcional). Será adicionado como convidado e o Google envia convite automaticamente.' }
                },
                required: ['title', 'start_datetime', 'end_datetime', 'timezone']
            }
        }
    ]
}

export function calendarOpenAiTools(): ChatCompletionTool[] {
    return [
        {
            type: 'function',
            function: {
                name: CALENDAR_SUGGEST_SLOTS_TOOL,
                description: calendarSuggestSlotsDescription,
                parameters: {
                    type: 'object',
                    properties: {
                        range_start_date: { type: 'string' },
                        range_end_date: { type: 'string' },
                        timezone: { type: 'string' },
                        slot_duration_minutes: { type: 'number' },
                        max_suggestions: { type: 'number' },
                        workday_start: { type: 'string' },
                        workday_end: { type: 'string' }
                    },
                    required: ['range_start_date', 'range_end_date', 'timezone']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: CALENDAR_CREATE_EVENT_TOOL,
                description: calendarCreateEventDescription,
                parameters: {
                    type: 'object',
                    properties: {
                        title: { type: 'string' },
                        start_datetime: { type: 'string' },
                        end_datetime: { type: 'string' },
                        timezone: { type: 'string' },
                        description: { type: 'string' },
                        email_cliente: { type: 'string', description: 'Email do cliente capturado na conversa (opcional). Será adicionado como convidado.' }
                    },
                    required: ['title', 'start_datetime', 'end_datetime', 'timezone']
                }
            }
        }
    ]
}
