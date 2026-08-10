import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DashboardLayout from './layouts/DashboardLayout';
import DashboardHome from './pages/DashboardHome';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<DashboardHome />} />
          {/* We will add more routes here as we migrate them */}
          {/* E.g. <Route path="workspace" element={<Workspace />} /> */}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
