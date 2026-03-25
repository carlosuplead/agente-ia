export function formatRelativeTime(iso: string, nowMs = Date.now()): string {
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return ''
    const sec = Math.round((nowMs - t) / 1000)
    if (sec < 45) return 'agora'
    if (sec < 3600) return `há ${Math.max(1, Math.floor(sec / 60))} min`
    if (sec < 86400) return `há ${Math.floor(sec / 3600)} h`
    if (sec < 86400 * 7) return `há ${Math.floor(sec / 86400)} d`
    return new Date(iso).toLocaleString()
}
