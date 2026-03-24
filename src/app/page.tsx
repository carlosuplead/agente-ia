'use client'

import { useState } from 'react'

const DEMO_WORKSPACES = [
  { id: '1', name: 'Moreli', slug: 'moreli', status: 'connected', contacts: 142, messages: 1830, color: '#007AFF' },
  { id: '2', name: 'Diel', slug: 'diel', status: 'disconnected', contacts: 87, messages: 540, color: '#5856d6' },
  { id: '3', name: 'Silva & Cia', slug: 'silva_cia', status: 'connected', contacts: 63, messages: 920, color: '#34c759' },
]

const DEMO_MESSAGES = [
  { name: 'Carlos Mendes', text: 'Olá, gostaria de saber sobre os valores...', time: '2min' },
  { name: 'Ana Paula', text: 'Obrigada pela informação! Vou pensar e retorno.', time: '8min' },
  { name: 'Roberto Lima', text: 'Preciso de atendimento urgente, podem me ajudar?', time: '15min' },
  { name: 'Maria Clara', text: 'Qual o horário de funcionamento?', time: '22min' },
]

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<'workspaces' | 'connection' | 'config'>('workspaces')
  const [selectedWorkspace, setSelectedWorkspace] = useState('Moreli')

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">⚡</div>
          <h1>AI Agent</h1>
        </div>

        {/* Workspace Selector */}
        <div className="workspace-selector">
          <div className="workspace-selector-label">Workspace Ativo</div>
          <div className="workspace-selector-value">{selectedWorkspace}</div>
        </div>

        <div className="nav-section-label">Menu</div>
        <div className={`nav-item ${activeTab === 'workspaces' ? 'active' : ''}`} onClick={() => setActiveTab('workspaces')}>
          <span className="nav-item-icon">🏢</span>
          Workspaces
        </div>
        <div className={`nav-item ${activeTab === 'connection' ? 'active' : ''}`} onClick={() => setActiveTab('connection')}>
          <span className="nav-item-icon">📱</span>
          WhatsApp
        </div>
        <div className={`nav-item ${activeTab === 'config' ? 'active' : ''}`} onClick={() => setActiveTab('config')}>
          <span className="nav-item-icon">🤖</span>
          Agente IA
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        {activeTab === 'workspaces' && (
          <>
            <div className="page-header">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2>Workspaces</h2>
                  <p>Gerencie seus clientes e suas instâncias de WhatsApp</p>
                </div>
                <button className="btn btn-primary">+ Novo Cliente</button>
              </div>
            </div>

            <div className="workspace-grid">
              {DEMO_WORKSPACES.map(ws => (
                <div key={ws.id} className="workspace-card" onClick={() => { setSelectedWorkspace(ws.name); setActiveTab('connection') }}>
                  <div className="workspace-card-header">
                    <div className="workspace-avatar" style={{ background: `linear-gradient(135deg, ${ws.color}, ${ws.color}dd)` }}>
                      {ws.name[0]}
                    </div>
                    <div>
                      <div className="workspace-card-name">{ws.name}</div>
                      <div className="workspace-card-slug">{ws.slug}</div>
                    </div>
                    <div style={{ marginLeft: 'auto' }}>
                      <span className={`status-badge ${ws.status}`}>
                        <span className="status-dot"></span>
                        {ws.status === 'connected' ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  </div>
                  <div className="workspace-card-stats">
                    <div className="stat">
                      <span className="stat-value">{ws.contacts}</span>
                      <span className="stat-label">Contatos</span>
                    </div>
                    <div className="stat">
                      <span className="stat-value">{ws.messages.toLocaleString()}</span>
                      <span className="stat-label">Mensagens</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {activeTab === 'connection' && (
          <>
            <div className="page-header">
              <h2>WhatsApp — {selectedWorkspace}</h2>
              <p>Gerencie a conexão do WhatsApp para este workspace</p>
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Status da Conexão</span>
                <span className="status-badge connected">
                  <span className="status-dot"></span>
                  Conectado
                </span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
                📞 +55 11 99999-0000 • Última conexão: Hoje, 08:30
              </p>
              <button className="btn btn-secondary">Gerar Novo QR Code</button>
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Mensagens Recentes</span>
              </div>
              <div className="message-list">
                {DEMO_MESSAGES.map((msg, i) => (
                  <div key={i} className="message-item">
                    <div className="message-avatar">{msg.name[0]}</div>
                    <div className="message-content">
                      <div className="message-name">{msg.name}</div>
                      <div className="message-text">{msg.text}</div>
                    </div>
                    <span className="message-time">{msg.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'config' && (
          <>
            <div className="page-header">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2>Agente IA — {selectedWorkspace}</h2>
                  <p>Configure o comportamento do seu agente de atendimento</p>
                </div>
                <button className="btn btn-primary">💾 Salvar</button>
              </div>
            </div>

            <div className="card">
              <div className="card-title" style={{ marginBottom: 20 }}>Configurações do Modelo</div>
              <div className="two-cols">
                <div className="input-group">
                  <label className="input-label">Provedor</label>
                  <select className="input select" defaultValue="gemini">
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI</option>
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Modelo</label>
                  <select className="input select" defaultValue="gemini-2.5-flash">
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                  </select>
                </div>
              </div>
              <div className="two-cols">
                <div className="input-group">
                  <label className="input-label">Temperatura</label>
                  <div className="slider-container">
                    <input type="range" className="slider" min="0" max="1" step="0.1" defaultValue="0.7" />
                    <span className="slider-value">0.7</span>
                  </div>
                </div>
                <div className="input-group">
                  <label className="input-label">Limite de Mensagens / Conversa</label>
                  <input type="number" className="input" defaultValue={50} />
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-title" style={{ marginBottom: 20 }}>Prompt do Sistema</div>
              <div className="input-group">
                <textarea
                  className="input textarea"
                  defaultValue={`Você é a assistente virtual da ${selectedWorkspace}.\n\nSeja cordial, objetiva e profissional. Responda dúvidas sobre serviços, preços e horários.\n\nRegras:\n- Não invente informações que não estão no contexto\n- Se não souber a resposta, diga que vai verificar com a equipe\n- Use linguagem simples e amigável`}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
