import React, { useEffect, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { FolderOpen, Plus, Trash2, Clock, Cpu, Download, FileCode, ChevronRight, AlertCircle, RefreshCw } from 'lucide-react';

export default function Workspace() {
    const { user } = useOutletContext();
    const [projetos, setProjetos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [novoNome, setNovoNome] = useState('');
    const [criando, setCriando] = useState(false);
    const [erro, setErro] = useState('');
    const [selectedProjeto, setSelectedProjeto] = useState(null);

    const carregarProjetos = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/workspace/projetos');
            const data = await res.json();
            if (res.ok) {
                setProjetos(data.projetos || []);
                if (data.projetos?.length > 0 && !selectedProjeto) {
                    setSelectedProjeto(data.projetos[0]);
                }
            } else {
                setErro(data.erro || 'Falha ao carregar projetos.');
            }
        } catch (e) {
            setErro('Erro de conexão com o servidor.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        carregarProjetos();
    }, []);

    const criarProjeto = async (e) => {
        e.preventDefault();
        if (!novoNome.trim()) return;
        setCriando(true);
        setErro('');
        try {
            const res = await fetch('/api/workspace/projetos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome: novoNome })
            });
            const data = await res.json();
            if (res.ok) {
                setNovoNome('');
                await carregarProjetos();
            } else {
                setErro(data.erro || 'Erro ao criar projeto.');
            }
        } catch (err) {
            setErro('Erro de conexão.');
        } finally {
            setCriando(false);
        }
    };

    const deletarProjeto = async (id) => {
        if (!confirm('Tem certeza que deseja excluir este projeto e todas as suas sessões?')) return;
        try {
            const res = await fetch(`/api/workspace/projetos/${id}`, { method: 'DELETE' });
            if (res.ok) {
                if (selectedProjeto?.id === id) {
                    setSelectedProjeto(null);
                }
                await carregarProjetos();
            } else {
                const data = await res.json();
                alert(data.erro || 'Erro ao deletar projeto.');
            }
        } catch (err) {
            alert('Erro de conexão.');
        }
    };

    return (
        <div className="p-3 p-md-5">
            {/* Header */}
            <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3 mb-5">
                <div>
                    <h1 className="fw-bolder text-uppercase mb-1" style={{ fontSize: '1.4rem', letterSpacing: '-0.03em', fontWeight: 900 }}>
                        Workspace Industrial
                    </h1>
                    <p className="small mb-0" style={{ color: 'var(--sl-text-500)' }}>Gerencie projetos, versões e sessões de engenharia em tempo real.</p>
                </div>
                <div className="d-flex align-items-center gap-2">
                    <button onClick={carregarProjetos} className="btn btn-sl-outline btn-sm d-flex align-items-center gap-1">
                        <RefreshCw size={14} className={loading ? 'fa-spin' : ''} /> Atualizar
                    </button>
                    <Link to="/dashboard/solaris" className="btn btn-sl-primary btn-sm d-flex align-items-center gap-1">
                        <Plus size={16} /> Novo Projeto IA
                    </Link>
                </div>
            </div>

            {erro && (
                <div className="alert alert-danger d-flex align-items-center gap-2 mb-4" role="alert">
                    <AlertCircle size={18} />
                    <span>{erro}</span>
                </div>
            )}

            {/* Criar Projeto Rápido */}
            <div className="sl-card mb-4">
                <form onSubmit={criarProjeto} className="row g-3 align-items-center">
                    <div className="col-12 col-md-8">
                        <input 
                            type="text" 
                            className="form-control bg-dark text-light border-secondary"
                            placeholder="Nome do novo projeto (ex: Blog Profissional v2)"
                            value={novoNome}
                            onChange={(e) => setNovoNome(e.target.value)}
                            maxLength={60}
                            required
                        />
                    </div>
                    <div className="col-12 col-md-4">
                        <button type="submit" className="btn btn-sl-primary w-100 fw-bold" disabled={criando}>
                            {criando ? 'Criando...' : 'Criar Projeto Vazio'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Lista de Projetos */}
            {loading && projetos.length === 0 ? (
                <div className="text-center py-5">
                    <div className="spinner-border text-primary" role="status"></div>
                    <p className="text-secondary small mt-2">Carregando workspace...</p>
                </div>
            ) : projetos.length === 0 ? (
                <div className="sl-card text-center py-5">
                    <FolderOpen size={48} className="text-muted mb-3" />
                    <h3 className="fw-bold mb-2">Nenhum projeto encontrado</h3>
                    <p className="text-secondary small mb-4">Crie seu primeiro projeto acima ou use o Solaris Code para gerar via inteligência artificial.</p>
                    <Link to="/dashboard/solaris" className="btn btn-sl-primary btn-sm">Abrir Solaris Code</Link>
                </div>
            ) : (
                <div className="row g-4">
                    {/* Seletor Lateral de Projetos */}
                    <div className="col-12 col-lg-4">
                        <div className="sl-card p-0 overflow-hidden mb-0">
                            <div className="p-3 border-bottom border-secondary bg-dark">
                                <h6 className="fw-black text-uppercase mb-0 small" style={{ letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                                    Projetos Salvos ({projetos.length})
                                </h6>
                            </div>
                            <div className="list-group list-group-flush" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                                {projetos.map(proj => {
                                    const isSelected = selectedProjeto?.id === proj.id;
                                    return (
                                        <div 
                                            key={proj.id}
                                            onClick={() => setSelectedProjeto(proj)}
                                            className={`list-group-item list-group-item-action bg-transparent text-light border-secondary p-3 cursor-pointer ${isSelected ? 'active-project' : ''}`}
                                            style={{ cursor: 'pointer', background: isSelected ? 'rgba(14,165,233,0.1)' : 'transparent' }}
                                        >
                                            <div className="d-flex align-items-center justify-content-between mb-1">
                                                <h6 className="fw-bold mb-0 text-truncate">{proj.nome}</h6>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); deletarProjeto(proj.id); }}
                                                    className="btn btn-link text-danger p-0"
                                                    title="Excluir projeto"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                            <div className="d-flex align-items-center justify-content-between small text-secondary">
                                                <span>{proj.sessoes?.length || 0} sessões IA</span>
                                                <span>{proj.criadoEmFmt}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Detalhes do Projeto Selecionado */}
                    <div className="col-12 col-lg-8">
                        {selectedProjeto ? (
                            <div className="sl-card mb-0">
                                <div className="d-flex align-items-center justify-content-between mb-4 pb-3 border-bottom border-secondary">
                                    <div>
                                        <h3 className="fw-bold mb-1">{selectedProjeto.nome}</h3>
                                        <p className="small mb-0 text-secondary">Criado em {selectedProjeto.criadoEmFmt}</p>
                                    </div>
                                    <a href={`/dashboard/workspace/chat?pid=${selectedProjeto.id}`} className="btn btn-sl-primary btn-sm">
                                        Continuar Chat IA
                                    </a>
                                </div>

                                <h5 className="fw-bold mb-3 small text-uppercase" style={{ letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                                    Histórico de Sessões e Versões ({selectedProjeto.sessoes?.length || 0})
                                </h5>

                                {selectedProjeto.sessoes?.length === 0 ? (
                                    <p className="text-secondary small">Nenhuma sessão registrada neste projeto ainda.</p>
                                ) : (
                                    <div className="d-flex flex-column gap-3">
                                        {selectedProjeto.sessoes.map(sessao => (
                                            <div key={sessao.id} className="p-3 rounded border border-secondary bg-dark">
                                                <div className="d-flex align-items-center justify-content-between mb-2">
                                                    <div className="d-flex align-items-center gap-2">
                                                        <FileCode size={18} className="text-info" />
                                                        <span className="fw-bold small">Sessão #{sessao.id.substring(0, 8)}</span>
                                                    </div>
                                                    <span className="small text-secondary">{sessao.criadoEmFmt}</span>
                                                </div>
                                                <p className="small mb-3 text-secondary text-truncate">
                                                    {sessao.prompt || sessao.descricao || 'Modificação de template XML'}
                                                </p>
                                                <div className="d-flex align-items-center gap-2">
                                                    {sessao.compilacaoId && (
                                                        <a href={`/dashboard/compilacao/${sessao.compilacaoId}/download`} className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1">
                                                            <Download size={14} /> Baixar XML
                                                        </a>
                                                    )}
                                                    <a href={`/dashboard/workspace/projetos/${selectedProjeto.id}/sessoes/${sessao.id}/historico`} className="btn btn-sl-outline btn-sm">
                                                        Ver Histórico / Diff
                                                    </a>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="sl-card text-center py-5">
                                <p className="text-secondary">Selecione um projeto na lista ao lado para ver os detalhes.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
