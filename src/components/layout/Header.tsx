// root/src/components/layout/Header.tsx
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { useLocation, useNavigate, NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { RefreshCcw } from "lucide-react";

function getHomeForRole(role?: string) {
  if (role === "logistics") return "/logistics/rfqs";
  if (role === "vendor") return "/vendor/rfqs";
  if (role === "admin") return "/admin/dashboard";
  return "/";
}

type NavItem = { to: string; label: string };

function NavBar({ items }: { items: NavItem[] }) {
  const location = useLocation();
  return (
    <nav className="hidden md:flex items-center gap-2 relative">
      {items.map((item) => {
        const isActive =
          location.pathname === item.to ||
          location.pathname.startsWith(`${item.to}/`);
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={cn(
              "group relative inline-flex min-h-10 items-center rounded-md px-4 py-2 text-sm font-medium whitespace-nowrap select-none transition-colors duration-200",
              "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 rounded-md bg-gradient-to-br from-primary/10 via-primary/5 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100",
                isActive && "opacity-100"
              )}
            />

            <span className="relative z-[1]">{item.label}</span>

            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-x-2 -bottom-[3px] h-[2px] rounded-full bg-gradient-to-r from-primary via-primary/70 to-primary/40 transition-all duration-200 origin-left",
                isActive
                  ? "scale-x-100 opacity-100"
                  : "scale-x-0 opacity-0 group-hover:scale-x-100 group-hover:opacity-70"
              )}
            />
          </NavLink>
        );
      })}
    </nav>
  );
}

export function Header() {
  const { user, logout } = useAuth();
  const { refreshAll, lastRefreshedAt, isRefreshing } = useData();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!user) return;
    if (location.pathname === "/app") {
      navigate(getHomeForRole(user.role), { replace: true });
    }
  }, [location.pathname, navigate, user]);

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const handleBrandClick = () => {
    navigate("/app");
  };

  const lastRefreshLabel = lastRefreshedAt
    ? new Date(lastRefreshedAt).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not yet refreshed";

  const navItems: NavItem[] =
    user?.role === "logistics"
      ? [
          { to: "/logistics/rfqs", label: "RFQs" },
          { to: "/logistics/masters", label: "Masters" },
        ]
      : user?.role === "vendor"
      ? [
          { to: "/vendor/rfqs", label: "RFQs" },
          { to: "/vendor/allotted", label: "Allotted" },
        ]
      : user?.role === "admin"
      ? [
          { to: "/admin/dashboard", label: "Dashboard" },
          { to: "/admin/rfqs", label: "RFQs" },
          { to: "/admin/masters", label: "Masters" },
          { to: "/admin/users", label: "Users" },
          { to: "/admin/reports", label: "Reports" },
          { to: "/admin/chat", label: "Chat" },
        ]
      : [];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/70">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
      />

      <div className="flex h-16 w-full items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <button
            onClick={handleBrandClick}
            type="button"
            className="group flex items-center gap-2 rounded-md px-2 py-1 transition-all duration-300 hover:-translate-y-[1px]"
          >
            <span className="relative">
              <span className="absolute inset-0 -z-10 blur-lg opacity-0 group-hover:opacity-70 transition-opacity duration-300 bg-gradient-to-r from-primary/40 via-primary/20 to-transparent rounded-full" />
              <span className="text-xl font-bold bg-gradient-to-r from-primary via-primary to-primary/60 bg-clip-text text-transparent">
                RFQ System
              </span>
            </span>
          </button>

          {user && <NavBar items={navItems} />}
        </div>

        <div className="flex items-center gap-3">
          {user && (
            <>
              <div className="hidden md:flex flex-col items-end text-xs text-muted-foreground leading-tight">
                <span>Last refresh</span>
                <span className="font-medium text-foreground">
                  {lastRefreshLabel}
                </span>
              </div>

              <Button
                variant="outline"
                onClick={() => void refreshAll()}
                disabled={isRefreshing}
                className="gap-1.5"
              >
                <RefreshCcw
                  className={cn(
                    "h-3.5 w-3.5 transition-transform duration-500",
                    isRefreshing && "animate-spin"
                  )}
                />
                {isRefreshing ? "Refreshing…" : "Refresh"}
              </Button>

              <div className="text-sm text-muted-foreground hidden lg:block">
                Welcome, {user.name} ({user.role})
                {user.company && ` - ${user.company}`}
              </div>

              <Button variant="outline" onClick={handleLogout}>
                Logout
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
