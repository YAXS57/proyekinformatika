/**
 * Consignment Service (Modul Manajemen Konsinyasi)
 * ==================================================
 * Mengelola siklus hidup barang titipan:
 * 1. Penerimaan barang (otomatis masuk Gudang & Kasir)
 * 2. Penjualan Kasir berbasis alokasi FIFO
 * 3. Retur mandiri ke penjual (potong stok Gudang & update batch)
 * 4. Pembatalan transaksi (pengembalian stok konsinyasi)
 * 5. Rekap penyelesaian (settlement) & pencatatan pembayaran bertahap
 */

import {
  db,
  type Consignor,
  type ConsignmentBatch,
  type ConsignmentItem,
  type ConsignmentReturn,
  type ConsignmentSettlement,
  type ConsignmentPayment,
  generateInvoiceNumber,
  generateUUID,
} from "./db";
import { getActiveCashSession } from "./session-helper";

// ─── Tipe Parameter ──────────────────────────────────────────

export interface ReceiveConsignmentParams {
  consignorId: number;
  itemName: string;
  categoryId?: number;
  qtyReceived: number;
  sellPrice: number;
  payoutPerUnit: number;
  periodDays?: number | "custom";
  customStartDate?: number;
  customEndDate?: number;
  notes?: string;
  unit?: string;
}

export interface ReturnConsignmentParams {
  batchId: number;
  qtyToReturn: number;
  returnDate?: number;
  notes?: string;
}

export interface RecordConsignmentPaymentParams {
  batchId: number;
  consignorId: number;
  amount: number;
  paymentMethod: "Cash" | "Transfer";
  notes?: string;
  settlementId?: number;
}

// ─── 1. Penerimaan Barang Titipan ────────────────────────────

/**
 * Menerima barang titipan baru:
 * - Menghitung periode (7, 14, 30 hari, atau tanggal custom)
 * - Otomatis mencatat/menambah stok di Gudang (`inventory`) dengan label 'consignment'
 * - Otomatis mendaftarkan/mengaktifkan produk di Kasir (`menu_items`)
 * - Menyimpan batch penerimaan (`consignment_batches` & `consignment_items`)
 * Seluruh proses berjalan atomik dalam satu transaksi IndexedDB.
 */
