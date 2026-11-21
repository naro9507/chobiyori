//! 帳票の PDF。A4 縦。日本語は PC に入っているフォントで書き、使った文字だけを埋め込む。
//!
//! フォントは次の順に探す（アプリには同梱しない）。
//!
//! | OS | フォント |
//! |---|---|
//! | Windows | 游ゴシック → メイリオ → MS ゴシック |
//! | macOS | ヒラギノ角ゴシック W3 → ヒラギノ角ゴ ProN W3 |
//! | Linux | IPAex ゴシック → IPA ゴシック → Noto Sans CJK JP |
//!
//! 埋め込みを禁じているフォント（OS/2 の fsType が Restricted）は使わない。

use super::labels::{self as l};
use super::report::{paginate, Cell, ColumnKind, Report, Row, RowStyle, Section};
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use krilla::color::rgb;
use krilla::geom::{PathBuilder, Point};
use krilla::num::NormalizedF32;
use krilla::page::PageSettings;
use krilla::paint::{Fill, Stroke};
use krilla::surface::Surface;
use krilla::text::{Font, TextDirection};
use krilla::Document;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// PDF に使うフォント。ファイルの中身と、コレクション（.ttc）の中の番号。
#[derive(Clone)]
pub struct PdfFont {
    pub(crate) data: Arc<Vec<u8>>,
    pub(crate) index: u32,
}

/// 帳簿に出てくる文字。これが全部あるフォントだけを使う。
const SAMPLE: &str = "帳簿仕訳現金預金経費科目摘要繰越合計残高あア0123456789,";

impl PdfFont {
    /// ファイルを読み、日本語が書けて埋め込みが許されている面を探す。
    pub fn load(path: &Path, name_hint: Option<&str>) -> Option<Self> {
        let data = std::fs::read(path).ok()?;
        let count = ttf_parser::fonts_in_collection(&data).unwrap_or(1);
        let index = (0..count).find(|&i| {
            let Ok(face) = ttf_parser::Face::parse(&data, i) else {
                return false;
            };
            let named =
                name_hint.is_none_or(|hint| family_names(&face).iter().any(|n| n.contains(hint)));
            named && usable(&face)
        })?;
        Some(Self {
            data: Arc::new(data),
            index,
        })
    }

    fn face(&self) -> ttf_parser::Face<'_> {
        // load で読めることを確かめてある
        ttf_parser::Face::parse(&self.data, self.index).expect("読めることを確かめたフォント")
    }
}

fn family_names(face: &ttf_parser::Face<'_>) -> Vec<String> {
    face.names()
        .into_iter()
        .filter(|n| {
            n.name_id == ttf_parser::name_id::FAMILY || n.name_id == ttf_parser::name_id::FULL_NAME
        })
        .filter_map(|n| n.to_string())
        .collect()
}

fn usable(face: &ttf_parser::Face<'_>) -> bool {
    let embeddable = !matches!(
        face.permissions(),
        Some(ttf_parser::Permissions::Restricted)
    );
    embeddable && SAMPLE.chars().all(|c| face.glyph_index(c).is_some())
}

/// 探すフォント。ファイル名（の一部）と、コレクションの中で選ぶ名前。
struct Candidate {
    dir: PathBuf,
    /// ファイル名に含まれる文字列（小文字で比べる）
    file: &'static str,
    /// フォントの名前に含まれる文字列。ファイル名だけでは決まらないときに使う
    family: Option<&'static str>,
}

fn candidates() -> Vec<Candidate> {
    let c = |dir: PathBuf, file, family| Candidate { dir, file, family };
    let mut list = Vec::new();
    if cfg!(windows) {
        let windir =
            std::env::var_os("WINDIR").map_or_else(|| PathBuf::from(r"C:\Windows"), PathBuf::from);
        let fonts = windir.join("Fonts");
        list.push(c(fonts.clone(), "yugothm.ttc", None));
        list.push(c(fonts.clone(), "yugothr.ttc", None));
        list.push(c(fonts.clone(), "meiryo.ttc", None));
        list.push(c(fonts, "msgothic.ttc", None));
    } else if cfg!(target_os = "macos") {
        // ファイル名は日本語（NFD のこともある）なので、太さとフォントの名前で選ぶ
        let fonts = PathBuf::from("/System/Library/Fonts");
        list.push(c(fonts.clone(), "w3.ttc", Some("Hiragino Sans")));
        list.push(c(fonts, "w3.ttc", Some("Hiragino Kaku Gothic")));
    } else {
        for dir in ["/usr/share/fonts", "/usr/local/share/fonts"] {
            let dir = PathBuf::from(dir);
            list.push(c(dir.clone(), "ipaexg.ttf", None));
            list.push(c(dir.clone(), "ipag.ttf", None));
            list.push(c(
                dir.clone(),
                "notosanscjk-regular.ttc",
                Some("Noto Sans CJK JP"),
            ));
            list.push(c(dir, "notosanscjkjp-regular.otf", None));
        }
    }
    list
}

