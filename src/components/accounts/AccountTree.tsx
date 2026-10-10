"use client";

import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getClassColor } from "@/lib/utils/account-helpers";

interface Account {
  id: string;
  code: string;
  label: string;
  classNumber: number;
  parentCode: string | null;
  isSystem: boolean;
  isActive: boolean;
  isTiers: boolean;
}

interface AccountTreeProps {
  accounts: Account[];
  onSelect: (account: Account) => void;
  selectedCode?: string;
}

interface TreeNode {
  account: Account;
  children: TreeNode[];
}

function buildTree(accounts: Account[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Create nodes
  for (const account of accounts) {
    map.set(account.code, { account, children: [] });
  }

  // Build tree
  for (const account of accounts) {
    const node = map.get(account.code)!;
    if (account.parentCode && map.has(account.parentCode)) {
      map.get(account.parentCode)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function TreeNodeItem({
  node,
  level,
  onSelect,
  selectedCode,
  expandedCodes,
  toggleExpand,
  searchTerm,
}: {
  node: TreeNode;
  level: number;
  onSelect: (account: Account) => void;
  selectedCode?: string;
  expandedCodes: Set<string>;
  toggleExpand: (code: string) => void;
  searchTerm: string;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedCodes.has(node.account.code);
  const isSelected = selectedCode === node.account.code;

  // If searching, show only if matches or has matching descendants
  if (searchTerm) {
    const matches =
      node.account.code.includes(searchTerm) ||
      node.account.label.toLowerCase().includes(searchTerm.toLowerCase());
    const hasMatchingDescendant = node.children.some(
      (c) =>
        c.account.code.includes(searchTerm) ||
        c.account.label.toLowerCase().includes(searchTerm.toLowerCase())
    );
    if (!matches && !hasMatchingDescendant) return null;
  }

  return (
    <>
      <div
        className={`flex items-center py-2 px-2 cursor-pointer transition-colors rounded-md text-sm ${
          isSelected ? "bg-primary/10" : "hover:bg-primary/5"
        }`}
        style={{ paddingLeft: `${level * 20 + 8}px` }}
        onClick={() => onSelect(node.account)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(node.account.code);
            }}
            className="mr-1.5 p-1 hover:bg-muted rounded-md transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-6" />
        )}
        <span className={`font-mono font-bold mr-3 ${getClassColor(node.account.classNumber)}`}>
          {node.account.code}
        </span>
        <span className="text-foreground font-medium truncate">{node.account.label}</span>
        {node.account.isTiers && (
          <span className="ml-3 text-[10px] uppercase tracking-wider font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full">
            Tiers
          </span>
        )}
        {!node.account.isActive && (
          <span className="ml-2 text-[10px] uppercase tracking-wider font-semibold bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
            Inactif
          </span>
        )}
      </div>
      {isExpanded &&
        node.children
          .sort((a, b) => a.account.code.localeCompare(b.account.code))
          .map((child) => (
            <TreeNodeItem
              key={child.account.code}
              node={child}
              level={level + 1}
              onSelect={onSelect}
              selectedCode={selectedCode}
              expandedCodes={expandedCodes}
              toggleExpand={toggleExpand}
              searchTerm={searchTerm}
            />
          ))}
    </>
  );
}

export function AccountTree({ accounts, onSelect, selectedCode }: AccountTreeProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(
    new Set(["1", "2", "3", "4", "5", "6", "7"])
  );

  const tree = useMemo(() => buildTree(accounts), [accounts]);

  const toggleExpand = (code: string) => {
    setExpandedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // Auto-expand all when searching
  const effectiveExpanded = searchTerm
    ? new Set(accounts.map((a) => a.code))
    : expandedCodes;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border/50 bg-muted/10">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Rechercher par code ou libellé..."
            className="pl-9 bg-card/50 border-border/50"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {tree
          .sort((a, b) => a.account.code.localeCompare(b.account.code))
          .map((node) => (
            <TreeNodeItem
              key={node.account.code}
              node={node}
              level={0}
              onSelect={onSelect}
              selectedCode={selectedCode}
              expandedCodes={effectiveExpanded}
              toggleExpand={toggleExpand}
              searchTerm={searchTerm}
            />
          ))}
      </div>
    </div>
  );
}
