/**
 * index.ts — Public SDK API
 *
 * Re-exports everything a consumer of the ZkToken SDK needs.
 */

// Crypto singletons
export { initCrypto, getBabyJub, getPoseidon } from "./crypto";

// Types
export type {
  Note,
  NoteMemoData,
  BabyJubKeyPair,
  BabyJubPoint,
  MerklePath,
  Groth16Proof,
  TransferProofResult,
  WithdrawProofResult,
  DepositParams,
  TransferParams,
  WithdrawParams,
  EthersSigner,
  EthersProvider,
  EthersTransactionResponse,
} from "./types";
export { SHIELDED_POOL_ABI, ERC20_ABI } from "./types";

// KeyManager
export { KeyManager, SUBGROUP_ORDER } from "./keys";

// NoteManager
export {
  createNote,
  finaliseNote,
  noteFromMemoData,
  computePedersenCommitment,
  computeNoteCommitment,
  computeNullifier,
  encodeNote,
  decodeNote,
  NoteStore,
} from "./note";

// MerkleTreeSync
export { MerkleTreeSync, TREE_DEPTH } from "./merkle";

// MemoEncryptor
export {
  encryptMemo,
  decryptMemo,
  scanMemos,
  MEMO_BYTES,
} from "./encryption";
export type { MemoEvent } from "./encryption";

// ProofGenerator
export {
  generateTransferProof,
  generateWithdrawProof,
  encodeProofForContract,
} from "./prover";
export type { TransferProofParams, WithdrawProofParams } from "./prover";

// TransactionBuilder
export {
  deposit,
  waitForDeposit,
  transfer,
  withdraw,
} from "./transaction";

// Utilities
export { bytesToHex, hexToBytes } from "./utils";