/// フォルダの中（Linux ではサブフォルダも）から、名前が合うファイルを探す。
fn find_files(dir: &Path, file: &str, depth: usize, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if depth > 0 {
                find_files(&path, file, depth - 1, found);
            }
        } else if path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.to_lowercase().ends_with(file))
        {
            found.push(path);
        }
    }
}

/// PC から PDF に使える日本語のフォントを探す。
pub fn find_font() -> AppResult<PdfFont> {
    let depth = if cfg!(any(windows, target_os = "macos")) {
        0
    } else {
        4
    };
    for candidate in candidates() {
        let mut files = Vec::new();
        find_files(&candidate.dir, candidate.file, depth, &mut files);
        files.sort();
        if let Some(font) = files
            .iter()
            .find_map(|f| PdfFont::load(f, candidate.family))
        {
            return Ok(font);
        }
    }
    Err(AppError::new(ErrorCode::FontNotFound))
}

// ページの寸法（pt）。A4 縦
const PAGE_W: f32 = 595.28;
const PAGE_H: f32 = 841.89;
const MARGIN_X: f32 = 36.0;
const TOP: f32 = 36.0;
const BOTTOM: f32 = 40.0;
const HEADER_ROW_H: f32 = 16.0;
const ROW_H: f32 = 14.5;
const TEXT_SIZE: f32 = 7.8;
const PAD: f32 = 3.0;

/// 1 ページに置ける表の行の数。節の見出しの有無で変わる。
fn capacity(has_heading: bool) -> usize {
    let table_top = table_top(has_heading);
    ((PAGE_H - BOTTOM - 14.0 - table_top - HEADER_ROW_H) / ROW_H).floor() as usize
}

fn table_top(has_heading: bool) -> f32 {
    TOP + if has_heading { 62.0 } else { 46.0 }
}

/// 文字の幅を測る。
pub(crate) struct Measure<'a> {
    face: ttf_parser::Face<'a>,
    units_per_em: f32,
}

impl<'a> Measure<'a> {
    pub(crate) fn new(font: &'a PdfFont) -> Self {
        let face = font.face();
        let units_per_em = f32::from(face.units_per_em());
        Self { face, units_per_em }
    }

    pub(crate) fn width(&self, text: &str, size: f32) -> f32 {
        let units: u32 = text
            .chars()
            .map(|c| {
                let glyph = self.face.glyph_index(c).unwrap_or(ttf_parser::GlyphId(0));
                u32::from(self.face.glyph_hor_advance(glyph).unwrap_or(0))
            })
            .sum();
        units as f32 * size / self.units_per_em
    }

    /// 幅に収まるよう、はみ出す分を「…」にする。
    pub(crate) fn fit(&self, text: &str, size: f32, max: f32) -> String {
        if self.width(text, size) <= max {
            return text.to_string();
        }
        let mut out = String::new();
        let limit = max - self.width("…", size);
        for c in text.chars() {
            out.push(c);
            if self.width(&out, size) > limit {
                out.pop();
                break;
            }
        }
        out.push('…');
        out
    }
}

/// 1 ページ分の内容。
struct PagePlan<'a> {
    section: &'a Section,
    rows: std::ops::Range<usize>,
    continued: bool,
    carry_in: Option<Vec<Cell>>,
    carry_out: Option<Vec<Cell>>,
}

/// 繰越の行。合計の列はページまでの合計、残高の列はその時点の残高。
fn carry_row(section: &Section, upto: usize, label: &str) -> Vec<Cell> {
    section
        .columns
        .iter()
        .enumerate()
        .map(|(i, column)| {
            if Some(i) == section.carry_label_column {
                return Cell::Text(label.to_string());
            }
            match column.kind {
                ColumnKind::Sum => Cell::Amount(
                    section.rows[..upto]
                        .iter()
                        .filter_map(|r| match r.cells.get(i) {
                            Some(Cell::Amount(v)) => Some(*v),
                            _ => None,
                        })
                        .sum(),
                ),
                ColumnKind::Balance => section.rows[..upto]
                    .iter()
                    .rev()
                    .find_map(|r| match r.cells.get(i) {
                        Some(Cell::Amount(v)) => Some(Cell::Amount(*v)),
                        _ => None,
                    })
                    .unwrap_or(Cell::Empty),
                ColumnKind::Text | ColumnKind::Amount => Cell::Empty,
            }
        })
        .collect()
}

