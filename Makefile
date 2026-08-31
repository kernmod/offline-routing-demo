SHELL := /bin/bash

.PHONY: fixture verify-fixture build test test-policy coverage fmt lint clean-generated audit-public verify-live-api verify-local

fixture:
	node tools/fixtures/build.mjs --out fixtures/sydney
	CARGO_NET_OFFLINE=true cargo run --release -p cch-routing-lite --bin build-pack -- fixtures/sydney/graph.json fixtures/sydney/routing.pack
	node tools/fixtures/build.mjs --out fixtures/sydney

verify-fixture:
	node tools/fixtures/verify.mjs
	node tools/fixtures/reproduce.mjs

build:
	pnpm build
	cargo build --workspace

test: test-policy
	pnpm test
	cargo test --workspace

test-policy:
	pnpm test:policy

coverage:
	pnpm test:coverage
	cargo llvm-cov --workspace --all-targets --lcov --output-path coverage/rust.lcov --fail-under-lines 80

fmt:
	cargo fmt --all -- --check

lint:
	pnpm lint
	cargo clippy --workspace --all-targets -- -D warnings

clean-generated:
	./scripts/device/clean-generated.sh

audit-public:
	pnpm audit:public

verify-live-api:
	pnpm verify:live-api

verify-local: fmt lint build test coverage clean-generated audit-public
	@echo "LOCAL_READY"
