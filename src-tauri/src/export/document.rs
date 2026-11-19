//! 請求書・見積書・納品書・領収書の紙面（F11-2）。
//!
//! 紙面は「図形の並び」（`Shape`）として 1 か所で決め、PDF（krilla）と画面のプレビュー（SVG）の
//! 両方をここから描く。だからプレビューと PDF は同じ配置になる。文字の幅は PDF と同じフォントで測る。
//! 座標は pt、左上が原点、文字の y はベースライン。A4 縦。
//!
//! 書類は日本の取引先に出すので、言葉は日本語だけにする。

use super::labels::amount as yen;
use super::pdf::{Measure, PdfFont};
use crate::db::documents::Document;
use crate::domain::document::{DocumentKind, TaxMode};
use crate::error::{AppError, AppResult, ErrorCode};
use krilla::color::rgb;
use krilla::geom::{PathBuilder, Point, Size, Transform};
use krilla::num::NormalizedF32;
use krilla::page::PageSettings;
use krilla::paint::{Fill, Stroke};
use krilla::text::{Font, TextDirection};
use krilla::Document as PdfDocument;
use serde::Serialize;

pub const PAGE_W: f32 = 595.28;
pub const PAGE_H: f32 = 841.89;
const MARGIN: f32 = 48.0;
const ROW_H: f32 = 20.0;
const SMALL: f32 = 8.5;
const BODY: f32 = 9.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Anchor {
    Start,
    Middle,
    End,
}

/// 紙面の図形。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Shape {
    Text {
        x: f32,
        y: f32,
        size: f32,
        text: String,
        anchor: Anchor,
    },
    Line {
        x1: f32,
        y1: f32,
        x2: f32,
        y2: f32,
        width: f32,
        /// 0（黒）〜255（白）
        gray: u8,
    },
    Rect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        gray: u8,
    },
    /// ロゴ・印影。中身は画面と PDF のそれぞれが持つ
    Image {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        role: ImageRole,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageRole {
    Logo,
    Seal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub width: f32,
    pub height: f32,
    pub shapes: Vec<Shape>,
}

/// 画像の縦横の大きさ（px）。紙面の枠に縦横比を保って収める。
#[derive(Debug, Clone, Copy, Default)]
pub struct ImageSizes {
    pub logo: Option<(u32, u32)>,
    pub seal: Option<(u32, u32)>,
}

pub fn kind_name(kind: DocumentKind) -> &'static str {
    match kind {
        DocumentKind::Invoice => "請求書",
        DocumentKind::Estimate => "見積書",
        DocumentKind::Delivery => "納品書",
        DocumentKind::Receipt => "領収書",
    }
}

fn lead(kind: DocumentKind) -> &'static str {
    match kind {
        DocumentKind::Invoice => "下記のとおりご請求申し上げます。",
        DocumentKind::Estimate => "下記のとおりお見積り申し上げます。",
        DocumentKind::Delivery => "下記のとおり納品いたしました。",
        DocumentKind::Receipt => "下記の金額を正に領収いたしました。",
    }
}

fn total_label(kind: DocumentKind) -> &'static str {
    match kind {
        DocumentKind::Invoice => "ご請求金額",
        DocumentKind::Estimate => "お見積金額",
        DocumentKind::Delivery => "合計金額",
        DocumentKind::Receipt => "領収金額",
    }
}

/// 日付を「2026年3月1日」にする。
pub fn japanese_date(date: &str) -> String {
    match crate::domain::journal::parse_date(date) {
        Some((y, m, d)) => format!("{y}年{m}月{d}日"),
        None => date.to_string(),
    }
}

fn quantity(q: i64) -> String {
    if q % 100 == 0 {
        yen(q / 100)
    } else {
        let s = format!("{}.{:02}", yen(q / 100), (q % 100).abs());
        s.trim_end_matches('0').to_string()
    }
}

fn rate_label(rate: i64, mode: TaxMode) -> String {
    match (rate, mode) {
        (_, TaxMode::Simple) => String::new(),
        (0, _) => "対象外".into(),
        (8, _) => "8%※".into(),
        (r, _) => format!("{r}%"),
    }
}

