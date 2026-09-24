import { mock } from "bun:test";
import nodeWasm from "../rust/wasm/pkg-node/opencut_wasm.js";

// Next uses wasm-pack's bundler target; Bun tests use the equivalent Node loader.
mock.module("opencut-wasm", () => nodeWasm);
