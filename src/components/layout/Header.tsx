// root/src/components/layout/Header.tsx
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
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

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-card/95 backdrop-blur">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={handleBrandClick}
            className="text-xl font-bold text-primary"
            type="button"
          >
            RFQ System
          </button>
        </div>

        <div className="flex items-center gap-4">
          {user && (
            <>
              <div className="hidden md:flex items-center gap-2">
                {user.role === "logistics" && (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => navigate("/logistics/rfqs")}
                    >
                      RFQs
                    </Button>
                    <Button
                      variant="ghost"
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
                      onClick={() => navigate("/vendor/rfqs")}
                    >
                      RFQs
                    </Button>
                    <Button
                      variant="ghost"
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
                      onClick={() => navigate("/admin/dashboard")}
                    >
                      Dashboard
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => navigate("/admin/rfqs")}
                    >
                      RFQs
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => navigate("/admin/masters")}
                    >
                      Masters
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => navigate("/admin/users")}
                    >
                      Users
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
