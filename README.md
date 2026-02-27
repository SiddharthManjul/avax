# Shroud Network — Private Token Transfer System on Avalanche C-Chain

## Project Summary

Build a privacy layer application that lets users mint ZK tokens (zkTokens) against any ERC20 token in a 1:1 ratio. Once minted, these zkTokens can be transferred privately — the amount sent, sender identity, and receiver identity are completely hidden on-chain. Only cryptographic commitments and zero-knowledge proofs are visible. The system uses Pedersen commitments on the Baby Jubjub embedded curve for amount hiding with additive homomorphism, and Groth16 ZK proofs over BN254 for on-chain verification.

Target deployment: Avalanche C-Chain (EVM-compatible, Chain ID 43114). Future path: custom Avalanche Subnet with native privacy primitives.


## Architecture Overview

The system has three layers:

1. Smart Contracts (Solidity, EVM) — on-chain logic for deposits, transfers, withdrawals, commitment storage, nullifier tracking, and proof verification
2. ZK Circuits (Circom) — define what the prover must demonstrate without revealing private data
3. Client SDK (TypeScript/JavaScript) — note management, proof generation, transaction construction, encrypted memo handling


## Core Mechanism

### Commitment Scheme: Pedersen on Baby Jubjub

We use Pedersen commitments on the Baby Jubjub elliptic curve. Baby Jubjub is an Edwards curve whose base field is the BN254 scalar field, meaning all curve operations are native arithmetic inside BN254-based ZK circuits. This dramatically reduces constraint count compared to using a non-embedded curve.

Baby Jubjub curve parameters (twisted Edwards form):
- Equation: a*x^2 + y^2 = 1 + d*x^2*y^2
- a = 168700
- d = 168696  
- Base field: BN254 scalar field (p = 21888242871839275222246405745257275088548364400416034343698204186575808495617)
- Generator G: (995203441582195749578291179787384436505546430278305826713579947235728471134, 5472060717959818805561601436314318772137091100104008585924551046643952123905)
- Generator H: a second independently generated point where nobody knows the discrete log relationship to G. Generate H = HashToCurve("zktoken_pedersen_h") to ensure nobody knows log_G(H).
- Subgroup order: 2736030358979909402780800718157159386076813972158567259200215660948447373041

Pedersen commitment formula:
  C = v * G + r * H
Where v is the secret value (token amount) and r is a random blinding factor.

Key property — additive homomorphism: C1 + C2 = (v1+v2)*G + (r1+r2)*H. This means you can verify that input amounts equal output amounts by checking that input commitment points equal the sum of output commitment points, without knowing any amounts. This is a simple elliptic curve point addition check rather than expensive in-circuit arithmetic.

### Note Structure

Each private token holding is represented as a "note" with the following fields:

```
Note {
  amount: uint64           — token amount (max ~18.4 * 10^18)
  blinding: uint256        — random blinding factor for Pedersen commitment  
  secret: uint256          — random 31-byte secret known only to owner
  nullifier_preimage: uint256 — random 31-byte value used to derive nullifier
  owner_public_key: (x, y)   — Baby Jubjub public key of the note owner
}
```

The commitment stored on-chain is computed as:
  pedersen_commitment = amount * G + blinding * H
  note_commitment = Poseidon(pedersen_commitment.x, pedersen_commitment.y, secret, nullifier_preimage, owner_public_key.x)

The note_commitment goes into the Merkle tree as a leaf. The pedersen_commitment is used for homomorphic balance verification.

The nullifier (revealed when spending) is:
  nullifier = Poseidon(nullifier_preimage, secret, leaf_index)

This ensures each note has exactly one nullifier, preventing double-spending.

### Merkle Tree

