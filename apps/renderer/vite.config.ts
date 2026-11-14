/// <reference types="vitest/config" />
import path from "node:path"
import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// `tauri dev` / `tauri build` が渡す環境変数
const devHost = process.env.TAURI_DEV_HOST
const platform = process.env.TAURI_ENV_PLATFORM

export default defineConfig({
	root: import.meta.dirname,
	plugins: [
		react(),
		babel({ presets: [reactCompilerPreset()] }),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "src"),
		},
	},
	// Rust のビルドエラーを画面から消さない
	clearScreen: false,
	server: {
		port: 5173,
		strictPort: true,
		host: devHost || false,
		hmr: devHost ? { protocol: "ws", host: devHost, port: 5174 } : undefined,
		watch: { ignored: ["**/src-tauri/**"] },
		// リポジトリ直下の CHANGELOG.md を画面に同梱するため
		fs: { allow: [path.resolve(import.meta.dirname, "../..")] },
	},
	envPrefix: ["VITE_", "TAURI_ENV_"],
	build: {
		outDir: "dist",
		emptyOutDir: true,
		// Windows は WebView2（Chromium）、macOS と Linux は WebKit
		target: platform === "windows" ? "chrome105" : "safari13",
		minify: !process.env.TAURI_ENV_DEBUG,
		sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
	},
	test: {
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		css: false,
	},
})
