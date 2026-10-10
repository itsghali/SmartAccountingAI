"use client";

import { useState, useEffect, useCallback } from "react";
import { AccountTree } from "@/components/accounts/AccountTree";
import { AccountForm } from "@/components/accounts/AccountForm";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface Account {
  id: string;
  code: string;
  label: string;
  labelAr?: string;
  classNumber: number;
  accountType: string;
  parentCode: string | null;
  isSystem: boolean;
  isActive: boolean;
  isAuxiliary: boolean;
  isTiers: boolean;
  requiresAnalytical: boolean;
  vatRate?: number;
  vatType?: string;
}

export default function AccountsPage() {
  const { currentCompanyId } = useAppContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAccounts = useCallback(async () => {
    if (!currentCompanyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts?companyId=${currentCompanyId}&limit=1000`);
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  if (!currentCompanyId) {
    return (
      <div className="p-6 text-gray-500">
        Veuillez sélectionner une société.
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left panel - Tree */}
      <div className="w-[450px] border-r flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Plan Comptable</h1>
          <Button
            size="sm"
            onClick={() => {
              setShowNewForm(true);
              setSelectedAccount(null);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Nouveau
          </Button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400">Chargement...</div>
        ) : (
          <AccountTree
            accounts={accounts}
            onSelect={(a) => {
              setSelectedAccount(a as Account);
              setShowNewForm(false);
            }}
            selectedCode={selectedAccount?.code}
          />
        )}
      </div>

      {/* Right panel - Detail/Form */}
      <div className="flex-1 overflow-y-auto">
        {showNewForm ? (
          <AccountForm
            companyId={currentCompanyId}
            onSaved={() => {
              setShowNewForm(false);
              loadAccounts();
            }}
          />
        ) : selectedAccount ? (
          <AccountForm
            account={selectedAccount}
            companyId={currentCompanyId}
            onSaved={loadAccounts}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            <p>Sélectionnez un compte ou créez-en un nouveau</p>
          </div>
        )}
      </div>
    </div>
  );
}
