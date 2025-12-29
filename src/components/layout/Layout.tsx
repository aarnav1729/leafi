import React from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Header } from "./Header";
import { UserRole } from "@/types/auth.types";

interface LayoutProps {
  requiredRole?: UserRole; // backward compatible
  requiredRoles?: UserRole[]; // allow multiple roles
}

function defaultRouteForRole(role?: UserRole | null) {
  if (role === "logistics") return "/logistics/rfqs";
  if (role === "vendor") return "/vendor/rfqs";
  if (role === "admin") return "/admin/dashboard";
  return "/"; // fallback
}

export function Layout({ requiredRole, requiredRoles }: LayoutProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  const role = user?.role as UserRole | undefined;
  const fallback = defaultRouteForRole(role);
  // Treat /app as a "role landing" route.
  // This prevents the /app -> /app loop and sends users to their default page.
  if (location.pathname === "/app") {
    return <Navigate to={fallback} replace />;
  }

  // Role gating:
  // - requiredRoles: user must be in list
  // - requiredRole: user must match single role (legacy)
  if (requiredRoles && requiredRoles.length > 0) {
    if (!role || !requiredRoles.includes(role)) {
      return <Navigate to={fallback} replace />;
    }
  } else if (requiredRole && role !== requiredRole) {
    return <Navigate to={fallback} replace />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container py-6">
        <Outlet />
      </main>
    </div>
  );
}
