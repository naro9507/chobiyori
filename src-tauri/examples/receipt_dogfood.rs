//! レシートの読み取りを、本物の Gemini API で試す（ドッグフーディング用。CI では動かさない）。
//!
//! アプリと同じ道筋（`Gemini::read` → `parse_reading` → `checks`）で、フォルダの画像を 1 枚ずつ読み、
//! 正解（`expected.json`）と見比べた結果を出す。
//!
//! ```text
//! GEMINI_API_KEY=... cargo run --example receipt_dogfood -- <画像のフォルダ> [expected.json] [モデル名]
//! ```
//!
//! `expected.json` は `{ "ファイル名": { "date": "YYYY-MM-DD", "total": 1234, "merchant": "店名の一部",
//! "invoiceNo": "T...", "payment": "cash", "taxParts": { "8": 1080 }, "checks": [] } }` の形。
//! 値が null の項目は見比べない（ファイルごと null なら、読んだ結果を出すだけ）。

use chobiyori_core::receipt::{checks, parse_reading, reduced_amount, DEFAULT_MODEL};
use chobiyori_lib::db::attachments::mime_of;
use chobiyori_lib::receipt::gemini::Gemini;
use chobiyori_lib::receipt::{ReadError, ReceiptReader};
use serde_json::Value;
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(dir) = args.first().map(PathBuf::from) else {
        eprintln!("usage: receipt_dogfood <dir> [expected.json] [model]");
        std::process::exit(2);
    };
    let expected: Value = args
        .get(1)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    let model = args.get(2).cloned().unwrap_or(DEFAULT_MODEL.to_string());
    // ネットワークの経路でキーを足す環境では、ここはダミーでよい
    let key = std::env::var("GEMINI_API_KEY").unwrap_or_else(|_| "dummy".into());
    let today = std::env::var("TODAY").unwrap_or_else(|_| "2026-11-19".into());
    let reader = Gemini::new(key, model.clone()).expect("client");

    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .expect("dir")
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    files.sort();

    println!("model: {model}  today: {today}");
    let (mut fields, mut correct) = (0, 0);
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let Some(mime) = mime_of(&name) else { continue };
        let bytes = std::fs::read(&path).expect("read");
        let started = Instant::now();
        // アプリと同じく、回数の上限・混んでいる（503）ときは待って読み直す（ここでは 3 回まで）
        let mut result = tauri::async_runtime::block_on(reader.read(&bytes, mime));
        for _ in 0..3 {
            let Err(ReadError::RateLimited { retry_after }) = result else {
                break;
            };
            let wait = retry_after.unwrap_or(30);
            println!("  (rate limited / busy: waiting {wait}s)");
            std::thread::sleep(std::time::Duration::from_secs(wait));
            result = tauri::async_runtime::block_on(reader.read(&bytes, mime));
        }
        let ms = started.elapsed().as_millis();
        println!("\n=== {name} ({mime}, {} KB, {ms} ms)", bytes.len() / 1024);
        let text = match result {
            Ok(text) => text,
            Err(e) => {
                println!("  ERROR {e:?}");
                continue;
            }
        };
        println!("  raw: {}", text.replace('\n', " "));
        let Some((reading, bad_invoice)) = parse_reading(&text) else {
            println!("  parse_reading: None (badResponse)");
            continue;
        };
        let found = checks(&reading, bad_invoice, &today);
        let reduced = reduced_amount(&reading);
        println!(
            "  reading: date={:?} total={:?} points={} merchant={:?} invoice={:?} payment={:?} taxParts={:?}",
            reading.date,
            reading.total,
            reading.points,
            reading.merchant,
            reading.invoice_no,
            reading.payment.map(|p| p.as_str()),
            reading
                .tax_parts
                .iter()
                .map(|p| (p.rate, p.amount, p.tax))
                .collect::<Vec<_>>()
        );
        let found_names: Vec<&str> = found.iter().map(|c| c.as_str()).collect();
        println!("  checks: {found_names:?}  reduced(8%): {reduced}");

        let want = &expected[&name];
        if want.is_null() {
            continue;
        }
        let mut compare = |label: &str, ok: bool, got: String| {
            fields += 1;
            if ok {
                correct += 1;
            } else {
                println!("  MISS {label}: got {got}, want {}", want[label]);
            }
        };
        if let Some(d) = want["date"].as_str() {
            compare(
                "date",
                reading.date.as_deref() == Some(d),
                format!("{:?}", reading.date),
            );
        }
        if let Some(t) = want["total"].as_i64() {
            compare(
                "total",
                reading.total == Some(t),
                format!("{:?}", reading.total),
            );
        } else if want["total"].is_null() && want.get("total").is_some() {
            compare(
                "total",
                reading.total.is_none(),
                format!("{:?}", reading.total),
            );
        }
        if let Some(m) = want["merchant"].as_str() {
            let ok = if m.is_empty() {
                reading.merchant.is_empty()
            } else {
                reading.merchant.contains(m)
            };
            compare("merchant", ok, format!("{:?}", reading.merchant));
        }
        if want.get("invoiceNo").is_some() {
            compare(
                "invoiceNo",
                reading.invoice_no.as_deref() == want["invoiceNo"].as_str(),
                format!("{:?}", reading.invoice_no),
            );
        }
        if let Some(p) = want["payment"].as_str() {
            let got = reading.payment.map(|p| p.as_str()).unwrap_or("");
            compare("payment", got == p, got.to_string());
        }
        if let Some(parts) = want["taxParts"].as_object() {
            let ok = parts.len() == reading.tax_parts.len()
                && parts.iter().all(|(rate, amount)| {
                    reading
                        .tax_parts
                        .iter()
                        .any(|p| p.rate.to_string() == *rate && Some(p.amount) == amount.as_i64())
                });
            compare(
                "taxParts",
                ok,
                format!(
                    "{:?}",
                    reading
                        .tax_parts
                        .iter()
                        .map(|p| (p.rate, p.amount))
                        .collect::<Vec<_>>()
                ),
            );
        }
        // ポイントで払った額（書いていなければ 0 が正解。ないポイントを作っていないか見る）
        if want.get("total").is_some() {
            let points = want["points"].as_i64().unwrap_or(0);
            compare(
                "points",
                reading.points == points,
                reading.points.to_string(),
            );
        }
        if let Some(c) = want["checks"].as_array() {
            let want_checks: Vec<&str> = c.iter().filter_map(Value::as_str).collect();
            compare(
                "checks",
                want_checks == found_names,
                format!("{found_names:?}"),
            );
        }
    }
    println!("\nfields correct: {correct}/{fields}");
}
