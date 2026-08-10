import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { ShieldCheck, Check, Zap, Crown } from 'lucide-react';

export default function Upgrade() {
    const { user } = useOutletContext();
    const isPremium = user?.is_active || false;

    return (
        <div className="p-3 p-md-5" style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div className="text-center mb-5">
                <span className="badge rounded-pill mb-2 font-monospace" style={{ background: 'rgba(14,165,233,.15)', color: 'var(--sl-primary)', fontSize: '10px' }}>UPGRADE DE CONTA</span>
                <h1 className="fw-bolder text-uppercase mb-2" style={{ fontSize: '1.8rem', letterSpacing: '-0.03em', fontWeight: 900 }}>
                    Planos Softload Engine
                </h1>
                <p className="small text-secondary" style={{ maxWidth: '500px', margin: '0 auto' }}>
                    Desbloqueie o poder máximo da fundição industrial de templates XML, Solaris Code AI e armazenamento ilimitado.
                </p>
            </div>

            <div className="row g-4 justify-content-center">
                {/* Plano Gratuito */}
                <div className="col-12 col-md-6 col-lg-5">
                    <div className="sl-card h-100 d-flex flex-column mb-0">
                        <div className="mb-4">
                            <h3 className="fw-bold mb-1">Gratuito</h3>
                            <p className="small text-secondary mb-3">Para testes e projetos iniciais.</p>
                            <h2 className="fw-black mb-0">R$ 0 <span className="small text-secondary fw-normal">/ para sempre</span></h2>
                        </div>
                        <ul className="list-unstyled d-flex flex-column gap-3 mb-5 small text-secondary flex-grow-1">
                            <li className="d-flex align-items-center gap-2"><Check size={16} className="text-success" /> 5 MB de limite por template</li>
                            <li className="d-flex align-items-center gap-2"><Check size={16} className="text-success" /> Compilador XML padrão</li>
                            <li className="d-flex align-items-center gap-2"><Check size={16} className="text-success" /> Histórico básico de 30 dias</li>
                        </ul>
                        <button className="btn btn-outline-secondary w-100 fw-bold" disabled>
                            {!isPremium ? 'Plano Atual' : 'Disponível'}
                        </button>
                    </div>
                </div>

                {/* Plano Premium Studio */}
                <div className="col-12 col-md-6 col-lg-5">
                    <div className="sl-card h-100 d-flex flex-column mb-0 border-primary position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(14,165,233,0.05), rgba(37,99,235,0.05))' }}>
                        <div className="position-absolute top-0 end-0 bg-primary text-white font-monospace px-3 py-1 fw-bold text-uppercase" style={{ fontSize: '9px', borderBottomLeftRadius: '8px' }}>
                            Mais Popular
                        </div>
                        <div className="mb-4">
                            <h3 className="fw-bold mb-1 d-flex align-items-center gap-2">
                                <Crown size={20} className="text-warning" /> Studio Pro
                            </h3>
                            <p className="small text-secondary mb-3">Para criadores e agências profissionais.</p>
                            <h2 className="fw-black mb-0">R$ 97 <span className="small text-secondary fw-normal">/ mês</span></h2>
                        </div>
                        <ul className="list-unstyled d-flex flex-column gap-3 mb-5 small text-light flex-grow-1">
                            <li className="d-flex align-items-center gap-2"><Check size={16} className="text-primary" /> Armazenamento de 50 MB por template</li>
                            <li className="d-flex align-items-center gap-2"><Check size={16} className="text-primary" /> Acesso total ao Solaris Code AI</li>
                            <li className="d-flex align-items-center gap-2"><Check size={16} className="text-primary" /> Especialista Blogger IA ilimitado</li>
                            <li className="d-flex align-items-center gap-2"><Check size={16} className="text-primary" /> Workspace Industrial completo com versões</li>
                        </ul>
                        <button className="btn btn-sl-primary w-100 fw-bold">
                            {isPremium ? 'Plano Ativo' : 'Assinar Studio Pro'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