export async function receiveConsignmentItem(params: ReceiveConsignmentParams) {
  const {
    consignorId,
    itemName,
    categoryId,
    qtyReceived,
    sellPrice,
    payoutPerUnit,
    periodDays = 14,
    customStartDate,
    customEndDate,
    notes,
    unit = "Bungkus",
  } = params;

  const cleanName = itemName.trim();
  if (!cleanName) throw new Error("Nama barang titipan tidak boleh kosong");
  if (qtyReceived <= 0) throw new Error("Jumlah barang masuk harus lebih dari 0");
  if (sellPrice <= 0) throw new Error("Harga jual harus lebih dari Rp 0");
  if (payoutPerUnit <= 0) throw new Error("Nilai setoran ke penjual harus lebih dari Rp 0");
  if (payoutPerUnit > sellPrice) {
    throw new Error("Nilai setoran ke penjual tidak boleh melebihi harga jual!");
  }

  const consignor = await db.consignors.get(consignorId);
  if (!consignor) throw new Error("Penitip tidak ditemukan di database");

  const now = Date.now();
  let startDate = customStartDate || now;
  let endDate = customEndDate || now + 14 * 86400000;

  if (periodDays !== "custom" && typeof periodDays === "number") {
    startDate = customStartDate || now;
    endDate = startDate + periodDays * 86400000;
  }

  const activeSession = await getActiveCashSession();
  const batchCode = generateInvoiceNumber("CSG");

  return await db.transaction(
    "rw",
    [db.consignment_batches, db.consignment_items, db.inventory, db.menu_items, db.categories],
    async () => {
      // 1. Cari atau buat item di Gudang (inventory)
      // Catatan akuntansi: cost_per_unit = 0 karena ini aset penitip, bukan modal beli toko
      let invItem = await db.inventory.where("name").equals(cleanName).first();

      if (invItem) {
        await db.inventory.update(invItem.id!, {
          stock: invItem.stock + qtyReceived,
          item_type: "consignment",
          consignor_id: consignorId,
          consignor_name: consignor.name,
          last_updated: now,
          updated_at: now,
        });
      } else {
        const invId = await db.inventory.add({
          uuid: generateUUID(),
          name: cleanName,
          stock: qtyReceived,
          unit: unit,
          cost_per_unit: 0,
          item_type: "consignment",
          consignor_id: consignorId,
          consignor_name: consignor.name,
          last_updated: now,
          created_at: now,
          updated_at: now,
          sync_status: "synced",
        });
        invItem = await db.inventory.get(invId);
      }

      if (!invItem || !invItem.id) {
        throw new Error("Gagal menyinkronkan stok barang ke gudang");
      }

      // 2. Cari atau buat menu item di Kasir
      let targetCatId = categoryId;
      if (!targetCatId) {
        // Cari kategori default atau kategori pertama
        const firstCat = await db.categories.toCollection().first();
        if (firstCat && firstCat.id) {
          targetCatId = firstCat.id;
        } else {
          // Buat kategori Titipan jika belum ada sama sekali
          targetCatId = await db.categories.add({
            uuid: generateUUID(),
            name: "Titipan / Cemilan",
            created_at: now,
            updated_at: now,
            sync_status: "synced",
          });
        }
      }

      let menuItem = await db.menu_items.where("inventory_id").equals(invItem.id).first();

      if (menuItem) {
        await db.menu_items.update(menuItem.id!, {
          name: cleanName,
          price: sellPrice,
          is_active: true,
          is_consignment: true,
          updated_at: now,
        });
      } else {
        const menuId = await db.menu_items.add({
          uuid: generateUUID(),
          category_id: targetCatId,
          name: cleanName,
          price: sellPrice,
          inventory_id: invItem.id,
          is_consignment: true,
          is_active: true,
          created_at: now,
          updated_at: now,
          sync_status: "synced",
        });
        menuItem = await db.menu_items.get(menuId);
      }

      // 3. Buat Batch Konsinyasi
      const batchId = await db.consignment_batches.add({
        uuid: generateUUID(),
        batch_code: batchCode,
        consignor_id: consignorId,
        consignor_uuid: consignor.uuid,
        start_date: startDate,
        end_date: endDate,
        period_days: periodDays,
        status: "active",
        total_sales_value: 0,
        total_payout_due: 0,
        total_paid: 0,
        total_returned_qty: 0,
        payment_status: "unpaid",
        notes: notes?.trim() || undefined,
        session_id: activeSession?.id,
        created_at: now,
        updated_at: now,
        sync_status: "synced",
      });

      // 4. Buat Item Konsinyasi
      const consignmentItemId = await db.consignment_items.add({
        uuid: generateUUID(),
        batch_id: batchId,
        batch_uuid: generateUUID(),
        menu_item_id: menuItem?.id,
        menu_item_uuid: menuItem?.uuid,
        inventory_id: invItem.id,
        inventory_uuid: invItem.uuid,
        category_id: targetCatId,
        unit: unit,
        item_name: cleanName,
        qty_received: qtyReceived,
        qty_sold: 0,
        qty_returned: 0,
        sell_price: sellPrice,
        payout_per_unit: payoutPerUnit,
        subtotal_payout: 0,
        angkot_profit: 0,
        created_at: now,
        updated_at: now,
      });

      return {
        batchId,
        consignmentItemId,
        inventoryId: invItem.id,
        menuItemId: menuItem?.id,
        batchCode,
      };
    },
  );
}

// ─── 2. Alokasi Penjualan di Kasir (FIFO Batch Konsinyasi) ─────

/**
 * Mengalokasikan penjualan konsinyasi pada batch aktif secara FIFO:
 * - Mengurangi sisa kuantitas pada batch konsinyasi
 * - Menghasilkan snapshot `payout_at_sale` dan `consignment_batch_id` untuk disimpan di `sale_details`
 * Dipanggil di dalam transaksi checkout Kasir.
 */
