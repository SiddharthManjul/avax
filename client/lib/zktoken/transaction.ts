/**
 * transaction.ts — TransactionBuilder
 *
 * Orchestrates the full deposit → transfer → withdraw flow.
 *
 * Each function:
 *   1. Validates inputs
 *   2. Prepares cryptographic material (notes, Merkle paths, proofs)
 *   3. Encodes + submits the on-chain transaction
 *   4. Returns the transaction response and any new notes for local storage
 *
 * Callers are responsible for updating their NoteStore after a transaction
 * is confirmed (mark input note as spent, save output notes).
 */

import { Interface, getAddress } from "ethers";
import {
  type DepositParams,
  type TransferParams,
  type WithdrawParams,
  type RelayTransferParams,
  type RelayWithdrawParams,
  type RelayResponse,
  type EthersTransactionResponse,
  type EthersTransactionRequest,
  type EthersSigner,
  type Note,
} from "./types";
import { SHIELDED_POOL_ABI } from "./abi/shielded-pool";
import { TEST_TOKEN_ABI } from "./abi/test-token";
import { createNote, finaliseNote } from "./note";
import { MerkleTreeSync } from "./merkle";
import {
  generateTransferProof,
  generateWithdrawProof,
} from "./prover";
import { encryptMemo, decryptMemo, type MemoEvent } from "./encryption";
import { noteFromMemoData } from "./note";
import { bytesToHex, hexToBytes } from "./utils";

// ─── Gas fee helper ──────────────────────────────────────────────────────────

/**
 * Avalanche C-Chain requires a minimum gas price. BrowserProvider sometimes
 * fails to auto-populate fee fields, resulting in maxFeePerGas: 0 which the
 * node rejects. This helper fetches fee data and merges it into the tx.
 */