/// 紙面を組む。`measure(text, size)` は文字の幅（pt）。
pub fn layout(d: &Document, measure: &dyn Fn(&str, f32) -> f32, images: ImageSizes) -> Vec<Page> {
    let mut b = Builder {
        pages: Vec::new(),
        shapes: Vec::new(),
        measure,
    };
    let qualified = d.tax_mode == TaxMode::Qualified;
    let right = PAGE_W - MARGIN;
    let width = right - MARGIN;

    // 見出し
    b.text(PAGE_W / 2.0, 70.0, 20.0, kind_name(d.kind), Anchor::Middle);
    let mut info = vec![format!(
        "番号  {}",
        d.number
            .clone()
            .unwrap_or_else(|| "（発行時に付きます）".into())
    )];
    let date_label = if d.kind == DocumentKind::Receipt {
        "領収日"
    } else {
        "発行日"
    };
    info.push(format!("{date_label}  {}", japanese_date(&d.issue_date)));
    if let Some(due) = &d.due_date {
        let label = if d.kind == DocumentKind::Estimate {
            "有効期限"
        } else {
            "お支払期限"
        };
        info.push(format!("{label}  {}", japanese_date(due)));
    }
    for (i, t) in info.iter().enumerate() {
        b.text(right, 100.0 + i as f32 * 13.0, SMALL, t, Anchor::End);
    }

    // 宛先（左）
    let mut y = 140.0;
    b.text_fit(MARGIN, y, 13.0, &d.recipient_name, width * 0.55);
    b.line(MARGIN, y + 5.0, MARGIN + width * 0.55, y + 5.0, 0.8, 60);
    y += 20.0;
    for line in d.recipient_address.lines().take(3) {
        b.text_fit(MARGIN, y, SMALL, line, width * 0.55);
        y += 12.0;
    }
    y += 8.0;
    if !d.title.is_empty() {
        b.text_fit(MARGIN, y, BODY, &format!("件名  {}", d.title), width * 0.55);
        y += 16.0;
    }
    b.text(MARGIN, y, BODY, lead(d.kind), Anchor::Start);
    y += 14.0;

    // 合計の枠
    let box_w = width * 0.55;
    b.rect(MARGIN, y, box_w, 30.0, 238);
    b.text(
        MARGIN + 10.0,
        y + 19.5,
        10.5,
        total_label(d.kind),
        Anchor::Start,
    );
    let tax_note = if qualified { "（税込）" } else { "" };
    b.text(
        MARGIN + box_w - 10.0,
        y + 20.5,
        15.0,
        &format!("¥{}{tax_note}", yen(d.totals.total)),
        Anchor::End,
    );
    let table_top = y + 50.0;

    // 差出人（右）
    let issuer_x = MARGIN + width * 0.62;
    let issuer_w = right - issuer_x;
    let mut iy = 140.0;
    if let Some((w, h)) = images.logo {
        let (w, h) = fit_box(w, h, issuer_w, 36.0);
        b.shapes.push(Shape::Image {
            x: issuer_x,
            y: iy - 12.0,
            w,
            h,
            role: ImageRole::Logo,
        });
        iy += h + 4.0;
    }
    let mut issuer_lines: Vec<(f32, String)> = Vec::new();
    if !d.issuer.trade_name.is_empty() {
        issuer_lines.push((11.0, d.issuer.trade_name.clone()));
    }
    issuer_lines.push((
        if d.issuer.trade_name.is_empty() {
            11.0
        } else {
            BODY
        },
        d.issuer.owner_name.clone(),
    ));
    for l in d.issuer.address.lines() {
        issuer_lines.push((SMALL, l.to_string()));
    }
    if !d.issuer.phone.is_empty() {
        issuer_lines.push((SMALL, format!("TEL {}", d.issuer.phone)));
    }
    if !d.issuer.email.is_empty() {
        issuer_lines.push((SMALL, d.issuer.email.clone()));
    }
    if let Some(no) = &d.issuer.registration_no {
        issuer_lines.push((SMALL, format!("登録番号 {no}")));
    }
    let seal_top = iy - 10.0;
    for (size, text) in issuer_lines {
        b.text_fit(issuer_x, iy, size, &text, issuer_w);
        iy += size + 5.0;
    }
    if let Some((w, h)) = images.seal {
        let (w, h) = fit_box(w, h, 48.0, 48.0);
        b.shapes.push(Shape::Image {
            x: right - w,
            y: seal_top,
            w,
            h,
            role: ImageRole::Seal,
        });
    }

    // 明細の表
    let mut cols: Vec<(&str, f32, Anchor)> = vec![
        ("品名", 0.44, Anchor::Start),
        ("数量", 0.09, Anchor::End),
        ("単位", 0.07, Anchor::Middle),
        ("単価", 0.14, Anchor::End),
    ];
    if qualified {
        cols.push(("税率", 0.08, Anchor::Middle));
    }
    cols.push(("金額", 0.18, Anchor::End));
    let ratio: f32 = cols.iter().map(|c| c.1).sum();
    let mut xs = vec![MARGIN];
    for c in &cols {
        let last = *xs.last().unwrap_or(&MARGIN);
        xs.push(last + width * c.1 / ratio);
    }
    let rows: Vec<Vec<String>> = d
        .lines
        .iter()
        .map(|l| {
            let mut r = vec![
                l.name.clone(),
                quantity(l.quantity),
                l.unit.clone(),
                yen(l.unit_price),
            ];
            if qualified {
                r.push(rate_label(l.tax_rate, d.tax_mode));
            }
            r.push(yen(l.amount()));
            r
        })
        .collect();

    let header = |b: &mut Builder<'_>, top: f32| {
        b.rect(MARGIN, top, width, ROW_H, 232);
        for (i, c) in cols.iter().enumerate() {
            b.text(
                (xs[i] + xs[i + 1]) / 2.0,
                top + 13.5,
                SMALL,
                c.0,
                Anchor::Middle,
            );
        }
        b.line(MARGIN, top + ROW_H, right, top + ROW_H, 0.6, 120);
    };
    let bottom_limit = PAGE_H - 70.0;
    let mut top = table_top;
    header(&mut b, top);
    top += ROW_H;
    for row in &rows {
        if top + ROW_H > bottom_limit {
            b.next_page();
            top = 70.0;
            header(&mut b, top);
            top += ROW_H;
        }
        for (i, cell) in row.iter().enumerate() {
            let (w, anchor) = (xs[i + 1] - xs[i] - 8.0, cols[i].2);
            let x = match anchor {
                Anchor::Start => xs[i] + 4.0,
                Anchor::Middle => (xs[i] + xs[i + 1]) / 2.0,
                Anchor::End => xs[i + 1] - 4.0,
            };
            let text = b.fit(cell, BODY, w);
            b.text(x, top + 13.5, BODY, &text, anchor);
        }
        top += ROW_H;
        b.line(MARGIN, top, right, top, 0.3, 190);
    }

    // 合計
    let mut sums: Vec<(String, String)> = vec![("小計".into(), yen(d.totals.subtotal))];
    if qualified {
        for r in &d.totals.by_rate {
            let label = match r.rate {
                10 => "10%対象".to_string(),
                8 => "8%対象（※軽減税率）".to_string(),
                _ => "対象外".to_string(),
            };
            if r.rate == 0 {
                sums.push((label, yen(r.base)));
            } else {
                sums.push((
                    format!("{label}  {}", yen(r.base)),
                    format!("消費税 {}", yen(r.tax)),
                ));
            }
        }
    }
    sums.push(("合計".into(), yen(d.totals.total)));
    let sums_h = sums.len() as f32 * 16.0 + 10.0;
    if top + sums_h > bottom_limit {
        b.next_page();
        top = 70.0;
    }
    top += 8.0;
    let label_x = MARGIN + width * 0.45;
    for (i, (label, value)) in sums.iter().enumerate() {
        top += 16.0;
        let size = if i + 1 == sums.len() { 11.0 } else { BODY };
        b.text(label_x, top, size, label, Anchor::Start);
        b.text(right - 4.0, top, size, value, Anchor::End);
    }
    b.line(label_x, top + 5.0, right, top + 5.0, 0.6, 120);
    top += 24.0;

    // 備考・振込先
    let mut notes: Vec<String> = Vec::new();
    if qualified && d.lines.iter().any(|l| l.tax_rate == 8) {
        notes.push("※は軽減税率の対象です。".into());
    }
    if d.kind == DocumentKind::Invoice && !d.issuer.bank_account.is_empty() {
        notes.push("お振込先".into());
        notes.extend(d.issuer.bank_account.lines().map(|l| format!("  {l}")));
    }
    if !d.notes.is_empty() {
        notes.push("備考".into());
        notes.extend(d.notes.lines().map(|l| format!("  {l}")));
    }
    for n in notes {
        if top + 14.0 > bottom_limit {
            b.next_page();
            top = 70.0;
        }
        let fitted = b.fit(&n, SMALL, width);
        b.text(MARGIN, top, SMALL, &fitted, Anchor::Start);
        top += 13.0;
    }

    b.finish()
}

