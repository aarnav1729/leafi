// EvalRFQs.jsx
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import moment from "moment";

const EvalRFQs = ({ userRole }) => {
  const { rfqId } = useParams();
  const navigate = useNavigate();

  // State declarations
  const [rfqDetails, setRfqDetails] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [rfqStatus, setRfqStatus] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  // Editable (user) allocations – two separate tables
  const [homeAllocation, setHomeAllocation] = useState([]);
  const [moowrAllocation, setMoowrAllocation] = useState([]);

  // Read-only Leafi allocation – computed from quotes
  const [leafiAllocation, setLeafiAllocation] = useState({ home: [], moowr: [] });

  const [totalHomePrice, setTotalHomePrice] = useState(0);
  const [totalMoowrPrice, setTotalMoowrPrice] = useState(0);
  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false);
  const [finalizeReason, setFinalizeReason] = useState("");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [evaluationPeriodEnded, setEvaluationPeriodEnded] = useState(false);
  const [enrichedQuotes, setEnrichedQuotes] = useState([]);
  // Flag to ensure we compute user allocations only once (if not finalized)
  const [allocationsComputed, setAllocationsComputed] = useState(false);

  const conversionRate = 80;

  // =========================
  // Helper Functions (Data Fetching)
  // =========================

  const fetchRFQDetails = async () => {
    try {
      const response = await axios.get(`http://localhost:8000/api/rfqsi/${rfqId}`);
      setRfqDetails(response.data);
      setRfqStatus(response.data.status);
      // If finalized and a stored userAllocation exists, load it
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
        // If not finalized, reset flag so that allocations are computed later.
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

  // =========================
  // Helper Functions (Computation)
  // =========================

  // Compute total price for a quote (for a given type)
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

  // Compute combined (Leafi) allocation from quotes
  const assignCombinedLeafiAllocation = (quotes = [], requiredContainers) => {
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
    const sorted = [...allocation].sort((a, b) => {
      const aTotal = computeTotals(a, type);
      const bTotal = computeTotals(b, type);
      return aTotal - bTotal;
    });
    return sorted.map((quote, index) => ({
      ...quote,
      label: `L${index + 1}`,
    }));
  };

  // Calculate total prices for allocations
  const calculateTotalHomePrice = (allocations) => {
    const total = allocations.reduce(
      (sum, alloc) => sum + (alloc.price ? alloc.price * (alloc.containersAllotted || 0) : 0),
      0
    );
    setTotalHomePrice(total);
  };

  const calculateTotalMoowrPrice = (allocations) => {
    const total = allocations.reduce(
      (sum, alloc) => sum + (alloc.price ? alloc.price * (alloc.containersAllotted || 0) : 0),
      0
    );
    setTotalMoowrPrice(total);
  };

  // =========================
  // useEffect Hooks
  // =========================

  useEffect(() => {
    fetchRFQDetails();
    fetchQuotes();
    fetchVendors();
  }, [rfqId]);

  useEffect(() => {
    if (rfqDetails) {
      const currentTime = new Date();
      const evaluationEndTime = new Date(rfqDetails.evaluationEndTime);
      setEvaluationPeriodEnded(currentTime >= evaluationEndTime);
    }
  }, [rfqDetails]);

  useEffect(() => {
    if (Array.isArray(quotes) && Array.isArray(vendors)) {
      const enriched = quotes.map((quote) => {
        const matchingVendor = vendors.find(
          (vendor) => vendor.vendorName === quote.vendorName
        );
        return {
          ...quote,
          companyName: matchingVendor
            ? matchingVendor.companyName || quote.vendorName
            : quote.vendorName,
        };
      });
      setEnrichedQuotes(enriched);
    }
  }, [quotes, vendors]);

  // Compute Leafi allocation and initialize user allocation if not finalized
  useEffect(() => {
    if (rfqDetails && enrichedQuotes.length > 0) {
      const required = Number(rfqDetails.numberOfContainers) || 0;
      const combined = assignCombinedLeafiAllocation(enrichedQuotes, required) || [];
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
        // If finalized, use stored userAllocation
        setHomeAllocation(rfqDetails.userAllocation.home);
        setMoowrAllocation(rfqDetails.userAllocation.moowr);
        calculateTotalHomePrice(rfqDetails.userAllocation.home);
        calculateTotalMoowrPrice(rfqDetails.userAllocation.moowr);
        setAllocationsComputed(true);
      } else if (!allocationsComputed) {
        // If not finalized, initialize user allocation with computed Leafi allocation
        setHomeAllocation(computedLeafiHome.map((q) => ({ ...q })));
        setMoowrAllocation(computedLeafiMoowr.map((q) => ({ ...q })));
        calculateTotalHomePrice(computedLeafiHome);
        calculateTotalMoowrPrice(computedLeafiMoowr);
        setAllocationsComputed(true);
      }
    }
  }, [rfqDetails, enrichedQuotes, allocationsComputed]);

  // =========================
  // Handlers for Input Changes
  // =========================

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

  // =========================
  // Finalization Handler
  // =========================

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
    // Optionally compare user allocation with computed Leafi allocation
    const userSummary = homeAllocation
      .concat(moowrAllocation)
      .map((alloc) => ({
        vendorName: alloc.vendorName,
        containersAllotted: alloc.containersAllotted,
      }));
    const leafiSummary = leafiAllocation.home
      .concat(leafiAllocation.moowr)
      .map((alloc) => ({
        vendorName: alloc.vendorName,
        containersAllotted: alloc.containersAllotted,
      }));
    const isIdentical = JSON.stringify(userSummary) === JSON.stringify(leafiSummary);
    if (!isIdentical && finalizeReason.trim() === "") {
      alert("Please provide a reason for the difference between your allocation and the Leafi allocation.");
      return;
    }
    setIsFinalizing(true);
    try {
      await axios.post(`http://localhost:8000/api/rfqsi/${rfqId}/finalize-allocation`, payload);
      setStatusMessage("Allocation finalized and emails sent to vendors.");
      setIsFinalizeModalOpen(false);
      // Refresh RFQ details and quotes so that the stored userAllocation and final status are loaded.
      fetchRFQDetails();
      fetchQuotes();
    } catch (error) {
      console.error("Error finalizing allocation:", error);
      setStatusMessage("Failed to finalize allocation.");
    } finally {
      setIsFinalizing(false);
    }
  };

  const userTotalAllocated =
    homeAllocation.reduce((sum, a) => sum + (a.containersAllotted || 0), 0) +
    moowrAllocation.reduce((sum, a) => sum + (a.containersAllotted || 0), 0);
  const allContainersAllotted = userTotalAllocated === Number(rfqDetails?.numberOfContainers);

  // =========================
  // Render JSX
  // =========================

  return (
    <div className="container mx-auto px-3 py-7 bg-white rounded-lg shadow-lg">
      <button
        className="mb-4 text-white bg-indigo-600 hover:bg-indigo-800 font-bold rounded-full p-2"
        onClick={() => navigate(-1)}
      >
        &larr; Back
      </button>
      {rfqDetails ? (
        <div>
          <h2 className="text-2xl font-bold mb-4">{rfqDetails.RFQNumber}</h2>

          {/* Leafi Allocation Section (Read-only) */}
          <div className="mb-8">
            <h3 className="text-xl font-bold mb-4">Leafi Allocation</h3>
            <div className="grid grid-cols-2 gap-4">
              {/* Leafi Home */}
              <div>
                <h4 className="font-bold mb-2">CHA – Home (Leafi)</h4>
                <div className="overflow-x-auto rounded-lg">
                  <table className="min-w-full divide-y divide-black">
                    <thead className="bg-green-600">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-bold">Vendor Name</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Containers Offered</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Price</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Containers Allotted</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Label</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Total (INR)</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-black">
                      {(leafiAllocation.home || []).map((quote, index) => (
                        <tr key={quote._id || index} className="hover:bg-blue-200">
                          <td className="px-4 py-2 whitespace-nowrap text-sm">
                            {quote.companyName || quote.vendorName}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">
                            {quote.numberOfContainers}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{quote.price}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{quote.containersAllotted}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{quote.label}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">
                            {quote.price * quote.containersAllotted}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Leafi MOOWR */}
              <div>
                <h4 className="font-bold mb-2">CHA – MOOWR (Leafi)</h4>
                <div className="overflow-x-auto rounded-lg">
                  <table className="min-w-full divide-y divide-black">
                    <thead className="bg-blue-600">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-bold">Vendor Name</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Containers Offered</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Price</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Containers Allotted</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Label</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Total (INR)</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-black">
                      {(leafiAllocation.moowr || []).map((alloc, index) => (
                        <tr key={alloc._id || index} className="hover:bg-blue-200">
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{alloc.vendorName}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{alloc.numberOfContainers}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{alloc.price}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{alloc.containersAllotted}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{alloc.label}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">
                            {alloc.price * alloc.containersAllotted}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* User Allocation Section (Editable) */}
          <div className="mb-8">
            <h3 className="text-xl font-bold mb-4">User Allocation</h3>
            <div className="grid grid-cols-2 gap-4">
              {/* User Home */}
              <div>
                <h4 className="font-bold mb-2">CHA – Home (User)</h4>
                <div className="overflow-x-auto rounded-lg">
                  <table className="min-w-full divide-y divide-black">
                    <thead className="bg-green-600">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-bold">Vendor Name</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Containers Offered</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Price</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Containers Allotted</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Label</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Total (INR)</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-black">
                      {homeAllocation.map((quote, index) => (
                        <tr key={quote._id || index} className="hover:bg-blue-200">
                          <td className="px-4 py-2 whitespace-nowrap text-sm">
                            {quote.companyName || quote.vendorName}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{quote.numberOfContainers}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">
                            <input
                              type="number"
                              value={quote.price || ""}
                              onChange={(e) =>
                                handleHomeInputChange(index, "price", e.target.value)
                              }
                              className="p-1 border"
                              disabled={rfqDetails?.status === "closed"}
                            />
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">
                            <input
                              type="number"
                              value={quote.containersAllotted || ""}
                              onChange={(e) =>
                                handleHomeInputChange(index, "containersAllotted", e.target.value)
                              }
                              className="p-1 border"
                              disabled={rfqDetails?.status === "closed"}
                            />
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{quote.label}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">
                            {quote.price * quote.containersAllotted}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2">
                  <p className="text-right font-bold">Total CHA – Home Price: {totalHomePrice}</p>
                </div>
              </div>
              {/* User MOOWR */}
              <div>
                <h4 className="font-bold mb-2">CHA – MOOWR (User)</h4>
                <div className="overflow-x-auto rounded-lg">
                  <table className="min-w-full divide-y divide-black">
                    <thead className="bg-blue-600">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-bold">Vendor Name</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Containers Offered</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Price</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Containers Allotted</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Label</th>
                        <th className="px-4 py-2 text-left text-sm font-bold">Total (INR)</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-black">
                      {moowrAllocation.map((alloc, index) => (
                        <tr key={alloc._id || index} className="hover:bg-blue-200">
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{alloc.vendorName}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{alloc.numberOfContainers}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">
                            <input
                              type="number"
                              value={alloc.price || ""}
                              onChange={(e) =>
                                handleMoowrInputChange(index, "price", e.target.value)
                              }
                              className="p-1 border"
                              disabled={rfqDetails?.status === "closed"}
                            />
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">
                            <input
                              type="number"
                              value={alloc.containersAllotted || ""}
                              onChange={(e) =>
                                handleMoowrInputChange(index, "containersAllotted", e.target.value)
                              }
                              className="p-1 border"
                              disabled={rfqDetails?.status === "closed"}
                            />
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{alloc.label}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-sm">
                            {alloc.price * alloc.containersAllotted}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2">
                  <p className="text-right font-bold">Total CHA – MOOWR Price: {totalMoowrPrice}</p>
                </div>
              </div>
            </div>
            {/* Net Total */}
            <div className="mt-4">
              <p className="text-right font-bold">Net Total: {totalHomePrice + totalMoowrPrice}</p>
            </div>
          </div>

          {/* Finalize Button (only if RFQ is not closed) */}
          {rfqDetails.status !== "closed" && (
            <div className="mt-6 flex justify-center">
              <button
                className={`text-white bg-red-500 hover:bg-red-700 font-bold py-2 px-4 rounded-full ml-2 ${
                  allContainersAllotted ? "" : "opacity-50 cursor-not-allowed"
                }`}
                onClick={() => setIsFinalizeModalOpen(true)}
                disabled={!allContainersAllotted}
              >
                Finalize Allocation
              </button>
            </div>
          )}

          {isFinalizeModalOpen && (
            <div className="fixed z-50 inset-0 overflow-y-auto">
              <div className="flex items-center justify-center min-h-screen">
                <div className="bg-white p-6 rounded-lg shadow-lg w-3/4">
                  <h2 className="text-xl font-bold mb-4">Finalize Allocation</h2>
                  <p className="mb-2">
                    If your allocation differs from the Leafi (best pricing) allocation, please provide a reason:
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

          {statusMessage && (
            <div className="mt-6 text-center">
              <p className={`text-lg ${statusMessage.includes("Error") ? "text-red-600 font-bold" : "text-green-800 font-bold"}`}>
                {statusMessage}
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-center text-black">Loading RFQ details...</p>
      )}
    </div>
  );
};

export default EvalRFQs;