async function sendWithGas(
  signer: EthersSigner,
  tx: EthersTransactionRequest
): Promise<EthersTransactionResponse> {
  // Try to get fee data from the provider
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider = signer.provider as any;
  if (provider?.getFeeData) {
    try {
      const feeData = await provider.getFeeData();
      if (feeData.maxFeePerGas) {
        tx = {
          ...tx,
          maxFeePerGas: BigInt(feeData.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(feeData.maxPriorityFeePerGas ?? 0n),
        };
      } else if (feeData.gasPrice) {
        tx = { ...tx, gasPrice: BigInt(feeData.gasPrice) };
      }
    } catch {
      // Fall through to hardcoded minimum
    }
  }

  // Ensure at least the Avalanche minimum (25 nAVAX base fee)
  if (!tx.maxFeePerGas && !tx.gasPrice) {
    tx = { ...tx, maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n };
  }

  return signer.sendTransaction(tx);
}

// ─── Deposit ──────────────────────────────────────────────────────────────────

/**
 * Deposit ERC20 tokens into the shielded pool.
 *
 * `amount` is in whole token units (e.g. 500 = 500 SRD). The note stores
 * this value directly (must fit in uint64 for circuit range proofs).
 * The ERC20 approve/transferFrom and contract deposit use the scaled
 * amount (amount * 10^18) since the token has 18 decimals.
 *
 * Steps:
 *   1. Create a new Note (amount in whole tokens)
 *   2. Approve the pool contract to spend the scaled ERC20 amount
 *   3. Call ShieldedPool.deposit(scaledAmount, noteCommitment)
 *   4. Return the pending note (leafIndex = -1 until tx confirmed)
 *
 * The caller should listen for the Deposit event to obtain the leafIndex
 * and then call finaliseNote() + NoteStore.save().
 */
export async function deposit(
  params: DepositParams
): Promise<{ tx: EthersTransactionResponse; pendingNote: Note }> {
  const { signer, poolAddress, tokenAddress, amount, ownerPublicKey } = params;

  if (amount <= 0n) throw new Error("deposit: amount must be > 0");
  if (!signer.provider) throw new Error("deposit: signer has no provider");

  // Note stores whole token amount (fits in uint64 for circuit range proofs)
  const pendingNote = await createNote(amount, ownerPublicKey, tokenAddress);

  // The ShieldedPool contract scales by AMOUNT_SCALE (1e18) internally.
  // Approve the scaled amount so the contract's transferFrom succeeds.
  const scaledAmount = amount * 10n ** 18n;

  // 2. Approve token transfer (must approve the scaled amount)
  const erc20Iface = new Interface(TEST_TOKEN_ABI);
  const approveData = erc20Iface.encodeFunctionData("approve", [
    poolAddress,
    scaledAmount,
  ]);
  const approveTx = await sendWithGas(signer, {
    to: tokenAddress,
    data: approveData,
  });
  await approveTx.wait();

  // 3. Deposit into pool — pass unscaled amount (contract scales internally)
  const poolIface = new Interface(SHIELDED_POOL_ABI);
  const depositData = poolIface.encodeFunctionData("deposit", [
    amount,
    pendingNote.noteCommitment,
  ]);
  const tx = await sendWithGas(signer, {
    to: poolAddress,
    data: depositData,
  });

  return { tx, pendingNote };
}

/**
 * Convenience: wait for a deposit to be confirmed and finalise the note
 * by reading the leafIndex from the Deposit event.
 */
export async function waitForDeposit(
  tx: EthersTransactionResponse,
  pendingNote: Note,
  provider: { getLogs: (f: { address?: string; topics?: (string | null | string[])[]; fromBlock?: number | string; toBlock?: number | string }) => Promise<{ topics: string[]; data: string; blockNumber: number; transactionHash: string }[]> },
  poolAddress: string
): Promise<Note> {
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error("waitForDeposit: transaction reverted");

  const poolIface = new Interface(SHIELDED_POOL_ABI);
  const depositTopic = poolIface.getEvent("Deposit")!.topicHash;

  // Strategy 1: parse logs from the receipt directly (ethers v6 provider returns them).
  // This is more reliable than getLogs filtering on single-block ranges on public RPCs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const receiptLogs: { topics: string[]; data: string }[] = (receipt as any).logs ?? [];
  let parsedFromReceipt = null;
  for (const log of receiptLogs) {
    if (
      log.topics[0]?.toLowerCase() === depositTopic.toLowerCase() &&
      log.topics[1] !== undefined
    ) {
      try {
        parsedFromReceipt = poolIface.parseLog(log);
        if (parsedFromReceipt) break;
      } catch {
        // Not a Deposit log, continue
      }
    }
  }

  if (parsedFromReceipt) {
    const leafIndex = Number(parsedFromReceipt.args["leafIndex"] as bigint);
    return finaliseNote({ ...pendingNote, createdAtBlock: receipt.blockNumber }, leafIndex);
  }

  // Strategy 2: fallback getLogs query (wider block range for safety)
  const logs = await provider.getLogs({
    address: poolAddress,
    topics: [depositTopic],
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });

  // Find the log whose commitment topic matches our note
  const noteCommitmentHex =
    "0x" + pendingNote.noteCommitment.toString(16).padStart(64, "0");
  const matchingLog = logs.find(
    (l) => l.topics[1]?.toLowerCase() === noteCommitmentHex.toLowerCase()
  );

  if (!matchingLog) {
    throw new Error(
      `waitForDeposit: Deposit event not found for commitment ${noteCommitmentHex}. ` +
        `TX ${tx.hash} was confirmed but no matching log was found.`
    );
  }

  const parsed = poolIface.parseLog(matchingLog);
  if (!parsed) throw new Error("waitForDeposit: failed to parse Deposit event");

  const leafIndex = Number(parsed.args["leafIndex"] as bigint);
  return finaliseNote({ ...pendingNote, createdAtBlock: receipt.blockNumber }, leafIndex);
}


// ─── Private Transfer ─────────────────────────────────────────────────────────

/**
 * Execute a private transfer inside the pool.
 *
 * Steps:
 *   1. Sync Merkle tree to get a fresh root + Merkle path
 *   2. Generate Groth16 proof (transfer circuit)
 *   3. Encrypt memos for recipient and sender (change note)
 *   4. Submit ShieldedPool.transfer(...)
 *   5. Return tx + output notes
 */
export async function transfer(
  params: TransferParams
): Promise<{
  tx: EthersTransactionResponse;
  recipientNote: Note;
  changeNote: Note;
}> {
  const {
    signer,
    provider,
    poolAddress,
    inputNote,
    transferAmount,
    recipientPublicKey,
    senderPublicKey,
    senderPrivateKey,
    wasmPath,
    zkeyPath,
  } = params;

  if (!signer.provider) throw new Error("transfer: signer has no provider");
  if (inputNote.spent) throw new Error("transfer: inputNote is already spent");
  if (inputNote.leafIndex < 0) throw new Error("transfer: inputNote not yet finalised (no leafIndex)");
  if (transferAmount <= 0n || transferAmount > inputNote.amount) {
    throw new Error(`transfer: invalid transferAmount ${transferAmount}`);
  }

  // 1. Sync Merkle tree
  const tree = new MerkleTreeSync();
  await tree.syncFromChain(provider, poolAddress);
  const merklePath = await tree.getMerklePath(inputNote.leafIndex);

  // 2. Generate proof
  const proofResult = await generateTransferProof({
    inputNote,
    transferAmount,
    recipientPublicKey,
    senderPublicKey,
    senderPrivateKey,
    merklePath,
    wasmPath,
    zkeyPath,
  });

  // 3. Encrypt memos
  const recipientMemoData = {
    amount: proofResult.recipientNote.amount,
    blinding: proofResult.recipientNote.blinding,
    secret: proofResult.recipientNote.secret,
    nullifierPreimage: proofResult.recipientNote.nullifierPreimage,
  };
  const senderMemoData = {
    amount: proofResult.changeNote.amount,
    blinding: proofResult.changeNote.blinding,
    secret: proofResult.changeNote.secret,
    nullifierPreimage: proofResult.changeNote.nullifierPreimage,
  };

  const encryptedMemo1 = await encryptMemo(recipientMemoData, recipientPublicKey);
  const encryptedMemo2 = await encryptMemo(senderMemoData, senderPublicKey);

  // 4. Submit transaction
  const [merkleRoot, nullifierHash, newCommitment1, newCommitment2] =
    proofResult.publicSignals;

  const poolIface = new Interface(SHIELDED_POOL_ABI);
  const data = poolIface.encodeFunctionData("transfer", [
    "0x" + bytesToHex(proofResult.proofBytes),
    merkleRoot,
    nullifierHash,
    newCommitment1,
    newCommitment2,
    "0x" + bytesToHex(encryptedMemo1),
    "0x" + bytesToHex(encryptedMemo2),
  ]);

  const tx = await sendWithGas(signer, { to: poolAddress, data });

  return {
    tx,
    recipientNote: proofResult.recipientNote,
    changeNote: proofResult.changeNote,
  };
}

// ─── Withdraw ─────────────────────────────────────────────────────────────────

/**
 * Withdraw tokens from the shielded pool to a public EVM address.
 *
 * Steps:
 *   1. Sync Merkle tree
 *   2. Generate Groth16 proof (withdraw circuit)
 *   3. Encrypt change memo (if partial withdrawal)
 *   4. Submit ShieldedPool.withdraw(...)
 *   5. Return tx + optional change note
 */
export async function withdraw(
  params: WithdrawParams
): Promise<{
  tx: EthersTransactionResponse;
  changeNote: Note | undefined;
}> {
  const {
    signer,
    provider,
    poolAddress,
    inputNote,
    withdrawAmount,
    recipient,
    senderPublicKey,
    senderPrivateKey,
    wasmPath,
    zkeyPath,
  } = params;

  if (!signer.provider) throw new Error("withdraw: signer has no provider");
  if (inputNote.spent) throw new Error("withdraw: inputNote is already spent");
  if (inputNote.leafIndex < 0) throw new Error("withdraw: inputNote not yet finalised");
  if (withdrawAmount <= 0n || withdrawAmount > inputNote.amount) {
    throw new Error(`withdraw: invalid withdrawAmount ${withdrawAmount}`);
  }

  // Validate recipient address
  getAddress(recipient); // throws if invalid

  // 1. Sync Merkle tree
  const tree = new MerkleTreeSync();
  await tree.syncFromChain(provider, poolAddress);

  // Verify the tree leaf matches the note's commitment before generating proof
  const treeLeaves = tree.getLeaves();
  if (inputNote.leafIndex >= treeLeaves.length) {
    throw new Error(
      `withdraw: note leafIndex ${inputNote.leafIndex} is beyond tree size ${treeLeaves.length}.`
    );
  }
  const onChainLeaf = treeLeaves[inputNote.leafIndex];
  if (onChainLeaf !== inputNote.noteCommitment) {
    console.error("[withdraw] MERKLE LEAF MISMATCH!");
    console.error("  tree leaf at index", inputNote.leafIndex, ":", onChainLeaf?.toString());
    console.error("  note commitment:", inputNote.noteCommitment.toString());
    throw new Error(
      `withdraw: Merkle tree leaf at index ${inputNote.leafIndex} doesn't match note commitment.`
    );
  }

  const merklePath = await tree.getMerklePath(inputNote.leafIndex);

  // 2. Generate proof
  const proofResult = await generateWithdrawProof({
    inputNote,
    withdrawAmount,
    recipient,
    senderPublicKey,
    senderPrivateKey,
    merklePath,
    wasmPath,
    zkeyPath,
  });

  const [merkleRoot, nullifierHash, amount, changeCommitment] = proofResult.publicSignals;

  // 3. Encrypt change memo (if partial)
  let encryptedMemo: Uint8Array = new Uint8Array(0);
  if (proofResult.changeNote) {
    const changeMemoData = {
      amount: proofResult.changeNote.amount,
      blinding: proofResult.changeNote.blinding,
      secret: proofResult.changeNote.secret,
      nullifierPreimage: proofResult.changeNote.nullifierPreimage,
    };
    encryptedMemo = await encryptMemo(changeMemoData, senderPublicKey);
  }

  // 4. Submit transaction
  const poolIface = new Interface(SHIELDED_POOL_ABI);
  const data = poolIface.encodeFunctionData("withdraw", [
    "0x" + bytesToHex(proofResult.proofBytes),
    merkleRoot,
    nullifierHash,
    amount,
    changeCommitment,
    recipient,
    "0x" + bytesToHex(encryptedMemo),
  ]);

  const tx = await sendWithGas(signer, { to: poolAddress, data });

  return { tx, changeNote: proofResult.changeNote };
}

// ─── Relayed Private Transfer ────────────────────────────────────────────────

/**
 * Execute a private transfer via the relay API (no wallet signature needed).
 *
 * The user generates the ZK proof and encrypted memos locally, then POSTs
 * them to the relay server which submits the transaction through the
 * Paymaster contract. The user's EVM address never appears on-chain.
 */
export async function relayTransfer(
  params: RelayTransferParams
): Promise<{
  relay: RelayResponse;
  recipientNote: Note;
  changeNote: Note;
}> {
  const {
    provider,
    poolAddress,
    inputNote,
    transferAmount,
    recipientPublicKey,
    senderPublicKey,
    senderPrivateKey,
    wasmPath,
    zkeyPath,
    relayUrl = "/api/relay",
  } = params;

  if (inputNote.spent) throw new Error("relayTransfer: inputNote is already spent");
  if (inputNote.leafIndex < 0) throw new Error("relayTransfer: inputNote not yet finalised");
  if (transferAmount <= 0n || transferAmount > inputNote.amount) {
    throw new Error(`relayTransfer: invalid transferAmount ${transferAmount}`);
  }

  // 1. Sync Merkle tree
  const tree = new MerkleTreeSync();
  await tree.syncFromChain(provider, poolAddress);
  const merklePath = await tree.getMerklePath(inputNote.leafIndex);

  // 2. Generate proof
  const proofResult = await generateTransferProof({
    inputNote,
    transferAmount,
    recipientPublicKey,
    senderPublicKey,
    senderPrivateKey,
    merklePath,
    wasmPath,
    zkeyPath,
  });

  // 3. Encrypt memos
  const recipientMemoData = {
    amount: proofResult.recipientNote.amount,
    blinding: proofResult.recipientNote.blinding,
    secret: proofResult.recipientNote.secret,
    nullifierPreimage: proofResult.recipientNote.nullifierPreimage,
  };
  const senderMemoData = {
    amount: proofResult.changeNote.amount,
    blinding: proofResult.changeNote.blinding,
    secret: proofResult.changeNote.secret,
    nullifierPreimage: proofResult.changeNote.nullifierPreimage,
  };

  const encryptedMemo1 = await encryptMemo(recipientMemoData, recipientPublicKey);
  const encryptedMemo2 = await encryptMemo(senderMemoData, senderPublicKey);

  const [merkleRoot, nullifierHash, newCommitment1, newCommitment2] =
    proofResult.publicSignals;

  // 4. POST to relay API
  const body = {
    type: "transfer" as const,
    proof: "0x" + bytesToHex(proofResult.proofBytes),
    merkleRoot: merkleRoot.toString(),
    nullifierHash: nullifierHash.toString(),
    newCommitment1: newCommitment1.toString(),
    newCommitment2: newCommitment2.toString(),
    encryptedMemo1: "0x" + bytesToHex(encryptedMemo1),
    encryptedMemo2: "0x" + bytesToHex(encryptedMemo2),
  };

  const res = await fetch(relayUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`relayTransfer: relay returned ${res.status}: ${errText}`);
  }

  const relay: RelayResponse = await res.json();

  // 5. Finalize notes — re-sync tree to find the leaf indices assigned on-chain
  const finalizedNotes = await _finalizeTransferNotes(
    provider,
    poolAddress,
    proofResult.recipientNote,
    proofResult.changeNote,
    relay.blockNumber
  );

  return {
    relay,
    recipientNote: finalizedNotes.recipientNote,
    changeNote: finalizedNotes.changeNote,
  };
}

