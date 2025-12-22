import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-card/95 backdrop-blur">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-2">
          <a href="/dashboard" className="text-xl font-bold text-primary">
            RFQ System
          </a>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <>
              <div className="hidden md:flex items-center gap-2">
                <Button variant="ghost" onClick={() => navigate("/dashboard")}>
                  Dashboard
                </Button>

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
                      Admin
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => navigate("/admin/masters")}
                    >
                      Masters
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
