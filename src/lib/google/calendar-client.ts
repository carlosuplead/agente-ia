import { google } from 'googleapis'
import { DateTime } from 'luxon'
import {
    getGoogleCalendarClientId,
    getGoogleCalendarClientSecret,
    getGoogleCalendarOAuthRedirectUri
} from '@/lib/google/calendar-oauth-config'

export function createCalendarOAuth2(refreshToken: string) {
    const oauth2 = new google.auth.OAuth2(
        getGoogleCalendarClientId(),
        getGoogleCalendarClientSecret(),
        getGoogleCalendarOAuthRedirectUri()
    )
    oauth2.setCredentials({ refresh_token: refreshToken })
    return oauth2
}

function parseHm(s: string): { h: number; m: number } | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
    if (!m) return null
    const h = Number(m[1])
    const min = Number(m[2])
    if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null
    return { h, m: min }
}

function slotOverlapsBusy(
    slotStart: DateTime,
    slotEnd: DateTime,
    busy: { start?: string | null; end?: string | null }[]
): boolean {
    for (const b of busy) {
        if (!b.start || !b.end) continue
        const bs = DateTime.fromISO(b.start, { setZone: true })
        const be = DateTime.fromISO(b.end, { setZone: true })
        if (slotStart < be && bs < slotEnd) return true
    }
    return false
}

export type SuggestSlotsParams = {
    rangeStartDate: string
    rangeEndDate: string
    timezone: string
    slotDurationMinutes: number
    maxSuggestions: number
    workdayStart: string
    workdayEnd: string
}

export async function calendarFreeBusy(
    refreshToken: string,
    calendarId: string,
    timeMinIso: string,
    timeMaxIso: string
): Promise<{ start?: string | null; end?: string | null }[]> {
    const auth = createCalendarOAuth2(refreshToken)
    const cal = google.calendar({ version: 'v3', auth })
    const res = await cal.freebusy.query({
        requestBody: {
            timeMin: timeMinIso,
            timeMax: timeMaxIso,
            items: [{ id: calendarId }]
        }
    })
    const key = calendarId
    const calBusy = res.data.calendars?.[key]?.busy
    return Array.isArray(calBusy) ? calBusy : []
}

export async function suggestAvailableSlots(
    refreshToken: string,
    calendarId: string,
    p: SuggestSlotsParams
): Promise<string> {
    const zone = p.timezone.trim() || 'UTC'
    const dayStart = DateTime.fromISO(p.rangeStartDate, { zone })
    const dayEnd = DateTime.fromISO(p.rangeEndDate, { zone })
    if (!dayStart.isValid || !dayEnd.isValid) {
        return 'Erro: range_start_date e range_end_date devem ser YYYY-MM-DD válidos.'
    }
    if (dayEnd < dayStart) return 'Erro: data final anterior à inicial.'

    const ws = parseHm(p.workdayStart)
    const we = parseHm(p.workdayEnd)
    if (!ws || !we) return 'Erro: horário útil inválido (use HH:mm, ex. 09:00 e 18:00).'

    const dur = Math.max(5, Math.min(480, Math.floor(p.slotDurationMinutes)))
    const maxN = Math.max(1, Math.min(20, Math.floor(p.maxSuggestions)))

    const rangeMin = dayStart.startOf('day').toUTC()
    const rangeMax = dayEnd.endOf('day').toUTC()
    const busy = await calendarFreeBusy(
        refreshToken,
        calendarId,
        rangeMin.toISO()!,
        rangeMax.toISO()!
    )

    const suggestions: string[] = []
    for (
        let d = dayStart.startOf('day');
        d <= dayEnd.endOf('day') && suggestions.length < maxN;
        d = d.plus({ days: 1 })
    ) {
        let cursor = d.set({ hour: ws.h, minute: ws.m, second: 0, millisecond: 0 })
        const endWork = d.set({ hour: we.h, minute: we.m, second: 0, millisecond: 0 })
        while (cursor.plus({ minutes: dur }) <= endWork && suggestions.length < maxN) {
            const slotEnd = cursor.plus({ minutes: dur })
            if (!slotOverlapsBusy(cursor, slotEnd, busy)) {
                suggestions.push(
                    `${cursor.setZone(zone).toFormat("cccc dd/MM/yyyy HH:mm")} – ${slotEnd.setZone(zone).toFormat('HH:mm')} (${zone}) | ISO início: ${cursor.toISO()}`
                )
            }
            cursor = cursor.plus({ minutes: dur })
        }
    }

    if (suggestions.length === 0) {
        return 'Não há intervalos livres no período e horário útil indicados. Pede outro intervalo ou horário.'
    }
    return `Sugestões de horário (livres na agenda):\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
}

export type CreateEventParams = {
    title: string
    startDatetime: string
    endDatetime: string
    timezone: string
    description?: string
}

export async function createCalendarEvent(
    refreshToken: string,
    calendarId: string,
    p: CreateEventParams
): Promise<string> {
    const zone = p.timezone.trim() || 'UTC'
    let start = DateTime.fromISO(p.startDatetime.trim(), { setZone: true })
    let end = DateTime.fromISO(p.endDatetime.trim(), { setZone: true })
    if (!start.isValid) {
        start = DateTime.fromISO(p.startDatetime.trim(), { zone })
    }
    if (!end.isValid) {
        end = DateTime.fromISO(p.endDatetime.trim(), { zone })
    }
    if (!start.isValid || !end.isValid) {
        return 'Erro: start_datetime e end_datetime devem ser ISO 8601 válidos.'
    }
    if (end <= start) return 'Erro: o fim do evento deve ser depois do início.'

    const auth = createCalendarOAuth2(refreshToken)
    const cal = google.calendar({ version: 'v3', auth })
    const res = await cal.events.insert({
        calendarId,
        requestBody: {
            summary: p.title.trim().slice(0, 500),
            description: p.description?.trim() || undefined,
            start: {
                dateTime: start.setZone(zone).toFormat("yyyy-LL-dd'T'HH:mm:ss"),
                timeZone: zone
            },
            end: {
                dateTime: end.setZone(zone).toFormat("yyyy-LL-dd'T'HH:mm:ss"),
                timeZone: zone
            }
        }
    })
    const id = res.data.id || ''
    const htmlLink = res.data.htmlLink || ''
    return `Evento criado na Google Agenda (id: ${id}). Link: ${htmlLink || 'n/d'}`
}

export async function fetchGoogleAccountEmail(accessToken: string): Promise<string | null> {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return null
    const j = (await res.json()) as { email?: string }
    return typeof j.email === 'string' ? j.email : null
}
