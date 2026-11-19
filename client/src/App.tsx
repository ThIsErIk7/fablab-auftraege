import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.tsx';
import { Loading } from './components/ui.tsx';
import Dashboard from './pages/Dashboard.tsx';
import OrdersPage from './pages/OrdersPage.tsx';
import OrderDetailPage from './pages/OrderDetailPage.tsx';
import OrderNewPage from './pages/OrderNewPage.tsx';
import MachinesPage from './pages/MachinesPage.tsx';
import InvoicesPage from './pages/InvoicesPage.tsx';
import InvoiceDetailPage from './pages/InvoiceDetailPage.tsx';
import HistoryPage from './pages/HistoryPage.tsx';
import AdminPage from './pages/admin/AdminPage.tsx';

// Import-Assistent lädt SheetJS – nur bei Bedarf laden
const ImportPage = lazy(() => import('./pages/ImportPage.tsx'));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="auftraege" element={<OrdersPage />} />
        <Route path="auftraege/neu" element={<OrderNewPage />} />
        <Route path="auftraege/:id" element={<OrderDetailPage />} />
        <Route path="maschinen" element={<MachinesPage />} />
        <Route path="rechnungen" element={<InvoicesPage />} />
        <Route path="rechnungen/:id" element={<InvoiceDetailPage />} />
        <Route path="import" element={<Suspense fallback={<Loading />}><ImportPage /></Suspense>} />
        <Route path="verlauf" element={<HistoryPage />} />
        <Route path="admin/*" element={<AdminPage />} />
        <Route path="*" element={<div className="p-8 text-center">Seite nicht gefunden.</div>} />
      </Route>
    </Routes>
  );
}
