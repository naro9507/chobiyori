import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// jsdom にない API。画面遷移のたびに呼ばれるので空の実装を置く
window.scrollTo = () => {}

afterEach(() => {
	cleanup()
	localStorage.clear()
	document.documentElement.className = ""
})
