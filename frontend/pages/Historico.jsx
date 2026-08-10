import React, { useEffect, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { History, Download, Cpu, HardDrive, FileCode, CheckCircle, RefreshCw } from 'lucide-react';

export default function Historico() {
    const { user } = useOutletContext();
    const [data, setData] = useState({ compilacoes: [], totalIA: 0, storageLimitMb: 5 });
    const [loading, setLoading] = useState(true);

    const carregarHistorico = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/historico');
            const json = await res.json();
            if (res.ok) {
                setData(json);
            }
        } catch (e) {
            console.error('Erro ao carregar histórico:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        carregarHistorico();
    }, []);

    return (
        <div className="p-3 p-md-5">
            <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3 mb-5">
                <div>
                    <h1 className="fw-bolder text-uppercase mb-1" style={{ fontSize: '1.4rem', letterSpacing: '-0.03em', fontWeight: 900 }}>
                        Histórico de Compilações
                    </h1>
                    <p className="small mb-0" style={{ color: 'var(--sl-text-500)' }}>Últimas gerações e templates XML blindados no motor Softload.</p>
                </div>
                <button onClick={carregarHistorico} className="btn btn-sl-outline btn-sm d-flex align-items-center gap-1">
                    <RefreshCw size={14} className={loading ? 'fa-spin' : ''} /> Atualizar Histórico
                </button>
            </div>

            <div className="row g-3 mb-4">
                <div className="col-12 col-md-6">
                    <div className="sl-card mb-0">
                        <div className="d-flex align-items-center gap-3">
                            <div className="rounded p-2" style={{ background: 'rgba(14,165,233,.1)', color: 'var(--sl-primary)' }}>
                                <History size={20} />
                            </div>
                            <div>
                                <p className="small text-uppercase font-monospace mb-0" style={{ fontSize: '9px', color: 'var(--sl-text-400)' }}>Total no Histórico</p>
                                <h4 className="fw-bold mb-0">{data.compilacoes.length} arquivos</h4>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-12 col-md-6">
                    <div className="sl-card mb-0">
                        <div className="d-flex align-items-center gap-3">
                            <div className="rounded p-2" style={{ background: 'rgba(99,102,241,.1)', color: '#818cf8' }}>
                                <Cpu size={20} />
                            </div>
                            <div>
                                <p className="small text-uppercase font-monospace mb-0" style={{ fontSize: '9px', color: 'var(--sl-text-400)' }}>Gerados por IA</p>
                                <h4 className="fw-bold mb-0">{data.totalIA} templates</h4>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="text-center py-5">
                    <div className="spinner-border text-primary" role="status"></div>
                    <p className="text-secondary small mt-2">Carregando histórico...</p>
                </div>
            ) : data.compilacoes.length === 0 ? (
                <div className="sl-card text-center py-5">
                    <History size={48} className="text-muted mb-3" />
                    <h3 className="fw-bold mb-2">Nenhuma compilação encontrada</h3>
                    <p className="text-secondary small mb-4">Gere seu primeiro template XML no Solaris Code ou no compilador.</p>
                    <Link to="/dashboard/solaris" className="btn btn-sl-primary btn-sm">Abrir Solaris Code</Link>
                </div>
            ) : (
                <div className="sl-card p-0 overflow-hidden mb-0">
                    <div className="table-responsive">
                        <table className="table table-dark table-hover mb-0 align-middle">
                            <thead>
                                <tr style={{ fontSize: '11px', letterSpacing: '0.05em', color: 'var(--sl-text-400)', background: 'rgba(255,255,255,0.02)' }}>
                                    <th className="py-3 px-4">Template / Site</th>
                                    <th className="py-3 px-3">Paleta / Estilo</th>
                                    <th className="py-3 px-3">Tamanho</th>
                                    <th className="py-3 px-3">Data</th>
                                    <th className="py-3 px-4 text-end">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.compilacoes.map(c => (
                                    <tr key={c.id} style={{ borderColor: 'var(--bs-border-color)' }}>
                                        <td className="py-3 px-4">
                                            <div className="d-flex align-items-center gap-2">
                                                <FileCode size={18} className="text-info flex-shrink-0" />
                                                <div>
                                                    <span className="fw-bold d-block text-truncate" style={{ maxWidth: '240px' }}>{c.siteName}</span>
                                                    <span className="font-monospace text-secondary" style={{ fontSize: '10px' }}>{c.arquivo}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-3 px-3">
                                            <div className="d-flex align-items-center gap-2">
                                                <span className="rounded-circle" style={{ width: '10px', height: '10px', background: c.colorHex || '#0ea5e9' }}></span>
                                                <span className="small">{c.colorLabel}</span>
                                            </div>
                                        </td>
                                        <td className="py-3 px-3 font-monospace small text-secondary">
                                            {Math.round((c.tamanhoBytes || 0) / 1024)} KB
                                        </td>
                                        <td className="py-3 px-3 small text-secondary">
                                            {c.criadoEm}
                                        </td>
                                        <td className="py-3 px-4 text-end">
                                            <a href={`/dashboard/compilacao/${c.id}/download`} className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1">
                                                <Download size={14} /> Baixar XML
                                            </a>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