fn plan(report: &Report) -> Vec<PagePlan<'_>> {
    let mut pages = Vec::new();
    for section in &report.sections {
        let carry = section.carry_label_column.is_some();
        let groups: Vec<usize> = section.rows.iter().map(|r| r.group).collect();
        let ranges = paginate(&groups, capacity(section.heading.is_some()), carry);
        let count = ranges.len();
        for (i, rows) in ranges.into_iter().enumerate() {
            let carry_in = (carry && i > 0)
                .then(|| carry_row(section, rows.start, l::CARRY_IN.get(report.locale)));
            let carry_out = (carry && i + 1 < count)
                .then(|| carry_row(section, rows.end, l::CARRY_OUT.get(report.locale)));
            pages.push(PagePlan {
                section,
                rows,
                continued: i > 0,
                carry_in,
                carry_out,
            });
        }
    }
    pages
}

fn gray(level: u8) -> rgb::Color {
    rgb::Color::new(level, level, level)
}

fn fill(color: rgb::Color) -> Fill {
    Fill {
        paint: color.into(),
        opacity: NormalizedF32::ONE,
        rule: Default::default(),
    }
}

fn line(surface: &mut Surface<'_>, x1: f32, y1: f32, x2: f32, y2: f32, width: f32, level: u8) {
    let mut pb = PathBuilder::new();
    pb.move_to(x1, y1);
    pb.line_to(x2, y2);
    if let Some(path) = pb.finish() {
        surface.set_fill(None);
        surface.set_stroke(Some(Stroke {
            paint: gray(level).into(),
            width,
            ..Default::default()
        }));
        surface.draw_path(&path);
        surface.set_stroke(None);
    }
}

fn rect(surface: &mut Surface<'_>, x: f32, y: f32, w: f32, h: f32, level: u8) {
    let mut pb = PathBuilder::new();
    if let Some(r) = krilla::geom::Rect::from_xywh(x, y, w, h) {
        pb.push_rect(r);
    }
    if let Some(path) = pb.finish() {
        surface.set_stroke(None);
        surface.set_fill(Some(fill(gray(level))));
        surface.draw_path(&path);
    }
}

struct Writer<'a> {
    font: Font,
    measure: Measure<'a>,
}

#[derive(Clone, Copy)]
enum Align {
    Left,
    Right,
    Center,
}

impl Writer<'_> {
    /// `y` は文字の下端（ベースライン）。
    fn text(
        &self,
        surface: &mut Surface<'_>,
        text: &str,
        x: f32,
        y: f32,
        width: f32,
        (size, align): (f32, Align),
    ) {
        if text.is_empty() {
            return;
        }
        let text = self.measure.fit(text, size, width);
        let w = self.measure.width(&text, size);
        let x = match align {
            Align::Left => x,
            Align::Right => x + width - w,
            Align::Center => x + (width - w) / 2.0,
        };
        surface.set_stroke(None);
        surface.set_fill(Some(fill(gray(20))));
        surface.draw_text(
            Point::from_xy(x, y),
            self.font.clone(),
            size,
            &text,
            false,
            TextDirection::Auto,
        );
    }
}

fn cell_text(cell: &Cell) -> (String, Align) {
    match cell {
        Cell::Empty => (String::new(), Align::Left),
        Cell::Text(text) => (text.clone(), Align::Left),
        Cell::Date(date) => (l::short_date(date), Align::Left),
        Cell::Amount(value) => (l::amount(*value), Align::Right),
    }
}