fn fit_box(w: u32, h: u32, max_w: f32, max_h: f32) -> (f32, f32) {
    if w == 0 || h == 0 {
        return (max_w, max_h);
    }
    let scale = (max_w / w as f32).min(max_h / h as f32);
    (w as f32 * scale, h as f32 * scale)
}

struct Builder<'a> {
    pages: Vec<Vec<Shape>>,
    shapes: Vec<Shape>,
    measure: &'a dyn Fn(&str, f32) -> f32,
}

impl Builder<'_> {
    fn fit(&self, text: &str, size: f32, max: f32) -> String {
        if (self.measure)(text, size) <= max {
            return text.to_string();
        }
        let limit = max - (self.measure)("…", size);
        let mut out = String::new();
        for c in text.chars() {
            out.push(c);
            if (self.measure)(&out, size) > limit {
                out.pop();
                break;
            }
        }
        out.push('…');
        out
    }

    fn text(&mut self, x: f32, y: f32, size: f32, text: &str, anchor: Anchor) {
        if text.is_empty() {
            return;
        }
        self.shapes.push(Shape::Text {
            x,
            y,
            size,
            text: text.to_string(),
            anchor,
        });
    }

    fn text_fit(&mut self, x: f32, y: f32, size: f32, text: &str, max: f32) {
        let fitted = self.fit(text, size, max);
        self.text(x, y, size, &fitted, Anchor::Start);
    }

    fn line(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, width: f32, gray: u8) {
        self.shapes.push(Shape::Line {
            x1,
            y1,
            x2,
            y2,
            width,
            gray,
        });
    }

    fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, gray: u8) {
        self.shapes.push(Shape::Rect { x, y, w, h, gray });
    }

    fn next_page(&mut self) {
        self.pages.push(std::mem::take(&mut self.shapes));
    }

    fn finish(mut self) -> Vec<Page> {
        self.next_page();
        let total = self.pages.len();
        self.pages
            .into_iter()
            .enumerate()
            .map(|(i, mut shapes)| {
                if total > 1 {
                    shapes.push(Shape::Text {
                        x: PAGE_W / 2.0,
                        y: PAGE_H - 30.0,
                        size: SMALL,
                        text: format!("{} / {total}", i + 1),
                        anchor: Anchor::Middle,
                    });
                }
                Page {
                    width: PAGE_W,
                    height: PAGE_H,
                    shapes,
                }
            })
            .collect()
    }
}

