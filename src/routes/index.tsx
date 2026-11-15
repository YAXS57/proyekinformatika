import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState, useEffect } from "react";
import { db, type MenuItem, type Inventory, generateInvoiceNumber, generateUUID } from "@/lib/db";
import { cartStore, useCart, cartTotal, cartCount } from "@/lib/cart-store";
import { formatRupiah } from "@/lib/format";
import { getActiveCashSession, openCashSession } from "@/lib/session-helper";
import { allocateConsignmentSale } from "@/lib/consignment-service";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Minus,
  Search,
  Moon,
  Sun,
  Trash2,
  User,
  Tag,
  Package,
  Store,
  LayoutDashboard,
  Check,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Kasir — Angkringan POS" }] }),
  component: KasirPage,
});

function KasirPage() {
  const categories = useLiveQuery(() => db.categories.orderBy("created_at").toArray(), []);
  const items = useLiveQuery(() => db.menu_items.toArray(), []);
  const inventory = useLiveQuery(() => db.inventory.toArray(), []);
  const activeSession = useLiveQuery(
    () => db.cash_sessions.where("status").equals("open").last(),
    [],
  );
  const cart = useCart();

  const [activeCat, setActiveCat] = useState<string>("");
  const [search, setSearch] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [openSessionModal, setOpenSessionModal] = useState(false);
  const [quickInitialCash, setQuickInitialCash] = useState("");

  const [theme, setTheme] = useState(localStorage.getItem("theme") || "light");
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  const [touchStartX, setTouchStartX] = useState(0);
  const [touchEndX, setTouchEndX] = useState(0);

  const handleTouchStart = (e: React.TouchEvent) => setTouchStartX(e.targetTouches[0].clientX);
  const handleTouchMove = (e: React.TouchEvent) => setTouchEndX(e.targetTouches[0].clientX);
  const handleTouchEnd = () => {
    if (search.length > 0 || !touchStartX || !touchEndX || !categories) return;
    const distance = touchStartX - touchEndX;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;
    if (isLeftSwipe || isRightSwipe) {
      const currentIndex = categories.findIndex((c) => String(c.id) === String(catId));
      if (currentIndex === -1) return;
      if (isLeftSwipe && currentIndex < categories.length - 1)
        setActiveCat(String(categories[currentIndex + 1].id));
      if (isRightSwipe && currentIndex > 0) setActiveCat(String(categories[currentIndex - 1].id));
    }
    setTouchStartX(0);
    setTouchEndX(0);
  };

  const catId = useMemo(() => {
    if (!categories || categories.length === 0) return undefined;
    if (!activeCat) return categories[0].id!;
    return Number(activeCat);
  }, [categories, activeCat]);

  const filtered = useMemo(() => {
    if (!items) return [];
    if (search.length > 0)
      return items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));
    return items.filter((i) => i.category_id === catId);
  }, [items, catId, search]);

  const handleQuickOpenSession = async () => {
    const nominal = parseInt(quickInitialCash.replace(/\D/g, "")) || 0;
    try {
      await openCashSession(nominal, "Buka dari Kasir");
      toast.success(`Kasir dibuka dengan modal awal ${formatRupiah(nominal)}!`);
      setOpenSessionModal(false);
      setQuickInitialCash("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Gagal membuka sesi kasir");
    }
  };

  return (
    <div className="flex flex-col pb-32 max-w-7xl mx-auto w-full">
      {/* Header Kasir */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Link to="/dashboard">
            <Button variant="ghost" size="icon" className="rounded-xl h-11 w-11 hover:bg-muted">
              <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Kasir Angkringan</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => !activeSession && setOpenSessionModal(true)}
                className={`text-[10px] font-black uppercase px-2 py-0.5 rounded flex items-center gap-1 ${
                  activeSession
                    ? "bg-green-500/20 text-green-700 dark:text-green-400"
                    : "bg-amber-500/20 text-amber-700 dark:text-amber-400 hover:opacity-80"
                }`}
              >
                <Store className="h-3 w-3" />
                {activeSession ? "Sesi Buka" : "Warung Tutup (Buka Kasir)"}
              </button>
              {activeSession && (
                <span className="text-[10px] text-muted-foreground">
                  Modal: {formatRupiah(activeSession.initial_cash)}
                </span>
              )}
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          size="icon"
          onClick={toggleTheme}
          className="rounded-full h-11 w-11 shadow-sm bg-card border-2"
        >
          {theme === "dark" ? (
            <Sun className="h-5 w-5 text-amber-500" />
          ) : (
            <Moon className="h-5 w-5 text-slate-600" />
          )}
        </Button>
      </header>

      {/* Konten Utama Responsif: Single Column (Mobile) & Split-Pane (Tablet/Desktop) */}
      <div className="lg:grid lg:grid-cols-12 lg:gap-6 lg:p-4">
        {/* Kolom Kiri: Produk & Kategori (Col 12 pada Mobile, Col 8 pada Tablet/Desktop) */}
        <div className="lg:col-span-8 flex flex-col">
          {/* Kolom Pencarian */}
          <div className="px-3 pt-3 lg:px-0">
            <div className="relative">
              <Search className="absolute left-3.5 top-3.5 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Cari menu angkringan apapun..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-11 h-14 rounded-2xl text-base border-2"
              />
            </div>
          </div>

          {/* Kategori Tabs & Grid Produk */}
          {categories && categories.length > 0 && (
            <Tabs
              value={search.length > 0 ? "search" : String(catId ?? categories[0].id)}
              onValueChange={(v) => {
                setActiveCat(v);
                setSearch("");
              }}
              className="flex-1 mt-2"
            >
              {search.length === 0 && (
                <div className="sticky top-[73px] z-20 bg-background/95 backdrop-blur border-b">
                  <TabsList className="w-full justify-start overflow-x-auto rounded-none bg-transparent h-14 px-2 no-scrollbar">
                    {categories.map((c) => (
                      <TabsTrigger
                        key={c.id}
                        value={String(c.id)}
                        className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-sm font-bold rounded-full px-5 py-2 transition-all"
                      >
                        {c.name}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
              )}

              <div
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className="min-h-[50vh]"
              >
                {search.length > 0 ? (
                  <div className="p-3 lg:px-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {filtered.map((item) => (
                      <ItemCard key={item.id} item={item} inventory={inventory || []} />
                    ))}
                  </div>
                ) : (
                  categories.map((c) => (
                    <TabsContent
                      key={c.id}
                      value={String(c.id)}
                      className="m-0 p-3 lg:px-0 outline-none"
                    >
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {filtered.map((item) => (
                          <ItemCard key={item.id} item={item} inventory={inventory || []} />
                        ))}
                      </div>
                      {filtered.length === 0 && (
                        <div className="text-center py-16 border-2 border-dashed border-border rounded-2xl bg-muted/30 m-2 mt-4">
                          <p className="text-sm font-bold opacity-50">Kategori ini masih kosong.</p>
                        </div>
                      )}
                    </TabsContent>
                  ))
                )}
              </div>
            </Tabs>
          )}
        </div>

        {/* Kolom Kanan (Tablet & Desktop): Persistent Cart Panel */}
        <div className="hidden lg:col-span-4 lg:flex flex-col bg-card border-2 border-border rounded-3xl p-5 shadow-sm sticky top-20 h-[calc(100vh-110px)]">
          <div className="flex justify-between items-center pb-3 border-b">
            <div>
              <h2 className="font-bold text-base">Keranjang Pesanan</h2>
              <span className="text-xs text-muted-foreground font-semibold">
                {cartCount(cart)} item dipilih
              </span>
            </div>
            {cart.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive h-8 px-2 text-xs"
                onClick={() => {
                  if (confirm("Kosongkan keranjang pesanan?")) cartStore.clear();
                }}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Kosongkan
              </Button>
            )}
          </div>

          {/* List Item di Keranjang Tablet */}
          <div className="flex-1 overflow-y-auto my-3 divide-y pr-1">
            {cart.map((line) => {
              const invItem = line.item.inventory_id
                ? inventory?.find((i) => i.id === line.item.inventory_id)
                : null;

              return (
                <div key={line.item.id} className="py-3 flex items-center justify-between">
                  <div className="flex-1 pr-2">
                    <div className="font-bold text-sm leading-tight">{line.item.name}</div>
                    <div className="text-primary font-bold text-xs mt-0.5">
                      {formatRupiah(line.item.price)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-9 w-9 rounded-full shadow-sm"
                      onClick={() => cartStore.setQty(line.item.id!, line.qty - 1)}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="w-6 text-center font-black text-sm">{line.qty}</span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-9 w-9 rounded-full shadow-sm"
                      onClick={() => {
                        if (invItem && line.qty >= invItem.stock) {
                          toast.error(`Stok ${invItem.name} maksimal ${invItem.stock}!`);
                        } else {
                          cartStore.setQty(line.item.id!, line.qty + 1);
                        }
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}

            {cart.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 py-16 text-center">
                <Store className="h-12 w-12 mb-2" />
                <p className="text-xs font-semibold">Keranjang masih kosong</p>
                <p className="text-[10px]">Klik menu di sebelah kiri</p>
              </div>
            )}
          </div>

          {/* Footer Keranjang Tablet */}
          {cart.length > 0 && (
            <div className="pt-3 border-t space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs uppercase font-bold text-muted-foreground">
                  Total Bayar
                </span>
                <span className="text-2xl font-black text-primary">
                  {formatRupiah(cartTotal(cart))}
                </span>
              </div>
              <Button
                className="w-full h-14 rounded-2xl font-bold text-base shadow-sm"
                onClick={() => setCheckoutOpen(true)}
              >
                Lanjutkan Pembayaran
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Floating Bottom Cart Bar (Mobile Only: < lg) */}
      {cart.length > 0 && (
        <div className="lg:hidden">
          <Sheet open={cartOpen} onOpenChange={setCartOpen}>
            <SheetTrigger asChild>
              <button className="fixed bottom-20 left-3 right-3 z-30 bg-primary text-primary-foreground rounded-2xl shadow-lg px-5 py-4 flex items-center justify-between active:scale-[0.98] transition-transform border-2 border-primary/20">
                <div className="font-semibold text-base">{cartCount(cart)} item</div>
                <div className="font-black text-xl">{formatRupiah(cartTotal(cart))}</div>
              </button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="rounded-t-3xl max-h-[85vh] p-6 flex flex-col h-full"
            >
              <SheetHeader className="flex flex-col items-center gap-2 mb-2">
                <SheetTitle>Keranjang Pesanan</SheetTitle>
                <Button
                  variant="ghost"
                  className="text-destructive h-9 px-3 w-fit"
                  onClick={() => {
                    if (confirm("Hapus semua item di keranjang?")) cartStore.clear();
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-2" /> Hapus Semua
                </Button>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto my-4 divide-y pr-2">
                {cart.map((line) => {
                  const invItem = line.item.inventory_id
                    ? inventory?.find((i) => i.id === line.item.inventory_id)
                    : null;

                  return (
                    <div key={line.item.id} className="py-4 flex items-center justify-between">
                      <div>
                        <div className="font-bold">{line.item.name}</div>
                        <div className="text-primary font-bold text-sm">
                          {formatRupiah(line.item.price)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-11 w-11 rounded-full shadow-sm"
                          onClick={() => cartStore.setQty(line.item.id!, line.qty - 1)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-8 text-center font-black text-lg">{line.qty}</span>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-11 w-11 rounded-full shadow-sm"
                          onClick={() => {
                            if (invItem && line.qty >= invItem.stock) {
                              toast.error(`Stok ${invItem.name} maksimal ${invItem.stock}!`);
                            } else {
                              cartStore.setQty(line.item.id!, line.qty + 1);
                            }
                          }}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="pt-4 border-t bg-background">
                <Button
                  className="w-full h-14 rounded-2xl font-bold text-lg"
                  onClick={() => {
                    setCartOpen(false);
                    setTimeout(() => setCheckoutOpen(true), 150);
                  }}
                >
                  Konfirmasi Pembayaran ({formatRupiah(cartTotal(cart))})
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      )}

      {/* Dialog Checkout / Pembayaran */}
      <CheckoutDialog open={checkoutOpen} onOpenChange={setCheckoutOpen} />

      {/* Modal Cepat Buka Kasir jika Belum Buka */}
      <Dialog open={openSessionModal} onOpenChange={setOpenSessionModal}>
        <DialogContent
          className="rounded-3xl max-w-[90vw] sm:max-w-[380px] p-6"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-xl">Buka Sesi Kasir</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Warung belum dibuka. Masukkan modal awal kas untuk uang kembalian di laci kasir.
            </p>
            <div className="space-y-1.5">
              <Label className="font-bold text-xs">Modal Awal Kas (Rp)</Label>
              <Input
                inputMode="numeric"
                placeholder="Contoh: 150000"
                value={quickInitialCash}
                onChange={(e) => setQuickInitialCash(e.target.value.replace(/\D/g, ""))}
                className="h-14 text-xl font-black rounded-xl text-center"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button
                variant="outline"
                className="h-12 rounded-xl font-bold"
                onClick={() => setOpenSessionModal(false)}
              >
                Batal
              </Button>
              <Button className="h-12 rounded-xl font-bold" onClick={handleQuickOpenSession}>
                Buka Kasir
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemCard({ item, inventory }: { item: MenuItem; inventory: Inventory[] }) {
  const cart = useCart();
  const cartItem = cart.find((c) => c.item.id === item.id);
  const qty = cartItem ? cartItem.qty : 0;

  const invItem = item.inventory_id ? inventory.find((i) => i.id === item.inventory_id) : null;
  const sisaStok = invItem ? invItem.stock - qty : null;
  const isHabis = invItem && invItem.stock <= 0;

  const handleAdd = () => {
    if (isHabis) {
      toast.error(`Maaf, stok ${item.name} sedang kosong!`);
      return;
    }
    if (invItem && sisaStok !== null && sisaStok <= 0) {
      toast.error(`Maksimal ${invItem.stock} porsi, stok di gudang tidak cukup!`);
      return;
    }
    cartStore.add(item);
    toast.success(`+ ${item.name}`, { duration: 1200 });
  };

  return (
    <button
      onClick={handleAdd}
      className={`relative text-left border-2 rounded-2xl p-4 active:scale-[0.96] transition-all shadow-sm flex flex-col justify-between min-h-[110px]
        ${qty > 0 ? "bg-primary/5 border-primary" : "bg-card border-border hover:border-border/80"} 
        ${isHabis ? "opacity-60 grayscale bg-muted border-dashed" : ""}
      `}
    >
      {qty > 0 && (
        <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs font-black w-6 h-6 flex items-center justify-center rounded-full shadow-md z-10">
          {qty}
        </div>
      )}

      <div className="font-bold text-sm leading-snug line-clamp-2 pr-6 mb-2">{item.name}</div>

      <div className="w-full flex items-end justify-between mt-auto">
        <div
          className={`font-black text-base ${
            isHabis ? "text-muted-foreground line-through" : "text-primary"
          }`}
        >
          {formatRupiah(item.price)}
        </div>

        {invItem && (
          <div
            className={`text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-1
            ${isHabis ? "bg-destructive/10 text-destructive" : "bg-blue-500/10 text-blue-600"}
          `}
          >
            {isHabis ? (
              <span>Habis!</span>
            ) : (
              <>
                <Package className="h-2.5 w-2.5" />
                Sisa: {invItem.stock}
              </>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

function CheckoutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const cart = useCart();
  const subtotal = cartTotal(cart);

  const customers = useLiveQuery(() => db.customers.orderBy("name").toArray(), []);

  const [method, setMethod] = useState<"Cash" | "QRIS">("Cash");
  const [uangDiterima, setUangDiterima] = useState("");
  const [showFinal, setShowFinal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [isMember, setIsMember] = useState(false);

  const [memberSearchOpen, setMemberSearchOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");

  const [promo, setPromo] = useState("Tidak Ada");
  const [promoDiscountStr, setPromoDiscountStr] = useState("0");

  const filteredMembers = useMemo(() => {
    if (!customers) return [];
    return customers.filter((c) => c.name.toLowerCase().includes(memberQuery.toLowerCase()));
  }, [customers, memberQuery]);

  useEffect(() => {
    if (promo === "Bawa Stiker (- Rp 1.000)") setPromoDiscountStr("1000");
    else if (promo === "Tidak Ada") setPromoDiscountStr("0");
  }, [promo]);

  const discountAmount = useMemo(() => {
    const promoNominal = parseInt(promoDiscountStr.replace(/\D/g, "")) || 0;
    return promoNominal > subtotal ? subtotal : promoNominal;
  }, [promoDiscountStr, subtotal]);

  const finalTotal = subtotal - discountAmount;
  const nominal = parseInt(uangDiterima.replace(/\D/g, "")) || 0;
  const kembali = nominal - finalTotal;

  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setShowFinal(false);
        setUangDiterima("");
        setMethod("Cash");
        setCustomerName("");
        setIsMember(false);
        setPromo("Tidak Ada");
        setPromoDiscountStr("0");
        setMemberQuery("");
        setIsSubmitting(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const handleFinish = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const activeSession = await getActiveCashSession();
      const invoiceNo = generateInvoiceNumber("TRX");
      const saleUuid = generateUUID();
      const now = Date.now();

      await db.transaction(
        "rw",
        [
          db.sales,
          db.sale_details,
          db.inventory,
          db.consignment_batches,
          db.consignment_items,
          db.menu_items,
        ],
        async () => {
          // 1. Verifikasi ketersediaan stok fisik di gudang sebelum transaksi diproses
          for (const line of cart) {
            if (line.item.inventory_id) {
              const invItem = await db.inventory.get(line.item.inventory_id);
              if (!invItem || invItem.stock < line.qty) {
                throw new Error(
                  `Stok "${line.item.name}" tidak mencukupi (Tersedia: ${invItem?.stock || 0}, Diminta: ${line.qty})!`,
                );
              }
            }
          }

          // 2. Simpan Transaksi Penjualan Utama
          const saleId = await db.sales.add({
            uuid: saleUuid,
            invoice_number: invoiceNo,
            transaction_date: now,
            subtotal: subtotal,
            discount_amount: discountAmount,
            promo_name: promo === "Custom Diskon" ? "Diskon Kustom" : promo,
            total_amount: finalTotal,
            payment_method: method,
            cash_tendered: method === "Cash" ? nominal : finalTotal,
            cash_change: method === "Cash" ? Math.max(0, kembali) : 0,
            status: "paid",
            customer_name: customerName || (isMember ? "Member Tanpa Nama" : "Guest"),
            is_member: isMember,
            session_id: activeSession?.id,
            created_at: now,
            updated_at: now,
            sync_status: "synced",
          });

          // 3. Proses detail barang & alokasi stok batch konsinyasi
          for (const line of cart) {
            let isConsignment = Boolean(line.item.is_consignment);
            let allocatedBatchId: number | undefined;
            let allocatedPayout: number | undefined;
            let allocatedItemId: number | undefined;

            if (line.item.inventory_id) {
              const invItem = await db.inventory.get(line.item.inventory_id);
              if (invItem) {
                if (invItem.item_type === "consignment") {
                  isConsignment = true;
                }

                // Kurangi stok fisik Gudang
                const newStock = Math.max(0, invItem.stock - line.qty);
                await db.inventory.update(invItem.id!, {
                  stock: newStock,
                  last_updated: now,
                  updated_at: now,
                });

                // Jika barang konsinyasi, alokasikan pada batch konsinyasi FIFO
                if (isConsignment) {
                  const allocations = await allocateConsignmentSale(invItem.id!, line.qty);
                  if (allocations.length > 0) {
                    allocatedBatchId = allocations[0].batchId;
                    allocatedPayout = allocations[0].payoutPerUnit;
                    allocatedItemId = allocations[0].consignmentItemId;
                  }
                }
              }
            }

            // Simpan detail penjualan dengan snapshot harga setoran saat transaksi
            await db.sale_details.add({
              uuid: generateUUID(),
              sale_id: saleId,
              sale_uuid: saleUuid,
              item_id: line.item.id!,
              item_name: line.item.name,
              quantity: line.qty,
              price_at_sale: line.item.price,
              cost_at_sale: allocatedPayout || 0,
              subtotal: line.item.price * line.qty,
              is_consignment: isConsignment,
              consignment_batch_id: allocatedBatchId,
              consignment_item_id: allocatedItemId,
              payout_at_sale: allocatedPayout,
              created_at: now,
            });
          }
        },
      );

      try {
        const audio = new Audio("/success.mp3");
        audio.play().catch((e) => console.warn("Audio tidak bisa diputar:", e));
      } catch (e) {
        console.error("Gagal memutar audio:", e);
      }

      cartStore.clear();
      onOpenChange(false);
      toast.success(`Transaksi ${invoiceNo} Berhasil!`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses transaksi");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="rounded-3xl max-w-[90vw] sm:max-w-[420px] max-h-[85vh] flex flex-col p-6"
          onInteractOutside={(e) => e.preventDefault()}
        >
          {!showFinal ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">Pembayaran</DialogTitle>
              </DialogHeader>
              <div className="flex-1 overflow-y-auto pr-2 no-scrollbar space-y-4 py-2">
                <div className="bg-muted/50 p-4 rounded-2xl border space-y-3">
                  <div className="flex items-center justify-between border-b pb-3 border-border/50">
                    <label className="text-sm font-bold text-muted-foreground flex items-center gap-1.5">
                      <User className="w-4 h-4" /> Pelanggan
                    </label>
                    <div className="flex items-center gap-2 bg-background border px-3 py-1.5 rounded-xl shadow-sm">
                      <Checkbox
                        id="member"
                        checked={isMember}
                        onCheckedChange={(c) => {
                          setIsMember(c as boolean);
                          setCustomerName("");
                        }}
                      />
                      <label
                        htmlFor="member"
                        className="text-xs font-bold leading-none cursor-pointer"
                      >
                        Member
                      </label>
                    </div>
                  </div>

                  <div>
                    {isMember ? (
                      <div className="space-y-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full h-13 rounded-xl justify-between px-3 text-left font-bold border-primary/40 text-foreground bg-background ring-primary/10 focus:ring-4 transition-all"
                          onClick={() => setMemberSearchOpen(true)}
                        >
                          <span
                            className={
                              customerName
                                ? "text-primary font-black"
                                : "text-muted-foreground font-medium"
                            }
                          >
                            {customerName ? `👤 ${customerName}` : "Cari nama member..."}
                          </span>
                          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                        </Button>
                      </div>
                    ) : (
                      <Input
                        placeholder="Nama Pelanggan (Biasa/Opsional)..."
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="h-12 rounded-xl flex-1 font-semibold"
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
                          <SelectItem value="Custom Diskon">✏️ Diskon Kustom</SelectItem>
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

                <div className="bg-card rounded-2xl p-4 text-center border-2 shadow-sm">
                  {discountAmount > 0 ? (
                    <div className="flex justify-between items-center text-xs text-muted-foreground font-bold mb-1 px-2">
                      <span>Subtotal: {formatRupiah(subtotal)}</span>
                      <span className="text-destructive">- {formatRupiah(discountAmount)}</span>
                    </div>
                  ) : null}
                  <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1 mt-2">
                    Total Bayar
                  </div>
                  <div className="text-4xl font-black text-primary">{formatRupiah(finalTotal)}</div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={method === "Cash" ? "default" : "outline"}
                    className="h-13 rounded-xl text-sm font-bold"
                    onClick={() => setMethod("Cash")}
                  >
                    Tunai (Cash)
                  </Button>
                  <Button
                    variant={method === "QRIS" ? "default" : "outline"}
                    className="h-13 rounded-xl text-sm font-bold"
                    onClick={() => setMethod("QRIS")}
                  >
                    QRIS
                  </Button>
                </div>

                {method === "Cash" && (
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="Uang Diterima (Rp)"
                    value={uangDiterima}
                    onChange={(e) => setUangDiterima(e.target.value.replace(/\D/g, ""))}
                    className="h-16 text-center text-2xl font-black rounded-2xl border-2"
                  />
                )}
              </div>

              <div className="pt-2">
                <Button
                  disabled={isSubmitting}
                  className="w-full h-14 rounded-xl font-bold text-lg"
                  onClick={() =>
                    method === "Cash"
                      ? nominal >= finalTotal
                        ? setShowFinal(true)
                        : toast.error("Uang yang diterima kurang!")
                      : handleFinish()
                  }
                >
                  {isSubmitting ? "Memproses Transaksi..." : "Proses Pembayaran"}
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center p-4">
              <div className="mx-auto w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-4">
                <div className="w-10 h-10 text-green-600 font-black text-2xl">✔</div>
              </div>
              <h3 className="text-2xl font-black mb-1">Kembalian</h3>
              <div className="bg-green-500/10 p-5 rounded-2xl mb-8 border border-green-500/20">
                <div className="text-xs font-bold uppercase text-green-700/70 mb-1">
                  Uang Kembali
                </div>
                <div className="text-5xl font-black text-green-600">{formatRupiah(kembali)}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  disabled={isSubmitting}
                  className="h-14 rounded-xl font-bold text-lg bg-muted text-muted-foreground hover:bg-muted/80"
                  onClick={() => setShowFinal(false)}
                >
                  Batalkan
                </Button>
                <Button
                  disabled={isSubmitting}
                  className="h-14 rounded-xl font-bold text-lg bg-green-600 hover:bg-green-700 text-white"
                  onClick={handleFinish}
                >
                  {isSubmitting ? "Menyimpan..." : "Selesai"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog Pencarian Member */}
      <Dialog open={memberSearchOpen} onOpenChange={setMemberSearchOpen}>
        <DialogContent
          className="rounded-3xl max-w-[85vw] sm:max-w-[360px] p-5 flex flex-col max-h-[80vh] z-[60] overflow-hidden"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <User className="h-5 w-5 text-primary" /> Cari Data Member
            </DialogTitle>
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
                className={`w-full text-left p-3 rounded-xl border-2 flex items-center gap-3 transition-all active:scale-[0.97] ${
                  customerName === m.name
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-card hover:bg-muted/50 border-border"
                }`}
              >
                <div
                  className={`p-2 rounded-full ${
                    customerName === m.name
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
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
