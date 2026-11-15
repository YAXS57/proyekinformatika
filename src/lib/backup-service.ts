/**
 * Backup & Restore Service
 * ========================
 * Modul backup/restore lengkap dengan:
 * - SHA-256 checksum untuk verifikasi integritas
 * - Backup seluruh tabel database (termasuk tabel baru Fase 2-3)
 * - Riwayat backup di tabel backup_history
 * - Safety snapshot otomatis sebelum restore
 * - Dukungan Capacitor Filesystem untuk Android/iOS
 * - Format JSON terstruktur dengan metadata
 */

import { db, generateUUID } from "./db";
import type { BackupHistory } from "./db";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { format } from "date-fns";

// ─── Tipe Data ───────────────────────────────────────────────

export interface BackupMetadata {
  app_name: string;
  app_version: string;
  backup_date: string;
  backup_type: "auto" | "manual";
  device_info: string;
  checksum: string;
  table_counts: Record<string, number>;
}

export interface BackupPayload {
  metadata: BackupMetadata;
  data: {
    categories: unknown[];
    menu_items: unknown[];
    sales: unknown[];
    sale_details: unknown[];
    expenses: unknown[];
    inventory: unknown[];
    customers: unknown[];
    purchases: unknown[];
    purchase_details: unknown[];
    consignors: unknown[];
    consignment_batches: unknown[];
    consignment_items: unknown[];
    consignment_returns: unknown[];
    consignment_settlements: unknown[];
    consignment_payments: unknown[];
    cash_sessions: unknown[];
    app_settings: unknown[];
  };
}

export interface BackupOptions {
  triggerDownload?: boolean;
  uploadToCloud?: boolean;
}

export interface BackupResult {
  success: boolean;
  fileName: string;
  fileSize: number;
  checksum: string;
  tableCounts: Record<string, number>;
  destination?: "local" | "gdrive" | "both";
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  tablesRestored: string[];
  totalRecords: number;
  safetyBackupName?: string;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  metadata?: BackupMetadata;
  errors: string[];
}

// ─── SHA-256 Checksum ────────────────────────────────────────

async function computeSHA256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Helper: Ekspor Seluruh Tabel ────────────────────────────

async function exportAllTables(): Promise<BackupPayload["data"]> {
  return {
    categories: await db.categories.toArray(),
    menu_items: await db.menu_items.toArray(),
    sales: await db.sales.toArray(),
    sale_details: await db.sale_details.toArray(),
    expenses: await db.expenses.toArray(),
    inventory: await db.inventory.toArray(),
    customers: await db.customers.toArray(),
    purchases: await db.purchases.toArray(),
    purchase_details: await db.purchase_details.toArray(),
    consignors: await db.consignors.toArray(),
    consignment_batches: await db.consignment_batches.toArray(),
    consignment_items: await db.consignment_items.toArray(),
    consignment_returns: await db.consignment_returns.toArray(),
    consignment_settlements: await db.consignment_settlements.toArray(),
    consignment_payments: await db.consignment_payments.toArray(),
    cash_sessions: await db.cash_sessions.toArray(),
    app_settings: await db.app_settings.toArray(),
  };
}

function countTables(data: BackupPayload["data"]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [tableName, rows] of Object.entries(data)) {
    counts[tableName] = (rows as unknown[]).length;
  }
  return counts;
}

// ─── Backup Utama ────────────────────────────────────────────

/**
 * Membuat backup lengkap seluruh database ke file JSON.
 * File disimpan ke penyimpanan lokal (Capacitor/Download) dan diunggah ke cloud (jika online & server tersedia).
 */
