import { google } from "googleapis";
import { Readable } from "stream";
import dotenv from "dotenv";

dotenv.config();

/**
 * Inisialisasi Google Drive API Client menggunakan Service Account / Environment Variables
 */
function getDriveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error(
      "Kredensial Google Service Account belum dikonfigurasi di file .env server.",
    );
  }

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  return google.drive({ version: "v3", auth });
}

export interface GDriveUploadResult {
  success: boolean;
  fileId?: string;
  fileName: string;
  webContentLink?: string;
  error?: string;
}

/**
 * Upload file arsip backup JSON ke folder Google Drive
 */
export async function uploadBackupToGDrive(
  fileName: string,
  jsonContent: string,
): Promise<GDriveUploadResult> {
  try {
    const drive = getDriveClient();
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    const fileStream = new Readable();
    fileStream.push(jsonContent);
    fileStream.push(null);

    const fileMetadata: Record<string, any> = {
      name: fileName,
      mimeType: "application/json",
    };

    if (folderId) {
      fileMetadata.parents = [folderId];
    }

    const media = {
      mimeType: "application/json",
      body: fileStream,
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: "id, name, webViewLink, webContentLink",
    });

    return {
      success: true,
      fileId: response.data.id || undefined,
      fileName,
      webContentLink: response.data.webContentLink || undefined,
    };
  } catch (err: any) {
    console.error("[GDrive Service] Error upload:", err.message);
    return {
      success: false,
      fileName,
      error: err.message,
    };
  }
}

/**
 * Cek status koneksi Google Drive
 */
export async function testGDriveConnection(): Promise<boolean> {
  try {
    const drive = getDriveClient();
    await drive.about.get({ fields: "user" });
    return true;
  } catch (err) {
    console.warn("[GDrive Service] Status: Tidak terhubung atau kredensial kosong.");
    return false;
  }
}
