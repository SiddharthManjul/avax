/**
 * indexer.ts — GraphQL client for the Envio HyperIndex indexer.
 *
 * Thin fetch-based client, no new dependencies.
 * Queries indexed ShieldedPool events instead of scanning RPC in chunks.
 */

const INDEXER_URL =
  process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:8080/v1/graphql";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MerkleLeafData {
  commitment: bigint;
  leafIndex: number;
}

export interface IndexerMemoEvent {
  memoHex: string;
  commitment: bigint;
  leafIndex: number;
  blockNumber: number;
  eventType: "transfer" | "withdrawal";
}

export interface PoolStateData {
  nextLeafIndex: number;
  totalDeposits: number;
  totalTransfers: number;
  totalWithdrawals: number;
  lastIndexedBlock: number;
}

// ─── GraphQL client ─────────────────────────────────────────────────────────

async function queryIndexer<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Indexer query failed: ${res.status}`);
  const json = await res.json();
  if (json.errors)
    throw new Error(`Indexer error: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch all Merkle leaves in insertion order.
 * Supports incremental sync by specifying `afterLeafIndex`.
 */
export async function fetchMerkleLeaves(
  afterLeafIndex = -1
): Promise<MerkleLeafData[]> {
  const PAGE_SIZE = 1000;
  const allLeaves: MerkleLeafData[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await queryIndexer<{
      MerkleLeaf: Array<{ commitment: string; leafIndex: number }>;
    }>(
      `
      query($after: Int!, $limit: Int!, $offset: Int!) {
        MerkleLeaf(
          where: { leafIndex: { _gt: $after } }
          order_by: { leafIndex: asc }
          limit: $limit
          offset: $offset
        ) {
          commitment
          leafIndex
        }
      }
    `,
      { after: afterLeafIndex, limit: PAGE_SIZE, offset }
    );

    const batch = data.MerkleLeaf;
    for (const leaf of batch) {
      allLeaves.push({
        commitment: BigInt(leaf.commitment),
        leafIndex: leaf.leafIndex,
      });
    }

    hasMore = batch.length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  return allLeaves;
}

/**
 * Fetch encrypted memo events for note discovery.
 * Returns transfer memos and withdrawal change memos, sorted by block.
 */
export async function fetchMemoEvents(
  afterBlock = 0
): Promise<IndexerMemoEvent[]> {
  const results: IndexerMemoEvent[] = [];

  // Fetch transfer events
  const transfers = await queryIndexer<{
    TransferEvent: Array<{
      commitment1: string;
      commitment2: string;
      encryptedMemo1: string;
      encryptedMemo2: string;
      leafIndex1: number;
      leafIndex2: number;
      blockNumber: number;
    }>;
  }>(
    `
    query($afterBlock: Int!) {
      TransferEvent(
        where: { blockNumber: { _gt: $afterBlock } }
        order_by: { blockNumber: asc }
      ) {
        commitment1
        commitment2
        encryptedMemo1
        encryptedMemo2
        leafIndex1
        leafIndex2
        blockNumber
      }
    }
  `,
    { afterBlock }
  );

  for (const t of transfers.TransferEvent) {
    if (t.encryptedMemo1 && t.encryptedMemo1.length > 2) {
      results.push({
        memoHex: t.encryptedMemo1,
        commitment: BigInt(t.commitment1),
        leafIndex: t.leafIndex1,
        blockNumber: t.blockNumber,
        eventType: "transfer",
      });
    }
    if (t.encryptedMemo2 && t.encryptedMemo2.length > 2) {
      results.push({
        memoHex: t.encryptedMemo2,
        commitment: BigInt(t.commitment2),
        leafIndex: t.leafIndex2,
        blockNumber: t.blockNumber,
        eventType: "transfer",
      });
    }
  }

  // Fetch withdrawal events with change notes
  const withdrawals = await queryIndexer<{
    WithdrawalEvent: Array<{
      changeCommitment: string;
      encryptedMemo: string;
      changeLeafIndex: number;
      blockNumber: number;
    }>;
  }>(
    `
    query($afterBlock: Int!) {
      WithdrawalEvent(
        where: { blockNumber: { _gt: $afterBlock }, changeLeafIndex: { _gt: -1 } }
        order_by: { blockNumber: asc }
      ) {
        changeCommitment
        encryptedMemo
        changeLeafIndex
        blockNumber
      }
    }
  `,
    { afterBlock }
  );

  for (const w of withdrawals.WithdrawalEvent) {
    if (w.encryptedMemo && w.encryptedMemo.length > 2) {
      results.push({
        memoHex: w.encryptedMemo,
        commitment: BigInt(w.changeCommitment),
        leafIndex: w.changeLeafIndex,
        blockNumber: w.blockNumber,
        eventType: "withdrawal",
      });
    }
  }

  results.sort((a, b) => a.blockNumber - b.blockNumber);
  return results;
}

/** Fetch pool state singleton. */
export async function fetchPoolState(): Promise<PoolStateData> {
  const data = await queryIndexer<{ PoolState: Array<PoolStateData> }>(`
    query {
      PoolState(where: { id: { _eq: "pool" } }) {
        nextLeafIndex
        totalDeposits
        totalTransfers
        totalWithdrawals
        lastIndexedBlock
      }
    }
  `);
  if (!data.PoolState.length) {
    return {
      nextLeafIndex: 0,
      totalDeposits: 0,
      totalTransfers: 0,
      totalWithdrawals: 0,
      lastIndexedBlock: 0,
    };
  }
  return data.PoolState[0];
}
