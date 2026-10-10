"use client";



import { useState } from "react";

import Link from "next/link";

import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import {

  LayoutDashboard,

  PenLine,

  BookOpen,

  Notebook,

  Receipt,

  Building2,

  GitBranch,

  FileSpreadsheet,
  FileText,
  FileSearch,
  BarChart3,
  BookMarked,

  Scale,

  Clock,

  PieChart,

  CreditCard,

  ArrowLeftRight,

  Settings,

  Building,

  CalendarDays,

  Users,

  Import,

  ChevronDown,

  ChevronRight,

  PanelLeftClose,

  PanelLeft,

  FileStack,
  ShieldCheck,
  ShieldAlert,

} from "lucide-react";



interface NavItem {

  label: string;

  href?: string;

  icon: React.ReactNode;

  children?: { label: string; href: string; icon: React.ReactNode }[];

}



const navItems: NavItem[] = [

  {

    label: "Dashboard",

    href: "/",

    icon: <LayoutDashboard className="size-4" />,

  },

  {

    label: "Saisie Comptable",

    href: "/entries",

    icon: <PenLine className="size-4" />,

  },

  {

    label: "Plan Comptable",

    href: "/accounts",

    icon: <BookOpen className="size-4" />,

  },

  {

    label: "Journaux",

    href: "/journals",

    icon: <Notebook className="size-4" />,

  },

  {
    label: "Documents",
    href: "/documents",
    icon: <FileStack className="size-4" />,
  },
  {
    label: "Approved Documents",
    href: "/approved-documents",
    icon: <FileSearch className="size-4" />,
  },
  {

    label: "TVA",

    href: "/vat/declarations",

    icon: <Receipt className="size-4" />,

  },

  {

    label: "Immobilisations",

    href: "/fixed-assets",

    icon: <Building2 className="size-4" />,

  },

  {

    label: "Analytique",

    href: "/analytical/grids",

    icon: <GitBranch className="size-4" />,

  },

  {

    label: "Paie",

    href: "/payroll",

    icon: <Users className="size-4" />,

  },

  {

    label: "Cloture",

    href: "/closing",

    icon: <ShieldCheck className="size-4" />,

  },

  {

    label: "Audit",

    href: "/audit",

    icon: <ShieldAlert className="size-4" />,

  },

  {

    label: "Liasse Fiscale",

    href: "/tax-package",

    icon: <FileSpreadsheet className="size-4" />,

  },

  {

    label: "Rapports",

    icon: <BarChart3 className="size-4" />,

    children: [

      {

        label: "Journal",

        href: "/reports/journal",

        icon: <FileText className="size-4" />,

      },

      {

        label: "Grand Livre",

        href: "/reports/general-ledger",

        icon: <BookMarked className="size-4" />,

      },

      {

        label: "Balance",

        href: "/reports/trial-balance",

        icon: <Scale className="size-4" />,

      },

      {

        label: "Balance Agee",

        href: "/reports/aged-balance",

        icon: <Clock className="size-4" />,

      },

      {

        label: "Etats Financiers",

        href: "/reports/financial-statements",

        icon: <PieChart className="size-4" />,

      },

      {

        label: "Etats TVA",

        href: "/reports/vat-statements",

        icon: <CreditCard className="size-4" />,

      },

    ],

  },

  {

    label: "Rapprochement",

    href: "/reconciliation",

    icon: <ArrowLeftRight className="size-4" />,

  },

  {

    label: "Parametres",

    icon: <Settings className="size-4" />,

    children: [

      {

        label: "Societe",

        href: "/settings/company",

        icon: <Building className="size-4" />,

      },

      {

        label: "Exercices",

        href: "/settings/fiscal-years",

        icon: <CalendarDays className="size-4" />,

      },

      {

        label: "Utilisateurs",

        href: "/settings/users",

        icon: <Users className="size-4" />,

      },

    ],

  },

  {

    label: "Import/Export",

    href: "/import-export",

    icon: <Import className="size-4" />,

  },

];



