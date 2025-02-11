// VendorQuoteForm.jsx
import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";

const VendorQuoteForm = ({ username }) => {
  const { rfqId } = useParams();
  const navigate = useNavigate();

  // Existing state variables
  const [numberOfContainers, setNumberOfContainers] = useState("");
  const [validityPeriod, setValidityPeriod] = useState("");
  const [rfqDetails, setRfqDetails] = useState(null);
  const [vendorQuote, setVendorQuote] = useState(null);
  const [vendorDetails, setVendorDetails] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [minContainersRequired, setMinContainersRequired] = useState(0);
  const [rfqStatus, setRfqStatus] = useState("");
  const [l1Price, setL1Price] = useState(null);
  const [message, setMessage] = useState(""); // Declare message once

  // New state variables for additional fields
  const [shippingLineName, setShippingLineName] = useState("");
  const [containerType, setContainerType] = useState("");
  const [vesselName, setVesselName] = useState("");
  const [vesselETD, setVesselETD] = useState("");
  const [vesselETA, setVesselETA] = useState("");
  const [seaFreightPerContainer, setSeaFreightPerContainer] = useState("");
  const [houseDO, setHouseDO] = useState("");
  const [cfs, setCfs] = useState("");
  const [transportation, setTransportation] = useState("");
  const [chaChargesHome, setChaChargesHome] = useState("");
  const [chaChargesMOOWR, setChaChargesMOOWR] = useState("");

  // New state for dynamically calculated totals
  const [totalCHAHome, setTotalCHAHome] = useState(0);
  const [totalCHAMOOWR, setTotalCHAMOOWR] = useState(0);

  // Example conversion rate from USD to INR
  const conversionRate = 80;

  useEffect(() => {
    const fetchRFQDetails = async () => {
      try {
        // Fetch the RFQ details
        const rfqResponse = await axios.get(`http://localhost:5000/api/rfqsi/${rfqId}`);
        setRfqDetails(rfqResponse.data);
        setRfqStatus(rfqResponse.data.status);
        setL1Price(rfqResponse.data.l1Price);
        const minContainers = Math.ceil(0.39 * rfqResponse.data.numberOfContainers);
        setMinContainersRequired(minContainers);
        // Automatically fill containerType from the RFQ details
        setContainerType(rfqResponse.data.containerType || "");

        // Fetch the vendor's existing quote (if any)
        const quoteResponse = await axios
          .get(`http://localhost:5000/api/quotesi/rfq/${rfqId}/vendor/${username}`)
          .catch((err) => {
            if (err.response && err.response.status === 404) {
              return { data: null };
            }
            throw err;
          });

        if (quoteResponse.data) {
          setVendorQuote(quoteResponse.data);
          setNumberOfContainers(quoteResponse.data.numberOfContainers);
          // validityPeriod now is a date (ISO string), take only the YYYY-MM-DD part
          setValidityPeriod(
            quoteResponse.data.validityPeriod
              ? quoteResponse.data.validityPeriod.substring(0, 10)
              : ""
          );
          setMessage(quoteResponse.data.message || "");
          setShippingLineName(quoteResponse.data.shippingLineName || "");
          // Ensure containerType remains as in the RFQ if not changed
          setContainerType(
            quoteResponse.data.containerType ||
              rfqResponse.data.containerType ||
              ""
          );
          setVesselName(quoteResponse.data.vesselName || "");
          // Vessel ETD and ETA now stored as date strings (YYYY-MM-DD)
          setVesselETD(
            quoteResponse.data.vesselETD
              ? quoteResponse.data.vesselETD.substring(0, 10)
              : ""
          );
          setVesselETA(
            quoteResponse.data.vesselETA
              ? quoteResponse.data.vesselETA.substring(0, 10)
              : ""
          );
          setSeaFreightPerContainer(
            quoteResponse.data.seaFreightPerContainer
              ? quoteResponse.data.seaFreightPerContainer.toString()
              : ""
          );
          setHouseDO(quoteResponse.data.houseDO || "");
          setCfs(quoteResponse.data.cfs || "");
          setTransportation(
            quoteResponse.data.transportation
              ? quoteResponse.data.transportation.toString()
              : ""
          );
          setChaChargesHome(
            quoteResponse.data.chaChargesHome
              ? quoteResponse.data.chaChargesHome.toString()
              : ""
          );
          setChaChargesMOOWR(
            quoteResponse.data.chaChargesMOOWR
              ? quoteResponse.data.chaChargesMOOWR.toString()
              : ""
          );
        }
      } catch (error) {
        console.error("Error fetching RFQ details or quote:", error);
        setErrors((prev) => ({
          ...prev,
          fetch: "Failed to fetch RFQ details or your existing quote.",
        }));
      }
    };

    const fetchVendorDetails = async () => {
      try {
        const vendorResponse = await axios.get(`http://localhost:5000/api/vendors/username/${username}`);
        setVendorDetails(vendorResponse.data);
      } catch (error) {
        console.error("Error fetching vendor details:", error);
        setErrors((prev) => ({
          ...prev,
          vendor: "Failed to fetch your vendor details.",
        }));
      }
    };

    fetchRFQDetails();
    fetchVendorDetails();
  }, [rfqId, username]);

  // Calculate dynamic totals when relevant fields change
  useEffect(() => {
    const seaFreightINR = parseFloat(seaFreightPerContainer)
      ? parseFloat(seaFreightPerContainer) * conversionRate
      : 0;
    // Parse transportation value
    const transportationVal = parseFloat(transportation) || 0;
    const totalHome =
      seaFreightINR +
      (parseFloat(houseDO) || 0) +
      (parseFloat(cfs) || 0) +
      (parseFloat(chaChargesHome) || 0) +
      transportationVal;
    const totalMOOWR =
      seaFreightINR +
      (parseFloat(houseDO) || 0) +
      (parseFloat(cfs) || 0) +
      (parseFloat(chaChargesMOOWR) || 0) +
      transportationVal;
    setTotalCHAHome(totalHome);
    setTotalCHAMOOWR(totalMOOWR);
  }, [
    seaFreightPerContainer,
    houseDO,
    cfs,
    chaChargesHome,
    chaChargesMOOWR,
    transportation,
    conversionRate,
  ]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    switch (name) {
      case "numberOfContainers":
        if (!/^\d*$/.test(value)) {
          setErrors((prev) => ({
            ...prev,
            numberOfContainers: "Number of Containers must contain only digits.",
          }));
        } else {
          setErrors((prev) => ({ ...prev, numberOfContainers: "" }));
        }
        setNumberOfContainers(value);
        break;
      case "validityPeriod":
        setValidityPeriod(value);
        break;
      case "message":
        setMessage(value);
        break;
      case "shippingLineName":
        setShippingLineName(value);
        break;
      case "containerType":
        setContainerType(value);
        break;
      case "vesselName":
        setVesselName(value);
        break;
      case "vesselETD":
        setVesselETD(value);
        break;
      case "vesselETA":
        setVesselETA(value);
        break;
      case "seaFreightPerContainer":
        if (!/^\d*\.?\d*$/.test(value)) {
          setErrors((prev) => ({
            ...prev,
            seaFreightPerContainer: "Sea Freight must be a valid number.",
          }));
        } else {
          setErrors((prev) => ({ ...prev, seaFreightPerContainer: "" }));
        }
        setSeaFreightPerContainer(value);
        break;
      case "houseDO":
        setHouseDO(value);
        break;
      case "cfs":
        setCfs(value);
        break;
      case "transportation":
        if (!/^\d*\.?\d*$/.test(value)) {
          setErrors((prev) => ({
            ...prev,
            transportation: "Transportation must be a valid number.",
          }));
        } else {
          setErrors((prev) => ({ ...prev, transportation: "" }));
        }
        setTransportation(value);
        break;
      case "chaChargesHome":
        if (!/^\d*\.?\d*$/.test(value)) {
          setErrors((prev) => ({
            ...prev,
            chaChargesHome: "CHA Charges must be a valid number.",
          }));
        } else {
          setErrors((prev) => ({ ...prev, chaChargesHome: "" }));
        }
        setChaChargesHome(value);
        break;
      case "chaChargesMOOWR":
        if (!/^\d*\.?\d*$/.test(value)) {
          setErrors((prev) => ({
            ...prev,
            chaChargesMOOWR: "CHA Charges must be a valid number.",
          }));
        } else {
          setErrors((prev) => ({ ...prev, chaChargesMOOWR: "" }));
        }
        setChaChargesMOOWR(value);
        break;
      default:
        break;
    }
  };

  const handleQuoteSubmit = async (e) => {
    e.preventDefault();
    setErrors({});
    let hasError = false;
    const newErrors = {};

    if (!numberOfContainers || numberOfContainers.trim() === "") {
      newErrors.numberOfContainers = "Number of Containers is required.";
      hasError = true;
    } else if (parseInt(numberOfContainers) < minContainersRequired) {
      newErrors.numberOfContainers = `At least ${minContainersRequired} containers are required.`;
      hasError = true;
    }
    if (!validityPeriod || validityPeriod.trim() === "") {
      newErrors.validityPeriod = "Till When is your Quote Valid is required.";
      hasError = true;
    }
    if (!shippingLineName || shippingLineName.trim() === "") {
      newErrors.shippingLineName = "Shipping Line Name is required.";
      hasError = true;
    }
    if (!containerType || containerType.trim() === "") {
      newErrors.containerType = "Container Type is required.";
      hasError = true;
    }
    if (!vesselName || vesselName.trim() === "") {
      newErrors.vesselName = "Vessel Name is required.";
      hasError = true;
    }
    if (!vesselETD || vesselETD.trim() === "") {
      newErrors.vesselETD = "Vessel ETD is required.";
      hasError = true;
    }
    if (!vesselETA || vesselETA.trim() === "") {
      newErrors.vesselETA = "Vessel ETA is required.";
      hasError = true;
    }
    if (!seaFreightPerContainer || seaFreightPerContainer.trim() === "") {
      newErrors.seaFreightPerContainer = "Sea Freight per container is required.";
      hasError = true;
    }
    if (!houseDO || houseDO.trim() === "") {
      newErrors.houseDO = "House DO is required.";
      hasError = true;
    }
    if (!cfs || cfs.trim() === "") {
      newErrors.cfs = "CFS is required.";
      hasError = true;
    }
    if (!transportation || transportation.trim() === "") {
      newErrors.transportation = "Transportation cost is required.";
      hasError = true;
    }
    if (!chaChargesHome || chaChargesHome.trim() === "") {
      newErrors.chaChargesHome = "CHA Charges (Home) is required.";
      hasError = true;
    }
    if (!chaChargesMOOWR || chaChargesMOOWR.trim() === "") {
      newErrors.chaChargesMOOWR = "CHA Charges (MOOWR) is required.";
      hasError = true;
    }
    // Message is optional.

    if (hasError) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);
    try {
      const quoteData = {
        rfqId,
        vendorName: username,
        numberOfContainers: Number(numberOfContainers),
        validityPeriod: new Date(validityPeriod),
        shippingLineName,
        containerType,
        vesselName,
        vesselETD: new Date(vesselETD),
        vesselETA: new Date(vesselETA),
        seaFreightPerContainer: Number(seaFreightPerContainer),
        houseDO,
        cfs,
        transportation: Number(transportation),
        chaChargesHome: Number(chaChargesHome),
        chaChargesMOOWR: Number(chaChargesMOOWR),
        message,
      };

      if (vendorQuote) {
        const updateResponse = await axios.put(
          `http://localhost:5000/api/quotesi/${vendorQuote._id}`,
          quoteData
        );
        alert("Quote updated successfully!");
        setVendorQuote(updateResponse.data.quote);
      } else {
        const submitResponse = await axios.post("http://localhost:5000/api/quotesi", quoteData);
        alert("Quote submitted successfully!");
        setVendorQuote(submitResponse.data.quote);
      }
      navigate("/vendor-rfq-list");
    } catch (error) {
      console.error("Error submitting/updating quote:", error);
      if (error.response?.data?.error) {
        setErrors({ submit: error.response.data.error });
      } else {
        setErrors({ submit: "Failed to submit/update quote. Please try again." });
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!rfqDetails) {
    return <div className="text-center mt-10">Loading...</div>;
  }

  // Improved renderRFQDetailsTable with updated styling
  const renderRFQDetailsTable = () => {
    return (
      <div className="mb-6">
        <h3 className="text-2xl font-bold mb-4">RFQ Details</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <tbody className="bg-white">
              {Object.entries(rfqDetails).map(([key, value]) => {
                const excludeFields = [
                  "_id",
                  "__v",
                  "createdAt",
                  "updatedAt",
                  "selectedVendors",
                  "vendorActions",
                ];
                if (excludeFields.includes(key)) return null;
                let displayValue = value;
                if (
                  typeof value === "string" &&
                  /^\d{4}-\d{2}-\d{2}T/.test(value)
                ) {
                  displayValue = value.substring(0, 10);
                }
                return (
                  <tr key={key} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-700 uppercase">
                      {key}
                    </td>
                    <td className="px-4 py-2 text-gray-900">
                      {(displayValue ?? "").toString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Render views based on RFQ status
  switch (rfqStatus) {
    case "initial":
      return renderInitialQuoteForm();
    case "evaluation":
      return renderEvaluationQuoteForm();
    case "closed":
      return renderClosedRFQMessage();
    default:
      return renderDefaultForm();
  }

  // Render initial quote submission form
  function renderInitialQuoteForm() {
    return (
      <div className="container mx-auto mt-8 px-4 py-6 bg-white rounded-lg shadow-lg">
        {renderRFQDetailsTable()}
        <h2 className="text-2xl font-bold text-center mb-6">
          Submit Quote for {rfqDetails.rfqNumber}
        </h2>
        <form onSubmit={handleQuoteSubmit} className="mt-4">
          {/* Number of Containers */}
          <div className="mb-4">
            <label className="block mb-1">Number of Containers</label>
            <input
              type="number"
              name="numberOfContainers"
              value={numberOfContainers}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded"
              required
              disabled={isLoading}
              min={minContainersRequired}
            />
            <p className="text-gray-600 text-sm mt-1">
              Please enter at least {minContainersRequired} containers.
            </p>
            {errors.numberOfContainers && (
              <p className="text-red-700 text-sm font-bold mt-1">
                {errors.numberOfContainers}
              </p>
            )}
          </div>

          {/* Shipping Line Name */}
          <div className="mb-4">
            <label className="block mb-1">Shipping Line Name</label>
            <input
              type="text"
              name="shippingLineName"
              value={shippingLineName}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded"
              required
            />
            {errors.shippingLineName && (
              <p className="text-red-700 text-sm font-bold mt-1">
                {errors.shippingLineName}
              </p>
            )}
          </div>

          {/* Container Type (auto-filled from RFQ) */}
          <div className="mb-4">
            <label className="block mb-1">Container Type</label>
            <input
              type="text"
              name="containerType"
              value={containerType}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded bg-gray-100"
              required
              readOnly
            />
            {errors.containerType && (
              <p className="text-red-700 text-sm font-bold mt-1">
                {errors.containerType}
              </p>
            )}
          </div>

          {/* Vessel Name */}
          <div className="mb-4">
            <label className="block mb-1">Vessel Name</label>
            <input
              type="text"
              name="vesselName"
              value={vesselName}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded"
              required
            />
            {errors.vesselName && (
              <p className="text-red-700 text-sm font-bold mt-1">
                {errors.vesselName}
              </p>
            )}
          </div>

          {/* Vessel ETD */}
          <div className="mb-4">
            <label className="block mb-1">Vessel ETD</label>
            <input
              type="date"
              name="vesselETD"
              value={vesselETD}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded"
              required
            />
            {errors.vesselETD && (
              <p className="text-red-700 text-sm font-bold mt-1">
                {errors.vesselETD}
              </p>
            )}
          </div>

          {/* Vessel ETA */}
          <div className="mb-4">
            <label className="block mb-1">Vessel ETA</label>
            <input
              type="date"
              name="vesselETA"
              value={vesselETA}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded"
              required
            />
            {errors.vesselETA && (
              <p className="text-red-700 text-sm font-bold mt-1">
                {errors.vesselETA}
              </p>
            )}
          </div>

          {/* Sea Freight Per Container (USD) */}
          <div className="mb-4">
            <label className="block mb-1">
              Sea Freight Per Container (USD)
            </label>
            <input
              type="number"
              step="0.01"
              name="seaFreightPerContainer"
              value={seaFreightPerContainer}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded"
              required
              min="0"
            />
            {errors.seaFreightPerContainer && (
              <p className="text-red-700 text-sm font-bold mt-1">
                {errors.seaFreightPerContainer}
              </p>
            )}
          </div>

          {/* House DO */}
          <div className="mb-4">
            <label className="block mb-1">
              House DO (Delivery Order) (INR)
            </label>
            <input
              type="text"
              name="houseDO"
              value={houseDO}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded"
              required
            />
            {errors.houseDO && (
              <p className="text-red-700 text-sm font-bold mt-1">
                {errors.houseDO}
              </p>
            )}
          </div>

          {/* CFS */}
          <div className="mb-4">
            <label className="block mb-1">
              CFS (Container Freight Station) (INR)
            </label>
            <input
              type="text"
              name="cfs"
              value={cfs}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded"
              required
            />
            {errors.cfs && (
              <p className="text-red-700 text-sm font-bold mt-1">
                {errors.cfs}
              </p>
            )}
          </div>

          {/* Transportation */}
          <div className="mb-4">
            <label className="block mb-1">
              Transportation from Chennai to Factory &amp; back to Chennai (INR)
            </label>
            <input
              type="number"
              step="0.01"
              name="transportation"
              value={transportation}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded"
              required
              min="0"
            />
            {errors.transportation && (
              <p className="text-red-700 text-sm font-bold mt-1">
                {errors.transportation}
              </p>
            )}
          </div>

          {/* CHA Charges (Home) */}
          <div className="mb-4">
            <label className="block mb-1">CHA Charges - Home (INR)</label>
            <input
              type="number"
              step="0.01"
              name="chaChargesHome"
              value={chaChargesHome}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded"
              required
              min="0"
            />
            {errors.chaChargesHome && (
              <p className="text-red-700 text-sm font-bold mt-1">
                {errors.chaChargesHome}
              </p>
            )}
          </div>

          {/* CHA Charges (MOOWR) */}
          <div className="mb-4">
            <label className="block mb-1">CHA Charges - MOOWR (INR)</label>
            <input
              type="number"
              step="0.01"
              name="chaChargesMOOWR"
              value={chaChargesMOOWR}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded"
              required
              min="0"
            />
            {errors.chaChargesMOOWR && (
              <p className="text-red-700 text-sm font-bold mt-1">
                {errors.chaChargesMOOWR}
              </p>
            )}
          </div>

          {/* Dynamic Totals */}
          <div className="mb-4">
            <p className="text-lg font-bold">
              Total with CHA - Home (INR): {totalCHAHome.toFixed(2)}
            </p>
            <p className="text-lg font-bold">
              Total with CHA - MOOWR (INR): {totalCHAMOOWR.toFixed(2)}
            </p>
          </div>

          {/* Till When is your Quote Valid */}
          <div className="mb-4">
            <label className="block mb-1">
              Till When is your Quote Valid
            </label>
            <input
              type="date"
              name="validityPeriod"
              value={validityPeriod}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded"
              required
            />
            {errors.validityPeriod && (
              <p className="text-red-700 text-sm font-bold mt-1">
                {errors.validityPeriod}
              </p>
            )}
          </div>

          {/* Message (Optional) */}
          <div className="mb-4">
            <label className="block mb-1">Message (Optional)</label>
            <textarea
              name="message"
              value={message}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded"
              disabled={isLoading}
              rows="4"
            />
          </div>

          {errors.submit && (
            <p className="text-red-700 text-sm font-bold mt-1">
              {errors.submit}
            </p>
          )}

          <button
            type="submit"
            className={`w-full p-2 bg-indigo-500 text-white rounded ${
              isLoading ? "cursor-not-allowed opacity-50" : ""
            }`}
            disabled={isLoading}
          >
            {isLoading
              ? "Submitting..."
              : vendorQuote
              ? "Update Quote"
              : "Submit Quote"}
          </button>
        </form>
      </div>
    );
  }

  // Render evaluation-phase view
  function renderEvaluationQuoteForm() {
    if (!vendorQuote) {
      return (
        <div className="container mx-auto mt-8 px-4 py-6 bg-white rounded-lg shadow-lg">
          <h2 className="text-2xl font-bold text-center mb-6">
            You did not submit an initial quote. You cannot update your quote now.
          </h2>
        </div>
      );
    }
    return renderInitialQuoteForm();
  }

  // Render closed RFQ message
  function renderClosedRFQMessage() {
    return (
      <div className="container mx-auto mt-8 px-4 py-6 bg-white rounded-lg shadow-lg">
        <h2 className="text-2xl font-bold text-center mb-6">
          The RFQ is closed. You cannot submit a quote.
        </h2>
      </div>
    );
  }

  // Default render
  function renderDefaultForm() {
    return renderInitialQuoteForm();
  }
};

export default VendorQuoteForm;