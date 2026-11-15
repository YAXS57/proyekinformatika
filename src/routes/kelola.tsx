import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useState, useRef, useEffect } from "react";
import { db, type Category, type MenuItem, type Customer, type Inventory } from "@/lib/db";
import { formatRupiah } from "@/lib/format";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { LocalNotifications } from "@capacitor/local-notifications";
import { FileOpener } from "@capacitor-community/file-opener";

import {
  createBackup,
  validateBackupFile,
  restoreFromBackup,
  getBackupHistory,
  formatFileSize,
  type BackupResult,
  type ValidationResult,
} from "@/lib/backup-service";
import { getSyncQueueStats, retryFailedItems, clearFailedItems } from "@/lib/sync-service";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Pencil,
  Trash2,
  Plus,
  Minus,
  DatabaseBackup,
  Package,
  Users,
  Link,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  Shield,
  RefreshCw,
  CloudOff,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/kelola")({
  head: () => ({ meta: [{ title: "Kelola — Angkringan POS" }] }),
  component: ManagePage,
});

function ManagePage() {
  const [activeTab, setActiveTab] = useState("items");
  const tabOrder = ["items", "cats", "inventory", "members", "backup"];

  const [touchStartX, setTouchStartX] = useState(0);
  const [touchEndX, setTouchEndX] = useState(0);

  const handleTouchStart = (e: React.TouchEvent) => setTouchStartX(e.targetTouches[0].clientX);
  const handleTouchMove = (e: React.TouchEvent) => setTouchEndX(e.targetTouches[0].clientX);
  const handleTouchEnd = () => {
    if (!touchStartX || !touchEndX) return;
    const distance = touchStartX - touchEndX;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;
    const currentIndex = tabOrder.indexOf(activeTab);

    if (isLeftSwipe && currentIndex < tabOrder.length - 1) setActiveTab(tabOrder[currentIndex + 1]);
    if (isRightSwipe && currentIndex > 0) setActiveTab(tabOrder[currentIndex - 1]);

    setTouchStartX(0);
    setTouchEndX(0);
  };

  return (
    <div className="p-4 space-y-4 pb-24">
      <header>
        <h1 className="text-lg font-bold">Kelola Data</h1>
        <p className="text-xs text-muted-foreground">Pengaturan menu, stok, member & sistem</p>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="overflow-x-auto no-scrollbar pb-2">
          <TabsList className="flex w-max space-x-1 bg-muted p-1 rounded-xl h-12">
            <TabsTrigger
              value="items"
              className="rounded-lg px-4 text-sm font-semibold transition-all"
            >
              Menu
            </TabsTrigger>
            <TabsTrigger
              value="cats"
              className="rounded-lg px-4 text-sm font-semibold transition-all"
            >
              Kategori
            </TabsTrigger>
            <TabsTrigger
              value="inventory"
              className="rounded-lg px-4 text-sm font-semibold transition-all flex gap-1.5"
            >
              <Package className="w-3.5 h-3.5" /> Gudang
            </TabsTrigger>
            <TabsTrigger
              value="members"
              className="rounded-lg px-4 text-sm font-semibold transition-all flex gap-1.5"
            >
              <Users className="w-3.5 h-3.5" /> Member
            </TabsTrigger>
            <TabsTrigger
              value="backup"
              className="rounded-lg px-4 text-sm font-semibold transition-all"
            >
              Backup
            </TabsTrigger>
          </TabsList>
        </div>

        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="min-h-[60vh] mt-2"
        >
          <TabsContent value="items" className="m-0">
            <ItemsManager />
          </TabsContent>
          <TabsContent value="cats" className="m-0">
            <CategoriesManager />
          </TabsContent>
          <TabsContent value="inventory" className="m-0">
            <InventoryManager />
          </TabsContent>
          <TabsContent value="members" className="m-0">
            <MembersManager />
          </TabsContent>
          <TabsContent value="backup" className="m-0">
            <BackupManager />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function InventoryManager() {
  const inventory = useLiveQuery(() => db.inventory.toArray(), []);
  const [editing, setEditing] = useState<Inventory | null>(null);
  const [open, setOpen] = useState(false);
  const [ownershipFilter, setOwnershipFilter] = useState<"all" | "owned" | "consignment">("all");

  const filteredInventory = useMemo(() => {
    if (!inventory) return [];
    if (ownershipFilter === "all") return inventory;
    return inventory.filter((inv) => (inv.item_type || "owned") === ownershipFilter);
  }, [inventory, ownershipFilter]);

  const totalOwned = useMemo(
    () => inventory?.filter((i) => (i.item_type || "owned") === "owned").length || 0,
    [inventory],
  );
  const totalConsignment = useMemo(
    () => inventory?.filter((i) => i.item_type === "consignment").length || 0,
    [inventory],
  );

  const updateStock = async (id: number, currentStock: number, delta: number) => {
    const newStock = Math.max(0, currentStock + delta);
    await db.inventory.update(id, { stock: newStock, last_updated: Date.now() });
  };

  const remove = async (item: Inventory) => {
    if (confirm(`Hapus barang ${item.name} dari gudang?`)) {
      await db.inventory.delete(item.id!);
      toast.success("Barang dihapus");
    }
  };

  return (
    <div className="space-y-3">
      <Button
        className="w-full h-13 rounded-xl font-bold text-base"
        onClick={() => {
          setEditing(null);
          setOpen(true);
        }}
      >
        <Plus className="h-4 w-4 mr-2" /> Tambah Barang Milik Sendiri
      </Button>

      {/* Filter Kepemilikan Barang Gudang */}
      <div className="grid grid-cols-3 gap-2 bg-muted/60 p-1 rounded-xl">
        <button
          type="button"
          onClick={() => setOwnershipFilter("all")}
          className={`py-2 text-xs font-bold rounded-lg transition-all ${
            ownershipFilter === "all"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Semua ({inventory?.length || 0})
        </button>
        <button
          type="button"
          onClick={() => setOwnershipFilter("owned")}
          className={`py-2 text-xs font-bold rounded-lg transition-all ${
            ownershipFilter === "owned"
              ? "bg-card text-blue-600 shadow-sm"
              : "text-muted-foreground hover:text-blue-600"
          }`}
        >
          Milik Sendiri ({totalOwned})
        </button>
        <button
          type="button"
          onClick={() => setOwnershipFilter("consignment")}
          className={`py-2 text-xs font-bold rounded-lg transition-all ${
            ownershipFilter === "consignment"
              ? "bg-card text-amber-600 shadow-sm"
              : "text-muted-foreground hover:text-amber-600"
          }`}
        >
          Konsinyasi ({totalConsignment})
        </button>
      </div>

      <ul className="space-y-2">
        {filteredInventory.map((inv) => {
          const isConsignment = inv.item_type === "consignment";

          return (
            <li
              key={inv.id}
              className={`bg-card border rounded-2xl p-3.5 flex justify-between items-center shadow-sm ${
                isConsignment ? "border-amber-500/30" : "border-border"
              }`}
            >
              <div className="flex-1 pr-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-sm line-clamp-1">{inv.name}</span>
                  <span
                    className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                      isConsignment
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                        : "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20"
                    }`}
                  >
                    {isConsignment ? "Konsinyasi" : "Milik Sendiri"}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                  {isConsignment ? (
                    <>
                      <span>Penitip:</span>
                      <strong className="text-foreground">
                        {inv.consignor_name || "Mitra Titipan"}
                      </strong>
                    </>
                  ) : (
                    <>
                      <span>Modal:</span>
                      <strong className="text-foreground">
                        {formatRupiah(inv.cost_per_unit || 0)}
                      </strong>
                      <span>/{inv.unit}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Tombol Pengatur Cepat Stok */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 bg-muted/50 p-1 rounded-xl border">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-10 w-10 rounded-lg bg-background shadow-sm"
                    onClick={() => updateStock(inv.id!, inv.stock, -1)}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="w-12 text-center font-black text-sm">
                    {inv.stock}{" "}
                    <span className="text-[9px] font-normal text-muted-foreground">{inv.unit}</span>
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-10 w-10 rounded-lg bg-background shadow-sm"
                    onClick={() => updateStock(inv.id!, inv.stock, 1)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex gap-1 border-l pl-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-11 w-11 rounded-full"
                    onClick={() => {
                      setEditing(inv);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-11 w-11 rounded-full hover:bg-destructive/10"
                    onClick={() => remove(inv)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
        {filteredInventory.length === 0 && (
          <div className="text-center py-10 opacity-50">
            <Package className="mx-auto h-8 w-8 mb-2" />
            <p className="text-xs font-bold">
              {ownershipFilter === "all"
                ? "Gudang kosong."
                : ownershipFilter === "consignment"
                  ? "Belum ada barang titipan konsinyasi di gudang."
                  : "Belum ada barang milik sendiri di gudang."}
            </p>
          </div>
        )}
      </ul>
      <InventoryDialog open={open} onOpenChange={setOpen} item={editing} />
    </div>
  );
}

function InventoryDialog({
  open,
  onOpenChange,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Inventory | null;
}) {
  const [name, setName] = useState(item?.name || "");
  const [stock, setStock] = useState(item ? String(item.stock) : "0");
  const [unit, setUnit] = useState(item?.unit || "Pcs");
  const [cost, setCost] = useState(item ? String(item.cost_per_unit || 0) : "");

  const isConsignment = item?.item_type === "consignment";

  useEffect(() => {
    if (open) {
      setName(item?.name || "");
      setStock(item ? String(item.stock) : "0");
      setUnit(item?.unit || "Pcs");
      setCost(item ? String(item.cost_per_unit || 0) : "");
    }
  }, [open, item]);

  const save = async () => {
    const s = Number(stock);
    const c = isConsignment ? 0 : Number(cost);
    if (!name.trim() || !unit.trim()) return toast.error("Lengkapi nama barang dan satuan!");

    try {
      if (item)
        await db.inventory.update(item.id!, {
          name: name.trim(),
          stock: s,
          unit: unit.trim(),
          cost_per_unit: c,
          last_updated: Date.now(),
          updated_at: Date.now(),
        });
      else
        await db.inventory.add({
          uuid: generateUUID(),
          name: name.trim(),
          stock: s,
          unit: unit.trim(),
          cost_per_unit: c,
          item_type: "owned",
          last_updated: Date.now(),
          created_at: Date.now(),
          updated_at: Date.now(),
          sync_status: "synced",
        });

      onOpenChange(false);
      toast.success("Barang gudang disimpan");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Gagal menyimpan barang: " + msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="rounded-3xl mx-4 max-w-[90vw] sm:max-w-[400px]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{item ? "Edit" : "Tambah"} Stok Gudang</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {isConsignment && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-xl text-xs text-amber-700 dark:text-amber-400">
              <strong className="block font-bold">Barang Konsinyasi (Titip Jual)</strong>
              Stok dimiliki oleh mitra{" "}
              <strong className="text-foreground">{item.consignor_name || "Mitra"}</strong>.
              Pengaturan stok & setoran dilakukan melalui tab Konsinyasi.
            </div>
          )}

          <div className="space-y-1">
            <Label className="font-bold ml-1">Nama Barang</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-14 rounded-xl"
              placeholder="Cth: Gula Pasir"
            />
          </div>

          {!isConsignment && (
            <div className="space-y-1">
              <Label className="font-bold ml-1">Harga Modal / Satuan (Rp)</Label>
              <Input
                type="tel"
                inputMode="numeric"
                value={cost}
                onChange={(e) => setCost(e.target.value.replace(/\D/g, ""))}
                className="h-14 rounded-xl font-bold"
                placeholder="Cth: 15000"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="font-bold ml-1">Jumlah Stok</Label>
              <Input
                type="tel"
                inputMode="numeric"
                value={stock}
                onChange={(e) => setStock(e.target.value.replace(/\D/g, ""))}
                className="h-14 rounded-xl font-bold"
              />
            </div>
            <div className="space-y-1">
              <Label className="font-bold ml-1">Satuan</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger className="h-14 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="Pcs">Pcs</SelectItem>
                  <SelectItem value="Bungkus">Bungkus</SelectItem>
                  <SelectItem value="Kg">Kg</SelectItem>
                  <SelectItem value="Gram">Gram</SelectItem>
                  <SelectItem value="Liter">Liter</SelectItem>
                  <SelectItem value="Pack">Pack</SelectItem>
                  <SelectItem value="Kardus">Kardus</SelectItem>
                  <SelectItem value="Ikat">Ikat</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={save} className="w-full h-13 rounded-xl font-bold mt-2 text-base">
            Simpan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MembersManager() {
  const members = useLiveQuery(() => db.customers.toArray(), []);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [open, setOpen] = useState(false);

  const remove = async (member: Customer) => {
    if (confirm(`Hapus pelanggan ${member.name} dari daftar member?`)) {
      await db.customers.delete(member.id!);
      toast.success("Member dihapus");
    }
  };

  return (
    <div className="space-y-3">
      <Button
        className="w-full h-13 rounded-xl font-bold text-base"
        onClick={() => {
          setEditing(null);
          setOpen(true);
        }}
      >
        <Plus className="h-4 w-4 mr-2" /> Daftarkan Member Baru
      </Button>

      <ul className="space-y-2">
        {members?.map((m) => (
          <li
            key={m.id}
            className="bg-card border rounded-xl p-3 flex justify-between items-center shadow-sm"
          >
            <div className="flex items-center gap-2">
              <div className="bg-primary/20 p-2 rounded-full">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <span className="font-bold text-sm">{m.name}</span>
            </div>
            <div className="flex gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 rounded-full"
                onClick={() => {
                  setEditing(m);
                  setOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 rounded-full hover:bg-destructive/10"
                onClick={() => remove(m)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <MemberDialog open={open} onOpenChange={setOpen} member={editing} />
    </div>
  );
}

function MemberDialog({
  open,
  onOpenChange,
  member,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Customer | null;
}) {
  const [name, setName] = useState(member?.name || "");

  useEffect(() => {
    if (open) setName(member?.name || "");
  }, [open, member]);

  const save = async () => {
    if (!name.trim()) return toast.error("Nama tidak boleh kosong!");
    try {
      if (member) await db.customers.update(member.id!, { name: name.trim() });
      else await db.customers.add({ name: name.trim() });
      onOpenChange(false);
      toast.success("Member berhasil disimpan");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Gagal menyimpan member: " + msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="rounded-3xl mx-4 max-w-[90vw] sm:max-w-[400px]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{member ? "Edit" : "Tambah"} Member</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="font-bold ml-1">Nama Member</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-14 rounded-xl"
              placeholder="Cth: Mas Budi..."
            />
          </div>
          <Button onClick={save} className="w-full h-13 rounded-xl font-bold mt-2 text-base">
            Simpan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesManager() {
  const cats = useLiveQuery(() => db.categories.toArray(), []);
  const [name, setName] = useState("");
  const add = async () => {
    if (!name.trim()) return;
    try {
      await db.categories.add({ name: name.trim(), created_at: Date.now() });
      setName("");
      toast.success("Kategori ditambahkan");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Gagal menambah kategori: " + msg);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nama kategori baru..."
          className="h-14 rounded-xl"
        />
        <Button className="h-14 w-14 rounded-xl" onClick={add}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <ul className="space-y-2">
        {cats?.map((c) => (
          <li
            key={c.id}
            className="bg-card border rounded-xl p-3 flex justify-between items-center shadow-sm"
          >
            <span className="font-semibold text-sm">{c.name}</span>
            <Button
              size="icon"
              variant="ghost"
              className="h-11 w-11 rounded-full"
              onClick={() => db.categories.delete(c.id!)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemsManager() {
  const items = useLiveQuery(() => db.menu_items.orderBy("created_at").toArray(), []);
  const cats = useLiveQuery(() => db.categories.toArray(), []);
  const inventory = useLiveQuery(() => db.inventory.toArray(), []);

  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [open, setOpen] = useState(false);
  const catName = (id: number) => cats?.find((c) => c.id === id)?.name || "-";

  return (
    <div className="space-y-3">
      {cats && cats.length === 0 ? (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-center shadow-sm">
          <p className="text-sm font-bold text-amber-600 mb-1">Kategori Masih Kosong!</p>
          <p className="text-xs text-amber-600/80">
            Buat kategori dulu di tab <b>Kategori</b> sebelum menambah menu.
          </p>
        </div>
      ) : (
        <Button
          className="w-full h-13 rounded-xl font-bold text-base"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> Tambah Menu Baru
        </Button>
      )}

      <ul className="space-y-2">
        {items?.map((it) => (
          <li
            key={it.id}
            className="bg-card border rounded-xl p-3 flex justify-between items-center shadow-sm"
          >
            <div>
              <div className="font-bold text-sm flex items-center gap-1.5">
                {it.name}
                {it.inventory_id && (
                  <span className="bg-blue-500/10 text-blue-600 text-[8px] font-black px-1.5 py-0.5 rounded border border-blue-500/20">
                    <Link className="h-2 w-2 inline mr-0.5" /> TERSINKRON
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {catName(it.category_id)} • {formatRupiah(it.price)}
              </div>
            </div>
            <div className="flex gap-1 border-l pl-2">
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 rounded-full"
                onClick={() => {
                  setEditing(it);
                  setOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 rounded-full hover:bg-destructive/10"
                onClick={() => {
                  if (confirm("Hapus menu ini?")) db.menu_items.delete(it.id!);
                }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ItemDialog
        open={open}
        onOpenChange={setOpen}
        item={editing}
        categories={cats || []}
        inventory={inventory || []}
      />
    </div>
  );
}

function ItemDialog({
  open,
  onOpenChange,
  item,
  categories,
  inventory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: MenuItem | null;
  categories: Category[];
  inventory: Inventory[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="rounded-3xl mx-4 max-w-[90vw] sm:max-w-[400px]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{item ? "Edit" : "Tambah"} Menu</DialogTitle>
        </DialogHeader>
        <ItemForm
          item={item}
          categories={categories}
          inventory={inventory}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ItemForm({
  item,
  categories,
  inventory,
  onDone,
}: {
  item: MenuItem | null;
  categories: Category[];
  inventory: Inventory[];
  onDone: () => void;
}) {
  const [name, setName] = useState(item?.name || "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [catId, setCatId] = useState(
    item ? String(item.category_id) : String(categories[0]?.id || ""),
  );
  const [invId, setInvId] = useState(item?.inventory_id ? String(item.inventory_id) : "Tidak Ada");

  useEffect(() => {
    if (item) {
      setName(item.name);
      setPrice(String(item.price));
      setCatId(String(item.category_id));
      setInvId(item.inventory_id ? String(item.inventory_id) : "Tidak Ada");
    } else {
      setName("");
      setPrice("");
      setCatId(String(categories[0]?.id || ""));
      setInvId("Tidak Ada");
    }
  }, [item, categories]);

  const save = async () => {
    const p = Number(price);
    if (!name || !p || !catId) return toast.error("Data tidak lengkap!");
    const finalInvId = invId !== "Tidak Ada" ? Number(invId) : undefined;
    try {
      if (item)
        await db.menu_items.update(item.id!, {
          name,
          price: p,
          category_id: Number(catId),
          inventory_id: finalInvId,
        });
      else
        await db.menu_items.add({
          name,
          price: p,
          category_id: Number(catId),
          inventory_id: finalInvId,
          created_at: Date.now(),
        });
      onDone();
      toast.success("Menu berhasil disimpan");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Gagal menyimpan menu: " + msg);
    }
  };

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-1">
        <Label className="font-bold ml-1">Nama Menu</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-14 rounded-xl"
          placeholder="Cth: Sate Usus"
        />
      </div>
      <div className="space-y-1">
        <Label className="font-bold ml-1">Harga Jual (Rp)</Label>
        <Input
          type="tel"
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
          className="h-14 rounded-xl font-bold"
          placeholder="Cth: 2000"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="font-bold ml-1">Kategori</Label>
          <Select value={catId} onValueChange={setCatId}>
            <SelectTrigger className="h-14 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {categories.map((c: Category) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="font-bold ml-1 flex items-center gap-1">
            <Link className="h-3 w-3" /> Sinkron Stok
          </Label>
          <Select value={invId} onValueChange={setInvId}>
            <SelectTrigger className="h-14 rounded-xl border-blue-500/30 bg-blue-500/5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="Tidak Ada" className="font-medium text-muted-foreground">
                Tidak disinkron
              </SelectItem>
              {inventory.map((inv: Inventory) => (
                <SelectItem key={inv.id} value={String(inv.id)} className="font-bold text-blue-600">
                  {inv.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button onClick={save} className="w-full h-13 rounded-xl font-bold mt-2 text-base">
        Simpan
      </Button>
    </div>
  );
}

function BackupManager() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [backupHistory, setBackupHistory] = useState<Awaited<ReturnType<typeof getBackupHistory>>>(
    [],
  );
  const [syncStats, setSyncStats] = useState<Awaited<ReturnType<typeof getSyncQueueStats>> | null>(
    null,
  );
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [pendingRestoreContent, setPendingRestoreContent] = useState<string | null>(null);
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);

  // Muat riwayat backup dan status sync saat komponen mount
  useEffect(() => {
    getBackupHistory(15).then(setBackupHistory).catch(console.error);
    getSyncQueueStats().then(setSyncStats).catch(console.error);
  }, []);

  const refreshHistory = async () => {
    const hist = await getBackupHistory(15);
    setBackupHistory(hist);
    const stats = await getSyncQueueStats();
    setSyncStats(stats);
  };

  // ── Backup ──
  const handleBackup = async () => {
    setIsBackingUp(true);
    const tId = toast.loading("Menyiapkan backup...");
    try {
      const result = await createBackup("manual");
      if (result.success) {
        const totalRecords = Object.values(result.tableCounts).reduce((a, b) => a + b, 0);
        toast.success(
          `Backup berhasil! ${totalRecords} data tersimpan. (${formatFileSize(result.fileSize)})`,
          { id: tId },
        );
      } else {
        toast.error(`Backup gagal: ${result.error}`, { id: tId });
      }
      await refreshHistory();
    } catch (err) {
      toast.error("Backup gagal", { id: tId });
    } finally {
      setIsBackingUp(false);
    }
  };

  // ── File Dipilih → Validasi ──
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const tId = toast.loading("Memvalidasi file backup...");
    try {
      const text = await file.text();
      const validation = await validateBackupFile(text);
      setValidationResult(validation);

      if (validation.valid) {
        setPendingRestoreContent(text);
        setConfirmRestoreOpen(true);
        toast.success("File valid! Siap dipulihkan.", { id: tId });
      } else {
        setPendingRestoreContent(null);
        toast.error(`File tidak valid: ${validation.errors.join(", ")}`, { id: tId });
      }
    } catch (err) {
      toast.error("Gagal membaca file", { id: tId });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── Restore Setelah Konfirmasi ──
  const handleRestore = async () => {
    if (!pendingRestoreContent) return;
    setConfirmRestoreOpen(false);
    setIsRestoring(true);

    const tId = toast.loading("Membuat backup pengaman & memulihkan data...");
    try {
      const result = await restoreFromBackup(pendingRestoreContent);
      if (result.success) {
        toast.success(
          `Data berhasil dipulihkan! ${result.totalRecords} record dari ${result.tablesRestored.length} tabel.${result.safetyBackupName ? ` Backup pengaman: ${result.safetyBackupName}` : ""}`,
          { id: tId, duration: 8000 },
        );
      } else {
        toast.error(`Restore gagal: ${result.error}`, { id: tId });
      }
      await refreshHistory();
    } catch (err) {
      toast.error("Restore gagal", { id: tId });
    } finally {
      setIsRestoring(false);
      setPendingRestoreContent(null);
      setValidationResult(null);
    }
  };

  // ── Retry Failed Sync ──
  const handleRetryFailed = async () => {
    const count = await retryFailedItems();
    toast.success(`${count} item gagal direset untuk dicoba ulang.`);
    await refreshHistory();
  };

  const handleClearFailed = async () => {
    if (!confirm("Hapus semua item sinkronisasi yang gagal? Data lokal tetap aman.")) return;
    const count = await clearFailedItems();
    toast.success(`${count} item gagal dihapus dari antrean.`);
    await refreshHistory();
  };

  return (
    <div className="space-y-4">
      {/* ── Backup & Restore Card ── */}
      <div className="bg-card border-2 border-border rounded-2xl p-4 shadow-sm">
        <h2 className="text-sm font-bold flex items-center gap-2 mb-1">
          <DatabaseBackup size={16} /> Pencadangan & Pemulihan Data
        </h2>
        <p className="text-[10px] text-muted-foreground mb-4 leading-relaxed">
          Backup mencakup seluruh data: menu, transaksi, pembelian, pengeluaran, konsinyasi, sesi
          kas, dan pengaturan. File dilengkapi checksum SHA-256 untuk verifikasi integritas.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <Button
            onClick={handleBackup}
            variant="outline"
            className="h-14 rounded-xl text-sm font-bold flex flex-col items-center gap-0.5"
            disabled={isBackingUp}
          >
            <Download className="h-4 w-4" />
            {isBackingUp ? "Menyimpan..." : "Simpan Backup"}
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            className="h-14 rounded-xl text-sm font-bold flex flex-col items-center gap-0.5"
            disabled={isRestoring}
          >
            <Upload className="h-4 w-4" />
            {isRestoring ? "Memulihkan..." : "Pulihkan Data"}
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            accept=".json"
          />
        </div>

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5 flex items-start gap-2">
          <Shield className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
            Saat memulihkan data, sistem otomatis membuat backup pengaman terlebih dahulu. Data lama
            tidak akan hilang.
          </p>
        </div>
      </div>

      {/* ── Status Sinkronisasi ── */}
      {syncStats && syncStats.total > 0 && (
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
            <RefreshCw className="h-4 w-4" /> Antrean Sinkronisasi
          </h3>
          <div className="grid grid-cols-3 gap-2 text-center text-xs mb-3">
            <div className="bg-amber-500/10 rounded-xl p-2">
              <div className="font-black text-lg text-amber-600">{syncStats.pending}</div>
              <div className="text-muted-foreground">Menunggu</div>
            </div>
            <div className="bg-blue-500/10 rounded-xl p-2">
              <div className="font-black text-lg text-blue-600">{syncStats.syncing}</div>
              <div className="text-muted-foreground">Proses</div>
            </div>
            <div className="bg-destructive/10 rounded-xl p-2">
              <div className="font-black text-lg text-destructive">{syncStats.failed}</div>
              <div className="text-muted-foreground">Gagal</div>
            </div>
          </div>
          {syncStats.failed > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={handleRetryFailed}
                variant="outline"
                size="sm"
                className="h-10 rounded-xl text-xs font-bold"
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Coba Ulang
              </Button>
              <Button
                onClick={handleClearFailed}
                variant="outline"
                size="sm"
                className="h-10 rounded-xl text-xs font-bold text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3 w-3 mr-1" /> Hapus Gagal
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Riwayat Backup ── */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Clock className="h-4 w-4" /> Riwayat Backup
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 rounded-lg text-xs"
            onClick={refreshHistory}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>

        {backupHistory.length > 0 ? (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {backupHistory.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between border rounded-xl p-2.5 bg-background/50"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {entry.status === "success" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">{entry.file_name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {format(entry.backup_date, "dd MMM yyyy, HH:mm", { locale: idLocale })}
                      {" • "}
                      <span
                        className={`font-bold ${entry.backup_type === "auto" ? "text-blue-600" : "text-amber-600"}`}
                      >
                        {entry.backup_type === "auto" ? "Otomatis" : "Manual"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground font-bold shrink-0 ml-2">
                  {entry.file_size > 0 ? formatFileSize(entry.file_size) : "-"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground opacity-50">
            <DatabaseBackup className="h-8 w-8 mx-auto mb-2" />
            <p className="text-xs font-bold">Belum ada riwayat backup.</p>
          </div>
        )}
      </div>

      {/* ── Dialog Konfirmasi Restore ── */}
      <Dialog open={confirmRestoreOpen} onOpenChange={setConfirmRestoreOpen}>
        <DialogContent
          className="rounded-3xl mx-4 max-w-[90vw] sm:max-w-[420px]"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Konfirmasi Pemulihan Data
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 space-y-3">
            {validationResult?.metadata && (
              <div className="bg-muted/50 rounded-xl p-3 text-xs space-y-1.5 border">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tanggal Backup:</span>
                  <span className="font-bold">
                    {format(new Date(validationResult.metadata.backup_date), "dd MMM yyyy, HH:mm", {
                      locale: idLocale,
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tipe:</span>
                  <span className="font-bold">
                    {validationResult.metadata.backup_type === "auto" ? "Otomatis" : "Manual"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Checksum:</span>
                  <span className="font-mono text-green-600 font-bold">
                    {validationResult.metadata.checksum.substring(0, 12)}...
                  </span>
                </div>
                {validationResult.metadata.table_counts && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Record:</span>
                    <span className="font-bold">
                      {Object.values(validationResult.metadata.table_counts).reduce(
                        (a, b) => a + b,
                        0,
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2">
              <Shield className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                Sistem akan membuat <strong>backup pengaman otomatis</strong> sebelum memulihkan
                data. Data yang ada saat ini tetap aman.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-12 rounded-xl font-bold"
              onClick={() => {
                setConfirmRestoreOpen(false);
                setPendingRestoreContent(null);
              }}
            >
              Batal
            </Button>
            <Button
              className="h-12 rounded-xl font-bold bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleRestore}
              disabled={isRestoring}
            >
              {isRestoring ? "Memulihkan..." : "Ya, Pulihkan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
