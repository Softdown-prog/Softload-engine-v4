import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, useOutletContext } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { 
    Layers, ArrowLeft, Cpu, Sparkles, Send, History, PlusCircle, 
    X, Clipboard, Check, HelpCircle, StopCircle, Eye, ArrowRight, Zap, RefreshCw
} from 'lucide-react';

export default function WorkspaceChat() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user } = useOutletContext();
    
    const wsSessionId = searchParams.get('wsSession');
    const wsProjetoId = searchParams.get('projeto');

    const [loadingInfo, setLoadingInfo] = useState(true);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [statusHistory, setStatusHistory] = useState([]);
    const [sessionId, setSessionId] = useState(null);
    const [credits, setCredits] = useState({ creditos: 0, creditosTotal: 0 });
    const [snapshot, setSnapshot] = useState(null);
    const [sessionsList, setSessionsList] = useState([]);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [copiedId, setCopiedId] = useState(null);
    const [previewApplied, setPreviewApplied] = useState(null);

    const messagesEndRef = useRef(null);
    const abortControllerRef = useRef(null);

    // Sugestões dependendo do estado do manifesto
    const suggestionsWithManifesto = [
        "Trocar a cor principal do site",
        "Mudar a tipografia",
        "Adicionar uma seção de FAQ",
        "Que fonte eu escolhi?"
    ];

    const suggestionsWithoutManifesto = [
        "Criar um blog sobre culinária",
        "Criar um site de tecnologia e reviews",
        "Criar uma landing page de portfólio"
    ];

    useEffect(() => {
        if (!wsSessionId || !wsProjetoId) {
            navigate('/dashboard/workspace');
            return;
        }
        carregarInfoInicial();
        carregarHistorico();
    }, [wsSessionId, wsProjetoId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, statusText, statusHistory]);

    const carregarInfoInicial = async () => {
        try {
            setLoadingInfo(true);
            const res = await fetch(`/api/workspace/chat/info?wsSession=${wsSessionId}&projeto=${wsProjetoId}`);
            if (res.ok) {
                const data = await res.json();
                setCredits({
                    creditos: data.creditosGemini || 0,
                    creditosTotal: data.creditosGeminiTotal || 0
                });
                setSnapshot(data.snapshot || null);
                setSessionId(data.sessionId || null);
                setMessages(data.messages || []);
            }
        } catch (err) {
            console.error('Erro ao carregar dados iniciais do chat:', err);
        } finally {
            setLoadingInfo(false);
        }
    };

    const carregarHistorico = async () => {
        try {
            const res = await fetch('/api/chat/sessions?type=workspace-chat');
            if (res.ok) {
                const data = await res.json();
                setSessionsList(data.sessions || []);
            }
        } catch (err) {
            console.error('Erro ao carregar histórico:', err);
        }
    };

    const iniciarNovaConversa = () => {
        if (loading) return;
        setMessages([]);
        setSessionId(null);
        setPreviewApplied(null);
        setStatusHistory([]);
        setStatusText('');
        setInput('');
    };

    const carregarSessao = async (sessId) => {
        if (loading) return;
        setStatusText('Carregando conversa...');
        try {
            const res = await fetch(`/api/chat/sessions/${sessId}?type=workspace-chat`);
            if (res.ok) {
                const data = await res.json();
                if (data.session) {
                    setSessionId(sessId);
                    setMessages(data.session.messages || []);
                    setPreviewApplied(null);
                    setStatusHistory([]);
                    setStatusText('');
                    setDrawerOpen(false);
                }
            }
        } catch (err) {
            console.error('Erro ao carregar sessão:', err);
            setStatusText('Erro ao carregar sessão.');
        }
    };

    const handleCopy = (text, id) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        });
    };

    const handleVerAlteracao = async (preview) => {
        if (!preview || !preview.xmlPath) return;
        try {
            const res = await fetch('/api/workspace/set-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    xmlPath: preview.xmlPath,
                    gcPath: preview.gcPath || '',
                    siteName: preview.siteName || '',
                    colorPreset: preview.colorPreset || '',
                    nichoTema: preview.nichoTema || ''
                })
            });
            if (res.ok) {
                window.open('/dashboard/preview/session', '_blank');
            } else {
                alert('Não foi possível carregar o preview.');
            }
        } catch (err) {
            console.error(err);
            alert('Falha de conexão ao gerar preview.');
        }
    };

    const handleSend = async (e, textToSend = null) => {
        if (e) e.preventDefault();
        const msg = (textToSend || input).trim();
        if (!msg || loading) return;

        setInput('');
        setLoading(true);
        setPreviewApplied(null);
        setStatusHistory([]);
        setStatusText('Iniciando conexão...');

        const updatedHistory = [...messages, { role: 'user', content: msg }];
        setMessages(updatedHistory);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const historyToSend = updatedHistory.slice(0, -1).slice(-20);

            const response = await fetch('/dashboard/workspace/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: msg,
                    history: historyToSend,
                    sessionId: sessionId,
                    wsSessionId: wsSessionId,
                    wsProjetoId: wsProjetoId
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                if (response.status === 402) {
                    const err402 = await response.json().catch(() => ({}));
                    throw new Error(err402.error || err402.erro || 'Seus créditos de IA acabaram.');
                }
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || err.erro || 'Erro ao processar mensagem.');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let currentAssistantReply = '';
            let addedAssistantBubble = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                let idx;
                while ((idx = buffer.indexOf('\n\n')) !== -1) {
                    const block = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 2);

                    const dLine = block.match(/^data: (.+)$/m);
                    if (!dLine) continue;

                    let event;
                    try {
                        event = JSON.parse(dLine[1]);
                    } catch (_) {
                        continue;
                    }

                    if (event.type === 'status') {
                        setStatusText(event.label);
                        setStatusHistory(prev => [...prev, event.label]);
                    } else if (event.type === 'chunk') {
                        setStatusText('');
                        currentAssistantReply += event.text;

                        let visibleText = currentAssistantReply;
                        const markerIdx = currentAssistantReply.indexOf('[[TEMPLATE:');
                        if (markerIdx !== -1) {
                            visibleText = currentAssistantReply.slice(0, markerIdx).trimEnd();
                        }

                        if (!addedAssistantBubble) {
                            setMessages(prev => [...prev, { role: 'assistant', content: visibleText }]);
                            addedAssistantBubble = true;
                        } else {
                            setMessages(prev => {
                                const copy = [...prev];
                                copy[copy.length - 1] = { role: 'assistant', content: visibleText };
                                return copy;
                            });
                        }
                    } else if (event.type === 'done') {
                        setStatusText('');
                        const finalReply = event.reply || currentAssistantReply;
                        
                        let cleanedReply = finalReply;
                        const markerIdx = finalReply.indexOf('[[TEMPLATE:');
                        if (markerIdx !== -1) {
                            cleanedReply = finalReply.slice(0, markerIdx).trimEnd();
                        }

                        if (event.sessionId) {
                            setSessionId(event.sessionId);
                        }

                        if (event.preview) {
                            setPreviewApplied(event.preview);
                        }

                        setMessages(prev => {
                            const copy = [...prev];
                            if (addedAssistantBubble) {
                                copy[copy.length - 1] = { role: 'assistant', content: cleanedReply };
                            } else {
                                copy.push({ role: 'assistant', content: cleanedReply });
                            }
                            return copy;
                        });

                        // Recarregar infos para pegar novos créditos e snapshot atualizado
                        carregarInfoInicial();
                        carregarHistorico();
                    } else if (event.type === 'error') {
                        setStatusText('');
                        throw new Error(event.message || 'Erro inesperado do modelo.');
                    }
                }
            }

        } catch (err) {
            console.error('Streaming error:', err);
            const errMsg = err.message || 'Falha na conexão.';
            setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Erro: ${errMsg}` }]);
        } finally {
            setLoading(false);
            setStatusText('');
            abortControllerRef.current = null;
        }
    };

    const stopGeneration = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            setLoading(false);
            setStatusText('Geração interrompida.');
        }
    };

    const suggestions = snapshot?.manifesto ? suggestionsWithManifesto : suggestionsWithoutManifesto;

    if (loadingInfo) {
        return (
            <div className="d-flex flex-column align-items-center justify-content-center bg-dark text-light" style={{ height: 'calc(100vh - 64px)' }}>
                <RefreshCw size={32} className="text-info animate-spin mb-3" />
                <p className="small text-secondary">Iniciando Editor do Workspace...</p>
            </div>
        );
    }

    return (
        <div className="d-flex flex-column" style={{ height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
            {/* Topbar */}
            <div className="d-flex align-items-center justify-content-between p-3 border-bottom border-secondary bg-dark flex-shrink-0">
                <div className="d-flex align-items-center gap-3">
                    <button 
                        onClick={() => navigate('/dashboard/workspace')}
                        className="btn btn-outline-secondary btn-sm p-2 d-flex align-items-center justify-content-center"
                        style={{ width: '38px', height: '38px' }}
                    >
                        <ArrowLeft size={16} />
                    </button>
                    <div>
                        <h1 className="fw-bolder text-uppercase mb-0 d-flex align-items-center gap-2" style={{ fontSize: '1rem', letterSpacing: '-0.02em' }}>
                            Editor do Workspace
                            <span className="badge rounded-pill fw-black" style={{ fontSize: '8px', background: 'rgba(14,165,233,.15)', color: '#0ea5e9' }}>IA</span>
                        </h1>
                        <p className="mb-0 text-secondary d-none d-md-flex align-items-center gap-1" style={{ fontSize: '0.72rem' }}>
                            <Layers size={11} className="text-info" />
                            Template: <strong className="text-light">{snapshot?.siteName || 'Sem nome ainda'}</strong>
                            <span className="text-muted">·</span>
                            <span className="text-info">{snapshot?.colorPreset || 'tech-blue'}</span>
                            <span className="text-muted">·</span>
                            <span>{snapshot?.manifesto ? 'Carregado' : 'Aguardando geração'}</span>
                        </p>
                    </div>
                </div>

                <div className="d-flex align-items-center gap-2">
                    <div className="d-none d-sm-flex align-items-center gap-1 text-secondary px-2 py-1 rounded border border-secondary bg-black" style={{ fontSize: '0.7rem', fontWeight: 700 }}>
                        <Zap size={11} className="text-warning" />
                        <span>{credits.creditos.toLocaleString('pt-BR')}</span>
                        <span className="text-muted">/</span>
                        <span className="text-muted">{credits.creditosTotal.toLocaleString('pt-BR')}</span>
                    </div>

                    <button 
                        onClick={() => setDrawerOpen(true)}
                        className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1 px-3"
                    >
                        <History size={14} />
                        <span className="d-none d-md-inline">Histórico</span>
                    </button>

                    <button 
                        onClick={iniciarNovaConversa}
                        disabled={loading}
                        className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1 px-3"
                    >
                        <PlusCircle size={14} />
                        <span className="d-none d-md-inline">Nova Conversa</span>
                    </button>
                </div>
            </div>

            {/* Corpo de Mensagens */}
            <div className="flex-grow-1 p-3 p-md-4 bg-dark bg-opacity-20" style={{ overflowY: 'auto' }}>
                <div className="max-w-3xl mx-auto d-flex flex-column gap-4 pb-4">
                    {messages.length === 0 ? (
                        <div className="d-flex flex-column align-items-center justify-content-center text-center py-5">
                            <motion.div 
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="rounded-4 d-flex align-items-center justify-content-center mb-3"
                                style={{ 
                                    width: '56px', 
                                    height: '56px', 
                                    background: 'linear-gradient(135deg, rgba(14,165,233,.15), rgba(37,99,235,.15))',
                                    border: '1px solid rgba(14,165,233,.2)'
                                }}
                            >
                                <Layers size={24} className="text-info" />
                            </motion.div>
                            <h2 className="fw-black mb-2" style={{ fontSize: '1.25rem' }}>
                                {snapshot?.manifesto ? 'O que você quer mudar?' : 'Vamos criar seu template'}
                            </h2>
                            <p className="text-secondary small mb-4" style={{ maxWidth: '420px', lineHeight: 1.6 }}>
                                {snapshot?.manifesto 
                                    ? 'Este chat edita o template que você já tem carregado. Altere cores, fontes, textos, seções ou adicione FAQs.' 
                                    : 'Descreva o site que deseja criar (nicho, nome, estilo) e eu irei estruturar o arquivo XML completo para você.'
                                }
                            </p>
                            
                            <div className="d-flex flex-column gap-2 w-100" style={{ maxWidth: '420px' }}>
                                {suggestions.map((s, idx) => (
                                    <button 
                                        key={idx}
                                        onClick={() => handleSend(null, s)}
                                        className="btn btn-outline-secondary btn-sm text-start py-2 px-3 d-flex align-items-center justify-content-between"
                                        style={{ background: 'rgba(255,255,255,0.01)', borderColor: 'rgba(255,255,255,0.08)' }}
                                    >
                                        <span className="small text-truncate">{s}</span>
                                        <ArrowRight size={12} className="text-muted" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        messages.map((m, idx) => {
                            const isAssistant = m.role === 'assistant';
                            return (
                                <motion.div 
                                    key={idx}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className={`d-flex flex-column ${isAssistant ? 'align-items-start' : 'align-items-end'}`}
                                >
                                    <div className="small text-secondary mb-1 px-1">
                                        {isAssistant ? 'Arquiteto IA' : 'Você'}
                                    </div>
                                    <div 
                                        className={`p-3 rounded-3 max-w-full ${
                                            isAssistant 
                                                ? 'bg-dark border border-secondary text-light' 
                                                : 'btn-sl-primary text-white'
                                        }`}
                                        style={{ 
                                            maxWidth: '90%',
                                            boxShadow: isAssistant ? '0 4px 12px rgba(0,0,0,0.1)' : 'none'
                                        }}
                                    >
                                        {isAssistant ? (
                                            <div className="markdown-body">
                                                <Markdown>{m.content}</Markdown>
                                            </div>
                                        ) : (
                                            <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                                        )}
                                    </div>

                                    {/* Botões extras sob a resposta do assistente */}
                                    {isAssistant && (
                                        <div className="d-flex align-items-center gap-3 mt-1 px-1">
                                            <button 
                                                onClick={() => handleCopy(m.content, idx)}
                                                className="btn btn-link text-secondary p-0 d-flex align-items-center gap-1"
                                                style={{ fontSize: '0.68rem', textDecoration: 'none' }}
                                            >
                                                {copiedId === idx ? (
                                                    <>
                                                        <Check size={11} className="text-success" />
                                                        <span>Copiado!</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Clipboard size={11} />
                                                        <span>Copiar</span>
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })
                    )}

                    {/* Botão de Ver Alteração Aplicada */}
                    {previewApplied && (
                        <motion.div 
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="p-3 rounded-3 border border-info bg-info bg-opacity-10 d-flex align-items-center justify-content-between max-w-xl self-start"
                            style={{ maxWidth: '90%' }}
                        >
                            <div className="d-flex align-items-center gap-2">
                                <Eye size={18} className="text-info" />
                                <div>
                                    <h6 className="fw-bold mb-0 small">Alteração Aplicada!</h6>
                                    <span className="text-secondary" style={{ fontSize: '0.68rem' }}>
                                        O código foi sincronizado com o sandbox.
                                    </span>
                                </div>
                            </div>
                            <button 
                                onClick={() => handleVerAlteracao(previewApplied)}
                                className="btn btn-outline-info btn-sm px-3 fw-bold small"
                            >
                                Ver Demo Live
                            </button>
                        </motion.div>
                    )}

                    {/* Status de carregamento */}
                    {statusText && (
                        <div className="d-flex align-items-center gap-2 text-secondary px-2 py-1 self-start small bg-dark rounded border border-secondary">
                            <RefreshCw size={13} className="text-info animate-spin" />
                            <span>{statusText}</span>
                        </div>
                    )}
                    
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input Form */}
            <div className="p-3 bg-dark border-top border-secondary flex-shrink-0">
                <div className="max-w-3xl mx-auto">
                    <form onSubmit={handleSend} className="d-flex gap-2">
                        <div className="flex-grow-1 position-relative">
                            <textarea 
                                className="form-control bg-black text-light border-secondary pe-5 py-2"
                                rows="1"
                                placeholder="Descreva as alterações..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                style={{ 
                                    resize: 'none', 
                                    height: '46px', 
                                    minHeight: '46px',
                                    borderRadius: '8px',
                                    lineHeight: '1.5'
                                }}
                                disabled={loading}
                            />
                            {loading ? (
                                <button 
                                    type="button"
                                    onClick={stopGeneration}
                                    className="btn btn-link text-danger position-absolute end-0 top-50 translate-middle-y me-2 p-1"
                                    title="Interromper geração"
                                >
                                    <StopCircle size={18} />
                                </button>
                            ) : (
                                <button 
                                    type="submit"
                                    disabled={!input.trim()}
                                    className="btn btn-link text-info position-absolute end-0 top-50 translate-middle-y me-2 p-1"
                                >
                                    <Send size={18} />
                                </button>
                            )}
                        </div>
                    </form>
                    <div className="d-flex align-items-center justify-content-between mt-2 px-1 text-secondary" style={{ fontSize: '0.65rem' }}>
                        <span>Aperte <kbd className="bg-secondary bg-opacity-20 px-1 py-0.5 rounded">Enter</kbd> para enviar, <kbd className="bg-secondary bg-opacity-20 px-1 py-0.5 rounded">Shift + Enter</kbd> para nova linha.</span>
                        <span className="d-flex align-items-center gap-1">
                            <HelpCircle size={10} />
                            As modificações são compiladas no histórico de versões automaticamente.
                        </span>
                    </div>
                </div>
            </div>

            {/* Histórico Drawer */}
            <AnimatePresence>
                {drawerOpen && (
                    <>
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setDrawerOpen(false)}
                            className="position-fixed inset-0 bg-black bg-opacity-50"
                            style={{ zIndex: 1040 }}
                        />
                        <motion.div 
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ type: 'tween', duration: 0.25 }}
                            className="position-fixed top-0 bottom-0 start-0 bg-dark border-end border-secondary"
                            style={{ width: 'min(340px, 90vw)', zIndex: 1050, boxShadow: '4px 0 24px rgba(0,0,0,0.3)' }}
                        >
                            <div className="d-flex align-items-center justify-content-between p-3 border-bottom border-secondary bg-black">
                                <div className="d-flex align-items-center gap-2 text-info">
                                    <History size={16} />
                                    <h5 className="mb-0 fw-black text-uppercase small" style={{ letterSpacing: '0.05em' }}>Histórico</h5>
                                </div>
                                <button 
                                    onClick={() => setDrawerOpen(false)}
                                    className="btn btn-link text-secondary p-1"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="p-2" style={{ overflowY: 'auto', height: 'calc(100% - 56px)' }}>
                                {sessionsList.length === 0 ? (
                                    <p className="text-secondary small text-center py-4">Nenhuma conversa salva.</p>
                                ) : (
                                    sessionsList.map((s) => {
                                        const date = new Date(s.updatedAt);
                                        const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) +
                                                        ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                                        return (
                                            <div 
                                                key={s.sessionId}
                                                onClick={() => carregarSessao(s.sessionId)}
                                                className={`p-3 rounded mb-1 border cursor-pointer d-flex justify-content-between align-items-start transition-colors ${
                                                    sessionId === s.sessionId 
                                                        ? 'bg-primary bg-opacity-10 border-primary text-light' 
                                                        : 'bg-transparent border-transparent text-secondary hover:bg-secondary hover:bg-opacity-5'
                                                }`}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                <div className="min-w-0 flex-grow-1">
                                                    <div className="text-truncate small fw-bold text-light mb-1">
                                                        {s.firstMessage || '(conversa vazia)'}
                                                    </div>
                                                    <div className="d-flex align-items-center gap-2" style={{ fontSize: '0.68rem' }}>
                                                        <span>{dateStr}</span>
                                                        <span>·</span>
                                                        <span>{s.messageCount || 0} msgs</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
