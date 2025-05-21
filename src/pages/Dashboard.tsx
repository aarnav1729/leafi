
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useData } from "@/contexts/DataContext";

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { getUserRFQs, getVendorRFQs, getVendorAllottedRFQs } = useData();

  if (user?.role === "logistics") {
    const rfqs = getUserRFQs();
    const initialRfqs = rfqs.filter(rfq => rfq.status === "initial").length;
    const evaluationRfqs = rfqs.filter(rfq => rfq.status === "evaluation").length;
    const closedRfqs = rfqs.filter(rfq => rfq.status === "closed").length;

    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Logistics Dashboard</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Initial RFQs</CardTitle>
              <CardDescription>Waiting for vendor quotes</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold">{initialRfqs}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Evaluation RFQs</CardTitle>
              <CardDescription>Ready for evaluation</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold">{evaluationRfqs}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Closed RFQs</CardTitle>
              <CardDescription>Finalized quotes</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold">{closedRfqs}</p>
            </CardContent>
          </Card>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Manage RFQs</CardTitle>
              <CardDescription>View and manage all your RFQs</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Access your RFQ list to create new RFQs, review vendor quotes, and finalize decisions.</p>
            </CardContent>
            <CardFooter className="flex justify-start">
              <Button onClick={() => navigate("/logistics/rfqs")}>View RFQ List</Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  if (user?.role === "vendor") {
    const allRfqs = getVendorRFQs();
    const openRfqs = allRfqs.filter(rfq => rfq.status !== "closed").length;
    const allottedRfqs = getVendorAllottedRFQs().length;

    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Vendor Dashboard</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Open RFQs</CardTitle>
              <CardDescription>Open for quoting</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold">{openRfqs}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Allotted RFQs</CardTitle>
              <CardDescription>Containers allotted to your quotes</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold">{allottedRfqs}</p>
            </CardContent>
          </Card>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>RFQ List</CardTitle>
              <CardDescription>View all RFQs and submit quotes</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Access the RFQ list to view available requests and submit your quotes.</p>
            </CardContent>
            <CardFooter className="flex justify-start">
              <Button onClick={() => navigate("/vendor/rfqs")}>View RFQs</Button>
            </CardFooter>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Allotted RFQs</CardTitle>
              <CardDescription>View RFQs that have been allotted to you</CardDescription>
            </CardHeader>
            <CardContent>
              <p>See details of RFQs where containers have been allotted to your quotes.</p>
            </CardContent>
            <CardFooter className="flex justify-start">
              <Button onClick={() => navigate("/vendor/allotted")}>View Allotted RFQs</Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center py-20">
      <h2 className="text-2xl font-bold mb-4">Welcome to the RFQ System</h2>
      <p className="text-muted-foreground mb-6">Please log in to access your dashboard.</p>
      <Button onClick={() => navigate("/")}>Back to Login</Button>
    </div>
  );
};

export default Dashboard;
