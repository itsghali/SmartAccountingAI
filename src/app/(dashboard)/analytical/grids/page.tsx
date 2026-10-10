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
        className="flex items-center gap-3 py-2 px-4 hover:bg-muted/40 transition-colors rounded-md text-sm cursor-pointer"
        style={{ paddingLeft: `${16 + depth * 24}px` }}
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
          <span className="w-4" />
        )}
        <span className="font-mono text-xs font-bold text-primary w-20 shrink-0 tracking-wide">
          {node.code}
        </span>
        <span className="flex-1 text-foreground font-medium">{node.label}</span>
        {node.parentId ? (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">sous-poste</span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-primary/70 bg-primary/10 px-2 py-0.5 rounded-full">racine</span>
        )}
        {!node.isActive && (
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wider bg-muted text-muted-foreground ml-2">
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
    <div className="bg-muted/5 border-t border-border/50 px-6 py-5 shadow-inner">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <div className="p-1.5 bg-primary/10 rounded-md">
            <GitBranch className="h-4 w-4 text-primary" />
          </div>
          Postes analytiques
          <span className="text-xs font-normal text-muted-foreground ml-1 bg-muted px-2 py-0.5 rounded-full">
            {posts.length} poste{posts.length !== 1 ? "s" : ""}
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
        <div className="p-6 text-center text-muted-foreground font-medium animate-pulse">Chargement...</div>
      ) : posts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border/50 rounded-lg bg-card/30">
          Aucun poste. Cliquez sur "Nouveau poste" pour commencer.
        </p>
      ) : (
        <div className="border border-border/50 rounded-xl bg-card/60 backdrop-blur-sm overflow-hidden shadow-sm">
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
      <div className="p-6 text-muted-foreground">Veuillez sélectionner une société.</div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary">
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
      <div className="grid grid-cols-3 gap-6 mb-8">
        <Card className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground mb-1">Total grilles</p>
            <p className="text-3xl font-bold text-foreground font-mono">{totalGrids}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground mb-1">Grilles actives</p>
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">{activeGrids}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground mb-1">Total postes</p>
            <p className="text-3xl font-bold text-primary font-mono">{totalPosts}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex gap-4 mb-6 p-4 bg-card/60 backdrop-blur-md border border-border/50 shadow-sm rounded-xl">
        <Select
          value={filterActive}
          onValueChange={(v) => v !== null && setFilterActive(v)}
        >
          <SelectTrigger className="w-45">
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
      <div className="bg-card/60 backdrop-blur-xl border border-border/50 rounded-xl overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md hover:border-primary/20">
        <table className="w-full">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border/50">
            <tr>
              <th className="p-4 text-left w-10"></th>
              <th className="p-4 text-left font-semibold">Code</th>
              <th className="p-4 text-left font-semibold">Libellé</th>
              <th className="p-4 text-center font-semibold">Nb postes</th>
              <th className="p-4 text-center font-semibold">Statut</th>
              <th className="p-4 text-center font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-12 text-center text-muted-foreground font-medium animate-pulse">
                  Chargement...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-12 text-center text-muted-foreground border-dashed border-border/50">
                  Aucune grille analytique trouvée.
                </td>
              </tr>
            ) : (
              filtered.map((grid) => (
                <>
                  <tr
                    key={grid.id}
                    className="border-t border-border/50 hover:bg-muted/40 transition-colors"
                  >
                    {/* Expand toggle */}
                    <td className="p-4 text-center">
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
                    <td className="p-4 font-mono text-sm font-bold text-primary tracking-wide">
                      {grid.code}
                    </td>
                    <td className="p-4 text-sm font-medium text-foreground">{grid.label}</td>
                    <td className="p-4 text-center">
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground bg-muted px-2 py-1 rounded-md border border-border/50">
                        <Layers className="h-3.5 w-3.5" />
                        <span className="font-semibold">{grid._count.posts}</span>
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      {grid.isActive ? (
                        <Badge variant="default" className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-400 border-none shadow-none">Actif</Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-muted text-muted-foreground border-none shadow-none">Inactif</Badge>
                      )}
                    </td>
                    <td className="p-4 text-center">
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
                    <tr key={`${grid.id}-posts`} className="border-t border-border/50 bg-muted/5">
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
