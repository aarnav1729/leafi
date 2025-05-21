
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const Terms = () => {
  const navigate = useNavigate();

  return (
    <div className="container max-w-3xl py-12">
      <h1 className="text-3xl font-bold mb-6">Terms and Conditions</h1>
      
      <div className="prose">
        <h2 className="text-xl font-bold mt-6 mb-4">1. Introduction</h2>
        <p>
          Welcome to the RFQ (Request for Quotation) Management System. These Terms and Conditions govern your use of our application and the services we provide.
          By accessing or using the RFQ System, you agree to be bound by these Terms and Conditions.
        </p>
        
        <h2 className="text-xl font-bold mt-6 mb-4">2. Definitions</h2>
        <p>
          <strong>"RFQ System"</strong> refers to this web application for managing requests for quotations.
          <br />
          <strong>"User"</strong> refers to any party accessing or using the RFQ System, including logistics managers and vendors.
          <br />
          <strong>"RFQ"</strong> refers to a Request for Quotation created within the system.
        </p>
        
        <h2 className="text-xl font-bold mt-6 mb-4">3. User Accounts</h2>
        <p>
          Users are responsible for maintaining the confidentiality of their account credentials. Users are responsible for all activities that occur under their account.
          The company reserves the right to terminate accounts that violate these Terms and Conditions.
        </p>
        
        <h2 className="text-xl font-bold mt-6 mb-4">4. Use of the RFQ System</h2>
        <p>
          The RFQ System is provided for business purposes only. Users agree not to use the system for any unlawful purpose or in any way that might harm, disable, or impair the functioning of the system.
          Users must not attempt to gain unauthorized access to any part of the system or to any data contained within it.
        </p>
        
        <h2 className="text-xl font-bold mt-6 mb-4">5. Data Privacy</h2>
        <p>
          The company collects and processes user data in accordance with its Privacy Policy. By using the RFQ System, users consent to the collection and processing of their data as described in the Privacy Policy.
        </p>
        
        <h2 className="text-xl font-bold mt-6 mb-4">6. Modifications</h2>
        <p>
          The company reserves the right to modify these Terms and Conditions at any time. Users will be notified of significant changes. Continued use of the RFQ System after such modifications constitutes acceptance of the modified terms.
        </p>
      </div>
      
      <div className="mt-8">
        <Button onClick={() => navigate(-1)}>Back</Button>
      </div>
    </div>
  );
};

export default Terms;
