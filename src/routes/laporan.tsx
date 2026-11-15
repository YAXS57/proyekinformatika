import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useState, useMemo, useEffect } from "react";
import { db } from "@/lib/db";
import { formatRupiah } from "@/lib/format";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  FileDown,
  TrendingUp,
  Trophy,
  Tag,
  Package,
  ShoppingBag,
  Layers,
  Store,
} from "lucide-react";
import { toast } from "sonner";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { LocalNotifications } from "@capacitor/local-notifications";
import { FileOpener } from "@capacitor-community/file-opener";

export const Route = createFileRoute("/laporan")({
  head: () => ({ meta: [{ title: "Laporan — Angkringan POS" }] }),
  component: LaporanPage,
});

function LaporanPage() {
  const sales = useLiveQuery(() => db.sales.orderBy("transaction_date").reverse().toArray(), []);
  const expenses = useLiveQuery(() => db.expenses.toArray(), []);
  const purchases = useLiveQuery(
    () => db.purchases.orderBy("purchase_date").reverse().toArray(),
    [],
  );
  const consignmentBatches = useLiveQuery(
    () => db.consignment_batches.orderBy("start_date").reverse().toArray(),
    [],
  );
  const consignmentItems = useLiveQuery(() => db.consignment_items.toArray(), []);
  const consignors = useLiveQuery(() => db.consignors.toArray(), []);
  const consignmentSettlements = useLiveQuery(
    () => db.consignment_settlements.orderBy("settlement_date").reverse().toArray(),
    [],
  );
  const closedSessions = useLiveQuery(
    () => db.cash_sessions.where("status").equals("closed").reverse().toArray(),
    [],
  );
  const saleDetails = useLiveQuery(() => db.sale_details.toArray(), []);
  const inventory = useLiveQuery(() => db.inventory.toArray(), []);

  const [activeReportTab, setActiveReportTab] = useState("keuangan");
  const [timeFilter, setTimeFilter] = useState("7d");
  const [confirmExportOpen, setConfirmExportOpen] = useState(false);

  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    if (Capacitor.isNativePlatform()) {
      LocalNotifications.addListener("localNotificationActionPerformed", async (action) => {
        const filePath = action.notification.extra?.path;
        if (filePath && filePath.endsWith(".pdf")) {
          try {
            await FileOpener.open({ filePath: filePath, contentType: "application/pdf" });
          } catch {
            toast.error("Gagal membuka PDF.");
          }
        }
      }).then((handle) => {
        sub = handle;
      });
    }
    return () => {
      if (sub && typeof sub.remove === "function") {
        sub.remove();
      }
    };
  }, []);

  const totalAsetGudang = useMemo(() => {
    return inventory?.reduce((sum, inv) => sum + inv.stock * (inv.cost_per_unit || 0), 0) || 0;
  }, [inventory]);

  const {
    chartData,
    totalOmset,
    totalDiskon,
    totalKulakan,
    totalPengeluaran,
    totalSetoran,
    labaBersih,
    totalTransaksi,
    rentangTeks,
    topItems,
  } = useMemo(() => {
    if (!sales || !expenses || !saleDetails)
      return {
        chartData: [],
        totalOmset: 0,
        totalDiskon: 0,
        totalKulakan: 0,
        totalPengeluaran: 0,
        totalSetoran: 0,
        labaBersih: 0,
        totalTransaksi: 0,
        rentangTeks: "",
        topItems: [],
      };

    const now = new Date();
    let cutoff = new Date(0);
    let rentangTeks = "Semua Waktu";

    if (timeFilter === "7d") {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      rentangTeks = "7 Hari Terakhir";
    } else if (timeFilter === "30d") {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      rentangTeks = "30 Hari Terakhir";
    } else if (timeFilter === "1y") {
      cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      rentangTeks = "1 Tahun Terakhir";
    }

    const filteredSales = sales.filter((s) => s.transaction_date >= cutoff.getTime());
    const filteredExpenses = expenses.filter((e) => e.expense_date >= cutoff.getTime());
    const filteredPurchases = purchases
      ? purchases.filter((p) => p.purchase_date >= cutoff.getTime())
      : [];
    const filteredSettlements = consignmentSettlements
      ? consignmentSettlements.filter((st) => st.settlement_date >= cutoff.getTime())
      : [];
    const filteredSaleIds = new Set(filteredSales.map((s) => s.id));

    const totalOmset = filteredSales.reduce(
      (sum, s) => (s.status !== "void" ? sum + s.total_amount : sum),
      0,
    );
    const totalDiskon = filteredSales.reduce((sum, s) => sum + (s.discount_amount || 0), 0);
    const totalKulakan = filteredPurchases.reduce((sum, p) => sum + p.total_amount, 0);
    const totalPengeluaran = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
    const totalSetoran = filteredSettlements.reduce((sum, st) => sum + st.amount_paid, 0);

    // Laba Bersih Riil Bisnis: Omzet Bersih - Kulakan - Beban Operasional - Hak Setor Konsinyasi Terbayar
    const labaBersih = totalOmset - totalKulakan - totalPengeluaran - totalSetoran;
    const totalTransaksi = filteredSales.length;

    const dataMap = new Map();
    const isMonthly = timeFilter === "1y" || timeFilter === "all";

    filteredSales.forEach((sale) => {
      const dateStr = format(sale.transaction_date, isMonthly ? "MMM yyyy" : "dd MMM", {
        locale: idLocale,
      });
      const existing = dataMap.get(dateStr) || {
        name: dateStr,
        pemasukan: 0,
        pengeluaran: 0,
        rawDate: sale.transaction_date,
      };
      existing.pemasukan += sale.total_amount;
      dataMap.set(dateStr, existing);
    });

    filteredExpenses.forEach((expense) => {
      const dateStr = format(expense.expense_date, isMonthly ? "MMM yyyy" : "dd MMM", {
        locale: idLocale,
      });
      const existing = dataMap.get(dateStr) || {
        name: dateStr,
        pemasukan: 0,
        pengeluaran: 0,
        rawDate: expense.expense_date,
      };
      existing.pengeluaran += expense.amount;
      dataMap.set(dateStr, existing);
    });

    const sortedChartData = Array.from(dataMap.values()).sort((a, b) => a.rawDate - b.rawDate);

    const itemCounts = new Map();
    saleDetails.forEach((detail) => {
      if (filteredSaleIds.has(detail.sale_id)) {
        const currentQty = itemCounts.get(detail.item_name) || 0;
        itemCounts.set(detail.item_name, currentQty + detail.quantity);
      }
    });

    const topItems = Array.from(itemCounts.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    return {
      chartData: sortedChartData,
      totalOmset,
      totalDiskon,
      totalKulakan,
      totalPengeluaran,
      totalSetoran,
      labaBersih,
      totalTransaksi,
      rentangTeks,
      topItems,
    };
  }, [sales, expenses, purchases, consignmentSettlements, saleDetails, timeFilter]);

  const exportPDF = async () => {
    setConfirmExportOpen(false);
    const tId = toast.loading("Menyusun laporan PDF komprehensif...");

    try {
      const [
        allSales,
        allExpenses,
        allPurchases,
        allConsignmentBatches,
        allConsignmentItems,
        allConsignors,
        allConsignmentSettlements,
        allCashSessions,
        allSaleDetails,
        allInventory,
      ] = await Promise.all([
        db.sales.orderBy("transaction_date").reverse().toArray(),
        db.expenses.orderBy("expense_date").toArray(),
        db.purchases.orderBy("purchase_date").reverse().toArray(),
        db.consignment_batches.orderBy("start_date").reverse().toArray(),
        db.consignment_items.toArray(),
        db.consignors.toArray(),
        db.consignment_settlements.orderBy("settlement_date").reverse().toArray(),
        db.cash_sessions.where("status").equals("closed").reverse().toArray(),
        db.sale_details.toArray(),
        db.inventory.toArray(),
      ]);

      const now = new Date();
      let cutoff = new Date(0);
      let periodeFileTeks = "Semua_Waktu";

      if (timeFilter === "7d") {
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        periodeFileTeks = "7_Hari";
      } else if (timeFilter === "30d") {
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
        periodeFileTeks = "30_Hari";
      } else if (timeFilter === "1y") {
        cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        periodeFileTeks = "1_Tahun";
      }

      const filteredSales = allSales.filter((s) => s.transaction_date >= cutoff.getTime());
      const filteredExpenses = allExpenses.filter((e) => e.expense_date >= cutoff.getTime());
      const filteredPurchases = allPurchases.filter((p) => p.purchase_date >= cutoff.getTime());
      const filteredBatches = allConsignmentBatches.filter((b) => b.start_date >= cutoff.getTime());
      const filteredSettlements = allConsignmentSettlements.filter(
        (st) => st.settlement_date >= cutoff.getTime(),
      );
      const filteredSessions = allCashSessions.filter((cs) => cs.opened_at >= cutoff.getTime());

      if (
        filteredSales.length === 0 &&
        filteredExpenses.length === 0 &&
        filteredPurchases.length === 0 &&
        filteredBatches.length === 0
      ) {
        toast.dismiss(tId);
        return toast.error(`Data kosong untuk periode ${rentangTeks}.`);
      }

      const filteredSaleIds = new Set(filteredSales.map((s) => s.id));
      const itemCountsPDF = new Map();
      allSaleDetails.forEach((detail) => {
        if (filteredSaleIds.has(detail.sale_id)) {
          const currentQty = itemCountsPDF.get(detail.item_name) || 0;
          itemCountsPDF.set(detail.item_name, currentQty + detail.quantity);
        }
      });
      const topItemsPDF = Array.from(itemCountsPDF.entries())
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = 210;
      const margin = 14;
      const contentWidth = pageWidth - margin * 2; // 182mm

      // Kalkulasi Keuangan Komprehensif
      let totalCash = 0;
      let totalQRIS = 0;
      let sumDiskon = 0;
      filteredSales.forEach((s) => {
        if (s.status !== "void") {
          if (s.payment_method === "Cash") totalCash += s.total_amount;
          if (s.payment_method === "QRIS") totalQRIS += s.total_amount;
          sumDiskon += s.discount_amount || 0;
        }
      });

      const totalPenjualanBersih = totalCash + totalQRIS; // Net Sales
      const totalPenjualanKotor = totalPenjualanBersih + sumDiskon; // Gross Sales
      const totalKulakan = filteredPurchases.reduce((sum, p) => sum + p.total_amount, 0);
      const totalPeng = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
      const totalSetoran = filteredSettlements.reduce((sum, st) => sum + st.amount_paid, 0);
      const totalHakSetor = filteredBatches.reduce((sum, b) => sum + b.total_payout_due, 0);

      // Laba Bersih Riil: Penjualan Bersih - Kulakan - Beban Operasional - Hak Setor Titipan
      const labaBersihCalc = totalPenjualanBersih - totalKulakan - totalPeng - totalSetoran;

      // 1. Accent Bar di paling atas halaman
      doc.setFillColor(234, 179, 8); // Gold / Amber
      doc.rect(0, 0, pageWidth, 3.5, "F");

      // 2. Header Bisnis & Informasi Cetak
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(15, 23, 42); // slate-900
      doc.text("ANGKRINGAN POS", margin, 15);

      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text("LAPORAN EKSEKUTIF KEUANGAN & OPERASIONAL LENGKAP", margin, 20);

      // Badge Periode & Waktu di pojok kanan atas
      const badgeW = 68;
      const badgeH = 14;
      const badgeX = pageWidth - margin - badgeW;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(badgeX, 8.5, badgeW, badgeH, 2, 2, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(`Periode: ${rentangTeks}`, badgeX + 3.5, 13.5);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Dicetak: ${format(new Date(), "dd MMM yyyy, HH:mm", { locale: idLocale })}`,
        badgeX + 3.5,
        18.5,
      );

      // Garis Pemisah Header
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.4);
      doc.line(margin, 25.5, pageWidth - margin, 25.5);

      // 3. Kartu Ringkasan Eksekutif (4 KPI Cards: Omzet, Kulakan, Beban, Laba Bersih)
      const cardY = 29.5;
      const cardGap = 3.5;
      const cardW = (contentWidth - cardGap * 3) / 4; // ~42.8mm
      const cardH = 22;

      // Card 1: Penjualan Bersih
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, cardY, cardW, cardH, 2, 2, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text("PENJUALAN BERSIH", margin + 3, cardY + 5.5);

      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(formatRupiah(totalPenjualanBersih), margin + 3, cardY + 12.5);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(100, 116, 139);
      doc.text(`Kotor: ${formatRupiah(totalPenjualanKotor)}`, margin + 3, cardY + 18);

      // Card 2: Pembelian Kulakan
      const card2X = margin + cardW + cardGap;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(card2X, cardY, cardW, cardH, 2, 2, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(37, 99, 235); // Blue
      doc.text("KULAKAN DAGANGAN", card2X + 3, cardY + 5.5);

      doc.setFontSize(9.5);
      doc.setTextColor(37, 99, 235);
      doc.text(formatRupiah(totalKulakan), card2X + 3, cardY + 12.5);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(100, 116, 139);
      doc.text(`${filteredPurchases.length} faktur pembelian`, card2X + 3, cardY + 18);

      // Card 3: Biaya Operasional
      const card3X = card2X + cardW + cardGap;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(card3X, cardY, cardW, cardH, 2, 2, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(220, 38, 38); // Red
      doc.text("BIAYA OPERASIONAL", card3X + 3, cardY + 5.5);

      doc.setFontSize(9.5);
      doc.setTextColor(220, 38, 38);
      doc.text(formatRupiah(totalPeng), card3X + 3, cardY + 12.5);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(100, 116, 139);
      doc.text(`${filteredExpenses.length} catatan beban`, card3X + 3, cardY + 18);

      // Card 4: Laba Bersih Riil
      const card4X = card3X + cardW + cardGap;
      const isProfit = labaBersihCalc >= 0;
      if (isProfit) {
        doc.setFillColor(240, 253, 244); // light green
        doc.setDrawColor(187, 247, 208); // green border
      } else {
        doc.setFillColor(254, 242, 242); // light red
        doc.setDrawColor(254, 202, 202); // red border
      }
      doc.roundedRect(card4X, cardY, cardW, cardH, 2, 2, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(isProfit ? 22 : 185, isProfit ? 101 : 28, isProfit ? 52 : 28);
      doc.text(isProfit ? "LABA BERSIH RIIL" : "DEFISIT BERSIH", card4X + 3, cardY + 5.5);

      doc.setFontSize(9.5);
      doc.text(formatRupiah(Math.abs(labaBersihCalc)), card4X + 3, cardY + 12.5);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(isProfit ? 21 : 185, isProfit ? 128 : 28, isProfit ? 61 : 28);
      doc.text("Omzet - Kulakan - Beban", card4X + 3, cardY + 18);

      // 4. Bar Info Tambahan (Metode Pembayaran, Diskon, Setoran Konsinyasi, Aset Gudang)
      const infoY = cardY + cardH + 3.5;
      const infoH = 8.5;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, infoY, contentWidth, infoH, 1.5, 1.5, "FD");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `Tunai: ${formatRupiah(totalCash)}  |  QRIS: ${formatRupiah(totalQRIS)}`,
        margin + 3.5,
        infoY + 5.5,
      );
      doc.text(
        `Diskon: ${formatRupiah(sumDiskon)}  |  Setoran Titipan: ${formatRupiah(totalSetoran)}`,
        margin + 68,
        infoY + 5.5,
      );
      doc.text(
        `Aset Gudang: ${formatRupiah(totalAsetGudang)}`,
        pageWidth - margin - 3.5,
        infoY + 5.5,
        { align: "right" },
      );

      // Helper untuk menggambar Section Title yang rapi
      const drawSectionHeader = (
        yPos: number,
        title: string,
        subtitle?: string,
        accentColor: [number, number, number] = [234, 179, 8],
      ) => {
        doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
        doc.roundedRect(margin, yPos - 3.8, 2.5, 5.5, 0.8, 0.8, "F");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        doc.text(title, margin + 4.5, yPos);

        if (subtitle) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          doc.setTextColor(100, 116, 139);
          doc.text(subtitle, pageWidth - margin, yPos, { align: "right" });
        }
      };

      // 5. Tabel Rincian Pemasukan (Penjualan)
      const startSectionY = infoY + infoH + 8;
      drawSectionHeader(
        startSectionY,
        "1. Rincian Penjualan & Penerimaan Kas/QRIS",
        `Total ${filteredSales.length} transaksi`,
        [234, 179, 8],
      );

      autoTable(doc, {
        startY: startSectionY + 2.5,
        margin: { left: margin, right: margin },
        head: [["No", "No Nota", "Waktu", "Pelanggan", "Metode", "Diskon", "Total Bersih"]],
        body:
          filteredSales.length > 0
            ? filteredSales.map((s, idx) => [
                idx + 1,
                s.invoice_number || `TRX-${s.id}`,
                format(s.transaction_date, "dd/MM/yy HH:mm"),
                `${s.customer_name || "Guest"} ${s.is_member ? "(Member)" : ""}`,
                s.payment_method,
                s.discount_amount && s.discount_amount > 0 ? formatRupiah(s.discount_amount) : "-",
                formatRupiah(s.total_amount),
              ])
            : [["-", "-", "-", "Belum ada transaksi penjualan pada periode ini", "-", "-", "-"]],
        foot:
          filteredSales.length > 0
            ? [
                [
                  "",
                  "TOTAL PENJUALAN",
                  "",
                  "",
                  "",
                  formatRupiah(sumDiskon),
                  formatRupiah(totalPenjualanBersih),
                ],
              ]
            : undefined,
        theme: "grid",
        headStyles: {
          fillColor: [30, 41, 59],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 7.5,
          halign: "center",
          cellPadding: 2,
        },
        bodyStyles: {
          fontSize: 7.2,
          textColor: [30, 41, 59],
          cellPadding: 1.8,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        footStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: "bold",
          fontSize: 7.5,
          cellPadding: 2,
        },
        columnStyles: {
          0: { halign: "center", cellWidth: 8 },
          1: { halign: "center", cellWidth: 32 },
          2: { halign: "center", cellWidth: 26 },
          3: { halign: "left", cellWidth: 34 },
          4: { halign: "center", cellWidth: 20 },
          5: { halign: "right", cellWidth: 26 },
          6: { halign: "right", cellWidth: 36 },
        },
        styles: {
          lineColor: [226, 232, 240],
          lineWidth: 0.15,
        },
      });

      const autoDoc = doc as unknown as { lastAutoTable: { finalY: number } };
      let currentY = autoDoc.lastAutoTable.finalY + 8;
      if (currentY > 235) {
        doc.addPage();
        currentY = 20;
      }

      // 6. Tabel Rincian Pembelian Barang Dagangan (Kulakan)
      drawSectionHeader(
        currentY,
        "2. Rincian Pembelian Barang Dagangan (Kulakan)",
        `Total ${filteredPurchases.length} faktur pembelian`,
        [37, 99, 235],
      );

      autoTable(doc, {
        startY: currentY + 2.5,
        margin: { left: margin, right: margin },
        head: [
          ["No", "No Faktur", "Tanggal", "Pemasok / Toko Grosir", "Metode", "Total Pembelian"],
        ],
        body:
          filteredPurchases.length > 0
            ? filteredPurchases.map((p, idx) => [
                idx + 1,
                p.invoice_number,
                format(p.purchase_date, "dd/MM/yyyy"),
                p.supplier_name || "-",
                p.payment_method,
                formatRupiah(p.total_amount),
              ])
            : [["-", "-", "-", "Tidak ada pembelian kulakan pada periode ini", "-", "-"]],
        foot:
          filteredPurchases.length > 0
            ? [["", "TOTAL PEMBELIAN KULAKAN", "", "", "", formatRupiah(totalKulakan)]]
            : undefined,
        theme: "grid",
        headStyles: {
          fillColor: [30, 58, 138],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 7.5,
          halign: "center",
          cellPadding: 2,
        },
        bodyStyles: {
          fontSize: 7.2,
          textColor: [30, 41, 59],
          cellPadding: 1.8,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        footStyles: {
          fillColor: [239, 246, 255],
          textColor: [29, 78, 216],
          fontStyle: "bold",
          fontSize: 7.5,
          cellPadding: 2,
        },
        columnStyles: {
          0: { halign: "center", cellWidth: 10 },
          1: { halign: "center", cellWidth: 36 },
          2: { halign: "center", cellWidth: 26 },
          3: { halign: "left", cellWidth: 50 },
          4: { halign: "center", cellWidth: 24 },
          5: { halign: "right", cellWidth: 36 },
        },
        styles: {
          lineColor: [226, 232, 240],
          lineWidth: 0.15,
        },
      });

      currentY = autoDoc.lastAutoTable.finalY + 8;
      if (currentY > 235) {
        doc.addPage();
        currentY = 20;
      }

      // 7. Tabel Rincian Pengeluaran Beban Operasional
      drawSectionHeader(
        currentY,
        "3. Rincian Pengeluaran Beban Operasional",
        `Total ${filteredExpenses.length} catatan beban`,
        [220, 38, 38],
      );

      autoTable(doc, {
        startY: currentY + 2.5,
        margin: { left: margin, right: margin },
        head: [["No", "Tanggal", "Kategori Beban", "Keterangan / Deskripsi", "Metode", "Nominal"]],
        body:
          filteredExpenses.length > 0
            ? filteredExpenses.map((e, idx) => [
                idx + 1,
                format(e.expense_date, "dd/MM/yyyy"),
                e.category,
                e.description || "-",
                e.payment_method || "Cash",
                formatRupiah(e.amount),
              ])
            : [["-", "-", "-", "Tidak ada pengeluaran beban pada periode ini", "-", "-"]],
        foot:
          filteredExpenses.length > 0
            ? [["", "TOTAL BEBAN OPERASIONAL", "", "", "", formatRupiah(totalPeng)]]
            : undefined,
        theme: "grid",
        headStyles: {
          fillColor: [51, 65, 85],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 7.5,
          halign: "center",
          cellPadding: 2,
        },
        bodyStyles: {
          fontSize: 7.2,
          textColor: [30, 41, 59],
          cellPadding: 1.8,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        footStyles: {
          fillColor: [254, 242, 242],
          textColor: [185, 28, 28],
          fontStyle: "bold",
          fontSize: 7.5,
          cellPadding: 2,
        },
        columnStyles: {
          0: { halign: "center", cellWidth: 10 },
          1: { halign: "center", cellWidth: 24 },
          2: { halign: "left", cellWidth: 36 },
          3: { halign: "left", cellWidth: 56 },
          4: { halign: "center", cellWidth: 20 },
          5: { halign: "right", cellWidth: 36 },
        },
        styles: {
          lineColor: [226, 232, 240],
          lineWidth: 0.15,
        },
      });

      currentY = autoDoc.lastAutoTable.finalY + 8;
      if (currentY > 235) {
        doc.addPage();
        currentY = 20;
      }

      // 8. Tabel Laporan Konsinyasi & Setoran Penitip
      drawSectionHeader(
        currentY,
        "4. Laporan Konsinyasi (Titip Jual) & Setoran Penitip",
        `Total ${filteredBatches.length} batch titipan`,
        [124, 58, 237],
      );

      autoTable(doc, {
        startY: currentY + 2.5,
        margin: { left: margin, right: margin },
        head: [
          [
            "No",
            "Kode Batch",
            "Nama Penitip",
            "Barang Titip",
            "Terima/Laku/Retur",
            "Hak Setor",
            "Terbayar",
            "Status",
          ],
        ],
        body:
          filteredBatches.length > 0
            ? filteredBatches.map((b, idx) => {
                const c = allConsignors.find((cn) => cn.id === b.consignor_id);
                const it = allConsignmentItems.find((itm) => itm.batch_id === b.id);
                return [
                  idx + 1,
                  b.batch_code,
                  c?.name || "Penitip",
                  it?.item_name || "Titipan",
                  `${it?.qty_received || 0} / ${it?.qty_sold || 0} / ${it?.qty_returned || 0}`,
                  formatRupiah(b.total_payout_due),
                  formatRupiah(b.total_paid),
                  b.payment_status === "paid"
                    ? "Lunas"
                    : b.payment_status === "partial"
                      ? "Sebagian"
                      : "Belum Lunas",
                ];
              })
            : [["-", "-", "-", "Tidak ada konsinyasi pada periode ini", "-", "-", "-", "-"]],
        foot:
          filteredBatches.length > 0
            ? [
                [
                  "",
                  "TOTAL SETORAN KONSINYASI",
                  "",
                  "",
                  "",
                  formatRupiah(totalHakSetor),
                  formatRupiah(totalSetoran),
                  "",
                ],
              ]
            : undefined,
        theme: "grid",
        headStyles: {
          fillColor: [88, 28, 135],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 7.5,
          halign: "center",
          cellPadding: 2,
        },
        bodyStyles: {
          fontSize: 7.2,
          textColor: [30, 41, 59],
          cellPadding: 1.8,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        footStyles: {
          fillColor: [245, 243, 255],
          textColor: [109, 40, 217],
          fontStyle: "bold",
          fontSize: 7.5,
          cellPadding: 2,
        },
        columnStyles: {
          0: { halign: "center", cellWidth: 8 },
          1: { halign: "center", cellWidth: 32 },
          2: { halign: "left", cellWidth: 30 },
          3: { halign: "left", cellWidth: 32 },
          4: { halign: "center", cellWidth: 26 },
          5: { halign: "right", cellWidth: 28 },
          6: { halign: "right", cellWidth: 26 },
          7: { halign: "center", cellWidth: 20 },
        },
        styles: {
          lineColor: [226, 232, 240],
          lineWidth: 0.15,
        },
      });

      currentY = autoDoc.lastAutoTable.finalY + 8;
      if (currentY > 235) {
        doc.addPage();
        currentY = 20;
      }

      // 9. Tabel Riwayat Penutupan Sesi Kas Harian (Rekonsiliasi Kas)
      drawSectionHeader(
        currentY,
        "5. Riwayat Penutupan Kas Harian (Rekonsiliasi Fisik)",
        `Total ${filteredSessions.length} sesi kas tutup`,
        [16, 185, 129],
      );

      autoTable(doc, {
        startY: currentY + 2.5,
        margin: { left: margin, right: margin },
        head: [
          [
            "No",
            "Tanggal Sesi",
            "Jam Tutup",
            "Modal Awal",
            "Penj. Tunai",
            "Kas Seharusnya",
            "Kas Fisik Riil",
            "Selisih Kas",
          ],
        ],
        body:
          filteredSessions.length > 0
            ? filteredSessions.map((cs, idx) => [
                idx + 1,
                cs.session_date,
                cs.closed_at ? format(cs.closed_at, "dd/MM HH:mm") : "-",
                formatRupiah(cs.initial_cash),
                formatRupiah(cs.total_cash_sales),
                formatRupiah(cs.expected_cash),
                formatRupiah(cs.actual_cash || 0),
                (cs.cash_difference || 0) === 0
                  ? "Pas (Rp 0)"
                  : formatRupiah(cs.cash_difference || 0),
              ])
            : [
                [
                  "-",
                  "-",
                  "-",
                  "Belum ada riwayat penutupan kas pada periode ini",
                  "-",
                  "-",
                  "-",
                  "-",
                ],
              ],
        theme: "grid",
        headStyles: {
          fillColor: [6, 95, 70],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 7.5,
          halign: "center",
          cellPadding: 2,
        },
        bodyStyles: {
          fontSize: 7.2,
          textColor: [30, 41, 59],
          cellPadding: 1.8,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: {
          0: { halign: "center", cellWidth: 8 },
          1: { halign: "center", cellWidth: 24 },
          2: { halign: "center", cellWidth: 24 },
          3: { halign: "right", cellWidth: 24 },
          4: { halign: "right", cellWidth: 26 },
          5: { halign: "right", cellWidth: 26 },
          6: { halign: "right", cellWidth: 26 },
          7: { halign: "center", cellWidth: 24 },
        },
        styles: {
          lineColor: [226, 232, 240],
          lineWidth: 0.15,
        },
      });

      currentY = autoDoc.lastAutoTable.finalY + 8;
      if (currentY > 235) {
        doc.addPage();
        currentY = 20;
      }

      // 10. Tabel 5 Menu Terlaris (Bebas Karakter Emojis Agar Tidak Rusak / Corrupt)
      drawSectionHeader(
        currentY,
        "6. Peringkat 5 Menu Terlaris",
        "Berdasarkan kuantitas penjualan",
        [234, 179, 8],
      );

      autoTable(doc, {
        startY: currentY + 2.5,
        margin: { left: margin, right: margin },
        head: [["Peringkat", "Nama Menu", "Jumlah Terjual"]],
        body:
          topItemsPDF.length > 0
            ? topItemsPDF.map((item, index) => [`#${index + 1}`, item.name, `${item.qty} porsi`])
            : [["-", "Belum ada data penjualan menu pada periode ini", "-"]],
        theme: "grid",
        headStyles: {
          fillColor: [71, 85, 105],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 7.5,
          halign: "center",
          cellPadding: 2,
        },
        bodyStyles: {
          fontSize: 7.2,
          textColor: [30, 41, 59],
          cellPadding: 1.8,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: {
          0: { halign: "center", cellWidth: 24 },
          1: { halign: "left", cellWidth: 108 },
          2: { halign: "right", cellWidth: 50 },
        },
        styles: {
          lineColor: [226, 232, 240],
          lineWidth: 0.15,
        },
      });

      currentY = autoDoc.lastAutoTable.finalY + 8;
      if (currentY > 235) {
        doc.addPage();
        currentY = 20;
      }

      // 11. Tabel Laporan Sisa Stok Gudang
      drawSectionHeader(
        currentY,
        "7. Laporan Sisa Stok & Nilai Aset Gudang",
        `Total Aset: ${formatRupiah(totalAsetGudang)}`,
        [14, 116, 144],
      );

      autoTable(doc, {
        startY: currentY + 2.5,
        margin: { left: margin, right: margin },
        head: [
          [
            "No",
            "Nama Bahan / Barang",
            "Sisa Stok",
            "Modal / Satuan",
            "Total Nilai Aset",
            "Update Terakhir",
          ],
        ],
        body:
          allInventory.length > 0
            ? allInventory.map((inv, idx) => [
                idx + 1,
                inv.name,
                `${inv.stock} ${inv.unit}`,
                formatRupiah(inv.cost_per_unit || 0),
                formatRupiah(inv.stock * (inv.cost_per_unit || 0)),
                format(inv.last_updated, "dd/MM/yy HH:mm"),
              ])
            : [["-", "Gudang Kosong / Belum ada data bahan", "-", "-", "-", "-"]],
        foot:
          allInventory.length > 0
            ? [["", "TOTAL NILAI ASET GUDANG", "", "", formatRupiah(totalAsetGudang), ""]]
            : undefined,
        theme: "grid",
        headStyles: {
          fillColor: [21, 94, 117],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 7.5,
          halign: "center",
          cellPadding: 2,
        },
        bodyStyles: {
          fontSize: 7.2,
          textColor: [30, 41, 59],
          cellPadding: 1.8,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        footStyles: {
          fillColor: [236, 254, 255],
          textColor: [14, 116, 144],
          fontStyle: "bold",
          fontSize: 7.5,
          cellPadding: 2,
        },
        columnStyles: {
          0: { halign: "center", cellWidth: 10 },
          1: { halign: "left", cellWidth: 46 },
          2: { halign: "right", cellWidth: 26 },
          3: { halign: "right", cellWidth: 34 },
          4: { halign: "right", cellWidth: 36 },
          5: { halign: "center", cellWidth: 30 },
        },
        styles: {
          lineColor: [226, 232, 240],
          lineWidth: 0.15,
        },
      });

      // 12. Running Header (halaman 2 ke atas) & Footer Resmi di Semua Halaman
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);

        // Running Header di halaman 2+
        if (i > 1) {
          doc.setFontSize(7.5);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(100, 116, 139);
          doc.text(`Angkringan POS - Laporan Keuangan & Operasional (${rentangTeks})`, margin, 9);
          doc.text(`Halaman ${i}`, pageWidth - margin, 9, { align: "right" });
          doc.setDrawColor(226, 232, 240);
          doc.setLineWidth(0.3);
          doc.line(margin, 11, pageWidth - margin, 11);
        }

        // Footer resmi di semua halaman
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.line(margin, 287, pageWidth - margin, 287);

        doc.setFontSize(7.2);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(148, 163, 184);
        doc.text("Laporan Resmi • Dicetak otomatis melalui Sistem Angkringan POS", margin, 291.5);
        doc.text(`Halaman ${i} dari ${totalPages}`, pageWidth - margin, 291.5, { align: "right" });
      }

      const dateStr = format(new Date(), "dd-MM-yyyy_HH-mm");
      const fileName = `Laporan_Lengkap_Angkringan_${periodeFileTeks}_${dateStr}.pdf`;

      if (Capacitor.isNativePlatform()) {
        const result = await Filesystem.writeFile({
          path: `ANGKRINGAN 77/Laporan/${fileName}`,
          data: doc.output("datauristring").split(",")[1],
          directory: Directory.Documents,
          recursive: true,
        });

        toast.success(`Tersimpan di Laporan/${fileName}`, { id: tId });

        await LocalNotifications.schedule({
          notifications: [
            {
              title: `Laporan Lengkap ${rentangTeks} Siap`,
              body: "Klik untuk membuka rincian laporan",
              id: Math.floor(Math.random() * 10000),
              extra: { path: result.uri },
              sound: "default",
            },
          ],
        });
      } else {
        doc.save(fileName);
        toast.success(`Berhasil mengunduh ${fileName}`, { id: tId });
      }
    } catch (e) {
      console.error("Fatal PDF Error: ", e);
      toast.error("Gagal simpan PDF", { id: tId });
    }
  };

  return (
    <div className="p-4 space-y-4 pb-28">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-2">
        <div>
          <h1 className="text-xl font-bold">Ringkasan & Laporan</h1>
          <p className="text-xs text-muted-foreground">
            Analisis operasional dan laba rugi komprehensif
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="w-[140px] flex-1 sm:flex-none">
            <Select value={timeFilter} onValueChange={setTimeFilter}>
              <SelectTrigger className="h-10 rounded-xl border-2 text-xs font-bold focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="7d">7 Hari Terakhir</SelectItem>
                <SelectItem value="30d">30 Hari Terakhir</SelectItem>
                <SelectItem value="1y">1 Tahun Terakhir</SelectItem>
                <SelectItem value="all">Semua Waktu</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => setConfirmExportOpen(true)}
            className="h-10 px-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
          >
            <FileDown className="h-4 w-4" />
            <span>Cetak PDF</span>
          </Button>
        </div>
      </header>

      {/* Tab Navigasi Laporan Multi-Dimensi */}
      <Tabs value={activeReportTab} onValueChange={setActiveReportTab} className="w-full">
        <div className="overflow-x-auto no-scrollbar pb-1">
          <TabsList className="grid grid-cols-4 w-full h-12 rounded-xl bg-muted/60 p-1">
            <TabsTrigger
              value="keuangan"
              className="rounded-lg text-xs font-bold flex items-center justify-center gap-1 data-[state=active]:bg-card data-[state=active]:shadow-sm"
            >
              <Wallet className="h-3.5 w-3.5 text-green-600" />
              <span>Keuangan</span>
            </TabsTrigger>
            <TabsTrigger
              value="kulakan"
              className="rounded-lg text-xs font-bold flex items-center justify-center gap-1 data-[state=active]:bg-card data-[state=active]:shadow-sm"
            >
              <ShoppingBag className="h-3.5 w-3.5 text-blue-600" />
              <span>Kulakan</span>
            </TabsTrigger>
            <TabsTrigger
              value="konsinyasi"
              className="rounded-lg text-xs font-bold flex items-center justify-center gap-1 data-[state=active]:bg-card data-[state=active]:shadow-sm"
            >
              <Layers className="h-3.5 w-3.5 text-amber-500" />
              <span>Konsinyasi</span>
            </TabsTrigger>
            <TabsTrigger
              value="sesi"
              className="rounded-lg text-xs font-bold flex items-center justify-center gap-1 data-[state=active]:bg-card data-[state=active]:shadow-sm"
            >
              <Store className="h-3.5 w-3.5 text-primary" />
              <span>Sesi Kas</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* TAB 1: KEUANGAN & PENJUALAN */}
        <TabsContent value="keuangan" className="space-y-4 m-0 mt-3 outline-none">
          <div
            className={`border-2 rounded-2xl p-5 shadow-sm ${labaBersih >= 0 ? "bg-green-500/10 border-green-500/20" : "bg-destructive/10 border-destructive/20"}`}
          >
            <div
              className={`flex items-center justify-between mb-1 ${labaBersih >= 0 ? "text-green-600" : "text-destructive"}`}
            >
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  {labaBersih >= 0 ? "Laba Bersih Riil" : "Rugi Operasional"}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground font-semibold">
                (Omzet - Kulakan - Beban - Setoran)
              </span>
            </div>
            <div
              className={`text-4xl font-black ${labaBersih >= 0 ? "text-green-600" : "text-destructive"}`}
            >
              {formatRupiah(Math.abs(labaBersih))}
            </div>
          </div>

          {totalDiskon > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3 flex justify-between items-center">
              <div className="flex items-center gap-2 text-amber-600">
                <Tag className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Total Diskon Diberikan
                </span>
              </div>
              <div className="text-sm font-black text-amber-600">{formatRupiah(totalDiskon)}</div>
            </div>
          )}

          {inventory && inventory.length > 0 && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-3 flex justify-between items-center mt-3">
              <div className="flex items-center gap-2 text-blue-600">
                <Package className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Total Aset Gudang
                </span>
              </div>
              <div className="text-sm font-black text-blue-600">
                {formatRupiah(totalAsetGudang)}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-card border border-border rounded-2xl p-3.5 shadow-sm">
              <div className="flex items-center gap-1.5 text-green-600 mb-1.5">
                <ArrowUpCircle className="h-4 w-4" />
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  Omzet Penjualan
                </span>
              </div>
              <div className="text-base font-black text-foreground line-clamp-1">
                {formatRupiah(totalOmset)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {totalTransaksi} Transaksi
              </div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-3.5 shadow-sm">
              <div className="flex items-center gap-1.5 text-blue-600 mb-1.5">
                <ShoppingBag className="h-4 w-4" />
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  Kulakan Dagangan
                </span>
              </div>
              <div className="text-base font-black text-blue-600 line-clamp-1">
                {formatRupiah(totalKulakan)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Barang stok & cemilan</div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-3.5 shadow-sm">
              <div className="flex items-center gap-1.5 text-destructive mb-1.5">
                <ArrowDownCircle className="h-4 w-4" />
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  Beban Operasional
                </span>
              </div>
              <div className="text-base font-black text-destructive line-clamp-1">
                {formatRupiah(totalPengeluaran)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Es, arang, gas, listrik
              </div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-3.5 shadow-sm">
              <div className="flex items-center gap-1.5 text-purple-600 mb-1.5">
                <Layers className="h-4 w-4" />
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  Setoran Konsinyasi
                </span>
              </div>
              <div className="text-base font-black text-purple-600 line-clamp-1">
                {formatRupiah(totalSetoran)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Hak penitip terbayar</div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-sm font-bold">Grafik Arus Kas</h2>
              </div>
              <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md font-bold">
                {totalTransaksi} Nota
              </div>
            </div>
            {chartData.length > 0 ? (
              <div className="w-full h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis
                      dataKey="name"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={10}
                      stroke="#888888"
                    />
                    <YAxis hide />
                    <Tooltip
                      cursor={{ fill: "rgba(255, 255, 255, 0.05)" }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-background border border-border p-3 rounded-xl shadow-lg">
                              <p className="text-xs text-muted-foreground mb-2 pb-2 border-b border-border">
                                {payload[0].payload.name}
                              </p>
                              <div className="space-y-1">
                                <p className="text-xs font-bold text-primary flex justify-between gap-4">
                                  <span>Pemasukan:</span>{" "}
                                  <span>{formatRupiah(payload[0].payload.pemasukan)}</span>
                                </p>
                                <p className="text-xs font-bold text-destructive flex justify-between gap-4">
                                  <span>Pengeluaran:</span>{" "}
                                  <span>{formatRupiah(payload[0].payload.pengeluaran)}</span>
                                </p>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Legend
                      iconType="circle"
                      wrapperStyle={{ fontSize: "10px", paddingTop: "10px" }}
                    />
                    <Bar
                      name="Pemasukan"
                      dataKey="pemasukan"
                      fill="#eab308"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={30}
                    />
                    <Bar
                      name="Pengeluaran"
                      dataKey="pengeluaran"
                      fill="#ef4444"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={30}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="w-full h-[250px] flex flex-col items-center justify-center text-muted-foreground opacity-50">
                <TrendingUp className="h-12 w-12 mb-2" />
                <p className="text-sm font-medium">Belum ada data grafik</p>
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="h-5 w-5 text-yellow-500" />
              <h2 className="text-sm font-bold">5 Menu Terlaris</h2>
            </div>

            {topItems.length > 0 ? (
              <div className="space-y-3 divide-y divide-border">
                {topItems.map((item, index) => (
                  <div
                    key={index}
                    className={`flex justify-between items-center ${index !== 0 ? "pt-3" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-black">
                        {index + 1}
                      </div>
                      <span className="font-semibold text-sm">{item.name}</span>
                    </div>
                    <div className="text-xs font-black text-muted-foreground bg-muted px-2 py-1 rounded-md">
                      {item.qty} porsi
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground opacity-50">
                <Trophy className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">Belum ada data penjualan</p>
              </div>
            )}
          </div>

          <Button
            onClick={() => setConfirmExportOpen(true)}
            className="w-full h-14 rounded-2xl font-bold text-lg mt-2 shadow-sm"
          >
            <FileDown className="mr-2 h-5 w-5" /> Cetak Laporan PDF Rapi
          </Button>
        </TabsContent>

        {/* TAB 2: LAPORAN PEMBELIAN / KULAKAN */}
        <TabsContent value="kulakan" className="space-y-3 m-0 mt-3 outline-none">
          <div className="bg-card border-2 border-border rounded-2xl p-4 shadow-sm">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground">
                  Total Kulakan ({purchases?.length || 0} Faktur)
                </span>
                <div className="text-2xl font-black text-blue-600">
                  {formatRupiah(purchases?.reduce((s, p) => s + p.total_amount, 0) || 0)}
                </div>
              </div>
              <ShoppingBag className="h-8 w-8 text-blue-500 opacity-60" />
            </div>
          </div>

          <div className="space-y-2">
            {purchases?.map((p) => (
              <div
                key={p.id}
                className="bg-card border rounded-2xl p-3.5 shadow-sm flex items-center justify-between"
              >
                <div>
                  <div className="font-bold text-sm">
                    {p.supplier_name ? `Grosir: ${p.supplier_name}` : p.invoice_number}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {p.invoice_number} •{" "}
                    {format(p.purchase_date, "dd MMM yyyy", { locale: idLocale })} •{" "}
                    <span className="font-bold text-foreground">{p.payment_method}</span>
                  </div>
                </div>
                <div className="text-sm font-black text-blue-600">
                  {formatRupiah(p.total_amount)}
                </div>
              </div>
            ))}

            {purchases?.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-xs opacity-60">
                Belum ada data kulakan barang dagangan.
              </div>
            )}
          </div>
        </TabsContent>

        {/* TAB 3: LAPORAN KONSINYASI */}
        <TabsContent value="konsinyasi" className="space-y-3 m-0 mt-3 outline-none">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-card border-2 border-border rounded-2xl p-3.5 shadow-sm">
              <span className="text-[10px] uppercase font-bold text-muted-foreground">
                Total Hak Setor
              </span>
              <div className="text-xl font-black text-amber-600">
                {formatRupiah(consignmentBatches?.reduce((s, b) => s + b.total_payout_due, 0) || 0)}
              </div>
            </div>
            <div className="bg-card border-2 border-border rounded-2xl p-3.5 shadow-sm">
              <span className="text-[10px] uppercase font-bold text-muted-foreground">
                Total Sudah Disetor
              </span>
              <div className="text-xl font-black text-green-600">
                {formatRupiah(consignmentBatches?.reduce((s, b) => s + b.total_paid, 0) || 0)}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {consignmentBatches?.map((b) => {
              const c = consignors?.find((cn) => cn.id === b.consignor_id);
              const it = consignmentItems?.find((itm) => itm.batch_id === b.id);

              return (
                <div key={b.id} className="bg-card border rounded-2xl p-3.5 shadow-sm space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-sm">
                      {it?.item_name || "Barang Titip"} ({c?.name || "Penitip"})
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${b.payment_status === "paid" ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive"}`}
                    >
                      {b.payment_status === "paid" ? "Lunas" : "Belum Lunas"}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      Terjual: {it?.qty_sold || 0} (Retur: {it?.qty_returned || 0})
                    </span>
                    <span>
                      Hak Setor:{" "}
                      <strong className="text-foreground">
                        {formatRupiah(b.total_payout_due)}
                      </strong>
                    </span>
                  </div>
                </div>
              );
            })}

            {consignmentBatches?.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-xs opacity-60">
                Belum ada data barang konsinyasi tercatat.
              </div>
            )}
          </div>
        </TabsContent>

        {/* TAB 4: LAPORAN PENUTUPAN KAS HARIAN */}
        <TabsContent value="sesi" className="space-y-3 m-0 mt-3 outline-none">
          <div className="space-y-2">
            {closedSessions?.map((cs) => (
              <div key={cs.id} className="bg-card border rounded-2xl p-4 shadow-sm space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-bold text-sm">{cs.session_date}</span>
                    <span className="text-[10px] text-muted-foreground block">
                      Tutup:{" "}
                      {cs.closed_at
                        ? format(cs.closed_at, "HH:mm, dd MMM yyyy", { locale: idLocale })
                        : "-"}
                    </span>
                  </div>
                  <div
                    className={`px-2.5 py-1 rounded-xl font-bold text-xs ${
                      (cs.cash_difference || 0) === 0
                        ? "bg-green-500/10 text-green-700 border border-green-500/20"
                        : (cs.cash_difference || 0) > 0
                          ? "bg-blue-500/10 text-blue-700 border border-blue-500/20"
                          : "bg-destructive/10 text-destructive border border-destructive/20"
                    }`}
                  >
                    {(cs.cash_difference || 0) === 0
                      ? "Kas Pas (Rp 0)"
                      : `Selisih: ${formatRupiah(cs.cash_difference || 0)}`}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-muted/40 p-2.5 rounded-xl border">
                  <div>
                    Modal Awal:{" "}
                    <strong className="block text-foreground">
                      {formatRupiah(cs.initial_cash)}
                    </strong>
                  </div>
                  <div>
                    Penjualan Tunai:{" "}
                    <strong className="block text-green-600">
                      +{formatRupiah(cs.total_cash_sales)}
                    </strong>
                  </div>
                  <div>
                    Kas Seharusnya:{" "}
                    <strong className="block text-primary">{formatRupiah(cs.expected_cash)}</strong>
                  </div>
                  <div>
                    Uang Fisik Aktual:{" "}
                    <strong className="block text-foreground">
                      {formatRupiah(cs.actual_cash || 0)}
                    </strong>
                  </div>
                </div>
              </div>
            ))}

            {closedSessions?.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-xs opacity-60">
                Belum ada data riwayat penutupan kasir harian.
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={confirmExportOpen} onOpenChange={setConfirmExportOpen}>
        <DialogContent
          className="rounded-3xl max-w-[85vw] sm:max-w-[400px]"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-xl">Konfirmasi Cetak</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-muted-foreground text-sm leading-relaxed">
              Apakah Anda yakin ingin mencetak laporan PDF untuk periode{" "}
              <strong className="text-foreground">{rentangTeks}</strong>?
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <Button
              variant="outline"
              className="h-12 rounded-xl font-bold"
              onClick={() => setConfirmExportOpen(false)}
            >
              Batal
            </Button>
            <Button className="h-12 rounded-xl font-bold" onClick={exportPDF}>
              Ya, Cetak
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
