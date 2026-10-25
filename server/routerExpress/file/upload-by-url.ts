import express from 'express';
import path from 'path';
import dns from 'dns/promises';
import { FileService } from '../../lib/files';
import { getTokenFromRequest } from '../../lib/helper';
import cors from 'cors';

const router = express.Router();

// SSRF guard: reject URLs that resolve to loopback/private/link-local/metadata ranges.
function isPrivateIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7));
  if (lower.includes(':')) {
    // IPv6
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('fe80')) return true; // link-local
    return false;
  }
  const p = lower.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // not a clean IPv4 → treat as unsafe
  const [a, b] = p;
  if (a === 0 || a === 127) return true; // this-host / loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT incl. Aliyun metadata 100.100.100.200
  if (a >= 224) return true; // multicast / reserved
  return false;
}

async function assertSafeUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed');
  }
  const results = await dns.lookup(u.hostname, { all: true });
  if (results.length === 0 || results.some((r) => isPrivateIp(r.address))) {
    throw new Error('URL resolves to a disallowed address');
  }
}

router.options('/', cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: '*',
  maxAge: 86400
}));

/**
 * @swagger
 * /api/file/upload-by-url:
 *   post:
 *     tags: 
 *       - File
 *     summary: Upload File by URL
 *     operationId: uploadFileByUrl
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *                 description: URL of the file to upload
 *             required:
 *               - url
 *     responses:
 *       200:
 *         description: Upload Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 Message:
 *                   type: string
 *                 status:
 *                   type: number
 *                 path:
 *                   type: string
 *                 type:
 *                   type: string
 *                 size:
 *                   type: number
 *                 originalURL:
 *                   type: string
 *       400:
 *         description: Bad Request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Server Error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *     security:
 *       - bearer: []
 */
router.post('/', async (req, res) => {
  try {
    const token = await getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (process.env.IS_DEMO) {
      return res.status(401).json({ error: "In Demo App" });
    }

    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "No URL provided" });
    }

    try {
      await assertSafeUrl(url);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Invalid URL" });
    }

    const response = await fetch(url, { redirect: 'error' });
    if (!response.ok) {
      return res.status(400).json({ error: "Failed to fetch file from URL" });
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    const urlPath = new URL(url).pathname;
    const originalName = path.basename(urlPath).replace(/\s+/g, "_");
    const filePath = await FileService.uploadFile({
      buffer,
      originalName,
      type: response.headers.get("content-type") || "",
      accountId: Number(token.id)
    });

    res.set({
      'Access-Control-Allow-Origin': req.headers.origin || '',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Credentials': 'true'
    });

    return res.status(200).json({
      Message: "Success",
      status: 200,
      ...filePath,
      originalURL: url,
      type: response.headers.get("content-type") || "",
      size: buffer.length
    });
  } catch (error) {
    console.error("Error uploading file from URL:", error);
    return res.status(500).json({ error: "Failed to upload file from URL" });
  }
});

export default router;
