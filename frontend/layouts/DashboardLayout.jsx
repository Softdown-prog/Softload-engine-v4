import React, { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { 
    LayoutDashboard, 
    MessageSquare, 
    Cpu, 
    FolderOpen, 
    History, 
    Settings,
    LogOut,
    ShieldCheck
} from 'lucide-react';
import { fetchAppConfig } from '../services/api';

function SidebarItem({ to, icon: Icon, label, badge, badgeColor, active }) {
    // For now, use <a> instead of <Link> to allow EJS routes to load
    return (
        <a href={to} className={`sl-nav-item ${active ? 'active' : ''}`}>
            <span className="sl-nav-label">
                <Icon size={18} className="sl-nav-icon me-2" />
                {label}
            </span>
            {badge && (
                <span className="badge rounded-pill fw-black text-uppercase"
                      style={{
                          fontSize: '8px', 
                          letterSpacing: '0.08em', 
                          background: badgeColor === 'primary' ? 'rgba(14,165,233,.15)' : 'rgba(99,102,241,.15)', 
                          color: badgeColor === 'primary' ? 'var(--sl-primary)' : '#818cf8'
                      }}>
                    {badge}
                </span>
            )}
        </a>
    );
}

export default function DashboardLayout() {
    const [config, setConfig] = useState(null);
    const location = useLocation();

    useEffect(() => {
        fetchAppConfig().then(setConfig);
    }, []);

    if (!config) return null; // or a minimal loading state
    
    const user = config.user || { nome: 'Usuário', is_active: false, plano: 'Gratuito' };
    const firstLetter = (user.nome || 'U').charAt(0).toUpperCase();

    return (
        <div className="sl-dash-wrapper" style={{ display: 'flex' }}>
            {/* Sidebar Desktop */}
            <aside id="sl-dash-sidebar" className="sl-sidebar d-none d-lg-flex flex-column" style={{ width: '260px', borderRight: '1px solid var(--bs-border-color)' }}>
                {/* Logo */}
                <div className="d-flex align-items-center justify-content-between px-4 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--bs-border-color)' }}>
                    <div>
                        <a href="/" className="fw-black text-decoration-none sl-brand d-block" style={{ fontSize: '1.05rem', color: 'var(--bs-body-color)' }}>
                            SOFTLOAD<span className="sl-accent">ENGINE</span>
                        </a>
                        <p className="mb-0 text-uppercase font-monospace" style={{ fontSize: '9px', color: 'var(--sl-text-400)', letterSpacing: '0.25em', marginTop: '2px' }}>
                            Fábrica de Templates XML
                        </p>
                    </div>
                </div>

                {/* User Info */}
                <div className="px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--bs-border-color)' }}>
                    <div className="d-flex align-items-center gap-3">
                        <div className="rounded-3 d-flex align-items-center justify-content-center text-white fw-black flex-shrink-0"
                             style={{ width: '36px', height: '36px', background: 'linear-gradient(135deg,#0ea5e9,#2563eb)', fontSize: '14px' }}>
                            {firstLetter}
                        </div>
                        <div className="overflow-hidden">
                            <p className="mb-0 fw-bold small text-truncate">{user.nome || 'Usuário'}</p>
                            <span className="d-inline-flex align-items-center gap-1 fw-black text-uppercase"
                                  style={{ fontSize: '9px', letterSpacing: '0.15em', color: user.is_active ? 'var(--sl-primary)' : 'var(--sl-text-400)' }}>
                                <span className={`rounded-circle ${user.is_active ? 'sl-pulse' : ''}`}
                                      style={{ width: '6px', height: '6px', background: user.is_active ? 'var(--sl-primary)' : '#94a3b8', display: 'inline-block', flexShrink: 0 }}></span>
                                {user.is_active ? 'Premium' : 'Gratuito'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-grow-1 px-3 py-3" style={{ overflowY: 'auto' }}>
                    <p className="fw-black text-uppercase mb-2 px-2" style={{ fontSize: '9px', letterSpacing: '0.3em', color: 'var(--sl-text-400)' }}>Ferramentas</p>
                    <SidebarItem to="/dashboard/chat" icon={MessageSquare} label="Especialista Blogger" badge="Gemini" badgeColor="primary" active={location.pathname === '/dashboard/chat'} />
                    <SidebarItem to="/dashboard/solaris" icon={Cpu} label="Solaris Code" badge="Novo" badgeColor="secondary" active={location.pathname === '/dashboard/solaris'} />
                    
                    <p className="fw-black text-uppercase mb-2 px-2 mt-4" style={{ fontSize: '9px', letterSpacing: '0.3em', color: 'var(--sl-text-400)' }}>Conta</p>
                    <SidebarItem to="/dashboard/workspace" icon={FolderOpen} label="Workspace" active={location.pathname === '/dashboard/workspace'} />
                    <SidebarItem to="/dashboard/historico" icon={History} label="Histórico XML" active={location.pathname === '/dashboard/historico'} />
                    <SidebarItem to="/dashboard/configuracoes" icon={Settings} label="Configurações" active={location.pathname === '/dashboard/configuracoes'} />
                </nav>

                {/* Logout */}
                <div className="px-3 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--bs-border-color)' }}>
                    <a href="/logout" className="sl-nav-item text-danger" style={{ color: '#f87171' }}>
                        <span className="sl-nav-label">
                            <LogOut size={18} className="sl-nav-icon me-2" />
                            Encerrar Sessão
                        </span>
                    </a>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-grow-1 overflow-auto d-flex flex-column" style={{ minWidth: 0 }}>
                {/* Topbar mobile */}
                <div className="sl-topbar d-lg-none p-3 d-flex align-items-center" style={{ borderBottom: '1px solid var(--bs-border-color)' }}>
                    <span className="flex-grow-1 fw-bolder text-uppercase small" style={{ color: 'var(--bs-body-color)', letterSpacing: '-0.02em' }}>Painel</span>
                    <Link to="/dashboard/configuracoes" title="Configurações" className="btn btn-link p-1" style={{ color: 'var(--sl-text-400)' }}>
                        <Settings size={20} />
                    </Link>
                </div>
                
                {/* Pages render here */}
                <Outlet context={{ user }} />
            </main>
        </div>
    );
}