export async function allocateConsignmentSale(inventoryId: number, quantitySold: number) {
  // Ambil semua item batch konsinyasi aktif yang memiliki inventory_id ini, urutkan tanggal mulai batch (FIFO)
  const items = await db.consignment_items.where("inventory_id").equals(inventoryId).toArray();

  if (items.length === 0) {
    return [];
  }

  // Dapatkan batch aktif untuk item-item tersebut
  const batchIds = items.map((it) => it.batch_id);
  const batches = await db.consignment_batches.where("id").anyOf(batchIds).toArray();

  const activeBatchMap = new Map<number, ConsignmentBatch>();
  batches.forEach((b) => {
    if (b.status === "active" && b.id) {
      activeBatchMap.set(b.id, b);
    }
  });

  // Urutkan item berdasarkan start_date batch aktif secara ascending (FIFO)
  const sortedItems = items
    .filter((it) => activeBatchMap.has(it.batch_id))
    .sort((a, b) => {
      const bA = activeBatchMap.get(a.batch_id);
      const bB = activeBatchMap.get(b.batch_id);
      return (bA?.start_date || 0) - (bB?.start_date || 0);
    });

  let remainingToAllocate = quantitySold;
  const allocations: Array<{
    batchId: number;
    consignmentItemId: number;
    qtyAllocated: number;
    payoutPerUnit: number;
    sellPrice: number;
  }> = [];

  const now = Date.now();

  for (const cItem of sortedItems) {
    if (remainingToAllocate <= 0) break;
    const availableInBatch = Math.max(0, cItem.qty_received - cItem.qty_sold - cItem.qty_returned);
    if (availableInBatch <= 0) continue;

    const take = Math.min(availableInBatch, remainingToAllocate);
    const newQtySold = cItem.qty_sold + take;
    const newSubtotalPayout = newQtySold * cItem.payout_per_unit;
    const newProfit = newQtySold * (cItem.sell_price - cItem.payout_per_unit);

    await db.consignment_items.update(cItem.id!, {
      qty_sold: newQtySold,
      subtotal_payout: newSubtotalPayout,
      angkot_profit: newProfit,
      updated_at: now,
    });

    // Update akumulasi nilai pada batch
    const batch = activeBatchMap.get(cItem.batch_id);
    if (batch) {
      const updatedTotalDue = (batch.total_payout_due || 0) + take * cItem.payout_per_unit;
      const updatedTotalSales = (batch.total_sales_value || 0) + take * cItem.sell_price;
      await db.consignment_batches.update(batch.id!, {
        total_payout_due: updatedTotalDue,
        total_sales_value: updatedTotalSales,
        updated_at: now,
      });
    }

    allocations.push({
      batchId: cItem.batch_id,
      consignmentItemId: cItem.id!,
      qtyAllocated: take,
      payoutPerUnit: cItem.payout_per_unit,
      sellPrice: cItem.sell_price,
    });

    remainingToAllocate -= take;
  }

  // Jika semua batch aktif habis tetapi masih ada kuantitas terjual,
  // alokasikan ke batch aktif terakhir atau item terbaru
  if (remainingToAllocate > 0 && sortedItems.length > 0) {
    const lastItem = sortedItems[sortedItems.length - 1];
    const newQtySold = lastItem.qty_sold + remainingToAllocate;
    const newSubtotalPayout = newQtySold * lastItem.payout_per_unit;
    const newProfit = newQtySold * (lastItem.sell_price - lastItem.payout_per_unit);

    await db.consignment_items.update(lastItem.id!, {
      qty_sold: newQtySold,
      subtotal_payout: newSubtotalPayout,
      angkot_profit: newProfit,
      updated_at: now,
    });

    allocations.push({
      batchId: lastItem.batch_id,
      consignmentItemId: lastItem.id!,
      qtyAllocated: remainingToAllocate,
      payoutPerUnit: lastItem.payout_per_unit,
      sellPrice: lastItem.sell_price,
    });
  }

  return allocations;
}

// ─── 3. Pembalikan Penjualan (Void / Batal Transaksi) ──────────

/**
 * Membalikkan alokasi konsinyasi saat transaksi dibatalkan / void:
 * - Mengembalikan kuantitas `qty_sold` ke batch konsinyasi
 * - Mengurangi perhitungan `total_payout_due`
 * - Mengembalikan stok ke Gudang fisik
 */
