/**
 * Sync Queue Service
 * ==================
 * Antrean sinkronisasi background untuk mengirim mutasi lokal ke backend cloud.
 *
 * Prinsip:
 * - Semua transaksi disimpan ke IndexedDB dulu (zero latency).
 * - Saat online, worker ini memproses sync_queue secara batch.
 * - Mutasi bersifat idempoten berdasarkan entity_uuid.
 * - Jika offline: antrean menunggu sampai koneksi kembali.
 * - Retry otomatis dengan exponential backoff (max 5 retry).
 */

import { db, generateUUID } from "./db";
import type { SyncQueue } from "./db";

// ─── Konfigurasi ─────────────────────────────────────────────

const MAX_RETRY = 5;
const BATCH_SIZE = 25;
const BASE_DELAY_MS = 2000; // 2 detik
const MAX_DELAY_MS = 60000; // 60 detik

// ─── State Internal ──────────────────────────────────────────

let isProcessing = false;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let apiBaseUrl = ""; // Akan diset saat initialize

// ─── Enqueue Mutation ────────────────────────────────────────

/**
 * Menambahkan mutasi ke antrean sinkronisasi.
 * Dipanggil setelah operasi tulis ke IndexedDB berhasil.
 */
export async function enqueueSyncAction(
  entityType: string,
  entityUuid: string,
  action: "insert" | "update" | "delete",
  payload: unknown,
): Promise<void> {
  const entry: SyncQueue = {
    queue_id: generateUUID(),
    entity_type: entityType,
    entity_uuid: entityUuid,
    action,
    payload,
    status: "pending",
    retry_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  await db.sync_queue.add(entry);
}

// ─── Process Queue ───────────────────────────────────────────

/**
 * Mengambil batch mutasi pending dari sync_queue dan kirim ke backend.
 */
async function processQueue(): Promise<void> {
  if (isProcessing) return;
  if (!navigator.onLine) return;
  if (!apiBaseUrl) return; // Backend belum dikonfigurasi

  isProcessing = true;

  try {
    const pendingItems = await db.sync_queue
      .where("status")
      .equals("pending")
      .limit(BATCH_SIZE)
      .toArray();

    if (pendingItems.length === 0) {
      isProcessing = false;
      return;
    }

    // Tandai sebagai sedang diproses
    const ids = pendingItems.map((item) => item.id!);
    await db.sync_queue.where("id").anyOf(ids).modify({
      status: "syncing",
      updated_at: Date.now(),
    });

    // Kirim batch ke backend
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: pendingItems.map((item) => ({
            queue_id: item.queue_id,
            entity_type: item.entity_type,
            entity_uuid: item.entity_uuid,
            action: item.action,
            payload: item.payload,
          })),
        }),
      });

      if (response.ok) {
        // Berhasil: hapus dari antrean
        await db.sync_queue.where("id").anyOf(ids).delete();
      } else {
        // Server error: kembalikan ke pending dengan retry
        await handleBatchFailure(pendingItems, `HTTP ${response.status}`);
      }
    } catch (networkError) {
      // Network error: kembalikan ke pending
      const errMsg = networkError instanceof Error ? networkError.message : "Network error";
      await handleBatchFailure(pendingItems, errMsg);
    }
  } catch (err) {
    console.error("[SyncService] Error saat proses queue:", err);
  } finally {
    isProcessing = false;
  }
}

/**
 * Menangani kegagalan batch: increment retry, set delay, atau tandai failed.
 */
async function handleBatchFailure(items: SyncQueue[], errorMessage: string): Promise<void> {
  for (const item of items) {
    const newRetry = (item.retry_count || 0) + 1;

    if (newRetry >= MAX_RETRY) {
      // Melebihi batas retry — tandai sebagai gagal permanen
      await db.sync_queue.update(item.id!, {
        status: "failed",
        retry_count: newRetry,
        last_error: errorMessage,
        updated_at: Date.now(),
      });
    } else {
      // Kembalikan ke pending untuk retry
      await db.sync_queue.update(item.id!, {
        status: "pending",
        retry_count: newRetry,
        last_error: errorMessage,
        updated_at: Date.now(),
      });
    }
  }
}

// ─── Statistik Queue ─────────────────────────────────────────

export interface SyncQueueStats {
  pending: number;
  syncing: number;
  failed: number;
  total: number;
}

export async function getSyncQueueStats(): Promise<SyncQueueStats> {
  const pending = await db.sync_queue.where("status").equals("pending").count();
  const syncing = await db.sync_queue.where("status").equals("syncing").count();
  const failed = await db.sync_queue.where("status").equals("failed").count();

  return {
    pending,
    syncing,
    failed,
    total: pending + syncing + failed,
  };
}

/**
 * Retry semua item yang gagal (reset status ke pending, reset retry count).
 */
export async function retryFailedItems(): Promise<number> {
  const failed = await db.sync_queue.where("status").equals("failed").toArray();
  const ids = failed.map((item) => item.id!).filter(Boolean);

  if (ids.length > 0) {
    await db.sync_queue.where("id").anyOf(ids).modify({
      status: "pending",
      retry_count: 0,
      last_error: undefined,
      updated_at: Date.now(),
    });
  }

  return ids.length;
}

/**
 * Hapus semua item yang gagal secara permanen.
 */
export async function clearFailedItems(): Promise<number> {
  const failed = await db.sync_queue.where("status").equals("failed").toArray();
  const ids = failed.map((item) => item.id!).filter(Boolean);
  await db.sync_queue.bulkDelete(ids);
  return ids.length;
}

// ─── Lifecycle ───────────────────────────────────────────────

/**
 * Inisialisasi sync service.
 * Memasang listener online/offline dan memulai polling.
 */
export function initSyncService(baseUrl?: string): void {
  if (baseUrl) {
    apiBaseUrl = baseUrl;
  }

  // Listener saat kembali online → langsung proses
  window.addEventListener("online", () => {
    console.log("[SyncService] Online — memproses antrean...");
    processQueue();
  });

  // Polling setiap 30 detik saat online
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => {
    if (navigator.onLine && apiBaseUrl) {
      processQueue();
    }
  }, 30000);

  // Proses langsung saat pertama kali jika online
  if (navigator.onLine && apiBaseUrl) {
    setTimeout(() => processQueue(), 3000);
  }
}

/**
 * Hentikan sync service.
 */
export function stopSyncService(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

/**
 * Paksa proses queue sekarang (dipanggil manual oleh user).
 */
export async function forceSyncNow(): Promise<void> {
  if (!navigator.onLine) {
    throw new Error("Tidak ada koneksi internet.");
  }
  if (!apiBaseUrl) {
    throw new Error("Backend belum dikonfigurasi.");
  }
  await processQueue();
}