/// ロゴ・印影の画像（PNG か JPEG）。
#[derive(Debug, Clone, Default)]
pub struct Images {
    pub logo: Option<(Vec<u8>, String)>,
    pub seal: Option<(Vec<u8>, String)>,
}

fn decode(image: &Option<(Vec<u8>, String)>) -> Option<krilla::image::Image> {
    let (bytes, mime) = image.as_ref()?;
    let data: krilla::Data = bytes.clone().into();
    match mime.as_str() {
        "image/png" => krilla::image::Image::from_png(data, true).ok(),
        "image/jpeg" => krilla::image::Image::from_jpeg(data, true).ok(),
        _ => None,
    }
}

impl Images {
    pub fn sizes(&self) -> ImageSizes {
        ImageSizes {
            logo: decode(&self.logo).map(|i| i.size()),
            seal: decode(&self.seal).map(|i| i.size()),
        }
    }
}

/// 紙面を組む（PDF と同じフォントで文字の幅を測る）。
pub fn pages(d: &Document, font: &PdfFont, images: &Images) -> Vec<Page> {
    let m = Measure::new(font);
    layout(d, &|text, size| m.width(text, size), images.sizes())
}

/// 書類の PDF を作る。
pub fn render(d: &Document, font: &PdfFont, images: &Images) -> AppResult<Vec<u8>> {
    let pdf_font = Font::new(font.data.clone().into(), font.index)
        .ok_or(AppError::new(ErrorCode::FontNotFound))?;
    let m = Measure::new(font);
    let mut document = PdfDocument::new();
    document.set_metadata(
        krilla::metadata::Metadata::new()
            .title(format!(
                "{} {}",
                kind_name(d.kind),
                d.number.clone().unwrap_or_default()
            ))
            .creator("帳日和".to_string())
            .language("ja".to_string()),
    );
    let settings =
        PageSettings::from_wh(PAGE_W, PAGE_H).ok_or(AppError::new(ErrorCode::FileWrite))?;
    let (logo, seal) = (decode(&images.logo), decode(&images.seal));
    for page in layout(d, &|text, size| m.width(text, size), images.sizes()) {
        let mut p = document.start_page_with(settings.clone());
        let mut surface = p.surface();
        for shape in &page.shapes {
            match shape {
                Shape::Text {
                    x,
                    y,
                    size,
                    text,
                    anchor,
                } => {
                    let w = m.width(text, *size);
                    let x = match anchor {
                        Anchor::Start => *x,
                        Anchor::Middle => x - w / 2.0,
                        Anchor::End => x - w,
                    };
                    surface.set_stroke(None);
                    surface.set_fill(Some(fill(20)));
                    surface.draw_text(
                        Point::from_xy(x, *y),
                        pdf_font.clone(),
                        *size,
                        text,
                        false,
                        TextDirection::Auto,
                    );
                }
                Shape::Line {
                    x1,
                    y1,
                    x2,
                    y2,
                    width,
                    gray,
                } => {
                    let mut pb = PathBuilder::new();
                    pb.move_to(*x1, *y1);
                    pb.line_to(*x2, *y2);
                    if let Some(path) = pb.finish() {
                        surface.set_fill(None);
                        surface.set_stroke(Some(Stroke {
                            paint: rgb::Color::new(*gray, *gray, *gray).into(),
                            width: *width,
                            ..Default::default()
                        }));
                        surface.draw_path(&path);
                        surface.set_stroke(None);
                    }
                }
                Shape::Rect { x, y, w, h, gray } => {
                    let mut pb = PathBuilder::new();
                    if let Some(r) = krilla::geom::Rect::from_xywh(*x, *y, *w, *h) {
                        pb.push_rect(r);
                    }
                    if let Some(path) = pb.finish() {
                        surface.set_stroke(None);
                        surface.set_fill(Some(fill(*gray)));
                        surface.draw_path(&path);
                    }
                }
                Shape::Image { x, y, w, h, role } => {
                    let image = match role {
                        ImageRole::Logo => logo.clone(),
                        ImageRole::Seal => seal.clone(),
                    };
                    if let (Some(image), Some(size)) = (image, Size::from_wh(*w, *h)) {
                        surface.push_transform(&Transform::from_translate(*x, *y));
                        surface.draw_image(image, size);
                        surface.pop();
                    }
                }
            }
        }
        surface.finish();
        p.finish();
    }
    document.finish().map_err(|error| {
        eprintln!("書類の PDF を作れませんでした: {error:?}");
        AppError::new(ErrorCode::FileWrite)
    })
}

