
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartPie, FileText, Ship } from "lucide-react";

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect admin users to admin dashboard
    if (user?.role === "admin") {
      navigate("/admin/dashboard");
    }
  }, [user, navigate]);

  const handleNavigation = (path: string) => {
    navigate(path);
  };

  if (user?.role === "admin") {
    return null; // Prevent flash of content before redirect
  }

  if (user?.role === "logistics") {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Logistics Dashboard</h1>
        
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Manage RFQs</CardTitle>
              <CardDescription>Create and manage request for quotations</CardDescription>
            </CardHeader>
            <CardContent>
              <FileText className="h-16 w-16 text-primary mb-2" />
              <p>Manage all your RFQs in one place. Create new RFQs, view existing ones, and finalize allocations.</p>
            </CardContent>
            <CardFooter>
              <Button onClick={() => handleNavigation("/logistics/rfqs")} className="w-full">
                Go to RFQ Management
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  if (user?.role === "vendor") {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Vendor Dashboard</h1>
        
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Available RFQs</CardTitle>
              <CardDescription>View and quote on available RFQs</CardDescription>
            </CardHeader>
            <CardContent>
              <FileText className="h-16 w-16 text-primary mb-2" />
              <p>View all RFQs that have been shared with your company and submit your quotes.</p>
            </CardContent>
            <CardFooter>
              <Button onClick={() => handleNavigation("/vendor/rfqs")} className="w-full">
                View Available RFQs
              </Button>
            </CardFooter>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Allotted RFQs</CardTitle>
              <CardDescription>View RFQs that have been allotted to you</CardDescription>
            </CardHeader>
            <CardContent>
              <Ship className="h-16 w-16 text-primary mb-2" />
              <p>View all RFQs that have been allotted to your company for execution.</p>
            </CardContent>
            <CardFooter>
              <Button onClick={() => handleNavigation("/vendor/allotted")} className="w-full">
                View Allotted RFQs
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return null;
};

export default Dashboard;