// ─── Relayed Withdraw ────────────────────────────────────────────────────────

/**
 * Execute a withdrawal via the relay API (no wallet signature needed).
 */
export async function relayWithdraw(
  params: RelayWithdrawParams
): Promise<{
  relay: RelayResponse;
  changeNote: Note | undefined;
}> {
  const {
    provider,
    poolAddress,
    inputNote,
    withdrawAmount,
    recipient,
    senderPublicKey,
    senderPrivateKey,
    wasmPath,
    zkeyPath,
    relayUrl = "/api/relay",
  } = params;

  if (inputNote.spent) throw new Error("relayWithdraw: inputNote is already spent");
  if (inputNote.leafIndex < 0) throw new Error("relayWithdraw: inputNote not yet finalised");
  if (withdrawAmount <= 0n || withdrawAmount > inputNote.amount) {
    throw new Error(`relayWithdraw: invalid withdrawAmount ${withdrawAmount}`);
  }

  getAddress(recipient);

  // 1. Sync Merkle tree
  const tree = new MerkleTreeSync();
  await tree.syncFromChain(provider, poolAddress);

  // Verify the tree leaf matches the note's commitment before generating proof
  const treeLeaves = tree.getLeaves();
  if (inputNote.leafIndex >= treeLeaves.length) {
    throw new Error(
      `relayWithdraw: note leafIndex ${inputNote.leafIndex} is beyond tree size ${treeLeaves.length}. ` +
      `The Merkle tree may not be fully synced.`
    );
  }
  const onChainLeaf = treeLeaves[inputNote.leafIndex];
  if (onChainLeaf !== inputNote.noteCommitment) {
    console.error("[relayWithdraw] MERKLE LEAF MISMATCH!");
    console.error("  tree leaf at index", inputNote.leafIndex, ":", onChainLeaf?.toString());
    console.error("  note commitment:", inputNote.noteCommitment.toString());
    throw new Error(
      `relayWithdraw: Merkle tree leaf at index ${inputNote.leafIndex} doesn't match ` +
      `note commitment. The note may have been finalized with the wrong leafIndex.`
    );
  }

  const merklePath = await tree.getMerklePath(inputNote.leafIndex);

  // 2. Generate proof
  const proofResult = await generateWithdrawProof({
    inputNote,
    withdrawAmount,
    recipient,
    senderPublicKey,
    senderPrivateKey,
    merklePath,
    wasmPath,
    zkeyPath,
  });

  const [merkleRoot, nullifierHash, amount, changeCommitment] = proofResult.publicSignals;

  // 3. Encrypt change memo (if partial)
  let encryptedMemoHex = "0x";
  if (proofResult.changeNote) {
    const changeMemoData = {
      amount: proofResult.changeNote.amount,
      blinding: proofResult.changeNote.blinding,
      secret: proofResult.changeNote.secret,
      nullifierPreimage: proofResult.changeNote.nullifierPreimage,
    };
    const encryptedMemo = await encryptMemo(changeMemoData, senderPublicKey);
    encryptedMemoHex = "0x" + bytesToHex(encryptedMemo);
  }

  // 4. POST to relay API
  const body = {
    type: "withdraw" as const,
    proof: "0x" + bytesToHex(proofResult.proofBytes),
    merkleRoot: merkleRoot.toString(),
    nullifierHash: nullifierHash.toString(),
    amount: amount.toString(),
    changeCommitment: changeCommitment.toString(),
    recipient,
    encryptedMemo: encryptedMemoHex,
  };

  const res = await fetch(relayUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`relayWithdraw: relay returned ${res.status}: ${errText}`);
  }

  const relay: RelayResponse = await res.json();

  // 5. Finalize change note — re-sync tree to find the leaf index assigned on-chain
  let finalizedChange = proofResult.changeNote;
  if (finalizedChange) {
    const postTree = new MerkleTreeSync();
    await postTree.syncFromChain(provider, poolAddress);
    const changeIdx = postTree.findLeafIndex(finalizedChange.noteCommitment);
    if (changeIdx >= 0) {
      finalizedChange = await finaliseNote(
        { ...finalizedChange, createdAtBlock: relay.blockNumber },
        changeIdx
      );
    }
  }

  return { relay, changeNote: finalizedChange };
}

