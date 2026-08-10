import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DashboardLayout from './layouts/DashboardLayout';
import DashboardHome from './pages/DashboardHome';
import Workspace from './pages/Workspace';
import WorkspaceChat from './pages/WorkspaceChat';
import Solaris from './pages/Solaris';
import Configuracoes from './pages/Configuracoes';
import Chat from './pages/Chat';
import Historico from './pages/Historico';
import Upgrade from './pages/Upgrade';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<DashboardHome />} />
          <Route path="workspace" element={<Workspace />} />
          <Route path="workspace/chat" element={<WorkspaceChat />} />
          <Route path="solaris" element={<Solaris />} />
          <Route path="configuracoes" element={<Configuracoes />} />
          <Route path="chat" element={<Chat />} />
          <Route path="historico" element={<Historico />} />
          <Route path="upgrade" element={<Upgrade />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;