/// 帳票を PDF にする。
pub fn render(report: &Report, font: &PdfFont) -> AppResult<Vec<u8>> {
    let writer = Writer {
        font: Font::new(font.data.clone().into(), font.index)
            .ok_or(AppError::new(ErrorCode::FontNotFound))?,
        measure: Measure::new(font),
    };
    let pages = plan(report);
    let total = pages.len();
    let mut document = Document::new();
    document.set_metadata(
        krilla::metadata::Metadata::new()
            .title(report.title.clone())
            .creator("帳日和".to_string())
            .language(match report.locale {
                l::Locale::Ja => "ja".to_string(),
                l::Locale::En => "en".to_string(),
            }),
    );
    let settings =
        PageSettings::from_wh(PAGE_W, PAGE_H).ok_or(AppError::new(ErrorCode::FileWrite))?;
    let content_w = PAGE_W - MARGIN_X * 2.0;

    for (number, page_plan) in pages.iter().enumerate() {
        let mut page = document.start_page_with(settings.clone());
        let mut surface = page.surface();
        draw_page(&mut surface, &writer, report, page_plan, content_w);
        // ページ番号
        writer.text(
            &mut surface,
            &format!("{} / {}", number + 1, total),
            MARGIN_X,
            PAGE_H - BOTTOM + 16.0,
            content_w,
            (8.0, Align::Center),
        );
        surface.finish();
        page.finish();
    }
    document.finish().map_err(|error| {
        eprintln!("PDF を作れませんでした: {error:?}");
        AppError::new(ErrorCode::FileWrite)
    })
}