// ─── Internal: finalize transfer output notes ────────────────────────────────

/**
 * After a transfer is confirmed on-chain, re-sync the Merkle tree and
 * look up the leaf indices for the two output notes, then finalize them
 * (compute nullifiers so they can be spent later).
 */
async function _finalizeTransferNotes(
  provider: import("./types").EthersProvider,
  poolAddress: string,
  recipientNote: Note,
  changeNote: Note,
  blockNumber: number
): Promise<{ recipientNote: Note; changeNote: Note }> {
  const postTree = new MerkleTreeSync();
  await postTree.syncFromChain(provider, poolAddress);

  const recipientIdx = postTree.findLeafIndex(recipientNote.noteCommitment);
  const changeIdx = postTree.findLeafIndex(changeNote.noteCommitment);

  const finalRecipient =
    recipientIdx >= 0
      ? await finaliseNote({ ...recipientNote, createdAtBlock: blockNumber }, recipientIdx)
      : recipientNote;

  const finalChange =
    changeIdx >= 0
      ? await finaliseNote({ ...changeNote, createdAtBlock: blockNumber }, changeIdx)
      : changeNote;

  return { recipientNote: finalRecipient, changeNote: finalChange };
}

// ─── Scan chain for incoming notes (memo trial decryption) ────────────────

