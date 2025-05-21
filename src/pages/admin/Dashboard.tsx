
import React from "react";
import { useData } from "@/contexts/DataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  LineChart,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { ChartLineUp, ChartPie, ContainerIcon, FileChart, Ship } from "lucide-react";

const AdminDashboard = () => {
  const { rfqs, quotes, allocations } = useData();

  // RFQ Status Data
  const statusData = React.useMemo(() => {
    const statusCounts = {
      initial: 0,
      evaluation: 0,
      closed: 0,
    };

    rfqs.forEach((rfq) => {
      statusCounts[rfq.status]++;
    });

    return [
      { name: "Initial", value: statusCounts.initial, color: "#3b82f6" },
      { name: "Evaluation", value: statusCounts.evaluation, color: "#f59e0b" },
      { name: "Closed", value: statusCounts.closed, color: "#10b981" },
    ];
  }, [rfqs]);

  // Container Type Data
  const containerTypeData = React.useMemo(() => {
    const containerCounts = {
      LCL: 0,
      "20' OT": 0,
      "40'OT": 0,
    };

    rfqs.forEach((rfq) => {
      containerCounts[rfq.containerType] += rfq.numberOfContainers;
    });

    return [
      { name: "LCL", value: containerCounts["LCL"], color: "#3b82f6" },
      { name: "20' OT", value: containerCounts["20' OT"], color: "#f59e0b" },
      { name: "40'OT", value: containerCounts["40'OT"], color: "#10b981" },
    ];
  }, [rfqs]);

  // Port of Loading Data
  const portOfLoadingData = React.useMemo(() => {
    const portCounts = {
      beijing: 0,
      shanghai: 0,
      ningbo: 0,
    };

    rfqs.forEach((rfq) => {
      portCounts[rfq.portOfLoading] += rfq.numberOfContainers;
    });

    return [
      { name: "Beijing", value: portCounts.beijing },
      { name: "Shanghai", value: portCounts.shanghai },
      { name: "Ningbo", value: portCounts.ningbo },
    ];
  }, [rfqs]);

  // Port of Destination Data
  const portOfDestinationData = React.useMemo(() => {
    const portCounts = {
      chennai: 0,
      hyderabad: 0,
      goa: 0,
    };

    rfqs.forEach((rfq) => {
      portCounts[rfq.portOfDestination] += rfq.numberOfContainers;
    });

    return [
      { name: "Chennai", value: portCounts.chennai },
      { name: "Hyderabad", value: portCounts.hyderabad },
      { name: "Goa", value: portCounts.goa },
    ];
  }, [rfqs]);

  // Vendor Participation Data
  const vendorParticipationData = React.useMemo(() => {
    const vendorCounts = {};

    quotes.forEach((quote) => {
      vendorCounts[quote.vendorName] = (vendorCounts[quote.vendorName] || 0) + 1;
    });

    return Object.entries(vendorCounts).map(([name, value]) => ({
      name,
      value,
      color: "#8b5cf6",
    }));
  }, [quotes]);

  // Monthly RFQ trend
  const monthlyRFQTrend = React.useMemo(() => {
    const monthData = {};
    
    rfqs.forEach((rfq) => {
      const date = new Date(rfq.createdAt);
      const monthYear = `${date.getMonth() + 1}/${date.getFullYear()}`;
      
      if (!monthData[monthYear]) {
        monthData[monthYear] = {
          name: monthYear,
          count: 0,
          containers: 0,
        };
      }
      
      monthData[monthYear].count += 1;
      monthData[monthYear].containers += rfq.numberOfContainers;
    });
    
    return Object.values(monthData);
  }, [rfqs]);

  // LEAFI allocation vs deviation
  const allocationData = React.useMemo(() => {
    let followedLeafi = 0;
    let deviated = 0;

    allocations.forEach((allocation) => {
      const quote = quotes.find(q => q.id === allocation.quoteId);
      if (!quote) return;
      
      // Simple check to determine if LEAFI's allocation was followed or deviated
      // This is a simplified logic and should be refined based on actual business rules
      if (allocation.containersAllottedHome === quote.containersAllottedHome &&
          allocation.containersAllottedMOOWR === quote.containersAllottedMOOWR) {
        followedLeafi++;
      } else {
        deviated++;
      }
    });

    return [
      { name: "Followed LEAFI", value: followedLeafi, color: "#10b981" },
      { name: "Deviated", value: deviated, color: "#ef4444" },
    ];
  }, [allocations, quotes]);

  // Overview metrics
  const metrics = React.useMemo(() => {
    const totalRFQs = rfqs.length;
    const totalQuotes = quotes.length;
    const totalContainers = rfqs.reduce((sum, rfq) => sum + rfq.numberOfContainers, 0);
    const totalAllocated = allocations.reduce(
      (sum, alloc) => sum + alloc.containersAllottedHome + alloc.containersAllottedMOOWR, 
      0
    );

    return {
      totalRFQs,
      totalQuotes,
      avgQuotePerRFQ: totalRFQs ? (totalQuotes / totalRFQs).toFixed(2) : 0,
      totalContainers,
      totalAllocated,
      pendingAllocation: totalContainers - totalAllocated,
    };
  }, [rfqs, quotes, allocations]);

  const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8", "#82ca9d"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <Badge variant="outline" className="text-lg font-semibold">
          Analytics Overview
        </Badge>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total RFQs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{metrics.totalRFQs}</div>
              <FileChart className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Quotes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{metrics.totalQuotes}</div>
              <ChartLineUp className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Avg {metrics.avgQuotePerRFQ} quotes per RFQ
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Containers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{metrics.totalContainers}</div>
              <ContainerIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics.totalAllocated} allocated / {metrics.pendingAllocation} pending
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Allocation Decisions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{allocations.length}</div>
              <ChartPie className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* RFQ Status Chart */}
        <Card>
          <CardHeader>
            <CardTitle>RFQ Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ChartContainer
              config={{
                initial: { color: "#3b82f6" },
                evaluation: { color: "#f59e0b" },
                closed: { color: "#10b981" }
              }}
            >
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltipContent />} />
                <Legend />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Container Types Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Container Types Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ChartContainer
              config={{
                LCL: { color: "#3b82f6" },
                "20' OT": { color: "#f59e0b" },
                "40'OT": { color: "#10b981" }
              }}
            >
              <BarChart data={containerTypeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend />
                <Bar dataKey="value" name="Containers" fill="#8884d8">
                  {containerTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        
        {/* Port of Loading */}
        <Card>
          <CardHeader>
            <CardTitle>Port of Loading Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ChartContainer
              config={{
                Beijing: { color: "#3b82f6" },
                Shanghai: { color: "#f59e0b" },
                Ningbo: { color: "#10b981" }
              }}
            >
              <BarChart data={portOfLoadingData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend />
                <Bar dataKey="value" name="Containers">
                  {portOfLoadingData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        
        {/* Port of Destination */}
        <Card>
          <CardHeader>
            <CardTitle>Port of Destination Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ChartContainer
              config={{
                Chennai: { color: "#3b82f6" },
                Hyderabad: { color: "#f59e0b" },
                Goa: { color: "#10b981" }
              }}
            >
              <BarChart data={portOfDestinationData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend />
                <Bar dataKey="value" name="Containers">
                  {portOfDestinationData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        
        {/* Vendor Participation */}
        <Card>
          <CardHeader>
            <CardTitle>Vendor Participation</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ChartContainer config={{}}>
              <PieChart>
                <Pie
                  data={vendorParticipationData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                >
                  {vendorParticipationData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
        
        {/* LEAFI Allocation vs Deviation */}
        <Card>
          <CardHeader>
            <CardTitle>LEAFI Allocation vs Deviation</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ChartContainer
              config={{
                "Followed LEAFI": { color: "#10b981" },
                "Deviated": { color: "#ef4444" },
              }}
            >
              <PieChart>
                <Pie
                  data={allocationData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                >
                  {allocationData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltipContent />} />
                <Legend />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
        
        {/* Monthly RFQ Trend */}
        <Card className="col-span-1 md:col-span-2">
          <CardHeader>
            <CardTitle>Monthly RFQ Trend</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ChartContainer
              config={{
                count: { color: "#3b82f6" },
                containers: { color: "#10b981" }
              }}
            >
              <LineChart data={monthlyRFQTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend />
                <Line 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="count" 
                  name="RFQs" 
                  stroke="#3b82f6" 
                  activeDot={{ r: 8 }} 
                />
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="containers" 
                  name="Containers" 
                  stroke="#10b981" 
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminDashboard;
