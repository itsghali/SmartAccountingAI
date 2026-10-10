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
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Tableau de Bord</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpiCards.map((kpi) => (
          <Card key={kpi.title}>
            <CardContent className="flex items-center gap-4 pt-0">
              <div className={`rounded-lg p-3 ${kpi.bg}`}>
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Chiffre d{"'"}Affaires vs Charges par Mois
            </CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => formatMAD(v)} />
                  <Tooltip
                    formatter={(value) => [
                      `${formatMAD(Number(value))} MAD`,
                    ]}
                  />
                  <Legend />
                  <Bar
                    dataKey="revenue"
                    name="Chiffre d'Affaires"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="expenses"
                    name="Charges"
                    fill="#ef4444"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-gray-400 py-12">
                Aucune donnée mensuelle disponible
              </p>
            )}
          </CardContent>
        </Card>

        {/* Expense Breakdown Donut Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Répartition des Charges
            </CardTitle>
          </CardHeader>
          <CardContent>
            {expenseCategories.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={expenseCategories}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) =>
                      `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`
                    }
                    labelLine
                  >
                    {expenseCategories.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={DONUT_COLORS[index % DONUT_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [
                      `${formatMAD(Number(value))} MAD`,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-gray-400 py-12">
                Aucune charge enregistrée
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
