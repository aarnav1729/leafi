
import { useData } from "@/contexts/DataContext";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Card } from "@/components/ui/card";

const VendorAllottedRFQs = () => {
  const { getVendorAllottedRFQs, getAllocationsByRFQId, getRFQById, getQuotesByRFQId } = useData();
  
  const allottedRFQs = getVendorAllottedRFQs().sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Allotted RFQs</h1>
      </div>
      
      <div className="space-y-6">
        {allottedRFQs.length === 0 ? (
          <Card className="p-6 text-center">
            <p>No allotted RFQs found. When a logistics manager allocates containers to your quotes, they will appear here.</p>
          </Card>
        ) : (
          allottedRFQs.map((rfq) => {
            const allocations = getAllocationsByRFQId(rfq.id);
            const quotes = getQuotesByRFQId(rfq.id);
            
            return (
              <Card key={rfq.id} className="p-6 space-y-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-xl font-bold">RFQ #{rfq.rfqNumber}</h2>
                    <p className="text-muted-foreground">{rfq.itemDescription} - {rfq.companyName}</p>
                  </div>
                  <StatusBadge status={rfq.status} />
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Supplier:</span> {rfq.supplierName}
                  </div>
                  <div>
                    <span className="font-medium">Material PO:</span> {rfq.materialPONumber}
                  </div>
                  <div>
                    <span className="font-medium">Port of Loading:</span> {rfq.portOfLoading}
                  </div>
                  <div>
                    <span className="font-medium">Port of Destination:</span> {rfq.portOfDestination}
                  </div>
                  <div>
                    <span className="font-medium">Container Type:</span> {rfq.containerType}
                  </div>
                  <div>
                    <span className="font-medium">Total Containers:</span> {rfq.numberOfContainers}
                  </div>
                  <div>
                    <span className="font-medium">Cargo Weight:</span> {rfq.cargoWeight} tons
                  </div>
                  <div>
                    <span className="font-medium">Cargo Readiness:</span> {new Date(rfq.cargoReadinessDate).toLocaleDateString()}
                  </div>
                </div>
                
                <div className="border-t pt-4 mt-4">
                  <h3 className="font-medium mb-2">Your Quote Details</h3>
                  {quotes.map((quote) => {
                    const allocation = allocations.find(a => a.quoteId === quote.id);
                    if (!allocation) return null;
                    
                    const seaFreightInINR = quote.seaFreightPerContainer * 75;
                    
                    return (
                      <div key={quote.id} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <table className="w-full data-table">
                          <thead>
                            <tr>
                              <th colSpan={2}>CHA-Home Details</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="font-medium">Containers Allotted</td>
                              <td>{allocation.containersAllottedHome}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Container Type</td>
                              <td>{quote.containerType}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Shipping Line</td>
                              <td>{quote.shippingLineName}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Vessel</td>
                              <td>{quote.vesselName}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Vessel ETD</td>
                              <td>{new Date(quote.vesselETD).toLocaleDateString()}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Vessel ETA</td>
                              <td>{new Date(quote.vesselETA).toLocaleDateString()}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Sea Freight</td>
                              <td>USD {quote.seaFreightPerContainer.toFixed(2)} (₹{seaFreightInINR.toFixed(2)})</td>
                            </tr>
                            <tr>
                              <td className="font-medium">House Delivery Order</td>
                              <td>₹{quote.houseDeliveryOrderPerBOL.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">CFS</td>
                              <td>₹{quote.cfsPerContainer.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Transportation</td>
                              <td>₹{quote.transportationPerContainer.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">EDI Charges</td>
                              <td>₹{quote.ediChargesPerBOE.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">CHA-Home Charges</td>
                              <td>₹{quote.chaChargesHome.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Quote Validity</td>
                              <td>{new Date(quote.quoteValidityDate).toLocaleDateString()}</td>
                            </tr>
                            <tr className="bg-muted/20">
                              <td className="font-bold">Total (per container)</td>
                              <td className="font-bold">
                                ₹{(
                                  seaFreightInINR + 
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
                        
                        <table className="w-full data-table">
                          <thead>
                            <tr>
                              <th colSpan={2}>CHA-MOOWR Details</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="font-medium">Containers Allotted</td>
                              <td>{allocation.containersAllottedMOOWR}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Container Type</td>
                              <td>{quote.containerType}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Shipping Line</td>
                              <td>{quote.shippingLineName}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Vessel</td>
                              <td>{quote.vesselName}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Vessel ETD</td>
                              <td>{new Date(quote.vesselETD).toLocaleDateString()}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Vessel ETA</td>
                              <td>{new Date(quote.vesselETA).toLocaleDateString()}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Sea Freight</td>
                              <td>USD {quote.seaFreightPerContainer.toFixed(2)} (₹{seaFreightInINR.toFixed(2)})</td>
                            </tr>
                            <tr>
                              <td className="font-medium">House Delivery Order</td>
                              <td>₹{quote.houseDeliveryOrderPerBOL.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">CFS</td>
                              <td>₹{quote.cfsPerContainer.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Transportation</td>
                              <td>₹{quote.transportationPerContainer.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">EDI Charges</td>
                              <td>₹{quote.ediChargesPerBOE.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">MOOWR Re-Warehousing</td>
                              <td>₹{quote.mooWRReeWarehousingCharges.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">CHA-MOOWR Charges</td>
                              <td>₹{quote.chaChargesMOOWR.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td className="font-medium">Quote Validity</td>
                              <td>{new Date(quote.quoteValidityDate).toLocaleDateString()}</td>
                            </tr>
                            <tr className="bg-muted/20">
                              <td className="font-bold">Total (per container)</td>
                              <td className="font-bold">
                                ₹{(
                                  seaFreightInINR + 
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
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};

export default VendorAllottedRFQs;
