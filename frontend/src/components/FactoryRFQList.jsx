// FactoryRFQList.jsx

import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const FactoryRFQList = () => {
  const [rfqs, setRfqs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchRFQs();

    const intervalId = setInterval(fetchRFQs, 60000); // Poll every minute

    return () => clearInterval(intervalId);
  }, []);

  // Use the inbound RFQ endpoint (with full URL) so that all new fields are available
  const fetchRFQs = async () => {
    try {
      const response = await axios.get('http://localhost:8000/api/rfqsi');
      setRfqs(response.data);
    } catch (error) {
      console.error('Error fetching RFQs:', error);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const filteredRfqs = rfqs
    .filter((rfq) =>
      Object.values(rfq)
        .join(" ")
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    )
    .filter((rfq) =>
      filterStatus
        ? (rfq.status || "open").toLowerCase() === filterStatus.toLowerCase()
        : true
    );

  return (
    <div className="container mx-auto mt-8 px-4 py-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold text-center mb-6">RFQ List</h2>
      <div className="mb-4 flex flex-col md:flex-row justify-between items-center gap-4 rounded-lg">
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
      <div className="overflow-x-auto rounded">
        <table className="w-full min-w-full divide-y divide-gray-200">
          <thead className="bg-green-600">
            <tr>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">RFQ Number</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">Item Description</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">Company Name</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">PO Number</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">Supplier Name</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">Port of Loading</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">Port of Destination</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">Container Type</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">Number of Containers</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">Cargo Weight</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">Cargo Readiness Date</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">Initial Quote End Time</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">Evaluation End Time</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">RFQ Closing Date</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">RFQ Closing Time</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">Status</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">Finalize Reason</th>
              <th className="px-4 py-2 text-left text-sm font-bold text-white uppercase tracking-wider">L1 Price</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredRfqs.map((rfq) => (
              <tr
                key={rfq._id}
                onClick={() => navigate(`/eval-rfq/${rfq._id}`)}
                className="cursor-pointer hover:bg-blue-200"
              >
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.rfqNumber}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.itemDescription}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.companyName}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.poNumber}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.supplierName}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.portOfLoading}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.portOfDestination}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.containerType}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.numberOfContainers}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.cargoWeightInContainer}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{formatDate(rfq.cargoReadinessDate)}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{formatDate(rfq.initialQuoteEndTime)}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{formatDate(rfq.evaluationEndTime)}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{formatDate(rfq.rfqClosingDate)}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.rfqClosingTime}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.status}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.finalizeReason || "-"}</td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-black">{rfq.l1Price != null ? rfq.l1Price : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FactoryRFQList;