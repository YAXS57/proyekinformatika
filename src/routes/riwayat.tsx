import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useState, useEffect, useMemo } from "react";
import { db, type Sale, type SaleDetail } from "@/lib/db";
import { formatRupiah } from "@/lib/format";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { reverseConsignmentSale } from "@/lib/consignment-service";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Receipt,
  CalendarClock,
  Trash2,
  Edit,
  Plus,
  Minus,
  Save,
  X,
  Search,
  User,
  Tag,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/riwayat")({
  head: () => ({ meta: [{ title: "Riwayat — Angkringan POS" }] }),
  component: RiwayatPage,
});

function RiwayatPage() {
  const [timeFilter, setTimeFilter] = useState<"today" | "yesterday" | "7d" | "all">("today");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [details, setDetails] = useState<SaleDetail[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);

  const sales = useLiveQuery(() => {
    const now = new Date();
    if (timeFilter === "all")
      return db.sales.orderBy("transaction_date").reverse().limit(300).toArray();

    let start = 0;
    let end = now.getTime() + 86400000;
    if (timeFilter === "today") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      end = start + 86400000;
    } else if (timeFilter === "yesterday") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
      end = start + 86400000;
    } else if (timeFilter === "7d") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime();
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    }
    return db.sales.where("transaction_date").between(start, end).reverse().toArray();
  }, [timeFilter]);

  const filteredSales = useMemo(() => {
    if (!sales) return [];
    if (!searchQuery.trim()) return sales;
    const q = searchQuery.toLowerCase().trim();
    return sales.filter(
      (s) =>
        (s.invoice_number && s.invoice_number.toLowerCase().includes(q)) ||
        (s.customer_name && s.customer_name.toLowerCase().includes(q)) ||
        (s.payment_method && s.payment_method.toLowerCase().includes(q)),
    );
  }, [sales, searchQuery]);

  const openDetail = async (sale: Sale) => {
    setSelectedSale(sale);
    const items = await db.sale_details.where("sale_id").equals(sale.id!).toArray();
    setDetails(items);
    setDetailOpen(true);
  };

  const handleVoidSingle = async (sale: Sale) => {
    if (!sale.id) return;
    if (
      !confirm(
        `Batalkan transaksi ${sale.invoice_number}? Seluruh stok produk dan alokasi konsinyasi akan dikembalikan secara otomatis.`,
      )
    )
      return;

    try {
      await db.transaction(
        "rw",
        [
          db.sales,
          db.sale_details,
          db.inventory,
          db.consignment_items,
          db.consignment_batches,
          db.menu_items,
        ],
        async () => {
          const saleItems = await db.sale_details.where("sale_id").equals(sale.id!).toArray();

          for (const d of saleItems) {
            const mItem = await db.menu_items.get(d.item_id);
            const invId = mItem?.inventory_id;

            if (d.is_consignment && d.consignment_batch_id) {
              await reverseConsignmentSale(
                d.consignment_batch_id,
                d.consignment_item_id,
                invId,
                d.quantity,
              );
            } else if (invId) {
              const inv = await db.inventory.get(invId);
              if (inv) {
                await db.inventory.update(inv.id!, {
                  stock: inv.stock + d.quantity,
                  last_updated: Date.now(),
                  updated_at: Date.now(),
                });
              }
            }
          }

          await db.sales.delete(sale.id!);
          await db.sale_details.where("sale_id").equals(sale.id!).delete();
        },
      );

      setDetailOpen(false);
      setSelectedSale(null);
      toast.success(`Transaksi ${sale.invoice_number} dibatalkan & stok dikembalikan!`);
    } catch (e) {
      toast.error("Gagal membatalkan transaksi");
    }
  };

  const handleDeleteBatch = async () => {
    if (selectedIds.length === 0) return;
    if (
      !confirm(
        `Yakin hapus ${selectedIds.length} transaksi? Stok barang dan alokasi konsinyasi terkait akan dikembalikan secara otomatis.`,
      )
    )
      return;
    try {
      await db.transaction(
        "rw",
        [
          db.sales,
          db.sale_details,
          db.inventory,
          db.consignment_items,
          db.consignment_batches,
          db.menu_items,
        ],
        async () => {
          const detailsToDelete = await db.sale_details
            .where("sale_id")
            .anyOf(selectedIds)
            .toArray();

          for (const d of detailsToDelete) {
            const mItem = await db.menu_items.get(d.item_id);
            const invId = mItem?.inventory_id;

            if (d.is_consignment && d.consignment_batch_id) {
              await reverseConsignmentSale(
                d.consignment_batch_id,
                d.consignment_item_id,
                invId,
                d.quantity,
              );
            } else if (invId) {
              const inv = await db.inventory.get(invId);
              if (inv) {
                await db.inventory.update(inv.id!, {
                  stock: inv.stock + d.quantity,
                  last_updated: Date.now(),
                  updated_at: Date.now(),
                });
              }
            }
          }

          await db.sales.bulkDelete(selectedIds);
          await db.sale_details.where("sale_id").anyOf(selectedIds).delete();
        },
      );
      setSelectedIds([]);
      toast.success("Transaksi dihapus & stok barang dikembalikan!");
    } catch (e) {
      toast.error("Gagal menghapus transaksi");
    }
  };

  return (
    <div className="p-4 space-y-4 pb-28">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">Riwayat Transaksi</h1>
          <p className="text-xs text-muted-foreground">Kelola nota penjualan</p>
        </div>
        {selectedIds.length > 0 && (
          <Button
            variant="destructive"
            className="h-11 rounded-xl font-bold text-sm"
            onClick={handleDeleteBatch}
          >
            <Trash2 className="h-4 w-4 mr-2" /> Hapus ({selectedIds.length})
          </Button>
        )}
      </header>

      {/* Search Bar Transaksi */}
      <div className="relative">
        <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Cari no nota (TRX-...), nama pelanggan..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 h-12 rounded-xl text-sm border-2"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-8 w-8 rounded-full"
            onClick={() => setSearchQuery("")}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* FILTER PERIODE SEKARANG H-10 TEXT-SM (TOUCH TARGET LEBIH LUAS) */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        <Button
          variant={timeFilter === "today" ? "default" : "outline"}
          className="rounded-full h-10 px-5 text-sm font-bold shrink-0"
          onClick={() => setTimeFilter("today")}
        >
          Hari Ini
        </Button>
        <Button
          variant={timeFilter === "yesterday" ? "default" : "outline"}
          className="rounded-full h-10 px-5 text-sm font-bold shrink-0"
          onClick={() => setTimeFilter("yesterday")}
        >
          Kemarin
        </Button>
        <Button
          variant={timeFilter === "7d" ? "default" : "outline"}
          className="rounded-full h-10 px-5 text-sm font-bold shrink-0"
          onClick={() => setTimeFilter("7d")}
        >
          7 Hari
        </Button>
        <Button
          variant={timeFilter === "all" ? "default" : "outline"}
          className="rounded-full h-10 px-5 text-sm font-bold shrink-0"
          onClick={() => setTimeFilter("all")}
        >
          Semua
        </Button>
      </div>

      <div className="space-y-3">
        {filteredSales?.map((sale) => (
          <div
            key={sale.id}
            className="bg-card border-2 border-border rounded-2xl p-4 shadow-sm flex items-center gap-3"
          >
            <Checkbox
              checked={selectedIds.includes(sale.id!)}
              onCheckedChange={(c) =>
                setSelectedIds((prev) =>
                  c ? [...prev, sale.id!] : prev.filter((i) => i !== sale.id!),
                )
              }
            />

            <div className="flex-1 cursor-pointer" onClick={() => openDetail(sale)}>
              <div className="flex flex-col items-start gap-1">
                <div className="flex items-center gap-2">
                  <div className="font-black text-lg text-primary leading-none">
                    {formatRupiah(sale.total_amount)}
                  </div>
                  {sale.invoice_number && (
                    <span className="text-[10px] font-mono font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {sale.invoice_number}
                    </span>
                  )}
                </div>
                {sale.discount_amount && sale.discount_amount > 0 ? (
                  <span className="text-[9px] bg-destructive/10 text-destructive font-bold px-1.5 py-0.5 rounded border border-destructive/20 line-clamp-1">
                    {sale.promo_name && sale.promo_name !== "Tidak Ada"
                      ? sale.promo_name
                      : "Diskon"}{" "}
                    : -{formatRupiah(sale.discount_amount)}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                {sale.is_member && (
                  <span className="bg-amber-500/10 text-amber-600 text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider">
                    Member
                  </span>
                )}
                <span className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> {sale.customer_name || "Guest"}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-1">
                <CalendarClock className="h-3 w-3" />
                {format(sale.transaction_date, "dd MMM yyyy, HH:mm", { locale: idLocale })}
              </div>
            </div>

            {/* TOMBOL PENCIL EDIT DIPERBESAR MENJADI H-11 W-11 */}
            <div className="flex flex-col gap-2 items-end">
              <div
                className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg ${sale.payment_method === "QRIS" ? "bg-blue-500/10 text-blue-600" : "bg-green-500/10 text-green-600"}`}
              >
                {sale.payment_method}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 bg-background border shadow-sm rounded-full active:scale-95"
                onClick={() => setEditingSale(sale)}
              >
                <Edit className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {filteredSales?.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="mx-auto h-12 w-12 opacity-20 mb-3" />
            <p className="text-sm font-medium">Tidak ada transaksi ditemukan</p>
          </div>
        )}
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent
          className="rounded-3xl max-w-[90vw] sm:max-w-[400px]"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Detail Transaksi</DialogTitle>
          </DialogHeader>
          {selectedSale && (
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-muted p-3 rounded-xl border">
                <div className="flex items-center gap-2">
                  <div className="bg-primary/20 p-2 rounded-full">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-muted-foreground uppercase">
                      {selectedSale.is_member ? "Member" : "Pelanggan"}
                    </div>
                    <div className="text-sm font-black">
                      {selectedSale.customer_name || "Guest"}
                    </div>
                  </div>
                </div>
                <div
                  className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg ${selectedSale.payment_method === "QRIS" ? "bg-blue-500/10 text-blue-600" : "bg-green-500/10 text-green-600"}`}
                >
                  {selectedSale.payment_method}
                </div>
              </div>
              <div className="max-h-[40vh] overflow-y-auto divide-y pr-2">
                {details.map((d) => (
                  <div key={d.id} className="py-3 flex justify-between items-center">
                    <div>
                      <div className="font-bold text-sm">{d.item_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.quantity} x {formatRupiah(d.price_at_sale)}
                      </div>
                    </div>
                    <div className="font-bold">{formatRupiah(d.subtotal)}</div>
                  </div>
                ))}
              </div>
              {selectedSale.discount_amount && selectedSale.discount_amount > 0 ? (
                <div className="border-t border-border pt-3 space-y-2 mt-2">
                  <div className="flex justify-between items-center text-sm font-bold text-muted-foreground">
                    <span>Subtotal</span>
                    <span>
                      {formatRupiah(selectedSale.total_amount + selectedSale.discount_amount)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-destructive text-sm font-bold border-b border-dashed border-border pb-3">
                    <span>Diskon: {selectedSale.promo_name || "Potongan Harga"}</span>
                    <span>- {formatRupiah(selectedSale.discount_amount)}</span>
                  </div>
                </div>
              ) : null}
              <div
                className={`flex justify-between items-center text-xl font-black ${!(selectedSale.discount_amount && selectedSale.discount_amount > 0) ? "border-t pt-4" : "pt-2"}`}
              >
                <span>Total Bayar</span>
                <span className="text-primary">{formatRupiah(selectedSale.total_amount)}</span>
              </div>

              <Button
                variant="destructive"
                className="w-full h-12 rounded-xl font-bold mt-4 shadow-sm"
                onClick={() => handleVoidSingle(selectedSale)}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Batalkan Nota & Kembalikan Stok
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {editingSale && (
        <EditTransactionDialog
          sale={editingSale}
          onOpenChange={(open) => !open && setEditingSale(null)}
        />
      )}
    </div>
  );
}

function EditTransactionDialog({
  sale,
  onOpenChange,
}: {
  sale: Sale;
  onOpenChange: (open: boolean) => void;
}) {
  const [details, setDetails] = useState<SaleDetail[]>([]);
  const customers = useLiveQuery(() => db.customers.orderBy("name").toArray(), []);

  const [method, setMethod] = useState<"Cash" | "QRIS">(sale.payment_method);
  const [customerName, setCustomerName] = useState(sale.customer_name || "");
  const [isMember, setIsMember] = useState(sale.is_member || false);
  const [memberSearchOpen, setMemberSearchOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [promo, setPromo] = useState(sale.promo_name || "Tidak Ada");
  const [promoDiscountStr, setPromoDiscountStr] = useState(String(sale.discount_amount || 0));

  const filteredMembers = useMemo(() => {
    if (!customers) return [];
    return customers.filter((c) => c.name.toLowerCase().includes(memberQuery.toLowerCase()));
  }, [customers, memberQuery]);

  useEffect(() => {
    if (promo === "Bawa Stiker (- Rp 1.000)") setPromoDiscountStr("1000");
    else if (promo === "Tidak Ada") setPromoDiscountStr("0");
  }, [promo]);

  useEffect(() => {
    db.sale_details.where("sale_id").equals(sale.id!).toArray().then(setDetails);
  }, [sale.id]);

  const updateQty = (id: number, delta: number) => {
    setDetails((prev) =>
      prev.map((d) =>
        d.id === id
          ? {
              ...d,
              quantity: Math.max(1, d.quantity + delta),
              subtotal: (d.quantity + delta) * d.price_at_sale,
            }
          : d,
      ),
    );
  };

  const handleSave = async () => {
    const newSubtotal = details.reduce((sum, d) => sum + d.subtotal, 0);
    const newDiscount = parseInt(promoDiscountStr.replace(/\D/g, "")) || 0;
    let newFinalTotal = newSubtotal - newDiscount;
    if (newFinalTotal < 0) newFinalTotal = 0;

    await db.transaction("rw", db.sales, db.sale_details, async () => {
      await db.sales.update(sale.id!, {
        total_amount: newFinalTotal,
        payment_method: method,
        customer_name: customerName.trim() || (isMember ? "Member Tanpa Nama" : "Guest"),
        is_member: isMember,
        promo_name: promo,
        discount_amount: newDiscount,
      });
      for (const d of details)
        await db.sale_details.update(d.id, { quantity: d.quantity, subtotal: d.subtotal });
    });
    toast.success("Nota berhasil diperbarui!");
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={true} onOpenChange={onOpenChange}>
        <DialogContent
          className="rounded-3xl max-w-[90vw] sm:max-w-[400px] max-h-[85vh] flex flex-col p-6"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Edit Nota</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-2 no-scrollbar">
            {/* INPUT FORM DALAM POPUP SEKARANG LEBIH TINGGI (H-12) */}
            <div className="bg-muted/50 p-4 rounded-2xl border space-y-3">
              <div className="flex items-center justify-between border-b pb-3 border-border/50">
                <label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Pelanggan
                </label>
                <div className="flex items-center gap-2 bg-background border px-3 py-1.5 rounded-xl shadow-sm">
                  <Checkbox
                    id="edit-member"
                    checked={isMember}
                    onCheckedChange={(c) => {
                      setIsMember(c as boolean);
                      if (!c) setCustomerName("");
                    }}
                  />
                  <label htmlFor="edit-member" className="text-xs font-bold cursor-pointer">
                    Member
                  </label>
                </div>
              </div>
              <div>
                {isMember ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-12 rounded-xl justify-between px-3 text-left font-bold border-primary/40 text-foreground bg-background"
                    onClick={() => setMemberSearchOpen(true)}
                  >
                    <span
                      className={
                        customerName
                          ? "text-primary font-black line-clamp-1"
                          : "text-muted-foreground font-medium"
                      }
                    >
                      {customerName ? `👤 ${customerName}` : "Pilih dari daftar member..."}
                    </span>
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                  </Button>
                ) : (
                  <Input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Nama Pelanggan Biasa..."
                    className="h-12 rounded-xl font-semibold w-full"
                  />
                )}
              </div>
              <div className="space-y-2 pt-2 border-t border-border">
                <label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" /> Promo / Diskon
                </label>
                <div className="flex gap-2">
                  <Select value={promo} onValueChange={setPromo}>
                    <SelectTrigger className="h-12 rounded-xl bg-background flex-1 font-semibold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="Tidak Ada">Tidak Ada</SelectItem>
                      <SelectItem value="Bawa Stiker (- Rp 1.000)">
                        🏷️ Stiker (- Rp 1.000)
                      </SelectItem>
                      <SelectItem value="Diskon Kustom">✏️ Diskon Kustom</SelectItem>
                    </SelectContent>
                  </Select>
                  {promo !== "Tidak Ada" && (
                    <Input
                      inputMode="numeric"
                      value={promoDiscountStr}
                      onChange={(e) => setPromoDiscountStr(e.target.value.replace(/\D/g, ""))}
                      placeholder="Rp"
                      className="h-12 w-28 rounded-xl font-bold text-right"
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="bg-muted/50 p-4 rounded-2xl border">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                Ubah Metode Pembayaran
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={method === "Cash" ? "default" : "outline"}
                  className="h-11 rounded-xl font-bold"
                  onClick={() => setMethod("Cash")}
                >
                  Tunai
                </Button>
                <Button
                  variant={method === "QRIS" ? "default" : "outline"}
                  className="h-11 rounded-xl font-bold"
                  onClick={() => setMethod("QRIS")}
                >
                  QRIS
                </Button>
              </div>
            </div>

            {/* TOMBOL PLUS MINUS EDIT QUANTITY DI EDIT NOTA JADI H-11 W-11 */}
            <div className="space-y-3 mt-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Detail Item
              </p>
              {details.map((d) => (
                <div
                  key={d.id}
                  className="flex justify-between items-center bg-card p-3 rounded-xl border shadow-sm"
                >
                  <span className="font-bold text-sm leading-tight pr-2">{d.item_name}</span>
                  <div className="flex items-center gap-2.5">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-11 w-11 rounded-full bg-background shadow-sm"
                      onClick={() => updateQty(d.id, -1)}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="font-black w-6 text-center text-lg">{d.quantity}</span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-11 w-11 rounded-full bg-background shadow-sm"
                      onClick={() => updateQty(d.id, 1)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="pt-4 border-t flex gap-3 mt-auto bg-background">
            <Button
              variant="outline"
              className="flex-1 rounded-xl h-12 font-bold"
              onClick={() => onOpenChange(false)}
            >
              Batal
            </Button>
            <Button className="flex-1 rounded-xl h-12 font-bold" onClick={handleSave}>
              Simpan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={memberSearchOpen} onOpenChange={setMemberSearchOpen}>
        <DialogContent
          className="rounded-3xl max-w-[85vw] sm:max-w-[360px] p-5 flex flex-col max-h-[80vh] z-[60] overflow-hidden"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="shrink-0 flex flex-row items-center justify-between">
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <User className="h-5 w-5 text-primary" /> Cari Data Member
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setMemberSearchOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>
          <div className="relative my-3 shrink-0">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Ketik nama member..."
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              className="pl-9 h-11 rounded-xl border-2 focus:border-primary"
            />
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 no-scrollbar">
            {filteredMembers.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setCustomerName(m.name);
                  setMemberSearchOpen(false);
                  setMemberQuery("");
                }}
                className={`w-full text-left p-3 rounded-xl border-2 flex items-center gap-3 transition-all active:scale-[0.97] ${customerName === m.name ? "bg-primary/10 border-primary text-primary" : "bg-card hover:bg-muted/50 border-border"}`}
              >
                <div
                  className={`p-2 rounded-full ${customerName === m.name ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}
                >
                  <User className="h-4 w-4" />
                </div>
                <span className="font-bold text-sm truncate">{m.name}</span>
              </button>
            ))}
            {filteredMembers.length === 0 && (
              <div className="text-center py-10 text-muted-foreground opacity-60 text-xs font-semibold">
                Member tidak ditemukan.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
