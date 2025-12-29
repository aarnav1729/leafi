import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const Index = () => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/");
      return;
    }

    const role = user?.role;

    if (role === "logistics") navigate("/logistics/rfqs");
    else if (role === "vendor") navigate("/vendor/rfqs");
    else if (role === "admin") navigate("/admin/dashboard");
    else navigate("/");
  }, [isAuthenticated, user, navigate]);

  return null;
};

export default Index;
