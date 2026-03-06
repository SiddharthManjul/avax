import {
  ShieldedPool,
  MerkleLeaf,
  DepositEvent,
  TransferEvent,
  WithdrawalEvent,
  PoolState,
} from "generated";

const POOL_STATE_ID = "pool";

async function getOrCreatePoolState(context: any): Promise<any> {
  let state = await context.PoolState.get(POOL_STATE_ID);
  if (!state) {
    state = {
      id: POOL_STATE_ID,
      nextLeafIndex: 0,
      totalDeposits: 0,
      totalTransfers: 0,
      totalWithdrawals: 0,
      lastIndexedBlock: 0,
    };
  }
  return state;
}

ShieldedPool.Deposit.handler(async ({ event, context }) => {
  const state = await getOrCreatePoolState(context);
  const leafIndex = state.nextLeafIndex;
  const id = event.transaction.hash + "-" + event.logIndex.toString();

  context.MerkleLeaf.set({
    id: "leaf-" + id,
    commitment: event.params.commitment,
    leafIndex,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    eventType: "deposit",
  });

  context.DepositEvent.set({
    id,
    commitment: event.params.commitment,
    leafIndex,
    timestamp: BigInt(event.params.timestamp),
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });

  context.PoolState.set({
    ...state,
    nextLeafIndex: leafIndex + 1,
    totalDeposits: state.totalDeposits + 1,
    lastIndexedBlock: event.block.number,
  });
});

ShieldedPool.PrivateTransfer.handler(async ({ event, context }) => {
  const state = await getOrCreatePoolState(context);
  const leafIndex1 = state.nextLeafIndex;
  const leafIndex2 = state.nextLeafIndex + 1;
  const id = event.transaction.hash + "-" + event.logIndex.toString();

  context.MerkleLeaf.set({
    id: "leaf-" + id + "-0",
    commitment: event.params.commitment1,
    leafIndex: leafIndex1,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    eventType: "transfer",
  });

  context.MerkleLeaf.set({
    id: "leaf-" + id + "-1",
    commitment: event.params.commitment2,
    leafIndex: leafIndex2,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    eventType: "transfer",
  });

  context.TransferEvent.set({
    id,
    nullifierHash: event.params.nullifierHash,
    commitment1: event.params.commitment1,
    commitment2: event.params.commitment2,
    encryptedMemo1: event.params.encryptedMemo1,
    encryptedMemo2: event.params.encryptedMemo2,
    leafIndex1,
    leafIndex2,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });

  context.PoolState.set({
    ...state,
    nextLeafIndex: leafIndex2 + 1,
    totalTransfers: state.totalTransfers + 1,
    lastIndexedBlock: event.block.number,
  });
});

ShieldedPool.Withdrawal.handler(async ({ event, context }) => {
  const state = await getOrCreatePoolState(context);
  const id = event.transaction.hash + "-" + event.logIndex.toString();
  let changeLeafIndex = -1;
  let nextIdx = state.nextLeafIndex;

  if (event.params.changeCommitment !== 0n) {
    changeLeafIndex = nextIdx;

    context.MerkleLeaf.set({
      id: "leaf-" + id,
      commitment: event.params.changeCommitment,
      leafIndex: changeLeafIndex,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
      eventType: "withdrawal",
    });

    nextIdx += 1;
  }

  context.WithdrawalEvent.set({
    id,
    nullifierHash: event.params.nullifierHash,
    recipient: event.params.recipient,
    amount: event.params.amount,
    changeCommitment: event.params.changeCommitment,
    encryptedMemo: event.params.encryptedMemo,
    changeLeafIndex,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });

  context.PoolState.set({
    ...state,
    nextLeafIndex: nextIdx,
    totalWithdrawals: state.totalWithdrawals + 1,
    lastIndexedBlock: event.block.number,
  });
});
