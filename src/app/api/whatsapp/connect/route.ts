import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getProviderForWorkspace } from '@/lib/whatsapp/factory'
import { isInstanceTokenConfusedWithAdminToken } from '@/lib/uazapi'

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const body = await request.json()
        const { workspace_slug } = body

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('id, instance_token, status, provider')
            .eq('workspace_slug', workspace_slug)
            .maybeSingle()

        if (!instance) {
            return NextResponse.json({ error: 'No instance configured' }, { status: 404 })
        }

        if (instance.status === 'connected') {
            return NextResponse.json({ status: 'connected', message: 'Already connected' })
        }

        const { provider } = await getProviderForWorkspace(supabase, workspace_slug)
        const instanceToken =
            typeof instance.instance_token === 'string' ? instance.instance_token.trim() : ''

        if (provider.type === 'uazapi' && !instanceToken) {
            return NextResponse.json(
                {
                    error:
                        'Token da instância Uazapi em falta. Remove a ligação Uazapi no separador WhatsApp e cria uma instância nova.',
                    code: 'MISSING_INSTANCE_TOKEN'
                },
                { status: 400 }
            )
        }

        if (provider.type === 'uazapi' && /^INSTANCE_TOKEN$/i.test(instanceToken)) {
            return NextResponse.json(
                {
                    error:
                        'O token guardado é o texto de exemplo do webhook (INSTANCE_TOKEN), não o token real da instância no painel Uazapi.',
                    code: 'PLACEHOLDER_INSTANCE_TOKEN',
                    hint:
                        'Remove a ligação Uazapi, cria uma instância nova (grava o token devolvido pela API) ou corrige o valor em Supabase → whatsapp_instances.instance_token.'
                },
                { status: 400 }
            )
        }

        if (provider.type === 'uazapi' && isInstanceTokenConfusedWithAdminToken(instanceToken)) {
            return NextResponse.json(
                {
                    error:
                        'O token guardado coincide com UAZAPI_ADMIN_TOKEN / UAZAPI_GLOBAL_TOKEN. Isso é o admintoken do painel, não o token da instância.',
                    code: 'ADMIN_TOKEN_AS_INSTANCE',
                    hint:
                        'No OpenAPI, /instance/connect usa header `token` com o token devolvido por POST /instance/init (criar instância). O «Admin Token» do painel só serve para /instance/init. Remove a ligação Uazapi e cria instância pelo dashboard (grava o token da instância na BD).'
                },
                { status: 400 }
            )
        }

        try {
            const connectResult = await provider.connect(
                provider.type === 'uazapi' ? instanceToken : (instance.instance_token ?? '')
            )
            
            await supabase
                .from('whatsapp_instances')
                .update({ status: connectResult.status === 'connected' ? 'connected' : 'connecting' })
                .eq('id', instance.id)

            return NextResponse.json({
                status: 'connecting',
                qrcode: connectResult.qrcode,
                pairingCode: connectResult.pairingCode
            })
        } catch (error) {
            console.error('UAZAPI connect error:', error)
            const MAX = 500
            const raw = error instanceof Error ? error.message : String(error)
            const errorMsg = raw.length > MAX ? `${raw.slice(0, MAX)}…` : raw

            const upstream = raw.match(/Uazapi connect: (\d{3})\b/)
            const code = upstream ? parseInt(upstream[1], 10) : NaN

            if (code === 401) {
                return NextResponse.json(
                    {
                        error: errorMsg,
                        code: 'UAZAPI_UNAUTHORIZED',
                        hint:
                            'UAZAPI_URL tem de ser o «Server URL» exacto do teu painel (ex.: https://metricsia.uazapi.com), não outro host. Reinicia o npm run dev após alterar. O token na BD tem de ser o da INSTÂNCIA (resposta de /instance/init), não o Admin Token. Se mudaste de servidor ou o token é antigo: «Remover ligação Uazapi» e cria outra instância.'
                    },
                    { status: 401 }
                )
            }
            if (code === 404) {
                return NextResponse.json(
                    { error: errorMsg, code: 'UAZAPI_INSTANCE_NOT_FOUND' },
                    { status: 404 }
                )
            }
            if (code === 429) {
                return NextResponse.json({ error: errorMsg, code: 'UAZAPI_RATE_LIMIT' }, { status: 429 })
            }

            return NextResponse.json({ error: errorMsg }, { status: 502 })
        }
    } catch (error) {
        console.error('Connect error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
