// リリースビルドの Windows で、余分なコンソール画面を出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    chobiyori_lib::run();
}
