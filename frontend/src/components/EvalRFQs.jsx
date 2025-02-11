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
  const [homeAllocation, setHomeAllocation] = useState([]);
  const [moowrAllocation, setMoowrAllocation] = useState([]);
  const [totalHomePrice, setTotalHomePrice] = useState(0);
  const [totalMoowrPrice, setTotalMoowrPrice] = useState(0);
  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false);
  const [finalizeReason, setFinalizeReason] = useState("");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [evaluationPeriodEnded, setEvaluationPeriodEnded] = useState(false);
  const [enrichedQuotes, setEnrichedQuotes] = useState([]);

  // conversion rate from USD to INR
  const conversionRate = 80;

  // Use inbound endpoints on localhost
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

  // Enrich quotes with vendor companyName
  useEffect(() => {
    if (quotes.length > 0 && vendors.length > 0) {
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

  // When enriched quotes update, compute allocations for Home and MOOWR
  useEffect(() => {
    if (rfqDetails && enrichedQuotes.length > 0) {
      const homeAlloc = assignAllocation(enrichedQuotes, rfqDetails.numberOfContainers, "home");
      setHomeAllocation(homeAlloc);
      calculateTotalHomePrice(homeAlloc);

      const moowrAlloc = assignAllocation(enrichedQuotes, rfqDetails.numberOfContainers, "moowr");
      setMoowrAllocation(moowrAlloc);
      calculateTotalMoowrPrice(moowrAlloc);
    }
  }, [rfqDetails, enrichedQuotes]);

  // API calls
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
      // NEW: Fetch all inbound quotes for this RFQ using the correct endpoint.
      const response = await axios.get(`http://localhost:5000/api/quotesi/${rfqId}`);
      setQuotes(response.data);
    } catch (error) {
      console.error("Error fetching quotes:", error);
    }
  };

  const fetchVendors = async () => {
    try {
      const response = await axios.get("http://localhost:5000/api/vendors");
      setVendors(response.data);
    } catch (error) {
      console.error("Error fetching vendors:", error);
    }
  };

  // Compute totals for a given quote/allocation using the input values
  const computeTotals = (quote, type = "home") => {
    const seaFreightINR = parseFloat(quote.seaFreightPerContainer)
      ? parseFloat(quote.seaFreightPerContainer) * conversionRate
      : 0;
    if (type === "home") {
      const totalHome =
        seaFreightINR +
        (parseFloat(quote.houseDO) || 0) +
        (parseFloat(quote.cfs) || 0) +
        (parseFloat(quote.chaChargesHome) || 0) +
        (parseFloat(quote.transportation) || 0);
      return totalHome;
    } else {
      const totalMoowr =
        seaFreightINR +
        (parseFloat(quote.houseDO) || 0) +
        (parseFloat(quote.cfs) || 0) +
        (parseFloat(quote.chaChargesMOOWR) || 0) +
        (parseFloat(quote.transportation) || 0);
      return totalMoowr;
    }
  };

  // Allocation function (applies to both Home and MOOWR)
  // It sorts quotes (ascending) based on the computed total and assigns labels and allotments.
  const assignAllocation = (quotes, requiredContainers, type = "home") => {
    if (!requiredContainers || requiredContainers <= 0) return quotes;
    // Sort quotes based on total computed price (lower is better)
    const sortedQuotes = [...quotes].sort((a, b) => {
      const aTotal = computeTotals(a, type);
      const bTotal = computeTotals(b, type);
      return aTotal - bTotal;
    });
    let totalAllotted = 0;
    return sortedQuotes.map((quote, index) => {
      if (totalAllotted < requiredContainers) {
        // Allot as many containers as offered but do not exceed the requiredContainers
        const allot = Math.min(quote.numberOfContainers, requiredContainers - totalAllotted);
        totalAllotted += allot;
        return { ...quote, label: `L${index + 1}`, containersAllotted: allot };
      }
      return { ...quote, label: "-", containersAllotted: 0 };
    });
  };

  // Recalculate labels after manual update based on new totals
  const recalcLabels = (allocation, type = "home") => {
    const sorted = [...allocation].sort((a, b) => {
      const aTotal = computeTotals(a, type);
      const bTotal = computeTotals(b, type);
      return aTotal - bTotal;
    });
    return sorted.map((quote, index) => ({
      ...quote,
      label: `L${index + 1}`
    }));
  };

  // Calculate total prices for Home and MOOWR allocations
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

  // Handlers for manual changes in allocation inputs
  const handleHomeInputChange = (index, field, value) => {
    setHomeAllocation((prev) => {
      const updated = [...prev];
      updated[index][field] = field === "price" ? parseFloat(value) : parseInt(value);
      // Recalculate labels based on new totals
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

  // Finalize Allocation: Sends both home and moowr allocations to the backend
  const finalizeAllocation = async () => {
    // Prepare payload
    const payload = {
      homeAllocation,
      moowrAllocation,
      finalizeReason: finalizeReason.trim()
    };
    // If allocations differ, require a reason
    const homeData = homeAllocation.map((alloc) => ({
      vendorName: alloc.vendorName,
      containersAllotted: alloc.containersAllotted,
    }));
    const moowrData = moowrAllocation.map((alloc) => ({
      vendorName: alloc.vendorName,
      containersAllotted: alloc.containersAllotted,
    }));
    const isIdentical = JSON.stringify(homeData) === JSON.stringify(moowrData);
    if (!isIdentical && finalizeReason.trim() === "") {
      alert("Please provide a reason for the difference in allocation.");
      return;
    }
    setIsFinalizing(true);
    try {
      const response = await axios.post(
        `http://localhost:5000/api/rfqsi/${rfqId}/finalize-allocation`,
        payload
      );
      setStatusMessage("Allocation finalized and emails sent to vendors.");
      setIsFinalizeModalOpen(false);
    } catch (error) {
      console.error("Error finalizing allocation:", error);
      setStatusMessage("Failed to finalize allocation.");
    } finally {
      setIsFinalizing(false);
    }
  };

  // Check if the total allotted containers (in both tables) match the required number
  const totalAllottedHome = homeAllocation.reduce(
    (sum, alloc) => sum + (alloc.containersAllotted || 0),
    0
  );
  const totalAllottedMoowr = moowrAllocation.reduce(
    (sum, alloc) => sum + (alloc.containersAllotted || 0),
    0
  );
  const allContainersAllotted =
    totalAllottedHome === rfqDetails?.numberOfContainers &&
    totalAllottedMoowr === rfqDetails?.numberOfContainers;

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

          {/* Home Allocation Table */}
          <div>
            <h3 className="font-bold mb-2">Quotes with CHA – Home</h3>
            <div className="overflow-x-auto rounded-lg">
              <table className="min-w-full divide-y divide-black">
                <thead className="bg-green-600">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase tracking-wider">Vendor Name</th>
                    <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase tracking-wider">Containers Offered</th>
                    <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase tracking-wider">Price</th>
                    <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase tracking-wider">Containers Allotted</th>
                    <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase tracking-wider">Label</th>
                    <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase tracking-wider">Total (INR)</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-black">
                  {homeAllocation.map((quote, index) => (
                    <tr key={quote._id} className="hover:bg-blue-200">
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                        {quote.companyName || quote.vendorName}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                        {quote.numberOfContainers}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                        <input
                          type="number"
                          value={quote.price || ""}
                          onChange={(e) =>
                            handleHomeInputChange(index, "price", e.target.value)
                          }
                          className="p-1 border"
                        />
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                        <input
                          type="number"
                          value={quote.containersAllotted || ""}
                          onChange={(e) =>
                            handleHomeInputChange(index, "containersAllotted", e.target.value)
                          }
                          className="p-1 border"
                        />
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                        {quote.label}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                        {computeTotals(quote, "home")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2">
              <p className="text-right font-bold">
                Total CHA – Home Price: {totalHomePrice}
              </p>
            </div>
          </div>

          {/* MOOWR Allocation Table */}
          <div className="mt-8">
            <h3 className="font-bold mb-2">Quotes with CHA – MOOWR</h3>
            <div className="overflow-x-auto rounded-lg">
              <table className="min-w-full divide-y divide-black">
                <thead className="bg-blue-600">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase tracking-wider">Vendor Name</th>
                    <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase tracking-wider">Containers Offered</th>
                    <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase tracking-wider">Price</th>
                    <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase tracking-wider">Containers Allotted</th>
                    <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase tracking-wider">Label</th>
                    <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase tracking-wider">Total (INR)</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-black">
                  {moowrAllocation.map((alloc, index) => (
                    <tr key={index} className="hover:bg-blue-200">
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                        {alloc.vendorName}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                        {alloc.numberOfContainers}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                        <input
                          type="number"
                          value={alloc.price || ""}
                          onChange={(e) =>
                            handleMoowrInputChange(index, "price", e.target.value)
                          }
                          className="p-1 border"
                        />
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                        <input
                          type="number"
                          value={alloc.containersAllotted || ""}
                          onChange={(e) =>
                            handleMoowrInputChange(index, "containersAllotted", e.target.value)
                          }
                          className="p-1 border"
                        />
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                        {alloc.label}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                        {computeTotals(alloc, "moowr")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2">
              <p className="text-right font-bold">
                Total CHA – MOOWR Price: {totalMoowrPrice}
              </p>
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
                  <h2 className="text-xl font-bold mb-4">
                    Finalize Allocation
                  </h2>
                  <p className="mb-2">
                    If the allocation between CHA – Home and CHA – MOOWR differs, please provide a reason:
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
              <p
                className={`text-lg ${
                  statusMessage.includes("Error")
                    ? "text-red-600 font-bold"
                    : "text-green-800 font-bold"
                }`}
              >
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