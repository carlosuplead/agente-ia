import crypto from 'crypto'

/** Valores na BD que começam com este prefixo foram guardados com AES-256-GCM. */
const CIPHERTEXT_PREFIX = 'ac:v1:'

function deriveKey(): Buffer | null {
    const raw = process.env.WORKSPACE_LLM_KEYS_SECRET?.trim()
    if (!raw) return null
    return crypto.createHash('sha256').update(raw, 'utf8').digest()
}

/**
 * Se `WORKSPACE_LLM_KEYS_SECRET` estiver definido, encripta a chave antes de persistir em `ai_agent_config`.
 * Sem a variável, mantém texto em claro (compatível com instalações existentes).
 */
export function encryptWorkspaceLlmKeyIfConfigured(plain: string): string {
    const key = deriveKey()
    if (!key || !plain) return plain
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    const packed = Buffer.concat([iv, tag, ciphertext])
    return CIPHERTEXT_PREFIX + packed.toString('base64url')
}

/**
 * Desencripta valores `ac:v1:` quando o segredo do servidor está configurado; caso contrário devolve o valor tal como está (legado em claro).
 */
export function decryptWorkspaceLlmKeyIfNeeded(stored: string): string {
    const s = typeof stored === 'string' ? stored.trim() : ''
    if (!s.startsWith(CIPHERTEXT_PREFIX)) return s
    const key = deriveKey()
    if (!key) {
        console.error('WORKSPACE_LLM_KEYS_SECRET missing but encrypted LLM key present in database')
        return ''
    }
    try {
        const packed = Buffer.from(s.slice(CIPHERTEXT_PREFIX.length), 'base64url')
        const iv = packed.subarray(0, 12)
        const tag = packed.subarray(12, 28)
        const ciphertext = packed.subarray(28)
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    } catch (e) {
        console.error('decryptWorkspaceLlmKeyIfNeeded failed', e)
        return ''
    }
}
