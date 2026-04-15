// root/src/components/layout/Header.tsx
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { useLocation, useNavigate } from "react-router-dom";

function getHomeForRole(role?: string) {
  if (role === "logistics") return "/logistics/rfqs";
  if (role === "vendor") return "/vendor/rfqs";
  if (role === "admin") return "/admin/dashboard";
  return "/";
}

export function Header() {
  const { user, logout } = useAuth();
  const { refreshAll, lastRefreshedAt, isRefreshing } = useData();
  const navigate = useNavigate();
  const location = useLocation();

  // If someone lands on /app, route them to their role homepage.
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
    // always go to /app; /app will redirect to role home
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

  const navButtonClass = (active: boolean) =>
    [
      "relative overflow-hidden transition-all duration-300 ease-out hover:-translate-y-0.5",
      "before:absolute before:inset-0 before:rounded-md before:opacity-0 before:transition-opacity before:duration-300",
      active
        ? "text-primary-foreground bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 shadow-md before:opacity-100"
        : "text-foreground/85 hover:text-foreground hover:bg-gradient-to-r hover:from-indigo-500/15 hover:to-fuchsia-500/15",
    ].join(" ");

  const isActivePath = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-card/95 backdrop-blur">
      <div className="flex h-16 w-full items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <button
            onClick={handleBrandClick}
            className="bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 bg-clip-text text-xl font-bold text-transparent transition-transform duration-300 hover:scale-[1.02]"
            type="button"
          >
            RFQ System
          </button>
        </div>

        <div className="flex items-center gap-4">
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
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </Button>

              <div className="hidden md:flex items-center gap-2">
                {user.role === "logistics" && (
                  <>
                    <Button
                      variant="ghost"
                      className={navButtonClass(isActivePath("/logistics/rfqs"))}
                      onClick={() => navigate("/logistics/rfqs")}
                    >
                      RFQs
                    </Button>
                    <Button
                      variant="ghost"
                      className={navButtonClass(
                        isActivePath("/logistics/masters")
                      )}
                      onClick={() => navigate("/logistics/masters")}
                    >
                      Masters
                    </Button>
                  </>
                )}

                {user.role === "vendor" && (
                  <>
                    <Button
                      variant="ghost"
                      className={navButtonClass(isActivePath("/vendor/rfqs"))}
                      onClick={() => navigate("/vendor/rfqs")}
                    >
                      RFQs
                    </Button>
                    <Button
                      variant="ghost"
                      className={navButtonClass(isActivePath("/vendor/allotted"))}
                      onClick={() => navigate("/vendor/allotted")}
                    >
                      Allotted
                    </Button>
                  </>
                )}

                {user.role === "admin" && (
                  <>
                    <Button
                      variant="ghost"
                      className={navButtonClass(
                        isActivePath("/admin/dashboard")
                      )}
                      onClick={() => navigate("/admin/dashboard")}
                    >
                      Dashboard
                    </Button>
                    <Button
                      variant="ghost"
                      className={navButtonClass(isActivePath("/admin/rfqs"))}
                      onClick={() => navigate("/admin/rfqs")}
                    >
                      RFQs
                    </Button>
                    <Button
                      variant="ghost"
                      className={navButtonClass(isActivePath("/admin/masters"))}
                      onClick={() => navigate("/admin/masters")}
                    >
                      Masters
                    </Button>
                    <Button
                      variant="ghost"
                      className={navButtonClass(isActivePath("/admin/users"))}
                      onClick={() => navigate("/admin/users")}
                    >
                      Users
                    </Button>
                    <Button
                      variant="ghost"
                      className={navButtonClass(isActivePath("/admin/reports"))}
                      onClick={() => navigate("/admin/reports")}
                    >
                      Reports
                    </Button>
                    <Button
                      variant="ghost"
                      className={navButtonClass(isActivePath("/admin/chat"))}
                      onClick={() => navigate("/admin/chat")}
                    >
                      Chat
                    </Button>
                  </>
                )}
              </div>

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
