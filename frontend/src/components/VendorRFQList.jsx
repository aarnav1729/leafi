// VendorRFQList.jsx

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

// Create and export vendor RFQ list component
const VendorRFQList = ({ username }) => {
  const [rfqs, setRfqs] = useState([]);
  const [vendorQuotes, setVendorQuotes] = useState({});
  const navigate = useNavigate();

  // Fetch quotes submitted by the vendor using the new endpoint
  const fetchVendorQuotes = async () => {
    try {
      const response = await axios.get(`http://localhost:8000/api/quotesi/vendor/${username}`);
      // Assuming response.data is an array of quotes
      const quotesByVendor = response.data.reduce((acc, quote) => {
        acc[quote.rfqId] = quote;
        return acc;
      }, {});
      setVendorQuotes(quotesByVendor);
    } catch (error) {
      console.error("Error fetching vendor quotes:", error);
    }
  };

  // Fetch RFQs invited to the vendor using the new endpoint
  const fetchRFQs = async () => {
    try {
      const response = await axios.get(`http://localhost:8000/api/rfqsi/vendor/${username}`);
      setRfqs(response.data);
    } catch (error) {
      console.error("Error fetching RFQs for vendor:", error);
    }
  };

  // useEffect to fetch RFQs and vendor quotes
  useEffect(() => {
    fetchRFQs();
    fetchVendorQuotes();
  }, [username]);

  // Function to format dates to only show the date part
  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  return (
    <div className="container mx-auto mt-8 px-4 py-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold text-center mb-6">RFQ List</h2>

      {rfqs.length === 0 ? (
        <p className="text-center text-black">You have no RFQs at the moment.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 rounded-lg">
            <thead className="bg-green-600">
              <tr>
                {[
                  "Actions",
                  "RFQ Number",
                  "Item Description",
                  "Company Name",
                  "PO Number",
                  "Supplier Name",
                  "Port of Loading",
                  "Port of Destination",
                  "Container Type",
                  "Number of Containers",
                  "Cargo Weight (kg)",
                  "Cargo Readiness Date",
                  "Initial Quote End Time",
                  "Evaluation End Time",
                  "RFQ Closing Date",
                  "RFQ Closing Time",
                  "Status",
                ].map((header) => (
                  <th
                    key={header}
                    className="px-6 py-3 text-left text-sm font-bold uppercase tracking-wider text-white"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {rfqs.map((rfq) => (
                <tr
                  key={rfq._id}
                  className="cursor-pointer hover:bg-blue-100"
                >
                  {/* Actions */}
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {rfq.status !== "closed" ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/vendor-quote-form/${rfq._id}`);
                        }}
                        className="text-indigo-600 hover:text-indigo-900"
                      >
                        {vendorQuotes[rfq._id]
                          ? "Update Quote"
                          : "View & Quote"}
                      </button>
                    ) : (
                      <span className="text-gray-500">Closed</span>
                    )}
                  </td>

                  {/* RFQ Number */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {rfq.rfqNumber}
                  </td>

                  {/* Item Description */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {rfq.itemDescription}
                  </td>

                  {/* Company Name */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {rfq.companyName}
                  </td>

                  {/* PO Number */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {rfq.poNumber}
                  </td>

                  {/* Supplier Name */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {rfq.supplierName}
                  </td>

                  {/* Port of Loading */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {rfq.portOfLoading}
                  </td>

                  {/* Port of Destination */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {rfq.portOfDestination}
                  </td>

                  {/* Container Type */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {rfq.containerType}
                  </td>

                  {/* Number of Containers */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {rfq.numberOfContainers}
                  </td>

                  {/* Cargo Weight */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {rfq.cargoWeightInContainer}
                  </td>

                  {/* Cargo Readiness Date */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {formatDate(rfq.cargoReadinessDate)}
                  </td>

                  {/* Initial Quote End Time */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {formatDate(rfq.initialQuoteEndTime)}
                  </td>

                  {/* Evaluation End Time */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {formatDate(rfq.evaluationEndTime)}
                  </td>

                  {/* RFQ Closing Date */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {formatDate(rfq.rfqClosingDate)}
                  </td>

                  {/* RFQ Closing Time */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {rfq.rfqClosingTime}
                  </td>

                  {/* Status */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                    {rfq.status.charAt(0).toUpperCase() + rfq.status.slice(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default VendorRFQList;