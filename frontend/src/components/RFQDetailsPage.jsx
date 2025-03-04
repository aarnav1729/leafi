import React, { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import moment from "moment";

const RFQDetailsPage = ({ userRole }) => {
  const { rfqId } = useParams();
  const navigate = useNavigate();

  // State declarations
  const [rfqDetails, setRfqDetails] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [rfqStatus, setRfqStatus] = useState("");
  const [leafiAllocation, setLeafiAllocation] = useState({ home: [], moowr: [] });
  const [homeAllocation, setHomeAllocation] = useState([]);
  const [moowrAllocation, setMoowrAllocation] = useState([]);
  const [totalHomePrice, setTotalHomePrice] = useState(0);
  const [totalMoowrPrice, setTotalMoowrPrice] = useState(0);
  const [allocationsComputed, setAllocationsComputed] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false);
  const [finalizeReason, setFinalizeReason] = useState("");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [activeTab, setActiveTab] = useState("details");

  // Conversion rate used for price computation
  const conversionRate = 80;

  // -------------------------------
  // Data Fetching Functions
  // -------------------------------
  const fetchRFQDetails = async () => {
    try {
      const response = await axios.get(`http://localhost:8000/api/rfqsi/${rfqId}`);
      setRfqDetails(response.data);
      setRfqStatus(response.data.status);
      if (response.data.status === "closed" && response.data.userAllocation) {
        if (
          Array.isArray(response.data.userAllocation.home) &&
          Array.isArray(response.data.userAllocation.moowr)
        ) {
          setHomeAllocation(response.data.userAllocation.home);
          setMoowrAllocation(response.data.userAllocation.moowr);
          calculateTotalHomePrice(response.data.userAllocation.home);
          calculateTotalMoowrPrice(response.data.userAllocation.moowr);
          setAllocationsComputed(true);
        }
      } else {
        setAllocationsComputed(false);
      }
    } catch (error) {
      console.error("Error fetching RFQ details:", error);
    }
  };

  const fetchQuotes = async () => {
    try {
      const response = await axios.get(`http://localhost:8000/api/quotesi/${rfqId}`);
      setQuotes(response.data);
    } catch (error) {
      console.error("Error fetching quotes:", error);
    }
  };

  const fetchVendors = async () => {
    try {
      const response = await axios.get("http://localhost:8000/api/inbound-vendors");
      setVendors(response.data);
    } catch (error) {
      console.error("Error fetching vendors:", error);
    }
  };

  useEffect(() => {
    fetchRFQDetails();
    fetchQuotes();
    fetchVendors();
  }, [rfqId]);

  // -------------------------------
  // Helper Functions
  // -------------------------------
  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString();
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleString();
  };

  // Compute total price for a quote for a given type (home or moowr)
  const computeTotals = (quote, type = "home") => {
    const seaFreightINR = parseFloat(quote.seaFreightPerContainer)
      ? parseFloat(quote.seaFreightPerContainer) * conversionRate
      : 0;
    if (type === "home") {
      return (
        seaFreightINR +
        (parseFloat(quote.houseDO) || 0) +
        (parseFloat(quote.cfs) || 0) +
        (parseFloat(quote.chaChargesHome) || 0) +
        (parseFloat(quote.transportation) || 0)
      );
    } else {
      return (
        seaFreightINR +
        (parseFloat(quote.houseDO) || 0) +
        (parseFloat(quote.cfs) || 0) +
        (parseFloat(quote.chaChargesMOOWR) || 0) +
        (parseFloat(quote.transportation) || 0)
      );
    }
  };

  // Compute combined LEAFI allocation from quotes
  const assignCombinedLeafiAllocation = (quotes, requiredContainers) => {
    const quotesWithTotals = quotes.map((q) => {
      const numContainers = Number(q.numberOfContainers) || 0;
      const homeTotal = computeTotals(q, "home");
      const moowrTotal = computeTotals(q, "moowr");
      const bestPrice = Math.min(homeTotal, moowrTotal);
      const allocatedType = homeTotal <= moowrTotal ? "home" : "moowr";
      return {
        ...q,
        numberOfContainers: numContainers,
        homeTotal,
        moowrTotal,
        bestPrice,
        allocatedType,
      };
    });
    const sorted = [...quotesWithTotals].sort((a, b) => a.bestPrice - b.bestPrice);
    let totalAllocated = 0;
    return sorted.map((q) => {
      let allocatedContainers = 0;
      if (totalAllocated < requiredContainers) {
        allocatedContainers = Math.min(q.numberOfContainers, requiredContainers - totalAllocated);
        totalAllocated += allocatedContainers;
      }
      return { ...q, allocatedContainers };
    });
  };

  // Recalculate labels for an allocation array
  const recalcLabels = (allocation, type = "home") => {
    const sorted = [...allocation].sort((a, b) => computeTotals(a, type) - computeTotals(b, type));
    return sorted.map((quote, index) => ({
      ...quote,
      label: `L${index + 1}`,
    }));
  };

  // Calculate total prices for allocations
  const calculateTotalHomePrice = (allocations) => {
    const total = allocations.reduce(
      (sum, alloc) => sum + ((alloc.price || 0) * (alloc.containersAllotted || 0)),
      0
    );
    setTotalHomePrice(total);
  };

  const calculateTotalMoowrPrice = (allocations) => {
    const total = allocations.reduce(
      (sum, alloc) => sum + ((alloc.price || 0) * (alloc.containersAllotted || 0)),
      0
    );
    setTotalMoowrPrice(total);
  };

  useEffect(() => {
    if (rfqDetails && quotes.length > 0 && vendors.length > 0) {
      const required = Number(rfqDetails.numberOfContainers) || 0;
      const combined = assignCombinedLeafiAllocation(quotes, required) || [];
      const computedLeafiHome = combined.map((q) => ({
        ...q,
        containersAllotted: q.allocatedType === "home" ? (q.allocatedContainers || 0) : 0,
        price: q.homeTotal || 0,
      }));
      const computedLeafiMoowr = combined.map((q) => ({
        ...q,
        containersAllotted: q.allocatedType === "moowr" ? (q.allocatedContainers || 0) : 0,
        price: q.moowrTotal || 0,
      }));
      setLeafiAllocation({ home: computedLeafiHome, moowr: computedLeafiMoowr });
      if (rfqDetails.status === "closed" && rfqDetails.userAllocation) {
        setHomeAllocation(rfqDetails.userAllocation.home);
        setMoowrAllocation(rfqDetails.userAllocation.moowr);
        calculateTotalHomePrice(rfqDetails.userAllocation.home);
        calculateTotalMoowrPrice(rfqDetails.userAllocation.moowr);
        setAllocationsComputed(true);
      } else if (!allocationsComputed) {
        setHomeAllocation(recalcLabels(computedLeafiHome, "home"));
        setMoowrAllocation(recalcLabels(computedLeafiMoowr, "moowr"));
        calculateTotalHomePrice(computedLeafiHome);
        calculateTotalMoowrPrice(computedLeafiMoowr);
        setAllocationsComputed(true);
      }
    }
  }, [rfqDetails, quotes, vendors, allocationsComputed]);

  const handleHomeInputChange = (index, field, value) => {
    if (rfqDetails && rfqDetails.status === "closed") return;
    setHomeAllocation((prev) => {
      const updated = [...prev];
      updated[index][field] = field === "price" ? parseFloat(value) : parseInt(value);
      const recalculated = recalcLabels(updated, "home");
      calculateTotalHomePrice(recalculated);
      return recalculated;
    });
  };

  const handleMoowrInputChange = (index, field, value) => {
    if (rfqDetails && rfqDetails.status === "closed") return;
    setMoowrAllocation((prev) => {
      const updated = [...prev];
      updated[index][field] = field === "price" ? parseFloat(value) : parseInt(value);
      const recalculated = recalcLabels(updated, "moowr");
      calculateTotalMoowrPrice(recalculated);
      return recalculated;
    });
  };

  const finalizeAllocation = async () => {
    const userTotalAllocated =
      homeAllocation.reduce((sum, a) => sum + (a.containersAllotted || 0), 0) +
      moowrAllocation.reduce((sum, a) => sum + (a.containersAllotted || 0), 0);
    if (userTotalAllocated !== Number(rfqDetails.numberOfContainers)) {
      alert(
        `Total containers allocated (${userTotalAllocated}) does not match required (${rfqDetails.numberOfContainers}).`
      );
      return;
    }
    const payload = {
      homeAllocation,
      moowrAllocation,
      finalizeReason: finalizeReason.trim(),
    };
    setIsFinalizing(true);
    try {
      await axios.post(`http://localhost:8000/api/rfqsi/${rfqId}/finalize-allocation`, payload);
      setStatusMessage("Allocation finalized and emails sent to vendors.");
      setIsFinalizeModalOpen(false);
      fetchRFQDetails();
      fetchQuotes();
    } catch (error) {
      console.error("Error finalizing allocation:", error);
      setStatusMessage("Failed to finalize allocation.");
    } finally {
      setIsFinalizing(false);
    }
  };

  const allContainersAllotted =
    rfqDetails &&
    (homeAllocation.reduce((sum, a) => sum + (a.containersAllotted || 0), 0) +
      moowrAllocation.reduce((sum, a) => sum + (a.containersAllotted || 0), 0) ===
      Number(rfqDetails.numberOfContainers));

  return (
    <div className="container mx-auto px-3 py-7 bg-white rounded-lg shadow-lg">
      <button
        className="mb-4 text-white bg-indigo-600 hover:bg-indigo-800 font-bold rounded-full p-2"
        onClick={() => navigate(-1)}
      >
        &larr; Back
      </button>

      {/* Tab Navigation */}
      <div className="flex justify-center mb-6">
        <button
          className={`px-4 py-2 mx-2 rounded-lg ${activeTab === "details" ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-800"}`}
          onClick={() => setActiveTab("details")}
        >
          RFQ Details
        </button>
        <button
          className={`px-4 py-2 mx-2 rounded-lg ${activeTab === "quotes" ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-800"}`}
          onClick={() => setActiveTab("quotes")}
        >
          Vendor Quotes &amp; Allocations
        </button>
      </div>

      {activeTab === "details" ? (
        rfqDetails ? (
          <div className="space-y-6">
            {/* RFQ Basic Details Section */}
            <div className="border p-4 rounded-lg">
              <h2 className="text-2xl font-bold mb-4">RFQ Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p><strong>RFQ Number:</strong> {rfqDetails.RFQNumber}</p>
                  <p><strong>Item Description:</strong> {rfqDetails.itemDescription}</p>
                  <p><strong>Company Name:</strong> {rfqDetails.companyName}</p>
                  <p><strong>PO Number:</strong> {rfqDetails.poNumber}</p>
                  <p><strong>Supplier Name:</strong> {rfqDetails.supplierName}</p>
                  <p><strong>Port of Loading:</strong> {rfqDetails.portOfLoading}</p>
                  <p><strong>Port of Destination:</strong> {rfqDetails.portOfDestination}</p>
                </div>
                <div>
                  <p><strong>Container Type:</strong> {rfqDetails.containerType}</p>
                  <p><strong># of Containers:</strong> {rfqDetails.numberOfContainers}</p>
                  <p><strong>Cargo Weight (tons):</strong> {rfqDetails.cargoWeightInContainer}</p>
                  <p><strong>Cargo Readiness Date:</strong> {formatDate(rfqDetails.cargoReadinessDate)}</p>
                  <p><strong>E-Reverse Enabled:</strong> {rfqDetails.eReverseToggle ? "Yes" : "No"}</p>
                  {rfqDetails.eReverseToggle && (
                    <>
                      <p><strong>E-Reverse Date:</strong> {formatDate(rfqDetails.eReverseDate)}</p>
                      <p><strong>E-Reverse Time:</strong> {rfqDetails.eReverseTime}</p>
                    </>
                  )}
                  <p><strong>Initial Quote End Time:</strong> {formatDateTime(rfqDetails.initialQuoteEndTime)}</p>
                  <p><strong>Evaluation End Time:</strong> {formatDateTime(rfqDetails.evaluationEndTime)}</p>
                  <p><strong>RFQ Closing Date:</strong> {formatDate(rfqDetails.RFQClosingDate)}</p>
                  <p><strong>RFQ Closing Time:</strong> {rfqDetails.RFQClosingTime}</p>
                </div>
              </div>
              <div className="mt-4">
                <p>
                  <strong>Selected Vendors:</strong>{" "}
                  {rfqDetails.selectedVendors && Array.isArray(rfqDetails.selectedVendors)
                    ? rfqDetails.selectedVendors.map((v) => v.vendorName).join(", ")
                    : "N/A"}
                </p>
              </div>
              {rfqDetails.finalizeReason && (
                <div className="mt-4">
                  <p><strong>Allocation Difference Reason:</strong> {rfqDetails.finalizeReason}</p>
                </div>
              )}
            </div>

            {/* Vendor Actions Section */}
            <div className="border p-4 rounded-lg">
              <h3 className="text-xl font-bold mb-2">Vendor Actions</h3>
              <table className="w-full divide-y divide-gray-300">
                <thead className="bg-gray-700 text-white">
                  <tr>
                    <th className="px-4 py-2">Action</th>
                    <th className="px-4 py-2">Vendor Name</th>
                    <th className="px-4 py-2">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {rfqDetails.vendorActions && rfqDetails.vendorActions.length > 0 ? (
                    rfqDetails.vendorActions.map((action, index) => (
                      <tr key={index} className="hover:bg-blue-100">
                        <td className="px-4 py-2">{action.action}</td>
                        <td className="px-4 py-2">{action.vendorId?.vendorName || "N/A"}</td>
                        <td className="px-4 py-2">
                          {action.timestamp ? new Date(action.timestamp).toLocaleString() : "N/A"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-4 py-2" colSpan="3">
                        No vendor actions recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* LEAFI Allocation Section */}
            <div className="border p-4 rounded-lg">
              <h3 className="text-xl font-bold mb-4">LEAFI Allocation</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* LEAFI CHA – Home */}
                <div>
                  <h4 className="font-bold mb-2">CHA – Home (LEAFI)</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full divide-y divide-gray-300">
                      <thead className="bg-green-600 text-white">
                        <tr>
                          <th className="px-2 py-1">Vendor Name</th>
                          <th className="px-2 py-1">Containers Offered</th>
                          <th className="px-2 py-1">Price</th>
                          <th className="px-2 py-1">Containers Allotted</th>
                          <th className="px-2 py-1">Label</th>
                          <th className="px-2 py-1">Total (INR)</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {(leafiAllocation.home || []).map((quote, index) => (
                          <tr key={quote._id || index} className="hover:bg-blue-100">
                            <td className="px-2 py-1">{quote.vendorName || quote.companyName}</td>
                            <td className="px-2 py-1">{quote.numberOfContainers}</td>
                            <td className="px-2 py-1">{quote.price}</td>
                            <td className="px-2 py-1">{quote.containersAllotted}</td>
                            <td className="px-2 py-1">{quote.label}</td>
                            <td className="px-2 py-1">{quote.price * quote.containersAllotted}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {/* LEAFI CHA – MOOWR */}
                <div>
                  <h4 className="font-bold mb-2">CHA – MOOWR (LEAFI)</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full divide-y divide-gray-300">
                      <thead className="bg-blue-600 text-white">
                        <tr>
                          <th className="px-2 py-1">Vendor Name</th>
                          <th className="px-2 py-1">Containers Offered</th>
                          <th className="px-2 py-1">Price</th>
                          <th className="px-2 py-1">Containers Allotted</th>
                          <th className="px-2 py-1">Label</th>
                          <th className="px-2 py-1">Total (INR)</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {(leafiAllocation.moowr || []).map((alloc, index) => (
                          <tr key={alloc._id || index} className="hover:bg-blue-100">
                            <td className="px-2 py-1">{alloc.vendorName}</td>
                            <td className="px-2 py-1">{alloc.numberOfContainers}</td>
                            <td className="px-2 py-1">{alloc.price}</td>
                            <td className="px-2 py-1">{alloc.containersAllotted}</td>
                            <td className="px-2 py-1">{alloc.label}</td>
                            <td className="px-2 py-1">{alloc.price * alloc.containersAllotted}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-center">Loading RFQ details</p>
        )
      ) : activeTab === "quotes" ? (
        <div className="space-y-6">
          {/* Vendor Quotes & Logistics Allocation Section */}
          <div className="border p-4 rounded-lg">
            <h3 className="text-xl font-bold mb-4">Vendor Quotes &amp; Logistics Allocation</h3>
            {quotes.length === 0 ? (
              <p className="text-center">No quotes available for this RFQ.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg mb-6">
                <table className="w-full divide-y divide-gray-300">
                  <thead className="bg-green-600 text-white">
                    <tr>
                      <th className="px-4 py-2">Vendor Name</th>
                      <th className="px-4 py-2"># of Trucks</th>
                      <th className="px-4 py-2">Quote</th>
                      <th className="px-4 py-2">Label</th>
                      <th className="px-4 py-2">Trucks Allotted</th>
                      <th className="px-4 py-2">Submitted At</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {quotes.map((quote) => (
                      <tr key={quote._id} className="hover:bg-blue-100">
                        <td className="px-4 py-2">{quote.vendorName}</td>
                        <td className="px-4 py-2">{quote.numberOfTrucks || "N/A"}</td>
                        <td className="px-4 py-2">
                          {userRole === "factory" ? (
                            <span className="blur-sm">Blurred</span>
                          ) : (
                            quote.price
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {userRole === "factory" ? (
                            <span className="blur-sm">Blurred</span>
                          ) : (
                            quote.label
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {userRole === "factory" ? (
                            <span className="blur-sm">Blurred</span>
                          ) : (
                            quote.trucksAllotted
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {quote.createdAt ? new Date(quote.createdAt).toLocaleString() : "N/A"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {statusMessage && (
        <div className="mt-6 text-center">
          <p className={`text-lg ${statusMessage.includes("Error") ? "text-red-600 font-bold" : "text-green-800 font-bold"}`}>
            {statusMessage}
          </p>
        </div>
      )}

      {/* Finalize Allocation Modal */}
      {isFinalizeModalOpen && (
        <div className="fixed z-50 inset-0 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen">
            <div className="bg-white p-6 rounded-lg shadow-lg w-3/4">
              <h2 className="text-xl font-bold mb-4">Finalize Allocation</h2>
              <p className="mb-2">
                If your allocation differs from the LEAFI allocation, please provide a reason:
              </p>
              <textarea
                value={finalizeReason}
                onChange={(e) => setFinalizeReason(e.target.value)}
                className="w-full p-2 border mb-4"
                rows="4"
              ></textarea>
              <div className="flex justify-end">
                <button
                  className="mr-4 bg-gray-300 hover:bg-gray-400 text-black py-2 px-4 rounded"
                  onClick={() => setIsFinalizeModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className={`bg-red-500 hover:bg-red-700 text-white py-2 px-4 rounded-lg ${
                    isFinalizing ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                  onClick={finalizeAllocation}
                  disabled={isFinalizing}
                >
                  {isFinalizing ? "Finalizing..." : "Finalize Allocation"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RFQDetailsPage;
