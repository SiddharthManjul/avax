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
  SHIELDED_POOL_ABI,
  ERC20_ABI,
  type DepositParams,
  type TransferParams,
  type WithdrawParams,
  type EthersTransactionResponse,
  type Note,
} from "./types";
import { createNote, finaliseNote } from "./note";
import { MerkleTreeSync } from "./merkle";
import {
  generateTransferProof,
  generateWithdrawProof,
} from "./prover";
import { encryptMemo } from "./encryption";
import { bytesToHex } from "./utils";

// ─── Deposit ──────────────────────────────────────────────────────────────────

/**
 * Deposit ERC20 tokens into the shielded pool.
 *
 * Steps:
 *   1. Create a new Note (amount, ownerPublicKey)
 *   2. Approve the pool contract to spend `amount` of tokens
 *   3. Call ShieldedPool.deposit(amount, noteCommitment)
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

  // 1. Create a new note
  const pendingNote = await createNote(amount, ownerPublicKey, tokenAddress);

  // 2. Approve token transfer
  const erc20Iface = new Interface(ERC20_ABI);
  const approveData = erc20Iface.encodeFunctionData("approve", [
    poolAddress,
    amount,
  ]);
  const approveTx = await signer.sendTransaction({
    to: tokenAddress,
    data: approveData,
  });
  await approveTx.wait();

  // 3. Deposit into pool
  const poolIface = new Interface(SHIELDED_POOL_ABI);
  const depositData = poolIface.encodeFunctionData("deposit", [
    amount,
    pendingNote.noteCommitment,
  ]);
  const tx = await signer.sendTransaction({
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

  const logs = await provider.getLogs({
    address: poolAddress,
    topics: [depositTopic, "0x" + pendingNote.noteCommitment.toString(16).padStart(64, "0")],
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });

  if (logs.length === 0) throw new Error("waitForDeposit: Deposit event not found");

  const parsed = poolIface.parseLog(logs[0]!);
  if (!parsed) throw new Error("waitForDeposit: failed to parse Deposit event");

  const leafIndex = Number(parsed.args["leafIndex"] as bigint);
  const createdAtBlock = receipt.blockNumber;

  return finaliseNote({ ...pendingNote, createdAtBlock }, leafIndex);
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

  const tx = await signer.sendTransaction({ to: poolAddress, data });

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

  const tx = await signer.sendTransaction({ to: poolAddress, data });

  return { tx, changeNote: proofResult.changeNote };
}
