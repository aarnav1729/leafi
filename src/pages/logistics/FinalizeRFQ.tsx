
import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useData } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const USD_TO_INR_RATE = 75;

const FinalizeRFQ = () => {
  const { rfqId } = useParams<{ rfqId: string }>();
  const navigate = useNavigate();
  const { getRFQById, getQuotesByRFQId, finalizeRFQ } = useData();
  const [deviationReason, setDeviationReason] = useState("");
  const [isReasonModalOpen, setIsReasonModalOpen] = useState(false);
  
  const rfq = getRFQById(rfqId || "");
  const quotes = getQuotesByRFQId(rfqId || "");
  
  const [logisticsAllocation, setLogisticsAllocation] = useState<{
    [quoteId: string]: {
      containersAllottedHome: number;
      containersAllottedMOOWR: number;
    };
  }>({});

  // Calculate optimal allocation based on cost
  useMemo(() => {
    if (rfq && quotes.length > 0) {
      // For demo purpose, we'll allocate all containers to the first quote's cheapest option
      const initialAllocation: typeof logisticsAllocation = {};
      
      quotes.forEach(quote => {
        // For each quote, determine which is cheaper - Home or MOOWR
        const isHomeCheaper = (quote.homeTotal || 0) <= (quote.mooWRTotal || 0);
        
        initialAllocation[quote.id] = {
          containersAllottedHome: isHomeCheaper ? rfq.numberOfContainers : 0,
          containersAllottedMOOWR: !isHomeCheaper ? rfq.numberOfContainers : 0,
        };
      });
      
      setLogisticsAllocation(initialAllocation);
    }
  }, [rfq, quotes]);

  if (!rfq) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">RFQ not found</h2>
        <Button onClick={() => navigate("/dashboard")}>Return to Dashboard</Button>
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">No quotes submitted for this RFQ yet</h2>
        <Button onClick={() => navigate("/dashboard")}>Return to Dashboard</Button>
      </div>
    );
  }

  const handleAllocationChange = (
    quoteId: string, 
    type: "home" | "moowr", 
    value: number
  ) => {
    setLogisticsAllocation({
      ...logisticsAllocation,
      [quoteId]: {
        ...logisticsAllocation[quoteId],
        [type === "home" ? "containersAllottedHome" : "containersAllottedMOOWR"]: value
      }
    });
  };

  const isAllocationValid = () => {
    let totalAllocated = 0;
    
    Object.values(logisticsAllocation).forEach(alloc => {
      totalAllocated += alloc.containersAllottedHome + alloc.containersAllottedMOOWR;
    });
    
    return totalAllocated === rfq.numberOfContainers;
  };

  const handleFinalize = () => {
    // Check if there's any deviation from optimal allocation
    const optimalAllocation = quotes[0].homeTotal && quotes[0].mooWRTotal 
      ? quotes[0].homeTotal <= quotes[0].mooWRTotal 
        ? { containersAllottedHome: rfq.numberOfContainers, containersAllottedMOOWR: 0 } 
        : { containersAllottedHome: 0, containersAllottedMOOWR: rfq.numberOfContainers }
      : { containersAllottedHome: rfq.numberOfContainers, containersAllottedMOOWR: 0 };
      
    const quoteId = quotes[0].id;
    const hasDeviation = 
      optimalAllocation.containersAllottedHome !== logisticsAllocation[quoteId]?.containersAllottedHome ||
      optimalAllocation.containersAllottedMOOWR !== logisticsAllocation[quoteId]?.containersAllottedMOOWR;
      
    if (hasDeviation) {
      setIsReasonModalOpen(true);
      return;
    }
    
    submitFinalization();
  };
  
  const submitFinalization = () => {
    // Create allocation objects for each quote that has containers allocated
    Object.entries(logisticsAllocation).forEach(([quoteId, allocation]) => {
      if (allocation.containersAllottedHome > 0 || allocation.containersAllottedMOOWR > 0) {
        const quote = quotes.find(q => q.id === quoteId);
        if (quote) {
          finalizeRFQ(rfqId!, {
            rfqId: rfqId!,
            quoteId,
            vendorName: quote.vendorName,
            containersAllottedHome: allocation.containersAllottedHome,
            containersAllottedMOOWR: allocation.containersAllottedMOOWR,
            reason: deviationReason || undefined,
          });
        }
      }
    });
    
    setIsReasonModalOpen(false);
    navigate("/dashboard");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finalize RFQ #{rfq.rfqNumber}</h1>
        <Button 
          onClick={() => navigate("/dashboard")}
          variant="outline"
        >
          Back to List
        </Button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {quotes.map((quote) => {
          const vendorName = quote.vendorName;
          const seaFreightInINR = quote.seaFreightPerContainer * USD_TO_INR_RATE;
          
          const homeTotal = 
            seaFreightInINR + 
            quote.houseDeliveryOrderPerBOL + 
            quote.cfsPerContainer + 
            quote.transportationPerContainer + 
            quote.ediChargesPerBOE + 
            quote.chaChargesHome;
          
          const mooWRTotal = 
            seaFreightInINR + 
            quote.houseDeliveryOrderPerBOL + 
            quote.cfsPerContainer + 
            quote.transportationPerContainer + 
            quote.ediChargesPerBOE + 
            quote.mooWRReeWarehousingCharges + 
            quote.chaChargesMOOWR;

          return (
            <div key={quote.id} className="space-y-6">
              {/* Vendor Allocations Section */}
              <Card>
                <CardHeader>
                  <CardTitle>{vendorName} Allocation - CHA-HOME</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full data-table text-sm">
                      <thead>
                        <tr>
                          <th>Vendor</th>
                          <th>Offered</th>
                          <th>Allotted</th>
                          <th>Transship/Direct</th>
                          <th>Shipping Line</th>
                          <th>Container Type</th>
                          <th>Vessel</th>
                          <th>ETD</th>
                          <th>ETA</th>
                          <th>Sea Freight (INR)</th>
                          <th>HDO (INR)</th>
                          <th>CFS (INR)</th>
                          <th>Transport (INR)</th>
                          <th>EDI (INR)</th>
                          <th>CHA-Home (INR)</th>
                          <th>Validity Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{vendorName}</td>
                          <td>{quote.numberOfContainers}</td>
                          <td>{quote.containersAllottedHome || 0}</td>
                          <td>{quote.transshipOrDirect}</td>
                          <td>{quote.shippingLineName}</td>
                          <td>{quote.containerType}</td>
                          <td>{quote.vesselName}</td>
                          <td>{new Date(quote.vesselETD).toLocaleDateString()}</td>
                          <td>{new Date(quote.vesselETA).toLocaleDateString()}</td>
                          <td>{(quote.seaFreightPerContainer * USD_TO_INR_RATE).toFixed(2)}</td>
                          <td>{quote.houseDeliveryOrderPerBOL.toFixed(2)}</td>
                          <td>{quote.cfsPerContainer.toFixed(2)}</td>
                          <td>{quote.transportationPerContainer.toFixed(2)}</td>
                          <td>{quote.ediChargesPerBOE.toFixed(2)}</td>
                          <td>{quote.chaChargesHome.toFixed(2)}</td>
                          <td>{new Date(quote.quoteValidityDate).toLocaleDateString()}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="mt-4 text-right font-bold">
                      Total: ₹{homeTotal.toFixed(2)}
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>{vendorName} Allocation - CHA-MOOWR</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full data-table text-sm">
                      <thead>
                        <tr>
                          <th>Vendor</th>
                          <th>Offered</th>
                          <th>Allotted</th>
                          <th>Transship/Direct</th>
                          <th>Shipping Line</th>
                          <th>Container Type</th>
                          <th>Vessel</th>
                          <th>ETD</th>
                          <th>ETA</th>
                          <th>Sea Freight (INR)</th>
                          <th>HDO (INR)</th>
                          <th>CFS (INR)</th>
                          <th>Transport (INR)</th>
                          <th>EDI (INR)</th>
                          <th>MOOWR (INR)</th>
                          <th>CHA-MOOWR (INR)</th>
                          <th>Validity Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{vendorName}</td>
                          <td>{quote.numberOfContainers}</td>
                          <td>{quote.containersAllottedMOOWR || 0}</td>
                          <td>{quote.transshipOrDirect}</td>
                          <td>{quote.shippingLineName}</td>
                          <td>{quote.containerType}</td>
                          <td>{quote.vesselName}</td>
                          <td>{new Date(quote.vesselETD).toLocaleDateString()}</td>
                          <td>{new Date(quote.vesselETA).toLocaleDateString()}</td>
                          <td>{(quote.seaFreightPerContainer * USD_TO_INR_RATE).toFixed(2)}</td>
                          <td>{quote.houseDeliveryOrderPerBOL.toFixed(2)}</td>
                          <td>{quote.cfsPerContainer.toFixed(2)}</td>
                          <td>{quote.transportationPerContainer.toFixed(2)}</td>
                          <td>{quote.ediChargesPerBOE.toFixed(2)}</td>
                          <td>{quote.mooWRReeWarehousingCharges.toFixed(2)}</td>
                          <td>{quote.chaChargesMOOWR.toFixed(2)}</td>
                          <td>{new Date(quote.quoteValidityDate).toLocaleDateString()}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="mt-4 text-right font-bold">
                      Total: ₹{mooWRTotal.toFixed(2)}
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* Logistics Allocation Section */}
              <Card>
                <CardHeader>
                  <CardTitle>Logistics Allocation - CHA-HOME</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full data-table text-sm">
                      <thead>
                        <tr>
                          <th>Vendor</th>
                          <th>Offered</th>
                          <th>Allotted</th>
                          <th>Transship/Direct</th>
                          <th>Shipping Line</th>
                          <th>Container Type</th>
                          <th>Vessel</th>
                          <th>ETD</th>
                          <th>ETA</th>
                          <th>Sea Freight (INR)</th>
                          <th>HDO (INR)</th>
                          <th>CFS (INR)</th>
                          <th>Transport (INR)</th>
                          <th>EDI (INR)</th>
                          <th>CHA-Home (INR)</th>
                          <th>Validity Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{vendorName}</td>
                          <td>{quote.numberOfContainers}</td>
                          <td>
                            <Input
                              type="number"
                              min="0"
                              max={rfq.numberOfContainers}
                              value={logisticsAllocation[quote.id]?.containersAllottedHome || 0}
                              onChange={(e) => handleAllocationChange(
                                quote.id, 
                                "home", 
                                parseInt(e.target.value) || 0
                              )}
                              className="w-16"
                            />
                          </td>
                          <td>{quote.transshipOrDirect}</td>
                          <td>{quote.shippingLineName}</td>
                          <td>{quote.containerType}</td>
                          <td>{quote.vesselName}</td>
                          <td>{new Date(quote.vesselETD).toLocaleDateString()}</td>
                          <td>{new Date(quote.vesselETA).toLocaleDateString()}</td>
                          <td>{(quote.seaFreightPerContainer * USD_TO_INR_RATE).toFixed(2)}</td>
                          <td>{quote.houseDeliveryOrderPerBOL.toFixed(2)}</td>
                          <td>{quote.cfsPerContainer.toFixed(2)}</td>
                          <td>{quote.transportationPerContainer.toFixed(2)}</td>
                          <td>{quote.ediChargesPerBOE.toFixed(2)}</td>
                          <td>{quote.chaChargesHome.toFixed(2)}</td>
                          <td>{new Date(quote.quoteValidityDate).toLocaleDateString()}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="mt-4 text-right font-bold">
                      Total: ₹{(homeTotal * (logisticsAllocation[quote.id]?.containersAllottedHome || 0)).toFixed(2)}
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Logistics Allocation - CHA-MOOWR</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full data-table text-sm">
                      <thead>
                        <tr>
                          <th>Vendor</th>
                          <th>Offered</th>
                          <th>Allotted</th>
                          <th>Transship/Direct</th>
                          <th>Shipping Line</th>
                          <th>Container Type</th>
                          <th>Vessel</th>
                          <th>ETD</th>
                          <th>ETA</th>
                          <th>Sea Freight (INR)</th>
                          <th>HDO (INR)</th>
                          <th>CFS (INR)</th>
                          <th>Transport (INR)</th>
                          <th>EDI (INR)</th>
                          <th>MOOWR (INR)</th>
                          <th>CHA-MOOWR (INR)</th>
                          <th>Validity Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{vendorName}</td>
                          <td>{quote.numberOfContainers}</td>
                          <td>
                            <Input
                              type="number"
                              min="0"
                              max={rfq.numberOfContainers}
                              value={logisticsAllocation[quote.id]?.containersAllottedMOOWR || 0}
                              onChange={(e) => handleAllocationChange(
                                quote.id, 
                                "moowr", 
                                parseInt(e.target.value) || 0
                              )}
                              className="w-16"
                            />
                          </td>
                          <td>{quote.transshipOrDirect}</td>
                          <td>{quote.shippingLineName}</td>
                          <td>{quote.containerType}</td>
                          <td>{quote.vesselName}</td>
                          <td>{new Date(quote.vesselETD).toLocaleDateString()}</td>
                          <td>{new Date(quote.vesselETA).toLocaleDateString()}</td>
                          <td>{(quote.seaFreightPerContainer * USD_TO_INR_RATE).toFixed(2)}</td>
                          <td>{quote.houseDeliveryOrderPerBOL.toFixed(2)}</td>
                          <td>{quote.cfsPerContainer.toFixed(2)}</td>
                          <td>{quote.transportationPerContainer.toFixed(2)}</td>
                          <td>{quote.ediChargesPerBOE.toFixed(2)}</td>
                          <td>{quote.mooWRReeWarehousingCharges.toFixed(2)}</td>
                          <td>{quote.chaChargesMOOWR.toFixed(2)}</td>
                          <td>{new Date(quote.quoteValidityDate).toLocaleDateString()}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="mt-4 text-right font-bold">
                      Total: ₹{(mooWRTotal * (logisticsAllocation[quote.id]?.containersAllottedMOOWR || 0)).toFixed(2)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
      
      {/* Net total and finalize button */}
      <div className="flex flex-col md:flex-row justify-between items-center p-4 border rounded-lg bg-muted/20">
        <div className="text-xl font-bold mb-4 md:mb-0">
          Net Total: ₹
          {quotes.reduce((total, quote) => {
            const seaFreightInINR = quote.seaFreightPerContainer * USD_TO_INR_RATE;
            
            const homeRate = 
              seaFreightInINR + 
              quote.houseDeliveryOrderPerBOL + 
              quote.cfsPerContainer + 
              quote.transportationPerContainer + 
              quote.ediChargesPerBOE + 
              quote.chaChargesHome;
            
            const mooWRRate = 
              seaFreightInINR + 
              quote.houseDeliveryOrderPerBOL + 
              quote.cfsPerContainer + 
              quote.transportationPerContainer + 
              quote.ediChargesPerBOE + 
              quote.mooWRReeWarehousingCharges + 
              quote.chaChargesMOOWR;
            
            return total + 
              (homeRate * (logisticsAllocation[quote.id]?.containersAllottedHome || 0)) +
              (mooWRRate * (logisticsAllocation[quote.id]?.containersAllottedMOOWR || 0));
          }, 0).toFixed(2)}
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="text-sm text-muted-foreground">
            {isAllocationValid() 
              ? `All ${rfq.numberOfContainers} containers allocated` 
              : `${rfq.numberOfContainers - Object.values(logisticsAllocation).reduce(
                  (sum, alloc) => sum + alloc.containersAllottedHome + alloc.containersAllottedMOOWR, 0
                )} containers remaining`}
          </div>
          <Button 
            onClick={handleFinalize}
            disabled={!isAllocationValid() || rfq.status === "closed"}
          >
            {rfq.status === "closed" ? "Already Finalized" : "Finalize"}
          </Button>
        </div>
      </div>
      
      {/* Deviation reason modal */}
      <Dialog open={isReasonModalOpen} onOpenChange={setIsReasonModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reason for Deviation</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="reason">Please provide a reason for the allocation deviation:</Label>
            <Textarea
              id="reason"
              value={deviationReason}
              onChange={(e) => setDeviationReason(e.target.value)}
              className="mt-2"
              rows={4}
            />
          </div>
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => setIsReasonModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitFinalization}>
              Submit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FinalizeRFQ;
