import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const RFQList = () => {
  const [rfqs, setRfqs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchRFQs();
    const intervalId = setInterval(fetchRFQs, 60000); // Refresh every 1 minute
    return () => clearInterval(intervalId);
  }, []);

  const fetchRFQs = async () => {
    try {
      const response = await axios.get('http://localhost:8000/api/rfqsi');
      setRfqs(response.data);
    } catch (error) {
      console.error('Error fetching RFQs:', error);
    }
  };

  const updateStatus = async (id, newStatus) => {
    try {
      // Update status using the appropriate endpoint (adjust if needed)
      await axios.patch(`http://localhost:8000/api/rfqsi/${id}`, { status: newStatus });
      setRfqs(prevRfqs =>
        prevRfqs.map(rfq =>
          rfq._id === id ? { ...rfq, status: newStatus } : rfq
        )
      );
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  // Format a date string into a locale date (without time)
  const formatDate = (dateString) => {
    if (!dateString) return "";
    return new Date(dateString).toLocaleDateString();
  };

  // Format a date-time string into a locale string with both date and time
  const formatDateTime = (dateTimeString) => {
    if (!dateTimeString) return "";
    return new Date(dateTimeString).toLocaleString();
  };

  // Filter RFQs based on search term and status filter
  const filteredRfqs = rfqs
    .filter((rfq) =>
      Object.values(rfq)
        .join(" ")
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    )
    .filter((rfq) =>
      filterStatus
        ? (rfq.status || "initial").toLowerCase() === filterStatus.toLowerCase()
        : true
    );

  return (
    <div className="container mx-auto mt-8 px-4 py-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold text-center mb-6">RFQ List</h2>
      <div className="mb-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <input
          type="text"
          placeholder="Search RFQs..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="text-black p-3 border bg-gray-200 border-blue-900 rounded w-full md:w-1/3"
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-black p-3 border bg-gray-200 border-blue-900 rounded w-full md:w-1/4"
        >
          <option value="">All Statuses</option>
          <option value="initial">Initial</option>
          <option value="evaluation">Evaluation</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-full divide-y divide-gray-300">
          <thead className="bg-green-600 text-white">
            <tr>
              <th className="px-4 py-2">Actions</th>
              <th className="px-4 py-2">RFQ Number</th>
              <th className="px-4 py-2">Item Description</th>
              <th className="px-4 py-2">Company Name</th>
              <th className="px-4 py-2">PO Number</th>
              <th className="px-4 py-2">Supplier Name</th>
              <th className="px-4 py-2">Port of Loading</th>
              <th className="px-4 py-2">Port of Destination</th>
              <th className="px-4 py-2">Container Type</th>
              <th className="px-4 py-2"># of Containers</th>
              <th className="px-4 py-2">Cargo Weight (tons)</th>
              <th className="px-4 py-2">Cargo Readiness Date</th>
              <th className="px-4 py-2">E-Reverse</th>
              <th className="px-4 py-2">E-Reverse Date</th>
              <th className="px-4 py-2">E-Reverse Time</th>
              <th className="px-4 py-2">Initial Quote End Time</th>
              <th className="px-4 py-2">Evaluation End Time</th>
              <th className="px-4 py-2">RFQ Closing Date</th>
              <th className="px-4 py-2">RFQ Closing Time</th>
              <th className="px-4 py-2">Selected Vendors</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredRfqs.map((rfq) => (
              <tr
                key={rfq._id}
                className="cursor-pointer hover:bg-blue-100"
                onClick={() => navigate(`/rfq/${rfq._id}`)}
              >
                <td className="px-4 py-2">
                  <select
                    value={rfq.status}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateStatus(rfq._id, e.target.value)}
                    className="p-1 border rounded"
                  >
                    <option value="initial">Initial</option>
                    <option value="evaluation">Evaluation</option>
                    <option value="closed">Closed</option>
                  </select>
                </td>
                <td className="px-4 py-2">{rfq.RFQNumber}</td>
                <td className="px-4 py-2">{rfq.itemDescription}</td>
                <td className="px-4 py-2">{rfq.companyName}</td>
                <td className="px-4 py-2">{rfq.poNumber}</td>
                <td className="px-4 py-2">{rfq.supplierName}</td>
                <td className="px-4 py-2">{rfq.portOfLoading}</td>
                <td className="px-4 py-2">{rfq.portOfDestination}</td>
                <td className="px-4 py-2">{rfq.containerType}</td>
                <td className="px-4 py-2">{rfq.numberOfContainers}</td>
                <td className="px-4 py-2">{rfq.cargoWeightInContainer}</td>
                <td className="px-4 py-2">{formatDate(rfq.cargoReadinessDate)}</td>
                <td className="px-4 py-2">{rfq.eReverseToggle ? "Yes" : "No"}</td>
                <td className="px-4 py-2">
                  {rfq.eReverseToggle ? formatDate(rfq.eReverseDate) : ""}
                </td>
                <td className="px-4 py-2">
                  {rfq.eReverseToggle ? rfq.eReverseTime : ""}
                </td>
                <td className="px-4 py-2">{formatDateTime(rfq.initialQuoteEndTime)}</td>
                <td className="px-4 py-2">{formatDateTime(rfq.evaluationEndTime)}</td>
                <td className="px-4 py-2">{formatDate(rfq.RFQClosingDate)}</td>
                <td className="px-4 py-2">{rfq.RFQClosingTime}</td>
                <td className="px-4 py-2">
                  {rfq.selectedVendors && Array.isArray(rfq.selectedVendors)
                    ? rfq.selectedVendors.join(", ")
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RFQList;