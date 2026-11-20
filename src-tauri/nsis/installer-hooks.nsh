; インストール先と登録キーに使う PRODUCTNAME はそのまま使う。
!define CHOBIYORI_DISPLAY_NAME "帳日和"

; 1041 は日本語、1033 は英語。Tauri が言語を読み込む前に定義する。
LangString ^Name 1041 "${CHOBIYORI_DISPLAY_NAME}"
LangString ^Name 1033 "${CHOBIYORI_DISPLAY_NAME}"
LangString ^NameDA 1041 "${CHOBIYORI_DISPLAY_NAME}"
LangString ^NameDA 1033 "${CHOBIYORI_DISPLAY_NAME}"

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${CHOBIYORI_DISPLAY_NAME}"
!macroend
