/**
 * Test setup — eagerly initialise circomlibjs WASM singletons once
 * before any test file runs.
 */
import { initCrypto } from "../lib/zktoken/crypto";

await initCrypto();