- Type: Incremental append-only Merkle tree
- Hash function: Poseidon (t=3, 2 inputs) for internal nodes
- Depth: 20 (supports 1,048,576 commitments)
- Zero values: zero[0] = 0, zero[i] = Poseidon(zero[i-1], zero[i-1])
- Stores historical roots (last 100) so proofs against recent states remain valid
- Leaves are never removed; spending is tracked via nullifiers


## Transaction Types

### 1. Deposit (Mint zkTokens)

User locks ERC20 tokens and creates a commitment in the Merkle tree.

Flow:
1. User generates random secret, nullifier_preimage, blinding factor locally
2. User computes pedersen_commitment = amount * G + blinding * H
3. User computes note_commitment = Poseidon(pedersen_commitment.x, pedersen_commitment.y, secret, nullifier_preimage, owner_pk.x)
4. User approves ERC20 transfer to the ZkToken contract
5. User calls deposit(amount, note_commitment, pedersen_commitment) on the contract
6. Contract transfers ERC20 tokens from user, inserts note_commitment into Merkle tree
7. Contract emits Deposit event with note_commitment and leaf_index
8. User stores the full note data locally (secret, nullifier_preimage, amount, blinding, leaf_index)

Note: The deposit amount IS visible on-chain (it has to be, since ERC20 transfer is public). Privacy begins after deposit. For stronger privacy, consider fixed denomination deposits (e.g., only allow deposits of 100, 1000, 10000 tokens) so deposit amounts don't serve as fingerprints.

Contract function signature:
  function deposit(uint256 amount, uint256 noteCommitment, uint256[2] calldata pedersenCommitment) external

### 2. Private Transfer

Sender consumes their note (via nullifier) and creates two new notes: one for the recipient and one for change back to themselves. A ZK proof proves the transaction is valid without revealing any private data.

Flow:
1. Sender knows their note: (amount_in, blinding_in, secret, nullifier_preimage, leaf_index, merkle_path)
2. Sender creates two new notes:
   - Recipient note: (amount_out_1, blinding_out_1, secret_out_1, nullifier_preimage_out_1, recipient_pk)
   - Change note: (amount_out_2, blinding_out_2, secret_out_2, nullifier_preimage_out_2, sender_pk)
   - Constraint: amount_in = amount_out_1 + amount_out_2
   - Constraint: blinding_in = blinding_out_1 + blinding_out_2 (so Pedersen commitments balance homomorphically)
