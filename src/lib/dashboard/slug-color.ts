export function slugColor(slug: string): string {
    const palette = ['#007AFF', '#5856d6', '#34c759', '#ff9500', '#af52de', '#ff2d55']
    let h = 0
    for (let i = 0; i < slug.length; i++) h = (h + slug.charCodeAt(i) * (i + 1)) % palette.length
    return palette[h]
}