export async function reverseConsignmentSale(
  batchId: number,
  consignmentItemId: number | undefined,
  inventoryId: number | undefined,
  quantityToReverse: number,
) {
  const now = Date.now();

  let cItem: ConsignmentItem | undefined;
  if (consignmentItemId) {
    cItem = await db.consignment_items.get(consignmentItemId);
  } else {
    cItem = await db.consignment_items.where("batch_id").equals(batchId).first();
  }

  if (cItem) {
    const newQtySold = Math.max(0, cItem.qty_sold - quantityToReverse);
    const newSubtotalPayout = newQtySold * cItem.payout_per_unit;
    const newProfit = newQtySold * (cItem.sell_price - cItem.payout_per_unit);

    await db.consignment_items.update(cItem.id!, {
      qty_sold: newQtySold,
      subtotal_payout: newSubtotalPayout,
      angkot_profit: newProfit,
      updated_at: now,
    });

    const batch = await db.consignment_batches.get(batchId);
    if (batch) {
      const updatedTotalDue = Math.max(
        0,
        (batch.total_payout_due || 0) - quantityToReverse * cItem.payout_per_unit,
      );
      const updatedTotalSales = Math.max(
        0,
        (batch.total_sales_value || 0) - quantityToReverse * cItem.sell_price,
      );
      await db.consignment_batches.update(batch.id!, {
        total_payout_due: updatedTotalDue,
        total_sales_value: updatedTotalSales,
        updated_at: now,
      });
    }
  }

  // Kembalikan stok ke Gudang
  if (inventoryId) {
    const inv = await db.inventory.get(inventoryId);
    if (inv) {
      await db.inventory.update(inv.id!, {
        stock: inv.stock + quantityToReverse,
        last_updated: now,
        updated_at: now,
      });
    }
  }
}

// ─── 4. Retur Mandiri ke Penjual ─────────────────────────────

/**
 * Melakukan retur fisik ke penjual sewaktu-waktu:
 * - Memeriksa ketersediaan sisa stok batch
 * - Mengurangi kuantitas di Gudang (`inventory`)
 * - Menambah `qty_returned` di batch
 * - Mencatat riwayat ke tabel `consignment_returns`
 * Tidak dihitung sebagai penjualan atau beban!
 */
export async function returnConsignmentStock(params: ReturnConsignmentParams) {
  const { batchId, qtyToReturn, returnDate = Date.now(), notes } = params;

  if (qtyToReturn <= 0) throw new Error("Jumlah retur harus lebih besar dari 0");

  const batch = await db.consignment_batches.get(batchId);
  if (!batch) throw new Error("Batch konsinyasi tidak ditemukan");

  const cItem = await db.consignment_items.where("batch_id").equals(batchId).first();
  if (!cItem) throw new Error("Item konsinyasi pada batch ini tidak ditemukan");

  const remainingInBatch = cItem.qty_received - cItem.qty_sold - cItem.qty_returned;
  if (qtyToReturn > remainingInBatch) {
    throw new Error(
      `Jumlah retur (${qtyToReturn}) melebihi sisa stok yang tersedia di batch ini (${remainingInBatch})`,
    );
  }

  const activeSession = await getActiveCashSession();
  const returnNumber = generateInvoiceNumber("RET");
  const now = Date.now();

  return await db.transaction(
    "rw",
    [db.consignment_batches, db.consignment_items, db.consignment_returns, db.inventory],
    async () => {
      // 1. Kurangi stok di Gudang jika ada
      if (cItem.inventory_id) {
        const inv = await db.inventory.get(cItem.inventory_id);
        if (inv) {
          const newStock = Math.max(0, inv.stock - qtyToReturn);
          await db.inventory.update(inv.id!, {
            stock: newStock,
            last_updated: now,
            updated_at: now,
          });
        }
      }

      // 2. Update item konsinyasi
      const newReturned = cItem.qty_returned + qtyToReturn;
      await db.consignment_items.update(cItem.id!, {
        qty_returned: newReturned,
        updated_at: now,
      });

      // 3. Update total retur pada batch
      const newTotalReturned = (batch.total_returned_qty || 0) + qtyToReturn;
      await db.consignment_batches.update(batch.id!, {
        total_returned_qty: newTotalReturned,
        updated_at: now,
      });

      // 4. Catat riwayat ke consignment_returns
      const returnId = await db.consignment_returns.add({
        uuid: generateUUID(),
        return_number: returnNumber,
        batch_id: batchId,
        batch_uuid: batch.uuid,
        item_id: cItem.id,
        item_name: cItem.item_name,
        inventory_id: cItem.inventory_id,
        return_date: returnDate,
        qty_returned: qtyToReturn,
        notes: notes?.trim() || undefined,
        session_id: activeSession?.id,
        session_uuid: activeSession?.uuid,
        created_at: now,
        updated_at: now,
        sync_status: "synced",
      });

      return {
        returnId,
        returnNumber,
        remainingInBatch: remainingInBatch - qtyToReturn,
      };
    },
  );
}

// ─── 5. Pembayaran Bertahap & Penyelesaian ────────────────────

