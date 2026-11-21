use super::Flow;
use crate::error::ErrorCode;
use crate::export::labels::{Locale, Text};

const RECEIVED: Text = Text {
    ja: "ブラウザでの認証を受け付けました",
    en: "Browser authorization received",
};
const CANCELLED: Text = Text {
    ja: "認証がキャンセルされました",
    en: "Authorization was cancelled",
};
const FAILED: Text = Text {
    ja: "ブラウザでの認証を完了できませんでした",
    en: "Browser authorization could not be completed",
};
const RETRY: Text = Text {
    ja: "もう一度試す場合は、帳日和から認証を始めてください。",
    en: "To try again, start authorization from Chobiyori.",
};
const RETURN_TO_APP: Text = Text {
    ja: "このタブを閉じて、帳日和のウィンドウに戻ってください。",
    en: "Close this tab and switch back to the Chobiyori window.",
};

fn next_step(flow: Flow) -> Text {
    match flow {
        Flow::Calendar => Text {
            ja: "設定 → 事業者情報・申告 → カレンダー同期で「連携済み」と表示されれば完了です。",
            en: "Check for “Connected” under Settings → Business details and tax filing → Calendar sync.",
        },
        Flow::LinkLogin => Text {
            ja: "Windows Hello / Touch ID の画面が出たら本人確認を行い、設定 → 帳簿のパスワード・ロック解除で「設定済み」と表示されることを確認してください。",
            en: "Follow any Windows Hello / Touch ID prompt, then check for “Set up” under Settings → Book password and unlock options.",
        },
        Flow::Unlock => Text {
            ja: "Windows Hello / Touch ID の画面が出たら、本人確認を行って帳簿を開いてください。",
            en: "Follow the Windows Hello / Touch ID prompt to open your books.",
        },
    }
}

pub(super) fn render(locale: Locale, flow: Flow, error: Option<ErrorCode>) -> String {
    let (title, next, tone) = match error {
        None => (RECEIVED, next_step(flow), "received"),
        Some(ErrorCode::CalendarCancelled) => (CANCELLED, RETRY, "interrupted"),
        Some(_) => (FAILED, RETRY, "interrupted"),
    };
    let (lang, app) = match locale {
        Locale::Ja => ("ja", "帳日和"),
        Locale::En => ("en", "Chobiyori"),
    };
    let title = title.get(locale);
    let back = RETURN_TO_APP.get(locale);
    let next = next.get(locale);
    let style = include_str!("callback_page.css");

    format!(
        r#"<!doctype html>
<html lang="{lang}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{title} | {app}</title>
    <style>{style}</style>
</head>
<body>
    <main class="{tone}">
        <p class="app">{app}</p>
        <h1>{title}</h1>
        <div class="next">
            <p><strong>{back}</strong></p>
            <p>{next}</p>
        </div>
    </main>
</body>
</html>"#
    )
}
