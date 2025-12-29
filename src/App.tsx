// root/src/App.tsx
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AuthProvider } from "@/contexts/AuthContext";
import { DataProvider } from "@/contexts/DataContext";
import { Layout } from "@/components/layout/Layout";

import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import Terms from "./pages/Terms";
import Contact from "./pages/Contact";

// Logistics pages
import RFQList from "./pages/logistics/RFQList";
import FinalizeRFQ from "./pages/logistics/FinalizeRFQ";
import Masters from "./pages/logistics/Masters";

// Vendor pages
import VendorRFQList from "./pages/vendor/RFQList";
import VendorAllottedRFQs from "./pages/vendor/AllottedRFQs";

// Admin pages
import AdminDashboard from "./pages/admin/Dashboard";
import Users from "./pages/admin/Users";

// App landing (optional): you had Index earlier, but /app is better as redirect.
// If you still want Index tiles, keep it and show for all roles; otherwise remove.
// import Index from "./pages/Index";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <DataProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<Login />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/contact" element={<Contact />} />

              {/* Authenticated shell - no specific role */}
              <Route element={<Layout />}>
                {/* /app is a landing router: Header will redirect user after login */}
                <Route path="/app" element={<Navigate to="/app" replace />} />
              </Route>

              {/* Logistics Routes */}
              <Route element={<Layout requiredRole="logistics" />}>
                <Route path="/logistics/rfqs" element={<RFQList />} />
                <Route
                  path="/logistics/finalize/:rfqId"
                  element={<FinalizeRFQ />}
                />
                <Route path="/logistics/masters" element={<Masters />} />
              </Route>

              {/* Vendor Routes */}
              <Route element={<Layout requiredRole="vendor" />}>
                <Route path="/vendor/rfqs" element={<VendorRFQList />} />
                <Route
                  path="/vendor/allotted"
                  element={<VendorAllottedRFQs />}
                />
              </Route>

              {/* Admin Routes */}
              <Route element={<Layout requiredRole="admin" />}>
                <Route path="/admin/dashboard" element={<AdminDashboard />} />
                <Route path="/admin/masters" element={<Masters />} />

                <Route path="/admin/users" element={<Users />} />
              </Route>

              {/* Catch-all */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </DataProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
