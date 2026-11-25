import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../features/auth/authContext';
import { AuthCallbackPage } from '../features/auth/AuthCallbackPage';
import { CartProvider } from '../features/cart/cartContext';
import { CatalogPage } from '../features/catalog/CatalogPage';
import { AdminCatalogPage } from '../features/catalog/AdminCatalogPage';
import { CartPage } from '../features/cart/CartPage';
import { ProfilePage } from '../features/customer/ProfilePage';
import { AdminCustomersPage } from '../features/customer/AdminCustomersPage';
import { OrdersPage } from '../features/orders/OrdersPage';
import { OrderDetailPage } from '../features/orders/OrderDetailPage';
import { AdminOperationsPage } from '../features/shipping/AdminOperationsPage';
import { ToastProvider } from '../shared/ui/ToastRegion';
import { Layout } from './Layout';
import { RoadmapPage } from './RoadmapPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <CartProvider>
            <ToastProvider>
              <Layout>
                <Routes>
                  {/* Public & Customer storefront */}
                  <Route path="/" element={<CatalogPage />} />
                  <Route path="/cart" element={<CartPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/orders" element={<OrdersPage />} />
                  <Route path="/orders/:orderId" element={<OrderDetailPage />} />

                  {/* Back-office (ROLE_admin) */}
                  <Route path="/admin/catalog" element={<AdminCatalogPage />} />
                  <Route path="/admin/operations" element={<AdminOperationsPage />} />
                  <Route path="/admin/customers" element={<AdminCustomersPage />} />

                  {/* OAuth2 Authorization Code + PKCE callback */}
                  <Route path="/callback" element={<AuthCallbackPage />} />

                  {/* Architecture & upcoming sprint slots (s07+ payments, returns, observability) */}
                  <Route path="/roadmap" element={<RoadmapPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Layout>
            </ToastProvider>
          </CartProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
