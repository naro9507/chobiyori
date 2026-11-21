//! 会計の決まりごと（区分、入力の検証、計算）。画面・Tauri・ファイル・通信には依存しない。
//!
//! SQLite との橋渡し（列挙型の `ToSql`/`FromSql`、`rusqlite::Error` からの変換）だけは、
//! `rusqlite` feature を付けたときに有効になる。Rust の孤児規則のため、型を持つこの crate に
//! 置くしかない。feature を付けなければ `rusqlite` を使わずにビルド・テストできる。

pub mod allocation;
pub mod balance;
pub mod closing;
pub mod depreciation;
pub mod document;
pub mod error;
pub mod filing;
pub mod industry;
pub mod journal;
pub mod ledger;
pub mod master;
pub mod receipt;
pub mod recurring;
pub mod rules;
pub mod standard_accounts;
pub mod statement;
pub mod template;

#[cfg(feature = "rusqlite")]
#[doc(hidden)]
pub use rusqlite as __rusqlite;

/// `string_enum!` が作る列挙型を SQLite の列に読み書きできるようにする（`rusqlite` feature）。
#[cfg(feature = "rusqlite")]
#[doc(hidden)]
#[macro_export]
macro_rules! __string_enum_sql {
    ($name:ident) => {
        impl $crate::__rusqlite::types::ToSql for $name {
            fn to_sql(
                &self,
            ) -> $crate::__rusqlite::Result<$crate::__rusqlite::types::ToSqlOutput<'_>> {
                Ok(self.as_str().into())
            }
        }

        impl $crate::__rusqlite::types::FromSql for $name {
            fn column_result(
                value: $crate::__rusqlite::types::ValueRef<'_>,
            ) -> $crate::__rusqlite::types::FromSqlResult<Self> {
                let text = value.as_str()?;
                $name::parse(text).ok_or_else(|| {
                    $crate::__rusqlite::types::FromSqlError::Other(
                        format!("{} に {text:?} という値はない", stringify!($name)).into(),
                    )
                })
            }
        }
    };
}

#[cfg(not(feature = "rusqlite"))]
#[doc(hidden)]
#[macro_export]
macro_rules! __string_enum_sql {
    ($name:ident) => {};
}

/// DB に文字列で保存する列挙型を作る。画面とも同じ文字列でやり取りする。
#[macro_export]
macro_rules! string_enum {
    (
        $(#[$meta:meta])*
        pub enum $name:ident { $($(#[$vmeta:meta])* $variant:ident => $text:literal),+ $(,)? }
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
        pub enum $name {
            $($(#[$vmeta])* #[serde(rename = $text)] $variant),+
        }

        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self { $($name::$variant => $text),+ }
            }

            pub fn parse(text: &str) -> Option<Self> {
                match text { $($text => Some($name::$variant),)+ _ => None }
            }
        }

        $crate::__string_enum_sql!($name);
    };
}
