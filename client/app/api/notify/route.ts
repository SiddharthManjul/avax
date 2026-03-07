import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

/**
 * Encrypted Notification Relay
 *
 * Simple JSON-file-backed KV store for encrypted transfer notifications.
 * Each notification is keyed by a recipient tag (poseidon hash of their pubkey)
 * and contains an opaque encrypted payload that only the recipient can decrypt.
 *
 * The relay cannot read the payloads or link tags to wallet addresses.
 *
 * Storage format:
 *   { [tag: string]: Array<{ payload: string, timestamp: number, id: string }> }
 */

const DATA_DIR = join(process.cwd(), ".data");
const NOTIFICATIONS_FILE = join(DATA_DIR, "notifications.json");

/** Max notifications per tag to prevent abuse. */
const MAX_PER_TAG = 500;
/** Max payload size in characters (hex-encoded encrypted notification). */
const MAX_PAYLOAD_SIZE = 2048;
/** Max age for notifications in ms (30 days). */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// ─── File I/O ────────────────────────────────────────────────────────────────

type NotificationEntry = {
  payload: string;
  timestamp: number;
  id: string;
};

type NotificationStore = Record<string, NotificationEntry[]>;

function ensureDataDir(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdirSync } = require("fs");
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    // Already exists
  }
}

function readStore(): NotificationStore {
  ensureDataDir();
  if (!existsSync(NOTIFICATIONS_FILE)) return {};
  try {
    const raw = readFileSync(NOTIFICATIONS_FILE, "utf-8");
    return JSON.parse(raw) as NotificationStore;
  } catch {
    return {};
  }
}

function writeStore(store: NotificationStore): void {
  ensureDataDir();
  writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(store), "utf-8");
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Remove expired notifications from a tag's entries. */
function pruneExpired(entries: NotificationEntry[]): NotificationEntry[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  return entries.filter((e) => e.timestamp > cutoff);
}

// ─── POST /api/notify — Store a notification ────────────────────────────────

interface PostBody {
  tag: string;
  payload: string;
}

export async function POST(request: NextRequest) {
  let body: PostBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.tag || typeof body.tag !== "string") {
    return NextResponse.json({ error: "Missing 'tag' field" }, { status: 400 });
  }
  if (!body.payload || typeof body.payload !== "string") {
    return NextResponse.json({ error: "Missing 'payload' field" }, { status: 400 });
  }
  if (body.payload.length > MAX_PAYLOAD_SIZE) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const store = readStore();
  const existing = pruneExpired(store[body.tag] ?? []);

  if (existing.length >= MAX_PER_TAG) {
    return NextResponse.json(
      { error: "Too many notifications for this tag" },
      { status: 429 }
    );
  }

  const entry: NotificationEntry = {
    payload: body.payload,
    timestamp: Date.now(),
    id: generateId(),
  };

  store[body.tag] = [...existing, entry];
  writeStore(store);

  return NextResponse.json({ id: entry.id }, { status: 201 });
}

// ─── GET /api/notify?tag=<tag> — Retrieve notifications ─────────────────────

export async function GET(request: NextRequest) {
  const tag = request.nextUrl.searchParams.get("tag");
  if (!tag) {
    return NextResponse.json({ error: "Missing 'tag' query parameter" }, { status: 400 });
  }

  const store = readStore();
  const entries = pruneExpired(store[tag] ?? []);

  // Update store with pruned entries
  if (entries.length !== (store[tag]?.length ?? 0)) {
    store[tag] = entries;
    writeStore(store);
  }

  return NextResponse.json({
    notifications: entries.map((e) => ({
      id: e.id,
      payload: e.payload,
      timestamp: e.timestamp,
    })),
  });
}

// ─── DELETE /api/notify?tag=<tag>&id=<id> — Delete after read ────────────────

export async function DELETE(request: NextRequest) {
  const tag = request.nextUrl.searchParams.get("tag");
  const id = request.nextUrl.searchParams.get("id");

  if (!tag) {
    return NextResponse.json({ error: "Missing 'tag' query parameter" }, { status: 400 });
  }

  const store = readStore();
  const entries = store[tag] ?? [];

  if (id) {
    // Delete specific notification
    store[tag] = entries.filter((e) => e.id !== id);
  } else {
    // Delete all for tag
    delete store[tag];
  }

  writeStore(store);
  return NextResponse.json({ ok: true });
}