3. Sender generates a Groth16 proof (see circuit spec below)
4. Sender encrypts note details for recipient using ECDH (recipient's public key + ephemeral keypair)
5. Sender submits to contract: proof, nullifier, two new note_commitments, two new pedersen_commitments, encrypted memo
6. Contract verifies:
   a. Merkle root used in proof is known/valid
   b. Nullifier has not been spent before
   c. Pedersen commitments balance: C_in == C_out_1 + C_out_2 (on-chain EC point check)
   d. Groth16 proof is valid
7. Contract stores nullifier as spent, inserts two new note_commitments into tree, emits events

Contract function signature:
  function transfer(
    uint256[2] calldata proof_a,
    uint256[2][2] calldata proof_b,
    uint256[2] calldata proof_c,
    uint256 merkleRoot,
    uint256 nullifier,
    uint256 newCommitment1,
    uint256 newCommitment2,
    uint256[2] calldata newPedersenCommitment1,
    uint256[2] calldata newPedersenCommitment2,
    uint256[2] calldata inputPedersenCommitment,
    bytes calldata encryptedMemo
  ) external

### 3. Withdraw (Burn zkTokens)

User consumes their note and receives ERC20 tokens at a specified address. The withdrawal amount is revealed (necessary to release ERC20) but the link between the depositor and withdrawer is broken.

Flow:
1. User generates a proof that they own a valid note in the tree
2. User specifies withdrawal amount and recipient address
3. Contract verifies proof, checks nullifier, releases ERC20 tokens

Contract function signature:
  function withdraw(
    uint256[2] calldata proof_a,
    uint256[2][2] calldata proof_b,
    uint256[2] calldata proof_c,
    uint256 merkleRoot,
    uint256 nullifier,
    uint256 amount,
    address recipient,
    uint256 newCommitment,
    uint256[2] calldata newPedersenCommitment,
    uint256[2] calldata inputPedersenCommitment
  ) external


## ZK Circuit Specification (Circom)

Use Circom 2.x with the circomlib library for Poseidon and Baby Jubjub operations.

### Transfer Circuit

Template name: PrivateTransfer

Public inputs (visible on-chain):
- merkle_root: uint256 — the Merkle tree root being proven against
- nullifier_hash: uint256 — the nullifier of the consumed note
- new_commitment_1: uint256 — output note commitment for recipient
- new_commitment_2: uint256 — output note commitment for change
- input_pedersen_x: uint256 — x-coordinate of input Pedersen commitment
- input_pedersen_y: uint256 — y-coordinate of input Pedersen commitment
- output_pedersen_1_x, output_pedersen_1_y: uint256 — output 1 Pedersen commitment
- output_pedersen_2_x, output_pedersen_2_y: uint256 — output 2 Pedersen commitment

Private inputs (only the prover knows these):
- amount_in: uint64 — input note amount
- blinding_in: uint256 — input note blinding factor
- secret: uint256 — input note secret
- nullifier_preimage: uint256 — input note nullifier preimage
- owner_private_key: uint256 — sender's Baby Jubjub private key
- leaf_index: uint256 — position of the note in the Merkle tree
- merkle_path[20]: uint256[20] — sibling hashes along the Merkle path
- path_indices[20]: uint256[20] — left/right indicators (0 or 1) for each level
- amount_out_1: uint64 — recipient amount
- amount_out_2: uint64 — change amount
- blinding_out_1: uint256 — recipient blinding factor
- blinding_out_2: uint256 — change blinding factor
- secret_out_1: uint256 — recipient note secret
- secret_out_2: uint256 — change note secret
- nullifier_preimage_out_1: uint256 — recipient nullifier preimage
- nullifier_preimage_out_2: uint256 — change nullifier preimage
- owner_pk_out_1: (x, y) — recipient public key
- owner_pk_out_2: (x, y) — sender public key (for change)

Circuit constraints (what the circuit proves):

1. Ownership: Derive owner_public_key from owner_private_key using Baby Jubjub scalar multiplication. Verify it matches the public key in the input note.

2. Pedersen commitment correctness: Verify that input_pedersen = amount_in * G + blinding_in * H. This requires fixed-base scalar multiplication on Baby Jubjub inside the circuit. Use windowed multiplication (window size 4) with precomputed lookup tables for G and H to minimize constraints. Target: ~500-700 constraints per scalar mul using the embedded curve advantage.

3. Note commitment reconstruction: Compute note_commitment = Poseidon(input_pedersen.x, input_pedersen.y, secret, nullifier_preimage, owner_public_key.x). Verify this matches a leaf in the Merkle tree.

4. Merkle inclusion proof: Using the merkle_path and path_indices, hash up from the leaf to the root using Poseidon. Verify the computed root equals the public input merkle_root. Cost: 20 Poseidon hashes = ~5,000 constraints.

5. Nullifier derivation: Compute nullifier = Poseidon(nullifier_preimage, secret, leaf_index). Verify it equals the public input nullifier_hash. Cost: ~250 constraints.

6. Amount conservation: Verify amount_in == amount_out_1 + amount_out_2. This is a simple field arithmetic check: ~1 constraint. Additionally, the homomorphic Pedersen check (C_in == C_out_1 + C_out_2) is verified on-chain, not in the circuit, saving significant constraints.

7. Range proofs: Verify both output amounts fit in 64 bits via bit decomposition. For each output amount, decompose into 64 bits, verify each bit is 0 or 1 (bit * (1 - bit) === 0), and verify the bits reconstruct the original amount. Cost: 64 * 2 + 64 = 192 constraints per amount, 384 total.

8. Output Pedersen commitment correctness: Verify output_pedersen_1 = amount_out_1 * G + blinding_out_1 * H and output_pedersen_2 = amount_out_2 * G + blinding_out_2 * H. Cost: ~1,000-1,400 constraints (two Pedersen commitments).

9. Output note commitment correctness: Verify new_commitment_1 = Poseidon(output_pedersen_1.x, output_pedersen_1.y, secret_out_1, nullifier_preimage_out_1, owner_pk_out_1.x). Same for new_commitment_2. Cost: ~500 constraints.

10. Blinding factor conservation: Verify blinding_in == blinding_out_1 + blinding_out_2. This ensures the Pedersen commitments balance homomorphically (so the on-chain point check works). Cost: 1 constraint.

Total estimated constraints: ~12,000-15,000

### Withdraw Circuit

Similar to transfer but with one output instead of two, and the amount is a public input (since ERC20 must be released in a known amount).

### Circom Dependencies

Use these circomlib templates:
- circomlib/circuits/poseidon.circom — Poseidon hash
- circomlib/circuits/babyjub.circom — Baby Jubjub curve operations
- circomlib/circuits/escalarmulfix.circom — Fixed-base scalar multiplication (optimized)
- circomlib/circuits/escalarmulany.circom — Variable-base scalar multiplication
- circomlib/circuits/bitify.circom — Num2Bits for range proofs
- circomlib/circuits/comparators.circom — Comparisons
- circomlib/circuits/mux1.circom — Multiplexer for Merkle path selection

Circuit compilation produces:
- .r1cs file (constraint system)
- .wasm file (witness generator)
- .sym file (symbol table for debugging)

Trusted setup produces:
- .zkey file (proving key)
- verification_key.json (verification key — used to generate the Solidity verifier)

Generate the Solidity verifier contract using:
  snarkjs zkey export solidityverifier circuit.zkey Groth16Verifier.sol

This auto-generated verifier is what gets deployed on Avalanche C-Chain.


## Smart Contract Architecture

### Contract Structure

1. ZkTokenFactory.sol — Factory contract that deploys ZkToken instances for any ERC20
2. ZkToken.sol — Core privacy wrapper contract (one per ERC20 token)
3. IncrementalMerkleTree.sol — Library for the append-only Poseidon Merkle tree
4. Groth16Verifier.sol — Auto-generated from snarkjs (proof verification)
5. PoseidonT3.sol and PoseidonT4.sol — Poseidon hash contracts (use the poseidon-solidity npm package or generate via circomlibjs)

### ZkTokenFactory.sol

```
contract ZkTokenFactory {
  mapping(address => address) public tokenToZkToken;  // ERC20 → ZkToken mapping
  address public verifier;                              // shared Groth16 verifier
  address[] public allZkTokens;

  event ZkTokenCreated(address indexed token, address indexed zkToken);

  constructor(address _verifier);
  function createZkToken(address token) external returns (address);
  function getZkToken(address token) external view returns (address);
}
```

### ZkToken.sol

```
contract ZkToken {
  IERC20 public immutable underlyingToken;
  Groth16Verifier public immutable verifier;

  // Merkle tree for commitments
  IncrementalMerkleTree.TreeData internal tree;
  
  // Nullifier registry (spent nullifiers)
  mapping(uint256 => bool) public nullifiers;
  
  // Known roots (current + historical)
  mapping(uint256 => bool) public knownRoots;
  
  // Events
  event Deposit(uint256 indexed commitment, uint256 leafIndex, uint256[2] pedersenCommitment, uint256 timestamp);
  event Transfer(uint256 nullifier, uint256 newCommitment1, uint256 newCommitment2, bytes encryptedMemo);
  event Withdrawal(uint256 nullifier, address indexed recipient, uint256 amount);

  // Deposit: lock ERC20, insert commitment
  function deposit(uint256 amount, uint256 noteCommitment, uint256[2] calldata pedersenCommitment) external;
  
  // Private transfer: consume note via nullifier, create 2 new notes
  function transfer(
    uint256[2] calldata proof_a,
    uint256[2][2] calldata proof_b,
    uint256[2] calldata proof_c,
    uint256 merkleRoot,
    uint256 nullifier,
    uint256 newCommitment1,
    uint256 newCommitment2,
    uint256[2] calldata newPedersenCommitment1,
    uint256[2] calldata newPedersenCommitment2,
    uint256[2] calldata inputPedersenCommitment,
    bytes calldata encryptedMemo
  ) external;
  
  // Withdraw: consume note, release ERC20
  function withdraw(
    uint256[2] calldata proof_a,
    uint256[2][2] calldata proof_b,
    uint256[2] calldata proof_c,
    uint256 merkleRoot,
    uint256 nullifier,
    uint256 amount,
    address recipient,
    uint256 changeCommitment,
    uint256[2] calldata changePedersenCommitment,
    uint256[2] calldata inputPedersenCommitment
  ) external;
  
  // View functions
  function getRoot() external view returns (uint256);
  function getNextLeafIndex() external view returns (uint256);
  function isSpentNullifier(uint256 nullifier) external view returns (bool);
  function isKnownRoot(uint256 root) external view returns (bool);
}
```

### On-Chain Pedersen Balance Check

In the transfer function, the contract must verify that the Pedersen commitments balance homomorphically. This is done using the BN254 ecAdd precompile (address 0x06):

```solidity
function _verifyPedersenBalance(
    uint256[2] calldata inputCommitment,
    uint256[2] calldata outputCommitment1,
    uint256[2] calldata outputCommitment2
) internal view returns (bool) {
    // Compute outputCommitment1 + outputCommitment2 using ecAdd precompile
    uint256[2] memory outputSum = ecAdd(outputCommitment1, outputCommitment2);
    // Check inputCommitment == outputSum
    return (inputCommitment[0] == outputSum[0] && inputCommitment[1] == outputSum[1]);
}
```

This is extremely gas-efficient (~150 gas for ecAdd) and replaces what would be thousands of constraints if done inside the ZK circuit.

### Poseidon Hash On-Chain

For the Merkle tree operations on-chain (inserting new leaves), use the poseidon-solidity package which provides gas-optimized Poseidon implementations for EVM. Install via:
  npm install poseidon-solidity

Or use the circomlibjs generated contracts. The on-chain Poseidon must match exactly the Poseidon used in the Circom circuits (same round constants, same MDS matrix, same number of rounds).

Parameters for on-chain Poseidon:
- t=3 (2 inputs + 1 capacity element): 8 full rounds, 57 partial rounds
- t=4 (3 inputs + 1 capacity element): 8 full rounds, 56 partial rounds
- S-box: x^5
- Field: BN254 scalar field


## Client SDK Specification

### Technology Stack
- Language: TypeScript
- ZK proving: snarkjs (JavaScript Groth16 prover)
- Elliptic curve: @noble/curves or circomlibjs for Baby Jubjub operations
- Hashing: circomlibjs for Poseidon (must match circuit parameters exactly)
- Encryption: ECDH on Baby Jubjub + AES-256-GCM for encrypted memos
- Ethereum interaction: ethers.js v6 or viem

### Module Structure

1. NoteManager — creates, stores, and retrieves notes locally
2. ProofGenerator — computes witnesses and generates Groth16 proofs
3. MerkleTreeSync — syncs the local Merkle tree state from on-chain events
4. TransactionBuilder — constructs deposit/transfer/withdraw transactions
5. MemoEncryptor — handles ECDH key exchange and AES encryption/decryption for recipient memos
6. KeyManager — manages Baby Jubjub keypairs for note ownership

### Note Storage

Notes are stored locally (never sent on-chain in plaintext). Storage format:

```typescript
interface Note {
  amount: bigint;
  blinding: bigint;
  secret: bigint;
  nullifierPreimage: bigint;
  ownerPublicKey: [bigint, bigint]; // Baby Jubjub point (x, y)
  leafIndex: number;
  commitment: bigint;              // the note_commitment in the Merkle tree
  pedersenCommitment: [bigint, bigint]; // the Pedersen commitment point
  spent: boolean;
  tokenAddress: string;            // which ERC20 this wraps
}
```

### Proof Generation Flow

For a private transfer:

```typescript
async function generateTransferProof(
  inputNote: Note,
  recipientPublicKey: [bigint, bigint],
  transferAmount: bigint,
  merklePath: bigint[],
  pathIndices: number[]
): Promise<{ proof: Groth16Proof, publicSignals: bigint[] }> {
  
  // 1. Create output notes
  const changeAmount = inputNote.amount - transferAmount;
  const recipientBlinding = randomBigInt();
  const changeBlinding = inputNote.blinding - recipientBlinding; // ensures blinding conservation
  
  const recipientNote = createNote(transferAmount, recipientBlinding, recipientPublicKey);
  const changeNote = createNote(changeAmount, changeBlinding, senderPublicKey);
  
  // 2. Build witness (all private + public inputs)
  const witness = {
    // Private inputs
    amount_in: inputNote.amount,
    blinding_in: inputNote.blinding,
    secret: inputNote.secret,
    nullifier_preimage: inputNote.nullifierPreimage,
    owner_private_key: senderPrivateKey,
    leaf_index: inputNote.leafIndex,
    merkle_path: merklePath,
    path_indices: pathIndices,
    amount_out_1: transferAmount,
    amount_out_2: changeAmount,
    blinding_out_1: recipientBlinding,
    blinding_out_2: changeBlinding,
    // ... remaining note fields
    
    // Public inputs
    merkle_root: currentRoot,
    nullifier_hash: computeNullifier(inputNote),
    new_commitment_1: recipientNote.commitment,
    new_commitment_2: changeNote.commitment,
    // Pedersen commitment coordinates...
  };
  
  // 3. Generate proof using snarkjs
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    witness,
    "circuit.wasm",
    "circuit.zkey"
  );
  
  return { proof, publicSignals };
}
```

### Encrypted Memos

When Alice sends tokens to Bob, she needs to communicate the note details to Bob so he can later spend the note. This is done via an encrypted memo posted on-chain as calldata.

Encryption scheme:
1. Alice generates an ephemeral Baby Jubjub keypair (ek_priv, ek_pub)
2. Alice computes shared_secret = ECDH(ek_priv, bob_public_key) = ek_priv * bob_public_key
3. Alice derives AES key = SHA256(shared_secret.x || shared_secret.y)
4. Alice encrypts memo = AES-256-GCM(key, nonce, plaintext)
   - Plaintext contains: amount, blinding, secret, nullifier_preimage
5. Alice posts on-chain: ek_pub (32 bytes compressed) + encrypted_memo + nonce (12 bytes)
6. Bob scans new Transfer events, extracts ek_pub
7. Bob computes shared_secret = ECDH(bob_private_key, ek_pub) = bob_priv * ek_pub
8. Bob derives the same AES key, decrypts memo
9. If decryption succeeds (valid GCM tag), Bob has received a note

Total on-chain memo size: ~32 (ek_pub) + 128 (encrypted fields) + 12 (nonce) + 16 (GCM tag) = ~188 bytes


## Development Setup and Tooling

### Required Tools
- Node.js >= 18
- Circom 2.x compiler (install from https://github.com/iden3/circom)
- snarkjs (npm install -g snarkjs)
- Hardhat or Foundry for Solidity development
- ethers.js v6 for client SDK

### Project Structure

```
zktoken/
├── circuits/
│   ├── transfer.circom          # Main transfer circuit
│   ├── withdraw.circom          # Withdraw circuit  
│   ├── lib/
│   │   ├── merkle_tree.circom   # Merkle proof verification
│   │   ├── pedersen.circom      # Pedersen commitment verification
│   │   ├── nullifier.circom     # Nullifier derivation
│   │   └── range_proof.circom   # 64-bit range check
│   ├── build/                   # Compiled circuit outputs
│   └── trusted_setup/           # Powers of tau + zkey files
├── contracts/
│   ├── ZkToken.sol              # Core privacy wrapper
│   ├── ZkTokenFactory.sol       # Factory for deploying wrappers
│   ├── IncrementalMerkleTree.sol # Poseidon Merkle tree library
│   ├── Groth16Verifier.sol      # Auto-generated proof verifier
│   ├── PoseidonT3.sol           # Poseidon hash (2 inputs)
│   ├── PoseidonT4.sol           # Poseidon hash (3 inputs)
│   └── interfaces/
│       └── IERC20.sol
├── client/
│   ├── src/
│   │   ├── index.ts             # Main SDK export
│   │   ├── note.ts              # Note creation and management
│   │   ├── prover.ts            # Proof generation
│   │   ├── merkle.ts            # Local Merkle tree sync
│   │   ├── transaction.ts       # Transaction construction
│   │   ├── encryption.ts        # ECDH + AES memo encryption
│   │   ├── keys.ts              # Baby Jubjub key management
│   │   └── types.ts             # TypeScript type definitions
│   ├── package.json
│   └── tsconfig.json
├── scripts/
│   ├── deploy.ts                # Deployment script for Avalanche C-Chain
│   ├── setup_ceremony.sh        # Trusted setup ceremony script
│   └── generate_verifier.sh     # Generate Solidity verifier from zkey
├── test/
│   ├── ZkToken.test.ts          # Contract integration tests
│   ├── circuit.test.ts          # Circuit constraint tests
│   └── sdk.test.ts              # Client SDK unit tests
├── hardhat.config.ts
├── package.json
└── README.md
```

### Build Order

1. Write and compile Circom circuits
2. Run trusted setup ceremony (use Hermez Phase 1 powers of tau for development)
3. Generate Solidity verifier from the zkey
4. Write and compile Solidity contracts
5. Build client SDK
6. Integration tests (circuit + contract + SDK end-to-end)
7. Deploy to Avalanche Fuji testnet
8. Deploy to Avalanche C-Chain mainnet

### Trusted Setup (Development)

For development and testing, use the Hermez Phase 1 powers of tau ceremony (publicly available):

```bash
# Download powers of tau (use powersOfTau28_hez_final_15.ptau for circuits up to 2^15 constraints)
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau

# Compile circuit
circom transfer.circom --r1cs --wasm --sym

# Phase 2 setup (circuit-specific)
snarkjs groth16 setup transfer.r1cs powersOfTau28_hez_final_15.ptau transfer_0000.zkey

# Contribute randomness (in production, this is a multi-party ceremony)
snarkjs zkey contribute transfer_0000.zkey transfer_final.zkey --name="dev setup"

# Export verification key
snarkjs zkey export verificationkey transfer_final.zkey verification_key.json

# Generate Solidity verifier
snarkjs zkey export solidityverifier transfer_final.zkey Groth16Verifier.sol
```

### Avalanche C-Chain Deployment

Network configuration for Hardhat:

```typescript
networks: {
  fuji: {
    url: "https://api.avax-test.network/ext/bc/C/rpc",
    chainId: 43113,
    accounts: [DEPLOYER_PRIVATE_KEY],
    gasPrice: 25000000000 // 25 nAVAX
  },
  mainnet: {
    url: "https://api.avax.network/ext/bc/C/rpc",
    chainId: 43114,
    accounts: [DEPLOYER_PRIVATE_KEY],
    gasPrice: 25000000000
  }
}
```

Explorer: https://snowtrace.io (mainnet), https://testnet.snowtrace.io (Fuji)

### Gas Estimates

Based on Avalanche C-Chain gas costs:
- Deposit: ~300,000 gas (Merkle tree insertion + event emission)
- Transfer: ~500,000 gas (proof verification ~200k + Merkle insertions ~200k + nullifier storage + EC operations)
- Withdraw: ~400,000 gas (proof verification + ERC20 transfer + nullifier storage)

At 25 nAVAX gas price and ~$35 AVAX: deposits ~$0.26, transfers ~$0.44, withdrawals ~$0.35


## Security Considerations

1. Poseidon hash must use identical parameters in Circom circuits and Solidity contracts. Any mismatch means proofs won't verify. Use circomlibjs to generate both.

2. Baby Jubjub generator points G and H must be provably independent (nobody knows log_G(H)). Generate H using a hash-to-curve function with a well-known seed string.

3. Random number generation for secrets, nullifier preimages, and blinding factors must be cryptographically secure. Use crypto.getRandomValues() in the browser or crypto.randomBytes() in Node.js.

4. The nullifier derivation must include the leaf_index to prevent a subtle attack where the same secret+nullifier_preimage used for two different deposits would produce the same nullifier.

5. Range proofs are essential. Without them, a user could create a commitment to a negative amount (which wraps around in the finite field) and inflate the token supply.

6. The Merkle tree root used in a proof might become stale if new deposits happen between proof generation and submission. Accept proofs against any of the last 100 known roots.

7. Encrypted memos should use authenticated encryption (AES-GCM) to prevent memo tampering. A corrupted memo would cause the recipient to reconstruct an invalid note.

8. Front-running protection: the nullifier in a transfer transaction could be front-run (someone sees the tx in the mempool and submits the same nullifier first). Mitigate by including msg.sender or a relayer address as a public input, so the proof is bound to a specific submitter.

9. Relayer support: for maximum privacy, users shouldn't submit transactions from their own address (which links their IP/address to the privacy pool). Support relayers who submit transactions on behalf of users in exchange for a fee deducted from the transferred amount.

10. Fixed denominations vs. arbitrary amounts: arbitrary amounts provide more flexibility but weaker anonymity (amounts serve as fingerprints). Consider supporting both modes — fixed denominations for maximum privacy, arbitrary amounts for convenience.


## Testing Strategy

1. Circuit tests: Verify correct witness generation produces valid proofs. Verify invalid witnesses (wrong amount, wrong nullifier, out-of-range amounts) produce failing proofs.

2. Contract tests: Deploy to local Hardhat network. Test deposit flow, transfer flow, withdraw flow. Test double-spend prevention (same nullifier rejected). Test invalid proof rejection. Test Merkle tree root rotation.

3. Integration tests: Full end-to-end flow — deposit ERC20, generate proof locally, submit transfer, verify recipient can decrypt memo and spend their note.

4. Gas benchmarks: Measure gas for each operation on Avalanche Fuji testnet. Optimize if necessary.

5. Privacy tests: Verify that on-chain data (events, storage) does not leak amounts, senders, or receivers. Verify that Pedersen commitments are correctly formed and homomorphic balance checks work.


## Future: Avalanche Subnet

Once the C-Chain deployment is validated, the next step is a custom Avalanche Subnet with:
- Native privacy opcodes (Poseidon hash, Baby Jubjub EC operations as precompiles)
- Reduced gas costs for privacy operations
- Encrypted mempool (threshold decryption by validators)
- Built-in relayer infrastructure
- Privacy-preserving block explorer

The Subnet would use Avalanche's Warp Messaging for bridging between the privacy subnet and C-Chain, enabling users to move tokens into the privacy environment and back.
