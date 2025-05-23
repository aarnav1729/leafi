// root/src/pages/logistics/RFQList.tsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/common/StatusBadge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import api from "@/lib/api";
import { RFQ } from "@/types/rfq.types";

interface Vendor {
  username: string;
  name: string;
  company: string;
}

const RFQList: React.FC = () => {
  const { getUserRFQs, createRFQ } = useData();
  const navigate = useNavigate();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Form state
  const [itemDescription, setItemDescription] = useState<RFQ["itemDescription"]>("EVA");
  const [companyName, setCompanyName] = useState<RFQ["companyName"]>("PEPPL");
  const [materialPONumber, setMaterialPONumber] = useState("");
  const [supplierName, setSupplierName] = useState<RFQ["supplierName"]>("aarnav");
  const [portOfLoading, setPortOfLoading] = useState<RFQ["portOfLoading"]>("beijing");
  const [portOfDestination, setPortOfDestination] = useState<RFQ["portOfDestination"]>("chennai");
  const [containerType, setContainerType] = useState<RFQ["containerType"]>("LCL");
  const [numberOfContainers, setNumberOfContainers] = useState(1);
  const [cargoWeight, setCargoWeight] = useState(1);
  const [cargoReadinessDate, setCargoReadinessDate] = useState("");
  const [initialQuoteEndTime, setInitialQuoteEndTime] = useState("");
  const [evaluationEndTime, setEvaluationEndTime] = useState("");
  const [description, setDescription] = useState("");

  // Vendors selection
  const [vendors, setVendors] = useState<string[]>([]);
  const [vendorOptions, setVendorOptions] = useState<Vendor[]>([]);

  // Load RFQs
  const rfqs = getUserRFQs().sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Fetch vendor list from server
  useEffect(() => {
    const fetchVendors = async () => {
      try {
        const res = await api.get<Vendor[]>("/vendors");
        setVendorOptions(res.data);
      } catch (err) {
        console.error("Failed to load vendors:", err);
      }
    };
    fetchVendors();
  }, []);

  const handleCreateRFQ = () => {
    createRFQ({
      itemDescription,
      companyName,
      materialPONumber,
      supplierName,
      portOfLoading,
      portOfDestination,
      containerType,
      numberOfContainers,
      cargoWeight,
      cargoReadinessDate,
      initialQuoteEndTime,
      evaluationEndTime,
      description,
      vendors,
      createdBy: "aarnav",
    });

    setIsCreateModalOpen(false);
    // Reset form
    setMaterialPONumber("");
    setNumberOfContainers(1);
    setCargoWeight(1);
    setCargoReadinessDate("");
    setInitialQuoteEndTime("");
    setEvaluationEndTime("");
    setDescription("");
    setVendors([]);
  };

  const handleFinalize = (rfqId: string) => {
    navigate(`/logistics/finalize/${rfqId}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">RFQ List</h1>
        <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
          <DialogTrigger asChild>
            <Button>+ Create New</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New RFQ</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="itemDescription">Item Description</Label>
                  <Select
                    value={itemDescription}
                    onValueChange={(value) =>
                      setItemDescription(value as RFQ["itemDescription"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select item" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EVA">EVA</SelectItem>
                      <SelectItem value="Photovoltaic Cells">Photovoltaic Cells</SelectItem>
                      <SelectItem value="TMA">TMA</SelectItem>
                      <SelectItem value="CAP">CAP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="companyName">Company Name</Label>
                  <Select
                    value={companyName}
                    onValueChange={(value) =>
                      setCompanyName(value as RFQ["companyName"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select company" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PEPPL">PEPPL</SelectItem>
                      <SelectItem value="PEIPL">PEIPL</SelectItem>
                      <SelectItem value="PEGEPL">PEGEPL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="materialPONumber">Material PO Number</Label>
                  <Input
                    id="materialPONumber"
                    value={materialPONumber}
                    onChange={(e) => setMaterialPONumber(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="supplierName">Supplier Name</Label>
                  <Select
                    value={supplierName}
                    onValueChange={(value) =>
                      setSupplierName(value as RFQ["supplierName"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aarnav">Aarnav</SelectItem>
                      <SelectItem value="madhur">Madhur</SelectItem>
                      <SelectItem value="akanksha">Akanksha</SelectItem>
                      <SelectItem value="ashwin">Ashwin</SelectItem>
                      <SelectItem value="sathvika">Sathvika</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="portOfLoading">Port of Loading</Label>
                  <Select
                    value={portOfLoading}
                    onValueChange={(value) =>
                      setPortOfLoading(value as RFQ["portOfLoading"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select port" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beijing">Beijing</SelectItem>
                      <SelectItem value="shanghai">Shanghai</SelectItem>
                      <SelectItem value="ningbo">Ningbo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="portOfDestination">Port of Destination</Label>
                  <Select
                    value={portOfDestination}
                    onValueChange={(value) =>
                      setPortOfDestination(value as RFQ["portOfDestination"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select port" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chennai">Chennai</SelectItem>
                      <SelectItem value="hyderabad">Hyderabad</SelectItem>
                      <SelectItem value="goa">Goa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="containerType">Container Type</Label>
                  <Select
                    value={containerType}
                    onValueChange={(value) =>
                      setContainerType(value as RFQ["containerType"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select container type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LCL">LCL</SelectItem>
                      <SelectItem value="20' OT">20' OT</SelectItem>
                      <SelectItem value="40'OT">40' OT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="numberOfContainers">Number of Containers</Label>
                  <Input
                    id="numberOfContainers"
                    type="number"
                    min="1"
                    value={numberOfContainers}
                    onChange={(e) =>
                      setNumberOfContainers(parseInt(e.target.value) || 1)
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cargoWeight">Cargo Weight in Container (tons)</Label>
                  <Input
                    id="cargoWeight"
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={cargoWeight}
                    onChange={(e) =>
                      setCargoWeight(parseFloat(e.target.value) || 0.1)
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cargoReadinessDate">Tentative Cargo Readiness Date</Label>
                  <Input
                    id="cargoReadinessDate"
                    type="datetime-local"
                    value={cargoReadinessDate}
                    onChange={(e) => setCargoReadinessDate(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="initialQuoteEndTime">Initial Quote End Time</Label>
                  <Input
                    id="initialQuoteEndTime"
                    type="datetime-local"
                    value={initialQuoteEndTime}
                    onChange={(e) => setInitialQuoteEndTime(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="evaluationEndTime">Evaluation End Time</Label>
                  <Input
                    id="evaluationEndTime"
                    type="datetime-local"
                    value={evaluationEndTime}
                    onChange={(e) => setEvaluationEndTime(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (Optional)</Label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Vendors to send RFQ</Label>
                <div className="border rounded-md p-4 space-y-2">
                  {vendorOptions.map((v) => (
                    <div key={v.company} className="flex items-center space-x-2">
                      <Checkbox
                        id={`vendor-${v.company}`}
                        checked={vendors.includes(v.company)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setVendors((prev) => [...prev, v.company]);
                          } else {
                            setVendors((prev) => prev.filter((c) => c !== v.company));
                          }
                        }}
                      />
                      <label
                        htmlFor={`vendor-${v.company}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {v.name} ({v.company})
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <Button onClick={handleCreateRFQ}>Submit RFQ</Button>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr>
                <th>Actions</th>
                <th>RFQ Number</th>
                <th>Item Description</th>
                <th>Company</th>
                <th>Material PO</th>
                <th>Supplier</th>
                <th>Port of Loading</th>
                <th>Port of Destination</th>
                <th>Container Type</th>
                <th>No. of Containers</th>
                <th>Weight (tons)</th>
                <th>Readiness Date</th>
                <th>Quote End</th>
                <th>Eval End</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rfqs.length === 0 ? (
                <tr>
                  <td colSpan={15} className="text-center py-4">
                    No RFQs found. Create your first RFQ!
                  </td>
                </tr>
              ) : (
                rfqs.map((rfq) => (
                  <tr key={rfq.id}>
                    <td>
                      {rfq.status !== "closed" && (
                        <Button size="sm" onClick={() => handleFinalize(rfq.id)}>
                          Finalize
                        </Button>
                      )}
                      {rfq.status === "closed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleFinalize(rfq.id)}
                        >
                          View
                        </Button>
                      )}
                    </td>
                    <td>{rfq.rfqNumber}</td>
                    <td>{rfq.itemDescription}</td>
                    <td>{rfq.companyName}</td>
                    <td>{rfq.materialPONumber}</td>
                    <td>{rfq.supplierName}</td>
                    <td>{rfq.portOfLoading}</td>
                    <td>{rfq.portOfDestination}</td>
                    <td>{rfq.containerType}</td>
                    <td>{rfq.numberOfContainers}</td>
                    <td>{rfq.cargoWeight}</td>
                    <td>{new Date(rfq.cargoReadinessDate).toLocaleDateString()}</td>
                    <td>{new Date(rfq.initialQuoteEndTime).toLocaleDateString()}</td>
                    <td>{new Date(rfq.evaluationEndTime).toLocaleDateString()}</td>
                    <td>
                      <StatusBadge status={rfq.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default RFQList;