export const PAYMASTER_ABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "_pool", "type": "address" },
      { "internalType": "uint256", "name": "_maxGasPrice", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "relayer", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "gasRefund", "type": "uint256" }
    ],
    "name": "RelayedTransfer",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "relayer", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "gasRefund", "type": "uint256" }
    ],
    "name": "RelayedWithdraw",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "from", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "Funded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "to", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "Drained",
    "type": "event"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "relayerAddress", "type": "address" },
      { "internalType": "bytes", "name": "proof", "type": "bytes" },
      { "internalType": "uint256", "name": "merkleRoot", "type": "uint256" },
      { "internalType": "uint256", "name": "nullifierHash", "type": "uint256" },
      { "internalType": "uint256", "name": "newCommitment1", "type": "uint256" },
      { "internalType": "uint256", "name": "newCommitment2", "type": "uint256" },
      { "internalType": "bytes", "name": "encryptedMemo1", "type": "bytes" },
      { "internalType": "bytes", "name": "encryptedMemo2", "type": "bytes" }
    ],
    "name": "relayTransfer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "relayerAddress", "type": "address" },
      { "internalType": "bytes", "name": "proof", "type": "bytes" },
      { "internalType": "uint256", "name": "merkleRoot", "type": "uint256" },
      { "internalType": "uint256", "name": "nullifierHash", "type": "uint256" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "internalType": "uint256", "name": "changeCommitment", "type": "uint256" },
      { "internalType": "address", "name": "recipient", "type": "address" },
      { "internalType": "bytes", "name": "encryptedMemo", "type": "bytes" }
    ],
    "name": "relayWithdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "fund",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getBalance",
    "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pool",
    "outputs": [
      { "internalType": "contract ShieldedPool", "name": "", "type": "address" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxGasPrice",
    "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      { "internalType": "address", "name": "", "type": "address" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "to", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "drain",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "price", "type": "uint256" }
    ],
    "name": "setMaxGasPrice",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "stateMutability": "payable",
    "type": "receive"
  }
] as const;
