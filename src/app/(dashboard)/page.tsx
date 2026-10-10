"use client";

import { useState, useEffect } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMAD } from "@/lib/utils/currency";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Landmark,
  TrendingUp,
  TrendingDown,
  Calculator,
  Users,
  Building2,
  PieChart as PieChartIcon,
} from "lucide-react";

interface DashboardData {
  kpis: {
    treasury: number;
    revenue: number;
    expenses: number;
    result: number;
    receivables: number;
    payables: number;
  };
  monthlyData: { month: string; revenue: number; expenses: number }[];
  expenseCategories: { name: string; value: number }[];
}

const DONUT_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

export default function DashboardPage() {
  const { currentCompanyId, currentFiscalYearId, isLoading: ctxLoading } =
    useAppContext();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentCompanyId || !currentFiscalYearId) {
      setData(null);
      setLoading(false);
      return;
    }

    const loadDashboard = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          companyId: currentCompanyId,
          fiscalYearId: currentFiscalYearId,
        });
        const response = await fetch(`/api/reports/dashboard?${params}`);
        const payload = await response.json();
        setData(payload);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    };

    void loadDashboard();
  }, [currentCompanyId, currentFiscalYearId]);

  if (ctxLoading || loading) {
    return (
      <div className="p-6 text-gray-500">Chargement du tableau de bord...</div>
    );
  }

  if (!currentCompanyId || !currentFiscalYearId) {
    return (
      <div className="p-6 text-gray-500">
        Veuillez sélectionner une société et un exercice comptable.
      </div>
    );
  }

  if (!data || !data.kpis) {
    return (
      <div className="p-6 text-gray-500">
        Impossible de charger les données du tableau de bord.
      </div>
    );
  }

  const { kpis, monthlyData, expenseCategories } = data;

  const kpiCards = [
    {
      title: "Trésorerie",
      value: kpis.treasury,
      icon: Landmark,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      title: "Chiffre d'Affaires",
      value: kpis.revenue,
      icon: TrendingUp,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      title: "Charges",
      value: kpis.expenses,
      icon: TrendingDown,
      color: "text-red-600",
      bg: "bg-red-50",
    },
    {
      title: "Résultat",
      value: kpis.result,
      icon: Calculator,
      color: kpis.result >= 0 ? "text-green-600" : "text-red-600",
      bg: kpis.result >= 0 ? "bg-green-50" : "bg-red-50",
    },
    {
      title: "Créances Clients",
      value: kpis.receivables,
      icon: Users,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      title: "Dettes Fournisseurs",
      value: kpis.payables,
      icon: Building2,
      color: "text-purple-600",
      bg: "bg-purple-50",
    },
  ];

  return (
    <div className="p-6 space-y-8 min-h-screen bg-linear-to-br from-background via-background/95 to-muted/30 animate-in fade-in duration-700">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary">
          Tableau de Bord
        </h1>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpiCards.map((kpi) => (
          <Card key={kpi.title} className="bg-card/60 backdrop-blur-md border-border/50 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 group">
            <CardContent className="flex items-center gap-4 pt-0">
              <div className={`rounded-xl p-3 ${kpi.bg} shadow-inner transition-transform duration-300 group-hover:scale-110`}>
                <kpi.icon className={`h-6 w-6 ${kpi.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-muted-foreground truncate">
                  {kpi.title}
                </p>
                <p className={`text-xl font-bold font-mono ${kpi.color}`}>
                  {formatMAD(kpi.value)} <span className="text-xs font-normal">MAD</span>
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Revenue vs Expenses Bar Chart */}
        <Card className="bg-card/40 backdrop-blur-2xl border-white/10 shadow-2xl hover:shadow-primary/5 transition-all duration-500 overflow-hidden relative group">
          <div className="absolute inset-0 bg-linear-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
          <CardHeader>
            <CardTitle className="text-lg font-medium text-foreground/80 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Chiffre d{"'"}Affaires vs Charges par Mois
            </CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.2}/>
                    </linearGradient>
                    <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0.2}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.05} />
                  <XAxis 
                    dataKey="month" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false}
                    tick={{ fill: "currentColor", opacity: 0.6 }}
                    dy={10}
                  />
                  <YAxis 
                    fontSize={12} 
                    tickFormatter={(v) => formatMAD(Number(v))} 
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "currentColor", opacity: 0.6 }}
                  />
                  <Tooltip
                    cursor={{ fill: "currentColor", opacity: 0.05 }}
                    contentStyle={{ 
                      backgroundColor: "rgba(var(--background), 0.8)", 
                      backdropFilter: "blur(12px)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "12px",
                      boxShadow: "0 10px 40px -10px rgba(0,0,0,0.3)"
                    }}
                    itemStyle={{ fontWeight: 500 }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any) => [`${formatMAD(Number(value))} MAD`]}
                  />
                  <Legend wrapperStyle={{ paddingTop: "20px", opacity: 0.8, fontSize: "13px" }} />
                  <Bar
                    dataKey="revenue"
                    name="Chiffre d'Affaires"
                    fill="url(#colorRevenue)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={40}
                  />
                  <Bar
                    dataKey="expenses"
                    name="Charges"
                    fill="url(#colorExpenses)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={40}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-12">
                Aucune donnée mensuelle disponible
              </p>
            )}
          </CardContent>
        </Card>

        {/* Expense Breakdown Donut Chart */}
        <Card className="bg-card/40 backdrop-blur-2xl border-white/10 shadow-2xl hover:shadow-primary/5 transition-all duration-500 overflow-hidden relative group">
          <div className="absolute inset-0 bg-linear-to-bl from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
          <CardHeader>
            <CardTitle className="text-lg font-medium text-foreground/80 flex items-center gap-2">
              <PieChartIcon className="h-5 w-5 text-purple-500" />
              Répartition des Charges
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {expenseCategories.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <defs>
                    {expenseCategories.map((_, index) => (
                      <linearGradient key={`grad-${index}`} id={`grad-${index}`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={DONUT_COLORS[index % DONUT_COLORS.length]} stopOpacity={1} />
                        <stop offset="100%" stopColor={DONUT_COLORS[index % DONUT_COLORS.length]} stopOpacity={0.6} />
                      </linearGradient>
                    ))}
                  </defs>
                  <Pie
                    data={expenseCategories}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={110}
                    paddingAngle={4}
                    stroke="none"
                    dataKey="value"
                    nameKey="name"
                    cornerRadius={8}
                  >
                    {expenseCategories.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={`url(#grad-${index})`}
                        style={{ filter: "drop-shadow(0px 4px 6px rgba(0,0,0,0.1))" }}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ 
                      backgroundColor: "rgba(var(--background), 0.8)", 
                      backdropFilter: "blur(12px)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "12px",
                      boxShadow: "0 10px 40px -10px rgba(0,0,0,0.3)"
                    }}
                    itemStyle={{ fontWeight: 500, color: "inherit" }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any, name: any, props: any) => [
                      `${formatMAD(Number(value))} MAD`,
                      `${name} (${((props.payload.percent ?? 0) * 100).toFixed(1)}%)`
                    ]}
                  />
                  <Legend 
                    layout="vertical" 
                    verticalAlign="middle" 
                    align="right"
                    wrapperStyle={{ opacity: 0.8, fontSize: "13px", paddingLeft: "20px" }}
                    iconType="circle"
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-12">
                Aucune charge enregistrée
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