export default function Sidebar() {

  const pathname = usePathname();

  const [collapsed, setCollapsed] = useState(false);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(

    new Set()

  );



  function toggleSection(label: string) {

    setExpandedSections((prev) => {

      const next = new Set(prev);

      if (next.has(label)) {

        next.delete(label);

      } else {

        next.add(label);

      }

      return next;

    });

  }



  function isActive(href: string) {

    if (href === "/") return pathname === "/";

    return pathname.startsWith(href);

  }



  function isChildActive(item: NavItem) {

    return item.children?.some((child) => isActive(child.href)) ?? false;

  }



  return (

    <>

      {/* Mobile overlay */}

      <div

        className={cn(

          "fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden",

          collapsed ? "pointer-events-none opacity-0" : "opacity-100"

        )}

        onClick={() => setCollapsed(true)}

      />



      <aside

        className={cn(

          "fixed left-0 top-0 z-50 flex h-screen flex-col bg-slate-900 text-slate-300 transition-all duration-300",

          "lg:relative lg:z-auto",

          collapsed ? "w-16" : "w-64",

          // On mobile, hide completely when collapsed

          collapsed ? "-translate-x-full lg:translate-x-0" : "translate-x-0"

        )}

      >

        {/* Brand area */}

        <div className="flex h-14 items-center justify-between border-b border-slate-700 px-4">

          {!collapsed && (

            <span className="text-lg font-bold text-white">SmartAccountingAI</span>

          )}

          <button

            onClick={() => setCollapsed(!collapsed)}

            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"

            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}

          >

            {collapsed ? (

              <PanelLeft className="size-4" />

            ) : (

              <PanelLeftClose className="size-4" />

            )}

          </button>

        </div>



        {/* Navigation */}

        <nav className="flex-1 overflow-y-auto px-2 py-3">

          <ul className="space-y-0.5">

            {navItems.map((item) => {

              const hasChildren = !!item.children;

              const isExpanded =

                expandedSections.has(item.label) || isChildActive(item);

              const active = item.href ? isActive(item.href) : false;



              return (

                <li key={item.label}>

                  {hasChildren ? (

                    <>

                      <button

                        onClick={() => {

                          if (collapsed) {

                            setCollapsed(false);

                            setExpandedSections(

                              (prev) => new Set([...prev, item.label])

                            );

                          } else {

                            toggleSection(item.label);

                          }

                        }}

                        className={cn(

                          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",

                          "hover:bg-slate-800 hover:text-white",

                          isChildActive(item) && "text-white"

                        )}

                        title={collapsed ? item.label : undefined}

                      >

                        <span className="flex-shrink-0">{item.icon}</span>

                        {!collapsed && (

                          <>

                            <span className="flex-1 text-left">

                              {item.label}

                            </span>

                            {isExpanded ? (

                              <ChevronDown className="size-3.5" />

                            ) : (

                              <ChevronRight className="size-3.5" />

                            )}

                          </>

                        )}

                      </button>

                      {/* Sub-items */}

                      {!collapsed && isExpanded && (

                        <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-700 pl-3">

                          {item.children!.map((child) => (

                            <li key={child.href}>

                              <Link

                                href={child.href}

                                className={cn(

                                  "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors",

                                  "hover:bg-slate-800 hover:text-white",

                                  isActive(child.href)

                                    ? "bg-slate-800 text-white font-medium"

                                    : "text-slate-400"

                                )}

                              >

                                <span className="flex-shrink-0">

                                  {child.icon}

                                </span>

                                <span>{child.label}</span>

                              </Link>

                            </li>

                          ))}

                        </ul>

                      )}

                    </>

                  ) : (

                    <Link

                      href={item.href!}

                      className={cn(

                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",

                        "hover:bg-slate-800 hover:text-white",

                        active

                          ? "bg-slate-800 text-white"

                          : "text-slate-400"

                      )}

                      title={collapsed ? item.label : undefined}

                    >

                      <span className="flex-shrink-0">{item.icon}</span>

                      {!collapsed && <span>{item.label}</span>}

                    </Link>

                  )}

                </li>

              );

            })}

          </ul>

        </nav>



        {/* Footer */}

        {!collapsed && (

          <div className="border-t border-slate-700 px-4 py-3">

            <p className="text-xs text-slate-500">SmartAccountingAI v0.1.0</p>

          </div>

        )}

      </aside>

    </>

  );

}

