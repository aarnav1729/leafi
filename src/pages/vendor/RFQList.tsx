
import { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/StatusBadge";
import { format } from "date-fns";
import { RFQ, QuoteItem } from "@/types/rfq.types";

const USD_TO_INR_RATE = 75;

const VendorRFQList = () => {
  const { user } = useAuth();
  const { getVendorRFQs, createQuote } = useData();
  const [selectedRFQ, setSelectedRFQ] = useState<RFQ | null>(null);
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);

  // Form state
  const [numberOfContainers, setNumberOfContainers] = useState(1);
  const [shippingLineName, setShippingLineName] = useState("");
  const [vesselName, setVesselName] = useState("");
  const [vesselETD, setVesselETD] = useState("");
  const [vesselETA, setVesselETA] = useState("");
  const [seaFreightPerContainer, setSeaFreightPerContainer] = useState(0);
  const [houseDeliveryOrderPerBOL, setHouseDeliveryOrderPerBOL] = useState(0);
  const [cfsPerContainer, setCfsPerContainer] = useState(0);
  const [transportationPerContainer, setTransportationPerContainer] = useState(0);
  const [chaChargesHome, setChaChargesHome] = useState(0);
  const [chaChargesMOOWR, setChaChargesMOOWR] = useState(0);
  const [ediChargesPerBOE, setEdiChargesPerBOE] = useState(0);
  const [mooWRReeWarehousingCharges, setMooWRReeWarehousingCharges] = useState(0);
  const [transshipOrDirect, setTransshipOrDirect] = useState<"transship" | "direct">("direct");
  const [quoteValidityDate, setQuoteValidityDate] = useState("");
  const [message, setMessage] = useState("");
  
  const rfqs = getVendorRFQs().sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const openQuoteModal = (rfq: RFQ) => {
    setSelectedRFQ(rfq);
    setNumberOfContainers(rfq.numberOfContainers);
    setQuoteModalOpen(true);
  };

  const handleSubmitQuote = () => {
    if (!selectedRFQ || !user?.company) return;
    
    createQuote({
      rfqId: selectedRFQ.id,
      vendorName: user.company,
      numberOfContainers,
      shippingLineName,
      containerType: selectedRFQ.containerType,
      vesselName,
      vesselETD,
      vesselETA,
      seaFreightPerContainer,
      houseDeliveryOrderPerBOL,
      cfsPerContainer,
      transportationPerContainer,
      chaChargesHome,
      chaChargesMOOWR,
      ediChargesPerBOE,
      mooWRReeWarehousingCharges,
      transshipOrDirect,
      quoteValidityDate,
      message,
    });
    
    // Reset form and close modal
    setQuoteModalOpen(false);
    setSelectedRFQ(null);
    resetForm();
  };

  const resetForm = () => {
    setShippingLineName("");
    setVesselName("");
    setVesselETD("");
    setVesselETA("");
    setSeaFreightPerContainer(0);
    setHouseDeliveryOrderPerBOL(0);
    setCfsPerContainer(0);
    setTransportationPerContainer(0);
    setChaChargesHome(0);
    setChaChargesMOOWR(0);
    setEdiChargesPerBOE(0);
    setMooWRReeWarehousingCharges(0);
    setTransshipOrDirect("direct");
    setQuoteValidityDate("");
    setMessage("");
  };

  // Calculate totals for display in the form
  const homeTotalINR = 
    (seaFreightPerContainer * USD_TO_INR_RATE) + 
    houseDeliveryOrderPerBOL + 
    cfsPerContainer + 
    transportationPerContainer + 
    ediChargesPerBOE + 
    chaChargesHome;
    
  const mooWRTotalINR = 
    (seaFreightPerContainer * USD_TO_INR_RATE) + 
    houseDeliveryOrderPerBOL + 
    cfsPerContainer + 
    transportationPerContainer + 
    ediChargesPerBOE + 
    mooWRReeWarehousingCharges + 
    chaChargesMOOWR;

  const isQuoteAllowed = (rfq: RFQ) => {
    if (rfq.status === "closed") return false;
    
    // Check if before initial quote end time for initial status
    if (rfq.status === "initial") {
      return new Date() < new Date(rfq.initialQuoteEndTime);
    }
    
    // For evaluation status, check if before evaluation end time
    return new Date() < new Date(rfq.evaluationEndTime);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">RFQ List</h1>
      </div>
      
      <div className="rounded-md border">
        <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr>
                <th>Actions</th>
                <th>RFQ Number</th>
                <th>Item</th>
                <th>Company</th>
                <th>Supplier</th>
                <th>Loading Port</th>
                <th>Destination Port</th>
                <th>Container Type</th>
                <th>No. of Containers</th>
                <th>Weight (tons)</th>
                <th>Readiness Date</th>
                <th>Quote End</th>
                <th>Eval End</th>
                <th>PO Number</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rfqs.length === 0 ? (
                <tr>
                  <td colSpan={15} className="text-center py-4">
                    No RFQs found for your company.
                  </td>
                </tr>
              ) : (
                rfqs.map((rfq) => (
                  <tr key={rfq.id}>
                    <td>
                      {isQuoteAllowed(rfq) ? (
                        <Button 
                          size="sm" 
                          onClick={() => openQuoteModal(rfq)}
                        >
                          Quote
                        </Button>
                      ) : (
                        <Button 
                          size="sm" 
                          variant="outline"
                          disabled
                        >
                          Quote
                        </Button>
                      )}
                    </td>
                    <td>{rfq.rfqNumber}</td>
                    <td>{rfq.itemDescription}</td>
                    <td>{rfq.companyName}</td>
                    <td>{rfq.supplierName}</td>
                    <td>{rfq.portOfLoading}</td>
                    <td>{rfq.portOfDestination}</td>
                    <td>{rfq.containerType}</td>
                    <td>{rfq.numberOfContainers}</td>
                    <td>{rfq.cargoWeight}</td>
                    <td>{new Date(rfq.cargoReadinessDate).toLocaleDateString()}</td>
                    <td>{new Date(rfq.initialQuoteEndTime).toLocaleDateString()}</td>
                    <td>{new Date(rfq.evaluationEndTime).toLocaleDateString()}</td>
                    <td>{rfq.materialPONumber}</td>
                    <td><StatusBadge status={rfq.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Quote submission modal */}
      <Dialog open={quoteModalOpen} onOpenChange={setQuoteModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submit Quote for RFQ #{selectedRFQ?.rfqNumber}</DialogTitle>
          </DialogHeader>
          
          {selectedRFQ && (
            <div className="grid gap-6 py-4">
              {/* RFQ details */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Item Description</Label>
                  <div className="mt-1 font-medium">{selectedRFQ.itemDescription}</div>
                </div>
                <div>
                  <Label>Company Name</Label>
                  <div className="mt-1 font-medium">{selectedRFQ.companyName}</div>
                </div>
                <div>
                  <Label>Material PO Number</Label>
                  <div className="mt-1 font-medium">{selectedRFQ.materialPONumber}</div>
                </div>
                <div>
                  <Label>Supplier Name</Label>
                  <div className="mt-1 font-medium">{selectedRFQ.supplierName}</div>
                </div>
                <div>
                  <Label>Port of Loading</Label>
                  <div className="mt-1 font-medium">{selectedRFQ.portOfLoading}</div>
                </div>
                <div>
                  <Label>Port of Destination</Label>
                  <div className="mt-1 font-medium">{selectedRFQ.portOfDestination}</div>
                </div>
                <div>
                  <Label>Container Type</Label>
                  <div className="mt-1 font-medium">{selectedRFQ.containerType}</div>
                </div>
                <div>
                  <Label>Number of Containers</Label>
                  <div className="mt-1 font-medium">{selectedRFQ.numberOfContainers}</div>
                </div>
                <div>
                  <Label>Cargo Weight</Label>
                  <div className="mt-1 font-medium">{selectedRFQ.cargoWeight} tons</div>
                </div>
                <div>
                  <Label>Cargo Readiness Date</Label>
                  <div className="mt-1 font-medium">
                    {new Date(selectedRFQ.cargoReadinessDate).toLocaleDateString()}
                  </div>
                </div>
                <div>
                  <Label>Quote End Date</Label>
                  <div className="mt-1 font-medium">
                    {new Date(selectedRFQ.initialQuoteEndTime).toLocaleDateString()}
                  </div>
                </div>
                <div>
                  <Label>Evaluation End Date</Label>
                  <div className="mt-1 font-medium">
                    {new Date(selectedRFQ.evaluationEndTime).toLocaleDateString()}
                  </div>
                </div>
              </div>
              
              <div className="border-t mt-4 pt-4">
                <h3 className="text-lg font-medium mb-4">Quote Details</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="numberOfContainers">Number of Containers</Label>
                    <Input
                      id="numberOfContainers"
                      type="number"
                      min="1"
                      max={selectedRFQ.numberOfContainers}
                      value={numberOfContainers}
                      onChange={(e) => setNumberOfContainers(parseInt(e.target.value) || 1)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="shippingLineName">Shipping Line Name</Label>
                    <Input
                      id="shippingLineName"
                      value={shippingLineName}
                      onChange={(e) => setShippingLineName(e.target.value)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="containerType">Container Type</Label>
                    <Input
                      id="containerType"
                      value={selectedRFQ.containerType}
                      disabled
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="vesselName">Vessel Name</Label>
                    <Input
                      id="vesselName"
                      value={vesselName}
                      onChange={(e) => setVesselName(e.target.value)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="vesselETD">Vessel ETD</Label>
                    <Input
                      id="vesselETD"
                      type="date"
                      value={vesselETD}
                      onChange={(e) => setVesselETD(e.target.value)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="vesselETA">Vessel ETA</Label>
                    <Input
                      id="vesselETA"
                      type="date"
                      value={vesselETA}
                      onChange={(e) => setVesselETA(e.target.value)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="seaFreightPerContainer">Sea Freight Per Container (USD)</Label>
                    <Input
                      id="seaFreightPerContainer"
                      type="number"
                      min="0"
                      step="0.01"
                      value={seaFreightPerContainer}
                      onChange={(e) => setSeaFreightPerContainer(parseFloat(e.target.value) || 0)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="houseDeliveryOrderPerBOL">House Delivery Order Per Bill of Lading (INR)</Label>
                    <Input
                      id="houseDeliveryOrderPerBOL"
                      type="number"
                      min="0"
                      step="0.01"
                      value={houseDeliveryOrderPerBOL}
                      onChange={(e) => setHouseDeliveryOrderPerBOL(parseFloat(e.target.value) || 0)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="cfsPerContainer">CFS Per Container (INR)</Label>
                    <Input
                      id="cfsPerContainer"
                      type="number"
                      min="0"
                      step="0.01"
                      value={cfsPerContainer}
                      onChange={(e) => setCfsPerContainer(parseFloat(e.target.value) || 0)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="transportationPerContainer">Transportation Per Container (INR)</Label>
                    <Input
                      id="transportationPerContainer"
                      type="number"
                      min="0"
                      step="0.01"
                      value={transportationPerContainer}
                      onChange={(e) => setTransportationPerContainer(parseFloat(e.target.value) || 0)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="chaChargesHome">CHA Charges - Home Per Container (INR)</Label>
                    <Input
                      id="chaChargesHome"
                      type="number"
                      min="0"
                      step="0.01"
                      value={chaChargesHome}
                      onChange={(e) => setChaChargesHome(parseFloat(e.target.value) || 0)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="chaChargesMOOWR">CHA Charges - MOOWR Scheme Per Container (INR)</Label>
                    <Input
                      id="chaChargesMOOWR"
                      type="number"
                      min="0"
                      step="0.01"
                      value={chaChargesMOOWR}
                      onChange={(e) => setChaChargesMOOWR(parseFloat(e.target.value) || 0)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="ediChargesPerBOE">EDI Charges Per BOE (INR)</Label>
                    <Input
                      id="ediChargesPerBOE"
                      type="number"
                      min="0"
                      step="0.01"
                      value={ediChargesPerBOE}
                      onChange={(e) => setEdiChargesPerBOE(parseFloat(e.target.value) || 0)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="mooWRReeWarehousingCharges">MOOWR Re-Warehousing Charges per BOE (INR)</Label>
                    <Input
                      id="mooWRReeWarehousingCharges"
                      type="number"
                      min="0"
                      step="0.01"
                      value={mooWRReeWarehousingCharges}
                      onChange={(e) => setMooWRReeWarehousingCharges(parseFloat(e.target.value) || 0)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="transshipOrDirect">Transship or Direct</Label>
                    <Select 
                      value={transshipOrDirect} 
                      onValueChange={(value) => setTransshipOrDirect(value as "transship" | "direct")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select option" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direct">Direct</SelectItem>
                        <SelectItem value="transship">Transship</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="quoteValidityDate">Quote Validity Date</Label>
                    <Input
                      id="quoteValidityDate"
                      type="date"
                      value={quoteValidityDate}
                      onChange={(e) => setQuoteValidityDate(e.target.value)}
                      required
                    />
                  </div>
                </div>
                
                <div className="space-y-2 mt-4">
                  <Label htmlFor="message">Message (Optional)</Label>
                  <Input
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </div>
                
                {/* Total calculations */}
                <div className="grid grid-cols-2 gap-4 mt-6 bg-muted/20 p-4 rounded-lg">
                  <div className="space-y-2">
                    <Label className="text-lg">Total with CHA - Home (INR)</Label>
                    <div className="text-xl font-bold">₹{homeTotalINR.toFixed(2)}</div>
                    <div className="text-sm text-muted-foreground">
                      Sea Freight (₹{(seaFreightPerContainer * USD_TO_INR_RATE).toFixed(2)}) +
                      House Delivery (₹{houseDeliveryOrderPerBOL.toFixed(2)}) +
                      CFS (₹{cfsPerContainer.toFixed(2)}) +
                      Transportation (₹{transportationPerContainer.toFixed(2)}) +
                      EDI (₹{ediChargesPerBOE.toFixed(2)}) +
                      CHA-Home (₹{chaChargesHome.toFixed(2)})
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-lg">Total with CHA - MOOWR (INR)</Label>
                    <div className="text-xl font-bold">₹{mooWRTotalINR.toFixed(2)}</div>
                    <div className="text-sm text-muted-foreground">
                      Sea Freight (₹{(seaFreightPerContainer * USD_TO_INR_RATE).toFixed(2)}) +
                      House Delivery (₹{houseDeliveryOrderPerBOL.toFixed(2)}) +
                      CFS (₹{cfsPerContainer.toFixed(2)}) +
                      Transportation (₹{transportationPerContainer.toFixed(2)}) +
                      EDI (₹{ediChargesPerBOE.toFixed(2)}) +
                      MOOWR Re-Warehousing (₹{mooWRReeWarehousingCharges.toFixed(2)}) +
                      CHA-MOOWR (₹{chaChargesMOOWR.toFixed(2)})
                    </div>
                  </div>
                </div>
              </div>
              
              <Button 
                onClick={handleSubmitQuote}
                className="mt-4"
              >
                Submit Quote
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VendorRFQList;