/** DEPLOY_BLOCK for the current pool contract. */
const SCAN_DEPLOY_BLOCK = 52396103;
const SCAN_CHUNK_SIZE = 2048;

/**
 * Scan on-chain events for notes addressed to the given private key.
 *
 * Replays PrivateTransfer and Withdrawal events, extracts encrypted memos,
 * and attempts trial decryption with the user's Baby Jubjub private key.
 * Successfully decrypted memos are reconstructed into full Note objects.
 *
 * @returns Array of discovered notes (already finalized with leafIndex + nullifier).
 */
export async function scanChainForNotes(params: {
  provider: import("./types").EthersProvider;
  poolAddress: string;
  myPrivateKey: bigint;
  myPublicKey: import("./types").BabyJubPoint;
  tokenAddress: string;
  existingNullifiers?: Set<string>;
}): Promise<Note[]> {
  const { provider, poolAddress, myPrivateKey, myPublicKey, tokenAddress, existingNullifiers } = params;

  const iface = new Interface(SHIELDED_POOL_ABI);
  const depositTopic = iface.getEvent("Deposit")!.topicHash;
  const transferTopic = iface.getEvent("PrivateTransfer")!.topicHash;
  const withdrawalTopic = iface.getEvent("Withdrawal")!.topicHash;
  const topics = [[depositTopic, transferTopic, withdrawalTopic]];

  const latestBlock = await provider.getBlockNumber();
  const allLogs: { topics: string[]; data: string; blockNumber: number; logIndex?: number }[] = [];

  for (let start = SCAN_DEPLOY_BLOCK; start <= latestBlock; start += SCAN_CHUNK_SIZE) {
    const end = Math.min(start + SCAN_CHUNK_SIZE - 1, latestBlock);
    const chunk = await provider.getLogs({
      address: poolAddress,
      topics,
      fromBlock: start,
      toBlock: end,
    });
    allLogs.push(...chunk);
  }

  allLogs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });

  // Replay events to track leaf indices AND collect memo events
  let leafIndex = 0;
  const memoEvents: Array<{
    memoBytes: Uint8Array;
    commitment: bigint;
    leafIndex: number;
    blockNumber: number;
  }> = [];

  for (const log of allLogs) {
    const topic = log.topics[0];
    if (topic === depositTopic) {
      // Deposit inserts 1 leaf, no encrypted memo
      leafIndex++;
    } else if (topic === transferTopic) {
      const parsed = iface.parseLog(log);
      if (parsed) {
        const commitment1 = parsed.args["commitment1"] as bigint;
        const commitment2 = parsed.args["commitment2"] as bigint;
        const memo1Hex = parsed.args["encryptedMemo1"] as string;
        const memo2Hex = parsed.args["encryptedMemo2"] as string;

        // commitment1 gets leafIndex, commitment2 gets leafIndex+1
        if (memo1Hex && memo1Hex.length > 2) {
          memoEvents.push({
            memoBytes: hexToBytes(memo1Hex.slice(2)),
            commitment: commitment1,
            leafIndex: leafIndex,
            blockNumber: log.blockNumber,
          });
        }
        if (memo2Hex && memo2Hex.length > 2) {
          memoEvents.push({
            memoBytes: hexToBytes(memo2Hex.slice(2)),
            commitment: commitment2,
            leafIndex: leafIndex + 1,
            blockNumber: log.blockNumber,
          });
        }
        leafIndex += 2;
      }
    } else if (topic === withdrawalTopic) {
      const parsed = iface.parseLog(log);
      if (parsed) {
        const changeCommitment = parsed.args["changeCommitment"] as bigint;
        const memoHex = parsed.args["encryptedMemo"] as string;

        if (changeCommitment !== 0n) {
          if (memoHex && memoHex.length > 2) {
            memoEvents.push({
              memoBytes: hexToBytes(memoHex.slice(2)),
              commitment: changeCommitment,
              leafIndex: leafIndex,
              blockNumber: log.blockNumber,
            });
          }
          leafIndex++;
        }
      }
    }
  }

  // Trial-decrypt all memos
  const discoveredNotes: Note[] = [];

  for (const event of memoEvents) {
    const memoData = await decryptMemo(event.memoBytes, myPrivateKey);
    if (memoData === null) continue;

    // Skip if we already have this note
    const note = await noteFromMemoData(
      memoData,
      myPublicKey,
      tokenAddress,
      event.leafIndex,
      event.blockNumber
    );

    // Skip notes we already know about
    if (existingNullifiers?.has(note.nullifier.toString())) continue;

    discoveredNotes.push(note);
  }

  return discoveredNotes;
}
