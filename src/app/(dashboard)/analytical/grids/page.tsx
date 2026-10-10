"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  Layers,
  GitBranch,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AnalyticalPost {
  id: string;
  gridId: string;
  code: string;
  label: string;
  parentId: string | null;
  isActive: boolean;
}

interface AnalyticalGrid {
  id: string;
  companyId: string;
  code: string;
  label: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count: { posts: number };
}

// ─── PostTree ────────────────────────────────────────────────────────────────

interface PostNode extends AnalyticalPost {
  children: PostNode[];
}

function buildTree(posts: AnalyticalPost[]): PostNode[] {
  const map = new Map<string, PostNode>();
  posts.forEach((p) => map.set(p.id, { ...p, children: [] }));

  const roots: PostNode[] = [];
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Sort children by code
  const sortChildren = (nodes: PostNode[]) => {
    nodes.sort((a, b) => a.code.localeCompare(b.code));
    nodes.forEach((n) => sortChildren(n.children));
  };
  sortChildren(roots);
  return roots;
}

function PostTreeNode({
  node,
  depth = 0,
}: {
  node: PostNode;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 px-3 hover:bg-gray-50 rounded text-sm"
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-gray-400 hover:text-gray-600"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="w-3.5" />
        )}
        <span className="font-mono text-xs font-semibold text-blue-700 w-20 shrink-0">
          {node.code}
        </span>
        <span className="flex-1 text-gray-800">{node.label}</span>
        {node.parentId ? (
          <span className="text-xs text-gray-400 italic">sous-poste</span>
        ) : (
          <span className="text-xs text-gray-400">racine</span>
        )}
        {!node.isActive && (
          <Badge variant="secondary" className="text-xs">
            Inactif
          </Badge>
        )}
      </div>
      {expanded &&
        node.children.map((child) => (
          <PostTreeNode key={child.id} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

// ─── PostsSection ─────────────────────────────────────────────────────────────

function PostsSection({ gridId }: { gridId: string }) {
  const [posts, setPosts] = useState<AnalyticalPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newPost, setNewPost] = useState({ code: "", label: "", parentId: "" });
  const [saving, setSaving] = useState(false);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytical/grids/${gridId}/posts`);
      if (res.ok) setPosts(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [gridId]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const handleAddPost = async () => {
    if (!newPost.code.trim() || !newPost.label.trim()) {
      toast.error("Le code et le libellé sont requis");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/analytical/grids/${gridId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: newPost.code.trim(),
          label: newPost.label.trim(),
          parentId: newPost.parentId || null,
        }),
      });
      if (res.ok) {
        toast.success("Poste analytique créé");
        setShowAddDialog(false);
        setNewPost({ code: "", label: "", parentId: "" });
        loadPosts();
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur lors de la création");
      }
    } catch {
      toast.error("Erreur de connexion");
    } finally {
      setSaving(false);
    }
  };

  const tree = buildTree(posts);

  return (
    <div className="bg-gray-50 border-t border-gray-100 px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <GitBranch className="h-4 w-4 text-blue-500" />
          Postes analytiques
          <span className="text-xs font-normal text-gray-400">
            ({posts.length} poste{posts.length !== 1 ? "s" : ""})
          </span>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger>
            <Button size="sm" variant="outline">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nouveau poste
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Nouveau poste analytique</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 mt-2">
              <div>
                <Label>Code *</Label>
                <Input
                  value={newPost.code}
                  onChange={(e) =>
                    setNewPost({ ...newPost, code: e.target.value })
                  }
                  placeholder="A1"
                  className="font-mono mt-1"
                />
              </div>
              <div>
                <Label>Libellé *</Label>
                <Input
                  value={newPost.label}
                  onChange={(e) =>
                    setNewPost({ ...newPost, label: e.target.value })
                  }
                  placeholder="Libellé du poste"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Poste parent (optionnel)</Label>
                <Select
                  value={newPost.parentId || "none"}
                  onValueChange={(v) =>
                    v !== null &&
                    setNewPost({
                      ...newPost,
                      parentId: v === "none" ? "" : v,
                    })
                  }
                >
                  <SelectTrigger className="w-full mt-1">
                    <SelectValue placeholder="Aucun (racine)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun (racine)</SelectItem>
                    {posts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.code} — {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleAddPost}
                disabled={saving}
                className="w-full"
              >
                {saving ? "Création..." : "Créer le poste"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 py-2">Chargement...</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-gray-400 py-2 italic">
          Aucun poste. Cliquez sur &quot;Nouveau poste&quot; pour commencer.
        </p>
      ) : (
        <div className="border rounded-lg bg-white overflow-hidden">
          {tree.map((node) => (
            <PostTreeNode key={node.id} node={node} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AnalyticalGridsPage() {
  const { currentCompanyId } = useAppContext();
  const [grids, setGrids] = useState<AnalyticalGrid[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterActive, setFilterActive] = useState("all");
  const [expandedGridId, setExpandedGridId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newGrid, setNewGrid] = useState({ code: "", label: "" });
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const loadGrids = useCallback(async () => {
    if (!currentCompanyId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/analytical/grids?companyId=${currentCompanyId}`
      );
      if (res.ok) setGrids(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId]);

  useEffect(() => {
    loadGrids();
  }, [loadGrids]);

  const handleCreateGrid = async () => {
    if (!currentCompanyId) return;
    if (!newGrid.code.trim() || !newGrid.label.trim()) {
      toast.error("Le code et le libellé sont requis");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/analytical/grids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: currentCompanyId,
          code: newGrid.code.trim(),
          label: newGrid.label.trim(),
        }),
      });
      if (res.ok) {
        toast.success("Grille analytique créée");
        setShowNewDialog(false);
        setNewGrid({ code: "", label: "" });
        loadGrids();
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur lors de la création");
      }
    } catch {
      toast.error("Erreur de connexion");
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (grid: AnalyticalGrid) => {
    setToggling(grid.id);
    try {
      const res = await fetch(`/api/analytical/grids/${grid.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !grid.isActive }),
      });
      if (res.ok) {
        toast.success(
          grid.isActive ? "Grille désactivée" : "Grille activée"
        );
        loadGrids();
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur");
      }
    } catch {
      toast.error("Erreur de connexion");
    } finally {
      setToggling(null);
    }
  };

  const toggleExpand = (gridId: string) => {
    setExpandedGridId((prev) => (prev === gridId ? null : gridId));
  };

  const filtered = grids.filter((g) => {
    if (filterActive === "active") return g.isActive;
    if (filterActive === "inactive") return !g.isActive;
    return true;
  });

  const totalGrids = grids.length;
  const activeGrids = grids.filter((g) => g.isActive).length;
  const totalPosts = grids.reduce((sum, g) => sum + g._count.posts, 0);

  if (!currentCompanyId) {
    return (
      <div className="p-6 text-gray-500">Veuillez sélectionner une société.</div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Grilles Analytiques
        </h1>
        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogTrigger>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nouvelle grille
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Nouvelle grille analytique</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 mt-2">
              <div>
                <Label>Code *</Label>
                <Input
                  value={newGrid.code}
                  onChange={(e) =>
                    setNewGrid({ ...newGrid, code: e.target.value })
                  }
                  placeholder="GA1"
                  className="font-mono mt-1"
                />
              </div>
              <div>
                <Label>Libellé *</Label>
                <Input
                  value={newGrid.label}
                  onChange={(e) =>
                    setNewGrid({ ...newGrid, label: e.target.value })
                  }
                  placeholder="Centres de coûts"
                  className="mt-1"
                />
              </div>
              <Button
                onClick={handleCreateGrid}
                disabled={creating}
                className="w-full"
              >
                {creating ? "Création..." : "Créer la grille"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-gray-500">Total grilles</p>
            <p className="text-3xl font-bold text-gray-900">{totalGrids}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-gray-500">Grilles actives</p>
            <p className="text-3xl font-bold text-green-600">{activeGrids}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-gray-500">Total postes</p>
            <p className="text-3xl font-bold text-blue-600">{totalPosts}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex gap-4 mb-4">
        <Select
          value={filterActive}
          onValueChange={(v) => v !== null && setFilterActive(v)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Tous les statuts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            <SelectItem value="active">Actives</SelectItem>
            <SelectItem value="inactive">Inactives</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="p-3 text-left w-8"></th>
              <th className="p-3 text-left">Code</th>
              <th className="p-3 text-left">Libellé</th>
              <th className="p-3 text-center">Nb postes</th>
              <th className="p-3 text-center">Statut</th>
              <th className="p-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-400">
                  Chargement...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-400">
                  Aucune grille analytique
                </td>
              </tr>
            ) : (
              filtered.map((grid) => (
                <>
                  <tr
                    key={grid.id}
                    className="border-t hover:bg-gray-50 transition-colors"
                  >
                    {/* Expand toggle */}
                    <td className="p-3">
                      <button
                        onClick={() => toggleExpand(grid.id)}
                        className="text-gray-400 hover:text-gray-700"
                        title={
                          expandedGridId === grid.id
                            ? "Masquer les postes"
                            : "Afficher les postes"
                        }
                      >
                        {expandedGridId === grid.id ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                    <td className="p-3 font-mono text-sm font-semibold text-blue-700">
                      {grid.code}
                    </td>
                    <td className="p-3 text-sm text-gray-800">{grid.label}</td>
                    <td className="p-3 text-center">
                      <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                        <Layers className="h-3.5 w-3.5 text-gray-400" />
                        {grid._count.posts}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      {grid.isActive ? (
                        <Badge variant="default">Actif</Badge>
                      ) : (
                        <Badge variant="secondary">Inactif</Badge>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleExpand(grid.id)}
                          className="h-7 px-2 text-xs"
                        >
                          <Layers className="h-3.5 w-3.5 mr-1" />
                          Postes
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(grid)}
                          disabled={toggling === grid.id}
                          className={
                            grid.isActive
                              ? "h-7 px-2 text-xs text-orange-600 hover:text-orange-700"
                              : "h-7 px-2 text-xs text-green-600 hover:text-green-700"
                          }
                          title={
                            grid.isActive ? "Désactiver la grille" : "Activer la grille"
                          }
                        >
                          {grid.isActive ? (
                            <ToggleRight className="h-3.5 w-3.5 mr-1" />
                          ) : (
                            <ToggleLeft className="h-3.5 w-3.5 mr-1" />
                          )}
                          {toggling === grid.id
                            ? "..."
                            : grid.isActive
                            ? "Désactiver"
                            : "Activer"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {expandedGridId === grid.id && (
                    <tr key={`${grid.id}-posts`} className="border-t">
                      <td colSpan={6} className="p-0">
                        <PostsSection gridId={grid.id} />
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
