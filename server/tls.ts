import fs from "fs";
import path from "path";
import selfsigned from "selfsigned";
import { PATHS, getLanIp } from "./config.js";
import { log } from "./logger.js";

const META_FILE = path.join(PATHS.data, "tls-meta.json");
const KEY_FILE = path.join(PATHS.data, "tls-key.pem");
const CERT_FILE = path.join(PATHS.data, "tls-cert.pem");

interface TlsMeta {
  lanIp: string;
  createdAt: number;
}

function readMeta(): TlsMeta | null {
  if (!fs.existsSync(META_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(META_FILE, "utf-8")) as TlsMeta;
  } catch {
    return null;
  }
}

function writeMeta(lanIp: string): void {
  fs.writeFileSync(META_FILE, JSON.stringify({ lanIp, createdAt: Date.now() }, null, 2));
}

async function generateCert(lanIp: string): Promise<{ key: Buffer; cert: Buffer }> {
  const altNames: Array<{ type: 2; value: string } | { type: 7; ip: string }> = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
  ];

  if (lanIp !== "127.0.0.1") {
    altNames.push({ type: 7, ip: lanIp });
  }

  const notAfterDate = new Date();
  notAfterDate.setDate(notAfterDate.getDate() + 825);

  const pems = await selfsigned.generate([{ name: "commonName", value: "Music Box" }], {
    notAfterDate,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      {
        name: "subjectAltName",
        altNames,
      },
    ],
  });

  fs.writeFileSync(KEY_FILE, pems.private);
  fs.writeFileSync(CERT_FILE, pems.cert);
  writeMeta(lanIp);

  return {
    key: Buffer.from(pems.private),
    cert: Buffer.from(pems.cert),
  };
}

export async function ensureTlsCert(): Promise<{ key: Buffer; cert: Buffer }> {
  const lanIp = getLanIp();
  const meta = readMeta();
  const filesExist = fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE);

  if (filesExist && meta?.lanIp === lanIp) {
    return {
      key: fs.readFileSync(KEY_FILE),
      cert: fs.readFileSync(CERT_FILE),
    };
  }

  if (filesExist && meta && meta.lanIp !== lanIp) {
    log.info(`[tls] LAN IP changed (${meta.lanIp} -> ${lanIp}), regenerating certificate...`);
  } else if (!filesExist) {
    log.info("[tls] Generating local HTTPS certificate...");
  }

  return generateCert(lanIp);
}

export function getPublicUrl(port: number): string {
  return `https://${getLanIp()}:${port}`;
}