fn draw_page(
    surface: &mut Surface<'_>,
    w: &Writer<'_>,
    report: &Report,
    page: &PagePlan<'_>,
    content_w: f32,
) {
    let section = page.section;
    // 見出し: 帳簿の名前、屋号、期間
    w.text(
        surface,
        &report.title,
        MARGIN_X,
        TOP + 14.0,
        content_w,
        (15.0, Align::Center),
    );
    w.text(
        surface,
        &report.business,
        MARGIN_X,
        TOP + 34.0,
        content_w / 2.0,
        (9.0, Align::Left),
    );
    w.text(
        surface,
        &report.period,
        MARGIN_X + content_w / 2.0,
        TOP + 34.0,
        content_w / 2.0,
        (9.0, Align::Right),
    );
    if let Some(heading) = &section.heading {
        let heading = if page.continued {
            format!("{heading} {}", l::CONTINUED.get(report.locale))
        } else {
            heading.clone()
        };
        w.text(
            surface,
            &heading,
            MARGIN_X,
            TOP + 54.0,
            content_w,
            (11.0, Align::Left),
        );
    }

    // 列の位置
    let total_ratio: f32 = section.columns.iter().map(|c| c.width).sum();
    let mut xs = vec![MARGIN_X];
    for column in &section.columns {
        let last = *xs.last().unwrap_or(&MARGIN_X);
        xs.push(last + content_w * column.width / total_ratio);
    }

    let mut y = table_top(section.heading.is_some());
    let top = y;
    // 列の見出し
    rect(surface, MARGIN_X, y, content_w, HEADER_ROW_H, 236);
    for (i, column) in section.columns.iter().enumerate() {
        w.text(
            surface,
            &column.label,
            xs[i] + PAD,
            y + HEADER_ROW_H - 5.0,
            xs[i + 1] - xs[i] - PAD * 2.0,
            (TEXT_SIZE, Align::Center),
        );
    }
    y += HEADER_ROW_H;
    line(surface, MARGIN_X, y, MARGIN_X + content_w, y, 0.6, 120);

    let mut body: Vec<(Vec<Cell>, RowStyle)> = Vec::new();
    if let Some(cells) = &page.carry_in {
        body.push((cells.clone(), RowStyle::Emphasis));
    }
    body.extend(
        section.rows[page.rows.clone()]
            .iter()
            .map(|r: &Row| (r.cells.clone(), r.style)),
    );
    if let Some(cells) = &page.carry_out {
        body.push((cells.clone(), RowStyle::Emphasis));
    }
    if body.is_empty() {
        w.text(
            surface,
            l::EMPTY.get(report.locale),
            MARGIN_X,
            y + ROW_H - 4.0,
            content_w,
            (TEXT_SIZE, Align::Center),
        );
        y += ROW_H;
    }
    for (cells, style) in &body {
        if *style == RowStyle::Emphasis {
            rect(surface, MARGIN_X, y, content_w, ROW_H, 246);
        }
        for (i, cell) in cells.iter().enumerate().take(section.columns.len()) {
            let (text, align) = cell_text(cell);
            w.text(
                surface,
                &text,
                xs[i] + PAD,
                y + ROW_H - 4.2,
                xs[i + 1] - xs[i] - PAD * 2.0,
                (TEXT_SIZE, align),
            );
        }
        y += ROW_H;
        line(surface, MARGIN_X, y, MARGIN_X + content_w, y, 0.3, 190);
    }
    // 外枠と縦の線
    for x in &xs {
        line(surface, *x, top, *x, y, 0.3, 160);
    }
    line(surface, MARGIN_X, top, MARGIN_X + content_w, top, 0.6, 120);
    line(surface, MARGIN_X, y, MARGIN_X + content_w, y, 0.6, 120);

    let last_page_of_report = std::ptr::eq(section, report.sections.last().unwrap_or(section))
        && page.carry_out.is_none()
        && page.rows.end == section.rows.len();
    if let (true, Some(note)) = (last_page_of_report, &report.footnote) {
        w.text(
            surface,
            note,
            MARGIN_X,
            y + 16.0,
            content_w,
            (9.0, Align::Left),
        );
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::export::labels::Locale;
    use crate::export::report::Column;

    /// テストに使うフォント。PC に日本語のフォントがなければ `None`（PDF のテストは飛ばす）。
    pub(crate) fn test_font() -> Option<PdfFont> {
        let font = find_font().ok();
        if font.is_none() {
            eprintln!("日本語のフォントが見つからないので、PDF の中身のテストを飛ばします");
        }
        font
    }

    fn section(rows: usize) -> Section {
        Section {
            heading: Some("101 現金".into()),
            columns: vec![
                Column {
                    label: "日付".into(),
                    width: 1.0,
                    kind: ColumnKind::Text,
                },
                Column {
                    label: "摘要".into(),
                    width: 3.0,
                    kind: ColumnKind::Text,
                },
                Column {
                    label: "入金".into(),
                    width: 1.0,
                    kind: ColumnKind::Sum,
                },
                Column {
                    label: "残高".into(),
                    width: 1.0,
                    kind: ColumnKind::Balance,
                },
            ],
            rows: (0..rows)
                .map(|i| Row {
                    cells: vec![
                        Cell::Date("2026-03-01".into()),
                        Cell::Text(format!("入金 {i}")),
                        Cell::Amount(100),
                        Cell::Amount(100 * (i as i64 + 1)),
                    ],
                    group: i,
                    style: RowStyle::Normal,
                })
                .collect(),
            carry_label_column: Some(1),
        }
    }

    fn report(rows: usize) -> Report {
        Report {
            title: "現金出納帳".into(),
            business: "テスト教室".into(),
            period: "2026年1月1日〜2026年12月31日".into(),
            sections: vec![section(rows)],
            footnote: None,
            locale: Locale::Ja,
        }
    }

    #[test]
    fn carry_rows_hold_running_sums_and_the_last_balance() {
        let s = section(10);
        assert_eq!(
            carry_row(&s, 4, "次頁へ繰越"),
            [
                Cell::Empty,
                Cell::Text("次頁へ繰越".into()),
                Cell::Amount(400),
                Cell::Amount(400)
            ]
        );
    }

    #[test]
    fn long_books_get_carry_rows_between_pages() {
        let r = report(capacity(true) * 2);
        let pages = plan(&r);
        assert_eq!(pages.len(), 3);
        assert!(pages[0].carry_in.is_none() && pages[0].carry_out.is_some());
        assert!(pages[1].carry_in.is_some() && pages[1].carry_out.is_some());
        assert!(pages[2].carry_out.is_none());
        // 次頁へ繰越と、次のページの前頁より繰越は同じ金額
        assert_eq!(
            pages[0].carry_out.as_ref().unwrap()[2..],
            pages[1].carry_in.as_ref().unwrap()[2..]
        );
        // すべての行がどこかのページに 1 回だけ載る
        let rows: usize = pages.iter().map(|p| p.rows.len()).sum();
        assert_eq!(rows, capacity(true) * 2);
    }

    #[test]
    fn writes_a_pdf_with_embedded_japanese_font() {
        let Some(font) = test_font() else { return };
        let pdf = render(&report(80), &font).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        let text = String::from_utf8_lossy(&pdf);
        // 埋め込んだフォント（使った文字だけの部分集合）がある
        assert!(text.contains("/FontFile2") || text.contains("/FontFile3"));
        assert!(pdf.len() < 400_000, "PDF が大きすぎる: {}", pdf.len());
    }

    #[test]
    fn long_text_is_cut_to_the_column() {
        let Some(font) = test_font() else { return };
        let m = Measure::new(&font);
        let fitted = m.fit(&"あ".repeat(50), 10.0, 50.0);
        assert!(fitted.ends_with('…'));
        assert!(m.width(&fitted, 10.0) <= 50.0);
        assert_eq!(m.fit("現金", 10.0, 50.0), "現金");
    }
}
