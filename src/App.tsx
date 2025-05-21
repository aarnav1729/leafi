
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import { AuthProvider } from "@/contexts/AuthContext";
import { DataProvider } from "@/contexts/DataContext";
import { Layout } from "@/components/layout/Layout";

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Terms from "./pages/Terms";
import Contact from "./pages/Contact";

// Logistics pages
import RFQList from "./pages/logistics/RFQList";
import FinalizeRFQ from "./pages/logistics/FinalizeRFQ";

// Vendor pages
import VendorRFQList from "./pages/vendor/RFQList";
import VendorAllottedRFQs from "./pages/vendor/AllottedRFQs";

// Admin pages
import AdminDashboard from "./pages/admin/Dashboard";

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
              
              {/* Protected Routes */}
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<Dashboard />} />
              </Route>
              
              {/* Logistics Routes */}
              <Route element={<Layout requiredRole="logistics" />}>
                <Route path="/logistics/rfqs" element={<RFQList />} />
                <Route path="/logistics/finalize/:rfqId" element={<FinalizeRFQ />} />
              </Route>
              
              {/* Vendor Routes */}
              <Route element={<Layout requiredRole="vendor" />}>
                <Route path="/vendor/rfqs" element={<VendorRFQList />} />
                <Route path="/vendor/allotted" element={<VendorAllottedRFQs />} />
              </Route>
              
              {/* Admin Routes */}
              <Route element={<Layout requiredRole="admin" />}>
                <Route path="/admin/dashboard" element={<AdminDashboard />} />
              </Route>
              
              {/* Catch-all Route */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </DataProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
