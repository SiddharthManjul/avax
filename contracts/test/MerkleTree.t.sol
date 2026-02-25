// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {IncrementalMerkleTree} from "../src/IncrementalMerkleTree.sol";

/**
 * @title MockPoseidon
 * @dev Stand-in for the real Poseidon contract during Merkle tree tests.
 *
 * Uses a simple deterministic hash (keccak256) so we can verify structural
 * invariants (insertion order, root history, known-root lookups) without
 * needing to deploy the full gas-heavy Poseidon contract.
 *
 * ⚠ This produces DIFFERENT roots from the real Poseidon. Use only for
 *   structural / unit tests. Proof verification tests require the real Poseidon.
 */
contract MockPoseidon {
    function poseidon(
        uint256[2] calldata inputs
    ) external pure returns (uint256) {
        return
            uint256(keccak256(abi.encodePacked(inputs[0], inputs[1]))) %
            21888242871839275222246405745257275088548364400416034343698204186575808495617;
    }
}

/**
 * @title MerkleTreeTest
 * @notice Unit tests for IncrementalMerkleTree via a thin harness contract.
 */
contract MerkleTreeHarness {
    using IncrementalMerkleTree for IncrementalMerkleTree.TreeData;

    IncrementalMerkleTree.TreeData public tree;

    constructor(address poseidon) {
        tree.init(poseidon);
    }

    function insert(uint256 leaf) external returns (uint32 idx, uint256 root) {
        return tree.insert(leaf);
    }

    function getRoot() external view returns (uint256) {
        return tree.getRoot();
    }

    function isKnownRoot(uint256 root) external view returns (bool) {
        return tree.isKnownRoot(root);
    }

    function nextIndex() external view returns (uint32) {
        return tree.nextIndex;
    }
}

contract MerkleTreeTest is Test {
    MockPoseidon poseidon;
    MerkleTreeHarness harness;

    function setUp() public {
        poseidon = new MockPoseidon();
        harness = new MerkleTreeHarness(address(poseidon));
    }

    // ─── Initialisation ───────────────────────────────────────────────────────

    function test_initialRoot_isNonZero() public view {
        uint256 root = harness.getRoot();
        assertTrue(
            root != 0,
            "Initial root should be non-zero (Poseidon of zeros)"
        );
    }

    function test_initialNextIndex_isZero() public view {
        assertEq(harness.nextIndex(), 0, "Initial next index should be 0");
    }

    function test_initialRoot_isKnown() public view {
        assertTrue(
            harness.isKnownRoot(harness.getRoot()),
            "Initial root should be in known roots"
        );
    }

    // ─── Single insertion ─────────────────────────────────────────────────────

    function test_insert_returnsLeafIndexZero() public {
        (uint32 idx, ) = harness.insert(1);
        assertEq(idx, 0, "First leaf index should be 0");
    }

    function test_insert_advancesNextIndex() public {
        harness.insert(1);
        assertEq(
            harness.nextIndex(),
            1,
            "Next index should be 1 after first insert"
        );
    }

    function test_insert_changesRoot() public {
        uint256 rootBefore = harness.getRoot();
        harness.insert(1);
        uint256 rootAfter = harness.getRoot();
        assertTrue(
            rootBefore != rootAfter,
            "Root should change after insertion"
        );
    }

    function test_newRoot_isKnown() public {
        uint256 rootBefore = harness.getRoot();
        harness.insert(42);
        uint256 rootAfter = harness.getRoot();

        assertTrue(
            harness.isKnownRoot(rootBefore),
            "Previous root should remain known"
        );
        assertTrue(harness.isKnownRoot(rootAfter), "New root should be known");
    }

    // ─── Multiple insertions ──────────────────────────────────────────────────

    function test_multipleInserts_incrementIndex() public {
        for (uint256 i = 1; i <= 10; i++) {
            harness.insert(i);
            assertEq(
                harness.nextIndex(),
                uint32(i),
                "nextIndex should match insert count"
            );
        }
    }

    function test_multipleInserts_rootChangesEachTime() public {
        uint256 prevRoot = harness.getRoot();
        for (uint256 i = 1; i <= 5; i++) {
            harness.insert(i * 1337);
            uint256 newRoot = harness.getRoot();
            assertTrue(
                newRoot != prevRoot,
                "Root should change on each insert"
            );
            prevRoot = newRoot;
        }
    }

    function test_distinctLeaves_produceDifferentRoots() public {
        (, uint256 root1) = harness.insert(111);
        (, uint256 root2) = harness.insert(222);
        assertTrue(
            root1 != root2,
            "Different leaves should produce different roots"
        );
    }

    // ─── Root history ─────────────────────────────────────────────────────────

    function test_rootHistory_size30() public {
        // Insert 30 leaves and verify all roots are known
        uint256[] memory roots = new uint256[](30);
        for (uint256 i = 0; i < 30; i++) {
            (, uint256 r) = harness.insert(i + 1);
            roots[i] = r;
        }
        for (uint256 i = 0; i < 30; i++) {
            assertTrue(
                harness.isKnownRoot(roots[i]),
                "All 30 most-recent roots should be known"
            );
        }
    }

    function test_rootHistory_expireAfter30Insertions() public {
        // Capture root at index 0
        uint256 root0 = harness.getRoot();

        // Push 30 more roots to wrap the circular buffer
        for (uint256 i = 0; i < 30; i++) {
            harness.insert(i + 1);
        }

        // The very first root (before any insertions) should now be evicted
        assertFalse(
            harness.isKnownRoot(root0),
            "Root older than 30 insertions should be evicted from history"
        );
    }

    // ─── Zero commitment ──────────────────────────────────────────────────────

    function test_insert_zeroLeaf_succeeds() public {
        // The contract doesn't reject zero leaves (ShieldedPool does — not IMT)
        (uint32 idx, ) = harness.insert(0);
        assertEq(idx, 0);
    }

    // ─── Fuzz ─────────────────────────────────────────────────────────────────

    function testFuzz_insert(uint256[8] memory leaves) public {
        for (uint256 i = 0; i < 8; i++) {
            uint256 leaf = leaves[i] % type(uint256).max; // keep in field
            (uint32 idx, uint256 root) = harness.insert(leaf);
            assertEq(idx, uint32(i), "leaf index should be sequential");
            assertTrue(harness.isKnownRoot(root), "new root should be known");
        }
    }
}
