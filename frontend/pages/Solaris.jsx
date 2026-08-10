import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Cpu, Send, Sparkles, Terminal, CheckCircle2, AlertCircle } from 'lucide-react';

export default function Solaris() {
    const { user } = useOutletContext();
    const [prompt, setPrompt] = useState('');
    const [generating, setGenerating] = useState(false);
    const [resultado, setResultado] = useState(null);
    const [erro, setErro] = useState('');

    const handleGerar = async (e) => {
        e.preventDefault();
        if (!prompt.trim()) return;
        setGenerating(true);
        setErro('');
        setResultado(null);

        try {
            const res = await fetch('/api/solaris/gerar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });
            const data = await res.json();
            if (res.ok) {
                setResultado(data);
            } else {
                setErro(data.erro || 'Falha ao gerar template com Solaris IA.');
            }
        } catch (err) {
            setErro('Erro de conexão com o servidor.');
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="p-3 p-md-5">
            <div className="mb-5">
                <div className="d-flex align-items-center gap-2 mb-1">
                    <span className="badge rounded-pill" style={{ background: 'rgba(99,102,241,.15)', color: '#818cf8', fontSize: '10px' }}>NOVO MOTOR v3</span>
                </div>
                <h1 className="fw-bolder text-uppercase mb-1" style={{ fontSize: '1.4rem', letterSpacing: '-0.03em', fontWeight: 900 }}>
                    Solaris Code AI
                </h1>
                <p className="small mb-0" style={{ color: 'var(--sl-text-500)' }}>Engenharia de templates XML guiada por inteligência artificial avançada.</p>
            </div>

            <div className="row g-4">
                <div className="col-12 col-lg-6">
                    <div className="sl-card mb-0">
                        <h3 className="fw-bold mb-3 small text-uppercase" style={{ letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                            Descreva o Template Desejado
                        </h3>
                        <form onSubmit={handleGerar}>
                            <div className="mb-3">
                                <textarea 
                                    className="form-control bg-dark text-light border-secondary"
                                    rows="6"
                                    placeholder="Ex: Crie um template XML estruturado para Blogger com widget de notícias em destaque, modo escuro automático e cards otimizados para SEO..."
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    required
                                ></textarea>
                            </div>
                            {erro && (
                                <div className="alert alert-danger d-flex align-items-center gap-2 mb-3 py-2 small" role="alert">
                                    <AlertCircle size={16} />
                                    <span>{erro}</span>
                                </div>
                            )}
                            <button type="submit" className="btn btn-sl-primary w-100 fw-bold d-flex align-items-center justify-content-center gap-2" disabled={generating}>
                                {generating ? (
                                    <>
                                        <div className="spinner-border spinner-border-sm text-light" role="status"></div>
                                        <span>Solaris está compilando...</span>
                                    </>
                                ) : (
                                    <>
                                        <Sparkles size={18} />
                                        <span>Gerar com Solaris AI</span>
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                </div>

                <div className="col-12 col-lg-6">
                    <div className="sl-card mb-0 h-100 d-flex flex-column">
                        <h3 className="fw-bold mb-3 small text-uppercase" style={{ letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                            Resultado da Compilação
                        </h3>
                        {resultado ? (
                            <div className="flex-grow-1 d-flex flex-column">
                                <div className="d-flex align-items-center gap-2 text-success mb-3 small fw-bold">
                                    <CheckCircle2 size={16} /> Template gerado e blindado com sucesso!
                                </div>
                                <pre className="bg-black text-light p-3 rounded border border-secondary flex-grow-1 small" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                                    <code>{resultado.codigo || JSON.stringify(resultado, null, 2)}</code>
                                </pre>
                                {resultado.compilacaoId && (
                                    <div className="mt-3">
                                        <a href={`/dashboard/compilacao/${resultado.compilacaoId}/download`} className="btn btn-sl-outline btn-sm w-100 fw-bold">
                                            Baixar Arquivo XML
                                        </a>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex-grow-1 d-flex flex-column align-items-center justify-content-center text-center py-5" style={{ color: 'var(--sl-text-400)' }}>
                                <Terminal size={40} className="mb-3 opacity-50" />
                                <p className="small mb-0">Insira um prompt ao lado e clique em gerar para ver o código compilado pelo Solaris.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
