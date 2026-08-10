import React, { useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { Settings, ShieldCheck, Mail, User, Key, Check } from 'lucide-react';

export default function Configuracoes() {
    const { user } = useOutletContext();
    const [nome, setNome] = useState(user?.nome || '');
    const [saved, setSaved] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    };

    return (
        <div className="p-3 p-md-5" style={{ maxWidth: '800px' }}>
            <div className="mb-5">
                <h1 className="fw-bolder text-uppercase mb-1" style={{ fontSize: '1.4rem', letterSpacing: '-0.03em', fontWeight: 900 }}>
                    Configurações da Conta
                </h1>
                <p className="small mb-0" style={{ color: 'var(--sl-text-500)' }}>Gerencie suas credenciais, preferências e status da assinatura Softload.</p>
            </div>

            {saved && (
                <div className="alert alert-success d-flex align-items-center gap-2 mb-4" role="alert">
                    <Check size={18} />
                    <span>Configurações atualizadas com sucesso!</span>
                </div>
            )}

            <div className="sl-card mb-4">
                <h3 className="fw-bold mb-4 small text-uppercase" style={{ letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                    Informações Pessoais
                </h3>
                <form onSubmit={handleSubmit}>
                    <div className="mb-3">
                        <label className="form-label small fw-bold">Nome Completo</label>
                        <div className="input-group">
                            <span className="input-group-text bg-dark text-secondary border-secondary"><User size={16} /></span>
                            <input 
                                type="text" 
                                className="form-control bg-dark text-light border-secondary"
                                value={nome}
                                onChange={(e) => setNome(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="mb-4">
                        <label className="form-label small fw-bold">E-mail de Acesso</label>
                        <div className="input-group">
                            <span className="input-group-text bg-dark text-secondary border-secondary"><Mail size={16} /></span>
                            <input 
                                type="email" 
                                className="form-control bg-dark text-light border-secondary"
                                value={user?.email || ''}
                                disabled
                            />
                        </div>
                        <div className="form-text text-secondary mt-1" style={{ fontSize: '11px' }}>O e-mail não pode ser alterado diretamente. Contate o suporte se necessário.</div>
                    </div>
                    <button type="submit" className="btn btn-sl-primary btn-sm fw-bold">Salvar Alterações</button>
                </form>
            </div>

            <div className="sl-card mb-0">
                <h3 className="fw-bold mb-3 small text-uppercase" style={{ letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                    Plano e Assinatura
                </h3>
                <div className="d-flex align-items-center justify-content-between p-3 bg-dark rounded border border-secondary mb-3">
                    <div>
                        <p className="fw-bold mb-1 text-capitalize">Plano atual: {user?.plano || 'Gratuito'}</p>
                        <p className="small mb-0 text-secondary">
                            {user?.is_active ? 'Assinatura ativa com acesso total aos recursos premium.' : 'Plano gratuito com recursos limitados.'}
                        </p>
                    </div>
                    <Link to="/dashboard/upgrade" className="btn btn-sl-outline btn-sm fw-bold">Gerenciar / Upgrade</Link>
                </div>
            </div>
        </div>
    );
}
