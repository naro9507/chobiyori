//! 会計の決まりごと（区分、入力の検証、計算）。DB や画面には依存しない。

pub mod allocation;
pub mod balance;
pub mod journal;
pub mod master;
pub mod standard_accounts;

/// DB に文字列で保存する列挙型を作る。画面とも同じ文字列でやり取りする。
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

        impl rusqlite::types::ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
                Ok(self.as_str().into())
            }
        }

        impl rusqlite::types::FromSql for $name {
            fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
                let text = value.as_str()?;
                $name::parse(text).ok_or_else(|| rusqlite::types::FromSqlError::Other(
                    format!("{} に {text:?} という値はない", stringify!($name)).into(),
                ))
            }
        }
    };
}

pub(crate) use string_enum;
