import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { MessageSquare, Send, Cpu, Sparkles, AlertCircle } from 'lucide-react';

export default function Chat() {
    const { user } = useOutletContext();
    const [status, setStatus] = useState(null);
    const [messages, setMessages] = useState([
        { role: 'assistant', content: 'Olá! Sou seu Especialista Blogger com IA. Como posso ajudar a otimizar ou estruturar seu template XML hoje?' }
    ]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        fetch('/api/chat/status')
            .then(res => res.json())
            .then(setStatus)
            .catch(() => {});
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim() || sending) return;

        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setSending(true);

        // Simulando resposta do assistente IA
        setTimeout(() => {
            setMessages(prev => [
                ...prev,
                { role: 'assistant', content: `Compreendi sua solicitação sobre "${userMsg}". Como especialista Blogger, recomendo estruturar os widgets com IDs únicos e otimizar as meta tags para Core Web Vitals.` }
            ]);
            setSending(false);
        }, 1000);
    };

    return (
        <div className="p-3 p-md-5 d-flex flex-column" style={{ height: 'calc(100vh - 64px)' }}>
            <div className="d-flex align-items-center justify-content-between mb-4 flex-shrink-0">
                <div>
                    <h1 className="fw-bolder text-uppercase mb-1" style={{ fontSize: '1.4rem', letterSpacing: '-0.03em', fontWeight: 900 }}>
                        Especialista Blogger IA
                    </h1>
                    <p className="small mb-0" style={{ color: 'var(--sl-text-500)' }}>Consultoria especializada em templates XML para o Google Blogger.</p>
                </div>
                {status && (
                    <div className="d-flex align-items-center gap-3">
                        <span className="badge rounded-pill font-monospace" style={{ background: 'rgba(14,165,233,.15)', color: 'var(--sl-primary)' }}>
                            Créditos Gemini: {status.creditosGemini} / {status.creditosGeminiTotal}
                        </span>
                    </div>
                )}
            </div>

            {/* Chat Box */}
            <div className="sl-card flex-grow-1 mb-3 d-flex flex-column overflow-hidden p-0">
                <div className="flex-grow-1 p-4 overflow-auto d-flex flex-column gap-3">
                    {messages.map((m, idx) => (
                        <div key={idx} className={`d-flex ${m.role === 'user' ? 'justify-content-end' : 'justify-content-start'}`}>
                            <div className={`p-3 rounded-3 max-w-75 ${m.role === 'user' ? 'bg-primary text-white' : 'bg-dark border border-secondary text-light'}`} style={{ maxWidth: '80%' }}>
                                <p className="mb-0 small" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{m.content}</p>
                            </div>
                        </div>
                    ))}
                    {sending && (
                        <div className="d-flex justify-content-start">
                            <div className="p-3 rounded-3 bg-dark border border-secondary text-secondary small d-flex align-items-center gap-2">
                                <div className="spinner-border spinner-border-sm text-primary" role="status"></div>
                                <span>Especialista pensando...</span>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-3 border-top border-secondary bg-dark">
                    <form onSubmit={handleSubmit} className="d-flex gap-2">
                        <input 
                            type="text" 
                            className="form-control bg-black text-light border-secondary"
                            placeholder="Digite sua dúvida ou pedido de template..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                        />
                        <button type="submit" className="btn btn-sl-primary d-flex align-items-center justify-content-center" disabled={sending} style={{ width: '48px' }}>
                            <Send size={18} />
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
