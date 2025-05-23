// root/src/pages/vendor/AllottedRFQ.tsx
import React from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Card } from "@/components/ui/card";

const VendorAllottedRFQs: React.FC = () => {
  const { user } = useAuth();
  const {
    getVendorAllottedRFQs,
    getAllocationsByRFQId,
    getRFQById,
    getQuotesByRFQId,
  } = useData();

  const allottedRFQs = getVendorAllottedRFQs().sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Allotted RFQs</h1>
      </div>

      {allottedRFQs.length === 0 ? (
        <Card className="p-6 text-center">
          <p>
            No allotted RFQs found. When a logistics manager allocates
            containers to your quotes, they will appear here.
          </p>
        </Card>
      ) : (
        allottedRFQs.map((rfq) => {
          const allAllocs = getAllocationsByRFQId(rfq.id).filter(
            (a) => a.vendorName === user?.company
          );
          const quotes = getQuotesByRFQId(rfq.id);

          // Precompute per-quote sums of Home & MOOWR
          const quoteSums: Record<
            string,
            { home: number; moowr: number }
          > = {};
          for (const q of quotes) {
            quoteSums[q.id] = { home: 0, moowr: 0 };
          }
          for (const a of allAllocs) {
            if (quoteSums[a.quoteId]) {
              quoteSums[a.quoteId].home += a.containersAllottedHome;
              quoteSums[a.quoteId].moowr += a.containersAllottedMOOWR;
            }
          }

          return (
            <Card key={rfq.id} className="p-6 space-y-6">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold">
                    RFQ #{rfq.rfqNumber}
                  </h2>
                  <p className="text-muted-foreground">
                    {rfq.itemDescription} - {rfq.companyName}
                  </p>
                </div>
                <StatusBadge status={rfq.status} />
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Supplier:</span>{" "}
                  {rfq.supplierName}
                </div>
                <div>
                  <span className="font-medium">Material PO:</span>{" "}
                  {rfq.materialPONumber}
                </div>
                <div>
                  <span className="font-medium">Port of Loading:</span>{" "}
                  {rfq.portOfLoading}
                </div>
                <div>
                  <span className="font-medium">Port of Destination:</span>{" "}
                  {rfq.portOfDestination}
                </div>
                <div>
                  <span className="font-medium">Container Type:</span>{" "}
                  {rfq.containerType}
                </div>
                <div>
                  <span className="font-medium">Total Containers:</span>{" "}
                  {rfq.numberOfContainers}
                </div>
                <div>
                  <span className="font-medium">Cargo Weight:</span>{" "}
                  {rfq.cargoWeight} tons
                </div>
                <div>
                  <span className="font-medium">Cargo Readiness:</span>{" "}
                  {new Date(rfq.cargoReadinessDate).toLocaleDateString()}
                </div>
              </div>

              <div className="border-t pt-4 mt-4 space-y-6">
                {quotes.map((quote) => {
                  const sums = quoteSums[quote.id];
                  // skip entirely if nothing allotted under either scheme
                  if (!sums.home && !sums.moowr) return null;

                  const seaINR =
                    quote.seaFreightPerContainer * 75;

                  return (
                    <div
                      key={quote.id}
                      className="space-y-4"
                    >
                      <h3 className="font-medium">
                        Quote by {quote.vendorName}
                      </h3>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* CHA-Home */}
                        {sums.home > 0 && (
                          <table className="w-full data-table">
                            <thead>
                              <tr>
                                <th colSpan={2}>
                                  CHA-Home Details
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className="font-medium">
                                  Containers Allotted
                                </td>
                                <td>{sums.home}</td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Container Type
                                </td>
                                <td>{quote.containerType}</td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Shipping Line
                                </td>
                                <td>
                                  {quote.shippingLineName}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Vessel
                                </td>
                                <td>{quote.vesselName}</td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Vessel ETD
                                </td>
                                <td>
                                  {new Date(
                                    quote.vesselETD
                                  ).toLocaleDateString()}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Vessel ETA
                                </td>
                                <td>
                                  {new Date(
                                    quote.vesselETA
                                  ).toLocaleDateString()}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Sea Freight
                                </td>
                                <td>
                                  USD{" "}
                                  {quote.seaFreightPerContainer.toFixed(
                                    2
                                  )}{" "}
                                  (₹
                                  {seaINR.toFixed(2)})
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  House Delivery Order
                                </td>
                                <td>
                                  ₹
                                  {quote.houseDeliveryOrderPerBOL.toFixed(
                                    2
                                  )}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  CFS
                                </td>
                                <td>
                                  ₹
                                  {quote.cfsPerContainer.toFixed(
                                    2
                                  )}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Transportation
                                </td>
                                <td>
                                  ₹
                                  {quote.transportationPerContainer.toFixed(
                                    2
                                  )}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  EDI Charges
                                </td>
                                <td>
                                  ₹
                                  {quote.ediChargesPerBOE.toFixed(
                                    2
                                  )}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  CHA-Home Charges
                                </td>
                                <td>
                                  ₹
                                  {quote.chaChargesHome.toFixed(
                                    2
                                  )}
                                </td>
                              </tr>
                              <tr className="bg-muted/20">
                                <td className="font-bold">
                                  Total (per container)
                                </td>
                                <td className="font-bold">
                                  ₹
                                  {(
                                    seaINR +
                                    quote.houseDeliveryOrderPerBOL +
                                    quote.cfsPerContainer +
                                    quote.transportationPerContainer +
                                    quote.ediChargesPerBOE +
                                    quote.chaChargesHome
                                  ).toFixed(2)}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        )}

                        {/* CHA-MOOWR */}
                        {sums.moowr > 0 && (
                          <table className="w-full data-table">
                            <thead>
                              <tr>
                                <th colSpan={2}>
                                  CHA-MOOWR Details
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className="font-medium">
                                  Containers Allotted
                                </td>
                                <td>{sums.moowr}</td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Container Type
                                </td>
                                <td>{quote.containerType}</td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Shipping Line
                                </td>
                                <td>
                                  {quote.shippingLineName}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Vessel
                                </td>
                                <td>{quote.vesselName}</td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Vessel ETD
                                </td>
                                <td>
                                  {new Date(
                                    quote.vesselETD
                                  ).toLocaleDateString()}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Vessel ETA
                                </td>
                                <td>
                                  {new Date(
                                    quote.vesselETA
                                  ).toLocaleDateString()}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Sea Freight
                                </td>
                                <td>
                                  USD{" "}
                                  {quote.seaFreightPerContainer.toFixed(
                                    2
                                  )}{" "}
                                  (₹
                                  {seaINR.toFixed(2)})
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  House Delivery Order
                                </td>
                                <td>
                                  ₹
                                  {quote.houseDeliveryOrderPerBOL.toFixed(
                                    2
                                  )}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  CFS
                                </td>
                                <td>
                                  ₹
                                  {quote.cfsPerContainer.toFixed(
                                    2
                                  )}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  Transportation
                                </td>
                                <td>
                                  ₹
                                  {quote.transportationPerContainer.toFixed(
                                    2
                                  )}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  EDI Charges
                                </td>
                                <td>
                                  ₹
                                  {quote.ediChargesPerBOE.toFixed(
                                    2
                                  )}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  MOOWR Re-Warehousing
                                </td>
                                <td>
                                  ₹
                                  {quote.mooWRReeWarehousingCharges.toFixed(
                                    2
                                  )}
                                </td>
                              </tr>
                              <tr>
                                <td className="font-medium">
                                  CHA-MOOWR Charges
                                </td>
                                <td>
                                  ₹
                                  {quote.chaChargesMOOWR.toFixed(
                                    2
                                  )}
                                </td>
                              </tr>
                              <tr className="bg-muted/20">
                                <td className="font-bold">
                                  Total (per container)
                                </td>
                                <td className="font-bold">
                                  ₹
                                  {(
                                    seaINR +
                                    quote.houseDeliveryOrderPerBOL +
                                    quote.cfsPerContainer +
                                    quote.transportationPerContainer +
                                    quote.ediChargesPerBOE +
                                    quote.mooWRReeWarehousingCharges +
                                    quote.chaChargesMOOWR
                                  ).toFixed(2)}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
};

export default VendorAllottedRFQs;