// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {Paymaster} from "../src/Paymaster.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";

// ─── Mock contracts (same pattern as ShieldedPool.t.sol) ─────────────────────

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "ERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        require(balanceOf[from] >= amount, "ERC20: insufficient balance");
        require(
            allowance[from][msg.sender] >= amount,
            "ERC20: insufficient allowance"
        );
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockPoseidon {
    uint256 internal constant P =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function poseidon(
        uint256[2] calldata inputs
    ) external pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(inputs[0], inputs[1]))) % P;
    }
}

contract MockVerifier is IVerifier {
    bool private _shouldPass;

    constructor(bool shouldPass) {
        _shouldPass = shouldPass;
    }

    function setShouldPass(bool v) external {
        _shouldPass = v;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[4] calldata
    ) external view returns (bool) {
        return _shouldPass;
    }
}

/// @dev A contract that rejects ETH transfers (for testing refund failure).
contract ETHRejecter {
    receive() external payable {
        revert("no thanks");
    }

    function relay(
        Paymaster paymaster,
        bytes calldata proof,
        uint256 root,
        uint256 nullifier,
        uint256 c1,
        uint256 c2
    ) external {
        paymaster.relayTransfer(
            address(this),
            proof,
            root,
            nullifier,
            c1,
            c2,
            "",
            ""
        );
    }
}

/// @dev Returns a 256-byte zeroed proof (valid ABI encoding for abi.decode).
function dummyProof() pure returns (bytes memory) {
    return new bytes(256);
}

// ─── Test suite ──────────────────────────────────────────────────────────────

