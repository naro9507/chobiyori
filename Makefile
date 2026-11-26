# 帳日和 - よく使うコマンド
# 中身は package.json の scripts と cargo を呼んでいるだけ

.PHONY: help setup install dev dev-web dev-mock build build-web test test-web test-rust lint format check typecheck clean

.DEFAULT_GOAL := help

help: ## このヘルプを表示
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: install ## 初回セットアップ（依存のインストールと Git hooks）
	@echo "セットアップが終わりました。'make dev' でアプリを起動できます。"

install: ## 依存をインストール
	pnpm install

dev: ## アプリを起動（Rust をビルドしてウィンドウを開く）
	pnpm dev

dev-web: ## 画面だけをブラウザで開く（Rust の機能は使えない）
	pnpm dev:web

dev-mock: ## 画面をモックの帳簿で開く（Rust の代わりに偽のデータを返す）
	pnpm dev:mock

build: ## 配布用のインストーラを作る
	pnpm build

build-web: ## 画面だけをビルド
	pnpm build:web

test: test-web test-rust ## すべてのテスト

test-web: ## 画面のテスト（Vitest）
	pnpm test

test-rust: ## Rust のテスト
	pnpm test:rust

lint: ## リント（Biome と Clippy）
	pnpm lint
	pnpm lint:rust

format: ## 整形（Biome と rustfmt）
	pnpm format:fix
	cargo fmt --all --manifest-path src-tauri/Cargo.toml

check: lint typecheck test ## プッシュ前と同じ検査
	pnpm format
	pnpm format:rust

typecheck: ## 型チェック
	pnpm typecheck

clean: ## ビルド成果物を消す
	rm -rf dist
	cargo clean --manifest-path src-tauri/Cargo.toml