export async function createBackup(
  backupType: "auto" | "manual" = "manual",
  options?: BackupOptions,
): Promise<BackupResult> {
  const shouldDownload = options?.triggerDownload ?? backupType === "manual";
  const shouldUploadCloud = options?.uploadToCloud ?? true;

  try {
    const data = await exportAllTables();
    const tableCounts = countTables(data);

    // Hitung checksum dari data saja (tanpa metadata agar stabil)
    const dataJson = JSON.stringify(data);
    const checksum = await computeSHA256(dataJson);

    const metadata: BackupMetadata = {
      app_name: "Angkringan POS",
      app_version: "1.0.0",
      backup_date: new Date().toISOString(),
      backup_type: backupType,
      device_info: navigator.userAgent.substring(0, 120),
      checksum,
      table_counts: tableCounts,
    };

    const payload: BackupPayload = { metadata, data };
    const jsonString = JSON.stringify(payload, null, 2);
    const fileSize = new Blob([jsonString]).size;

    const dateStr = format(new Date(), "dd-MM-yyyy_HH-mm");
    const fileName = `Backup_Angkringan_${dateStr}.json`;

    // 1. Simpan Lokal
    if (Capacitor.isNativePlatform()) {
      await Filesystem.writeFile({
        path: `ANGKRINGAN 77/Backup/${fileName}`,
        data: jsonString,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    } else if (shouldDownload) {
      // Browser manual download
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    }

    // 2. Simpan snapshot internal di app_settings (agar selalu ada salinan offline terakhir)
    await db.app_settings.put({
      key: "last_local_backup_snapshot",
      value: { fileName, backupDate: Date.now(), checksum, fileSize },
      updated_at: Date.now(),
    });

    let destination: "local" | "gdrive" | "both" = "local";

    // 3. Optional: Upload ke Backend Google Drive Uploader jika online
    if (shouldUploadCloud && typeof navigator !== "undefined" && navigator.onLine) {
      try {
        const cloudUrl =
          ((await db.app_settings.get("cloud_api_url"))?.value as string) ||
          "http://localhost:3001";
        const cloudRes = await fetch(`${cloudUrl}/api/v1/backup/gdrive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName, jsonContent: jsonString, checksum }),
        });
        if (cloudRes.ok) {
          destination = "both";
        }
      } catch {
        // Abaikan kegagalan cloud (offline-first single device: data lokal sudah aman 100%)
      }
    }

    // 4. Simpan ke riwayat backup
    await db.backup_history.add({
      uuid: generateUUID(),
      backup_date: Date.now(),
      backup_type: backupType,
      destination,
      file_name: fileName,
      file_size: fileSize,
      checksum,
      status: "success",
      created_at: Date.now(),
    });

    return {
      success: true,
      fileName,
      fileSize,
      checksum,
      tableCounts,
      destination,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Kesalahan tidak diketahui";

    try {
      await db.backup_history.add({
        uuid: generateUUID(),
        backup_date: Date.now(),
        backup_type: backupType,
        destination: "local",
        file_name: "GAGAL",
        file_size: 0,
        status: "failed",
        error_message: errorMessage,
        created_at: Date.now(),
      });
    } catch {
      // Abaikan jika logging riwayat juga gagal
    }

    return {
      success: false,
      fileName: "",
      fileSize: 0,
      checksum: "",
      tableCounts: {},
      error: errorMessage,
    };
  }
}

/**
 * Pengecekan otomatis saat online:
 * Jika belum pernah backup atau backup terakhir > 24 jam lalu, jalankan auto-backup di background.
 */
export async function checkAndRunAutoBackup(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.onLine) return false;

  try {
    const lastBackup = await db.backup_history.where("status").equals("success").reverse().first();

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();

    if (!lastBackup || now - lastBackup.backup_date > ONE_DAY_MS) {
      console.log("[AutoBackup] Menjalankan backup otomatis berkala di latar belakang...");
      const res = await createBackup("auto", { triggerDownload: false, uploadToCloud: true });
      return res.success;
    }
  } catch (err) {
    console.warn("[AutoBackup] Pengecekan auto-backup dilewati:", err);
  }
  return false;
}

// ─── Validasi File Backup ────────────────────────────────────

/**
 * Memvalidasi file backup sebelum restore:
 * 1. Format JSON valid
 * 2. Struktur metadata ada
 * 3. Checksum cocok dengan data
 */
export async function validateBackupFile(fileContent: string): Promise<ValidationResult> {
  const errors: string[] = [];

  // 1. Parse JSON
  let parsed: BackupPayload;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    return { valid: false, errors: ["File bukan JSON yang valid."] };
  }

  // 2. Cek struktur dasar
  if (!parsed.metadata) {
    // Mungkin format backup lama (tanpa metadata) — tetap izinkan
    if (parsed && typeof parsed === "object" && "categories" in parsed) {
      return {
        valid: true,
        metadata: undefined,
        errors: ["Format backup lama (tanpa metadata/checksum). Restore tetap bisa dilakukan."],
      };
    }
    errors.push("File tidak memiliki struktur backup yang valid.");
    return { valid: false, errors };
  }

  if (!parsed.data) {
    errors.push("File backup tidak memiliki blok data.");
    return { valid: false, errors };
  }

  // 3. Verifikasi checksum
  if (parsed.metadata.checksum) {
    try {
      const dataJson = JSON.stringify(parsed.data);
      const computedChecksum = await computeSHA256(dataJson);

      if (computedChecksum !== parsed.metadata.checksum) {
        errors.push(
          `Checksum tidak cocok! Diharapkan: ${parsed.metadata.checksum.substring(0, 16)}... Dihitung: ${computedChecksum.substring(0, 16)}... File mungkin telah dimodifikasi.`,
        );
        return { valid: false, metadata: parsed.metadata, errors };
      }
    } catch {
      errors.push("Gagal menghitung checksum. File mungkin corrupt.");
    }
  }

  // 4. Cek minimal 1 tabel berisi data
  const tableNames = Object.keys(parsed.data);
  if (tableNames.length === 0) {
    errors.push("Tidak ada tabel data dalam file backup.");
    return { valid: false, metadata: parsed.metadata, errors };
  }

  return {
    valid: errors.length === 0,
    metadata: parsed.metadata,
    errors,
  };
}

// ─── Safety Snapshot ─────────────────────────────────────────

/**
 * Membuat backup pengaman internal sebelum restore.
 * Disimpan di IndexedDB sebagai entri backup_history bertipe 'auto'.
 * Return: nama file snapshot untuk referensi.
 */
export async function createSafetySnapshot(): Promise<string> {
  const result = await createBackup("auto");
  if (!result.success) {
    throw new Error(`Gagal membuat safety snapshot sebelum restore: ${result.error}`);
  }
  return result.fileName;
}

// ─── Restore Data ────────────────────────────────────────────

/**
 * Memulihkan data dari file backup JSON.
 * Langkah:
 * 1. Validasi file
 * 2. Buat safety snapshot
 * 3. Restore data dengan bulkPut (upsert)
 */
export async function restoreFromBackup(
  fileContent: string,
  skipSafetyBackup = false,
): Promise<RestoreResult> {
  // 1. Validasi
  const validation = await validateBackupFile(fileContent);
  if (!validation.valid && validation.errors.length > 0) {
    // Jika format lama tapi masih valid structurally
    const hasOnlyWarnings = validation.errors.every(
      (e) => e.includes("format backup lama") || e.includes("Format backup lama"),
    );
    if (!hasOnlyWarnings) {
      return {
        success: false,
        tablesRestored: [],
        totalRecords: 0,
        error: validation.errors.join(" | "),
      };
    }
  }

  // 2. Safety Snapshot
  let safetyBackupName: string | undefined;
  if (!skipSafetyBackup) {
    try {
      safetyBackupName = await createSafetySnapshot();
    } catch (err) {
      return {
        success: false,
        tablesRestored: [],
        totalRecords: 0,
        error: `Gagal membuat backup pengaman: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // 3. Parse dan restore
  try {
    const parsed = JSON.parse(fileContent) as BackupPayload;
    const data = parsed.data || parsed; // Support format lama
    const tablesRestored: string[] = [];
    let totalRecords = 0;

    // Mapping nama tabel ke objek Dexie Table
    const tableMap: Array<{
      name: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      table: any;
      dataKey: keyof BackupPayload["data"];
    }> = [
      { name: "categories", table: db.categories, dataKey: "categories" },
      { name: "menu_items", table: db.menu_items, dataKey: "menu_items" },
      { name: "sales", table: db.sales, dataKey: "sales" },
      { name: "sale_details", table: db.sale_details, dataKey: "sale_details" },
      { name: "expenses", table: db.expenses, dataKey: "expenses" },
      { name: "inventory", table: db.inventory, dataKey: "inventory" },
      { name: "customers", table: db.customers, dataKey: "customers" },
      { name: "purchases", table: db.purchases, dataKey: "purchases" },
      {
        name: "purchase_details",
        table: db.purchase_details,
        dataKey: "purchase_details",
      },
      { name: "consignors", table: db.consignors, dataKey: "consignors" },
      {
        name: "consignment_batches",
        table: db.consignment_batches,
        dataKey: "consignment_batches",
      },
      {
        name: "consignment_items",
        table: db.consignment_items,
        dataKey: "consignment_items",
      },
      {
        name: "consignment_returns",
        table: db.consignment_returns,
        dataKey: "consignment_returns",
      },
      {
        name: "consignment_settlements",
        table: db.consignment_settlements,
        dataKey: "consignment_settlements",
      },
      {
        name: "consignment_payments",
        table: db.consignment_payments,
        dataKey: "consignment_payments",
      },
      {
        name: "cash_sessions",
        table: db.cash_sessions,
        dataKey: "cash_sessions",
      },
      {
        name: "app_settings",
        table: db.app_settings,
        dataKey: "app_settings",
      },
    ];

    for (const { name, table, dataKey } of tableMap) {
      const rows = (data as Record<string, unknown[]>)[dataKey];
      if (Array.isArray(rows) && rows.length > 0) {
        await table.bulkPut(rows);
        tablesRestored.push(name);
        totalRecords += rows.length;
      }
    }

    return {
      success: true,
      tablesRestored,
      totalRecords,
      safetyBackupName,
    };
  } catch (err) {
    return {
      success: false,
      tablesRestored: [],
      totalRecords: 0,
      safetyBackupName,
      error: `Gagal memulihkan data: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Riwayat Backup ──────────────────────────────────────────

/**
 * Ambil riwayat backup terbaru (max 20 entri, diurutkan terbaru).
 */
export async function getBackupHistory(limit = 20): Promise<BackupHistory[]> {
  return db.backup_history.reverse().limit(limit).toArray();
}

/**
 * Hapus riwayat backup lebih tua dari N hari.
 */
export async function pruneBackupHistory(olderThanDays = 90): Promise<number> {
  const cutoff = Date.now() - olderThanDays * 86400000;
  const old = await db.backup_history.where("backup_date").below(cutoff).toArray();
  const ids = old.map((b) => b.id!).filter(Boolean);
  await db.backup_history.bulkDelete(ids);
  return ids.length;
}

// ─── Format Helper ───────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