/**
 * Mencatat pembayaran setoran kepada penjual (bisa bertahap/cicil atau lunas):
 * - Mencatat ke `consignment_payments`
 * - Memperbarui `consignment_batches.total_paid` dan status pembayaran
 * - Jika pembayaran secara Tunai, otomatis terhubung ke Sesi Kasir Harian
 */
export async function recordConsignmentPayment(params: RecordConsignmentPaymentParams) {
  const { batchId, consignorId, amount, paymentMethod, notes, settlementId } = params;

  if (amount <= 0) throw new Error("Nominal pembayaran harus lebih besar dari Rp 0");

  const batch = await db.consignment_batches.get(batchId);
  if (!batch) throw new Error("Batch konsinyasi tidak ditemukan");

  const activeSession = await getActiveCashSession();
  const paymentNumber = generateInvoiceNumber("PAY");
  const now = Date.now();

  return await db.transaction(
    "rw",
    [db.consignment_batches, db.consignment_payments, db.consignment_settlements],
    async () => {
      const newTotalPaid = (batch.total_paid || 0) + amount;
      const totalDue = batch.total_payout_due || 0;

      let paymentStatus: "unpaid" | "partial" | "paid" = "partial";
      if (newTotalPaid >= totalDue && totalDue > 0) {
        paymentStatus = "paid";
      } else if (newTotalPaid <= 0) {
        paymentStatus = "unpaid";
      }

      await db.consignment_batches.update(batchId, {
        total_paid: newTotalPaid,
        payment_status: paymentStatus,
        updated_at: now,
      });

      // Catat entri pembayaran
      const paymentId = await db.consignment_payments.add({
        uuid: generateUUID(),
        payment_number: paymentNumber,
        settlement_id: settlementId,
        batch_id: batchId,
        batch_uuid: batch.uuid,
        consignor_id: consignorId,
        payment_date: now,
        amount_paid: amount,
        payment_method: paymentMethod,
        notes: notes?.trim() || undefined,
        session_id: paymentMethod === "Cash" ? activeSession?.id : undefined,
        session_uuid: paymentMethod === "Cash" ? activeSession?.uuid : undefined,
        created_at: now,
        updated_at: now,
        sync_status: "synced",
      });

      return {
        paymentId,
        paymentNumber,
        newTotalPaid,
        remainingDue: Math.max(0, totalDue - newTotalPaid),
        paymentStatus,
      };
    },
  );
}

// ─── 6. Kalkulator Ringkasan Batch ────────────────────────────

export interface BatchSummary {
  batch: ConsignmentBatch;
  item: ConsignmentItem;
  consignor?: Consignor;
  qtyReceived: number;
  qtySold: number;
  qtyReturned: number;
  remainingStock: number;
  totalSalesValue: number;
  totalPayoutDue: number;
  grossProfit: number;
  totalPaid: number;
  remainingPayout: number;
  paymentStatus: "unpaid" | "partial" | "paid";
  isOverdue: boolean;
  isDueSoon: boolean;
  daysRemaining: number;
}

export function computeBatchSummary(
  batch: ConsignmentBatch,
  item: ConsignmentItem,
  consignor?: Consignor,
): BatchSummary {
  const now = Date.now();
  const qtyReceived = item.qty_received || 0;
  const qtySold = item.qty_sold || 0;
  const qtyReturned = item.qty_returned || 0;
  const remainingStock = Math.max(0, qtyReceived - qtySold - qtyReturned);

  const totalSalesValue = qtySold * item.sell_price;
  const totalPayoutDue = qtySold * item.payout_per_unit;
  const grossProfit = totalSalesValue - totalPayoutDue;

  const totalPaid = batch.total_paid || 0;
  const remainingPayout = Math.max(0, totalPayoutDue - totalPaid);

  let paymentStatus = batch.payment_status || "unpaid";
  if (totalPaid >= totalPayoutDue && totalPayoutDue > 0) {
    paymentStatus = "paid";
  } else if (totalPaid > 0) {
    paymentStatus = "partial";
  }

  const isOverdue = now > batch.end_date;
  const isDueSoon = !isOverdue && now >= batch.end_date - 2 * 86400000;
  const daysRemaining = Math.ceil((batch.end_date - now) / 86400000);

  return {
    batch,
    item,
    consignor,
    qtyReceived,
    qtySold,
    qtyReturned,
    remainingStock,
    totalSalesValue,
    totalPayoutDue,
    grossProfit,
    totalPaid,
    remainingPayout,
    paymentStatus,
    isOverdue,
    isDueSoon,
    daysRemaining,
  };
}
