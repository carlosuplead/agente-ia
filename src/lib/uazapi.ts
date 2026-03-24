// Minimalist Uazapi (Wazapi) integration

export interface UazapiConnectResult {
    qrcode: string
    pairingCode: string
}

const UAZAPI_URL = process.env.UAZAPI_URL || 'https://api.uazapi.com'
const UAZAPI_TOKEN = process.env.UAZAPI_GLOBAL_TOKEN

export async function connect(instanceToken: string): Promise<UazapiConnectResult> {
    const res = await fetch(`${UAZAPI_URL}/instance/connect/${instanceToken}`, {
        method: 'GET',
        headers: {
            'apikey': UAZAPI_TOKEN || '',
        }
    })
    
    if (!res.ok) {
        throw new Error(`Failed to connect instance: ${res.statusText}`)
    }
    
    return res.json()
}

export async function sendTextMessage(instanceToken: string, phone: string, text: string) {
    const res = await fetch(`${UAZAPI_URL}/message/sendText/${instanceToken}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': UAZAPI_TOKEN || '',
        },
        body: JSON.stringify({
            number: phone,
            options: { delay: 1200, presence: 'composing' },
            textMessage: { text }
        })
    })

    if (!res.ok) {
        throw new Error(`Failed to send message: ${res.statusText}`)
    }

    return res.json()
}
