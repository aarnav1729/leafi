// EvalRFQs.jsx
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import moment from "moment";

const EvalRFQs = ({ userRole }) => {
  const { rfqId } = useParams();
  const navigate = useNavigate();

  const [rfqDetails, setRfqDetails] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [rfqStatus, setRfqStatus] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  // Editable (user) allocations – two separate tables
  const [homeAllocation, setHomeAllocation] = useState([]);
  const [moowrAllocation, setMoowrAllocation] = useState([]);

  // Read-only Leafi allocation – stored as an object with two arrays: home and moowr
  const [leafiAllocation, setLeafiAllocation] = useState({ home: [], moowr: [] });

  const [totalHomePrice, setTotalHomePrice] = useState(0);
  const [totalMoowrPrice, setTotalMoowrPrice] = useState(0);
  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false);
  const [finalizeReason, setFinalizeReason] = useState("");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [evaluationPeriodEnded, setEvaluationPeriodEnded] = useState(false);
  const [enrichedQuotes, setEnrichedQuotes] = useState([]);
  // Flag so that we compute allocations only once
  const [allocationsComputed, setAllocationsComputed] = useState(false);

  const conversionRate = 80;

  // --- Data fetching effects ---
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

  // Enrich quotes with vendor info (defensively check that quotes and vendors are arrays)
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

  // Compute combined Leafi allocation and initialize user allocation only once.
  useEffect(() => {
    try {
      if (rfqDetails && enrichedQuotes.length > 0 && !allocationsComputed) {
        const required = Number(rfqDetails.numberOfContainers) || 0;
        const combined = assignCombinedLeafiAllocation(enrichedQuotes, required) || [];
        // For display in Leafi section, split into two arrays:
        const leafiHome = combined.map((q) => ({
          ...q,
          // If allocated type is "home", use allocatedContainers; otherwise, 0
          containersAllotted: q.allocatedType === "home" ? (q.allocatedContainers || 0) : 0,
          price: q.homeTotal || 0,
        }));
        const leafiMoowr = combined.map((q) => ({
          ...q,
          containersAllotted: q.allocatedType === "moowr" ? (q.allocatedContainers || 0) : 0,
          price: q.moowrTotal || 0,
        }));
        setLeafiAllocation({ home: leafiHome, moowr: leafiMoowr });
        // Initialize the editable (user) allocations with the same data:
        setHomeAllocation(leafiHome.map((q) => ({ ...q })));
        setMoowrAllocation(leafiMoowr.map((q) => ({ ...q })));
        calculateTotalHomePrice(leafiHome);
        calculateTotalMoowrPrice(leafiMoowr);
        setAllocationsComputed(true);
      }
    } catch (err) {
      console.error("Error computing allocations:", err);
    }
  }, [rfqDetails, enrichedQuotes, allocationsComputed]);

  // --- Helper Functions ---

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

  // This function computes a combined allocation for Leafi.
  // It adds computed totals (homeTotal and moowrTotal) and then allocates containers
  // sequentially (using the lower price per quote) until the required number is reached.
  const assignCombinedLeafiAllocation = (quotes = [], requiredContainers) => {
    const quotesWithTotals = quotes.map((q) => {
      const numContainers = Number(q.numberOfContainers) || 0;
      const homeTotal = computeTotals(q, "home");
      const moowrTotal = computeTotals(q, "moowr");
      const bestPrice = Math.min(homeTotal, moowrTotal);
      const allocatedType = homeTotal <= moowrTotal ? "home" : "moowr";
      return { ...q, numberOfContainers: numContainers, homeTotal, moowrTotal, bestPrice, allocatedType };
    });
    // Sort by bestPrice in ascending order
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

  // Recalculate labels (for editable allocations)
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

  // Calculate total prices for each allocation array
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

  const handleHomeInputChange = (index, field, value) => {
    setHomeAllocation((prev) => {
      const updated = [...prev];
      updated[index][field] = field === "price" ? parseFloat(value) : parseInt(value);
      const recalculated = recalcLabels(updated, "home");
      calculateTotalHomePrice(recalculated);
      return recalculated;
    });
  };

  const handleMoowrInputChange = (index, field, value) => {
    setMoowrAllocation((prev) => {
      const updated = [...prev];
      updated[index][field] = field === "price" ? parseFloat(value) : parseInt(value);
      const recalculated = recalcLabels(updated, "moowr");
      calculateTotalMoowrPrice(recalculated);
      return recalculated;
    });
  };

  // Finalize allocation: the sum of user (editable) home + moowr allocations must equal required containers.
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
    // Compare user allocation with computed Leafi allocation
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
      await axios.post(`http://localhost:5000/api/rfqsi/${rfqId}/finalize-allocation`, payload);
      setStatusMessage("Allocation finalized and emails sent to vendors.");
      setIsFinalizeModalOpen(false);
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

  // --- API Call Functions ---
  const fetchRFQDetails = async () => {
    try {
      const response = await axios.get(`http://localhost:5000/api/rfqsi/${rfqId}`);
      setRfqDetails(response.data);
      setRfqStatus(response.data.status);
    } catch (error) {
      console.error("Error fetching RFQ details:", error);
    }
  };

  const fetchQuotes = async () => {
    try {
      const response = await axios.get(`http://localhost:5000/api/quotesi/${rfqId}`);
      setQuotes(response.data);
    } catch (error) {
      console.error("Error fetching quotes:", error);
    }
  };

  const fetchVendors = async () => {
    try {
      const response = await axios.get("http://localhost:5000/api/inbound-vendors");
      setVendors(response.data);
    } catch (error) {
      console.error("Error fetching vendors:", error);
    }
  };

  // --- Render JSX ---
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

          {/* Leafi Allocation Section (read-only) */}
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
                          <td className="px-4 py-2 whitespace-nowrap text-sm">{quote.numberOfContainers}</td>
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

          {/* User Allocation Section (editable) */}
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
          </div>

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
