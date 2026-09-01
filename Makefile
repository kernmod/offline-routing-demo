SHELL := /bin/bash
NODE22 := npx --yes -p node@22.23.2 -c

.PHONY: fixture verify-fixture build test test-policy coverage fmt lint clean-generated audit-public verify-live-api verify-local

fixture:
	$(NODE22) "node tools/fixtures/build.mjs --out fixtures/sydney"
	CARGO_NET_OFFLINE=true cargo run --release -p cch-routing-lite --bin build-pack -- fixtures/sydney/graph.json fixtures/sydney/routing.pack
	$(NODE22) "node tools/fixtures/build.mjs --out fixtures/sydney"

verify-fixture:
	$(NODE22) "node tools/fixtures/verify.mjs"
	$(NODE22) "node tools/fixtures/reproduce.mjs"

build:
	$(NODE22) "pnpm build"
	cargo build --workspace

test: test-policy
	$(NODE22) "pnpm test"
	cargo test --workspace

test-policy:
	$(NODE22) "pnpm test:policy"

coverage:
	$(NODE22) "pnpm test:coverage"
	cargo llvm-cov --workspace --all-targets --exclude cch-routing-lite-wasm --lcov --output-path coverage/rust.lcov --fail-under-lines 80

fmt:
	cargo fmt --all -- --check

lint:
	$(NODE22) "pnpm lint"
	cargo clippy --workspace --all-targets -- -D warnings

clean-generated:
	./scripts/device/clean-generated.sh

audit-public:
	$(NODE22) "pnpm audit:public"

verify-live-api:
	pnpm verify:live-api

verify-local: fmt lint build test coverage clean-generated audit-public
	@echo "LOCAL_READY"