fn fill(gray: u8) -> Fill {
    Fill {
        paint: rgb::Color::new(gray, gray, gray).into(),
        opacity: NormalizedF32::ONE,
        rule: Default::default(),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::documents::{Document, Issuer, Send};
    use crate::domain::document::{totals, DisplayStatus, DocumentStatus, LineInput};

    pub(crate) fn sample(mode: TaxMode, lines: usize) -> Document {
        let lines: Vec<LineInput> = (0..lines)
            .map(|i| LineInput {
                name: format!("レッスン {i}"),
                quantity: 150,
                unit: "時間".into(),
                unit_price: 4_000,
                tax_rate: if i % 2 == 0 { 10 } else { 8 },
            })
            .collect();
        Document {
            id: 1,
            kind: DocumentKind::Invoice,
            number: Some("INV-2026-0001".into()),
            status: DocumentStatus::Issued,
            display_status: DisplayStatus::Issued,
            partner_id: None,
            recipient_name: "株式会社テスト 御中".into(),
            recipient_address: "東京都千代田区1-1".into(),
            recipient_email: String::new(),
            issue_date: "2026-03-01".into(),
            due_date: Some("2026-03-31".into()),
            title: "3 月分".into(),
            notes: "よろしくお願いします".into(),
            tax_mode: mode,
            issuer: Issuer {
                trade_name: "テスト教室".into(),
                owner_name: "山田 花子".into(),
                address: "東京都".into(),
                phone: "03-0000-0000".into(),
                email: String::new(),
                registration_no: (mode == TaxMode::Qualified).then(|| "T1234567890123".into()),
                bank_account: "テスト銀行 本店 普通 1234567".into(),
            },
            totals: totals(&lines, mode),
            lines,
            paid: 0,
            last_payment_account_id: None,
            source_document_id: None,
            transaction_id: None,
            pdf_attachment_id: None,
            issued_at: None,
            canceled_at: None,
            sends: Vec::<Send>::new(),
        }
    }

    /// 1 文字 = 文字の大きさ × 0.6 の幅（テスト用）。
    fn measure(text: &str, size: f32) -> f32 {
        text.chars().count() as f32 * size * 0.6
    }

    fn texts(pages: &[Page]) -> Vec<String> {
        pages
            .iter()
            .flat_map(|p| &p.shapes)
            .filter_map(|s| match s {
                Shape::Text { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn qualified_invoices_show_the_required_items() {
        let d = sample(TaxMode::Qualified, 2);
        let t = texts(&layout(&d, &measure, ImageSizes::default()));
        for needed in [
            "請求書",
            "登録番号 T1234567890123",
            "税率",
            "8%※",
            "10%対象  6,000",
            "消費税 600",
            "8%対象（※軽減税率）  6,000",
            "消費税 480",
            "※は軽減税率の対象です。",
            "お振込先",
        ] {
            assert!(t.iter().any(|x| x == needed), "{needed} がない: {t:?}");
        }
        assert!(t.iter().any(|x| x.contains("¥13,080（税込）")));
    }

    #[test]
    fn simple_documents_have_no_tax_items() {
        let d = sample(TaxMode::Simple, 2);
        let t = texts(&layout(&d, &measure, ImageSizes::default()));
        assert!(!t
            .iter()
            .any(|x| x.contains("登録番号") || x == "税率" || x.contains("消費税")));
        assert!(t.iter().any(|x| x == "¥12,000"));
    }

    #[test]
    fn long_documents_continue_on_the_next_page() {
        let d = sample(TaxMode::Qualified, 60);
        let pages = layout(&d, &measure, ImageSizes::default());
        assert!(pages.len() >= 2);
        let t = texts(&pages);
        // すべての行が 1 回ずつ載り、見出しがページごとに繰り返す
        assert_eq!(t.iter().filter(|x| x.starts_with("レッスン")).count(), 60);
        assert_eq!(t.iter().filter(|x| *x == "品名").count(), pages.len());
        assert!(t.iter().any(|x| x == &format!("1 / {}", pages.len())));
    }

    #[test]
    fn writes_a_pdf_with_images() {
        let Some(font) = crate::export::pdf::tests::test_font() else {
            return;
        };
        // 1×1 の PNG
        let png = vec![
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0,
            0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1F, 0x15, 0xC4, 0x89, 0, 0, 0, 13, 0x49, 0x44,
            0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0xF0, 0x1F, 0, 0x05, 0x00, 0x01, 0xFF,
            0x89, 0x99, 0x3D, 0x1D, 0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        let images = Images {
            logo: Some((png.clone(), "image/png".into())),
            seal: Some((png, "image/png".into())),
        };
        assert!(images.sizes().logo.is_some());
        let pdf = render(&sample(TaxMode::Qualified, 3), &font, &images).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
    }
}