contract PaymasterTest is Test {
    MockToken token;
    MockPoseidon poseidon;
    MockVerifier transferVerifier;
    MockVerifier withdrawVerifier;
    ShieldedPool pool;
    Paymaster paymaster;

    address deployer = makeAddr("deployer");
    address alice = makeAddr("alice");
    address relayer = makeAddr("relayer");
    address bob = makeAddr("bob");
    address funder = makeAddr("funder");

    uint256 constant AMOUNT = 1000 ether;
    uint256 constant COMMITMENT_1 = 111;
    uint256 constant COMMITMENT_2 = 222;
    uint256 constant COMMITMENT_3 = 333;
    uint256 constant NULLIFIER = 999;
    uint256 constant MAX_GAS_PRICE = 100 gwei;

    function setUp() public {
        token = new MockToken();
        poseidon = new MockPoseidon();
        transferVerifier = new MockVerifier(true);
        withdrawVerifier = new MockVerifier(true);

        pool = new ShieldedPool(
            address(token),
            address(transferVerifier),
            address(withdrawVerifier),
            address(poseidon)
        );

        vm.prank(deployer);
        paymaster = new Paymaster(address(pool), MAX_GAS_PRICE);

        // Fund alice and deposit into pool so we have notes to work with
        token.mint(alice, AMOUNT * 10);
        vm.prank(alice);
        token.approve(address(pool), type(uint256).max);
        vm.prank(alice);
        pool.deposit(AMOUNT, COMMITMENT_1);

        // Fund paymaster with AVAX
        vm.deal(funder, 100 ether);
        vm.prank(funder);
        paymaster.fund{value: 10 ether}();

        // Give relayer some ETH for gas
        vm.deal(relayer, 10 ether);
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    function test_constructor_setsPool() public view {
        assertEq(address(paymaster.pool()), address(pool));
    }

    function test_constructor_setsOwner() public view {
        assertEq(paymaster.owner(), deployer);
    }

    function test_constructor_setsMaxGasPrice() public view {
        assertEq(paymaster.maxGasPrice(), MAX_GAS_PRICE);
    }

    function test_constructor_revertsOnZeroPool() public {
        vm.expectRevert("Paymaster: zero pool");
        new Paymaster(address(0), MAX_GAS_PRICE);
    }

    // ─── relayTransfer: happy path ───────────────────────────────────────────

    function test_relayTransfer_succeeds() public {
        uint256 root = pool.getRoot();

        vm.prank(relayer);
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "memo1",
            "memo2"
        );

        assertTrue(pool.isSpent(NULLIFIER), "Nullifier should be spent");
    }

    function test_relayTransfer_insertsNewLeaves() public {
        uint256 root = pool.getRoot();
        uint32 idxBefore = pool.getNextLeafIndex();

        vm.prank(relayer);
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "",
            ""
        );

        assertEq(pool.getNextLeafIndex(), idxBefore + 2, "Two new leaves inserted");
    }

    function test_relayTransfer_emitsRelayedTransferEvent() public {
        uint256 root = pool.getRoot();

        vm.prank(relayer);
        vm.expectEmit(true, false, false, false);
        emit Paymaster.RelayedTransfer(relayer, 0); // gasRefund varies, check indexed only
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "",
            ""
        );
    }

    function test_relayTransfer_emitsPoolPrivateTransferEvent() public {
        uint256 root = pool.getRoot();

        vm.expectEmit(false, false, false, true);
        emit ShieldedPool.PrivateTransfer(
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "memo1",
            "memo2"
        );

        vm.prank(relayer);
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "memo1",
            "memo2"
        );
    }

    function test_relayTransfer_refundsGasToRelayer() public {
        uint256 root = pool.getRoot();
        uint256 relayerBalBefore = relayer.balance;

        vm.prank(relayer);
        vm.txGasPrice(25 gwei);
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "",
            ""
        );

        // Relayer should have received some AVAX back as gas refund.
        // The refund won't exactly cover all gas (there's overhead outside
        // the measurement window), but it should be nonzero.
        // Because tx.gasprice * gasUsed is sent, and the relayer also
        // spends gas, the net effect depends on the exact gas used.
        // We just verify the paymaster balance decreased.
        assertTrue(
            paymaster.getBalance() < 10 ether,
            "Paymaster balance should decrease after refund"
        );
    }

    // ─── relayTransfer: front-running protection ─────────────────────────────

    function test_relayTransfer_revertsOnRelayerMismatch() public {
        uint256 root = pool.getRoot();

        vm.prank(relayer);
        vm.expectRevert("Paymaster: relayer mismatch");
        paymaster.relayTransfer(
            bob, // wrong relayer address
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "",
            ""
        );
    }

    // ─── relayTransfer: invalid proof ────────────────────────────────────────

    function test_relayTransfer_revertsOnInvalidProof() public {
        transferVerifier.setShouldPass(false);
        uint256 root = pool.getRoot();

        vm.prank(relayer);
        vm.expectRevert("ShieldedPool: invalid transfer proof");
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "",
            ""
        );
    }

    // ─── relayTransfer: double-spend via paymaster ───────────────────────────

    function test_relayTransfer_revertsOnDoubleSpend() public {
        uint256 root = pool.getRoot();

        vm.prank(relayer);
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "",
            ""
        );

        root = pool.getRoot();
        vm.prank(relayer);
        vm.expectRevert("ShieldedPool: note already spent");
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            444,
            555,
            "",
            ""
        );
    }

    // ─── relayTransfer: unknown root ─────────────────────────────────────────

    function test_relayTransfer_revertsOnUnknownRoot() public {
        vm.prank(relayer);
        vm.expectRevert("ShieldedPool: unknown root");
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            type(uint256).max,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "",
            ""
        );
    }

    // ─── relayTransfer: zero commitments ─────────────────────────────────────

    function test_relayTransfer_revertsOnZeroCommitment1() public {
        uint256 root = pool.getRoot();

        vm.prank(relayer);
        vm.expectRevert("ShieldedPool: zero commitment1");
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            0,
            COMMITMENT_3,
            "",
            ""
        );
    }

    function test_relayTransfer_revertsOnZeroCommitment2() public {
        uint256 root = pool.getRoot();

        vm.prank(relayer);
        vm.expectRevert("ShieldedPool: zero commitment2");
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            0,
            "",
            ""
        );
    }

    // ─── relayWithdraw: happy path ───────────────────────────────────────────

    function test_relayWithdraw_succeeds() public {
        uint256 root = pool.getRoot();

        vm.prank(relayer);
        paymaster.relayWithdraw(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            AMOUNT,
            0,
            bob,
            ""
        );

        assertTrue(pool.isSpent(NULLIFIER), "Nullifier should be spent");
        assertEq(token.balanceOf(bob), AMOUNT, "Bob should receive tokens");
    }

    function test_relayWithdraw_withChangeCommitment() public {
        uint256 root = pool.getRoot();
        uint32 idxBefore = pool.getNextLeafIndex();

        vm.prank(relayer);
        paymaster.relayWithdraw(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            AMOUNT / 2,
            COMMITMENT_2,
            bob,
            "memo"
        );

        assertEq(
            pool.getNextLeafIndex(),
            idxBefore + 1,
            "Change commitment inserted"
        );
        assertEq(token.balanceOf(bob), AMOUNT / 2);
    }

    function test_relayWithdraw_emitsRelayedWithdrawEvent() public {
        uint256 root = pool.getRoot();

        vm.prank(relayer);
        vm.expectEmit(true, false, false, false);
        emit Paymaster.RelayedWithdraw(relayer, 0);
        paymaster.relayWithdraw(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            AMOUNT,
            0,
            bob,
            ""
        );
    }

    function test_relayWithdraw_emitsPoolWithdrawalEvent() public {
        uint256 root = pool.getRoot();

        vm.expectEmit(false, true, false, true);
        emit ShieldedPool.Withdrawal(NULLIFIER, bob, AMOUNT, 0, "");

        vm.prank(relayer);
        paymaster.relayWithdraw(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            AMOUNT,
            0,
            bob,
            ""
        );
    }

    // ─── relayWithdraw: error cases ──────────────────────────────────────────

    function test_relayWithdraw_revertsOnRelayerMismatch() public {
        uint256 root = pool.getRoot();

        vm.prank(relayer);
        vm.expectRevert("Paymaster: relayer mismatch");
        paymaster.relayWithdraw(
            bob,
            dummyProof(),
            root,
            NULLIFIER,
            AMOUNT,
            0,
            bob,
            ""
        );
    }

    function test_relayWithdraw_revertsOnInvalidProof() public {
        withdrawVerifier.setShouldPass(false);
        uint256 root = pool.getRoot();

        vm.prank(relayer);
        vm.expectRevert("ShieldedPool: invalid withdraw proof");
        paymaster.relayWithdraw(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            AMOUNT,
            0,
            bob,
            ""
        );
    }

    function test_relayWithdraw_revertsOnDoubleSpend() public {
        uint256 root = pool.getRoot();

        vm.prank(relayer);
        paymaster.relayWithdraw(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            AMOUNT / 2,
            COMMITMENT_2,
            bob,
            ""
        );

        root = pool.getRoot();
        vm.prank(relayer);
        vm.expectRevert("ShieldedPool: note already spent");
        paymaster.relayWithdraw(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            AMOUNT / 2,
            COMMITMENT_3,
            bob,
            ""
        );
    }

    // ─── Funding ─────────────────────────────────────────────────────────────

    function test_fund_acceptsAVAX() public {
        uint256 balBefore = paymaster.getBalance();
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        paymaster.fund{value: 2 ether}();
        assertEq(paymaster.getBalance(), balBefore + 2 ether);
    }

    function test_fund_emitsFundedEvent() public {
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit Paymaster.Funded(alice, 2 ether);
        paymaster.fund{value: 2 ether}();
    }

    function test_fund_revertsOnZeroValue() public {
        vm.prank(alice);
        vm.expectRevert("Paymaster: zero value");
        paymaster.fund{value: 0}();
    }

    function test_receive_acceptsDirectTransfer() public {
        uint256 balBefore = paymaster.getBalance();
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        (bool ok, ) = address(paymaster).call{value: 1 ether}("");
        assertTrue(ok, "Direct transfer should succeed");
        assertEq(paymaster.getBalance(), balBefore + 1 ether);
    }

    function test_receive_emitsFundedEvent() public {
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit Paymaster.Funded(alice, 1 ether);
        (bool ok, ) = address(paymaster).call{value: 1 ether}("");
        assertTrue(ok);
    }

    // ─── Drain ───────────────────────────────────────────────────────────────

    function test_drain_sendsAVAXToRecipient() public {
        uint256 bobBalBefore = bob.balance;
        vm.prank(deployer);
        paymaster.drain(payable(bob), 3 ether);
        assertEq(bob.balance, bobBalBefore + 3 ether);
        assertEq(paymaster.getBalance(), 10 ether - 3 ether);
    }

    function test_drain_emitsDrainedEvent() public {
        vm.prank(deployer);
        vm.expectEmit(true, false, false, true);
        emit Paymaster.Drained(bob, 3 ether);
        paymaster.drain(payable(bob), 3 ether);
    }

    function test_drain_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert("Paymaster: not owner");
        paymaster.drain(payable(alice), 1 ether);
    }

    function test_drain_revertsOnZeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert("Paymaster: zero address");
        paymaster.drain(payable(address(0)), 1 ether);
    }

    function test_drain_revertsOnInsufficientBalance() public {
        vm.prank(deployer);
        vm.expectRevert("Paymaster: insufficient balance");
        paymaster.drain(payable(bob), 100 ether);
    }

    function test_drain_canDrainEntireBalance() public {
        uint256 bal = paymaster.getBalance();
        vm.prank(deployer);
        paymaster.drain(payable(bob), bal);
        assertEq(paymaster.getBalance(), 0);
    }

    // ─── setMaxGasPrice ──────────────────────────────────────────────────────

    function test_setMaxGasPrice_updatesValue() public {
        vm.prank(deployer);
        paymaster.setMaxGasPrice(50 gwei);
        assertEq(paymaster.maxGasPrice(), 50 gwei);
    }

    function test_setMaxGasPrice_emitsEvent() public {
        vm.prank(deployer);
        vm.expectEmit(false, false, false, true);
        emit Paymaster.MaxGasPriceUpdated(50 gwei);
        paymaster.setMaxGasPrice(50 gwei);
    }

    function test_setMaxGasPrice_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert("Paymaster: not owner");
        paymaster.setMaxGasPrice(50 gwei);
    }

    // ─── transferOwnership ───────────────────────────────────────────────────

    function test_transferOwnership_updatesOwner() public {
        vm.prank(deployer);
        paymaster.transferOwnership(alice);
        assertEq(paymaster.owner(), alice);
    }

    function test_transferOwnership_emitsEvent() public {
        vm.prank(deployer);
        vm.expectEmit(true, true, false, false);
        emit Paymaster.OwnerTransferred(deployer, alice);
        paymaster.transferOwnership(alice);
    }

    function test_transferOwnership_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert("Paymaster: not owner");
        paymaster.transferOwnership(alice);
    }

    function test_transferOwnership_revertsOnZeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert("Paymaster: zero owner");
        paymaster.transferOwnership(address(0));
    }

    function test_transferOwnership_newOwnerCanAct() public {
        vm.prank(deployer);
        paymaster.transferOwnership(alice);

        // New owner can set gas price
        vm.prank(alice);
        paymaster.setMaxGasPrice(1 gwei);
        assertEq(paymaster.maxGasPrice(), 1 gwei);

        // Old owner cannot
        vm.prank(deployer);
        vm.expectRevert("Paymaster: not owner");
        paymaster.setMaxGasPrice(2 gwei);
    }

    // ─── Gas refund: maxGasPrice cap ─────────────────────────────────────────

    function test_relayTransfer_capsRefundAtMaxGasPrice() public {
        // Set a very low maxGasPrice
        vm.prank(deployer);
        paymaster.setMaxGasPrice(1 gwei);

        uint256 root = pool.getRoot();
        uint256 paymasterBalBefore = paymaster.getBalance();

        // Submit at a high gas price — refund should be capped
        vm.prank(relayer);
        vm.txGasPrice(500 gwei);
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "",
            ""
        );

        uint256 refundIssued = paymasterBalBefore - paymaster.getBalance();

        // With maxGasPrice = 1 gwei, total refund should be relatively small.
        // At 500 gwei uncapped it would be 500x more. Just verify it's bounded.
        // The exact gas used varies, but gasUsed > 50,000 (GAS_OVERHEAD alone),
        // so refund > 50,000 * 1 gwei = 50,000 gwei.
        // But it should be much less than gasUsed * 500 gwei.
        assertTrue(refundIssued > 0, "Should issue some refund");
        assertTrue(
            refundIssued < 1_000_000 * 1 gwei,
            "Refund should be bounded by maxGasPrice"
        );
    }

    // ─── Gas refund: zero maxGasPrice → no refund ────────────────────────────

    function test_relayTransfer_zeroMaxGasPrice_noRefund() public {
        vm.prank(deployer);
        paymaster.setMaxGasPrice(0);

        uint256 root = pool.getRoot();
        uint256 paymasterBalBefore = paymaster.getBalance();

        vm.prank(relayer);
        vm.txGasPrice(25 gwei);
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "",
            ""
        );

        assertEq(
            paymaster.getBalance(),
            paymasterBalBefore,
            "No refund when maxGasPrice is 0"
        );
    }

    // ─── Gas refund: paymaster underfunded → caps at balance ─────────────────

    function test_relayTransfer_capsRefundAtBalance() public {
        // Drain almost all funds, leave just a tiny amount
        uint256 bal = paymaster.getBalance();
        vm.prank(deployer);
        paymaster.drain(payable(deployer), bal - 1000); // leave 1000 wei

        uint256 root = pool.getRoot();

        vm.prank(relayer);
        vm.txGasPrice(25 gwei);
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "",
            ""
        );

        // Paymaster should have given away everything it had
        assertEq(paymaster.getBalance(), 0, "Paymaster drained to zero");
        assertTrue(pool.isSpent(NULLIFIER), "Transfer still succeeded");
    }

    // ─── Gas refund: empty paymaster → transfer still works ──────────────────

    function test_relayTransfer_succeedsWithZeroPaymasterBalance() public {
        // Drain everything
        uint256 bal = paymaster.getBalance();
        vm.prank(deployer);
        paymaster.drain(payable(deployer), bal);

        uint256 root = pool.getRoot();

        vm.prank(relayer);
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "",
            ""
        );

        assertTrue(pool.isSpent(NULLIFIER), "Transfer succeeds even without refund");
        assertEq(paymaster.getBalance(), 0);
    }

    // ─── Gas refund: relayer that rejects ETH ────────────────────────────────

    function test_relayTransfer_revertsIfRelayerRejectsRefund() public {
        ETHRejecter rejecter = new ETHRejecter();
        uint256 root = pool.getRoot();

        vm.deal(address(rejecter), 1 ether);
        vm.prank(address(rejecter));
        vm.txGasPrice(25 gwei);
        vm.expectRevert("Paymaster: refund failed");
        rejecter.relay(
            paymaster,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3
        );
    }

    // ─── getBalance ──────────────────────────────────────────────────────────

    function test_getBalance_matchesActualBalance() public view {
        assertEq(paymaster.getBalance(), address(paymaster).balance);
    }

    // ─── GAS_OVERHEAD constant ───────────────────────────────────────────────

    function test_gasOverhead_is50000() public view {
        assertEq(paymaster.GAS_OVERHEAD(), 50_000);
    }

    // ─── Permissionless relaying ─────────────────────────────────────────────

    function test_anyoneCanRelay() public {
        uint256 root = pool.getRoot();

        // alice (not a special address) can relay
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        paymaster.relayTransfer(
            alice,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "",
            ""
        );

        assertTrue(pool.isSpent(NULLIFIER));
    }

    // ─── End-to-end: deposit → relayTransfer → relayWithdraw ─────────────────

    function test_e2e_deposit_relayTransfer_relayWithdraw() public {
        // Alice already deposited in setUp (COMMITMENT_1, leaf 0)
        uint256 root = pool.getRoot();

        // Step 1: Relay a private transfer
        uint256 nullifier1 = 1001;
        uint256 commitA = 401;
        uint256 commitB = 402;

        vm.prank(relayer);
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            nullifier1,
            commitA,
            commitB,
            "memo_a",
            "memo_b"
        );

        assertTrue(pool.isSpent(nullifier1), "Transfer nullifier spent");
        assertEq(pool.getNextLeafIndex(), 3); // deposit(1) + transfer(2) = 3

        // Step 2: Relay a withdrawal (bob gets tokens)
        root = pool.getRoot();
        uint256 nullifier2 = 1002;
        uint256 withdrawAmount = 500 ether;
        uint256 changeCommit = 501;

        vm.prank(relayer);
        paymaster.relayWithdraw(
            relayer,
            dummyProof(),
            root,
            nullifier2,
            withdrawAmount,
            changeCommit,
            bob,
            "change_memo"
        );

        assertTrue(pool.isSpent(nullifier2), "Withdraw nullifier spent");
        assertEq(token.balanceOf(bob), withdrawAmount, "Bob received tokens");
        assertEq(pool.getNextLeafIndex(), 4); // +1 for change commitment

        // Pool still holds the remaining tokens
        assertEq(
            token.balanceOf(address(pool)),
            AMOUNT - withdrawAmount,
            "Pool holds remainder"
        );
    }

    // ─── Multiple relayers can submit concurrently ───────────────────────────

    function test_multipleRelayersCanSubmit() public {
        address relayer2 = makeAddr("relayer2");
        vm.deal(relayer2, 10 ether);

        // First relayer submits a transfer
        uint256 root = pool.getRoot();
        vm.prank(relayer);
        paymaster.relayTransfer(
            relayer,
            dummyProof(),
            root,
            NULLIFIER,
            COMMITMENT_2,
            COMMITMENT_3,
            "",
            ""
        );

        // Second relayer submits another transfer (different nullifier)
        root = pool.getRoot();
        uint256 nullifier2 = 888;
        vm.prank(relayer2);
        paymaster.relayTransfer(
            relayer2,
            dummyProof(),
            root,
            nullifier2,
            444,
            555,
            "",
            ""
        );

        assertTrue(pool.isSpent(NULLIFIER));
        assertTrue(pool.isSpent(nullifier2));
    }
}
