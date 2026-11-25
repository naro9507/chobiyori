import { createBook, type MockBook, type Scenario } from "./data"

let book: MockBook = createBook("default")

/** いまの場面の偽の帳簿。ハンドラーはこれを読み書きする。 */
export function currentBook() {
	return book
}

export function resetBook(scenario: Scenario) {
	book = createBook(scenario)
}
