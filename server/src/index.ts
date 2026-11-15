import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { testConnection, upsertEntity } from "./db.js";
import { uploadBackupToGDrive, testGDriveConnection } from "./gdrive.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

// Middleware
app.use(
  cors({
    origin: [CLIENT_ORIGIN, "http://localhost:5173", "capacitor://localhost"],
    credentials: true,
  }),
);
app.use(express.json({ limit: "50mb" }));

// 1. Health & Status Check
app.get("/api/v1/health", async (_req: Request, res: Response) => {
  const dbOk = await testConnection();
  const gdriveOk = await testGDriveConnection();

  res.json({
    status: "ok",
    app: "Angkringan POS Cloud Service",
    version: "1.0.0",
    timestamp: Date.now(),
    services: {
      postgresql: dbOk ? "connected" : "disconnected",
      google_drive: gdriveOk ? "configured" : "unconfigured",
    },
  });
});

// 2. Batch Sync Endpoint (Menerima mutasi dari IndexedDB sync_queue)
app.post("/api/v1/sync", async (req: Request, res: Response): Promise<void> => {
  const { mutations } = req.body;

  if (!Array.isArray(mutations)) {
    res.status(400).json({ error: "Payload harus memiliki properti 'mutations' berupa array." });
    return;
  }

  const results: Array<{ queue_id: string; success: boolean; error?: string }> = [];

  for (const m of mutations) {
    try {
      await upsertEntity(m.entity_type, m.entity_uuid, m.action, m.payload);
      results.push({ queue_id: m.queue_id, success: true });
    } catch (err: any) {
      console.error(`[Sync] Gagal memproses mutasi ${m.queue_id}:`, err.message);
      results.push({ queue_id: m.queue_id, success: false, error: err.message });
    }
  }

  const allSuccess = results.every((r) => r.success);
  if (allSuccess) {
    res.json({ success: true, processed: results.length, details: results });
  } else {
    res.status(207).json({ success: false, processed: results.length, details: results });
  }
});

// 3. Google Drive Cloud Archive Upload
app.post("/api/v1/backup/gdrive", async (req: Request, res: Response): Promise<void> => {
  const { fileName, jsonContent, checksum } = req.body;

  if (!fileName || !jsonContent) {
    res.status(400).json({ error: "fileName dan jsonContent wajib diisi." });
    return;
  }

  const result = await uploadBackupToGDrive(fileName, jsonContent);

  if (result.success) {
    res.json({
      success: true,
      message: "Arsip backup berhasil disimpan ke Google Drive.",
      fileId: result.fileId,
      fileName: result.fileName,
      checksum,
    });
  } else {
    res.status(502).json({
      success: false,
      error: `Gagal upload ke Google Drive: ${result.error}`,
    });
  }
});

// 4. Status Google Drive
app.get("/api/v1/backup/gdrive/status", async (_req: Request, res: Response) => {
  const connected = await testGDriveConnection();
  res.json({
    connected,
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID ? "configured" : "not_set",
  });
});

app.listen(PORT, () => {
  console.log(`[Angkringan POS Server] Berjalan pada port ${PORT}`);
  console.log(`[Angkringan POS Server] Client origin: ${CLIENT_ORIGIN}`);
});
